begin;
-- Category Elimination (after JetPunk's "Category Elimination"): four colour groups of clue chains.
-- Each named place must match every clue revealed so far in a group; the last clue leaves exactly one place.
-- 24 puzzles (8 easy, 8 medium, 8 hard), generated from a fixed snapshot of the atlas facts and verified below.

create table private.elimination_places (
  code text primary key,
  name text not null,
  un boolean not null,
  playable boolean not null,
  aliases text[] not null,
  facts jsonb not null
);
alter table private.elimination_places enable row level security;

-- Facts snapshot. Memberships only count for UN member states; a place is playable when it has people and a capital.
insert into private.elimination_places (code, name, un, playable, aliases, facts)
select base.code, base.facts ->> 'name', (base.facts ->> 'un')::boolean,
  (base.facts ->> 'pop')::numeric > 0 and base.facts ->> 'capfirst' <> '',
  coalesce((select array_agg(distinct private.recall_normalize(alias.value ->> 'name'))
    from private.recall_catalog() as catalog cross join jsonb_array_elements(catalog.country_names) as alias(value)
    where catalog.code = base.code and private.recall_normalize(alias.value ->> 'name') <> ''), '{}')
    || array[private.recall_normalize(base.facts ->> 'name')],
  base.facts
    || jsonb_build_object('capsame', base.facts ->> 'first' <> '' and base.facts ->> 'first' = base.facts ->> 'capfirst')
    || (select jsonb_object_agg(key, (base.facts ->> key)::boolean and (base.facts ->> 'un')::boolean)
        from unnest(array['eu','nato','commonwealth','g20','au','arab','asean','opec','oecd','schengen','eurozone']) as key)
from (
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

) as base;

create or replace function private.elim_test(p_facts jsonb, p_clue jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_clue ->> 'op'
    when 'eq' then p_facts ->> (p_clue ->> 'f') = p_clue ->> 'v'
    when 'in' then (p_clue -> 'v') ? (p_facts ->> (p_clue ->> 'f'))
    when 'nin' then not ((p_clue -> 'v') ? (p_facts ->> (p_clue ->> 'f')))
    when 'lt' then (p_facts ->> (p_clue ->> 'f'))::numeric < (p_clue ->> 'v')::numeric
    when 'gt' then (p_facts ->> (p_clue ->> 'f'))::numeric > (p_clue ->> 'v')::numeric
    when 'has' then coalesce((p_facts -> (p_clue ->> 'f')) ? (p_clue ->> 'v'), false)
    when 'true' then coalesce((p_facts ->> (p_clue ->> 'f'))::boolean, false)
    when 'false' then not coalesce((p_facts ->> (p_clue ->> 'f'))::boolean, true)
    else false end;
$$;

-- True when the place matches the first p_steps clues of a chain.
create or replace function private.elim_matches(p_facts jsonb, p_clues jsonb, p_steps integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(private.elim_test(p_facts, clue.value)), true)
  from jsonb_array_elements(p_clues) with ordinality as clue(value, position)
  where clue.position <= p_steps;
$$;

create table private.elimination_puzzles (
  id text primary key,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  number integer not null,
  pool text not null check (pool in ('un', 'all')),
  time_limit_seconds integer not null,
  groups jsonb not null,
  unique (difficulty, number)
);
alter table private.elimination_puzzles enable row level security;

insert into private.elimination_puzzles (id, difficulty, number, pool, time_limit_seconds, groups) values
  ('easy-1', 'easy', 1, 'un', 300, '[{"colour":"green","answer":"IQ","clues":[{"f":"area","op":"gt","v":300000,"label":"Larger than 300,000 km²","n":72},{"f":"region","op":"eq","v":"Asia","label":"In Asia","n":21},{"f":"first","op":"eq","v":"i","label":"Name starts with I","n":4},{"f":"pop","op":"lt","v":50000000,"label":"Fewer than 50 million people","n":1}]},{"colour":"orange","answer":"EC","clues":[{"f":"pop","op":"gt","v":10000000,"label":"More than 10 million people","n":94},{"f":"region","op":"eq","v":"South America","label":"In South America","n":8},{"f":"lat","op":"lt","v":0,"label":"Capital south of the equator","n":6},{"f":"area","op":"lt","v":500000,"label":"Smaller than 500,000 km²","n":1}]},{"colour":"blue","answer":"DE","clues":[{"f":"pop","op":"gt","v":5000000,"label":"More than 5 million people","n":122},{"f":"region","op":"eq","v":"Europe","label":"In Europe","n":26},{"f":"first","op":"eq","v":"g","label":"Name starts with G","n":2},{"f":"neighbours","op":"gt","v":4,"label":"More than 4 land neighbours","n":1}]},{"colour":"purple","answer":"MW","clues":[{"f":"area","op":"gt","v":50000,"label":"Larger than 50,000 km²","n":126},{"f":"pop","op":"gt","v":10000000,"label":"More than 10 million people","n":87},{"f":"last","op":"eq","v":"i","label":"Name ends with I","n":2},{"f":"lat","op":"lt","v":0,"label":"Capital south of the equator","n":1}]}]'::jsonb),
  ('easy-2', 'easy', 2, 'un', 300, '[{"colour":"green","answer":"LT","clues":[{"f":"area","op":"lt","v":100000,"label":"Smaller than 100,000 km²","n":86},{"f":"pop","op":"gt","v":1000000,"label":"More than 1 million people","n":51},{"f":"first","op":"eq","v":"l","label":"Name starts with L","n":4},{"f":"len","op":"gt","v":8,"label":"Name has 9 letters or more","n":1}]},{"colour":"orange","answer":"JO","clues":[{"f":"pop","op":"gt","v":10000000,"label":"More than 10 million people","n":94},{"f":"area","op":"lt","v":1000000,"label":"Smaller than 1 million km²","n":68},{"f":"first","op":"eq","v":"j","label":"Name starts with J","n":2},{"f":"island","op":"false","v":null,"label":"Has at least one land border","n":1}]},{"colour":"blue","answer":"RW","clues":[{"f":"area","op":"lt","v":50000,"label":"Smaller than 50,000 km²","n":67},{"f":"island","op":"false","v":null,"label":"Has at least one land border","n":36},{"f":"lat","op":"lt","v":0,"label":"Capital south of the equator","n":5},{"f":"last","op":"eq","v":"a","label":"Name ends with A","n":1}]},{"colour":"purple","answer":"HN","clues":[{"f":"area","op":"gt","v":50000,"label":"Larger than 50,000 km²","n":126},{"f":"region","op":"eq","v":"North America","label":"In North America","n":9},{"f":"pop","op":"lt","v":20000000,"label":"Fewer than 20 million people","n":6},{"f":"first","op":"eq","v":"h","label":"Name starts with H","n":1}]}]'::jsonb),
  ('easy-3', 'easy', 3, 'un', 300, '[{"colour":"green","answer":"TJ","clues":[{"f":"pop","op":"gt","v":10000000,"label":"More than 10 million people","n":94},{"f":"lng","op":"gt","v":0,"label":"Capital east of Greenwich (0°)","n":69},{"f":"first","op":"eq","v":"t","label":"Name starts with T","n":5},{"f":"landlocked","op":"true","v":null,"label":"Landlocked","n":1}]},{"colour":"orange","answer":"DK","clues":[{"f":"pop","op":"lt","v":20000000,"label":"Fewer than 20 million people","n":127},{"f":"island","op":"false","v":null,"label":"Has at least one land border","n":93},{"f":"first","op":"eq","v":"d","label":"Name starts with D","n":3},{"f":"region","op":"eq","v":"Europe","label":"In Europe","n":1}]},{"colour":"blue","answer":"CI","clues":[{"f":"region","op":"eq","v":"Africa","label":"In Africa","n":54},{"f":"pop","op":"gt","v":5000000,"label":"More than 5 million people","n":38},{"f":"words","op":"gt","v":1,"label":"Name has more than one word","n":6},{"f":"first","op":"in","v":["a","e","i","o","u"],"label":"Name starts with a vowel","n":1}]},{"colour":"purple","answer":"GT","clues":[{"f":"area","op":"gt","v":50000,"label":"Larger than 50,000 km²","n":126},{"f":"pop","op":"gt","v":10000000,"label":"More than 10 million people","n":87},{"f":"first","op":"eq","v":"g","label":"Name starts with G","n":5},{"f":"len","op":"gt","v":8,"label":"Name has 9 letters or more","n":1}]}]'::jsonb),
  ('easy-4', 'easy', 4, 'un', 300, '[{"colour":"green","answer":"CN","clues":[{"f":"area","op":"gt","v":1000000,"label":"Larger than 1 million km²","n":29},{"f":"region","op":"eq","v":"Asia","label":"In Asia","n":7},{"f":"last","op":"eq","v":"a","label":"Name ends with A","n":5},{"f":"first","op":"eq","v":"c","label":"Name starts with C","n":1}]},{"colour":"orange","answer":"BY","clues":[{"f":"region","op":"eq","v":"Europe","label":"In Europe","n":44},{"f":"area","op":"gt","v":50000,"label":"Larger than 50,000 km²","n":26},{"f":"first","op":"eq","v":"b","label":"Name starts with B","n":3},{"f":"last","op":"eq","v":"s","label":"Name ends with S","n":1}]},{"colour":"blue","answer":"GH","clues":[{"f":"pop","op":"gt","v":20000000,"label":"More than 20 million people","n":66},{"f":"area","op":"lt","v":500000,"label":"Smaller than 500,000 km²","n":23},{"f":"first","op":"eq","v":"g","label":"Name starts with G","n":2},{"f":"last","op":"eq","v":"a","label":"Name ends with A","n":1}]},{"colour":"purple","answer":"BO","clues":[{"f":"pop","op":"gt","v":10000000,"label":"More than 10 million people","n":94},{"f":"landlocked","op":"true","v":null,"label":"Landlocked","n":20},{"f":"first","op":"eq","v":"b","label":"Name starts with B","n":3},{"f":"region","op":"eq","v":"South America","label":"In South America","n":1}]}]'::jsonb),
  ('easy-5', 'easy', 5, 'un', 300, '[{"colour":"green","answer":"SY","clues":[{"f":"area","op":"gt","v":100000,"label":"Larger than 100,000 km²","n":107},{"f":"region","op":"eq","v":"Asia","label":"In Asia","n":30},{"f":"first","op":"eq","v":"s","label":"Name starts with S","n":3},{"f":"len","op":"lt","v":6,"label":"Name has 5 letters or fewer","n":1}]},{"colour":"orange","answer":"SL","clues":[{"f":"pop","op":"lt","v":10000000,"label":"Fewer than 10 million people","n":99},{"f":"island","op":"false","v":null,"label":"Has at least one land border","n":65},{"f":"last","op":"eq","v":"e","label":"Name ends with E","n":4},{"f":"words","op":"gt","v":1,"label":"Name has more than one word","n":1}]},{"colour":"blue","answer":"HU","clues":[{"f":"area","op":"lt","v":300000,"label":"Smaller than 300,000 km²","n":121},{"f":"pop","op":"gt","v":5000000,"label":"More than 5 million people","n":54},{"f":"first","op":"eq","v":"h","label":"Name starts with H","n":3},{"f":"neighbours","op":"gt","v":4,"label":"More than 4 land neighbours","n":1}]},{"colour":"purple","answer":"BR","clues":[{"f":"region","op":"in","v":["North America","South America"],"label":"In the Americas","n":35},{"f":"area","op":"gt","v":50000,"label":"Larger than 50,000 km²","n":21},{"f":"neighbours","op":"gt","v":4,"label":"More than 4 land neighbours","n":5},{"f":"last","op":"eq","v":"l","label":"Name ends with L","n":1}]}]'::jsonb),
  ('easy-6', 'easy', 6, 'un', 300, '[{"colour":"green","answer":"NP","clues":[{"f":"pop","op":"gt","v":10000000,"label":"More than 10 million people","n":94},{"f":"area","op":"lt","v":1000000,"label":"Smaller than 1 million km²","n":68},{"f":"last","op":"eq","v":"l","label":"Name ends with L","n":4},{"f":"len","op":"lt","v":6,"label":"Name has 5 letters or fewer","n":1}]},{"colour":"orange","answer":"GN","clues":[{"f":"lat","op":"gt","v":0,"label":"Capital north of the equator","n":153},{"f":"neighbours","op":"gt","v":4,"label":"More than 4 land neighbours","n":49},{"f":"first","op":"eq","v":"g","label":"Name starts with G","n":2},{"f":"area","op":"lt","v":300000,"label":"Smaller than 300,000 km²","n":1}]},{"colour":"blue","answer":"ES","clues":[{"f":"lat","op":"gt","v":0,"label":"Capital north of the equator","n":153},{"f":"region","op":"eq","v":"Europe","label":"In Europe","n":44},{"f":"len","op":"lt","v":6,"label":"Name has 5 letters or fewer","n":3},{"f":"area","op":"gt","v":500000,"label":"Larger than 500,000 km²","n":1}]},{"colour":"purple","answer":"CA","clues":[{"f":"neighbours","op":"lt","v":3,"label":"Fewer than 3 land neighbours","n":82},{"f":"pop","op":"gt","v":1000000,"label":"More than 1 million people","n":48},{"f":"area","op":"gt","v":1000000,"label":"Larger than 1 million km²","n":4},{"f":"first","op":"eq","v":"c","label":"Name starts with C","n":1}]}]'::jsonb),
  ('easy-7', 'easy', 7, 'un', 300, '[{"colour":"green","answer":"KP","clues":[{"f":"pop","op":"gt","v":20000000,"label":"More than 20 million people","n":66},{"f":"area","op":"lt","v":1000000,"label":"Smaller than 1 million km²","n":41},{"f":"words","op":"gt","v":1,"label":"Name has more than one word","n":6},{"f":"first","op":"eq","v":"n","label":"Name starts with N","n":1}]},{"colour":"orange","answer":"SO","clues":[{"f":"lat","op":"gt","v":0,"label":"Capital north of the equator","n":153},{"f":"region","op":"eq","v":"Africa","label":"In Africa","n":34},{"f":"first","op":"eq","v":"s","label":"Name starts with S","n":6},{"f":"last","op":"eq","v":"a","label":"Name ends with A","n":1}]},{"colour":"blue","answer":"RO","clues":[{"f":"lat","op":"gt","v":0,"label":"Capital north of the equator","n":153},{"f":"region","op":"in","v":["Europe","Asia"],"label":"In Europe or Asia","n":88},{"f":"first","op":"eq","v":"r","label":"Name starts with R","n":2},{"f":"area","op":"lt","v":500000,"label":"Smaller than 500,000 km²","n":1}]},{"colour":"purple","answer":"HT","clues":[{"f":"lng","op":"lt","v":0,"label":"Capital west of Greenwich (0°)","n":55},{"f":"island","op":"false","v":null,"label":"Has at least one land border","n":40},{"f":"first","op":"eq","v":"h","label":"Name starts with H","n":2},{"f":"len","op":"lt","v":6,"label":"Name has 5 letters or fewer","n":1}]}]'::jsonb),
  ('easy-8', 'easy', 8, 'un', 300, '[{"colour":"green","answer":"TD","clues":[{"f":"neighbours","op":"gt","v":4,"label":"More than 4 land neighbours","n":60},{"f":"landlocked","op":"true","v":null,"label":"Landlocked","n":22},{"f":"last","op":"eq","v":"d","label":"Name ends with D","n":2},{"f":"region","op":"eq","v":"Africa","label":"In Africa","n":1}]},{"colour":"orange","answer":"RU","clues":[{"f":"region","op":"eq","v":"Europe","label":"In Europe","n":44},{"f":"area","op":"gt","v":500000,"label":"Larger than 500,000 km²","n":4},{"f":"first","op":"nin","v":["a","e","i","o","u"],"label":"Name starts with a consonant","n":3},{"f":"last","op":"eq","v":"a","label":"Name ends with A","n":1}]},{"colour":"blue","answer":"MY","clues":[{"f":"region","op":"eq","v":"Asia","label":"In Asia","n":46},{"f":"area","op":"lt","v":500000,"label":"Smaller than 500,000 km²","n":33},{"f":"first","op":"eq","v":"m","label":"Name starts with M","n":2},{"f":"island","op":"false","v":null,"label":"Has at least one land border","n":1}]},{"colour":"purple","answer":"DO","clues":[{"f":"pop","op":"lt","v":20000000,"label":"Fewer than 20 million people","n":127},{"f":"area","op":"lt","v":100000,"label":"Smaller than 100,000 km²","n":85},{"f":"first","op":"eq","v":"d","label":"Name starts with D","n":4},{"f":"len","op":"gt","v":8,"label":"Name has 9 letters or more","n":1}]}]'::jsonb),
  ('medium-1', 'medium', 1, 'un', 300, '[{"colour":"green","answer":"KE","clues":[{"f":"pop","op":"gt","v":4993923,"label":"More people than New Zealand","n":122},{"f":"area","op":"gt","v":242900.0,"label":"Larger than the United Kingdom","n":71},{"f":"borders","op":"has","v":"TZA","label":"Borders Tanzania","n":4},{"f":"langs","op":"has","v":"English","label":"English is an official language","n":2},{"f":"len","op":"lt","v":6,"label":"Name has 5 letters or fewer","n":1}]},{"colour":"orange","answer":"RS","clues":[{"f":"region","op":"in","v":["Europe","Asia"],"label":"In Europe or Asia","n":90},{"f":"pop","op":"lt","v":20000000,"label":"Fewer than 20 million people","n":58},{"f":"eu","op":"false","v":null,"label":"Not a member of the EU","n":36},{"f":"first","op":"eq","v":"s","label":"Name starts with S","n":4},{"f":"area","op":"gt","v":50000,"label":"Larger than 50,000 km²","n":1}]},{"colour":"blue","answer":"BD","clues":[{"f":"pop","op":"gt","v":5525600,"label":"More people than Ireland","n":116},{"f":"landlocked","op":"false","v":null,"label":"Has a coastline","n":87},{"f":"region","op":"in","v":["Europe","Asia"],"label":"In Europe or Asia","n":44},{"f":"first","op":"eq","v":"b","label":"Name starts with B","n":3},{"f":"borders","op":"has","v":"IND","label":"Borders India","n":1}]},{"colour":"purple","answer":"HN","clues":[{"f":"pop","op":"lt","v":37232000,"label":"Fewer people than Poland","n":152},{"f":"area","op":"gt","v":100000,"label":"Larger than 100,000 km²","n":66},{"f":"lng","op":"lt","v":0,"label":"Capital west of Greenwich (0°)","n":22},{"f":"region","op":"eq","v":"North America","label":"In North America","n":4},{"f":"first","op":"eq","v":"h","label":"Name starts with H","n":1}]}]'::jsonb),
  ('medium-2', 'medium', 2, 'un', 300, '[{"colour":"green","answer":"NA","clues":[{"f":"area","op":"gt","v":100000,"label":"Larger than 100,000 km²","n":107},{"f":"langs","op":"has","v":"English","label":"English is an official language","n":27},{"f":"pop","op":"lt","v":66912637,"label":"Fewer people than the United Kingdom","n":20},{"f":"first","op":"eq","v":"n","label":"Name starts with N","n":2},{"f":"region","op":"eq","v":"Africa","label":"In Africa","n":1}]},{"colour":"orange","answer":"PT","clues":[{"f":"area","op":"lt","v":500000,"label":"Smaller than 500,000 km²","n":142},{"f":"oecd","op":"true","v":null,"label":"Member of the OECD","n":29},{"f":"pop","op":"gt","v":9154896,"label":"More people than Switzerland","n":15},{"f":"neighbours","op":"eq","v":1,"label":"Exactly one land neighbour","n":3},{"f":"langs","op":"has","v":"Portuguese","label":"Portuguese is an official language","n":1}]},{"colour":"blue","answer":"BH","clues":[{"f":"neighbours","op":"lt","v":3,"label":"Fewer than 3 land neighbours","n":82},{"f":"pop","op":"gt","v":1000000,"label":"More than 1 million people","n":48},{"f":"langs","op":"has","v":"Arabic","label":"Arabic is an official language","n":7},{"f":"area","op":"lt","v":70273.0,"label":"Smaller than Ireland","n":4},{"f":"island","op":"true","v":null,"label":"No land borders","n":1}]},{"colour":"purple","answer":"TT","clues":[{"f":"pop","op":"lt","v":5525600,"label":"Fewer people than Ireland","n":76},{"f":"area","op":"lt","v":50000,"label":"Smaller than 50,000 km²","n":55},{"f":"island","op":"true","v":null,"label":"No land borders","n":30},{"f":"last","op":"eq","v":"o","label":"Name ends with O","n":2},{"f":"lat","op":"gt","v":0,"label":"Capital north of the equator","n":1}]}]'::jsonb),
  ('medium-3', 'medium', 3, 'un', 300, '[{"colour":"green","answer":"SO","clues":[{"f":"pop","op":"gt","v":5000000,"label":"More than 5 million people","n":122},{"f":"area","op":"gt","v":300000,"label":"Larger than 300,000 km²","n":68},{"f":"arab","op":"true","v":null,"label":"Member of the Arab League","n":10},{"f":"opec","op":"false","v":null,"label":"Not a member of OPEC","n":6},{"f":"last","op":"eq","v":"a","label":"Name ends with A","n":1}]},{"colour":"orange","answer":"GR","clues":[{"f":"area","op":"gt","v":70273.0,"label":"Larger than Ireland","n":117},{"f":"pop","op":"lt","v":50000000,"label":"Fewer than 50 million people","n":87},{"f":"eu","op":"true","v":null,"label":"Member of the EU","n":11},{"f":"borders","op":"has","v":"TUR","label":"Borders Türkiye","n":2},{"f":"last","op":"eq","v":"e","label":"Name ends with E","n":1}]},{"colour":"blue","answer":"PH","clues":[{"f":"area","op":"lt","v":500000,"label":"Smaller than 500,000 km²","n":142},{"f":"pop","op":"gt","v":37232000,"label":"More people than Poland","n":12},{"f":"g20","op":"false","v":null,"label":"Not a member of the G20","n":7},{"f":"landlocked","op":"false","v":null,"label":"Has a coastline","n":5},{"f":"first","op":"eq","v":"p","label":"Name starts with P","n":1}]},{"colour":"purple","answer":"NI","clues":[{"f":"pop","op":"lt","v":11424031,"label":"Fewer people than Portugal","n":108},{"f":"area","op":"gt","v":41284.0,"label":"Larger than Switzerland","n":50},{"f":"neighbours","op":"lt","v":3,"label":"Fewer than 3 land neighbours","n":14},{"f":"last","op":"eq","v":"a","label":"Name ends with A","n":6},{"f":"first","op":"eq","v":"n","label":"Name starts with N","n":1}]}]'::jsonb),
  ('medium-4', 'medium', 4, 'un', 300, '[{"colour":"green","answer":"CY","clues":[{"f":"pop","op":"lt","v":20000000,"label":"Fewer than 20 million people","n":127},{"f":"lng","op":"gt","v":0,"label":"Capital east of Greenwich (0°)","n":88},{"f":"au","op":"false","v":null,"label":"Not a member of the African Union","n":66},{"f":"first","op":"eq","v":"c","label":"Name starts with C","n":4},{"f":"island","op":"true","v":null,"label":"No land borders","n":1}]},{"colour":"orange","answer":"TN","clues":[{"f":"au","op":"true","v":null,"label":"Member of the African Union","n":54},{"f":"commonwealth","op":"false","v":null,"label":"Not a member of the Commonwealth","n":33},{"f":"area","op":"lt","v":500000,"label":"Smaller than 500,000 km²","n":18},{"f":"neighbours","op":"lt","v":3,"label":"Fewer than 3 land neighbours","n":6},{"f":"pop","op":"gt","v":11424031,"label":"More people than Portugal","n":1}]},{"colour":"blue","answer":"MY","clues":[{"f":"langs","op":"has","v":"English","label":"English is an official language","n":59},{"f":"area","op":"gt","v":92090.0,"label":"Larger than Portugal","n":27},{"f":"region","op":"eq","v":"Asia","label":"In Asia","n":4},{"f":"pop","op":"lt","v":122650000,"label":"Fewer people than Japan","n":2},{"f":"last","op":"eq","v":"a","label":"Name ends with A","n":1}]},{"colour":"purple","answer":"GY","clues":[{"f":"pop","op":"lt","v":9154896,"label":"Fewer people than Switzerland","n":95},{"f":"area","op":"gt","v":10000,"label":"Larger than 10,000 km²","n":63},{"f":"landlocked","op":"false","v":null,"label":"Has a coastline","n":47},{"f":"region","op":"eq","v":"South America","label":"In South America","n":3},{"f":"commonwealth","op":"true","v":null,"label":"Member of the Commonwealth","n":1}]}]'::jsonb),
  ('medium-5', 'medium', 5, 'un', 300, '[{"colour":"green","answer":"SE","clues":[{"f":"pop","op":"gt","v":5000000,"label":"More than 5 million people","n":122},{"f":"area","op":"gt","v":312679.0,"label":"Larger than Poland","n":65},{"f":"au","op":"false","v":null,"label":"Not a member of the African Union","n":40},{"f":"eu","op":"true","v":null,"label":"Member of the EU","n":5},{"f":"neighbours","op":"lt","v":3,"label":"Fewer than 3 land neighbours","n":1}]},{"colour":"orange","answer":"MV","clues":[{"f":"area","op":"lt","v":50000,"label":"Smaller than 50,000 km²","n":67},{"f":"monarchy","op":"false","v":null,"label":"Not a monarchy","n":43},{"f":"neighbours","op":"lt","v":3,"label":"Fewer than 3 land neighbours","n":32},{"f":"first","op":"eq","v":"m","label":"Name starts with M","n":6},{"f":"region","op":"eq","v":"Asia","label":"In Asia","n":1}]},{"colour":"blue","answer":"ZW","clues":[{"f":"pop","op":"lt","v":20000000,"label":"Fewer than 20 million people","n":127},{"f":"area","op":"gt","v":10000,"label":"Larger than 10,000 km²","n":95},{"f":"lat","op":"lt","v":0,"label":"Capital south of the equator","n":18},{"f":"borders","op":"has","v":"ZAF","label":"Borders South Africa","n":5},{"f":"commonwealth","op":"false","v":null,"label":"Not a member of the Commonwealth","n":1}]},{"colour":"purple","answer":"PA","clues":[{"f":"pop","op":"lt","v":37232000,"label":"Fewer people than Poland","n":152},{"f":"drive","op":"eq","v":"right","label":"Drives on the right","n":109},{"f":"region","op":"eq","v":"North America","label":"In North America","n":10},{"f":"area","op":"lt","v":92090.0,"label":"Smaller than Portugal","n":6},{"f":"first","op":"eq","v":"p","label":"Name starts with P","n":1}]}]'::jsonb),
  ('medium-6', 'medium', 6, 'un', 300, '[{"colour":"green","answer":"RO","clues":[{"f":"pop","op":"gt","v":4993923,"label":"More people than New Zealand","n":122},{"f":"lat","op":"gt","v":40,"label":"Capital north of 40° N","n":29},{"f":"monarchy","op":"false","v":null,"label":"Not a monarchy","n":21},{"f":"first","op":"eq","v":"r","label":"Name starts with R","n":2},{"f":"area","op":"lt","v":270467.0,"label":"Smaller than New Zealand","n":1}]},{"colour":"orange","answer":"UY","clues":[{"f":"lng","op":"lt","v":0,"label":"Capital west of Greenwich (0°)","n":55},{"f":"borders","op":"has","v":"BRA","label":"Borders Brazil","n":9},{"f":"area","op":"lt","v":1002450.0,"label":"Smaller than Egypt","n":5},{"f":"drive","op":"eq","v":"right","label":"Drives on the right","n":3},{"f":"first","op":"in","v":["a","e","i","o","u"],"label":"Name starts with a vowel","n":1}]},{"colour":"blue","answer":"CI","clues":[{"f":"area","op":"gt","v":70273.0,"label":"Larger than Ireland","n":117},{"f":"lng","op":"lt","v":0,"label":"Capital west of Greenwich (0°)","n":34},{"f":"pop","op":"gt","v":9154896,"label":"More people than Switzerland","n":24},{"f":"words","op":"gt","v":1,"label":"Name has more than one word","n":4},{"f":"first","op":"eq","v":"i","label":"Name starts with I","n":1}]},{"colour":"purple","answer":"BT","clues":[{"f":"pop","op":"lt","v":10000000,"label":"Fewer than 10 million people","n":99},{"f":"drive","op":"eq","v":"left","label":"Drives on the left","n":34},{"f":"lat","op":"gt","v":0,"label":"Capital north of the equator","n":20},{"f":"island","op":"false","v":null,"label":"Has at least one land border","n":5},{"f":"last","op":"eq","v":"n","label":"Name ends with N","n":1}]}]'::jsonb),
  ('medium-7', 'medium', 7, 'un', 300, '[{"colour":"green","answer":"ME","clues":[{"f":"neighbours","op":"gt","v":4,"label":"More than 4 land neighbours","n":60},{"f":"pop","op":"lt","v":20000000,"label":"Fewer than 20 million people","n":22},{"f":"lat","op":"gt","v":40,"label":"Capital north of 40° N","n":12},{"f":"borders","op":"has","v":"SRB","label":"Borders Serbia","n":6},{"f":"first","op":"eq","v":"m","label":"Name starts with M","n":1}]},{"colour":"orange","answer":"SZ","clues":[{"f":"lat","op":"lt","v":0,"label":"Capital south of the equator","n":40},{"f":"area","op":"lt","v":312679.0,"label":"Smaller than Poland","n":19},{"f":"monarchy","op":"true","v":null,"label":"A monarchy","n":6},{"f":"landlocked","op":"true","v":null,"label":"Landlocked","n":2},{"f":"first","op":"in","v":["a","e","i","o","u"],"label":"Name starts with a vowel","n":1}]},{"colour":"blue","answer":"US","clues":[{"f":"pop","op":"gt","v":9154896,"label":"More people than Switzerland","n":97},{"f":"area","op":"gt","v":300000,"label":"Larger than 300,000 km²","n":60},{"f":"region","op":"eq","v":"North America","label":"In North America","n":3},{"f":"neighbours","op":"lt","v":3,"label":"Fewer than 3 land neighbours","n":2},{"f":"words","op":"gt","v":1,"label":"Name has more than one word","n":1}]},{"colour":"purple","answer":"TJ","clues":[{"f":"area","op":"lt","v":500000,"label":"Smaller than 500,000 km²","n":142},{"f":"lng","op":"gt","v":0,"label":"Capital east of Greenwich (0°)","n":100},{"f":"landlocked","op":"true","v":null,"label":"Landlocked","n":29},{"f":"borders","op":"has","v":"CHN","label":"Borders China","n":5},{"f":"first","op":"eq","v":"t","label":"Name starts with T","n":1}]}]'::jsonb),
  ('medium-8', 'medium', 8, 'un', 300, '[{"colour":"green","answer":"FR","clues":[{"f":"lat","op":"gt","v":40,"label":"Capital north of 40° N","n":48},{"f":"oecd","op":"true","v":null,"label":"Member of the OECD","n":25},{"f":"area","op":"gt","v":377930.0,"label":"Larger than Japan","n":4},{"f":"pop","op":"gt","v":46466688,"label":"More people than Argentina","n":2},{"f":"borders","op":"has","v":"ESP","label":"Borders Spain","n":1}]},{"colour":"orange","answer":"ZM","clues":[{"f":"area","op":"gt","v":50000,"label":"Larger than 50,000 km²","n":126},{"f":"drive","op":"eq","v":"left","label":"Drives on the left","n":26},{"f":"monarchy","op":"false","v":null,"label":"Not a monarchy","n":19},{"f":"borders","op":"has","v":"TZA","label":"Borders Tanzania","n":5},{"f":"first","op":"eq","v":"z","label":"Name starts with Z","n":1}]},{"colour":"blue","answer":"KH","clues":[{"f":"area","op":"lt","v":300000,"label":"Smaller than 300,000 km²","n":121},{"f":"monarchy","op":"true","v":null,"label":"A monarchy","n":29},{"f":"pop","op":"gt","v":1000000,"label":"More than 1 million people","n":14},{"f":"region","op":"eq","v":"Asia","label":"In Asia","n":6},{"f":"first","op":"eq","v":"c","label":"Name starts with C","n":1}]},{"colour":"purple","answer":"SV","clues":[{"f":"area","op":"lt","v":312679.0,"label":"Smaller than Poland","n":123},{"f":"drive","op":"eq","v":"right","label":"Drives on the right","n":85},{"f":"pop","op":"gt","v":5000000,"label":"More than 5 million people","n":48},{"f":"currencies","op":"has","v":"USD","label":"Uses the US dollar","n":3},{"f":"region","op":"eq","v":"North America","label":"In North America","n":1}]}]'::jsonb),
  ('hard-1', 'hard', 1, 'all', 240, '[{"colour":"green","answer":"PY","clues":[{"f":"area","op":"gt","v":70273.0,"label":"Larger than Ireland","n":120},{"f":"region","op":"in","v":["North America","South America"],"label":"In the Americas","n":22},{"f":"density","op":"lt","v":20,"label":"Fewer than 20 people per km²","n":9},{"f":"lat","op":"lt","v":-20,"label":"Capital south of 20° S","n":3},{"f":"first","op":"eq","v":"p","label":"Name starts with P","n":1}]},{"colour":"orange","answer":"UZ","clues":[{"f":"pop","op":"gt","v":37232000,"label":"More people than Poland","n":40},{"f":"landlocked","op":"true","v":null,"label":"Landlocked","n":4},{"f":"area","op":"gt","v":242900.0,"label":"Larger than the United Kingdom","n":3},{"f":"last","op":"eq","v":"n","label":"Name ends with N","n":2},{"f":"subregion","op":"eq","v":"Central Asia","label":"In Central Asia","n":1}]},{"colour":"blue","answer":"ML","clues":[{"f":"area","op":"gt","v":312679.0,"label":"Larger than Poland","n":70},{"f":"region","op":"eq","v":"Africa","label":"In Africa","n":28},{"f":"neighbours","op":"gt","v":4,"label":"More than 4 land neighbours","n":18},{"f":"first","op":"eq","v":"m","label":"Name starts with M","n":2},{"f":"density","op":"lt","v":20,"label":"Fewer than 20 people per km²","n":1}]},{"colour":"purple","answer":"CZ","clues":[{"f":"lng","op":"gt","v":0,"label":"Capital east of Greenwich (0°)","n":155},{"f":"borders","op":"has","v":"DEU","label":"Borders Germany","n":9},{"f":"subregion","op":"eq","v":"Central Europe","label":"In Central Europe","n":3},{"f":"nato","op":"true","v":null,"label":"Member of NATO","n":2},{"f":"pop","op":"lt","v":11424031,"label":"Fewer people than Portugal","n":1}]}]'::jsonb),
  ('hard-2', 'hard', 2, 'all', 240, '[{"colour":"green","answer":"GE","clues":[{"f":"area","op":"lt","v":270467.0,"label":"Smaller than New Zealand","n":169},{"f":"subregion","op":"eq","v":"Western Asia","label":"In Western Asia","n":12},{"f":"borders","op":"has","v":"TUR","label":"Borders Türkiye","n":4},{"f":"pop","op":"lt","v":20000000,"label":"Fewer than 20 million people","n":3},{"f":"first","op":"nin","v":["a","e","i","o","u"],"label":"Name starts with a consonant","n":1}]},{"colour":"orange","answer":"DK","clues":[{"f":"monarchy","op":"true","v":null,"label":"A monarchy","n":62},{"f":"lat","op":"gt","v":55,"label":"Capital north of 55° N","n":5},{"f":"oecd","op":"true","v":null,"label":"Member of the OECD","n":3},{"f":"neighbours","op":"lt","v":3,"label":"Fewer than 3 land neighbours","n":2},{"f":"area","op":"lt","v":50000,"label":"Smaller than 50,000 km²","n":1}]},{"colour":"blue","answer":"HT","clues":[{"f":"area","op":"lt","v":312679.0,"label":"Smaller than Poland","n":174},{"f":"langs","op":"has","v":"French","label":"French is an official language","n":35},{"f":"pop","op":"gt","v":9154896,"label":"More people than Switzerland","n":8},{"f":"density","op":"gt","v":300,"label":"More than 300 people per km²","n":4},{"f":"first","op":"eq","v":"h","label":"Name starts with H","n":1}]},{"colour":"purple","answer":"CM","clues":[{"f":"area","op":"gt","v":100000,"label":"Larger than 100,000 km²","n":109},{"f":"au","op":"true","v":null,"label":"Member of the African Union","n":39},{"f":"landlocked","op":"false","v":null,"label":"Has a coastline","n":27},{"f":"subregion","op":"eq","v":"Middle Africa","label":"In Middle Africa","n":5},{"f":"langs","op":"has","v":"English","label":"English is an official language","n":1}]}]'::jsonb),
  ('hard-3', 'hard', 3, 'all', 240, '[{"colour":"green","answer":"YT","clues":[{"f":"area","op":"lt","v":300000,"label":"Smaller than 300,000 km²","n":172},{"f":"subregion","op":"eq","v":"Eastern Africa","label":"In Eastern Africa","n":12},{"f":"un","op":"false","v":null,"label":"Not a UN member state","n":3},{"f":"langs","op":"has","v":"French","label":"French is an official language","n":2},{"f":"capsame","op":"true","v":null,"label":"Capital starts with the same letter as the country","n":1}]},{"colour":"orange","answer":"CO","clues":[{"f":"pop","op":"gt","v":20000000,"label":"More than 20 million people","n":67},{"f":"commonwealth","op":"false","v":null,"label":"Not a member of the Commonwealth","n":49},{"f":"subregion","op":"eq","v":"South America","label":"In South America","n":6},{"f":"first","op":"eq","v":"c","label":"Name starts with C","n":2},{"f":"area","op":"gt","v":1000000,"label":"Larger than 1 million km²","n":1}]},{"colour":"blue","answer":"JE","clues":[{"f":"area","op":"lt","v":1000,"label":"Smaller than 1,000 km²","n":57},{"f":"region","op":"in","v":["Europe","Asia"],"label":"In Europe or Asia","n":13},{"f":"un","op":"false","v":null,"label":"Not a UN member state","n":5},{"f":"last","op":"eq","v":"y","label":"Name ends with Y","n":3},{"f":"first","op":"eq","v":"j","label":"Name starts with J","n":1}]},{"colour":"purple","answer":"US","clues":[{"f":"area","op":"gt","v":70273.0,"label":"Larger than Ireland","n":120},{"f":"pop","op":"gt","v":46466688,"label":"More people than Argentina","n":32},{"f":"tz","op":"gt","v":1,"label":"Spans more than one time zone","n":9},{"f":"first","op":"in","v":["a","e","i","o","u"],"label":"Name starts with a vowel","n":3},{"f":"last","op":"eq","v":"s","label":"Name ends with S","n":1}]}]'::jsonb),
  ('hard-4', 'hard', 4, 'all', 240, '[{"colour":"green","answer":"IT","clues":[{"f":"area","op":"gt","v":41284.0,"label":"Larger than Switzerland","n":135},{"f":"nato","op":"true","v":null,"label":"Member of NATO","n":26},{"f":"subregion","op":"eq","v":"Southern Europe","label":"In Southern Europe","n":4},{"f":"len","op":"lt","v":6,"label":"Name has 5 letters or fewer","n":2},{"f":"pop","op":"gt","v":50000000,"label":"More than 50 million people","n":1}]},{"colour":"orange","answer":"BW","clues":[{"f":"area","op":"gt","v":50000,"label":"Larger than 50,000 km²","n":130},{"f":"commonwealth","op":"true","v":null,"label":"Member of the Commonwealth","n":26},{"f":"landlocked","op":"true","v":null,"label":"Landlocked","n":4},{"f":"last","op":"eq","v":"a","label":"Name ends with A","n":3},{"f":"density","op":"lt","v":20,"label":"Fewer than 20 people per km²","n":1}]},{"colour":"blue","answer":"AW","clues":[{"f":"drive","op":"eq","v":"right","label":"Drives on the right","n":172},{"f":"area","op":"lt","v":1000,"label":"Smaller than 1,000 km²","n":25},{"f":"lng","op":"lt","v":0,"label":"Capital west of Greenwich (0°)","n":11},{"f":"density","op":"gt","v":300,"label":"More than 300 people per km²","n":5},{"f":"len","op":"lt","v":6,"label":"Name has 5 letters or fewer","n":1}]},{"colour":"purple","answer":"GS","clues":[{"f":"area","op":"lt","v":270467.0,"label":"Smaller than New Zealand","n":169},{"f":"drive","op":"eq","v":"right","label":"Drives on the right","n":113},{"f":"density","op":"lt","v":20,"label":"Fewer than 20 people per km²","n":11},{"f":"langs","op":"has","v":"English","label":"English is an official language","n":2},{"f":"commonwealth","op":"false","v":null,"label":"Not a member of the Commonwealth","n":1}]}]'::jsonb),
  ('hard-5', 'hard', 5, 'all', 240, '[{"colour":"green","answer":"LI","clues":[{"f":"neighbours","op":"lt","v":3,"label":"Fewer than 3 land neighbours","n":131},{"f":"lat","op":"gt","v":0,"label":"Capital north of the equator","n":94},{"f":"subregion","op":"eq","v":"Western Europe","label":"In Western Europe","n":3},{"f":"eu","op":"false","v":null,"label":"Not a member of the EU","n":2},{"f":"first","op":"eq","v":"l","label":"Name starts with L","n":1}]},{"colour":"orange","answer":"RE","clues":[{"f":"langs","op":"has","v":"French","label":"French is an official language","n":46},{"f":"area","op":"lt","v":70273.0,"label":"Smaller than Ireland","n":29},{"f":"density","op":"gt","v":300,"label":"More than 300 people per km²","n":15},{"f":"last","op":"eq","v":"n","label":"Name ends with N","n":4},{"f":"first","op":"eq","v":"r","label":"Name starts with R","n":1}]},{"colour":"blue","answer":"DM","clues":[{"f":"pop","op":"lt","v":5000000,"label":"Fewer than 5 million people","n":120},{"f":"subregion","op":"eq","v":"Caribbean","label":"In Caribbean","n":25},{"f":"drive","op":"eq","v":"left","label":"Drives on the left","n":15},{"f":"monarchy","op":"false","v":null,"label":"Not a monarchy","n":4},{"f":"first","op":"eq","v":"d","label":"Name starts with D","n":1}]},{"colour":"purple","answer":"MH","clues":[{"f":"area","op":"lt","v":312679.0,"label":"Smaller than Poland","n":174},{"f":"currencies","op":"has","v":"USD","label":"Uses the US dollar","n":18},{"f":"un","op":"true","v":null,"label":"A UN member state","n":9},{"f":"capsame","op":"true","v":null,"label":"Capital starts with the same letter as the country","n":2},{"f":"region","op":"eq","v":"Oceania","label":"In Oceania","n":1}]}]'::jsonb),
  ('hard-6', 'hard', 6, 'all', 240, '[{"colour":"green","answer":"EH","clues":[{"f":"area","op":"gt","v":242900.0,"label":"Larger than the United Kingdom","n":79},{"f":"pop","op":"lt","v":66912637,"label":"Fewer people than the United Kingdom","n":58},{"f":"au","op":"false","v":null,"label":"Not a member of the African Union","n":32},{"f":"un","op":"false","v":null,"label":"Not a UN member state","n":2},{"f":"words","op":"gt","v":1,"label":"Name has more than one word","n":1}]},{"colour":"orange","answer":"BO","clues":[{"f":"pop","op":"gt","v":5000000,"label":"More than 5 million people","n":125},{"f":"area","op":"gt","v":1000000,"label":"Larger than 1 million km²","n":27},{"f":"density","op":"lt","v":20,"label":"Fewer than 20 people per km²","n":11},{"f":"subregion","op":"eq","v":"South America","label":"In South America","n":2},{"f":"borders","op":"has","v":"ARG","label":"Borders Argentina","n":1}]},{"colour":"blue","answer":"RO","clues":[{"f":"un","op":"true","v":null,"label":"A UN member state","n":193},{"f":"subregion","op":"eq","v":"Southeast Europe","label":"In Southeast Europe","n":8},{"f":"area","op":"gt","v":50000,"label":"Larger than 50,000 km²","n":5},{"f":"nato","op":"true","v":null,"label":"Member of NATO","n":3},{"f":"pop","op":"gt","v":10000000,"label":"More than 10 million people","n":1}]},{"colour":"purple","answer":"BN","clues":[{"f":"un","op":"true","v":null,"label":"A UN member state","n":193},{"f":"area","op":"lt","v":312679.0,"label":"Smaller than Poland","n":123},{"f":"drive","op":"eq","v":"left","label":"Drives on the left","n":38},{"f":"subregion","op":"eq","v":"South-Eastern Asia","label":"In South-Eastern Asia","n":3},{"f":"pop","op":"lt","v":1000000,"label":"Fewer than 1 million people","n":1}]}]'::jsonb),
  ('hard-7', 'hard', 7, 'all', 240, '[{"colour":"green","answer":"PE","clues":[{"f":"area","op":"gt","v":242900.0,"label":"Larger than the United Kingdom","n":79},{"f":"subregion","op":"eq","v":"South America","label":"In South America","n":9},{"f":"borders","op":"has","v":"BRA","label":"Borders Brazil","n":6},{"f":"pop","op":"gt","v":20000000,"label":"More than 20 million people","n":4},{"f":"last","op":"eq","v":"u","label":"Name ends with U","n":1}]},{"colour":"orange","answer":"MK","clues":[{"f":"un","op":"true","v":null,"label":"A UN member state","n":193},{"f":"pop","op":"lt","v":9154896,"label":"Fewer people than Switzerland","n":95},{"f":"island","op":"false","v":null,"label":"Has at least one land border","n":62},{"f":"borders","op":"has","v":"SRB","label":"Borders Serbia","n":5},{"f":"landlocked","op":"true","v":null,"label":"Landlocked","n":1}]},{"colour":"blue","answer":"TO","clues":[{"f":"pop","op":"lt","v":11424031,"label":"Fewer people than Portugal","n":159},{"f":"lng","op":"lt","v":0,"label":"Capital west of Greenwich (0°)","n":67},{"f":"subregion","op":"eq","v":"Polynesia","label":"In Polynesia","n":9},{"f":"lat","op":"lt","v":-20,"label":"Capital south of 20° S","n":3},{"f":"first","op":"eq","v":"t","label":"Name starts with T","n":1}]},{"colour":"purple","answer":"KE","clues":[{"f":"lat","op":"lt","v":0,"label":"Capital south of the equator","n":58},{"f":"area","op":"gt","v":500000,"label":"Larger than 500,000 km²","n":17},{"f":"neighbours","op":"gt","v":4,"label":"More than 4 land neighbours","n":10},{"f":"subregion","op":"eq","v":"Eastern Africa","label":"In Eastern Africa","n":4},{"f":"first","op":"eq","v":"k","label":"Name starts with K","n":1}]}]'::jsonb),
  ('hard-8', 'hard', 8, 'all', 240, '[{"colour":"green","answer":"LU","clues":[{"f":"pop","op":"lt","v":9154896,"label":"Fewer people than Switzerland","n":146},{"f":"lng","op":"gt","v":0,"label":"Capital east of Greenwich (0°)","n":82},{"f":"langs","op":"has","v":"French","label":"French is an official language","n":17},{"f":"capsame","op":"true","v":null,"label":"Capital starts with the same letter as the country","n":5},{"f":"oecd","op":"true","v":null,"label":"Member of the OECD","n":1}]},{"colour":"orange","answer":"TR","clues":[{"f":"area","op":"gt","v":10000,"label":"Larger than 10,000 km²","n":169},{"f":"pop","op":"gt","v":20000000,"label":"More than 20 million people","n":67},{"f":"g20","op":"true","v":null,"label":"Member of the G20","n":19},{"f":"subregion","op":"eq","v":"Western Asia","label":"In Western Asia","n":2},{"f":"borders","op":"has","v":"IRN","label":"Borders Iran","n":1}]},{"colour":"blue","answer":"MU","clues":[{"f":"drive","op":"eq","v":"left","label":"Drives on the left","n":73},{"f":"pop","op":"lt","v":5525600,"label":"Fewer people than Ireland","n":50},{"f":"density","op":"gt","v":300,"label":"More than 300 people per km²","n":11},{"f":"first","op":"eq","v":"m","label":"Name starts with M","n":3},{"f":"subregion","op":"eq","v":"Eastern Africa","label":"In Eastern Africa","n":1}]},{"colour":"purple","answer":"CU","clues":[{"f":"un","op":"true","v":null,"label":"A UN member state","n":193},{"f":"pop","op":"gt","v":5525600,"label":"More people than Ireland","n":116},{"f":"area","op":"lt","v":312679.0,"label":"Smaller than Poland","n":51},{"f":"island","op":"true","v":null,"label":"No land borders","n":3},{"f":"len","op":"lt","v":6,"label":"Name has 5 letters or fewer","n":1}]}]'::jsonb);

-- Every step count must match the generator, and every chain must end on its answer.
do $check$
declare v_bad integer;
begin
  select count(*) into v_bad
  from private.elimination_puzzles as puzzle
  cross join jsonb_array_elements(puzzle.groups) as grp(value)
  cross join jsonb_array_elements(grp.value -> 'clues') with ordinality as clue(value, position)
  where (clue.value ->> 'n')::integer <> (
    select count(*) from private.elimination_places as place
    where place.playable and (puzzle.pool = 'all' or place.un)
      and private.elim_matches(place.facts, grp.value -> 'clues', clue.position::integer))
  or (clue.position = jsonb_array_length(grp.value -> 'clues') and not exists (
    select 1 from private.elimination_places as place
    where place.code = grp.value ->> 'answer'
      and private.elim_matches(place.facts, grp.value -> 'clues', clue.position::integer)));
  if v_bad > 0 then raise exception 'ELIMINATION_PUZZLE_CHECK_FAILED: % steps', v_bad; end if;
end $check$;

create table private.elimination_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_request_id uuid not null,
  puzzle_id text not null references private.elimination_puzzles(id),
  state text not null default 'active' check (state in ('active', 'completed', 'abandoned')),
  end_reason text check (end_reason in ('all_solved', 'time_up', 'gave_up')),
  progress jsonb not null,
  guesses integer not null default 0,
  wrong integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  deadline_at timestamptz not null,
  completed_at timestamptz,
  elapsed_ms bigint,
  unique (user_id, start_request_id)
);
alter table private.elimination_sessions enable row level security;
create index elimination_sessions_user_puzzle on private.elimination_sessions (user_id, puzzle_id, state);
create index elimination_sessions_puzzle on private.elimination_sessions (puzzle_id);

create or replace function private.elim_solved(p_progress jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum(jsonb_array_length(grp.value)), 0)::integer from jsonb_array_elements(p_progress) as grp(value);
$$;

-- Closes a round whose time is up. Returns true when the round is (now) finished.
create or replace function private.elim_expire(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_session private.elimination_sessions;
begin
  select * into v_session from private.elimination_sessions as session where session.id = p_id;
  if v_session.state <> 'active' then return true; end if;
  if clock_timestamp() < v_session.deadline_at then return false; end if;
  update private.elimination_sessions as session
    set state = 'completed', end_reason = 'time_up', completed_at = v_session.deadline_at,
        elapsed_ms = (extract(epoch from (v_session.deadline_at - v_session.created_at)) * 1000)::bigint
    where session.id = p_id;
  return true;
end;
$$;

create or replace function private.elim_view(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.elimination_sessions;
  v_puzzle private.elimination_puzzles;
  v_done boolean;
  v_total integer;
begin
  select * into v_session from private.elimination_sessions as session where session.id = p_id;
  select * into v_puzzle from private.elimination_puzzles as puzzle where puzzle.id = v_session.puzzle_id;
  v_done := v_session.state <> 'active';
  select sum(jsonb_array_length(grp.value -> 'clues'))::integer into v_total from jsonb_array_elements(v_puzzle.groups) as grp(value);
  return jsonb_build_object(
    'id', v_session.id, 'puzzleId', v_puzzle.id, 'difficulty', v_puzzle.difficulty, 'number', v_puzzle.number,
    'pool', v_puzzle.pool, 'state', v_session.state, 'endReason', v_session.end_reason,
    'timeLimitSeconds', v_puzzle.time_limit_seconds, 'deadlineAt', v_session.deadline_at, 'serverNow', clock_timestamp(),
    'elapsedMs', coalesce(v_session.elapsed_ms, (extract(epoch from (clock_timestamp() - v_session.created_at)) * 1000)::bigint),
    'solved', private.elim_solved(v_session.progress), 'total', v_total,
    'guesses', v_session.guesses, 'wrong', v_session.wrong,
    'groups', (
      select jsonb_agg(jsonb_build_object(
        'colour', grp.value ->> 'colour',
        'size', jsonb_array_length(grp.value -> 'clues'),
        'solved', jsonb_array_length(v_session.progress -> (grp.position::integer - 1)),
        'answer', case when v_done then (select jsonb_build_object('code', place.code, 'name', place.name)
          from private.elimination_places as place where place.code = grp.value ->> 'answer') end,
        'steps', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'label', clue.value ->> 'label',
            'remaining', (clue.value ->> 'n')::integer,
            'answer', (select jsonb_build_object('code', place.code, 'name', place.name)
              from private.elimination_places as place
              where place.code = v_session.progress -> (grp.position::integer - 1) ->> (clue.position::integer - 1))
          ) order by clue.position), '[]'::jsonb)
          from jsonb_array_elements(grp.value -> 'clues') with ordinality as clue(value, position)
          where v_done or clue.position <= jsonb_array_length(v_session.progress -> (grp.position::integer - 1)) + 1
        )
      ) order by grp.position)
      from jsonb_array_elements(v_puzzle.groups) with ordinality as grp(value, position)
    )
  );
