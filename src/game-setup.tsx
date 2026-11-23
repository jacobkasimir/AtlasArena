// One setup screen for Flags, Capitals and Recall: the same five steps, the same
// "your best for this setup" line and the same side cards in every game.
import { Icon } from "./icons";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { loadSetup, oneOf, saveSetup } from "./prefs";
import { Chips, ModePage, OptionCard, OptionCards, ResumeItem, ResumeList, SetupForm, SideCard, StartBar, Step } from "./setup-ui";

export type GameId = "flags" | "capitals" | "recall";
export type SetupScope = "un" | "all";
export type SetupPool = "all" | "easy" | "manual";

export type GameChoice = {
  mode: string;
  scope: SetupScope;
  region: string | null;
  pool: SetupPool;
  picks: string[];
  size: number | null;
  limit: number | null;
};

/** One place the player could be asked about; `modes` lists the modes it can appear in. */
export type SetupPlace = {
  code: string; name: string; region: string | null; un: boolean; easy: boolean; alpha2: string | null; modes: string[];
  /** Modes when only UN member states are in play, if that differs (a capital can be unique only among UN members). */
  unModes?: string[];
};

export type PersonalBest = {
  game: GameId; mode: string; scope: SetupScope; region: string | null; pool: SetupPool; selectedCodes: string[];
  timeLimitSeconds: number | null; total: number; correct: number; score: number; maxScore: number;
  elapsedMs: number; completedAt: string; runCount: number;
};

export type GameStat = { rounds: number; correct: number; answered: number; timeMs: number; lastPlayedAt: string | null; places: number };
export type GameStats = Record<GameId, GameStat>;

export const SIZES = [10, 25, 50] as const;
export const LIMITS = [null, 300, 600, 900, 1200] as const;

export const gameNames: Record<GameId, string> = { flags: "Flags", capitals: "Capitals", recall: "Recall" };
export const modeNames: Record<string, string> = {
  country_to_flag: "Country → Flag", flag_to_country: "Flag → Country",
  country_to_capital: "Country → Capital", capital_to_country: "Capital → Country",
  countries: "Name the countries", capitals: "Name the capitals",
};
export const poolNames: Record<SetupPool, string> = { all: "All", easy: "Well-known", manual: "Your picks" };
export const scopeNames: Record<SetupScope, string> = { un: "UN member states", all: "All countries & territories" };

export const regionLabel = (region: string | null) =>
  !region ? "Whole world" : region === "__unspecified__" ? "Unspecified region" : region;
export const limitLabel = (seconds: number | null) => (seconds ? `${seconds / 60} min` : "No limit");

export function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/** Short description of a setup, e.g. "UN member states · Europe · Well-known · 5 min". */
export function describeSetup(item: { scope: SetupScope; region: string | null; pool: SetupPool; picks?: number; size?: number | null; limit: number | null }) {
  return [
    scopeNames[item.scope],
    regionLabel(item.region),
    item.pool === "manual" ? `${item.picks ?? 0} picked` : item.pool === "easy" ? "Well-known" : null,
    item.size ? `${item.size} random` : null,
    item.limit ? limitLabel(item.limit) : null,
  ].filter(Boolean).join(" · ");
}

const sorted = (codes: string[]) => [...new Set(codes)].sort();

export function filterPlaces(places: SetupPlace[], choice: Pick<GameChoice, "mode" | "scope" | "region" | "pool" | "picks">) {
  const picks = new Set(choice.picks);
  return places.filter((place) =>
    (choice.scope === "un" && place.unModes ? place.unModes : place.modes).includes(choice.mode) &&
    (choice.scope === "all" || place.un) &&
    (!choice.region || place.region === choice.region) &&
    (choice.pool !== "easy" || place.easy) &&
    (choice.pool !== "manual" || picks.has(place.code)));
}

export function matchesBest(best: PersonalBest, game: GameId, choice: GameChoice) {
  return best.game === game && best.mode === choice.mode && best.scope === choice.scope &&
    (best.region ?? null) === (choice.region ?? null) && best.pool === choice.pool &&
    (best.timeLimitSeconds ?? null) === (choice.limit ?? null) &&
    (choice.pool !== "manual" || sorted(best.selectedCodes).join(",") === sorted(choice.picks).join(","));
}

export const bestScore = (best: Pick<PersonalBest, "correct" | "total">) => `${best.correct}/${best.total}`;

