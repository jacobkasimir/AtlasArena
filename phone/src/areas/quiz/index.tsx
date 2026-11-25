// Quiz area: everything under /quiz/* (Classic, Practice, Timed, Endless; setup → play → results) and
// Review my mistakes (/quiz/review), which replays wrong quiz, flag and capital answers.
import { Route, Routes } from "react-router-dom";
import { QuizPlay } from "./QuizPlay";
import { QuizResults } from "./QuizResults";
import { ReviewPlay, ReviewStart } from "./QuizReview";
import { QuizSetup } from "./QuizSetup";
import "./quiz.css";

export default function QuizArea() {
  return (
    <Routes>
      <Route index element={<QuizSetup />} />
      <Route path="play/:id" element={<QuizPlay />} />
      <Route path="results/:id" element={<QuizResults />} />
      <Route path="review" element={<ReviewStart />} />
      <Route path="review/:id" element={<ReviewPlay />} />
      <Route path="*" element={<QuizSetup />} />
    </Routes>
  );
}
