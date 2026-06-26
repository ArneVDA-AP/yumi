# PARITY — Yumi vs. Yume

Honest feature matrix for **Yumi**, a personal open clone of **Yume** (the commercial
Tauri + React desktop GUI that spawns the real `claude` CLI and renders its
`stream-json` output). Scope is personal use — the licensing/paywall/payment system
is **intentionally not cloned** (there is simply no gate).

Legend: ✅ done & verified · 🟢 done (lighter verification) · 🟡 scoped/stub (labeled) · ⬜ intentionally omitted

Last verified: 2026-06-26 (polished-v1 pass) against `claude` CLI in `%USERPROFILE%\.local\bin`, model `claude-opus-4-8` / `haiku`, driving the real `yumi.exe`.

---

## P0 — core loop (must work end-to-end + be verified)

| # | Feature | Status | Evidence |
|---|---------|--------|----------|
| 1 | Tauri shell boots; React UI renders in WebView2 | ✅ | `yumi.exe` (debug, embedded UI) launches; OLED UI renders — `yumi_rebuilt_window.png` |
| 2 | Locate + spawn `claude.exe` (`--output-format stream-json --verbose --include-partial-messages --dangerously-skip-permissions [--resume] -p … --model …`) | ✅ | Live round-trips; spawn args in `src-tauri/src/claude/spawner.rs` |
| 3 | Non-lossy `stream_parser` (system/assistant/user/stream_event/result/rate_limit/error → typed events; unknown → `raw`) | ✅ | 27 `cargo test` parser unit tests against real captured bytes |
| 4 | Chat render: user/assistant text, **thinking blocks**, tool_use/tool_result cards, markdown + code highlighting | ✅ | `yumi_td_10s.png` — thinking block + markdown answer `17 × 23 = **391**` |
| 5 | Prompt input; send; interrupt/stop; new session/tab | ✅ | Stop→Send button flips; `interrupt_claude` tree-kills via registry |
| 6 | Tabs/sessions, session list, resume, SQLite persistence (sessions+messages) | ✅ | Sidebar shows persisted prior turns grouped under project; `~/.yumi/yumi.db` |
| 7 | Settings: model picker, theme (incl OLED `#000000`), thinking/vim/rate-limit toggles, auto-compact threshold — persisted | ✅ | `SettingsOverlay.tsx`; `settings` table; 6 themes (oled/dark/dim/light/nord/rose) |
| 8 | MCP bash server (RunBash + AskUserQuestion + background-proc tools), reimplemented to spec | ✅ | `node resources/tests/mcp_server.test.mjs` → 12/12 pass |
| 9 | Core keyboard shortcuts (new/close tab, palette, settings, git, files, analytics) | ✅ | `src/lib/shortcuts.ts` |
| 10 | Live interleaved-thinking via thinking-proxy (`ANTHROPIC_BASE_URL` → localhost) | ✅ | Thinking block rendered in GUI; proxy probed-before-use (see "Reliability" below) |

## P1 — important (implemented, lighter verification)

