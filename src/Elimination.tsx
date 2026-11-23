// Category Elimination: name places that fit a growing chain of clues until one place is left in each colour group.
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { DEMO_UNAVAILABLE, api, isDemo } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import type { EliminationDifficulty, EliminationGroup, EliminationGuess, EliminationPuzzle, EliminationView } from "./domain";
import { TimeLeft, formatClock, useTimeLeft } from "./game-setup";
import { Icon, IconTile } from "./icons";
import { Meter } from "./setup-ui";

const requestId = () => crypto.randomUUID();
export const difficulties: { id: EliminationDifficulty; label: string; text: string }[] = [
  { id: "easy", label: "Easy", text: "UN member states · 4 clues per group · well-known countries · 5 minutes" },
  { id: "medium", label: "Medium", text: "UN member states · 5 clues · memberships, languages and borders · 5 minutes" },
  { id: "hard", label: "Hard", text: "Countries and territories · 5 clues · subregions and density · 4 minutes" },
];
const colourNames = { green: "Green", orange: "Orange", blue: "Blue", purple: "Purple" } as const;
const flag = (code: string) => `/flags/${code.toLowerCase()}.svg`;

function Place({ code, name }: { code: string; name: string }) {
  return (
    <span className="elim-place">
      <img src={flag(code)} alt="" width={22} height={16} loading="lazy" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
      {name}
    </span>
  );
}

function HowItWorks() {
  return (
    <ol className="elim-how">
      <li><span><strong>Name any place that fits the first clue</strong> of a group – that reveals the next clue.</span></li>
      <li><span><strong>Every new answer must fit all clues shown so far</strong> in that group. One answer can move several groups.</span></li>
      <li><span><strong>The number beside a clue</strong> is how many places still fit. The last clue leaves exactly one.</span></li>
      <li><span><strong>Type in English, German or French</strong> and press Enter. Wrong guesses cost nothing but time.</span></li>
    </ol>
  );
}

