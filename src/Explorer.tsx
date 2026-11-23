import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import type { ExplorerCountry } from "./domain";
import alpha3CountryNames from "./alpha3-country-names.json";

const PAGE_SIZE = 24;
const PRACTICE_QUESTION_COUNT = 4;
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const numberFormat = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
type SortOrder = "name" | "region" | "population" | "area";
const sortLabels: Record<SortOrder, string> = { name: "Name", region: "Region", population: "Population", area: "Area" };

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function displayText(value: string | null | undefined) {
  return value?.trim() || "Not available";
}

function getHttpsUrl(value: string | null | undefined, hosts?: string[]) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (hosts && !hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    return url.href;
  } catch { return null; }
}

function getFlagCandidates(country: ExplorerCountry) {
  const code = country.code.trim().toUpperCase();
  const localFlag = country.catalogKind !== "non_iso" && /^[A-Z]{2}$/.test(code) ? `/flags/${code.toLowerCase()}.svg` : null;
  const remoteFlags = [country.flagSvgUrl, country.flagPngUrl]
    .map(value => getHttpsUrl(value, ["flags.restcountries.com"]))
    .filter((value): value is string => Boolean(value));
  return [...new Set([...(localFlag ? [localFlag] : []), ...remoteFlags])];
}

const isUnMember = (country: ExplorerCountry) =>
  Boolean(country.memberships?.some(item => item.member && /united[ _]nations|^un$/i.test(item.name)));

function CountryFlag({ country, eager = false, priority = false, size = "card" }: {
  country: ExplorerCountry; eager?: boolean; priority?: boolean; size?: "card" | "hero";
}) {
  const candidates = getFlagCandidates(country);
  const [candidateIndex, setCandidateIndex] = useState(0);
  useEffect(() => setCandidateIndex(0), [candidates.join("|")]);
  const url = candidates[candidateIndex];
  return (
    <span className={`explorer-flag is-${size}`}>
      {url ? (
        <img
          src={url}
          alt={`Flag of ${country.name}`}
          {...({ fetchpriority: priority ? "high" : "auto" } as Record<string, string>)}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setCandidateIndex(index => index + 1)}
        />
      ) : country.flagEmoji ? (
        <span className="explorer-flag-emoji" role="img" aria-label={`Flag of ${country.name}`}>{country.flagEmoji}</span>
      ) : (
        <span className="explorer-flag-missing" aria-label={`Flag unavailable for ${country.name}`}>No flag</span>
      )}
    </span>
  );
}

function CountryCard({ country, eagerFlag, onOpen }: { country: ExplorerCountry; eagerFlag: boolean; onOpen: () => void }) {
  return (
    <button type="button" className="explorer-card" onClick={onOpen} aria-label={`${country.name} – show details`}>
      <CountryFlag country={country} eager={eagerFlag} priority={eagerFlag} />
      <span className="explorer-card-body">
        <span className="explorer-card-region">{displayText(country.region)}</span>
        <span className="explorer-card-name">{country.name}</span>
        <span className="explorer-card-facts">
          <span><span aria-hidden="true">🏛</span> {displayText(country.capital)}</span>
          {country.population != null && Number.isFinite(country.population) && (
            <span><span aria-hidden="true">👥</span> {compactFormat.format(country.population)}</span>
          )}
        </span>
      </span>
      <span className="explorer-card-code" aria-hidden="true">{country.catalogKind === "non_iso" ? "—" : country.code}</span>
    </button>
  );
}

