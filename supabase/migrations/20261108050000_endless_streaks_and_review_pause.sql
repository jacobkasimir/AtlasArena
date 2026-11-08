-- Endless tier advancement now requires a clean streak at each tier.
-- Timed runs pause their overall deadline while answer feedback is open.

alter table private.game_sessions
  add column if not exists endless_tier_streak integer not null default 0,
  add column if not exists feedback_started_at timestamptz;

create or replace function private.select_next(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.game_sessions;
  v_question_id uuid;
begin
  select session.* into v_session
  from private.game_sessions as session
  where session.id = p_id;

  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_session.state in ('completed', 'abandoned') then return; end if;

  if v_session.deadline is not null and clock_timestamp() >= v_session.deadline then
    perform private.complete(p_id);
    return;
  end if;

  select snapshot.question_id into v_question_id
  from private.session_questions as snapshot
  where snapshot.session_id = p_id
    and not exists (
      select 1 from private.answer_submissions as answer
      where answer.session_id = p_id and answer.question_id = snapshot.question_id
    )
    and (v_session.mode <> 'endless' or snapshot.difficulty = v_session.difficulty)
  order by random()
  limit 1;

  if v_question_id is null then
    perform private.complete(p_id);
    return;
  end if;

  update private.game_sessions
  set current_question = v_question_id,
      state = 'awaiting_answer',
      question_started_at = clock_timestamp(),
      feedback_started_at = null,
      version = version + 1
  where id = p_id;
end;
$function$;

create or replace function public.arena_answer(
  p_id uuid,
  p_question uuid,
  p_option text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.game_sessions;
  v_snapshot private.session_questions;
  v_correct boolean;
  v_streak integer;
  v_tier_streak integer;
  v_next_difficulty text;
  v_threshold integer;
  v_points integer;
  v_ms bigint;
  v_now timestamptz;
begin
  perform private.rate('answer', 180);
  v_session := private.owned_locked(p_id);

  if v_session.state in ('completed', 'abandoned') then raise exception 'SESSION_CLOSED'; end if;
  if v_session.deadline is not null and clock_timestamp() >= v_session.deadline then
    perform private.complete(p_id);
    return private.view(p_id);
  end if;
  if v_session.state <> 'awaiting_answer' or v_session.current_question is distinct from p_question then
    raise exception 'DUPLICATE_OR_STALE_ANSWER';
  end if;

  select snapshot.* into v_snapshot
  from private.session_questions as snapshot
  where snapshot.session_id = p_id and snapshot.question_id = p_question;
  if not found then raise exception 'INVALID_QUESTION'; end if;
  if p_option is null or not exists (
    select 1 from jsonb_array_elements(v_snapshot.question -> 'options') as option_entry(value)
    where option_entry.value ->> 'id' = p_option
  ) then raise exception 'INVALID_OPTION'; end if;

  v_now := clock_timestamp();
  if v_session.deadline is not null and v_now >= v_session.deadline then
    perform private.complete(p_id);
    return private.view(p_id);
  end if;

  v_correct := p_option = v_snapshot.correct_option;
  v_streak := case when v_correct then v_session.streak + 1 else 0 end;
  v_points := case when v_correct then
    (case v_snapshot.difficulty when 'easy' then 100 when 'medium' then 125 when 'hard' then 150 else 200 end)
      + least(50, 10 * greatest(0, v_streak - 1))
    else 0 end;
  -- response_ms ends at the accepted answer; feedback reading time is excluded.
  v_ms := greatest(0, floor(extract(epoch from (v_now - v_session.question_started_at)) * 1000))::bigint;

  v_tier_streak := case
    when v_session.mode <> 'endless' then v_session.endless_tier_streak
    when not v_correct then 0
    when v_snapshot.difficulty = v_session.difficulty then v_session.endless_tier_streak + 1
    else v_session.endless_tier_streak
  end;
  v_next_difficulty := v_session.difficulty;
  v_threshold := case v_session.difficulty when 'easy' then 5 when 'medium' then 7 when 'hard' then 10 else 10 end;
  if v_session.mode = 'endless' and v_correct
    and v_snapshot.difficulty = v_session.difficulty
    and v_tier_streak >= v_threshold then
    v_next_difficulty := case v_session.difficulty
      when 'easy' then 'medium' when 'medium' then 'hard' when 'hard' then 'expert' else 'expert' end;
    if v_next_difficulty <> v_session.difficulty then v_tier_streak := 0; end if;
  end if;

  insert into private.answer_submissions(session_id, question_id, option_id, accepted_at, correct, points, response_ms)
  values (p_id, p_question, p_option, v_now, v_correct, v_points, v_ms);

  update private.game_sessions
  set score = score + v_points,
      correct = correct + v_correct::integer,
      incorrect = incorrect + (not v_correct)::integer,
      streak = v_streak,
      best_streak = greatest(best_streak, v_streak),
      response_ms = response_ms + v_ms,
      difficulty = v_next_difficulty,
      endless_tier_streak = v_tier_streak,
      feedback_started_at = v_now,
      state = 'showing_feedback',
      version = version + 1
  where id = p_id;

  if (v_session.mode = 'endless' and v_session.incorrect + (not v_correct)::integer >= 3)
    or not exists (
      select 1 from private.session_questions as snapshot
      where snapshot.session_id = p_id
        and not exists (select 1 from private.answer_submissions as answer
          where answer.session_id = p_id and answer.question_id = snapshot.question_id)
    ) then
    perform private.complete(p_id);
  end if;

  return private.view(p_id);
end;
$function$;

create or replace function public.arena_next(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.game_sessions;
  v_now timestamptz;
begin
  perform private.rate('next', 180);
  v_session := private.owned_locked(p_id);
  if v_session.state in ('completed', 'abandoned') then raise exception 'SESSION_CLOSED'; end if;
  if v_session.state <> 'showing_feedback' then raise exception 'INVALID_TRANSITION'; end if;

  v_now := clock_timestamp();
  if v_session.deadline is not null and v_session.feedback_started_at is not null then
    update private.game_sessions
    set deadline = deadline + greatest(interval '0 seconds', v_now - feedback_started_at),
        feedback_started_at = null
    where id = p_id;
  end if;

  select session.* into v_session from private.game_sessions as session where session.id = p_id;
  if v_session.deadline is not null and v_now >= v_session.deadline then
    perform private.complete(p_id);
  else
    perform private.select_next(p_id);
  end if;
  return private.view(p_id);
end;
$function$;
