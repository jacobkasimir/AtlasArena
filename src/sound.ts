// Short game sound cues, synthesized with WebAudio (no audio files, no extra hosts).
import { HapticKind, getPrefs, haptic } from "./prefs";

type Note = { frequency: number; start: number; duration: number; type: OscillatorType; slideTo?: number };

const cues: Record<Exclude<HapticKind, "tap">, Note[]> = {
  correct: [
    { frequency: 660, start: 0, duration: 0.09, type: "sine" },
    { frequency: 880, start: 0.08, duration: 0.14, type: "sine" },
  ],
  wrong: [{ frequency: 240, start: 0, duration: 0.22, type: "triangle", slideTo: 170 }],
  complete: [
    { frequency: 523.25, start: 0, duration: 0.12, type: "sine" },
    { frequency: 659.25, start: 0.11, duration: 0.12, type: "sine" },
    { frequency: 783.99, start: 0.22, duration: 0.12, type: "sine" },
    { frequency: 1046.5, start: 0.33, duration: 0.3, type: "sine" },
  ],
};

/** Peak gain at 100 % volume; cues are meant to be subtle. */
const MAX_GAIN = 0.22;

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  // Browsers start audio suspended until the page had a user gesture; every cue follows one.
  if (context.state === "suspended") void context.resume().catch(() => undefined);
  return context;
}

/**
 * Play a sound cue. Does nothing when sound is off, the volume is 0 or WebAudio is unavailable.
 * `volume` overrides the saved volume (used by the Settings preview).
 */
export function playSound(kind: HapticKind, volume?: number) {
  const prefs = getPrefs();
  const level = (volume ?? prefs.volume) / 100;
  if (kind === "tap" || (volume === undefined && !prefs.sound) || level <= 0) return;
  const ctx = audioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime + 0.01;
    for (const note of cues[kind]) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const begin = now + note.start;
      const end = begin + note.duration;
      oscillator.type = note.type;
      oscillator.frequency.setValueAtTime(note.frequency, begin);
      if (note.slideTo) oscillator.frequency.exponentialRampToValueAtTime(note.slideTo, end);
      // Short attack and release envelope so notes don't click.
      gain.gain.setValueAtTime(0.0001, begin);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, MAX_GAIN * level), begin + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(begin);
      oscillator.stop(end + 0.02);
    }
  } catch {
    /* audio is best effort */
  }
}

/** Game feedback: vibration (where available) and a sound cue, each according to the player's settings. */
export function cue(kind: HapticKind) {
  haptic(kind);
  playSound(kind);
}
