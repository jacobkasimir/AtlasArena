/** Accessible progress bar. `label` is read by screen readers; `showValue` prints "value / max" above the bar. */
export function ProgressBar({
  value,
  max,
  label,
  showValue = false,
}: {
  value: number;
  max: number;
  label: string;
  showValue?: boolean;
}) {
  const safeMax = Math.max(1, max);
  const clamped = Math.min(safeMax, Math.max(0, value));
  const percent = Math.round((clamped / safeMax) * 100);
  return (
    <div className="ph-progress">
      {showValue && (
        <div className="ph-progress-label" aria-hidden="true">
          <span>{label}</span>
          <span>
            {clamped} / {safeMax}
          </span>
        </div>
      )}
      <div
        className="ph-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={clamped}
        aria-valuetext={`${clamped} of ${safeMax}`}
      >
        <div className="ph-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
