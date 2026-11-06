begin;

-- ============================================================
-- 1. Schemas and taxonomy
-- ============================================================

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table if not exists public.categories (
  id text primary key,
  parent_id text references public.categories(id),
  label text not null
);

insert into public.categories (id, parent_id, label)
values ('geography', null, 'Geography')
on conflict (id) do nothing;

insert into public.categories (id, parent_id, label)
select entry.id, 'geography', initcap(entry.id)
from unnest(array[
  'countries',
  'flags',
  'capitals',
  'cities',
  'regions',
  'borders',
  'population',
  'languages',
  'currencies',
  'physical',
  'landmarks',
  'maps',
  'europe',
  'political',
  'continents'
]::text[]) as entry(id)
on conflict (id) do nothing;

-- ============================================================
-- 2. Profiles
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null default 'Traveler'
    check (username ~ '^[A-Za-z0-9 _-]{2,24}$'),
  avatar integer not null default 0
    check (avatar between 0 and 3),
  favorites text[] not null default '{}',
  xp integer not null default 0
    check (xp >= 0),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 3. Private question bank
-- ============================================================

create table if not exists private.countries (
  code text primary key,
  name text not null,
  capital text not null,
  region text not null,
  currency text not null,
  flag text not null,
  difficulty text not null,
  source text not null
);

create table if not exists private.questions (
  id uuid primary key default gen_random_uuid(),
  stable_id text not null,
  version integer not null check (version > 0),
  kind text not null check (kind in ('mc', 'tf')),
  prompt text not null,
  subcategory text not null references public.categories(id),
  difficulty text not null
    check (difficulty in ('easy', 'medium', 'hard', 'expert')),
  country_code text references private.countries(code),
  source text not null,
  source_verified boolean not null default false,
  review_status text not null
    check (review_status in ('draft', 'reviewed')),
  last_reviewed date,
  reference_year integer,
  asset jsonb,
  published boolean not null default false,
  created_at timestamptz not null default now(),

  unique (stable_id, version),

  check (
    not published
    or (
      source_verified
      and review_status = 'reviewed'
      and last_reviewed is not null
    )
  )
);

create unique index if not exists questions_one_published
  on private.questions (stable_id)
  where published;

create index if not exists questions_selection
  on private.questions (subcategory, difficulty, country_code)
  where published;

create index if not exists questions_stable_version
  on private.questions (stable_id, version desc);

create table if not exists private.question_options (
  question_id uuid not null
    references private.questions(id) on delete cascade,
  id text not null,
  label text not null,

  primary key (question_id, id)
);

create table if not exists private.private_question_answers (
  question_id uuid primary key
    references private.questions(id) on delete cascade,
  correct_option text not null,
  explanation text not null,

  foreign key (question_id, correct_option)
    references private.question_options(question_id, id)
);

-- ============================================================
-- 4. Sessions, snapshots, accepted answers
-- ============================================================

create table if not exists private.game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null
    check (mode in ('classic', 'practice', 'timed', 'endless')),
  difficulty text not null
    check (difficulty in ('easy', 'medium', 'hard', 'expert')),
  state text not null check (
    state in (
      'awaiting_answer',
      'showing_feedback',
      'completed',
      'abandoned'
    )
  ),
  version integer not null default 0,
  current_question uuid,
  created_at timestamptz not null default clock_timestamp(),
  question_started_at timestamptz,
  deadline timestamptz,
  completed_at timestamptz,
  score integer not null default 0,
  correct integer not null default 0,
  incorrect integer not null default 0,
  streak integer not null default 0,
  best_streak integer not null default 0,
  response_ms bigint not null default 0,
  xp integer not null default 0
);

create index if not exists sessions_user_created
  on private.game_sessions (user_id, created_at desc);

create index if not exists sessions_user_state
  on private.game_sessions (user_id, state);

create table if not exists private.session_questions (
  session_id uuid not null
    references private.game_sessions(id) on delete cascade,
  question_id uuid not null,

  -- Public question snapshot without answer/explanation.
  question jsonb not null,

  -- Protected solution snapshot.
  correct_option text not null,
  explanation text not null,
  source text not null,
  difficulty text not null,
  subcategory text not null,

  primary key (session_id, question_id)
);

create table if not exists private.answer_submissions (
  session_id uuid not null,
  question_id uuid not null,
  option_id text not null,
  accepted_at timestamptz not null default clock_timestamp(),
  correct boolean not null,
  points integer not null,
  response_ms bigint not null,

  primary key (session_id, question_id),

  foreign key (session_id, question_id)
    references private.session_questions(session_id, question_id)
    on delete cascade
);

-- ============================================================
-- 5. Progression and rate limits
-- ============================================================

create table if not exists public.xp_events (
  session_id uuid primary key
    references private.game_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists xp_user_created
  on public.xp_events (user_id, created_at desc);

create table if not exists public.player_category_stats (
  user_id uuid not null references auth.users(id) on delete cascade,
  subcategory text not null references public.categories(id),
  mode text not null,
  correct integer not null default 0,
  incorrect integer not null default 0,

  primary key (user_id, subcategory, mode)
);

create table if not exists private.rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  time_window timestamptz not null,
  count integer not null,

  primary key (user_id, action, time_window)
);

-- Compatibility with earlier versions of the supplied migration.
do $migration$
declare
  v_old_name text;
