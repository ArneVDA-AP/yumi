// The monitor emits Tauri events; excluded from `cargo test` for the same
// reason as the command handlers (see lib.rs).
#[cfg(not(test))]
pub mod monitor;
