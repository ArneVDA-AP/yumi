// Horizontal scrollable row of open chat tabs across the top of the chat area.
// Each tab: status dot + truncated title + hover close button. Trailing "+".

import type { MouseEvent } from "react";
import { useStore } from "../../lib/store";
import { Icon } from "../common/Icon";

export default function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const newTab = useStore((s) => s.newTab);

  const activeCwd = tabs.find((t) => t.id === activeTabId)?.cwd ?? "";

  const onClose = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    closeTab(id);
  };

  const onAux = (e: MouseEvent, id: string) => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(id);
    }
  };

  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`tab-bar__tab${isActive ? " is-active" : ""}`}
            role="tab"
            aria-selected={isActive}
            onClick={() => setActiveTab(tab.id)}
            onAuxClick={(e) => onAux(e, tab.id)}
          >
            <span
              className={`tab-bar__dot${tab.streaming ? " is-streaming" : " is-idle"}`}
              aria-hidden="true"
            />
            <span className="tab-bar__title">{tab.title}</span>
            <button
              type="button"
              className="tab-bar__close"
              aria-label="Close tab"
              onClick={(e) => onClose(e, tab.id)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="tab-bar__new"
        aria-label="New tab"
        onClick={() => newTab({ cwd: activeCwd })}
      >
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}
