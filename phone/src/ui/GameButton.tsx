// Chunky, pressable game buttons: a raised face on a darker "edge" that presses down under the thumb.
// Use for the main action of a game screen (Start, Next, Play again, Retry missed). Keep Button for forms,
// settings and secondary UI. One primary GameButton per screen.
import { ButtonHTMLAttributes, MouseEvent, ReactNode, forwardRef } from "react";
import { Link, LinkProps } from "react-router-dom";
import { Tone } from "@shared/icons";
import { FeelKind, feel } from "./feel";

export type GameButtonVariant = "primary" | "secondary" | "success" | "danger" | "tone";

type GameLook = {
  /** primary = mint; tone = the game's colour (needs `tone`); secondary = neutral raised. Default primary. */
  variant?: GameButtonVariant;
  /** md 52 px · lg 60 px (default, main action) · xl 68 px (Start / Play again on a hero). */
  size?: "md" | "lg" | "xl";
  /** Game colour for variant "tone" (quiz, flags, capitals, recall, …). */
  tone?: Tone;
  block?: boolean;
  /** Decorative icon before the label. */
  icon?: ReactNode;
  /** Feedback on press; false for none (e.g. when the handler fires its own). Default "tap". */
  haptic?: FeelKind | false;
};

// Literal class names (Tailwind keeps only @layer classes it can find in the source).
const variantClass: Record<GameButtonVariant, string> = {
  primary: "ph-gbtn-primary",
  secondary: "ph-gbtn-secondary",
  success: "ph-gbtn-success",
  danger: "ph-gbtn-danger",
  tone: "ph-gbtn-tone",
};
const sizeClass = { md: "ph-gbtn-md", lg: "ph-gbtn-lg", xl: "ph-gbtn-xl" } as const;

export function gameButtonClass({ variant = "primary", size = "lg", tone, block }: GameLook, extra?: string) {
  return [
    "ph-gbtn",
    variantClass[variant],
    sizeClass[size],
    variant === "tone" && tone ? `tone-${tone}` : null,
    block ? "ph-gbtn-block" : null,
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

export type GameButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  GameLook & {
    /** Spinner + aria-busy; the button is disabled meanwhile. */
    loading?: boolean;
  };

export const GameButton = forwardRef<HTMLButtonElement, GameButtonProps>(function GameButton(
  { variant, size, tone, block, icon, haptic = "tap", loading = false, className, children, disabled, onClick, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={gameButtonClass({ variant, size, tone, block }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (haptic) feel(haptic);
        onClick?.(event);
      }}
      {...rest}
    >
      <span className="ph-gbtn-face">
        {loading ? <span className="ph-spinner" aria-hidden="true" /> : icon}
        <span className="ph-gbtn-label">{children}</span>
      </span>
    </button>
  );
});

/** Router link with the GameButton look (navigation such as "Play again" to a setup screen). */
export function LinkGameButton({
  variant,
  size,
  tone,
  block,
  icon,
  haptic = "tap",
  className,
  children,
  onClick,
  ...rest
}: LinkProps & GameLook) {
  return (
    <Link
      className={gameButtonClass({ variant, size, tone, block }, className)}
      onClick={(event) => {
        if (haptic) feel(haptic);
        onClick?.(event);
      }}
      {...rest}
    >
      <span className="ph-gbtn-face">
        {icon}
        <span className="ph-gbtn-label">{children}</span>
      </span>
    </Link>
  );
}
