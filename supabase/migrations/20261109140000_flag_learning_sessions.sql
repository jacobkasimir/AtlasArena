begin;

create extension if not exists unaccent with schema extensions;

create table if not exists private.flags_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('country_to_flag', 'flag_to_country')),
  region text,
  pool_tier text not null check (pool_tier in ('easy', 'all')),
  rules_version integer not null default 1 check (rules_version = 1),
  pool_signature text not null,
  pool_count integer not null check (pool_count > 0),
  current_position integer not null default 1 check (current_position > 0),
  state text not null default 'active'
    check (state in ('active', 'completed', 'abandoned')),
  score integer not null default 0 check (score >= 0),
  correct_count integer not null default 0 check (correct_count >= 0),
  incorrect_count integer not null default 0 check (incorrect_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  hints_used integer not null default 0 check (hints_used >= 0),
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

create index if not exists flags_sessions_user_active
  on private.flags_sessions (user_id, created_at desc)
  where state = 'active';
create index if not exists flags_sessions_comparable
  on private.flags_sessions (user_id, pool_signature, score desc, elapsed_ms asc)
  where state = 'completed';

create table if not exists private.flags_session_entries (
  session_id uuid not null references private.flags_sessions(id) on delete cascade,
  entry_id uuid not null default gen_random_uuid(),
  country_code text not null,
  position integer not null check (position > 0),
  choice_position integer not null check (choice_position > 0),
  catalog_kind text not null check (catalog_kind in ('iso_alpha2', 'non_iso')),
  alpha2 text,
  alpha3 text,
  name text not null,
  official_name text,
  region text not null,
  difficulty text not null,
  flag_svg_url text,
  flag_png_url text,
  flag_emoji text,
  flag_description text,
  content_version text not null,
  aliases text[] not null default '{}',
  outcome text not null default 'pending'
    check (outcome in ('pending', 'correct', 'incorrect', 'skipped')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  wrong_choice_ids uuid[] not null default '{}',
  hint_used boolean not null default false,
  points integer not null default 0 check (points in (0, 30, 60, 100)),
  finalized_at timestamptz,
  primary key (session_id, entry_id),
  unique (session_id, country_code),
  unique (session_id, position),
  unique (session_id, choice_position),
  check (alpha2 is null or alpha2 ~ '^[A-Z]{2}$'),
  check (catalog_kind <> 'non_iso' or alpha2 is null),
  check (alpha3 is null or alpha3 ~ '^[A-Z]{3}$'),
  check (
    (outcome = 'pending' and finalized_at is null and points = 0)
    or (outcome <> 'pending' and finalized_at is not null)
  )
);

create table if not exists private.flags_start_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  request_fingerprint text not null,
  session_id uuid not null references private.flags_sessions(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, request_id)
);

create table if not exists private.flags_action_requests (
  session_id uuid not null references private.flags_sessions(id) on delete cascade,
  request_id uuid not null,
  request_fingerprint text not null,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (session_id, request_id)
);

alter table private.flags_sessions enable row level security;
alter table private.flags_session_entries enable row level security;
alter table private.flags_start_requests enable row level security;
alter table private.flags_action_requests enable row level security;
revoke all on private.flags_sessions, private.flags_session_entries,
  private.flags_start_requests, private.flags_action_requests
  from public, anon, authenticated;

create or replace function private.flags_normalize(p_text text)
returns text
language sql
stable
set search_path = extensions, pg_catalog
as $function$
  select lower(trim(regexp_replace(unaccent(coalesce(p_text, '')), '[[:space:]]+', ' ', 'g')));
$function$;

create or replace function private.flags_has_asset(
  p_svg text,
  p_png text,
  p_emoji text
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(p_svg ~* '^https://([a-z0-9-]+[.])*flags[.]restcountries[.]com/'
    or p_png ~* '^https://([a-z0-9-]+[.])*flags[.]restcountries[.]com/'
    or length(trim(coalesce(p_emoji, ''))) > 0, false);
$function$;

create or replace function private.flags_view(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.flags_sessions%rowtype;
  v_current private.flags_session_entries%rowtype;
  v_choices jsonb := '[]'::jsonb;
  v_entries jsonb := '[]'::jsonb;
  v_top_five jsonb := '[]'::jsonb;
  v_finalized integer := 0;
  v_current_json jsonb;
begin
  select * into v_session
  from private.flags_sessions as session
  where session.id = p_session_id
    and session.user_id = auth.uid();
  if not found then raise exception 'FLAGS_SESSION_NOT_FOUND'; end if;

  select count(*)::integer into v_finalized
  from private.flags_session_entries as entry
  where entry.session_id = v_session.id and entry.outcome <> 'pending';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', entry.entry_id,
    'choicePosition', entry.choice_position,
    'flagSvgUrl', entry.flag_svg_url,
    'flagPngUrl', entry.flag_png_url,
    'flagEmoji', entry.flag_emoji,
    'flagDescription', entry.flag_description
  ) order by entry.choice_position), '[]'::jsonb)
  into v_choices
  from private.flags_session_entries as entry
  where entry.session_id = v_session.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', entry.entry_id,
    'position', entry.position,
    'choicePosition', entry.choice_position,
    'name', case when entry.outcome <> 'pending' then entry.name else null end,
    'outcome', entry.outcome,
    'attempts', entry.attempts,
    'hintUsed', entry.hint_used,
    'points', entry.points,
    'flagSvgUrl', entry.flag_svg_url,
    'flagPngUrl', entry.flag_png_url,
    'flagEmoji', entry.flag_emoji,
    'flagDescription', entry.flag_description,
    'correctChoiceId', case when entry.outcome <> 'pending' then entry.entry_id else null end
  ) order by entry.position), '[]'::jsonb)
  into v_entries
  from private.flags_session_entries as entry
  where entry.session_id = v_session.id;

  select * into v_current
  from private.flags_session_entries as entry
  where entry.session_id = v_session.id
    and entry.position = v_session.current_position;

  if found and v_session.state = 'active' then
    v_current_json := jsonb_build_object(
      'id', v_current.entry_id,
      'position', v_current.position,
      'name', case
        when v_session.direction = 'country_to_flag' or v_current.outcome <> 'pending'
        then v_current.name else null end,
      'region', case
        when v_session.direction = 'country_to_flag' or v_current.outcome <> 'pending' or v_current.hint_used
        then v_current.region else null end,
      'outcome', v_current.outcome,
      'attempts', v_current.attempts,
      'wrongChoiceIds', to_jsonb(v_current.wrong_choice_ids),
      'hintUsed', v_current.hint_used,
      'points', v_current.points,
      'flagSvgUrl', v_current.flag_svg_url,
      'flagPngUrl', v_current.flag_png_url,
      'flagEmoji', v_current.flag_emoji,
      'flagDescription', v_current.flag_description,
      'correctChoiceId', case when v_current.outcome <> 'pending' then v_current.entry_id else null end,
      'choices', case when v_session.direction = 'country_to_flag' then v_choices else null end
    );
  end if;

  if v_session.state = 'completed' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', past.id,
      'score', past.score,
      'maxScore', past.pool_count * 100 - case when past.direction = 'flag_to_country' then past.hints_used * 40 else 0 end,
      'elapsedMs', past.elapsed_ms,
      'correct', past.correct_count,
      'incorrect', past.incorrect_count,
      'skipped', past.skipped_count,
      'completedAt', past.completed_at
    ) order by past.score desc, past.elapsed_ms asc, past.completed_at asc), '[]'::jsonb)
    into v_top_five
    from (
      select history.*
      from private.flags_sessions as history
      where history.user_id = v_session.user_id
        and history.state = 'completed'
        and history.direction = v_session.direction
        and history.pool_signature = v_session.pool_signature
        and history.rules_version = v_session.rules_version
      order by history.score desc, history.elapsed_ms asc, history.completed_at asc
      limit 5
    ) as past;
  end if;

  return jsonb_build_object(
    'id', v_session.id,
    'direction', v_session.direction,
    'region', v_session.region,
    'poolTier', v_session.pool_tier,
    'poolSignature', v_session.pool_signature,
    'rulesVersion', v_session.rules_version,
    'state', v_session.state,
    'createdAt', v_session.created_at,
    'completedAt', v_session.completed_at,
    'elapsedMs', case
      when v_session.state = 'completed' then v_session.elapsed_ms
      when v_session.state = 'active' then floor(extract(epoch from (clock_timestamp() - v_session.created_at)) * 1000)::bigint
      else null end,
    'serverNow', clock_timestamp(),
    'total', v_session.pool_count,
    'maxScore', v_session.pool_count * 100 - case when v_session.direction = 'flag_to_country' then v_session.hints_used * 40 else 0 end,
    'currentPosition', v_session.current_position,
    'answered', v_finalized,
    'score', v_session.score,
    'correct', v_session.correct_count,
    'incorrect', v_session.incorrect_count,
    'skipped', v_session.skipped_count,
    'hintsUsed', v_session.hints_used,
    'current', v_current_json,
    'entries', v_entries,
    'finalBadge', v_session.final_badge,
    'topFive', v_top_five
  );
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
begin
  select * into v_session from private.flags_sessions as session
  where session.id = p_session_id for update;
  if not found or v_session.state <> 'active' then return; end if;

  if exists (
    select 1 from private.flags_session_entries as entry
    where entry.session_id = v_session.id and entry.outcome = 'pending'
  ) then raise exception 'FLAGS_ROUND_NOT_FINALIZED'; end if;

  v_completed_at := clock_timestamp();
  v_elapsed := greatest(0, floor(extract(epoch from (v_completed_at - v_session.created_at)) * 1000)::bigint);
  select * into v_previous
  from private.flags_sessions as prior
  where prior.user_id = v_session.user_id
    and prior.state = 'completed'
    and prior.direction = v_session.direction
    and prior.pool_signature = v_session.pool_signature
    and prior.rules_version = v_session.rules_version
  order by prior.score desc, prior.elapsed_ms asc, prior.completed_at asc
  limit 1;

  if not found then
    v_badge := 'first_run';
  elsif v_session.score > v_previous.score
    or (v_session.score = v_previous.score and v_elapsed < v_previous.elapsed_ms) then
    v_badge := 'new_best';
  else
    v_badge := 'not_best';
  end if;

  update private.flags_sessions
  set state = 'completed',
      completed_at = v_completed_at,
      elapsed_ms = v_elapsed,
      final_badge = v_badge
  where id = v_session.id;
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
    'id', region_counts.region_id,
    'name', region_counts.region_name,
    'easyCount', region_counts.easy_count,
    'allCount', region_counts.all_count,
    'easyMissingAssets', region_counts.easy_missing_assets,
    'allMissingAssets', region_counts.all_missing_assets,
    'easyTierExcluded', region_counts.easy_tier_excluded,
    'unsupportedDifficulty', region_counts.unsupported_difficulty
  ) order by region_counts.region_name), '[]'::jsonb)
  into v_regions
  from (
    select
      coalesce(nullif(trim(country.region), ''), '__unspecified__') as region_id,
      coalesce(nullif(trim(country.region), ''), 'Unspecified region') as region_name,
      count(*) filter (where country.difficulty in ('easy', 'medium') and private.flags_has_asset(country.flag_svg_url, country.flag_png_url, country.flag_emoji)) as easy_count,
      count(*) filter (where country.difficulty in ('easy', 'medium', 'hard', 'expert') and private.flags_has_asset(country.flag_svg_url, country.flag_png_url, country.flag_emoji)) as all_count,
      count(*) filter (where country.difficulty in ('easy', 'medium') and not private.flags_has_asset(country.flag_svg_url, country.flag_png_url, country.flag_emoji)) as easy_missing_assets,
      count(*) filter (where country.difficulty in ('easy', 'medium', 'hard', 'expert') and not private.flags_has_asset(country.flag_svg_url, country.flag_png_url, country.flag_emoji)) as all_missing_assets,
      count(*) filter (where country.difficulty in ('hard', 'expert') and private.flags_has_asset(country.flag_svg_url, country.flag_png_url, country.flag_emoji)) as easy_tier_excluded,
      count(*) filter (where country.difficulty not in ('easy', 'medium', 'hard', 'expert')) as unsupported_difficulty
    from private.countries as country
    group by 1, 2
  ) as region_counts;

  select jsonb_build_object(
    'easyCount', count(*) filter (where country.difficulty in ('easy', 'medium') and private.flags_has_asset(country.flag_svg_url, country.flag_png_url, country.flag_emoji)),
    'allCount', count(*) filter (where country.difficulty in ('easy', 'medium', 'hard', 'expert') and private.flags_has_asset(country.flag_svg_url, country.flag_png_url, country.flag_emoji)),
    'easyMissingAssets', count(*) filter (where country.difficulty in ('easy', 'medium') and not private.flags_has_asset(country.flag_svg_url, country.flag_png_url, country.flag_emoji)),
    'allMissingAssets', count(*) filter (where country.difficulty in ('easy', 'medium', 'hard', 'expert') and not private.flags_has_asset(country.flag_svg_url, country.flag_png_url, country.flag_emoji)),
    'easyTierExcluded', count(*) filter (where country.difficulty in ('hard', 'expert') and private.flags_has_asset(country.flag_svg_url, country.flag_png_url, country.flag_emoji)),
    'unsupportedDifficulty', count(*) filter (where country.difficulty not in ('easy', 'medium', 'hard', 'expert'))
  ) into v_summary
  from private.countries as country;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', session.id,
    'direction', session.direction,
    'region', session.region,
    'poolTier', session.pool_tier,
    'total', session.pool_count,
    'answered', (select count(*) from private.flags_session_entries as entry where entry.session_id = session.id and entry.outcome <> 'pending'),
    'score', session.score,
    'createdAt', session.created_at
  ) order by session.created_at desc), '[]'::jsonb)
  into v_active
  from (
    select active.* from private.flags_sessions as active
    where active.user_id = v_uid and active.state = 'active'
    order by active.created_at desc limit 10
  ) as session;

  return jsonb_build_object('regions', v_regions, 'summary', v_summary, 'activeSessions', v_active,
    'rulesVersion', 1, 'competitiveXp', false);
