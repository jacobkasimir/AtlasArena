import countryFlagCodes from "./country-flag-codes.json";

export const modes = ["classic", "practice", "timed", "endless"] as const;
export type Mode = typeof modes[number];
export const difficulties = ["easy", "medium", "hard", "expert"] as const;
export type Difficulty = typeof difficulties[number];
const starterAvatars = ["🌍", "🧭", "🚀", "🏔️", "✈️", "🗿", "📸", "🇦🇽", "🇦🇫", "🇺🇳", "🇧🇸"];
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryAvatarData = countryFlagCodes.map(code => ({
  code,
  emoji: String.fromCodePoint(...Array.from(code, letter => 127397 + letter.charCodeAt(0))),
  name: regionNames.of(code) ?? code
}));
const avatarLabelsByEmoji = new Map(countryAvatarData.map(option => [option.emoji, `${option.code} · ${option.name}`]));
const genericAvatarLabels = new Map([["🌍", "World"], ["🧭", "Compass"], ["🚀", "Rocket"], ["🏔️", "Mountain"], ["✈️", "Airplane"], ["🗿", "Moai"], ["📸", "Camera"]]);
export const avatars = [...new Set([...starterAvatars, ...countryAvatarData.map(option => option.emoji)])];
export const avatarLabels = avatars.map(emoji => avatarLabelsByEmoji.get(emoji) ?? genericAvatarLabels.get(emoji) ?? "Avatar");
export const countryFlagAvatarCount = countryAvatarData.length;
export function normalizeUsername(value: string) { return value.trim(); }
export function validUsername(value: string) { return /^[A-Za-z0-9 _-]{2,24}$/.test(normalizeUsername(value)); }

export const categories = [
  "countries", "flags", "capitals", "cities", "regions", "borders",
  "population", "languages", "currencies", "physical", "landmarks",
  "maps", "europe", "political", "continents"
];

export type Option = { id: string; label: string };
type BaseQuestion = {
  id: string;
  prompt: string;
  category: string;
  subcategory: string;
  difficulty: Difficulty;
};

export type PlayableQuestion = BaseQuestion & {
  type: "mc" | "tf";
  options: Option[];
};

// Reserved schema branches cannot be inserted into playable sessions.
export type FutureQuestion =
  | (BaseQuestion & { type: "text"; normalization: "casefold" })
  | (BaseQuestion & { type: "map"; dataset: string })
  | (BaseQuestion & { type: "image"; asset: string })
  | (BaseQuestion & { type: "ordering"; items: Option[] });

export type State =
  | "awaiting_answer"
  | "showing_feedback"
  | "completed"
  | "abandoned";

export type Review = {
  questionId: string;
  prompt: string;
  chosen: string;
  correctAnswer: string;
  correct: boolean;
  explanation: string;
  source: string;
  points: number;
  responseMs: number;
  subcategory: string;
};

export type Stats = {
  score: number;
  correct: number;
  incorrect: number;
  streak: number;
  bestStreak: number;
  averageMs: number;
  xp: number;
};

export type View = {
  id: string;
  version: number;
  mode: Mode;
  difficulty: Difficulty;
  status: State;
  serverNow: string;
  deadline: string | null;
  current: PlayableQuestion | null;
  feedback: Review | null;
  reviews: Review[];
  stats: Stats;
  total: number;
  answered: number;
};

export type ResultView = View & {
  categories: string[] | null;
  country: string | null;
  questionCount: number | null;
  contextSaved: boolean;
  previousBest: number | null;
};

export function setsNewPersonalBest(mode: Mode, scoreValue: number, previousBest: number | null) {
  return mode !== "practice" && (previousBest === null || scoreValue > previousBest);
}

export function challengeSetupUrl(selection: Pick<ResultView, "mode" | "difficulty" | "categories" | "country" | "questionCount">) {
  const params = new URLSearchParams({ mode: selection.mode, difficulty: selection.difficulty });
  if (selection.categories?.length) params.set("category", selection.categories[0]);
  if (selection.country) params.set("country", selection.country);
  if (selection.questionCount) params.set("count", String(selection.questionCount));
  return `/home?${params.toString()}`;
}

export type Summary = {
  id: string;
  mode: Mode;
  difficulty: Difficulty;
  status: State;
  score: number;
  correct: number;
  incorrect: number;
  createdAt: string;
};

export type Profile = {
  username: string;
  avatar: number;
  favorites: string[];
  xp: number;
  admin?: boolean;
};

export type Dashboard = {
  profile: Profile;
  totals: { games: number; correct: number; incorrect: number };
  best: Partial<Record<Mode, number>>;
  sessions: Summary[];
};

export type LeaderboardPlayer = {
  rank: number;
  username: string;
  avatar: number;
  xp: number;
};
export type Leaderboard = {
  currentRank: number | null;
  players: LeaderboardPlayer[];
};

export type Country = {
  code: string;
  name: string;
  officialName: string;
  capital: string;
  region: string;
  currency: string;
  flag: string;
  difficulty: Difficulty;
  source: string;
};

export const rank = (d: Difficulty) => difficulties.indexOf(d);
export const level = (xp: number) => 1 + Math.floor(Math.max(0, xp) / 500);

