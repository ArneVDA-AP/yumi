//! Pure stream-json → ClaudeEvent parser.
//!
//! `parse_line(&str) -> Vec<ClaudeEvent>` implements the mapping in CONTRACT.md.
//! It is non-lossy: a line that cannot be parsed as one of the known `type`s
//! (or fails JSON parsing entirely) becomes a single `ClaudeEvent::Raw { line }`.
//! A single stream-json line (e.g. an `assistant` message with several content
//! blocks) may expand into several `ClaudeEvent`s — hence the `Vec`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Normalized event matching the TS `ClaudeEvent` union in `src/lib/types.ts`.
/// Serializes with an internal `kind` tag + camelCase fields so it matches the
/// frozen frontend shapes exactly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ClaudeEvent {
    System {
        subtype: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        #[serde(rename = "claudeSessionId", skip_serializing_if = "Option::is_none")]
        claude_session_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cwd: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tools: Option<Vec<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<Value>,
    },
    AssistantText {
        text: String,
    },
    AssistantThinking {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        #[serde(rename = "toolUseId")]
        tool_use_id: String,
        content: String,
        #[serde(rename = "isError", skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
    },
    TextDelta {
        text: String,
    },
    ThinkingDelta {
        text: String,
    },
    Usage {
        #[serde(rename = "inputTokens", skip_serializing_if = "Option::is_none")]
        input_tokens: Option<u64>,
        #[serde(rename = "outputTokens", skip_serializing_if = "Option::is_none")]
        output_tokens: Option<u64>,
        #[serde(rename = "cacheRead", skip_serializing_if = "Option::is_none")]
        cache_read: Option<u64>,
        #[serde(rename = "cacheCreation", skip_serializing_if = "Option::is_none")]
        cache_creation: Option<u64>,
    },
    RateLimit {
        data: Value,
    },
    /// The assistant's message finished with a terminal `stop_reason` (anything
    /// but `tool_use`/`pause_turn`, which mean it will continue). Emitted from a
    /// `message_delta` stream event — it arrives as soon as the answer is done,
    /// BEFORE the `result` line, which can be delayed many seconds by post-turn
    /// Stop hooks. The UI finalizes on this so the chat never looks hung.
    TurnDone {
        #[serde(rename = "stopReason", skip_serializing_if = "Option::is_none")]
        stop_reason: Option<String>,
        #[serde(rename = "inputTokens", skip_serializing_if = "Option::is_none")]
        input_tokens: Option<u64>,
        #[serde(rename = "outputTokens", skip_serializing_if = "Option::is_none")]
        output_tokens: Option<u64>,
        #[serde(rename = "cacheRead", skip_serializing_if = "Option::is_none")]
        cache_read: Option<u64>,
        #[serde(rename = "cacheCreation", skip_serializing_if = "Option::is_none")]
        cache_creation: Option<u64>,
    },
    Result {
        #[serde(rename = "isError")]
        is_error: bool,
        #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
        #[serde(rename = "numTurns", skip_serializing_if = "Option::is_none")]
        num_turns: Option<u64>,
        #[serde(rename = "totalCostUsd", skip_serializing_if = "Option::is_none")]
        total_cost_usd: Option<f64>,
        #[serde(rename = "resultText", skip_serializing_if = "Option::is_none")]
        result_text: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<Value>,
        #[serde(rename = "modelUsage", skip_serializing_if = "Option::is_none")]
        model_usage: Option<Value>,
    },
    Error {
        message: String,
    },
    Raw {
        line: String,
    },
}

