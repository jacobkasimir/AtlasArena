// Per-game statistics and every personal best, shown on the profile page (/profile#statistics).
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import { BestsList, GameId, GameStats, PersonalBest, formatClock, gameNames } from "./game-setup";
import { Chips } from "./setup-ui";
import type { Achievement } from "./domain";
import { AchievementsGrid } from "./Today";

const games: { id: GameId; icon: string; to: string; unit: string }[] = [
  { id: "flags", icon: "🏳️", to: "/flags", unit: "flags recognised" },
  { id: "capitals", icon: "🏛️", to: "/capitals", unit: "countries answered right" },
  { id: "recall", icon: "🧠", to: "/recall", unit: "places named" },
];

const emptyStat = { rounds: 0, correct: 0, answered: 0, timeMs: 0, lastPlayedAt: null, places: 0 };

async function loadStatistics(): Promise<{ stats: GameStats; bests: PersonalBest[]; achievements: Achievement[] | null }> {
  const [stats, bests, achievements] = await Promise.all([api.gameStats(), api.personalBests(), api.achievements().catch(() => null)]);
  const read = (game: GameId) => ({ ...emptyStat, ...(stats && typeof stats === "object" ? stats[game] : null) });
  return {
    stats: { flags: read("flags"), capitals: read("capitals"), recall: read("recall") },
    bests: Array.isArray(bests) ? bests : [],
    achievements: Array.isArray(achievements) ? achievements : null,
  };
}

export function Statistics() {
  const { data, error, reload } = useLoad(loadStatistics);
  const [game, setGame] = useState<GameId | null>(null);
  const location = useLocation();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!data) return;
    if (location.hash === "#statistics") ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (location.hash === "#achievements") document.getElementById("achievements")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [data, location.hash]);

  const bests = (data?.bests ?? []).filter((best) => !game || best.game === game);
  return (
    <section id="statistics" ref={ref} className="statistics mt-9" aria-labelledby="statistics-title">
      <div className="section-heading mb-4">
        <div>
          <p className="eyebrow">YOUR PROGRESS</p>
          <h2 id="statistics-title" className="text-2xl font-bold mt-2">Statistics</h2>
        </div>
        <span className="muted text-sm">Flags, Capitals and Recall</span>
      </div>
      {error ? <ErrorBox message={error} retry={reload} /> : !data ? <Loading /> : (
        <>
          <div className="stats-grid">
            {games.map((item) => {
              const stat = data.stats[item.id];
              const rate = stat.answered ? Math.round((stat.correct / stat.answered) * 100) : 0;
              const gameBests = data.bests.filter((best) => best.game === item.id);
              return (
                <article key={item.id} className="card stats-card">
                  <header>
                    <span aria-hidden="true">{item.icon}</span>
                    <h3>{gameNames[item.id]}</h3>
                    <Link className="text-link" to={item.to}>Play →</Link>
                  </header>
                  <dl>
                    <div><dt>Rounds finished</dt><dd>{stat.rounds}</dd></div>
                    <div><dt>{item.id === "recall" ? "Found" : "Correct"}</dt><dd>{rate}%</dd></div>
                    <div><dt>Personal bests</dt><dd>{gameBests.length}</dd></div>
                    <div><dt>Time played</dt><dd>{formatClock(stat.timeMs)}</dd></div>
                  </dl>
                  <p className="muted text-sm">
                    <strong className="text-paper">{stat.places}</strong> different {item.unit}
                    {stat.lastPlayedAt ? ` · last played ${new Date(stat.lastPlayedAt).toLocaleDateString()}` : ""}
                  </p>
                </article>
              );
            })}
          </div>
          <div className="card mt-4">
            <div className="stats-bests-head">
              <h3 className="font-bold">Personal bests</h3>
              <Chips label="Show bests for" value={game} onChange={setGame} options={[
                { value: null, label: "All games", count: data.bests.length },
                ...games.map((item) => ({ value: item.id, label: gameNames[item.id], count: data.bests.filter((best) => best.game === item.id).length })),
              ]} />
            </div>
            {bests.length ? <BestsList bests={bests} showGame={!game} />
              : <p className="muted mt-3">No personal bests yet – play a whole set (not a random pick) to record one.</p>}
            <p className="muted text-sm mt-3">
              One best per setup: game, direction, catalog, region, difficulty and time limit. Ties go to the faster round.
            </p>
          </div>
          {data.achievements && (
            <div className="card mt-4" id="achievements">
              <div className="stats-bests-head">
                <h3 className="font-bold">Achievements</h3>
                <span className="muted text-sm">{data.achievements.filter((item) => item.earned).length} of {data.achievements.length} earned</span>
              </div>
              <AchievementsGrid achievements={data.achievements} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
