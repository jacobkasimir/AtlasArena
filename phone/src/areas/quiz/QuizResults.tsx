// Phone quiz results at /quiz/results/:id. Everything shown comes from the server (or the demo engine):
// ResultHero (medal, count-up score, accuracy, new best, XP bar), then the learning loop (Retry missed →
// Review my mistakes, online only), then the answers with mistakes first, then "Play again".
import { useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, isDemo } from "@shared/api";
import { useLoad } from "@shared/components";
import { Dashboard, ResultView, challengeSetupUrl, setsNewPersonalBest } from "@shared/domain";
import { Icon } from "@shared/icons";
import { modeIcons, modeNames } from "@shared/quiz-meta";
import { usePhoneChrome } from "@phone/shell/chrome";
import { paths } from "@phone/shell/paths";
import {
  ActionBar,
  GameButton,
  LinkButton,
  LoadingState,
  ResultHero,
  RetryMissedCard,
  StatGrid,
  StatTile,
  StatusMessage,
} from "@phone/ui";
import { capitalize, friendlyQuizError, mistakesFirst, resultHeadline } from "./quiz-logic";
import { reviewPath } from "./QuizReview";

/** True when the player arrived straight from the round (QuizPlay passes `{ fresh: true }`). */
function useFreshResult() {
  const state = useLocation().state as { fresh?: unknown } | null;
  return Boolean(state && state.fresh === true);
}

export function QuizResults() {
  usePhoneChrome({ title: "Quiz results", back: paths.quiz });
  const { id = "" } = useParams();
  const fresh = useFreshResult();
  const { data, error, reload } = useLoad<ResultView>(() => api.result(id), id);
  // The XP total is only meaningful right after the round (later rounds would have added to it): fetch it then,
  // and wait for it so ResultHero fires its one feedback (levelUp/reward/complete) with the final values.
  const profile = useLoad<Dashboard | null>(() => (fresh ? api.dashboard() : Promise.resolve(null)), `${id}:${fresh}`);
  const profileSettled = !fresh || profile.data !== undefined || Boolean(profile.error);

  if (!data || !profileSettled)
    return error ? (
      <StatusMessage tone="error" retry={reload}>
        {friendlyQuizError(error)}
      </StatusMessage>
    ) : (
      <LoadingState label="Loading results…" />
    );
  if (data.status !== "completed")
    return (
      <div className="ph-stack">
        <StatusMessage>This round isn't finished yet.</StatusMessage>
        <LinkButton to={`${paths.quiz}/play/${id}`} variant="primary" size="lg" block>
          Resume round
        </LinkButton>
      </div>
    );
  const xpTotal = fresh && typeof profile.data?.profile?.xp === "number" ? profile.data.profile.xp : null;
  return <ResultsBody result={data} xpTotal={xpTotal} />;
}

