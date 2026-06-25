pub mod binary;
pub mod proxy;
pub mod session;
pub mod stream_parser;

// The spawner emits Tauri events and is only invoked from command handlers,
// which are excluded from `cargo test` (see lib.rs). Excluding it here too keeps
// the unit-test binary free of the Tauri GUI runtime. The provider abstraction
// is only consumed by the spawner, so it's gated the same way.
#[cfg(not(test))]
pub mod provider;
#[cfg(not(test))]
pub mod spawner;
