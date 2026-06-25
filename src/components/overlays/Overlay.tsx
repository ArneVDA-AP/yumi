// ============================================================================
// Shared modal shell. Full-screen dim backdrop + centered card. Esc handling is
// global (see lib/shortcuts) — intentionally NO key listener here.
// ============================================================================
import type { MouseEvent, ReactNode } from "react";
import { Icon } from "../common/Icon";

interface OverlayProps {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  bare?: boolean;
}

export default function Overlay({ title, onClose, children, wide, bare }: OverlayProps) {
  const stop = (e: MouseEvent) => e.stopPropagation();
  const cardClass = ["overlay-card", wide ? "is-wide" : "", bare ? "is-bare" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className={cardClass} onClick={stop} role="dialog" aria-modal="true" aria-label={title}>
        {!bare && (
          <header className="overlay-card__header">
            <h2 className="overlay-card__title">{title}</h2>
            <button className="overlay-card__close" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          </header>
        )}
        {children}
      </div>
    </div>
  );
}
