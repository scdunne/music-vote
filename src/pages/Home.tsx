import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { listRounds, useAsync } from '../data';
import { Countdown, ErrorNotice, PhaseBadge } from '../components/bits';

export default function Home() {
  const { profile } = useAuth();
  const { data: rounds, error, loading } = useAsync(listRounds, []);

  if (loading && !rounds) return <p className="muted">Loading…</p>;
  if (error) return <ErrorNotice error={error} />;

  const active = (rounds ?? []).filter((r) => r.status === 'submitting' || r.status === 'voting');
  const drafts = (rounds ?? []).filter((r) => r.status === 'draft');
  const past = (rounds ?? []).filter((r) => r.status === 'closed').slice(0, 5);

  return (
    <>
      <h1>Current round{active.length > 1 ? 's' : ''}</h1>
      {active.length === 0 && <p className="muted">No round is running right now.</p>}
      {active.map((r) => (
        <div key={r.id} className="card">
          <div className="row">
            <span className="muted">#{r.number}</span>
            <PhaseBadge status={r.status} />
            <span className="spacer" />
            {r.status === 'submitting' ? (
              <Countdown deadline={r.submit_deadline} label="Submissions close" />
            ) : (
              <Countdown deadline={r.vote_deadline} label="Voting closes" />
            )}
          </div>
          <h2>{r.theme}</h2>
          {r.description && <p>{r.description}</p>}
          <Link className="button" to={`/round/${r.id}`}>
            {r.status === 'submitting' ? 'Submit songs' : 'Vote now'}
          </Link>
        </div>
      ))}

      {profile?.is_host && drafts.length > 0 && (
        <p className="muted">
          {drafts.length} draft round{drafts.length > 1 ? 's' : ''}. Manage {drafts.length > 1 ? 'them' : 'it'} on the{' '}
          <Link to="/host">Host page</Link>.
        </p>
      )}

      {past.length > 0 && (
        <>
          <h2>Past rounds</h2>
          <ul className="plain">
            {past.map((r) => (
              <li key={r.id}>
                <Link to={`/round/${r.id}`}>
                  #{r.number}: {r.theme}
                </Link>
                {r.playlist_url && (
                  <>
                    {' · '}
                    <a href={r.playlist_url} target="_blank" rel="noreferrer">
                      Playlist
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
          <Link to="/history">All past rounds →</Link>
        </>
      )}
    </>
  );
}
