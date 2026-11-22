import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json, serviceKey } from '../_shared/http.mjs';

Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';
  const allowed = Deno.env.get('ALLOWED_ORIGIN') || 'https://dkhilifares.github.io';
  const headers = corsHeaders(origin, allowed);
  if (request.method === 'OPTIONS') return new Response(null, { status: origin === allowed ? 204 : 403, headers });
  if (origin !== allowed || !['GET','POST'].includes(request.method)) return json({ error: 'Forbidden' }, 403, headers);
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  const ownerId = Deno.env.get('OWNER_USER_ID');
  const url = Deno.env.get('SUPABASE_URL');
  const key = serviceKey();
  if (!token) return json({ error: 'Sign in required.' }, 401, headers);
  if (![ownerId,url,key].every(Boolean)) return json({ error: 'Inbox is not configured.' }, 503, headers);
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: identity, error: authError } = await db.auth.getUser(token);
  if (authError || identity.user?.id !== ownerId) return json({ error: 'Forbidden' }, 403, headers);

  if (request.method === 'GET') {
    const { data, error } = await db.from('portfolio_messages').select('id,created_at,sender_email,subject,body,state').order('created_at', { ascending: false }).limit(100);
    if (error) return json({ error: 'Inbox unavailable.' }, 503, headers);
    return json({ messages: data }, 200, headers);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400, headers); }
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(body?.id || '') || !['unread','read','archived'].includes(body?.state)) return json({ error: 'Invalid request.' }, 400, headers);
  const { error } = await db.from('portfolio_messages').update({ state: body.state }).eq('id', body.id);
  if (error) return json({ error: 'Could not update message.' }, 503, headers);
  return json({ ok: true }, 200, headers);
});
