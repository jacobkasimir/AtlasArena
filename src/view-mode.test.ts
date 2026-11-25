import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeviceEnv,
  LOOP_WINDOW_MS,
  REDIRECT_GUARD_KEY,
  VIEW_MODE_KEY,
  detectPhone,
  equivalentUrl,
  isRoundPath,
  planRedirect,
  readViewMode,
  redirectAtStartup,
  resolveTarget,
  routeMap,
  setViewMode,
  switchApp,
} from "./view-mode";

function media(matches: Record<string, boolean>) {
  return (query: string) => ({ matches: matches[query] ?? false });
}
const touchOnly = media({ "(pointer: coarse)": true, "(hover: none)": true });
const mouse = media({ "(pointer: fine)": true, "(hover: hover)": true });
const touchLaptop = media({ "(pointer: fine)": true, "(hover: hover)": true, "(any-pointer: coarse)": true });

const iphone: DeviceEnv = { matchMedia: touchOnly, screenWidth: 390, screenHeight: 844, innerWidth: 390, maxTouchPoints: 5, platform: "iPhone", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" };
const android: DeviceEnv = { matchMedia: touchOnly, screenWidth: 412, screenHeight: 915, innerWidth: 412, maxTouchPoints: 5, platform: "Linux armv8l", uaMobile: true };
const landscapePhone: DeviceEnv = { ...android, screenWidth: 915, screenHeight: 412, innerWidth: 915 };
const ipadOS: DeviceEnv = { matchMedia: touchOnly, screenWidth: 820, screenHeight: 1180, innerWidth: 400, maxTouchPoints: 5, platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" };
const androidTablet: DeviceEnv = { matchMedia: touchOnly, screenWidth: 800, screenHeight: 1280, innerWidth: 800, maxTouchPoints: 10, uaMobile: false };
const desktop: DeviceEnv = { matchMedia: mouse, screenWidth: 1920, screenHeight: 1080, innerWidth: 500, maxTouchPoints: 0, platform: "Win32" };
const touchscreenLaptop: DeviceEnv = { matchMedia: touchLaptop, screenWidth: 1366, screenHeight: 768, innerWidth: 600, maxTouchPoints: 10, platform: "Win32" };

describe("detectPhone", () => {
  it("detects phones in portrait and landscape", () => {
    expect(detectPhone(iphone)).toBe(true);
    expect(detectPhone(android)).toBe(true);
    expect(detectPhone(landscapePhone)).toBe(true);
  });
  it("detects a narrow touch-only viewport", () => {
    expect(detectPhone({ matchMedia: touchOnly, screenWidth: 700, screenHeight: 1000, innerWidth: 600 })).toBe(true);
  });
  it("treats tablets, iPads and (touch) desktops as desktop", () => {
    expect(detectPhone(ipadOS)).toBe(false);
    expect(detectPhone({ ...ipadOS, userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", platform: "iPad" })).toBe(false);
    expect(detectPhone(androidTablet)).toBe(false);
    expect(detectPhone(desktop)).toBe(false);
    expect(detectPhone(touchscreenLaptop)).toBe(false);
  });
  it("is false without matchMedia or when it throws", () => {
    expect(detectPhone({ screenWidth: 390, screenHeight: 844 })).toBe(false);
    expect(detectPhone({ matchMedia: () => { throw new Error("nope"); }, screenWidth: 390 })).toBe(false);
  });
  it("reads the browser environment by default (window.matchMedia mock)", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" || query === "(hover: none)", media: query }));
    vi.stubGlobal("innerWidth", 390);
    expect(detectPhone()).toBe(true);
    vi.stubGlobal("innerWidth", 1024);
    vi.stubGlobal("screen", { width: 1024, height: 1366 });
    expect(detectPhone()).toBe(false);
  });
});

// [desktop path, phone path (inside /phone)] – both directions are exact.
const roundTrips: [string, string][] = [
  ["/home", "/"],
  ["/quiz", "/quiz"],
  ["/play/abc-123", "/quiz/play/abc-123"],
  ["/results/abc-123", "/quiz/results/abc-123"],
  ["/flags", "/flags"],
  ["/flags/session/f1", "/flags/play/f1"],
  ["/flags/results/f1", "/flags/results/f1"],
  ["/capitals", "/capitals"],
  ["/capitals/session/c1", "/capitals/play/c1"],
  ["/capitals/results/c1", "/capitals/results/c1"],
  ["/recall", "/recall"],
  ["/recall/play/r1", "/recall/play/r1"],
  ["/recall/results/r1", "/recall/results/r1"],
  ["/elimination", "/elimination"],
  ["/elimination/play/e1", "/elimination/play/e1"],
  ["/profile", "/profile"],
  ["/settings", "/settings"],
  ["/onboarding", "/onboarding"],
];

describe("routeMap", () => {
  it.each(roundTrips)("%s <-> %s", (desktopPath, phonePath) => {
    expect(routeMap.desktopToPhone(desktopPath)).toEqual({ path: phonePath, exact: true });
    expect(routeMap.phoneToDesktop(phonePath)).toEqual({ path: desktopPath, exact: true });
  });

  it("maps phone-only and nested screens to the nearest desktop screen", () => {
    expect(routeMap.phoneToDesktop("/games")).toEqual({ path: "/home", exact: true });
    expect(routeMap.phoneToDesktop("/welcome")).toEqual({ path: "/", exact: true });
    expect(routeMap.phoneToDesktop("/sign-in")).toEqual({ path: "/auth", exact: true });
    expect(routeMap.phoneToDesktop("/profile/statistics")).toEqual({ path: "/profile", exact: false });
    expect(routeMap.phoneToDesktop("/elimination/results/e1")).toEqual({ path: "/elimination/play/e1", exact: true });
    expect(routeMap.phoneToDesktop("/quiz/whatever")).toEqual({ path: "/quiz", exact: false });
    expect(routeMap.phoneToDesktop("/nowhere")).toEqual({ path: "/home", exact: false });
  });

  it("maps the desktop start page and unknown screens to phone home, keeps desktop-only screens", () => {
    expect(routeMap.desktopToPhone("/")).toEqual({ path: "/", exact: true });
    expect(routeMap.desktopToPhone("/home/")).toEqual({ path: "/", exact: true });
    expect(routeMap.desktopToPhone("/nowhere/at/all")).toEqual({ path: "/", exact: false });
    expect(routeMap.desktopToPhone("/flags/strange")).toEqual({ path: "/flags", exact: false });
    for (const path of ["/auth", "/explorer", "/admin", "/review", "/review/r1"]) expect(routeMap.desktopToPhone(path)).toBeNull();
  });

  it("builds full URLs with the /phone base and keeps the query only for exact matches", () => {
    expect(equivalentUrl("desktop", "/home")).toBe("/phone/");
    expect(equivalentUrl("desktop", "/quiz", "?topic=capitals")).toBe("/phone/quiz?topic=capitals");
    expect(equivalentUrl("desktop", "/nowhere", "?x=1")).toBe("/phone/");
    expect(equivalentUrl("desktop", "/explorer")).toBeNull();
    expect(equivalentUrl("phone", "/phone")).toBe("/home");
    expect(equivalentUrl("phone", "/phone/")).toBe("/home");
    expect(equivalentUrl("phone", "/phone/flags/play/f1", "?a=b")).toBe("/flags/session/f1?a=b");
    expect(equivalentUrl("phone", "/phone/profile/edit", "?a=b")).toBe("/profile");
  });

  it("recognises round routes", () => {
    expect(isRoundPath("desktop", "/play/1")).toBe(true);
    expect(isRoundPath("desktop", "/flags/session/1")).toBe(true);
    expect(isRoundPath("desktop", "/results/1")).toBe(false);
    expect(isRoundPath("phone", "/phone/quiz/play/1")).toBe(true);
    expect(isRoundPath("phone", "/phone/recall/results/1")).toBe(false);
  });
});

describe("resolveTarget", () => {
  it.each([
    ["desktop", "auto", false, null],
    ["desktop", "auto", true, "phone"],
    ["phone", "auto", true, null],
    ["phone", "auto", false, "desktop"],
    ["desktop", "phone", false, "phone"],
    ["desktop", "phone", true, "phone"],
    ["phone", "phone", false, null],
    ["phone", "desktop", true, "desktop"],
    ["desktop", "desktop", true, null],
    ["desktop", "desktop", false, null],
  ] as const)("%s app, mode %s, phone detected %s → %s", (app, mode, detected, expected) => {
    expect(resolveTarget(app, mode, detected)).toBe(expected);
  });
});

describe("planRedirect", () => {
  const now = 1_000_000;
  const base = { now, guard: null, search: "", hash: "" };

  it("auto: sends a phone from the desktop app to the same screen once", () => {
    expect(planRedirect({ ...base, app: "desktop", mode: "auto", detectedPhone: true, pathname: "/recall/results/r1" })).toBe("/phone/recall/results/r1");
    expect(planRedirect({ ...base, app: "phone", mode: "auto", detectedPhone: false, pathname: "/phone/settings" })).toBe("/settings");
    // A redirect already happened this session (any direction, any time): auto stays put.
    const old = { to: "phone" as const, at: now - 60 * 60_000 };
    expect(planRedirect({ ...base, guard: old, app: "desktop", mode: "auto", detectedPhone: true, pathname: "/home" })).toBeNull();
  });

  it("auto: never moves a running round or a desktop-only screen", () => {
    expect(planRedirect({ ...base, app: "desktop", mode: "auto", detectedPhone: true, pathname: "/play/q1" })).toBeNull();
    expect(planRedirect({ ...base, app: "phone", mode: "auto", detectedPhone: false, pathname: "/phone/flags/play/f1" })).toBeNull();
    expect(planRedirect({ ...base, app: "desktop", mode: "auto", detectedPhone: true, pathname: "/explorer" })).toBeNull();
  });

  it("explicit choice: always honoured, also mid-round and after an earlier redirect", () => {
    expect(planRedirect({ ...base, app: "desktop", mode: "phone", detectedPhone: false, pathname: "/flags/session/f1" })).toBe("/phone/flags/play/f1");
    const earlier = { to: "desktop" as const, at: now - LOOP_WINDOW_MS - 1 };
    expect(planRedirect({ ...base, guard: earlier, app: "desktop", mode: "phone", detectedPhone: false, pathname: "/home" })).toBe("/phone/");
    expect(planRedirect({ ...base, app: "phone", mode: "desktop", detectedPhone: true, pathname: "/phone/quiz/play/q1" })).toBe("/play/q1");
  });

  it("never bounces straight back (loop guard) and never moves auth links", () => {
    const justArrived = { to: "phone" as const, at: now - 500 };
    expect(planRedirect({ ...base, guard: justArrived, app: "phone", mode: "desktop", detectedPhone: false, pathname: "/phone/" })).toBeNull();
    expect(planRedirect({ ...base, hash: "#access_token=x&type=recovery", app: "desktop", mode: "phone", detectedPhone: true, pathname: "/" })).toBeNull();
    expect(planRedirect({ ...base, app: "desktop", mode: "phone", detectedPhone: true, pathname: "/auth" })).toBeNull();
  });
});

function fakeWindow(pathname: string, search = "") {
  const replace = vi.fn();
  return { win: { location: { pathname, search, hash: "", replace } } as unknown as Window, replace };
}

describe("startup redirect with storage", () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("stores the choice and defaults to auto", () => {
    expect(readViewMode()).toBe("auto");
    setViewMode("phone");
    expect(localStorage.getItem(VIEW_MODE_KEY)).toBe("phone");
    expect(readViewMode()).toBe("phone");
    setViewMode("auto");
    expect(localStorage.getItem(VIEW_MODE_KEY)).toBeNull();
    localStorage.setItem(VIEW_MODE_KEY, "tablet");
    expect(readViewMode()).toBe("auto");
  });

  it("explicit Phone: desktop → phone → no bounce, even with a stale opposite choice", () => {
    setViewMode("phone");
    const first = fakeWindow("/quiz", "?topic=flags");
    expect(redirectAtStartup("desktop", first.win, 1000)).toBe(true);
    expect(first.replace).toHaveBeenCalledWith("/phone/quiz?topic=flags");
    // The phone app loads: right app, nothing happens.
    const second = fakeWindow("/phone/quiz", "?topic=flags");
    expect(redirectAtStartup("phone", second.win, 1200)).toBe(false);
    // Even if the phone page somehow wanted desktop (e.g. an old cached build), the guard stops a ping-pong.
    setViewMode("desktop");
    expect(redirectAtStartup("phone", second.win, 1300)).toBe(false);
    expect(second.replace).not.toHaveBeenCalled();
  });

  it("auto: one redirect per session", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" || query === "(hover: none)", media: query }));
    vi.stubGlobal("innerWidth", 390);
    const first = fakeWindow("/home");
    expect(redirectAtStartup("desktop", first.win, 1000)).toBe(true);
    expect(first.replace).toHaveBeenCalledWith("/phone/");
    expect(JSON.parse(sessionStorage.getItem(REDIRECT_GUARD_KEY)!)).toEqual({ to: "phone", at: 1000 });
    // Later in the same session the player opens the desktop app on purpose: auto leaves them there.
    const later = fakeWindow("/home");
    expect(redirectAtStartup("desktop", later.win, 99_000)).toBe(false);
  });

  it("switchApp remembers the mode and opens the equivalent screen with replace", () => {
    const { win, replace } = fakeWindow("/phone/capitals/play/c9");
    switchApp("phone", "desktop", win, 5000);
    expect(readViewMode()).toBe("desktop");
    expect(replace).toHaveBeenCalledWith("/capitals/session/c9");
    expect(redirectAtStartup("desktop", fakeWindow("/capitals/session/c9").win, 5100)).toBe(false);
  });
});
