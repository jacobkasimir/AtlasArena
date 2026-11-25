// Game feedback for the phone app. Wraps the shared prefs (haptics on/off) and sound cues (sound on/off, volume):
// every call already respects the player's Settings, so screens never check prefs themselves.
import { useMemo } from "react";
import { haptic } from "@shared/prefs";
import { cue } from "@shared/sound";

export type Haptics = {
  /** Light tick for a button press (vibration only, never a sound). */
  tap: () => void;
  /** Right answer: vibration + sound cue. */
  correct: () => void;
  /** Wrong answer: vibration + sound cue. */
  wrong: () => void;
  /** Round finished: vibration + sound cue. */
  complete: () => void;
};

export function useHaptics(): Haptics {
  return useMemo(
    () => ({
      tap: () => haptic("tap"),
      correct: () => cue("correct"),
      wrong: () => cue("wrong"),
      complete: () => cue("complete"),
    }),
    [],
  );
}