end;
$$;

create or replace function public.arena_elim_catalog()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  perform private.rate('elim_catalog', 60);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', puzzle.id, 'difficulty', puzzle.difficulty, 'number', puzzle.number, 'pool', puzzle.pool,
      'timeLimitSeconds', puzzle.time_limit_seconds,
      'groups', jsonb_array_length(puzzle.groups),
      'total', (select sum(jsonb_array_length(grp.value -> 'clues'))::integer from jsonb_array_elements(puzzle.groups) as grp(value)),
      'plays', (select count(*) from private.elimination_sessions as session
        where session.user_id = v_uid and session.puzzle_id = puzzle.id and session.state = 'completed'),
      'best', (select jsonb_build_object('solved', private.elim_solved(session.progress), 'elapsedMs', session.elapsed_ms)
        from private.elimination_sessions as session
        where session.user_id = v_uid and session.puzzle_id = puzzle.id and session.state = 'completed'
        order by private.elim_solved(session.progress) desc, session.elapsed_ms asc limit 1),
      'activeId', (select session.id from private.elimination_sessions as session
        where session.user_id = v_uid and session.puzzle_id = puzzle.id and session.state = 'active'
          and session.deadline_at > clock_timestamp()
        order by session.created_at desc limit 1)
    ) order by case puzzle.difficulty when 'easy' then 1 when 'medium' then 2 else 3 end, puzzle.number), '[]'::jsonb)
    from private.elimination_puzzles as puzzle
  );
