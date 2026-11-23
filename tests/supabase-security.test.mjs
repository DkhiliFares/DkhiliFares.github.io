import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from '../scripts/build.mjs';
import { root } from '../scripts/validate-content.mjs';
import { createPortfolioCmsHandler } from '../supabase/functions/_shared/cms-api.mjs';
import { hasImageSignature, validateCmsDraft } from '../supabase/functions/_shared/cms-validation.mjs';

const origin = 'https://portfolio.example';
const env = {
  ALLOWED_ORIGINS: origin,
  OWNER_USER_ID: 'owner-id',
  SUPABASE_URL: 'https://project.supabase.co'
};

function token(claims = {}) {
  const payload = btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `header.${payload}.signature`;
}

function request(body, options = {}) {
  const method = options.method || 'POST';
  return new Request('https://project.supabase.co/functions/v1/portfolio-cms', {
    method,
    headers: {
      Origin: options.origin || origin,
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(method === 'POST' ? { 'Content-Type': options.contentType || 'application/json' } : {})
    },
    body: options.rawBody ?? (method === 'GET' || method === 'OPTIONS' ? undefined : JSON.stringify(body))
  });
}

function handler(options = {}) {
  const calls = [];
  const value = createPortfolioCmsHandler({
    env: { ...env, ...options.env },
    createClient: () => ({
      auth: {
        getUser: async accessToken => {
          calls.push(accessToken);
          if (accessToken === 'invalid-token') return { data: { user: null }, error: { code: 'INVALID_TOKEN' } };
          let subject = '';
          try {
            subject = JSON.parse(atob(accessToken.split('.')[1])).sub || '';
          } catch {}
          return {
            data: { user: { id: accessToken === 'non-owner-token' || subject === 'other-user' ? 'other-user' : 'owner-id' } },
            error: null
          };
        }
      },
      ...options.client
    }),
    serviceKey: () => 'server-only-key',
    logger: { error() {} }
  });
  return { handle: value, calls };
}

test('CMS rejects anonymous, invalid-token, non-owner, and untrusted-origin requests', async () => {
  const { handle } = handler();
  assert.equal((await handle(request({ action: 'list_records' }))).status, 401);
  assert.equal((await handle(request({ action: 'list_records' }, { token: 'invalid-token' }))).status, 401);
  assert.equal((await handle(request({ action: 'list_records' }, { token: 'non-owner-token' }))).status, 403);
  assert.equal((await handle(request({ action: 'list_records' }, { token: 'owner-token', origin: 'https://attacker.example' }))).status, 403);
});

