// Device-local Flags engine for the demo build (no Supabase configured).
// Mirrors the server RPC shapes, including practice samples and time limits.
import countries from "./demo-countries.json";
import { FlagsBestBoard, FlagsDirection, FlagsEntry, FlagsPoolTier, FlagsSession, FlagsSetup, RoundOptions } from "./domain";

type DemoCountry = { code: string; name: string; region: string; difficulty: string; flag: string };
const key = "atlas-flags-demo-v1";
type Store = { sessions: FlagsSession[]; snapshots: Record<string, DemoCountry[]> };
const read = (): Store => {
  try { return JSON.parse(localStorage.getItem(key) || '{"sessions":[],"snapshots":{}}'); } catch { return { sessions: [], snapshots: {} }; }
};
const save = (s: Store) => localStorage.setItem(key, JSON.stringify(s));
const normalizeAnswer = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase().trim().replace(/\s+/g, " ");
function randomIndex(limit: number) {
  const size = 0x100000000, ceiling = size - (size % limit);
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value); while (value[0] >= ceiling);
  return value[0] % limit;
}
const shuffled = <T,>(items: T[]) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = randomIndex(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
};
const isEasy = (c: DemoCountry) => c.difficulty === "easy" || c.difficulty === "medium";
const entry = (c: DemoCountry, position: number, choicePosition: number): FlagsEntry => ({
  id: c.code, position, choicePosition, name: c.name, region: c.region, outcome: "pending", attempts: 0, wrongChoiceIds: [],
  hintUsed: false, points: 0, flagSvgUrl: `https://flags.restcountries.com/${c.code.toLowerCase()}.svg`, flagPngUrl: null,
  flagDescription: c.flag, correctChoiceId: null,
});
function get(s: Store, id: string) {
  const session = s.sessions.find((x) => x.id === id);
  if (!session) throw new Error("Flags session was not found on this device.");
  return session;
}
function current(s: FlagsSession) {
  return s.state === "active" ? s.entries.find((e) => e.position === (s.currentPosition ?? 1)) ?? null : null;
}
const maxScore = (s: Pick<FlagsSession, "total" | "direction" | "hintsUsed">) =>
  s.total * 100 - (s.direction === "flag_to_country" ? s.hintsUsed * 40 : 0);
function refresh(s: FlagsSession) {
  s.current = current(s);
  s.paused = s.state === "paused";
  s.maxScore = maxScore(s);
  s.ranked = !s.sampleSize;
  if (s.direction === "flag_to_country")
    s.answerOptions = s.entries.flatMap((e) => (e.name ? [{ alpha2: /^[A-Z]{2}$/.test(e.id) ? e.id : null, name: e.name }] : []));
  if (s.current && s.direction === "country_to_flag") {
    const latestWrong = s.current.wrongChoiceIds[s.current.wrongChoiceIds.length - 1];
    s.current.choices = s.entries.slice().sort((a, b) => (a.choicePosition ?? 0) - (b.choicePosition ?? 0)).map((e) => ({
      id: e.id, choicePosition: e.choicePosition, flagSvgUrl: e.flagSvgUrl, flagPngUrl: e.flagPngUrl,
      flagDescription: e.flagDescription, name: e.id === latestWrong ? e.name : null,
    }));
  }
  s.serverNow = new Date().toISOString();
  if (s.state === "active") s.elapsedMs = Math.max(0, Date.now() - Date.parse(s.createdAt) - (s.pausedTotalMs ?? 0));
  else if (s.state === "paused" && s.pausedAt) s.elapsedMs = Math.max(0, Date.parse(s.pausedAt) - Date.parse(s.createdAt) - (s.pausedTotalMs ?? 0));
  return s;
}
const sessionClone = (s: FlagsSession) => structuredClone(s);
const ranked = (store: Store, s: FlagsSession) =>
  store.sessions.filter((x) => x.state === "completed" && !x.sampleSize && x.poolSignature === s.poolSignature)
    .sort((a, b) => b.score - a.score || (a.elapsedMs ?? 0) - (b.elapsedMs ?? 0));

