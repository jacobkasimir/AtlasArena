-- Atlas Recall: name every country or capital in a chosen set.
--
-- Answers never leave the server in clear text while a round is active. Each
-- accepted spelling (English, German, French) is normalized, salted per session
-- and hashed; the browser hashes what the player types and matches locally for
-- instant feedback, then the server re-verifies every match.
begin;

-- ---------------------------------------------------------------------------
-- Curated extra spellings. The catalog stores English capitals only and some
-- common country names are missing; these are exonyms, not quiz facts.
-- ---------------------------------------------------------------------------
create table if not exists private.recall_aliases (
  kind text not null check (kind in ('country', 'capital')),
  country_code text not null references private.countries(code) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  lang text not null check (lang in ('en', 'de', 'fr')),
  primary key (kind, country_code, name)
);
alter table private.recall_aliases enable row level security;
revoke all on private.recall_aliases from public, anon, authenticated;

insert into private.recall_aliases(kind, country_code, name, lang) values
  -- Countries
  ('country','AE','UAE','en'), ('country','AE','VAE','de'), ('country','AE','EAU','fr'),
  ('country','BY','Weißrussland','de'), ('country','BY','Biélorussie','fr'),
  ('country','CD','DR Kongo','de'), ('country','CD','Demokratische Republik Kongo','de'), ('country','CD','RD Congo','fr'),
  ('country','CD','République démocratique du Congo','fr'), ('country','CG','Republik Kongo','de'), ('country','CG','République du Congo','fr'),
  ('country','CZ','Tschechische Republik','de'), ('country','CZ','République tchèque','fr'),
  ('country','CV','Cap-Vert','fr'), ('country','GB','Großbritannien','de'), ('country','GB','Grande-Bretagne','fr'),
  ('country','MK','Mazedonien','de'), ('country','MK','Macédoine','fr'), ('country','MM','Birma','de'),
  ('country','NL','Holland','de'), ('country','NR','Nauru','en'), ('country','SZ','Eswatini','de'), ('country','SZ','Eswatini','fr'),
  ('country','TL','Timor-Leste','fr'), ('country','TR','Türkiye','en'), ('country','US','USA','de'),
  ('country','VA','Vatikan','de'), ('country','VA','Heiliger Stuhl','de'), ('country','VA','Saint-Siège','fr'), ('country','VA','Vatican','fr'),
  -- Capitals: English variants
  ('capital','UA','Kiev','en'), ('capital','MN','Ulaanbaatar','en'), ('capital','CN','Peking','en'), ('capital','US','Washington','en'),
  ('capital','US','Washington DC','en'), ('capital','MM','Naypyitaw','en'), ('capital','MM','Nay Pyi Taw','en'),
  ('capital','LK','Kotte','en'), ('capital','LK','Sri Jayewardenepura Kotte','en'), ('capital','KI','Tarawa','en'),
  ('capital','TM','Ashkhabad','en'), ('capital','EH','Laayoune','en'), ('capital','XK','Prishtina','en'), ('capital','TT','Port-of-Spain','en'),
  ('capital','CL','Santiago de Chile','en'), ('capital','SM','San Marino','en'), ('capital','KW','Kuwait','en'), ('capital','IN','Delhi','en'),
  -- Capitals: German
  ('capital','AT','Wien','de'), ('capital','BE','Brüssel','de'), ('capital','CY','Nikosia','de'), ('capital','CZ','Prag','de'),
  ('capital','DK','Kopenhagen','de'), ('capital','GR','Athen','de'), ('capital','IT','Rom','de'), ('capital','LT','Wilna','de'),
  ('capital','LU','Luxemburg','de'), ('capital','MD','Kischinau','de'), ('capital','PL','Warschau','de'), ('capital','PT','Lissabon','de'),
  ('capital','RO','Bukarest','de'), ('capital','RU','Moskau','de'), ('capital','RS','Belgrad','de'), ('capital','SK','Pressburg','de'),
  ('capital','SI','Laibach','de'), ('capital','UA','Kiew','de'), ('capital','UA','Kyjiw','de'), ('capital','VA','Vatikanstadt','de'),
  ('capital','AM','Jerewan','de'), ('capital','CN','Peking','de'), ('capital','GE','Tiflis','de'), ('capital','IN','Neu-Delhi','de'),
  ('capital','IR','Teheran','de'), ('capital','IQ','Bagdad','de'), ('capital','JP','Tokio','de'), ('capital','KW','Kuwait-Stadt','de'),
  ('capital','KG','Bischkek','de'), ('capital','NP','Katmandu','de'), ('capital','KP','Pjöngjang','de'), ('capital','OM','Maskat','de'),
  ('capital','SA','Riad','de'), ('capital','SG','Singapur','de'), ('capital','SY','Damaskus','de'), ('capital','TW','Taipeh','de'),
  ('capital','TJ','Duschanbe','de'), ('capital','TM','Aschgabat','de'), ('capital','UZ','Taschkent','de'), ('capital','YE','Sanaa','de'),
  ('capital','DZ','Algier','de'), ('capital','CM','Jaunde','de'), ('capital','DJ','Dschibuti','de'), ('capital','EG','Kairo','de'),
  ('capital','ET','Addis Abeba','de'), ('capital','LY','Tripolis','de'), ('capital','SO','Mogadischu','de'), ('capital','ZA','Kapstadt','de'),
  ('capital','SD','Khartum','de'), ('capital','CU','Havanna','de'), ('capital','GT','Guatemala-Stadt','de'), ('capital','MX','Mexiko-Stadt','de'),
  ('capital','PA','Panama-Stadt','de'), ('capital','KI','Süd-Tarawa','de'), ('capital','entity:abkhazia','Suchumi','de'),
  ('capital','entity:south-ossetia','Zchinwali','de'), ('capital','entity:northern-cyprus','Nord-Nikosia','de'),
  -- Capitals: French
  ('capital','AT','Vienne','fr'), ('capital','BE','Bruxelles','fr'), ('capital','CY','Nicosie','fr'), ('capital','DK','Copenhague','fr'),
  ('capital','GR','Athènes','fr'), ('capital','MT','La Valette','fr'), ('capital','PL','Varsovie','fr'), ('capital','PT','Lisbonne','fr'),
  ('capital','RO','Bucarest','fr'), ('capital','RU','Moscou','fr'), ('capital','SM','Saint-Marin','fr'), ('capital','CH','Berne','fr'),
  ('capital','GB','Londres','fr'), ('capital','VA','Cité du Vatican','fr'), ('capital','AD','Andorre-la-Vieille','fr'),
  ('capital','AF','Kaboul','fr'), ('capital','AM','Erevan','fr'), ('capital','AZ','Bakou','fr'), ('capital','BD','Dacca','fr'),
  ('capital','BT','Thimphou','fr'), ('capital','CN','Pékin','fr'), ('capital','GE','Tbilissi','fr'), ('capital','ID','Djakarta','fr'),
  ('capital','IR','Téhéran','fr'), ('capital','IQ','Bagdad','fr'), ('capital','IL','Jérusalem','fr'), ('capital','PS','Jérusalem','fr'),
  ('capital','KW','Koweït','fr'), ('capital','KG','Bichkek','fr'), ('capital','LB','Beyrouth','fr'), ('capital','MN','Oulan-Bator','fr'),
  ('capital','NP','Katmandou','fr'), ('capital','OM','Mascate','fr'), ('capital','PH','Manille','fr'), ('capital','SA','Riyad','fr'),
  ('capital','SG','Singapour','fr'), ('capital','KR','Séoul','fr'), ('capital','SY','Damas','fr'), ('capital','TJ','Douchanbé','fr'),
  ('capital','TM','Achgabat','fr'), ('capital','AE','Abou Dabi','fr'), ('capital','UZ','Tachkent','fr'), ('capital','DZ','Alger','fr'),
  ('capital','EG','Le Caire','fr'), ('capital','ET','Addis-Abeba','fr'), ('capital','MG','Tananarive','fr'), ('capital','SO','Mogadiscio','fr'),
  ('capital','ZA','Le Cap','fr'), ('capital','SS','Djouba','fr'), ('capital','CU','La Havane','fr'), ('capital','DO','Saint-Domingue','fr'),
  ('capital','GT','Guatemala','fr'), ('capital','MX','Mexico','fr'), ('capital','PA','Panama','fr'), ('capital','TT','Port-d''Espagne','fr')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Normalization. src/recall-domain.ts implements the exact same rules; keep
