// The phone app shares the site-wide service worker (/sw.js, scope "/"): it precaches both apps' static build
// files and answers offline navigations under /phone/ with /phone/index.html. It never caches API responses.

export function registerPhoneServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("/sw.js")
    .then((registration) => {
      function offerUpdate() {
        if (!registration.waiting || document.getElementById("ph-update")) return;
        const button = document.createElement("button");
        button.id = "ph-update";
        button.type = "button";
        button.className = "ph-btn ph-btn-primary";
        button.style.cssText =
          "position:fixed;z-index:80;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top) + 64px)";
        button.textContent = "Update ready · Reload";
        button.setAttribute("aria-label", "Reload Atlas Arena to install the ready update");
        button.onclick = () => {
          button.disabled = true;
          button.textContent = "Updating…";
          navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
          registration.waiting?.postMessage("ACTIVATE");
        };
        document.body.append(button);
      }
      offerUpdate();
      registration.addEventListener("updatefound", () =>
        registration.installing?.addEventListener("statechange", offerUpdate),
      );
    })
    .catch(() => {
      // The app stays usable online; a failed installation must not block play.
    });
}
