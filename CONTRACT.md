# Yumi build CONTRACT (Rust ⇄ React convergence)

Frozen interface. `src/lib/types.ts` + `src/lib/ipc.ts` are authoritative for shapes/names.
Two agents build in parallel against this: **Rust backend** (`src-tauri/`) and **React frontend** (`src/`).

## Spawn command (Rust spawner)
```
claude --output-format stream-json --verbose --include-partial-messages --dangerously-skip-permissions [--resume <claudeSessionId>] -p <prompt> --model <model>
```
- Locate binary: PATH `claude`/`claude.exe`, else `%USERPROFILE%\.local\bin\claude.exe`.
- Spawn with `cwd` = session cwd (tokio::process). Read stdout line-by-line; each line is one JSON object → parse → emit `claude-event`.
- Register child PID in a registry keyed by `sessionId` so `interrupt_claude` can tree-kill (Windows: enumerate children, kill).
- On `system/init` line, learn `session_id` (claude uuid) → emit `claude-session-id`.
- On process exit → emit `claude-complete {sessionId, code}`. On spawn failure / stderr fatal → `claude-error`.
- If `opts.thinking`, set env `ANTHROPIC_BASE_URL=http://127.0.0.1:<proxyport>` after launching the bundled `resources/thinking-proxy.cjs` (P1; ok to skip wiring for first green build but leave the hook).

## stream-json → ClaudeEvent mapping (parser, see real sample at `../streamsample.jsonl`)
- `type:"system"` → `{kind:"system", subtype, model, claudeSessionId:session_id, cwd, tools, data:<whole>}`. (subtypes seen: `init`, `hook_started`, `hook_response`; tolerate any.)
- `type:"assistant"` → iterate `message.content[]`: `text`→`assistant_text`; `thinking`→`assistant_thinking`; `tool_use`→`tool_use{id,name,input}`.
- `type:"user"` → iterate `message.content[]`: `tool_result`→`tool_result{toolUseId:tool_use_id, content:<text>, isError:is_error}`.
- `type:"stream_event"` → unwrap `event`: `content_block_delta` with `delta.type=="text_delta"`→`text_delta{text:delta.text}`; `thinking_delta`→`thinking_delta{text:delta.thinking}`; ignore `input_json_delta`/start/stop (or route to raw). This drives live typing.
- `type:"result"` → `{kind:"result", isError:is_error, durationMs:duration_ms, numTurns:num_turns, totalCostUsd:total_cost_usd, resultText:result, usage, modelUsage}`.
- `type:"rate_limit_event"` → `{kind:"rate_limit", data:<whole>}`.
- `type:"error"` → `{kind:"error", message}`.
- unknown `type` or unparseable → `{kind:"raw", line}`. **Parser is non-lossy; never drop a line silently.**

## Frontend stream reducer (streamParse.ts)
Maintain the in-flight assistant message. `text_delta`/`thinking_delta` → append to the active text/thinking block (create if none). `assistant_text`/`assistant_thinking` (complete) → replace/commit the active block's text. `tool_use` → push a tool card (running:true). `tool_result` → match by toolUseId, attach content, running:false. `result` → finalize message (cost, durationMs, streaming:false).

## Tauri commands (Rust `#[tauri::command]`, exact names — must match ipc.ts)
`get_claude_version()->String` · `spawn_claude(opts:SpawnOpts)->String` · `interrupt_claude(sessionId:String)` · `get_usage_limits(force:bool)->UsageLimits` · `get_settings()->Settings` · `save_settings(settings:Settings)` · `set_theme(theme:String)` · `db_list_sessions()->Vec<SessionMeta>` · `db_get_session(id:String)->SessionDetail` · `db_save_session(detail:SessionDetail)` · `db_delete_session(id:String)` · `db_get_analytics()->Analytics` · `list_projects()->Vec<RecentProject>` · `add_recent_project(path:String)` · `pick_directory()->Option<String>` · `list_directory(path:String)->Vec<DirEntry>` · `read_text_file(path:String)->String` · `git_status(cwd:String)->GitStatus` · `git_diff(cwd:String,staged:bool)->String`.
- Serde: use `#[serde(rename_all="camelCase")]` on all structs so JSON matches the TS camelCase fields. Tauri command ARG names are camelCase (`sessionId`, not `session_id`) — match ipc.ts exactly.
- `pick_directory`: use a simple approach (spawn PowerShell folder dialog, or return None if unavailable). Non-fatal.

## Event channels (Rust `app.emit(...)`)
`claude-event {sessionId,event:ClaudeEvent}` · `claude-complete {sessionId,code}` · `claude-error {sessionId,message}` · `claude-session-id {sessionId,claudeSessionId}` · `bash-output {sessionId,chunk}` (P1).

## DB (rusqlite bundled, at `~/.yumi/yumi.db`, WAL)
tables: `sessions(id PK, claude_session_id, title, cwd, model, created_at, updated_at)` · `messages(id PK AUTOINC, session_id, role, content TEXT json, created_at)` · `analytics(id PK, session_id, model, input_tokens, output_tokens, cost_usd, created_at)` · `settings(key PK, value)`. Create-if-missing on startup.

## File ownership
- **Rust agent owns:** everything under `src-tauri/src/` EXCEPT do not touch `src/` (frontend). Structure: `lib.rs` (builder + invoke_handler registering ALL commands above), `state.rs`, `db.rs`, `claude/{binary,spawner,session,stream_parser,proxy}.rs`, `process/registry.rs`, `mcp/monitor.rs`, `commands/{claude,info,db,git,fs,settings}.rs`. Must keep `[lib] crate-type=["rlib"]`. Provide `#[cfg(test)]` parser tests using `../streamsample.jsonl`-style lines.
- **React agent owns:** everything under `src/` EXCEPT the FROZEN files `src/lib/types.ts` and `src/lib/ipc.ts` (read-only — consume them). Build: `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `src/lib/{store,streamParse,themes,shortcuts}.ts`, `src/components/{chat,tabs,input,panels,overlays,common}/**`. No new npm deps without noting; prefer zustand IF added to package.json (else a simple React context store). Use `@tauri-apps/api`.

## Acceptance
- Rust: `cargo build` green; `cargo test` parser tests green.
- React: `npm run build` (tsc+vite) green.
- Together (integrator): app launches, sending a prompt streams an assistant reply (text + thinking + a tool call render) end to end.
