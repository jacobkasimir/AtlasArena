// Phone-sized welcome, sign-in and onboarding screens. All decisions come from the shared src/auth-flow.ts
// (the same functions the desktop src/Auth.tsx uses); only the layout is phone-specific.
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { isDemo } from "@shared/api";
import {
  AuthAction,
  authActions,
  completeAuthCallback,
  completeOnboarding,
  consumeAuthCallback,
  continueInPreferredApp,
  EMAIL_CONFIRMED,
  hasActiveSession,
  keepsAuthFlow,
  performAuthAction,
  readAuthCallback,
  RECOVERY_EXPIRED,
  useLandingState,
} from "@shared/auth-flow";
import { Icon } from "@shared/icons";
import { setViewMode } from "@shared/view-mode";
import { ActionBar, Button, LinkButton, LoadingState, StatusMessage, TextField } from "@phone/ui";
import { DESKTOP_URL, paths } from "./paths";

function AuthFrame({ children }: { children: ReactNode }) {
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    heading.current?.querySelector<HTMLElement>("h1")?.focus();
  }, []);
  return (
    <main className="ph-auth" ref={heading}>
      {children}
    </main>
  );
}

const welcomeFlags = ["jp", "br", "ca", "ke", "no", "in", "mx", "za", "kr", "it", "ar", "ch"];

