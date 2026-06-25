// Tiny subsequence fuzzy matcher with scoring. Good enough for a command
// palette and @-file mention list; no dependency.

export interface FuzzyMatch<T> {
  item: T;
  score: number;
  indices: number[];
}

/** Score a single candidate against a lowercased query. Higher is better;
 *  returns null when the query is not a subsequence of the candidate. */
export function fuzzyScore(query: string, candidate: string): { score: number; indices: number[] } | null {
  if (!query) return { score: 0, indices: [] };
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  let qi = 0;
  let score = 0;
  let prevIdx = -2;
  const indices: number[] = [];
  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (c[ci] === q[qi]) {
      indices.push(ci);
      // Reward consecutive matches and word-boundary starts.
      let bonus = 1;
      if (ci === prevIdx + 1) bonus += 3;
      if (ci === 0 || /[\s/\\._-]/.test(c[ci - 1])) bonus += 2;
      score += bonus;
      prevIdx = ci;
      qi++;
    }
  }
  if (qi < q.length) return null;
  // Prefer shorter candidates and earlier first matches.
  score -= candidate.length * 0.05;
  score -= (indices[0] ?? 0) * 0.1;
  return { score, indices };
}

export function fuzzyFilter<T>(
  query: string,
  items: T[],
  key: (item: T) => string,
): FuzzyMatch<T>[] {
  const out: FuzzyMatch<T>[] = [];
  for (const item of items) {
    const res = fuzzyScore(query, key(item));
    if (res) out.push({ item, score: res.score, indices: res.indices });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Split a string into matched / unmatched runs for highlight rendering. */
export function highlightRuns(text: string, indices: number[]): { text: string; hit: boolean }[] {
  if (!indices.length) return [{ text, hit: false }];
  const set = new Set(indices);
  const runs: { text: string; hit: boolean }[] = [];
  let cur = "";
  let curHit = set.has(0);
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit === curHit) {
      cur += text[i];
    } else {
      if (cur) runs.push({ text: cur, hit: curHit });
      cur = text[i];
      curHit = hit;
    }
  }
  if (cur) runs.push({ text: cur, hit: curHit });
  return runs;
}
