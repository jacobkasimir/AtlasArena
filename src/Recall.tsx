import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import { getPrefs, haptic, usePrefs } from "./prefs";
import { Meter } from "./setup-ui";
import { GameChoice, GameSetup, PersonalBest, RoundTags, SetupPlace, initialChoice, setupUrl } from "./game-setup";
import {
  RecallAnswerResult, RecallChoice, RecallEntry, RecallKind, RecallLang, RecallScope, RecallSession, RecallSetup,
  buildRecallIndex, classifyRecall, formatClock, langLabel, normalizeRecall, recallHash, recallPercent
} from "./recall-domain";

const requestId = () => crypto.randomUUID();
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
  const bests = useLoad<PersonalBest[]>(() => api.personalBests());
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initial = useMemo(() => initialChoice("recall", params, ["countries", "capitals"], { scope: "un" }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [message, setMessage] = useState("");

  if (!data) return error ? <ErrorBox message={error} retry={reload} /> : <Loading />;
  const catalog = data.catalog;
  const places: SetupPlace[] = catalog.map((item) => ({
    code: item.code, name: item.name ?? item.code, region: item.region, un: item.un, easy: item.easy ?? false,
    alpha2: item.alpha2 ?? null, modes: item.hasCapital ? ["countries", "capitals"] : ["countries"],
  }));
  const regions = [...new Set(catalog.map((item) => item.region).filter((value): value is string => Boolean(value)))]
    .sort((a, b) => a.localeCompare(b)).map((name) => ({ id: name, name }));
  const recalledIn = (which: RecallKind) => {
    const codes = new Set(data.recalled[which]);
    const pool = catalog.filter((item) => item.un && (which === "countries" || item.hasCapital));
    return { done: pool.filter((item) => codes.has(item.code)).length, of: pool.length };
  };

  async function discard(id: string) {
    if (getPrefs().confirmGiveUp && !window.confirm("Discard this unfinished round?")) return;
    try { await api.recallAbandon(id); reload(); } catch (cause) { setMessage(friendlyError((cause as Error).message)); }
  }

  return (
    <GameSetup
      game="recall"
      eyebrow="Atlas Recall"
      title="How many can you name?"
      intro="Pick a set, then type every place in it from memory – in English, German or French. Each correct answer drops into your list the moment you finish typing it."
      modes={(["countries", "capitals"] as const).map((value) => {
        const progress = recalledIn(value);
        return {
          value, icon: value === "countries" ? "🌍" : "🏛️",
          title: value === "countries" ? "Countries" : "Capitals",
          text: value === "countries" ? "Every name in the set, no clues." : "The country is shown – name its capital.",
          fixedSet: value === "countries"
            ? "Countries rounds always cover the whole set – you can't know which ones a filter would pick. Choose a region to make it smaller."
            : undefined,
          footer: <><Meter done={progress.done} total={progress.of} label={`${progress.done} of ${progress.of} UN member states recalled at least once`} /><span>{progress.done}/{progress.of} UN members ever recalled</span></>,
        };
      })}
      places={places}
      regions={regions}
      unit={(count, choice) => noun(choice.mode as RecallKind, count)}
      initial={initial}
      startLabel="Start recall"
      bests={bests.error ? null : bests.data ?? []}
      resumeEmpty="None – every round you start is saved until you finish it."
      resume={data.activeSessions.map((item) => ({
        id: item.id, title: setTitle(item.kind, item.scope, item.region),
        detail: `${item.found}/${item.total} found` + (item.pool === "easy" ? " · Well-known" : item.pool === "manual" ? ` · ${item.selectedCount ?? 0} picked` : "")
          + (item.size ? ` · ${item.size} random` : "") + (item.deadlineAt ? " · timed" : ""),
        to: `/recall/play/${item.id}`, done: item.found, total: item.total, onDiscard: () => void discard(item.id),
      }))}
      error={message}
      onStart={async (choice) => {
        try {
          const session = await api.recallStart(recallChoice(choice), requestId());
          navigate(`/recall/play/${session.id}`);
        } catch (cause) {
          throw new Error(friendlyError((cause as Error).message));
        }
      }}
    />
  );
}

const recallChoice = (choice: GameChoice): RecallChoice => ({
  kind: choice.mode as RecallKind, scope: choice.scope, region: choice.region, size: choice.size,
  timeLimitSeconds: choice.limit, pool: choice.pool, picks: choice.pool === "manual" ? choice.picks : [],
});

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
  const prefs = usePrefs();
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
    haptic("correct");
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
    haptic("complete");
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
      haptic("wrong");
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
    <div className="mode-shell recall-play">
      <section className="card recall-console">
        <div className="recall-console-head">
          <div>
            <p className="eyebrow">Atlas Recall</p>
            <h1 className="recall-play-title" tabIndex={-1}>{setTitle(active.kind, active.scope, active.region)}</h1>
            <RoundTags pool={active.pool} picks={active.selectedCount} sample={active.size} limit={active.timeLimitSeconds} />
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
              <Link to="/recall" className="text-button">Pause & leave</Link>
              <button type="button" className="secondary" onClick={() => prefs.confirmGiveUp ? setConfirmGiveUp(true) : void finish()}>Give up</button>
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
      const next = await api.recallStart({ kind: done.kind, scope: done.scope, region: done.region, size: done.size, timeLimitSeconds: done.timeLimitSeconds,
        pool: done.pool ?? "all", picks: done.selectedCodes ?? [] }, requestId());
      navigate(`/recall/play/${next.id}`);
    } catch (cause) { setMessage(friendlyError((cause as Error).message)); setBusy(false); }
  }

  const list = tab === "missed" ? missed : hits;
  return (
    <div className="mode-shell">
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
          <RoundTags pool={done.pool} picks={done.selectedCount} sample={done.size} limit={done.timeLimitSeconds} />
          <div className="recall-result-actions">
            <button className="primary" onClick={() => void again()} disabled={busy}>{busy ? "Preparing…" : "Play again"}</button>
            <Link className="secondary" to={setupUrl("recall", { mode: done.kind, scope: done.scope, region: done.region, pool: done.pool ?? "all",
              picks: done.selectedCodes ?? [], size: done.size, limit: done.timeLimitSeconds })}>Change settings</Link>
          </div>
          <ErrorBox message={message} />
        </div>
      </section>

      <section className="card mt-5">
        <div className="segmented" role="tablist" aria-label="Answers">
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
