import { useState } from 'react';
import { signInWithSpotify } from '../spotify';

export default function Login() {
  const [error, setError] = useState<string | null>(null);
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
