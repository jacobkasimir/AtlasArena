import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

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

describe("authenticated dashboard loading", () => {
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
    expect(authState.rpc).toHaveBeenCalledTimes(3); // route gate (profile and onboarding status) plus profile load
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

    expect(await screen.findByText("Choose your challenge")).toBeTruthy();
    expect(authState.rpc).toHaveBeenCalledTimes(3); // route gate (profile and onboarding status) plus home dashboard
  });

  it("redirects an unauthenticated direct private link to sign-in without a protected RPC", async () => {
    authState.session=null;
    render(<MemoryRouter initialEntries={["/profile"]}><App/></MemoryRouter>);
    expect(await screen.findByLabelText("E-Mail")).toBeTruthy();
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
