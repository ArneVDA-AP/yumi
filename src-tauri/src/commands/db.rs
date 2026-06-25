//! Database-backed commands (sessions + analytics).

use tauri::{AppHandle, Manager};

use crate::db::{Analytics, SessionDetail, SessionMeta};
use crate::state::AppState;

#[tauri::command]
pub fn db_list_sessions(app: AppHandle) -> Result<Vec<SessionMeta>, String> {
    let state = app.state::<AppState>();
    state.db.list_sessions().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_session(app: AppHandle, id: String) -> Result<SessionDetail, String> {
    let state = app.state::<AppState>();
    state.db.get_session(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_session(app: AppHandle, detail: SessionDetail) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.db.save_session(&detail).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_session(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.db.delete_session(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_analytics(app: AppHandle) -> Result<Analytics, String> {
    let state = app.state::<AppState>();
    state.db.get_analytics().map_err(|e| e.to_string())
}
