// Demo parity: the phone Flags and Capitals screens run end to end on the device-local demo engines.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.hoisted(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
});
vi.mock("@shared/sound", () => ({ cue: vi.fn(), playSound: vi.fn() }));

import FlagsArea from "./flags";
import CapitalsArea from "./capitals";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/flags/*" element={<FlagsArea />} />
        <Route path="/capitals/*" element={<CapitalsArea />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("geo screens in the demo", () => {
  it("Flags: start a practice round and pick a flag", async () => {
    renderAt("/flags");
    fireEvent.click(await screen.findByRole("button", { name: /4 · How many/ }));
    fireEvent.click(await screen.findByRole("button", { name: "10 random" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: /Start round · 10 flags/ }));
    expect(await screen.findByText("Find the flag of")).toBeInTheDocument();
    const flags = await screen.findAllByRole("button", { name: /^Flag \d+$/ });
    expect(flags.length).toBe(10);
    fireEvent.click(flags[0]);
    expect(await screen.findByText(/Correct · first try|Wrong flag\./)).toBeInTheDocument();
  });

  it("Capitals: start a round, answer and skip", async () => {
    renderAt("/capitals");
    fireEvent.click(await screen.findByRole("button", { name: /4 · How many/ }));
    fireEvent.click(await screen.findByRole("button", { name: "10 random" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: /Start round · 10 questions/ }));
    const input = await screen.findByLabelText("Capital");
    fireEvent.change(input, { target: { value: "Atlantis" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Not quite · 0 points.")).toBeInTheDocument();
    expect(screen.getByText("Accepted capital names")).toBeInTheDocument();
  });
});
