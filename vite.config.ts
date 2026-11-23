import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Libraries change rarely: keep them in their own long-cached chunks.
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
