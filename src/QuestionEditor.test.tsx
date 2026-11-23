import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QuestionEditor } from "./QuestionEditor";

const { adminQuestion, adminImport } = vi.hoisted(() => ({ adminQuestion: vi.fn(), adminImport: vi.fn() }));
vi.mock("./api", () => ({ api: { adminQuestion, adminImport } }));

const info = {
  record: {
    stableId: "geo-capital-fr", expectedVersion: 2, type: "mc", prompt: "What is the capital of France?", category: "geography",
    subcategory: "capitals", difficulty: "easy", countryCode: "FR",
    options: [{ id: "a", label: "Paris" }, { id: "b", label: "Lyon" }, { id: "c", label: "Nice" }, { id: "d", label: "Lille" }],
    correct: "a", explanation: "Paris is the capital.", source: "https://example.org/fr", sourceVerified: true,
    reviewStatus: "reviewed", lastReviewed: "2026-01-01", referenceYear: null, asset: null,
  },
  published: true, playedVersion: 2, latestVersion: 2, publishedVersion: 2, topics: ["capitals", "flags"],
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("publishes only after the source check and saves a new version with today's review", async () => {
  adminQuestion.mockResolvedValue(info);
  adminImport.mockResolvedValue({ ok: true, errors: [], count: 1 });
  const onSaved = vi.fn();
  render(<QuestionEditor questionId="q1" onClose={() => {}} onSaved={onSaved} />);

  const prompt = await screen.findByDisplayValue("What is the capital of France?");
  fireEvent.change(prompt, { target: { value: "Which city is the capital of France?" } });
  fireEvent.change(screen.getByLabelText("Answer 2"), { target: { value: "Marseille" } });
  fireEvent.click(screen.getByRole("button", { name: "medium" }));
  const publish = screen.getByRole("button", { name: "Save and publish" });
  expect(publish).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(publish);

  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  const [records, dryRun, policy, shouldPublish] = adminImport.mock.calls[0];
  expect([dryRun, policy, shouldPublish]).toEqual([false, "version", true]);
  expect(records[0]).toMatchObject({
    stableId: "geo-capital-fr", expectedVersion: 2, prompt: "Which city is the capital of France?", difficulty: "medium",
    reviewStatus: "reviewed", sourceVerified: true,
  });
  expect(records[0].options[1].label).toBe("Marseille");
  expect(records[0].lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

it("saves a draft without publishing and shows server validation errors", async () => {
  adminQuestion.mockResolvedValue(info);
  adminImport.mockResolvedValue({ ok: false, errors: [{ row: 1, message: "HTTPS source required" }], count: 1 });
  render(<QuestionEditor questionId="q1" onClose={() => {}} onSaved={() => {}} />);
  await screen.findByDisplayValue("What is the capital of France?");
  fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("HTTPS source required");
  expect(adminImport.mock.calls[0][3]).toBe(false);
  expect(adminImport.mock.calls[0][0][0].reviewStatus).toBe("draft");
});
