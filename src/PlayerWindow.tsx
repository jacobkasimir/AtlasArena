// Player window: the modal that opens from the player's name in the header.
// Two panes on wide screens (section list + content), stacked on phones.
// Everything shown here comes from existing RPCs (dashboard, leaderboard, game stats, bests, achievements).
import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { DEMO_UNAVAILABLE, api, isDemo } from "./api";
import { authMessage } from "./Auth";
import { Badge } from "./Achievements";
import { BestsList, GameId, GameStats, PersonalBest, gameNames } from "./game-setup";
import { Icon, IconTile, games as gameIcons, type IconName } from "./icons";
import { useLoad } from "./components";
import { Achievement, Dashboard, Mode, Summary, avatars, categories, level } from "./domain";
import { usePrefs } from "./prefs";
import { AvatarPicker } from "./Profile";
import { accuracy, modeNames } from "./quiz-meta";
import { Meter } from "./setup-ui";
import { ThemeControl } from "./Settings";

// The leaderboard lives in its own chunk (it is also used by the lazy Home hub).
const LeaderboardDialog = lazy(() => import("./Leaderboard"));

export type PlayerIdentity = {
  username: string;
  avatar: number;
  isAnonymous: boolean;
  isAdmin: boolean;
  userId: string;
};

export type PlayerSection = "overview" | "statistics" | "profile" | "appearance";

const sections: { id: PlayerSection; label: string; eyebrow: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", eyebrow: "At a glance", icon: "compass" },
  { id: "statistics", label: "Statistics", eyebrow: "Your progress", icon: "trending" },
  { id: "profile", label: "Profile", eyebrow: "Player details", icon: "users" },
  { id: "appearance", label: "Appearance", eyebrow: "Personalize", icon: "sun" },
];

export const XP_PER_LEVEL = 500;

/** Level, XP inside the current level and XP still needed for the next one (same rule as `level()` in domain.ts). */
export function levelProgress(xp: number) {
  const safe = Math.max(0, Math.floor(xp));
  const into = safe % XP_PER_LEVEL;
  return { level: level(safe), into, needed: XP_PER_LEVEL - into, percent: Math.round((into / XP_PER_LEVEL) * 100) };
}

/** "2h 05m", "14m" or "—" for a play time in milliseconds. */
export function formatPlayTime(ms: number) {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes === 0) return ms > 0 ? "<1m" : "—";
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
}

const isOnlineOnly = (message: string) => message.startsWith(DEMO_UNAVAILABLE);
const gameIds: GameId[] = ["flags", "capitals", "recall"];
const emptyStat = { rounds: 0, correct: 0, answered: 0, timeMs: 0, lastPlayedAt: null, places: 0 };

async function loadGameProgress(): Promise<{ stats: GameStats; bests: PersonalBest[] }> {
  const [stats, bests] = await Promise.all([api.gameStats(), api.personalBests()]);
  const read = (game: GameId) => ({ ...emptyStat, ...(stats && typeof stats === "object" ? stats[game] : null) });
  return {
    stats: { flags: read("flags"), capitals: read("capitals"), recall: read("recall") },
    bests: Array.isArray(bests) ? bests : [],
  };
}

const focusableSelector = [
  "button:not(:disabled)",
  "a[href]",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  'input:not(:disabled):not([type="hidden"])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusables(scope: HTMLElement | null) {
  if (!scope) return [];
  return [...scope.querySelectorAll<HTMLElement>(focusableSelector)].filter((node) => node.tabIndex >= 0);
}

/** True while the user is typing, so single-key shortcuts must not fire. */
function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "reset"].includes(target.type);
  return false;
}

/** Elements that use the arrow keys themselves (tabs, radio groups, sliders). */
function usesArrows(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement && (target.type === "radio" || target.type === "range")) return true;
  return ["tab", "radio", "slider", "listbox", "option"].includes(target.getAttribute("role") ?? "");
}

