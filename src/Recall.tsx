import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { api } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import {
  RecallAnswerResult, RecallChoice, RecallEntry, RecallKind, RecallLang, RecallScope, RecallSession, RecallSetup,
  buildRecallIndex, classifyRecall, formatClock, langLabel, normalizeRecall, poolCount, recallHash, recallPercent, sameSet
} from "./recall-domain";

const requestId = () => crypto.randomUUID();
const SIZES = [10, 25, 50] as const;
const LIMITS: { value: number | null; label: string }[] = [
  { value: null, label: "No limit" }, { value: 300, label: "5 min" }, { value: 600, label: "10 min" },
  { value: 900, label: "15 min" }, { value: 1200, label: "20 min" },
];
const PREFIX_WAIT_MS = 900;

const flagSrc = (alpha2: string | null) => alpha2 ? `/flags/${alpha2.toLowerCase()}.svg` : null;
const noun = (kind: RecallKind, count = 2) => kind === "countries" ? (count === 1 ? "country" : "countries") : (count === 1 ? "capital" : "capitals");

function setTitle(kind: RecallKind, scope: RecallScope, region: string | null) {
  const what = kind === "countries" ? "Countries" : "Capitals";
  if (region) return `${what} of ${region}`;
  return scope === "un" ? `${what} of the UN member states` : `${what} of every country & territory`;
}

function friendlyError(message: string) {
  const known: Record<string, string> = {
    EMPTY_RECALL_POOL: "There is nothing to recall in that set. Choose another region.",
    RECALL_SET_TOO_SMALL: "That set is smaller than the number you picked. Choose the whole set or a smaller number.",
    TOO_MANY_ACTIVE_RECALL_ROUNDS: "You have 10 unfinished rounds. Resume or discard one first.",
    RECALL_SESSION_NOT_FOUND: "That round could not be found.",
    RATE_LIMIT: "Slow down a little – try again in a minute.",
  };
  const code = Object.keys(known).find(key => message.includes(key));
  return code ? known[code] : message;
}

