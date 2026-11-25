import { ReactNode } from "react";

/**
 * Sticky bar for a screen's primary action(s). Put it LAST in the screen. It sticks above the tab bar,
 * the home-indicator safe area and the on-screen keyboard, so "Submit" stays reachable while typing.
 * Children share the width equally (use one primary Button, optionally one secondary).
 */
export function ActionBar({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="ph-actionbar" role={label ? "group" : undefined} aria-label={label}>
      {children}
    </div>
  );
}
