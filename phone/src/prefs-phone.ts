// Phone-only preferences. Everything shared (haptics, sound, auto-continue, text size, contrast, motion…)
// stays in src/prefs.ts and is used as-is; only choices that make no sense on desktop live here.
import { useSyncExternalStore } from "react";

export type AnswerLayout = "list" | "grid";

export type PhonePrefs = {
  /** Multiple-choice answers as a full-width list (default) or a 2 × 2 grid. */
  answerLayout: AnswerLayout;
};

export const defaultPhonePrefs: PhonePrefs = { answerLayout: "list" };

const KEY = "atlas-phone-prefs";
let cache: PhonePrefs | null = null;
const listeners = new Set<() => void>();

export function normalizePhonePrefs(stored: unknown): PhonePrefs {
  const raw = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  return {
    answerLayout: raw.answerLayout === "grid" || raw.answerLayout === "list" ? raw.answerLayout : defaultPhonePrefs.answerLayout,
  };
}

function read(): PhonePrefs {
  if (cache) return cache;
  try {
    cache = normalizePhonePrefs(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    cache = { ...defaultPhonePrefs };
  }
  return cache;
}

export function getPhonePrefs(): PhonePrefs {
  return read();
}

export function setPhonePref<K extends keyof PhonePrefs>(key: K, value: PhonePrefs[K]) {
  cache = normalizePhonePrefs({ ...read(), [key]: value });
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable: keep the in-memory value */
  }
  listeners.forEach((listener) => listener());
}

/** Forget the in-memory copy (tests, other tabs). */
export function reloadPhonePrefs() {
  cache = null;
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

export function usePhonePrefs(): PhonePrefs {
  return useSyncExternalStore(subscribe, read, () => defaultPhonePrefs);
}
