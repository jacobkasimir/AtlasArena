// OWNER: geo area agent. Phone Capitals under /capitals/*: setup → play → results.
// Players type from memory: no autocomplete and no suggestions (CLAUDE.md "Capitals answer matching").
// The server accepts English, German and French names and answers "be more specific" for a name shared by
// several places; accepted answers are only shown after the server has finished the question.
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, isDemo } from "@shared/api";
import type { CapitalDirection, CapitalEntry, CapitalSession, CapitalSetup } from "@shared/domain";
import {
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
  ComboToast,
  GameButton,
  IconButton,
  LinkButton,
  LoadingState,
  MoreLink,
  ProgressBar,
  ResultHero,
  RetryMissedCard,
  Section,
  StatGrid,
  StatTile,
  StatusMessage,
  StreakMeter,
  TextField,
  useFeel,
} from "@phone/ui";
import {
  AnswerReveal,
  FeedbackLine,
  RoundClock,
  RoundMenuSheet,
  RoundTags,
  errorText,
  roundTagList,
  useAnswerFx,
  useRoundTimer,
  useTapGuard,
} from "./common";
import {
  Feedback,
  NEXT_TAP_GUARD_MS,
  capitalsActionFeedback,
  capitalsAnswerFeel,
  capitalsChoiceOf,
  capitalsEntryFeedback,
  isRanked,
  mistakesFirst,
  outcomeWord,
  requestId,
  resultHeadline,
  roundStreak,
} from "./geo-logic";
import { GeoSetup } from "./setup";
import "./geo.css";

const directions: { id: CapitalDirection; title: string; text: string }[] = [
  { id: "country_to_capital", title: "Country → Capital", text: "See a country. Type one of its capitals." },
  { id: "capital_to_country", title: "Capital → Country", text: "See a capital. Type its country." },
];
const directionName = (direction: CapitalDirection) =>
  directions.find((item) => item.id === direction)?.title ?? "Capitals";
const playPath = (id: string) => `${paths.capitals}/play/${id}`;
const resultsPath = (id: string) => `${paths.capitals}/results/${id}`;

export default function CapitalsArea() {
  return (
    <Routes>
      <Route index element={<CapitalsSetupScreen />} />
      <Route path="play/:id" element={<CapitalsPlay />} />
      <Route path="session/:id" element={<CapitalsPlay />} />
      <Route path="results/:id" element={<CapitalsResults />} />
      <Route path="*" element={<CapitalsSetupScreen />} />
    </Routes>
  );
}

// ---------------------------------------------------------------- Setup

