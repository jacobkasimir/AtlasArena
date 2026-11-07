import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

const authState = vi.hoisted(() => ({
  session: null as null | { access_token: string },
  getSession: vi.fn(),
  signInAnonymously: vi.fn(),
  rpc: vi.fn()
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getSession: authState.getSession,
      signInAnonymously: authState.signInAnonymously
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
    expect(authState.rpc).toHaveBeenCalledOnce();
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
    expect(authState.rpc).toHaveBeenCalledOnce();
  });

  it("does not call a protected RPC or replace a missing guest implicitly", async () => {
    await expect(api.dashboard()).rejects.toThrow("AUTH_REQUIRED");

    expect(authState.signInAnonymously).not.toHaveBeenCalled();
    expect(authState.rpc).not.toHaveBeenCalled();
  });
});
