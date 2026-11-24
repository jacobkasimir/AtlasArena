import { IconTile } from "./icons";
import { FormEvent, KeyboardEvent, RefObject, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import { autoContinueMs, getPrefs, haptic, isIOS, showCountdown, useLeaveGuard, usePrefs } from "./prefs";
import { cue } from "./sound";
import { ContinueHint, StreakBadge } from "./setup-ui";
import { ConfirmDialog } from "./ConfirmDialog";
import { gridStep, isContinueKey, numberKeyIndex, useGameKeys } from "./keys";
import {
  GameChoice, GameSetup, PersonalBest, RoundTags, SetupPlace, TimeLeft, badgeText, describeSetup, endedOnTime, initialChoice,
  regionLabel, roundOptions, setupUrl, useTimeLeft,
} from "./game-setup";
import { FlagsAnswerOption, FlagsChoice, FlagsDirection, FlagsEntry, FlagsSession, FlagsSetup as SetupData } from "./domain";

const requestId = () => crypto.randomUUID();
const directionName = (d: FlagsDirection) => (d === "country_to_flag" ? "Country → Flag" : "Flag → Country");
const flagModes = ["country_to_flag", "flag_to_country"] as const;
const choiceOf = (s: FlagsSession): GameChoice => ({
  mode: s.direction, scope: s.scope ?? "all", region: s.region, pool: s.poolTier, picks: s.selectedCodes ?? [],
  size: s.sampleSize ?? null, limit: s.timeLimitSeconds ?? null,
});
function localFlagFallback(svgUrl: string | null) {
  if (!svgUrl) return null;
  try {
    const url = new URL(svgUrl);
    if (url.hostname !== "flags.restcountries.com") return null;
    const code = url.pathname.match(/\/([a-z]{2})\.svg$/i)?.[1];
    return code ? `/flags/${code.toLowerCase()}.svg` : null;
  } catch {
    return null;
  }
}
export function FlagImage({
  value,
  label,
  className = "",
  onUnavailable,
}: {
  value: Pick<FlagsChoice, "flagSvgUrl" | "flagPngUrl" | "flagDescription">;
  label: string;
  className?: string;
  onUnavailable?: (missing: boolean) => void;
}) {
  const sources = [
    ...new Set(
      [value.flagSvgUrl, value.flagPngUrl, localFlagFallback(value.flagSvgUrl)].filter((source): source is string =>
        Boolean(source),
      ),
    ),
  ];
  const sourceKey = sources.join("|");
  const [sourceIndex, setSourceIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setSourceIndex(0);
    setFailed(false);
  }, [sourceKey]);
  const source = sources[sourceIndex] || "";
  const onError = () => {
    if (sourceIndex < sources.length - 1) {
      setSourceIndex((index) => index + 1);
      return;
    }
    setFailed(true);
    onUnavailable?.(true);
  };
  return (
    <span className={`flags-image ${className}`} role="img" aria-label={label}>
      {source ? (
        <img
          ref={(node) => node?.setAttribute("fetchpriority", className.includes("large") ? "high" : "auto")}
          src={source}
          alt=""
          width={className.includes("small") ? 72 : undefined}
          height={className.includes("small") ? 48 : undefined}
          loading={className.includes("large") ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => onUnavailable?.(false)}
          onError={onError}
        />
      ) : (
        <span className="flags-image-fallback" aria-hidden="true">
          {failed ? "Flag unavailable" : "Loading flag"}
        </span>
      )}
      {failed && (
        <button
          type="button"
          className="flags-retry"
          aria-label={`Retry loading ${label}`}
          onClick={() => {
            setFailed(false);
            onUnavailable?.(false);
            setSourceIndex(0);
          }}
        >
          Retry
        </button>
      )}
    </span>
  );
}
function normalizeOptionSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}
function CountryAnswerCombobox({
  options,
  value,
  onChange,
  disabled,
  inputRef,
}: {
  options: FlagsAnswerOption[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement>;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const query = normalizeOptionSearch(value);
  const filtered = query
    ? options.filter(
        (option) =>
          normalizeOptionSearch(option.alpha2 ?? "").startsWith(query) ||
          normalizeOptionSearch(option.name).startsWith(query),
      )
    : [];
  useEffect(() => {
    setActive(-1);
  }, [value]);
  useEffect(() => {
    if (active >= 0) optionRefs.current[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);
  const select = (option: FlagsAnswerOption) => {
    onChange(option.name);
    setOpen(false);
    setActive(-1);
    inputRef.current?.focus();
  };
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && query) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index < 0 ? 0 : Math.min(filtered.length - 1, index + 1)));
    } else if (event.key === "ArrowUp" && query) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index < 0 ? filtered.length - 1 : Math.max(0, index - 1)));
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Enter" && open && active >= 0 && filtered[active]) {
      event.preventDefault();
      select(filtered[active]);
    }
  }
  return (
    <div className="flags-combobox">
      <div className="flags-combobox-control">
        <input
          ref={inputRef}
          id="flags-answer"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="flags-answer-options"
          aria-activedescendant={open && active >= 0 && filtered[active] ? `flags-answer-option-${active}` : undefined}
          autoComplete="off"
          maxLength={200}
          placeholder="Type a country name or ISO code"
          value={value}
          onFocus={() => {
            if (query) setOpen(true);
          }}
          onClick={() => {
            if (query) setOpen(true);
          }}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(Boolean(normalizeOptionSearch(event.target.value)));
          }}
          onKeyDown={onKeyDown}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          disabled={disabled}
        />
        <button
          type="button"
          className={`flags-combobox-toggle ${open ? "is-open" : ""}`}
          aria-label={open ? "Close country options" : "Show country options"}
          aria-expanded={open}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (query) setOpen((current) => !current);
            inputRef.current?.focus();
          }}
          disabled={disabled || !query}
        >
          <span aria-hidden="true">⌄</span>
        </button>
      </div>
      {open && (
        <div
          className="flags-combobox-menu"
          id="flags-answer-options"
          role="listbox"
          aria-label="Countries and territories"
        >
          {filtered.length ? (
            filtered.map((option, index) => (
              <button
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={index === active}
                id={`flags-answer-option-${index}`}
                className={`flags-combobox-option ${index === active ? "is-active" : ""}`}
                key={`${option.alpha2 ?? "no-code"}-${option.name}`}
                onMouseMove={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(option)}
              >
                <span className="flags-combobox-code">{option.alpha2 ?? "—"}</span>
                <span className="flags-combobox-separator" aria-hidden="true">
                  ·
                </span>
                <span className="flags-combobox-name">{option.name}</span>
              </button>
            ))
          ) : (
            <p className="flags-combobox-empty">No matching catalog entries.</p>
          )}
        </div>
      )}
    </div>
  );
}
function Setup() {
  const { data, error, reload } = useLoad<SetupData>(() => api.flagsSetup());
  const bests = useLoad<PersonalBest[]>(() => api.personalBests());
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initial = useMemo(() => initialChoice("flags", params, [...flagModes], { pool: "easy" }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [message, setMessage] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function discard(id: string) {
    try {
      await api.flagsDelete(id, requestId());
      setDeleteId(null);
      reload();
    } catch (e) {
      setMessage((e as Error).message);
      setDeleteId(null);
    }
  }
  if (error)
    return (
      <div className="mode-shell">
        <ErrorBox message={error} retry={reload} />
      </div>
    );
  if (!data) return <Loading />;
  const places: SetupPlace[] = (data.countries ?? []).map((place) => ({ ...place, modes: [...flagModes] }));

  return (
    <GameSetup
      game="flags"
      eyebrow="Atlas Flags"
      title="Know your flags?"
      intro="Every flag in your set comes up once. Get it right, use a hint, or skip – your round is saved as you go."
      modes={[
        { value: "country_to_flag", icon: <IconTile name="flag" tone="flags" />, title: "Country → Flag", text: "See a country name and pick its flag." },
        { value: "flag_to_country", icon: <IconTile name="search" tone="flags" />, title: "Flag → Country", text: "See a flag and type the country it belongs to." },
      ]}
      places={places}
      regions={data.regions.map((region) => ({ id: region.id, name: region.name }))}
      unit={(count) => (count === 1 ? "flag" : "flags")}
      initial={initial}
      bests={bests.error ? null : bests.data ?? []}
      hint={(choice) => (choice.mode === "flag_to_country" && choice.region ? "Region hints are switched off when you play a single region." : undefined)}
      resumeEmpty="None – rounds are saved automatically, so you can stop any time."
      resume={data.activeSessions.map((s) => ({
        id: s.id,
        title: directionName(s.direction),
        detail: describeSetup({ scope: s.scope ?? "all", region: s.region, pool: s.poolTier, picks: s.selectedCount, size: s.sampleSize, limit: s.timeLimitSeconds ?? null })
          + (s.paused ? " · paused" : ""),
        to: `/flags/session/${s.id}`,
        done: s.answered,
        total: s.total,
        onDiscard: () => (getPrefs().confirmGiveUp ? setDeleteId(s.id) : void discard(s.id)),
      }))}
      error={message}
      onStart={async (choice) => {
        const result = await api.flagsStart(choice.mode as FlagsDirection, choice.region, choice.pool, requestId(), roundOptions(choice));
        navigate(`/flags/session/${result.id}`);
      }}
    >
      {deleteId && (
        <ConfirmDialog
          id="flags-delete"
          title="Discard this round?"
          cancelLabel="Keep round"
          confirmLabel="Discard"
          onCancel={() => setDeleteId(null)}
          onConfirm={() => void discard(deleteId)}
        >
          Your answers in this round will be removed.
        </ConfirmDialog>
      )}
    </GameSetup>
  );
}

function StatsPanel({
  session,
  feedback,
  feedbackClass,
  busy,
  onNext,
  nextRef,
  timeLeft,
}: {
  timeLeft: number | null;
  session: FlagsSession;
  feedback: string;
  feedbackClass: string;
  busy: boolean;
  onNext: () => void;
  nextRef: RefObject<HTMLButtonElement>;
}) {
  const prefs = usePrefs();
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed =
    session.state === "completed" || session.paused
      ? (session.elapsedMs ?? 0)
      : Math.max(0, (session.elapsedMs ?? 0) + tick - Date.parse(session.serverNow));
  const fmt = (ms: number) => {
    const sec = Math.floor(ms / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };
  return (
    <aside className="card flags-stats">
      <h2>Round status</h2>
      {feedback && (
        <p className={`flags-feedback flags-sidebar-feedback ${feedbackClass}`} role="status" aria-live="polite">
          {feedback}
        </p>
      )}
      <dl>
        <div>
          <dt>Progress</dt>
          <dd>
            {session.answered} / {session.total}
          </dd>
        </div>
        <div>
          <dt>Correct</dt>
          <dd>{session.correct}</dd>
        </div>
        <div>
          <dt>Incorrect</dt>
          <dd>{session.incorrect}</dd>
        </div>
        {session.direction === "flag_to_country" && (
          <div>
            <dt>Skipped</dt>
            <dd>{session.skipped}</dd>
          </div>
        )}
        <div>
          <dt>Score</dt>
          <dd>{session.score}</dd>
        </div>
        <div>
          <dt>{timeLeft !== null ? "Time left" : "Elapsed"}</dt>
          <dd>
            {timeLeft === null ? fmt(elapsed) : showCountdown(prefs, timeLeft) ? fmt(timeLeft) : "Hidden until the last 30s"}
          </dd>
        </div>
      </dl>
      {session.current && session.current.outcome !== "pending" && (
        <button ref={nextRef} className="primary flags-next" disabled={busy} onClick={onNext}>
          {session.answered === session.total ? "View results" : "Next flag"}
        </button>
      )}
    </aside>
  );
}
function Game() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<FlagsSession | null>(null);
  const [roundOutcomes, setRoundOutcomes] = useState<Record<string, Pick<FlagsEntry, "outcome" | "attempts">>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const prefs = usePrefs();
  useLeaveGuard(session?.state === "active");
  const [focusedChoice, setFocusedChoice] = useState(0);
  const [unavailableAssets, setUnavailableAssets] = useState<string[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const answerRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const gameKeys = useGameKeys();
  gameKeys.current = null;
  const latestSession = useRef<FlagsSession | null>(null);
  const mobileNextRef = useRef<HTMLButtonElement>(null);
  const focusNext = () =>
    window.setTimeout(() => {
      const button = window.matchMedia("(max-width: 800px)").matches ? mobileNextRef.current : nextRef.current;
      button?.focus();
    }, 30);
  const load = async () => {
    try {
      setError("");
      const s = await api.flagsResume(id, requestId());
      latestSession.current = s;
      setSession(s);
      const saved: Record<string, Pick<FlagsEntry, "outcome" | "attempts">> = {};
      for (const entry of s.entries)
        if (entry.outcome !== "pending") {
          const result = { outcome: entry.outcome, attempts: entry.attempts };
          saved[entry.id] = result;
          if (entry.choicePosition != null) saved[`position:${entry.choicePosition}`] = result;
        }
      if (s.current && s.current.outcome !== "pending") {
        const result = { outcome: s.current.outcome, attempts: s.current.attempts };
        saved[s.current.id] = result;
        if (s.current.choicePosition != null) saved[`position:${s.current.choicePosition}`] = result;
      }
      setRoundOutcomes(saved);
      if (s.state === "completed") navigate(`/flags/results/${id}`, { replace: true });
      else if (s.state === "abandoned") setError("This round was abandoned and cannot be resumed.");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, [id]);
  useEffect(
    () => () => {
      const current = latestSession.current;
      if (current?.state === "active" && !current.timeLimitSeconds) void api.flagsPause(id, requestId()).catch(() => {});
    },
    [id],
  );
  useEffect(() => {
    if (session?.current) {
      setAnswer("");
      const entry = session.current;
      setFeedback(
        entry.outcome === "pending"
          ? session.direction === "country_to_flag" && entry.attempts > 0
            ? `Incorrect. ${Math.max(0, 3 - entry.attempts)} ${3 - entry.attempts === 1 ? "attempt" : "attempts"} remaining.`
            : ""
          : entry.outcome === "correct"
            ? session.direction === "country_to_flag"
              ? `Correct · ${entry.attempts === 1 ? "first" : entry.attempts === 2 ? "second" : "third"} try · ${entry.points} points.`
              : `Correct · ${entry.points} points.`
            : entry.outcome === "skipped"
              ? "Skipped · 0 points. The correct answer is shown."
              : "Not solved · 0 points. The correct answer is shown.",
      );
      const active = document.activeElement;
      const shouldFocus =
        active === document.body || active === headingRef.current || !active?.closest("button,input,select,a,textarea");
      if (shouldFocus)
        setTimeout(() => {
          if (session.direction === "flag_to_country") answerRef.current?.focus();
          else
            (gridRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]:not(:disabled)') ?? headingRef.current)?.focus();
        }, 0);
    }
  }, [session?.current?.id]);
  const current = session?.current;
  const streak = useMemo(() => {
    const done = [...(session?.entries ?? [])]
      .filter((entry) => entry.outcome !== "pending")
      .sort((a, b) => a.position - b.position);
    let count = 0;
    for (let i = done.length - 1; i >= 0 && done[i].outcome === "correct"; i--) count++;
    return count;
  }, [session?.entries]);
  const timeLeft = useTimeLeft(session?.state === "active" ? session.deadlineAt : null, session?.serverNow);
  useEffect(() => {
    if (timeLeft !== 0 || !session) return;
    void api.flagsView(session.id).then((s) => {
      latestSession.current = s;
      if (s.state === "completed") navigate(`/flags/results/${s.id}`, { replace: true });
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft === 0]);
  const autoContinue = Boolean(prefs.autoContinue && current && current.outcome === "correct" && session?.state === "active");
  useEffect(() => {
    if (!autoContinue) return;
    const timer = window.setTimeout(() => void next(), autoContinueMs(prefs.autoContinueSpeed));
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoContinue, current?.id]);
  const choices = current?.choices ?? session?.choices ?? [];
  const latestWrongChoice = choices.find(
    (choice) => choice.id === current?.wrongChoiceIds[current.wrongChoiceIds.length - 1],
  );
  const outcomesById = new Map((session?.entries ?? []).map((entry) => [entry.id, entry]));
  const outcomesByChoicePosition = new Map((session?.entries ?? []).map((entry) => [entry.choicePosition, entry]));
  const getChoiceOutcome = (choice: FlagsChoice) =>
    roundOutcomes[choice.id] ??
    (choice.choicePosition != null ? roundOutcomes[`position:${choice.choicePosition}`] : undefined) ??
    outcomesById.get(choice.id) ??
    outcomesByChoicePosition.get(choice.choicePosition);
  const assetUnavailable = unavailableAssets.length > 0;
  const feedbackClass =
    current?.outcome === "correct"
      ? `success attempt-${current.attempts}`
      : current?.outcome === "incorrect"
        ? "failure unsolved"
        : current?.outcome === "skipped" || current?.attempts
          ? "failure"
          : "";
  const displayFeedback =
    session?.direction === "flag_to_country" &&
    (current?.outcome === "incorrect" || current?.outcome === "skipped") &&
    current.name
      ? `${feedback} Correct country: ${current.name}.`
      : feedback;
  const markAsset = (entryId: string, missing: boolean) =>
    setUnavailableAssets((items) =>
      missing ? (items.includes(entryId) ? items : [...items, entryId]) : items.filter((value) => value !== entryId),
    );
  async function act(fn: () => Promise<FlagsSession>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const s = await fn();
      latestSession.current = s;
      if (s.state === "completed") {
        cue("complete");
        navigate(`/flags/results/${s.id}`);
        return;
      }
      setSession(s);
      const resolved: Record<string, Pick<FlagsEntry, "outcome" | "attempts">> = {};
      for (const entry of s.entries)
        if (entry.outcome !== "pending") {
          const result = { outcome: entry.outcome, attempts: entry.attempts };
          resolved[entry.id] = result;
          if (entry.choicePosition != null) resolved[`position:${entry.choicePosition}`] = result;
        }
      if (s.current && s.current.outcome !== "pending") {
        const result = { outcome: s.current.outcome, attempts: s.current.attempts };
        resolved[s.current.id] = result;
        if (s.current.choicePosition != null) resolved[`position:${s.current.choicePosition}`] = result;
      }
      if (Object.keys(resolved).length) setRoundOutcomes((previous) => ({ ...previous, ...resolved }));
      if (s.actionResult) {
        const a = s.actionResult;
        if (a.outcome === "correct") cue("correct");
        else if (a.outcome !== "ambiguous" && a.outcome !== "duplicate_choice") cue("wrong");
        setFeedback(
          a.outcome === "wrong_choice"
            ? `Incorrect. ${a.remainingAttempts} ${a.remainingAttempts === 1 ? "attempt" : "attempts"} remaining.`
            : a.outcome === "duplicate_choice"
              ? "That flag was already selected. Choose another flag."
              : a.outcome === "ambiguous"
                ? "That name fits more than one place – please be more specific."
                : a.outcome === "not_solved"
                  ? "Not solved · 0 points. The correct flag is highlighted."
                  : a.outcome === "correct"
                    ? `Correct · ${current?.attempts === 0 ? "first" : current?.attempts === 1 ? "second" : "third"} try · ${s.current?.points ?? 0} points.`
                    : "Incorrect · 0 points. The answer is shown.",
        );
        if (a.outcome === "wrong_choice" || a.outcome === "duplicate_choice")
          setTimeout(() => gridRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(), 30);
        else if (a.outcome === "ambiguous") setTimeout(() => answerRef.current?.focus(), 30);
        else focusNext();
      } else if (s.current?.outcome === "skipped") {
        setFeedback("Skipped · 0 points. The correct answer is shown.");
        focusNext();
      }
    } catch (e) {
      setError((e as Error).message);
      void load();
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  function choose(choiceId: string) {
    if (!session || !current || current.outcome !== "pending" || busy) return;
    if (isIOS) haptic("tap");
    void act(() => api.flagsAnswer(session.id, current.id, choiceId, null, requestId()));
  }
  function onGridKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const buttons = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>("button.flags-option") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    // Cells in the first row share its top edge: that is the column count of the wrapped grid.
    const columns = buttons.filter((button) => button.offsetTop === buttons[0].offsetTop).length || 1;
    const target = gridStep(i, e.key, buttons.length, columns, (index) => !buttons[index].disabled);
    const button = buttons[target];
    const choiceIndex = choices.findIndex((choice) => choice.id === button?.dataset.choiceId);
    if (choiceIndex >= 0) setFocusedChoice(choiceIndex);
    button?.focus();
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!answer.trim()) {
      setFeedback("Enter a country name or code first.");
      return;
    }
    if (!session || !current) return;
    if (isIOS) haptic("tap");
    void act(() => api.flagsAnswer(session.id, current.id, null, answer, requestId()));
  }
  if (error && !session)
    return (
      <div className="flags-shell">
        <ErrorBox message={error} retry={load} />
        <Link className="secondary" to="/flags">
          Back to Flags
        </Link>
      </div>
    );
  if (!session) return <Loading />;
  if (session.state === "abandoned")
    return (
      <div className="flags-shell">
        <div className="card">
          <h1>This round was abandoned</h1>
          <p>Abandoned rounds do not count toward personal bests.</p>
          <Link to="/flags" className="primary">
            Back to Flags
          </Link>
        </div>
      </div>
    );
  const finalized = Boolean(current && current.outcome !== "pending");
  const canFocusChoice = (choice: FlagsChoice) =>
    Boolean(
      current &&
      !finalized &&
      !assetUnavailable &&
      !current.wrongChoiceIds.includes(choice.id) &&
      getChoiceOutcome(choice)?.outcome !== "correct" &&
      getChoiceOutcome(choice)?.outcome !== "incorrect",
    );
  const tabChoiceIndex =
    choices[focusedChoice] && canFocusChoice(choices[focusedChoice])
      ? focusedChoice
      : choices.findIndex(canFocusChoice);
  async function next() {
    if (!session || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const s = await api.flagsNext(session.id, requestId());
      latestSession.current = s;
      if (s.state === "completed") {
        cue("complete");
        navigate(`/flags/results/${session.id}`);
      } else setSession(s);
    } catch (e) {
      setError((e as Error).message);
      void load();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const smallGrid = session.direction === "country_to_flag" && choices.length <= 9;
  const numberKeysActive = prefs.numberKeys && smallGrid;
  gameKeys.current = (event) => {
    if (finalized && isContinueKey(event, prefs.continueKeys)) {
      // Enter/Space on another control keeps its own meaning (the Next button handles itself).
      if ((event.target as HTMLElement).closest("a,button,summary")) return;
      event.preventDefault();
      if (!busy && !event.repeat) void next();
      return;
    }
    if (!numberKeysActive || finalized || busy || event.repeat || !current) return;
    const choice = choices[numberKeyIndex(event, choices.length)];
    if (choice && canFocusChoice(choice)) {
      event.preventDefault();
      choose(choice.id);
    }
  };
  function abandonNow() {
    if (!session) return;
    return act(async () => {
      const s = await api.flagsAbandon(session.id, requestId());
      setConfirmAbandon(false);
      navigate("/flags");
      return s;
    });
  }
  async function saveAndLeave() {
    if (!session) return;
    if (session.timeLimitSeconds) return navigate("/flags");
    setBusy(true);
    setError("");
    try {
      const paused = await api.flagsPause(session.id, requestId());
      latestSession.current = paused;
      setSession(paused);
      navigate("/flags");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flags-shell">
      <div className="flags-mobile-status">
        <span>
          <strong>
            {session.answered}/{session.total}
          </strong>
          <small>{session.score} points</small>
        </span>
        {timeLeft !== null && <TimeLeft ms={timeLeft} />}
        {finalized && (
          <button
            ref={mobileNextRef}
            className="primary flags-next flags-mobile-next"
            disabled={busy}
            onClick={() => void next()}
          >
            {session.answered === session.total ? "View results" : "Next flag"}
          </button>
        )}
      </div>
      <header className="flags-game-heading">
        <div>
          <p className="eyebrow">
            {directionName(session.direction)} · {regionLabel(session.region)}
          </p>
          <h1 tabIndex={-1} ref={headingRef}>
            {session.current?.position ?? session.answered + 1} <span>of {session.total}</span>
          </h1>
          <div className="round-meta">
            {timeLeft !== null && <TimeLeft ms={timeLeft} />}
            <RoundTags scope={session.scope} pool={session.poolTier} picks={session.selectedCount} sample={session.sampleSize} limit={session.timeLimitSeconds} />
            <StreakBadge streak={streak} />
          </div>
        </div>
        <div className="flags-game-actions">
          <button className="flags-abandon" type="button" disabled={busy} onClick={() => (prefs.confirmGiveUp ? setConfirmAbandon(true) : void abandonNow())}>
            Abandon round
          </button>
          <button className="secondary" disabled={busy} onClick={() => void saveAndLeave()}>
            {busy ? "Saving…" : session.timeLimitSeconds ? "Leave (clock keeps running)" : "Save and leave"}
          </button>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="flags-play-layout">
        <section className="card flags-question">
          {current && session.direction === "country_to_flag" ? (
            <>
              <p className="eyebrow">FIND THIS COUNTRY’S FLAG</p>
              <div className="flags-target-row">
                <h2 className="flags-target-name">{current.name}</h2>
                {latestWrongChoice?.name && (
                  <span className="flags-wrong-name" role="status">
                    {latestWrongChoice.name}
                  </span>
                )}
              </div>
              <div
                className="flags-option-grid"
                ref={gridRef}
                onKeyDown={onGridKey}
                role="group"
                aria-label="Flag options"
              >
                {choices.map((c, i) => {
                  const wasWrong = current.wrongChoiceIds.includes(c.id);
                  const outcome = getChoiceOutcome(c);
                  const isCorrect = outcome?.outcome === "correct";
                  const notGuessed = outcome?.outcome === "incorrect";
                  const resultClass = isCorrect ? `right attempt-${outcome.attempts}` : notGuessed ? "unresolved" : "";
                  const resultLabel = isCorrect
                    ? `, correct on attempt ${outcome.attempts}`
                    : notGuessed
                      ? ", not guessed"
                      : "";
                  return (
                    <button
                      key={c.id}
                      data-choice-id={c.id}
                      type="button"
                      tabIndex={i === tabChoiceIndex ? 0 : -1}
                      className={`flags-option ${wasWrong ? "wrong" : ""} ${resultClass}`}
                      aria-label={`Flag option ${i + 1}${wasWrong ? ", incorrect selection" : ""}${wasWrong && c.name ? `, ${c.name}` : ""}${resultLabel}`}
                      aria-describedby={c.flagDescription ? `flags-desc-${c.id}` : undefined}
                      aria-pressed={isCorrect}
                      disabled={busy || finalized || wasWrong || isCorrect || assetUnavailable}
                      onClick={() => choose(c.id)}
                    >
                      <FlagImage
                        value={c}
                        label={`Flag option ${i + 1}`}
                        className="small"
                        onUnavailable={(missing) => markAsset(c.id, missing)}
                      />
                      {isCorrect && (
                        <span className="flags-option-correct-mark" aria-hidden="true">
                          <svg viewBox="0 0 20 20" focusable="false">
                            <path d="m4 10.5 4 4L16 6.5" />
                          </svg>
                        </span>
                      )}
                      {numberKeysActive && (
                        <span className="flags-option-key" aria-hidden="true">
                          {i + 1}
                        </span>
                      )}
                      <span className="sr-only">Flag option {i + 1}</span>
                      {c.flagDescription && (
                        <span className="sr-only" id={`flags-desc-${c.id}`}>
                          {c.flagDescription}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="sr-only">
                Flag options are numbered so they don't give away the answer. A description of each flag is read out when
                one is available.
              </p>
              {prefs.keyboardHints && !finalized && (
                <p className="keyboard-hint muted text-sm mt-3">
                  {numberKeysActive ? (
                    <>
                      <span className="keycap">1</span>–<span className="keycap">{choices.length}</span> pick a flag ·
                    </>
                  ) : null}{" "}
                  Arrow keys move between flags, Enter picks one
                </p>
              )}
            </>
          ) : current ? (
            <div className="flags-identify-layout">
              <div className="flags-identify-header">
                <span className="flags-mode-pill">FLAG IDENTIFICATION</span>
                <span className="flags-question-count">
                  Question {current.position} <i aria-hidden="true">/</i> {session.total}
                </span>
              </div>
              <FlagImage
                value={current}
                label={current.flagDescription || "Country flag image"}
                className="large"
                onUnavailable={(missing) => markAsset(current.id, missing)}
              />
              {!current.flagDescription && (
                <p className="flags-access-note flags-identify-access-note">
                  This catalog flag has no text description.
                </p>
              )}
              <div className="flags-identify-copy">
                <h2>Which country or territory does this flag represent?</h2>
                <p>Search by name or ISO alpha-2 code, or browse the catalog list.</p>
              </div>
              <form className="flags-answer-form" onSubmit={submit}>
                <label htmlFor="flags-answer">Your answer</label>
                <CountryAnswerCombobox
                  key={current.id}
                  options={session.answerOptions ?? []}
                  value={answer}
                  onChange={setAnswer}
                  disabled={busy || finalized || assetUnavailable}
                  inputRef={answerRef}
                />
                <div className="flags-inline-actions">
                  <button className="primary" disabled={busy || finalized || assetUnavailable}>
                    {busy ? "Checking…" : "Check country"}
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy || finalized || assetUnavailable}
                    onClick={() => void act(() => api.flagsSkip(session.id, current.id, requestId()))}
                  >
                    Skip this flag
                  </button>
                </div>
              </form>
              {assetUnavailable && (
                <p className="flags-empty" role="alert">
                  A required flag image did not load. Retry the image before answering or moving on.
                </p>
              )}
              {!session.region && current.hintUsed && current.region && (
                <p className="flags-hint-note" role="status">
                  Region hint: <strong>{current.region}</strong>
                </p>
              )}
              {!session.region && !current.hintUsed && (
                <button
                  type="button"
                  className="flags-hint-link"
                  disabled={busy || finalized || assetUnavailable}
                  onClick={() => void act(() => api.flagsHint(session.id, current.id, requestId()))}
                >
                  Show region hint <small>This permanently lowers this flag’s maximum score from 100 to 60.</small>
                </button>
              )}
            </div>
          ) : (
            <Loading />
          )}
          {assetUnavailable && session.direction === "country_to_flag" && (
            <p className="flags-empty" role="alert">
              A required flag image did not load. Retry the image before selecting an answer.
            </p>
          )}
          {finalized && (
            <ContinueHint
              className="flags-continue-hint mt-4"
              action={session.answered === session.total ? "to see your results" : "for the next flag"}
            />
          )}
          {displayFeedback && (
            <p className={`flags-feedback flags-mobile-feedback ${feedbackClass}`} role="status" aria-live="polite">
              {displayFeedback}
            </p>
          )}
        </section>
        <StatsPanel
          session={session}
          feedback={displayFeedback}
          feedbackClass={feedbackClass}
          busy={busy}
          onNext={() => void next()}
          nextRef={nextRef}
          timeLeft={timeLeft}
        />
      </div>
      {confirmAbandon && (
        <ConfirmDialog
          id="flags-abandon"
          title="Abandon this round?"
          cancelLabel="Keep playing"
          confirmLabel="Abandon round"
          busy={busy}
          onCancel={() => setConfirmAbandon(false)}
          onConfirm={() => void abandonNow()}
        >
          This ends the round permanently. It will not count toward personal bests.
        </ConfirmDialog>
      )}
    </div>
  );
}
function Results() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [replaying, setReplaying] = useState(false);
  const { data, error, reload } = useLoad(() => api.flagsResults(id));
  if (error)
    return (
      <div className="flags-shell">
        <ErrorBox message={error} retry={reload} />
      </div>
    );
  if (!data) return <Loading />;
  const accuracy = data.total ? Math.round((data.correct / data.total) * 100) : 0;
  const percent = (value: number) => (data.total ? Math.round((value / data.total) * 100) : 0);
  const scorePercent = data.maxScore ? Math.round((data.score / data.maxScore) * 100) : 0;
  const first = data.entries.filter((e) => e.outcome === "correct" && e.attempts === 1).length;
  const second = data.entries.filter((e) => e.outcome === "correct" && e.attempts === 2).length;
  const third = data.entries.filter((e) => e.outcome === "correct" && e.attempts === 3).length;
  const reviewEntries = [...data.entries].sort((a, b) => b.points - a.points || a.position - b.position);
  return (
    <div className="flags-shell flags-results">
      <header className="flags-heading">
        <p className="eyebrow">ROUND COMPLETE · {directionName(data.direction)} · {regionLabel(data.region)}</p>
        <h1 tabIndex={-1}>Your results</h1>
        <p className={`result-badge is-${data.finalBadge ?? "done"}`}>{badgeText(data.finalBadge, endedOnTime(data))}</p>
        <RoundTags scope={data.scope} pool={data.poolTier} picks={data.selectedCount} sample={data.sampleSize} limit={data.timeLimitSeconds} />
      </header>
      <div className="flags-result-grid">
        <section className="card flags-result-score">
          <div className="flags-result-score-heading">
            <span>Final score</span>
            <strong>
              {data.score}
              <small> / {data.maxScore}</small>
            </strong>
            <b>{scorePercent}% of maximum score</b>
          </div>
          <div className="flags-result-breakdown" aria-label="Round results">
            <div>
              <span>Correct</span>
              <strong>
                {data.correct}
                <small> / {data.total}</small>
              </strong>
              <b>{percent(data.correct)}%</b>
            </div>
            <div>
              <span>Incorrect</span>
              <strong>
                {data.incorrect}
                <small> / {data.total}</small>
              </strong>
              <b>{percent(data.incorrect)}%</b>
            </div>
            <div>
              <span>Skipped</span>
              <strong>
                {data.skipped}
                <small> / {data.total}</small>
              </strong>
              <b>{percent(data.skipped)}%</b>
            </div>
            <div>
              <span>Accuracy</span>
              <strong>{accuracy}%</strong>
              <b>
                {data.correct} of {data.total} flags
              </b>
            </div>
          </div>
          <p className="flags-result-calculation">
            Percentages use all flags in the round. Accuracy is correct / total; incorrect and skipped flags are not
            correct.
          </p>
          <p>
            Elapsed time: {formatTime(data.elapsedMs ?? 0)}
            {data.timeLimitSeconds ? ` of ${data.timeLimitSeconds / 60}:00` : ""}. This is server time from the start of the round,
            including feedback screens{data.timeLimitSeconds ? "" : " and time spent away"}. There is no speed bonus.
          </p>
          {data.direction === "country_to_flag" && (
            <p>
              Correct answer attempts: {first} first try · {second} second try · {third} third try.
            </p>
          )}
          {data.direction === "flag_to_country" && <p>Region hints used: {data.hintsUsed}.</p>}
          <p>Flags scores are separate from competitive XP.</p>
        </section>
        <section className="card">
          <h2>{data.ranked === false ? "Practice round" : "Top five for this setup"}</h2>
          {data.ranked === false ? (
            <p>Random picks don't count for personal bests. Play the whole set to rank this setup.</p>
          ) : data.topFive.length ? (
            <ol className="flags-top-five">
              {data.topFive.map((r, i) => (
                <li key={r.id}>
                  <b>#{i + 1}</b>
                  <span>{r.score} points</span>
                  <span>{formatTime(r.elapsedMs)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p>No completed runs yet.</p>
          )}
        </section>
      </div>
      <section className="card flags-review">
        <header>
          <div>
            <h2>Question review</h2>
            <p>Sorted by points earned, highest first. Ties follow round order.</p>
          </div>
          <span>{data.total} flags</span>
        </header>
        <ol>
          {reviewEntries.map((e) => (
            <li key={e.id}>
              <span className="flags-review-position">Q{e.position}</span>
              <FlagImage value={e} label={e.flagDescription || "Flag"} className="review" />
              <div>
                <strong>{e.name || "Catalog entry"}</strong>
                <p>
                  {e.outcome === "correct"
                    ? `Correct · ${e.attempts === 1 ? "first" : e.attempts === 2 ? "second" : "third"} try`
                    : e.outcome === "skipped"
                      ? "Skipped"
                      : `Not solved · ${e.attempts} attempts`}{" "}
                  · {e.points} points
                </p>
                {e.hintUsed && <small>Region hint used · 60 point maximum</small>}
              </div>
            </li>
          ))}
        </ol>
      </section>
      <div className="flags-result-actions">
        <button
          className="primary"
          disabled={replaying}
          onClick={async () => {
            setReplaying(true);
            const choice = choiceOf(data);
            try {
              const next = await api.flagsStart(data.direction, data.region, data.poolTier, requestId(), roundOptions(choice));
              navigate(`/flags/session/${next.id}`);
            } catch {
              navigate(setupUrl("flags", choice));
            }
          }}
        >
          {replaying ? "Preparing…" : "Play again"}
        </button>
        <Link className="secondary" to={setupUrl("flags", choiceOf(data))}>
          Change settings
        </Link>
      </div>
    </div>
  );
}
function formatTime(ms: number) {
  const sec = Math.floor(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
export default function Flags() {
  return (
    <Routes>
      <Route index element={<Setup />} />
      <Route path="session/:id" element={<Game />} />
      <Route path="results/:id" element={<Results />} />
    </Routes>
  );
}
