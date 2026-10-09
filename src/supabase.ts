import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && key);

export const supabase = createClient(url || 'http://127.0.0.1', key || 'missing', {
  auth: {
    // PKCE returns "?code=..." in the query string. The implicit flow would put
    // tokens in the URL hash, which collides with HashRouter.
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
  },
});
