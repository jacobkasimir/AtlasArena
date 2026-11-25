// Session and sign-in logic shared by the desktop app (src/Auth.tsx) and the phone app (phone/src/shell).
// UI lives in those files; every decision about sessions, onboarding and sign-in lives here, once.
import { useEffect, useRef, useState } from "react";
import { api, AuthApp, initialAuthUrl, isDemo, supabase } from "./api";
import { validUsername } from "./domain";
import { isAuthCallbackUrl, redirectAtStartup } from "./view-mode";

/** What a protected screen should do with the current visitor. */
export type GateState = "loading" | "guest" | "account" | "out" | "deleted" | "onboarding" | "error";

/** What the landing page should do: send signed-in players on, or show the welcome screen. */
export type LandingState = "loading" | "guest" | "account" | "out" | "error";

/** The sign-in screen's steps. "choice" is the overview with guest / sign in / create account. */
export type AuthAction = "choice" | "signin" | "signup" | "guest" | "reset" | "change" | "link";

export const authActions: readonly AuthAction[] = ["choice", "signin", "signup", "guest", "reset", "change", "link"];

/** Where an auth step wants to go next. Each app maps these to its own paths. */
export type AuthDestination = "home" | "onboarding";

export type AuthOutcome = { next?: AuthDestination; replace?: boolean; message?: string };

export const USERNAME_RULE = "Use 2–24 characters: letters, numbers, spaces, _ or -.";
export const USERNAME_TAKEN = "This username is already taken. Please choose another one.";

export function isDeletedAuthUser(error: unknown) {
  return /AUTH_REQUIRED|user.*not found|user from sub claim.*does not exist/i.test(
    (error as Error)?.message ?? String(error),
  );
}

function isUsernameTaken(message: string) {
  return /duplicate|unique|username_taken/i.test(message);
}

/** Readable English text for Supabase auth errors. */
export function authMessage(message: string) {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Email or password is incorrect.";
  if (m.includes("email not confirmed")) return "Please confirm your email address first.";
  if (m.includes("user already registered") || m.includes("already been registered"))
    return "An account with this email already exists. Sign in or reset your password.";
  if (m.includes("password") && m.includes("least")) return "The password is too short.";
  if (m.includes("email address") && m.includes("already")) return "This email address is already in use.";
  if (isUsernameTaken(message)) return USERNAME_TAKEN;
  if (m.includes("invalid_profile"))
    return "The database does not support this avatar yet. Apply the latest migration first.";
  return message;
}

/** Steps that must stay on the sign-in screen even when a session exists. */
export function keepsAuthFlow(action: string, recovery: boolean) {
  return recovery || action === "change" || action === "link" || action === "reset" || action === "guest";
}

/**
 * Runs one sign-in screen step. Throws with a readable message (see authMessage) when it fails.
 * Returns where to go next and/or a message to show.
 */
export async function performAuthAction(
  action: AuthAction,
  fields: { email: string; password: string; username: string },
  options: { app?: AuthApp } = {},
): Promise<AuthOutcome> {
  const { email, password, username } = fields;
  const app = { app: options.app ?? "desktop" } as const;
  try {
    if (action === "signin") {
      await api.signIn(email, password);
      const u = await api.currentUser();
      if (u.requestedUsername) {
        try {
          await api.claimUsername(u.requestedUsername);
        } catch (e) {
          const text = String((e as Error).message).toLowerCase();
          if (!text.includes("duplicate") && !text.includes("username")) throw e;
        }
      }
      return { next: "home", replace: true };
    }
    if (action === "signup") {
      if (!validUsername(username)) throw new Error("Name: 2–24 characters, letters, numbers, spaces, _ or -.");
      const result = await api.signUp(email, password, username, app);
      if (result.needsConfirmation) return { message: "Please confirm your email. After that you can sign in normally." };
      await api.claimUsername(username);
      return { next: "home", replace: true, message: "Account created. Setting up your profile." };
    }
    if (action === "guest") {
      await api.guest();
      return { next: "onboarding", replace: true };
    }
    if (action === "reset") {
      await api.resetPassword(email, app);
      return { message: "If the account exists, a recovery message has been requested." };
    }
    if (action === "change") {
      await api.changePassword(password);
      return { next: "home", replace: false };
    }
    await api.link(email, password, app);
    return { message: "Confirm your email if prompted. Your guest ID and progress are kept." };
  } catch (e) {
    throw new Error(authMessage((e as Error).message));
  }
}

