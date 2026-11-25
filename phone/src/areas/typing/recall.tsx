// Phone Recall (/recall/*): set → type names from memory (EN/DE/FR) → found list fills itself → results → bests.
// Answers only exist in the browser as salted hashes while a round is active; typed text is normalized with the
// shared normalizeRecall() (byte-equivalent with private.recall_normalize) and the server re-checks every answer.
import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "@shared/api";
import { useLoad } from "@shared/components";
import { GameChoice, PersonalBest, SetupPlace, formatClock, initialChoice, setupUrl } from "@shared/game-setup";
import { CALM_ROUND_MS, useLeaveGuard, usePrefs } from "@shared/prefs";
import {
  RecallAnswerResult,
  RecallChoice,
  RecallEntry,
  RecallKind,
  RecallLang,
  RecallScope,
  RecallSession,
  RecallSetup,
  buildRecallIndex,
  classifyRecall,
  langLabel,
  normalizeRecall,
  recallHash,
  recallPercent,
} from "@shared/recall-domain";
import { TopBarActions, usePhoneChrome } from "@phone/shell/chrome";
import { paths } from "@phone/shell/paths";
import { useBackGuard } from "@phone/ui/useBackGuard";
import {
  ActionBar,
  Card,
  ComboToast,
  GameButton,
  LinkButton,
  LoadingState,
  ModeHero,
  ProgressBar,
  ResultHero,
  RetryMissedCard,
  Section,
  StatusMessage,
  TimerBar,
  feel,
  useReplayKey,
  useToast,
} from "@phone/ui";
import { ConfirmSheet, Flag, RoundClock, Tabs, errorText, requestId, useRoundClock } from "./common";
import { PhoneGameSetup } from "./setup";
import "./typing.css";

/** How long a match that is also the start of another missing name (Niger → Nigeria) waits before it counts. */
export const PREFIX_WAIT_MS = 900;
/** Finds closer together than this build a fast-find streak (3, 5, 10, … get the rising streak feedback). */
export const FAST_STREAK_MS = 5000;
/** Timed rounds: the timer turns to its warning state for the last 30 seconds. */
const TIMER_WARN_MS = 30_000;

const KNOWN_ERRORS: Record<string, string> = {
  EMPTY_RECALL_POOL: "There is nothing to recall in that set. Choose another region.",
  RECALL_SET_TOO_SMALL: "That set is smaller than the number you picked. Choose the whole set or a smaller number.",
  TOO_MANY_ACTIVE_RECALL_ROUNDS: "You have 10 unfinished rounds. Resume or discard one first.",
  RECALL_SESSION_NOT_FOUND: "That round could not be found.",
};
const friendly = (cause: unknown) => errorText(cause, KNOWN_ERRORS);

const noun = (kind: RecallKind, count = 2) =>
  kind === "countries" ? (count === 1 ? "country" : "countries") : count === 1 ? "capital" : "capitals";

export function setTitle(kind: RecallKind, scope: RecallScope, region: string | null) {
  const what = kind === "countries" ? "Countries" : "Capitals";
  if (region) return `${what} of ${region}`;
  return scope === "un" ? `${what} of the UN member states` : `${what} of every country & territory`;
}

function roundTags(round: Pick<RecallSession, "pool" | "selectedCount" | "size" | "timeLimitSeconds">) {
  return [
    round.pool === "easy" ? "Well-known" : round.pool === "manual" ? `${round.selectedCount ?? 0} picked` : null,
    round.size ? `Practice · ${round.size} random` : null,
    round.timeLimitSeconds ? `${round.timeLimitSeconds / 60} min limit` : null,
  ].filter((tag): tag is string => Boolean(tag));
}

/** Board slot: found entries are solid; the one just found pops in. */
const slotClass = (found: boolean, fresh: boolean) =>
  [found && "is-found", found && fresh && "is-new"].filter(Boolean).join(" ") || undefined;

function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <p className="ph-typing-tags">
      {tags.map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
    </p>
  );
}

function LangTag({ lang }: { lang: RecallLang | null }) {
  if (!lang || lang === "en") return null;
  return (
    <span className="ph-typing-lang" aria-label={`accepted in ${langLabel[lang]}`}>
      {lang.toUpperCase()}
    </span>
  );
}

