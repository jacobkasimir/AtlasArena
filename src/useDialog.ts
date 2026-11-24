// Keyboard behaviour shared by the in-game confirmation dialogs (leave run, abandon round, discard round).
import { RefObject, useEffect, useRef } from "react";

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * While `open`: focuses `initialFocus` (a selector inside the dialog, else its first control), closes on Esc
 * (unless `canClose()` says no), keeps Tab inside the dialog and stops the page behind it from scrolling.
 * When the dialog closes, focus returns to the element that had it before (usually the button that opened it).
 */
export function useModalDialog(
  open: boolean,
  dialogRef: RefObject<HTMLElement>,
  onClose: () => void,
  { initialFocus, canClose }: { initialFocus?: string; canClose?: () => boolean } = {},
) {
  const close = useRef(onClose);
  const allowClose = useRef(canClose);
  close.current = onClose;
  allowClose.current = canClose;

  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const first = (initialFocus && dialog?.querySelector<HTMLElement>(initialFocus)) || dialog?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (allowClose.current?.() ?? true) close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (!nodes.length) {
        event.preventDefault();
        return;
      }
      const firstNode = nodes[0];
      const lastNode = nodes[nodes.length - 1];
      const inside = dialogRef.current?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === firstNode || !inside)) {
        event.preventDefault();
        lastNode.focus();
      } else if (!event.shiftKey && (document.activeElement === lastNode || !inside)) {
        event.preventDefault();
        firstNode.focus();
      }
    }
    // Capture phase, so game shortcuts underneath never see keys meant for the dialog.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
      if (returnTo?.isConnected) returnTo.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