-- both in sync (verified against every catalog name before release).
--   unaccent, lowercase, drop apostrophes, other punctuation -> space,
--   token "st" -> "saint", leading "the" dropped, then all spaces removed
--   (so "Cote d Ivoire", "Côte d'Ivoire" and "cotedivoire" are equal).
-- ---------------------------------------------------------------------------
create or replace function private.recall_normalize(p_text text)
returns text
language sql
immutable
set search_path = extensions, pg_catalog
as $function$
  select replace(btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        ' ' || regexp_replace(
          regexp_replace(lower(unaccent(coalesce(p_text, ''))), '[''’ʻʼ`´]', '', 'g'),
          '[^a-z0-9]+', ' ', 'g') || ' ',
        ' st(?= )', ' saint', 'g'),
      '^ the ', ' '),
    ' +', ' ', 'g')), ' ', '');
$function$;

create or replace function private.recall_hash(p_salt text, p_key text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select left(encode(pg_catalog.sha256(pg_catalog.convert_to(p_salt || ':' || p_key, 'UTF8')), 'hex'), 16);
$function$;

create or replace function private.recall_catalog()
returns table (
  code text, name text, region text, un boolean, alpha2 text,
  country_names jsonb, capital_names jsonb, capital_display text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select country.code, country.name, nullif(trim(country.region), ''),
    coalesce(country.membership_un, false),
    case when country.catalog_kind = 'iso_alpha2' and country.code ~ '^[A-Z]{2}$' then country.code end,
    (select coalesce(jsonb_agg(jsonb_build_object('name', trim(n.name), 'lang', n.lang, 'primary', n.is_primary)), '[]'::jsonb)
      from (
        select country.name, 'en', true
        union all select country.name_official, 'en', false
        union all select unnest(coalesce(country.name_alternates, array[]::text[])), 'en', false
        union all select country.name_translations::jsonb -> 'deu' ->> 'common', 'de', false
        union all select country.name_translations::jsonb -> 'deu' ->> 'official', 'de', false
        union all select country.name_translations::jsonb -> 'fra' ->> 'common', 'fr', false
        union all select country.name_translations::jsonb -> 'fra' ->> 'official', 'fr', false
        union all select alias.name, alias.lang, false from private.recall_aliases as alias
          where alias.kind = 'country' and alias.country_code = country.code
      ) as n(name, lang, is_primary)
      where length(trim(coalesce(n.name, ''))) > 0),
    (select coalesce(jsonb_agg(jsonb_build_object('name', trim(n.name), 'lang', n.lang, 'primary', n.is_primary)), '[]'::jsonb)
      from (
        select item.value ->> 'name', 'en', true
          from jsonb_array_elements(case when jsonb_typeof(country.capitals) = 'array' then country.capitals else '[]'::jsonb end) as item(value)
        union all select alias.name, alias.lang, false from private.recall_aliases as alias
          where alias.kind = 'capital' and alias.country_code = country.code
      ) as n(name, lang, is_primary)
      where length(trim(coalesce(n.name, ''))) > 0),
    (select string_agg(trim(item.value ->> 'name'), ' / ' order by item.ordinality)
      from jsonb_array_elements(case when jsonb_typeof(country.capitals) = 'array' then country.capitals else '[]'::jsonb end)
        with ordinality as item(value, ordinality)
      where length(trim(coalesce(item.value ->> 'name', ''))) > 0)
  from private.countries as country;
$function$;

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------
create table if not exists private.recall_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_request_id uuid not null,
  kind text not null check (kind in ('countries', 'capitals')),
  scope text not null check (scope in ('un', 'all')),
  region text,
  set_size integer check (set_size is null or set_size in (10, 25, 50)),
  time_limit_seconds integer check (time_limit_seconds is null or time_limit_seconds in (300, 600, 900, 1200)),
  -- Null for random subsets: those rounds are never compared for personal bests.
  pool_signature text,
  salt text not null,
  ambiguous_hashes text[] not null default '{}',
  total integer not null check (total > 0),
  found_count integer not null default 0 check (found_count >= 0 and found_count <= total),
  state text not null default 'active' check (state in ('active', 'completed', 'abandoned')),
  end_reason text check (end_reason in ('all_found', 'gave_up', 'time_up')),
  created_at timestamptz not null default clock_timestamp(),
  deadline_at timestamptz,
  completed_at timestamptz,
  elapsed_ms bigint check (elapsed_ms is null or elapsed_ms >= 0),
  badge text check (badge in ('first_run', 'new_best', 'not_best', 'unranked')),
  unique (user_id, start_request_id),
  check ((state = 'completed') = (completed_at is not null and end_reason is not null and elapsed_ms is not null and badge is not null))
);
create index if not exists recall_sessions_active on private.recall_sessions(user_id, created_at desc) where state = 'active';
create index if not exists recall_sessions_best on private.recall_sessions(user_id, pool_signature, found_count desc, elapsed_ms asc)
  where state = 'completed' and pool_signature is not null;

create table if not exists private.recall_session_entries (
  session_id uuid not null references private.recall_sessions(id) on delete cascade,
  position integer not null check (position > 0),
  country_code text not null,
  alpha2 text check (alpha2 is null or alpha2 ~ '^[A-Z]{2}$'),
  region text,
  country_name text not null,
  answer_name text not null,
  alias_keys jsonb not null,
  alias_hashes text[] not null,
  alias_langs text[] not null,
  found_at timestamptz,
  matched_text text,
  matched_lang text check (matched_lang is null or matched_lang in ('en', 'de', 'fr')),
  primary key (session_id, position),
  unique (session_id, country_code),
  check (cardinality(alias_hashes) > 0 and cardinality(alias_hashes) = cardinality(alias_langs)),
  check ((found_at is null) = (matched_text is null))
);

alter table private.recall_sessions enable row level security;
alter table private.recall_session_entries enable row level security;
revoke all on private.recall_sessions, private.recall_session_entries from public, anon, authenticated;

create or replace function private.recall_best(p_user uuid, p_signature text, p_exclude uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object('found', session.found_count, 'total', session.total,
    'elapsedMs', session.elapsed_ms, 'completedAt', session.completed_at)
  from private.recall_sessions as session
  where p_signature is not null and session.user_id = p_user and session.pool_signature = p_signature
    and session.state = 'completed' and session.id is distinct from p_exclude
  order by session.found_count desc, session.elapsed_ms asc, session.completed_at asc
  limit 1;
$function$;

create or replace function private.recall_finalize(p_session_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.recall_sessions%rowtype;
  v_end timestamptz;
  v_elapsed bigint;
  v_previous jsonb;
  v_badge text;
begin
  select * into v_session from private.recall_sessions as session where session.id = p_session_id for update;
  if not found or v_session.state <> 'active' then return; end if;
  v_end := least(clock_timestamp(), coalesce(v_session.deadline_at, 'infinity'::timestamptz));
  v_elapsed := greatest(0, floor(extract(epoch from (v_end - v_session.created_at)) * 1000))::bigint;
  if v_session.pool_signature is null then
    v_badge := 'unranked';
  else
    v_previous := private.recall_best(v_session.user_id, v_session.pool_signature, v_session.id);
    v_badge := case
      when v_previous is null then 'first_run'
      when v_session.found_count > (v_previous ->> 'found')::integer
        or (v_session.found_count = (v_previous ->> 'found')::integer and v_elapsed < (v_previous ->> 'elapsedMs')::bigint) then 'new_best'
      else 'not_best' end;
  end if;
  update private.recall_sessions set state = 'completed', end_reason = p_reason, completed_at = v_end,
    elapsed_ms = v_elapsed, badge = v_badge
  where id = p_session_id;
end;
$function$;

-- Lazily finish rounds whose time limit has passed.
create or replace function private.recall_expire(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists(select 1 from private.recall_sessions as session where session.id = p_session_id
      and session.state = 'active' and session.deadline_at is not null and session.deadline_at <= clock_timestamp()) then
    perform private.recall_finalize(p_session_id, 'time_up');
  end if;
end;
$function$;

create or replace function private.recall_view(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', session.id, 'kind', session.kind, 'scope', session.scope, 'region', session.region,
    'size', session.set_size, 'timeLimitSeconds', session.time_limit_seconds,
    'state', session.state, 'endReason', session.end_reason, 'badge', session.badge,
    'total', session.total, 'found', session.found_count,
    'createdAt', session.created_at, 'deadlineAt', session.deadline_at, 'serverNow', clock_timestamp(),
    'completedAt', session.completed_at, 'elapsedMs', session.elapsed_ms,
    'ranked', session.pool_signature is not null,
    'best', private.recall_best(session.user_id, session.pool_signature,
      case when session.state = 'completed' then session.id end),
    'salt', case when session.state = 'active' then session.salt end,
    'ambiguous', case when session.state = 'active' then to_jsonb(session.ambiguous_hashes) else '[]'::jsonb end,
    'entries', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'position', entry.position,
        'region', entry.region,
        -- Capitals rounds show the country as the clue; countries rounds hide it until found.
        'prompt', case when session.kind = 'capitals' then entry.country_name end,
        'alpha2', case when session.kind = 'capitals' or entry.found_at is not null or session.state <> 'active' then entry.alpha2 end,
        'name', case when entry.found_at is not null or session.state <> 'active' then entry.answer_name end,
        'found', entry.found_at is not null,
        'foundAt', entry.found_at,
        'matched', entry.matched_text,
        'lang', entry.matched_lang,
        'keys', case when session.state = 'active' and entry.found_at is null then entry.alias_keys end
      ) order by entry.position), '[]'::jsonb)
      from private.recall_session_entries as entry where entry.session_id = session.id
    )
  )
  from private.recall_sessions as session
  where session.id = p_session_id;
