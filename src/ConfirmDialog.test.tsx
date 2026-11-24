import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

afterEach(cleanup);

function Harness({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abandon round
      </button>
      {open && (
        <ConfirmDialog
          id="test"
          title="Abandon this round?"
          cancelLabel="Keep playing"
          confirmLabel="Abandon"
          onCancel={() => setOpen(false)}
          onConfirm={onConfirm}
        >
          This ends the round.
        </ConfirmDialog>
      )}
    </>
  );
}

it("focuses the safe choice, closes on Esc and returns focus to the opener", () => {
  const onConfirm = vi.fn();
  render(<Harness onConfirm={onConfirm} />);
  const opener = screen.getByRole("button", { name: "Abandon round" });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByRole("dialog", { name: "Abandon this round?" })).toBeInTheDocument();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep playing" }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.activeElement).toBe(opener);
  expect(onConfirm).not.toHaveBeenCalled();
});

it("keeps Tab inside the dialog", () => {
  render(<Harness onConfirm={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Abandon round" }));
  const keep = screen.getByRole("button", { name: "Keep playing" });
  const abandon = screen.getByRole("button", { name: "Abandon" });
  abandon.focus();
  fireEvent.keyDown(window, { key: "Tab" });
  expect(document.activeElement).toBe(keep);
  fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(abandon);
});
