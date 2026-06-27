// ============================================================================
// Yumi shared types — FROZEN CONTRACT between the Rust backend and React UI.
// Both sides must agree on these shapes. Do not change without updating both.
// ============================================================================

// ---- Normalized stream event (Rust parses claude stream-json -> these) ----
// Emitted on the Tauri event channel "claude-event" as { sessionId, event }.
export type ClaudeEvent =
  | { kind: "system"; subtype: string; model?: string; claudeSessionId?: string; cwd?: string; tools?: string[]; data?: unknown }
  | { kind: "assistant_text"; text: string }          // a COMPLETE text block
  | { kind: "assistant_thinking"; text: string }       // a COMPLETE thinking block
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; toolUseId: string; content: string; isError?: boolean }
  | { kind: "text_delta"; text: string }               // PARTIAL token (stream_event)
  | { kind: "thinking_delta"; text: string }            // PARTIAL token (stream_event)
  | { kind: "usage"; inputTokens?: number; outputTokens?: number; cacheRead?: number; cacheCreation?: number }
  | { kind: "rate_limit"; data: unknown }
  | { kind: "turn_done"; stopReason?: string; inputTokens?: number; outputTokens?: number; cacheRead?: number; cacheCreation?: number }  // answer complete (end_turn) — finalize before the (hook-delayed) result
  | { kind: "result"; isError: boolean; durationMs?: number; numTurns?: number; totalCostUsd?: number; resultText?: string; usage?: unknown; modelUsage?: unknown }
  | { kind: "error"; message: string }
  | { kind: "raw"; line: string };

export interface ClaudeEventEnvelope { sessionId: string; event: ClaudeEvent }
export interface ClaudeComplete { sessionId: string; code: number | null }
export interface ClaudeErrorEvt { sessionId: string; message: string }
export interface ClaudeSessionId { sessionId: string; claudeSessionId: string }
export interface BashOutput { sessionId: string; chunk: string }
// Late cost/duration from a turn's `result` line, surfaced after the UI already
// finalized on `end_turn` (the result is drained silently in the backend).
export interface ClaudeCost { sessionId: string; cost?: number; durationMs?: number }
// A background agent's status changed (emitted by the agents backend).
export interface AgentEvent { agent: AgentInfo }

// ---- Providers (multi-provider abstraction) ----
// Every provider drives the SAME `claude` binary + stream-json parser. Claude
// talks to the real API; non-Claude providers are realized by pointing `claude`
// at a router via ANTHROPIC_BASE_URL (settings.routerBaseUrl) — so they require
// a configured router endpoint, not a foreign CLI.
export type ProviderId = "claude" | "gemini" | "codex" | "kiro";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  models: { value: string; label: string }[];
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "claude",
    label: "Claude (claude CLI)",
    models: [
      { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
      { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
  },
  { id: "gemini", label: "Gemini (via router)", models: [{ value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }, { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }] },
  { id: "codex", label: "GPT (via router)", models: [{ value: "gpt-5", label: "GPT-5" }, { value: "o4-mini", label: "o4-mini" }] },
  { id: "kiro", label: "Kiro (via router)", models: [{ value: "kiro-default", label: "Kiro (default)" }] },
];

// ---- Spawn options ----
export interface SpawnOpts {
  sessionId: string;     // frontend-generated stable id for this tab/session
  cwd: string;
  prompt: string;
  model: string;
  provider?: ProviderId;     // which provider to drive (default "claude")
  routerBaseUrl?: string;    // ANTHROPIC_BASE_URL for a routed (non-Claude) provider
  resumeId?: string | null;  // real claude session uuid to --resume
  thinking?: boolean;        // route through thinking proxy
  bashMonitor?: boolean;     // route bash through the MCP server for live tail
}

// ---- Settings ----
export interface Settings {
  provider: ProviderId;
  routerBaseUrl: string;     // ANTHROPIC_BASE_URL for routed (non-Claude) providers
  model: string;
  theme: string;             // 'oled' | 'dark' | 'light' | 'dim' | 'nord' | 'rose'
  vimMode: boolean;
  thinking: boolean;
  showRateLimit: boolean;
  bashMonitor: boolean;      // live-tail bash via the MCP monitor (default off)
  autoCompactThreshold: number; // 0..1, default 0.75
}

export const DEFAULT_SETTINGS: Settings = {
  provider: "claude",
  routerBaseUrl: "",
  model: "claude-opus-4-8",
  theme: "yume",
  vimMode: false,
  thinking: true,
  showRateLimit: true,
  bashMonitor: false,
  autoCompactThreshold: 0.75,
};

// ---- Background agents (git-worktree-isolated parallel runs) ----
export type AgentStatus = "running" | "done" | "failed" | "merged" | "cancelled";

export interface AgentInfo {
  id: string;
  title: string;
  prompt: string;
  cwd: string;          // the repo the agent branches from
  branch: string;       // yumi/agent-<id>
  worktree: string;     // isolated worktree path
  model: string;
  status: AgentStatus;
  detail?: string;      // last status line / error / merge result
  createdAt: number;
}

// ---- Domain / DB ----
export interface SessionMeta {
  id: string;
  claudeSessionId?: string | null;
  title: string;
  cwd: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}

export type Role = "user" | "assistant";

export interface StoredMessage {
  id?: number;
  sessionId: string;
  role: Role;
  content: string;   // JSON-encoded MessageBlock[]
  createdAt: number;
}

export interface SessionDetail {
  meta: SessionMeta;
  messages: StoredMessage[];
}

export interface Analytics {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  sessionsCount: number;
  byModel: { model: string; costUsd: number; inputTokens: number; outputTokens: number; count: number }[];
  byDate: { date: string; costUsd: number; count: number }[];
}

export interface RecentProject { path: string; name: string; lastOpened: number }

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface DirEntry { name: string; path: string; isDir: boolean }

export interface UsageLimits {
  rateLimited: boolean;
  /** True only when backed by a real signal (a live in-stream rate_limit_event).
   *  When false, the UI greys the pills as "usage data unavailable". */
  live?: boolean;
  windowType?: string;    // e.g. "five_hour" / "seven_day", from the live event
  fiveHourPct?: number;   // 0..1 used (no reliable local source → usually absent)
  sevenDayPct?: number;
  resetsAt?: string;      // ISO timestamp the active window resets
}

// ---- UI-side message model (built by the stream reducer) ----
export type MessageBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown; result?: string; isError?: boolean; running?: boolean; live?: string };

export interface ChatMessage {
  id: string;
  role: Role;
  blocks: MessageBlock[];
  streaming?: boolean;
  cost?: number;
  durationMs?: number;
}
