# Phone app audit (2026-11-25)

Desktop (`src/`, `/`) vs phone (`phone/`, `/phone/`). Same Supabase backend, RPCs, demo engines, prefs and saved
setups; only the UI differs. Status: [x] done · [ ] to do · [~] partial. Nothing here was checked on a real phone.

## (a) Feature parity per mode

| Feature | Desktop | Phone | Note |
|---|---|---|---|
| Home hub: continue, progress, level | `Hub.tsx` | [x] `areas/home` | |
| Today: daily challenge, review, achievements | `Today.tsx` | [x] home cards | online-only in demo on both |
| Quiz setup: mode · difficulty · topic · length, catalog counts | `Quiz.tsx` | [x] `QuizSetup` | same `arena_quiz_catalog` filter |
| Quiz play: feedback, explanation, timer, endless | yes | [x] `QuizPlay` | [ ] streak meter, combo, TimerBar |
| Quiz results: score, XP, accuracy, review, play again | yes | [x] `QuizResults` | [ ] ResultHero, retry-missed |
| Review my mistakes | `Review.tsx` | [x] `/quiz/review` | title differs (see b) |
| Flags / Capitals setup (`GameSetup` options) | `game-setup.tsx` | [x] `geo/setup.tsx` | same keys, shared remembered setup |
| Flags pause/resume, hints, skip, attempts | yes | [x] | |
| Flags / Capitals results: score, top five, review | yes | [x] | [ ] mistakes first, ResultHero |
| Recall: set, EN/DE/FR typing, found list, bests | yes | [x] | |
| Elimination: puzzles, guesses, hints, candidates | yes | [x] | online only (demo note) |
| Personal bests (`arena_personal_bests`) | Profile/Statistics | [x] stats + setups | |
| Game totals (`arena_game_stats`) | Statistics | [x] `/profile/statistics` | |
| Achievements grid | Statistics | [x] `/profile/achievements` | |
| Leaderboard | `Leaderboard.tsx` (Hub) | [x] sheet at `/profile/leaderboard` | Home links there; closing returns to `/profile` |
| Explorer (atlas) | `Explorer.tsx` (`api.explore`) | [ ] **missing** | **Decision: add a compact phone Explorer.** Route `/explorer/*` + placeholder are in place (`areas/explore`) |
| Admin, question editor | yes | – | out of scope on phone (by design) |
| Keyboard hints / number keys / continue keys | Settings | – | desktop-only by design |
| Settings: haptics, sound, volume, motion, text size, contrast, density, timers, auto-continue, confirmations | yes | [x] + answer layout, view mode | `focusAlways` desktop only |
| Email links (sign-up, reset) | `/auth` | [x] `/phone/sign-in?auth=callback`, `?recovery=1` | README fixed |

## (b) Naming / copy / flow inconsistencies to align

- [ ] Review screen title: phone "Review mistakes" (`QuizReview.tsx`) vs "Review my mistakes" (desktop, phone Home card). Use **Review my mistakes**.
- [ ] Results titles: quiz "Results" vs "Flags results"/"Capitals results"/"Recall results"/"Elimination results". Use **"<Game> results"** ("Quiz results").
- [ ] Wrong-answer stat: phone Flags "Not solved", phone Capitals "Not quite", desktop "Incorrect". Use **Incorrect**.
- [ ] Time stat: desktop "Elapsed"/"Time left", phone "Time". Phone keeps **Time** (ResultHero shows "Time"); desktop may follow later.
- [ ] Missed lists: Recall "Missed · n", geo "Not solved", quiz "mistakes". Use **Missed** for lists, **Retry missed** for the action.
- [ ] Practice labelling: quiz Practice mode, random samples "unranked", Flags "Practice round". On results always show the ResultHero badge **"Practice · not ranked"** (`ranked={false}`), never a new best.
- [ ] Review order: quiz results list mistakes first; Flags/Capitals review is in round order. Use **mistakes first** everywhere.
- [ ] Results feedback: some areas call `haptics.complete()` when the last answer lands *and* would get ResultHero's feedback: fire it once (ResultHero).

## (c) Phone UX problems per area

**Shell** (done in this pass): [x] tab switch haptic + animated active pill · [x] page rise-in on area change (reduced-motion safe) · [x] tab bar hidden during rounds and with keyboard (already) · [x] Explorer route.

**Home** — [ ] no single "next goal" (what to do now): add GoalCard at top (daily not done → daily; unfinished round → continue; else weakest game) · [ ] level bar static: use XpBar look · [ ] streak not celebrated (StreakMeter) · [ ] no Explorer entry in Games list · [ ] Leaderboard only via Profile.

**Quiz** — [ ] streak/combo invisible during play · [ ] timed mode: no warning state/haptic near the end (TimerBar) · [ ] Next/Start are flat buttons: GameButton in ActionBar · [ ] results start with plain numbers, no medal/reveal · [ ] no retry-missed entry right on results (→ Review my mistakes, online).

