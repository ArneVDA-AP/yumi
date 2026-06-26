//! Locate the `claude` CLI binary and query its version.

use std::path::PathBuf;
use std::process::Command;

#[cfg(windows)]
use crate::platform::CREATE_NO_WINDOW;

/// Locate the `claude` binary.
///
/// Order:
/// 1. `claude` / `claude.exe` / `claude.cmd` on PATH.
/// 2. `%USERPROFILE%\.local\bin\claude.exe` (and `claude` / `claude.cmd` there).
///
/// Returns the resolved path, or `None` if not found.
pub fn locate_claude() -> Option<PathBuf> {
    locate_on_path_or_local(candidate_names().iter().copied())
}

/// Generic binary locator: probe each candidate name on PATH first, then in
/// `%USERPROFILE%\.local\bin`. Returns the first hit.
pub(crate) fn locate_on_path_or_local<'a>(names: impl Iterator<Item = &'a str> + Clone) -> Option<PathBuf> {
    for name in names.clone() {
        if let Some(p) = which_on_path(name) {
            return Some(p);
        }
    }
    if let Some(home) = dirs::home_dir() {
        let local_bin = home.join(".local").join("bin");
        for name in names {
            let candidate = local_bin.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn candidate_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["claude.exe", "claude.cmd", "claude.bat", "claude"]
    } else {
        &["claude"]
    }
}

/// Search the PATH environment variable for an executable named `name`.
fn which_on_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Run `claude --version` and return the trimmed output. The CLI on Windows may
/// be a `.cmd`/`.bat` shim, so we go through the shell when the located path
/// isn't a plain `.exe`.
pub fn get_claude_version() -> Result<String, String> {
    let bin = locate_claude().ok_or_else(|| {
        "claude binary not found on PATH or in %USERPROFILE%\\.local\\bin".to_string()
    })?;

    let output = build_version_command(&bin)
        .output()
        .map_err(|e| format!("failed to run claude --version: {e}"))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            return Ok(stdout);
        }
        // Some shims print version to stderr.
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Ok(stderr)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(format!("claude --version exited non-zero: {stderr}"))
    }
}

/// Build the `claude --version` Command, going through cmd.exe for shim scripts
/// (.cmd/.bat) on Windows since they cannot be CreateProcess'd directly.
fn build_version_command(bin: &PathBuf) -> Command {
    let is_shim = bin
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let e = e.to_ascii_lowercase();
            e == "cmd" || e == "bat"
        })
        .unwrap_or(false);

    let mut cmd = if cfg!(windows) && is_shim {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(bin).arg("--version");
        c
    } else {
        let mut c = Command::new(bin);
        c.arg("--version");
        c
    };

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd
}
