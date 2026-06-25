//! Minimal crash-recovery hook.
//!
//! On startup we best-effort clean up stale bash stream files left behind by a
//! previous (possibly crashed) run so they don't replay old output. Kept tiny;
//! expand in P1 if real recovery (re-attaching to orphaned sessions) is needed.

/// Remove stale `yumi-bash-*.log` files older than a day from the temp dir.
pub fn cleanup_stale_streams() {
    let temp = std::env::temp_dir();
    let entries = match std::fs::read_dir(&temp) {
        Ok(e) => e,
        Err(_) => return,
    };
    let now = std::time::SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("yumi-bash-") && name.ends_with(".log") {
            if let Ok(meta) = entry.metadata() {
                if let Ok(modified) = meta.modified() {
                    if let Ok(age) = now.duration_since(modified) {
                        if age.as_secs() > 86_400 {
                            let _ = std::fs::remove_file(entry.path());
                        }
                    }
                }
            }
        }
    }
}
