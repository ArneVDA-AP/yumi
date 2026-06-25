// ============================================================================
// Global keyboard shortcuts. A single window-level keydown listener dispatches
// app-level actions. Returns a cleanup fn. Input-local keys (Enter / Shift+Enter
// in the prompt textarea) are handled inside the input component, not here.
// ============================================================================

import { useStore } from "./store";

export interface ShortcutDeps {
  pickProject: () => void;
}

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

function mod(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

export function installShortcuts(deps: ShortcutDeps): () => void {
  const handler = (e: KeyboardEvent) => {
    const store = useStore.getState();

    // Escape closes overlays/panels first.
    if (e.key === "Escape") {
      if (store.overlay) {
        store.setOverlay(null);
        e.preventDefault();
        return;
      }
      if (store.panel) {
        store.togglePanel(store.panel);
        e.preventDefault();
        return;
      }
      return;
    }

    // Function-key shortcuts (no modifier) — match Yume's F5/F7/F8 bindings.
    switch (e.key) {
      case "F5":
        e.preventDefault();
        store.toggleVoice();
        return;
      case "F7":
        e.preventDefault();
        store.addPane();
        return;
      case "F8":
        e.preventDefault();
        store.removePane();
        return;
      default:
        break;
    }

    if (!mod(e)) return;

    // Ctrl/Cmd+Shift+A → background agents panel.
    if (e.shiftKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      store.togglePanel("agents");
      return;
    }

    const key = e.key.toLowerCase();
    switch (key) {
      case "t":
        e.preventDefault();
        store.newTab({ cwd: store.tabs.find((t) => t.id === store.activeTabId)?.cwd });
        break;
      case "w":
        e.preventDefault();
        if (store.activeTabId) store.closeTab(store.activeTabId);
        break;
      case "p":
        e.preventDefault();
        store.setOverlay("palette");
        break;
      case ",":
        e.preventDefault();
        store.setOverlay("settings");
        break;
      case "g":
        e.preventDefault();
        store.togglePanel("git");
        break;
      case "e":
        e.preventDefault();
        store.togglePanel("files");
        break;
      case "y":
        e.preventDefault();
        store.setOverlay("analytics");
        break;
      case "l":
        e.preventDefault();
        void store.refreshUsage(true);
        break;
      case "o":
        e.preventDefault();
        deps.pickProject();
        break;
      case "b":
        e.preventDefault();
        store.setSidebarOpen(!store.sidebarOpen);
        break;
      case "tab": {
        // Ctrl+Tab / Ctrl+Shift+Tab cycle tabs.
        e.preventDefault();
        const tabs = store.tabs;
        if (tabs.length < 2) break;
        const idx = tabs.findIndex((t) => t.id === store.activeTabId);
        const next = e.shiftKey
          ? (idx - 1 + tabs.length) % tabs.length
          : (idx + 1) % tabs.length;
        store.setActiveTab(tabs[next].id);
        break;
      }
      default:
        break;
    }
  };

  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}

export const SHORTCUT_HINTS: { keys: string; label: string }[] = [
  { keys: `${isMac ? "⌘" : "Ctrl"}+T`, label: "New tab" },
  { keys: `${isMac ? "⌘" : "Ctrl"}+W`, label: "Close tab" },
  { keys: `${isMac ? "⌘" : "Ctrl"}+P`, label: "Command palette" },
  { keys: `${isMac ? "⌘" : "Ctrl"}+,`, label: "Settings" },
  { keys: `${isMac ? "⌘" : "Ctrl"}+G`, label: "Git panel" },
  { keys: `${isMac ? "⌘" : "Ctrl"}+E`, label: "Files panel" },
  { keys: `${isMac ? "⌘" : "Ctrl"}+Y`, label: "Analytics" },
  { keys: `${isMac ? "⌘" : "Ctrl"}+L`, label: "Refresh limits" },
  { keys: `${isMac ? "⌘" : "Ctrl"}+O`, label: "Open project" },
  { keys: `${isMac ? "⌘" : "Ctrl"}+B`, label: "Toggle sidebar" },
  { keys: `${isMac ? "⌘" : "Ctrl"}+⇧+A`, label: "Background agents" },
  { keys: "F5", label: "Voice dictation" },
  { keys: "F7", label: "Add split pane" },
  { keys: "F8", label: "Remove split pane" },
];
