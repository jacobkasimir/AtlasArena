import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

// api.ts reads the Supabase config at import time: stub it so these tests never depend on .env.local.
vi.hoisted(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
});

const authState = vi.hoisted(() => ({
  session: null as null | { access_token: string },
  getSession: vi.fn(),
  signInAnonymously: vi.fn(),
  signUp: vi.fn(),
  updateUser: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
  rpc: vi.fn()
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getSession: authState.getSession,
      signInAnonymously: authState.signInAnonymously,
      signUp: authState.signUp,
      updateUser: authState.updateUser,
      getUser: authState.getUser,
      signOut: authState.signOut,
      signInWithPassword: authState.signInWithPassword,
      onAuthStateChange: () => ({data:{subscription:{unsubscribe:vi.fn()}}})
    },
    rpc: authState.rpc
  })
}));

import { api } from "./api";

/** RPC names called so far, sorted, so a test can compare the exact set of calls independent of their order. */
function rpcNames() {
  return authState.rpc.mock.calls.map(([name]) => String(name)).sort();
}

/** Resolves once no further RPC is started for a few macrotasks (pending promise chains have run). */
async function rpcSettled() {
  let previous = -1;
  let stable = 0;
  while (stable < 3) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const count = authState.rpc.mock.calls.length;
    stable = count === previous ? stable + 1 : 0;
    previous = count;
  }
}

// Lazy routes (Hub, Quiz) load their chunk on first render; that can take well over a second in a busy full run.
const lazyRoute = { timeout: 5000 };

