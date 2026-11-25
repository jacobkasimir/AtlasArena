// OWNER: geo area agent. Phone Flags under /flags/*: setup → play → results.
// The server (or the demo engine) decides correctness, points, attempts and the deadline; this screen only
// shows its responses. Every action is locked against double taps and carries a fresh request id.
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "@shared/api";
import type { FlagsChoice, FlagsDirection, FlagsEntry, FlagsSession, FlagsSetup } from "@shared/domain";
import {
  GameChoice,
  PersonalBest,
  SetupPlace,
  badgeText,
  describeSetup,
  endedOnTime,
  formatClock,
  initialChoice,
  regionLabel,
  roundOptions,
  setupUrl,
} from "@shared/game-setup";
import { autoContinueMs, useLeaveGuard, usePrefs } from "@shared/prefs";
import { useLoad } from "@shared/components";
import { Icon } from "@shared/icons";
import { TopBarActions, usePhoneChrome } from "@phone/shell/chrome";
import { paths } from "@phone/shell/paths";
import { useBackGuard } from "@phone/ui/useBackGuard";
import {
  ActionBar,
  Button,
  Card,
  Chip,
  IconButton,
  LinkButton,
  LoadingState,
  ProgressBar,
  Section,
  StatusMessage,
  TextField,
  useHaptics,
} from "@phone/ui";
import {
  ConfirmSheet,
  FeedbackLine,
  FlagPicture,
  RoundClock,
  RoundMenuSheet,
  RoundTags,
  errorText,
  roundTagList,
  useRoundTimer,
  useTapGuard,
} from "./common";
import {
  FLAG_PAGE_SIZE,
  Feedback,
  NEXT_TAP_GUARD_MS,
  choiceStatus,
  countrySuggestions,
  flagsActionFeedback,
  flagsChoiceOf,
  flagsEntryFeedback,
  ordinal,
  pageCount,
  requestId,
  trailingStreak,
} from "./geo-logic";
import { GeoSetup } from "./setup";
import "./geo.css";

const flagModes = ["country_to_flag", "flag_to_country"] as const;
const directionName = (direction: FlagsDirection) =>
  direction === "country_to_flag" ? "Country → Flag" : "Flag → Country";
const playPath = (id: string) => `${paths.flags}/play/${id}`;
const resultsPath = (id: string) => `${paths.flags}/results/${id}`;

export default function FlagsArea() {
  return (
    <Routes>
      <Route index element={<FlagsSetupScreen />} />
      <Route path="play/:id" element={<FlagsPlay />} />
      <Route path="session/:id" element={<FlagsPlay />} />
      <Route path="results/:id" element={<FlagsResults />} />
      <Route path="*" element={<FlagsSetupScreen />} />
    </Routes>
  );
}

// ---------------------------------------------------------------- Setup

