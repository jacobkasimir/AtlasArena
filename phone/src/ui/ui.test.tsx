import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  ActionBar,
  AnswerButton,
  AnswerList,
  BottomSheet,
  Button,
  Chip,
  ChipGroup,
  LinkCard,
  ProgressBar,
  StatusMessage,
  TextField,
  ToastProvider,
  useHaptics,
  useToast,
  useViewportHeight,
} from "@phone/ui";
import { reloadPrefs, setPref } from "@shared/prefs";
import { defaultPhonePrefs, getPhonePrefs, normalizePhonePrefs, reloadPhonePrefs, setPhonePref } from "@phone/prefs-phone";

afterEach(() => {
  cleanup();
  localStorage.clear();
  reloadPrefs();
  reloadPhonePrefs();
  vi.restoreAllMocks();
});

describe("Button", () => {
  it("is a non-submitting button by default and shows a busy state", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Start</Button>);
    const button = screen.getByRole("button", { name: "Start" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("ph-btn", "ph-btn-secondary");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button variant="primary" loading onClick={onClick}>
        Start
      </Button>,
    );
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});

describe("Chip and ProgressBar", () => {
  it("exposes toggle state with aria-pressed", () => {
    function Toggle() {
      const [on, setOn] = useState(false);
      return (
        <ChipGroup label="Region">
          <Chip pressed={on} onToggle={() => setOn(!on)}>
            Europe
          </Chip>
        </ChipGroup>
      );
    }
    render(<Toggle />);
    const chip = screen.getByRole("button", { name: "Europe" });
    expect(screen.getByRole("group", { name: "Region" })).toContainElement(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("reports progress to assistive technology and clamps values", () => {
    render(<ProgressBar value={12} max={10} label="Questions answered" />);
    const bar = screen.getByRole("progressbar", { name: "Questions answered" });
    expect(bar).toHaveAttribute("aria-valuenow", "10");
    expect(bar).toHaveAttribute("aria-valuetext", "10 of 10");
  });
});

describe("AnswerButton", () => {
  it("shows the result with text, not only colour, and locks after answering", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <AnswerList label="Answers">
        <AnswerButton index={0} onSelect={onSelect}>
          Paris
        </AnswerButton>
        <AnswerButton index={1} onSelect={onSelect}>
          Lyon
        </AnswerButton>
      </AnswerList>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Paris/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    rerender(
      <AnswerList label="Answers" layout="grid">
        <AnswerButton index={0} state="missed" onSelect={onSelect}>
          Paris
        </AnswerButton>
        <AnswerButton index={1} state="wrong" onSelect={onSelect}>
          Lyon
        </AnswerButton>
      </AnswerList>,
    );
    expect(screen.getByRole("button", { name: /Lyon.*Your answer, wrong/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Paris.*Correct answer/ })).toHaveAttribute("data-state", "missed");
    expect(screen.getByRole("group", { name: "Answers" })).toHaveClass("is-grid");
  });
});

describe("TextField", () => {
  it("labels the input and links the hint", () => {
    render(<TextField label="Country" hint="English, German or French" inputMode="text" />);
    const input = screen.getByLabelText("Country");
    expect(input).toHaveClass("ph-input");
    expect(input).toHaveAccessibleDescription("English, German or French");
  });
});

describe("BottomSheet", () => {
  // Closing a sheet goes back one history entry asynchronously; let that finish before the next test.
  afterEach(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  });

  function Harness({ onClose }: { onClose?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open options</button>
        <BottomSheet
          open={open}
          title="Round options"
          onClose={() => {
            onClose?.();
            setOpen(false);
          }}
          footer={<Button variant="primary">Apply</Button>}
        >
          <p>Pick a region</p>
        </BottomSheet>
      </>
    );
  }

  it("opens as a labelled modal dialog, traps focus and closes with Esc", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open options" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Round options" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("closes from the close button and on the device Back button", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Open options" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(onClose).toHaveBeenCalledTimes(1);
    // Closing removed the extra history entry again.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(window.history.state?.phoneOverlay).toBeFalsy();

    fireEvent.click(screen.getByRole("button", { name: "Open options" }));
    expect(window.history.state?.phoneOverlay).toBeTruthy();
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Toast and status", () => {
  it("announces toasts in a polite live region and removes them", () => {
    vi.useFakeTimers();
    function Saver() {
      const toast = useToast();
      return <button onClick={() => toast.show("Saved", { tone: "success" })}>Save</button>;
    }
    render(
      <ToastProvider>
        <Saver />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Saved").closest("[role=status]")).toHaveAttribute("aria-live", "polite");
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("uses role=alert for errors and offers a retry", () => {
    const retry = vi.fn();
    render(
      <StatusMessage tone="error" retry={retry}>
        Could not load
      </StatusMessage>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
  });
});

describe("Cards and action bar", () => {
  it("renders a tappable row link and a labelled action bar", () => {
    render(
      <MemoryRouter>
        <LinkCard to="/flags" title="Flags" text="Match flags" icon="flag" tone="flags" />
        <ActionBar label="Round actions">
          <Button variant="primary">Start</Button>
        </ActionBar>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /Flags/ })).toHaveAttribute("href", "/flags");
    expect(screen.getByRole("group", { name: "Round actions" })).toHaveClass("ph-actionbar");
  });
});

describe("hooks", () => {
  it("useHaptics respects the shared haptics preference", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    const { result } = renderHook(() => useHaptics());
    result.current.tap();
    expect(vibrate).toHaveBeenCalledTimes(1);
    setPref("haptics", false);
    result.current.tap();
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("useViewportHeight reports the keyboard covering the page", () => {
    const listeners: Record<string, () => void> = {};
    const viewport = {
      height: 800,
      offsetTop: 0,
      addEventListener: (name: string, listener: () => void) => {
        listeners[name] = listener;
      },
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const { result } = renderHook(() => useViewportHeight());
    expect(result.current.keyboardOpen).toBe(false);
    act(() => {
      viewport.height = 460;
      listeners.resize();
    });
    expect(result.current).toEqual({ height: 460, keyboardInset: 340, keyboardOpen: true });
  });
});

describe("phone preferences", () => {
  it("defaults, validates and stores the answer layout", () => {
    expect(getPhonePrefs()).toEqual(defaultPhonePrefs);
    expect(normalizePhonePrefs({ answerLayout: "spiral" })).toEqual(defaultPhonePrefs);
    setPhonePref("answerLayout", "grid");
    reloadPhonePrefs();
    expect(getPhonePrefs().answerLayout).toBe("grid");
  });
});
