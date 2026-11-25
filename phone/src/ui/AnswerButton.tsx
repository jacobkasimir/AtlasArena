import { ReactNode } from "react";
import { Icon } from "@shared/icons";

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

/** Big tap target for a multiple-choice answer (≥ 60 px, no swipe). State is shown by colour, icon and text. */
export function AnswerButton({
  index,
  state = "idle",
  onSelect,
  disabled,
  children,
}: {
  /** 0-based position; shown as A, B, C, D. */
  index: number;
  state?: AnswerState;
  onSelect: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const key = String.fromCharCode(65 + index);
  const mark =
    state === "correct" || state === "missed" ? "checkCircle" : state === "wrong" ? "warning" : null;
  return (
    <button
      type="button"
      className="ph-answer"
      data-state={state}
      onClick={onSelect}
      disabled={disabled || state !== "idle"}
    >
      <span className="ph-answer-key" aria-hidden="true">
        {key}
      </span>
      <span className="ph-answer-label">{children}</span>
      {mark && (
        <span className="ph-answer-mark" aria-hidden="true">
          <Icon name={mark} size={22} />
        </span>
      )}
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
