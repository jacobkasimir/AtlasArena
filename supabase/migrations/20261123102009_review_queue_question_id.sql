begin;
-- The admin review queue also returns the draft's question id, so the in-place editor can open it.
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
      'questionId', v_question.id,
      'countryName', (select country.name from private.countries as country where country.code = v_question.country_code)) end
  );
end;
$function$;
notify pgrst, 'reload schema';
commit;
