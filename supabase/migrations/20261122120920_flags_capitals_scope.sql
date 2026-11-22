-- Flags and Capitals: choose "UN member states" or "All countries & territories".
-- UN-only rounds drop territories that share a parent's flag (Réunion, Guadeloupe …).
-- Existing rounds and personal bests stay valid as scope 'all'.
begin;

alter table private.flags_sessions add column if not exists scope text not null default 'all';
alter table private.capital_sessions add column if not exists scope text not null default 'all';
do $$ begin
  alter table private.flags_sessions add constraint flags_sessions_scope_check check (scope in ('all', 'un'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table private.capital_sessions add constraint capital_sessions_scope_check check (scope in ('all', 'un'));
exception when duplicate_object then null; end $$;

-- Views gain the scope field: the original bodies are kept as *_core and wrapped.
alter function private.flags_view(uuid) rename to flags_view_core;
create or replace function private.flags_view(p_session_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $function$
  select private.flags_view_core(p_session_id)
    || jsonb_build_object('scope', (select session.scope from private.flags_sessions as session where session.id = p_session_id));
$function$;
alter function private.capitals_view(uuid) rename to capitals_view_core;
create or replace function private.capitals_view(p_session_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $function$
  select private.capitals_view_core(p_session_id)
    || jsonb_build_object('scope', (select session.scope from private.capital_sessions as session where session.id = p_session_id));
$function$;

-- ---------------------------------------------------------------------------
-- Flags
-- ---------------------------------------------------------------------------
drop function if exists public.arena_flags_start(text, text, text, uuid);
create or replace function public.arena_flags_start(
  p_direction text, p_region text, p_pool_tier text, p_request_id uuid, p_scope text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_fingerprint text;
  v_existing private.flags_start_requests%rowtype;
  v_session_id uuid;
  v_signature text;
  v_pool_count integer;
begin
  if p_request_id is null or p_direction is null
    or p_direction not in ('country_to_flag', 'flag_to_country')
    or p_pool_tier is null or p_pool_tier not in ('easy', 'all')
    or p_scope is null or p_scope not in ('all', 'un') then raise exception 'INVALID_FLAGS_SELECTION'; end if;
  v_fingerprint := md5(concat_ws('|', p_direction, coalesce(p_region, ''), p_pool_tier, 'rules-1',
    case when p_scope = 'un' then 'scope-un' end));

  select * into v_existing from private.flags_start_requests as request
  where request.user_id = v_uid and request.request_id = p_request_id;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then raise exception 'FLAGS_REQUEST_ID_REUSED'; end if;
    return private.flags_view(v_existing.session_id);
  end if;

  perform private.rate('flags_start', 12);
  if p_region is not null and p_region <> '__unspecified__' and not exists (
    select 1 from private.countries as country where country.region = p_region
  ) then raise exception 'UNKNOWN_FLAGS_REGION'; end if;

  select count(*)::integer into v_pool_count
  from private.countries as country
  where (p_region is null
      or (p_region = '__unspecified__' and nullif(trim(country.region), '') is null)
      or country.region = p_region)
    and (p_pool_tier = 'all' or country.difficulty in ('easy', 'medium'))
    and (p_scope = 'all' or coalesce(country.membership_un, false))
    and country.difficulty in ('easy', 'medium', 'hard', 'expert')
    and private.flags_has_asset(country.flag_svg_url, country.flag_png_url, country.flag_emoji);
  if v_pool_count = 0 then raise exception 'EMPTY_FLAGS_POOL'; end if;

  select md5(concat_ws('|', 'flags', p_direction, p_pool_tier, coalesce(p_region, '__all__'), 'rules-1',
    case when p_scope = 'un' then 'scope-un' end,
    string_agg(country.code || ':' || md5(jsonb_build_array(
      country.name, country.name_official, country.name_alternates,
      country.name_native, country.name_translations, country.catalog_kind,
      country.code_alpha3, country.region, country.difficulty,
      country.flag_svg_url, country.flag_png_url, country.flag_emoji, country.flag
    )::text), '|' order by country.code)))
  into v_signature
  from private.countries as country
  where (p_region is null
      or (p_region = '__unspecified__' and nullif(trim(country.region), '') is null)
      or country.region = p_region)
    and (p_pool_tier = 'all' or country.difficulty in ('easy', 'medium'))
    and (p_scope = 'all' or coalesce(country.membership_un, false))
    and country.difficulty in ('easy', 'medium', 'hard', 'expert')
    and private.flags_has_asset(country.flag_svg_url, country.flag_png_url, country.flag_emoji);

  insert into private.flags_sessions(user_id, direction, region, pool_tier, pool_signature, pool_count, scope)
  values (v_uid, p_direction, p_region, p_pool_tier, v_signature, v_pool_count, p_scope)
  returning id into v_session_id;

  insert into private.flags_session_entries(
    session_id, country_code, position, choice_position, catalog_kind, alpha2, alpha3,
    name, official_name, region, difficulty, flag_svg_url, flag_png_url, flag_emoji,
    flag_description, content_version, aliases
  )
  select v_session_id,
    candidate.code,
    row_number() over (order by random())::integer,
    row_number() over (order by random())::integer,
    candidate.catalog_kind,
    case when candidate.catalog_kind = 'iso_alpha2' and candidate.code ~ '^[A-Z]{2}$' then candidate.code end,
    case when candidate.catalog_kind = 'iso_alpha2' and candidate.code_alpha3 ~ '^[A-Z]{3}$' then candidate.code_alpha3 end,
    candidate.name,
    candidate.name_official,
    coalesce(nullif(trim(candidate.region), ''), 'Unspecified region'),
    candidate.difficulty,
    case when candidate.flag_svg_url ~* '^https://([a-z0-9-]+[.])*flags[.]restcountries[.]com/' then candidate.flag_svg_url end,
    case when candidate.flag_png_url ~* '^https://([a-z0-9-]+[.])*flags[.]restcountries[.]com/' then candidate.flag_png_url end,
    nullif(trim(candidate.flag_emoji), ''),
    nullif(trim(candidate.flag), ''),
    md5(jsonb_build_array(candidate.name, candidate.name_official, candidate.name_alternates,
      candidate.name_native, candidate.name_translations, candidate.catalog_kind,
      candidate.code_alpha3, candidate.region, candidate.difficulty,
      candidate.flag_svg_url, candidate.flag_png_url, candidate.flag_emoji, candidate.flag)::text),
    array(
      select distinct private.flags_normalize(alias_item.value)
      from (
        select candidate.name as value
        union all select candidate.name_official
        union all select unnest(coalesce(candidate.name_alternates, array[]::text[]))
        union all select case when candidate.catalog_kind = 'iso_alpha2' and candidate.code ~ '^[A-Z]{2}$' then candidate.code end
        union all select case when candidate.catalog_kind = 'iso_alpha2' and candidate.code_alpha3 ~ '^[A-Z]{3}$' then candidate.code_alpha3 end
        union all select translation.value ->> 'common'
          from jsonb_each(case when jsonb_typeof(candidate.name_translations) = 'object' then candidate.name_translations else '{}'::jsonb end) as translation(key, value)
        union all select native_name.value ->> 'common'
          from jsonb_each(case when jsonb_typeof(candidate.name_native) = 'object' then candidate.name_native else '{}'::jsonb end) as native_name(key, value)
      ) as alias_item
      where nullif(private.flags_normalize(alias_item.value), '') is not null
    )
  from private.countries as candidate
  where (p_region is null
      or (p_region = '__unspecified__' and nullif(trim(candidate.region), '') is null)
      or candidate.region = p_region)
    and (p_pool_tier = 'all' or candidate.difficulty in ('easy', 'medium'))
    and (p_scope = 'all' or coalesce(candidate.membership_un, false))
    and candidate.difficulty in ('easy', 'medium', 'hard', 'expert')
    and private.flags_has_asset(candidate.flag_svg_url, candidate.flag_png_url, candidate.flag_emoji);

  insert into private.flags_start_requests(user_id, request_id, request_fingerprint, session_id)
  values (v_uid, p_request_id, v_fingerprint, v_session_id);
  return private.flags_view(v_session_id);
end;
$function$;

create or replace function public.arena_flags_setup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_regions jsonb;
  v_active jsonb;
  v_summary jsonb;
begin
  perform private.rate('flags_setup', 60);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', region_counts.region_id, 'name', region_counts.region_name,
    'easyCount', region_counts.easy_count, 'allCount', region_counts.all_count,
    'unEasyCount', region_counts.un_easy_count, 'unAllCount', region_counts.un_all_count,
    'easyMissingAssets', region_counts.easy_missing_assets, 'allMissingAssets', region_counts.all_missing_assets,
    'easyTierExcluded', region_counts.easy_tier_excluded, 'unsupportedDifficulty', region_counts.unsupported_difficulty
  ) order by region_counts.region_name), '[]'::jsonb) into v_regions
  from (
    select coalesce(nullif(trim(country.region), ''), '__unspecified__') as region_id,
      coalesce(nullif(trim(country.region), ''), 'Unspecified region') as region_name,
      count(*) filter (where country.difficulty in ('easy','medium') and private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)) as easy_count,
      count(*) filter (where country.difficulty in ('easy','medium','hard','expert') and private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)) as all_count,
      count(*) filter (where coalesce(country.membership_un, false) and country.difficulty in ('easy','medium') and private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)) as un_easy_count,
      count(*) filter (where coalesce(country.membership_un, false) and country.difficulty in ('easy','medium','hard','expert') and private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)) as un_all_count,
      count(*) filter (where country.difficulty in ('easy','medium') and not private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)) as easy_missing_assets,
      count(*) filter (where country.difficulty in ('easy','medium','hard','expert') and not private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)) as all_missing_assets,
      count(*) filter (where country.difficulty in ('hard','expert') and private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)) as easy_tier_excluded,
      count(*) filter (where country.difficulty not in ('easy','medium','hard','expert')) as unsupported_difficulty
    from private.countries as country group by 1,2
  ) as region_counts;

  select jsonb_build_object(
    'easyCount', count(*) filter (where country.difficulty in ('easy','medium') and private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)),
    'allCount', count(*) filter (where country.difficulty in ('easy','medium','hard','expert') and private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)),
    'unEasyCount', count(*) filter (where coalesce(country.membership_un, false) and country.difficulty in ('easy','medium') and private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)),
    'unAllCount', count(*) filter (where coalesce(country.membership_un, false) and country.difficulty in ('easy','medium','hard','expert') and private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)),
    'easyMissingAssets', count(*) filter (where country.difficulty in ('easy','medium') and not private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)),
    'allMissingAssets', count(*) filter (where country.difficulty in ('easy','medium','hard','expert') and not private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)),
    'easyTierExcluded', count(*) filter (where country.difficulty in ('hard','expert') and private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)),
    'unsupportedDifficulty', count(*) filter (where country.difficulty not in ('easy','medium','hard','expert'))
  ) into v_summary from private.countries as country;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', session.id, 'direction', session.direction, 'region', session.region,
    'poolTier', session.pool_tier, 'scope', session.scope, 'total', session.pool_count,
    'answered', (select count(*) from private.flags_session_entries as entry where entry.session_id = session.id and entry.outcome <> 'pending'),
    'score', session.score, 'createdAt', session.created_at, 'paused', session.state = 'paused'
  ) order by session.created_at desc), '[]'::jsonb) into v_active
  from (
    select active.* from private.flags_sessions as active
    where active.user_id = v_uid and active.state in ('active','paused')
    order by active.created_at desc limit 10
  ) as session;
  return jsonb_build_object('regions',v_regions,'summary',v_summary,'activeSessions',v_active,'rulesVersion',1,'competitiveXp',false);