function CapitalsSetupScreen() {
  usePhoneChrome({ title: "Capitals", back: paths.games });
  const { data, error, reload } = useLoad<CapitalSetup>(() => api.capitalsSetup());
  const bests = useLoad<PersonalBest[]>(() => api.personalBests());
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initial = useMemo(
    () => initialChoice("capitals", params, directions.map((item) => item.id)),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (error)
    return (
      <StatusMessage tone="error" retry={reload}>
        {errorText(error)}
      </StatusMessage>
    );
  if (!data) return <LoadingState label="Loading Capitals…" />;

  const places: SetupPlace[] = data.countries.map((country) => ({
    code: country.code,
    name: country.name,
    region: country.region,
    un: Boolean(country.un),
    easy: country.difficulty === "easy" || country.difficulty === "medium",
    alpha2: country.catalogKind === "iso_alpha2" ? country.codeAlpha2 : null,
    modes: [
      ...(country.countryToCapitalEligible ? ["country_to_capital"] : []),
      ...(country.capitalToCountryEligible ? ["capital_to_country"] : []),
    ],
    unModes: [
      ...(country.countryToCapitalEligible ? ["country_to_capital"] : []),
      ...((country.unCapitalToCountryEligible ?? country.capitalToCountryEligible) ? ["capital_to_country"] : []),
    ],
  }));

  return (
    <GeoSetup
      game="capitals"
      intro="Each country (or capital) in your set comes up once. Type the answer from memory – English, German or French all count. 100 points each."
      modes={directions.map((item) => ({
        value: item.id,
        icon: item.id === "country_to_capital" ? "capital" : "map",
        title: item.title,
        text: item.text,
      }))}
      places={places}
      regions={data.regions.map((region) => ({ id: region, name: region }))}
      unit={(count) => (count === 1 ? "question" : "questions")}
      initial={initial}
      bests={bests.error ? null : (bests.data ?? [])}
      resume={data.activeSessions.map((s) => ({
        id: s.id,
        title: directionName(s.direction),
        detail:
          describeSetup({
            scope: s.scope ?? "all",
            region: s.region,
            pool: s.poolMode,
            picks: s.selectedCount,
            size: s.sampleSize,
            limit: s.timeLimitSeconds ?? null,
          }) + ` · ${s.answered}/${s.total} · ${s.score} pts`,
        to: playPath(s.id),
      }))}
      onStart={async (choice) => {
        const session = await api.capitalsStart(
          choice.mode as CapitalDirection,
          choice.pool,
          choice.pool === "manual" ? choice.picks : [],
          choice.region,
          requestId(),
          roundOptions(choice),
        );
        navigate(playPath(session.id));
      }}
    />
  );
}

// ---------------------------------------------------------------- Play

function CapitalsPlay() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const prefs = usePrefs();
  const feel = useFeel();
  const answerFx = useAnswerFx();
  const [session, setSession] = useState<CapitalSession | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [timeUp, setTimeUp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  usePhoneChrome({ title: "Capitals", hideTabBar: true });
  const active = session?.state === "active";
  useLeaveGuard(active);
  // Device Back / swipe-back during a round opens "Pause or leave" instead of leaving the round.
  const { release, releasing } = useBackGuard(active, () => setMenuOpen(true));

  const finish = useCallback(
    (done: CapitalSession) => {
      // ResultHero on the results screen plays the round-complete feedback once.
      // Results replace the round's entry, so Back from them never lands in the finished round again.
      release(() => navigate(resultsPath(done.id), { replace: true }));
    },
    [navigate, release],
  );

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const loaded = await api.capitalsView(id);
      if (loaded.state === "completed") return finish(loaded);
      setSession(loaded);
      setFeedback(capitalsEntryFeedback(loaded.current));
    } catch (cause) {
      setLoadError(errorText(cause));
    }
  }, [id, finish]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = session?.current ?? null;
  const finalized = Boolean(current && current.outcome !== "pending");
  const canTapNext = useTapGuard(finalized && current ? current.id : null, NEXT_TAP_GUARD_MS);

  useEffect(() => {
    if (!current) return;
    setAnswer("");
    answerFx.clear();
    if (current.outcome === "pending") window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { elapsed, remaining } = useRoundTimer(session, active && !timeUp);

  // Time is up: the server ends the round (open questions count as skipped) – ask it, then show the results.
  useEffect(() => {
    if (remaining !== 0 || !session || timeUp) return;
    setTimeUp(true);
    api
      .capitalsView(session.id)
      .then((view) => {
        if (view.state === "completed") finish(view);
        else setSession(view);
      })
      .catch((cause) => setActionError(errorText(cause)));
  }, [remaining === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(run: () => Promise<CapitalSession>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setActionError("");
    try {
      const next = await run();
      // Exactly one answer feedback per answer the server accepted and judged. "Be more specific" uses no
      // attempt: a light select tick only, and the field stays focused so the keyboard stays open.
      const outcome = next.actionResult?.outcome;
      const verdict = capitalsAnswerFeel(outcome);
      if (verdict === "right" || verdict === "wrong") {
        feel.answer(verdict === "right", roundStreak(next));
        answerFx.play(verdict === "right" ? "pop" : "shake");
      } else if (verdict === "gentle") feel.select();
      if (next.state === "completed") return finish(next);
      setSession(next);
      setFeedback(capitalsActionFeedback(next) ?? capitalsEntryFeedback(next.current));
      if (outcome === "ambiguous")
        window.setTimeout(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        }, 0);
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
      const moved = await api.capitalsNext(session.id, requestId());
      if (moved.state === "completed") return finish(moved);
      setSession(moved);
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

  function submit(event: FormEvent) {
    event.preventDefault();
    // "Go" on the keyboard after feedback moves on, so one hand can play the whole round.
    if (finalized) return void next();
    if (!session || !current || busy) return;
    if (!answer.trim()) {
      setFeedback({ tone: "info", text: "Type an answer first." });
      inputRef.current?.focus();
      return;
    }
    void act(() => api.capitalsAnswer(session.id, current.id, answer, null, requestId()));
  }

  function skip() {
    if (!session || !current || busy || finalized) return;
    void act(() => api.capitalsSkip(session.id, current.id, requestId()));
  }

  async function giveUp() {
    if (!session || busy || releasing) return;
    setBusy(true);
    try {
      await api.capitalsAbandon(session.id, requestId());
      release(() => navigate(paths.capitals, { replace: true }));
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
        <LinkButton to={paths.capitals} block>
          Back to Capitals
        </LinkButton>
      </div>
    ) : (
      <LoadingState label="Loading your round…" />
    );

  if (session.state === "abandoned")
    return (
      <div className="ph-stack">
        <StatusMessage>This round was given up. Rounds you give up don't count towards personal bests.</StatusMessage>
        <LinkButton to={paths.capitals} variant="primary" size="lg" block>
          Back to Capitals
        </LinkButton>
      </div>
    );

  const position = current?.position ?? Math.min(session.answered + 1, session.total);
  const toCapital = session.direction === "country_to_capital";
  const accepted = finalized ? (current?.acceptedAnswers ?? []) : [];
  const streak = roundStreak(session);
  const missedIt = finalized && current?.outcome !== "correct";
  const mainAnswer = accepted.find((item) => item.primary) ?? accepted[0];
  // After a miss the main answer is shown big; the card lists only the other accepted names.
  const others = missedIt && mainAnswer ? accepted.filter((item) => item !== mainAnswer) : accepted;

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
        <StreakMeter streak={streak} />
        <RoundClock
          remaining={remaining}
          elapsed={elapsed}
          totalMs={session.timeLimitSeconds ? session.timeLimitSeconds * 1000 : null}
        />
      </div>
      <ComboToast streak={streak} />
      <ProgressBar
        value={session.answered}
        max={session.total}
        label={`Question ${position} of ${session.total}`}
        showValue
      />
      <RoundTags
        tags={[
          directionName(session.direction),
          regionLabel(session.region),
          ...roundTagList({ ...session, pool: session.poolMode, picks: session.selectedCodes.length }),
        ]}
      />

      {current && (
        <form id="ph-geo-capital-form" className="ph-geo-identify" onSubmit={submit} noValidate>
          <p className="ph-geo-eyebrow">{toCapital ? "Name a capital of" : "Which country has the capital"}</p>
          <h2 className="ph-geo-prompt">{current.prompt}</h2>
          <div
            className={`ph-geo-answer-row ${answerFx.className}`}
            data-result={finalized ? current.outcome : undefined}
          >
          <TextField
            ref={inputRef}
            label={toCapital ? "Capital" : "Country"}
            hint="No suggestions – type it from memory in English, German or French. Accents, capital letters, hyphens and spaces don't matter."
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            readOnly={busy || finalized}
            aria-busy={busy || undefined}
            placeholder={toCapital ? "Type the capital" : "Type the country"}
            maxLength={200}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            inputMode="text"
          />
          </div>
          <FeedbackLine feedback={feedback} />
          {missedIt && mainAnswer && (
            <AnswerReveal label={toCapital ? "The capital is" : "The country is"} answer={mainAnswer.name} />
          )}
          {finalized && current && (others.length > 0 || !missedIt || !mainAnswer || current.catalogKind === "non_iso" || current.sourceLinks.length > 0) && (
            <div className="ph-geo-reveal ph-card">
              {others.length > 0 ? (
                <>
                  <p className="ph-muted">
                    {missedIt && mainAnswer ? "Also accepted" : toCapital ? "Accepted capital names" : "Country"}
                  </p>
                  <ul className="ph-geo-accepted">
                    {others.map((item, index) => (
                      <li key={`${item.name}-${index}`}>
                        <strong>{item.name}</strong>
                        {item.primary && <small>Primary</small>}
                        {item.roles.length > 0 && <small>{item.roles.join(" · ")}</small>}
                      </li>
                    ))}
                  </ul>
                </>
              ) : !mainAnswer ? (
                <p>Accepted answers are not available.</p>
              ) : null}
              {current.catalogKind === "non_iso" && (
                <p className="ph-muted">This place has no official ISO country code.</p>
              )}
              {current.sourceLinks.length > 0 && (
                <p className="ph-geo-links">
                  {current.sourceLinks.map((link) => (
                    <a key={`${link.url}-${link.label}`} href={link.url} target="_blank" rel="noopener noreferrer">
                      {link.label}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ))}
                </p>
              )}
            </div>
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

      {current && (
        <ActionBar label={finalized ? "Continue" : "Answer"}>
          {finalized ? (
            <GameButton variant="primary" size="lg" block loading={busy} onClick={() => void next()}>
              {session.answered >= session.total ? "See results" : "Next question"}
            </GameButton>
          ) : (
            <>
              <GameButton variant="secondary" size="lg" disabled={busy} onClick={skip}>
                Skip
              </GameButton>
              <GameButton
                type="submit"
                form="ph-geo-capital-form"
                variant="primary"
                size="lg"
                loading={busy}
                // Keep focus (and the keyboard) in the answer field while submitting.
                onPointerDown={(event) => event.preventDefault()}
                onMouseDown={(event) => event.preventDefault()}
              >
                Submit
              </GameButton>
            </>
          )}
        </ActionBar>
      )}

      <RoundMenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        timed={Boolean(session.timeLimitSeconds)}
        busy={busy || releasing}
        onLeave={() => release(() => navigate(paths.capitals, { replace: true }))}
        onGiveUp={() => void giveUp()}
        leaveLabel={session.timeLimitSeconds ? "Leave (clock keeps running)" : "Leave – round is saved"}
      />
    </div>
  );
}

// ---------------------------------------------------------------- Results

function CapitalsResults() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  usePhoneChrome({ title: "Capitals results", back: paths.capitals });
  const { data, error, reload } = useLoad(() => api.capitalsResults(id), id);
  const [replaying, setReplaying] = useState(false);
  const [message, setMessage] = useState("");

  if (error)
    return (
      <div className="ph-stack">
        <StatusMessage tone="error" retry={reload}>
          {errorText(error)}
        </StatusMessage>
        <LinkButton to={paths.capitals} block>
          Back to Capitals
        </LinkButton>
      </div>
    );
  if (!data) return <LoadingState label="Loading results…" />;
  if (data.state === "abandoned")
    return (
      <div className="ph-stack">
        <StatusMessage>This round was given up. It doesn't count towards personal bests.</StatusMessage>
        <LinkButton to={paths.capitals} variant="primary" size="lg" block>
          Back to Capitals
        </LinkButton>
      </div>
    );

  const result = data;
  const choice = capitalsChoiceOf(result);
  const ranked = isRanked(result);
  const timeUp = endedOnTime(result);
  const review = mistakesFirst(result.entries);
  const missed = review.filter((entry) => entry.outcome === "incorrect" || entry.outcome === "skipped");
  const solved = review.filter((entry) => entry.outcome === "correct");
  const note =
    result.finalBadge === "first_run" || result.finalBadge === "not_best" || timeUp
      ? badgeText(ranked ? result.finalBadge : "unranked", timeUp)
      : null;

  async function replay() {
    if (replaying) return;
    setReplaying(true);
    setMessage("");
    try {
      const next = await api.capitalsStart(
        result.direction,
        result.poolMode,
        result.poolMode === "manual" ? result.selectedCodes : [],
        result.region,
        requestId(),
        roundOptions(choice),
      );
      navigate(playPath(next.id));
    } catch (cause) {
      setMessage(errorText(cause));
      setReplaying(false);
    }
  }

  const reviewItem = (entry: CapitalEntry) => (
    <li key={entry.id} data-outcome={entry.outcome}>
      <span className="ph-geo-review-num">Q{entry.position}</span>
      <div>
        <strong>{entry.prompt}</strong>
        <p>
          <Icon name={entry.outcome === "correct" ? "checkCircle" : entry.outcome === "skipped" ? "warning" : "close"} size={16} />{" "}
          {outcomeWord(entry.outcome)} · {entry.points} points
        </p>
        {entry.submittedAnswer && entry.outcome !== "correct" && (
          <p className="ph-muted">
            Your answer: <b>{entry.submittedAnswer}</b>
          </p>
        )}
        <p>
          <span className="ph-muted">
            {entry.outcome === "correct" ? "Accepted" : "Answer"}
            {(entry.acceptedAnswers?.length ?? 0) === 1 ? "" : "s"}:{" "}
          </span>
          <b>{entry.acceptedAnswers?.map((item) => item.name).join(", ") || "Not available"}</b>
        </p>
      </div>
    </li>
  );

  return (
    <div className="ph-stack">
      <ResultHero
        headline={resultHeadline(result.correct, result.total, timeUp)}
        tone="capitals"
        icon="capital"
        score={result.score}
        scoreLabel={`Points of ${result.total * 100}`}
        correct={result.correct}
        total={result.total}
        timeMs={result.elapsedMs}
        ranked={ranked}
        newBest={ranked && result.finalBadge === "new_best"}
      >
        <p className="ph-geo-eyebrow ph-geo-hero-setup">
          {directionName(result.direction)} · {regionLabel(result.region)}
        </p>
        {note && <p className="ph-geo-hero-note">{note}</p>}
        <RoundTags tags={roundTagList({ ...result, pool: result.poolMode, picks: result.selectedCodes.length })} />
      </ResultHero>

      <RetryMissedCard
        count={missed.length}
        tone="capitals"
        text="Play this setup again and type them from memory – a fresh round asks every question once more."
        cta="Play this setup again"
        loading={replaying}
        onRetry={() => void replay()}
      />
      {missed.length > 0 && !isDemo && (
        <p className="ph-geo-review-link">
          <MoreLink to={`${paths.quiz}/review`}>Review my mistakes</MoreLink>
        </p>
      )}

      <StatGrid label="Round details">
        <StatTile label="Incorrect" value={result.incorrect} icon="close" />
        <StatTile label="Skipped" value={result.skipped} icon="warning" />
        <StatTile
          label="Time"
          value={formatClock(result.elapsedMs ?? 0)}
          icon="timer"
          hint={result.timeLimitSeconds ? `of ${result.timeLimitSeconds / 60} min` : undefined}
        />
      </StatGrid>
      <p className="ph-muted">
        Accuracy is correct answers divided by all questions; skipped questions stay in the count. Time is measured
        by the server and includes feedback screens and time away.
      </p>

      {missed.length > 0 && (
        <Section title={`Missed · ${missed.length}`}>
          <ol className="ph-geo-review">{missed.map(reviewItem)}</ol>
        </Section>
      )}
      {solved.length > 0 && (
        <Section title={`Correct · ${solved.length}`}>
          <ol className="ph-geo-review">{solved.map(reviewItem)}</ol>
        </Section>
      )}

      <Section title={ranked ? "Five best for this setup" : "Practice round"}>
        {!ranked ? (
          <p className="ph-muted">Random picks don't count for personal bests. Play the whole set to rank this setup.</p>
        ) : result.topFive.length ? (
          <ol className="ph-geo-top">
            {result.topFive.map((run, index) => (
              <li key={`${run.completedAt}-${index}`}>
                <b>#{index + 1}</b>
                <span>{run.score} points</span>
                <span>{formatClock(run.elapsedMs)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="ph-muted">Complete a round to start your personal best list.</p>
        )}
      </Section>

      <StatusMessage tone="error">{message}</StatusMessage>
      <LinkButton to={setupUrl("capitals", choice)} block>
        Change settings
      </LinkButton>
      <ActionBar>
        <GameButton variant="primary" size="lg" block loading={replaying} onClick={() => void replay()}>
          {replaying ? "Preparing…" : "Play again"}
        </GameButton>
      </ActionBar>
    </div>
  );
}
