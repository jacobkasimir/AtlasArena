import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReviewQueue, reviewHints } from "./AdminReview";

const { adminReviewNext, adminReviewApprove } = vi.hoisted(() => ({ adminReviewNext: vi.fn(), adminReviewApprove: vi.fn() }));
vi.mock("./api", () => ({ api: { adminReviewNext, adminReviewApprove, adminQuestion: vi.fn(), adminImport: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const item = (stableId: string, prompt: string) => ({
  stableId, expectedVersion: 1, type: "mc", prompt, category: "geography", subcategory: "capitals", difficulty: "easy",
  countryCode: "DE", countryName: "Germany", questionId: `${stableId}-id`,
  options: [{ id: "a", label: "Berlin" }, { id: "b", label: "Rome" }, { id: "c", label: "Madrid" }, { id: "d", label: "Tokyo" }],
  correct: "a", explanation: "Berlin is the capital of Germany.", source: "https://www.cia.gov/the-world-factbook/",
  sourceVerified: false, reviewStatus: "draft", lastReviewed: null, referenceYear: null, asset: null,
});

it("shows one draft at a time, skips, and only approves after the source check", async () => {
  adminReviewNext.mockImplementation(async (offset: number) => ({
    remaining: 2, offset, item: offset === 0 ? item("geo-de", "Which city is the capital of Germany?") : item("geo-fr", "Capital of France?"),
  }));
  adminReviewApprove.mockResolvedValue({});
  render(<ReviewQueue />);

  expect(await screen.findByText("Which city is the capital of Germany?")).toBeInTheDocument();
  expect(screen.getByText("2 draft questions waiting")).toBeInTheDocument();
  expect(screen.getByText(/general start page/)).toBeInTheDocument();
  const approve = screen.getByRole("button", { name: "Approve and publish" });
  expect(approve).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "Skip →" }));
  expect(await screen.findByText("Capital of France?")).toBeInTheDocument();
  expect(adminReviewNext).toHaveBeenLastCalledWith(1);

  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Approve and publish" }));
  await waitFor(() => expect(adminReviewApprove).toHaveBeenCalledWith("geo-fr", 1, true));
});

it("flags missing reference years and short explanations", () => {
  const hints = reviewHints({ source: "https://example.org/a/b", subcategory: "population", referenceYear: null, explanation: "Short.", options: [] });
  expect(hints).toHaveLength(2);
});
