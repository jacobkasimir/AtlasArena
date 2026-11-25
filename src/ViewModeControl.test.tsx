import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const switchApp = vi.hoisted(() => vi.fn());
vi.mock("./view-mode", async (importOriginal) => ({ ...(await importOriginal<typeof import("./view-mode")>()), switchApp }));

import { ViewModeControl } from "./Settings";
import { VIEW_MODE_KEY, readViewMode } from "./view-mode";

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

describe("Desktop Settings → View mode", () => {
  it("is a radiogroup with Auto selected and the detected device described", () => {
    deviceIsPhone(false);
    render(<ViewModeControl />);
    const group = screen.getByRole("radiogroup", { name: "View mode" });
    expect(group).toHaveAccessibleDescription(/looks like a desktop, laptop or tablet/);
    expect(screen.getByRole("radio", { name: "Auto (recommended)" })).toHaveAttribute("aria-checked", "true");
  });

  it("stores Desktop without leaving the page", () => {
    deviceIsPhone(true);
    render(<ViewModeControl />);
    fireEvent.click(screen.getByRole("radio", { name: "Desktop" }));
    expect(localStorage.getItem(VIEW_MODE_KEY)).toBe("desktop");
    expect(screen.getByRole("radio", { name: "Desktop" })).toHaveAttribute("aria-checked", "true");
    expect(switchApp).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("always open the desktop version");
  });

  it("opens the phone version when Phone is chosen", () => {
    deviceIsPhone(false);
    render(<ViewModeControl />);
    fireEvent.click(screen.getByRole("radio", { name: "Phone" }));
    expect(switchApp).toHaveBeenCalledWith("desktop", "phone");
    expect(screen.getByRole("status")).toHaveTextContent("Opening the phone version");
  });

  it("Auto on a phone switches to the phone version; on a desktop it just stores Auto", () => {
    localStorage.setItem(VIEW_MODE_KEY, "desktop");
    deviceIsPhone(true);
    render(<ViewModeControl />);
    fireEvent.click(screen.getByRole("radio", { name: "Auto (recommended)" }));
    expect(switchApp).toHaveBeenCalledWith("desktop", "auto");
    cleanup();
    switchApp.mockReset();
    deviceIsPhone(false);
    render(<ViewModeControl />);
    fireEvent.click(screen.getByRole("radio", { name: "Auto (recommended)" }));
    expect(switchApp).not.toHaveBeenCalled();
    expect(readViewMode()).toBe("auto");
  });
});
