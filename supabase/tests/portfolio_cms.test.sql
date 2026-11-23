begin;

select plan(39);

select ok(
  (
    select count(*) = 7
      from pg_class
      where oid in (
        'public.cms_records'::regclass,
        'public.cms_record_versions'::regclass,
        'public.cms_publications'::regclass,
        'public.cms_audit_events'::regclass,
        'public.cms_media_assets'::regclass,
        'public.portfolio_messages'::regclass,
        'public.portfolio_message_rate_limits'::regclass
      )
        and relrowsecurity
  ),
  'CMS, media, and inbox tables enforce row-level security'
);
select ok(
  not has_table_privilege('anon', 'public.cms_records', 'select')
    and not has_table_privilege('authenticated', 'public.cms_records', 'select')
    and not has_table_privilege('anon', 'public.cms_record_versions', 'select')
    and not has_table_privilege('authenticated', 'public.cms_record_versions', 'select')
    and not has_table_privilege('anon', 'public.cms_publications', 'select')
    and not has_table_privilege('authenticated', 'public.cms_publications', 'select')
    and not has_table_privilege('anon', 'public.cms_audit_events', 'select')
    and not has_table_privilege('authenticated', 'public.cms_audit_events', 'select')
    and not has_table_privilege('anon', 'public.cms_media_assets', 'select')
    and not has_table_privilege('authenticated', 'public.cms_media_assets', 'select')
    and not has_table_privilege('anon', 'public.portfolio_messages', 'select')
    and not has_table_privilege('authenticated', 'public.portfolio_messages', 'select')
    and not has_table_privilege('anon', 'public.portfolio_message_rate_limits', 'select')
    and not has_table_privilege('authenticated', 'public.portfolio_message_rate_limits', 'select')
    and not has_table_privilege('anon', 'public.cms_records', 'insert'),
  'anonymous and authenticated roles cannot directly read or write private records'
);
select ok(
  has_function_privilege('service_role', 'public.cms_reorder_records(uuid,text,uuid[],uuid[])', 'execute')
    and not has_function_privilege('anon', 'public.cms_reorder_records(uuid,text,uuid[],uuid[])', 'execute')
    and not has_function_privilege('authenticated', 'public.cms_reorder_records(uuid,text,uuid[],uuid[])', 'execute')
    and not has_function_privilege('service_role', 'public.cms_reorder_records(uuid,text,uuid[])', 'execute'),
  'only the service role can execute the ordering RPC'
);
select ok(
  exists (select 1 from storage.buckets where id = 'portfolio-media-private' and public = false)
    and exists (select 1 from storage.buckets where id = 'portfolio-media-public' and public = true),
  'private and public media buckets have distinct visibility'
);
select ok(
  not exists (
    select 1
      from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and roles && array['anon'::name,'authenticated'::name,'public'::name]
        and cmd in ('SELECT','ALL')
  ),
  'storage has no anonymous or authenticated object-read policy'
);

