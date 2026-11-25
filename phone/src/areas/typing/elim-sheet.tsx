// Elimination candidate lists as a bottom sheet (phone). After the round: every place behind a clue's count, one tab
// per clue step (api.elimCandidates). During the round: a bought hint, the places that fit the open clue
// (api.elimHint). All list logic comes from the shared pure helpers in src/elimination-domain.ts.
import { KeyboardEvent, useMemo, useRef, useState } from "react";
import { useLoad } from "@shared/components";
import type { EliminationCandidates, EliminationColour, EliminationHint } from "@shared/domain";
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
} from "@shared/elimination-domain";
import { BottomSheet, Chip, ChipGroup, LoadingState, StatusMessage, TextField } from "@phone/ui";
import { Flag } from "./common";

export const colourNames: Record<EliminationColour, string> = {
  green: "Green",
  orange: "Orange",
  blue: "Blue",
  purple: "Purple",
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
/** Letter headings only help in longer lists. */
const LETTER_HEADINGS_FROM = 16;

/** Plain-English text for the candidate and hint errors (CANDIDATES_LOCKED, NO_HINTS_LEFT, HINT_LAST_CLUE, …). */
export function candidateErrorText(message: string) {
  if (message.includes("ELIMINATION_CANDIDATES_LOCKED")) return "The full lists unlock when the round is over.";
  return hintErrorText(message);
}

function CandidateItem({ row, step }: { row: CandidateRow; step: number }) {
  const otherPicks = row.pickedAt.filter((picked) => picked !== step);
  const classes = ["ph-elim-cand", `is-${row.status}`, row.pick ? "is-pick" : ""].filter(Boolean).join(" ");
  return (
    <li className={classes}>
      <Flag code={row.code} />
      <span className="ph-elim-cand-name">
        {row.name}
        {row.status === "ruledOut" && <span className="sr-only"> – ruled out by the next clue</span>}
      </span>
      {row.pick && <span className="ph-elim-tag is-pick">Your pick</span>}
      {!row.pick && otherPicks.length > 0 && (
        <span className="ph-elim-tag">Your pick for clue {otherPicks.join(" & ")}</span>
      )}
      {row.status === "answer" && <span className="ph-elim-tag is-answer">Answer</span>}
    </li>
  );
}

function CandidateList({ rows, total, query, step }: { rows: CandidateRow[]; total: number; query: string; step: number }) {
  const sections = rows.length >= LETTER_HEADINGS_FROM ? groupByLetter(rows) : [{ letter: "", rows }];
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {rows.length === total ? plural(total, "place", "places") : `Showing ${rows.length} of ${total} places`}
      </p>
      {rows.length === 0 ? (
        <p className="ph-muted ph-typing-empty">{query.trim() ? `No place matches “${query.trim()}”.` : "Nothing to show."}</p>
      ) : (
        <div>
          {sections.map((section) => (
            <section key={section.letter || "all"} aria-label={section.letter ? `Starting with ${section.letter}` : undefined}>
              {section.letter && (
                <h3 className="ph-elim-letter" aria-hidden="true">
                  {section.letter}
                </h3>
              )}
              <ul className="ph-elim-cands">
                {section.rows.map((row) => (
                  <CandidateItem key={row.code} row={row} step={step} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function Chain({ labels, step }: { labels: string[]; step: number }) {
  return (
    <ol className="ph-elim-chain" aria-label={`Clues 1 to ${step}`}>
      {labels.slice(0, step).map((label, index) => (
        <li key={index} className={index + 1 === step ? "is-current" : undefined}>
          <span className="ph-elim-chain-n" aria-hidden="true">
            {index + 1}
          </span>
          {label}
        </li>
      ))}
    </ol>
  );
}

function SearchField({ query, setQuery }: { query: string; setQuery: (query: string) => void }) {
  return (
    <TextField
      label="Search places"
      type="search"
      value={query}
      placeholder="Accents don't matter"
      onChange={(event) => setQuery(event.target.value)}
      data-sheet-search=""
      autoComplete="off"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="search"
    />
  );
}

/** One clue step of the full lists: chain, summary, search, filter and the A–Z list. */
function StepPanel({
  data,
  step,
  query,
  setQuery,
  filter,
  setFilter,
}: {
  data: EliminationCandidates;
  step: number;
  query: string;
  setQuery: (query: string) => void;
  filter: CandidateFilter;
  setFilter: (filter: CandidateFilter) => void;
}) {
  const size = data.steps.length;
  const last = step >= size;
  const rows = useMemo(() => candidatesAt(data, step), [data, step]);
  const summary = useMemo(() => stepSummary(data, step), [data, step]);
  const visible = filterCandidates(rows, query, last ? "all" : filter);
  const current = data.steps[step - 1];
  const next = data.steps[step];
  const filters: { id: CandidateFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: summary.total },
    { id: "kept", label: "Fit the next clue", count: summary.kept },
    { id: "ruledOut", label: "Ruled out", count: summary.ruledOut },
  ];

  return (
    <div className="ph-elim-sheet">
      <Chain labels={data.steps.map((item) => item.label)} step={step} />
      <p className="ph-elim-summary">
        {last ? (
          <>
            Only <strong>{plural(summary.total, "place fits", "places fit")}</strong> all {size} clues.
          </>
        ) : (
          <>
            <strong>{plural(summary.total, "place fits", "places fit")}</strong> {step === 1 ? "clue 1" : `clues 1–${step}`}.
            {next && (
              <>
                {" "}
                The next clue, <em>{next.label}</em>, keeps {summary.kept} and rules out {summary.ruledOut}.
              </>
            )}
          </>
        )}
        {current && summary.total !== current.remaining && (
          <span className="ph-muted"> (The puzzle counted {current.remaining}.)</span>
        )}
      </p>
      <p className="ph-muted">
        {current?.pick ? (
          <>
            You named <strong>{current.pick.name}</strong> for this clue.
          </>
        ) : (
          "You didn't name a place for this clue."
        )}
      </p>
      {summary.total > 1 && <SearchField query={query} setQuery={setQuery} />}
      {!last && summary.ruledOut > 0 && (
        <ChipGroup label="Show">
          {filters.map((item) => (
            <Chip key={item.id} pressed={filter === item.id} onToggle={() => setFilter(item.id)}>
              {item.label} <span className="ph-typing-count">{item.count}</span>
            </Chip>
          ))}
        </ChipGroup>
      )}
      <CandidateList rows={visible} total={rows.length} query={query} step={step} />
    </div>
  );
}

/** A hint: places that fit every clue so far in one group. No other steps, no "next clue" split. */
function HintPanel({ data, query, setQuery }: { data: EliminationHint; query: string; setQuery: (query: string) => void }) {
  const rows = useMemo(() => hintRows(data), [data]);
  const visible = filterCandidates(rows, query, "all");
  const step = data.step;
  return (
    <div className="ph-elim-sheet">
      <Chain labels={data.steps.map((item) => item.label)} step={step} />
      <p className="ph-elim-summary">
        <strong>{plural(rows.length, "place fits", "places fit")}</strong> {step === 1 ? "clue 1" : `clues 1–${step}`}. Name
        any one of them to reveal the next clue.
      </p>
      <p className="ph-elim-hint-note">
        {data.free
          ? "You already used this hint – opening it again is free."
          : "This hint used one of your hints for this round."}
      </p>
      {rows.length > 1 && <SearchField query={query} setQuery={setQuery} />}
      <CandidateList rows={visible} total={rows.length} query={query} step={step} />
    </div>
  );
}

type SheetProps = {
  /** 1-based group number, as the server counts it. */
  group: number;
  colour: EliminationColour;
  onClose: () => void;
} & (
  | { variant: "full"; initialStep: number; load: (group: number) => Promise<EliminationCandidates> }
  | { variant: "hint"; load: (group: number) => Promise<EliminationHint> }
);

const isHint = (data: EliminationCandidates | EliminationHint): data is EliminationHint => "step" in data;

/** Mount it when it should be open (it renders an open BottomSheet); give it a key per group. */
export function CandidatesSheet(props: SheetProps) {
  const { group, colour, onClose } = props;
  const hint = props.variant === "hint";
  const load = props.load as (group: number) => Promise<EliminationCandidates | EliminationHint>;
  const result = useLoad(() => load(group), group);
  const [step, setStep] = useState(props.variant === "full" ? props.initialStep : 1);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CandidateFilter>("all");
  const queryRef = useRef(query);
  queryRef.current = query;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const data = result.data;
  const size = data?.steps.length ?? 0;
  const selected = Math.min(Math.max(step, 1), Math.max(size, 1));
  const title = `${colourNames[colour]} group · ${hint ? "Hint" : "Every place that fit"}`;

  function select(next: number, focus = false) {
    setStep(next);
    if (focus) tabRefs.current[next - 1]?.focus();
  }

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    select(nextStep(selected, event.key, size), true);
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={title}
      // Esc in a non-empty search box clears it first; the next Esc closes the sheet.
      canClose={() => {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement && active.dataset.sheetSearch !== undefined && queryRef.current) {
          setQuery("");
          return false;
        }
        return true;
      }}
    >
      <div className={`ph-elim-${colour}`}>
        {result.error ? (
          <StatusMessage tone="error" retry={result.reload}>
            {candidateErrorText(result.error)}
          </StatusMessage>
        ) : !data ? (
          <LoadingState label="Loading the list…" />
        ) : hint && isHint(data) ? (
          <HintPanel data={data} query={query} setQuery={setQuery} />
        ) : (
          <div className="ph-elim-sheet">
            <div className="ph-elim-steps" role="tablist" aria-label="Clue steps" onKeyDown={onTabKey}>
              {data.steps.map((item, index) => {
                const n = index + 1;
                const count = data.places.filter((place) => place.depth >= n).length;
                return (
                  <button
                    key={n}
                    ref={(node) => {
                      tabRefs.current[index] = node;
                    }}
                    type="button"
                    role="tab"
                    id={`ph-elim-step-tab-${n}`}
                    aria-selected={n === selected}
                    aria-controls="ph-elim-step-panel"
                    tabIndex={n === selected ? 0 : -1}
                    className="ph-elim-step"
                    aria-label={`Clue ${n}: ${item.label}, ${plural(count, "place", "places")}`}
                    onClick={() => select(n)}
                  >
                    <small aria-hidden="true">Clue {n}</small>
                    <strong aria-hidden="true">{count}</strong>
                  </button>
                );
              })}
            </div>
            <div role="tabpanel" id="ph-elim-step-panel" aria-labelledby={`ph-elim-step-tab-${selected}`}>
              <StepPanel
                data={data}
                step={selected}
                query={query}
                setQuery={setQuery}
                filter={filter}
                setFilter={setFilter}
              />
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