test('CMS enforces allowed methods, JSON content type, and streamed request-size limits', async () => {
  const { handle } = handler();
  assert.equal((await handle(request(null, { method: 'GET', token: 'owner-token' }))).status, 405);
  const preflight = await handle(request(null, { method: 'OPTIONS' }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'authorization, content-type');
  assert.equal((await handle(request({ action: 'list_records' }, { token: 'owner-token', contentType: 'text/plain' }))).status, 415);
  const oversized = request({ action: 'list_records' }, {
    token: 'owner-token',
    rawBody: JSON.stringify({ action: 'list_records', large: 'x'.repeat(200_001) })
  });
  assert.equal((await handle(oversized)).status, 413);
});

test('CMS requires verified aal2 TOTP for writes and rejects invalid drafts', async () => {
  const { handle } = handler();
  const write = { action: 'save_draft', recordType: 'project', recordKey: 'fixture', publicPayload: {} };
  const withoutMfa = await handle(request(write, { token: token({ aal: 'aal1', amr: [{ method: 'otp' }] }) }));
  assert.equal(withoutMfa.status, 403);
  assert.equal((await withoutMfa.json()).code, 'MFA_REQUIRED');

  const withMfa = await handle(request(write, { token: token({ aal: 'aal2', amr: [{ method: 'totp' }] }) }));
  assert.equal(withMfa.status, 400);
  assert.equal((await withMfa.json()).code, 'INVALID_DRAFT');
  const withRfcAmr = await handle(request(write, { token: token({ aal: 'aal2', amr: ['totp'] }) }));
  assert.equal(withRfcAmr.status, 400);
});

test('every sensitive CMS action rejects missing AAL2 TOTP before storage or database access', async () => {
  let touched = false;
  const { handle } = handler({
    client: {
      rpc: async () => { touched = true; return { data: null, error: null }; },
      from: () => { touched = true; throw new Error('Database must not be used.'); },
      storage: { from: () => { touched = true; throw new Error('Storage must not be used.'); } }
    }
  });
  const actions = [
    'seed_public_baseline','save_draft','archive_record','restore_version',
    'request_media_upload','complete_media_upload','update_media_metadata',
    'remove_staged_media','approve_media','request_publication','cancel_publication','reorder_records'
  ];
  for (const action of actions) {
    for (const claims of [
      { aal: 'aal1', amr: [{ method: 'totp' }] },
      { aal: 'aal2', amr: [{ method: 'otp' }] }
    ]) {
      const response = await handle(request({ action }, { token: token(claims) }));
      assert.equal(response.status, 403, `${action} must require aal2 TOTP`);
      assert.equal((await response.json()).code, 'MFA_REQUIRED');
    }
  }
  assert.equal(touched, false);
});

test('CMS validates public draft models and forces unpublished visibility', () => {
  const project = validateCmsDraft({
    recordType: 'project', recordKey: 'safe-project',
    publicPayload: {
      id: 'mismatched-id', title: '  Project  ', summary: ' Summary ',
      repositoryName: 'Project', repository: 'https://github.com/example/project',
      statusLabel: 'Planned', category: 'embedded', kind: 'project', status: 'planned',
      visibility: 'published', technologies: [], evidence: ['https://github.com/example/project'],
      notes: []
    },
    editorialMetadata: { review: 'pending' }, changeSummary: ' Initial draft '
  });
  assert.equal(project.error, undefined);
  assert.equal(project.value.publicPayload.id, 'safe-project');
  assert.equal(project.value.publicPayload.title, 'Project');
  assert.equal(project.value.publicPayload.visibility, 'draft');
  assert.equal(project.value.changeSummary, 'Initial draft');
  assert.equal(validateCmsDraft({
    recordType: 'experience', recordKey: 'role',
    publicPayload: {
      title: 'Role', company: 'Org', period: '2026', year: '2026', summary: 'Summary',
      details: [], technologies: [], visibility: 'published'
    }
  }).value.publicPayload.visibility, 'draft');

  assert.match(validateCmsDraft({
    recordType: 'project', recordKey: 'invalid-project',
    publicPayload: { title: '', summary: '', category: '', kind: 'unknown', status: 'done' }
  }).error, /Invalid project content/);
  assert.match(validateCmsDraft({
    recordType: 'experience', recordKey: 'private-field',
    publicPayload: { title: 'Role', company: 'Org', period: '2026', summary: 'Summary', nested: { token: 'private' } }
  }).error, /Private fields/);
  assert.match(validateCmsDraft({
    recordType: 'profile', recordKey: 'profile',
    publicPayload: {
      name: 'Owner', title: 'Engineer',
      github: 'https://github.com/example', linkedin: 'https://linkedin.com/in/example',
      SUPABASE_SERVICE_ROLE_KEY: 'must-not-be-published'
    }
  }).error, /Private fields/);
});

test('owner with aal2 can save drafts, while concurrent edits produce a conflict', async () => {
  const actor = token({ aal: 'aal2', amr: [{ method: 'totp' }] });
  const payload = {
    action: 'save_draft', recordType: 'project', recordKey: 'cms-project',
    expectedVersionId: null,
    publicPayload: {
      title: 'CMS project', summary: 'A project summary.', repositoryName: 'CMS project',
      repository: 'https://github.com/example/cms-project', statusLabel: 'Planned',
      category: 'embedded', kind: 'project', status: 'planned', technologies: [],
      evidence: ['https://github.com/example/cms-project'], notes: []
    },
    editorialMetadata: { review: 'pending' }, changeSummary: 'First version'
  };
  const calls = [];
  const saved = handler({
    client: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: { id: '123e4567-e89b-12d3-a456-426614174000', versionId: '223e4567-e89b-12d3-a456-426614174000', versionNumber: 1, publicationState: 'draft' }, error: null };
      }
    }
  });
  const response = await saved.handle(request(payload, { token: actor }));
  assert.equal(response.status, 200);
  assert.equal(calls[0].name, 'cms_save_draft');
  assert.equal(calls[0].args.p_actor, 'owner-id');
  assert.equal(calls[0].args.p_public_payload.id, 'cms-project');
  assert.equal(calls[0].args.p_public_payload.visibility, 'draft');

  const nonOwner = await saved.handle(request(payload, {
    token: token({ aal: 'aal2', amr: ['totp'], sub: 'other-user' })
  }));
  assert.equal(nonOwner.status, 403);
  assert.equal(calls.length, 1);

  const conflictCalls = [];
  const conflicting = handler({
    client: {
      rpc: async (name, args) => {
        conflictCalls.push(name);
        return name === 'cms_save_draft'
          ? { data: null, error: { code: '40001' } }
          : { data: null, error: null };
      }
    }
  });
  const conflict = await conflicting.handle(request(payload, { token: actor }));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'CMS_CONFLICT');
  assert.deepEqual(conflictCalls, ['cms_save_draft','cms_log_operation_failure']);
});

