// ============================================================================
// Global app store (zustand). Owns: tabs/sessions, messages-per-session,
// settings, live streaming state, overlays/panels, project + usage state.
// Also installs the single set of IPC event listeners and routes stream events
// through the reducer into the right tab.
// ============================================================================

import { create } from "zustand";
import {
  addRecentProject,
  agentDiff as ipcAgentDiff,
  cancelAgent as ipcCancelAgent,
  dbDeleteSession,
  dbGetSession,
  dbListSessions,
  dbSaveSession,
  getSettings,
  getUsageLimits,
  interruptClaude,
  listAgents,
  listProjects,
  mergeAgentBranch as ipcMergeAgent,
  onAgentEvent,
  onBashOutput,
  onClaudeComplete,
  onClaudeCost,
  onClaudeError,
  onClaudeEvent,
  onClaudeSessionId,
  removeAgent as ipcRemoveAgent,
  saveSettings as ipcSaveSettings,
  setTheme as ipcSetTheme,
  spawnClaude,
  startAgent as ipcStartAgent,
} from "./ipc";
import {
  deserializeBlocks,
  emptyAssistant,
  newMessageId,
  reduceEvent,
  serializeBlocks,
} from "./streamParse";
import { applyTheme } from "./themes";
import {
  DEFAULT_SETTINGS,
  type AgentInfo,
  type ChatMessage,
  type MessageBlock,
  type RecentProject,
  type SessionMeta,
  type Settings,
  type UsageLimits,
} from "./types";

export type OverlayKind = null | "settings" | "palette" | "analytics";
export type PanelKind = null | "git" | "files" | "agents";

export interface Tab {
  id: string;                 // stable frontend session id (== SpawnOpts.sessionId)
  title: string;
  cwd: string;
  model: string;
  claudeSessionId?: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  activeAssistantId?: string | null;  // id of the in-flight assistant message
  draft: string;              // unsent input text
  lastUsage?: { inputTokens?: number; outputTokens?: number; cacheRead?: number; cacheCreation?: number };
  error?: string | null;
  loaded: boolean;            // history loaded from db
  createdAt: number;
}

interface StoreState {
  // ---- tabs ----
  tabs: Tab[];
  activeTabId: string | null;

  // ---- settings ----
  settings: Settings;
  settingsLoaded: boolean;

  // ---- sessions / projects sidebar ----
  sessions: SessionMeta[];
  projects: RecentProject[];

  // ---- usage ----
  usage: UsageLimits | null;

  // ---- ui ----
  overlay: OverlayKind;
  panel: PanelKind;
  sidebarOpen: boolean;
  bootstrapped: boolean;

  // ---- split-view grid (F7/F8) ----
  // Ordered tab ids shown as panes. ≤1 entry → normal single view.
  splitTabs: string[];

  // ---- voice dictation (F5) ----
  voiceActive: boolean;

  // ---- background agents ----
  agents: AgentInfo[];

  // ---- actions ----
  bootstrap: () => Promise<void>;
  newTab: (opts?: Partial<Pick<Tab, "cwd" | "model" | "title">>) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setDraft: (id: string, draft: string) => void;
  renameTab: (id: string, title: string) => void;

  send: (tabId: string, prompt: string) => Promise<void>;
  stop: (tabId: string) => Promise<void>;

  resumeSession: (meta: SessionMeta) => Promise<void>;
  refreshSessions: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;

  setProject: (path: string) => Promise<void>;
  refreshProjects: () => Promise<void>;

  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  refreshUsage: (force?: boolean) => Promise<void>;

  setOverlay: (o: OverlayKind) => void;
  togglePanel: (p: PanelKind) => void;
  setSidebarOpen: (v: boolean) => void;

  // ---- split-view actions ----
  addPane: () => void;          // F7: add the next tab (or a new one) as a pane
  removePane: () => void;       // F8: drop the last pane
  closePane: (tabId: string) => void;

  // ---- voice actions ----
  toggleVoice: () => void;
  setVoiceActive: (v: boolean) => void;

