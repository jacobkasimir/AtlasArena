// Building blocks shared by the phone Flags and Capitals screens (geo area only).
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@shared/icons";
import { CALM_ROUND_MS, usePrefs } from "@shared/prefs";
import { formatClock } from "@shared/game-setup";
import { BottomSheet, Button, TimerBar } from "@phone/ui";
import { Feedback, localFlagSrc } from "./geo-logic";

/**
 * Flag picture from /public/flags only. `label` is the accessible name; pass "" when the surrounding
 * control already names it (then the image is decorative).
 */
export function FlagPicture({
  url,
  label,
  className = "",
  eager = false,
}: {
  url: string | null | undefined;
  label: string;
  className?: string;
  eager?: boolean;
}) {
  const src = localFlagSrc(url);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <span className={`ph-geo-flag ${className}`} {...a11y}>
      {src && !broken ? (
        <img src={src} alt="" loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setBroken(true)} />
      ) : (
        <span className="ph-geo-flag-missing">Flag unavailable</span>
      )}
    </span>
  );
}

/**
 * Elapsed / remaining time of a server round, corrected for the gap between this device's clock and the
 * server's. `elapsedMs` is the server's value at `serverNow` (pauses already left out).
 */
export function useRoundTimer(
  round: { serverNow: string; elapsedMs: number | null; deadlineAt?: string | null } | null | undefined,
  running: boolean,
) {
  const receivedAt = useMemo(() => Date.now(), [round?.serverNow]); // eslint-disable-line react-hooks/exhaustive-deps
  const offset = round ? Date.parse(round.serverNow) - receivedAt : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [running]);
  const sinceReceived = running ? Math.max(0, now - receivedAt) : 0;
  const elapsed = (round?.elapsedMs ?? 0) + sinceReceived;
  const remaining = round?.deadlineAt ? Math.max(0, Date.parse(round.deadlineAt) - (now + offset)) : null;
  return { elapsed, remaining };
}

/**
 * Round clock. Untimed rounds show the elapsed time; timed rounds get the shared TimerBar (calm-timer setting,
 * warning state and timerWarning/timeUp feedback in the last 30 seconds). The server owns the deadline.
 */
export function RoundClock({
  remaining,
  elapsed,
  totalMs,
}: {
  remaining: number | null;
  elapsed: number;
  totalMs?: number | null;
}) {
  if (remaining === null)
    return (
      <span className="ph-geo-clock" role="timer" aria-label={`Time ${formatClock(elapsed)}`}>
        <Icon name="timer" size={16} /> {formatClock(elapsed)}
      </span>
    );
  return (
    <span className="ph-geo-timer">
      <TimerBar
        msLeft={remaining}
        totalMs={Math.max(remaining, totalMs ?? remaining)}
        warnAtMs={CALM_ROUND_MS}
        calmFromMs={CALM_ROUND_MS}
      />
    </span>
  );
}

export type AnswerFx = "pop" | "shake" | null;

/**
 * Pop (right) or shake (wrong) for the element that holds the answer (flag picture, typed-answer row): put
 * `className` on it. A typed question is judged once, so the class appears once per question; `clear` on the
 * next question. No re-mount, so the input keeps focus and the keyboard stays open.
 * Motion only decorates: the feedback line always says the result in words.
 */
export function useAnswerFx() {
  const [fx, setFx] = useState<{ kind: AnswerFx }>({ kind: null });
  const play = useCallback((kind: AnswerFx) => setFx({ kind }), []);
  const clear = useCallback(() => setFx({ kind: null }), []);
  const className = fx.kind === "pop" ? "ph-pop" : fx.kind === "shake" ? "ph-shake" : "";
  return { fx: fx.kind, play, clear, className };
}

/**
 * The right answer, big, after a miss (learn it right away), with optional extra lines (other accepted names,
 * a flag picture). Announced politely.
 */
export function AnswerReveal({
  label = "Correct answer",
  answer,
  children,
  media,
}: {
  label?: string;
  answer: string;
  children?: ReactNode;
  media?: ReactNode;
}) {
  return (
    <div className="ph-geo-answer-reveal" role="status">
      {media}
      <span className="ph-geo-answer-reveal-label">
        <Icon name="checkCircle" size={18} /> {label}
      </span>
      <strong className="ph-geo-answer-reveal-name">{answer}</strong>
      {children}
    </div>
  );
}

