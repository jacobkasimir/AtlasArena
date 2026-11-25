import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FlagsChoice, FlagsSession } from "./domain";
import { NUMBER_BUFFER_DELAY_MS } from "./keys";
import { reloadPrefs, setPref } from "./prefs";

const api = vi.hoisted(() => ({
  flagsResume: vi.fn(),
  flagsAnswer: vi.fn(),
  flagsPause: vi.fn(),
  flagsView: vi.fn(),
  flagsNext: vi.fn(),
}));
vi.mock("./api", () => ({ isDemo: false, DEMO_UNAVAILABLE: "ONLINE_ONLY", api }));
import Flags from "./Flags";

const choices = (count: number): FlagsChoice[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `c${index + 1}`,
    choicePosition: index + 1,
    flagSvgUrl: null,
    flagPngUrl: null,
    flagDescription: null,
  }));

const session = (count: number): FlagsSession => ({
  id: "s1",
  direction: "country_to_flag",
  region: "Europe",
  poolTier: "all",
  poolSignature: "sig",
  rulesVersion: 1,
  state: "active",
  paused: false,
  createdAt: new Date().toISOString(),
  completedAt: null,
  elapsedMs: 0,
  serverNow: new Date().toISOString(),
  total: count,
  maxScore: count * 100,
  answered: 0,
  score: 0,
  correct: 0,
  incorrect: 0,
  skipped: 0,
  hintsUsed: 0,
  current: {
    id: "e1",
    position: 1,
    name: "Austria",
    region: "Europe",
    outcome: "pending",
    attempts: 0,
    wrongChoiceIds: [],
    hintUsed: false,
    points: 0,
    flagSvgUrl: null,
    flagPngUrl: null,
    flagDescription: null,
    correctChoiceId: null,
  },
  entries: [],
  finalBadge: null,
  topFive: [],
  choices: choices(count),
});

const play = async (count: number) => {
  api.flagsResume.mockResolvedValue(session(count));
  api.flagsPause.mockResolvedValue(session(count));
  api.flagsAnswer.mockReturnValue(new Promise(() => {}));
  render(
    <MemoryRouter initialEntries={["/flags/session/s1"]}>
      <Routes>
        <Route path="/flags/*" element={<Flags />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("group", { name: "Flag options" });
  await act(async () => {});
};
const press = (key: string) => fireEvent.keyDown(document.body, { key });
const pickedChoice = () => api.flagsAnswer.mock.calls[0]?.[2];

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.values(api).forEach((fn) => fn.mockReset());
});

it("numbers every flag, also in rounds with more than nine", async () => {
  await play(25);
  const grid = screen.getByRole("group", { name: "Flag options" });
  const badges = [...grid.querySelectorAll(".flags-option-key")].map((badge) => badge.textContent);
  expect(badges).toHaveLength(25);
  expect(badges[0]).toBe("1");
  expect(badges[24]).toBe("25");
});

it("picks a single digit at once when nine or fewer flags are shown", async () => {
  await play(6);
  press("4");
  expect(api.flagsAnswer).toHaveBeenCalledTimes(1);
  expect(pickedChoice()).toBe("c4");
});

it("builds a typed number, shows it and picks it with Enter", async () => {
  await play(25);
  press("1");
  expect(screen.getByText("Flag #", { exact: false })).toHaveTextContent("Flag #1");
  press("2");
  // 12 of 25: no third digit can still fit, so it is picked right away.
  expect(pickedChoice()).toBe("c12");
  expect(api.flagsAnswer).toHaveBeenCalledTimes(1);
});

it("picks a pending number after a short pause, edits with Backspace and never answers twice", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await play(25);
  press("2");
  press("Backspace");
  press("1");
  expect(document.querySelector(".flags-number-entry.is-active")).toHaveTextContent("Flag #1");
  act(() => {
    vi.advanceTimersByTime(NUMBER_BUFFER_DELAY_MS + 10);
  });
  expect(pickedChoice()).toBe("c1");
  // The answer is still being checked: further keys are ignored by the double-submit guard.
  press("3");
  press("Enter");
  expect(api.flagsAnswer).toHaveBeenCalledTimes(1);
});

it("clears a typed number with Escape and ignores digits typed into a field", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await play(25);
  press("2");
  press("Escape");
  act(() => {
    vi.advanceTimersByTime(NUMBER_BUFFER_DELAY_MS * 2);
  });
  expect(api.flagsAnswer).not.toHaveBeenCalled();
  const input = document.createElement("input");
  document.body.append(input);
  fireEvent.keyDown(input, { key: "5" });
  expect(api.flagsAnswer).not.toHaveBeenCalled();
  input.remove();
});

it("does nothing when number keys are turned off", async () => {
  setPref("numberKeys", false);
  await play(6);
  press("2");
  expect(api.flagsAnswer).not.toHaveBeenCalled();
  expect(document.querySelector(".flags-option-key")).toBeNull();
});

it("keeps the sidebar feedback slot in place before any feedback", async () => {
  await play(6);
  const slot = document.querySelector(".flags-stats .flags-feedback-slot");
  expect(slot).not.toBeNull();
  expect(slot).toHaveAttribute("role", "status");
  expect(slot?.textContent).toBe("");
  // The slot sits below the round numbers, so text appearing there cannot push them down.
  expect(slot?.previousElementSibling?.tagName).toBe("DL");
});
