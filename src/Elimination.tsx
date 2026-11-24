// Category Elimination: name places that fit a growing chain of clues until one place is left in each colour group.
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { DEMO_UNAVAILABLE, api, isDemo } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import { ConfirmDialog } from "./ConfirmDialog";
import type {
  EliminationCandidates,
  EliminationDifficulty,
  EliminationGroup,
  EliminationGuess,
  EliminationHint,
  EliminationPuzzle,
  EliminationView,
} from "./domain";
import { CandidatesSheet } from "./EliminationCandidates";
import { DEFAULT_HINT_LIMIT, HintAvailability, hintAvailability, hintErrorText } from "./elimination-domain";
import { TimeLeft, formatClock, useTimeLeft } from "./game-setup";
import { Icon, IconTile } from "./icons";
import { usePrefs, useLeaveGuard } from "./prefs";
import { Meter } from "./setup-ui";
import { cue } from "./sound";

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
      <li><span><strong>The number beside a clue</strong> is how many places still fit. The last clue leaves exactly one. After the round, select it to see every place that fit.</span></li>
      <li><span><strong>Type in English, German or French</strong> and press Enter. Wrong guesses cost nothing but time.</span></li>
      <li><span><strong>Stuck? Use a hint</strong> ({DEFAULT_HINT_LIMIT} per round): it lists every place that fits a group's open clue. There is no hint for a clue that leaves a single place, and a round with a hint never counts as your personal best.</span></li>
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

type GroupHint = { availability: HintAvailability; left: number; busy: boolean; onHint: () => void };

function HintButton({ colour, hint }: { colour: string; hint: GroupHint }) {
  const { availability, left, busy, onHint } = hint;
  if (availability === "closed") return null;
  if (availability === "lastClue") {
    return <p className="elim-hint-row muted">No hint for a clue that leaves one place.</p>;
  }
  const owned = availability === "owned";
  const label = owned ? "Show hint" : availability === "noneLeft" ? "No hints left" : `Hint (${left} left)`;
  return (
    <div className="elim-hint-row">
      <button
        type="button"
        className={`elim-hint-button${owned ? " is-owned" : ""}`}
        disabled={busy || availability === "noneLeft"}
        aria-haspopup="dialog"
        aria-label={owned ? `Show the ${colour} hint again (free)` : availability === "noneLeft" ? `No hints left for ${colour}` : `Use a hint for ${colour}, ${left} left`}
        onClick={onHint}
      >
        <Icon name="search" size={14} /> {label}
      </button>
    </div>
  );
}

