import { useState } from "react";
import { useLocation } from "react-router-dom";
import { PHONE_URL, dismissPhoneSuggestion, shouldSuggestPhone } from "./phone-link";
import { equivalentUrl, setViewMode } from "./view-mode";

/**
 * Small, dismissible hint for phone players in View mode "Auto" who are on the desktop app anyway.
 * "Open phone version" opens the same screen in the phone app and remembers the choice (View mode: Phone).
 */
export function PhoneSuggestion() {
  const [visible, setVisible] = useState(shouldSuggestPhone);
  const location = useLocation();
  if (!visible) return null;
  const href = equivalentUrl("desktop", location.pathname, location.search) ?? PHONE_URL;
  return (
    <aside className="phone-suggestion" aria-label="Phone version">
      <p>Atlas Arena has a version made for phones.</p>
      <div className="phone-suggestion-actions">
        <a className="primary" href={href} onClick={() => setViewMode("phone")}>
          Open phone version
        </a>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            dismissPhoneSuggestion();
            setVisible(false);
          }}
        >
          Not now
        </button>
      </div>
    </aside>
  );
}
