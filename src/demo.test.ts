import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demo } from "./demo";
import bank from "./demo-content.json";

beforeEach(() => localStorage.clear());

it("completes Classic and keeps reward idempotent after refresh", async () => {
  let s = await demo.play("classic", [], "easy");
  for (let i = 0; i < 10; i++) {
    const answer = bank.find(q => q.id === s.current!.id)!.correct;
    s = await demo.answer(s.id, s.current!.id, answer);
    if (s.status === "showing_feedback") s = await demo.next(s.id);
  }
  expect(s.status).toBe("completed");
  expect(s.stats.correct).toBe(10);
  const first = (await demo.dashboard()).profile.xp;
  await demo.view(s.id); await demo.view(s.id);
  expect((await demo.dashboard()).profile.xp).toBe(first);
});
it("rejects duplicate submissions", async () => {
  const s = await demo.play("classic", [], "easy");
  const q = s.current!;
  await demo.answer(s.id, q.id, q.options[0].id);
  await expect(demo.answer(s.id, q.id, q.options[0].id)).rejects.toThrow();
});
it("ends Endless after three errors", async () => {
  let s = await demo.play("endless", [], "easy");
  for (let i = 0; i < 3; i++) {
    const correct = bank.find(q => q.id === s.current!.id)!.correct;
    const wrong = s.current!.options.find(o => o.id !== correct)!;
    s = await demo.answer(s.id, s.current!.id, wrong.id);
    if (s.status === "showing_feedback") s = await demo.next(s.id);
  }
  expect(s.status).toBe("completed");
  expect(s.stats.incorrect).toBe(3);
});
it("does not substitute a missing tier", async () => {
  await expect(demo.play("classic", [], "expert")).rejects.toThrow(/exact selection/);
});

describe("timed runs pause the clock during feedback (same rules as arena_answer / arena_next)", () => {
  const T0 = Date.parse("2026-11-25T10:00:00Z");
  const at = (ms: number) => vi.setSystemTime(T0 + ms);
  const correctFor = (id: string) => bank.find(q => q.id === id)!.correct;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(0);
  });
  afterEach(() => vi.useRealTimers());

  it("starts with a 60 s deadline and keeps it fixed while feedback is shown", async () => {
    let s = await demo.play("timed", [], "easy");
    expect(Date.parse(s.deadline!)).toBe(T0 + 60_000);

    at(10_000);
    s = await demo.answer(s.id, s.current!.id, correctFor(s.current!.id));
    expect(s.status).toBe("showing_feedback");
    expect(Date.parse(s.deadline!)).toBe(T0 + 60_000);

    at(25_000);
    s = await demo.view(s.id);
    expect(s.status).toBe("showing_feedback");
    expect(Date.parse(s.deadline!)).toBe(T0 + 60_000);
  });

  it("moves the deadline by the feedback time on Next and measures responses without feedback time", async () => {
    let s = await demo.play("timed", [], "easy");
    at(10_000);
    s = await demo.answer(s.id, s.current!.id, correctFor(s.current!.id));
    at(25_000); // 15 s reading feedback
    s = await demo.next(s.id);
    expect(s.status).toBe("awaiting_answer");
    expect(Date.parse(s.deadline!)).toBe(T0 + 75_000);

    at(29_000); // answered 4 s after the next question appeared
    s = await demo.answer(s.id, s.current!.id, correctFor(s.current!.id));
    expect(s.stats.averageMs).toBe((10_000 + 4_000) / 2);
    at(30_000);
    s = await demo.next(s.id);
    expect(Date.parse(s.deadline!)).toBe(T0 + 76_000);
  });

  it("does not end a run on Next when only the feedback time crossed the original deadline", async () => {
    let s = await demo.play("timed", [], "easy");
    at(59_000);
    s = await demo.answer(s.id, s.current!.id, correctFor(s.current!.id));
    at(90_000); // the original deadline passed while feedback was open
    s = await demo.next(s.id);
    expect(s.status).toBe("awaiting_answer");
    expect(Date.parse(s.deadline!)).toBe(T0 + 91_000);
    expect(Date.parse(s.deadline!) - Date.now()).toBe(1_000);
  });

  it("completes the run when the deadline passes while a question is open", async () => {
    let s = await demo.play("timed", [], "easy");
    at(60_000);
    const late = await demo.answer(s.id, s.current!.id, correctFor(s.current!.id));
    expect(late.status).toBe("completed");
    expect(late.stats.correct + late.stats.incorrect).toBe(0);
    await expect(demo.answer(s.id, s.current!.id, correctFor(s.current!.id))).rejects.toThrow(/already over/);
    await expect(demo.next(s.id)).rejects.toThrow(/already over/);

    s = await demo.play("timed", [], "easy");
    at(130_000);
    expect((await demo.view(s.id)).status).toBe("completed");
  });

  it("like arena_view, a view after the unmoved deadline completes a run that is showing feedback", async () => {
    let s = await demo.play("timed", [], "easy");
    at(30_000);
    s = await demo.answer(s.id, s.current!.id, correctFor(s.current!.id));
    at(60_000);
    expect((await demo.view(s.id)).status).toBe("completed");
  });

  it("completes expired timed runs before counting active runs at start", async () => {
    for (let i = 0; i < 3; i++) await demo.play("timed", [], "easy");
    await expect(demo.play("classic", [], "easy")).rejects.toThrow(/Resume or abandon/);
    at(61_000);
    const fresh = await demo.play("classic", [], "easy");
    expect(fresh.status).toBe("awaiting_answer");
    const runs = (await demo.dashboard()).sessions;
    expect(runs.filter(run => run.mode === "timed").every(run => run.status === "completed")).toBe(true);
  });

  it("keeps untimed modes without a deadline", async () => {
    let s = await demo.play("classic", [], "easy");
    expect(s.deadline).toBeNull();
    s = await demo.answer(s.id, s.current!.id, correctFor(s.current!.id));
    at(3_600_000);
    s = await demo.next(s.id);
    expect(s.deadline).toBeNull();
    expect(s.status).toBe("awaiting_answer");
  });
});
