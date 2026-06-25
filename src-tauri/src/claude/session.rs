//! Session id helpers.
//!
//! The frontend-generated `sessionId` is the primary key used everywhere
//! (registry, events, DB). The real `claude` UUID (`claudeSessionId`) is learned
//! from the `system/init` line and stored so a later spawn can `--resume <uuid>`.
//! This module keeps the (tiny) aliasing logic in one place.

/// Returns the value that should be passed to `--resume`, if any.
///
/// We prefer an explicit `resume_id` from `SpawnOpts`; if absent, no resume.
pub fn resume_arg(resume_id: Option<&str>) -> Option<String> {
    match resume_id {
        Some(id) if !id.trim().is_empty() => Some(id.trim().to_string()),
        _ => None,
    }
}

/// Validate a frontend session id is safe to use as a filename component
/// (it becomes part of the bash stream-file path `yumi-bash-<session>.log`).
/// Mirrors the MCP server's `[A-Za-z0-9_-]{1,128}` rule.
pub fn is_valid_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resume_arg_trims_and_filters_empty() {
        assert_eq!(resume_arg(Some("abc")), Some("abc".to_string()));
        assert_eq!(resume_arg(Some("  abc  ")), Some("abc".to_string()));
        assert_eq!(resume_arg(Some("")), None);
        assert_eq!(resume_arg(Some("   ")), None);
        assert_eq!(resume_arg(None), None);
    }

    #[test]
    fn validates_session_ids() {
        assert!(is_valid_session_id("session-123_abc"));
        assert!(!is_valid_session_id(""));
        assert!(!is_valid_session_id("has space"));
        assert!(!is_valid_session_id("../traversal"));
    }
}
