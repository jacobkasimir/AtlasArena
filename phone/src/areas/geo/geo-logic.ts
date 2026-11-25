// Pure helpers for the phone Flags and Capitals screens. The server (or the demo engine) decides correctness,
// points and deadlines; these functions only turn its responses into text and layout decisions.
import type { GameChoice } from "@shared/game-setup";
import type { CapitalSession, FlagsAnswerOption, FlagsChoice, FlagsEntry, FlagsSession } from "@shared/domain";

export const requestId = () => crypto.randomUUID();

/** Taps on "Next" this soon after feedback appeared are treated as an accidental double tap. */
export const NEXT_TAP_GUARD_MS = 350;
/** Flags shown per page in the Country → Flag grid. */
export const FLAG_PAGE_SIZE = 24;

/**
 * Flags are served only from /public/flags/<alpha2>.svg (CLAUDE.md rule 15). The server may send a
 * flags.restcountries.com URL; we map it to the local file with the same code and never load anything else.
 */
export function localFlagSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  const local = url.match(/^\/flags\/([a-z]{2})\.svg$/i);
  if (local) return `/flags/${local[1].toLowerCase()}.svg`;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "flags.restcountries.com") return null;
    const code = parsed.pathname.match(/\/([a-z]{2})\.svg$/i)?.[1];
    return code ? `/flags/${code.toLowerCase()}.svg` : null;
  } catch {
    return null;
  }
}

export const flagFromAlpha2 = (code: string | null | undefined) =>
  code && /^[a-z]{2}$/i.test(code) ? `/flags/${code.toLowerCase()}.svg` : null;

export const ordinal = (attempt: number) => (attempt === 1 ? "first" : attempt === 2 ? "second" : "third");

/** Correct answers in a row at the end of the answered entries. */
export function trailingStreak(entries: { position: number; outcome: string }[]) {
  const done = entries.filter((entry) => entry.outcome !== "pending").sort((a, b) => a.position - b.position);
  let count = 0;
  for (let i = done.length - 1; i >= 0 && done[i].outcome === "correct"; i--) count++;
  return count;
}

export const flagsChoiceOf = (s: FlagsSession): GameChoice => ({
  mode: s.direction,
  scope: s.scope ?? "all",
  region: s.region,
  pool: s.poolTier,
  picks: s.poolTier === "manual" ? (s.selectedCodes ?? []) : [],
  size: s.sampleSize ?? null,
  limit: s.timeLimitSeconds ?? null,
});

export const capitalsChoiceOf = (s: CapitalSession): GameChoice => ({
  mode: s.direction,
  scope: s.scope ?? "all",
  region: s.region,
  pool: s.poolMode,
  picks: s.poolMode === "manual" ? s.selectedCodes : [],
  size: s.sampleSize ?? null,
  limit: s.timeLimitSeconds ?? null,
});

export type Tone = "success" | "error" | "warning" | "info";
export type Feedback = { tone: Tone; text: string } | null;

/** Feedback line for a Flags action result (server outcome codes). */
export function flagsActionFeedback(session: FlagsSession, attemptsBefore: number): Feedback {
  const result = session.actionResult;
  const current = session.current;
  if (!result) {
    if (current?.outcome === "skipped") return { tone: "warning", text: "Skipped · 0 points." };
    return null;
  }
  switch (result.outcome) {
    case "wrong_choice":
      return {
        tone: "error",
        text: `Wrong flag. ${result.remainingAttempts} ${result.remainingAttempts === 1 ? "try" : "tries"} left.`,
      };
    case "duplicate_choice":
      return { tone: "info", text: "You already tried that flag. Pick another one." };
    case "ambiguous":
      return { tone: "warning", text: "That name fits more than one place – please be more specific." };
    case "not_solved":
      return { tone: "error", text: "Not solved · 0 points. The correct flag is marked." };
    case "correct":
      return session.direction === "country_to_flag"
        ? { tone: "success", text: `Correct · ${ordinal(attemptsBefore + 1)} try · ${current?.points ?? 0} points.` }
        : { tone: "success", text: `Correct · ${current?.points ?? 0} points.` };
    default:
      return { tone: "error", text: "Not quite · 0 points." };
  }
}

/** Feedback for an entry that is already finished when the screen (re)loads. */
export function flagsEntryFeedback(direction: FlagsSession["direction"], entry: FlagsEntry | null): Feedback {
  if (!entry) return null;
  if (entry.outcome === "pending") {
    if (direction === "country_to_flag" && entry.attempts > 0) {
      const left = Math.max(0, 3 - entry.attempts);
      return { tone: "error", text: `Wrong flag. ${left} ${left === 1 ? "try" : "tries"} left.` };
    }
    return null;
  }
  if (entry.outcome === "correct")
    return {
      tone: "success",
      text:
        direction === "country_to_flag"
          ? `Correct · ${ordinal(entry.attempts)} try · ${entry.points} points.`
          : `Correct · ${entry.points} points.`,
    };
  if (entry.outcome === "skipped") return { tone: "warning", text: "Skipped · 0 points." };
  return {
    tone: "error",
    text: direction === "country_to_flag" ? "Not solved · 0 points. The correct flag is marked." : "Not quite · 0 points.",
  };
}

