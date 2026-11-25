// Review my mistakes on the phone (/quiz/review, /quiz/review/:id): up to ten quiz questions, flags and capitals
// the player got wrong, one at a time. The server checks every answer and clears a mistake once it is right.
// Online only: in the demo api.review* rejects with ONLINE_ONLY, shown as a calm note.
import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@shared/api";
import { useLoad } from "@shared/components";
import type { ReviewItem, ReviewSession, ReviewSummary } from "@shared/domain";
import { usePhonePrefs } from "@phone/prefs-phone";
import { usePhoneChrome } from "@phone/shell/chrome";
import { paths } from "@phone/shell/paths";
import {
  ActionBar,
  AnswerButton,
  AnswerList,
  Card,
  LinkButton,
  LoadingState,
  GameButton,
  ProgressBar,
  StatusMessage,
  TextField,
  useFeel,
} from "@phone/ui";
import type { AnswerState } from "@phone/ui";
import { Icon } from "@shared/icons";
import { capitalize } from "./quiz-logic";

export const reviewPath = `${paths.quiz}/review`;
const requestId = () => crypto.randomUUID();
const kindLabel: Record<ReviewItem["kind"], string> = { quiz: "Quiz question", flag: "Flag", capital: "Capital" };

export function friendlyReviewError(message: string) {
  if (message.includes("NO_MISTAKES_TO_REVIEW")) return "Nothing to review – you have no open mistakes. Nice!";
  if (message.includes("RATE_LIMIT")) return "Slow down a little – try again in a minute.";
  return message.replace(/^[A-Z_]{4,}:\s*/, "");
}

const onlineOnly = (message: string) => message.includes("ONLINE_ONLY");

function ReviewProblem({ error, retry }: { error: string; retry: () => void }) {
  if (onlineOnly(error))
    return (
      <div className="ph-stack">
        <StatusMessage>Review my mistakes needs an online account – not available in the local demo.</StatusMessage>
        <LinkButton to={paths.home} block>
          Back to Home
        </LinkButton>
      </div>
    );
  return (
    <StatusMessage tone="error" retry={retry}>
      {friendlyReviewError(error)}
    </StatusMessage>
  );
}

/** Answer-option state from the server's answer (never computed on the client). */
export function reviewOptionState(item: ReviewItem, optionId: string, chosen: string | null): AnswerState {
  if (item.answered) {
    if (optionId === item.correctOption) return item.correct ? "correct" : "missed";
    if (optionId === item.answer && !item.correct) return "wrong";
    return "idle";
  }
  return chosen === optionId ? "selected" : "idle";
}

export function ReviewStart() {
  usePhoneChrome({ title: "Review my mistakes", back: true });
  const navigate = useNavigate();
  const { data, error, reload } = useLoad<ReviewSummary>(() => api.reviewSummary());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const busyRef = useRef(false);

  useEffect(() => {
    if (data?.activeId) navigate(`${reviewPath}/${data.activeId}`, { replace: true });
  }, [data, navigate]);

  if (error) return <ReviewProblem error={error} retry={reload} />;
  if (!data || data.activeId) return <LoadingState label="Loading your mistakes…" />;

  async function start() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      const session = await api.reviewStart(requestId());
      navigate(`${reviewPath}/${session.id}`);
    } catch (cause) {
      setMessage(friendlyReviewError((cause as Error).message));
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="ph-stack">
      <Card as="section" className="grid gap-3" aria-labelledby="ph-review-intro">
        <h2 id="ph-review-intro" className="ph-quiz-headline">
          Turn mistakes into points
        </h2>
        <p className="ph-muted">
          Everything you got wrong in Quiz, Flags, Capitals and Recall lands here. Answer it right once and it's cleared
          for good.
        </p>
        <dl className="ph-quiz-stats">
          <div className="ph-quiz-stat">
            <dt>Open mistakes</dt>
            <dd>{data.open}</dd>
          </div>
          <div className="ph-quiz-stat">
            <dt>Cleared so far</dt>
            <dd>{data.cleared}</dd>
          </div>
          <div className="ph-quiz-stat">
            <dt>Quiz questions</dt>
            <dd>{data.byKind.quiz ?? 0}</dd>
          </div>
          <div className="ph-quiz-stat">
            <dt>Flags & capitals</dt>
            <dd>{(data.byKind.flag ?? 0) + (data.byKind.capital ?? 0)}</dd>
          </div>
        </dl>
      </Card>
      {data.open === 0 && <p className="ph-muted">No open mistakes right now – play a round and come back.</p>}
      <StatusMessage tone="error">{message}</StatusMessage>
      <ActionBar label="Start review">
        {data.open > 0 ? (
          <GameButton
            variant="tone"
            tone="review"
            size="xl"
            block
            loading={busy}
            icon={<Icon name="review" size={22} />}
            onClick={() => void start()}
          >
            {busy ? "Preparing…" : `Review ${data.open === 1 ? "1 mistake" : `${Math.min(10, data.open)} mistakes`}`}
          </GameButton>
        ) : (
          <LinkButton to={paths.games} variant="primary" size="lg" block>
            Choose a game
          </LinkButton>
        )}
      </ActionBar>
    </div>
  );
}

