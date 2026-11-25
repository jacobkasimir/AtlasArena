import { describe, expect, it } from "vitest";
import {
  gridStep,
  isContinueKey,
  isTypingTarget,
  numberBufferIndex,
  numberKeyIndex,
  stepNumberBuffer,
} from "./keys";

const key = (k: string, extra: Partial<KeyboardEvent> = {}) =>
  ({ key: k, code: k === " " ? "Space" : k, altKey: false, ctrlKey: false, metaKey: false, ...extra }) as KeyboardEvent;

describe("isContinueKey", () => {
  it("always accepts Enter", () => {
    expect(isContinueKey(key("Enter"), "enter")).toBe(true);
    expect(isContinueKey(key("Enter"), "enter-space")).toBe(true);
  });
  it("accepts Space only when the player allows it", () => {
    expect(isContinueKey(key(" "), "enter-space")).toBe(true);
    expect(isContinueKey(key(" "), "enter")).toBe(false);
  });
  it("ignores browser shortcuts and other keys", () => {
    expect(isContinueKey(key("Enter", { ctrlKey: true }), "enter-space")).toBe(false);
    expect(isContinueKey(key("a"), "enter-space")).toBe(false);
  });
});

describe("numberKeyIndex", () => {
  it("maps 1–9 to option indexes within the option count", () => {
    expect(numberKeyIndex(key("1"), 4)).toBe(0);
    expect(numberKeyIndex(key("4"), 4)).toBe(3);
    expect(numberKeyIndex(key("5"), 4)).toBe(-1);
    expect(numberKeyIndex(key("9"), 9)).toBe(8);
  });
  it("ignores 0, letters and modified keys", () => {
    expect(numberKeyIndex(key("0"), 10)).toBe(-1);
    expect(numberKeyIndex(key("a"), 4)).toBe(-1);
    expect(numberKeyIndex(key("2", { metaKey: true }), 4)).toBe(-1);
  });
});

describe("gridStep", () => {
  const all = () => true;
  it("moves by one cell left and right, wrapping at the ends", () => {
    expect(gridStep(0, "ArrowRight", 6, 3, all)).toBe(1);
    expect(gridStep(5, "ArrowRight", 6, 3, all)).toBe(0);
    expect(gridStep(0, "ArrowLeft", 6, 3, all)).toBe(5);
  });
  it("moves by a whole row up and down", () => {
    expect(gridStep(1, "ArrowDown", 6, 3, all)).toBe(4);
    expect(gridStep(4, "ArrowUp", 6, 3, all)).toBe(1);
  });
  it("skips disabled cells in the direction of travel", () => {
    const enabled = (index: number) => index !== 1 && index !== 2;
    expect(gridStep(0, "ArrowRight", 6, 3, enabled)).toBe(3);
    expect(gridStep(3, "ArrowLeft", 6, 3, enabled)).toBe(0);
  });
  it("jumps to the first and last enabled cell with Home and End", () => {
    const enabled = (index: number) => index > 0 && index < 5;
    expect(gridStep(3, "Home", 6, 3, enabled)).toBe(1);
    expect(gridStep(1, "End", 6, 3, enabled)).toBe(4);
  });
  it("stays put when nothing else is enabled or the key is unrelated", () => {
    expect(gridStep(2, "ArrowRight", 6, 3, (index) => index === 2)).toBe(2);
    expect(gridStep(2, "x", 6, 3, all)).toBe(2);
  });
});

describe("isTypingTarget", () => {
  it("is true inside text fields only", () => {
    const input = document.createElement("input");
    const button = document.createElement("button");
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(button)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("typed number buffer", () => {
  const typeKeys = (keys: string[], count: number) => {
    let buffer = "";
    let pick: number | null = null;
    for (const k of keys) {
      const step = stepNumberBuffer(buffer, k, count);
      buffer = step.buffer;
      if (step.pick !== null) pick = step.pick;
    }
    return { buffer, pick };
  };

  it("picks a single digit at once when nine or fewer options exist", () => {
    expect(stepNumberBuffer("", "3", 9)).toEqual({ buffer: "", pick: 2, handled: true, wait: false });
    expect(stepNumberBuffer("", "9", 9).pick).toBe(8);
  });
  it("waits for more digits while a longer number could still fit", () => {
    expect(stepNumberBuffer("", "1", 25)).toEqual({ buffer: "1", pick: null, handled: true, wait: true });
    expect(stepNumberBuffer("", "2", 25)).toEqual({ buffer: "2", pick: null, handled: true, wait: true });
    expect(stepNumberBuffer("", "3", 25).pick).toBe(2);
  });
  it("picks a number as soon as no other digit fits", () => {
    expect(typeKeys(["1", "2"], 25)).toEqual({ buffer: "", pick: 11 });
    expect(typeKeys(["1", "2"], 150)).toEqual({ buffer: "12", pick: null });
    expect(typeKeys(["1", "2", "5"], 150)).toEqual({ buffer: "", pick: 124 });
  });
  it("picks the pending number with Enter", () => {
    expect(stepNumberBuffer("2", "Enter", 25)).toEqual({ buffer: "", pick: 1, handled: true, wait: false });
  });
  it("edits with Backspace and clears with Escape", () => {
    expect(stepNumberBuffer("12", "Backspace", 150)).toEqual({ buffer: "1", pick: null, handled: true, wait: true });
    expect(stepNumberBuffer("1", "Backspace", 150)).toEqual({ buffer: "", pick: null, handled: true, wait: false });
    expect(stepNumberBuffer("12", "Escape", 150)).toEqual({ buffer: "", pick: null, handled: true, wait: false });
  });
  it("leaves Enter, Backspace and Escape alone when nothing is pending", () => {
    for (const k of ["Enter", "Backspace", "Escape", "a"]) expect(stepNumberBuffer("", k, 25).handled).toBe(false);
  });
  it("ignores a leading zero and starts over on overflow", () => {
    expect(stepNumberBuffer("", "0", 25)).toEqual({ buffer: "", pick: null, handled: true, wait: false });
    expect(stepNumberBuffer("2", "7", 25)).toEqual({ buffer: "", pick: 6, handled: true, wait: false });
    expect(stepNumberBuffer("2", "0", 25).pick).toBe(19);
    expect(stepNumberBuffer("1", "0", 150)).toEqual({ buffer: "10", pick: null, handled: true, wait: true });
  });
  it("maps typed numbers to indexes within range only", () => {
    expect(numberBufferIndex("12", 40)).toBe(11);
    expect(numberBufferIndex("41", 40)).toBe(-1);
    expect(numberBufferIndex("", 40)).toBe(-1);
    expect(numberBufferIndex("07", 40)).toBe(-1);
  });
});
