// Phone Profile and Settings: loading/error/retry, guest and demo states, leaderboard sheet, edit profile,
// sign-out and delete confirmations, and settings persistence/reset.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const mode = vi.hoisted(() => ({ demo: false }));
const api = vi.hoisted(() => ({
  dashboard: vi.fn(),
  leaderboard: vi.fn(),
  currentUser: vi.fn(),
  gameStats: vi.fn(),
  personalBests: vi.fn(),
  elimCatalog: vi.fn(),
  achievements: vi.fn(),
  saveProfile: vi.fn(),
  exportData: vi.fn(),
  signOut: vi.fn(),
  deleteAccount: vi.fn(),
  guest: vi.fn(),
}));
vi.mock("@shared/api", () => ({
  api,
  get isDemo() {
    return mode.demo;
  },
  DEMO_UNAVAILABLE: "ONLINE_ONLY",
}));
vi.mock("@shared/sound", () => ({ cue: vi.fn(), playSound: vi.fn(), playNotes: vi.fn() }));
vi.mock("@shared/components", async (original) => ({
  ...(await original<typeof import("@shared/components")>()),
  download: vi.fn(),
}));

import { download } from "@shared/components";
import { getPrefs, resetPrefs } from "@shared/prefs";
import { getPhonePrefs, reloadPhonePrefs, setPhonePref } from "@phone/prefs-phone";
import { feelPattern, resetFeelCooldowns } from "@phone/ui";
import { PhoneLayout } from "@phone/shell/Layout";
import ProfileArea from "./profile";
import SettingsArea from "./settings";

const dashboard = {
  profile: { username: "Mia", avatar: 0, favorites: ["flags"], xp: 1240 },
  totals: { games: 4, correct: 30, incorrect: 10 },
  best: { classic: 820 },
  sessions: [],
};
const board = {
  period: "all",
  players: [{ rank: 1, username: "Mia", avatar: 0, xp: 1240, points: 1240, level: 3, bestStreak: 5, dailyStreak: 2, isYou: true }],
  you: { rank: 1, username: "Mia", avatar: 0, xp: 1240, points: 1240, level: 3, bestStreak: 5, dailyStreak: 2, isYou: true },
  ahead: null,
  totalPlayers: 1,
};
const stat = { rounds: 2, correct: 15, answered: 20, timeMs: 61000, lastPlayedAt: null, places: 12 };
const onlineOnly = (feature: string) =>
  Promise.reject(new Error(`ONLINE_ONLY: ${feature} needs an online account and isn't available in the local demo.`));

function Where() {
  const location = useLocation();
  return <span data-testid="where">{location.pathname + location.search}</span>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<PhoneLayout />}>
          <Route path="profile/*" element={<ProfileArea />} />
          <Route path="settings/*" element={<SettingsArea />} />
          <Route path="*" element={null} />
        </Route>
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId("where").textContent;

let vibrate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetFeelCooldowns();
  vibrate = vi.fn();
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
  resetPrefs();
  reloadPhonePrefs();
  mode.demo = false;
  api.dashboard.mockResolvedValue(dashboard);
  api.leaderboard.mockResolvedValue(board);
  api.currentUser.mockResolvedValue({ id: "u1", isAnonymous: false, email: "mia@example.com" });
  api.gameStats.mockResolvedValue({ flags: stat, capitals: stat, recall: stat });
  api.personalBests.mockResolvedValue([]);
  api.elimCatalog.mockResolvedValue([]);
  api.achievements.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  resetPrefs();
});