export default function PlayerWindow({
  identity,
  initialSection = "overview",
  confirming,
  setConfirming,
  message,
  onProfileUpdated,
  onClose,
  onConfirm,
}: {
  identity: PlayerIdentity;
  initialSection?: PlayerSection;
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  message: string;
  onProfileUpdated: (username: string, avatar: number) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [section, setSection] = useState<PlayerSection>(initialSection);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const prefs = usePrefs();

  const dashboardLoad = useLoad(() => api.dashboard());
  const boardLoad = useLoad(() => api.leaderboard("all"));
  const progressLoad = useLoad(loadGameProgress);
  const achievementsLoad = useLoad(() => api.achievements());

  // Keep the last dashboard on screen while it reloads after a profile save (no flash back to skeletons).
  const [dashboard, setDashboard] = useState<Dashboard>();
  useEffect(() => {
    if (dashboardLoad.data) setDashboard(dashboardLoad.data);
  }, [dashboardLoad.data]);

  const dialogRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Partial<Record<PlayerSection, HTMLButtonElement | null>>>({});
  const leaderboardButtonRef = useRef<HTMLButtonElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  // Opened straight from the header's sign-out icon: cancelling closes the whole window.
  const openedForAccount = useRef(confirming);
  const [trigger] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));

  function selectSection(next: PlayerSection, focus = true) {
    setSection(next);
    if (focus) tabRefs.current[next]?.focus();
  }

  function stepSection(delta: number) {
    const index = sections.findIndex((item) => item.id === section);
    selectSection(sections[(index + delta + sections.length) % sections.length].id);
  }

  function cancelConfirm() {
    if (openedForAccount.current) {
      onClose();
      return;
    }
    setConfirming(false);
    window.setTimeout(() => accountButtonRef.current?.focus(), 0);
  }

  function openConfirm() {
    openedForAccount.current = false;
    setConfirming(true);
  }

  // Lock page scroll and give focus back to whatever opened the window.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [trigger]);

  // Initial focus: the active section tab, or Cancel in the confirmation.
  useEffect(() => {
    if (confirming) confirmRef.current?.querySelector<HTMLElement>("button")?.focus();
    else if (!leaderboardOpen) tabRefs.current[section]?.focus();
    // Only when the confirmation opens or closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirming]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (leaderboardOpen) return; // the leaderboard dialog handles its own keys
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirming) cancelConfirm();
        else onClose();
        return;
      }
      if (event.key === "Tab") {
        const nodes = focusables(confirming ? confirmRef.current : dialogRef.current);
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const inside = nodes.includes(document.activeElement as HTMLElement);
        if (event.shiftKey && (document.activeElement === first || !inside)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (confirming || event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) return;
      const number = Number(event.key);
      if (Number.isInteger(number) && number >= 1 && number <= sections.length) {
        event.preventDefault();
        selectSection(sections[number - 1].id);
        return;
      }
      if (usesArrows(event.target)) return; // the tab list and radio groups handle their own arrows
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        stepSection(event.key === "ArrowRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function onTabKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number | "first" | "last"> = {
      ArrowDown: 1,
      ArrowRight: 1,
      ArrowUp: -1,
      ArrowLeft: -1,
      Home: "first",
      End: "last",
    };
    const move = keys[event.key];
    if (move === undefined) return;
    event.preventDefault();
    if (move === "first") selectSection(sections[0].id);
    else if (move === "last") selectSection(sections[sections.length - 1].id);
    else stepSection(move);
  }

  async function saveProfile(username: string, avatar: number, favorites: string[]) {
    await api.saveProfile({ username, avatar, favorites });
    onProfileUpdated(username, avatar);
    dashboardLoad.reload();
    boardLoad.reload();
  }

  const active = sections.find((item) => item.id === section) ?? sections[0];
  const avatar = avatars[identity.avatar] ?? avatars[0];

  return (
    <div
      className="player-window-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !confirming) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="player-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-window-title"
        aria-hidden={confirming || leaderboardOpen ? true : undefined}
      >
        <PlayerHeader
          identity={identity}
          avatar={avatar}
          xp={dashboard?.profile.xp}
          board={boardLoad.data}
          boardFailed={Boolean(boardLoad.error)}
          leaderboardButtonRef={leaderboardButtonRef}
          accountButtonRef={accountButtonRef}
          onLeaderboard={() => setLeaderboardOpen(true)}
          onAccount={openConfirm}
          onClose={onClose}
        />

        <div className="player-window-layout">
          <nav className="player-nav" aria-label="Player window">
            <div className="player-nav-tabs" role="tablist" aria-orientation="vertical" aria-label="Sections" onKeyDown={onTabKey}>
              {sections.map((item, index) => (
                <button
                  key={item.id}
                  ref={(node) => {
                    tabRefs.current[item.id] = node;
                  }}
                  id={`player-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={section === item.id}
                  aria-controls="player-panel"
                  aria-keyshortcuts={String(index + 1)}
                  tabIndex={section === item.id ? 0 : -1}
                  className="player-nav-item"
                  onClick={() => selectSection(item.id, false)}
                >
                  <Icon name={item.icon} size={18} />
                  <span>{item.label}</span>
                  {prefs.keyboardHints && (
                    <kbd className="player-kbd" aria-hidden="true">
                      {index + 1}
                    </kbd>
                  )}
                </button>
              ))}
            </div>
            <Link className="player-nav-settings" to="/settings" onClick={onClose}>
              <Icon name="gamepad" size={18} />
              <span>
                <strong>Game settings</strong>
                <small>Auto-continue, hints, vibration</small>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
            {prefs.keyboardHints && (
              <ul className="player-key-hints" aria-label="Keyboard shortcuts">
                <li>
                  <kbd className="player-kbd">1</kbd>–<kbd className="player-kbd">4</kbd> or <kbd className="player-kbd">←</kbd>
                  <kbd className="player-kbd">→</kbd> switch section
                </li>
                <li>
                  <kbd className="player-kbd">↑</kbd>
                  <kbd className="player-kbd">↓</kbd> move in this list
                </li>
                <li>
                  <kbd className="player-kbd">Esc</kbd> close
                </li>
              </ul>
            )}
          </nav>

          <div
            key={section}
            id="player-panel"
            className="player-panel"
            role="tabpanel"
            aria-labelledby={`player-tab-${section}`}
          >
            <div className="player-panel-heading">
              <p className="eyebrow">{active.eyebrow}</p>
              <h3>{active.label}</h3>
            </div>

            {section === "overview" && (
              <OverviewSection
                identity={identity}
                dashboard={dashboard}
                dashboardError={dashboardLoad.error}
                retryDashboard={dashboardLoad.reload}
                progress={progressLoad.data}
                progressError={progressLoad.error}
                retryProgress={progressLoad.reload}
                achievements={achievementsLoad.data}
                achievementsError={achievementsLoad.error}
                retryAchievements={achievementsLoad.reload}
                onNavigate={onClose}
                onShowStatistics={() => selectSection("statistics")}
              />
            )}
            {section === "statistics" && (
              <StatisticsSection
                dashboard={dashboard}
                dashboardError={dashboardLoad.error}
                retryDashboard={dashboardLoad.reload}
                progress={progressLoad.data}
                progressError={progressLoad.error}
                retryProgress={progressLoad.reload}
                onNavigate={onClose}
              />
            )}
            {section === "profile" && (
              <ProfileSection
                identity={identity}
                dashboard={dashboard}
                error={dashboardLoad.error}
                retry={dashboardLoad.reload}
                onSave={saveProfile}
                onNavigate={onClose}
              />
            )}
            {section === "appearance" && <AppearanceSection onNavigate={onClose} />}

            {message && !confirming && (
              <p className="error player-message" role="alert">
                {message}
              </p>
            )}
          </div>
        </div>
      </section>

      {leaderboardOpen && (
        <Suspense fallback={null}>
          <LeaderboardDialog
            onClose={() => {
              setLeaderboardOpen(false);
              window.setTimeout(() => leaderboardButtonRef.current?.focus(), 0);
            }}
          />
        </Suspense>
      )}

      {confirming && (
        <AccountConfirm identity={identity} message={message} dialogRef={confirmRef} onCancel={cancelConfirm} onConfirm={onConfirm} />
      )}
    </div>
  );
}

function PlayerHeader({
  identity,
  avatar,
  xp,
  board,
  boardFailed,
  leaderboardButtonRef,
  accountButtonRef,
  onLeaderboard,
  onAccount,
  onClose,
}: {
  identity: PlayerIdentity;
  avatar: string;
  xp: number | undefined;
  board: Awaited<ReturnType<typeof api.leaderboard>> | undefined;
  boardFailed: boolean;
  leaderboardButtonRef: RefObject<HTMLButtonElement>;
  accountButtonRef: RefObject<HTMLButtonElement>;
  onLeaderboard: () => void;
  onAccount: () => void;
  onClose: () => void;
}) {
  const progress = xp === undefined ? null : levelProgress(xp);
  const you = board?.you ?? null;
  const status = isDemo ? "Local demo" : identity.isAnonymous ? "Guest" : identity.isAdmin ? "Admin" : "Player";

  return (
    <header className="player-hero">
      <span className="player-hero-avatar" aria-hidden="true">
        {avatar}
        {progress && <span className="player-hero-level">{progress.level}</span>}
      </span>

      <div className="player-hero-main">
        <p className="player-hero-eyebrow">
          <span className="eyebrow">Your Atlas</span>
          <span className={`player-status player-status-${status.toLowerCase().replace(" ", "-")}`}>{status}</span>
        </p>
        <h2 id="player-window-title">{identity.username}</h2>

        {progress ? (
          <div className="player-xp">
            <div className="player-xp-labels">
              <strong>Level {progress.level}</strong>
              <span>
                {(xp ?? 0).toLocaleString()} XP · {progress.needed.toLocaleString()} XP to level {progress.level + 1}
              </span>
            </div>
            <div
              className="player-xp-bar"
              role="progressbar"
              aria-label={`Progress to level ${progress.level + 1}`}
              aria-valuemin={0}
              aria-valuemax={XP_PER_LEVEL}
              aria-valuenow={progress.into}
              aria-valuetext={`${progress.into} of ${XP_PER_LEVEL} XP`}
            >
              <span style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
        ) : (
          <div className="player-xp" aria-hidden="true">
            <span className="skeleton skeleton-line w-40" />
            <span className="skeleton skeleton-bar" />
          </div>
        )}

        <ul className="player-hero-chips" aria-label="Streak and rank">
          {board ? (
            <>
              <li title="Days in a row with a finished daily challenge">
                <Icon name="flame" size={15} />
                <strong>{you?.dailyStreak ?? 0}</strong> day streak
              </li>
              <li title="Most correct answers in a row">
                <Icon name="zap" size={15} />
                <strong>{you?.bestStreak ?? 0}</strong> best answer streak
              </li>
              <li title="All-time XP ranking">
                <Icon name="podium" size={15} />
                {board.currentRank ? (
                  <>
                    Rank <strong>#{board.currentRank}</strong> of {board.totalPlayers.toLocaleString()}
                  </>
                ) : (
                  "Not ranked yet"
                )}
              </li>
            </>
          ) : boardFailed ? null : (
            <>
              <li className="skeleton skeleton-chip" aria-hidden="true" />
              <li className="skeleton skeleton-chip" aria-hidden="true" />
            </>
          )}
        </ul>
      </div>

      <div className="player-hero-actions">
        <button type="button" className="player-close" aria-label="Close player window" onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
        <div className="player-quick-actions">
          <Link className="player-quick" to="/profile" onClick={onClose}>
            <Icon name="map" size={17} />
            <span>Open profile</span>
          </Link>
          <button ref={leaderboardButtonRef} type="button" className="player-quick" onClick={onLeaderboard} aria-haspopup="dialog">
            <Icon name="trophy" size={17} />
            <span>Leaderboard</span>
          </button>
          <Link className="player-quick" to="/settings" onClick={onClose}>
            <Icon name="gamepad" size={17} />
            <span>Settings</span>
          </Link>
          {!isDemo && (
            <button
              ref={accountButtonRef}
              type="button"
              className="player-quick player-quick-account"
              onClick={onAccount}
              aria-haspopup="dialog"
            >
              {identity.isAnonymous ? <SignInIcon /> : <SignOutIcon />}
              <span>{identity.isAnonymous ? "Sign in" : "Sign out"}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function OverviewSection({
  identity,
  dashboard,
  dashboardError,
  retryDashboard,
  progress,
  progressError,
  retryProgress,
  achievements,
  achievementsError,
  retryAchievements,
  onNavigate,
  onShowStatistics,
}: {
  identity: PlayerIdentity;
  dashboard: Dashboard | undefined;
  dashboardError: string;
  retryDashboard: () => void;
  progress: { stats: GameStats; bests: PersonalBest[] } | undefined;
  progressError: string;
  retryProgress: () => void;
  achievements: Achievement[] | undefined;
  achievementsError: string;
  retryAchievements: () => void;
  onNavigate: () => void;
  onShowStatistics: () => void;
}) {
  const rounds = progress ? gameIds.reduce((sum, id) => sum + progress.stats[id].rounds, 0) : 0;
  const timeMs = progress ? gameIds.reduce((sum, id) => sum + progress.stats[id].timeMs, 0) : 0;
  const ready = dashboard && progress;

  return (
    <div className="player-stack">
      {isDemo ? (
        <Notice icon="shield" title="Local demo">
          Progress stays in this browser. Daily challenge, reviews and achievements need an online account.
        </Notice>
      ) : identity.isAnonymous ? (
        <Notice icon="lock" title="Playing as a guest">
          Your progress is tied to this browser.{" "}
          <Link className="text-link" to="/auth?mode=link" onClick={onNavigate}>
            Create an account to keep it →
          </Link>
        </Notice>
      ) : null}

      {dashboardError && !dashboard ? (
        <InlineError message={dashboardError} retry={retryDashboard} />
      ) : progressError && !progress ? (
        <InlineError message={progressError} retry={retryProgress} />
      ) : (
        <div className="player-tiles" aria-busy={!ready}>
          <Tile label="Games played" value={ready ? (dashboard.totals.games + rounds).toLocaleString() : null} icon="gamepad" />
          <Tile
            label="Quiz accuracy"
            value={dashboard ? accuracy(dashboard.totals.correct, dashboard.totals.incorrect) : null}
            icon="target"
          />
          <Tile label="Personal bests" value={progress ? String(progress.bests.length) : null} icon="medal" />
          <Tile label="Time in games" value={progress ? formatPlayTime(timeMs) : null} icon="hourglass" />
        </div>
      )}

      <div className="player-columns">
        <Card
          title="Recent form"
          action={
            dashboard?.sessions.length ? (
              <button type="button" className="text-link" onClick={onShowStatistics}>
                Statistics →
              </button>
            ) : undefined
          }
        >
          {dashboard ? (
            <RecentForm sessions={dashboard.sessions} onNavigate={onNavigate} />
          ) : dashboardError ? null : (
            <SkeletonRows count={2} />
          )}
        </Card>

        <Card title="Achievements">
          <AchievementHighlights
            achievements={achievements}
            error={achievementsError}
            retry={retryAchievements}
            onNavigate={onNavigate}
          />
        </Card>
      </div>

      <Card
        title="Latest personal bests"
        action={
          <Link className="text-link" to="/profile#statistics" onClick={onNavigate}>
            All bests →
          </Link>
        }
      >
        {progress ? (
          progress.bests.length ? (
            <BestsList bests={latestBests(progress.bests, 3)} showGame />
          ) : (
            <Empty>No personal bests yet. Play a whole set in Flags, Capitals or Recall to record one.</Empty>
          )
        ) : progressError ? null : (
          <SkeletonRows count={3} />
        )}
      </Card>
    </div>
  );
}

function latestBests(bests: PersonalBest[], count: number) {
  return [...bests].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt)).slice(0, count);
}

function RecentForm({ sessions, onNavigate }: { sessions: Summary[]; onNavigate: () => void }) {
  const finished = sessions.filter((item) => item.status === "completed").slice(0, 10);
  if (!finished.length) {
    return (
      <Empty>
        No finished quiz games yet.{" "}
        <Link className="text-link" to="/quiz" onClick={onNavigate}>
          Start a quiz →
        </Link>
      </Empty>
    );
  }
  const rate = (item: Summary) => {
    const answered = item.correct + item.incorrect;
    return answered ? Math.round((item.correct / answered) * 100) : 0;
  };
  const average = Math.round(finished.reduce((sum, item) => sum + rate(item), 0) / finished.length);
  // Oldest on the left so the row reads like a timeline.
  const timeline = [...finished].reverse();

  return (
    <div className="player-form">
      <p className="player-form-summary">
        <strong>{average}%</strong> average accuracy over your last {finished.length} {finished.length === 1 ? "game" : "games"}
      </p>
      <ol className="player-form-bars" aria-label="Accuracy of your recent quiz games, oldest first">
        {timeline.map((item) => {
          const value = rate(item);
          const tone = value >= 80 ? "is-great" : value >= 50 ? "is-ok" : "is-low";
          const label = `${modeNames[item.mode]} on ${new Date(item.createdAt).toLocaleDateString()}: ${value}% (${item.correct} correct, score ${item.score})`;
          return (
            <li key={item.id} className={tone} title={label}>
              <span className="sr-only">{label}</span>
              <span className="player-form-bar" style={{ height: `${Math.max(8, value)}%` }} aria-hidden="true" />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function AchievementHighlights({
  achievements,
  error,
  retry,
  onNavigate,
}: {
  achievements: Achievement[] | undefined;
  error: string;
  retry: () => void;
  onNavigate: () => void;
}) {
  if (error) {
    if (isOnlineOnly(error)) return <Empty>Achievements are tracked with an online account, so the local demo has none.</Empty>;
    return <InlineError message="Achievements could not be loaded." retry={retry} />;
  }
  if (!achievements) return <SkeletonRows count={2} />;
  if (!achievements.length) return <Empty>No achievements available yet.</Empty>;

  const earned = achievements.filter((item) => item.earned);
  const next = achievements
    .filter((item) => !item.earned && item.target > 0)
    .sort((a, b) => b.current / b.target - a.current / a.target)[0];

  return (
    <div className="player-achievements">
      <div className="player-achievements-total">
        <strong>{earned.length}</strong>
        <span>/ {achievements.length} badges earned</span>
      </div>
      <Meter done={earned.length} total={achievements.length} label={`${earned.length} of ${achievements.length} badges earned`} />
      {earned.length > 0 && (
        <ul className="player-badges" aria-label="Earned badges">
          {earned.slice(-6).map((item) => (
            <li key={item.id} title={item.title}>
              <Badge item={item} size="sm" />
              <span className="sr-only">{item.title}</span>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <div className="player-next-badge">
          <Badge item={next} size="sm" />
          <div>
            <p>
              <span className="muted">Next up:</span> <strong>{next.title}</strong>
            </p>
            <Meter done={next.current} total={next.target} label={`${next.current} of ${next.target}`} />
            <small className="muted">
              {next.current.toLocaleString()} / {next.target.toLocaleString()}
            </small>
          </div>
        </div>
      )}
      <Link className="text-link" to="/profile#achievements" onClick={onNavigate}>
        All achievements →
      </Link>
    </div>
  );
}

function StatisticsSection({
  dashboard,
  dashboardError,
  retryDashboard,
  progress,
  progressError,
  retryProgress,
  onNavigate,
}: {
  dashboard: Dashboard | undefined;
  dashboardError: string;
  retryDashboard: () => void;
  progress: { stats: GameStats; bests: PersonalBest[] } | undefined;
  progressError: string;
  retryProgress: () => void;
  onNavigate: () => void;
}) {
  return (
    <div className="player-stack">
      <article className="player-game-card">
        <header>
          <IconTile name={gameIcons.quiz.icon} tone={gameIcons.quiz.tone} size="sm" />
          <h4>Quiz</h4>
          <Link className="text-link" to="/quiz" onClick={onNavigate}>
            Play →
          </Link>
        </header>
        {dashboard ? (
          <>
            <dl className="player-dl">
              <Stat label="Games" value={dashboard.totals.games.toLocaleString()} />
              <Stat label="Correct" value={dashboard.totals.correct.toLocaleString()} />
              <Stat label="Accuracy" value={accuracy(dashboard.totals.correct, dashboard.totals.incorrect)} />
              <Stat label="Experience" value={`${dashboard.profile.xp.toLocaleString()} XP`} />
            </dl>
            <div className="player-mode-bests" aria-label="Quiz personal bests" role="group">
              {(["classic", "timed", "endless"] as Mode[]).map((mode) => (
                <p key={mode}>
                  <span>{modeNames[mode]}</span>
                  <strong>{dashboard.best[mode] ?? "—"}</strong>
                </p>
              ))}
            </div>
          </>
        ) : dashboardError ? (
          <InlineError message={dashboardError} retry={retryDashboard} />
        ) : (
          <SkeletonRows count={2} />
        )}
      </article>

      {progressError && !progress ? (
        <InlineError message={progressError} retry={retryProgress} />
      ) : (
        <div className="player-game-grid">
          {gameIds.map((id) => {
            const stat = progress?.stats[id];
            const bests = progress?.bests.filter((best) => best.game === id).length ?? 0;
            const rate = stat?.answered ? `${Math.round((stat.correct / stat.answered) * 100)}%` : "—";
            return (
              <article key={id} className="player-game-card">
                <header>
                  <IconTile name={gameIcons[id].icon} tone={gameIcons[id].tone} size="sm" />
                  <h4>{gameNames[id]}</h4>
                  <Link className="text-link" to={`/${id}`} onClick={onNavigate}>
                    Play →
                  </Link>
                </header>
                {stat ? (
                  <>
                    <dl className="player-dl">
                      <Stat label="Rounds" value={stat.rounds.toLocaleString()} />
                      <Stat label={id === "recall" ? "Found" : "Correct"} value={rate} />
                      <Stat label="Bests" value={String(bests)} />
                      <Stat label="Time" value={formatPlayTime(stat.timeMs)} />
                    </dl>
                    <p className="muted text-sm">
                      {stat.lastPlayedAt ? `Last played ${new Date(stat.lastPlayedAt).toLocaleDateString()}` : "Not played yet"}
                    </p>
                  </>
                ) : (
                  <SkeletonRows count={2} />
                )}
              </article>
            );
          })}
        </div>
      )}

      <Link className="player-wide-link" to="/profile#statistics" onClick={onNavigate}>
        <span>
          <strong>Full statistics</strong>
          <small>Every personal best, filters and the achievement grid</small>
        </span>
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

function ProfileSection({
  identity,
  dashboard,
  error,
  retry,
  onSave,
  onNavigate,
}: {
  identity: PlayerIdentity;
  dashboard: Dashboard | undefined;
  error: string;
  retry: () => void;
  onSave: (username: string, avatar: number, favorites: string[]) => Promise<void>;
  onNavigate: () => void;
}) {
  const [status, setStatus] = useState<{ text: string; ok: boolean }>({ text: "", ok: true });
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setStatus({ text: "", ok: true });
    const form = new FormData(event.currentTarget);
    try {
      await onSave(
        String(form.get("username") ?? "").trim(),
        Number(form.get("avatar") ?? 0),
        form.getAll("favorites").map(String),
      );
      setStatus({ text: "Profile saved.", ok: true });
    } catch (e) {
      setStatus({ text: authMessage((e as Error).message), ok: false });
    } finally {
      setSaving(false);
    }
  }

  if (!dashboard) return error ? <InlineError message={error} retry={retry} /> : <SkeletonRows count={4} />;

  return (
    <div className="player-stack">
      <form className="player-profile-form" onSubmit={submit} key={`${dashboard.profile.username}-${dashboard.profile.avatar}`}>
        <label>
          Username
          <input
            name="username"
            required
            minLength={2}
            maxLength={24}
            pattern="[A-Za-z0-9 _\-]+"
            autoComplete="nickname"
            defaultValue={dashboard.profile.username}
          />
          <small className="muted">2–24 letters, numbers, spaces, _ or -.</small>
        </label>
        <fieldset>
          <legend>Choose an avatar</legend>
          <AvatarPicker value={dashboard.profile.avatar} />
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
                  defaultChecked={dashboard.profile.favorites.includes(category)}
                />
                <span>{category}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="player-form-actions">
          <button className="primary" disabled={saving}>
            {saving ? "Saving…" : "Save profile"}
          </button>
          <p role="status" className={status.ok ? "player-profile-message" : "player-profile-message is-error"}>
            {status.text}
          </p>
        </div>
      </form>

      <div className="player-link-list">
        {!isDemo && identity.isAnonymous && (
          <Link className="player-wide-link" to="/auth?mode=link" onClick={onNavigate}>
            <span>
              <strong>Create an account</strong>
              <small>Keep your guest progress on every device</small>
            </span>
            <span aria-hidden="true">→</span>
          </Link>
        )}
        <Link className="player-wide-link" to="/profile" onClick={onNavigate}>
          <span>
            <strong>Account and data</strong>
            <small>Password, export your data or delete your account</small>
          </span>
          <span aria-hidden="true">→</span>
        </Link>
        {dashboard.profile.admin && (
          <Link className="player-wide-link" to="/admin" onClick={onNavigate}>
            <span>
              <strong>Content administration</strong>
              <small>Review queue and question editor</small>
            </span>
            <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
    </div>
  );
}

function AppearanceSection({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="player-stack">
      <div className="player-card">
        <ThemeControl />
      </div>
      <Link className="player-wide-link" to="/settings" onClick={onNavigate}>
        <span>
          <strong>All settings</strong>
          <small>Auto-continue, remembered setups, confirmations, keyboard hints and vibration</small>
        </span>
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}

function AccountConfirm({
  identity,
  message,
  dialogRef,
  onCancel,
  onConfirm,
}: {
  identity: PlayerIdentity;
  message: string;
  dialogRef: RefObject<HTMLElement>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="account-confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="account-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="account-confirm-title"
        aria-describedby="account-confirm-description"
      >
        <span className="account-confirm-symbol" aria-hidden="true">
          {identity.isAnonymous ? <SignInIcon /> : <SignOutIcon />}
        </span>
        <p className="eyebrow">Account</p>
        <h2 id="account-confirm-title">{identity.isAnonymous ? "Continue to sign in?" : "Sign out of Atlas Arena?"}</h2>
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
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={onConfirm}>
            {identity.isAnonymous ? "Continue to sign in" : "Sign out"}
          </button>
        </div>
      </section>
    </div>
  );
}

// Small building blocks

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="player-card" aria-label={title}>
      <header className="player-card-head">
        <h4>{title}</h4>
        {action}
      </header>
      {children}
    </section>
  );
}

function Tile({ label, value, icon }: { label: string; value: string | null; icon: IconName }) {
  return (
    <div className="player-tile">
      <span className="player-tile-label">
        <Icon name={icon} size={15} />
        {label}
      </span>
      {value === null ? <span className="skeleton skeleton-value" aria-hidden="true" /> : <strong>{value}</strong>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Notice({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <div className="player-notice">
      <Icon name={icon} size={18} />
      <p>
        <strong>{title}.</strong> {children}
      </p>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="player-empty">{children}</p>;
}

function InlineError({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="player-inline-error" role="alert">
      <Icon name="warning" size={18} />
      <p>{message}</p>
      {retry && (
        <button type="button" className="secondary" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="skeleton-rows" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="skeleton skeleton-line" />
      ))}
    </div>
  );
}

function SignOutIcon() {
  return (
    <svg className="player-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 5H5v14h5M14 8l4 4-4 4m4-4H9" />
    </svg>
  );
}

function SignInIcon() {
  return (
    <svg className="player-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 5h5v14h-5M10 8l-4 4 4 4m-4-4h10" />
    </svg>
  );
}
