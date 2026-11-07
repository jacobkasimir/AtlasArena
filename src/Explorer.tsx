import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";

export default function Explorer() {
  const { data, error, reload } = useLoad(() => api.explore());
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("all");
  if (!data) return error?<ErrorBox message={error} retry={reload}/>:<Loading/>;
  const filtered = data.filter(c =>
    (region === "all" || c.region === region)
    && `${c.name} ${c.capital}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="explorer-shell">
    <header className="page-intro">
      <div><p className="eyebrow">WORLD EXPLORER</p><h1 tabIndex={-1} className="heading mt-2">Every place has a story.</h1></div>
      <p className="muted">A curated atlas of places to learn and play.</p>
    </header>
    <div className="explorer-filters card grid sm:grid-cols-2 gap-4 mt-6">
      <label>Find a country or capital<input type="search" value={search} aria-label="Find a country or capital"
        onChange={e => setSearch(e.target.value)} placeholder="Try Helsinki…"/></label>
      <label>Region<select value={region} onChange={e => setRegion(e.target.value)}>
        <option value="all">All regions</option>
        {[...new Set(data.map(c => c.region))].sort().map(r => <option key={r}>{r}</option>)}
      </select></label>
    </div>
    <div className="collection-meta my-5"><p className="muted" role="status">{filtered.length} {filtered.length===1?"place":"places"} in this learning collection</p><span className="map-coordinates" aria-hidden="true">ATLAS / 01</span></div>
    {!filtered.length&&<div className="empty-state"><span className="empty-icon" aria-hidden="true">⌕</span><h2 className="text-lg font-bold mt-3">{data.length?"No places match those filters":"No published places yet"}</h2><p className="muted mt-2">{data.length?"Try a different spelling or choose another region.":"The learning collection is currently empty."}</p></div>}
    <div className="country-grid grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {filtered.map(c => <article className="card country-card" key={c.code}>
        <p className="eyebrow">{c.region}</p>
        <h2 className="text-2xl font-bold mt-3">{c.name}</h2>
        <dl className="mt-5">
          <div><dt className="muted text-sm">Capital</dt><dd>{c.capital}</dd></div>
          <div><dt className="muted text-sm">Currency · 2024 reference</dt><dd>{c.currency}</dd></div>
          <div><dt className="muted text-sm">Flag description</dt><dd>{c.flag}</dd></div>
        </dl>
        <Link className="secondary country-action w-full mt-5"
          to={`/home?mode=practice&country=${encodeURIComponent(c.code)}&difficulty=${c.difficulty}`}>
          Practice this country →
        </Link>
      </article>)}
    </div>
  </div>;
}
