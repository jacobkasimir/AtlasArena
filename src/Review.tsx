// Review my mistakes: up to ten questions, flags and capitals you got wrong, one at a time.
// A correct answer clears the mistake for good; a wrong one keeps it on your list.
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { api } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import type { ReviewItem, ReviewSession, ReviewSummary } from "./domain";
import { haptic } from "./prefs";

const requestId = () => crypto.randomUUID();
const kindLabel: Record<ReviewItem["kind"], string> = { quiz: "Quiz question", flag: "Flag", capital: "Capital" };

export function friendlyReviewError(message: string) {
  if (message.includes("NO_MISTAKES_TO_REVIEW")) return "Nothing to review – you have no open mistakes. Nice!";
  if (message.includes("ONLINE_ONLY")) return message.replace(/^.*ONLINE_ONLY:\s*/, "");
  if (message.includes("RATE_LIMIT")) return "Slow down a little – try again in a minute.";
  return message;
}

function Start() {
  const { data, error, reload } = useLoad<ReviewSummary>(() => api.reviewSummary());
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (data?.activeId) navigate(`/review/${data.activeId}`, { replace: true });
  }, [data, navigate]);
  if (error) return <div className="mode-shell"><ErrorBox message={friendlyReviewError(error)} retry={reload} /></div>;
  if (!data) return <Loading />;
  async function start() {
    setBusy(true);
    setMessage("");
    try {
      const session = await api.reviewStart(requestId());
      navigate(`/review/${session.id}`);
    } catch (cause) {
      setMessage(friendlyReviewError((cause as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mode-shell review-shell">
      <header className="mode-hero">
        <p className="eyebrow">Review my mistakes</p>
        <h1 className="heading mt-2" tabIndex={-1}>Turn mistakes into points.</h1>
        <p className="muted mt-3 max-w-2xl">
          Everything you got wrong in Quiz, Flags, Capitals and Recall lands here. Answer it right once and it's cleared for good.
        </p>
      </header>
      <section className="card review-start">
        <div className="review-counts">
          <div><strong>{data.open}</strong><span>open mistakes</span></div>
          <div><strong>{data.byKind.quiz ?? 0}</strong><span>quiz questions</span></div>
          <div><strong>{data.byKind.flag ?? 0}</strong><span>flags &amp; countries</span></div>
          <div><strong>{data.byKind.capital ?? 0}</strong><span>capitals</span></div>
          <div><strong>{data.cleared}</strong><span>cleared so far</span></div>
        </div>
        {data.open > 0 ? (
          <button type="button" className="primary start-button mt-5" disabled={busy} onClick={() => void start()}>
            {busy ? "Preparing…" : `Review ${Math.min(10, data.open)} mistakes`}
          </button>
        ) : (
          <p className="muted mt-5">No open mistakes right now – play a round and come back.</p>
        )}
        {message && <p className="error mt-3" role="alert">{message}</p>}
      </section>
    </div>
  );
}

function ItemCard({ session, item, onAnswered }: { session: ReviewSession; item: ReviewItem; onAnswered: (next: ReviewSession) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [flagBroken, setFlagBroken] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(""); setMessage(""); setFlagBroken(false); if (!item.answered) inputRef.current?.focus(); }, [item.position, item.answered]);

  async function answer(value: string) {
    if (!value.trim() || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const next = await api.reviewAnswer(session.id, item.position, value);
      const result = next.items.find((entry) => entry.position === item.position);
      haptic(result?.correct ? "correct" : "wrong");
      onAnswered(next);
    } catch (cause) {
      setMessage(friendlyReviewError((cause as Error).message));
    } finally {
      setBusy(false);
    }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); void answer(text); };
  const flag = item.alpha2 && !flagBroken ? `/flags/${item.alpha2.toLowerCase()}.svg` : item.flagSvgUrl;

  return (
    <section className={`card review-item ${item.answered ? (item.correct ? "is-correct" : "is-wrong") : ""}`}>
      <p className="eyebrow">{kindLabel[item.kind]}{item.difficulty ? ` · ${item.difficulty}` : ""}</p>
      {item.kind === "flag" && flag && (
        <img className="review-flag" src={flag} alt="Flag to identify" onError={() => setFlagBroken(true)} />
      )}
      {item.kind === "capital" && item.alpha2 && (
        <img className="review-flag is-small" src={`/flags/${item.alpha2.toLowerCase()}.svg`} alt="" />
      )}
      <h1 className="review-prompt" tabIndex={-1}>{item.prompt}</h1>

      {item.kind === "quiz" ? (
        <div className="answer-grid grid gap-3 sm:grid-cols-2 mt-5">
          {(item.options ?? []).map((option, index) => (
            <button key={option.id} type="button" disabled={busy || item.answered}
              className={`answer text-left ${item.answered ? option.id === item.correctOption ? "is-correct" : option.id === item.answer ? "is-wrong" : "is-dimmed" : ""}`}
              onClick={() => void answer(option.id)}>
              <span className="keycap" aria-hidden="true">{index + 1}</span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <form className="review-answer" onSubmit={submit}>
          <label className="sr-only" htmlFor="review-input">Your answer</label>
          <input id="review-input" ref={inputRef} value={item.answered ? item.answer ?? "" : text} disabled={busy || item.answered}
            onChange={(event) => setText(event.target.value)} autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="go"
            placeholder={item.kind === "flag" ? "Type the country" : "Type the capital"} />
          {!item.answered && <button className="primary" disabled={busy || !text.trim()}>{busy ? "Checking…" : "Check"}</button>}
        </form>
      )}
      {!item.answered && item.kind !== "quiz" && <p className="muted text-sm mt-2">English, German or French – accents don't matter.</p>}
      {item.answered && (
        <div className={`review-feedback ${item.correct ? "is-correct" : "is-wrong"}`} role="status">
          <strong>{item.correct ? "Cleared – it won't come back." : "Not yet – it stays on your list."}</strong>
          {item.solution && <p>Answer: <b>{item.solution}</b></p>}
          {item.explanation && <p className="muted">{item.explanation}</p>}
        </div>
      )}
      {message && <p className="error mt-3" role="alert">{message}</p>}
    </section>
  );
}

function Play() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, error, reload } = useLoad<ReviewSession>(() => api.reviewView(id), id);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!data) return;
    setSession(data);
    setPosition((current) => current ?? data.items.find((item) => !item.answered)?.position ?? null);
  }, [data]);

  if (error) return <div className="mode-shell"><ErrorBox message={friendlyReviewError(error)} retry={reload} /></div>;
  if (!session) return <Loading />;
  const item = session.items.find((entry) => entry.position === position);
  const nextOpen = session.items.find((entry) => !entry.answered && entry.position !== position);

  async function more() {
    setBusy(true);
    setMessage("");
    try {
      const next = await api.reviewStart(requestId());
      setSession(null);
      setPosition(null);
      navigate(`/review/${next.id}`);
    } catch (cause) {
      setMessage(friendlyReviewError((cause as Error).message));
    } finally {
      setBusy(false);
    }
  }

  if (!item) {
    return (
      <div className="mode-shell review-shell">
        <section className="card review-done">
          <p className="eyebrow">Review complete</p>
          <h1 className="heading mt-2" tabIndex={-1}>{session.correct} of {session.total} cleared</h1>
          <p className="muted mt-2">
            {session.correct === session.total ? "Every single one – well done!" : "The ones you missed stay on your list for next time."}
          </p>
          <ul className="review-recap">
            {session.items.map((entry) => (
              <li key={entry.position} className={entry.correct ? "is-correct" : "is-wrong"}>
                <span aria-hidden="true">{entry.correct ? "✓" : "×"}</span>
                <span>{entry.kind === "quiz" ? entry.prompt : entry.solution}</span>
              </li>
            ))}
          </ul>
          <div className="review-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void more()}>{busy ? "Preparing…" : "Review more"}</button>
            <Link className="secondary" to="/home">Back to Home</Link>
          </div>
          {message && <p className="muted mt-3" role="status">{message}</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="mode-shell review-shell">
      <header className="review-head">
        <div>
          <p className="eyebrow">Review my mistakes</p>
          <p className="muted">{item.position} of {session.total} · {session.correct} cleared</p>
        </div>
        <Link className="text-button" to="/home">Leave – progress is saved</Link>
      </header>
      <div className="game-progress" role="progressbar" aria-label="Review progress" aria-valuemin={0} aria-valuemax={session.total} aria-valuenow={session.answered}>
        <span style={{ width: `${(session.answered / session.total) * 100}%` }} />
      </div>
      <ItemCard session={session} item={item} onAnswered={setSession} />
      {item.answered && (
        <button type="button" className="primary review-next" autoFocus onClick={() => setPosition(nextOpen?.position ?? -1)}>
          {nextOpen ? "Next →" : "See summary →"}
        </button>
      )}
    </div>
  );
}

export default function Review() {
  return (
    <Routes>
      <Route index element={<Start />} />
      <Route path=":id" element={<Play />} />
    </Routes>
  );
}
