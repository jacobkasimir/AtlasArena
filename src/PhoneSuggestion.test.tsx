import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PhoneSuggestion } from "./PhoneSuggestion";
import { VIEW_MODE_KEY, setViewMode } from "./view-mode";

function deviceIsPhone(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone && (query === "(pointer: coarse)" || query === "(hover: none)"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("innerWidth", phone ? 390 : 1280);
}

function renderAt(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PhoneSuggestion />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("PhoneSuggestion", () => {
  it("suggests the phone version on phones in Auto mode and remembers 'Not now'", () => {
    deviceIsPhone(true);
    const { unmount } = renderAt();
    expect(screen.getByRole("link", { name: "Open phone version" })).toHaveAttribute("href", "/phone/");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("complementary", { name: "Phone version" })).not.toBeInTheDocument();
    unmount();
    renderAt();
    expect(screen.queryByRole("link", { name: "Open phone version" })).not.toBeInTheDocument();
  });

  it("links to the same screen and remembers the Phone choice", () => {
    deviceIsPhone(true);
    renderAt("/flags/session/f1");
    const link = screen.getByRole("link", { name: "Open phone version" });
    expect(link).toHaveAttribute("href", "/phone/flags/play/f1");
    link.addEventListener("click", (event) => event.preventDefault()); // jsdom can't navigate
    fireEvent.click(link);
    expect(localStorage.getItem(VIEW_MODE_KEY)).toBe("phone");
  });

  it("stays hidden on desktop screens and after an explicit Desktop choice", () => {
    deviceIsPhone(false);
    renderAt();
    expect(screen.queryByRole("link", { name: "Open phone version" })).not.toBeInTheDocument();
    cleanup();
    deviceIsPhone(true);
    setViewMode("desktop");
    renderAt();
    expect(screen.queryByRole("link", { name: "Open phone version" })).not.toBeInTheDocument();
  });
});
