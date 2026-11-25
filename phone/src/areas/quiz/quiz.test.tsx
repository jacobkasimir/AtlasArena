// Phone quiz area: setup (catalog-based disabled combinations, remembered setup, resume), a full round with a
// mocked server → results, timed expiry, the leave/delete sheet, and Review my mistakes (online and demo).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const api = vi.hoisted(() => ({
  dashboard: vi.fn(),
  quizCatalog: vi.fn(),
  play: vi.fn(),
  view: vi.fn(),
  answer: vi.fn(),
  next: vi.fn(),
  result: vi.fn(),
  deleteRun: vi.fn(),
  reviewSummary: vi.fn(),
  reviewStart: vi.fn(),
  reviewView: vi.fn(),
  reviewAnswer: vi.fn(),
}));
const flags = vi.hoisted(() => ({ demo: false }));
vi.mock("@shared/api", () => ({
  api,
  get isDemo() {
    return flags.demo;
  },
  DEMO_UNAVAILABLE: "ONLINE_ONLY",
}));
vi.mock("@shared/sound", () => ({ cue: vi.fn(), playSound: vi.fn(), playNotes: vi.fn() }));
// Spy on the vibration layer under useFeel so tests can count game-feel feedback by pattern.
const vibrate = vi.hoisted(() => vi.fn());
vi.mock("@shared/prefs", async (importOriginal) => ({ ...(await importOriginal<object>()), vibrate }));

import { resetPrefs, setPref } from "@shared/prefs";
import type { PlayableQuestion, Review, View } from "@shared/domain";
import { PhoneLayout } from "@phone/shell/Layout";
import { feelPattern, resetFeelCooldowns } from "@phone/ui";
import QuizArea from "./index";
import { NEXT_TAP_GUARD_MS } from "./QuizPlay";
import { availableQuestions, canFill, initialSetup, mistakesFirst, optionState, roundDots } from "./quiz-logic";

const dashboard = {
  profile: { username: "Mia", avatar: 0, favorites: [], xp: 100 },
  totals: { games: 2, correct: 15, incorrect: 5 },
  best: { classic: 820 },
  sessions: [],
};
const catalog = [
  { topic: "capitals", difficulty: "easy", kind: "mc", count: 12 },
  { topic: "flags", difficulty: "easy", kind: "mc", count: 3 },
  { topic: "capitals", difficulty: "hard", kind: "mc", count: 2 },
];

const question = (id: string, prompt: string): PlayableQuestion => ({
  id,
  prompt,
  category: "capitals",
  subcategory: "",
  difficulty: "easy",
  type: "mc",
  options: [
    { id: `${id}-a`, label: "Paris" },
    { id: `${id}-b`, label: "Lyon" },
  ],
});
const review = (questionId: string, correct: boolean): Review => ({
  questionId,
  prompt: "Capital of France?",
  chosen: correct ? "Paris" : "Lyon",
  correctAnswer: "Paris",
  correct,
  explanation: "Paris has been the capital since 987.",
  source: "",
  points: correct ? 100 : 0,
  responseMs: 1000,
  subcategory: "",
});
const stats = { score: 0, correct: 0, incorrect: 0, streak: 0, bestStreak: 0, averageMs: 0, xp: 0 };

function view(overrides: Partial<View> = {}): View {
  return {
    id: "r1",
    version: 1,
    mode: "classic",
    difficulty: "easy",
    status: "awaiting_answer",
    serverNow: new Date().toISOString(),
    deadline: null,
    current: question("q1", "Capital of France?"),
    feedback: null,
    reviews: [],
    stats,
    total: 2,
    answered: 0,
    ...overrides,
  };
}

function Where() {
  const location = useLocation();
  return <span data-testid="where">{location.pathname + location.search}</span>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<PhoneLayout />}>
          <Route path="quiz/*" element={<QuizArea />} />
          <Route path="*" element={null} />
        </Route>
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId("where").textContent;
const chip = (name: RegExp | string) => screen.getByRole("button", { name });
const wait = (ms: number) => act(() => new Promise((done) => setTimeout(done, ms)));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetPrefs();
  resetFeelCooldowns();
  flags.demo = false;
  api.dashboard.mockResolvedValue(dashboard);
  api.quizCatalog.mockResolvedValue(catalog);
});
afterEach(() => {
  cleanup();
  resetPrefs();
});

