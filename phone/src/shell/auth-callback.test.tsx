import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

// Email links need the online client: mock supabase-js so no real project is ever contacted.
vi.hoisted(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
});

const auth = vi.hoisted(() => ({
  session: null as null | { access_token: string; user: { id: string; is_anonymous: boolean; user_metadata: object } },
  getSession: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signOut: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getSession: auth.getSession,
      getUser: auth.getUser,
      updateUser: auth.updateUser,
      resetPasswordForEmail: auth.resetPasswordForEmail,
      signOut: auth.signOut,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    rpc: auth.rpc,
  }),
}));

import { setViewMode } from "@shared/view-mode";
import { PhoneApp } from "./PhoneApp";

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

const signedIn = { access_token: "t", user: { id: "u1", is_anonymous: false, user_metadata: {} } };

beforeEach(() => {
  // The player chose the phone app: after the link nothing hands over to the desktop app in jsdom.
  setViewMode("phone");
  auth.session = signedIn;
  auth.getSession.mockReset().mockImplementation(async () => ({ data: { session: auth.session }, error: null }));
  auth.getUser.mockReset().mockResolvedValue({ data: { user: signedIn.user }, error: null });
  auth.updateUser.mockReset().mockResolvedValue({ error: null });
  auth.resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  auth.rpc.mockReset().mockResolvedValue({ data: { profile: { username: "Ana" } }, error: null });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe("phone email links", { timeout: 15_000 }, () => {
  it("password reset link: phone-sized new-password form, validation, then home", async () => {
    renderAt("/sign-in?recovery=1#access_token=x&type=recovery");
    expect(await screen.findByRole("heading", { level: 1, name: "Set a new password." })).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    const password = screen.getByLabelText("Password");
    const repeat = screen.getByLabelText("Repeat new password");
    fireEvent.change(password, { target: { value: "a-long-secure-password" } });
    fireEvent.change(repeat, { target: { value: "a-different-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The passwords do not match.");
    expect(auth.updateUser).not.toHaveBeenCalled();

    fireEvent.change(repeat, { target: { value: "a-long-secure-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: "a-long-secure-password" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).not.toMatch(/sign-in/));
  });

  it("expired reset link: explains it and offers a new reset link", async () => {
    auth.session = null;
    renderAt("/sign-in?recovery=1#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid");
    expect(await screen.findByRole("heading", { level: 1, name: "Reset password." })).toBeInTheDocument();
    expect(screen.getByText(/invalid or has expired/)).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/sign-in?mode=reset");
  });

  it("sign-up confirmation link: signed in, continues to the app", async () => {
    renderAt("/sign-in?auth=callback#access_token=x&type=signup");
    await waitFor(() => expect(screen.getByTestId("where").textContent).not.toMatch(/sign-in/));
  });

  it("confirmation without a session (link opened elsewhere): asks to sign in", async () => {
    auth.session = null;
    renderAt("/sign-in?auth=callback");
    expect(await screen.findByRole("heading", { level: 1, name: "Good to see you." })).toBeInTheDocument();
    expect(screen.getByText("Your email is confirmed. Sign in to continue.")).toBeInTheDocument();
  });

  it("a reset requested on the phone links back to the phone app", async () => {
    auth.session = null;
    renderAt("/sign-in?mode=reset");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    await waitFor(() =>
      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("a@example.test", {
        redirectTo: `${window.location.origin}/phone/sign-in?recovery=1`,
      }),
    );
  });
});
