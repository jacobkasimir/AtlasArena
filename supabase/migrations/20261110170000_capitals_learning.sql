begin;

create or replace function private.capitals_normalize(p_text text)
returns text
language sql
immutable
set search_path = extensions, pg_catalog
as $function$
  select lower(trim(regexp_replace(unaccent(coalesce(p_text, '')), '[[:space:]]+', ' ', 'g')));
$function$;

create or replace function private.capitals_json_names(p_value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select coalesce(array_agg(distinct trim(name) order by trim(name)), array[]::text[])
  from (
    select p_value #>> '{}' as name where jsonb_typeof(p_value) = 'string'
    union all
    select item #>> '{}' from jsonb_array_elements(
      case when jsonb_typeof(p_value) = 'array' then p_value else '[]'::jsonb end
    ) as array_values(item) where jsonb_typeof(item) = 'string'
    union all
    select item ->> 'common' from jsonb_array_elements(
      case when jsonb_typeof(p_value) = 'array' then p_value else '[]'::jsonb end
    ) as array_objects(item) where jsonb_typeof(item) = 'object'
    union all
    select item ->> 'official' from jsonb_array_elements(
      case when jsonb_typeof(p_value) = 'array' then p_value else '[]'::jsonb end
    ) as array_objects(item) where jsonb_typeof(item) = 'object'
    union all
    select p_value ->> 'common' where jsonb_typeof(p_value) = 'object'
    union all
    select p_value ->> 'official' where jsonb_typeof(p_value) = 'object'
    union all
    select item #>> '{}' from jsonb_each(
      case when jsonb_typeof(p_value) = 'object' then p_value else '{}'::jsonb end
    ) as object_values(key, item) where jsonb_typeof(item) = 'string'
    union all
    select item ->> 'common' from jsonb_each(
      case when jsonb_typeof(p_value) = 'object' then p_value else '{}'::jsonb end
    ) as object_values(key, item) where jsonb_typeof(item) = 'object'
    union all
    select item ->> 'official' from jsonb_each(
      case when jsonb_typeof(p_value) = 'object' then p_value else '{}'::jsonb end
    ) as object_values(key, item) where jsonb_typeof(item) = 'object'
  ) as candidates(name)
  where length(trim(coalesce(name, ''))) > 0;
$function$;

-- A deliberately narrow view of the country catalog. Capital roles come only
-- from stored attributes; no role is inferred from order or legacy text.
create or replace function private.capitals_catalog()
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with valid_capitals as (
    select country.code,
      trim(item.value ->> 'name') as name,
      coalesce((item.value -> 'attributes' ->> 'primary') = 'true', false) as is_primary,
      array_remove(array[
        case when item.value -> 'attributes' ->> 'administrative' = 'true' then 'Administrative' end,
        case when item.value -> 'attributes' ->> 'constitutional' = 'true' then 'Constitutional' end,
        case when item.value -> 'attributes' ->> 'executive' = 'true' then 'Executive' end,
        case when item.value -> 'attributes' ->> 'judicial' = 'true' then 'Judicial' end,
        case when item.value -> 'attributes' ->> 'legislative' = 'true' then 'Legislative' end
      ], null) as roles
    from private.countries as country
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(country.capitals) = 'array' then country.capitals else '[]'::jsonb end
    ) as item(value)
    where length(trim(coalesce(item.value ->> 'name', ''))) > 0
  ), capital_name_owners as (
    select private.capitals_normalize(name) as normalized, count(distinct code) as owner_count
    from valid_capitals
    group by private.capitals_normalize(name)
  ), reverse_capital_ranked as (
    select cap.*,
      row_number() over (
        partition by cap.code
        order by cap.is_primary desc, private.capitals_normalize(cap.name), cap.name collate "C"
      ) as country_rank
    from valid_capitals as cap
    join capital_name_owners as owner
      on owner.normalized = private.capitals_normalize(cap.name) and owner.owner_count = 1
  ), grouped_capitals as (
    select code, jsonb_agg(jsonb_build_object(
      'name', name, 'roles', to_jsonb(roles), 'primary', is_primary
    ) order by is_primary desc, private.capitals_normalize(name), name collate "C") as options
    from valid_capitals group by code
  ), aliases as (
    select country.code,
      coalesce(array_agg(distinct trim(alias.name) order by trim(alias.name))
        filter (where length(trim(coalesce(alias.name, ''))) > 0), array[]::text[]) as names
    from private.countries as country
    left join lateral (
      select country.name as name
      union all select country.name_official
      union all select unnest(coalesce(country.name_alternates, array[]::text[]))
      union all select unnest(private.capitals_json_names(country.name_translations::jsonb))
      union all select unnest(private.capitals_json_names(country.name_native::jsonb))
    ) as alias on true
    group by country.code
  )
  select jsonb_build_object(
    'code', country.code,
    'name', country.name,
    'officialName', country.name_official,
    'region', nullif(trim(country.region), ''),
    'difficulty', country.difficulty,
    'catalogKind', country.catalog_kind,
    'codeAlpha2', case when country.catalog_kind = 'iso_alpha2' and country.code ~ '^[A-Z]{2}$' then country.code end,
    'codeAlpha3', case when country.catalog_kind = 'iso_alpha2' and country.code_alpha3 ~ '^[A-Z]{3}$' then country.code_alpha3 end,
    'flagSvgUrl', country.flag_svg_url,
    'aliases', to_jsonb(aliases.names),
    'capitals', coalesce(grouped_capitals.options, '[]'::jsonb),
    'reverseCapital', case when reverse_capital.country_rank = 1 then jsonb_build_object(
      'name', reverse_capital.name, 'roles', to_jsonb(reverse_capital.roles), 'primary', reverse_capital.is_primary
    ) end,
    'countryToCapitalEligible', coalesce(jsonb_array_length(grouped_capitals.options), 0) > 0,
    'countryToCapitalReason', case when coalesce(jsonb_array_length(grouped_capitals.options), 0) = 0
      then 'No valid capital name is present in the structured capitals array.' end,
    'capitalToCountryEligible', coalesce(reverse_capital.country_rank = 1, false),
    'capitalToCountryReason', case
      when coalesce(jsonb_array_length(grouped_capitals.options), 0) = 0 then 'No valid capital name is present in the structured capitals array.'
      when reverse_capital.country_rank is null then 'All listed capital names are shared by multiple catalog entries.'
    end,
    'sourceLinks', (
      select coalesce(jsonb_agg(jsonb_build_object('label', source.label, 'url', source.url)), '[]'::jsonb)
      from (values
        ('Imported source', country.source),
        ('Wikipedia page', country.link_wikipedia)
      ) as source(label, url)
      where source.url ~ '^https://[^[:space:]]+$'
    )
  )
  from private.countries as country
  left join grouped_capitals on grouped_capitals.code = country.code
  left join aliases on aliases.code = country.code
  left join reverse_capital_ranked as reverse_capital
    on reverse_capital.code = country.code and reverse_capital.country_rank = 1
  order by country.name collate "C", country.code collate "C";