/// Parse a single line of `claude --output-format stream-json` output into zero
/// or more normalized events. Never panics; never silently drops a line.
pub fn parse_line(line: &str) -> Vec<ClaudeEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let value: Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return vec![ClaudeEvent::Raw { line: line.to_string() }],
    };

    let kind = value.get("type").and_then(|t| t.as_str());

    match kind {
        Some("system") => parse_system(&value),
        Some("assistant") => parse_assistant(&value),
        Some("user") => parse_user(&value),
        Some("stream_event") => parse_stream_event(&value),
        Some("result") => parse_result(&value),
        Some("rate_limit_event") => vec![ClaudeEvent::RateLimit { data: value.clone() }],
        Some("error") => {
            let message = value
                .get("message")
                .and_then(|m| m.as_str())
                .map(|s| s.to_string())
                .or_else(|| value.get("error").and_then(|e| e.as_str()).map(|s| s.to_string()))
                .unwrap_or_else(|| trimmed.to_string());
            vec![ClaudeEvent::Error { message }]
        }
        _ => vec![ClaudeEvent::Raw { line: line.to_string() }],
    }
}

fn parse_system(value: &Value) -> Vec<ClaudeEvent> {
    let subtype = value
        .get("subtype")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    let model = value.get("model").and_then(|m| m.as_str()).map(|s| s.to_string());
    let claude_session_id = value
        .get("session_id")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());
    let cwd = value.get("cwd").and_then(|c| c.as_str()).map(|s| s.to_string());
    let tools = value.get("tools").and_then(|t| t.as_array()).map(|arr| {
        arr.iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect::<Vec<String>>()
    });

    vec![ClaudeEvent::System {
        subtype,
        model,
        claude_session_id,
        cwd,
        tools,
        data: Some(value.clone()),
    }]
}

fn parse_assistant(value: &Value) -> Vec<ClaudeEvent> {
    let mut events = Vec::new();
    let content = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array());

    if let Some(blocks) = content {
        for block in blocks {
            let block_type = block.get("type").and_then(|t| t.as_str());
            match block_type {
                Some("text") => {
                    let text = block
                        .get("text")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string();
                    events.push(ClaudeEvent::AssistantText { text });
                }
                Some("thinking") => {
                    // Anthropic uses `thinking` for the field; tolerate `text` too.
                    let text = block
                        .get("thinking")
                        .and_then(|t| t.as_str())
                        .or_else(|| block.get("text").and_then(|t| t.as_str()))
                        .unwrap_or("")
                        .to_string();
                    events.push(ClaudeEvent::AssistantThinking { text });
                }
                Some("tool_use") => {
                    let id = block
                        .get("id")
                        .and_then(|i| i.as_str())
                        .unwrap_or("")
                        .to_string();
                    let name = block
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("")
                        .to_string();
                    let input = block.get("input").cloned().unwrap_or(Value::Null);
                    events.push(ClaudeEvent::ToolUse { id, name, input });
                }
                _ => { /* redacted_thinking / other block types: ignore non-lossily at block level */ }
            }
        }
    }

    // If an assistant line carried no recognizable content blocks, surface it raw
    // rather than dropping it.
    if events.is_empty() {
        events.push(ClaudeEvent::Raw {
            line: value.to_string(),
        });
    }
    events
}

fn parse_user(value: &Value) -> Vec<ClaudeEvent> {
    let mut events = Vec::new();
    let content = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array());

    if let Some(blocks) = content {
        for block in blocks {
            if block.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                let tool_use_id = block
                    .get("tool_use_id")
                    .and_then(|i| i.as_str())
                    .unwrap_or("")
                    .to_string();
                let content_str = extract_tool_result_content(block.get("content"));
                let is_error = block.get("is_error").and_then(|e| e.as_bool());
                events.push(ClaudeEvent::ToolResult {
                    tool_use_id,
                    content: content_str,
                    is_error,
                });
            }
        }
    }

    if events.is_empty() {
        events.push(ClaudeEvent::Raw {
            line: value.to_string(),
        });
    }
    events
}

/// tool_result `content` may be a plain string or an array of content blocks
/// (`[{type:"text", text:"..."}]`). Flatten either form to a single string.
fn extract_tool_result_content(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(arr)) => {
            let mut parts = Vec::new();
            for item in arr {
                if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                    parts.push(t.to_string());
                } else if let Some(s) = item.as_str() {
                    parts.push(s.to_string());
                }
            }
            parts.join("")
        }
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

