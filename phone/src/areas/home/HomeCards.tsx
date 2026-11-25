// Building blocks of the phone Home screen. Everything is built from @phone/ui pieces plus home.css (ph-home-*).
import { ReactNode, useId, useState } from "react";
import { Link } from "react-router-dom";
import { Icon, IconTile, games } from "@shared/icons";
import { avatars } from "@shared/domain";
import type { Achievement, Dashboard, ReviewSummary } from "@shared/domain";
import { bestScore, describeSetup, formatClock, gameNames, modeNames } from "@shared/game-setup";
import type { PersonalBest } from "@shared/game-setup";
import { accuracy } from "@shared/quiz-meta";
import {
  Button,
  Card,
  GameButton,
  GoalCard,
  LinkGameButton,
  ProgressBar,
  StatusMessage,
  StreakMeter,
  XP_PER_LEVEL,
  feel,
} from "@phone/ui";
import { paths } from "@phone/shell/paths";
import {
  ContinueItem,
  DailyPlan,
  GameKey,
  Goal,
  HomeData,
  Part,
  gameTitles,
  levelProgress,
  percent,
  regionPracticePath,
  setupPath,
  valueOf,
} from "./data";

export const ONLINE_ONLY_TEXT = "Needs an online account – not available in the local demo.";

/** Card with an icon tile and an h3 title; the screen's sections are h2. */
function FeatureCard({
  icon,
  title,
  text,
  aside,
  children,
  className,
}: {
  icon: keyof typeof games;
  title: string;
  text: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <Card as="article" className={["ph-home-feature", className].filter(Boolean).join(" ")} aria-labelledby={headingId}>
      <header className="ph-home-feature-head">
        <IconTile name={games[icon].icon} tone={games[icon].tone} />
        <div className="ph-home-feature-title">
          <h3 id={headingId}>{title}</h3>
          <p className="ph-muted">{text}</p>
        </div>
        {aside}
      </header>
      <div className="ph-home-feature-body">{children}</div>
    </Card>
  );
}

function PartProblem({ part, retry }: { part: Exclude<Part<unknown>, { state: "ok" }>; retry: () => void }) {
  if (part.state === "online-only") return <StatusMessage tone="info">{ONLINE_ONLY_TEXT}</StatusMessage>;
  return (
    <StatusMessage tone="error" retry={retry}>
      Could not load this: {part.message}
    </StatusMessage>
  );
}

/* ---------- Greeting, level and streak ---------- */

/**
 * Player header: avatar, name, level badge, XP bar (XpBar look, server XP only), daily streak flame and a
 * shortcut to the leaderboard. Information only – the actions live in the lower half of the screen.
 */
export function Hero({ dashboard, streak }: { dashboard: Dashboard; streak: { current: number; best: number } | null }) {
  const { username, avatar, xp } = dashboard.profile;
  const { level: lvl, inLevel, toNext } = levelProgress(xp);
  return (
    <section className="ph-home-hero" aria-labelledby="ph-home-greeting">
      <div className="ph-home-hero-row">
        <span className="ph-home-avatar" aria-hidden="true">
          {avatars[avatar] ?? "🌍"}
          <span className="ph-home-level-badge">{lvl}</span>
        </span>
        <div className="ph-home-hero-text">
          <h2 id="ph-home-greeting" className="ph-home-greeting">
            Hi, {username || "explorer"}
          </h2>
          <p className="ph-home-level-line">
            <strong>Level {lvl}</strong>
            <span className="ph-muted">{xp.toLocaleString("en")} XP</span>
          </p>
        </div>
        {streak && (
          <span className="ph-home-hero-streak" title="Daily challenge streak">
            <StreakMeter streak={streak.current} best={streak.best} />
          </span>
        )}
      </div>
      <div className="ph-xp ph-home-xp">
        <div
          className="ph-xp-track"
          role="progressbar"
          aria-label={`Level ${lvl}: ${inLevel} of ${XP_PER_LEVEL} XP`}
          aria-valuemin={0}
          aria-valuemax={XP_PER_LEVEL}
          aria-valuenow={inLevel}
          aria-valuetext={`${inLevel} of ${XP_PER_LEVEL} XP`}
        >
          <div className="ph-xp-fill ph-home-xp-fill" style={{ width: `${(inLevel / XP_PER_LEVEL) * 100}%` }} />
        </div>
        <div className="ph-xp-line">
          <span>
            {toNext} XP to level {lvl + 1}
          </span>
          {streak && streak.current > 0 && (
            <span>
              <strong className="ph-home-streak-text">{streak.current}-day streak</strong> · best {streak.best}
            </span>
          )}
        </div>
      </div>
      <Link className="ph-home-hero-link" to={`${paths.profile}/leaderboard`} onClick={() => feel("tap")}>
        <Icon name="podium" size={18} />
        Leaderboard
        <Icon name="chevronRight" size={16} />
      </Link>
    </section>
  );
}

