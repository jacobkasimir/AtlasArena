begin;

create or replace function public.arena_admin_list_filtered(
  p_search text,
  p_offset integer,
  p_category text,
  p_subcategory text,
  p_difficulty text,
  p_review_status text,
  p_source_verified boolean,
  p_type text,
  p_country_code text,
  p_reference_year integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_total bigint;
begin
  perform private.require_admin();
  perform private.rate('admin_list', 60);

  if p_search is null
    or length(p_search) > 100
    or p_offset is null
    or p_offset < 0
    or p_offset > 100000
    or (p_category is not null and p_category <> 'geography')
    or (p_subcategory is not null and not exists (
      select 1 from public.categories as category
      where category.id = p_subcategory
        and category.parent_id = 'geography'
    ))
    or (p_difficulty is not null and private.drank(p_difficulty) < 0)
    or (p_review_status is not null
      and p_review_status not in ('draft', 'reviewed'))
    or (p_type is not null and p_type not in ('mc', 'tf'))
    or (p_country_code is not null
      and p_country_code !~ '^[A-Z]{2}$')
    or (p_reference_year is not null
      and p_reference_year not between 1900 and 2100)
  then
    raise exception 'INVALID_FILTER';
  end if;

  with latest as (
    select distinct on (question.stable_id) question.*
    from private.questions as question
    order by question.stable_id, question.version desc
  )
  select count(*) into v_total
  from latest as question
  where (p_search = ''
      or question.stable_id ilike '%' || p_search || '%'
      or question.prompt ilike '%' || p_search || '%')
    and (p_category is null or p_category = 'geography')
    and (p_subcategory is null or question.subcategory = p_subcategory)
    and (p_difficulty is null or question.difficulty = p_difficulty)
    and (p_review_status is null or question.review_status = p_review_status)
    and (p_source_verified is null or question.source_verified = p_source_verified)
    and (p_type is null or question.kind = p_type)
    and (p_country_code is null or question.country_code = p_country_code)
    and (p_reference_year is null or question.reference_year = p_reference_year);

  return jsonb_build_object(
    'total', v_total,
    'items', coalesce((
      with latest as (
        select distinct on (question.stable_id) question.*
        from private.questions as question
        order by question.stable_id, question.version desc
      ), page as (
        select question.id, question.stable_id
        from latest as question
        where (p_search = ''
            or question.stable_id ilike '%' || p_search || '%'
            or question.prompt ilike '%' || p_search || '%')
          and (p_category is null or p_category = 'geography')
          and (p_subcategory is null
            or question.subcategory = p_subcategory)
          and (p_difficulty is null
            or question.difficulty = p_difficulty)
          and (p_review_status is null
            or question.review_status = p_review_status)
          and (p_source_verified is null
            or question.source_verified = p_source_verified)
          and (p_type is null or question.kind = p_type)
          and (p_country_code is null
            or question.country_code = p_country_code)
          and (p_reference_year is null
            or question.reference_year = p_reference_year)
        order by question.stable_id
        limit 20 offset p_offset
      )
      select jsonb_agg(
        private.admin_record(question)
        order by page.stable_id
      )
      from page
      join private.questions as question on question.id = page.id
    ), '[]'::jsonb),
    'categories', jsonb_build_array('geography'),
    'topics', coalesce((
      select jsonb_agg(category.id order by category.id)
      from public.categories as category
      where category.parent_id = 'geography'
    ), '[]'::jsonb),
    'difficulties', coalesce((
      select jsonb_agg(option.value order by option.rank)
      from (values
        ('easy', 1), ('medium', 2), ('hard', 3), ('expert', 4)
      ) as option(value, rank)
      where exists (
        select 1 from private.questions as question
        where question.difficulty = option.value
      )
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.arena_admin_list_filtered(
  text, integer, text, text, text, text, boolean, text, text, integer
) from public, anon, authenticated;
grant execute on function public.arena_admin_list_filtered(
  text, integer, text, text, text, text, boolean, text, text, integer
) to authenticated;

notify pgrst, 'reload schema';
commit;
