// Device-local game preferences, shared by every mode and edited in Settings.
import { useEffect, useSyncExternalStore } from "react";

export type AutoContinueSpeed = "quick" | "normal" | "relaxed";
export type TextSize = "normal" | "large" | "larger";
export type Density = "comfortable" | "compact";
export type TimerDisplay = "always" | "calm";
export type ContinueKeys = "enter-space" | "enter";

export type Prefs = {
  /** Short vibrations on phones that support it. */
  haptics: boolean;
  /** Move on automatically after a correct answer (quiz, flags, capitals). */
  autoContinue: boolean;
  /** How long a correct answer stays on screen before auto-continue moves on. */
  autoContinueSpeed: AutoContinueSpeed;
  /** Pre-fill every setup screen with the choices from the last round. */
  rememberSetup: boolean;
  /** Show keyboard shortcut hints during play. */
  keyboardHints: boolean;
  /** Ask before giving up or deleting a running round. */
  confirmGiveUp: boolean;
  /** Ask the browser to confirm before the tab is closed or reloaded during a round. */
  confirmLeave: boolean;
  /** Short synthesized sound cues for right, wrong and finished. */
  sound: boolean;
  /** Sound volume, 0–100. */
  volume: number;
  /** Fewer animations, in addition to the system setting. */
  reduceMotion: boolean;
  /** Scales the whole interface (rem based). */
  textSize: TextSize;
  /** Stronger text and border contrast. */
  highContrast: boolean;
  /** Tighter spacing so more fits on a desktop screen. */
  density: Density;
  /** Show the focus outline after mouse clicks too, not only for keyboard focus. */
  focusAlways: boolean;
  /** "calm" hides countdowns until time is nearly up. */
  timerDisplay: TimerDisplay;
  /** Answer multiple choice questions with the number keys. */
  numberKeys: boolean;
  /** Which keys move on from answer feedback. */
  continueKeys: ContinueKeys;
};

export const defaultPrefs: Prefs = {
  haptics: true,
  autoContinue: false,
  autoContinueSpeed: "normal",
  rememberSetup: true,
  keyboardHints: true,
  confirmGiveUp: true,
  confirmLeave: true,
  sound: true,
  volume: 60,
  reduceMotion: false,
  textSize: "normal",
  highContrast: false,
  density: "comfortable",
  focusAlways: false,
  timerDisplay: "always",
  numberKeys: true,
  continueKeys: "enter-space",
};

const KEY = "atlas-prefs";
/** Legacy key from the first "Reduce motion" switch; read once when the new preference was never saved. */
const LEGACY_MOTION_KEY = "atlas-motion";

/** Default auto-continue delay (the "normal" speed). */
export const AUTO_CONTINUE_MS = 1400;
const autoContinueDelays: Record<AutoContinueSpeed, number> = { quick: 800, normal: AUTO_CONTINUE_MS, relaxed: 2400 };

export function autoContinueMs(speed: AutoContinueSpeed): number {
  return autoContinueDelays[speed] ?? AUTO_CONTINUE_MS;
}

/** In calm timer mode, round countdowns appear for the last 30 seconds, per-question timers for the last 10. */
export const CALM_ROUND_MS = 30_000;
export const CALM_QUESTION_MS = 10_000;

export function showCountdown(prefs: Pick<Prefs, "timerDisplay">, msLeft: number, calmFromMs = CALM_ROUND_MS) {
  return prefs.timerDisplay === "always" || msLeft <= calmFromMs;
}

let cache: Prefs | null = null;
const listeners = new Set<() => void>();

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Turns whatever was stored (older versions, hand edits, garbage) into a complete, valid Prefs object.
 * Unknown keys are dropped and every field falls back to its default when the stored value has the wrong type.
 */
export function normalizePrefs(stored: unknown, legacyMotion: string | null = null): Prefs {
  const raw = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const flag = (key: keyof Prefs, fallback: boolean) => (typeof raw[key] === "boolean" ? (raw[key] as boolean) : fallback);
  const volume = typeof raw.volume === "number" && Number.isFinite(raw.volume) ? raw.volume : defaultPrefs.volume;
  return {
    haptics: flag("haptics", defaultPrefs.haptics),
    autoContinue: flag("autoContinue", defaultPrefs.autoContinue),
    autoContinueSpeed: pick(raw.autoContinueSpeed, ["quick", "normal", "relaxed"], defaultPrefs.autoContinueSpeed),
    rememberSetup: flag("rememberSetup", defaultPrefs.rememberSetup),
    keyboardHints: flag("keyboardHints", defaultPrefs.keyboardHints),
    confirmGiveUp: flag("confirmGiveUp", defaultPrefs.confirmGiveUp),
    confirmLeave: flag("confirmLeave", defaultPrefs.confirmLeave),
    sound: flag("sound", defaultPrefs.sound),
    volume: Math.round(Math.min(100, Math.max(0, volume))),
    reduceMotion: flag("reduceMotion", legacyMotion === "reduce"),
    textSize: pick(raw.textSize, ["normal", "large", "larger"], defaultPrefs.textSize),
    highContrast: flag("highContrast", defaultPrefs.highContrast),
    density: pick(raw.density, ["comfortable", "compact"], defaultPrefs.density),
    focusAlways: flag("focusAlways", defaultPrefs.focusAlways),
    timerDisplay: pick(raw.timerDisplay, ["always", "calm"], defaultPrefs.timerDisplay),
    numberKeys: flag("numberKeys", defaultPrefs.numberKeys),
    continueKeys: pick(raw.continueKeys, ["enter-space", "enter"], defaultPrefs.continueKeys),
  };
}

