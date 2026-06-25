//! Application state managed by Tauri (`tauri::Manager`).

use crate::claude::proxy::ProxyState;
use crate::db::Db;
use crate::process::registry::ProcessRegistry;

/// Shared application state. Registered via `app.manage(AppState { .. })` and
/// accessed in commands through `app.state::<AppState>()`.
pub struct AppState {
    pub registry: ProcessRegistry,
    pub proxy: ProxyState,
    pub db: Db,
    // The agents registry pulls in the spawn/Tauri-event path, which is excluded
    // from `cargo test` (see lib.rs), so gate the field the same way.
    #[cfg(not(test))]
    pub agents: crate::agents::AgentRegistry,
}

impl AppState {
    pub fn new(db: Db) -> Self {
        Self {
            registry: ProcessRegistry::new(),
            proxy: ProxyState::new(),
            db,
            #[cfg(not(test))]
            agents: crate::agents::AgentRegistry::new(),
        }
    }
}
