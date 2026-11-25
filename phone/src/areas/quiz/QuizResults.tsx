// Phone quiz results at /quiz/results/:id: score, XP, accuracy and the answer review, all as the server
// (or demo engine) reported them. "Play again" starts the same setup again; mistakes are listed first.
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@shared/api";
import { useLoad } from "@shared/components";
import { ResultView, challengeSetupUrl, setsNewPersonalBest } from "@shared/domain";
import { Icon } from "@shared/icons";
import { accuracy, modeNames } from "@shared/quiz-meta";
import { usePhoneChrome } from "@phone/shell/chrome";
import { paths } from "@phone/shell/paths";
import { ActionBar, Button, Card, LinkButton, LoadingState, StatusMessage, useHaptics } from "@phone/ui";
import { capitalize, friendlyQuizError, resultHeadline } from "./quiz-logic";

export function QuizResults() {
  usePhoneChrome({ title: "Results", back: paths.quiz });
  const { id = "" } = useParams();
  const { data, error, reload } = useLoad<ResultView>(() => api.result(id), id);
  if (!data)
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
  return <ResultsBody result={data} />;
}

function ResultsBody({ result }: { result: ResultView }) {
  const navigate = useNavigate();
  const haptics = useHaptics();
  const [replayPending, setReplayPending] = useState(false);
  const [replayError, setReplayError] = useState("");
  const replayRef = useRef(false);
  const mistakesRef = useRef<HTMLHeadingElement>(null);
  const { stats } = result;
  const newBest = setsNewPersonalBest(result.mode, stats.score, result.previousBest);
  // challengeSetupUrl returns "/quiz?…", which is also the phone setup path.
  const setupUrl = challengeSetupUrl(result);
  const mistakes = result.reviews.filter((review) => !review.correct);
  const ordered = [...result.reviews]
    .map((review, index) => ({ review, index }))
    .sort((a, b) => Number(a.review.correct) - Number(b.review.correct) || a.index - b.index);

  async function playAgain() {
    if (replayRef.current) return;
    if (!result.contextSaved) {
      navigate(setupUrl);
      return;
    }
    replayRef.current = true;
    setReplayPending(true);
    setReplayError("");
    haptics.tap();
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

  function showMistakes() {
    mistakesRef.current?.scrollIntoView?.({ block: "start" });
    mistakesRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className="ph-quiz-results ph-stack">
      <Card as="section" className="ph-quiz-hero" aria-labelledby="ph-quiz-result-title">
        <p className="ph-muted">
          {modeNames[result.mode]} · {capitalize(result.difficulty)} ·{" "}
          {result.contextSaved
            ? result.categories?.length
              ? result.categories.map(capitalize).join(", ")
              : "All topics"
            : "Original filters unavailable"}
          {result.country ? ` · ${result.country}` : ""}
        </p>
        <h2 id="ph-quiz-result-title" className="ph-quiz-headline">
          {resultHeadline(stats.correct, stats.incorrect)}
        </h2>
        <p className="ph-quiz-score">
          <strong>{stats.score.toLocaleString()}</strong> <span className="ph-muted">points</span>
        </p>
        {newBest && (
          <p className="ph-quiz-best" role="status">
            <Icon name="trophy" size={20} />
            <span>
              <strong>New personal best</strong>
              <small>
                {result.previousBest === null
                  ? " Your first completed score in this mode."
                  : ` Previous best: ${result.previousBest.toLocaleString()} points.`}
              </small>
            </span>
          </p>
        )}
      </Card>

      <dl className="ph-quiz-stats">
        <Stat label="Accuracy" value={accuracy(stats.correct, stats.incorrect)} />
        <Stat label="XP earned" value={result.mode === "practice" ? "0" : stats.xp.toLocaleString()} />
        <Stat label="Correct" value={stats.correct} />
        <Stat label="Wrong" value={stats.incorrect} />
        <Stat label="Best streak" value={stats.bestStreak} />
        <Stat label="Avg. response" value={result.answered ? `${(stats.averageMs / 1000).toFixed(1)}s` : "—"} />
      </dl>
      {result.mode === "practice" && <p className="ph-muted">Practice rounds don't earn XP.</p>}
      {!result.contextSaved && (
        <StatusMessage>This run predates saved settings. Choose its topic again before playing.</StatusMessage>
      )}

      {mistakes.length > 0 && (
        <Button block onClick={showMistakes}>
          Review {mistakes.length === 1 ? "1 mistake" : `${mistakes.length} mistakes`}
        </Button>
      )}

      <section className="ph-section">
        <h2 ref={mistakesRef} tabIndex={-1} className="ph-section-title">
          Your answers <span className="ph-muted">({result.reviews.length})</span>
        </h2>
        {result.reviews.length === 0 ? (
          <p className="ph-muted">No answers were accepted in this run.</p>
        ) : (
          <ol className="ph-quiz-review">
            {ordered.map(({ review, index }) => (
              <li key={review.questionId} className="ph-card ph-quiz-review-item" data-correct={review.correct}>
                <p className="ph-quiz-review-head">
                  <span className="ph-muted">#{index + 1}</span>
                  <strong className="ph-quiz-review-status">
                    <Icon name={review.correct ? "checkCircle" : "warning"} size={18} />
                    {review.correct ? "Correct" : "Mistake"}
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
        )}
      </section>

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
        <Button variant="primary" size="lg" block loading={replayPending} onClick={() => void playAgain()}>
          {replayPending ? "Starting…" : "Play again"}
        </Button>
      </ActionBar>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="ph-quiz-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
