//! Git commands: status (porcelain) and diff. Shell out to the `git` binary.

use std::process::Command;

use serde::{Deserialize, Serialize};

#[cfg(windows)]
use crate::platform::CREATE_NO_WINDOW;

/// Matches `GitStatus` in types.ts.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub staged: Vec<String>,
    pub unstaged: Vec<String>,
    pub untracked: Vec<String>,
}

fn git(cwd: &str, args: &[&str]) -> Result<std::process::Output, String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.output().map_err(|e| format!("git {args:?}: {e}"))
}

#[tauri::command]
pub fn git_status(cwd: String) -> Result<GitStatus, String> {
    // `git status --porcelain=v1 --branch` gives branch + ahead/behind + file states.
    let out = git(&cwd, &["status", "--porcelain=v1", "--branch"])?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "git status failed".to_string()
        } else {
            err
        });
    }

    let text = String::from_utf8_lossy(&out.stdout);
    let mut status = GitStatus::default();

    for line in text.lines() {
        if let Some(branch_line) = line.strip_prefix("## ") {
            parse_branch_line(branch_line, &mut status);
            continue;
        }
        if line.len() < 2 {
            continue;
        }
        let bytes = line.as_bytes();
        let x = bytes[0] as char; // staged (index) status
        let y = bytes[1] as char; // unstaged (worktree) status
        let file = line[3..].to_string();

        if x == '?' && y == '?' {
            status.untracked.push(file);
            continue;
        }
        if x != ' ' && x != '?' {
            status.staged.push(file.clone());
        }
        if y != ' ' && y != '?' {
            status.unstaged.push(file);
        }
    }

    Ok(status)
}

/// Parse the `## ` branch header line, e.g.
/// `## main...origin/main [ahead 1, behind 2]`
fn parse_branch_line(line: &str, status: &mut GitStatus) {
    // Branch name is up to the first space or `...`.
    let branch_part = line.split("...").next().unwrap_or(line);
    let branch = branch_part.split_whitespace().next().unwrap_or("").to_string();
    status.branch = branch;

    if let Some(start) = line.find('[') {
        if let Some(end) = line[start..].find(']') {
            let inside = &line[start + 1..start + end];
            for token in inside.split(',') {
                let token = token.trim();
                if let Some(n) = token.strip_prefix("ahead ") {
                    status.ahead = n.trim().parse().unwrap_or(0);
                } else if let Some(n) = token.strip_prefix("behind ") {
                    status.behind = n.trim().parse().unwrap_or(0);
                }
            }
        }
    }
}

#[tauri::command]
pub fn git_diff(cwd: String, staged: bool) -> Result<String, String> {
    let args: &[&str] = if staged {
        &["diff", "--staged"]
    } else {
        &["diff"]
    };
    let out = git(&cwd, args)?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "git diff failed".to_string()
        } else {
            err
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}
