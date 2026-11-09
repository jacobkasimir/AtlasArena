begin;

alter table private.countries
  -- Names
  add column if not exists name_alternates text[],
  add column if not exists name_native jsonb,
  add column if not exists name_translations jsonb,
  add column if not exists demonyms jsonb,

  -- Geography
  add column if not exists continents text[],
  add column if not exists landlocked boolean,
  add column if not exists coordinates_lat numeric,
  add column if not exists coordinates_lng numeric,
  add column if not exists gini_coefficient jsonb,

  -- Cars and postal codes
  add column if not exists cars_driving_side text,
  add column if not exists cars_signs text[],
  add column if not exists postal_code_format text,
  add column if not exists postal_code_regex text,

  -- Selected memberships; existing memberships jsonb stays
  -- temporarily as a source for migration/backfill.
  add column if not exists membership_un boolean,
  add column if not exists membership_eu boolean,
  add column if not exists membership_eurozone boolean,
  add column if not exists membership_schengen boolean,
  add column if not exists membership_nato boolean,
  add column if not exists membership_commonwealth boolean,
  add column if not exists membership_oecd boolean,
  add column if not exists membership_g7 boolean,
  add column if not exists membership_g20 boolean,
  add column if not exists membership_brics boolean,
  add column if not exists membership_opec boolean,
  add column if not exists membership_african_union boolean,
  add column if not exists membership_asean boolean,
  add column if not exists membership_arab_league boolean,

  -- Government and selected links
  add column if not exists government_type text,
  add column if not exists link_official text,
  add column if not exists link_wikipedia text,
  add column if not exists link_google_maps text;

-- Do not expose the private catalog directly to browser roles.
alter table private.countries enable row level security;
revoke all on private.countries from public, anon, authenticated;

commit;