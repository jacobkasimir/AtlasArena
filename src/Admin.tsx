import { useEffect, useMemo, useState } from "react";
import { api, isDemo } from "./api";
import { difficulties } from "./domain";
import { ErrorBox, Loading, useLoad } from "./components";

type AdminQuestion = {
  stableId: string; expectedVersion: number; type: "mc" | "tf"; prompt: string;
  category: string; subcategory: string; difficulty: string; countryCode: string | null;
  options: { id: string; label: string }[]; correct: string; explanation: string;
  source: string; sourceVerified: boolean; reviewStatus: "draft" | "reviewed";
  lastReviewed: string | null; referenceYear: number | null; asset: string | null;
  [key: string]: unknown;
};
type Facets = { topics: string[]; categories: string[]; difficulties: string[] };
const today = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};
const blankQuestion = (topics: string[] = []): AdminQuestion => ({
  stableId: "geo-new-question", expectedVersion: 0, type: "mc",
  prompt: "", category: "geography", subcategory: topics[0] ?? "capitals",
  difficulty: "easy", countryCode: null,
  options: ["a", "b", "c", "d"].map((id, index) => ({ id, label: `Option ${index + 1}` })),
  correct: "a", explanation: "", source: "https://", sourceVerified: false,
  reviewStatus: "draft", lastReviewed: null, referenceYear: null, asset: null
});
const safeRecords = (text: string): AdminQuestion[] => {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value as AdminQuestion[] : [];
  } catch { return []; }
};
const jsonProblem = (text: string) => {
  try { return Array.isArray(JSON.parse(text)) ? "" : "Question JSON must be an array of records."; }
  catch (error) { return (error as Error).message; }
};

function ChoiceButtons({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (value: string) => void;
}) {
  return <fieldset className="admin-choice-group">
    <legend className="mb-2 text-sm font-semibold">{label}</legend>
    <div className="admin-choice-buttons" role="group" aria-label={label}>
      {options.map(option => <button type="button" key={option}
        className={`admin-choice ${option === value ? "is-selected" : ""}`}
        aria-pressed={option === value} onClick={() => onChange(option)}>
        {option === "" ? "All" : option === "true" ? "Verified" : option === "false" ? "Unverified" : option === "mc" ? "Multiple choice" : option === "tf" ? "True / false" : option.replaceAll("_", " ")}
      </button>)}
    </div>
  </fieldset>;
}

