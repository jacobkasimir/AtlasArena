import { useEffect, useState } from "react";
import { Review } from "./domain";

export function useLoad<T>(load: () => Promise<T>, key: string | number = "") {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setData(undefined); setError("");
    load().then(x => { if (alive) setData(x); })
      .catch(e => { if (alive) setError(String(e.message ?? e)); });
    return () => { alive = false; };
    // The explicit key controls re-fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);
  return { data, error, reload: () => setNonce(n => n + 1) };
}
export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  if (!message) return null;
  return <div className="error" role="alert" aria-live="assertive">
    <p>{message}</p>
    {retry && <button className="secondary mt-3" onClick={retry}>Try again</button>}
  </div>;
}
export function Loading() {
  return <div className="loading-panel" role="status" aria-live="polite">
    <span className="loading-indicator" aria-hidden="true"/>
    <span className="muted">Loading your next adventure…</span>
  </div>;
}
export function OfflineBanner(){const [online,setOnline]=useState(()=>typeof navigator==="undefined"?true:navigator.onLine);useEffect(()=>{const on=()=>setOnline(true),off=()=>setOnline(false);window.addEventListener("online",on);window.addEventListener("offline",off);return()=>{window.removeEventListener("online",on);window.removeEventListener("offline",off)}},[]);return online?null:<div className="offline-banner" role="status" aria-live="polite"><span aria-hidden="true">◌</span> You’re offline. Local demo progress is available; account features need a connection.</div>}
export function Feedback({ review }: { review: Review }) {
  return <section className={`feedback-card ${review.correct ? "is-correct" : "is-incorrect"}`} aria-live="polite" aria-atomic="true">
    <p className="font-bold">
      <span aria-hidden="true">{review.correct ? "✓" : "✕"}</span> {review.correct ? "Correct" : "Not quite"} · +{review.points} points
    </p>
    <p className="mt-2 font-semibold">Correct answer: {review.correctAnswer}</p>
    {!review.correct && <p className="muted">Your answer: {review.chosen}</p>}
    <p className="mt-3">{review.explanation}</p>
    <a className="text-mint underline mt-3 inline-block"
       href={review.source} target="_blank" rel="noopener noreferrer">Source reference</a>
  </section>;
}
export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
