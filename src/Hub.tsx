// Home: one place to see every game, continue unfinished rounds and check progress.
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { api, isDemo } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import { avatars, Dashboard, level, modes } from "./domain";
import { accuracy, modeIcons, modeNames } from "./quiz-meta";
import type { RecallSetup } from "./recall-domain";
import type { CapitalSetup, FlagsBestBoard, FlagsSetup } from "./domain";
import { Meter } from "./setup-ui";

type HubData = {
  quiz: Dashboard;
  flags: FlagsSetup | null;
  flagBests: FlagsBestBoard[] | null;
  capitals: CapitalSetup | null;
  recall: RecallSetup | null;
};

type Continue = { id: string; game: string; title: string; detail: string; to: string; done: number; total: number };

async function loadHub(): Promise<HubData> {
  const optional = <T,>(promise: Promise<T>) => promise.catch(() => null);
  const [quiz, flags, flagBests, capitals, recall] = await Promise.all([
    api.dashboard(),
    optional(api.flagsSetup()),
    optional(api.flagsBests()),
    optional(api.capitalsSetup()),
    optional(api.recallSetup()),
  ]);
  const withSessions = <T extends { activeSessions?: unknown }>(value: T | null) =>
    value && Array.isArray(value.activeSessions) ? value : null;
  return {
    quiz,
    flags: withSessions(flags),
    flagBests: Array.isArray(flagBests) ? flagBests : null,
    capitals: withSessions(capitals),
    recall: recall && Array.isArray(recall.catalog) && recall.recalled ? withSessions(recall) : null,
  };
}

function continueItems(data: HubData): Continue[] {
  const items: Continue[] = [];
  for (const s of data.quiz.sessions.filter((item) => item.status === "awaiting_answer" || item.status === "showing_feedback"))
    items.push({ id: s.id, game: "Quiz", title: modeNames[s.mode], detail: `${s.difficulty} · ${s.score} pts`, to: `/play/${s.id}`, done: s.correct + s.incorrect, total: 0 });
  for (const s of data.flags?.activeSessions ?? [])
    items.push({
      id: s.id, game: "Flags", title: s.direction === "country_to_flag" ? "Country → Flag" : "Flag → Country",
      detail: `${s.region || "Whole world"}${s.paused ? " · paused" : ""}`, to: `/flags/session/${s.id}`, done: s.answered, total: s.total,
    });
  for (const s of data.capitals?.activeSessions ?? [])
    items.push({
      id: s.id, game: "Capitals", title: s.direction === "country_to_capital" ? "Country → Capital" : "Capital → Country",
      detail: s.region ?? "Whole world", to: `/capitals/session/${s.id}`, done: s.answered, total: s.total,
    });
  for (const s of data.recall?.activeSessions ?? [])
    items.push({
      id: s.id, game: "Recall", title: s.kind === "countries" ? "Name the countries" : "Name the capitals",
      detail: s.region ?? (s.scope === "un" ? "UN member states" : "Whole world"), to: `/recall/play/${s.id}`, done: s.found, total: s.total,
    });
  return items;
}

