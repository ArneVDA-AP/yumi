//! Background agents.
//!
//! Each agent runs a `claude -p` turn inside an isolated **git worktree** on its
//! own branch (`yumi/agent-<id>`), so parallel agents never touch each other's
//! files or the user's working tree. When the run finishes, the worktree's
//! changes are committed to the branch; the user can then inspect the diff and
//! `merge_agent_branch` it back into the project. Status changes are pushed to
//! the UI via the `agent-event` Tauri event.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;

use crate::claude::binary::locate_claude;
use crate::process::registry::kill_process_tree;
use crate::state::AppState;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub title: String,
    pub prompt: String,
    pub cwd: String,
    pub branch: String,
    pub worktree: String,
    pub model: String,
    /// running | done | failed | merged | cancelled
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub created_at: i64,
}

struct AgentEntry {
    info: AgentInfo,
    base: String,       // base commit sha the branch was cut from (for diffs)
    pid: Option<u32>,   // running claude pid, for cancel
}

#[derive(Default)]
pub struct AgentRegistry {
    inner: Mutex<HashMap<String, AgentEntry>>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    fn snapshot(&self) -> Vec<AgentInfo> {
        let map = self.inner.lock().unwrap();
        let mut list: Vec<AgentInfo> = map.values().map(|e| e.info.clone()).collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list
    }

    fn insert(&self, info: AgentInfo, base: String) {
        let mut map = self.inner.lock().unwrap();
        map.insert(
            info.id.clone(),
            AgentEntry {
                info,
                base,
                pid: None,
            },
        );
    }

    fn get(&self, id: &str) -> Option<AgentInfo> {
        self.inner.lock().unwrap().get(id).map(|e| e.info.clone())
    }

    fn base_of(&self, id: &str) -> Option<String> {
        self.inner.lock().unwrap().get(id).map(|e| e.base.clone())
    }

    fn set_pid(&self, id: &str, pid: Option<u32>) {
        if let Some(e) = self.inner.lock().unwrap().get_mut(id) {
            e.pid = pid;
        }
    }

    fn pid_of(&self, id: &str) -> Option<u32> {
        self.inner.lock().unwrap().get(id).and_then(|e| e.pid)
    }

    /// Update status/detail and return the new snapshot of the agent.
    fn set_status(&self, id: &str, status: &str, detail: Option<String>) -> Option<AgentInfo> {
        let mut map = self.inner.lock().unwrap();
        let e = map.get_mut(id)?;
        e.info.status = status.to_string();
        if detail.is_some() {
            e.info.detail = detail;
        }
        Some(e.info.clone())
    }

    fn remove(&self, id: &str) -> Option<AgentInfo> {
        self.inner.lock().unwrap().remove(id).map(|e| e.info)
    }
}

