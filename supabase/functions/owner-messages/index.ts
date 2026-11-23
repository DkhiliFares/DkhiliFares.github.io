import { createClient } from 'npm:@supabase/supabase-js@2';
import { serviceKey } from '../_shared/http.mjs';
import { createOwnerMessagesHandler } from '../_shared/inbox-api.mjs';

Deno.serve(createOwnerMessagesHandler({
  env: key => Deno.env.get(key),
  createClient,
  serviceKey
}));
