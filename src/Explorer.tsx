import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import type { ExplorerCountry } from "./domain";

const PAGE_SIZE = 24;
const PRACTICE_QUESTION_COUNT = 4;
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const numberFormat = new Intl.NumberFormat("en-US");
type SortOrder = "name" | "region";

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
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
  return [country.flagSvgUrl, country.flagPngUrl]
    .map(value => getHttpsUrl(value, ["flags.restcountries.com"]))
    .filter((value): value is string => Boolean(value));
}

function CountryFlag({ country, eager = false, priority = false }: { country: ExplorerCountry; eager?: boolean; priority?: boolean }) {
  const candidates = getFlagCandidates(country);
  const [candidateIndex, setCandidateIndex] = useState(0);
  useEffect(() => setCandidateIndex(0), [candidates.join("|")]);
  const url = candidates[candidateIndex];

  return (
    <div className="explorer-flag">
      {url ? (
        <img
          src={url}
          alt={`Flag of ${country.name}`}
          {...({ fetchpriority: priority ? "high" : "auto" } as Record<string, string>)}
          width={72}
          height={48}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setCandidateIndex(index => index + 1)}
        />
      ) : country.flagEmoji ? (
        <span className="explorer-flag-emoji" role="img" aria-label={`Flag of ${country.name}`}>{country.flagEmoji}</span>
      ) : (
        <span className="muted text-xs" aria-label={`Flag unavailable for ${country.name}`}>No flag</span>
      )}
    </div>
  );
}

