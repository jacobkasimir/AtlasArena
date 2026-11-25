import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ReactNode, useMemo, useState } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ChromeContext } from "@phone/shell/chrome";
import type { CapitalEntry, CapitalSession, FlagsEntry, FlagsSession } from "@shared/domain";

const api = vi.hoisted(() => ({
  flagsSetup: vi.fn(),
  flagsStart: vi.fn(),
  flagsResume: vi.fn(),
  flagsView: vi.fn(),
  flagsAnswer: vi.fn(),
  flagsSkip: vi.fn(),
  flagsHint: vi.fn(),
  flagsNext: vi.fn(),
  flagsPause: vi.fn(),
  flagsAbandon: vi.fn(),
  flagsDelete: vi.fn(),
  flagsResults: vi.fn(),
  capitalsSetup: vi.fn(),
  capitalsStart: vi.fn(),
  capitalsView: vi.fn(),
  capitalsAnswer: vi.fn(),
  capitalsSkip: vi.fn(),
  capitalsNext: vi.fn(),
  capitalsAbandon: vi.fn(),
  capitalsResults: vi.fn(),
  personalBests: vi.fn(),
}));
vi.mock("@shared/api", () => ({ api, isDemo: false, DEMO_UNAVAILABLE: "ONLINE_ONLY" }));
vi.mock("@shared/sound", () => ({ cue: vi.fn(), playSound: vi.fn() }));

import FlagsArea from "./flags";
import CapitalsArea from "./capitals";
import { choiceStatus, countrySuggestions, localFlagSrc } from "./geo-logic";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}
const where = () => screen.getByTestId("where").textContent;
/** The device Back button / swipe-back (the guards listen on window.history, the router is a MemoryRouter). */
const deviceBack = () =>
  act(async () => {
    window.history.back();
    await wait(30);
  });

