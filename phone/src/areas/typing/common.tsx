// Small building blocks shared by the phone Recall and Elimination screens (typing area only).
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Icon } from "@shared/icons";
import { formatClock } from "@shared/game-setup";
import { CALM_ROUND_MS, showCountdown, usePrefs } from "@shared/prefs";
import { BottomSheet, Button } from "@phone/ui";

export const requestId = () => crypto.randomUUID();

/** Flags are served from /public/flags (CLAUDE.md rule 15). */
export const flagSrc = (code: string | null | undefined) => (code ? `/flags/${code.toLowerCase()}.svg` : null);

/** Decorative flag; hides itself when the file is missing. */
export function Flag({ code, className = "" }: { code: string | null | undefined; className?: string }) {
  const [broken, setBroken] = useState(false);
  const src = flagSrc(code);
  if (!src || broken) return <span className={`ph-typing-flag is-empty ${className}`} aria-hidden="true" />;
  return (
    <img
      className={`ph-typing-flag ${className}`}
      src={src}
      alt=""
      width={28}
      height={20}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

/**
 * Round clock with the "calm timer" setting: a timed round shows "Timed" until the last 30 seconds.
 * `remaining` is null for untimed rounds (then `elapsed` counts up).
 */
export function RoundClock({ remaining, elapsed }: { remaining: number | null; elapsed?: number }) {
  const prefs = usePrefs();
  if (remaining === null) {
    return (
      <span className="ph-typing-clock" role="timer" aria-label={`Time ${formatClock(elapsed ?? 0)}`}>
        <Icon name="timer" size={16} /> {formatClock(elapsed ?? 0)}
      </span>
    );
  }
  if (!showCountdown(prefs, remaining)) {
    return (
      <span
        className="ph-typing-clock is-calm"
        role="timer"
        aria-label={`Timed round, the countdown appears for the last ${CALM_ROUND_MS / 1000} seconds`}
      >
        <Icon name="timer" size={16} /> Timed
      </span>
    );
  }
  const low = remaining <= 30_000;
  return (
    <span className={`ph-typing-clock${low ? " is-low" : ""}`} role="timer" aria-label={`${formatClock(remaining)} left`}>
      <Icon name="timer" size={16} /> {formatClock(remaining)}
    </span>
  );
}

/**
 * Elapsed and remaining time of a server round, corrected for the difference between this device's clock
 * and the server's. Ticks only while `running`.
 */
export function useRoundClock(
  round: { createdAt?: string; deadlineAt: string | null; serverNow: string } | undefined | null,
  running: boolean,
) {
  const offset = useMemo(() => (round ? Date.parse(round.serverNow) - Date.now() : 0), [round?.serverNow]); // eslint-disable-line react-hooks/exhaustive-deps
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [running]);
  const serverNow = now + offset;
  const elapsed = round?.createdAt ? Math.max(0, serverNow - Date.parse(round.createdAt)) : 0;
  const remaining = round?.deadlineAt ? Math.max(0, Date.parse(round.deadlineAt) - serverNow) : null;
  return { elapsed, remaining };
}

/** Yes/no question in a bottom sheet. The safe answer (cancel) gets focus first. */
export function ConfirmSheet({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
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
          <Button size="lg" variant={danger ? "danger" : "primary"} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="ph-typing-confirm-text">{children}</div>
    </BottomSheet>
  );
}

/** Two or more tabs over one panel (results: Missed / Found). Arrow keys move between tabs. */
export function Tabs<T extends string>({
  label,
  value,
  onChange,
  tabs,
  idBase,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  tabs: { id: T; label: ReactNode }[];
  idBase: string;
}) {
  return (
    <div
      className="ph-typing-tabs"
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const index = tabs.findIndex((tab) => tab.id === value);
        const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        onChange(next.id);
        document.getElementById(`${idBase}-tab-${next.id}`)?.focus();
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`${idBase}-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          aria-controls={`${idBase}-panel`}
          tabIndex={tab.id === value ? 0 : -1}
          className="ph-typing-tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Text from an error, with known server codes turned into plain English. */
export function errorText(cause: unknown, known: Record<string, string> = {}) {
  const message = cause instanceof Error ? cause.message : String(cause);
  const code = Object.keys(known).find((key) => message.includes(key));
  if (code) return known[code];
  if (message.includes("RATE_LIMIT")) return "Slow down a little – try again in a minute.";
  return message;
}
