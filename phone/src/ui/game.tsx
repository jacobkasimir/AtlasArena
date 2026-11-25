// Game-feel building blocks for the phone app: result reveal, streak, timer, combo, retry, stats, goals,
// segmented control and the per-game hero header. All colours come from tokens and game tones (light, dark,
// high contrast); motion is CSS and switches off under reduced motion; states are never colour-only.
import { KeyboardEvent, ReactNode, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { level } from "@shared/domain";
import { Icon, IconName, IconTile, Tone } from "@shared/icons";
import { CALM_QUESTION_MS, showCountdown, usePrefs } from "@shared/prefs";
import { GameButton, LinkGameButton } from "./GameButton";
import { feel, isStreakMilestone } from "./feel";
import { Burst, useCountUp, useReplayKey } from "./motion";

/* ---------- Medal tiers ---------- */

export type MedalTier = "gold" | "silver" | "bronze" | "none";

/** Medal from accuracy: gold ≥ 90 %, silver ≥ 70 %, bronze ≥ 50 %, otherwise none. Empty rounds get none. */
export function medalTier(correct: number, total: number): MedalTier {
  if (!(total > 0)) return "none";
  const ratio = correct / total;
  if (ratio >= 0.9) return "gold";
  if (ratio >= 0.7) return "silver";
  if (ratio >= 0.5) return "bronze";
  return "none";
}

/** Stars shown with the medal: gold 3, silver 2, bronze 1, none 0. */
export const tierStars: Record<MedalTier, number> = { gold: 3, silver: 2, bronze: 1, none: 0 };
const tierNames: Record<MedalTier, string> = { gold: "Gold", silver: "Silver", bronze: "Bronze", none: "No medal yet" };

/** XP per level; must match level() in src/domain.ts (checked by a unit test). */
export const XP_PER_LEVEL = 500;

/** "1:05" for 65 000 ms, "0:09" for 9 000 ms. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/* ---------- ScoreReveal ---------- */

/**
 * A big number that counts up once (score, %, XP). Screen readers get the final value immediately;
 * the counting copy is aria-hidden.
 */
export function ScoreReveal({
  value,
  label,
  suffix = "",
  prefix = "",
  durationMs = 900,
  delayMs = 0,
  size = "lg",
}: {
  value: number;
  label: string;
  suffix?: string;
  prefix?: string;
  durationMs?: number;
  delayMs?: number;
  size?: "md" | "lg";
}) {
  const shown = useCountUp(value, { durationMs, delayMs });
  return (
    <div className={size === "md" ? "ph-score ph-score-md" : "ph-score ph-score-lg"}>
      <span className="ph-score-value" aria-hidden="true">
        {prefix}
        {Math.round(shown).toLocaleString("en-US")}
        {suffix}
      </span>
      <span className="sr-only">
        {label}: {prefix}
        {value.toLocaleString("en-US")}
        {suffix}
      </span>
      <span className="ph-score-label" aria-hidden="true">
        {label}
      </span>
    </div>
  );
}

/* ---------- ResultHero ---------- */

export type ResultHeroProps = {
  /** One short line, e.g. "Great round!" (the screen's h1 stays in the top bar; this is an h2). */
  headline: string;
  /** Game colour and icon for the hero background. */
  tone: Tone;
  icon: IconName;
  /** Main number as the server reported it. */
  score: number;
  scoreLabel?: string;
  /** For accuracy and the medal tier. */
  correct: number;
  total: number;
  /** Round time in ms, shown as m:ss when given. */
  timeMs?: number | null;
  /** false = practice / random sample / unranked: shows `unrankedLabel`, never a medal "best". */
  ranked: boolean;
  unrankedLabel?: string;
  /** Server/domain decided this is a new personal best (never set for unranked rounds). */
  newBest?: boolean;
  previousBest?: number | null;
  /** XP this round gave, and the player's XP total after it (from the server). Both needed for the bar. */
  xpGained?: number | null;
  xpTotal?: number | null;
  /** Haptic/sound on first show (levelUp > reward > complete). Default true. */
  feedback?: boolean;
  /** Extra content under the stats (badges, notes). */
  children?: ReactNode;
};

/**
 * Results header: medal tier and stars, count-up score, accuracy and time, new-best ribbon, practice badge and
 * an XP bar that fills and celebrates a level-up. Fires one feedback on first show.
 */
export function ResultHero({
  headline,
  tone,
  icon,
  score,
  scoreLabel = "Points",
  correct,
  total,
  timeMs,
  ranked,
  unrankedLabel = "Practice · not ranked",
  newBest = false,
  previousBest,
  xpGained,
  xpTotal,
  feedback = true,
  children,
}: ResultHeroProps) {
  const tier = medalTier(correct, total);
  const stars = tierStars[tier];
  const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
  const best = ranked && newBest;
  const hasXp = typeof xpGained === "number" && typeof xpTotal === "number";
  const xpAfter = hasXp ? Math.max(0, xpTotal as number) : 0;
  const xpBefore = hasXp ? Math.max(0, xpAfter - Math.max(0, xpGained as number)) : 0;
  const levelBefore = level(xpBefore);
  const levelAfter = level(xpAfter);
  const levelUp = hasXp && levelAfter > levelBefore;
  const celebrate = best || tier === "gold" || levelUp;

  const headlineId = useId();
  const fired = useRef(false);
  useEffect(() => {
    if (!feedback || fired.current) return;
    fired.current = true;
    feel(levelUp ? "levelUp" : celebrate ? "reward" : "complete");
  }, [feedback, levelUp, celebrate]);

  return (
    <section className={`ph-result-hero tone-${tone}`} data-tier={tier} aria-labelledby={headlineId}>
      <Burst fireKey={celebrate ? `${tier}-${score}` : null} />
      <div className="ph-result-top">
        <span className="ph-medal" data-tier={tier}>
          <Icon name={tier === "none" ? icon : tier === "gold" ? "trophy" : "medal"} size={34} />
        </span>
        <div className="ph-result-tier">
          <span className="ph-stars" role="img" aria-label={`${stars} of 3 stars`}>
            {[0, 1, 2].map((i) => (
              <span key={i} className={i < stars ? "is-on" : undefined} style={{ animationDelay: `${300 + i * 140}ms` }}>
                <Icon name="star" size={22} />
              </span>
            ))}
          </span>
          <span className="ph-tier-name">{tierNames[tier]}</span>
        </div>
      </div>
      <h2 id={headlineId} className="ph-result-headline">
        {headline}
      </h2>
      {best && (
        <p className="ph-ribbon" data-testid="ph-new-best">
          <Icon name="crown" size={18} /> New personal best
          {typeof previousBest === "number" ? <span className="ph-ribbon-sub"> (was {previousBest.toLocaleString("en-US")})</span> : null}
        </p>
      )}
      {!ranked && (
        <p className="ph-badge" data-kind="practice">
          <Icon name="practice" size={16} /> {unrankedLabel}
        </p>
      )}
      <ScoreReveal value={score} label={scoreLabel} />
      <dl className="ph-result-stats">
        <div>
          <dt>Accuracy</dt>
          <dd>{percent}%</dd>
        </div>
        <div>
          <dt>Correct</dt>
          <dd>
            {correct} / {total}
          </dd>
        </div>
        {typeof timeMs === "number" && (
          <div>
            <dt>Time</dt>
            <dd>{formatDuration(timeMs)}</dd>
          </div>
        )}
      </dl>
      {hasXp && (
        <XpBar xpBefore={xpBefore} xpAfter={xpAfter} gained={Math.max(0, xpGained as number)} levelUp={levelUp} />
      )}
      {children}
    </section>
  );
}

/** XP gained this round: "+120 XP", a bar that fills from the old to the new value, and the level-up moment. */
export function XpBar({ xpBefore, xpAfter, gained, levelUp }: { xpBefore: number; xpAfter: number; gained: number; levelUp: boolean }) {
  const levelAfter = level(xpAfter);
  const inLevelAfter = xpAfter % XP_PER_LEVEL;
  const startPercent = levelUp ? 0 : ((xpBefore % XP_PER_LEVEL) / XP_PER_LEVEL) * 100;
  const endPercent = (inLevelAfter / XP_PER_LEVEL) * 100;
  const shown = useCountUp(endPercent, { from: startPercent, durationMs: 1100, delayMs: 350 });
  return (
    <div className="ph-xp" data-level-up={levelUp || undefined}>
      <div className="ph-xp-line">
        <strong>+{gained.toLocaleString("en-US")} XP</strong>
        <span>
          Level {levelAfter} · {XP_PER_LEVEL - inLevelAfter} XP to level {levelAfter + 1}
        </span>
      </div>
      <div
        className="ph-xp-track"
        role="progressbar"
        aria-label={`Level ${levelAfter} progress`}
        aria-valuemin={0}
        aria-valuemax={XP_PER_LEVEL}
        aria-valuenow={inLevelAfter}
        aria-valuetext={`${inLevelAfter} of ${XP_PER_LEVEL} XP`}
      >
        <div className="ph-xp-fill" style={{ width: `${shown}%` }} />
      </div>
      {levelUp && (
        <p className="ph-level-up" role="status">
          <Icon name="sparkles" size={18} /> Level up! You reached level {levelAfter}.
        </p>
      )}
    </div>
  );
}

/* ---------- Streak ---------- */

/** Flame + current streak. "Hot" from 3, pops on every change; text, not colour, carries the value. */
export function StreakMeter({ streak, best }: { streak: number; best?: number }) {
  const replay = useReplayKey(streak);
  const hot = streak >= 3;
  return (
    <span className="ph-streak" data-hot={hot || undefined} data-zero={streak === 0 || undefined}>
      <span key={replay} className={replay ? "ph-streak-inner is-bump" : "ph-streak-inner"}>
        <Icon name="flame" size={18} />
        <span aria-hidden="true">{streak}</span>
      </span>
      <span className="sr-only">
        Streak {streak}
        {typeof best === "number" ? `, best ${best}` : ""}
      </span>
    </span>
  );
}

/**
 * "5 in a row!" pill for streak milestones (3, 5, 10, every 5). Announced politely; disappears after 1.6 s.
 * Pair with feel.correct(streak), which already plays the rising streak feedback on the same milestones.
 */
export function ComboToast({ streak, durationMs = 1600 }: { streak: number; durationMs?: number }) {
  const [shown, setShown] = useState<number | null>(null);
  const previous = useRef(streak);
  useEffect(() => {
    const before = previous.current;
    previous.current = streak;
    if (streak > before && isStreakMilestone(streak)) {
      setShown(streak);
      const timer = window.setTimeout(() => setShown(null), durationMs);
      return () => window.clearTimeout(timer);
    }
  }, [streak, durationMs]);
  return (
    <div className="ph-combo-slot" role="status" aria-live="polite">
      {shown !== null && (
        <span className="ph-combo" key={shown}>
          <Icon name="flame" size={18} /> {shown} in a row!
        </span>
      )}
    </div>
  );
}

/* ---------- Timer ---------- */

/**
 * Countdown bar. Respects Settings → Timer display "calm" (numbers only in the last `calmFromMs`). Goes into a
 * warning state at `warnAtMs` and fires timerWarning once; fires timeUp once at 0 (both switchable off).
 * The server owns the deadline: pass msLeft computed from it.
 */
export function TimerBar({
  msLeft,
  totalMs,
  warnAtMs = 10_000,
  calmFromMs = CALM_QUESTION_MS,
  label = "Time left",
  feedback = true,
}: {
  msLeft: number;
  totalMs: number;
  warnAtMs?: number;
  calmFromMs?: number;
  label?: string;
  feedback?: boolean;
}) {
  const prefs = usePrefs();
  const left = Math.max(0, msLeft);
  const warn = left <= warnAtMs;
  const visible = showCountdown(prefs, left, calmFromMs);
  const warned = useRef(warn);
  const ended = useRef(left === 0);
  useEffect(() => {
    if (!feedback) return;
    if (warn && !warned.current && left > 0) feel("timerWarning");
    if (left === 0 && !ended.current) feel("timeUp");
    warned.current = warn;
    ended.current = left === 0;
  }, [warn, left, feedback]);
  const percent = Math.min(100, Math.max(0, (left / Math.max(1, totalMs)) * 100));
  if (!visible)
    return (
      <span className="ph-timer is-calm" role="timer" aria-label={`${label}: timed round`}>
        <Icon name="timer" size={16} /> Timed
      </span>
    );
  const seconds = Math.ceil(left / 1000);
  return (
    <div className="ph-timer" data-warn={warn || undefined} role="timer" aria-label={`${label}: ${seconds} seconds`}>
      <span className="ph-timer-text" aria-hidden="true">
        <Icon name="timer" size={16} /> {left >= 60_000 ? formatDuration(left) : `${seconds}s`}
      </span>
      <span className="ph-timer-track" aria-hidden="true">
        <span className="ph-timer-fill" style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}

/* ---------- Learning loop ---------- */

/**
 * Entry into the learning loop after a round: "Practise the 4 you missed". Hidden when nothing was missed.
 * Give `to` (e.g. Review my mistakes) or `onRetry`. Retrying is practice: it never changes personal bests.
 */
export function RetryMissedCard({
  count,
  to,
  onRetry,
  loading,
  title,
  text = "Go again on just the ones you got wrong. Practice never changes your bests.",
  cta = "Retry missed",
  tone = "review",
}: {
  count: number;
  to?: string;
  onRetry?: () => void;
  loading?: boolean;
  title?: string;
  text?: string;
  cta?: string;
  tone?: Tone;
}) {
  if (count <= 0) return null;
  return (
    <section className="ph-retry" aria-label="Learn from your mistakes">
      <IconTile name="review" tone={tone} />
      <div className="ph-retry-text">
        <strong>{title ?? `Practise the ${count} you missed`}</strong>
        <small>{text}</small>
      </div>
      {to ? (
        <LinkGameButton to={to} variant="tone" tone={tone} size="md">
          {cta}
        </LinkGameButton>
      ) : (
        <GameButton variant="tone" tone={tone} size="md" onClick={onRetry} loading={loading}>
          {cta}
        </GameButton>
      )}
    </section>
  );
}

/* ---------- Stats and goals ---------- */

/** Grid of StatTiles (a description list). */
export function StatGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <dl className="ph-stat-grid" aria-label={label}>
      {children}
    </dl>
  );
}

