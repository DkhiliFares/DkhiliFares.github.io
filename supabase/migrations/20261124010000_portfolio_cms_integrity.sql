-- Validate existing bucket settings without silently changing bucket visibility or limits.
create or replace function public.assert_portfolio_media_bucket_configuration()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_is_public boolean;
  v_file_size_limit bigint;
  v_allowed_mime_types text[];
  v_expected_mime_types text[] := array['image/png','image/jpeg','image/webp'];
begin
  select public, file_size_limit, allowed_mime_types
    into v_is_public, v_file_size_limit, v_allowed_mime_types
    from storage.buckets
    where id = 'portfolio-media-private';
  if not found
    or v_is_public is distinct from false
    or v_file_size_limit is distinct from 10485760
    or cardinality(v_allowed_mime_types) is distinct from cardinality(v_expected_mime_types)
    or not (v_allowed_mime_types @> v_expected_mime_types and v_expected_mime_types @> v_allowed_mime_types) then
    raise exception using
      errcode = '23514',
      message = 'Unsafe configuration for portfolio-media-private',
      hint = 'Inspect existing bucket objects, policies, visibility, size limit, and MIME types; reconcile manually before retrying.';
  end if;

  select public, file_size_limit, allowed_mime_types
    into v_is_public, v_file_size_limit, v_allowed_mime_types
    from storage.buckets
    where id = 'portfolio-media-public';
  if not found
    or v_is_public is distinct from true
    or v_file_size_limit is distinct from 10485760
    or cardinality(v_allowed_mime_types) is distinct from cardinality(v_expected_mime_types)
    or not (v_allowed_mime_types @> v_expected_mime_types and v_expected_mime_types @> v_allowed_mime_types) then
    raise exception using
      errcode = '23514',
      message = 'Unsafe configuration for portfolio-media-public',
      hint = 'Inspect existing bucket objects, policies, visibility, size limit, and MIME types; reconcile manually before retrying.';
  end if;
end;
$$;

revoke all on function public.assert_portfolio_media_bucket_configuration() from public, anon, authenticated, service_role;
select public.assert_portfolio_media_bucket_configuration();

-- A version pointer must identify a version owned by the same CMS record.
do $$
begin
  if exists (
    select 1
      from public.cms_records records
      left join public.cms_record_versions versions
        on versions.id = records.draft_version_id
       and versions.record_id = records.id
      where records.draft_version_id is not null
        and versions.id is null
  ) or exists (
    select 1
      from public.cms_records records
      left join public.cms_record_versions versions
        on versions.id = records.published_version_id
       and versions.record_id = records.id
      where records.published_version_id is not null
        and versions.id is null
  ) then
    raise exception 'Cross-record CMS version pointers exist; inspect and repair them before applying this migration.';
  end if;
end;
$$;

create unique index if not exists cms_record_versions_record_id_id_uidx
  on public.cms_record_versions (record_id, id);

alter table public.cms_records
  drop constraint if exists cms_records_draft_version_fk;
alter table public.cms_records
  drop constraint if exists cms_records_published_version_fk;

do $$
begin
  if not exists (
    select 1 from pg_constraint
      where conrelid = 'public.cms_records'::regclass
        and conname = 'cms_records_draft_version_same_record_fk'
  ) then
    alter table public.cms_records
      add constraint cms_records_draft_version_same_record_fk
      foreign key (id, draft_version_id)
      references public.cms_record_versions (record_id, id)
      deferrable initially deferred;
  end if;

  if not exists (
    select 1 from pg_constraint
      where conrelid = 'public.cms_records'::regclass
        and conname = 'cms_records_published_version_same_record_fk'
  ) then
    alter table public.cms_records
      add constraint cms_records_published_version_same_record_fk
      foreign key (id, published_version_id)
      references public.cms_record_versions (record_id, id)
      deferrable initially deferred;
  end if;
end;
$$;

-- Keep history append-only for application roles, including the service role.
revoke update, delete, truncate
  on public.cms_record_versions, public.cms_audit_events
  from public, anon, authenticated, service_role;

drop trigger if exists cms_record_versions_no_truncate on public.cms_record_versions;
create trigger cms_record_versions_no_truncate
  before truncate on public.cms_record_versions
  for each statement execute function public.prevent_cms_history_mutation();

drop trigger if exists cms_audit_events_no_truncate on public.cms_audit_events;
create trigger cms_audit_events_no_truncate
  before truncate on public.cms_audit_events
  for each statement execute function public.prevent_cms_history_mutation();

-- Alert slots are operational deduplication records, not message/audit content.
create index if not exists portfolio_alert_slots_created_at_idx
  on public.portfolio_alert_slots (created_at);

create or replace function public.prune_portfolio_alert_slots()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.portfolio_alert_slots
    where created_at < now() - interval '90 days';
  return new;
end;
$$;

revoke all on function public.prune_portfolio_alert_slots() from public, anon, authenticated, service_role;
drop trigger if exists portfolio_alert_slots_prune_old on public.portfolio_alert_slots;
create trigger portfolio_alert_slots_prune_old
  before insert on public.portfolio_alert_slots
  for each row execute function public.prune_portfolio_alert_slots();

revoke update, delete, truncate
  on public.portfolio_alert_slots
  from public, anon, authenticated, service_role;

comment on table public.portfolio_alert_slots is
  'Email-alert deduplication slots; entries older than 90 days are lazily pruned on the next insert.';
