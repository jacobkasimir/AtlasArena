// Pure helpers for the phone Explorer (read-only atlas): search, region filter, flags, neighbours, facts and
// the "Practise this region" links. No React here, so everything is unit-tested in explore-logic.test.ts.
import type { ExplorerCountry } from "@shared/domain";
import alpha3CountryNames from "@shared/alpha3-country-names.json";

export const PAGE_SIZE = 40;

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const numberFormat = new Intl.NumberFormat("en-US");

/** Lower case, no accents, trimmed: "Côte d’Ivoire" and "cote d'ivoire" compare equal enough for search. */
export function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`]/g, "'")
    .toLowerCase()
    .trim();
}

export type RegionCount = { name: string; count: number };

/** Regions present in the catalog with their number of places, alphabetical. */
export function regionsOf(countries: ExplorerCountry[]): RegionCount[] {
  const counts = new Map<string, number>();
  for (const country of countries) {
    if (country.region) counts.set(country.region, (counts.get(country.region) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => collator.compare(a.name, b.name));
}

function searchText(country: ExplorerCountry) {
  return normalize(
    [
      country.name,
      country.officialName,
      country.capital,
      country.code,
      country.codeAlpha3,
      ...Object.values(country.translations ?? {}),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/**
 * Places matching the search text and region, sorted by name. A query that is exactly a two- or three-letter
 * code (e.g. "de", "deu") lists that place first; names starting with the query come before other matches.
 */
export function filterCountries(countries: ExplorerCountry[], query: string, region: string | null) {
  const needle = normalize(query);
  const inRegion = countries.filter((country) => !region || country.region === region);
  if (!needle) return [...inRegion].sort((a, b) => collator.compare(a.name, b.name));
  const scored: { country: ExplorerCountry; rank: number }[] = [];
  for (const country of inRegion) {
    const name = normalize(country.name);
    const isCode = normalize(country.code) === needle || normalize(country.codeAlpha3 ?? "") === needle;
    if (isCode) scored.push({ country, rank: 0 });
    else if (name.startsWith(needle)) scored.push({ country, rank: 1 });
    else if (searchText(country).includes(needle)) scored.push({ country, rank: 2 });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || collator.compare(a.country.name, b.country.name))
    .map((item) => item.country);
}

/** Local flag file for ISO alpha-2 entries (`/flags/<alpha2>.svg`); null for entries without an ISO code. */
export function flagSrc(country: Pick<ExplorerCountry, "code" | "catalogKind">) {
  const code = country.code.trim();
  if (country.catalogKind === "non_iso" || !/^[A-Za-z]{2}$/.test(code)) return null;
  return `/flags/${code.toLowerCase()}.svg`;
}

export type Neighbour = { key: string; name: string; country: ExplorerCountry | null };

/**
 * Land neighbours of a place, resolved to catalog entries where possible (tappable) and otherwise to a known
 * name. Uses the server's `neighbors` list when present, else the raw alpha-3 `borders`.
 * Returns null when the catalog has no border data for this place (the demo catalog has none).
 */
export function neighboursOf(country: ExplorerCountry, all: ExplorerCountry[]): Neighbour[] | null {
  const byAlpha2 = new Map(all.map((item) => [item.code.toUpperCase(), item]));
  const byAlpha3 = new Map(
    all.filter((item) => item.codeAlpha3).map((item) => [(item.codeAlpha3 as string).toUpperCase(), item]),
  );
  const knownName = (alpha3: string) => (alpha3CountryNames as Record<string, string>)[alpha3] ?? alpha3;
  let list: Neighbour[];
  if (country.neighbors?.length) {
    list = country.neighbors.map((item) => {
      const alpha3 = item.alpha3.trim().toUpperCase();
      const match = (item.code && byAlpha2.get(item.code.toUpperCase())) || byAlpha3.get(alpha3) || null;
      return { key: alpha3, name: match?.name ?? item.name ?? knownName(alpha3), country: match };
    });
  } else if (Array.isArray(country.borders)) {
    list = country.borders.map((raw) => {
      const alpha3 = raw.trim().toUpperCase();
      const match = byAlpha3.get(alpha3) ?? null;
      return { key: alpha3, name: match?.name ?? knownName(alpha3), country: match };
    });
  } else {
    return null;
  }
  const seen = new Set<string>();
  return list
    .filter((item) => (seen.has(item.key) ? false : (seen.add(item.key), true)))
    .sort((a, b) => collator.compare(a.name, b.name));
}

export const isUnMember = (country: ExplorerCountry) =>
  Boolean(country.memberships?.some((item) => item.member && /united[ _]nations|^un$/i.test(item.name)));

/** Short neutral status line: UN member state, not listed as one, or nothing when the catalog doesn't say. */
export function statusNote(country: ExplorerCountry): string | null {
  if (country.catalogKind === "non_iso") {
    return "Listed with an internal catalog code (no ISO code). Inclusion does not express a position on sovereignty or recognition.";
  }
  if (isUnMember(country)) return "UN member state";
  if (country.memberships?.length) {
    return "Not a UN member state in the catalog: a territory or a place with limited recognition.";
  }
  return null;
}

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

export type Fact = { label: string; value: string };

/** Facts for the detail sheet; rows without data are left out (capital is handled separately for study mode). */
export function factsOf(country: ExplorerCountry): Fact[] {
  const facts: Fact[] = [];
  const region = [country.region, regionDetail(country)].filter(Boolean).join(" · ");
  if (region) facts.push({ label: "Region", value: region });
  if (country.languages?.length) facts.push({ label: "Languages", value: country.languages.join(", ") });
  if (finite(country.population)) facts.push({ label: "Population", value: numberFormat.format(country.population) });
  if (finite(country.areaKm2)) facts.push({ label: "Area", value: `${numberFormat.format(country.areaKm2)} km²` });
  const currency = country.currencies?.length
    ? country.currencies.map((item) => item.name).join(", ")
    : country.currency?.trim() || "";
  if (currency) facts.push({ label: "Currency", value: currency });
  return facts;
}

/** Sub-region if the catalog ever provides one (not in the current ExplorerCountry type: kept forward-compatible). */
function regionDetail(country: ExplorerCountry) {
  const value = (country as ExplorerCountry & { subregion?: unknown }).subregion;
  return typeof value === "string" && value.trim() && value !== country.region ? value.trim() : "";
}

export type PractiseGame = "flags" | "capitals";

const SETUP_KEYS = ["mode", "scope", "pool", "size", "limit"] as const;

/**
 * Query string that opens the Flags/Capitals setup with `region` chosen. The setup reads URL parameters
 * instead of the remembered setup whenever any are present (`initialChoice` in src/game-setup.tsx), so the
 * remembered mode, catalog, difficulty, length and time limit are copied into the URL too. Hand-picked places
 * are dropped (they belong to another region), so a "pick my own" difficulty falls back to "all".
 */
export function practiseQuery(region: string, saved: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const key of SETUP_KEYS) {
    const value = saved[key];
    if (key === "pool" && value === "manual") continue;
    if (typeof value === "string" && value) params.set(key, value);
    else if (typeof value === "number" && Number.isFinite(value)) params.set(key, String(value));
  }
  params.set("region", region);
  return `?${params.toString()}`;
}
