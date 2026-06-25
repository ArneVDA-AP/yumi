// Left panel listing past sessions grouped by project (cwd). Search, resume,
// delete, plus footer shortcuts into Settings / Analytics overlays.

import type { MouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import type { SessionMeta } from "../../lib/types";
import { Icon } from "../common/Icon";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString();
}

function projectLabel(cwd: string): string {
  const cleaned = cwd.replace(/[/\\]+$/, "");
  if (!cleaned) return "No project";
  const seg = cleaned.split(/[/\\]/).pop();
  return seg || "No project";
}

interface Group {
  key: string;
  label: string;
  sessions: SessionMeta[];
}

export default function Sidebar() {
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const sessions = useStore((s) => s.sessions);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const newTab = useStore((s) => s.newTab);
  const resumeSession = useStore((s) => s.resumeSession);
  const deleteSession = useStore((s) => s.deleteSession);
  const setOverlay = useStore((s) => s.setOverlay);

  const [query, setQuery] = useState("");

  useEffect(() => {
    void useStore.getState().refreshSessions();
  }, []);

  const groups = useMemo<Group[]>(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? sessions.filter((s) => s.title.toLowerCase().includes(q))
      : sessions;

    const byKey = new Map<string, Group>();
    for (const meta of filtered) {
      const key = meta.cwd || "";
      let group = byKey.get(key);
      if (!group) {
        group = { key, label: projectLabel(key), sessions: [] };
        byKey.set(key, group);
      }
      group.sessions.push(meta);
    }
    const result = Array.from(byKey.values());
    for (const group of result) {
      group.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return result;
  }, [sessions, query]);

  if (!sidebarOpen) return null;

  const onDelete = (e: MouseEvent, meta: SessionMeta) => {
    e.stopPropagation();
    if (window.confirm(`Delete session "${meta.title}"?`)) {
      void deleteSession(meta.id);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <span className="sidebar__title">Sessions</span>
        <div className="sidebar__header-actions">
          <button
            type="button"
            className="sidebar__icon-btn"
            aria-label="New session"
            onClick={() => newTab()}
          >
            <Icon name="plus" size={14} />
          </button>
          <button
            type="button"
            className="sidebar__icon-btn"
            aria-label="Collapse sidebar"
            onClick={() => setSidebarOpen(false)}
          >
            <Icon name="sidebar" size={14} />
          </button>
        </div>
      </div>

      <div className="sidebar__search">
        <Icon name="search" size={14} className="sidebar__search-icon" />
        <input
          type="text"
          className="sidebar__search-input"
          placeholder="Search sessions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="sidebar__list">
        {sessions.length === 0 ? (
          <p className="sidebar__empty">No past sessions yet</p>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="sidebar__group">
              <div className="sidebar__group-header">
                <Icon name="folder" size={12} />
                <span className="sidebar__group-label">{group.label}</span>
              </div>
              {group.sessions.map((meta) => (
                <div
                  key={meta.id}
                  className="sidebar__session"
                  onClick={() => void resumeSession(meta)}
                >
                  <div className="sidebar__session-main">
                    <span className="sidebar__session-title">{meta.title}</span>
                    <span className="sidebar__session-meta">
                      <span className="sidebar__session-time">
                        {timeAgo(meta.updatedAt)}
                      </span>
                      <span className="sidebar__session-model">{meta.model}</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    className="sidebar__session-delete"
                    aria-label="Delete session"
                    onClick={(e) => onDelete(e, meta)}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="sidebar__footer">
        <button
          type="button"
          className="sidebar__footer-btn"
          onClick={() => setOverlay("settings")}
        >
          <Icon name="settings" size={14} />
          <span>Settings</span>
        </button>
        <button
          type="button"
          className="sidebar__footer-btn"
          onClick={() => setOverlay("analytics")}
        >
          <Icon name="chart" size={14} />
          <span>Analytics</span>
        </button>
      </div>
    </aside>
  );
}
