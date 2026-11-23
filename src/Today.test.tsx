import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { AchievementsCard, DailyCard, ReviewCard } from "./Today";
import type { DailyStatus } from "./domain";

vi.mock("./api", () => ({ api: { dailyStart: vi.fn() } }));
afterEach(cleanup);

const daily: DailyStatus = {
  day: "2026-11-23", available: true, sessionId: "s1", state: "completed", score: 820, correct: 8, rank: 2, players: 5,
  streak: { current: 3, best: 4 },
  top: [
    { rank: 1, username: "Ana", avatar: 0, score: 900, correct: 9, isYou: false },
    { rank: 2, username: "Jacob", avatar: 1, score: 820, correct: 8, isYou: true },
  ],
};

it("shows a finished daily challenge with rank, streak and today's top list", () => {
  render(<MemoryRouter><DailyCard status={daily} /></MemoryRouter>);
  expect(screen.getByText("#2")).toBeInTheDocument();
  expect(screen.getByText("of 5")).toBeInTheDocument();
  expect(screen.getByTitle("Best streak: 4 days")).toHaveTextContent("3");
  fireEvent.click(screen.getByRole("button", { name: /today's top 10/ }));
  expect(screen.getByText("Jacob (you)")).toBeInTheDocument();
});

it("offers to start or continue, and explains the demo", () => {
  const { rerender } = render(<MemoryRouter><DailyCard status={{ ...daily, sessionId: null, state: null, players: 0 }} /></MemoryRouter>);
  expect(screen.getByRole("button", { name: "Play today's challenge" })).toBeInTheDocument();
  rerender(<MemoryRouter><DailyCard status={{ ...daily, state: "awaiting_answer" }} /></MemoryRouter>);
  expect(screen.getByRole("link", { name: /Continue today's challenge/ })).toHaveAttribute("href", "/play/s1");
  rerender(<MemoryRouter><DailyCard status={null} /></MemoryRouter>);
  expect(screen.getByText(/not in the local demo/)).toBeInTheDocument();
});

it("links to the review and shows the closest badges", () => {
  render(<MemoryRouter>
    <ReviewCard summary={{ open: 75, byKind: { flag: 61 }, activeId: null, cleared: 3 }} />
    <AchievementsCard achievements={[
      { id: "a", category: "quiz", tier: "bronze", icon: "quiz", title: "First steps", description: "", current: 1, target: 1, earned: true },
      { id: "b", category: "capitals", tier: "silver", icon: "capital", title: "Capital collector", description: "", current: 40, target: 50, earned: false },
    ]} />
  </MemoryRouter>);
  expect(screen.getByRole("link", { name: "Review 10 mistakes →" })).toHaveAttribute("href", "/review");
  expect(screen.getByText("1 of 2 badges earned")).toBeInTheDocument();
  expect(screen.getByText("40/50")).toBeInTheDocument();
});
