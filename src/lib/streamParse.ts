// ============================================================================
// Stream reducer — folds a ClaudeEvent into the in-flight assistant ChatMessage.
//
// Contract (CONTRACT.md §"Frontend stream reducer"):
//   text_delta / thinking_delta  -> append to the active text/thinking block
//                                    (create one if the active block is a
//                                    different kind or none exists).
//   assistant_text / assistant_thinking (COMPLETE) -> commit/replace the active
//                                    block's text with the full block.
//   tool_use     -> push a tool card { running:true }.
//   tool_result  -> match by toolUseId, attach content, running:false.
//   result       -> finalize message: cost, durationMs, streaming:false.
//
// The reducer is pure: it takes the current assistant message (or null) and an
// event, and returns the next assistant message plus a small set of side-signal
// flags the store uses (sessionId learned, usage, completion).
// ============================================================================

import type {
  ChatMessage,
  ClaudeEvent,
  MessageBlock,
} from "./types";

export interface ReduceResult {
  /** The in-flight assistant message after applying the event (may be null
   *  if the event produced no assistant content, e.g. a bare system line). */
  message: ChatMessage | null;
  /** True when this event finalized the message (result / completion). */
  finalized: boolean;
  /** claude session uuid learned from a system/init line, if any. */
  claudeSessionId?: string;
  /** usage deltas surfaced for the token/context bar. */
  usage?: { inputTokens?: number; outputTokens?: number; cacheRead?: number; cacheCreation?: number };
  /** rate-limit raw payload, if this was a rate_limit event. */
  rateLimit?: unknown;
  /** error message, if this was an error event. */
  error?: string;
}

let _idCounter = 0;
export function newMessageId(): string {
  _idCounter += 1;
  return `m${Date.now().toString(36)}_${_idCounter}`;
}

/** Create a fresh, empty, streaming assistant message. */
export function emptyAssistant(): ChatMessage {
  return { id: newMessageId(), role: "assistant", blocks: [], streaming: true };
}

function cloneBlocks(blocks: MessageBlock[]): MessageBlock[] {
  // Shallow clone of the array + each block object so React sees new refs.
  return blocks.map((b) => ({ ...b }));
}

/** Index of the last block of a given type, or -1. */
function lastBlockIndexOfType(blocks: MessageBlock[], type: MessageBlock["type"]): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === type) return i;
  }
  return -1;
}

/** Is the final block of this kind (so deltas keep appending to it)? */
function activeAppendIndex(blocks: MessageBlock[], type: "text" | "thinking"): number {
  const last = blocks[blocks.length - 1];
  if (last && last.type === type) return blocks.length - 1;
  return -1;
}

/**
 * Apply one event to the in-flight assistant message.
 * `current` is the message being streamed (or null if none started yet).
 */