begin
  foreach v_old_name in array array['window', 'rate_window']
  loop
    if exists (
      select 1
      from information_schema.columns as col
      where col.table_schema = 'private'
        and col.table_name = 'rate_limits'
        and col.column_name = v_old_name
    ) then
      if exists (
        select 1
        from information_schema.columns as col
        where col.table_schema = 'private'
          and col.table_name = 'rate_limits'
          and col.column_name = 'time_window'
      ) then
        raise exception
          'rate_limits has both % and time_window; review schema manually',
          v_old_name;
      end if;

      execute format(
        'alter table private.rate_limits rename column %I to time_window',
        v_old_name
      );
    end if;
  end loop;
end;
$migration$;

-- ============================================================
-- 6. RLS and direct table permissions
-- ============================================================

alter table public.categories enable row level security;
alter table public.profiles enable row level security;
alter table public.xp_events enable row level security;
alter table public.player_category_stats enable row level security;

drop policy if exists categories_read on public.categories;
create policy categories_read
  on public.categories
  for select
  to anon, authenticated
  using (true);

drop policy if exists own_profile on public.profiles;
create policy own_profile
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

drop policy if exists own_xp on public.xp_events;
create policy own_xp
  on public.xp_events
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists own_category_stats
  on public.player_category_stats;
create policy own_category_stats
  on public.player_category_stats
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on
  public.categories,
  public.profiles,
  public.xp_events,
  public.player_category_stats
from anon, authenticated;

grant select on public.categories to anon, authenticated;

grant select on
  public.profiles,
  public.xp_events,
  public.player_category_stats
to authenticated;

do $migration$
declare
  v_table text;
begin
  foreach v_table in array array[
    'countries',
    'questions',
    'question_options',
    'private_question_answers',
    'game_sessions',
    'session_questions',
    'answer_submissions',
    'rate_limits'
  ]
  loop
    execute format(
      'alter table private.%I enable row level security',
      v_table
    );

    execute format(
      'revoke all on private.%I from public, anon, authenticated',
      v_table
    );
  end loop;
end;
$migration$;

-- Private tables intentionally have no client-access policies.
-- Access is mediated by narrowly scoped SECURITY DEFINER functions.

-- ============================================================
-- 7. Internal identity, authorization, timing helpers
-- ============================================================

create or replace function private.drank(d text)
returns integer
language sql
immutable
set search_path = ''
as $function$
  select case d
    when 'easy' then 0
    when 'medium' then 1
    when 'hard' then 2
    when 'expert' then 3
    else -1
  end;
$function$;

create or replace function private.require_user()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (
    select 1 from auth.users as usr where usr.id = v_uid
  ) then
    raise exception 'AUTH_REQUIRED';
  end if;

  insert into public.profiles (id)
  values (v_uid)
  on conflict (id) do nothing;

  -- Consistent first lock for this player's operations.
  -- Different users can still operate independently.
  perform 1
  from public.profiles as profile
  where profile.id = v_uid
  for update;

  return v_uid;
end;
$function$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select
      usr.raw_app_meta_data -> 'atlas_admin' = 'true'::jsonb
      and usr.is_anonymous = false
    from auth.users as usr
    where usr.id = auth.uid()
  ), false);
$function$;

create or replace function private.require_admin()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.require_user();

  if not private.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;
end;
$function$;

