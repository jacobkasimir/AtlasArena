# Atlas Arena

## Status

Source implementation supplied; execution, browser audits, Supabase deployment,
external content verification, and legal review have not been performed by its authoring assistant.
Do not describe this repository as production-ready.

## Architecture

- React/TypeScript + React Router + Tailwind on Vite.
- domain.ts: supported question schema, scoring, eligibility, and state rules.
- demo.ts: separate device-local public-sample game engine.
- api.ts: Supabase RPC integration, anonymous auth, email/password account upgrade.
- PostgreSQL functions: authoritative online game engine.
- Private relational content + immutable session snapshots.
- Public tables use RLS; no client write access to XP or profile privileges.
- Admin/explorer routes are lazy loaded.
- No MapLibre code is loaded because Map Challenge is entirely deferred.
- No WebSocket coordinator or multiplayer claims.

## Local demo

npm install
npm run dev

Leave BOTH VITE_SUPABASE_* variables empty. Demo progress is localStorage data,
is inspectable/alterable, is not competitive, and is never uploaded.
Demo supports 48 public Easy questions. Exact unsupported filters return an error.

## Supabase local setup

Install Docker and the Supabase CLI separately.
Run:

supabase start
supabase db reset
supabase status

Copy the local API URL and anon key to .env.local.
Never put a service-role key in a VITE_ variable.
Restart Vite after changing environment variables.

The seed inserts 160 DRAFT questions. Online play intentionally remains unavailable
until sufficient exact-category/tier content is reviewed and published.

Enable anonymous sign-in, email/password authentication, email confirmations,
and set a minimum password length of 12 in the deployed Auth configuration.
Use local Inbucket or configured SMTP to test email delivery.

## Account linking

"Create account from this guest" calls Supabase updateUser on the current anonymous user,
adding email/password while retaining the same auth.users ID.
Follow confirmation messages as required by the Auth project settings.

This is NOT an implementation of merging two existing accounts.
Signing into an existing account switches identities and warns that guest progress is not merged.
Local demo progress is never imported.
OAuth, manual identity linking, and recovery/confirmation delivery need deployment-specific testing.

## Admin provisioning

Create or upgrade a real account first. In the Supabase SQL editor, run:

update auth.users
set raw_app_meta_data =
  coalesce(raw_app_meta_data, '{}'::jsonb) || '{"atlas_admin": true}'::jsonb
where id = 'REPLACE_WITH_AUTH_USER_UUID';

The backend reads protected auth.users app metadata, not editable profile fields.
Remove the key or set it false to revoke access.
The check reads current database metadata, so authorization does not wait for JWT refresh.

Visit /admin. Use the JSON editor to edit or create a question version.
Dry-run validation must succeed before the UI permits commit.
Server validation always runs again at commit.

## Content review and import

Schema example is in the admin editor and content/production-drafts.json.

Limits:
- 256 KiB JSON payload.
- 1–100 records per import.
- mc: exactly four uniquely identified and labeled options.
- tf: true/True and false/False options.
- stableId is immutable across versions.
- expectedVersion is 0 for new content, otherwise the current version.
- "reject" refuses existing IDs; "version" appends a version using optimistic checks.
- All records validate before any content records are written.
- Import writes are transactional.
- Asset metadata, when present, must include source and license.
- Assets themselves and unsupported question types are not rendered.

Publication requires reviewStatus=reviewed, sourceVerified=true,
and an actual lastReviewed date not in the future.
Do not attest these values without reviewing the question and its cited sources.

When editing a seeded record, use the admin-listed expectedVersion rather than the
original authoring file's expectedVersion=0.

Publishing a new version unpublishes the previous live version.
Saving a draft leaves the previous published version playable.
Unpublish removes all live versions for a stable ID.
Past session snapshots are unaffected.

## Gameplay and scoring

States:
awaiting_answer -> showing_feedback -> awaiting_answer
awaiting_answer/showing_feedback -> completed
awaiting_answer/showing_feedback -> abandoned
completed and abandoned are terminal.

Classic: 10 MC questions, four options, exact selected tier.
Practice: 10 supported questions, or four in country-focused Explorer practice.
Timed: 60-second session, at most 200 snapshot questions.
Endless: three mistakes; at most 200 eligible snapshot questions.
Endless begins at the selected tier and unlocks one higher tier every five accepted
answers. It prefers the highest unlocked available tier. It never goes below the
starting tier and finishes if no unlocked unused question remains.

Incorrect answer: 0; resets streak.
Correct: Easy 100, Medium 125, Hard 150, Expert 200.
Streak bonus: min(50, 10 * max(0, new streak - 1)).
No MVP mode has a per-question deadline, so speed bonus is zero in every MVP mode.
Timed's session deadline is NOT treated as a per-question time limit.

XP: non-Practice completed session with at least one accepted answer:
20 completion XP + 10 per correct answer.
Practice XP: zero. Abandoned or unanswered runs: zero.
Level = 1 + floor(XP / 500).

Online completion locks the session and inserts an XP event with a unique session key.
Refreshing results cannot grant a second reward.
Mode best scores are separated; Practice is excluded from competitive bests.

Average response:
sum(server accepted_at - question_started_at) / accepted answer count.
It includes server-to-client delivery and user/network response latency.
Feedback time is excluded because the next start is set on advancement.

