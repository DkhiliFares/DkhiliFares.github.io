alter table public.cms_records
  add column if not exists collection_order integer;

with ranked as (
  select id, row_number() over (
    partition by record_type
    order by created_at, record_key, id
  ) - 1 as position
  from public.cms_records
)
update public.cms_records records
  set collection_order = ranked.position::integer
  from ranked
  where records.id = ranked.id
    and records.collection_order is null;

alter table public.cms_records
  alter column collection_order set not null;

alter table public.cms_records
  add constraint cms_records_type_order_key
  unique (record_type, collection_order)
  deferrable initially deferred;

create or replace function public.cms_assign_collection_order()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.collection_order is null then
    perform pg_advisory_xact_lock(hashtextextended('cms-record-order:' || new.record_type, 0));
    select coalesce(max(collection_order) + 1, 0)
      into new.collection_order
      from public.cms_records
      where record_type = new.record_type;
  end if;
  return new;
end;
$$;

drop trigger if exists cms_records_assign_collection_order on public.cms_records;
create trigger cms_records_assign_collection_order
  before insert on public.cms_records
  for each row execute function public.cms_assign_collection_order();

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
  v_record_count integer;
begin
  if p_actor is null or p_records is null or jsonb_typeof(p_records) <> 'array'
    or jsonb_array_length(p_records) > 250 then
    raise exception 'Invalid public baseline';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_records) as item(value)
      group by value->>'recordType', value->>'recordKey'
      having count(*) > 1
  ) then
    raise exception 'Duplicate public baseline record';
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
      or jsonb_typeof(v_item->'collectionOrder') is distinct from 'number'
      or coalesce(v_item->>'collectionOrder', '') !~ '^(0|[1-9][0-9]{0,2})$'
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

  if exists (
    select 1
      from jsonb_array_elements(p_records) as item(value)
      group by value->>'recordType'
      having count(*) <> count(distinct (value->>'collectionOrder')::integer)
        or min((value->>'collectionOrder')::integer) <> 0
        or max((value->>'collectionOrder')::integer) <> count(*) - 1
  ) then
    raise exception 'Public baseline collection order must be contiguous from zero';
  end if;

  for v_record_type in
    select distinct value->>'recordType'
      from jsonb_array_elements(p_records)
      where value->>'recordType' in ('project','skill','experience','education','credential','achievement','article','profile','category')
  loop
    perform pg_advisory_xact_lock(hashtextextended('cms-record-order:' || v_record_type, 0));

    with baseline as (
      select value->>'recordKey' as record_key,
        (value->>'collectionOrder')::integer as position
        from jsonb_array_elements(p_records) as item(value)
        where value->>'recordType' = v_record_type
    )
    update public.cms_records records
      set collection_order = baseline.position::integer
      from baseline
      where records.record_type = v_record_type and records.record_key = baseline.record_key;

    select count(*) into v_record_count from jsonb_array_elements(p_records) item(value)
      where value->>'recordType' = v_record_type;
    with remaining as (
      select id, v_record_count + row_number() over (
        order by collection_order, record_key, id
      ) - 1 as position
        from public.cms_records
        where record_type = v_record_type
          and not exists (
            select 1 from jsonb_array_elements(p_records) item(value)
              where value->>'recordType' = v_record_type
                and value->>'recordKey' = cms_records.record_key
          )
    )
    update public.cms_records records
      set collection_order = remaining.position::integer
      from remaining
      where records.id = remaining.id;

    insert into public.cms_audit_events (
      actor_user_id, action, outcome, entity_type, metadata
    ) values (
      p_actor, 'public_baseline_order_synchronized', 'success', 'record_collection',
      jsonb_build_object('record_type', v_record_type, 'record_count', v_record_count)
    );
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
end;
$$;

create or replace function public.cms_reorder_records(
  p_actor uuid,
  p_record_type text,
  p_record_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actual_count integer;
  v_requested_count integer;
begin
  if p_actor is null
    or p_record_type is null
    or p_record_type not in ('project','skill','experience','education','credential','achievement','article','profile','category')
    or p_record_ids is null
    or cardinality(p_record_ids) > 500 then
    raise exception 'Invalid record ordering';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cms-record-order:' || p_record_type, 0));

  select count(*) into v_actual_count
    from public.cms_records where record_type = p_record_type;
  select count(distinct record_id) into v_requested_count
    from unnest(p_record_ids) as requested(record_id);
  if v_requested_count <> cardinality(p_record_ids)
    or v_actual_count <> cardinality(p_record_ids)
    or exists (
      select 1
        from unnest(p_record_ids) as requested(record_id)
        where not exists (
          select 1 from public.cms_records records
            where records.id = requested.record_id
              and records.record_type = p_record_type
        )
    ) then
    raise exception 'Ordering must include every record of the selected type exactly once';
  end if;

  update public.cms_records records
    set collection_order = requested.ordinality::integer - 1
    from unnest(p_record_ids) with ordinality as requested(record_id, ordinality)
    where records.id = requested.record_id
      and records.record_type = p_record_type;

  insert into public.cms_audit_events (
    actor_user_id, action, outcome, entity_type, metadata
  ) values (
    p_actor, 'records_reordered', 'success', 'record_collection',
    jsonb_build_object('record_type', p_record_type, 'record_count', v_requested_count)
  );

  return jsonb_build_object(
    'recordType', p_record_type,
    'recordCount', v_requested_count
  );
end;
$$;

revoke all on function public.cms_assign_collection_order() from public, anon, authenticated;
revoke all on function public.cms_reorder_records(uuid,text,uuid[]) from public, anon, authenticated;
grant execute on function public.cms_reorder_records(uuid,text,uuid[]) to service_role;
