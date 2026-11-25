import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

// Run against the local demo engine, never a real Supabase project (even when .env.local is present).
vi.hoisted(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
});

import { PhoneApp } from "./PhoneApp";
import { parentPath, titleForPath } from "./paths";

const lazyRoute = { timeout: 5000 };

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PhoneApp />
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.phTabbar;
});

describe("phone shell", { timeout: 15_000 }, () => {
  it("sends a signed-out visitor to the welcome screen", async () => {
    localStorage.setItem("atlas-demo-signed-out", "yes");
    renderAt("/quiz");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/welcome"));
    expect(screen.getByRole("heading", { level: 1, name: /Stay curious/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play as guest" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the desktop version" })).toHaveAttribute("href", "/");
  });

  it("sends a new guest to onboarding before any game", async () => {
    renderAt("/");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/onboarding"));
    expect(screen.getByRole("heading", { level: 1, name: "Choose your explorer name" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });

  it("plays as guest from the welcome screen and finishes onboarding", async () => {
    localStorage.setItem("atlas-demo-signed-out", "yes");
    renderAt("/welcome");
    fireEvent.click(await screen.findByRole("button", { name: "Play as guest" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/onboarding"));
    fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "x" } });
    fireEvent.submit(screen.getByLabelText("Username").closest("form")!);
    expect(await screen.findByText(/Use 2–24 characters/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "Phone Explorer" } });
    fireEvent.submit(screen.getByLabelText("Username").closest("form")!);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/));
    expect(localStorage.getItem("atlas-demo-onboarded")).toBe("yes");
  });

  it("renders the signed-in layout with a tab bar and navigates between tabs", async () => {
    localStorage.setItem("atlas-demo-onboarded", "yes");
    renderAt("/");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(document.documentElement.dataset.phTabbar).toBe("visible");
    const home = screen.getByRole("link", { name: "Home" });
    expect(home).toHaveAttribute("aria-current", "page");
    expect(nav).toContainElement(home);

    fireEvent.click(screen.getByRole("link", { name: "Games" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/games"));
    expect(await screen.findByRole("link", { name: /Flags/ }, lazyRoute)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Games" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Games" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByRole("link", { name: /Flags/ }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/flags"));
    expect(await screen.findByRole("heading", { level: 1, name: "Flags" }, lazyRoute)).toBeInTheDocument();
    // Inside a game area the Games tab stays highlighted.
    expect(screen.getByRole("link", { name: "Games" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/settings"));
    expect(await screen.findByRole("link", { name: "Desktop version" }, lazyRoute)).toHaveAttribute("href", "/");
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toHaveFocus();

    fireEvent.click(screen.getByRole("link", { name: "Profile" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/profile"));
    expect(await screen.findByRole("heading", { level: 1, name: "Profile" }, lazyRoute)).toBeInTheDocument();
  });

  it.each([
    ["/quiz", "Quiz"],
    ["/capitals", "Capitals"],
    ["/recall", "Recall"],
    ["/elimination", "Elimination"],
  ])("loads the %s area", async (path, title) => {
    localStorage.setItem("atlas-demo-onboarded", "yes");
    renderAt(path);
    expect(await screen.findByRole("heading", { level: 1, name: title }, lazyRoute)).toBeInTheDocument();
  });

  it("shows a not-found screen inside the layout for unknown paths", async () => {
    localStorage.setItem("atlas-demo-onboarded", "yes");
    renderAt("/nowhere");
    expect(await screen.findByText("This page does not exist in the phone app.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Home" })).toBeInTheDocument();
  });

  it("explains on the sign-in screen that accounts are online only in the demo", async () => {
    renderAt("/sign-in?mode=signin");
    expect(await screen.findByText("Account features are not available in the local demo.")).toBeInTheDocument();
  });
});

describe("phone paths", () => {
  it("names routes and finds a parent for deep links", () => {
    expect(titleForPath("/")).toBe("Atlas Arena");
    expect(titleForPath("/flags/play/1")).toBe("Flags");
    expect(titleForPath("/settings")).toBe("Settings");
    expect(parentPath("/flags/play/1")).toBe("/flags");
    expect(parentPath("/flags")).toBe("/games");
    expect(parentPath("/games")).toBe("/");
    expect(parentPath("/profile")).toBe("/");
  });
});
