import { FormEvent, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api, configurationError, isDemo, supabase } from "./api";
import {
  avatarLabels,
  avatars,
  categories,
  countryFlagAvatarCount,
  difficulties,
  level,
  Mode,
  modes,
  Difficulty,
  ResultView,
  View,
  challengeSetupUrl,
  setsNewPersonalBest,
  validUsername,
} from "./domain";
import { ErrorBox, Feedback, Loading, OfflineBanner, download, useLoad } from "./components";
import { analyticsEnabled, readEvents, setAnalytics, track } from "./analytics";
import { accuracy, modeDescriptions, modeIcons, modeNames } from "./quiz-meta";
import { AUTO_CONTINUE_MS, Prefs, clearSavedSetups, haptic, isIOS, loadSetup, oneOf, saveSetup, setPref, usePrefs } from "./prefs";
import { AutoContinueBar, Chips, ModePage, OptionCards, ResumeList, SetupForm, SideCard, StartBar, Step, StreakBadge } from "./setup-ui";

const Admin = lazy(() => import("./Admin"));
const Explorer = lazy(() => import("./Explorer"));
const Flags = lazy(() => import("./Flags"));
const Capitals = lazy(() => import("./Capitals"));
const Recall = lazy(() => import("./Recall"));
const Hub = lazy(() => import("./Hub"));

function applyTheme(theme: string) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  const prefersLight =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches;
  if (meta)
    meta.setAttribute("content", theme === "light" || (theme === "system" && prefersLight) ? "#f5f8ff" : "#0B1020");
}

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [playerWindow, setPlayerWindow] = useState(false);
  const [playerSection, setPlayerSection] = useState<"statistics" | "profile" | "appearance">("statistics");
  const [confirmAccountAction, setConfirmAccountAction] = useState(false);
  const [menuMessage, setMenuMessage] = useState("");
  const [identity, setIdentity] = useState<{
    username: string;
    avatar: number;
    isAnonymous: boolean;
    isAdmin: boolean;
    userId: string;
  } | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    if (isDemo) {
      if (localStorage.getItem("atlas-demo-signed-out") === "yes") {
        setIdentity(null);
        return;
      }
      setIdentity((current) => current ?? { username: "Explorer", avatar: 0, isAnonymous: true, isAdmin: false, userId: "demo" });
      api
        .dashboard()
        .then((d) => {
          if (live) setIdentity({ username: d.profile.username, avatar: d.profile.avatar, isAnonymous: true, isAdmin: false, userId: "demo" });
        })
        .catch(() => {});
      return () => {
        live = false;
      };
    }
    supabase?.auth.getSession().then(({ data }) => {
      if (live && data.session?.user) {
        const user = data.session.user;
        const m = user.user_metadata ?? {};
        const isAnonymous = Boolean(user.is_anonymous);
        const isAdmin = Boolean(identity?.userId === user.id && identity.isAdmin);
        setIdentity({
          username: String(m.username ?? m.requested_username ?? "Explorer"),
          avatar: Number(m.avatar ?? 0),
          isAnonymous,
          isAdmin,
          userId: user.id,
        });
        api
          .dashboard()
          .then((d) => {
            if (live)
              setIdentity({
                username: d.profile.username,
                avatar: d.profile.avatar,
                isAnonymous,
                isAdmin: Boolean(d.profile.admin),
                userId: user.id,
              });
          })
          .catch(() => {});
      }
    });
    return () => {
      live = false;
    };
  }, [location.pathname]);
  function cancelAccountChange() {
    setConfirmAccountAction(false);
    setPlayerWindow(false);
    menuButtonRef.current?.focus();
  }
  async function confirmAccountChange() {
    if (!identity) return;
    if (identity.isAnonymous) {
      setPlayerWindow(false);
      navigate("/auth?mode=link");
      return;
    }
    try {
      await api.signOut();
      localStorage.removeItem("atlas-view-cache");
      setIdentity(null);
      setPlayerWindow(false);
      setConfirmAccountAction(false);
      navigate("/", { replace: true });
    } catch (e) {
      setMenuMessage((e as Error).message || "Sign out failed. Your session is still active.");
      setConfirmAccountAction(false);
    }
  }
  useEffect(() => {
    const title = document.querySelector("main h1") as HTMLElement | null;
    title?.focus({ preventScroll: true });
  }, [location.pathname]);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => {
      if (!localStorage.getItem("atlas-theme")) {
        const meta = document.querySelector('meta[name="theme-color"]');
        meta?.setAttribute("content", media.matches ? "#f5f8ff" : "#0B1020");
      }
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const updateProfileIdentity = (username: string, avatar: number) =>
    setIdentity((current) => (current ? { ...current, username, avatar } : current));
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="app-header border-b border-line/15">
        <div className="shell flex flex-wrap items-center justify-between gap-3 py-4">
          <Link to="/home" className="brand-link" aria-label="Atlas Arena – Home">
            <img className="brand-mark logo-light" src="/icons/light-transparent.png" alt="" />
            <img className="brand-mark logo-dark" src="/icons/dark.png" alt="" />
            <img className="brand-wordmark wordmark-light" src="/icons/text_light-transparent.png" alt="" />
            <img className="brand-wordmark wordmark-dark" src="/icons/text_dark.png" alt="" />
          </Link>
          <nav aria-label="Primary" className="topbar-nav flex flex-wrap gap-1 items-center">
            {identity && (
              <>
                <NavLink to="/home">Home</NavLink>
                <NavLink to="/quiz">Quiz</NavLink>
                <NavLink to="/flags">Flags</NavLink>
                <NavLink to="/capitals">Capitals</NavLink>
                <NavLink to="/recall">Recall</NavLink>
                <NavLink to="/explorer">Explorer</NavLink>
                {identity.isAdmin && (
                  <NavLink className="admin-nav-link" to="/admin" aria-label="Admin area">
                    Admin
                  </NavLink>
                )}
                <NavLink
                  className="topbar-icon"
                  to="/profile"
                  aria-label="Your Atlas — personal explorer and statistics"
                  title="Your Atlas · Personal explorer"
                >
                  <ChartIcon />
                </NavLink>
                <NavLink className="topbar-icon" to="/settings" aria-label="Settings" title="Settings">
                  <SettingsIcon />
                </NavLink>
                <div className="player-controls">
                  <button
                    ref={menuButtonRef}
                    className="user-menu-button"
                    aria-label={`Open player panel for ${identity.username}`}
                    aria-expanded={playerWindow}
                    aria-haspopup="dialog"
                    onClick={() => {
                      setConfirmAccountAction(false);
                      setMenuMessage("");
                      setPlayerWindow(true);
                    }}
                  >
                    <span className="player-avatar" aria-hidden="true">
                      {avatars[identity.avatar] ?? avatars[0]}
                    </span>
                    <span className="user-name">{identity.username}</span>
                  </button>
                  {!isDemo && (
                    <button
                      className="account-action-icon"
                      type="button"
                      aria-label={identity.isAnonymous ? "Sign in or link an account" : "Sign out"}
                      title={identity.isAnonymous ? "Sign in or link an account" : "Sign out"}
                      onClick={() => {
                        setPlayerSection("profile");
                        setMenuMessage("");
                        setConfirmAccountAction(true);
                        setPlayerWindow(true);
                      }}
                    >
                      {identity.isAnonymous ? <SignInIcon /> : <SignOutIcon />}
                    </button>
                  )}
                </div>
              </>
            )}
          </nav>
        </div>
      </header>
      {identity && playerWindow && (
        <PlayerWindow
          identity={identity}
          section={playerSection}
          setSection={setPlayerSection}
          confirming={confirmAccountAction}
          setConfirming={setConfirmAccountAction}
          message={menuMessage}
          onProfileUpdated={updateProfileIdentity}
          onClose={() => {
            setPlayerWindow(false);
            setConfirmAccountAction(false);
            menuButtonRef.current?.focus();
          }}
          onCancelConfirm={cancelAccountChange}
          onConfirm={confirmAccountChange}
        />
      )}
      {isDemo && (
        <div className="demo-banner">
          LOCAL DEMO · Progress stays in this browser · Public, unverified sample questions
        </div>
      )}
      <OfflineBanner />
      <main id="main" className="shell py-8 md:py-12">
        <Suspense fallback={<Loading />}>
          <Outlet context={{ onProfileUpdated: updateProfileIdentity }} />
        </Suspense>
      </main>
      <footer className="shell py-8 text-sm muted border-t border-line/15">
        Built for curious minds. No ads. No public chat.
        <span className="block mt-2">Maps and multiplayer are planned, not playable features.</span>
      </footer>
    </>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 19V5m0 14h16M8 16v-5m4 5V7m4 9v-7m4 7V4" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
      <path
        d="m19.4 15 .1.1 1.2.9-1.4 2.4-1.4-.6a8 8 0 0 1-1.5.9l-.2 1.5h-2.8l-.2-1.5a8 8 0 0 1-1.5-.9l-1.4.6-1.4-2.4 1.2-.9a7 7 0 0 1 0-1.8l-1.2-.9 1.4-2.4 1.4.6a8 8 0 0 1 1.5-.9l.2-1.5h2.8l.2 1.5a8 8 0 0 1 1.5.9l1.4-.6 1.4 2.4-1.2.9a7 7 0 0 1 0 1.8Z"
        transform="translate(-1 -1)"
      />
    </svg>
  );
}
function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 5H5v14h5M14 8l4 4-4 4m4-4H9" />
    </svg>
  );
}
function SignInIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 5h5v14h-5M10 8l-4 4 4 4m-4-4h10" />
    </svg>
  );
}

