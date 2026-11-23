select country.code, jsonb_build_object(
    'name', country.name,
    'un', coalesce(country.membership_un, false),
    'region', country.region,
    'subregion', coalesce(country.subregion, ''),
    'pop', coalesce(country.population, 0),
    'area', coalesce(country.area_km2, 0),
    'density', case when coalesce(country.area_km2, 0) > 0 then round(country.population / country.area_km2, 1) else 0 end,
    'landlocked', coalesce(country.landlocked, false),
    'neighbours', coalesce(cardinality(country.borders), 0),
    'borders', to_jsonb(coalesce(country.borders, '{}')),
    'island', coalesce(cardinality(country.borders), 0) = 0 and not coalesce(country.landlocked, false),
    'first', left(letters.l, 1),
    'last', right(letters.l, 1),
    'len', length(letters.l),
    'words', array_length(regexp_split_to_array(trim(country.name), '\s+'), 1),
    'drive', country.cars_driving_side,
    'langs', coalesce((select jsonb_agg(lang ->> 'name') from jsonb_array_elements(case when jsonb_typeof(country.languages) = 'array' then country.languages else '[]' end) as lang), '[]'),
    'currencies', coalesce((select jsonb_agg(cur ->> 'code') from jsonb_array_elements(case when jsonb_typeof(country.currencies) = 'array' then country.currencies else '[]' end) as cur), '[]'),
    'tz', coalesce(cardinality(country.timezones), 0),
    'lat', coalesce((country.capitals -> 0 -> 'coordinates' ->> 'lat')::numeric, country.coordinates_lat),
    'lng', coalesce((country.capitals -> 0 -> 'coordinates' ->> 'lng')::numeric, country.coordinates_lng),
    'eu', coalesce(country.membership_eu, false), 'nato', coalesce(country.membership_nato, false),
    'commonwealth', coalesce(country.membership_commonwealth, false), 'g20', coalesce(country.membership_g20, false),
    'opec', coalesce(country.membership_opec, false), 'au', coalesce(country.membership_african_union, false),
    'asean', coalesce(country.membership_asean, false), 'arab', coalesce(country.membership_arab_league, false),
    'schengen', coalesce(country.membership_schengen, false), 'eurozone', coalesce(country.membership_eurozone, false),
    'oecd', coalesce(country.membership_oecd, false),
    'monarchy', coalesce(country.government_type ilike '%monarchy%', false),
    'capfirst', left(capletters.l, 1)
  ) as facts
from private.countries as country
cross join lateral (select regexp_replace(translate(lower(country.name), 'áàâäãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'), '[^a-z]', '', 'g') as l) as letters
cross join lateral (select regexp_replace(translate(lower(coalesce(country.capital, '')), 'áàâäãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'), '[^a-z]', '', 'g') as l) as capletters
where country.catalog_kind = 'iso_alpha2'
