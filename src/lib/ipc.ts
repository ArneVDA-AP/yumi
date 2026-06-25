// ============================================================================
// Yumi IPC — FROZEN typed wrappers around Tauri invoke(). Command NAMES here
// must exactly match the #[tauri::command] fns registered in src-tauri/src/lib.rs.
// ============================================================================
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  SpawnOpts, Settings, SessionMeta, SessionDetail, Analytics, RecentProject,
  GitStatus, DirEntry, UsageLimits, ClaudeEventEnvelope, ClaudeComplete,
  ClaudeErrorEvt, ClaudeSessionId, BashOutput, ClaudeCost, AgentInfo, AgentEvent,
} from "./types";

// ---- claude session lifecycle ----
export const getClaudeVersion = () => invoke<string>("get_claude_version");
export const spawnClaude = (opts: SpawnOpts) => invoke<string>("spawn_claude", { opts });
export const interruptClaude = (sessionId: string) => invoke<void>("interrupt_claude", { sessionId });
export const getUsageLimits = (force = false) => invoke<UsageLimits>("get_usage_limits", { force });

// ---- settings ----
export const getSettings = () => invoke<Settings>("get_settings");
export const saveSettings = (settings: Settings) => invoke<void>("save_settings", { settings });
export const setTheme = (theme: string) => invoke<void>("set_theme", { theme });

// ---- db / sessions ----
export const dbListSessions = () => invoke<SessionMeta[]>("db_list_sessions");
export const dbGetSession = (id: string) => invoke<SessionDetail>("db_get_session", { id });
export const dbSaveSession = (detail: SessionDetail) => invoke<void>("db_save_session", { detail });
export const dbDeleteSession = (id: string) => invoke<void>("db_delete_session", { id });
export const dbGetAnalytics = () => invoke<Analytics>("db_get_analytics");

// ---- projects / fs ----
export const listProjects = () => invoke<RecentProject[]>("list_projects");
export const addRecentProject = (path: string) => invoke<void>("add_recent_project", { path });
export const pickDirectory = () => invoke<string | null>("pick_directory");
export const listDirectory = (path: string) => invoke<DirEntry[]>("list_directory", { path });
export const readTextFile = (path: string) => invoke<string>("read_text_file", { path });

// ---- git ----
export const gitStatus = (cwd: string) => invoke<GitStatus>("git_status", { cwd });
export const gitDiff = (cwd: string, staged = false) => invoke<string>("git_diff", { cwd, staged });

// ---- background agents (git-worktree isolated) ----
export const listAgents = () => invoke<AgentInfo[]>("list_agents");
export const startAgent = (cwd: string, prompt: string, model: string) =>
  invoke<AgentInfo>("start_agent", { cwd, prompt, model });
export const mergeAgentBranch = (id: string) => invoke<AgentInfo>("merge_agent_branch", { id });
export const cancelAgent = (id: string) => invoke<AgentInfo>("cancel_agent", { id });
export const removeAgent = (id: string) => invoke<void>("remove_agent", { id });
export const agentDiff = (id: string) => invoke<string>("agent_diff", { id });

// ============================================================================
// Event channel subscriptions (Rust emits -> these helpers wrap listen()).
// ============================================================================
export const onClaudeEvent = (cb: (e: ClaudeEventEnvelope) => void): Promise<UnlistenFn> =>
  listen<ClaudeEventEnvelope>("claude-event", (ev) => cb(ev.payload));
export const onClaudeComplete = (cb: (e: ClaudeComplete) => void): Promise<UnlistenFn> =>
  listen<ClaudeComplete>("claude-complete", (ev) => cb(ev.payload));
export const onClaudeError = (cb: (e: ClaudeErrorEvt) => void): Promise<UnlistenFn> =>
  listen<ClaudeErrorEvt>("claude-error", (ev) => cb(ev.payload));
export const onClaudeSessionId = (cb: (e: ClaudeSessionId) => void): Promise<UnlistenFn> =>
  listen<ClaudeSessionId>("claude-session-id", (ev) => cb(ev.payload));
export const onClaudeCost = (cb: (e: ClaudeCost) => void): Promise<UnlistenFn> =>
  listen<ClaudeCost>("claude-cost", (ev) => cb(ev.payload));
export const onBashOutput = (cb: (e: BashOutput) => void): Promise<UnlistenFn> =>
  listen<BashOutput>("bash-output", (ev) => cb(ev.payload));
export const onAgentEvent = (cb: (e: AgentEvent) => void): Promise<UnlistenFn> =>
  listen<AgentEvent>("agent-event", (ev) => cb(ev.payload));
