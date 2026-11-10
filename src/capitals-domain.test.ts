import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CapitalCountry } from "./domain";
import { capitalPercentage, capitalPool, classifyCapitalAnswer, isStrictCapitalBest, normalizeCapitalText, selectUnambiguousCapitals, structuredCapitalOptions } from "./capitals-domain";
import { capitalsDemo } from "./capitals-demo";

const country = (code: string, difficulty: string, region: string | null, ctc: boolean, ctcountry = ctc): CapitalCountry => ({
  code, name: code, officialName: null, region, difficulty, catalogKind: code.startsWith("entity:") ? "non_iso" : "iso_alpha2",
  codeAlpha2: /^[A-Z]{2}$/.test(code) ? code : null, codeAlpha3: null, flagSvgUrl: null,
  countryToCapitalEligible: ctc, countryToCapitalReason: ctc ? null : "No structured capital.",
  capitalToCountryEligible: ctcountry, capitalToCountryReason: ctcountry ? null : "Capital name is ambiguous."
});

describe("Capital catalog rules", () => {
  it("reads multiple structured capitals and attribute roles without splitting legacy strings", () => {
    const values = structuredCapitalOptions([
      { name: "South City", attributes: { administrative: true, primary: false } },
      { name: "Main City", attributes: { constitutional: true, primary: true } },
      { name: "  ", attributes: { primary: true } },
      "Legacy City / Another City"
    ]);
    expect(values).toEqual([
      { name: "Main City", roles: ["Constitutional"], primary: true },
      { name: "South City", roles: ["Administrative"], primary: false }
    ]);
    expect(structuredCapitalOptions("Legacy City / Another City")).toEqual([]);
  });

  it("filters easy exactly to easy/medium and intersects manual choices with region", () => {
    const catalog = [country("AA", "easy", "North", true), country("BB", "medium", "North", true), country("CC", "hard", "North", true), country("DD", "easy", "South", true), country("entity:1", "easy", "North", true)];
    const easy = capitalPool(catalog, "country_to_capital", "easy", [], "North");
    expect(easy.countries.map(item => item.code)).toEqual(["AA", "BB", "entity:1"]);
    expect(easy.easyTierExcluded.map(item => item.code)).toEqual(["CC"]);
    const manual = capitalPool(catalog, "country_to_capital", "manual", ["AA", "DD", "CC"], "North");
    expect(manual.countries.map(item => item.code)).toEqual(["AA", "CC"]);
    expect(manual.outsideRegion.map(item => item.code)).toEqual(["DD"]);
  });

  it("prefers unique capitals across the full catalog, even when a primary name collides", () => {
    const catalog = [
      { code: "A", capitals: [{ name: "Shared", roles: [], primary: true }, { name: "Unique", roles: ["Executive"], primary: false }] },
      { code: "B", capitals: [{ name: "Shared", roles: [], primary: true }] },
      { code: "C", capitals: [{ name: "Only", roles: [], primary: true }] }
    ];
    const selected = selectUnambiguousCapitals(catalog);
    expect(selected.get("A")?.name).toBe("Unique");
    expect(selected.get("B")).toBeNull();
    expect(selected.get("C")?.name).toBe("Only");
  });

  it("normalizes case, diacritics and whitespace and distinguishes ambiguous aliases", () => {
    expect(normalizeCapitalText("  São   Tomé ")).toBe("sao tome");
    expect(normalizeCapitalText("Ærøskøbing")).toBe("aeroskobing");
    expect(classifyCapitalAnswer("  SAO TOME ", ["São Tomé"])).toBe("correct");
    expect(classifyCapitalAnswer("Georgia", ["Georgia"], ["georgia"])).toBe("ambiguous");
    expect(classifyCapitalAnswer("wrong", ["São Tomé"])).toBe("incorrect");
  });

  it("calculates the displayed percentage to one decimal place and handles zero questions", () => {
    expect(capitalPercentage(2, 3)).toBe(66.7);
    expect(capitalPercentage(0, 0)).toBe(0);
  });

  it("does not count a full score-and-time tie as a new personal best", () => {
    expect(isStrictCapitalBest(100, 900, null)).toBe(true);
    expect(isStrictCapitalBest(101, 900, { score: 100, elapsedMs: 900 })).toBe(true);
    expect(isStrictCapitalBest(100, 899, { score: 100, elapsedMs: 900 })).toBe(true);
    expect(isStrictCapitalBest(100, 900, { score: 100, elapsedMs: 900 })).toBe(false);
  });
});

describe("Capitals local session flow", () => {
  beforeEach(() => localStorage.removeItem("atlas-capitals-demo-v1"));
  afterEach(() => localStorage.removeItem("atlas-capitals-demo-v1"));

  it("creates a one-country round, keeps answers hidden until finalization and records results", async () => {
    const session = await capitalsDemo.start("country_to_capital", "manual", ["GB"], "Europe", crypto.randomUUID());
    expect(session.total).toBe(1);
    expect(session.current?.prompt).toBe("Name a capital of United Kingdom.");
    expect(session.current?.acceptedAnswers).toBeNull();
    expect(session.entries[0].acceptedAnswers).toBeNull();
    const completedAnswer = await capitalsDemo.answer(session.id, session.current!.id, "  LONDON ", null, crypto.randomUUID());
    expect(completedAnswer.current?.outcome).toBe("correct");
    expect(completedAnswer.current?.points).toBe(100);
    expect(completedAnswer.current?.acceptedAnswers?.map(answer => answer.name)).toEqual(["London"]);
    const result = await capitalsDemo.next(session.id, crypto.randomUUID());
    expect(result.state).toBe("completed");
    expect(result.finalBadge).toBe("first_run");
    expect(result.topFive).toHaveLength(1);
  });

  it("keeps a reverse-mode challenge prompt without exposing the target country before reveal", async () => {
    const session = await capitalsDemo.start("capital_to_country", "manual", ["GB"], "Europe", crypto.randomUUID());
    expect(session.current?.prompt).toBe("London");
    expect(session.current?.countryName).toBe("");
    expect(session.current?.acceptedAnswers).toBeNull();
  });

  it("records a skip as zero points and reveals the saved answer", async () => {
    const session = await capitalsDemo.start("country_to_capital", "manual", ["US"], "North America", crypto.randomUUID());
    const result = await capitalsDemo.skip(session.id, session.current!.id, crypto.randomUUID());
    expect(result.current?.outcome).toBe("skipped");
    expect(result.current?.points).toBe(0);
    expect(result.score).toBe(0);
    expect(result.current?.acceptedAnswers?.map(answer => answer.name)).toEqual(["Washington, D.C."]);
  });
});
