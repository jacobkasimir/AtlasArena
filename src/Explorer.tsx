import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";

export default function Explorer() {
  const { data, error, reload } = useLoad(() => api.explore());
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("all");
  if (!data) return <><Loading/><ErrorBox message={error} retry={reload}/></>;
  const filtered = data.filter(c =>
    (region === "all" || c.region === region)
    && `${c.name} ${c.capital}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <p className="eyebrow">WORLD EXPLORER</p>
    <h1 tabIndex={-1} className="heading mt-2">Every place has a story.</h1>
    <div className="card grid sm:grid-cols-2 gap-4 mt-6">
      <label>Find a country or capital<input type="search" value={search}
        onChange={e => setSearch(e.target.value)} placeholder="Try Helsinki…"/></label>
      <label>Region<select value={region} onChange={e => setRegion(e.target.value)}>
        <option value="all">All regions</option>
        {[...new Set(data.map(c => c.region))].sort().map(r => <option key={r}>{r}</option>)}
      </select></label>
    </div>
    <p className="muted my-4">{filtered.length} countries in this learning collection.</p>
    {!filtered.length && <p className="card">No matching published learning content. Try another filter.</p>}
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {filtered.map(c => <article className="card" key={c.code}>
        <p className="eyebrow">{c.region}</p>
        <h2 className="text-2xl font-bold mt-3">{c.name}</h2>
        <dl className="mt-4 space-y-3">
          <div><dt className="muted text-sm">Capital</dt><dd>{c.capital}</dd></div>
          <div><dt className="muted text-sm">Currency · 2024 reference</dt><dd>{c.currency}</dd></div>
          <div><dt className="muted text-sm">Flag description</dt><dd>{c.flag}</dd></div>
        </dl>
        <Link className="secondary w-full mt-5"
          to={`/home?mode=practice&country=${encodeURIComponent(c.code)}&difficulty=${c.difficulty}`}>
          Practice this country →
        </Link>
      </article>)}
    </div>
  </>;
}
