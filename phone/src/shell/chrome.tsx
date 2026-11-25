// Lets a screen adjust the shell around it: top-bar title, Back button, hiding the tab bar during play,
// and extra top-bar buttons. Call usePhoneChrome ONCE per screen (in the screen's top component).
import { ReactNode, createContext, useContext, useEffect, useId } from "react";
import { createPortal } from "react-dom";

export type PhoneChrome = {
  /** Top-bar title (the page's h1). Default: the area name for the route. */
  title?: string;
  /** Show a Back button: `true` = previous screen (or one level up after a deep link), a string = that path. */
  back?: boolean | string;
  /** Hide the bottom tab bar, e.g. while a round is running. */
  hideTabBar?: boolean;
};

export type ChromeState = PhoneChrome & { owner: string };

export type ChromeContextValue = {
  setChrome: (update: (current: ChromeState | null) => ChromeState | null) => void;
  actionsTarget: HTMLElement | null;
};

export const ChromeContext = createContext<ChromeContextValue>({ setChrome: () => undefined, actionsTarget: null });

export function usePhoneChrome({ title, back, hideTabBar }: PhoneChrome) {
  const { setChrome } = useContext(ChromeContext);
  const owner = useId();
  useEffect(() => {
    setChrome(() => ({ owner, title, back, hideTabBar }));
  }, [setChrome, owner, title, back, hideTabBar]);
  useEffect(
    () => () => setChrome((current) => (current?.owner === owner ? null : current)),
    [setChrome, owner],
  );
}

/** Renders its children on the right side of the top bar (e.g. an IconButton "Give up"). */
export function TopBarActions({ children }: { children: ReactNode }) {
  const { actionsTarget } = useContext(ChromeContext);
  return actionsTarget ? createPortal(children, actionsTarget) : null;
}
