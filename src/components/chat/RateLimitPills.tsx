// 5h / 7d rate-limit pills for the top bar. Best-effort: tolerates a stub
// backend (usage null) by rendering nothing.

import type { UsageLimits } from "../../lib/types";
import { Icon } from "../common/Icon";

interface RateLimitPillsProps {
  usage: UsageLimits | null;
  onRefresh: () => void;
}

function pct(v?: number): string {
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
}

function level(v?: number): string {
  if (v == null) return "";
  if (v >= 0.9) return "is-danger";
  if (v >= 0.7) return "is-warn";
  return "";
}

export function RateLimitPills({ usage, onRefresh }: RateLimitPillsProps) {
  if (!usage) return null;
  return (
    <div className="rl-pills" title="Usage limits — click to refresh" onClick={onRefresh}>
      {usage.rateLimited && (
        <span className="rl-pill rl-pill--blocked">
          <Icon name="warning" size={12} /> limited
        </span>
      )}
      <span className={`rl-pill ${level(usage.fiveHourPct)}`}>
        <span className="rl-pill__k">5h</span>
        <span className="rl-pill__v">{pct(usage.fiveHourPct)}</span>
      </span>
      <span className={`rl-pill ${level(usage.sevenDayPct)}`}>
        <span className="rl-pill__k">7d</span>
        <span className="rl-pill__v">{pct(usage.sevenDayPct)}</span>
      </span>
    </div>
  );
}
