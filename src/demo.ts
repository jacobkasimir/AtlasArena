import bank from "./demo-content.json";
import countryData from "./demo-countries.json";
import {
  Dashboard, Difficulty, Mode, PlayableQuestion, Profile, Review, ResultView, State,
  Summary, View, Country, eligibleDifficulty, eligibleXP, expired, rank,
  score, shuffle, validateOption
} from "./domain";

type Question = PlayableQuestion & {
  correct: string;
  explanation: string;
  source: string;
  countryCode: string;
};
type Session = {
  id: string;
  mode: Mode;
  difficulty: Difficulty;
  status: State;
  version: number;
  createdAt: string;
  deadline: number | null;
  started: number;
  categories?: string[];
  country?: string | null;
  questionCount?: number;
  pool: Question[];
  currentId: string | null;
  reviews: Review[];
};
type Store = {
  profile: Profile;
  sessions: Session[];
};
const KEY = "atlas-demo-v1";

function read(): Store {
  const raw = localStorage.getItem(KEY);
  if (!raw) return {
    profile: { username: "Traveler", avatar: 0, favorites: [], xp: 0 },
    sessions: []
  };
  try { return JSON.parse(raw); }
  catch { throw new Error("Demo storage is unreadable. Export or reset it in Settings."); }
}
function write(s: Store) { localStorage.setItem(KEY, JSON.stringify(s)); }
function find(s: Store, id: string) {
  const session = s.sessions.find(x => x.id === id);
  if (!session) throw new Error("Session not found on this device.");
  return session;
}
function stats(s: Session) {
  let streak = 0, bestStreak = 0;
  for (const r of s.reviews) {
    streak = r.correct ? streak + 1 : 0;
    bestStreak = Math.max(bestStreak, streak);
  }
  const correct = s.reviews.filter(r => r.correct).length;
  return {
    score: s.reviews.reduce((n, r) => n + r.points, 0),
    correct,
    incorrect: s.reviews.length - correct,
    streak,
    bestStreak,
    averageMs: s.reviews.length
      ? s.reviews.reduce((n, r) => n + r.responseMs, 0) / s.reviews.length : 0,
    xp: s.status === "completed" ? eligibleXP(s.mode, correct, s.reviews.length) : 0
  };
}
function finish(s: Session) {
  if (s.status === "completed" || s.status === "abandoned") return;
  s.status = "completed";
  s.currentId = null;
  s.version++;
}
function selectNext(s: Session) {
  const used = new Set(s.reviews.map(r => r.questionId));
  const eligible = s.pool.filter(q =>
    !used.has(q.id)
    && eligibleDifficulty(q.difficulty, s.difficulty, s.mode, s.reviews.length)
  );
  if (s.mode === "endless")
    eligible.sort((a, b) => rank(b.difficulty) - rank(a.difficulty));
  const next = eligible[0];
  if (!next) { finish(s); return; }
  s.currentId = next.id;
  s.started = Date.now();
  s.status = "awaiting_answer";
  s.version++;
}
function render(s: Session): View {
  const q = s.pool.find(q => q.id === s.currentId);
  return {
    id: s.id, mode: s.mode, difficulty: s.difficulty,
    version: s.version, status: s.status,
    serverNow: new Date().toISOString(),
    deadline: s.deadline ? new Date(s.deadline).toISOString() : null,
    current: q ? {
      id: q.id, prompt: q.prompt, category: q.category,
      subcategory: q.subcategory, difficulty: q.difficulty,
      type: q.type, options: q.options
    } : null,
    feedback: s.status === "showing_feedback" ? s.reviews.at(-1) ?? null : null,
    reviews: s.status === "completed" ? s.reviews : [],
    stats: stats(s), total: s.pool.length, answered: s.reviews.length
  };
}

