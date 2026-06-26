//! Multi-provider abstraction.
//!
//! Every provider drives the SAME `claude` binary and its `stream-json` parser.
//! Claude talks to the real Anthropic API; a non-Claude provider is realized by
//! pointing that same `claude` process at a translating router via
//! `ANTHROPIC_BASE_URL` (claude-code-router / LiteLLM / OpenRouter) — the
//! convergent OSS pattern, and a tiny lift because Yumi already injects that env
//! var for its thinking proxy. We deliberately do NOT spawn the `gemini`/`codex`
//! binaries directly: those CLIs don't emit Claude `stream-json`, so that path
//! could never actually render. A provider switch is just a respawn with a
//! different base URL; the parser is untouched.

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
}

/// The provider-resolved plan for a turn: the `claude` CLI args (identical for
/// every provider — the parser never changes) plus the optional
/// `ANTHROPIC_BASE_URL` to point the process at a router.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpawnPlan {
    pub args: Vec<String>,
    /// `ANTHROPIC_BASE_URL` override: `None` for Claude (real API), `Some(router)`
    /// for a routed provider.
    pub base_url: Option<String>,
}

/// Build the `claude` CLI args + base-URL override for a turn.
///
/// ALL providers drive the `claude` binary and its `stream-json` parser; a
/// non-Claude provider is realized purely by pointing that process at a
/// translating router via `ANTHROPIC_BASE_URL`. Returns an error if a non-Claude
/// provider is selected without a configured router URL — we never fake a
/// working provider.
pub fn build_spawn_plan(
    provider: Provider,
    prompt: &str,
    model: &str,
    resume: Option<&str>,
    router_base_url: &str,
) -> Result<SpawnPlan, String> {
    let mut args: Vec<String> = vec![
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

    let base_url = if provider.is_claude() {
        None
    } else {
        let url = router_base_url.trim();
        if url.is_empty() {
            return Err(format!(
                "Provider '{}' needs a router: set Settings → Router base URL to a \
                 claude-code-router / LiteLLM / OpenRouter endpoint that speaks the \
                 Anthropic stream-json API.",
                provider.id()
            ));
        }
        Some(url.to_string())
    };

    Ok(SpawnPlan { args, base_url })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_plan_has_no_base_url_and_streamjson_args() {
        let plan = build_spawn_plan(Provider::Claude, "hi", "claude-opus-4-8", None, "").unwrap();
        assert_eq!(plan.base_url, None);
        assert!(plan.args.windows(2).any(|w| w == ["--output-format", "stream-json"]));
        assert!(plan.args.windows(2).any(|w| w == ["--model", "claude-opus-4-8"]));
        assert!(plan.args.contains(&"-p".to_string()));
    }

    #[test]
    fn claude_plan_includes_resume_when_present() {
        let plan = build_spawn_plan(Provider::Claude, "hi", "m", Some("uuid-1"), "").unwrap();
        assert!(plan.args.windows(2).any(|w| w == ["--resume", "uuid-1"]));
    }

    #[test]
    fn routed_provider_injects_base_url_with_identical_claude_args() {
        let claude = build_spawn_plan(Provider::Claude, "hi", "m", None, "").unwrap();
        let routed = build_spawn_plan(
            Provider::Gemini,
            "hi",
            "m",
            None,
            "http://127.0.0.1:4000",
        )
        .unwrap();
        // Same claude/stream-json args — only the base URL differs.
        assert_eq!(routed.args, claude.args);
        assert_eq!(routed.base_url.as_deref(), Some("http://127.0.0.1:4000"));
    }

    #[test]
    fn routed_provider_without_router_is_an_error_not_a_fake() {
        for p in [Provider::Gemini, Provider::Codex, Provider::Kiro] {
            let err = build_spawn_plan(p, "hi", "m", None, "   ").unwrap_err();
            assert!(err.contains("Router base URL"), "got: {err}");
        }
    }
}