// The App renders need more than the default 5 s when the whole suite runs in parallel on a busy machine.
describe("authenticated dashboard loading", { timeout: 15_000 }, () => {
  beforeEach(() => {
    authState.session = null;
    authState.getSession.mockReset().mockImplementation(async () => ({
      data: { session: authState.session }, error: null
    }));
    authState.signInAnonymously.mockReset().mockImplementation(async () => {
      authState.session = { access_token: "test-session" };
      return { data: { session: authState.session }, error: null };
    });
    authState.rpc.mockReset().mockResolvedValue({ data: { profile: { username: "Guest" } }, error: null });
    authState.updateUser.mockReset().mockResolvedValue({error:null});
    authState.getUser.mockReset().mockResolvedValue({data:{user:{id:"guest-id",is_anonymous:true,email:null,user_metadata:{}}},error:null});
    authState.signUp.mockReset().mockResolvedValue({data:{session:null},error:null});
  });

  // Vitest runs without globals, so Testing Library cannot register its automatic cleanup: unmount every
  // rendered App explicitly and let its in-flight promise chains finish. Otherwise a tree from one test keeps
  // running effects (e.g. the profile's statistics loads) and its RPCs are counted in the next test.
  afterEach(async () => {
    cleanup();
    await rpcSettled();
  });

  it("waits for guest sign-in before the first dashboard RPC", async () => {
    await api.guest();
    await api.dashboard();

    expect(authState.signInAnonymously).toHaveBeenCalledOnce();
    expect(authState.rpc).toHaveBeenCalledOnce();
  });

  it("reuses a restored guest session without creating another identity", async () => {
    authState.session = { access_token: "restored-session" };

    await api.guest();
    await api.dashboard();

    expect(authState.signInAnonymously).not.toHaveBeenCalled();
    expect(authState.rpc).toHaveBeenCalledOnce();
  });

  it("supports direct dashboard loading only after session restoration", async () => {
    authState.session = { access_token: "restored-session" };

    await expect(api.dashboard()).resolves.toBeDefined();
    expect(authState.getSession).toHaveBeenCalledOnce();
    expect(authState.rpc).toHaveBeenCalledOnce();
  });

  it("refreshes a result through its read-only result RPC without starting a session", async()=>{
    authState.session={access_token:"restored-session"};
    authState.rpc.mockResolvedValue({data:{id:"finished-run",status:"completed",categories:["countries"],previousBest:420},error:null});
    await api.result("finished-run");
    await api.result("finished-run");
    expect(authState.rpc).toHaveBeenNthCalledWith(1,"arena_result",{p_id:"finished-run"});
    expect(authState.rpc).toHaveBeenNthCalledWith(2,"arena_result",{p_id:"finished-run"});
    expect(authState.rpc).not.toHaveBeenCalledWith("arena_start_saved",expect.anything());
  });

  it("starts a new run with the same saved filters for replay",async()=>{
    authState.session={access_token:"restored-session"};
    authState.rpc.mockResolvedValue({data:{id:"new-run",status:"awaiting_answer"},error:null});
    const created=await api.play("classic",["countries"],"hard","DEU",10);
    expect(created.id).toBe("new-run");
    expect(authState.rpc).toHaveBeenCalledWith("arena_start_saved",{
      p_mode:"classic",p_categories:["countries"],p_difficulty:"hard",p_country:"DEU",p_count:10
    });
  });

  it("loads /profile directly with a restored guest session", async () => {
    authState.session = { access_token: "restored-session" };
    authState.rpc.mockResolvedValue({ data: {
      profile: { username: "Returning Guest", avatar: 0, favorites: [], xp: 0, admin: false },
      totals: { games: 0, correct: 0, incorrect: 0 },
      best: { classic: null, timed: null, endless: null },
      sessions: []
    }, error: null });

    render(<MemoryRouter initialEntries={["/profile"]}><App/></MemoryRouter>);

    expect(await screen.findByText("Your explorer profile")).toBeTruthy();
    // The heading renders before the Statistics section's effects run, so wait for its loads to start.
    // Route gate (profile and username status), profile load, then statistics: game stats, personal bests, achievements.
    const expected = [
      "arena_dashboard", "arena_username_confirmed",
      "arena_dashboard",
      "arena_game_stats", "arena_personal_bests", "arena_achievements",
    ].sort();
    await waitFor(() => expect(rpcNames()).toEqual(expected));
    await rpcSettled();
    expect(rpcNames()).toEqual(expected);
    expect(authState.rpc).toHaveBeenCalledWith("arena_dashboard", { p_offset: 0 });
  });

  it("loads /home directly with a restored guest session", async () => {
    authState.session = { access_token: "restored-session" };
    authState.rpc.mockResolvedValue({ data: {
      profile: { username: "Returning Guest", avatar: 0, favorites: [], xp: 0, admin: false },
      totals: { games: 0, correct: 0, incorrect: 0 },
      best: { classic: null, timed: null, endless: null },
      sessions: []
    }, error: null });

    render(<MemoryRouter initialEntries={["/home"]}><App/></MemoryRouter>);

    expect(await screen.findByText("Games", {}, lazyRoute)).toBeTruthy();
    // Route gate (profile and username status), then one Home load of every game's progress and the Today cards.
    const expected = [
      "arena_dashboard", "arena_username_confirmed",
      "arena_dashboard", "arena_flags_setup", "arena_capitals_setup", "arena_recall_setup",
      "arena_personal_bests", "arena_game_stats",
      "arena_daily_status", "arena_review_summary", "arena_achievements",
    ].sort();
    await waitFor(() => expect(rpcNames()).toEqual(expected));
    await rpcSettled();
    expect(rpcNames()).toEqual(expected);
  });

  it("opens the quiz setup on /quiz", async () => {
    authState.session = { access_token: "restored-session" };
    authState.rpc.mockResolvedValue({ data: {
      profile: { username: "Returning Guest", avatar: 0, favorites: [], xp: 0, admin: false },
      totals: { games: 0, correct: 0, incorrect: 0 },
      best: { classic: null, timed: null, endless: null },
      sessions: []
    }, error: null });

    render(<MemoryRouter initialEntries={["/quiz"]}><App/></MemoryRouter>);

    expect(await screen.findByText("Ready for a round?", {}, lazyRoute)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start game" })).toBeTruthy();
  });

  it("redirects an unauthenticated direct private link to sign-in without a protected RPC", async () => {
    authState.session=null;
    render(<MemoryRouter initialEntries={["/profile"]}><App/></MemoryRouter>);
    expect(await screen.findByLabelText("Email", {}, lazyRoute)).toBeTruthy();
    await rpcSettled();
    expect(authState.rpc).not.toHaveBeenCalled();
  });

  it("does not call a protected RPC or replace a missing guest implicitly", async () => {
    await expect(api.dashboard()).rejects.toThrow("AUTH_REQUIRED");

    expect(authState.signInAnonymously).not.toHaveBeenCalled();
    expect(authState.rpc).not.toHaveBeenCalled();
  });

  it("requests confirmation on registration instead of treating it as a signed-in session", async () => {
    await expect(api.signUp("new@example.test", "a-long-secure-password", "New Explorer"))
      .resolves.toEqual({needsConfirmation:true});
    expect(authState.signUp).toHaveBeenCalledOnce();
    expect(authState.signUp.mock.calls[0][0].options.data.requested_username).toBe("New Explorer");
    expect(authState.signUp.mock.calls[0][0].options.data.display_name).toBe("New Explorer");
    expect(authState.signUp.mock.calls[0][0].options.data.full_name).toBe("New Explorer");
  });

  it("syncs the chosen profile username to Supabase's display name metadata", async () => {
    authState.session={access_token:"existing-guest"};
    authState.rpc.mockResolvedValue({data:null,error:null});
    await api.saveProfile({username:"  New Explorer  ",avatar:2,favorites:[]});
    expect(authState.updateUser).toHaveBeenCalledWith({data:{username:"New Explorer",display_name:"New Explorer",full_name:"New Explorer",avatar:2}});
  });

  it("upgrades the current anonymous identity without signing in as a second user", async () => {
    authState.session={access_token:"existing-guest"};
    await api.link("guest@example.test", "a-long-secure-password");
    expect(authState.updateUser).toHaveBeenCalledWith({email:"guest@example.test",password:"a-long-secure-password"});
    expect(authState.signInWithPassword).not.toHaveBeenCalled();
    expect(authState.signInAnonymously).not.toHaveBeenCalled();
  });
});