test('record lists order by explicit collection position instead of edit time', async () => {
  const selected = [];
  const ordering = [];
  const { handle } = handler({
    client: {
      from(table) {
        assert.equal(table, 'cms_records');
        const query = {
          select(columns) { selected.push(columns); return this; },
          order(column, options) { ordering.push([column, options.ascending]); return this; },
          limit() { return this; },
          eq() { return this; },
          then(resolve) { return resolve({ data: [], error: null }); }
        };
        return query;
      }
    }
  });
  const response = await handle(request({ action: 'list_records', recordType: 'project' }, { token: 'owner-token' }));
  assert.equal(response.status, 200);
  assert.match(selected[0], /collection_order/);
  assert.deepEqual(ordering, [['record_type', true], ['collection_order', true]]);
});

test('record ordering requires owner MFA and forwards the expected and requested order', async () => {
  const calls = [];
  const { handle } = handler({
    client: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: { recordType: args.p_record_type, recordCount: args.p_record_ids.length }, error: null };
      }
    }
  });
  const recordIds = [
    '123e4567-e89b-12d3-a456-426614174000',
    '223e4567-e89b-12d3-a456-426614174000'
  ];
  const expectedRecordIds = [...recordIds];
  const requestBody = { action: 'reorder_records', recordType: 'project', expectedRecordIds, recordIds };
  assert.equal((await handle(request(requestBody, { token: 'owner-token' }))).status, 403);
  assert.equal((await handle(request({
    ...requestBody,
    recordIds: [recordIds[0], recordIds[0]]
  }, { token: token({ aal: 'aal2', amr: ['totp'] }) }))).status, 400);
  assert.equal((await handle(request({
    ...requestBody,
    expectedRecordIds: [expectedRecordIds[0], expectedRecordIds[0]]
  }, { token: token({ aal: 'aal2', amr: ['totp'] }) }))).status, 400);
  assert.equal(calls.length, 0);

  const response = await handle(request(requestBody, { token: token({ aal: 'aal2', amr: ['totp'] }) }));
  assert.equal(response.status, 200);
  assert.equal(calls[0].name, 'cms_reorder_records');
  assert.deepEqual(calls[0].args.p_expected_record_ids, expectedRecordIds);
  assert.deepEqual(calls[0].args.p_record_ids, recordIds);
});

test('stale collection order is returned as a conflict and never a successful reorder', async () => {
  const calls = [];
  const { handle } = handler({
    client: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: null, error: { code: '40001' } };
      }
    }
  });
  const ids = [
    '123e4567-e89b-12d3-a456-426614174000',
    '223e4567-e89b-12d3-a456-426614174000'
  ];
  const response = await handle(request({
    action: 'reorder_records',
    recordType: 'project',
    expectedRecordIds: ids,
    recordIds: [...ids].reverse()
  }, { token: token({ aal: 'aal2', amr: ['totp'] }) }));

  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'CMS_CONFLICT');
  assert.equal(calls[0].name, 'cms_reorder_records');
  assert.deepEqual(calls[0].args.p_expected_record_ids, ids);
  assert.equal(calls[1].name, 'cms_log_operation_failure');
});

