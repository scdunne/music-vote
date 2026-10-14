import { supabase } from './supabase';

// Only the host connects Spotify, to create playlists. Members sign in by email
// and search through the spotify-search edge function, so they never count
// toward Spotify's development-mode user cap.
// user-read-email: Supabase needs an email for the Spotify identity.
const SCOPES = 'user-read-email playlist-modify-public playlist-modify-private';
const TOKEN_KEY = 'mv.spotifyToken';
const RETURN_KEY = 'mv.returnTo';
const API = 'https://api.spotify.com/v1';

interface StoredToken {
  token: string;
  expiresAt: number;
}

function readStored(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as StoredToken) : null;
  } catch {
    return null;
  }
}

/**
 * Supabase only hands us the Spotify token at sign-in and never refreshes it,
 * so keep our own copy. A token we've already seen is not re-saved, so a stale
 * token still sitting in the Supabase session can't look fresh again.
 */
export function rememberProviderToken(token: string) {
  if (readStored()?.token === token) return;
  // Spotify access tokens last 1 hour; leave a few minutes of margin.
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt: Date.now() + 55 * 60 * 1000 }));
}

function expireToken() {
  const stored = readStored();
  if (stored) localStorage.setItem(TOKEN_KEY, JSON.stringify({ ...stored, expiresAt: 0 }));
}

export function forgetToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function hasSpotifyToken(): boolean {
  const stored = readStored();
  return Boolean(stored && stored.expiresAt > Date.now());
}

/**
 * Gets the host a fresh Spotify token. The first time, this links a Spotify
 * identity to the host's email account (needs manual linking enabled in
 * Supabase). After that, signing in with Spotify lands on the same account.
 */
export async function connectSpotify() {
  sessionStorage.setItem(RETURN_KEY, window.location.hash);
  const options = { scopes: SCOPES, redirectTo: window.location.origin + import.meta.env.BASE_URL };
  const { data } = await supabase.auth.getUser();
  const linked = data.user?.identities?.some((i) => i.provider === 'spotify');
  const { error } = linked
    ? await supabase.auth.signInWithOAuth({ provider: 'spotify', options })
    : await supabase.auth.linkIdentity({ provider: 'spotify', options });
  if (error) throw error;
}

/** Members log in with a one-time link sent to their (allowlisted) email. */
export async function sendLoginLink(email: string) {
  sessionStorage.setItem(RETURN_KEY, window.location.hash);
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
  });
  if (error) throw error;
}

/** The route the user was on before the OAuth redirect, consumed once. */
export function takeReturnRoute(): string | null {
  const hash = sessionStorage.getItem(RETURN_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  return hash && hash.startsWith('#/') ? hash.slice(1) : null;
}

export class SpotifyError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function spotifyFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const stored = readStored();
  if (!stored || stored.expiresAt <= Date.now()) {
    throw new SpotifyError(401, 'Your Spotify connection expired. Reconnect to continue.');
  }
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${stored.token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (res.status === 401) {
    expireToken();
    throw new SpotifyError(401, 'Your Spotify connection expired. Reconnect to continue.');
  }
  if (res.status === 403) {
    throw new SpotifyError(403, "Spotify refused the request. Check that your Spotify email is on the app's allowlist in the Developer Dashboard.");
  }
  if (res.status === 429) {
    const wait = res.headers.get('Retry-After');
    throw new SpotifyError(429, `Spotify is rate-limiting us. Try again in ${wait ? `${wait} seconds` : 'a minute'}.`);
  }
  if (!res.ok) throw new SpotifyError(res.status, `Spotify returned an error (${res.status}).`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: { name: string }[];
  album: { name: string; images: { url: string; width: number | null }[] };
}

export interface SearchPage {
  items: SpotifyTrack[];
  total: number;
  next: string | null;
}

/** Spotify caps search at 10 results per request in development mode. */
export const SEARCH_PAGE_SIZE = 10;

/** Searches with the app's own token (via the edge function), not the user's. */
export async function searchTracks(query: string, offset: number): Promise<SearchPage> {
  const { data, error } = await supabase.functions.invoke<SearchPage>('spotify-search', {
    body: { q: query, offset },
  });
  if (!error) return data!;
  const res: Response | undefined = error.context instanceof Response ? error.context : undefined;
  if (res?.status === 429) {
    const wait = res.headers.get('Retry-After');
    throw new SpotifyError(429, `Spotify is rate-limiting us. Try again in ${wait ? `${wait} seconds` : 'a minute'}.`);
  }
  const body = await res?.json().catch(() => null);
  // A plain Error, so a failed search never offers a "Connect Spotify" button.
  throw new Error(body?.error ?? 'Search is unavailable right now.');
}

/** Album images are largest-first; the middle one (~300px) suits cards. */
export function albumImage(track: SpotifyTrack): string | null {
  const imgs = track.album.images;
  return (imgs[1] ?? imgs[0])?.url ?? null;
}

/**
 * Creates a private playlist in the signed-in user's account and returns its URL.
 * Uses the post-February-2026 endpoints: POST /me/playlists and
 * POST /playlists/{id}/items (the old /users/{id}/playlists and /tracks are gone).
 */
export async function createPlaylist(name: string, description: string, uris: string[]): Promise<string> {
  const playlist = await spotifyFetch<{ id: string; external_urls: { spotify: string } }>('/me/playlists', {
    method: 'POST',
    body: JSON.stringify({ name, description, public: false }),
  });
  for (let i = 0; i < uris.length; i += 100) {
    await spotifyFetch(`/playlists/${playlist.id}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris: uris.slice(i, i + 100) }),
    });
  }
  return playlist.external_urls.spotify;
}
