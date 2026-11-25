// Backwards-compatible name for the phone feedback hook. New code: useFeel() from ./feel (more patterns).
import { Feel, useFeel } from "./feel";

/** tap · correct · wrong · complete (plus everything in Feel). Respects Settings (haptics, sound, volume). */
export type Haptics = Pick<Feel, "tap" | "correct" | "wrong" | "complete"> & Partial<Feel>;

export function useHaptics(): Feel {
  return useFeel();
}
