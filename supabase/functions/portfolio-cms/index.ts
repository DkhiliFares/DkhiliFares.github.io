import { createClient } from 'npm:@supabase/supabase-js@2';
import { serviceKey } from '../_shared/http.mjs';
import { createPortfolioCmsHandler } from '../_shared/cms-api.mjs';

Deno.serve(createPortfolioCmsHandler({
  env: key => Deno.env.get(key),
  createClient,
  serviceKey
}));
