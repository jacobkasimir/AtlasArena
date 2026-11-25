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
vi.mock("@shared/api", () => ({ api, isDemo: false, DEMO_UNAVAILABLE: "ONLINE_ONLY" }));
vi.mock("@shared/sound", () => ({ cue: vi.fn(), playSound: vi.fn() }));

import { resetPrefs, setPref } from "@shared/prefs";
import type { PlayableQuestion, Review, View } from "@shared/domain";
import { PhoneLayout } from "@phone/shell/Layout";
import QuizArea from "./index";
import { NEXT_TAP_GUARD_MS } from "./QuizPlay";
import { availableQuestions, canFill, initialSetup, optionState } from "./quiz-logic";

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
    fireEvent.click(chip("Endless"));
    expect(chip(/Hard · 2/)).toBeEnabled();
    expect(chip(/Medium · 2/)).toBeEnabled();
  });

  it("starts the round with the chosen setup, remembers it and guards double taps", async () => {
    api.play.mockReturnValue(new Promise(() => undefined));
    renderAt("/quiz");
    await screen.findByRole("button", { name: /Easy · 15/ });
    fireEvent.click(chip("Practice"));
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
    expect(chip("Timed Challenge")).toHaveAttribute("aria-pressed", "true");
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
    expect(await screen.findByRole("heading", { level: 3, name: "Not quite" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lyon.*wrong/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Paris.*Correct answer/ })).toBeInTheDocument();

    api.result.mockResolvedValue({ ...done, categories: [], country: null, questionCount: 10, contextSaved: true, previousBest: 900 });
    await wait(NEXT_TAP_GUARD_MS + 50);
    fireEvent.click(screen.getByRole("button", { name: "See results" }));
    await waitFor(() => expect(where()).toBe("/quiz/results/r1"));
    expect(await screen.findByRole("heading", { level: 2, name: "Solid run." })).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    const answers = screen.getAllByRole("listitem");
    expect(within(answers[0]).getByText("Mistake")).toBeInTheDocument();

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
    expect(await screen.findByRole("progressbar", { name: "Time left" })).toBeInTheDocument();
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
    expect(await screen.findByText("The countdown appears for the last 10 seconds")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "Time left" })).toBeNull();
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
    await waitFor(() => expect(where()).toBe("/quiz/review/v1"));
    fireEvent.click(await screen.findByRole("button", { name: /Paris/ }));
    expect(await screen.findByText("Cleared – it won't come back.")).toBeInTheDocument();
    expect(api.reviewAnswer).toHaveBeenCalledWith("v1", 1, "a");
    fireEvent.click(screen.getByRole("button", { name: "See summary" }));
    expect(await screen.findByRole("heading", { level: 2, name: "1 of 1 cleared" })).toBeInTheDocument();
  });
});
