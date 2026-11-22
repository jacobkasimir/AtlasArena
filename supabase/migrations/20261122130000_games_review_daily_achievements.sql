-- Review my mistakes, Daily challenge, Achievements, and the admin review queue.
begin;

-- ===========================================================================
-- Review my mistakes
-- ===========================================================================
create table if not exists private.review_cleared (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null,
  cleared_at timestamptz not null default clock_timestamp(),
  primary key (user_id, item_key)
);
create table if not exists private.review_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_request_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  total integer not null check (total between 1 and 10),
  correct integer not null default 0 check (correct >= 0),
  unique (user_id, start_request_id)
);
create table if not exists private.review_items (
  session_id uuid not null references private.review_sessions(id) on delete cascade,
  position integer not null check (position > 0),
  item_key text not null,
  kind text not null check (kind in ('quiz', 'flag', 'capital')),
  ref text not null,
  payload jsonb not null,
  solution text not null,
  explanation text,
  correct_option text,
  answered_at timestamptz,
  answer text,
  correct boolean,
  primary key (session_id, position)
);
alter table private.review_cleared enable row level security;
alter table private.review_sessions enable row level security;
alter table private.review_items enable row level security;
revoke all on private.review_cleared, private.review_sessions, private.review_items from public, anon, authenticated;

-- Open mistakes of one user across all games. A mistake stays open until it is answered
-- correctly in a review after it happened (quiz questions also close when answered
-- correctly in a later quiz game).
create or replace function private.review_candidates(p_uid uuid)
returns table (item_key text, kind text, last_wrong timestamptz, ref text)
language sql
stable
security definer
set search_path = ''
as $function$
  with quiz as (
    select 'quiz:' || submission.question_id as item_key, 'quiz'::text as kind,
      max(submission.accepted_at) as last_wrong, submission.question_id::text as ref
    from private.answer_submissions as submission
    join private.game_sessions as game on game.id = submission.session_id
    where game.user_id = p_uid and not submission.correct
      and not exists (
        select 1 from private.answer_submissions as later
        join private.game_sessions as later_game on later_game.id = later.session_id
        where later_game.user_id = p_uid and later.question_id = submission.question_id
          and later.correct and later.accepted_at > submission.accepted_at)
    group by submission.question_id
  ), flag as (
    select 'country:' || entry.country_code, 'flag'::text,
      max(coalesce(entry.finalized_at, round.completed_at, round.created_at)), entry.country_code
    from private.flags_session_entries as entry
    join private.flags_sessions as round on round.id = entry.session_id
    where round.user_id = p_uid and entry.outcome in ('incorrect', 'skipped')
    group by entry.country_code
  ), capital as (
    select 'capital:' || entry.country_code, 'capital'::text,
      max(coalesce(entry.finalized_at, round.completed_at, round.created_at)), entry.country_code
    from private.capital_session_entries as entry
    join private.capital_sessions as round on round.id = entry.session_id
    where round.user_id = p_uid and entry.outcome in ('incorrect', 'skipped')
    group by entry.country_code
  ), recall as (
    select case when round.kind = 'countries' then 'country:' else 'capital:' end || entry.country_code,
      case when round.kind = 'countries' then 'flag' else 'capital' end,
      max(round.completed_at), entry.country_code
    from private.recall_session_entries as entry
    join private.recall_sessions as round on round.id = entry.session_id
    where round.user_id = p_uid and round.state = 'completed' and entry.found_at is null
    group by 1, 2, 4
  ), merged as (
    select * from quiz union all select * from flag union all select * from capital union all select * from recall
  )
  select merged.item_key, min(merged.kind), max(merged.last_wrong), min(merged.ref)
  from merged
  group by merged.item_key
  having not exists (
    select 1 from private.review_cleared as cleared
    where cleared.user_id = p_uid and cleared.item_key = merged.item_key and cleared.cleared_at >= max(merged.last_wrong)
  );
$function$;