function FlagsSetupScreen() {
  usePhoneChrome({ title: "Flags", back: paths.games });
  const { data, error, reload } = useLoad<FlagsSetup>(() => api.flagsSetup());
  const bests = useLoad<PersonalBest[]>(() => api.personalBests());
  const navigate = useNavigate();
  const prefs = usePrefs();
  const [params] = useSearchParams();
  const initial = useMemo(() => initialChoice("flags", params, [...flagModes], { pool: "easy" }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [discardId, setDiscardId] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [message, setMessage] = useState("");

  async function discard(id: string) {
    setDiscarding(true);
    try {
      await api.flagsDelete(id, requestId());
      reload();
    } catch (cause) {
      setMessage(errorText(cause));
    } finally {
      setDiscarding(false);
      setDiscardId(null);
    }
  }

  if (error)
    return (
      <StatusMessage tone="error" retry={reload}>
        {errorText(error)}
      </StatusMessage>
    );
  if (!data) return <LoadingState label="Loading Flags…" />;
  const places: SetupPlace[] = (data.countries ?? []).map((place) => ({ ...place, modes: [...flagModes] }));

  return (
    <>
      <GeoSetup
        game="flags"
        intro="Every flag in your set comes up once. Get it right, use a hint, or skip – your round is saved as you go."
        modes={[
          { value: "country_to_flag", icon: "flag", title: "Country → Flag", text: "See a country name and tap its flag." },
          { value: "flag_to_country", icon: "search", title: "Flag → Country", text: "See a flag and type the country." },
        ]}
        places={places}
        regions={data.regions.map((region) => ({ id: region.id, name: region.name }))}
        unit={(count) => (count === 1 ? "flag" : "flags")}
        initial={initial}
        bests={bests.error ? null : (bests.data ?? [])}
        hint={(choice) =>
          choice.mode === "flag_to_country" && choice.region
            ? "Region hints are switched off when you play a single region."
            : undefined
        }
        error={message}
        resume={data.activeSessions.map((s) => ({
          id: s.id,
          title: directionName(s.direction),
          detail:
            describeSetup({
              scope: s.scope ?? "all",
              region: s.region,
              pool: s.poolTier,
              picks: s.selectedCount,
              size: s.sampleSize,
              limit: s.timeLimitSeconds ?? null,
            }) + ` · ${s.answered}/${s.total}${s.paused ? " · paused" : ""}`,
          to: playPath(s.id),
          onDiscard: () => (prefs.confirmGiveUp ? setDiscardId(s.id) : void discard(s.id)),
        }))}
        onStart={async (choice) => {
          const session = await api.flagsStart(
            choice.mode as FlagsDirection,
            choice.region,
            choice.pool,
            requestId(),
            roundOptions(choice),
          );
          navigate(playPath(session.id));
        }}
      />
      <ConfirmSheet
        open={discardId !== null}
        title="Discard this round?"
        cancelLabel="Keep round"
        confirmLabel="Discard"
        busy={discarding}
        onCancel={() => setDiscardId(null)}
        onConfirm={() => discardId && void discard(discardId)}
      >
        Your answers in this round will be removed.
      </ConfirmSheet>
    </>
  );
}

// ---------------------------------------------------------------- Play

type Outcome = Pick<FlagsEntry, "outcome" | "attempts">;

/** Outcomes of finished entries, keyed by entry id and by choice position (the grid may use either). */
function outcomesFrom(session: FlagsSession) {
  const map: Record<string, Outcome> = {};
  const add = (entry: FlagsEntry) => {
    if (entry.outcome === "pending") return;
    const value = { outcome: entry.outcome, attempts: entry.attempts };
    map[entry.id] = value;
    if (entry.choicePosition != null) map[`position:${entry.choicePosition}`] = value;
  };
  session.entries.forEach(add);
  if (session.current) add(session.current);
  return map;
}

function FlagsPlay() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const prefs = usePrefs();
  const haptics = useHaptics();
  const [session, setSession] = useState<FlagsSession | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const latest = useRef<FlagsSession | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [page, setPage] = useState(0);
  const [hideDone, setHideDone] = useState(true);
  const [timeUp, setTimeUp] = useState(false);
  const promptRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  usePhoneChrome({ title: "Flags", hideTabBar: true });
  const active = session?.state === "active";
  useLeaveGuard(active);
  // Device Back / swipe-back during a round opens "Pause or leave" instead of leaving the round.
  const { release, releasing } = useBackGuard(active, () => setMenuOpen(true));

  const accept = useCallback((next: FlagsSession) => {
    latest.current = next;
    setSession(next);
    setOutcomes((previous) => ({ ...previous, ...outcomesFrom(next) }));
  }, []);

  const finish = useCallback(
    (done: FlagsSession) => {
      latest.current = done;
      haptics.complete();
      // Results replace the round's entry, so Back from them never lands in the finished round again.
      release(() => navigate(resultsPath(done.id), { replace: true }));
    },
    [haptics, navigate, release],
  );

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const loaded = await api.flagsResume(id, requestId());
      if (loaded.state === "completed") return finish(loaded);
      accept(loaded);
      setFeedback(flagsEntryFeedback(loaded.direction, loaded.current));
    } catch (cause) {
      setLoadError(errorText(cause));
    }
  }, [id, accept, finish]);

  useEffect(() => {
    void load();
  }, [load]);

  // Untimed rounds pause while the player is away (same as desktop); timed rounds keep running.
  useEffect(
    () => () => {
      const current = latest.current;
      if (current?.state === "active" && !current.timeLimitSeconds)
        void api.flagsPause(current.id, requestId()).catch(() => undefined);
    },
    [id],
  );

  const current = session?.current ?? null;
  const finalized = Boolean(current && current.outcome !== "pending");
  const canTapNext = useTapGuard(finalized && current ? current.id : null, NEXT_TAP_GUARD_MS);

  // New question: reset the answer, the grid page and move focus to the prompt.
  useEffect(() => {
    if (!current) return;
    setAnswer("");
    setPage(0);
    window.setTimeout(() => {
      if (current.outcome !== "pending") return;
      if (session?.direction === "flag_to_country") inputRef.current?.focus();
      else promptRef.current?.focus();
    }, 0);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { elapsed, remaining } = useRoundTimer(session, active && !timeUp);

  // Time is up: the server ends the round (open flags count as skipped) – ask it, then show the results.
  useEffect(() => {
    if (remaining !== 0 || !session || timeUp) return;
    setTimeUp(true);
    api
      .flagsView(session.id)
      .then((view) => {
        if (view.state === "completed") finish(view);
        else accept(view);
      })
      .catch((cause) => setActionError(errorText(cause)));
  }, [remaining === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(run: () => Promise<FlagsSession>, attemptsBefore = 0) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setActionError("");
    try {
      const next = await run();
      if (next.state === "completed") return finish(next);
      accept(next);
      const line = flagsActionFeedback(next, attemptsBefore);
      setFeedback(line);
      const outcome = next.actionResult?.outcome;
      if (outcome === "correct") haptics.correct();
      else if (outcome && outcome !== "ambiguous" && outcome !== "duplicate_choice") haptics.wrong();
      if (outcome === "ambiguous") window.setTimeout(() => inputRef.current?.select(), 0);
    } catch (cause) {
      setActionError(errorText(cause));
      void load();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function next(auto = false) {
    if (!session || lock.current || !finalized) return;
    if (!auto && !canTapNext()) return;
    lock.current = true;
    setBusy(true);
    setActionError("");
    try {
      const moved = await api.flagsNext(session.id, requestId());
      if (moved.state === "completed") return finish(moved);
      accept(moved);
      setFeedback(null);
    } catch (cause) {
      setActionError(errorText(cause));
      void load();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const autoContinue = Boolean(prefs.autoContinue && current?.outcome === "correct" && active && !menuOpen);
  useEffect(() => {
    if (!autoContinue) return;
    const timer = window.setTimeout(() => void next(true), autoContinueMs(prefs.autoContinueSpeed));
    return () => window.clearTimeout(timer);
  }, [autoContinue, current?.id, prefs.autoContinueSpeed]); // eslint-disable-line react-hooks/exhaustive-deps

  const choices: FlagsChoice[] = current?.choices ?? session?.choices ?? [];
  const outcomeOf = useCallback(
    (choice: FlagsChoice) =>
      outcomes[choice.id] ?? (choice.choicePosition != null ? outcomes[`position:${choice.choicePosition}`] : undefined),
    [outcomes],
  );
  const cells = useMemo(
    () =>
      choices.map((choice, index) => ({ choice, number: index + 1, status: choiceStatus(choice, current, outcomeOf) })),
    [choices, current, outcomeOf],
  );
  const visible = hideDone ? cells.filter((cell) => cell.status !== "solved" && cell.status !== "missed") : cells;
  const pages = pageCount(visible.length);
  const safePage = Math.min(page, pages - 1);
  const shown = visible.slice(safePage * FLAG_PAGE_SIZE, (safePage + 1) * FLAG_PAGE_SIZE);

  // After a question ends, make sure the right flag is on screen.
  useEffect(() => {
    if (!finalized) return;
    const index = visible.findIndex((cell) => cell.status === "answer");
    if (index >= 0) setPage(Math.floor(index / FLAG_PAGE_SIZE));
  }, [finalized, current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function goToPage(target: number) {
    setPage(target);
    gridRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }

  function choose(choice: FlagsChoice) {
    if (!session || !current || finalized || busy) return;
    haptics.tap();
    void act(() => api.flagsAnswer(session.id, current.id, choice.id, null, requestId()), current.attempts);
  }

  function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (finalized) return void next();
    if (!session || !current || busy) return;
    if (!answer.trim()) {
      setFeedback({ tone: "info", text: "Type a country name or its two-letter code first." });
      inputRef.current?.focus();
      return;
    }
    haptics.tap();
    void act(() => api.flagsAnswer(session.id, current.id, null, answer, requestId()));
  }

  async function leave() {
    if (!session || busy || releasing) return;
    if (session.timeLimitSeconds) return release(() => navigate(paths.flags, { replace: true }));
    setBusy(true);
    try {
      const paused = await api.flagsPause(session.id, requestId());
      latest.current = paused;
      release(() => navigate(paths.flags, { replace: true }));
    } catch (cause) {
      setActionError(errorText(cause));
      setBusy(false);
    }
  }

  async function giveUp() {
    if (!session || busy || releasing) return;
    setBusy(true);
    try {
      const abandoned = await api.flagsAbandon(session.id, requestId());
      latest.current = abandoned;
      release(() => navigate(paths.flags, { replace: true }));
    } catch (cause) {
      setActionError(errorText(cause));
      setBusy(false);
    }
  }

  if (!session)
    return loadError ? (
      <div className="ph-stack">
        <StatusMessage tone="error" retry={() => void load()}>
          {loadError}
        </StatusMessage>
        <LinkButton to={paths.flags} block>
          Back to Flags
        </LinkButton>
      </div>
    ) : (
      <LoadingState label="Loading your round…" />
    );

  if (session.state === "abandoned")
    return (
      <div className="ph-stack">
        <StatusMessage>This round was given up. Rounds you give up don't count towards personal bests.</StatusMessage>
        <LinkButton to={paths.flags} variant="primary" size="lg" block>
          Back to Flags
        </LinkButton>
      </div>
    );

  const position = current?.position ?? Math.min(session.answered + 1, session.total);
  const streak = trailingStreak(session.entries);
  const pickMode = session.direction === "country_to_flag";
  const triesLeft = current ? Math.max(0, 3 - current.attempts) : 0;
  const suggestions =
    !pickMode && !finalized ? countrySuggestions(session.answerOptions ?? [], answer) : [];
  const exact = suggestions.length === 1 && suggestions[0].name === answer;
  const correctName = !pickMode && finalized && current?.outcome !== "correct" ? current?.name : null;

  return (
    <div className="ph-geo-play">
      <TopBarActions>
        {active && (
          <IconButton label="Pause or leave" onClick={() => setMenuOpen(true)} disabled={busy || releasing}>
            <Icon name="close" size={22} />
          </IconButton>
        )}
      </TopBarActions>

      <div className="ph-geo-hud" role="group" aria-label="Round status">
        <span>
          <span className="ph-muted">Score</span> <strong>{session.score}</strong>
        </span>
        <span>
          <Icon name="flame" size={16} /> <span className="sr-only">Streak </span>
          <strong>{streak}</strong>
        </span>
        <RoundClock remaining={remaining} elapsed={elapsed} />
      </div>
      <ProgressBar value={session.answered} max={session.total} label={`Flag ${position} of ${session.total}`} showValue />
      <RoundTags tags={[directionName(session.direction), regionLabel(session.region), ...roundTagList({ ...session, pool: session.poolTier, picks: session.selectedCount })]} />

      {current && pickMode && (
        <>
          <div className="ph-geo-sticky">
            <p className="ph-geo-eyebrow">Find the flag of</p>
            <h2 ref={promptRef} tabIndex={-1} className="ph-geo-prompt">
              {current.name}
            </h2>
            {!finalized && (
              <p className="ph-muted ph-geo-tries">
                {triesLeft} {triesLeft === 1 ? "try" : "tries"} left · 100, 60 or 30 points
              </p>
            )}
            <FeedbackLine feedback={feedback} />
          </div>

          <div className="ph-geo-grid-tools">
            <Chip pressed={hideDone} onToggle={() => { setHideDone((value) => !value); setPage(0); }}>
              Hide finished flags
            </Chip>
            <span className="ph-muted">{visible.length} shown</span>
          </div>

          <div ref={gridRef} className="ph-geo-grid" role="group" aria-label={`Flags, page ${safePage + 1} of ${pages}`}>
            {shown.map(({ choice, number, status }) => (
              <FlagCell
                key={choice.id}
                choice={choice}
                number={number}
                status={status}
                disabled={busy || finalized || status !== "open"}
                onPick={() => choose(choice)}
              />
            ))}
          </div>
          {pages > 1 && (
            <nav className="ph-geo-pager" aria-label="Flag pages">
              <Button disabled={safePage === 0} onClick={() => goToPage(safePage - 1)}>
                Previous
              </Button>
              <span aria-live="polite">
                Page {safePage + 1} of {pages}
              </span>
              <Button disabled={safePage >= pages - 1} onClick={() => goToPage(safePage + 1)}>
                Next page
              </Button>
            </nav>
          )}
          <p className="sr-only">
            Flags are numbered so they don't give away the answer. A description of each flag is read out when one
            is available.
          </p>
        </>
      )}

      {current && !pickMode && (
        <form id="ph-geo-flag-form" className="ph-geo-identify" onSubmit={submitAnswer} noValidate>
          <FlagPicture
            url={current.flagSvgUrl}
            label={current.flagDescription || "Flag to identify"}
            className="is-large"
            eager
          />
          <h2 ref={promptRef} tabIndex={-1} className="ph-geo-prompt is-small">
            Which country or territory is this?
          </h2>
          <TextField
            ref={inputRef}
            label="Your answer"
            hint="Type a name or a two-letter code. Accents and capital letters don't matter."
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            readOnly={busy || finalized}
            aria-busy={busy || undefined}
            maxLength={200}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            inputMode="text"
          />
          <div className="ph-geo-suggest-slot">
            {suggestions.length > 0 && !exact && (
              <ul className="ph-geo-suggest" aria-label="Matching countries">
                {suggestions.map((option) => (
                  <li key={`${option.alpha2 ?? "none"}-${option.name}`}>
                    <button
                      type="button"
                      className="ph-geo-suggest-item"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setAnswer(option.name);
                        inputRef.current?.focus();
                      }}
                    >
                      <span>{option.name}</span>
                      {option.alpha2 && <small>{option.alpha2}</small>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <FeedbackLine feedback={feedback} />
          {correctName && (
            <p className="ph-geo-answer">
              <span className="ph-muted">Correct country: </span>
              <strong>{correctName}</strong>
            </p>
          )}
          {!session.region && current.hintUsed && current.region && (
            <p className="ph-geo-hint" role="status">
              Region hint: <strong>{current.region}</strong>
            </p>
          )}
          {!session.region && !current.hintUsed && !finalized && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void act(() => api.flagsHint(session.id, current.id, requestId()))}
            >
              Show region hint (lowers this flag to 60 points)
            </Button>
          )}
        </form>
      )}

      {timeUp && <StatusMessage tone="warning">Time's up. Confirming your result…</StatusMessage>}
      {actionError && (
        <StatusMessage tone="error" retry={() => void load()}>
          {actionError}
        </StatusMessage>
      )}
      {autoContinue && !busy && <p className="ph-muted ph-geo-auto">Moving on automatically…</p>}

      {current && (finalized || !pickMode) && (
        <ActionBar label={finalized ? "Continue" : "Answer"}>
          {finalized ? (
            <Button variant="primary" size="lg" block loading={busy} onClick={() => void next()}>
              {session.answered >= session.total ? "See results" : "Next flag"}
            </Button>
          ) : (
            <>
              <Button
                size="lg"
                disabled={busy}
                onClick={() => void act(() => api.flagsSkip(session.id, current.id, requestId()))}
              >
                Skip
              </Button>
              <Button type="submit" form="ph-geo-flag-form" variant="primary" size="lg" loading={busy}>
                Check
              </Button>
            </>
          )}
        </ActionBar>
      )}

      <RoundMenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        timed={Boolean(session.timeLimitSeconds)}
        busy={busy || releasing}
        onLeave={() => void leave()}
        onGiveUp={() => void giveUp()}
      />
    </div>
  );
}

const statusText: Record<string, string> = {
  open: "",
  wrong: "Wrong",
  answer: "Correct flag",
  solved: "Found earlier",
  missed: "Answered earlier",
};

function FlagCell({
  choice,
  number,
  status,
  disabled,
  onPick,
}: {
  choice: FlagsChoice;
  number: number;
  status: string;
  disabled: boolean;
  onPick: () => void;
}) {
  const descId = choice.flagDescription ? `ph-geo-desc-${choice.id}` : undefined;
  const label = [
    `Flag ${number}`,
    statusText[status],
    status === "wrong" && choice.name ? choice.name : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <button
      type="button"
      className="ph-geo-cell"
      data-status={status}
      aria-label={label}
      aria-describedby={descId}
      disabled={disabled}
      onClick={onPick}
    >
      <FlagPicture url={choice.flagSvgUrl} label="" />
      <span className="ph-geo-cell-num" aria-hidden="true">
        {number}
      </span>
      {status !== "open" && (
        <span className="ph-geo-cell-mark" aria-hidden="true">
          <Icon name={status === "wrong" ? "close" : "check"} size={16} />
          {status === "wrong" && choice.name ? choice.name : statusText[status]}
        </span>
      )}
      {descId && (
        <span id={descId} className="sr-only">
          {choice.flagDescription}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------- Results

function FlagsResults() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  usePhoneChrome({ title: "Flags results", back: paths.flags });
  const { data, error, reload } = useLoad(() => api.flagsResults(id), id);
  const [replaying, setReplaying] = useState(false);
  const [message, setMessage] = useState("");

  if (error)
    return (
      <div className="ph-stack">
        <StatusMessage tone="error" retry={reload}>
          {errorText(error)}
        </StatusMessage>
        <LinkButton to={paths.flags} block>
          Back to Flags
        </LinkButton>
      </div>
    );
  if (!data) return <LoadingState label="Loading results…" />;
  if (data.state === "abandoned")
    return (
      <div className="ph-stack">
        <StatusMessage>This round was given up. It doesn't count towards personal bests.</StatusMessage>
        <LinkButton to={paths.flags} variant="primary" size="lg" block>
          Back to Flags
        </LinkButton>
      </div>
    );

  const result = data;
  const choice: GameChoice = flagsChoiceOf(result);
  const percent = (value: number) => (result.total ? Math.round((value / result.total) * 100) : 0);
  const byAttempt = [1, 2, 3].map(
    (attempt) => result.entries.filter((entry) => entry.outcome === "correct" && entry.attempts === attempt).length,
  );
  const review = [...result.entries].sort((a, b) => a.position - b.position);

  async function replay() {
    if (replaying) return;
    setReplaying(true);
    setMessage("");
    try {
      const next = await api.flagsStart(result.direction, result.region, result.poolTier, requestId(), roundOptions(choice));
      navigate(playPath(next.id));
    } catch (cause) {
      setMessage(errorText(cause));
      setReplaying(false);
    }
  }

  return (
    <div className="ph-stack">
      <Card className="ph-geo-hero">
        <p className="ph-geo-eyebrow">
          {directionName(result.direction)} · {regionLabel(result.region)}
        </p>
        <p className="ph-geo-score">
          <strong>{result.score}</strong> <span className="ph-muted">/ {result.maxScore} points</span>
        </p>
        <p className="ph-geo-badge" data-badge={result.finalBadge ?? "done"}>
          <Icon name={result.finalBadge === "new_best" ? "trophy" : "checkCircle"} size={18} />
          {badgeText(result.finalBadge, endedOnTime(result))}
        </p>
        <RoundTags tags={roundTagList({ ...result, pool: result.poolTier, picks: result.selectedCount })} />
      </Card>

      <dl className="ph-geo-stats">
        <div>
          <dt>Correct</dt>
          <dd>
            {result.correct}/{result.total} <small>{percent(result.correct)}%</small>
          </dd>
        </div>
        <div>
          <dt>Not solved</dt>
          <dd>{result.incorrect}</dd>
        </div>
        <div>
          <dt>Skipped</dt>
          <dd>{result.skipped}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>
            {formatClock(result.elapsedMs ?? 0)}
            {result.timeLimitSeconds ? <small> of {result.timeLimitSeconds / 60} min</small> : null}
          </dd>
        </div>
      </dl>
      <p className="ph-muted">
        {result.direction === "country_to_flag"
          ? `Found on the first try: ${byAttempt[0]} · second: ${byAttempt[1]} · third: ${byAttempt[2]}.`
          : `Region hints used: ${result.hintsUsed}.`}{" "}
        Time is measured by the server from the start of the round. There is no speed bonus.
      </p>

      <Section title={result.ranked === false ? "Practice round" : "Top five for this setup"}>
        {result.ranked === false ? (
          <p className="ph-muted">Random picks don't count for personal bests. Play the whole set to rank this setup.</p>
        ) : result.topFive.length ? (
          <ol className="ph-geo-top">
            {result.topFive.map((run, index) => (
              <li key={run.id} data-current={run.id === result.id ? "true" : undefined}>
                <b>#{index + 1}</b>
                <span>{run.score} points</span>
                <span>{formatClock(run.elapsedMs)}</span>
                {run.id === result.id && <span className="ph-geo-pill">This round</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="ph-muted">No completed runs yet.</p>
        )}
      </Section>

      <Section title={`Review · ${result.total} flags`}>
        <ol className="ph-geo-review">
          {review.map((entry) => (
            <li key={entry.id} data-outcome={entry.outcome}>
              <FlagPicture url={entry.flagSvgUrl} label="" className="is-small" />
              <div>
                <strong>{entry.name || "Catalog entry"}</strong>
                <p>
                  <Icon name={entry.outcome === "correct" ? "checkCircle" : "warning"} size={16} />{" "}
                  {entry.outcome === "correct"
                    ? `Correct · ${ordinal(entry.attempts)} try`
                    : entry.outcome === "skipped"
                      ? "Skipped"
                      : "Not solved"}{" "}
                  · {entry.points} points
                </p>
                {entry.hintUsed && <small className="ph-muted">Region hint used · 60 point maximum</small>}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <StatusMessage tone="error">{message}</StatusMessage>
      <LinkButton to={setupUrl("flags", choice)} block>
        Change settings
      </LinkButton>
      <ActionBar>
        <Button variant="primary" size="lg" loading={replaying} onClick={() => void replay()}>
          {replaying ? "Preparing…" : "Play again"}
        </Button>
      </ActionBar>
    </div>
  );
}
