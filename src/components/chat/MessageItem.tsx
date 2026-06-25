// A single chat message row. User messages render as a right-aligned bubble;
// assistant messages render their block sequence (text / thinking / tool cards)
// plus a meta footer (cost, duration) once finalized.

import { memo } from "react";
import type { ChatMessage } from "../../lib/types";
import { useStore } from "../../lib/store";
import { Icon } from "../common/Icon";
import { Markdown } from "../common/Markdown";
import { useCopy } from "../common/useCopy";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCard } from "./ToolCard";

interface MessageItemProps {
  message: ChatMessage;
  tabId: string;
}

function formatCost(cost?: number): string | null {
  if (cost == null) return null;
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatDuration(ms?: number): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const MessageItem = memo(function MessageItem({ message, tabId }: MessageItemProps) {
  const rollbackTo = useStore((s) => s.rollbackTo);

  if (message.role === "user") {
    const text = message.blocks
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    return (
      <div className="msg msg--user">
        <button
          type="button"
          className="msg--user__rewind"
          title="Rewind conversation to here (edit & resend)"
          aria-label="Rewind to here"
          onClick={() => rollbackTo(tabId, message.id)}
        >
          <Icon name="rewind" size={12} />
        </button>
        <div className="msg--user__bubble">{text}</div>
      </div>
    );
  }

  const cost = formatCost(message.cost);
  const dur = formatDuration(message.durationMs);
  const empty = message.blocks.length === 0;

  return (
    <div className="msg msg--assistant">
      <div className="msg--assistant__avatar">
        <Icon name="sparkle" size={14} />
      </div>
      <div className="msg--assistant__body">
        {empty && message.streaming && (
          <div className="msg--assistant__pending">
            <span className="caret" />
          </div>
        )}
        {message.blocks.map((block, i) => {
          if (block.type === "text") {
            return <AssistantText key={i} text={block.text} streaming={message.streaming} />;
          }
          if (block.type === "thinking") {
            return (
              <ThinkingBlock
                key={i}
                text={block.text}
                streaming={message.streaming && i === message.blocks.length - 1}
              />
            );
          }
          return (
            <ToolCard
              key={block.id || i}
              name={block.name}
              input={block.input}
              result={block.result}
              isError={block.isError}
              running={block.running}
              live={block.live}
            />
          );
        })}
        {(cost || dur) && !message.streaming && (
          <div className="msg--assistant__meta">
            {dur && (
              <span className="meta-pill">
                <Icon name="clock" size={11} /> {dur}
              </span>
            )}
            {cost && (
              <span className="meta-pill">
                <Icon name="bolt" size={11} /> {cost}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

function AssistantText({ text, streaming }: { text: string; streaming?: boolean }) {
  const [copied, copy] = useCopy();
  return (
    <div className="assistant-text">
      <Markdown text={text} />
      {streaming && <span className="caret caret--inline" />}
      {!streaming && text.length > 0 && (
        <button
          className="assistant-text__copy"
          type="button"
          title="Copy message"
          onClick={() => copy(text)}
        >
          <Icon name={copied ? "check" : "copy"} size={12} />
        </button>
      )}
    </div>
  );
}
