#!/usr/bin/env node
/**
 * Yumi MCP Bash Server
 *
 * MCP server that provides a Bash tool with real-time output streaming.
 * Replaces Claude's built-in Bash tool to enable live output display in Yumi.
 *
 * Features:
 * - Real-time streaming via file (same as bash_intercept monitor)
 * - Same interface as Claude's built-in Bash tool
 * - Timeout support (default: 15 min, max: 20 min)
 * - Working directory tracking
 * - Cross-platform support (bash on Unix; Git Bash preferred on Windows,
 *   PowerShell only for cmdlets/$env: syntax or when Git Bash is absent)
 * - Background execution support
 *
 * Communication:
 * - MCP protocol via stdio (JSON-RPC 2.0)
 * - Streaming output via YUMI_STREAM_FILE (monitored by bash_intercept)
 *
 * Claude CLI Bash Tool Parameters (from documentation):
 * - command: string - The bash command to run (required unless restart=true)
 * - restart: boolean - Set to true to restart the bash session
 * - timeout: number - Optional timeout in milliseconds (0 or omit = no timeout)
 * - description: string - Description of what the command does
 * - run_in_background: boolean - Run command in background
 */

const { spawn, execSync } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Parse args first (more reliable than env - Claude CLI always passes args)
let argSessionId = null;
let argStreamFile = null;
for (const arg of process.argv) {
  if (arg.startsWith('--session-id=')) argSessionId = arg.slice('--session-id='.length);
  if (arg.startsWith('--stream-file=')) argStreamFile = arg.slice('--stream-file='.length);
}

// Configuration from args (preferred) then environment (fallback)
// SEC[Node L6] / [Node H7] require Tauri to pass a valid SESSION_ID. Refusing to
// fall back to 'default' prevents two unrelated sessions colliding on the same
// stream file (which would leak bash output across sessions). Validating the
// shape blocks path traversal via SESSION_ID (it's used as a filename).
const _candidateSessionId = argSessionId || process.env.YUMI_SESSION_ID;
if (!_candidateSessionId || typeof _candidateSessionId !== 'string') {
  console.error('[yumi-mcp-bash] FATAL: SESSION_ID is required (--session-id=<id> or YUMI_SESSION_ID env)');
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{1,128}$/.test(_candidateSessionId)) {
  console.error('[yumi-mcp-bash] FATAL: invalid session id (must match [A-Za-z0-9_-]{1,128}):', _candidateSessionId);
  process.exit(1);
}
const SESSION_ID = _candidateSessionId;
const STREAM_FILE = argStreamFile || process.env.YUMI_STREAM_FILE || path.join(os.tmpdir(), `yumi-bash-${SESSION_ID}.log`);
// Guard against pkg virtual cwd (C:\snapshot\...) — validate path exists on disk
const _rawCwd = process.env.YUMI_WORKING_DIR || process.cwd();
const WORKING_DIR = (require('fs').existsSync(_rawCwd) ? _rawCwd : path.join(os.homedir(), '.yumi'));
const DEFAULT_TIMEOUT = 900_000; // 15 min default
const MAX_TIMEOUT = 1_200_000; // 20 min hard cap
const IS_WINDOWS = os.platform() === 'win32';

// Track the currently running foreground process so cleanup() can kill it.
// Only one foreground command runs at a time (MCP is sequential).
let activeForegroundProc = null;

// Detect python3 with pty module at startup (for PTY-based streaming on Unix).
// PTY forces line-buffered output for all programs in a pipeline, ensuring
// real-time streaming instead of block-buffered output that only arrives on exit.
// Without PTY, commands like `npm test 2>&1 | tail -20` accumulate in a 4-64KB
// pipe buffer and only display output when the process finishes.
let hasPython3Pty = false;
if (!IS_WINDOWS) {
  try {
    execSync('python3 -c "import pty"', { stdio: 'ignore', timeout: 3000, windowsHide: true });
    hasPython3Pty = true;
  } catch {
    // python3 or pty module not available — try fallbacks below
  }
}

// Fallback 1: macOS `script` command allocates a real PTY (built-in, no deps).
// `script -q /dev/null bash -c CMD` runs CMD in a PTY with line-buffered output.
let hasScriptPty = false;
if (!IS_WINDOWS && !hasPython3Pty && os.platform() === 'darwin') {
  hasScriptPty = fs.existsSync('/usr/bin/script');
}

// Fallback 2: `stdbuf -oL` forces line-buffered stdout via LD_PRELOAD (Linux coreutils).
// Works for dynamically linked programs. macOS equivalent is `gstdbuf` from Homebrew.
let hasStdbuf = false;
let stdbufCmd = 'stdbuf';
if (!IS_WINDOWS && !hasPython3Pty && !hasScriptPty) {
  for (const cmd of ['stdbuf', 'gstdbuf']) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 3000, windowsHide: true });
      hasStdbuf = true;
      stdbufCmd = cmd;
      break;
    } catch {}
  }
}

// Python script that wraps a command in a PTY for line-buffered streaming.
// sys.argv[1] = shell path, sys.argv[2] = command (avoids quoting issues).
const PTY_WRAPPER_SCRIPT = 'import pty,sys,os;s=pty.spawn([sys.argv[1],"-c",sys.argv[2]]);sys.exit(os.WEXITSTATUS(s) if os.WIFEXITED(s) else 1)';

// Parse bash allow/deny rules from args or env
let argBashRules = null;
for (const arg of process.argv) {
  if (arg.startsWith('--bash-rules=')) argBashRules = arg.slice('--bash-rules='.length);
}

// Load Bash(...) DENY rules from Claude Code settings files.
// NOTE: We intentionally skip ALLOW rules from Claude Code settings.
// Claude CLI writes per-command allow patterns (e.g. "Bash(npm run build:*)")
// to settings.local.json when the user approves commands. These are meant for
// Claude's built-in Bash tool permission system, NOT for the MCP replacement.
// Loading them here turns them into an unintended whitelist that blocks
// everything else. Only deny rules are security-relevant and should be inherited.
// Allow rules for the MCP bash tool come only from Yumi's UI (--bash-rules).
function loadClaudeCodeBashRules() {
  const rules = { allow: [], deny: [] };
  const homeDir = os.homedir();
  const settingsFiles = [
    path.join(homeDir, '.claude', 'settings.json'),
    path.join(homeDir, '.claude', 'settings.local.json'),
    path.join(WORKING_DIR, '.claude', 'settings.json'),
    path.join(WORKING_DIR, '.claude', 'settings.local.json'),
  ];
  for (const filePath of settingsFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const settings = JSON.parse(content);
      const perms = settings.permissions;
      if (!perms) continue;
      // Only load DENY rules (security restrictions)
      if (Array.isArray(perms.deny)) {
        for (const rule of perms.deny) {
          if (typeof rule === 'string' && rule.startsWith('Bash(') && !rules.deny.includes(rule)) {
            rules.deny.push(rule);
          }
        }
      }
      // Treat "ask" as deny — MCP bash cannot prompt interactively
      if (Array.isArray(perms.ask)) {
        for (const rule of perms.ask) {
          if (typeof rule === 'string' && rule.startsWith('Bash(') && !rules.deny.includes(rule)) {
            rules.deny.push(rule);
          }
        }
      }
    } catch (e) { /* file missing or parse error — skip */ }
  }
  return rules;
}

// Merge rules from Claude Code settings + Yumi UI (--bash-rules arg)
let bashRules = { allow: [], deny: [] };
const claudeCodeRules = loadClaudeCodeBashRules();
try {
  const rulesJson = argBashRules || process.env.YUMI_BASH_RULES;
  if (rulesJson) {
    const parsed = JSON.parse(rulesJson);
    bashRules.allow = Array.isArray(parsed.allow) ? parsed.allow : [];
    bashRules.deny = Array.isArray(parsed.deny) ? parsed.deny : [];
  }
} catch (e) { /* ignore parse errors */ }
bashRules.deny = [...new Set([...bashRules.deny, ...claudeCodeRules.deny])];
bashRules.allow = [...new Set([...bashRules.allow, ...claudeCodeRules.allow])];

// Convert a Bash(pattern) rule to a RegExp.
// Supports Claude Code formats:
//   Bash(docker run:*)  — colon separator (prefix match)
//   Bash(npm *)         — space wildcard
//   Bash(* install)     — leading wildcard
//   Bash(git * main)    — middle wildcard
//   Bash(*)             — match all
function bashRuleToRegex(rule) {
  if (rule === 'Bash' || rule === 'Bash(*)') {
    return new RegExp('^.*$');
  }
  const m = rule.match(/^Bash\((.*)\)$/);
  if (!m) return null;
  let pattern = m[1];
  // Claude Code colon syntax: "Bash(cmd:*)" means "cmd" optionally followed by anything
  // The colon is a separator token (not literal). Replace `:*` with just `*`
  // so "heroku --version:*" matches "heroku --version" and "heroku --version --json"
  pattern = pattern.replace(/:(\*)/g, '$1');
  // Escape regex special chars except *, then replace * with .*
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + '$');
}