export function reduceEvent(current: ChatMessage | null, event: ClaudeEvent): ReduceResult {
  switch (event.kind) {
    case "system": {
      return {
        message: current,
        finalized: false,
        claudeSessionId: event.claudeSessionId,
      };
    }

    case "text_delta": {
      if (!event.text) return { message: current, finalized: false };
      const msg = current ?? emptyAssistant();
      const blocks = cloneBlocks(msg.blocks);
      const idx = activeAppendIndex(blocks, "text");
      if (idx >= 0 && blocks[idx].type === "text") {
        blocks[idx] = { type: "text", text: blocks[idx].text + event.text };
      } else {
        blocks.push({ type: "text", text: event.text });
      }
      return { message: { ...msg, blocks, streaming: true }, finalized: false };
    }

    case "thinking_delta": {
      if (!event.text) return { message: current, finalized: false };
      const msg = current ?? emptyAssistant();
      const blocks = cloneBlocks(msg.blocks);
      const idx = activeAppendIndex(blocks, "thinking");
      if (idx >= 0 && blocks[idx].type === "thinking") {
        blocks[idx] = { type: "thinking", text: blocks[idx].text + event.text };
      } else {
        blocks.push({ type: "thinking", text: event.text });
      }
      return { message: { ...msg, blocks, streaming: true }, finalized: false };
    }

    case "assistant_text": {
      const msg = current ?? emptyAssistant();
      const blocks = cloneBlocks(msg.blocks);
      // Commit: replace the trailing streamed text block, else append.
      const idx = activeAppendIndex(blocks, "text");
      if (idx >= 0) {
        blocks[idx] = { type: "text", text: event.text };
      } else {
        blocks.push({ type: "text", text: event.text });
      }
      return { message: { ...msg, blocks, streaming: true }, finalized: false };
    }

    case "assistant_thinking": {
      const msg = current ?? emptyAssistant();
      const blocks = cloneBlocks(msg.blocks);
      const idx = activeAppendIndex(blocks, "thinking");
      if (idx >= 0) {
        blocks[idx] = { type: "thinking", text: event.text };
      } else {
        blocks.push({ type: "thinking", text: event.text });
      }
      return { message: { ...msg, blocks, streaming: true }, finalized: false };
    }

    case "tool_use": {
      const msg = current ?? emptyAssistant();
      const blocks = cloneBlocks(msg.blocks);
      blocks.push({
        type: "tool_use",
        id: event.id,
        name: event.name,
        input: event.input,
        running: true,
      });
      return { message: { ...msg, blocks, streaming: true }, finalized: false };
    }

    case "tool_result": {
      if (!current) return { message: current, finalized: false };
      const blocks = cloneBlocks(current.blocks);
      // Match by toolUseId; fall back to last running tool_use.
      let target = -1;
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        if (b.type === "tool_use" && b.id === event.toolUseId) {
          target = i;
          break;
        }
      }
      if (target < 0) {
        target = lastBlockIndexOfType(blocks, "tool_use");
      }
      const tgt = target >= 0 ? blocks[target] : undefined;
      if (tgt && tgt.type === "tool_use") {
        blocks[target] = {
          ...tgt,
          result: event.content,
          isError: event.isError,
          running: false,
        };
      }
      return { message: { ...current, blocks, streaming: true }, finalized: false };
    }

    case "usage": {
      return {
        message: current,
        finalized: false,
        usage: {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheRead: event.cacheRead,
          cacheCreation: event.cacheCreation,
        },
      };
    }

    case "rate_limit": {
      return { message: current, finalized: false, rateLimit: event.data };
    }

    case "turn_done": {
      // The answer is complete (end_turn). Finalize now — the `result` line that
      // carries cost/duration can lag many seconds behind when post-turn Stop
      // hooks run, and the backend stops emitting after this, so don't wait.
      const usage = {
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheRead: event.cacheRead,
        cacheCreation: event.cacheCreation,
      };
      if (!current) return { message: null, finalized: true, usage };
      const blocks = cloneBlocks(current.blocks).map((b) =>
        b.type === "tool_use" && b.running ? { ...b, running: false } : b,
      );
      return {
        message: { ...current, blocks, streaming: false },
        finalized: true,
        usage,
      };
    }

    case "result": {
      if (!current) {
        // A result with no streamed content — synthesize a message holding the
        // result text so the turn isn't silently lost.
        const text = event.resultText?.trim();
        if (text) {
          const msg: ChatMessage = {
            id: newMessageId(),
            role: "assistant",
            blocks: [{ type: "text", text }],
            streaming: false,
            cost: event.totalCostUsd,
            durationMs: event.durationMs,
          };
          return { message: msg, finalized: true };
        }
        return { message: null, finalized: true };
      }
      // Mark any still-running tool cards as finished (process ended).
      const blocks = cloneBlocks(current.blocks).map((b) =>
        b.type === "tool_use" && b.running ? { ...b, running: false } : b,
      );
      return {
        message: {
          ...current,
          blocks,
          streaming: false,
          cost: event.totalCostUsd,
          durationMs: event.durationMs,
        },
        finalized: true,
      };
    }

    case "error": {
      return { message: current, finalized: false, error: event.message };
    }

    case "raw": {
      // Non-lossy: keep raw lines out of the visible message but don't crash.
      return { message: current, finalized: false };
    }

    default: {
      // Exhaustiveness guard — unreachable if ClaudeEvent is fully handled.
      const _never: never = event;
      void _never;
      return { message: current, finalized: false };
    }
  }
}

/** Serialize a message's blocks for DB storage (StoredMessage.content). */
export function serializeBlocks(blocks: MessageBlock[]): string {
  return JSON.stringify(blocks);
}

/** Parse stored blocks JSON back into MessageBlock[] (tolerant). */
export function deserializeBlocks(content: string): MessageBlock[] {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed as MessageBlock[];
    return [{ type: "text", text: String(content) }];
  } catch {
    return [{ type: "text", text: content }];
  }
}