| Feature | Status | Notes |
|---------|--------|-------|
| Rate-limit display (5h / 7d pills) | 🟢 | **Honest + live.** There is no reliable LOCAL source of 5h/7d rolling-window percentages (`~/.claude/stats-cache.json` is historical token stats, no window %), so `get_usage_limits` returns an honestly-inert state (`live:false`) and the pills render **greyed `—` with an "unavailable" tooltip** — never a fake number. The CLI's in-stream `rate_limit_event` (`{rate_limit_info:{status,resetsAt,rateLimitType}}`) IS wired through `store._onEvent` → the pills light up live (status + window + reset) when Claude reports a limit. The backend forwards that event even though it trails `end_turn` (pid-gated). **Verified in the real GUI:** pills greyed `5h —`/`7d —` at boot (`docs/evidence/v1-boot.png`); after a real turn the 5h pill lit **`5h ok`** (window reported `allowed`) while 7d stayed `—` (`docs/evidence/v1-ratelimit-live.png`). |
| Git panel (status / diff) | ✅ | `git_status`, `git_diff` commands + `GitPanel.tsx`. Verified in the GUI: shows branch + real staged/unstaged/untracked lists (`docs/evidence/v1-git-panel.png`). |
| Files panel + @-mentions + folder nav | 🟢 | `list_directory`, `read_text_file`, `FilesPanel.tsx`, `MentionPopup.tsx` |
| Command palette (slash commands) | 🟢 | `CommandPalette.tsx` |
| Context/token bar (tokens %, model) | ✅ | **Live mid-stream + dynamic window.** Fills live from the `message_start` usage snapshot (not only end-of-turn), and counts the cache tokens (`input + cache_read + cache_creation + output`) so a resumed turn reads its true occupancy. The window is parametrized per active model (`lib/models.ts` — Claude 200K, Gemini/1M variants 1M, default 200K), killing the hardcoded-200K bug. Verified driving `yumi.exe`: a turn filled the bar `0 → 51.7k / 200k (26%)` (`docs/evidence/v1-stream-done.png`). |
| Project picker + recent projects | 🟢 | `ProjectPicker.tsx`; `recent_projects` JSON in settings |
| yumi-plugin reproduced (4 agents + 8 commands + guard) | 🟢 | `resources/yumi-plugin/**` (architect/explorer/guardian/implementer; commit/compact/implement/init/plan/research/review/swarm) |
| Analytics dashboard (totals, by-model, by-date) | 🟢 | UI + `db_get_analytics` read path; `record_analytics` is now **wired** — the spawner records a usage row (model, input/output tokens, cost) from each turn's drained `result` line, so the dashboard shows real totals. Covered by `db.rs` unit tests (`record_and_aggregate_analytics`, `empty_analytics_is_zeroed`). |

## P2 — parity-noted, scoped/stub/omitted

