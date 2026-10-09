import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { closeRound, createRound, deleteRound, listRounds, updateRound, useAsync } from '../data';
import type { Round, RoundStatus } from '../types';
import { ErrorNotice, PhaseBadge } from '../components/bits';

const NEXT: Partial<Record<RoundStatus, { status: RoundStatus; label: string }>> = {
  draft: { status: 'submitting', label: 'Open submissions' },
  submitting: { status: 'voting', label: 'Start voting' },
};
const PREV: Partial<Record<RoundStatus, RoundStatus>> = { submitting: 'draft', voting: 'submitting' };

/** <input type="datetime-local"> value -> ISO string (or null). */
function toIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export default function Host() {
  const { data: rounds, error, reload } = useAsync(listRounds, []);
  const open = (rounds ?? []).filter((r) => r.status !== 'closed');

  return (
    <>
      <h1>Host</h1>
      <ErrorNotice error={error} />
      <h2>Rounds in progress</h2>
      {open.length === 0 && <p className="muted">Nothing in progress. Create a round below.</p>}
      {open.map((r) => (
        <HostControls key={r.id} round={r} reload={reload} />
      ))}
      <NewRoundForm onCreated={reload} />
    </>
  );
}

function HostControls({ round, reload }: { round: Round; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [onlyVoted, setOnlyVoted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const next = NEXT[round.status];
  const prev = PREV[round.status];

  async function run(action: () => Promise<unknown>) {
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
    <div className="card">
      <div className="row">
        <span className="muted">#{round.number}</span>
        <PhaseBadge status={round.status} />
        <Link to={`/round/${round.id}`}>
          <strong>{round.theme}</strong>
        </Link>
      </div>
      <p className="muted small">
        {round.songs_per_member} song(s) and {round.votes_per_member} vote(s) per member
      </p>
      <div className="row wrap">
        {next && (
          <button disabled={busy} onClick={() => run(() => updateRound(round.id, { status: next.status }))}>
            {next.label}
          </button>
        )}
        {round.status === 'voting' && (
          <>
            <button disabled={busy} onClick={() => run(() => closeRound(round, onlyVoted))}>
              {busy ? 'Closing…' : 'Close round and create playlist'}
            </button>
            <label className="check">
              <input type="checkbox" checked={onlyVoted} onChange={(e) => setOnlyVoted(e.target.checked)} />
              Only songs with votes
            </label>
          </>
        )}
        {prev && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => run(() => updateRound(round.id, { status: prev }))}
          >
            Back to {prev}
          </button>
        )}
        {round.status === 'draft' &&
          (confirmDelete ? (
            <>
              <button className="danger" disabled={busy} onClick={() => run(() => deleteRound(round.id))}>
                Really delete
              </button>
              <button className="secondary" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </>
          ) : (
            <button className="secondary" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          ))}
      </div>
      <ErrorNotice error={error} />
    </div>
  );
}

function NewRoundForm({ onCreated }: { onCreated: () => void }) {
  const [theme, setTheme] = useState('');
  const [description, setDescription] = useState('');
  const [songs, setSongs] = useState(2);
  const [votes, setVotes] = useState(3);
  const [submitDeadline, setSubmitDeadline] = useState('');
  const [voteDeadline, setVoteDeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createRound({
        theme: theme.trim(),
        description: description.trim() || null,
        songs_per_member: songs,
        votes_per_member: votes,
        submit_deadline: toIso(submitDeadline),
        vote_deadline: toIso(voteDeadline),
      });
      setTheme('');
      setDescription('');
      setSubmitDeadline('');
      setVoteDeadline('');
      onCreated();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>New round</h2>
      <label>
        Theme
        <input required value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Songs that sound like summer" />
      </label>
      <label>
        Description (optional)
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="row wrap">
        <label>
          Songs per member
          <input type="number" min={1} max={10} value={songs} onChange={(e) => setSongs(Number(e.target.value))} />
        </label>
        <label>
          Votes per member
          <input type="number" min={1} max={20} value={votes} onChange={(e) => setVotes(Number(e.target.value))} />
        </label>
      </div>
      <div className="row wrap">
        <label>
          Submission deadline (optional)
          <input type="datetime-local" value={submitDeadline} onChange={(e) => setSubmitDeadline(e.target.value)} />
        </label>
        <label>
          Voting deadline (optional)
          <input type="datetime-local" value={voteDeadline} onChange={(e) => setVoteDeadline(e.target.value)} />
        </label>
      </div>
      <p className="muted small">New rounds start as drafts that only you can see.</p>
      <button disabled={busy}>Create draft round</button>
      <ErrorNotice error={error} />
    </form>
  );
}
