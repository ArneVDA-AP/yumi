// Per-model context-window sizes (tokens). Kills the hardcoded-200K assumption
// (the bug Yume never fixed) so 1M-context models read correctly on the token
// bar. Matched by pattern, most-specific first; unknown models fall back to 200K.

export const DEFAULT_CONTEXT_WINDOW = 200_000;

const WINDOWS: { match: RegExp; window: number }[] = [
  { match: /\[1m\]|[-:_]1m\b/i, window: 1_000_000 }, // explicit 1M variants, e.g. sonnet[1m]
  { match: /gemini/i, window: 1_048_576 },           // Gemini 2.5 ~1M
  { match: /gpt-?5/i, window: 400_000 },              // GPT-5 family (routed)
  { match: /\bo[34]\b|gpt-?4/i, window: 200_000 },     // o3/o4-mini, GPT-4 (word-bounded)
  { match: /claude|opus|sonnet|haiku|fable/i, window: 200_000 },
];

/** Context window (in tokens) for a model id; 200K default for unknown models. */
export function contextWindowFor(model: string | null | undefined): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW;
  for (const { match, window } of WINDOWS) {
    if (match.test(model)) return window;
  }
  return DEFAULT_CONTEXT_WINDOW;
}
