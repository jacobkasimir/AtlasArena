import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, isDemo, supabase } from "./api";
import { ErrorBox, Loading } from "./components";
import { validUsername } from "./domain";

import { ThemeControl } from "./Settings";

function Welcome() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function start() {
    setPending(true);
    setError("");
    try {
      await api.guest();
      navigate("/onboarding", { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="hero-shell grid md:grid-cols-[1.05fr_.95fr] gap-10 lg:gap-16 items-center py-8 md:py-12">
      <section className="hero-copy">
        <p className="eyebrow">THE WORLD IS YOUR PLAYGROUND</p>
        <h1 tabIndex={-1} className="text-5xl md:text-7xl font-black leading-tight mt-5">
          Stay curious.
          <br />
          <span className="text-mint">Play the world.</span>
        </h1>
        <p className="muted text-lg mt-6 max-w-lg">
          Chase your next personal best, discover somewhere new, and turn what you know into your next great run.
        </p>
        <div className="welcome-actions mt-8">
          {!isDemo && (
            <Link className="primary action-card action-card-featured" to="/auth?mode=guest">
              <span className="action-icon" aria-hidden="true">
                ✦
              </span>
              <span>
                <strong>Play as guest</strong>
                <small>Start now, no account needed</small>
              </span>
              <span className="action-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          )}
          {isDemo && (
            <button className="primary action-card action-card-featured" disabled={pending} onClick={start}>
              <span className="action-icon" aria-hidden="true">
                ✦
              </span>
              <span>
                <strong>{pending ? "Wird vorbereitet …" : "Play as guest"}</strong>
                <small>Start now, no account needed</small>
              </span>
              <span className="action-arrow" aria-hidden="true">
                →
              </span>
            </button>
          )}
          {!isDemo && (
            <Link className="secondary action-card" to="/auth?mode=signin">
              <span className="action-icon" aria-hidden="true">
                ↗
              </span>
              <span>
                <strong>Sign in</strong>
                <small>Continue with your account</small>
              </span>
              <span className="action-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          )}
          {!isDemo && (
            <Link className="secondary action-card" to="/auth?mode=signup">
              <span className="action-icon" aria-hidden="true">
                ＋
              </span>
              <span>
                <strong>Create account</strong>
                <small>Keep your progress permanently</small>
              </span>
              <span className="action-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          )}
        </div>
        <p className="text-sm muted mt-4">Guest access works without registration.</p>
        <ErrorBox message={error} />
      </section>
      <div className="globe-card map-grid" aria-hidden="true">
        <img className="marketing-icon" src="/icons/marketing_icon.png" alt="" />
        <p className="text-center font-mono text-sm muted">EXPLORE · LEARN · LEVEL UP</p>
      </div>
    </div>
  );
}

export function authMessage(message: string) {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Email or password is incorrect.";
  if (m.includes("email not confirmed")) return "Please confirm your email address first.";
  if (m.includes("user already registered") || m.includes("already been registered"))
    return "An account with this email already exists. Sign in or reset your password.";
  if (m.includes("password") && m.includes("least")) return "The password is too short.";
  if (m.includes("email address") && m.includes("already")) return "This email address is already in use.";
  if (/duplicate|unique|username_taken/i.test(message))
    return "This username is already taken. Please choose another one.";
  if (m.includes("invalid_profile"))
    return "The database does not support this avatar yet. Apply the latest migration first.";
  return message;
}

export function Onboarding() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const nav = useNavigate();
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setMessage("");
    const name = String(new FormData(e.currentTarget).get("username") ?? "").trim();
    try {
      if (!validUsername(name)) throw new Error("Use 2–24 characters: letters, numbers, spaces, _ or -.");
      await api.claimUsername(name);
      if (isDemo) localStorage.setItem("atlas-demo-onboarded", "yes");
      nav("/home", { replace: true });
    } catch (err) {
      const m = (err as Error).message;
      setMessage(
        /duplicate|unique|username_taken/i.test(m) ? "This username is already taken. Please choose another one." : m,
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="auth-panel onboarding-panel max-w-lg mx-auto">
      <p className="eyebrow">ONE LAST STEP</p>
      <h1 tabIndex={-1} className="heading mt-2">
        Choose your explorer name
      </h1>
      <p className="muted mt-3">Your name is unique across all players and can be changed later.</p>
      <form onSubmit={save} className="mt-5 space-y-4">
        <label>
          Username
          <input
            name="username"
            minLength={2}
            maxLength={24}
            pattern="[A-Za-z0-9 _\-]+"
            required
            autoComplete="nickname"
          />
        </label>
        <p className="field-hint muted">2–24 characters · letters, numbers, spaces, _ or -</p>
        <button className="primary w-full" disabled={pending}>
          {pending ? "Saving your name…" : "Continue to Atlas Arena →"}
        </button>
        <p role="alert">{message}</p>
      </form>
    </section>
  );
}
export function AccountActions() {
  const [user, setUser] = useState<{ isAnonymous: boolean; email: string | null } | null>(null);
  useEffect(() => {
    api
      .currentUser()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);
  return (
    <div className="account-actions mt-5">
      <p className="muted">
        {user?.isAnonymous ? "Guest account · progress stays on this device." : `Account · ${user?.email ?? ""}`}
      </p>
      {user?.isAnonymous && (
        <Link className="primary" to="/auth?mode=link">
          Create an account to save progress
        </Link>
      )}
      <ThemeControl />
    </div>
  );
}

export function Auth() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [action, setAction] = useState(params.has("recovery") ? "change" : (params.get("mode") ?? "choice"));
  const [checkingSession, setCheckingSession] = useState(Boolean(supabase));
  const [activeSession, setActiveSession] = useState(false);
  const [message, setMessage] = useState(
    params.get("reason") === "account_deleted"
      ? "This account is no longer available. Sign in with another account or create a new one."
      : "",
  );
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        const keepFlow =
          params.has("recovery") ||
          action === "change" ||
          action === "link" ||
          action === "reset" ||
          action === "guest";
        const hasSession = Boolean(data.session);
        setActiveSession(hasSession && !keepFlow);
        setCheckingSession(false);
        if (hasSession && !keepFlow) navigate("/home", { replace: true });
      })
      .catch(() => {
        if (active) setCheckingSession(false);
      });
    return () => {
      active = false;
    };
  }, [action, navigate, params]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setMessage("");
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const username = String(form.get("username") ?? "").trim();
    try {
      if (action === "signin") {
        await api.signIn(email, password);
        const u = await api.currentUser();
        if (u.requestedUsername) {
          try {
            await api.claimUsername(u.requestedUsername);
          } catch (e) {
            if (
              !String((e as Error).message)
                .toLowerCase()
                .includes("duplicate") &&
              !String((e as Error).message)
                .toLowerCase()
                .includes("username")
            )
              throw e;
          }
        }
        navigate("/home", { replace: true });
      } else if (action === "signup") {
        if (!validUsername(username)) throw new Error("Name: 2–24 characters, letters, numbers, spaces, _ or -.");
        const result = await api.signUp(email, password, username);
        setMessage(
          result.needsConfirmation
            ? "Please confirm your email. After that you can sign in normally."
            : "Account created. Setting up your profile.",
        );
        if (!result.needsConfirmation) {
          await api.claimUsername(username);
          navigate("/home", { replace: true });
        }
      } else if (action === "guest") {
        await api.guest();
        navigate("/onboarding", { replace: true });
      } else if (action === "reset") {
        await api.resetPassword(email);
        setMessage("If the account exists, a recovery message has been requested.");
      } else if (action === "change") {
        await api.changePassword(password);
        navigate("/home");
      } else {
        await api.link(email, password);
        setMessage("Confirm your email if prompted. Your guest ID and progress are kept.");
      }
    } catch (e) {
      setMessage(authMessage((e as Error).message));
    } finally {
      setPending(false);
    }
  }
  if (checkingSession || activeSession) return <Loading />;
  const choose = (next: string) => {
    setAction(next);
    setMessage("");
  };
  if (action === "choice")
    return (
      <section className="auth-panel max-w-lg mx-auto">
        <p className="eyebrow">ATLAS ARENA · ACCOUNT</p>
        <h1 tabIndex={-1} className="heading mt-2">
          How do you want to start?
        </h1>
        <p className="muted mt-3">Start playing right away, or save your progress with an account.</p>
        <div className="auth-choices mt-6">
          <button className="primary action-card action-card-featured" onClick={() => choose("guest")}>
            <span className="action-icon" aria-hidden="true">
              ✦
            </span>
            <span>
              <strong>Play as guest</strong>
              <small>Ohne Registrierung direkt loslegen</small>
            </span>
            <span className="action-arrow" aria-hidden="true">
              →
            </span>
          </button>
          {!isDemo && (
            <>
              <button className="secondary action-card" onClick={() => choose("signin")}>
                <span className="action-icon" aria-hidden="true">
                  ↗
                </span>
                <span>
                  <strong>Sign in</strong>
                  <small>Return to your account</small>
                </span>
                <span className="action-arrow" aria-hidden="true">
                  →
                </span>
              </button>
              <button className="secondary action-card" onClick={() => choose("signup")}>
                <span className="action-icon" aria-hidden="true">
                  ＋
                </span>
                <span>
                  <strong>Create account</strong>
                  <small>Save your progress and achievements</small>
                </span>
                <span className="action-arrow" aria-hidden="true">
                  →
                </span>
              </button>
            </>
          )}
          {isDemo && <p className="muted text-sm">Accounts are not available in the local demo.</p>}
        </div>
        <Link className="auth-back mt-5" to="/">
          ← Back to home
        </Link>
      </section>
    );
  return (
    <section className="auth-panel max-w-lg mx-auto">
      <p className="eyebrow">
        ATLAS ARENA ·{" "}
        {action === "signup"
          ? "NEUES KONTO"
          : action === "signin"
            ? "WELCOME BACK"
            : action === "guest"
              ? "GASTZUGANG"
              : "KONTO SICHERN"}
      </p>
      <h1 tabIndex={-1} className="heading mt-2">
        {action === "guest"
          ? "Dein Abenteuer wartet."
          : action === "signup"
            ? "Create an account."
            : action === "signin"
              ? "Good to see you."
              : action === "reset"
                ? "Reset password."
                : action === "change"
                  ? "Set a new password."
                  : "Deine Entdeckungen bleiben."}
      </h1>
      {isDemo ? (
        action === "guest" ? (
          <form className="mt-5" onSubmit={submit}>
            <button className="primary w-full" disabled={pending}>
              {pending ? "Wird vorbereitet …" : "Continue as guest"}
            </button>
          </form>
        ) : (
          <p className="muted mt-4">Account features are not available in the local demo.</p>
        )
      ) : (
        <form className="space-y-5 mt-5" onSubmit={submit}>
          {action === "signup" && (
            <label>
              Username
              <input
                name="username"
                required
                minLength={2}
                maxLength={24}
                pattern="[A-Za-z0-9 _\-]+"
                autoComplete="nickname"
              />
            </label>
          )}
          {!["change", "guest"].includes(action) && (
            <label>
              Email
              <input type="email" name="email" autoComplete="email" required />
            </label>
          )}
          {!["reset", "guest"].includes(action) && (
            <label>
              Password
              <input
                type="password"
                name="password"
                minLength={action === "signin" ? undefined : 12}
                autoComplete={action === "signin" ? "current-password" : "new-password"}
                required
              />
            </label>
          )}
          <button className="primary w-full" disabled={pending}>
            {pending
              ? "Please wait…"
              : action === "signin"
                ? "Sign in"
                : action === "guest"
                  ? "Continue as guest"
                  : action === "signup"
                    ? "Create account"
                    : action === "reset"
                      ? "Send reset link"
                      : action === "change"
                        ? "Save password"
                        : "Save progress"}
          </button>
        </form>
      )}
      {!isDemo && (
        <div className="auth-switches mt-5">
          <button className="auth-back" onClick={() => choose("choice")}>
            ← Choose another option
          </button>
          {action === "signin" && (
            <button className="auth-text-link" onClick={() => choose("reset")}>
              Forgot password?
            </button>
          )}
          {action === "signin" && (
            <button className="auth-text-link" onClick={() => choose("signup")}>
              No account yet? <strong>Create account</strong>
            </button>
          )}
          {action === "signup" && (
            <button className="auth-text-link" onClick={() => choose("signin")}>
              Already have an account? <strong>Sign in</strong>
            </button>
          )}
          {action !== "guest" && (
            <button className="auth-text-link" onClick={() => choose("guest")}>
              Continue as guest instead
            </button>
          )}
        </div>
      )}
      <p className="mt-4" role="status">
        {message}
      </p>
    </section>
  );
}

export function AuthRedirect() {
  const navigate = useNavigate();
  const [state, setState] = useState<"loading" | "guest" | "account" | "out" | "error">(
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
  useEffect(() => {
    if (state === "guest" || state === "account") navigate("/home", { replace: true });
  }, [state, navigate]);
  return state === "error" ? (
    <ErrorBox
      message="Your session could not be restored. Check your connection and reload."
      retry={() => window.location.reload()}
    />
  ) : state === "loading" ? (
    <Loading />
  ) : (
    <Welcome />
  );
}
function isDeletedAuthUser(error: unknown) {
  return /AUTH_REQUIRED|user.*not found|user from sub claim.*does not exist/i.test(
    (error as Error)?.message ?? String(error),
  );
}
export function Protected({ children }: { children: JSX.Element }) {
  const location = useLocation(),
    navigate = useNavigate();
  const authClient = supabase;
  const deletedAccount = useRef(false);
  const [state, setState] = useState<"loading" | "guest" | "account" | "out" | "deleted" | "onboarding" | "error">(
    "loading",
  );
  useEffect(() => {
    let active = true;
    if (isDemo) {
      if (localStorage.getItem("atlas-demo-signed-out") === "yes") {
        setState("out");
        return () => {
          active = false;
        };
      }
      if (location.pathname === "/onboarding") {
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
    const resolve = async (session: any) => {
      if (!session) {
        if (active) setState(deletedAccount.current ? "deleted" : "out");
        return;
      }
      const kind = session.user?.is_anonymous === false ? "account" : "guest";
      if (location.pathname === "/onboarding") {
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
            if (/duplicate|unique|username_taken/i.test((e as Error).message)) {
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
          } catch {}
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
  }, [location.pathname]);
  useEffect(() => {
    if (state === "out")
      navigate(isDemo ? "/" : "/auth?mode=signin&next=" + encodeURIComponent(location.pathname), { replace: true });
    if (state === "deleted") navigate("/auth?mode=signin&reason=account_deleted", { replace: true });
  }, [state, location.pathname, navigate]);
  useEffect(() => {
    if (state === "onboarding") navigate("/onboarding", { replace: true });
  }, [state, navigate]);
  useEffect(() => {
    if (isDemo || !authClient) return;
    let live = true;
    const validate = async () => {
      const { error } = await authClient.auth.getUser();
      if (error && isDeletedAuthUser(error)) {
        deletedAccount.current = true;
        try {
          await api.signOut();
        } catch {}
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
  }, []);
  if (state === "loading" || state === "out" || state === "deleted" || state === "onboarding") return <Loading />;
  if (state === "error")
    return (
      <ErrorBox
        message="Session or profile could not be loaded. Check your connection and reload."
        retry={() => location.pathname && window.location.reload()}
      />
    );
  return children;
}
