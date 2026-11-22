export function corsHeaders(origin, allowed) {
  return origin === allowed ? {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    Vary: 'Origin'
  } : { Vary: 'Origin' };
}
export function json(body, status, headers={}) {
  return Response.json(body, { status, headers: { ...headers, 'Cache-Control': 'no-store' } });
}
export function serviceKey() {
  const named = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (named) {
    try { return JSON.parse(named).default; } catch { /* use legacy key below */ }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
}
