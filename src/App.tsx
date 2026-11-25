import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";
import { Link, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, configurationError, isDemo, supabase } from "./api";
import { ErrorBox, Loading, OfflineBanner } from "./components";
import { PhoneSuggestion } from "./PhoneSuggestion";
import { avatars } from "./domain";

import { Auth, AuthRedirect, Onboarding, Protected } from "./Auth";
import PlayerWindow from "./PlayerWindow";
import { ProfilePage } from "./Profile";
import { Settings } from "./Settings";

const Admin = lazy(() => import("./Admin"));
const Explorer = lazy(() => import("./Explorer"));
const Flags = lazy(() => import("./Flags"));
const Capitals = lazy(() => import("./Capitals"));
const Recall = lazy(() => import("./Recall"));
const Elimination = lazy(() => import("./Elimination"));
const Hub = lazy(() => import("./Hub"));
const Review = lazy(() => import("./Review"));
const QuizSetup = lazy(() => import("./Quiz").then((module) => ({ default: module.QuizSetup })));
const Game = lazy(() => import("./Quiz").then((module) => ({ default: module.Game })));
const Results = lazy(() => import("./Quiz").then((module) => ({ default: module.Results })));

const tabs = [
  { to: "/home", label: "Home", icon: "home" },
  { to: "/quiz", label: "Quiz", icon: "quiz" },
  { to: "/flags", label: "Flags", icon: "flag" },
  { to: "/capitals", label: "Capitals", icon: "capital" },
  { to: "/recall", label: "Recall", icon: "recall" },
  { to: "/elimination", label: "Elimination", icon: "funnel" },
  { to: "/explorer", label: "Explorer", icon: "explorer" },
] satisfies { to: string; label: string; icon: IconName }[];

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [playerWindow, setPlayerWindow] = useState(false);
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
  // PlayerWindow returns focus to whichever header button opened it.
  const closePlayerWindow = useCallback(() => {
    setPlayerWindow(false);
    setConfirmAccountAction(false);
  }, []);
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
          confirming={confirmAccountAction}
          setConfirming={setConfirmAccountAction}
          message={menuMessage}
          onProfileUpdated={updateProfileIdentity}
          onClose={closePlayerWindow}
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
              <Icon name={tab.icon} size={21} />
              {tab.label}
            </NavLink>
          ))}
        </nav>
      )}
      <OfflineBanner />
      <PhoneSuggestion />
      <main id="main" className="shell py-8 md:py-12">
        <Suspense fallback={<Loading />}>
          <Outlet context={{ onProfileUpdated: updateProfileIdentity, isAdmin: Boolean(identity?.isAdmin) }} />
        </Suspense>
      </main>
      <footer className="shell py-8 text-sm muted border-t border-line/15">
        Built for curious minds. No ads. No public chat.
        <span className="block mt-2">Every quiz question is checked against a source before it goes live.</span>
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
          path="elimination/*"
          element={
            <Protected>
              <Elimination />
            </Protected>
          }
        />
        <Route
          path="review/*"
          element={
            <Protected>
              <Review />
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
