// ============================================================================
// Empty-state project chooser — rendered in the center when the active tab has
// no cwd. NOT an overlay; a plain centered panel. Browse… + recent projects.
// ============================================================================
import { useEffect } from "react";
import { useStore } from "../../lib/store";
import { pickDirectory } from "../../lib/ipc";
import type { RecentProject } from "../../lib/types";
import { Icon } from "../common/Icon";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0 || Number.isNaN(diff)) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

export default function ProjectPicker() {
  const projects = useStore((s) => s.projects);
  const setProject = useStore((s) => s.setProject);
  const refreshProjects = useStore((s) => s.refreshProjects);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  async function browse() {
    const path = await pickDirectory();
    if (path) await setProject(path);
  }

  return (
    <div className="project-picker">
      <div className="project-picker__hero">
        <Icon name="folder" size={32} className="project-picker__hero-icon" />
        <h1 className="project-picker__title">Choose a working directory</h1>
        <p className="project-picker__subtitle">
          Pick a folder for Claude to work in. Recent projects open instantly.
        </p>
        <button type="button" className="project-picker__browse" onClick={() => void browse()}>
          <Icon name="folder" />
          <span>Browse…</span>
        </button>
      </div>

      {projects.length > 0 ? (
        <div className="project-picker__recent">
          <h2 className="project-picker__recent-heading">Recent</h2>
          <ul className="project-picker__list">
            {projects.map((p: RecentProject) => (
              <li key={p.path}>
                <button
                  type="button"
                  className="project-card"
                  onClick={() => void setProject(p.path)}
                >
                  <span className="project-card__icon">
                    <Icon name="folder" />
                  </span>
                  <span className="project-card__body">
                    <span className="project-card__name">{p.name}</span>
                    <span className="project-card__path">{p.path}</span>
                  </span>
                  <span className="project-card__time">{timeAgo(p.lastOpened)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="project-picker__hint">No recent projects yet — browse to get started.</p>
      )}
    </div>
  );
}