/** Landing screen for visitors without a session. Signed-in players go straight to Home. */
export function Welcome() {
  const navigate = useNavigate();
  const state = useLandingState();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (state === "guest" || state === "account") navigate(paths.home, { replace: true });
  }, [state, navigate]);

  async function playAsGuest() {
    setPending(true);
    setError("");
    try {
      await performAuthAction("guest", { email: "", password: "", username: "" });
      navigate(paths.onboarding, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (state === "loading" || state === "guest" || state === "account") return <LoadingState />;
  return (
    <AuthFrame>
      <p className="ph-section-title">Atlas Arena</p>
      <h1 tabIndex={-1}>
        Stay curious.
        <br />
        <span className="text-mint">Play the world.</span>
      </h1>
      <div className="ph-flag-strip" aria-hidden="true">
        {welcomeFlags.map((code) => (
          <img key={code} src={`/flags/${code}.svg`} alt="" />
        ))}
      </div>
      <p className="ph-muted">
        Quiz, flags, capitals, recall and elimination – made for your phone. Start as a guest, no account needed.
      </p>
      {state === "error" && (
        <StatusMessage tone="error" retry={() => window.location.reload()}>
          Your session could not be restored. Check your connection and try again.
        </StatusMessage>
      )}
      <StatusMessage tone="error">{error}</StatusMessage>
      <div className="ph-stack mt-auto">
        <Button variant="primary" size="lg" block loading={pending} onClick={playAsGuest} icon={<Icon name="zap" />}>
          {pending ? "Preparing…" : "Play as guest"}
        </Button>
        {!isDemo && (
          <>
            <LinkButton to={`${paths.signIn}?mode=signin`} block icon={<Icon name="lock" />}>
              Sign in
            </LinkButton>
            <LinkButton to={`${paths.signIn}?mode=signup`} variant="ghost" block icon={<Icon name="sparkles" />}>
              Create account
            </LinkButton>
          </>
        )}
        {isDemo && <p className="ph-muted text-sm">Accounts are not available in the local demo.</p>}
        <a className="ph-btn ph-btn-ghost ph-btn-block" href={DESKTOP_URL} onClick={() => setViewMode("desktop")}>
          Open the desktop version
        </a>
      </div>
    </AuthFrame>
  );
}

const headings: Record<AuthAction, string> = {
  choice: "Sign in",
  signin: "Good to see you.",
  signup: "Create an account.",
  guest: "Play as guest.",
  reset: "Reset password.",
  change: "Set a new password.",
  link: "Keep your progress.",
};

const submitLabels: Record<AuthAction, string> = {
  choice: "Sign in",
  signin: "Sign in",
  signup: "Create account",
  guest: "Continue as guest",
  reset: "Send reset link",
  change: "Save password",
  link: "Save progress",
};

/**
 * /sign-in?mode=signin|signup|guest|reset|change|link
 * Also the landing page of email links sent from the phone app: /sign-in?auth=callback (sign-up or email
 * confirmation) and /sign-in?recovery=1 (password reset → new-password form).
 */
export function SignIn() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  // Read once on arrival: the email link's tokens are handled by the effect below.
  const [callback] = useState(() => readAuthCallback(location.search, location.hash));
  const fromRecoveryLink = useRef(callback?.kind === "recovery");
  const requested = params.get("mode") as AuthAction | null;
  const action: AuthAction = params.has("recovery")
    ? "change"
    : requested && authActions.includes(requested) && requested !== "choice"
      ? requested
      : "signin";
  const [checking, setChecking] = useState(!isDemo);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(
    params.get("reason") === "account_deleted"
      ? "This account is no longer available. Sign in with another account or create a new one."
      : "",
  );
  const [failed, setFailed] = useState(false);

  const [callbackDone, setCallbackDone] = useState(!callback);

  // Email link: finish the sign-in first (shared completeAuthCallback), then continue like the desktop does.
  useEffect(() => {
    if (!callback) return;
    let live = true;
    completeAuthCallback(callback)
      .then(({ session }) => {
        if (!live) return;
        consumeAuthCallback();
        if (callback.kind === "recovery") {
          if (session) setParams({ recovery: "1" }, { replace: true });
          else {
            fromRecoveryLink.current = false;
            setFailed(true);
            setMessage(RECOVERY_EXPIRED);
            setParams({ mode: "reset" }, { replace: true });
          }
        } else if (session) {
          // Signed in by the link: the gate claims the username or sends a new player to onboarding.
          navigate(paths.home, { replace: true });
          continueInPreferredApp("phone");
          return;
        } else {
          setMessage(EMAIL_CONFIRMED);
          setParams({ mode: "signin" }, { replace: true });
        }
        setCallbackDone(true);
      })
      .catch((e) => {
        if (!live) return;
        consumeAuthCallback();
        fromRecoveryLink.current = false;
        setFailed(true);
        setMessage((e as Error).message);
        setParams({ mode: callback.kind === "recovery" ? "reset" : "signin" }, { replace: true });
        setCallbackDone(true);
      });
    return () => {
      live = false;
    };
    // Runs once per arrival from an email link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!callbackDone) return;
    let live = true;
    hasActiveSession()
      .then((active) => {
        if (!live) return;
        if (active && !keepsAuthFlow(action, params.has("recovery"))) navigate(paths.home, { replace: true });
        else setChecking(false);
      })
      .catch(() => live && setChecking(false));
    return () => {
      live = false;
    };
  }, [action, navigate, params, callbackDone]);

  function choose(next: AuthAction) {
    setMessage("");
    setFailed(false);
    setParams({ mode: next }, { replace: true });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setFailed(false);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (action === "change" && password !== String(form.get("confirm") ?? "")) {
      setFailed(true);
      setMessage("The passwords do not match.");
      setPending(false);
      return;
    }
    try {
      const outcome = await performAuthAction(
        action,
        {
          email: String(form.get("email") ?? ""),
          password,
          username: String(form.get("username") ?? "").trim(),
        },
        { app: "phone" },
      );
      if (outcome.message) setMessage(outcome.message);
      if (outcome.next) {
        const afterRecovery = action === "change" && fromRecoveryLink.current;
        // A new password from a reset link is a fresh start: replace the link in the history.
        navigate(outcome.next === "home" ? paths.home : paths.onboarding, {
          replace: outcome.replace || afterRecovery,
        });
        if (afterRecovery) continueInPreferredApp("phone");
      }
    } catch (e) {
      setFailed(true);
      setMessage((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (!callbackDone) return <LoadingState label="Checking your email link…" />;
  if (checking) return <LoadingState />;
  const accountsOff = isDemo && action !== "guest";
  return (
    <AuthFrame>
      <Link to={paths.welcome} className="ph-btn ph-btn-ghost self-start" style={{ paddingInline: ".5rem" }}>
        <Icon name="chevronLeft" /> Back
      </Link>
      <h1 tabIndex={-1}>{headings[action]}</h1>
      {action === "change" && fromRecoveryLink.current && (
        <p className="ph-muted">Choose a new password for your account. You stay signed in on this device.</p>
      )}
      {accountsOff ? (
        <p className="ph-muted">Account features are not available in the local demo.</p>
      ) : (
        <form className="ph-stack" onSubmit={submit}>
          {action === "signup" && (
            <TextField
              label="Username"
              name="username"
              required
              minLength={2}
              maxLength={24}
              pattern="[A-Za-z0-9 _\-]+"
              autoComplete="nickname"
              autoCapitalize="none"
              hint="2–24 characters · letters, numbers, spaces, _ or -"
            />
          )}
          {action !== "change" && action !== "guest" && (
            <TextField
              label="Email"
              type="email"
              name="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          )}
          {action !== "reset" && action !== "guest" && (
            <TextField
              label="Password"
              type="password"
              name="password"
              minLength={action === "signin" ? undefined : 12}
              autoComplete={action === "signin" ? "current-password" : "new-password"}
              hint={action === "signin" ? undefined : "At least 12 characters."}
              required
            />
          )}
          {action === "change" && (
            <TextField
              label="Repeat new password"
              type="password"
              name="confirm"
              minLength={12}
              autoComplete="new-password"
              required
            />
          )}
          <StatusMessage tone={failed ? "error" : "info"}>{message}</StatusMessage>
          <ActionBar>
            <Button type="submit" variant="primary" size="lg" loading={pending}>
              {pending ? "Please wait…" : submitLabels[action]}
            </Button>
          </ActionBar>
        </form>
      )}
      {!isDemo && (
        <div className="ph-stack">
          {action === "signin" && (
            <>
              <Button variant="ghost" onClick={() => choose("reset")}>
                Forgot password?
              </Button>
              <Button variant="ghost" onClick={() => choose("signup")}>
                No account yet? Create one
              </Button>
            </>
          )}
          {action === "signup" && (
            <Button variant="ghost" onClick={() => choose("signin")}>
              Already have an account? Sign in
            </Button>
          )}
        </div>
      )}
    </AuthFrame>
  );
}

/** First visit: choose the explorer name (shared completeOnboarding). */
export function Onboarding() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      await completeOnboarding(String(new FormData(event.currentTarget).get("username") ?? ""));
      navigate(paths.home, { replace: true });
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <AuthFrame>
      <p className="ph-section-title">One last step</p>
      <h1 tabIndex={-1}>Choose your explorer name</h1>
      <p className="ph-muted">Your name is unique across all players and can be changed later.</p>
      <form className="ph-stack" onSubmit={save}>
        <TextField
          label="Username"
          name="username"
          minLength={2}
          maxLength={24}
          pattern="[A-Za-z0-9 _\-]+"
          required
          autoComplete="nickname"
          autoCapitalize="none"
          enterKeyHint="done"
          hint="2–24 characters · letters, numbers, spaces, _ or -"
        />
        <StatusMessage tone="error">{message}</StatusMessage>
        <ActionBar>
          <Button type="submit" variant="primary" size="lg" loading={pending}>
            {pending ? "Saving your name…" : "Continue"}
          </Button>
        </ActionBar>
      </form>
    </AuthFrame>
  );
}
