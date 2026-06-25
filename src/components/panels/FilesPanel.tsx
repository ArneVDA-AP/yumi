// Right-side file browser rooted at the active tab's cwd. Lists directories,
// navigates in/out (clamped at the root), and previews text files in a CodeBlock.

import { useCallback, useEffect, useMemo, useState } from "react";
import { listDirectory, readTextFile } from "../../lib/ipc";
import type { DirEntry } from "../../lib/types";
import { useActiveTab, useStore } from "../../lib/store";
import { Icon } from "../common/Icon";
import { CodeBlock } from "../common/CodeBlock";

const PREVIEW_CAP = 40000;

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  rs: "rust",
  py: "python",
  json: "json",
  md: "markdown",
  css: "css",
  html: "html",
  toml: "toml",
};

function langFor(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return undefined;
  return EXT_LANG[name.slice(dot + 1).toLowerCase()];
}

function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// Normalize separators and trim a trailing slash for prefix/segment work.
function norm(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

export default function FilesPanel() {
  const tab = useActiveTab();
  const root = tab?.cwd ?? "";
  const togglePanel = useStore((s) => s.togglePanel);

  const [dir, setDir] = useState(root);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);

  const [file, setFile] = useState<DirEntry | null>(null);
  const [content, setContent] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  // Reset to root whenever the active project changes.
  useEffect(() => {
    setDir(root);
    setFile(null);
    setContent("");
    setFileError(null);
  }, [root]);

  const loadDir = useCallback(async () => {
    if (!dir) return;
    setListLoading(true);
    setListError(null);
    try {
      const list = await listDirectory(dir);
      setEntries(sortEntries(list));
    } catch {
      setEntries([]);
      setListError("Could not read directory");
    } finally {
      setListLoading(false);
    }
  }, [dir]);

  useEffect(() => {
    if (!file) void loadDir();
  }, [file, loadDir]);

  const openFile = useCallback(async (entry: DirEntry) => {
    setFile(entry);
    setFileLoading(true);
    setFileError(null);
    setContent("");
    try {
      const text = await readTextFile(entry.path);
      setContent(text);
    } catch {
      setFileError("Could not read file");
    } finally {
      setFileLoading(false);
    }
  }, []);

  const onRowClick = (entry: DirEntry) => {
    if (entry.isDir) {
      setDir(entry.path);
    } else {
      void openFile(entry);
    }
  };

  const canGoUp = norm(dir) !== norm(root) && norm(dir).length > norm(root).length;

  const goUp = () => {
    const cur = norm(dir);
    const parent = cur.slice(0, cur.lastIndexOf("/"));
    const clamped = parent.length >= norm(root).length ? parent : norm(root);
    setDir(clamped || root);
  };

  const relPath = useMemo(() => {
    const r = norm(root);
    const d = norm(dir);
    if (d === r) return "/";
    if (d.startsWith(r + "/")) return d.slice(r.length);
    return d;
  }, [root, dir]);

  const truncated = content.length > PREVIEW_CAP;
  const shownContent = truncated
    ? `${content.slice(0, PREVIEW_CAP)}\n…truncated`
    : content;

  return (
    <div className="panel files-panel">
      <div className="panel__header">
        <Icon name="folder" size={15} className="panel__header-icon" />
        <span className="panel__title">Files</span>
        <span className="files-panel__crumb" title={file ? file.path : dir}>
          {file ? file.name : relPath}
        </span>
        <span className="panel__spacer" />
        <button
          className="panel__icon-btn"
          onClick={() => togglePanel("files")}
          title="Close"
          type="button"
        >
          <Icon name="close" size={15} />
        </button>
      </div>

      <div className="panel__body files-panel__body">
        {!root ? (
          <div className="panel__empty">Open a project to use this panel</div>
        ) : file ? (
          <div className="files-panel__preview">
            <button
              className="files-panel__back"
              onClick={() => setFile(null)}
              type="button"
            >
              <Icon name="chevron-right" size={14} className="files-panel__back-icon" />
              Back to files
            </button>
            {fileLoading ? (
              <div className="panel__loading">Loading…</div>
            ) : fileError ? (
              <div className="panel__error">
                <Icon name="warning" size={14} /> {fileError}
              </div>
            ) : (
              <CodeBlock code={shownContent} language={langFor(file.name)} />
            )}
          </div>
        ) : (
          <>
            {canGoUp && (
              <button className="files-panel__row files-panel__up" onClick={goUp} type="button">
                <Icon name="folder" size={15} className="files-panel__icon" />
                <span className="files-panel__name">..</span>
              </button>
            )}
            {listLoading ? (
              <div className="panel__loading">Loading…</div>
            ) : listError ? (
              <div className="panel__error">
                <Icon name="warning" size={14} /> {listError}
              </div>
            ) : entries.length === 0 ? (
              <div className="panel__empty">Empty directory</div>
            ) : (
              <ul className="files-panel__list">
                {entries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      className="files-panel__row"
                      onClick={() => onRowClick(entry)}
                      type="button"
                      title={entry.name}
                    >
                      <Icon
                        name={entry.isDir ? "folder" : "file"}
                        size={15}
                        className="files-panel__icon"
                      />
                      <span className="files-panel__name">{entry.name}</span>
                      {entry.isDir && (
                        <Icon
                          name="chevron-right"
                          size={14}
                          className="files-panel__chevron"
                        />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
