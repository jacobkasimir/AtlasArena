// Category Elimination: side sheet listing every place behind a clue's count, one tab per clue step.
// The server only sends these lists once the round is over (see arena_elim_candidates).
// The same sheet shows a mid-round hint (variant "hint"): one list for the open clue only (see arena_elim_hint).
import { KeyboardEvent, useMemo, useRef, useState } from "react";
import { ErrorBox, Loading, useLoad } from "./components";
import type { EliminationCandidates, EliminationColour, EliminationHint } from "./domain";
import {
  CandidateFilter,
  CandidateRow,
  candidatesAt,
  filterCandidates,
  groupByLetter,
  hintErrorText,
  hintRows,
  nextStep,
  stepSummary,
} from "./elimination-domain";
import { isTypingTarget } from "./keys";
import { useModalDialog } from "./useDialog";

const colourNames: Record<EliminationColour, string> = { green: "Green", orange: "Orange", blue: "Blue", purple: "Purple" };
const flag = (code: string) => `/flags/${code.toLowerCase()}.svg`;
const isHint = (data: EliminationCandidates | EliminationHint): data is EliminationHint => "step" in data;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
/** Letter headings only help in longer lists. */
const LETTER_HEADINGS_FROM = 16;

function friendlyError(message: string) {
  if (message.includes("ELIMINATION_CANDIDATES_LOCKED")) return "The full lists unlock when the round is over.";
  return hintErrorText(message);
}

function CandidateItem({ row, step }: { row: CandidateRow; step: number }) {
  const otherPicks = row.pickedAt.filter((picked) => picked !== step);
  const classes = ["elim-cand", `is-${row.status}`, row.pick ? "is-pick" : ""].filter(Boolean).join(" ");
  return (
    <li className={classes}>
      <img src={flag(row.code)} alt="" width={24} height={18} loading="lazy"
        onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
      <span className="elim-cand-name">{row.name}</span>
      {row.status === "ruledOut" && <span className="sr-only"> – ruled out by the next clue</span>}
      {row.pick && <span className="elim-cand-tag is-pick">Your pick</span>}
      {!row.pick && otherPicks.length > 0 && (
        <span className="elim-cand-tag">Your pick for clue {otherPicks.join(" & ")}</span>
      )}
      {row.status === "answer" && <span className="elim-cand-tag is-answer">Answer</span>}
    </li>
  );
}

type StepPanelProps = {
  data: EliminationCandidates;
  step: number;
  query: string;
  setQuery: (query: string) => void;
  filter: CandidateFilter;
  setFilter: (filter: CandidateFilter) => void;
};

