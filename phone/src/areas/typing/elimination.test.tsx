import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { EliminationCandidates, EliminationHint, EliminationPuzzle, EliminationView } from "@shared/domain";
import { deferred, renderArea } from "./test-utils";

const mocks = vi.hoisted(() => ({
  elimCatalog: vi.fn(),
  elimStart: vi.fn(),
  elimView: vi.fn(),
  elimGuess: vi.fn(),
  elimGiveUp: vi.fn(),
  elimCandidates: vi.fn(),
  elimHint: vi.fn(),
}));
vi.mock("@shared/api", () => ({ api: mocks, isDemo: false, DEMO_UNAVAILABLE: "ONLINE_ONLY" }));
vi.mock("@shared/sound", () => ({ cue: vi.fn(), playSound: vi.fn(), playNotes: vi.fn() }));

import { feelPattern, resetFeelCooldowns } from "@phone/ui";
import EliminationArea from "./elimination";

const france = { code: "fr", name: "France" };
const germany = { code: "de", name: "Germany" };

function view(patch: Partial<EliminationView> = {}): EliminationView {
  const now = Date.now();
  return {
    id: "e1",
    puzzleId: "p1",
    difficulty: "easy",
    number: 1,
    pool: "un",
    state: "active",
    endReason: null,
    timeLimitSeconds: 300,
    deadlineAt: new Date(now + 300_000).toISOString(),
    serverNow: new Date(now).toISOString(),
    elapsedMs: 0,
    solved: 0,
    total: 8,
    guesses: 0,
    wrong: 0,
    groups: [
      { colour: "green", size: 4, solved: 0, answer: null, steps: [{ label: "In Europe", remaining: 44, answer: null }] },
      { colour: "orange", size: 4, solved: 0, answer: null, steps: [{ label: "Landlocked", remaining: 32, answer: null }] },
    ],
    hinted: false,
    hintsUsed: 0,
    hintsLeft: 3,
    hintLimit: 3,
    hints: [],
    ...patch,
  };
}

function puzzle(patch: Partial<EliminationPuzzle> = {}): EliminationPuzzle {
  return {
    id: "p1",
    difficulty: "easy",
    number: 1,
    pool: "un",
    timeLimitSeconds: 300,
    groups: 2,
    total: 8,
    plays: 0,
    best: null,
    activeId: null,
    ...patch,
  };
}

