import { ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@shared/icons";
import { useModalDialog } from "@shared/useDialog";
import { afterOwnPops, isOwnPop, popOwnEntries, pushOwnEntry, settledDepth } from "./useBackGuard";

/**
 * Modal sheet that slides up from the bottom (no drag gestures: close with the × button, the backdrop,
 * Esc, or the phone's Back button / gesture). Focus moves into the sheet, Tab stays inside, and focus
 * returns to the opener on close (shared useModalDialog).
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
  closeOnBack = true,
  canClose,
  initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  /** Visible heading; also the dialog's accessible name. */
  title: string;
  children: ReactNode;
  /** Sticky actions at the bottom of the sheet (e.g. a primary Button). */
  footer?: ReactNode;
  /** The device Back button closes the sheet instead of leaving the page. Default true. */
  closeOnBack?: boolean;
  /** Return false to keep the sheet open (e.g. while saving). */
  canClose?: () => boolean;
  /** Selector of the control that gets focus first (e.g. the safe "Cancel"); default: the first control. */
  initialFocus?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const tryClose = () => {
    if (canClose?.() ?? true) onClose();
  };
  useModalDialog(open, ref, onClose, { canClose, initialFocus });
  useBackToClose(open && closeOnBack, tryClose);
  // When the content changes under the focused control (a menu turning into a confirmation step), focus would
  // fall back to the page behind the modal: keep it inside the sheet instead.
  useEffect(() => {
    if (!open) return;
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused.isConnected) return;
    const target =
      (initialFocus && ref.current?.querySelector<HTMLElement>(initialFocus)) ||
      ref.current?.querySelector<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled)");
    target?.focus();
  });
  if (!open) return null;
  return createPortal(
    <>
      <button type="button" className="ph-sheet-backdrop" aria-label="Close" tabIndex={-1} onClick={tryClose} />
      <div ref={ref} className="ph-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <span className="ph-sheet-grip" aria-hidden="true" />
        <div className="ph-sheet-head">
          <h2 id={titleId} className="ph-sheet-title">
            {title}
          </h2>
          <button type="button" className="ph-icon-btn" aria-label="Close" onClick={tryClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className="ph-sheet-body">{children}</div>
        {footer && <div className="ph-sheet-footer">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

/**
 * While `active`, adds one history entry (same URL, router state kept) so the device Back button
 * closes the overlay instead of leaving the page. Closing by other means removes that entry again.
 * Bookkeeping is shared with useBackGuard (./useBackGuard), so a round's Back guard below the sheet and the
 * sheet never both react to the same Back.
 */
export function useBackToClose(active: boolean, onBack: () => void) {
  const callback = useRef(onBack);
  callback.current = onBack;
  const marker = useId();
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    let depth = 0;
    const cancelPush = afterOwnPops(() => {
      depth = pushOwnEntry({ phoneOverlay: marker });
    });
    let popped = false;
    const onPop = () => {
      if (popped || !depth || isOwnPop()) return;
      popped = true;
      callback.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      cancelPush();
      window.removeEventListener("popstate", onPop);
      // Still there (closed by ×, Esc, an action or unmount) and not already being removed: take it out.
      if (!popped && depth) popOwnEntries(settledDepth() - depth + 1);
    };
  }, [active, marker]);
}
