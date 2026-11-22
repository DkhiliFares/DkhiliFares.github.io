import { createClient } from 'npm:@supabase/supabase-js@2';
import { validateMessage, alertSlot } from '../_shared/message.mjs';
import { corsHeaders, json, serviceKey } from '../_shared/http.mjs';

Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';
  const allowed = Deno.env.get('ALLOWED_ORIGIN') || 'https://dkhilifares.github.io';
  const headers = corsHeaders(origin, allowed);
  if (request.method === 'OPTIONS') return new Response(null, { status: origin === allowed ? 204 : 403, headers });
  if (origin !== allowed || request.method !== 'POST') return json({ error: 'Forbidden' }, 403, headers);
  if (Number(request.headers.get('content-length') || 0) > 12000) return json({ error: 'Message is too large.' }, 413, headers);
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const notifyTo = Deno.env.get('NOTIFY_TO');
  const notifyFrom = Deno.env.get('NOTIFY_FROM');
  const ownerUrl = Deno.env.get('OWNER_PORTAL_URL');
  const key = serviceKey();
  const url = Deno.env.get('SUPABASE_URL');
  if (![secret,resendKey,notifyTo,notifyFrom,ownerUrl,key,url].every(Boolean)) return json({ error: 'Inbox is not configured.' }, 503, headers);
  let payload;
  try { const raw = await request.text(); if (raw.length > 12000) return json({ error: 'Message is too large.' }, 413, headers); payload = JSON.parse(raw); }
  catch { return json({ error: 'Invalid message.' }, 400, headers); }
  const message = validateMessage(payload);
  if (message.trap) return json({ ok: true }, 201, headers);
  if (message.error) return json({ error: message.error }, 400, headers);

  const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, response: message.token })
  }).then(r => r.json()).catch(() => null);
  const expectedHost = new URL(allowed).hostname;
  if (!verify?.success || verify.hostname !== expectedHost) return json({ error: 'Security check failed. Please retry.' }, 403, headers);

  const db = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await db.from('portfolio_messages').insert({ subject: message.subject, sender_email: message.email, body: message.body });
  if (error) { console.error('Inbox insert failed', error.code); return json({ error: 'Message could not be stored.' }, 503, headers); }

  const { error: slotError } = await db.from('portfolio_alert_slots').insert({ slot: alertSlot(Date.now()) });
  if (!slotError) {
    try {
      const sent = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: notifyFrom, to: [notifyTo], subject: 'New portfolio message', text: `A new message is waiting in your private portfolio inbox. Sign in: ${ownerUrl}` })
      });
      if (!sent.ok) console.error('Inbox alert failed', sent.status);
    } catch (error) { console.error('Inbox alert unavailable', String(error)); }
  } else if (slotError.code !== '23505') console.error('Inbox alert slot failed', slotError.code);
  return json({ ok: true }, 201, headers);
});
