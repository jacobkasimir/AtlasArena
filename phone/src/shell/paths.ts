// Top-level routes of the phone app (inside the router basename /phone). Areas own everything below their
// prefix, e.g. the quiz area decides what /quiz/play/:id looks like. Link with these constants, not strings.

export const PHONE_BASENAME = "/phone";
/** The desktop app (a different page: use a plain <a href>, not a router Link). */
export { DESKTOP_URL } from "@shared/phone-link";

export const paths = {
  home: "/",
  games: "/games",
  quiz: "/quiz",
  flags: "/flags",
  capitals: "/capitals",
  recall: "/recall",
  elimination: "/elimination",
  profile: "/profile",
  settings: "/settings",
  welcome: "/welcome",
  signIn: "/sign-in",
  onboarding: "/onboarding",
} as const;

/** Game areas: the Games tab is highlighted inside any of these. */
export const gamePrefixes = [paths.games, paths.quiz, paths.flags, paths.capitals, paths.recall, paths.elimination];

export function isUnder(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

const titles: [string, string][] = [
  [paths.games, "Games"],
  [paths.quiz, "Quiz"],
  [paths.flags, "Flags"],
  [paths.capitals, "Capitals"],
  [paths.recall, "Recall"],
  [paths.elimination, "Elimination"],
  [paths.profile, "Profile"],
  [paths.settings, "Settings"],
];

/** Default top-bar title for a route; screens can override it with usePhoneChrome({ title }). */
export function titleForPath(pathname: string) {
  if (pathname === paths.home) return "Atlas Arena";
  return titles.find(([prefix]) => isUnder(pathname, prefix))?.[1] ?? "Atlas Arena";
}

/**
 * Where the top-bar Back button goes when there is no in-app history (deep link): the area's start screen,
 * from there the Games list (game areas) or Home. Pass an explicit `back` path for anything more specific.
 */
export function parentPath(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length > 1) return "/" + parts[0];
  const inGame = gamePrefixes.some((prefix) => isUnder(pathname, prefix));
  return inGame && pathname !== paths.games ? paths.games : paths.home;
}
