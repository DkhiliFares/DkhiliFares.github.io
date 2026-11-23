create or replace function public.cms_reorder_records(
  p_actor uuid,
  p_record_type text,
  p_expected_record_ids uuid[],
  p_record_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actual_count integer;
  v_requested_count integer;
  v_current_record_ids uuid[];
begin
  if p_actor is null
    or p_record_type is null
    or p_record_type not in ('project','skill','experience','education','credential','achievement','article','profile','category')
    or p_expected_record_ids is null
    or cardinality(p_expected_record_ids) > 500
    or p_record_ids is null
    or cardinality(p_record_ids) > 500
    or exists (
      select 1 from unnest(p_expected_record_ids) as expected(record_id)
        where expected.record_id is null
    )
    or exists (
      select 1 from unnest(p_record_ids) as requested(record_id)
        where requested.record_id is null
    ) then
    raise exception 'Invalid record ordering';
  end if;

  if cardinality(p_expected_record_ids) <> (
    select count(distinct record_id) from unnest(p_expected_record_ids) as expected(record_id)
  ) or cardinality(p_record_ids) <> (
    select count(distinct record_id) from unnest(p_record_ids) as requested(record_id)
  ) then
    raise exception 'Invalid record ordering';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cms-record-order:' || p_record_type, 0));

  select count(*), coalesce(array_agg(id order by collection_order), '{}'::uuid[])
    into v_actual_count, v_current_record_ids
    from public.cms_records
    where record_type = p_record_type;

  if v_current_record_ids is distinct from p_expected_record_ids then
    raise exception using
      errcode = '40001',
      message = 'CMS collection order changed';
  end if;

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
    jsonb_build_object(
      'record_type', p_record_type,
      'record_count', v_requested_count,
      'previous_record_ids', to_jsonb(v_current_record_ids),
      'ordered_record_ids', to_jsonb(p_record_ids)
    )
  );

  return jsonb_build_object(
    'recordType', p_record_type,
    'recordCount', v_requested_count
  );
end;
$$;

revoke all on function public.cms_reorder_records(uuid,text,uuid[]) from service_role;
revoke all on function public.cms_reorder_records(uuid,text,uuid[],uuid[]) from public, anon, authenticated;
grant execute on function public.cms_reorder_records(uuid,text,uuid[],uuid[]) to service_role;
