import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoPersonalBests } from "./bests-demo";
import { capitalsDemo } from "./capitals-demo";
import { flagsDemo } from "./flags-demo";
import { GameChoice, PersonalBest, SetupPlace, describeSetup, filterPlaces, initialChoice, matchesBest, setupUrl } from "./game-setup";
import { recallDemo } from "./recall-demo";

const places: SetupPlace[] = [
  { code: "FR", name: "France", region: "Europe", un: true, easy: true, alpha2: "FR", modes: ["a", "b"] },
  { code: "RE", name: "Réunion", region: "Africa", un: false, easy: false, alpha2: "RE", modes: ["a", "b"], unModes: ["a"] },
  { code: "KE", name: "Kenya", region: "Africa", un: true, easy: true, alpha2: "KE", modes: ["a"] },
];
const choice = (patch: Partial<GameChoice> = {}): GameChoice => ({ mode: "a", scope: "all", region: null, pool: "all", picks: [], size: null, limit: null, ...patch });
const uuid = () => crypto.randomUUID();

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe("shared game setup", () => {
  it("filters by mode, catalog, region, difficulty and picks", () => {
    expect(filterPlaces(places, choice()).map((p) => p.code)).toEqual(["FR", "RE", "KE"]);
    expect(filterPlaces(places, choice({ scope: "un" })).map((p) => p.code)).toEqual(["FR", "KE"]);
    expect(filterPlaces(places, choice({ region: "Africa", pool: "easy" })).map((p) => p.code)).toEqual(["KE"]);
    expect(filterPlaces(places, choice({ pool: "manual", picks: ["RE", "XX"] })).map((p) => p.code)).toEqual(["RE"]);
    expect(filterPlaces(places, choice({ mode: "b" })).map((p) => p.code)).toEqual(["FR", "RE"]);
  });

  it("uses UN-only modes when only UN members are in play", () => {
    const shared: SetupPlace = { ...places[1], un: true, modes: ["a", "b"], unModes: ["a"] };
    expect(filterPlaces([shared], choice({ mode: "b", scope: "un" }))).toHaveLength(0);
    expect(filterPlaces([shared], choice({ mode: "b", scope: "all" }))).toHaveLength(1);
  });

  it("matches a best only for the exact same setup", () => {
    const best: PersonalBest = { game: "flags", mode: "a", scope: "un", region: "Europe", pool: "manual", selectedCodes: ["FR", "DE"],
      timeLimitSeconds: 300, total: 2, correct: 2, score: 200, maxScore: 200, elapsedMs: 1000, completedAt: "", runCount: 1 };
    const same = choice({ scope: "un", region: "Europe", pool: "manual", picks: ["DE", "FR"], limit: 300 });
    expect(matchesBest(best, "flags", same)).toBe(true);
    expect(matchesBest(best, "capitals", same)).toBe(false);
    expect(matchesBest(best, "flags", { ...same, limit: null })).toBe(false);
    expect(matchesBest(best, "flags", { ...same, picks: ["FR"] })).toBe(false);
    expect(matchesBest(best, "flags", { ...same, scope: "all" })).toBe(false);
  });

  it("round-trips a setup through the URL and reads the old replay parameters", () => {
    const full = choice({ mode: "b", scope: "un", region: "Africa", pool: "manual", picks: ["KE", "FR"], size: 25, limit: 600 });
    const url = new URL(setupUrl("flags", full), "https://atlas.test");
    expect(initialChoice("flags", url.searchParams, ["a", "b"])).toEqual({ ...full, picks: ["FR", "KE"] });
    const legacy = initialChoice("flags", new URLSearchParams("direction=b&difficulty=easy&region=Europe"), ["a", "b"]);
    expect(legacy).toMatchObject({ mode: "b", pool: "easy", region: "Europe", scope: "all" });
  });

  it("describes a setup in plain words", () => {
    expect(describeSetup({ scope: "un", region: null, pool: "easy", size: 10, limit: 300 })).toBe("UN member states · Whole world · Well-known · 10 random · 5 min");
  });
});

describe("demo rounds with the shared options", () => {
  it("plays a Flags practice sample and leaves it out of personal bests", async () => {
    let s = await flagsDemo.start("flag_to_country", null, "all", uuid(), { scope: "all", picks: [], size: 10, limit: null });
    expect(s.total).toBe(10);
    expect(s.ranked).toBe(false);
    for (let i = 0; i < s.total; i++) {
      s = await flagsDemo.skip(s.id, s.current!.id, uuid());
      s = await flagsDemo.next(s.id, uuid());
    }
    expect(s.finalBadge).toBe("unranked");
    expect(await demoPersonalBests()).toHaveLength(0);
  });

  it("ends a timed Flags round when the time is up and counts the rest as skipped", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T10:00:00Z"));
    const s = await flagsDemo.start("country_to_flag", "Europe", "all", uuid(), { scope: "all", picks: [], size: null, limit: 300 });
    await expect(flagsDemo.pause(s.id, uuid())).rejects.toThrow(/paused/);
    vi.setSystemTime(new Date("2026-11-22T10:06:00Z"));
    const after = await flagsDemo.answer(s.id, s.current!.id, s.current!.id, null, uuid());
    expect(after.timeUp).toBe(true);
    expect(after.state).toBe("completed");
    expect(after.skipped).toBe(s.total);
    expect(after.elapsedMs).toBe(300_000);
    const bests = await demoPersonalBests();
    expect(bests).toHaveLength(1);
    expect(bests[0]).toMatchObject({ game: "flags", timeLimitSeconds: 300, region: "Europe" });
  });

  it("plays only your own picks in Flags", async () => {
    const s = await flagsDemo.start("country_to_flag", null, "manual", uuid(), { scope: "all", picks: ["IS", "GB"], size: null, limit: null });
    expect(s.entries.map((e) => e.id).sort()).toEqual(["GB", "IS"]);
    expect(s.selectedCodes).toEqual(["GB", "IS"]);
  });

  it("samples Capitals rounds and ranks timed rounds separately", async () => {
    const sample = await capitalsDemo.start("country_to_capital", "all", [], null, uuid(), { scope: "all", picks: [], size: 10, limit: null });
    expect(sample.total).toBe(10);
    expect(sample.ranked).toBe(false);
    const timed = await capitalsDemo.start("country_to_capital", "all", [], null, uuid(), { scope: "all", picks: [], size: null, limit: 600 });
    expect(timed.deadlineAt).toBeTruthy();
    expect(timed.poolSignature).not.toBe(sample.poolSignature);
  });

  it("supports well-known and own-pick Recall sets, and treats a big sample as the whole set", async () => {
    const easy = await recallDemo.start({ kind: "capitals", scope: "all", region: null, size: null, timeLimitSeconds: null, pool: "easy", picks: [] }, uuid());
    const all = await recallDemo.start({ kind: "capitals", scope: "all", region: null, size: null, timeLimitSeconds: null, pool: "all", picks: [] }, uuid());
    expect(easy.total).toBeLessThanOrEqual(all.total); // every demo country is well-known
    expect(easy.ranked).toBe(true);
    const own = await recallDemo.start({ kind: "capitals", scope: "all", region: null, size: 50, timeLimitSeconds: null, pool: "manual", picks: ["IS", "GB"] }, uuid());
    expect(own.total).toBe(2);
    expect(own.size).toBeNull();
    expect(own.ranked).toBe(true);
    expect(own.selectedCodes).toEqual(["GB", "IS"]);
  });
});
