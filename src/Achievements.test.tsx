import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AchievementsGrid, Badge } from "./Achievements";
import type { Achievement } from "./domain";

afterEach(cleanup);

const badge = (id: string, extra: Partial<Achievement>): Achievement => ({
  id, category: "quiz", tier: "bronze", icon: "quiz", title: id, description: `${id} description`,
  current: 0, target: 1, earned: false, ...extra,
});
const all = [
  badge("First steps", { current: 1, earned: true }),
  badge("Untouchable", { tier: "platinum", icon: "flame", current: 28, target: 50 }),
  badge("Flag spotter", { category: "flags", icon: "flag", current: 50, target: 50, earned: true }),
  badge("Centurion", { category: "daily", tier: "platinum", icon: "calendar", current: 1, target: 100 }),
];

it("groups badges by category with tier totals and progress", () => {
  render(<AchievementsGrid achievements={all} />);
  expect(screen.getByText("badges earned")).toBeInTheDocument();
  const tiers = screen.getByRole("list", { name: "Badges by tier" });
  expect(within(tiers).getByText("Platinum").parentElement).toHaveTextContent("0/2");
  expect(within(tiers).getByText("Bronze").parentElement).toHaveTextContent("2/2");
  const quiz = screen.getByRole("region", { name: "Quiz" });
  expect(within(quiz).getByText("28 / 50")).toBeInTheDocument();
  expect(within(quiz).getByText("Earned")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Daily challenge" })).toHaveTextContent("1 / 100");
});

it("filters earned and open badges", () => {
  render(<AchievementsGrid achievements={all} />);
  fireEvent.click(screen.getByRole("button", { name: "Earned" }));
  expect(screen.queryByText("Untouchable")).not.toBeInTheDocument();
  expect(screen.getByText("Flag spotter")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Still to earn" }));
  expect(screen.queryByText("Flag spotter")).not.toBeInTheDocument();
  expect(screen.getByText("Centurion")).toBeInTheDocument();
});

it("renders a tiered badge and falls back for unknown icons", () => {
  const { container } = render(<Badge item={badge("Odd", { icon: "🎯", tier: "gold", earned: true })} />);
  const el = container.querySelector(".badge");
  expect(el).toHaveClass("tier-gold", "is-earned");
  expect(el?.querySelector("svg")).not.toBeNull();
});