// SEC[Node M1] strip heredoc bodies before subcommand splitting.
// Without this, `cat <<'EOF'\nrm -rf /\nEOF` slipped past the `rm -rf` rule
// because the heredoc body contained newlines that splitSubcommands matched
// against rules like `cat`. Replace the entire body+terminator with a single
// placeholder so only the heredoc-introducing command (e.g. `cat`) is rule-checked,
// AND any `eval`/`bash` consumer of the body is still caught upstream.
function stripHeredocs(cmd) {
  if (typeof cmd !== 'string') return cmd;
  // Match `<<` or `<<-`, optional quoted/unquoted delimiter, body, then the same
  // delimiter on its own line. The delimiter must be word chars only.
  return cmd.replace(/<<-?\s*['"]?(\w+)['"]?\n[\s\S]*?\n\1\b/g, '<<HEREDOC_REDACTED>>');
}

// Split a compound command into individual subcommands for rule checking.
// Handles: newlines, &&, ||, ;, single pipes, and $() substitutions (basic).
function splitSubcommands(command) {
  // SEC[Node M1] strip heredoc bodies first so they don't get split into rules.
  const cleaned = stripHeredocs(command);
  return cleaned
    .split(/\n|&&|\|\||(?<!\|)\|(?!\|)|;/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// PERF: Pre-compile bash rules once after the merge above. Previously every
// checkBashRules call rebuilt every RegExp for every rule, on every tool invocation.
const compiledBashRules = {
  allow: bashRules.allow.map(rule => ({ rule, re: bashRuleToRegex(rule) })).filter(x => x.re),
  deny: bashRules.deny.map(rule => ({ rule, re: bashRuleToRegex(rule) })).filter(x => x.re),
};

// Check command against bash rules. Returns null if allowed, error string if denied.
function checkBashRules(command) {
  const subcommands = splitSubcommands(command);
  // Check deny rules — any subcommand matching a deny rule blocks the entire command
  for (const { rule, re } of compiledBashRules.deny) {
    for (const sub of subcommands) {
      if (re.test(sub)) {
        return `Command denied by rule: ${rule}`;
      }
    }
  }
  // If allow rules exist, every subcommand must match at least one allow rule
  if (compiledBashRules.allow.length > 0) {
    for (const sub of subcommands) {
      let allowed = false;
      for (const { re } of compiledBashRules.allow) {
        if (re.test(sub)) { allowed = true; break; }
      }
      if (!allowed) {
        // Show only rules that actually take effect (compiled successfully).
        const effective = compiledBashRules.allow.map(x => x.rule).join(', ');
        return `Command not in allow list: "${sub}". Allowed: ${effective}`;
      }
    }
  }
  return null; // no allow rules = everything allowed
}

// Censor secrets/tokens/passwords in strings before logging or storing
// SEC[Node M4] expanded coverage:
//  - explicit provider env-var prefixes (OPENAI_*, GEMINI_*, GH_*, AWS_*, STRIPE_*,
//    GOOGLE_*, KIRO_*, ANTHROPIC_*) so anything like `OPENAI_API_KEY=sk-... cmd`
//    is censored even though the var name doesn't itself contain "KEY".
//  - short single-letter flags `-p`/`-k`/`-t` (followed by their value) which
//    legacy patterns missed.
function censorSecrets(str) {
  if (!str) return str;
  const SECRET_VAR_RE = /\b(API_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH(?![a-z])|BEARER|OPENAI_[A-Z_]+|GEMINI_[A-Z_]+|GH_[A-Z_]+|AWS_[A-Z_]+|STRIPE_[A-Z_]+|GOOGLE_[A-Z_]+|KIRO_[A-Z_]+|ANTHROPIC_[A-Z_]+)=(\S+)/gi;
  return str
    .replace(/(\b\w*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH(?![a-z])|BEARER)\w*\s*=\s*)(\S+)/gi, '$1****')
    .replace(SECRET_VAR_RE, '$1=****')
    .replace(/(--(?:\w*[-_])?(?:key|secret|token|password|credential|auth|bearer)(?:[-_]\w*)?)[=\s]+(\S+)/gi, '$1 ****')
    .replace(/(\s|^)(-[pkt])(\s+)(\S+)/g, '$1$2$3****')
    .replace(/(Bearer\s+)(\S+)/gi, '$1****');
}

// Build enriched PATH to find tools like npm, node, etc.
// GUI apps on macOS/Linux often get a minimal PATH missing user tools
function buildRichPath() {
  const currentPath = process.env.PATH || '';
  const home = os.homedir();
  const sep = IS_WINDOWS ? ';' : ':';
  const existing = new Set(currentPath.split(sep));
  const extra = [];

  if (IS_WINDOWS) {
    const appdata = process.env.APPDATA;
    const localappdata = process.env.LOCALAPPDATA;
    const userprofile = process.env.USERPROFILE;
    if (appdata) {
      const npmDir = path.join(appdata, 'npm');
      if (fs.existsSync(npmDir)) extra.push(npmDir);
    }
    if (localappdata) {
      const voltaDir = path.join(localappdata, 'Volta', 'bin');
      if (fs.existsSync(voltaDir)) extra.push(voltaDir);
      if (process.env.FNM_MULTISHELL_PATH) extra.push(process.env.FNM_MULTISHELL_PATH);
    }
    if (userprofile) {
      const pnpmDir = path.join(userprofile, 'AppData', 'Local', 'pnpm');
      if (fs.existsSync(pnpmDir)) extra.push(pnpmDir);
    }
    // Git for Windows — add bin and usr/bin so Unix utilities are available
    for (const pfVar of ['PROGRAMFILES', 'PROGRAMFILES(X86)']) {
      const pf = process.env[pfVar];
      if (pf) {
        const gitBin = path.join(pf, 'Git', 'bin');
        if (fs.existsSync(gitBin)) extra.push(gitBin);
        const gitUsrBin = path.join(pf, 'Git', 'usr', 'bin');
        if (fs.existsSync(gitUsrBin)) extra.push(gitUsrBin);
      }
    }
  } else {
    // nvm
    if (process.env.NVM_BIN) {
      extra.push(process.env.NVM_BIN);
    } else {
      const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm');
      const nvmVersions = path.join(nvmDir, 'versions', 'node');
      try {
        const defaultAlias = path.join(nvmDir, 'alias', 'default');
        const version = fs.readFileSync(defaultAlias, 'utf8').trim();
        const entries = fs.readdirSync(nvmVersions).sort().reverse();
        for (const entry of entries) {
          if (entry.startsWith('v' + version) || entry.includes(version)) {
            const binPath = path.join(nvmVersions, entry, 'bin');
            if (fs.existsSync(binPath)) { extra.push(binPath); break; }
          }
        }
      } catch {
        // No default alias - try latest version
        try {
          const entries = fs.readdirSync(nvmVersions).sort().reverse();
          if (entries.length > 0) {
            const binPath = path.join(nvmVersions, entries[0], 'bin');
            if (fs.existsSync(binPath)) extra.push(binPath);
          }
        } catch { /* nvm not installed */ }
      }
    }

    // fnm
    if (process.env.FNM_MULTISHELL_PATH) {
      extra.push(path.join(process.env.FNM_MULTISHELL_PATH, 'bin'));
    } else {
      const fnmDir = path.join(home, '.local', 'share', 'fnm', 'node-versions');
      try {
        const entries = fs.readdirSync(fnmDir).sort().reverse();
        if (entries.length > 0) {
          const binPath = path.join(fnmDir, entries[0], 'installation', 'bin');
          if (fs.existsSync(binPath)) extra.push(binPath);
        }
      } catch { /* fnm not installed */ }
    }

    // Homebrew (macOS ARM + Intel, Linux)
    for (const dir of ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin',
                        '/home/linuxbrew/.linuxbrew/bin', '/home/linuxbrew/.linuxbrew/sbin']) {
      if (fs.existsSync(dir)) extra.push(dir);
    }

    // Volta
    const voltaBin = path.join(home, '.volta', 'bin');
    if (fs.existsSync(voltaBin)) extra.push(voltaBin);

    // asdf
    const asdfShims = path.join(home, '.asdf', 'shims');
    if (fs.existsSync(asdfShims)) extra.push(asdfShims);
    const asdfBin = path.join(home, '.asdf', 'bin');
    if (fs.existsSync(asdfBin)) extra.push(asdfBin);

    // mise
    const miseShims = path.join(home, '.local', 'share', 'mise', 'shims');
    if (fs.existsSync(miseShims)) extra.push(miseShims);

    // proto
    const protoShims = path.join(home, '.proto', 'shims');
    if (fs.existsSync(protoShims)) extra.push(protoShims);
    const protoBin = path.join(home, '.proto', 'bin');
    if (fs.existsSync(protoBin)) extra.push(protoBin);

    // User local bins
    for (const dir of [path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin'), path.join(home, 'bin')]) {
      if (fs.existsSync(dir)) extra.push(dir);
    }

    // pnpm
    const pnpmHome = process.env.PNPM_HOME || path.join(home, '.local', 'share', 'pnpm');
    if (fs.existsSync(pnpmHome)) extra.push(pnpmHome);

    // bun
    const bunBin = path.join(home, '.bun', 'bin');
    if (fs.existsSync(bunBin)) extra.push(bunBin);

    // yarn
    const yarnBin = path.join(home, '.yarn', 'bin');
    if (fs.existsSync(yarnBin)) extra.push(yarnBin);

    // cargo
    const cargoBin = path.join(home, '.cargo', 'bin');
    if (fs.existsSync(cargoBin)) extra.push(cargoBin);

    // go
    const goBin = path.join(home, 'go', 'bin');
    if (fs.existsSync(goBin)) extra.push(goBin);

    // snap
    if (fs.existsSync('/snap/bin')) extra.push('/snap/bin');
  }

  const newDirs = extra.filter(d => !existing.has(d));
  if (newDirs.length === 0) return currentPath;
  return newDirs.join(sep) + sep + currentPath;
}

// Track persistent bash session state
let currentWorkingDir = WORKING_DIR;
let shellEnv = { ...process.env };
shellEnv.PATH = buildRichPath();
if (!shellEnv.TERM) shellEnv.TERM = 'xterm-256color';
shellEnv.GIT_PAGER = 'cat';
shellEnv.GIT_TERMINAL_PROMPT = '0';
// Force unbuffered output for Python scripts (even without PTY)
shellEnv.PYTHONUNBUFFERED = '1';

// Stream file handle for output
let streamFd = null;

// Debug logging to stderr (doesn't interfere with MCP protocol)
function log(...args) {
  console.error('[yumi-mcp-bash]', new Date().toISOString(), ...args);
}

// Initialize stream file for output
function initStreamFile() {
  try {
    // Ensure parent directory exists
    const dir = path.dirname(STREAM_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Open in append mode
    streamFd = fs.openSync(STREAM_FILE, 'a');
    log(`Stream file initialized: ${STREAM_FILE}`);
  } catch (err) {
    log(`Warning: Could not open stream file: ${err.message}`);
  }
}

// Batched stream file writes to reduce event loop blocking on Windows.
// Per-line writeSync triggers kernel page-fault handling on each 4KB block boundary
// and AV filter callbacks on file access. Batching accumulates output for up to 150ms
// and writes it all at once, reducing writeSync calls from ~100/sec to ~7/sec during
// heavy output (npm install, compiler, find).
// PERF: Use chunk array + join instead of repeated `+=` string append.
// String concatenation on every line is O(n^2) under V8 because the buffer
// is reallocated each time; an array push is O(1) and the single join at
// flush time is O(total_size).
let streamWriteChunks = [];
let streamWriteBufferLen = 0;
let streamWriteTimer = null;
const STREAM_BATCH_MS = 150;

function flushStreamBuffer() {
  streamWriteTimer = null;
  if (streamFd !== null && streamWriteBufferLen > 0) {
    const payload = streamWriteChunks.join('');
    streamWriteChunks = [];
    streamWriteBufferLen = 0;
    try {
      fs.writeSync(streamFd, payload);
    } catch (err) {
      // File write failed, continue anyway
    }
  }
}

function emitBashOutput(line) {
  if (streamFd !== null) {
    const piece = line + '\n';
    streamWriteChunks.push(piece);
    streamWriteBufferLen += piece.length;
    // Flush immediately if buffer is large (>32KB) to prevent memory buildup
    if (streamWriteBufferLen > 32768) {
      if (streamWriteTimer) { clearTimeout(streamWriteTimer); streamWriteTimer = null; }
      flushStreamBuffer();
    } else if (!streamWriteTimer) {
      streamWriteTimer = setTimeout(flushStreamBuffer, STREAM_BATCH_MS);
    }
  }
}

// Force-flush any pending stream writes (call before closing streamFd).
// Skip on Windows — fsync triggers AV filter driver callbacks
// (NtFlushBuffersFile) causing severe system-wide lag. The Rust reader
// sees uncommitted writes on the same OS without fsync.
function flushStreamSync() {
  if (streamWriteTimer) { clearTimeout(streamWriteTimer); streamWriteTimer = null; }
  flushStreamBuffer(); // drain any buffered output first
  if (streamFd !== null && !IS_WINDOWS) {
    try { fs.fsyncSync(streamFd); } catch {}
  }
}

// Background process tracking file
const BG_PROCESSES_FILE = path.join(os.homedir(), '.yumi', 'bg-processes.json');

function readBgProcesses() {
  try {
    if (fs.existsSync(BG_PROCESSES_FILE)) {
      return JSON.parse(fs.readFileSync(BG_PROCESSES_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return [];
}

function writeBgProcesses(processes) {
  try {
    const dir = path.dirname(BG_PROCESSES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Atomic write: temp file + rename to prevent corruption from concurrent reads
    const tmp = BG_PROCESSES_FILE + `.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(processes, null, 2));
    fs.renameSync(tmp, BG_PROCESSES_FILE);
  } catch (e) {
    log('Failed to write bg processes file:', e.message);
  }
}

function addBgProcess(entry) {
  const processes = readBgProcesses();
  processes.push(entry);
  writeBgProcesses(processes);
}

function updateBgProcess(id, updates) {
  const processes = readBgProcesses();
  const idx = processes.findIndex(p => p.id === id);
  if (idx >= 0) {
    Object.assign(processes[idx], updates);
    writeBgProcesses(processes);
  }
}

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  // process.kill(pid, 0) works cross-platform (including Windows) to check
  // if a process exists without sending a signal. No subprocess spawn needed.
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = process exists but owned by another user (Unix only)
    return e.code === 'EPERM';
  }
}

function sleepMs(ms) {
  // Blocking sleep without busy-wait CPU burn
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function killProcessTree(pid) {
  if (!pid || pid <= 0) return false;
  if (IS_WINDOWS) {
    // Use wmic to enumerate child processes, then terminate via process.kill().
    // Avoids spawning taskkill.exe which can trigger AV heuristics (consistent
    // with win_process.rs approach in the Rust backend).
    try {
      const childPids = [];
      try {
        const wmicOut = execSync(
          `wmic process where (ParentProcessId=${Number(pid)}) get ProcessId /format:list`,
          { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, encoding: 'utf-8', timeout: 5000 }
        );
        for (const line of wmicOut.split('\n')) {
          const m = line.match(/ProcessId=(\d+)/);
          if (m) childPids.push(parseInt(m[1], 10));
        }
      } catch { /* wmic may fail if process already exited */ }
      for (const childPid of childPids) {
        try { process.kill(childPid, 'SIGTERM'); } catch {}
      }
      try { process.kill(pid, 'SIGTERM'); } catch {}
      return true;
    } catch {
      return false;
    }
  }
  try { process.kill(-pid, 'SIGTERM'); } catch {}
  try { process.kill(pid, 'SIGTERM'); } catch {}
  sleepMs(200);
  if (isPidAlive(pid)) {
    try { process.kill(-pid, 'SIGKILL'); } catch {}
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  return true;
}

function killBgProcessById(id) {
  const processes = readBgProcesses();
  const proc = processes.find(p => p.id === id);
  if (!proc) {
    return { output: `Error: Process ${id} not found`, isError: true };
  }
  if (proc.status !== 'running') {
    return { output: `Process ${id} is not running (status: ${proc.status})`, isError: false };
  }
  if (!proc.pid || proc.pid === 0) {
    proc.status = 'killed';
    proc.completedAt = Date.now();
    writeBgProcesses(processes);
    return { output: `Marked process ${id} as killed (pid unavailable)`, isError: false };
  }
  killProcessTree(proc.pid);
  proc.status = 'killed';
  proc.completedAt = Date.now();
  writeBgProcesses(processes);
  return { output: `Killed process ${id} (PID ${proc.pid})`, isError: false };
}

function killAllBgProcesses() {
  const processes = readBgProcesses();
  let killed = 0;
  for (const proc of processes) {
    if (proc.status !== 'running') continue;
    if (!proc.pid || proc.pid === 0) {
      proc.status = 'killed';
      proc.completedAt = Date.now();
      killed += 1;
      continue;
    }
    killProcessTree(proc.pid);
    proc.status = 'killed';
    proc.completedAt = Date.now();
    killed += 1;
  }
  writeBgProcesses(processes);
  return { output: `Killed ${killed} background process(es)`, isError: false };
}

let _cachedGitBash = undefined; // undefined = not probed yet, null = not found
function findGitBash() {
  if (_cachedGitBash !== undefined) return _cachedGitBash;
  const candidates = [];
  // Check env vars first (locale-independent, handles custom install locations)
  for (const v of ['PROGRAMFILES', 'PROGRAMFILES(X86)']) {
    const pf = process.env[v];
    if (pf) {
      candidates.push(path.join(pf, 'Git', 'bin', 'bash.exe'));
      candidates.push(path.join(pf, 'Git', 'usr', 'bin', 'bash.exe'));
    }
  }
  // Hardcoded fallbacks
  candidates.push(
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe'
  );
  for (const p of candidates) {
    if (p && fs.existsSync(p)) { _cachedGitBash = p; return p; }
  }
  _cachedGitBash = null;
  return null;
}

let _cachedPowerShell = undefined;
function findPowerShell() {
  if (_cachedPowerShell !== undefined) return _cachedPowerShell;
  try {
    require('child_process').execSync('pwsh -Version', { stdio: 'pipe', timeout: 5000, windowsHide: true });
    _cachedPowerShell = 'pwsh';
    return _cachedPowerShell;
  } catch {}
  _cachedPowerShell = 'powershell.exe';
  return _cachedPowerShell;
}

// Detect commands that need PowerShell instead of bash.
// Returns true for PowerShell-specific syntax that would fail in bash.
//
// A *bash* command may legitimately embed a PowerShell sub-invocation, e.g.
//   powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object {...}"
// which is exactly the idiom we recommend for Windows-only logic. Cmdlet names that
// live inside quotes or inside such an embedded call must NOT route the whole command
// to PowerShell — otherwise PowerShell receives the bash wrapper (&&, $(...),
// >/dev/null, name() {...}, \$ escaping) and errors out. So we blank those regions
// out before scanning for top-level PowerShell syntax.
function isPowerShellCommand(command) {
  const trimmed = command.trim();
  // Leading pwsh/powershell invocation → run via Git Bash, which execs powershell.exe.
  if (/^(pwsh|powershell)(\.exe)?\s/i.test(trimmed)) return false;

  const scan = trimmed
    // 1. quoted strings — a cmdlet inside -Command "..." or '...' is the child's, not ours
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ')
    .replace(/'[^']*'/g, ' ')
    // 2. an embedded `powershell|pwsh -Flag ...` sub-invocation and everything after it;
    //    its cmdlet arguments belong to PowerShell-the-child, not the bash parent.
    .replace(/\b(?:pwsh|powershell)(?:\.exe)?\s+-\w[\s\S]*$/i, ' ');

  if (/\$env:/i.test(scan)) return true;
  // Cmdlet must sit at a command HEAD — start of string, or right after a
  // statement/pipeline separator (| ; & ( { = backtick newline) — so a Verb-Noun
  // shape that is merely a bash ARGUMENT (e.g. `git log --grep Set-Up`,
  // `npm run Test-Path`, `git commit -m Add-Feature`) does NOT mis-route the
  // whole command to PowerShell. Genuine cmdlets (`Get-Process`, `... | Where-Object`,
  // `$x = Get-Date`, `(Invoke-RestMethod ...)`, bare `Remove-Item foo`) still match.
  if (/(?:^|[|;&({=`\n])\s*(?:Get|Set|New|Remove|Invoke|Write|Read|Test|Start|Stop|Select|Where|ForEach|Sort|Group|Measure|Compare|ConvertTo|ConvertFrom|Export|Import|Add|Clear|Copy|Move|Rename|Update|Enable|Disable|Register|Unregister)-[A-Z]\w+\b/.test(scan)) return true;
  return false;
}

// Convert Windows backslash paths to forward-slash for Git Bash / MSYS2.
// C:\Users\muuko → C:/Users/muuko (Git Bash auto-translates C:/ to /c/)
function normalizeWindowsPathsForBash(command) {
  // 1. Quoted paths: "C:\Program Files\Git" or 'C:\path'
  let result = command.replace(
    /(['"])([A-Za-z]):\\((?:(?!\1).)*)\1/g,
    (match, quote, drive, rest) => {
      return `${quote}${drive}:/${rest.replace(/\\/g, '/')}${quote}`;
    }
  );
  // 2. Unquoted paths: C:\Users\muuko (must not be preceded by a letter to avoid matching inside words)
  result = result.replace(
    /(?<![A-Za-z])([A-Za-z]):\\([^\s'"`;|&<>]*)/g,
    (match, drive, rest) => {
      return `${drive}:/${rest.replace(/\\/g, '/')}`;
    }
  );
  return result;
}

// Find the index of the first real pipe operator in a command string.
// Skips || (logical OR), |& (pipe stderr), pipes inside quotes/parens,
// and anything inside a heredoc body (cat << 'EOF' ... EOF).
// Returns -1 if no pipe found.
function findFirstPipeIndex(cmd) {
  let inSingle = false, inDouble = false, escaped = false;
  let parenDepth = 0;
  let heredocDelimiter = null; // non-null means we're inside a heredoc body
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];

    // If we're inside a heredoc body, skip everything until we find the
    // delimiter on a line by itself. Heredoc content can contain |, quotes,
    // etc. that must not be interpreted as shell syntax.
    if (heredocDelimiter) {
      // Check if this position starts a line that is exactly the delimiter
      // (possibly preceded by a newline or is the start after the first newline).
      const atLineStart = i === 0 || cmd[i - 1] === '\n';
      if (atLineStart) {
        const remaining = cmd.substring(i);
        // The delimiter line must be exactly the delimiter, optionally followed by \n or end-of-string
        if (remaining === heredocDelimiter ||
            remaining.startsWith(heredocDelimiter + '\n') ||
            remaining.startsWith(heredocDelimiter + '\r')) {
          i += heredocDelimiter.length - 1; // skip past delimiter (loop increments by 1)
          heredocDelimiter = null;
        }
      }
      continue;
    }

    if (escaped) { escaped = false; continue; }
    if (c === '\\' && !inSingle) { escaped = true; continue; }
    if (c === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (inSingle || inDouble) continue;

    // Detect heredoc start: << or <<- followed by optional quotes around delimiter
    if (c === '<' && cmd[i + 1] === '<' && cmd[i + 2] !== '<') {
      let j = i + 2;
      if (cmd[j] === '-') j++; // <<- strips leading tabs
      while (j < cmd.length && cmd[j] === ' ') j++; // skip whitespace
      // Extract delimiter (strip surrounding quotes if present)
      let delim = '';
      const quoteChar = cmd[j];
      if (quoteChar === "'" || quoteChar === '"') {
        j++;
        const end = cmd.indexOf(quoteChar, j);
        if (end > j) {
          delim = cmd.substring(j, end);
          j = end + 1;
        }
      } else {
        // Unquoted delimiter: word chars until whitespace/newline
        const start = j;
        while (j < cmd.length && /[A-Za-z0-9_]/.test(cmd[j])) j++;
        delim = cmd.substring(start, j);
      }
      if (delim) {
        // Skip to the newline that starts the heredoc body
        const nlIdx = cmd.indexOf('\n', j);
        if (nlIdx >= 0) {
          heredocDelimiter = delim;
          i = nlIdx; // position at newline; loop will increment to first body char
          continue;
        }
        // No newline found means the heredoc is on one line (malformed) - skip << chars
      }
    }

    if (c === '(') { parenDepth++; continue; }
    if (c === ')' && parenDepth > 0) { parenDepth--; continue; }
    if (parenDepth > 0) continue;
    if (c === '|') {
      // Skip || (logical OR) and |& (pipe stderr)
      if (cmd[i + 1] === '|' || cmd[i + 1] === '&') continue;
      // Skip second char of || (already handled above)
      if (i > 0 && cmd[i - 1] === '|') continue;
      return i;
    }
  }
  return -1;
}

function getWindowsBackgroundShell(command) {
  if (isPowerShellCommand(command)) {
    const ps = findPowerShell();
    return { shell: ps, args: ['-NoProfile', '-NonInteractive', '-Command'], command };
  }
  const gitBash = findGitBash();
  if (gitBash) {
    return { shell: gitBash, args: ['-lc'], command: normalizeWindowsPathsForBash(command) };
  }
  const ps = findPowerShell();
  return { shell: ps, args: ['-NoProfile', '-NonInteractive', '-Command'], command };
}

// Windows `find` optimizer: auto-prune known-heavy directories.
// `find` via MSYS2/Git Bash is 10-100x slower than native Linux find because
// each syscall goes through POSIX→Win32 translation, and Windows Defender scans
// every file access. Pruning node_modules, .git, AppData, etc. (like `fd` does
// by default) avoids traversing millions of irrelevant files.
// Only basenames — `-name` matches the last path component only.
const WIN_FIND_PRUNE_DIRS = [
  'node_modules', '.git', 'AppData', '.cache', '.npm', '.nuget',
  '.rustup', '.cargo', '.m2', '.gradle', '__pycache__', '.venv',
  'venv', '.tox', '.nvm', '.vs', '.idea'
];

function optimizeFindForWindows(command) {
  if (!IS_WINDOWS) return command;
  if (!/\bfind\s+/.test(command)) return command;

  // Process each subcommand separated by ; && ||
  // This avoids breaking redirections and pipes across subcommands.
  const parts = command.split(/(;|&&|\|\|)/);
  let changed = false;
  const result = parts.map(part => {
    const trimmed = part.trim();
    if (!trimmed || /^(;|&&|\|\|)$/.test(trimmed)) return part;
    if (!/\bfind\s+/.test(trimmed)) return part;
    // Skip if this subcommand already has -maxdepth or -prune
    if (/\s-maxdepth\s/.test(trimmed) || /\s-prune\b/.test(trimmed)) return part;

    // Build a per-subcommand prune list: exclude directories that appear
    // in the command's search predicates (e.g. if searching for a path
    // inside node_modules, don't prune node_modules).
    const dirsToUse = WIN_FIND_PRUNE_DIRS.filter(d => !trimmed.includes(d));
    if (dirsToUse.length === 0) return part;

    const pruneClause = dirsToUse.map(d => `-name "${d}"`).join(' -o ');
    const pruneExpr = `\\( ${pruneClause} \\) -prune -o`;

    // Match: find <path> <rest>
    const newPart = part.replace(
      /\bfind\s+(\/\S+|~\S*|\.\S*)\s+/,
      (m, findPath) => {
        changed = true;
        return `find ${findPath} ${pruneExpr} `;
      }
    );
    return newPart;
  });
  if (changed) {
    log('Windows find optimizer: injected prune for heavy directories');
  }
  return result.join('');
}

// Get shell command based on platform
function getShellCommand(command, runInBackground = false) {
  if (IS_WINDOWS) {
    if (runInBackground) {
      return getWindowsBackgroundShell(command);
    }
    // Route PowerShell-specific commands through PowerShell directly.
    // This handles $env: variables, cmdlets (Get-ChildItem, etc.), and other
    // syntax that fails in Git Bash or cmd.exe.
    if (isPowerShellCommand(command)) {
      const ps = findPowerShell();
      return { shell: ps, args: ['-NoProfile', '-NonInteractive', '-Command'], command };
    }
    // Git Bash for bash-style commands (ls, grep, pipe, etc.):
    // Normalize Windows backslash paths (C:\path → C:/path) so Git Bash
    // doesn't strip backslashes as escape characters.
    const gitBash = findGitBash();
    if (gitBash) {
      return { shell: gitBash, args: ['-c'], command: normalizeWindowsPathsForBash(command) };
    }
    // Fallback: no Git Bash — use PowerShell (better than cmd.exe for path handling).
    const ps = findPowerShell();
    return { shell: ps, args: ['-NoProfile', '-NonInteractive', '-Command'], command };
  } else {
    // Unix: use bash, sh as fallback (cached — path doesn't change at runtime)
    if (!getShellCommand._bashPath) {
      getShellCommand._bashPath = ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash', '/opt/homebrew/bin/bash']
        .find(p => fs.existsSync(p)) || '/bin/sh';
    }
    const bashPath = getShellCommand._bashPath;
    // PTY / line-buffer wrappers for real-time streaming (foreground only).
    // Without these, programs detect stdout is a pipe and switch to 4-64KB
    // block buffering — output only arrives when the buffer fills or process exits.
    if (!runInBackground) {
      // Priority 1: python3 PTY (best — full PTY, cross-platform)
      if (hasPython3Pty) {
        return { shell: 'python3', args: ['-c', PTY_WRAPPER_SCRIPT, bashPath], command };
      }
      // Priority 2: macOS `script` command (built-in PTY allocation)
      if (hasScriptPty) {
        return { shell: '/usr/bin/script', args: ['-q', '/dev/null', bashPath, '-c'], command };
      }
      // Priority 3: stdbuf (forces line-buffered stdout via LD_PRELOAD)
      if (hasStdbuf) {
        return { shell: stdbufCmd, args: ['-oL', bashPath, '-c'], command };
      }
    }
    return { shell: bashPath, args: ['-c'], command };
  }
}

// Execute command with streaming
function executeCommand(command, timeout = DEFAULT_TIMEOUT, runInBackground = false) {
  return new Promise((resolve) => {
    let output = '';
    let outputCapped = false;
    const MAX_OUTPUT_SIZE = 2 * 1024 * 1024; // 2MB cap — prevent unbounded growth
    let timedOut = false;
    let stdoutBuf = '';
    let stderrBuf = '';
    // Optimize find commands on Windows before building the shell command
    const optimizedCommand = optimizeFindForWindows(command);
    const { shell, args, command: baseExecCommand } = getShellCommand(optimizedCommand, runInBackground);
    let execCommand = baseExecCommand;
    let bgOutputFile = null;
    let bgOutputFd = null;
    const bgId = runInBackground ? `bg-${Date.now()}` : null;

    // Transparent pipe interception: inject `tee` before the first pipe operator
    // to stream the full pre-filter output to the stream file in real-time.
    // The LLM writes: `cmd 2>&1 | tail -100`
    // We execute:      `cmd 2>&1 | tee -a '/stream/file' | tail -100`
    // Stream file gets full output (real-time), tool result gets filtered output.
    let pipeIntercepted = false;
    if (!runInBackground && streamFd !== null) {
      const pipeIdx = findFirstPipeIndex(execCommand);
      if (pipeIdx >= 0) {
        let streamPath = STREAM_FILE;
        const before = execCommand.substring(0, pipeIdx);
        const after = execCommand.substring(pipeIdx + 1);
        const shellLc = String(shell).toLowerCase();
        if (IS_WINDOWS && (shell === 'cmd.exe' || shellLc.includes('pwsh') || shellLc.includes('powershell'))) {
          // Skip tee injection for cmd.exe and PowerShell — PowerShell aliases
          // `tee` to Tee-Object (different semantics), and cmd.exe mangles quotes.
          // The stdout handler below already streams to the stream file as fallback.
        } else {
          const escapedPath = streamPath.replace(/'/g, "'\\''");
          execCommand = `${before}| tee -a '${escapedPath}' |${after}`;
        }
        pipeIntercepted = true;
        log(`Pipe intercepted: tee injected for real-time streaming`);
      }
    }

    log(`Executing: ${command.substring(0, 100)}${command.length > 100 ? '...' : ''}`);
    log(`Shell: ${shell}, CWD: ${currentWorkingDir}, Timeout: ${timeout}ms`);

    if (runInBackground) {
      const outputDir = path.join(os.homedir(), '.yumi', 'bg-output');
      try {
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      } catch {}
      bgOutputFile = path.join(outputDir, `${bgId}.txt`);
      try {
        bgOutputFd = fs.openSync(bgOutputFile, 'a');
      } catch {}
    }

    // Spawn shell with current working directory
    const detached = IS_WINDOWS ? runInBackground : !!runInBackground;
    // Windows background output capture: prefer shell-level redirection
    const isWindowsBg = IS_WINDOWS && runInBackground && bgOutputFile;
    const shellLower2 = String(shell).toLowerCase();
    let useShellRedirect = false;
    if (isWindowsBg) {
      let redirectPath = bgOutputFile;
      if (shellLower2.includes('bash.exe')) {
        // Convert Windows path to /c/Users/... for Git Bash
        const match = bgOutputFile.match(/^([A-Za-z]):[\\/](.*)$/);
        if (match) {
          const drive = match[1].toLowerCase();
          const rest = match[2].replace(/\\/g, '/');
          redirectPath = `/${drive}/${rest}`;
        } else {
          redirectPath = bgOutputFile.replace(/\\/g, '/');
        }
      }
      const safePath = redirectPath.replace(/"/g, '""');
      execCommand = `${execCommand} >> "${safePath}" 2>&1`;
      useShellRedirect = true;
    }

    // WINDOWS FIX: Use stdin:'ignore' for foreground commands on Windows.
    // With stdin:'pipe' (old behavior), stdin was deliberately left open to avoid
    // SIGHUP on MSYS2/bash.exe killing child processes prematurely. But this caused
    // ANY child process that inherits the stdin handle and tries to read from it
    // (node scripts, python, interactive tools) to block forever — keeping stdout/
    // stderr handles open too, so neither 'exit' nor 'close' ever fires. The command
    // runs until the 15-min timeout, producing the "freezing bash" symptom.
    //
    // stdin:'ignore' gives children /dev/null (NUL on Windows) — reads get immediate
    // EOF, so no process can block on our stdin. bash -c / cmd /c don't read stdin
    // themselves, so this is safe for all command types.
    const fgStdin = IS_WINDOWS ? 'ignore' : 'pipe';
    const proc = spawn(shell, [...args, execCommand], {
      cwd: currentWorkingDir,
      env: shellEnv,
      stdio: runInBackground
        ? (useShellRedirect
            ? ['ignore', 'ignore', 'ignore']
            : ['ignore', bgOutputFd !== null ? bgOutputFd : 'ignore', bgOutputFd !== null ? bgOutputFd : 'ignore'])
        : [fgStdin, 'pipe', 'pipe'],
      detached,
      // Hide the console window for EVERY shell spawn on Windows, not just
      // background ones — otherwise each foreground command flashes a terminal.
      windowsHide: IS_WINDOWS
    });

    if (bgOutputFd !== null) {
      try { fs.closeSync(bgOutputFd); } catch {}
    }

    // Close stdin immediately for foreground processes — prevents interactive commands
    // from blocking forever. On Windows, stdin is already 'ignore' (NUL), so
    // proc.stdin is null and this is a no-op.
    if (!runInBackground && proc.stdin) {
      proc.stdin.end();
    }

    // Track foreground process so cleanup() can kill it on interrupt
    if (!runInBackground) {
      activeForegroundProc = proc;
    }

    if (runInBackground) {
      if (detached && !IS_WINDOWS) {
        proc.unref();
      }

      // Track in file for frontend visibility
      addBgProcess({
        id: bgId,
        pid: proc.pid,
        command: censorSecrets(command),
        cwd: currentWorkingDir,
        sessionId: SESSION_ID,
        startedAt: Date.now(),
        status: 'running',
        outputFile: bgOutputFile || undefined
      });

      // No streaming for background processes - output is captured to file.

      // Handle spawn errors
      proc.on('error', (err) => {
        log(`Background process ${bgId} spawn error: ${err.message}`);
        updateBgProcess(bgId, {
          status: 'failed',
          exitCode: -1,
          completedAt: Date.now()
        });
      });

      // Track process exit
      proc.on('close', (code) => {
        const existing = readBgProcesses().find(p => p.id === bgId);
        if (existing && existing.status === 'killed') {
          log(`Background process ${bgId} exited after kill (code ${code}); keeping status=killed`);
          return;
        }
        updateBgProcess(bgId, {
          status: code === 0 ? 'completed' : 'failed',
          exitCode: code,
          completedAt: Date.now()
        });
        log(`Background process ${bgId} (PID ${proc.pid}) exited with code ${code}`);
      });

      // Return immediately — setImmediate gives the spawn one tick to fail
      setImmediate(() => {
        resolve({
          output: `Background process started (ID: ${bgId}, PID: ${proc.pid})\nCommand: ${censorSecrets(command)}\nYou will be automatically notified when it completes — do NOT poll or check on it. Continue with other work.`,
          isError: false,
          backgroundId: bgId
        });
      });
      return;
    }

    // Set up timeout (0 = no timeout)
    let timeoutId = null;
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        log(`Command timed out after ${timeout}ms`);
        // Kill the entire process tree, not just the direct child
        if (proc.pid) {
          killProcessTree(proc.pid);
        } else {
          proc.kill('SIGTERM');
        }
      }, timeout);
    }

    // Time-based flush for partial lines (handles \r progress bars, pipe buffering)
    let flushTimer = null;
    const FLUSH_INTERVAL = 150; // ms — flush incomplete lines after this delay

    function scheduleFlush() {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        if (stdoutBuf) {
          emitBashOutput(stdoutBuf);
          stdoutBuf = '';
        }
        if (stderrBuf) {
          emitBashOutput(stderrBuf);
          stderrBuf = '';
        }
      }, FLUSH_INTERVAL);
    }

    // Handle stream errors gracefully
    proc.stdout.on('error', () => {}); // EPIPE, I/O errors
    proc.stderr.on('error', () => {}); // EPIPE, I/O errors

    // Handle stdout - split on \n and \r, flush partial lines on timer.
    // When pipe is intercepted, tee handles streaming to the stream file,
    // so we only accumulate stdout for the tool return value (no double-write).
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      if (output.length < MAX_OUTPUT_SIZE) {
        output += text;
        if (output.length >= MAX_OUTPUT_SIZE) { outputCapped = true; }
      }
      if (!pipeIntercepted) {
        stdoutBuf += text;
        // Split on newline or carriage return (progress bars use \r)
        const lines = stdoutBuf.split(/\r?\n|\r/);
        stdoutBuf = lines.pop(); // Keep incomplete trailing fragment
        for (const line of lines) {
          if (line) emitBashOutput(line);
        }
        if (stdoutBuf) scheduleFlush();
      }
    });

    // Handle stderr - split on \n and \r, flush partial lines on timer
    proc.stderr.on('data', (data) => {
      const text = data.toString();
      if (output.length < MAX_OUTPUT_SIZE) {
        output += text;
        if (output.length >= MAX_OUTPUT_SIZE) { outputCapped = true; }
      }
      stderrBuf += text;
      const lines = stderrBuf.split(/\r?\n|\r/);
      stderrBuf = lines.pop(); // Keep incomplete trailing fragment
      for (const line of lines) {
        if (line) emitBashOutput(line);
      }
      if (stderrBuf) scheduleFlush();
    });

    // Windows pipe inheritance safeguard: if the process exits but a child
    // process holds stdout/stderr open, 'close' never fires.  Track 'exit'
    // and wait for streams to end before resolving.
    //
    // On MSYS2/Git Bash, piped commands (e.g. `cmd | tail -80`) cause the
    // bash exit event to fire before the pipe chain has flushed its output.
    // A fixed 2s grace period is too short — `tail` buffers ALL input and
    // only writes when it receives EOF, which propagates AFTER bash exits.
    // Instead, we wait for stdout/stderr `end` events (all data received)
    // with a hard safety cap for cases where streams never close.
    let closeResolved = false;
    let exitGraceTimer = null;
    if (IS_WINDOWS) {
      proc.on('exit', (exitCode) => {
        if (closeResolved) return;
        const isError = exitCode !== 0 && exitCode !== null;
        log(`Process exited (code ${exitCode}), waiting for streams to drain`);
        let stdoutDone = !proc.stdout || proc.stdout.destroyed || proc.stdout.readableEnded;
        let stderrDone = !proc.stderr || proc.stderr.destroyed || proc.stderr.readableEnded;

        const forceResolve = () => {
          if (closeResolved) return;
          activeForegroundProc = null;
          closeResolved = true;
          if (exitGraceTimer) { clearTimeout(exitGraceTimer); exitGraceTimer = null; }
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          if (stdoutBuf) emitBashOutput(stdoutBuf);
          if (stderrBuf) emitBashOutput(stderrBuf);
          flushStreamSync();
          if (timeoutId) clearTimeout(timeoutId);
          // Destroy remaining streams to release pipe handles held by zombie children.
          // Without this, the Node event loop keeps the streams alive even after we resolve.
          if (proc.stdout && !proc.stdout.destroyed) proc.stdout.destroy();
          if (proc.stderr && !proc.stderr.destroyed) proc.stderr.destroy();
          // Also kill leftover children that might still hold handles
          // (e.g., cmd.exe /c spawned a child that survived the parent)
          if (proc.pid) {
            try { killProcessTree(proc.pid); } catch {}
          }
          // Defer by one tick to let any remaining data callbacks process
          setImmediate(() => {
            output = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            let finalOutput = output.trim() || (exitCode !== 0 ? `exit code ${exitCode} (no output)` : '(no output)');
            if (outputCapped) finalOutput += '\n\n[output truncated at 2MB]';
            resolve({
              output: finalOutput,
              isError: exitCode !== 0 && !(exitCode === 1 && !output.trim())
            });
          });
        };

        // ERROR FAST PATH: When the process exits with an error code (cmd.exe /c
        // returning non-zero, bash -c command failing, etc.), resolve immediately.
        // Don't wait for streams — the error output is already buffered and any
        // remaining data from zombie children is irrelevant. This prevents the
        // "freeze on error" symptom where cmd.exe /c exits but child handles
        // keep streams open for seconds.
        if (isError) {
          log(`Error exit (code ${exitCode}) — fast-resolving without waiting for streams`);
          // Give one event-loop tick for final data callbacks, then resolve
          setTimeout(forceResolve, 50);
          return;
        }

        const checkStreamsDone = () => {
          if (stdoutDone && stderrDone) {
            // Small delay to let any final data events be processed
            setTimeout(forceResolve, 50);
          }
        };

        if (proc.stdout && !stdoutDone) {
          proc.stdout.on('end', () => { stdoutDone = true; checkStreamsDone(); });
        }
        if (proc.stderr && !stderrDone) {
          proc.stderr.on('end', () => { stderrDone = true; checkStreamsDone(); });
        }

        // Check immediately in case streams already ended
        checkStreamsDone();

        // Hard safety cap — if streams never end (inherited pipe handles),
        // resolve with whatever output has been collected so far.
        // On Windows, piped MSYS2 commands (grep|head) often leave pipe handles
        // open after cmd.exe exits (no SIGPIPE), so streams never fire 'end'.
        // Use a short grace (500ms) when we already have output — the process
        // exited successfully and we're just waiting for dangling pipe handles.
        // Use a longer grace only when we have no output yet (still draining).
        const hasOutput = output.trim().length > 0;
        const graceMs = IS_WINDOWS ? (hasOutput ? 500 : 2000) : 10000;
        exitGraceTimer = setTimeout(() => {
          if (closeResolved) return;
          log(`Streams did not end within ${graceMs}ms after exit — force-resolving`);
          forceResolve();
        }, graceMs);
      });
    }

    // Handle completion
    proc.on('close', (code) => {
      activeForegroundProc = null;
      closeResolved = true;
      if (exitGraceTimer) { clearTimeout(exitGraceTimer); exitGraceTimer = null; }
      // Cancel pending flush and emit remaining content
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (stdoutBuf) emitBashOutput(stdoutBuf);
      if (stderrBuf) emitBashOutput(stderrBuf);
      flushStreamSync();
      if (timeoutId) clearTimeout(timeoutId);
      log(`Command completed with code: ${code}`);

      // Track cd commands to update working directory
      const cdMatch = command.match(/^\s*cd\s+(.+?)\s*(?:;|&&|$|\r|\n)/);
      if (cdMatch && code === 0) {
        const newDir = cdMatch[1].replace(/^["']|["']$/g, '').trim();
        try {
          if (path.isAbsolute(newDir)) {
            // Convert MSYS2/Git Bash paths (/c/Users/...) to Windows paths (C:\Users\...)
            // so Node.js spawn({ cwd }) receives a path the OS understands.
            const msys2Match = IS_WINDOWS && newDir.match(/^\/([a-zA-Z])\/(.*)/);
            if (msys2Match) {
              currentWorkingDir = `${msys2Match[1].toUpperCase()}:\\${msys2Match[2].replace(/\//g, '\\')}`;
            } else {
              currentWorkingDir = newDir;
            }
          } else if (newDir === '~' || newDir.startsWith('~/')) {
            currentWorkingDir = newDir.replace('~', os.homedir());
          } else if (newDir === '-') {
            // cd - not fully supported
          } else if (newDir === '..') {
            currentWorkingDir = path.dirname(currentWorkingDir);
          } else {
            currentWorkingDir = path.resolve(currentWorkingDir, newDir);
          }
          // Verify the directory exists
          if (!fs.existsSync(currentWorkingDir)) {
            currentWorkingDir = WORKING_DIR;
          }
          log(`Working directory updated: ${currentWorkingDir}`);
        } catch (err) {
          log(`Error updating working directory: ${err.message}`);
        }
      }

      // Defer resolution by one event-loop tick to ensure all pending data
      // callbacks are processed before capturing final output. On Windows/MSYS2,
      // pipe buffering can cause close to fire before the last data events are
      // delivered, resulting in truncated tool results.
      setImmediate(() => {
        // Strip \r from PTY output (PTY adds \r\n line endings instead of \n)
        output = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        if (timedOut) {
          let tout = output.trim() + `\n\nError: Command timed out after ${timeout / 1000} seconds`;
          if (outputCapped) tout += '\n[output truncated at 2MB]';
          resolve({ output: tout, isError: true });
        } else {
          const trimmed = output.trim();
          // Exit code 1 with no output is normal for grep/diff/test (means "no match")
          // Don't report as error — provide informative output instead
          const isNoMatchExit = code === 1 && !trimmed;
          let finalOutput = trimmed || (code !== 0 ? `exit code ${code} (no output)` : '(no output)');
          if (outputCapped) finalOutput += '\n\n[output truncated at 2MB]';
          resolve({
            output: finalOutput,
            isError: code !== 0 && !isNoMatchExit
          });
        }
      });
    });

    // Handle spawn error (e.g., ENOENT when shell not found)
    proc.on('error', (err) => {
      if (closeResolved) return;
      closeResolved = true;
      activeForegroundProc = null;
      if (timeoutId) clearTimeout(timeoutId);
      if (exitGraceTimer) { clearTimeout(exitGraceTimer); exitGraceTimer = null; }
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      log(`Spawn error: ${err.message}`);
      resolve({
        output: `Error: ${err.message}`,
        isError: true
      });
    });
  });
}

// Reset bash session
function restartBashSession() {
  currentWorkingDir = WORKING_DIR;
  shellEnv = { ...process.env };
  shellEnv.PATH = buildRichPath();
  if (!shellEnv.TERM) shellEnv.TERM = 'xterm-256color';
  shellEnv.GIT_PAGER = 'cat';
  shellEnv.GIT_TERMINAL_PROMPT = '0';
  shellEnv.PYTHONUNBUFFERED = '1';
  log('Bash session restarted');
  return { output: 'Bash session restarted', isError: false };
}

// MCP Tool handlers
const tools = {
  // RunBash tool - replaces Claude's built-in Bash with streaming support
  RunBash: async (args) => {
    const {
      command,
      restart,
      timeout,
      description,
      run_in_background
    } = args;

    // Log description if provided (useful for debugging)
    // SEC[Node M4] censor secrets in description too — agents sometimes echo
    // env var names like "Run with OPENAI_API_KEY=sk-..." which previously
    // landed in logs verbatim.
    if (description) {
      log(`Description: ${censorSecrets(String(description))}`);
    }

    // Handle restart
    if (restart) {
      return restartBashSession();
    }

    // Validate command
    if (!command || (typeof command === 'string' && !command.trim())) {
      return { output: 'Error: command is required', isError: true };
    }

    // Check command against bash allow/deny rules
    const ruleError = checkBashRules(command);
    if (ruleError) {
      log(`Bash rule blocked: ${ruleError}`);
      return { output: `Error: ${ruleError}`, isError: true };
    }

    // Calculate timeout: default 15 min, caller can override, hard cap at MAX_TIMEOUT
    let timeoutMs = DEFAULT_TIMEOUT;
    if (timeout !== undefined && timeout > 0) {
      timeoutMs = Math.max(timeout, 1000);
    }
    if (MAX_TIMEOUT > 0 && timeoutMs > MAX_TIMEOUT) {
      timeoutMs = MAX_TIMEOUT;
    }

    return await executeCommand(command, timeoutMs, run_in_background || false);
  },
  ListBackgroundProcesses: async () => {
    const procs = readBgProcesses();
    if (!procs.length) {
      return { output: 'No background processes found.', isError: false };
    }
    const summary = procs.map(p => { const cmd = censorSecrets(p.command); return `[${p.status}] ${p.id} (PID ${p.pid}): ${cmd.substring(0, 60)}${cmd.length > 60 ? '...' : ''}`; }).join('\n');
    return { output: summary, isError: false };
  },
  CancelBackgroundProcess: async (args) => {
    const id = args?.id;
    if (!id) return { output: 'Error: id required', isError: true };
    return killBgProcessById(id);
  },
  CancelAllBackgroundProcesses: async () => {
    return killAllBgProcesses();
  },
  // AskUserQuestion - waits until frontend provides an answer via file IPC.
  // SEC[Node M3] previously polled with Atomics.wait + setTimeout(0) which
  // blocked the MCP event loop and starved any other concurrent tool work.
  // Replaced with a setInterval-based promise + 5-min hard cap.
  AskUserQuestion: async (args) => {
    const { questions } = args;
    if (!Array.isArray(questions) || questions.length === 0) {
      return { output: 'Error: questions array is required', isError: true };
    }
    const askuserDir = path.join(os.homedir(), '.yumi', 'askuser');
    try {
      if (!fs.existsSync(askuserDir)) fs.mkdirSync(askuserDir, { recursive: true });
    } catch {}
    const requestId = `askuser-${Date.now()}-${require('crypto').randomBytes(6).toString('hex')}`;
    const pendingFile = path.join(askuserDir, `${SESSION_ID}.json`);
    const answerFile = path.join(askuserDir, `${SESSION_ID}.answer.json`);
    // Clean up any stale answer file from previous request
    try { if (fs.existsSync(answerFile)) fs.unlinkSync(answerFile); } catch {}
    // Write pending question (atomic write)
    // SEC[Node L5] tighten file mode on POSIX so other local users cannot read
    // the pending question (or write a forged answer file).
    const pendingData = { requestId, sessionId: SESSION_ID, questions, timestamp: Date.now() };
    const tmpPending = pendingFile + `.tmp.${process.pid}`;
    const writeOpts = IS_WINDOWS ? undefined : { mode: 0o600 };
    fs.writeFileSync(tmpPending, JSON.stringify(pendingData), writeOpts);
    fs.renameSync(tmpPending, pendingFile);
    log(`AskUserQuestion: wrote pending file for session ${SESSION_ID}, requestId=${requestId}`);

    return new Promise((resolve) => {
      const POLL_MS = 250;
      const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes
      const start = Date.now();
      const timer = setInterval(() => {
        try {
          if (!fs.existsSync(pendingFile)) {
            clearInterval(timer);
            log(`AskUserQuestion: pending file removed externally, aborting requestId=${requestId}`);
            resolve({ output: 'Error: Question was dismissed', isError: true });
            return;
          }
        } catch {}
        try {
          if (fs.existsSync(answerFile)) {
            const answerData = JSON.parse(fs.readFileSync(answerFile, 'utf8'));
            if (answerData && answerData.requestId === requestId) {
              clearInterval(timer);
              try { fs.unlinkSync(pendingFile); } catch {}
              try { fs.unlinkSync(answerFile); } catch {}
              log(`AskUserQuestion: got answer for requestId=${requestId}`);
              resolve({ output: JSON.stringify(answerData.answers || {}), isError: false });
              return;
            }
          }
        } catch {}
        if (Date.now() - start > MAX_WAIT_MS) {
          clearInterval(timer);
          try { if (fs.existsSync(pendingFile)) fs.unlinkSync(pendingFile); } catch {}
          log(`AskUserQuestion: timed out after ${MAX_WAIT_MS}ms requestId=${requestId}`);
          resolve({ output: 'Error: AskUser timed out', isError: true });
        }
      }, POLL_MS);
    });
  }
};

// MCP Protocol handling
function sendResponse(id, result) {
  const response = {
    jsonrpc: '2.0',
    id,
    result
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

function sendError(id, code, message) {
  const response = {
    jsonrpc: '2.0',
    id,
    error: { code, message }
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

async function handleRequest(request) {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize':
        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'yumi', version: '1.0.0' }
        });
        break;

      case 'tools/list':
        sendResponse(id, {
          tools: [
            {
              name: 'RunBash',
              description: 'Execute a bash command with real-time output streaming to Yumi. Commands run in a persistent session with working directory tracking.',
              inputSchema: {
                type: 'object',
                properties: {
                  command: {
                    type: 'string',
                    description: 'The command to execute'
                  },
                  restart: {
                    type: 'boolean',
                    description: 'Set to true to restart the bash session'
                  },
                  timeout: {
                    type: 'number',
                    default: 900000,
                    description: 'Optional timeout in milliseconds. Default: 900000 (15 min). Max: 1200000 (20 min). Do NOT override unless you need a shorter timeout for a specific reason. Tests, builds, and installs need the full 15 minutes.'
                  },
                  description: {
                    type: 'string',
                    description: 'Description of what this command does'
                  },
                  run_in_background: {
                    type: 'boolean',
                    description: 'Run the command in the background. You will be automatically notified when it completes — do NOT poll or check on it.'
                  }
                },
                required: []
              }
            },
            {
              name: 'ListBackgroundProcesses',
              description: 'List all background bash processes and their status. Only call when the user asks about background processes.',
              inputSchema: { type: 'object', properties: {}, required: [] }
            },
            {
              name: 'CancelBackgroundProcess',
              description: 'Cancel (kill) a running background process by ID.',
              inputSchema: {
                type: 'object',
                properties: { id: { type: 'string', description: 'Background process ID (e.g., bg-1234567890)' } },
                required: ['id']
              }
            },
            {
              name: 'CancelAllBackgroundProcesses',
              description: 'Cancel (kill) all running background processes.',
              inputSchema: { type: 'object', properties: {}, required: [] }
            },
            {
              name: 'AskUserQuestion',
              description: "Use this tool when you need to ask the user questions during execution. This allows you to:\n1. Gather user preferences or requirements\n2. Clarify ambiguous instructions\n3. Get decisions on implementation choices as you work\n4. Offer choices to the user about what direction to take.\n\nUsage notes:\n- Users will always be able to select \"Other\" to provide custom text input\n- Use multiSelect: true to allow multiple answers to be selected for a question",
              inputSchema: {
                type: 'object',
                properties: {
                  questions: {
                    description: 'Questions to ask the user (1-4 questions)',
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        question: { type: 'string', description: 'The question to ask' },
                        header: { type: 'string', description: 'Short label (max 12 chars)' },
                        multiSelect: { type: 'boolean', default: false, description: 'Allow multiple selections' },
                        options: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              label: { type: 'string', description: 'Display text for this option' },
                              description: { type: 'string', description: 'Explanation of this option' }
                            },
                            required: ['label', 'description']
                          },
                          minItems: 2,
                          maxItems: 4
                        }
                      },
                      required: ['question', 'header', 'options', 'multiSelect']
                    },
                    minItems: 1,
                    maxItems: 4
                  }
                },
                required: ['questions']
              }
            }
          ]
        });
        break;

      case 'tools/call':
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};

        if (tools[toolName]) {
          const result = await tools[toolName](toolArgs);
          sendResponse(id, {
            content: [{ type: 'text', text: result.output || '' }],
            isError: result.isError || false
          });
        } else {
          sendError(id, -32601, `Unknown tool: ${toolName}`);
        }
        break;

      case 'notifications/initialized':
        // No response needed for notifications
        break;

      default:
        if (id !== undefined) {
          sendError(id, -32601, `Method not found: ${method}`);
        }
    }
  } catch (error) {
    log('Error handling request:', error);
    if (id !== undefined) {
      sendError(id, -32603, error.message);
    }
  }
}

