// Thin context-usage bar above the composer. Reads the active tab's last usage
// and the auto-compact threshold from settings; purely presentational.

import { useActiveTab, useStore } from "../../lib/store";

const CONTEXT_WINDOW = 200_000;
const DANGER_PCT = 0.9;

function formatK(n: number): string {
  if (n <= 0) return "0";
  if (n < 1000) return String(n);
  const k = n / 1000;
  // 12345 -> "12.3k", 200000 -> "200k"
  return `${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
}

export default function TokenBar() {
  const tab = useActiveTab();
  const threshold = useStore((s) => s.settings.autoCompactThreshold);

  const usage = tab?.lastUsage;
  const used = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  const ratio = Math.min(used / CONTEXT_WINDOW, 1);
  const pct = Math.round(ratio * 100);

  let level = "";
  if (ratio >= DANGER_PCT) level = " is-danger";
  else if (ratio >= threshold) level = " is-warn";

  const empty = used <= 0;

  return (
    <div className={`token-bar${empty ? " is-empty" : ""}`}>
      <div className="token-bar__track">
        <div
          className={`token-bar__fill${level}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <span className="token-bar__label">
        {formatK(used)} / {formatK(CONTEXT_WINDOW)}
      </span>
      <span className="token-bar__pct">{pct}%</span>
    </div>
  );
}
