// Desktop / phone view switch, shared by both apps (desktop at /, phone at /phone/, same origin and backend).
//
// - The player's choice ("auto" | "phone" | "desktop") is stored on this device (localStorage, no cookies).
// - detectPhone() decides what "auto" means: phones get the phone app; tablets, iPads and desktops with
//   touch screens get the desktop app.
// - routeMap converts paths between the two apps so a switch keeps the player on the equivalent screen.
// - planRedirect() / redirectAtStartup() run in main.tsx BEFORE React renders (no inline script, CSP unchanged).
//   "auto" redirects at most once per browser session and never during a round; an explicit choice is always
//   honoured. A sessionStorage guard stops ping-pong between the two apps.

import { useSyncExternalStore } from "react";

export type ViewMode = "auto" | "phone" | "desktop";
export type AppKind = "phone" | "desktop";

export const VIEW_MODE_KEY = "atlas-view-mode";
export const REDIRECT_GUARD_KEY = "atlas-view-redirect";
/** Base path of the phone app (router basename). */
export const PHONE_BASE = "/phone";
/** A redirect that arrives here sooner than this after one went the other way is treated as a loop. */
export const LOOP_WINDOW_MS = 10_000;

const modes: readonly ViewMode[] = ["auto", "phone", "desktop"];

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === "string" && (modes as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------------------------------------
// Preference
// ---------------------------------------------------------------------------------------------------------

const listeners = new Set<() => void>();

export function readViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    return isViewMode(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

export function setViewMode(mode: ViewMode) {
  try {
    if (mode === "auto") localStorage.removeItem(VIEW_MODE_KEY);
    else localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    /* storage unavailable: the choice applies to this page only */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === VIEW_MODE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The stored view mode, kept in sync with Settings and other tabs. */
export function useViewMode(): ViewMode {
  return useSyncExternalStore(subscribe, readViewMode, () => "auto");
}

// ---------------------------------------------------------------------------------------------------------
// Device detection (pure: pass an environment in tests)
// ---------------------------------------------------------------------------------------------------------

export interface DeviceEnv {
  matchMedia?: (query: string) => { matches: boolean };
  screenWidth?: number;
  screenHeight?: number;
  innerWidth?: number;
  maxTouchPoints?: number;
  platform?: string;
  userAgent?: string;
  /** navigator.userAgentData.mobile where supported (Chromium). */
  uaMobile?: boolean;
}

export function browserEnv(): DeviceEnv {
  if (typeof window === "undefined") return {};
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const uaData = (nav as (Navigator & { userAgentData?: { mobile?: boolean } }) | undefined)?.userAgentData;
  return {
    matchMedia: typeof window.matchMedia === "function" ? (query) => window.matchMedia(query) : undefined,
    screenWidth: window.screen?.width,
    screenHeight: window.screen?.height,
    innerWidth: window.innerWidth,
    maxTouchPoints: nav?.maxTouchPoints,
    platform: nav?.platform,
    userAgent: nav?.userAgent,
    uaMobile: uaData?.mobile,
  };
}

/** iPads (also iPadOS reporting itself as a Mac) always count as desktop. */
export function isIPad(env: DeviceEnv) {
  const ua = env.userAgent ?? "";
  if (/iPad/.test(ua)) return true;
  return (env.platform === "MacIntel" || /Macintosh/.test(ua)) && (env.maxTouchPoints ?? 0) > 1;
}

/**
 * True for phones: a touch-only screen (coarse pointer, no hover) whose short side is at most ~500 CSS px, or
 * a touch-only screen in a viewport of at most 640 px. Tablets, iPads and desktops with touch screens (they
 * still have a fine pointer or hover) count as desktop.
 */
export function detectPhone(env: DeviceEnv = browserEnv()): boolean {
  if (isIPad(env)) return false;
  const media = (query: string) => {
    try {
      return env.matchMedia?.(query).matches ?? false;
    } catch {
      return false;
    }
  };
  const touchOnly = media("(pointer: coarse)") && media("(hover: none)");
  if (!touchOnly) return false;
  if (env.uaMobile === true) return true;
  const sides = [env.screenWidth, env.screenHeight].filter((side): side is number => typeof side === "number" && side > 0);
  const shortSide = sides.length ? Math.min(...sides) : Infinity;
  if (shortSide <= 500) return true;
  return typeof env.innerWidth === "number" && env.innerWidth > 0 && env.innerWidth <= 640;
}

// ---------------------------------------------------------------------------------------------------------
// Route map (paths inside each app; the phone app's paths are relative to /phone)
// ---------------------------------------------------------------------------------------------------------

/** Desktop screens with no phone counterpart: never redirected, so the phone app can link to them. */
const desktopOnly = ["/auth", "/explorer", "/admin", "/review"];

const ID = "([^/]+)";
const games = ["flags", "capitals", "recall", "elimination"] as const;

function under(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

function clean(pathname: string) {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export interface MappedPath {
  /** Path inside the target app. */
  path: string;
  /** False when the screen had no equivalent and the target is the app's home. */
  exact: boolean;
}

/** Desktop path → phone path (inside /phone). null: a desktop-only screen that must not be redirected. */
function desktopToPhone(input: string): MappedPath | null {
  const pathname = clean(input);
  if (desktopOnly.some((prefix) => under(pathname, prefix))) return null;
  if (pathname === "/" || pathname === "/home") return { path: "/", exact: true };
  for (const simple of ["/quiz", "/profile", "/settings", "/onboarding"]) {
    if (pathname === simple) return { path: simple, exact: true };
  }
  let match = pathname.match(new RegExp(`^/(play|results)/${ID}$`));
  if (match) return { path: `/quiz/${match[1]}/${match[2]}`, exact: true };
  for (const game of games) {
    if (!under(pathname, `/${game}`)) continue;
    if (pathname === `/${game}`) return { path: pathname, exact: true };
    match = pathname.match(new RegExp(`^/${game}/(session|play|results)/${ID}$`));
    if (match) return { path: `/${game}/${match[1] === "results" ? "results" : "play"}/${match[2]}`, exact: true };
    return { path: `/${game}`, exact: false };
  }
  return { path: "/", exact: false };
}

/** Phone path (inside /phone) → desktop path. Every phone screen has a desktop counterpart. */
function phoneToDesktop(input: string): MappedPath {
  const pathname = clean(input);
  if (pathname === "/" || pathname === "/games") return { path: "/home", exact: true };
  if (pathname === "/welcome") return { path: "/", exact: true };
  if (pathname === "/sign-in") return { path: "/auth", exact: true };
  if (pathname === "/onboarding") return { path: "/onboarding", exact: true };
  if (under(pathname, "/profile")) return { path: "/profile", exact: pathname === "/profile" };
  if (under(pathname, "/settings")) return { path: "/settings", exact: pathname === "/settings" };
  if (under(pathname, "/quiz")) {
    if (pathname === "/quiz") return { path: "/quiz", exact: true };
    const match = pathname.match(new RegExp(`^/quiz/(play|results)/${ID}$`));
    return match ? { path: `/${match[1]}/${match[2]}`, exact: true } : { path: "/quiz", exact: false };
  }
  for (const game of games) {
    if (!under(pathname, `/${game}`)) continue;
    if (pathname === `/${game}`) return { path: pathname, exact: true };
    const match = pathname.match(new RegExp(`^/${game}/(play|results)/${ID}$`));
    if (!match) return { path: `/${game}`, exact: false };
    const [, kind, id] = match;
    // Desktop Flags and Capitals play at /session/:id; desktop Elimination shows its result on the play screen.
    if (kind === "play") return { path: `/${game}/${game === "flags" || game === "capitals" ? "session" : "play"}/${id}`, exact: true };
    return { path: `/${game}/${game === "elimination" ? "play" : "results"}/${id}`, exact: true };
  }
  return { path: "/home", exact: false };
}

export const routeMap = { desktopToPhone, phoneToDesktop };

/** Strip the /phone base from a browser pathname (the phone router's view of it). */
export function phoneInnerPath(pathname: string) {
  if (pathname === PHONE_BASE) return "/";
  return pathname.startsWith(PHONE_BASE + "/") ? pathname.slice(PHONE_BASE.length) || "/" : pathname;
}

/**
 * Full URL of the equivalent screen in the other app, or null when this screen has no counterpart.
 * `pathname` is the browser pathname (for the phone app including /phone). The query is kept for exact matches.
 */
export function equivalentUrl(fromApp: AppKind, pathname: string, search = ""): string | null {
  const mapped = fromApp === "desktop" ? desktopToPhone(pathname) : phoneToDesktop(phoneInnerPath(pathname));
  if (!mapped) return null;
  const query = mapped.exact ? search : "";
  if (fromApp === "phone") return mapped.path + query;
  return (mapped.path === "/" ? `${PHONE_BASE}/` : PHONE_BASE + mapped.path) + query;
}

/** A running round (or its deep link): "auto" never moves the player away from it. */
export function isRoundPath(app: AppKind, pathname: string) {
  const path = clean(app === "phone" ? phoneInnerPath(pathname) : pathname);
  if (app === "desktop" && /^\/play\/[^/]+$/.test(path)) return true;
  return /^\/(quiz|flags|capitals|recall|elimination)\/(play|session)\/[^/]+$/.test(path);
}

// ---------------------------------------------------------------------------------------------------------
// Redirect decision
// ---------------------------------------------------------------------------------------------------------

/** The app this device should show, or null when the current app is already right. */
export function resolveTarget(currentApp: AppKind, mode: ViewMode, detectedPhone: boolean): AppKind | null {
  const wanted: AppKind = mode === "phone" ? "phone" : mode === "desktop" ? "desktop" : detectedPhone ? "phone" : "desktop";
  return wanted === currentApp ? null : wanted;
}

export interface RedirectGuard {
  /** The app the last automatic redirect went to. */
  to: AppKind;
  /** Epoch ms of that redirect. */
  at: number;
}

export interface RedirectInput {
  app: AppKind;
  mode: ViewMode;
  detectedPhone: boolean;
  pathname: string;
  search?: string;
  hash?: string;
  guard: RedirectGuard | null;
  now: number;
}

/**
 * True when the URL comes from a Supabase email link: tokens or an error in the hash (implicit flow), or a
 * `?code=` (PKCE), `?token_hash=`, `?recovery=1` or `?auth=callback` query. Such a page must finish the sign-in
 * where it is; the view mode applies afterwards.
 */
export function isAuthCallbackUrl(search: string, hash: string) {
  if (/access_token|refresh_token|type=recovery|error_description/.test(hash)) return true;
  const query = new URLSearchParams(search);
  return (
    query.has("code") ||
    query.has("token_hash") ||
    query.has("recovery") ||
    query.has("error_description") ||
    query.get("auth") === "callback"
  );
}

/** Pure: the URL to replace the current page with, or null to stay. */
export function planRedirect(input: RedirectInput): string | null {
  const target = resolveTarget(input.app, input.mode, input.detectedPhone);
  if (!target) return null;
  // Supabase auth links (password reset, email confirmation) carry tokens: never move them.
  if (isAuthCallbackUrl(input.search ?? "", input.hash ?? "")) return null;
  // Loop guard: we were just sent here by the other app, so don't send the player straight back.
  if (input.guard && input.guard.to === input.app && input.now - input.guard.at < LOOP_WINDOW_MS) return null;
  if (input.mode === "auto") {
    if (input.guard) return null; // auto redirects at most once per browser session
    if (isRoundPath(input.app, input.pathname)) return null;
  }
  return equivalentUrl(input.app, input.pathname, input.search ?? "");
}

export function readGuard(): RedirectGuard | null {
  try {
    const raw = sessionStorage.getItem(REDIRECT_GUARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RedirectGuard>;
    return (parsed.to === "phone" || parsed.to === "desktop") && typeof parsed.at === "number"
      ? { to: parsed.to, at: parsed.at }
      : null;
  } catch {
    return null;
  }
}

function writeGuard(to: AppKind, now: number) {
  try {
    sessionStorage.setItem(REDIRECT_GUARD_KEY, JSON.stringify({ to, at: now }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Called by each app's main.tsx before rendering. Returns true when the page is being replaced by the other
 * app (the caller then renders nothing). Without sessionStorage there is no loop guard, so nothing redirects.
 */
export function redirectAtStartup(app: AppKind, win: Window = window, now = Date.now()): boolean {
  const url = planRedirect({
    app,
    mode: readViewMode(),
    detectedPhone: detectPhone(),
    pathname: win.location.pathname,
    search: win.location.search,
    hash: win.location.hash,
    guard: readGuard(),
    now,
  });
  if (!url) return false;
  const other: AppKind = app === "phone" ? "desktop" : "phone";
  if (!writeGuard(other, now)) return false;
  win.location.replace(url);
  return true;
}

/**
 * Explicit switch from a link or Settings: store the choice and open the equivalent screen in the other app.
 * Uses replace so Back does not land on a page that would redirect again.
 */
export function switchApp(from: AppKind, mode: ViewMode, win: Window = window, now = Date.now()) {
  setViewMode(mode);
  const to: AppKind = from === "phone" ? "desktop" : "phone";
  const url = equivalentUrl(from, win.location.pathname, win.location.search) ?? (to === "phone" ? `${PHONE_BASE}/` : "/");
  writeGuard(to, now);
  win.location.replace(url);
}

export const viewModeLabels: Record<ViewMode, string> = {
  auto: "Auto (recommended)",
  phone: "Phone",
  desktop: "Desktop",
};

/** One line for Settings: what Auto does and what this device was detected as. */
export function viewModeDescription(detectedPhone: boolean) {
  return `Auto opens the version that fits this device. This device looks like ${
    detectedPhone ? "a phone" : "a desktop, laptop or tablet"
  }.`;
}
