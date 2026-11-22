export function contactConfig(env = process.env) {
  const endpoint = env.CONTACT_API_URL?.trim() || '';
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() || '';
  if (!endpoint && !siteKey) return { ready: false };
  let parsed;
  try { parsed = new URL(endpoint); } catch { throw new Error('CONTACT_API_URL must be a URL'); }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1','localhost'].includes(parsed.hostname))) throw new Error('CONTACT_API_URL must use HTTPS');
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(siteKey)) throw new Error('TURNSTILE_SITE_KEY must be a public Cloudflare Turnstile site key');
  return { ready: true, endpoint: parsed.href, siteKey };
}
