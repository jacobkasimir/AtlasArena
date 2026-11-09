begin;

alter table private.flags_sessions
  add column if not exists paused_at timestamptz,
  add column if not exists paused_total_ms bigint not null default 0 check (paused_total_ms >= 0);

alter table private.flags_sessions drop constraint if exists flags_sessions_state_check;
alter table private.flags_sessions add constraint flags_sessions_state_check
  check (state in ('active', 'paused', 'completed', 'abandoned'));
alter table private.flags_sessions add constraint flags_sessions_pause_state_check
  check ((state = 'paused' and paused_at is not null) or (state <> 'paused' and paused_at is null));

create table if not exists private.flags_delete_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  session_id uuid not null,
  request_fingerprint text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, request_id)
);
alter table private.flags_delete_requests enable row level security;
revoke all on private.flags_delete_requests from public, anon, authenticated;

create or replace function private.flags_has_asset(p_svg text, p_png text, p_emoji text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(p_svg ~* '^https://([a-z0-9-]+[.])*flags[.]restcountries[.]com/[^/?#]+[.]svg([?#].*)?$', false);
$function$;

create or replace function private.flags_shuffle_inserted_pool()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session_id uuid;
  v_count integer;
  v_total integer;
begin
  execute 'select session_id from inserted_rows limit 1' into v_session_id;
  if v_session_id is null then return null; end if;
  select session.pool_count into v_total
  from private.flags_sessions as session where session.id = v_session_id;
  select count(*)::integer into v_count
  from private.flags_session_entries as entry where entry.session_id = v_session_id;
  if v_count <> v_total then return null; end if;

  -- Move both unique position sets out of range before assigning independent,
  -- session-seeded permutations. This also avoids transient unique conflicts.
  update private.flags_session_entries as entry
  set position = entry.position + v_total,
      choice_position = entry.choice_position + v_total
  where entry.session_id = v_session_id;

  with permutations as (
    select entry.entry_id,
      row_number() over (order by md5(entry.country_code || v_session_id::text || ':question'), entry.country_code)::integer as question_position,
      row_number() over (order by md5(entry.country_code || v_session_id::text || ':choice'), entry.country_code)::integer as choice_position
    from private.flags_session_entries as entry
    where entry.session_id = v_session_id
  )
  update private.flags_session_entries as entry
  set position = permutations.question_position,
      choice_position = permutations.choice_position
  from permutations
  where entry.session_id = v_session_id and entry.entry_id = permutations.entry_id;
  return null;
end;
$function$;

drop trigger if exists flags_session_entries_shuffle_pool on private.flags_session_entries;
create trigger flags_session_entries_shuffle_pool
after insert on private.flags_session_entries
referencing new table as inserted_rows
for each statement execute function private.flags_shuffle_inserted_pool();
revoke all on function private.flags_shuffle_inserted_pool() from public, anon, authenticated;

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
  v_now timestamptz := clock_timestamp();
begin
  select * into v_session
  from private.flags_sessions as session
  where session.id = p_session_id and session.user_id = auth.uid();
  if not found then raise exception 'FLAGS_SESSION_NOT_FOUND'; end if;

  select count(*)::integer into v_finalized
  from private.flags_session_entries as entry
  where entry.session_id = v_session.id and entry.outcome <> 'pending';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', entry.entry_id,
    'choicePosition', entry.choice_position,
    'flagSvgUrl', entry.flag_svg_url,
    'flagPngUrl', entry.flag_png_url,
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
    'flagDescription', entry.flag_description,
    'correctChoiceId', case when entry.outcome <> 'pending' then entry.entry_id else null end
  ) order by entry.position), '[]'::jsonb)
  into v_entries
  from private.flags_session_entries as entry
  where entry.session_id = v_session.id;

  select * into v_current
  from private.flags_session_entries as entry
  where entry.session_id = v_session.id and entry.position = v_session.current_position;

  if found and v_session.state in ('active', 'paused') then
    v_current_json := jsonb_build_object(
      'id', v_current.entry_id,
      'position', v_current.position,
      'name', case when v_session.direction = 'country_to_flag' or v_current.outcome <> 'pending' then v_current.name else null end,
      'region', case when v_session.direction = 'country_to_flag' or v_current.outcome <> 'pending' or v_current.hint_used then v_current.region else null end,
      'outcome', v_current.outcome,
      'attempts', v_current.attempts,
      'wrongChoiceIds', to_jsonb(v_current.wrong_choice_ids),
      'hintUsed', v_current.hint_used,
      'points', v_current.points,
      'flagSvgUrl', v_current.flag_svg_url,
      'flagPngUrl', v_current.flag_png_url,
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
      select history.* from private.flags_sessions as history
      where history.user_id = v_session.user_id and history.state = 'completed'
        and history.direction = v_session.direction
        and history.pool_signature = v_session.pool_signature
        and history.rules_version = v_session.rules_version
      order by history.score desc, history.elapsed_ms asc, history.completed_at asc limit 5
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
    'paused', v_session.state = 'paused',
    'createdAt', v_session.created_at,
    'completedAt', v_session.completed_at,
    'elapsedMs', case
      when v_session.state = 'completed' then v_session.elapsed_ms
      when v_session.state = 'paused' then greatest(0, floor(extract(epoch from (v_session.paused_at - v_session.created_at)) * 1000)::bigint - v_session.paused_total_ms)
      when v_session.state = 'active' then greatest(0, floor(extract(epoch from (v_now - v_session.created_at)) * 1000)::bigint - v_session.paused_total_ms)
      else null end,
    'serverNow', v_now,
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
  if exists (select 1 from private.flags_session_entries as entry where entry.session_id = v_session.id and entry.outcome = 'pending') then
    raise exception 'FLAGS_ROUND_NOT_FINALIZED';
  end if;
  v_completed_at := clock_timestamp();
  v_elapsed := greatest(0, floor(extract(epoch from (v_completed_at - v_session.created_at)) * 1000)::bigint - v_session.paused_total_ms);
  select * into v_previous from private.flags_sessions as prior
  where prior.user_id = v_session.user_id and prior.state = 'completed'
    and prior.direction = v_session.direction and prior.pool_signature = v_session.pool_signature
    and prior.rules_version = v_session.rules_version
  order by prior.score desc, prior.elapsed_ms asc, prior.completed_at asc limit 1;
  if not found then v_badge := 'first_run';
  elsif v_session.score > v_previous.score or (v_session.score = v_previous.score and v_elapsed < v_previous.elapsed_ms) then v_badge := 'new_best';
  else v_badge := 'not_best'; end if;
  update private.flags_sessions set state = 'completed', completed_at = v_completed_at,
    elapsed_ms = v_elapsed, final_badge = v_badge where id = v_session.id;
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
    'easyMissingAssets', region_counts.easy_missing_assets, 'allMissingAssets', region_counts.all_missing_assets,
    'easyTierExcluded', region_counts.easy_tier_excluded, 'unsupportedDifficulty', region_counts.unsupported_difficulty
  ) order by region_counts.region_name), '[]'::jsonb) into v_regions
  from (
    select coalesce(nullif(trim(country.region), ''), '__unspecified__') as region_id,
      coalesce(nullif(trim(country.region), ''), 'Unspecified region') as region_name,
      count(*) filter (where country.difficulty in ('easy','medium') and private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)) as easy_count,
      count(*) filter (where country.difficulty in ('easy','medium','hard','expert') and private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)) as all_count,
      count(*) filter (where country.difficulty in ('easy','medium') and not private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)) as easy_missing_assets,
      count(*) filter (where country.difficulty in ('easy','medium','hard','expert') and not private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)) as all_missing_assets,
      count(*) filter (where country.difficulty in ('hard','expert') and private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)) as easy_tier_excluded,
      count(*) filter (where country.difficulty not in ('easy','medium','hard','expert')) as unsupported_difficulty
    from private.countries as country group by 1,2
  ) as region_counts;

  select jsonb_build_object(
    'easyCount', count(*) filter (where country.difficulty in ('easy','medium') and private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)),
    'allCount', count(*) filter (where country.difficulty in ('easy','medium','hard','expert') and private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)),
    'easyMissingAssets', count(*) filter (where country.difficulty in ('easy','medium') and not private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)),
    'allMissingAssets', count(*) filter (where country.difficulty in ('easy','medium','hard','expert') and not private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)),
    'easyTierExcluded', count(*) filter (where country.difficulty in ('hard','expert') and private.flags_has_asset(country.flag_svg_url,country.flag_png_url,country.flag_emoji)),
    'unsupportedDifficulty', count(*) filter (where country.difficulty not in ('easy','medium','hard','expert'))
  ) into v_summary from private.countries as country;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', session.id, 'direction', session.direction, 'region', session.region,
    'poolTier', session.pool_tier, 'total', session.pool_count,
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

