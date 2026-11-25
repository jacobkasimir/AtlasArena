// The typing area on the real local demo engine (no mocks): Recall plays end to end, Elimination is online-only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.hoisted(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
});

import EliminationArea from "./elimination";
import RecallArea from "./recall";
import { renderArea } from "./test-utils";

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("typing area in the demo", { timeout: 20_000 }, () => {
  it("starts a Recall round from the setup, accepts a typed country (the demo knows English names only) and shows it as found", async () => {
    renderArea("recall", <RecallArea />, "/recall?mode=countries&scope=un&region=Europe");
    const start = await screen.findByRole("button", { name: /^Start · \d+ countries/ });
    fireEvent.click(start);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/\/recall\/play\//));
    const field = (await screen.findByLabelText("Type a country")) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "iceland" } });
    await waitFor(() => expect(field.value).toBe(""));
    const europe = await screen.findByRole("region", { name: "Europe" });
    await waitFor(() => expect(within(europe).getByText("Iceland")).toBeInTheDocument());
  });

  it("shows Elimination as online-only", async () => {
    renderArea("elimination", <EliminationArea />, "/elimination");
    expect(await screen.findByText(/Elimination needs an online account/)).toBeInTheDocument();
  });
});