export default function Admin() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [category, setCategory] = useState("");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [verified, setVerified] = useState<"" | "true" | "false">("");
  const [type, setType] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [referenceYear, setReferenceYear] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const access = useLoad(() => api.dashboard());
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const list = useLoad(
    () => access.data?.profile.admin ? api.adminList({
      search: debouncedSearch, offset, category, topic, difficulty, reviewStatus,
      sourceVerified: verified === "" ? null : verified === "true",
      type, countryCode: countryCode.trim().toUpperCase(),
      referenceYear: referenceYear ? Number(referenceYear) : null
    }) : Promise.resolve({ items: [] as Record<string, unknown>[], topics: [], categories: [], difficulties: [] }),
    `${Boolean(access.data?.profile.admin)}:${debouncedSearch}:${offset}:${category}:${topic}:${difficulty}:${reviewStatus}:${verified}:${type}:${countryCode}:${referenceYear}`
  );
  const [facets, setFacets] = useState<Facets>({ topics: [], categories: [], difficulties: [...difficulties] });
  useEffect(() => {
    if (list.data) setFacets(list.data);
  }, [list.data]);

  const [text, setText] = useState(() => JSON.stringify([blankQuestion()], null, 2));
  const [selected, setSelected] = useState(0);
  const records = useMemo(() => safeRecords(text), [text]);
  const parseProblem = useMemo(() => jsonProblem(text), [text]);
  const current = records[selected];
  const [editorMode, setEditorMode] = useState<"visual" | "json">("visual");
  const [policy, setPolicy] = useState<"reject" | "version">("version");
  const [publish, setPublish] = useState(false);
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const signature = JSON.stringify({ text, policy, publish });

  function setRecords(next: AdminQuestion[], nextSelected = selected) {
    setText(JSON.stringify(next, null, 2));
    setSelected(Math.min(nextSelected, Math.max(0, next.length - 1)));
    setPreview(""); setMessage("");
  }
  function update(field: keyof AdminQuestion, value: unknown) {
    updateMany({ [field]: value });
  }
  function updateMany(fields: Partial<AdminQuestion>) {
    if (!current) return;
    const next = [...records];
    next[selected] = { ...current, ...fields };
    setRecords(next);
  }
  function selectQuestion(q: Record<string, unknown>) {
    setRecords([q as AdminQuestion], 0);
    setPolicy("version"); setPublish(false); setEditorMode("visual");
  }
  function resetFilters() {
    setSearch(""); setDebouncedSearch(""); setCategory(""); setTopic("");
    setDifficulty(""); setReviewStatus(""); setVerified(""); setType("");
    setCountryCode(""); setReferenceYear(""); setOffset(0);
  }

  async function perform(dryRun: boolean) {
    setPending(true); setMessage("");
    try {
      if (new Blob([text]).size > 262144) throw new Error("Maximum JSON size: 256 KiB.");
      const payload: unknown = JSON.parse(text);
      if (!Array.isArray(payload) || payload.length < 1 || payload.length > 100)
        throw new Error("Provide an array containing 1–100 records.");
      const result = await api.adminImport(payload, dryRun, policy, publish);
      setMessage(JSON.stringify(result, null, 2));
      if (dryRun && result.ok) setPreview(signature);
      if (!dryRun && result.ok) { setPreview(""); list.reload(); }
    } catch (e) { setMessage((e as Error).message); setPreview(""); }
    finally { setPending(false); }
  }

  if (isDemo) return <section className="card access-state">
    <h1 tabIndex={-1} className="heading">Content administration</h1>
    <p className="muted mt-3">Administration requires Supabase and a server-provisioned administrator.</p>
  </section>;
  if (!access.data) return access.error ? <ErrorBox message={access.error} retry={access.reload}/> : <Loading/>;
  if (!access.data.profile.admin) return <section className="card access-state" role="alert">
    <h1 tabIndex={-1} className="heading">Access denied.</h1>
    <p className="mt-3">Administrative authorization is enforced independently by every backend operation.</p>
  </section>;

  const topicOptions = facets.topics.length ? facets.topics : ["capitals", "countries", "flags"];
  const activeFilterCount = [search.trim(), category, topic, difficulty, reviewStatus, verified, type, countryCode, referenceYear].filter(Boolean).length;
  return <div className="admin-shell">
    <div className="section-heading admin-heading">
      <div><p className="eyebrow">ATLAS ARENA · ADMIN</p><h1 tabIndex={-1} className="heading mt-2">Question studio</h1></div>
      <span className="pill">Secure workspace</span>
    </div>
    <p className="muted mt-3 max-w-3xl">Find, inspect and revise question versions. Every change runs through validation before commit; publication still requires source verification and a dated review.</p>

    <section className="card admin-filters mt-6" aria-labelledby="question-filters-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="eyebrow">QUESTION LIBRARY</p><h2 id="question-filters-title" className="text-xl font-bold mt-1">Find a question</h2></div>
        <div className="flex flex-wrap gap-2">
          {activeFilterCount > 0 && <button className="secondary" type="button" onClick={resetFilters}>Clear filters · {activeFilterCount}</button>}
          <button className="secondary admin-filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls="admin-filter-controls" onClick={() => setFiltersOpen(open => !open)}>
            <span aria-hidden="true">{filtersOpen ? "⌃" : "☷"}</span> {filtersOpen ? "Hide filters" : `Show filters${activeFilterCount ? ` · ${activeFilterCount} active` : ""}`}
          </button>
        </div>
      </div>
      {filtersOpen && <div id="admin-filter-controls" className="admin-filter-controls">
        <div className="admin-filter-grid mt-4">
          <label className="admin-search">Search ID or question text
            <input value={search} maxLength={100} placeholder="e.g. geo-fr-capitals or Paris" onChange={e => { setSearch(e.target.value); setOffset(0); }}/>
          </label>
          <ChoiceButtons label="Category" value={category} options={["", ...facets.categories]} onChange={value => { setCategory(value); setOffset(0); }}/>
          <ChoiceButtons label="Topic" value={topic} options={["", ...topicOptions]} onChange={value => { setTopic(value); setOffset(0); }}/>
          <ChoiceButtons label="Difficulty" value={difficulty} options={["", ...(facets.difficulties.length ? facets.difficulties : [...difficulties])]} onChange={value => { setDifficulty(value); setOffset(0); }}/>
          <ChoiceButtons label="Review status" value={reviewStatus} options={["", "draft", "reviewed"]} onChange={value => { setReviewStatus(value); setOffset(0); }}/>
          <ChoiceButtons label="Source verification" value={verified} options={["", "true", "false"]} onChange={value => { setVerified(value as "" | "true" | "false"); setOffset(0); }}/>
          <ChoiceButtons label="Question format" value={type} options={["", "mc", "tf"]} onChange={value => { setType(value); setOffset(0); }}/>
          <label>Country code<input value={countryCode} maxLength={2} placeholder="Any country" onChange={e => { setCountryCode(e.target.value.replace(/[^a-z]/gi, "").toUpperCase()); setOffset(0); }}/></label>
          <label>Reference year<input type="number" min={1900} max={2100} value={referenceYear} placeholder="Any year" onChange={e => { setReferenceYear(e.target.value); setOffset(0); }}/></label>
        </div>
      </div>}
      <p className="muted text-sm mt-3" aria-live="polite">{list.data ? `${list.data.items.length} questions on this page` : "Loading matching questions…"}</p>
    </section>

    <div className="admin-layout grid lg:grid-cols-[.88fr_1.12fr] gap-5 mt-5">
      <section className="card admin-list" aria-label="Matching questions">
        <ErrorBox message={list.error} retry={list.reload}/>
        {!list.data && !list.error && <Loading/>}
        {list.data?.items.length === 0 && <div className="empty-state mt-2"><span aria-hidden="true" className="empty-icon">⌕</span><h2 className="font-bold mt-3">No questions found</h2><p className="muted text-sm mt-2">Change or clear a filter to broaden your results.</p></div>}
        {list.data?.items.map(q => <article className="admin-question-row" key={String(q.stableId)}>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="admin-tag">{String(q.subcategory)}</span><span className="admin-tag">{String(q.difficulty)}</span>
            <span className={`admin-tag ${q.reviewStatus === "reviewed" ? "is-reviewed" : ""}`}>{String(q.reviewStatus)}</span>
            <span className="admin-tag">{q.sourceVerified ? "Source verified" : "Source unverified"}</span>
          </div>
          <h3 className="font-bold mt-3 leading-snug">{String(q.prompt)}</h3>
          <p className="muted text-xs mt-2 break-all">{String(q.stableId)} · version {String(q.expectedVersion)}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button className="secondary" type="button" onClick={() => selectQuestion(q)}>Inspect &amp; edit</button>
            <button className="secondary" type="button" disabled={pending} onClick={async () => {
              setPending(true);
              try { await api.unpublish(String(q.stableId)); list.reload(); setMessage(`All versions of ${String(q.stableId)} were unpublished.`); }
              catch (e) { setMessage((e as Error).message); }
              finally { setPending(false); }
            }}>Unpublish all versions</button>
          </div>
        </article>)}
        <div className="flex gap-3 mt-4">
          <button className="secondary" disabled={!offset || pending} onClick={() => setOffset(n => Math.max(0, n - 20))}>Previous</button>
          <button className="secondary" disabled={(list.data?.items.length ?? 0) < 20 || pending} onClick={() => setOffset(n => n + 20)}>Next</button>
        </div>
      </section>

      <section className="card admin-editor" aria-labelledby="editor-title">
        <div className="section-heading">
          <div><p className="eyebrow">VERSIONED EDITOR</p><h2 id="editor-title" className="text-xl font-bold mt-1">Question details</h2></div>
          <button type="button" className="primary" onClick={() => { setRecords([blankQuestion(topicOptions)], 0); setPolicy("version"); setPublish(false); }}>New question</button>
        </div>
        <div className="admin-editor-toolbar mt-4">
          <label className="admin-file">Import JSON file · max 256 KiB
            <input type="file" accept=".json,application/json" onChange={async e => {
              const file = e.target.files?.[0]; if (!file) return;
              if (file.size > 262144) { setMessage("Maximum file size: 256 KiB."); return; }
              try {
                const imported = await file.text();
                const parsed: unknown = JSON.parse(imported);
                if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 100) throw new Error("The file must contain 1–100 question records.");
                setRecords(parsed as AdminQuestion[], 0); setEditorMode("visual"); setPolicy("version"); setPublish(false);
              } catch (error) { setMessage((error as Error).message); }
              e.currentTarget.value = "";
            }}/>
          </label>
          <div className="admin-view-toggle" role="group" aria-label="Editor view">
            <button type="button" aria-pressed={editorMode === "visual"} className={editorMode === "visual" ? "is-active" : ""} onClick={() => setEditorMode("visual")}>Visual editor</button>
            <button type="button" aria-pressed={editorMode === "json"} className={editorMode === "json" ? "is-active" : ""} onClick={() => setEditorMode("json")}>JSON</button>
          </div>
        </div>
        {records.length > 1 && <label className="admin-record-select mt-4">Record in this import
          <select value={selected} onChange={e => setSelected(Number(e.target.value))}>
            {records.map((record, index) => <option value={index} key={`${record.stableId}-${index}`}>{index + 1}. {record.stableId} — {record.prompt || "Untitled question"}</option>)}
          </select>
        </label>}

        {editorMode === "visual" ? current ? <div className="admin-visual-editor mt-4">
          <div className="admin-preview" aria-label="Live question preview">
            <div className="flex flex-wrap gap-2"><span className="admin-tag">{current.subcategory || "Choose topic"}</span><span className="admin-tag">{current.difficulty}</span><span className="admin-tag">{current.type === "tf" ? "True / false" : "Multiple choice"}</span></div>
            <p className="font-bold text-lg mt-3">{current.prompt || "Your question will appear here"}</p>
            <ol className="admin-preview-options mt-3">
              {current.options?.map(option => <li key={option.id} className={current.correct === option.id ? "is-correct" : ""}><span>{option.label || "Answer option"}</span>{current.correct === option.id && <span className="correct-label">✓ Correct answer</span>}</li>)}
            </ol>
          </div>

          <div className="admin-field-grid mt-4">
            <label>Stable ID<input value={current.stableId ?? ""} maxLength={80} onChange={e => update("stableId", e.target.value)}/></label>
            <label>Version<input value={String(current.expectedVersion ?? 0)} readOnly aria-describedby="version-hint"/></label>
            <p id="version-hint" className="muted field-hint">Version is checked by the server before saving.</p>
          </div>
          <label className="mt-4 block">Question text<textarea value={current.prompt ?? ""} maxLength={500} rows={3} placeholder="Ask one clear, verifiable question" onChange={e => update("prompt", e.target.value)}/></label>

          <div className="admin-field-grid mt-4">
            <ChoiceButtons label="Category" value={current.category ?? "geography"} options={facets.categories.length ? facets.categories : ["geography"]} onChange={value => update("category", value)}/>
            <ChoiceButtons label="Difficulty" value={current.difficulty ?? "easy"} options={[...difficulties]} onChange={value => update("difficulty", value)}/>
          </div>
          <ChoiceButtons label="Topic" value={current.subcategory ?? ""} options={topicOptions} onChange={value => update("subcategory", value)}/>
          <ChoiceButtons label="Question format" value={current.type ?? "mc"} options={["mc", "tf"]} onChange={value => {
            const options = value === "tf" ? [{ id: "true", label: "True" }, { id: "false", label: "False" }] : ["a", "b", "c", "d"].map((id, index) => ({ id, label: `Option ${index + 1}` }));
            updateMany({ type: value as "mc" | "tf", options, correct: options[0].id });
          }}/>

          <fieldset className="admin-answer-editor">
            <legend className="text-sm font-semibold mb-2">Answer options <span className="muted">· choose which answer is correct</span></legend>
            {current.options?.map((option, index) => <div className="admin-answer-row" key={option.id}>
              {current.type === "mc" ? <input aria-label={`Option ${index + 1} ID`} className="admin-option-id" value={option.id} maxLength={40} onChange={e => {
                const id = e.target.value;
                updateMany({ options: current.options.map((item, i) => i === index ? { ...item, id } : item), correct: current.correct === option.id ? id : current.correct });
              }}/> : <span className="admin-option-id">{option.label}</span>}
              {current.type === "mc" && <input aria-label={`Option ${index + 1} text`} value={option.label} maxLength={200} onChange={e => update("options", current.options.map((item, i) => i === index ? { ...item, label: e.target.value } : item))}/>}
              <label className="admin-correct-choice"><input type="radio" name={`correct-${selected}`} checked={current.correct === option.id} onChange={() => update("correct", option.id)}/><span>Correct</span></label>
            </div>)}
          </fieldset>

          <label>Explanation<textarea value={current.explanation ?? ""} maxLength={3000} rows={3} placeholder="Explain why the answer is correct" onChange={e => update("explanation", e.target.value)}/></label>
          <label>Source URL<input type="url" value={current.source ?? ""} maxLength={1000} placeholder="https://…" onChange={e => update("source", e.target.value)}/></label>
          <div className="admin-field-grid">
            <ChoiceButtons label="Review status" value={current.reviewStatus ?? "draft"} options={["draft", "reviewed"]} onChange={value => update("reviewStatus", value)}/>
            <ChoiceButtons label="Source verification" value={current.sourceVerified ? "verified" : "unverified"} options={["unverified", "verified"]} onChange={value => update("sourceVerified", value === "verified")}/>
          </div>
          <div className="admin-field-grid">
            <label>Last reviewed<input type="date" max={today()} value={current.lastReviewed ?? ""} onChange={e => update("lastReviewed", e.target.value || null)}/></label>
            <div className="admin-date-action"><span className="text-sm font-semibold">Review date shortcut</span><button className="secondary" type="button" onClick={() => update("lastReviewed", today())}>Use today · {today()}</button></div>
            <label>Reference year<input type="number" min={1900} max={2100} value={current.referenceYear ?? ""} placeholder="Optional" onChange={e => update("referenceYear", e.target.value ? Number(e.target.value) : null)}/></label>
          </div>
          <label>Country code<input value={current.countryCode ?? ""} maxLength={2} placeholder="Optional, e.g. FR" onChange={e => update("countryCode", e.target.value.toUpperCase() || null)}/></label>
        </div> : <p className="empty-state mt-4" role={parseProblem ? "alert" : undefined}>{parseProblem ? `Visual editor needs valid JSON: ${parseProblem}` : "Import or create a question to edit its fields."}</p> : <label className="block mt-4">Question records JSON<textarea className="font-mono text-sm min-h-[32rem]" value={text} onChange={e => { setText(e.target.value); setPreview(""); }}/></label>}

        <div className="admin-import-controls mt-5">
          <fieldset className="admin-policy-select">
            <legend className="font-semibold mb-2">Duplicate handling</legend>
            <div className="admin-policy-options">
              <label className={`admin-policy-card ${policy === "version" ? "is-selected" : ""}`}>
                <input type="radio" name="duplicate-policy" value="version" checked={policy === "version"} onChange={() => setPolicy("version")}/>
                <span><strong>Create a new version <span className="admin-default-tag">Default</span></strong><small>Keep the existing record history and add the next version. The import is accepted only if its expected version matches the latest server version; otherwise the server reports a version conflict.</small></span>
              </label>
              <label className={`admin-policy-card ${policy === "reject" ? "is-selected" : ""}`}>
                <input type="radio" name="duplicate-policy" value="reject" checked={policy === "reject"} onChange={() => setPolicy("reject")}/>
                <span><strong>Reject existing IDs</strong><small>If a stable ID already exists, the server reports an error for that record. New IDs are still imported as their first version.</small></span>
              </label>
            </div>
          </fieldset>
          <label className="admin-publish-toggle"><input type="checkbox" checked={publish} onChange={e => setPublish(e.target.checked)}/><span><strong>Publish new versions</strong><small>When enabled, the server publishes each imported version and unpublishes the previous live version with the same stable ID.</small></span></label>
          <aside className="admin-publish-explainer">
            <strong>What publishing does</strong>
            <p>Publishing requires every record to be marked Reviewed, have a verified source, and include a review date that is not in the future. If this is off, the imported version stays unpublished; any current published version remains live.</p>
          </aside>
          {publish && current && (current.reviewStatus !== "reviewed" || !current.sourceVerified || !current.lastReviewed) && <p className="admin-publish-hint" role="status">Publishing requires Reviewed status, a verified source, and a review date.</p>}
          <div className="flex gap-3 flex-wrap">
            <button className="secondary" disabled={pending} onClick={() => void perform(true)}>Validate / preview</button>
            <button className="primary" disabled={pending || preview !== signature} onClick={() => void perform(false)}>Commit validated import</button>
          </div>
          <pre className="admin-output whitespace-pre-wrap break-words text-sm" role="status" aria-live="polite">{message}</pre>
        </div>
      </section>
    </div>
  </div>;
}
