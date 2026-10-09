import { Link } from 'react-router-dom';
import { listProfiles, listResults, listRounds, useAsync } from '../data';
import { ErrorNotice } from '../components/bits';

async function loadHistory() {
  const [rounds, profiles] = await Promise.all([listRounds(), listProfiles()]);
  const closed = rounds.filter((r) => r.status === 'closed');
  const winners = await Promise.all(closed.map((r) => listResults(r.id).then((res) => res[0] ?? null)));
  const names = new Map(profiles.map((p) => [p.id, p.display_name]));
  return closed.map((round, i) => ({ round, winner: winners[i], winnerName: winners[i] && names.get(winners[i]!.user_id) }));
}

export default function History() {
  const { data, error, loading } = useAsync(loadHistory, []);
  if (loading && !data) return <p className="muted">Loading…</p>;
  if (error) return <ErrorNotice error={error} />;

  return (
    <>
      <h1>History</h1>
      {data!.length === 0 && <p className="muted">No closed rounds yet.</p>}
      {data!.map(({ round, winner, winnerName }) => (
        <div key={round.id} className="card">
          <div className="row">
            <h2>
              <Link to={`/round/${round.id}`}>
                #{round.number}: {round.theme}
              </Link>
            </h2>
            <span className="spacer" />
            {round.playlist_url && (
              <a className="button secondary small" href={round.playlist_url} target="_blank" rel="noreferrer">
                Open in Spotify
              </a>
            )}
          </div>
          {winner && (
            <p>
              Winner: <strong>{winner.title}</strong> by {winner.artists}
              <span className="muted">
                {' '}
                ({winner.vote_count} vote{winner.vote_count === 1 ? '' : 's'}, picked by {winnerName ?? 'someone'})
              </span>
            </p>
          )}
        </div>
      ))}
    </>
  );
}
