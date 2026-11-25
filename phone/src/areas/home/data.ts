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
import { describeSetup, regionLabel } from "@shared/game-setup";
import type { GameStats, PersonalBest } from "@shared/game-setup";
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
  return { kind: "link", label: "Choose a game", to: paths.games };
}

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
