import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const api = vi.hoisted(() => ({
  dashboard: vi.fn(),
  flagsSetup: vi.fn(),
  capitalsSetup: vi.fn(),
  recallSetup: vi.fn(),
  elimCatalog: vi.fn(),
  personalBests: vi.fn(),
  gameStats: vi.fn(),
  dailyStatus: vi.fn(),
  dailyStart: vi.fn(),
  reviewSummary: vi.fn(),
  achievements: vi.fn(),
}));
vi.mock("@shared/api", () => ({ api, isDemo: false, DEMO_UNAVAILABLE: "ONLINE_ONLY" }));

import Home from "./index";
import Games from "./Games";
import { continueItems, dailyPlan, loadHome, primaryAction } from "./data";

const onlineOnly = (feature: string) =>
  Promise.reject(new Error(`ONLINE_ONLY: ${feature} needs an online account and isn't available in the local demo.`));

const dashboard = {
  profile: { username: "Mia", avatar: 0, favorites: [], xp: 1240 },
  totals: { games: 4, correct: 30, incorrect: 10 },
  best: { classic: 820 },
  sessions: [],
};
const stat = { rounds: 2, correct: 15, answered: 20, timeMs: 1000, lastPlayedAt: null, places: 12 };
const daily = {
  day: "2026-11-24", available: true, sessionId: null, state: null, score: null, correct: null, rank: null,
  players: 3, streak: { current: 4, best: 9 }, top: [],
};

/** Online account with nothing in progress. */
function online() {
  api.dashboard.mockResolvedValue(dashboard);
  api.flagsSetup.mockResolvedValue({ activeSessions: [] });
  api.capitalsSetup.mockResolvedValue({ activeSessions: [] });
  api.recallSetup.mockResolvedValue({ activeSessions: [], catalog: [], recalled: { countries: [], capitals: [] }, bests: [] });
  api.elimCatalog.mockResolvedValue([]);
  api.personalBests.mockResolvedValue([]);
  api.gameStats.mockResolvedValue({ flags: stat, capitals: stat, recall: stat });
  api.dailyStatus.mockResolvedValue(daily);
  api.reviewSummary.mockResolvedValue({ open: 3, byKind: { quiz: 3 }, activeId: null, cleared: 1 });
  api.achievements.mockResolvedValue([
    { id: "a", category: "quiz", tier: "bronze", icon: "x", title: "First steps", description: "", current: 1, target: 1, earned: true },
    { id: "b", category: "quiz", tier: "silver", icon: "x", title: "Ten games", description: "", current: 4, target: 10, earned: false },
  ]);
}

/** Local demo: the server-only features reject with ONLINE_ONLY. */
function demo() {
  online();
  api.dailyStatus.mockImplementation(() => onlineOnly("The daily challenge"));
  api.dailyStart.mockImplementation(() => onlineOnly("The daily challenge"));
  api.reviewSummary.mockImplementation(() => onlineOnly("Review my mistakes"));
  api.achievements.mockImplementation(() => onlineOnly("Achievements"));
  api.elimCatalog.mockImplementation(() => onlineOnly("Category Elimination"));
}

function Where() {
  const location = useLocation();
  return <span data-testid="where">{location.pathname + location.search}</span>;
}

