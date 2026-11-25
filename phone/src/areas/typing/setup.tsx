// Phone setup for Recall: the same choices and rules as the desktop GameSetup (src/game-setup.tsx), shown as
// step cards that open bottom sheets. Domain helpers, URL parameters and the remembered setup are shared, so a
// setup chosen on the desktop app shows up here on the same device and the other way round.
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
  GameButton,
  LinkButton,
  Section,
  StatusMessage,
  TextField,
} from "@phone/ui";
import { Flag } from "./common";

export type PhoneMode = {
  value: string;
  title: string;
  text: string;
  icon: IconName;
  /** The whole set is the challenge (Recall countries): no well-known filter, picks or random length. */
  fixedSet?: string;
  /** Extra line under the option, e.g. progress. */
  footer?: ReactNode;
};

export type ResumeRow = { id: string; title: string; detail: string; to: string; onDiscard: () => void };

type SheetId = "places" | "difficulty" | "length" | "limit" | null;

const sorted = (codes: string[]) => [...new Set(codes)].sort();

export function PhoneGameSetup({
  game,
  hero,
  intro,
  modes,
  places,
  regions,
  unit,
  initial,
  bests,
  startLabel,
  onStart,
  resume,
  error,
}: {
  game: GameId;
  /** Game header card (ModeHero) above the intro. */
  hero?: ReactNode;
  intro: ReactNode;
  modes: PhoneMode[];
  places: SetupPlace[];
  regions: { id: string; name: string }[];
  unit: (count: number, choice: GameChoice) => string;
  initial: GameChoice;
  bests: PersonalBest[] | null;
  startLabel: string;
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

  const mode = modes.find((item) => item.value === choice.mode) ?? modes[0];
  const fixed = Boolean(mode.fixedSet);
  const effective: GameChoice = fixed ? { ...choice, pool: "all", picks: [], size: null } : choice;
  const count = (patch: Partial<GameChoice>) => filterPlaces(places, { ...effective, ...patch }).length;
  const total = count({});
  const practice = Boolean(effective.size && effective.size < total);
  const playCount = practice ? (effective.size as number) : total;
  const best = practice ? undefined : bests?.find((item) => matchesBest(item, game, effective));

  const inSet = filterPlaces(places, { ...effective, pool: "all" });
  const inSetCodes = new Set(inSet.map((place) => place.code));
  const outsidePicks = effective.pool === "manual" ? effective.picks.filter((code) => !inSetCodes.has(code)).length : 0;
  const needle = search.trim().toLocaleLowerCase();
  const matching = inSet.filter((place) => !needle || `${place.name} ${place.code}`.toLocaleLowerCase().includes(needle));
  const picked = new Set(effective.picks);

  useEffect(() => {
    if (choice.region && !regions.some((region) => region.id === choice.region)) set({ region: null });
  }, [regions, choice.region]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    if (!total || busy) return;
    setBusy(true);
    setMessage("");
    const final: GameChoice = {
      ...effective,
      picks: effective.pool === "manual" ? sorted(effective.picks) : [],
      size: practice ? effective.size : null,
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

  const placesText = `${scopeNames[effective.scope]} · ${regionLabel(effective.region)}`;
  const difficultyText = fixed
    ? "All – the whole set"
    : effective.pool === "manual"
      ? `${total} picked${outsidePicks ? ` (+${outsidePicks} outside this set)` : ""}`
      : poolNames[effective.pool];
  const lengthText = fixed ? "Whole set" : practice ? `${effective.size} random – practice` : `Whole set (${total})`;
  const doneFooter = (
    <Button variant="primary" size="lg" onClick={() => setSheet(null)}>
      Done
    </Button>
  );

  return (
    <div className="ph-stack">
      {hero}
      <p className="ph-muted">{intro}</p>

      {resume.length > 0 && (
        <Section title="Unfinished rounds">
          <ul className="ph-typing-resume">
            {resume.map((item) => (
              <li key={item.id}>
                <ResumeCard item={item} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="1 · How do you want to play?">
        <div className="ph-typing-modes" role="group" aria-label="Mode">
          {modes.map((item) => (
            <button
              key={item.value}
              type="button"
              className="ph-typing-mode"
              aria-pressed={item.value === effective.mode}
              onClick={() => set({ mode: item.value })}
            >
              <IconTile name={item.icon} tone={game} />
              <span className="ph-typing-mode-text">
                <strong>{item.title}</strong>
                <small>{item.text}</small>
                {item.footer && <span className="ph-typing-mode-footer">{item.footer}</span>}
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Your setup">
        <div className="ph-typing-steps">
          <ActionCard title="2 · Which places?" text={placesText} onClick={() => setSheet("places")} />
          <ActionCard
            title="3 · Difficulty"
            text={fixed ? mode.fixedSet : difficultyText}
            onClick={() => setSheet("difficulty")}
            disabled={fixed}
          />
          <ActionCard
            title="4 · How many?"
            text={lengthText}
            onClick={() => setSheet("length")}
            disabled={fixed}
          />
          <ActionCard title="5 · Time limit" text={limitLabel(effective.limit)} onClick={() => setSheet("limit")} />
        </div>
      </Section>

      <Card className="ph-typing-summary">
        <p className="ph-typing-summary-main">
          {modeNames[effective.mode]} · {describeSetup({ ...effective, picks: total, size: practice ? effective.size : null })}
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
        {effective.limit ? (
          <p className="ph-muted">Timed rounds can't be paused and are ranked separately.</p>
        ) : null}
      </Card>

      <StatusMessage tone="error">{message || error}</StatusMessage>

      <Section title="Personal bests">
        {bests === null ? (
          <p className="ph-muted">Personal bests could not be loaded.</p>
        ) : ownBests.length ? (
          <ul className="ph-typing-bests">
            {ownBests.slice(0, 6).map((item, index) => (
              <li key={`${item.completedAt}-${index}`} className={item === best ? "is-current" : undefined}>
                <span className="ph-typing-bests-text">
                  <strong>
                    {modeNames[item.mode] ?? item.mode}
                    {item === best && <span className="ph-typing-pill">This setup</span>}
                  </strong>
                  <small>
                    {describeSetup({
                      scope: item.scope,
                      region: item.region,
                      pool: item.pool,
                      picks: item.selectedCodes.length,
                      limit: item.timeLimitSeconds,
                    })}
                  </small>
                </span>
                <span className="ph-typing-bests-score">
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
        <GameButton variant="primary" size="lg" block loading={busy} disabled={!total} onClick={() => void start()}>
          {busy ? "Preparing…" : `${startLabel} · ${playCount} ${unit(playCount, effective)}`}
        </GameButton>
      </ActionBar>

      <BottomSheet open={sheet === "places"} onClose={() => setSheet(null)} title="Which places?" footer={doneFooter}>
        <div className="ph-stack">
          <ChipGroup label="Catalog">
            {(["un", "all"] as const).map((scope) => (
              <Chip key={scope} pressed={effective.scope === scope} onToggle={() => set({ scope })}>
                {scopeNames[scope]} <span className="ph-typing-count">{count({ scope, region: null, pool: "all" })}</span>
              </Chip>
            ))}
          </ChipGroup>
          <p className="ph-muted">
            {effective.scope === "un"
              ? "Only UN member states – no overseas territories that share a flag or a capital with another country."
              : "Every country and territory in the atlas, including places like Réunion or Greenland."}
          </p>
          <ChipGroup label="Region">
            <Chip pressed={!effective.region} onToggle={() => set({ region: null })}>
              Whole world <span className="ph-typing-count">{count({ region: null })}</span>
            </Chip>
            {regions.map((region) => {
              const n = count({ region: region.id });
              return (
                <Chip
                  key={region.id}
                  pressed={effective.region === region.id}
                  disabled={n === 0 && effective.region !== region.id}
                  onToggle={() => set({ region: region.id })}
                >
                  {region.name} <span className="ph-typing-count">{n}</span>
                </Chip>
              );
            })}
          </ChipGroup>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "difficulty"} onClose={() => setSheet(null)} title="Difficulty" footer={doneFooter}>
        <div className="ph-stack">
          <ChipGroup label="Difficulty">
            <Chip pressed={effective.pool === "all"} onToggle={() => set({ pool: "all" })}>
              All <span className="ph-typing-count">{count({ pool: "all" })}</span>
            </Chip>
            <Chip pressed={effective.pool === "easy"} onToggle={() => set({ pool: "easy" })}>
              Well-known <span className="ph-typing-count">{count({ pool: "easy" })}</span>
            </Chip>
            <Chip pressed={effective.pool === "manual"} onToggle={() => set({ pool: "manual" })}>
              Pick my own
            </Chip>
          </ChipGroup>
          {effective.pool === "manual" && (
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
              <div className="ph-typing-row">
                <Button
                  disabled={!matching.length}
                  onClick={() => set({ picks: sorted([...effective.picks, ...matching.map((place) => place.code)]) })}
                >
                  Select {needle ? "matching" : "all"} ({matching.length})
                </Button>
                <Button disabled={!effective.picks.length} onClick={() => set({ picks: [] })}>
                  Clear
                </Button>
              </div>
              <p className="ph-muted" aria-live="polite">
                {total} picked{outsidePicks ? ` (+${outsidePicks} outside this set and left out)` : ""}
              </p>
              <ul className="ph-typing-picks" aria-label="Pick places">
                {matching.map((place) => (
                  <li key={place.code}>
                    <label className="ph-typing-pick">
                      <input
                        type="checkbox"
                        checked={picked.has(place.code)}
                        onChange={() =>
                          set({
                            picks: picked.has(place.code)
                              ? effective.picks.filter((code) => code !== place.code)
                              : [...effective.picks, place.code],
                          })
                        }
                      />
                      <Flag code={place.alpha2} />
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

      <BottomSheet open={sheet === "length"} onClose={() => setSheet(null)} title="How many?" footer={doneFooter}>
        <div className="ph-stack">
          <ChipGroup label="Round length">
            <Chip pressed={!practice} onToggle={() => set({ size: null })}>
              Whole set <span className="ph-typing-count">{total}</span>
            </Chip>
            {SIZES.map((size) => (
              <Chip key={size} pressed={practice && effective.size === size} disabled={size >= total} onToggle={() => set({ size })}>
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

      <BottomSheet open={sheet === "limit"} onClose={() => setSheet(null)} title="Time limit" footer={doneFooter}>
        <div className="ph-stack">
          <ChipGroup label="Time limit">
            {LIMITS.map((limit) => (
              <Chip key={String(limit)} pressed={effective.limit === limit} onToggle={() => set({ limit })}>
                {limitLabel(limit)}
              </Chip>
            ))}
          </ChipGroup>
          <p className="ph-muted">
            {effective.limit
              ? "Timed rounds can't be paused and are ranked separately. Whatever is left when time runs out counts as skipped."
              : "Take as long as you like – the round is saved until you finish it."}
          </p>
        </div>
      </BottomSheet>
    </div>
  );
}

function ResumeCard({ item }: { item: ResumeRow }) {
  return (
    <Card className="ph-typing-resume-card">
      <div className="ph-typing-resume-text">
        <strong>{item.title}</strong>
        <small>{item.detail}</small>
      </div>
      <div className="ph-typing-row">
        <LinkButton to={item.to} variant="secondary" aria-label={`Resume ${item.title}`}>
          Resume
        </LinkButton>
        <Button variant="ghost" onClick={item.onDiscard} aria-label={`Discard ${item.title}`}>
          Discard
        </Button>
      </div>
    </Card>
  );
}

