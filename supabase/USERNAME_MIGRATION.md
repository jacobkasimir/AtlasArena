# Username migration

Apply `20261107000000_unique_usernames.sql` through the normal Supabase migration
workflow. Do not reset the database. The migration trims names, renames every
case-insensitive duplicate after the first to a deterministic temporary player
label, and then adds the unique case-insensitive index. Profile IDs and all
related game records remain untouched. Affected players can choose a permanent
name in the app's onboarding/profile flow.

All new identities receive a temporary `Player-<id>` name in
`private.require_user`; the browser requires a name before private game routes
render. `public.arena_profile` remains the only profile write path and its
existing rate limit and RLS protections remain active. The unique index is the
final authority for concurrent claims.
