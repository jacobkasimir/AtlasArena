import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { normalizeRecall, recallHash } from "@shared/recall-domain";
import type { RecallAnswerResult, RecallEntry, RecallSession } from "@shared/recall-domain";
import { renderArea } from "./test-utils";

const mocks = vi.hoisted(() => ({
  recallSetup: vi.fn(),
  personalBests: vi.fn(),
  recallStart: vi.fn(),
  recallView: vi.fn(),
  recallAnswer: vi.fn(),
  recallFinish: vi.fn(),
  recallAbandon: vi.fn(),
}));
vi.mock("@shared/api", () => ({ api: mocks, isDemo: false, DEMO_UNAVAILABLE: "ONLINE_ONLY" }));

import RecallArea from "./recall";

const SALT = "test-salt";
type Place = { name: string; region: string; alpha2: string; extendedBy?: number[] };
const PLACES: Place[] = [
  { name: "France", region: "Europe", alpha2: "FR" },
  { name: "Germany", region: "Europe", alpha2: "DE" },
  { name: "Niger", region: "Africa", alpha2: "NE", extendedBy: [3] },
  { name: "Nigeria", region: "Africa", alpha2: "NG" },
];

async function entries(found: number[], over: boolean): Promise<RecallEntry[]> {
  return Promise.all(
    PLACES.map(async (place, position) => {
      const hit = found.includes(position);
      return {
        position,
        region: place.region,
        prompt: null,
        alpha2: place.alpha2,
        // Names of missing entries are only sent once the round is over.
        name: hit || over ? place.name : null,
        found: hit,
        foundAt: hit ? new Date().toISOString() : null,
        matched: hit ? place.name : null,
        lang: hit ? ("en" as const) : null,
        keys:
          hit || over
            ? null
            : [{ h: await recallHash(SALT, normalizeRecall(place.name)), l: "en" as const, x: place.extendedBy ?? [] }],
      };
    }),
  );
}

async function session(patch: Partial<RecallSession> = {}, found: number[] = []): Promise<RecallSession> {
  const now = new Date();
  const state = patch.state ?? "active";
  return {
    id: "r1",
    kind: "countries",
    scope: "un",
    region: null,
    size: null,
    timeLimitSeconds: null,
    pool: "all",
    selectedCount: 0,
    selectedCodes: [],
    state,
    endReason: null,
    badge: null,
    total: PLACES.length,
    found: found.length,
    createdAt: now.toISOString(),
    deadlineAt: null,
    serverNow: now.toISOString(),
    completedAt: state === "active" ? null : now.toISOString(),
    elapsedMs: null,
    ranked: true,
    best: null,
    salt: state === "active" ? SALT : null,
    ambiguous: [],
    entries: await entries(found, state !== "active"),
    ...patch,
  };
}

function answer(position: number, patch: Partial<RecallAnswerResult> = {}): RecallAnswerResult {
  return {
    status: "found",
    position,
    name: PLACES[position].name,
    alpha2: PLACES[position].alpha2,
    matched: PLACES[position].name,
    lang: "en",
    foundAt: new Date().toISOString(),
    found: 1,
    total: PLACES.length,
    state: "active",
    endReason: null,
    ...patch,
  };
}

const input = () => screen.getByLabelText("Type a country") as HTMLInputElement;
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const go = () => fireEvent.click(screen.getByRole("button", { name: "Go" }));

beforeEach(() => {
  localStorage.clear();
  Object.values(mocks).forEach((mock) => mock.mockReset());
});
afterEach(() => cleanup());