The browser countdown is only an estimate.
At or after the server deadline, submissions cannot be accepted.
Single-player expired sessions finalize on the next authenticated interaction.
There is no shared match that depends on a host browser.

## Security

- All authoritative actions use SECURITY DEFINER functions with empty search_path.
- Every session API verifies auth.uid() and locks the owned session row.
- Answer IDs are validated against current snapshot options.
- Duplicate answer rows are prevented by a composite primary key.
- Correct answers and explanations are private until the relevant accepted answer.
- No answer table is exposed in the public API schema or Realtime.
- Snapshotting preserves history through content changes.
- No service key enters the frontend.
- User text is constrained and rendered with React escaping.
- Profiles expose only their owner's records.
- No public emails, birth dates, or chat.

Database fixed-window quotas limit successful/high-frequency RPC activity.
Transactions roll back failed attempts, so these quotas are NOT an IP-level
abuse-prevention system. Before public launch, configure Supabase Auth rate limits,
CAPTCHA/bot protection for anonymous signup, and infrastructure-level request limits.
Review export resource limits for very large accounts.

## Account deletion

The delete-account Edge Function verifies the bearer token with Auth and deletes only
that identity. Foreign-key cascades remove profiles, sessions, submissions, XP, and stats.

Set APP_ORIGIN exactly, e.g. https://atlas.example.org.
SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are server-side Edge Function variables.
Deploy:

supabase secrets set APP_ORIGIN=https://atlas.example.org
supabase functions deploy delete-account --no-verify-jwt

Gateway JWT verification is disabled here because the function explicitly verifies
the bearer token through getUser. Do not remove that verification.

For local Edge Function serving, supply APP_ORIGIN=http://localhost:5173
through a backend-only environment file and use supabase functions serve.

## Privacy and retention

Technical default: account progress is retained until user deletion.
No automatic anonymous-account expiration or timed retention job is included.
Local progress remains until browser storage is cleared or demo data is deleted.

Data export returns the owner's records and accepted answer reviews, never unanswered
question solutions. Server export currently returns one JSON response; very large
accounts will need an asynchronous/paginated export implementation.

Optional analytics are an explicitly consented, device-only rolling log of 100 events:
return_visit, game_started (mode/category/difficulty), and game_completed
(mode/correct/incorrect/summed accepted response duration).
No analytics network transmission or identifiers are added.
This is not a complete production analytics pipeline or a session-wall-clock metric.

No ads, payments, or behavioral profiling.
Deployment needs an actual privacy notice, responsible operator/contact, processor
agreements, backup-retention review, age/consent assessment, and legal review.
Code alone does not establish GDPR compliance.

## PWA

npm run build
npm run preview

The postbuild script generates a versioned service worker that precaches only
build-time static files. API responses, cross-origin requests, and authorized requests
are not cached. Service workers are not registered by the development build.

On supported Android/desktop browsers use the browser install UI.
On iOS/iPadOS Safari use Share -> Add to Home Screen.
Install prompts, storage persistence, browser engines, and offline behavior vary.
Offline usage requires a previous successful static-cache installation.
Supabase-authenticated gameplay remains online-only.
An installed server-configured app does not silently switch to unverifiable local scores.

## Deployment

1. Create a Supabase project in the intended hosting region.
2. Review migration, then run supabase link --project-ref YOUR_REF and supabase db push.
3. Load supabase/seed.sql using an authorized SQL connection.
4. Configure Auth URLs for localhost and the final HTTPS origin.
5. Configure SMTP, confirmations, rate limits, and anonymous-signup bot protection.
6. Provision an admin and fact-check/publish sufficient content.
7. Deploy delete-account with APP_ORIGIN.
8. Deploy frontend on Vercel with the two public VITE_SUPABASE_* variables.
9. Update CSP connect-src for custom Supabase domains or nonstandard hosting.
10. Verify Auth emails, linking, RLS, RPCs, deletion, import, installability, and offline behavior.

Vercel hosts static frontend assets only.
It is not used as a persistent WebSocket server.
Commit the generated npm lockfile after installing and auditing dependencies.

## Tests

npm test
npx playwright install chromium
npm run test:e2e

For backend integration tests, use a disposable project with migrations applied.
Export TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY
in the shell; never send the service key to a browser.

npm run test:integration

Backend tests create auth users and question fixtures and remove users/unpublish
fixtures. Test fixtures are NOT real published educational content.
Do not run this suite against a production question bank.
Without test credentials, integration tests are explicitly skipped.

No tests were executed as part of this chat delivery.

Provided coverage is not the full requested acceptance matrix.
Still required: real email confirmation/linking integration tests, deletion tests,
database deadline/concurrency stress tests, full admin publishing browser flow,
real iOS/Safari and Android verification, assistive technology testing,
and performance/security audits.

The contrast unit test checks core opaque color pairs, not every composited,
disabled, or focused UI state. Browser contrast auditing is still required.

## Roadmap

First stabilize and verify this single-player implementation.
Then add:
- independently reviewed, larger question pools;
- production analytics/export/retention controls;
- reviewed licensed geographic boundaries and lazy-loaded MapLibre;
- separately deployed authoritative multiplayer coordinator/scheduler when needed;
- authenticated room membership and versioned Realtime state delivery.

Supabase Realtime would distribute approved state, never determine scores,
deadlines, round completion, or room authorization.
