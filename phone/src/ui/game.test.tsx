import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { level } from "@shared/domain";
import { reloadPrefs, setPref } from "@shared/prefs";
import {
  ComboToast,
  GameButton,
  LinkGameButton,
  ResultHero,
  SegmentedControl,
  StreakMeter,
  TimerBar,
  XP_PER_LEVEL,
  feelPattern,
  medalTier,
  resetFeelCooldowns,
  useCountUp,
} from "@phone/ui";

let vibrate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
  resetFeelCooldowns();
  vibrate = vi.fn();
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  reloadPrefs();
  delete document.documentElement.dataset.motion;
});

describe("useCountUp", () => {
  it("counts up to the target and ends exactly on it", async () => {
    const { result } = renderHook(() => useCountUp(250, { durationMs: 120 }));
    expect(result.current).toBe(0);
    await waitFor(() => expect(result.current).toBe(250));
  });

  it("jumps to the target under reduced motion or when disabled", () => {
    expect(renderHook(() => useCountUp(80, { enabled: false })).result.current).toBe(80);
    setPref("reduceMotion", true);
    expect(renderHook(() => useCountUp(42)).result.current).toBe(42);
  });

  it("restarts from the current target when the target changes", async () => {
    const { result, rerender } = renderHook(({ value }) => useCountUp(value, { durationMs: 60 }), { initialProps: { value: 10 } });
    await waitFor(() => expect(result.current).toBe(10));
    rerender({ value: 30 });
    await waitFor(() => expect(result.current).toBe(30));
  });
});

