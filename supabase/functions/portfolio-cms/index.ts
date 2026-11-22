import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json, serviceKey } from '../_shared/http.mjs';

const recordTypes = new Set(['project','skill','experience','education','credential','achievement','article','profile','category']);

Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';
  const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') || Deno.env.get('ALLOWED_ORIGIN') || 'https://dkhilifares.github.io')
    .split(',').map(value => value.trim()).filter(Boolean);
  const allowed = allowedOrigins.includes(origin);
  const headers = corsHeaders(origin, allowedOrigins.find(value => value === origin) || allowedOrigins[0]);
  if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers });
  if (!allowed || request.method !== 'POST') return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403, headers);

  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  const ownerId = Deno.env.get('OWNER_USER_ID');
  const url = Deno.env.get('SUPABASE_URL');
  const key = serviceKey();
  if (!token) return json({ error: 'Sign in required.', code: 'AUTH_REQUIRED' }, 401, headers);
  if (![ownerId, url, key].every(Boolean)) return json({ error: 'CMS is not configured.', code: 'NOT_CONFIGURED' }, 503, headers);

  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: identity, error: authError } = await db.auth.getUser(token);
  if (authError || identity.user?.id !== ownerId) {
    return json({ error: 'Forbidden.', code: 'NOT_OWNER' }, 403, headers);
  }

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 200000) throw new Error('too large');
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid request.', code: 'INVALID_REQUEST' }, 400, headers);
  }
  if (!body || typeof body.action !== 'string') {
    return json({ error: 'Invalid request.', code: 'INVALID_REQUEST' }, 400, headers);
  }

  const action = body.action;
  const sensitive = new Set(['save_draft','archive_record','restore_version','request_media_upload','remove_staged_media','request_publication','cancel_publication']);
  if (sensitive.has(action)) {
    let claims: Record<string, unknown> = {};
    try {
      const segment = token.split('.')[1];
      claims = JSON.parse(atob(segment.replace(/-/g,'+').replace(/_/g,'/')));
    } catch {}
    if (claims.aal !== 'aal2' || !(Array.isArray(claims.amr) && claims.amr.some((entry: any) => entry?.method === 'totp'))) {
      return json({ error: 'MFA verification is required.', code: 'MFA_REQUIRED' }, 403, headers);
    }
  }

  if (action === 'dashboard_summary') {
    const { count: recordCount, error } = await db.from('cms_records').select('id', { count: 'exact', head: true });
    if (error) return json({ error: 'Could not load dashboard.', code: 'CMS_UNAVAILABLE' }, 503, headers);
    return json({ summary: { recordCount: recordCount || 0, draftCount: 0, unpublishedChanges: 0, publicationCount: 0 } }, 200, headers);
  }

  if (action === 'list_records') {
    const filter = typeof body.recordType === 'string' ? body.recordType : null;
    if (filter && !recordTypes.has(filter)) return json({ error: 'Unknown record type.', code: 'INVALID_RECORD_TYPE' }, 400, headers);
    let query = db.from('cms_records').select('id,record_type,record_key,publication_state,updated_at,published_commit_sha').order('updated_at', { ascending: false }).limit(500);
    if (filter) query = query.eq('record_type', filter);
    const { data, error } = await query;
    if (error) return json({ error: 'Could not list records.', code: 'CMS_UNAVAILABLE' }, 503, headers);
    return json({ records: data }, 200, headers);
  }

  if (action === 'get_record') {
    const id = typeof body.id === 'string' ? body.id : '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Invalid record ID.', code: 'INVALID_RECORD' }, 400, headers);
    const { data: record, error } = await db.from('cms_records').select('*, cms_record_versions(*)').eq('id', id).maybeSingle();
    if (error) return json({ error: 'Could not load record.', code: 'CMS_UNAVAILABLE' }, 503, headers);
    if (!record) return json({ error: 'Record not found.', code: 'NOT_FOUND' }, 404, headers);
    return json({ record }, 200, headers);
  }

  if (action === 'preview_record') {
    const payload = body.publicPayload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return json({ error: 'Invalid public projection.', code: 'INVALID_PREVIEW' }, 400, headers);
    }
    const forbidden = ['evidenceNotes','sourceReferences','ownerReviewStatus','internalNotes','supabase','auth','editorialMetadata'];
    if (Object.keys(payload).some(key => forbidden.includes(key))) {
      return json({ error: 'Private metadata is not allowed in previews.', code: 'PRIVATE_FIELD' }, 400, headers);
    }
    return json({ preview: payload }, 200, headers);
  }

  if (action === 'save_draft') {
    return json({ error: 'Draft editing is prepared but not yet configured for this live project.', code: 'NOT_READY' }, 501, headers);
  }
  if (action === 'archive_record' || action === 'restore_version') {
    return json({ error: 'This CMS action is prepared but not yet configured.', code: 'NOT_READY' }, 501, headers);
  }
  if (action === 'request_media_upload' || action === 'remove_staged_media') {
    return json({ error: 'Media management is prepared but not yet configured.', code: 'NOT_READY' }, 501, headers);
  }
  if (action === 'request_publication' || action === 'get_publication_status' || action === 'cancel_publication') {
    return json({ error: 'GitHub publishing is prepared but requires App credentials.', code: 'PUBLISHING_NOT_CONFIGURED' }, 501, headers);
  }
  return json({ error: 'Unknown action.', code: 'UNKNOWN_ACTION' }, 400, headers);
});
