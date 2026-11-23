import { corsHeaders, json } from './http.mjs';
import { hasImageSignature, validateCmsDraft } from './cms-validation.mjs';

const defaultOrigin = 'https://dkhilifares.github.io';
const recordTypes = new Set(['project','skill','experience','education','credential','achievement','article','profile','category']);
const sensitiveActions = new Set([
  'seed_public_baseline','save_draft','archive_record','restore_version','request_media_upload','complete_media_upload',
  'update_media_metadata','remove_staged_media','approve_media','request_publication','cancel_publication','reorder_records'
]);
const actionFields = {
  dashboard_summary: ['action'],
  list_records: ['action','recordType'],
  get_record: ['action','id'],
  preview_record: ['action','publicPayload'],
  seed_public_baseline: ['action','records'],
  save_draft: ['action','recordType','recordKey','expectedVersionId','publicPayload','editorialMetadata','changeSummary'],
  archive_record: ['action','id'],
  restore_version: ['action','id','versionId'],
  list_audit: ['action','limit'],
  list_media: ['action'],
  request_media_upload: ['action','fileName','contentType','size'],
  complete_media_upload: ['action','mediaId'],
  update_media_metadata: ['action','mediaId','altText','caption','recordId'],
  get_media_preview: ['action','mediaId'],
  remove_staged_media: ['action','mediaId'],
  approve_media: ['action','mediaId'],
  request_publication: ['action','id','versionId','approval','idempotencyKey'],
  get_publication_status: ['action','publicationId'],
  cancel_publication: ['action','publicationId'],
  reorder_records: ['action','recordType','expectedRecordIds','recordIds']
};
const privatePreviewKeys = new Set([
  'auth','email','editorialmetadata','editorial_metadata','evidencenotes',
  'internalnotes','ownerreviewstatus','sourcereferences','supabase'
]);
const maxBodyBytes = 200_000;
const mediaBucket = 'portfolio-media-private';
const publicMediaBucket = 'portfolio-media-public';
const mediaTypes = new Map([
  ['image/png','png'],
  ['image/jpeg','jpg'],
  ['image/webp','webp']
]);

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function getEnvReader(env) {
  return typeof env === 'function' ? env : key => env?.[key];
}

function allowedOrigins(getEnv) {
  return (getEnv('ALLOWED_ORIGINS') || getEnv('ALLOWED_ORIGIN') || defaultOrigin)
    .split(',').map(value => value.trim()).filter(value => {
      try {
        const origin = new URL(value);
        return (origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost','127.0.0.1'].includes(origin.hostname)))
          && origin.origin === value;
      } catch {
        return false;
      }
    });
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > maxBodyBytes) return { error: 'Request is too large.', status: 413 };
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return { error: 'Content-Type must be application/json.', status: 415 };
  }
  const reader = request.body?.getReader();
  if (!reader) return { error: 'Invalid request.', status: 400 };
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBodyBytes) {
        try {
          await reader.cancel();
        } catch {
          return { error: 'Request is too large.', status: 413 };
        }
        return { error: 'Request is too large.', status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { error: 'Invalid request.', status: 400 };
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { error: 'Invalid request.', status: 400 };
  }
}

function hasAal2Totp(token) {
  try {
    const segment = token.split('.')[1];
    if (!segment) return false;
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
    return claims.aal === 'aal2'
      && Array.isArray(claims.amr)
      && claims.amr.some(entry => entry === 'totp' || (entry && typeof entry === 'object' && entry.method === 'totp'));
  } catch {
    return false;
  }
}

function hasPrivatePreviewKey(value) {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
    } else if (current && typeof current === 'object') {
      for (const [key, child] of Object.entries(current)) {
        if (privatePreviewKeys.has(key.toLowerCase())) return true;
        pending.push(child);
      }
    }
  }
  return false;
}

function safeErrorCode(error) {
  return error && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'REQUEST_FAILED';
}

