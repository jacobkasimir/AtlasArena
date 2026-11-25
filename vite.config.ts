import { resolve } from "node:path";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Two apps from one build: the desktop app at / (index.html) and the phone app at /phone/ (phone/index.html).
 * In dev and preview, deep links such as /phone/quiz/play/123 must get the phone page, not the desktop one.
 */
const phoneFallback: Connect.NextHandleFunction = (req, _res, next) => {
  const path = (req.url ?? "").split("?")[0];
  const isPage = req.method === "GET" && (req.headers.accept ?? "").includes("text/html");
  if (isPage && (path === "/phone" || (path.startsWith("/phone/") && !/\.[a-z0-9]+$/i.test(path)))) {
    req.url = "/phone/index.html";
  }
  next();
};

function phoneApp(): Plugin {
  return {
    name: "atlas-phone-fallback",
    configureServer(server) {
      server.middlewares.use(phoneFallback);
    },
    configurePreviewServer(server) {
      server.middlewares.use(phoneFallback);
    },
  };
}

export default defineConfig({
  plugins: [react(), phoneApp()],
  resolve: {
    // Phone app imports: "@shared/…" is the shared desktop code in src/, "@phone/…" is phone/src/.
    alias: {
      "@shared": resolve(__dirname, "src"),
      "@phone": resolve(__dirname, "phone/src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        phone: resolve(__dirname, "phone/index.html"),
      },
      output: {
        // Libraries change rarely: keep them in their own long-cached chunks, shared by both apps.
        manualChunks: { react: ["react", "react-dom", "react-router-dom"], supabase: ["@supabase/supabase-js"] },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    exclude: ["node_modules/**", "tests/e2e/**"]
  }
});
