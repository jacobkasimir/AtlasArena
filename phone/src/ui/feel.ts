// Game feel for the phone app: named haptic patterns paired with short synthesized sound cues.
// Every call respects Settings (haptics on/off via src/prefs.ts vibrate(), sound on/off + volume via
// src/sound.ts playNotes()), so screens never check prefs themselves. Android/Chrome vibrates with the
// pattern; iOS (no Vibration API) gets one light tick, and only while handling a tap (see src/prefs.ts).
import { useMemo } from "react";
import { vibrate } from "@shared/prefs";
import { Note, playNotes } from "@shared/sound";

export type FeelKind =
  | "tap" // any button press
  | "select" // choosing an option / tab / answer (lighter than tap)
  | "correct" // right answer
  | "wrong" // wrong answer
  | "streak" // streak milestone (3, 5, 10, …): rising, longer for longer streaks
  | "combo" // fast right answers in a row / bonus
  | "timerWarning" // timer crossed its warning threshold
  | "timeUp" // time ran out
  | "complete" // round finished
  | "levelUp" // level reached on the results screen
  | "reward" // medal / new personal best / achievement
  | "error"; // request failed or action not possible

/** Vibration pattern per kind: a duration in ms, or on/off/on… durations. Short and distinct by rhythm. */
export const feelPatterns: Record<Exclude<FeelKind, "streak">, number | number[]> = {
  tap: 8,
  select: 5,
  correct: 18,
  wrong: [30, 40, 30],
  combo: [12, 30, 12, 30, 24],
  timerWarning: [10, 90, 10],
  timeUp: [60, 50, 120],
  complete: [20, 60, 20, 60, 40],
  levelUp: [20, 40, 30, 40, 45, 40, 80],
  reward: [15, 35, 15, 35, 60],
  error: [45, 35, 45],
};

/** Rising pattern for a streak of `n`: one pulse per step (max 5), each a little longer than the last. */
export function streakPattern(n: number): number[] {
  const steps = Math.min(5, Math.max(2, Math.floor(n / 2) + 1));
  const pattern: number[] = [];
  for (let i = 0; i < steps; i += 1) {
    if (i > 0) pattern.push(28);
    pattern.push(10 + i * 8);
  }
  return pattern;
}

/** The vibration pattern `feel(kind, n)` uses. */
export function feelPattern(kind: FeelKind, n = 0): number | number[] {
  return kind === "streak" ? streakPattern(n) : feelPatterns[kind];
}

/** Streak counts worth celebrating: 3, 5, 10, then every 5. */
export function isStreakMilestone(streak: number): boolean {
  return streak === 3 || streak === 5 || (streak >= 10 && streak % 5 === 0);
}

const tone = (frequency: number, start: number, duration: number, type: OscillatorType = "sine", slideTo?: number): Note => ({
  frequency,
  start,
  duration,
  type,
  slideTo,
});

function streakNotes(n: number): Note[] {
  // Major arpeggio that climbs higher with longer streaks.
  const base = 523.25 * Math.pow(2, Math.min(4, Math.floor(n / 5)) / 12);
  return [tone(base, 0, 0.07), tone(base * 1.26, 0.06, 0.07), tone(base * 1.5, 0.12, 0.14)];
}

