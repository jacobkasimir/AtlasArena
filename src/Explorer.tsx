import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import type { ExplorerCountry } from "./domain";

const PAGE_SIZE = 24;
const PRACTICE_QUESTION_COUNT = 4;

const collator = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
});

const numberFormat = new Intl.NumberFormat("en-US");

type SortOrder = "name" | "region";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function displayText(value: string | null | undefined) {
  return value?.trim() || "Not available";
}

function getWikipediaUrl(value: string | null | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      !(
        url.hostname === "wikipedia.org" ||
        url.hostname.endsWith(".wikipedia.org")
      ) ||
      url.username ||
      url.password
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function getFlagUrl(country: ExplorerCountry) {
  const candidates = [country.flagSvgUrl, country.flagPngUrl];

  for (const candidate of candidates) {
    if (!candidate) continue;

    try {
      const url = new URL(candidate, window.location.origin);

      const isLocalAsset = url.origin === window.location.origin;
      const isApprovedCdn =
        url.protocol === "https:" &&
        url.hostname === "flags.restcountries.com";

      if (
        (isLocalAsset || isApprovedCdn) &&
        !url.username &&
        !url.password
      ) {
        return url.href;
      }
    } catch {
      // Try the next candidate; never render an invalid URL.
    }
  }

  return null;
}

function CountryFlag({ country }: { country: ExplorerCountry }) {
  const url = getFlagUrl(country);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  return (
    <div className="explorer-flag">
      {url && !failed ? (
        <img
          src={url}
          alt={`Flag of ${country.name}`}
          width={72}
          height={48}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : country.flagEmoji ? (
        <span
          className="explorer-flag-emoji"
          role="img"
          aria-label={`Flag of ${country.name}`}
        >
          {country.flagEmoji}
        </span>
      ) : (
        <span className="muted text-xs">No flag</span>
      )}
    </div>
  );
}

function CountryCard({ country }: { country: ExplorerCountry }) {
  const questionCount = country.practiceQuestionCount;
  const availabilityKnown =
    typeof questionCount === "number" &&
    Number.isFinite(questionCount);

  const canPractice =
    availabilityKnown &&
    questionCount >= PRACTICE_QUESTION_COUNT;

  const wikipediaUrl = getWikipediaUrl(country.wikipediaUrl);
  const nonIso = country.catalogKind === "non_iso";

  const languages = [
    ...new Set(
      (country.languages ?? []).filter(
        (language): language is string =>
          typeof language === "string" && language.trim().length > 0
      )
    ),
  ];

  const hasPopulation =
    typeof country.population === "number" &&
    Number.isFinite(country.population) &&
    country.population >= 0;

  const practiceParams = new URLSearchParams({
    mode: "practice",
    country: country.code,
    difficulty: country.difficulty,
  });

  return (
    <article className="card country-card">
      <header className="explorer-country-header">
        <CountryFlag country={country} />

        <div className="min-w-0">
          <p className="eyebrow">{country.region}</p>

          <h2 className="text-xl font-bold mt-2 explorer-country-name">
            {country.name}
          </h2>

          {!nonIso && (
            <p className="muted text-xs mt-1">
              Country code: {country.code}
            </p>
          )}
        </div>
      </header>

      {nonIso && (
        <p className="explorer-tag muted text-xs mt-4">
          Catalog entry without an ISO alpha-2 code
        </p>
      )}

      <dl className="explorer-country-facts mt-5">
        <div>
          <dt className="muted text-sm">Capital / capitals</dt>
          <dd>{displayText(country.capital)}</dd>
        </div>

        <div>
          <dt className="muted text-sm">Currency / currencies</dt>
          <dd>{displayText(country.currency)}</dd>
        </div>
      </dl>

      <details className="explorer-country-details mt-4">
        <summary>
          More about {country.name}
        </summary>

        <div className="explorer-details-body">
          <dl className="explorer-country-facts">
            {country.officialName &&
              country.officialName !== country.name && (
                <div>
                  <dt className="muted text-sm">
                    Official name in source
                  </dt>
                  <dd>{country.officialName}</dd>
                </div>
              )}

            <div>
              <dt className="muted text-sm">
                Population · source value
              </dt>
              <dd>
                {hasPopulation
                  ? numberFormat.format(country.population!)
                  : "Not available"}
              </dd>
            </div>

            <div>
              <dt className="muted text-sm">Languages</dt>
              <dd>
                {languages.length
                  ? languages.join(", ")
                  : "Not available"}
              </dd>
            </div>

            <div>
              <dt className="muted text-sm">Flag description</dt>
              <dd>{displayText(country.flag)}</dd>
            </div>
          </dl>

          {nonIso && (
            <p className="muted text-sm mt-4">
              This entry uses an internal Atlas Arena identifier.
              Inclusion in the catalog does not imply a position on
              sovereignty or international recognition.
            </p>
          )}

          <p className="muted text-xs mt-4">
            Values come from the imported dataset. Reference dates
            may differ; population and currency information can change.
          </p>

          {wikipediaUrl && (
            <a
              className="secondary mt-4"
              href={wikipediaUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Read about ${country.name} on Wikipedia, opens in a new tab`}
            >
              Read on Wikipedia
              <span aria-hidden="true"> ↗</span>
            </a>
          )}
        </div>
      </details>

      <footer className="explorer-country-footer">
        {canPractice ? (
          <>
            <p className="muted text-xs mb-3">
              Four questions · {country.difficulty} · no time limit
            </p>

            <Link
              className="secondary country-action w-full"
              to={`/home?${practiceParams.toString()}`}
            >
              Practice this place
              <span aria-hidden="true"> →</span>
            </Link>
          </>
        ) : (
          <p className="muted text-sm">
            {availabilityKnown
              ? `Practice needs ${PRACTICE_QUESTION_COUNT} published questions at this difficulty; ${questionCount} available.`
              : "Practice availability is not available."}
          </p>
        )}
      </footer>
    </article>
  );
}

export default function Explorer() {
  const { data, error, reload } = useLoad<ExplorerCountry[]>(
    () => api.explore() as Promise<ExplorerCountry[]>
  );

  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("name");
  const [page, setPage] = useState(1);

  const collectionRef = useRef<HTMLDivElement>(null);

  const regions = useMemo(
    () =>
      [...new Set((data ?? []).map(country => country.region))]
        .filter(Boolean)
        .sort(collator.compare),
    [data]
  );

  const filtered = useMemo(() => {
    const query = normalize(search);

    return (data ?? [])
      .filter(country => {
        const matchesRegion =
          region === "all" || country.region === region;

        const searchable = normalize(
          [
            country.name,
            country.officialName,
            country.capital,
            country.code,
          ]
            .filter(Boolean)
            .join(" ")
        );

        return matchesRegion && (!query || searchable.includes(query));
      })
      .sort((a, b) => {
        if (sortOrder === "region") {
          const byRegion = collator.compare(a.region, b.region);
          if (byRegion !== 0) return byRegion;
        }

        return collator.compare(a.name, b.name);
      });
  }, [data, search, region, sortOrder]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(offset, offset + PAGE_SIZE);

  const hasFilters = search.trim() !== "" || region !== "all";

  function clearFilters() {
    setSearch("");
    setRegion("all");
    setPage(1);
  }

  function changePage(nextPage: number) {
    setPage(Math.max(1, Math.min(nextPage, pageCount)));

    requestAnimationFrame(() => {
      collectionRef.current?.focus({ preventScroll: true });
      collectionRef.current?.scrollIntoView({
        block: "start",
        behavior: "auto",
      });
    });
  }

  if (!data) {
    return error
      ? <ErrorBox message={error} retry={reload} />
      : <Loading />;
  }

  return (
    <div className="explorer-shell">
      <header className="page-intro">
        <div>
          <p className="eyebrow">WORLD EXPLORER</p>

          <h1 tabIndex={-1} className="heading mt-2">
            Every place has a story.
          </h1>
        </div>

        <p className="muted">
          Explore countries, territories, and other catalog entries.
          Discover somewhere new, one place at a time.
        </p>
      </header>

      <section
        className="explorer-filters card mt-6"
        aria-label="Filter the world catalog"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr]">
          <label>
            Find a place or capital

            <input
              type="search"
              value={search}
              placeholder="Try Canada, Ottawa, or CA…"
              autoComplete="off"
              onChange={event => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>

          <label>
            Region

            <select
              value={region}
              onChange={event => {
                setRegion(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All regions</option>

              {regions.map(item => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label>
            Sort by

            <select
              value={sortOrder}
              onChange={event => {
                setSortOrder(event.target.value as SortOrder);
                setPage(1);
              }}
            >
              <option value="name">Name · A–Z</option>
              <option value="region">Region, then name</option>
            </select>
          </label>
        </div>

        {hasFilters && (
          <button
            type="button"
            className="secondary mt-4"
            onClick={clearFilters}
          >
            Clear filters
          </button>
        )}
      </section>

      <div
        ref={collectionRef}
        tabIndex={-1}
        className="collection-meta explorer-collection-meta my-5"
      >
        <p className="muted" role="status">
          {filtered.length === 0
            ? `0 of ${data.length} places`
            : `Showing ${offset + 1}–${offset + visible.length} of ${filtered.length} places`}
        </p>

        <span className="map-coordinates" aria-hidden="true">
          ATLAS / EXPLORE
        </span>
      </div>

      {!filtered.length && (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">⌕</span>

          <h2 className="text-lg font-bold mt-3">
            {data.length
              ? "No places match those filters"
              : "The catalog is empty"}
          </h2>

          <p className="muted mt-2">
            {data.length
              ? "Try another name or choose a different region."
              : "No country catalog entries were returned by the backend."}
          </p>

          {hasFilters && (
            <button
              type="button"
              className="secondary mt-4"
              onClick={clearFilters}
            >
              Show all places
            </button>
          )}
        </div>
      )}

      <div className="country-grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {visible.map(country => (
          <CountryCard key={country.code} country={country} />
        ))}
      </div>

      {pageCount > 1 && (
        <nav
          className="explorer-pagination mt-8"
          aria-label="Country catalog pages"
        >
          <button
            type="button"
            className="secondary"
            disabled={currentPage === 1}
            onClick={() => changePage(currentPage - 1)}
          >
            ← Previous
          </button>

          <p className="muted text-sm" aria-live="polite">
            Page {currentPage} of {pageCount}
          </p>

          <button
            type="button"
            className="secondary"
            disabled={currentPage === pageCount}
            onClick={() => changePage(currentPage + 1)}
          >
            Next →
          </button>
        </nav>
      )}

      <p className="muted text-xs mt-8">
        Catalog entries can be explored without published quiz questions.
        Practice is offered only when enough matching questions are available.
      </p>
    </div>
  );
}