function read(): Prefs {
  if (cache) return cache;
  let stored: unknown = {};
  let legacyMotion: string | null = null;
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    legacyMotion = localStorage.getItem(LEGACY_MOTION_KEY);
  } catch {
    stored = {};
  }
  cache = normalizePrefs(stored, legacyMotion);
  return cache;
}

/** Forget the in-memory copy so the next read comes from storage (other tabs, tests). */
export function reloadPrefs() {
  cache = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      cache = null;
      applyDocumentPrefs(read());
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getPrefs(): Prefs {
  return read();
}

function store(next: Prefs) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    // The new preference replaces the legacy motion key.
    localStorage.removeItem(LEGACY_MOTION_KEY);
  } catch {
    /* storage can be unavailable (private mode); keep the in-memory value */
  }
  applyDocumentPrefs(next);
  listeners.forEach((listener) => listener());
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  store(normalizePrefs({ ...read(), [key]: value }));
}

/** Restore every game preference to its default. Theme and saved setups are not touched. */
export function resetPrefs() {
  store({ ...defaultPrefs });
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, read, () => defaultPrefs);
}

/** Reflect display preferences as data attributes on <html>; the CSS in prefs.css does the rest. */
export function applyDocumentPrefs(prefs: Prefs = read(), root?: HTMLElement) {
  const element = root ?? (typeof document !== "undefined" ? document.documentElement : undefined);
  if (!element) return;
  element.dataset.motion = prefs.reduceMotion ? "reduce" : "system";
  element.dataset.textSize = prefs.textSize;
  element.dataset.contrast = prefs.highContrast ? "more" : "normal";
  element.dataset.density = prefs.density;
  element.dataset.focus = prefs.focusAlways ? "always" : "keyboard";
}

/** True when the player or the operating system asked for less motion. */
export function prefersReducedMotion(): boolean {
  if (read().reduceMotion) return true;
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/**
 * While `active` (a round is running) and the player kept "Warn before closing" on, the browser asks
 * for confirmation before the tab is closed or reloaded. In-app navigation is not blocked: rounds are saved.
 */
export function useLeaveGuard(active: boolean) {
  const { confirmLeave } = usePrefs();
  useEffect(() => {
    if (!active || !confirmLeave) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active, confirmLeave]);
}

export type HapticKind = "tap" | "correct" | "wrong" | "complete";

export const hapticPatterns = { tap: 8, correct: 18, wrong: [30, 40, 30], complete: [20, 60, 20, 60, 40] } as const;

let iosSwitch: HTMLLabelElement | null = null;

/**
 * iOS Safari has no Vibration API. Since iOS 18, toggling a native switch control gives a
 * light haptic tick, which only works while handling a tap or keystroke. Best effort only.
 */
function iosTick() {
  if (typeof document === "undefined") return;
  if (!iosSwitch) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.id = "atlas-haptic-switch";
    input.tabIndex = -1;
    input.setAttribute("aria-hidden", "true");
    iosSwitch = document.createElement("label");
    iosSwitch.htmlFor = input.id;
    iosSwitch.setAttribute("aria-hidden", "true");
    iosSwitch.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;left:-10px;top:0";
    iosSwitch.appendChild(input);
    document.body.appendChild(iosSwitch);
  }
  iosSwitch.click();
}

/** True when this device can give haptic feedback at all (Vibration API, or the iOS switch trick). */
export function canVibrate(): boolean {
  return (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") || isIOS;
}

/** True on touch-first devices (phones, tablets); haptics settings are only prominent there. */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) return true;
  return typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
}

export const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (typeof navigator !== "undefined" && navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function haptic(kind: HapticKind) {
  if (!read().haptics || typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") {
    if (isIOS) iosTick();
    return;
  }
  try {
    navigator.vibrate(hapticPatterns[kind] as number | number[]);
  } catch {
    /* some browsers throw when vibration is blocked */
  }
}

/** Last setup choices for a mode, or {} when remembering is off. Callers must validate each field. */
export function loadSetup(mode: string): Record<string, unknown> {
  if (!read().rememberSetup) return {};
  try {
    const value = JSON.parse(localStorage.getItem(`atlas-setup-${mode}`) ?? "{}");
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function saveSetup(mode: string, value: Record<string, unknown>) {
  if (!read().rememberSetup) return;
  try {
    localStorage.setItem(`atlas-setup-${mode}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function clearSavedSetups() {
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith("atlas-setup-"))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
    /* ignore */
  }
}

/** Pick `value` when it is one of `allowed`, else `fallback`. */
export function oneOf<T extends string | number | null>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