end;
$function$;

create or replace function public.arena_flags_bests()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_result jsonb;
begin
  perform private.rate('flags_bests', 30);
  with ranked as (
    select session.direction, session.region, session.pool_tier, session.scope, session.rules_version,
      session.pool_signature, session.pool_count, session.score, session.elapsed_ms, session.correct_count,
      session.incorrect_count, session.skipped_count, session.hints_used, session.completed_at,
      row_number() over (
        partition by session.direction, session.region, session.pool_tier, session.scope, session.rules_version, session.pool_signature
        order by session.score desc, session.elapsed_ms asc, session.completed_at asc
      ) as run_rank,
      count(*) over (
        partition by session.direction, session.region, session.pool_tier, session.scope, session.rules_version, session.pool_signature
      ) as run_count
    from private.flags_sessions as session
    where session.user_id = v_uid and session.state = 'completed'
  ), boards as (
    select distinct direction, region, pool_tier, scope, rules_version, pool_signature, pool_count, run_count,
      max(completed_at) over (partition by direction, region, pool_tier, scope, rules_version, pool_signature) as latest_at
    from ranked
  ), versioned_boards as (
    select boards.*,
      row_number() over (partition by direction, region, pool_tier, scope, rules_version order by latest_at desc, pool_signature) as pool_version
    from boards
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'direction', board.direction, 'region', board.region, 'poolTier', board.pool_tier, 'scope', board.scope,
      'poolVersion', board.pool_version, 'total', board.pool_count, 'runCount', board.run_count,
      'topFive', coalesce((
        select jsonb_agg(jsonb_build_object(
          'score', run.score,
          'maxScore', board.pool_count * 100 - case when board.direction = 'flag_to_country' then run.hints_used * 40 else 0 end,
          'elapsedMs', run.elapsed_ms, 'correct', run.correct_count, 'incorrect', run.incorrect_count,
          'skipped', run.skipped_count, 'hintsUsed', run.hints_used, 'completedAt', run.completed_at
        ) order by run.run_rank)
        from ranked as run
        where run.direction = board.direction and run.region is not distinct from board.region
          and run.pool_tier = board.pool_tier and run.scope = board.scope and run.rules_version = board.rules_version
          and run.pool_signature = board.pool_signature and run.run_rank <= 5
      ), '[]'::jsonb)
    ) order by board.direction, board.region nulls first, board.pool_tier, board.scope, board.pool_version
  ), '[]'::jsonb)
  into v_result
  from versioned_boards as board;
  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Capitals: the catalog honours a per-request scope setting, so the existing
