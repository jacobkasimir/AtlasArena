// Pure helpers for the phone quiz (no React, no API calls). The server decides scores and correctness;
// these functions only filter setup choices and map server responses to what the screens show.
import { categories, difficulties, modes, rank } from "@shared/domain";
import type { Difficulty, Mode, QuizCatalogRow, Review, View } from "@shared/domain";
import { oneOf } from "@shared/prefs";
import type { AnswerState } from "@phone/ui";

export const topics = ["all", ...categories] as const;

/** Practice rounds can be shorter; arena_start accepts 1–10 questions, Classic always uses 10. */
export const practiceLengths = [5, 10] as const;

export type QuizSetupChoice = {
  mode: Mode;
  difficulty: Difficulty;
  category: string;
  count: number;
  country?: string;
};

/** Questions a round needs before it can start (same rule as arena_start and the demo engine). */
export function neededQuestions(mode: Mode, count: number) {
  return mode === "classic" ? 10 : mode === "practice" ? count : 1;
}

/**
 * Published questions for a topic and difficulty, filtered exactly like arena_start: Endless takes the
 * chosen tier and harder ones, the other modes only that tier, and Classic only multiple choice.
 * Returns null while the catalog is unknown (loading or unavailable): the server then decides.
 */
export function availableQuestions(
  rows: QuizCatalogRow[] | null,
  mode: Mode,
  topic: string,
  level: Difficulty,
): number | null {
  if (!rows) return null;
  return rows
    .filter(
      (row) =>
        (topic === "all" || row.topic === topic) &&
        (mode === "endless" ? rank(row.difficulty) >= rank(level) : row.difficulty === level) &&
        (mode !== "classic" || row.kind === "mc"),
    )
    .reduce((sum, row) => sum + row.count, 0);
}

/** True when the combination can fill a round (or when the catalog is unknown). */
export function canFill(rows: QuizCatalogRow[] | null, choice: Pick<QuizSetupChoice, "mode" | "category" | "difficulty" | "count">) {
  const count = availableQuestions(rows, choice.mode, choice.category, choice.difficulty);
  return count === null || count >= neededQuestions(choice.mode, choice.count);
}

/** Topics worth showing: every topic with published questions, plus the current choice. */
export function visibleTopics(rows: QuizCatalogRow[] | null, current: string) {
  return topics.filter((topic) => topic === "all" || !rows || topic === current || rows.some((row) => row.topic === topic));
}

/** Setup from URL parameters first (Play again / Change setup links), then the remembered setup. */
export function initialSetup(params: URLSearchParams, saved: Record<string, unknown>): QuizSetupChoice {
  const mode = oneOf(params.get("mode") ?? saved.mode, modes, "classic");
  const difficulty = oneOf(params.get("difficulty") ?? saved.difficulty, difficulties, "easy");
  const category = oneOf(params.get("category") ?? saved.category, topics, "all");
  const country = params.get("country") || undefined;
  const fromUrl = Number(params.get("count"));
  const fromSaved = Number(saved.count);
  const count =
    Number.isInteger(fromUrl) && fromUrl >= 1 && fromUrl <= 10
      ? fromUrl
      : Number.isInteger(fromSaved) && fromSaved >= 1 && fromSaved <= 10
        ? fromSaved
        : country && mode === "practice"
          ? 4
          : 10;
  return { mode, difficulty, category, count, country };
}

export function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

export function topicLabel(topic: string) {
  return topic === "all" ? "Everything" : capitalize(topic);
}

/** Visual state of one answer option, from the server's feedback (never computed on the client). */
export function optionState(label: string, optionId: string, feedback: Review | null, selectedId: string | null): AnswerState {
  if (feedback) {
    if (label === feedback.correctAnswer) return feedback.correct ? "correct" : "missed";
    if (label === feedback.chosen && !feedback.correct) return "wrong";
    return "idle";
  }
  return selectedId === optionId ? "selected" : "idle";
}

export function isActive(view: Pick<View, "status"> | undefined) {
  return Boolean(view && view.status !== "completed" && view.status !== "abandoned");
}

export function friendlyQuizError(message: string) {
  if (/not enough|insufficient|empty|no eligible|pool|required/i.test(message))
    return "There aren't enough questions for that combination yet. Try another difficulty or topic.";
  if (/RATE_LIMIT/i.test(message)) return "Slow down a little – try again in a moment.";
  if (/AUTH_REQUIRED/.test(message)) return "Your session has ended. Sign in or continue as guest to keep playing.";
  return message;
}

export function resultHeadline(correct: number, incorrect: number) {
  const total = correct + incorrect;
  if (incorrect === 0 && correct > 0) return "Flawless!";
  const share = total ? correct / total : 0;
  return share >= 0.8 ? "Great run!" : share >= 0.5 ? "Solid run." : total ? "Keep practising." : "Run complete.";
}
