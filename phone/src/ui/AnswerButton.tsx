import { ReactNode } from "react";
import { Icon } from "@shared/icons";
import { feel } from "./feel";

/**
 * idle: not answered yet · selected: chosen, waiting for the server · correct: chosen and right ·
 * wrong: chosen and wrong · missed: the right answer the player did not choose (shown after a wrong answer).
 * The server decides correctness; screens only map its response to these states.
 */
export type AnswerState = "idle" | "selected" | "correct" | "wrong" | "missed";

const stateText: Record<AnswerState, string> = {
  idle: "",
  selected: "Checking your answer",
  correct: "Correct",
  wrong: "Your answer, wrong",
  missed: "Correct answer",
};

/** Short visible tag next to the icon, so the state never depends on colour alone. */
const stateTag: Record<AnswerState, string> = {
  idle: "",
  selected: "",
  correct: "Correct",
  wrong: "Wrong",
  missed: "Answer",
};

/**
 * Big tap target for a multiple-choice answer (≥ 64 px, no swipe), with a chunky pressed state.
 * State is shown by colour, icon and a visible word; correct pops, wrong shakes (not under reduced motion).
 * Pressing gives a light "select" haptic; the screen fires correct/wrong once the server answered.
 */
export function AnswerButton({
  index,
  state = "idle",
  onSelect,
  disabled,
  badge = "letter",
  detail,
  children,
}: {
  /** 0-based position; shown as A, B, C, D (or 1–4 with badge="number"). */
  index: number;
  state?: AnswerState;
  onSelect: () => void;
  disabled?: boolean;
  /** Key badge style; "none" hides it (e.g. flag images in a grid). */
  badge?: "letter" | "number" | "none";
  /** Optional second line (e.g. the region), shown smaller. */
  detail?: ReactNode;
  children: ReactNode;
}) {
  const key = badge === "number" ? String(index + 1) : String.fromCharCode(65 + index);
  const mark =
    state === "correct" || state === "missed" ? "checkCircle" : state === "wrong" ? "warning" : null;
  return (
    <button
      type="button"
      className="ph-answer"
      data-state={state}
      onClick={() => {
        feel("select");
        onSelect();
      }}
      disabled={disabled || state !== "idle"}
    >
      {badge !== "none" && (
        <span className="ph-answer-key" aria-hidden="true">
          {key}
        </span>
      )}
      <span className="ph-answer-label">
        {children}
        {detail && <small className="ph-answer-detail">{detail}</small>}
      </span>
      {mark && (
        <span className="ph-answer-mark" aria-hidden="true">
          <Icon name={mark} size={22} />
          <span className="ph-answer-tag">{stateTag[state]}</span>
        </span>
      )}
      {state === "selected" && <span className="ph-spinner ph-answer-spinner" aria-hidden="true" />}
      {state !== "idle" && <span className="sr-only">, {stateText[state]}</span>}
    </button>
  );
}

/** Lays out AnswerButtons as a vertical list (default, best for long names) or a 2 × 2 grid (short labels, flags). */
export function AnswerList({
  layout = "list",
  label,
  children,
}: {
  layout?: "list" | "grid";
  /** e.g. "Answers"; names the group for screen readers. */
  label: string;
  children: ReactNode;
}) {
  return (
    <div className={`ph-answers${layout === "grid" ? " is-grid" : ""}`} role="group" aria-label={label}>
      {children}
    </div>
  );
}