**Geo (Flags/Capitals)** — [ ] typed answers (Capitals, Flag → Country): wrong/right feedback is text only, add shake/pop on the input row + `feel.answer` · [ ] RoundClock has no warning state/haptic: TimerBar · [ ] flag grid answers: use `AnswerButton badge="none"` look for consistency · [ ] results: ResultHero (`ranked = result.ranked !== false`, `newBest = finalBadge === "new_best"`), mistakes first, RetryMissedCard → Review my mistakes · [ ] keyboard: keep the input + Check above the keyboard (ActionBar) and `enterKeyHint="go"` (verify on iOS).

**Typing (Recall/Elimination)** — [ ] each found name: tiny `select`/`correct` (cooldown keeps fast typing from buzzing), bump the counter (`useReplayKey`) · [ ] timed Recall: TimerBar · [ ] results: ResultHero (correct = found, total = set size, `ranked` false for samples) + Missed list first + RetryMissedCard (onRetry = same setup again; there is no server API to replay only missed entries) · [ ] Elimination: celebrate a solved chain (reward), wrong guess shake.

**Account** — [ ] Settings: "Try haptics" preview that plays the map (tap, correct, wrong, streak, levelUp) instead of a single `haptic("correct")` · [ ] replace account-local Segmented with `SegmentedControl` from `@phone/ui` · [ ] Statistics: StatGrid/StatTile · [ ] Profile header: level + XpBar look, StreakMeter · [ ] achievements unlocked: reward visuals.

**Explore** (new) — [ ] build compact atlas: search field (16 px, `enterKeyHint="search"`), region SegmentedControl/Chips, country list rows (flag from `/flags/<alpha2>.svg`, name, capital), detail sheet (capital, region, languages, neighbours), link "Practise this region" → Flags/Capitals setup with region param. Read-only, `api.explore` (demo branch exists).

General: [ ] no screen uses the new game-feel components yet (foundation only) · [ ] verify on real Android (vibration patterns) and iOS ≥ 18 (switch tick only within taps) · [ ] verify 360 px width for ResultHero stats (auto-fit grid).

## (d) Prioritised tasks per area (non-overlapping file ownership)

Foundation (`phone/src/ui/**`, `phone/src/shell/**`, `phone/README.md`, `src/prefs.ts`, `src/sound.ts`) is
**frozen** for area agents: ask the lead for changes. Each agent owns only its folder (incl. its CSS and tests).

| Prio | Area · owner files | Tasks |
|---|---|---|
| P1 | **quiz** · `phone/src/areas/quiz/**` | QuizPlay: `useFeel().answer(feedback.correct, stats.streak)`, `StreakMeter` in the round header, `ComboToast`, `TimerBar` for Timed (msLeft from server deadline), Next/Start as `GameButton` in ActionBar. QuizResults: `ResultHero` (`ranked = mode !== "practice"`, `newBest = setsNewPersonalBest(…)`, `xpGained = stats.xp`, `xpTotal` only if known), `RetryMissedCard to="/quiz/review"` (hide in demo: ONLINE_ONLY), "Quiz results" title. QuizReview: title "Review my mistakes", GameButton, feel. |
| P1 | **geo** · `phone/src/areas/geo/**` | Flags + Capitals play: `feel.answer`, pop/shake on the typed-answer row (`ph-pop`/`ph-shake` classes), `TimerBar` replaces RoundClock countdown (keep calm mode), `StreakMeter` if the view has a streak. Results: `ResultHero` (score, correct/total, `timeMs = elapsedMs`, `ranked`, `newBest`), review mistakes first, stat label "Incorrect", `RetryMissedCard to="/quiz/review"` (online), "Play again" GameButton. |
| P1 | **typing** · `phone/src/areas/typing/**` | Recall: feedback per found name, counter bump, `TimerBar`, results `ResultHero` + Missed first + `RetryMissedCard onRetry` (same setup). Elimination: reward on solved chain, shake on wrong guess, results `ResultHero` (tier from solved groups). |
| P2 | **home** · `phone/src/areas/home/**` | `GoalCard` "Next goal" at the top, `StreakMeter`, level bar in XpBar style, Games list: chunky game cards + **Explorer card** (`paths.explorer`), `LinkGameButton` as the one primary action, Leaderboard shortcut. |
| P2 | **account** · `phone/src/areas/account/**` | Settings: haptics/sound preview of the map, `SegmentedControl`; Statistics with `StatGrid`/`StatTile`; Profile header level/XP; achievements reward look. |
| P2 | **explore** · `phone/src/areas/explore/**` | Build the compact Explorer (see c). Replace the placeholder; tests with the demo engine. |
| P3 | lead (foundation) | Real-device pass (Android vibration, iOS tick, safe areas, keyboard), Lighthouse/a11y pass, any API additions requested by areas. |

Rules for all: obey `CLAUDE.md` and `phone/README.md` (Game feel rules). Server decides correctness, scores,
bests and XP; components only display it. English UI, light + dark + high contrast, ≥ 48 px targets, reduced
motion, demo parity. Plain CSS with tokens in `areas/<area>/<area>.css`.
