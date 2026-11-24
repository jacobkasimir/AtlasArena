begin;
-- Category Elimination: the full list of places behind the number shown beside each clue.
--
-- SPOILER RULE (decided on the server, never in the browser):
--   Candidate lists are only returned once the round is no longer active – all chains solved, given up,
--   time up (private.elim_expire runs first, so an expired round is closed before the check) or abandoned
--   by starting the puzzle again. While a round is active this function raises ELIMINATION_CANDIDATES_LOCKED.
--
-- Why not earlier, e.g. for clue steps the player already solved?
--   * The list for clue k is every place that fits clues 1..k. It always contains every place that fits the
--     next, still open clue k+1 (each step only narrows the set), so showing it would turn the open clue
--     into a multiple-choice question. That holds for every solved step of an open group, including step 1.
--   * The lists of a group the player already finished are fact-filtered country lists ("more than 10 million
--     people" → 94 names) that routinely contain answers of the other, still open groups.
--   * The last clue's list is the group's unique answer, which arena_elim_view also only reveals at round end.
--   No list can therefore be shown during play without handing out something the player has not earned.
--
-- Shape: the group's clue steps (label, count, the player's pick per step) plus every place that fits
-- clue 1, each with `depth` = the last clue step it still fits (1..size). The list for step k is every
-- place with depth >= k; a place with depth = k (k < size) is ruled out by clue k+1. Clue chains are
-- cumulative (private.elim_matches checks clues 1..k), so depth is well defined.

create or replace function public.arena_elim_candidates(p_id uuid, p_group integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_session private.elimination_sessions;
  v_puzzle private.elimination_puzzles;
  v_group jsonb;
  v_picks jsonb;
  v_size integer;
begin
  perform private.rate('elim_candidates', 60);
  select * into v_session from private.elimination_sessions as session
    where session.id = p_id and session.user_id = v_uid for update;
  if not found then raise exception 'ELIMINATION_NOT_FOUND'; end if;

  -- Close the round first if its time is up, then read the state again.
  perform private.elim_expire(p_id);
  select * into v_session from private.elimination_sessions as session where session.id = p_id;
  if v_session.state = 'active' then raise exception 'ELIMINATION_CANDIDATES_LOCKED'; end if;

  select * into v_puzzle from private.elimination_puzzles as puzzle where puzzle.id = v_session.puzzle_id;
  if p_group is null or p_group < 1 or p_group > jsonb_array_length(v_puzzle.groups) then
    raise exception 'INVALID_ELIMINATION_GROUP';
  end if;
  v_group := v_puzzle.groups -> (p_group - 1);
  v_picks := coalesce(v_session.progress -> (p_group - 1), '[]'::jsonb);
  v_size := jsonb_array_length(v_group -> 'clues');

  return jsonb_build_object(
    'group', p_group,
    'colour', v_group ->> 'colour',
    'answer', (select jsonb_build_object('code', place.code, 'name', place.name)
      from private.elimination_places as place where place.code = v_group ->> 'answer'),
    'steps', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'label', clue.value ->> 'label',
        'remaining', (clue.value ->> 'n')::integer,
        'pick', (select jsonb_build_object('code', place.code, 'name', place.name)
          from private.elimination_places as place
          where place.code = v_picks ->> (clue.position::integer - 1))
      ) order by clue.position), '[]'::jsonb)
      from jsonb_array_elements(v_group -> 'clues') with ordinality as clue(value, position)
    ),
    'places', (
      select coalesce(jsonb_agg(jsonb_build_object('code', fit.code, 'name', fit.name, 'depth', fit.depth)
        order by fit.name, fit.code), '[]'::jsonb)
      from (
        select place.code, place.name,
          (select max(step.n) from generate_series(1, v_size) as step(n)
            where private.elim_matches(place.facts, v_group -> 'clues', step.n)) as depth
        from private.elimination_places as place
        where place.playable and (v_puzzle.pool = 'all' or place.un)
      ) as fit
      where fit.depth is not null
    )
  );
end;
$$;

revoke all on function public.arena_elim_candidates(uuid, integer) from public, anon;
grant execute on function public.arena_elim_candidates(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