/** Read a setup from replay URL parameters, then the remembered setup, then defaults. */
export function initialChoice(game: GameId, params: URLSearchParams, modes: string[], defaults: Partial<GameChoice> = {}): GameChoice {
  const fromUrl = [...params.keys()].length > 0;
  const saved = fromUrl ? {} : loadSetup(game);
  const pick = (key: string, ...legacy: string[]) => {
    for (const name of [key, ...legacy]) if (params.has(name)) return params.get(name);
    return saved[key];
  };
  const picksValue = pick("picks", "selected");
  const picks = typeof picksValue === "string" ? picksValue.split(",").filter(Boolean)
    : Array.isArray(picksValue) ? picksValue.filter((code): code is string => typeof code === "string") : [];
  const number = (value: unknown) => (typeof value === "number" ? value : typeof value === "string" && value ? Number(value) : null);
  const region = pick("region");
  const legacyPool = pick("pool", "difficulty");
  return {
    mode: oneOf(pick("mode", "direction", "kind"), modes, defaults.mode ?? modes[0]),
    scope: oneOf(pick("scope"), ["un", "all"] as const, defaults.scope ?? "all"),
    region: typeof region === "string" && region ? region : null,
    pool: oneOf(legacyPool, ["all", "easy", "manual"] as const, defaults.pool ?? "all"),
    picks,
    size: oneOf(number(pick("size")), [null, ...SIZES], null),
    limit: oneOf(number(pick("limit")), [...LIMITS], null),
  };
}

export function setupUrl(game: GameId, choice: GameChoice) {
  const params = new URLSearchParams({ mode: choice.mode, scope: choice.scope, pool: choice.pool });
  if (choice.region) params.set("region", choice.region);
  if (choice.pool === "manual" && choice.picks.length) params.set("picks", sorted(choice.picks).join(","));
  if (choice.size) params.set("size", String(choice.size));
  if (choice.limit) params.set("limit", String(choice.limit));
  return `/${game}?${params}`;
}

export type GameMode = OptionCard<string> & {
  /** The whole set is the challenge (Recall countries): no well-known filter, picks or random length. */
  fixedSet?: string;
};