create or replace function public.arena_flags_pause(p_session_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session private.flags_sessions%rowtype;
  v_cached private.flags_action_requests%rowtype;
  v_fingerprint text := md5('pause');
  v_result jsonb;
begin
  if p_session_id is null or p_request_id is null then raise exception 'INVALID_FLAGS_REQUEST'; end if;
  select * into v_session from private.flags_sessions as session where session.id=p_session_id and session.user_id=v_uid for update;
  if not found then raise exception 'FLAGS_SESSION_NOT_FOUND'; end if;
  select * into v_cached from private.flags_action_requests as request where request.session_id=p_session_id and request.request_id=p_request_id;
  if found then
    if v_cached.request_fingerprint <> v_fingerprint then raise exception 'FLAGS_REQUEST_ID_REUSED'; end if;
    return v_cached.response;
  end if;
  perform private.rate('flags_pause', 120);
  if v_session.state='active' then
    update private.flags_sessions set state='paused', paused_at=clock_timestamp() where id=p_session_id;
  elsif v_session.state not in ('paused') then raise exception 'FLAGS_SESSION_NOT_ACTIVE'; end if;
  v_result:=private.flags_view(p_session_id);
  insert into private.flags_action_requests(session_id,request_id,request_fingerprint,response) values(p_session_id,p_request_id,v_fingerprint,v_result);
  return v_result;
end;
$function$;

create or replace function public.arena_flags_resume(p_session_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session private.flags_sessions%rowtype;
  v_cached private.flags_action_requests%rowtype;
  v_fingerprint text := md5('resume');
  v_result jsonb;
begin
  if p_session_id is null or p_request_id is null then raise exception 'INVALID_FLAGS_REQUEST'; end if;
  select * into v_session from private.flags_sessions as session where session.id=p_session_id and session.user_id=v_uid for update;
  if not found then raise exception 'FLAGS_SESSION_NOT_FOUND'; end if;
  select * into v_cached from private.flags_action_requests as request where request.session_id=p_session_id and request.request_id=p_request_id;
  if found then
    if v_cached.request_fingerprint <> v_fingerprint then raise exception 'FLAGS_REQUEST_ID_REUSED'; end if;
    return v_cached.response;
  end if;
  perform private.rate('flags_resume', 120);
  if v_session.state='paused' then
    update private.flags_sessions set state='active',
      paused_total_ms=paused_total_ms+greatest(0,floor(extract(epoch from (clock_timestamp()-paused_at))*1000)::bigint),
      paused_at=null where id=p_session_id;
  elsif v_session.state not in ('active', 'completed', 'abandoned') then raise exception 'FLAGS_SESSION_NOT_ACTIVE'; end if;
  v_result:=private.flags_view(p_session_id);
  insert into private.flags_action_requests(session_id,request_id,request_fingerprint,response) values(p_session_id,p_request_id,v_fingerprint,v_result);
  return v_result;
end;
$function$;

create or replace function public.arena_flags_abandon(p_session_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session private.flags_sessions%rowtype;
  v_cached private.flags_action_requests%rowtype;
  v_fingerprint text := md5('abandon');
  v_result jsonb;
begin
  if p_request_id is null or p_session_id is null then raise exception 'INVALID_FLAGS_REQUEST'; end if;
  select * into v_session from private.flags_sessions as session where session.id=p_session_id and session.user_id=v_uid for update;
  if not found then raise exception 'FLAGS_SESSION_NOT_FOUND'; end if;
  select * into v_cached from private.flags_action_requests as request where request.session_id=p_session_id and request.request_id=p_request_id;
  if found then
    if v_cached.request_fingerprint<>v_fingerprint then raise exception 'FLAGS_REQUEST_ID_REUSED'; end if;
    return v_cached.response;
  end if;
  perform private.rate('flags_abandon',30);
  if v_session.state in ('active','paused') then
    update private.flags_sessions set state='abandoned',paused_at=null where id=p_session_id;
  elsif v_session.state<>'abandoned' then raise exception 'FLAGS_SESSION_ALREADY_COMPLETED'; end if;
  v_result:=private.flags_view(p_session_id);
  insert into private.flags_action_requests(session_id,request_id,request_fingerprint,response) values(p_session_id,p_request_id,v_fingerprint,v_result);
  return v_result;
end;
$function$;

create or replace function public.arena_flags_delete(p_session_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session private.flags_sessions%rowtype;
  v_existing private.flags_delete_requests%rowtype;
  v_fingerprint text;
begin
  if p_session_id is null or p_request_id is null then raise exception 'INVALID_FLAGS_REQUEST'; end if;
  v_fingerprint:=md5(concat_ws('|','delete',p_session_id::text));
  select * into v_existing from private.flags_delete_requests as request where request.user_id=v_uid and request.request_id=p_request_id;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception 'FLAGS_REQUEST_ID_REUSED'; end if;
    return jsonb_build_object('deleted',true);
  end if;
  perform private.rate('flags_delete',30);
  select * into v_session from private.flags_sessions as session where session.id=p_session_id and session.user_id=v_uid for update;
  if not found then raise exception 'FLAGS_SESSION_NOT_FOUND'; end if;
  if v_session.state not in ('active','paused','abandoned') then raise exception 'FLAGS_COMPLETED_RUN_CANNOT_BE_DELETED'; end if;
  delete from private.flags_sessions where id=p_session_id and user_id=v_uid;
  insert into private.flags_delete_requests(user_id,request_id,session_id,request_fingerprint)
  values(v_uid,p_request_id,p_session_id,v_fingerprint);
  return jsonb_build_object('deleted',true);
end;
$function$;

revoke all on function private.flags_shuffle_inserted_pool() from public, anon, authenticated;
revoke all on function public.arena_flags_pause(uuid,uuid) from public, anon, authenticated;
revoke all on function public.arena_flags_resume(uuid,uuid) from public, anon, authenticated;
revoke all on function public.arena_flags_delete(uuid,uuid) from public, anon, authenticated;
grant execute on function public.arena_flags_pause(uuid,uuid) to authenticated;
grant execute on function public.arena_flags_resume(uuid,uuid) to authenticated;
grant execute on function public.arena_flags_delete(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