describe("phone Profile", () => {
  it("shows the player card with level, XP and rank", async () => {
    renderAt("/profile");
    expect(await screen.findByText("Mia")).toBeInTheDocument();
    expect(screen.getByText(/Level 3 · 1,240 XP/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /Level 3: 240 of 500 XP/ })).toBeInTheDocument();
    expect(await screen.findByText("#1")).toBeInTheDocument();
  });

  it("shows an error with retry and loads again", async () => {
    api.dashboard.mockRejectedValueOnce(new Error("Network down"));
    renderAt("/profile");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Network down");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Mia")).toBeInTheDocument();
  });

  it("offers guests an account upgrade", async () => {
    api.currentUser.mockResolvedValue({ id: "u1", isAnonymous: true, email: null });
    renderAt("/profile");
    expect(await screen.findByText("You're playing as a guest")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/sign-in?mode=link");
  });

  it("explains the local demo and keeps achievements online-only", async () => {
    mode.demo = true;
    api.achievements.mockImplementation(() => onlineOnly("Achievements"));
    renderAt("/profile");
    expect(await screen.findByText(/Local demo: your progress stays in this browser/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create an account" })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: /Achievements/ }));
    expect(await screen.findByText(/Achievements need an online account/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens the leaderboard sheet at /profile/leaderboard and closing returns to /profile", async () => {
    renderAt("/profile");
    fireEvent.click(await screen.findByRole("button", { name: /Leaderboard/ }));
    await waitFor(() => expect(where()).toBe("/profile/leaderboard"));
    const sheet = await screen.findByRole("dialog", { name: "Leaderboard" });
    expect(await within(sheet).findByRole("list", { name: "Ranking" })).toBeInTheDocument();
    const week = within(sheet).getByRole("radio", { name: "This week" });
    fireEvent.click(week);
    expect(week).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(api.leaderboard).toHaveBeenCalledWith("week"));
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(where()).toBe("/profile"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the leaderboard sheet from a direct link (Home) and closes to /profile", async () => {
    renderAt("/profile/leaderboard");
    const sheet = await screen.findByRole("dialog", { name: "Leaderboard" });
    expect(await within(sheet).findByRole("list", { name: "Ranking" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(where()).toBe("/profile"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Mia")).toBeInTheDocument();
  });

  it("pins your own row with the gap to the next player when you're outside the top list", async () => {
    const you = { rank: 12, username: "Mia", avatar: 0, xp: 300, points: 300, level: 1, bestStreak: 4, dailyStreak: 1, isYou: true };
    api.leaderboard.mockResolvedValue({
      ...board,
      players: [{ ...board.players[0], username: "Ana", isYou: false, points: 5000 }],
      you,
      ahead: { rank: 11, username: "Ben", gap: 40 },
      totalPlayers: 30,
    });
    renderAt("/profile/leaderboard");
    const sheet = await screen.findByRole("dialog", { name: "Leaderboard" });
    const pinned = await within(sheet).findByRole("group", { name: "Your standing" });
    expect(pinned).toHaveTextContent("#12");
    expect(within(pinned).getByText("You")).toBeInTheDocument();
    expect(pinned).toHaveTextContent("#12 of 30 · Earn 40 XP to pass Ben for #11.");
    // The pinned row sits outside the scrolling ranking list.
    expect(within(within(sheet).getByRole("list", { name: "Ranking" })).queryByText("Mia")).toBeNull();
  });

  it("opens an achievement's detail sheet with its progress", async () => {
    api.achievements.mockResolvedValue([
      { id: "a1", category: "quiz", tier: "gold", icon: "trophy", title: "Quiz master", description: "Finish 10 quiz games.", current: 4, target: 10, earned: false },
      { id: "a2", category: "flags", tier: "bronze", icon: "flag", title: "First flag", description: "Finish a Flags round.", current: 1, target: 1, earned: true },
    ]);
    renderAt("/profile/achievements");
    fireEvent.click(await screen.findByRole("button", { name: "Quiz master, Gold. Locked, 4 of 10" }));
    let sheet = await screen.findByRole("dialog", { name: "Quiz master" });
    expect(sheet).toHaveTextContent("Finish 10 quiz games.");
    expect(within(sheet).getByRole("progressbar", { name: "Progress" })).toHaveAttribute("aria-valuenow", "4");
    expect(sheet).toHaveTextContent("6 to go");
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "First flag, Bronze. Earned" }));
    sheet = await screen.findByRole("dialog", { name: "First flag" });
    expect(within(sheet).getByRole("status")).toHaveTextContent("Earned – nice work!");
    expect(within(sheet).queryByRole("progressbar")).toBeNull();
  });

  it("shows statistics for all five games", async () => {
    mode.demo = true;
    api.elimCatalog.mockImplementation(() => onlineOnly("Category Elimination"));
    renderAt("/profile/statistics");
    for (const name of ["Quiz", "Flags", "Capitals", "Recall", "Elimination"]) {
      expect(await screen.findByRole("heading", { level: 3, name })).toBeInTheDocument();
    }
    expect(await screen.findByText(/Elimination needs an online account/)).toBeInTheDocument();
  });

  it("validates and saves the edited profile", async () => {
    api.saveProfile.mockResolvedValue(undefined);
    renderAt("/profile/edit");
    const name = await screen.findByLabelText("Username");
    const save = screen.getByRole("button", { name: "Save profile" });
    expect(save).toBeDisabled();
    fireEvent.change(name, { target: { value: "M" } });
    fireEvent.blur(name);
    expect(screen.getAllByRole("alert").some((node) => node.textContent?.includes("Use 2–24 characters"))).toBe(true);
    fireEvent.change(name, { target: { value: "Mia R" } });
    fireEvent.click(screen.getByRole("button", { name: "Capitals" }));
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith({ username: "Mia R", avatar: 0, favorites: ["flags", "capitals"] }));
    await waitFor(() => expect(where()).toBe("/profile"));
  });
});

describe("phone Account & data", () => {
  it("signs out only after confirming", async () => {
    api.signOut.mockResolvedValue(undefined);
    renderAt("/profile/account");
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    const sheet = await screen.findByRole("dialog", { name: "Sign out?" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.signOut).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(where()).toBe("/welcome"));
    expect(api.signOut).toHaveBeenCalledTimes(1);
  });

  it("deletes the account only after typing DELETE", async () => {
    api.deleteAccount.mockResolvedValue(undefined);
    renderAt("/profile/account");
    fireEvent.click(await screen.findByRole("button", { name: "Delete account" }));
    const sheet = await screen.findByRole("dialog", { name: "Delete account?" });
    const confirm = within(sheet).getByRole("button", { name: "Delete forever" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(sheet).getByLabelText("Type DELETE to confirm"), { target: { value: "delete" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(sheet).getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(where()).toBe("/welcome"));
    expect(api.deleteAccount).toHaveBeenCalledTimes(1);
  });

  it("keeps the sheet open and shows the error when deleting fails", async () => {
    api.deleteAccount.mockRejectedValue(new Error("Edge function failed"));
    renderAt("/profile/account");
    fireEvent.click(await screen.findByRole("button", { name: "Delete account" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Delete forever" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Could not delete your account: Edge function failed");
    expect(where()).toBe("/profile/account");
  });

  it("hides sign out for guests and in the demo, and downloads the data", async () => {
    mode.demo = true;
    api.currentUser.mockResolvedValue({ id: "demo", isAnonymous: true, email: null });
    api.exportData.mockResolvedValue({ profile: {} });
    renderAt("/profile/account");
    expect(await screen.findByRole("button", { name: "Delete demo data" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download my data" }));
    await waitFor(() => expect(download).toHaveBeenCalledWith("atlas-data.json", { profile: {} }));
  });
});

describe("phone Settings", () => {
  it("plays the haptics map from the Try it buttons", async () => {
    renderAt("/settings");
    const tryIt = await screen.findByRole("group", { name: "Try it" });
    const expected: [string, number | number[]][] = [
      ["Tap", feelPattern("tap")],
      ["Correct", feelPattern("correct")],
      ["Streak", feelPattern("streak", 5)],
      ["Wrong", feelPattern("wrong")],
      ["Timer warning", feelPattern("timerWarning")],
      ["Level up", feelPattern("levelUp")],
      ["Reward", feelPattern("reward")],
    ];
    for (const [label, pattern] of expected) {
      vibrate.mockClear();
      resetFeelCooldowns();
      fireEvent.click(within(tryIt).getByRole("button", { name: label }));
      expect(vibrate, label).toHaveBeenCalledWith(pattern);
    }
  });

  it("disables the Try it buttons when vibration and sound are both off", async () => {
    renderAt("/settings");
    fireEvent.click(await screen.findByRole("switch", { name: /Vibration/ }));
    fireEvent.click(screen.getByRole("switch", { name: /Sound effects/ }));
    const tryIt = screen.getByRole("group", { name: "Try it" });
    expect(within(tryIt).getByRole("button", { name: "Correct" })).toBeDisabled();
  });

  it("saves switches and choices on the device", async () => {
    renderAt("/settings");
    const auto = await screen.findByRole("switch", { name: /Continue automatically/ });
    expect(auto).toHaveAttribute("aria-checked", "false");
    fireEvent.click(auto);
    expect(auto).toHaveAttribute("aria-checked", "true");
    expect(getPrefs().autoContinue).toBe(true);
    expect(JSON.parse(localStorage.getItem("atlas-prefs") ?? "{}")).toMatchObject({ autoContinue: true });

    fireEvent.click(screen.getByRole("radio", { name: "Grid" }));
    expect(getPhonePrefs().answerLayout).toBe("grid");
    fireEvent.click(screen.getByRole("radio", { name: "Larger" }));
    expect(getPrefs().textSize).toBe("larger");
  });

  it("resets to defaults and forgets saved setups", async () => {
    setPhonePref("answerLayout", "grid");
    renderAt("/settings");
    fireEvent.click(await screen.findByRole("switch", { name: /Sound effects/ }));
    expect(getPrefs().sound).toBe(false);

    // (src/test-setup.ts's localStorage mock has no enumerable keys, so clearSavedSetups can't be observed here.)
    fireEvent.click(screen.getByRole("button", { name: "Forget saved setups" }));
    let sheet = await screen.findByRole("dialog", { name: "Forget saved setups?" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Forget setups" }));
    expect(screen.getByText("Saved game setups were forgotten.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    sheet = await screen.findByRole("dialog", { name: "Reset settings to defaults?" });
    expect(getPrefs().sound).toBe(false);
    fireEvent.click(within(sheet).getByRole("button", { name: "Reset settings" }));
    expect(getPrefs().sound).toBe(true);
    expect(getPhonePrefs().answerLayout).toBe("list");
    expect(screen.getByText("Settings were reset to their defaults.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset to defaults" })).toBeDisabled();
  });

  it("asks before resetting: Cancel has focus first and changes nothing", async () => {
    setPhonePref("answerLayout", "grid");
    renderAt("/settings");
    fireEvent.click(await screen.findByRole("switch", { name: /Sound effects/ }));
    const reset = screen.getByRole("button", { name: "Reset to defaults" });
    reset.focus();
    fireEvent.click(reset);
    const sheet = await screen.findByRole("dialog", { name: "Reset settings to defaults?" });
    expect(sheet).toHaveTextContent("Your colour theme, saved setups, progress and account are kept.");
    const cancel = within(sheet).getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveFocus();
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(getPrefs().sound).toBe(false);
    expect(getPhonePrefs().answerLayout).toBe("grid");
    expect(reset).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Forget saved setups" }));
    const forget = await screen.findByRole("dialog", { name: "Forget saved setups?" });
    expect(within(forget).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("Saved game setups were forgotten.")).toBeNull();
  });
});
