// ============================================================================
// Settings overlay — model, theme swatches, toggles, auto-compact threshold,
// and a keyboard-shortcut reference. Reads/writes the global store directly.
// ============================================================================
import type { ReactNode } from "react";
import { useStore } from "../../lib/store";
import { THEME_LIST } from "../../lib/themes";
import { SHORTCUT_HINTS } from "../../lib/shortcuts";
import { PROVIDERS, type ProviderId } from "../../lib/types";
import Overlay from "./Overlay";

interface ToggleProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function Toggle({ label, hint, checked, onChange }: ToggleProps): ReactNode {
  return (
    <label className="settings__toggle">
      <span className="settings__toggle-text">
        <span className="settings__toggle-label">{label}</span>
        {hint && <span className="settings__toggle-hint">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`switch${checked ? " is-on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch__thumb" />
      </button>
    </label>
  );
}

export default function SettingsOverlay() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const setOverlay = useStore((s) => s.setOverlay);

  const pct = Math.round(settings.autoCompactThreshold * 100);
  const provider = PROVIDERS.find((p) => p.id === settings.provider) ?? PROVIDERS[0];

  const onProviderChange = (id: ProviderId) => {
    const next = PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
    // Switch provider and snap the model to that provider's default.
    void updateSettings({ provider: id, model: next.models[0]?.value ?? settings.model });
  };

  return (
    <Overlay title="Settings" onClose={() => setOverlay(null)}>
      <div className="settings">
        <section className="settings__section">
          <h3 className="settings__heading">Provider</h3>
          <select
            className="settings__select"
            value={settings.provider}
            onChange={(e) => onProviderChange(e.target.value as ProviderId)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {provider.id !== "claude" && (
            <p className="settings__note">
              Requires the <code>{provider.id}</code> CLI on PATH. Claude is the verified path;
              other providers are best-effort.
            </p>
          )}
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">Model</h3>
          <select
            className="settings__select"
            value={settings.model}
            onChange={(e) => void updateSettings({ model: e.target.value })}
          >
            {provider.models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">Theme</h3>
          <div className="settings__themes">
            {THEME_LIST.map((t) => (
              <button
                key={t.name}
                type="button"
                className={`theme-swatch${settings.theme === t.name ? " is-active" : ""}`}
                onClick={() => void updateSettings({ theme: t.name })}
              >
                <span className="theme-swatch__dots">
                  <span className="theme-swatch__dot" style={{ background: t.vars["--bg"] }} />
                  <span className="theme-swatch__dot" style={{ background: t.vars["--accent"] }} />
                  <span className="theme-swatch__dot" style={{ background: t.vars["--text"] }} />
                </span>
                <span className="theme-swatch__label">{t.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">Behavior</h3>
          <Toggle
            label="Vim mode"
            hint="Modal editing in the prompt input"
            checked={settings.vimMode}
            onChange={(v) => void updateSettings({ vimMode: v })}
          />
          <Toggle
            label="Interleaved thinking"
            hint="Show the model's reasoning between turns"
            checked={settings.thinking}
            onChange={(v) => void updateSettings({ thinking: v })}
          />
          <Toggle
            label="Show rate limit"
            hint="Display usage limits in the status bar"
            checked={settings.showRateLimit}
            onChange={(v) => void updateSettings({ showRateLimit: v })}
          />
          <Toggle
            label="Live bash monitor"
            hint="Route bash through the MCP server to stream output live in tool cards"
            checked={settings.bashMonitor}
            onChange={(v) => void updateSettings({ bashMonitor: v })}
          />
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">
            Auto-compact threshold<span className="settings__value">{pct}%</span>
          </h3>
          <input
            type="range"
            className="settings__range"
            min={0.5}
            max={0.95}
            step={0.05}
            value={settings.autoCompactThreshold}
            onChange={(e) => void updateSettings({ autoCompactThreshold: Number(e.target.value) })}
          />
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">Keyboard shortcuts</h3>
          <ul className="settings__shortcuts">
            {SHORTCUT_HINTS.map((s) => (
              <li key={s.label} className="settings__shortcut">
                <span className="settings__shortcut-label">{s.label}</span>
                <kbd className="settings__kbd">{s.keys}</kbd>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Overlay>
  );
}
