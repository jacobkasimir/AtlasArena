import { describe, expect, it } from "vitest";
import {
  RecallEntry, buildRecallIndex, classifyRecall, formatClock, normalizeRecall, poolCount, recallHash, recallPercent
} from "./recall-domain";

describe("normalizeRecall", () => {
  // Expected values come from private.recall_normalize() on the live database.
  it.each([
    ["Côte d'Ivoire", "cotedivoire"],
    ["cote d ivoire", "cotedivoire"],
    ["St. George's", "saintgeorges"],
    ["The Bahamas", "bahamas"],
    ["Weißrussland", "weissrussland"],
    ["Tórshavn", "torshavn"],
    ["Sana'a", "sanaa"],
    ["  Guinea-Bissau ", "guineabissau"],
    ["Ålesund Ø", "alesundo"],
    ["Κυπριακή Δημοκρατία", ""],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeRecall(input)).toBe(expected);
  });

  it("only rewrites the standalone token st", () => {
    expect(normalizeRecall("Stanley")).toBe("stanley");
    expect(normalizeRecall("St Lucia")).toBe("saintlucia");
  });
});

describe("recallHash", () => {
  it("matches the database hash exactly", async () => {
    expect(await recallHash("0123456789abcdef", normalizeRecall("Côte d'Ivoire"))).toBe("76d096afdb98e068");
  });
});

const entry = (position: number, keys: { h: string; x?: number[] }[]): RecallEntry => ({
  position, region: null, prompt: null, alpha2: null, name: null, found: false, foundAt: null, matched: null, lang: null,
  keys: keys.map(key => ({ h: key.h, l: "en", x: key.x ?? [] }))
});

describe("classifyRecall", () => {
  const index = buildRecallIndex([entry(1, [{ h: "niger", x: [2] }]), entry(2, [{ h: "nigeria" }]), entry(3, [{ h: "kingston" }]), entry(4, [{ h: "kingston" }])]);

  it("waits when a longer spelling of another open entry starts the same way", () => {
    expect(classifyRecall("niger", index, new Set(), new Set())).toEqual({ kind: "match", position: 1, lang: "en", wait: true });
  });
  it("accepts at once when the longer entry is already found", () => {
    expect(classifyRecall("niger", index, new Set(), new Set([2]))).toMatchObject({ kind: "match", wait: false });
  });
  it("fills shared names one entry at a time", () => {
    expect(classifyRecall("kingston", index, new Set(), new Set([3]))).toMatchObject({ kind: "match", position: 4 });
    expect(classifyRecall("kingston", index, new Set(), new Set([3, 4]))).toEqual({ kind: "already", positions: [3, 4] });
  });
  it("reports ambiguous and unknown input", () => {
    expect(classifyRecall("congo", index, new Set(["congo"]), new Set())).toEqual({ kind: "ambiguous" });
    expect(classifyRecall("atlantis", index, new Set(), new Set())).toEqual({ kind: "none" });
  });
});

describe("helpers", () => {
  it("formats clocks", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65_400)).toBe("1:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });
  it("computes percentages and pool sizes", () => {
    expect(recallPercent(1, 3)).toBe(33);
    expect(recallPercent(0, 0)).toBe(0);
    const catalog = [
      { code: "DE", region: "Europe", un: true, hasCapital: true },
      { code: "AQ", region: "Antarctica", un: false, hasCapital: false },
      { code: "XK", region: "Europe", un: false, hasCapital: true },
    ];
    expect(poolCount(catalog, { kind: "countries", scope: "all", region: null })).toBe(3);
    expect(poolCount(catalog, { kind: "capitals", scope: "all", region: null })).toBe(2);
    expect(poolCount(catalog, { kind: "countries", scope: "un", region: "Europe" })).toBe(1);
  });
});
