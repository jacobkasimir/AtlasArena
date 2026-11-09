-- REST Countries v5 stores approved SVG assets below /v5/svg/{code}.svg.
-- Keep the existing host and SVG restrictions while allowing path segments.
create or replace function private.flags_has_asset(p_svg text, p_png text, p_emoji text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    p_svg ~* '^https://([a-z0-9-]+[.])*flags[.]restcountries[.]com/[^?#]+[.]svg([?#].*)?$',
    false
  );
$function$;

revoke all on function private.flags_has_asset(text, text, text) from public, anon, authenticated;
