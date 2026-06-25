//! Project list / recent-projects commands. Stored as JSON under the `settings`
//! table key `recent_projects` so we don't need an extra table.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::state::AppState;

const RECENT_KEY: &str = "recent_projects";
const MAX_RECENT: usize = 20;

/// Matches `RecentProject` in types.ts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub last_opened: i64,
}

fn load_recent(app: &AppHandle) -> Vec<RecentProject> {
    let state = app.state::<AppState>();
    match state.db.get_setting(RECENT_KEY) {
        Ok(Some(json)) => serde_json::from_str(&json).unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn store_recent(app: &AppHandle, list: &[RecentProject]) -> Result<(), String> {
    let state = app.state::<AppState>();
    let json = serde_json::to_string(list).map_err(|e| e.to_string())?;
    state.db.set_setting(RECENT_KEY, &json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<RecentProject>, String> {
    let mut list = load_recent(&app);
    list.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    Ok(list)
}

#[tauri::command]
pub fn add_recent_project(app: AppHandle, path: String) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    let mut list = load_recent(&app);
    // De-dup by path; refresh timestamp.
    list.retain(|p| p.path != path);
    list.insert(
        0,
        RecentProject {
            path,
            name,
            last_opened: now,
        },
    );
    list.truncate(MAX_RECENT);
    store_recent(&app, &list)
}
