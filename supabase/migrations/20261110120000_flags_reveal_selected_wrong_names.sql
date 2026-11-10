-- Reveal a choice's label only after that option has actually been selected
-- incorrectly in the current Country -> Flag question.
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

  select * into v_current
  from private.flags_session_entries as entry
  where entry.session_id = v_session.id and entry.position = v_session.current_position;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', entry.entry_id,
    'choicePosition', entry.choice_position,
    'flagSvgUrl', entry.flag_svg_url,
    'flagPngUrl', entry.flag_png_url,
    'flagDescription', entry.flag_description,
    'name', case
      when v_session.direction = 'country_to_flag'
        and entry.entry_id = any(coalesce(v_current.wrong_choice_ids, array[]::uuid[]))
      then entry.name else null end
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

  if v_current.entry_id is not null and v_session.state in ('active', 'paused') then
    v_current_json := jsonb_build_object(
      'id', v_current.entry_id,
      'position', v_current.position,
      'choicePosition', v_current.choice_position,
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
