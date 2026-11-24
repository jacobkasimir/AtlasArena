import { describe, expect, it } from "vitest";
import type { EliminationCandidates, EliminationHint, EliminationView } from "./domain";
import {
  candidatesAt,
  filterCandidates,
  foldName,
  groupByLetter,
  hintAvailability,
  hintErrorText,
  hintRows,
  nextStep,
  stepSummary,
} from "./elimination-domain";

const data: EliminationCandidates = {
  group: 1,
  colour: "green",
  answer: { code: "IQ", name: "Iraq" },
  steps: [
    { label: "Larger than 300,000 km²", remaining: 6, pick: { code: "KZ", name: "Kazakhstan" } },
    { label: "In Asia", remaining: 4, pick: { code: "IR", name: "Iran" } },
    { label: "Name starts with I", remaining: 2, pick: { code: "IR", name: "Iran" } },
    { label: "Fewer than 50 million people", remaining: 1, pick: null },
  ],
  places: [
    { code: "IR", name: "Iran", depth: 3 },
    { code: "BR", name: "Brazil", depth: 1 },
    { code: "IQ", name: "Iraq", depth: 4 },
    { code: "KZ", name: "Kazakhstan", depth: 2 },
    { code: "CI", name: "Côte d'Ivoire", depth: 1 },
    { code: "CN", name: "China", depth: 2 },
  ],
};

describe("candidatesAt", () => {
  it("lists every place that fits up to a clue, A–Z, with the next clue's verdict", () => {
    const rows = candidatesAt(data, 1);
    expect(rows.map((row) => row.name)).toEqual(["Brazil", "China", "Côte d'Ivoire", "Iran", "Iraq", "Kazakhstan"]);
    expect(rows.find((row) => row.code === "BR")?.status).toBe("ruledOut");
    expect(rows.find((row) => row.code === "CN")?.status).toBe("kept");
    expect(rows.find((row) => row.code === "KZ")?.pick).toBe(true);
  });

  it("narrows with each clue and marks the last list as the answer", () => {
    expect(candidatesAt(data, 2).map((row) => row.code)).toEqual(["CN", "IR", "IQ", "KZ"]);
    const last = candidatesAt(data, 4);
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ code: "IQ", status: "answer", pick: false });
  });

  it("remembers every clue a place was named for", () => {
    const iran = candidatesAt(data, 1).find((row) => row.code === "IR");
    expect(iran).toMatchObject({ pick: false, pickedAt: [2, 3] });
    expect(candidatesAt(data, 3).find((row) => row.code === "IR")?.pick).toBe(true);
  });
});

it("summarises how many places the next clue keeps and rules out", () => {
  expect(stepSummary(data, 1)).toEqual({ step: 1, total: 6, kept: 4, ruledOut: 2 });
  expect(stepSummary(data, 3)).toEqual({ step: 3, total: 2, kept: 1, ruledOut: 1 });
  expect(stepSummary(data, 4)).toEqual({ step: 4, total: 1, kept: 1, ruledOut: 0 });
});

it("searches without accents and filters by verdict", () => {
  const rows = candidatesAt(data, 1);
  expect(filterCandidates(rows, "cote", "all").map((row) => row.code)).toEqual(["CI"]);
  expect(filterCandidates(rows, "  IRA ", "all").map((row) => row.code)).toEqual(["IR", "IQ"]);
  expect(filterCandidates(rows, "", "ruledOut").map((row) => row.code)).toEqual(["BR", "CI"]);
  expect(filterCandidates(rows, "", "kept")).toHaveLength(4);
  expect(filterCandidates(rows, "zzz", "all")).toEqual([]);
  expect(foldName(" Åland Islands ")).toBe("aland islands");
});

it("groups an A–Z list under first letters", () => {
  const groups = groupByLetter(candidatesAt(data, 1));
  expect(groups.map((group) => [group.letter, group.rows.length])).toEqual([["B", 1], ["C", 2], ["I", 2], ["K", 1]]);
});

it("moves between clue steps with arrows, Home and End, wrapping around", () => {
  expect(nextStep(1, "ArrowRight", 4)).toBe(2);
  expect(nextStep(4, "ArrowRight", 4)).toBe(1);
  expect(nextStep(1, "ArrowLeft", 4)).toBe(4);
  expect(nextStep(3, "Home", 4)).toBe(1);
  expect(nextStep(1, "End", 4)).toBe(4);
  expect(nextStep(2, "a", 4)).toBe(2);
});

