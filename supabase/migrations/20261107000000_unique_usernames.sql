-- Enforce one case-insensitive username namespace without changing profile IDs
-- or deleting any game/profile data. Legacy duplicate Traveler names are
-- deterministically renamed once; players can subsequently choose a new name.
create or replace function private.normalize_profile_username()
returns trigger language plpgsql set search_path = '' as $function$
begin
  new.username := btrim(new.username);
  return new;
end;
$function$;

-- Keep onboarding state separate from the displayed name. Existing profiles
-- are considered confirmed; only migration-generated and newly provisioned
-- names start unconfirmed.
alter table public.profiles
  add column if not exists username_confirmed boolean not null default true;

do $migration$
declare r record;
  v_candidate text;
  v_suffix integer;
begin
  for r in
    select id from (
      select id, row_number() over (partition by lower(btrim(username)) order by id) as ordinal
      from public.profiles
    ) duplicates
    where ordinal > 1
  loop
    v_candidate := 'Player-' || left(replace(r.id::text, '-', ''), 8);
    v_suffix := 0;
    while exists (
      select 1 from public.profiles p
      where p.id <> r.id and lower(btrim(p.username)) = lower(v_candidate)
    ) loop
      v_suffix := v_suffix + 1;
      v_candidate := 'P-' || left(replace(r.id::text, '-', ''), 17) || '-' || v_suffix::text;
      if length(v_candidate) > 24 then
        raise exception 'Could not allocate a legacy username for profile %', r.id;
      end if;
    end loop;
    update public.profiles
      set username = v_candidate,
          username_confirmed = false
      where id = r.id;
  end loop;
end;
$migration$;

drop trigger if exists profiles_normalize_username on public.profiles;
create trigger profiles_normalize_username
before insert or update of username on public.profiles
for each row execute function private.normalize_profile_username();

create or replace function private.confirm_profile_username()
returns trigger language plpgsql set search_path = '' as $function$
begin
  new.username_confirmed := true;
  return new;
end;
$function$;

drop trigger if exists profiles_confirm_username on public.profiles;
create trigger profiles_confirm_username
before update of username on public.profiles
for each row execute function private.confirm_profile_username();

-- Earlier app versions accepted surrounding spaces; normalize all surviving
-- names after collisions have been assigned deterministic temporary labels.
update public.profiles set username = btrim(username);

alter table public.profiles drop constraint if exists profiles_username_check;
alter table public.profiles add constraint profiles_username_check
  check (username = btrim(username) and username ~ '^[A-Za-z0-9 _-]{2,24}$');
create unique index if not exists profiles_username_casefold_unique
  on public.profiles (lower(username));

-- New auth identities receive a unique, intentionally temporary label from
-- private.require_user; onboarding must replace it before private app use.
create or replace function private.require_user()
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_suffix integer := 0;
begin
  if v_uid is null or not exists(select 1 from auth.users u where u.id=v_uid) then
    raise exception 'AUTH_REQUIRED';
  end if;
  v_name := 'P-' || left(replace(v_uid::text,'-',''),17);
  while exists (
    select 1 from public.profiles p
    where lower(p.username) = lower(v_name) and p.id <> v_uid
  ) loop
    v_suffix := v_suffix + 1;
    v_name := 'P-' || left(replace(v_uid::text,'-',''), 15) || '-' || v_suffix::text;
    if length(v_name) > 24 then
      raise exception 'Could not allocate a temporary username for profile %', v_uid;
    end if;
  end loop;
  insert into public.profiles(id, username, username_confirmed)
    values(v_uid, v_name, false)
    on conflict(id) do nothing;
  perform 1 from public.profiles p where p.id=v_uid for update;
  return v_uid;
end;
$function$;

comment on index public.profiles_username_casefold_unique is
  'Case-insensitive uniqueness for all guest and permanent profiles.';

create or replace function public.arena_username_confirmed()
returns boolean language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := private.require_user();
  v_confirmed boolean;
begin
  select p.username_confirmed into v_confirmed
  from public.profiles p where p.id = v_uid;
  return coalesce(v_confirmed, false);
end;
$function$;
revoke all on function public.arena_username_confirmed() from public, anon, authenticated;
grant execute on function public.arena_username_confirmed() to authenticated;

notify pgrst, 'reload schema';