create or replace function private.review_view(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', session.id, 'total', session.total, 'correct', session.correct,
    'answered', (select count(*) from private.review_items as item where item.session_id = session.id and item.answered_at is not null),
    'completed', session.completed_at is not null, 'createdAt', session.created_at,
    'items', (select coalesce(jsonb_agg(item.payload || jsonb_build_object(
        'position', item.position, 'kind', item.kind, 'answered', item.answered_at is not null,
        'answer', item.answer, 'correct', item.correct,
        'solution', case when item.answered_at is not null then item.solution end,
        'explanation', case when item.answered_at is not null then item.explanation end,
        'correctOption', case when item.answered_at is not null then item.correct_option end
      ) order by item.position), '[]'::jsonb)
      from private.review_items as item where item.session_id = session.id)
  )
  from private.review_sessions as session where session.id = p_session_id;
$function$;

create or replace function public.arena_review_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
begin
  perform private.rate('review_summary', 60);
  return jsonb_build_object(
    'open', (select count(*) from private.review_candidates(v_uid)),
    'byKind', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (
      select candidate.kind, count(*) as n from private.review_candidates(v_uid) as candidate group by candidate.kind) as kinds),
    'activeId', (select session.id from private.review_sessions as session
      where session.user_id = v_uid and session.completed_at is null order by session.created_at desc limit 1),
    'cleared', (select count(*) from private.review_cleared as cleared where cleared.user_id = v_uid)
  );
end;
$function$;

create or replace function public.arena_review_start(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session_id uuid;
  v_total integer;
begin
  if p_request_id is null then raise exception 'INVALID_REVIEW_REQUEST'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || 'review', 0));
  select session.id into v_session_id from private.review_sessions as session
    where session.user_id = v_uid and (session.start_request_id = p_request_id or session.completed_at is null)
    order by session.created_at desc limit 1;
  if found then return private.review_view(v_session_id); end if;
  perform private.rate('review_start', 12);

  create temporary table if not exists review_pick (
    position integer, item_key text, kind text, ref text, payload jsonb, solution text, explanation text, correct_option text
  ) on commit drop;
  truncate pg_temp.review_pick;

  insert into pg_temp.review_pick
  select row_number() over (order by random())::integer, picked.item_key, picked.kind, picked.ref,
    picked.payload, picked.solution, picked.explanation, picked.correct_option
  from (
    select candidate.item_key, candidate.kind, candidate.ref,
      case candidate.kind
        when 'quiz' then jsonb_build_object('prompt', snapshot.question ->> 'prompt',
          'options', (select jsonb_agg(option_item order by random()) from jsonb_array_elements(snapshot.question -> 'options') as options(option_item)),
          'difficulty', snapshot.difficulty)
        when 'flag' then jsonb_build_object('prompt', 'Which country does this flag belong to?',
          'alpha2', catalog.alpha2, 'flagSvgUrl', country.flag_svg_url)
        else jsonb_build_object('prompt', 'What is the capital of ' || catalog.name || '?',
          'alpha2', catalog.alpha2, 'country', catalog.name)
      end as payload,
      case candidate.kind
        when 'quiz' then (select option_item ->> 'label' from jsonb_array_elements(snapshot.question -> 'options') as options(option_item)
          where option_item ->> 'id' = snapshot.correct_option limit 1)
        when 'flag' then catalog.name
        else catalog.capital_display
      end as solution,
      case when candidate.kind = 'quiz' then snapshot.explanation end as explanation,
      case when candidate.kind = 'quiz' then snapshot.correct_option end as correct_option
    from private.review_candidates(v_uid) as candidate
    left join lateral (
      select question_snapshot.* from private.session_questions as question_snapshot
      join private.game_sessions as game on game.id = question_snapshot.session_id
      where candidate.kind = 'quiz' and game.user_id = v_uid and question_snapshot.question_id::text = candidate.ref
      order by game.created_at desc limit 1
    ) as snapshot on true
    left join private.recall_catalog() as catalog on candidate.kind <> 'quiz' and catalog.code = candidate.ref
    left join private.countries as country on country.code = candidate.ref
    where (candidate.kind = 'quiz' and snapshot.question_id is not null)
       or (candidate.kind = 'flag' and catalog.code is not null and (catalog.alpha2 is not null or country.flag_svg_url is not null))
       or (candidate.kind = 'capital' and catalog.code is not null and catalog.capital_display is not null)
    order by candidate.last_wrong desc
    limit 10
  ) as picked;

  select count(*) into v_total from pg_temp.review_pick;
  if v_total = 0 then raise exception 'NO_MISTAKES_TO_REVIEW'; end if;

  insert into private.review_sessions(user_id, start_request_id, total) values (v_uid, p_request_id, v_total)
  returning id into v_session_id;
  insert into private.review_items(session_id, position, item_key, kind, ref, payload, solution, explanation, correct_option)
  select v_session_id, pick.position, pick.item_key, pick.kind, pick.ref, pick.payload, pick.solution, pick.explanation, pick.correct_option
  from pg_temp.review_pick as pick;
  return private.review_view(v_session_id);