function complete(store: Store, s: FlagsSession) {
  const end = Math.min(Date.now(), s.deadlineAt ? Date.parse(s.deadlineAt) : Infinity);
  s.state = "completed";
  s.completedAt = new Date().toISOString();
  s.elapsedMs = Math.max(0, end - Date.parse(s.createdAt) - (s.pausedTotalMs ?? 0));
  const previous = ranked(store, s).filter((x) => x.id !== s.id)[0];
  s.finalBadge = s.sampleSize ? "unranked" : !previous ? "first_run"
    : s.score > previous.score || (s.score === previous.score && (s.elapsedMs ?? 0) < (previous.elapsedMs ?? 0)) ? "new_best" : "not_best";
  s.topFive = (s.sampleSize ? [s] : ranked(store, s)).slice(0, 5).map((x) => ({
    id: x.id, score: x.score, maxScore: maxScore(x), elapsedMs: x.elapsedMs ?? 0, correct: x.correct, incorrect: x.incorrect,
    skipped: x.skipped, completedAt: x.completedAt ?? "",
  }));
}

/** Ends a timed round whose time is up; open flags count as skipped. */
function expire(store: Store, s: FlagsSession) {
  if (!s.deadlineAt || Date.parse(s.deadlineAt) > Date.now() || (s.state !== "active" && s.state !== "paused")) return false;
  for (const e of s.entries) if (e.outcome === "pending") {
    e.outcome = "skipped"; e.correctChoiceId = e.id;
    e.name = (store.snapshots[s.id] ?? []).find((c) => c.code === e.id)?.name ?? e.name;
    s.skipped++; s.answered++;
  }
  s.state = "active"; s.pausedAt = null;
  s.currentPosition = s.total;
  complete(store, s);
  save(store);
  return true;
}
const timeUp = (store: Store, s: FlagsSession) => ({ ...sessionClone(refresh(s)), timeUp: true });