end;
$function$;

create or replace function public.arena_flags_start(
  p_direction text,
  p_region text,
  p_pool_tier text,
  p_request_id uuid
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
    or p_pool_tier is null or p_pool_tier not in ('easy', 'all') then raise exception 'INVALID_FLAGS_SELECTION'; end if;
  v_fingerprint := md5(concat_ws('|', p_direction, coalesce(p_region, ''), p_pool_tier, 'rules-1'));

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
    and country.difficulty in ('easy', 'medium', 'hard', 'expert')
    and private.flags_has_asset(country.flag_svg_url, country.flag_png_url, country.flag_emoji);
  if v_pool_count = 0 then raise exception 'EMPTY_FLAGS_POOL'; end if;

  select md5(concat_ws('|', 'flags', p_direction, p_pool_tier, coalesce(p_region, '__all__'), 'rules-1',
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
    and country.difficulty in ('easy', 'medium', 'hard', 'expert')
    and private.flags_has_asset(country.flag_svg_url, country.flag_png_url, country.flag_emoji);

  insert into private.flags_sessions(user_id, direction, region, pool_tier, pool_signature, pool_count)
  values (v_uid, p_direction, p_region, p_pool_tier, v_signature, v_pool_count)
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
    and candidate.difficulty in ('easy', 'medium', 'hard', 'expert')
    and private.flags_has_asset(candidate.flag_svg_url, candidate.flag_png_url, candidate.flag_emoji);

  insert into private.flags_start_requests(user_id, request_id, request_fingerprint, session_id)
  values (v_uid, p_request_id, v_fingerprint, v_session_id);
  return private.flags_view(v_session_id);
end;
$function$;

create or replace function public.arena_flags_view(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.require_user();
  perform private.rate('flags_view', 180);
  return private.flags_view(p_session_id);
end;
$function$;

create or replace function public.arena_flags_answer(
  p_session_id uuid,
  p_entry_id uuid,
  p_choice_id uuid,
  p_answer text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session private.flags_sessions%rowtype;
  v_entry private.flags_session_entries%rowtype;
  v_cached private.flags_action_requests%rowtype;
  v_fingerprint text;
  v_normalized text;
  v_match_count integer;
  v_match_id uuid;
  v_attempt integer;
  v_points integer := 0;
  v_result jsonb;
  v_outcome text;
begin
  if p_request_id is null or p_session_id is null or p_entry_id is null then raise exception 'INVALID_FLAGS_REQUEST'; end if;
  if p_answer is not null and length(p_answer) > 200 then raise exception 'INVALID_FLAGS_ANSWER'; end if;
  v_normalized := private.flags_normalize(p_answer);
  v_fingerprint := md5(concat_ws('|', 'answer', p_entry_id::text, coalesce(p_choice_id::text, ''), coalesce(p_answer, '')));

  select * into v_session from private.flags_sessions as session
  where session.id = p_session_id and session.user_id = v_uid for update;
  if not found then raise exception 'FLAGS_SESSION_NOT_FOUND'; end if;
  select * into v_cached from private.flags_action_requests as request
  where request.session_id = p_session_id and request.request_id = p_request_id;
  if found then
    if v_cached.request_fingerprint <> v_fingerprint then raise exception 'FLAGS_REQUEST_ID_REUSED'; end if;
    return v_cached.response;
  end if;
  perform private.rate('flags_answer', 240);
  if v_session.state <> 'active' then raise exception 'FLAGS_SESSION_NOT_ACTIVE'; end if;

  select * into v_entry from private.flags_session_entries as entry
  where entry.session_id = p_session_id and entry.position = v_session.current_position for update;
  if not found or v_entry.entry_id <> p_entry_id then raise exception 'STALE_FLAGS_ENTRY'; end if;
  if v_entry.outcome <> 'pending' then raise exception 'FLAGS_ENTRY_ALREADY_FINALIZED'; end if;

  if v_session.direction = 'country_to_flag' then
    if p_choice_id is null or p_answer is not null then raise exception 'INVALID_FLAGS_ANSWER'; end if;
    if not exists (select 1 from private.flags_session_entries as choice
      where choice.session_id = p_session_id and choice.entry_id = p_choice_id) then
      raise exception 'UNKNOWN_FLAGS_CHOICE';
    end if;
    if p_choice_id = v_entry.entry_id then
      v_attempt := cardinality(v_entry.wrong_choice_ids) + 1;
      v_points := case v_attempt when 1 then 100 when 2 then 60 else 30 end;
      update private.flags_session_entries
      set outcome = 'correct', attempts = v_attempt, points = v_points, finalized_at = clock_timestamp()
      where session_id = p_session_id and entry_id = p_entry_id;
      update private.flags_sessions
      set score = score + v_points, correct_count = correct_count + 1
      where id = p_session_id;
      v_outcome := 'correct';
    elsif p_choice_id = any(v_entry.wrong_choice_ids) then
      v_outcome := 'duplicate_choice';
    else
      v_entry.wrong_choice_ids := array_append(v_entry.wrong_choice_ids, p_choice_id);
      v_attempt := cardinality(v_entry.wrong_choice_ids);
      if v_attempt >= 3 then
        update private.flags_session_entries
        set wrong_choice_ids = v_entry.wrong_choice_ids, attempts = 3,
            outcome = 'incorrect', points = 0, finalized_at = clock_timestamp()
        where session_id = p_session_id and entry_id = p_entry_id;
        update private.flags_sessions set incorrect_count = incorrect_count + 1 where id = p_session_id;
        v_outcome := 'not_solved';
      else
        update private.flags_session_entries
        set wrong_choice_ids = v_entry.wrong_choice_ids, attempts = v_attempt
        where session_id = p_session_id and entry_id = p_entry_id;
        v_outcome := 'wrong_choice';
      end if;
    end if;
  else
    if p_choice_id is not null or p_answer is null or length(p_answer) > 200 then raise exception 'INVALID_FLAGS_ANSWER'; end if;
    if v_normalized = '' then raise exception 'EMPTY_FLAGS_ANSWER'; end if;
    select count(distinct entry.entry_id)::integer, min(entry.entry_id::text)::uuid
    into v_match_count, v_match_id
    from private.flags_session_entries as entry
    where entry.session_id = p_session_id and v_normalized = any(entry.aliases);
    if v_match_count > 1 then
      v_outcome := 'ambiguous';
    elsif v_match_count = 1 and v_match_id = v_entry.entry_id then
      v_points := case when v_entry.hint_used then 60 else 100 end;
      update private.flags_session_entries
      set outcome = 'correct', attempts = 1, points = v_points, finalized_at = clock_timestamp()
      where session_id = p_session_id and entry_id = p_entry_id;
      update private.flags_sessions
      set score = score + v_points, correct_count = correct_count + 1
      where id = p_session_id;
      v_outcome := 'correct';
    else
      update private.flags_session_entries
      set outcome = 'incorrect', attempts = 1, points = 0, finalized_at = clock_timestamp()
      where session_id = p_session_id and entry_id = p_entry_id;
      update private.flags_sessions set incorrect_count = incorrect_count + 1 where id = p_session_id;
      v_outcome := 'incorrect';
    end if;
  end if;

  v_result := jsonb_set(private.flags_view(p_session_id), '{actionResult}', jsonb_build_object(
    'type', 'answer', 'outcome', v_outcome,
    'remainingAttempts', case when v_session.direction = 'country_to_flag' then greatest(0, 3 - coalesce(v_attempt, cardinality(v_entry.wrong_choice_ids))) else 0 end
  ), true);
  insert into private.flags_action_requests(session_id, request_id, request_fingerprint, response)
  values (p_session_id, p_request_id, v_fingerprint, v_result);
  return v_result;
end;
$function$;

create or replace function public.arena_flags_hint(
  p_session_id uuid,
  p_entry_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session private.flags_sessions%rowtype;
  v_entry private.flags_session_entries%rowtype;
  v_cached private.flags_action_requests%rowtype;
  v_fingerprint text;
  v_result jsonb;
begin
  if p_request_id is null or p_session_id is null or p_entry_id is null then raise exception 'INVALID_FLAGS_REQUEST'; end if;
  v_fingerprint := md5(concat_ws('|', 'hint', p_entry_id::text));
  select * into v_session from private.flags_sessions as session
  where session.id = p_session_id and session.user_id = v_uid for update;
  if not found then raise exception 'FLAGS_SESSION_NOT_FOUND'; end if;
  select * into v_cached from private.flags_action_requests as request
  where request.session_id = p_session_id and request.request_id = p_request_id;
  if found then
    if v_cached.request_fingerprint <> v_fingerprint then raise exception 'FLAGS_REQUEST_ID_REUSED'; end if;
    return v_cached.response;
  end if;
  perform private.rate('flags_hint', 60);
  if v_session.state <> 'active' or v_session.direction <> 'flag_to_country' then raise exception 'FLAGS_HINT_NOT_AVAILABLE'; end if;
  if v_session.region is not null then raise exception 'FLAGS_REGION_ALREADY_KNOWN'; end if;
  select * into v_entry from private.flags_session_entries as entry
  where entry.session_id = p_session_id and entry.position = v_session.current_position for update;
  if not found or v_entry.entry_id <> p_entry_id then raise exception 'STALE_FLAGS_ENTRY'; end if;
  if v_entry.outcome <> 'pending' then raise exception 'FLAGS_ENTRY_ALREADY_FINALIZED'; end if;
  if not v_entry.hint_used then
    update private.flags_session_entries set hint_used = true
    where session_id = p_session_id and entry_id = p_entry_id;
    update private.flags_sessions set hints_used = hints_used + 1 where id = p_session_id;
  end if;
  v_result := private.flags_view(p_session_id);
  insert into private.flags_action_requests(session_id, request_id, request_fingerprint, response)
  values (p_session_id, p_request_id, v_fingerprint, v_result);
  return v_result;
end;
$function$;

create or replace function public.arena_flags_skip(
  p_session_id uuid,
  p_entry_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session private.flags_sessions%rowtype;
  v_entry private.flags_session_entries%rowtype;
  v_cached private.flags_action_requests%rowtype;
  v_fingerprint text;
  v_result jsonb;
begin
  if p_request_id is null or p_session_id is null or p_entry_id is null then raise exception 'INVALID_FLAGS_REQUEST'; end if;
  v_fingerprint := md5(concat_ws('|', 'skip', p_entry_id::text));
  select * into v_session from private.flags_sessions as session
  where session.id = p_session_id and session.user_id = v_uid for update;
  if not found then raise exception 'FLAGS_SESSION_NOT_FOUND'; end if;
  select * into v_cached from private.flags_action_requests as request
  where request.session_id = p_session_id and request.request_id = p_request_id;
  if found then
    if v_cached.request_fingerprint <> v_fingerprint then raise exception 'FLAGS_REQUEST_ID_REUSED'; end if;
    return v_cached.response;
  end if;
  perform private.rate('flags_skip', 60);
  if v_session.state <> 'active' or v_session.direction <> 'flag_to_country' then raise exception 'FLAGS_SKIP_NOT_AVAILABLE'; end if;
  select * into v_entry from private.flags_session_entries as entry
  where entry.session_id = p_session_id and entry.position = v_session.current_position for update;
  if not found or v_entry.entry_id <> p_entry_id then raise exception 'STALE_FLAGS_ENTRY'; end if;
  if v_entry.outcome <> 'pending' then raise exception 'FLAGS_ENTRY_ALREADY_FINALIZED'; end if;
  update private.flags_session_entries
  set outcome = 'skipped', points = 0, finalized_at = clock_timestamp()
  where session_id = p_session_id and entry_id = p_entry_id;
  update private.flags_sessions set skipped_count = skipped_count + 1 where id = p_session_id;
  v_result := private.flags_view(p_session_id);
  insert into private.flags_action_requests(session_id, request_id, request_fingerprint, response)
  values (p_session_id, p_request_id, v_fingerprint, v_result);
  return v_result;
end;
$function$;

create or replace function public.arena_flags_next(
  p_session_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session private.flags_sessions%rowtype;
  v_current private.flags_session_entries%rowtype;
  v_cached private.flags_action_requests%rowtype;
  v_fingerprint text;
  v_result jsonb;
begin
  if p_request_id is null or p_session_id is null then raise exception 'INVALID_FLAGS_REQUEST'; end if;
  select * into v_session from private.flags_sessions as session
  where session.id = p_session_id and session.user_id = v_uid for update;
  if not found then raise exception 'FLAGS_SESSION_NOT_FOUND'; end if;
  v_fingerprint := md5('next');
  select * into v_cached from private.flags_action_requests as request
  where request.session_id = p_session_id and request.request_id = p_request_id;
  if found then
    if v_cached.request_fingerprint <> v_fingerprint then raise exception 'FLAGS_REQUEST_ID_REUSED'; end if;
    return v_cached.response;
  end if;
  perform private.rate('flags_next', 120);
  if v_session.state <> 'active' then raise exception 'FLAGS_SESSION_NOT_ACTIVE'; end if;
  select * into v_current from private.flags_session_entries as entry
  where entry.session_id = p_session_id and entry.position = v_session.current_position;
  if not found or v_current.outcome = 'pending' then raise exception 'FLAGS_ENTRY_NOT_FINALIZED'; end if;

  if v_session.current_position = v_session.pool_count then
    perform private.flags_complete(p_session_id);
  else
    update private.flags_sessions set current_position = current_position + 1 where id = p_session_id;
  end if;
  v_result := private.flags_view(p_session_id);
  insert into private.flags_action_requests(session_id, request_id, request_fingerprint, response)
  values (p_session_id, p_request_id, v_fingerprint, v_result);
  return v_result;
end;
$function$;

create or replace function public.arena_flags_abandon(
  p_session_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session private.flags_sessions%rowtype;
  v_cached private.flags_action_requests%rowtype;
  v_fingerprint text;
  v_result jsonb;
begin
  if p_request_id is null or p_session_id is null then raise exception 'INVALID_FLAGS_REQUEST'; end if;
  v_fingerprint := md5('abandon');
  select * into v_session from private.flags_sessions as session
  where session.id = p_session_id and session.user_id = v_uid for update;
  if not found then raise exception 'FLAGS_SESSION_NOT_FOUND'; end if;
  select * into v_cached from private.flags_action_requests as request
  where request.session_id = p_session_id and request.request_id = p_request_id;
  if found then
    if v_cached.request_fingerprint <> v_fingerprint then raise exception 'FLAGS_REQUEST_ID_REUSED'; end if;
    return v_cached.response;
  end if;
  perform private.rate('flags_abandon', 30);
  if v_session.state = 'active' then
    update private.flags_sessions set state = 'abandoned'
    where id = p_session_id;
  elsif v_session.state <> 'abandoned' then
    raise exception 'FLAGS_SESSION_ALREADY_COMPLETED';
  end if;
  v_result := private.flags_view(p_session_id);
  insert into private.flags_action_requests(session_id, request_id, request_fingerprint, response)
  values (p_session_id, p_request_id, v_fingerprint, v_result);
  return v_result;
end;
$function$;

create or replace function public.arena_flags_results(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session private.flags_sessions%rowtype;
begin
  perform private.rate('flags_results', 60);
  select * into v_session from private.flags_sessions as session
  where session.id = p_session_id and session.user_id = v_uid;
  if not found then raise exception 'FLAGS_SESSION_NOT_FOUND'; end if;
  if v_session.state not in ('completed', 'abandoned') then raise exception 'FLAGS_ROUND_NOT_COMPLETE'; end if;
  return private.flags_view(p_session_id);
end;
$function$;

revoke all on function private.flags_normalize(text) from public, anon, authenticated;
revoke all on function private.flags_has_asset(text, text, text) from public, anon, authenticated;
revoke all on function private.flags_view(uuid) from public, anon, authenticated;
revoke all on function private.flags_complete(uuid) from public, anon, authenticated;
revoke all on function public.arena_flags_setup() from public, anon, authenticated;
revoke all on function public.arena_flags_start(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.arena_flags_view(uuid) from public, anon, authenticated;
revoke all on function public.arena_flags_answer(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.arena_flags_hint(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.arena_flags_skip(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.arena_flags_next(uuid, uuid) from public, anon, authenticated;
revoke all on function public.arena_flags_abandon(uuid, uuid) from public, anon, authenticated;
revoke all on function public.arena_flags_results(uuid) from public, anon, authenticated;
grant execute on function public.arena_flags_setup() to authenticated;
grant execute on function public.arena_flags_start(text, text, text, uuid) to authenticated;
grant execute on function public.arena_flags_view(uuid) to authenticated;
grant execute on function public.arena_flags_answer(uuid, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.arena_flags_hint(uuid, uuid, uuid) to authenticated;
grant execute on function public.arena_flags_skip(uuid, uuid, uuid) to authenticated;
grant execute on function public.arena_flags_next(uuid, uuid) to authenticated;
grant execute on function public.arena_flags_abandon(uuid, uuid) to authenticated;
grant execute on function public.arena_flags_results(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
