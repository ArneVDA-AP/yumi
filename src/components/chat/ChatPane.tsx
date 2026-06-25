// A single pane in the split-view grid (F7/F8). Renders one session's chat +
// composer, bound to an explicit tabId. Clicking the pane makes it the active
// tab (so the keyboard, voice dictation, and panels target it).

import { useStore } from "../../lib/store";
import { Icon } from "../common/Icon";
import { MessageList } from "./MessageList";
import PromptInput from "../input/PromptInput";

export default function ChatPane({ tabId }: { tabId: string }) {
  const tab = useStore((s) => s.tabs.find((t) => t.id === tabId)) ?? null;
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closePane = useStore((s) => s.closePane);

  if (!tab) return null;
  const isActive = tab.id === activeTabId;

  return (
    <div
      className={`chat-pane${isActive ? " is-active" : ""}`}
      onMouseDown={() => setActiveTab(tab.id)}
    >
      <div className="chat-pane__head">
        <span className="chat-pane__title" title={tab.title}>
          {tab.streaming && <Icon name="spinner" size={11} className="spin" />}
          {tab.title}
        </span>
        <button
          type="button"
          className="chat-pane__close"
          title="Remove pane"
          aria-label="Remove pane"
          onClick={(e) => {
            e.stopPropagation();
            closePane(tab.id);
          }}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="chat-pane__body">
        {tab.cwd ? (
          <>
            <MessageList messages={tab.messages} streaming={tab.streaming} tabId={tab.id} />
            <PromptInput tabId={tab.id} />
          </>
        ) : (
          <div className="chat-pane__empty">
            <Icon name="folder" size={20} />
            <p>No working directory. Activate this pane and press Ctrl+O.</p>
          </div>
        )}
      </div>
    </div>
  );
}
