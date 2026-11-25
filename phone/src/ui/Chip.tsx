import { ReactNode } from "react";

/** Toggle chip (≥ 44 px). Exposes its state with aria-pressed. */
export function Chip({
  pressed,
  onToggle,
  children,
  disabled,
}: {
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="ph-chip" aria-pressed={pressed} onClick={onToggle} disabled={disabled}>
      {children}
    </button>
  );
}

/** Wraps chips; `label` names the group for screen readers. */
export function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ph-chip-group" role="group" aria-label={label}>
      {children}
    </div>
  );
}
