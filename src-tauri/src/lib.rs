//! Yumi Tauri backend entrypoint.
//!
//! Builds the Tauri application, opens the database, manages shared state
//! (settings + process registry + thinking proxy + db handle), and registers
//! every command in CONTRACT.md.

mod crash_recovery;
mod db;
pub mod platform;
mod state;

// Background agents use the Tauri event + spawn path, excluded from `cargo test`.
#[cfg(not(test))]
pub mod agents;
pub mod claude;
// Command handlers pull in the Tauri GUI runtime (wry/WebView2). Excluding them
// from `cargo test` keeps the unit-test binary free of the WebView2 loader init,
// which otherwise fails to launch on the windows-gnu toolchain (STATUS_
// ENTRYPOINT_NOT_FOUND). The pure logic under test (parser, session, db helpers)
// does not need them.
#[cfg(not(test))]
pub mod commands;
pub mod mcp;
pub mod process;

#[cfg(not(test))]
use state::AppState;

#[cfg(not(test))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Best-effort startup cleanup.
    crash_recovery::cleanup_stale_streams();

    // Kill any spawned `claude` children if the host panics (not only on a clean
    // registry tree-kill) — children are tracked in process::guard.
    process::guard::install_panic_hook();

    // Open the database (create ~/.yumi + tables if missing) and bound its growth
    // for long-lived installs (keep newest 500 sessions; analytics ≤ 1 year).
    let db = db::Db::open().expect("failed to open yumi database");
    let _ = db.prune(500, 365 * 24 * 60 * 60 * 1000, platform::now_millis());
    let app_state = AppState::new(db);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // claude lifecycle
            commands::claude::get_claude_version,
            commands::claude::spawn_claude,
            commands::claude::interrupt_claude,
            commands::claude::get_usage_limits,
            // settings
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::set_theme,
            // db / sessions
            commands::db::db_list_sessions,
            commands::db::db_get_session,
            commands::db::db_save_session,
            commands::db::db_delete_session,
            commands::db::db_get_analytics,
            // projects / fs
            commands::info::list_projects,
            commands::info::add_recent_project,
            commands::fs::pick_directory,
            commands::fs::list_directory,
            commands::fs::read_text_file,
            // git
            commands::git::git_status,
            commands::git::git_diff,
            // background agents
            agents::list_agents,
            agents::start_agent,
            agents::merge_agent_branch,
            agents::cancel_agent,
            agents::remove_agent,
            agents::agent_diff,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            // On normal teardown, tree-kill any still-running spawned children so
            // none are orphaned when the window closes mid-turn.
            if let tauri::RunEvent::Exit = event {
                process::guard::kill_all();
            }
        });
}
