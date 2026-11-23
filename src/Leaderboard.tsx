// Global leaderboard dialog: podium, ranked list with level/XP/streaks and a pinned card for the signed-in player.
import { useEffect, useRef, useState } from "react";
import { api, isDemo } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import { avatars, type Leaderboard, type LeaderboardPeriod, type LeaderboardPlayer } from "./domain";
import { Meter } from "./setup-ui";

const periods: { id: LeaderboardPeriod; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "week", label: "This week" }
];
const medals = ["🥇", "🥈", "🥉"];

export function activeLabel(iso: string | null, now = Date.now()) {
  if (!iso) return "Not played yet";
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "Active today";
  if (days === 1) return "Active yesterday";
  if (days < 30) return `Active ${days}d ago`;
  return `Active ${Math.floor(days / 30)}mo ago`;
}


function Avatar({ player, size = "md" }: { player: LeaderboardPlayer; size?: "md" | "lg" }) {
  return <span className={`lb-avatar lb-avatar-${size}`} aria-hidden="true">{avatars[player.avatar] ?? avatars[0]}</span>;
}

function StatChips({ player }: { player: LeaderboardPlayer }) {
  return (
    <span className="lb-chips">
      <span title="Best answer streak in one game">🔥 <strong>{player.bestStreak}</strong> best streak</span>
      <span title="Daily challenge streak">📅 <strong>{player.dailyStreak}</strong> daily streak</span>
      <span title="Correct answers in scored games">🎯 <strong>{player.accuracy == null ? "–" : `${player.accuracy}%`}</strong></span>
      <span title="Finished games">🎮 <strong>{player.games}</strong> {player.games === 1 ? "game" : "games"}</span>
    </span>
  );
}

function LevelLine({ player }: { player: LeaderboardPlayer }) {
  const inLevel = player.xp % 500;
  return (
    <span className="lb-level">
      <span className="lb-level-badge">Lv {player.level}</span>
      <Meter done={inLevel} total={500} label={`Level ${player.level}: ${inLevel} of 500 XP to level ${player.level + 1}`} />
    </span>
  );
}

function YouCard({ board }: { board: Leaderboard }) {
  const you = board.you;
  if (!you) return null;
  const week = board.period === "week";
  const goal = !you.rank
    ? week ? "Finish a scored quiz game this week to get on the weekly board." : "Finish a scored quiz game to join the leaderboard."
    : board.ahead
      ? <>Earn <strong>{board.ahead.gap.toLocaleString()} XP</strong> to pass {board.ahead.username} for #{board.ahead.rank}.</>
      : board.totalPlayers > 1 ? <>You lead the {week ? "week" : "world"}. Keep your streak going!</> : <>You're the first ranked player.</>;
  return (
    <section className="lb-you" aria-label="Your standing">
      <div className="lb-you-main">
        <Avatar player={you} size="lg" />
        <div className="min-w-0">
          <p className="eyebrow">Your standing</p>
          <p className="lb-you-name">{you.username}</p>
          <LevelLine player={you} />
        </div>
        <div className="lb-you-rank">
          <strong>{you.rank ? `#${you.rank}` : "–"}</strong>
          <small>{board.totalPlayers ? `of ${board.totalPlayers.toLocaleString()}` : "unranked"}</small>
        </div>
      </div>
      <div className="lb-you-stats">
        <span><strong>{you.points.toLocaleString()}</strong> {week ? "XP this week" : "XP"}</span>
        <StatChips player={you} />
      </div>
      <p className="lb-you-goal">{goal}</p>
    </section>
  );
}

