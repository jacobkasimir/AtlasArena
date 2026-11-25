// Phone Settings (/settings/*): game feel (vibration, sound, volume, preview), every touch-relevant preference
// from src/prefs.ts, the phone-only answer layout,
// the colour theme, device data actions, the link to the desktop version and About.
import { useState } from "react";
import { Route, Routes } from "react-router-dom";
import {
  AutoContinueSpeed,
  Density,
  TextSize,
  TimerDisplay,
  clearSavedSetups,
  defaultPrefs,
  resetPrefs,
  setPref,
  usePrefs,
} from "@shared/prefs";
import { ThemeChoice, readTheme, saveTheme } from "@shared/theme";
import { AnswerLayout, defaultPhonePrefs, setPhonePref, usePhonePrefs } from "@phone/prefs-phone";
import { usePhoneChrome } from "@phone/shell/chrome";
import { paths } from "@phone/shell/paths";
import { BottomSheet, Button, LinkCard, Section, StatusMessage, useToast } from "@phone/ui";
import { ChoiceGroup, RowGroup, SwitchRow } from "./controls";
import { FeelSettings } from "./feel-settings";
import { ViewModeSetting } from "./ViewModeSetting";
import "./account.css";

export default function SettingsArea() {
  return (
    <Routes>
      <Route index element={<SettingsScreen />} />
      <Route path="*" element={<SettingsScreen />} />
    </Routes>
  );
}

