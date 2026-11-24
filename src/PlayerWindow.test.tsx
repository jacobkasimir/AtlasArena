import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PlayerWindow, { formatPlayTime, levelProgress, type PlayerIdentity } from "./PlayerWindow";
import type { Dashboard, Leaderboard } from "./domain";

const mocks = vi.hoisted(() => ({
  dashboard: vi.fn(),
  leaderboard: vi.fn(),
  gameStats: vi.fn(),
  personalBests: vi.fn(),
  achievements: vi.fn(),
  saveProfile: vi.fn(),
}));

vi.mock("./api", () => ({
  isDemo: false,
  supabase: null,
  configurationError: null,
  DEMO_UNAVAILABLE: "ONLINE_ONLY",
  api: mocks,
}));

const dashboard: Dashboard = {
  profile: { username: "Jacob", avatar: 0, favorites: [], xp: 1730 },
  totals: { games: 12, correct: 90, incorrect: 30 },
  best: { classic: 820 },
  sessions: [
    { id: "s1", mode: "classic", difficulty: "easy", status: "completed", score: 800, correct: 9, incorrect: 1, createdAt: "2026-11-20T10:00:00Z" },
  ],
};

const board: Leaderboard = {
  period: "all",
  totalPlayers: 30,
  currentRank: 5,
  players: [],
  you: {
    rank: 5, username: "Jacob", avatar: 0, xp: 1730, points: 1730, level: 4, games: 12, accuracy: 75,
    bestStreak: 14, dailyStreak: 3, lastPlayedAt: null, isYou: true,
  },
  ahead: null,
};

const stat = { rounds: 2, correct: 30, answered: 40, timeMs: 600_000, lastPlayedAt: null, places: 25 };
const identity: PlayerIdentity = { username: "Jacob", avatar: 0, isAnonymous: false, isAdmin: false, userId: "u1" };

beforeEach(() => {
  mocks.dashboard.mockResolvedValue(dashboard);
  mocks.leaderboard.mockResolvedValue(board);
  mocks.gameStats.mockResolvedValue({ flags: stat, capitals: stat, recall: stat });
  mocks.personalBests.mockResolvedValue([]);
  mocks.achievements.mockRejectedValue(new Error("ONLINE_ONLY: Achievements needs an online account."));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function open(props: Partial<Parameters<typeof PlayerWindow>[0]> = {}) {
  const onClose = vi.fn();
  const view = render(
    <MemoryRouter>
      <PlayerWindow
        identity={identity}
        confirming={false}
        setConfirming={() => {}}
        message=""
        onProfileUpdated={() => {}}
        onClose={onClose}
        onConfirm={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
  return { ...view, onClose };
}

const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(name) });

it("computes level progress and play time", () => {
  expect(levelProgress(1730)).toEqual({ level: 4, into: 230, needed: 270, percent: 46 });
  expect(levelProgress(-5)).toMatchObject({ level: 1, into: 0 });
  expect(formatPlayTime(0)).toBe("—");
  expect(formatPlayTime(125 * 60_000)).toBe("2h 05m");
});

it("shows the player header with level, XP, streak and rank", async () => {
  open();
  const dialog = screen.getByRole("dialog", { name: "Jacob" });
  expect(await within(dialog).findByText("Level 4")).toBeInTheDocument();
  expect(within(dialog).getByRole("progressbar", { name: "Progress to level 5" })).toHaveAttribute("aria-valuenow", "230");
  expect(await within(dialog).findByText("#5")).toBeInTheDocument();
  const chips = within(dialog).getByRole("list", { name: "Streak and rank" });
  expect(chips).toHaveTextContent("3 day streak");
  expect(chips).toHaveTextContent("14 best answer streak");
  expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByText(/Achievements are tracked with an online account/)).toBeInTheDocument();
});

it("switches sections with number keys, arrow keys and clicks", async () => {
  open();
  await screen.findByText("Level 4");
  fireEvent.keyDown(window, { key: "2" });
  expect(tab("Statistics")).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Flags");

  fireEvent.keyDown(tab("Statistics"), { key: "ArrowDown" });
  expect(tab("Profile")).toHaveAttribute("aria-selected", "true");
  expect(tab("Profile")).toHaveFocus();

  // Typing digits into the username field must not switch sections.
  const input = await screen.findByLabelText(/Username/);
  fireEvent.keyDown(input, { key: "3" });
  expect(tab("Profile")).toHaveAttribute("aria-selected", "true");

  fireEvent.keyDown(window, { key: "4" });
  expect(tab("Appearance")).toHaveAttribute("aria-selected", "true");
  fireEvent.click(tab("Overview"));
  expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
});

it("closes with Escape and gives focus back to the trigger", async () => {
  const trigger = document.createElement("button");
  document.body.appendChild(trigger);
  trigger.focus();
  const { onClose, unmount } = open();
  await screen.findByText("Level 4");
  expect(tab("Overview")).toHaveFocus();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  act(() => unmount());
  expect(trigger).toHaveFocus();
  trigger.remove();
});

it("asks before signing out and returns to the window on cancel", async () => {
  function Harness() {
    const [confirming, setConfirming] = useState(false);
    return (
      <MemoryRouter>
        <PlayerWindow
          identity={identity}
          confirming={confirming}
          setConfirming={setConfirming}
          message=""
          onProfileUpdated={() => {}}
          onClose={() => {}}
          onConfirm={() => {}}
        />
      </MemoryRouter>
    );
  }
  render(<Harness />);
  await screen.findByText("Level 4");
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  const confirm = screen.getByRole("alertdialog", { name: "Sign out of Atlas Arena?" });
  expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Jacob" })).toBeInTheDocument();
});