-- start logic (kept as private.capitals_start_core) only sees UN members.
-- ---------------------------------------------------------------------------
create or replace function private.capitals_catalog()
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with scoped as (
    select country.* from private.countries as country
    where coalesce(current_setting('atlas.capitals_scope', true), '') <> 'un' or coalesce(country.membership_un, false)
  ), valid_capitals as (
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
    from scoped as country
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
    from scoped as country
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
    'un', coalesce(country.membership_un, false),
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
  from scoped as country
  left join grouped_capitals on grouped_capitals.code = country.code
  left join aliases on aliases.code = country.code
  left join reverse_capital_ranked as reverse_capital
    on reverse_capital.code = country.code and reverse_capital.country_rank = 1
  order by country.name collate "C", country.code collate "C";
$function$;

alter function public.arena_capitals_start(text, text, text[], text, uuid) set schema private;
alter function private.arena_capitals_start(text, text, text[], text, uuid) rename to capitals_start_core;
revoke all on function private.capitals_start_core(text, text, text[], text, uuid) from public, anon, authenticated;

create or replace function public.arena_capitals_start(
  p_direction text, p_pool_mode text, p_selected_codes text[], p_region text, p_request_id uuid, p_scope text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_response jsonb;
  v_session_id uuid;
begin
  if p_scope is null or p_scope not in ('all', 'un') then raise exception 'INVALID_CAPITALS_SELECTION'; end if;
  perform set_config('atlas.capitals_scope', p_scope, true);
  v_response := private.capitals_start_core(p_direction, p_pool_mode, p_selected_codes, p_region, p_request_id);
  perform set_config('atlas.capitals_scope', '', true);
  v_session_id := (v_response ->> 'id')::uuid;
  update private.capital_sessions set scope = p_scope
    where id = v_session_id and user_id = private.require_user() and scope <> p_scope;
  return private.capitals_view(v_session_id);
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
  v_un_reverse text[];
begin
  perform private.rate('capitals_setup', 60);
  perform set_config('atlas.capitals_scope', 'un', true);
  select coalesce(array_agg(country ->> 'code'), array[]::text[]) into v_un_reverse
    from private.capitals_catalog() as country where (country ->> 'capitalToCountryEligible')::boolean;
  perform set_config('atlas.capitals_scope', '', true);
  select coalesce(jsonb_agg((country - 'capitals' - 'reverseCapital' - 'aliases' - 'sourceLinks')
      || jsonb_build_object('unCapitalToCountryEligible', (country ->> 'code') = any(v_un_reverse))
    order by country ->> 'name', country ->> 'code'), '[]'::jsonb)
    into v_countries from private.capitals_catalog() as country;
  select coalesce(jsonb_agg(region order by region), '[]'::jsonb) into v_regions
  from (select distinct nullif(trim(country.region), '') as region
    from private.countries as country where nullif(trim(country.region), '') is not null) as regions;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', session.id, 'direction', session.direction, 'poolMode', session.pool_mode, 'scope', session.scope,
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

create or replace function public.arena_capitals_bests()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
begin
  perform private.rate('capitals_bests', 60);
  return coalesce((
    select jsonb_agg(best order by best ->> 'completedAt' desc)
    from (
      select jsonb_build_object(
        'direction', ranked.direction, 'poolMode', ranked.pool_mode, 'region', ranked.region, 'scope', ranked.scope,
        'selectedCount', cardinality(ranked.selected_codes), 'total', ranked.pool_count,
        'score', ranked.score, 'maxScore', ranked.pool_count * 100, 'correct', ranked.correct_count,
        'elapsedMs', ranked.elapsed_ms, 'completedAt', ranked.completed_at, 'runCount', ranked.run_count
      ) as best
      from (
        select session.*,
          row_number() over (partition by session.direction, session.scope, session.pool_signature
            order by session.score desc, session.elapsed_ms asc, session.completed_at asc) as rank_in_setup,
          count(*) over (partition by session.direction, session.scope, session.pool_signature) as run_count
        from private.capital_sessions as session
        where session.user_id = v_uid and session.state = 'completed'
      ) as ranked
      where ranked.rank_in_setup = 1
      order by ranked.completed_at desc
      limit 20
    ) as bests
  ), '[]'::jsonb);
end;
$function$;

revoke all on function private.flags_view(uuid), private.flags_view_core(uuid), private.capitals_view(uuid),
  private.capitals_view_core(uuid) from public, anon, authenticated;
revoke all on function public.arena_flags_start(text, text, text, uuid, text), public.arena_capitals_start(text, text, text[], text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.arena_flags_start(text, text, text, uuid, text), public.arena_capitals_start(text, text, text[], text, uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