export function GameSetup({
  game, eyebrow, title, intro, modes, places, regions, unit, initial, resume, resumeEmpty, bests,
  hint, summaryNote, startLabel = "Start round", onStart, error, children,
}: {
  game: GameId; eyebrow: string; title: string; intro: ReactNode;
  modes: GameMode[]; places: SetupPlace[]; regions: { id: string; name: string }[];
  unit: (count: number, choice: GameChoice) => string; initial: GameChoice;
  resume: ResumeItem[]; resumeEmpty: string; bests: PersonalBest[] | null;
  hint?: (choice: GameChoice) => string | undefined; summaryNote?: string; startLabel?: string;
  onStart: (choice: GameChoice) => Promise<void>; error?: string; children?: ReactNode;
}) {
  const [choice, setChoice] = useState<GameChoice>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const set = (patch: Partial<GameChoice>) => setChoice((current) => ({ ...current, ...patch }));
  const mode = modes.find((item) => item.value === choice.mode) ?? modes[0];
  const fixed = Boolean(mode.fixedSet);
  // A fixed-set mode always plays the whole, unfiltered set.
  const effective: GameChoice = fixed ? { ...choice, pool: "all", picks: [], size: null } : choice;

  const count = (patch: Partial<GameChoice>) => filterPlaces(places, { ...effective, ...patch }).length;
  const total = count({});
  const playCount = effective.size && effective.size < total ? effective.size : total;
  const practice = Boolean(effective.size && effective.size < total);
  const ranked = !practice;
  const best = ranked ? bests?.find((item) => matchesBest(item, game, effective)) : undefined;

  // Picks that no longer fit the chosen catalog or region still count as picked, but are left out.
  const inSet = filterPlaces(places, { ...effective, pool: "all" });
  const inSetCodes = new Set(inSet.map((place) => place.code));
  const outsidePicks = effective.pool === "manual" ? effective.picks.filter((code) => !inSetCodes.has(code)).length : 0;
  const needle = search.trim().toLocaleLowerCase();
  const matching = inSet.filter((place) => !needle || `${place.name} ${place.code}`.toLocaleLowerCase().includes(needle));
  const picked = new Set(effective.picks);

  useEffect(() => {
    if (choice.region && !regions.some((region) => region.id === choice.region)) set({ region: null });
  }, [regions, choice.region]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!total) return;
    setBusy(true);
    setMessage("");
    const final = { ...effective, picks: effective.pool === "manual" ? sorted(effective.picks) : [], size: practice ? effective.size : null };
    saveSetup(game, final);
    try {
      await onStart(final);
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const side = (
    <>
      <SideCard title="Unfinished rounds">
        <ResumeList empty={resumeEmpty} items={resume} />
      </SideCard>
      <BestsCard game={game} bests={bests} current={ranked ? effective : undefined} />
    </>
  );

  return (
    <>
      <ModePage eyebrow={eyebrow} title={title} intro={intro} side={side}>
        <SetupForm onSubmit={submit}>
          <Step n={1} title="How do you want to play?">
            <OptionCards value={effective.mode} onChange={(value) => set({ mode: value })} options={modes} />
          </Step>

          <Step n={2} title="Which places?" hint={hint?.(effective)}>
            <div className="segmented" role="group" aria-label="Catalog">
              {(["un", "all"] as const).map((scope) => (
                <button key={scope} type="button" aria-pressed={effective.scope === scope} onClick={() => set({ scope })}>
                  {scopeNames[scope]} <span className="segmented-count">{count({ scope, region: null, pool: "all" })}</span>
                </button>
              ))}
            </div>
            <p className="muted text-sm mt-2">
              {effective.scope === "un"
                ? "Only UN member states – no overseas territories that share a flag or a capital with another country."
                : "Every country and territory in the atlas, including places like Réunion or Greenland."}
            </p>
            <div className="mt-4">
              <Chips label="Region" value={effective.region} onChange={(region) => set({ region })} options={[
                { value: null, label: "Whole world", count: count({ region: null }) },
                ...regions.map((region) => {
                  const n = count({ region: region.id });
                  return { value: region.id, label: region.name, count: n, disabled: n === 0 && effective.region !== region.id };
                }),
              ]} />
            </div>
          </Step>

          <Step n={3} title="Difficulty" hint={fixed ? mode.fixedSet : outsidePicks ? `${outsidePicks} of your picks ${outsidePicks === 1 ? "is" : "are"} outside this set and left out.` : undefined}>
            <Chips label="Difficulty" value={effective.pool} onChange={(pool) => set({ pool })} options={[
              { value: "all", label: "All", count: count({ pool: "all" }) },
              { value: "easy", label: "Well-known", count: count({ pool: "easy" }), disabled: fixed },
              { value: "manual", label: "Pick my own", count: effective.pool === "manual" ? total : undefined, disabled: fixed },
            ]} />
            {effective.pool === "manual" && (
              <div className="pick-panel">
                <div className="pick-toolbar">
                  <label className="pick-search">
                    <span className="sr-only">Search places</span>
                    <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
                      placeholder={`Search ${inSet.length} places`} autoComplete="off" />
                  </label>
                  <div className="pick-actions">
                    <button type="button" className="secondary" disabled={!matching.length}
                      onClick={() => set({ picks: sorted([...effective.picks, ...matching.map((place) => place.code)]) })}>
                      Select {needle ? "matching" : "all"} ({matching.length})
                    </button>
                    <button type="button" className="secondary" disabled={!effective.picks.length} onClick={() => set({ picks: [] })}>
                      Clear
                    </button>
                  </div>
                </div>
                <p className="pick-count" aria-live="polite">{total} picked{outsidePicks ? ` (+${outsidePicks} outside this set)` : ""}</p>
                <div className="pick-grid" role="group" aria-label="Pick places">
                  {matching.map((place) => (
                    <label key={place.code} className={`pick-option ${picked.has(place.code) ? "is-selected" : ""}`}>
                      <input type="checkbox" checked={picked.has(place.code)} onChange={() =>
                        set({ picks: picked.has(place.code) ? effective.picks.filter((code) => code !== place.code) : [...effective.picks, place.code] })} />
                      {place.alpha2
                        ? <img src={`/flags/${place.alpha2.toLowerCase()}.svg`} width="32" height="22" loading="lazy" alt="" />
                        : <span className="pick-flag-empty" aria-hidden="true" />}
                      <span>{place.name}</span>
                    </label>
                  ))}
                  {!matching.length && <p className="muted">No places match this search.</p>}
                </div>
              </div>
            )}
          </Step>

          <Step n={4} title="How many?" hint={fixed ? undefined : practice
            ? "Random picks are practice rounds – they don't count for personal bests."
            : "Play the whole set to set a personal best."}>
            <Chips label="Round length" value={practice ? effective.size : null} onChange={(size) => set({ size })} options={[
              { value: null, label: "Whole set", count: total },
              ...SIZES.map((size) => ({ value: size, label: `${size} random`, disabled: fixed || size >= total })),
            ]} />
          </Step>

          <Step n={5} title="Time limit" hint={effective.limit ? "Timed rounds can't be paused and are ranked separately. Whatever is left when time runs out counts as skipped." : undefined}>
            <Chips label="Time limit" value={effective.limit} onChange={(limit) => set({ limit })}
              options={LIMITS.map((limit) => ({ value: limit, label: limitLabel(limit) }))} />
          </Step>

          <StartBar count={playCount} unit={unit(playCount, effective)} busy={busy} disabled={!total} label={startLabel}
            summary={[modeNames[effective.mode], describeSetup({ ...effective, picks: total, size: practice ? effective.size : null }), summaryNote]
              .filter(Boolean).join(" · ")}
            extra={!total ? undefined : practice ? "Practice round – not ranked"
              : best ? `Your best for this setup: ${bestScore(best)} in ${formatClock(best.elapsedMs)}`
              : "No personal best for this setup yet – set one!"} />
          {!total && <p className="muted" role="status">Nothing matches this choice – try another region, difficulty or catalog.</p>}
          {(message || error) && <p className="error" role="alert">{message || error}</p>}
        </SetupForm>
      </ModePage>
      {children}
    </>
  );
}

/** Personal bests for one game (or all games when `game` is omitted). The one for the current setup is highlighted. */
export function BestsCard({ game, bests, current, limit = 6, title = "Personal bests", showLink = true }: {
  game?: GameId; bests: PersonalBest[] | null; current?: GameChoice; limit?: number; title?: string; showLink?: boolean;
}) {
  const list = useMemo(() => {
    const own = (bests ?? []).filter((item) => !game || item.game === game);
    const match = current && game ? own.find((item) => matchesBest(item, game, current)) : undefined;
    return { match, rows: match ? [match, ...own.filter((item) => item !== match)] : own };
  }, [bests, game, current]);
  return (
    <SideCard title={title}>
      {bests === null ? (
        <p className="muted text-sm mt-2">Personal bests could not be loaded.</p>
      ) : list.rows.length ? (
        <BestsList bests={list.rows.slice(0, limit)} highlight={list.match} showGame={!game} />
      ) : (
        <p className="muted text-sm mt-2">Play a whole set to record your first best.</p>
      )}
      {showLink && <Link className="text-link mt-3" to="/profile#statistics">All statistics →</Link>}
    </SideCard>
  );
}

export function BestsList({ bests, highlight, showGame }: { bests: PersonalBest[]; highlight?: PersonalBest; showGame?: boolean }) {
  return (
    <ul className="side-list bests-list">
      {bests.map((best, index) => (
        <li key={`${best.game}-${best.completedAt}-${index}`} className={best === highlight ? "is-current" : undefined}>
          <div className="min-w-0">
            <p className="font-semibold">
              {showGame && <span className="bests-game">{gameNames[best.game]}</span>}
              {modeNames[best.mode] ?? best.mode}
              {best === highlight && <span className="bests-current">This setup</span>}
            </p>
            <p className="muted text-sm">
              {describeSetup({ scope: best.scope, region: best.region, pool: best.pool, picks: best.selectedCodes.length, limit: best.timeLimitSeconds })}
              {" · "}{best.runCount} {best.runCount === 1 ? "run" : "runs"}
            </p>
          </div>
          <p className="best-score">
            {bestScore(best)}
            <span>{formatClock(best.elapsedMs)}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Milliseconds left until `deadlineAt`, corrected for the difference between this device's clock and the server's. */
export function useTimeLeft(deadlineAt: string | null | undefined, serverNow: string | undefined) {
  const offset = useRef(0);
  useEffect(() => {
    if (serverNow) offset.current = Date.parse(serverNow) - Date.now();
  }, [serverNow]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadlineAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);
  return deadlineAt ? Math.max(0, Date.parse(deadlineAt) - (now + offset.current)) : null;
}

export function TimeLeft({ ms }: { ms: number }) {
  return (
    <span className={`time-left ${ms <= 30000 ? "is-low" : ""}`} role="timer" aria-label={`${formatClock(ms)} left`}>
      <Icon name="timer" size={15} /> {formatClock(ms)}
    </span>
  );
}

/** Small tags describing a round: catalog, picks, practice, time limit. */
export function RoundTags({ scope, pool, picks, sample, limit }: {
  scope?: SetupScope; pool?: SetupPool; picks?: number; sample?: number | null; limit?: number | null;
}) {
  const tags = [
    scope === "un" ? "UN member states" : null,
    pool === "easy" ? "Well-known" : pool === "manual" ? `${picks ?? 0} picked` : null,
    sample ? `Practice · ${sample} random` : null,
    limit ? `${limit / 60} min limit` : null,
  ].filter(Boolean) as string[];
  if (!tags.length) return null;
  return <span className="round-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</span>;
}

export const roundOptions = (choice: GameChoice) => ({ scope: choice.scope, picks: choice.pool === "manual" ? choice.picks : [], size: choice.size, limit: choice.limit });

/** True when a timed round ended because its time ran out. */
export const endedOnTime = (round: { deadlineAt?: string | null; completedAt?: string | null }) =>
  Boolean(round.deadlineAt && round.completedAt && Date.parse(round.completedAt) >= Date.parse(round.deadlineAt));

export function badgeText(badge: string | null | undefined, timeUp?: boolean) {
  const lead = timeUp ? "Time's up · " : "";
  return lead + (badge === "new_best" ? "New personal best!" : badge === "first_run" ? "First run for this setup – your best to beat"
    : badge === "unranked" ? "Practice round – not ranked" : "Completed run");
}