fn parse_stream_event(value: &Value) -> Vec<ClaudeEvent> {
    let event = match value.get("event") {
        Some(e) => e,
        None => return vec![ClaudeEvent::Raw { line: value.to_string() }],
    };

    let event_type = event.get("type").and_then(|t| t.as_str());

    // message_delta carries the turn's final stop_reason + a usage snapshot.
    // A terminal stop_reason (anything but tool_use/pause_turn, which signal the
    // assistant will keep going) means the answer is complete — finalize now.
    if event_type == Some("message_delta") {
        let stop_reason = event
            .get("delta")
            .and_then(|d| d.get("stop_reason"))
            .and_then(|s| s.as_str());
        match stop_reason {
            Some(sr) if sr != "tool_use" && sr != "pause_turn" => {
                let usage = event.get("usage");
                let g = |k: &str| usage.and_then(|u| u.get(k)).and_then(|v| v.as_u64());
                return vec![ClaudeEvent::TurnDone {
                    stop_reason: Some(sr.to_string()),
                    input_tokens: g("input_tokens"),
                    output_tokens: g("output_tokens"),
                    cache_read: g("cache_read_input_tokens"),
                    cache_creation: g("cache_creation_input_tokens"),
                }];
            }
            // tool_use / pause_turn / absent → not terminal; fall through to raw.
            _ => return vec![ClaudeEvent::Raw { line: value.to_string() }],
        }
    }

    if event_type == Some("content_block_delta") {
        if let Some(delta) = event.get("delta") {
            match delta.get("type").and_then(|t| t.as_str()) {
                Some("text_delta") => {
                    let text = delta
                        .get("text")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string();
                    return vec![ClaudeEvent::TextDelta { text }];
                }
                Some("thinking_delta") => {
                    let text = delta
                        .get("thinking")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string();
                    return vec![ClaudeEvent::ThinkingDelta { text }];
                }
                // input_json_delta / signature_delta etc. → route to raw (non-lossy).
                _ => return vec![ClaudeEvent::Raw { line: value.to_string() }],
            }
        }
    }

    // message_start / content_block_start / stop, etc. → raw (non-lossy, ignorable by UI).
    vec![ClaudeEvent::Raw {
        line: value.to_string(),
    }]
}

