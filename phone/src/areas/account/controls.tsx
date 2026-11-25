// Touch controls for the account area: a 48 px switch row (role="switch") and a segmented choice group
// (role="radiogroup" with arrow-key navigation). Used by Settings; kept here because only this area needs them.
import { KeyboardEvent, ReactNode, useId, useRef } from "react";

/** One setting row: title, optional description, and a large switch. The whole row is the tap target. */
export function SwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const descriptionId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={description ? descriptionId : undefined}
      className="ph-account-row ph-account-switch-row"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="ph-account-row-text">
        <strong>{title}</strong>
        {description && (
          <small id={descriptionId} className="ph-muted">
            {description}
          </small>
        )}
      </span>
      <span className="ph-account-switch" data-on={checked} aria-hidden="true">
        <span className="ph-account-switch-thumb" />
      </span>
    </button>
  );
}

export type ChoiceOption<T extends string> = { value: T; label: string; icon?: ReactNode };

/**
 * Segmented control: one choice out of a few. Arrow keys move the selection (radio-group pattern);
 * only the selected option is in the tab order.
 */
export function ChoiceGroup<T extends string>({
  title,
  description,
  value,
  options,
  onChange,
  disabled,
}: {
  title: string;
  description?: ReactNode;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next: number | null = null;
    if (event.key in keys) next = (selectedIndex + keys[event.key] + options.length) % options.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = options.length - 1;
    if (next === null) return;
    event.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div className="ph-account-row ph-account-choice-row" data-disabled={disabled || undefined}>
      <span className="ph-account-row-text">
        <strong id={titleId}>{title}</strong>
        {description && (
          <small id={descriptionId} className="ph-muted">
            {description}
          </small>
        )}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-disabled={disabled || undefined}
        className="ph-account-segmented"
        onKeyDown={disabled ? undefined : onKeyDown}
      >
        {options.map((option, index) => {
          const selected = index === selectedIndex;
          return (
            <button
              key={option.value}
              ref={(element) => {
                refs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              className="ph-account-segment"
              onClick={() => onChange(option.value)}
            >
              {option.icon}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A rounded group of rows with thin separators (iOS/Android settings style). */
export function RowGroup({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="ph-account-group" role={label ? "group" : undefined} aria-label={label}>
      {children}
    </div>
  );
}