function SettingsScreen() {
  usePhoneChrome({ title: "Settings" });
  const prefs = usePrefs();
  const phonePrefs = usePhonePrefs();
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<"closed" | "reset" | "setups">("closed");
  const toast = useToast();

  const isDefault =
    (Object.keys(defaultPrefs) as (keyof typeof defaultPrefs)[]).every((key) => prefs[key] === defaultPrefs[key]) &&
    phonePrefs.answerLayout === defaultPhonePrefs.answerLayout;

  function chooseTheme(value: ThemeChoice) {
    setTheme(value);
    saveTheme(value);
  }

  function confirmAction() {
    if (confirm === "reset") {
      resetPrefs();
      setPhonePref("answerLayout", defaultPhonePrefs.answerLayout);
      setMessage("Settings were reset to their defaults.");
      toast.show("Settings reset to defaults", { tone: "success" });
    } else if (confirm === "setups") {
      clearSavedSetups();
      setMessage("Saved game setups were forgotten.");
      toast.show("Saved setups forgotten", { tone: "success" });
    }
    setConfirm("closed");
  }

  return (
    <>
      <FeelSettings />

      <Section title="Gameplay">
        <RowGroup>
          <SwitchRow
            title="Continue automatically"
            description="Move on after a correct answer (Quiz, Flags, Capitals)."
            checked={prefs.autoContinue}
            onChange={(value) => setPref("autoContinue", value)}
          />
          <ChoiceGroup<AutoContinueSpeed>
            title="Auto-continue pause"
            value={prefs.autoContinueSpeed}
            disabled={!prefs.autoContinue}
            onChange={(value) => setPref("autoContinueSpeed", value)}
            options={[
              { value: "quick", label: "Quick" },
              { value: "normal", label: "Normal" },
              { value: "relaxed", label: "Relaxed" },
            ]}
          />
          <ChoiceGroup<TimerDisplay>
            title="Countdown"
            description="Calm hides the timer until time is nearly up."
            value={prefs.timerDisplay}
            onChange={(value) => setPref("timerDisplay", value)}
            options={[
              { value: "always", label: "Always show" },
              { value: "calm", label: "Calm" },
            ]}
          />
          <ChoiceGroup<AnswerLayout>
            title="Answer buttons"
            description="Multiple-choice answers as a list or a 2 × 2 grid (phone only)."
            value={phonePrefs.answerLayout}
            onChange={(value) => setPhonePref("answerLayout", value)}
            options={[
              { value: "list", label: "List" },
              { value: "grid", label: "Grid" },
            ]}
          />
          <SwitchRow
            title="Remember my last setup"
            description="Pre-fill every game setup with your last choices."
            checked={prefs.rememberSetup}
            onChange={(value) => setPref("rememberSetup", value)}
          />
          <SwitchRow
            title="Ask before giving up or discarding"
            checked={prefs.confirmGiveUp}
            onChange={(value) => setPref("confirmGiveUp", value)}
          />
          <SwitchRow
            title="Warn before leaving a round"
            description="The browser asks before the page is closed or reloaded during a round."
            checked={prefs.confirmLeave}
            onChange={(value) => setPref("confirmLeave", value)}
          />
        </RowGroup>
      </Section>

      <Section title="Display & accessibility">
        <RowGroup>
          <ChoiceGroup<ThemeChoice>
            title="Colour theme"
            description="For this device."
            value={theme}
            onChange={chooseTheme}
            options={[
              { value: "system", label: "System", icon: "phone" },
              { value: "light", label: "Light", icon: "sun" },
              { value: "dark", label: "Dark", icon: "moon" },
            ]}
          />
          <ChoiceGroup<TextSize>
            title="Text size"
            value={prefs.textSize}
            onChange={(value) => setPref("textSize", value)}
            options={[
              { value: "normal", label: "Normal" },
              { value: "large", label: "Large" },
              { value: "larger", label: "Larger" },
            ]}
          />
          <ChoiceGroup<Density>
            title="Spacing"
            value={prefs.density}
            onChange={(value) => setPref("density", value)}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
          <SwitchRow
            title="High contrast"
            description="Stronger text and borders."
            checked={prefs.highContrast}
            onChange={(value) => setPref("highContrast", value)}
          />
          <SwitchRow
            title="Reduce motion"
            description="Fewer animations, in addition to your system setting."
            checked={prefs.reduceMotion}
            onChange={(value) => setPref("reduceMotion", value)}
          />
        </RowGroup>
      </Section>

      <Section title="On this device">
        <p className="ph-muted text-sm">
          Settings are saved on this device and shared with the desktop version in this browser.
        </p>
        <div className="ph-account-buttons">
          <Button aria-haspopup="dialog" onClick={() => setConfirm("setups")}>
            Forget saved setups
          </Button>
          <Button aria-haspopup="dialog" disabled={isDefault} onClick={() => setConfirm("reset")}>
            Reset to defaults
          </Button>
        </div>
        <StatusMessage tone="success">{message}</StatusMessage>
        <BottomSheet
          open={confirm !== "closed"}
          onClose={() => setConfirm("closed")}
          title={confirm === "setups" ? "Forget saved setups?" : "Reset settings to defaults?"}
          initialFocus="[data-safe-choice]"
          footer={
            <>
              <Button size="lg" data-safe-choice="" onClick={() => setConfirm("closed")}>
                Cancel
              </Button>
              <Button size="lg" variant="danger" onClick={confirmAction}>
                {confirm === "setups" ? "Forget setups" : "Reset settings"}
              </Button>
            </>
          }
        >
          {confirm === "setups" ? (
            <p>
              Every game setup will start from the standard choices again. Your settings, theme, progress and account
              stay as they are.
            </p>
          ) : (
            <div className="ph-stack">
              <p>
                Feel (vibration and sound), gameplay, display and answer-button preferences go back to their defaults on this device
                (also for the desktop version in this browser).
              </p>
              <p className="ph-muted">Your colour theme, saved setups, progress and account are kept.</p>
            </div>
          )}
        </BottomSheet>
      </Section>

      <Section title="Account">
        <LinkCard
          to={`${paths.profile}/account`}
          icon="shield"
          title="Account & data"
          text="Download your data, sign out or delete your account"
        />
      </Section>

      <ViewModeSetting />

      <Section title="About">
        <div className="ph-card grid gap-2">
          <p className="font-bold">Atlas Arena</p>
          <p className="ph-muted text-sm">
            Learn the world through play: quizzes, flags, capitals, recall and elimination puzzles.
          </p>
          <p className="ph-muted text-sm">
            Add it to your home screen from the browser menu (on iPhone: Share → Add to Home Screen). After the first
            visit it opens offline; games, sign-in and saving need a connection.
          </p>
        </div>
      </Section>
    </>
  );
}
