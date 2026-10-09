import { useState } from 'react';
import { signInWithSpotify } from '../spotify';

/** A failed OAuth round trip comes back as "?error=...&error_description=...". */
function redirectError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error_description') ?? params.get('error');
  return error ? `Sign-in failed: ${error}` : null;
}

export default function Login() {
  const [error, setError] = useState<string | null>(redirectError);
  return (
    <main className="container narrow login">
      <h1>Music Vote</h1>
      <p className="muted">Pick songs for a theme, vote on everyone's picks, get a playlist out of it.</p>
      <button
        className="big"
        onClick={() => signInWithSpotify().catch((e: Error) => setError(e.message))}
      >
        Log in with Spotify
      </button>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
