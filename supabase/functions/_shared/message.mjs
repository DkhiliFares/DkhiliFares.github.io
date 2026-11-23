export function validateMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Invalid message.' };
  if (Object.keys(value).some(key => !['name','email','subject','message','website','turnstileToken'].includes(key))) return { error: 'Invalid message.' };
  if (typeof value.website !== 'string' && value.website !== undefined) return { error: 'Invalid message.' };
  if (value.website?.trim()) return { trap: true };
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const subject = typeof value.subject === 'string' ? value.subject.trim() : '';
  const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : '';
  const body = typeof value.message === 'string' ? value.message.trim() : '';
  const token = typeof value.turnstileToken === 'string' ? value.turnstileToken.trim() : '';
  if (name.length < 2 || name.length > 80 || /[\u0000-\u001f]/.test(name)) return { error: 'Name must be 2–80 characters.' };
  if (subject.length < 3 || subject.length > 120 || /[\u0000-\u001f]/.test(subject)) return { error: 'Subject must be 3–120 characters.' };
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.' };
  if (body.length < 10 || body.length > 5000 || /\u0000/.test(body)) return { error: 'Message must be 10–5000 characters.' };
  if (token.length > 2048) return { error: 'Security check is invalid.' };
  return { name, subject, email, body, token };
}

export const alertSlot = time => new Date(Math.floor(time / 900000) * 900000).toISOString();
export const rateLimitWindow = time => new Date(Math.floor(time / 900000) * 900000).toISOString();
export async function hashClientAddress(address) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address || 'unknown'));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
