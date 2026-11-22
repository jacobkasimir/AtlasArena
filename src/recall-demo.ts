// Device-local Recall engine for the demo build (no Supabase configured).
// Mirrors the server RPC shapes so the UI code is identical in both modes.
import countryData from "./demo-countries.json";
import type { Country } from "./domain";
import {
  RecallAnswerResult, RecallChoice, RecallEntry, RecallLang, RecallSession, RecallSetup,
  normalizeRecall, recallHash
} from "./recall-domain";

type StoredEntry = { position: number; code: string; region: string; country: string; answer: string;
  aliases: { key: string; lang: RecallLang }[]; foundAt: string | null; matched: string | null; lang: RecallLang | null };
type Stored = Omit<RecallSession, "entries" | "serverNow" | "best" | "ambiguous" | "salt"> & {
  salt: string; signature: string | null; requestId: string; entries: StoredEntry[]; picks?: string[] };

const KEY = "atlas-demo-recall";
const countries = countryData as Country[];

function load(): Stored[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Stored[]; } catch { return []; }
}
function save(sessions: Stored[]) { localStorage.setItem(KEY, JSON.stringify(sessions.slice(-50))); }
function find(id: string) {
  const sessions = load(); const session = sessions.find(item => item.id === id);
  if (!session) throw new Error("RECALL_SESSION_NOT_FOUND");
  return { sessions, session };
}
const signatureOf = (choice: RecallChoice, sampled: boolean) => sampled ? null
  : JSON.stringify([choice.kind, choice.scope, choice.region, choice.timeLimitSeconds,
    ...(choice.pool === "all" ? [] : [choice.pool, [...choice.picks].sort()])]);
const isEasy = (country: Country) => country.difficulty === "easy" || country.difficulty === "medium";

function best(sessions: Stored[], signature: string | null, exclude?: string) {
  if (!signature) return null;
  const done = sessions.filter(item => item.signature === signature && item.state === "completed" && item.id !== exclude)
    .sort((a, b) => b.found - a.found || (a.elapsedMs ?? 0) - (b.elapsedMs ?? 0));
  const top = done[0];
  return top ? { found: top.found, total: top.total, elapsedMs: top.elapsedMs ?? 0, completedAt: top.completedAt ?? "" } : null;
}

function finalize(sessions: Stored[], session: Stored, reason: NonNullable<RecallSession["endReason"]>) {
  if (session.state !== "active") return;
  const end = Math.min(Date.now(), session.deadlineAt ? Date.parse(session.deadlineAt) : Infinity);
  const elapsed = Math.max(0, end - Date.parse(session.createdAt));
  const previous = best(sessions, session.signature, session.id);
  session.state = "completed"; session.endReason = reason; session.completedAt = new Date(end).toISOString(); session.elapsedMs = elapsed;
  session.badge = !session.signature ? "unranked" : !previous ? "first_run"
    : session.found > previous.found || (session.found === previous.found && elapsed < previous.elapsedMs) ? "new_best" : "not_best";
}

function expire(sessions: Stored[], session: Stored) {
  if (session.state === "active" && session.deadlineAt && Date.parse(session.deadlineAt) <= Date.now()) finalize(sessions, session, "time_up");
}

async function view(sessions: Stored[], session: Stored): Promise<RecallSession> {
  const active = session.state === "active";
  const extendedBy = (entry: StoredEntry, key: string) => session.entries
    .filter(other => other.position !== entry.position && other.aliases.some(alias => alias.key !== key && alias.key.startsWith(key)))
    .map(other => other.position);
  const entries: RecallEntry[] = await Promise.all(session.entries.map(async entry => ({
    position: entry.position, region: entry.region,
    prompt: session.kind === "capitals" ? entry.country : null,
    alpha2: session.kind === "capitals" || entry.foundAt || !active ? entry.code : null,
    name: entry.foundAt || !active ? entry.answer : null,
    found: Boolean(entry.foundAt), foundAt: entry.foundAt, matched: entry.matched, lang: entry.lang,
    keys: active && !entry.foundAt ? await Promise.all(entry.aliases.map(async alias => ({
      h: await recallHash(session.salt, alias.key), l: alias.lang, x: extendedBy(entry, alias.key)
    }))) : null
  })));
  const { signature, requestId, picks, ...rest } = session; void requestId;
  return { ...rest, selectedCodes: picks ?? [], salt: active ? session.salt : null, ambiguous: [], serverNow: new Date().toISOString(),
    ranked: signature !== null, best: best(sessions, signature, session.state === "completed" ? session.id : undefined), entries };
}

