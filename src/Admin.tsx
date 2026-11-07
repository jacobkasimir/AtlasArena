import { useState } from "react";
import { api, isDemo } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";

const template = [{
  stableId: "geo-example-001",
  expectedVersion: 0,
  type: "mc",
  prompt: "Replace this with an original question.",
  category: "geography",
  subcategory: "capitals",
  difficulty: "easy",
  countryCode: null,
  options: [
    { id: "a", label: "Option A" }, { id: "b", label: "Option B" },
    { id: "c", label: "Option C" }, { id: "d", label: "Option D" }
  ],
  correct: "a",
  explanation: "Write an explanation.",
  source: "https://example.org/replace-with-a-real-source",
  sourceVerified: false,
  reviewStatus: "draft",
  lastReviewed: null,
  referenceYear: null,
  asset: null
}];

export default function Admin() {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const access = useLoad(() => api.dashboard());
  const list = useLoad(
    () => access.data?.profile.admin ? api.adminList(search, offset)
      : Promise.resolve({ items: [] as Record<string, unknown>[] }),
    `${Boolean(access.data?.profile.admin)}:${search}:${offset}`
  );
  const [text, setText] = useState(JSON.stringify(template, null, 2));
  const [policy, setPolicy] = useState<"reject" | "version">("reject");
  const [publish, setPublish] = useState(false);
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const signature = JSON.stringify({ text, policy, publish });

  async function perform(dryRun: boolean) {
    setPending(true); setMessage("");
    try {
      if (new Blob([text]).size > 262144) throw new Error("Maximum JSON size: 256 KiB.");
      const records = JSON.parse(text);
      if (!Array.isArray(records) || records.length < 1 || records.length > 100)
        throw new Error("Provide an array containing 1–100 records.");
      const result = await api.adminImport(records, dryRun, policy, publish);
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
  if (!access.data) return access.error?<ErrorBox message={access.error} retry={access.reload}/>:<Loading/>;
  if (!access.data.profile.admin) return <section className="card access-state" role="alert">
    <h1 tabIndex={-1} className="heading">Access denied.</h1>
    <p className="mt-3">Administrative authorization is enforced independently by every backend operation.</p>
  </section>;

  return <div className="admin-shell">
    <div className="section-heading admin-heading"><div><p className="eyebrow">ATLAS ARENA · ADMIN</p><h1 tabIndex={-1} className="heading mt-2">Content studio</h1></div><span className="pill">Secure workspace</span></div>
    <p className="muted mt-3 max-w-3xl">
      Supported editor: JSON records. Editing creates an immutable version.
      Publishing requires an explicit source-verification and review attestation.
    </p>
    <div className="admin-layout grid lg:grid-cols-[.95fr_1.05fr] gap-5 mt-6">
      <section className="card admin-list">
        <label>Filter stable ID or prompt<input value={search} maxLength={100}
          onChange={e => { setSearch(e.target.value); setOffset(0); }}/></label>
        <ErrorBox message={list.error} retry={list.reload}/>
        {list.data&&list.data.items.length===0&&<div className="empty-state mt-5"><h2 className="font-bold">No questions found</h2><p className="muted text-sm mt-2">Try another stable ID or prompt.</p></div>}
        {list.data?.items.map(q => <article className="border-b border-line/15 py-4" key={String(q.stableId)}>
          <p className="font-bold">{String(q.prompt)}</p>
          <p className="muted text-sm">{String(q.stableId)} · version {String(q.expectedVersion)} · {String(q.reviewStatus)}</p>
          <div className="flex gap-2 mt-3">
            <button className="secondary" onClick={() => {
              setText(JSON.stringify([q], null, 2)); setPolicy("version"); setPreview("");
            }}>Edit new version</button>
            <button className="secondary" disabled={pending} onClick={async () => {
              setPending(true);
              try { await api.unpublish(String(q.stableId)); list.reload(); }
              catch (e) { setMessage((e as Error).message); }
              finally { setPending(false); }
            }}>Unpublish all versions</button>
          </div>
        </article>)}
        <div className="flex gap-3 mt-4">
          <button className="secondary" disabled={!offset} onClick={() => setOffset(n => Math.max(0, n - 20))}>Previous</button>
          <button className="secondary" disabled={(list.data?.items.length ?? 0) < 20}
            onClick={() => setOffset(n => n + 20)}>Next</button>
        </div>
      </section>
      <section className="card admin-editor space-y-4">
        <label>Import JSON file · max 256 KiB
          <input type="file" accept=".json,application/json" onChange={async e => {
            const file = e.target.files?.[0]; if (!file) return;
            if (file.size > 262144) { setMessage("Maximum file size: 256 KiB."); return; }
            setText(await file.text()); setPreview("");
          }}/>
        </label>
        <label>Question records<textarea className="font-mono text-sm min-h-[32rem]"
          value={text} onChange={e => { setText(e.target.value); setPreview(""); }}/></label>
        <label>Duplicate handling<select value={policy}
          onChange={e => setPolicy(e.target.value as "reject" | "version")}>
          <option value="reject">Reject existing stable IDs</option>
          <option value="version">Create version, checking expectedVersion</option>
        </select></label>
        <label className="check"><input type="checkbox" checked={publish}
          onChange={e => setPublish(e.target.checked)}/>Publish the new versions</label>
        <div className="flex gap-3 flex-wrap">
          <button className="secondary" disabled={pending} onClick={() => void perform(true)}>Validate / dry run</button>
          <button className="primary" disabled={pending || preview !== signature}
            onClick={() => void perform(false)}>Commit validated import</button>
        </div>
        <pre className="admin-output whitespace-pre-wrap break-words text-sm" role="status">{message}</pre>
      </section>
    </div>
  </div>;
}
