// useBackGuard with a real BrowserRouter (basename /phone) on jsdom's history, in StrictMode: the sentinel is
// pushed once, Back opens the sheet instead of leaving, Back with the sheet open only closes it, leaving and
// finishing remove every entry of ours, and unmounting cleans up.
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { BottomSheet } from "./BottomSheet";
import { hasPendingOwnPops, useBackGuard } from "./useBackGuard";

let leaves = 0;

function Round() {
  const navigate = useNavigate();
  const [sheet, setSheet] = useState(false);
  const [done, setDone] = useState(false);
  const { release, releasing } = useBackGuard(!done, () => setSheet(true));
  const leave = () =>
    release(() => {
      leaves += 1;
      navigate("/quiz", { replace: true });
    });
  return (
    <>
      <p>Round</p>
      <button type="button" onClick={() => setSheet(true)}>
        Pause or leave
      </button>
      <button type="button" onClick={() => setDone(true)}>
        Last answer
      </button>
      <button type="button" onClick={() => release(() => navigate("/quiz/results/r1", { replace: true }))}>
        See results
      </button>
      <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Paused" canClose={() => !releasing}>
        <button type="button" onClick={() => setSheet(false)}>
          Continue playing
        </button>
        <button type="button" disabled={releasing} onClick={leave}>
          Save and leave
        </button>
      </BottomSheet>
    </>
  );
}

function App() {
  return (
    <BrowserRouter basename="/phone">
      <Routes>
        <Route path="/home" element={<p>Home</p>} />
        <Route path="/quiz" element={<p>Setup</p>} />
        <Route path="/quiz/play/:id" element={<Round />} />
        <Route path="/quiz/results/:id" element={<p>Results</p>} />
      </Routes>
    </BrowserRouter>
  );
}

const path = () => window.location.pathname;
const guarded = () => typeof (window.history.state as Record<string, unknown> | null)?.phoneBackGuard === "string";
// Condition-based waits (no fixed sleeps: under parallel load jsdom's history traversal can take longer).
let pops = 0;
window.addEventListener("popstate", () => {
  pops += 1;
});

/** Waits until none of our own history.go() calls is queued or on its way and deferred work has run. */
async function settle() {
  await waitFor(() => expect(hasPendingOwnPops()).toBe(false));
  // Deferred cleanups (setTimeout 0) and React updates scheduled by the last pop.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  await waitFor(() => expect(hasPendingOwnPops()).toBe(false));
}

/** Device Back: waits for the popstate it causes, then for everything it set off. */
async function back() {
  const before = pops;
  act(() => {
    window.history.back();
  });
  await waitFor(() => expect(pops).toBeGreaterThan(before));
  await settle();
}

/** History: …, /phone/home, /phone/quiz/play/r1 (current). Returns history.length before mounting. */
async function startRound() {
  window.history.pushState(null, "", "/phone/home");
  window.history.pushState(null, "", "/phone/quiz/play/r1");
  const before = window.history.length;
  const view = render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByText("Round");
  await waitFor(() => expect(guarded()).toBe(true));
  await settle();
  return { before, view };
}

afterEach(async () => {
  cleanup();
  await settle();
});

describe("useBackGuard", () => {
  it("pushes the sentinel once, also under StrictMode's double effects", async () => {
    const { before } = await startRound();
    expect(window.history.length).toBe(before + 1);
    expect(guarded()).toBe(true);
    expect(path()).toBe("/phone/quiz/play/r1");
  });

  it("Back opens the pause sheet and stays in the round; Back again only closes the sheet", async () => {
    await startRound();
    await back();
    expect(await screen.findByRole("dialog", { name: "Paused" })).toBeInTheDocument();
    expect(path()).toBe("/phone/quiz/play/r1");
    expect(screen.getByText("Round")).toBeInTheDocument();

    await back(); // closes the sheet (its own entry), the guard must not reopen it
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(path()).toBe("/phone/quiz/play/r1");
    expect(guarded()).toBe(true);

    await back(); // and the guard still works afterwards
    expect(await screen.findByRole("dialog", { name: "Paused" })).toBeInTheDocument();
  });

  it("closing the sheet with a button keeps exactly the sentinel", async () => {
    const { before } = await startRound();
    fireEvent.click(screen.getByRole("button", { name: "Pause or leave" }));
    await screen.findByRole("dialog", { name: "Paused" });
    fireEvent.click(screen.getByRole("button", { name: "Continue playing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(guarded()).toBe(true));
    await settle();
    await back();
    expect(await screen.findByRole("dialog", { name: "Paused" })).toBeInTheDocument();
    expect(window.history.length).toBe(before + 2); // sentinel + the sheet's entry, nothing else
  });

  it("Save and leave navigates once and leaves no entry behind (Back goes to where the player was)", async () => {
    leaves = 0;
    await startRound();
    await back();
    const sheet = await screen.findByRole("dialog", { name: "Paused" });
    const leave = sheet.querySelector("button:nth-of-type(2)") as HTMLButtonElement;
    fireEvent.click(leave);
    fireEvent.click(leave); // double tap
    await back(); // Back pressed at the same time
    await waitFor(() => expect(path()).toBe("/phone/quiz"));
    await settle();
    expect(screen.getByText("Setup")).toBeInTheDocument();
    expect(leaves).toBe(1);
    await back();
    await waitFor(() => expect(path()).toBe("/phone/home"));
  });

  it("does not trap the player after the results", async () => {
    await startRound();
    fireEvent.click(screen.getByRole("button", { name: "Last answer" })); // round over: sentinel removed
    await waitFor(() => expect(guarded()).toBe(false));
    await settle();
    expect(path()).toBe("/phone/quiz/play/r1");
    fireEvent.click(screen.getByRole("button", { name: "See results" }));
    await waitFor(() => expect(path()).toBe("/phone/quiz/results/r1"));
    await back();
    await waitFor(() => expect(path()).toBe("/phone/home"));
  });

  it("removes the sentinel when the screen unmounts", async () => {
    const { view } = await startRound();
    expect(guarded()).toBe(true);
    view.unmount();
    await waitFor(() => expect(guarded()).toBe(false));
    await settle();
    expect(path()).toBe("/phone/quiz/play/r1");
  });
});
