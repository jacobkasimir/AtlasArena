// Phone quiz round at /quiz/play/:id. The server (or the demo engine) decides correctness, points, streaks
// and the deadline; this screen only shows its responses. Answers sit in the lower part of the screen,
// "Next" sticks in the action bar, and every action is guarded against double taps.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@shared/api";
import type { PlayableQuestion, Review, View } from "@shared/domain";
import { CALM_QUESTION_MS, autoContinueMs, prefersReducedMotion, showCountdown, useLeaveGuard, usePrefs } from "@shared/prefs";
import { modeNames } from "@shared/quiz-meta";
import { Icon } from "@shared/icons";
import { usePhonePrefs } from "@phone/prefs-phone";
import { TopBarActions, usePhoneChrome } from "@phone/shell/chrome";
import { paths } from "@phone/shell/paths";
import { useBackGuard } from "@phone/ui/useBackGuard";
import {
  ActionBar,
  AnswerButton,
  AnswerList,
  BottomSheet,
  Button,
  IconButton,
  LinkButton,
  LoadingState,
  ProgressBar,
  StatusMessage,
  useHaptics,
} from "@phone/ui";
import { capitalize, friendlyQuizError, isActive, optionState } from "./quiz-logic";

/** Taps on "Next" this soon after feedback appeared are treated as an accidental double tap. */
export const NEXT_TAP_GUARD_MS = 350;
const TIMED_ROUND_MS = 60_000;

function PauseIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M9 5v14M15 5v14" />
    </svg>
  );
}