export const demo = {
  async guest() { write(read()); },
  async play(
    mode: Mode, selected: string[], difficulty: Difficulty,
    country?: string, count = 10
  ) {
    const data = read();
    if (data.sessions.filter(s =>
      s.status === "awaiting_answer" || s.status === "showing_feedback"
    ).length >= 3) throw new Error("Resume or abandon an active game before starting another.");

    let pool = (bank as Question[]).filter(q =>
      (!selected.length || selected.includes(q.subcategory))
      && (!country || q.countryCode === country)
      && (mode === "endless" ? rank(q.difficulty) >= rank(difficulty)
        : q.difficulty === difficulty)
      && (mode !== "classic" || q.type === "mc")
    );
    pool = shuffle(pool).map(q => ({ ...q, options: shuffle(q.options) }));
    const needed = mode === "classic" ? 10 : mode === "practice" ? count : 1;
    if (pool.length < needed)
      throw new Error(`This exact selection has ${pool.length} questions; ${needed} required. Change your selection.`);
    if (mode === "classic" || mode === "practice") pool = pool.slice(0, needed);

    const s: Session = {
      id: crypto.randomUUID(), mode, difficulty,
      categories: [...selected], country: country ?? null, questionCount: count,
      status: "awaiting_answer", version: 0,
      createdAt: new Date().toISOString(),
      deadline: mode === "timed" ? Date.now() + 60_000 : null,
      started: Date.now(), pool, reviews: [], currentId: null
    };
    selectNext(s);
    data.sessions.unshift(s); write(data);
    return render(s);
  },
  async view(id: string) {
    const data = read(), s = find(data, id);
    if (expired(s.deadline, Date.now())) finish(s);
    write(data);
    return render(s);
  },
  async result(id: string): Promise<ResultView> {
    const data=read(),s=find(data,id);
    const previous=data.sessions
      .filter(other=>other.id!==s.id&&other.mode===s.mode&&other.status==="completed"&&other.createdAt<s.createdAt)
      .reduce<number|null>((best,other)=>Math.max(best??-Infinity,stats(other).score),null);
    return {...render(s),categories:s.categories??null,country:s.country??null,
      questionCount:s.questionCount??null,contextSaved:s.categories!==undefined,previousBest:previous};
  },
  async answer(id: string, questionId: string, optionId: string) {
    const data = read(), s = find(data, id);
    if (expired(s.deadline, Date.now())) { finish(s); write(data); return render(s); }
    if (s.status !== "awaiting_answer" || s.currentId !== questionId)
      throw new Error("This question is no longer accepting answers. Reload session state.");
    const q = s.pool.find(q => q.id === questionId)!;
    if (!validateOption(q, optionId)) throw new Error("Invalid answer identifier.");
    const correct = q.correct === optionId;
    const points = score(correct, q.difficulty, correct ? stats(s).streak + 1 : 0);
    s.reviews.push({
      questionId, prompt: q.prompt,
      chosen: q.options.find(o => o.id === optionId)!.label,
      correctAnswer: q.options.find(o => o.id === q.correct)!.label,
      correct, explanation: q.explanation, source: q.source,
      points, responseMs: Math.max(0, Date.now() - s.started),
      subcategory: q.subcategory
    });
    s.version++;
    if (
      (s.mode === "endless" && stats(s).incorrect >= 3)
      || s.reviews.length === s.pool.length
    ) finish(s);
    else s.status = "showing_feedback";
    write(data);
    return render(s);
  },
  async next(id: string) {
    const data = read(), s = find(data, id);
    if (expired(s.deadline, Date.now())) finish(s);
    else {
      if (s.status !== "showing_feedback")
        throw new Error("Answer the current question before continuing.");
      selectNext(s);
    }
    write(data); return render(s);
  },
  async abandon(id: string) {
    const data = read(), s = find(data, id);
    if (s.status !== "completed" && s.status !== "abandoned") {
      s.status = "abandoned"; s.version++;
    }
    write(data);
  },
  async deleteRun(id: string) {
    const data = read();
    const session = find(data, id);
    if (session.status === "completed" || session.status === "abandoned")
      throw new Error("This run can no longer be deleted.");
    data.sessions = data.sessions.filter(item => item.id !== id);
    write(data);
  },
  async dashboard(offset = 0): Promise<Dashboard> {
    const data = read();
    const done = data.sessions.filter(s => s.status === "completed");
    const competitive = done.filter(s => s.mode !== "practice");
    const best: Dashboard["best"] = {};
    for (const s of competitive) best[s.mode] = Math.max(best[s.mode] ?? 0, stats(s).score);
    const profile = {
      ...data.profile,
      xp: competitive.reduce((n, s) => n + stats(s).xp, 0)
    };
    const sessions: Summary[] = [...data.sessions].sort((a, b) => {
      const active = (s: Session) =>
        Number(s.status === "awaiting_answer" || s.status === "showing_feedback");
      return active(b) - active(a) || b.createdAt.localeCompare(a.createdAt);
    }).slice(offset, offset + 20).map(s => ({
      id: s.id, mode: s.mode, difficulty: s.difficulty, status: s.status,
      createdAt: s.createdAt, score: stats(s).score,
      correct: stats(s).correct, incorrect: stats(s).incorrect
    }));
    return {
      profile, sessions, best,
      totals: {
        games: done.length,
        correct: done.reduce((n, s) => n + stats(s).correct, 0),
        incorrect: done.reduce((n, s) => n + stats(s).incorrect, 0)
      }
    };
  },
  async saveProfile(profile: Omit<Profile, "xp" | "admin">) {
    if (!/^[A-Za-z0-9 _-]{2,24}$/.test(profile.username))
      throw new Error("Use 2–24 letters, numbers, spaces, underscores, or hyphens.");
    const data = read();
    data.profile = { ...data.profile, ...profile };
    write(data);
  },
  async explore(): Promise<Country[]> { return countryData as Country[]; },
  async exportData() { return read(); },
  async deleteAccount() { localStorage.removeItem(KEY); },
  async signOut() {}
};