$function$;

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------
create or replace function public.arena_recall_setup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
begin
  perform private.rate('recall_setup', 60);
  perform private.recall_expire(session.id) from private.recall_sessions as session
    where session.user_id = v_uid and session.state = 'active' and session.deadline_at <= clock_timestamp();
  return jsonb_build_object(
    'catalog', (select coalesce(jsonb_agg(jsonb_build_object(
        'code', catalog.code, 'region', catalog.region, 'un', catalog.un,
        'hasCapital', jsonb_array_length(catalog.capital_names) > 0
      ) order by catalog.code), '[]'::jsonb) from private.recall_catalog() as catalog),
    'activeSessions', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', session.id, 'kind', session.kind, 'scope', session.scope, 'region', session.region,
        'size', session.set_size, 'timeLimitSeconds', session.time_limit_seconds,
        'total', session.total, 'found', session.found_count,
        'createdAt', session.created_at, 'deadlineAt', session.deadline_at
      ) order by session.created_at desc), '[]'::jsonb)
      from (select * from private.recall_sessions as active where active.user_id = v_uid and active.state = 'active'
        order by active.created_at desc limit 10) as session),
    'bests', (select coalesce(jsonb_agg(bests.best order by bests.best ->> 'kind', bests.best ->> 'region' nulls first), '[]'::jsonb) from (
        select distinct on (session.pool_signature) jsonb_build_object(
          'kind', session.kind, 'scope', session.scope, 'region', session.region,
          'timeLimitSeconds', session.time_limit_seconds, 'found', session.found_count,
          'total', session.total, 'elapsedMs', session.elapsed_ms, 'completedAt', session.completed_at) as best
        from private.recall_sessions as session
        where session.user_id = v_uid and session.state = 'completed' and session.pool_signature is not null
        order by session.pool_signature, session.found_count desc, session.elapsed_ms asc
      ) as bests),
    'recalled', jsonb_build_object(
      'countries', (select coalesce(jsonb_agg(distinct entry.country_code), '[]'::jsonb)
        from private.recall_session_entries as entry join private.recall_sessions as session on session.id = entry.session_id
        where session.user_id = v_uid and session.kind = 'countries' and entry.found_at is not null),
      'capitals', (select coalesce(jsonb_agg(distinct entry.country_code), '[]'::jsonb)
        from private.recall_session_entries as entry join private.recall_sessions as session on session.id = entry.session_id
        where session.user_id = v_uid and session.kind = 'capitals' and entry.found_at is not null))
  );
