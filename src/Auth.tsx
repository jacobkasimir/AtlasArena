import { FormEvent, useEffect, useRef, useState } from "react";
import { Icon, IconTile, games } from "./icons";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, isDemo, supabase } from "./api";
import { ErrorBox, Loading } from "./components";
import {
  authActions,
  AuthAction,
  completeAuthCallback,
  completeOnboarding,
  consumeAuthCallback,
  continueInPreferredApp,
  EMAIL_CONFIRMED,
  keepsAuthFlow,
  performAuthAction,
  readAuthCallback,
  RECOVERY_EXPIRED,
  useLandingState,
  useSessionGate,
} from "./auth-flow";
export { authMessage } from "./auth-flow";

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
                <Icon name="zap" size={20} />
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
                <Icon name="zap" size={20} />
              </span>
              <span>
                <strong>{pending ? "Preparing…" : "Play as guest"}</strong>
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
                <Icon name="lock" size={20} />
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
                <Icon name="sparkles" size={20} />
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
        <p className="text-sm muted mt-4">Guest access works without registration. Create an account later to keep your progress on every device.</p>
        <ErrorBox message={error} />
      </section>
      <div className="globe-card map-grid welcome-flags" aria-hidden="true">
        <div className="welcome-flag-wall">
          {welcomeFlags.map((code, index) => (
            <img key={code} src={`/flags/${code}.svg`} alt="" style={{ animationDelay: `${index * 90}ms` }} />
          ))}
        </div>
        <p className="text-center font-mono text-sm muted">EXPLORE · LEARN · LEVEL UP</p>
      </div>
      <section className="welcome-games md:col-span-2" aria-labelledby="welcome-games-title">
        <h2 id="welcome-games-title" className="hub-section-title">Six ways to learn the world</h2>
        <ul className="welcome-game-grid">
          {welcomeGames.map((game) => (
            <li key={game.title}>
              <IconTile name={games[game.game].icon} tone={games[game.game].tone} />
              <strong>{game.title}</strong>
              <p>{game.text}</p>
            </li>
          ))}
        </ul>
        <ul className="welcome-points">
          <li><IconTile name="calendar" tone="daily" size="sm" /> A daily challenge – the same ten questions for everyone</li>
          <li><IconTile name="review" tone="review" size="sm" /> Your mistakes come back until you get them right</li>
          <li><IconTile name="medal" tone="awards" size="sm" /> Personal bests, statistics and badges for every game</li>
          <li><IconTile name="languages" tone="explorer" size="sm" /> Answers in English, German or French</li>
        </ul>
      </section>
    </div>
  );
}

const welcomeFlags = ["jp", "br", "ca", "ke", "no", "in", "mx", "za", "kr", "it", "ar", "ch", "ng", "nz", "se", "tr"];
const welcomeGames: { game: keyof typeof games; title: string; text: string }[] = [
  { game: "quiz", title: "Quiz", text: "Multiple choice in four modes – classic, practice, timed and endless." },
  { game: "flags", title: "Flags", text: "Match flags and countries, region by region, with hints when you're stuck." },
  { game: "capitals", title: "Capitals", text: "Name the capital – or the country behind it – from memory." },
  { game: "recall", title: "Recall", text: "How many countries of Africa can you name? Type every one you know." },
  { game: "elimination", title: "Elimination", text: "Four chains of clues – name places that fit them all until one is left." },
  { game: "explorer", title: "Explorer", text: "Browse every country: flags, capitals, languages and neighbours." },
];