test('archive and restore operations use transactional server functions', async () => {
  const calls = [];
  const { handle } = handler({
    client: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return name === 'cms_archive_record'
          ? { data: { id: args.p_record_id, publicationState: 'archived' }, error: null }
          : { data: { id: args.p_record_id, versionId: args.p_version_id, versionNumber: 3 }, error: null };
      }
    }
  });
  const ownerToken = token({ aal: 'aal2', amr: ['totp'] });
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const versionId = '223e4567-e89b-12d3-a456-426614174000';
  assert.equal((await handle(request({ action: 'archive_record', id }, { token: ownerToken }))).status, 200);
  assert.equal((await handle(request({ action: 'restore_version', id, versionId }, { token: ownerToken }))).status, 200);
  assert.deepEqual(calls.map(call => call.name), ['cms_archive_record','cms_restore_version']);
});

test('publication requests are recorded as failed when GitHub publishing is unavailable', async () => {
  const calls = [];
  const { handle } = handler({
    client: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: { id: '323e4567-e89b-12d3-a456-426614174000', status: 'failed', failureCode: args.p_failure_code, created: true }, error: null };
      }
    }
  });
  const response = await handle(request({
    action: 'request_publication',
    id: '123e4567-e89b-12d3-a456-426614174000',
    versionId: '223e4567-e89b-12d3-a456-426614174000',
    approval: true,
    idempotencyKey: '423e4567-e89b-12d3-a456-426614174000'
  }, { token: token({ aal: 'aal2', amr: ['totp'] }) }));
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.code, 'GITHUB_APP_NOT_CONFIGURED');
  assert.equal(result.publication.status, 'failed');
  assert.match(result.error, /no public change was made/);
  assert.equal(calls[0].name, 'cms_request_publication');
});

test('media actions reject unsafe types and sizes before creating signed uploads', async () => {
  let touched = false;
  const { handle, calls } = handler({ client: {
    storage: { from: () => { touched = true; throw new Error('storage must not be called for invalid media'); } },
    rpc: async () => { touched = true; throw new Error('database must not be called for invalid media'); }
  } });
  const auth = { token: token({ aal: 'aal2', amr: ['totp'] }) };
  const invalidType = await handle(request({
    action: 'request_media_upload', fileName: 'payload.svg', contentType: 'image/svg+xml', size: 100
  }, auth));
  assert.equal(invalidType.status, 400);
  const oversized = await handle(request({
    action: 'request_media_upload', fileName: 'photo.png', contentType: 'image/png', size: 10_485_761
  }, auth));
  assert.equal(oversized.status, 400);
  assert.equal(touched, false);
  assert.equal(calls.length, 2);
});

test('valid media upload receives a short-lived private-bucket upload token only', async () => {
  const requested = [];
  const { handle } = handler({
    client: {
      storage: {
        from(bucket) {
          requested.push(bucket);
          return {
            createSignedUploadUrl: async objectPath => ({
              data: { path: objectPath, token: 'single-use-upload-token' }, error: null
            })
          };
        }
      },
      rpc: async (name, args) => name === 'cms_register_media_asset'
        ? { data: { id: '123e4567-e89b-12d3-a456-426614174000', objectPath: args.p_object_path }, error: null }
        : { data: null, error: null }
    }
  });
  const response = await handle(request({
    action: 'request_media_upload', fileName: 'portrait.png', contentType: 'image/png', size: 1024
  }, { token: token({ aal: 'aal2', amr: ['totp'] }) }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.upload.bucket, 'portfolio-media-private');
  assert.match(result.upload.objectPath, /^pending\/[0-9a-f-]+\.png$/);
  assert.equal(result.upload.token, 'single-use-upload-token');
  assert.deepEqual(requested, ['portfolio-media-private']);
});

test('private image signature validation rejects spoofed MIME types', () => {
  assert.equal(hasImageSignature(Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), 'image/png'), true);
  assert.equal(hasImageSignature(Uint8Array.from([0xff,0xd8,0xff,0x00]), 'image/jpeg'), true);
  assert.equal(hasImageSignature(Uint8Array.from([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50]), 'image/webp'), true);
  assert.equal(hasImageSignature(new TextEncoder().encode('<svg></svg>'), 'image/png'), false);
});