const input = () => screen.getByLabelText("Name a country or territory") as HTMLInputElement;
const group = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name} group`) });

let vibrate: ReturnType<typeof vi.fn>;
const vibratedWith = (pattern: number | number[]) =>
  vibrate.mock.calls.filter(([value]) => JSON.stringify(value) === JSON.stringify(pattern)).length;

beforeEach(() => {
  localStorage.clear();
  resetFeelCooldowns();
  vibrate = vi.fn();
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
  Object.values(mocks).forEach((mock) => mock.mockReset());
});
// A round on screen adds a Back-guard history entry; unmounting removes it asynchronously. Let that finish so
// it never lands in the next test.
afterEach(async () => {
  cleanup();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
});

describe("phone Elimination", { timeout: 15_000 }, () => {
  it("shows the online-only state in the demo", async () => {
    mocks.elimCatalog.mockRejectedValue(new Error("ONLINE_ONLY: Category Elimination needs an online account."));
    renderArea("elimination", <EliminationArea />, "/elimination");
    expect(await screen.findByText(/Elimination needs an online account/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to games" })).toHaveAttribute("href", "/games");
  });

  it("lists puzzles by difficulty with bests, resumes an open round and starts a new one", async () => {
    mocks.elimCatalog.mockResolvedValue([
      puzzle({ best: { solved: 8, elapsedMs: 95_000 } }),
      puzzle({ id: "p2", number: 2, activeId: "e9" }),
      puzzle({ id: "p3", number: 3 }),
      puzzle({ id: "h1", difficulty: "hard", number: 1 }),
    ]);
    mocks.elimStart.mockResolvedValue(view({ id: "e3", puzzleId: "p3" }));
    mocks.elimView.mockResolvedValue(view({ id: "e3" }));
    renderArea("elimination", <EliminationArea />, "/elimination");
    expect(await screen.findByRole("button", { name: /^Play again puzzle 1: .*Best 8\/8 in 1:35/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Continue Easy #2/ })).toHaveAttribute("href", "/elimination/play/e9");
    expect(screen.getByRole("button", { name: "Easy 1/3 perfect" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /^Hard/ }));
    expect(screen.getByRole("button", { name: /^Hard/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /puzzle 3/ })).not.toBeInTheDocument();
    expect(localStorage.getItem("elim-difficulty")).toBe("hard");
    fireEvent.click(screen.getByRole("button", { name: /^Easy/ }));

    fireEvent.click(screen.getByRole("button", { name: /^Play puzzle 3/ }));
    await waitFor(() => expect(mocks.elimStart).toHaveBeenCalledWith("p3", expect.any(String)));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/elimination/play/e3"));
  });

  it("sends a guess once, updates the counts and keeps the focus in the field", async () => {
    mocks.elimView.mockResolvedValue(view());
    const pending = deferred<unknown>();
    mocks.elimGuess.mockReturnValueOnce(pending.promise);
    renderArea("elimination", <EliminationArea />, "/elimination/play/e1");
    await screen.findByLabelText("Name a country or territory");
    expect(input()).toHaveAttribute("enterkeyhint", "go");
    expect(input()).toHaveAttribute("autocapitalize", "none");
    expect(input()).toHaveAttribute("autocorrect", "off");
    expect(input()).toHaveAttribute("spellcheck", "false");

    fireEvent.change(input(), { target: { value: "France" } });
    const go = screen.getByRole("button", { name: "Go" });
    fireEvent.click(go);
    fireEvent.click(go);
    fireEvent.submit(input().closest("form")!);
    expect(mocks.elimGuess).toHaveBeenCalledTimes(1);
    expect(mocks.elimGuess).toHaveBeenCalledWith("e1", "France");

    pending.resolve({
      result: "advanced",
      place: france,
      advanced: ["green"],
      view: view({
        solved: 1,
        guesses: 1,
        groups: [
          {
            colour: "green",
            size: 4,
            solved: 1,
            answer: null,
            steps: [
              { label: "In Europe", remaining: 44, answer: france },
              { label: "Coastline on the Atlantic", remaining: 12, answer: null },
            ],
          },
          { colour: "orange", size: 4, solved: 0, answer: null, steps: [{ label: "Landlocked", remaining: 32, answer: null }] },
        ],
      }),
    });
    expect(await screen.findByText("✓ France fits Green.")).toBeInTheDocument();
    expect(input().value).toBe("");
    expect(input()).toHaveFocus();
    const green = group("Green");
    expect(within(green).getByText("Coastline on the Atlantic")).toBeInTheDocument();
    expect(within(green).getByLabelText("12 places fit up to here")).toBeInTheDocument();
    expect(within(green).getByText("France")).toBeInTheDocument();
    expect(screen.getByText("1", { selector: ".ph-typing-found strong" })).toBeInTheDocument();
    expect(screen.getByText(/1 guess · 0 didn't fit/)).toBeInTheDocument();

    // A wrong guess costs only time: the text stays for a fix.
    mocks.elimGuess.mockResolvedValueOnce({ result: "unknown", view: view({ guesses: 2, solved: 1 }) });
    fireEvent.change(input(), { target: { value: "Atlantis" } });
    fireEvent.click(go);
    expect(await screen.findByText("“Atlantis” isn't a place in this puzzle.")).toBeInTheDocument();
    expect(input().value).toBe("Atlantis");
  });

  it("rewards a solved group, says 'correct' for a step and 'wrong' for a place that doesn't fit", async () => {
    const twoGroups = (greenSolved: number, orangeSolved: number) => [
      {
        colour: "green" as const, size: 1, solved: greenSolved, answer: greenSolved ? france : null,
        steps: [{ label: "In Europe", remaining: 44, answer: greenSolved ? france : null }],
      },
      {
        colour: "orange" as const, size: 2, solved: orangeSolved, answer: null,
        steps: [
          { label: "Landlocked", remaining: 32, answer: orangeSolved ? germany : null },
          ...(orangeSolved ? [{ label: "Borders France", remaining: 5, answer: null }] : []),
        ],
      },
    ];
    mocks.elimView.mockResolvedValue(view({ total: 3, groups: twoGroups(0, 0) }));
    mocks.elimGuess
      .mockResolvedValueOnce({ result: "advanced", place: france, advanced: ["green"], view: view({ total: 3, solved: 1, guesses: 1, groups: twoGroups(1, 0) }) })
      .mockResolvedValueOnce({ result: "advanced", place: germany, advanced: ["orange"], view: view({ total: 3, solved: 2, guesses: 2, groups: twoGroups(1, 1) }) })
      .mockResolvedValueOnce({ result: "no_match", place: { code: "jp", name: "Japan" }, view: view({ total: 3, solved: 2, guesses: 3, wrong: 1, groups: twoGroups(1, 1) }) });
    renderArea("elimination", <EliminationArea />, "/elimination/play/e1");
    await screen.findByLabelText("Name a country or territory");

    const guess = async (name: string, calls: number) => {
      resetFeelCooldowns();
      fireEvent.change(input(), { target: { value: name } });
      fireEvent.click(screen.getByRole("button", { name: "Go" }));
      await waitFor(() => expect(mocks.elimGuess).toHaveBeenCalledTimes(calls));
      await waitFor(() => expect(screen.getByRole("button", { name: "Go" })).not.toHaveAttribute("aria-busy", "true"));
    };
    await guess("France", 1);
    await waitFor(() => expect(vibratedWith(feelPattern("reward"))).toBe(1));
    expect(vibratedWith(feelPattern("correct"))).toBe(0);

    await guess("Germany", 2);
    await waitFor(() => expect(vibratedWith(feelPattern("correct"))).toBe(1));
    expect(vibratedWith(feelPattern("reward"))).toBe(1);

    await guess("Japan", 3);
    await waitFor(() => expect(vibratedWith(feelPattern("wrong"))).toBe(1));
  });

  it("asks before a hint, spends it once, marks the round and re-opens it for free", async () => {
    mocks.elimView.mockResolvedValue(view());
    const hinted = view({ hinted: true, hintsUsed: 1, hintsLeft: 2, hints: [{ group: 1, step: 1 }] });
    const hint: EliminationHint = {
      group: 1,
      colour: "green",
      answer: null,
      steps: [{ label: "In Europe", remaining: 44, pick: null }],
      places: [
        { ...france, depth: 1 },
        { ...germany, depth: 1 },
        { code: "ci", name: "Côte d'Ivoire", depth: 1 },
      ],
      step: 1,
      size: 4,
      free: false,
      view: hinted,
    };
    mocks.elimHint.mockResolvedValue(hint);
    renderArea("elimination", <EliminationArea />, "/elimination/play/e1");
    await screen.findByLabelText("Name a country or territory");

    fireEvent.click(screen.getByRole("button", { name: "Use a hint for Green, 3 left" }));
    const ask = await screen.findByRole("dialog", { name: "Use a hint?" });
    expect(ask).toHaveTextContent("3 hints left. This round will no longer count for personal bests.");
    expect(mocks.elimHint).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole("button", { name: "Use a hint" }));
    await waitFor(() => expect(mocks.elimHint).toHaveBeenCalledWith("e1", 1));

    const sheet = await screen.findByRole("dialog", { name: "Green group · Hint" });
    expect(within(sheet).getByText("This hint used one of your hints for this round.")).toBeInTheDocument();
    const names = within(sheet)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(names).toEqual(["1In Europe", "Côte d'Ivoire", "France", "Germany"]);
    // Accent-insensitive search.
    fireEvent.change(within(sheet).getByLabelText("Search places"), { target: { value: "cote" } });
    expect(within(sheet).getByText("Côte d'Ivoire")).toBeInTheDocument();
    expect(within(sheet).queryByText("France")).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(screen.getByRole("img", { name: "Hinted: this round doesn't count for personal bests" })).toBeInTheDocument();
    expect(screen.getByText("2 hints left")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show the Green hint again (free)" }));
    expect(await screen.findByRole("dialog", { name: "Green group · Hint" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Use a hint?" })).not.toBeInTheDocument();
    expect(mocks.elimHint).toHaveBeenCalledTimes(1);
  });

  it("explains a refused hint in plain English", async () => {
    mocks.elimView.mockResolvedValue(view());
    mocks.elimHint.mockRejectedValue(new Error("ELIMINATION_NO_HINTS_LEFT"));
    renderArea("elimination", <EliminationArea />, "/elimination/play/e1");
    fireEvent.click(await screen.findByRole("button", { name: "Use a hint for Orange, 3 left" }));
    const ask = await screen.findByRole("dialog", { name: "Use a hint?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Use a hint" }));
    expect(await screen.findByText("You have used every hint for this round.")).toBeInTheDocument();
  });

  it("opens every candidate list in a bottom sheet after the round", async () => {
    const finished = view({
      state: "completed",
      endReason: "time_up",
      solved: 2,
      guesses: 4,
      wrong: 1,
      elapsedMs: 300_000,
      groups: [
        {
          colour: "green",
          size: 2,
          solved: 2,
          answer: france,
          steps: [
            { label: "In Europe", remaining: 3, answer: germany },
            { label: "Borders Spain", remaining: 1, answer: france },
          ],
        },
      ],
    });
    mocks.elimView.mockResolvedValue(finished);
    mocks.elimCatalog.mockResolvedValue([puzzle({ best: { solved: 2, elapsedMs: 200_000 } }), puzzle({ id: "p2", number: 2 })]);
    const candidates: EliminationCandidates = {
      group: 1,
      colour: "green",
      answer: france,
      steps: [
        { label: "In Europe", remaining: 3, pick: germany },
        { label: "Borders Spain", remaining: 1, pick: france },
      ],
      places: [
        { ...france, depth: 2 },
        { ...germany, depth: 1 },
        { code: "it", name: "Italy", depth: 1 },
      ],
    };
    mocks.elimCandidates.mockResolvedValue(candidates);
    renderArea("elimination", <EliminationArea />, "/elimination/results/e1");
    expect(await screen.findByRole("heading", { name: "Time's up." })).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Next puzzle · Easy #2" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show every place that fit up to clue 1 (3)" }));
    const sheet = await screen.findByRole("dialog", { name: "Green group · Every place that fit" });
    expect(mocks.elimCandidates).toHaveBeenCalledWith("e1", 1);
    const tab1 = await within(sheet).findByRole("tab", { name: "Clue 1: In Europe, 3 places" });
    expect(tab1).toHaveAttribute("aria-selected", "true");
    const germanyRow = within(sheet).getByText("Germany", { selector: ".ph-elim-cand-name" }).closest("li")!;
    expect(germanyRow).toHaveClass("is-pick");
    expect(within(germanyRow).getByText("Your pick")).toBeInTheDocument();
    const italyRow = within(sheet).getByText("Italy", { selector: ".ph-elim-cand-name" }).closest("li")!;
    expect(italyRow).toHaveClass("is-ruledOut");
    expect(italyRow).toHaveTextContent("ruled out by the next clue");

    fireEvent.click(within(sheet).getByRole("button", { name: /^Ruled out/ }));
    expect(within(sheet).getByRole("button", { name: /^Ruled out/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(sheet).queryByText("France")).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: /^Fit the next clue/ }));
    expect(within(sheet).getByText("France")).toBeInTheDocument();
    expect(within(sheet).queryByText("Italy")).not.toBeInTheDocument();

    // Arrow keys switch clue tabs; the last clue marks the answer.
    fireEvent.keyDown(tab1, { key: "ArrowRight" });
    const tab2 = within(sheet).getByRole("tab", { name: "Clue 2: Borders Spain, 1 place" });
    expect(tab2).toHaveAttribute("aria-selected", "true");
    expect(tab2).toHaveFocus();
    const franceRow = within(sheet).getByText("France", { selector: ".ph-elim-cand-name" }).closest("li")!;
    expect(within(franceRow).getByText("Answer")).toBeInTheDocument();
    expect(within(franceRow).getByText("Your pick")).toBeInTheDocument();
    expect(mocks.elimCandidates).toHaveBeenCalledTimes(1);
  });

  it("explains locked candidate lists", async () => {
    mocks.elimView.mockResolvedValue(
      view({
        state: "completed",
        endReason: "gave_up",
        groups: [{ colour: "blue", size: 2, solved: 0, answer: france, steps: [{ label: "In Europe", remaining: 3, answer: null }] }],
      }),
    );
    mocks.elimCatalog.mockResolvedValue([]);
    mocks.elimCandidates.mockRejectedValue(new Error("ELIMINATION_CANDIDATES_LOCKED"));
    renderArea("elimination", <EliminationArea />, "/elimination/results/e1");
    fireEvent.click(await screen.findByRole("button", { name: "Show every place that fit up to clue 1 (3)" }));
    expect(await screen.findByText("The full lists unlock when the round is over.")).toBeInTheDocument();
  });
});

describe("phone Elimination Back guard", { timeout: 15_000 }, () => {
  /** Lets pending history traversals (jsdom runs them as tasks) and the guard's settle timers finish. */
  const settle = (ms = 200) =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  const pressBack = async () => {
    await act(async () => {
      window.history.back();
    });
    await settle();
  };
  const where = () => screen.getByTestId("where").textContent;
  const guarded = () => Boolean((window.history.state as Record<string, unknown> | null)?.phoneBackGuard);
  const overlay = () => Boolean((window.history.state as Record<string, unknown> | null)?.phoneOverlay);

  beforeEach(() => {
    // jsdom keeps one history for the whole file: start every test on a clean entry.
    window.history.replaceState(null, "");
    mocks.elimView.mockResolvedValue(view());
    mocks.elimCatalog.mockResolvedValue([puzzle({ activeId: "e1" })]);
  });
  it("opens the leave sheet on Back during a round and keeps playing on cancel", async () => {
    renderArea("elimination", <EliminationArea />, "/elimination/play/e1");
    await screen.findByLabelText("Name a country or territory");
    expect(guarded()).toBe(true);

    await pressBack();
    const sheet = await screen.findByRole("dialog", { name: "Leave this round?" });
    expect(where()).toBe("/elimination/play/e1");
    expect(sheet).toHaveTextContent("The round's clock keeps running while you are away.");
    expect(guarded()).toBe(true);
    expect(overlay()).toBe(true);

    fireEvent.click(within(sheet).getByRole("button", { name: "Keep playing" }));
    await settle();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(where()).toBe("/elimination/play/e1");
    // Back on the sentinel again, ready for the next Back.
    expect(guarded()).toBe(true);
    expect(overlay()).toBe(false);

    await pressBack();
    expect(await screen.findByRole("dialog", { name: "Leave this round?" })).toBeInTheDocument();
  });

  it("closes the leave sheet with a second Back and stays in the round", async () => {
    renderArea("elimination", <EliminationArea />, "/elimination/play/e1");
    await screen.findByLabelText("Name a country or territory");
    await pressBack();
    await screen.findByRole("dialog", { name: "Leave this round?" });
    await pressBack();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(where()).toBe("/elimination/play/e1");
    expect(guarded()).toBe(true);
    expect(mocks.elimGiveUp).not.toHaveBeenCalled();
  });

  it("saves and leaves without leaving guard or sheet entries behind", async () => {
    renderArea("elimination", <EliminationArea />, "/elimination/play/e1");
    await screen.findByLabelText("Name a country or territory");
    await pressBack();
    const sheet = await screen.findByRole("dialog", { name: "Leave this round?" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save and leave" }));
    await waitFor(() => expect(where()).toBe("/elimination"));
    await settle();
    expect(guarded()).toBe(false);
    expect(overlay()).toBe(false);
    expect(mocks.elimGiveUp).not.toHaveBeenCalled();
    expect(await screen.findByRole("link", { name: /Continue Easy #1/ })).toHaveAttribute("href", "/elimination/play/e1");
  });

  it("gives up from the leave sheet after confirming and opens the results", async () => {
    const finished = view({ state: "completed", endReason: "gave_up" });
    mocks.elimGiveUp.mockResolvedValue(finished);
    renderArea("elimination", <EliminationArea />, "/elimination/play/e1");
    await screen.findByLabelText("Name a country or territory");
    await pressBack();
    const sheet = await screen.findByRole("dialog", { name: "Leave this round?" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Give up" }));
    const confirm = await screen.findByRole("dialog", { name: "Give up?" });
    mocks.elimView.mockResolvedValue(finished);
    fireEvent.click(within(confirm).getByRole("button", { name: "Give up" }));
    await waitFor(() => expect(where()).toBe("/elimination/results/e1"));
    await settle();
    expect(mocks.elimGiveUp).toHaveBeenCalledTimes(1);
    expect(guarded()).toBe(false);
    expect(overlay()).toBe(false);
  });

  it("removes the guard when the round ends on its own", async () => {
    const finished = view({ state: "completed", endReason: "time_up" });
    mocks.elimView.mockResolvedValueOnce(view({ deadlineAt: new Date(Date.now() + 150).toISOString() }));
    mocks.elimView.mockResolvedValue(finished);
    renderArea("elimination", <EliminationArea />, "/elimination/play/e1");
    await screen.findByLabelText("Name a country or territory");
    expect(guarded()).toBe(true);
    await waitFor(() => expect(where()).toBe("/elimination/results/e1"), { timeout: 4000 });
    await settle();
    expect(guarded()).toBe(false);
  });

  it("does not guard a finished round", async () => {
    mocks.elimView.mockResolvedValue(view({ state: "completed", endReason: "time_up" }));
    renderArea("elimination", <EliminationArea />, "/elimination/play/e1");
    await waitFor(() => expect(where()).toBe("/elimination/results/e1"));
    expect(guarded()).toBe(false);
  });
});
