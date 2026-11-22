import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { analyticsEnabled, readEvents, setAnalytics } from "./analytics";
import { api, isDemo } from "./api";
import { download } from "./components";
import { Prefs, clearSavedSetups, haptic, isIOS, setPref, usePrefs } from "./prefs";

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
            ["system", "System", "◐"],
            ["light", "Light", "☼"],
            ["dark", "Dark", "◑"],
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
            <span aria-hidden="true">{icon}</span>
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
  onChange,
}: {
  id: keyof Prefs | string;
  title: string;
  text: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <div>
        <label htmlFor={`setting-${id}`} className="font-bold">
          {title}
        </label>
        <p className="muted text-sm">{text}</p>
      </div>
      <button
        id={`setting-${id}`}
        type="button"
        role="switch"
        aria-checked={checked}
        className="switch"
        onClick={() => onChange(!checked)}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}

export function Settings() {
  const navigate = useNavigate();
  const prefs = usePrefs();
  const [isAnonymous, setIsAnonymous] = useState<boolean | null>(null);
  const [consent, setConsent] = useState(analyticsEnabled());
  const [motion, setMotion] = useState(localStorage.getItem("atlas-motion") === "reduce");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const canVibrate = (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") || isIOS;
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
  return (
    <div className="settings-shell">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Settings</p>
          <h1 tabIndex={-1} className="heading mt-2">
            Play your way.
          </h1>
        </div>
        <p className="muted">Saved on this device.</p>
      </div>

      <section className="card mt-6">
        <h2 className="text-xl font-bold">Gameplay</h2>
        <div className="setting-list">
          <SettingToggle
            id="autoContinue"
            title="Continue automatically after a correct answer"
            text="In Quiz, Flags and Capitals, the next question follows after a short pause. Wrong answers always wait so you can read the solution."
            checked={prefs.autoContinue}
            onChange={(value) => setPref("autoContinue", value)}
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
            id="keyboardHints"
            title="Show keyboard shortcuts"
            text="Hints like 1–4 to answer and Enter to continue."
            checked={prefs.keyboardHints}
            onChange={(value) => setPref("keyboardHints", value)}
          />
          <SettingToggle
            id="haptics"
            title="Vibration"
            text={
              isIOS
                ? "On iPhone you feel a light tick when an answer is accepted while you type (iOS 18 or newer)."
                : canVibrate
                  ? "A short buzz for right and wrong answers."
                  : "This browser doesn't support vibration."
            }
            checked={prefs.haptics && canVibrate}
            onChange={(value) => {
              setPref("haptics", value);
              if (value) haptic("tap");
            }}
          />
        </div>
      </section>

      <section className="card mt-5">
        <h2 className="text-xl font-bold">Appearance</h2>
        <div className="setting-list">
          <ThemeControl />
          <SettingToggle
            id="motion"
            title="Reduce motion"
            text="Fewer animations, in addition to your system setting."
            checked={motion}
            onChange={(value) => {
              setMotion(value);
              localStorage.setItem("atlas-motion", value ? "reduce" : "system");
              document.documentElement.dataset.motion = value ? "reduce" : "system";
            }}
          />
        </div>
      </section>

      <section className="card mt-5">
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

      <details className="card mt-5 settings-about">
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
  );
}