function GameCard({ to, icon, title, text, stat, children, wide }: {
  to: string; icon: string; title: string; text: string; stat?: React.ReactNode; children?: React.ReactNode; wide?: boolean;
}) {
  return (
    <article className={`hub-card ${wide ? "is-wide" : ""}`}>
      <Link to={to} className="hub-card-link">
        <span className="hub-card-icon" aria-hidden="true">{icon}</span>
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
  const flagsRuns = data.flagBests?.reduce((sum, board) => sum + board.runCount, 0) ?? 0;
  const bestFlags = data.flagBests
    ?.flatMap((board) => board.topFive.map((run) => ({ ...run, total: board.total })))
    .sort((a, b) => b.score / b.maxScore - a.score / a.maxScore)[0];
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

      <section aria-labelledby="hub-games">
        <h2 id="hub-games" className="hub-section-title">Games</h2>
        <div className="hub-grid">
          <GameCard wide to="/quiz" icon="◎" title="Quiz" text="Multiple-choice geography questions in four modes and four difficulty tiers."
            stat={<>
              <span><strong>{data.quiz.totals.games}</strong> games</span>
              <span><strong>{accuracy(data.quiz.totals.correct, data.quiz.totals.incorrect)}</strong> accuracy</span>
              <span><strong>{data.quiz.best.classic ?? "—"}</strong> classic best</span>
            </>}>
            <div className="hub-modes">
              {modes.map((mode) => (
                <Link key={mode} to={`/quiz?mode=${mode}`} className="chip">
                  <span aria-hidden="true">{modeIcons[mode]}</span> {modeNames[mode].replace(" Quiz", "").replace(" Challenge", "")}
                </Link>
              ))}
            </div>
          </GameCard>
          <GameCard to="/flags" icon="🏳️" title="Flags" text="Match flags and countries, region by region. Hints when you're stuck."
            stat={bestFlags ? <>
              <span><strong>{flagsRuns}</strong> rounds finished</span>
              <span><strong>{Math.round((bestFlags.score / bestFlags.maxScore) * 100)}%</strong> best round</span>
            </> : <span>No finished rounds yet</span>} />
          <GameCard to="/capitals" icon="🏛️" title="Capitals" text="Name the capital – or the country behind it – with spelling help as you type."
            stat={<span><strong>{data.capitals?.activeSessions.length ?? 0}</strong> rounds in progress</span>} />
          <GameCard to="/recall" icon="🧠" title="Recall" text="Type every country or capital of a region from memory. English, German or French."
            stat={recallCatalog.length ? <>
              <span><strong>{unCountries}/{recallCatalog.length}</strong> countries named</span>
              <span><strong>{unCapitals}/{recallCatalog.length}</strong> capitals named</span>
            </> : undefined} />
          <GameCard to="/explorer" icon="🧭" title="Explorer" text="Browse every country: flags, capitals, languages, neighbours and more."
            stat={<span>Practice any country with one click</span>} />
        </div>
      </section>

      {leaderboardOpen && <LeaderboardDialog onClose={() => { setLeaderboardOpen(false); leaderboardButtonRef.current?.focus(); }} />}
    </div>
  );
}

function LeaderboardDialog({ onClose }: { onClose: () => void }) {
  const leaderboard = useLoad(() => api.leaderboard());
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return onClose();
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]');
      if (!focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="leaderboard-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="leaderboard-dialog" role="dialog" aria-modal="true" aria-labelledby="leaderboard-title">
        <header className="leaderboard-header">
          <div>
            <p className="eyebrow">Atlas Arena · Global</p>
            <h2 id="leaderboard-title" className="text-2xl font-black mt-1">Top 25 players</h2>
            <p className="muted text-sm mt-1">Ranked by XP earned in quiz games.</p>
          </div>
          <button ref={closeRef} type="button" className="leaderboard-close secondary" aria-label="Close leaderboard" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        {leaderboard.error && <ErrorBox message={leaderboard.error} retry={leaderboard.reload} />}
        {!leaderboard.data && !leaderboard.error && <Loading />}
        {leaderboard.data && (isDemo ? (
          <p className="muted mt-5">The demo keeps progress in this browser only, so there is no shared leaderboard.</p>
        ) : (
          <>
            {leaderboard.data.currentRank && leaderboard.data.currentRank > 25 && (
              <p className="leaderboard-your-rank">Your rank: <strong>#{leaderboard.data.currentRank}</strong></p>
            )}
            {!leaderboard.data.currentRank && <p className="leaderboard-your-rank">Finish a scored quiz game to join the leaderboard.</p>}
            {leaderboard.data.players.length ? (
              <div className="leaderboard-table-scroll" role="region" aria-label="Top 25 players" tabIndex={0}>
                <table className="leaderboard-table">
                  <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">XP</th></tr></thead>
                  <tbody>
                    {leaderboard.data.players.map((player) => (
                      <tr key={`${player.rank}-${player.username}`} className={player.rank === leaderboard.data?.currentRank ? "is-you" : ""}>
                        <td><span className="leaderboard-position">{player.rank <= 3 ? ["①", "②", "③"][player.rank - 1] : `#${player.rank}`}</span></td>
                        <td>
                          <span className="leaderboard-player">
                            <span aria-hidden="true">{avatars[player.avatar] ?? avatars[0]}</span>
                            <strong>{player.username}</strong>
                            {player.rank === leaderboard.data?.currentRank && <span className="leaderboard-you-tag">You</span>}
                          </span>
                        </td>
                        <td className="leaderboard-xp">{player.xp.toLocaleString()} XP</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted mt-5">No ranked players yet – be the first.</p>}
          </>
        ))}
      </section>
    </div>
  );
}
