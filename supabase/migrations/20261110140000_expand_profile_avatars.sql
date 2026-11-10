-- Keep the original avatar indices and allow the complete frontend avatar set.
-- The current picker has 259 entries, with zero-based stored indices.
alter table public.profiles
  drop constraint if exists profiles_avatar_check;

alter table public.profiles
  add constraint profiles_avatar_check check (avatar between 0 and 258);

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
    or p_avatar not between 0 and 258
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
