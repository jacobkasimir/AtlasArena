// Data for the phone Home and Games screens: the same API calls as the desktop Hub (src/Hub.tsx), but every
// optional part keeps its own state so the screen can tell "needs an online account" (demo) from a real error.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, DEMO_UNAVAILABLE } from "@shared/api";
import type {
  Achievement,
  CapitalSetup,
  DailyStatus,
  Dashboard,
  EliminationPuzzle,
  FlagsSetup,
  ReviewSummary,
} from "@shared/domain";
import type { RecallSetup } from "@shared/recall-domain";
import { bestScore, describeSetup, gameNames, modeNames as setupModeNames, regionLabel, setupUrl } from "@shared/game-setup";
import type { GameStats, PersonalBest } from "@shared/game-setup";
import type { IconName, Tone } from "@shared/icons";
import { modeNames as quizModeNames } from "@shared/quiz-meta";
import { paths } from "@phone/shell/paths";

/** One optional part of the Home data. */
export type Part<T> =
  | { state: "ok"; value: T }
  | { state: "online-only" }
  | { state: "error"; message: string };

export type HomeData = {
  quiz: Dashboard;
  flags: Part<FlagsSetup>;
  capitals: Part<CapitalSetup>;
  recall: Part<RecallSetup>;
  elimination: Part<EliminationPuzzle[]>;
  bests: Part<PersonalBest[]>;
  stats: Part<GameStats>;
  daily: Part<DailyStatus>;
  review: Part<ReviewSummary>;
  achievements: Part<Achievement[]>;
};

export type GameKey = "quiz" | "flags" | "capitals" | "recall" | "elimination";

export const gameTitles: Record<GameKey, string> = {
  quiz: "Quiz",
  flags: "Flags",
  capitals: "Capitals",
  recall: "Recall",
  elimination: "Elimination",
};

/**
 * Where a running round of each game is played. The game areas own these routes ("play/:id" below their prefix,
 * see phone/README.md); keep this the only place on Home that builds them.
 */
export const playPath: Record<GameKey, (id: string) => string> = {
  quiz: (id) => `${paths.quiz}/play/${id}`,
  flags: (id) => `${paths.flags}/play/${id}`,
  capitals: (id) => `${paths.capitals}/play/${id}`,
  recall: (id) => `${paths.recall}/play/${id}`,
  elimination: (id) => `${paths.elimination}/play/${id}`,
};

export const setupPath: Record<GameKey, string> = {
  quiz: paths.quiz,
  flags: paths.flags,
  capitals: paths.capitals,
  recall: paths.recall,
  elimination: paths.elimination,
};

/** XP per level, as in the desktop Hub. */
export const XP_PER_LEVEL = 500;

export function isOnlineOnly(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes(DEMO_UNAVAILABLE);
}

/** A readable message without internal prefixes such as "ONLINE_ONLY:" or "AUTH_REQUIRED:". */
export function readableError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const text = raw.replace(/^[A-Z_]{4,}:\s*/, "").trim();
  return text || "Something went wrong.";
}