/* ---------- Next goal ---------- */

export function NextGoal({ goal, onDailyStart, starting }: { goal: Goal; onDailyStart: () => void; starting: boolean }) {
  return (
    <div className="ph-home-goal ph-home-enter">
      <GoalCard
        title={goal.title}
        text={goal.text}
        icon={goal.icon}
        tone={goal.tone}
        progress={goal.progress}
        to={goal.to}
        onClick={goal.action === "daily-start" ? (starting ? () => undefined : onDailyStart) : undefined}
        cta={goal.action === "daily-start" && starting ? "Preparing…" : goal.cta}
      />
    </div>
  );
}

/* ---------- Continue ---------- */

const CONTINUE_PREVIEW = 3;

/** The newest resumable round as one big card in the game's tone. */
export function ContinueHero({ item }: { item: ContinueItem }) {
  return (
    <Link to={item.to} className={`ph-home-resume tone-${item.game} ph-home-enter`} onClick={() => feel("tap")}>
      <IconTile name={games[item.game].icon} tone={games[item.game].tone} size="lg" />
      <span className="ph-home-resume-text">
        <span className="ph-home-eyebrow">Continue · {gameTitles[item.game]}</span>
        <strong className="ph-home-resume-title">{item.title}</strong>
        <small className="ph-muted">{item.detail}</small>
        {item.total > 0 ? (
          <ProgressBar value={item.done} max={item.total} label={`${item.done} of ${item.total} done`} />
        ) : item.done > 0 ? (
          <small className="ph-muted">{item.done} answered</small>
        ) : null}
      </span>
      <span className="ph-home-resume-go" aria-hidden="true">
        <Icon name="chevronRight" size={24} />
      </span>
    </Link>
  );
}

export function ContinueList({ items }: { items: ContinueItem[] }) {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const shown = showAll ? items : items.slice(0, CONTINUE_PREVIEW);
  return (
    <>
      <ul id={listId} className="ph-stack" aria-label="Rounds in progress">
        {shown.map((item, index) => (
          <li key={`${item.game}-${item.id}`}>
            {index === 0 ? (
              <ContinueHero item={item} />
            ) : (
            <Link to={item.to} className="ph-home-continue" onClick={() => feel("tap")}>
              <IconTile name={games[item.game].icon} tone={games[item.game].tone} />
              <span className="ph-home-continue-text">
                <span className="ph-home-eyebrow">{gameTitles[item.game]}</span>
                <strong>{item.title}</strong>
                <small className="ph-muted">{item.detail}</small>
                {item.total > 0 ? (
                  <ProgressBar value={item.done} max={item.total} label={`${item.done} of ${item.total} done`} />
                ) : item.done > 0 ? (
                  <small className="ph-muted">{item.done} answered</small>
                ) : null}
              </span>
              <span className="ph-home-continue-go" aria-hidden="true">
                <Icon name="chevronRight" size={20} />
              </span>
            </Link>
            )}
          </li>
        ))}
      </ul>
      {items.length > CONTINUE_PREVIEW && (
        <Button
          variant="ghost"
          block
          aria-expanded={showAll}
          aria-controls={listId}
          onClick={() => setShowAll((open) => !open)}
        >
          {showAll ? "Show fewer" : `Show all ${items.length} rounds`}
        </Button>
      )}
    </>
  );
}

/* ---------- Today ---------- */

