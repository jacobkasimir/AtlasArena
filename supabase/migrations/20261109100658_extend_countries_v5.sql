begin;

alter table private.countries
  -- Namen und ISO-Codes
  add column if not exists name_official text,
  add column if not exists code_alpha3 text,
  add column if not exists code_ccn3 text,
  add column if not exists code_fifa text,
  add column if not exists code_cioc text,

  -- Komplexe Felder bleiben in ihrer vollständigen API-Struktur erhalten
  add column if not exists capitals jsonb,
  add column if not exists currencies jsonb,
  add column if not exists languages jsonb,
  add column if not exists memberships jsonb,

  -- Flaggen: getrennt von der bestehenden Textbeschreibung „flag“
  add column if not exists flag_emoji text,
  add column if not exists flag_svg_url text,
  add column if not exists flag_png_url text,

  -- Geografie und Demografie
  add column if not exists api_region text,
  add column if not exists subregion text,
  add column if not exists area_km2 numeric,
  add column if not exists area_miles numeric,
  add column if not exists borders text[],
  add column if not exists calling_codes text[],
  add column if not exists population bigint,
  add column if not exists timezones text[],
  add column if not exists tlds text[],

  -- Enthält ALLE Felder des jeweiligen Originaldatensatzes,
  -- auch solche, die oben noch keine eigene Spalte haben.
  add column if not exists raw_data jsonb,
  add column if not exists api_imported_at timestamptz;

-- API-Einträge ohne Hauptstadt, Währung oder Flaggenbeschreibung
-- dürfen nicht durch erfundene Werte ergänzt werden müssen.
alter table private.countries
  alter column capital drop not null,
  alter column currency drop not null,
  alter column flag drop not null;

-- Die bestehende Tabelle ist privat. Keine zusätzlichen Client-Rechte.
alter table private.countries enable row level security;
revoke all on private.countries from public, anon, authenticated;

commit;