/** One number with a label (use inside StatGrid). */
export function StatTile({ label, value, icon, tone = "neutral", hint }: { label: string; value: ReactNode; icon?: IconName; tone?: Tone; hint?: ReactNode }) {
  return (
    <div className={`ph-stat tone-${tone}`}>
      <dt>
        {icon && <Icon name={icon} size={16} />}
        {label}
      </dt>
      <dd>{value}</dd>
      {hint && <dd className="ph-stat-hint">{hint}</dd>}
    </div>
  );
}

/** "Next goal" card: what to aim for next, optional progress, one action. */
export function GoalCard({
  title,
  text,
  icon,
  tone,
  progress,
  to,
  onClick,
  cta,
}: {
  title: string;
  text?: ReactNode;
  icon: IconName;
  tone: Tone;
  progress?: { value: number; max: number; label: string };
  to?: string;
  onClick?: () => void;
  cta?: string;
}) {
  const percent = progress ? Math.min(100, Math.max(0, (progress.value / Math.max(1, progress.max)) * 100)) : 0;
  return (
    <section className={`ph-goal tone-${tone}`} aria-label={`Next goal: ${title}`}>
      <div className="ph-goal-head">
        <IconTile name={icon} tone={tone} />
        <div className="ph-goal-text">
          <span className="ph-goal-kicker">Next goal</span>
          <strong>{title}</strong>
          {text && <small>{text}</small>}
        </div>
      </div>
      {progress && (
        <div
          className="ph-goal-track"
          role="progressbar"
          aria-label={progress.label}
          aria-valuemin={0}
          aria-valuemax={progress.max}
          aria-valuenow={Math.min(progress.max, progress.value)}
          aria-valuetext={`${Math.min(progress.max, progress.value)} of ${progress.max}`}
        >
          <span className="ph-goal-fill" style={{ width: `${percent}%` }} />
        </div>
      )}
      {cta &&
        (to ? (
          <LinkGameButton to={to} variant="tone" tone={tone} size="md" block>
            {cta}
          </LinkGameButton>
        ) : onClick ? (
          <GameButton variant="tone" tone={tone} size="md" block onClick={onClick}>
            {cta}
          </GameButton>
        ) : null)}
    </section>
  );
}