test('public baseline import accepts only public records and reports idempotent database counts', async () => {
  const calls = [];
  const { handle } = handler({
    client: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: { inserted: 2, skipped: 3 }, error: null };
      }
    }
  });
  const ownerToken = token({ aal: 'aal2', amr: ['totp'] });
  const category = {
    recordType: 'category', recordKey: 'embedded', collectionOrder: 0,
    publicPayload: { title: 'Embedded systems', subtitle: 'Firmware and hardware', visibility: 'published' }
  };
  const record = {
    recordType: 'project', recordKey: 'public-project', collectionOrder: 0,
    publicPayload: {
      title: 'Public project', summary: 'Public summary.', category: 'embedded',
      repositoryName: 'Public project', statusLabel: 'Planned',
      kind: 'project', status: 'planned', visibility: 'published',
      technologies: [], notes: [],
      repository: 'https://github.com/example/public-project',
      evidence: ['https://github.com/example/public-project/blob/main/README.md']
    }
  };
  const response = await handle(request({ action: 'seed_public_baseline', records: [category, record] }, { token: ownerToken }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).baseline, { inserted: 2, skipped: 3 });
  assert.equal(calls[0].name, 'cms_seed_public_baseline');
  assert.equal(calls[0].args.p_records[1].publicPayload.visibility, 'published');
  assert.equal(calls[0].args.p_records[0].collectionOrder, 0);

  const privateRecord = { ...record, recordKey: 'private-project', publicPayload: { ...record.publicPayload, visibility: 'draft' } };
  const rejected = await handle(request({ action: 'seed_public_baseline', records: [privateRecord] }, { token: ownerToken }));
  assert.equal(rejected.status, 400);
  assert.equal(calls.length, 1);

  const duplicateOrder = { ...record, recordKey: 'second-project' };
  const orderRejected = await handle(request({
    action: 'seed_public_baseline',
    records: [category, record, duplicateOrder]
  }, { token: ownerToken }));
  assert.equal(orderRejected.status, 400);
  assert.equal(calls.length, 1);
});

test('CMS rejects malformed record requests and private preview fields at any nesting depth', async () => {
  const { handle } = handler();
  const auth = { token: 'owner-token' };
  assert.equal((await handle(request({ action: 'get_record', id: 'not-a-uuid' }, auth))).status, 400);
  assert.equal((await handle(request({ action: 'list_records', admin: true }, auth))).status, 400);
  const privatePreview = await handle(request({
    action: 'preview_record',
    publicPayload: { project: { media: [{ sourceReferences: ['private'] }] } }
  }, auth));
  assert.equal(privatePreview.status, 400);

  const publicPreview = await handle(request({
    action: 'preview_record',
    publicPayload: { title: 'Public project', summary: 'Approved public projection.' }
  }, auth));
  assert.equal(publicPreview.status, 200);
  assert.deepEqual((await publicPreview.json()).preview, {
    title: 'Public project',
    summary: 'Approved public projection.'
  });
});

test('CMS summary reports database counts instead of placeholder values', async () => {
  const { handle } = handler({
    client: {
      from(table) {
        return {
          select(_columns, options) {
            const result = Promise.resolve({
              count: table === 'cms_records' ? 8 : 3,
              error: null
            });
            if (options?.head) {
              return {
                then: result.then.bind(result),
                eq: async (_column, value) => ({ count: value === 'draft' ? 3 : 0, error: null })
              };
            }
            return result;
          }
        };
      }
    }
  });
  const response = await handle(request({ action: 'dashboard_summary' }, { token: 'owner-token' }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).summary, { recordCount: 8, draftCount: 3, publicationCount: 3 });
});

