// Root application shell. Composes the sidebar, top bar, tab bar, chat view,
// prompt composer, side panels, and overlays. Owns bootstrap + global keyboard
// shortcuts wiring. Layout is a CSS grid driven by sidebar/panel visibility.

import { useCallback, useEffect } from "react";
import { useActiveTab, useStore } from "./lib/store";
import { installShortcuts } from "./lib/shortcuts";
import { pickDirectory } from "./lib/ipc";

import Sidebar from "./components/tabs/Sidebar";
import TabBar from "./components/tabs/TabBar";
import { MessageList } from "./components/chat/MessageList";
import ChatPane from "./components/chat/ChatPane";
import { RateLimitPills } from "./components/chat/RateLimitPills";
import PromptInput from "./components/input/PromptInput";
import GitPanel from "./components/panels/GitPanel";
import FilesPanel from "./components/panels/FilesPanel";
import AgentsPanel from "./components/panels/AgentsPanel";
import SettingsOverlay from "./components/overlays/SettingsOverlay";
import CommandPalette from "./components/overlays/CommandPalette";
import AnalyticsOverlay from "./components/overlays/AnalyticsOverlay";
import ProjectPicker from "./components/overlays/ProjectPicker";
import { Icon } from "./components/common/Icon";

export default function App() {
  const bootstrap = useStore((s) => s.bootstrap);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const panel = useStore((s) => s.panel);
  const togglePanel = useStore((s) => s.togglePanel);
  const overlay = useStore((s) => s.overlay);
  const setOverlay = useStore((s) => s.setOverlay);
  const settings = useStore((s) => s.settings);
  const usage = useStore((s) => s.usage);
  const refreshUsage = useStore((s) => s.refreshUsage);
  const setProject = useStore((s) => s.setProject);
  const splitTabs = useStore((s) => s.splitTabs);

  const tab = useActiveTab();
  const splitView = splitTabs.length >= 2;

  // One-time bootstrap (settings, listeners, sessions, projects, first tab).
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Browse for a project directory and assign it to the active tab.
  const pickProject = useCallback(async () => {
    try {
      const path = await pickDirectory();
      if (path) await setProject(path);
    } catch {
      /* dialog unavailable — ignore */
    }
  }, [setProject]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const dispose = installShortcuts({ pickProject: () => void pickProject() });
    return dispose;
  }, [pickProject]);

  const hasCwd = !!tab?.cwd;

  const layoutClass = [
    "app",
    sidebarOpen ? "has-sidebar" : "",
    panel ? "has-panel" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={layoutClass}>
      {sidebarOpen && <Sidebar />}

      <main className="workspace">
        <header className="topbar">
          <div className="topbar__left">
            {!sidebarOpen && (
              <button
                type="button"
                className="topbar__icon-btn"
                aria-label="Show sidebar"
                onClick={() => setSidebarOpen(true)}
              >
                <Icon name="sidebar" size={15} />
              </button>
            )}
            <TabBar />
          </div>

          <div className="topbar__right">
            {settings.showRateLimit && (
              <RateLimitPills usage={usage} onRefresh={() => void refreshUsage(true)} />
            )}
            <button
              type="button"
              className={`topbar__icon-btn${panel === "files" ? " is-active" : ""}`}
              aria-label="Files panel"
              title="Files (Ctrl+E)"
              onClick={() => togglePanel("files")}
            >
              <Icon name="folder" size={15} />
            </button>
            <button
              type="button"
              className={`topbar__icon-btn${panel === "git" ? " is-active" : ""}`}
              aria-label="Git panel"
              title="Git (Ctrl+G)"
              onClick={() => togglePanel("git")}
            >
              <Icon name="git" size={15} />
            </button>
            <button
              type="button"
              className={`topbar__icon-btn${panel === "agents" ? " is-active" : ""}`}
              aria-label="Background agents"
              title="Background agents (Ctrl+Shift+A)"
              onClick={() => togglePanel("agents")}
            >
              <Icon name="robot" size={15} />
            </button>
            <button
              type="button"
              className="topbar__icon-btn"
              aria-label="Command palette"
              title="Command palette (Ctrl+P)"
              onClick={() => setOverlay("palette")}
            >
              <Icon name="search" size={15} />
            </button>
            <button
              type="button"
              className="topbar__icon-btn"
              aria-label="Settings"
              title="Settings (Ctrl+,)"
              onClick={() => setOverlay("settings")}
            >
              <Icon name="settings" size={15} />
            </button>
          </div>
        </header>

        <section className="chat-area">
          {splitView ? (
            <div className={`pane-grid pane-grid--${splitTabs.length}`}>
              {splitTabs.map((id) => (
                <ChatPane key={id} tabId={id} />
              ))}
            </div>
          ) : tab ? (
            hasCwd ? (
              <>
                <MessageList messages={tab.messages} streaming={tab.streaming} tabId={tab.id} />
                <PromptInput />
              </>
            ) : (
              <ProjectPicker />
            )
          ) : (
            <div className="chat-empty">
              <Icon name="sparkle" size={28} />
              <p>Open a tab to begin.</p>
            </div>
          )}
        </section>
      </main>

      {panel === "git" && (
        <aside className="side-panel">
          <GitPanel />
        </aside>
      )}
      {panel === "files" && (
        <aside className="side-panel">
          <FilesPanel />
        </aside>
      )}
      {panel === "agents" && (
        <aside className="side-panel">
          <AgentsPanel />
        </aside>
      )}

      {overlay === "settings" && <SettingsOverlay />}
      {overlay === "palette" && <CommandPalette />}
      {overlay === "analytics" && <AnalyticsOverlay />}
    </div>
  );
}
