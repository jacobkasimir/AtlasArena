import { ButtonHTMLAttributes, ReactNode, forwardRef } from "react";
import { Link, LinkProps } from "react-router-dom";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type Look = {
  /** Visual weight. One "primary" per screen. Default "secondary". */
  variant?: ButtonVariant;
  /** "lg" (56 px) for the main action of a screen; default 48 px. */
  size?: "md" | "lg";
  /** Full width. */
  block?: boolean;
  /** Icon before the label (decorative). */
  icon?: ReactNode;
};

export function buttonClass({ variant = "secondary", size = "md", block = false }: Look, extra?: string) {
  return ["ph-btn", `ph-btn-${variant}`, size === "lg" && "ph-btn-lg", block && "ph-btn-block", extra]
    .filter(Boolean)
    .join(" ");
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  Look & {
    /** Shows a spinner, sets aria-busy and disables the button. */
    loading?: boolean;
  };

/** Touch-sized button (≥ 48 px). Defaults to type="button" so it never submits a form by accident. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, block, icon, loading = false, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass({ variant, size, block }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="ph-spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
});

/** A router link that looks like a Button (for navigation, not actions). */
export function LinkButton({ variant, size, block, icon, className, children, ...rest }: LinkProps & Look) {
  return (
    <Link className={buttonClass({ variant, size, block }, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

/** Round icon-only button (48 × 48). `label` is required: it becomes the accessible name. */
export function IconButton({
  label,
  children,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type={type} className={["ph-icon-btn", className].filter(Boolean).join(" ")} aria-label={label} {...rest}>
      {children}
    </button>
  );
}
