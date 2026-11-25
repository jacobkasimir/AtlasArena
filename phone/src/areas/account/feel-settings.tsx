// Settings → Feel: vibration and sound switches, volume, and a "Try it" preview that plays the named game-feel
// patterns from @phone/ui (the same ones the games use). Everything respects src/prefs.ts: with vibration off
// the preview only plays sound, with sound off only vibration.
import { Icon, IconName } from "@shared/icons";
import { canVibrate, isIOS, setPref, usePrefs } from "@shared/prefs";
import { Button, Feel, Section, feel, useFeel } from "@phone/ui";
import { RowGroup, SwitchRow } from "./controls";

/** Preview buttons in the order of the haptics map (phone/README.md). */
export const feelPreview: { id: string; label: string; icon: IconName; play: (f: Feel) => void }[] = [
  { id: "tap", label: "Tap", icon: "gamepad", play: (f) => f.tap() },
  { id: "correct", label: "Correct", icon: "check", play: (f) => f.correct() },
  { id: "streak", label: "Streak", icon: "flame", play: (f) => f.streak(5) },
  { id: "wrong", label: "Wrong", icon: "close", play: (f) => f.wrong() },
  { id: "timerWarning", label: "Timer warning", icon: "timer", play: (f) => f.timerWarning() },
  { id: "levelUp", label: "Level up", icon: "sparkles", play: (f) => f.levelUp() },
  { id: "reward", label: "Reward", icon: "trophy", play: (f) => f.reward() },
];

export function FeelSettings() {
  const prefs = usePrefs();
  const feedback = useFeel();
  const vibrationSupported = canVibrate();
  const nothingOn = !prefs.haptics && !prefs.sound;

  return (
    <Section title="Feel">
      <RowGroup label="Vibration and sound">
        <SwitchRow
          title="Vibration"
          description={
            !vibrationSupported
              ? "This device or browser can't vibrate. The setting is kept for your other devices."
              : isIOS
                ? "iPhone and iPad only support a light tick (iOS 18 or later), and only right after you tap."
                : "Short patterns for answers, streaks, timers and finished rounds."
          }
          checked={prefs.haptics}
          onChange={(value) => {
            setPref("haptics", value);
            if (value) feel("tap", { sound: false });
          }}
        />
        <SwitchRow
          title="Sound effects"
          description="Short sound cues for answers, streaks and rewards. Made in the app, no downloads."
          checked={prefs.sound}
          onChange={(value) => {
            setPref("sound", value);
            if (value) feel("correct");
          }}
        />
        <div className="ph-account-row ph-account-choice-row" data-disabled={!prefs.sound || undefined}>
          <label className="ph-account-row-text" htmlFor="ph-account-volume">
            <strong>Volume</strong>
            <small className="ph-muted">{prefs.sound ? `${prefs.volume}%` : "Sound effects are off"}</small>
          </label>
          <input
            id="ph-account-volume"
            className="ph-account-range"
            type="range"
            min={0}
            max={100}
            step={5}
            value={prefs.volume}
            disabled={!prefs.sound}
            aria-valuetext={`${prefs.volume}%`}
            onChange={(event) => setPref("volume", Number(event.target.value))}
            onPointerUp={() => feel("correct", { sound: true })}
          />
        </div>
        <div className="ph-account-row ph-account-choice-row" role="group" aria-labelledby="ph-account-try-title">
          <span className="ph-account-row-text">
            <strong id="ph-account-try-title">Try it</strong>
            <small className="ph-muted">
              {nothingOn
                ? "Turn on vibration or sound to feel the preview."
                : isIOS
                  ? "Plays each game moment. On iOS you feel only a light tick; the sound plays in full."
                  : "Plays each game moment the way the games do."}
            </small>
          </span>
          <div className="ph-account-feel-grid">
            {feelPreview.map((item) => (
              <Button
                key={item.id}
                className="ph-account-feel-btn"
                disabled={nothingOn}
                icon={<Icon name={item.icon} size={18} />}
                onClick={() => item.play(feedback)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      </RowGroup>
    </Section>
  );
}
