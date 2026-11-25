import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { RecallEntry, RecallSession } from "./recall-domain";

const api = vi.hoisted(() => ({ recallView: vi.fn(), recallStart: vi.fn() }));
vi.mock("./api", () => ({ isDemo: false, DEMO_UNAVAILABLE: "ONLINE_ONLY", api }));
import Recall from "./Recall";

afterEach(() => {
  cleanup();
  Object.values(api).forEach((fn) => fn.mockReset());
});

const entry = (position: number, name: string, found: boolean): RecallEntry => ({
  position,
  region: "Europe",
  prompt: null,
  alpha2: null,
  name,
  found,
  foundAt: found ? new Date().toISOString() : null,
  matched: found ? name : null,
  lang: found ? "en" : null,
  keys: null,
});

const done: RecallSession = {
  id: "r1",
  kind: "countries",
  scope: "un",
  region: "Europe",
  size: null,
  timeLimitSeconds: null,
  state: "completed",
  endReason: "gave_up",
  badge: "unranked",
  total: 3,
  found: 1,
  createdAt: new Date().toISOString(),
  deadlineAt: null,
  serverNow: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  elapsedMs: 60_000,
  ranked: false,
  best: null,
  salt: null,
  ambiguous: [],
  entries: [entry(1, "Austria", true), entry(2, "Belgium", false), entry(3, "Croatia", false)],
};

const results = async () => {
  api.recallView.mockResolvedValue(done);
  render(
    <MemoryRouter initialEntries={["/recall/results/r1"]}>
      <Routes>
        <Route path="/recall/*" element={<Recall />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.findByRole("tablist", { name: "Answers" });
};

it("shows Missed and Found as real tabs with a linked tab panel", async () => {
  await results();
  const missed = screen.getByRole("tab", { name: "Missed · 2" });
  const found = screen.getByRole("tab", { name: "Found · 1" });
  expect(missed).toHaveAttribute("aria-selected", "true");
  expect(found).toHaveAttribute("aria-selected", "false");
  expect(missed).not.toHaveAttribute("aria-pressed");
  expect(found).not.toHaveAttribute("aria-pressed");
  expect(missed).toHaveAttribute("tabindex", "0");
  expect(found).toHaveAttribute("tabindex", "-1");
  const panel = screen.getByRole("tabpanel");
  expect(missed).toHaveAttribute("aria-controls", panel.id);
  expect(panel).toHaveAttribute("aria-labelledby", missed.id);
  expect(panel).toHaveTextContent("Belgium");
  expect(panel).not.toHaveTextContent("Austria");
});

it("moves between tabs with the arrow keys, Home and End", async () => {
  await results();
  const missed = screen.getByRole("tab", { name: "Missed · 2" });
  const found = screen.getByRole("tab", { name: "Found · 1" });
  missed.focus();
  fireEvent.keyDown(missed, { key: "ArrowRight" });
  expect(found).toHaveFocus();
  expect(found).toHaveAttribute("aria-selected", "true");
  expect(found).toHaveAttribute("tabindex", "0");
  expect(missed).toHaveAttribute("tabindex", "-1");
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Austria");
  expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", found.id);
  fireEvent.keyDown(found, { key: "ArrowRight" });
  expect(missed).toHaveFocus();
  fireEvent.keyDown(missed, { key: "ArrowLeft" });
  expect(found).toHaveFocus();
  fireEvent.keyDown(found, { key: "Home" });
  expect(missed).toHaveFocus();
  expect(missed).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(missed, { key: "End" });
  expect(found).toHaveFocus();
});

it("selects a tab on click", async () => {
  await results();
  fireEvent.click(screen.getByRole("tab", { name: "Found · 1" }));
  expect(screen.getByRole("tab", { name: "Found · 1" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Austria");
});
