//! Bash output monitor.
//!
//! Tails `%TEMP%\yumi-bash-<session>.log` (written by the bundled MCP bash
//! server) and emits `bash-output {sessionId, chunk}` as new bytes appear.
//! This is the P1 live-bash-streaming hook; the tail loop is implemented here
//! and wired from the spawner / a command in P1.

use std::io::SeekFrom;
use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

/// Compute the stream-file path for a session (mirrors the spawner env + MCP server).
pub fn stream_file_path(session_id: &str) -> PathBuf {
    std::env::temp_dir().join(format!("yumi-bash-{session_id}.log"))
}

/// Spawn a tokio task that tails the session's bash stream file and emits
/// `bash-output` events. The task ends when `should_stop()` would normally be
/// driven by process completion; here it runs until the app shuts down or the
/// returned handle is dropped/aborted.
pub fn spawn_monitor(app: AppHandle, session_id: String) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let path = stream_file_path(&session_id);
        let mut offset: u64 = 0;
        let mut buf = vec![0u8; 8192];

        loop {
            match tokio::fs::File::open(&path).await {
                Ok(mut file) => {
                    // Seek to where we left off.
                    if file.seek(SeekFrom::Start(offset)).await.is_err() {
                        offset = 0;
                        let _ = file.seek(SeekFrom::Start(0)).await;
                    }
                    loop {
                        match file.read(&mut buf).await {
                            Ok(0) => break, // no new data this pass
                            Ok(n) => {
                                offset += n as u64;
                                let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                                let _ = app.emit(
                                    "bash-output",
                                    serde_json::json!({ "sessionId": session_id, "chunk": chunk }),
                                );
                            }
                            Err(_) => break,
                        }
                    }
                }
                Err(_) => {
                    // File not created yet; keep polling.
                }
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    })
}
