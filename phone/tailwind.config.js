// Tailwind for the phone app only (used via `@config` in phone/src/ui/phone.css).
// Same colour names as the desktop config; content is limited to the phone app so neither bundle carries the
// other app's utilities.
import desktop from "../tailwind.config.js";

export default {
  content: { relative: true, files: ["./index.html", "./src/**/*.{ts,tsx}"] },
  theme: desktop.theme,
  plugins: [],
};
