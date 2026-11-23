import { corsHeaders, json } from './http.mjs';
import { alertSlot, hashClientAddress, rateLimitWindow, validateMessage } from './message.mjs';

const defaultOrigin = 'https://dkhilifares.github.io';
const maxMessageBytes = 12000;

function getEnvReader(env) {
  return typeof env === 'function' ? env : key => env?.[key];
}

function allowedOrigins(getEnv) {
  return (getEnv('ALLOWED_ORIGINS') || getEnv('ALLOWED_ORIGIN') || defaultOrigin)
    .split(',').map(origin => origin.trim()).filter(origin => {
      try {
        const parsed = new URL(origin);
        return ['https:','http:'].includes(parsed.protocol) && parsed.origin === origin;
      } catch {
        return false;
      }
    });
}

function requestContext(request, origins, methods, requestHeaders) {
  const origin = request.headers.get('origin') || '';
  const allowed = origins.includes(origin);
  return { allowed, headers: corsHeaders(origin, allowed ? origin : origins[0] || '', methods, requestHeaders) };
}

async function readJson(request, maxBytes) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) return { error: 'Request is too large.', status: 413 };
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
      if (totalBytes > maxBytes) {
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
  const raw = new TextDecoder().decode(bytes);
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return { error: 'Invalid request.', status: 400 };
  }
}

export function createSubmitMessageHandler({
  env,
  createClient,
  serviceKey,
  fetchImpl = fetch,
  now = () => Date.now(),
  logger = console
}) {
  const getEnv = getEnvReader(env);
  const origins = allowedOrigins(getEnv);

  return async request => {
    const { allowed, headers } = requestContext(request, origins, 'POST, OPTIONS', 'content-type');
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers });
    if (!allowed) return json({ error: 'Forbidden.' }, 403, headers);
    if (request.method !== 'POST') return json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }, 405, { ...headers, Allow: 'POST, OPTIONS' });

    const parsed = await readJson(request, maxMessageBytes);
    if (parsed.error) {
      const code = parsed.status === 413 ? 'TOO_LARGE' : parsed.status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'INVALID_REQUEST';
      return json({ error: parsed.error, code }, parsed.status, headers);
    }
    const message = validateMessage(parsed.value);
    if (message.trap) return json({ error: 'Unable to accept this message.', code: 'REJECTED' }, 400, headers);
    if (message.error) return json({ error: message.error, code: 'INVALID_MESSAGE' }, 400, headers);

    const supabaseUrl = getEnv('SUPABASE_URL');
    const key = serviceKey();
    if (!supabaseUrl || !key) return json({ error: 'Message service is not configured.', code: 'NOT_CONFIGURED' }, 503, headers);

    const db = createClient(supabaseUrl, key, { auth: { persistSession: false } });
    const forwarded = request.headers.get('cf-connecting-ip')
      || request.headers.get('x-real-ip')
      || request.headers.get('x-forwarded-for')?.split(',').pop()?.trim()
      || `email:${message.email}`;
    const { data: permitted, error: rateError } = await db.rpc('consume_portfolio_message_rate_limit', {
      p_rate_key: await hashClientAddress(forwarded),
      p_window_start: rateLimitWindow(now()),
      p_max_requests: 5
    });
    if (rateError) {
      logger.error('Message rate limiter unavailable', rateError.code);
      return json({ error: 'Message service is temporarily unavailable. Please try again later.', code: 'RATE_LIMIT_UNAVAILABLE' }, 503, headers);
    }
    if (permitted !== true) return json({ error: 'Too many messages were sent from this connection. Please try again in 15 minutes.', code: 'RATE_LIMITED' }, 429, headers);

    const turnstileSecret = getEnv('TURNSTILE_SECRET_KEY');
    if (turnstileSecret) {
      if (!message.token) return json({ error: 'Complete the security check before sending.', code: 'SECURITY_CHECK_REQUIRED' }, 400, headers);
      let verification;
      try {
        const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: turnstileSecret, response: message.token })
        });
        if (!response.ok) throw new Error('Verification service unavailable');
        verification = await response.json();
      } catch {
        return json({ error: 'Security check is temporarily unavailable. Please try again.', code: 'SECURITY_CHECK_UNAVAILABLE' }, 503, headers);
      }
      if (!verification?.success || verification.hostname !== new URL(request.headers.get('origin')).hostname) {
        return json({ error: 'Security check failed. Please retry.', code: 'SECURITY_CHECK_FAILED' }, 403, headers);
      }
    }

    const { data: stored, error: insertError } = await db.from('portfolio_messages')
      .insert({ sender_name: message.name, sender_email: message.email, subject: message.subject, body: message.body })
      .select('id')
      .single();
    if (insertError || !stored?.id) {
      logger.error('Inbox insert failed', insertError?.code || 'NO_ROW_RETURNED');
      return json({ error: 'Message could not be stored. Please try again later.', code: 'STORAGE_FAILED' }, 503, headers);
    }

    const resendKey = getEnv('RESEND_API_KEY');
    const notifyTo = getEnv('NOTIFY_TO');
    const notifyFrom = getEnv('NOTIFY_FROM');
    if (resendKey && notifyTo && notifyFrom) {
      const { error: slotError } = await db.from('portfolio_alert_slots').insert({ slot: alertSlot(now()) });
      if (!slotError) {
        try {
          const ownerUrl = getEnv('OWNER_PORTAL_URL');
          const response = await fetchImpl('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: notifyFrom,
              to: [notifyTo],
              subject: 'New portfolio message',
              text: `A new message is waiting in your private portfolio inbox.${ownerUrl ? ` Sign in: ${ownerUrl}` : ''}`
            })
          });
          if (!response.ok) logger.error('Inbox alert failed', response.status);
        } catch {
          logger.error('Inbox alert unavailable');
        }
      } else if (slotError.code !== '23505') {
        logger.error('Inbox alert slot failed', slotError.code);
      }
    }
    return json({ ok: true }, 201, headers);
  };
}

