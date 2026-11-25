// Test helpers for the typing area: a router with the area mounted, the shell's toast provider and a top-bar
// slot (so <TopBarActions> buttons such as "Give up" render), plus a probe for the current location.
import { ReactElement, ReactNode, useMemo, useState } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ChromeContext } from "@phone/shell/chrome";
import { ToastProvider } from "@phone/ui";

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function Chrome({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ setChrome: () => undefined, actionsTarget: target }), [target]);
  return (
    <ChromeContext.Provider value={value}>
      <div data-testid="topbar" ref={setTarget} />
      {children}
    </ChromeContext.Provider>
  );
}

/** Renders `area` under `/${prefix}/*` at `path`. */
export function renderArea(prefix: string, area: ReactElement, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Chrome>
          <Routes>
            <Route path={`/${prefix}/*`} element={area} />
          </Routes>
        </Chrome>
      </ToastProvider>
      <Where />
    </MemoryRouter>,
  );
}

/** A promise you resolve later (to hold a request "in flight"). */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
