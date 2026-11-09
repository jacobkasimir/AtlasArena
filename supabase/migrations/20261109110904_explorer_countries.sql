begin;

create or replace function public.arena_explore()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Existing helper also requires an authenticated identity.
  perform private.rate('explore', 60);

  return (
    with practice_availability as (
      select
        question.country_code,
        question.difficulty,
        count(*)::integer as question_count
      from private.questions as question
      where question.country_code is not null
        and question.published
        and question.source_verified
        and question.review_status = 'reviewed'
        and question.kind in ('mc', 'tf')
      group by
        question.country_code,
        question.difficulty
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'code', country.code,
          'name', country.name,
          'capital', country.capital,
          'region', country.region,
          'currency', country.currency,
          'flag', country.flag,
          'difficulty', country.difficulty,
          'source', country.source,

          'officialName', country.name_official,
          'catalogKind', country.catalog_kind,
          'flagEmoji', country.flag_emoji,
          'flagSvgUrl', country.flag_svg_url,
          'flagPngUrl', country.flag_png_url,
          'population', country.population,
          'wikipediaUrl', country.link_wikipedia,

          'languages', case
            when jsonb_typeof(country.languages) = 'array'
            then (
              select coalesce(
                jsonb_agg(
                  language_entry.value ->> 'name'
                  order by language_entry.value ->> 'name'
                ),
                '[]'::jsonb
              )
              from jsonb_array_elements(
                country.languages
              ) as language_entry(value)
              where jsonb_typeof(
                language_entry.value -> 'name'
              ) = 'string'
                and length(
                  trim(language_entry.value ->> 'name')
                ) > 0
            )
            else '[]'::jsonb
          end,

          'practiceQuestionCount',
            coalesce(availability.question_count, 0)
        )
        order by country.name, country.code
      ),
      '[]'::jsonb
    )
    from private.countries as country
    left join practice_availability as availability
      on availability.country_code = country.code
     and availability.difficulty = country.difficulty

    -- Intentionally no minimum-question filter here:
    -- every catalog entry may be explored.
  );
end;
$function$;

revoke all on function public.arena_explore()
  from public, anon, authenticated;

grant execute on function public.arena_explore()
  to authenticated;

notify pgrst, 'reload schema';

commit;