/** Sound per kind; null = silent (light UI taps never make a sound). Kept short (≤ 0.6 s) and quiet. */
export function feelNotes(kind: FeelKind, n = 0): Note[] | null {
  switch (kind) {
    case "tap":
    case "select":
      return null;
    case "correct":
      return [tone(660, 0, 0.09), tone(880, 0.08, 0.14)];
    case "wrong":
      return [tone(240, 0, 0.22, "triangle", 170)];
    case "streak":
      return streakNotes(n);
    case "combo":
      return [tone(988, 0, 0.06), tone(1318.5, 0.05, 0.1)];
    case "timerWarning":
      return [tone(1200, 0, 0.035, "square")];
    case "timeUp":
      return [tone(392, 0, 0.14, "triangle"), tone(261.6, 0.13, 0.26, "triangle")];
    case "complete":
      return [tone(523.25, 0, 0.12), tone(659.25, 0.11, 0.12), tone(783.99, 0.22, 0.12), tone(1046.5, 0.33, 0.3)];
    case "levelUp":
      return [tone(523.25, 0, 0.1), tone(659.25, 0.09, 0.1), tone(783.99, 0.18, 0.1), tone(1046.5, 0.27, 0.1), tone(1318.5, 0.36, 0.26)];
    case "reward":
      return [tone(1046.5, 0, 0.08), tone(1568, 0.07, 0.08), tone(2093, 0.14, 0.2)];
    case "error":
      return [tone(180, 0, 0.12, "square"), tone(150, 0.13, 0.14, "square")];
  }
}

/**
 * Minimum gap between two feedbacks of the same group, so rapid taps or a re-render don't buzz constantly.
 * tap and select share one group (a button that also selects an answer buzzes once).
 */
const COOLDOWN_MS: Record<string, number> = { light: 70, timerWarning: 800, default: 90 };
const lastFired = new Map<string, number>();

function cooldownGroup(kind: FeelKind) {
  return kind === "tap" || kind === "select" ? "light" : kind;
}

/** Test helper: forget all cooldowns. */
export function resetFeelCooldowns() {
  lastFired.clear();
}

function now() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

export type FeelOptions = {
  /** Streak length for "streak" (and for "correct", which turns into "streak" on a milestone). */
  n?: number;
  /** false: vibration only. Default true (sound still follows Settings). */
  sound?: boolean;
};

/**
 * Fire one feedback. Returns false when it was swallowed by the cooldown. Prefs gating happens inside
 * vibrate()/playNotes(), so this is always safe to call.
 */
export function feel(kind: FeelKind, { n = 0, sound = true }: FeelOptions = {}): boolean {
  const effective: FeelKind = kind === "correct" && isStreakMilestone(n) ? "streak" : kind;
  const group = cooldownGroup(effective);
  const time = now();
  const last = lastFired.get(group);
  const gap = COOLDOWN_MS[group] ?? COOLDOWN_MS.default;
  if (last !== undefined && time - last < gap) return false;
  lastFired.set(group, time);
  vibrate(feelPattern(effective, n));
  if (sound) {
    const notes = feelNotes(effective, n);
    if (notes) playNotes(notes);
  }
  return true;
}

export type Feel = {
  tap: () => void;
  select: () => void;
  /** Right answer; pass the server's streak so milestones (3, 5, 10, …) get the rising streak feedback. */
  correct: (streak?: number) => void;
  wrong: () => void;
  /** Right/wrong in one call: `answer(view.feedback.correct, view.stats.streak)`. */
  answer: (correct: boolean, streak?: number) => void;
  streak: (n: number) => void;
  combo: () => void;
  timerWarning: () => void;
  timeUp: () => void;
  complete: () => void;
  levelUp: () => void;
  reward: () => void;
  error: () => void;
};

function makeFeel(): Feel {
  return {
    tap: () => void feel("tap"),
    select: () => void feel("select"),
    correct: (streak = 0) => void feel("correct", { n: streak }),
    wrong: () => void feel("wrong"),
    answer: (correct, streak = 0) => void (correct ? feel("correct", { n: streak }) : feel("wrong")),
    streak: (n) => void feel("streak", { n }),
    combo: () => void feel("combo"),
    timerWarning: () => void feel("timerWarning"),
    timeUp: () => void feel("timeUp"),
    complete: () => void feel("complete"),
    levelUp: () => void feel("levelUp"),
    reward: () => void feel("reward"),
    error: () => void feel("error"),
  };
}

/** Stable feedback functions for a screen. */
export function useFeel(): Feel {
  return useMemo(makeFeel, []);
}
