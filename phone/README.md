# Atlas Arena – phone app (`/phone/`)

A second Vite entry in this repo: a touch-first UI for phones, served at `/phone/`. It uses the **same**
Supabase project, accounts, RPCs, demo engines and saved progress as the desktop app. Only the UI is separate.
All rules in the root `CLAUDE.md` apply (server authoritative, demo parity, English UI, light + dark, a11y, …).

Scope: Home hub, Games list, Quiz (Classic/Practice/Timed/Endless), Flags, Capitals, Recall, Elimination,
Explorer (compact, read-only; route reserved, area in progress), Profile, Settings. No Admin or multiplayer.
The audit and the per-area task list live in `phone/AUDIT.md`.

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
      feel.ts                game feel: named haptic patterns + paired sound cues, feel(), useFeel()
      motion.tsx             useReducedMotion, useCountUp, useReplayKey, <Burst> (confetti-lite)
      GameButton.tsx         chunky pressable GameButton / LinkGameButton
      game.tsx               ResultHero, ScoreReveal, XpBar, StreakMeter, ComboToast, TimerBar, RetryMissedCard,
                             StatGrid/StatTile, GoalCard, SegmentedControl, ModeHero, MoreLink, medalTier
    areas/                   one folder per agent/area – only touch your own folder
      home/      index.tsx  → "/"           Games.tsx → "/games"
      quiz/      index.tsx  → "/quiz/*"
      geo/       flags.tsx  → "/flags/*"    capitals.tsx → "/capitals/*"
      typing/    recall.tsx → "/recall/*"   elimination.tsx → "/elimination/*"
      account/   profile.tsx → "/profile/*" (Leaderboard sheet at /profile/leaderboard)  settings.tsx → "/settings/*"
      explore/   index.tsx  → "/explorer/*"
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
| `AnswerList { layout: "list"\|"grid", label }` + `AnswerButton { index, state, onSelect, badge: "letter"\|"number"\|"none", detail }` | multiple choice (≥ 64 px, press-down, `select` haptic built in); `state`: `idle`/`selected` (spinner)/`correct` (pop)/`wrong` (shake)/`missed` (glow), shown as colour + icon + word and announced as text; layout from `usePhonePrefs().answerLayout` |
| `TextField { label, hint, …input props }` | 16 px text (no iOS zoom); pass `inputMode`, `enterKeyHint`, `autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck={false}` for typing games |
| `ActionBar { label }` | sticky primary actions |
| `BottomSheet { open, onClose, title, footer, closeOnBack, canClose }` | options/confirmations; Esc, × , backdrop and the device Back button close it; focus trap via `src/useDialog.ts` |
| `useToast().show(text, { tone, durationMs })` · `StatusMessage { tone, retry }` · `LoadingState { label }` | transient messages · inline status (`role=status`, errors `role=alert`) · loading |
| `useFeel()` → `{ tap, select, correct(streak?), wrong, answer(ok, streak?), streak(n), combo, timerWarning, timeUp, complete, levelUp, reward, error }` · `feel(kind, { n, sound })` | game feedback (haptics + sound), already gated by Settings; see "Game feel" below. `useHaptics()` is the old name and returns the same object |
| `GameButton { variant: "primary"\|"secondary"\|"success"\|"danger"\|"tone", size: "md"\|"lg"\|"xl", tone, block, icon, loading, haptic }` · `LinkGameButton` | chunky 3D game action with press-down; the main action of game screens (Start, Next, Play again). Forms and settings keep `Button` |
| `ResultHero { headline, tone, icon, score, scoreLabel, correct, total, timeMs, ranked, unrankedLabel, newBest, previousBest, xpGained, xpTotal, feedback }` | top of every results screen: medal tier + stars, count-up score, accuracy, time, new-best ribbon, practice badge, XP bar + level-up; fires one levelUp/reward/complete feedback |
| `ScoreReveal { value, label, prefix, suffix, size }` · `useCountUp(target, { from, durationMs, delayMs, enabled })` | count-up numbers (final value for screen readers at once) |
| `StreakMeter { streak, best }` · `ComboToast { streak }` | streak flame in the play header · "5 in a row!" pill on milestones (3, 5, 10, every 5) |
| `TimerBar { msLeft, totalMs, warnAtMs, calmFromMs, label, feedback }` | countdown with warning state; respects the calm-timer setting; timerWarning/timeUp feedback once each |
| `RetryMissedCard { count, to \| onRetry, title, text, cta, tone }` | learning-loop entry on results ("Practise the 4 you missed") |
| `StatGrid` + `StatTile { label, value, icon, tone, hint }` · `GoalCard { title, text, icon, tone, progress, to \| onClick, cta }` | number tiles · "Next goal" card |
| `SegmentedControl { label, options, value, onChange, describedBy }` | 2–4 exclusive options (radiogroup, arrow keys; `describedBy` = id of a description) |
| `ModeHero { title, subtitle, icon, tone, badge }` | game header card in the game's tone (h2) |
| `Burst { fireKey, count }` · `useReducedMotion()` · `useReplayKey(value)` | confetti-lite (≤ 30 DOM pieces, needs a `position: relative` parent) · motion gate · restart a CSS animation on change |
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
- Email links sent from the phone app open the phone app: sign-up / email confirmation land on
  `/phone/sign-in?auth=callback`, password reset on `/phone/sign-in?recovery=1` (new-password form). Links sent
  from the desktop app still open the desktop `/auth` screen.

