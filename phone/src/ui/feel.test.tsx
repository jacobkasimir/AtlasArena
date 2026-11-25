import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { reloadPrefs, setPref } from "@shared/prefs";
import * as sound from "@shared/sound";
import { feel, feelNotes, feelPattern, isStreakMilestone, resetFeelCooldowns, streakPattern, useFeel } from "./feel";
import { useHaptics } from "./useHaptics";

let vibrate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
  resetFeelCooldowns();
  vibrate = vi.fn();
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  reloadPrefs();
});

describe("feel patterns", () => {
  it("gives every kind a distinct vibration", () => {
    const kinds = ["tap", "select", "correct", "wrong", "combo", "timerWarning", "timeUp", "complete", "levelUp", "reward", "error"] as const;
    const encoded = kinds.map((kind) => JSON.stringify(feelPattern(kind)));
    expect(new Set(encoded).size).toBe(kinds.length);
  });

  it("makes streak patterns rise with the streak and stay short", () => {
    const three = streakPattern(3);
    const ten = streakPattern(10);
    expect(ten.length).toBeGreaterThan(three.length);
    const pulses = ten.filter((_, i) => i % 2 === 0);
    expect(pulses).toEqual([...pulses].sort((a, b) => a - b));
    expect(streakPattern(100).reduce((a, b) => a + b, 0)).toBeLessThan(400);
  });

  it("celebrates streak milestones 3, 5, 10 and every 5 after", () => {
    expect([1, 2, 3, 4, 5, 6, 10, 12, 15, 20].filter(isStreakMilestone)).toEqual([3, 5, 10, 15, 20]);
  });

  it("keeps taps silent and other cues short", () => {
    expect(feelNotes("tap")).toBeNull();
    expect(feelNotes("select")).toBeNull();
    for (const kind of ["correct", "wrong", "streak", "combo", "timerWarning", "timeUp", "complete", "levelUp", "reward", "error"] as const) {
      const notes = feelNotes(kind, 5)!;
      const end = Math.max(...notes.map((note) => note.start + note.duration));
      expect(end).toBeLessThanOrEqual(0.65);
    }
  });
});

describe("feel()", () => {
  it("vibrates with the pattern and plays the paired sound", () => {
    const play = vi.spyOn(sound, "playNotes");
    expect(feel("wrong")).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(feelPattern("wrong"));
    expect(play).toHaveBeenCalledWith(feelNotes("wrong"));
  });

  it("turns a correct answer on a streak milestone into the streak feedback", () => {
    feel("correct", { n: 5 });
    expect(vibrate).toHaveBeenCalledWith(streakPattern(5));
    resetFeelCooldowns();
    feel("correct", { n: 4 });
    expect(vibrate).toHaveBeenLastCalledWith(feelPattern("correct"));
  });

  it("is gated by the haptics preference (sound follows its own preference)", () => {
    setPref("haptics", false);
    feel("reward");
    expect(vibrate).not.toHaveBeenCalled();
    setPref("haptics", true);
    resetFeelCooldowns();
    feel("reward");
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("swallows repeats inside the cooldown; tap and select share one", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    expect(feel("tap")).toBe(true);
    expect(feel("select")).toBe(false);
    expect(feel("tap")).toBe(false);
    expect(feel("correct")).toBe(true); // other groups are independent
    vi.spyOn(performance, "now").mockReturnValue(1100);
    expect(feel("tap")).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(3);
  });

  it("can stay silent on request", () => {
    const play = vi.spyOn(sound, "playNotes");
    feel("complete", { sound: false });
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();
  });

  it("useFeel and the legacy useHaptics expose stable functions", () => {
    const { result, rerender } = renderHook(() => useFeel());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    result.current.answer(false);
    expect(vibrate).toHaveBeenCalledWith(feelPattern("wrong"));
    const legacy = renderHook(() => useHaptics()).result.current;
    expect(typeof legacy.complete).toBe("function");
    expect(typeof legacy.levelUp).toBe("function");
  });
});