$function$;

create table if not exists private.capital_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('country_to_capital', 'capital_to_country')),
  pool_mode text not null check (pool_mode in ('all', 'easy', 'manual')),
  selected_codes text[] not null default '{}',
  region text,
  pool_signature text not null,
  content_version text not null,
  rules_version integer not null default 1 check (rules_version = 1),
  pool_count integer not null check (pool_count > 0),
  current_position integer not null default 1 check (current_position > 0),
  vocabulary jsonb not null default '[]'::jsonb,
  ambiguous_country_aliases text[] not null default '{}',
  state text not null default 'active' check (state in ('active', 'completed', 'abandoned')),
  score integer not null default 0 check (score >= 0),
  correct_count integer not null default 0 check (correct_count >= 0),
  incorrect_count integer not null default 0 check (incorrect_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  elapsed_ms bigint check (elapsed_ms is null or elapsed_ms >= 0),
  final_badge text check (final_badge in ('first_run', 'new_best', 'not_best')),
  check (current_position <= pool_count),
  check (
    (state = 'completed' and completed_at is not null and elapsed_ms is not null and final_badge is not null)
    or (state <> 'completed' and completed_at is null and elapsed_ms is null and final_badge is null)
  )
);
create index if not exists capital_sessions_active
  on private.capital_sessions(user_id, created_at desc) where state = 'active';
create index if not exists capital_sessions_comparable
  on private.capital_sessions(user_id, direction, pool_signature, content_version, score desc, elapsed_ms asc)
  where state = 'completed';

create table if not exists private.capital_session_entries (
  session_id uuid not null references private.capital_sessions(id) on delete cascade,
  entry_id uuid not null default gen_random_uuid(),
  country_code text not null,
  position integer not null check (position > 0),
  country_name text not null,
  region text,
  catalog_kind text not null check (catalog_kind in ('iso_alpha2', 'non_iso')),
  alpha2 text,
  alpha3 text,
  prompt text not null,
  capitals jsonb not null,
  selected_capital text,
  country_aliases text[] not null default '{}',
  country_codes text[] not null default '{}',
  source_links jsonb not null default '[]'::jsonb,
  outcome text not null default 'pending' check (outcome in ('pending', 'correct', 'incorrect', 'skipped')),
  submitted_answer text,
  points integer not null default 0 check (points in (0, 100)),
  finalized_at timestamptz,
  last_request_id uuid,
  primary key (session_id, entry_id),
  unique (session_id, country_code),
  unique (session_id, position),
  check (alpha2 is null or alpha2 ~ '^[A-Z]{2}$'),
  check (alpha3 is null or alpha3 ~ '^[A-Z]{3}$'),
  check ((outcome = 'pending' and finalized_at is null and points = 0) or (outcome <> 'pending' and finalized_at is not null))
);
create index if not exists capital_entries_session_order on private.capital_session_entries(session_id, position);

