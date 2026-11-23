import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { EliminationPuzzle, EliminationView } from "./domain";

const api = vi.hoisted(() => ({ elimCatalog: vi.fn(), elimStart: vi.fn(), elimView: vi.fn(), elimGuess: vi.fn(), elimGiveUp: vi.fn() }));
vi.mock("./api", () => ({ isDemo: false, DEMO_UNAVAILABLE: "ONLINE_ONLY", api }));
import Elimination from "./Elimination";

afterEach(() => { cleanup(); Object.values(api).forEach((fn) => fn.mockReset()); });

const puzzle = (id: string, extra: Partial<EliminationPuzzle> = {}): EliminationPuzzle => ({
  id, difficulty: "easy", number: Number(id.split("-")[1]), pool: "un", timeLimitSeconds: 300, groups: 4, total: 16,
  plays: 0, best: null, activeId: null, ...extra,
});
const view = (extra: Partial<EliminationView> = {}): EliminationView => ({
  id: "s1", puzzleId: "easy-1", difficulty: "easy", number: 1, pool: "un", state: "active", endReason: null,
  timeLimitSeconds: 300, deadlineAt: new Date(Date.now() + 200_000).toISOString(), serverNow: new Date().toISOString(),
  elapsedMs: 10_000, solved: 1, total: 16, guesses: 1, wrong: 0,
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