select throws_ok(
  $$
    select public.cms_seed_public_baseline(
      '00000000-0000-4000-8000-000000000001',
      '[
        {"recordType":"project","recordKey":"project-gap-first","collectionOrder":0,"publicPayload":{"id":"project-gap-first","title":"First","visibility":"published","category":"embedded"}},
        {"recordType":"project","recordKey":"project-gap-second","collectionOrder":2,"publicPayload":{"id":"project-gap-second","title":"Second","visibility":"published","category":"embedded"}}
      ]'::jsonb
    )
  $$,
  'P0001',
  'Public baseline collection order must be contiguous from zero',
  'baseline positions with gaps are rejected'
);
select is(
  (select count(*)::integer from public.cms_records),
  0,
  'a rejected gapped baseline leaves no partial records'
);
select throws_ok(
  $$
    select public.cms_seed_public_baseline(
      '00000000-0000-4000-8000-000000000001',
      '[
        {"recordType":"project","recordKey":"project-duplicate-first","collectionOrder":0,"publicPayload":{"id":"project-duplicate-first","title":"First","visibility":"published","category":"embedded"}},
        {"recordType":"project","recordKey":"project-duplicate-second","collectionOrder":0,"publicPayload":{"id":"project-duplicate-second","title":"Second","visibility":"published","category":"embedded"}}
      ]'::jsonb
    )
  $$,
  'P0001',
  'Public baseline collection order must be contiguous from zero',
  'duplicate baseline positions are rejected'
);
select lives_ok(
  $$
    select public.cms_seed_public_baseline(
      '00000000-0000-4000-8000-000000000001',
      '[
        {"recordType":"category","recordKey":"embedded","collectionOrder":0,"publicPayload":{"title":"Embedded","subtitle":"Systems"}},
        {"recordType":"project","recordKey":"project-first","collectionOrder":0,"publicPayload":{"id":"project-first","title":"First","visibility":"published","category":"embedded"}},
        {"recordType":"project","recordKey":"project-second","collectionOrder":1,"publicPayload":{"id":"project-second","title":"Second","visibility":"published","category":"embedded"}}
      ]'::jsonb
    )
  $$,
  'published baseline records import with their public array order'
);
select is(
  (select collection_order from public.cms_records where record_type = 'project' and record_key = 'project-first'),
  0,
  'the first project receives order zero'
);
select is(
  (select collection_order from public.cms_records where record_type = 'project' and record_key = 'project-second'),
  1,
  'the second project receives order one'
);
create temporary table cms_baseline_reimport_context as
select public.cms_seed_public_baseline(
  '00000000-0000-4000-8000-000000000001',
  '[
    {"recordType":"category","recordKey":"embedded","collectionOrder":0,"publicPayload":{"title":"Embedded","subtitle":"Systems"}},
    {"recordType":"project","recordKey":"project-first","collectionOrder":0,"publicPayload":{"id":"project-first","title":"First","visibility":"published","category":"embedded"}},
    {"recordType":"project","recordKey":"project-second","collectionOrder":1,"publicPayload":{"id":"project-second","title":"Second","visibility":"published","category":"embedded"}}
  ]'::jsonb
) as result;
select is(
  (select (result->>'inserted')::integer from cms_baseline_reimport_context),
  0,
  're-importing an identical baseline inserts no records'
);
select is(
  (select (result->>'skipped')::integer from cms_baseline_reimport_context),
  3,
  're-importing an identical baseline skips existing records'
);

create temporary table cms_order_test_context (
  record_id uuid not null,
  first_version_id uuid not null,
  first_order integer not null,
  first_project_id uuid not null,
  second_project_id uuid not null,
  category_id uuid not null
) on commit drop;

insert into cms_order_test_context
select (result->>'id')::uuid, (result->>'versionId')::uuid, records.collection_order,
       (select id from public.cms_records where record_type = 'project' and record_key = 'project-first'),
       (select id from public.cms_records where record_type = 'project' and record_key = 'project-second'),
       (select id from public.cms_records where record_type = 'category' and record_key = 'embedded')
  from (
    select public.cms_save_draft(
      '00000000-0000-4000-8000-000000000001',
      'project',
      'project-new',
      null,
      '{"id":"project-new","title":"New","category":"embedded","kind":"project","status":"planned","repository":"https://example.test/repo","repositoryName":"New","statusLabel":"Planned","technologies":[],"evidence":["https://example.test/repo"],"notes":[]}'::jsonb,
      '{}'::jsonb,
      'Create ordered record'
    ) as result
  ) saved
  join public.cms_records records
    on records.id = (saved.result->>'id')::uuid;

