// Right-side Git panel: branch/ahead/behind header, staged/unstaged/untracked
// file lists, and a staged-vs-working diff rendered through CodeBlock.

import { useCallback, useEffect, useState } from "react";
import { gitStatus, gitDiff } from "../../lib/ipc";
import type { GitStatus } from "../../lib/types";
import { useActiveTab, useStore } from "../../lib/store";
import { Icon } from "../common/Icon";
import { CodeBlock } from "../common/CodeBlock";

const DIFF_CAP = 20000;

type StatusLetter = "S" | "M" | "U";

interface SectionProps {
  title: string;
  letter: StatusLetter;
  files: string[];
}

function FileSection({ title, letter, files }: SectionProps) {
  return (
    <div className="git-panel__section">
      <div className="git-panel__section-head">
        <span className="git-panel__section-title">{title}</span>
        <span className="git-panel__section-count">{files.length}</span>
      </div>
      {files.length === 0 ? (
        <div className="git-panel__empty-row">—</div>
      ) : (
        <ul className="git-panel__list">
          {files.map((f) => (
            <li className="git-panel__row" key={f} title={f}>
              <span className={`git-panel__letter git-panel__letter--${letter.toLowerCase()}`}>
                {letter}
              </span>
              <span className="git-panel__path">{f}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function GitPanel() {
  const tab = useActiveTab();
  const cwd = tab?.cwd ?? "";
  const togglePanel = useStore((s) => s.togglePanel);

  const [status, setStatus] = useState<GitStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const [showStaged, setShowStaged] = useState(false);
  const [diff, setDiff] = useState("");
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!cwd) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const s = await gitStatus(cwd);
      setStatus(s);
    } catch {
      setStatus(null);
      setStatusError("Not a git repository or unavailable");
    } finally {
      setStatusLoading(false);
    }
  }, [cwd]);

  const loadDiff = useCallback(async () => {
    if (!cwd) return;
    setDiffLoading(true);
    setDiffError(null);
    try {
      const raw = await gitDiff(cwd, showStaged);
      setDiff(raw);
    } catch {
      setDiff("");
      setDiffError("Could not load diff");
    } finally {
      setDiffLoading(false);
    }
  }, [cwd, showStaged]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    void loadDiff();
  }, [loadDiff]);

  const refresh = () => {
    void loadStatus();
    void loadDiff();
  };

  const truncated = diff.length > DIFF_CAP;
  const shownDiff = truncated ? `${diff.slice(0, DIFF_CAP)}\n…truncated` : diff;

  return (
    <div className="panel git-panel">
      <div className="panel__header">
        <Icon name="git" size={15} className="panel__header-icon" />
        <span className="panel__title">Git</span>
        {status && (
          <span className="git-panel__branch" title={status.branch}>
            {status.branch}
            {(status.ahead > 0 || status.behind > 0) && (
              <span className="git-panel__tracking">
                {status.ahead > 0 && <span className="git-panel__ahead">↑{status.ahead}</span>}
                {status.behind > 0 && <span className="git-panel__behind">↓{status.behind}</span>}
              </span>
            )}
          </span>
        )}
        <span className="panel__spacer" />
        <button
          className="panel__icon-btn"
          onClick={refresh}
          title="Refresh"
          type="button"
          disabled={!cwd || statusLoading}
        >
          <Icon name="chevron-down" size={15} />
        </button>
        <button
          className="panel__icon-btn"
          onClick={() => togglePanel("git")}
          title="Close"
          type="button"
        >
          <Icon name="close" size={15} />
        </button>
      </div>

      <div className="panel__body git-panel__body">
        {!cwd ? (
          <div className="panel__empty">Open a project to use this panel</div>
        ) : statusLoading && !status ? (
          <div className="panel__loading">Loading…</div>
        ) : statusError ? (
          <div className="panel__error">
            <Icon name="warning" size={14} /> {statusError}
          </div>
        ) : status ? (
          <>
            <FileSection title="Staged" letter="S" files={status.staged} />
            <FileSection title="Unstaged" letter="M" files={status.unstaged} />
            <FileSection title="Untracked" letter="U" files={status.untracked} />

            <div className="git-panel__diff">
              <div className="git-panel__diff-toggle">
                <button
                  className={`git-panel__toggle-btn${showStaged ? "" : " git-panel__toggle-btn--active"}`}
                  onClick={() => setShowStaged(false)}
                  type="button"
                >
                  Working diff
                </button>
                <button
                  className={`git-panel__toggle-btn${showStaged ? " git-panel__toggle-btn--active" : ""}`}
                  onClick={() => setShowStaged(true)}
                  type="button"
                >
                  Staged diff
                </button>
              </div>

              {diffLoading ? (
                <div className="panel__loading">Loading diff…</div>
              ) : diffError ? (
                <div className="panel__error">
                  <Icon name="warning" size={14} /> {diffError}
                </div>
              ) : shownDiff.trim() ? (
                <CodeBlock code={shownDiff} language="diff" />
              ) : (
                <div className="panel__empty">No changes</div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