  // ---- history rollback ----
  rollbackTo: (tabId: string, messageId: string) => void;

  // ---- background agents ----
  refreshAgents: () => Promise<void>;
  startAgent: (prompt: string) => Promise<void>;
  mergeAgent: (id: string) => Promise<void>;
  cancelAgent: (id: string) => Promise<void>;
  removeAgent: (id: string) => Promise<void>;
  getAgentDiff: (id: string) => Promise<string>;

  // internal stream routing
  _onEvent: (sessionId: string, ev: Parameters<typeof reduceEvent>[1]) => void;
  _onComplete: (sessionId: string, code: number | null) => void;
  _onError: (sessionId: string, message: string) => void;
  _onSessionId: (sessionId: string, claudeSessionId: string) => void;
  _onCost: (sessionId: string, cost?: number, durationMs?: number) => void;
  _onBashOutput: (sessionId: string, chunk: string) => void;
  _onAgentEvent: (agent: AgentInfo) => void;
  _persist: (tabId: string) => void;
}

function genId(): string {
  return `t${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function baseName(p: string): string {
  const cleaned = p.replace(/[/\\]+$/, "");
  const seg = cleaned.split(/[/\\]/).pop();
  return seg || cleaned || "project";
}

/** Map a live in-stream `rate_limit_event` payload into UsageLimits. The CLI
 *  emits `{ rate_limit_info: { status, resetsAt(epoch s), rateLimitType, … } }`.
 *  It carries live status + reset time but NO percentage, so the pct fields stay
 *  absent; `live:true` lights the pills up (vs the greyed "unavailable" default). */
function parseRateLimit(raw: unknown): UsageLimits | null {
  if (!raw || typeof raw !== "object") return null;
  const info = (raw as { rate_limit_info?: Record<string, unknown> }).rate_limit_info;
  if (!info || typeof info !== "object") return null;
  const status = typeof info.status === "string" ? info.status : undefined;
  const windowType = typeof info.rateLimitType === "string" ? info.rateLimitType : undefined;
  const resetsAtEpoch = typeof info.resetsAt === "number" ? info.resetsAt : undefined;
  return {
    rateLimited: status != null && status !== "allowed",
    live: true,
    windowType,
    resetsAt: resetsAtEpoch ? new Date(resetsAtEpoch * 1000).toISOString() : undefined,
  };
}

/** Insert or replace an agent by id, newest first. */
function upsertAgent(agents: AgentInfo[], agent: AgentInfo): AgentInfo[] {
  const idx = agents.findIndex((a) => a.id === agent.id);
  if (idx >= 0) return agents.map((a) => (a.id === agent.id ? agent : a));
  return [agent, ...agents];
}

function makeTab(opts?: Partial<Pick<Tab, "cwd" | "model" | "title">>, model = DEFAULT_SETTINGS.model): Tab {
  const cwd = opts?.cwd ?? "";
  return {
    id: genId(),
    title: opts?.title ?? "New Chat",
    cwd,
    model: opts?.model ?? model,
    claudeSessionId: null,
    messages: [],
    streaming: false,
    activeAssistantId: null,
    draft: "",
    error: null,
    loaded: true,
    createdAt: Date.now(),
  };
}

export const useStore = create<StoreState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  sessions: [],
  projects: [],
  usage: null,
  overlay: null,
  panel: null,
  sidebarOpen: true,
  bootstrapped: false,
  splitTabs: [],
  voiceActive: false,
  agents: [],

  bootstrap: async () => {
    if (get().bootstrapped) return;
    set({ bootstrapped: true });

    // Settings (tolerate backend stub by falling back to defaults).
    let settings = DEFAULT_SETTINGS;
    try {
      settings = { ...DEFAULT_SETTINGS, ...(await getSettings()) };
    } catch {
      /* backend not ready — keep defaults */
    }
    applyTheme(settings.theme);
    set({ settings, settingsLoaded: true });

    // Listeners (single registration).
    void onClaudeEvent((e) => get()._onEvent(e.sessionId, e.event));
    void onClaudeComplete((e) => get()._onComplete(e.sessionId, e.code));
    void onClaudeError((e) => get()._onError(e.sessionId, e.message));
    void onClaudeSessionId((e) => get()._onSessionId(e.sessionId, e.claudeSessionId));
    void onClaudeCost((e) => get()._onCost(e.sessionId, e.cost, e.durationMs));
    void onBashOutput((e) => get()._onBashOutput(e.sessionId, e.chunk));
    void onAgentEvent((e) => get()._onAgentEvent(e.agent));

    // Sessions + projects + usage (best-effort).
    await Promise.allSettled([
      get().refreshSessions(),
      get().refreshProjects(),
      settings.showRateLimit ? get().refreshUsage(false) : Promise.resolve(),
    ]);

    // Open an initial empty tab if none exist.
    if (get().tabs.length === 0) {
      const projects = get().projects;
      const cwd = projects[0]?.path ?? "";
      get().newTab({ cwd, model: settings.model });
    }
  },

  newTab: (opts) => {
    const { settings } = get();
    const tab = makeTab(opts, settings.model);
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, overlay: null }));
    return tab.id;
  },

  closeTab: (id) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx < 0) return s;
      const tabs = s.tabs.filter((t) => t.id !== id);
      let activeTabId = s.activeTabId;
      if (s.activeTabId === id) {
        const next = tabs[idx] ?? tabs[idx - 1] ?? tabs[tabs.length - 1] ?? null;
        activeTabId = next?.id ?? null;
      }
      return { tabs, activeTabId };
    });
    if (get().tabs.length === 0) {
      const cwd = get().projects[0]?.path ?? "";
      get().newTab({ cwd });
    }
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  setDraft: (id, draft) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, draft } : t)) })),

  renameTab: (id, title) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) })),

  send: async (tabId, prompt) => {
    const text = prompt.trim();
    if (!text) return;
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.streaming) return;
    if (!tab.cwd) {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, error: "Pick a working directory first." } : t,
        ),
      }));
      return;
    }

    const userMsg: ChatMessage = {
      id: newMessageId(),
      role: "user",
      blocks: [{ type: "text", text }],
    };
    const assistant = emptyAssistant();
    const title = tab.messages.length === 0 ? text.slice(0, 60) : tab.title;

    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              title,
              draft: "",
              error: null,
              streaming: true,
              activeAssistantId: assistant.id,
              messages: [...t.messages, userMsg, assistant],
            }
          : t,
      ),
    }));

    const { settings } = get();
    try {
      await spawnClaude({
        sessionId: tab.id,
        cwd: tab.cwd,
        prompt: text,
        model: tab.model || settings.model,
        provider: settings.provider,
        routerBaseUrl: settings.routerBaseUrl,
        resumeId: tab.claudeSessionId ?? null,
        thinking: settings.thinking,
        bashMonitor: settings.bashMonitor,
      });
    } catch (e) {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? { ...t, streaming: false, activeAssistantId: null, error: String(e) }
            : t,
        ),
      }));
    }
  },

  stop: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    try {
      await interruptClaude(tab.id);
    } catch {
      /* tolerate */
    }
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              streaming: false,
              activeAssistantId: null,
              messages: t.messages.map((m) =>
                m.streaming ? { ...m, streaming: false } : m,
              ),
            }
          : t,
      ),
    }));
    get()._persist(tabId);
  },

  resumeSession: async (meta) => {
    // If a tab for this session id already exists, just focus it.
    const existing = get().tabs.find((t) => t.id === meta.id);
    if (existing) {
      set({ activeTabId: existing.id, sidebarOpen: get().sidebarOpen });
      return;
    }
    const tab: Tab = {
      ...makeTab({ cwd: meta.cwd, model: meta.model, title: meta.title }),
      id: meta.id,
      claudeSessionId: meta.claudeSessionId ?? null,
      loaded: false,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, overlay: null }));
    try {
      const detail = await dbGetSession(meta.id);
      const messages: ChatMessage[] = detail.messages.map((m) => ({
        id: newMessageId(),
        role: m.role,
        blocks: deserializeBlocks(m.content),
      }));
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === meta.id ? { ...t, messages, loaded: true } : t,
        ),
      }));
    } catch {
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === meta.id ? { ...t, loaded: true } : t)),
      }));
    }
  },

  refreshSessions: async () => {
    try {
      const sessions = await dbListSessions();
      set({ sessions });
    } catch {
      /* stub backend */
    }
  },

  deleteSession: async (id) => {
    try {
      await dbDeleteSession(id);
    } catch {
      /* tolerate */
    }
    set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) }));
  },

  setProject: async (path) => {
    try {
      await addRecentProject(path);
    } catch {
      /* tolerate */
    }
    const active = get().tabs.find((t) => t.id === get().activeTabId);
    if (active) {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === active.id
            ? { ...t, cwd: path, title: t.messages.length ? t.title : baseName(path) }
            : t,
        ),
      }));
    }
    await get().refreshProjects();
  },

  refreshProjects: async () => {
    try {
      const projects = await listProjects();
      set({ projects });
    } catch {
      /* stub backend */
    }
  },

  updateSettings: async (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    if (patch.theme) applyTheme(patch.theme);
    try {
      if (patch.theme) await ipcSetTheme(patch.theme);
      await ipcSaveSettings(next);
    } catch {
      /* tolerate stub */
    }
    if (patch.showRateLimit) void get().refreshUsage(false);
  },

  refreshUsage: async (force = false) => {
    try {
      const usage = await getUsageLimits(force);
      set({ usage });
    } catch {
      /* stub backend */
    }
  },

  setOverlay: (o) => set((s) => ({ overlay: s.overlay === o ? null : o })),
  togglePanel: (p) => set((s) => ({ panel: s.panel === p ? null : p })),
  setSidebarOpen: (v) => set({ sidebarOpen: v }),

  // -------------------------------------------------------------------------
  // Split-view grid (F7 add pane / F8 remove pane). splitTabs holds the ordered
  // tab ids rendered as panes; ≤1 entry means the normal single view.
  // -------------------------------------------------------------------------
  addPane: () => {
    const { tabs, activeTabId, splitTabs, projects } = get();
    const base = splitTabs.length ? splitTabs : activeTabId ? [activeTabId] : [];
    if (base.length >= 6) return;
    // Prefer an existing tab not already shown; else spawn a fresh one.
    let nextId = tabs.find((t) => !base.includes(t.id))?.id;
    if (!nextId) {
      const cwd = (activeTabId && tabs.find((t) => t.id === activeTabId)?.cwd) || projects[0]?.path || "";
      nextId = get().newTab({ cwd });
    }
    set({ splitTabs: [...base, nextId], activeTabId: nextId });
  },
  removePane: () => {
    const { splitTabs, activeTabId } = get();
    if (splitTabs.length <= 1) {
      set({ splitTabs: [] });
      return;
    }
    const next = splitTabs.slice(0, -1);
    const dropped = splitTabs[splitTabs.length - 1];
    set({
      splitTabs: next.length <= 1 ? [] : next,
      activeTabId: activeTabId === dropped ? next[next.length - 1] : activeTabId,
    });
  },
  closePane: (tabId) => {
    const next = get().splitTabs.filter((id) => id !== tabId);
    set({ splitTabs: next.length <= 1 ? [] : next });
  },

  // -------------------------------------------------------------------------
  // Voice dictation flag (F5 / mic button). The PromptInput owns the actual
  // SpeechRecognition session and reacts to this flag.
  // -------------------------------------------------------------------------
  toggleVoice: () => set((s) => ({ voiceActive: !s.voiceActive })),
  setVoiceActive: (v) => set({ voiceActive: v }),

  // -------------------------------------------------------------------------
  // History rollback: rewind a conversation to just before `messageId` (a user
  // turn) and load that prompt back into the composer for edit/resend.
  // -------------------------------------------------------------------------
  rollbackTo: (tabId, messageId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const idx = t.messages.findIndex((m) => m.id === messageId);
        if (idx < 0) return t;
        const target = t.messages[idx];
        const promptText =
          target.role === "user"
            ? target.blocks.map((b) => (b.type === "text" ? b.text : "")).join("")
            : t.draft;
        return {
          ...t,
          messages: t.messages.slice(0, idx),
          draft: promptText,
          streaming: false,
          activeAssistantId: null,
          error: null,
        };
      }),
    }));
    get()._persist(tabId);
  },

  // -------------------------------------------------------------------------
  // Background agents (git-worktree isolated parallel runs).
  // -------------------------------------------------------------------------
  refreshAgents: async () => {
    try {
      set({ agents: await listAgents() });
    } catch {
      /* backend stub */
    }
  },
  startAgent: async (prompt) => {
    const tab = get().tabs.find((t) => t.id === get().activeTabId);
    const cwd = tab?.cwd ?? get().projects[0]?.path ?? "";
    const model = tab?.model ?? get().settings.model;
    if (!cwd || !prompt.trim()) return;
    const agent = await ipcStartAgent(cwd, prompt.trim(), model);
    set((s) => ({ agents: upsertAgent(s.agents, agent), panel: "agents" }));
  },
  mergeAgent: async (id) => {
    const agent = await ipcMergeAgent(id);
    set((s) => ({ agents: upsertAgent(s.agents, agent) }));
  },
  cancelAgent: async (id) => {
    const agent = await ipcCancelAgent(id);
    set((s) => ({ agents: upsertAgent(s.agents, agent) }));
  },
  removeAgent: async (id) => {
    try {
      await ipcRemoveAgent(id);
    } catch {
      /* tolerate */
    }
    set((s) => ({ agents: s.agents.filter((a) => a.id !== id) }));
  },
  getAgentDiff: async (id) => {
    try {
      return await ipcAgentDiff(id);
    } catch (e) {
      return String(e);
    }
  },

  // -------------------------------------------------------------------------
  // Stream routing
  // -------------------------------------------------------------------------
  _onEvent: (sessionId, ev) => {
    let finalized = false;
    set((s) => {
      const tab = s.tabs.find((t) => t.id === sessionId);
      if (!tab) return s;

      // Find the in-flight assistant message (or null).
      const activeId = tab.activeAssistantId;
      const current =
        (activeId && tab.messages.find((m) => m.id === activeId)) || null;

      const res = reduceEvent(current ?? null, ev);
      finalized = res.finalized;

      let messages = tab.messages;
      let activeAssistantId = tab.activeAssistantId;
      let claudeSessionId = tab.claudeSessionId;
      let lastUsage = tab.lastUsage;
      let error = tab.error;

      if (res.claudeSessionId) claudeSessionId = res.claudeSessionId;
      if (res.usage) lastUsage = { ...lastUsage, ...res.usage };
      if (res.error) error = res.error;

      // Wire the in-stream rate_limit_event into the (global) usage pills, live.
      let nextUsage = s.usage;
      if (res.rateLimit) {
        const parsed = parseRateLimit(res.rateLimit);
        if (parsed) nextUsage = { ...s.usage, ...parsed };
      }

      if (res.message) {
        const idx = messages.findIndex((m) => m.id === res.message!.id);
        if (idx >= 0) {
          messages = messages.map((m) => (m.id === res.message!.id ? res.message! : m));
        } else {
          // New synthesized message (e.g. a result with no prior content).
          // Replace the empty active placeholder if present.
          if (activeId) {
            messages = messages.map((m) => (m.id === activeId ? res.message! : m));
          } else {
            messages = [...messages, res.message!];
          }
        }
        activeAssistantId = res.message.id;
      }

      if (finalized) {
        messages = messages.map((m) =>
          m.streaming ? { ...m, streaming: false } : m,
        );
      }

      const tabs = s.tabs.map((t) =>
        t.id === sessionId
          ? {
              ...t,
              messages,
              activeAssistantId: finalized ? null : activeAssistantId,
              streaming: finalized ? false : t.streaming,
              claudeSessionId,
              lastUsage,
              error,
            }
          : t,
      );
      return nextUsage === s.usage ? { tabs } : { tabs, usage: nextUsage };
    });

    // The `result` event marks the logical end of a turn — finalize the UI
    // immediately, even if the spawned process lingers (e.g. slow Stop hooks).
    if (finalized) {
      get()._persist(sessionId);
      void get().refreshSessions();
    }
  },

  _onComplete: (sessionId, _code) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === sessionId
          ? {
              ...t,
              streaming: false,
              activeAssistantId: null,
              messages: t.messages.map((m) =>
                m.streaming ? { ...m, streaming: false } : m,
              ),
            }
          : t,
      ),
    }));
    get()._persist(sessionId);
    void get().refreshSessions();
  },

  _onError: (sessionId, message) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === sessionId
          ? { ...t, streaming: false, activeAssistantId: null, error: message }
          : t,
      ),
    }));
  },

  _onSessionId: (sessionId, claudeSessionId) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === sessionId ? { ...t, claudeSessionId } : t,
      ),
    }));
  },

  // Live bash output (BASH-MONITOR): append the chunk to the last still-running
  // tool card in the streaming assistant message of this session.
  _onBashOutput: (sessionId, chunk) => {
    if (!chunk) return;
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== sessionId) return t;
        const activeId = t.activeAssistantId;
        if (!activeId) return t;
        let touched = false;
        const messages = t.messages.map((m) => {
          if (m.id !== activeId) return m;
          const blocks: MessageBlock[] = [...m.blocks];
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.type === "tool_use" && b.running) {
              blocks[i] = { ...b, live: (b.live ?? "") + chunk };
              touched = true;
              break;
            }
          }
          return touched ? { ...m, blocks } : m;
        });
        return touched ? { ...t, messages } : t;
      }),
    }));
  },

  // A background agent's status changed.
  _onAgentEvent: (agent) => {
    set((s) => ({ agents: upsertAgent(s.agents, agent) }));
  },

  // Late cost/duration from the turn's drained `result` line. Attach it to the
  // most recent finalized assistant message so its footer shows cost + duration
  // even though the UI finalized earlier on `end_turn`. (The backend only emits
  // this while THIS turn's process still owns the session, so the target is the
  // turn that just ended.)
  _onCost: (sessionId, cost, durationMs) => {
    if (cost == null && durationMs == null) return;
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== sessionId) return t;
        let idx = -1;
        for (let i = t.messages.length - 1; i >= 0; i--) {
          const m = t.messages[i];
          if (m.role === "assistant" && !m.streaming) {
            idx = i;
            break;
          }
        }
        if (idx < 0) return t;
        const messages = t.messages.map((m, i) =>
          i === idx
            ? {
                ...m,
                cost: cost ?? m.cost,
                durationMs: durationMs ?? m.durationMs,
              }
            : m,
        );
        return { ...t, messages };
      }),
    }));
  },

  _persist: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.messages.length === 0) return;
    const now = Date.now();
    const meta: SessionMeta = {
      id: tab.id,
      claudeSessionId: tab.claudeSessionId ?? null,
      title: tab.title,
      cwd: tab.cwd,
      model: tab.model,
      createdAt: tab.createdAt,
      updatedAt: now,
    };
    const detail = {
      meta,
      messages: tab.messages.map((m) => ({
        sessionId: tab.id,
        role: m.role,
        content: serializeBlocks(m.blocks),
        createdAt: now,
      })),
    };
    void dbSaveSession(detail).catch(() => {
      /* tolerate stub backend */
    });
  },
}));

// Convenience selector hooks ------------------------------------------------
export const useActiveTab = (): Tab | null => {
  const id = useStore((s) => s.activeTabId);
  const tabs = useStore((s) => s.tabs);
  return tabs.find((t) => t.id === id) ?? null;
};
