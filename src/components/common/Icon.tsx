// Minimal inline SVG icon set (stroke-based, currentColor). Keeps the bundle
// dependency-free and crisp on OLED. Each icon is 16x16 on a 24 viewBox.

import type { CSSProperties } from "react";

export type IconName =
  | "plus"
  | "close"
  | "send"
  | "stop"
  | "settings"
  | "search"
  | "git"
  | "folder"
  | "file"
  | "chart"
  | "chevron-right"
  | "chevron-down"
  | "copy"
  | "check"
  | "spinner"
  | "sparkle"
  | "brain"
  | "tool"
  | "sidebar"
  | "trash"
  | "warning"
  | "bolt"
  | "clock"
  | "rewind"
  | "mic"
  | "grid"
  | "robot"
  | "merge"
  | "terminal";

const paths: Record<IconName, string> = {
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  send: "M5 12h14M13 6l6 6-6 6",
  stop: "M7 7h10v10H7z",
  settings:
    "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 005 19.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H1a2 2 0 110-4h.1A1.7 1.7 0 004.6 5l-.1-.1A2 2 0 117.3 2.1l.1.1a1.7 1.7 0 001.9.3H9.4A1.7 1.7 0 0010.6 1V.9a2 2 0 114 0V1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9.4a1.7 1.7 0 001.2 1.2h.1a2 2 0 110 4h-.1a1.7 1.7 0 00-1.2 1.2z",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
  git: "M6 3v12M6 21a3 3 0 100-6 3 3 0 000 6zM6 9a3 3 0 100-6 3 3 0 000 6zM18 9a3 3 0 100-6 3 3 0 000 6zM18 6a9 9 0 01-9 9",
  folder: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  file: "M14 3v5h5M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V8z",
  chart: "M4 20V10M10 20V4M16 20v-6M22 20H2",
  "chevron-right": "M9 6l6 6-6 6",
  "chevron-down": "M6 9l6 6 6-6",
  copy: "M9 9h10v10H9zM5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1",
  check: "M5 13l4 4L19 7",
  spinner: "M12 3a9 9 0 109 9",
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
  brain:
    "M9 3a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 001 5 3 3 0 005 2 3 3 0 005-2 3 3 0 001-5 3 3 0 00-2-5 3 3 0 00-3-3 3 3 0 00-2 1 3 3 0 00-2-1z",
  tool: "M14.7 6.3a4 4 0 00-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 005.4-5.4l-2.7 2.7-2.4-.3-.3-2.4z",
  sidebar: "M4 4h16v16H4zM9 4v16",
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13M9 7V4h6v3",
  warning: "M12 9v4M12 17h.01M10.3 4.3L2.8 17a2 2 0 001.7 3h15a2 2 0 001.7-3L13.7 4.3a2 2 0 00-3.4 0z",
  bolt: "M13 3L4 14h7l-1 7 9-11h-7z",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  rewind: "M11 18l-7-6 7-6v12zM20 18l-7-6 7-6v12z",
  mic: "M12 2a3 3 0 00-3 3v6a3 3 0 006 0V5a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  robot: "M12 2v3M8 8h8a2 2 0 012 2v7a2 2 0 01-2 2H8a2 2 0 01-2-2v-7a2 2 0 012-2zM9.5 13h.01M14.5 13h.01M9 17h6",
  merge: "M6 21V3M6 9a9 9 0 009 9h3M6 3a3 3 0 100 6 3 3 0 000-6zM18 21a3 3 0 100-6 3 3 0 000 6z",
  terminal: "M4 5h16v14H4zM7 9l3 3-3 3M13 15h4",
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}

export function Icon({ name, size = 16, className, style, strokeWidth = 1.8 }: IconProps) {
  const fillIcons: IconName[] = ["stop", "sparkle"];
  const isFill = fillIcons.includes(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={isFill ? "currentColor" : "none"}
      stroke={isFill ? "none" : "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
