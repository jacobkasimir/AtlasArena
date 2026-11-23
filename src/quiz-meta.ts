import type { IconName } from "./icons";
import type { Mode } from "./domain";

export const modeNames: Record<Mode, string> = {
  classic: "Classic Quiz",
  practice: "Practice",
  timed: "Timed Challenge",
  endless: "Endless",
};

export const modeDescriptions: Record<Mode, string> = {
  classic: "Ten questions, four options. Chase a new personal best.",
  practice: "Take your time and learn from every answer. No XP pressure.",
  timed: "One minute on the clock. How far can you get?",
  endless: "Three lives. Every five correct answers unlock a tougher tier.",
};

export const modeIcons: Record<Mode, IconName> = { classic: "target", practice: "practice", timed: "timer", endless: "infinity" };

export function accuracy(correct: number, incorrect: number) {
  return correct + incorrect ? `${Math.round((100 * correct) / (correct + incorrect))}%` : "—";
}