describe("quiz logic", () => {
  it("filters the catalog like arena_start", () => {
    const rows = catalog as never;
    expect(availableQuestions(rows, "classic", "all", "easy")).toBe(15);
    expect(availableQuestions(rows, "endless", "all", "medium")).toBe(2);
    expect(availableQuestions(null, "classic", "all", "easy")).toBeNull();
    expect(canFill(rows, { mode: "classic", category: "flags", difficulty: "easy", count: 10 })).toBe(false);
    expect(canFill(rows, { mode: "practice", category: "all", difficulty: "hard", count: 5 })).toBe(false);
    expect(canFill(rows, { mode: "endless", category: "all", difficulty: "hard", count: 10 })).toBe(true);
  });

  it("prefers URL parameters over the remembered setup and ignores invalid values", () => {
    const setup = initialSetup(new URLSearchParams("mode=practice&count=5"), { mode: "timed", difficulty: "hard", category: "nope" });
    expect(setup).toEqual({ mode: "practice", difficulty: "hard", category: "all", count: 5, country: undefined });
  });

  it("maps server feedback to answer states", () => {
    expect(optionState("Paris", "a", review("q1", false), "b")).toBe("missed");
    expect(optionState("Lyon", "b", review("q1", false), "b")).toBe("wrong");
    expect(optionState("Paris", "a", review("q1", true), "a")).toBe("correct");
    expect(optionState("Paris", "a", null, "a")).toBe("selected");
  });

  it("builds round dots from the server's reviews and orders mistakes first", () => {
    const v = view({ total: 4, answered: 2, reviews: [review("q1", true), review("q2", false)] });
    expect(roundDots(v)).toEqual(["correct", "wrong", "current", "upcoming"]);
    expect(roundDots({ ...v, status: "showing_feedback" })).toEqual(["correct", "wrong", "upcoming", "upcoming"]);
    const order = mistakesFirst([{ correct: true }, { correct: false }, { correct: true }, { correct: false }]);
    expect(order.map((entry) => entry.index)).toEqual([1, 3, 0, 2]);
  });
});