export function DailyCard({
  plan,
  onStart,
  starting,
  message,
  retry,
}: {
  plan: DailyPlan;
  onStart: () => void;
  starting: boolean;
  message: string;
  retry: () => void;
}) {
  const [showBoard, setShowBoard] = useState(false);
  const boardId = useId();
  const streak = "status" in plan ? plan.status.streak.current : 0;
  return (
    <FeatureCard
      icon="daily"
      title="Daily challenge"
      text="10 questions – the same for everyone today. One try."
      className="ph-home-daily tone-daily"
      aside={
        streak > 0 ? (
          <span className="ph-home-pill" aria-label={`Daily streak: ${streak} days`}>
            <Icon name="flame" size={15} /> {streak}
          </span>
        ) : undefined
      }
    >
      {plan.kind === "online-only" && <StatusMessage tone="info">{ONLINE_ONLY_TEXT}</StatusMessage>}
      {plan.kind === "error" && (
        <StatusMessage tone="error" retry={retry}>
          Could not load today's challenge: {plan.message}
        </StatusMessage>
      )}
      {plan.kind === "unavailable" && (
        <p className="ph-muted">Not enough published questions for a daily challenge yet.</p>
      )}
      {plan.kind === "done" && (
        <>
          <dl className="ph-home-stats">
            <div>
              <dt>Points</dt>
              <dd>{(plan.status.score ?? 0).toLocaleString("en")}</dd>
            </div>
            <div>
              <dt>Correct</dt>
              <dd>{plan.status.correct ?? 0}/10</dd>
            </div>
            <div>
              <dt>Rank</dt>
              <dd>
                {plan.status.rank ? `#${plan.status.rank}` : "—"}
                <small> of {plan.status.players}</small>
              </dd>
            </div>
          </dl>
          {plan.status.top.length > 0 && (
            <Button
              block
              aria-expanded={showBoard}
              aria-controls={boardId}
              onClick={() => setShowBoard((open) => !open)}
            >
              {showBoard ? "Hide today's top 10" : "Show today's top 10"}
            </Button>
          )}
          <ol id={boardId} className="ph-home-board" hidden={!showBoard}>
            {plan.status.top.map((row) => (
              <li key={row.rank} className={row.isYou ? "is-you" : undefined}>
                <span className="ph-home-board-rank">#{row.rank}</span>
                <span aria-hidden="true">{avatars[row.avatar] ?? "🌍"}</span>
                <span className="ph-home-board-name">
                  {row.username}
                  {row.isYou ? " (you)" : ""}
                </span>
                <strong>{row.score.toLocaleString("en")}</strong>
              </li>
            ))}
          </ol>
          <p className="ph-muted">
            Come back tomorrow for a new set{plan.status.streak.current ? " and keep your streak going" : ""}.
          </p>
        </>
      )}
      {plan.kind === "continue" && (
        <LinkGameButton to={plan.to} variant="tone" tone="daily" size="md" block>
          Continue today's challenge
        </LinkGameButton>
      )}
      {plan.kind === "start" && (
        <>
          <GameButton variant="tone" tone="daily" size="md" block loading={starting} onClick={onStart}>
            {starting ? "Preparing…" : "Play today's challenge"}
          </GameButton>
          <p className="ph-muted">
            {plan.status.players
              ? `${plan.status.players} ${plan.status.players === 1 ? "player has" : "players have"} played today.`
              : "Be the first to play today."}
          </p>
        </>
      )}
      <StatusMessage tone="error">{message}</StatusMessage>
    </FeatureCard>
  );
}

export function ReviewCard({ part, retry }: { part: Part<ReviewSummary>; retry: () => void }) {
  const summary = valueOf(part);
  return (
    <FeatureCard icon="review" title="Review my mistakes" text="Get them right once and they're cleared for good.">
      {part.state !== "ok" ? (
        <PartProblem part={part} retry={retry} />
      ) : summary && summary.open > 0 ? (
        <>
          <dl className="ph-home-stats">
            <div>
              <dt>Open</dt>
              <dd>{summary.open}</dd>
            </div>
            <div>
              <dt>Cleared</dt>
              <dd>{summary.cleared}</dd>
            </div>
          </dl>
          <LinkGameButton to={`${paths.quiz}/review`} variant="tone" tone="review" size="md" block>
            {summary.activeId ? "Continue review" : `Review ${summary.open === 1 ? "1 mistake" : `${Math.min(10, summary.open)} mistakes`}`}
          </LinkGameButton>
        </>
      ) : (
        <p className="ph-muted">
          No open mistakes{summary?.cleared ? ` – ${summary.cleared} cleared so far` : ""}. Play a round and come back.
        </p>
      )}
    </FeatureCard>
  );
}

