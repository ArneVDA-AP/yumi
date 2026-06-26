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

/// Matches `UsageLimits` in types.ts.
///
/// There is no reliable LOCAL source of 5h/7d rolling-window percentages:
/// `~/.claude/stats-cache.json` holds historical token *statistics* (no
/// rolling-window %), and the only true source is the OAuth usage endpoint
/// (fragile, network, user creds — out of scope for a clone). So this command is
/// honestly inert: `live:false` tells the UI to grey the pills as "unavailable".
/// Real status DOES arrive in-stream: the CLI emits `rate_limit_event` lines
/// (status / resetsAt / window), which the frontend wires into the pills live.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageLimits {
    pub rate_limited: bool,
    /// True only when this reflects a real signal (a live `rate_limit_event`).
    /// `false` here means "no data" → the UI greys the pills.
    pub live: bool,
    #[serde(rename = "windowType", skip_serializing_if = "Option::is_none")]
    pub window_type: Option<String>,
    #[serde(rename = "fiveHourPct", skip_serializing_if = "Option::is_none")]
    pub five_hour_pct: Option<f64>,
    #[serde(rename = "sevenDayPct", skip_serializing_if = "Option::is_none")]
    pub seven_day_pct: Option<f64>,
    #[serde(rename = "resetsAt", skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<String>,
}

#[tauri::command]
pub fn get_usage_limits(_force: bool) -> Result<UsageLimits, String> {
    // No local rolling-window source → return an honestly-inert state. The pills
    // grey out (live:false) until a real in-stream `rate_limit_event` populates them.
    Ok(UsageLimits {
        rate_limited: false,
        live: false,
        window_type: None,
        five_hour_pct: None,
        seven_day_pct: None,
        resets_at: None,
    })
}