end;
$function$;

create or replace function public.arena_review_view(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
begin
  perform private.rate('review_view', 120);
  if not exists (select 1 from private.review_sessions as session where session.id = p_session_id and session.user_id = v_uid) then
    raise exception 'REVIEW_NOT_FOUND';
  end if;
  return private.review_view(p_session_id);
end;
$function$;

create or replace function public.arena_review_answer(p_session_id uuid, p_position integer, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_item private.review_items%rowtype;
  v_correct boolean;
  v_norm text;
begin
  if p_answer is null or length(p_answer) > 200 then raise exception 'INVALID_REVIEW_ANSWER'; end if;
  perform private.rate('review_answer', 120);
  perform 1 from private.review_sessions as session
    where session.id = p_session_id and session.user_id = v_uid and session.completed_at is null for update;
  if not found then raise exception 'REVIEW_NOT_ACTIVE'; end if;
  select * into v_item from private.review_items as item
    where item.session_id = p_session_id and item.position = p_position for update;
  if not found then raise exception 'REVIEW_ITEM_NOT_FOUND'; end if;
  if v_item.answered_at is not null then return private.review_view(p_session_id); end if;

  v_norm := private.recall_normalize(p_answer);
  v_correct := case v_item.kind
    when 'quiz' then p_answer = v_item.correct_option
    when 'flag' then v_norm <> '' and exists (
      select 1 from private.recall_catalog() as catalog, jsonb_array_elements(catalog.country_names) as names(item)
      where catalog.code = v_item.ref and private.recall_normalize(names.item ->> 'name') = v_norm)
    else v_norm <> '' and exists (
      select 1 from private.recall_catalog() as catalog, jsonb_array_elements(catalog.capital_names) as names(item)
      where catalog.code = v_item.ref and private.recall_normalize(names.item ->> 'name') = v_norm)
  end;

  update private.review_items set answered_at = clock_timestamp(), answer = left(p_answer, 200), correct = v_correct
    where session_id = p_session_id and position = p_position;
  if v_correct then
    insert into private.review_cleared(user_id, item_key) values (v_uid, v_item.item_key)
      on conflict (user_id, item_key) do update set cleared_at = clock_timestamp();
    update private.review_sessions set correct = correct + 1 where id = p_session_id;
  end if;
  update private.review_sessions set completed_at = clock_timestamp()
    where id = p_session_id and not exists (
      select 1 from private.review_items as item where item.session_id = p_session_id and item.answered_at is null);
  return private.review_view(p_session_id);
end;
$function$;

-- ===========================================================================
-- Daily challenge: the same 10 published questions for everyone each UTC day,
-- played once as a normal Classic game (same scoring and XP).
-- ===========================================================================
alter table private.game_sessions add column if not exists daily_date date;
create unique index if not exists game_sessions_daily_once on private.game_sessions(user_id, daily_date) where daily_date is not null;
create index if not exists game_sessions_daily_board on private.game_sessions(daily_date, score desc, response_ms asc)
  where daily_date is not null and state = 'completed';

create table if not exists private.daily_challenges (
  day date primary key,
  question_ids uuid[] not null check (cardinality(question_ids) between 1 and 10),
  created_at timestamptz not null default clock_timestamp()
);
alter table private.daily_challenges enable row level security;
revoke all on private.daily_challenges from public, anon, authenticated;

create or replace function private.daily_today()
returns date
language sql
stable
set search_path = ''
as $function$ select (pg_catalog.now() at time zone 'utc')::date; $function$;

create or replace function private.daily_questions(p_day date)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ids uuid[];
begin
  select challenge.question_ids into v_ids from private.daily_challenges as challenge where challenge.day = p_day;
  if found then return v_ids; end if;
  with eligible as (
    select question.id, question.difficulty, md5(p_day::text || question.stable_id) as h,
      case question.difficulty when 'easy' then 1 when 'medium' then 2 when 'hard' then 3 else 4 end as tier
    from private.questions as question
    where question.published and question.source_verified and question.review_status = 'reviewed' and question.kind = 'mc'
  ), ranked as (
    select eligible.*, row_number() over (partition by eligible.difficulty order by eligible.h) as rn from eligible
  ), quota as (
    select ranked.* from ranked where ranked.rn <= case ranked.difficulty when 'easy' then 3 when 'medium' then 3 else 2 end
  ), filler as (
    select ranked.* from ranked where ranked.id not in (select quota.id from quota)
    order by ranked.h limit greatest(0, 10 - (select count(*) from quota))
  ), chosen as (select * from quota union all select * from filler)
  select array_agg(chosen.id order by chosen.tier, chosen.h) into v_ids from chosen;
  if v_ids is null or cardinality(v_ids) < 10 then raise exception 'DAILY_NOT_ENOUGH_QUESTIONS'; end if;
  insert into private.daily_challenges(day, question_ids) values (p_day, v_ids) on conflict (day) do nothing;
  select challenge.question_ids into v_ids from private.daily_challenges as challenge where challenge.day = p_day;
  return v_ids;
end;
$function$;

create or replace function private.daily_streaks(p_uid uuid, p_today date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with days as (
    select distinct game.daily_date as day from private.game_sessions as game
    where game.user_id = p_uid and game.daily_date is not null and game.state = 'completed'
  ), groups as (
    select days.day, days.day - (row_number() over (order by days.day))::integer as grp from days
  ), runs as (
    select groups.grp, count(*) as length, max(groups.day) as last_day from groups group by groups.grp
  )
  select jsonb_build_object(
    'current', coalesce((select runs.length from runs where runs.last_day >= p_today - 1 order by runs.last_day desc limit 1), 0),
    'best', coalesce((select max(runs.length) from runs), 0)
  );
$function$;

create or replace function public.arena_daily_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_day date := private.daily_today();
  v_session private.game_sessions%rowtype;
  v_rank integer;
begin
  perform private.rate('daily_status', 60);
  select * into v_session from private.game_sessions as game where game.user_id = v_uid and game.daily_date = v_day;
  if found and v_session.state = 'completed' then
    select count(*) + 1 into v_rank from private.game_sessions as other
      where other.daily_date = v_day and other.state = 'completed'
        and (other.score > v_session.score or (other.score = v_session.score and other.response_ms < v_session.response_ms));
  end if;
  return jsonb_build_object(
    'day', v_day,
    'available', (select count(*) >= 10 from private.questions as question
      where question.published and question.source_verified and question.review_status = 'reviewed' and question.kind = 'mc'),
    'sessionId', v_session.id,
    'state', v_session.state,
    'score', v_session.score,
    'correct', v_session.correct,
    'rank', v_rank,
    'players', (select count(*) from private.game_sessions as game where game.daily_date = v_day and game.state = 'completed'),
    'streak', private.daily_streaks(v_uid, v_day),
    'top', (select coalesce(jsonb_agg(entry order by (entry ->> 'rank')::integer), '[]'::jsonb) from (
      select jsonb_build_object('rank', row_number() over (order by game.score desc, game.response_ms asc),
        'username', profile.username, 'avatar', profile.avatar, 'score', game.score, 'correct', game.correct,
        'isYou', game.user_id = v_uid) as entry
      from private.game_sessions as game join public.profiles as profile on profile.id = game.user_id
      where game.daily_date = v_day and game.state = 'completed'
      order by game.score desc, game.response_ms asc limit 10) as board)
  );
end;
$function$;

create or replace function public.arena_daily_start()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_day date := private.daily_today();
  v_ids uuid[];
  v_session_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || 'daily' || v_day::text, 0));
  select game.id into v_session_id from private.game_sessions as game where game.user_id = v_uid and game.daily_date = v_day;
  if found then return private.view(v_session_id); end if;
  perform private.rate('start', 12);
  v_ids := private.daily_questions(v_day);

  insert into private.game_sessions(user_id, mode, difficulty, state, daily_date, session_categories, session_question_count, session_context_saved)
  values (v_uid, 'classic', 'medium', 'awaiting_answer', v_day, '{}', 10, false)
  returning id into v_session_id;

  insert into private.session_questions(session_id, question_id, question, correct_option, explanation, source, difficulty, subcategory)
  select v_session_id, question.id,
    jsonb_build_object('id', question.id, 'type', question.kind, 'prompt', question.prompt, 'category', 'geography',
      'subcategory', question.subcategory, 'difficulty', question.difficulty,
      'options', (select jsonb_agg(jsonb_build_object('id', option_row.id, 'label', option_row.label) order by random())
        from private.question_options as option_row where option_row.question_id = question.id)),
    solution.correct_option, solution.explanation, question.source, question.difficulty, question.subcategory
  from unnest(v_ids) with ordinality as chosen(id, ord)
  join private.questions as question on question.id = chosen.id
  join private.private_question_answers as solution on solution.question_id = question.id;

  perform private.select_next(v_session_id);
  return private.view(v_session_id);
end;
$function$;

-- ===========================================================================
-- Achievements: computed from existing game data, nothing extra is stored.
-- ===========================================================================
create or replace function public.arena_achievements()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_games integer; v_perfect integer; v_streak integer; v_daily integer; v_flags integer; v_capitals integer;
  v_region integer; v_world integer; v_polyglot integer; v_cleared integer;
begin
  perform private.rate('achievements', 60);
  select count(*), count(*) filter (where game.mode = 'classic' and game.correct = 10 and game.incorrect = 0), coalesce(max(game.best_streak), 0)
    into v_games, v_perfect, v_streak
    from private.game_sessions as game where game.user_id = v_uid and game.state = 'completed';
  v_daily := (private.daily_streaks(v_uid, private.daily_today()) ->> 'best')::integer;
  select count(distinct entry.country_code) into v_flags
    from private.flags_session_entries as entry join private.flags_sessions as round on round.id = entry.session_id
    where round.user_id = v_uid and entry.outcome = 'correct';
  select count(distinct code) into v_capitals from (
    select entry.country_code as code from private.capital_session_entries as entry
      join private.capital_sessions as round on round.id = entry.session_id
      where round.user_id = v_uid and entry.outcome = 'correct' and round.direction = 'country_to_capital'
    union
    select entry.country_code from private.recall_session_entries as entry
      join private.recall_sessions as round on round.id = entry.session_id
      where round.user_id = v_uid and round.kind = 'capitals' and entry.found_at is not null
  ) as named;
  select count(*) filter (where round.region is not null), count(*) filter (where round.region is null and round.scope = 'un')
    into v_region, v_world
    from private.recall_sessions as round
    where round.user_id = v_uid and round.kind = 'countries' and round.end_reason = 'all_found' and round.set_size is null;
  select count(distinct entry.matched_lang) into v_polyglot
    from private.recall_session_entries as entry join private.recall_sessions as round on round.id = entry.session_id
    where round.user_id = v_uid and entry.matched_lang in ('de', 'fr');
  select count(*) into v_cleared from private.review_cleared as cleared where cleared.user_id = v_uid;

  return (select jsonb_agg(jsonb_build_object('id', item.id, 'icon', item.icon, 'title', item.title, 'description', item.description,
      'current', least(item.current, item.target), 'target', item.target, 'earned', item.current >= item.target) order by item.ord)
    from (values
      (1, 'first-game', '🎯', 'First steps', 'Finish your first quiz game.', v_games, 1),
      (2, 'regular', '📅', 'Regular', 'Finish 25 quiz games.', v_games, 25),
      (3, 'flawless', '💎', 'Flawless', 'Answer all ten questions of a Classic game correctly.', v_perfect, 1),
      (4, 'on-fire', '🔥', 'On fire', 'Get ten quiz answers right in a row.', v_streak, 10),
      (5, 'daily-7', '🗓️', 'Seven days strong', 'Play the daily challenge seven days in a row.', v_daily, 7),
      (6, 'flags-50', '🏳️', 'Flag spotter', 'Recognise 50 different flags.', v_flags, 50),
      (7, 'flags-150', '🎌', 'Vexillologist', 'Recognise 150 different flags.', v_flags, 150),
      (8, 'capitals-50', '🏛️', 'Capital collector', 'Name 50 different capitals.', v_capitals, 50),
      (9, 'capitals-150', '🧭', 'Atlas scholar', 'Name 150 different capitals.', v_capitals, 150),
      (10, 'continental', '🗺️', 'Continental', 'Name every country of a region in one Recall round.', v_region, 1),
      (11, 'world-tour', '🌍', 'World tour', 'Name all UN member states in one Recall round.', v_world, 1),
      (12, 'polyglot', '🗣️', 'Polyglot', 'Get Recall answers right in both German and French.', v_polyglot, 2),
      (13, 'second-chances', '🔁', 'Second chances', 'Clear 25 mistakes in Review.', v_cleared, 25)
    ) as item(ord, id, icon, title, description, current, target));
end;
$function$;

-- ===========================================================================
-- Admin review queue: one draft at a time, approved only by an admin who
-- confirms they checked it against its source.
-- ===========================================================================
create or replace function public.arena_admin_review_next(p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_question private.questions%rowtype;
  v_remaining integer;
begin
  perform private.require_admin();
  perform private.rate('admin_review', 240);
  with latest as (
    select distinct on (question.stable_id) question.* from private.questions as question
    order by question.stable_id, question.version desc
  )
  select count(*) into v_remaining from latest where latest.review_status = 'draft';
  with latest as (
    select distinct on (question.stable_id) question.* from private.questions as question
    order by question.stable_id, question.version desc
  )
  select * into v_question from latest where latest.review_status = 'draft'
    order by latest.created_at, latest.stable_id offset greatest(0, coalesce(p_offset, 0)) limit 1;
  return jsonb_build_object(
    'remaining', v_remaining,
    'offset', greatest(0, coalesce(p_offset, 0)),
    'item', case when v_question.id is not null then private.admin_record(v_question) || jsonb_build_object(
      'countryName', (select country.name from private.countries as country where country.code = v_question.country_code)) end
  );
end;
$function$;

create or replace function public.arena_admin_review_approve(p_stable_id text, p_version integer, p_confirm_checked boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_question private.questions%rowtype;
begin
  perform private.require_admin();
  perform private.rate('admin_review', 240);
  if p_confirm_checked is distinct from true then raise exception 'CONFIRM_SOURCE_CHECK_REQUIRED'; end if;
  select * into v_question from private.questions as question
    where question.stable_id = p_stable_id and question.version = p_version for update;
  if not found then raise exception 'QUESTION_NOT_FOUND'; end if;
  if exists (select 1 from private.questions as newer where newer.stable_id = p_stable_id and newer.version > p_version) then
    raise exception 'STALE_QUESTION_VERSION';
  end if;
  if v_question.review_status <> 'draft' then raise exception 'QUESTION_ALREADY_REVIEWED'; end if;
  if v_question.source is null or v_question.source !~ '^https://' then raise exception 'QUESTION_NEEDS_HTTPS_SOURCE'; end if;
  update private.questions set published = false where stable_id = p_stable_id and id <> v_question.id and published;
  update private.questions set review_status = 'reviewed', source_verified = true, last_reviewed = current_date, published = true
    where id = v_question.id;
  return public.arena_admin_review_next(0);
end;
$function$;

-- ===========================================================================
-- Grants
-- ===========================================================================
revoke all on function private.review_candidates(uuid), private.review_view(uuid), private.daily_today(),
  private.daily_questions(date), private.daily_streaks(uuid, date) from public, anon, authenticated;
revoke all on function public.arena_review_summary(), public.arena_review_start(uuid), public.arena_review_view(uuid),
  public.arena_review_answer(uuid, integer, text), public.arena_daily_status(), public.arena_daily_start(),
  public.arena_achievements(), public.arena_admin_review_next(integer), public.arena_admin_review_approve(text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.arena_review_summary(), public.arena_review_start(uuid), public.arena_review_view(uuid),
  public.arena_review_answer(uuid, integer, text), public.arena_daily_status(), public.arena_daily_start(),
  public.arena_achievements(), public.arena_admin_review_next(integer), public.arena_admin_review_approve(text, integer, boolean)
  to authenticated;

notify pgrst, 'reload schema';
commit;