/** Feedback line: tone colour plus an icon and words, so it never relies on colour alone. */
export function FeedbackLine({ feedback }: { feedback: Feedback }) {
  return (
    <div className="ph-geo-feedback-slot" role="status" aria-live="polite">
      {feedback && (
        <p className="ph-geo-feedback" data-tone={feedback.tone}>
          <Icon
            name={feedback.tone === "success" ? "checkCircle" : feedback.tone === "info" ? "flag" : "warning"}
            size={20}
          />
          <span>{feedback.text}</span>
        </p>
      )}
    </div>
  );
}

/**
 * The "Pause or leave" sheet of a running round: keep playing, save and leave, give up (with an optional
 * confirmation step from Settings → "Ask before giving up").
 */
export function RoundMenuSheet({
  open,
  onClose,
  timed,
  busy,
  onLeave,
  onGiveUp,
  leaveLabel,
}: {
  open: boolean;
  onClose: () => void;
  timed: boolean;
  busy: boolean;
  onLeave: () => void;
  onGiveUp: () => void;
  leaveLabel?: string;
}) {
  const prefs = usePrefs();
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!open) setConfirming(false);
  }, [open]);
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      canClose={() => !busy}
      title={confirming ? "Give up this round?" : timed ? "Leave the round?" : "Paused"}
    >
      {confirming ? (
        <div className="ph-stack">
          <p>This ends the round for good. It won't count towards your personal bests.</p>
          <Button variant="danger" size="lg" block loading={busy} onClick={onGiveUp}>
            Give up round
          </Button>
          <Button size="lg" block disabled={busy} onClick={() => setConfirming(false)}>
            Keep playing
          </Button>
        </div>
      ) : (
        <div className="ph-stack">
          <p className="ph-muted">
            {timed
              ? "Your answers are saved, but a timed round can't be paused: the clock keeps running while you are away."
              : "Your round is saved. Resume it later from the setup screen."}
          </p>
          <Button variant="primary" size="lg" block disabled={busy} onClick={onClose}>
            Keep playing
          </Button>
          <Button size="lg" block loading={busy} onClick={onLeave}>
            {leaveLabel ?? (timed ? "Leave (clock keeps running)" : "Save and leave")}
          </Button>
          <Button
            variant="danger"
            size="lg"
            block
            disabled={busy}
            onClick={() => (prefs.confirmGiveUp ? setConfirming(true) : onGiveUp())}
          >
            Give up round
          </Button>
        </div>
      )}
    </BottomSheet>
  );
}

/** Yes/no sheet; the safe answer comes first. */
export function ConfirmSheet({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onCancel}
      title={title}
      canClose={() => !busy}
      footer={
        <>
          <Button size="lg" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button size="lg" variant="danger" loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{children}</p>
    </BottomSheet>
  );
}

/** Small round tags (catalog, picks, practice, time limit) as text. */
export function RoundTags({ tags }: { tags: (string | null | false | undefined)[] }) {
  const list = tags.filter(Boolean) as string[];
  if (!list.length) return null;
  return (
    <ul className="ph-geo-tags" aria-label="Round settings">
      {list.map((tag) => (
        <li key={tag}>{tag}</li>
      ))}
    </ul>
  );
}

export function roundTagList(round: {
  scope?: string;
  pool: string;
  picks?: number;
  sampleSize?: number | null;
  timeLimitSeconds?: number | null;
}) {
  return [
    round.scope === "un" ? "UN member states" : null,
    round.pool === "easy" ? "Well-known" : round.pool === "manual" ? `${round.picks ?? 0} picked` : null,
    round.sampleSize ? `Practice · ${round.sampleSize} random` : null,
    round.timeLimitSeconds ? `${round.timeLimitSeconds / 60} min limit` : null,
  ];
}

/**
 * Guards "Next" against the tap that produced the feedback landing twice: returns a function that tells
 * whether a tap is allowed now. `key` changes whenever new feedback appears.
 */
export function useTapGuard(key: string | null, ms: number) {
  const shownAt = useRef(0);
  useEffect(() => {
    if (key) shownAt.current = Date.now();
  }, [key]);
  return () => Date.now() - shownAt.current >= ms;
}

/** Text from an error, with known server codes turned into plain English. */
export function errorText(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes("RATE_LIMIT")) return "Slow down a little – try again in a minute.";
  if (message.includes("AUTH_REQUIRED")) return "Your session has ended. Sign in again to keep playing.";
  return message;
}
