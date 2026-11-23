begin;
-- Achievements v2: 42 badges in seven categories with bronze/silver/gold/platinum tiers, including very hard ones.
-- `icon` is now an icon key for the app's SVG icon set instead of an emoji.
-- Fix: "Continental" and "World tour" only count full rounds (all places, not the Easy or hand-picked pool).
create or replace function public.arena_achievements()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_today date := private.daily_today();
  v_games integer; v_perfect integer; v_lightning integer; v_streak integer; v_endless integer; v_timed integer;
  v_answered integer; v_correct integer; v_accuracy numeric;
  v_level integer;
  v_daily_days integer; v_daily_best integer; v_daily_perfect integer; v_daily_wins integer;
  v_flags integer; v_flags_total integer; v_flags_perfect integer;
  v_capitals integer; v_capitals_un integer; v_capitals_un_total integer; v_capitals_perfect integer;
  v_region integer; v_regions integer; v_regions_total integer; v_world integer; v_speed_world integer;
  v_capital_world integer; v_everything integer; v_polyglot integer; v_cleared integer;
begin
  perform private.rate('achievements', 60);

  -- Quiz games
  select count(*),
      count(*) filter (where game.mode = 'classic' and game.correct = 10 and game.incorrect = 0),
      count(*) filter (where game.mode = 'classic' and game.correct = 10 and game.incorrect = 0 and game.response_ms <= 30000),
      coalesce(max(game.best_streak), 0),
      coalesce(max(game.correct) filter (where game.mode = 'endless'), 0),
      coalesce(max(game.correct) filter (where game.mode = 'timed'), 0),
      coalesce(sum(game.correct + game.incorrect) filter (where game.mode <> 'practice'), 0),
      coalesce(sum(game.correct) filter (where game.mode <> 'practice'), 0),
      count(*) filter (where game.daily_date is not null and game.correct = 10)
    into v_games, v_perfect, v_lightning, v_streak, v_endless, v_timed, v_answered, v_correct, v_daily_perfect
    from private.game_sessions as game where game.user_id = v_uid and game.state = 'completed';
  v_accuracy := case when v_answered > 0 then 100.0 * v_correct / v_answered else 0 end;
  select 1 + profile.xp / 500 into v_level from public.profiles as profile where profile.id = v_uid;

  -- Daily challenge
  v_daily_best := coalesce((private.daily_streaks(v_uid, v_today) ->> 'best')::integer, 0);
  select count(distinct game.daily_date) into v_daily_days
    from private.game_sessions as game
    where game.user_id = v_uid and game.daily_date is not null and game.state = 'completed';
  select count(*) into v_daily_wins from (
    select game.daily_date, game.user_id,
      rank() over (partition by game.daily_date order by game.score desc) as day_rank
    from private.game_sessions as game
    where game.daily_date is not null and game.daily_date < v_today and game.state = 'completed'
  ) as ranked where ranked.user_id = v_uid and ranked.day_rank = 1;

  -- Flags
  select count(distinct entry.country_code) into v_flags
    from private.flags_session_entries as entry join private.flags_sessions as round on round.id = entry.session_id
    where round.user_id = v_uid and entry.outcome = 'correct';
  select count(*) into v_flags_total from private.countries as country where country.flag_svg_url is not null;
  select count(*) into v_flags_perfect from private.flags_sessions as round
    where round.user_id = v_uid and round.state = 'completed' and round.region is null and round.sample_size is null
      and round.pool_tier = 'all' and coalesce(cardinality(round.selected_codes), 0) = 0
      and round.incorrect_count = 0 and round.skipped_count = 0 and round.hints_used = 0
      and round.correct_count = round.pool_count;

  -- Capitals (Capitals game plus capitals typed in Recall)
  with named as (
    select entry.country_code as code from private.capital_session_entries as entry
      join private.capital_sessions as round on round.id = entry.session_id
      where round.user_id = v_uid and entry.outcome = 'correct' and round.direction = 'country_to_capital'
    union
    select entry.country_code from private.recall_session_entries as entry
      join private.recall_sessions as round on round.id = entry.session_id
      where round.user_id = v_uid and round.kind = 'capitals' and entry.found_at is not null
  )
  select count(*), count(*) filter (where exists (
      select 1 from private.countries as country where country.code = named.code and country.membership_un))
    into v_capitals, v_capitals_un from named;
  select count(*) into v_capitals_un_total from private.recall_catalog() as catalog
    where catalog.un and jsonb_array_length(catalog.capital_names) > 0;
  select count(*) into v_capitals_perfect from private.capital_sessions as round
    where round.user_id = v_uid and round.state = 'completed' and round.direction = 'country_to_capital'
      and round.region is null and round.sample_size is null and round.pool_mode = 'all'
      and coalesce(cardinality(round.selected_codes), 0) = 0
      and round.incorrect_count = 0 and round.skipped_count = 0 and round.correct_count = round.pool_count;

  -- Recall: only full rounds (every place of the chosen area) count
  select count(*) filter (where round.kind = 'countries' and round.region is not null),
      count(distinct round.region) filter (where round.kind = 'countries' and round.region is not null),
      count(*) filter (where round.kind = 'countries' and round.region is null),
      count(*) filter (where round.kind = 'countries' and round.region is null and round.elapsed_ms <= 600000),
      count(*) filter (where round.kind = 'capitals' and round.region is null),
      count(*) filter (where round.kind = 'countries' and round.region is null and round.scope = 'all')
    into v_region, v_regions, v_world, v_speed_world, v_capital_world, v_everything
    from private.recall_sessions as round
    where round.user_id = v_uid and round.end_reason = 'all_found' and round.set_size is null and round.pool = 'all';
  select count(distinct catalog.region) into v_regions_total from private.recall_catalog() as catalog where catalog.un;
  select count(distinct entry.matched_lang) into v_polyglot
    from private.recall_session_entries as entry join private.recall_sessions as round on round.id = entry.session_id
    where round.user_id = v_uid and entry.matched_lang in ('de', 'fr');

  select count(*) into v_cleared from private.review_cleared as cleared where cleared.user_id = v_uid;

  return (select jsonb_agg(jsonb_build_object('id', item.id, 'category', item.category, 'tier', item.tier, 'icon', item.icon,
      'title', item.title, 'description', item.description,
      'current', least(item.current, item.target), 'target', item.target,
      'earned', item.current >= item.target and item.ok) order by item.ord)
    from (values
      (1,  'first-game',       'quiz',     'bronze',   'quiz',      'First steps',          'Finish your first quiz game.', v_games, 1, true),
      (2,  'regular',          'quiz',     'bronze',   'layers',    'Regular',              'Finish 25 quiz games.', v_games, 25, true),
      (3,  'veteran',          'quiz',     'silver',   'layers',    'Veteran',              'Finish 100 quiz games.', v_games, 100, true),
      (4,  'marathoner',       'quiz',     'gold',     'hourglass', 'Marathoner',           'Finish 500 quiz games.', v_games, 500, true),
      (5,  'on-fire',          'quiz',     'bronze',   'flame',     'On fire',              'Get 10 quiz answers right in a row.', v_streak, 10, true),
      (6,  'unstoppable',      'quiz',     'silver',   'flame',     'Unstoppable',          'Get 25 quiz answers right in a row.', v_streak, 25, true),
      (7,  'untouchable',      'quiz',     'platinum', 'flame',     'Untouchable',          'Get 50 quiz answers right in a row in one game.', v_streak, 50, true),
      (8,  'flawless',         'quiz',     'silver',   'gem',       'Flawless',             'Answer all ten questions of a Classic game correctly.', v_perfect, 1, true),
      (9,  'perfectionist',    'quiz',     'gold',     'gem',       'Perfectionist',        'Play 10 flawless Classic games.', v_perfect, 10, true),
      (10, 'lightning',        'quiz',     'platinum', 'zap',       'Lightning round',      'A flawless Classic game in under 30 seconds of answer time.', v_lightning, 1, true),
      (11, 'speedrunner',      'quiz',     'gold',     'timer',     'Speedrunner',          'Get 30 answers right in one Timed Challenge.', v_timed, 30, true),
      (12, 'deep-dive',        'quiz',     'silver',   'infinity',  'Deep dive',            'Get 25 answers right in one Endless game.', v_endless, 25, true),
      (13, 'endless-horizon',  'quiz',     'platinum', 'infinity',  'Endless horizon',      'Get 75 answers right in one Endless game.', v_endless, 75, true),
      (14, 'sharpshooter',     'quiz',     'platinum', 'target',    'Sharpshooter',         'Keep 90% accuracy over at least 1,000 scored answers.',
            case when v_accuracy >= 90 then v_answered else least(v_answered, 999) end, 1000, v_accuracy >= 90),
      (15, 'level-5',          'progress', 'bronze',   'trending',  'Rising star',          'Reach level 5.', v_level, 5, true),
      (16, 'level-10',         'progress', 'silver',   'trending',  'Seasoned explorer',    'Reach level 10.', v_level, 10, true),
      (17, 'level-25',         'progress', 'gold',     'crown',     'Grand cartographer',   'Reach level 25.', v_level, 25, true),
      (18, 'level-50',         'progress', 'platinum', 'crown',     'Living atlas',         'Reach level 50.', v_level, 50, true),
      (19, 'daily-first',      'daily',    'bronze',   'calendar',  'Daily habit',          'Play your first daily challenge.', v_daily_days, 1, true),
      (20, 'daily-7',          'daily',    'silver',   'calendar',  'Seven days strong',    'Play the daily challenge 7 days in a row.', v_daily_best, 7, true),
      (21, 'daily-30',         'daily',    'gold',     'calendar',  'Month of maps',        'Play the daily challenge 30 days in a row.', v_daily_best, 30, true),
      (22, 'daily-100',        'daily',    'platinum', 'calendar',  'Centurion',            'Play the daily challenge 100 days in a row.', v_daily_best, 100, true),
      (23, 'daily-perfect',    'daily',    'silver',   'star',      'Perfect day',          'Get all ten daily questions right.', v_daily_perfect, 1, true),
      (24, 'daily-champion',   'daily',    'gold',     'podium',    'Champion of the day',  'Finish a daily challenge in first place.', v_daily_wins, 1, true),
      (25, 'flags-50',         'flags',    'bronze',   'flag',      'Flag spotter',         'Recognise 50 different flags.', v_flags, 50, true),
      (26, 'flags-150',        'flags',    'silver',   'flag',      'Vexillologist',        'Recognise 150 different flags.', v_flags, 150, true),
      (27, 'flags-all',        'flags',    'gold',     'flag',      'Every flag flies',     'Recognise every flag in the atlas.', v_flags, v_flags_total, true),
      (28, 'flags-master',     'flags',    'platinum', 'shield',    'Flag master',          'Finish a whole-world flags round with no mistakes, hints or skips.', v_flags_perfect, 1, true),
      (29, 'capitals-50',      'capitals', 'bronze',   'capital',   'Capital collector',    'Name 50 different capitals.', v_capitals, 50, true),
      (30, 'capitals-150',     'capitals', 'silver',   'capital',   'Atlas scholar',        'Name 150 different capitals.', v_capitals, 150, true),
      (31, 'capitals-un',      'capitals', 'gold',     'capital',   'Capital of capitals',  'Name the capital of every UN member state.', v_capitals_un, v_capitals_un_total, true),
      (32, 'capitals-master',  'capitals', 'platinum', 'shield',    'Capital master',       'Finish a whole-world Country → Capital round with no mistakes or skips.', v_capitals_perfect, 1, true),
      (33, 'continental',      'recall',   'bronze',   'map',       'Continental',          'Name every country of a region in one Recall round.', v_region, 1, true),
      (34, 'six-continents',   'recall',   'gold',     'map',       'All six continents',   'Complete a Recall round for every inhabited region.', v_regions, v_regions_total, true),
      (35, 'world-tour',       'recall',   'gold',     'globe',     'World tour',           'Name all UN member states in one Recall round.', v_world, 1, true),
      (36, 'speed-atlas',      'recall',   'platinum', 'zap',       'Speed atlas',          'Name all UN member states in under 10 minutes.', v_speed_world, 1, true),
      (37, 'capital-marathon', 'recall',   'platinum', 'sparkles',  'Capital marathon',     'Name every UN capital in one Recall round.', v_capital_world, 1, true),
      (38, 'every-place',      'recall',   'platinum', 'compass',   'Every place on Earth', 'Name every country and territory in one Recall round.', v_everything, 1, true),
      (39, 'polyglot',         'recall',   'silver',   'languages', 'Polyglot',             'Get Recall answers right in both German and French.', v_polyglot, 2, true),
      (40, 'second-chances',   'review',   'bronze',   'review',    'Second chances',       'Clear 25 mistakes in Review.', v_cleared, 25, true),
      (41, 'lesson-learned',   'review',   'silver',   'review',    'Lesson learned',       'Clear 100 mistakes in Review.', v_cleared, 100, true),
      (42, 'clean-slate',      'review',   'gold',     'book',      'Clean slate',          'Clear 500 mistakes in Review.', v_cleared, 500, true)
    ) as item(ord, id, category, tier, icon, title, description, current, target, ok));
end;
$function$;

revoke all on function public.arena_achievements() from public, anon;
grant execute on function public.arena_achievements() to authenticated;

notify pgrst, 'reload schema';
commit;
