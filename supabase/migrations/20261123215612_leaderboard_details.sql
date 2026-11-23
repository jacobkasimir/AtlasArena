begin;
-- Leaderboard with more detail: level, XP, best answer streak, daily-challenge streak, games and accuracy,
-- an all-time and a 7-day ranking, the caller's own row (even outside the top 25) and the gap to the next rank.
drop function if exists public.arena_leaderboard();
create or replace function public.arena_leaderboard(p_period text default 'all')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_since timestamptz;
  v_today date := private.daily_today();
begin
  if p_period is null or p_period not in ('all', 'week') then raise exception 'INVALID_LEADERBOARD_PERIOD'; end if;
  perform private.rate('leaderboard', 60);
  v_since := case when p_period = 'week' then clock_timestamp() - interval '7 days' end;

  return (
    with stats as (
      select game.user_id,
        count(*) filter (where game.state = 'completed') as games,
        coalesce(sum(game.correct) filter (where game.state = 'completed' and game.mode <> 'practice'), 0) as correct,
        coalesce(sum(game.incorrect) filter (where game.state = 'completed' and game.mode <> 'practice'), 0) as incorrect,
        coalesce(max(game.best_streak), 0) as best_streak,
        max(game.completed_at) as last_played
      from private.game_sessions as game
      group by game.user_id
    ), period_xp as (
      select event.user_id, sum(event.amount)::integer as xp
      from public.xp_events as event
      where v_since is not null and event.created_at >= v_since
      group by event.user_id
    ), players as materialized (
      select profile.id, profile.username, profile.avatar, profile.xp, profile.created_at,
        case when v_since is null then profile.xp else coalesce(period_xp.xp, 0) end as points,
        coalesce(stats.games, 0) as games, coalesce(stats.correct, 0) as correct,
        coalesce(stats.incorrect, 0) as incorrect, coalesce(stats.best_streak, 0) as best_streak,
        stats.last_played
      from public.profiles as profile
      left join stats on stats.user_id = profile.id
      left join period_xp on period_xp.user_id = profile.id
      where profile.username_confirmed
    ), ordered as materialized (
      select players.id, players.points,
        row_number() over (order by players.points desc, players.xp desc, players.created_at asc,
          lower(players.username), players.id) as player_rank
      from players
      where players.points > 0
    ), shown as (
      select players.*, ordered.player_rank
      from players
      left join ordered on ordered.id = players.id
      where ordered.player_rank <= 25 or players.id = v_uid
    ), entries as (
      select shown.id, shown.player_rank, jsonb_build_object(
        'rank', shown.player_rank, 'username', shown.username, 'avatar', shown.avatar,
        'xp', shown.xp, 'points', shown.points, 'level', 1 + shown.xp / 500,
        'games', shown.games,
        'accuracy', case when shown.correct + shown.incorrect > 0
          then round(100.0 * shown.correct / (shown.correct + shown.incorrect))::integer end,
        'bestStreak', shown.best_streak,
        'dailyStreak', coalesce((private.daily_streaks(shown.id, v_today) ->> 'current')::integer, 0),
        'lastPlayedAt', shown.last_played,
        'isYou', shown.id = v_uid
      ) as entry
      from shown
    )
    select jsonb_build_object(
      'period', p_period,
      'totalPlayers', (select count(*) from ordered),
      'currentRank', (select ordered.player_rank from ordered where ordered.id = v_uid),
      'players', coalesce((select jsonb_agg(entries.entry order by entries.player_rank) from entries where entries.player_rank <= 25), '[]'::jsonb),
      'you', (select entries.entry from entries where entries.id = v_uid),
      'ahead', (
        select jsonb_build_object('rank', above.player_rank, 'username', profile.username, 'gap', above.points - me.points + 1)
        from ordered as me
        join ordered as above on above.player_rank = me.player_rank - 1
        join public.profiles as profile on profile.id = above.id
        where me.id = v_uid
      )
    )
  );
end;
$function$;

revoke all on function public.arena_leaderboard(text) from public, anon;
grant execute on function public.arena_leaderboard(text) to authenticated;

notify pgrst, 'reload schema';
commit;
