// Pure logic for Category Elimination's candidate lists ("which places fit up to this clue?").
import type {
  EliminationCandidate,
  EliminationCandidates,
  EliminationDifficulty,
  EliminationHint,
  EliminationView,
} from "./domain";

/**
 * - `kept`: still fits the next clue.
 * - `ruledOut`: fits up to this clue, but the next clue removes it.
 * - `answer`: the list of the last clue – the group's unique answer.
 * - `fits`: a hint list – fits every clue so far; what the next clue keeps is not revealed.
 */
export type CandidateStatus = "kept" | "ruledOut" | "answer" | "fits";
export type CandidateFilter = "all" | "kept" | "ruledOut";

export type CandidateRow = EliminationCandidate & {
  status: CandidateStatus;
  /** True when the player named this place for the selected clue. */
  pick: boolean;
  /** Clue steps (1-based) for which the player named this place, in this group. */
  pickedAt: number[];
};

export type StepSummary = { step: number; total: number; kept: number; ruledOut: number };

/** Lower case without accents, for search and alphabetical headings ("Côte d'Ivoire" → "cote d'ivoire"). */
export function foldName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.name.localeCompare(b.name);

/** Every place that fits clues 1..step (step is 1-based), sorted A–Z, with its status and the player's picks. */
export function candidatesAt(data: EliminationCandidates, step: number): CandidateRow[] {
  const size = data.steps.length;
  const pickedAt = new Map<string, number[]>();
  data.steps.forEach((item, index) => {
    if (!item.pick) return;
    pickedAt.set(item.pick.code, [...(pickedAt.get(item.pick.code) ?? []), index + 1]);
  });
  const pick = data.steps[step - 1]?.pick?.code ?? null;
  return data.places
    .filter((place) => place.depth >= step)
    .map((place) => ({
      ...place,
      status: (step >= size ? "answer" : place.depth > step ? "kept" : "ruledOut") as CandidateStatus,
      pick: place.code === pick,
      pickedAt: pickedAt.get(place.code) ?? [],
    }))
    .sort(byName);
}

/** How many places fit up to a clue, and how many of those the next clue keeps or rules out. */
export function stepSummary(data: EliminationCandidates, step: number): StepSummary {
  const rows = candidatesAt(data, step);
  const ruledOut = rows.filter((row) => row.status === "ruledOut").length;
  return { step, total: rows.length, kept: rows.length - ruledOut, ruledOut };
}

/** Search (accent-insensitive, matches anywhere in the name) and the kept / ruled-out filter. */
export function filterCandidates(rows: CandidateRow[], query: string, filter: CandidateFilter): CandidateRow[] {
  const needle = foldName(query);
  return rows.filter((row) => {
    if (filter === "kept" && row.status === "ruledOut") return false;
    if (filter === "ruledOut" && row.status !== "ruledOut") return false;
    return !needle || foldName(row.name).includes(needle);
  });
}

/** Groups an A–Z sorted list under its first letter; names that don't start with a letter go under "#". */
export function groupByLetter(rows: CandidateRow[]): { letter: string; rows: CandidateRow[] }[] {
  const groups: { letter: string; rows: CandidateRow[] }[] = [];
  for (const row of rows) {
    const first = foldName(row.name).charAt(0).toUpperCase();
    const letter = /^[A-Z]$/.test(first) ? first : "#";
    const last = groups[groups.length - 1];
    if (last && last.letter === letter) last.rows.push(row);
    else groups.push({ letter, rows: [row] });
  }
  return groups;
}

/** Next selected clue step (1-based) for arrow keys, Home and End in the step tabs; wraps around. */
export function nextStep(step: number, key: string, size: number): number {
  if (size <= 0) return step;
  if (key === "Home") return 1;
  if (key === "End") return size;
  if (key === "ArrowRight" || key === "ArrowDown") return step >= size ? 1 : step + 1;
  if (key === "ArrowLeft" || key === "ArrowUp") return step <= 1 ? size : step - 1;
  return step;
}

// ---------- Hints (mid-round) ----------

/** Hints a round allows, unless the server says otherwise (`hintLimit` in the view). */
export const DEFAULT_HINT_LIMIT = 3;

/**
 * What the hint button of one group (0-based index) can do right now:
 * - `owned`: the hint for this open clue was already bought – re-opening it is free.
 * - `available`: a hint can be bought (costs one, asks first).
 * - `noneLeft`: the round's hints are used up.
 * - `lastClue`: the open clue leaves a single place – its list would be the group's answer, so no hint.
 * - `closed`: the group is solved or the round is over.
 * The server makes the same checks; this only decides what the button shows.
 */
