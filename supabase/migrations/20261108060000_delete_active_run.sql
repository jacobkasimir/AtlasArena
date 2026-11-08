create or replace function public.arena_delete_run(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.game_sessions;
begin
  perform private.rate('delete_run', 30);
  v_session := private.owned_locked(p_id);

  if v_session.state not in ('awaiting_answer', 'showing_feedback') then
    raise exception 'RUN_NOT_ACTIVE';
  end if;

  delete from private.game_sessions
  where id = p_id and user_id = v_session.user_id;
end;
$function$;

revoke all on function public.arena_delete_run(uuid) from public, anon, authenticated;
grant execute on function public.arena_delete_run(uuid) to authenticated;

notify pgrst, 'reload schema';
