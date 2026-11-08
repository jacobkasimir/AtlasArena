begin;

create or replace function public.arena_leaderboard()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
begin
  perform private.rate('leaderboard', 60);

  return (
    with ranked as materialized (
      select
        profile.id,
        profile.username,
        profile.avatar,
        profile.xp,
        row_number() over (
          order by profile.xp desc, profile.created_at asc,
            lower(profile.username), profile.id
        ) as player_rank
      from public.profiles as profile
      where profile.username_confirmed
        and profile.xp > 0
    )
    select jsonb_build_object(
      'currentRank', (
        select ranked.player_rank
        from ranked
        where ranked.id = v_uid
      ),
      'players', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'rank', top_players.player_rank,
            'username', top_players.username,
            'avatar', top_players.avatar,
            'xp', top_players.xp
          )
          order by top_players.player_rank
        )
        from (
          select ranked.player_rank, ranked.username, ranked.avatar, ranked.xp
          from ranked
          order by ranked.player_rank
          limit 25
        ) as top_players
      ), '[]'::jsonb)
    )
  );
end;
$function$;

revoke all on function public.arena_leaderboard()
  from public, anon, authenticated;
grant execute on function public.arena_leaderboard()
  to authenticated;

notify pgrst, 'reload schema';
commit;
