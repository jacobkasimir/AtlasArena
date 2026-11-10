import { CapitalAcceptedAnswer, CapitalCountry, CapitalDirection, CapitalPoolMode } from "./domain";

export function normalizeCapitalText(value: string) {
  return value.replace(/[Ææ]/g, "ae").replace(/[Œœ]/g, "oe").replace(/[Øø]/g, "o")
    .replace(/[Łł]/g, "l").replace(/[ĐđÐð]/g, "d").replace(/[Þþ]/g, "th").replace(/ß/g, "ss")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase().trim().replace(/\s+/g, " ");
}

export function structuredCapitalOptions(value: unknown): CapitalAcceptedAnswer[] {
  if (!Array.isArray(value)) return [];
  const roles = ["administrative", "constitutional", "executive", "judicial", "legislative"];
  const options = value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const record = item as { name?: unknown; attributes?: Record<string, unknown> };
    if (typeof record.name !== "string" || !record.name.trim()) return [];
    return [{
      name: record.name.trim(),
      roles: roles.filter(role => record.attributes?.[role] === true).map(role => role[0].toUpperCase() + role.slice(1)),
      primary: record.attributes?.primary === true
    }];
  });
  return options.sort((a,b)=>Number(b.primary)-Number(a.primary)||normalizeCapitalText(a.name).localeCompare(normalizeCapitalText(b.name),"en")||a.name.localeCompare(b.name,"en"));
}

export function selectUnambiguousCapitals(catalog: { code: string; capitals: CapitalAcceptedAnswer[] }[]) {
  const owners = new Map<string, Set<string>>();
  for (const country of catalog) for (const capital of country.capitals) {
    const key = normalizeCapitalText(capital.name);
    if (key) owners.set(key, new Set([...(owners.get(key) ?? []), country.code]));
  }
  return new Map(catalog.map(country => {
    const available = country.capitals.filter(capital => (owners.get(normalizeCapitalText(capital.name))?.size ?? 0) === 1)
      .sort((a,b)=>Number(b.primary)-Number(a.primary)||normalizeCapitalText(a.name).localeCompare(normalizeCapitalText(b.name),"en")||a.name.localeCompare(b.name,"en"));
    return [country.code, available[0] ?? null] as const;
  }));
}

export function capitalPool(
  countries: CapitalCountry[], direction: CapitalDirection, mode: CapitalPoolMode,
  selectedCodes: string[], region: string | null
) {
  const selected = new Set(selectedCodes);
  const poolSelection = countries.filter(country =>
    (mode !== "manual" || selected.has(country.code)) &&
    (mode !== "easy" || country.difficulty === "easy" || country.difficulty === "medium")
  );
  const outsideRegion = poolSelection.filter(country => region !== null && country.region !== region);
  const inRegion = poolSelection.filter(country => region === null || country.region === region);
  const isEligible = (country: CapitalCountry) => direction === "country_to_capital"
    ? country.countryToCapitalEligible : country.capitalToCountryEligible;
  return {
    countries: inRegion.filter(isEligible),
    excluded: inRegion.filter(country => !isEligible(country)),
    outsideRegion,
    easyTierExcluded: mode === "easy" ? countries.filter(country => country.difficulty !== "easy" && country.difficulty !== "medium") : []
  };
}

export function classifyCapitalAnswer(answer: string, accepted: string[], ambiguous: string[] = []) {
  const normalized = normalizeCapitalText(answer);
  if (ambiguous.includes(normalized)) return "ambiguous" as const;
  return accepted.some(value => normalizeCapitalText(value) === normalized) ? "correct" as const : "incorrect" as const;
}

export function capitalPercentage(correct: number, total: number) {
  return total > 0 ? Math.round(correct / total * 1000) / 10 : 0;
}

export function isStrictCapitalBest(score: number, elapsedMs: number, previous: { score: number; elapsedMs: number } | null) {
  return previous === null || score > previous.score || (score === previous.score && elapsedMs < previous.elapsedMs);
}