create table if not exists private.capital_action_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  operation text not null,
  fingerprint text not null,
  session_id uuid not null references private.capital_sessions(id) on delete cascade,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id, request_id)
);
alter table private.capital_sessions enable row level security;
alter table private.capital_session_entries enable row level security;
alter table private.capital_action_requests enable row level security;
revoke all on private.capital_sessions, private.capital_session_entries, private.capital_action_requests
  from public, anon, authenticated;

create or replace function private.capitals_view(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.capital_sessions%rowtype;
  v_current private.capital_session_entries%rowtype;
  v_entries jsonb;
  v_current_json jsonb;
  v_finalized integer;
  v_top_five jsonb := '[]'::jsonb;
begin
  select * into v_session from private.capital_sessions as session
  where session.id = p_session_id and session.user_id = auth.uid();
  if not found then raise exception 'CAPITAL_SESSION_NOT_FOUND'; end if;

  select count(*)::integer into v_finalized from private.capital_session_entries as entry
  where entry.session_id = v_session.id and entry.outcome <> 'pending';

  select coalesce(jsonb_agg(case when entry.outcome <> 'pending' or v_session.state in ('completed', 'abandoned')
    then jsonb_build_object(
      'id', entry.entry_id, 'position', entry.position, 'countryCode', entry.country_code,
      'countryName', entry.country_name, 'region', entry.region, 'catalogKind', entry.catalog_kind,
      'codeAlpha2', entry.alpha2, 'codeAlpha3', entry.alpha3, 'prompt', entry.prompt,
      'selectedCapital', case when v_session.direction = 'capital_to_country' then entry.selected_capital end,
      'acceptedAnswers', case when entry.outcome <> 'pending' or v_session.state in ('completed', 'abandoned')
        then case when v_session.direction = 'country_to_capital' then entry.capitals
          else jsonb_build_array(jsonb_build_object('name', entry.country_name, 'roles', '[]'::jsonb, 'primary', false)) end end,
      'submittedAnswer', entry.submitted_answer, 'outcome', entry.outcome, 'points', entry.points,
      'sourceLinks', entry.source_links
    )
    else jsonb_build_object('id', entry.entry_id, 'position', entry.position, 'outcome', 'pending', 'points', 0)
  end order by entry.position), '[]'::jsonb)
  into v_entries from private.capital_session_entries as entry where entry.session_id = v_session.id;

  select * into v_current from private.capital_session_entries as entry
  where entry.session_id = v_session.id and entry.position = v_session.current_position;
  if found and v_session.state = 'active' then
    v_current_json := jsonb_build_object(
      'id', v_current.entry_id, 'position', v_current.position,
      'countryCode', case when v_current.outcome <> 'pending' then v_current.country_code end,
      'countryName', case when v_session.direction = 'country_to_capital' or v_current.outcome <> 'pending' then v_current.country_name end,
      'region', case when v_current.outcome <> 'pending' then v_current.region end,
      'catalogKind', case when v_current.outcome <> 'pending' then v_current.catalog_kind end,
      'codeAlpha2', case when v_current.outcome <> 'pending' then v_current.alpha2 end,
      'codeAlpha3', case when v_current.outcome <> 'pending' then v_current.alpha3 end,
      'prompt', v_current.prompt,
      'selectedCapital', case when v_session.direction = 'capital_to_country' then v_current.selected_capital end,
      'acceptedAnswers', case when v_current.outcome <> 'pending'
        then case when v_session.direction = 'country_to_capital' then v_current.capitals
          else jsonb_build_array(jsonb_build_object('name', v_current.country_name, 'roles', '[]'::jsonb, 'primary', false)) end end,
      'submittedAnswer', v_current.submitted_answer, 'outcome', v_current.outcome, 'points', v_current.points,
      'sourceLinks', case when v_current.outcome <> 'pending' then v_current.source_links else '[]'::jsonb end
    );
  end if;

  if v_session.state = 'completed' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'score', past.score, 'elapsedMs', past.elapsed_ms, 'completedAt', past.completed_at
    ) order by past.score desc, past.elapsed_ms asc, past.completed_at asc), '[]'::jsonb)
    into v_top_five
    from (
      select session.score, session.elapsed_ms, session.completed_at
      from private.capital_sessions as session
      where session.user_id = v_session.user_id and session.state = 'completed'
        and session.direction = v_session.direction
        and session.pool_signature = v_session.pool_signature
        and session.content_version = v_session.content_version
        and session.rules_version = v_session.rules_version
      order by session.score desc, session.elapsed_ms asc, session.completed_at asc limit 5
    ) as past;
  end if;

  return jsonb_build_object(
    'id', v_session.id, 'direction', v_session.direction, 'poolMode', v_session.pool_mode,
    'region', v_session.region, 'poolSignature', v_session.pool_signature,
    'state', v_session.state, 'createdAt', v_session.created_at, 'completedAt', v_session.completed_at,
    'serverNow', clock_timestamp(), 'elapsedMs', case when v_session.state = 'completed' then v_session.elapsed_ms
      else greatest(0, floor(extract(epoch from (clock_timestamp() - v_session.created_at)) * 1000)::bigint) end,
    'total', v_session.pool_count, 'currentPosition', v_session.current_position,
    'answered', v_finalized, 'score', v_session.score, 'correct', v_session.correct_count,
    'incorrect', v_session.incorrect_count, 'skipped', v_session.skipped_count,
    'current', v_current_json, 'entries', v_entries, 'vocabulary', v_session.vocabulary,
    'finalBadge', v_session.final_badge, 'topFive', v_top_five,
    'selectedCodes', to_jsonb(v_session.selected_codes), 'rulesVersion', v_session.rules_version
  );
