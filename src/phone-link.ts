// Links between the desktop app (/) and the phone app (/phone/). The automatic switch and the "View mode"
// setting live in src/view-mode.ts; this module keeps the URLs and the dismissible suggestion banner state.
import { detectPhone, readViewMode } from "./view-mode";

export const PHONE_URL = "/phone/";
export const DESKTOP_URL = "/";
const KEY = "atlas-phone-suggestion";

/** Remember that the player does not want the phone suggestion (also set when they leave the phone app). */
export function dismissPhoneSuggestion() {
  try {
    localStorage.setItem(KEY, "dismissed");
  } catch {
    /* storage unavailable: the suggestion simply shows again next time */
  }
}

/**
 * True on a phone when the view mode is Auto and the player has not dismissed the suggestion – i.e. a phone
 * player who is on the desktop app anyway (auto switch already used this session, a running round, or a
 * desktop-only screen). An explicit "Desktop" choice never shows it.
 */
export function shouldSuggestPhone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (localStorage.getItem(KEY) === "dismissed") return false;
  } catch {
    return false;
  }
  return readViewMode() === "auto" && detectPhone();
}