function GroupCard({
  group,
  done,
  hint,
  onShowCandidates,
}: {
  group: EliminationGroup;
  done: boolean;
  /** Only passed while the round is active: the group's hint button. */
  hint?: GroupHint;
  /** Only passed once the round is over: opens the full list for a 1-based clue step. */
  onShowCandidates?: (step: number) => void;
}) {
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
              {onShowCandidates ? (
                <button
                  type="button"
                  className="elim-count is-button"
                  aria-haspopup="dialog"
                  aria-label={`Show every place that fit up to clue ${index + 1} (${step.remaining})`}
                  title="Show every place that fit"
                  onClick={() => onShowCandidates(index + 1)}
                >
                  {step.remaining}
                </button>
              ) : (
                <span className="elim-count" title={`${step.remaining} ${step.remaining === 1 ? "place fits" : "places fit"} up to here`}>
                  {step.remaining}
                </span>
              )}
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
      {hint && <HintButton colour={colourNames[group.colour]} hint={hint} />}
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
  // Open candidate sheet: 1-based group and clue step. Lists are fetched once per group and kept.
  const [sheet, setSheet] = useState<{ group: number; step: number } | null>(null);
  const candidateCache = useRef(new Map<number, Promise<EliminationCandidates>>());
  // Hints: the group (1-based) whose hint waits for confirmation, the open hint sheet, and bought hints by "group:step".
  const [hintAsk, setHintAsk] = useState<number | null>(null);
  const [hintSheet, setHintSheet] = useState<{ group: number; step: number } | null>(null);
  const hintCache = useRef(new Map<string, Promise<EliminationHint>>());
  const inputRef = useRef<HTMLInputElement>(null);
  const keepPlayingRef = useRef<HTMLButtonElement>(null);
  const prefs = usePrefs();
  useEffect(() => { if (initial.data) setView(initial.data); }, [initial.data]);
  const current = view ?? initial.data ?? null;
  const left = useTimeLeft(current?.state === "active" ? current.deadlineAt : null, current?.serverNow);
  const done = current ? current.state !== "active" : false;
  useLeaveGuard(Boolean(current && !done));

  // When the clock runs out, ask the server to close the round – once, then every 2 s until it has
  // (re-running on every new view would send a request storm if this device's clock is ahead).
  const roundId = current?.id;
  const timeUp = !done && left === 0;
  useEffect(() => {
    if (!roundId || !timeUp) return;
    const check = () => void api.elimView(roundId).then(setView).catch(() => undefined);
    check();
    const retry = window.setInterval(check, 2000);
    return () => window.clearInterval(retry);
  }, [roundId, timeUp]);

  // The give-up question replaces the button that asked it: move focus to the safe answer.
  useEffect(() => {
    if (confirmGiveUp) keepPlayingRef.current?.focus();
  }, [confirmGiveUp]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const typed = text.trim();
    if (!current || !typed || busy) return;
    setBusy(true); setError("");
    try {
      const guess = await api.elimGuess(current.id, typed);
      setView(guess.view);
      setFeedback(feedbackText(guess, typed));
      if (guess.view.state !== "active") cue("complete");
      else if (guess.result === "advanced") cue("correct");
      else if (guess.result === "no_match" || guess.result === "unknown") cue("wrong");
      if (guess.result === "advanced" || guess.result === "no_match") setText("");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); inputRef.current?.focus(); }
  }

  async function giveUp() {
    if (!current || busy) return;
    setBusy(true);
    try { setView(await api.elimGiveUp(current.id)); setConfirmGiveUp(false); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  function loadCandidates(group: number) {
    const cached = candidateCache.current.get(group);
    if (cached) return cached;
    const request = api.elimCandidates(id, group);
    candidateCache.current.set(group, request);
    request.catch(() => candidateCache.current.delete(group));
    return request;
  }

  /** A bought hint: from this page's cache, or again from the server (free, nothing is spent twice). */
  function loadHint(group: number, step: number) {
    const key = `${group}:${step}`;
    const cached = hintCache.current.get(key);
    if (cached) return cached;
    const request = api.elimHint(id, group);
    hintCache.current.set(key, request);
    request.then((hint) => setView(hint.view)).catch(() => hintCache.current.delete(key));
    return request;
  }

  function askHint(groupIndex: number) {
    if (!current || busy) return;
    const availability = hintAvailability(current, groupIndex);
    const group = groupIndex + 1;
    if (availability === "owned") setHintSheet({ group, step: current.groups[groupIndex].solved + 1 });
    else if (availability === "available") setHintAsk(group);
  }

  async function spendHint() {
    if (!current || hintAsk === null || busy) return;
    const group = hintAsk;
    setBusy(true); setError("");
    try {
      const hint = await api.elimHint(current.id, group);
      hintCache.current.set(`${group}:${hint.step}`, Promise.resolve(hint));
      setView(hint.view);
      setHintAsk(null);
      setHintSheet({ group, step: hint.step });
    } catch (cause) {
      const message = (cause as Error).message;
      setHintAsk(null);
      setError(hintErrorText(message));
      if (message.includes("ELIMINATION_ROUND_OVER")) void api.elimView(current.id).then(setView).catch(() => undefined);
    } finally { setBusy(false); }
  }

  function keepPlaying() {
    setConfirmGiveUp(false);
    inputRef.current?.focus();
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
          <p className="muted text-sm mt-1">
            {current.pool === "un" ? "UN member states only" : "Countries and territories"} · English, German or French
            {current.hinted && <span className="elim-hinted-badge" title="This round doesn't count for personal bests">Hinted</span>}
          </p>
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
            placeholder="Type a country and press Enter" value={text} maxLength={80} onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape" && text) { event.preventDefault(); setText(""); } }} />
          <button className="primary" disabled={busy || !text.trim()}>{busy ? "…" : "Enter"}</button>
        </form>
      ) : (
        <ResultBanner view={current} onAgain={() => navigate("/elimination")} />
      )}
      <p className={`elim-feedback ${feedback?.tone === "ok" ? "is-ok" : feedback ? "is-bad" : ""}`} role="status" aria-live="polite">
        {!done && feedback ? feedback.text : ""}
      </p>
      {error && <p className="error" role="alert">{error}</p>}

      {done && (
        <p className="elim-cands-hint">
          <Icon name="search" size={16} /> Select a number beside a clue to see every place that fit.
        </p>
      )}
      <div className="elim-groups">
        {current.groups.map((group, index) => (
          <GroupCard
            key={group.colour}
            group={group}
            done={done}
            onShowCandidates={done ? (step) => setSheet({ group: index + 1, step }) : undefined}
            hint={done ? undefined : {
              availability: hintAvailability(current, index),
              left: current.hintsLeft,
              busy,
              onHint: () => askHint(index),
            }}
          />
        ))}
      </div>
      {hintAsk !== null && current.groups[hintAsk - 1] && (
        <ConfirmDialog
          id="elim-hint-confirm"
          title="Use a hint?"
          confirmLabel="Use a hint"
          cancelLabel="Keep playing"
          busy={busy}
          onConfirm={() => void spendHint()}
          onCancel={() => setHintAsk(null)}
        >
          {current.hintsLeft} {current.hintsLeft === 1 ? "hint" : "hints"} left – this uses one. You'll see every place that fits
          the open {colourNames[current.groups[hintAsk - 1].colour]} clue.{" "}
          {current.hinted ? "This round already doesn't count for personal bests." : "This round will no longer count for personal bests."}
        </ConfirmDialog>
      )}
      {hintSheet && !done && current.groups[hintSheet.group - 1] && (
        <CandidatesSheet
          key={`hint-${hintSheet.group}-${hintSheet.step}`}
          variant="hint"
          group={hintSheet.group}
          colour={current.groups[hintSheet.group - 1].colour}
          load={(group) => loadHint(group, hintSheet.step)}
          onClose={() => setHintSheet(null)}
        />
      )}
      {sheet && current.groups[sheet.group - 1] && (
        <CandidatesSheet
          key={sheet.group}
          group={sheet.group}
          colour={current.groups[sheet.group - 1].colour}
          initialStep={sheet.step}
          load={loadCandidates}
          onClose={() => setSheet(null)}
        />
      )}

      {!done && (
        <div className="elim-footer">
          <span className="muted text-sm">{current.guesses} guesses · {current.wrong} didn't fit</span>
          {confirmGiveUp ? (
            <span
              className="elim-confirm"
              role="group"
              aria-label="Give up?"
              onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); keepPlaying(); } }}
            >
              Reveal all answers and end the round?
              <button ref={keepPlayingRef} type="button" className="secondary" onClick={keepPlaying}>Keep playing</button>
              <button type="button" className="danger-button" disabled={busy} onClick={() => void giveUp()}>Give up</button>
            </span>
          ) : (
            <button type="button" className="secondary" disabled={busy}
              onClick={() => (prefs.confirmGiveUp ? setConfirmGiveUp(true) : void giveUp())}>
              Give up
            </button>
          )}
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
        {view.hinted && <div><dt>Hints</dt><dd>{view.hintsUsed}</dd></div>}
      </dl>
      {view.hinted && (
        <p className="elim-hinted-note">
          <span className="elim-hinted-badge">Hinted</span> This round used {view.hintsUsed === 1 ? "a hint" : `${view.hintsUsed} hints`}, so it doesn't count as a personal best.
        </p>
      )}
      <div className="elim-result-actions">
        <button type="button" className="primary" autoFocus disabled={busy} onClick={() => void play(view.puzzleId)}>Play again</button>
        {next && <button type="button" className="secondary" disabled={busy} onClick={() => void play(next.id)}>Next puzzle →</button>}
        <button type="button" className="secondary" onClick={onAgain}>All puzzles</button>
      </div>
    </section>
  );
}

/** "Play again" and "Next puzzle" stay on this route: a fresh Play per round id drops the old round's state. */
function PlayRound() {
  const { id = "" } = useParams();
  return <Play key={id} />;
}

export default function Elimination() {
  return (
    <Routes>
      <Route index element={<Setup />} />
      <Route path="play/:id" element={<PlayRound />} />
    </Routes>
  );
}