end;
$function$;

create or replace function public.arena_capitals_setup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_countries jsonb;
  v_regions jsonb;
  v_active jsonb;
begin
  perform private.rate('capitals_setup', 60);
  select coalesce(jsonb_agg(country - 'capitals' - 'reverseCapital' - 'aliases' - 'sourceLinks'
    order by country ->> 'name', country ->> 'code'), '[]'::jsonb)
    into v_countries from private.capitals_catalog() as country;
  select coalesce(jsonb_agg(region order by region), '[]'::jsonb) into v_regions
  from (select distinct nullif(trim(country.region), '') as region
    from private.countries as country where nullif(trim(country.region), '') is not null) as regions;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', session.id, 'direction', session.direction, 'poolMode', session.pool_mode,
    'region', session.region, 'total', session.pool_count,
    'answered', (select count(*) from private.capital_session_entries as entry
      where entry.session_id = session.id and entry.outcome <> 'pending'),
    'score', session.score, 'createdAt', session.created_at
  ) order by session.created_at desc), '[]'::jsonb)
  into v_active from (
    select active.* from private.capital_sessions as active
    where active.user_id = v_uid and active.state = 'active'
    order by active.created_at desc limit 20
  ) as session;
  return jsonb_build_object('countries', v_countries, 'regions', v_regions, 'activeSessions', v_active);
end;
$function$;

