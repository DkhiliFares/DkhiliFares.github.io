-- Additive CMS operations for private drafts, immutable history, media, and publication attempts.
alter table public.cms_audit_events
  add column if not exists entity_type text not null default 'record',
  add column if not exists entity_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.cms_media_assets (
  id uuid primary key default gen_random_uuid(),
  object_path text not null unique,
  published_object_path text unique,
  original_name text not null,
  content_type text not null check (content_type in ('image/png','image/jpeg','image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  upload_state text not null default 'pending' check (upload_state in ('pending','ready')),
  alt_text text not null default '',
  caption text not null default '',
  record_id uuid references public.cms_records(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null
);
create index if not exists cms_media_assets_created_at_idx on public.cms_media_assets (created_at desc);
create index if not exists cms_media_assets_record_id_idx on public.cms_media_assets (record_id);
alter table public.cms_media_assets enable row level security;
revoke all on public.cms_media_assets from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('portfolio-media-private', 'portfolio-media-private', false, 10485760, array['image/png','image/jpeg','image/webp']),
  ('portfolio-media-public', 'portfolio-media-public', true, 10485760, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create or replace function public.cms_save_draft(
  p_actor uuid,
  p_record_type text,
  p_record_key text,
  p_expected_version_id uuid,
  p_public_payload jsonb,
  p_editorial_metadata jsonb,
  p_change_summary text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_record_id uuid;
  v_version_id uuid;
  v_current_version_id uuid;
  v_version_number integer;
  v_state text;
begin
  if p_actor is null
    or p_record_type is null
    or p_record_type not in ('project','skill','experience','education','credential','achievement','article','profile','category')
    or p_record_key is null
    or p_record_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or length(p_record_key) > 100
    or p_public_payload is null
    or jsonb_typeof(p_public_payload) <> 'object'
    or p_editorial_metadata is null
    or jsonb_typeof(p_editorial_metadata) <> 'object'
    or length(coalesce(p_change_summary,'')) > 500 then
    raise exception 'Invalid draft arguments';
  end if;
  if p_record_type in ('project','skill') and not exists (
    select 1
      from public.cms_records
      where record_type = 'category'
        and record_key = p_public_payload->>'category'
        and published_version_id is not null
  ) then
    raise exception 'Content references an unpublished category';
  end if;
  if p_record_type = 'skill'
    and (p_public_payload ? 'projects' and jsonb_typeof(p_public_payload->'projects') is distinct from 'array'
      or p_public_payload ? 'experience' and jsonb_typeof(p_public_payload->'experience') is distinct from 'array') then
    raise exception 'Skill references must be arrays';
  end if;
  if p_record_type = 'skill' and (
    exists (
      select 1
        from jsonb_array_elements_text(coalesce(p_public_payload->'projects', '[]'::jsonb)) as ref(record_key)
        where not exists (
          select 1 from public.cms_records
          where record_type = 'project' and record_key = ref.record_key and published_version_id is not null
        )
    )
    or exists (
      select 1
        from jsonb_array_elements_text(coalesce(p_public_payload->'experience', '[]'::jsonb)) as ref(record_key)
        where not exists (
          select 1 from public.cms_records
          where record_type = 'experience' and record_key = ref.record_key and published_version_id is not null
        )
    )
  ) then
    raise exception 'Skill references unpublished content';
  end if;

  insert into public.cms_records (record_type, record_key, publication_state, created_by, updated_by)
  values (p_record_type, p_record_key, 'draft', p_actor, p_actor)
  on conflict (record_type, record_key) do update
    set updated_at = now(), updated_by = excluded.updated_by
  returning id, publication_state into v_record_id, v_state;

  select draft_version_id into v_current_version_id
    from public.cms_records where id = v_record_id for update;
  if v_current_version_id is distinct from p_expected_version_id then
    raise exception using errcode = '40001', message = 'CMS record changed';
  end if;

  select coalesce(max(version_number), 0) + 1
    into v_version_number
    from public.cms_record_versions
    where record_id = v_record_id;

  insert into public.cms_record_versions (
    record_id, version_number, public_payload, editorial_metadata, change_summary, created_by
  ) values (
    v_record_id, v_version_number, p_public_payload, p_editorial_metadata,
    coalesce(p_change_summary, ''), p_actor
  ) returning id into v_version_id;

  update public.cms_records
    set draft_version_id = v_version_id,
        publication_state = case when v_state = 'archived' then 'archived' else 'draft' end,
        updated_at = now(), updated_by = p_actor
    where id = v_record_id;
  select publication_state into v_state from public.cms_records where id = v_record_id;

  insert into public.cms_audit_events (
    actor_user_id, record_id, action, version_id, outcome, entity_type, entity_id, metadata
  ) values (
    p_actor, v_record_id, 'draft_saved', v_version_id, 'success', 'record', v_record_id,
    jsonb_build_object('record_type', p_record_type, 'version_number', v_version_number)
  );

  return jsonb_build_object(
    'id', v_record_id, 'versionId', v_version_id, 'versionNumber', v_version_number,
    'publicationState', v_state
  );
end;
$$;

create or replace function public.cms_seed_public_baseline(p_actor uuid, p_records jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_item jsonb;
  v_record_id uuid;
  v_version_id uuid;
  v_record_type text;
  v_record_key text;
  v_inserted integer := 0;
  v_skipped integer := 0;
begin
  if p_actor is null or p_records is null or jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 250 then
    raise exception 'Invalid public baseline';
  end if;
  for v_item in select value from jsonb_array_elements(p_records)
  loop
    v_record_type := v_item->>'recordType';
    v_record_key := v_item->>'recordKey';
    if jsonb_typeof(v_item) <> 'object'
      or v_record_type is null
      or v_record_type not in ('project','skill','experience','education','credential','achievement','article','profile','category')
      or v_record_key is null
      or v_record_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      or v_item->'publicPayload' is null
      or jsonb_typeof(v_item->'publicPayload') <> 'object' then
      raise exception 'Invalid public baseline record';
    end if;
    if v_record_type in ('project','article')
      and v_item->'publicPayload'->>'visibility' is distinct from 'published' then
      raise exception 'Only published public content can be imported';
    end if;
    v_record_id := null;
    v_version_id := null;
    insert into public.cms_records (record_type, record_key, publication_state, created_by, updated_by)
      values (v_record_type, v_record_key, 'published', p_actor, p_actor)
      on conflict (record_type, record_key) do nothing
      returning id into v_record_id;
    if v_record_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.cms_record_versions (
      record_id, version_number, public_payload, editorial_metadata, change_summary, created_by
    ) values (
      v_record_id, 1, v_item->'publicPayload', '{}'::jsonb,
      'Initial snapshot of content already public on the static portfolio.', p_actor
    ) returning id into v_version_id;
    update public.cms_records
      set draft_version_id = v_version_id, published_version_id = v_version_id,
          updated_at = now(), updated_by = p_actor
      where id = v_record_id;
    insert into public.cms_audit_events (
      actor_user_id, record_id, action, version_id, outcome, entity_type, entity_id,
      metadata
    ) values (
      p_actor, v_record_id, 'public_baseline_imported', v_version_id, 'success',
      'record', v_record_id, jsonb_build_object('record_type', v_record_type)
    );
    v_inserted := v_inserted + 1;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
end;
$$;

create or replace function public.cms_archive_record(p_actor uuid, p_record_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_record public.cms_records%rowtype;
begin
  update public.cms_records
    set publication_state = 'archived', updated_at = now(), updated_by = p_actor
    where id = p_record_id
    returning * into v_record;
  if not found then raise exception 'Record not found'; end if;

  insert into public.cms_audit_events (
    actor_user_id, record_id, action, outcome, entity_type, entity_id
  ) values (p_actor, p_record_id, 'record_archived', 'success', 'record', p_record_id);
  return jsonb_build_object('id', v_record.id, 'publicationState', v_record.publication_state);
end;
$$;

create or replace function public.cms_restore_version(
  p_actor uuid,
  p_record_id uuid,
  p_version_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_source public.cms_record_versions%rowtype;
  v_version_id uuid;
  v_version_number integer;
begin
  perform 1 from public.cms_records where id = p_record_id for update;
  if not found then raise exception 'Record not found'; end if;
  select * into v_source
    from public.cms_record_versions
    where id = p_version_id and record_id = p_record_id;
  if not found then raise exception 'Version not found'; end if;

  select coalesce(max(version_number), 0) + 1
    into v_version_number
    from public.cms_record_versions
    where record_id = p_record_id;
  insert into public.cms_record_versions (
    record_id, version_number, public_payload, editorial_metadata, change_summary, created_by
  ) values (
    p_record_id, v_version_number, v_source.public_payload, v_source.editorial_metadata,
    format('Restored from version %s', v_source.version_number), p_actor
  ) returning id into v_version_id;

  update public.cms_records
    set draft_version_id = v_version_id, publication_state = 'draft',
        updated_at = now(), updated_by = p_actor
    where id = p_record_id;
  insert into public.cms_audit_events (
    actor_user_id, record_id, action, version_id, outcome, entity_type, entity_id, metadata
  ) values (
    p_actor, p_record_id, 'version_restored', v_version_id, 'success', 'record', p_record_id,
    jsonb_build_object('restored_from_version_id', p_version_id, 'version_number', v_version_number)
  );
  return jsonb_build_object('id', p_record_id, 'versionId', v_version_id, 'versionNumber', v_version_number);
end;
$$;

create or replace function public.cms_request_publication(
  p_actor uuid,
  p_record_id uuid,
  p_version_id uuid,
  p_idempotency_key text,
  p_failure_code text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_publication_id uuid;
  v_inserted boolean;
  v_status text;
  v_record_id uuid;
  v_version_id uuid;
  v_failure_code text;
begin
  if p_failure_code not in ('GITHUB_APP_NOT_CONFIGURED','PUBLISHER_NOT_IMPLEMENTED')
    or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Invalid publication arguments';
  end if;
  if not exists (
    select 1 from public.cms_records
    where id = p_record_id and draft_version_id = p_version_id and publication_state = 'draft'
  ) then raise exception 'Only the current draft version can be requested'; end if;

  insert into public.cms_publications (
    record_id, record_version_id, status, failure_code, idempotency_key, created_by
  ) values (
    p_record_id, p_version_id, 'failed', p_failure_code, p_idempotency_key, p_actor
  ) on conflict (idempotency_key) do nothing
  returning id into v_publication_id;
  v_inserted := found;
  if v_publication_id is null then
    select id, record_id, record_version_id, status, failure_code
      into v_publication_id, v_record_id, v_version_id, v_status, v_failure_code
      from public.cms_publications where idempotency_key = p_idempotency_key;
    if v_record_id is distinct from p_record_id or v_version_id is distinct from p_version_id then
      raise exception 'Idempotency key belongs to a different publication';
    end if;
  else
    v_record_id := p_record_id;
    v_version_id := p_version_id;
    v_status := 'failed';
    v_failure_code := p_failure_code;
    insert into public.cms_audit_events (
      actor_user_id, record_id, publication_id, action, version_id, outcome, entity_type, entity_id, metadata
    ) values (
      p_actor, p_record_id, v_publication_id, 'publication_requested', p_version_id,
      'failure', 'record', p_record_id,
      jsonb_build_object('failure_code', p_failure_code, 'attempt_recorded', true)
    );
  end if;
  return jsonb_build_object(
    'id', v_publication_id, 'status', v_status, 'failureCode', v_failure_code, 'created', v_inserted
  );
end;
$$;

create or replace function public.cms_cancel_publication(p_actor uuid, p_publication_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_record_id uuid;
  v_version_id uuid;
begin
  update public.cms_publications
    set status = 'cancelled', updated_at = now()
    where id = p_publication_id and status in ('prepared','checks_pending','ready_to_merge')
    returning record_id, record_version_id into v_record_id, v_version_id;
  if not found then return jsonb_build_object('cancelled', false); end if;
  insert into public.cms_audit_events (
    actor_user_id, record_id, publication_id, action, version_id, outcome, entity_type, entity_id
  ) values (
    p_actor, v_record_id, p_publication_id, 'publication_cancelled', v_version_id,
    'success', 'publication', p_publication_id
  );
  return jsonb_build_object('cancelled', true, 'id', p_publication_id);
end;
$$;

create or replace function public.cms_register_media_asset(
  p_actor uuid,
  p_object_path text,
  p_original_name text,
  p_content_type text,
  p_size_bytes bigint
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_asset public.cms_media_assets%rowtype;
begin
  if p_object_path !~ '^pending/[0-9a-f-]+\.(png|jpg|webp)$'
    or p_content_type not in ('image/png','image/jpeg','image/webp')
    or p_size_bytes < 1 or p_size_bytes > 10485760
    or length(p_original_name) < 1 or length(p_original_name) > 120 then
    raise exception 'Invalid media arguments';
  end if;
  insert into public.cms_media_assets (
    object_path, original_name, content_type, size_bytes, created_by
  ) values (
    p_object_path, p_original_name, p_content_type, p_size_bytes, p_actor
  ) returning * into v_asset;
  insert into public.cms_audit_events (
    actor_user_id, action, outcome, entity_type, entity_id, metadata
  ) values (
    p_actor, 'media_upload_requested', 'success', 'media', v_asset.id,
    jsonb_build_object('content_type', p_content_type, 'size_bytes', p_size_bytes)
  );
  return jsonb_build_object('id', v_asset.id, 'objectPath', v_asset.object_path, 'uploadState', v_asset.upload_state);
end;
$$;

create or replace function public.cms_complete_media_asset(p_actor uuid, p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_asset public.cms_media_assets%rowtype;
begin
  update public.cms_media_assets
    set upload_state = 'ready', updated_at = now()
    where id = p_asset_id and upload_state = 'pending'
    returning * into v_asset;
  if not found then
    select * into v_asset from public.cms_media_assets where id = p_asset_id and upload_state = 'ready';
    if not found then raise exception 'Media asset not found'; end if;
    return jsonb_build_object('id', v_asset.id, 'uploadState', v_asset.upload_state);
  end if;
  insert into public.cms_audit_events (
    actor_user_id, action, outcome, entity_type, entity_id
  ) values (p_actor, 'media_upload_completed', 'success', 'media', p_asset_id);
  return jsonb_build_object('id', v_asset.id, 'uploadState', v_asset.upload_state);
end;
$$;

create or replace function public.cms_update_media_metadata(
  p_actor uuid,
  p_asset_id uuid,
  p_alt_text text,
  p_caption text,
  p_record_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_asset public.cms_media_assets%rowtype;
begin
  if length(coalesce(p_alt_text,'')) > 300 or length(coalesce(p_caption,'')) > 1000 then
    raise exception 'Invalid media metadata';
  end if;
  update public.cms_media_assets
    set alt_text = coalesce(p_alt_text,''), caption = coalesce(p_caption,''),
        record_id = p_record_id, updated_at = now()
    where id = p_asset_id and upload_state = 'ready'
    returning * into v_asset;
  if not found then raise exception 'Media asset not found'; end if;
  insert into public.cms_audit_events (
    actor_user_id, record_id, action, outcome, entity_type, entity_id
  ) values (p_actor, v_asset.record_id, 'media_metadata_updated', 'success', 'media', p_asset_id);
  return jsonb_build_object('id', v_asset.id, 'recordId', v_asset.record_id);
end;
$$;

create or replace function public.cms_publish_media_asset(
  p_actor uuid,
  p_asset_id uuid,
  p_published_object_path text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_asset public.cms_media_assets%rowtype;
begin
  if p_published_object_path !~ '^approved/[0-9a-f-]+\.(png|jpg|webp)$' then
    raise exception 'Invalid public media path';
  end if;
  update public.cms_media_assets
    set published_object_path = p_published_object_path, updated_at = now()
    where id = p_asset_id and upload_state = 'ready' and published_object_path is null
      and length(btrim(alt_text)) > 0 and length(btrim(caption)) > 0
    returning * into v_asset;
  if not found then raise exception 'Media asset is unavailable or already approved'; end if;
  insert into public.cms_audit_events (
    actor_user_id, record_id, action, outcome, entity_type, entity_id, metadata
  ) values (
    p_actor, v_asset.record_id, 'media_approved_public', 'success', 'media', p_asset_id,
    jsonb_build_object('content_type', v_asset.content_type, 'size_bytes', v_asset.size_bytes)
  );
  return jsonb_build_object('id', v_asset.id, 'publishedObjectPath', v_asset.published_object_path);
end;
$$;

create or replace function public.cms_delete_media_asset(p_actor uuid, p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_asset public.cms_media_assets%rowtype;
begin
  delete from public.cms_media_assets
    where id = p_asset_id and published_object_path is null
    returning * into v_asset;
  if not found then raise exception 'Only unapproved media can be removed'; end if;
  insert into public.cms_audit_events (
    actor_user_id, action, outcome, entity_type, entity_id
  ) values (p_actor, 'media_removed', 'success', 'media', p_asset_id);
  return jsonb_build_object('id', p_asset_id, 'removed', true);
end;
$$;

create or replace function public.cms_log_operation_failure(
  p_actor uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_record_id uuid,
  p_publication_id uuid,
  p_version_id uuid,
  p_code text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_action not in (
    'public_baseline_imported','draft_saved','record_archived','version_restored','publication_requested',
    'publication_cancelled','media_upload_requested','media_upload_completed',
    'media_metadata_updated','media_approved_public','media_removed'
  ) then raise exception 'Invalid audit action'; end if;
  insert into public.cms_audit_events (
    actor_user_id, record_id, publication_id, action, version_id, outcome,
    entity_type, entity_id, metadata
  ) values (
    p_actor, p_record_id, p_publication_id, p_action, p_version_id, 'failure',
    p_entity_type, p_entity_id, jsonb_build_object('code', p_code)
  );
end;
$$;

create or replace function public.prevent_cms_history_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'CMS history is immutable';
end;
$$;
drop trigger if exists cms_record_versions_immutable on public.cms_record_versions;
create trigger cms_record_versions_immutable
  before update or delete on public.cms_record_versions
  for each row execute function public.prevent_cms_history_mutation();
drop trigger if exists cms_audit_events_immutable on public.cms_audit_events;
create trigger cms_audit_events_immutable
  before update or delete on public.cms_audit_events
  for each row execute function public.prevent_cms_history_mutation();

revoke all on function public.cms_save_draft(uuid,text,text,uuid,jsonb,jsonb,text) from public, anon, authenticated;
revoke all on function public.cms_seed_public_baseline(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.cms_archive_record(uuid,uuid) from public, anon, authenticated;
revoke all on function public.cms_restore_version(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.cms_request_publication(uuid,uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.cms_cancel_publication(uuid,uuid) from public, anon, authenticated;
revoke all on function public.cms_register_media_asset(uuid,text,text,text,bigint) from public, anon, authenticated;
revoke all on function public.cms_complete_media_asset(uuid,uuid) from public, anon, authenticated;
revoke all on function public.cms_update_media_metadata(uuid,uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.cms_publish_media_asset(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.cms_delete_media_asset(uuid,uuid) from public, anon, authenticated;
revoke all on function public.cms_log_operation_failure(uuid,text,text,uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.prevent_cms_history_mutation() from public, anon, authenticated;

grant execute on function public.cms_save_draft(uuid,text,text,uuid,jsonb,jsonb,text) to service_role;
grant execute on function public.cms_seed_public_baseline(uuid,jsonb) to service_role;
grant execute on function public.cms_archive_record(uuid,uuid) to service_role;
grant execute on function public.cms_restore_version(uuid,uuid,uuid) to service_role;
grant execute on function public.cms_request_publication(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.cms_cancel_publication(uuid,uuid) to service_role;
grant execute on function public.cms_register_media_asset(uuid,text,text,text,bigint) to service_role;
grant execute on function public.cms_complete_media_asset(uuid,uuid) to service_role;
grant execute on function public.cms_update_media_metadata(uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.cms_publish_media_asset(uuid,uuid,text) to service_role;
grant execute on function public.cms_delete_media_asset(uuid,uuid) to service_role;
grant execute on function public.cms_log_operation_failure(uuid,text,text,uuid,uuid,uuid,uuid,text) to service_role;
