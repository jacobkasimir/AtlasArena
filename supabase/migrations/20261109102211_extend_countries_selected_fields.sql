begin;

-- Bestehende Tabelle erhalten: questions.country_code verweist
-- auf private.countries(code).
alter table private.countries

  -- NAMES / CAPITALS
  -- names.common liegt bereits in: name
  add column if not exists name_official text,
  add column if not exists name_alternates text[],
  add column if not exists name_native jsonb,
  add column if not exists name_translations jsonb,
  add column if not exists capitals jsonb,
  add column if not exists demonyms jsonb,

  -- CODES
  -- codes.alpha_2 liegt bereits in: code
  add column if not exists code_alpha3 text,

  -- FLAG
  -- flag.description liegt bereits in: flag
  add column if not exists flag_emoji text,
  add column if not exists flag_png_url text,
  add column if not exists flag_svg_url text,

  -- GEOGRAPHY & PEOPLE
  -- region liegt bereits in: region
  add column if not exists subregion text,
  add column if not exists continents text[],
  add column if not exists landlocked boolean,
  add column if not exists borders text[],
  add column if not exists area_km2 numeric,
  add column if not exists area_miles numeric,
  add column if not exists coordinates_lat numeric,
  add column if not exists coordinates_lng numeric,
  add column if not exists timezones text[],
  add column if not exists population bigint,
  add column if not exists gini_coefficient jsonb,
  add column if not exists languages jsonb,

  -- CURRENCIES & COMMUNICATION
  -- Ein einfacher Anzeigewert liegt bereits in: currency.
  -- Die vollständige API-Struktur wird zusätzlich gespeichert.
  add column if not exists currencies jsonb,
  add column if not exists calling_codes text[],
  add column if not exists tlds text[],

  -- CARS / POSTAL CODES
  add column if not exists cars_driving_side text,
  add column if not exists cars_signs text[],
  add column if not exists postal_code_format text,
  add column if not exists postal_code_regex text,

  -- MEMBERSHIPS
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

  -- GOVERNMENT & LINKS
  -- source bleibt als Herkunft des Datensatzes bestehen.
  add column if not exists government_type text,
  add column if not exists link_official text,
  add column if not exists link_wikipedia text,
  add column if not exists link_google_maps text;

-- Manche API-Einträge haben keine Hauptstadt, Währung oder
-- textuelle Flaggenbeschreibung. Diese Werte nicht erfinden.
alter table private.countries
  alter column capital drop not null,
  alter column currency drop not null,
  alter column flag drop not null;

-- Die Tabelle bleibt privat; es werden keine Client-Rechte vergeben.
alter table private.countries enable row level security;
revoke all on private.countries from public, anon, authenticated;

commit;