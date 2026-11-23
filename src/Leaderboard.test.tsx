import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import LeaderboardDialog, { LeaderboardBody, activeLabel } from "./Leaderboard";
import type { Leaderboard, LeaderboardPlayer } from "./domain";

const leaderboard = vi.fn();
vi.mock("./api", () => ({ isDemo: false, api: { leaderboard: (period: string) => leaderboard(period) } }));
afterEach(() => { cleanup(); leaderboard.mockReset(); });

const player = (rank: number, username: string, xp: number, extra: Partial<LeaderboardPlayer> = {}): LeaderboardPlayer => ({
  rank, username, avatar: 0, xp, points: xp, level: 1 + Math.floor(xp / 500), games: 4, accuracy: 80,
  bestStreak: 10, dailyStreak: 0, lastPlayedAt: new Date().toISOString(), isYou: false, ...extra,
});

const you = player(5, "Jacob", 790, { bestStreak: 20, dailyStreak: 3, accuracy: 87, games: 6, isYou: true });
const board: Leaderboard = {
  period: "all", totalPlayers: 30, currentRank: 5,
  players: [player(1, "Ana", 2210, { bestStreak: 28 }), player(2, "Ben", 1500), player(3, "Cleo", 900), player(4, "Dan", 800), you],
  you, ahead: { rank: 4, username: "Dan", gap: 11 },
};

it("shows the podium, the ranked list with level and streaks, and your pinned standing", () => {
  render(<LeaderboardBody board={board} />);
  const top = screen.getByRole("list", { name: "Top three" });
  expect(within(top).getByText("Ana")).toBeInTheDocument();
  expect(within(top).getByText("🔥 28")).toBeInTheDocument();
  const rest = screen.getByRole("list", { name: "Ranks 4 to 25" });
  expect(within(rest).getAllByRole("listitem")).toHaveLength(2);
  const mine = screen.getByRole("region", { name: "Your standing" });
  expect(within(mine).getByText("#5")).toBeInTheDocument();
  expect(within(mine).getByText("of 30")).toBeInTheDocument();
  expect(within(mine).getByText("Lv 2")).toBeInTheDocument();
  expect(mine).toHaveTextContent("Earn 11 XP to pass Dan for #4.");
  expect(mine).toHaveTextContent("20 best streak");
  expect(mine).toHaveTextContent("3 daily streak");
  expect(screen.getByText("Showing the top 5 of 30 ranked players.")).toBeInTheDocument();
});

it("explains how to join when you are not ranked yet", () => {
  const unranked = { ...you, rank: null, points: 0 };
  render(<LeaderboardBody board={{ ...board, period: "week", currentRank: null, you: unranked, ahead: null }} />);
  expect(screen.getByText(/Finish a scored quiz game this week/)).toBeInTheDocument();
});

it("switches between all-time and weekly rankings", async () => {
  leaderboard.mockResolvedValue(board);
  render(<LeaderboardDialog onClose={() => {}} />);
  expect(await screen.findByText("Earn", { exact: false })).toBeInTheDocument();
  expect(leaderboard).toHaveBeenLastCalledWith("all");
  fireEvent.click(screen.getByRole("button", { name: "This week" }));
  expect(leaderboard).toHaveBeenLastCalledWith("week");
  expect(screen.getByRole("button", { name: "This week" })).toHaveAttribute("aria-pressed", "true");
});

it("labels how recently a player was active", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  expect(activeLabel(null, now)).toBe("Not played yet");
  expect(activeLabel("2026-11-23T08:00:00Z", now)).toBe("Active today");
  expect(activeLabel("2026-11-22T08:00:00Z", now)).toBe("Active yesterday");
  expect(activeLabel("2026-11-13T08:00:00Z", now)).toBe("Active 10d ago");
});
