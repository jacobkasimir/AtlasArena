import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { EliminationCandidates, EliminationHint, EliminationPuzzle, EliminationView } from "./domain";
import { reloadPrefs, setPref } from "./prefs";

const api = vi.hoisted(() => ({ elimCatalog: vi.fn(), elimStart: vi.fn(), elimView: vi.fn(), elimGuess: vi.fn(), elimGiveUp: vi.fn(), elimCandidates: vi.fn(), elimHint: vi.fn() }));
vi.mock("./api", () => ({ isDemo: false, DEMO_UNAVAILABLE: "ONLINE_ONLY", api }));
import Elimination from "./Elimination";

afterEach(() => { cleanup(); Object.values(api).forEach((fn) => fn.mockReset()); localStorage.clear(); reloadPrefs(); });

const puzzle = (id: string, extra: Partial<EliminationPuzzle> = {}): EliminationPuzzle => ({
  id, difficulty: "easy", number: Number(id.split("-")[1]), pool: "un", timeLimitSeconds: 300, groups: 4, total: 16,
  plays: 0, best: null, activeId: null, ...extra,
});
const view = (extra: Partial<EliminationView> = {}): EliminationView => ({
  id: "s1", puzzleId: "easy-1", difficulty: "easy", number: 1, pool: "un", state: "active", endReason: null,
  timeLimitSeconds: 300, deadlineAt: new Date(Date.now() + 200_000).toISOString(), serverNow: new Date().toISOString(),
  elapsedMs: 10_000, solved: 1, total: 16, guesses: 1, wrong: 0,
  hinted: false, hintsUsed: 0, hintsLeft: 3, hintLimit: 3, hints: [],
  groups: [
    { colour: "green", size: 4, solved: 1, answer: null, steps: [
      { label: "Larger than 300,000 km²", remaining: 72, answer: { code: "KZ", name: "Kazakhstan" } },
      { label: "In Asia", remaining: 21, answer: null },
    ] },
    { colour: "orange", size: 4, solved: 0, answer: null, steps: [{ label: "More than 10 million people", remaining: 94, answer: null }] },
  ],
  ...extra,
});

const at = (path: string) => render(
  <MemoryRouter initialEntries={[path]}><Routes><Route path="/elimination/*" element={<Elimination />} /></Routes></MemoryRouter>,
);

it("lists puzzles per difficulty with personal bests", async () => {
  api.elimCatalog.mockResolvedValue([
    puzzle("easy-1", { best: { solved: 16, elapsedMs: 95_000 } }), puzzle("easy-2", { best: { solved: 9, elapsedMs: 300_000 } }),
    puzzle("medium-1", { difficulty: "medium", total: 20 }),
  ]);
  at("/elimination");
  expect(await screen.findByText("Best 16/16 · 1:35")).toBeInTheDocument();
  expect(screen.getByText("Best 9/16")).toBeInTheDocument();
  expect(screen.queryByText("#1", { selector: ".elim-puzzle-number" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Medium/ }));
  expect(screen.getByText("Not played yet")).toBeInTheDocument();
  expect(screen.queryByText("Best 9/16")).not.toBeInTheDocument();
});

it("shows revealed clues with counts, the current clue and locked ones", async () => {
  api.elimView.mockResolvedValue(view());
  at("/elimination/play/s1");
  const green = await screen.findByRole("region", { name: "Green group" });
  expect(within(green).getByText("Kazakhstan")).toBeInTheDocument();
  expect(within(green).getByText("21")).toBeInTheDocument();
  expect(within(green).getByText("Your answer…")).toBeInTheDocument();
  expect(within(green).getByText("Clue 3")).toBeInTheDocument();
  expect(within(green).getByText("Clue 4")).toBeInTheDocument();
});

it("sends a guess and explains the result", async () => {
  api.elimView.mockResolvedValue(view());
  api.elimGuess.mockResolvedValueOnce({ result: "advanced", place: { code: "IR", name: "Iran" }, advanced: ["green", "orange"], view: view({ solved: 3 }) })
    .mockResolvedValueOnce({ result: "no_match", place: { code: "NE", name: "Niger" }, advanced: [], view: view({ solved: 3, wrong: 1 }) });
  at("/elimination/play/s1");
  const input = await screen.findByPlaceholderText("Type a country and press Enter");
  fireEvent.change(input, { target: { value: "Iran" } });
  fireEvent.submit(input.closest("form")!);
  expect(await screen.findByText("Iran fits Green and Orange – several groups moved on.")).toBeInTheDocument();
  expect(api.elimGuess).toHaveBeenCalledWith("s1", "Iran");
  fireEvent.change(input, { target: { value: "Niger" } });
  fireEvent.submit(input.closest("form")!);
  expect(await screen.findByText("Niger doesn't fit any open clue.")).toBeInTheDocument();
});