/** The shell's top-bar slot, so <TopBarActions> buttons ("Pause or leave") render. */
function TopBar({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ setChrome: () => undefined, actionsTarget: target }), [target]);
  return (
    <ChromeContext.Provider value={value}>
      <div ref={setTarget} />
      {children}
    </ChromeContext.Provider>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TopBar>
        <Routes>
          <Route path="/flags/*" element={<FlagsArea />} />
          <Route path="/capitals/*" element={<CapitalsArea />} />
        </Routes>
      </TopBar>
      <Where />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------- Flags fixtures

const flagUrl = (code: string) => `https://flags.restcountries.com/${code}.svg`;
const choices = ["fr", "de", "it"].map((code, index) => ({
  id: `c${index + 1}`,
  choicePosition: index + 1,
  flagSvgUrl: flagUrl(code),
  flagPngUrl: null,
  flagDescription: null,
  name: null as string | null,
}));

function flagEntry(position: number, patch: Partial<FlagsEntry> = {}): FlagsEntry {
  return {
    id: `e${position}`, position, choicePosition: position, name: ["France", "Germany", "Italy"][position - 1],
    region: "Europe", outcome: "pending", attempts: 0, wrongChoiceIds: [], hintUsed: false, points: 0,
    flagSvgUrl: flagUrl(["fr", "de", "it"][position - 1]), flagPngUrl: null, flagDescription: null,
    correctChoiceId: null, ...patch,
  };
}

function flagsSession(patch: Partial<FlagsSession> = {}): FlagsSession {
  const current = patch.current === undefined ? { ...flagEntry(1), choices } : patch.current;
  return {
    id: "f1", direction: "country_to_flag", region: null, poolTier: "easy", poolSignature: "sig", rulesVersion: 1,
    state: "active", paused: false, createdAt: now(), completedAt: null, elapsedMs: 0, serverNow: now(),
    total: 3, maxScore: 300, answered: 0, score: 0, correct: 0, incorrect: 0, skipped: 0, hintsUsed: 0,
    entries: [flagEntry(1), flagEntry(2), flagEntry(3)], finalBadge: null, topFive: [], scope: "all",
    timeLimitSeconds: null, deadlineAt: null, sampleSize: null, ...patch, current,
  };
}

const flagsSetupData = {
  regions: [{ id: "Europe", name: "Europe", easyCount: 3, allCount: 3, easyMissingAssets: 0, allMissingAssets: 0, easyTierExcluded: 0, unsupportedDifficulty: 0 }],
  summary: {},
  countries: ["FR", "DE", "IT"].map((code) => ({ code, name: code, region: "Europe", un: true, easy: true, alpha2: code })),
  activeSessions: [],
  rulesVersion: 1,
  competitiveXp: false,
};

// ---------------------------------------------------------------- Capitals fixtures

function capitalEntry(position: number, patch: Partial<CapitalEntry> = {}): CapitalEntry {
  return {
    id: `k${position}`, position, countryCode: ["FR", "DE"][position - 1], countryName: ["France", "Germany"][position - 1],
    region: "Europe", catalogKind: "iso_alpha2", codeAlpha2: ["FR", "DE"][position - 1], codeAlpha3: null,
    prompt: ["France", "Germany"][position - 1], selectedCapital: null, acceptedAnswers: null, submittedAnswer: null,
    outcome: "pending", points: 0, sourceLinks: [], ...patch,
  };
}

function capitalsSession(patch: Partial<CapitalSession> = {}): CapitalSession {
  const current = patch.current === undefined ? capitalEntry(1) : patch.current;
  return {
    id: "k1", direction: "country_to_capital", poolMode: "all", region: null, poolSignature: "sig", state: "active",
    createdAt: now(), completedAt: null, serverNow: now(), elapsedMs: 0, total: 2, answered: 0, score: 0,
    currentPosition: 1, correct: 0, incorrect: 0, skipped: 0, entries: [capitalEntry(1), capitalEntry(2)],
    vocabulary: [], finalBadge: null, topFive: [], selectedCodes: [], rulesVersion: 1, scope: "all",
    timeLimitSeconds: null, deadlineAt: null, sampleSize: null, ...patch, current,
  };
}

const capitalsSetupData = {
  countries: ["FR", "DE"].map((code) => ({
    code, name: code, officialName: null, region: "Europe", difficulty: "easy", catalogKind: "iso_alpha2" as const,
    codeAlpha2: code, codeAlpha3: null, flagSvgUrl: null, un: true, countryToCapitalEligible: true,
    countryToCapitalReason: null, capitalToCountryEligible: true, capitalToCountryReason: null,
  })),
  regions: ["Europe"],
  activeSessions: [],
};

beforeEach(() => {
  localStorage.clear();
  Object.values(api).forEach((fn) => fn.mockReset());
  api.personalBests.mockResolvedValue([]);
  api.flagsPause.mockResolvedValue(flagsSession({ state: "paused", paused: true }));
});
afterEach(() => cleanup());

// ---------------------------------------------------------------- Pure logic

describe("geo logic", () => {
  it("serves flags only from /public/flags", () => {
    expect(localFlagSrc("https://flags.restcountries.com/FR.svg")).toBe("/flags/fr.svg");
    expect(localFlagSrc("/flags/de.svg")).toBe("/flags/de.svg");
    expect(localFlagSrc("https://evil.example/fr.svg")).toBeNull();
    expect(localFlagSrc(null)).toBeNull();
  });

  it("suggests countries by name prefix or exact code", () => {
    const options = [
      { alpha2: "FR", name: "France" },
      { alpha2: "FI", name: "Finland" },
      { alpha2: "DE", name: "Germany" },
    ];
    expect(countrySuggestions(options, "f").map((o) => o.name)).toEqual(["France", "Finland"]);
    expect(countrySuggestions(options, "de").map((o) => o.name)).toEqual(["Germany"]);
    expect(countrySuggestions(options, " ")).toEqual([]);
  });

  it("marks the right flag only after the question finished", () => {
    const outcome = () => undefined;
    const pending = flagEntry(1, { wrongChoiceIds: ["c2"] });
    expect(choiceStatus(choices[1], pending, outcome)).toBe("wrong");
    expect(choiceStatus(choices[0], pending, outcome)).toBe("open");
    const done = flagEntry(1, { outcome: "incorrect", correctChoiceId: "c1", wrongChoiceIds: ["c2", "c3"] });
    expect(choiceStatus(choices[0], done, outcome)).toBe("answer");
  });
});

// ---------------------------------------------------------------- Flags

describe("phone Flags", () => {
  it("starts a round from the setup with the chosen options", async () => {
    api.flagsSetup.mockResolvedValue(flagsSetupData);
    api.flagsStart.mockResolvedValue(flagsSession());
    api.flagsResume.mockResolvedValue(flagsSession());
    renderAt("/flags");

    const start = await screen.findByRole("button", { name: /Start round · 3 flags/ });
    fireEvent.click(screen.getByRole("button", { name: /3 · Difficulty/ }));
    expect(await screen.findByRole("dialog", { name: "Difficulty" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(start);

    await waitFor(() =>
      expect(api.flagsStart).toHaveBeenCalledWith("country_to_flag", null, "easy", expect.any(String), {
        scope: "all", picks: [], size: null, limit: null,
      }),
    );
    expect(await screen.findByRole("heading", { name: "France" })).toBeInTheDocument();
  });

  it("plays a wrong then a correct pick and moves on", async () => {
    api.flagsResume.mockResolvedValue(flagsSession());
    api.flagsAnswer
      .mockResolvedValueOnce(
        flagsSession({
          current: { ...flagEntry(1, { attempts: 1, wrongChoiceIds: ["c2"] }), choices: choices.map((c) => (c.id === "c2" ? { ...c, name: "Germany" } : c)) },
          actionResult: { type: "answer", outcome: "wrong_choice", remainingAttempts: 2 },
        }),
      )
      .mockResolvedValueOnce(
        flagsSession({
          answered: 1, score: 60, correct: 1,
          current: { ...flagEntry(1, { attempts: 2, wrongChoiceIds: ["c2"], outcome: "correct", points: 60, correctChoiceId: "c1" }), choices },
          actionResult: { type: "answer", outcome: "correct", remainingAttempts: 1 },
        }),
      );
    api.flagsNext.mockResolvedValue(
      flagsSession({ answered: 1, score: 60, correct: 1, current: { ...flagEntry(2), choices } }),
    );
    renderAt("/flags/play/f1");

    fireEvent.click(await screen.findByRole("button", { name: "Flag 2" }));
    expect(await screen.findByText("Wrong flag. 2 tries left.")).toBeInTheDocument();
    const wrong = screen.getByRole("button", { name: "Flag 2, Wrong, Germany" });
    expect(wrong).toBeDisabled();
    expect(api.flagsAnswer).toHaveBeenLastCalledWith("f1", "e1", "c2", null, expect.any(String));

    fireEvent.click(screen.getByRole("button", { name: "Flag 1" }));
    expect(await screen.findByText("Correct · second try · 60 points.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flag 1, Correct flag" })).toBeDisabled();

    await wait(400); // past the accidental double-tap guard
    fireEvent.click(screen.getByRole("button", { name: "Next flag" }));
    expect(await screen.findByRole("heading", { name: "Germany" })).toBeInTheDocument();
    expect(api.flagsNext).toHaveBeenCalledTimes(1);
  });

  it("ignores a second tap while an answer is being checked", async () => {
    api.flagsResume.mockResolvedValue(flagsSession());
    let release: (value: FlagsSession) => void = () => undefined;
    api.flagsAnswer.mockReturnValue(new Promise<FlagsSession>((resolve) => (release = resolve)));
    renderAt("/flags/play/f1");
    const flag = await screen.findByRole("button", { name: "Flag 1" });
    fireEvent.click(flag);
    fireEvent.click(screen.getByRole("button", { name: "Flag 3" }));
    expect(api.flagsAnswer).toHaveBeenCalledTimes(1);
    release(flagsSession());
    await waitFor(() => expect(screen.getByRole("button", { name: "Flag 3" })).not.toBeDisabled());
  });

  it("Flag → Country shows the correct country after a wrong typed answer", async () => {
    const typed = { ...flagEntry(1), choices: null };
    api.flagsResume.mockResolvedValue(
      flagsSession({ direction: "flag_to_country", current: typed, answerOptions: [{ alpha2: "FR", name: "France" }, { alpha2: "FI", name: "Finland" }] }),
    );
    api.flagsAnswer.mockResolvedValue(
      flagsSession({
        direction: "flag_to_country", answered: 1, incorrect: 1,
        current: { ...typed, outcome: "incorrect", attempts: 1 },
        actionResult: { type: "answer", outcome: "incorrect", remainingAttempts: 0 },
      }),
    );
    renderAt("/flags/play/f1");
    const input = await screen.findByLabelText("Your answer");
    expect(input).toHaveAttribute("enterkeyhint", "go");
    fireEvent.change(input, { target: { value: "fi" } });
    fireEvent.click(screen.getByRole("button", { name: /Finland/ }));
    expect(input).toHaveValue("Finland");
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("Not quite · 0 points.")).toBeInTheDocument();
    expect(screen.getByText("France")).toBeInTheDocument();
    expect(api.flagsAnswer).toHaveBeenCalledWith("f1", "e1", null, "Finland", expect.any(String));
  });
});

// ---------------------------------------------------------------- Capitals

describe("phone Capitals", () => {
  it("starts a round from the setup", async () => {
    api.capitalsSetup.mockResolvedValue(capitalsSetupData);
    api.capitalsStart.mockResolvedValue(capitalsSession());
    api.capitalsView.mockResolvedValue(capitalsSession());
    renderAt("/capitals");
    fireEvent.click(await screen.findByRole("button", { name: /Capital → Country/ }));
    expect(screen.getByRole("button", { name: /Capital → Country/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Start round · 2 questions/ }));
    await waitFor(() =>
      expect(api.capitalsStart).toHaveBeenCalledWith("capital_to_country", "all", [], null, expect.any(String), {
        scope: "all", picks: [], size: null, limit: null,
      }),
    );
    expect(await screen.findByRole("heading", { name: "France" })).toBeInTheDocument();
  });

  it("types from memory: wrong, then correct with accepted answers shown only afterwards", async () => {
    api.capitalsView.mockResolvedValue(capitalsSession());
    const paris = [{ name: "Paris", roles: [], primary: true }];
    api.capitalsAnswer.mockResolvedValueOnce(
      capitalsSession({
        answered: 1, incorrect: 1,
        current: capitalEntry(1, { outcome: "incorrect", acceptedAnswers: paris, submittedAnswer: "Lyon" }),
        actionResult: { outcome: "incorrect" },
      }),
    );
    api.capitalsNext.mockResolvedValue(capitalsSession({ answered: 1, incorrect: 1, current: capitalEntry(2) }));
    renderAt("/capitals/play/k1");

    const input = await screen.findByLabelText("Capital");
    expect(input).toHaveAttribute("enterkeyhint", "go");
    expect(input).toHaveAttribute("autocapitalize", "none");
    expect(input).toHaveAttribute("autocorrect", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).not.toHaveAttribute("list");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByText("Paris")).toBeNull();

    fireEvent.change(input, { target: { value: "Lyon" } });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText("Not quite · 0 points.")).toBeInTheDocument();
    expect(screen.getByText("Paris")).toBeInTheDocument();
    expect(api.capitalsAnswer).toHaveBeenCalledWith("k1", "k1", "Lyon", null, expect.any(String));

    await wait(400);
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(await screen.findByRole("heading", { name: "Germany" })).toBeInTheDocument();

    api.capitalsAnswer.mockResolvedValueOnce(
      capitalsSession({
        answered: 2, correct: 1, incorrect: 1, score: 100,
        current: capitalEntry(2, { outcome: "correct", points: 100, acceptedAnswers: [{ name: "Berlin", roles: [], primary: true }] }),
        actionResult: { outcome: "correct", lang: "de" },
      }),
    );
    const second = screen.getByLabelText("Capital");
    fireEvent.change(second, { target: { value: "Berlin" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Correct · 100 points · accepted in German.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "See results" })).toBeInTheDocument();
  });

  it("asks to be more specific without using the question", async () => {
    api.capitalsView.mockResolvedValue(capitalsSession({ direction: "capital_to_country" }));
    api.capitalsAnswer.mockResolvedValue(
      capitalsSession({ direction: "capital_to_country", actionResult: { outcome: "ambiguous" } }),
    );
    renderAt("/capitals/play/k1");
    const input = await screen.findByLabelText("Country");
    fireEvent.change(input, { target: { value: "Congo" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText(/please be more specific/)).toBeInTheDocument();
    await waitFor(() => expect(input).not.toHaveAttribute("readonly"));
    expect(screen.queryByRole("button", { name: "Next question" })).toBeNull();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  it("shows the results when the time limit runs out", async () => {
    const start = Date.now();
    const deadline = new Date(start + 700).toISOString();
    api.capitalsView
      .mockResolvedValueOnce(capitalsSession({ timeLimitSeconds: 300, deadlineAt: deadline, serverNow: new Date(start).toISOString() }))
      .mockResolvedValue(
        capitalsSession({
          state: "completed", completedAt: deadline, deadlineAt: deadline, timeLimitSeconds: 300, answered: 2, skipped: 2,
          current: null, finalBadge: "first_run", timeUp: true,
        }),
      );
    api.capitalsResults.mockResolvedValue(
      capitalsSession({
        state: "completed", completedAt: deadline, deadlineAt: deadline, timeLimitSeconds: 300, answered: 2, skipped: 2,
        current: null, finalBadge: "first_run", elapsedMs: 300_000,
      }),
    );
    renderAt("/capitals/play/k1");
    expect(await screen.findByRole("timer")).toBeInTheDocument();
    expect(await screen.findByText(/Time's up · First run/, undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(api.capitalsView).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Play again" })).toBeInTheDocument();
  });

  it("Play again keeps the setup of the finished round", async () => {
    api.capitalsResults.mockResolvedValue(
      capitalsSession({ state: "completed", completedAt: now(), current: null, region: "Europe", poolMode: "easy", sampleSize: 10, ranked: false, finalBadge: "unranked" }),
    );
    api.capitalsStart.mockResolvedValue(capitalsSession({ id: "k2" }));
    api.capitalsView.mockResolvedValue(capitalsSession({ id: "k2" }));
    renderAt("/capitals/results/k1");
    fireEvent.click(await screen.findByRole("button", { name: "Play again" }));
    await waitFor(() =>
      expect(api.capitalsStart).toHaveBeenCalledWith("country_to_capital", "easy", [], "Europe", expect.any(String), {
        scope: "all", picks: [], size: 10, limit: null,
      }),
    );
  });
});

describe("device Back during a round", () => {
  it("Flags: Back opens Pause or leave instead of leaving; Save and leave pauses once and leaves", async () => {
    api.flagsResume.mockResolvedValue(flagsSession());
    api.flagsSetup.mockReturnValue(new Promise(() => undefined));
    renderAt(`/flags/play/${flagsSession().id}`);
    await screen.findByRole("button", { name: "Pause or leave" });
    await wait(10);
    await deviceBack();
    const sheet = await screen.findByRole("dialog", { name: "Paused" });
    expect(where()).toBe(`/flags/play/${flagsSession().id}`);
    const leave = within(sheet).getByRole("button", { name: "Save and leave" });
    fireEvent.click(leave);
    fireEvent.click(leave);
    await deviceBack(); // pressed at the same time: must not reopen anything or navigate twice
    await waitFor(() => expect(where()).toBe("/flags"));
    expect(api.flagsPause).toHaveBeenCalledTimes(1);
  });

  it("Capitals: Back with the sheet open only closes it, the round stays; Leave goes to the setup", async () => {
    api.capitalsView.mockResolvedValue(capitalsSession());
    api.capitalsSetup.mockReturnValue(new Promise(() => undefined));
    renderAt("/capitals/play/k1");
    const pause = await screen.findByRole("button", { name: "Pause or leave" });
    await wait(10);
    await deviceBack();
    expect(await screen.findByRole("dialog", { name: "Paused" })).toBeInTheDocument();
    await deviceBack();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await wait(30);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(where()).toBe("/capitals/play/k1");

    pause.focus();
    fireEvent.click(pause);
    const sheet = await screen.findByRole("dialog", { name: "Paused" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep playing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(pause).toHaveFocus();

    await deviceBack();
    const again = await screen.findByRole("dialog", { name: "Paused" });
    fireEvent.click(within(again).getByRole("button", { name: "Leave – round is saved" }));
    await waitFor(() => expect(where()).toBe("/capitals"));
    expect(api.capitalsAbandon).not.toHaveBeenCalled();
  });
});
