// Colour theme (system / light / dark), stored per device. Shared by the desktop and the phone app.

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "atlas-theme";
export const THEME_COLOR_DARK = "#0B1020";
export const THEME_COLOR_LIGHT = "#f5f8ff";

export function readTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

/** Sets html[data-theme] and the browser UI colour (meta theme-color) for a theme choice. */
export function applyTheme(theme: string) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  const prefersLight =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches;
  if (meta)
    meta.setAttribute(
      "content",
      theme === "light" || (theme === "system" && prefersLight) ? THEME_COLOR_LIGHT : THEME_COLOR_DARK,
    );
}

/** Saves and applies a theme choice. */
export function saveTheme(theme: ThemeChoice) {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    /* storage can be unavailable; the theme still applies for this visit */
  }
  applyTheme(theme);
}
