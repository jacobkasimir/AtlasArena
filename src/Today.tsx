// Home cards for the daily challenge, the mistake review and achievements, plus the full achievements grid.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "./api";
import type { Achievement, DailyStatus, ReviewSummary } from "./domain";
import { avatars } from "./domain";
import { Meter } from "./setup-ui";

const online = "Available with an online account – not in the local demo.";

export function DailyCard({ status }: { status: DailyStatus | null }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showBoard, setShowBoard] = useState(false);
  async function start() {
    setBusy(true);
    setMessage("");
    try {
      const view = await api.dailyStart();
      navigate(`/play/${view.id}`);
    } catch (cause) {
      setMessage((cause as Error).message.includes("DAILY_NOT_ENOUGH") ? "Not enough published questions for today's challenge yet." : (cause as Error).message);
      setBusy(false);
    }
  }
  const done = status?.state === "completed";
  const playing = status && status.sessionId && !done && status.state !== "abandoned";
  return (
    <article className="today-card is-daily">
      <header>
        <span className="today-icon" aria-hidden="true">📅</span>
        <div>
          <h3>Daily challenge</h3>
          <p>10 questions – the same for everyone today. One try.</p>
        </div>
        {status && status.streak.current > 0 && (
          <span className="today-streak" title={`Best streak: ${status.streak.best} days`}>🔥 {status.streak.current}</span>
        )}
      </header>
      {!status ? <p className="muted text-sm">{online}</p> : !status.available ? (
        <p className="muted text-sm">Not enough published questions for a daily challenge yet.</p>
      ) : done ? (
        <>
          <div className="today-result">
            <div><strong>{status.score?.toLocaleString()}</strong><span>points</span></div>
            <div><strong>{status.correct}/10</strong><span>correct</span></div>
            <div><strong>#{status.rank}</strong><span>of {status.players}</span></div>
          </div>
          <button type="button" className="secondary" aria-expanded={showBoard} onClick={() => setShowBoard((open) => !open)}>
            {showBoard ? "Hide" : "Show"} today's top 10
          </button>
          {showBoard && (
            <ol className="today-board">
              {status.top.map((row) => (
                <li key={row.rank} className={row.isYou ? "is-you" : undefined}>
                  <span>#{row.rank}</span>
                  <span aria-hidden="true">{avatars[row.avatar] ?? "🌍"}</span>
                  <span className="today-board-name">{row.username}{row.isYou ? " (you)" : ""}</span>
                  <strong>{row.score.toLocaleString()}</strong>
                </li>
              ))}
            </ol>
          )}
          <p className="muted text-sm">Come back tomorrow for a new set{status.streak.current ? " and keep your streak going" : ""}.</p>
        </>
      ) : playing ? (
        <Link className="primary" to={`/play/${status.sessionId}`}>Continue today's challenge →</Link>
      ) : (
        <>
          <button type="button" className="primary" disabled={busy} onClick={() => void start()}>{busy ? "Preparing…" : "Play today's challenge"}</button>
          <p className="muted text-sm">{status.players ? `${status.players} ${status.players === 1 ? "player has" : "players have"} played today.` : "Be the first to play today."}</p>
        </>
      )}
      {message && <p className="error text-sm" role="alert">{message}</p>}
    </article>
  );
}

export function ReviewCard({ summary }: { summary: ReviewSummary | null }) {
  return (
    <article className="today-card">
      <header>
        <span className="today-icon" aria-hidden="true">🔁</span>
        <div>
          <h3>Review my mistakes</h3>
          <p>Get them right once and they're cleared for good.</p>
        </div>
      </header>
      {!summary ? <p className="muted text-sm">{online}</p> : summary.open > 0 ? (
        <>
          <div className="today-result">
            <div><strong>{summary.open}</strong><span>open</span></div>
            <div><strong>{summary.cleared}</strong><span>cleared</span></div>
          </div>
          <Link className="primary" to="/review">{summary.activeId ? "Continue review →" : `Review ${Math.min(10, summary.open)} mistakes →`}</Link>
        </>
      ) : (
        <p className="muted text-sm">No open mistakes{summary.cleared ? ` – ${summary.cleared} cleared so far` : ""}. Play a round and come back.</p>
      )}
    </article>
  );
}

export function AchievementsCard({ achievements }: { achievements: Achievement[] | null }) {
  const earned = achievements?.filter((item) => item.earned) ?? [];
  const next = (achievements ?? []).filter((item) => !item.earned)
    .sort((a, b) => b.current / b.target - a.current / a.target).slice(0, 2);
  return (
    <article className="today-card">
      <header>
        <span className="today-icon" aria-hidden="true">🏅</span>
        <div>
          <h3>Achievements</h3>
          <p>{achievements ? `${earned.length} of ${achievements.length} badges earned` : "Badges for milestones in every game."}</p>
        </div>
      </header>
      {!achievements ? <p className="muted text-sm">{online}</p> : (
        <>
          {earned.length > 0 && (
            <p className="today-badges" aria-label="Earned badges">
              {earned.map((item) => <span key={item.id} title={item.title}>{item.icon}</span>)}
            </p>
          )}
          {next.map((item) => (
            <div key={item.id} className="today-next">
              <span aria-hidden="true">{item.icon}</span>
              <div>
                <strong>{item.title}</strong>
                <Meter done={item.current} total={item.target} label={`${item.current} of ${item.target}`} />
              </div>
              <small>{item.current}/{item.target}</small>
            </div>
          ))}
          <Link className="text-link" to="/profile#achievements">All badges →</Link>
        </>
      )}
    </article>
  );
}

export function AchievementsGrid({ achievements }: { achievements: Achievement[] }) {
  return (
    <ul className="achievements-grid">
      {achievements.map((item) => (
        <li key={item.id} className={item.earned ? "is-earned" : undefined}>
          <span className="achievement-icon" aria-hidden="true">{item.icon}</span>
          <strong>{item.title}</strong>
          <p>{item.description}</p>
          {item.earned ? <span className="achievement-done">Earned</span> : (
            <>
              <Meter done={item.current} total={item.target} label={`${item.current} of ${item.target}`} />
              <small>{item.current} / {item.target}</small>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
