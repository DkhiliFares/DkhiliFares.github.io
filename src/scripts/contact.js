export async function submitContactMessage(endpoint, payload, fetchImpl = fetch, signal) {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    signal
  });
  let result = null;
  try { result = await response.json(); } catch {}
  if (!response.ok || result?.ok !== true) throw new Error(result?.error || 'The message could not be saved.');
  return result;
}

export function initContact() {
  const form = document.querySelector('#contact-form');
  if (!form) return;
  const button = form.querySelector('[type="submit"]');
  const status = form.querySelector('.contact-status');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity() || button.disabled) return;
    const data = new FormData(form);
    const turnstileToken = data.get('cf-turnstile-response');
    if (form.dataset.turnstile === 'required' && !turnstileToken) {
      status.textContent = 'Complete the security check before sending.';
      status.dataset.state = 'error';
      return;
    }
    button.disabled = true;
    status.dataset.state = 'sending';
    status.textContent = 'Sending your message…';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      await submitContactMessage(form.dataset.endpoint, {
        name: String(data.get('name') || '').trim(),
        subject: String(data.get('subject') || '').trim(),
        email: String(data.get('email') || '').trim(),
        message: String(data.get('message') || '').trim(),
        website: data.get('website'),
        turnstileToken
      }, fetch, controller.signal);
      form.reset();
      window.turnstile?.reset();
      status.dataset.state = 'success';
      status.textContent = 'Message saved in my private inbox. Thank you — I’ll reply by email.';
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = error?.name === 'AbortError'
        ? 'The request timed out. Please try again.'
        : error instanceof Error && error.message !== 'Failed to fetch'
          ? error.message
          : 'The message could not be sent. Check your connection and try again.';
    } finally {
      clearTimeout(timer);
      button.disabled = false;
    }
  });
}
