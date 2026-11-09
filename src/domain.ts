export const modes = ["classic", "practice", "timed", "endless"] as const;
export type Mode = typeof modes[number];
export const difficulties = ["easy", "medium", "hard", "expert"] as const;
export type Difficulty = typeof difficulties[number];
export const avatars = ["🌍", "🧭", "🚀", "🏔️"] as const;
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
  source: string;

  officialName?: string | null;
  catalogKind?: "iso_alpha2" | "non_iso";
  flagEmoji?: string | null;
  flagSvgUrl?: string | null;
  flagPngUrl?: string | null;
  population?: number | null;
  areaKm2?: number | null;
  languages?: string[];
  translations?: Record<string, string>;
  currencies?: { code: string | null; name: string; symbol: string | null }[];
  borders?: string[];
  memberships?: { name: string; member: boolean }[] | null;
  callingCodes?: string[];
  topLevelDomains?: string[];
  wikipediaUrl?: string | null;
  sourceUrl?: string | null;

  // Published questions matching the country's practice difficulty.
  practiceQuestionCount?: number;
};