fn parse_result(value: &Value) -> Vec<ClaudeEvent> {
    let is_error = value.get("is_error").and_then(|e| e.as_bool()).unwrap_or(false);
    let duration_ms = value.get("duration_ms").and_then(|d| d.as_u64());
    let num_turns = value.get("num_turns").and_then(|n| n.as_u64());
    let total_cost_usd = value.get("total_cost_usd").and_then(|c| c.as_f64());
    let result_text = value
        .get("result")
        .and_then(|r| r.as_str())
        .map(|s| s.to_string());
    let usage = value.get("usage").cloned();
    let model_usage = value.get("modelUsage").cloned();

    vec![ClaudeEvent::Result {
        is_error,
        duration_ms,
        num_turns,
        total_cost_usd,
        result_text,
        usage,
        model_usage,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    // Real lines copied from ../streamsample.jsonl
    const REAL_SYSTEM: &str = r#"{"type":"system","subtype":"init","cwd":"C:\\dev\\yume-test","session_id":"9d31530c-5c3f-419e-9e2e-80830c149967","tools":["Bash","Edit","PowerShell","Read"],"mcp_servers":[],"model":"claude-haiku-4-5-20251001","permissionMode":"bypassPermissions"}"#;
    const REAL_ASSISTANT: &str = r#"{"type":"assistant","message":{"id":"8a788a65","model":"<synthetic>","role":"assistant","type":"message","content":[{"type":"text","text":"Not logged in · Please run /login"}]},"session_id":"9d31530c-5c3f-419e-9e2e-80830c149967"}"#;
    const REAL_RESULT: &str = r#"{"type":"result","subtype":"success","is_error":true,"duration_ms":141,"num_turns":1,"result":"Not logged in · Please run /login","session_id":"9d31530c","total_cost_usd":0,"usage":{"input_tokens":0,"output_tokens":0},"modelUsage":{}}"#;

    #[test]
    fn parses_real_system_init() {
        let events = parse_line(REAL_SYSTEM);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ClaudeEvent::System {
                subtype,
                model,
                claude_session_id,
                cwd,
                tools,
                ..
            } => {
                assert_eq!(subtype, "init");
                assert_eq!(model.as_deref(), Some("claude-haiku-4-5-20251001"));
                assert_eq!(
                    claude_session_id.as_deref(),
                    Some("9d31530c-5c3f-419e-9e2e-80830c149967")
                );
                assert_eq!(cwd.as_deref(), Some("C:\\dev\\yume-test"));
                assert_eq!(tools.as_ref().unwrap().len(), 4);
            }
            other => panic!("expected System, got {:?}", other),
        }
    }

    #[test]
    fn parses_real_assistant_text() {
        let events = parse_line(REAL_ASSISTANT);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ClaudeEvent::AssistantText { text } => {
                assert_eq!(text, "Not logged in · Please run /login");
            }
            other => panic!("expected AssistantText, got {:?}", other),
        }
    }

    #[test]
    fn parses_real_result() {
        let events = parse_line(REAL_RESULT);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ClaudeEvent::Result {
                is_error,
                duration_ms,
                num_turns,
                total_cost_usd,
                result_text,
                ..
            } => {
                assert!(*is_error);
                assert_eq!(*duration_ms, Some(141));
                assert_eq!(*num_turns, Some(1));
                assert_eq!(*total_cost_usd, Some(0.0));
                assert_eq!(result_text.as_deref(), Some("Not logged in · Please run /login"));
            }
            other => panic!("expected Result, got {:?}", other),
        }
    }

    #[test]
    fn parses_text_delta_stream_event() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ClaudeEvent::TextDelta { text } => assert_eq!(text, "Hello"),
            other => panic!("expected TextDelta, got {:?}", other),
        }
    }

    #[test]
    fn parses_thinking_delta_stream_event() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me think"}}}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ClaudeEvent::ThinkingDelta { text } => assert_eq!(text, "Let me think"),
            other => panic!("expected ThinkingDelta, got {:?}", other),
        }
    }

    #[test]
    fn message_delta_end_turn_becomes_turn_done() {
        let line = r#"{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":3,"output_tokens":287,"cache_read_input_tokens":34433,"cache_creation_input_tokens":15005}}}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ClaudeEvent::TurnDone {
                stop_reason,
                input_tokens,
                output_tokens,
                cache_read,
                cache_creation,
            } => {
                assert_eq!(stop_reason.as_deref(), Some("end_turn"));
                assert_eq!(*input_tokens, Some(3));
                assert_eq!(*output_tokens, Some(287));
                assert_eq!(*cache_read, Some(34433));
                assert_eq!(*cache_creation, Some(15005));
            }
            other => panic!("expected TurnDone, got {:?}", other),
        }
    }

    #[test]
    fn message_delta_tool_use_is_not_terminal() {
        // stop_reason "tool_use" means the assistant will continue after the tool
        // runs — must NOT finalize the turn.
        let line = r#"{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":12}}}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], ClaudeEvent::Raw { .. }));
    }

    #[test]
    fn turn_done_serializes_with_kind_and_camelcase() {
        let ev = ClaudeEvent::TurnDone {
            stop_reason: Some("end_turn".into()),
            input_tokens: Some(3),
            output_tokens: Some(287),
            cache_read: None,
            cache_creation: None,
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains("\"kind\":\"turn_done\""));
        assert!(json.contains("\"stopReason\":\"end_turn\""));
        assert!(json.contains("\"outputTokens\":287"));
    }

    #[test]
    fn ignores_input_json_delta_as_raw() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"a\":"}}}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], ClaudeEvent::Raw { .. }));
    }

    #[test]
    fn parses_tool_use_block() {
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_01","name":"Read","input":{"file_path":"/tmp/x"}}]}}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ClaudeEvent::ToolUse { id, name, input } => {
                assert_eq!(id, "toolu_01");
                assert_eq!(name, "Read");
                assert_eq!(input.get("file_path").unwrap().as_str(), Some("/tmp/x"));
            }
            other => panic!("expected ToolUse, got {:?}", other),
        }
    }

    #[test]
    fn parses_tool_result_string_content() {
        let line = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01","content":"file contents","is_error":false}]}}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ClaudeEvent::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => {
                assert_eq!(tool_use_id, "toolu_01");
                assert_eq!(content, "file contents");
                assert_eq!(*is_error, Some(false));
            }
            other => panic!("expected ToolResult, got {:?}", other),
        }
    }

    #[test]
    fn parses_tool_result_array_content() {
        let line = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_02","content":[{"type":"text","text":"line1"},{"type":"text","text":"line2"}]}]}}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ClaudeEvent::ToolResult { content, .. } => assert_eq!(content, "line1line2"),
            other => panic!("expected ToolResult, got {:?}", other),
        }
    }

    #[test]
    fn parses_multiple_content_blocks() {
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hmm"},{"type":"text","text":"answer"},{"type":"tool_use","id":"t1","name":"Bash","input":{}}]}}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 3);
        assert!(matches!(events[0], ClaudeEvent::AssistantThinking { .. }));
        assert!(matches!(events[1], ClaudeEvent::AssistantText { .. }));
        assert!(matches!(events[2], ClaudeEvent::ToolUse { .. }));
    }

    #[test]
    fn parses_rate_limit_event() {
        let line = r#"{"type":"rate_limit_event","retry_after":42}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], ClaudeEvent::RateLimit { .. }));
    }

    #[test]
    fn parses_error_event() {
        let line = r#"{"type":"error","message":"boom"}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ClaudeEvent::Error { message } => assert_eq!(message, "boom"),
            other => panic!("expected Error, got {:?}", other),
        }
    }

    #[test]
    fn unknown_type_becomes_raw() {
        let line = r#"{"type":"something_new","foo":1}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], ClaudeEvent::Raw { .. }));
    }

    #[test]
    fn invalid_json_becomes_raw() {
        let line = "this is not json {{{";
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ClaudeEvent::Raw { line: l } => assert_eq!(l, "this is not json {{{"),
            other => panic!("expected Raw, got {:?}", other),
        }
    }

    #[test]
    fn empty_line_yields_no_events() {
        assert!(parse_line("").is_empty());
        assert!(parse_line("   ").is_empty());
    }

    #[test]
    fn system_serializes_to_camelcase_with_kind_tag() {
        let events = parse_line(REAL_SYSTEM);
        let json = serde_json::to_string(&events[0]).unwrap();
        assert!(json.contains("\"kind\":\"system\""));
        assert!(json.contains("\"claudeSessionId\""));
    }

    #[test]
    fn text_delta_serializes_with_kind() {
        let ev = ClaudeEvent::TextDelta { text: "hi".into() };
        let json = serde_json::to_string(&ev).unwrap();
        assert_eq!(json, r#"{"kind":"text_delta","text":"hi"}"#);
    }

    #[test]
    fn result_serializes_camelcase_fields() {
        let events = parse_line(REAL_RESULT);
        let json = serde_json::to_string(&events[0]).unwrap();
        assert!(json.contains("\"kind\":\"result\""));
        assert!(json.contains("\"isError\":true"));
        assert!(json.contains("\"durationMs\":141"));
        assert!(json.contains("\"totalCostUsd\":0.0"));
    }
}