describe("phone quiz setup", () => {
  it("disables difficulty and topic combinations that can't fill a round", async () => {
    renderAt("/quiz");
    await screen.findByRole("button", { name: /Easy · 15/ });
    expect(chip(/Medium · 0/)).toBeDisabled();
    expect(chip(/Hard · 2/)).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Everything/ }));
    const sheet = await screen.findByRole("dialog", { name: "Choose a topic" });
    expect(within(sheet).getByRole("button", { name: /Flags · 3/ })).toBeDisabled();
    expect(within(sheet).getByRole("button", { name: /Capitals · 12/ })).toBeEnabled();
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));

    // Endless needs one question and counts harder tiers too.
    fireEvent.click(screen.getByRole("radio", { name: "Endless" }));
    expect(chip(/Hard · 2/)).toBeEnabled();
    expect(chip(/Medium · 2/)).toBeEnabled();
  });

  it("starts the round with the chosen setup, remembers it and guards double taps", async () => {
    api.play.mockReturnValue(new Promise(() => undefined));
    renderAt("/quiz");
    await screen.findByRole("button", { name: /Easy · 15/ });
    fireEvent.click(screen.getByRole("radio", { name: "Practice" }));
    expect(screen.getByRole("heading", { level: 2, name: "Practice" })).toBeInTheDocument();
    expect(screen.getByText("Practice · not ranked")).toBeInTheDocument();
    fireEvent.click(chip("5 questions"));
    const start = screen.getByRole("button", { name: "Start game" });
    fireEvent.click(start);
    fireEvent.click(start);
    expect(api.play).toHaveBeenCalledTimes(1);
    expect(api.play).toHaveBeenCalledWith("practice", [], "easy", undefined, 5);
    expect(JSON.parse(localStorage.getItem("atlas-setup-quiz") ?? "{}")).toMatchObject({ mode: "practice", count: 5 });
  });

  it("restores the remembered setup and lists rounds to resume", async () => {
    localStorage.setItem("atlas-setup-quiz", JSON.stringify({ mode: "timed", difficulty: "easy", category: "all" }));
    api.dashboard.mockResolvedValue({
      ...dashboard,
      sessions: [{ id: "s1", mode: "classic", difficulty: "easy", status: "awaiting_answer", score: 300, correct: 3, incorrect: 1, createdAt: "" }],
    });
    renderAt("/quiz");
    expect(screen.getByRole("radio", { name: "Timed" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Timed Challenge" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Resume Classic Quiz/ })).toHaveAttribute("href", "/quiz/play/s1");
  });

  it("shows a readable error when the server refuses to start", async () => {
    api.play.mockRejectedValue(new Error("This exact selection has 3 questions; 10 required."));
    renderAt("/quiz");
    await screen.findByRole("button", { name: /Easy · 15/ });
    fireEvent.click(screen.getByRole("button", { name: "Start game" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("There aren't enough questions for that combination yet.");
    expect(screen.getByRole("button", { name: "Start game" })).toBeEnabled();
  });
});

describe("phone quiz round", () => {
  it("plays a whole round against the server and shows the results", async () => {
    api.view.mockResolvedValue(view());
    let finishAnswer!: (value: View) => void;
    api.answer.mockReturnValueOnce(new Promise<View>((done) => (finishAnswer = done)));
    renderAt("/quiz/play/r1");

    const paris = await screen.findByRole("button", { name: /Paris/ });
    expect(screen.getByRole("heading", { level: 2, name: "Capital of France?" })).toBeInTheDocument();
    fireEvent.click(paris);
    fireEvent.click(paris);
    expect(api.answer).toHaveBeenCalledTimes(1);
    expect(api.answer).toHaveBeenCalledWith("r1", "q1", "q1-a");

    finishAnswer(
      view({
        version: 2,
        status: "showing_feedback",
        feedback: review("q1", true),
        reviews: [review("q1", true)],
        answered: 1,
        stats: { ...stats, score: 100, correct: 1, streak: 1 },
      }),
    );
    expect(await screen.findByRole("heading", { level: 3, name: "Correct" })).toBeInTheDocument();
    expect(screen.getByText("Paris has been the capital since 987.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Question 1 of 2" })).toHaveAttribute("aria-valuetext", "1 of 2 answered, 1 correct");

    // A tap right after the feedback appeared is ignored (accidental double tap).
    const next = screen.getByRole("button", { name: "Next question" });
    fireEvent.click(next);
    expect(api.next).not.toHaveBeenCalled();
    await wait(NEXT_TAP_GUARD_MS + 50);

    api.next.mockResolvedValueOnce(view({ version: 3, current: question("q2", "Capital of Italy?"), answered: 1, stats: { ...stats, score: 100, correct: 1, streak: 1 } }));
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Capital of Italy?" })).toBeInTheDocument();

    const done = view({
      version: 4,
      status: "completed",
      current: null,
      reviews: [review("q1", true), review("q2", false)],
      answered: 2,
      stats: { ...stats, score: 100, correct: 1, incorrect: 1, xp: 20 },
    });
    api.answer.mockResolvedValueOnce(done);
    fireEvent.click(screen.getByRole("button", { name: /Lyon/ }));
    expect(await screen.findByRole("heading", { level: 3, name: "Incorrect" })).toBeInTheDocument();
    // Seterra loop: after a miss the right answer and the explanation stay on screen.
    expect(screen.getByText("Correct answer:").parentElement).toHaveTextContent("Correct answer: Paris");
    expect(screen.getByText("Paris has been the capital since 987.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lyon.*wrong/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Paris.*Correct answer/ })).toBeInTheDocument();

    api.result.mockResolvedValue({ ...done, categories: [], country: null, questionCount: 10, contextSaved: true, previousBest: 900 });
    await wait(NEXT_TAP_GUARD_MS + 50);
    fireEvent.click(screen.getByRole("button", { name: "See results" }));
    await waitFor(() => expect(where()).toBe("/quiz/results/r1"));
    expect(await screen.findByRole("heading", { level: 2, name: "Solid run." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Quiz results" })).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    // Straight from the round: XP from the server's stats and the player's total from the dashboard.
    expect(screen.getByText("+20 XP")).toBeInTheDocument();
    const answers = screen.getAllByRole("listitem");
    expect(within(answers[0]).getByText("Incorrect")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Missed/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retry missed" })).toHaveAttribute("href", "/quiz/review");

    api.play.mockResolvedValue(view({ id: "r2" }));
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    await waitFor(() => expect(where()).toBe("/quiz/play/r2"));
    expect(api.play).toHaveBeenCalledWith("classic", [], "easy", undefined, 10);
  });

  it("asks the server for the final result when the time is up", async () => {
    const now = Date.now();
    api.view
      .mockResolvedValueOnce(
        view({ mode: "timed", total: 999, serverNow: new Date(now).toISOString(), deadline: new Date(now + 600).toISOString() }),
      )
      .mockResolvedValue(view({ mode: "timed", status: "completed", current: null, total: 999 }));
    api.result.mockReturnValue(new Promise(() => undefined));
    renderAt("/quiz/play/r1");
    expect(await screen.findByRole("timer", { name: /Time left/ })).toBeInTheDocument();
    await waitFor(() => expect(where()).toBe("/quiz/results/r1"), { timeout: 3000 });
    expect(api.view.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the countdown hidden with the calm timer until the last seconds", async () => {
    setPref("timerDisplay", "calm");
    const now = Date.now();
    api.view.mockResolvedValue(
      view({ mode: "timed", total: 999, serverNow: new Date(now).toISOString(), deadline: new Date(now + 50_000).toISOString() }),
    );
    renderAt("/quiz/play/r1");
    expect(await screen.findByRole("timer", { name: "Time left: timed round" })).toBeInTheDocument();
    expect(screen.queryByText(/\d+s$/)).toBeNull();
  });

  it("leaves a saved round or deletes it only after confirming", async () => {
    api.view.mockResolvedValue(view());
    api.deleteRun.mockResolvedValue(undefined);
    renderAt("/quiz/play/r1");
    await screen.findByRole("button", { name: /Paris/ });

    fireEvent.click(screen.getByRole("button", { name: "Pause or leave" }));
    let sheet = await screen.findByRole("dialog", { name: "Paused" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Continue playing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Pause or leave" }));
    sheet = await screen.findByRole("dialog", { name: "Paused" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Delete run" }));
    sheet = await screen.findByRole("dialog", { name: "Delete this run?" });
    expect(api.deleteRun).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole("button", { name: "Delete run" }));
    await waitFor(() => expect(where()).toBe("/quiz"));
    expect(api.deleteRun).toHaveBeenCalledWith("r1");
  });

  it("saves and leaves without deleting", async () => {
    api.view.mockResolvedValue(view());
    renderAt("/quiz/play/r1");
    await screen.findByRole("button", { name: /Paris/ });
    fireEvent.click(screen.getByRole("button", { name: "Pause or leave" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save and leave" }));
    await waitFor(() => expect(where()).toBe("/quiz"));
    expect(api.deleteRun).not.toHaveBeenCalled();
  });

  it("device Back opens the pause sheet instead of leaving, and Back again only closes it", async () => {
    api.view.mockResolvedValue(view());
    renderAt("/quiz/play/r1");
    await screen.findByRole("button", { name: /Paris/ });
    const deviceBack = () =>
      act(async () => {
        window.history.back();
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
    await deviceBack();
    expect(await screen.findByRole("dialog", { name: "Paused" })).toBeInTheDocument();
    expect(where()).toBe("/quiz/play/r1");
    await deviceBack(); // the sheet's closeOnBack and the round guard must not both react
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(where()).toBe("/quiz/play/r1");

    await deviceBack();
    const sheet = await screen.findByRole("dialog", { name: "Paused" });
    const leave = within(sheet).getByRole("button", { name: "Save and leave" });
    fireEvent.click(leave);
    fireEvent.click(leave);
    await waitFor(() => expect(where()).toBe("/quiz"));
    expect(api.deleteRun).not.toHaveBeenCalled();
  });

  it("shows a retry when the round cannot be loaded", async () => {
    api.view.mockRejectedValueOnce(new Error("Network down")).mockResolvedValue(view());
    renderAt("/quiz/play/r1");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Network down");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /Paris/ })).toBeInTheDocument();
  });
});

describe("phone review my mistakes", () => {
  it("shows the online-only state in the demo", async () => {
    api.reviewSummary.mockRejectedValue(
      new Error("ONLINE_ONLY: Review my mistakes needs an online account and isn't available in the local demo."),
    );
    renderAt("/quiz/review");
    expect(await screen.findByText(/needs an online account/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("starts a review, checks an answer on the server and shows the summary", async () => {
    api.reviewSummary.mockResolvedValue({ open: 1, byKind: { quiz: 1 }, activeId: null, cleared: 0 });
    const item = {
      position: 1, kind: "quiz" as const, prompt: "Capital of France?", options: [{ id: "a", label: "Paris" }, { id: "b", label: "Lyon" }],
      answered: false, answer: null, correct: null, solution: null, explanation: null, correctOption: null,
    };
    const session = { id: "v1", total: 1, correct: 0, answered: 0, completed: false, createdAt: "", items: [item] };
    api.reviewStart.mockResolvedValue(session);
    api.reviewView.mockResolvedValue(session);
    api.reviewAnswer.mockResolvedValue({
      ...session, correct: 1, answered: 1, completed: true,
      items: [{ ...item, answered: true, answer: "a", correct: true, solution: "Paris", correctOption: "a" }],
    });
    renderAt("/quiz/review");
    fireEvent.click(await screen.findByRole("button", { name: "Review 1 mistake" }));
    expect(screen.getByRole("heading", { level: 1, name: "Review my mistakes" })).toBeInTheDocument();
    await waitFor(() => expect(where()).toBe("/quiz/review/v1"));
    fireEvent.click(await screen.findByRole("button", { name: /Paris/ }));
    expect(await screen.findByText("Cleared – it won't come back.")).toBeInTheDocument();
    expect(api.reviewAnswer).toHaveBeenCalledWith("v1", 1, "a");
    fireEvent.click(screen.getByRole("button", { name: "See summary" }));
    expect(await screen.findByRole("heading", { level: 2, name: "1 of 1 cleared" })).toBeInTheDocument();
  });
});

describe("quiz game feel", () => {
  const calls = (pattern: number | number[]) =>
    vibrate.mock.calls.filter(([value]) => JSON.stringify(value) === JSON.stringify(pattern)).length;

  it("fires one answer feedback per server-accepted answer, with the server's streak", async () => {
    api.view.mockResolvedValue(view({ stats: { ...stats, streak: 2, correct: 2 }, answered: 0, total: 5 }));
    let finish!: (value: View) => void;
    api.answer.mockReturnValueOnce(new Promise<View>((done) => (finish = done)));
    renderAt("/quiz/play/r1");
    fireEvent.click(await screen.findByRole("button", { name: /Paris/ }));
    // Pressing an answer is only the light "select" tick; nothing right/wrong before the server answers.
    expect(calls(feelPattern("correct"))).toBe(0);
    expect(calls(feelPattern("streak", 3))).toBe(0);
    finish(
      view({
        version: 2,
        status: "showing_feedback",
        feedback: review("q1", true),
        reviews: [review("q1", true)],
        answered: 1,
        total: 5,
        stats: { ...stats, score: 300, correct: 3, streak: 3, bestStreak: 3 },
      }),
    );
    expect(await screen.findByRole("heading", { level: 3, name: "Correct" })).toBeInTheDocument();
    // Streak 3 is a milestone: the rising streak pattern instead of the plain correct one, exactly once.
    expect(calls(feelPattern("streak", 3))).toBe(1);
    expect(calls(feelPattern("correct"))).toBe(0);
    expect(await screen.findByText("3 in a row!")).toBeInTheDocument();
    expect(screen.getByText(/Streak 3, best 3/)).toBeInTheDocument();

    await wait(NEXT_TAP_GUARD_MS + 50);
    api.next.mockResolvedValueOnce(
      view({ version: 3, current: question("q2", "Capital of Italy?"), answered: 1, total: 5, stats: { ...stats, streak: 3, correct: 3 } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    await screen.findByRole("heading", { level: 2, name: "Capital of Italy?" });
    resetFeelCooldowns();
    api.answer.mockResolvedValueOnce(
      view({
        version: 4,
        status: "showing_feedback",
        current: question("q2", "Capital of Italy?"),
        feedback: review("q2", false),
        reviews: [review("q1", true), review("q2", false)],
        answered: 2,
        total: 5,
        stats: { ...stats, correct: 3, incorrect: 1, streak: 0, bestStreak: 3 },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Lyon/ }));
    expect(await screen.findByRole("heading", { level: 3, name: "Incorrect" })).toBeInTheDocument();
    expect(calls(feelPattern("wrong"))).toBe(1);
    expect(calls(feelPattern("streak", 3))).toBe(1);
  });

  it("does not fire the round-complete feedback twice (ResultHero owns it)", async () => {
    const done = view({
      status: "completed",
      current: null,
      reviews: [review("q1", true)],
      answered: 1,
      total: 1,
      stats: { ...stats, score: 100, correct: 1, xp: 20 },
    });
    api.view.mockResolvedValue(done);
    api.result.mockResolvedValue({ ...done, categories: [], country: null, questionCount: 10, contextSaved: true, previousBest: null });
    renderAt("/quiz/play/r1");
    await waitFor(() => expect(where()).toBe("/quiz/results/r1"));
    expect(await screen.findByRole("heading", { level: 2, name: "Flawless!" })).toBeInTheDocument();
    // Gold + first best → one "reward" feedback, no extra "complete".
    expect(calls(feelPattern("reward")) + calls(feelPattern("complete")) + calls(feelPattern("levelUp"))).toBe(1);
  });
});

describe("quiz results", () => {
  const result = (overrides: Partial<View> & { previousBest?: number | null } = {}) => ({
    ...view({
      status: "completed",
      current: null,
      reviews: [review("q1", true), review("q2", false), review("q3", true)],
      answered: 3,
      total: 3,
      stats: { ...stats, score: 640, correct: 2, incorrect: 1, xp: 45, bestStreak: 2 },
      ...overrides,
    }),
    categories: [],
    country: null,
    questionCount: 10,
    contextSaved: true,
    previousBest: overrides.previousBest === undefined ? 500 : overrides.previousBest,
  });

  it("shows ResultHero with the server's numbers, a new best and no XP total when opened later", async () => {
    api.result.mockResolvedValue(result());
    renderAt("/quiz/results/r1");
    expect(await screen.findByRole("heading", { level: 2, name: "Solid run." })).toBeInTheDocument();
    expect(screen.getByText("Points: 640")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByTestId("ph-new-best")).toHaveTextContent("New personal best (was 500)");
    // Not straight from the round: the XP total is unknown, so no XP bar (and no dashboard call).
    expect(screen.queryByText("+45 XP")).toBeNull();
    expect(api.dashboard).not.toHaveBeenCalled();
    expect(screen.getByText("Incorrect", { selector: "dt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play again" })).toHaveClass("ph-gbtn");
  });

  it("labels practice as not ranked and never shows a new best or XP", async () => {
    api.result.mockResolvedValue(result({ mode: "practice", previousBest: null }));
    renderAt("/quiz/results/r1");
    expect(await screen.findByText("Practice · not ranked")).toBeInTheDocument();
    expect(screen.queryByTestId("ph-new-best")).toBeNull();
    expect(screen.queryByText(/XP to level/)).toBeNull();
  });

  it("hides the retry-missed card in the demo and offers the missed list instead", async () => {
    flags.demo = true;
    api.result.mockResolvedValue(result());
    renderAt("/quiz/results/r1");
    await screen.findByRole("heading", { level: 2, name: "Solid run." });
    expect(screen.queryByRole("link", { name: "Retry missed" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "See what you missed (1)" }));
    expect(screen.getByRole("heading", { level: 2, name: /Missed/ })).toHaveFocus();
  });

  it("shows the retry-missed card online and no card when nothing was missed", async () => {
    api.result.mockResolvedValue(result());
    renderAt("/quiz/results/r1");
    expect(await screen.findByRole("link", { name: "Retry missed" })).toHaveAttribute("href", "/quiz/review");
    expect(screen.getByText("Practise the 1 you missed")).toBeInTheDocument();
    cleanup();
    api.result.mockResolvedValue(result({ reviews: [review("q1", true)], stats: { ...stats, score: 100, correct: 1 } }));
    renderAt("/quiz/results/r1");
    await screen.findByRole("heading", { level: 2, name: "Flawless!" });
    expect(screen.queryByRole("link", { name: "Retry missed" })).toBeNull();
  });
});
