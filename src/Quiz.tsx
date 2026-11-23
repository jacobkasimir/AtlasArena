import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { GuestSessionRecovery } from "./Auth";
import { EditQuestionButton } from "./QuestionEditor";
import { track } from "./analytics";
import { api } from "./api";
import { ErrorBox, Feedback, Loading, useLoad } from "./components";
import {
  Difficulty,
  Mode,
  PlayableQuestion,
  Review,
  View,
  categories,
  challengeSetupUrl,
  difficulties,
  rank,
  modes,
  setsNewPersonalBest,
} from "./domain";
import { AUTO_CONTINUE_MS, haptic, isIOS, loadSetup, oneOf, saveSetup, usePrefs } from "./prefs";
import { accuracy, modeDescriptions, modeIcons, modeNames } from "./quiz-meta";
import {
  AutoContinueBar,
  Chips,
  ModePage,
  OptionCards,
  ResumeList,
  SetupForm,
  SideCard,
  StartBar,
  Step,
  StreakBadge,
} from "./setup-ui";

/** True for signed-in admins; the server checks again on every admin call. */
function useIsAdmin() {
  const context = useOutletContext<{ isAdmin?: boolean } | undefined>();
  return Boolean(context?.isAdmin);
}

function accuracyLine(correct: number, incorrect: number) {
  const total = correct + incorrect;
  const share = total ? correct / total : 0;
  return share >= 0.8 ? "Great run!" : share >= 0.5 ? "Solid run." : total ? "Keep practising." : "Run complete.";
}

