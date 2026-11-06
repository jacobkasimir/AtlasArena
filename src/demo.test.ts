import { beforeEach, expect, it } from "vitest";
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
