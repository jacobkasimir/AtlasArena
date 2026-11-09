begin;

-- Keep the private catalog behind the existing authenticated, rate-limited
-- RPC. Return only fields used by the World Explorer, never raw_data or quiz
-- answers.
create or replace function public.arena_explore()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.rate('explore', 60);

  return (
    with practice_availability as (
      select question.country_code, question.difficulty, count(*)::integer as question_count
      from private.questions as question
      where question.country_code is not null
        and question.published
        and question.source_verified
        and question.review_status = 'reviewed'
        and question.kind in ('mc', 'tf')
      group by question.country_code, question.difficulty
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'code', country.code,
      'name', country.name,
      'capital', country.capital,
      'region', country.region,
      'currency', country.currency,
      'flag', country.flag,
      'difficulty', country.difficulty,
      'officialName', country.name_official,
      'catalogKind', country.catalog_kind,
      'flagEmoji', country.flag_emoji,
      'flagSvgUrl', country.flag_svg_url,
      'flagPngUrl', country.flag_png_url,
      'population', country.population,
      'areaKm2', country.area_km2,
      'wikipediaUrl', country.link_wikipedia,
      'googleMapsUrl', country.link_google_maps,
      'languages', case
        when jsonb_typeof(country.languages) = 'array' then (
          select coalesce(jsonb_agg(language_name order by language_name), '[]'::jsonb)
          from (
            select distinct case
              when jsonb_typeof(value) = 'object' then value ->> 'name'
              else value #>> '{}'
            end as language_name
            from jsonb_array_elements(country.languages) as language_entry(value)
            where jsonb_typeof(value) in ('object', 'string')
              and length(trim(case
                when jsonb_typeof(value) = 'object' then coalesce(value ->> 'name', '')
                else value #>> '{}'
              end)) > 0
          ) as normalized_languages
        )
        else '[]'::jsonb
      end,
      'translations', case
        when jsonb_typeof(country.name_translations) = 'object' then (
          select coalesce(jsonb_object_agg(language_code, translated_name), '{}'::jsonb)
          from (
            select translation.key as language_code,
              case
                when jsonb_typeof(translation.value) = 'object' then translation.value ->> 'common'
                else translation.value #>> '{}'
              end as translated_name
            from jsonb_each(country.name_translations) as translation(key, value)
            where jsonb_typeof(translation.value) in ('object', 'string')
              and length(trim(case
                when jsonb_typeof(translation.value) = 'object' then coalesce(translation.value ->> 'common', '')
                else translation.value #>> '{}'
              end)) > 0
          ) as normalized_translations
        )
        else '{}'::jsonb
      end,
      'currencies', case
        when jsonb_typeof(country.currencies) = 'array' then (
          select coalesce(jsonb_agg(jsonb_build_object(
            'code', currency.value ->> 'code',
            'name', currency.value ->> 'name',
            'symbol', currency.value ->> 'symbol'
          ) order by currency.value ->> 'name'), '[]'::jsonb)
          from jsonb_array_elements(country.currencies) as currency(value)
          where jsonb_typeof(currency.value) = 'object'
            and length(trim(coalesce(currency.value ->> 'name', ''))) > 0
        )
        else '[]'::jsonb
      end,
      'neighbors', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'alpha3', border.alpha3,
          'code', neighbor.code,
          'name', neighbor.name
        ) order by coalesce(neighbor.name, border.alpha3)), '[]'::jsonb)
        from unnest(coalesce(country.borders, array[]::text[])) as border(alpha3)
        left join private.countries as neighbor
          on upper(neighbor.code_alpha3) = upper(border.alpha3)
      ),
      'callingCodes', to_jsonb(coalesce(country.calling_codes, array[]::text[])),
      'topLevelDomains', to_jsonb(coalesce(country.tlds, array[]::text[])),
      'memberships', (
        select jsonb_agg(jsonb_build_object('name', membership.name, 'member', membership.member))
        from (values
          ('United Nations', country.membership_un),
          ('European Union', country.membership_eu),
          ('Eurozone', country.membership_eurozone),
          ('Schengen Area', country.membership_schengen),
          ('NATO', country.membership_nato),
          ('Commonwealth', country.membership_commonwealth),
          ('OECD', country.membership_oecd),
          ('G7', country.membership_g7),
          ('G20', country.membership_g20),
          ('BRICS', country.membership_brics),
          ('OPEC', country.membership_opec),
          ('African Union', country.membership_african_union),
          ('ASEAN', country.membership_asean),
          ('Arab League', country.membership_arab_league)
        ) as membership(name, member)
        where membership.member is not null
      ),
      'practiceQuestionCount', coalesce(availability.question_count, 0)
    ) order by country.name, country.code), '[]'::jsonb)
    from private.countries as country
    left join practice_availability as availability
      on availability.country_code = country.code
     and availability.difficulty = country.difficulty
  );
end;
$function$;

revoke all on function public.arena_explore() from public, anon, authenticated;
grant execute on function public.arena_explore() to authenticated;
notify pgrst, 'reload schema';

commit;