export function QuizSetup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const saved = useMemo(() => loadSetup("quiz"), []);
  const [mode, setMode] = useState<Mode>(oneOf(params.get("mode") ?? saved.mode, modes, "classic"));
  const [difficulty, setDifficulty] = useState<Difficulty>(
    oneOf(params.get("difficulty") ?? saved.difficulty, difficulties, "easy"),
  );
  const [category, setCategory] = useState<string>(
    oneOf(params.get("category") ?? saved.category, ["all", ...categories], "all"),
  );
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const { data, error: loadError, reload } = useLoad(() => api.dashboard());
  const catalog = useLoad(() => api.quizCatalog().catch(() => null));
  const country = params.get("country") ?? undefined;
  const countParam = Number(params.get("count"));
  const questionCount =
    Number.isInteger(countParam) && countParam >= 1 && countParam <= 10
      ? countParam
      : country && mode === "practice"
        ? 4
        : 10;

  useEffect(() => {
    const target = location.hash ? document.querySelector(location.hash) : null;
    target?.scrollIntoView({ block: "center" });
  }, []);

  async function start(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    saveSetup("quiz", { mode, difficulty, category });
    try {
      const s = await api.play(mode, category === "all" ? [] : [category], difficulty, country, questionCount);
      track("game_started", { mode, category, difficulty });
      navigate("/play/" + s.id);
    } catch (e) {
      setError(friendlyQuizError((e as Error).message));
    } finally {
      setPending(false);
    }
  }

  const unfinished =
    data?.sessions.filter((s) => s.status === "awaiting_answer" || s.status === "showing_feedback") ?? [];
  // Published question counts per topic, difficulty and type (null until loaded or when unavailable).
  const rows = Array.isArray(catalog.data) ? catalog.data : null;
  const needed = mode === "classic" ? 10 : mode === "practice" ? questionCount : 1;
  const available = (topic: string, level: Difficulty) =>
    rows
      ? rows
          .filter((row) => (topic === "all" || row.topic === topic)
            && (mode === "endless" ? rank(row.difficulty) >= rank(level) : row.difficulty === level)
            && (mode !== "classic" || row.kind === "mc"))
          .reduce((sum, row) => sum + row.count, 0)
      : null;
  const enough = (topic: string, level: Difficulty) => {
    const count = available(topic, level);
    return count === null || count >= needed;
  };
  const roundSize =
    mode === "timed"
      ? { count: 60, unit: "seconds" }
      : mode === "endless"
        ? { count: 3, unit: "lives" }
        : { count: questionCount, unit: "questions" };
  const side = (
    <>
      <SideCard title="Unfinished games">
        <ResumeList
          empty="None – a game you leave is kept here until you finish it."
          items={unfinished.map((s) => ({
            id: s.id,
            title: modeNames[s.mode],
            detail: `${s.difficulty} · ${s.correct + s.incorrect} answered · ${s.score} pts`,
            to: "/play/" + s.id,
            done: s.correct + s.incorrect,
            total: s.mode === "classic" || s.mode === "practice" ? 10 : s.correct + s.incorrect,
          }))}
        />
      </SideCard>
      {data && (
        <SideCard title="Your quiz record">
          <ul className="side-list">
            <li>
              <span className="muted">Games finished</span>
              <strong>{data.totals.games}</strong>
            </li>
            <li>
              <span className="muted">Accuracy</span>
              <strong>{accuracy(data.totals.correct, data.totals.incorrect)}</strong>
            </li>
            {modes
              .filter((m) => m !== "practice")
              .map((m) => (
                <li key={m}>
                  <span className="muted">{modeNames[m]} best</span>
                  <strong>{data.best[m]?.toLocaleString() ?? "—"}</strong>
                </li>
              ))}
          </ul>
        </SideCard>
      )}
    </>
  );

  return (
    <ModePage
      eyebrow="Atlas Quiz"
      title="Ready for a round?"
      intro="Four ways to play, four difficulty tiers and a topic of your choice."
      side={side}
    >
      <SetupForm onSubmit={start}>
        <ErrorBox message={loadError} retry={reload} />
        {loadError.includes("AUTH_REQUIRED") && <GuestSessionRecovery retry={reload} />}
        <Step n={1} title="Choose a mode">
          <OptionCards
            value={mode}
            onChange={setMode}
            options={modes.map((m) => ({
              value: m,
              icon: modeIcons[m],
              title: modeNames[m],
              text: modeDescriptions[m],
              footer:
                m !== "practice" && data?.best[m] != null ? (
                  <span>Best: {data.best[m]!.toLocaleString()}</span>
                ) : undefined,
            }))}
          />
        </Step>
        <Step
          n={2}
          title={mode === "endless" ? "Starting difficulty" : "Difficulty"}
          hint={mode === "endless" ? "Endless unlocks the next tier after every five correct answers." : undefined}
        >
          <div id="difficulty-picker">
            <Chips
              label="Difficulty"
              value={difficulty}
              onChange={setDifficulty}
              options={difficulties.map((d) => ({
                value: d,
                label: d[0].toUpperCase() + d.slice(1),
                count: available(category, d) ?? undefined,
                disabled: !enough(category, d) && d !== difficulty,
              }))}
            />
          </div>
        </Step>
        <Step
          n={3}
          title="Topic"
          hint={rows && !country ? `Numbers show the published questions for this mode and difficulty${needed > 1 ? ` – a round needs ${needed}` : ""}.` : undefined}
        >
          <Chips
            label="Topic"
            value={category}
            onChange={setCategory}
            options={[
              { value: "all", label: "Everything", count: available("all", difficulty) ?? undefined },
              ...categories
                .filter((c) => !rows || c === category || rows.some((row) => row.topic === c))
                .map((c) => ({
                  value: c,
                  label: c[0].toUpperCase() + c.slice(1),
                  count: available(c, difficulty) ?? undefined,
                  disabled: !enough(c, difficulty) && c !== category,
                })),
            ]}
          />
        </Step>
        {country && (
          <p className="muted text-sm">
            Practising one country: <strong className="text-paper">{country}</strong>.{" "}
            <Link className="text-mint underline" to="/quiz">
              Practise everything instead
            </Link>
          </p>
        )}
        <StartBar
          count={roundSize.count}
          unit={roundSize.unit}
          busy={pending}
          disabled={!!loadError || (!country && !enough(category, difficulty))}
          label="Start game"
          summary={`${modeNames[mode]} · ${difficulty} · ${category === "all" ? "all topics" : category}${mode === "practice" ? " · no XP" : ""}`}
        />
        {!country && !enough(category, difficulty) && (
          <p className="muted" role="status">
            Not enough questions for this combination yet – pick another difficulty or topic.
          </p>
        )}
        <ErrorBox message={error} />
      </SetupForm>
    </ModePage>
  );
}

