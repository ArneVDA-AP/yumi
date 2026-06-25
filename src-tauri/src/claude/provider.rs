//! Multi-provider abstraction.
//!
//! Yumi drives a CLI subprocess and parses its `stream-json`. Claude is the
//! fully-wired, verified path. The other providers mirror Yume's provider-shim
//! design: Yumi selects the right binary and a best-effort arg shape, but they
//! require that provider's CLI on PATH and emit their own output — only the
//! Claude path is locally verified. The arg mappings for non-Claude providers
//! are intentionally conservative and may need per-CLI-version adjustment.

use std::path::PathBuf;

use crate::claude::binary::locate_on_path_or_local;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Claude,
    Gemini,
    Codex,
    Kiro,
}

impl Provider {
    pub fn from_id(id: Option<&str>) -> Provider {
        match id.unwrap_or("claude") {
            "gemini" => Provider::Gemini,
            "codex" | "gpt" => Provider::Codex,
            "kiro" => Provider::Kiro,
            _ => Provider::Claude,
        }
    }

    pub fn is_claude(self) -> bool {
        matches!(self, Provider::Claude)
    }

    pub fn id(self) -> &'static str {
        match self {
            Provider::Claude => "claude",
            Provider::Gemini => "gemini",
            Provider::Codex => "codex",
            Provider::Kiro => "kiro",
        }
    }

    /// Candidate executable names to probe on PATH / `~/.local/bin`.
    fn binary_names(self) -> Vec<String> {
        let stem = match self {
            Provider::Claude => "claude",
            Provider::Gemini => "gemini",
            Provider::Codex => "codex",
            Provider::Kiro => "kiro",
        };
        if cfg!(windows) {
            vec![
                format!("{stem}.exe"),
                format!("{stem}.cmd"),
                format!("{stem}.bat"),
                stem.to_string(),
            ]
        } else {
            vec![stem.to_string()]
        }
    }

    /// Locate this provider's CLI binary, or `None` if it isn't installed.
    pub fn locate(self) -> Option<PathBuf> {
        let names = self.binary_names();
        locate_on_path_or_local(names.iter().map(|s| s.as_str()))
    }

    /// Build the CLI args for a turn. `resume` is the provider session id to
    /// resume (Claude only). Returns the full arg vector (excluding the binary).
    pub fn build_args(self, prompt: &str, model: &str, resume: Option<&str>) -> Vec<String> {
        match self {
            Provider::Claude => {
                let mut args = vec![
                    "--output-format".into(),
                    "stream-json".into(),
                    "--verbose".into(),
                    "--include-partial-messages".into(),
                    "--dangerously-skip-permissions".into(),
                ];
                if let Some(r) = resume {
                    args.push("--resume".into());
                    args.push(r.into());
                }
                args.push("-p".into());
                args.push(prompt.into());
                args.push("--model".into());
                args.push(model.into());
                args
            }
            // Best-effort, unverified mappings for the other CLIs. They keep the
            // model + prompt; output rendering depends on the CLI emitting
            // claude-compatible stream-json (unknown lines are shown raw-safe).
            Provider::Gemini => vec!["-m".into(), model.into(), "-p".into(), prompt.into()],
            Provider::Codex => vec!["-m".into(), model.into(), prompt.into()],
            Provider::Kiro => vec!["-m".into(), model.into(), prompt.into()],
        }
    }
}
