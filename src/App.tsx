import { FormEvent, Suspense, lazy, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, configurationError, isDemo, supabase } from "./api";
import { ErrorBox, Loading, OfflineBanner, useLoad } from "./components";
import { Mode, avatars, categories, level } from "./domain";
import { accuracy, modeNames } from "./quiz-meta";

import { Auth, AuthRedirect, Onboarding, Protected, authMessage } from "./Auth";
import { AvatarPicker, ProfilePage } from "./Profile";
import { Game, QuizSetup, Results } from "./Quiz";
import { Settings, ThemeControl } from "./Settings";

const Admin = lazy(() => import("./Admin"));
const Explorer = lazy(() => import("./Explorer"));
const Flags = lazy(() => import("./Flags"));
const Capitals = lazy(() => import("./Capitals"));
const Recall = lazy(() => import("./Recall"));
const Hub = lazy(() => import("./Hub"));

const tabs = [
  { to: "/home", label: "Home", icon: "⌂" },
  { to: "/quiz", label: "Quiz", icon: "◎" },
  { to: "/flags", label: "Flags", icon: "⚑" },
  { to: "/capitals", label: "Capitals", icon: "◆" },
  { to: "/recall", label: "Recall", icon: "✦" },
  { to: "/explorer", label: "Explorer", icon: "◍" },
];

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
      setIdentity(
        (current) => current ?? { username: "Explorer", avatar: 0, isAnonymous: true, isAdmin: false, userId: "demo" },
      );
      api
        .dashboard()
        .then((d) => {
          if (live)
            setIdentity({
              username: d.profile.username,
              avatar: d.profile.avatar,
              isAnonymous: true,
              isAdmin: false,
              userId: "demo",
            });
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
                {tabs.map((tab) => (
                  <NavLink key={tab.to} to={tab.to} className="topbar-game-link">
                    {tab.label}
                  </NavLink>
                ))}
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
      {identity && (
        <nav className="bottom-tabs" aria-label="Games">
          {tabs.slice(0, 5).map((tab) => (
            <NavLink key={tab.to} to={tab.to}>
              <span aria-hidden="true">{tab.icon}</span>
              {tab.label}
            </NavLink>
          ))}
        </nav>
      )}
      <OfflineBanner />
      <main id="main" className="shell py-8 md:py-12">
        <Suspense fallback={<Loading />}>
          <Outlet context={{ onProfileUpdated: updateProfileIdentity, isAdmin: Boolean(identity?.isAdmin) }} />
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
