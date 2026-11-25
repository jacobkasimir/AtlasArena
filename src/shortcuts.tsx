// Keyboard shortcut reference: shown in Settings and as an overlay when the player presses "?".
import { Fragment, useEffect, useRef, useState } from "react";

export type Shortcut = { keys: string[][]; action: string };
export type ShortcutGroup = { title: string; items: Shortcut[] };

/** Every shortcut the games actually support. `keys` lists alternatives; each alternative is a key combination. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Everywhere",
    items: [
      { keys: [["?"]], action: "Show this list of shortcuts" },
      { keys: [["Tab"], ["Shift", "Tab"]], action: "Move between buttons and fields" },
      { keys: [["Esc"]], action: "Close a dialog or cancel a give-up question" },
    ],
  },
  {
    title: "Quiz",
    items: [
      { keys: [["1"], ["2"], ["3"], ["4"]], action: "Pick an answer (if number keys are on)" },
      { keys: [["Enter"], ["Space"]], action: "Next question after feedback (Space can be turned off)" },
    ],
  },
  {
    title: "Flags",
    items: [
      { keys: [["←"], ["→"], ["↑"], ["↓"]], action: "Move between flag options" },
      { keys: [["Home"], ["End"]], action: "First or last flag option" },
      { keys: [["Enter"], ["Space"]], action: "Choose the focused flag" },
      {
        keys: [["0–9"]],
        action:
          "Type a flag's number to pick it (if number keys are on). With more than nine flags, press Enter or pause briefly",
      },
      { keys: [["Backspace"], ["Esc"]], action: "Edit or clear a typed flag number" },
      { keys: [["↑"], ["↓"], ["Enter"]], action: "Pick a country from the suggestions while typing" },
      { keys: [["Enter"], ["Space"]], action: "Next flag after feedback (Space can be turned off)" },
    ],
  },
  {
    title: "Capitals, Recall and Elimination",
    items: [
      { keys: [["Enter"]], action: "Submit what you typed (Recall: accept a name right away)" },
      { keys: [["Esc"]], action: "Clear what you typed" },
      { keys: [["Enter"], ["Space"]], action: "Capitals: next question after feedback (Space can be turned off)" },
      { keys: [["←"], ["→"], ["Home"], ["End"]], action: "Recall results: switch between the Missed and Found tabs" },
    ],
  },
  {
    title: "Explorer",
    items: [
      { keys: [["←"], ["→"]], action: "Previous or next place in the detail view" },
      { keys: [["Esc"]], action: "Close the detail view" },
    ],
  },
];

export function ShortcutList({ headingLevel = 3 }: { headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="shortcut-groups">
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.title} className="shortcut-group">
          <Heading className="shortcut-group-title">{group.title}</Heading>
          <dl>
            {group.items.map((item) => (
              <div key={item.action} className="shortcut-row">
                <dt>
                  {item.keys.map((combo, index) => (
                    <Fragment key={combo.join("+")}>
                      {index > 0 && <span className="shortcut-or"> or </span>}
                      {combo.map((key, keyIndex) => (
                        <Fragment key={key}>
                          {keyIndex > 0 && "+"}
                          <kbd>{key}</kbd>
                        </Fragment>
                      ))}
                    </Fragment>
                  ))}
                </dt>
                <dd>{item.action}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input,textarea,select,[contenteditable=true]"));
}

/** Global "?" overlay. Mounted once next to the app; ignores "?" while the player is typing. */
export function ShortcutOverlay() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "?" && !open && !isTyping(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // Another dialog is already open: leave the keyboard to it.
        if (document.querySelector('[aria-modal="true"]')) return;
        event.preventDefault();
        returnFocus.current = document.activeElement as HTMLElement | null;
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" || event.key === "?") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      } else if (event.key === "Tab") {
        // The close button is the only focusable element: keep focus inside the dialog.
        event.preventDefault();
        closeRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      returnFocus.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="shortcut-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={dialogRef}
        className="shortcut-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-dialog-title"
      >
        <div className="shortcut-dialog-head">
          <div>
            <p className="eyebrow">Keyboard</p>
            <h2 id="shortcut-dialog-title">Shortcuts</h2>
          </div>
          <button ref={closeRef} type="button" className="secondary" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
        <ShortcutList />
        <p className="muted text-sm mt-4">Change keyboard behaviour in Settings → Keyboard.</p>
      </div>
    </div>
  );
}
