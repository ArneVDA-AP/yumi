// ============================================================================
// Command palette — fuzzy-filtered actions over store + IPC. Bare/wide overlay.
// Esc is handled globally; we own ArrowUp/Down + Enter selection here.
// ============================================================================
import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { useStore } from "../../lib/store";
import { THEME_LIST } from "../../lib/themes";
import { pickDirectory } from "../../lib/ipc";
import { Icon, type IconName } from "../common/Icon";
import { fuzzyFilter, highlightRuns } from "../common/fuzzy";
import Overlay from "./Overlay";

interface Action {
  id: string;
  title: string;
  hint?: string;
  icon: IconName;
  /** Returns true if the action opened another overlay (skip auto-close). */
  run: () => boolean | void;
}

export default function CommandPalette() {
  const setOverlay = useStore((s) => s.setOverlay);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const actions = useMemo<Action[]>(() => {
    const s = useStore.getState;
    const list: Action[] = [
      { id: "new-tab", title: "New tab", hint: "Open a fresh chat", icon: "plus", run: () => void s().newTab() },
      {
        id: "close-tab",
        title: "Close tab",
        icon: "close",
        run: () => {
          const id = s().activeTabId;
          if (id) s().closeTab(id);
        },
      },
      {
        id: "settings",
        title: "Settings",
        icon: "settings",
        run: () => {
          s().setOverlay("settings");
          return true;
        },
      },
      {
        id: "analytics",
        title: "Analytics",
        icon: "chart",
        run: () => {
          s().setOverlay("analytics");
          return true;
        },
      },
      { id: "git", title: "Git panel", icon: "git", run: () => s().togglePanel("git") },
      { id: "files", title: "Files panel", icon: "file", run: () => s().togglePanel("files") },
      {
        id: "open-project",
        title: "Open project…",
        hint: "Choose a working directory",
        icon: "folder",
        run: () => {
          s().setOverlay(null);
          void (async () => {
            const path = await pickDirectory();
            if (path) await s().setProject(path);
          })();
        },
      },
      { id: "refresh-usage", title: "Refresh usage", icon: "bolt", run: () => void s().refreshUsage(true) },
      {
        id: "clear",
        title: "/clear",
        hint: "Clear current chat",
        icon: "trash",
        run: () => {
          const active = s().tabs.find((t) => t.id === s().activeTabId);
          const cwd = active?.cwd;
          if (active) s().closeTab(active.id);
          s().newTab({ cwd });
        },
      },
      {
        id: "compact",
        title: "/compact",
        hint: "Compact conversation",
        icon: "sparkle",
        run: () => {
          /* placeholder — just closes the palette */
        },
      },
    ];

    for (const t of THEME_LIST) {
      list.push({
        id: `theme-${t.name}`,
        title: `Theme: ${t.label}`,
        icon: "sparkle",
        run: () => void s().updateSettings({ theme: t.name }),
      });
    }

    return list;
  }, []);

  const matches = useMemo(
    () => fuzzyFilter(query, actions, (a) => a.title),
    [query, actions],
  );

  const clampedIndex = matches.length === 0 ? 0 : Math.min(activeIndex, matches.length - 1);

  function runAt(index: number) {
    const match = matches[index];
    if (!match) return;
    const opened = match.item.run();
    if (!opened) setOverlay(null);
  }

  function onQueryChange(value: string) {
    setQuery(value);
    setActiveIndex(0);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (matches.length === 0 ? 0 : (i + 1) % matches.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (matches.length === 0 ? 0 : (i - 1 + matches.length) % matches.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(clampedIndex);
    }
  }

  return (
    <Overlay bare wide onClose={() => setOverlay(null)}>
      <div className="palette">
        <div className="palette__search">
          <Icon name="search" className="palette__search-icon" />
          <input
            className="palette__input"
            placeholder="Type a command…"
            value={query}
            autoFocus
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <ul className="palette__list">
          {matches.length === 0 && <li className="palette__empty">No matching commands</li>}
          {matches.map((m, i) => (
            <li
              key={m.item.id}
              className={`palette__item${i === clampedIndex ? " is-active" : ""}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => runAt(i)}
            >
              <Icon name={m.item.icon} className="palette__item-icon" />
              <span className="palette__item-title">
                {highlightRuns(m.item.title, m.indices).map((run, ri) =>
                  run.hit ? (
                    <mark key={ri} className="palette__hit">
                      {run.text}
                    </mark>
                  ) : (
                    <span key={ri}>{run.text}</span>
                  ),
                )}
              </span>
              {m.item.hint && <span className="palette__item-hint">{m.item.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </Overlay>
  );
}
