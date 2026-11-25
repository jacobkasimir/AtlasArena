import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type Tone = "info" | "success" | "error" | "warning";

type ToastItem = { id: number; text: string; tone: Tone };
type ToastApi = { show: (text: string, options?: { tone?: Tone; durationMs?: number }) => void };

const ToastContext = createContext<ToastApi | null>(null);

/** Short, non-blocking messages ("Saved", "You're offline"). Rendered once by the shell. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Set<number>());
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const show = useCallback<ToastApi["show"]>((text, { tone = "info", durationMs = 3500 } = {}) => {
    const id = nextId.current++;
    setItems((current) => [...current.slice(-2), { id, text, tone }]);
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setItems((current) => current.filter((item) => item.id !== id));
    }, durationMs);
    timers.current.add(timer);
  }, []);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ph-toasts" role="status" aria-live="polite">
        {items.map((item) => (
          <p key={item.id} className="ph-toast" data-tone={item.tone}>
            {item.text}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** `const toast = useToast(); toast.show("Saved", { tone: "success" })`. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider> (the phone shell provides it).");
  return api;
}

/**
 * Inline message that stays on screen (errors, results of an action). role="status" for normal messages,
 * role="alert" for errors. Renders nothing when `children` is empty, but keeps the live region mounted.
 */
export function StatusMessage({ tone = "info", children, retry }: { tone?: Tone; children?: ReactNode; retry?: () => void }) {
  const empty = children === undefined || children === null || children === "" || children === false;
  return (
    <div role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"}>
      {!empty && (
        <div className="ph-status" data-tone={tone}>
          <p>{children}</p>
          {retry && (
            <button type="button" className="ph-btn ph-btn-secondary mt-3" onClick={retry}>
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Centered loading indicator with a live label. */
export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="ph-loading" role="status" aria-live="polite">
      <span className="ph-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