function Setup() {
  const navigate = useNavigate();
  const catalog = useLoad(() => api.elimCatalog());
  const [difficulty, setDifficulty] = useState<EliminationDifficulty>(() => {
    try { return (localStorage.getItem("elim-difficulty") as EliminationDifficulty) || "easy"; } catch { return "easy"; }
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { try { localStorage.setItem("elim-difficulty", difficulty); } catch { /* storage unavailable */ } }, [difficulty]);

  async function start(puzzle: EliminationPuzzle) {
    if (puzzle.activeId) return navigate(`/elimination/play/${puzzle.activeId}`);
    setBusy(puzzle.id); setError("");
    try { const view = await api.elimStart(puzzle.id, requestId()); navigate(`/elimination/play/${view.id}`); }
    catch (cause) { setError((cause as Error).message); setBusy(null); }
  }

  const online = !isDemo && !catalog.error?.startsWith(DEMO_UNAVAILABLE);
  const puzzles = (catalog.data ?? []).filter((puzzle) => puzzle.difficulty === difficulty);
  const perfect = (catalog.data ?? []).filter((puzzle) => puzzle.best && puzzle.best.solved === puzzle.total).length;
  return (
    <div className="mode-shell">
      <header className="mode-hero">
        <p className="eyebrow">Atlas Elimination</p>
        <h1 className="heading mt-2" tabIndex={-1}>One clue at a time.</h1>
        <p className="muted mt-3 max-w-2xl">
          Four colour groups, each a chain of clues. Every place you name must fit all clues revealed so far –
          until a single place is left. Inspired by JetPunk's “Category Elimination”.
        </p>
      </header>
      <div className="mode-setup-grid">
        <div className="card mode-setup">
          <fieldset className="mode-step">
            <legend><span className="mode-step-number">1</span> Choose a difficulty</legend>
            <div className="elim-difficulties" role="group" aria-label="Difficulty">
              {difficulties.map((item) => {
                const all = (catalog.data ?? []).filter((puzzle) => puzzle.difficulty === item.id);
                const done = all.filter((puzzle) => puzzle.best && puzzle.best.solved === puzzle.total).length;
                return (
                  <button key={item.id} type="button" className={`elim-difficulty is-${item.id}`} aria-pressed={difficulty === item.id} onClick={() => setDifficulty(item.id)}>
                    <span className="elim-difficulty-head"><strong>{item.label}</strong>{all.length > 0 && <small>{done}/{all.length} perfect</small>}</span>
                    <span className="elim-difficulty-text">{item.text}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset className="mode-step">
            <legend><span className="mode-step-number">2</span> Pick a puzzle</legend>
            {!online ? (
              <p className="muted">Category Elimination needs an online account – the clues are checked on the server so answers never reach your browser.</p>
            ) : catalog.error ? <ErrorBox message={catalog.error} retry={catalog.reload} />
              : !catalog.data ? <Loading /> : (
                <ul className="elim-puzzles">
                  {puzzles.map((puzzle) => {
                    const perfectRun = puzzle.best && puzzle.best.solved === puzzle.total;
                    return (
                      <li key={puzzle.id}>
                        <button type="button" className={`elim-puzzle${perfectRun ? " is-perfect" : ""}`} disabled={busy !== null} onClick={() => void start(puzzle)}>
                          <span className="elim-puzzle-number">#{puzzle.number}</span>
                          <span className="elim-puzzle-dots" aria-hidden="true">
                            {(["green", "orange", "blue", "purple"] as const).slice(0, puzzle.groups).map((colour) => <span key={colour} className={`dot-${colour}`} />)}
                          </span>
                          <span className="elim-puzzle-meta">{puzzle.total} answers · {formatClock(puzzle.timeLimitSeconds * 1000)}</span>
                          {puzzle.best ? (
                            <span className="elim-puzzle-best">
                              {perfectRun && <Icon name="check" size={14} />} Best {puzzle.best.solved}/{puzzle.total}
                              {perfectRun ? ` · ${formatClock(puzzle.best.elapsedMs)}` : ""}
                            </span>
                          ) : <span className="elim-puzzle-best muted">Not played yet</span>}
                          <span className="elim-puzzle-action">{busy === puzzle.id ? "Starting…" : puzzle.activeId ? "Continue →" : puzzle.best ? "Play again" : "Play"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            {error && <p className="error mt-3" role="alert">{error}</p>}
          </fieldset>
        </div>
        <aside className="mode-side">
          <section className="card">
            <h2 className="font-bold flex items-center gap-2"><IconTile name="funnel" tone="elimination" size="sm" /> How it works</h2>
            <HowItWorks />
          </section>
          {online && catalog.data && (
            <section className="card">
              <h2 className="font-bold">Your progress</h2>
              <p className="muted text-sm mt-1">{perfect} of {catalog.data.length} puzzles solved perfectly</p>
              <div className="elim-side-meter"><Meter done={perfect} total={catalog.data.length} label={`${perfect} of ${catalog.data.length} perfect`} /></div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function GroupCard({ group, done }: { group: EliminationGroup; done: boolean }) {
  const complete = group.solved >= group.size;
  const hidden = Math.max(0, group.size - group.steps.length);
  return (
    <section className={`elim-group colour-${group.colour}${complete ? " is-complete" : ""}`} aria-label={`${colourNames[group.colour]} group`}>
      <header>
        <strong>{colourNames[group.colour]}</strong>
        <span>{group.solved}/{group.size}</span>
      </header>
      <ol>
        {group.steps.map((step, index) => {
          const current = !done && !step.answer && index === group.solved;
          const missed = done && !step.answer;
          return (
            <li key={index} className={`${current ? "is-current" : ""}${missed ? " is-missed" : ""}${step.answer ? " is-answered" : ""}`}>
              <span className="elim-count" title={`${step.remaining} ${step.remaining === 1 ? "place fits" : "places fit"} up to here`}>{step.remaining}</span>
              <span className="elim-clue">{step.label}</span>
              <span className="elim-answer">
                {step.answer ? <Place {...step.answer} /> : current ? <span className="elim-waiting">Your answer…</span> : missed ? <span className="muted">—</span> : null}
              </span>
            </li>
          );
        })}
        {Array.from({ length: hidden }, (_, index) => (
          <li key={`hidden-${index}`} className="is-locked">
            <span className="elim-count"><Icon name="lock" size={12} /></span>
            <span className="elim-clue muted">Clue {group.steps.length + index + 1}</span>
          </li>
        ))}
      </ol>
      {done && group.answer && (
        <p className="elim-solution">{complete ? <Icon name="checkCircle" size={16} /> : <Icon name="target" size={16} />} {complete ? "Solved:" : "Answer:"} <Place {...group.answer} /></p>
      )}
    </section>
  );
}

function feedbackText(guess: EliminationGuess | null, typed: string) {
  if (!guess) return null;
  const colours = (guess.advanced ?? []).map((colour) => colourNames[colour]);
  switch (guess.result) {
    case "advanced": return { tone: "ok", text: `${guess.place?.name} fits ${colours.join(" and ")}${colours.length > 1 ? " – several groups moved on" : ""}.` };
    case "no_match": return { tone: "bad", text: `${guess.place?.name} doesn't fit any open clue.` };
    case "unknown": return { tone: "bad", text: `“${typed}” isn't a place in this puzzle.` };
    case "ambiguous": return { tone: "bad", text: `“${typed}” could mean more than one place – be more specific.` };
    default: return null;
  }
}

function Play() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const initial = useLoad(() => api.elimView(id), id);
  const [view, setView] = useState<EliminationView | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: string; text: string } | null>(null);
  const [error, setError] = useState("");
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (initial.data) setView(initial.data); }, [initial.data]);
  const current = view ?? initial.data ?? null;
  const left = useTimeLeft(current?.state === "active" ? current.deadlineAt : null, current?.serverNow);
  const done = current ? current.state !== "active" : false;

  // When the clock runs out, ask the server to close the round.
  useEffect(() => {
    if (!current || done || left === null || left > 0) return;
    api.elimView(current.id).then(setView).catch(() => undefined);
  }, [left, done, current]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const typed = text.trim();
    if (!current || !typed || busy) return;
    setBusy(true); setError("");
    try {
      const guess = await api.elimGuess(current.id, typed);
      setView(guess.view);
      setFeedback(feedbackText(guess, typed));
      if (guess.result === "advanced" || guess.result === "no_match") setText("");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); inputRef.current?.focus(); }
  }

  async function giveUp() {
    if (!current) return;
    setBusy(true);
    try { setView(await api.elimGiveUp(current.id)); setConfirmGiveUp(false); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  if (initial.error) return <div className="mode-shell"><ErrorBox message={initial.error} retry={initial.reload} /><Link className="text-link mt-4" to="/elimination">← All puzzles</Link></div>;
  if (!current) return <Loading />;
  const label = `${difficulties.find((item) => item.id === current.difficulty)?.label} #${current.number}`;

  return (
    <div className="elim-shell">
      <header className="elim-top">
        <div>
          <p className="eyebrow">Elimination · {label}</p>
          <h1 className="text-2xl font-black mt-1" tabIndex={-1}>{done ? resultTitle(current) : "Name places that fit every clue"}</h1>
          <p className="muted text-sm mt-1">{current.pool === "un" ? "UN member states only" : "Countries and territories"} · English, German or French</p>
        </div>
        <div className="elim-status">
          <div className="elim-progress">
            <strong>{current.solved}</strong><span>/ {current.total}</span>
            <Meter done={current.solved} total={current.total} label={`${current.solved} of ${current.total} answers`} />
          </div>
          {!done && left !== null && <TimeLeft ms={left} />}
        </div>
      </header>

      {!done ? (
        <form className="elim-input" onSubmit={(event) => void submit(event)}>
          <label htmlFor="elim-guess" className="sr-only">Name a country or territory</label>
          <input id="elim-guess" ref={inputRef} autoFocus autoComplete="off" autoCapitalize="words" spellCheck={false}
            placeholder="Type a country and press Enter" value={text} maxLength={80} onChange={(event) => setText(event.target.value)} />
          <button className="primary" disabled={busy || !text.trim()}>{busy ? "…" : "Enter"}</button>
        </form>
      ) : (
        <ResultBanner view={current} onAgain={() => navigate("/elimination")} />
      )}
      <p className={`elim-feedback ${feedback?.tone === "ok" ? "is-ok" : feedback ? "is-bad" : ""}`} role="status" aria-live="polite">
        {!done && feedback ? feedback.text : ""}
      </p>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="elim-groups">
        {current.groups.map((group) => <GroupCard key={group.colour} group={group} done={done} />)}
      </div>

      {!done && (
        <div className="elim-footer">
          <span className="muted text-sm">{current.guesses} guesses · {current.wrong} didn't fit</span>
          {confirmGiveUp ? (
            <span className="elim-confirm">
              Reveal all answers and end the round?
              <button type="button" className="secondary" onClick={() => setConfirmGiveUp(false)}>Keep playing</button>
              <button type="button" className="danger-button" disabled={busy} onClick={() => void giveUp()}>Give up</button>
            </span>
          ) : <button type="button" className="secondary" onClick={() => setConfirmGiveUp(true)}>Give up</button>}
        </div>
      )}
    </div>
  );
}

function resultTitle(view: EliminationView) {
  if (view.endReason === "all_solved") return "Every chain solved!";
  if (view.endReason === "time_up") return "Time's up.";
  return "Round over.";
}

function ResultBanner({ view, onAgain }: { view: EliminationView; onAgain: () => void }) {
  const catalog = useLoad(() => api.elimCatalog(), view.id);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const next = useMemo(() => {
    const list = catalog.data ?? [];
    const index = list.findIndex((puzzle) => puzzle.id === view.puzzleId);
    return index >= 0 ? list[index + 1] ?? null : null;
  }, [catalog.data, view.puzzleId]);
  const best = catalog.data?.find((puzzle) => puzzle.id === view.puzzleId)?.best;
  const percent = Math.round((view.solved / view.total) * 100);
  async function play(puzzleId: string) {
    setBusy(true);
    try { const started = await api.elimStart(puzzleId, requestId()); navigate(`/elimination/play/${started.id}`); }
    catch { setBusy(false); }
  }
  return (
    <section className={`elim-result ${view.endReason === "all_solved" ? "is-perfect" : ""}`}>
      <div className="elim-result-score">
        <strong>{percent}%</strong>
        <span>{view.solved} of {view.total} answers</span>
      </div>
      <dl>
        <div><dt>Time</dt><dd>{formatClock(Math.min(view.elapsedMs, view.timeLimitSeconds * 1000))}</dd></div>
        <div><dt>Guesses</dt><dd>{view.guesses}</dd></div>
        <div><dt>Didn't fit</dt><dd>{view.wrong}</dd></div>
        {best && <div><dt>Your best</dt><dd>{best.solved}/{view.total}</dd></div>}
      </dl>
      <div className="elim-result-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void play(view.puzzleId)}>Play again</button>
        {next && <button type="button" className="secondary" disabled={busy} onClick={() => void play(next.id)}>Next puzzle →</button>}
        <button type="button" className="secondary" onClick={onAgain}>All puzzles</button>
      </div>
    </section>
  );
}

export default function Elimination() {
  return (
    <Routes>
      <Route index element={<Setup />} />
      <Route path="play/:id" element={<Play />} />
    </Routes>
  );
}