export function AchievementsCard({ part, retry }: { part: Part<Achievement[]>; retry: () => void }) {
  const list = valueOf(part) ?? [];
  const earned = list.filter((item) => item.earned);
  const next = list
    .filter((item) => !item.earned && item.target > 0)
    .sort((a, b) => b.current / b.target - a.current / a.target)
    .slice(0, 2);
  return (
    <FeatureCard
      icon="achievements"
      title="Achievements"
      text={part.state === "ok" ? `${earned.length} of ${list.length} badges earned` : "Badges for milestones in every game."}
    >
      {part.state !== "ok" ? (
        <PartProblem part={part} retry={retry} />
      ) : (
        <>
          {earned.length > 0 && (
            <p className="ph-home-small">
              <span className="ph-muted">Latest: </span>
              {earned
                .slice(-3)
                .map((item) => item.title)
                .join(", ")}
            </p>
          )}
          {next.length > 0 && (
            <ul className="ph-home-next" aria-label="Closest badges">
              {next.map((item) => (
                <li key={item.id}>
                  <p className="ph-home-next-line">
                    <strong>{item.title}</strong>
                    <span className="ph-muted">
                      {item.current}/{item.target}
                    </span>
                  </p>
                  <ProgressBar value={item.current} max={item.target} label={`${item.title}: ${item.current} of ${item.target}`} />
                </li>
              ))}
            </ul>
          )}
          <Link className="ph-home-textlink" to={`${paths.profile}/achievements`}>
            All achievements
          </Link>
        </>
      )}
    </FeatureCard>
  );
}

/* ---------- Progress ---------- */

/** One short stat line per game, shared by Home ("Your progress") and the Games screen. */
export function gameStatLine(game: keyof typeof gameTitles, data: HomeData): string | null {
  if (game === "quiz") {
    const { totals, best } = data.quiz;
    if (!totals.games) return "No games yet";
    return `${totals.games} ${totals.games === 1 ? "game" : "games"} · ${accuracy(totals.correct, totals.incorrect)} accuracy · best ${best.classic ?? "—"}`;
  }
  if (game === "flags" || game === "capitals") {
    if (data.stats.state === "online-only") return null;
    const stat = valueOf(data.stats)?.[game];
    if (!stat) return null;
    if (!stat.rounds) return "No finished rounds yet";
    return `${stat.rounds} ${stat.rounds === 1 ? "round" : "rounds"} · ${percent(stat.correct, stat.answered)} correct · ${stat.places} ${game === "flags" ? "flags" : "capitals"} known`;
  }
  if (game === "recall") {
    const recall = valueOf(data.recall);
    if (!recall) return null;
    const catalog = recall.catalog.filter((item) => item.un);
    if (!catalog.length) return null;
    const countries = new Set(recall.recalled.countries);
    const capitals = new Set(recall.recalled.capitals);
    const named = (set: Set<string>) => catalog.filter((item) => set.has(item.code)).length;
    return `${named(countries)}/${catalog.length} countries · ${named(capitals)}/${catalog.length} capitals named`;
  }
  if (data.elimination.state === "online-only") return "Needs an online account";
  const puzzles = valueOf(data.elimination);
  if (!puzzles) return null;
  const played = puzzles.filter((puzzle) => puzzle.plays > 0).length;
  return `${played}/${puzzles.length} puzzles played`;
}

const tileGames: GameKey[] = ["quiz", "flags", "capitals", "recall", "elimination"];

/**
 * Chunky game card in the game's tone (ModeHero look) that opens the game's setup. Shared by Home and Games.
 * The whole card is one link; it presses down like a GameButton and taps once.
 */
