// Home: one place to see every game, continue unfinished rounds and check progress.
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { api, isDemo } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import { avatars, Dashboard, level, modes } from "./domain";
import { accuracy, modeIcons, modeNames } from "./quiz-meta";
import type { RecallSetup } from "./recall-domain";
import type { CapitalSetup, FlagsSetup } from "./domain";
import { BestsList, GameStat, GameStats, PersonalBest, describeSetup, regionLabel } from "./game-setup";
import { Meter } from "./setup-ui";
import type { Achievement, DailyStatus, ReviewSummary } from "./domain";
import { AchievementsCard, DailyCard, ReviewCard } from "./Today";
import LeaderboardDialog from "./Leaderboard";
import { Icon, IconTile, games } from "./icons";

type HubData = {
  quiz: Dashboard;
  flags: FlagsSetup | null;
  capitals: CapitalSetup | null;
  recall: RecallSetup | null;
  bests: PersonalBest[] | null;
  stats: GameStats | null;
  daily: DailyStatus | null;
  review: ReviewSummary | null;
  achievements: Achievement[] | null;
};

type Continue = { id: string; game: string; title: string; detail: string; to: string; done: number; total: number };

async function loadHub(): Promise<HubData> {
  const optional = <T,>(promise: Promise<T>) => promise.catch(() => null);
  const [quiz, flags, capitals, recall, bests, stats, daily, review, achievements] = await Promise.all([
    api.dashboard(),
    optional(api.flagsSetup()),
    optional(api.capitalsSetup()),
    optional(api.recallSetup()),
    optional(api.personalBests()),
    optional(api.gameStats()),
    optional(api.dailyStatus()),
    optional(api.reviewSummary()),
    optional(api.achievements()),
  ]);
  const withSessions = <T extends { activeSessions?: unknown }>(value: T | null) =>
    value && Array.isArray(value.activeSessions) ? value : null;
  return {
    quiz,
    flags: withSessions(flags),
    capitals: withSessions(capitals),
    recall: recall && Array.isArray(recall.catalog) && recall.recalled ? withSessions(recall) : null,
    bests: Array.isArray(bests) ? bests : null,
    stats: stats && typeof stats === "object" && "flags" in stats ? stats : null,
    daily: daily && typeof daily === "object" && "streak" in daily && Array.isArray(daily.top) ? daily : null,
    review: review && typeof review === "object" && "open" in review && review.byKind ? review : null,
    achievements: Array.isArray(achievements) ? achievements : null,
  };
}

function continueItems(data: HubData): Continue[] {
  const items: Continue[] = [];
  for (const s of data.quiz.sessions.filter((item) => item.status === "awaiting_answer" || item.status === "showing_feedback"))
    items.push({ id: s.id, game: "Quiz", title: modeNames[s.mode], detail: `${s.difficulty} · ${s.score} pts`, to: `/play/${s.id}`, done: s.correct + s.incorrect, total: 0 });
  for (const s of data.flags?.activeSessions ?? [])
    items.push({
      id: s.id, game: "Flags", title: s.direction === "country_to_flag" ? "Country → Flag" : "Flag → Country",
      detail: describeSetup({ scope: s.scope ?? "all", region: s.region, pool: s.poolTier, picks: s.selectedCount, size: s.sampleSize, limit: s.timeLimitSeconds ?? null })
        + (s.paused ? " · paused" : ""), to: `/flags/session/${s.id}`, done: s.answered, total: s.total,
    });
  for (const s of data.capitals?.activeSessions ?? [])
    items.push({
      id: s.id, game: "Capitals", title: s.direction === "country_to_capital" ? "Country → Capital" : "Capital → Country",
      detail: describeSetup({ scope: s.scope ?? "all", region: s.region, pool: s.poolMode, picks: s.selectedCount, size: s.sampleSize, limit: s.timeLimitSeconds ?? null }),
      to: `/capitals/session/${s.id}`, done: s.answered, total: s.total,
    });
  for (const s of data.recall?.activeSessions ?? [])
    items.push({
      id: s.id, game: "Recall", title: s.kind === "countries" ? "Name the countries" : "Name the capitals",
      detail: `${s.scope === "un" ? "UN member states" : "All countries & territories"} · ${regionLabel(s.region)}`, to: `/recall/play/${s.id}`, done: s.found, total: s.total,
    });
  return items;
}

function GameCard({ to, game, title, text, stat, children, wide }: {
  to: string; game: keyof typeof games; title: string; text: string; stat?: React.ReactNode; children?: React.ReactNode; wide?: boolean;
}) {
  return (
    <article className={`hub-card ${wide ? "is-wide" : ""}`}>
      <Link to={to} className="hub-card-link">
        <IconTile name={games[game].icon} tone={games[game].tone} size="lg" />
        <span className="hub-card-title">{title}</span>
        <span className="hub-card-text">{text}</span>
      </Link>
      {stat && <div className="hub-card-stat">{stat}</div>}
      {children}
    </article>
  );
}

