// Touch controls for the account area: a 48 px switch row (role="switch") and a settings row around the shared
// SegmentedControl. Used by Settings; kept here because only this area needs them.
import { ReactNode, useId } from "react";
import { IconName } from "@shared/icons";
import { SegmentedControl } from "@phone/ui";

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

export type ChoiceOption<T extends string> = { value: T; label: string; icon?: IconName };

/**
 * A settings row with a title, an optional description and the shared SegmentedControl from @phone/ui
 * (radiogroup, arrow keys, light select haptic). `disabled` disables every option.
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
  const descriptionId = useId();
  return (
    <div className="ph-account-row ph-account-choice-row" data-disabled={disabled || undefined}>
      <span className="ph-account-row-text">
        <strong aria-hidden="true">{title}</strong>
        {description && (
          <small id={descriptionId} className="ph-muted">
            {description}
          </small>
        )}
      </span>
      <SegmentedControl<T>
        label={title}
        describedBy={description ? descriptionId : undefined}
        value={value}
        onChange={onChange}
        options={options.map((option) => ({ ...option, disabled: disabled || undefined }))}
      />
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
