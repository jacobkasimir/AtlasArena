import { useState } from "react";

type RecallKind = "countries" | "capitals" | "Cities";

export default function RecallSetup() {
  const [kind, setKind] = useState<RecallKind>("countries");

  return (<section className="card">
    <h1 className="heading">Atlas Recall</h1>
    <p className="muted mt-2">What do you want to recall?</p>

    <div className="grid grid-cols-2 gap-3 mt-6" role="group" aria-label="Choose what to recall">
      <button
        type="button"
        className={kind === "countries" ? "primary" : "secondary"}
        aria-pressed={kind === "countries"}
        onClick={() => setKind("countries")}
      >
        Countries
      </button>
      <button
        type="button"
        className={kind === "capitals" ? "primary" : "secondary"}
        aria-pressed={kind === "capitals"}
        onClick={() => setKind("capitals")}
      >
        Capitals
      </button>
      <button
        type="button"
        className={kind === "Cities" ? "primary" : "secondary"}
        aria-pressed={kind === "Cities"}
        onClick={() => setKind("Cities")}
      >
        Cities
      </button>
    </div>

    <p className="muted mt-4">
      Selected: {kind === "countries" ? "Countries" : kind === "capitals" ? "Capitals" : "Cities"}
    </p>
  </section>
  );
}