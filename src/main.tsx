import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./style.css";
import "./prefs.css";
import "./desktop-fixes.css";
import { track } from "./analytics";
import { applyDocumentPrefs } from "./prefs";
import { ShortcutOverlay } from "./shortcuts";
import { redirectAtStartup } from "./view-mode";

applyDocumentPrefs();
const savedTheme=localStorage.getItem("atlas-theme");
if(savedTheme) document.documentElement.dataset.theme=savedTheme;
const themeColor=document.querySelector('meta[name="theme-color"]');
if(themeColor)themeColor.setAttribute("content",savedTheme==="light"||(!savedTheme&&matchMedia("(prefers-color-scheme: light)").matches)?"#f5f8ff":"#0B1020");

// View mode (Settings → View mode): open the phone app instead when it fits this device or was chosen.
// Decided before rendering so the wrong app never flashes; see src/view-mode.ts for the loop guard.
const switchingApp = redirectAtStartup("desktop");
// Counted only by the app that actually opens, so a redirected visit isn't counted by both apps.
if (!switchingApp) track("return_visit");

if (!switchingApp) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <ShortcutOverlay />
    </React.StrictMode>
  );
}

if (!switchingApp && import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then(reg => {
    function offerUpdate() {
      if (!reg.waiting) return;
      if (document.getElementById("pwa-update")) return;
      const button = document.createElement("button");
      button.id = "pwa-update";
      button.className = "primary pwa-update";
      button.setAttribute("aria-label", "Reload Atlas Arena to install the ready update");
      button.textContent = "Update ready · Reload";
      button.onclick = () => {
        button.disabled = true;
        button.textContent = "Updating…";
        navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
        reg.waiting?.postMessage("ACTIVATE");
      };
      document.body.append(button);
    }
    offerUpdate();
    reg.addEventListener("updatefound", () => reg.installing?.addEventListener("statechange", offerUpdate));
  }).catch(() => {
    // The app remains usable online; installation failure must not block gameplay.
  });
}