/** Search and filter live in the sheet, so they stay put while the player steps through the clues. */
function StepPanel({ data, step, query, setQuery, filter, setFilter }: StepPanelProps) {
  const size = data.steps.length;
  const last = step >= size;
  const rows = useMemo(() => candidatesAt(data, step), [data, step]);
  const summary = useMemo(() => stepSummary(data, step), [data, step]);
  const visible = filterCandidates(rows, query, last ? "all" : filter);
  const sections = visible.length >= LETTER_HEADINGS_FROM ? groupByLetter(visible) : [{ letter: "", rows: visible }];
  const current = data.steps[step - 1];
  const next = data.steps[step];
  const filters: { id: CandidateFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: summary.total },
    { id: "kept", label: "Fit the next clue", count: summary.kept },
    { id: "ruledOut", label: "Ruled out", count: summary.ruledOut },
  ];

  return (
    <div className="elim-sheet-panel">
      <ol className="elim-sheet-chain" aria-label={`Clues 1 to ${step}`}>
        {data.steps.slice(0, step).map((item, index) => (
          <li key={index} className={index + 1 === step ? "is-current" : ""}>
            <span className="elim-sheet-chain-n" aria-hidden="true">{index + 1}</span>
            {item.label}
          </li>
        ))}
      </ol>

      <p className="elim-sheet-summary">
        {last ? (
          <>Only <strong>{plural(summary.total, "place fits", "places fit")}</strong> all {size} clues.</>
        ) : (
          <>
            <strong>{plural(summary.total, "place fits", "places fit")}</strong> {step === 1 ? "clue 1" : `clues 1–${step}`}.
            {next && (
              <> The next clue, <em>{next.label}</em>, keeps {summary.kept} and rules out {summary.ruledOut}.</>
            )}
          </>
        )}
        {summary.total !== current.remaining && <span className="muted"> (The puzzle counted {current.remaining}.)</span>}
      </p>
      <p className="elim-sheet-pick">
        {current.pick ? <>You named <strong>{current.pick.name}</strong> for this clue.</> : "You didn't name a place for this clue."}
      </p>

      {summary.total > 1 && (
        <div className="elim-sheet-tools">
          <label className="elim-sheet-search">
            <span className="sr-only">Search places that fit</span>
            <input type="search" value={query} placeholder="Search places" autoComplete="off" spellCheck={false}
              data-sheet-search="" onChange={(event) => setQuery(event.target.value)} />
          </label>
          {!last && summary.ruledOut > 0 && (
            <div className="elim-sheet-filters" role="group" aria-label="Show">
              {filters.map((item) => (
                <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
                  {item.label} <span className="elim-sheet-filter-count">{item.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {visible.length === rows.length ? plural(rows.length, "place", "places") : `Showing ${visible.length} of ${rows.length} places`}
      </p>
      {visible.length === 0 ? (
        <p className="muted elim-sheet-empty">{query ? `No place matches “${query.trim()}”.` : "Nothing to show."}</p>
      ) : (
        <div className="elim-sheet-list">
          {sections.map((section) => (
            <section key={section.letter || "all"} aria-label={section.letter ? `Starting with ${section.letter}` : undefined}>
              {section.letter && <h3 className="elim-sheet-letter" aria-hidden="true">{section.letter}</h3>}
              <ul className="elim-cands">
                {section.rows.map((row) => <CandidateItem key={row.code} row={row} step={step} />)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** A hint: the places that fit every clue so far in one group. Read-only, no other steps, no "next clue" split. */
function HintPanel({ data, query, setQuery }: { data: EliminationHint; query: string; setQuery: (query: string) => void }) {
  const rows = useMemo(() => hintRows(data), [data]);
  const visible = filterCandidates(rows, query, "all");
  const sections = visible.length >= LETTER_HEADINGS_FROM ? groupByLetter(visible) : [{ letter: "", rows: visible }];
  const step = data.step;

  return (
    <div className="elim-sheet-panel">
      <ol className="elim-sheet-chain" aria-label={`Clues 1 to ${step}`}>
        {data.steps.map((item, index) => (
          <li key={index} className={index + 1 === step ? "is-current" : ""}>
            <span className="elim-sheet-chain-n" aria-hidden="true">{index + 1}</span>
            {item.label}
          </li>
        ))}
      </ol>
      <p className="elim-sheet-summary">
        <strong>{plural(rows.length, "place fits", "places fit")}</strong> {step === 1 ? "clue 1" : `clues 1–${step}`}.
        {" "}Name any one of them to reveal the next clue.
      </p>
      <p className="elim-sheet-pick elim-hint-note">
        {data.free ? "You already paid for this hint – opening it again is free." : "This hint used one of your hints for this round."}
      </p>

      {rows.length > 1 && (
        <div className="elim-sheet-tools">
          <label className="elim-sheet-search">
            <span className="sr-only">Search places that fit</span>
            <input type="search" value={query} placeholder="Search places" autoComplete="off" spellCheck={false}
              data-sheet-search="" onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {visible.length === rows.length ? plural(rows.length, "place", "places") : `Showing ${visible.length} of ${rows.length} places`}
      </p>
      {visible.length === 0 ? (
        <p className="muted elim-sheet-empty">{query ? `No place matches “${query.trim()}”.` : "Nothing to show."}</p>
      ) : (
        <div className="elim-sheet-list">
          {sections.map((section) => (
            <section key={section.letter || "all"} aria-label={section.letter ? `Starting with ${section.letter}` : undefined}>
              {section.letter && <h3 className="elim-sheet-letter" aria-hidden="true">{section.letter}</h3>}
              <ul className="elim-cands">
                {section.rows.map((row) => <CandidateItem key={row.code} row={row} step={step} />)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

type SheetProps = {
  /** 1-based group number, as the server counts it. */
  group: number;
  colour: EliminationColour;
  onClose: () => void;
} & (
  | {
      /** After the round: every clue step, one tab each. */
      variant?: "full";
      /** 1-based clue step to show first. */
      initialStep: number;
      load: (group: number) => Promise<EliminationCandidates>;
    }
  | {
      /** During the round: the list for the open clue of this group only. */
      variant: "hint";
      load: (group: number) => Promise<EliminationHint>;
    }
);

export function CandidatesSheet(props: SheetProps) {
  if (props.variant === "hint") {
    return <Sheet group={props.group} colour={props.colour} onClose={props.onClose} initialStep={1} hint load={props.load} />;
  }
  return (
    <Sheet group={props.group} colour={props.colour} onClose={props.onClose} initialStep={props.initialStep} hint={false} load={props.load} />
  );
}

function Sheet({
  group,
  colour,
  initialStep,
  hint,
  load,
  onClose,
}: {
  group: number;
  colour: EliminationColour;
  initialStep: number;
  hint: boolean;
  load: (group: number) => Promise<EliminationCandidates | EliminationHint>;
  onClose: () => void;
}) {
  const result = useLoad(() => load(group), group);
  const [step, setStep] = useState(initialStep);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CandidateFilter>("all");
  const queryRef = useRef(query);
  queryRef.current = query;
  const dialogRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const data = result.data;
  const size = data?.steps.length ?? 0;
  const selected = Math.min(Math.max(step, 1), Math.max(size, 1));

  // Esc first clears a non-empty search box, then closes; focus returns to the count that opened the sheet.
  useModalDialog(true, dialogRef, onClose, {
    initialFocus: ".elim-sheet-close",
    canClose: () => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && active.dataset.sheetSearch !== undefined && queryRef.current) {
        setQuery("");
        return false;
      }
      return true;
    },
  });

  function select(next: number, focus = false) {
    setStep(next);
    if (focus) tabRefs.current[next - 1]?.focus();
  }

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    select(nextStep(selected, event.key, size), true);
  }

  // Left/Right switch clues from anywhere in the sheet except the search box (the tabs handle their own keys).
  function onSheetKey(event: KeyboardEvent<HTMLElement>) {
    if (hint || event.isDefaultPrevented() || !size || isTypingTarget(event.target)) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    select(nextStep(selected, event.key, size));
  }

  const first = data?.places.length ?? 0;
  return (
    <div className="elim-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="elim-sheet-title"
        className={`elim-sheet colour-${colour}${hint ? " is-hint" : ""}`} onKeyDown={onSheetKey}>
        <header className="elim-sheet-head">
          <div>
            <p className="elim-sheet-eyebrow"><span className={`elim-sheet-dot dot-${colour}`} aria-hidden="true" /> {colourNames[colour]} group{hint && <span className="elim-hint-badge">Hint</span>}</p>
            <h2 id="elim-sheet-title">{hint ? "Hint: places that fit so far" : "Every place that fit"}</h2>
          </div>
          <button type="button" className="elim-sheet-close" aria-label="Close" onClick={onClose}>×</button>
        </header>

        {result.error ? (
          <div className="elim-sheet-panel"><ErrorBox message={friendlyError(result.error)} retry={result.reload} /></div>
        ) : !data ? (
          <div className="elim-sheet-panel"><Loading /></div>
        ) : hint && isHint(data) ? (
          <>
            <div className="elim-sheet-scroll">
              <HintPanel data={data} query={query} setQuery={setQuery} />
            </div>
            <p className="elim-sheet-hint" aria-hidden="true">Esc closes</p>
          </>
        ) : (
          <>
            <div className="elim-steps" role="tablist" aria-label="Clue steps" onKeyDown={onTabKey}>
              {data.steps.map((item, index) => {
                const n = index + 1;
                const count = data.places.filter((place) => place.depth >= n).length;
                // Bar length on a log scale, so 1 of 190 is still visible next to 190.
                const fill = first > 1 ? Math.max(0.06, Math.log(count + 1) / Math.log(first + 1)) : 1;
                return (
                  <button key={n} ref={(node) => { tabRefs.current[index] = node; }} type="button" role="tab"
                    id={`elim-step-tab-${n}`} aria-selected={n === selected} aria-controls="elim-step-panel"
                    tabIndex={n === selected ? 0 : -1} className="elim-step"
                    aria-label={`Clue ${n}: ${item.label}, ${plural(count, "place", "places")}`}
                    onClick={() => select(n)}>
                    <span className="elim-step-label" aria-hidden="true">Clue {n}</span>
                    <strong className="elim-step-count" aria-hidden="true">{count}</strong>
                    <span className="elim-step-bar" aria-hidden="true"><span style={{ width: `${fill * 100}%` }} /></span>
                  </button>
                );
              })}
            </div>
            <div role="tabpanel" id="elim-step-panel" aria-labelledby={`elim-step-tab-${selected}`} className="elim-sheet-scroll">
              <StepPanel data={data} step={selected} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} />
            </div>
            <p className="elim-sheet-hint" aria-hidden="true">← → switch clue · Esc closes</p>
          </>
        )}
      </section>
    </div>
  );
}
