begin;
-- 1. How many playable questions each quiz topic has, per difficulty and type, so the setup can show
--    counts and disable topics that can't fill a round. Same filter as arena_start.
create or replace function public.arena_quiz_catalog()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.require_user();
  perform private.rate('quiz_catalog', 60);
  return coalesce((
    select jsonb_agg(jsonb_build_object('topic', counts.subcategory, 'difficulty', counts.difficulty,
      'kind', counts.kind, 'count', counts.n) order by counts.subcategory, counts.difficulty, counts.kind)
    from (
      select question.subcategory, question.difficulty, question.kind, count(*)::integer as n
      from private.questions as question
      where question.published and question.source_verified and question.review_status = 'reviewed'
        and question.kind in ('mc', 'tf')
      group by 1, 2, 3
    ) as counts
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.arena_quiz_catalog() from public, anon;
grant execute on function public.arena_quiz_catalog() to authenticated;

-- 2. Clean-up: the older admin list overload (without p_published) is no longer called.
drop function if exists public.arena_admin_list_filtered(text, integer, text, text, text, text, boolean, text, text, integer);

-- 3. Indexes for foreign keys the performance advisor flagged.
create index if not exists capital_action_requests_session_idx on private.capital_action_requests(session_id);
create index if not exists flags_start_requests_session_idx on private.flags_start_requests(session_id);
create index if not exists private_question_answers_option_idx on private.private_question_answers(question_id, correct_option);
create index if not exists questions_country_code_idx on private.questions(country_code);
create index if not exists recall_aliases_country_code_idx on private.recall_aliases(country_code);
create index if not exists categories_parent_idx on public.categories(parent_id);
create index if not exists player_category_stats_subcategory_idx on public.player_category_stats(subcategory);

notify pgrst, 'reload schema';
commit;
