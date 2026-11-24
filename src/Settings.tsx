import { KeyboardEvent, ReactNode, useEffect, useId, useState } from "react";
import { Icon } from "./icons";
import { useNavigate } from "react-router-dom";
import { analyticsEnabled, readEvents, setAnalytics } from "./analytics";
import { api, isDemo } from "./api";
import { download } from "./components";
import {
  Prefs,
  canVibrate,
  clearSavedSetups,
  defaultPrefs,
  haptic,
  isIOS,
  isTouchDevice,
  resetPrefs,
  setPref,
  usePrefs,
} from "./prefs";
import { ShortcutList } from "./shortcuts";
import { playSound } from "./sound";

export function applyTheme(theme: string) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  const prefersLight =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches;
  if (meta)
    meta.setAttribute("content", theme === "light" || (theme === "system" && prefersLight) ? "#f5f8ff" : "#0B1020");
}

export function ThemeControl() {
  const [theme, setTheme] = useState(localStorage.getItem("atlas-theme") ?? "system");
  const choose = (value: string) => {
    setTheme(value);
    if (value === "system") localStorage.removeItem("atlas-theme");
    else localStorage.setItem("atlas-theme", value);
    applyTheme(value);
  };
  return (
    <div className="theme-control">
      <div>
        <strong>Color theme</strong>
        <p className="muted text-sm">Choose a theme for this device.</p>
      </div>
      <div className="theme-choice-list" role="radiogroup" aria-label="Color theme">
        {(
          [
            ["system", "System", "monitor"],
            ["light", "Light", "sun"],
            ["dark", "Dark", "moon"],
          ] as const
        ).map(([value, label, icon]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            className={`theme-choice ${theme === value ? "is-selected" : ""}`}
            onClick={() => choose(value)}
          >
            <Icon name={icon} size={17} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
function SettingToggle({
  id,
  title,
  text,
  checked,
  disabled,
  onChange,
}: {
  id: keyof Prefs | string;
  title: string;
  text: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className={`setting-row ${disabled ? "is-disabled" : ""}`}>
      <div>
        <label htmlFor={`setting-${id}`} className="font-bold">
          {title}
        </label>
        <p id={`setting-${id}-text`} className="muted text-sm">
          {text}
        </p>
      </div>
      <button
        id={`setting-${id}`}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={`setting-${id}-text`}
        disabled={disabled}
        className="switch"
        onClick={() => onChange(!checked)}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}

/** A small single-choice control (radio group) with arrow-key navigation. */
function SettingChoice<T extends string>({
  title,
  text,
  value,
  options,
  disabled,
  onChange,
}: {
  title: string;
  text?: ReactNode;
  value: T;
  options: readonly (readonly [T, string])[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const id = useId();
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = options.findIndex(([option]) => option === value);
    const next = options[(index + step + options.length) % options.length][0];
    onChange(next);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
    buttons[(index + step + options.length) % options.length]?.focus();
  }
  return (
    <div className={`setting-row ${disabled ? "is-disabled" : ""}`}>
      <div>
        <p id={`${id}-title`} className="font-bold text-sm">
          {title}
        </p>
        {text && (
          <p id={`${id}-text`} className="muted text-sm">
            {text}
          </p>
        )}
      </div>
      <div
        className="segmented"
        role="radiogroup"
        aria-labelledby={`${id}-title`}
        aria-describedby={text ? `${id}-text` : undefined}
        onKeyDown={onKeyDown}
      >
        {options.map(([option, label]) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            tabIndex={value === option ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingsSection({
  title,
  text,
  wide,
  children,
}: {
  title: string;
  text?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={`card ${wide ? "is-wide" : ""}`} aria-labelledby={id}>
      <div className="settings-section-head">
        <div>
          <h2 id={id} className="text-xl font-bold">
            {title}
          </h2>
          {text && <p className="muted text-sm">{text}</p>}
        </div>
      </div>
      <div className="setting-list">{children}</div>
    </section>
  );
}

function systemReducesMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function Settings() {
  const navigate = useNavigate();
  const prefs = usePrefs();
  const [isAnonymous, setIsAnonymous] = useState<boolean | null>(null);
  const [consent, setConsent] = useState(analyticsEnabled());
  const [message, setMessage] = useState("");
  const [prefsMessage, setPrefsMessage] = useState("");
  const [pending, setPending] = useState(false);
  // Vibration is a phone feature: on a desktop PC the setting is hidden (the stored value is kept).
  const showHaptics = isIOS || (canVibrate() && isTouchDevice());
  useEffect(() => {
    api
      .currentUser()
      .then((user) => setIsAnonymous(user.isAnonymous))
      .catch(() => setIsAnonymous(null));
  }, []);
  async function run(task: () => Promise<unknown>) {
    setPending(true);
    setMessage("");
    try {
      await task();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  const isDefault = (Object.keys(defaultPrefs) as (keyof Prefs)[]).every((key) => prefs[key] === defaultPrefs[key]);
  return (
    <div className="settings-shell">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Settings</p>
          <h1 tabIndex={-1} className="heading mt-2">
            Play your way.
          </h1>
        </div>
        <p className="muted">
          Saved on this device. Press <kbd className="keycap-inline">?</kbd> anywhere for shortcuts.
        </p>
      </div>

      <div className="settings-grid">
        <SettingsSection title="Gameplay" text="How rounds flow from one question to the next.">
          <SettingToggle
            id="autoContinue"
            title="Continue automatically after a correct answer"
            text="In Quiz, Flags and Capitals, the next question follows after a short pause. Wrong answers always wait so you can read the solution."
            checked={prefs.autoContinue}
            onChange={(value) => setPref("autoContinue", value)}
          />
          <SettingChoice
            title="Auto-continue pause"
            text="How long a correct answer stays on screen."
            value={prefs.autoContinueSpeed}
            disabled={!prefs.autoContinue}
            options={[
              ["quick", "Quick"],
              ["normal", "Normal"],
              ["relaxed", "Relaxed"],
            ]}
            onChange={(value) => setPref("autoContinueSpeed", value)}
          />
          <SettingChoice
            title="Countdown"
            text="Calm hides the clock in timed rounds until the last 30 seconds (last 10 seconds of a quiz question)."
            value={prefs.timerDisplay}
            options={[
              ["always", "Always show"],
              ["calm", "Calm"],
            ]}
            onChange={(value) => setPref("timerDisplay", value)}
          />
          <SettingToggle
            id="rememberSetup"
            title="Remember my last setup"
            text="Each game opens with the choices you used last time."
            checked={prefs.rememberSetup}
            onChange={(value) => {
              setPref("rememberSetup", value);
              if (!value) clearSavedSetups();
            }}
          />
          <SettingToggle
            id="confirmGiveUp"
            title="Ask before giving up or discarding"
            text="A quick confirmation before a round is ended or thrown away."
            checked={prefs.confirmGiveUp}
            onChange={(value) => setPref("confirmGiveUp", value)}
          />
          <SettingToggle
            id="confirmLeave"
            title="Warn before closing the tab"
            text="During a round, the browser asks before the tab is closed or reloaded. Your round is saved either way; timed rounds keep running."
            checked={prefs.confirmLeave}
            onChange={(value) => setPref("confirmLeave", value)}
          />
        </SettingsSection>

        <SettingsSection title="Audio" text="Short sound cues made in the browser – no downloads.">
          <SettingToggle
            id="sound"
            title="Sound effects"
            text="A chime for right answers, a low tone for wrong ones and a fanfare when a round ends."
            checked={prefs.sound}
            onChange={(value) => {
              setPref("sound", value);
              if (value) playSound("correct");
            }}
          />
          <div className={`setting-row is-stacked ${prefs.sound ? "" : "is-disabled"}`}>
            <label htmlFor="setting-volume" className="font-bold">
              Volume
            </label>
            <div className="volume-row">
              <input
                id="setting-volume"
                type="range"
                min={0}
                max={100}
                step={5}
                value={prefs.volume}
                disabled={!prefs.sound}
                aria-valuetext={`${prefs.volume} percent`}
                onChange={(event) => setPref("volume", Number(event.target.value))}
                onPointerUp={() => playSound("correct")}
                onKeyUp={(event) => {
                  if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") playSound("correct");
                }}
              />
              <output htmlFor="setting-volume">{prefs.volume}%</output>
            </div>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["correct", "Right"],
                  ["wrong", "Wrong"],
                  ["complete", "Round done"],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  className="secondary"
                  disabled={!prefs.sound}
                  onClick={() => playSound(kind)}
                >
                  Play “{label}”
                </button>
              ))}
            </div>
          </div>
          {showHaptics && (
            <SettingToggle
              id="haptics"
              title="Vibration"
              text={
                isIOS
                  ? "On iPhone you feel a light tick when an answer is accepted while you type (iOS 18 or newer)."
                  : "A short buzz for right and wrong answers."
              }
              checked={prefs.haptics}
              onChange={(value) => {
                setPref("haptics", value);
                if (value) haptic("tap");
              }}
            />
          )}
        </SettingsSection>

        <SettingsSection title="Display & accessibility" text="Applies to every page on this device.">
          <ThemeControl />
          <SettingChoice
            title="Text size"
            text="Scales text and controls across the app."
            value={prefs.textSize}
            options={[
              ["normal", "Default"],
              ["large", "Large"],
              ["larger", "Larger"],
            ]}
            onChange={(value) => setPref("textSize", value)}
          />
          <SettingChoice
            title="Density"
            text="Compact fits more on a desktop screen."
            value={prefs.density}
            options={[
              ["comfortable", "Comfortable"],
              ["compact", "Compact"],
            ]}
            onChange={(value) => setPref("density", value)}
          />
          <SettingToggle
            id="highContrast"
            title="High contrast"
            text="Stronger text, borders and focus outlines in light and dark mode."
            checked={prefs.highContrast}
            onChange={(value) => setPref("highContrast", value)}
          />
          <SettingToggle
            id="reduceMotion"
            title="Reduce motion"
            text={
              systemReducesMotion()
                ? "Your system already asks for less motion, so animations are reduced either way."
                : "Fewer animations, in addition to your system setting."
            }
            checked={prefs.reduceMotion}
            onChange={(value) => setPref("reduceMotion", value)}
          />
          <SettingToggle
            id="focusAlways"
            title="Always show the focus outline"
            text="Also after mouse clicks, so you always see which control is active."
            checked={prefs.focusAlways}
            onChange={(value) => setPref("focusAlways", value)}
          />
        </SettingsSection>

        <SettingsSection title="Keyboard" text="Play without touching the mouse.">
          <SettingToggle
            id="numberKeys"
            title="Answer with number keys"
            text={
              <>
                In Quiz, <kbd>1</kbd>–<kbd>4</kbd> pick an answer right away. Turn off to avoid accidental answers.
              </>
            }
            checked={prefs.numberKeys}
            onChange={(value) => setPref("numberKeys", value)}
          />
          <SettingChoice
            title="Next question with"
            text="Which keys move on after a Quiz answer."
            value={prefs.continueKeys}
            options={[
              ["enter-space", "Enter or Space"],
              ["enter", "Enter only"],
            ]}
            onChange={(value) => setPref("continueKeys", value)}
          />
          <SettingToggle
            id="keyboardHints"
            title="Show keyboard hints while playing"
            text="Small reminders like 1–4 to answer and Enter to continue."
            checked={prefs.keyboardHints}
            onChange={(value) => setPref("keyboardHints", value)}
          />
        </SettingsSection>

        <section className="card is-wide" aria-labelledby="settings-shortcuts-title">
          <h2 id="settings-shortcuts-title" className="text-xl font-bold">
            Keyboard shortcuts
          </h2>
          <p className="muted text-sm mb-4">
            Press <kbd className="keycap-inline">?</kbd> during play to see this list.
          </p>
          <ShortcutList />
        </section>

        <section className="card is-wide" aria-labelledby="settings-reset-title">
          <div className="settings-reset">
            <div>
              <h2 id="settings-reset-title" className="text-xl font-bold">
                Reset
              </h2>
              <p className="muted text-sm">
                Restore gameplay, audio, display and keyboard settings to their defaults. Your color theme, progress and
                account are not changed.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  clearSavedSetups();
                  setPrefsMessage("Saved game setups were forgotten.");
                }}
              >
                Forget saved setups
              </button>
              <button
                type="button"
                className="secondary"
                disabled={isDefault}
                onClick={() => {
                  resetPrefs();
                  setPrefsMessage("Settings were reset to their defaults.");
                }}
              >
                Reset to defaults
              </button>
            </div>
          </div>
          <p role="status" className="muted text-sm mt-2">
            {prefsMessage}
          </p>
        </section>
        <section className="card is-wide">
          <h2 className="text-xl font-bold">Account & data</h2>
          <p className="muted mt-2">
            {isDemo
              ? "This is the local demo: everything stays in this browser."
              : isAnonymous
                ? "You're playing as a guest. Create an account from the player menu so you don't lose your progress."
                : "Your progress is saved to your account."}
          </p>
          <div className="flex flex-wrap gap-3 mt-4">
            <button
              className="secondary"
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  download("atlas-data.json", await api.exportData());
                })
              }
            >
              Download my data
            </button>
            {isAnonymous === false && (
              <button
                className="secondary"
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    await api.signOut();
                    setAnalytics(false);
                    navigate("/", { replace: true });
                  })
                }
              >
                Sign out
              </button>
            )}
            <button
              className="danger-button"
              disabled={pending}
              onClick={() => {
                if (prompt("Type DELETE to permanently delete this account and its progress.") !== "DELETE") return;
                void run(async () => {
                  await api.deleteAccount();
                  setAnalytics(false);
                  navigate("/", { replace: true });
                });
              }}
            >
              Delete {isDemo ? "demo data" : "account"}
            </button>
          </div>
          <p role="status" className="mt-2">
            {message}
          </p>
        </section>

        <details className="card is-wide settings-about">
          <summary className="text-xl font-bold">About, offline use & diagnostics</summary>
          <div className="mt-4 space-y-4">
            <p className="muted">
              Install Atlas Arena from your browser's menu, or on iPhone/iPad via Safari's Share → Add to Home Screen.
              After the first visit the app opens offline; games, sign-in and saving need a connection.
            </p>
            <SettingToggle
              id="diagnostics"
              title="Local diagnostic log"
              text="Keeps the last 100 app events on this device only, to help with bug reports. Nothing is sent anywhere."
              checked={consent}
              onChange={(value) => {
                setConsent(value);
                setAnalytics(value);
              }}
            />
            <button className="secondary" onClick={() => download("atlas-diagnostics.json", readEvents())}>
              Download diagnostic log
            </button>
            <p className="muted text-sm">
              Before running Atlas Arena as a public service it still needs a privacy notice, operator contact details, a
              retention policy and a legal review.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}
