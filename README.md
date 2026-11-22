# Atlas Arena

A geography game that helps people learn the world through play – and gives them reasons to come back and improve.

## Games

| Game | Route | What you do |
|---|---|---|
| Home | `/home` | Level and XP, leaderboard, continue unfinished rounds, one card per game |
| Quiz | `/quiz` → `/play/:id` → `/results/:id` | Multiple choice in four modes (Classic, Practice, Timed, Endless) and four tiers |
| Flags | `/flags/*` | Country → Flag (pick) or Flag → Country (type), by region, with hints |
| Capitals | `/capitals/*` | Country → Capital or Capital → Country, typed with spelling help |
| Recall | `/recall/*` | Type every country or capital of a set from memory (English, German or French) |
| Explorer | `/explorer` | Searchable atlas of every country and territory |
| Settings | `/settings` | Gameplay preferences, theme, data export and account deletion |

Every game follows the same loop: **choose a set → play → feedback → results → saved progress**.
Unfinished rounds are saved and can be resumed from Home or the game's setup screen.

## Stack

- React 18 + TypeScript + React Router + Tailwind, built with Vite; installable as a PWA.
- Supabase: Postgres (all game logic in `SECURITY DEFINER` RPCs), Auth (anonymous guests + email accounts),
  one Edge Function (`delete-account`).
- Vercel hosts the static frontend only.

Key source files:

| File | Purpose |
|---|---|
| `src/api.ts` | The only place that talks to Supabase; every call has a demo branch |
| `src/setup-ui.tsx` | Shared setup and in-game building blocks used by every game |
| `src/prefs.ts` | Device-local game preferences (auto-continue, remembered setups, vibration …) |
| `src/Hub.tsx`, `src/App.tsx` | Home hub; layout, quiz screens, settings |
| `src/Flags.tsx`, `src/Capitals.tsx`, `src/Recall.tsx`, `src/Explorer.tsx` | The other games |
| `src/*-domain.ts` | Pure, unit-tested game logic |
| `src/*demo*.ts` | Device-local demo engines |
| `supabase/migrations/` | The schema and every RPC – the only source of truth for the database |

## Run locally

```
npm install
npm run dev
```

With both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` empty, the app runs as a **local demo**: a small set of
sample questions and countries, progress in `localStorage`, nothing uploaded.

To run against Supabase, put the project URL and anon key into `.env.local` (see `.env.example`) and restart Vite.
Never put a service-role key into a `VITE_` variable.

Local Supabase: `supabase start`, `supabase db reset`, then copy the local URL and anon key.

## Database changes

Every schema or RPC change is a new timestamped file in `supabase/migrations/`. Apply with `supabase db push`
(after `supabase link --project-ref …`). Never edit an applied migration and never change the hosted database by hand
in the dashboard – if that happens, capture it in a migration straight away.

## Questions and content

The country catalog (`private.countries`) powers Explorer, Flags, Capitals and Recall. Quiz questions are separate:

- Draft questions are imported through the admin JSON importer at `/admin` (dry-run first; 1–100 records,
  256 KiB per import). `scripts/generate_quiz_questions.py` creates drafts from the catalog; drafts live in
  `content/drafts/`.
- A question is playable only when `reviewStatus = reviewed`, `sourceVerified = true` and a real `lastReviewed`
  date are set – by a person who actually checked it. Never set these in bulk.
- Recall accepts German and French capital names from the curated table `private.recall_aliases`.

Admin access: set `"atlas_admin": true` in the user's `auth.users.raw_app_meta_data` (SQL editor). Profile fields
never grant admin rights.

## Scoring (Quiz)

Correct answers score Easy 100 · Medium 125 · Hard 150 · Expert 200, plus a streak bonus of
`min(50, 10 × (streak − 1))`. Completed non-practice games earn 20 XP + 10 XP per correct answer;
level = 1 + floor(XP / 500). Timed games last 60 seconds; Endless has three lives and unlocks a harder tier every
five correct answers. Scores are decided on the server; refreshing a result never awards XP twice.

Flags, Capitals and Recall keep personal bests per setup (higher score first, then faster).

## Tests

```
npm test                  # unit tests (set VITE_SUPABASE_URL/ANON_KEY, e.g. via .env.local, for the auth tests)
npm run test:e2e          # Playwright (run `npx playwright install chromium` once)
npm run test:integration  # backend tests – needs TEST_SUPABASE_* of a disposable project, never production
npm run build             # type-check + production build + service worker
```

## Deployment

1. `supabase db push` for new migrations.
2. Deploy `delete-account` with `APP_ORIGIN` set: `supabase functions deploy delete-account --no-verify-jwt`
   (the function verifies the bearer token itself – keep that check).
3. Push to `main`; Vercel builds and deploys the frontend with the two public `VITE_SUPABASE_*` variables.
4. If you use a custom Supabase domain, update `connect-src` in the CSP in `vercel.json`.

Before a public launch: configure Auth rate limits and bot protection for anonymous sign-up, enable leaked-password
protection, set up SMTP for confirmation emails, and add a privacy notice and operator contact.

## Privacy

- Players can download all their data (Settings → Download my data) and delete their account; deletion cascades to
  every game's records.
- No ads, tracking or analytics transmission. The optional diagnostic log stays on the device.
- Running this as a public service still needs a reviewed privacy notice, retention policy and legal review.
