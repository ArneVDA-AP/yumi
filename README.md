# Yumi

A personal, open clone of **Yume** — a native desktop GUI for the Claude Code CLI.
Yumi spawns your real `claude` binary as a subprocess and renders its `stream-json`
output (text, **thinking blocks**, tool calls, results) in a fast, OLED-themed chat UI.
It is **not** an API wrapper: the CLI handles auth, so it uses your existing Claude
subscription, and your CLAUDE.md / MCP servers / hooks / skills all work unchanged.

> Personal project, no commercial use. The licensing/paywall in the original is
> intentionally **not** cloned — Yumi is free and ungated.

## Documentation

Full developer docs live in a separate wiki repo and a published site:

- 📖 **Wiki site:** <https://arnevda-ap.github.io/yumi-wiki/>
- **Wiki source:** <https://github.com/ArneVDA-AP/yumi-wiki>

It covers the architecture, the Rust⇄React IPC contract, the stream pipeline, the
MCP/thinking-proxy sidecars, build/run/test, and the reliability design — all
grounded in this source. The honest per-feature status matrix is in
[`PARITY.md`](PARITY.md); the build contract is in [`CONTRACT.md`](CONTRACT.md).

## Stack

- **Tauri 2** (Rust host) + **React 19** + TypeScript (Vite) in WebView2
- **rusqlite** (bundled, WAL) at `~/.yumi/yumi.db` — sessions, messages, settings, analytics
- A reimplemented **MCP bash server** (`resources/yumi-mcp-bash.cjs`) and a
  **thinking-proxy** (`resources/thinking-proxy.cjs`) that enables interleaved
  thinking display for adaptive models

## How it works

The Rust backend locates `claude` (PATH or `%USERPROFILE%\.local\bin`), spawns it with:

```
claude --output-format stream-json --verbose --include-partial-messages \
       --dangerously-skip-permissions [--resume <uuid>] -p <prompt> --model <model>
```

reads stdout line-by-line, parses each JSON line into a typed `ClaudeEvent`
(`src-tauri/src/claude/stream_parser.rs`, non-lossy), and emits it on the
`claude-event` Tauri channel. A React + zustand store folds events into chat
messages (`src/lib/streamParse.ts`, `src/lib/store.ts`). The spawned env is
sanitized so a parent Claude Code session never leaks into the child, and the
turn finalizes on `end_turn` so the UI stays responsive even when post-turn
hooks delay the final `result`.

**Multi-provider** drives the *same* `claude` binary for every provider: a
non-Claude provider is realized by pointing it at a router
(claude-code-router / LiteLLM / OpenRouter) via `ANTHROPIC_BASE_URL`
(`settings.routerBaseUrl`) — the stream-json parser never changes. The bundled
`.cjs` sidecars are declared as Tauri `resources` and resolved at runtime via
`resource_dir()` (dev-layout ancestor-walk as fallback). See **PARITY.md** for
the full feature matrix and the reliability notes.

## Build & run

```bash
# install deps
npm install

# build the desktop app (debug, no installer) → src-tauri/target/debug/yumi.exe
npx tauri build --debug --no-bundle

# or live dev
npm run tauri dev
```

Windows note: builds on the `windows-gnu` toolchain (no MSVC needed) because the
crate uses `[lib] crate-type = ["rlib"]`.

## Test

```bash
cd src-tauri && cargo test                       # parser/provider/db/guard/resources units (38)
cd resources && node tests/mcp_server.test.mjs   # MCP JSON-RPC server (12)
```

## Layout

```
src/                 React UI (chat, tabs, input, panels, overlays, common)
  lib/               types.ts, ipc.ts (frozen contract), store.ts, streamParse.ts, themes.ts, shortcuts.ts
src-tauri/src/       Rust host
  claude/            binary, spawner, session, stream_parser, proxy
  process/registry   PID registry + Windows tree-kill
  commands/          claude, info, db, git, fs, settings
  db.rs              SQLite schema + queries
resources/           yumi-mcp-bash.cjs, thinking-proxy.cjs, yumi-plugin/ (agents + commands + guard)
```