create or replace function private.rate(
  p_action text,
  p_limit integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_count integer;
begin
  delete from private.rate_limits as rate
  where rate.user_id = v_uid
    and rate.time_window < clock_timestamp() - interval '2 minutes';

  insert into private.rate_limits as rate (
    user_id,
    action,
    time_window,
    count
  )
  values (
    v_uid,
    p_action,
    date_trunc('minute', clock_timestamp()),
    1
  )
  on conflict (user_id, action, time_window)
  do update set count = rate.count + 1
  returning count into v_count;

  if v_count > p_limit then
    raise exception 'RATE_LIMIT: retry in one minute';
  end if;
end;
$function$;

create or replace function private.owned_locked(p_id uuid)
returns private.game_sessions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session private.game_sessions;
begin
  select session.*
  into v_session
  from private.game_sessions as session
  where session.id = p_id
    and session.user_id = v_uid
  for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  return v_session;
end;
$function$;

-- ============================================================
-- 8. Exactly-once completion and progression
-- ============================================================

create or replace function private.complete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.game_sessions;
  v_awarded integer;
  v_inserted integer;
begin
  select session.*
  into v_session
  from private.game_sessions as session
  where session.id = p_id
  for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if v_session.state in ('completed', 'abandoned') then
    return;
  end if;

  v_awarded := case
    when v_session.mode = 'practice'
      or v_session.correct + v_session.incorrect = 0
    then 0
    else 20 + 10 * v_session.correct
  end;

  update private.game_sessions
  set
    state = 'completed',
    completed_at = clock_timestamp(),
    current_question = null,
    xp = v_awarded,
    version = version + 1
  where id = p_id;

  if v_awarded > 0 then
    insert into public.xp_events (
      session_id,
      user_id,
      amount
    )
    values (
      p_id,
      v_session.user_id,
      v_awarded
    )
    on conflict (session_id) do nothing;

    get diagnostics v_inserted = row_count;

    if v_inserted = 1 then
      update public.profiles
      set xp = xp + v_awarded
      where id = v_session.user_id;
    end if;
  end if;

  insert into public.player_category_stats as stats (
    user_id,
    subcategory,
    mode,
    correct,
    incorrect
  )
  select
    v_session.user_id,
    snapshot.subcategory,
    v_session.mode,
    (count(*) filter (where answer.correct))::integer,
    (count(*) filter (where not answer.correct))::integer
  from private.answer_submissions as answer
  join private.session_questions as snapshot
    on snapshot.session_id = answer.session_id
   and snapshot.question_id = answer.question_id
  where answer.session_id = p_id
  group by snapshot.subcategory
  on conflict (user_id, subcategory, mode)
  do update set
    correct = stats.correct + excluded.correct,
    incorrect = stats.incorrect + excluded.incorrect;
end;
$function$;

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
  select session.*
  into v_session
  from private.game_sessions as session
  where session.id = p_id;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if v_session.state in ('completed', 'abandoned') then
    return;
  end if;

  if v_session.deadline is not null
    and clock_timestamp() >= v_session.deadline
  then
    perform private.complete(p_id);
    return;
  end if;

  select snapshot.question_id
  into v_question_id
  from private.session_questions as snapshot
  where snapshot.session_id = p_id
    and not exists (
      select 1
      from private.answer_submissions as answer
      where answer.session_id = p_id
        and answer.question_id = snapshot.question_id
    )
    and (
      v_session.mode <> 'endless'
      or private.drank(snapshot.difficulty) <= least(
        3,
        private.drank(v_session.difficulty)
          + (v_session.correct + v_session.incorrect) / 5
      )
    )
  order by
    case
      when v_session.mode = 'endless'
      then private.drank(snapshot.difficulty)
      else 0
    end desc,
    random()
  limit 1;

  if v_question_id is null then
    perform private.complete(p_id);
    return;
  end if;

  update private.game_sessions
  set
    current_question = v_question_id,
    state = 'awaiting_answer',
    question_started_at = clock_timestamp(),
    version = version + 1
  where id = p_id;
end;
$function$;

-- ============================================================
-- 9. Safe response construction
-- ============================================================

create or replace function private.reviews(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'questionId', answer.question_id,
        'prompt', snapshot.question ->> 'prompt',
        'chosen', (
          select option_entry.value ->> 'label'
          from jsonb_array_elements(
            snapshot.question -> 'options'
          ) as option_entry(value)
          where option_entry.value ->> 'id' = answer.option_id
        ),
        'correctAnswer', (
          select option_entry.value ->> 'label'
          from jsonb_array_elements(
            snapshot.question -> 'options'
          ) as option_entry(value)
          where option_entry.value ->> 'id'
            = snapshot.correct_option
        ),
        'correct', answer.correct,
        'explanation', snapshot.explanation,
        'source', snapshot.source,
        'points', answer.points,
        'responseMs', answer.response_ms,
        'subcategory', snapshot.subcategory
      )
      order by answer.accepted_at, answer.question_id
    ),
    '[]'::jsonb
  )
  from private.answer_submissions as answer
  join private.session_questions as snapshot
    on snapshot.session_id = answer.session_id
   and snapshot.question_id = answer.question_id
  where answer.session_id = p_id;
$function$;

