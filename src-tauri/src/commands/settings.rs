//! Settings + theme commands. Persisted to the `settings` table as a single
//! JSON blob under the `settings` key, with `theme` mirrored under `theme`.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::state::AppState;

/// Matches `Settings` in types.ts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    // `provider`/`bashMonitor` carry serde defaults so settings blobs written
    // before these fields existed still deserialize cleanly.
    #[serde(default = "default_provider")]
    pub provider: String,
    /// `ANTHROPIC_BASE_URL` for routed (non-Claude) providers — a
    /// claude-code-router / LiteLLM / OpenRouter endpoint. Empty = none configured.
    #[serde(default)]
    pub router_base_url: String,
    pub model: String,
    pub theme: String,
    pub vim_mode: bool,
    pub thinking: bool,
    pub show_rate_limit: bool,
    #[serde(default)]
    pub bash_monitor: bool,
    pub auto_compact_threshold: f64,
}

fn default_provider() -> String {
    "claude".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        // Mirrors DEFAULT_SETTINGS in types.ts.
        Self {
            provider: default_provider(),
            router_base_url: String::new(),
            model: "claude-opus-4-8".to_string(),
            theme: "yume".to_string(),
            vim_mode: false,
            thinking: true,
            show_rate_limit: true,
            bash_monitor: false,
            auto_compact_threshold: 0.75,
        }
    }
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<Settings, String> {
    let state = app.state::<AppState>();
    match state.db.get_setting("settings").map_err(|e| e.to_string())? {
        Some(json) => serde_json::from_str::<Settings>(&json)
            .or_else(|_| Ok::<Settings, String>(Settings::default()))
            .map_err(|e: String| e),
        None => Ok(Settings::default()),
    }
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let state = app.state::<AppState>();
    let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    state
        .db
        .set_setting("settings", &json)
        .map_err(|e| e.to_string())?;
    state
        .db
        .set_setting("theme", &settings.theme)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    // Persist theme into the settings blob too (so get_settings stays consistent).
    let mut settings = match state.db.get_setting("settings").map_err(|e| e.to_string())? {
        Some(json) => serde_json::from_str::<Settings>(&json).unwrap_or_default(),
        None => Settings::default(),
    };
    settings.theme = theme.clone();
    let blob = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    state.db.set_setting("settings", &blob).map_err(|e| e.to_string())?;
    state.db.set_setting("theme", &theme).map_err(|e| e.to_string())?;
    Ok(())
}
