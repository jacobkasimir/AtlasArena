import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import Review from "./Review";
import type { ReviewSession } from "./domain";

const { reviewView, reviewAnswer } = vi.hoisted(() => ({ reviewView: vi.fn(), reviewAnswer: vi.fn() }));
vi.mock("./api", () => ({ api: { reviewView, reviewAnswer } }));

const base: ReviewSession = {
  id: "r1", total: 2, correct: 0, answered: 0, completed: false, createdAt: "",
  items: [
    { position: 1, kind: "flag", prompt: "Which country does this flag belong to?", alpha2: "OM", flagSvgUrl: null,
      answered: false, answer: null, correct: null, solution: null, explanation: null, correctOption: null },
    { position: 2, kind: "quiz", prompt: "Largest desert?", options: [{ id: "a", label: "Sahara" }, { id: "b", label: "Gobi" }],
      answered: false, answer: null, correct: null, solution: null, explanation: null, correctOption: null },
  ],
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("answers mistakes one at a time and ends with a summary", async () => {
  reviewView.mockResolvedValue(base);
  const afterFlag = { ...base, answered: 1, correct: 1, items: [{ ...base.items[0], answered: true, answer: "Oman", correct: true, solution: "Oman" }, base.items[1]] };
  const afterQuiz = { ...afterFlag, answered: 2, completed: true, items: [afterFlag.items[0],
    { ...base.items[1], answered: true, answer: "b", correct: false, solution: "Sahara", correctOption: "a", explanation: "The Sahara is the largest hot desert." }] };
  reviewAnswer.mockResolvedValueOnce(afterFlag).mockResolvedValueOnce(afterQuiz);
  render(<MemoryRouter initialEntries={["/review/r1"]}><Routes><Route path="/review/*" element={<Review />} /></Routes></MemoryRouter>);

  fireEvent.change(await screen.findByPlaceholderText("Type the country"), { target: { value: "Oman" } });
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
  expect(await screen.findByText("Cleared – it won't come back.")).toBeInTheDocument();
  expect(reviewAnswer).toHaveBeenCalledWith("r1", 1, "Oman");

  fireEvent.click(screen.getByRole("button", { name: "Next →" }));
  fireEvent.click(await screen.findByRole("button", { name: /Gobi/ }));
  expect(await screen.findByText("Not yet – it stays on your list.")).toBeInTheDocument();
  expect(screen.getByText("The Sahara is the largest hot desert.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "See summary →" }));
  expect(await screen.findByText("1 of 2 cleared")).toBeInTheDocument();
});
