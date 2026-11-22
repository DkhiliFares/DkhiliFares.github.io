import test from 'node:test';
import assert from 'node:assert/strict';
import { contactConfig } from '../scripts/contact-config.mjs';
import { contactForm } from '../src/components/contact.mjs';
import { validateMessage, alertSlot } from '../supabase/functions/_shared/message.mjs';

test('contact remains inactive until a secure endpoint and site key are configured',()=>{
  assert.deepEqual(contactConfig({}),{ready:false});
  assert.throws(()=>contactConfig({CONTACT_API_URL:'https://example.com/submit-message'}));
  assert.throws(()=>contactConfig({CONTACT_API_URL:'http://example.com/submit-message',TURNSTILE_SITE_KEY:'123456789012'}));
  const config=contactConfig({CONTACT_API_URL:'https://example.supabase.co/functions/v1/submit-message',TURNSTILE_SITE_KEY:'123456789012'});
  const html=contactForm({linkedin:'https://example.com'},config);
  assert(html.includes('data-endpoint="https://example.supabase.co/functions/v1/submit-message"'));
  assert(html.includes('cf-turnstile'));
  assert(!html.includes('mailto:'));
  assert(!html.includes('formspree'));
});
test('server validation rejects malformed messages and caps email alerts',()=>{
  const valid={subject:'Engineering opportunity',email:'Visitor@Example.COM',message:'Hello Fares, I would like to discuss a project.',turnstileToken:'token'};
  assert.equal(validateMessage(valid).email,'visitor@example.com');
  assert(validateMessage({...valid,message:'x'}).error);
  assert(validateMessage({...valid,subject:'a'.repeat(121)}).error);
  assert(validateMessage({...valid,website:'spam.example'}).trap);
  assert.equal(alertSlot(900001),alertSlot(1799999));
  assert.notEqual(alertSlot(899999),alertSlot(900001));
});