export function createOwnerMessagesHandler({ env, createClient, serviceKey, logger = console }) {
  const getEnv = getEnvReader(env);
  const origins = allowedOrigins(getEnv);

  return async request => {
    const { allowed, headers } = requestContext(request, origins, 'GET, POST, OPTIONS', 'authorization, content-type');
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers });
    if (!allowed) return json({ error: 'Forbidden.', code: 'FORBIDDEN' }, 403, headers);
    if (!['GET','POST'].includes(request.method)) return json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }, 405, { ...headers, Allow: 'GET, POST, OPTIONS' });

    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return json({ error: 'Sign in required.', code: 'AUTH_REQUIRED' }, 401, headers);
    const ownerId = getEnv('OWNER_USER_ID');
    const supabaseUrl = getEnv('SUPABASE_URL');
    const key = serviceKey();
    if (!ownerId || !supabaseUrl || !key) return json({ error: 'Inbox is not configured.', code: 'NOT_CONFIGURED' }, 503, headers);

    const db = createClient(supabaseUrl, key, { auth: { persistSession: false } });
    let identity;
    let authError;
    try {
      ({ data: identity, error: authError } = await db.auth.getUser(token));
    } catch (error) {
      logger.error('Inbox authentication lookup failed', error && typeof error.code === 'string' ? error.code : 'AUTH_FAILED');
      return json({ error: 'Authentication service is temporarily unavailable.', code: 'AUTH_UNAVAILABLE' }, 503, headers);
    }
    if (authError || !identity?.user) {
      const invalidToken = !identity?.user || authError?.status === 401
        || ['bad_jwt','invalid_jwt','jwt_expired','INVALID_TOKEN'].includes(authError?.code);
      logger.error('Inbox authentication lookup failed', authError?.code || 'INVALID_TOKEN');
      return invalidToken
        ? json({ error: 'Sign in again to continue.', code: 'INVALID_TOKEN' }, 401, headers)
        : json({ error: 'Authentication service is temporarily unavailable.', code: 'AUTH_UNAVAILABLE' }, 503, headers);
    }
    if (identity.user.id !== ownerId) return json({ error: 'Forbidden.', code: 'NOT_OWNER' }, 403, headers);

    if (request.method === 'GET') {
      const [inboxResult, unreadResult] = await Promise.all([
        db.from('portfolio_messages')
          .select('id,created_at,sender_name,sender_email,subject,body,state')
          .order('created_at', { ascending: false }).limit(100),
        db.from('portfolio_messages')
          .select('id', { count: 'exact', head: true })
          .eq('state', 'unread')
      ]);
      if (inboxResult.error || unreadResult.error || !Array.isArray(inboxResult.data) || !Number.isInteger(unreadResult.count)) {
        logger.error('Inbox read failed', inboxResult.error?.code || unreadResult.error?.code || 'INVALID_RESULT');
        return json({ error: 'Inbox is temporarily unavailable.', code: 'INBOX_UNAVAILABLE' }, 503, headers);
      }
      return json({ messages: inboxResult.data, unreadCount: unreadResult.count }, 200, headers);
    }

    const parsed = await readJson(request, 1024);
    if (parsed.error) {
      const code = parsed.status === 413 ? 'TOO_LARGE' : parsed.status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'INVALID_REQUEST';
      return json({ error: parsed.error, code }, parsed.status, headers);
    }
    const body = parsed.value;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(field => !['id','state'].includes(field))
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id || '')
      || !['unread','read','archived'].includes(body.state)) {
      return json({ error: 'Invalid request.', code: 'INVALID_REQUEST' }, 400, headers);
    }
    const { data: updated, error: updateError } = await db.from('portfolio_messages')
      .update({ state: body.state }).eq('id', body.id).select('id').maybeSingle();
    if (updateError) {
      logger.error('Inbox update failed', updateError.code);
      return json({ error: 'Could not update message.', code: 'UPDATE_FAILED' }, 503, headers);
    }
    if (!updated) return json({ error: 'Message not found.', code: 'NOT_FOUND' }, 404, headers);
    return json({ ok: true }, 200, headers);
  };
}
