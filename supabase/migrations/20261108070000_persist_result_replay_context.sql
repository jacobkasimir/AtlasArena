-- Preserve the exact setup used for each session and provide an owned,
-- read-only result payload with the player's prior mode best.
alter table private.game_sessions
  add column if not exists session_categories text[],
  add column if not exists session_country text,
  add column if not exists session_question_count integer,
  add column if not exists session_context_saved boolean not null default false;

alter table private.game_sessions
  add constraint game_sessions_question_count_range
    check (session_question_count is null or session_question_count between 1 and 10);

-- New starts save even an empty category array, which explicitly means “all”.
-- Null metadata marks legacy sessions whose original filters cannot be recovered.

create or replace function public.arena_start_saved(
  p_mode text,
  p_categories text[] default '{}',
  p_difficulty text default 'easy',
  p_country text default null,
  p_count integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_result jsonb;
  v_id uuid;
begin
  v_result := public.arena_start(p_mode, p_categories, p_difficulty, p_country, p_count);
  v_id := (v_result ->> 'id')::uuid;

  update private.game_sessions
  set session_categories = p_categories,
      session_country = p_country,
      session_question_count = p_count,
      session_context_saved = true
  where id = v_id and user_id = v_uid;

  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  return v_result;
end;
$function$;

create or replace function public.arena_result(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.game_sessions;
  v_result jsonb;
  v_previous_best integer;
begin
  perform private.rate('result', 120);
  v_session := private.owned_locked(p_id);

  if v_session.state = 'completed' then
    select max(previous.score)::integer into v_previous_best
    from private.game_sessions as previous
    where previous.user_id = v_session.user_id
      and previous.mode = v_session.mode
      and previous.state = 'completed'
      and previous.id <> v_session.id
      and (previous.completed_at, previous.created_at, previous.id)
        < (v_session.completed_at, v_session.created_at, v_session.id);
  end if;

  v_result := private.view(p_id);
  return v_result || jsonb_build_object(
    'categories', v_session.session_categories,
    'country', v_session.session_country,
    'questionCount', v_session.session_question_count,
    'contextSaved', v_session.session_context_saved,
    'previousBest', v_previous_best
  );
end;
$function$;

revoke all on function public.arena_start_saved(text, text[], text, text, integer)
  from public, anon, authenticated;
revoke all on function public.arena_result(uuid)
  from public, anon, authenticated;
grant execute on function public.arena_start_saved(text, text[], text, text, integer)
  to authenticated;
grant execute on function public.arena_result(uuid)
  to authenticated;

notify pgrst, 'reload schema';
