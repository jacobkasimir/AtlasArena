// Keyboard helpers shared by the game screens (Quiz, Flags, Capitals, Recall, Elimination).
import { useEffect, useRef } from "react";
import type { ContinueKeys } from "./prefs";

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "metaKey">;

/** True while the player types into a field: game shortcuts must leave those keys alone. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    typeof HTMLElement !== "undefined" &&
    target instanceof HTMLElement &&
    Boolean(target.closest("input,textarea,select,[contenteditable=true]"))
  );
}

/** True when a modal dialog (leave run, abandon, shortcuts, player window …) is open and owns the keyboard. */
export function modalOpen(): boolean {
  return typeof document !== "undefined" && Boolean(document.querySelector('[aria-modal="true"]'));
}

/** True when a modifier is held: Ctrl/Cmd/Alt combinations belong to the browser. */
export function hasModifier(event: KeyLike): boolean {
  return event.altKey || event.ctrlKey || event.metaKey;
}

/** Enter always moves on from feedback; Space too unless the player turned it off in Settings. */
export function isContinueKey(event: KeyLike, continueKeys: ContinueKeys): boolean {
  if (hasModifier(event)) return false;
  return event.key === "Enter" || (continueKeys === "enter-space" && (event.code === "Space" || event.key === " "));
}

/**
 * Zero-based answer index for the number keys 1–9 (top row and numpad), or -1.
 * `count` is the number of options; keys beyond it are ignored.
 */
export function numberKeyIndex(event: KeyLike, count: number): number {
  if (hasModifier(event) || !/^[1-9]$/.test(event.key)) return -1;
  const index = Number(event.key) - 1;
  return index < count ? index : -1;
}

/**
 * Next index in a wrapped grid for arrow keys, Home and End. Left/Right move by one, Up/Down by a row.
 * Disabled cells are skipped in the direction of travel; returns `index` when nothing else is enabled.
 */
export function gridStep(
  index: number,
  key: string,
  count: number,
  columns: number,
  isEnabled: (index: number) => boolean,
): number {
  if (count <= 0) return index;
  const cols = Math.max(1, Math.min(columns, count));
  const firstEnabled = (from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < count; i += step) if (isEnabled(i)) return i;
    return -1;
  };
  if (key === "Home") {
    const found = firstEnabled(0, 1);
    return found < 0 ? index : found;
  }
  if (key === "End") {
    const found = firstEnabled(count - 1, -1);
    return found < 0 ? index : found;
  }
  const delta =
    key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : key === "ArrowDown" ? cols : key === "ArrowUp" ? -cols : 0;
  if (!delta) return index;
  const direction: 1 | -1 = delta > 0 ? 1 : -1;
  // Move one step (or one row), wrapping around the ends, then skip disabled cells.
  let target = (((index + delta) % count) + count) % count;
  for (let tries = 0; tries < count; tries++) {
    if (isEnabled(target)) return target;
    target = (((target + direction) % count) + count) % count;
  }
  return index;
}

type GameKeyHandler = ((event: KeyboardEvent) => void) | null;

/**
 * Window-wide game shortcuts. Returns a ref: assign the handler during render (it may be reassigned on every
 * render, also after early returns). Keys typed into fields, keys with Ctrl/Cmd/Alt and keys while a modal
 * dialog is open never reach the handler.
 */
export function useGameKeys() {
  const handler = useRef<GameKeyHandler>(null);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || modalOpen() || isTypingTarget(event.target) || hasModifier(event)) return;
      handler.current?.(event);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return handler;
}