export function capitalsActionFeedback(session: CapitalSession): Feedback {
  const result = session.actionResult;
  if (!result) return null;
  if (result.outcome === "ambiguous")
    return {
      tone: "warning",
      text: "That name fits more than one place – please be more specific. No attempt was used.",
    };
  if (result.outcome === "correct") {
    const lang = result.lang === "de" ? " · accepted in German" : result.lang === "fr" ? " · accepted in French" : "";
    return { tone: "success", text: `Correct · 100 points${lang}.` };
  }
  if (result.outcome === "skipped") return { tone: "warning", text: "Skipped · 0 points." };
  return { tone: "error", text: "Not quite · 0 points." };
}

export function capitalsEntryFeedback(entry: CapitalSession["current"]): Feedback {
  if (!entry || entry.outcome === "pending") return null;
  if (entry.outcome === "correct") return { tone: "success", text: `Correct · ${entry.points} points.` };
  if (entry.outcome === "skipped") return { tone: "warning", text: "Skipped · 0 points." };
  return { tone: "error", text: "Not quite · 0 points." };
}

export function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase().trim();
}

/** Country suggestions for Flag → Country (the desktop combobox uses the same prefix rule). */
export function countrySuggestions(options: FlagsAnswerOption[], typed: string, limit = 6) {
  const query = normalizeSearch(typed);
  if (!query) return [];
  return options
    .filter(
      (option) =>
        normalizeSearch(option.name).startsWith(query) || normalizeSearch(option.alpha2 ?? "") === query,
    )
    .slice(0, limit);
}

export type ChoiceStatus = "open" | "wrong" | "solved" | "missed" | "answer";

/**
 * State of one flag in the Country → Flag grid for the current question:
 * wrong = tried and wrong for this question · answer = the right flag (after the question finished) ·
 * solved = the right flag of an earlier question · missed = an earlier question nobody found · open = pickable.
 */
export function choiceStatus(
  choice: FlagsChoice,
  current: FlagsEntry | null,
  outcomeOf: (choice: FlagsChoice) => { outcome: string } | undefined,
): ChoiceStatus {
  if (current?.wrongChoiceIds.includes(choice.id)) return "wrong";
  const finished = current && current.outcome !== "pending";
  if (finished && current.correctChoiceId && current.correctChoiceId === choice.id) return "answer";
  const outcome = outcomeOf(choice)?.outcome;
  if (outcome === "correct") return "solved";
  if (outcome === "incorrect" || outcome === "skipped") return "missed";
  return "open";
}

export function pageCount(total: number, size = FLAG_PAGE_SIZE) {
  return Math.max(1, Math.ceil(total / size));
}

/** Entries with the current entry's latest state merged in (the server may send `current` fresher than `entries`). */
export function mergedEntries<E extends { id: string; position: number; outcome: string }>(entries: E[], current: E | null | undefined) {
  if (!current) return entries;
  const known = entries.some((entry) => entry.id === current.id);
  return known ? entries.map((entry) => (entry.id === current.id ? current : entry)) : [...entries, current];
}

/** Server streak after the latest answer: correct answers in a row, the current entry included. */
export function roundStreak(session: { entries: { id: string; position: number; outcome: string }[]; current?: { id: string; position: number; outcome: string } | null }) {
  return trailingStreak(mergedEntries(session.entries, session.current ?? null));
}

/**
 * How a server action result maps to game feel: "right"/"wrong" = an answer the server accepted and judged
 * (fire feel.answer once), "gentle" = nothing was used up (be more specific / already tried), null = no answer.
 */
export type AnswerFeel = "right" | "wrong" | "gentle" | null;

export function flagsAnswerFeel(outcome: string | undefined): AnswerFeel {
  if (!outcome) return null;
  if (outcome === "correct") return "right";
  if (outcome === "ambiguous" || outcome === "duplicate_choice") return "gentle";
  if (outcome === "wrong_choice" || outcome === "not_solved" || outcome === "incorrect") return "wrong";
  return null; // skip, hint, …
}

export function capitalsAnswerFeel(outcome: string | undefined): AnswerFeel {
  if (outcome === "correct") return "right";
  if (outcome === "incorrect") return "wrong";
  if (outcome === "ambiguous") return "gentle";
  return null;
}

/** Results order: mistakes first (incorrect, then skipped), then correct; round order inside each group. */
export function mistakesFirst<E extends { position: number; outcome: string }>(entries: E[]): E[] {
  const rank = (outcome: string) => (outcome === "incorrect" ? 0 : outcome === "skipped" ? 1 : outcome === "correct" ? 3 : 2);
  return [...entries].sort((a, b) => rank(a.outcome) - rank(b.outcome) || a.position - b.position);
}

/** Short word for a finished entry on the results screen. */
export function outcomeWord(outcome: string) {
  return outcome === "correct" ? "Correct" : outcome === "skipped" ? "Skipped" : outcome === "incorrect" ? "Incorrect" : "Open";
}

/** One-line results headline from accuracy (the medal tier itself comes from ResultHero). */
export function resultHeadline(correct: number, total: number, timeUp = false) {
  const ratio = total > 0 ? correct / total : 0;
  const lead = ratio >= 0.9 ? "Outstanding!" : ratio >= 0.7 ? "Great round!" : ratio >= 0.5 ? "Good effort!" : "Keep practising!";
  return timeUp ? `Time's up – ${lead.toLowerCase().replace("!", "")}!` : lead;
}

/** Ranked = counts for personal bests: not a random sample / practice round. */
export function isRanked(round: { ranked?: boolean; sampleSize?: number | null; finalBadge?: string | null }) {
  return round.ranked !== false && !round.sampleSize && round.finalBadge !== "unranked";
}
