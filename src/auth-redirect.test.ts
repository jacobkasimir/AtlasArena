import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Online mode with a mocked Supabase client: these tests check which URLs the auth emails link back to.
vi.hoisted(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
});

const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { ...auth, onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) },
    rpc: vi.fn(),
  }),
}));

import { api, authRedirectUrl } from "./api";
import {
  completeAuthCallback,
  continueInPreferredApp,
  EXPIRED_LINK,
  parseAuthCallback,
  performAuthAction,
} from "./auth-flow";
import { planRedirect, setViewMode } from "./view-mode";

const origin = window.location.origin;

beforeEach(() => {
  auth.signUp.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  auth.resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  auth.updateUser.mockReset().mockResolvedValue({ error: null });
  auth.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
  auth.getUser
    .mockReset()
    .mockResolvedValue({ data: { user: { id: "g", is_anonymous: true, user_metadata: {} } }, error: null });
  auth.verifyOtp.mockReset();
  auth.exchangeCodeForSession.mockReset();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("auth email redirect URLs", () => {
  it("builds one URL per app from this page's origin", () => {
    expect(authRedirectUrl("confirm")).toBe(`${origin}/auth`);
    expect(authRedirectUrl("recovery")).toBe(`${origin}/auth?recovery=1`);
    expect(authRedirectUrl("confirm", "desktop")).toBe(`${origin}/auth`);
    expect(authRedirectUrl("confirm", "phone")).toBe(`${origin}/phone/sign-in?auth=callback`);
    expect(authRedirectUrl("recovery", "phone")).toBe(`${origin}/phone/sign-in?recovery=1`);
  });

  it("sign-up, reset and guest linking default to the desktop app", async () => {
    await api.signUp("a@example.test", "a-long-secure-password", "Ana");
    await api.resetPassword("a@example.test");
    await api.link("a@example.test", "a-long-secure-password");
    expect(auth.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(`${origin}/auth`);
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("a@example.test", { redirectTo: `${origin}/auth?recovery=1` });
    // Guest linking from the desktop keeps its old call (the email-change link uses the Site URL, i.e. desktop).
    expect(auth.updateUser.mock.calls[0]).toEqual([{ email: "a@example.test", password: "a-long-secure-password" }]);
  });

  it("requests from the phone app link back to the phone app", async () => {
    const fields = { email: "a@example.test", password: "a-long-secure-password", username: "Ana" };
    await performAuthAction("signup", fields, { app: "phone" });
    await performAuthAction("reset", fields, { app: "phone" });
    await performAuthAction("link", fields, { app: "phone" });
    expect(auth.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(`${origin}/phone/sign-in?auth=callback`);
    expect(auth.resetPasswordForEmail.mock.calls[0][1]).toEqual({ redirectTo: `${origin}/phone/sign-in?recovery=1` });
    expect(auth.updateUser.mock.calls[0][1]).toEqual({ emailRedirectTo: `${origin}/phone/sign-in?auth=callback` });
  });
});

describe("email link callback", () => {
  it("reads recovery, confirmation, PKCE codes, token hashes and errors", () => {
    expect(parseAuthCallback("", "")).toBeNull();
    expect(parseAuthCallback("?mode=signin", "")).toBeNull();
    expect(parseAuthCallback("?recovery=1", "#access_token=x&type=recovery")?.kind).toBe("recovery");
    expect(parseAuthCallback("", "#access_token=x&type=recovery")?.kind).toBe("recovery");
    expect(parseAuthCallback("?auth=callback", "#access_token=x&type=signup")?.kind).toBe("confirm");
    expect(parseAuthCallback("?auth=callback&code=abc", "")).toMatchObject({ kind: "confirm", code: "abc" });
    expect(parseAuthCallback("?token_hash=h&type=recovery", "")).toMatchObject({ kind: "recovery", tokenHash: "h" });
    expect(parseAuthCallback("?auth=callback", "#error=access_denied&error_description=Email+link+is+invalid")).toMatchObject({
      error: EXPIRED_LINK,
    });
  });

  it("keeps an existing session, exchanges a PKCE code or token hash, and reports bad links", async () => {
    await expect(completeAuthCallback({ kind: "confirm" })).resolves.toEqual({ session: true });
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    await expect(completeAuthCallback({ kind: "confirm", code: "abc" })).resolves.toEqual({ session: true });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    auth.verifyOtp.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    await expect(completeAuthCallback({ kind: "recovery", tokenHash: "h", type: "recovery" })).resolves.toEqual({
      session: true,
    });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "h", type: "recovery" });
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { message: "bad code" } });
    await expect(completeAuthCallback({ kind: "confirm", code: "old" })).rejects.toThrow(EXPIRED_LINK);
    await expect(completeAuthCallback({ kind: "confirm", error: EXPIRED_LINK })).rejects.toThrow(EXPIRED_LINK);
    await expect(completeAuthCallback({ kind: "confirm" })).resolves.toEqual({ session: false });
  });
});

describe("email links and the view mode", () => {
  const base = { mode: "auto" as const, guard: null, now: 1000 };

  it("never moves a callback page to the other app, in either direction", () => {
    // Phone link opened on a desktop (Auto would pick desktop).
    for (const search of ["?auth=callback", "?recovery=1", "?auth=callback&code=abc", "?token_hash=h&type=signup"]) {
      expect(planRedirect({ ...base, app: "phone", detectedPhone: false, pathname: "/phone/sign-in", search })).toBeNull();
    }
    expect(
      planRedirect({ ...base, app: "phone", detectedPhone: false, pathname: "/phone/sign-in", hash: "#access_token=x" }),
    ).toBeNull();
    // Desktop link opened on a phone, also with an explicit Phone choice.
    expect(planRedirect({ ...base, app: "desktop", detectedPhone: true, pathname: "/auth", search: "?code=abc" })).toBeNull();
    expect(
      planRedirect({ ...base, mode: "phone", app: "desktop", detectedPhone: true, pathname: "/", search: "?code=abc" }),
    ).toBeNull();
    // An ordinary sign-in page still follows the view mode.
    expect(planRedirect({ ...base, app: "phone", detectedPhone: false, pathname: "/phone/sign-in", search: "?mode=signin" })).toBe(
      "/auth?mode=signin",
    );
  });

  function fakeWindow(pathname: string) {
    const replace = vi.fn();
    return { win: { location: { pathname, search: "", hash: "", replace } } as unknown as Window, replace };
  }

  it("after the link is handled, the normal rules apply once and do not loop", () => {
    // Phone link opened on a desktop: after confirmation the phone home hands over to the desktop home.
    const phone = fakeWindow("/phone/");
    vi.stubGlobal("matchMedia", undefined);
    expect(continueInPreferredApp("phone", phone.win, 1000)).toBe(true);
    expect(phone.replace).toHaveBeenCalledWith("/home");
    // The desktop app then loads and does not send the player back.
    const desktop = fakeWindow("/home");
    expect(continueInPreferredApp("desktop", desktop.win, 1500)).toBe(false);
    expect(desktop.replace).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("stays in the app the player chose", () => {
    setViewMode("phone");
    const phone = fakeWindow("/phone/");
    expect(continueInPreferredApp("phone", phone.win, 1000)).toBe(false);
    expect(phone.replace).not.toHaveBeenCalled();
  });
});