function ResultsBody({ result, xpTotal }: { result: ResultView; xpTotal: number | null }) {
  const navigate = useNavigate();
  const [replayPending, setReplayPending] = useState(false);
  const [replayError, setReplayError] = useState("");
  const replayRef = useRef(false);
  const missedRef = useRef<HTMLHeadingElement>(null);
  const { stats } = result;
  const ranked = result.mode !== "practice";
  const newBest = setsNewPersonalBest(result.mode, stats.score, result.previousBest);
  // challengeSetupUrl returns "/quiz?…", which is also the phone setup path.
  const setupUrl = challengeSetupUrl(result);
  const ordered = mistakesFirst(result.reviews);
  const missed = ordered.filter(({ review }) => !review.correct);
  const right = ordered.filter(({ review }) => review.correct);
  const answered = stats.correct + stats.incorrect;

  async function playAgain() {
    if (replayRef.current) return;
    if (!result.contextSaved) {
      navigate(setupUrl);
      return;
    }
    replayRef.current = true;
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
      navigate(`${paths.quiz}/play/${next.id}`);
    } catch (cause) {
      setReplayError(friendlyQuizError((cause as Error).message));
      replayRef.current = false;
      setReplayPending(false);
    }
  }

  function showMissed() {
    missedRef.current?.scrollIntoView?.({ block: "start" });
    missedRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className="ph-quiz-results ph-stack">
      <ResultHero
        headline={resultHeadline(stats.correct, stats.incorrect)}
        tone="quiz"
        icon={modeIcons[result.mode]}
        score={stats.score}
        correct={stats.correct}
        total={answered}
        ranked={ranked}
        newBest={newBest}
        previousBest={result.previousBest}
        xpGained={ranked ? stats.xp : null}
        xpTotal={ranked ? xpTotal : null}
      >
        <p className="ph-quiz-result-context">
          {modeNames[result.mode]} · {capitalize(result.difficulty)} ·{" "}
          {result.contextSaved
            ? result.categories?.length
              ? result.categories.map(capitalize).join(", ")
              : "All topics"
            : "Original filters unavailable"}
          {result.country ? ` · ${result.country}` : ""}
        </p>
      </ResultHero>

      {/* Learning loop: wrong answers land in Review my mistakes (online only; the demo has no review). */}
      {!isDemo && (
        <RetryMissedCard
          count={missed.length}
          to={reviewPath}
          text="They're waiting in Review my mistakes. Answer each one right once to clear it."
        />
      )}
      {isDemo && missed.length > 0 && (
        <GameButton variant="secondary" size="md" block onClick={showMissed}>
          See what you missed ({missed.length})
        </GameButton>
      )}

      <StatGrid label="Round stats">
        <StatTile label="XP earned" icon="sparkles" tone="awards" value={ranked ? stats.xp.toLocaleString() : "0"} />
        <StatTile label="Incorrect" icon="warning" value={stats.incorrect} />
        <StatTile label="Best streak" icon="flame" tone="quiz" value={stats.bestStreak} />
        <StatTile
          label="Avg. response"
          icon="timer"
          value={result.answered ? `${(stats.averageMs / 1000).toFixed(1)}s` : "—"}
        />
      </StatGrid>
      {!ranked && <p className="ph-muted">Practice rounds don't earn XP or set personal bests.</p>}
      {!result.contextSaved && (
        <StatusMessage>This run predates saved settings. Choose its topic again before playing.</StatusMessage>
      )}

      {result.reviews.length === 0 ? (
        <p className="ph-muted">No answers were accepted in this run.</p>
      ) : (
        <>
          {missed.length > 0 && (
            <section className="ph-section" aria-labelledby="ph-quiz-missed">
              <h2 id="ph-quiz-missed" ref={missedRef} tabIndex={-1} className="ph-section-title">
                Missed <span className="ph-muted">· {missed.length}</span>
              </h2>
              <ReviewList items={missed} />
            </section>
          )}
          {right.length > 0 && (
            <section className="ph-section" aria-labelledby="ph-quiz-right">
              <h2 id="ph-quiz-right" className="ph-section-title">
                Correct <span className="ph-muted">· {right.length}</span>
              </h2>
              <ReviewList items={right} />
            </section>
          )}
        </>
      )}

      <div className="ph-quiz-more">
        <LinkButton to={setupUrl} block>
          Change setup
        </LinkButton>
        <LinkButton to={paths.games} variant="ghost" block>
          Other games
        </LinkButton>
      </div>

      {replayError && <StatusMessage tone="error">{replayError}</StatusMessage>}
      <ActionBar label="Next round">
        <GameButton
          variant="primary"
          size="xl"
          block
          loading={replayPending}
          icon={<Icon name="rocket" size={22} />}
          onClick={() => void playAgain()}
        >
          {replayPending ? "Starting…" : "Play again"}
        </GameButton>
      </ActionBar>
    </div>
  );
}

function ReviewList({ items }: { items: { review: ResultView["reviews"][number]; index: number }[] }) {
  return (
    <ol className="ph-quiz-review">
      {items.map(({ review, index }) => (
        <li key={review.questionId} className="ph-card ph-quiz-review-item" data-correct={review.correct}>
          <p className="ph-quiz-review-head">
            <span className="ph-muted">#{index + 1}</span>
            <strong className="ph-quiz-review-status">
              <Icon name={review.correct ? "checkCircle" : "warning"} size={18} />
              {review.correct ? "Correct" : "Incorrect"}
            </strong>
            <span className="ph-muted">+{review.points} pts</span>
          </p>
          <h3 className="ph-quiz-review-prompt">{review.prompt}</h3>
          <p>
            <span className="ph-muted">Correct answer: </span>
            <strong>{review.correctAnswer}</strong>
          </p>
          {!review.correct && (
            <p>
              <span className="ph-muted">Your answer: </span>
              {review.chosen}
            </p>
          )}
          {review.explanation && <p className="ph-quiz-explanation">{review.explanation}</p>}
          {review.source && (
            <a className="ph-quiz-source" href={review.source} target="_blank" rel="noopener noreferrer">
              Source reference<span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}
