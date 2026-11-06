import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Feedback } from "./components";

it("communicates incorrectness without depending on color", () => {
  render(<Feedback review={{
    questionId: "q", prompt: "Capital?", chosen: "Wrong city",
    correctAnswer: "Helsinki", correct: false,
    explanation: "Helsinki is Finland's capital.",
    source: "https://example.org", points: 0, responseMs: 1200,
    subcategory: "capitals"
  }}/>);
  expect(screen.getByText(/Not quite/)).toBeInTheDocument();
  expect(screen.getByText(/Correct answer: Helsinki/)).toBeInTheDocument();
  expect(screen.getByText(/Your answer: Wrong city/)).toBeInTheDocument();
});
