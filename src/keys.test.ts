import { describe, expect, it } from "vitest";
import { gridStep, isContinueKey, isTypingTarget, numberKeyIndex } from "./keys";

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
