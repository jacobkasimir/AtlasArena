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
  it("keeps generated usernames unconfirmed until the player claims one", async () => {
    const client = createClient(url!, anon!, { auth: { persistSession: false } });
    const signed = await client.auth.signInAnonymously();
    expect(signed.error).toBeNull();
    users.push(signed.data.user!.id);
    await client.rpc("arena_dashboard");
    const initial = await client.rpc("arena_username_confirmed");
    expect(initial.data).toBe(false);
    const username = `Player-${crypto.randomUUID().slice(0, 8)}`;
    const claimed = await client.rpc("arena_profile", {
      p_username: username, p_avatar: 0, p_favorites: []
    });
    expect(claimed.error).toBeNull();
    const confirmed = await client.rpc("arena_username_confirmed");
    expect(confirmed.data).toBe(true);
  });

  it("enforces trimmed case-insensitive usernames and serializes concurrent claims", async () => {
    root = createClient(url!, service!, { auth: { persistSession: false } });
    const clients = await Promise.all([0, 1].map(async () => {
      const client = createClient(url!, anon!, { auth: { persistSession: false } });
      const signed = await client.auth.signInAnonymously();
      expect(signed.error).toBeNull();
      users.push(signed.data.user!.id);
      await client.rpc("arena_dashboard");
      return client;
    }));
    const name = `Race-${crypto.randomUUID().slice(0, 7)}`;
    const claims = await Promise.all(clients.map((client, index) => client.rpc("arena_profile", {
      p_username: index ? ` ${name.toLowerCase()} ` : name,
      p_avatar: index, p_favorites: []
    })));
    expect(claims.filter(result => !result.error)).toHaveLength(1);
    expect(claims.filter(result => result.error)).toHaveLength(1);
    const profiles = await root.from("profiles").select("username").in("id", users);
    expect(new Set(profiles.data?.map(row => row.username.toLowerCase())).size).toBe(2);
  });

  it("keeps the user ID and profile progress when the anonymous identity is upgraded", async () => {
    root = root ?? createClient(url!, service!, { auth: { persistSession: false } });
    const client = createClient(url!, anon!, { auth: { persistSession: false } });
    const signed = await client.auth.signInAnonymously();
    const id = signed.data.user!.id;
    users.push(id);
    await client.rpc("arena_dashboard");
    await client.rpc("arena_profile", {p_username:`Upgrade-${crypto.randomUUID().slice(0,7)}`,p_avatar:2,p_favorites:[]});
    const before = await client.rpc("arena_dashboard");
    const upgradeEmail = `upgrade-${crypto.randomUUID()}@example.test`;
    const upgraded = await client.auth.updateUser({email:upgradeEmail,password:"isolated-test-password-123"});
    expect(upgraded.error).toBeNull();
    const after = await client.rpc("arena_dashboard");
    expect(upgraded.data.user?.id).toBe(id);
    expect(after.data.profile).toMatchObject({username:before.data.profile.username,avatar:2,xp:before.data.profile.xp});
  });

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

  it("persists Flags rules server-side, scopes ownership, and makes requests idempotent", async () => {
    const a = createClient(url!, anon!, { auth: { persistSession: false } });
    const b = createClient(url!, anon!, { auth: { persistSession: false } });
    for (const c of [a, b]) {
      const signed = await c.auth.signInAnonymously();
      expect(signed.error).toBeNull();
      users.push(signed.data.user!.id);
    }
    const setup = await a.rpc("arena_flags_setup");
    expect(setup.error).toBeNull();
    if (!setup.data.summary.easyCount) return; // Isolated projects may not have imported country assets.

    const startId = crypto.randomUUID();
    let game = await a.rpc("arena_flags_start", {
      p_direction: "country_to_flag", p_region: null, p_pool_tier: "easy", p_request_id: startId
    });
    expect(game.error).toBeNull();
    const sessionId = game.data.id as string;
    const target = game.data.current.id as string;
    const choices = game.data.current.choices as { id: string }[];
    const wrong = choices.find(option => option.id !== target);
    expect(wrong).toBeTruthy();

    const requestId = crypto.randomUUID();
    const firstWrong = await a.rpc("arena_flags_answer", {
      p_session_id: sessionId, p_entry_id: target, p_choice_id: wrong!.id,
      p_answer: null, p_request_id: requestId
    });
    expect(firstWrong.error).toBeNull();
    expect(firstWrong.data.current.attempts).toBe(1);
    expect(firstWrong.data.actionResult.outcome).toBe("wrong_choice");
    const retry = await a.rpc("arena_flags_answer", {
      p_session_id: sessionId, p_entry_id: target, p_choice_id: wrong!.id,
      p_answer: null, p_request_id: requestId
    });
    expect(retry.data.current.attempts).toBe(1);
    const duplicateOption = await a.rpc("arena_flags_answer", {
      p_session_id: sessionId, p_entry_id: target, p_choice_id: wrong!.id,
      p_answer: null, p_request_id: crypto.randomUUID()
    });
    expect(duplicateOption.data.current.attempts).toBe(1);
    expect(duplicateOption.data.actionResult.outcome).toBe("duplicate_choice");
    const reusedId = await a.rpc("arena_flags_answer", {
      p_session_id: sessionId, p_entry_id: target, p_choice_id: target,
      p_answer: null, p_request_id: requestId
    });
    expect(reusedId.error).not.toBeNull();

    const correct = await a.rpc("arena_flags_answer", {
      p_session_id: sessionId, p_entry_id: target, p_choice_id: target,
      p_answer: null, p_request_id: crypto.randomUUID()
    });
    expect(correct.error).toBeNull();
    expect(correct.data.score).toBe(60);
    expect((await b.rpc("arena_flags_view", { p_session_id: sessionId })).error).not.toBeNull();

    const textStart = await a.rpc("arena_flags_start", {
      p_direction: "flag_to_country", p_region: null, p_pool_tier: "easy", p_request_id: crypto.randomUUID()
    });
    expect(textStart.error).toBeNull();
    const textId = textStart.data.id as string;
    const entryId = textStart.data.current.id as string;
    const hint = await a.rpc("arena_flags_hint", { p_session_id: textId, p_entry_id: entryId, p_request_id: crypto.randomUUID() });
    expect(hint.error).toBeNull();
    expect(hint.data.current.hintUsed).toBe(true);
    const repeatedHint = await a.rpc("arena_flags_hint", { p_session_id: textId, p_entry_id: entryId, p_request_id: crypto.randomUUID() });
    expect(repeatedHint.data.hintsUsed).toBe(1);
    const skipped = await a.rpc("arena_flags_skip", { p_session_id: textId, p_entry_id: entryId, p_request_id: crypto.randomUUID() });
    expect(skipped.error).toBeNull();
    expect(skipped.data.skipped).toBe(1);
    expect(skipped.data.score).toBe(0);
    const pauseId = crypto.randomUUID();
    const paused = await a.rpc("arena_flags_pause", { p_session_id: textId, p_request_id: pauseId });
    expect(paused.error).toBeNull();
    expect(paused.data.state).toBe("paused");
    expect(paused.data.paused).toBe(true);
    const resumed = await a.rpc("arena_flags_resume", { p_session_id: textId, p_request_id: crypto.randomUUID() });
    expect(resumed.error).toBeNull();
    expect(resumed.data.state).toBe("active");
    const deleted = await a.rpc("arena_flags_delete", { p_session_id: textId, p_request_id: crypto.randomUUID() });
    expect(deleted.data.deleted).toBe(true);
    expect((await a.rpc("arena_flags_view", { p_session_id: textId })).error).not.toBeNull();
  }, 30000);
});
