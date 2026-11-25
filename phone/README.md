# Atlas Arena – phone app (`/phone/`)

A second Vite entry in this repo: a touch-first UI for phones, served at `/phone/`. It uses the **same**
Supabase project, accounts, RPCs, demo engines and saved progress as the desktop app. Only the UI is separate.
All rules in the root `CLAUDE.md` apply (server authoritative, demo parity, English UI, light + dark, a11y, …).

Scope: Home hub, Games list, Quiz (Classic/Practice/Timed/Endless), Flags, Capitals, Recall, Elimination,
Profile, Settings. No Explorer, Admin or multiplayer.

## Layout

```
phone/
  index.html                 page for /phone/ (theme script must stay byte-identical to /index.html: CSP hash)
  tailwind.config.js         Tailwind for phone files only (same colour names as desktop)
  src/
    main.tsx                 boot: prefs data attributes, theme, BrowserRouter basename "/phone", service worker
    prefs-phone.ts           phone-only prefs (answerLayout). Everything else: src/prefs.ts as-is
    shell/                   FOUNDATION – routing, gate, layout. Change only by agreement.
      PhoneApp.tsx           route table; every area is a lazy route
      paths.ts               top-level paths, titles, parentPath(), DESKTOP_URL
      chrome.tsx             usePhoneChrome({ title, back, hideTabBar }), <TopBarActions>
      Layout.tsx             top bar (page h1) · main · bottom tab bar (Home · Games · Profile · Settings)
      Gate.tsx               PhoneGate = desktop <Protected> logic via src/auth-flow.ts
      AuthScreens.tsx        Welcome (/welcome), SignIn (/sign-in?mode=…), Onboarding (/onboarding)
    ui/                      FOUNDATION – design system, import from "@phone/ui"
      phone.css              tokens + ph-* classes (imports src/theme-tokens.css, src/game-tones.css, src/prefs.css)
    areas/                   one folder per agent/area – only touch your own folder
      home/      index.tsx  → "/"           Games.tsx → "/games"
      quiz/      index.tsx  → "/quiz/*"
      geo/       flags.tsx  → "/flags/*"    capitals.tsx → "/capitals/*"
      typing/    recall.tsx → "/recall/*"   elimination.tsx → "/elimination/*"
      account/   profile.tsx → "/profile/*" settings.tsx → "/settings/*"
```

## Imports

- `@shared/…` = desktop `src/` (shared logic): `@shared/api`, `@shared/domain`, `@shared/flags-domain`…,
  `@shared/prefs`, `@shared/sound`, `@shared/game-setup` (domain helpers/types only), `@shared/auth-flow`,
  `@shared/theme`, `@shared/icons`, `@shared/components` (`useLoad` only).
- `@phone/…` = `phone/src/` (`@phone/ui`, `@phone/shell/chrome`, `@phone/shell/paths`, `@phone/prefs-phone`).
- Never import a desktop **screen** (`Quiz.tsx`, `Flags.tsx`, `Hub.tsx`, `Settings.tsx`, `Auth.tsx`, `App.tsx`, …)
  into the phone app: they pull desktop CSS classes and code. If you need logic that lives inside a desktop screen,
  move it into a shared non-UI module (like `src/auth-flow.ts`) and use it from both apps.
- The shell is eager; areas are lazy. Don't import an area from the shell or from another area.

## Adding a screen

1. Work inside your area folder. The area's default export owns everything below its prefix; add nested routes:
   ```tsx
   export default function FlagsArea() {
     return (
       <Routes>
         <Route index element={<FlagsSetup />} />
         <Route path="play/:id" element={<FlagsPlay />} />
         <Route path="results/:id" element={<FlagsResults />} />
       </Routes>
     );
   }
   ```
   Links: `` `${paths.flags}/play/${id}` `` (import `paths` from `@phone/shell/paths`).
2. In each screen call `usePhoneChrome({ title, back, hideTabBar })` **once**: `title` becomes the page `<h1>` in
   the top bar (use `h2` inside the screen), `back: true` shows Back (history, or one level up after a deep link) or
   `back: "/flags"` for a fixed target, `hideTabBar: true` while a round runs.
3. Put extra top-bar buttons in `<TopBarActions>` (e.g. an `IconButton label="Give up"`).
4. Primary action last in the screen, inside `<ActionBar>` – it sticks above the tab bar, safe area and keyboard.
5. Use the API through `api.*` only; every call already has a demo branch. Online-only features reject with
   `ONLINE_ONLY` in the demo: show that as a `StatusMessage`, not an error page.