// ---------------------------------------------------------------------------------------------------------
// Email links (sign-up confirmation, password reset, email change). Both apps land here: desktop /auth,
// phone /phone/sign-in. A link sent from one app also works when it is opened in the other one.
// ---------------------------------------------------------------------------------------------------------

export type AuthCallback = {
  /** "recovery": show the new-password form; "confirm": the email was confirmed, continue signed in. */
  kind: "recovery" | "confirm";
  /** Readable error when Supabase reported one (expired or already used link). */
  error?: string;
  code?: string;
  tokenHash?: string;
  type?: string;
};

export const EXPIRED_LINK = "This link is invalid or has expired. Request a new one.";
export const RECOVERY_EXPIRED = "This password reset link is invalid or has expired. Request a new one below.";
export const EMAIL_CONFIRMED = "Your email is confirmed. Sign in to continue.";

let callbackConsumed = false;

/**
 * The hash the page was opened with, until a callback has been handled. supabase-js clears the hash while it
 * reads the tokens, often before React renders, so the router's location.hash can already be empty.
 */
export function pendingAuthHash() {
  return callbackConsumed ? "" : (initialAuthUrl?.hash ?? "");
}

/** Marks the email link as handled, so later visits to the sign-in screen behave normally. */
export function consumeAuthCallback() {
  callbackConsumed = true;
}

/** Pure: reads an email-link return from a query and hash. null for an ordinary visit. */
export function parseAuthCallback(search: string, hash: string): AuthCallback | null {
  if (!isAuthCallbackUrl(search, hash)) return null;
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const type = query.get("type") ?? fragment.get("type") ?? undefined;
  const callback: AuthCallback = {
    kind: query.has("recovery") || type === "recovery" ? "recovery" : "confirm",
  };
  if (query.get("code")) callback.code = query.get("code") ?? undefined;
  if (query.get("token_hash")) callback.tokenHash = query.get("token_hash") ?? undefined;
  if (type) callback.type = type;
  if (query.get("error_description") || fragment.get("error_description")) callback.error = EXPIRED_LINK;
  return callback;
}

/** The email-link return of the current screen (demo: never, it has no email auth). */
export function readAuthCallback(search: string, hash: string): AuthCallback | null {
  if (isDemo) return null;
  return parseAuthCallback(search, hash || pendingAuthHash());
}

/**
 * Finishes the sign-in an email link started and tells whether a session exists now. supabase-js already
 * handles tokens in the hash; a `token_hash` (custom email template) or a PKCE `code` is exchanged here.
 * Throws with a readable message when the link is invalid or expired.
 */
export async function completeAuthCallback(callback: AuthCallback): Promise<{ session: boolean }> {
  if (callback.error) throw new Error(callback.error);
  if (!supabase) return { session: false };
  const { data } = await supabase.auth.getSession();
  if (data.session) return { session: true };
  if (callback.tokenHash && callback.type) {
    const { data: verified, error } = await supabase.auth.verifyOtp({
      token_hash: callback.tokenHash,
      type: callback.type as "signup" | "recovery" | "invite" | "magiclink" | "email" | "email_change",
    });
    if (error) throw new Error(EXPIRED_LINK);
    return { session: Boolean(verified.session) };
  }
  if (callback.code) {
    const { data: exchanged, error } = await supabase.auth.exchangeCodeForSession(callback.code);
    if (error) throw new Error(EXPIRED_LINK);
    return { session: Boolean(exchanged.session) };
  }
  return { session: false };
}

/**
 * After an email link has been handled: apply the normal view-mode rules (e.g. a phone link opened on a
 * desktop continues in the desktop app). Call after navigating to the destination. True when the page is
 * being replaced by the other app.
 */
export function continueInPreferredApp(app: AuthApp, win: Window = window, now = Date.now()) {
  return redirectAtStartup(app, win, now);
}

