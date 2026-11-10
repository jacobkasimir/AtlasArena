import countries from "./demo-countries.json";
import { CapitalAcceptedAnswer, CapitalCountry, CapitalDirection, CapitalEntry, CapitalPoolMode, CapitalSession, CapitalSetup } from "./domain";
import { classifyCapitalAnswer, isStrictCapitalBest, normalizeCapitalText } from "./capitals-domain";

type DemoCountry = { code: string; name: string; capital: string; region: string; difficulty: string; flag: string };
const storageKey = "atlas-capitals-demo-v1";
type Store = { sessions: CapitalSession[]; answers: Record<string, Record<string, CapitalAcceptedAnswer[]>> };
const read = (): Store => { try { const parsed=JSON.parse(localStorage.getItem(storageKey) || '{"sessions":[],"answers":{}}'); return {sessions:parsed.sessions??[],answers:parsed.answers??{}}; } catch { return { sessions: [], answers: {} }; } };
const save = (store: Store) => localStorage.setItem(storageKey, JSON.stringify(store));
export const normalizeCapitalAnswer = normalizeCapitalText;
function shuffled<T>(values: T[]) { const result = [...values]; for (let index = result.length - 1; index > 0; index--) { const next = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1); [result[index], result[next]] = [result[next], result[index]]; } return result; }
function catalog(): DemoCountry[] { return countries as DemoCountry[]; }
function toCountry(value: DemoCountry): CapitalCountry { const validCapital = Boolean(value.capital?.trim()); return { code: value.code, name: value.name, officialName: null, region: value.region || null, difficulty: value.difficulty, catalogKind: "iso_alpha2", codeAlpha2: value.code, codeAlpha3: null, flagSvgUrl: `/flags/${value.code.toLowerCase()}.svg`, countryToCapitalEligible: validCapital, countryToCapitalReason: validCapital ? null : "No structured capital name is available in the local demo catalog.", capitalToCountryEligible: validCapital, capitalToCountryReason: validCapital ? null : "No unambiguous capital is available in the local demo catalog." }; }
function current(session: CapitalSession) { return session.state === "active" ? session.entries.find(entry => entry.position === session.currentPosition) ?? null : null; }
function refresh(session: CapitalSession) {
  session.current = current(session);
  session.serverNow = new Date().toISOString();
  if (session.state === "active") session.elapsedMs = Math.max(0, Date.now() - Date.parse(session.createdAt));
  return session;
}
function get(store: Store, id: string) { const session = store.sessions.find(item => item.id === id); if (!session) throw new Error("Capital session was not found on this device."); session.current=current(session); return session; }
const clone = (session: CapitalSession) => structuredClone(session);
function publicSession(session: CapitalSession) {
  const result=clone(refresh(session));
  result.entries=result.entries.map(entry=>{
    if(entry.outcome!=="pending")return entry;
    const active=entry.position===result.currentPosition;
    return {id:entry.id,position:entry.position,countryCode:"",countryName:active&&result.direction==="country_to_capital"?entry.countryName:"",region:null,catalogKind:entry.catalogKind,codeAlpha2:null,codeAlpha3:null,prompt:active?entry.prompt:"",selectedCapital:null,acceptedAnswers:null,submittedAnswer:null,outcome:"pending",points:0,sourceLinks:[]} as CapitalEntry;
  });
  result.current=result.entries.find(entry=>entry.position===result.currentPosition)??null;
  return result;
}

