import test from 'node:test';
import assert from 'node:assert/strict';
test('submission endpoint enforces origin, HTTP method and optional Turnstile verification', async () => {
  const { db, state } = mockDatabase();
  const handler = makeHandler(createSubmitMessageHandler, { db, state });

  assert.equal((await handler(submitRequest(validPayload, {
    origin: 'https://attacker.example'
  }))).status, 403);

  assert.equal((await handler(submitRequest(validPayload, {
    method: 'GET'
  }))).status, 405);

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

  const unsupportedType = await handler(new Request(
    'https://project.supabase.co/functions/v1/submit-message',
    {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'text/plain',
        'x-real-ip': '203.0.113.12'
      },
      body: JSON.stringify(validPayload)
    }
  ));

  assert.equal(unsupportedType.status, 415);

  const brokenBody = submitRequest(validPayload);
  Object.defineProperty(brokenBody, 'body', {
    value: {
      getReader: () => ({
        read: async () => {
          throw new Error('stream failed');
        }
      })
    }
  });

  const invalidStream = await handler(brokenBody);
  assert.equal(invalidStream.status, 400);
  assert.deepEqual(await invalidStream.json(), {
    error: 'Invalid request.',
    code: 'INVALID_REQUEST'
  });

  const protectedHandler = makeHandler(
    createSubmitMessageHandler,
    { db, state },
    {
      env: { TURNSTILE_SECRET_KEY: 'server-turnstile-secret' },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ success: false })
      })
    }
  );

  const failedCaptcha = await protectedHandler(
    submitRequest({
      ...validPayload,
      turnstileToken: 'invalid'
    })
  );

  assert.equal(failedCaptcha.status, 403);
});