end;
$$;

create or replace function public.arena_elim_start(p_puzzle text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_puzzle private.elimination_puzzles;
  v_id uuid;
begin
  if p_request_id is null then raise exception 'INVALID_ELIMINATION_START'; end if;
  select * into v_puzzle from private.elimination_puzzles as puzzle where puzzle.id = p_puzzle;
  if not found then raise exception 'UNKNOWN_ELIMINATION_PUZZLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || p_request_id::text, 0));
  select session.id into v_id from private.elimination_sessions as session
    where session.user_id = v_uid and session.start_request_id = p_request_id;
  if found then return private.elim_view(v_id); end if;
  perform private.rate('elim_start', 20);
  -- One open round per puzzle: starting again closes the previous one.
  update private.elimination_sessions as session set state = 'abandoned', completed_at = clock_timestamp()
    where session.user_id = v_uid and session.puzzle_id = p_puzzle and session.state = 'active';
  insert into private.elimination_sessions (user_id, start_request_id, puzzle_id, progress, deadline_at)
  values (v_uid, p_request_id, p_puzzle,
    (select jsonb_agg('[]'::jsonb) from jsonb_array_elements(v_puzzle.groups)),
    clock_timestamp() + make_interval(secs => v_puzzle.time_limit_seconds))
  returning id into v_id;
  return private.elim_view(v_id);
end;
$$;

create or replace function public.arena_elim_view(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  perform private.rate('elim_view', 120);
  if not exists (select 1 from private.elimination_sessions as session where session.id = p_id and session.user_id = v_uid) then
    raise exception 'ELIMINATION_NOT_FOUND';
  end if;
  perform private.elim_expire(p_id);
  return private.elim_view(p_id);
end;
$$;

create or replace function public.arena_elim_guess(p_id uuid, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_session private.elimination_sessions;
  v_puzzle private.elimination_puzzles;
  v_key text := private.recall_normalize(left(coalesce(p_text, ''), 80));
  v_codes text[];
  v_place private.elimination_places;
  v_progress jsonb;
  v_advanced text[] := '{}';
  v_steps integer;
  v_result text;
  v_total integer;
begin
  perform private.rate('elim_guess', 240);
  select * into v_session from private.elimination_sessions as session
    where session.id = p_id and session.user_id = v_uid for update;
  if not found then raise exception 'ELIMINATION_NOT_FOUND'; end if;
  if private.elim_expire(p_id) then
    return jsonb_build_object('result', 'finished', 'view', private.elim_view(p_id));
  end if;
  select * into v_puzzle from private.elimination_puzzles as puzzle where puzzle.id = v_session.puzzle_id;

  select array_agg(place.code order by place.code) into v_codes from private.elimination_places as place
    where v_key <> '' and v_key = any(place.aliases) and place.playable and (v_puzzle.pool = 'all' or place.un);
  if coalesce(cardinality(v_codes), 0) > 1 then
    -- A shared spelling counts for the place whose own name it is.
    select array_agg(place.code) into v_codes from private.elimination_places as place
      where place.code = any(v_codes) and private.recall_normalize(place.name) = v_key;
  end if;
  if coalesce(cardinality(v_codes), 0) <> 1 then
    update private.elimination_sessions as session set guesses = session.guesses + 1 where session.id = p_id;
    return jsonb_build_object('result', case when v_key = '' then 'empty'
      when coalesce(cardinality(v_codes), 0) = 0 then 'unknown' else 'ambiguous' end, 'view', private.elim_view(p_id));
  end if;
  select * into v_place from private.elimination_places as place where place.code = v_codes[1];

  -- Every open group whose revealed clues all fit this place moves one step on.
  v_progress := v_session.progress;
  for i in 0 .. jsonb_array_length(v_puzzle.groups) - 1 loop
    v_steps := jsonb_array_length(v_progress -> i);
    if v_steps < jsonb_array_length(v_puzzle.groups -> i -> 'clues')
      and private.elim_matches(v_place.facts, v_puzzle.groups -> i -> 'clues', v_steps + 1) then
      v_progress := jsonb_set(v_progress, array[i::text], (v_progress -> i) || to_jsonb(v_place.code));
      v_advanced := v_advanced || (v_puzzle.groups -> i ->> 'colour');
    end if;
  end loop;
  v_result := case when cardinality(v_advanced) > 0 then 'advanced' else 'no_match' end;
  select sum(jsonb_array_length(grp.value -> 'clues'))::integer into v_total from jsonb_array_elements(v_puzzle.groups) as grp(value);

  update private.elimination_sessions as session set
    progress = v_progress,
    guesses = session.guesses + 1,
    wrong = session.wrong + case when v_result = 'no_match' then 1 else 0 end,
    state = case when private.elim_solved(v_progress) >= v_total then 'completed' else session.state end,
    end_reason = case when private.elim_solved(v_progress) >= v_total then 'all_solved' else session.end_reason end,
    completed_at = case when private.elim_solved(v_progress) >= v_total then clock_timestamp() else session.completed_at end,
    elapsed_ms = case when private.elim_solved(v_progress) >= v_total
      then (extract(epoch from (clock_timestamp() - session.created_at)) * 1000)::bigint else session.elapsed_ms end
  where session.id = p_id;

  return jsonb_build_object('result', v_result, 'place', jsonb_build_object('code', v_place.code, 'name', v_place.name),
    'advanced', to_jsonb(v_advanced), 'view', private.elim_view(p_id));
end;
$$;

create or replace function public.arena_elim_give_up(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  perform private.rate('elim_give_up', 30);
  update private.elimination_sessions as session set state = 'completed', end_reason = 'gave_up',
      completed_at = clock_timestamp(),
      elapsed_ms = (extract(epoch from (clock_timestamp() - session.created_at)) * 1000)::bigint
    where session.id = p_id and session.user_id = v_uid and session.state = 'active';
  if not exists (select 1 from private.elimination_sessions as session where session.id = p_id and session.user_id = v_uid) then
    raise exception 'ELIMINATION_NOT_FOUND';
  end if;
  return private.elim_view(p_id);
end;
$$;

revoke all on function private.elim_test(jsonb, jsonb), private.elim_matches(jsonb, jsonb, integer), private.elim_solved(jsonb),
  private.elim_expire(uuid), private.elim_view(uuid) from public, anon, authenticated;
revoke all on function public.arena_elim_catalog(), public.arena_elim_start(text, uuid), public.arena_elim_view(uuid),
  public.arena_elim_guess(uuid, text), public.arena_elim_give_up(uuid) from public, anon;
grant execute on function public.arena_elim_catalog(), public.arena_elim_start(text, uuid), public.arena_elim_view(uuid),
  public.arena_elim_guess(uuid, text), public.arena_elim_give_up(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