export function score(
  correct: boolean,
  difficulty: Difficulty,
  newStreak: number,
  remainingMs?: number,
  questionLimitMs?: number
) {
  if (!correct) return 0;
  const multiplier = [1, 1.25, 1.5, 2][rank(difficulty)];
  const speed = questionLimitMs && remainingMs !== undefined
    ? Math.round(50 * Math.max(0, Math.min(1, remainingMs / questionLimitMs)))
    : 0;
  return Math.round(100 * multiplier)
    + speed
    + Math.min(50, 10 * Math.max(0, newStreak - 1));
}

export const eligibleXP = (mode: Mode, correct: number, answered: number) =>
  mode === "practice" || answered === 0 ? 0 : 20 + correct * 10;

export function canTransition(from: State, to: State) {
  const allowed: Record<State, State[]> = {
    awaiting_answer: ["showing_feedback", "completed", "abandoned"],
    showing_feedback: ["awaiting_answer", "completed", "abandoned"],
    completed: [],
    abandoned: []
  };
  return allowed[from].includes(to);
}

export const expired = (deadline: number | null, now: number) =>
  deadline !== null && now >= deadline;

export function validateOption(q: PlayableQuestion, optionId: string) {
  return q.options.some(o => o.id === optionId);
}

export function eligibleDifficulty(
  actual: Difficulty,
  requested: Difficulty,
  mode: Mode,
  answered = 0
) {
  return mode === "endless"
    ? rank(actual) >= rank(requested)
      && rank(actual) <= Math.min(3, rank(requested) + Math.floor(answered / 5))
    : actual === requested;
}

export function shuffle<T>(values: T[], random = Math.random): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export type ExplorerCountry = {
  code: string;
  name: string;
  capital: string | null;
  region: string;
  currency: string | null;
  flag: string | null;
  difficulty: Difficulty;
  officialName?: string | null;
  catalogKind?: "iso_alpha2" | "non_iso";
  flagEmoji?: string | null;
  flagSvgUrl?: string | null;
  flagPngUrl?: string | null;
  population?: number | null;
  codeAlpha3?: string | null;
  borders?: string[] | null;
  areaKm2?: number | null;
  languages?: string[];
  translations?: Record<string, string>;
  currencies?: { code: string | null; name: string; symbol: string | null }[];
  neighbors?: ExplorerNeighbor[];
  memberships?: { name: string; member: boolean }[] | null;
  callingCodes?: string[];
  topLevelDomains?: string[];
  wikipediaUrl?: string | null;
  googleMapsUrl?: string | null;

  // Published questions matching the country's practice difficulty.
  practiceQuestionCount?: number;
};

export type ExplorerNeighbor = {
  alpha3: string;
  code: string | null;
  name: string | null;
};

export type FlagsDirection = "country_to_flag" | "flag_to_country";
export type FlagsPoolTier = "easy" | "all";
export type FlagsOutcome = "pending" | "correct" | "incorrect" | "skipped";
export type FlagsEntry = {
  id: string; position: number; choicePosition?: number; name: string | null; region: string | null;
  outcome: FlagsOutcome; attempts: number; wrongChoiceIds: string[]; hintUsed: boolean;
  points: number; flagSvgUrl: string | null; flagPngUrl: string | null;
  flagDescription: string | null; correctChoiceId: string | null;
  choices?: FlagsChoice[] | null;
};
export type FlagsChoice = Pick<FlagsEntry, "id" | "flagSvgUrl" | "flagPngUrl" | "flagDescription"> & {
  choicePosition?: number;
  name?: string | null;
};
export type FlagsAnswerOption = { alpha2: string | null; name: string };
export type FlagsRegion = {
  id: string; name: string; easyCount: number; allCount: number;
  easyMissingAssets: number; allMissingAssets: number; easyTierExcluded: number;
  unsupportedDifficulty: number;
};
export type FlagsSetup = {
  regions: FlagsRegion[];
  summary: Omit<FlagsRegion, "id" | "name">;
  activeSessions: { id: string; direction: FlagsDirection; region: string | null; poolTier: FlagsPoolTier; total: number; answered: number; score: number; createdAt: string; paused: boolean }[];
  rulesVersion: number; competitiveXp: false;
};
export type FlagsSession = {
  id: string; direction: FlagsDirection; region: string | null; poolTier: FlagsPoolTier;
  poolSignature: string; rulesVersion: number; state: "active" | "paused" | "completed" | "abandoned"; paused: boolean;
  pausedAt?: string | null; pausedTotalMs?: number;
  createdAt: string; completedAt: string | null; elapsedMs: number | null; serverNow: string;
  total: number; maxScore: number; currentPosition?: number; answered: number; score: number; correct: number; incorrect: number;
  skipped: number; hintsUsed: number; current: FlagsEntry | null; entries: FlagsEntry[];
  answerOptions?: FlagsAnswerOption[];
  finalBadge: "first_run" | "new_best" | "not_best" | null;
  topFive: { id: string; score: number; maxScore: number; elapsedMs: number; correct: number; incorrect: number; skipped: number; completedAt: string }[];
  choices?: FlagsChoice[] | null;
  actionResult?: { type: string; outcome: string; remainingAttempts: number };
};

export type FlagsBestBoard = {
  direction: FlagsDirection;
  region: string | null;
  poolTier: FlagsPoolTier;
  poolVersion: number;
  total: number;
  runCount: number;
  topFive: {
    score: number;
    maxScore: number;
    elapsedMs: number;
    correct: number;
    incorrect: number;
    skipped: number;
    hintsUsed: number;
    completedAt: string;
  }[];
};