function renderAt(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/games" element={<Games />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const actionBar = () => screen.getByRole("group", { name: "Main action" });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(cleanup);

describe("phone Home", () => {
  it("shows a skeleton while loading, then the greeting, level and streak", async () => {
    online();
    let resolve!: (value: unknown) => void;
    api.dashboard.mockReturnValue(new Promise((done) => (resolve = done)));
    renderAt();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your home…");
    resolve(dashboard);
    expect(await screen.findByRole("heading", { level: 2, name: "Hi, Mia" })).toBeInTheDocument();
    expect(screen.getByText("Level 3")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Level 3: 240 of 500 XP" })).toBeInTheDocument();
    expect(screen.getByText("4-day streak")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Flags.*15 rounds|Flags.*2 rounds · 75% correct · 12 flags known/ })).toHaveAttribute("href", "/flags");
  });

  it("shows an error with retry when the home cannot be loaded", async () => {
    online();
    api.dashboard.mockRejectedValueOnce(new Error("Network down"));
    renderAt();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your home could not be loaded: Network down");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Hi, Mia" })).toBeInTheDocument();
    expect(api.dashboard).toHaveBeenCalledTimes(2);
  });

  it("shows the online-only state for Daily, Review and Achievements in the demo", async () => {
    demo();
    renderAt();
    await screen.findByRole("heading", { level: 2, name: "Hi, Mia" });
    const daily = screen.getByRole("article", { name: "Daily challenge" });
    const review = screen.getByRole("article", { name: "Review my mistakes" });
    const achievements = screen.getByRole("article", { name: "Achievements" });
    for (const card of [daily, review, achievements]) {
      expect(within(card).getByRole("status")).toHaveTextContent("Needs an online account – not available in the local demo.");
      // The error live region stays mounted (empty) so later errors are announced.
      expect(within(card).queryByRole("alert")?.textContent ?? "").toBe("");
    }
    expect(within(daily).queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: /Elimination.*Needs an online account/ })).toBeInTheDocument();
    expect(within(actionBar()).getByRole("link", { name: "Choose a game" })).toHaveAttribute("href", "/games");
  });

  it("lists running rounds of every game and continues one", async () => {
    online();
    api.dashboard.mockResolvedValue({
      ...dashboard,
      sessions: [{ id: "q1", mode: "classic", difficulty: "easy", status: "awaiting_answer", score: 200, correct: 2, incorrect: 1, createdAt: "" }],
    });
    api.flagsSetup.mockResolvedValue({
      activeSessions: [{ id: "f1", direction: "flag_to_country", region: "Europe", poolTier: "all", total: 20, answered: 5, score: 50, createdAt: "", paused: false, scope: "un" }],
    });
    renderAt();
    const list = await screen.findByRole("list", { name: "Rounds in progress" });
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/quiz/play/q1");
    expect(within(list).getByRole("progressbar", { name: "5 of 20 done" })).toBeInTheDocument();
    expect(within(actionBar()).getByRole("link", { name: "Continue Quiz" })).toHaveAttribute("href", "/quiz/play/q1");
    fireEvent.click(links[1]);
    expect(screen.getByTestId("where")).toHaveTextContent("/flags/play/f1");
  });

  it("starts today's challenge from the bottom bar and opens it in the quiz area", async () => {
    online();
    api.dailyStart.mockResolvedValue({ id: "d1" });
    renderAt();
    await screen.findByRole("heading", { level: 2, name: "Hi, Mia" });
    fireEvent.click(within(actionBar()).getByRole("button", { name: "Play today's challenge" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/quiz/play/d1"));
    expect(api.dailyStart).toHaveBeenCalledTimes(1);
  });

  it("explains when today's challenge cannot start", async () => {
    online();
    api.dailyStart.mockRejectedValue(new Error("DAILY_NOT_ENOUGH"));
    renderAt();
    const daily = await screen.findByRole("article", { name: "Daily challenge" });
    fireEvent.click(within(daily).getByRole("button", { name: "Play today's challenge" }));
    expect(await within(daily).findByRole("alert")).toHaveTextContent("Not enough published questions for today's challenge yet.");
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/);
  });

  it("opens Review my mistakes and the achievements in the phone app", async () => {
    online();
    renderAt();
    const review = await screen.findByRole("article", { name: "Review my mistakes" });
    expect(within(review).getByRole("link", { name: "Review 3 mistakes" })).toHaveAttribute("href", "/quiz/review");
    const achievements = screen.getByRole("article", { name: "Achievements" });
    expect(within(achievements).getByRole("link", { name: "All achievements" })).toHaveAttribute("href", "/profile/achievements");
  });

  it("refreshes without dropping back to the skeleton", async () => {
    online();
    renderAt();
    await screen.findByRole("heading", { level: 2, name: "Hi, Mia" });
    api.dashboard.mockResolvedValue({ ...dashboard, profile: { ...dashboard.profile, username: "Mia R" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(screen.getByRole("heading", { level: 2, name: "Hi, Mia" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 2, name: "Hi, Mia R" })).toBeInTheDocument();
  });
});

describe("phone Games", () => {
  it("links every game to its setup and shows rounds in progress", async () => {
    online();
    api.recallSetup.mockResolvedValue({
      activeSessions: [{ id: "r1", kind: "countries", scope: "un", region: null, size: null, timeLimitSeconds: null, total: 193, found: 20, createdAt: "", deadlineAt: null }],
      catalog: [], recalled: { countries: [], capitals: [] }, bests: [],
    });
    renderAt("/games");
    for (const [name, href] of [["Quiz", "/quiz"], ["Flags", "/flags"], ["Capitals", "/capitals"], ["Recall", "/recall"], ["Elimination", "/elimination"]]) {
      expect(screen.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute("href", href);
    }
    expect(screen.getByRole("link", { name: "Timed" })).toHaveAttribute("href", "/quiz?mode=timed");
    expect(await screen.findByText("1 round in progress")).toBeInTheDocument();
  });

  it("still lists the games when progress cannot be loaded", async () => {
    online();
    api.dashboard.mockRejectedValue(new Error("offline"));
    renderAt("/games");
    expect(await screen.findByText("Your progress could not be loaded. The games still work.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Flags/ })).toHaveAttribute("href", "/flags");
  });
});

describe("home data", () => {
  it("prefers a running daily challenge, then other rounds, then today's challenge", async () => {
    online();
    const data = await loadHome();
    expect(dailyPlan(data.daily).kind).toBe("start");
    expect(primaryAction(data)).toEqual({ kind: "daily-start", label: "Play today's challenge" });
    const running = { ...data, daily: { state: "ok" as const, value: { ...daily, sessionId: "d9", state: "awaiting_answer" as const } } };
    expect(primaryAction(running)).toEqual({ kind: "link", label: "Continue today's challenge", to: "/quiz/play/d9" });
    expect(continueItems(data)).toEqual([]);
  });

  it("keeps a broken optional part as an error, not as online-only", async () => {
    online();
    api.flagsSetup.mockRejectedValue(new Error("boom"));
    const data = await loadHome();
    expect(data.flags).toEqual({ state: "error", message: "boom" });
  });
});
