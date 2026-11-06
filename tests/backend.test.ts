// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.TEST_SUPABASE_URL;
const anon = process.env.TEST_SUPABASE_ANON_KEY;
const service = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(url && anon && service);
const users: string[] = [];
let root: SupabaseClient;

afterAll(async () => {
  if (root) for (const id of users) await root.auth.admin.deleteUser(id);
});

describe.skipIf(!configured)("isolated Supabase integration project", () => {
  it("checks authorization, import, secrecy, duplicates, and idempotent XP", async () => {
    root = createClient(url!, service!, { auth: { persistSession: false } });
    const a = createClient(url!, anon!, { auth: { persistSession: false } });
    const b = createClient(url!, anon!, { auth: { persistSession: false } });
    for (const c of [a, b]) {
      const r = await c.auth.signInAnonymously();
      expect(r.error).toBeNull();
      users.push(r.data.user!.id);
    }
    expect((await b.rpc("arena_admin_list")).error).not.toBeNull();

    const grant = await root.auth.admin.updateUserById(users[0], {
      app_metadata: { atlas_admin: true }
    });
    expect(grant.error).toBeNull();

    const prefix = "test-" + crypto.randomUUID().slice(0, 8);
    const records = Array.from({ length: 10 }, (_, i) => ({
      stableId: `${prefix}-${i}`, expectedVersion: 0,
      type: "mc", prompt: `Integration fixture ${i}: select A.`,
      category: "geography", subcategory: "cities", difficulty: "expert",
      options: ["a", "b", "c", "d"].map(id => ({ id, label: id.toUpperCase() })),
      correct: "a", explanation: "Integration fixture: A is the expected answer.",
      source: "https://example.org/test-fixture",
      sourceVerified: true, reviewStatus: "reviewed",
      lastReviewed: new Date().toISOString().slice(0, 10),
      referenceYear: null, countryCode: null, asset: null
    }));
    const invalid = structuredClone(records);
    invalid[0].correct = "invalid";
    const invalidResult = await a.rpc("arena_admin_import", {
      p_records: invalid, p_dry_run: true, p_publish: true
    });
    expect(invalidResult.data.ok).toBe(false);

    const imported = await a.rpc("arena_admin_import", {
      p_records: records, p_dry_run: false, p_publish: true
    });
    expect(imported.error).toBeNull();
    expect(imported.data.ok).toBe(true);

    const created = await a.rpc("arena_start", {
      p_mode: "classic", p_categories: ["cities"], p_difficulty: "expert"
    });
    expect(created.error).toBeNull();
    let s = created.data;
    expect(s.current).not.toHaveProperty("correct");
    expect(s.current).not.toHaveProperty("explanation");
    expect(s.reviews).toEqual([]);
    expect((await b.rpc("arena_view", { p_id: s.id })).error).not.toBeNull();
    const stolen = await b.from("profiles").select("*").eq("id", users[0]);
    expect(stolen.data).toEqual([]);

    const before = (await a.rpc("arena_dashboard")).data.profile.xp;
    for (let i = 0; i < 10; i++) {
      const params = { p_id: s.id, p_question: s.current.id, p_option: "a" };
      const response = await a.rpc("arena_answer", params);
      expect(response.error).toBeNull();
      s = response.data;
      if (s.status === "showing_feedback") {
        expect((await a.rpc("arena_answer", params)).error).not.toBeNull();
        s = (await a.rpc("arena_next", { p_id: s.id })).data;
      }
    }
    expect(s.status).toBe("completed");
    const once = (await a.rpc("arena_dashboard")).data.profile.xp;
    await a.rpc("arena_view", { p_id: s.id });
    await a.rpc("arena_view", { p_id: s.id });
    expect((await a.rpc("arena_dashboard")).data.profile.xp).toBe(once);
    expect(once).toBeGreaterThan(before);

    for (const r of records)
      await a.rpc("arena_admin_unpublish", { p_stable_id: r.stableId });
  }, 120000);
});
