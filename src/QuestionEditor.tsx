// Admin-only dialog to fix a quiz question straight from the game or the results page.
// Saving creates a new version through the regular admin import, so the same validation applies.
import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import { difficulties } from "./domain";

export type AdminQuestionRecord = {
  stableId: string; expectedVersion: number; type: "mc" | "tf"; prompt: string; category: string; subcategory: string;
  difficulty: string; countryCode: string | null; options: { id: string; label: string }[]; correct: string;
  explanation: string; source: string; sourceVerified: boolean; reviewStatus: "draft" | "reviewed";
  lastReviewed: string | null; referenceYear: number | null; asset: unknown;
};
export type AdminQuestionInfo = {
  record: AdminQuestionRecord; published: boolean; playedVersion: number; latestVersion: number;
  publishedVersion: number | null; topics: string[];
};

const YEAR_TOPICS = ["population", "political", "borders", "currencies"];
const today = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

export function EditQuestionButton({ questionId, className = "" }: { questionId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState("");
  return (
    <>
      <button type="button" className={`admin-edit-button ${className}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span aria-hidden="true">✎</span> Edit question
      </button>
      {saved && <p className="admin-edit-saved" role="status">{saved}</p>}
      {open && <QuestionEditor questionId={questionId} onClose={() => setOpen(false)} onSaved={(message) => { setSaved(message); setOpen(false); }} />}
    </>
  );
}

export function QuestionEditor({ questionId, onClose, onSaved }: {
  questionId: string; onClose: () => void; onSaved: (message: string) => void;
}) {
  const { data, error, reload } = useLoad<AdminQuestionInfo>(() => api.adminQuestion(questionId), questionId);
  const [draft, setDraft] = useState<AdminQuestionRecord | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => { if (data) setDraft(structuredClone(data.record)); }, [data]);
  useEffect(() => {
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close.current(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, []);

  const set = <K extends keyof AdminQuestionRecord>(key: K, value: AdminQuestionRecord[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  async function save(publish: boolean, event?: FormEvent) {
    event?.preventDefault();
    if (!draft || !data) return;
    setBusy(true);
    setProblem("");
    const record: AdminQuestionRecord = {
      ...draft,
      prompt: draft.prompt.trim(),
      explanation: draft.explanation.trim(),
      source: draft.source.trim(),
      options: draft.options.map((option) => ({ ...option, label: option.label.trim() })),
      expectedVersion: data.latestVersion,
      ...(publish
        ? { reviewStatus: "reviewed" as const, sourceVerified: true, lastReviewed: today() }
        : { reviewStatus: "draft" as const }),
    };
    try {
      const result = await api.adminImport([record], false, "version", publish);
      if (!result.ok) {
        setProblem(result.errors.map((item) => item.message).join(" · ") || "The question could not be saved.");
        return;
      }
      onSaved(publish
        ? `Saved and published as version ${data.latestVersion + 1}. New games use it; this game keeps the version you were shown.`
        : `Saved as draft version ${data.latestVersion + 1}. The published version stays live until a reviewer publishes the draft.`);
    } catch (cause) {
      setProblem((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="admin-editor" role="dialog" aria-modal="true" aria-labelledby="admin-editor-title">
        <header className="admin-editor-head">
          <div>
            <p className="eyebrow">ADMIN · EDIT QUESTION</p>
            <h2 id="admin-editor-title">{draft ? draft.stableId : "Loading question"}</h2>
            {data && (
              <p className="muted text-sm">
                Version {data.latestVersion}
                {data.playedVersion !== data.latestVersion ? ` (you played version ${data.playedVersion})` : ""} ·{" "}
                {data.publishedVersion ? `version ${data.publishedVersion} is live` : "not published"}
              </p>
            )}
          </div>
          <button ref={closeRef} type="button" className="explorer-icon-button" aria-label="Close editor" onClick={onClose}>×</button>
        </header>

        {error ? <div className="admin-editor-body"><ErrorBox message={error} retry={reload} /></div> : !draft || !data ? <Loading /> : (
          <form className="admin-editor-body" onSubmit={(event) => void save(checked, event)}>
            <label>
              Question
              <textarea rows={3} value={draft.prompt} maxLength={500} onChange={(event) => set("prompt", event.target.value)} required />
            </label>

            <fieldset>
              <legend>Answers <span className="muted text-sm">– choose the correct one</span></legend>
              <div className="admin-editor-options">
                {draft.options.map((option, index) => (
                  <div key={option.id} className={`admin-editor-option ${draft.correct === option.id ? "is-correct" : ""}`}>
                    <input type="radio" name="correct" aria-label={`Answer ${index + 1} is correct`} checked={draft.correct === option.id}
                      onChange={() => set("correct", option.id)} />
                    <input aria-label={`Answer ${index + 1}`} value={option.label} maxLength={200} disabled={draft.type === "tf"}
                      onChange={(event) => set("options", draft.options.map((item) => (item.id === option.id ? { ...item, label: event.target.value } : item)))} />
                  </div>
                ))}
              </div>
              {draft.type === "tf" && <p className="muted text-sm mt-2">True/false questions keep the labels True and False.</p>}
            </fieldset>

            <label>
              Explanation shown after answering
              <textarea rows={3} value={draft.explanation} maxLength={3000} onChange={(event) => set("explanation", event.target.value)} required />
            </label>

            <fieldset>
              <legend>Difficulty</legend>
              <div className="chips">
                {difficulties.map((level) => (
                  <button key={level} type="button" className="chip" aria-pressed={draft.difficulty === level} onClick={() => set("difficulty", level)}>{level}</button>
                ))}
              </div>
            </fieldset>

            <div className="admin-editor-grid">
              <label>
                Topic
                <select value={draft.subcategory} onChange={(event) => set("subcategory", event.target.value)}>
                  {[...new Set([draft.subcategory, ...data.topics])].map((topic) => <option key={topic} value={topic}>{topic.replaceAll("_", " ")}</option>)}
                </select>
              </label>
              <label>
                Country code (optional)
                <input value={draft.countryCode ?? ""} maxLength={10} placeholder="e.g. FR"
                  onChange={(event) => set("countryCode", event.target.value.trim().toUpperCase() || null)} />
              </label>
              <label>
                Reference year{YEAR_TOPICS.includes(draft.subcategory) ? " (required)" : " (optional)"}
                <input type="number" min={1900} max={2100} value={draft.referenceYear ?? ""}
                  onChange={(event) => set("referenceYear", event.target.value ? Number(event.target.value) : null)} />
              </label>
            </div>

            <label>
              Source (https link)
              <input type="url" value={draft.source} maxLength={1000} onChange={(event) => set("source", event.target.value)} required />
            </label>
            {draft.source.startsWith("https://") && (
              <a className="text-link" href={draft.source} target="_blank" rel="noopener noreferrer">Open the source to check it ↗</a>
            )}

            <label className="admin-editor-check">
              <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
              <span>I checked the question, every answer and the explanation against the source. Publish it with today's review date.</span>
            </label>

            {problem && <p className="error" role="alert">{problem}</p>}
            <footer className="admin-editor-actions">
              <span className="flex-1" />
              <button type="button" className="secondary" disabled={busy} onClick={() => void save(false)}>Save as draft</button>
              <button type="submit" className="primary" disabled={busy || !checked}>{busy ? "Saving…" : "Save and publish"}</button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