async function settle<T>(promise: Promise<T>, valid: (value: unknown) => boolean): Promise<Part<T>> {
  try {
    const value = await promise;
    if (!valid(value)) return { state: "error", message: "The server sent an unexpected answer." };
    return { state: "ok", value };
  } catch (error) {
    if (isOnlineOnly(error)) return { state: "online-only" };
    return { state: "error", message: readableError(error) };
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const hasSessions = (value: unknown) => isObject(value) && Array.isArray(value.activeSessions);

export async function loadHome(): Promise<HomeData> {
  const [quiz, flags, capitals, recall, elimination, bests, stats, daily, review, achievements] = await Promise.all([
    api.dashboard(),
    settle(api.flagsSetup(), hasSessions),
    settle(api.capitalsSetup(), hasSessions),
    settle(
      api.recallSetup(),
      (value) => hasSessions(value) && isObject(value) && Array.isArray(value.catalog) && isObject(value.recalled),
    ),
    settle(api.elimCatalog(), Array.isArray),
    settle(api.personalBests(), Array.isArray),
    settle(api.gameStats(), (value) => isObject(value) && "flags" in value),
    settle(api.dailyStatus(), (value) => isObject(value) && isObject(value.streak) && Array.isArray(value.top)),
    settle(api.reviewSummary(), (value) => isObject(value) && "open" in value),
    settle(api.achievements(), Array.isArray),
  ]);
  if (!isObject(quiz) || !isObject(quiz.profile) || !Array.isArray(quiz.sessions)) {
    throw new Error("Your progress could not be read.");
  }
  return { quiz, flags, capitals, recall, elimination, bests, stats, daily, review, achievements };
}

export const valueOf = <T,>(part: Part<T>): T | null => (part.state === "ok" ? part.value : null);

export type ContinueItem = {
  id: string;
  game: GameKey;
  title: string;
  detail: string;
  to: string;
  done: number;
  /** 0 when the round has no fixed length (quiz). */
  total: number;
};

/** Every resumable round of every game, newest first inside each game. */
export function continueItems(data: HomeData): ContinueItem[] {
  const items: ContinueItem[] = [];
  for (const session of data.quiz.sessions) {
    if (session.status !== "awaiting_answer" && session.status !== "showing_feedback") continue;
    items.push({
      id: session.id,
      game: "quiz",
      title: quizModeNames[session.mode] ?? "Quiz",
      detail: `${capitalize(session.difficulty)} · ${session.score} pts`,
      to: playPath.quiz(session.id),
      done: session.correct + session.incorrect,
      total: 0,
    });
  }
  for (const session of valueOf(data.flags)?.activeSessions ?? []) {
    items.push({
      id: session.id,
      game: "flags",
      title: session.direction === "country_to_flag" ? "Country → Flag" : "Flag → Country",
      detail:
        describeSetup({
          scope: session.scope ?? "all",
          region: session.region,
          pool: session.poolTier,
          picks: session.selectedCount,
          size: session.sampleSize,
          limit: session.timeLimitSeconds ?? null,
        }) + (session.paused ? " · paused" : ""),
      to: playPath.flags(session.id),
      done: session.answered,
      total: session.total,
    });
  }
  for (const session of valueOf(data.capitals)?.activeSessions ?? []) {
    items.push({
      id: session.id,
      game: "capitals",
      title: session.direction === "country_to_capital" ? "Country → Capital" : "Capital → Country",
      detail: describeSetup({
        scope: session.scope ?? "all",
        region: session.region,
        pool: session.poolMode,
        picks: session.selectedCount,
        size: session.sampleSize,
        limit: session.timeLimitSeconds ?? null,
      }),
      to: playPath.capitals(session.id),
      done: session.answered,
      total: session.total,
    });
  }
  for (const session of valueOf(data.recall)?.activeSessions ?? []) {
    items.push({
      id: session.id,
      game: "recall",
      title: session.kind === "countries" ? "Name the countries" : "Name the capitals",
      detail: `${session.scope === "un" ? "UN member states" : "All countries & territories"} · ${regionLabel(session.region)}`,
      to: playPath.recall(session.id),
      done: session.found,
      total: session.total,
    });
  }
  for (const puzzle of valueOf(data.elimination) ?? []) {
    if (!puzzle.activeId) continue;
    items.push({
      id: puzzle.activeId,
      game: "elimination",
      title: `${capitalize(puzzle.difficulty)} puzzle #${puzzle.number}`,
      detail: `${puzzle.groups} clue chains · ${puzzle.pool === "un" ? "UN member states" : "All countries & territories"}`,
      to: playPath.elimination(puzzle.activeId),
      done: 0,
      total: 0,
    });
  }
  return items;
}

export type DailyPlan =
  | { kind: "online-only" }
  | { kind: "error"; message: string }
  | { kind: "unavailable"; status: DailyStatus }
  | { kind: "done"; status: DailyStatus }
  | { kind: "continue"; status: DailyStatus; to: string }
  | { kind: "start"; status: DailyStatus };

export function dailyPlan(part: Part<DailyStatus>): DailyPlan {
  if (part.state === "online-only") return { kind: "online-only" };
  if (part.state === "error") return { kind: "error", message: part.message };
  const status = part.value;
  if (!status.available) return { kind: "unavailable", status };
  if (status.state === "completed") return { kind: "done", status };
  if (status.sessionId && status.state !== "abandoned") {
    return { kind: "continue", status, to: playPath.quiz(status.sessionId) };
  }
  return { kind: "start", status };
}

/** The one primary action of Home (in the sticky bar at the bottom, under the thumb). */
export type PrimaryAction =
  | { kind: "link"; label: string; to: string }
  | { kind: "daily-start"; label: string };

export function primaryAction(data: HomeData): PrimaryAction {
  const daily = dailyPlan(data.daily);
  if (daily.kind === "continue") return { kind: "link", label: "Continue today's challenge", to: daily.to };
  const [first] = continueItems(data);
  if (first) return { kind: "link", label: `Continue ${gameTitles[first.game]}`, to: first.to };
  if (daily.kind === "start") return { kind: "daily-start", label: "Play today's challenge" };
  return { kind: "link", label: "Play", to: paths.games };
}

/** Level progress from the server's XP total (display only: the server owns XP). */
export function levelProgress(xp: number) {
  const total = Math.max(0, Math.floor(xp || 0));
  const inLevel = total % XP_PER_LEVEL;
  return { level: 1 + Math.floor(total / XP_PER_LEVEL), inLevel, toNext: XP_PER_LEVEL - inLevel };
}

/* ---------- Next goal ---------- */

/**
 * One "Next goal" for Home, derived only from data the server (or the demo engine) already sent: today's
 * challenge, a running round, open mistakes, the closest achievement, a game never played, a personal best
 * that can still be beaten. Never computes scores or XP itself.
 */
export type Goal = {
  id: string;
  title: string;
  text: string;
  icon: IconName;
  tone: Tone;
  cta: string;
  progress?: { value: number; max: number; label: string };
} & ({ to: string; action?: undefined } | { action: "daily-start"; to?: undefined });

/** Every goal that applies right now, most useful first. */
export function goalCandidates(data: HomeData): Goal[] {
  const goals: Goal[] = [];
  const daily = dailyPlan(data.daily);
  if (daily.kind === "continue") {
    goals.push({
      id: "daily-continue",
      title: "Finish today's challenge",
      text: "Your daily round is waiting. One try per day.",
      icon: "calendar",
      tone: "daily",
      cta: "Continue today's challenge",
      to: daily.to,
    });
  } else if (daily.kind === "start") {
    const streak = daily.status.streak.current;
    goals.push({
      id: "daily-start",
      title: streak > 0 ? `Keep your ${streak}-day streak` : "Play today's challenge",
      text: "10 questions – the same for everyone today.",
      icon: "calendar",
      tone: "daily",
      cta: "Play today's challenge",
      action: "daily-start",
    });
  }

  for (const item of continueItems(data)) {
    goals.push({
      id: `continue-${item.game}-${item.id}`,
      title: `Finish your ${gameTitles[item.game]} round`,
      text: `${item.title} · ${item.detail}`,
      icon: gameIcons[item.game],
      tone: item.game,
      cta: "Continue",
      to: item.to,
      progress: item.total > 0 ? { value: item.done, max: item.total, label: `${item.done} of ${item.total} done` } : undefined,
    });
  }

  const review = valueOf(data.review);
  if (review && review.open > 0) {
    goals.push({
      id: "review",
      title: review.open === 1 ? "Clear 1 open mistake" : `Clear ${review.open} open mistakes`,
      text: "Get each one right once and it's cleared for good.",
      icon: "review",
      tone: "review",
      cta: "Review my mistakes",
      to: `${paths.quiz}/review`,
    });
  }

  const achievement = closestAchievement(valueOf(data.achievements) ?? []);
  if (achievement) {
    goals.push({
      id: `achievement-${achievement.id}`,
      title: `Earn “${achievement.title}”`,
      text: achievement.description || "Your closest badge.",
      icon: "medal",
      tone: "awards",
      cta: "See achievements",
      to: `${paths.profile}/achievements`,
      progress: {
        value: achievement.current,
        max: achievement.target,
        label: `${achievement.title}: ${achievement.current} of ${achievement.target}`,
      },
    });
  }

  const unplayed = unplayedGame(data);
  if (unplayed) {
    goals.push({
      id: `try-${unplayed}`,
      title: unplayed === "quiz" ? "Play your first quiz" : `Try ${gameTitles[unplayed]}`,
      text: gameIntros[unplayed],
      icon: gameIcons[unplayed],
      tone: unplayed,
      cta: `Play ${gameTitles[unplayed]}`,
      to: setupPath[unplayed],
    });
  }

  const best = bestToBeat(valueOf(data.bests) ?? []);
  if (best) {
    goals.push({
      id: `best-${best.game}-${best.completedAt}`,
      title: `Beat your ${gameNames[best.game]} best`,
      text: `${bestScore(best)} · ${setupModeNames[best.mode] ?? best.mode} · ${regionLabel(best.region)}`,
      icon: "trophy",
      tone: best.game,
      cta: "Try again",
      to: setupUrl(best.game, {
        mode: best.mode,
        scope: best.scope,
        region: best.region,
        pool: best.pool,
        picks: best.selectedCodes,
        size: null,
        limit: best.timeLimitSeconds,
      }),
      progress: { value: best.correct, max: best.total, label: `Best: ${best.correct} of ${best.total}` },
    });
  }

  goals.push({
    id: "explore",
    title: "Discover a new country",
    text: "Browse capitals, flags, languages and neighbours in the atlas.",
    icon: "explorer",
    tone: "explorer",
    cta: "Open Explorer",
    to: paths.explorer,
  });
  return goals;
}

const primaryKey = (action: PrimaryAction) => (action.kind === "daily-start" ? "daily-start" : action.to);
const goalKey = (goal: Goal) => (goal.action === "daily-start" ? "daily-start" : goal.to);

/** The one goal Home shows: the first candidate that isn't already the big bottom action. */
export function nextGoal(data: HomeData): Goal {
  const taken = primaryKey(primaryAction(data));
  const goals = goalCandidates(data);
  return goals.find((goal) => goalKey(goal) !== taken) ?? goals[goals.length - 1];
}

/** Not-yet-earned achievement with the highest progress (ties: the smaller target). */
export function closestAchievement(list: Achievement[]): Achievement | null {
  const open = list.filter((item) => !item.earned && item.target > 0 && item.current < item.target);
  open.sort((a, b) => b.current / b.target - a.current / a.target || a.target - b.target);
  return open[0] ?? null;
}

/** First game (in Games order) the player has never finished a round of; null when unknown or all played. */
export function unplayedGame(data: HomeData): GameKey | null {
  if (!data.quiz.totals.games) return "quiz";
  const stats = valueOf(data.stats);
  if (!stats) return null;
  for (const game of ["flags", "capitals", "recall"] as const) {
    if (stats[game] && stats[game].rounds === 0) return game;
  }
  return null;
}

/** Most recent personal best that is not perfect yet (there is something left to beat). */
export function bestToBeat(bests: PersonalBest[]): PersonalBest | null {
  const open = bests.filter((best) => best.total > 0 && best.correct < best.total);
  open.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return open[0] ?? null;
}

/** Region names for "Practise a region" (Flags regions from the setup; empty when unknown). */
export function practiceRegions(data: HomeData): string[] {
  const regions = valueOf(data.flags)?.regions ?? [];
  return regions
    .filter((region) => region.name && region.name !== "__unspecified__" && region.allCount > 0)
    .map((region) => region.name);
}

/** A 10-flag random sample of one region: practice (unranked), never a personal best. */
export const regionPracticePath = (region: string) =>
  `${paths.flags}?${new URLSearchParams({ mode: "flag_to_country", scope: "un", pool: "all", region, size: "10" })}`;

export const gameIcons: Record<GameKey, IconName> = {
  quiz: "quiz",
  flags: "flag",
  capitals: "capital",
  recall: "recall",
  elimination: "funnel",
};

export const gameIntros: Record<GameKey, string> = {
  quiz: "Multiple-choice questions in four modes.",
  flags: "Match flags and countries, region by region.",
  capitals: "Name capitals from memory – English, German or French.",
  recall: "Type every country or capital of a region.",
  elimination: "Chains of clues until only one place is left.",
};

export function capitalize(text: string) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

export function percent(correct: number, answered: number) {
  return answered > 0 ? `${Math.round((correct / answered) * 100)}%` : "—";
}

/**
 * Loads Home data once and on demand. Unlike useLoad, a refresh keeps the current data on screen
 * (no flash back to the skeleton) and only a failed first load shows the error page.
 */
export function useHomeData() {
  const [data, setData] = useState<HomeData>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const request = useRef(0);

  const load = useCallback(() => {
    const id = ++request.current;
    setLoading(true);
    setError("");
    loadHome()
      .then((next) => {
        if (id === request.current) setData(next);
      })
      .catch((cause: unknown) => {
        if (id === request.current) setError(readableError(cause));
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
    return () => {
      request.current++;
    };
  }, [load]);

  return { data, error, loading, reload: load };
}
