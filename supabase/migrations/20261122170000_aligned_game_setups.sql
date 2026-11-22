begin;
-- Flags, Capitals and Recall share one setup:
--   mode · catalog (UN member states / all) · region · pool (all / well-known / pick my own)
--   · length (whole set or 10/25/50 random) · time limit (none or 5/10/15/20 min).
-- Random samples are practice rounds: they never count as personal bests.
-- Timed rounds are ranked separately from untimed ones. Existing bests keep their signatures.

-- ---------------------------------------------------------------------------
-- Columns and constraints
-- ---------------------------------------------------------------------------
alter table private.flags_sessions
  add column if not exists selected_codes text[] not null default '{}',
  add column if not exists sample_size integer,
  add column if not exists time_limit_seconds integer,
  add column if not exists deadline_at timestamptz;
alter table private.flags_sessions drop constraint if exists flags_sessions_pool_tier_check;
alter table private.flags_sessions add constraint flags_sessions_pool_tier_check check (pool_tier in ('easy', 'all', 'manual'));
alter table private.flags_sessions drop constraint if exists flags_sessions_final_badge_check;
alter table private.flags_sessions add constraint flags_sessions_final_badge_check
  check (final_badge in ('first_run', 'new_best', 'not_best', 'unranked'));
alter table private.flags_sessions drop constraint if exists flags_sessions_sample_size_check;
alter table private.flags_sessions add constraint flags_sessions_sample_size_check check (sample_size is null or sample_size in (10, 25, 50));
alter table private.flags_sessions drop constraint if exists flags_sessions_time_limit_check;
alter table private.flags_sessions add constraint flags_sessions_time_limit_check
  check (time_limit_seconds is null or time_limit_seconds in (300, 600, 900, 1200));

alter table private.capital_sessions
  add column if not exists sample_size integer,
  add column if not exists time_limit_seconds integer,
  add column if not exists deadline_at timestamptz;
alter table private.capital_sessions drop constraint if exists capital_sessions_final_badge_check;
alter table private.capital_sessions add constraint capital_sessions_final_badge_check
  check (final_badge in ('first_run', 'new_best', 'not_best', 'unranked'));
alter table private.capital_sessions drop constraint if exists capital_sessions_sample_size_check;
alter table private.capital_sessions add constraint capital_sessions_sample_size_check check (sample_size is null or sample_size in (10, 25, 50));
alter table private.capital_sessions drop constraint if exists capital_sessions_time_limit_check;
alter table private.capital_sessions add constraint capital_sessions_time_limit_check
  check (time_limit_seconds is null or time_limit_seconds in (300, 600, 900, 1200));

alter table private.recall_sessions
  add column if not exists pool text not null default 'all',
  add column if not exists selected_codes text[] not null default '{}';
alter table private.recall_sessions drop constraint if exists recall_sessions_pool_check;
alter table private.recall_sessions add constraint recall_sessions_pool_check check (pool in ('all', 'easy', 'manual'));

create or replace function private.game_pick_codes(p_codes text[])
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select coalesce(array_agg(distinct trim(item.code) order by trim(item.code)), array[]::text[])
  from unnest(coalesce(p_codes, array[]::text[])) as item(code)
  where nullif(trim(item.code), '') is not null;
$function$;

