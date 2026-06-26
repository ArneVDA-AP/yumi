pub mod binary;
// `provider` is pure (the spawn-plan builder + provider enum); kept compiled in
// the test binary so the multi-provider env-injection logic is unit-tested.
pub mod provider;
pub mod proxy;
// `resources` resolves bundled sidecars. Its Tauri-runtime `resolve_resource` is
// gated out of tests; the pure `ancestor_resource` fallback walk is tested.
pub mod resources;
pub mod session;
pub mod stream_parser;

// The spawner emits Tauri events and is only invoked from command handlers,
// which are excluded from `cargo test` (see lib.rs). Excluding it here too keeps
// the unit-test binary free of the Tauri GUI runtime.
#[cfg(not(test))]
pub mod spawner;
