// Collapsible, dimmed "thinking" block with a distinct style. Auto-expands
// while live-typing (streaming) so the user sees the reasoning, collapsible
// after. Uses a subtle left accent and reduced contrast.

import { useEffect, useState } from "react";
import { Icon } from "../common/Icon";

interface ThinkingBlockProps {
  text: string;
  streaming?: boolean;
}

export function ThinkingBlock({ text, streaming }: ThinkingBlockProps) {
  const [open, setOpen] = useState<boolean>(!!streaming);

  // Expand automatically when streaming starts; leave user choice afterward.
  useEffect(() => {
    if (streaming) setOpen(true);
  }, [streaming]);

  return (
    <div className={`thinking ${open ? "is-open" : ""} ${streaming ? "is-live" : ""}`}>
      <button className="thinking__head" onClick={() => setOpen((o) => !o)} type="button">
        <Icon name={open ? "chevron-down" : "chevron-right"} size={13} />
        <Icon name="brain" size={13} className="thinking__icon" />
        <span className="thinking__label">Thinking</span>
        {streaming && <span className="thinking__dots"><i /><i /><i /></span>}
      </button>
      {open && (
        <div className="thinking__body">
          {text || <span className="thinking__placeholder">…</span>}
          {streaming && <span className="caret" />}
        </div>
      )}
    </div>
  );
}
