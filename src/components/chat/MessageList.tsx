// Scrolling message list with lightweight windowing. For typical session sizes
// we render directly; for very long sessions we cap the rendered tail and keep
// a "load earlier" affordance. Auto-sticks to bottom while streaming unless the
// user has scrolled up.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../lib/types";
import { MessageItem } from "./MessageItem";

interface MessageListProps {
  messages: ChatMessage[];
  streaming: boolean;
  tabId: string;
}

const WINDOW = 120; // max messages rendered from the tail at once

export function MessageList({ messages, streaming, tabId }: MessageListProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const [showAll, setShowAll] = useState(false);

  const hidden = !showAll && messages.length > WINDOW ? messages.length - WINDOW : 0;
  const visible = hidden > 0 ? messages.slice(hidden) : messages;

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = distance < 80;
  }, []);

  // Keep pinned to bottom when new content arrives and we're "stuck".
  useLayoutEffect(() => {
    if (stickRef.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages, streaming]);

  // Reset stick when the conversation changes length drastically (tab switch).
  useEffect(() => {
    stickRef.current = true;
    bottomRef.current?.scrollIntoView({ block: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="msg-list" ref={scrollerRef} onScroll={onScroll}>
      <div className="msg-list__inner">
        {hidden > 0 && (
          <button className="msg-list__earlier" type="button" onClick={() => setShowAll(true)}>
            Show {hidden} earlier message{hidden === 1 ? "" : "s"}
          </button>
        )}
        {visible.map((m) => (
          <MessageItem key={m.id} message={m} tabId={tabId} />
        ))}
        <div ref={bottomRef} className="msg-list__anchor" />
      </div>
    </div>
  );
}
