-- 1. arena_export() now returns every game's data (Flags, Capitals, Recall were missing).
--    Entries of rounds that are still running are limited to finalized answers so an
--    export cannot be used to read upcoming solutions. Recall answer hashes/salts are omitted.
-- 2. arena_capitals_bests(): best completed run per setup, for the Capitals setup and Home.
begin;

create or replace function public.arena_export()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
begin
  perform private.rate('export', 3);

  return jsonb_build_object(
    'exportedAt', clock_timestamp(),
    'profile', (select to_jsonb(profile) from public.profiles as profile where profile.id = v_uid),
    'sessions', coalesce((
      select jsonb_agg(to_jsonb(session) || jsonb_build_object('acceptedAnswerReviews', private.reviews(session.id))
        order by session.created_at, session.id)
      from private.game_sessions as session where session.user_id = v_uid
    ), '[]'::jsonb),
    'xpEvents', coalesce((select jsonb_agg(to_jsonb(event)) from public.xp_events as event where event.user_id = v_uid), '[]'::jsonb),
    'categoryStats', coalesce((select jsonb_agg(to_jsonb(stats)) from public.player_category_stats as stats where stats.user_id = v_uid), '[]'::jsonb),
    'flagsRounds', coalesce((
      select jsonb_agg(to_jsonb(session) || jsonb_build_object('entries', coalesce((
          select jsonb_agg(to_jsonb(entry) - 'aliases' order by entry.position)
          from private.flags_session_entries as entry
          where entry.session_id = session.id and (session.state <> 'active' or entry.outcome <> 'pending')
        ), '[]'::jsonb)) order by session.created_at)
      from private.flags_sessions as session where session.user_id = v_uid
    ), '[]'::jsonb),
    'capitalsRounds', coalesce((
      select jsonb_agg((to_jsonb(session) - 'vocabulary' - 'ambiguous_country_aliases') || jsonb_build_object('entries', coalesce((
          select jsonb_agg(to_jsonb(entry) - 'country_aliases' - 'last_request_id' order by entry.position)
          from private.capital_session_entries as entry
          where entry.session_id = session.id and (session.state <> 'active' or entry.outcome <> 'pending')
        ), '[]'::jsonb)) order by session.created_at)
      from private.capital_sessions as session where session.user_id = v_uid
    ), '[]'::jsonb),
    'recallRounds', coalesce((
      select jsonb_agg((to_jsonb(session) - 'salt' - 'ambiguous_hashes' - 'start_request_id') || jsonb_build_object('entries', coalesce((
          select jsonb_agg(to_jsonb(entry) - 'alias_keys' - 'alias_hashes' - 'alias_langs' order by entry.position)
          from private.recall_session_entries as entry
          where entry.session_id = session.id and (session.state <> 'active' or entry.found_at is not null)
        ), '[]'::jsonb)) order by session.created_at)
      from private.recall_sessions as session where session.user_id = v_uid
    ), '[]'::jsonb)
  );
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
        'direction', ranked.direction, 'poolMode', ranked.pool_mode, 'region', ranked.region,
        'selectedCount', cardinality(ranked.selected_codes), 'total', ranked.pool_count,
        'score', ranked.score, 'maxScore', ranked.pool_count * 100, 'correct', ranked.correct_count,
        'elapsedMs', ranked.elapsed_ms, 'completedAt', ranked.completed_at, 'runCount', ranked.run_count
      ) as best
      from (
        select session.*,
          row_number() over (partition by session.direction, session.pool_signature
            order by session.score desc, session.elapsed_ms asc, session.completed_at asc) as rank_in_setup,
          count(*) over (partition by session.direction, session.pool_signature) as run_count
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

revoke all on function public.arena_capitals_bests() from public, anon, authenticated;
grant execute on function public.arena_capitals_bests() to authenticated;
notify pgrst, 'reload schema';
commit;