create or replace function private.view(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.game_sessions;
  v_reviews jsonb;
  v_question jsonb;
  v_total integer;
begin
  select session.*
  into v_session
  from private.game_sessions as session
  where session.id = p_id;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  select snapshot.question
  into v_question
  from private.session_questions as snapshot
  where snapshot.session_id = p_id
    and snapshot.question_id = v_session.current_question;

  select count(*)::integer
  into v_total
  from private.session_questions as snapshot
  where snapshot.session_id = p_id;

  v_reviews := private.reviews(p_id);

  return jsonb_build_object(
    'id', v_session.id,
    'version', v_session.version,
    'mode', v_session.mode,
    'difficulty', v_session.difficulty,
    'status', v_session.state,
    'serverNow', clock_timestamp(),
    'deadline', v_session.deadline,
    'current', case
      when v_session.state in ('completed', 'abandoned')
      then null
      else v_question
    end,
    'feedback', case
      when v_session.state = 'showing_feedback'
      then v_reviews -> (jsonb_array_length(v_reviews) - 1)
      else null
    end,
    'reviews', case
      when v_session.state = 'completed'
      then v_reviews
      else '[]'::jsonb
    end,
    'total', v_total,
    'answered', v_session.correct + v_session.incorrect,
    'stats', jsonb_build_object(
      'score', v_session.score,
      'correct', v_session.correct,
      'incorrect', v_session.incorrect,
      'streak', v_session.streak,
      'bestStreak', v_session.best_streak,
      'xp', v_session.xp,
      'averageMs', case
        when v_session.correct + v_session.incorrect = 0
        then 0
        else v_session.response_ms::numeric
          / (v_session.correct + v_session.incorrect)
      end
    )
  );
end;
$function$;

-- ============================================================
-- 10. Public gameplay RPCs
-- ============================================================

create or replace function public.arena_start(
  p_mode text,
  p_categories text[] default '{}',
  p_difficulty text default 'easy',
  p_country text default null,
  p_count integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session_id uuid;
  v_expired_id uuid;
  v_needed integer;
  v_found integer;
begin
  perform private.rate('start', 12);

  if p_mode is null
    or p_mode not in ('classic', 'practice', 'timed', 'endless')
    or private.drank(p_difficulty) < 0
    or p_count is null
    or p_count not between 1 and 10
    or p_categories is null
    or cardinality(p_categories) > 15
  then
    raise exception 'INVALID_SELECTION';
  end if;

  if exists (
    select 1
    from unnest(p_categories) as chosen(id)
    where not exists (
      select 1
      from public.categories as category
      where category.id = chosen.id
        and category.parent_id = 'geography'
    )
  ) then
    raise exception 'INVALID_CATEGORY';
  end if;

  if p_country is not null and not exists (
    select 1
    from private.countries as country
    where country.code = p_country
  ) then
    raise exception 'UNKNOWN_COUNTRY';
  end if;

  for v_expired_id in
    select session.id
    from private.game_sessions as session
    where session.user_id = v_uid
      and session.state in ('awaiting_answer', 'showing_feedback')
      and session.deadline <= clock_timestamp()
  loop
    perform private.complete(v_expired_id);
  end loop;

  if (
    select count(*)
    from private.game_sessions as session
    where session.user_id = v_uid
      and session.state in ('awaiting_answer', 'showing_feedback')
  ) >= 3 then
    raise exception
      'Resume or abandon an active session before starting another.';
  end if;

  v_needed := case
    when p_mode = 'classic' then 10
    when p_mode = 'practice' then p_count
    else 1
  end;

  insert into private.game_sessions (
    user_id,
    mode,
    difficulty,
    state,
    deadline
  )
  values (
    v_uid,
    p_mode,
    p_difficulty,
    'awaiting_answer',
    case
      when p_mode = 'timed'
      then clock_timestamp() + interval '60 seconds'
      else null
    end
  )
  returning id into v_session_id;

  -- Endless keeps up to 50 questions per eligible tier.
  -- This prevents a large high-tier pool from excluding all
  -- available starting-tier questions from the snapshot.
  with eligible as (
    select
      question.*,
      row_number() over (
        partition by question.difficulty
        order by random()
      ) as tier_position
    from private.questions as question
    where question.published
      and question.source_verified
      and question.review_status = 'reviewed'
      and question.kind in ('mc', 'tf')
      and (
        cardinality(p_categories) = 0
        or question.subcategory = any(p_categories)
      )
      and (
        p_country is null
        or question.country_code = p_country
      )
      and (
        (
          p_mode = 'endless'
          and private.drank(question.difficulty)
            >= private.drank(p_difficulty)
        )
        or (
          p_mode <> 'endless'
          and question.difficulty = p_difficulty
        )
      )
      and (
        p_mode <> 'classic'
        or question.kind = 'mc'
      )
  )
  insert into private.session_questions (
    session_id,
    question_id,
    question,
    correct_option,
    explanation,
    source,
    difficulty,
    subcategory
  )
  select
    v_session_id,
    question.id,
    jsonb_build_object(
      'id', question.id,
      'type', question.kind,
      'prompt', question.prompt,
      'category', 'geography',
      'subcategory', question.subcategory,
      'difficulty', question.difficulty,
      'options', (
        select jsonb_agg(
          jsonb_build_object(
            'id', option_row.id,
            'label', option_row.label
          )
          order by random()
        )
        from private.question_options as option_row
        where option_row.question_id = question.id
      )
    ),
    solution.correct_option,
    solution.explanation,
    question.source,
    question.difficulty,
    question.subcategory
  from eligible as question
  join private.private_question_answers as solution
    on solution.question_id = question.id
  where p_mode <> 'endless'
     or question.tier_position <= 50
  order by random()
  limit case
    when p_mode in ('classic', 'practice') then v_needed
    else 200
  end;

  get diagnostics v_found = row_count;

  if v_found < v_needed then
    raise exception
      'Insufficient exact pool: % available, % required. Publish reviewed content or change filters.',
      v_found,
      v_needed;
  end if;

  if p_mode = 'endless' and not exists (
    select 1
    from private.session_questions as snapshot
    where snapshot.session_id = v_session_id
      and snapshot.difficulty = p_difficulty
  ) then
    raise exception
      'No published questions match the selected starting difficulty.';
  end if;

  perform private.select_next(v_session_id);

  return private.view(v_session_id);
end;
$function$;

create or replace function public.arena_view(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.game_sessions;
begin
  perform private.rate('view', 180);

  v_session := private.owned_locked(p_id);

  if v_session.deadline is not null
    and clock_timestamp() >= v_session.deadline
  then
    perform private.complete(p_id);
  end if;

  return private.view(p_id);
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
  v_points integer;
  v_ms bigint;
  v_now timestamptz;
begin
  perform private.rate('answer', 180);

  v_session := private.owned_locked(p_id);

  if v_session.state in ('completed', 'abandoned') then
    raise exception 'SESSION_CLOSED';
  end if;

  if v_session.deadline is not null
    and clock_timestamp() >= v_session.deadline
  then
    perform private.complete(p_id);

    -- No answer is accepted. Return the finalized state.
    return private.view(p_id);
  end if;

  if v_session.state <> 'awaiting_answer'
    or v_session.current_question is distinct from p_question
  then
    raise exception 'DUPLICATE_OR_STALE_ANSWER';
  end if;

  select snapshot.*
  into v_snapshot
  from private.session_questions as snapshot
  where snapshot.session_id = p_id
    and snapshot.question_id = p_question;

  if not found then
    raise exception 'INVALID_QUESTION';
  end if;

  if p_option is null or not exists (
    select 1
    from jsonb_array_elements(
      v_snapshot.question -> 'options'
    ) as option_entry(value)
    where option_entry.value ->> 'id' = p_option
  ) then
    raise exception 'INVALID_OPTION';
  end if;

  v_now := clock_timestamp();

  -- Recheck at the authoritative acceptance timestamp.
  if v_session.deadline is not null
    and v_now >= v_session.deadline
  then
    perform private.complete(p_id);
    return private.view(p_id);
  end if;

  v_correct := p_option = v_snapshot.correct_option;

  v_streak := case
    when v_correct then v_session.streak + 1
    else 0
  end;

  -- MVP modes have no per-question deadline.
  -- Therefore the per-question speed bonus is zero.
  v_points := case
    when v_correct then
      (
        case v_snapshot.difficulty
          when 'easy' then 100
          when 'medium' then 125
          when 'hard' then 150
          else 200
        end
      )
      + least(50, 10 * greatest(0, v_streak - 1))
    else 0
  end;

  v_ms := greatest(
    0,
    floor(
      extract(epoch from (v_now - v_session.question_started_at))
      * 1000
    )
  )::bigint;

  insert into private.answer_submissions (
    session_id,
    question_id,
    option_id,
    accepted_at,
    correct,
    points,
    response_ms
  )
  values (
    p_id,
    p_question,
    p_option,
    v_now,
    v_correct,
    v_points,
    v_ms
  );

  update private.game_sessions
  set
    score = score + v_points,
    correct = correct + v_correct::integer,
    incorrect = incorrect + (not v_correct)::integer,
    streak = v_streak,
    best_streak = greatest(best_streak, v_streak),
    response_ms = response_ms + v_ms,
    state = 'showing_feedback',
    version = version + 1
  where id = p_id;

  if (
    v_session.mode = 'endless'
    and v_session.incorrect + (not v_correct)::integer >= 3
  ) or not exists (
    select 1
    from private.session_questions as snapshot
    where snapshot.session_id = p_id
      and not exists (
        select 1
        from private.answer_submissions as answer
        where answer.session_id = p_id
          and answer.question_id = snapshot.question_id
      )
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
begin
  perform private.rate('next', 180);

  v_session := private.owned_locked(p_id);

  if v_session.state in ('completed', 'abandoned') then
    raise exception 'SESSION_CLOSED';
  end if;

  if v_session.deadline is not null
    and clock_timestamp() >= v_session.deadline
  then
    perform private.complete(p_id);
  else
    if v_session.state <> 'showing_feedback' then
      raise exception 'INVALID_TRANSITION';
    end if;

    perform private.select_next(p_id);
  end if;

  return private.view(p_id);
end;
$function$;

create or replace function public.arena_abandon(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.game_sessions;
begin
  perform private.rate('abandon', 30);

  v_session := private.owned_locked(p_id);

  if v_session.state in ('completed', 'abandoned') then
    return;
  end if;

  if v_session.deadline is not null
    and clock_timestamp() >= v_session.deadline
  then
    perform private.complete(p_id);
    return;
  end if;

  update private.game_sessions
  set
    state = 'abandoned',
    version = version + 1
  where id = p_id;
end;
$function$;

-- ============================================================
-- 11. Profiles, history, Explorer, export
-- ============================================================

create or replace function public.arena_profile(
  p_username text,
  p_avatar integer,
  p_favorites text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
begin
  perform private.rate('profile', 20);

  if p_username is null
    or p_username !~ '^[A-Za-z0-9 _-]{2,24}$'
    or p_avatar is null
    or p_avatar not between 0 and 3
    or p_favorites is null
    or cardinality(p_favorites) > 15
  then
    raise exception 'INVALID_PROFILE';
  end if;

  if exists (
    select 1
    from unnest(p_favorites) as favorite(id)
    where not exists (
      select 1
      from public.categories as category
      where category.id = favorite.id
        and category.parent_id = 'geography'
    )
  ) then
    raise exception 'INVALID_FAVORITE_CATEGORY';
  end if;

  update public.profiles
  set
    username = p_username,
    avatar = p_avatar,
    favorites = p_favorites
  where id = v_uid;
end;
$function$;

create or replace function public.arena_dashboard(
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_expired_id uuid;
  v_result jsonb;
begin
  perform private.rate('dashboard', 60);

  if p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception 'INVALID_OFFSET';
  end if;

  for v_expired_id in
    select session.id
    from private.game_sessions as session
    where session.user_id = v_uid
      and session.state in ('awaiting_answer', 'showing_feedback')
      and session.deadline <= clock_timestamp()
  loop
    perform private.complete(v_expired_id);
  end loop;

  select jsonb_build_object(
    'profile', jsonb_build_object(
      'username', profile.username,
      'avatar', profile.avatar,
      'favorites', profile.favorites,
      'xp', profile.xp,
      'admin', private.is_admin()
    ),
    'totals', (
      select jsonb_build_object(
        'games', count(*),
        'correct', coalesce(sum(session.correct), 0),
        'incorrect', coalesce(sum(session.incorrect), 0)
      )
      from private.game_sessions as session
      where session.user_id = v_uid
        and session.state = 'completed'
    ),
    'best', coalesce((
      select jsonb_object_agg(best.mode, best.score)
      from (
        select session.mode, max(session.score) as score
        from private.game_sessions as session
        where session.user_id = v_uid
          and session.state = 'completed'
          and session.mode <> 'practice'
        group by session.mode
      ) as best
    ), '{}'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', recent.id,
          'mode', recent.mode,
          'difficulty', recent.difficulty,
          'status', recent.state,
          'score', recent.score,
          'correct', recent.correct,
          'incorrect', recent.incorrect,
          'createdAt', recent.created_at
        )
        order by
          (recent.state in (
            'awaiting_answer', 'showing_feedback'
          )) desc,
          recent.created_at desc,
          recent.id
      )
      from (
        select session.*
        from private.game_sessions as session
        where session.user_id = v_uid
        order by
          (session.state in (
            'awaiting_answer', 'showing_feedback'
          )) desc,
          session.created_at desc,
          session.id
        limit 20
        offset p_offset
      ) as recent
    ), '[]'::jsonb)
  )
  into v_result
  from public.profiles as profile
  where profile.id = v_uid;

  return v_result;
end;
$function$;

create or replace function public.arena_explore()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.rate('explore', 60);

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'code', country.code,
        'name', country.name,
        'capital', country.capital,
        'region', country.region,
        'currency', country.currency,
        'flag', country.flag,
        'difficulty', country.difficulty,
        'source', country.source
      )
      order by country.name
    )
    from private.countries as country
    where (
      select count(*)
      from private.questions as question
      where question.country_code = country.code
        and question.published
        and question.source_verified
        and question.review_status = 'reviewed'
        and question.difficulty = country.difficulty
    ) >= 4
  ), '[]'::jsonb);