function Fact({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="explorer-fact">
      <span className="explorer-fact-icon" aria-hidden="true">{icon}</span>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function CountryDetail({ country, countriesByAlpha3, onClose, onOpen, onStep, position }: {
  country: ExplorerCountry;
  countriesByAlpha3: Map<string, ExplorerCountry>;
  onClose: () => void;
  onOpen: (code: string) => void;
  onStep: (delta: number) => void;
  position: { index: number; total: number };
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const actions = useRef({ onClose, onStep });
  actions.current = { onClose, onStep };
  useEffect(() => {
    const onClose = () => actions.current.onClose();
    const onStep = (delta: number) => actions.current.onStep(delta);
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight" && !(event.target instanceof HTMLInputElement)) onStep(1);
      else if (event.key === "ArrowLeft" && !(event.target instanceof HTMLInputElement)) onStep(-1);
      else if (event.key === "Tab") {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]");
        if (!focusable?.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, []);
  useEffect(() => { if (dialogRef.current) dialogRef.current.scrollTop = 0; }, [country.code]);

  const questionCount = country.practiceQuestionCount;
  const availabilityKnown = typeof questionCount === "number" && Number.isFinite(questionCount);
  const canPractice = availabilityKnown && questionCount >= PRACTICE_QUESTION_COUNT;
  const wikipediaUrl = getHttpsUrl(country.wikipediaUrl, ["wikipedia.org"]);
  const googleMapsUrl = getHttpsUrl(country.googleMapsUrl, ["google.com", "goo.gl", "maps.app.goo.gl"]);
  const nonIsoEntry = country.catalogKind === "non_iso";
  const practiceParams = new URLSearchParams({ mode: "practice", country: country.code, difficulty: country.difficulty });
  const translations = Object.entries(country.translations ?? {}).filter(([, name]) => name.trim());
  const hasMembershipData = Boolean(country.memberships?.length);
  const memberships = (country.memberships ?? []).filter(item => item.member);
  const borders = country.borders;
  const region = country.region ? encodeURIComponent(country.region) : "";
  const facts = [
    { icon: "🏛", label: "Capital", value: displayText(country.capital) },
    { icon: "👥", label: "Population", value: country.population != null && Number.isFinite(country.population) ? numberFormat.format(country.population) : "" },
    { icon: "📐", label: "Area", value: country.areaKm2 != null && Number.isFinite(country.areaKm2) ? `${numberFormat.format(country.areaKm2)} km²` : "" },
    { icon: "🗣", label: "Languages", value: country.languages?.length ? country.languages.join(", ") : "" },
    { icon: "💰", label: "Currency", value: "" },
    { icon: "📞", label: "Calling code", value: country.callingCodes?.length ? country.callingCodes.join(", ") : "" },
  ];
  const currencies = country.currencies?.length
    ? country.currencies.map(item => [item.name, item.symbol].filter(Boolean).join(" ")).join(", ")
    : displayText(country.currency);
  facts[4].value = currencies === "Not available" ? "" : currencies;
  const shownFacts = facts.filter((fact, index) => index === 0 || fact.value);

  return (
    <div className="explorer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="explorer-detail" role="dialog" aria-modal="true" aria-labelledby="explorer-detail-title">
        <header className="explorer-detail-top">
          <div className="explorer-detail-nav">
            <button type="button" className="explorer-icon-button" aria-label="Previous place" disabled={position.index <= 0} onClick={() => onStep(-1)}>‹</button>
            <span>{position.index + 1} / {position.total}</span>
            <button type="button" className="explorer-icon-button" aria-label="Next place" disabled={position.index >= position.total - 1} onClick={() => onStep(1)}>›</button>
          </div>
          <button ref={closeRef} type="button" className="explorer-icon-button" aria-label="Close details" onClick={onClose}>×</button>
        </header>

        <div className="explorer-detail-hero">
          <CountryFlag country={country} eager size="hero" />
          <div className="min-w-0">
            <p className="eyebrow">{displayText(country.region)}{country.catalogKind !== "non_iso" ? ` · ${country.code}${country.codeAlpha3 ? ` / ${country.codeAlpha3}` : ""}` : ""}</p>
            <h2 id="explorer-detail-title" className="explorer-detail-name">{country.name}</h2>
            {country.officialName && country.officialName !== country.name && <p className="muted">{country.officialName}</p>}
            <div className="explorer-badges">
              {isUnMember(country) && <span className="explorer-badge is-un">UN member</span>}
              {nonIsoEntry && <span className="explorer-badge">No official ISO code</span>}
              <span className="explorer-badge">Difficulty: {country.difficulty}</span>
            </div>
          </div>
        </div>

        <dl className="explorer-facts">
          {shownFacts.map((fact) => <Fact key={fact.label} {...fact} />)}
        </dl>

        <section className="explorer-detail-section">
          <h3>Neighbouring countries</h3>
          {borders == null ? <p className="muted">Border data not available</p> : borders.length === 0 ? <p className="muted">No land borders</p> : (
            <ul className="explorer-neighbors">
              {borders.map((rawCode, index) => {
                const code = rawCode.trim().toUpperCase();
                const neighbor = countriesByAlpha3.get(code);
                const knownName = alpha3CountryNames[code as keyof typeof alpha3CountryNames];
                return (
                  <li key={`${code}-${index}`}>
                    {neighbor ? (
                      <button type="button" className="explorer-neighbor" onClick={() => onOpen(neighbor.code)} aria-label={`Show ${neighbor.name} (${code})`}>
                        <CountryFlag country={neighbor} /> {neighbor.name}
                      </button>
                    ) : <span className="explorer-neighbor is-static">{knownName ? `${knownName} (${rawCode})` : rawCode}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {translations.length > 0 && (
          <section className="explorer-detail-section">
            <h3>Names in other languages</h3>
            <ul className="explorer-chip-list">
              {translations.map(([language, name]) => <li key={language}><b>{language}</b> {name}</li>)}
            </ul>
          </section>
        )}

        {hasMembershipData && (
          <section className="explorer-detail-section">
            <h3>Memberships</h3>
            {memberships.length ? (
              <ul className="explorer-chip-list">{memberships.map(item => <li key={item.name}>{item.name.replaceAll("_", " ")}</li>)}</ul>
            ) : <p className="muted">No memberships listed in source</p>}
          </section>
        )}

        <section className="explorer-detail-section">
          <h3>The flag</h3>
          <p>{displayText(country.flag)}</p>
          {country.topLevelDomains?.length ? <p className="muted text-sm mt-2">Internet domain: {country.topLevelDomains.join(", ")}</p> : null}
          <div className="explorer-source-links">
            {wikipediaUrl && <a href={wikipediaUrl} target="_blank" rel="noopener noreferrer">Wikipedia <span aria-hidden="true">↗</span></a>}
            {googleMapsUrl && <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer">Open in Google Maps <span aria-hidden="true">↗</span></a>}
          </div>
          <p className="muted text-xs mt-3">Catalog values and imported links have not been independently verified. Population and membership data may refer to different source dates.</p>
          {nonIsoEntry && <p className="explorer-neutral-note">This entry uses an internal catalog identifier. Its inclusion does not express a position on sovereignty or international recognition.</p>}
        </section>

        <footer className="explorer-detail-actions">
          {canPractice ? (
            <Link className="primary" to={`/quiz?${practiceParams.toString()}`}>Practice this place <span aria-hidden="true">→</span></Link>
          ) : (
            <p className="muted text-xs explorer-practice-note">
              {availabilityKnown ? `Practice needs ${PRACTICE_QUESTION_COUNT} published questions at this difficulty; ${questionCount} available.` : "Practice availability is not available."}
            </p>
          )}
          {country.region && <>
            <Link className="secondary" to={`/flags?mode=flag_to_country&region=${region}`}>Flags of {country.region}</Link>
            <Link className="secondary" to={`/capitals?mode=country_to_capital&region=${region}`}>Capitals of {country.region}</Link>
          </>}
        </footer>
      </section>
    </div>
  );
}

function pageNumbers(currentPage: number, pageCount: number) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(pageCount - 1, currentPage + 1);
  return [1, ...(start > 2 ? ["start-gap"] : []), ...Array.from({ length: end - start + 1 }, (_, index) => start + index), ...(end < pageCount - 1 ? ["end-gap"] : []), pageCount] as (number | string)[];
}

function ExplorerPagination({ currentPage, pageCount, onPage, position, navRef }: {
  currentPage: number; pageCount: number; onPage: (page: number) => void; position: "top" | "bottom"; navRef: (node: HTMLElement | null) => void;
}) {
  const pages = pageNumbers(currentPage, pageCount);
  return <nav ref={navRef} tabIndex={-1} className={`explorer-pagination explorer-pagination-${position}`} aria-label={`${position} catalog pagination`}>
    <button type="button" className="secondary explorer-page-arrow" aria-label="Previous page" disabled={currentPage === 1} onClick={() => onPage(currentPage - 1)}>← Previous</button>
    <div className="explorer-page-list" aria-label={`Page ${currentPage} of ${pageCount}`}>
      {pages.map(page => typeof page === "number"
        ? <button type="button" className={`explorer-page-number ${page === currentPage ? "is-current" : ""}`} aria-label={`Page ${page}`} aria-current={page === currentPage ? "page" : undefined} key={page} onClick={() => onPage(page)}>{page}</button>
        : <span className="explorer-page-ellipsis" aria-hidden="true" key={page}>…</span>)}
    </div>
    <button type="button" className="secondary explorer-page-arrow" aria-label="Next page" disabled={currentPage === pageCount} onClick={() => onPage(currentPage + 1)}>Next →</button>
  </nav>;
}

export default function Explorer() {
  const { data, error, reload } = useLoad<ExplorerCountry[]>(() => api.explore() as Promise<ExplorerCountry[]>);
  const [searchParams, setSearchParams] = useSearchParams();
  const queryParam = searchParams.get("q") ?? "";
  const openCode = searchParams.get("place");
  const [search, setSearch] = useState(queryParam);
  const [region, setRegion] = useState("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("name");
  const [page, setPage] = useState(1);
  const topPaginationRef = useRef<HTMLElement | null>(null);
  const bottomPaginationRef = useRef<HTMLElement | null>(null);
  const lastQueryParam = useRef(queryParam);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (queryParam === lastQueryParam.current) return;
    lastQueryParam.current = queryParam;
    setSearch(queryParam);
    setRegion("all");
    setPage(1);
  }, [queryParam]);

  const countriesByAlpha3 = useMemo(() => {
    const entries = new Map<string, ExplorerCountry>();
    for (const country of data ?? []) {
      const code = country.codeAlpha3?.trim().toUpperCase();
      if (code) entries.set(code, country);
    }
    return entries;
  }, [data]);

  const regions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const country of data ?? []) if (country.region) counts.set(country.region, (counts.get(country.region) ?? 0) + 1);
    return [...counts].sort((a, b) => collator.compare(a[0], b[0]));
  }, [data]);

  const filtered = useMemo(() => {
    const query = normalize(search);
    const countries = data ?? [];
    const exactCodeMatches = query ? countries.filter(country =>
      normalize(country.code) === query || normalize(country.codeAlpha3 ?? "") === query
    ) : [];
    const searchPool = exactCodeMatches.length ? exactCodeMatches : countries;
    const number = (value: number | null | undefined) => (value != null && Number.isFinite(value) ? value : -1);
    return searchPool.filter(country => {
      const searchable = normalize([
        country.name, country.officialName, country.capital, country.code,
        country.codeAlpha3 ?? "",
        ...(country.languages ?? []), ...Object.values(country.translations ?? {}),
        ...(country.currencies ?? []).flatMap(currency => [currency.name, currency.code ?? ""]),
      ].filter(Boolean).join(" "));
      return (region === "all" || country.region === region) && (!query || searchable.includes(query));
    }).sort((a, b) =>
      sortOrder === "region" ? collator.compare(a.region, b.region) || collator.compare(a.name, b.name)
      : sortOrder === "population" ? number(b.population) - number(a.population) || collator.compare(a.name, b.name)
      : sortOrder === "area" ? number(b.areaKm2) - number(a.areaKm2) || collator.compare(a.name, b.name)
      : collator.compare(a.name, b.name));
  }, [data, search, region, sortOrder]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(offset, offset + PAGE_SIZE);
  const hasFilters = search.trim() !== "" || region !== "all";
  const opened = openCode ? (data ?? []).find(country => country.code === openCode) : undefined;
  const openedIndex = opened ? filtered.indexOf(opened) : -1;
  const unMembers = (data ?? []).filter(isUnMember).length;

  function open(code: string | null) {
    const next = new URLSearchParams(searchParams);
    if (code) {
      if (!openCode) returnFocus.current = document.activeElement as HTMLElement;
      next.set("place", code);
    } else next.delete("place");
    setSearchParams(next, { replace: Boolean(openCode && code) });
    if (!code) window.setTimeout(() => returnFocus.current?.focus(), 0);
  }
  function step(delta: number) {
    if (openedIndex < 0) return;
    const target = filtered[openedIndex + delta];
    if (!target) return;
    open(target.code);
    const targetPage = Math.floor((openedIndex + delta) / PAGE_SIZE) + 1;
    if (targetPage !== currentPage) setPage(targetPage);
  }
  function clearFilters() { setSearch(""); setRegion("all"); setPage(1); }
  function changePage(nextPage: number, position: "top" | "bottom") {
    setPage(Math.max(1, Math.min(nextPage, pageCount)));
    requestAnimationFrame(() => {
      const nav = position === "top" ? topPaginationRef.current : bottomPaginationRef.current;
      nav?.scrollIntoView({ block: "nearest", behavior: "auto" });
      requestAnimationFrame(() => nav?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus({ preventScroll: true }));
    });
  }

  if (!data) return error ? <ErrorBox message={error} retry={reload} /> : <Loading />;

  return <div className="explorer-shell">
    <header className="explorer-hero">
      <div>
        <p className="eyebrow">WORLD EXPLORER</p>
        <h1 tabIndex={-1} className="heading mt-2">Every place has a story.</h1>
        <p className="muted mt-3">Browse every country and territory in the atlas – flags, capitals, languages, neighbours and more. Open a place to learn about it, then practise it in the games.</p>
      </div>
      <dl className="explorer-stats">
        <div><dt>Places</dt><dd>{data.length}</dd></div>
        <div><dt>Regions</dt><dd>{regions.length}</dd></div>
        {unMembers > 0 && <div><dt>UN members</dt><dd>{unMembers}</dd></div>}
      </dl>
    </header>

    <section className="explorer-filters card mt-6" aria-label="Filter the world catalog">
      <div className="explorer-search-row">
        <label className="explorer-search">
          <span className="sr-only">Find a place or capital</span>
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" value={search} placeholder="Try Canada, Ottawa, or CA…" autoComplete="off"
            onChange={event => { setSearch(event.target.value); setPage(1); }} />
        </label>
        <div className="segmented explorer-sort" role="group" aria-label="Sort places">
          {(Object.keys(sortLabels) as SortOrder[]).map(order => (
            <button key={order} type="button" aria-pressed={sortOrder === order} aria-label={`Sort by ${sortLabels[order].toLowerCase()}`}
              onClick={() => { setSortOrder(order); setPage(1); }}>{sortLabels[order]}</button>
          ))}
        </div>
      </div>
      <div className="chips mt-4" role="group" aria-label="Region">
        <button type="button" className="chip" aria-pressed={region === "all"} onClick={() => { setRegion("all"); setPage(1); }}>
          All regions <span>{data.length}</span>
        </button>
        {regions.map(([name, count]) => (
          <button key={name} type="button" className="chip" aria-pressed={region === name} onClick={() => { setRegion(name); setPage(1); }}>
            {name} <span>{count}</span>
          </button>
        ))}
      </div>
    </section>

    <div className="explorer-meta">
      <p className="muted" role="status">{filtered.length === 0 ? `0 of ${data.length} places` : `Showing ${offset + 1}–${offset + visible.length} of ${filtered.length} places`}</p>
      {hasFilters && <button type="button" className="text-button" onClick={clearFilters}>Clear filters</button>}
    </div>

    {pageCount > 1 && <ExplorerPagination currentPage={currentPage} pageCount={pageCount} onPage={next => changePage(next, "top")} position="top" navRef={node => { topPaginationRef.current = node; }} />}

    {!filtered.length && <div className="empty-state"><span className="empty-icon" aria-hidden="true">⌕</span><h2 className="text-lg font-bold mt-3">{data.length ? "No places match those filters" : "The catalog is empty"}</h2><p className="muted mt-2">{data.length ? "Try another name or choose a different region." : "No catalog entries were returned by the backend."}</p>{hasFilters && <button type="button" className="secondary mt-4" onClick={clearFilters}>Show all places</button>}</div>}

    <div className="explorer-grid">
      {visible.map((country, index) => <CountryCard key={country.code} country={country} eagerFlag={index === 0} onOpen={() => open(country.code)} />)}
    </div>

    {pageCount > 1 && <ExplorerPagination currentPage={currentPage} pageCount={pageCount} onPage={next => changePage(next, "bottom")} position="bottom" navRef={node => { bottomPaginationRef.current = node; }} />}
    <p className="muted text-xs mt-8">Catalog entries can be explored without published quiz questions. Practice is offered only when enough matching questions are available.</p>

    {opened && <CountryDetail country={opened} countriesByAlpha3={countriesByAlpha3} onClose={() => open(null)} onOpen={code => open(code)}
      onStep={step} position={openedIndex < 0 ? { index: 0, total: 1 } : { index: openedIndex, total: filtered.length }} />}
  </div>;
}
