# CLAUDE.md — Atlas Arena

Rules and context Claude must follow every time it works in this repository.

## Product in one line
Atlas Arena makes geography knowledge discoverable in an atlas (Explore), learnable through
focused challenges (Play / Master), and rewarding to improve over time.

## Current priority (do not drift)
Finish each mode **end to end** before starting another one:
selection → playable session → feedback → results → saved progress.

| Mode | Route | State |
|---|---|---|
| Classic / Practice / Timed / Endless quiz | `/home`, `/play/:id`, `/results/:id` | End to end (server + demo) |
| Flags | `/flags/*` | End to end (server + demo) |
| Capitals | `/capitals/*` | End to end (server + demo) |
| Explorer | `/explorer` | Read-only atlas |
| Recall | `/recall/*` (`src/RegionRecallSetup.tsx`) | **Setup screen only** — no session, answer checking, results or persistence yet |
| Map Challenge, multiplayer | — | Deferred. Do not start. |

Do not call Recall (or any mode) "playable" until all five steps work and are tested.
Do not add a new mode or multiplayer while a mode is half-finished.

## Stack and layout
- React 18 + TypeScript (strict) + React Router 6 + Tailwind 3, built with Vite 6.
- Supabase (Postgres, Auth, RPC, one Edge Function) is the backend. Vercel hosts static files only.
- `src/api.ts` — the only place that talks to Supabase. Every call has a demo branch.
- `src/domain.ts` — shared types, scoring, eligibility and state rules. `*-domain.ts` per mode.
- `src/demo.ts`, `flags-demo.ts`, `capitals-demo.ts` — device-local demo engines (localStorage).
- `src/App.tsx` — layout, routes, quiz screens. Feature screens are lazy-loaded (`Admin`, `Explorer`, `Flags`, `Capitals`, `RegionRecallSetup`).
- `supabase/migrations/` — the **only** source of truth for schema and RPCs.
- `scripts/` — build/import tooling (`build-sw.mjs` runs after `vite build`).

## Commands
```
npm run dev              # Vite dev server (demo mode if both VITE_SUPABASE_* are empty)
npm run build            # tsc --noEmit && vite build && service-worker generation
npm test                 # vitest (unit, src/)
npm run test:e2e         # Playwright
npm run test:integration # backend tests; needs TEST_SUPABASE_* against a DISPOSABLE project
```
Before reporting work as done: `npm run build` must pass (it type-checks) and `npm test` must pass.
If you could not run them, say so explicitly.

## Hard rules

### Backend / security
1. **The server is authoritative.** Scores, XP, streaks, deadlines, correctness and session state
   are decided in Postgres `SECURITY DEFINER` functions. The client never computes or writes them.
2. New RPCs: `SECURITY DEFINER`, `SET search_path = ''`, fully qualified names, check `auth.uid()`,
   lock the owned session row, call `private.rate(...)`. Private data lives in schema `private`.
3. Correct answers / explanations are never returned before the answer is accepted.
4. **Every schema or RPC change is a new timestamped migration** in `supabase/migrations/`
   (`YYYYMMDDHHMMSS_description.sql`). Never edit an applied migration. Never apply SQL only via the
   dashboard — if that happened, capture it in a migration immediately.
5. No service-role key in any `VITE_` variable or frontend file. Never print, copy or commit values
   from `.env.local` or `information.txt`.
6. Admin rights come only from `auth.users.raw_app_meta_data.atlas_admin`, never from profile fields.

### Demo mode parity
7. Demo mode (`isDemo` in `api.ts`) must keep working. Every new `api.*` function needs a demo
   implementation returning the same shape, or a clear "not available in demo" error.
8. Demo data is unverified sample data and is never uploaded or merged into accounts.

### Content integrity
9. The country database is the **foundation, not finished content**. Generated questions are drafts.
10. Publication requires a real human review: `reviewStatus=reviewed`, `sourceVerified=true`,
    a real `lastReviewed` date. **Never set these fields in bulk or by script**, and never write code
    that does so. Claude must not attest that content was reviewed.
11. Imports go through the admin JSON importer (dry-run first). No direct inserts into question tables.

### Frontend
12. UI language is **English**. All visible text and aria-labels in English (no mixed German).
13. Must work in light and dark mode (`html[data-theme]` + `prefers-color-scheme`) and on phones (≥360 px).
14. Accessibility: keyboard reachable, visible focus, `aria-pressed` for toggle buttons, `role="status"`
    for live messages, focus the page `h1` on navigation (already done in `Layout`).
15. Flags are served from `/public/flags/<alpha2>.svg`. Only `flags.restcountries.com` is allowed as an
    external image host (see CSP in `vercel.json`). Any new external host requires a CSP update.
16. PWA: the service worker caches build-time static files only — never API or authorized responses.

### Code style
17. Write new and touched code in readable, formatted TypeScript. Do not add more dense
    one-line-per-component code (existing `App.tsx`, `Flags.tsx` are hard to review — refactor
    only when you are already changing that code).
18. Keep `src/api.ts` types exact: a mode's demo and server branch must return the same type.
19. Each new mode gets: a `*-domain.ts` with pure logic + unit tests, a demo engine, RPCs in a migration,
    and a route component.

### Git and files
20. Commit only when asked. Small, descriptive commit messages (not "flag gamev7").
21. Never commit: `.env*` (except `.env.example`), `information.txt`, `.venv*/`, `dist/`,
    `node_modules/`, `test-results/`, `country-import/`, `supabase/.temp/`, `supabase/.branches/`.
22. Python tooling lives in `scripts/`, data in `content/`. Do not add new loose files at the repo root.

## Open issues (fix before building on top)
- README is stale: written by an earlier generator, does not mention Flags, Capitals, Explorer, Recall,
  the country catalog, or the real deployment. Update it when behaviour changes.
- Recall (`/recall`) is a setup screen only. Cities are hidden until a city catalog exists.
- `src/api.auth.test.tsx` only passes when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are set
  (e.g. from `.env.local`); it should stub them with `vi.stubEnv` instead.
- `npm test` from a Linux shell needs its own `npm ci`; the checked-out `node_modules` is macOS-only.
- The hosted database had SQL applied outside migrations once (`arena_explore`, reconciled in
  `20261122100000_reconcile_arena_explore.sql`). If `supabase db push` reports drift, capture it in a
  migration — never "fix" it in the dashboard.
- Draft question files live in `content/drafts/`. None of them is reviewed.
