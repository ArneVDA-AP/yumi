/**
 * Yume Design System — typed token module for yumi (React 19 + TypeScript)
 *
 * USAGE:
 *   import { tokens, cssVar } from './tokens';
 *
 *   // reference the static value (e.g. for inline styles):
 *   style={{ color: tokens.core.accent }}           // '#b8fd80'
 *
 *   // reference the CSS variable (preferred — adapts to theme switches):
 *   style={{ color: cssVar('accent') }}             // 'var(--yume-accent)'
 *   style={{ background: cssVar('surface', 2) }}    // 'var(--yume-surface-2)'
 *
 * All token names mirror the CSS custom properties in theme.css.
 * The `as const` assertion gives you full literal-type narrowing.
 */

// ---------------------------------------------------------------------------
// Raw token values
// ---------------------------------------------------------------------------

export const tokens = {
  /** 5-color core palette — exact values from the Yume theme editor */
  core: {
    background: "#050505",
    foreground: "#f0f0f0",
    accent:     "#b8fd80",   // phosphor lime
    positive:   "#83efbb",   // mint
    negative:   "#ea637a",   // coral
  },

  /** Surface ramp — near-black stepped elevation */
  surface: {
    0: "#050505",
    1: "#0e0e0e",
    2: "#161616",
    3: "#1c1c1c",
    4: "#242424",
    5: "#2c2c2c",
    6: "#343434",
    terminal: "#000000",
  },

  text: {
    primary:   "#f0f0f0",
    secondary: "#b4b4b4",
    muted:     "#808080",
    inverse:   "#050505",   // on accent / positive fills
  },

  border: {
    subtle: "#282828",
    strong: "#343434",
    focus:  "#b8fd80",    // focus ring = accent
  },

  semantic: {
    accent:          "#b8fd80",
    positive:        "#83efbb",
    negative:        "#ea637a",
    warning:         "#e6c26a",   // derived amber
    info:            "#7aa8d6",   // derived blue
    accentContrast:  "#050505",
    selectionBg:     "rgba(184, 253, 128, 0.18)",
    selectionRow:    "#1f2a12",
    overlayScrim:    "rgba(0, 0, 0, 0.55)",
    hover:           "rgba(240, 240, 240, 0.05)",
    hoverStrong:     "rgba(240, 240, 240, 0.10)",
    scrollbarThumb:  "rgba(240, 240, 240, 0.16)",
  },

  git: {
    added:     "#83efbb",
    modified:  "#e6c26a",
    deleted:   "#ea637a",
    untracked: "#808080",
    renamed:   "#c884b8",
  },

  typography: {
    fontMono: '"Fira Code", ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace',
    fontSans: '"Fira Code", ui-monospace, "Cascadia Code", monospace',
    fontSize:   "12px",
    lineHeight: 1.2,
    scale: {
      xs:   "10px",
      sm:   "11px",
      base: "12px",
      md:   "13px",
      lg:   "15px",
      xl:   "18px",
    },
    weight: {
      regular: 400,
      medium:  500,
      bold:    700,
    },
  },

  radius: {
    xs:  "3px",    // badges · chips
    sm:  "5px",    // buttons · inputs · tabs
    md:  "7px",    // composer · popovers · cards
    lg:  "10px",   // modals
  },

  space: {
    1:  "4px",
    2:  "8px",
    3:  "12px",
    4:  "16px",
    5:  "24px",
    6:  "32px",
  },

  elevation: {
    popover: "0 6px 24px rgba(0, 0, 0, 0.6)",
    focus:   "0 0 0 1px #b8fd80, 0 0 0 4px rgba(184, 253, 128, 0.20)",
  },
} as const;

// ---------------------------------------------------------------------------
// TypeScript types
// ---------------------------------------------------------------------------

export type Tokens = typeof tokens;

export type CoreToken     = keyof Tokens["core"];
export type SurfaceLevel  = keyof Tokens["surface"];
export type TextToken     = keyof Tokens["text"];
export type BorderToken   = keyof Tokens["border"];
export type SemanticToken = keyof Tokens["semantic"];
export type GitToken      = keyof Tokens["git"];
export type RadiusToken   = keyof Tokens["radius"];
export type SpaceStep     = keyof Tokens["space"];
export type ElevationToken = keyof Tokens["elevation"];

// ---------------------------------------------------------------------------
// CSS variable helpers
// ---------------------------------------------------------------------------

/**
 * Returns a `var(--yume-<name>)` reference for use in style props.
 *
 * Examples:
 *   cssVar('accent')        => 'var(--yume-accent)'
 *   cssVar('text-primary')  => 'var(--yume-text-primary)'
 *   cssVar('surface-2')     => 'var(--yume-surface-2)'
 */
export function cssVar(name: string): string {
  return `var(--yume-${name})`;
}

/**
 * Convenience overloads for the most common token groups.
 * All return `var(--yume-<group>[-<key>])` strings.
 */
export const yume = {
  core:     (k: CoreToken)      => `var(--yume-${k})` as const,
  surface:  (n: SurfaceLevel)   => `var(--yume-surface-${String(n)})` as const,
  text:     (k: TextToken)      => `var(--yume-text-${k})` as const,
  border:   (k: BorderToken)    => `var(--yume-border-${k})` as const,
  semantic: (k: SemanticToken)  => `var(--yume-semantic-${k})` as const,
  git:      (k: GitToken)       => `var(--yume-git-${k})` as const,
  radius:   (k: RadiusToken)    => `var(--yume-radius-${k})` as const,
  space:    (n: SpaceStep)      => `var(--yume-space-${String(n)})` as const,
  elevation:(k: ElevationToken) => `var(--yume-shadow-${k})` as const,
} as const;

// ---------------------------------------------------------------------------
// Mapping: yumi runtime vars -> Yume token values
// Useful when adding "yume" to lib/themes.ts ThemeVars.
// ---------------------------------------------------------------------------

/**
 * Ready-made vars block for yumi's `applyTheme` system.
 * Add this to `themes` in src/lib/themes.ts as ThemeName "yume":
 *
 *   import { yumiThemeVars } from '../path/to/tokens';
 *   const themes = { ..., yume: { name: 'yume', label: 'Yume', dark: true, vars: yumiThemeVars } };
 */
export const yumiThemeVars: Record<string, string> = {
  "--bg":           tokens.surface[0],
  "--bg-elev":      tokens.surface[1],
  "--bg-elev-2":    tokens.surface[2],
  "--bg-hover":     tokens.semantic.hover,
  "--bg-active":    tokens.semantic.hoverStrong,
  "--surface":      tokens.surface[1],
  "--border":       tokens.border.subtle,
  "--border-strong":tokens.border.strong,
  "--text":         tokens.text.primary,
  "--text-dim":     tokens.text.secondary,
  "--text-faint":   tokens.text.muted,
  "--accent":       tokens.core.accent,
  "--accent-hover": "#d4fe9f",   // accent lightened ~10%
  "--accent-soft":  tokens.semantic.selectionBg,
  "--accent-text":  tokens.core.accent,
  "--success":      tokens.core.positive,
  "--warn":         tokens.semantic.warning,
  "--error":        tokens.core.negative,
  "--thinking":     tokens.semantic.info,
  "--thinking-soft":"rgba(122, 168, 214, 0.10)",
  "--tool":         tokens.core.positive,
  "--tool-soft":    "rgba(131, 239, 187, 0.10)",
  "--user-bubble":  tokens.surface[2],
  "--code-bg":      tokens.surface.terminal,
  "--scrollbar":    tokens.semantic.scrollbarThumb,
  "--shadow":       tokens.elevation.popover,
};
