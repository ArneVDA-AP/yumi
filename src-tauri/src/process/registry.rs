//! Process registry: maps `sessionId` → child PID so `interrupt_claude` can
//! tree-kill the running `claude` process (and its descendants) on Windows.

use std::collections::HashMap;
use std::process::Command;
use std::sync::Mutex;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Thread-safe registry of active claude processes keyed by frontend sessionId.
#[derive(Default)]
pub struct ProcessRegistry {
    inner: Mutex<HashMap<String, u32>>,
}

impl ProcessRegistry {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// Record the PID of a freshly-spawned claude process.
    pub fn register(&self, session_id: &str, pid: u32) {
        if let Ok(mut map) = self.inner.lock() {
            map.insert(session_id.to_string(), pid);
        }
    }

    /// Remove a session from the registry (on process exit). Returns the PID if present.
    pub fn unregister(&self, session_id: &str) -> Option<u32> {
        self.inner.lock().ok().and_then(|mut m| m.remove(session_id))
    }

    /// Remove a session only if it still maps to `pid`. A turn whose process
    /// lingers (running post-turn Stop hooks) may finish long after the user has
    /// started a NEW turn that reused the same sessionId; a blind `unregister`
    /// there would drop the newer process's registration and break its Stop
    /// button. This no-ops unless the stored PID is still the caller's.
    pub fn unregister_if(&self, session_id: &str, pid: u32) {
        if let Ok(mut m) = self.inner.lock() {
            if m.get(session_id).copied() == Some(pid) {
                m.remove(session_id);
            }
        }
    }

    pub fn pid_for(&self, session_id: &str) -> Option<u32> {
        self.inner.lock().ok().and_then(|m| m.get(session_id).copied())
    }

    /// True if `pid` is still the process registered for this session. Used to
    /// gate late side-channel events (e.g. a drained turn's `result` cost) so a
    /// lingering turn can't push data onto a NEWER turn that reused the id.
    pub fn is_current(&self, session_id: &str, pid: u32) -> bool {
        self.pid_for(session_id) == Some(pid)
    }

    /// Interrupt (tree-kill) the claude process for a session.
    /// Returns Ok(true) if a process was found and a kill was attempted.
    pub fn interrupt(&self, session_id: &str) -> Result<bool, String> {
        let pid = match self.pid_for(session_id) {
            Some(p) => p,
            None => return Ok(false),
        };
        kill_process_tree(pid)?;
        self.unregister(session_id);
        Ok(true)
    }
}

/// Tree-kill a process by PID on Windows.
///
/// Enumerate descendant PIDs (via `wmic`), then `taskkill /PID <pid> /T /F`
/// which already terminates the whole tree; the explicit child enumeration is a
/// belt-and-suspenders fallback for environments where `/T` misses a grandchild.
#[cfg(windows)]
pub fn kill_process_tree(pid: u32) -> Result<(), String> {
    // Best-effort: enumerate children first (so we can kill them even if taskkill /T
    // is unavailable), then taskkill the root with /T (tree) /F (force).
    let children = enumerate_child_pids(pid);

    // Kill the root tree.
    let _ = run_taskkill(pid);

    // Kill any enumerated children that survived (e.g. re-parented).
    for child in children {
        let _ = run_taskkill(child);
    }

    Ok(())
}

#[cfg(not(windows))]
pub fn kill_process_tree(pid: u32) -> Result<(), String> {
    // Non-Windows fallback (not the target platform, but keep it compiling).
    let _ = Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .status();
    Ok(())
}

#[cfg(windows)]
fn run_taskkill(pid: u32) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|_| ())
        .map_err(|e| format!("taskkill failed for pid {pid}: {e}"))
}

/// Enumerate direct child PIDs of `pid` via `wmic`. Returns an empty vec on any
/// failure (wmic missing, process gone, parse error) — callers treat it as best-effort.
#[cfg(windows)]
fn enumerate_child_pids(pid: u32) -> Vec<u32> {
    use std::os::windows::process::CommandExt;
    let output = Command::new("wmic")
        .args([
            "process",
            "where",
            &format!("(ParentProcessId={pid})"),
            "get",
            "ProcessId",
            "/format:list",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    let mut pids = Vec::new();
    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            if let Some(rest) = line.trim().strip_prefix("ProcessId=") {
                if let Ok(child) = rest.trim().parse::<u32>() {
                    if child != 0 && child != pid {
                        pids.push(child);
                    }
                }
            }
        }
    }
    pids
}
