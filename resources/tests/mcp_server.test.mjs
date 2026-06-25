// MCP server test harness for yumi-mcp-bash.cjs
//
// Spawns the server, speaks line-delimited JSON-RPC 2.0 over stdin/stdout, and
// asserts the faithful-behavior contract. Run with:
//   cd C:\dev\yume-test\yumi\resources && node tests/mcp_server.test.mjs
//
// Exits non-zero on any failed assertion; prints "ALL TESTS PASSED" on success.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER = path.join(__dirname, '..', 'yumi-mcp-bash.cjs');
const SESSION_ID = 'test-session';
const STREAM_FILE = path.join(os.tmpdir(), `yumi-test-stream-${process.pid}.log`);

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL: ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

// --- JSON-RPC client over the child's stdio ---------------------------------

const child = spawn(process.execPath, [
  SERVER,
  `--session-id=${SESSION_ID}`,
  `--stream-file=${STREAM_FILE}`,
], { stdio: ['pipe', 'pipe', 'pipe'] });

// Surface server stderr (debug logs) only if something goes wrong; keep quiet otherwise.
let stderrBuf = '';
child.stderr.on('data', (d) => { stderrBuf += d.toString(); });

child.on('error', (err) => {
  console.error('FATAL: failed to spawn server:', err.message);
  process.exit(1);
});

// Robust line-reader: buffer stdout, split on \n, dispatch each JSON line by id.
const pending = new Map(); // id -> {resolve, reject}
let rxBuf = '';
child.stdout.on('data', (chunk) => {
  rxBuf += chunk.toString();
  let nl;
  while ((nl = rxBuf.indexOf('\n')) >= 0) {
    const line = rxBuf.slice(0, nl);
    rxBuf = rxBuf.slice(nl + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  }
});

let nextId = 1;
function rpc(method, params, { timeoutMs = 30000 } = {}) {
  const id = nextId++;
  const req = { jsonrpc: '2.0', id, method };
  if (params !== undefined) req.params = params;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`RPC timeout for ${method} (id ${id})`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (m) => { clearTimeout(t); resolve(m); },
      reject: (e) => { clearTimeout(t); reject(e); },
    });
    child.stdin.write(JSON.stringify(req) + '\n');
  });
}

function notify(method, params) {
  const req = { jsonrpc: '2.0', method };
  if (params !== undefined) req.params = params;
  child.stdin.write(JSON.stringify(req) + '\n');
}