// ---- helpers ----

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn gen_id() -> String {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let c = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{:x}{:x}", n, c)
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Run a synchronous git command in `cwd`. Ok(stdout) / Err(stderr|message).
fn git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(cwd).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().map_err(|e| format!("git {args:?}: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn is_git_repo(cwd: &Path) -> bool {
    git(cwd, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true")
        .unwrap_or(false)
}

fn emit(app: &AppHandle, info: &AgentInfo) {
    let _ = app.emit("agent-event", json!({ "agent": info }));
}

// ---- commands ----

#[tauri::command]
pub fn list_agents(app: AppHandle) -> Result<Vec<AgentInfo>, String> {
    Ok(app.state::<AppState>().agents.snapshot())
}

#[tauri::command]
pub async fn start_agent(
    app: AppHandle,
    cwd: String,
    prompt: String,
    model: String,
) -> Result<AgentInfo, String> {
    let id = gen_id();
    let title = prompt.chars().take(48).collect::<String>();
    let branch = format!("yumi/agent-{id}");
    let cwd_path = PathBuf::from(&cwd);
    let worktree = std::env::temp_dir()
        .join("yumi-agents")
        .join(&id)
        .to_string_lossy()
        .to_string();

    let mut info = AgentInfo {
        id: id.clone(),
        title,
        prompt: prompt.clone(),
        cwd: cwd.clone(),
        branch: branch.clone(),
        worktree: worktree.clone(),
        model: model.clone(),
        status: "running".into(),
        detail: None,
        created_at: now_millis(),
    };

    // Require a git repo to isolate into.
    if !is_git_repo(&cwd_path) {
        info.status = "failed".into();
        info.detail = Some("not a git repository — background agents need a git repo to branch from".into());
        app.state::<AppState>().agents.insert(info.clone(), String::new());
        return Ok(info);
    }

    // Resolve the base commit + create the isolated worktree on a new branch.
    let base = git(&cwd_path, &["rev-parse", "HEAD"]).unwrap_or_default().trim().to_string();
    if let Err(e) = git(
        &cwd_path,
        &["worktree", "add", "-b", &branch, &worktree, "HEAD"],
    ) {
        info.status = "failed".into();
        info.detail = Some(format!("git worktree add failed: {e}"));
        app.state::<AppState>().agents.insert(info.clone(), base);
        return Ok(info);
    }

    app.state::<AppState>().agents.insert(info.clone(), base);
    emit(&app, &info);

    // Run the agent's turn in the background; commit its changes when done.
    let app_bg = app.clone();
    tokio::spawn(async move {
        run_agent(app_bg, id, worktree, prompt, model).await;
    });

    Ok(info)
}

async fn run_agent(app: AppHandle, id: String, worktree: String, prompt: String, model: String) {
    let bin = match locate_claude() {
        Some(b) => b,
        None => {
            if let Some(info) =
                app.state::<AppState>()
                    .agents
                    .set_status(&id, "failed", Some("claude binary not found".into()))
            {
                emit(&app, &info);
            }
            return;
        }
    };

    let args = [
        "--output-format",
        "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
        "-p",
        &prompt,
        "--model",
        &model,
    ];

    let is_shim = bin
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let e = e.to_ascii_lowercase();
            e == "cmd" || e == "bat"
        })
        .unwrap_or(false);

    let mut command = if cfg!(windows) && is_shim {
        let mut c = TokioCommand::new("cmd");
        c.arg("/C").arg(&bin);
        for a in &args {
            c.arg(a);
        }
        c
    } else {
        let mut c = TokioCommand::new(&bin);
        for a in &args {
            c.arg(a);
        }
        c
    };

    // Same env sanitization as the main spawner — never leak a parent Claude
    // Code session into the child.
    for (key, _) in std::env::vars() {
        let k = key.to_ascii_uppercase();
        if k.starts_with("CLAUDE_CODE_")
            || k == "CLAUDECODE"
            || k == "ANTHROPIC_BASE_URL"
            || k.starts_with("CLAUDE_STREAM")
        {
            command.env_remove(&key);
        }
    }

    command
        .current_dir(&worktree)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env("CLAUDE_CODE_ENTRYPOINT", "yumi-agent");

    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = match command.spawn() {
        Ok(c) => c,
        Err(e) => {
            if let Some(info) = app.state::<AppState>().agents.set_status(
                &id,
                "failed",
                Some(format!("spawn failed: {e}")),
            ) {
                emit(&app, &info);
            }
            return;
        }
    };

    app.state::<AppState>().agents.set_pid(&id, child.id());

    // Drain stdout so the pipe never blocks (we don't render it).
    if let Some(stdout) = child.stdout.take() {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(_)) = lines.next_line().await {}
    }
    let status = child.wait().await;
    app.state::<AppState>().agents.set_pid(&id, None);

    // If the agent was cancelled while running, don't overwrite that state.
    if app
        .state::<AppState>()
        .agents
        .get(&id)
        .map(|i| i.status == "cancelled")
        .unwrap_or(true)
    {
        return;
    }

    let ok = status.map(|s| s.success()).unwrap_or(false);
    let wt = PathBuf::from(&worktree);

    // Commit whatever the agent changed onto its branch.
    let (new_status, detail) = if !ok {
        ("failed", "claude exited with an error".to_string())
    } else {
        let _ = git(&wt, &["add", "-A"]);
        let dirty = git(&wt, &["status", "--porcelain"]).unwrap_or_default();
        if dirty.trim().is_empty() {
            ("done", "completed — no file changes".to_string())
        } else {
            let msg = format!("yumi agent: {}", prompt.chars().take(72).collect::<String>());
            match git(&wt, &["commit", "-m", &msg]) {
                Ok(_) => {
                    let stat = git(&wt, &["diff", "--shortstat", "HEAD~1", "HEAD"])
                        .unwrap_or_default();
                    ("done", format!("committed{}", if stat.trim().is_empty() { String::new() } else { format!(" — {}", stat.trim()) }))
                }
                Err(e) => ("done", format!("changes staged (commit note: {e})")),
            }
        }
    };

    if let Some(info) = app
        .state::<AppState>()
        .agents
        .set_status(&id, new_status, Some(detail))
    {
        emit(&app, &info);
    }
}