// Cleanup on exit — kill active foreground process and close stream file.
// Background processes are detached and tracked via bg-processes.json — leave them alone.
function cleanup() {
  // Kill active foreground bash process (prevents orphans on interrupt)
  if (activeForegroundProc && activeForegroundProc.pid) {
    log(`Killing active foreground process (PID ${activeForegroundProc.pid})`);
    killProcessTree(activeForegroundProc.pid);
    activeForegroundProc = null;
  }
  flushStreamSync();
  if (streamFd !== null) {
    try {
      fs.closeSync(streamFd);
      streamFd = null;
    } catch (err) {}
  }
  // Delete the stream file to prevent temp dir accumulation
  try {
    if (fs.existsSync(STREAM_FILE)) fs.unlinkSync(STREAM_FILE);
  } catch (err) {}
}

// Main
log(`Starting yumi-mcp-bash server`);
log(`Platform: ${os.platform()}, Session: ${SESSION_ID}`);
log(`Stream file: ${STREAM_FILE}`);
log(`Working dir: ${WORKING_DIR}`);
const streamingMode = hasPython3Pty ? 'python3 pty (optimal)'
  : hasScriptPty ? 'macOS script pty (fallback)'
  : hasStdbuf ? `${stdbufCmd} line-buffer (fallback)`
  : 'plain pipe (WARNING: output will be block-buffered, streaming delayed)';
