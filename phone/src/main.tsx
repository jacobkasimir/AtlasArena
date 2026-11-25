import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { applyDocumentPrefs } from "@shared/prefs";
import { applyTheme, readTheme } from "@shared/theme";
import { track } from "@shared/analytics";
import "./ui/phone.css";
import { PhoneApp } from "./shell/PhoneApp";
import { PHONE_BASENAME } from "./shell/paths";
import { registerPhoneServiceWorker } from "./shell/registerSw";
import { redirectAtStartup } from "@shared/view-mode";

applyDocumentPrefs();
applyTheme(readTheme());

// View mode (Settings → View mode): open the desktop app instead when it fits this device or was chosen.
// Decided before rendering so the wrong app never flashes; see src/view-mode.ts for the loop guard.
if (!redirectAtStartup("phone")) {
  // Counted only by the app that actually opens, so a redirected visit isn't counted by both apps.
  track("return_visit");
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter basename={PHONE_BASENAME}>
        <PhoneApp />
      </BrowserRouter>
    </React.StrictMode>,
  );

  registerPhoneServiceWorker();
}
