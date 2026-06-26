//! Spawn the `claude` CLI and stream its stdout as `claude-event`s.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::process::Stdio;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::claude::binary::locate_claude;
use crate::claude::provider::{build_spawn_plan, Provider};
use crate::claude::resources::resolve_resource;
use crate::claude::session::resume_arg;
use crate::claude::stream_parser::{parse_line, ClaudeEvent};
use crate::state::AppState;

#[cfg(windows)]
use crate::platform::CREATE_NO_WINDOW;

/// Spawn options sent from the frontend (matches `SpawnOpts` in types.ts).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnOpts {
    pub session_id: String,
    pub cwd: String,
    pub prompt: String,
    pub model: String,
    #[serde(default)]
    pub provider: Option<String>,
    /// `ANTHROPIC_BASE_URL` for a routed (non-Claude) provider — a
    /// claude-code-router / LiteLLM / OpenRouter endpoint. Empty/absent for Claude.
    #[serde(default)]
    pub router_base_url: Option<String>,
    #[serde(default)]
    pub resume_id: Option<String>,
    #[serde(default)]
    pub thinking: Option<bool>,
    #[serde(default)]
    pub bash_monitor: Option<bool>,
}

/// Spawn claude for a session. Returns the sessionId on successful launch.
/// Streaming happens on a background tokio task; events arrive via `app.emit`.
pub async fn spawn_claude(app: AppHandle, opts: SpawnOpts) -> Result<String, String> {
    let provider = Provider::from_id(opts.provider.as_deref());

    // Every provider drives the SAME `claude` binary + stream-json parser; a
    // non-Claude provider is realized by pointing it at a router via
    // ANTHROPIC_BASE_URL (see provider.rs / build_spawn_plan), not by spawning a
    // foreign CLI that can't emit stream-json.
    let bin = locate_claude().ok_or_else(|| {
        "claude binary not found on PATH or in %USERPROFILE%\\.local\\bin".to_string()
    })?;

    let session_id = opts.session_id.clone();

    // Resolve the claude args + the optional router base URL for this provider.
    // `--resume` replays this session's transcript to whatever ANTHROPIC_BASE_URL
    // points at, so it works for routed providers too. A non-Claude provider with
    // no configured router URL returns a clear error here (never a fake success).
    let resume = resume_arg(opts.resume_id.as_deref());
    let router_url = opts.router_base_url.clone().unwrap_or_default();
    let plan = build_spawn_plan(provider, &opts.prompt, &opts.model, resume.as_deref(), &router_url)?;
    let mut args = plan.args;

    // BASH-MONITOR (opt-in): register the bundled MCP bash server and force shell
    // through it (disallow the built-in Bash) so command output streams to a file
    // the monitor tails live. Gated behind the setting, so the default path stays
    // the verified core chat.
    let bash_monitor = opts.bash_monitor.unwrap_or(false);
    let mut mcp_config_path: Option<std::path::PathBuf> = None;
    if bash_monitor {
        if let Some(cfg) = write_bash_mcp_config(&app, &session_id) {
            args.push("--mcp-config".into());
            args.push(cfg.to_string_lossy().to_string());
            args.push("--disallowedTools".into());
            args.push("Bash".into());
            mcp_config_path = Some(cfg);
        }
    }

    // Pick the ANTHROPIC_BASE_URL to inject. A routed provider's router URL wins
    // (plan.base_url is Some only for non-Claude providers); otherwise optionally
    // launch the thinking proxy and point claude at it.
    let base_url = if let Some(router) = plan.base_url {
        Some(router)
    } else if opts.thinking.unwrap_or(false) {
        match resolve_resource(&app, "thinking-proxy.cjs") {
            Some(script) => app.state::<AppState>().proxy.ensure_running(script),
            None => None,
        }
    } else {
        None
    };

    let is_shim = bin
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let e = e.to_ascii_lowercase();
            e == "cmd" || e == "bat"
        })
        .unwrap_or(false);

    // On Windows, .cmd/.bat shims must be launched through cmd.exe.
    let mut command = if cfg!(windows) && is_shim {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(&bin);
        for a in &args {
            c.arg(a);
        }
        c
    } else {
        let mut c = Command::new(&bin);
        for a in &args {
            c.arg(a);
        }
        c
    };

    // Sanitize the inherited environment: never leak a PARENT Claude Code
    // session into the child. If Yumi (or its launcher) was itself started
    // from inside a Claude Code session, vars like CLAUDE_CODE_SESSION_ID,
    // CLAUDECODE, and ANTHROPIC_BASE_URL (a thinking-proxy) would be inherited
    // by the spawned claude — causing session-id collisions, proxy nesting,
    // multi-minute hangs, and child processes that never exit. Strip them so
    // every spawned claude is a clean, top-level session.
    for (key, _) in std::env::vars() {
        let k = key.to_ascii_uppercase();
        if k.starts_with("CLAUDE_CODE_")
            || k == "CLAUDECODE"
            || k == "ANTHROPIC_BASE_URL"
            || k.starts_with("CLAUDE_STREAM")
        {
            command.env_remove(&key);
        }
    }

    command
        .current_dir(&opts.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CLAUDE_CODE_ENTRYPOINT", "yumi")
        // Stream file + session id for the MCP bash server / monitor. The names
        // must match what `resources/yumi-mcp-bash.cjs` reads (YUMI_*, not YUME_*).
        // When the bash monitor is on, the spawned claude IS given a
        // `--mcp-config` registering that server (see above) and `--disallowedTools
        // Bash`, so it routes shell through `mcp__yumi-bash__RunBash`, which writes
        // this file for `spawn_monitor` to tail.
        .env(
            "YUMI_STREAM_FILE",
            std::env::temp_dir()
                .join(format!("yumi-bash-{session_id}.log"))
                .to_string_lossy()
                .to_string(),
        )
        .env("YUMI_SESSION_ID", &session_id);

    if let Some(ref url) = base_url {
        command.env("ANTHROPIC_BASE_URL", url);
    }

    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to spawn {}: {e}", provider.id()))?;

    // Register PID for interrupt, and track it in the process-wide guard so it
    // dies with the host even on a panic (not only on a clean tree-kill).
    let child_pid = child.id();
    if let Some(pid) = child_pid {
        let state = app.state::<AppState>();
        state.registry.register(&session_id, pid);
        crate::process::guard::track(pid);
    }

    // BASH-MONITOR: tail this session's stream file and emit `bash-output` while
    // the turn runs. Aborted when the process exits (below).
    let monitor_handle = if bash_monitor {
        Some(crate::mcp::monitor::spawn_monitor(app.clone(), session_id.clone()))
    } else {
        None
    };

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture claude stdout".to_string())?;
    let stderr = child.stderr.take();

    // Drive everything on a background task so the command returns immediately.
    let app_clone = app.clone();
    let sid = session_id.clone();
    let model = opts.model.clone();
    let pid_opt = child_pid;
    tokio::spawn(async move {
        // Collect stderr in the background for diagnostics on failure.
        let stderr_handle = stderr.map(|err| {
            tokio::spawn(async move {
                let mut buf = String::new();
                let mut reader = BufReader::new(err).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    buf.push_str(&line);
                    buf.push('\n');
                }
                buf
            })
        });

        // Stream stdout line-by-line → parse → emit.
        let mut lines = BufReader::new(stdout).lines();
        // Once the turn is logically over (a TurnDone/end_turn or a result), we
        // STOP emitting but keep draining stdout. The spawned `claude -p` can
        // linger for many seconds after the answer (running post-turn Stop
        // hooks). Draining keeps its pipe from blocking; staying silent means a
        // lingering turn's late `result` can never reach a NEWER turn that
        // reused this sessionId — so no cross-turn corruption.
        let mut turn_finalized = false;
        let mut analytics_recorded = false;
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    for event in parse_line(&line) {
                        // The `result` line carries the turn's true cost + token
                        // totals, but it usually arrives AFTER we finalized on
                        // `end_turn` (while we silently drain the lingering
                        // process). Capture it here whether or not we've
                        // finalized: record analytics once, and — if the UI never
                        // saw this result because the turn was already finalized —
                        // surface its cost/duration on a side channel.
                        if let ClaudeEvent::Result {
                            total_cost_usd,
                            duration_ms,
                            usage,
                            ..
                        } = &event
                        {
                            let cost_opt: Option<f64> = *total_cost_usd;
                            let dur_opt: Option<u64> = *duration_ms;
                            if !analytics_recorded {
                                analytics_recorded = true;
                                let (input_tokens, output_tokens) = result_tokens(usage);
                                let state = app_clone.state::<AppState>();
                                let _ = state.db.record_analytics(
                                    &sid,
                                    &model,
                                    input_tokens,
                                    output_tokens,
                                    cost_opt.unwrap_or(0.0),
                                    crate::platform::now_millis(),
                                );
                            }
                            if turn_finalized {
                                // Only push the late cost if THIS process still
                                // owns the session — a newer turn may have reused
                                // the id while we lingered on Stop hooks.
                                let still_current = match pid_opt {
                                    Some(pid) => {
                                        app_clone.state::<AppState>().registry.is_current(&sid, pid)
                                    }
                                    None => false,
                                };
                                if still_current {
                                    let _ = app_clone.emit(
                                        "claude-cost",
                                        json!({
                                            "sessionId": sid,
                                            "cost": cost_opt,
                                            "durationMs": dur_opt,
                                        }),
                                    );
                                }
                            }
                        }

                        // A `rate_limit_event` trails the `message_delta`/`end_turn`
                        // that already finalized the UI (real order: end_turn →
                        // rate_limit_event → result). Surface it REGARDLESS of
                        // finalize so the rate-limit pills update live — gated on
                        // THIS process still owning the session so a lingering turn
                        // can't push onto a newer one. (Without this the pills never
                        // light up, since the post-finalize drain below drops it.)
                        if let ClaudeEvent::RateLimit { .. } = &event {
                            let current = pid_opt.map_or(!turn_finalized, |pid| {
                                app_clone.state::<AppState>().registry.is_current(&sid, pid)
                            });
                            if current {
                                let _ = app_clone.emit(
                                    "claude-event",
                                    json!({ "sessionId": sid, "event": event }),
                                );
                            }
                            continue;
                        }

                        // After finalize we keep draining stdout (so the lingering
                        // process's pipe never blocks and its Stop hooks finish)
                        // but stop emitting normal stream events — a late event
                        // can never reach a newer turn that reused this sessionId.
                        if turn_finalized {
                            continue;
                        }

                        // On system/init, surface the learned claude UUID.
                        if let ClaudeEvent::System {
                            claude_session_id: Some(ref uuid),
                            ..
                        } = event
                        {
                            let _ = app_clone.emit(
                                "claude-session-id",
                                json!({ "sessionId": sid, "claudeSessionId": uuid }),
                            );
                        }
                        // TurnDone (end_turn, ~as soon as the answer is done) or
                        // a result line both finalize the turn. TurnDone usually
                        // arrives many seconds before result when Stop hooks run.
                        let finalizes = matches!(
                            event,
                            ClaudeEvent::TurnDone { .. } | ClaudeEvent::Result { .. }
                        );
                        let _ = app_clone.emit(
                            "claude-event",
                            json!({ "sessionId": sid, "event": event }),
                        );
                        if finalizes {
                            let _ = app_clone.emit(
                                "claude-complete",
                                json!({ "sessionId": sid, "code": 0 }),
                            );
                            turn_finalized = true;
                            break; // ignore any trailing events on this line
                        }
                    }
                }
                Ok(None) => break, // EOF
                Err(_) => break,
            }
        }

        // Wait for exit.
        let status = child.wait().await;

        // Stop tailing the bash stream + drop the temp MCP config (best-effort).
        if let Some(h) = monitor_handle {
            h.abort();
        }
        if let Some(cfg) = mcp_config_path {
            let _ = std::fs::remove_file(cfg);
        }

        // Deregister — but only if THIS process is still the registered one. A
        // newer turn may have reused the sessionId while we lingered on hooks.
        {
            let state = app_clone.state::<AppState>();
            match pid_opt {
                Some(pid) => state.registry.unregister_if(&sid, pid),
                None => {
                    state.registry.unregister(&sid);
                }
            }
        }
        // This child has exited — drop it from the process-wide guard set.
        if let Some(pid) = pid_opt {
            crate::process::guard::untrack(pid);
        }

        // If we already finalized (the normal path), the UI is done — don't emit
        // a late completion/error that could disturb a newer turn on this id.
        if turn_finalized {
            return;
        }

        let code = status.as_ref().ok().and_then(|s| s.code());
        let success = status.as_ref().map(|s| s.success()).unwrap_or(false);

        // On failure, emit claude-error with stderr (best-effort).
        if !success {
            let stderr_text = if let Some(handle) = stderr_handle {
                handle.await.unwrap_or_default()
            } else {
                String::new()
            };
            let message = if stderr_text.trim().is_empty() {
                match code {
                    Some(c) => format!("claude exited with code {c}"),
                    None => "claude terminated without an exit code".to_string(),
                }
            } else {
                stderr_text.trim().to_string()
            };
            let _ = app_clone.emit(
                "claude-error",
                json!({ "sessionId": sid, "message": message }),
            );
        }

        // Emit completion for turns that ended without a TurnDone/result
        // (crash, interrupt, login error, …).
        let _ = app_clone.emit(
            "claude-complete",
            json!({ "sessionId": sid, "code": code }),
        );
    });

    Ok(session_id)
}

