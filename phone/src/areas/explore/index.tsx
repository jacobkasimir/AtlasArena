// Phone Explorer under /explorer/*: a compact, read-only atlas built on api.explore (demo branch included).
// Search, region chips, a paged list of places, a detail sheet with neighbours you can hop through, links into
// the Flags and Capitals setups for a region, and a local study mode that hides capitals until tapped.
import { MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@shared/api";
import type { ExplorerCountry } from "@shared/domain";
import { useLoad } from "@shared/components";
import { loadSetup } from "@shared/prefs";
import { Icon } from "@shared/icons";
import { usePhoneChrome } from "@phone/shell/chrome";
import { paths } from "@phone/shell/paths";
import {
  BottomSheet,
  Button,
  Chip,
  ChipGroup,
  LinkGameButton,
  LoadingState,
  ModeHero,
  SegmentedControl,
  StatusMessage,
  TextField,
  feel,
} from "@phone/ui";
import {
  PAGE_SIZE,
  PractiseGame,
  factsOf,
  filterCountries,
  flagSrc,
  neighboursOf,
  practiseQuery,
  regionsOf,
  statusNote,
} from "./explore-logic";
import "./explore.css";

const STUDY_KEY = "atlas-phone-explorer-study";
type ViewMode = "browse" | "study";

function readStudy(): ViewMode {
  try {
    return localStorage.getItem(STUDY_KEY) === "1" ? "study" : "browse";
  } catch {
    return "browse";
  }
}

function writeStudy(mode: ViewMode) {
  try {
    if (mode === "study") localStorage.setItem(STUDY_KEY, "1");
    else localStorage.removeItem(STUDY_KEY);
  } catch {
    /* private mode: study mode just isn't remembered */
  }
}

export default function ExplorerArea() {
  return (
    <Routes>
      <Route path="*" element={<ExplorerScreen />} />
    </Routes>
  );
}

function Flag({ country, size, eager = false }: { country: ExplorerCountry; size: "row" | "chip" | "large"; eager?: boolean }) {
  const src = flagSrc(country);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  return (
    <span className={`ph-explore-flag is-${size}`} aria-hidden="true">
      {src && !broken ? (
        <img src={src} alt="" loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setBroken(true)} />
      ) : country.flagEmoji ? (
        <span className="ph-explore-flag-emoji">{country.flagEmoji}</span>
      ) : (
        <Icon name="flag" size={size === "large" ? 28 : 16} />
      )}
    </span>
  );
}