-- ---------------------------------------------------------------------------
-- Flags
-- ---------------------------------------------------------------------------
drop function if exists public.arena_flags_start(text, text, text, uuid, text);
create or replace function public.arena_flags_start(
  p_direction text, p_region text, p_pool_tier text, p_request_id uuid, p_scope text default 'all',
  p_selected_codes text[] default null, p_size integer default null, p_time_limit_seconds integer default null
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
  v_size integer := p_size;
  v_codes text[] := case when p_pool_tier = 'manual' then private.game_pick_codes(p_selected_codes) else array[]::text[] end;
begin
  if p_request_id is null or p_direction is null
    or p_direction not in ('country_to_flag', 'flag_to_country')
    or p_pool_tier is null or p_pool_tier not in ('easy', 'all', 'manual')
    or p_scope is null or p_scope not in ('all', 'un')
    or (p_size is not null and p_size not in (10, 25, 50))
    or (p_time_limit_seconds is not null and p_time_limit_seconds not in (300, 600, 900, 1200))
    or (p_pool_tier = 'manual' and cardinality(v_codes) = 0) then raise exception 'INVALID_FLAGS_SELECTION'; end if;
  v_fingerprint := md5(concat_ws('|', p_direction, coalesce(p_region, ''), p_pool_tier, 'rules-1',
    case when p_scope = 'un' then 'scope-un' end, array_to_string(v_codes, ','),
    'size-' || coalesce(p_size::text, 'all'), 'limit-' || coalesce(p_time_limit_seconds::text, 'none')));

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

  create temporary table if not exists flags_pick on commit drop as select * from private.countries with no data;
  truncate pg_temp.flags_pick;
  insert into pg_temp.flags_pick
  select country.* from private.countries as country
  where (p_region is null
      or (p_region = '__unspecified__' and nullif(trim(country.region), '') is null)
      or country.region = p_region)
    and (p_pool_tier <> 'easy' or country.difficulty in ('easy', 'medium'))
    and (p_pool_tier <> 'manual' or country.code = any(v_codes))
    and (p_scope = 'all' or coalesce(country.membership_un, false))
    and country.difficulty in ('easy', 'medium', 'hard', 'expert')
    and private.flags_has_asset(country.flag_svg_url, country.flag_png_url, country.flag_emoji);
  select count(*)::integer into v_pool_count from pg_temp.flags_pick;
  if v_pool_count = 0 then raise exception 'EMPTY_FLAGS_POOL'; end if;

  -- A sample at least as large as the set is simply the whole set.
  if v_size is not null and v_size >= v_pool_count then v_size := null; end if;
  if v_size is not null then
    delete from pg_temp.flags_pick as pick
    where pick.code not in (select keep.code from pg_temp.flags_pick as keep order by random() limit v_size);
    v_pool_count := v_size;
    v_signature := 'practice:' || gen_random_uuid()::text;
  else
    select md5(concat_ws('|', 'flags', p_direction, p_pool_tier, coalesce(p_region, '__all__'), 'rules-1',
      case when p_scope = 'un' then 'scope-un' end,
      string_agg(country.code || ':' || md5(jsonb_build_array(
        country.name, country.name_official, country.name_alternates,
        country.name_native, country.name_translations, country.catalog_kind,
        country.code_alpha3, country.region, country.difficulty,
        country.flag_svg_url, country.flag_png_url, country.flag_emoji, country.flag
      )::text), '|' order by country.code)))
    into v_signature
    from pg_temp.flags_pick as country;
    if p_time_limit_seconds is not null then v_signature := md5(v_signature || ':limit-' || p_time_limit_seconds); end if;
  end if;

  insert into private.flags_sessions(user_id, direction, region, pool_tier, pool_signature, pool_count, scope,
    selected_codes, sample_size, time_limit_seconds, deadline_at)
  values (v_uid, p_direction, p_region, p_pool_tier, v_signature, v_pool_count, p_scope,
    v_codes, v_size, p_time_limit_seconds,
    case when p_time_limit_seconds is not null then clock_timestamp() + make_interval(secs => p_time_limit_seconds) end)
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
  from pg_temp.flags_pick as candidate;

  insert into private.flags_start_requests(user_id, request_id, request_fingerprint, session_id)
  values (v_uid, p_request_id, v_fingerprint, v_session_id);
  return private.flags_view(v_session_id);
end;
$function$;

create or replace function private.flags_complete(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.flags_sessions%rowtype;
  v_previous private.flags_sessions%rowtype;
  v_elapsed bigint;
  v_badge text;
  v_completed_at timestamptz;
  v_end timestamptz;
begin
  select * into v_session from private.flags_sessions as session
  where session.id = p_session_id for update;
  if not found or v_session.state <> 'active' then return; end if;
  if exists (select 1 from private.flags_session_entries as entry where entry.session_id = v_session.id and entry.outcome = 'pending') then
    raise exception 'FLAGS_ROUND_NOT_FINALIZED';
  end if;
  v_completed_at := clock_timestamp();
  v_end := least(v_completed_at, coalesce(v_session.deadline_at, 'infinity'::timestamptz));
  v_elapsed := greatest(0, floor(extract(epoch from (v_end - v_session.created_at)) * 1000)::bigint - v_session.paused_total_ms);
  if v_session.sample_size is not null then
    v_badge := 'unranked';
  else
    select * into v_previous from private.flags_sessions as prior
    where prior.user_id = v_session.user_id and prior.state = 'completed' and prior.sample_size is null
      and prior.direction = v_session.direction and prior.pool_signature = v_session.pool_signature
      and prior.rules_version = v_session.rules_version
    order by prior.score desc, prior.elapsed_ms asc, prior.completed_at asc limit 1;
    if not found then v_badge := 'first_run';
    elsif v_session.score > v_previous.score or (v_session.score = v_previous.score and v_elapsed < v_previous.elapsed_ms) then v_badge := 'new_best';
    else v_badge := 'not_best'; end if;
  end if;
  update private.flags_sessions set state = 'completed', completed_at = v_completed_at,
    elapsed_ms = v_elapsed, final_badge = v_badge where id = v_session.id;
end;
$function$;

-- Ends a timed round whose time is up: open entries count as skipped. Returns true when the round ended on time.
create or replace function private.flags_expire(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.flags_sessions%rowtype;
  v_skipped integer;
begin
  select * into v_session from private.flags_sessions as session
  where session.id = p_session_id and session.user_id = auth.uid() for update;
  if not found or v_session.deadline_at is null or v_session.deadline_at > clock_timestamp() then return false; end if;
  if v_session.state in ('active', 'paused') then
    if v_session.state = 'paused' then
      update private.flags_sessions set state = 'active',
        paused_total_ms = paused_total_ms + greatest(0, floor(extract(epoch from (clock_timestamp() - paused_at)) * 1000)::bigint),
        paused_at = null
      where id = p_session_id;
    end if;
    with skipped as (
      update private.flags_session_entries set outcome = 'skipped', points = 0, finalized_at = clock_timestamp()
      where session_id = p_session_id and outcome = 'pending' returning 1
    ) select count(*)::integer into v_skipped from skipped;
    update private.flags_sessions set skipped_count = skipped_count + v_skipped, current_position = pool_count
      where id = p_session_id;
    perform private.flags_complete(p_session_id);
  end if;
  return (select session.state = 'completed' from private.flags_sessions as session where session.id = p_session_id);
end;
$function$;

create or replace function private.flags_view(p_session_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $function$
  select private.flags_view_core(p_session_id) || (
    select jsonb_build_object('scope', session.scope, 'timeLimitSeconds', session.time_limit_seconds,
      'deadlineAt', session.deadline_at, 'sampleSize', session.sample_size,
      'selectedCount', cardinality(session.selected_codes), 'selectedCodes', to_jsonb(session.selected_codes),
      'ranked', session.sample_size is null)
    from private.flags_sessions as session where session.id = p_session_id);
$function$;

-- Every round action first ends the round if its time is up.
alter function public.arena_flags_answer(uuid, uuid, uuid, text, uuid) set schema private;
alter function private.arena_flags_answer(uuid, uuid, uuid, text, uuid) rename to flags_answer_core;
alter function public.arena_flags_skip(uuid, uuid, uuid) set schema private;
alter function private.arena_flags_skip(uuid, uuid, uuid) rename to flags_skip_core;
alter function public.arena_flags_hint(uuid, uuid, uuid) set schema private;
alter function private.arena_flags_hint(uuid, uuid, uuid) rename to flags_hint_core;
alter function public.arena_flags_next(uuid, uuid) set schema private;
alter function private.arena_flags_next(uuid, uuid) rename to flags_next_core;
alter function public.arena_flags_resume(uuid, uuid) set schema private;
alter function private.arena_flags_resume(uuid, uuid) rename to flags_resume_core;
alter function public.arena_flags_pause(uuid, uuid) set schema private;
alter function private.arena_flags_pause(uuid, uuid) rename to flags_pause_core;

create or replace function public.arena_flags_answer(p_session_id uuid, p_entry_id uuid, p_choice_id uuid, p_answer text, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  perform private.require_user();
  if private.flags_expire(p_session_id) then return private.flags_view(p_session_id) || '{"timeUp": true}'::jsonb; end if;
  return private.flags_answer_core(p_session_id, p_entry_id, p_choice_id, p_answer, p_request_id);
end;
$function$;
create or replace function public.arena_flags_skip(p_session_id uuid, p_entry_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  perform private.require_user();
  if private.flags_expire(p_session_id) then return private.flags_view(p_session_id) || '{"timeUp": true}'::jsonb; end if;
  return private.flags_skip_core(p_session_id, p_entry_id, p_request_id);
end;
$function$;
create or replace function public.arena_flags_hint(p_session_id uuid, p_entry_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  perform private.require_user();
  if private.flags_expire(p_session_id) then return private.flags_view(p_session_id) || '{"timeUp": true}'::jsonb; end if;
  return private.flags_hint_core(p_session_id, p_entry_id, p_request_id);
end;
$function$;
create or replace function public.arena_flags_next(p_session_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  perform private.require_user();
  if private.flags_expire(p_session_id) then return private.flags_view(p_session_id) || '{"timeUp": true}'::jsonb; end if;
  return private.flags_next_core(p_session_id, p_request_id);
end;
$function$;
create or replace function public.arena_flags_resume(p_session_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  perform private.require_user();
  if private.flags_expire(p_session_id) then return private.flags_view(p_session_id) || '{"timeUp": true}'::jsonb; end if;
  return private.flags_resume_core(p_session_id, p_request_id);
end;
$function$;
create or replace function public.arena_flags_pause(p_session_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  perform private.require_user();
  if exists (select 1 from private.flags_sessions as session
      where session.id = p_session_id and session.user_id = auth.uid() and session.time_limit_seconds is not null) then
    raise exception 'FLAGS_TIMED_NO_PAUSE';
  end if;
  return private.flags_pause_core(p_session_id, p_request_id);
end;
$function$;
create or replace function public.arena_flags_view(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  perform private.require_user();
  perform private.rate('flags_view', 180);
  perform private.flags_expire(p_session_id);
  return private.flags_view(p_session_id);
end;
$function$;
create or replace function public.arena_flags_results(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session private.flags_sessions%rowtype;
begin
  perform private.rate('flags_results', 60);
  perform private.flags_expire(p_session_id);
  select * into v_session from private.flags_sessions as session
  where session.id = p_session_id and session.user_id = v_uid;
  if not found then raise exception 'FLAGS_SESSION_NOT_FOUND'; end if;
  if v_session.state not in ('completed', 'abandoned') then raise exception 'FLAGS_ROUND_NOT_COMPLETE'; end if;
  return private.flags_view(p_session_id);
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
  v_countries jsonb;
begin
  perform private.rate('flags_setup', 60);
  perform private.flags_expire(session.id) from private.flags_sessions as session
    where session.user_id = v_uid and session.state in ('active', 'paused') and session.deadline_at <= clock_timestamp();

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

  -- Every playable flag, so the app can count any combination and offer "Pick my own".
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', country.code, 'name', country.name,
    'region', coalesce(nullif(trim(country.region), ''), '__unspecified__'),
    'un', coalesce(country.membership_un, false),
    'easy', country.difficulty in ('easy', 'medium'),
    'alpha2', case when country.catalog_kind = 'iso_alpha2' and country.code ~ '^[A-Z]{2}$' then country.code end
  ) order by country.name collate "C", country.code), '[]'::jsonb) into v_countries
  from private.countries as country
  where country.difficulty in ('easy', 'medium', 'hard', 'expert')
    and private.flags_has_asset(country.flag_svg_url, country.flag_png_url, country.flag_emoji);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', session.id, 'direction', session.direction, 'region', session.region,
    'poolTier', session.pool_tier, 'scope', session.scope, 'total', session.pool_count,
    'selectedCount', cardinality(session.selected_codes), 'sampleSize', session.sample_size,
    'timeLimitSeconds', session.time_limit_seconds, 'deadlineAt', session.deadline_at,
    'answered', (select count(*) from private.flags_session_entries as entry where entry.session_id = session.id and entry.outcome <> 'pending'),
    'score', session.score, 'createdAt', session.created_at, 'paused', session.state = 'paused'
  ) order by session.created_at desc), '[]'::jsonb) into v_active
  from (
    select active.* from private.flags_sessions as active
    where active.user_id = v_uid and active.state in ('active','paused')
    order by active.created_at desc limit 10
  ) as session;
  return jsonb_build_object('regions', v_regions, 'summary', v_summary, 'countries', v_countries,
    'activeSessions', v_active, 'rulesVersion', 1, 'competitiveXp', false);
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
    select session.direction, session.region, session.pool_tier, session.scope, session.time_limit_seconds,
      cardinality(session.selected_codes) as selected_count, session.rules_version,
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
    where session.user_id = v_uid and session.state = 'completed' and session.sample_size is null
  ), boards as (
    select distinct direction, region, pool_tier, scope, time_limit_seconds, selected_count, rules_version, pool_signature, pool_count, run_count,
      max(completed_at) over (partition by direction, region, pool_tier, scope, rules_version, pool_signature) as latest_at
    from ranked
  ), versioned_boards as (
    select boards.*,
      row_number() over (partition by direction, region, pool_tier, scope, time_limit_seconds, rules_version order by latest_at desc, pool_signature) as pool_version
    from boards
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'direction', board.direction, 'region', board.region, 'poolTier', board.pool_tier, 'scope', board.scope,
      'timeLimitSeconds', board.time_limit_seconds, 'selectedCount', board.selected_count,
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
-- Capitals
-- ---------------------------------------------------------------------------
drop function if exists public.arena_capitals_start(text, text, text[], text, uuid, text);
create or replace function public.arena_capitals_start(
  p_direction text, p_pool_mode text, p_selected_codes text[], p_region text, p_request_id uuid,
  p_scope text default 'all', p_size integer default null, p_time_limit_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_response jsonb;
  v_session_id uuid;
  v_session private.capital_sessions%rowtype;
  v_untouched boolean;
begin
  if p_scope is null or p_scope not in ('all', 'un')
    or (p_size is not null and p_size not in (10, 25, 50))
    or (p_time_limit_seconds is not null and p_time_limit_seconds not in (300, 600, 900, 1200)) then
    raise exception 'INVALID_CAPITALS_SELECTION';
  end if;
  perform set_config('atlas.capitals_scope', p_scope, true);
  v_response := private.capitals_start_core(p_direction, p_pool_mode,
    case when p_pool_mode = 'manual' then private.game_pick_codes(p_selected_codes) else p_selected_codes end,
    p_region, p_request_id);
  perform set_config('atlas.capitals_scope', '', true);
  v_session_id := (v_response ->> 'id')::uuid;

  select * into v_session from private.capital_sessions as session
    where session.id = v_session_id and session.user_id = v_uid for update;
  v_untouched := v_session.state = 'active' and not exists (
    select 1 from private.capital_session_entries as entry where entry.session_id = v_session_id and entry.outcome <> 'pending');
  if v_untouched then
    if v_session.scope <> p_scope then
      update private.capital_sessions set scope = p_scope where id = v_session_id;
    end if;
    if p_size is not null and v_session.sample_size is null and p_size < v_session.pool_count then
      delete from private.capital_session_entries where session_id = v_session_id and position > p_size;
      update private.capital_sessions set sample_size = p_size, pool_count = p_size,
        pool_signature = 'practice:' || v_session_id::text
      where id = v_session_id;
    end if;
    if p_time_limit_seconds is not null and v_session.time_limit_seconds is null then
      update private.capital_sessions set time_limit_seconds = p_time_limit_seconds,
        deadline_at = created_at + make_interval(secs => p_time_limit_seconds),
        pool_signature = case when sample_size is null then md5(pool_signature || ':limit-' || p_time_limit_seconds) else pool_signature end
      where id = v_session_id;
    end if;
  end if;
  return private.capitals_view(v_session_id);
end;
$function$;

-- After a round ends: practice rounds are unranked, timed rounds never count more than their limit.
create or replace function private.capitals_settle(p_session_id uuid)
returns void
language sql
security definer
set search_path = ''
as $function$
  update private.capital_sessions set
    final_badge = case when sample_size is not null then 'unranked' else final_badge end,
    elapsed_ms = case when time_limit_seconds is not null then least(elapsed_ms, time_limit_seconds * 1000::bigint) else elapsed_ms end
  where id = p_session_id and state = 'completed'
    and ((sample_size is not null and final_badge <> 'unranked')
      or (time_limit_seconds is not null and elapsed_ms > time_limit_seconds * 1000::bigint));
$function$;

create or replace function private.capitals_expire(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.capital_sessions%rowtype;
  v_previous private.capital_sessions%rowtype;
  v_has_previous boolean;
  v_skipped integer;
  v_elapsed bigint;
begin
  select * into v_session from private.capital_sessions as session
  where session.id = p_session_id and session.user_id = auth.uid() for update;
  if not found or v_session.deadline_at is null or v_session.deadline_at > clock_timestamp() then return false; end if;
  if v_session.state = 'active' then
    with skipped as (
      update private.capital_session_entries set outcome = 'skipped', points = 0, finalized_at = clock_timestamp()
      where session_id = p_session_id and outcome = 'pending' returning 1
    ) select count(*)::integer into v_skipped from skipped;
    v_elapsed := greatest(0, floor(extract(epoch from (v_session.deadline_at - v_session.created_at)) * 1000)::bigint);
    select * into v_previous from private.capital_sessions as previous
    where previous.user_id = v_session.user_id and previous.state = 'completed'
      and previous.direction = v_session.direction and previous.pool_signature = v_session.pool_signature
      and previous.content_version = v_session.content_version and previous.rules_version = v_session.rules_version
    order by previous.score desc, previous.elapsed_ms asc, previous.completed_at asc limit 1;
    v_has_previous := found;
    update private.capital_sessions set skipped_count = skipped_count + v_skipped, current_position = pool_count,
      state = 'completed', completed_at = clock_timestamp(), elapsed_ms = v_elapsed,
      final_badge = case
        when v_session.sample_size is not null then 'unranked'
        when not v_has_previous then 'first_run'
        when v_session.score > v_previous.score or (v_session.score = v_previous.score and v_elapsed < v_previous.elapsed_ms) then 'new_best'
        else 'not_best' end
    where id = p_session_id;
  end if;
  return (select session.state = 'completed' from private.capital_sessions as session where session.id = p_session_id);
end;
$function$;

create or replace function private.capitals_view(p_session_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $function$
  select private.capitals_view_core(p_session_id) || (
    select jsonb_build_object('scope', session.scope, 'timeLimitSeconds', session.time_limit_seconds,
      'deadlineAt', session.deadline_at, 'sampleSize', session.sample_size, 'ranked', session.sample_size is null)
    from private.capital_sessions as session where session.id = p_session_id);
$function$;

alter function public.arena_capitals_answer(uuid, uuid, text, text, uuid) set schema private;
alter function private.arena_capitals_answer(uuid, uuid, text, text, uuid) rename to capitals_answer_core;
alter function public.arena_capitals_skip(uuid, uuid, uuid) set schema private;
alter function private.arena_capitals_skip(uuid, uuid, uuid) rename to capitals_skip_core;
alter function public.arena_capitals_next(uuid, uuid) set schema private;
alter function private.arena_capitals_next(uuid, uuid) rename to capitals_next_core;

create or replace function public.arena_capitals_answer(p_session_id uuid, p_entry_id uuid, p_answer text, p_candidate_id text, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  perform private.require_user();
  if private.capitals_expire(p_session_id) then return private.capitals_view(p_session_id) || '{"timeUp": true}'::jsonb; end if;
  return private.capitals_answer_core(p_session_id, p_entry_id, p_answer, p_candidate_id, p_request_id);
end;
$function$;
create or replace function public.arena_capitals_skip(p_session_id uuid, p_entry_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  perform private.require_user();
  if private.capitals_expire(p_session_id) then return private.capitals_view(p_session_id) || '{"timeUp": true}'::jsonb; end if;
  return private.capitals_skip_core(p_session_id, p_entry_id, p_request_id);
end;
$function$;
create or replace function public.arena_capitals_next(p_session_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_response jsonb;
begin
  perform private.require_user();
  if private.capitals_expire(p_session_id) then return private.capitals_view(p_session_id) || '{"timeUp": true}'::jsonb; end if;
  v_response := private.capitals_next_core(p_session_id, p_request_id);
  if v_response ->> 'state' = 'completed' then
    perform private.capitals_settle(p_session_id);
    return private.capitals_view(p_session_id);
  end if;
  return v_response;
end;
$function$;
create or replace function public.arena_capitals_view(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  perform private.require_user();
  perform private.rate('capitals_view', 180);
  perform private.capitals_expire(p_session_id);
  return private.capitals_view(p_session_id);
end;
$function$;
create or replace function public.arena_capitals_results(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_state text;
begin
  perform private.rate('capitals_results', 60);
  perform private.capitals_expire(p_session_id);
  select session.state into v_state from private.capital_sessions as session
    where session.id = p_session_id and session.user_id = v_uid;
  if not found then raise exception 'CAPITAL_SESSION_NOT_FOUND'; end if;
  if v_state not in ('completed', 'abandoned') then raise exception 'CAPITALS_ROUND_NOT_COMPLETE'; end if;
  return private.capitals_view(p_session_id);
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
  perform private.capitals_expire(session.id) from private.capital_sessions as session
    where session.user_id = v_uid and session.state = 'active' and session.deadline_at <= clock_timestamp();
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
    'region', session.region, 'total', session.pool_count, 'selectedCount', cardinality(session.selected_codes),
    'sampleSize', session.sample_size, 'timeLimitSeconds', session.time_limit_seconds, 'deadlineAt', session.deadline_at,
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
        'timeLimitSeconds', ranked.time_limit_seconds,
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
        where session.user_id = v_uid and session.state = 'completed' and session.sample_size is null
      ) as ranked
      where ranked.rank_in_setup = 1
      order by ranked.completed_at desc
      limit 20
    ) as bests
  ), '[]'::jsonb);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Recall: well-known and pick-my-own sets; a sample at least as large as the set is the whole set.
-- ---------------------------------------------------------------------------
drop function if exists public.arena_recall_start(text, text, text, integer, integer, uuid);
create or replace function public.arena_recall_start(
  p_kind text, p_scope text, p_region text, p_size integer, p_time_limit_seconds integer, p_request_id uuid,
  p_pool text default 'all', p_selected_codes text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_existing uuid;
  v_session_id uuid := gen_random_uuid();
  v_salt text := replace(gen_random_uuid()::text, '-', '');
  v_total integer;
  v_active integer;
  v_size integer := p_size;
  v_codes text[] := case when p_pool = 'manual' then private.game_pick_codes(p_selected_codes) else array[]::text[] end;
begin
  if p_request_id is null or p_kind is null or p_kind not in ('countries', 'capitals')
    or p_scope is null or p_scope not in ('un', 'all')
    or p_pool is null or p_pool not in ('all', 'easy', 'manual')
    or (p_pool = 'manual' and cardinality(v_codes) = 0)
    or (p_size is not null and p_size not in (10, 25, 50))
    or (p_time_limit_seconds is not null and p_time_limit_seconds not in (300, 600, 900, 1200)) then
    raise exception 'INVALID_RECALL_SELECTION';
  end if;
  if p_region is not null and not exists(select 1 from private.countries as country where nullif(trim(country.region), '') = p_region) then
    raise exception 'UNKNOWN_RECALL_REGION';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || p_request_id::text, 0));
  select session.id into v_existing from private.recall_sessions as session
    where session.user_id = v_uid and session.start_request_id = p_request_id;
  if found then return private.recall_view(v_existing); end if;
  perform private.rate('recall_start', 12);
  select count(*) into v_active from private.recall_sessions as session where session.user_id = v_uid and session.state = 'active';
  if v_active >= 10 then raise exception 'TOO_MANY_ACTIVE_RECALL_ROUNDS'; end if;

  create temporary table if not exists recall_pool (
    position integer, code text, alpha2 text, region text, country_name text, answer_name text, names jsonb
  ) on commit drop;
  truncate pg_temp.recall_pool;
  insert into pg_temp.recall_pool
  select row_number() over (order by
      case when p_kind = 'countries' then picked.region end nulls last,
      picked.name collate "C", picked.code collate "C")::integer,
    picked.code, picked.alpha2, picked.region, picked.name,
    case when p_kind = 'countries' then picked.name else picked.capital_display end,
    case when p_kind = 'countries' then picked.country_names else picked.capital_names end
  from (
    select catalog.* from private.recall_catalog() as catalog
    where (p_scope = 'all' or catalog.un)
      and (p_region is null or catalog.region = p_region)
      and (p_pool <> 'easy' or exists (select 1 from private.countries as country
        where country.code = catalog.code and country.difficulty in ('easy', 'medium')))
      and (p_pool <> 'manual' or catalog.code = any(v_codes))
      and (case when p_kind = 'countries' then jsonb_array_length(catalog.country_names) else jsonb_array_length(catalog.capital_names) end) > 0
  ) as picked;
  select count(*) into v_total from pg_temp.recall_pool;
  if v_total = 0 then raise exception 'EMPTY_RECALL_POOL'; end if;
  if v_size is not null and v_size >= v_total then v_size := null; end if;
  if v_size is not null then
    delete from pg_temp.recall_pool as pool
      where pool.position not in (select keep.position from pg_temp.recall_pool as keep order by random() limit v_size);
    update pg_temp.recall_pool as pool set position = renumbered.rn
      from (select keep.position as old_position, row_number() over (order by keep.position)::integer as rn
        from pg_temp.recall_pool as keep) as renumbered
      where pool.position = renumbered.old_position;
    v_total := v_size;
  end if;

  insert into private.recall_sessions(id, user_id, start_request_id, kind, scope, region, set_size,
    time_limit_seconds, pool_signature, salt, total, deadline_at, pool, selected_codes)
  values (v_session_id, v_uid, p_request_id, p_kind, p_scope, p_region, v_size, p_time_limit_seconds,
    case when v_size is null then
      case when p_pool = 'all' then md5(jsonb_build_array(p_kind, p_scope, p_region, p_time_limit_seconds, 1)::text)
        else md5(jsonb_build_array(p_kind, p_scope, p_region, p_time_limit_seconds, 1, p_pool, v_codes)::text) end
    end,
    v_salt, v_total,
    case when p_time_limit_seconds is not null then clock_timestamp() + make_interval(secs => p_time_limit_seconds) end,
    p_pool, v_codes);

  with raw as (
    select pool.position, private.recall_normalize(item.value ->> 'name') as k,
      item.value ->> 'lang' as lang, coalesce((item.value ->> 'primary')::boolean, false) as is_primary
    from pg_temp.recall_pool as pool cross join jsonb_array_elements(pool.names) as item(value)
  ), alias as (
    select raw.position, raw.k,
      (array_agg(raw.lang order by case raw.lang when 'en' then 1 when 'de' then 2 else 3 end))[1] as lang,
      bool_or(raw.is_primary) as is_primary
    from raw where raw.k <> '' group by raw.position, raw.k
  ), owners as (
    select alias.k, count(*) as owner_count, bool_or(alias.is_primary) as any_primary from alias group by alias.k
  ), kept as (
    -- A spelling shared by several entries only counts for the entries whose main name it is.
    select alias.* from alias join owners on owners.k = alias.k
    where owners.owner_count = 1 or alias.is_primary
  ), ambiguous as (
    update private.recall_sessions set ambiguous_hashes = coalesce((
      select array_agg(private.recall_hash(v_salt, owners.k) order by owners.k)
      from owners where owners.owner_count > 1 and not owners.any_primary), '{}')
    where id = v_session_id
    returning 1
  ), keyed as (
    select kept.position, kept.k, kept.lang, private.recall_hash(v_salt, kept.k) as h,
      coalesce((select array_agg(distinct other.position order by other.position) from kept as other
        where other.position <> kept.position and other.k <> kept.k and starts_with(other.k, kept.k)), '{}') as extended_by
    from kept
  )
  insert into private.recall_session_entries(session_id, position, country_code, alpha2, region, country_name,
    answer_name, alias_keys, alias_hashes, alias_langs)
  select v_session_id, pool.position, pool.code, pool.alpha2, pool.region, pool.country_name, pool.answer_name,
    jsonb_agg(jsonb_build_object('h', keyed.h, 'l', keyed.lang, 'x', to_jsonb(keyed.extended_by)) order by keyed.k),
    array_agg(keyed.h order by keyed.k), array_agg(keyed.lang order by keyed.k)
  from pg_temp.recall_pool as pool join keyed on keyed.position = pool.position
  where exists (select 1 from ambiguous)
  group by pool.position, pool.code, pool.alpha2, pool.region, pool.country_name, pool.answer_name;

  -- Every entry must still be answerable after ambiguity filtering.
  if (select count(*) from private.recall_session_entries as entry where entry.session_id = v_session_id) <> v_total then
    raise exception 'RECALL_POOL_HAS_UNANSWERABLE_ENTRY';
  end if;
  return private.recall_view(v_session_id);
end;
$function$;

create or replace function private.recall_view(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', session.id, 'kind', session.kind, 'scope', session.scope, 'region', session.region,
    'size', session.set_size, 'timeLimitSeconds', session.time_limit_seconds,
    'pool', session.pool, 'selectedCount', cardinality(session.selected_codes), 'selectedCodes', to_jsonb(session.selected_codes),
    'state', session.state, 'endReason', session.end_reason, 'badge', session.badge,
    'total', session.total, 'found', session.found_count,
    'createdAt', session.created_at, 'deadlineAt', session.deadline_at, 'serverNow', clock_timestamp(),
    'completedAt', session.completed_at, 'elapsedMs', session.elapsed_ms,
    'ranked', session.pool_signature is not null,
    'best', private.recall_best(session.user_id, session.pool_signature,
      case when session.state = 'completed' then session.id end),
    'salt', case when session.state = 'active' then session.salt end,
    'ambiguous', case when session.state = 'active' then to_jsonb(session.ambiguous_hashes) else '[]'::jsonb end,
    'entries', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'position', entry.position,
        'region', entry.region,
        -- Capitals rounds show the country as the clue; countries rounds hide it until found.
        'prompt', case when session.kind = 'capitals' then entry.country_name end,
        'alpha2', case when session.kind = 'capitals' or entry.found_at is not null or session.state <> 'active' then entry.alpha2 end,
        'name', case when entry.found_at is not null or session.state <> 'active' then entry.answer_name end,
        'found', entry.found_at is not null,
        'foundAt', entry.found_at,
        'matched', entry.matched_text,
        'lang', entry.matched_lang,
        'keys', case when session.state = 'active' and entry.found_at is null then entry.alias_keys end
      ) order by entry.position), '[]'::jsonb)
      from private.recall_session_entries as entry where entry.session_id = session.id
    )
  )
  from private.recall_sessions as session
  where session.id = p_session_id;
$function$;

create or replace function public.arena_recall_setup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
begin
  perform private.rate('recall_setup', 60);
  perform private.recall_expire(session.id) from private.recall_sessions as session
    where session.user_id = v_uid and session.state = 'active' and session.deadline_at <= clock_timestamp();
  return jsonb_build_object(
    'catalog', (select coalesce(jsonb_agg(jsonb_build_object(
        'code', catalog.code, 'name', catalog.name, 'alpha2', catalog.alpha2, 'region', catalog.region, 'un', catalog.un,
        'easy', country.difficulty in ('easy', 'medium'),
        'hasCapital', jsonb_array_length(catalog.capital_names) > 0
      ) order by catalog.code), '[]'::jsonb)
      from private.recall_catalog() as catalog join private.countries as country on country.code = catalog.code),
    'activeSessions', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', session.id, 'kind', session.kind, 'scope', session.scope, 'region', session.region,
        'size', session.set_size, 'timeLimitSeconds', session.time_limit_seconds,
        'pool', session.pool, 'selectedCount', cardinality(session.selected_codes),
        'total', session.total, 'found', session.found_count,
        'createdAt', session.created_at, 'deadlineAt', session.deadline_at
      ) order by session.created_at desc), '[]'::jsonb)
      from (select * from private.recall_sessions as active where active.user_id = v_uid and active.state = 'active'
        order by active.created_at desc limit 10) as session),
    'bests', (select coalesce(jsonb_agg(bests.best order by bests.best ->> 'kind', bests.best ->> 'region' nulls first), '[]'::jsonb) from (
        select distinct on (session.pool_signature) jsonb_build_object(
          'kind', session.kind, 'scope', session.scope, 'region', session.region,
          'pool', session.pool, 'selectedCount', cardinality(session.selected_codes),
          'timeLimitSeconds', session.time_limit_seconds, 'found', session.found_count,
          'total', session.total, 'elapsedMs', session.elapsed_ms, 'completedAt', session.completed_at) as best
        from private.recall_sessions as session
        where session.user_id = v_uid and session.state = 'completed' and session.pool_signature is not null
        order by session.pool_signature, session.found_count desc, session.elapsed_ms asc
      ) as bests),
    'recalled', jsonb_build_object(
      'countries', (select coalesce(jsonb_agg(distinct entry.country_code), '[]'::jsonb)
        from private.recall_session_entries as entry join private.recall_sessions as session on session.id = entry.session_id
        where session.user_id = v_uid and session.kind = 'countries' and entry.found_at is not null),
      'capitals', (select coalesce(jsonb_agg(distinct entry.country_code), '[]'::jsonb)
        from private.recall_session_entries as entry join private.recall_sessions as session on session.id = entry.session_id
        where session.user_id = v_uid and session.kind = 'capitals' and entry.found_at is not null))
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- One list of personal bests for every game, and per-game totals for the statistics.
-- ---------------------------------------------------------------------------
create or replace function public.arena_personal_bests()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
begin
  perform private.rate('personal_bests', 60);
  return coalesce((
    select jsonb_agg(item.best order by item.best ->> 'completedAt' desc)
    from (
      select jsonb_build_object('game', 'flags', 'mode', r.direction, 'scope', r.scope, 'region', r.region,
        'pool', r.pool_tier, 'selectedCodes', to_jsonb(r.selected_codes), 'timeLimitSeconds', r.time_limit_seconds,
        'total', r.pool_count, 'correct', r.correct_count, 'score', r.score,
        'maxScore', r.pool_count * 100 - case when r.direction = 'flag_to_country' then r.hints_used * 40 else 0 end,
        'elapsedMs', r.elapsed_ms, 'completedAt', r.completed_at, 'runCount', r.runs) as best
      from (
        select session.*,
          row_number() over w_order as rn, count(*) over w_setup as runs
        from private.flags_sessions as session
        where session.user_id = v_uid and session.state = 'completed' and session.sample_size is null
        window w_setup as (partition by session.direction, session.region, session.pool_tier, session.scope,
            session.time_limit_seconds, session.selected_codes),
          w_order as (partition by session.direction, session.region, session.pool_tier, session.scope,
            session.time_limit_seconds, session.selected_codes
            order by session.score desc, session.elapsed_ms asc, session.completed_at asc)
      ) as r where r.rn = 1
      union all
      select jsonb_build_object('game', 'capitals', 'mode', r.direction, 'scope', r.scope, 'region', r.region,
        'pool', r.pool_mode, 'selectedCodes', to_jsonb(r.selected_codes), 'timeLimitSeconds', r.time_limit_seconds,
        'total', r.pool_count, 'correct', r.correct_count, 'score', r.score, 'maxScore', r.pool_count * 100,
        'elapsedMs', r.elapsed_ms, 'completedAt', r.completed_at, 'runCount', r.runs)
      from (
        select session.*,
          row_number() over w_order as rn, count(*) over w_setup as runs
        from private.capital_sessions as session
        where session.user_id = v_uid and session.state = 'completed' and session.sample_size is null
        window w_setup as (partition by session.direction, session.region, session.pool_mode, session.scope,
            session.time_limit_seconds, session.selected_codes),
          w_order as (partition by session.direction, session.region, session.pool_mode, session.scope,
            session.time_limit_seconds, session.selected_codes
            order by session.score desc, session.elapsed_ms asc, session.completed_at asc)
      ) as r where r.rn = 1
      union all
      select jsonb_build_object('game', 'recall', 'mode', r.kind, 'scope', r.scope, 'region', r.region,
        'pool', r.pool, 'selectedCodes', to_jsonb(r.selected_codes), 'timeLimitSeconds', r.time_limit_seconds,
        'total', r.total, 'correct', r.found_count, 'score', r.found_count, 'maxScore', r.total,
        'elapsedMs', r.elapsed_ms, 'completedAt', r.completed_at, 'runCount', r.runs)
      from (
        select session.*,
          row_number() over (partition by session.pool_signature
            order by session.found_count desc, session.elapsed_ms asc, session.completed_at asc) as rn,
          count(*) over (partition by session.pool_signature) as runs
        from private.recall_sessions as session
        where session.user_id = v_uid and session.state = 'completed' and session.pool_signature is not null
      ) as r where r.rn = 1
    ) as item
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.arena_game_stats()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
begin
  perform private.rate('game_stats', 60);
  return jsonb_build_object(
    'flags', (select jsonb_build_object('rounds', count(*), 'correct', coalesce(sum(s.correct_count), 0),
        'answered', coalesce(sum(s.correct_count + s.incorrect_count + s.skipped_count), 0),
        'timeMs', coalesce(sum(s.elapsed_ms), 0), 'lastPlayedAt', max(s.completed_at),
        'places', (select count(distinct e.country_code) from private.flags_session_entries as e
          join private.flags_sessions as f on f.id = e.session_id where f.user_id = v_uid and e.outcome = 'correct'))
      from private.flags_sessions as s where s.user_id = v_uid and s.state = 'completed'),
    'capitals', (select jsonb_build_object('rounds', count(*), 'correct', coalesce(sum(s.correct_count), 0),
        'answered', coalesce(sum(s.correct_count + s.incorrect_count + s.skipped_count), 0),
        'timeMs', coalesce(sum(s.elapsed_ms), 0), 'lastPlayedAt', max(s.completed_at),
        'places', (select count(distinct e.country_code) from private.capital_session_entries as e
          join private.capital_sessions as c on c.id = e.session_id where c.user_id = v_uid and e.outcome = 'correct'))
      from private.capital_sessions as s where s.user_id = v_uid and s.state = 'completed'),
    'recall', (select jsonb_build_object('rounds', count(*), 'correct', coalesce(sum(s.found_count), 0),
        'answered', coalesce(sum(s.total), 0),
        'timeMs', coalesce(sum(s.elapsed_ms), 0), 'lastPlayedAt', max(s.completed_at),
        'places', (select count(distinct e.country_code) from private.recall_session_entries as e
          join private.recall_sessions as r on r.id = e.session_id where r.user_id = v_uid and e.found_at is not null))
      from private.recall_sessions as s where s.user_id = v_uid and s.state = 'completed')
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function private.game_pick_codes(text[]), private.flags_complete(uuid), private.flags_expire(uuid),
  private.flags_view(uuid), private.flags_answer_core(uuid, uuid, uuid, text, uuid), private.flags_skip_core(uuid, uuid, uuid),
  private.flags_hint_core(uuid, uuid, uuid), private.flags_next_core(uuid, uuid), private.flags_resume_core(uuid, uuid),
  private.flags_pause_core(uuid, uuid), private.capitals_settle(uuid), private.capitals_expire(uuid), private.capitals_view(uuid),
  private.capitals_answer_core(uuid, uuid, text, text, uuid), private.capitals_skip_core(uuid, uuid, uuid),
  private.capitals_next_core(uuid, uuid), private.recall_view(uuid)
  from public, anon, authenticated;
revoke all on function
  public.arena_flags_start(text, text, text, uuid, text, text[], integer, integer),
  public.arena_flags_answer(uuid, uuid, uuid, text, uuid), public.arena_flags_skip(uuid, uuid, uuid),
  public.arena_flags_hint(uuid, uuid, uuid), public.arena_flags_next(uuid, uuid), public.arena_flags_resume(uuid, uuid),
  public.arena_flags_pause(uuid, uuid), public.arena_flags_view(uuid), public.arena_flags_results(uuid),
  public.arena_flags_setup(), public.arena_flags_bests(),
  public.arena_capitals_start(text, text, text[], text, uuid, text, integer, integer),
  public.arena_capitals_answer(uuid, uuid, text, text, uuid), public.arena_capitals_skip(uuid, uuid, uuid),
  public.arena_capitals_next(uuid, uuid), public.arena_capitals_view(uuid), public.arena_capitals_results(uuid),
  public.arena_capitals_setup(), public.arena_capitals_bests(),
  public.arena_recall_start(text, text, text, integer, integer, uuid, text, text[]), public.arena_recall_setup(),
  public.arena_personal_bests(), public.arena_game_stats()
  from public, anon;
grant execute on function
  public.arena_flags_start(text, text, text, uuid, text, text[], integer, integer),
  public.arena_flags_answer(uuid, uuid, uuid, text, uuid), public.arena_flags_skip(uuid, uuid, uuid),
  public.arena_flags_hint(uuid, uuid, uuid), public.arena_flags_next(uuid, uuid), public.arena_flags_resume(uuid, uuid),
  public.arena_flags_pause(uuid, uuid), public.arena_flags_view(uuid), public.arena_flags_results(uuid),
  public.arena_flags_setup(), public.arena_flags_bests(),
  public.arena_capitals_start(text, text, text[], text, uuid, text, integer, integer),
  public.arena_capitals_answer(uuid, uuid, text, text, uuid), public.arena_capitals_skip(uuid, uuid, uuid),
  public.arena_capitals_next(uuid, uuid), public.arena_capitals_view(uuid), public.arena_capitals_results(uuid),
  public.arena_capitals_setup(), public.arena_capitals_bests(),
  public.arena_recall_start(text, text, text, integer, integer, uuid, text, text[]), public.arena_recall_setup(),
  public.arena_personal_bests(), public.arena_game_stats()
  to authenticated;

notify pgrst, 'reload schema';
commit;