function friendlyQuizError(message: string) {
  if (/not enough|insufficient|empty|no eligible|pool/i.test(message))
    return "There aren't enough questions for that combination yet. Try another difficulty or topic.";
  return message;
}

function Stat({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="card stat-card p-4">
      <p className="muted text-xs sm:text-sm">{title}</p>
      <p className="text-xl sm:text-3xl font-black mt-2">{value}</p>
    </div>
  );
}
export function Game() {
  const { id = "" } = useParams();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const [view, setView] = useState<View>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const leaveDialogRef = useRef<HTMLElement>(null);
  const pendingRef = useRef(false);
  const offset = useRef(0);
  const [now, setNow] = useState(Date.now());
  const finalizedEvent = useRef(false);
  const prefs = usePrefs();
  const lastFeedbackKey = useRef("");
  // The last answer finishes the run on the server; keep its feedback on screen until the player finishes the round.
  const [finalHold, setFinalHold] = useState<{ current: PlayableQuestion; feedback: Review } | null>(null);

  function accept(v: View) {
    offset.current = Date.parse(v.serverNow) - Date.now();
    setView((old) => (!old || old.id !== v.id || v.version >= old.version ? v : old));
  }
  async function refresh() {
    try {
      accept(await api.view(id));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    setView(undefined);
    finalizedEvent.current = false;
    void refresh();
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!leaveDialogOpen) return;
    leaveDialogRef.current?.querySelector<HTMLElement>(".leave-run-cancel")?.focus();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLeaveDialogOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = leaveDialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)");
      if (!nodes?.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = oldOverflow;
    };
  }, [leaveDialogOpen]);

  // While the final answer is held on screen, show the finished run as if it were still giving feedback.
  const shown: View | undefined =
    view && finalHold && view.status === "completed"
      ? { ...view, status: "showing_feedback", current: finalHold.current, feedback: finalHold.feedback }
      : view;
  const finalAnswer = Boolean(finalHold && view?.status === "completed");

  // Timed runs pause at accepted answers while the player reads feedback.
  const remaining =
    shown?.deadline && shown.status !== "showing_feedback"
      ? Math.max(0, Date.parse(shown.deadline) - now - offset.current)
      : null;

  useEffect(() => {
    if (view?.deadline && remaining === 0 && view.status !== "completed" && view.status !== "abandoned") {
      void refresh();
      const retry = setInterval(() => void refresh(), 2000);
      return () => clearInterval(retry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining === 0, view?.status, id]);

  useEffect(() => {
    if (view?.status === "completed") {
      if (!finalizedEvent.current) {
        finalizedEvent.current = true;
        track("game_completed", {
          mode: view.mode,
          correct: view.stats.correct,
          incorrect: view.stats.incorrect,
          responseDurationMs: Math.round(view.stats.averageMs * view.answered),
        });
      }
      if (!finalHold) navigate("/results/" + view.id, { replace: true });
    }
  }, [view, navigate, finalHold]);

  function finishRound() {
    if (view) navigate("/results/" + view.id, { replace: true });
  }

  async function action(kind: "answer" | "next", option?: string) {
    if (!view || pendingRef.current) return;
    if (kind === "answer" && isIOS) haptic("tap");
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const before = view.current;
      const next = kind === "answer" ? await api.answer(id, view.current!.id, option!) : await api.next(id);
      if (kind === "answer" && next.status === "completed" && before) {
        const review = next.reviews.find((item) => item.questionId === before.id) ?? next.feedback ?? next.reviews.at(-1);
        if (review) setFinalHold({ current: before, feedback: review });
      }
      accept(next);
    } catch (e) {
      setError((e as Error).message + " If the connection failed, reload state before retrying.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function deleteCurrentRun() {
    setDeletePending(true);
    setError("");
    try {
      await api.deleteRun(id);
      navigate("/home", { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletePending(false);
    }
  }

  function continueOn() {
    if (finalAnswer) finishRound();
    else void action("next");
  }
  const feedbackKey = shown?.status === "showing_feedback" && shown.feedback ? `${shown.id}:${shown.answered}` : "";
  useEffect(() => {
    if (!feedbackKey || feedbackKey === lastFeedbackKey.current || !shown?.feedback) return;
    lastFeedbackKey.current = feedbackKey;
    haptic(shown.feedback.correct ? "correct" : "wrong");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedbackKey]);
  const autoContinue = Boolean(feedbackKey && prefs.autoContinue && shown?.feedback?.correct);
  useEffect(() => {
    if (!autoContinue) return;
    const timer = window.setTimeout(() => continueOn(), AUTO_CONTINUE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoContinue, feedbackKey]);
  useEffect(() => {
    if (shown?.status === "completed") haptic("complete");
  }, [shown?.status]);

  useEffect(() => {
    function keydown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable=true]") || e.altKey || e.ctrlKey || e.metaKey) return;
      if (shown?.status === "showing_feedback" && (e.key === "Enter" || e.code === "Space") && !target.closest("a")) {
        e.preventDefault();
        if (!pending) continueOn();
        return;
      }
      if (e.repeat || shown?.status !== "awaiting_answer" || remaining === 0) return;
      const index = Number(e.key) - 1;
      const option = shown.current?.options[index];
      if (option) {
        e.preventDefault();
        void action("answer", option.id);
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  if (!shown) return error ? <ErrorBox message={error} retry={refresh} /> : <Loading />;
  if (shown.status === "abandoned")
    return (
      <section className="card">
        <h1 tabIndex={-1} className="heading">
          This run was abandoned.
        </h1>
        <Link className="primary mt-5" to="/home">
          Choose a new challenge
        </Link>
      </section>
    );

  const questionNumber = Math.min(shown.answered + 1, shown.total);
  const progressPercent = shown.total ? Math.min(100, (shown.answered / shown.total) * 100) : 0;
  const remainingLives = Math.max(0, 3 - shown.stats.incorrect);
  return (
    <div className="game-shell">
      <div className="game-topline">
        <div>
          <p className="eyebrow">
            {modeNames[shown.mode]} ·{" "}
            <span className={`game-difficulty-tag ${shown.current?.difficulty === "expert" ? "is-expert" : ""}`}>
              {shown.current?.difficulty ?? shown.difficulty}
            </span>
          </p>
          <p className="muted mt-1">
            Question {questionNumber} of {shown.total}
          </p>
        </div>
        <div className="game-topline-actions">
          {isAdmin && shown.current && <EditQuestionButton key={shown.current.id} questionId={shown.current.id} />}
          {!finalAnswer && (
            <button className="secondary" disabled={pending} onClick={() => setLeaveDialogOpen(true)}>
              Leave run
            </button>
          )}
        </div>
      </div>
      <div className="game-layout mt-5">
        <div className="game-main">
          {shown.current && (
            <section
              className={`card game-question map-grid ${shown.status === "showing_feedback" && shown.feedback?.correct ? "has-correct-answer" : ""} ${shown.status === "showing_feedback" && shown.feedback && !shown.feedback.correct ? "has-incorrect-answer" : ""}`}
            >
              <StreakBadge streak={shown.stats.streak} />
              <h1 tabIndex={-1} className="game-prompt mt-6">
                {shown.current.prompt}
              </h1>
              <div className="answer-grid grid gap-3 sm:grid-cols-2 mt-7">
                {shown.current.options.map((o, i) => (
                  <button
                    key={o.id}
                    className={`answer text-left ${
                      shown.status === "showing_feedback" && shown.feedback
                        ? o.label === shown.feedback.correctAnswer
                          ? "is-correct"
                          : o.label === shown.feedback.chosen && !shown.feedback.correct
                            ? "is-wrong"
                            : "is-dimmed"
                        : ""
                    }`}
                    disabled={pending || shown.status !== "awaiting_answer" || remaining === 0}
                    onClick={() => void action("answer", o.id)}
                  >
                    <span className="keycap" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span>{o.label}</span>
                  </button>
                ))}
              </div>
              {prefs.keyboardHints && (
                <p className="keyboard-hint muted text-sm mt-5">
                  <span className="keycap">1</span>–<span className="keycap">4</span> to answer
                </p>
              )}
            </section>
          )}
          <ErrorBox message={error} retry={refresh} />
          {shown.feedback && prefs.keyboardHints && (
            <p className="game-keyboard-hint muted text-sm mt-3">
              Press <kbd>Enter</kbd> or <kbd>Space</kbd> {finalAnswer ? "to finish the round" : "for the next question"}
            </p>
          )}
          {remaining === 0 && shown.status !== "completed" && (
            <p className="game-notice mt-4" role="status">
              Time is up. Confirming the final result…
            </p>
          )}
        </div>
        <aside className="game-sidebar" aria-label="Live run statistics and answer review">
          <div className="game-live-stats">
            <div>
              <span>Score</span>
              <strong>{shown.stats.score.toLocaleString()}</strong>
            </div>
            <div>
              <span>Streak</span>
              <strong>{shown.stats.streak}</strong>
            </div>
            <div>
              <span>{shown.mode === "endless" ? "Lives" : "Progress"}</span>
              {shown.mode === "endless" ? (
                <strong className="game-hearts" aria-label={`${remainingLives} of 3 lives remaining`}>
                  {[0, 1, 2].map((index) => (
                    <svg
                      key={index}
                      className={index < remainingLives ? "is-alive" : "is-lost"}
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
                    </svg>
                  ))}
                </strong>
              ) : (
                <strong>{`${shown.answered}/${shown.total}`}</strong>
              )}
            </div>
          </div>
          {shown.total > 1 && (
            <div className="game-progress-card">
              <div className="game-progress-caption">
                <span>Run progress</span>
                <strong>{progressPercent}%</strong>
              </div>
              <div
                className="game-progress"
                role="progressbar"
                aria-label="Question progress"
                aria-valuemin={0}
                aria-valuemax={shown.total}
                aria-valuenow={shown.answered}
              >
                <span style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          )}
          {shown.deadline &&
            (remaining !== null ? (
              <div className="game-stat timer-stat">
                <div className="timer-label-row">
                  <span>Time left</span>
                  <strong>{Math.ceil(remaining / 1000)}s</strong>
                </div>
                <div
                  className="timer-track mt-2"
                  role="progressbar"
                  aria-label="Time remaining"
                  aria-valuemin={0}
                  aria-valuemax={60}
                  aria-valuenow={Math.ceil(remaining / 1000)}
                >
                  <span style={{ width: `${Math.max(0, (remaining / 60000) * 100)}%` }} />
                </div>
              </div>
            ) : (
              <div className="game-stat timer-stat is-paused">
                <span>Challenge timer</span>
                <strong>Paused while you review</strong>
              </div>
            ))}
          {shown.feedback && (
            <section className="game-review">
              <div className="game-review-heading">
                <span
                  className={`game-result-mark ${shown.feedback.correct ? "is-correct" : "is-incorrect"}`}
                  aria-hidden="true"
                >
                  {shown.feedback.correct ? "✓" : "×"}
                </span>
                <div>
                  <p className="eyebrow">ANSWER REVIEW</p>
                  <h2>{shown.feedback.correct ? "Correct" : "Not quite"}</h2>
                </div>
                <strong className="game-review-points">
                  +{shown.feedback.points} <small>pts</small>
                </strong>
              </div>
              <p className="game-correct-answer">
                <span>Correct answer</span>
                <strong>{shown.feedback.correctAnswer}</strong>
              </p>
              {!shown.feedback.correct && (
                <p className="game-chosen-answer">
                  <span>Your answer</span>
                  {shown.feedback.chosen}
                </p>
              )}
              <p className="game-review-explanation">{shown.feedback.explanation}</p>
              <a className="game-review-source" href={shown.feedback.source} target="_blank" rel="noopener noreferrer">
                Source reference <span aria-hidden="true">↗</span>
              </a>
              <button
                autoFocus
                className="primary game-next-button mt-3"
                disabled={pending}
                onClick={() => continueOn()}
              >
                {pending ? "Loading…" : finalAnswer ? "Finish round · See results →" : "Next question →"}
              </button>
              {autoContinue && !pending && <AutoContinueBar ms={AUTO_CONTINUE_MS} onSkip={() => continueOn()} />}
            </section>
          )}
          {!shown.feedback && (
            <div className="game-stats-footnote">
              <span>Best streak</span>
              <strong>{shown.stats.bestStreak}</strong>
            </div>
          )}
        </aside>
      </div>
      {leaveDialogOpen && (
        <div
          className="leave-run-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletePending) setLeaveDialogOpen(false);
          }}
        >
          <section
            ref={leaveDialogRef}
            className="leave-run-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-run-title"
            aria-describedby="leave-run-description"
          >
            <span className="leave-run-symbol" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3 3.5 7v5.5c0 4.2 3.6 7.3 8.5 8.5 4.9-1.2 8.5-4.3 8.5-8.5V7L12 3Z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </span>
            <p className="eyebrow">YOUR RUN · {modeNames[shown.mode]}</p>
            <h2 id="leave-run-title">Leave this run?</h2>
            <p id="leave-run-description" className="muted">
              Save your progress to resume from Home later, or delete this run and its progress.
            </p>
            {shown.deadline && (
              <p className="leave-run-timer-note">This timed challenge keeps running while you are away.</p>
            )}
            {error && <ErrorBox message={error} />}
            <div className="leave-run-actions">
              <button
                type="button"
                className="secondary leave-run-cancel"
                disabled={deletePending}
                onClick={() => setLeaveDialogOpen(false)}
              >
                Continue playing
              </button>
              <button
                type="button"
                className="primary leave-run-save"
                disabled={deletePending}
                onClick={() => navigate("/home")}
              >
                Save for later <span aria-hidden="true">↗</span>
              </button>
              <button
                type="button"
                className="leave-run-delete"
                disabled={deletePending}
                onClick={() => void deleteCurrentRun()}
              >
                {deletePending ? (
                  <>
                    <span className="loading-indicator" aria-hidden="true" />
                    Deleting…
                  </>
                ) : (
                  <>
                    Delete run <span aria-hidden="true">⌫</span>
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export function Results() {
  const { id = "" } = useParams();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const { data: v, error, reload } = useLoad(() => api.result(id), id);
  const [replayPending, setReplayPending] = useState(false);
  const [replayError, setReplayError] = useState("");
  if (!v) return error ? <ErrorBox message={error} retry={reload} /> : <Loading />;
  if (v.status !== "completed")
    return (
      <section className="card">
        <h1 tabIndex={-1} className="heading">
          This run has not completed.
        </h1>
        <Link className="primary mt-4" to={"/play/" + id}>
          Resume run
        </Link>
      </section>
    );
  const result = v;
  const newBest = setsNewPersonalBest(result.mode, result.stats.score, result.previousBest);
  const setupUrl = challengeSetupUrl(result);
  async function playAgain() {
    if (!result.contextSaved) {
      navigate(setupUrl);
      return;
    }
    setReplayPending(true);
    setReplayError("");
    try {
      const next = await api.play(
        result.mode,
        result.categories ?? [],
        result.difficulty,
        result.country ?? undefined,
        result.questionCount ?? 10,
      );
      navigate(`/play/${next.id}`);
    } catch (e) {
      setReplayError((e as Error).message);
    } finally {
      setReplayPending(false);
    }
  }
  return (
    <div className="results-shell">
      <section className={`results-hero map-grid ${newBest ? "has-new-best" : ""}`}>
        <div className="results-hero-copy">
          <p className="eyebrow">ADVENTURE COMPLETE · {modeNames[v.mode]}</p>
          <h1 tabIndex={-1} className="heading mt-3">
            {v.stats.incorrect === 0 && v.stats.correct > 0
              ? "Flawless!"
              : accuracyLine(v.stats.correct, v.stats.incorrect)}
          </h1>
          <p className="muted mt-3">
            {v.stats.correct} correct · {v.stats.incorrect} wrong · best streak {v.stats.bestStreak}
          </p>
          {newBest && (
            <div className="new-best-badge" role="status">
              <span className="new-best-icon" aria-hidden="true">
                ✦
              </span>
              <span>
                <strong>New personal best</strong>
                <small>
                  {v.previousBest === null
                    ? "Your first completed score in this mode."
                    : `Previous best: ${v.previousBest.toLocaleString()} points`}
                </small>
              </span>
            </div>
          )}
        </div>
        <div className="results-selection" aria-label="Completed challenge settings">
          <span className="results-selection-label">Your selection</span>
          <strong>
            {modeNames[v.mode]} <i aria-hidden="true">·</i> {v.difficulty}
          </strong>
          <span>
            {v.contextSaved
              ? v.categories?.length
                ? v.categories.join(", ")
                : "All categories"
              : "Original filters unavailable"}
            {v.country ? ` · ${v.country}` : ""}
          </span>
        </div>
      </section>
      <div className="results-actions">
        <button className="primary results-play-again" disabled={replayPending} onClick={() => void playAgain()}>
          {replayPending ? (
            <>
              <span className="loading-indicator" aria-hidden="true" />
              Starting a new run…
            </>
          ) : (
            <>
              Play again <span aria-hidden="true">→</span>
            </>
          )}
        </button>
        <Link className="secondary" to={`${setupUrl}#difficulty-picker`}>
          Change difficulty
        </Link>
        <Link className="secondary" to="/home">
          Other games
        </Link>
      </div>
      {!v.contextSaved && (
        <p className="results-context-notice" role="status">
          This run predates saved filter settings. Choose its category and country again in the setup screen before
          starting.
        </p>
      )}
      <ErrorBox message={replayError} />
      <div className="results-metrics grid grid-cols-2 md:grid-cols-4 gap-3 my-6">
        <Stat title="Final score" value={v.stats.score} />
        <Stat title="Accuracy" value={accuracy(v.stats.correct, v.stats.incorrect)} />
        <Stat title="XP earned" value={v.stats.xp} />
        <Stat title="Correct answers" value={v.stats.correct} />
        <Stat title="Incorrect answers" value={v.stats.incorrect} />
        <Stat title="Average response" value={v.answered ? `${(v.stats.averageMs / 1000).toFixed(1)}s` : "—"} />
        <Stat title="Best streak" value={v.stats.bestStreak} />
      </div>
      {v.mode === "practice" && <p className="muted text-sm">Practice games don't earn XP.</p>}
      <div className="section-heading mt-9 mb-4">
        <h2 className="text-2xl font-bold">Your answer review</h2>
        <span className="muted text-sm">
          {v.reviews.length} {v.reviews.length === 1 ? "answer" : "answers"}
        </span>
      </div>
      {!v.reviews.length && (
        <div className="empty-state">
          <p className="font-semibold">No answers were accepted in this run.</p>
        </div>
      )}
      <div className="grid gap-4">
        {[...v.reviews]
          .map((review, index) => ({ review, index }))
          .sort((a, b) => Number(a.review.correct) - Number(b.review.correct) || a.index - b.index)
          .map(({ review, index }) => (
            <article
              className={`results-review-item ${review.correct ? "is-correct" : "is-incorrect"}`}
              key={review.questionId}
            >
              <div className="results-review-title">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{review.prompt}</h3>
                <strong className={`results-review-status ${review.correct ? "is-correct" : "is-incorrect"}`}>
                  {review.correct ? "Correct" : "Mistake"}
                </strong>
              </div>
              <Feedback review={review} />
              {isAdmin && <EditQuestionButton questionId={review.questionId} className="mt-3" />}
            </article>
          ))}
      </div>
    </div>
  );
}