export function Onboarding() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const nav = useNavigate();
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setMessage("");
    const name = String(new FormData(e.currentTarget).get("username") ?? "");
    try {
      await completeOnboarding(name);
      nav("/home", { replace: true });
    } catch (err) {
      setMessage((err as Error).message);
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
  const location = useLocation();
  const navigate = useNavigate();
  // Email link (sign-up confirmation, password reset, email change) from either app: read once on arrival.
  const [callback] = useState(() => readAuthCallback(location.search, location.hash));
  const fromEmailLink = useRef(Boolean(callback));
  const requested = params.get("mode") as AuthAction | null;
  const [action, setAction] = useState<AuthAction>(
    params.has("recovery") ? "change" : requested && authActions.includes(requested) ? requested : "choice",
  );
  const [checkingSession, setCheckingSession] = useState(Boolean(supabase));
  const [activeSession, setActiveSession] = useState(false);
  const [message, setMessage] = useState(
    params.get("reason") === "account_deleted"
      ? "This account is no longer available. Sign in with another account or create a new one."
      : "",
  );
  const [pending, setPending] = useState(false);
  const [callbackDone, setCallbackDone] = useState(!callback);
  useEffect(() => {
    if (!callback) return;
    let active = true;
    const fail = (text: string) => {
      fromEmailLink.current = false;
      setMessage(text);
      setAction(callback.kind === "recovery" ? "reset" : "signin");
    };
    completeAuthCallback(callback)
      .then(({ session }) => {
        if (!active) return;
        if (!session) fail(callback.kind === "recovery" ? RECOVERY_EXPIRED : EMAIL_CONFIRMED);
      })
      .catch((e) => {
        if (active) fail((e as Error).message);
      })
      .finally(() => {
        consumeAuthCallback();
        if (active) setCallbackDone(true);
      });
    return () => {
      active = false;
    };
    // Runs once per arrival from an email link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!supabase || !callbackDone) return;
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        const keepFlow = keepsAuthFlow(action, params.has("recovery"));
        const hasSession = Boolean(data.session);
        setActiveSession(hasSession && !keepFlow);
        setCheckingSession(false);
        if (hasSession && !keepFlow) {
          navigate("/home", { replace: true });
          // Opened from an email link: now the normal view-mode rules apply (e.g. continue in the phone app).
          if (fromEmailLink.current) continueInPreferredApp("desktop");
        }
      })
      .catch(() => {
        if (active) setCheckingSession(false);
      });
    return () => {
      active = false;
    };
  }, [action, navigate, params, callbackDone]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setMessage("");
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const username = String(form.get("username") ?? "").trim();
    try {
      const outcome = await performAuthAction(action, { email, password, username });
      if (outcome.message) setMessage(outcome.message);
      if (outcome.next) {
        const afterRecovery = action === "change" && fromEmailLink.current;
        navigate(outcome.next === "home" ? "/home" : "/onboarding", { replace: outcome.replace || afterRecovery });
        if (afterRecovery) continueInPreferredApp("desktop");
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  if (checkingSession || activeSession) return <Loading />;
  const choose = (next: AuthAction) => {
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
              <Icon name="zap" size={20} />
            </span>
            <span>
              <strong>Play as guest</strong>
              <small>Start right away, no sign-up needed</small>
            </span>
            <span className="action-arrow" aria-hidden="true">
              →
            </span>
          </button>
          {!isDemo && (
            <>
              <button className="secondary action-card" onClick={() => choose("signin")}>
                <span className="action-icon" aria-hidden="true">
                  <Icon name="lock" size={20} />
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
                  <Icon name="sparkles" size={20} />
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
          ? "NEW ACCOUNT"
          : action === "signin"
            ? "WELCOME BACK"
            : action === "guest"
              ? "GUEST ACCESS"
              : "SAVE YOUR PROGRESS"}
      </p>
      <h1 tabIndex={-1} className="heading mt-2">
        {action === "guest"
          ? "Your adventure awaits."
          : action === "signup"
            ? "Create an account."
            : action === "signin"
              ? "Good to see you."
              : action === "reset"
                ? "Reset password."
                : action === "change"
                  ? "Set a new password."
                  : "Keep everything you've discovered."}
      </h1>
      {isDemo ? (
        action === "guest" ? (
          <form className="mt-5" onSubmit={submit}>
            <button className="primary w-full" disabled={pending}>
              {pending ? "Getting ready…" : "Continue as guest"}
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
  const state = useLandingState();
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
export function Protected({ children }: { children: JSX.Element }) {
  const location = useLocation(),
    navigate = useNavigate();
  const state = useSessionGate(location.pathname, "/onboarding");
  useEffect(() => {
    if (state === "out")
      navigate(isDemo ? "/" : "/auth?mode=signin&next=" + encodeURIComponent(location.pathname), { replace: true });
    if (state === "deleted") navigate("/auth?mode=signin&reason=account_deleted", { replace: true });
  }, [state, location.pathname, navigate]);
  useEffect(() => {
    if (state === "onboarding") navigate("/onboarding", { replace: true });
  }, [state, navigate]);
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

export function GuestSessionRecovery({ retry }: { retry: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function restore() {
    setPending(true);
    setError("");
    try {
      await api.guest();
      retry();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="mt-3">
      <p className="muted">
        Your existing guest session is restored when available. A new guest is created only if this browser has no
        session.
      </p>
      <button className="secondary mt-3" disabled={pending} onClick={restore}>
        {pending ? "Restoring…" : "Continue as guest"}
      </button>
      <ErrorBox message={error} />
    </div>
  );
}