end;
$function$;

create or replace function public.arena_recall_start(
  p_kind text, p_scope text, p_region text, p_size integer, p_time_limit_seconds integer, p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_existing uuid;
  v_session_id uuid := gen_random_uuid();
  v_salt text := replace(gen_random_uuid()::text, '-', '');
  v_total integer;
  v_active integer;
begin
  if p_request_id is null or p_kind is null or p_kind not in ('countries', 'capitals')
    or p_scope is null or p_scope not in ('un', 'all')
    or (p_size is not null and p_size not in (10, 25, 50))
    or (p_time_limit_seconds is not null and p_time_limit_seconds not in (300, 600, 900, 1200)) then
    raise exception 'INVALID_RECALL_SELECTION';
  end if;
  if p_region is not null and not exists(select 1 from private.countries as country where nullif(trim(country.region), '') = p_region) then
    raise exception 'UNKNOWN_RECALL_REGION';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || p_request_id::text, 0));
  select session.id into v_existing from private.recall_sessions as session
    where session.user_id = v_uid and session.start_request_id = p_request_id;
  if found then return private.recall_view(v_existing); end if;
  perform private.rate('recall_start', 12);
  select count(*) into v_active from private.recall_sessions as session where session.user_id = v_uid and session.state = 'active';
  if v_active >= 10 then raise exception 'TOO_MANY_ACTIVE_RECALL_ROUNDS'; end if;

  create temporary table if not exists recall_pool (
    position integer, code text, alpha2 text, region text, country_name text, answer_name text, names jsonb
  ) on commit drop;
  truncate pg_temp.recall_pool;
  insert into pg_temp.recall_pool
  select row_number() over (order by
      case when p_kind = 'countries' then picked.region end nulls last,
      picked.name collate "C", picked.code collate "C")::integer,
    picked.code, picked.alpha2, picked.region, picked.name,
    case when p_kind = 'countries' then picked.name else picked.capital_display end,
    case when p_kind = 'countries' then picked.country_names else picked.capital_names end
  from (
    select catalog.* from private.recall_catalog() as catalog
    where (p_scope = 'all' or catalog.un)
      and (p_region is null or catalog.region = p_region)
      and (case when p_kind = 'countries' then jsonb_array_length(catalog.country_names) else jsonb_array_length(catalog.capital_names) end) > 0
    order by case when p_size is not null then random() end, catalog.code
    limit coalesce(p_size, 100000)
  ) as picked;
  select count(*) into v_total from pg_temp.recall_pool;
  if v_total = 0 then raise exception 'EMPTY_RECALL_POOL'; end if;
  if p_size is not null and v_total < p_size then raise exception 'RECALL_SET_TOO_SMALL'; end if;

  insert into private.recall_sessions(id, user_id, start_request_id, kind, scope, region, set_size,
    time_limit_seconds, pool_signature, salt, total, deadline_at)
  values (v_session_id, v_uid, p_request_id, p_kind, p_scope, p_region, p_size, p_time_limit_seconds,
    case when p_size is null then md5(jsonb_build_array(p_kind, p_scope, p_region, p_time_limit_seconds, 1)::text) end,
    v_salt, v_total,
    case when p_time_limit_seconds is not null then clock_timestamp() + make_interval(secs => p_time_limit_seconds) end);

  with raw as (
    select pool.position, private.recall_normalize(item.value ->> 'name') as k,
      item.value ->> 'lang' as lang, coalesce((item.value ->> 'primary')::boolean, false) as is_primary
    from pg_temp.recall_pool as pool cross join jsonb_array_elements(pool.names) as item(value)
  ), alias as (
    select raw.position, raw.k,
      (array_agg(raw.lang order by case raw.lang when 'en' then 1 when 'de' then 2 else 3 end))[1] as lang,
      bool_or(raw.is_primary) as is_primary
    from raw where raw.k <> '' group by raw.position, raw.k
  ), owners as (
    select alias.k, count(*) as owner_count, bool_or(alias.is_primary) as any_primary from alias group by alias.k
  ), kept as (
    -- A spelling shared by several entries only counts for the entries whose main name it is.
    select alias.* from alias join owners on owners.k = alias.k
    where owners.owner_count = 1 or alias.is_primary
  ), ambiguous as (
    update private.recall_sessions set ambiguous_hashes = coalesce((
      select array_agg(private.recall_hash(v_salt, owners.k) order by owners.k)
      from owners where owners.owner_count > 1 and not owners.any_primary), '{}')
    where id = v_session_id
    returning 1
  ), keyed as (
    select kept.position, kept.k, kept.lang, private.recall_hash(v_salt, kept.k) as h,
      coalesce((select array_agg(distinct other.position order by other.position) from kept as other
        where other.position <> kept.position and other.k <> kept.k and starts_with(other.k, kept.k)), '{}') as extended_by
    from kept
  )
  insert into private.recall_session_entries(session_id, position, country_code, alpha2, region, country_name,
    answer_name, alias_keys, alias_hashes, alias_langs)
  select v_session_id, pool.position, pool.code, pool.alpha2, pool.region, pool.country_name, pool.answer_name,
    jsonb_agg(jsonb_build_object('h', keyed.h, 'l', keyed.lang, 'x', to_jsonb(keyed.extended_by)) order by keyed.k),
    array_agg(keyed.h order by keyed.k), array_agg(keyed.lang order by keyed.k)
  from pg_temp.recall_pool as pool join keyed on keyed.position = pool.position
  where exists (select 1 from ambiguous)
  group by pool.position, pool.code, pool.alpha2, pool.region, pool.country_name, pool.answer_name;

  -- Every entry must still be answerable after ambiguity filtering.
  if (select count(*) from private.recall_session_entries as entry where entry.session_id = v_session_id) <> v_total then
    raise exception 'RECALL_POOL_HAS_UNANSWERABLE_ENTRY';
  end if;
  return private.recall_view(v_session_id);
