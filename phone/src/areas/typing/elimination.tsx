// Phone Elimination (/elimination/*): difficulty + puzzle list → play (four colour groups of clue chains, typed
// guesses checked on the server) → results with every place behind each count in a bottom sheet.
// Online only: in the demo every api.elim* call rejects with ONLINE_ONLY and the setup says so.
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Route, Routes, useNavigate, useParams } from "react-router-dom";
import { DEMO_UNAVAILABLE, api, isDemo } from "@shared/api";
import { useLoad } from "@shared/components";
import type {
  EliminationCandidates,
  EliminationDifficulty,
  EliminationGroup,
  EliminationGuess,
  EliminationHint,
  EliminationPlace,
  EliminationPuzzle,
  EliminationView,
} from "@shared/domain";
import {
  ELIMINATION_DIFFICULTIES,
  HintAvailability,
  eliminationDifficultyLabel,
  eliminationHowItWorks,
  hintAvailability,
  hintErrorText,
} from "@shared/elimination-domain";
import { formatClock } from "@shared/game-setup";
import { Icon } from "@shared/icons";
import { CALM_ROUND_MS, useLeaveGuard, usePrefs } from "@shared/prefs";
import { TopBarActions, usePhoneChrome } from "@phone/shell/chrome";
import { paths } from "@phone/shell/paths";
import {
  ActionBar,
  BottomSheet,
  Burst,
  Button,
  Card,
  Chip,
  ChipGroup,
  GameButton,
  LinkButton,
  LinkCard,
  LoadingState,
  ModeHero,
  ProgressBar,
  ResultHero,
  Section,
  StatusMessage,
  TimerBar,
  feel,
  useReplayKey,
} from "@phone/ui";
import { ConfirmSheet, Flag, RoundClock, errorText, requestId, useRoundClock } from "./common";
import { CandidatesSheet, colourNames } from "./elim-sheet";
import { useBackGuard } from "./useBackGuard";
import "./typing.css";

/** Same key as the desktop setup, so both apps remember the same difficulty on one device. */
const DIFFICULTY_KEY = "elim-difficulty";

const ONLINE_ONLY_TEXT =
  "Elimination needs an online account – the clues are checked on the server, so the answers never reach your phone. It isn't available in the local demo.";

const KNOWN_ERRORS: Record<string, string> = {
  ELIMINATION_NOT_FOUND: "That round could not be found.",
  ELIMINATION_PUZZLE: "That puzzle is not available.",
  ELIMINATION_ROUND_OVER: "The round is over.",
};
const friendly = (cause: unknown) => errorText(cause, KNOWN_ERRORS);
const isOnlineOnly = (message: string | undefined) => isDemo || Boolean(message?.includes(DEMO_UNAVAILABLE));
const puzzleLabel = (item: { difficulty: EliminationDifficulty; number: number }) =>
  `${eliminationDifficultyLabel(item.difficulty)} #${item.number}`;
const isPerfect = (puzzle: EliminationPuzzle) => Boolean(puzzle.best && puzzle.best.solved === puzzle.total);

function readDifficulty(): EliminationDifficulty {
  try {
    const stored = localStorage.getItem(DIFFICULTY_KEY);
    return ELIMINATION_DIFFICULTIES.some((item) => item.id === stored) ? (stored as EliminationDifficulty) : "easy";
  } catch {
    return "easy";
  }
}

function Place({ place }: { place: EliminationPlace }) {
  return (
    <span className="ph-elim-place">
      <Flag code={place.code} />
      {place.name}
    </span>
  );
}

