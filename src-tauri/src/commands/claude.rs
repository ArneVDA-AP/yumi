//! Claude lifecycle commands: version, spawn, interrupt, usage limits.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::claude::binary::get_claude_version as bin_version;
use crate::claude::spawner::{spawn_claude as do_spawn, SpawnOpts};
use crate::state::AppState;

#[tauri::command]
pub fn get_claude_version() -> Result<String, String> {
    bin_version()
}

#[tauri::command]
pub async fn spawn_claude(app: AppHandle, opts: SpawnOpts) -> Result<String, String> {
    do_spawn(app, opts).await
}

#[tauri::command]
pub fn interrupt_claude(app: AppHandle, session_id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.registry.interrupt(&session_id).map(|_| ())
}

/// Matches `UsageLimits` in types.ts. Best-effort stub for now (rateLimited:false).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageLimits {
    pub rate_limited: bool,
    #[serde(rename = "fiveHourPct", skip_serializing_if = "Option::is_none")]
    pub five_hour_pct: Option<f64>,
    #[serde(rename = "sevenDayPct", skip_serializing_if = "Option::is_none")]
    pub seven_day_pct: Option<f64>,
    #[serde(rename = "resetsAt", skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<String>,
}

#[tauri::command]
pub fn get_usage_limits(_force: bool) -> Result<UsageLimits, String> {
    Ok(UsageLimits {
        rate_limited: false,
        five_hour_pct: None,
        seven_day_pct: None,
        resets_at: None,
    })
}
