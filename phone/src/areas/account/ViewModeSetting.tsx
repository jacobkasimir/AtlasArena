// "View mode" in phone Settings: Auto (recommended) / Phone / Desktop, plus a direct switch to the desktop
// version. Logic lives in src/view-mode.ts and is shared with the desktop Settings.
import { useState } from "react";
import { Section, StatusMessage } from "@phone/ui";
import { DESKTOP_URL } from "@phone/shell/paths";
import {
  ViewMode,
  detectPhone,
  resolveTarget,
  setViewMode,
  switchApp,
  useViewMode,
  viewModeDescription,
} from "@shared/view-mode";
import { ChoiceGroup, RowGroup } from "./controls";

export function ViewModeSetting() {
  const mode = useViewMode();
  const [detectedPhone] = useState(() => detectPhone());
  const [status, setStatus] = useState("");

  function choose(next: ViewMode) {
    if (resolveTarget("phone", next, detectedPhone) === "desktop") {
      setStatus("Opening the desktop version…");
      switchApp("phone", next);
      return;
    }
    setViewMode(next);
    setStatus(next === "phone" ? "This device will always open the phone version." : "Auto: this device keeps the phone version.");
  }

  return (
    <Section title="View mode">
      <RowGroup>
        <ChoiceGroup<ViewMode>
          title="Open Atlas Arena as"
          description={`Auto is recommended. ${viewModeDescription(detectedPhone)}`}
          value={mode}
          onChange={choose}
          options={[
            { value: "auto", label: "Auto" },
            { value: "phone", label: "Phone" },
            { value: "desktop", label: "Desktop" },
          ]}
        />
      </RowGroup>
      {/* Plain link as a fallback; with JavaScript it opens the same screen in the desktop app (replace, so Back
          doesn't land on a page that would redirect again) and remembers "Desktop". */}
      <a
        className="ph-btn ph-btn-secondary ph-btn-block"
        href={DESKTOP_URL}
        onClick={(event) => {
          event.preventDefault();
          setStatus("Opening the desktop version…");
          switchApp("phone", "desktop");
        }}
      >
        Desktop version
      </a>
      <p className="ph-muted text-sm">Same account and progress, with the full desktop layout.</p>
      <StatusMessage>{status}</StatusMessage>
    </Section>
  );
}
