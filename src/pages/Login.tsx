import { useState, type FormEvent } from 'react';
import { sendLoginLink } from '../spotify';

/** A failed auth round trip comes back as "?error=...&error_description=...". */
function redirectError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error_description') ?? params.get('error');
  return error ? `Sign-in failed: ${error}` : null;
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(redirectError);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendLoginLink(email.trim());
      setSentTo(email.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container narrow login">
      <h1>Music Vote</h1>
      <p className="muted">Pick songs for a theme, vote on everyone's picks, get a playlist out of it.</p>
      {sentTo ? (
        <p>
          Check <strong>{sentTo}</strong> for a login link. Open it in this browser.
        </p>
      ) : (
        <form onSubmit={submit}>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <button className="big" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Email me a login link'}
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
