begin;

alter table private.countries
  add column if not exists catalog_kind text
    not null default 'iso_alpha2';

alter table private.countries
  add constraint countries_catalog_kind_valid
  check (catalog_kind in ('iso_alpha2', 'non_iso'));

alter table private.countries
  add constraint countries_non_iso_internal_id
  check (
    catalog_kind <> 'non_iso'
    or code like 'entity:%'
  );

commit;