function HowItWorks() {
  return (
    <ol className="ph-elim-how">
      {eliminationHowItWorks("phone").map((step) => (
        <li key={step.lead}>
          <strong>{step.lead}</strong>
          {step.text}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------------ */
/* Setup                                                                     */
/* ------------------------------------------------------------------------ */

function Setup() {
  usePhoneChrome({ title: "Elimination", back: paths.games });
  const navigate = useNavigate();
  const catalog = useLoad<EliminationPuzzle[]>(() => api.elimCatalog());
  const [difficulty, setDifficulty] = useState<EliminationDifficulty>(readDifficulty);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem(DIFFICULTY_KEY, difficulty);
    } catch {
      /* storage unavailable */
    }
  }, [difficulty]);

  async function start(puzzle: EliminationPuzzle) {
    if (busy) return;
    feel("tap");
    if (puzzle.activeId) {
      navigate(`${paths.elimination}/play/${puzzle.activeId}`);
      return;
    }
    setBusy(puzzle.id);
    setError("");
    try {
      const view = await api.elimStart(puzzle.id, requestId());
      navigate(`${paths.elimination}/play/${view.id}`);
    } catch (cause) {
      setError(friendly(cause));
      setBusy(null);
    }
  }

  const onlineOnly = isOnlineOnly(catalog.error);
  const all = catalog.data ?? [];
  const puzzles = all.filter((puzzle) => puzzle.difficulty === difficulty);
  const active = all.filter((puzzle) => puzzle.activeId);
  const perfect = all.filter(isPerfect).length;

  return (
    <div className="ph-stack">
      <ModeHero
        title="Narrow it down"
        subtitle="Each clue rules places out – name the one that fits them all."
        icon="funnel"
        tone="elimination"
      />
      <p className="ph-muted">
        Four colour groups, each a chain of clues. Every place you name must fit all clues revealed so far – until a
        single place is left.
      </p>

      {onlineOnly ? (
        <>
          <StatusMessage tone="info">{ONLINE_ONLY_TEXT}</StatusMessage>
          <Card>
            <h2 className="ph-section-title">How it works</h2>
            <HowItWorks />
          </Card>
          <ActionBar>
            <LinkButton to={paths.games} variant="secondary" size="lg">
              Back to games
            </LinkButton>
          </ActionBar>
        </>
      ) : catalog.error ? (
        <StatusMessage tone="error" retry={catalog.reload}>
          {friendly(catalog.error)}
        </StatusMessage>
      ) : !catalog.data ? (
        <LoadingState label="Loading puzzles…" />
      ) : (
        <>
          {active.length > 0 && (
            <Section title="Unfinished rounds">
              {active.map((puzzle) => (
                <LinkCard
                  key={puzzle.id}
                  to={`${paths.elimination}/play/${puzzle.activeId}`}
                  icon="funnel"
                  tone="elimination"
                  title={`Continue ${puzzleLabel(puzzle)}`}
                  text={`${puzzle.total} answers · the clock keeps running`}
                />
              ))}
            </Section>
          )}

          <Section title="1 · Difficulty">
            <ChipGroup label="Difficulty">
              {ELIMINATION_DIFFICULTIES.map((item) => {
                const list = all.filter((puzzle) => puzzle.difficulty === item.id);
                const done = list.filter(isPerfect).length;
                return (
                  <Chip key={item.id} pressed={difficulty === item.id} onToggle={() => setDifficulty(item.id)}>
                    {item.label}{" "}
                    {list.length > 0 && (
                      <span className="ph-elim-difficulty-count">
                        {done}/{list.length} perfect
                      </span>
                    )}
                  </Chip>
                );
              })}
            </ChipGroup>
            <p className="ph-muted">{ELIMINATION_DIFFICULTIES.find((item) => item.id === difficulty)?.text}</p>
          </Section>

          <Section title="2 · Pick a puzzle">
            {puzzles.length === 0 ? (
              <p className="ph-muted">No puzzles at this difficulty yet.</p>
            ) : (
              <ul className="ph-elim-puzzles">
                {puzzles.map((puzzle) => {
                  const perfectRun = isPerfect(puzzle);
                  const action =
                    busy === puzzle.id ? "Starting…" : puzzle.activeId ? "Continue" : puzzle.best ? "Play again" : "Play";
                  const limit = formatClock(puzzle.timeLimitSeconds * 1000);
                  const bestText = puzzle.best
                    ? `Best ${puzzle.best.solved}/${puzzle.total}${perfectRun ? ` in ${formatClock(puzzle.best.elapsedMs)}` : ""}`
                    : "Not played yet";
                  return (
                    <li key={puzzle.id}>
                      <button
                        type="button"
                        className={`ph-elim-puzzle${perfectRun ? " is-perfect" : ""}${puzzle.activeId ? " is-active" : ""}`}
                        disabled={busy !== null}
                        aria-label={`${action} puzzle ${puzzle.number}: ${puzzle.total} answers, time limit ${limit}. ${bestText}.`}
                        onClick={() => void start(puzzle)}
                      >
                        <span className="ph-elim-puzzle-number">#{puzzle.number}</span>
                        <span className="ph-elim-puzzle-text">
                          <strong>
                            <span className="ph-elim-dots" aria-hidden="true">
                              {(["green", "orange", "blue", "purple"] as const).slice(0, puzzle.groups).map((colour) => (
                                <span key={colour} className={`ph-elim-dot ph-elim-${colour}`} />
                              ))}
                            </span>{" "}
                            {puzzle.total} answers · {limit}
                          </strong>
                          <small>
                            {perfectRun && <Icon name="check" size={14} />} {bestText}
                          </small>
                        </span>
                        <span className="ph-elim-puzzle-action" aria-hidden="true">
                          {action}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <StatusMessage tone="error">{error}</StatusMessage>
          </Section>

          <Section title="Your progress">
            <ProgressBar value={perfect} max={all.length} label="Puzzles solved perfectly" showValue />
          </Section>

          <Card>
            <details className="ph-elim-details">
              <summary>How it works</summary>
              <HowItWorks />
            </details>
          </Card>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Group card (play and results)                                             */
/* ------------------------------------------------------------------------ */

type GroupHint = { availability: HintAvailability; left: number; hinted: boolean; busy: boolean; onHint: () => void };

/** What a hint costs, in plain words, next to the button. */
function hintCost(availability: HintAvailability, hinted: boolean) {
  if (availability === "owned") return "Free – you already have this hint.";
  if (availability === "noneLeft") return "You have used every hint for this round.";
  return hinted
    ? "Costs 1 hint. This round already doesn't count for personal bests."
    : "Costs 1 hint, and this round stops counting for personal bests.";
}

function HintButton({ colour, hint }: { colour: string; hint: GroupHint }) {
  const { availability, left, hinted, busy, onHint } = hint;
  if (availability === "closed") return null;
  if (availability === "lastClue") {
    return <p className="ph-elim-hint-note">No hint for a clue that leaves one place.</p>;
  }
  const owned = availability === "owned";
  const label = owned ? "Show hint" : availability === "noneLeft" ? "No hints left" : `Hint · ${left} left`;
  return (
    <div className="ph-elim-hint-row">
      <GameButton
        variant={owned ? "secondary" : "tone"}
        tone="elimination"
        size="md"
        icon={<Icon name="search" size={16} />}
        disabled={busy || availability === "noneLeft"}
        aria-haspopup="dialog"
        aria-label={
          owned
            ? `Show the ${colour} hint again (free)`
            : availability === "noneLeft"
              ? `No hints left for ${colour}`
              : `Use a hint for ${colour}, ${left} left`
        }
        onClick={onHint}
      >
        {label}
      </GameButton>
      <small className="ph-elim-hint-cost">{hintCost(availability, hinted)}</small>
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
  /** Only while the round is active: the group's hint button. */
  hint?: GroupHint;
  /** Only once the round is over: opens the full list for a 1-based clue step. */
  onShowCandidates?: (step: number) => void;
}) {
  const complete = group.solved >= group.size;
  const hidden = Math.max(0, group.size - group.steps.length);
  const name = colourNames[group.colour];
  // Motion only for changes during play: the clue just answered and the clue it revealed pop in, and a group
  // solved in this round gets a small burst. Nothing animates for groups that were already solved on load.
  const replay = useReplayKey(group.solved);
  const completeOnLoad = useRef(complete);
  const celebrate = !done && complete && !completeOnLoad.current;
  return (
    <Card
      as="section"
      className={`ph-elim-group ph-elim-${group.colour}${complete ? " is-complete" : ""}`}
      aria-label={`${name} group, ${group.solved} of ${group.size} solved`}
    >
      <Burst fireKey={celebrate ? `${group.colour}-solved` : null} count={16} />
      <h3 className="ph-elim-group-head">
        <span className="ph-elim-dot" aria-hidden="true" />
        <span>{name}</span>
        {complete && <Icon name="checkCircle" size={18} label="solved" />}
        <span aria-hidden="true">
          {group.solved}/{group.size}
        </span>
      </h3>
      <ol className="ph-elim-clues">
        {group.steps.map((step, index) => {
          const current = !done && !step.answer && index === group.solved;
          const missed = done && !step.answer;
          const fits = `${step.remaining} ${step.remaining === 1 ? "place fits" : "places fit"}`;
          const fresh = Boolean(replay) && !done && (index === group.solved - 1 || index === group.solved);
          return (
            <li
              key={fresh ? `${index}-${replay}` : index}
              className={[
                "ph-elim-clue",
                current && "is-current",
                missed && "is-missed",
                step.answer && "is-answered",
                fresh && "is-fresh",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={current ? "step" : undefined}
            >
              {onShowCandidates ? (
                <button
                  type="button"
                  className="ph-elim-count"
                  aria-haspopup="dialog"
                  aria-label={`Show every place that fit up to clue ${index + 1} (${step.remaining})`}
                  onClick={() => onShowCandidates(index + 1)}
                >
                  {step.remaining}
                </button>
              ) : (
                <span className="ph-elim-count" role="img" aria-label={`${fits} up to here`}>
                  {step.remaining}
                </span>
              )}
              <span className="ph-elim-clue-label">{step.label}</span>
              {(step.answer || current || missed) && (
                <span className="ph-elim-clue-answer">
                  {step.answer ? (
                    <Place place={step.answer} />
                  ) : current ? (
                    <span className="ph-elim-waiting">Your answer…</span>
                  ) : (
                    <span role="img" aria-label="not answered">
                      —
                    </span>
                  )}
                </span>
              )}
            </li>
          );
        })}
        {Array.from({ length: hidden }, (_, index) => (
          <li key={`hidden-${index}`} className="ph-elim-clue is-locked">
            <span className="ph-elim-count">
              <Icon name="lock" size={14} />
            </span>
            <span className="ph-elim-clue-label">Clue {group.steps.length + index + 1} (locked)</span>
          </li>
        ))}
      </ol>
      {hint && <HintButton colour={name} hint={hint} />}
      {done && group.answer && (
        <p className="ph-elim-solution">
          <Icon name={complete ? "checkCircle" : "target"} size={16} /> {complete ? "Solved:" : "Answer:"}{" "}
          <Place place={group.answer} />
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/* Play                                                                      */
/* ------------------------------------------------------------------------ */

type Feedback = { tone: "ok" | "bad" | "info"; text: string } | null;

export function feedbackText(guess: EliminationGuess, typed: string): Feedback {
  const colours = (guess.advanced ?? []).map((colour) => colourNames[colour]);
  switch (guess.result) {
    case "advanced":
      return {
        tone: "ok",
        text: `✓ ${guess.place?.name ?? typed} fits ${colours.join(" and ")}${colours.length > 1 ? " – several groups moved on" : ""}.`,
      };
    case "no_match":
      return { tone: "bad", text: `${guess.place?.name ?? typed} doesn't fit any open clue – that only costs time.` };
    case "unknown":
      return { tone: "bad", text: `“${typed}” isn't a place in this puzzle.` };
    case "ambiguous":
      return { tone: "bad", text: `“${typed}” could mean more than one place – be more specific.` };
    default:
      return null;
  }
}

const IDLE_HINT = "English, German or French. Wrong guesses only cost time.";
/** The timer turns to its warning state for the last 30 seconds. */
const TIMER_WARN_MS = 30_000;

/** True when the guess finished a group that was still open before it. */
export function solvedAGroup(before: EliminationGroup[], after: EliminationGroup[]) {
  return after.some((group, index) => group.solved >= group.size && (before[index]?.solved ?? 0) < group.size);
}

function Play() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const initial = useLoad<EliminationView>(() => api.elimView(id), id);
  const [view, setView] = useState<EliminationView | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [shaking, setShaking] = useState(false);
  const [askGiveUp, setAskGiveUp] = useState(false);
  /** The sheet that device/browser Back opens during a round: leave options, then the give-up confirmation. */
  const [leaveSheet, setLeaveSheet] = useState<"closed" | "menu" | "confirm">("closed");
  // Hints: the group (1-based) whose hint waits for confirmation, the open hint sheet, bought hints by "group:step".
  const [hintAsk, setHintAsk] = useState<number | null>(null);
  const [hintSheet, setHintSheet] = useState<{ group: number; step: number } | null>(null);
  const hintCache = useRef(new Map<string, Promise<EliminationHint>>());
  const inputRef = useRef<HTMLInputElement>(null);
  /** Set synchronously, so a fast second Go (or Enter) never sends the same guess twice. */
  const sending = useRef(false);
  const prefs = usePrefs();

  useEffect(() => {
    if (initial.data) setView(initial.data);
  }, [initial.data]);
  const current = view ?? initial.data ?? null;
  const done = current ? current.state !== "active" : false;
  usePhoneChrome({
    title: current ? puzzleLabel(current) : "Elimination",
    // Back (history): during a round it lands on the Back guard below and opens the leave sheet.
    back: true,
    hideTabBar: true,
  });
  useLeaveGuard(Boolean(current && !done));
  const { release, releasing } = useBackGuard(Boolean(current && !done), () => {
    setHintAsk(null);
    setHintSheet(null);
    setAskGiveUp(false);
    setLeaveSheet("menu");
  });
  const { remaining } = useRoundClock(current, Boolean(current && !done));
  const solvedBump = useReplayKey(current?.solved ?? 0);

  // A finished round lives on the results screen.
  useEffect(() => {
    if (current && current.state !== "active")
      release(() => navigate(`${paths.elimination}/results/${current.id}`, { replace: true }));
  }, [current, navigate, release]);

  // When the clock runs out, ask the server to close the round – once, then every 2 s until it has.
  const roundId = current?.id;
  const timeUp = Boolean(current && !done && remaining === 0);
  useEffect(() => {
    if (!roundId || !timeUp) return;
    const check = () => void api.elimView(roundId).then(setView).catch(() => undefined);
    check();
    const retry = window.setInterval(check, 2000);
    return () => window.clearInterval(retry);
  }, [roundId, timeUp]);

  if (initial.error && !current) {
    return (
      <div className="ph-stack">
        {isOnlineOnly(initial.error) ? (
          <StatusMessage tone="info">{ONLINE_ONLY_TEXT}</StatusMessage>
        ) : (
          <StatusMessage tone="error" retry={initial.reload}>
            {friendly(initial.error)}
          </StatusMessage>
        )}
        <LinkButton to={paths.elimination}>All puzzles</LinkButton>
      </div>
    );
  }
  if (!current || done) return <LoadingState />;
  const round = current;

  async function submit(event: FormEvent) {
    event.preventDefault();
    inputRef.current?.focus();
    const typed = text.trim();
    if (!typed || sending.current || timeUp) return;
    sending.current = true;
    setBusy(true);
    try {
      const guess = await api.elimGuess(round.id, typed);
      setView(guess.view);
      setFeedback(feedbackText(guess, typed));
      // The last guess of a round gets its feedback from the results screen (ResultHero), once.
      if (guess.view.state === "active") {
        if (guess.result === "advanced") feel(solvedAGroup(round.groups, guess.view.groups) ? "reward" : "correct");
        else if (guess.result === "no_match") {
          feel("wrong");
          setShaking(true);
        } else if (guess.result === "unknown") {
          // Not a place at all (typo): soft feedback, no sound.
          feel("error", { sound: false });
          setShaking(true);
        }
      }
      if (guess.result === "advanced" || guess.result === "no_match") setText("");
      else inputRef.current?.select();
    } catch (cause) {
      setFeedback({ tone: "bad", text: friendly(cause) });
    } finally {
      sending.current = false;
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && text) {
      event.preventDefault();
      setText("");
      setFeedback(null);
    }
  }

  async function giveUp() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      const next = await api.elimGiveUp(round.id);
      setAskGiveUp(false);
      setLeaveSheet("closed");
      setView(next);
    } catch (cause) {
      setAskGiveUp(false);
      setLeaveSheet("closed");
      setFeedback({ tone: "bad", text: friendly(cause) });
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  /** A bought hint: from this page's cache, or again from the server (free, nothing is spent twice). */
  function loadHint(group: number, step: number) {
    const key = `${group}:${step}`;
    const cached = hintCache.current.get(key);
    if (cached) return cached;
    const request = api.elimHint(round.id, group);
    hintCache.current.set(key, request);
    request.then((hint) => setView(hint.view)).catch(() => hintCache.current.delete(key));
    return request;
  }

  function askHint(groupIndex: number) {
    if (busy) return;
    const availability = hintAvailability(round, groupIndex);
    const group = groupIndex + 1;
    if (availability === "owned") setHintSheet({ group, step: round.groups[groupIndex].solved + 1 });
    else if (availability === "available") setHintAsk(group);
  }

  async function spendHint() {
    if (hintAsk === null || sending.current) return;
    const group = hintAsk;
    sending.current = true;
    setBusy(true);
    try {
      const hint = await api.elimHint(round.id, group);
      hintCache.current.set(`${group}:${hint.step}`, Promise.resolve(hint));
      setView(hint.view);
      setHintAsk(null);
      setHintSheet({ group, step: hint.step });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setHintAsk(null);
      setFeedback({ tone: "bad", text: hintErrorText(message) });
      if (message.includes("ELIMINATION_ROUND_OVER")) void api.elimView(round.id).then(setView).catch(() => undefined);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const askedGroup = hintAsk !== null ? round.groups[hintAsk - 1] : undefined;
  const sheetGroup = hintSheet ? round.groups[hintSheet.group - 1] : undefined;

  return (
    <div className="ph-typing-play">
      <TopBarActions>
        <GameButton
          variant="secondary"
          size="md"
          className="ph-typing-topbtn"
          disabled={busy}
          onClick={() => {
            if (prefs.confirmGiveUp) setAskGiveUp(true);
            else void giveUp();
          }}
        >
          Give up
        </GameButton>
      </TopBarActions>

      <Card className="ph-typing-hud tone-elimination">
        <div className="ph-typing-hud-row">
          <p className="ph-typing-found">
            <strong key={solvedBump} className={solvedBump ? "ph-typing-bump" : undefined}>
              {round.solved}
            </strong>
            <span> / {round.total} answers</span>
          </p>
          {remaining !== null ? (
            <TimerBar
              msLeft={remaining}
              totalMs={round.timeLimitSeconds * 1000}
              warnAtMs={TIMER_WARN_MS}
              calmFromMs={CALM_ROUND_MS}
            />
          ) : (
            <RoundClock remaining={remaining} />
          )}
        </div>
        <ProgressBar value={round.solved} max={round.total} label="Answers found" />
        <p className="ph-elim-hud-meta">
          <span>
            {round.guesses} {round.guesses === 1 ? "guess" : "guesses"} · {round.wrong} didn't fit
          </span>
          <span>
            {round.hintsLeft} {round.hintsLeft === 1 ? "hint" : "hints"} left
          </span>
          {round.hinted && (
            <span className="ph-elim-badge" role="img" aria-label="Hinted: this round doesn't count for personal bests">
              Hinted
            </span>
          )}
        </p>
      </Card>

      <div className="ph-elim-groups">
        {round.groups.map((group, index) => (
          <GroupCard
            key={group.colour}
            group={group}
            done={false}
            hint={{
              availability: hintAvailability(round, index),
              left: round.hintsLeft,
              hinted: round.hinted,
              busy,
              onHint: () => askHint(index),
            }}
          />
        ))}
      </div>

      <ActionBar label="Your guess">
        <form className="ph-typing-dock" onSubmit={(event) => void submit(event)} noValidate>
          <p className={`ph-typing-feedback${feedback ? ` is-${feedback.tone}` : ""}`} role="status" aria-live="polite">
            {timeUp ? "Time's up – closing the round…" : feedback?.text ?? IDLE_HINT}
          </p>
          <div className="ph-typing-inputrow">
            <label className="sr-only" htmlFor="ph-elim-input">
              Name a country or territory
            </label>
            <input
              id="ph-elim-input"
              ref={inputRef}
              className={`ph-input ph-typing-input${shaking ? " is-shaking" : ""}`}
              onAnimationEnd={() => setShaking(false)}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type a country…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="go"
              inputMode="text"
              maxLength={80}
              autoFocus
            />
            <GameButton
              type="submit"
              variant="primary"
              size="md"
              className="ph-typing-go"
              aria-busy={busy || undefined}
              // The server's answer gives the feedback (fits / doesn't fit), so Go stays silent.
              haptic={false}
              // Keep the keyboard open: a tap on Go must not move focus out of the input.
              onPointerDown={(event) => event.preventDefault()}
              onMouseDown={(event) => event.preventDefault()}
            >
              Go
            </GameButton>
          </div>
        </form>
      </ActionBar>

      <ConfirmSheet
        open={askGiveUp}
        title="Give up?"
        confirmLabel="Give up"
        cancelLabel="Keep playing"
        danger
        busy={busy}
        onConfirm={() => void giveUp()}
        onCancel={() => {
          setAskGiveUp(false);
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <p>Reveal every answer and end the round?</p>
      </ConfirmSheet>

      <BottomSheet
        open={leaveSheet !== "closed"}
        onClose={() => {
          setLeaveSheet("closed");
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }}
        canClose={() => !busy && !releasing}
        title={leaveSheet === "confirm" ? "Give up?" : "Leave this round?"}
      >
        {leaveSheet === "confirm" ? (
          <div className="ph-stack">
            <p>Reveal every answer and end the round?</p>
            <Button variant="danger" size="lg" block loading={busy} onClick={() => void giveUp()}>
              Give up
            </Button>
            <Button size="lg" block disabled={busy} onClick={() => setLeaveSheet("menu")}>
              Keep playing
            </Button>
          </div>
        ) : (
          <div className="ph-stack">
            <p className="ph-muted">
              Your progress is saved. Leave now and resume this puzzle later from the Elimination screen. The round's
              clock keeps running while you are away.
            </p>
            <Button
              variant="primary"
              size="lg"
              block
              disabled={releasing}
              onClick={() => {
                setLeaveSheet("closed");
                window.setTimeout(() => inputRef.current?.focus(), 0);
              }}
            >
              Keep playing
            </Button>
            {/* The sheet's and the Back guard's entries are removed first; the round's entry then becomes the
                puzzle list, so Back from there goes to where the player was before the round. */}
            <Button
              size="lg"
              block
              loading={releasing}
              disabled={busy}
              onClick={() => release(() => navigate(paths.elimination, { replace: true }))}
            >
              Save and leave
            </Button>
            <Button
              variant="danger"
              size="lg"
              block
              disabled={busy || releasing}
              onClick={() => (prefs.confirmGiveUp ? setLeaveSheet("confirm") : void giveUp())}
            >
              Give up
            </Button>
          </div>
        )}
      </BottomSheet>

      <ConfirmSheet
        open={askedGroup !== undefined}
        title="Use a hint?"
        confirmLabel="Use a hint"
        cancelLabel="Keep playing"
        busy={busy}
        onConfirm={() => void spendHint()}
        onCancel={() => setHintAsk(null)}
      >
        <p>
          {round.hintsLeft} {round.hintsLeft === 1 ? "hint" : "hints"} left.{" "}
          {round.hinted
            ? "This round already doesn't count for personal bests."
            : "This round will no longer count for personal bests."}
        </p>
        {askedGroup && (
          <p className="ph-muted">You'll see every place that fits the open {colourNames[askedGroup.colour]} clue.</p>
        )}
      </ConfirmSheet>

      {hintSheet && sheetGroup && (
        <CandidatesSheet
          key={`hint-${hintSheet.group}-${hintSheet.step}`}
          variant="hint"
          group={hintSheet.group}
          colour={sheetGroup.colour}
          load={(group) => loadHint(group, hintSheet.step)}
          onClose={() => setHintSheet(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Results                                                                   */
/* ------------------------------------------------------------------------ */

function resultTitle(view: EliminationView) {
  if (view.endReason === "all_solved") return "Every chain solved!";
  if (view.endReason === "time_up") return "Time's up.";
  return "Round over.";
}

function Results() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const result = useLoad<EliminationView>(() => api.elimView(id), id);
  const catalog = useLoad<EliminationPuzzle[]>(() => api.elimCatalog(), id);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sheet, setSheet] = useState<{ group: number; step: number } | null>(null);
  const candidateCache = useRef(new Map<number, Promise<EliminationCandidates>>());
  usePhoneChrome({ title: "Elimination results", back: paths.elimination });
  const view = result.data;

  useEffect(() => {
    if (view?.state === "active") navigate(`${paths.elimination}/play/${view.id}`, { replace: true });
  }, [view, navigate]);

  const next = useMemo(() => {
    const list = catalog.data ?? [];
    const index = list.findIndex((puzzle) => puzzle.id === view?.puzzleId);
    return index >= 0 ? list[index + 1] ?? null : null;
  }, [catalog.data, view?.puzzleId]);

  if (!view || view.state === "active") {
    if (result.error) {
      return isOnlineOnly(result.error) ? (
        <StatusMessage tone="info">{ONLINE_ONLY_TEXT}</StatusMessage>
      ) : (
        <StatusMessage tone="error" retry={result.reload}>
          {friendly(result.error)}
        </StatusMessage>
      );
    }
    return <LoadingState />;
  }
  const done = view;
  const best = catalog.data?.find((puzzle) => puzzle.id === done.puzzleId)?.best;
  const timeMs = Math.min(done.elapsedMs, done.timeLimitSeconds * 1000);

  function loadCandidates(group: number) {
    const cached = candidateCache.current.get(group);
    if (cached) return cached;
    const request = api.elimCandidates(done.id, group);
    candidateCache.current.set(group, request);
    request.catch(() => candidateCache.current.delete(group));
    return request;
  }

  async function play(puzzleId: string) {
    setBusy(true);
    setMessage("");
    try {
      const started = await api.elimStart(puzzleId, requestId());
      navigate(`${paths.elimination}/play/${started.id}`);
    } catch (cause) {
      setMessage(friendly(cause));
      setBusy(false);
    }
  }

  const sheetGroup = sheet ? done.groups[sheet.group - 1] : undefined;

  return (
    <div className="ph-stack">
      <ResultHero
        headline={resultTitle(done)}
        tone="elimination"
        icon="funnel"
        score={done.solved}
        scoreLabel="Answers found"
        correct={done.solved}
        total={done.total}
        timeMs={timeMs}
        ranked={!done.hinted}
        unrankedLabel="Hinted · not ranked"
      >
        <div className="ph-typing-hero-extra">
          <p className="ph-typing-eyebrow">{puzzleLabel(done)}</p>
          <dl className="ph-elim-stats">
            <div>
              <dt>Guesses</dt>
              <dd>{done.guesses}</dd>
            </div>
            <div>
              <dt>Didn't fit</dt>
              <dd>{done.wrong}</dd>
            </div>
            {best && (
              <div>
                <dt>Your best</dt>
                <dd>
                  {best.solved}/{done.total}
                </dd>
              </div>
            )}
            {done.hinted && (
              <div>
                <dt>Hints</dt>
                <dd>{done.hintsUsed}</dd>
              </div>
            )}
          </dl>
          {done.hinted && (
            <p className="ph-muted">
              <span className="ph-elim-badge">Hinted</span> This round used{" "}
              {done.hintsUsed === 1 ? "a hint" : `${done.hintsUsed} hints`}, so it doesn't count as a personal best.
            </p>
          )}
          {next && (
            <GameButton variant="secondary" size="md" block disabled={busy} onClick={() => void play(next.id)}>
              Next puzzle · {puzzleLabel(next)}
            </GameButton>
          )}
        </div>
      </ResultHero>

      <StatusMessage tone="error">{message}</StatusMessage>

      <p className="ph-muted">
        <Icon name="search" size={16} /> Tap a number beside a clue to see every place that fit.
      </p>
      <div className="ph-elim-groups">
        {done.groups.map((group, index) => (
          <GroupCard
            key={group.colour}
            group={group}
            done
            onShowCandidates={(step) => setSheet({ group: index + 1, step })}
          />
        ))}
      </div>

      {sheet && sheetGroup && (
        <CandidatesSheet
          key={sheet.group}
          variant="full"
          group={sheet.group}
          colour={sheetGroup.colour}
          initialStep={sheet.step}
          load={loadCandidates}
          onClose={() => setSheet(null)}
        />
      )}

      <ActionBar>
        <LinkButton to={paths.elimination}>All puzzles</LinkButton>
        <GameButton variant="primary" loading={busy} onClick={() => void play(done.puzzleId)}>
          Play again
        </GameButton>
      </ActionBar>
    </div>
  );
}

/** "Play again" and "Next puzzle" change the round id: a fresh Play per id drops the old round's state. */
function PlayRound() {
  const { id = "" } = useParams();
  return <Play key={id} />;
}

function ResultsRound() {
  const { id = "" } = useParams();
  return <Results key={id} />;
}

export default function EliminationArea() {
  return (
    <Routes>
      <Route index element={<Setup />} />
      <Route path="play/:id" element={<PlayRound />} />
      <Route path="results/:id" element={<ResultsRound />} />
    </Routes>
  );
}
