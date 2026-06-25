// ============================================================================
// Theme definitions — each theme is a flat map of CSS custom properties applied
// to :root. OLED is the default: pure-black background, high contrast, subtle
// borders. Designed to be a genuinely pleasant daily-driver dark UI.
// ============================================================================

export type ThemeName = "oled" | "dark" | "dim" | "light" | "nord" | "rose";

export interface ThemeVars {
  [cssVar: string]: string;
}

export interface ThemeDef {
  name: ThemeName;
  label: string;
  dark: boolean;
  vars: ThemeVars;
}

// Shared accent ramp tokens are derived per-theme; common radii/typography live
// in styles.css. Themes only override color surfaces.
const themes: Record<ThemeName, ThemeDef> = {
  oled: {
    name: "oled",
    label: "OLED",
    dark: true,
    vars: {
      "--bg": "#000000",
      "--bg-elev": "#0a0a0b",
      "--bg-elev-2": "#121214",
      "--bg-hover": "#1a1a1d",
      "--bg-active": "#202024",
      "--surface": "#0a0a0b",
      "--border": "#1c1c20",
      "--border-strong": "#2a2a30",
      "--text": "#f4f4f6",
      "--text-dim": "#a0a0aa",
      "--text-faint": "#6a6a74",
      "--accent": "#7c8cff",
      "--accent-hover": "#929fff",
      "--accent-soft": "rgba(124,140,255,0.14)",
      "--accent-text": "#aeb6ff",
      "--success": "#3fd17e",
      "--warn": "#ffbf57",
      "--error": "#ff5c6c",
      "--thinking": "#b98bff",
      "--thinking-soft": "rgba(185,139,255,0.10)",
      "--tool": "#57c7ff",
      "--tool-soft": "rgba(87,199,255,0.10)",
      "--user-bubble": "#141417",
      "--code-bg": "#0d0d10",
      "--scrollbar": "#26262c",
      "--shadow": "0 8px 30px rgba(0,0,0,0.6)",
    },
  },
  dark: {
    name: "dark",
    label: "Dark",
    dark: true,
    vars: {
      "--bg": "#111114",
      "--bg-elev": "#17171c",
      "--bg-elev-2": "#1d1d23",
      "--bg-hover": "#24242b",
      "--bg-active": "#2c2c34",
      "--surface": "#17171c",
      "--border": "#27272f",
      "--border-strong": "#35353f",
      "--text": "#ececf1",
      "--text-dim": "#a6a6b2",
      "--text-faint": "#70707c",
      "--accent": "#7c8cff",
      "--accent-hover": "#929fff",
      "--accent-soft": "rgba(124,140,255,0.16)",
      "--accent-text": "#b3bbff",
      "--success": "#46d885",
      "--warn": "#ffc463",
      "--error": "#ff6472",
      "--thinking": "#c098ff",
      "--thinking-soft": "rgba(192,152,255,0.12)",
      "--tool": "#62caff",
      "--tool-soft": "rgba(98,202,255,0.12)",
      "--user-bubble": "#1f1f26",
      "--code-bg": "#131318",
      "--scrollbar": "#33333c",
      "--shadow": "0 8px 30px rgba(0,0,0,0.55)",
    },
  },
  dim: {
    name: "dim",
    label: "Dim",
    dark: true,
    vars: {
      "--bg": "#1b1d23",
      "--bg-elev": "#22252d",
      "--bg-elev-2": "#292d36",
      "--bg-hover": "#313641",
      "--bg-active": "#39404d",
      "--surface": "#22252d",
      "--border": "#333845",
      "--border-strong": "#434a59",
      "--text": "#e3e6ee",
      "--text-dim": "#9ba1b0",
      "--text-faint": "#6c7283",
      "--accent": "#8bb9ff",
      "--accent-hover": "#9fc4ff",
      "--accent-soft": "rgba(139,185,255,0.16)",
      "--accent-text": "#b8d4ff",
      "--success": "#54d68f",
      "--warn": "#ffce72",
      "--error": "#ff7280",
      "--thinking": "#c7a4ff",
      "--thinking-soft": "rgba(199,164,255,0.12)",
      "--tool": "#6fd0ff",
      "--tool-soft": "rgba(111,208,255,0.12)",
      "--user-bubble": "#2b2f39",
      "--code-bg": "#1d2027",
      "--scrollbar": "#3d4250",
      "--shadow": "0 8px 30px rgba(0,0,0,0.45)",
    },
  },
  light: {
    name: "light",
    label: "Light",
    dark: false,
    vars: {
      "--bg": "#fbfbfd",
      "--bg-elev": "#ffffff",
      "--bg-elev-2": "#f4f4f7",
      "--bg-hover": "#eeeef3",
      "--bg-active": "#e4e4ec",
      "--surface": "#ffffff",
      "--border": "#e2e2ea",
      "--border-strong": "#d0d0db",
      "--text": "#1a1a22",
      "--text-dim": "#5e5e6c",
      "--text-faint": "#9090a0",
      "--accent": "#5663e6",
      "--accent-hover": "#4753d6",
      "--accent-soft": "rgba(86,99,230,0.10)",
      "--accent-text": "#4a56cc",
      "--success": "#1fa564",
      "--warn": "#c98a16",
      "--error": "#d63a48",
      "--thinking": "#8a5cd6",
      "--thinking-soft": "rgba(138,92,214,0.08)",
      "--tool": "#1d8fc4",
      "--tool-soft": "rgba(29,143,196,0.08)",
      "--user-bubble": "#eef0f8",
      "--code-bg": "#f4f4f8",
      "--scrollbar": "#cfcfda",
      "--shadow": "0 8px 28px rgba(20,20,40,0.12)",
    },
  },
  nord: {
    name: "nord",
    label: "Nord",
    dark: true,
    vars: {
      "--bg": "#2e3440",
      "--bg-elev": "#343b49",
      "--bg-elev-2": "#3b4252",
      "--bg-hover": "#434c5e",
      "--bg-active": "#4c566a",
      "--surface": "#343b49",
      "--border": "#3f475a",
      "--border-strong": "#4c566a",
      "--text": "#eceff4",
      "--text-dim": "#abb4c4",
      "--text-faint": "#7b859b",
      "--accent": "#88c0d0",
      "--accent-hover": "#9fd0de",
      "--accent-soft": "rgba(136,192,208,0.16)",
      "--accent-text": "#a6d4e2",
      "--success": "#a3be8c",
      "--warn": "#ebcb8b",
      "--error": "#bf616a",
      "--thinking": "#b48ead",
      "--thinking-soft": "rgba(180,142,173,0.14)",
      "--tool": "#81a1c1",
      "--tool-soft": "rgba(129,161,193,0.14)",
      "--user-bubble": "#3b4252",
      "--code-bg": "#2b313c",
      "--scrollbar": "#4c566a",
      "--shadow": "0 8px 30px rgba(0,0,0,0.4)",
    },
  },
  rose: {
    name: "rose",
    label: "Rosé",
    dark: true,
    vars: {
      "--bg": "#191724",
      "--bg-elev": "#1f1d2e",
      "--bg-elev-2": "#26233a",
      "--bg-hover": "#2c293f",
      "--bg-active": "#34304b",
      "--surface": "#1f1d2e",
      "--border": "#2e2b40",
      "--border-strong": "#403c56",
      "--text": "#e0def4",
      "--text-dim": "#b3afc9",
      "--text-faint": "#7d7a96",
      "--accent": "#ebbcba",
      "--accent-hover": "#f2cbc9",
      "--accent-soft": "rgba(235,188,186,0.14)",
      "--accent-text": "#f0c6c4",
      "--success": "#9ccfd8",
      "--warn": "#f6c177",
      "--error": "#eb6f92",
      "--thinking": "#c4a7e7",
      "--thinking-soft": "rgba(196,167,231,0.13)",
      "--tool": "#9ccfd8",
      "--tool-soft": "rgba(156,207,216,0.13)",
      "--user-bubble": "#26233a",
      "--code-bg": "#1c1a2b",
      "--scrollbar": "#403c56",
      "--shadow": "0 8px 30px rgba(0,0,0,0.45)",
    },
  },
};

export const THEME_LIST: ThemeDef[] = Object.values(themes);

export function isThemeName(v: string): v is ThemeName {
  return v in themes;
}

export function getTheme(name: string): ThemeDef {
  return isThemeName(name) ? themes[name] : themes.oled;
}

/** Apply a theme's CSS variables to the document root. */
export function applyTheme(name: string): void {
  const theme = getTheme(name);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.vars)) {
    root.style.setProperty(k, v);
  }
  root.dataset.theme = theme.name;
  root.style.colorScheme = theme.dark ? "dark" : "light";
}
