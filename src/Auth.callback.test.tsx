import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// Desktop landing of email links (also links sent from the phone app may be opened here): mocked client.
vi.hoisted(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
});

const auth = vi.hoisted(() => ({ session: null as null | { access_token: string }, getSession: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getSession: auth.getSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    rpc: vi.fn(),
  }),
}));

import { Auth } from "./Auth";
import { setViewMode } from "./view-mode";

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="*" element={<p>Elsewhere</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setViewMode("desktop");
  auth.getSession.mockReset().mockImplementation(async () => ({ data: { session: auth.session }, error: null }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe("desktop email links", () => {
  it("confirmation link with a session continues to Home", async () => {
    auth.session = { access_token: "t" };
    renderAt("/auth#access_token=t&type=signup");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/home"));
  });

  it("recovery link with a session shows the new-password form", async () => {
    auth.session = { access_token: "t" };
    renderAt("/auth?recovery=1#access_token=t&type=recovery");
    expect(await screen.findByRole("heading", { level: 1, name: "Set a new password." })).toBeInTheDocument();
  });

  it("expired recovery link offers a new reset link", async () => {
    auth.session = null;
    renderAt("/auth?recovery=1#error=access_denied&error_description=Email+link+is+invalid");
    expect(await screen.findByRole("heading", { level: 1, name: "Reset password." })).toBeInTheDocument();
    expect(screen.getByText(/invalid or has expired/)).toBeInTheDocument();
  });
});