/// Write a temporary MCP config that registers the bundled `yumi-mcp-bash.cjs`
/// server for this session (with its own session id + stream file), and reset
/// the stream file so the monitor only tails THIS turn's output. Returns the
/// config path, or `None` if the bundled script can't be found.
fn write_bash_mcp_config(app: &AppHandle, session_id: &str) -> Option<std::path::PathBuf> {
    let script = resolve_resource(app, "yumi-mcp-bash.cjs")?;
    let stream_file = std::env::temp_dir().join(format!("yumi-bash-{session_id}.log"));
    let _ = std::fs::remove_file(&stream_file); // fresh per turn

    let cfg = json!({
        "mcpServers": {
            "yumi-bash": {
                "command": "node",
                "args": [
                    script.to_string_lossy(),
                    format!("--session-id={session_id}"),
                    format!("--stream-file={}", stream_file.to_string_lossy()),
                ]
            }
        }
    });
    let path = std::env::temp_dir().join(format!("yumi-mcp-{session_id}.json"));
    std::fs::write(&path, serde_json::to_vec_pretty(&cfg).ok()?).ok()?;
    Some(path)
}

/// Extract `(input_tokens, output_tokens)` from a result line's `usage` object.
/// Missing/absent fields count as 0.
fn result_tokens(usage: &Option<serde_json::Value>) -> (i64, i64) {
    let get = |key: &str| -> i64 {
        usage
            .as_ref()
            .and_then(|u| u.get(key))
            .and_then(|v| v.as_i64())
            .unwrap_or(0)
    };
    (get("input_tokens"), get("output_tokens"))
}