log(`Streaming mode: ${streamingMode}`);
if (bashRules.allow.length || bashRules.deny.length) {
  log(`Bash rules (merged from Claude Code settings + Yumi UI):`);
  if (bashRules.allow.length) log(`  allow: ${JSON.stringify(bashRules.allow)}`);
  if (bashRules.deny.length) log(`  deny: ${JSON.stringify(bashRules.deny)}`);
}

// Initialize stream file
initStreamFile();

// Handle MCP protocol via stdio
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// SEC[Node L11] cap MCP stdin line length at 1MB. Without a cap, a malicious
// caller (or a misbehaving LLM emitting endless tokens) could pin RAM by
// streaming an unterminated line. Anything over 1MB closes the MCP connection.
const MCP_MAX_LINE_BYTES = 1024 * 1024;
rl.on('line', (line) => {
  if (typeof line === 'string' && Buffer.byteLength(line, 'utf8') > MCP_MAX_LINE_BYTES) {
    log('[SEC] MCP line exceeded 1MB cap; closing stdin');
    try { rl.close(); } catch {}
    return;
  }
  try {
    const request = JSON.parse(line);
    handleRequest(request);
  } catch (error) {
    log('Parse error:', error.message);
  }
});

rl.on('close', () => {
  log('stdin closed, exiting');
  cleanup();
  process.exit(0);
});

// Handle signals gracefully
process.on('SIGTERM', () => {
  log('SIGTERM received, exiting');
  cleanup();
  process.exit(0);
});

process.on('SIGINT', () => {
  log('SIGINT received, exiting');
  cleanup();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  log('Uncaught exception:', err);
  cleanup();
  process.exit(1);
});