export const recallDemo = {
  sessions: () => load(),
  async setup(): Promise<RecallSetup> {
    const sessions = load(); sessions.forEach(session => expire(sessions, session)); save(sessions);
    const recalled = (kind: string) => [...new Set(sessions.filter(item => item.kind === kind)
      .flatMap(item => item.entries.filter(entry => entry.foundAt).map(entry => entry.code)))];
    const bests = new Map<string, Stored>();
    for (const item of sessions) if (item.signature && item.state === "completed") {
      const current = bests.get(item.signature);
      if (!current || item.found > current.found || (item.found === current.found && (item.elapsedMs ?? 0) < (current.elapsedMs ?? 0))) bests.set(item.signature, item);
    }
    return {
      catalog: countries.map(country => ({ code: country.code, name: country.name, alpha2: country.code, region: country.region, un: true,
        easy: isEasy(country), hasCapital: Boolean(country.capital) })),
      activeSessions: sessions.filter(item => item.state === "active").reverse().map(item => ({
        id: item.id, kind: item.kind, scope: item.scope, region: item.region, size: item.size, timeLimitSeconds: item.timeLimitSeconds,
        total: item.total, found: item.found, createdAt: item.createdAt, deadlineAt: item.deadlineAt, pool: item.pool ?? "all",
        selectedCount: item.selectedCount ?? 0 })),
      bests: [...bests.values()].map(item => ({ kind: item.kind, scope: item.scope, region: item.region, timeLimitSeconds: item.timeLimitSeconds,
        pool: item.pool ?? "all", selectedCount: item.selectedCount ?? 0,
        found: item.found, total: item.total, elapsedMs: item.elapsedMs ?? 0, completedAt: item.completedAt ?? "" })),
      recalled: { countries: recalled("countries"), capitals: recalled("capitals") }
    };
  },
  async start(choice: RecallChoice, requestId: string): Promise<RecallSession> {
    const sessions = load();
    const existing = sessions.find(item => item.requestId === requestId);
    if (existing) return view(sessions, existing);
    const picks = new Set(choice.picks ?? []);
    const poolKind = choice.pool ?? "all";
    let pool = countries.filter(country => (!choice.region || country.region === choice.region) && (choice.kind === "countries" || country.capital)
      && (poolKind !== "easy" || isEasy(country)) && (poolKind !== "manual" || picks.has(country.code)));
    if (!pool.length) throw new Error("EMPTY_RECALL_POOL");
    const size = choice.size !== null && choice.size < pool.length ? choice.size : null;
    if (size !== null) pool = [...pool].sort(() => Math.random() - .5).slice(0, size);
    pool.sort((a, b) => choice.kind === "countries" ? a.region.localeCompare(b.region) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
    const now = new Date();
    const session: Stored = {
      id: crypto.randomUUID(), requestId, kind: choice.kind, scope: choice.scope, region: choice.region, size,
      pool: poolKind, selectedCount: poolKind === "manual" ? picks.size : 0, picks: poolKind === "manual" ? [...picks].sort() : [],
      timeLimitSeconds: choice.timeLimitSeconds, state: "active", endReason: null, badge: null, total: pool.length, found: 0,
      createdAt: now.toISOString(), deadlineAt: choice.timeLimitSeconds ? new Date(now.getTime() + choice.timeLimitSeconds * 1000).toISOString() : null,
      completedAt: null, elapsedMs: null, ranked: size === null, salt: crypto.randomUUID().replace(/-/g, ""), signature: signatureOf(choice, size !== null),
      entries: pool.map((country, index) => {
        const answer = choice.kind === "countries" ? country.name : country.capital;
        const names = choice.kind === "countries" ? [country.name, country.officialName] : [country.capital];
        return { position: index + 1, code: country.code, region: country.region, country: country.name, answer,
          aliases: [...new Set(names.filter(Boolean).map(normalizeRecall).filter(Boolean))].map(key => ({ key, lang: "en" as const })),
          foundAt: null, matched: null, lang: null };
      })
    };
    sessions.push(session); save(sessions);
    return view(sessions, session);
  },
  async view(id: string) { const { sessions, session } = find(id); expire(sessions, session); save(sessions); return view(sessions, session); },
  async answer(id: string, position: number, text: string): Promise<RecallAnswerResult> {
    const { sessions, session } = find(id); expire(sessions, session);
    const entry = session.entries.find(item => item.position === position);
    if (!entry) throw new Error("RECALL_ENTRY_NOT_FOUND");
    let status: RecallAnswerResult["status"];
    if (session.state !== "active") status = session.endReason === "time_up" ? "time_up" : "not_active";
    else if (entry.foundAt) status = "already_found";
    else {
      const alias = entry.aliases.find(item => item.key === normalizeRecall(text));
      if (!alias) status = "no_match";
      else {
        status = "found"; entry.foundAt = new Date().toISOString(); entry.matched = text.trim().replace(/\s+/g, " "); entry.lang = alias.lang;
        session.found += 1;
        if (session.found === session.total) finalize(sessions, session, "all_found");
      }
    }
    save(sessions);
    return { status, position, name: entry.foundAt ? entry.answer : null, alpha2: entry.foundAt ? entry.code : null, matched: entry.matched,
      lang: entry.lang, foundAt: entry.foundAt, found: session.found, total: session.total, state: session.state, endReason: session.endReason };
  },
  async finish(id: string) {
    const { sessions, session } = find(id);
    finalize(sessions, session, session.deadlineAt && Date.parse(session.deadlineAt) <= Date.now() ? "time_up" : "gave_up");
    save(sessions); return view(sessions, session);
  },
  async abandon(id: string) { const { sessions, session } = find(id); if (session.state === "active") session.state = "abandoned"; save(sessions); }
};
