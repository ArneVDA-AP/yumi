// Collapsible tool-call card: tool name + pretty-printed input JSON, a running
// spinner that resolves to ✓ / ✗, and the tool_result body when it arrives.

import { useMemo, useState } from "react";
import { Icon } from "../common/Icon";
import { useCopy } from "../common/useCopy";

interface ToolCardProps {
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
  running?: boolean;
  live?: string;     // streamed stdout/stderr while the tool is still running
}

function pretty(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** A short, human one-liner summarizing the tool input for the collapsed head. */
function summarize(name: string, input: unknown): string {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    const cand =
      o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.query ?? o.url ?? o.description;
    if (typeof cand === "string") return cand;
  }
  if (typeof input === "string") return input;
  void name;
  return "";
}

export function ToolCard({ name, input, result, isError, running, live }: ToolCardProps) {
  // Auto-open while live output is streaming so the user sees it without a click.
  const [open, setOpen] = useState(false);
  const [copied, copy] = useCopy();
  const inputStr = useMemo(() => pretty(input), [input]);
  const summary = useMemo(() => summarize(name, input), [name, input]);
  const showLive = running && !!live && result === undefined;
  const isOpen = open || showLive;

  const status: "running" | "ok" | "error" = running
    ? "running"
    : isError
      ? "error"
      : "ok";

  return (
    <div className={`tool-card tool-card--${status} ${isOpen ? "is-open" : ""}`}>
      <button className="tool-card__head" onClick={() => setOpen((o) => !o)} type="button">
        <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={13} className="tool-card__chev" />
        <Icon name="tool" size={13} className="tool-card__icon" />
        <span className="tool-card__name">{name}</span>
        {summary && <span className="tool-card__summary">{summary}</span>}
        <span className="tool-card__status">
          {status === "running" && <Icon name="spinner" size={13} className="spin" />}
          {status === "ok" && <Icon name="check" size={13} />}
          {status === "error" && <Icon name="warning" size={13} />}
        </span>
      </button>
      {isOpen && (
        <div className="tool-card__body">
          {showLive && (
            <div className="tool-card__section">
              <div className="tool-card__section-bar">
                <span className="tool-card__live-label">
                  <Icon name="terminal" size={11} /> Live
                </span>
              </div>
              <pre className="tool-card__pre tool-card__pre--live">
                {live!.length > 8000 ? "… " + live!.slice(-8000) : live}
              </pre>
            </div>
          )}
          {inputStr && (
            <div className="tool-card__section">
              <div className="tool-card__section-bar">
                <span>Input</span>
                <button
                  type="button"
                  className="tool-card__copy"
                  onClick={() => copy(inputStr)}
                >
                  <Icon name={copied ? "check" : "copy"} size={12} />
                </button>
              </div>
              <pre className="tool-card__pre">{inputStr}</pre>
            </div>
          )}
          {result !== undefined && (
            <div className="tool-card__section">
              <div className="tool-card__section-bar">
                <span className={isError ? "is-error" : ""}>
                  {isError ? "Error" : "Result"}
                </span>
              </div>
              <pre className={`tool-card__pre ${isError ? "is-error" : ""}`}>
                {result.length > 6000 ? result.slice(0, 6000) + "\n… (truncated)" : result}
              </pre>
            </div>
          )}
          {running && result === undefined && (
            <div className="tool-card__waiting">
              <Icon name="spinner" size={13} className="spin" /> running…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
