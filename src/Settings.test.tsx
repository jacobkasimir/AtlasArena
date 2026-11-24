import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Settings } from "./Settings";
import { defaultPrefs, getPrefs, reloadPrefs } from "./prefs";

afterEach(() => {
  cleanup();
  localStorage.clear();
  reloadPrefs();
});

function renderSettings() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );
}

describe("Settings", () => {
  it("shows the desktop groups", () => {
    renderSettings();
    for (const name of ["Gameplay", "Audio", "Display & accessibility", "Keyboard", "Keyboard shortcuts", "Reset"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
  });

  it("toggles a switch and a choice, then resets to defaults", () => {
    renderSettings();
    const sound = screen.getByRole("switch", { name: "Sound effects" });
    expect(sound).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sound);
    expect(sound).toHaveAttribute("aria-checked", "false");
    expect(getPrefs().sound).toBe(false);

    const large = screen.getByRole("radio", { name: "Large" });
    fireEvent.click(large);
    expect(large).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.dataset.textSize).toBe("large");

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(getPrefs()).toEqual(defaultPrefs);
    expect(screen.getByRole("switch", { name: "Sound effects" })).toHaveAttribute("aria-checked", "true");
  });

  it("supports arrow keys in choice groups", () => {
    renderSettings();
    const group = screen.getByRole("radiogroup", { name: "Density" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(getPrefs().density).toBe("compact");
  });
});