export default function Hub() {
  const location = useLocation();
  const { data, error, reload } = useLoad(loadHub);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const leaderboardButtonRef = useRef<HTMLButtonElement>(null);

  // Old links (results pages, bookmarks) pointed the quiz setup at /home?mode=…
  const legacy = new URLSearchParams(location.search);
  if (legacy.has("mode") || legacy.has("country") || legacy.has("difficulty"))
    return <Navigate to={`/quiz${location.search}${location.hash}`} replace />;

  if (!data)
    return error ? (
      <div className="mode-shell">
        <ErrorBox message={error} retry={reload} />
      </div>
    ) : (
      <Loading />
    );

  const items = continueItems(data);
  const gameStat = (game: "flags" | "capitals", stat: GameStat | undefined) => stat && stat.rounds > 0 ? <>
    <span><strong>{stat.rounds}</strong> {stat.rounds === 1 ? "round" : "rounds"}</span>
    <span><strong>{stat.answered ? Math.round((stat.correct / stat.answered) * 100) : 0}%</strong> correct</span>
    <span><strong>{stat.places}</strong> {game === "flags" ? "flags known" : "capitals known"}</span>
  </> : <span>No finished rounds yet</span>;
  const recallCatalog = data.recall?.catalog.filter((item) => item.un) ?? [];
  const recalledCountries = new Set(data.recall?.recalled.countries ?? []);
  const recalledCapitals = new Set(data.recall?.recalled.capitals ?? []);
  const unCountries = recallCatalog.filter((item) => recalledCountries.has(item.code)).length;
  const unCapitals = recallCatalog.filter((item) => recalledCapitals.has(item.code)).length;
  const xp = data.quiz.profile.xp;
  const lvl = level(xp);
  const xpInLevel = xp % 500;

  return (
    <div className="hub-shell">
      <header className="hub-hero">
        <div>
          <p className="eyebrow">Atlas Arena</p>
          <h1 tabIndex={-1} className="heading mt-2">
            Welcome back, {data.quiz.profile.username}.
          </h1>
          <p className="muted mt-2">Pick up where you left off, or start something new.</p>
        </div>
        <div className="hub-level" aria-label={`Level ${lvl}, ${xp} XP, ${500 - xpInLevel} XP to the next level`}>
          <span className="hub-level-badge" aria-hidden="true">{lvl}</span>
          <div>
            <strong>Level {lvl}</strong>
            <Meter done={xpInLevel} total={500} label={`${xpInLevel} of 500 XP`} />
            <small>{500 - xpInLevel} XP to level {lvl + 1}</small>
          </div>
          <button ref={leaderboardButtonRef} type="button" className="secondary hub-rank" onClick={() => setLeaderboardOpen(true)}>
            Leaderboard
          </button>
        </div>
      </header>

      {items.length > 0 && (
        <section aria-labelledby="hub-continue">
          <h2 id="hub-continue" className="hub-section-title">Continue</h2>
          <ul className="hub-continue">
            {items.slice(0, 6).map((item) => (
              <li key={item.id}>
                <Link to={item.to}>
                  <span className="hub-continue-game">{item.game}</span>
                  <strong>{item.title}</strong>
                  <span className="muted text-sm">{item.detail}</span>
                  {item.total > 0 ? (
                    <>
                      <Meter done={item.done} total={item.total} label={`${item.done} of ${item.total}`} />
                      <span className="hub-continue-count">{item.done}/{item.total}</span>
                    </>
                  ) : (
                    <span className="hub-continue-count">{item.done} answered</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          {items.length > 6 && <p className="muted text-sm mt-2">+{items.length - 6} more – open a game to see all of its rounds.</p>}
        </section>
      )}

      <section aria-labelledby="hub-today">
        <h2 id="hub-today" className="hub-section-title">Today</h2>
        <div className="today-grid">
          <DailyCard status={data.daily} />
          <ReviewCard summary={data.review} />
          <AchievementsCard achievements={data.achievements} />
        </div>
      </section>

      <section aria-labelledby="hub-games">
        <h2 id="hub-games" className="hub-section-title">Games</h2>
        <div className="hub-grid">
          <GameCard wide to="/quiz" game="quiz" title="Quiz" text="Multiple-choice geography questions in four modes and four difficulty tiers."
            stat={<>
              <span><strong>{data.quiz.totals.games}</strong> games</span>
              <span><strong>{accuracy(data.quiz.totals.correct, data.quiz.totals.incorrect)}</strong> accuracy</span>
              <span><strong>{data.quiz.best.classic ?? "—"}</strong> classic best</span>
            </>}>
            <div className="hub-modes">
              {modes.map((mode) => (
                <Link key={mode} to={`/quiz?mode=${mode}`} className="chip">
                  <Icon name={modeIcons[mode]} size={15} /> {modeNames[mode].replace(" Quiz", "").replace(" Challenge", "")}
                </Link>
              ))}
            </div>
          </GameCard>
          <GameCard to="/flags" game="flags" title="Flags" text="Match flags and countries, region by region. Hints when you're stuck."
            stat={gameStat("flags", data.stats?.flags)} />
          <GameCard to="/capitals" game="capitals" title="Capitals" text="Name the capital – or the country behind it – from memory, in English, German or French."
            stat={gameStat("capitals", data.stats?.capitals)} />
          <GameCard to="/recall" game="recall" title="Recall" text="Type every country or capital of a region from memory. English, German or French."
            stat={recallCatalog.length ? <>
              <span><strong>{unCountries}/{recallCatalog.length}</strong> countries named</span>
              <span><strong>{unCapitals}/{recallCatalog.length}</strong> capitals named</span>
            </> : undefined} />
          <GameCard to="/explorer" game="explorer" title="Explorer" text="Browse every country: flags, capitals, languages, neighbours and more."
            stat={<span>Practice any country with one click</span>} />
        </div>
      </section>

      {data.bests && data.bests.length > 0 && (
        <section aria-labelledby="hub-bests">
          <div className="hub-section-row">
            <h2 id="hub-bests" className="hub-section-title">Latest personal bests</h2>
            <Link className="text-link" to="/profile#statistics">All statistics →</Link>
          </div>
          <div className="card">
            <BestsList bests={data.bests.slice(0, 4)} showGame />
          </div>
        </section>
      )}

      {leaderboardOpen && <LeaderboardDialog onClose={() => { setLeaderboardOpen(false); leaderboardButtonRef.current?.focus(); }} />}
    </div>
  );
}