// callTool returns the text content + isError of a tools/call result.
async function callTool(name, args, opts) {
  const resp = await rpc('tools/call', { name, arguments: args || {} }, opts);
  if (resp.error) return { error: resp.error };
  const text = (resp.result && resp.result.content && resp.result.content[0] && resp.result.content[0].text) || '';
  return { text, isError: !!(resp.result && resp.result.isError) };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// --- Test sequence -----------------------------------------------------------

async function main() {
  // 1. initialize
  console.log('\n[1] initialize');
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  });
  ok('initialize returns protocolVersion 2024-11-05',
    init.result && init.result.protocolVersion === '2024-11-05',
    JSON.stringify(init.result));
  ok('serverInfo.name is "yumi"',
    init.result && init.result.serverInfo && init.result.serverInfo.name === 'yumi',
    init.result && init.result.serverInfo && JSON.stringify(init.result.serverInfo));

  notify('notifications/initialized');

  // 2. tools/list — exactly 5 tools with exact names
  console.log('\n[2] tools/list');
  const list = await rpc('tools/list', {});
  const tools = (list.result && list.result.tools) || [];
  const names = tools.map((t) => t.name);
  const expected = ['RunBash', 'ListBackgroundProcesses', 'CancelBackgroundProcess', 'CancelAllBackgroundProcesses', 'AskUserQuestion'];
  ok('tools/list returns exactly 5 tools', tools.length === 5, `got ${tools.length}: ${names.join(', ')}`);
  ok('tools have exact expected names',
    expected.every((n) => names.includes(n)) && names.length === expected.length,
    `got: ${names.join(', ')}`);

  // 3. RunBash echo
  console.log('\n[3] RunBash echo hello-yumi');
  const echo = await callTool('RunBash', { command: 'echo hello-yumi' });
  ok('RunBash echo output contains "hello-yumi"',
    typeof echo.text === 'string' && echo.text.includes('hello-yumi'),
    JSON.stringify(echo));

  // 4. cwd tracking persists across calls
  console.log('\n[4] cwd tracking: cd .. && pwd, then pwd');
  const pwd1 = await callTool('RunBash', { command: 'pwd' });
  const cdpwd = await callTool('RunBash', { command: 'cd .. && pwd' });
  const pwd2 = await callTool('RunBash', { command: 'pwd' });
  const before = (pwd1.text || '').trim();
  const afterCd = (cdpwd.text || '').trim();
  const afterPwd = (pwd2.text || '').trim();
  console.log(`      pwd before:   ${before}`);
  console.log(`      cd .. && pwd: ${afterCd}`);
  console.log(`      pwd after:    ${afterPwd}`);
  // Normalize to compare regardless of /c/ vs C:/ representation, just check it changed
  // and that the persisted pwd equals the dir reported right after the cd.
  ok('cwd changed after cd ..', afterPwd && afterPwd !== before, `before=${before} after=${afterPwd}`);
  ok('second pwd reflects persisted cd', afterPwd === afterCd, `cdpwd=${afterCd} pwd2=${afterPwd}`);

  // 5. redirection works + STREAM_FILE got written
  console.log('\n[5] redirection + stream file written');
  // Run a command that produces several lines of output so the stream file is populated.
  const redir = await callTool('RunBash', { command: 'echo a > /dev/null; echo done' });
  ok('redirection command works (output "done")',
    (redir.text || '').includes('done'), JSON.stringify(redir));
  // The stream file is written batched (<=150ms). Give it a moment to flush, then check.
  let streamOk = false;
  let streamSize = 0;
  for (let i = 0; i < 20; i++) {
    try {
      const st = fs.statSync(STREAM_FILE);
      streamSize = st.size;
      if (st.size > 0) { streamOk = true; break; }
    } catch {}
    await sleep(100);
  }
  ok('STREAM_FILE was written (non-empty)', streamOk, `size=${streamSize} path=${STREAM_FILE}`);

  // 6. background process
  console.log('\n[6] background process + list');
  const bg = await callTool('RunBash', { command: 'echo bg', run_in_background: true });
  const bgIdMatch = (bg.text || '').match(/bg-\d+/);
  ok('background returns a bg- id', !!bgIdMatch, JSON.stringify(bg));
  ok('background returns start message',
    /Background process started/.test(bg.text || ''), JSON.stringify(bg));
  // Give the bg entry a moment to be written to bg-processes.json.
  await sleep(300);
  const bgList = await callTool('ListBackgroundProcesses', {});
  const bgId = bgIdMatch ? bgIdMatch[0] : '__none__';
  ok('ListBackgroundProcesses lists the bg id',
    (bgList.text || '').includes(bgId), `looking for ${bgId} in: ${bgList.text}`);

  // --- summary ---
  console.log('\n----------------------------------------');
  console.log(`Assertions passed: ${passed}, failed: ${failed}`);
  if (failed > 0) {
    console.log('Failed assertions:', failures.join('; '));
    console.log('\n--- server stderr (last 2KB) ---');
    console.log(stderrBuf.slice(-2048));
  }
}

main()
  .then(async () => {
    // Clean shutdown: close stdin so the server exits and cleans up its stream file.
    try { child.stdin.end(); } catch {}
    await sleep(500);
    try { child.kill(); } catch {}
    try { if (fs.existsSync(STREAM_FILE)) fs.unlinkSync(STREAM_FILE); } catch {}
    if (failed === 0) {
      console.log('\nALL TESTS PASSED');
      process.exit(0);
    } else {
      console.log('\nTESTS FAILED');
      process.exit(1);
    }
  })
  .catch(async (err) => {
    console.error('\nTEST HARNESS ERROR:', err.message);
    console.error('--- server stderr (last 2KB) ---');
    console.error(stderrBuf.slice(-2048));
    try { child.stdin.end(); } catch {}
    try { child.kill(); } catch {}
    try { if (fs.existsSync(STREAM_FILE)) fs.unlinkSync(STREAM_FILE); } catch {}
    process.exit(1);
  });
