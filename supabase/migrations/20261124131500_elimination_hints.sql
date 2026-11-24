begin;
-- Category Elimination: opt-in hints during an active round.
--
-- A hint shows the candidate list for the CURRENT open clue step of ONE group: every place that fits all clues
-- revealed so far in that group (clues 1..k, where k = solved steps + 1). Naming any of them advances the group,
-- so a hint is a real cost:
--   * Each round has a small fixed budget (hint_limit, default 3). Spending one is recorded in `hints` as
--     {"group": g, "step": k}. Asking again for the same group and step is free (idempotent), so the player can
--     re-open a hint they already paid for.
--   * A round with at least one hint is "hinted". It still finishes normally, but it never counts as the
--     personal best of a puzzle (arena_elim_catalog.best), exactly like unranked practice rounds elsewhere.
--     Elimination has no points, XP or leaderboard entry, and arena_personal_bests / arena_game_stats /
--     arena_achievements do not read elimination sessions, so the catalog best is the only best to protect.
--     Rounds without hints (every existing row: hints defaults to []) keep exactly the same best as before.
--
-- Spoiler limits (decided here, never in the browser):
--   * Never a hint for the group's last clue, or for any step whose count is 1: clue chains only narrow, so a
--     single remaining place is the group's unique final answer (ELIMINATION_HINT_LAST_CLUE).
--   * Only the current open step of the requested group: no lists for earlier steps (they are supersets with
--     places ruled out later), no `depth` beyond k, no lists for other groups, no group answer.
--   * Nothing for a finished round: arena_elim_candidates already covers that (ELIMINATION_ROUND_OVER).

alter table private.elimination_sessions
  add column hints jsonb not null default '[]'::jsonb,
  add column hint_limit integer not null default 3 check (hint_limit between 0 and 10);

-- Same output as before (20261123223550_category_elimination.sql), plus hinted / hintsUsed / hintsLeft / hintLimit
-- and the list of bought hints ({group, step}, 1-based) so the client knows which hint can be re-opened for free.
create or replace function private.elim_view(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.elimination_sessions;
  v_puzzle private.elimination_puzzles;
  v_done boolean;
  v_total integer;
  v_used integer;
begin
  select * into v_session from private.elimination_sessions as session where session.id = p_id;
  select * into v_puzzle from private.elimination_puzzles as puzzle where puzzle.id = v_session.puzzle_id;
  v_done := v_session.state <> 'active';
  v_used := jsonb_array_length(v_session.hints);
  select sum(jsonb_array_length(grp.value -> 'clues'))::integer into v_total from jsonb_array_elements(v_puzzle.groups) as grp(value);
  return jsonb_build_object(
    'id', v_session.id, 'puzzleId', v_puzzle.id, 'difficulty', v_puzzle.difficulty, 'number', v_puzzle.number,
    'pool', v_puzzle.pool, 'state', v_session.state, 'endReason', v_session.end_reason,
    'timeLimitSeconds', v_puzzle.time_limit_seconds, 'deadlineAt', v_session.deadline_at, 'serverNow', clock_timestamp(),
    'elapsedMs', coalesce(v_session.elapsed_ms, (extract(epoch from (clock_timestamp() - v_session.created_at)) * 1000)::bigint),
    'solved', private.elim_solved(v_session.progress), 'total', v_total,
    'guesses', v_session.guesses, 'wrong', v_session.wrong,
    'hinted', v_used > 0, 'hintsUsed', v_used, 'hintLimit', v_session.hint_limit,
    'hintsLeft', greatest(v_session.hint_limit - v_used, 0), 'hints', v_session.hints,
    'groups', (
      select jsonb_agg(jsonb_build_object(
        'colour', grp.value ->> 'colour',
        'size', jsonb_array_length(grp.value -> 'clues'),
        'solved', jsonb_array_length(v_session.progress -> (grp.position::integer - 1)),
        'answer', case when v_done then (select jsonb_build_object('code', place.code, 'name', place.name)
          from private.elimination_places as place where place.code = grp.value ->> 'answer') end,
        'steps', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'label', clue.value ->> 'label',
            'remaining', (clue.value ->> 'n')::integer,
            'answer', (select jsonb_build_object('code', place.code, 'name', place.name)
              from private.elimination_places as place
              where place.code = v_session.progress -> (grp.position::integer - 1) ->> (clue.position::integer - 1))
          ) order by clue.position), '[]'::jsonb)
          from jsonb_array_elements(grp.value -> 'clues') with ordinality as clue(value, position)
          where v_done or clue.position <= jsonb_array_length(v_session.progress -> (grp.position::integer - 1)) + 1
        )
      ) order by grp.position)
      from jsonb_array_elements(v_puzzle.groups) with ordinality as grp(value, position)
    )
  );
end;
$$;