6. Add tests next to your files (`*.test.tsx`, Vitest + Testing Library). Render with
   `<MemoryRouter initialEntries={["/flags"]}><PhoneApp /></MemoryRouter>` or your component alone. Stub
   `VITE_SUPABASE_*` to `""` with `vi.stubEnv` in `vi.hoisted` so tests run on the demo engine.

## Building blocks (`@phone/ui`)

| Component / hook | Use |
|---|---|
| `Button` `{ variant: "primary"\|"secondary"\|"ghost"\|"danger", size: "md"\|"lg", block, icon, loading }` | every action; 48 px (56 px `lg`); `type="button"` unless you pass `type="submit"` |
| `LinkButton` (router `LinkProps` + same look) · `IconButton { label }` | navigation styled as a button · 48 × 48 icon button |
| `Card { as }` · `LinkCard { to, title, text, icon, tone, trailing }` · `ActionCard { onClick, … }` · `Section { title }` | surfaces, ≥ 64 px tappable rows, titled groups (h2) |
| `Chip { pressed, onToggle }` in `ChipGroup { label }` | toggles with `aria-pressed` |
| `ProgressBar { value, max, label, showValue }` | round progress (`role="progressbar"`) |
| `AnswerList { layout: "list"\|"grid", label }` + `AnswerButton { index, state, onSelect }` | multiple choice; `state`: `idle`/`selected`/`correct`/`wrong`/`missed`, announced as text; layout from `usePhonePrefs().answerLayout` |
| `TextField { label, hint, …input props }` | 16 px text (no iOS zoom); pass `inputMode`, `enterKeyHint`, `autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck={false}` for typing games |
| `ActionBar { label }` | sticky primary actions |
| `BottomSheet { open, onClose, title, footer, closeOnBack, canClose }` | options/confirmations; Esc, × , backdrop and the device Back button close it; focus trap via `src/useDialog.ts` |
| `useToast().show(text, { tone, durationMs })` · `StatusMessage { tone, retry }` · `LoadingState { label }` | transient messages · inline status (`role=status`, errors `role=alert`) · loading |
| `useHaptics()` → `{ tap, correct, wrong, complete }` | feedback; already respects Settings (haptics, sound, volume) |
| `useViewportHeight()` → `{ height, keyboardInset, keyboardOpen }` | layout around the on-screen keyboard (CSS: `--ph-viewport-height`, `--ph-keyboard-inset`, `html[data-keyboard]`) |
| `AreaPlaceholder { title, text }` | stub content; delete when your area is real |

## Conventions

- Class names: `ph-*` for shared phone classes (in `ui/phone.css`); area-specific CSS goes in
  `areas/<area>/<area>.css`, imported by that area, with a `ph-<area>-` prefix. Tailwind utilities are available.
- Area stylesheets are **plain CSS**: no Tailwind directives (`@layer components`, `@apply`, `@tailwind`) in
  `areas/**/*.css`. They are not Tailwind entry files, so `@layer components` there makes `npm run build` fail.
  Shared component classes belong in `ui/phone.css`; in an area, write the CSS out with tokens.
  Colours only through tokens (`rgb(var(--c-…))`, Tailwind `bg-surface`, `text-mint`, …) so light/dark/high
  contrast work. Never hard-code a theme colour.
- Touch: targets ≥ 44 px (48 by default), no hover-only UI, no swipe-only actions, `touch-action: manipulation`
  is global. Inputs ≥ 16 px. Zoom stays enabled.
- Respect `src/prefs.ts`: `usePrefs()` for auto-continue, confirmations, calm timers; `loadSetup`/`saveSetup` with the
  same mode keys as desktop (setups are shared between the two apps on one device); `useLeaveGuard` during rounds.
  Keyboard-hint and number-key prefs are desktop-only.
- Accessibility: the top-bar h1 receives focus after navigation (shell does this); live updates use `role="status"`;
  toggles use `aria-pressed`; results are announced as text, not only colour.
- The phone app links to the desktop app with a plain `<a href={DESKTOP_URL}>` (+ `dismissPhoneSuggestion`).
- Password reset and email-confirmation links from Supabase open the desktop app (`/auth`), by design for now.

## Commands

`npm run dev` serves both apps (`/` and `/phone/`, deep links included). `npm run build` outputs
`dist/index.html` and `dist/phone/index.html`; `scripts/build-sw.mjs` precaches both and falls back to the right
shell offline. `npm test` runs `src` and `phone` tests.
