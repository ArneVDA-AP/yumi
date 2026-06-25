/**
 * Lightweight HTTP proxy that injects the `thinking` parameter into Claude
 * API requests so the CLI streams interleaved thinking blocks.
 *
 * Why injection is required (not just CLI --settings alwaysThinkingEnabled):
 * Opus 4.7 and other Claude 4.6+ models reject `thinking: {type: "enabled",
 * budget_tokens: N}` (manual budget) silently — the API drops thinking from
 * the response without erroring. They require `thinking: {type: "adaptive"}`.
 * The CLI does not always send the right shape, so the proxy normalizes it.
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');
const dns = require('dns');

// SEC[Node L12] clamp the proxy port into the documented loopback range so a
// poisoned env var can't be used to bind to a privileged or internet-facing port.
const PROXY_PORT = (() => {
  const raw = parseInt(process.env.THINKING_PROXY_PORT, 10);
  if (!Number.isFinite(raw)) return 18800;
  return Math.min(Math.max(raw, 18800), 18899);
})();
const BUDGET_TOKENS = parseInt(process.env.THINKING_BUDGET_TOKENS || '10000', 10);
const ANTHROPIC_HOST = 'api.anthropic.com';

// SEC[Node H3] strict hostname allowlist for outbound requests.
// `hostname.includes('anthropic.com')` accepted `evil.anthropic.com.attacker.io`;
// require an exact match or a subdomain of api.anthropic.com.
function isAnthropicHost(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  return hostname === 'api.anthropic.com' || hostname.endsWith('.anthropic.com');
}

// SEC[Node H3] DNS-rebinding defense: refuse if the resolved IP is private/
// loopback/link-local/CGNAT/ULA. The proxy ONLY ever speaks to Anthropic; an
// attacker-controlled DNS that returns 127.0.0.1 or 169.254.169.254 (cloud
// metadata) must not be honored.
function isPrivateIP(ip) {
  if (!ip) return true;
  if (ip.startsWith('127.') || ip === '::1' || ip.startsWith('::ffff:127.')) return true;
  if (ip.startsWith('10.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true;
  if (ip.startsWith('100.')) {
    const o = parseInt(ip.split('.')[1], 10);
    if (o >= 64 && o <= 127) return true; // CGNAT 100.64.0.0/10
  }
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // IPv6 ULA
  if (ip.startsWith('fe80:')) return true; // IPv6 link-local
  return false;
}

// PERF: Cache DNS lookup with a TTL — `dns.lookup` uses the OS resolver and has
// no internal Node.js cache, so every proxied request was making a fresh syscall.
// The Anthropic API IP is stable for hours; a 60s TTL is conservative.
const DNS_TTL_MS = 60_000;
let _dnsCache = null; // { address: string, expires: number }
function resolveAnthropicHost(cb) {
  const now = Date.now();
  if (_dnsCache && _dnsCache.expires > now) {
    return cb(null, _dnsCache.address);
  }
  dns.lookup(ANTHROPIC_HOST, (err, address) => {
    if (err) return cb(err);
    _dnsCache = { address, expires: now + DNS_TTL_MS };
    cb(null, address);
  });
}

function isAdaptiveThinkingModel(model) {
  if (!model) return false;
  return model.includes('fable') || model.includes('opus-4-6') || model.includes('opus-4-7') || model.includes('opus-4-8') || model.includes('sonnet-4-6');
}

function injectThinking(body) {
  try {
    const data = JSON.parse(body);

    // tool_choice forcing a specific tool is incompatible with thinking.
    // Claude CLI sends tool_choice as object {type: "auto"}, not string "auto".
    const tcType = typeof data.tool_choice === 'string' ? data.tool_choice : data.tool_choice?.type;
    const toolChoiceForced = data.tool_choice && tcType !== 'auto' && tcType !== 'none' && tcType !== undefined;

    const adaptive = isAdaptiveThinkingModel(data.model);

    if (data.thinking || toolChoiceForced) {
      // Opus 4.7 defaults thinking.display to "omitted" — the server strips
      // thinking tokens from the stream and only sends the signature. Force
      // "summarized" so the UI actually receives thinking_delta events.
      // Harmless on 4.6/Sonnet where "summarized" is already the default.
      if (data.thinking && adaptive && data.thinking.type === 'adaptive' && !data.thinking.display) {
        data.thinking.display = 'summarized';
      }
      return { body: JSON.stringify(data), adaptive };
    }

    if (adaptive) {
      data.thinking = { type: 'adaptive', display: 'summarized' };
    } else {
      data.thinking = { type: 'enabled', budget_tokens: BUDGET_TOKENS };
    }
    return { body: JSON.stringify(data), adaptive };
  } catch (e) {
    return { body, adaptive: false };
  }
}

const server = http.createServer((clientReq, clientRes) => {
  const path = clientReq.url.startsWith('/') ? clientReq.url : new URL(clientReq.url).pathname + new URL(clientReq.url).search;
  const isMessagesEndpoint = path.includes('/v1/messages') && !path.includes('count_tokens');

  // PERF: collect chunks then Buffer.concat once at end-of-request, instead of
  // string-concatenating each chunk (O(n^2) for large request bodies on V8).
  const bodyChunks = [];
  let bodyLen = 0;
  clientReq.on('data', chunk => {
    bodyChunks.push(chunk);
    bodyLen += chunk.length;
  });
  clientReq.on('end', () => {
    const body = bodyLen === 0 ? '' : Buffer.concat(bodyChunks, bodyLen).toString('utf8');
    let finalBody = body;
    let adaptive = false;

    if (isMessagesEndpoint && body) {
      const result = injectThinking(body);
      finalBody = result.body;
      adaptive = result.adaptive;
    }

    const headers = { ...clientReq.headers };
    headers['content-length'] = Buffer.byteLength(finalBody);
    headers['host'] = ANTHROPIC_HOST;

    // Pre-4.6 models need the interleaved-thinking beta header for the
    // CLI to receive thinking_delta events. 4.6+ adaptive thinking is GA
    // and works without the header.
    if (isMessagesEndpoint && !adaptive) {
      const existingBeta = headers['anthropic-beta'] || '';
      if (!existingBeta.includes('interleaved-thinking')) {
        headers['anthropic-beta'] = existingBeta
          ? `${existingBeta},interleaved-thinking-2025-05-14`
          : 'interleaved-thinking-2025-05-14';
      }
    }

    // LINUX SEA FIX: Resolve DNS explicitly to work around pkg bundling issues.
    // PERF: result is cached for DNS_TTL_MS so we don't hit the OS resolver per request.
    resolveAnthropicHost((err, address) => {
      if (err) {
        console.error('[PROXY ERROR] DNS lookup failed:', err.message);
        clientRes.writeHead(502);
        clientRes.end('DNS Error');
        return;
      }

      // SEC[Node H3] reject DNS rebinding to private/loopback ranges.
      if (isPrivateIP(address)) {
        console.error('[PROXY ERROR] refusing private/loopback IP for anthropic host:', address);
        clientRes.writeHead(502);
        clientRes.end('Blocked');
        return;
      }

      const proxyReq = https.request({
        hostname: address,
        port: 443,
        path: path,
        method: clientReq.method,
        headers: headers,
        servername: ANTHROPIC_HOST
      }, proxyRes => {
        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(clientRes);
      });

      proxyReq.on('error', err => {
        console.error('[PROXY ERROR]', err.message);
        clientRes.writeHead(502);
        clientRes.end('Proxy Error');
      });

      proxyReq.write(finalBody);
      proxyReq.end();
    });
  });
});

server.on('connect', (req, clientSocket, head) => {
  const [hostname, port] = req.url.split(':');

  // SEC[Node H3] strict hostname allowlist + DNS-rebinding defense for CONNECT.
  // Previously: `hostname.includes('anthropic.com')` admitted attacker domains
  // like `evil.com.anthropic.com.attacker.io`. Also: any non-anthropic hostname
  // fell through to `net.connect`, which made the proxy a generic TCP relay.
  if (!isAnthropicHost(hostname)) {
    console.error('[CONNECT BLOCKED] hostname not in anthropic allowlist:', hostname);
    try { clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); } catch {}
    clientSocket.end();
    return;
  }

  dns.lookup(hostname, (err, address) => {
    if (err || isPrivateIP(address)) {
      console.error('[CONNECT BLOCKED] DNS error or private IP for', hostname, '->', address);
      try { clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {}
      clientSocket.end();
      return;
    }

    const serverSocket = require('tls').connect({
      host: address,
      port: parseInt(port, 10) || 443,
      servername: hostname,
      rejectUnauthorized: true
    }, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', err => {
      console.error('[CONNECT ERROR]', err.message);
      clientSocket.end();
    });
  });
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`[THINKING PROXY] Listening on 127.0.0.1:${PROXY_PORT}`);
  console.log(`[THINKING PROXY] mode=inject budget_tokens=${BUDGET_TOKENS}`);
});
