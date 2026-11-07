import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./style.css";
import { track } from "./analytics";

document.documentElement.dataset.motion = localStorage.getItem("atlas-motion") ?? "system";
const savedTheme=localStorage.getItem("atlas-theme");
if(savedTheme) document.documentElement.dataset.theme=savedTheme;
const themeColor=document.querySelector('meta[name="theme-color"]');
if(themeColor)themeColor.setAttribute("content",savedTheme==="light"||(!savedTheme&&matchMedia("(prefers-color-scheme: light)").matches)?"#f5f8ff":"#0B1020");
track("return_visit");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><BrowserRouter><App/></BrowserRouter></React.StrictMode>
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then(reg => {
    function offerUpdate() {
      if (!reg.waiting) return;
      const button = document.createElement("button");
      button.className = "primary";
      button.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:100";
      button.textContent = "Update ready · Reload";
      button.onclick = () => {
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