test('CMS returns sanitized errors when Auth or database requests fail', async () => {
  const authUnavailable = handler({
    client: { auth: { getUser: async () => { throw new Error('internal auth endpoint'); } } }
  });
  const authResponse = await authUnavailable.handle(request({ action: 'list_records' }, { token: 'owner-token' }));
  assert.equal(authResponse.status, 503);
  assert.deepEqual(await authResponse.json(), {
    error: 'Authentication service is temporarily unavailable.',
    code: 'AUTH_UNAVAILABLE'
  });

  const databaseUnavailable = handler({ client: { from: () => { throw new Error('internal database address'); } } });
  const databaseResponse = await databaseUnavailable.handle(request({ action: 'dashboard_summary' }, { token: 'owner-token' }));
  assert.equal(databaseResponse.status, 503);
  const databaseBody = await databaseResponse.text();
  assert.match(databaseBody, /Could not load dashboard/);
  assert.doesNotMatch(databaseBody, /internal database address/);
});

test('private CMS and inbox tables remain protected by RLS without public policies', async () => {
  const inbox = await readFile(path.join(root, 'supabase/migrations/20261122000000_portfolio_inbox.sql'), 'utf8');
  const cms = await readFile(path.join(root, 'supabase/migrations/20261123000000_portfolio_cms.sql'), 'utf8');
  const hardening = await readFile(path.join(root, 'supabase/migrations/20261123000001_portfolio_messaging_hardening.sql'), 'utf8');
  const operations = await readFile(path.join(root, 'supabase/migrations/20261123150000_portfolio_cms_operations.sql'), 'utf8');
  for (const table of ['portfolio_messages','portfolio_alert_slots']) {
    assert.match(inbox, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(inbox, new RegExp(`revoke all on public\\.${table}[^;]*from anon, authenticated`, 'i'));
  }
  for (const table of ['cms_records','cms_record_versions','cms_publications','cms_audit_events']) {
    assert.match(cms, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(operations, /alter table public\.cms_media_assets enable row level security/i);
  assert.match(operations, /revoke all on public\.cms_media_assets from anon, authenticated/i);
  assert.match(cms, /revoke all on public\.cms_records, public\.cms_record_versions, public\.cms_publications, public\.cms_audit_events\s+from anon, authenticated/i);
  assert.match(hardening, /alter table public\.portfolio_message_rate_limits enable row level security/i);
  assert.match(hardening, /revoke all on public\.portfolio_message_rate_limits from anon, authenticated/i);
  assert.match(hardening, /grant execute on function public\.consume_portfolio_message_rate_limit[^;]+to service_role/i);
  for (const operation of ['cms_save_draft','cms_archive_record','cms_restore_version','cms_request_publication','cms_register_media_asset']) {
    assert.match(operations, new RegExp(`grant execute on function public\\.${operation}[^;]+to service_role`, 'i'));
  }
  assert.match(operations, /before update or delete on public\.cms_record_versions/i);
  assert.match(operations, /before update or delete on public\.cms_audit_events/i);
  for (const migration of [cms, operations]) {
    assert.match(migration, /on conflict \(id\) do nothing/i);
    assert.doesNotMatch(migration, /on conflict \(id\) do update set\s+public\s*=/i);
  }
  assert.match(operations, /record_type = 'category'[\s\S]*published_version_id is not null/i);
  assert.match(operations, /jsonb_array_elements_text\(coalesce\(p_public_payload->'projects'/i);
  assert.match(operations, /jsonb_array_elements_text\(coalesce\(p_public_payload->'experience'/i);
  assert.doesNotMatch(`${inbox}\n${cms}\n${hardening}\n${operations}`, /create\s+policy/i);
});

test('static builds never embed server-only credentials', async () => {
  const marker = 'server-secret-must-not-be-in-output';
  const names = [
    'SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEYS',
    'TURNSTILE_SECRET_KEY','RESEND_API_KEY','GITHUB_APP_PRIVATE_KEY'
  ];
  const previous = new Map(names.map(name => [name, process.env[name]]));
  const previousUrl = process.env.SUPABASE_URL;
  const previousPublishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    process.env.SUPABASE_URL = 'https://public-test.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_public-test-value';
    for (const name of names) process.env[name] = marker;
    const { outDir } = await build({ outDir: path.join(root, '.qa/supabase-secret-scan') });
    const pending = [outDir];
    while (pending.length) {
      const current = pending.pop();
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const target = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(target);
        else assert.equal((await readFile(target)).includes(Buffer.from(marker)), false, `Server secret leaked into ${path.relative(outDir, target)}`);
      }
    }
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousPublishable === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = previousPublishable;
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