it("reveals answers and the score when the round is over", async () => {
  api.elimView.mockResolvedValue(view({ state: "completed", endReason: "time_up", solved: 8,
    groups: [{ colour: "green", size: 2, solved: 1, answer: { code: "IQ", name: "Iraq" }, steps: [
      { label: "In Asia", remaining: 46, answer: { code: "IR", name: "Iran" } }, { label: "Name starts with I", remaining: 1, answer: null },
    ] }] }));
  api.elimCatalog.mockResolvedValue([puzzle("easy-1"), puzzle("easy-2")]);
  at("/elimination/play/s1");
  expect(await screen.findByText("Time's up.")).toBeInTheDocument();
  expect(screen.getByText("50%")).toBeInTheDocument();
  expect(screen.getByText("Answer:")).toBeInTheDocument();
  expect(screen.getByText("Iraq")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Next puzzle →" })).toBeInTheDocument());
});

it("asks before giving up; Esc keeps playing and returns to the input", async () => {
  api.elimView.mockResolvedValue(view());
  at("/elimination/play/s1");
  const input = await screen.findByPlaceholderText("Type a country and press Enter");
  fireEvent.click(screen.getByRole("button", { name: "Give up" }));
  const keep = screen.getByRole("button", { name: "Keep playing" });
  await waitFor(() => expect(document.activeElement).toBe(keep));
  fireEvent.keyDown(keep, { key: "Escape" });
  expect(screen.queryByRole("button", { name: "Keep playing" })).not.toBeInTheDocument();
  expect(document.activeElement).toBe(input);
  expect(api.elimGiveUp).not.toHaveBeenCalled();
});

it("gives up straight away when confirmations are off in Settings", async () => {
  setPref("confirmGiveUp", false);
  api.elimView.mockResolvedValue(view());
  api.elimGiveUp.mockResolvedValue(view({ state: "completed", endReason: "gave_up" }));
  api.elimCatalog.mockResolvedValue([puzzle("easy-1")]);
  at("/elimination/play/s1");
  fireEvent.click(await screen.findByRole("button", { name: "Give up" }));
  await waitFor(() => expect(api.elimGiveUp).toHaveBeenCalledWith("s1"));
  expect(screen.queryByRole("button", { name: "Keep playing" })).not.toBeInTheDocument();
});

it("Esc clears the guess input", async () => {
  api.elimView.mockResolvedValue(view());
  at("/elimination/play/s1");
  const input = await screen.findByPlaceholderText("Type a country and press Enter") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Fra" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.value).toBe("");
});

const finished = () => view({ state: "completed", endReason: "gave_up", solved: 1,
  groups: [{ colour: "green", size: 3, solved: 1, answer: { code: "IQ", name: "Iraq" }, steps: [
    { label: "Larger than 300,000 km²", remaining: 4, answer: { code: "KZ", name: "Kazakhstan" } },
    { label: "In Asia", remaining: 3, answer: null },
    { label: "Name starts with I", remaining: 1, answer: null },
  ] }] });
const candidates: EliminationCandidates = {
  group: 1, colour: "green", answer: { code: "IQ", name: "Iraq" },
  steps: [
    { label: "Larger than 300,000 km²", remaining: 4, pick: { code: "KZ", name: "Kazakhstan" } },
    { label: "In Asia", remaining: 3, pick: null },
    { label: "Name starts with I", remaining: 1, pick: null },
  ],
  places: [
    { code: "BR", name: "Brazil", depth: 1 }, { code: "IQ", name: "Iraq", depth: 3 },
    { code: "KZ", name: "Kazakhstan", depth: 2 }, { code: "CN", name: "China", depth: 2 },
  ],
};

it("keeps the counts as plain numbers while the round is active", async () => {
  api.elimView.mockResolvedValue(view());
  at("/elimination/play/s1");
  const green = await screen.findByRole("region", { name: "Green group" });
  expect(within(green).queryByRole("button", { name: /Show every place/ })).not.toBeInTheDocument();
  expect(api.elimCandidates).not.toHaveBeenCalled();
});

it("after the round, a clue's count opens every place that fit, step by step", async () => {
  api.elimView.mockResolvedValue(finished());
  api.elimCatalog.mockResolvedValue([puzzle("easy-1")]);
  api.elimCandidates.mockResolvedValue(candidates);
  at("/elimination/play/s1");
  const opener = await screen.findByRole("button", { name: "Show every place that fit up to clue 1 (4)" });
  opener.focus();
  fireEvent.click(opener);
  const sheet = await screen.findByRole("dialog", { name: "Every place that fit" });
  expect(api.elimCandidates).toHaveBeenCalledWith("s1", 1);
  const list = await within(sheet).findByRole("tabpanel");
  expect(within(list).getByText("Brazil", { selector: ".elim-cand-name" }).closest("li")).toHaveClass("is-ruledOut");
  expect(within(list).getByText("Kazakhstan", { selector: ".elim-cand-name" }).closest("li")).toHaveClass("is-pick");
  expect(within(list).getByText("Your pick")).toBeInTheDocument();

  // Arrow keys move between clue steps.
  const first = within(sheet).getByRole("tab", { name: /Clue 1:/ });
  expect(first).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(first, { key: "ArrowRight" });
  const second = within(sheet).getByRole("tab", { name: /Clue 2:/ });
  expect(second).toHaveAttribute("aria-selected", "true");
  expect(document.activeElement).toBe(second);
  expect(within(sheet).queryByText("Brazil")).not.toBeInTheDocument();
  fireEvent.keyDown(second, { key: "End" });
  expect(within(sheet).getByText("Answer")).toBeInTheDocument();

  // Search filters the list; Esc in the search box clears it before it closes the sheet.
  fireEvent.keyDown(second, { key: "Home" });
  const search = within(sheet).getByRole("searchbox", { name: "Search places that fit" });
  fireEvent.change(search, { target: { value: "kaz" } });
  expect(within(sheet).queryByText("Iraq")).not.toBeInTheDocument();
  search.focus();
  fireEvent.keyDown(search, { key: "Escape" });
  expect(search).toHaveValue("");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.keyDown(search, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.activeElement).toBe(opener);
});

it("explains when the server keeps the lists locked", async () => {
  api.elimView.mockResolvedValue(finished());
  api.elimCatalog.mockResolvedValue([puzzle("easy-1")]);
  api.elimCandidates.mockRejectedValue(new Error("ELIMINATION_CANDIDATES_LOCKED"));
  at("/elimination/play/s1");
  fireEvent.click(await screen.findByRole("button", { name: "Show every place that fit up to clue 3 (1)" }));
  expect(await screen.findByText("The full lists unlock when the round is over.")).toBeInTheDocument();
});

const hint = (extra: Partial<EliminationHint> = {}): EliminationHint => ({
  group: 1, colour: "green", answer: null, step: 2, size: 4, free: false,
  view: view({ hinted: true, hintsUsed: 1, hintsLeft: 2, hints: [{ group: 1, step: 2 }] }),
  steps: [
    { label: "Larger than 300,000 km²", remaining: 72, pick: { code: "KZ", name: "Kazakhstan" } },
    { label: "In Asia", remaining: 3, pick: null },
  ],
  places: [{ code: "MN", name: "Mongolia", depth: 2 }, { code: "KZ", name: "Kazakhstan", depth: 2 }, { code: "IR", name: "Iran", depth: 2 }],
  ...extra,
});

it("asks before spending a hint and keeps playing on cancel", async () => {
  api.elimView.mockResolvedValue(view());
  at("/elimination/play/s1");
  const green = await screen.findByRole("region", { name: "Green group" });
  fireEvent.click(within(green).getByRole("button", { name: "Use a hint for Green, 3 left" }));
  const dialog = screen.getByRole("dialog", { name: "Use a hint?" });
  expect(dialog).toHaveTextContent("3 hints left – this uses one.");
  expect(dialog).toHaveTextContent("This round will no longer count for personal bests.");
  fireEvent.click(within(dialog).getByRole("button", { name: "Keep playing" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.elimHint).not.toHaveBeenCalled();
});

it("a confirmed hint shows only the open clue's list, read-only, and marks the round", async () => {
  api.elimView.mockResolvedValue(view());
  api.elimHint.mockResolvedValue(hint());
  at("/elimination/play/s1");
  const green = await screen.findByRole("region", { name: "Green group" });
  fireEvent.click(within(green).getByRole("button", { name: /Use a hint for Green/ }));
  fireEvent.click(screen.getByRole("button", { name: "Use a hint" }));
  const sheet = await screen.findByRole("dialog", { name: "Hint: places that fit so far" });
  expect(api.elimHint).toHaveBeenCalledWith("s1", 1);
  expect(within(sheet).getByText("Hint", { selector: ".elim-hint-badge" })).toBeInTheDocument();
  expect(within(sheet).getByText("3 places fit")).toBeInTheDocument();
  expect(within(sheet).getByText("Mongolia")).toBeInTheDocument();
  expect(within(sheet).queryByRole("tab")).not.toBeInTheDocument();
  expect(within(sheet).queryByText("Answer")).not.toBeInTheDocument();
  expect(within(sheet).queryByRole("button", { name: /Ruled out/ })).not.toBeInTheDocument();

  fireEvent.keyDown(within(sheet).getByRole("button", { name: "Close" }), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByText("Hinted", { selector: ".elim-hinted-badge" })).toBeInTheDocument();

  // Re-opening the bought hint is free: no question, no second request.
  fireEvent.click(within(green).getByRole("button", { name: "Show the Green hint again (free)" }));
  expect(await screen.findByRole("dialog", { name: "Hint: places that fit so far" })).toBeInTheDocument();
  expect(api.elimHint).toHaveBeenCalledTimes(1);
  // The other group still offers a paid hint, now with 2 left.
  expect(screen.getByRole("button", { name: "Use a hint for Orange, 2 left", hidden: true })).toBeInTheDocument();
});

it("offers no hint for a clue that leaves one place and none once they are used up", async () => {
  api.elimView.mockResolvedValue(view({
    hinted: true, hintsUsed: 3, hintsLeft: 0, hints: [{ group: 9, step: 1 }, { group: 9, step: 2 }, { group: 9, step: 3 }],
    groups: [
      { colour: "green", size: 2, solved: 1, answer: null, steps: [
        { label: "In Asia", remaining: 46, answer: { code: "IR", name: "Iran" } }, { label: "Name starts with I", remaining: 1, answer: null },
      ] },
      { colour: "orange", size: 4, solved: 0, answer: null, steps: [{ label: "More than 10 million people", remaining: 94, answer: null }] },
    ],
  }));
  at("/elimination/play/s1");
  const green = await screen.findByRole("region", { name: "Green group" });
  expect(within(green).queryByRole("button", { name: /hint/i })).not.toBeInTheDocument();
  expect(within(green).getByText("No hint for a clue that leaves one place.")).toBeInTheDocument();
  const orange = screen.getByRole("region", { name: "Orange group" });
  expect(within(orange).getByRole("button", { name: "No hints left for Orange" })).toBeDisabled();
});

it("explains a refused hint in plain English", async () => {
  api.elimView.mockResolvedValue(view());
  api.elimHint.mockRejectedValue(new Error("ELIMINATION_NO_HINTS_LEFT"));
  at("/elimination/play/s1");
  const green = await screen.findByRole("region", { name: "Green group" });
  fireEvent.click(within(green).getByRole("button", { name: /Use a hint for Green/ }));
  fireEvent.click(screen.getByRole("button", { name: "Use a hint" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("You have used every hint for this round.");
});

it("flags a hinted round in the results", async () => {
  api.elimView.mockResolvedValue(view({ state: "completed", endReason: "all_solved", solved: 16, hinted: true, hintsUsed: 2, hintsLeft: 1,
    hints: [{ group: 1, step: 2 }, { group: 2, step: 1 }] }));
  api.elimCatalog.mockResolvedValue([puzzle("easy-1")]);
  at("/elimination/play/s1");
  expect(await screen.findByText(/This round used 2 hints, so it doesn't count as a personal best\./)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /hint/i })).not.toBeInTheDocument();
});
