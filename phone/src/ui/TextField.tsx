import { InputHTMLAttributes, forwardRef, useId } from "react";

/**
 * Labelled text input with 16 px text (no iOS zoom), 48 px height and an optional hint.
 * Pass phone keyboard hints through: inputMode, enterKeyHint, autoComplete, autoCapitalize, autoCorrect.
 */
export const TextField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }
>(function TextField({ label, hint, id, className, ...rest }, ref) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <div className="ph-field">
      <label htmlFor={inputId}>{label}</label>
      <input
        ref={ref}
        id={inputId}
        className={["ph-input", className].filter(Boolean).join(" ")}
        aria-describedby={hintId}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="ph-field-hint">
          {hint}
        </p>
      )}
    </div>
  );
});