describe("phone Recall", { timeout: 15_000 }, () => {
  it("accepts typed names, fills the found list by itself and opens the results when all are found", async () => {
    mocks.recallView
      .mockResolvedValueOnce(await session())
      .mockResolvedValueOnce(await session({ state: "completed", endReason: "all_found", badge: "new_best", elapsedMs: 9000 }, [0, 1, 2, 3]));
    mocks.recallAnswer.mockImplementation(async (_id: string, position: number) =>
      answer(position, position === 3 ? { state: "completed", endReason: "all_found" } : {}),
    );
    renderArea("recall", <RecallArea />, "/recall/play/r1");

    await screen.findByLabelText("Type a country");
    expect(input()).toHaveAttribute("enterkeyhint", "go");
    expect(input()).toHaveAttribute("autocapitalize", "none");
    // Accepted as soon as it is typed – no Go needed.
    type("france");
    await waitFor(() => expect(mocks.recallAnswer).toHaveBeenCalledWith("r1", 0, "france"));
    await waitFor(() => expect(input().value).toBe(""));
    expect(await screen.findByText("✓ france")).toBeInTheDocument();
    const europe = screen.getByRole("region", { name: "Europe" });
    await waitFor(() => expect(within(europe).getByText("France")).toBeInTheDocument());
    expect(within(europe).getByText("1/2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Just found" })).toBeInTheDocument();

    // A wrong answer only counts on Go, and keeps the text so it can be fixed.
    type("Atlantis");
    go();
    expect(await screen.findByText("“Atlantis” isn't in this set.")).toBeInTheDocument();
    expect(input().value).toBe("Atlantis");
    expect(mocks.recallAnswer).toHaveBeenCalledTimes(1);

    // The same answer again is "already found", never sent twice.
    type("France");
    expect(await screen.findByText("Already in your list: France.")).toBeInTheDocument();
    expect(mocks.recallAnswer).toHaveBeenCalledTimes(1);

    // "Niger" is the start of the still-missing "Nigeria": it waits, and Go accepts it at once.
    type("Niger");
    expect(await screen.findByText("Tap Go to accept “Niger” – or keep typing.")).toBeInTheDocument();
    go();
    await waitFor(() => expect(mocks.recallAnswer).toHaveBeenCalledWith("r1", 2, "Niger"));

    type("Germany");
    await waitFor(() => expect(mocks.recallAnswer).toHaveBeenCalledWith("r1", 1, "Germany"));
    // Accents and case don't matter for the local check.
    type("NIGÉRIA");
    await waitFor(() => expect(mocks.recallAnswer).toHaveBeenCalledWith("r1", 3, "NIGÉRIA"));
    expect(mocks.recallAnswer).toHaveBeenCalledTimes(4);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/recall/results/r1"), { timeout: 3000 });
    expect(await screen.findByRole("heading", { name: "Perfect recall!" })).toBeInTheDocument();
  });

  it("rolls an answer back when the server can't confirm it", async () => {
    mocks.recallView.mockResolvedValueOnce(await session());
    mocks.recallAnswer.mockResolvedValue(answer(0, { status: "no_match", name: null }));
    renderArea("recall", <RecallArea />, "/recall/play/r1");
    await screen.findByLabelText("Type a country");
    type("France");
    expect(await screen.findByText("“France” could not be confirmed. Try another spelling.")).toBeInTheDocument();
    const europe = screen.getByRole("region", { name: "Europe" });
    expect(within(europe).getByText("0/2")).toBeInTheDocument();
  });

  it("asks before giving up and then shows the results", async () => {
    mocks.recallView
      .mockResolvedValueOnce(await session())
      .mockResolvedValueOnce(await session({ state: "completed", endReason: "gave_up", badge: "unranked", elapsedMs: 5000 }));
    mocks.recallFinish.mockResolvedValue(undefined);
    renderArea("recall", <RecallArea />, "/recall/play/r1");
    await screen.findByLabelText("Type a country");
    fireEvent.click(within(screen.getByTestId("topbar")).getByRole("button", { name: "Give up" }));
    const sheet = await screen.findByRole("dialog", { name: "Give up?" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Give up" }));
    await waitFor(() => expect(mocks.recallFinish).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/recall/results/r1"));
    expect(await screen.findByRole("heading", { name: "Round complete" })).toBeInTheDocument();
  });

  it("device Back asks before leaving; Leave keeps the round and opens the setup", async () => {
    mocks.recallView.mockResolvedValue(await session());
    mocks.recallSetup.mockReturnValue(new Promise(() => undefined));
    mocks.personalBests.mockReturnValue(new Promise(() => undefined));
    renderArea("recall", <RecallArea />, "/recall/play/r1");
    await screen.findByLabelText("Type a country");
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const sheet = await screen.findByRole("dialog", { name: "Leave this round?" });
    expect(screen.getByTestId("where")).toHaveTextContent("/recall/play/r1");
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep going" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(within(screen.getByTestId("topbar")).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/recall$/));
    expect(mocks.recallFinish).not.toHaveBeenCalled();
    expect(mocks.recallAbandon).not.toHaveBeenCalled();
  });

  it("finishes the round when the time limit runs out", async () => {
    const now = Date.now();
    mocks.recallView
      .mockResolvedValueOnce(
        await session({
          timeLimitSeconds: 300,
          createdAt: new Date(now - 299_600).toISOString(),
          deadlineAt: new Date(now + 400).toISOString(),
          serverNow: new Date(now).toISOString(),
        }),
      )
      .mockResolvedValueOnce(
        await session(
          { state: "completed", endReason: "time_up", badge: "first_run", timeLimitSeconds: 300, elapsedMs: 300_000 },
          [0],
        ),
      );
    mocks.recallFinish.mockResolvedValue(undefined);
    renderArea("recall", <RecallArea />, "/recall/play/r1");
    // Under 30 s left: the countdown shows even with calm timers.
    expect(await screen.findByRole("timer")).toHaveTextContent("0:00");
    await waitFor(() => expect(mocks.recallFinish).toHaveBeenCalledWith("r1"), { timeout: 3000 });
    expect(await screen.findByRole("heading", { name: "Time's up!" })).toBeInTheDocument();
    expect(mocks.recallFinish).toHaveBeenCalledTimes(1);
    expect(screen.getByText("First result for this set")).toBeInTheDocument();
  });

  it("shows missed and found answers in two tabs on the results", async () => {
    mocks.recallView.mockResolvedValueOnce(
      await session({ state: "completed", endReason: "gave_up", badge: "new_best", elapsedMs: 61_000 }, [0, 1, 2]),
    );
    renderArea("recall", <RecallArea />, "/recall/results/r1");
    expect(await screen.findByText("75%")).toBeInTheDocument();
    expect(screen.getByText(/New personal best/)).toBeInTheDocument();
    const missedTab = screen.getByRole("tab", { name: "Missed · 1" });
    const foundTab = screen.getByRole("tab", { name: "Found · 3" });
    expect(missedTab).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByText("Nigeria")).toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel")).getAllByRole("listitem")).toHaveLength(1);

    fireEvent.click(foundTab);
    expect(foundTab).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByText("France")).toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel")).getAllByRole("listitem")).toHaveLength(3);

    // Arrow keys move between the tabs.
    fireEvent.keyDown(foundTab, { key: "ArrowRight" });
    expect(missedTab).toHaveAttribute("aria-selected", "true");
    expect(missedTab).toHaveFocus();
    expect(screen.getByRole("button", { name: "Play again" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change settings" })).toHaveAttribute(
      "href",
      expect.stringContaining("/recall?mode=countries"),
    );
  });
});