function Flag({ alpha2, className = "" }: { alpha2: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  const src = flagSrc(alpha2);
  if (!src || broken) return <span className={`recall-flag recall-flag-empty ${className}`} aria-hidden="true" />;
  return <img className={`recall-flag ${className}`} src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

function LangTag({ lang }: { lang: RecallLang | null }) {
  if (!lang || lang === "en") return null;
  return <span className="recall-lang" title={`Accepted in ${langLabel[lang]}`}>{lang.toUpperCase()}</span>;
}

/* ------------------------------------------------------------------------ */
/* Setup                                                                     */
/* ------------------------------------------------------------------------ */

function Setup() {
  const { data, error, reload } = useLoad<RecallSetup>(() => api.recallSetup());
  const navigate = useNavigate();
  const [kind, setKind] = useState<RecallKind>("countries");
  const [scope, setScope] = useState<RecallScope>("un");
  const [region, setRegion] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const catalog = data?.catalog ?? [];
  const regions = useMemo(() => [...new Set(catalog.map(item => item.region).filter((value): value is string => Boolean(value)))]
    .map(name => ({ name, count: poolCount(catalog, { kind, scope, region: name }) }))
    .filter(item => item.count > 0).sort((a, b) => a.name.localeCompare(b.name)), [catalog, kind, scope]);
  const total = poolCount(catalog, { kind, scope, region });
  const effective = size ?? total;
  const choice: RecallChoice = { kind, scope, region, size, timeLimitSeconds: limit };
  const best = size === null ? data?.bests.find(item => sameSet(item, choice)) : undefined;

  useEffect(() => { if (region && !regions.some(item => item.name === region)) setRegion(null); }, [regions, region]);
  useEffect(() => { if (kind === "countries" || (size !== null && size >= total)) setSize(null); }, [kind, size, total]);

  if (!data) return error ? <ErrorBox message={error} retry={reload} /> : <Loading />;

  const recalledIn = (which: RecallKind) => {
    const codes = new Set(data.recalled[which]);
    const pool = catalog.filter(item => (scope === "all" || item.un) && (which === "countries" || item.hasCapital));
    return { done: pool.filter(item => codes.has(item.code)).length, of: pool.length };
  };

  async function start(event: FormEvent) {
    event.preventDefault();
    if (!total) return;
    setBusy(true); setMessage("");
    try {
      const session = await api.recallStart(choice, requestId());
      navigate(`/recall/play/${session.id}`);
    } catch (cause) { setMessage(friendlyError((cause as Error).message)); }
    finally { setBusy(false); }
  }

  async function discard(id: string) {
    try { await api.recallAbandon(id); reload(); } catch (cause) { setMessage(friendlyError((cause as Error).message)); }
  }

  return (
    <div className="recall-shell">
      <header className="recall-hero">
        <p className="eyebrow">Atlas Recall</p>
        <h1 className="heading mt-2" tabIndex={-1}>How many can you name?</h1>
        <p className="muted mt-3 max-w-2xl">
          Pick a set, then type every place in it from memory – in English, German or French.
          Each correct answer drops into your list the moment you finish typing it.
        </p>
      </header>

      <div className="recall-setup-grid">
        <form className="card recall-setup" onSubmit={start}>
          <fieldset className="recall-step">
            <legend><span className="recall-step-number">1</span> What do you want to recall?</legend>
            <div className="recall-kind-grid">
              {(["countries", "capitals"] as const).map(value => {
                const progress = recalledIn(value);
                return (
                  <button key={value} type="button" className="recall-kind" aria-pressed={kind === value} onClick={() => setKind(value)}>
                    <span className="recall-kind-icon" aria-hidden="true">{value === "countries" ? "🌍" : "🏛️"}</span>
                    <span className="recall-kind-title">{value === "countries" ? "Countries" : "Capitals"}</span>
                    <span className="recall-kind-text">{value === "countries"
                      ? "Every name in the set, no clues."
                      : "The country is shown – name its capital."}</span>
                    <span className="recall-kind-progress" aria-label={`${progress.done} of ${progress.of} recalled at least once`}>
                      <span className="recall-meter"><span style={{ width: `${recallPercent(progress.done, progress.of)}%` }} /></span>
                      <span>{progress.done}/{progress.of} ever recalled</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="recall-step">
            <legend><span className="recall-step-number">2</span> Choose the set</legend>
            <div className="recall-segmented" role="group" aria-label="Catalog">
              <button type="button" aria-pressed={scope === "un"} onClick={() => setScope("un")}>UN member states</button>
              <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>All countries & territories</button>
            </div>
            <div className="recall-chips mt-4" role="group" aria-label="Region">
              <button type="button" className="recall-chip" aria-pressed={region === null} onClick={() => setRegion(null)}>
                Whole world <span>{poolCount(catalog, { kind, scope, region: null })}</span>
              </button>
              {regions.map(item => (
                <button key={item.name} type="button" className="recall-chip" aria-pressed={region === item.name} onClick={() => setRegion(item.name)}>
                  {item.name} <span>{item.count}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="recall-step">
            <legend><span className="recall-step-number">3</span> How many?</legend>
            {kind === "capitals" ? (
              <div className="recall-chips" role="group" aria-label="Number of capitals">
                <button type="button" className="recall-chip" aria-pressed={size === null} onClick={() => setSize(null)}>
                  All <span>{total}</span>
                </button>
                {SIZES.map(value => (
                  <button key={value} type="button" className="recall-chip" aria-pressed={size === value}
                    disabled={value >= total} onClick={() => setSize(value)}>
                    {value} random
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted text-sm">Countries rounds always cover the whole set – that's the challenge. Pick a region above to make it smaller.</p>
            )}
            {size !== null && <p className="muted text-sm mt-3">Random selections are practice rounds and don't count for personal bests.</p>}
          </fieldset>

          <fieldset className="recall-step">
            <legend><span className="recall-step-number">4</span> Time limit</legend>
            <div className="recall-chips" role="group" aria-label="Time limit">
              {LIMITS.map(item => (
                <button key={item.label} type="button" className="recall-chip" aria-pressed={limit === item.value} onClick={() => setLimit(item.value)}>
                  {item.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="recall-start-bar">
            <div>
              <p className="recall-start-count"><strong>{effective}</strong> {noun(kind, effective)}</p>
              <p className="muted text-sm">{setTitle(kind, scope, region)}{limit ? ` · ${limit / 60} min` : ""}</p>
              {best && <p className="recall-best-line">Your best: {best.found}/{best.total} in {formatClock(best.elapsedMs)}</p>}
            </div>
            <button className="primary recall-start-button" disabled={busy || !total}>{busy ? "Preparing…" : "Start recall"}</button>
          </div>
          <ErrorBox message={message} />
        </form>

        <aside className="recall-side">
          <section className="card">
            <h2 className="font-bold">Unfinished rounds</h2>
            {data.activeSessions.length ? (
              <ul className="recall-side-list">
                {data.activeSessions.map(item => (
                  <li key={item.id}>
                    <div>
                      <p className="font-semibold">{setTitle(item.kind, item.scope, item.region)}</p>
                      <p className="muted text-sm">{item.found}/{item.total} found{item.deadlineAt ? " · timed" : ""}</p>
                    </div>
                    <div className="recall-side-actions">
                      <Link className="secondary" to={`/recall/play/${item.id}`}>Resume</Link>
                      <button type="button" className="recall-text-button" onClick={() => discard(item.id)}>Discard</button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="muted text-sm mt-2">None – every round you start is saved until you finish it.</p>}
          </section>
          <section className="card">
            <h2 className="font-bold">Personal bests</h2>
            {data.bests.length ? (
              <ul className="recall-side-list">
                {data.bests.map((item, index) => (
                  <li key={index}>
                    <div>
                      <p className="font-semibold">{setTitle(item.kind, item.scope, item.region)}</p>
                      <p className="muted text-sm">{item.timeLimitSeconds ? `${item.timeLimitSeconds / 60} min limit` : "No limit"}</p>
                    </div>
                    <p className="recall-best-score">{item.found}/{item.total}<span>{formatClock(item.elapsedMs)}</span></p>
                  </li>
                ))}
              </ul>
            ) : <p className="muted text-sm mt-2">Finish a full set to record your first best.</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Play                                                                      */
/* ------------------------------------------------------------------------ */

type Feed = { position: number; text: string; name: string | null; lang: RecallLang | null; at: number };
type Hint = { tone: "ok" | "info" | "warn" | "bad"; text: string } | null;

function useClock(session: RecallSession | undefined) {
  const offset = useMemo(() => session ? Date.parse(session.serverNow) - Date.now() : 0, [session?.serverNow]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (session?.state !== "active") return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [session?.state]);
  const serverNow = now + offset;
  const elapsed = session ? serverNow - Date.parse(session.createdAt) : 0;
  const remaining = session?.deadlineAt ? Date.parse(session.deadlineAt) - serverNow : null;
  return { elapsed, remaining };
}

function Play() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: initial, error, reload } = useLoad<RecallSession>(() => api.recallView(id), id);
  const [session, setSession] = useState<RecallSession>();
  const [found, setFound] = useState<Map<number, Pick<RecallEntry, "name" | "alpha2" | "matched" | "lang">>>(new Map());
  const [feed, setFeed] = useState<Feed[]>([]);
  const [text, setText] = useState("");
  const [hint, setHint] = useState<Hint>(null);
  const [shaking, setShaking] = useState(false);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const waitTimer = useRef<number>();
  const pendingMatch = useRef<{ position: number; lang: RecallLang; text: string } | null>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!initial) return;
    if (initial.state !== "active") { navigate(`/recall/results/${initial.id}`, { replace: true }); return; }
    setSession(initial);
    setFound(new Map(initial.entries.filter(entry => entry.found).map(entry => [entry.position, entry])));
    setFeed(initial.entries.filter(entry => entry.found && entry.foundAt)
      .sort((a, b) => Date.parse(b.foundAt!) - Date.parse(a.foundAt!)).slice(0, 8)
      .map(entry => ({ position: entry.position, text: entry.matched ?? "", name: entry.name, lang: entry.lang, at: Date.parse(entry.foundAt!) })));
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [initial, navigate]);

  const index = useMemo(() => buildRecallIndex(session?.entries ?? []), [session?.entries]);
  const ambiguous = useMemo(() => new Set(session?.ambiguous ?? []), [session?.ambiguous]);
  const foundSet = useMemo(() => new Set(found.keys()), [found]);
  const { elapsed, remaining } = useClock(session);

  useEffect(() => {
    if (session && remaining !== null && remaining <= 0) void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining !== null && remaining <= 0, session?.id]);
  useEffect(() => () => window.clearTimeout(waitTimer.current), []);

  if (!session) return error ? <ErrorBox message={friendlyError(error)} retry={reload} /> : <Loading />;
  const active = session;

  async function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true; setFinishing(true);
    try { await api.recallFinish(active.id); } catch { /* the results view finalizes expired rounds too */ }
    navigate(`/recall/results/${active.id}`, { replace: true });
  }

  function accept(position: number, lang: RecallLang, typed: string) {
    window.clearTimeout(waitTimer.current); pendingMatch.current = null;
    const entry = active.entries.find(item => item.position === position)!;
    setFound(current => new Map(current).set(position, { name: null, alpha2: entry.alpha2, matched: typed, lang }));
    setFeed(current => [{ position, text: typed, name: null, lang, at: Date.now() }, ...current].slice(0, 8));
    setText("");
    setHint({ tone: "ok", text: `✓ ${typed}${lang !== "en" ? ` (${langLabel[lang]})` : ""}` });
    api.recallAnswer(active.id, position, typed).then((result: RecallAnswerResult) => {
      if (result.status === "found" || result.status === "already_found") {
        setFound(current => new Map(current).set(position, { name: result.name, alpha2: result.alpha2, matched: result.matched ?? typed, lang: result.lang ?? lang }));
        setFeed(current => current.map(item => item.position === position ? { ...item, name: result.name } : item));
        if (result.state === "completed") void finishWithResults();
      } else if (result.status === "time_up" || result.status === "not_active") {
        void finish();
      } else {
        setFound(current => { const next = new Map(current); next.delete(position); return next; });
        setFeed(current => current.filter(item => item.position !== position));
        setHint({ tone: "bad", text: `“${typed}” could not be confirmed. Try another spelling.` });
      }
    }).catch((cause: Error) => {
      setFound(current => { const next = new Map(current); next.delete(position); return next; });
      setFeed(current => current.filter(item => item.position !== position));
      setHint({ tone: "bad", text: friendlyError(cause.message) });
    });
  }

  async function finishWithResults() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    window.setTimeout(() => navigate(`/recall/results/${active.id}`, { replace: true }), 900);
  }

  async function evaluate(value: string, commit: boolean) {
    const run = ++sequence.current;
    window.clearTimeout(waitTimer.current); pendingMatch.current = null;
    const key = normalizeRecall(value);
    if (!key) { setHint(null); return; }
    const hash = await recallHash(active.salt!, key);
    if (run !== sequence.current) return;
    const match = classifyRecall(hash, index, ambiguous, foundSet);
    if (match.kind === "match") {
      if (!match.wait || commit) { accept(match.position, match.lang, value.trim()); return; }
      pendingMatch.current = { position: match.position, lang: match.lang, text: value.trim() };
      setHint({ tone: "info", text: `Press Enter to accept “${value.trim()}” – or keep typing.` });
      waitTimer.current = window.setTimeout(() => {
        if (pendingMatch.current && run === sequence.current) accept(pendingMatch.current.position, pendingMatch.current.lang, pendingMatch.current.text);
      }, PREFIX_WAIT_MS);
    } else if (match.kind === "already") {
      const name = match.positions.map(position => found.get(position)?.name).find(Boolean);
      setHint({ tone: "warn", text: `Already in your list${name ? `: ${name}` : ""}.` });
      if (commit) setText("");
    } else if (match.kind === "ambiguous") {
      setHint({ tone: "warn", text: "That name fits more than one place – be more specific." });
    } else if (commit) {
      setHint({ tone: "bad", text: `“${value.trim()}” isn't in this set.` });
      setShaking(true);
      inputRef.current?.select();
    } else {
      setHint(null);
    }
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) { setText(event.target.value); void evaluate(event.target.value, false); }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") { event.preventDefault(); void evaluate(text, true); }
    if (event.key === "Escape") { setText(""); setHint(null); window.clearTimeout(waitTimer.current); }
  }

  const foundCount = found.size;
  const percent = recallPercent(foundCount, active.total);
  const groups = active.kind === "countries"
    ? [...new Set(active.entries.map(entry => entry.region ?? "Other"))].map(name => ({ name, entries: active.entries.filter(entry => (entry.region ?? "Other") === name) }))
    : [{ name: "", entries: active.entries }];
  const lowTime = remaining !== null && remaining < 60_000;

  return (
    <div className="recall-shell recall-play">
      <section className="card recall-console">
        <div className="recall-console-head">
          <div>
            <p className="eyebrow">Atlas Recall</p>
            <h1 className="recall-play-title" tabIndex={-1}>{setTitle(active.kind, active.scope, active.region)}</h1>
          </div>
          <div className="recall-stats">
            <div className="recall-stat"><span>Found</span><strong>{foundCount}<small>/{active.total}</small></strong></div>
            <div className={`recall-stat ${lowTime ? "is-low" : ""}`} aria-live={lowTime ? "polite" : "off"}>
              <span>{remaining !== null ? "Left" : "Time"}</span>
              <strong>{formatClock(remaining !== null ? remaining : elapsed)}</strong>
            </div>
          </div>
        </div>
        <div className="recall-progress" role="progressbar" aria-valuemin={0} aria-valuemax={active.total} aria-valuenow={foundCount} aria-label="Progress">
          <span style={{ width: `${percent}%` }} />
        </div>

        <label className="sr-only" htmlFor="recall-input">Type a {noun(active.kind, 1)}</label>
        <input id="recall-input" ref={inputRef} className={`recall-input ${shaking ? "is-shaking" : ""}`} onAnimationEnd={() => setShaking(false)}
          value={text} onChange={onChange} onKeyDown={onKeyDown} disabled={finishing}
          placeholder={active.kind === "countries" ? "Type a country…" : "Type a capital…"}
          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="done" maxLength={120} />
        <p className={`recall-hint ${hint ? `is-${hint.tone}` : ""}`} role="status" aria-live="polite">
          {hint?.text ?? "English, German or French – accepted as you type. Accents and hyphens don't matter."}
        </p>

        {feed.length > 0 && (
          <ol className="recall-feed" aria-label="Recently found">
            {feed.map(item => (
              <li key={`${item.position}-${item.at}`}>
                <Flag alpha2={found.get(item.position)?.alpha2 ?? null} />
                <span className="recall-feed-text">{item.name && normalizeRecall(item.name) !== normalizeRecall(item.text) ? <>{item.text} <span className="muted">→ {item.name}</span></> : item.name ?? item.text}</span>
                <LangTag lang={item.lang} />
              </li>
            ))}
          </ol>
        )}

        <div className="recall-console-actions">
          {confirmGiveUp ? (
            <>
              <span className="muted text-sm">Reveal the missing {noun(active.kind)} and end the round?</span>
              <button type="button" className="secondary" onClick={() => { setConfirmGiveUp(false); inputRef.current?.focus(); }}>Keep going</button>
              <button type="button" className="danger-button" onClick={() => void finish()} disabled={finishing}>Give up</button>
            </>
          ) : (
            <>
              <Link to="/recall" className="recall-text-button">Pause & leave</Link>
              <button type="button" className="secondary" onClick={() => setConfirmGiveUp(true)}>Give up</button>
            </>
          )}
        </div>
      </section>

      <section className="recall-board" aria-label={`Your ${noun(active.kind)}`}>
        {groups.map(group => {
          const groupFound = group.entries.filter(entry => found.has(entry.position)).length;
          return (
            <div key={group.name || "all"} className="card recall-group">
              {group.name && groups.length > 1 && (
                <h2 className="recall-group-title">{group.name}<span>{groupFound}/{group.entries.length}</span></h2>
              )}
              <ul className={active.kind === "countries" ? "recall-slots" : "recall-capital-list"}>
                {group.entries.map(entry => {
                  const hit = found.get(entry.position);
                  if (active.kind === "countries") return (
                    <li key={entry.position} className={`recall-slot ${hit ? "is-found" : ""}`}>
                      {hit ? <><Flag alpha2={hit.alpha2} /><span>{hit.name ?? hit.matched}</span><LangTag lang={hit.lang} /></> : <span className="sr-only">Not found yet</span>}
                    </li>
                  );
                  return (
                    <li key={entry.position} className={`recall-capital ${hit ? "is-found" : ""}`}>
                      <Flag alpha2={entry.alpha2} />
                      <span className="recall-capital-country">{entry.prompt}</span>
                      <span className="recall-capital-answer">{hit ? <>{hit.name ?? hit.matched}<LangTag lang={hit.lang} /></> : <span aria-label="Not found yet">?</span>}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Results                                                                   */
/* ------------------------------------------------------------------------ */

function Results() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: session, error, reload } = useLoad<RecallSession>(() => api.recallView(id), id);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"missed" | "found">("missed");

  useEffect(() => { if (session?.state === "active") navigate(`/recall/play/${session.id}`, { replace: true }); }, [session, navigate]);
  useEffect(() => { if (session && session.found === session.total) setTab("found"); }, [session]);

  if (!session || session.state === "active") return error ? <ErrorBox message={friendlyError(error)} retry={reload} /> : <Loading />;
  const done = session;
  const missed = done.entries.filter(entry => !entry.found);
  const hits = done.entries.filter(entry => entry.found);
  const percent = recallPercent(done.found, done.total);
  const headline = done.endReason === "all_found" ? "Perfect recall!" : done.endReason === "time_up" ? "Time's up!" : "Round complete";
  const badge = { new_best: "New personal best", first_run: "First result for this set", not_best: done.best ? `Best: ${done.best.found}/${done.best.total} in ${formatClock(done.best.elapsedMs)}` : null, unranked: "Practice round – not ranked" }[done.badge ?? "unranked"];
  const ring = { background: `conic-gradient(rgb(var(--c-mint)) ${percent * 3.6}deg, rgb(var(--c-line) / .18) 0deg)` };

  async function again() {
    setBusy(true); setMessage("");
    try {
      const next = await api.recallStart({ kind: done.kind, scope: done.scope, region: done.region, size: done.size, timeLimitSeconds: done.timeLimitSeconds }, requestId());
      navigate(`/recall/play/${next.id}`);
    } catch (cause) { setMessage(friendlyError((cause as Error).message)); setBusy(false); }
  }

  const list = tab === "missed" ? missed : hits;
  return (
    <div className="recall-shell">
      <section className={`card recall-result-hero ${done.badge === "new_best" ? "is-best" : ""}`}>
        <div className="recall-ring" style={ring} role="img" aria-label={`${percent} percent`}>
          <div><strong>{percent}%</strong><span>{done.found}/{done.total}</span></div>
        </div>
        <div className="recall-result-text">
          <p className="eyebrow">{setTitle(done.kind, done.scope, done.region)}</p>
          <h1 className="heading mt-2" tabIndex={-1}>{headline}</h1>
          <p className="muted mt-2">
            You named <strong className="text-paper">{done.found}</strong> of {done.total} {noun(done.kind, done.total)} in{" "}
            <strong className="text-paper">{formatClock(done.elapsedMs ?? 0)}</strong>
            {done.timeLimitSeconds ? ` (limit ${done.timeLimitSeconds / 60} min)` : ""}.
          </p>
          {badge && <p className={`recall-badge ${done.badge === "new_best" ? "is-best" : ""}`}>{done.badge === "new_best" ? "★ " : ""}{badge}</p>}
          <div className="recall-result-actions">
            <button className="primary" onClick={() => void again()} disabled={busy}>{busy ? "Preparing…" : "Play again"}</button>
            <Link className="secondary" to="/recall">Choose another set</Link>
          </div>
          <ErrorBox message={message} />
        </div>
      </section>

      <section className="card mt-5">
        <div className="recall-segmented" role="tablist" aria-label="Answers">
          <button type="button" role="tab" aria-selected={tab === "missed"} aria-pressed={tab === "missed"} onClick={() => setTab("missed")}>Missed · {missed.length}</button>
          <button type="button" role="tab" aria-selected={tab === "found"} aria-pressed={tab === "found"} onClick={() => setTab("found")}>Found · {hits.length}</button>
        </div>
        {list.length ? (
          <ul className="recall-result-list">
            {list.map(entry => (
              <li key={entry.position} className={entry.found ? "is-found" : "is-missed"}>
                <Flag alpha2={entry.alpha2} />
                <div>
                  <p className="font-semibold">{entry.name}</p>
                  <p className="muted text-sm">
                    {done.kind === "capitals" ? entry.prompt : entry.region}
                    {entry.found && entry.matched && normalizeRecall(entry.matched) !== normalizeRecall(entry.name ?? "") ? ` · you typed “${entry.matched}”` : ""}
                  </p>
                </div>
                <LangTag lang={entry.lang} />
              </li>
            ))}
          </ul>
        ) : <p className="muted mt-4">{tab === "missed" ? "Nothing missed – every single one!" : "No answers this time."}</p>}
      </section>
    </div>
  );
}

export default function Recall() {
  return (
    <Routes>
      <Route index element={<Setup />} />
      <Route path="play/:id" element={<Play />} />
      <Route path="results/:id" element={<Results />} />
    </Routes>
  );
}
