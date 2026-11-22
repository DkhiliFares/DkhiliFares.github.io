export function initContact() {
  const form = document.querySelector('#contact-form');
  if (!form) return;
  const button = form.querySelector('[type="submit"]');
  const status = form.querySelector('.contact-status');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity() || button.disabled) return;
    const data = new FormData(form);
    if (!data.get('cf-turnstile-response')) {
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
      const response = await fetch(form.dataset.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ subject: data.get('subject'), email: data.get('email'), message: data.get('message'), website: data.get('website'), turnstileToken: data.get('cf-turnstile-response') }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Delivery returned ${response.status}`);
      form.reset();
      window.turnstile?.reset();
      status.dataset.state = 'success';
      status.textContent = 'Message saved in my private inbox. Thank you — I’ll reply by email.';
    } catch {
      status.dataset.state = 'error';
      status.textContent = 'The message could not be sent. Please try again or use the email link.';
    } finally {
      clearTimeout(timer);
      button.disabled = false;
    }
  });
}