create or replace function public.arena_capitals_start(
  p_direction text, p_pool_mode text, p_selected_codes text[], p_region text, p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_fingerprint text;
  v_existing private.capital_action_requests%rowtype;
  v_session_id uuid;
  v_selected text[];
  v_country jsonb;
  v_caps jsonb;
  v_selected_capital jsonb;
  v_aliases text[];
  v_codes text[];
  v_source_links jsonb;
  v_prompt text;
  v_position integer := 0;
  v_pool_count integer;
  v_vocabulary jsonb;
  v_ambiguous text[];
  v_pool_signature text;
  v_content_version text;
  v_response jsonb;
begin
  if p_request_id is null or p_direction is null or p_direction not in ('country_to_capital', 'capital_to_country')
    or p_pool_mode is null or p_pool_mode not in ('all', 'easy', 'manual') then raise exception 'INVALID_CAPITALS_SELECTION'; end if;
  v_selected := case when p_pool_mode = 'manual' then coalesce(p_selected_codes, array[]::text[]) else array[]::text[] end;
  if p_pool_mode = 'manual' and (cardinality(v_selected) = 0 or cardinality(v_selected) <> cardinality(array(select distinct code from unnest(v_selected) as items(code)))) then
    raise exception 'INVALID_CAPITALS_SELECTION';
  end if;
  if p_region is not null and not exists(select 1 from private.countries as country where nullif(trim(country.region), '') = p_region) then
    raise exception 'UNKNOWN_CAPITALS_REGION';
  end if;
  if p_pool_mode = 'manual' and exists(select 1 from unnest(v_selected) as selection(code)
      where not exists(select 1 from private.countries as country where country.code = selection.code)) then
    raise exception 'UNKNOWN_CAPITALS_COUNTRY';
  end if;
  v_fingerprint := md5(jsonb_build_array(p_direction, p_pool_mode, v_selected, p_region, 1)::text);
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || p_request_id::text, 0));
  select * into v_existing from private.capital_action_requests as request
    where request.user_id = v_uid and request.request_id = p_request_id;
  if found then
    if v_existing.operation <> 'start' or v_existing.fingerprint <> v_fingerprint then raise exception 'CAPITALS_REQUEST_ID_REUSED'; end if;
    return v_existing.response;
  end if;
  perform private.rate('capitals_start', 12);

  select count(*)::integer into v_pool_count
  from private.capitals_catalog() as country
  where (p_region is null or country ->> 'region' = p_region)
    and (p_pool_mode <> 'easy' or country ->> 'difficulty' in ('easy', 'medium'))
    and (p_pool_mode <> 'manual' or country ->> 'code' = any(v_selected))
    and case when p_direction = 'country_to_capital' then (country ->> 'countryToCapitalEligible')::boolean
      else (country ->> 'capitalToCountryEligible')::boolean end;
  if v_pool_count = 0 then raise exception 'EMPTY_CAPITALS_POOL'; end if;

  select coalesce(array_agg(normalized order by normalized), array[]::text[]) into v_ambiguous
  from (
    select private.capitals_normalize(alias.name) as normalized
    from private.countries as country
    cross join lateral (
      select country.name as name union all select country.name_official
      union all select unnest(coalesce(country.name_alternates, array[]::text[]))
      union all select unnest(private.capitals_json_names(country.name_translations))
      union all select unnest(private.capitals_json_names(country.name_native))
      union all select case when country.catalog_kind = 'iso_alpha2' then country.code end
      union all select case when country.catalog_kind = 'iso_alpha2' then country.code_alpha3 end
    ) as alias
    where length(trim(coalesce(alias.name, ''))) > 0
    group by private.capitals_normalize(alias.name)
    having count(distinct country.code) > 1
  ) as collisions;

  select coalesce(jsonb_agg(jsonb_build_object('id', md5(item.normalized), 'label', item.label) order by item.normalized, item.label collate "C"), '[]'::jsonb)
    into v_vocabulary
  from (
    select normalized, min(label) as label
    from (
    select private.capitals_normalize(vocab.label) as normalized, trim(vocab.label) as label
    from private.capitals_catalog() as country
    cross join lateral jsonb_array_elements(case when jsonb_typeof(country -> 'capitals') = 'array'
      then country -> 'capitals' else '[]'::jsonb end) as capital(item)
    cross join lateral (select capital.item ->> 'name' as label) as vocab
    where p_direction = 'country_to_capital'
      and (p_region is null or country ->> 'region' = p_region)
      and (p_pool_mode <> 'easy' or country ->> 'difficulty' in ('easy', 'medium'))
      and (p_pool_mode <> 'manual' or country ->> 'code' = any(v_selected))
      and (country ->> 'countryToCapitalEligible')::boolean
      and length(trim(coalesce(vocab.label, ''))) > 0
    union all
    select private.capitals_normalize(alias.name) as normalized, trim(alias.name) as label
    from private.capitals_catalog() as country
    cross join lateral jsonb_array_elements_text(country -> 'aliases') as alias(name)
    where p_direction = 'capital_to_country'
      and (p_region is null or country ->> 'region' = p_region)
      and (p_pool_mode <> 'easy' or country ->> 'difficulty' in ('easy', 'medium'))
      and (p_pool_mode <> 'manual' or country ->> 'code' = any(v_selected))
      and (country ->> 'capitalToCountryEligible')::boolean
    union all
    select private.capitals_normalize(code_value) as normalized, code_value as label
    from private.capitals_catalog() as country
    cross join lateral jsonb_array_elements_text(jsonb_build_array(country ->> 'codeAlpha2', country ->> 'codeAlpha3')) as codes(code_value)
    where p_direction = 'capital_to_country'
      and country ->> 'catalogKind' = 'iso_alpha2'
      and code_value is not null
      and (p_region is null or country ->> 'region' = p_region)
      and (p_pool_mode <> 'easy' or country ->> 'difficulty' in ('easy', 'medium'))
      and (p_pool_mode <> 'manual' or country ->> 'code' = any(v_selected))
      and (country ->> 'capitalToCountryEligible')::boolean
  ) as candidates
  where normalized <> ''
  group by normalized
  ) as item;

  select md5(p_direction || ':rules-1:' || coalesce(string_agg(country ->> 'code', '|' order by country ->> 'code'), ''))
    into v_pool_signature
  from private.capitals_catalog() as country
  where (p_region is null or country ->> 'region' = p_region)
    and (p_pool_mode <> 'easy' or country ->> 'difficulty' in ('easy', 'medium'))
    and (p_pool_mode <> 'manual' or country ->> 'code' = any(v_selected))
    and case when p_direction = 'country_to_capital' then (country ->> 'countryToCapitalEligible')::boolean
      else (country ->> 'capitalToCountryEligible')::boolean end;
  select md5(coalesce(string_agg(
      (country ->> 'code') || ':' || md5(jsonb_build_array(
        country ->> 'name', country ->> 'officialName', country -> 'aliases',
        country ->> 'region', country ->> 'catalogKind', country ->> 'codeAlpha2',
        country ->> 'codeAlpha3',
        case when p_direction = 'country_to_capital' then country -> 'capitals' else country -> 'reverseCapital' end
      )::text), '|' order by country ->> 'code'), ''))
    into v_content_version
  from private.capitals_catalog() as country
  where (p_region is null or country ->> 'region' = p_region)
    and (p_pool_mode <> 'easy' or country ->> 'difficulty' in ('easy', 'medium'))
    and (p_pool_mode <> 'manual' or country ->> 'code' = any(v_selected))
    and case when p_direction = 'country_to_capital' then (country ->> 'countryToCapitalEligible')::boolean
      else (country ->> 'capitalToCountryEligible')::boolean end;

  insert into private.capital_sessions(user_id, direction, pool_mode, selected_codes, region,
    pool_signature, content_version, pool_count, vocabulary, ambiguous_country_aliases)
  values(v_uid, p_direction, p_pool_mode, v_selected, p_region, v_pool_signature, v_content_version,
    v_pool_count, v_vocabulary, v_ambiguous)
  returning id into v_session_id;

  for v_country in
    select country from private.capitals_catalog() as country
    where (p_region is null or country ->> 'region' = p_region)
      and (p_pool_mode <> 'easy' or country ->> 'difficulty' in ('easy', 'medium'))
      and (p_pool_mode <> 'manual' or country ->> 'code' = any(v_selected))
      and case when p_direction = 'country_to_capital' then (country ->> 'countryToCapitalEligible')::boolean
        else (country ->> 'capitalToCountryEligible')::boolean end
    order by random()
  loop
    v_position := v_position + 1;
    v_caps := case when p_direction = 'country_to_capital' then v_country -> 'capitals'
      else jsonb_build_array(v_country -> 'reverseCapital') end;
    v_selected_capital := case when p_direction = 'capital_to_country' then v_country -> 'reverseCapital' end;
    v_aliases := array(select jsonb_array_elements_text(v_country -> 'aliases'));
    v_codes := case when v_country ->> 'catalogKind' = 'iso_alpha2'
      then array_remove(array[v_country ->> 'codeAlpha2', v_country ->> 'codeAlpha3'], null) else array[]::text[] end;
    v_source_links := coalesce(v_country -> 'sourceLinks', '[]'::jsonb);
    v_prompt := case when p_direction = 'country_to_capital'
      then 'Name a capital of ' || (v_country ->> 'name') || '.'
      else v_selected_capital ->> 'name' end;
    insert into private.capital_session_entries(session_id, country_code, position, country_name,
      region, catalog_kind, alpha2, alpha3, prompt, capitals, selected_capital,
      country_aliases, country_codes, source_links)
    values(v_session_id, v_country ->> 'code', v_position, v_country ->> 'name',
      v_country ->> 'region', v_country ->> 'catalogKind', v_country ->> 'codeAlpha2',
      v_country ->> 'codeAlpha3', v_prompt, v_caps, v_selected_capital ->> 'name',
      v_aliases, v_codes, v_source_links);
  end loop;

  v_response := private.capitals_view(v_session_id);
  insert into private.capital_action_requests(user_id, request_id, operation, fingerprint, session_id, response)
  values(v_uid, p_request_id, 'start', v_fingerprint, v_session_id, v_response);
  return v_response;