/* ---------- Segmented control ---------- */

export type SegmentOption<T extends string> = { value: T; label: string; icon?: IconName; disabled?: boolean };

/** Single choice from 2–4 short options (radiogroup; arrow keys move; select haptic). */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  describedBy,
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** id of an element that describes the group (aria-describedby). */
  describedBy?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.filter((option) => !option.disabled);
  function choose(next: T) {
    if (next === value) return;
    feel("select");
    onChange(next);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!delta || !enabled.length) return;
    event.preventDefault();
    const current = Math.max(0, enabled.findIndex((option) => option.value === value));
    const next = enabled[(current + delta + enabled.length) % enabled.length];
    choose(next.value);
    refs.current[options.indexOf(next)]?.focus();
  }
  return (
    <div className="ph-segmented" role="radiogroup" aria-label={label} aria-describedby={describedBy} onKeyDown={onKeyDown} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={option.disabled}
            className="ph-segment"
            onClick={() => choose(option.value)}
          >
            {option.icon && <Icon name={option.icon} size={18} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Mode hero ---------- */

/** Header card for a game's setup or play screen in the game's tone. Title is an h2 (top bar holds the h1). */
export function ModeHero({
  title,
  subtitle,
  icon,
  tone,
  badge,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  icon: IconName;
  tone: Tone;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className={`ph-mode-hero tone-${tone}`}>
      <IconTile name={icon} tone={tone} size="lg" />
      <div className="ph-mode-hero-text">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {badge && <span className="ph-mode-hero-badge">{badge}</span>}
      {children && <div className="ph-mode-hero-extra">{children}</div>}
    </header>
  );
}

/** Small inline link with chevron, for "See all" style navigation inside cards. */
export function MoreLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="ph-more-link">
      {children}
      <Icon name="chevronRight" size={16} />
    </Link>
  );
}