export const flagsDemo = {
  sessions: () => read().sessions,
  async setup(): Promise<FlagsSetup> {
    const all = countries as DemoCountry[];
    const store = read();
    store.sessions.forEach((s) => expire(store, s));
    const regions = [...new Set(all.map((c) => c.region))].sort().map((name) => ({
      id: name, name, easyCount: all.filter((c) => c.region === name && isEasy(c)).length, allCount: all.filter((c) => c.region === name).length,
      easyMissingAssets: 0, allMissingAssets: 0, easyTierExcluded: 0, unsupportedDifficulty: 0,
    }));
    return {
      regions,
      summary: { easyCount: all.filter(isEasy).length, allCount: all.length, easyMissingAssets: 0, allMissingAssets: 0, easyTierExcluded: 0, unsupportedDifficulty: 0 },
      countries: all.map((c) => ({ code: c.code, name: c.name, region: c.region, un: true, easy: isEasy(c), alpha2: c.code })),
      activeSessions: store.sessions.filter((s) => s.state === "active" || s.state === "paused").map((s) => ({
        id: s.id, direction: s.direction, region: s.region, poolTier: s.poolTier, total: s.total, answered: s.answered, score: s.score,
        createdAt: s.createdAt, paused: s.state === "paused", scope: s.scope, sampleSize: s.sampleSize ?? null,
        timeLimitSeconds: s.timeLimitSeconds ?? null, deadlineAt: s.deadlineAt ?? null, selectedCount: s.selectedCodes?.length ?? 0,
      })),
      rulesVersion: 1, competitiveXp: false,
    };
  },
  async bests(): Promise<FlagsBestBoard[]> {
    const sessions = read().sessions.filter((s) => s.state === "completed" && s.completedAt && s.elapsedMs != null && !s.sampleSize);
    const groups = new Map<string, FlagsSession[]>();
    for (const session of sessions) {
      const k = [session.direction, session.region ?? "", session.poolTier, session.rulesVersion, session.poolSignature].join("|");
      groups.set(k, [...(groups.get(k) ?? []), session]);
    }
    const boards = [...groups.values()].map((runs) => {
      const sortedRuns = runs.sort((a, b) => b.score - a.score || (a.elapsedMs ?? 0) - (b.elapsedMs ?? 0) || String(a.completedAt).localeCompare(String(b.completedAt)));
      const first = sortedRuns[0];
      return {
        direction: first.direction, region: first.region, poolTier: first.poolTier, poolVersion: 1, total: first.total, runCount: runs.length,
        latestAt: String(runs.reduce((latest, run) => (String(run.completedAt) > latest ? String(run.completedAt) : latest), "")),
        topFive: sortedRuns.slice(0, 5).map((run) => ({
          score: run.score, maxScore: maxScore(run), elapsedMs: run.elapsedMs ?? 0, correct: run.correct, incorrect: run.incorrect,
          skipped: run.skipped, hintsUsed: run.hintsUsed, completedAt: run.completedAt!,
        })),
      };
    }).sort((a, b) => b.latestAt.localeCompare(a.latestAt));
    return boards;
  },
  async start(direction: FlagsDirection, region: string | null, poolTier: FlagsPoolTier, requestId: string,
    options: RoundOptions = { scope: "all", picks: [], size: null, limit: null }): Promise<FlagsSession> {
    const store = read();
    const existing = store.sessions.find((s) => s.id === requestId);
    if (existing) return sessionClone(refresh(existing));
    const picks = new Set(options.picks);
    const all = (countries as DemoCountry[]).filter((c) =>
      (region === null || c.region === region) && (poolTier !== "easy" || isEasy(c)) && (poolTier !== "manual" || picks.has(c.code)));
    if (!all.length) throw new Error("No catalog entries match this selection.");
    const sample = options.size && options.size < all.length ? options.size : null;
    const ordering = shuffled(all).slice(0, sample ?? all.length);
    const choiceOrder = new Map(shuffled(ordering).map((c, i) => [c.code, i + 1]));
    const entries = ordering.map((c, i) => entry(c, i + 1, choiceOrder.get(c.code)!));
    const now = new Date();
    const codes = poolTier === "manual" ? [...picks].sort() : [];
    const s: FlagsSession = {
      id: requestId, direction, region, poolTier,
      poolSignature: sample ? `practice-${requestId}` : `demo-${region ?? "all"}-${poolTier}-${direction}-${options.scope}-${options.limit ?? "none"}-${codes.join(",")}`,
      rulesVersion: 1, state: "active", paused: false, pausedAt: null, pausedTotalMs: 0, createdAt: now.toISOString(), completedAt: null,
      elapsedMs: 0, serverNow: now.toISOString(), total: entries.length, maxScore: entries.length * 100, currentPosition: 1, answered: 0,
      score: 0, correct: 0, incorrect: 0, skipped: 0, hintsUsed: 0, current: entries[0], entries, finalBadge: null, topFive: [],
      scope: options.scope, sampleSize: sample, timeLimitSeconds: options.limit, selectedCodes: codes, selectedCount: codes.length,
      deadlineAt: options.limit ? new Date(now.getTime() + options.limit * 1000).toISOString() : null,
    };
    store.snapshots[s.id] = ordering;
    store.sessions.push(s);
    save(store);
    return sessionClone(refresh(s));
  },
  async view(id: string): Promise<FlagsSession> {
    const store = read(), s = get(store, id);
    expire(store, s);
    return sessionClone(refresh(s));
  },
  async answer(id: string, entryId: string, choiceId: string | null, answer: string | null, _requestId: string): Promise<FlagsSession> {
    const store = read(), s = get(store, id);
    if (expire(store, s)) return timeUp(store, s);
    const e = current(s);
    if (!e || e.id !== entryId || e.outcome !== "pending") throw new Error("This flag has already been answered or the round moved on.");
    let outcome: string;
    if (s.direction === "country_to_flag") {
      if (!choiceId) throw new Error("Choose a flag first.");
      if (choiceId === e.id) {
        e.attempts = e.wrongChoiceIds.length + 1; e.points = [100, 60, 30][e.attempts - 1]; e.outcome = "correct";
        s.correct++; s.score += e.points; outcome = "correct";
      } else if (!e.wrongChoiceIds.includes(choiceId)) {
        e.wrongChoiceIds.push(choiceId); e.attempts = e.wrongChoiceIds.length;
        if (e.attempts >= 3) { e.outcome = "incorrect"; s.incorrect++; outcome = "not_solved"; } else outcome = "wrong_choice";
      } else outcome = "duplicate_choice";
    } else {
      const normalized = normalizeAnswer(answer ?? "");
      const matches = (store.snapshots[id] ?? []).filter((c) => normalizeAnswer(c.name) === normalized || normalizeAnswer(c.code) === normalized);
      if (matches.length > 1) outcome = "ambiguous";
      else if (matches.length === 1 && matches[0].code === e.id) {
        e.outcome = "correct"; e.attempts = 1; e.points = e.hintUsed ? 60 : 100; s.correct++; s.score += e.points; outcome = "correct";
      } else { e.outcome = "incorrect"; e.attempts = 1; s.incorrect++; outcome = "incorrect"; }
    }
    if (e.outcome !== "pending") {
      e.correctChoiceId = e.id;
      e.name = (store.snapshots[id] ?? []).find((c) => c.code === e.id)?.name ?? e.name;
      s.answered++;
    }
    save(store);
    const result = refresh(s);
    result.actionResult = { type: "answer", outcome, remainingAttempts: Math.max(0, 3 - e.attempts) };
    return sessionClone(result);
  },
  async hint(id: string, entryId: string, _requestId: string): Promise<FlagsSession> {
    const store = read(), s = get(store, id);
    if (expire(store, s)) return timeUp(store, s);
    const e = current(s);
    if (!e || e.id !== entryId || s.region || s.direction !== "flag_to_country") throw new Error("Region hints are unavailable for this round.");
    if (!e.hintUsed) { e.hintUsed = true; s.hintsUsed++; }
    const result = refresh(s);
    result.current!.region = e.region;
    save(store);
    return sessionClone(result);
  },
  async skip(id: string, entryId: string, _requestId: string): Promise<FlagsSession> {
    const store = read(), s = get(store, id);
    if (expire(store, s)) return timeUp(store, s);
    const e = current(s);
    if (!e || e.id !== entryId) throw new Error("This question is no longer active.");
    e.outcome = "skipped"; e.correctChoiceId = e.id;
    e.name = (store.snapshots[id] ?? []).find((c) => c.code === e.id)?.name ?? e.name;
    s.skipped++; s.answered++;
    save(store);
    return sessionClone(refresh(s));
  },
  async next(id: string, _requestId: string): Promise<FlagsSession> {
    const store = read(), s = get(store, id);
    if (expire(store, s)) return timeUp(store, s);
    if (current(s)?.outcome === "pending") throw new Error("Answer this flag before moving on.");
    if ((s.currentPosition ?? 1) >= s.total) complete(store, s);
    else s.currentPosition = (s.currentPosition ?? 1) + 1;
    save(store);
    return sessionClone(refresh(s));
  },
  async pause(id: string, _requestId: string): Promise<FlagsSession> {
    const store = read(), s = get(store, id);
    if (s.timeLimitSeconds) throw new Error("Timed rounds can't be paused.");
    if (s.state === "active") { refresh(s); s.pausedAt = new Date().toISOString(); s.state = "paused"; }
    save(store);
    return sessionClone(refresh(s));
  },
  async resume(id: string, _requestId: string): Promise<FlagsSession> {
    const store = read(), s = get(store, id);
    if (expire(store, s)) return timeUp(store, s);
    if (s.state === "paused") {
      s.pausedTotalMs = (s.pausedTotalMs ?? 0) + Math.max(0, Date.now() - Date.parse(s.pausedAt ?? new Date().toISOString()));
      s.pausedAt = null; s.state = "active";
    }
    save(store);
    return sessionClone(refresh(s));
  },
  async delete(id: string, _requestId: string): Promise<{ deleted: boolean }> {
    const store = read(), s = get(store, id);
    if (!["active", "paused", "abandoned"].includes(s.state)) throw new Error("Completed rounds cannot be deleted here.");
    store.sessions = store.sessions.filter((item) => item.id !== id);
    delete store.snapshots[id];
    save(store);
    return { deleted: true };
  },
  async abandon(id: string, _requestId: string): Promise<FlagsSession> {
    const store = read(), s = get(store, id);
    s.state = "abandoned"; s.paused = false; s.pausedAt = null;
    save(store);
    return sessionClone(refresh(s));
  },
  async results(id: string): Promise<FlagsSession> {
    const store = read(), s = get(store, id);
    expire(store, s);
    if (s.state !== "completed" && s.state !== "abandoned") throw new Error("This round is not complete yet.");
    return sessionClone(refresh(s));
  },
};
