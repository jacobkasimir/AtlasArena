import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const switchApp = vi.hoisted(() => vi.fn());
vi.mock("@shared/view-mode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/view-mode")>()),
  switchApp,
}));

import { VIEW_MODE_KEY } from "@shared/view-mode";
import { ViewModeSetting } from "./ViewModeSetting";

function deviceIsPhone(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone && (query === "(pointer: coarse)" || query === "(hover: none)"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("innerWidth", phone ? 390 : 1280);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  switchApp.mockReset();
  vi.unstubAllGlobals();
});

describe("Phone Settings → View mode", () => {
  it("shows Auto, Phone and Desktop with the detected device", () => {
    deviceIsPhone(true);
    render(<ViewModeSetting />);
    const group = screen.getByRole("radiogroup", { name: "Open Atlas Arena as" });
    expect(group).toHaveAccessibleDescription(/Auto is recommended\. .*looks like a phone/);
    expect(screen.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
  });

  it("stores Phone and stays", () => {
    deviceIsPhone(false);
    render(<ViewModeSetting />);
    fireEvent.click(screen.getByRole("radio", { name: "Phone" }));
    expect(localStorage.getItem(VIEW_MODE_KEY)).toBe("phone");
    expect(screen.getByRole("radio", { name: "Phone" })).toHaveAttribute("aria-checked", "true");
    expect(switchApp).not.toHaveBeenCalled();
  });

  it("Desktop (radio or link) opens the desktop version and remembers it", () => {
    deviceIsPhone(true);
    render(<ViewModeSetting />);
    fireEvent.click(screen.getByRole("radio", { name: "Desktop" }));
    expect(switchApp).toHaveBeenCalledWith("phone", "desktop");
    switchApp.mockReset();
    const link = screen.getByRole("link", { name: "Desktop version" });
    expect(link).toHaveAttribute("href", "/");
    fireEvent.click(link);
    expect(switchApp).toHaveBeenCalledWith("phone", "desktop");
  });
});