export function ReviewPlay() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const feel = useFeel();
  const { answerLayout } = usePhonePrefs();
  const { data, error, reload } = useLoad<ReviewSession>(() => api.reviewView(id), id);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("");
  const [flagBroken, setFlagBroken] = useState(false);
  const promptRef = useRef<HTMLHeadingElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const item = session?.items.find((entry) => entry.position === position);
  const finished = Boolean(session && !item);
  usePhoneChrome({ title: "Review my mistakes", back: finished ? paths.home : true, hideTabBar: !finished });

  useEffect(() => {
    if (!data) return;
    setSession(data);
    setPosition((current) => current ?? data.items.find((entry) => !entry.answered)?.position ?? -1);
  }, [data]);

  useEffect(() => {
    setText("");
    setChosen(null);
    setMessage("");
    setFlagBroken(false);
    promptRef.current?.focus({ preventScroll: true });
  }, [position]);

  useEffect(() => {
    if (item?.answered) nextRef.current?.focus({ preventScroll: true });
  }, [item?.answered]);

  if (error) return <ReviewProblem error={error} retry={reload} />;
  if (!session) return <LoadingState label="Loading your review…" />;

  async function answer(value: string) {
    if (!session || !item || item.answered || busyRef.current || !value.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    // The press itself already gave its light haptic (AnswerButton select / GameButton tap).
    if (item.kind === "quiz") setChosen(value);
    try {
      const next = await api.reviewAnswer(session.id, item.position, value);
      const result = next.items.find((entry) => entry.position === item.position);
      // One feedback once the server has checked the answer.
      feel.answer(Boolean(result?.correct));
      setSession(next);
    } catch (cause) {
      setChosen(null);
      setMessage(friendlyReviewError((cause as Error).message));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function more() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      const next = await api.reviewStart(requestId());
      setSession(null);
      setPosition(null);
      navigate(`${reviewPath}/${next.id}`, { replace: true });
    } catch (cause) {
      setMessage(friendlyReviewError((cause as Error).message));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (!item) {
    return (
      <div className="ph-stack">
        <Card as="section" className="ph-quiz-hero" aria-labelledby="ph-review-done">
          <p className="ph-muted">Review complete</p>
          <h2 id="ph-review-done" className="ph-quiz-headline">
            {session.correct} of {session.total} cleared
          </h2>
          <p className="ph-muted">
            {session.correct === session.total
              ? "Every single one – well done!"
              : "The ones you missed stay on your list for next time."}
          </p>
        </Card>
        <ul className="ph-quiz-review" aria-label="Reviewed items">
          {session.items.map((entry) => (
            <li key={entry.position} className="ph-card ph-quiz-review-item" data-correct={Boolean(entry.correct)}>
              <p className="ph-quiz-review-head">
                <strong className="ph-quiz-review-status">{entry.correct ? "Cleared" : "Still open"}</strong>
                <span className="ph-muted">{kindLabel[entry.kind]}</span>
              </p>
              <p>{entry.kind === "quiz" ? entry.prompt : entry.solution}</p>
            </li>
          ))}
        </ul>
        <StatusMessage>{message}</StatusMessage>
        <LinkButton to={paths.home} block>
          Back to Home
        </LinkButton>
        <ActionBar label="Next">
          <GameButton variant="tone" tone="review" size="lg" block loading={busy} onClick={() => void more()}>
            {busy ? "Preparing…" : "Review more"}
          </GameButton>
        </ActionBar>
      </div>
    );
  }

  const nextOpen = session.items.find((entry) => !entry.answered && entry.position !== item.position);
  const flag = item.alpha2 && !flagBroken ? `/flags/${item.alpha2.toLowerCase()}.svg` : item.flagSvgUrl;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void answer(text);
  };

  return (
    <div className="ph-quiz-play">
      <ProgressBar
        value={session.answered}
        max={session.total}
        label={`${item.position} of ${session.total} · ${session.correct} cleared`}
        showValue
      />
      <div className="ph-quiz-stage">
        <p className="ph-quiz-eyebrow">
          {kindLabel[item.kind]}
          {item.difficulty ? ` · ${capitalize(item.difficulty)}` : ""}
        </p>
        {item.kind === "flag" && flag && (
          <img className="ph-review-flag" src={flag} alt="Flag to identify" onError={() => setFlagBroken(true)} />
        )}
        <h2 ref={promptRef} tabIndex={-1} className="ph-quiz-prompt">
          {item.prompt}
        </h2>
        {item.kind === "quiz" ? (
          <AnswerList layout={answerLayout} label="Answers">
            {(item.options ?? []).map((option, index) => (
              <AnswerButton
                key={option.id}
                index={index}
                state={reviewOptionState(item, option.id, chosen)}
                disabled={busy || item.answered}
                onSelect={() => void answer(option.id)}
              >
                {option.label}
              </AnswerButton>
            ))}
          </AnswerList>
        ) : (
          <form id="ph-review-form" onSubmit={submit} className="ph-stack">
            <TextField
              label={item.kind === "flag" ? "Which country is this?" : "Your answer"}
              hint="English, German or French – accents don't matter."
              value={item.answered ? (item.answer ?? "") : text}
              disabled={busy || item.answered}
              onChange={(event) => setText(event.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
            />
          </form>
        )}
      </div>

      {item.answered && (
        <section
          className={`ph-quiz-feedback ph-card ${item.correct ? "ph-pop" : "ph-shake"}`}
          data-correct={Boolean(item.correct)}
          role="status"
        >
          <div className="ph-quiz-feedback-head">
            <Icon name={item.correct ? "checkCircle" : "warning"} size={24} />
            <h3>{item.correct ? "Cleared – it won't come back." : "Not yet – it stays on your list."}</h3>
          </div>
          {item.solution && (
            <p>
              <span className="ph-muted">Answer: </span>
              <strong>{item.solution}</strong>
            </p>
          )}
          {item.explanation && <p className="ph-quiz-explanation">{item.explanation}</p>}
        </section>
      )}
      <StatusMessage tone="error">{message}</StatusMessage>

      {item.answered ? (
        <ActionBar label="Continue">
          <GameButton ref={nextRef} variant="primary" size="lg" block onClick={() => setPosition(nextOpen?.position ?? -1)}>
            {nextOpen ? "Next" : "See summary"}
          </GameButton>
        </ActionBar>
      ) : item.kind !== "quiz" ? (
        <ActionBar label="Check">
          <GameButton type="submit" form="ph-review-form" variant="primary" size="lg" block loading={busy} disabled={!text.trim()}>
            {busy ? "Checking…" : "Check"}
          </GameButton>
        </ActionBar>
      ) : null}
    </div>
  );
}