/** Saves the explorer name chosen during onboarding. Throws with a readable message. */
export async function completeOnboarding(rawName: string) {
  const name = rawName.trim();
  if (!validUsername(name)) throw new Error(USERNAME_RULE);
  try {
    await api.claimUsername(name);
  } catch (e) {
    const message = (e as Error).message;
    throw new Error(isUsernameTaken(message) ? USERNAME_TAKEN : message);
  }
  if (isDemo) localStorage.setItem("atlas-demo-onboarded", "yes");
}

/** True when a Supabase session exists (always false in the demo, which has no Supabase client). */
export async function hasActiveSession(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

/** Landing page state: is anyone signed in on this device? Follows sign-in and sign-out live. */
export function useLandingState(): LandingState {
  const [state, setState] = useState<LandingState>(
    isDemo ? (localStorage.getItem("atlas-demo-signed-out") === "yes" ? "out" : "guest") : "loading",
  );
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (active)
          setState(
            error ? "error" : !data.session ? "out" : data.session.user?.is_anonymous === false ? "account" : "guest",
          );
      })
      .catch(() => {
        if (active) setState("error");
      });
    const subscription = supabase.auth.onAuthStateChange?.((_e, s) =>
      setState(!s ? "out" : s.user.is_anonymous ? "guest" : "account"),
    )?.data.subscription;
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);
  return state;
}

/**
 * Decides whether a protected screen may render: restores the session, loads the profile, finishes a pending
 * username claim and sends new players to onboarding. Re-checks every 30 s and on focus so a deleted account
 * is noticed. `pathname` is the router path (without basename); `onboardingPath` is that app's onboarding route.
 */
export function useSessionGate(pathname: string, onboardingPath = "/onboarding"): GateState {
  const authClient = supabase;
  const deletedAccount = useRef(false);
  const [state, setState] = useState<GateState>("loading");
  useEffect(() => {
    let active = true;
    if (isDemo) {
      if (localStorage.getItem("atlas-demo-signed-out") === "yes") {
        setState("out");
        return () => {
          active = false;
        };
      }
      if (pathname === onboardingPath) {
        setState("guest");
        return () => {
          active = false;
        };
      }
      api
        .dashboard()
        .then((d) => {
          if (active)
            setState(
              d.profile.username === "Traveler" && !localStorage.getItem("atlas-demo-onboarded")
                ? "onboarding"
                : "guest",
            );
        })
        .catch(() => {
          if (active) setState("error");
        });
      return () => {
        active = false;
      };
    }
    if (!supabase) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolve = async (session: any) => {
      if (!session) {
        if (active) setState(deletedAccount.current ? "deleted" : "out");
        return;
      }
      const kind = session.user?.is_anonymous === false ? "account" : "guest";
      if (pathname === onboardingPath) {
        await api.currentUser();
        if (active) setState(kind);
        return;
      }
      try {
        const d = await api.dashboard();
        const confirmed = await api.usernameConfirmed();
        const requested = String(session.user?.user_metadata?.requested_username ?? "");
        if (!confirmed && requested) {
          try {
            await api.claimUsername(requested);
            if (active) setState(kind);
            return;
          } catch (e) {
            if (isUsernameTaken((e as Error).message)) {
              if (active) setState("onboarding");
              return;
            }
            throw e;
          }
        }
        if (active) setState(!confirmed || !validUsername(d.profile.username) ? "onboarding" : kind);
      } catch (e) {
        if (isDeletedAuthUser(e)) {
          deletedAccount.current = true;
          try {
            await api.signOut();
          } catch {
            /* already signed out */
          }
          if (active) setState("deleted");
        } else if (active) setState("error");
      }
    };
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        if (active) setState("error");
      } else void resolve(data.session);
    });
    const subscription = supabase.auth.onAuthStateChange?.((_e, s) => {
      void resolve(s);
    })?.data.subscription;
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [pathname, onboardingPath]);
  useEffect(() => {
    if (isDemo || !authClient) return;
    let live = true;
    const validate = async () => {
      const { error } = await authClient.auth.getUser();
      if (error && isDeletedAuthUser(error)) {
        deletedAccount.current = true;
        try {
          await api.signOut();
        } catch {
          /* already signed out */
        }
        if (live) setState("deleted");
      }
    };
    const timer = window.setInterval(() => void validate(), 30000);
    window.addEventListener("focus", validate);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", validate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}