type PlayerIdentity = { username: string; avatar: number; isAnonymous: boolean; isAdmin: boolean; userId: string };
function AvatarPicker({ value }: { value: number }) {
  const initial = Number.isInteger(value) && value >= 0 && value < avatars.length ? value : 0;
  const [selected, setSelected] = useState(initial);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  function choose(index: number) {
    setSelected(index);
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }
  return (
    <div className="avatar-picker">
      <input type="hidden" name="avatar" value={selected} />
      <button
        ref={triggerRef}
        type="button"
        className="avatar-picker-trigger"
        aria-expanded={open}
        aria-controls="avatar-picker-options"
        aria-label={`Choose avatar. Current selection: ${avatarLabels[selected]}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar-picker-trigger-emoji" aria-hidden="true">
          {avatars[selected]}
        </span>
        <span className="avatar-picker-trigger-copy">
          <small>Selected avatar</small>
          <strong>{avatarLabels[selected]}</strong>
        </span>
        <span className="avatar-picker-trigger-count">{avatars.length} options</span>
        <span className={`avatar-picker-chevron ${open ? "is-open" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="avatar-picker-panel">
          <p className="avatar-picker-panel-label">
            Choose an avatar <span>{countryFlagAvatarCount} country flags</span>
          </p>
          <div
            className="avatar-picker-grid"
            id="avatar-picker-options"
            role="radiogroup"
            aria-label="Choose an avatar"
          >
            {avatars.map((avatar, index) => (
              <label key={index} className="player-avatar-choice" title={avatarLabels[index]}>
                <input
                  type="radio"
                  name="avatar-picker-choice"
                  value={index}
                  checked={selected === index}
                  onChange={() => choose(index)}
                  aria-label={avatarLabels[index]}
                />
                <span aria-hidden="true">{avatar}</span>
                <span className="sr-only">{avatarLabels[index]}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
function PlayerWindow({
  identity,
  section,
  setSection,
  confirming,
  setConfirming,
  message,
  onProfileUpdated,
  onClose,
  onCancelConfirm,
  onConfirm,
}: {
  identity: PlayerIdentity;
  section: "statistics" | "profile" | "appearance";
  setSection: (section: "statistics" | "profile" | "appearance") => void;
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  message: string;
  onProfileUpdated: (username: string, avatar: number) => void;
  onClose: () => void;
  onCancelConfirm: () => void;
  onConfirm: () => void;
}) {
  const { data, error, reload } = useLoad(() => api.dashboard());
  const dialogRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  async function savePlayerProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileSaving(true);
    setProfileMessage("");
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") ?? "");
    const avatar = Number(form.get("avatar") ?? 0);
    try {
      await api.saveProfile({ username, avatar, favorites: form.getAll("favorites").map(String) });
      onProfileUpdated(username, avatar);
      setProfileMessage("Profile saved.");
      reload();
    } catch (e) {
      setProfileMessage(authMessage((e as Error).message));
    } finally {
      setProfileSaving(false);
    }
  }
  useEffect(() => {
    (confirming
      ? document.querySelector<HTMLElement>(".account-confirm-dialog")
      : dialogRef.current?.querySelector<HTMLElement>(".player-window-close")
    )?.focus();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (confirming) onCancelConfirm();
        else onClose();
        return;
      }
      if (e.key === "Tab") {
        const scope = confirming ? document.querySelector<HTMLElement>(".account-confirm-dialog") : dialogRef.current;
        const nodes = scope?.querySelectorAll<HTMLElement>("button:not(:disabled),a[href],select,input");
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = old;
    };
  }, [onClose, onCancelConfirm, confirming]);
  return (
    <div
      className="player-window-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !confirming) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="player-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-window-title"
        tabIndex={-1}
      >
        <header className="player-window-header">
          <div className="player-window-identity">
            <span className="player-window-avatar" aria-hidden="true">
              {avatars[identity.avatar] ?? avatars[0]}
            </span>
            <div>
              <p className="eyebrow">YOUR ATLAS</p>
              <h2 id="player-window-title">{identity.username}</h2>
            </div>
          </div>
          <button type="button" className="player-window-close" aria-label="Close player panel" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className={`player-window-layout ${collapsed ? "sidebar-collapsed" : ""}`}>
          <aside className="player-sidebar" aria-label="Player panel sections">
            <button
              className="player-sidebar-toggle"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((v) => !v)}
            >
              <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
              {!collapsed && <span>Collapse</span>}
            </button>
            {(
              [
                ["statistics", "Statistics", <ChartIcon key="stats" />],
                [
                  "profile",
                  "Profile settings",
                  <span key="profile" className="sidebar-avatar" aria-hidden="true">
                    {avatars[identity.avatar] ?? avatars[0]}
                  </span>,
                ],
                ["appearance", "Appearance", <SettingsIcon key="appearance" />],
              ] as const
            ).map(([id, label, icon]) => (
              <button
                key={id}
                className={`player-sidebar-item ${section === id ? "is-active" : ""}`}
                aria-current={section === id ? "page" : undefined}
                title={collapsed ? label : undefined}
                onClick={() => setSection(id)}
              >
                {icon}
                <span>{!collapsed && label}</span>
              </button>
            ))}
          </aside>
          <div className="player-window-content">
            {section === "statistics" ? (
              <>
                <div className="player-section-heading">
                  <p className="eyebrow">YOUR PROGRESS</p>
                  <h3>Statistics</h3>
                </div>
                {error ? (
                  <ErrorBox message={error} retry={reload} />
                ) : !data ? (
                  <Loading />
                ) : (
                  <>
                    <div className="player-stat-grid">
                      <div className="player-stat-card">
                        <span>Completed</span>
                        <strong>{data.totals.games}</strong>
                      </div>
                      <div className="player-stat-card">
                        <span>Accuracy</span>
                        <strong>{accuracy(data.totals.correct, data.totals.incorrect)}</strong>
                      </div>
                      <div className="player-stat-card">
                        <span>Experience</span>
                        <strong>{data.profile.xp.toLocaleString()} XP</strong>
                      </div>
                      <div className="player-stat-card">
                        <span>Level</span>
                        <strong>{level(data.profile.xp)}</strong>
                      </div>
                    </div>
                    <section className="player-best-scores">
                      <h4>Personal bests</h4>
                      {(["classic", "timed", "endless"] as Mode[]).map((mode) => (
                        <p key={mode}>
                          <span>{modeNames[mode]}</span>
                          <strong>{data.best[mode] ?? "—"}</strong>
                        </p>
                      ))}
                    </section>
                  </>
                )}
              </>
            ) : section === "profile" ? (
              <>
                <div className="player-section-heading">
                  <p className="eyebrow">PLAYER DETAILS</p>
                  <h3>Profile settings</h3>
                </div>
                {data ? (
                  <form className="player-profile-form" onSubmit={savePlayerProfile} key={data.profile.username}>
                    <label>
                      Username
                      <input
                        name="username"
                        required
                        minLength={2}
                        maxLength={24}
                        pattern="[A-Za-z0-9 _\\-]+"
                        defaultValue={data.profile.username}
                      />
                    </label>
                    <fieldset>
                      <legend>Choose an avatar</legend>
                      <AvatarPicker value={data.profile.avatar} />
                    </fieldset>
                    <fieldset>
                      <legend>Favorite topics</legend>
                      <div className="player-favorite-grid">
                        {categories.map((category) => (
                          <label className="player-favorite-choice" key={category}>
                            <input
                              type="checkbox"
                              name="favorites"
                              value={category}
                              defaultChecked={data.profile.favorites.includes(category)}
                            />
                            <span>{category}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <button className="primary" disabled={profileSaving}>
                      {profileSaving ? "Saving…" : "Save profile"}
                    </button>
                    <p role="status" className="player-profile-message">
                      {profileMessage}
                    </p>
                  </form>
                ) : error ? (
                  <ErrorBox message={error} retry={reload} />
                ) : (
                  <Loading />
                )}
                {!isDemo && identity.isAnonymous && (
                  <Link className="secondary" to="/auth?mode=link" onClick={onClose}>
                    Create an account to save progress
                  </Link>
                )}
                {data?.profile.admin && (
                  <Link className="secondary" to="/admin" onClick={onClose}>
                    Content administration
                  </Link>
                )}
              </>
            ) : (
              <>
                <div className="player-section-heading">
                  <p className="eyebrow">PERSONALIZE</p>
                  <h3>Appearance</h3>
                </div>
                <div className="player-appearance-card">
                  <p className="muted">Choose how Atlas Arena looks on this device.</p>
                  <ThemeControl />
                </div>
                <Link className="secondary" to="/settings" onClick={onClose}>
                  More settings <span aria-hidden="true">→</span>
                </Link>
              </>
            )}
            <div className="player-account-row">
              {!isDemo && (
                <button className="secondary player-account-button" onClick={() => setConfirming(true)}>
                  {identity.isAnonymous ? (
                    <>
                      <SignInIcon />
                      Sign in or link account
                    </>
                  ) : (
                    <>
                      <SignOutIcon />
                      Sign out
                    </>
                  )}
                </button>
              )}
              {message && (
                <p className="error" role="alert">
                  {message}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
      {confirming && (
        <div className="account-confirm-backdrop">
          <section
            className="account-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="account-confirm-title"
            aria-describedby="account-confirm-description"
          >
            <span className="account-confirm-symbol" aria-hidden="true">
              {identity.isAnonymous ? <SignInIcon /> : <SignOutIcon />}
            </span>
            <p className="eyebrow">ACCOUNT</p>
            <h2 id="account-confirm-title">
              {identity.isAnonymous ? "Continue to sign in?" : "Sign out of Atlas Arena?"}
            </h2>
            <p id="account-confirm-description" className="muted">
              {identity.isAnonymous
                ? "You can link an account to keep your guest progress when you switch devices."
                : "You will return to the sign-in screen. Your saved progress will remain on your account."}
            </p>
            {message && (
              <p className="error" role="alert">
                {message}
              </p>
            )}
            <div className="player-window-actions">
              <button className="secondary" onClick={onCancelConfirm}>
                Cancel
              </button>
              <button className="primary" onClick={onConfirm}>
                {identity.isAnonymous ? "Continue to sign in" : "Sign out"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

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

function accuracyLine(correct: number, incorrect: number) {
  const total = correct + incorrect;
  const share = total ? correct / total : 0;
  return share >= 0.8 ? "Great run!" : share >= 0.5 ? "Solid run." : total ? "Keep practising." : "Run complete.";
}

function QuizSetup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const saved = useMemo(() => loadSetup("quiz"), []);
  const [mode, setMode] = useState<Mode>(oneOf(params.get("mode") ?? saved.mode, modes, "classic"));
  const [difficulty, setDifficulty] = useState<Difficulty>(oneOf(params.get("difficulty") ?? saved.difficulty, difficulties, "easy"));
  const [category, setCategory] = useState<string>(oneOf(params.get("category") ?? saved.category, ["all", ...categories], "all"));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const { data, error: loadError, reload } = useLoad(() => api.dashboard());
  const country = params.get("country") ?? undefined;
  const countParam = Number(params.get("count"));
  const questionCount =
    Number.isInteger(countParam) && countParam >= 1 && countParam <= 10 ? countParam : country && mode === "practice" ? 4 : 10;

  useEffect(() => {
    const target = location.hash ? document.querySelector(location.hash) : null;
    target?.scrollIntoView({ block: "center" });
  }, []);

  async function start(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    saveSetup("quiz", { mode, difficulty, category });
    try {
      const s = await api.play(mode, category === "all" ? [] : [category], difficulty, country, questionCount);
      track("game_started", { mode, category, difficulty });
      navigate("/play/" + s.id);
    } catch (e) {
      setError(friendlyQuizError((e as Error).message));
    } finally {
      setPending(false);
    }
  }

  const unfinished =
    data?.sessions.filter((s) => s.status === "awaiting_answer" || s.status === "showing_feedback") ?? [];
  const roundSize =
    mode === "timed" ? { count: 60, unit: "seconds" } : mode === "endless" ? { count: 3, unit: "lives" } : { count: questionCount, unit: "questions" };
  const side = (
    <>
      <SideCard title="Unfinished games">
        <ResumeList
          empty="None – a game you leave is kept here until you finish it."
          items={unfinished.map((s) => ({
            id: s.id,
            title: modeNames[s.mode],
            detail: `${s.difficulty} · ${s.correct + s.incorrect} answered · ${s.score} pts`,
            to: "/play/" + s.id,
            done: s.correct + s.incorrect,
            total: s.mode === "classic" || s.mode === "practice" ? 10 : s.correct + s.incorrect,
          }))}
        />
      </SideCard>
      {data && (
        <SideCard title="Your quiz record">
          <ul className="side-list">
            <li>
              <span className="muted">Games finished</span>
              <strong>{data.totals.games}</strong>
            </li>
            <li>
              <span className="muted">Accuracy</span>
              <strong>{accuracy(data.totals.correct, data.totals.incorrect)}</strong>
            </li>
            {modes
              .filter((m) => m !== "practice")
              .map((m) => (
                <li key={m}>
                  <span className="muted">{modeNames[m]} best</span>
                  <strong>{data.best[m]?.toLocaleString() ?? "—"}</strong>
                </li>
              ))}
          </ul>
        </SideCard>
      )}
    </>
  );

  return (
    <ModePage
      eyebrow="Atlas Quiz"
      title="Ready for a round?"
      intro="Four ways to play and four difficulty tiers. Your record and unfinished games are on the right."
      side={side}
    >
      <SetupForm onSubmit={start}>
        <ErrorBox message={loadError} retry={reload} />
        {loadError.includes("AUTH_REQUIRED") && <GuestSessionRecovery retry={reload} />}
        <Step n={1} title="Choose a mode">
          <OptionCards
            value={mode}
            onChange={setMode}
            options={modes.map((m) => ({
              value: m,
              icon: modeIcons[m],
              title: modeNames[m],
              text: modeDescriptions[m],
              footer: m !== "practice" && data?.best[m] != null ? <span>Best: {data.best[m]!.toLocaleString()}</span> : undefined,
            }))}
          />
        </Step>
        <Step n={2} title={mode === "endless" ? "Starting difficulty" : "Difficulty"} hint={mode === "endless" ? "Endless unlocks the next tier after every five correct answers." : undefined}>
          <div id="difficulty-picker">
            <Chips
              label="Difficulty"
              value={difficulty}
              onChange={setDifficulty}
              options={difficulties.map((d) => ({ value: d, label: d[0].toUpperCase() + d.slice(1) }))}
            />
          </div>
        </Step>
        <Step n={3} title="Topic">
          <Chips
            label="Topic"
            value={category}
            onChange={setCategory}
            options={[{ value: "all", label: "Everything" }, ...categories.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))]}
          />
        </Step>
        {country && (
          <p className="muted text-sm">
            Practising one country: <strong className="text-paper">{country}</strong>.{" "}
            <Link className="text-mint underline" to="/quiz">
              Practise everything instead
            </Link>
          </p>
        )}
        <StartBar
          count={roundSize.count}
          unit={roundSize.unit}
          busy={pending}
          disabled={!!loadError}
          label="Start game"
          summary={`${modeNames[mode]} · ${difficulty} · ${category === "all" ? "all topics" : category}${mode === "practice" ? " · no XP" : ""}`}
        />
        <ErrorBox message={error} />
      </SetupForm>
    </ModePage>
  );
}

function friendlyQuizError(message: string) {
  if (/not enough|insufficient|empty|no eligible|pool/i.test(message))
    return "There aren't enough questions for that combination yet. Try another difficulty or topic.";
  return message;
}

function Stat({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="card stat-card p-4">
      <p className="muted text-xs sm:text-sm">{title}</p>
      <p className="text-xl sm:text-3xl font-black mt-2">{value}</p>
    </div>
  );
}
function GuestSessionRecovery({ retry }: { retry: () => void }) {
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

function Game() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<View>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const leaveDialogRef = useRef<HTMLElement>(null);
  const pendingRef = useRef(false);
  const offset = useRef(0);
  const [now, setNow] = useState(Date.now());
  const finalizedEvent = useRef(false);
  const prefs = usePrefs();
  const lastFeedbackKey = useRef("");

  function accept(v: View) {
    offset.current = Date.parse(v.serverNow) - Date.now();
    setView((old) => (!old || old.id !== v.id || v.version >= old.version ? v : old));
  }
  async function refresh() {
    try {
      accept(await api.view(id));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    setView(undefined);
    finalizedEvent.current = false;
    void refresh();
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!leaveDialogOpen) return;
    leaveDialogRef.current?.querySelector<HTMLElement>(".leave-run-cancel")?.focus();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLeaveDialogOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = leaveDialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)");
      if (!nodes?.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = oldOverflow;
    };
  }, [leaveDialogOpen]);

  // Timed runs pause at accepted answers while the player reads feedback.
  const remaining =
    view?.deadline && view.status !== "showing_feedback"
      ? Math.max(0, Date.parse(view.deadline) - now - offset.current)
      : null;

  useEffect(() => {
    if (view?.deadline && remaining === 0 && view.status !== "completed" && view.status !== "abandoned") {
      void refresh();
      const retry = setInterval(() => void refresh(), 2000);
      return () => clearInterval(retry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining === 0, view?.status, id]);

  useEffect(() => {
    if (view?.status === "completed") {
      if (!finalizedEvent.current) {
        finalizedEvent.current = true;
        track("game_completed", {
          mode: view.mode,
          correct: view.stats.correct,
          incorrect: view.stats.incorrect,
          responseDurationMs: Math.round(view.stats.averageMs * view.answered),
        });
      }
      navigate("/results/" + view.id, { replace: true });
    }
  }, [view, navigate]);

  async function action(kind: "answer" | "next", option?: string) {
    if (!view || pendingRef.current) return;
    if (kind === "answer" && isIOS) haptic("tap");
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const next = kind === "answer" ? await api.answer(id, view.current!.id, option!) : await api.next(id);
      accept(next);
    } catch (e) {
      setError((e as Error).message + " If the connection failed, reload state before retrying.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function deleteCurrentRun() {
    setDeletePending(true);
    setError("");
    try {
      await api.deleteRun(id);
      navigate("/home", { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletePending(false);
    }
  }

  const feedbackKey = view?.status === "showing_feedback" && view.feedback ? `${view.id}:${view.answered}` : "";
  useEffect(() => {
    if (!feedbackKey || feedbackKey === lastFeedbackKey.current || !view?.feedback) return;
    lastFeedbackKey.current = feedbackKey;
    haptic(view.feedback.correct ? "correct" : "wrong");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedbackKey]);
  const autoContinue = Boolean(feedbackKey && prefs.autoContinue && view?.feedback?.correct);
  useEffect(() => {
    if (!autoContinue) return;
    const timer = window.setTimeout(() => void action("next"), AUTO_CONTINUE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoContinue, feedbackKey]);
  useEffect(() => {
    if (view?.status === "completed") haptic("complete");
  }, [view?.status]);

  useEffect(() => {
    function keydown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable=true]") || e.altKey || e.ctrlKey || e.metaKey) return;
      if (view?.status === "showing_feedback" && (e.key === "Enter" || e.code === "Space") && !target.closest("a")) {
        e.preventDefault();
        if (!pending) void action("next");
        return;
      }
      if (e.repeat || view?.status !== "awaiting_answer" || remaining === 0) return;
      const index = Number(e.key) - 1;
      const option = view.current?.options[index];
      if (option) {
        e.preventDefault();
        void action("answer", option.id);
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  if (!view) return error ? <ErrorBox message={error} retry={refresh} /> : <Loading />;
  if (view.status === "abandoned")
    return (
      <section className="card">
        <h1 tabIndex={-1} className="heading">
          This run was abandoned.
        </h1>
        <Link className="primary mt-5" to="/home">
          Choose a new challenge
        </Link>
      </section>
    );

  const questionNumber = Math.min(view.answered + 1, view.total);
  const progressPercent = view.total ? Math.min(100, (view.answered / view.total) * 100) : 0;
  const remainingLives = Math.max(0, 3 - view.stats.incorrect);
  return (
    <div className="game-shell">
      <div className="game-topline">
        <div>
          <p className="eyebrow">
            {modeNames[view.mode]} ·{" "}
            <span className={`game-difficulty-tag ${view.current?.difficulty === "expert" ? "is-expert" : ""}`}>
              {view.current?.difficulty ?? view.difficulty}
            </span>
          </p>
          <p className="muted mt-1">
            Question {questionNumber} of {view.total}
          </p>
        </div>
        <button className="secondary" disabled={pending} onClick={() => setLeaveDialogOpen(true)}>
          Leave run
        </button>
      </div>
      <div className="game-layout mt-5">
        <div className="game-main">
          {view.current && (
            <section
              className={`card game-question map-grid ${view.status === "showing_feedback" && view.feedback?.correct ? "has-correct-answer" : ""} ${view.status === "showing_feedback" && view.feedback && !view.feedback.correct ? "has-incorrect-answer" : ""}`}
            >
              <StreakBadge streak={view.stats.streak} />
              <h1 tabIndex={-1} className="game-prompt mt-6">
                {view.current.prompt}
              </h1>
              <div className="answer-grid grid gap-3 sm:grid-cols-2 mt-7">
                {view.current.options.map((o, i) => (
                  <button
                    key={o.id}
                    className={`answer text-left ${
                      view.status === "showing_feedback" && view.feedback
                        ? o.label === view.feedback.correctAnswer
                          ? "is-correct"
                          : o.label === view.feedback.chosen && !view.feedback.correct
                            ? "is-wrong"
                            : "is-dimmed"
                        : ""
                    }`}
                    disabled={pending || view.status !== "awaiting_answer" || remaining === 0}
                    onClick={() => void action("answer", o.id)}
                  >
                    <span className="keycap" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span>{o.label}</span>
                  </button>
                ))}
              </div>
              {prefs.keyboardHints && (
                <p className="keyboard-hint muted text-sm mt-5">
                  <span className="keycap">1</span>–<span className="keycap">4</span> to answer
                </p>
              )}
            </section>
          )}
          <ErrorBox message={error} retry={refresh} />
          {view.feedback && prefs.keyboardHints && (
            <p className="game-keyboard-hint muted text-sm mt-3">
              Press <kbd>Enter</kbd> or <kbd>Space</kbd> for the next question
            </p>
          )}
          {remaining === 0 && view.status !== "completed" && (
            <p className="game-notice mt-4" role="status">
              Time is up. Confirming the final result…
            </p>
          )}
        </div>
        <aside className="game-sidebar" aria-label="Live run statistics and answer review">
          <div className="game-live-stats">
            <div>
              <span>Score</span>
              <strong>{view.stats.score.toLocaleString()}</strong>
            </div>
            <div>
              <span>Streak</span>
              <strong>{view.stats.streak}</strong>
            </div>
            <div>
              <span>{view.mode === "endless" ? "Lives" : "Progress"}</span>
              {view.mode === "endless" ? (
                <strong className="game-hearts" aria-label={`${remainingLives} of 3 lives remaining`}>
                  {[0, 1, 2].map((index) => (
                    <svg
                      key={index}
                      className={index < remainingLives ? "is-alive" : "is-lost"}
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
                    </svg>
                  ))}
                </strong>
              ) : (
                <strong>{`${view.answered}/${view.total}`}</strong>
              )}
            </div>
          </div>
          {view.total > 1 && (
            <div className="game-progress-card">
              <div className="game-progress-caption">
                <span>Run progress</span>
                <strong>{progressPercent}%</strong>
              </div>
              <div
                className="game-progress"
                role="progressbar"
                aria-label="Question progress"
                aria-valuemin={0}
                aria-valuemax={view.total}
                aria-valuenow={view.answered}
              >
                <span style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          )}
          {view.deadline &&
            (remaining !== null ? (
              <div className="game-stat timer-stat">
                <div className="timer-label-row">
                  <span>Time left</span>
                  <strong>{Math.ceil(remaining / 1000)}s</strong>
                </div>
                <div
                  className="timer-track mt-2"
                  role="progressbar"
                  aria-label="Time remaining"
                  aria-valuemin={0}
                  aria-valuemax={60}
                  aria-valuenow={Math.ceil(remaining / 1000)}
                >
                  <span style={{ width: `${Math.max(0, (remaining / 60000) * 100)}%` }} />
                </div>
              </div>
            ) : (
              <div className="game-stat timer-stat is-paused">
                <span>Challenge timer</span>
                <strong>Paused while you review</strong>
              </div>
            ))}
          {view.feedback && (
            <section className="game-review">
              <div className="game-review-heading">
                <span
                  className={`game-result-mark ${view.feedback.correct ? "is-correct" : "is-incorrect"}`}
                  aria-hidden="true"
                >
                  {view.feedback.correct ? "✓" : "×"}
                </span>
                <div>
                  <p className="eyebrow">ANSWER REVIEW</p>
                  <h2>{view.feedback.correct ? "Correct" : "Not quite"}</h2>
                </div>
                <strong className="game-review-points">
                  +{view.feedback.points} <small>pts</small>
                </strong>
              </div>
              <p className="game-correct-answer">
                <span>Correct answer</span>
                <strong>{view.feedback.correctAnswer}</strong>
              </p>
              {!view.feedback.correct && (
                <p className="game-chosen-answer">
                  <span>Your answer</span>
                  {view.feedback.chosen}
                </p>
              )}
              <p className="game-review-explanation">{view.feedback.explanation}</p>
              <a className="game-review-source" href={view.feedback.source} target="_blank" rel="noopener noreferrer">
                Source reference <span aria-hidden="true">↗</span>
              </a>
              <button
                autoFocus
                className="primary game-next-button mt-3"
                disabled={pending}
                onClick={() => void action("next")}
              >
                {pending ? "Loading…" : "Next question →"}
              </button>
              {autoContinue && !pending && <AutoContinueBar ms={AUTO_CONTINUE_MS} onSkip={() => void action("next")} />}
            </section>
          )}
          {!view.feedback && (
            <div className="game-stats-footnote">
              <span>Best streak</span>
              <strong>{view.stats.bestStreak}</strong>
            </div>
          )}
        </aside>
      </div>
      {leaveDialogOpen && (
        <div
          className="leave-run-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletePending) setLeaveDialogOpen(false);
          }}
        >
          <section
            ref={leaveDialogRef}
            className="leave-run-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-run-title"
            aria-describedby="leave-run-description"
          >
            <span className="leave-run-symbol" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3 3.5 7v5.5c0 4.2 3.6 7.3 8.5 8.5 4.9-1.2 8.5-4.3 8.5-8.5V7L12 3Z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </span>
            <p className="eyebrow">YOUR RUN · {modeNames[view.mode]}</p>
            <h2 id="leave-run-title">Leave this run?</h2>
            <p id="leave-run-description" className="muted">
              Save your progress to resume from Home later, or delete this run and its progress.
            </p>
            {view.deadline && (
              <p className="leave-run-timer-note">This timed challenge keeps running while you are away.</p>
            )}
            {error && <ErrorBox message={error} />}
            <div className="leave-run-actions">
              <button
                type="button"
                className="secondary leave-run-cancel"
                disabled={deletePending}
                onClick={() => setLeaveDialogOpen(false)}
              >
                Continue playing
              </button>
              <button
                type="button"
                className="primary leave-run-save"
                disabled={deletePending}
                onClick={() => navigate("/home")}
              >
                Save for later <span aria-hidden="true">↗</span>
              </button>
              <button
                type="button"
                className="leave-run-delete"
                disabled={deletePending}
                onClick={() => void deleteCurrentRun()}
              >
                {deletePending ? (
                  <>
                    <span className="loading-indicator" aria-hidden="true" />
                    Deleting…
                  </>
                ) : (
                  <>
                    Delete run <span aria-hidden="true">⌫</span>
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Results() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: v, error, reload } = useLoad(() => api.result(id), id);
  const [replayPending, setReplayPending] = useState(false);
  const [replayError, setReplayError] = useState("");
  if (!v) return error ? <ErrorBox message={error} retry={reload} /> : <Loading />;
  if (v.status !== "completed")
    return (
      <section className="card">
        <h1 tabIndex={-1} className="heading">
          This run has not completed.
        </h1>
        <Link className="primary mt-4" to={"/play/" + id}>
          Resume run
        </Link>
      </section>
    );
  const result = v;
  const newBest = setsNewPersonalBest(result.mode, result.stats.score, result.previousBest);
  const setupUrl = challengeSetupUrl(result);
  async function playAgain() {
    if (!result.contextSaved) {
      navigate(setupUrl);
      return;
    }
    setReplayPending(true);
    setReplayError("");
    try {
      const next = await api.play(
        result.mode,
        result.categories ?? [],
        result.difficulty,
        result.country ?? undefined,
        result.questionCount ?? 10,
      );
      navigate(`/play/${next.id}`);
    } catch (e) {
      setReplayError((e as Error).message);
    } finally {
      setReplayPending(false);
    }
  }
  return (
    <div className="results-shell">
      <section className={`results-hero map-grid ${newBest ? "has-new-best" : ""}`}>
        <div className="results-hero-copy">
          <p className="eyebrow">ADVENTURE COMPLETE · {modeNames[v.mode]}</p>
          <h1 tabIndex={-1} className="heading mt-3">
            {v.stats.incorrect === 0 && v.stats.correct > 0 ? "Flawless!" : accuracyLine(v.stats.correct, v.stats.incorrect)}
          </h1>
          <p className="muted mt-3">
            {v.stats.correct} correct · {v.stats.incorrect} wrong · best streak {v.stats.bestStreak}
          </p>
          {newBest && (
            <div className="new-best-badge" role="status">
              <span className="new-best-icon" aria-hidden="true">
                ✦
              </span>
              <span>
                <strong>New personal best</strong>
                <small>
                  {v.previousBest === null
                    ? "Your first completed score in this mode."
                    : `Previous best: ${v.previousBest.toLocaleString()} points`}
                </small>
              </span>
            </div>
          )}
        </div>
        <div className="results-selection" aria-label="Completed challenge settings">
          <span className="results-selection-label">Your selection</span>
          <strong>
            {modeNames[v.mode]} <i aria-hidden="true">·</i> {v.difficulty}
          </strong>
          <span>
            {v.contextSaved
              ? v.categories?.length
                ? v.categories.join(", ")
                : "All categories"
              : "Original filters unavailable"}
            {v.country ? ` · ${v.country}` : ""}
          </span>
        </div>
      </section>
      <div className="results-actions">
        <button className="primary results-play-again" disabled={replayPending} onClick={() => void playAgain()}>
          {replayPending ? (
            <>
              <span className="loading-indicator" aria-hidden="true" />
              Starting a new run…
            </>
          ) : (
            <>
              Play again <span aria-hidden="true">→</span>
            </>
          )}
        </button>
        <Link className="secondary" to={`${setupUrl}#difficulty-picker`}>
          Change difficulty
        </Link>
        <Link className="secondary" to="/home">
          Other games
        </Link>
      </div>
      {!v.contextSaved && (
        <p className="results-context-notice" role="status">
          This run predates saved filter settings. Choose its category and country again in the setup screen before
          starting.
        </p>
      )}
      <ErrorBox message={replayError} />
      <div className="results-metrics grid grid-cols-2 md:grid-cols-4 gap-3 my-6">
        <Stat title="Final score" value={v.stats.score} />
        <Stat title="Accuracy" value={accuracy(v.stats.correct, v.stats.incorrect)} />
        <Stat title="XP earned" value={v.stats.xp} />
        <Stat title="Correct answers" value={v.stats.correct} />
        <Stat title="Incorrect answers" value={v.stats.incorrect} />
        <Stat title="Average response" value={v.answered ? `${(v.stats.averageMs / 1000).toFixed(1)}s` : "—"} />
        <Stat title="Best streak" value={v.stats.bestStreak} />
      </div>
      {v.mode === "practice" && <p className="muted text-sm">Practice games don't earn XP.</p>}
      <div className="section-heading mt-9 mb-4">
        <h2 className="text-2xl font-bold">Your answer review</h2>
        <span className="muted text-sm">
          {v.reviews.length} {v.reviews.length === 1 ? "answer" : "answers"}
        </span>
      </div>
      {!v.reviews.length && (
        <div className="empty-state">
          <p className="font-semibold">No answers were accepted in this run.</p>
        </div>
      )}
      <div className="grid gap-4">
        {[...v.reviews]
          .map((review, index) => ({ review, index }))
          .sort((a, b) => Number(a.review.correct) - Number(b.review.correct) || a.index - b.index)
          .map(({ review, index }) => (
            <article
              className={`results-review-item ${review.correct ? "is-correct" : "is-incorrect"}`}
              key={review.questionId}
            >
              <div className="results-review-title">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{review.prompt}</h3>
                <strong className={`results-review-status ${review.correct ? "is-correct" : "is-incorrect"}`}>
                  {review.correct ? "Correct" : "Mistake"}
                </strong>
              </div>
              <Feedback review={review} />
            </article>
          ))}
      </div>
    </div>
  );
}

function ProfilePage() {
  const { onProfileUpdated } = useOutletContext<{ onProfileUpdated: (username: string, avatar: number) => void }>();
  const [offset, setOffset] = useState(0);
  const { data, error, reload } = useLoad(() => api.dashboard(offset), offset);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  if (!data)
    return error ? (
      <>
        <ErrorBox message={error} retry={reload} />
        {error.includes("AUTH_REQUIRED") && <GuestSessionRecovery retry={reload} />}
      </>
    ) : (
      <Loading />
    );
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    const form = new FormData(e.currentTarget);
    try {
      const username = String(form.get("username"));
      const avatar = Number(form.get("avatar"));
      await api.saveProfile({
        username,
        avatar,
        favorites: form.getAll("favorites").map(String),
      });
      onProfileUpdated(username, avatar);
      setMessage("Profile saved.");
      reload();
    } catch (e) {
      setMessage(authMessage((e as Error).message));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="profile-shell">
      <div className="page-intro">
        <div>
          <p className="eyebrow">YOUR ATLAS</p>
          <h1 tabIndex={-1} className="heading mt-2">
            Your explorer profile
          </h1>
        </div>
        <p className="muted">Your identity, progress, and personal bests.</p>
      </div>
      <div className="profile-layout mt-6">
        <form className="card profile-form space-y-5" onSubmit={save} key={data.profile.username}>
          <label>
            Username
            <input
              name="username"
              required
              minLength={2}
              maxLength={24}
              pattern="[A-Za-z0-9 _\-]+"
              defaultValue={data.profile.username}
            />
          </label>
          <fieldset>
            <legend className="mb-3">Choose an avatar</legend>
            <AvatarPicker value={data.profile.avatar} />
          </fieldset>
          <fieldset>
            <legend className="mb-3">Favorite topics</legend>
            <div className="player-favorite-grid">
              {categories.map((c) => (
                <label className="player-favorite-choice" key={c}>
                  <input
                    type="checkbox"
                    name="favorites"
                    value={c}
                    defaultChecked={data.profile.favorites.includes(c)}
                  />
                  <span>{c}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button className="primary" disabled={saving}>
            Save profile
          </button>
          <p role="status">{message}</p>
        </form>
        <section className="card profile-summary">
          <div className="profile-avatar-display">
            <span aria-hidden="true">{avatars[data.profile.avatar]}</span>
            <div>
              <p className="eyebrow">PERSONAL EXPLORER</p>
              <strong>{data.profile.username}</strong>
            </div>
          </div>
          <h2 className="text-2xl font-bold mt-4">Level {level(data.profile.xp)}</h2>
          <p className="muted">
            {data.profile.xp} XP · {500 - (data.profile.xp % 500)} XP to next level
          </p>
          <progress className="w-full my-5" max={500} value={data.profile.xp % 500} aria-label="Level progress" />
          <p>
            {data.totals.games} completed games · {accuracy(data.totals.correct, data.totals.incorrect)} accuracy
          </p>
          <h3 className="font-bold mt-6 mb-2">Best scores by mode</h3>
          {(["classic", "timed", "endless"] as Mode[]).map((m) => (
            <p key={m} className="flex justify-between py-2 border-b border-line/15">
              <span>{modeNames[m]}</span>
              <strong>{data.best[m] ?? "—"}</strong>
            </p>
          ))}
          <h3 className="font-bold mt-6 mb-2">Favorite topics</h3>
          <div className="profile-favorite-tags">
            {data.profile.favorites.length ? (
              data.profile.favorites.map((category) => <span key={category}>{category}</span>)
            ) : (
              <span className="muted">No favorite topics selected</span>
            )}
          </div>
          {!isDemo && <AccountActions />}
          {data.profile.admin && (
            <Link className="secondary mt-3" to="/admin">
              Content administration
            </Link>
          )}
        </section>
      </div>
      <div className="section-heading mt-9 mb-4">
        <div>
          <p className="eyebrow">YOUR JOURNEY</p>
          <h2 className="text-2xl font-bold mt-2">Recent sessions</h2>
        </div>
        <span className="muted text-sm">{data.sessions.length} recent</span>
      </div>
      {!data.sessions.length && (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">
            ◎
          </span>
          <h3 className="font-bold mt-3">Your first run is waiting</h3>
          <p className="muted mt-2">Complete an adventure and your latest results will appear here.</p>
          <Link className="primary mt-4" to="/home">
            Choose a challenge
          </Link>
        </div>
      )}
      <div className="session-list grid gap-2">
        {data.sessions.map((s) => (
          <div key={s.id} className="card flex flex-wrap justify-between gap-3">
            <div>
              <strong>{modeNames[s.mode]}</strong>
              <p className="muted text-sm">
                {new Date(s.createdAt).toLocaleString()} · {s.status}
              </p>
            </div>
            <span>{s.score} points</span>
            {s.status !== "abandoned" && (
              <Link className="secondary" to={`/${s.status === "completed" ? "results" : "play"}/${s.id}`}>
                {s.status === "completed" ? "Review" : "Resume"}
              </Link>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-3 mt-4">
        <button className="secondary" disabled={offset === 0} onClick={() => setOffset((n) => Math.max(0, n - 20))}>
          Previous
        </button>
        <button className="secondary" disabled={data.sessions.length < 20} onClick={() => setOffset((n) => n + 20)}>
          Next
        </button>
      </div>
    </div>
  );
}
function authMessage(message: string) {
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

function Onboarding() {
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
function ThemeControl() {
  const [theme, setTheme] = useState(localStorage.getItem("atlas-theme") ?? "system");
  const choose = (value: string) => {
    setTheme(value);
    if (value === "system") localStorage.removeItem("atlas-theme");
    else localStorage.setItem("atlas-theme", value);
    applyTheme(value);
  };
  return (
    <div className="theme-control">
      <div>
        <strong>Color theme</strong>
        <p className="muted text-sm">Choose a theme for this device.</p>
      </div>
      <div className="theme-choice-list" role="radiogroup" aria-label="Color theme">
        {(
          [
            ["system", "System", "◐"],
            ["light", "Light", "☼"],
            ["dark", "Dark", "◑"],
          ] as const
        ).map(([value, label, icon]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            className={`theme-choice ${theme === value ? "is-selected" : ""}`}
            onClick={() => choose(value)}
          >
            <span aria-hidden="true">{icon}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
function AccountActions() {
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

function Auth() {
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

function AuthRedirect() {
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
function Protected({ children }: { children: JSX.Element }) {
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

function SettingToggle({ id, title, text, checked, onChange }: {
  id: keyof Prefs | string; title: string; text: string; checked: boolean; onChange: (value: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <div>
        <label htmlFor={`setting-${id}`} className="font-bold">{title}</label>
        <p className="muted text-sm">{text}</p>
      </div>
      <button id={`setting-${id}`} type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)}>
        <span aria-hidden="true" />
      </button>
    </div>
  );
}

function Settings() {
  const navigate = useNavigate();
  const prefs = usePrefs();
  const [isAnonymous, setIsAnonymous] = useState<boolean | null>(null);
  const [consent, setConsent] = useState(analyticsEnabled());
  const [motion, setMotion] = useState(localStorage.getItem("atlas-motion") === "reduce");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const canVibrate = (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") || isIOS;
  useEffect(() => {
    api
      .currentUser()
      .then((user) => setIsAnonymous(user.isAnonymous))
      .catch(() => setIsAnonymous(null));
  }, []);
  async function run(task: () => Promise<unknown>) {
    setPending(true);
    setMessage("");
    try {
      await task();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="settings-shell">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Settings</p>
          <h1 tabIndex={-1} className="heading mt-2">
            Play your way.
          </h1>
        </div>
        <p className="muted">Saved on this device.</p>
      </div>

      <section className="card mt-6">
        <h2 className="text-xl font-bold">Gameplay</h2>
        <div className="setting-list">
          <SettingToggle id="autoContinue" title="Continue automatically after a correct answer"
            text="In Quiz, Flags and Capitals, the next question follows after a short pause. Wrong answers always wait so you can read the solution."
            checked={prefs.autoContinue} onChange={(value) => setPref("autoContinue", value)} />
          <SettingToggle id="rememberSetup" title="Remember my last setup"
            text="Each game opens with the choices you used last time."
            checked={prefs.rememberSetup} onChange={(value) => { setPref("rememberSetup", value); if (!value) clearSavedSetups(); }} />
          <SettingToggle id="confirmGiveUp" title="Ask before giving up or discarding"
            text="A quick confirmation before a round is ended or thrown away."
            checked={prefs.confirmGiveUp} onChange={(value) => setPref("confirmGiveUp", value)} />
          <SettingToggle id="keyboardHints" title="Show keyboard shortcuts"
            text="Hints like 1–4 to answer and Enter to continue."
            checked={prefs.keyboardHints} onChange={(value) => setPref("keyboardHints", value)} />
          <SettingToggle id="haptics" title="Vibration"
            text={
              isIOS
                ? "On iPhone you feel a light tick when an answer is accepted while you type (iOS 18 or newer)."
                : canVibrate
                  ? "A short buzz for right and wrong answers."
                  : "This browser doesn't support vibration."
            }
            checked={prefs.haptics && canVibrate} onChange={(value) => { setPref("haptics", value); if (value) haptic("tap"); }} />
        </div>
      </section>

      <section className="card mt-5">
        <h2 className="text-xl font-bold">Appearance</h2>
        <div className="setting-list">
          <ThemeControl />
          <SettingToggle id="motion" title="Reduce motion"
            text="Fewer animations, in addition to your system setting."
            checked={motion}
            onChange={(value) => {
              setMotion(value);
              localStorage.setItem("atlas-motion", value ? "reduce" : "system");
              document.documentElement.dataset.motion = value ? "reduce" : "system";
            }} />
        </div>
      </section>

      <section className="card mt-5">
        <h2 className="text-xl font-bold">Account & data</h2>
        <p className="muted mt-2">
          {isDemo
            ? "This is the local demo: everything stays in this browser."
            : isAnonymous
              ? "You're playing as a guest. Create an account from the player menu so you don't lose your progress."
              : "Your progress is saved to your account."}
        </p>
        <div className="flex flex-wrap gap-3 mt-4">
          <button
            className="secondary"
            disabled={pending}
            onClick={() =>
              void run(async () => {
                download("atlas-data.json", await api.exportData());
              })
            }
          >
            Download my data
          </button>
          {isAnonymous === false && (
            <button
              className="secondary"
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  await api.signOut();
                  setAnalytics(false);
                  navigate("/", { replace: true });
                })
              }
            >
              Sign out
            </button>
          )}
          <button
            className="danger-button"
            disabled={pending}
            onClick={() => {
              if (prompt("Type DELETE to permanently delete this account and its progress.") !== "DELETE") return;
              void run(async () => {
                await api.deleteAccount();
                setAnalytics(false);
                navigate("/", { replace: true });
              });
            }}
          >
            Delete {isDemo ? "demo data" : "account"}
          </button>
        </div>
        <p role="status" className="mt-2">{message}</p>
      </section>

      <details className="card mt-5 settings-about">
        <summary className="text-xl font-bold">About, offline use & diagnostics</summary>
        <div className="mt-4 space-y-4">
          <p className="muted">
            Install Atlas Arena from your browser's menu, or on iPhone/iPad via Safari's Share → Add to Home Screen.
            After the first visit the app opens offline; games, sign-in and saving need a connection.
          </p>
          <SettingToggle id="diagnostics" title="Local diagnostic log"
            text="Keeps the last 100 app events on this device only, to help with bug reports. Nothing is sent anywhere."
            checked={consent} onChange={(value) => { setConsent(value); setAnalytics(value); }} />
          <button className="secondary" onClick={() => download("atlas-diagnostics.json", readEvents())}>
            Download diagnostic log
          </button>
          <p className="muted text-sm">
            Before running Atlas Arena as a public service it still needs a privacy notice, operator contact details,
            a retention policy and a legal review.
          </p>
        </div>
      </details>
    </div>
  );
}

export default function App() {
  if (configurationError)
    return (
      <main className="shell py-10">
        <ErrorBox message={configurationError} />
      </main>
    );
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<AuthRedirect />} />
        <Route
          path="home"
          element={
            <Protected>
              <Hub />
            </Protected>
          }
        />
        <Route
          path="quiz"
          element={
            <Protected>
              <QuizSetup />
            </Protected>
          }
        />
        <Route
          path="play/:id"
          element={
            <Protected>
              <Game />
            </Protected>
          }
        />
        <Route
          path="results/:id"
          element={
            <Protected>
              <Results />
            </Protected>
          }
        />
        <Route
          path="profile"
          element={
            <Protected>
              <ProfilePage />
            </Protected>
          }
        />
        <Route
          path="onboarding"
          element={
            <Protected>
              <Onboarding />
            </Protected>
          }
        />
        <Route
          path="settings"
          element={
            <Protected>
              <Settings />
            </Protected>
          }
        />
        <Route path="auth" element={<Auth />} />
        <Route
          path="explorer"
          element={
            <Protected>
              <Explorer />
            </Protected>
          }
        />
        <Route
          path="flags/*"
          element={
            <Protected>
              <Flags />
            </Protected>
          }
        />
        <Route
          path="recall/*"
          element={
            <Protected>
              <Recall />
            </Protected>
          }
        />
        <Route
          path="capitals/*"
          element={
            <Protected>
              <Capitals />
            </Protected>
          }
        />
        <Route
          path="admin"
          element={
            <Protected>
              <Admin />
            </Protected>
          }
        />
        <Route
          path="*"
          element={
            <section className="card">
              <h1 tabIndex={-1} className="heading">
                Uncharted territory.
              </h1>
              <Link className="primary mt-5" to="/">
                Return home
              </Link>
            </section>
          }
        />
      </Route>
    </Routes>
  );
}
