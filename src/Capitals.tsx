import { FormEvent, KeyboardEvent, RefObject, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import { AUTO_CONTINUE_MS, haptic, isIOS, loadSetup, oneOf, saveSetup, usePrefs } from "./prefs";
import { Chips, ModePage, OptionCards, ResumeList, SetupForm, SideCard, StartBar, StreakBadge, Step } from "./setup-ui";
import {
  CapitalBest,
  CapitalCountry,
  CapitalDirection,
  CapitalEntry,
  CapitalPoolMode,
  CapitalSession,
  CapitalSetup,
  CapitalVocabularyOption,
} from "./domain";
import { capitalPercentage, capitalPool, normalizeCapitalText } from "./capitals-domain";

const requestId = () => crypto.randomUUID();
const directions: { id: CapitalDirection; title: string; description: string }[] = [
  { id: "country_to_capital", title: "Country → Capital", description: "See a country. Name one of its capitals." },
  { id: "capital_to_country", title: "Capital → Country", description: "See a capital. Identify its country." },
];
const normalize = normalizeCapitalText;
const countryFlag = (country: CapitalCountry) =>
  (country.catalogKind === "iso_alpha2" && country.codeAlpha2
    ? "/flags/" + country.codeAlpha2.toLowerCase() + ".svg"
    : null) || country.flagSvgUrl;

function useCapitalSetup() {
  return useLoad<CapitalSetup>(() => api.capitalsSetup());
}

function Setup() {
  const { data, error, reload } = useCapitalSetup();
  const bests = useLoad<CapitalBest[]>(() => api.capitalsBests());
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const saved = useMemo(() => (params.toString() ? {} : loadSetup("capitals")), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [direction, setDirection] = useState<CapitalDirection>(
    (params.get("direction") ?? saved.direction) === "capital_to_country" ? "capital_to_country" : "country_to_capital",
  );
  const [poolMode, setPoolMode] = useState<CapitalPoolMode>(
    oneOf(params.get("pool") ?? saved.poolMode, ["all", "easy", "manual"] as const, "all"),
  );
  const [selectedCodes, setSelectedCodes] = useState<string[]>(
    params.get("selected")
      ? params.get("selected")!.split(",").filter(Boolean)
      : Array.isArray(saved.selectedCodes)
        ? saved.selectedCodes.filter((code): code is string => typeof code === "string")
        : [],
  );
  const [region, setRegion] = useState(params.get("region") ?? (typeof saved.region === "string" ? saved.region : ""));
  const [countrySearch, setCountrySearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingReplay, setPendingReplay] = useState<string | null>(params.get("replay"));
  const selectedSet = useMemo(() => new Set(selectedCodes), [selectedCodes]);
  const countries = data?.countries ?? [];
  const eligible = (country: CapitalCountry) =>
    direction === "country_to_capital" ? country.countryToCapitalEligible : country.capitalToCountryEligible;
  const filteredPool = capitalPool(countries, direction, poolMode, selectedCodes, region || null);
  const outsideRegion = filteredPool.outsideRegion;
  const eligiblePool = filteredPool.countries;
  const search = normalize(countrySearch);
  const matchingCountries = countries.filter(
    (country) =>
      (!search ||
        normalize([country.name, country.officialName ?? "", country.code, country.codeAlpha3 ?? ""].join(" ")).includes(
          search,
        )) &&
      (!region || country.region === region),
  );
  const modeLabel = directions.find((item) => item.id === direction)!.title;
  const poolSize = (mode: CapitalPoolMode) => capitalPool(countries, direction, mode, selectedCodes, region || null).countries.length;
  const regionSize = (name: string) => capitalPool(countries, direction, poolMode, selectedCodes, name || null).countries.length;

  useEffect(() => {
    if (!pendingReplay || !data) return;
    const saved = data.activeSessions.find((session) => session.id === pendingReplay);
    if (saved) {
      navigate("/capitals/session/" + saved.id, { replace: true });
      return;
    }
    setPendingReplay(null);
    setMessage("That saved Capitals round could not be found. Choose settings and start a new round.");
  }, [pendingReplay, data, navigate]);
  useEffect(() => {
    if (data && region && !data.regions.includes(region)) setRegion("");
  }, [data, region]);
  function toggle(code: string) {
    setSelectedCodes((current) =>
      current.includes(code) ? current.filter((value) => value !== code) : [...current, code],
    );
  }
  function selectAllMatching() {
    setSelectedCodes((current) => [...new Set([...current, ...matchingCountries.map((country) => country.code)])]);
  }
  async function start(event: FormEvent) {
    event.preventDefault();
    if (!eligiblePool.length) return;
    setBusy(true);
    setMessage("");
    saveSetup("capitals", { direction, poolMode, region, selectedCodes: poolMode === "manual" ? selectedCodes : [] });
    try {
      const session = await api.capitalsStart(
        direction,
        poolMode,
        poolMode === "manual" ? selectedCodes : [],
        region || null,
        requestId(),
      );
      navigate("/capitals/session/" + session.id);
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (error)
    return (
      <div className="mode-shell">
        <ErrorBox message={error} retry={reload} />
      </div>
    );
  if (!data) return <Loading />;

  const side = (
    <>
    <SideCard title="Unfinished rounds">
      <ResumeList
        empty="None – rounds are saved automatically, so you can stop any time."
        items={data.activeSessions.map((session) => ({
          id: session.id,
          title: directions.find((item) => item.id === session.direction)?.title ?? "Capitals",
          detail: `${session.poolMode === "manual" ? "Your picks" : session.poolMode === "easy" ? "Well-known" : "All countries"} · ${session.region ?? "Whole world"} · ${session.score} pts`,
          to: "/capitals/session/" + session.id,
          done: session.answered,
          total: session.total,
        }))}
      />
    </SideCard>
    <SideCard title="Personal bests">
      {bests.data?.length ? (
        <ul className="side-list">
          {bests.data.slice(0, 6).map((best, index) => (
            <li key={index}>
              <div>
                <p className="font-semibold">{directions.find((item) => item.id === best.direction)?.title}</p>
                <p className="muted text-sm">
                  {best.poolMode === "manual" ? `${best.selectedCount} picked` : best.poolMode === "easy" ? "Well-known" : "All"} ·{" "}
                  {best.region ?? "Whole world"} · {best.runCount} {best.runCount === 1 ? "run" : "runs"}
                </p>
              </div>
              <p className="best-score">
                {best.correct}/{best.total}
                <span>{formatTime(best.elapsedMs)}</span>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted text-sm mt-2">Finish a round to record your first best.</p>
      )}
    </SideCard>
    </>
  );

  return (
    <ModePage
      eyebrow="Atlas Capitals"
      title="Capital cities, one by one."
      intro="Each country (or capital) in your set comes up once. Type your answer – spelling help appears as you type."
      side={side}
    >
      <SetupForm onSubmit={start}>
        <Step n={1} title="How do you want to play?">
          <OptionCards
            value={direction}
            onChange={setDirection}
            options={directions.map((option) => ({
              value: option.id,
              icon: option.id === "country_to_capital" ? "🏛️" : "🗺️",
              title: option.title,
              text: option.description,
            }))}
          />
        </Step>
        <Step n={2} title="Which countries?">
          <Chips
            label="Country pool"
            value={poolMode}
            onChange={(value) => setPoolMode(value)}
            options={[
              { value: "all", label: "All", count: poolSize("all") },
              { value: "easy", label: "Well-known", count: poolSize("easy") },
              { value: "manual", label: "Pick my own" },
            ]}
          />
          {poolMode === "manual" && (
            <div className="capitals-country-picker">
              <div className="capitals-picker-toolbar">
                <label className="capitals-search-label">
                  Search countries and territories
                  <input
                    type="search"
                    value={countrySearch}
                    onChange={(event) => setCountrySearch(event.target.value)}
                    placeholder="Search by name or code"
                    autoComplete="off"
                  />
                </label>
                <div className="capitals-picker-actions">
                  <button type="button" className="secondary" onClick={selectAllMatching} disabled={!matchingCountries.length}>
                    Select all {matchingCountries.length}
                  </button>
                  <button type="button" className="secondary" onClick={() => setSelectedCodes([])} disabled={!selectedCodes.length}>
                    Clear
                  </button>
                </div>
              </div>
              <p className="capitals-selected-count" aria-live="polite">
                {selectedCodes.length} selected
              </p>
              <div className="capitals-country-options" role="group" aria-label="Select countries and territories">
                {matchingCountries.map((country) => {
                  const flag = countryFlag(country);
                  return (
                    <label
                      key={country.code}
                      className={"capitals-country-option " + (selectedSet.has(country.code) ? "is-selected" : "")}
                    >
                      <input type="checkbox" checked={selectedSet.has(country.code)} onChange={() => toggle(country.code)} />
                      {flag ? (
                        <img src={flag} width="32" height="22" loading="lazy" alt="" />
                      ) : (
                        <span className="capitals-flag-placeholder" aria-hidden="true" />
                      )}
                      <span className="capitals-country-option-copy">
                        <strong>{country.name}</strong>
                        {!eligible(country) && <small>No usable capital data</small>}
                      </span>
                    </label>
                  );
                })}
                {!matchingCountries.length && <p className="muted">No entries match this search.</p>}
              </div>
            </div>
          )}
        </Step>
        <Step
          n={3}
          title="Region"
          hint={
            poolMode === "manual" && outsideRegion.length > 0
              ? `${outsideRegion.length} of your picks ${outsideRegion.length === 1 ? "is" : "are"} outside this region and will be left out.`
              : undefined
          }
        >
          <Chips
            label="Region"
            value={region}
            onChange={setRegion}
            options={[
              { value: "", label: "Whole world", count: regionSize("") },
              ...data.regions.map((value) => ({ value, label: value, count: regionSize(value), disabled: regionSize(value) === 0 })),
            ]}
          />
        </Step>
        <StartBar
          count={eligiblePool.length}
          unit={eligiblePool.length === 1 ? "question" : "questions"}
          busy={busy}
          disabled={!eligiblePool.length}
          label="Start round"
          summary={`${modeLabel} · ${region || "Whole world"} · 100 points each`}
        />
        {!eligiblePool.length && (
          <p className="muted" role="status">
            Nothing matches this choice yet – pick countries, or try another region.
          </p>
        )}
        {message && (
          <p className="error" role="alert">
            {message}
          </p>
        )}
      </SetupForm>
    </ModePage>
  );
}

export function CapitalCombobox({
  options,
  value,
  candidateId,
  onChange,
  onSelect,
  disabled,
  inputRef,
}: {
  options: CapitalVocabularyOption[];
  value: string;
  candidateId: string | null;
  onChange: (value: string) => void;
  onSelect: (value: string, id: string) => void;
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement>;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const query = normalize(value);
  const matches = useMemo(
    () =>
      query
        ? options
            .filter((option) => normalize(option.label).startsWith(query))
            .sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base", numeric: true }))
        : [],
    [options, query],
  );
  const visible = matches.slice(0, 9);
  useEffect(() => {
    setActive(-1);
  }, [value]);
  useEffect(() => {
    if (active >= 0) optionRefs.current[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);
  const choose = (option: CapitalVocabularyOption) => {
    onSelect(option.label, option.id);
    setOpen(false);
    setActive(-1);
  };
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && query) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(visible.length - 1, index + 1));
    } else if (event.key === "ArrowUp" && query) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index < 0 ? visible.length - 1 : Math.max(0, index - 1)));
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    } else if (event.key === "Enter" && open && active >= 0 && visible[active]) {
      event.preventDefault();
      event.stopPropagation();
      choose(visible[active]);
    }
  }
  return (
    <div className="capitals-combobox">
      <div className="capitals-input-wrap">
        <input
          ref={inputRef}
          id="capital-answer"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && Boolean(query)}
          aria-controls="capital-suggestions"
          aria-activedescendant={open && active >= 0 && visible[active] ? "capital-suggestion-" + active : undefined}
          autoComplete="off"
          value={value}
          disabled={disabled}
          placeholder="Type your answer"
          onFocus={() => {
            if (query) setOpen(true);
          }}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(Boolean(normalize(event.target.value)));
          }}
          onKeyDown={onKeyDown}
          onBlur={() => window.setTimeout(() => setOpen(false), 140)}
        />
        <span className="capitals-input-shortcut" aria-hidden="true">
          ↵
        </span>
      </div>
      {open && query && (
        <div
          className="capitals-suggestion-menu"
          id="capital-suggestions"
          role="listbox"
          aria-label="Answer suggestions"
        >
          {visible.length ? (
            visible.map((option, index) => (
              <button
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={active === index}
                id={"capital-suggestion-" + index}
                className={active === index ? "is-active" : ""}
                key={option.id + "-" + option.label}
                onMouseMove={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <span>{option.label}</span>
                <span aria-hidden="true">↵</span>
              </button>
            ))
          ) : (
            <p>No matching suggestions</p>
          )}
          {matches.length > visible.length && <small>Keep typing to narrow results</small>}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {open && query ? (matches.length ? matches.length + " matching suggestions." : "No matching suggestions.") : ""}
        {candidateId ? " Suggestion selected." : ""}
      </span>
    </div>
  );
}

function Game() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<CapitalSession | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [now, setNow] = useState(Date.now());
  const prefs = usePrefs();
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const submitLock = useRef(false);
  async function load() {
    try {
      setError("");
      const result = await api.capitalsView(id);
      setSession(result);
      if (result.state === "completed") navigate("/capitals/results/" + id, { replace: true });
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const current = session?.current;
  const finalized = Boolean(current && current.outcome !== "pending");
  const streak = useMemo(() => {
    const done = [...(session?.entries ?? [])].filter((entry) => entry.outcome !== "pending").sort((a, b) => a.position - b.position);
    let count = 0;
    for (let i = done.length - 1; i >= 0 && done[i].outcome === "correct"; i--) count++;
    return count;
  }, [session?.entries]);
  const autoContinue = Boolean(prefs.autoContinue && current?.outcome === "correct" && session?.state === "active");
  useEffect(() => {
    if (!autoContinue) return;
    const timer = window.setTimeout(() => void next(), AUTO_CONTINUE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoContinue, current?.id]);
  useEffect(() => {
    setAnswer("");
    setCandidateId(null);
    setMessage("");
    if (current && current.outcome !== "pending") {
      setMessage(
        current.outcome === "correct"
          ? "Correct · 100 points."
          : current.outcome === "skipped"
            ? "Skipped · 0 points."
            : "Not quite · 0 points.",
      );
    } else if (current) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [current?.id]);
  useEffect(() => {
    if (current && current.outcome !== "pending")
      window.setTimeout(() => document.querySelector<HTMLButtonElement>(".capitals-next-question")?.focus(), 50);
  }, [current?.outcome]);
  async function act(action: () => Promise<CapitalSession>) {
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await action();
      setSession(result);
      if (result.actionResult?.outcome === "ambiguous") {
        setMessage("That name matches more than one catalog entry. Please be more specific; no attempt was used.");
        inputRef.current?.focus();
      } else if (result.actionResult?.outcome === "correct") {
        haptic("correct");
        setMessage("Correct · 100 points.");
      }
      else if (result.actionResult?.outcome === "incorrect") {
        haptic("wrong");
        setMessage("Not quite · 0 points.");
      }
      else if (result.actionResult?.outcome === "skipped") setMessage("Skipped · 0 points.");
    } catch (cause) {
      setError((cause as Error).message);
      void load();
    } finally {
      setBusy(false);
      submitLock.current = false;
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!answer.trim()) {
      setMessage("Enter an answer first.");
      inputRef.current?.focus();
      return;
    }
    if (!session || !current) return;
    if (isIOS) haptic("tap");
    void act(() => api.capitalsAnswer(session.id, current.id, answer, candidateId, requestId()));
  }
  function skip() {
    if (!session || !current) return;
    void act(() => api.capitalsSkip(session.id, current.id, requestId()));
  }
  async function next() {
    if (!session) return;
    setBusy(true);
    try {
      const result = await api.capitalsNext(session.id, requestId());
      setSession(result);
      if (result.state === "completed") {
        haptic("complete");
        navigate("/capitals/results/" + session.id);
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function abandonNow() {
    if (!session) return;
    return act(async () => {
      const result = await api.capitalsAbandon(session.id, requestId());
      setConfirmAbandon(false);
      navigate("/capitals");
      return result;
    });
  }
  async function leave() {
    if (!session) return;
    setBusy(true);
    try {
      await api.capitalsView(session.id);
      navigate("/capitals");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (error && !session)
    return (
      <div className="capitals-shell">
        <ErrorBox message={error} retry={load} />
        <Link to="/capitals" className="secondary">
          Back to Capitals
        </Link>
      </div>
    );
  if (!session) return <Loading />;
  if (session.state === "abandoned")
    return (
      <div className="capitals-shell">
        <section className="card">
          <h1>This round was abandoned</h1>
          <p>Abandoned rounds do not count toward personal bests.</p>
          <Link to="/capitals" className="primary">
            Back to Capitals
          </Link>
        </section>
      </div>
    );
  const timer =
    session.state === "completed"
      ? (session.elapsedMs ?? 0)
      : Math.max(0, (session.elapsedMs ?? 0) + now - Date.parse(session.serverNow));
  const recent = session.entries
    .filter((entry) => entry.outcome !== "pending")
    .slice(-5)
    .reverse();
  return (
    <div className="capitals-shell">
      <header className="capitals-game-header">
        <div>
          <p className="eyebrow">
            {directions.find((item) => item.id === session.direction)?.title} · {session.region ?? "All regions"}
          </p>
          <h1 tabIndex={-1} ref={headingRef}>
            Question {current?.position ?? session.answered} <span>of {session.total}</span>
          </h1>
          <StreakBadge streak={streak} />
        </div>
        <div>
          <button className="secondary" type="button" disabled={busy} onClick={() => void leave()}>
            Save and leave
          </button>
          <button className="capitals-abandon" type="button" disabled={busy} onClick={() => (prefs.confirmGiveUp ? setConfirmAbandon(true) : void abandonNow())}>
            Abandon round
          </button>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="capitals-mobile-status" aria-label="Round status">
        <span>
          <strong>
            {session.answered}/{session.total}
          </strong>
          <small>Questions</small>
        </span>
        <span>
          <strong>{session.score}</strong>
          <small>Points</small>
        </span>
        <span>
          <strong>{formatTime(timer)}</strong>
          <small>Elapsed</small>
        </span>
      </div>
      <div className="capitals-play-layout">
        <section className="card capitals-question-card">
          <div className="capitals-question-meta">
            <span>{session.direction === "country_to_capital" ? "COUNTRY → CAPITAL" : "CAPITAL → COUNTRY"}</span>
            <span>
              {current?.position ?? session.answered} / {session.total}
            </span>
          </div>
          <h2 className="capitals-prompt">{current?.prompt}</h2>
          <form className="capitals-answer-form" onSubmit={submit}>
            <label htmlFor="capital-answer">Your answer</label>
            <CapitalCombobox
              options={session.vocabulary}
              value={answer}
              candidateId={candidateId}
              onChange={(value) => {
                setAnswer(value);
                setCandidateId(null);
              }}
              onSelect={(value, key) => {
                setAnswer(value);
                setCandidateId(key);
              }}
              disabled={busy || finalized || !current}
              inputRef={inputRef}
            />
            <p className="capitals-answer-hint">
              Suggestions use prefix matching. You can also submit an answer without selecting a suggestion.
            </p>
            <div className="capitals-answer-actions">
              <button type="submit" className="primary" disabled={busy || finalized || !current}>
                {busy ? "Checking…" : "Submit answer"}
              </button>
              <button type="button" className="secondary" onClick={skip} disabled={busy || finalized || !current}>
                Skip
              </button>
            </div>
          </form>
          {finalized && current && (
            <div className={"capitals-feedback capitals-feedback-" + current.outcome} role="status" aria-live="polite">
              <strong>
                {current.outcome === "correct" ? "Correct" : current.outcome === "incorrect" ? "Not quite" : "Skipped"}
              </strong>
              <span>{current.points} points</span>
              {current.acceptedAnswers?.length ? (
                <div className="capitals-accepted">
                  <b>{session.direction === "country_to_capital" ? "Accepted capital names" : "Country"}</b>
                  <ul>
                    {current.acceptedAnswers.map((item, index) => (
                      <li key={item.name + "-" + index}>
                        <strong>{item.name}</strong>
                        {item.primary && <small>Primary</small>}
                        {item.roles.length > 0 && <small>{item.roles.join(" · ")}</small>}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {current.catalogKind === "non_iso" && (
                <p className="capitals-neutral-note">This is a catalog entry without an ISO alpha-2 code.</p>
              )}
              {current.sourceLinks.length > 0 && (
                <div className="capitals-source-links">
                  <b>Catalog reference links</b>
                  {current.sourceLinks.map((link) => (
                    <a key={link.url + "-" + link.label} href={link.url} target="_blank" rel="noopener noreferrer">
                      {link.label}
                      <span aria-hidden="true"> ↗</span>
                    </a>
                  ))}
                  <small>
                    Imported API data can require editorial review. These links do not independently verify every
                    capital claim.
                  </small>
                </div>
              )}
            </div>
          )}
          {message && (
            <p className="capitals-message" role="status" aria-live="polite">
              {message}
            </p>
          )}
          {finalized && (
            <button
              type="button"
              className="primary capitals-next-question"
              disabled={busy}
              onClick={() => void next()}
            >
              {session.answered === session.total ? "View results" : "Next question"}
              <span aria-hidden="true">→</span>
            </button>
          )}
        </section>
        <aside className="card capitals-stats">
          <h2>Round status</h2>
          <dl>
            <div>
              <dt>Progress</dt>
              <dd>
                {session.answered} / {session.total}
              </dd>
            </div>
            <div>
              <dt>Score</dt>
              <dd>{session.score}</dd>
            </div>
            <div>
              <dt>Correct</dt>
              <dd>{session.correct}</dd>
            </div>
            <div>
              <dt>Incorrect</dt>
              <dd>{session.incorrect}</dd>
            </div>
            <div>
              <dt>Skipped</dt>
              <dd>{session.skipped}</dd>
            </div>
            <div>
              <dt>Elapsed</dt>
              <dd>{formatTime(timer)}</dd>
            </div>
          </dl>
          <p className="capitals-timer-note">
            No time limit. The final duration uses server start and completion timestamps, including feedback and time
            away.
          </p>
          {recent.length > 0 && (
            <div className="capitals-recent">
              <h3>Recent answers</h3>
              <ol>
                {recent.map((entry) => (
                  <li key={entry.id}>
                    <span>
                      Q{entry.position} · {entry.countryName}
                    </span>
                    <b className={"outcome-" + entry.outcome}>
                      {entry.outcome === "correct" ? "Correct" : entry.outcome === "skipped" ? "Skipped" : "Incorrect"}
                    </b>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>
      </div>
      {confirmAbandon && (
        <div
          className="flags-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmAbandon(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="capitals-abandon-title"
            className="card flags-confirm"
          >
            <h2 id="capitals-abandon-title">Abandon this round?</h2>
            <p>This ends the round permanently. It will not count toward personal bests.</p>
            <div>
              <button className="secondary" onClick={() => setConfirmAbandon(false)}>
                Keep playing
              </button>
              <button
                className="danger"
                onClick={() => void abandonNow()}
              >
                Abandon round
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Results() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, error, reload } = useLoad(() => api.capitalsResults(id));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (error)
    return (
      <div className="capitals-shell">
        <ErrorBox message={error} retry={reload} />
      </div>
    );
  if (!data) return <Loading />;
  if (data.state === "abandoned")
    return (
      <div className="capitals-shell">
        <section className="card">
          <p className="eyebrow">ROUND ABANDONED</p>
          <h1>Your round was abandoned</h1>
          <p>This round is not eligible for personal bests.</p>
          <Link to="/capitals" className="primary">
            Change settings
          </Link>
        </section>
      </div>
    );
  const resultData = data;
  const percentage = capitalPercentage(resultData.correct, resultData.total);
  async function replay() {
    setBusy(true);
    setMessage("");
    try {
      const session = await api.capitalsStart(
        resultData.direction,
        resultData.poolMode,
        resultData.poolMode === "manual" ? resultData.selectedCodes : [],
        resultData.region,
        requestId(),
      );
      navigate("/capitals/session/" + session.id);
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="capitals-shell capitals-results">
      <header>
        <p className="eyebrow">ROUND COMPLETE · {directions.find((item) => item.id === data.direction)?.title}</p>
        <h1 tabIndex={-1}>Your results</h1>
        <p className="muted">
          {data.finalBadge === "first_run"
            ? "First completed run"
            : data.finalBadge === "new_best"
              ? "New personal best"
              : "Completed run"}
        </p>
      </header>
      <div className="capitals-results-grid">
        <section className="card capitals-result-score">
          <span>FINAL SCORE</span>
          <strong>
            {data.score}
            <small> / {data.total * 100}</small>
          </strong>
          <b>{percentage.toFixed(1)}%</b>
          <p>Correct answers divided by all questions. Incorrect and skipped questions remain in the denominator.</p>
          <dl>
            <div>
              <dt>Correct</dt>
              <dd>
                {data.correct} / {data.total}
              </dd>
            </div>
            <div>
              <dt>Incorrect</dt>
              <dd>{data.incorrect}</dd>
            </div>
            <div>
              <dt>Skipped</dt>
              <dd>{data.skipped}</dd>
            </div>
            <div>
              <dt>Elapsed</dt>
              <dd>{formatTime(data.elapsedMs ?? 0)}</dd>
            </div>
          </dl>
          <small>
            Elapsed time uses server completion minus start time. It includes feedback screens and time away.
          </small>
        </section>
        <section className="card capitals-best-card">
          <h2>Five best for this pool</h2>
          <p>Separate by direction, selected catalog pool, content snapshot and scoring rules.</p>
          {data.topFive.length ? (
            <ol>
              {data.topFive.map((run, index) => (
                <li key={run.completedAt + "-" + index}>
                  <b>#{index + 1}</b>
                  <span>{run.score} points</span>
                  <time>{formatTime(run.elapsedMs)}</time>
                </li>
              ))}
            </ol>
          ) : (
            <p>Complete a round to start your personal best list.</p>
          )}
        </section>
      </div>
      <section className="card capitals-review">
        <header>
          <div>
            <h2>Answer review</h2>
            <p>Every country in this round, in question order.</p>
          </div>
          <span>{data.total} questions</span>
        </header>
        <ol>
          {data.entries.map((entry) => (
            <li key={entry.id}>
              <span className="capitals-review-number">Q{entry.position}</span>
              <div>
                <strong>{entry.prompt}</strong>
                <p>
                  {entry.outcome === "correct" ? "Correct" : entry.outcome === "skipped" ? "Skipped" : "Not quite"} ·{" "}
                  {entry.points} points
                </p>
                {entry.submittedAnswer && (
                  <p>
                    Your answer: <b>{entry.submittedAnswer}</b>
                  </p>
                )}
                <div className="capitals-review-accepted">
                  <b>Accepted answer{(entry.acceptedAnswers?.length ?? 0) === 1 ? "" : "s"}:</b>{" "}
                  {entry.acceptedAnswers?.map((answer) => answer.name).join(", ") || "Not available"}
                </div>
                {entry.sourceLinks.map((link) => (
                  <a key={link.label + "-" + link.url} href={link.url} target="_blank" rel="noopener noreferrer">
                    {link.label} ↗
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>
      {message && (
        <p role="alert" className="error">
          {message}
        </p>
      )}
      <div className="capitals-result-actions">
        <button className="primary" onClick={() => void replay()} disabled={busy}>
          {busy ? "Preparing round…" : "Play again"}
        </button>
        <Link className="secondary" to="/capitals">
          Change settings
        </Link>
      </div>
    </div>
  );
}

function formatTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}
export default function Capitals() {
  return (
    <Routes>
      <Route index element={<Setup />} />
      <Route path="session/:id" element={<Game />} />
      <Route path="results/:id" element={<Results />} />
    </Routes>
  );
}
