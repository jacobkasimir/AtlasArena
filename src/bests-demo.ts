// Personal bests and statistics for the demo build, computed from each game's device-local store.
import { capitalsDemo } from "./capitals-demo";
import { flagsDemo } from "./flags-demo";
import type { GameStats, PersonalBest } from "./game-setup";
import { recallDemo } from "./recall-demo";

type Run = Omit<PersonalBest, "runCount"> & { key: string };

function bestPerSetup(runs: Run[], better: (a: Run, b: Run) => number): PersonalBest[] {
  const groups = new Map<string, Run[]>();
  for (const run of runs) groups.set(run.key, [...(groups.get(run.key) ?? []), run]);
  return [...groups.values()].map((group) => {
    const { key, ...best } = [...group].sort(better)[0];
    void key;
    return { ...best, runCount: group.length };
  });
}

const byScore = (a: Run, b: Run) => b.score - a.score || a.elapsedMs - b.elapsedMs;

export async function demoPersonalBests(): Promise<PersonalBest[]> {
  const flags: Run[] = flagsDemo.sessions().filter((s) => s.state === "completed" && !s.sampleSize).map((s) => ({
    key: s.poolSignature, game: "flags", mode: s.direction, scope: s.scope ?? "all", region: s.region, pool: s.poolTier,
    selectedCodes: s.selectedCodes ?? [], timeLimitSeconds: s.timeLimitSeconds ?? null, total: s.total, correct: s.correct,
    score: s.score, maxScore: s.maxScore, elapsedMs: s.elapsedMs ?? 0, completedAt: s.completedAt ?? "",
  }));
  const capitals: Run[] = capitalsDemo.sessions().filter((s) => s.state === "completed" && !s.sampleSize).map((s) => ({
    key: `${s.direction}|${s.poolSignature}`, game: "capitals", mode: s.direction, scope: s.scope ?? "all", region: s.region, pool: s.poolMode,
    selectedCodes: s.poolMode === "manual" ? s.selectedCodes : [], timeLimitSeconds: s.timeLimitSeconds ?? null, total: s.total,
    correct: s.correct, score: s.score, maxScore: s.total * 100, elapsedMs: s.elapsedMs ?? 0, completedAt: s.completedAt ?? "",
  }));
  const recall: Run[] = recallDemo.sessions().filter((s) => s.state === "completed" && s.signature).map((s) => ({
    key: s.signature!, game: "recall", mode: s.kind, scope: s.scope, region: s.region, pool: s.pool ?? "all",
    selectedCodes: s.picks ?? [], timeLimitSeconds: s.timeLimitSeconds, total: s.total, correct: s.found, score: s.found,
    maxScore: s.total, elapsedMs: s.elapsedMs ?? 0, completedAt: s.completedAt ?? "",
  }));
  return [...bestPerSetup(flags, byScore), ...bestPerSetup(capitals, byScore), ...bestPerSetup(recall, byScore)]
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

export async function demoGameStats(): Promise<GameStats> {
  const stat = (rows: { correct: number; answered: number; elapsedMs: number | null; completedAt: string | null; codes: string[] }[]) => ({
    rounds: rows.length,
    correct: rows.reduce((sum, row) => sum + row.correct, 0),
    answered: rows.reduce((sum, row) => sum + row.answered, 0),
    timeMs: rows.reduce((sum, row) => sum + (row.elapsedMs ?? 0), 0),
    lastPlayedAt: rows.map((row) => row.completedAt ?? "").sort().at(-1) || null,
    places: new Set(rows.flatMap((row) => row.codes)).size,
  });
  return {
    flags: stat(flagsDemo.sessions().filter((s) => s.state === "completed").map((s) => ({
      correct: s.correct, answered: s.correct + s.incorrect + s.skipped, elapsedMs: s.elapsedMs, completedAt: s.completedAt,
      codes: s.entries.filter((e) => e.outcome === "correct").map((e) => e.id),
    }))),
    capitals: stat(capitalsDemo.sessions().filter((s) => s.state === "completed").map((s) => ({
      correct: s.correct, answered: s.correct + s.incorrect + s.skipped, elapsedMs: s.elapsedMs, completedAt: s.completedAt,
      codes: s.entries.filter((e) => e.outcome === "correct").map((e) => e.countryCode),
    }))),
    recall: stat(recallDemo.sessions().filter((s) => s.state === "completed").map((s) => ({
      correct: s.found, answered: s.total, elapsedMs: s.elapsedMs, completedAt: s.completedAt,
      codes: s.entries.filter((e) => e.foundAt).map((e) => e.code),
    }))),
  };
}