| Feature | Status | Notes |
|---------|--------|-------|
| Per-message USD cost footer | 🟢 | **Recovered** without giving up responsiveness. The UI still finalizes on `end_turn` (~10s); when the lingering process's `result` line is drained, the backend emits a side-channel `claude-cost {sessionId, cost, durationMs}` that the store attaches to the finalized message's footer. Emission is gated on the turn's process still owning the session (pid-aware `is_current`), so a late cost can't land on a newer turn. (Not persisted to the DB — the message schema carries no cost column — so it shows live but not after a reload-from-history.) |
| BASH-MONITOR live tail (Rust tails `%TEMP%\yumi-bash-<sid>.log` → live terminal in tool card) | ✅ | **Done + verified.** Opt-in (`settings.bashMonitor`, default off). When on, the spawner writes a temp `--mcp-config` registering `yumi-mcp-bash.cjs` (with the session id + stream file) and passes `--disallowedTools Bash` so claude routes shell through `mcp__yumi-bash__RunBash`; `spawn_monitor` tails the stream file → `bash-output` → the running tool card's `live` field. Verified live: a `for i in 1..6; do echo tick-$i; sleep 1` loop streamed `tick-1..4` into the tool card's LIVE pane mid-run (`docs/evidence/p2-bashmon-livetail.png`). Resolves the prior "real blocker". |
| Multi-provider (Gemini/GPT/Kiro via router) | 🟢 | **Real, via `ANTHROPIC_BASE_URL` injection** (the convergent OSS pattern; the old "spawn the gemini/codex binary directly" path — which could never emit Claude stream-json — is gone). EVERY provider drives the SAME `claude` binary + stream-json parser; a non-Claude provider is realized by pointing that process at a router (claude-code-router / LiteLLM / OpenRouter) via `settings.routerBaseUrl`. A non-Claude provider with no router URL returns a **clear error**, never a fake success. Claude is the fully-verified path; the routing mechanism is verified — a spawned `claude` with `ANTHROPIC_BASE_URL` set sent its real `POST /v1/messages` to a local mock (`docs/evidence/v1-provider-routing.md`). Unit-tested (`provider::tests`). |
| 6-pane split grid (3×2, F7/F8) | ✅ | **Done + verified.** F7 adds a pane, F8 removes; up to 6 panes in a CSS grid, each a full `ChatPane(tabId)` (own header/messages/composer), click-to-activate with an active-border highlight. Verified F7×2 → 3 live panes (`docs/evidence/p2-split.png`). |
| History rollback UI | ✅ | **Done.** A rewind affordance on every user message truncates the conversation to that turn and reloads the prompt into the composer for edit/resend (`store.rollbackTo`), then re-persists. |
| Voice dictation (F5) | 🟢 | **Done.** F5 / a mic button toggles Web-Speech-API dictation (`useDictation`); interim + final transcripts append to the active pane's composer, with a live "Listening…" indicator. Degrades gracefully (button disabled) where the WebView2 has no speech backend. |
| Background agents w/ git-worktree isolation, `merge_agent_branch` | ✅ | **Done + verified end-to-end.** `start_agent` cuts a `yumi/agent-<id>` branch in an isolated git worktree under `%TEMP%\yumi-agents\`, runs a headless `claude -p` there, then commits the changes; the Agents panel shows status + diff + Merge/Cancel/Remove. `merge_agent_branch` merges back and retires the worktree. Verified: an agent appended a line to a file, committed (`DONE — 1 file changed`), then **Merge** landed it on `master` and removed the worktree (`docs/evidence/p2-agent-done.png`, `p2-agent-merged.png`). Needs a git-repo cwd; degrades with a clear status otherwise. |
| Auto-update / VSCode companion extension | ⬜ | Out of scope |
| Licensing / payments / paywall | ⬜ | **Intentionally omitted** — the clone is free and ungated |

---

## Reliability notes (the two bugs that were root-caused + fixed)

1. **Env-leak hang (fixed).** When Yumi is launched from *inside* a Claude Code session, the
   spawned `claude` would inherit `CLAUDE_CODE_SESSION_ID` / `CLAUDECODE` / `ANTHROPIC_BASE_URL`
   / `CLAUDE_STREAM*`, causing session-id collision + proxy nesting → multi-minute hangs and
   zombie processes. **Fix:** `spawner.rs` strips all of these before spawn, so every spawned
   `claude` is a clean top-level session. (Absent when launching Yumi normally, but robust regardless.)

2. **Thinking-proxy could wedge the whole chat (fixed).** The proxy launcher returned its URL as
   soon as `node` *started*, not when it was actually listening — so a proxy that crashed (port
   race, bad path) left `claude` pointed at a dead URL, hanging forever. **Fix:** `proxy.rs` now
   TCP-probes that the proxy is listening *before* returning its URL; if unconfirmed it returns
   `None` and `claude` talks to the real API directly. Result: thinking display works when the
   proxy comes up, and the **core chat is never blocked** when it doesn't. The proxy script is
   located via an ancestor-walk for `resources/thinking-proxy.cjs` (works in `--no-bundle` dev and
   bundled), never the commercial app's install dir.

3. **Responsive finalization (`end_turn`, not `result`).** The spawned `claude -p` runs the user's
   post-turn Stop hooks *before* emitting the final `result` line, which in a heavy-hook environment
   can delay `result` by 30–60s after the answer is already on screen. Yumi finalizes the turn (flips
   the Stop button back to Send, re-enables input) on the `message_delta` `stop_reason:"end_turn"`
   signal, which arrives as soon as the answer completes. A `tool_use`/`pause_turn` stop_reason is
   *not* treated as terminal, so multi-step tool turns are unaffected. After finalizing, the backend
   keeps draining the lingering process's stdout silently (so its pipe never blocks and its hooks
   complete normally) but stops emitting — guaranteeing a lingering turn's late `result` can never
   corrupt a newer turn that reused the same session id. **Verified:** Stop→Send flips at ~10s vs.
   the old ~47s (`yumi_td_10s.png`, stable at `yumi_td_22s.png`).

4. **Analytics + cost without sacrificing responsiveness (new).** The `result` line carries
   the turn's real cost + token totals but arrives late (after the hook-delayed finalize), and
   the UI never sees it because the backend stops emitting once finalized. Rather than wait for
   it (which would re-introduce the old ~47s lag) or drop it (the old tradeoff), the backend
   *parses the drained `result` itself*: it records an analytics row (`record_analytics`) for the
   dashboard, and — if the turn was already finalized — emits a lightweight `claude-cost`
   side-channel event so the per-message footer can show cost + duration. The `claude-cost`
   emission is pid-gated (`registry.is_current`) so it can never attach to a newer turn that
   reused the session id. Net: the dashboard and cost footer are populated with accurate data,
   and the chat stays as responsive as before.

5. **Sidecars survive bundling (`resource_dir` resolution).** The `.cjs` sidecars
   (`yumi-mcp-bash.cjs`, `thinking-proxy.cjs`) and the `yumi-plugin/` tree are declared
   as Tauri `resources` in `tauri.conf.json`, and resolved at runtime by
   `claude::resources::resolve_resource` — which tries `app.path().resource_dir()/resources/<name>`
   FIRST and only falls back to the dev-layout ancestor-walk. The runtime no longer
   *depends* on the walk. Verified: `cargo build` stages them to
   `target/debug/resources/` so `resource_dir()` resolves even in the `--no-bundle`
   dev build. (Producing the NSIS installer itself is out of scope — the toolchain
   isn't installed — but the resource-resolution path is implemented + confirmed.)

6. **Robustness checklist (research §3.5) addressed.**
   - *Polymorphic `tool_result.content`* — the parser flattens string / array /
     object (`{content}`/`{output}`/`{text}`) forms (tested).
   - *Subagent isolation* — a non-null top-level `parent_tool_use_id` makes the
     whole line `raw`, so a subagent's `end_turn` can never finalize/pollute the
     main turn (tested).
   - */compact mints a new session id mid-stream* — the parser surfaces each
     `system/init` session id; `store._onSessionId` rebinds the resume id (tested
     at the parser; store binding is the existing `claude-session-id` path).
   - *Panic-safe process guard* — every spawned child (the `claude` turns AND the
     thinking-proxy node process) is tracked in a process-wide set; a panic hook
     tree-kills them on a host panic, and the Tauri `RunEvent::Exit` handler kills
     them on normal teardown — so none leak (`process::guard`, tested + GUI-verified
     the proxy dies on window close).
   - *DB pruning* — `Db::prune` caps stored sessions (newest 500) and ages out
     analytics (>1y) at startup, bounding growth for long-lived installs (tested).

## Verification gates (all green)

- `cargo test` — 38 parser/provider/registry/guard/db/resources unit tests pass
  (was 25; +13 for the v1 work: message_start usage, subagent isolation, polymorphic
  tool_result, provider env-injection ×4, resource-walk fallback, process guard, DB prune).
- `node resources/tests/mcp_server.test.mjs` — 12/12 (initialize, tools/list = 5 tools, RunBash output + cwd tracking, background-proc lifecycle).
- `tsc && vite build` — 0 errors. `npx tauri build --debug --no-bundle` — builds `yumi.exe`.
- Real GUI round-trip: typed prompt → spawn → streamed thinking block + markdown answer → finalized to Send arrow → persisted to sidebar. Screenshots in `C:\dev\yume-test\yumi_*.png`.
- **Metrics round-trip (2026-06-25):** drove the rebuilt `yumi.exe` through one real turn (`what is 17 times 4` → `17 × 4 = 68`). The `analytics` table went 0 → 1 row (`claude-opus-4-8`, 8525 in / 11 out, $0.50), the message footer showed **`⏱ 40.3s`** + **`⚡ $0.50`**, and the Analytics dashboard rendered real totals. Evidence: `docs/evidence/metrics-footer.png`, `docs/evidence/metrics-analytics.png`.
- **P2 features round-trip (2026-06-25):** drove the rebuilt `yumi.exe` through every new P2 surface. Split grid F7×2 → 3 live panes; Settings shows the provider picker + live-bash toggle; an agent ran in a worktree, committed, and **Merge** landed its change on `master`; with the bash monitor on, a `tick-1..6` loop streamed live into the running `mcp__yumi-bash__RunBash` tool card. Evidence: `docs/evidence/p2-*.png`.