#[tauri::command]
pub fn merge_agent_branch(app: AppHandle, id: String) -> Result<AgentInfo, String> {
    let agents = &app.state::<AppState>().agents;
    let info = agents.get(&id).ok_or("unknown agent")?;
    let cwd = PathBuf::from(&info.cwd);

    let merge = git(
        &cwd,
        &["merge", "--no-ff", &info.branch, "-m", &format!("merge yumi agent {id}")],
    );
    let updated = match merge {
        Ok(out) => {
            // Best-effort: retire the worktree now that it's merged.
            let _ = git(&cwd, &["worktree", "remove", "--force", &info.worktree]);
            agents.set_status(&id, "merged", Some(format!("merged into working branch. {}", out.trim())))
        }
        Err(e) => {
            // Leave the branch in place so the user can resolve manually.
            let _ = git(&cwd, &["merge", "--abort"]);
            agents.set_status(&id, "done", Some(format!("merge failed: {e}")))
        }
    }
    .ok_or("agent vanished")?;
    emit(&app, &updated);
    Ok(updated)
}

#[tauri::command]
pub fn cancel_agent(app: AppHandle, id: String) -> Result<AgentInfo, String> {
    let agents = &app.state::<AppState>().agents;
    if let Some(pid) = agents.pid_of(&id) {
        let _ = kill_process_tree(pid);
    }
    let updated = agents
        .set_status(&id, "cancelled", Some("cancelled by user".into()))
        .ok_or("unknown agent")?;
    // Clean up the worktree.
    let _ = git(&PathBuf::from(&updated.cwd), &["worktree", "remove", "--force", &updated.worktree]);
    emit(&app, &updated);
    Ok(updated)
}

#[tauri::command]
pub fn remove_agent(app: AppHandle, id: String) -> Result<(), String> {
    let agents = &app.state::<AppState>().agents;
    if let Some(info) = agents.get(&id) {
        let cwd = PathBuf::from(&info.cwd);
        let _ = git(&cwd, &["worktree", "remove", "--force", &info.worktree]);
        let _ = git(&cwd, &["branch", "-D", &info.branch]);
    }
    agents.remove(&id);
    Ok(())
}

#[tauri::command]
pub fn agent_diff(app: AppHandle, id: String) -> Result<String, String> {
    let agents = &app.state::<AppState>().agents;
    let info = agents.get(&id).ok_or("unknown agent")?;
    let base = agents.base_of(&id).unwrap_or_default();
    let cwd = PathBuf::from(&info.cwd);
    if base.is_empty() {
        return Ok(String::new());
    }
    // Diff the agent branch against the commit it was cut from.
    git(&cwd, &["diff", &format!("{base}..{}", info.branch)])
}
