//! Process-wide guard so spawned `claude` children die WITH the host — even on
//! a panic — not only on a clean registry tree-kill (Yume's `ServerProcessGuard`
//! equivalent).
//!
//! Every spawned child PID is tracked in a global set. A panic hook installed at
//! startup tree-kills the whole set before the process unwinds, and the Tauri
//! `RunEvent::Exit` handler calls `kill_all` on normal teardown. Children remove
//! themselves on clean exit, so the set only ever holds live processes.

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use crate::process::registry::kill_process_tree;

fn children() -> &'static Mutex<HashSet<u32>> {
    static CHILDREN: OnceLock<Mutex<HashSet<u32>>> = OnceLock::new();
    CHILDREN.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Start tracking a freshly-spawned child PID.
pub fn track(pid: u32) {
    if let Ok(mut set) = children().lock() {
        set.insert(pid);
    }
}

/// Stop tracking a child that has exited (clean teardown of the streaming task).
pub fn untrack(pid: u32) {
    if let Ok(mut set) = children().lock() {
        set.remove(&pid);
    }
}

/// Tree-kill every tracked child (best-effort) and clear the set.
pub fn kill_all() {
    let pids: Vec<u32> = match children().lock() {
        Ok(mut set) => set.drain().collect(),
        Err(_) => return,
    };
    for pid in pids {
        let _ = kill_process_tree(pid);
    }
}

/// Install a panic hook that kills all tracked children before the previous hook
/// runs — so a host panic never orphans a spawned `claude`. Idempotent.
pub fn install_panic_hook() {
    static INSTALLED: OnceLock<()> = OnceLock::new();
    INSTALLED.get_or_init(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            kill_all();
            previous(info);
        }));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn count() -> usize {
        children().lock().unwrap().len()
    }

    #[test]
    fn track_then_untrack_updates_the_set() {
        // Use an implausible PID so nothing real is ever touched.
        let pid = 4_000_000_077;
        let base = count();
        track(pid);
        assert_eq!(count(), base + 1);
        untrack(pid);
        assert_eq!(count(), base);
        // Untracking an unknown pid is a harmless no-op.
        untrack(pid);
        assert_eq!(count(), base);
    }
}
