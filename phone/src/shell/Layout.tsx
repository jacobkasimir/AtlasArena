import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "@shared/icons";
import { LoadingState, ToastProvider } from "@phone/ui";
import { ChromeContext, ChromeState } from "./chrome";
import { OfflineNotice } from "./OfflineNotice";
import { parentPath, titleForPath } from "./paths";
import { TabBar } from "./TabBar";

/** Signed-in frame: top bar (page h1, Back, actions), scrolling content, bottom tab bar. */
export function PhoneLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [chrome, setChromeState] = useState<ChromeState | null>(null);
  const [actionsTarget, setActionsTarget] = useState<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  const setChrome = useCallback((update: (current: ChromeState | null) => ChromeState | null) => {
    setChromeState(update);
  }, []);
  const context = useMemo(() => ({ setChrome, actionsTarget }), [setChrome, actionsTarget]);

  const title = chrome?.title ?? titleForPath(location.pathname);
  const section = location.pathname.split("/")[1] ?? "";
  const hideTabBar = chrome?.hideTabBar ?? false;
  const back = chrome?.back;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.phTabbar = hideTabBar ? "hidden" : "visible";
    return () => {
      delete root.dataset.phTabbar;
    };
  }, [hideTabBar]);

  useEffect(() => {
    document.title = title === "Atlas Arena" ? title : `${title} · Atlas Arena`;
  }, [title]);

  // Like the desktop Layout: after in-app navigation, move focus to the page title and scroll to the top.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.scrollingElement?.scrollTo?.({ top: 0 });
    titleRef.current?.focus();
  }, [location.pathname]);

  function goBack() {
    if (typeof back === "string") {
      navigate(back);
      return;
    }
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (index > 0) navigate(-1);
    else navigate(parentPath(location.pathname), { replace: true });
  }

  return (
    <ChromeContext.Provider value={context}>
      <ToastProvider>
        <div className="ph-app">
          <a
            className="ph-skip"
            href="#ph-main"
            onClick={(event) => {
              event.preventDefault();
              mainRef.current?.focus();
            }}
          >
            Skip to content
          </a>
          <header className="ph-topbar">
            {back ? (
              typeof back === "string" ? (
                <Link to={back} className="ph-icon-btn" aria-label="Back">
                  <Icon name="chevronLeft" size={24} />
                </Link>
              ) : (
                <button type="button" className="ph-icon-btn" aria-label="Back" onClick={goBack}>
                  <Icon name="chevronLeft" size={24} />
                </button>
              )
            ) : null}
            <h1 ref={titleRef} tabIndex={-1} className="ph-topbar-title">
              {title}
            </h1>
            <div className="ph-topbar-slot" ref={setActionsTarget} />
          </header>
          <OfflineNotice />
          <main id="ph-main" ref={mainRef} tabIndex={-1} className="ph-main">
            <Suspense fallback={<LoadingState />}>
              {/* Keyed by the top-level section only: switching tabs/areas plays a short rise-in; moving inside an
                  area (setup → play → results) keeps the area mounted. */}
              <div className="ph-page" key={section}>
                <Outlet />
              </div>
            </Suspense>
          </main>
          {!hideTabBar && <TabBar />}
        </div>
      </ToastProvider>
    </ChromeContext.Provider>
  );
}
