begin;

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
    select
      session.direction,
      session.region,
      session.pool_tier,
      session.rules_version,
      session.pool_signature,
      session.pool_count,
      session.score,
      session.elapsed_ms,
      session.correct_count,
      session.incorrect_count,
      session.skipped_count,
      session.hints_used,
      session.completed_at,
      row_number() over (
        partition by session.direction, session.region, session.pool_tier,
          session.rules_version, session.pool_signature
        order by session.score desc, session.elapsed_ms asc, session.completed_at asc
      ) as run_rank,
      count(*) over (
        partition by session.direction, session.region, session.pool_tier,
          session.rules_version, session.pool_signature
      ) as run_count
    from private.flags_sessions as session
    where session.user_id = v_uid and session.state = 'completed'
  ), boards as (
    select distinct
      direction, region, pool_tier, rules_version, pool_signature, pool_count,
      run_count,
      max(completed_at) over (
        partition by direction, region, pool_tier, rules_version, pool_signature
      ) as latest_at
    from ranked
  ), versioned_boards as (
    select boards.*,
      row_number() over (
        partition by direction, region, pool_tier, rules_version
        order by latest_at desc, pool_signature
      ) as pool_version
    from boards
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'direction', board.direction,
      'region', board.region,
      'poolTier', board.pool_tier,
      'poolVersion', board.pool_version,
      'total', board.pool_count,
      'runCount', board.run_count,
      'topFive', coalesce((
        select jsonb_agg(jsonb_build_object(
          'score', run.score,
          'maxScore', board.pool_count * 100 -
            case when board.direction = 'flag_to_country' then run.hints_used * 40 else 0 end,
          'elapsedMs', run.elapsed_ms,
          'correct', run.correct_count,
          'incorrect', run.incorrect_count,
          'skipped', run.skipped_count,
          'hintsUsed', run.hints_used,
          'completedAt', run.completed_at
        ) order by run.run_rank)
        from ranked as run
        where run.direction = board.direction
          and run.region is not distinct from board.region
          and run.pool_tier = board.pool_tier
          and run.rules_version = board.rules_version
          and run.pool_signature = board.pool_signature
          and run.run_rank <= 5
      ), '[]'::jsonb)
    ) order by board.direction, board.region nulls first, board.pool_tier, board.pool_version
  ), '[]'::jsonb)
  into v_result
  from versioned_boards as board;

  return v_result;
end;
$function$;

revoke all on function public.arena_flags_bests() from public, anon, authenticated;
grant execute on function public.arena_flags_bests() to authenticated;

notify pgrst, 'reload schema';
commit;
