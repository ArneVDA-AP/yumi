//! Resolve bundled `resources/<name>` sidecars (MCP bash server, thinking
//! proxy, plugin files).
//!
//! Resolution order:
//! 1. The Tauri-declared resource dir (`resource_dir()/resources/<name>`) — the
//!    layout a real bundled install ships. Tried FIRST so the runtime no longer
//!    DEPENDS on the dev-layout walk to find its sidecars.
//! 2. Fallback: walk up from the executable for a sibling `resources/<name>`,
//!    which resolves the `--no-bundle` dev build (exe at
//!    `src-tauri/target/debug/`, resources at the project root).

use std::path::{Path, PathBuf};

/// Resolve a sidecar by name, preferring the bundled resource dir and falling
/// back to the dev-layout ancestor walk. `None` if it can't be found either way.
/// (Tauri-runtime dependent — excluded from the unit-test binary, like the
/// spawner that calls it; the pure `ancestor_resource` walk below is tested.)
#[cfg(not(test))]
pub fn resolve_resource(app: &tauri::AppHandle, name: &str) -> Option<PathBuf> {
    use tauri::Manager;
    if let Ok(dir) = app.path().resource_dir() {
        let candidate = dir.join("resources").join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    let exe = std::env::current_exe().ok()?;
    ancestor_resource(exe.parent()?, name)
}

/// Walk up from `start`, returning the first existing `resources/<name>`.
/// Pure (no AppHandle / process state) so the fallback chain is unit-testable.
pub fn ancestor_resource(start: &Path, name: &str) -> Option<PathBuf> {
    for ancestor in start.ancestors() {
        let candidate = ancestor.join("resources").join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ancestor_resource_finds_sibling_resources_dir() {
        // Lay out a fake tree: <tmp>/a/b/c (start) with <tmp>/a/resources/x.cjs.
        let base = std::env::temp_dir().join(format!("yumi-res-test-{}", std::process::id()));
        let deep = base.join("a").join("b").join("c");
        let res = base.join("a").join("resources");
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::create_dir_all(&res).unwrap();
        let script = res.join("x.cjs");
        std::fs::write(&script, b"// sidecar").unwrap();

        let found = ancestor_resource(&deep, "x.cjs");
        assert_eq!(found.as_deref(), Some(script.as_path()));

        // A name that doesn't exist resolves to None.
        assert!(ancestor_resource(&deep, "nope.cjs").is_none());

        let _ = std::fs::remove_dir_all(&base);
    }
}