end;
$function$;

create or replace function public.arena_capitals_view(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.require_user();
  perform private.rate('capitals_view', 180);
  return private.capitals_view(p_session_id);
end;
$function$;

create or replace function public.arena_capitals_answer(
  p_session_id uuid, p_entry_id uuid, p_answer text, p_candidate_id text, p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session private.capital_sessions%rowtype;
  v_entry private.capital_session_entries%rowtype;
  v_request private.capital_action_requests%rowtype;
  v_norm text;
  v_fingerprint text;
  v_response jsonb;
  v_correct boolean;
  v_ambiguous boolean := false;
begin
  if p_request_id is null or p_answer is null or length(p_answer) > 200 then raise exception 'INVALID_CAPITALS_ANSWER'; end if;
  v_norm := private.capitals_normalize(p_answer);
  if v_norm = '' then raise exception 'EMPTY_CAPITALS_ANSWER'; end if;
  if p_candidate_id is not null and p_candidate_id <> md5(v_norm) then raise exception 'INVALID_CAPITALS_CANDIDATE'; end if;
  v_fingerprint := md5(jsonb_build_array('answer', p_session_id, p_entry_id, p_answer, p_candidate_id)::text);
  perform private.rate('capitals_answer', 180);
  select * into v_session from private.capital_sessions as session
    where session.id = p_session_id and session.user_id = v_uid for update;
  if not found then raise exception 'CAPITAL_SESSION_NOT_FOUND'; end if;
  select * into v_request from private.capital_action_requests as request
    where request.user_id = v_uid and request.request_id = p_request_id;
  if found then
    if v_request.operation <> 'answer' or v_request.fingerprint <> v_fingerprint then raise exception 'CAPITALS_REQUEST_ID_REUSED'; end if;
    return v_request.response;
  end if;
  if v_session.state <> 'active' then raise exception 'CAPITALS_SESSION_NOT_ACTIVE'; end if;
  select * into v_entry from private.capital_session_entries as entry
    where entry.session_id = p_session_id and entry.entry_id = p_entry_id
      and entry.position = v_session.current_position for update;
  if not found or v_entry.outcome <> 'pending' then raise exception 'CAPITALS_STALE_QUESTION'; end if;

  if v_session.direction = 'capital_to_country' and v_norm = any(v_session.ambiguous_country_aliases) then
    v_ambiguous := true;
    v_response := jsonb_set(private.capitals_view(p_session_id), '{actionResult}', jsonb_build_object('outcome', 'ambiguous'), true);
  else
    select exists(
      select 1 from jsonb_array_elements(case when v_session.direction = 'country_to_capital'
        then v_entry.capitals else '[]'::jsonb end) as capital(value)
      where private.capitals_normalize(capital.value ->> 'name') = v_norm
    ) or (
      v_session.direction = 'capital_to_country'
      and (v_norm = any(array(select private.capitals_normalize(alias) from unnest(v_entry.country_aliases) as names(alias)))
        or v_norm = any(array(select private.capitals_normalize(code) from unnest(v_entry.country_codes) as codes(code))))
    ) into v_correct;

    update private.capital_session_entries set
      outcome = case when v_correct then 'correct' else 'incorrect' end,
      submitted_answer = trim(regexp_replace(p_answer, '[[:space:]]+', ' ', 'g')),
      points = case when v_correct then 100 else 0 end,
      finalized_at = clock_timestamp(), last_request_id = p_request_id
    where session_id = p_session_id and entry_id = p_entry_id;
    update private.capital_sessions set
      score = score + case when v_correct then 100 else 0 end,
      correct_count = correct_count + case when v_correct then 1 else 0 end,
      incorrect_count = incorrect_count + case when v_correct then 0 else 1 end
    where id = p_session_id;
    v_response := jsonb_set(private.capitals_view(p_session_id), '{actionResult}',
      jsonb_build_object('outcome', case when v_correct then 'correct' else 'incorrect' end), true);
  end if;
  insert into private.capital_action_requests(user_id, request_id, operation, fingerprint, session_id, response)
  values(v_uid, p_request_id, 'answer', v_fingerprint, p_session_id, v_response);
  return v_response;
end;
$function$;

create or replace function public.arena_capitals_skip(p_session_id uuid, p_entry_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session private.capital_sessions%rowtype;
  v_entry private.capital_session_entries%rowtype;
  v_request private.capital_action_requests%rowtype;
  v_fingerprint text := md5(jsonb_build_array('skip', p_session_id, p_entry_id)::text);
  v_response jsonb;
begin
  if p_request_id is null then raise exception 'INVALID_CAPITALS_REQUEST'; end if;
  perform private.rate('capitals_skip', 90);
  select * into v_session from private.capital_sessions as session
    where session.id = p_session_id and session.user_id = v_uid for update;
  if not found then raise exception 'CAPITAL_SESSION_NOT_FOUND'; end if;
  select * into v_request from private.capital_action_requests as request
    where request.user_id = v_uid and request.request_id = p_request_id;
  if found then
    if v_request.operation <> 'skip' or v_request.fingerprint <> v_fingerprint then raise exception 'CAPITALS_REQUEST_ID_REUSED'; end if;
    return v_request.response;
  end if;
  select * into v_entry from private.capital_session_entries as entry
    where entry.session_id = p_session_id and entry.entry_id = p_entry_id
      and entry.position = v_session.current_position for update;
  if v_session.state <> 'active' or not found or v_entry.outcome <> 'pending' then raise exception 'CAPITALS_STALE_QUESTION'; end if;
  update private.capital_session_entries set outcome = 'skipped', points = 0,
    finalized_at = clock_timestamp(), last_request_id = p_request_id
    where session_id = p_session_id and entry_id = p_entry_id;
  update private.capital_sessions set skipped_count = skipped_count + 1 where id = p_session_id;
  v_response := jsonb_set(private.capitals_view(p_session_id), '{actionResult}', '{"outcome":"skipped"}'::jsonb, true);
  insert into private.capital_action_requests(user_id, request_id, operation, fingerprint, session_id, response)
  values(v_uid, p_request_id, 'skip', v_fingerprint, p_session_id, v_response);
  return v_response;
end;
$function$;

create or replace function public.arena_capitals_next(p_session_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session private.capital_sessions%rowtype;
  v_request private.capital_action_requests%rowtype;
  v_entry private.capital_session_entries%rowtype;
  v_fingerprint text := md5(jsonb_build_array('next', p_session_id)::text);
  v_completed_at timestamptz;
  v_previous private.capital_sessions%rowtype;
  v_has_previous boolean;
  v_response jsonb;
begin
  if p_request_id is null then raise exception 'INVALID_CAPITALS_REQUEST'; end if;
  perform private.rate('capitals_next', 120);
  select * into v_session from private.capital_sessions as session
    where session.id = p_session_id and session.user_id = v_uid for update;
  if not found then raise exception 'CAPITAL_SESSION_NOT_FOUND'; end if;
  select * into v_request from private.capital_action_requests as request
    where request.user_id = v_uid and request.request_id = p_request_id;
  if found then
    if v_request.operation <> 'next' or v_request.fingerprint <> v_fingerprint then raise exception 'CAPITALS_REQUEST_ID_REUSED'; end if;
    return v_request.response;
  end if;
  if v_session.state <> 'active' then raise exception 'CAPITALS_SESSION_NOT_ACTIVE'; end if;
  select * into v_entry from private.capital_session_entries as entry
    where entry.session_id = p_session_id and entry.position = v_session.current_position;
  if not found or v_entry.outcome = 'pending' then raise exception 'CAPITALS_QUESTION_NOT_FINALIZED'; end if;
  if v_session.current_position = v_session.pool_count then
    v_completed_at := clock_timestamp();
    perform pg_advisory_xact_lock(hashtextextended(
      v_uid::text || v_session.direction || v_session.pool_signature || v_session.content_version || v_session.rules_version::text, 0
    ));
    select * into v_previous from private.capital_sessions as previous
    where previous.user_id = v_uid and previous.state = 'completed'
      and previous.direction = v_session.direction
      and previous.pool_signature = v_session.pool_signature
      and previous.content_version = v_session.content_version
      and previous.rules_version = v_session.rules_version
    order by previous.score desc, previous.elapsed_ms asc, previous.completed_at asc limit 1;
    v_has_previous := found;
    update private.capital_sessions set state = 'completed', completed_at = v_completed_at,
      elapsed_ms = greatest(0, floor(extract(epoch from (v_completed_at - created_at)) * 1000)::bigint),
      final_badge = case when not v_has_previous then 'first_run'
        when v_session.score > v_previous.score or
          (v_session.score = v_previous.score and
            floor(extract(epoch from (v_completed_at - v_session.created_at)) * 1000)::bigint < v_previous.elapsed_ms)
          then 'new_best' else 'not_best' end
    where id = p_session_id;
  else
    update private.capital_sessions set current_position = current_position + 1 where id = p_session_id;
  end if;
  v_response := private.capitals_view(p_session_id);
  insert into private.capital_action_requests(user_id, request_id, operation, fingerprint, session_id, response)
  values(v_uid, p_request_id, 'next', v_fingerprint, p_session_id, v_response);
  return v_response;
end;
$function$;

create or replace function public.arena_capitals_abandon(p_session_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session private.capital_sessions%rowtype;
  v_request private.capital_action_requests%rowtype;
  v_fingerprint text := md5(jsonb_build_array('abandon', p_session_id)::text);
  v_response jsonb;
begin
  if p_request_id is null then raise exception 'INVALID_CAPITALS_REQUEST'; end if;
  perform private.rate('capitals_abandon', 30);
  select * into v_session from private.capital_sessions as session
    where session.id = p_session_id and session.user_id = v_uid for update;
  if not found then raise exception 'CAPITAL_SESSION_NOT_FOUND'; end if;
  select * into v_request from private.capital_action_requests as request
    where request.user_id = v_uid and request.request_id = p_request_id;
  if found then
    if v_request.operation <> 'abandon' or v_request.fingerprint <> v_fingerprint then raise exception 'CAPITALS_REQUEST_ID_REUSED'; end if;
    return v_request.response;
  end if;
  if v_session.state = 'completed' then raise exception 'CAPITALS_SESSION_COMPLETE'; end if;
  if v_session.state = 'active' then update private.capital_sessions set state = 'abandoned' where id = p_session_id; end if;
  v_response := private.capitals_view(p_session_id);
  insert into private.capital_action_requests(user_id, request_id, operation, fingerprint, session_id, response)
  values(v_uid, p_request_id, 'abandon', v_fingerprint, p_session_id, v_response);
  return v_response;
end;
$function$;

create or replace function public.arena_capitals_results(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_state text;
begin
  perform private.rate('capitals_results', 60);
  select session.state into v_state from private.capital_sessions as session
    where session.id = p_session_id and session.user_id = v_uid;
  if not found then raise exception 'CAPITAL_SESSION_NOT_FOUND'; end if;
  if v_state not in ('completed', 'abandoned') then raise exception 'CAPITALS_ROUND_NOT_COMPLETE'; end if;
  return private.capitals_view(p_session_id);
end;
$function$;

revoke all on function private.capitals_normalize(text), private.capitals_json_names(jsonb),
  private.capitals_catalog(), private.capitals_view(uuid) from public, anon, authenticated;
revoke all on function public.arena_capitals_setup(), public.arena_capitals_start(text,text,text[],text,uuid),
  public.arena_capitals_view(uuid), public.arena_capitals_answer(uuid,uuid,text,text,uuid),
  public.arena_capitals_skip(uuid,uuid,uuid), public.arena_capitals_next(uuid,uuid),
  public.arena_capitals_abandon(uuid,uuid), public.arena_capitals_results(uuid)
  from public, anon, authenticated;
grant execute on function public.arena_capitals_setup(), public.arena_capitals_start(text,text,text[],text,uuid),
  public.arena_capitals_view(uuid), public.arena_capitals_answer(uuid,uuid,text,text,uuid),
  public.arena_capitals_skip(uuid,uuid,uuid), public.arena_capitals_next(uuid,uuid),
  public.arena_capitals_abandon(uuid,uuid), public.arena_capitals_results(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
