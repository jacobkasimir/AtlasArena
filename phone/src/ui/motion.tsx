// Motion helpers for the phone app. Everything here is decoration: it is skipped entirely when the player
// (Settings → Reduce motion) or the operating system (prefers-reduced-motion) asks for less motion.
import { CSSProperties, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePrefs } from "@shared/prefs";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribeSystem(listener: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const media = window.matchMedia(QUERY);
  media.addEventListener?.("change", listener);
  return () => media.removeEventListener?.("change", listener);
}

function systemReduced() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

/** True when the app pref or the OS asks for reduced motion (live). */
export function useReducedMotion(): boolean {
  const { reduceMotion } = usePrefs();
  const system = useSyncExternalStore(subscribeSystem, systemReduced, () => false);
  return reduceMotion || system;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Animates a number from `from` (default 0) to `target` once, with ease-out. Returns the value to show.
 * Jumps straight to the target under reduced motion, when `enabled` is false, or without requestAnimationFrame.
 * Render the real value for screen readers separately (ScoreReveal does) – the animated one is aria-hidden.
 */
export function useCountUp(
  target: number,
  { durationMs = 900, from = 0, enabled = true, delayMs = 0 }: { durationMs?: number; from?: number; enabled?: boolean; delayMs?: number } = {},
): number {
  const reduced = useReducedMotion();
  const animate = enabled && !reduced && typeof requestAnimationFrame === "function" && target !== from && durationMs > 0;
  const [value, setValue] = useState(animate ? from : target);
  useEffect(() => {
    if (!animate) {
      setValue(target);
      return;
    }
    let frame = 0;
    let start: number | null = null;
    let cancelled = false;
    setValue(from);
    const step = (time: number) => {
      if (cancelled) return;
      if (start === null) start = time;
      const progress = Math.min(1, Math.max(0, (time - start - delayMs) / durationMs));
      setValue(from + (target - from) * easeOutCubic(progress));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [animate, target, from, durationMs, delayMs]);
  return animate ? value : target;
}

/**
 * Restarts a CSS animation class each time `trigger` changes (e.g. a streak count): returns a key to put on the
 * animated element so React re-mounts it. `undefined` until the first change, so nothing animates on mount.
 */
export function useReplayKey(trigger: unknown): string | undefined {
  const first = useRef(trigger);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (Object.is(first.current, trigger)) return;
    first.current = trigger;
    setCount((value) => value + 1);
  }, [trigger]);
  return count ? `r${count}` : undefined;
}

const pieceClass = ["ph-burst-piece", "ph-burst-piece is-c1", "ph-burst-piece is-c2", "ph-burst-piece is-c3"];

/**
 * Confetti-lite: up to 30 small token-coloured pieces that fly out from the centre of the parent (the parent
 * needs `position: relative`). Pure DOM + CSS, aria-hidden, nothing rendered under reduced motion.
 * Re-fires whenever `fireKey` changes to a new truthy value.
 */
export function Burst({ fireKey, count = 24 }: { fireKey: string | number | false | null | undefined; count?: number }) {
  const reduced = useReducedMotion();
  const pieces = useMemo(() => {
    const total = Math.min(30, Math.max(0, count));
    // Deterministic spread (golden angle), so tests and screenshots are stable.
    return Array.from({ length: total }, (_, i) => {
      const angle = (i * 137.508) % 360;
      const distance = 70 + ((i * 37) % 60);
      const rad = (angle * Math.PI) / 180;
      return {
        x: Math.round(Math.cos(rad) * distance),
        y: Math.round(Math.sin(rad) * distance * 0.8 - 30),
        r: (i * 53) % 360,
        c: i % 4,
        d: (i % 5) * 18,
      };
    });
  }, [count]);
  if (!fireKey || reduced) return null;
  return (
    <span className="ph-burst" aria-hidden="true" key={String(fireKey)} data-testid="ph-burst">
      {pieces.map((p, i) => (
        <span
          key={i}
          className={pieceClass[p.c]}
          style={{ "--x": `${p.x}px`, "--y": `${p.y}px`, "--r": `${p.r}deg`, "--d": `${p.d}ms` } as CSSProperties}
        />
      ))}
    </span>
  );
}
