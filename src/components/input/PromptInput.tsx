// Bottom composer: token bar + auto-growing textarea + send/stop controls and
// an inline @-mention file picker. Reads the active tab straight from the store.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { useStore } from "../../lib/store";
import { listDirectory } from "../../lib/ipc";
import { fuzzyFilter } from "../common/fuzzy";
import { Icon } from "../common/Icon";
import type { DirEntry } from "../../lib/types";
import TokenBar from "./TokenBar";
import MentionPopup from "./MentionPopup";
import { useDictation } from "./useDictation";

interface PromptInputProps {
  /** Pane-scoped tab id; defaults to the active tab (single-view). */
  tabId?: string;
}

const MAX_HEIGHT = 240;
const MAX_MENTION_RESULTS = 8;

interface MentionState {
  // Range of the raw `@token` (including the leading `@`) within the draft.
  start: number;
  end: number;
  query: string;
}

/** Detect an `@token` at the caret by scanning back to whitespace or start. */
function detectMention(text: string, caret: number): MentionState | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === "@") {
      // Must be at start or preceded by whitespace to count as a trigger.
      const before = text[i - 1];
      if (i === 0 || /\s/.test(before)) {
        return { start: i, end: caret, query: text.slice(i + 1, caret) };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}

export default function PromptInput({ tabId: tabIdProp }: PromptInputProps = {}) {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const resolvedId = tabIdProp ?? activeTabId;
  const tab = tabs.find((t) => t.id === resolvedId) ?? null;

  const setDraft = useStore((s) => s.setDraft);
  const send = useStore((s) => s.send);
  const stop = useStore((s) => s.stop);

  // Voice dictation (F5 / mic). Only the active pane records, so split-view
  // panes don't all listen at once.
  const voiceActive = useStore((s) => s.voiceActive);
  const setVoiceActive = useStore((s) => s.setVoiceActive);
  const isActivePane = resolvedId === activeTabId;
  const appendVoice = useCallback(
    (text: string) => {
      if (!resolvedId) return;
      const cur = useStore.getState().tabs.find((t) => t.id === resolvedId)?.draft ?? "";
      const sep = cur && !/\s$/.test(cur) ? " " : "";
      setDraft(resolvedId, cur + sep + text.trim());
    },
    [resolvedId, setDraft],
  );
  const dictation = useDictation(voiceActive && isActivePane, appendVoice);
  // If the platform can't dictate, don't leave the flag stuck "on".
  useEffect(() => {
    if (voiceActive && isActivePane && !dictation.supported) setVoiceActive(false);
  }, [voiceActive, isActivePane, dictation.supported, setVoiceActive]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const tabId = tab?.id ?? null;
  const cwd = tab?.cwd ?? "";
  const draft = tab?.draft ?? "";
  const streaming = tab?.streaming ?? false;
  const error = tab?.error ?? null;

  // Auto-grow the textarea up to the cap, then scroll.
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [draft, resize]);

  // Load the cwd directory listing lazily once a mention is first triggered for
  // this cwd. Re-fetch when cwd changes while a mention is open.
  useEffect(() => {
    if (!mention || !cwd) return;
    let cancelled = false;
    void listDirectory(cwd)
      .then((res) => {
        if (!cancelled) setEntries(res);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mention, cwd]);

  // Reset entries cache when switching tabs / cwd so we don't show stale files.
  useEffect(() => {
    setEntries([]);
    setMention(null);
  }, [tabId, cwd]);

  const matches = useMemo<DirEntry[]>(() => {
    if (!mention) return [];
    const filtered = fuzzyFilter(mention.query, entries, (e) => e.name)
      .slice(0, MAX_MENTION_RESULTS)
      .map((m) => m.item);
    return filtered;
  }, [mention, entries]);

  const mentionOpen = mention !== null && matches.length > 0;

  const syncMention = useCallback((value: string, caret: number) => {
    const m = detectMention(value, caret);
    setMention(m);
    setActiveIndex(0);
  }, []);

  const onChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      if (!tabId) return;
      const value = e.target.value;
      setDraft(tabId, value);
      syncMention(value, e.target.selectionStart ?? value.length);
    },
    [tabId, setDraft, syncMention],
  );

  const doSend = useCallback(() => {
    if (!tabId || !cwd || streaming) return;
    if (!draft.trim()) return;
    void send(tabId, draft);
  }, [tabId, cwd, streaming, draft, send]);

  const pickMention = useCallback(
    (entry: DirEntry) => {
      if (!tabId || !mention) return;
      const insert = entry.isDir ? `${entry.name}/` : entry.name;
      const next = draft.slice(0, mention.start) + insert + draft.slice(mention.end);
      setDraft(tabId, next);
      setMention(null);
      // Restore focus and place the caret right after the inserted name.
      const caret = mention.start + insert.length;
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(caret, caret);
        }
      });
    },
    [tabId, mention, draft, setDraft],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % matches.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setMention(null);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const entry = matches[activeIndex];
          if (entry) pickMention(entry);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    },
    [mentionOpen, matches, activeIndex, pickMention, doSend],
  );

  // The store has no action to clear tab.error, so dismissal is local-only.
  // Reset the hidden flag whenever a new error arrives.
  const [errorHidden, setErrorHidden] = useState(false);
  useEffect(() => {
    setErrorHidden(false);
  }, [error]);
  const dismissError = useCallback(() => setErrorHidden(true), []);

  if (!tab) return null;

  const hasCwd = cwd.length > 0;
  const placeholder = hasCwd
    ? "Message Claude…  (Enter to send, Shift+Enter for newline)"
    : "Pick a working directory to start chatting";
  const canSend = hasCwd && !streaming && draft.trim().length > 0;

  return (
    <div className="prompt-input">
      <TokenBar />

      {error && !errorHidden ? (
        <div className="prompt-input__error" role="alert">
          <Icon name="warning" size={14} className="prompt-input__error-icon" />
          <span className="prompt-input__error-text">{error}</span>
          <button
            type="button"
            className="prompt-input__error-dismiss"
            onClick={dismissError}
            aria-label="Dismiss error"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : null}

      <div className="prompt-input__box">
        {mentionOpen ? (
          <MentionPopup
            items={matches}
            activeIndex={activeIndex}
            query={mention?.query ?? ""}
            onPick={pickMention}
            onHover={setActiveIndex}
          />
        ) : null}

        <textarea
          ref={textareaRef}
          className="prompt-input__textarea"
          rows={3}
          value={draft}
          placeholder={placeholder}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onInput={resize}
        />

        <div className="prompt-input__controls">
          <button
            type="button"
            className={`prompt-input__btn prompt-input__btn--mic${
              dictation.listening ? " is-recording" : ""
            }`}
            onClick={() => setVoiceActive(!voiceActive)}
            disabled={!dictation.supported}
            title={
              dictation.supported
                ? voiceActive
                  ? "Stop dictation (F5)"
                  : "Voice dictation (F5)"
                : "Voice dictation unavailable on this platform"
            }
            aria-label="Voice dictation"
          >
            <Icon name="mic" size={16} />
          </button>
          {streaming ? (
            <button
              type="button"
              className="prompt-input__btn prompt-input__btn--stop"
              onClick={() => void stop(tab.id)}
              aria-label="Stop"
            >
              <Icon name="stop" size={16} />
            </button>
          ) : (
            <button
              type="button"
              className="prompt-input__btn prompt-input__btn--send"
              onClick={doSend}
              disabled={!canSend}
              aria-label="Send"
            >
              <Icon name="send" size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="prompt-input__footer">
        <span className="prompt-input__model" title="Model">
          <Icon name="sparkle" size={12} className="prompt-input__model-icon" />
          {tab.model}
        </span>
        {dictation.listening && (
          <span className="prompt-input__dictation" title="Listening…">
            <span className="prompt-input__dictation-dot" />
            {dictation.interim ? dictation.interim : "Listening…"}
          </span>
        )}
        {dictation.error && (
          <span className="prompt-input__dictation prompt-input__dictation--err">
            mic: {dictation.error}
          </span>
        )}
      </div>
    </div>
  );
}