describe("GameButton", () => {
  it("is a chunky button that gives a tap on press and calls onClick", () => {
    const onClick = vi.fn();
    render(
      <GameButton variant="tone" tone="flags" size="xl" block onClick={onClick}>
        Play again
      </GameButton>,
    );
    const button = screen.getByRole("button", { name: "Play again" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("ph-gbtn", "ph-gbtn-tone", "tone-flags", "ph-gbtn-xl", "ph-gbtn-block");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(feelPattern("tap"));
  });

  it("supports a custom or no haptic, and loading disables it", () => {
    const { rerender } = render(<GameButton haptic={false}>Next</GameButton>);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(vibrate).not.toHaveBeenCalled();
    rerender(<GameButton loading>Next</GameButton>);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toHaveAttribute("aria-busy", "true");
  });

  it("has a link variant for navigation", () => {
    render(
      <MemoryRouter>
        <LinkGameButton to="/flags">Flags</LinkGameButton>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Flags" })).toHaveAttribute("href", "/flags");
  });
});

describe("medal tiers", () => {
  it("map accuracy to gold / silver / bronze / none", () => {
    expect(medalTier(9, 10)).toBe("gold");
    expect(medalTier(10, 10)).toBe("gold");
    expect(medalTier(89, 100)).toBe("silver");
    expect(medalTier(7, 10)).toBe("silver");
    expect(medalTier(5, 10)).toBe("bronze");
    expect(medalTier(4, 10)).toBe("none");
    expect(medalTier(0, 0)).toBe("none");
  });

  it("XP_PER_LEVEL matches the shared level()", () => {
    expect(level(XP_PER_LEVEL - 1)).toBe(1);
    expect(level(XP_PER_LEVEL)).toBe(2);
  });
});

describe("ResultHero", () => {
  function hero(props: Partial<Parameters<typeof ResultHero>[0]> = {}) {
    return render(
      <ResultHero headline="Great round!" tone="flags" icon="flag" score={420} correct={9} total={10} ranked {...props} />,
    );
  }

  it("shows the tier as text and stars, the score, accuracy and time", () => {
    hero({ timeMs: 65_000 });
    expect(screen.getByRole("heading", { level: 2, name: "Great round!" })).toBeInTheDocument();
    expect(screen.getByText("Gold")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "3 of 3 stars" })).toBeInTheDocument();
    expect(screen.getByText("Points: 420")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("1:05")).toBeInTheDocument();
  });

  it.each([
    [7, "Silver", 2],
    [5, "Bronze", 1],
    [2, "No medal yet", 0],
  ])("%i of 10 gives %s", (correct, name, stars) => {
    hero({ correct });
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: `${stars} of 3 stars` })).toBeInTheDocument();
  });

  it("shows the new-best ribbon only for ranked rounds and a practice badge otherwise", () => {
    const { unmount } = hero({ newBest: true, previousBest: 300 });
    expect(screen.getByTestId("ph-new-best")).toHaveTextContent("New personal best (was 300)");
    unmount();
    hero({ ranked: false, newBest: true });
    expect(screen.queryByTestId("ph-new-best")).toBeNull();
    expect(screen.getByText(/Practice · not ranked/)).toBeInTheDocument();
  });

  it("fills the XP bar and celebrates a level-up once", () => {
    const { rerender } = hero({ correct: 4, xpGained: 120, xpTotal: XP_PER_LEVEL + 20 });
    expect(screen.getByText("+120 XP")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Level up! You reached level 2.");
    expect(screen.getByRole("progressbar", { name: "Level 2 progress" })).toHaveAttribute("aria-valuenow", "20");
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(feelPattern("levelUp"));
    rerender(<ResultHero headline="Great round!" tone="flags" icon="flag" score={420} correct={4} total={10} ranked xpGained={120} xpTotal={XP_PER_LEVEL + 20} />);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("uses the reward feedback for gold, complete otherwise, and none when asked", () => {
    const first = hero();
    expect(vibrate).toHaveBeenLastCalledWith(feelPattern("reward"));
    first.unmount();
    resetFeelCooldowns();
    const second = hero({ correct: 3, xpGained: 10, xpTotal: 50 });
    expect(vibrate).toHaveBeenLastCalledWith(feelPattern("complete"));
    expect(screen.queryByRole("status")).toBeNull();
    second.unmount();
    vibrate.mockClear();
    hero({ feedback: false });
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("renders the confetti burst only when motion is allowed", () => {
    const { unmount } = hero();
    expect(screen.getByTestId("ph-burst").children.length).toBeLessThanOrEqual(30);
    unmount();
    setPref("reduceMotion", true);
    hero();
    expect(screen.queryByTestId("ph-burst")).toBeNull();
  });
});

describe("streak, combo and timer", () => {
  it("StreakMeter announces the streak as text and turns hot from 3", () => {
    const { container, rerender } = render(<StreakMeter streak={2} best={5} />);
    expect(screen.getByText("Streak 2, best 5")).toBeInTheDocument();
    expect(container.querySelector(".ph-streak")).not.toHaveAttribute("data-hot");
    rerender(<StreakMeter streak={3} />);
    expect(container.querySelector(".ph-streak")).toHaveAttribute("data-hot", "true");
  });

  it("ComboToast shows milestones in a live region and hides again", () => {
    vi.useFakeTimers();
    const { rerender } = render(<ComboToast streak={2} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    rerender(<ComboToast streak={3} />);
    expect(screen.getByRole("status")).toHaveTextContent("3 in a row!");
    act(() => {
      vi.advanceTimersByTime(1700);
    });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("TimerBar warns once, signals time up once and respects the calm setting", () => {
    const { rerender } = render(<TimerBar msLeft={20_000} totalMs={30_000} />);
    expect(screen.getByRole("timer", { name: "Time left: 20 seconds" })).not.toHaveAttribute("data-warn");
    rerender(<TimerBar msLeft={9_000} totalMs={30_000} />);
    expect(screen.getByRole("timer")).toHaveAttribute("data-warn", "true");
    expect(vibrate).toHaveBeenCalledWith(feelPattern("timerWarning"));
    rerender(<TimerBar msLeft={8_000} totalMs={30_000} />);
    expect(vibrate).toHaveBeenCalledTimes(1);
    rerender(<TimerBar msLeft={0} totalMs={30_000} />);
    expect(vibrate).toHaveBeenLastCalledWith(feelPattern("timeUp"));
    cleanup();
    setPref("timerDisplay", "calm");
    render(<TimerBar msLeft={25_000} totalMs={30_000} />);
    expect(screen.getByRole("timer", { name: "Time left: timed round" })).toHaveTextContent("Timed");
  });
});

describe("SegmentedControl", () => {
  it("is a radiogroup with arrow keys", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Answer layout"
        value="list"
        onChange={onChange}
        options={[
          { value: "list", label: "List" },
          { value: "grid", label: "Grid" },
        ]}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "Answer layout" });
    expect(screen.getByRole("radio", { name: "List" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("grid");
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
