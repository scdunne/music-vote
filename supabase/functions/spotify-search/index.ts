// Searches Spotify on behalf of members, using the app's own Client Credentials
// token. Members never authorize with Spotify, so they don't count toward the
// development-mode user cap; only the host does (for playlist creation).
//
// Deploy:  supabase functions deploy spotify-search
// Secrets: supabase secrets set SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=...
import { createClient } from 'npm:@supabase/supabase-js@2';

const SEARCH_PAGE_SIZE = 10;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...headers },
  });
}

// Reused across requests while this function instance stays warm.
let appToken: { token: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string> {
  if (appToken && appToken.expiresAt > Date.now()) return appToken.token;
  const id = Deno.env.get('SPOTIFY_CLIENT_ID');
  const secret = Deno.env.get('SPOTIFY_CLIENT_SECRET');
  if (!id || !secret) throw new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not set');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify token request failed (${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  // Leave a minute of margin before the token's real expiry.
  appToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return appToken.token;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  // Only allowlisted members may search, checked with the caller's own JWT.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: member, error: memberError } = await supabase.rpc('is_member');
  if (memberError || !member) return json(403, { error: 'Only Music Vote members can search.' });

  let q: string;
  let offset: number;
  try {
    const body = await req.json();
    q = String(body.q ?? '').trim();
    offset = Math.max(0, Math.floor(Number(body.offset) || 0));
  } catch {
    return json(400, { error: 'Expected a JSON body with "q" and "offset".' });
  }
  if (!q) return json(400, { error: 'Missing search query.' });

  const params = new URLSearchParams({
    q,
    type: 'track',
    limit: String(SEARCH_PAGE_SIZE),
    offset: String(offset),
  });
  let res: Response;
  try {
    res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
      headers: { Authorization: `Bearer ${await getAppToken()}` },
    });
    if (res.status === 401) {
      // The cached token was revoked early; fetch a fresh one and retry once.
      appToken = null;
      res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
        headers: { Authorization: `Bearer ${await getAppToken()}` },
      });
    }
  } catch (e) {
    console.error(e);
    return json(500, { error: `Search is misconfigured: ${e instanceof Error ? e.message : e}` });
  }
  if (res.status === 429) {
    const wait = res.headers.get('Retry-After');
    return json(429, { error: 'rate_limited', retryAfter: wait }, wait ? { 'Retry-After': wait } : {});
  }
  if (!res.ok) return json(502, { error: `Spotify returned an error (${res.status}).` });
  const data = (await res.json()) as { tracks: unknown };
  return json(200, data.tracks);
});