-- Same as before, except that `best` ignores hinted rounds. `plays` still counts every completed round.
create or replace function public.arena_elim_catalog()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  perform private.rate('elim_catalog', 60);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', puzzle.id, 'difficulty', puzzle.difficulty, 'number', puzzle.number, 'pool', puzzle.pool,
      'timeLimitSeconds', puzzle.time_limit_seconds,
      'groups', jsonb_array_length(puzzle.groups),
      'total', (select sum(jsonb_array_length(grp.value -> 'clues'))::integer from jsonb_array_elements(puzzle.groups) as grp(value)),
      'plays', (select count(*) from private.elimination_sessions as session
        where session.user_id = v_uid and session.puzzle_id = puzzle.id and session.state = 'completed'),
      'best', (select jsonb_build_object('solved', private.elim_solved(session.progress), 'elapsedMs', session.elapsed_ms)
        from private.elimination_sessions as session
        where session.user_id = v_uid and session.puzzle_id = puzzle.id and session.state = 'completed'
          and jsonb_array_length(session.hints) = 0
        order by private.elim_solved(session.progress) desc, session.elapsed_ms asc limit 1),
      'activeId', (select session.id from private.elimination_sessions as session
        where session.user_id = v_uid and session.puzzle_id = puzzle.id and session.state = 'active'
          and session.deadline_at > clock_timestamp()
        order by session.created_at desc limit 1)
    ) order by case puzzle.difficulty when 'easy' then 1 when 'medium' then 2 else 3 end, puzzle.number), '[]'::jsonb)
    from private.elimination_puzzles as puzzle
  );
end;
$$;

-- Spends (or re-opens) a hint for the current open clue step of one group (1-based).
-- Shape matches arena_elim_candidates, cut to the current step: `steps` holds clues 1..k only (with the
-- player's picks for the solved ones), every place in `places` fits clues 1..k and has depth = k, and
-- `answer` is always null. Adds `step` (k), `size`, `free` (true when this hint was already paid for) and `view`.
create or replace function public.arena_elim_hint(p_id uuid, p_group integer)
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
  v_step integer;
  v_key jsonb;
  v_free boolean;
begin
  perform private.rate('elim_hint', 30);
  select * into v_session from private.elimination_sessions as session
    where session.id = p_id and session.user_id = v_uid for update;
  if not found then raise exception 'ELIMINATION_NOT_FOUND'; end if;

  -- Close the round first if its time is up; hints only exist while a round is active.
  if private.elim_expire(p_id) then raise exception 'ELIMINATION_ROUND_OVER'; end if;

  select * into v_puzzle from private.elimination_puzzles as puzzle where puzzle.id = v_session.puzzle_id;
  if p_group is null or p_group < 1 or p_group > jsonb_array_length(v_puzzle.groups) then
    raise exception 'INVALID_ELIMINATION_GROUP';
  end if;
  v_group := v_puzzle.groups -> (p_group - 1);
  v_picks := coalesce(v_session.progress -> (p_group - 1), '[]'::jsonb);
  v_size := jsonb_array_length(v_group -> 'clues');
  v_step := jsonb_array_length(v_picks) + 1;
  if v_step > v_size then raise exception 'ELIMINATION_GROUP_SOLVED'; end if;
  -- A single remaining place is the group's final answer (chains only narrow): never sold as a hint.
  if v_step >= v_size or (v_group -> 'clues' -> (v_step - 1) ->> 'n')::integer <= 1 then
    raise exception 'ELIMINATION_HINT_LAST_CLUE';
  end if;

  v_key := jsonb_build_object('group', p_group, 'step', v_step);
  v_free := v_session.hints @> jsonb_build_array(v_key);
  if not v_free then
    if jsonb_array_length(v_session.hints) >= v_session.hint_limit then
      raise exception 'ELIMINATION_NO_HINTS_LEFT';
    end if;
    update private.elimination_sessions as session set hints = session.hints || jsonb_build_array(v_key)
      where session.id = p_id;
  end if;

  return jsonb_build_object(
    'group', p_group,
    'colour', v_group ->> 'colour',
    'answer', null::jsonb,
    'step', v_step,
    'size', v_size,
    'free', v_free,
    'steps', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'label', clue.value ->> 'label',
        'remaining', (clue.value ->> 'n')::integer,
        'pick', (select jsonb_build_object('code', place.code, 'name', place.name)
          from private.elimination_places as place
          where place.code = v_picks ->> (clue.position::integer - 1))
      ) order by clue.position), '[]'::jsonb)
      from jsonb_array_elements(v_group -> 'clues') with ordinality as clue(value, position)
      where clue.position <= v_step
    ),
    'places', (
      select coalesce(jsonb_agg(jsonb_build_object('code', place.code, 'name', place.name, 'depth', v_step)
        order by place.name, place.code), '[]'::jsonb)
      from private.elimination_places as place
      where place.playable and (v_puzzle.pool = 'all' or place.un)
        and private.elim_matches(place.facts, v_group -> 'clues', v_step)
    ),
    'view', private.elim_view(p_id)
  );
end;
$$;

revoke all on function private.elim_view(uuid) from public, anon, authenticated;
revoke all on function public.arena_elim_catalog(), public.arena_elim_hint(uuid, integer) from public, anon;
grant execute on function public.arena_elim_catalog(), public.arena_elim_hint(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
