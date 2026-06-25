// Floating @-mention file list shown above the composer. The parent already
// filters/sorts `items`; here we re-score each name against `query` purely for
// highlight runs so the matched chars stand out.

import { Icon } from "../common/Icon";
import { fuzzyScore, highlightRuns } from "../common/fuzzy";
import type { DirEntry } from "../../lib/types";

interface MentionPopupProps {
  items: DirEntry[];
  activeIndex: number;
  onPick: (entry: DirEntry) => void;
  onHover: (i: number) => void;
  query: string;
}

const MAX_ROWS = 8;

export default function MentionPopup({
  items,
  activeIndex,
  onPick,
  onHover,
  query,
}: MentionPopupProps) {
  const visible = items.slice(0, MAX_ROWS);
  if (visible.length === 0) return null;

  return (
    <ul className="mention-popup" role="listbox">
      {visible.map((entry, i) => {
        const indices = fuzzyScore(query, entry.name)?.indices ?? [];
        const runs = highlightRuns(entry.name, indices);
        return (
          <li
            key={entry.path}
            role="option"
            aria-selected={i === activeIndex}
            className={`mention-popup__row${i === activeIndex ? " is-active" : ""}`}
            // Use mousedown so the textarea does not blur before the pick fires.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(entry);
            }}
            onMouseEnter={() => onHover(i)}
          >
            <Icon
              name={entry.isDir ? "folder" : "file"}
              size={14}
              className="mention-popup__icon"
            />
            <span className="mention-popup__name">
              {runs.map((run, ri) =>
                run.hit ? (
                  <mark key={ri} className="mention-popup__hit">
                    {run.text}
                  </mark>
                ) : (
                  <span key={ri}>{run.text}</span>
                ),
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