end;
$function$;

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
    'profile', (
      select to_jsonb(profile)
      from public.profiles as profile
      where profile.id = v_uid
    ),
    'sessions', coalesce((
      select jsonb_agg(
        to_jsonb(session)
        || jsonb_build_object(
          'acceptedAnswerReviews', private.reviews(session.id)
        )
        order by session.created_at, session.id
      )
      from private.game_sessions as session
      where session.user_id = v_uid
    ), '[]'::jsonb),
    'xpEvents', coalesce((
      select jsonb_agg(to_jsonb(event))
      from public.xp_events as event
      where event.user_id = v_uid
    ), '[]'::jsonb),
    'categoryStats', coalesce((
      select jsonb_agg(to_jsonb(stats))
      from public.player_category_stats as stats
      where stats.user_id = v_uid
    ), '[]'::jsonb)
  );
end;
$function$;

-- ============================================================
-- 12. Admin content output
-- ============================================================

create or replace function private.admin_record(
  q private.questions
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'stableId', q.stable_id,
    'expectedVersion', q.version,
    'type', q.kind,
    'prompt', q.prompt,
    'category', 'geography',
    'subcategory', q.subcategory,
    'difficulty', q.difficulty,
    'countryCode', q.country_code,
    'options', (
      select jsonb_agg(
        jsonb_build_object(
          'id', option_row.id,
          'label', option_row.label
        )
        order by option_row.id
      )
      from private.question_options as option_row
      where option_row.question_id = q.id
    ),
    'correct', solution.correct_option,
    'explanation', solution.explanation,
    'source', q.source,
    'sourceVerified', q.source_verified,
    'reviewStatus', q.review_status,
    'lastReviewed', q.last_reviewed,
    'referenceYear', q.reference_year,
    'asset', q.asset
  )
  from private.private_question_answers as solution
  where solution.question_id = q.id;