const roundView = (extra: Partial<EliminationView> = {}): EliminationView => ({
  id: "s1", puzzleId: "easy-1", difficulty: "easy", number: 1, pool: "un", state: "active", endReason: null,
  timeLimitSeconds: 300, deadlineAt: "2026-01-01T00:05:00Z", serverNow: "2026-01-01T00:00:00Z", elapsedMs: 0,
  solved: 4, total: 12, guesses: 4, wrong: 0, hinted: false, hintsUsed: 0, hintsLeft: 3, hintLimit: 3, hints: [],
  groups: [
    // Open on clue 2 of 4.
    { colour: "green", size: 4, solved: 1, answer: null, steps: [
      { label: "a", remaining: 40, answer: { code: "KZ", name: "Kazakhstan" } }, { label: "b", remaining: 12, answer: null },
    ] },
    // Open on its last clue.
    { colour: "orange", size: 3, solved: 2, answer: null, steps: [
      { label: "a", remaining: 9, answer: { code: "FR", name: "France" } }, { label: "b", remaining: 3, answer: { code: "DE", name: "Germany" } },
      { label: "c", remaining: 1, answer: null },
    ] },
    // Solved.
    { colour: "blue", size: 1, solved: 1, answer: null, steps: [{ label: "a", remaining: 1, answer: { code: "JP", name: "Japan" } }] },
    // Open on clue 1 of 3, but only one place fits already.
    { colour: "purple", size: 3, solved: 0, answer: null, steps: [{ label: "a", remaining: 1, answer: null }] },
  ],
  ...extra,
});

describe("hintAvailability", () => {
  it("offers a hint for an open clue while hints are left", () => {
    expect(hintAvailability(roundView(), 0)).toBe("available");
  });

  it("never offers a hint whose list would be the group's single answer", () => {
    expect(hintAvailability(roundView(), 1)).toBe("lastClue");
    expect(hintAvailability(roundView(), 3)).toBe("lastClue");
  });

  it("is closed for solved groups, finished rounds and unknown groups", () => {
    expect(hintAvailability(roundView(), 2)).toBe("closed");
    expect(hintAvailability(roundView({ state: "completed" }), 0)).toBe("closed");
    expect(hintAvailability(roundView(), 9)).toBe("closed");
  });

  it("re-opens a bought hint for free, even with no hints left", () => {
    const view = roundView({ hinted: true, hintsUsed: 3, hintsLeft: 0, hints: [{ group: 1, step: 2 }] });
    expect(hintAvailability(view, 0)).toBe("owned");
    // A hint bought for an earlier step of the same group doesn't cover the new open clue.
    expect(hintAvailability({ ...view, hints: [{ group: 1, step: 1 }] }, 0)).toBe("noneLeft");
  });
});

describe("hintRows", () => {
  const hint: EliminationHint = {
    group: 1, colour: "green", answer: null, step: 2, size: 4, free: false, view: roundView(),
    steps: [{ label: "a", remaining: 40, pick: { code: "KZ", name: "Kazakhstan" } }, { label: "b", remaining: 3, pick: null }],
    places: [{ code: "MN", name: "Mongolia", depth: 2 }, { code: "KZ", name: "Kazakhstan", depth: 2 }, { code: "CN", name: "China", depth: 2 }],
  };

  it("lists the places A–Z, all neutral 'fits', and tags earlier picks", () => {
    const rows = hintRows(hint);
    expect(rows.map((row) => row.name)).toEqual(["China", "Kazakhstan", "Mongolia"]);
    expect(rows.every((row) => row.status === "fits" && !row.pick)).toBe(true);
    expect(rows.find((row) => row.code === "KZ")?.pickedAt).toEqual([1]);
  });

  it("drops anything that doesn't fit up to the hint's step", () => {
    const rows = hintRows({ ...hint, places: [...hint.places, { code: "BR", name: "Brazil", depth: 1 }] });
    expect(rows.map((row) => row.code)).not.toContain("BR");
  });
});

describe("hintErrorText", () => {
  it("explains the server's hint errors in English", () => {
    expect(hintErrorText("ELIMINATION_NO_HINTS_LEFT")).toBe("You have used every hint for this round.");
    expect(hintErrorText("ELIMINATION_HINT_LAST_CLUE")).toMatch(/single place/);
    expect(hintErrorText("ELIMINATION_ROUND_OVER")).toMatch(/round is over/);
    expect(hintErrorText("Network down")).toBe("Network down");
  });
});
