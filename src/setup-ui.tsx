// Shared building blocks for every mode's setup screen and in-game feedback,
// so Quiz, Flags, Capitals and Recall look and behave the same way.
import { Icon } from "./icons";
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

export function ModePage({ eyebrow, title, intro, side, children }: {
  eyebrow: string; title: string; intro: ReactNode; side?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="mode-shell">
      <header className="mode-hero">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="heading mt-2" tabIndex={-1}>{title}</h1>
        <p className="muted mt-3 max-w-2xl">{intro}</p>
      </header>
      <div className="mode-setup-grid">
        {children}
        {side && <aside className="mode-side">{side}</aside>}
      </div>
    </div>
  );
}

export function SetupForm({ onSubmit, children }: { onSubmit: (event: FormEvent) => void; children: ReactNode }) {
  return <form className="card mode-setup" onSubmit={onSubmit}>{children}</form>;
}

export function Step({ n, title, hint, children }: { n: number; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="mode-step">
      <legend><span className="mode-step-number">{n}</span> {title}</legend>
      {children}
      {hint && <p className="muted text-sm mt-3">{hint}</p>}
    </fieldset>
  );
}

export type OptionCard<T> = { value: T; title: string; text: string; icon?: ReactNode; footer?: ReactNode; disabled?: boolean };

export function OptionCards<T extends string>({ options, value, onChange }: {
  options: OptionCard<T>[]; value: T; onChange: (value: T) => void;
}) {
  return (
    <div className="option-grid">
      {options.map((option) => (
        <button key={option.value} type="button" className="option-card" aria-pressed={value === option.value}
          disabled={option.disabled} onClick={() => onChange(option.value)}>
          {option.icon && <span className="option-card-icon" aria-hidden="true">{option.icon}</span>}
          <span className="option-card-title">{option.title}</span>
          <span className="option-card-text">{option.text}</span>
          {option.footer && <span className="option-card-progress">{option.footer}</span>}
        </button>
      ))}
    </div>
  );
}

export type ChipOption<T> = { value: T; label: string; count?: number; disabled?: boolean };

export function Chips<T extends string | number | null>({ options, value, onChange, label }: {
  options: ChipOption<T>[]; value: T; onChange: (value: T) => void; label: string;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" className="chip" aria-pressed={value === option.value}
          disabled={option.disabled} onClick={() => onChange(option.value)}>
          {option.label}
          {option.count !== undefined && <span>{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Meter({ done, total, label }: { done: number; total: number; label?: string }) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <span className="meter" role="img" aria-label={label ?? `${done} of ${total}`}>
      <span style={{ width: `${percent}%` }} />
    </span>
  );
}

export function StartBar({ count, unit, summary, extra, busy, disabled, label = "Start" }: {
  count: number; unit: string; summary: ReactNode; extra?: ReactNode; busy: boolean; disabled?: boolean; label?: string;
}) {
  return (
    <div className="start-bar">
      <div>
        <p className="start-count"><strong>{count}</strong> {unit}</p>
        <p className="muted text-sm">{summary}</p>
        {extra && <p className="best-line">{extra}</p>}
      </div>
      <button className="primary start-button" disabled={busy || disabled}>{busy ? "Preparing…" : label}</button>
    </div>
  );
}

export function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2 className="font-bold">{title}</h2>
      {children}
    </section>
  );
}

export type ResumeItem = { id: string; title: string; detail: string; to: string; done: number; total: number; onDiscard?: () => void };

export function ResumeList({ items, empty }: { items: ResumeItem[]; empty: string }) {
  if (!items.length) return <p className="muted text-sm mt-2">{empty}</p>;
  return (
    <ul className="side-list">
      {items.map((item) => (
        <li key={item.id}>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{item.title}</p>
            <p className="muted text-sm">{item.detail}</p>
            <Meter done={item.done} total={item.total} label={`${item.done} of ${item.total} done`} />
          </div>
          <div className="side-actions">
            <Link className="secondary" to={item.to}>Resume</Link>
            {item.onDiscard && <button type="button" className="text-button" onClick={item.onDiscard}>Discard</button>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** "3 in a row" badge that pops whenever the streak grows past 2. */
export function StreakBadge({ streak }: { streak: number }) {
  const [pop, setPop] = useState(0);
  const last = useRef(streak);
  useEffect(() => {
    if (streak > last.current && streak >= 3) setPop((value) => value + 1);
    last.current = streak;
  }, [streak]);
  if (streak < 3) return null;
  return (
    <span key={pop} className="streak-badge" role="status" aria-live="polite">
      <Icon name="flame" size={15} /> {streak} in a row
    </span>
  );
}

/** Thin bar that fills while an auto-continue countdown runs; click anywhere on it to skip. */
export function AutoContinueBar({ ms, onSkip }: { ms: number; onSkip?: () => void }) {
  return (
    <button type="button" className="auto-continue" onClick={onSkip} aria-label="Continue now">
      <span style={{ animationDuration: `${ms}ms` }} />
    </button>
  );
}