$function$;

create or replace function public.arena_admin_list(
  p_search text default '',
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.require_admin();
  perform private.rate('admin_list', 60);

  if p_search is null
    or length(p_search) > 100
    or p_offset is null
    or p_offset < 0
    or p_offset > 100000
  then
    raise exception 'INVALID_FILTER';
  end if;

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(
        private.admin_record(question)
        order by question.stable_id
      )
      from private.questions as question
      where question.id in (
        select latest.id
        from (
          select distinct on (candidate.stable_id)
            candidate.id,
            candidate.stable_id,
            candidate.prompt
          from private.questions as candidate
          order by candidate.stable_id, candidate.version desc
        ) as latest
        where latest.stable_id ilike '%' || p_search || '%'
           or latest.prompt ilike '%' || p_search || '%'
        order by latest.stable_id
        limit 20
        offset p_offset
      )
    ), '[]'::jsonb)
  );
end;
$function$;

-- ============================================================
-- 13. Validated, versioned admin import
-- ============================================================

create or replace function public.arena_admin_import(
  p_records jsonb,
  p_dry_run boolean default true,
  p_policy text default 'reject',
  p_publish boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_record jsonb;
  v_option jsonb;

  v_errors jsonb := '[]'::jsonb;
  v_row integer := 0;
  v_existing integer;
  v_expected integer;
  v_option_count integer;
  v_expected_options integer;

  v_question_id uuid;
  v_stable_id text;
  v_source_verified boolean;
  v_reviewed_at date;
  v_reference_year integer;
begin
  perform private.require_admin();
  perform private.rate('admin_import', 30);

  -- Separate shape checks avoid evaluating array functions
  -- against a non-array payload.
  if p_records is null
    or jsonb_typeof(p_records) <> 'array'
  then
    raise exception 'IMPORT_REQUIRES_JSON_ARRAY';
  end if;

  if octet_length(p_records::text) > 262144
    or jsonb_array_length(p_records) not between 1 and 100
    or p_policy is null
    or p_policy not in ('reject', 'version')
    or p_publish is null
    or p_dry_run is null
  then
    raise exception 'IMPORT_LIMIT_OR_SCHEMA';
  end if;

  -- Serialize version publication/import operations.
  perform pg_advisory_xact_lock(724182001);

  -- Validate every record before writing any content.
  for v_record in
    select record_entry.value
    from jsonb_array_elements(p_records) as record_entry(value)
  loop
    v_row := v_row + 1;

    begin
      if jsonb_typeof(v_record) <> 'object' then
        raise exception 'Each record must be an object';
      end if;

      v_stable_id := v_record ->> 'stableId';

      if v_stable_id is null
        or v_stable_id !~ '^[a-zA-Z0-9_-]{3,80}$'
      then
        raise exception 'Invalid stableId';
      end if;

      if (
        select count(*)
        from jsonb_array_elements(p_records) as record_entry(value)
        where record_entry.value ->> 'stableId' = v_stable_id
      ) > 1 then
        raise exception 'Duplicate stableId in file';
      end if;

      if coalesce(v_record ->> 'category', '') <> 'geography'
        or not exists (
          select 1
          from public.categories as category
          where category.id = v_record ->> 'subcategory'
            and category.parent_id = 'geography'
        )
      then
        raise exception 'Unknown category/subcategory';
      end if;

      if coalesce(v_record ->> 'type', '') not in ('mc', 'tf')
        or private.drank(v_record ->> 'difficulty') < 0
      then
        raise exception 'Unsupported type or difficulty';
      end if;

      if length(coalesce(v_record ->> 'prompt', ''))
          not between 5 and 500
        or length(coalesce(v_record ->> 'explanation', ''))
          not between 5 and 3000
      then
        raise exception 'Prompt/explanation length invalid';
      end if;

      if coalesce(v_record ->> 'source', '')
          !~ '^https://[^[:space:]]+$'
        or length(v_record ->> 'source') > 1000
      then
        raise exception 'HTTPS source required';
      end if;

      if jsonb_typeof(v_record -> 'options')
        is distinct from 'array'
      then
        raise exception 'options must be an array';
      end if;

      v_option_count := jsonb_array_length(v_record -> 'options');

      if v_record ->> 'type' = 'mc' then
        v_expected_options := 4;
      else
        v_expected_options := 2;
      end if;

      if v_option_count <> v_expected_options then
        raise exception 'mc requires four options; tf requires two';
      end if;

      for v_option in
        select option_entry.value
        from jsonb_array_elements(
          v_record -> 'options'
        ) as option_entry(value)
      loop
        if jsonb_typeof(v_option) <> 'object'
          or coalesce(v_option ->> 'id', '')
            !~ '^[A-Za-z0-9_-]{1,40}$'
          or length(coalesce(v_option ->> 'label', ''))
            not between 1 and 200
        then
          raise exception 'Invalid option id/label';
        end if;
      end loop;

      if (
        select count(distinct option_entry.value ->> 'id')
        from jsonb_array_elements(
          v_record -> 'options'
        ) as option_entry(value)
      ) <> v_option_count then
        raise exception 'Duplicate option identifiers';
      end if;

      if (
        select count(
          distinct lower(trim(option_entry.value ->> 'label'))
        )
        from jsonb_array_elements(
          v_record -> 'options'
        ) as option_entry(value)
      ) <> v_option_count then
        raise exception 'Duplicate option labels';
      end if;

      if not exists (
        select 1
        from jsonb_array_elements(
          v_record -> 'options'
        ) as option_entry(value)
        where option_entry.value ->> 'id'
          = v_record ->> 'correct'
      ) then
        raise exception 'Correct option does not exist';
      end if;

      if v_record ->> 'type' = 'tf' then
        if not exists (
          select 1
          from jsonb_array_elements(
            v_record -> 'options'
          ) as option_entry(value)
          where option_entry.value ->> 'id' = 'true'
            and option_entry.value ->> 'label' = 'True'
        ) or not exists (
          select 1
          from jsonb_array_elements(
            v_record -> 'options'
          ) as option_entry(value)
          where option_entry.value ->> 'id' = 'false'
            and option_entry.value ->> 'label' = 'False'
        ) then
          raise exception 'tf requires true/True and false/False';
        end if;
      end if;

      if coalesce(v_record ->> 'reviewStatus', '')
        not in ('draft', 'reviewed')
      then
        raise exception 'Invalid review status';
      end if;

      if v_record ? 'sourceVerified' then
        if jsonb_typeof(v_record -> 'sourceVerified')
          is distinct from 'boolean'
        then
          raise exception 'sourceVerified must be a JSON boolean';
        end if;
      end if;

      v_source_verified := coalesce(
        (v_record ->> 'sourceVerified')::boolean,
        false
      );

      v_reviewed_at := null;

      if v_record ->> 'lastReviewed' is not null then
        if (v_record ->> 'lastReviewed')
          !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        then
          raise exception 'lastReviewed must use YYYY-MM-DD';
        end if;

        v_reviewed_at := (v_record ->> 'lastReviewed')::date;

        if v_reviewed_at > current_date then
          raise exception 'lastReviewed cannot be in the future';
        end if;
      end if;

      if p_publish and (
        v_record ->> 'reviewStatus' <> 'reviewed'
        or not v_source_verified
        or v_reviewed_at is null
      ) then
        raise exception
          'Publishing requires a verified source and a dated review';
      end if;

      v_reference_year := null;

      if v_record ->> 'referenceYear' is not null then
        v_reference_year := (v_record ->> 'referenceYear')::integer;

        if v_reference_year not between 1900 and 2100 then
          raise exception 'Invalid reference year';
        end if;
      end if;

      if v_record ->> 'subcategory'
          in ('population', 'political', 'borders', 'currencies')
        and v_reference_year is null
      then
        raise exception 'Reference year required for changing topics';
      end if;

      if v_record ->> 'countryCode' is not null
        and not exists (
          select 1
          from private.countries as country
          where country.code = v_record ->> 'countryCode'
        )
      then
        raise exception 'Unknown country code; load country seed first';
      end if;

      if v_record -> 'asset' is not null
        and v_record -> 'asset' <> 'null'::jsonb
      then
        if jsonb_typeof(v_record -> 'asset') <> 'object'
          or length(coalesce(
            v_record -> 'asset' ->> 'license', ''
          )) < 2
          or coalesce(
            v_record -> 'asset' ->> 'source', ''
          ) !~ '^https://[^[:space:]]+$'
        then
          raise exception
            'Asset metadata requires a license and HTTPS source';
        end if;
      end if;

      select coalesce(max(question.version), 0)
      into v_existing
      from private.questions as question
      where question.stable_id = v_stable_id;

      v_expected := coalesce(
        (v_record ->> 'expectedVersion')::integer,
        0
      );

      if v_existing > 0 and p_policy = 'reject' then
        raise exception 'Stable ID exists';
      end if;

      if v_expected <> v_existing then
        raise exception
          'Version conflict: expected %, current %',
          v_expected,
          v_existing;
      end if;

    exception
      when others then
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object(
            'row', v_row,
            'message', sqlerrm
          )
        );
    end;
  end loop;

  if jsonb_array_length(v_errors) > 0 or p_dry_run then
    return jsonb_build_object(
      'ok', jsonb_array_length(v_errors) = 0,
      'count', v_row,
      'errors', v_errors
    );
  end if;

  -- All records validated; write atomically.
  for v_record in
    select record_entry.value
    from jsonb_array_elements(p_records) as record_entry(value)
  loop
    v_stable_id := v_record ->> 'stableId';

    select coalesce(max(question.version), 0)
    into v_existing
    from private.questions as question
    where question.stable_id = v_stable_id;

    if p_publish then
      update private.questions
      set published = false
      where stable_id = v_stable_id;
    end if;

    insert into private.questions (
      stable_id,
      version,
      kind,
      prompt,
      subcategory,
      difficulty,
      country_code,
      source,
      source_verified,
      review_status,
      last_reviewed,
      reference_year,
      asset,
      published
    )
    values (
      v_stable_id,
      v_existing + 1,
      v_record ->> 'type',
      v_record ->> 'prompt',
      v_record ->> 'subcategory',
      v_record ->> 'difficulty',
      v_record ->> 'countryCode',
      v_record ->> 'source',
      coalesce((v_record ->> 'sourceVerified')::boolean, false),
      v_record ->> 'reviewStatus',
      (v_record ->> 'lastReviewed')::date,
      (v_record ->> 'referenceYear')::integer,
      nullif(v_record -> 'asset', 'null'::jsonb),
      p_publish
    )
    returning id into v_question_id;

    insert into private.question_options (
      question_id,
      id,
      label
    )
    select
      v_question_id,
      option_entry.value ->> 'id',
      option_entry.value ->> 'label'
    from jsonb_array_elements(
      v_record -> 'options'
    ) as option_entry(value);

    insert into private.private_question_answers (
      question_id,
      correct_option,
      explanation
    )
    values (
      v_question_id,
      v_record ->> 'correct',
      v_record ->> 'explanation'
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'count', v_row,
    'errors', '[]'::jsonb
  );
