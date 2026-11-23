// Admin review queue: work through draft questions one at a time.
// Nothing is published automatically – "Approve and publish" needs the admin to confirm they checked the source.
import { useEffect, useState } from "react";
import { api } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import { QuestionEditor } from "./QuestionEditor";

const YEAR_TOPICS = ["population", "political", "borders", "currencies"];

/** Hints that help a reviewer spot problems before approving. They never block anything by themselves. */
export function reviewHints(item: { source: string; subcategory: string; referenceYear: number | null; explanation: string; options: { label: string }[] }) {
  const hints: string[] = [];
  try {
    const url = new URL(item.source);
    if (url.pathname.split("/").filter(Boolean).length <= 1)
      hints.push("The source is a general start page – find the page that states this exact fact before approving.");
  } catch {
    hints.push("The source is not a valid link.");
  }
  if (YEAR_TOPICS.includes(item.subcategory) && !item.referenceYear)
    hints.push("This topic changes over time and needs a reference year – edit the question to add one.");
  if (item.explanation.trim().length < 25) hints.push("The explanation is very short – consider adding the reason the answer is right.");
  return hints;
}

export function ReviewQueue() {
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const { data, error, reload } = useLoad(() => api.adminReviewNext(offset), `${offset}-${version}`);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const [editing, setEditing] = useState(false);
  const item = data?.item ?? null;

  useEffect(() => { setChecked(false); setProblem(""); }, [item?.stableId, item?.expectedVersion]);
  useEffect(() => {
    if (data && !data.item && offset > 0 && data.remaining > 0) setOffset(Math.max(0, data.remaining - 1));
  }, [data, offset]);

  async function approve() {
    if (!item || !checked) return;
    setBusy(true);
    setProblem("");
    try {
      await api.adminReviewApprove(item.stableId, item.expectedVersion, true);
      setNotice(`Published “${item.prompt}”.`);
      setVersion((value) => value + 1);
    } catch (cause) {
      const message = (cause as Error).message;
      setProblem(
        message.includes("QUESTION_NEEDS_HTTPS_SOURCE") ? "This question needs an https source before it can be published – edit it first."
        : message.includes("STALE_QUESTION_VERSION") ? "A newer version of this question exists – reload the queue."
        : message.includes("QUESTION_ALREADY_REVIEWED") ? "Someone already reviewed this question."
        : message,
      );
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!data) return <Loading />;
  if (!item)
    return (
      <section className="card review-queue-empty">
        <span aria-hidden="true">✅</span>
        <h2>All caught up</h2>
        <p className="muted">There are no draft questions waiting for review.</p>
      </section>
    );

  const hints = reviewHints(item);
  return (
    <section className="review-queue" aria-labelledby="review-queue-title">
      <header className="review-queue-head">
        <div>
          <p className="eyebrow">REVIEW QUEUE</p>
          <h2 id="review-queue-title">{data.remaining} draft {data.remaining === 1 ? "question" : "questions"} waiting</h2>
          <p className="muted text-sm">Showing {offset + 1} of {data.remaining} · oldest first. Nothing goes live until you approve it.</p>
        </div>
        <div className="review-queue-nav">
          <button type="button" className="secondary" disabled={offset === 0 || busy} onClick={() => setOffset((value) => Math.max(0, value - 1))}>← Previous</button>
          <button type="button" className="secondary" disabled={offset + 1 >= data.remaining || busy} onClick={() => setOffset((value) => value + 1)}>Skip →</button>
        </div>
      </header>
      <div className="game-progress" aria-hidden="true"><span style={{ width: `${((offset + 1) / data.remaining) * 100}%` }} /></div>

      {notice && <p className="review-queue-notice" role="status">{notice}</p>}

      <article className="card review-queue-card">
        <div className="review-queue-tags">
          <span>{item.subcategory.replaceAll("_", " ")}</span>
          <span>{item.difficulty}</span>
          <span>{item.type === "tf" ? "True / false" : "Multiple choice"}</span>
          {item.countryName && <span>{item.countryName}</span>}
          {item.referenceYear && <span>Reference year {item.referenceYear}</span>}
          <span className="muted">{item.stableId} · v{item.expectedVersion}</span>
        </div>
        <h3 className="review-queue-prompt">{item.prompt}</h3>
        <ul className="review-queue-options">
          {item.options.map((option) => (
            <li key={option.id} className={option.id === item.correct ? "is-correct" : undefined}>
              <span aria-hidden="true">{option.id === item.correct ? "✓" : "·"}</span>
              {option.label}
              {option.id === item.correct && <span className="sr-only"> (correct answer)</span>}
            </li>
          ))}
        </ul>
        <div className="review-queue-explanation">
          <b>Explanation</b>
          <p>{item.explanation}</p>
        </div>
        <a className="review-queue-source" href={item.source} target="_blank" rel="noopener noreferrer">
          Open the source <span aria-hidden="true">↗</span> <small>{item.source}</small>
        </a>
        {hints.length > 0 && (
          <ul className="review-queue-hints">
            {hints.map((hint) => <li key={hint}>⚠️ {hint}</li>)}
          </ul>
        )}

        <label className="admin-editor-check mt-4">
          <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
          <span>I opened the source and checked the question, the correct answer, every wrong answer and the explanation.</span>
        </label>
        {problem && <p className="error mt-3" role="alert">{problem}</p>}
        <footer className="review-queue-actions">
          <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(true)}>✎ Edit</button>
          <span className="flex-1" />
          <button type="button" className="secondary" disabled={busy || offset + 1 >= data.remaining} onClick={() => setOffset((value) => value + 1)}>Skip for now</button>
          <button type="button" className="primary" disabled={busy || !checked} onClick={() => void approve()}>
            {busy ? "Publishing…" : "Approve and publish"}
          </button>
        </footer>
      </article>

      {editing && (
        <QuestionEditor
          questionId={item.questionId}
          onClose={() => setEditing(false)}
          onSaved={(message) => { setEditing(false); setNotice(message); setVersion((value) => value + 1); }}
        />
      )}
    </section>
  );
}