export type HintAvailability = "owned" | "available" | "noneLeft" | "lastClue" | "closed";

export function hintAvailability(view: EliminationView, groupIndex: number): HintAvailability {
  const group = view.groups[groupIndex];
  if (!group || view.state !== "active" || group.solved >= group.size) return "closed";
  const step = group.solved + 1;
  const open = group.steps[step - 1];
  if (step >= group.size || (open && open.remaining <= 1)) return "lastClue";
  const hints = view.hints ?? [];
  if (hints.some((hint) => hint.group === groupIndex + 1 && hint.step === step)) return "owned";
  return (view.hintsLeft ?? 0) > 0 ? "available" : "noneLeft";
}

/** Places in a hint, sorted A–Z. They all fit every clue so far; the player's earlier picks are tagged. */
export function hintRows(data: EliminationHint): CandidateRow[] {
  const pickedAt = new Map<string, number[]>();
  data.steps.forEach((item, index) => {
    if (!item.pick) return;
    pickedAt.set(item.pick.code, [...(pickedAt.get(item.pick.code) ?? []), index + 1]);
  });
  return data.places
    .filter((place) => place.depth >= data.step)
    .map((place) => ({ ...place, status: "fits" as CandidateStatus, pick: false, pickedAt: pickedAt.get(place.code) ?? [] }))
    .sort(byName);
}

/** Plain-English text for the server's hint errors. */
export function hintErrorText(message: string): string {
  if (message.includes("ELIMINATION_NO_HINTS_LEFT")) return "You have used every hint for this round.";
  if (message.includes("ELIMINATION_HINT_LAST_CLUE")) return "There is no hint for a clue that leaves a single place.";
  if (message.includes("ELIMINATION_GROUP_SOLVED")) return "This group is already solved.";
  if (message.includes("ELIMINATION_ROUND_OVER")) return "The round is over – every list is open now.";
  return message;
}

/* ------------------------------------------------------------------------ */
/* Setup texts shared by the desktop (src/Elimination.tsx) and phone app     */
/* ------------------------------------------------------------------------ */

export type EliminationDifficultyInfo = { id: EliminationDifficulty; label: string; text: string };

/** The three difficulties in display order, with the label and the one-line description shown in both setups. */
export const ELIMINATION_DIFFICULTIES: readonly EliminationDifficultyInfo[] = [
  { id: "easy", label: "Easy", text: "UN member states · 4 clues per group · well-known countries · 5 minutes" },
  { id: "medium", label: "Medium", text: "UN member states · 5 clues · memberships, languages and borders · 5 minutes" },
  { id: "hard", label: "Hard", text: "Countries and territories · 5 clues · subregions and density · 4 minutes" },
];

/** Display label of a difficulty ("Easy"); falls back to the id. */
export function eliminationDifficultyLabel(id: EliminationDifficulty): string {
  return ELIMINATION_DIFFICULTIES.find((item) => item.id === id)?.label ?? id;
}

/** One "How it works" step: `lead` is shown in bold, `text` follows it. */
export type HowItWorksStep = { lead: string; text: string };
/** The words that differ between a mouse/keyboard and a touch screen. */
export type EliminationDevice = "desktop" | "phone";

const deviceWords: Record<EliminationDevice, { select: string; submit: string }> = {
  desktop: { select: "select", submit: "press Enter" },
  phone: { select: "tap", submit: "tap Go" },
};

/** "How it works" for the Elimination setup, in the device's words ("press Enter" / "tap Go"). */
export function eliminationHowItWorks(device: EliminationDevice): HowItWorksStep[] {
  const words = deviceWords[device];
  return [
    { lead: "Name any place that fits the first clue", text: " of a group – that reveals the next clue." },
    {
      lead: "Every new answer must fit all clues shown so far",
      text: " in that group. One answer can move several groups.",
    },
    {
      lead: "The number beside a clue",
      text: ` is how many places still fit. The last clue leaves exactly one. After the round, ${words.select} it to see every place that fit.`,
    },
    {
      lead: "Type in English, German or French",
      text: ` and ${words.submit}. Wrong guesses cost nothing but time.`,
    },
    {
      lead: "Stuck? Use a hint",
      text:
        ` (${DEFAULT_HINT_LIMIT} per round): it lists every place that fits a group's open clue. There is no hint for a` +
        " clue that leaves a single place, and a round with a hint never counts as your personal best.",
    },
  ];
}