end;
$function$;

create or replace function public.arena_admin_unpublish(
  p_stable_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.require_admin();
  perform private.rate('admin_unpublish', 30);

  if p_stable_id is null
    or p_stable_id !~ '^[a-zA-Z0-9_-]{3,80}$'
  then
    raise exception 'INVALID_STABLE_ID';
  end if;

  perform pg_advisory_xact_lock(724182001);

  update private.questions
  set published = false
  where stable_id = p_stable_id;
end;
$function$;

-- ============================================================
-- 14. Function permissions
-- ============================================================

-- Internal helpers are never callable by frontend roles.
revoke all on all functions in schema private
  from public, anon, authenticated;

-- Only explicitly listed application RPCs are granted.
do $migration$
declare
  v_function record;
begin
  for v_function in
    select proc.oid::regprocedure as signature
    from pg_proc as proc
    join pg_namespace as namespace
      on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname = any(array[
        'arena_start',
        'arena_view',
        'arena_answer',
        'arena_next',
        'arena_abandon',
        'arena_profile',
        'arena_dashboard',
        'arena_explore',
        'arena_export',
        'arena_admin_list',
        'arena_admin_import',
        'arena_admin_unpublish'
      ]::text[])
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      v_function.signature
    );

    execute format(
      'grant execute on function %s to authenticated',
      v_function.signature
    );
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';

commit;