const recallChoice = (choice: GameChoice): RecallChoice => ({
  kind: choice.mode as RecallKind,
  scope: choice.scope,
  region: choice.region,
  size: choice.size,
  timeLimitSeconds: choice.limit,
  pool: choice.pool,
  picks: choice.pool === "manual" ? choice.picks : [],
});

/* ------------------------------------------------------------------------ */
/* Setup                                                                     */
/* ------------------------------------------------------------------------ */

function Setup() {
  usePhoneChrome({ title: "Recall", back: paths.games });
  const { data, error, reload } = useLoad<RecallSetup>(() => api.recallSetup());
  const bests = useLoad<PersonalBest[]>(() => api.personalBests());
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initial = useMemo(() => initialChoice("recall", params, ["countries", "capitals"], { scope: "un" }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const prefs = usePrefs();
  const toast = useToast();
  const [discardId, setDiscardId] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);

  if (!data) return error ? <StatusMessage tone="error" retry={reload}>{friendly(error)}</StatusMessage> : <LoadingState />;
  const catalog = data.catalog;
  const places: SetupPlace[] = catalog.map((item) => ({
    code: item.code,
    name: item.name ?? item.code,
    region: item.region,
    un: item.un,
    easy: item.easy ?? false,
    alpha2: item.alpha2 ?? null,
    modes: item.hasCapital ? ["countries", "capitals"] : ["countries"],
  }));
  const regions = [...new Set(catalog.map((item) => item.region).filter((value): value is string => Boolean(value)))]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ id: name, name }));
  const recalledIn = (which: RecallKind) => {
    const codes = new Set(data.recalled[which]);
    const pool = catalog.filter((item) => item.un && (which === "countries" || item.hasCapital));
    return { done: pool.filter((item) => codes.has(item.code)).length, of: pool.length };
  };

  async function discard(id: string) {
    setDiscarding(true);
    try {
      await api.recallAbandon(id);
      toast.show("Round discarded");
      reload();
    } catch (cause) {
      toast.show(friendly(cause), { tone: "error" });
    } finally {
      setDiscarding(false);
      setDiscardId(null);
    }
  }

  return (
    <>
      <PhoneGameSetup
        game="recall"
        hero={
          <ModeHero
            title="Name them all"
            subtitle="A fast memory drill: type, watch your list fill up, beat your time."
            icon="recall"
            tone="recall"
          />
        }
        intro="Pick a set, then type every place in it from memory – in English, German or French. Each correct answer drops into your list the moment you finish typing it."
        modes={(["countries", "capitals"] as const).map((value) => {
          const progress = recalledIn(value);
          return {
            value,
            icon: value === "countries" ? "globe" : "capital",
            title: value === "countries" ? "Countries" : "Capitals",
            text: value === "countries" ? "Every name in the set, no clues." : "The country is shown – name its capital.",
            fixedSet:
              value === "countries"
                ? "Countries rounds always cover the whole set. Choose a region to make it smaller."
                : undefined,
            footer: `${progress.done} of ${progress.of} UN members recalled at least once`,
          };
        })}
        places={places}
        regions={regions}
        unit={(count, choice) => noun(choice.mode as RecallKind, count)}
        initial={initial}
        startLabel="Start"
        bests={bests.error ? null : bests.data ?? []}
        resume={data.activeSessions.map((item) => ({
          id: item.id,
          title: setTitle(item.kind, item.scope, item.region),
          detail:
            `${item.found}/${item.total} found` +
            (item.pool === "easy" ? " · Well-known" : item.pool === "manual" ? ` · ${item.selectedCount ?? 0} picked` : "") +
            (item.size ? ` · ${item.size} random` : "") +
            (item.deadlineAt ? " · timed" : ""),
          to: `${paths.recall}/play/${item.id}`,
          onDiscard: () => (prefs.confirmGiveUp ? setDiscardId(item.id) : void discard(item.id)),
        }))}
        onStart={async (choice) => {
          try {
            const session = await api.recallStart(recallChoice(choice), requestId());
            navigate(`${paths.recall}/play/${session.id}`);
          } catch (cause) {
            throw new Error(friendly(cause));
          }
        }}
      />
      <ConfirmSheet
        open={discardId !== null}
        title="Discard this round?"
        confirmLabel="Discard"
        cancelLabel="Keep it"
        danger
        busy={discarding}
        onConfirm={() => discardId && void discard(discardId)}
        onCancel={() => setDiscardId(null)}
      >
        <p>The unfinished round and everything you found in it will be removed. This can't be undone.</p>
      </ConfirmSheet>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Play                                                                      */
/* ------------------------------------------------------------------------ */

type FoundInfo = Pick<RecallEntry, "name" | "alpha2" | "matched" | "lang">;
type Feed = { position: number; text: string; name: string | null; lang: RecallLang | null; at: number };
type Feedback = { tone: "ok" | "info" | "warn" | "bad"; text: string } | null;

const IDLE_HINT = "English, German or French – accepted as you type. Accents and hyphens don't matter.";

function Play() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: initial, error, reload } = useLoad<RecallSession>(() => api.recallView(id), id);
  const [session, setSession] = useState<RecallSession>();
  const [found, setFound] = useState<Map<number, FoundInfo>>(new Map());
  const [feed, setFeed] = useState<Feed[]>([]);
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [shaking, setShaking] = useState(false);
  const [askGiveUp, setAskGiveUp] = useState(false);
  const [askLeave, setAskLeave] = useState(false);
  const [finishing, setFinishing] = useState(false);
  /** The entry that was just found: it pops into the list. */
  const [newest, setNewest] = useState<number | null>(null);
  /** Fast-find streak (finds less than FAST_STREAK_MS apart). */
  const [fastStreak, setFastStreak] = useState(0);
  const prefs = usePrefs();
  const inputRef = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const waitTimer = useRef<number>();
  const pending = useRef<{ position: number; lang: RecallLang; text: string } | null>(null);
  /** Positions accepted on this device, so a fast second Enter never sends the same answer twice. */
  const accepted = useRef(new Set<number>());
  /** The last accepted answer: a second Go for the same text right after it is ignored, not "already found". */
  const lastAccepted = useRef<{ position: number; at: number } | null>(null);
  const finished = useRef(false);
  const lastFind = useRef(0);
  const streakRef = useRef(0);
  /** Normalized text that last got the "not this" feedback, so a duplicate buzzes once, not on every keystroke. */
  const lastRejected = useRef("");

  const title = session ? setTitle(session.kind, session.scope, session.region) : "Recall";
  const running = session?.state === "active";
  // While the round runs, leaving goes through "Leave" (top bar) or the device Back button, which asks first.
  usePhoneChrome({ title, back: running ? undefined : paths.recall, hideTabBar: true });
  useLeaveGuard(running);
  const { release, releasing } = useBackGuard(running && !finishing, () => {
    if (!askGiveUp) setAskLeave(true);
  });

  useEffect(() => {
    if (!initial) return;
    if (initial.state !== "active") {
      navigate(`${paths.recall}/results/${initial.id}`, { replace: true });
      return;
    }
    setSession(initial);
    const hits = initial.entries.filter((entry) => entry.found);
    accepted.current = new Set(hits.map((entry) => entry.position));
    setFound(new Map(hits.map((entry) => [entry.position, entry])));
    setFeed(
      hits
        .filter((entry) => entry.foundAt)
        .sort((a, b) => Date.parse(b.foundAt!) - Date.parse(a.foundAt!))
        .slice(0, 6)
        .map((entry) => ({
          position: entry.position,
          text: entry.matched ?? "",
          name: entry.name,
          lang: entry.lang,
          at: Date.parse(entry.foundAt!),
        })),
    );
  }, [initial, navigate]);

  const index = useMemo(() => buildRecallIndex(session?.entries ?? []), [session?.entries]);
  const ambiguous = useMemo(() => new Set(session?.ambiguous ?? []), [session?.ambiguous]);
  const { elapsed, remaining } = useRoundClock(session, session?.state === "active" && !finishing);
  const timeUp = remaining !== null && remaining <= 0;
  const bump = useReplayKey(found.size);

  useEffect(() => {
    if (session && timeUp) void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp, session?.id]);
  useEffect(() => () => window.clearTimeout(waitTimer.current), []);

  if (!session) {
    return error ? <StatusMessage tone="error" retry={reload}>{friendly(error)}</StatusMessage> : <LoadingState />;
  }
  const active = session;

  async function finish() {
    if (finished.current) return;
    finished.current = true;
    setFinishing(true);
    try {
      await api.recallFinish(active.id);
    } catch {
      /* the results view finalizes expired rounds too */
    }
    release(() => navigate(`${paths.recall}/results/${active.id}`, { replace: true }));
  }

  function completeRound() {
    if (finished.current) return;
    finished.current = true;
    setFinishing(true);
    // No feedback here: the results screen (ResultHero) plays the round's one finishing feedback.
    window.setTimeout(() => release(() => navigate(`${paths.recall}/results/${active.id}`, { replace: true })), 900);
  }

  function rollback(position: number, message: string) {
    accepted.current.delete(position);
    setFound((current) => {
      const next = new Map(current);
      next.delete(position);
      return next;
    });
    setFeed((current) => current.filter((item) => item.position !== position));
    setNewest((current) => (current === position ? null : current));
    lastFind.current = 0;
    streakRef.current = 0;
    setFastStreak(0);
    setFeedback({ tone: "bad", text: message });
    feel("error");
  }

  /** Soft "not this" feedback: light buzz without sound and a shake. Typing is never blocked. */
  function reject(key: string, commit: boolean) {
    if (!commit && lastRejected.current === key) return;
    lastRejected.current = key;
    feel("error", { sound: false });
    setShaking(true);
  }

  function accept(position: number, lang: RecallLang, typed: string) {
    window.clearTimeout(waitTimer.current);
    pending.current = null;
    if (accepted.current.has(position)) return;
    accepted.current.add(position);
    lastAccepted.current = { position, at: Date.now() };
    const entry = active.entries.find((item) => item.position === position);
    setFound((current) => new Map(current).set(position, { name: null, alpha2: entry?.alpha2 ?? null, matched: typed, lang }));
    setFeed((current) => [{ position, text: typed, name: null, lang, at: Date.now() }, ...current].slice(0, 6));
    setText("");
    const now = Date.now();
    const streak = lastFind.current && now - lastFind.current <= FAST_STREAK_MS ? streakRef.current + 1 : 1;
    lastFind.current = now;
    streakRef.current = streak;
    lastRejected.current = "";
    setFastStreak(streak);
    setNewest(position);
    feel("correct", { n: streak });
    setFeedback({ tone: "ok", text: `✓ ${typed}${lang !== "en" ? ` (${langLabel[lang]})` : ""}` });
    inputRef.current?.focus();
    api
      .recallAnswer(active.id, position, typed)
      .then((result: RecallAnswerResult) => {
        if (result.status === "found" || result.status === "already_found") {
          setFound((current) =>
            new Map(current).set(position, {
              name: result.name,
              alpha2: result.alpha2,
              matched: result.matched ?? typed,
              lang: result.lang ?? lang,
            }),
          );
          setFeed((current) => current.map((item) => (item.position === position ? { ...item, name: result.name } : item)));
          if (result.state === "completed") completeRound();
        } else if (result.status === "time_up" || result.status === "not_active") {
          void finish();
        } else {
          rollback(position, `“${typed}” could not be confirmed. Try another spelling.`);
        }
      })
      .catch((cause: unknown) => rollback(position, friendly(cause)));
  }

  async function evaluate(value: string, commit: boolean) {
    const run = ++sequence.current;
    window.clearTimeout(waitTimer.current);
    const waiting = pending.current;
    pending.current = null;
    const key = normalizeRecall(value);
    if (!key) {
      setFeedback(null);
      return;
    }
    if (!active.salt) return;
    const hash = await recallHash(active.salt, key);
    if (run !== sequence.current) return;
    const match = classifyRecall(hash, index, ambiguous, accepted.current);
    const typed = value.trim();
    if (match.kind === "match") {
      if (!match.wait || commit) {
        accept(match.position, match.lang, typed);
        return;
      }
      pending.current = { position: match.position, lang: match.lang, text: typed };
      setFeedback({ tone: "info", text: `Tap Go to accept “${typed}” – or keep typing.` });
      waitTimer.current = window.setTimeout(() => {
        const next = pending.current;
        if (next && run === sequence.current) accept(next.position, next.lang, next.text);
      }, PREFIX_WAIT_MS);
    } else if (match.kind === "already") {
      const recent = lastAccepted.current;
      if (commit && recent && match.positions.includes(recent.position) && Date.now() - recent.at < 1500) {
        setText("");
        return;
      }
      const name = match.positions.map((position) => found.get(position)?.name).find(Boolean);
      setFeedback({ tone: "warn", text: `Already in your list${name ? `: ${name}` : ""}.` });
      reject(key, commit);
      if (commit) setText("");
    } else if (match.kind === "ambiguous") {
      setFeedback({ tone: "warn", text: "That name fits more than one place – be more specific." });
    } else if (commit) {
      if (waiting) {
        accept(waiting.position, waiting.lang, waiting.text);
        return;
      }
      setFeedback({ tone: "bad", text: `“${typed}” isn't in this set.` });
      reject(key, true);
      inputRef.current?.select();
    } else {
      setFeedback(null);
    }
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    setText(event.target.value);
    void evaluate(event.target.value, false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape" || !text) return;
    // Esc clears the field (hardware keyboards); a second Esc is left to the page.
    event.preventDefault();
    window.clearTimeout(waitTimer.current);
    pending.current = null;
    sequence.current += 1;
    setText("");
    setFeedback(null);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    inputRef.current?.focus();
    if (finishing || !text.trim()) return;
    void evaluate(text, true);
  }

  function giveUp() {
    setAskGiveUp(false);
    void finish();
  }

  /** The round stays saved on the server; its entry becomes the setup screen. */
  function leave() {
    if (finishing) return;
    release(() => navigate(paths.recall, { replace: true }));
  }

  const foundCount = found.size;
  const groups =
    active.kind === "countries"
      ? [...new Set(active.entries.map((entry) => entry.region ?? "Other"))].map((name) => ({
          name,
          entries: active.entries.filter((entry) => (entry.region ?? "Other") === name),
        }))
      : [{ name: "", entries: active.entries }];
  const showGroupTitles = groups.length > 1;

  return (
    <div className="ph-typing-play">
      <TopBarActions>
        <GameButton variant="secondary" size="md" className="ph-typing-topbtn" disabled={finishing || releasing} onClick={leave}>
          Leave
        </GameButton>
        <GameButton
          variant="secondary"
          size="md"
          className="ph-typing-topbtn"
          disabled={finishing || releasing}
          onClick={() => (prefs.confirmGiveUp ? setAskGiveUp(true) : giveUp())}
        >
          Give up
        </GameButton>
      </TopBarActions>

      <Card className="ph-typing-hud tone-recall">
        <div className="ph-typing-hud-row">
          <p className="ph-typing-found" aria-live="off">
            <strong key={bump} className={bump ? "ph-typing-bump" : undefined} data-testid="recall-count">
              {foundCount}
            </strong>
            <span> / {active.total} found</span>
            <span className="ph-typing-pct"> · {recallPercent(foundCount, active.total)}%</span>
          </p>
          {remaining !== null && active.timeLimitSeconds ? (
            <TimerBar
              msLeft={remaining}
              totalMs={active.timeLimitSeconds * 1000}
              warnAtMs={TIMER_WARN_MS}
              calmFromMs={CALM_ROUND_MS}
            />
          ) : (
            <RoundClock remaining={remaining} elapsed={elapsed} />
          )}
        </div>
        <ProgressBar value={foundCount} max={active.total} label="Progress" />
        <ComboToast streak={fastStreak} />
        <Tags tags={roundTags(active)} />
      </Card>

      {feed.length > 0 && (
        <Section title="Just found">
          <ol className="ph-typing-feed">
            {feed.map((item) => (
              <li key={`${item.position}-${item.at}`}>
                <Flag code={found.get(item.position)?.alpha2} />
                <span>
                  {item.name && normalizeRecall(item.name) !== normalizeRecall(item.text) ? (
                    <>
                      {item.text} <span className="ph-muted">→ {item.name}</span>
                    </>
                  ) : (
                    item.name ?? item.text
                  )}
                </span>
                <LangTag lang={item.lang} />
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section title={`Your ${noun(active.kind)}`}>
        <div className="ph-typing-board">
          {groups.map((group) => {
            const groupFound = group.entries.filter((entry) => found.has(entry.position)).length;
            return (
              <Card key={group.name || "all"} as="section" className="ph-typing-group" aria-label={group.name || undefined}>
                {showGroupTitles && (
                  <h3 className="ph-typing-group-title">
                    {group.name}
                    <span>
                      {groupFound}/{group.entries.length}
                    </span>
                  </h3>
                )}
                <ul className={active.kind === "countries" ? "ph-typing-slots" : "ph-typing-capitals"}>
                  {group.entries.map((entry) => {
                    const hit = found.get(entry.position);
                    if (active.kind === "countries") {
                      return (
                        <li key={entry.position} className={slotClass(Boolean(hit), entry.position === newest)}>
                          {hit ? (
                            <>
                              <Flag code={hit.alpha2} />
                              <span>{hit.name ?? hit.matched}</span>
                              <LangTag lang={hit.lang} />
                            </>
                          ) : (
                            <span className="sr-only">Not found yet</span>
                          )}
                        </li>
                      );
                    }
                    return (
                      <li key={entry.position} className={slotClass(Boolean(hit), entry.position === newest)}>
                        <Flag code={entry.alpha2} />
                        <span className="ph-typing-capital-country">{entry.prompt}</span>
                        <span className="ph-typing-capital-answer">
                          {hit ? (
                            <>
                              {hit.name ?? hit.matched}
                              <LangTag lang={hit.lang} />
                            </>
                          ) : (
                            <span aria-label="Not found yet">?</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      </Section>

      <ActionBar label="Your answer">
        <form className="ph-typing-dock" onSubmit={onSubmit} noValidate>
          <p className={`ph-typing-feedback${feedback ? ` is-${feedback.tone}` : ""}`} role="status" aria-live="polite">
            {feedback?.text ?? IDLE_HINT}
          </p>
          <div className="ph-typing-inputrow">
            <label className="sr-only" htmlFor="ph-recall-input">
              Type a {noun(active.kind, 1)}
            </label>
            <input
              id="ph-recall-input"
              ref={inputRef}
              className={`ph-input ph-typing-input${shaking ? " is-shaking" : ""}`}
              onAnimationEnd={() => setShaking(false)}
              value={text}
              onChange={onChange}
              onKeyDown={onKeyDown}
              disabled={finishing}
              placeholder={active.kind === "countries" ? "Type a country…" : "Type a capital…"}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="go"
              inputMode="text"
              maxLength={120}
              autoFocus
            />
            <GameButton
              type="submit"
              variant="primary"
              size="md"
              className="ph-typing-go"
              disabled={finishing}
              // The answer itself gives the feedback (found / not in this set), so Go stays silent.
              haptic={false}
              // Keep the keyboard open: a tap on Go must not move focus out of the input.
              onPointerDown={(event) => event.preventDefault()}
              onMouseDown={(event) => event.preventDefault()}
            >
              Go
            </GameButton>
          </div>
        </form>
      </ActionBar>

      <ConfirmSheet
        open={askGiveUp}
        title="Give up?"
        confirmLabel="Give up"
        cancelLabel="Keep going"
        danger
        busy={finishing}
        onConfirm={giveUp}
        onCancel={() => {
          setAskGiveUp(false);
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <p>Reveal the missing {noun(active.kind)} and end the round?</p>
      </ConfirmSheet>

      <ConfirmSheet
        open={askLeave}
        title="Leave this round?"
        confirmLabel="Save and leave"
        cancelLabel="Keep going"
        busy={releasing}
        onConfirm={leave}
        onCancel={() => {
          setAskLeave(false);
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <p>
          Your found {noun(active.kind)} are saved. Resume the round later from the Recall screen.
          {active.deadlineAt ? " The time limit keeps running while you are away." : ""}
        </p>
      </ConfirmSheet>
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
  usePhoneChrome({ title: "Recall results", back: paths.recall });

  useEffect(() => {
    if (session?.state === "active") navigate(`${paths.recall}/play/${session.id}`, { replace: true });
    if (session && session.found === session.total) setTab("found");
  }, [session, navigate]);

  if (!session || session.state === "active") {
    return error ? <StatusMessage tone="error" retry={reload}>{friendly(error)}</StatusMessage> : <LoadingState />;
  }
  const done = session;
  const missed = done.entries.filter((entry) => !entry.found);
  const hits = done.entries.filter((entry) => entry.found);
  const headline =
    done.endReason === "all_found" ? "Perfect recall!" : done.endReason === "time_up" ? "Time's up!" : "Round complete";
  // Random samples (practice) are never ranked; the server says so with ranked/badge as well.
  const ranked = done.ranked !== false && !done.size && done.badge !== "unranked";
  const note =
    done.badge === "first_run"
      ? "First result for this set"
      : done.badge === "not_best" && done.best
        ? `Your best: ${done.best.found}/${done.best.total} in ${formatClock(done.best.elapsedMs)}`
        : null;
  const list = tab === "missed" ? missed : hits;
  const named = done.kind === "countries" ? "Countries named" : "Capitals named";

  async function again() {
    setBusy(true);
    setMessage("");
    try {
      const next = await api.recallStart(
        {
          kind: done.kind,
          scope: done.scope,
          region: done.region,
          size: done.size,
          timeLimitSeconds: done.timeLimitSeconds,
          pool: done.pool ?? "all",
          picks: done.selectedCodes ?? [],
        },
        requestId(),
      );
      navigate(`${paths.recall}/play/${next.id}`);
    } catch (cause) {
      setMessage(friendly(cause));
      setBusy(false);
    }
  }

  return (
    <div className="ph-stack">
      <ResultHero
        headline={headline}
        tone="recall"
        icon="recall"
        score={done.found}
        scoreLabel={named}
        correct={done.found}
        total={done.total}
        timeMs={done.elapsedMs ?? undefined}
        ranked={ranked}
        newBest={ranked && done.badge === "new_best"}
      >
        <div className="ph-typing-hero-extra">
          <p className="ph-typing-eyebrow">{setTitle(done.kind, done.scope, done.region)}</p>
          {note && <p className="ph-typing-badge">{note}</p>}
          {done.timeLimitSeconds ? <p className="ph-muted">Time limit {done.timeLimitSeconds / 60} min</p> : null}
          <Tags tags={roundTags(done)} />
        </div>
      </ResultHero>

      <RetryMissedCard
        count={missed.length}
        tone="recall"
        title={`${missed.length} ${noun(done.kind, missed.length)} still to learn`}
        text="Read them in the Missed list below, then replay the same set to lock them in."
        cta="Replay this set"
        loading={busy}
        onRetry={() => void again()}
      />

      <StatusMessage tone="error">{message}</StatusMessage>

      <Card as="section" aria-label="Answers">
        <Tabs
          label="Answers"
          idBase="ph-recall-results"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "missed", label: `Missed · ${missed.length}` },
            { id: "found", label: `Found · ${hits.length}` },
          ]}
        />
        <div id="ph-recall-results-panel" role="tabpanel" aria-labelledby={`ph-recall-results-tab-${tab}`}>
          {list.length ? (
            <ul className="ph-typing-result-list">
              {list.map((entry) => (
                <li key={entry.position} className={entry.found ? "is-found" : "is-missed"}>
                  <Flag code={entry.alpha2} />
                  <span className="ph-typing-result-name">
                    <strong>{entry.name}</strong>
                    <small>
                      {done.kind === "capitals" ? entry.prompt : entry.region}
                      {entry.found && entry.matched && normalizeRecall(entry.matched) !== normalizeRecall(entry.name ?? "")
                        ? ` · you typed “${entry.matched}”`
                        : ""}
                    </small>
                  </span>
                  <LangTag lang={entry.lang} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="ph-muted ph-typing-empty">
              {tab === "missed" ? "Nothing missed – every single one!" : "No answers this time."}
            </p>
          )}
        </div>
      </Card>

      <ActionBar>
        <LinkButton
          to={setupUrl("recall", {
            mode: done.kind,
            scope: done.scope,
            region: done.region,
            pool: done.pool ?? "all",
            picks: done.selectedCodes ?? [],
            size: done.size,
            limit: done.timeLimitSeconds,
          })}
        >
          Change settings
        </LinkButton>
        <GameButton variant="primary" loading={busy} onClick={() => void again()}>
          Play again
        </GameButton>
      </ActionBar>
    </div>
  );
}

/** A fresh Play per round id, so "Play again" never keeps the previous round's state. */
function PlayRound() {
  const { id = "" } = useParams();
  return <Play key={id} />;
}

export default function RecallArea() {
  return (
    <Routes>
      <Route index element={<Setup />} />
      <Route path="play/:id" element={<PlayRound />} />
      <Route path="results/:id" element={<Results />} />
    </Routes>
  );
}
