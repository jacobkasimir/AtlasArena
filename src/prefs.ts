// Device-local game preferences, shared by every mode and edited in Settings.
import { useSyncExternalStore } from "react";

export type Prefs = {
  /** Short vibrations on phones that support it. */
  haptics: boolean;
  /** Move on automatically after a correct answer (quiz, flags, capitals). */
  autoContinue: boolean;
  /** Pre-fill every setup screen with the choices from the last round. */
  rememberSetup: boolean;
  /** Show keyboard shortcut hints during play. */
  keyboardHints: boolean;
  /** Ask before giving up or deleting a running round. */
  confirmGiveUp: boolean;
};

export const defaultPrefs: Prefs = {
  haptics: true,
  autoContinue: false,
  rememberSetup: true,
  keyboardHints: true,
  confirmGiveUp: true,
};

const KEY = "atlas-prefs";
export const AUTO_CONTINUE_MS = 1400;
let cache: Prefs | null = null;
const listeners = new Set<() => void>();

function read(): Prefs {
  if (cache) return cache;
  try {
    cache = { ...defaultPrefs, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>) };
  } catch {
    cache = { ...defaultPrefs };
  }
  return cache;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      cache = null;
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

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  cache = { ...read(), [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage can be unavailable (private mode); keep the in-memory value */
  }
  listeners.forEach((listener) => listener());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, read, () => defaultPrefs);
}

const patterns = { tap: 8, correct: 18, wrong: [30, 40, 30], complete: [20, 60, 20, 60, 40] } as const;

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

export const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (typeof navigator !== "undefined" && navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function haptic(kind: keyof typeof patterns) {
  if (!read().haptics || typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") {
    if (isIOS) iosTick();
    return;
  }
  try {
    navigator.vibrate(patterns[kind] as number | number[]);
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
