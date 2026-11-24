import test from 'node:test';
import assert from 'node:assert/strict';
import { contactConfig } from '../scripts/contact-config.mjs';
import { contactForm } from '../src/components/contact.mjs';
import { submitContactMessage } from '../src/scripts/contact.js';
import { validateMessage, alertSlot, rateLimitWindow } from '../supabase/functions/_shared/message.mjs';
import { createOwnerMessagesHandler, createSubmitMessageHandler } from '../supabase/functions/_shared/inbox-api.mjs';

const origin = 'https://portfolio.example';
const env = { ALLOWED_ORIGINS: origin, OWNER_USER_ID: 'owner-id', SUPABASE_URL: 'https://project.supabase.co' };
const validPayload = {
  name: '  Visitor Name ',
  subject: ' Engineering opportunity ',
  email: 'Visitor@Example.COM',
  message: '  Hello Fares, I would like to discuss a project.  ',
  website: '',
  turnstileToken: ''
};

function mockDatabase(options = {}) {
  const state = {
    messages: options.messages || [],
    inserted: null,
    updated: null,
    insertError: options.insertError || null,
    rateError: options.rateError || null,
    permitted: options.permitted ?? true,
    readError: options.readError || null,
    countError: options.countError || null,
    updateError: options.updateError || null,
    identity: options.identity ?? { id: 'owner-id' }
  };
  const db = {
    auth: {
      getUser: async token => token === 'owner-token'
        ? { data: { user: state.identity }, error: null }
        : { data: { user: null }, error: { code: 'INVALID_TOKEN' } }
    },
    rpc: async () => ({ data: state.permitted, error: state.rateError }),
    from(table) {
      if (table === 'portfolio_alert_slots') return { insert: async () => ({ error: { code: '23505' } }) };
      return {
        insert(values) {
          state.inserted = values;
          return {
            select() {
              return {
                single: async () => state.insertError
                  ? { data: null, error: state.insertError }
                  : { data: { id: 'message-id' }, error: null }
              };
            }
          };
        },
        select(_columns, options) {
          if (options?.head) return {
            eq: async (_column, value) => ({
              count: state.messages.filter(message => message.state === value).length,
              error: state.countError
            })
          };
          return {
            order() {
              return {
                limit: async () => ({ data: state.messages, error: state.readError })
              };
            }
          };
        },
        update(values) {
          state.updated = values;
          return {
            eq(_column, id) {
              return {
                select() {
                  return {
                    maybeSingle: async () => {
                      if (state.updateError) return { data: null, error: state.updateError };
                      const match = state.messages.find(message => message.id === id);
                      if (match) match.state = values.state;
                      return { data: match ? { id } : null, error: null };
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };
  return { db, state };
}

function makeHandler(factory, state, options = {}) {
  return factory({
    env: { ...env, ...options.env },
    createClient: () => state.db,
    serviceKey: () => 'server-only-key',
    now: () => 1800000,
    fetchImpl: options.fetchImpl,
    logger: { error() {} }
  });
}

function submitRequest(payload, options = {}) {
  const method = options.method || 'POST';
  return new Request('https://project.supabase.co/functions/v1/submit-message', {
    method,
    headers: {
      Origin: options.origin || origin,
      'Content-Type': 'application/json',
      'x-real-ip': options.ip || '203.0.113.12'
    },
    body: options.rawBody ?? (method === 'GET' ? undefined : JSON.stringify(payload))
  });
}

test('contact is enabled from the Supabase URL without requiring Turnstile', () => {
  assert.deepEqual(contactConfig({}), { ready: false });
  assert.throws(() => contactConfig({ TURNSTILE_SITE_KEY: '123456789012' }));
  assert.throws(() => contactConfig({ CONTACT_API_URL: 'http://example.com/submit-message' }));
  const config = contactConfig({ SUPABASE_URL: 'https://example.supabase.co/' });
  assert.equal(config.endpoint, 'https://example.supabase.co/functions/v1/submit-message');
  assert.equal(config.siteKey, '');
  const html = contactForm({ linkedin: 'https://example.com' }, config);
  assert(html.includes('name="name"'));
  assert(html.includes('data-turnstile="optional"'));
  assert(!html.includes('class="cf-turnstile"'));
});

test('server validation trims fields and rejects invalid, empty, oversized and extra input', () => {
  const valid = { ...validPayload, name: 'Visitor Name' };
  const parsed = validateMessage(valid);
  assert.equal(parsed.name, 'Visitor Name');
  assert.equal(parsed.email, 'visitor@example.com');
  assert.equal(parsed.subject, 'Engineering opportunity');
  assert.equal(parsed.body, 'Hello Fares, I would like to discuss a project.');
  assert(validateMessage({ ...valid, name: ' ' }).error);
  assert(validateMessage({ ...valid, email: 'not-an-email' }).error);
  assert(validateMessage({ ...valid, message: '   ' }).error);
  assert(validateMessage({ ...valid, message: 'x'.repeat(5001) }).error);
  assert(validateMessage({ ...valid, subject: 'a'.repeat(121) }).error);
  assert(validateMessage({ ...valid, website: 'spam.example' }).trap);
  assert(validateMessage({ ...valid, admin: true }).error);
  assert.equal(alertSlot(900001), alertSlot(1799999));
  assert.notEqual(alertSlot(899999), alertSlot(900001));
  assert.equal(rateLimitWindow(1800000), new Date(1800000).toISOString());
});

test('anonymous valid submission is confirmed only after storage succeeds', async () => {
  const { db, state } = mockDatabase();
  const handler = makeHandler(createSubmitMessageHandler, { db, state });
  const response = await handler(submitRequest(validPayload));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(state.inserted, {
    sender_name: 'Visitor Name',
    sender_email: 'visitor@example.com',
    subject: 'Engineering opportunity',
    body: 'Hello Fares, I would like to discuss a project.'
  });
});

test('invalid, oversized, rate-limited and honeypot submissions never store or report success', async () => {
  const { db, state } = mockDatabase();
  const handler = makeHandler(createSubmitMessageHandler, { db, state });
  assert.equal((await handler(submitRequest({ ...validPayload, email: 'bad' }))).status, 400);
  assert.equal((await handler(submitRequest(validPayload, { rawBody: JSON.stringify({ message: 'x'.repeat(12020) }) }))).status, 413);
  assert.equal((await handler(submitRequest({ ...validPayload, website: 'filled' }))).status, 400);
  assert.equal(state.inserted, null);

  const limited = mockDatabase({ permitted: false });
  const rateResponse = await makeHandler(createSubmitMessageHandler, limited)(submitRequest(validPayload));
  assert.equal(rateResponse.status, 429);

  const failedInsert = mockDatabase({ insertError: { code: 'DB_ERROR' } });
  const storageResponse = await makeHandler(createSubmitMessageHandler, failedInsert)(submitRequest(validPayload));
  assert.equal(storageResponse.status, 503);
  assert.notDeepEqual(await storageResponse.json(), { ok: true });
});

test('submission endpoint enforces origin, HTTP method and optional Turnstile verification', async () => {
  const { db, state } = mockDatabase();
  const handler = makeHandler(createSubmitMessageHandler, { db, state });
  assert.equal((await handler(submitRequest(validPayload, { origin: 'https://attacker.example' }))).status, 403);
  assert.equal((await handler(submitRequest(validPayload, { method: 'GET' }))).status, 405);
  const preflight = await handler(new Request(
    'https://project.supabase.co/functions/v1/submit-message',
    {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'apikey,content-type'
      }
    }
  ));

  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get('Access-Control-Allow-Methods'),
    'POST, OPTIONS'
  );
  assert.equal(
    preflight.headers.get('Access-Control-Allow-Headers'),
    'authorization, x-client-info, apikey, content-type'
  );
  assert.equal(
    preflight.headers.get('Access-Control-Allow-Origin'),
    origin
  );
  const unsupportedType = await handler(new Request('https://project.supabase.co/functions/v1/submit-message', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'text/plain', 'x-real-ip': '203.0.113.12' },
    body: JSON.stringify(validPayload)
  }));
  assert.equal(unsupportedType.status, 415);
  const brokenBody = submitRequest(validPayload);
  Object.defineProperty(brokenBody, 'body', { value: { getReader: () => ({ read: async () => { throw new Error('stream failed'); } }) } });
  const invalidStream = await handler(brokenBody);
  assert.equal(invalidStream.status, 400);
  assert.deepEqual(await invalidStream.json(), { error: 'Invalid request.', code: 'INVALID_REQUEST' });

  const protectedHandler = makeHandler(createSubmitMessageHandler, { db, state }, {
    env: { TURNSTILE_SECRET_KEY: 'server-turnstile-secret' },
    fetchImpl: async () => ({ ok: true, json: async () => ({ success: false }) })
  });
  const failedCaptcha = await protectedHandler(submitRequest({ ...validPayload, turnstileToken: 'invalid' }));
  assert.equal(failedCaptcha.status, 403);
});

test('contact client never treats failed or ambiguous responses as success', async () => {
  await assert.rejects(() => submitContactMessage('/messages', {}, async () => new Response(
    JSON.stringify({ error: 'Could not save this message.' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  )), /Could not save this message/);
  await assert.rejects(() => submitContactMessage('/messages', {}, async () => new Response(
    JSON.stringify({ ok: false }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )), /message could not be saved/i);
  await assert.rejects(() => submitContactMessage('/messages', {}, async () => { throw new Error('network down'); }), /network down/);
  assert.deepEqual(await submitContactMessage('/messages', {}, async () => new Response(
    JSON.stringify({ ok: true }),
    { status: 201, headers: { 'Content-Type': 'application/json' } }
  )), { ok: true });
});

test('inbox rejects anonymous and non-owner callers, while owner can read and update messages', async () => {
  const seeded = [{ id: '123e4567-e89b-12d3-a456-426614174000', created_at: '2026-11-23T12:00:00Z', sender_name: 'Visitor', sender_email: 'visitor@example.com', subject: 'Hello', body: 'A message from a visitor.', state: 'unread' }];
  const { db, state } = mockDatabase({ messages: seeded });
  const handler = makeHandler(createOwnerMessagesHandler, { db, state });
  const base = { headers: { Origin: origin } };
  assert.equal((await handler(new Request('https://project.supabase.co/functions/v1/owner-messages', { ...base, method: 'GET' }))).status, 401);
  const expired = await handler(new Request('https://project.supabase.co/functions/v1/owner-messages', {
    method: 'GET', headers: { Origin: origin, Authorization: 'Bearer expired-token' }
  }));
  assert.equal(expired.status, 401);
  assert.equal((await expired.json()).code, 'INVALID_TOKEN');

  state.identity = { id: 'other-user' };
  const nonOwner = await handler(new Request('https://project.supabase.co/functions/v1/owner-messages', {
    ...base, method: 'GET', headers: { Origin: origin, Authorization: 'Bearer owner-token' }
  }));
  assert.equal(nonOwner.status, 403);

  state.identity = { id: 'owner-id' };
  const ownerRequest = await handler(new Request('https://project.supabase.co/functions/v1/owner-messages', {
    method: 'GET', headers: { Origin: origin, Authorization: 'Bearer owner-token' }
  }));
  assert.equal(ownerRequest.status, 200);
  const inbox = await ownerRequest.json();
  assert.deepEqual(inbox.messages, seeded);
  assert.equal(inbox.unreadCount, 1);
  const update = await handler(new Request('https://project.supabase.co/functions/v1/owner-messages', {
    method: 'POST',
    headers: { Origin: origin, Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: seeded[0].id, state: 'read' })
  }));
  assert.equal(update.status, 200);
  assert.deepEqual(state.updated, { state: 'read' });
  assert.equal(state.messages[0].state, 'read');
});