export function GameTile({
  to,
  title,
  text,
  stat,
  icon,
  tone,
  badge,
  size = "md",
}: {
  to: string;
  title: string;
  text?: string;
  stat?: string | null;
  icon: keyof typeof games;
  tone: keyof typeof games;
  badge?: ReactNode;
  size?: "md" | "lg";
}) {
  return (
    <Link
      to={to}
      className={`ph-home-tile tone-${games[tone].tone}${size === "lg" ? " ph-home-tile-lg" : ""}`}
      onClick={() => feel("tap")}
    >
      <IconTile name={games[icon].icon} tone={games[icon].tone} size="lg" />
      <span className="ph-home-tile-body">
        <strong className="ph-home-tile-title">{title}</strong>
        {text && <span className="ph-home-tile-text">{text}</span>}
        {stat && <span className="ph-home-tile-stat">{stat}</span>}
        {badge}
      </span>
      <span className="ph-home-tile-go" aria-hidden="true">
        <Icon name="chevronRight" size={22} />
      </span>
    </Link>
  );
}

export function ProgressList({ data }: { data: HomeData }) {
  return (
    <ul className="ph-home-tiles" aria-label="Progress per game">
      {tileGames.map((game) => (
        <li key={game} className="ph-home-enter">
          <GameTile
            to={setupPath[game]}
            title={gameTitles[game]}
            stat={gameStatLine(game, data) ?? "Progress not available right now"}
            icon={game}
            tone={game}
          />
        </li>
      ))}
      <li className="ph-home-enter">
        <GameTile to={paths.explorer} title="Explorer" stat="Browse the atlas – capitals, flags, neighbours" icon="explorer" tone="explorer" />
      </li>
    </ul>
  );
}

/** Seterra-style quick practice: 10 random flags of one region (practice, never a personal best). */
export function PracticeRegions({ regions }: { regions: string[] }) {
  if (!regions.length) return null;
  return (
    <div className="ph-home-regions">
      <p className="ph-muted ph-home-small">10 random flags from one region. Practice – it never changes your bests.</p>
      <ul className="ph-home-region-list" aria-label="Practise a region">
        {regions.map((region) => (
          <li key={region}>
            <Link className="ph-home-region tone-flags" to={regionPracticePath(region)} onClick={() => feel("tap")}>
              <Icon name="flag" size={16} />
              {region}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BestsCard({ bests }: { bests: PersonalBest[] }) {
  return (
    <Card>
      <ul className="ph-home-bests">
        {bests.map((best, index) => (
          <li key={`${best.game}-${best.completedAt}-${index}`}>
            <div className="ph-home-bests-text">
              <strong>
                {gameNames[best.game]} · {modeNames[best.mode] ?? best.mode}
              </strong>
              <small className="ph-muted">
                {describeSetup({
                  scope: best.scope,
                  region: best.region,
                  pool: best.pool,
                  picks: best.selectedCodes.length,
                  limit: best.timeLimitSeconds,
                })}
              </small>
            </div>
            <p className="ph-home-bests-score">
              <strong>{bestScore(best)}</strong>
              <small className="ph-muted">{formatClock(best.elapsedMs)}</small>
            </p>
          </li>
        ))}
      </ul>
      <Link className="ph-home-textlink" to={`${paths.profile}/statistics`}>
        All statistics
      </Link>
    </Card>
  );
}

/* ---------- Loading ---------- */

export function HomeSkeleton() {
  return (
    <div className="ph-home-skeleton" aria-busy="true">
      <p role="status" className="sr-only">
        Loading your home…
      </p>
      <div className="ph-home-skel ph-home-skel-hero" aria-hidden="true" />
      <div className="ph-home-skel ph-home-skel-goal" aria-hidden="true" />
      <div className="ph-home-skel ph-home-skel-title" aria-hidden="true" />
      <div className="ph-home-skel ph-home-skel-row" aria-hidden="true" />
      <div className="ph-home-skel ph-home-skel-row" aria-hidden="true" />
      <div className="ph-home-skel ph-home-skel-title" aria-hidden="true" />
      <div className="ph-home-skel ph-home-skel-card" aria-hidden="true" />
    </div>
  );
}
