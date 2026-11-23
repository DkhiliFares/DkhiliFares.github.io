export function contactConfig(env = process.env) {
  const endpoint = env.CONTACT_API_URL?.trim() || (env.SUPABASE_URL?.trim() ? `${env.SUPABASE_URL.trim().replace(/\/$/,'')}/functions/v1/submit-message` : '');
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() || '';
  if (!endpoint) {
    if (siteKey) throw new Error('SUPABASE_URL or CONTACT_API_URL is required when Turnstile is configured');
    return { ready: false };
  }
  let parsed;
  try { parsed = new URL(endpoint); } catch { throw new Error('CONTACT_API_URL must be a URL'); }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1','localhost'].includes(parsed.hostname))) throw new Error('CONTACT_API_URL must use HTTPS');
  if (siteKey && !/^[a-zA-Z0-9_-]{12,100}$/.test(siteKey)) throw new Error('TURNSTILE_SITE_KEY must be a public Cloudflare Turnstile site key');
  return { ready: true, endpoint: parsed.href, siteKey };
}
