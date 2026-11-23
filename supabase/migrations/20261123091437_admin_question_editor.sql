begin;
-- Admins can open the question they are playing (or reviewing) and edit it in place.
-- Saving goes through arena_admin_import (policy 'version'), so every edit is validated the same way
-- and creates a new version; publishing still requires a verified source and a dated human review.

create or replace function public.arena_admin_question(p_question_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_played private.questions%rowtype;
  v_latest private.questions%rowtype;
begin
  perform private.require_admin();
  select * into v_played from private.questions as question where question.id = p_question_id;
  if not found then raise exception 'QUESTION_NOT_FOUND'; end if;
  select * into v_latest from private.questions as question
    where question.stable_id = v_played.stable_id order by question.version desc limit 1;
  return jsonb_build_object(
    'record', private.admin_record(v_latest),
    'published', v_latest.published,
    'playedVersion', v_played.version,
    'latestVersion', v_latest.version,
    'publishedVersion', (select question.version from private.questions as question
      where question.stable_id = v_played.stable_id and question.published order by question.version desc limit 1),
    'topics', (select coalesce(jsonb_agg(category.id order by category.id), '[]'::jsonb)
      from public.categories as category where category.parent_id = 'geography')
  );
end;
$function$;

revoke all on function public.arena_admin_question(uuid) from public, anon;
grant execute on function public.arena_admin_question(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
