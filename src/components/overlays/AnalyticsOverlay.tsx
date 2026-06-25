// ============================================================================
// Analytics overlay — totals + per-model and per-date cost breakdowns. Loads
// once on mount via dbGetAnalytics(); tolerates a stub backend (empty state).
// ============================================================================
import { useEffect, useState } from "react";
import { useStore } from "../../lib/store";
import { dbGetAnalytics } from "../../lib/ipc";
import type { Analytics } from "../../lib/types";
import Overlay from "./Overlay";

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function formatCost(n: number): string {
  return `$${n.toFixed(n < 100 ? 2 : 0)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function AnalyticsOverlay() {
  const setOverlay = useStore((s) => s.setOverlay);
  const [data, setData] = useState<Analytics | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await dbGetAnalytics();
        if (alive) setData(res);
      } catch {
        if (alive) setData(null);
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const isEmpty = !data || data.sessionsCount === 0;
  const maxModelCost = data ? Math.max(...data.byModel.map((m) => m.costUsd), 0) : 0;
  const recentDates = data ? data.byDate.slice(-14) : [];
  const maxDateCost = Math.max(...recentDates.map((d) => d.costUsd), 0);

  return (
    <Overlay title="Analytics" wide onClose={() => setOverlay(null)}>
      <div className="analytics">
        {loaded && isEmpty && <div className="analytics__empty">No analytics yet</div>}

        {!isEmpty && data && (
          <>
            <div className="analytics__cards">
              <div className="stat-card">
                <span className="stat-card__label">Total cost</span>
                <span className="stat-card__value">{formatCost(data.totalCostUsd)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">Input tokens</span>
                <span className="stat-card__value">{formatNum(data.totalInputTokens)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">Output tokens</span>
                <span className="stat-card__value">{formatNum(data.totalOutputTokens)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">Sessions</span>
                <span className="stat-card__value">{formatNum(data.sessionsCount)}</span>
              </div>
            </div>

            {data.byModel.length > 0 && (
              <section className="analytics__section">
                <h3 className="analytics__heading">By model</h3>
                <div className="analytics__models">
                  {data.byModel.map((m) => (
                    <div key={m.model} className="model-row">
                      <span className="model-row__name">{m.model}</span>
                      <div className="model-row__bar-track">
                        <div
                          className="model-row__bar"
                          style={{ width: `${maxModelCost > 0 ? (m.costUsd / maxModelCost) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="model-row__cost">{formatCost(m.costUsd)}</span>
                      <span className="model-row__tokens">
                        {formatNum(m.inputTokens)} in / {formatNum(m.outputTokens)} out
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {recentDates.length > 0 && (
              <section className="analytics__section">
                <h3 className="analytics__heading">By date</h3>
                <div className="analytics__dates">
                  {recentDates.map((d) => (
                    <div key={d.date} className="date-bar">
                      <div className="date-bar__track">
                        <div
                          className="date-bar__fill"
                          style={{ height: `${maxDateCost > 0 ? (d.costUsd / maxDateCost) * 100 : 0}%` }}
                          title={`${formatDate(d.date)} · ${formatCost(d.costUsd)}`}
                        />
                      </div>
                      <span className="date-bar__label">{formatDate(d.date)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </Overlay>
  );
}
