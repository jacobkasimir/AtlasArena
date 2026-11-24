// Small modal confirmation used by the games (abandon or discard a round).
import { ReactNode, useRef } from "react";
import { useModalDialog } from "./useDialog";

export function ConfirmDialog({
  id,
  title,
  children,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  id: string;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  // The safe choice gets focus first, so a stray Enter never confirms.
  useModalDialog(true, dialogRef, onCancel, { initialFocus: ".confirm-cancel", canClose: () => !busy });
  return (
    <div
      className="flags-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-text`}
        className="card flags-confirm"
      >
        <h2 id={`${id}-title`}>{title}</h2>
        <p id={`${id}-text`}>{children}</p>
        <div>
          <button type="button" className="secondary confirm-cancel" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="danger" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
