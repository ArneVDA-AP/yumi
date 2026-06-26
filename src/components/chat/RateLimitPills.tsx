// 5h / 7d rate-limit pills for the top bar.
//
// Honest by construction: there is no reliable LOCAL source of rolling-window
// percentages, so until a real in-stream `rate_limit_event` arrives the pills
// render greyed "—" with an explanatory tooltip (never fake numbers). When the
// CLI emits a live rate_limit_event, `usage.live` flips true and the pills show
// the real status + window + reset.

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

/** Short "resets in …" label from an ISO timestamp, or null if absent/past. */
function resetLabel(iso?: string): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `resets in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `resets in ${hrs}h`;
  return `resets in ${Math.round(hrs / 24)}d`;
}

export function RateLimitPills({ usage, onRefresh }: RateLimitPillsProps) {
  if (!usage) return null;

  // No real signal yet → greyed, honest "unavailable" pills (no fake numbers).
  if (!usage.live) {
    return (
      <div
        className="rl-pills is-unavailable"
        title="Usage data unavailable — no local rolling-window source. Pills update live when Claude reports a rate limit. Click to refresh."
        onClick={onRefresh}
      >
        <span className="rl-pill is-muted">
          <span className="rl-pill__k">5h</span>
          <span className="rl-pill__v">—</span>
        </span>
        <span className="rl-pill is-muted">
          <span className="rl-pill__k">7d</span>
          <span className="rl-pill__v">—</span>
        </span>
      </div>
    );
  }

  // Live signal from an in-stream rate_limit_event.
  const reset = resetLabel(usage.resetsAt);
  const win = usage.windowType ? usage.windowType.replace("_", "-") : null;
  const title = [
    "Live from Claude",
    win ? `${win} window` : null,
    reset,
  ]
    .filter(Boolean)
    .join(" · ") + " — click to refresh";

  const slot = (key: "five_hour" | "seven_day", label: string, p?: number) => (
    <span className={`rl-pill ${level(p)}`}>
      <span className="rl-pill__k">{label}</span>
      <span className="rl-pill__v">
        {p != null ? pct(p) : usage.windowType === key && !usage.rateLimited ? "ok" : "—"}
      </span>
    </span>
  );

  return (
    <div className="rl-pills" title={title} onClick={onRefresh}>
      {usage.rateLimited && (
        <span className="rl-pill rl-pill--blocked">
          <Icon name="warning" size={12} /> limited
        </span>
      )}
      {slot("five_hour", "5h", usage.fiveHourPct)}
      {slot("seven_day", "7d", usage.sevenDayPct)}
    </div>
  );
}
