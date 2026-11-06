import { describe, expect, it } from "vitest";
import {
  canTransition, eligibleDifficulty, eligibleXP, expired, level, score,
  shuffle, validateOption, PlayableQuestion
} from "./domain";

describe("scoring", () => {
  it("applies integer difficulty scores", () => {
    expect(score(true, "easy", 1)).toBe(100);
    expect(score(true, "medium", 1)).toBe(125);
    expect(score(true, "hard", 1)).toBe(150);
    expect(score(true, "expert", 1)).toBe(200);
  });
  it("caps streak and resets wrong answers", () => {
    expect(score(true, "easy", 2)).toBe(110);
    expect(score(true, "easy", 100)).toBe(150);
    expect(score(false, "expert", 0)).toBe(0);
  });
  it("rounds and clamps optional speed bonus", () => {
    expect(score(true, "easy", 1, 333, 1000)).toBe(117);
    expect(score(true, "easy", 1, 2000, 1000)).toBe(150);
    expect(score(true, "easy", 1, -1, 1000)).toBe(100);
  });
});
it("has terminal session states", () => {
  expect(canTransition("awaiting_answer", "showing_feedback")).toBe(true);
  expect(canTransition("showing_feedback", "awaiting_answer")).toBe(true);
  expect(canTransition("completed", "awaiting_answer")).toBe(false);
  expect(canTransition("abandoned", "completed")).toBe(false);
});
it("rejects the exact deadline and later", () => {
  expect(expired(100, 99)).toBe(false);
  expect(expired(100, 100)).toBe(true);
  expect(expired(100, 101)).toBe(true);
  expect(expired(null, 1000)).toBe(false);
});
it("keeps exact difficulty outside endless", () => {
  expect(eligibleDifficulty("hard", "easy", "classic")).toBe(false);
  expect(eligibleDifficulty("medium", "easy", "endless", 4)).toBe(false);
  expect(eligibleDifficulty("medium", "easy", "endless", 5)).toBe(true);
  expect(eligibleDifficulty("easy", "hard", "endless", 20)).toBe(false);
});
it("validates stable answer identifiers", () => {
  const q = {
    id: "q", type: "mc", prompt: "Test", category: "geography",
    subcategory: "capitals", difficulty: "easy",
    options: [{ id: "a", label: "A" }]
  } as PlayableQuestion;
  expect(validateOption(q, "a")).toBe(true);
  expect(validateOption(q, "forged")).toBe(false);
  expect(shuffle(q.options)[0].id).toBe("a");
});
it("separates practice XP and computes levels", () => {
  expect(eligibleXP("practice", 10, 10)).toBe(0);
  expect(eligibleXP("classic", 10, 10)).toBe(120);
  expect(eligibleXP("timed", 0, 0)).toBe(0);
  expect(level(0)).toBe(1);
  expect(level(499)).toBe(1);
  expect(level(500)).toBe(2);
});

function luminance(hex: string) {
  const c = hex.match(/\w\w/g)!.map(v => parseInt(v, 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
}
function contrast(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
it("checks core foreground/background contrast pairs", () => {
  for (const bg of ["0B1020", "141D32", "1B2842"]) {
    expect(contrast("F3F6FC", bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("A8B5CC", bg)).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrast("0B1020", "35D0C5")).toBeGreaterThanOrEqual(4.5);
  expect(contrast("0B1020", "FB7185")).toBeGreaterThanOrEqual(4.5);
});
