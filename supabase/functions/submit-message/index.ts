import { createClient } from 'npm:@supabase/supabase-js@2';
import { serviceKey } from '../_shared/http.mjs';
import { createSubmitMessageHandler } from '../_shared/inbox-api.mjs';

Deno.serve(createSubmitMessageHandler({
  env: key => Deno.env.get(key),
  createClient,
  serviceKey
}));
