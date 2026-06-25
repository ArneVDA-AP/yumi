// Background-agents panel. Launch an isolated agent that runs in a git worktree
// on its own branch; watch status; merge its branch back or inspect its diff.

import { useEffect, useState } from "react";
import { useStore } from "../../lib/store";
import { Icon } from "../common/Icon";
import { CodeBlock } from "../common/CodeBlock";

export default function AgentsPanel() {
  const agents = useStore((s) => s.agents);
  const refreshAgents = useStore((s) => s.refreshAgents);
  const startAgent = useStore((s) => s.startAgent);
  const mergeAgent = useStore((s) => s.mergeAgent);
  const cancelAgent = useStore((s) => s.cancelAgent);
  const removeAgent = useStore((s) => s.removeAgent);
  const getAgentDiff = useStore((s) => s.getAgentDiff);
  const togglePanel = useStore((s) => s.togglePanel);
  const cwd = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.cwd) ?? "";

  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);

  const run = async () => {
    if (!prompt.trim() || !cwd) return;
    setBusy(true);
    try {
      await startAgent(prompt);
      setPrompt("");
    } catch {
      /* surfaced via agent status */
    } finally {
      setBusy(false);
    }
  };

  const showDiff = async (id: string) => {
    const text = await getAgentDiff(id);
    setDiff({ id, text });
  };

  return (
    <div className="panel agents-panel">
      <div className="panel__header">
        <Icon name="robot" size={15} className="panel__header-icon" />
        <span className="panel__title">Agents</span>
        <span className="panel__spacer" />
        <button className="panel__icon-btn" onClick={() => void refreshAgents()} title="Refresh" type="button">
          <Icon name="chevron-down" size={15} />
        </button>
        <button className="panel__icon-btn" onClick={() => togglePanel("agents")} title="Close" type="button">
          <Icon name="close" size={15} />
        </button>
      </div>

      <div className="panel__body agents-panel__body">
        <div className="agents-panel__new">
          <textarea
            className="agents-panel__textarea"
            value={prompt}
            placeholder="Task for an isolated agent (runs on its own git-worktree branch)…"
            rows={3}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="agents-panel__new-row">
            {!cwd ? (
              <span className="agents-panel__hint">Open a project (git repo) first.</span>
            ) : (
              <span className="agents-panel__hint" title={cwd}>
                branches from {cwd}
              </span>
            )}
            <button
              type="button"
              className="agents-panel__run"
              onClick={() => void run()}
              disabled={busy || !prompt.trim() || !cwd}
            >
              <Icon name="robot" size={13} /> Run agent
            </button>
          </div>
        </div>

        {agents.length === 0 ? (
          <div className="panel__empty">No agents yet</div>
        ) : (
          <ul className="agents-panel__list">
            {agents.map((a) => (
              <li className="agent-row" key={a.id}>
                <div className="agent-row__top">
                  <span className={`agent-badge agent-badge--${a.status}`}>{a.status}</span>
                  <span className="agent-row__title" title={a.prompt}>
                    {a.title}
                  </span>
                </div>
                <div className="agent-row__meta" title={a.worktree}>
                  <Icon name="git" size={11} /> {a.branch}
                </div>
                {a.detail && <div className="agent-row__detail">{a.detail}</div>}
                <div className="agent-row__actions">
                  {a.status === "running" && (
                    <button type="button" onClick={() => void cancelAgent(a.id)}>
                      <Icon name="stop" size={12} /> Cancel
                    </button>
                  )}
                  {a.status === "done" && (
                    <button type="button" className="is-primary" onClick={() => void mergeAgent(a.id)}>
                      <Icon name="merge" size={12} /> Merge
                    </button>
                  )}
                  {(a.status === "done" || a.status === "merged" || a.status === "failed") && (
                    <button type="button" onClick={() => void showDiff(a.id)}>
                      <Icon name="git" size={12} /> Diff
                    </button>
                  )}
                  <button type="button" onClick={() => void removeAgent(a.id)}>
                    <Icon name="trash" size={12} /> Remove
                  </button>
                </div>
                {diff && diff.id === a.id && (
                  <div className="agent-row__diff">
                    {diff.text.trim() ? (
                      <CodeBlock code={diff.text.slice(0, 20000)} language="diff" />
                    ) : (
                      <div className="panel__empty">No diff</div>
                    )}
                    <button type="button" className="agent-row__diff-close" onClick={() => setDiff(null)}>
                      close diff
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