end;
$function$;

create or replace function public.arena_recall_view(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
begin
  perform private.rate('recall_view', 120);
  if not exists(select 1 from private.recall_sessions as session where session.id = p_session_id and session.user_id = v_uid) then
    raise exception 'RECALL_SESSION_NOT_FOUND';
  end if;
  perform private.recall_expire(p_session_id);
  return private.recall_view(p_session_id);
end;
$function$;

create or replace function public.arena_recall_answer(p_session_id uuid, p_position integer, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_session private.recall_sessions%rowtype;
  v_entry private.recall_session_entries%rowtype;
  v_hash text;
  v_index integer;
  v_status text;
begin
  if p_position is null or p_answer is null or length(p_answer) > 120 then raise exception 'INVALID_RECALL_ANSWER'; end if;
  perform private.rate('recall_answer', 400);
  select * into v_session from private.recall_sessions as session
    where session.id = p_session_id and session.user_id = v_uid for update;
  if not found then raise exception 'RECALL_SESSION_NOT_FOUND'; end if;
  perform private.recall_expire(p_session_id);
  select * into v_session from private.recall_sessions as session where session.id = p_session_id;

  select * into v_entry from private.recall_session_entries as entry
    where entry.session_id = p_session_id and entry.position = p_position for update;
  if not found then raise exception 'RECALL_ENTRY_NOT_FOUND'; end if;

  if v_session.state <> 'active' then
    v_status := case when v_session.end_reason = 'time_up' then 'time_up' else 'not_active' end;
  elsif v_entry.found_at is not null then
    v_status := 'already_found';
  else
    v_hash := private.recall_hash(v_session.salt, private.recall_normalize(p_answer));
    v_index := array_position(v_entry.alias_hashes, v_hash);
    if v_index is null then
      v_status := 'no_match';
    else
      v_status := 'found';
      update private.recall_session_entries set found_at = clock_timestamp(),
        matched_text = left(trim(regexp_replace(p_answer, '[[:space:]]+', ' ', 'g')), 120),
        matched_lang = v_entry.alias_langs[v_index]
      where session_id = p_session_id and position = p_position
      returning * into v_entry;
      update private.recall_sessions set found_count = found_count + 1 where id = p_session_id
      returning * into v_session;
      if v_session.found_count = v_session.total then
        perform private.recall_finalize(p_session_id, 'all_found');
        select * into v_session from private.recall_sessions as session where session.id = p_session_id;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'status', v_status, 'position', v_entry.position,
    'name', case when v_entry.found_at is not null then v_entry.answer_name end,
    'alpha2', case when v_entry.found_at is not null then v_entry.alpha2 end,
    'matched', v_entry.matched_text, 'lang', v_entry.matched_lang, 'foundAt', v_entry.found_at,
    'found', v_session.found_count, 'total', v_session.total, 'state', v_session.state, 'endReason', v_session.end_reason
  );
end;
$function$;

create or replace function public.arena_recall_finish(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
  v_deadline timestamptz;
begin
  perform private.rate('recall_finish', 30);
  select session.deadline_at into v_deadline from private.recall_sessions as session
    where session.id = p_session_id and session.user_id = v_uid for update;
  if not found then raise exception 'RECALL_SESSION_NOT_FOUND'; end if;
  perform private.recall_finalize(p_session_id,
    case when v_deadline is not null and v_deadline <= clock_timestamp() then 'time_up' else 'gave_up' end);
  return private.recall_view(p_session_id);
end;
$function$;

create or replace function public.arena_recall_abandon(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := private.require_user();
begin
  perform private.rate('recall_abandon', 30);
  update private.recall_sessions set state = 'abandoned'
    where id = p_session_id and user_id = v_uid and state = 'active';
end;
$function$;

revoke all on function private.recall_normalize(text), private.recall_hash(text, text), private.recall_catalog(),
  private.recall_best(uuid, text, uuid), private.recall_finalize(uuid, text), private.recall_expire(uuid),
  private.recall_view(uuid) from public, anon, authenticated;
revoke all on function public.arena_recall_setup(), public.arena_recall_start(text, text, text, integer, integer, uuid),
  public.arena_recall_view(uuid), public.arena_recall_answer(uuid, integer, text),
  public.arena_recall_finish(uuid), public.arena_recall_abandon(uuid) from public, anon, authenticated;
grant execute on function public.arena_recall_setup(), public.arena_recall_start(text, text, text, integer, integer, uuid),
  public.arena_recall_view(uuid), public.arena_recall_answer(uuid, integer, text),
  public.arena_recall_finish(uuid), public.arena_recall_abandon(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
