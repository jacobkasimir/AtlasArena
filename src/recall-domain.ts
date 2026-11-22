// Pure Recall logic shared by the online client and the local demo.
// The normalization MUST stay identical to private.recall_normalize() in
// supabase/migrations/*_recall_game.sql: the browser hashes typed text with it
// and the server re-hashes with the SQL version.

export type RecallKind = "countries" | "capitals";
export type RecallScope = "un" | "all";
export type RecallLang = "en" | "de" | "fr";

export type RecallKey = { h: string; l: RecallLang; x: number[] };

export type RecallEntry = {
  position: number;
  region: string | null;
  prompt: string | null;
  alpha2: string | null;
  name: string | null;
  found: boolean;
  foundAt: string | null;
  matched: string | null;
  lang: RecallLang | null;
  keys: RecallKey[] | null;
};

export type RecallBest = { found: number; total: number; elapsedMs: number; completedAt: string };

export type RecallSession = {
  id: string;
  kind: RecallKind;
  scope: RecallScope;
  region: string | null;
  size: number | null;
  timeLimitSeconds: number | null;
  state: "active" | "completed" | "abandoned";
  endReason: "all_found" | "gave_up" | "time_up" | null;
  badge: "first_run" | "new_best" | "not_best" | "unranked" | null;
  total: number;
  found: number;
  createdAt: string;
  deadlineAt: string | null;
  serverNow: string;
  completedAt: string | null;
  elapsedMs: number | null;
  ranked: boolean;
  best: RecallBest | null;
  salt: string | null;
  ambiguous: string[];
  entries: RecallEntry[];
};

export type RecallAnswerResult = {
  status: "found" | "already_found" | "no_match" | "time_up" | "not_active";
  position: number;
  name: string | null;
  alpha2: string | null;
  matched: string | null;
  lang: RecallLang | null;
  foundAt: string | null;
  found: number;
  total: number;
  state: RecallSession["state"];
  endReason: RecallSession["endReason"];
};

export type RecallCatalogItem = { code: string; region: string | null; un: boolean; hasCapital: boolean };

export type RecallSetup = {
  catalog: RecallCatalogItem[];
  activeSessions: {
    id: string; kind: RecallKind; scope: RecallScope; region: string | null; size: number | null;
    timeLimitSeconds: number | null; total: number; found: number; createdAt: string; deadlineAt: string | null;
  }[];
  bests: (RecallBest & { kind: RecallKind; scope: RecallScope; region: string | null; timeLimitSeconds: number | null })[];
  recalled: { countries: string[]; capitals: string[] };
};

export type RecallChoice = {
  kind: RecallKind;
  scope: RecallScope;
  region: string | null;
  size: number | null;
  timeLimitSeconds: number | null;
};

// Characters PostgreSQL's unaccent folds to more than a stripped base letter.
const FOLDS: [RegExp, string][] = [
  [/[Ææ]/g, "ae"], [/[Œœ]/g, "oe"], [/[Øø]/g, "o"], [/[Łł]/g, "l"], [/[ĐđÐð]/g, "d"],
  [/[Þþ]/g, "th"], [/ß/g, "ss"], [/ı/g, "i"], [/[Ħħ]/g, "h"], [/[Ŧŧ]/g, "t"], [/ĸ/g, "q"],
];

export function normalizeRecall(value: string): string {
  let text = value;
  for (const [pattern, replacement] of FOLDS) text = text.replace(pattern, replacement);
  text = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/['’ʻʼ`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ");
  text = (" " + text + " ").replace(/ st(?= )/g, " saint").replace(/^ the /, " ");
  return text.replace(/ +/g, " ").trim().replace(/ /g, "");
}

export async function recallHash(salt: string, key: string): Promise<string> {
  const bytes = new TextEncoder().encode(salt + ":" + key);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export type RecallIndex = Map<string, { position: number; lang: RecallLang; extendedBy: number[] }[]>;

export function buildRecallIndex(entries: RecallEntry[]): RecallIndex {
  const index: RecallIndex = new Map();
  for (const entry of entries) for (const key of entry.keys ?? []) {
    const list = index.get(key.h) ?? [];
    list.push({ position: entry.position, lang: key.l, extendedBy: key.x });
    index.set(key.h, list);
  }
  return index;
}

export type RecallMatch =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "already"; positions: number[] }
  | { kind: "match"; position: number; lang: RecallLang; wait: boolean };

/**
 * Decide what a typed (already hashed) answer means right now.
 * `wait` is true when another still-missing entry has a longer spelling that
 * starts with this one (Niger → Nigeria), so the UI should pause before accepting.
 */
export function classifyRecall(hash: string, index: RecallIndex, ambiguous: Set<string>, found: Set<number>): RecallMatch {
  const targets = index.get(hash);
  if (!targets?.length) return ambiguous.has(hash) ? { kind: "ambiguous" } : { kind: "none" };
  const open = targets.filter(target => !found.has(target.position));
  if (!open.length) return { kind: "already", positions: targets.map(target => target.position) };
  const target = open[0];
  return { kind: "match", position: target.position, lang: target.lang, wait: target.extendedBy.some(position => !found.has(position)) };
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

export function recallPercent(found: number, total: number): number {
  return total > 0 ? Math.round(found / total * 100) : 0;
}

export function poolCount(catalog: RecallCatalogItem[], choice: Pick<RecallChoice, "kind" | "scope" | "region">): number {
  return catalog.filter(item => (choice.scope === "all" || item.un) && (!choice.region || item.region === choice.region)
    && (choice.kind === "countries" || item.hasCapital)).length;
}

export function sameSet(a: Pick<RecallChoice, "kind" | "scope" | "region" | "timeLimitSeconds">, b: Pick<RecallChoice, "kind" | "scope" | "region" | "timeLimitSeconds">) {
  return a.kind === b.kind && a.scope === b.scope && (a.region ?? null) === (b.region ?? null)
    && (a.timeLimitSeconds ?? null) === (b.timeLimitSeconds ?? null);
}

export const langLabel: Record<RecallLang, string> = { en: "English", de: "German", fr: "French" };