function ExplorerScreen() {
  usePhoneChrome({ title: "Explorer", back: true });
  const navigate = useNavigate();
  const { data, error, reload } = useLoad<ExplorerCountry[]>(() => api.explore());
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const region = params.get("region") || null;
  const [openCode, setOpenCode] = useState<string | null>(() => params.get("place"));
  const [trail, setTrail] = useState<string[]>([]);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [view, setView] = useState<ViewMode>(readStudy);
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const leaving = useRef(false);

  const countries = data ?? [];
  const regions = useMemo(() => regionsOf(countries), [countries]);
  const filtered = useMemo(() => filterCountries(countries, query, region), [countries, query, region]);
  const visible = filtered.slice(0, shown);
  const opened = openCode ? countries.find((country) => country.code === openCode) ?? null : null;
  const study = view === "study";

  useEffect(() => setShown(PAGE_SIZE), [query, region]);

  function setParam(key: "q" | "region", value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("place");
    setParams(next, { replace: true });
  }

  function changeView(next: ViewMode) {
    setView(next);
    writeStudy(next);
    setRevealed(new Set());
  }

  function toggleReveal(code: string) {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else {
        next.add(code);
        feel("select");
      }
      return next;
    });
  }

  function openPlace(code: string) {
    feel("tap");
    setTrail([]);
    setOpenCode(code);
  }

  function openNeighbour(code: string) {
    if (openCode) setTrail((current) => [...current, openCode]);
    setOpenCode(code);
  }

  function stepBack() {
    const previous = trail[trail.length - 1];
    if (!previous) return;
    setTrail((current) => current.slice(0, -1));
    setOpenCode(previous);
  }

  function closeSheet() {
    setOpenCode(null);
    setTrail([]);
  }

  /**
   * Leave from inside the open sheet: close it first and navigate once its history entry is gone, so the
   * sheet's same-URL entry doesn't pop the new page (BottomSheet removes it with history.go(-1)).
   */
  function leaveSheetTo(to: string) {
    if (leaving.current) return;
    leaving.current = true;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      window.removeEventListener("popstate", onPop);
      window.clearTimeout(timer);
      leaving.current = false;
      navigate(to);
    };
    const onPop = () => window.setTimeout(go, 0);
    window.addEventListener("popstate", onPop);
    const timer = window.setTimeout(go, 700);
    closeSheet();
  }

  const practisePath = (game: PractiseGame, name: string) =>
    `${game === "flags" ? paths.flags : paths.capitals}${practiseQuery(name, loadSetup(game))}`;

  if (!data) {
    return error ? (
      <StatusMessage tone="error" retry={reload}>
        {error}
      </StatusMessage>
    ) : (
      <LoadingState label="Loading the atlas…" />
    );
  }

  const revealedHere = visible.filter((country) => revealed.has(country.code)).length;

  return (
    <div className="ph-explore tone-explorer">
      <ModeHero
        title="World atlas"
        subtitle="Look up any place, learn its capital and neighbours, then practise it."
        icon="explorer"
        tone="explorer"
        badge={`${data.length} places`}
      />

      <div className="ph-explore-controls">
        <TextField
          label="Find a place"
          type="search"
          value={query}
          placeholder="Country, capital or code"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => setParam("q", event.target.value)}
        />

        <div className="ph-explore-chips">
          <ChipGroup label="Region">
            <Chip pressed={!region} onToggle={() => setParam("region", null)}>
              All <span className="ph-explore-count">{data.length}</span>
            </Chip>
            {regions.map((item) => (
              <Chip
                key={item.name}
                pressed={region === item.name}
                onToggle={() => setParam("region", region === item.name ? null : item.name)}
              >
                {item.name} <span className="ph-explore-count">{item.count}</span>
              </Chip>
            ))}
          </ChipGroup>
        </div>

        <SegmentedControl<ViewMode>
          label="View"
          value={view}
          onChange={changeView}
          options={[
            { value: "browse", label: "Browse", icon: "book" },
            { value: "study", label: "Study capitals", icon: "practice" },
          ]}
        />
      </div>

      {study && (
        <div className="ph-explore-study">
          <p role="status">
            Say each capital to yourself, then tap to check. Revealed {revealedHere} of {visible.length}.
          </p>
          {revealed.size > 0 && (
            <Button variant="ghost" onClick={() => setRevealed(new Set())}>
              Hide all
            </Button>
          )}
        </div>
      )}

      {region && (
        <section className="ph-explore-practise tone-explorer" aria-label={`Practise ${region}`}>
          <h2>Practise {region}</h2>
          <div className="ph-explore-practise-row">
            <LinkGameButton variant="tone" tone="flags" size="md" to={practisePath("flags", region)}>
              Flags
            </LinkGameButton>
            <LinkGameButton variant="tone" tone="capitals" size="md" to={practisePath("capitals", region)}>
              Capitals
            </LinkGameButton>
          </div>
        </section>
      )}

      <p className="ph-explore-meta" role="status">
        {filtered.length === 0
          ? "No places match."
          : `Showing ${visible.length} of ${filtered.length} ${filtered.length === 1 ? "place" : "places"}`}
      </p>

      {filtered.length === 0 && (
        <div className="ph-explore-empty">
          <p>Try another spelling, a capital or a two-letter code.</p>
          {(query || region) && (
            <Button
              variant="secondary"
              onClick={() => setParams(new URLSearchParams(), { replace: true })}
            >
              Show all places
            </Button>
          )}
        </div>
      )}

      <ul className="ph-explore-list" aria-label="Places">
        {visible.map((country, index) => {
          const isRevealed = revealed.has(country.code);
          return (
            <li key={country.code} className="ph-explore-row" data-study={study || undefined}>
              <button type="button" className="ph-explore-open" onClick={() => openPlace(country.code)}>
                <Flag country={country} size="row" eager={index < 8} />
                <span className="ph-explore-row-text">
                  <span className="ph-explore-name">{country.name}</span>
                  <span className="ph-explore-sub">{study ? country.region : country.capital || "No capital listed"}</span>
                </span>
                {!study && <Icon name="chevronRight" size={18} className="ph-explore-chevron" />}
              </button>
              {study && (
                <button
                  type="button"
                  className="ph-explore-reveal"
                  aria-pressed={isRevealed}
                  aria-label={isRevealed ? `Capital of ${country.name}: ${country.capital || "none listed"}. Hide` : `Reveal the capital of ${country.name}`}
                  onClick={() => toggleReveal(country.code)}
                >
                  {isRevealed ? country.capital || "None listed" : "Tap to reveal"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {visible.length < filtered.length && (
        <Button variant="secondary" block onClick={() => setShown((count) => count + PAGE_SIZE)}>
          Show more ({Math.min(PAGE_SIZE, filtered.length - visible.length)} of {filtered.length - visible.length} left)
        </Button>
      )}

      <p className="ph-explore-note">
        Catalog data is imported and not independently verified. Explorer is read-only: nothing here changes your scores.
      </p>

      <PlaceSheet
        country={opened}
        all={countries}
        study={study}
        revealed={opened ? revealed.has(opened.code) : false}
        onReveal={() => opened && toggleReveal(opened.code)}
        backTo={trail.length ? countries.find((item) => item.code === trail[trail.length - 1])?.name ?? null : null}
        onBack={stepBack}
        onNeighbour={openNeighbour}
        onClose={closeSheet}
        onPractise={(event, game) => {
          if (!opened?.region) return;
          event.preventDefault();
          leaveSheetTo(practisePath(game, opened.region));
        }}
        practiseHref={(game) => (opened?.region ? practisePath(game, opened.region) : "")}
      />
    </div>
  );
}

function PlaceSheet({
  country,
  all,
  study,
  revealed,
  onReveal,
  backTo,
  onBack,
  onNeighbour,
  onClose,
  onPractise,
  practiseHref,
}: {
  country: ExplorerCountry | null;
  all: ExplorerCountry[];
  study: boolean;
  revealed: boolean;
  onReveal: () => void;
  backTo: string | null;
  onBack: () => void;
  onNeighbour: (code: string) => void;
  onClose: () => void;
  onPractise: (event: MouseEvent<HTMLAnchorElement>, game: PractiseGame) => void;
  practiseHref: (game: PractiseGame) => string;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const code = country?.code;
  useEffect(() => {
    bodyRef.current?.closest(".ph-sheet-body")?.scrollTo?.({ top: 0 });
  }, [code]);
  const neighbours = useMemo(() => (country ? neighboursOf(country, all) : null), [country, all]);
  if (!country) return <BottomSheet open={false} onClose={onClose} title="">{null}</BottomSheet>;

  const note = statusNote(country);
  const facts = factsOf(country);
  const hideCapital = study && !revealed;

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={country.name}
      footer={
        country.region ? (
          <div className="ph-explore-sheet-practise">
            <p>Practise {country.region}</p>
            <div className="ph-explore-practise-row">
              <LinkGameButton
                variant="tone"
                tone="flags"
                size="md"
                to={practiseHref("flags")}
                onClick={(event) => onPractise(event, "flags")}
              >
                Flags
              </LinkGameButton>
              <LinkGameButton
                variant="tone"
                tone="capitals"
                size="md"
                to={practiseHref("capitals")}
                onClick={(event) => onPractise(event, "capitals")}
              >
                Capitals
              </LinkGameButton>
            </div>
          </div>
        ) : undefined
      }
    >
      <div ref={bodyRef} className="ph-explore-detail tone-explorer">
        {backTo && (
          <button type="button" className="ph-explore-back" onClick={onBack}>
            <Icon name="chevronLeft" size={18} /> Back to {backTo}
          </button>
        )}
        <Flag country={country} size="large" eager />
        {country.officialName && country.officialName !== country.name && (
          <p className="ph-explore-official">{country.officialName}</p>
        )}
        {note && <p className="ph-explore-status">{note}</p>}

        <div className="ph-explore-capital">
          <span className="ph-explore-label">Capital</span>
          {hideCapital ? (
            <button type="button" className="ph-explore-reveal is-large" aria-pressed={false} onClick={onReveal}>
              Tap to reveal
            </button>
          ) : (
            <strong>{country.capital || "None listed"}</strong>
          )}
        </div>

        {facts.length > 0 && (
          <dl className="ph-explore-facts">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <section className="ph-explore-block">
          <h3>Neighbours</h3>
          {neighbours === null ? (
            <p className="ph-explore-muted">No border data in this catalog.</p>
          ) : neighbours.length === 0 ? (
            <p className="ph-explore-muted">No land neighbours.</p>
          ) : (
            <ul className="ph-explore-neighbours">
              {neighbours.map((item) => (
                <li key={item.key}>
                  {item.country ? (
                    <button
                      type="button"
                      className="ph-explore-neighbour"
                      onClick={() => onNeighbour((item.country as ExplorerCountry).code)}
                    >
                      <Flag country={item.country} size="chip" />
                      {item.name}
                    </button>
                  ) : (
                    <span className="ph-explore-neighbour is-static">{item.name}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {country.flag && (
          <section className="ph-explore-block">
            <h3>About the flag</h3>
            <p>{country.flag}</p>
          </section>
        )}
      </div>
    </BottomSheet>
  );
}
