begin;
-- Capitals: no suggestions while typing, and answers are accepted in English, German or French.
-- Typed answers are matched with the same forgiving normalization as Recall (accents, case, spaces,
-- hyphens and apostrophes don't matter) against the names Recall knows, plus the round's own snapshot.

-- Which language a typed answer matched for one country, or null when it matches nothing.
create or replace function private.capitals_match(
  p_direction text, p_code text, p_answer text, p_capitals jsonb, p_aliases text[], p_codes text[]
)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  with typed as (
    select private.recall_normalize(p_answer) as k, private.capitals_normalize(p_answer) as c
  ), names as (
    select item.value ->> 'name' as name, item.value ->> 'lang' as lang
    from private.recall_catalog() as catalog
    cross join lateral jsonb_array_elements(
      case when p_direction = 'country_to_capital' then catalog.capital_names else catalog.country_names end) as item(value)
    where catalog.code = p_code
    union all
    select capital.value ->> 'name', 'en'
    from jsonb_array_elements(case when p_direction = 'country_to_capital' and jsonb_typeof(p_capitals) = 'array'
      then p_capitals else '[]'::jsonb end) as capital(value)
    union all
    select alias, 'en' from unnest(case when p_direction = 'capital_to_country'
      then coalesce(p_aliases, array[]::text[]) || coalesce(p_codes, array[]::text[]) else array[]::text[] end) as alias
  )
  select names.lang
  from names, typed
  where typed.k <> '' and names.name is not null
    and (private.recall_normalize(names.name) = typed.k or private.capitals_normalize(names.name) = typed.c)
  order by case names.lang when 'en' then 1 when 'de' then 2 else 3 end
  limit 1;
$function$;

create or replace function private.capitals_answer_core(
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
  v_key text;
  v_fingerprint text;
  v_response jsonb;
  v_lang text;
  v_correct boolean;
  v_owners integer := 0;
begin
  if p_request_id is null or p_answer is null or length(p_answer) > 200 then raise exception 'INVALID_CAPITALS_ANSWER'; end if;
  v_norm := private.capitals_normalize(p_answer);
  v_key := private.recall_normalize(p_answer);
  if v_norm = '' or v_key = '' then raise exception 'EMPTY_CAPITALS_ANSWER'; end if;
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

  v_lang := private.capitals_match(v_session.direction, v_entry.country_code, p_answer,
    v_entry.capitals, v_entry.country_aliases, v_entry.country_codes);

  -- A country name shared by several places ("Congo", "Kongo") is only accepted when it is this
  -- place's own English name; otherwise the player is asked to be more specific.
  if v_session.direction = 'capital_to_country' then
    select count(distinct catalog.code) into v_owners
    from private.recall_catalog() as catalog
    cross join lateral jsonb_array_elements(catalog.country_names) as item(value)
    where private.recall_normalize(item.value ->> 'name') = v_key;
  end if;
  if v_session.direction = 'capital_to_country'
    and (v_norm = any(v_session.ambiguous_country_aliases) or v_owners > 1)
    and private.recall_normalize(v_entry.country_name) <> v_key then
    v_response := jsonb_set(private.capitals_view(p_session_id), '{actionResult}', jsonb_build_object('outcome', 'ambiguous'), true);
  else
    v_correct := v_lang is not null;
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
      jsonb_build_object('outcome', case when v_correct then 'correct' else 'incorrect' end, 'lang', v_lang), true);
  end if;
  insert into private.capital_action_requests(user_id, request_id, operation, fingerprint, session_id, response)
  values(v_uid, p_request_id, 'answer', v_fingerprint, p_session_id, v_response);
  return v_response;
end;
$function$;

-- Rounds no longer send the list of possible answers to the app.
create or replace function private.capitals_view(p_session_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $function$
  select (private.capitals_view_core(p_session_id) - 'vocabulary') || jsonb_build_object('vocabulary', '[]'::jsonb) || (
    select jsonb_build_object('scope', session.scope, 'timeLimitSeconds', session.time_limit_seconds,
      'deadlineAt', session.deadline_at, 'sampleSize', session.sample_size, 'ranked', session.sample_size is null)
    from private.capital_sessions as session where session.id = p_session_id);
$function$;

revoke all on function private.capitals_match(text, text, text, jsonb, text[], text[]),
  private.capitals_answer_core(uuid, uuid, text, text, uuid), private.capitals_view(uuid)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
