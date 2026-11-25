// Phone setup for Flags and Capitals: the same choices and rules as the desktop GameSetup (src/game-setup.tsx)
// – mode · catalog · region · difficulty · length · time limit – shown as step cards that open bottom sheets.
// Domain helpers, URL parameters and the remembered setup are shared with the desktop app on the same device.
import { ReactNode, useEffect, useMemo, useState } from "react";
import {
  GameChoice,
  GameId,
  LIMITS,
  PersonalBest,
  SIZES,
  SetupPlace,
  bestScore,
  describeSetup,
  filterPlaces,
  formatClock,
  limitLabel,
  matchesBest,
  modeNames,
  poolNames,
  regionLabel,
  scopeNames,
} from "@shared/game-setup";
import { saveSetup } from "@shared/prefs";
import { IconName, IconTile } from "@shared/icons";
import {
  ActionBar,
  ActionCard,
  BottomSheet,
  Button,
  Card,
  Chip,
  ChipGroup,
  LinkButton,
  Section,
  StatusMessage,
  TextField,
} from "@phone/ui";
import { FlagPicture } from "./common";
import { flagFromAlpha2 } from "./geo-logic";

export type GeoMode = { value: string; title: string; text: string; icon: IconName };
export type ResumeRow = {
  id: string;
  title: string;
  detail: string;
  to: string;
  /** Omit when the game has no discard action for saved rounds. */
  onDiscard?: () => void;
};

type SheetId = "places" | "difficulty" | "length" | "limit" | null;
const sorted = (codes: string[]) => [...new Set(codes)].sort();