select is(
  (select collection_order from public.cms_records where record_type = 'project' and record_key = 'project-new'),
  2,
  'a new record is appended deterministically'
);
select lives_ok(
  $$
    select public.cms_save_draft(
      '00000000-0000-4000-8000-000000000001',
      'project',
      'project-new',
      (select first_version_id from cms_order_test_context),
      '{"id":"project-new","title":"Updated","category":"embedded","kind":"project","status":"planned","repository":"https://example.test/repo","repositoryName":"New","statusLabel":"Planned","technologies":[],"evidence":["https://example.test/repo"],"notes":[]}'::jsonb,
      '{}'::jsonb,
      'Create a second version'
    )
  $$,
  'version updates do not require or modify the collection order'
);
select throws_ok(
  $$
    select public.cms_save_draft(
      '00000000-0000-4000-8000-000000000001',
      'project',
      'project-new',
      null,
      '{"id":"project-new","title":"Stale","category":"embedded","kind":"project","status":"planned","repository":"https://example.test/repo","repositoryName":"New","statusLabel":"Planned","technologies":[],"evidence":["https://example.test/repo"],"notes":[]}'::jsonb,
      '{}'::jsonb,
      'Stale concurrent update'
    )
  $$,
  '40001',
  'CMS record changed',
  'a stale concurrent draft update is rejected'
);
select lives_ok(
  $$
    select public.cms_seed_public_baseline(
      '00000000-0000-4000-8000-000000000001',
      '[
        {"recordType":"category","recordKey":"embedded","collectionOrder":0,"publicPayload":{"title":"Embedded","subtitle":"Systems"}},
        {"recordType":"project","recordKey":"project-first","collectionOrder":0,"publicPayload":{"id":"project-first","title":"First","visibility":"published","category":"embedded"}},
        {"recordType":"project","recordKey":"project-second","collectionOrder":1,"publicPayload":{"id":"project-second","title":"Second","visibility":"published","category":"embedded"}}
      ]'::jsonb
    )
  $$,
  're-import preserves non-baseline drafts'
);
select is(
  (select public_payload->>'title'
     from public.cms_record_versions
     where record_id = (select record_id from cms_order_test_context)
     order by version_number desc limit 1),
  'Updated',
  'baseline re-import does not overwrite a non-baseline draft payload'
);
select is(
  (select collection_order from public.cms_records where id = (select record_id from cms_order_test_context)),
  2,
  'baseline re-import retains non-baseline records after baseline entries'
);
select is(
  (select count(*)::integer from public.cms_record_versions where record_id = (select record_id from cms_order_test_context)),
  2,
  'baseline re-import does not create or remove draft versions'
);
select lives_ok(
  $$
    select public.cms_reorder_records(
      '00000000-0000-4000-8000-000000000001',
      'project',
      array[
        (select first_project_id from cms_order_test_context),
        (select second_project_id from cms_order_test_context),
        (select record_id from cms_order_test_context)
      ],
      array[
        (select record_id from cms_order_test_context),
        (select first_project_id from cms_order_test_context),
        (select second_project_id from cms_order_test_context)
      ]
    )
  $$,
  'the owner-side ordering RPC moves [A,B,C] to [C,A,B]'
);
select is(
  (select array_agg(id order by collection_order)
     from public.cms_records where record_type = 'project'),
  array[
    (select record_id from cms_order_test_context),
    (select first_project_id from cms_order_test_context),
    (select second_project_id from cms_order_test_context)
  ]::uuid[],
  'the complete requested order is persisted'
);
select ok(
  exists (
    select 1 from public.cms_audit_events
      where action = 'records_reordered'
        and metadata->'previous_record_ids' = to_jsonb(array[
          (select first_project_id from cms_order_test_context),
          (select second_project_id from cms_order_test_context),
          (select record_id from cms_order_test_context)
        ]::uuid[])
        and metadata->'ordered_record_ids' = to_jsonb(array[
          (select record_id from cms_order_test_context),
          (select first_project_id from cms_order_test_context),
          (select second_project_id from cms_order_test_context)
        ]::uuid[])
  ),
  'the atomic reorder audit event records the prior and requested ID order'
);
select throws_ok(
  $$
    select public.cms_reorder_records(
      '00000000-0000-4000-8000-000000000001',
      'project',
      array[
        (select first_project_id from cms_order_test_context),
        (select second_project_id from cms_order_test_context),
        (select record_id from cms_order_test_context)
      ],
      array[
        (select first_project_id from cms_order_test_context),
        (select record_id from cms_order_test_context),
        (select second_project_id from cms_order_test_context)
      ]
    )
  $$,
  '40001',
  'CMS collection order changed',
  'a stale competing reorder is rejected after the first order commits'
);
select is(
  (select array_agg(id order by collection_order)
     from public.cms_records where record_type = 'project'),
  array[
    (select record_id from cms_order_test_context),
    (select first_project_id from cms_order_test_context),
    (select second_project_id from cms_order_test_context)
  ]::uuid[],
  'a rejected stale reorder leaves the committed order unchanged'
);
select lives_ok(
  $$
    select public.cms_reorder_records(
      '00000000-0000-4000-8000-000000000001',
      'project',
      array[
        (select record_id from cms_order_test_context),
        (select first_project_id from cms_order_test_context),
        (select second_project_id from cms_order_test_context)
      ],
      array[
        (select first_project_id from cms_order_test_context),
        (select record_id from cms_order_test_context),
        (select second_project_id from cms_order_test_context)
      ]
    )
  $$,
  'a complete adjacent-record swap is accepted'
);
select is(
  (select array_agg(id order by collection_order)
     from public.cms_records where record_type = 'project'),
  array[
    (select first_project_id from cms_order_test_context),
    (select record_id from cms_order_test_context),
    (select second_project_id from cms_order_test_context)
  ]::uuid[],
  'an adjacent swap produces a contiguous collection order'
);
select throws_ok(
  $$
    select public.cms_reorder_records(
      '00000000-0000-4000-8000-000000000001',
      'project',
      array[
        (select first_project_id from cms_order_test_context),
        (select record_id from cms_order_test_context),
        (select second_project_id from cms_order_test_context)
      ],
      array[
        (select first_project_id from cms_order_test_context),
        (select first_project_id from cms_order_test_context),
        (select second_project_id from cms_order_test_context)
      ]
    )
  $$,
  'P0001',
  'Invalid record ordering',
  'duplicate record IDs are rejected'
);
select throws_ok(
  $$
    select public.cms_reorder_records(
      '00000000-0000-4000-8000-000000000001',
      'project',
      array[
        (select first_project_id from cms_order_test_context),
        (select record_id from cms_order_test_context),
        (select second_project_id from cms_order_test_context)
      ],
      array[
        (select first_project_id from cms_order_test_context),
        (select record_id from cms_order_test_context)
      ]
    )
  $$,
  'P0001',
  'Ordering must include every record of the selected type exactly once',
  'omitting a collection record is rejected'
);
select throws_ok(
  $$
    select public.cms_reorder_records(
      '00000000-0000-4000-8000-000000000001',
      'project',
      array[
        (select first_project_id from cms_order_test_context),
        (select record_id from cms_order_test_context),
        (select second_project_id from cms_order_test_context)
      ],
      array[
        (select first_project_id from cms_order_test_context),
        (select record_id from cms_order_test_context),
        (select category_id from cms_order_test_context)
      ]
    )
  $$,
  'P0001',
  'Ordering must include every record of the selected type exactly once',
  'an ID from another collection is rejected'
);
select lives_ok(
  $$
    select public.cms_reorder_records(
      '00000000-0000-4000-8000-000000000001',
      'achievement',
      '{}'::uuid[],
      '{}'::uuid[]
    )
  $$,
  'an empty collection can be reordered'
);
select lives_ok(
  $$
    select public.cms_reorder_records(
      '00000000-0000-4000-8000-000000000001',
      'category',
      array[(select category_id from cms_order_test_context)],
      array[(select category_id from cms_order_test_context)]
    )
  $$,
  'a single-record collection can retain its order'
);