export function QuizPlay() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const prefs = usePrefs();
  const { answerLayout } = usePhonePrefs();
  const haptics = useHaptics();

  const [view, setView] = useState<View>();
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  // The last answer finishes the run on the server; keep its feedback on screen until the player moves on.
  const [finalHold, setFinalHold] = useState<{ current: PlayableQuestion; feedback: Review } | null>(null);
  const [sheet, setSheet] = useState<"closed" | "menu" | "confirm">("closed");
  const [deleting, setDeleting] = useState(false);
  const offset = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const feedbackAt = useRef(0);
  const lastFeedbackKey = useRef("");
  const finished = useRef(false);
  const promptRef = useRef<HTMLHeadingElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const feedbackRef = useRef<HTMLElement>(null);

  const active = isActive(view);
  usePhoneChrome({
    title: view ? modeNames[view.mode] : "Quiz",
    back: active ? undefined : paths.quiz,
    hideTabBar: true,
  });
  useLeaveGuard(active);
  // Device Back / swipe-back during a run opens the pause sheet instead of leaving (the sheet's own entry
  // sits above the guard, so Back with the sheet open just closes it).
  const { release, releasing } = useBackGuard(active, () =>
    setSheet((current) => (current === "closed" ? "menu" : current)),
  );

  const accept = useCallback((next: View) => {
    offset.current = Date.parse(next.serverNow) - Date.now();
    setView((old) => (!old || old.id !== next.id || next.version >= old.version ? next : old));
  }, []);

  const refresh = useCallback(async () => {
    try {
      accept(await api.view(id));
      setLoadError("");
    } catch (cause) {
      setLoadError(friendlyQuizError((cause as Error).message));
    }
  }, [accept, id]);

  useEffect(() => {
    setView(undefined);
    setFinalHold(null);
    finished.current = false;
    void refresh();
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [id, refresh]);

  const shown: View | undefined =
    view && finalHold && view.status === "completed"
      ? { ...view, status: "showing_feedback", current: finalHold.current, feedback: finalHold.feedback }
      : view;
  const finalAnswer = Boolean(finalHold && view?.status === "completed");
  const feedback = shown?.status === "showing_feedback" ? shown.feedback : null;

  // Clock for timed runs only (the server re-checks the deadline on every call).
  const ticking = Boolean(view?.deadline && active);
  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [ticking]);
  // Timed runs pause at accepted answers while the player reads feedback.
  const remaining =
    shown?.deadline && shown.status === "awaiting_answer"
      ? Math.max(0, Date.parse(shown.deadline) - now - offset.current)
      : null;
  const timeUp = remaining === 0 && active;

  // Time is up: ask the server to confirm the final result (retrying while offline).
  useEffect(() => {
    if (!timeUp) return;
    void refresh();
    const retry = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(retry);
  }, [timeUp, refresh]);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    haptics.complete();
    release(() => navigate(`${paths.quiz}/results/${id}`, { replace: true }));
  }, [haptics, id, navigate, release]);

  // A run that completed without a held answer (time up, resumed finished run) goes straight to results.
  useEffect(() => {
    if (view?.status === "completed" && !finalHold) finish();
  }, [view?.status, finalHold, finish]);

  // New question: clear the local selection and move focus to the prompt when focus was lost.
  const questionKey = shown?.status === "awaiting_answer" ? `${shown.current?.id}:${shown.answered}` : "";
  useEffect(() => {
    if (!questionKey) return;
    setSelected(null);
    const focused = document.activeElement as HTMLElement | null;
    if (!focused || focused === document.body || (focused as HTMLButtonElement).disabled || !focused.isConnected)
      promptRef.current?.focus({ preventScroll: true });
  }, [questionKey]);

  // Feedback arrived: sound + vibration once, bring the explanation into view, focus "Next".
  const feedbackKey = feedback && shown ? `${shown.id}:${shown.answered}` : "";
  useEffect(() => {
    if (!feedbackKey || feedbackKey === lastFeedbackKey.current || !feedback) return;
    lastFeedbackKey.current = feedbackKey;
    feedbackAt.current = Date.now();
    if (feedback.correct) haptics.correct();
    else haptics.wrong();
    feedbackRef.current?.scrollIntoView?.({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    nextRef.current?.focus({ preventScroll: true });
  }, [feedbackKey, feedback, haptics]);

  async function act(kind: "answer" | "next", optionId?: string) {
    if (!view || pendingRef.current) return;
    if (kind === "answer") {
      if (view.status !== "awaiting_answer" || !view.current || timeUp || !optionId) return;
      haptics.tap();
      setSelected(optionId);
    }
    pendingRef.current = true;
    setPending(true);
    setActionError("");
    try {
      const before = view.current;
      const next = kind === "answer" ? await api.answer(id, before!.id, optionId!) : await api.next(id);
      if (kind === "answer" && next.status === "completed" && before) {
        const review =
          next.reviews.find((item) => item.questionId === before.id) ?? next.feedback ?? next.reviews.at(-1);
        if (review) setFinalHold({ current: before, feedback: review });
      }
      accept(next);
    } catch (cause) {
      setSelected(null);
      setActionError(`${friendlyQuizError((cause as Error).message)} Check your connection and try again.`);
      void refresh();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  function continueOn(force = false) {
    if (pendingRef.current) return;
    if (!force && Date.now() - feedbackAt.current < NEXT_TAP_GUARD_MS) return;
    if (finalAnswer) finish();
    else void act("next");
  }

  const autoContinue = Boolean(feedbackKey && prefs.autoContinue && feedback?.correct && sheet === "closed");
  useEffect(() => {
    if (!autoContinue) return;
    const timer = window.setTimeout(() => continueOn(true), autoContinueMs(prefs.autoContinueSpeed));
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoContinue, feedbackKey, prefs.autoContinueSpeed]);

  async function deleteRun() {
    if (deleting || releasing) return;
    setDeleting(true);
    setActionError("");
    try {
      await api.deleteRun(id);
      finished.current = true;
      release(() => navigate(paths.quiz, { replace: true }));
    } catch (cause) {
      setActionError(friendlyQuizError((cause as Error).message));
      setDeleting(false);
    }
  }

  if (!shown)
    return loadError ? (
      <div className="ph-stack">
        <StatusMessage tone="error" retry={() => void refresh()}>
          {loadError}
        </StatusMessage>
        <LinkButton to={paths.quiz} block>
          Back to quiz setup
        </LinkButton>
      </div>
    ) : (
      <LoadingState label="Loading your round…" />
    );

  if (shown.status === "abandoned")
    return (
      <div className="ph-stack">
        <StatusMessage>This run was abandoned.</StatusMessage>
        <LinkButton to={paths.quiz} variant="primary" size="lg" block>
          Start a new round
        </LinkButton>
      </div>
    );

  const question = shown.current;
  const questionNumber = Math.min(shown.answered + 1, shown.total);
  const lives = Math.max(0, 3 - shown.stats.incorrect);
  const answersDisabled = pending || shown.status !== "awaiting_answer" || timeUp;

  return (
    <div className="ph-quiz-play" data-feedback={feedback ? (feedback.correct ? "correct" : "wrong") : undefined}>
      <TopBarActions>
        {active && !finalAnswer && (
          <IconButton
            label={shown.deadline ? "Round menu" : "Pause or leave"}
            aria-haspopup="dialog"
            onClick={() => setSheet("menu")}
            disabled={deleting || releasing}
          >
            <PauseIcon />
          </IconButton>
        )}
      </TopBarActions>

      <div className="ph-quiz-hud" aria-label="Round status" role="group">
        <span className="ph-quiz-tag" data-level={question?.difficulty ?? shown.difficulty}>
          {capitalize(question?.difficulty ?? shown.difficulty)}
        </span>
        <span className="ph-quiz-hud-item">
          <span className="ph-muted">Score</span> <strong>{shown.stats.score.toLocaleString()}</strong>
        </span>
        <span className="ph-quiz-hud-item">
          <Icon name="flame" size={16} /> <span className="sr-only">Streak </span>
          <strong>{shown.stats.streak}</strong>
        </span>
        {shown.mode === "endless" && (
          <span className="ph-quiz-hud-item" aria-label={`${lives} of 3 lives left`}>
            <span aria-hidden="true" className="ph-quiz-lives">
              {[0, 1, 2].map((index) => (
                <span key={index} data-alive={index < lives ? "true" : "false"}>
                  ♥
                </span>
              ))}
            </span>
          </span>
        )}
      </div>

      {shown.mode === "classic" || shown.mode === "practice" ? (
        <ProgressBar value={shown.answered} max={shown.total} label={`Question ${questionNumber} of ${shown.total}`} showValue />
      ) : (
        <p className="ph-muted ph-quiz-count-line">
          Question {shown.answered + (shown.status === "awaiting_answer" ? 1 : 0)}
        </p>
      )}

      {shown.deadline && <TimerBar remaining={remaining} calm={prefs.timerDisplay === "calm"} />}

      <div className="ph-quiz-stage">
        {question && (
          <>
            <h2 ref={promptRef} tabIndex={-1} className="ph-quiz-prompt">
              {question.prompt}
            </h2>
            <AnswerList layout={answerLayout} label="Answers">
              {question.options.map((option, index) => (
                <AnswerButton
                  key={option.id}
                  index={index}
                  state={optionState(option.label, option.id, feedback, selected)}
                  disabled={answersDisabled}
                  onSelect={() => void act("answer", option.id)}
                >
                  {option.label}
                </AnswerButton>
              ))}
            </AnswerList>
          </>
        )}
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {feedback
          ? feedback.correct
            ? `Correct. Plus ${feedback.points} points.`
            : `Not quite. The correct answer is ${feedback.correctAnswer}.`
          : timeUp
            ? "Time is up."
            : ""}
      </div>

      {feedback && (
        <section ref={feedbackRef} className="ph-quiz-feedback ph-card" data-correct={feedback.correct} aria-label="Answer feedback">
          <div className="ph-quiz-feedback-head">
            <Icon name={feedback.correct ? "checkCircle" : "warning"} size={24} />
            <h3>{feedback.correct ? "Correct" : "Not quite"}</h3>
            <strong className="ph-quiz-points">+{feedback.points} pts</strong>
          </div>
          {!feedback.correct && (
            <p>
              <span className="ph-muted">Correct answer: </span>
              <strong>{feedback.correctAnswer}</strong>
            </p>
          )}
          {feedback.explanation && <p className="ph-quiz-explanation">{feedback.explanation}</p>}
          {feedback.source && (
            <a className="ph-quiz-source" href={feedback.source} target="_blank" rel="noopener noreferrer">
              Source reference<span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </section>
      )}

      {timeUp && <StatusMessage tone="warning">Time is up. Confirming your final result…</StatusMessage>}
      {actionError && (
        <StatusMessage tone="error" retry={() => void refresh()}>
          {actionError}
        </StatusMessage>
      )}

      {autoContinue && !pending && (
        <p className="ph-muted ph-quiz-auto">Moving on automatically…</p>
      )}
      {feedback && (
        <ActionBar label="Continue">
          <Button
            ref={nextRef}
            variant="primary"
            size="lg"
            block
            loading={pending}
            onClick={() => continueOn()}
          >
            {finalAnswer ? "See results" : "Next question"}
          </Button>
        </ActionBar>
      )}

      <BottomSheet
        open={sheet !== "closed"}
        onClose={() => setSheet("closed")}
        canClose={() => !deleting && !releasing}
        title={sheet === "confirm" ? "Delete this run?" : shown.deadline ? "Leave this round?" : "Paused"}
      >
        {sheet === "confirm" ? (
          <div className="ph-stack">
            <p>This deletes the run and its progress. It won't count towards your record.</p>
            <Button variant="danger" block loading={deleting} onClick={() => void deleteRun()}>
              Delete run
            </Button>
            <Button block disabled={deleting || releasing} onClick={() => setSheet("menu")}>
              Keep it
            </Button>
          </div>
        ) : (
          <div className="ph-stack">
            <p className="ph-muted">
              Your progress is saved. Leave now and resume it later from the quiz screen.
              {shown.deadline ? " This timed challenge keeps running while you are away." : ""}
            </p>
            <Button variant="primary" size="lg" block disabled={releasing} onClick={() => setSheet("closed")}>
              Continue playing
            </Button>
            {/* The sheet's and the Back guard's entries are removed first; the run's entry becomes the setup
                screen, so Back from there goes to where the player was before the run. */}
            <Button
              block
              loading={releasing && !deleting}
              disabled={deleting}
              onClick={() => release(() => navigate(paths.quiz, { replace: true }))}
            >
              Save and leave
            </Button>
            <Button
              variant="danger"
              block
              disabled={releasing && !deleting}
              loading={deleting}
              onClick={() => (prefs.confirmGiveUp ? setSheet("confirm") : void deleteRun())}
            >
              Delete run
            </Button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

function TimerBar({ remaining, calm }: { remaining: number | null; calm: boolean }) {
  if (remaining === null)
    return <p className="ph-quiz-timer is-paused">Timer paused while you review</p>;
  if (!showCountdown({ timerDisplay: calm ? "calm" : "always" }, remaining, CALM_QUESTION_MS))
    return <p className="ph-quiz-timer is-paused">The countdown appears for the last {CALM_QUESTION_MS / 1000} seconds</p>;
  const seconds = Math.ceil(remaining / 1000);
  return (
    <div className="ph-quiz-timer" data-low={seconds <= 10 ? "true" : undefined}>
      <div className="ph-quiz-timer-label" aria-hidden="true">
        <span>Time left</span>
        <strong>{seconds}s</strong>
      </div>
      <div
        className="ph-quiz-timer-track"
        role="progressbar"
        aria-label="Time left"
        aria-valuemin={0}
        aria-valuemax={TIMED_ROUND_MS / 1000}
        aria-valuenow={seconds}
        aria-valuetext={`${seconds} seconds left`}
      >
        <span style={{ width: `${Math.min(100, (remaining / TIMED_ROUND_MS) * 100)}%` }} />
      </div>
    </div>
  );
}
