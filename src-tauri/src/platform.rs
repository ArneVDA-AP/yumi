//! Platform-level constants and cross-cutting utilities shared across modules.

/// Creation flag that hides the console window for spawned processes on Windows.
/// Every `Command::creation_flags(CREATE_NO_WINDOW)` call in this codebase uses
/// this value — declared once here to avoid the copy-paste across 7 files.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Current wall-clock time in epoch milliseconds (the unit `analytics.created_at`
/// is stored in). Returns 0 if the system clock is before the Unix epoch.
pub fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