create temporary table cms_reorder_audit_context (audit_count integer not null) on commit drop;
insert into cms_reorder_audit_context
  select count(*)::integer from public.cms_audit_events where action = 'records_reordered';
create function public.cms_test_fail_reorder_audit()
returns trigger
language plpgsql
as $$
begin
  if new.action = 'records_reordered' then
    raise exception 'Injected reorder audit failure';
  end if;
  return new;
end;
$$;
create trigger cms_test_fail_reorder_audit
  before insert on public.cms_audit_events
  for each row execute function public.cms_test_fail_reorder_audit();
select throws_ok(
  $$
    select public.cms_reorder_records(
      '00000000-0000-4000-8000-000000000001',
      'project',
      array[
        (select first_project_id from cms_order_test_context),
        (select record_id from cms_order_test_context),
        (select second_project_id from cms_order_test_context)
      ],
      array[
        (select record_id from cms_order_test_context),
        (select first_project_id from cms_order_test_context),
        (select second_project_id from cms_order_test_context)
      ]
    )
  $$,
  'P0001',
  'Injected reorder audit failure',
  'an audit failure aborts the ordering transaction'
);
select is(
  (select array_agg(id order by collection_order)
     from public.cms_records where record_type = 'project'),
  array[
    (select first_project_id from cms_order_test_context),
    (select record_id from cms_order_test_context),
    (select second_project_id from cms_order_test_context)
  ]::uuid[],
  'failed ordering rolls back every collection position'
);
select is(
  (select count(*)::integer from public.cms_audit_events where action = 'records_reordered'),
  (select audit_count from cms_reorder_audit_context),
  'failed ordering leaves no partial success audit event'
);
drop trigger cms_test_fail_reorder_audit on public.cms_audit_events;
drop function public.cms_test_fail_reorder_audit();
select lives_ok(
  $$
    select public.cms_restore_version(
      '00000000-0000-4000-8000-000000000001',
      (select record_id from cms_order_test_context),
      (select first_version_id from cms_order_test_context)
    )
  $$,
  'restoring an earlier version creates a new draft version'
);
select is(
  (select records.collection_order
     from public.cms_records records
     join cms_order_test_context context on context.record_id = records.id),
  1,
  'version restoration preserves the owner-controlled order'
);
select throws_ok(
  format(
    'update public.cms_record_versions set change_summary = %L where id = %L::uuid',
    'tampered',
    (select first_version_id from cms_order_test_context)
  ),
  'P0001',
  'CMS history is immutable',
  'version history cannot be altered'
);
select throws_ok(
  format(
    'delete from public.cms_audit_events where record_id = %L::uuid',
    (select record_id from cms_order_test_context)
  ),
  'P0001',
  'CMS history is immutable',
  'audit events cannot be deleted'
);

select * from finish();
rollback;