function CountryCard({ country, countries, eagerFlag = false, priorityFlag = false }: {
  country: ExplorerCountry;
  countries: Map<string, ExplorerCountry>;
  eagerFlag?: boolean;
  priorityFlag?: boolean;
}) {
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
  const neighbors = country.neighbors ?? [];

  return (
    <article className="card country-card">
      <header className="explorer-country-header">
        <CountryFlag country={country} eager={eagerFlag} priority={priorityFlag} />
        <div className="min-w-0">
          <p className="eyebrow">{displayText(country.region)}</p>
          <h2 className="text-lg font-bold mt-1 explorer-country-name">{country.name}</h2>
          {nonIsoEntry && <p className="muted text-xs mt-1">Non-ISO catalog entry</p>}
        </div>
      </header>

      <dl className="explorer-card-facts mt-4">
        <div><dt>Capital</dt><dd>{displayText(country.capital)}</dd></div>
      </dl>

      <details className="explorer-country-details">
        <summary>Details <span className="muted">for {country.name}</span></summary>
        <div className="explorer-details-body">
          <section className="explorer-detail-section">
            <h3>People and place</h3>
            <dl className="explorer-detail-grid">
              <div><dt>Official name in source</dt><dd>{displayText(country.officialName)}</dd></div>
              <div><dt>Population · source value</dt><dd>{country.population != null && Number.isFinite(country.population) ? numberFormat.format(country.population) : "Not available"}</dd></div>
              <div><dt>Area</dt><dd>{country.areaKm2 != null && Number.isFinite(country.areaKm2) ? `${numberFormat.format(country.areaKm2)} km²` : "Not available"}</dd></div>
              <div><dt>Languages</dt><dd>{country.languages?.length ? country.languages.join(", ") : "Not available"}</dd></div>
              <div><dt>Names in other languages</dt><dd>{translations.length ? translations.map(([language, name]) => `${name} (${language})`).join(", ") : "Not available"}</dd></div>
            </dl>
          </section>

          <section className="explorer-detail-section">
            <h3>Currency and connections</h3>
            <dl className="explorer-detail-grid">
              <div><dt>Currencies</dt><dd>{country.currencies?.length ? country.currencies.map(item => [item.name, item.code, item.symbol].filter(Boolean).join(" · ")).join(", ") : displayText(country.currency)}</dd></div>
              <div><dt>Calling codes</dt><dd>{country.callingCodes?.length ? country.callingCodes.join(", ") : "Not available"}</dd></div>
              <div><dt>Internet domains</dt><dd>{country.topLevelDomains?.length ? country.topLevelDomains.join(", ") : "Not available"}</dd></div>
              <div className="explorer-neighbor-field">
                <dt>Neighboring catalog entries</dt>
                <dd>{neighbors.length ? <ul className="explorer-neighbors">{neighbors.map(neighbor => {
                  return <li key={neighbor.alpha3}>{neighbor.name && neighbor.code ? <Link to={`/explorer?q=${encodeURIComponent(neighbor.code)}`} aria-label={`Find ${neighbor.name} in the catalog`}>{neighbor.name}</Link> : <span>{neighbor.alpha3} · not in this catalog</span>}</li>;
                })}</ul> : "Not available"}</dd>
              </div>
            </dl>
          </section>

          <section className="explorer-detail-section">
            <h3>Memberships</h3>
            <p>{memberships.length ? memberships.map(item => item.name.replaceAll("_", " ")).join(", ") : hasMembershipData ? "No memberships listed in source" : "Not available"}</p>
          </section>

          <section className="explorer-detail-section">
            <h3>Flag and links</h3>
            <p>{displayText(country.flag)}</p>
            <p className="muted text-xs mt-2">Catalog values and imported links have not been independently verified. Population and membership data may refer to different source dates.</p>
            <div className="explorer-source-links">
              {wikipediaUrl && <a href={wikipediaUrl} target="_blank" rel="noopener noreferrer">Wikipedia link from source <span aria-hidden="true">↗</span></a>}
              {googleMapsUrl && <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer">Open in Google Maps <span aria-hidden="true">↗</span></a>}
            </div>
          </section>

          {nonIsoEntry && <p className="explorer-neutral-note">This entry uses an internal catalog identifier. Its inclusion does not express a position on sovereignty or international recognition.</p>}
        </div>
      </details>

      <footer className="explorer-country-footer">
        {canPractice ? <>
          <p className="muted text-xs mb-2">{questionCount} published questions · {country.difficulty}</p>
          <Link className="secondary country-action w-full" to={`/home?${practiceParams.toString()}`}>Practice this place <span aria-hidden="true">→</span></Link>
        </> : <p className="muted text-xs">{availabilityKnown ? `Practice needs ${PRACTICE_QUESTION_COUNT} published questions at this difficulty; ${questionCount} available.` : "Practice availability is not available."}</p>}
      </footer>
    </article>
  );
}

export default function Explorer() {
  const { data, error, reload } = useLoad<ExplorerCountry[]>(() => api.explore() as Promise<ExplorerCountry[]>);
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [region, setRegion] = useState("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("name");
  const [page, setPage] = useState(1);
  const collectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = searchParams.get("q") ?? "";
    setSearch(query);
    setRegion("all");
    setPage(1);
  }, [searchParams]);

  const countriesByCode = useMemo(() => new Map((data ?? []).map(country => [country.code, country])), [data]);
  const regions = useMemo(() => [...new Set((data ?? []).map(country => country.region).filter(Boolean))].sort(collator.compare), [data]);
  const filtered = useMemo(() => {
    const query = normalize(search);
    return (data ?? []).filter(country => {
      const searchable = normalize([
        country.name, country.officialName, country.capital, country.code,
        ...(country.languages ?? []), ...Object.values(country.translations ?? {}),
        ...(country.currencies ?? []).flatMap(currency => [currency.name, currency.code ?? ""]),
      ].filter(Boolean).join(" "));
      return (region === "all" || country.region === region) && (!query || searchable.includes(query));
    }).sort((a, b) => sortOrder === "region" ? collator.compare(a.region, b.region) || collator.compare(a.name, b.name) : collator.compare(a.name, b.name));
  }, [data, search, region, sortOrder]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(offset, offset + PAGE_SIZE);
  const hasFilters = search.trim() !== "" || region !== "all";

  function clearFilters() { setSearch(""); setRegion("all"); setPage(1); }
  function changePage(nextPage: number) {
    setPage(Math.max(1, Math.min(nextPage, pageCount)));
    requestAnimationFrame(() => {
      collectionRef.current?.focus({ preventScroll: true });
      collectionRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }

  if (!data) return error ? <ErrorBox message={error} retry={reload} /> : <Loading />;

  return <div className="explorer-shell">
    <header className="page-intro explorer-intro">
      <div><p className="eyebrow">WORLD EXPLORER</p><h1 tabIndex={-1} className="heading mt-2">Every place has a story.</h1></div>
      <p className="muted">Explore countries, territories, and other catalog entries. Discover somewhere new, one place at a time.</p>
    </header>

    <section className="explorer-filters card mt-6" aria-label="Filter the world catalog">
      <div className="explorer-filter-grid">
        <label>Find a place or capital
          <input type="search" value={search} placeholder="Try Canada, Ottawa, or CA…" autoComplete="off" onChange={event => { setSearch(event.target.value); setPage(1); }} />
        </label>
        <label>Region
          <select value={region} onChange={event => { setRegion(event.target.value); setPage(1); }}>
            <option value="all">All regions</option>{regions.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>Sort by
          <select value={sortOrder} onChange={event => { setSortOrder(event.target.value as SortOrder); setPage(1); }}>
            <option value="name">Name · A–Z</option><option value="region">Region, then name</option>
          </select>
        </label>
      </div>
      {hasFilters && <button type="button" className="secondary mt-4" onClick={clearFilters}>Clear filters</button>}
    </section>

    <div ref={collectionRef} tabIndex={-1} className="collection-meta explorer-collection-meta my-5">
      <p className="muted" role="status">{filtered.length === 0 ? `0 of ${data.length} places` : `Showing ${offset + 1}–${offset + visible.length} of ${filtered.length} places`}</p>
      <span className="map-coordinates" aria-hidden="true">ATLAS / EXPLORE</span>
    </div>

    {!filtered.length && <div className="empty-state"><span className="empty-icon" aria-hidden="true">⌕</span><h2 className="text-lg font-bold mt-3">{data.length ? "No places match those filters" : "The catalog is empty"}</h2><p className="muted mt-2">{data.length ? "Try another name or choose a different region." : "No catalog entries were returned by the backend."}</p>{hasFilters && <button type="button" className="secondary mt-4" onClick={clearFilters}>Show all places</button>}</div>}

    <div className="country-grid explorer-country-grid">
      {visible.map((country, index) => <CountryCard key={country.code} country={country} countries={countriesByCode} eagerFlag={index === 0} priorityFlag={index === 0} />)}
    </div>

    {pageCount > 1 && <nav className="explorer-pagination mt-8" aria-label="Country catalog pages">
      <button type="button" className="secondary" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>← Previous</button>
      <p className="muted text-sm" aria-live="polite">Page {currentPage} of {pageCount}</p>
      <button type="button" className="secondary" disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)}>Next →</button>
    </nav>}
    <p className="muted text-xs mt-8">Catalog entries can be explored without published quiz questions. Practice is offered only when enough matching questions are available.</p>
  </div>;
}