export function GeoSetup({
  game,
  intro,
  modes,
  places,
  regions,
  unit,
  initial,
  bests,
  hint,
  onStart,
  resume,
  error,
}: {
  game: Extract<GameId, "flags" | "capitals">;
  intro: ReactNode;
  modes: GeoMode[];
  places: SetupPlace[];
  regions: { id: string; name: string }[];
  unit: (count: number) => string;
  initial: GameChoice;
  bests: PersonalBest[] | null;
  hint?: (choice: GameChoice) => string | undefined;
  onStart: (choice: GameChoice) => Promise<void>;
  resume: ResumeRow[];
  error?: string;
}) {
  const [choice, setChoice] = useState<GameChoice>(initial);
  const [sheet, setSheet] = useState<SheetId>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const set = (patch: Partial<GameChoice>) => setChoice((current) => ({ ...current, ...patch }));

  const count = (patch: Partial<GameChoice>) => filterPlaces(places, { ...choice, ...patch }).length;
  const total = count({});
  const practice = Boolean(choice.size && choice.size < total);
  const playCount = practice ? (choice.size as number) : total;
  const best = practice ? undefined : bests?.find((item) => matchesBest(item, game, choice));

  // Picks outside the chosen catalog or region stay picked but are left out (same as desktop).
  const inSet = filterPlaces(places, { ...choice, pool: "all" });
  const inSetCodes = new Set(inSet.map((place) => place.code));
  const outsidePicks = choice.pool === "manual" ? choice.picks.filter((code) => !inSetCodes.has(code)).length : 0;
  const needle = search.trim().toLocaleLowerCase();
  const matching = inSet.filter((place) => !needle || `${place.name} ${place.code}`.toLocaleLowerCase().includes(needle));
  const picked = new Set(choice.picks);

  useEffect(() => {
    if (choice.region && !regions.some((region) => region.id === choice.region)) set({ region: null });
  }, [regions, choice.region]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    if (!total || busy) return;
    setBusy(true);
    setMessage("");
    const final: GameChoice = {
      ...choice,
      picks: choice.pool === "manual" ? sorted(choice.picks) : [],
      size: practice ? choice.size : null,
    };
    saveSetup(game, final);
    try {
      await onStart(final);
    } catch (cause) {
      setMessage((cause as Error).message);
      setBusy(false);
    }
  }

  const ownBests = useMemo(() => {
    const own = (bests ?? []).filter((item) => item.game === game);
    return best ? [best, ...own.filter((item) => item !== best)] : own;
  }, [bests, game, best]);

  const extraHint = hint?.(choice);
  const difficultyText =
    choice.pool === "manual"
      ? `${total} picked${outsidePicks ? ` (+${outsidePicks} outside this set)` : ""}`
      : poolNames[choice.pool];
  const lengthText = practice ? `${choice.size} random – practice` : `Whole set (${total})`;
  const done = (
    <Button variant="primary" size="lg" onClick={() => setSheet(null)}>
      Done
    </Button>
  );

  return (
    <div className="ph-stack">
      <p className="ph-muted">{intro}</p>

      {resume.length > 0 && (
        <Section title="Unfinished rounds">
          <ul className="ph-geo-list">
            {resume.map((item) => (
              <li key={item.id}>
                <Card className="ph-geo-resume">
                  <div className="ph-geo-resume-text">
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </div>
                  <div className="ph-geo-row">
                    <LinkButton to={item.to} variant="secondary" aria-label={`Resume ${item.title}`}>
                      Resume
                    </LinkButton>
                    {item.onDiscard && (
                      <Button variant="ghost" onClick={item.onDiscard} aria-label={`Discard ${item.title}`}>
                        Discard
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="1 · How do you want to play?">
        <div className="ph-geo-modes" role="group" aria-label="Mode">
          {modes.map((item) => (
            <button
              key={item.value}
              type="button"
              className="ph-geo-mode"
              aria-pressed={item.value === choice.mode}
              onClick={() => set({ mode: item.value })}
            >
              <IconTile name={item.icon} tone={game} />
              <span className="ph-geo-mode-text">
                <strong>{item.title}</strong>
                <small>{item.text}</small>
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Your setup">
        <div className="ph-stack ph-geo-steps">
          <ActionCard
            title="2 · Which places?"
            text={`${scopeNames[choice.scope]} · ${regionLabel(choice.region)}`}
            onClick={() => setSheet("places")}
          />
          <ActionCard title="3 · Difficulty" text={difficultyText} onClick={() => setSheet("difficulty")} />
          <ActionCard title="4 · How many?" text={lengthText} onClick={() => setSheet("length")} />
          <ActionCard title="5 · Time limit" text={limitLabel(choice.limit)} onClick={() => setSheet("limit")} />
        </div>
        {extraHint && <p className="ph-muted">{extraHint}</p>}
      </Section>

      <Card className="ph-geo-summary">
        <p className="ph-geo-summary-main">
          {modeNames[choice.mode]} · {describeSetup({ ...choice, picks: total, size: practice ? choice.size : null })}
        </p>
        <p className="ph-muted" role="status">
          {!total
            ? "Nothing matches this choice – try another region, difficulty or catalog."
            : practice
              ? "Practice round – not ranked."
              : best
                ? `Your best for this setup: ${bestScore(best)} in ${formatClock(best.elapsedMs)}`
                : "No personal best for this setup yet – set one!"}
        </p>
        {choice.limit ? <p className="ph-muted">Timed rounds can't be paused and are ranked separately.</p> : null}
      </Card>

      <StatusMessage tone="error">{message || error}</StatusMessage>

      <Section title="Personal bests">
        {bests === null ? (
          <p className="ph-muted">Personal bests could not be loaded.</p>
        ) : ownBests.length ? (
          <ul className="ph-geo-bests">
            {ownBests.slice(0, 6).map((item, index) => (
              <li key={`${item.completedAt}-${index}`} data-current={item === best ? "true" : undefined}>
                <span className="ph-geo-bests-text">
                  <strong>
                    {modeNames[item.mode] ?? item.mode}
                    {item === best && <span className="ph-geo-pill">This setup</span>}
                  </strong>
                  <small>
                    {describeSetup({
                      scope: item.scope,
                      region: item.region,
                      pool: item.pool,
                      picks: item.selectedCodes.length,
                      limit: item.timeLimitSeconds,
                    })}
                    {` · ${item.runCount} ${item.runCount === 1 ? "run" : "runs"}`}
                  </small>
                </span>
                <span className="ph-geo-bests-score">
                  {bestScore(item)}
                  <small>{formatClock(item.elapsedMs)}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ph-muted">Play a whole set to record your first best.</p>
        )}
      </Section>

      <ActionBar>
        <Button variant="primary" size="lg" loading={busy} disabled={!total} onClick={() => void start()}>
          {busy ? "Preparing…" : `Start round · ${playCount} ${unit(playCount)}`}
        </Button>
      </ActionBar>

      <BottomSheet open={sheet === "places"} onClose={() => setSheet(null)} title="Which places?" footer={done}>
        <div className="ph-stack">
          <ChipGroup label="Catalog">
            {(["un", "all"] as const).map((scope) => (
              <Chip key={scope} pressed={choice.scope === scope} onToggle={() => set({ scope })}>
                {scopeNames[scope]} <span className="ph-geo-count">{count({ scope, region: null, pool: "all" })}</span>
              </Chip>
            ))}
          </ChipGroup>
          <p className="ph-muted">
            {choice.scope === "un"
              ? "Only UN member states – no overseas territories that share a flag or a capital with another country."
              : "Every country and territory in the atlas, including places like Réunion or Greenland."}
          </p>
          <ChipGroup label="Region">
            <Chip pressed={!choice.region} onToggle={() => set({ region: null })}>
              Whole world <span className="ph-geo-count">{count({ region: null })}</span>
            </Chip>
            {regions.map((region) => {
              const n = count({ region: region.id });
              return (
                <Chip
                  key={region.id}
                  pressed={choice.region === region.id}
                  disabled={n === 0 && choice.region !== region.id}
                  onToggle={() => set({ region: region.id })}
                >
                  {region.name} <span className="ph-geo-count">{n}</span>
                </Chip>
              );
            })}
          </ChipGroup>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "difficulty"} onClose={() => setSheet(null)} title="Difficulty" footer={done}>
        <div className="ph-stack">
          <ChipGroup label="Difficulty">
            <Chip pressed={choice.pool === "all"} onToggle={() => set({ pool: "all" })}>
              All <span className="ph-geo-count">{count({ pool: "all" })}</span>
            </Chip>
            <Chip pressed={choice.pool === "easy"} onToggle={() => set({ pool: "easy" })}>
              Well-known <span className="ph-geo-count">{count({ pool: "easy" })}</span>
            </Chip>
            <Chip pressed={choice.pool === "manual"} onToggle={() => set({ pool: "manual" })}>
              Pick my own
            </Chip>
          </ChipGroup>
          {choice.pool === "manual" && (
            <>
              <TextField
                label="Search places"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${inSet.length} places`}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
              />
              <div className="ph-geo-row">
                <Button
                  disabled={!matching.length}
                  onClick={() => set({ picks: sorted([...choice.picks, ...matching.map((place) => place.code)]) })}
                >
                  Select {needle ? "matching" : "all"} ({matching.length})
                </Button>
                <Button disabled={!choice.picks.length} onClick={() => set({ picks: [] })}>
                  Clear
                </Button>
              </div>
              <p className="ph-muted" aria-live="polite">
                {total} picked{outsidePicks ? ` (+${outsidePicks} outside this set and left out)` : ""}
              </p>
              <ul className="ph-geo-picks" aria-label="Pick places">
                {matching.map((place) => (
                  <li key={place.code}>
                    <label className="ph-geo-pick">
                      <input
                        type="checkbox"
                        checked={picked.has(place.code)}
                        onChange={() =>
                          set({
                            picks: picked.has(place.code)
                              ? choice.picks.filter((code) => code !== place.code)
                              : [...choice.picks, place.code],
                          })
                        }
                      />
                      <FlagPicture url={flagFromAlpha2(place.alpha2)} label="" className="is-tiny" />
                      <span>{place.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
              {!matching.length && <p className="ph-muted">No places match this search.</p>}
            </>
          )}
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "length"} onClose={() => setSheet(null)} title="How many?" footer={done}>
        <div className="ph-stack">
          <ChipGroup label="Round length">
            <Chip pressed={!practice} onToggle={() => set({ size: null })}>
              Whole set <span className="ph-geo-count">{total}</span>
            </Chip>
            {SIZES.map((size) => (
              <Chip
                key={size}
                pressed={practice && choice.size === size}
                disabled={size >= total}
                onToggle={() => set({ size })}
              >
                {size} random
              </Chip>
            ))}
          </ChipGroup>
          <p className="ph-muted">
            {practice
              ? "Random picks are practice rounds – they don't count for personal bests."
              : "Play the whole set to set a personal best."}
          </p>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "limit"} onClose={() => setSheet(null)} title="Time limit" footer={done}>
        <div className="ph-stack">
          <ChipGroup label="Time limit">
            {LIMITS.map((limit) => (
              <Chip key={String(limit)} pressed={choice.limit === limit} onToggle={() => set({ limit })}>
                {limitLabel(limit)}
              </Chip>
            ))}
          </ChipGroup>
          <p className="ph-muted">
            {choice.limit
              ? "Timed rounds can't be paused and are ranked separately. Whatever is left when time runs out counts as skipped."
              : "Take as long as you like – the round is saved until you finish it."}
          </p>
        </div>
      </BottomSheet>
    </div>
  );
}
