//! Thinking proxy launcher.
//!
//! Lazily launches the bundled `resources/thinking-proxy.cjs` via `node` on a
//! free port in 18800..=18899 and returns the base URL to set as
//! `ANTHROPIC_BASE_URL`. Non-fatal by design: if node or the script is missing,
//! or the proxy never starts listening, returns `None` and the caller spawns
//! claude WITHOUT a proxy (pointing at the real API). This guarantees the core
//! chat is rock-solid — a broken proxy can never wedge a turn — while the
//! thinking display is enabled whenever the proxy genuinely comes up.

use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// How long to wait for node to start accepting connections before giving up.
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// Holds the running proxy so we launch at most one per app run.
#[derive(Default)]
pub struct ProxyState {
    inner: Mutex<ProxyInner>,
}

#[derive(Default)]
struct ProxyInner {
    /// Whether we've already tried to launch (success or failure). A failed
    /// launch is not retried — the failure mode (no node / no script) is stable
    /// for the app's lifetime, and retrying would add multi-second latency to
    /// every subsequent turn.
    attempted: bool,
    handle: Option<ProxyHandle>,
}

struct ProxyHandle {
    base_url: String,
    #[allow(dead_code)]
    pid: u32,
}

impl ProxyState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(ProxyInner::default()),
        }
    }

    /// Ensure the thinking proxy is running and *verified listening*; return its
    /// base URL, or `None` if it could not be confirmed. Idempotent: after the
    /// first attempt, returns the cached result without re-launching.
    pub fn ensure_running(&self) -> Option<String> {
        let mut guard = self.inner.lock().ok()?;
        if guard.attempted {
            return guard.handle.as_ref().map(|h| h.base_url.clone());
        }
        guard.attempted = true;

        let script = locate_proxy_script()?;
        let port = find_free_port(18800, 18899)?;

        let mut cmd = Command::new("node");
        cmd.arg(&script).env("THINKING_PROXY_PORT", port.to_string());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(_) => return None, // node missing → non-fatal
        };

        // Probe that the proxy is actually accepting connections before trusting
        // it. `spawn()` only confirms node *started*, not that the script bound
        // the port — if it crashed (port race, syntax error, bad env) claude
        // would point at a dead URL and hang forever. Confirm, or fall back.
        if probe_listening(port, PROBE_TIMEOUT) {
            let pid = child.id();
            let base_url = format!("http://127.0.0.1:{port}");
            guard.handle = Some(ProxyHandle {
                base_url: base_url.clone(),
                pid,
            });
            Some(base_url)
        } else {
            // Never confirmed listening — kill the (possibly hung) child so it
            // doesn't linger, and fall back to the real API.
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    }
}

/// Poll a loopback TCP connect until it succeeds or the deadline passes.
fn probe_listening(port: u16, timeout: Duration) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + timeout;
    loop {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Find the bundled `thinking-proxy.cjs`. Walks up from the executable looking
/// for a sibling `resources/thinking-proxy.cjs` — this resolves in both the
/// bundled layout (resources beside the exe) and the `--no-bundle` dev build
/// (exe at `src-tauri/target/debug/`, resources at the project root). A clone
/// never depends on the commercial app's install dir.
fn locate_proxy_script() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    for ancestor in exe_dir.ancestors() {
        let candidate = ancestor.join("resources").join("thinking-proxy.cjs");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Find a free TCP port in `[start, end]` by attempting to bind on loopback.
fn find_free_port(start: u16, end: u16) -> Option<u16> {
    for port in start..=end {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Some(port);
        }
    }
    None
}