export function createPortfolioCmsHandler({ env, createClient, serviceKey, logger = console }) {
  const getEnv = getEnvReader(env);
  const origins = allowedOrigins(getEnv);

  return async request => {
    const origin = request.headers.get('origin') || '';
    const allowed = origins.includes(origin);
    const headers = corsHeaders(origin, allowed ? origin : origins[0] || '', 'POST, OPTIONS', 'authorization, content-type');
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers });
    if (!allowed) return json({ error: 'Forbidden.', code: 'FORBIDDEN' }, 403, headers);
    if (request.method !== 'POST') return json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }, 405, { ...headers, Allow: 'POST, OPTIONS' });

    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return json({ error: 'Sign in required.', code: 'AUTH_REQUIRED' }, 401, headers);
    const ownerId = getEnv('OWNER_USER_ID');
    const url = getEnv('SUPABASE_URL');
    const key = serviceKey();
    if (!ownerId || !url || !key) return json({ error: 'CMS is not configured.', code: 'NOT_CONFIGURED' }, 503, headers);

    let db;
    try {
      db = createClient(url, key, { auth: { persistSession: false } });
    } catch (error) {
      logger.error('CMS client initialization failed', safeErrorCode(error));
      return json({ error: 'CMS is temporarily unavailable.', code: 'CMS_UNAVAILABLE' }, 503, headers);
    }
    let identity;
    try {
      identity = await db.auth.getUser(token);
    } catch (error) {
      logger.error('CMS authentication lookup failed', safeErrorCode(error));
      return json({ error: 'Authentication service is temporarily unavailable.', code: 'AUTH_UNAVAILABLE' }, 503, headers);
    }
    if (identity.error) return json({ error: 'Sign in again to continue.', code: 'INVALID_TOKEN' }, 401, headers);
    if (identity.data.user?.id !== ownerId) return json({ error: 'Forbidden.', code: 'NOT_OWNER' }, 403, headers);

    const parsed = await readJson(request);
    if (parsed.error) return json({ error: parsed.error, code: parsed.status === 413 ? 'TOO_LARGE' : parsed.status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'INVALID_REQUEST' }, parsed.status, headers);
    const body = parsed.value;
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.action !== 'string') {
      return json({ error: 'Invalid request.', code: 'INVALID_REQUEST' }, 400, headers);
    }
    const permittedFields = actionFields[body.action];
    if (!permittedFields) return json({ error: 'Unknown action.', code: 'UNKNOWN_ACTION' }, 400, headers);
    if (Object.keys(body).some(field => !permittedFields.includes(field))) {
      return json({ error: 'Invalid request.', code: 'INVALID_REQUEST' }, 400, headers);
    }
    if (sensitiveActions.has(body.action) && !hasAal2Totp(token)) {
      return json({ error: 'MFA verification is required.', code: 'MFA_REQUIRED' }, 403, headers);
    }

    const actorId = identity.data.user.id;
    const logFailure = async (action, entityType, entityId, recordId, versionId, code) => {
      try {
        const { error } = await db.rpc('cms_log_operation_failure', {
          p_actor: actorId,
          p_action: action,
          p_entity_type: entityType,
          p_entity_id: entityId || null,
          p_record_id: recordId || null,
          p_publication_id: null,
          p_version_id: versionId || null,
          p_code: code
        });
        if (error) logger.error('CMS audit write failed', safeErrorCode(error));
      } catch (error) {
        logger.error('CMS audit write failed', safeErrorCode(error));
      }
    };

    if (body.action === 'dashboard_summary') {
      let records;
      let drafts;
      let publications;
      try {
        [records, drafts, publications] = await Promise.all([
          db.from('cms_records').select('id', { count: 'exact', head: true }),
          db.from('cms_records').select('id', { count: 'exact', head: true }).eq('publication_state', 'draft'),
          db.from('cms_publications').select('id', { count: 'exact', head: true })
        ]);
      } catch (error) {
        logger.error('CMS dashboard query failed', safeErrorCode(error));
        return json({ error: 'Could not load dashboard.', code: 'CMS_UNAVAILABLE' }, 503, headers);
      }
      if (records.error || drafts.error || publications.error
        || !Number.isInteger(records.count) || !Number.isInteger(drafts.count) || !Number.isInteger(publications.count)) {
        logger.error('CMS dashboard query failed', records.error?.code || drafts.error?.code || publications.error?.code || 'REQUEST_FAILED');
        return json({ error: 'Could not load dashboard.', code: 'CMS_UNAVAILABLE' }, 503, headers);
      }
      return json({ summary: {
        recordCount: records.count,
        draftCount: drafts.count,
        publicationCount: publications.count
      } }, 200, headers);
    }

    if (body.action === 'list_records') {
      const filter = typeof body.recordType === 'string' ? body.recordType : null;
      if (body.recordType !== undefined && (!filter || !recordTypes.has(filter))) {
        return json({ error: 'Unknown record type.', code: 'INVALID_RECORD_TYPE' }, 400, headers);
      }
      try {
        let query = db.from('cms_records').select('id,record_type,record_key,publication_state,collection_order,updated_at,published_commit_sha')
          .order('record_type', { ascending: true })
          .order('collection_order', { ascending: true }).limit(500);
        if (filter) query = query.eq('record_type', filter);
        const { data, error } = await query;
        if (error || !Array.isArray(data)) {
          logger.error('CMS record query failed', safeErrorCode(error));
          return json({ error: 'Could not list records.', code: 'CMS_UNAVAILABLE' }, 503, headers);
        }
        return json({ records: data }, 200, headers);
      } catch (error) {
        logger.error('CMS record query failed', safeErrorCode(error));
        return json({ error: 'Could not list records.', code: 'CMS_UNAVAILABLE' }, 503, headers);
      }
    }

    if (body.action === 'reorder_records') {
      if (!recordTypes.has(body.recordType) || !Array.isArray(body.recordIds)
        || !Array.isArray(body.expectedRecordIds)
        || body.recordIds.length > 500
        || body.expectedRecordIds.length > 500
        || body.recordIds.some(id => !isUuid(id))
        || body.expectedRecordIds.some(id => !isUuid(id))
        || new Set(body.recordIds).size !== body.recordIds.length) {
        return json({ error: 'Invalid record ordering.', code: 'INVALID_ORDER' }, 400, headers);
      }
      if (new Set(body.expectedRecordIds).size !== body.expectedRecordIds.length) {
        return json({ error: 'Invalid record ordering.', code: 'INVALID_ORDER' }, 400, headers);
      }
      try {
        const { data, error } = await db.rpc('cms_reorder_records', {
          p_actor: actorId,
          p_record_type: body.recordType,
          p_expected_record_ids: body.expectedRecordIds,
          p_record_ids: body.recordIds
        });
        if (error || data?.recordCount !== body.recordIds.length) {
          logger.error('CMS record ordering failed', safeErrorCode(error));
          await logFailure('records_reordered', 'record_collection', null, null, null, safeErrorCode(error));
          if (error?.code === '40001') {
            return json({ error: 'This collection changed in another session. Reload its latest order before trying again.', code: 'CMS_CONFLICT' }, 409, headers);
          }
          return json({ error: 'Record order could not be saved.', code: 'ORDER_SAVE_FAILED' }, 503, headers);
        }
        return json({ ordering: data }, 200, headers);
      } catch (error) {
        logger.error('CMS record ordering failed', safeErrorCode(error));
        await logFailure('records_reordered', 'record_collection', null, null, null, safeErrorCode(error));
        return json({ error: 'Record order could not be saved.', code: 'ORDER_SAVE_FAILED' }, 503, headers);
      }
    }

    if (body.action === 'get_record') {
      if (!isUuid(body.id)) {
        return json({ error: 'Invalid record ID.', code: 'INVALID_RECORD' }, 400, headers);
      }
      try {
        const { data: record, error } = await db.from('cms_records')
          .select('id,record_type,record_key,collection_order,draft_version_id,published_version_id,publication_state,published_commit_sha,created_at,updated_at,created_by,updated_by')
          .eq('id', body.id).maybeSingle();
        if (error) {
          logger.error('CMS record query failed', safeErrorCode(error));
          return json({ error: 'Could not load record.', code: 'CMS_UNAVAILABLE' }, 503, headers);
        }
        if (!record) return json({ error: 'Record not found.', code: 'NOT_FOUND' }, 404, headers);
        const { data: versions, error: versionsError } = await db.from('cms_record_versions')
          .select('id,version_number,public_payload,editorial_metadata,change_summary,created_at,created_by')
          .eq('record_id', body.id).order('version_number', { ascending: false }).limit(100);
        if (versionsError || !Array.isArray(versions)) {
          logger.error('CMS version query failed', safeErrorCode(versionsError));
          return json({ error: 'Could not load record history.', code: 'CMS_UNAVAILABLE' }, 503, headers);
        }
        return json({ record: { ...record, versions } }, 200, headers);
      } catch (error) {
        logger.error('CMS record query failed', safeErrorCode(error));
        return json({ error: 'Could not load record.', code: 'CMS_UNAVAILABLE' }, 503, headers);
      }
    }

    if (body.action === 'preview_record') {
      const payload = body.publicPayload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return json({ error: 'Invalid public projection.', code: 'INVALID_PREVIEW' }, 400, headers);
      }
      if (hasPrivatePreviewKey(payload)) {
        return json({ error: 'Private metadata is not allowed in previews.', code: 'PRIVATE_FIELD' }, 400, headers);
      }
      return json({ preview: payload }, 200, headers);
    }

    if (body.action === 'seed_public_baseline') {
      if (!Array.isArray(body.records) || body.records.length > 250) {
        return json({ error: 'Invalid public content baseline.', code: 'INVALID_BASELINE' }, 400, headers);
      }
      const records = [];
      const seenRecords = new Set();
      const positionsByType = new Map();
      const references = {
        categories: new Set(body.records.filter(item => item?.recordType === 'category').map(item => item.recordKey)),
        projects: new Set(body.records.filter(item => item?.recordType === 'project').map(item => item.recordKey)),
        experience: new Set(body.records.filter(item => item?.recordType === 'experience').map(item => item.recordKey))
      };
      for (const item of body.records) {
        const validated = validateCmsDraft(item, { forceDraft: false, references });
        if (validated.error || (validated.value.publicPayload.visibility !== undefined
          && validated.value.publicPayload.visibility !== 'published')) {
          return json({ error: 'Only valid, already-published public content can be imported.', code: 'INVALID_BASELINE' }, 400, headers);
        }
        const recordIdentity = `${validated.value.recordType}:${validated.value.recordKey}`;
        if (seenRecords.has(recordIdentity)) {
          return json({ error: 'Public baseline contains duplicate records.', code: 'INVALID_BASELINE' }, 400, headers);
        }
        seenRecords.add(recordIdentity);
        if (!Number.isInteger(item.collectionOrder) || item.collectionOrder < 0
          || item.collectionOrder >= body.records.length) {
          return json({ error: 'Public baseline has invalid collection order.', code: 'INVALID_BASELINE' }, 400, headers);
        }
        const positions = positionsByType.get(validated.value.recordType) || new Set();
        if (positions.has(item.collectionOrder)) {
          return json({ error: 'Public baseline contains duplicate collection positions.', code: 'INVALID_BASELINE' }, 400, headers);
        }
        positions.add(item.collectionOrder);
        positionsByType.set(validated.value.recordType, positions);
        records.push({
          recordType: validated.value.recordType,
          recordKey: validated.value.recordKey,
          collectionOrder: item.collectionOrder,
          publicPayload: validated.value.publicPayload
        });
      }
      for (const positions of positionsByType.values()) {
        if (positions.size !== Math.max(...positions) + 1
          || [...positions].some(position => !Number.isInteger(position))) {
          return json({ error: 'Public baseline collection order must be contiguous from zero.', code: 'INVALID_BASELINE' }, 400, headers);
        }
      }
      try {
        const { data, error } = await db.rpc('cms_seed_public_baseline', {
          p_actor: actorId,
          p_records: records
        });
        if (error || !Number.isInteger(data?.inserted) || !Number.isInteger(data?.skipped)) {
          logger.error('CMS public baseline import failed', safeErrorCode(error));
          await logFailure('public_baseline_imported', 'record', null, null, null, safeErrorCode(error));
          return json({ error: 'Public baseline could not be imported.', code: 'BASELINE_IMPORT_FAILED' }, 503, headers);
        }
        return json({ baseline: data }, 200, headers);
      } catch (error) {
        logger.error('CMS public baseline import failed', safeErrorCode(error));
        await logFailure('public_baseline_imported', 'record', null, null, null, safeErrorCode(error));
        return json({ error: 'Public baseline could not be imported.', code: 'BASELINE_IMPORT_FAILED' }, 503, headers);
      }
    }

    if (body.action === 'save_draft') {
      const validated = validateCmsDraft(body);
      if (validated.error) return json({ error: validated.error, code: 'INVALID_DRAFT' }, 400, headers);
      if (body.expectedVersionId !== undefined && body.expectedVersionId !== null && !isUuid(body.expectedVersionId)) {
        return json({ error: 'Invalid expected version ID.', code: 'INVALID_VERSION' }, 400, headers);
      }
      try {
        const { data, error } = await db.rpc('cms_save_draft', {
          p_actor: actorId,
          p_record_type: validated.value.recordType,
          p_record_key: validated.value.recordKey,
          p_expected_version_id: body.expectedVersionId || null,
          p_public_payload: validated.value.publicPayload,
          p_editorial_metadata: validated.value.editorialMetadata,
          p_change_summary: validated.value.changeSummary
        });
        if (error || !data?.id || !data?.versionId) {
          logger.error('CMS draft save failed', safeErrorCode(error));
          await logFailure('draft_saved', 'record', null, null, null, safeErrorCode(error));
          if (error?.code === '40001') {
            return json({ error: 'This record changed in another session. Reload its latest version before saving.', code: 'CMS_CONFLICT' }, 409, headers);
          }
          return json({ error: 'Draft could not be saved.', code: 'DRAFT_SAVE_FAILED' }, 503, headers);
        }
        return json({ record: data }, 200, headers);
      } catch (error) {
        logger.error('CMS draft save failed', safeErrorCode(error));
        await logFailure('draft_saved', 'record', null, null, null, safeErrorCode(error));
        return json({ error: 'Draft could not be saved.', code: 'DRAFT_SAVE_FAILED' }, 503, headers);
      }
    }

    if (body.action === 'archive_record') {
      if (!isUuid(body.id)) return json({ error: 'Invalid record ID.', code: 'INVALID_RECORD' }, 400, headers);
      try {
        const { data, error } = await db.rpc('cms_archive_record', { p_actor: actorId, p_record_id: body.id });
        if (error || !data?.id) {
          logger.error('CMS archive failed', safeErrorCode(error));
          await logFailure('record_archived', 'record', body.id, body.id, null, safeErrorCode(error));
          return json({ error: 'Record could not be archived.', code: 'ARCHIVE_FAILED' }, 503, headers);
        }
        return json({ record: data }, 200, headers);
      } catch (error) {
        logger.error('CMS archive failed', safeErrorCode(error));
        await logFailure('record_archived', 'record', body.id, body.id, null, safeErrorCode(error));
        return json({ error: 'Record could not be archived.', code: 'ARCHIVE_FAILED' }, 503, headers);
      }
    }

    if (body.action === 'restore_version') {
      if (!isUuid(body.id) || !isUuid(body.versionId)) {
        return json({ error: 'Invalid record or version ID.', code: 'INVALID_VERSION' }, 400, headers);
      }
      try {
        const { data, error } = await db.rpc('cms_restore_version', {
          p_actor: actorId, p_record_id: body.id, p_version_id: body.versionId
        });
        if (error || !data?.versionId) {
          logger.error('CMS version restore failed', safeErrorCode(error));
          await logFailure('version_restored', 'record', body.id, body.id, body.versionId, safeErrorCode(error));
          return json({ error: 'Version could not be restored.', code: 'RESTORE_FAILED' }, 503, headers);
        }
        return json({ record: data }, 200, headers);
      } catch (error) {
        logger.error('CMS version restore failed', safeErrorCode(error));
        await logFailure('version_restored', 'record', body.id, body.id, body.versionId, safeErrorCode(error));
        return json({ error: 'Version could not be restored.', code: 'RESTORE_FAILED' }, 503, headers);
      }
    }

    if (body.action === 'list_audit') {
      const limit = body.limit === undefined ? 50 : body.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return json({ error: 'Invalid audit page size.', code: 'INVALID_LIMIT' }, 400, headers);
      }
      try {
        const { data, error } = await db.from('cms_audit_events')
          .select('id,actor_user_id,record_id,publication_id,action,version_id,outcome,created_at,entity_type,entity_id,metadata')
          .order('created_at', { ascending: false }).limit(limit);
        if (error || !Array.isArray(data)) {
          logger.error('CMS audit query failed', safeErrorCode(error));
          return json({ error: 'Could not load audit history.', code: 'CMS_UNAVAILABLE' }, 503, headers);
        }
        return json({ events: data }, 200, headers);
      } catch (error) {
        logger.error('CMS audit query failed', safeErrorCode(error));
        return json({ error: 'Could not load audit history.', code: 'CMS_UNAVAILABLE' }, 503, headers);
      }
    }

    if (body.action === 'list_media') {
      try {
        const { data, error } = await db.from('cms_media_assets')
          .select('id,object_path,published_object_path,original_name,content_type,size_bytes,upload_state,alt_text,caption,record_id,created_at,updated_at')
          .order('created_at', { ascending: false }).limit(100);
        if (error || !Array.isArray(data)) {
          logger.error('CMS media query failed', safeErrorCode(error));
          return json({ error: 'Could not load media.', code: 'CMS_UNAVAILABLE' }, 503, headers);
        }
        return json({ media: data }, 200, headers);
      } catch (error) {
        logger.error('CMS media query failed', safeErrorCode(error));
        return json({ error: 'Could not load media.', code: 'CMS_UNAVAILABLE' }, 503, headers);
      }
    }

    if (body.action === 'request_media_upload') {
      const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
      const contentType = body.contentType;
      const extension = fileName.split('.').pop()?.toLowerCase() || '';
      const expectedType = extension === 'jpeg' ? 'image/jpeg' : ({
        png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp'
      })[extension];
      if (!fileName || fileName.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(fileName)
        || !mediaTypes.has(contentType)
        || expectedType !== contentType || !Number.isInteger(body.size) || body.size < 1 || body.size > 10_485_760) {
        return json({ error: 'Choose a PNG, JPEG, or WebP image up to 10 MiB.', code: 'INVALID_MEDIA' }, 400, headers);
      }
      const objectPath = `pending/${crypto.randomUUID()}.${mediaTypes.get(contentType)}`;
      try {
        const { data: signed, error: signingError } = await db.storage.from(mediaBucket)
          .createSignedUploadUrl(objectPath, { upsert: false });
        if (signingError || !signed?.token) {
          logger.error('CMS signed upload request failed', safeErrorCode(signingError));
          await logFailure('media_upload_requested', 'media', null, null, null, safeErrorCode(signingError));
          return json({ error: 'Could not prepare a private upload.', code: 'MEDIA_UPLOAD_FAILED' }, 503, headers);
        }
        const { data: asset, error: registerError } = await db.rpc('cms_register_media_asset', {
          p_actor: actorId,
          p_object_path: objectPath,
          p_original_name: fileName,
          p_content_type: contentType,
          p_size_bytes: body.size
        });
        if (registerError || !asset?.id) {
          logger.error('CMS media registration failed', safeErrorCode(registerError));
          await logFailure('media_upload_requested', 'media', null, null, null, safeErrorCode(registerError));
          return json({ error: 'Could not register the private upload.', code: 'MEDIA_UPLOAD_FAILED' }, 503, headers);
        }
        return json({
          upload: { id: asset.id, bucket: mediaBucket, objectPath, token: signed.token }
        }, 200, headers);
      } catch (error) {
        logger.error('CMS signed upload request failed', safeErrorCode(error));
        await logFailure('media_upload_requested', 'media', null, null, null, safeErrorCode(error));
        return json({ error: 'Could not prepare a private upload.', code: 'MEDIA_UPLOAD_FAILED' }, 503, headers);
      }
    }

    if (body.action === 'complete_media_upload') {
      if (!isUuid(body.mediaId)) return json({ error: 'Invalid media ID.', code: 'INVALID_MEDIA' }, 400, headers);
      try {
        const { data: asset, error: assetError } = await db.from('cms_media_assets')
          .select('id,object_path,content_type,size_bytes,upload_state')
          .eq('id', body.mediaId).maybeSingle();
        if (assetError || !asset) {
          logger.error('CMS media lookup failed', safeErrorCode(assetError));
          return json({ error: 'Media upload could not be verified.', code: 'MEDIA_UPLOAD_FAILED' }, 503, headers);
        }
        if (asset.upload_state === 'ready') return json({ ok: true }, 200, headers);
        const { data: file, error: storageError } = await db.storage.from(mediaBucket).download(asset.object_path);
        const signature = file ? new Uint8Array(await file.slice(0, 12).arrayBuffer()) : new Uint8Array();
        if (storageError || !file || file.size !== Number(asset.size_bytes) || file.size > 10_485_760
          || !hasImageSignature(signature, asset.content_type)) {
          logger.error('CMS media upload verification failed', safeErrorCode(storageError));
          await logFailure('media_upload_completed', 'media', body.mediaId, null, null, safeErrorCode(storageError));
          return json({ error: 'Uploaded file did not match its approved image signature and size.', code: 'MEDIA_UPLOAD_INVALID' }, 400, headers);
        }
        const { data, error } = await db.rpc('cms_complete_media_asset', {
          p_actor: actorId, p_asset_id: body.mediaId
        });
        if (error || !data?.id) {
          logger.error('CMS media completion failed', safeErrorCode(error));
          await logFailure('media_upload_completed', 'media', body.mediaId, null, null, safeErrorCode(error));
          return json({ error: 'Media upload could not be completed.', code: 'MEDIA_UPLOAD_FAILED' }, 503, headers);
        }
        return json({ ok: true }, 200, headers);
      } catch (error) {
        logger.error('CMS media completion failed', safeErrorCode(error));
        await logFailure('media_upload_completed', 'media', body.mediaId, null, null, safeErrorCode(error));
        return json({ error: 'Media upload could not be completed.', code: 'MEDIA_UPLOAD_FAILED' }, 503, headers);
      }
    }

    if (body.action === 'update_media_metadata') {
      if (!isUuid(body.mediaId)
        || (body.recordId !== undefined && body.recordId !== null && !isUuid(body.recordId))
        || (body.altText !== undefined && (typeof body.altText !== 'string' || body.altText.trim().length > 300))
        || (body.caption !== undefined && (typeof body.caption !== 'string' || body.caption.trim().length > 1000))) {
        return json({ error: 'Invalid media metadata.', code: 'INVALID_MEDIA' }, 400, headers);
      }
      try {
        const { data, error } = await db.rpc('cms_update_media_metadata', {
          p_actor: actorId,
          p_asset_id: body.mediaId,
          p_alt_text: (body.altText || '').trim(),
          p_caption: (body.caption || '').trim(),
          p_record_id: body.recordId || null
        });
        if (error || !data?.id) {
          logger.error('CMS media metadata update failed', safeErrorCode(error));
          await logFailure('media_metadata_updated', 'media', body.mediaId, body.recordId, null, safeErrorCode(error));
          return json({ error: 'Media metadata could not be saved.', code: 'MEDIA_UPDATE_FAILED' }, 503, headers);
        }
        return json({ media: data }, 200, headers);
      } catch (error) {
        logger.error('CMS media metadata update failed', safeErrorCode(error));
        await logFailure('media_metadata_updated', 'media', body.mediaId, body.recordId, null, safeErrorCode(error));
        return json({ error: 'Media metadata could not be saved.', code: 'MEDIA_UPDATE_FAILED' }, 503, headers);
      }
    }

    if (body.action === 'get_media_preview') {
      if (!isUuid(body.mediaId)) return json({ error: 'Invalid media ID.', code: 'INVALID_MEDIA' }, 400, headers);
      try {
        const { data: asset, error } = await db.from('cms_media_assets')
          .select('object_path,published_object_path,upload_state')
          .eq('id', body.mediaId).maybeSingle();
        if (error || !asset || asset.upload_state !== 'ready') {
          logger.error('CMS media preview lookup failed', safeErrorCode(error));
          return json({ error: 'Media preview is unavailable.', code: 'MEDIA_PREVIEW_FAILED' }, 404, headers);
        }
        if (asset.published_object_path) {
          const { data } = db.storage.from(publicMediaBucket).getPublicUrl(asset.published_object_path);
          return json({ url: data.publicUrl, visibility: 'public' }, 200, headers);
        }
        const { data: signed, error: signingError } = await db.storage.from(mediaBucket)
          .createSignedUrl(asset.object_path, 120);
        if (signingError || !signed?.signedUrl) {
          logger.error('CMS media preview signing failed', safeErrorCode(signingError));
          return json({ error: 'Media preview is unavailable.', code: 'MEDIA_PREVIEW_FAILED' }, 503, headers);
        }
        return json({ url: signed.signedUrl, visibility: 'private' }, 200, headers);
      } catch (error) {
        logger.error('CMS media preview failed', safeErrorCode(error));
        return json({ error: 'Media preview is unavailable.', code: 'MEDIA_PREVIEW_FAILED' }, 503, headers);
      }
    }

    if (body.action === 'approve_media') {
      if (!isUuid(body.mediaId)) return json({ error: 'Invalid media ID.', code: 'INVALID_MEDIA' }, 400, headers);
      let publicPath = '';
      try {
        const { data: asset, error: assetError } = await db.from('cms_media_assets')
          .select('id,object_path,published_object_path,content_type,size_bytes,upload_state,alt_text,caption')
          .eq('id', body.mediaId).maybeSingle();
        if (assetError || !asset || asset.upload_state !== 'ready') {
          logger.error('CMS media approval lookup failed', safeErrorCode(assetError));
          return json({ error: 'Only a verified private upload can be approved.', code: 'INVALID_MEDIA' }, 400, headers);
        }
        if (asset.published_object_path) return json({ error: 'Media is already public.', code: 'ALREADY_PUBLISHED' }, 409, headers);
        if (!asset.alt_text.trim() || !asset.caption.trim()) {
          return json({ error: 'Add alt text and a provenance caption before public approval.', code: 'MEDIA_METADATA_REQUIRED' }, 400, headers);
        }
        const { data: downloaded, error: downloadError } = await db.storage.from(mediaBucket).download(asset.object_path);
        const signature = downloaded ? new Uint8Array(await downloaded.slice(0, 12).arrayBuffer()) : new Uint8Array();
        if (downloadError || !downloaded || downloaded.size !== Number(asset.size_bytes)
          || !hasImageSignature(signature, asset.content_type)) {
          logger.error('CMS private media read failed', safeErrorCode(downloadError));
          return json({ error: 'Private media could not be verified.', code: 'MEDIA_READ_FAILED' }, 503, headers);
        }
        const extension = mediaTypes.get(asset.content_type);
        publicPath = `approved/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await db.storage.from(publicMediaBucket).upload(publicPath, downloaded, {
          contentType: asset.content_type, cacheControl: '31536000', upsert: false
        });
        if (uploadError) {
          logger.error('CMS public media upload failed', safeErrorCode(uploadError));
          await logFailure('media_approved_public', 'media', body.mediaId, null, null, safeErrorCode(uploadError));
          return json({ error: 'Media could not be approved for public use.', code: 'MEDIA_APPROVAL_FAILED' }, 503, headers);
        }
        const { data, error } = await db.rpc('cms_publish_media_asset', {
          p_actor: actorId, p_asset_id: body.mediaId, p_published_object_path: publicPath
        });
        if (error || !data?.id) {
          logger.error('CMS public media registration failed', safeErrorCode(error));
          const { error: cleanupError } = await db.storage.from(publicMediaBucket).remove([publicPath]);
          if (cleanupError) logger.error('CMS orphaned public media cleanup failed', safeErrorCode(cleanupError));
          await logFailure('media_approved_public', 'media', body.mediaId, null, null, safeErrorCode(error));
          return json({ error: 'Media could not be approved for public use.', code: 'MEDIA_APPROVAL_FAILED' }, 503, headers);
        }
        const { data: publicUrl } = db.storage.from(publicMediaBucket).getPublicUrl(publicPath);
        return json({ media: { id: data.id, publicUrl: publicUrl.publicUrl } }, 200, headers);
      } catch (error) {
        logger.error('CMS media approval failed', safeErrorCode(error));
        if (publicPath) {
          try {
            const { error: cleanupError } = await db.storage.from(publicMediaBucket).remove([publicPath]);
            if (cleanupError) logger.error('CMS orphaned public media cleanup failed', safeErrorCode(cleanupError));
          } catch (cleanupError) {
            logger.error('CMS orphaned public media cleanup failed', safeErrorCode(cleanupError));
          }
        }
        await logFailure('media_approved_public', 'media', body.mediaId, null, null, safeErrorCode(error));
        return json({ error: 'Media could not be approved for public use.', code: 'MEDIA_APPROVAL_FAILED' }, 503, headers);
      }
    }

    if (body.action === 'remove_staged_media') {
      if (!isUuid(body.mediaId)) return json({ error: 'Invalid media ID.', code: 'INVALID_MEDIA' }, 400, headers);
      try {
        const { data: asset, error: assetError } = await db.from('cms_media_assets')
          .select('id,object_path,published_object_path')
          .eq('id', body.mediaId).maybeSingle();
        if (assetError || !asset) {
          logger.error('CMS media deletion lookup failed', safeErrorCode(assetError));
          return json({ error: 'Media could not be removed.', code: 'MEDIA_REMOVE_FAILED' }, 503, headers);
        }
        if (asset.published_object_path) {
          return json({ error: 'Public media cannot be removed through staged-media cleanup.', code: 'MEDIA_ALREADY_PUBLIC' }, 409, headers);
        }
        const { error: storageError } = await db.storage.from(mediaBucket).remove([asset.object_path]);
        if (storageError) {
          logger.error('CMS private media deletion failed', safeErrorCode(storageError));
          return json({ error: 'Media could not be removed.', code: 'MEDIA_REMOVE_FAILED' }, 503, headers);
        }
        const { data, error } = await db.rpc('cms_delete_media_asset', {
          p_actor: actorId, p_asset_id: body.mediaId
        });
        if (error || !data?.removed) {
          logger.error('CMS media metadata deletion failed', safeErrorCode(error));
          await logFailure('media_removed', 'media', body.mediaId, null, null, safeErrorCode(error));
          return json({ error: 'Media could not be removed.', code: 'MEDIA_REMOVE_FAILED' }, 503, headers);
        }
        return json({ ok: true }, 200, headers);
      } catch (error) {
        logger.error('CMS media removal failed', safeErrorCode(error));
        await logFailure('media_removed', 'media', body.mediaId, null, null, safeErrorCode(error));
        return json({ error: 'Media could not be removed.', code: 'MEDIA_REMOVE_FAILED' }, 503, headers);
      }
    }

    if (body.action === 'request_publication') {
      if (!isUuid(body.id) || !isUuid(body.versionId) || !isUuid(body.idempotencyKey) || body.approval !== true) {
        return json({ error: 'Explicit approval and valid IDs are required.', code: 'INVALID_PUBLICATION' }, 400, headers);
      }
      const configured = Boolean(getEnv('GITHUB_APP_ID') && getEnv('GITHUB_APP_PRIVATE_KEY')
        && getEnv('GITHUB_INSTALLATION_ID') && getEnv('GITHUB_REPOSITORY_OWNER') && getEnv('GITHUB_REPOSITORY_NAME'));
      const failureCode = configured ? 'PUBLISHER_NOT_IMPLEMENTED' : 'GITHUB_APP_NOT_CONFIGURED';
      try {
        const { data: publication, error } = await db.rpc('cms_request_publication', {
          p_actor: actorId,
          p_record_id: body.id,
          p_version_id: body.versionId,
          p_idempotency_key: body.idempotencyKey,
          p_failure_code: failureCode
        });
        if (error || !publication?.id || publication.status !== 'failed') {
          logger.error('CMS publication attempt could not be recorded', safeErrorCode(error));
          await logFailure('publication_requested', 'record', body.id, body.id, body.versionId, safeErrorCode(error));
          return json({ error: 'Publication attempt could not be recorded.', code: 'PUBLICATION_RECORD_FAILED' }, 503, headers);
        }
        return json({
          error: configured
            ? 'GitHub publishing is not implemented; no public change was made.'
            : 'GitHub App configuration is required; no public change was made.',
          code: failureCode,
          publication
        }, 503, headers);
      } catch (error) {
        logger.error('CMS publication attempt failed', safeErrorCode(error));
        await logFailure('publication_requested', 'record', body.id, body.id, body.versionId, safeErrorCode(error));
        return json({ error: 'Publication attempt could not be recorded.', code: 'PUBLICATION_RECORD_FAILED' }, 503, headers);
      }
    }

    if (body.action === 'get_publication_status') {
      if (!isUuid(body.publicationId)) return json({ error: 'Invalid publication ID.', code: 'INVALID_PUBLICATION' }, 400, headers);
      try {
        const { data, error } = await db.from('cms_publications')
          .select('id,record_id,record_version_id,status,branch_name,pull_request_number,head_sha,merge_commit_sha,workflow_run_id,deployment_url,failure_code,created_at,updated_at')
          .eq('id', body.publicationId).maybeSingle();
        if (error) {
          logger.error('CMS publication lookup failed', safeErrorCode(error));
          return json({ error: 'Could not load publication status.', code: 'CMS_UNAVAILABLE' }, 503, headers);
        }
        if (!data) return json({ error: 'Publication attempt not found.', code: 'NOT_FOUND' }, 404, headers);
        return json({ publication: data }, 200, headers);
      } catch (error) {
        logger.error('CMS publication lookup failed', safeErrorCode(error));
        return json({ error: 'Could not load publication status.', code: 'CMS_UNAVAILABLE' }, 503, headers);
      }
    }

    if (body.action === 'cancel_publication') {
      if (!isUuid(body.publicationId)) return json({ error: 'Invalid publication ID.', code: 'INVALID_PUBLICATION' }, 400, headers);
      try {
        const { data, error } = await db.rpc('cms_cancel_publication', {
          p_actor: actorId, p_publication_id: body.publicationId
        });
        if (error) {
          logger.error('CMS publication cancellation failed', safeErrorCode(error));
          await logFailure('publication_cancelled', 'publication', body.publicationId, null, null, safeErrorCode(error));
          return json({ error: 'Publication could not be cancelled.', code: 'PUBLICATION_CANCEL_FAILED' }, 503, headers);
        }
        if (!data?.cancelled) return json({ error: 'Publication is no longer cancellable.', code: 'PUBLICATION_NOT_CANCELLABLE' }, 409, headers);
        return json({ publication: data }, 200, headers);
      } catch (error) {
        logger.error('CMS publication cancellation failed', safeErrorCode(error));
        await logFailure('publication_cancelled', 'publication', body.publicationId, null, null, safeErrorCode(error));
        return json({ error: 'Publication could not be cancelled.', code: 'PUBLICATION_CANCEL_FAILED' }, 503, headers);
      }
    }

    return json({ error: 'Unknown action.', code: 'UNKNOWN_ACTION' }, 400, headers);
  };
}
