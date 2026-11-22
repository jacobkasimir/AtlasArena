import { useMemo, useState } from "react";
import { api } from "./api";
import { ErrorBox, Loading, useLoad } from "./components";
import type { Difficulty } from "./domain";

// Cities are not offered until a city catalog exists in the database.
type RecallKind = "countries" | "capitals";
type DifficultyChoice = Difficulty | "all";

const difficultyChoices: {
  value: DifficultyChoice;
  label: string;
}[] = [
  { value: "all", label: "All difficulties" },
  { value: "easy", label: "Easy" },
];

export default function RecallSetup() {
  const [kind, setKind] = useState<RecallKind>("countries");
  const [difficulty, setDifficulty] =
    useState<DifficultyChoice>("all");
  const [region, setRegion] = useState("all");

  const { data: countries, error, reload } = useLoad(
    () => api.explore()
  );

  const regions = useMemo(
    () =>
      [...new Set(
        (countries ?? [])
          .map(country => country.region)
          .filter(Boolean)
      )].sort(),
    [countries]
  );

  if (!countries) {
    return error
      ? <ErrorBox message={error} retry={reload} />
      : <Loading />;
  }

  return (
    <section className="card">
      <p className="eyebrow">ATLAS RECALL</p>
      <h1 className="heading mt-2">Name every place you know.</h1>

      <div className="mt-8 space-y-8">
        <fieldset>
          <legend className="font-bold mb-3">
            What do you want to recall?
          </legend>

          <div className="flex flex-wrap gap-3">
            {([
              ["countries", "Countries"],
              ["capitals", "Capitals"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={
                  kind === value ? "primary" : "secondary"
                }
                aria-pressed={kind === value}
                onClick={() => setKind(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="font-bold mb-3">
            Difficulty
          </legend>

          <div className="flex flex-wrap gap-3">
            {difficultyChoices.map(choice => (
              <button
                key={choice.value}
                type="button"
                className={
                  difficulty === choice.value
                    ? "primary"
                    : "secondary"
                }
                aria-pressed={
                  difficulty === choice.value
                }
                onClick={() =>
                  setDifficulty(choice.value)
                }
              >
                {choice.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="font-bold mb-3">
            Region
          </legend>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={
                region === "all" ? "primary" : "secondary"
              }
              aria-pressed={region === "all"}
              onClick={() => setRegion("all")}
            >
              All regions
            </button>

            {regions.map(value => (
              <button
                key={value}
                type="button"
                className={
                  region === value
                    ? "primary"
                    : "secondary"
                }
                aria-pressed={region === value}
                onClick={() => setRegion(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <p className="muted mt-8" role="status">
        Selected: {kind === "countries" ? "Countries" : "Capitals"} · {difficulty === "all"
          ? "All difficulties"
          : difficulty} · {region === "all"
          ? "All regions"
          : region}
      </p>
    </section>
  );
}