function Podium({ players, week }: { players: LeaderboardPlayer[]; week: boolean }) {
  return (
    <ol className="lb-podium" aria-label="Top three">
      {players.map((player) => (
        <li key={player.rank} className={`lb-step lb-step-${player.rank}${player.isYou ? " is-you" : ""}`} style={{ order: player.rank === 1 ? 2 : player.rank === 2 ? 1 : 3 }}>
          <span className="lb-medal" aria-label={`Rank ${player.rank}`}>{medals[(player.rank ?? 1) - 1]}</span>
          <Avatar player={player} size="lg" />
          <strong className="lb-step-name" title={player.username}>{player.username}</strong>
          {player.isYou && <span className="leaderboard-you-tag">You</span>}
          <span className="lb-step-level">Level {player.level}</span>
          <span className="lb-step-xp">{player.points.toLocaleString()} XP{week ? " this week" : ""}</span>
          <span className="lb-step-streak" title="Best answer streak">🔥 {player.bestStreak}</span>
        </li>
      ))}
    </ol>
  );
}

function Row({ player, week }: { player: LeaderboardPlayer; week: boolean }) {
  return (
    <li className={`lb-row${player.isYou ? " is-you" : ""}`}>
      <span className="lb-rank">#{player.rank}</span>
      <Avatar player={player} />
      <span className="lb-row-body">
        <span className="lb-row-name">
          <strong title={player.username}>{player.username}</strong>
          {player.isYou && <span className="leaderboard-you-tag">You</span>}
          <span className="lb-level-badge">Lv {player.level}</span>
        </span>
        <StatChips player={player} />
      </span>
      <span className="lb-row-xp">
        <strong>{player.points.toLocaleString()}</strong>
        <small>{week ? "XP this week" : "XP"}</small>
        <small className="lb-active">{activeLabel(player.lastPlayedAt)}</small>
      </span>
    </li>
  );
}

export function LeaderboardBody({ board }: { board: Leaderboard }) {
  const week = board.period === "week";
  const podium = board.players.length >= 3 ? board.players.slice(0, 3) : [];
  const rest = board.players.slice(podium.length);
  return (
    <div className="lb-scroll" role="region" aria-label="Leaderboard" tabIndex={0}>
      <YouCard board={board} />
      {isDemo && <p className="lb-note">The demo keeps progress in this browser, so only you are on this board. Sign in to compete with other players.</p>}
      {board.players.length === 0 && !isDemo && (
        <p className="lb-note">{week ? "Nobody has earned XP in the last 7 days yet – be the first." : "No ranked players yet – be the first."}</p>
      )}
      {podium.length > 0 && <Podium players={podium} week={week} />}
      {rest.length > 0 && <ol className="lb-list" start={podium.length + 1} aria-label={podium.length ? "Ranks 4 to 25" : "Ranking"}>{rest.map((player) => <Row key={player.rank} player={player} week={week} />)}</ol>}
      {board.totalPlayers > board.players.length && (
        <p className="lb-note">Showing the top {board.players.length} of {board.totalPlayers.toLocaleString()} ranked players.</p>
      )}
    </div>
  );
}

export default function LeaderboardDialog({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<LeaderboardPeriod>("all");
  const leaderboard = useLoad(() => api.leaderboard(period), period);
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
            <h2 id="leaderboard-title" className="text-2xl font-black mt-1">Leaderboard</h2>
            <p className="muted text-sm mt-1">
              {period === "week" ? "XP earned in quiz games over the last 7 days." : "Ranked by total XP from quiz games."}
            </p>
          </div>
          <button ref={closeRef} type="button" className="leaderboard-close secondary" aria-label="Close leaderboard" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div className="lb-tabs" role="group" aria-label="Time period">
          {periods.map((item) => (
            <button key={item.id} type="button" className={period === item.id ? "is-active" : ""} aria-pressed={period === item.id} onClick={() => setPeriod(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        {leaderboard.error && <ErrorBox message={leaderboard.error} retry={leaderboard.reload} />}
        {!leaderboard.data && !leaderboard.error && <Loading />}
        {leaderboard.data && <LeaderboardBody board={leaderboard.data} />}
      </section>
    </div>
  );
}
