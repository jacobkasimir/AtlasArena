// Visible viewport size, so inputs and action bars stay above the on-screen keyboard.
// iOS Safari and Chrome on Android (since 108) overlay the keyboard on the page instead of resizing it:
// only window.visualViewport shrinks. We publish that as CSS variables on <html> for the CSS in phone.css.
import { useEffect, useSyncExternalStore } from "react";

export type ViewportState = {
  /** Visible height in CSS px (keyboard excluded). */
  height: number;
  /** How many px of the layout viewport the keyboard covers (0 when closed). */
  keyboardInset: number;
  /** True when the keyboard (or another overlay) covers more than 120 px. */
  keyboardOpen: boolean;
};

const KEYBOARD_THRESHOLD = 120;

function measure(): ViewportState {
  if (typeof window === "undefined") return { height: 0, keyboardInset: 0, keyboardOpen: false };
  const vv = window.visualViewport;
  const height = Math.round(vv?.height ?? window.innerHeight);
  const offsetTop = vv?.offsetTop ?? 0;
  const keyboardInset = Math.max(0, Math.round(window.innerHeight - height - offsetTop));
  return { height, keyboardInset, keyboardOpen: keyboardInset > KEYBOARD_THRESHOLD };
}

let current: ViewportState = measure();
const listeners = new Set<() => void>();

function update() {
  const next = measure();
  if (
    next.height === current.height &&
    next.keyboardInset === current.keyboardInset &&
    next.keyboardOpen === current.keyboardOpen
  )
    return;
  current = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
  }
  update();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    }
  };
}

/** Current visible viewport. Re-renders when the keyboard opens/closes or the phone rotates. */
export function useViewportHeight(): ViewportState {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

/**
 * Called once by the shell: keeps --ph-viewport-height, --ph-keyboard-inset and html[data-keyboard]
 * up to date. Screens only read the CSS variables (or useViewportHeight()).
 */
export function useViewportCssVars() {
  const viewport = useViewportHeight();
  useEffect(() => {
    const root = document.documentElement;
    if (viewport.height > 0) root.style.setProperty("--ph-viewport-height", `${viewport.height}px`);
    root.style.setProperty("--ph-keyboard-inset", `${viewport.keyboardInset}px`);
    root.dataset.keyboard = viewport.keyboardOpen ? "open" : "closed";
  }, [viewport]);
  return viewport;
}
