import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import {
  addSubmission,
  castVote,
  createRoundPlaylist,
  deleteSubmission,
  getRound,
  hashOrder,
  listProfiles,
  listResults,
  listSubmissions,
  listVotes,
  removeVote,
  useAsync,
} from '../data';
import type { Profile, ResultRow, Round, Submission, Vote } from '../types';
import type { SpotifyTrack } from '../spotify';
import { albumImage } from '../spotify';
import TrackSearch from '../components/TrackSearch';
import { Countdown, ErrorNotice, PhaseBadge, SpotifyEmbed, TrackRow } from '../components/bits';

async function loadRound(id: string) {
  const round = await getRound(id);
  if (!round) return null;
  const [submissions, votes, profiles] = await Promise.all([listSubmissions(id), listVotes(id), listProfiles()]);
  const results = round.status === 'closed' ? await listResults(id) : [];
  return { round, submissions, votes, profiles, results };
}

export default function RoundPage() {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useAsync(() => loadRound(id), [id]);

  if (loading && !data) return <p className="muted">Loading…</p>;
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <p>Round not found. <Link to="/">Go home</Link></p>;

  const { round } = data;
  return (
    <>
      <div className="row">
        <span className="muted">Round #{round.number}</span>
        <PhaseBadge status={round.status} />
        <span className="spacer" />
        {round.status === 'submitting' && <Countdown deadline={round.submit_deadline} label="Submissions close" />}
        {round.status === 'voting' && <Countdown deadline={round.vote_deadline} label="Voting closes" />}
      </div>
      <h1>{round.theme}</h1>
      {round.description && <p>{round.description}</p>}

      {round.status === 'draft' && <p className="muted">This round hasn't opened yet. Open it from the Host page.</p>}
      {round.status === 'submitting' && <SubmitPhase round={round} submissions={data.submissions} reload={reload} />}
      {round.status === 'voting' && (
        <>
          <PlaylistLink round={round} reload={reload} />
          <VotePhase round={round} submissions={data.submissions} votes={data.votes} reload={reload} />
        </>
      )}
      {round.status === 'closed' && (
        <>
          <PlaylistLink round={round} reload={reload} />
          <Results results={data.results} profiles={data.profiles} />
        </>
      )}
    </>
  );
}

function SubmitPhase({ round, submissions, reload }: { round: Round; submissions: Submission[]; reload: () => void }) {
  const { profile } = useAuth();
  const [picked, setPicked] = useState<SpotifyTrack | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const mine = submissions.filter((s) => s.user_id === profile?.id);
  const remaining = round.songs_per_member - mine.length;
  const takenIds = new Set(submissions.map((s) => s.spotify_track_id));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="muted">
        {submissions.length} song{submissions.length === 1 ? '' : 's'} submitted so far. Who picked what stays hidden
        until the round closes.
      </p>
      <h2>
        Your picks ({mine.length}/{round.songs_per_member})
      </h2>
      <ErrorNotice error={error} />
      <div className="list">
        {mine.map((s) => (
          <div key={s.id}>
            <TrackRow title={s.title} artists={s.artists} imageUrl={s.image_url}>
              <button className="secondary small" disabled={busy} onClick={() => run(() => deleteSubmission(s.id))}>
                Remove
              </button>
            </TrackRow>
            {s.note && <p className="note">“{s.note}”</p>}
          </div>
        ))}
      </div>

      {remaining > 0 && picked && (
        <div className="card">
          <TrackRow title={picked.name} artists={picked.artists.map((a) => a.name).join(', ')} imageUrl={albumImage(picked)} />
          <textarea
            placeholder="Why did you pick this? (optional, shown without your name)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={280}
          />
          <div className="row">
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await addSubmission(round.id, profile!.id, picked, note);
                  setPicked(null);
                  setNote('');
                })
              }
            >
              Submit this song
            </button>
            <button className="secondary" onClick={() => setPicked(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {remaining > 0 && !picked && (
        <>
          <h2>Add a song</h2>
          <TrackSearch takenIds={takenIds} onPick={setPicked} />
        </>
      )}
      {remaining <= 0 && <p className="muted">You've used all your picks. Remove one to swap it out.</p>}
    </>
  );
}

function VotePhase(props: { round: Round; submissions: Submission[]; votes: Vote[]; reload: () => void }) {
  const { round, submissions, votes, reload } = props;
  const { profile } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  // RLS only returns our own votes during voting, but filter anyway.
  const mine = votes.filter((v) => v.voter_id === profile?.id);
  const bySong = new Map<string, Vote[]>();
  for (const v of mine) bySong.set(v.submission_id, [...(bySong.get(v.submission_id) ?? []), v]);
  const left = round.votes_per_member - mine.length;
  const ordered = [...submissions].sort(hashOrder);

  async function change(s: Submission, delta: 1 | -1) {
    setBusyId(s.id);
    setError(null);
    try {
      if (delta > 0) await castVote(round.id, s.id, profile!.id);
      else await removeVote(bySong.get(s.id)![0].id);
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="vote-panel">
        <strong>
          {left} of {round.votes_per_member} vote{round.votes_per_member === 1 ? '' : 's'} left
        </strong>
        <span className="muted small">
          Use + and − to spread them out. You can put several on one song, but not on your own picks.
        </span>
      </div>
      <ErrorNotice error={error} />
      <div className="list">
        {ordered.map((s) => {
          const isMine = s.user_id === profile?.id;
          const count = bySong.get(s.id)?.length ?? 0;
          const busy = busyId === s.id;
          return (
            <div key={s.id} className={`card tight ${count > 0 ? 'voted' : ''}`}>
              <SpotifyEmbed trackId={s.spotify_track_id} />
              <div className="row">
                {s.note ? <p className="note grow">“{s.note}”</p> : <span className="grow" />}
                {isMine ? (
                  <span className="muted small">Your pick</span>
                ) : (
                  <div className="stepper">
                    <button
                      className="secondary"
                      aria-label="Remove a vote"
                      disabled={busy || count === 0}
                      onClick={() => change(s, -1)}
                    >
                      −
                    </button>
                    <span className="stepper-count" aria-label={`${count} vote${count === 1 ? '' : 's'}`}>
                      {count}
                    </span>
                    <button aria-label="Add a vote" disabled={busy || left <= 0} onClick={() => change(s, 1)}>
                      +
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** The round's playlist (made when voting starts), or a retry button for the host if that failed. */
function PlaylistLink({ round, reload }: { round: Round; reload: () => void }) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function makePlaylist() {
    setBusy(true);
    setError(null);
    try {
      await createRoundPlaylist(round);
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (round.playlist_url) {
    return (
      <a className="button" href={round.playlist_url} target="_blank" rel="noreferrer">
        Open playlist in Spotify
      </a>
    );
  }
  if (!profile?.is_host) return <p className="muted">The host hasn't created the playlist yet.</p>;
  return (
    <div className="card">
      <p>No playlist yet.</p>
      <button disabled={busy} onClick={makePlaylist}>
        {busy ? 'Creating…' : 'Create Spotify playlist'}
      </button>
      <ErrorNotice error={error} />
    </div>
  );
}

function Results({ results, profiles }: { results: ResultRow[]; profiles: Profile[] }) {
  const names = new Map(profiles.map((p) => [p.id, p.display_name]));

  return (
    <>
      <h2>Results</h2>
      <div className="table-wrap">
        <table className="results">
          <thead>
            <tr>
              <th>#</th>
              <th>Song</th>
              <th>Picked by</th>
              <th className="num">Votes</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={r.submission_id}>
                <td>{i + 1}</td>
                <td>
                  <TrackRow title={r.title} artists={r.artists} imageUrl={r.image_url} />
                  {r.note && <p className="note">“{r.note}”</p>}
                </td>
                <td>{names.get(r.user_id) ?? 'Unknown'}</td>
                <td className="num">{r.vote_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