## Game feel (rules)

Borrow patterns from great mobile games (chunky buttons, satisfying reveals, clear next goal; Seterra-style fast
learning loop), never names, art or assets. Keep Atlas Arena's tokens, icons and game tones.

- **Every answer gets instant, unambiguous feedback**: colour + icon + a word ("Correct", "Wrong", "Answer"),
  the correct answer is shown after a miss, and `feel.answer(correct, streak)` fires once the **server** answered.
  - *Exception – Recall finds*: Recall checks each typed name locally against the round's salted answer hashes
    (`@shared/recall-domain`) and fires `feel("correct", { n: fastStreak })` on that **local match**, before the
    server reply, so naming countries in a row feels instant like a drill. The find is sent at once and the server
    stays authoritative: if it does not confirm the answer (or the request fails) the find is rolled back (slot,
    counter, feed and fast streak) and an `error` feel plays with a message. Scores and bests still come only from
    the server.
- **Press feel**: game actions use `GameButton` (press-down edge); answers use `AnswerButton` (pressed state,
  light `select` haptic built in, pop on correct, shake on wrong).
- **Results reveal** with `ResultHero` at the top, then `RetryMissedCard` (learning loop), then the review list
  (mistakes first), then "Play again" as the primary `GameButton` in the `ActionBar`.
- **Practice vs ranked** is always visible: `ranked={false}` shows "Practice · not ranked" and never a new best.
- **Motion** is decoration only: everything in `motion.tsx`/`phone.css` game-feel section switches off under the
  OS setting or Settings → Reduce motion. Never convey state by motion alone.
- **Haptics are rare and meaningful**: no haptic on scroll, typing or every button. A cooldown swallows repeats
  (tap/select share 70 ms; timerWarning 800 ms; others 90 ms). Don't call `tap` *and* use a `GameButton` (it taps).
- **Sound** follows Settings (sound on/off, volume); cues are synthesized, ≤ 0.6 s, and only play after the first
  user gesture (browser autoplay rules). Taps and selects are silent.
- **Timers** respect Settings → Timer display "calm" (`TimerBar` handles it); the server owns every deadline.

### Haptics map (`phone/src/ui/feel.ts`)

| Kind | When | Vibration (ms on/off) | Sound |
|---|---|---|---|
| `tap` | GameButton press, generic action | 8 | – |
| `select` | AnswerButton, tab switch, SegmentedControl | 5 | – |
| `correct` | server says right | 18 | two rising notes |
| `streak(n)` | right answer on streak 3, 5, 10, every 5 (automatic via `correct(streak)`) | 2–5 rising pulses | arpeggio, higher for longer streaks |
| `wrong` | server says wrong | 30·40·30 | low falling tone |
| `combo` | bonus / fast series (area decides) | 12·30·12·30·24 | two high blips |
| `timerWarning` | TimerBar crosses `warnAtMs` | 10·90·10 | one short tick |
| `timeUp` | TimerBar reaches 0 | 60·50·120 | two low notes |
| `complete` | round finished (ResultHero default) | 20·60·20·60·40 | four-note rise |
| `reward` | gold medal / new best (ResultHero) | 15·35·15·35·60 | bright shimmer |
| `levelUp` | XP crossed a level (ResultHero) | 20·40·30·40·45·40·80 | five-note fanfare |
| `error` | request failed / not allowed | 45·35·45 | low double buzz |

Android/Chrome play the pattern (Vibration API). iOS Safari has no Vibration API: since iOS 18 one light tick via
the native switch trick in `src/prefs.ts`, and only inside a tap handler (feedback after a server reply is silent
on iOS; the sound cue still plays).

## Commands

`npm run dev` serves both apps (`/` and `/phone/`, deep links included). `npm run build` outputs
`dist/index.html` and `dist/phone/index.html`; `scripts/build-sw.mjs` precaches both and falls back to the right
shell offline. `npm test` runs `src` and `phone` tests.
