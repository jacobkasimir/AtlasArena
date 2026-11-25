import { describe, expect, it } from "vitest";
import type { ExplorerCountry } from "@shared/domain";
import {
  factsOf,
  filterCountries,
  flagSrc,
  neighboursOf,
  normalize,
  practiseQuery,
  regionsOf,
  statusNote,
} from "./explore-logic";

const place = (code: string, name: string, extra: Partial<ExplorerCountry> = {}): ExplorerCountry => ({
  code,
  name,
  capital: null,
  region: "Europe",
  currency: null,
  flag: null,
  difficulty: "easy",
  ...extra,
});

const de = place("DE", "Germany", { capital: "Berlin", codeAlpha3: "DEU", borders: ["FRA", "AUT", "CHE"] });
const fr = place("FR", "France", { capital: "Paris", codeAlpha3: "FRA", translations: { de: "Frankreich" } });
const at = place("AT", "Austria", { capital: "Vienna", codeAlpha3: "AUT" });
const ci = place("CI", "Côte d'Ivoire", { capital: "Yamoussoukro", region: "Africa", codeAlpha3: "CIV" });
const all = [de, fr, at, ci];

describe("explore logic", () => {
  it("normalizes accents, apostrophes and case", () => {
    expect(normalize("  Côte d’Ivoire ")).toBe("cote d'ivoire");
  });

  it("counts regions alphabetically", () => {
    expect(regionsOf(all)).toEqual([
      { name: "Africa", count: 1 },
      { name: "Europe", count: 3 },
    ]);
  });

  it("filters by name, capital, translation, code and region", () => {
    expect(filterCountries(all, "", null).map((c) => c.code)).toEqual(["AT", "CI", "FR", "DE"]);
    expect(filterCountries(all, "berl", null).map((c) => c.code)).toEqual(["DE"]);
    expect(filterCountries(all, "frankreich", null).map((c) => c.code)).toEqual(["FR"]);
    expect(filterCountries(all, "cote", null).map((c) => c.code)).toEqual(["CI"]);
    expect(filterCountries(all, "", "Africa").map((c) => c.code)).toEqual(["CI"]);
    expect(filterCountries(all, "paris", "Africa")).toEqual([]);
  });

  it("puts exact codes first, then names starting with the query", () => {
    expect(filterCountries(all, "fra", null).map((c) => c.code)).toEqual(["FR"]);
    const list = [place("AU", "Australia", { capital: "Canberra" }), at, place("XX", "Bustria", { capital: "Austin" })];
    expect(filterCountries(list, "aus", null).map((c) => c.name)).toEqual(["Australia", "Austria", "Bustria"]);
    expect(filterCountries(all, "at", null)[0].code).toBe("AT");
  });

  it("uses only local flag files and none for non-ISO entries", () => {
    expect(flagSrc(de)).toBe("/flags/de.svg");
    expect(flagSrc({ code: "XK1", catalogKind: "non_iso" })).toBeNull();
    expect(flagSrc({ code: "AB", catalogKind: "non_iso" })).toBeNull();
  });

  it("resolves neighbours to catalog places or known names", () => {
    const list = neighboursOf(de, all)!;
    expect(list.map((n) => [n.name, n.country?.code ?? null])).toEqual([
      ["Austria", "AT"],
      ["France", "FR"],
      ["Switzerland", null],
    ]);
    expect(neighboursOf(place("IS", "Iceland", { borders: [] }), all)).toEqual([]);
    expect(neighboursOf(place("XX", "Nowhere"), all)).toBeNull();
    const viaServer = place("IT", "Italy", { neighbors: [{ alpha3: "FRA", code: "FR", name: "France" }, { alpha3: "SMR", code: null, name: "San Marino" }] });
    expect(neighboursOf(viaServer, all)!.map((n) => [n.name, n.country?.code ?? null])).toEqual([
      ["France", "FR"],
      ["San Marino", null],
    ]);
  });

  it("writes a neutral status note", () => {
    expect(statusNote(place("DE", "Germany", { memberships: [{ name: "united_nations", member: true }] }))).toBe("UN member state");
    expect(statusNote(place("GL", "Greenland", { memberships: [{ name: "united_nations", member: false }] }))).toMatch(/Not a UN member state/);
    expect(statusNote(place("XK", "Kosovo", { catalogKind: "non_iso" }))).toMatch(/does not express a position/);
    expect(statusNote(de)).toBeNull();
  });

  it("lists only facts with data", () => {
    expect(factsOf(place("DE", "Germany", { population: 83000000, areaKm2: 357114, languages: ["German"] }))).toEqual([
      { label: "Region", value: "Europe" },
      { label: "Languages", value: "German" },
      { label: "Population", value: "83,000,000" },
      { label: "Area", value: "357,114 km²" },
    ]);
  });

  it("builds the practise query from the remembered setup plus the region", () => {
    expect(practiseQuery("Europe", {})).toBe("?region=Europe");
    const query = new URLSearchParams(
      practiseQuery("South America", { mode: "flag_to_country", scope: "un", pool: "manual", picks: ["DE"], size: 10, limit: 60 }),
    );
    expect(Object.fromEntries(query)).toEqual({ mode: "flag_to_country", scope: "un", size: "10", limit: "60", region: "South America" });
    expect(new URLSearchParams(practiseQuery("Asia", { pool: "easy" })).get("pool")).toBe("easy");
  });
});