export const capitalsDemo = {
  async setup(): Promise<CapitalSetup> {
    const all = catalog();
    const capitalOwners = new Map<string, Set<string>>();
    for (const country of all) { const key = normalizeCapitalAnswer(country.capital); if (key) capitalOwners.set(key, new Set([...(capitalOwners.get(key) ?? []), country.code])); }
    const mapped = all.map(toCountry);
    for (const country of mapped) {
      if (country.capitalToCountryEligible) {
        const source = all.find(item => item.code === country.code)!;
        if ((capitalOwners.get(normalizeCapitalAnswer(source.capital))?.size ?? 0) > 1) {
          country.capitalToCountryEligible = false;
          country.capitalToCountryReason = "The only capital name in this demo entry is shared by multiple catalog entries.";
        }
      }
    }
    const sessions = read().sessions;
    return { countries: mapped, regions: [...new Set(mapped.map(item => item.region).filter((value): value is string => Boolean(value)))].sort(), activeSessions: sessions.filter(item => item.state === "active").map(item => ({ id: item.id, direction: item.direction, poolMode: item.poolMode, region: item.region, total: item.total, answered: item.answered, score: item.score, createdAt: item.createdAt })) };
  },
  async start(direction: CapitalDirection, poolMode: CapitalPoolMode, selectedCodes: string[], region: string | null, requestId: string): Promise<CapitalSession> {
    const all = catalog();
    if (poolMode === "manual" && !selectedCodes.length) throw new Error("Select at least one catalog entry first.");
    const chosen = new Set(selectedCodes);
    const eligibility = new Map((await this.setup()).countries.map(country => [country.code, direction === "country_to_capital" ? country.countryToCapitalEligible : country.capitalToCountryEligible]));
    const entries: CapitalEntry[] = all.filter(country => (poolMode !== "manual" || chosen.has(country.code)) && (poolMode !== "easy" || country.difficulty === "easy" || country.difficulty === "medium") && (!region || country.region === region) && eligibility.get(country.code)).map(country => ({ id: country.code, position: 0, countryCode: country.code, countryName: country.name, region: country.region || null, catalogKind: "iso_alpha2", codeAlpha2: country.code, codeAlpha3: null, prompt: direction === "country_to_capital" ? `Name a capital of ${country.name}.` : country.capital, selectedCapital: country.capital, acceptedAnswers: null, submittedAnswer: null, outcome: "pending", points: 0, sourceLinks: [] }));
    if (!entries.length) throw new Error("No countries match this direction and pool. Choose another region or selection.");
    const ordered = shuffled(entries).map((entry, index) => ({ ...entry, position: index + 1 }));
    const acceptedSnapshot = Object.fromEntries(ordered.map(entry => [entry.id, [{ name: entry.selectedCapital!, roles: [], primary: false }]]));
    const vocabulary = [...new Set(ordered.map(entry => direction === "country_to_capital" ? entry.selectedCapital! : entry.countryName).filter(Boolean))].sort((a, b) => a.localeCompare(b)).map(label => ({ id: normalizeCapitalAnswer(label), label }));
    const now = new Date().toISOString();
    const poolSignature = `${direction}:rules-1:${ordered.map(entry => `${entry.countryCode}:${normalizeCapitalAnswer(entry.selectedCapital ?? "")}`).sort().join("|")}`;
    const session: CapitalSession = { id: requestId, direction, poolMode, region, poolSignature, state: "active", createdAt: now, completedAt: null, serverNow: now, elapsedMs: 0, total: ordered.length, currentPosition: 1, answered: 0, score: 0, correct: 0, incorrect: 0, skipped: 0, current: ordered[0], entries: ordered, vocabulary, finalBadge: null, topFive: [], selectedCodes: poolMode === "manual" ? [...selectedCodes] : ordered.map(entry => entry.countryCode), rulesVersion: 1 };
    const store = read(); store.sessions.push(session); store.answers[session.id] = acceptedSnapshot; save(store); return publicSession(session);
  },
  async view(id: string): Promise<CapitalSession> { const store = read(); return publicSession(get(store, id)); },
  async answer(id: string, entryId: string, answer: string, _candidateId: string | null, _requestId: string): Promise<CapitalSession> {
    const store = read(), session = get(store, id), entry = session.current;
    if (!entry || entry.id !== entryId || entry.outcome !== "pending") throw new Error("This question is no longer active.");
    const normalized = normalizeCapitalAnswer(answer);
    if (!normalized) throw new Error("Enter an answer first.");
    const acceptedAnswers = store.answers[id]?.[entry.id] ?? [];
    const accepted = session.direction === "country_to_capital" ? acceptedAnswers.map(item => item.name) : [entry.countryName, entry.codeAlpha2 ?? ""];
    const aliasOwners = new Map<string,Set<string>>();
    if(session.direction==="capital_to_country") for(const country of catalog()) for(const alias of [country.name,country.code]) { const key=normalizeCapitalAnswer(alias); aliasOwners.set(key,new Set([...(aliasOwners.get(key)??[]),country.code])); }
    const ambiguous=[...aliasOwners].filter(([,owners])=>owners.size>1).map(([key])=>key);
    const outcome=classifyCapitalAnswer(answer,accepted,session.direction==="capital_to_country"?ambiguous:[]);
    if(outcome==="ambiguous"){session.actionResult={outcome};save(store);return publicSession(session)}
    const correct = outcome === "correct";
    entry.submittedAnswer = answer.trim().replace(/\s+/g, " "); entry.outcome = correct ? "correct" : "incorrect"; entry.points = correct ? 100 : 0;
    session.answered++; session.score += entry.points; if (correct) session.correct++; else session.incorrect++;
    entry.acceptedAnswers = acceptedAnswers;
    session.actionResult = { outcome: entry.outcome }; save(store); return publicSession(session);
  },
  async skip(id: string, entryId: string, _requestId: string): Promise<CapitalSession> {
    const store = read(), session = get(store, id), entry = session.current;
    if (!entry || entry.id !== entryId || entry.outcome !== "pending") throw new Error("This question is no longer active.");
    entry.outcome = "skipped"; entry.points = 0; entry.acceptedAnswers = store.answers[id]?.[entry.id] ?? []; session.answered++; session.skipped++; session.actionResult = { outcome: "skipped" }; save(store); return publicSession(session);
  },
  async next(id: string, _requestId: string): Promise<CapitalSession> {
    const store = read(), session = get(store, id);
    if (session.current?.outcome === "pending") throw new Error("Answer or skip the current question first.");
    if (session.answered >= session.total) {
      session.state = "completed"; session.completedAt = new Date().toISOString(); session.elapsedMs = Date.parse(session.completedAt) - Date.parse(session.createdAt);
      const prior = store.sessions.filter(item => item.id !== id && item.state === "completed" && item.direction === session.direction && item.poolSignature === session.poolSignature).sort((a, b) => b.score - a.score || (a.elapsedMs ?? 0) - (b.elapsedMs ?? 0))[0];
      session.finalBadge = !prior ? "first_run" : isStrictCapitalBest(session.score, session.elapsedMs, { score: prior.score, elapsedMs: prior.elapsedMs ?? 0 }) ? "new_best" : "not_best";
      session.topFive = store.sessions.filter(item => item.state === "completed" && item.direction === session.direction && item.poolSignature === session.poolSignature).sort((a, b) => b.score - a.score || (a.elapsedMs ?? 0) - (b.elapsedMs ?? 0)).slice(0, 5).map(item => ({ score: item.score, elapsedMs: item.elapsedMs ?? 0, completedAt: item.completedAt ?? "" }));
    } else session.currentPosition++;
    save(store); return publicSession(session);
  },
  async abandon(id: string, _requestId: string): Promise<CapitalSession> { const store = read(), session = get(store, id); session.state = "abandoned"; save(store); return publicSession(session); },
  async results(id: string): Promise<CapitalSession> { const session = get(read(), id); if (session.state !== "completed" && session.state !== "abandoned") throw new Error("This round is not complete yet."); return publicSession(session); }
};
