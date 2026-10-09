import { useEffect, useState, type ReactNode } from 'react';
import { signInWithSpotify, SpotifyError } from '../spotify';
import type { RoundStatus } from '../types';

const PHASE_LABELS: Record<RoundStatus, string> = {
  draft: 'Draft',
  submitting: 'Submissions open',
  voting: 'Voting',
  closed: 'Closed',
};

export function PhaseBadge({ status }: { status: RoundStatus }) {
  return <span className={`badge badge-${status}`}>{PHASE_LABELS[status]}</span>;
}

function formatRemaining(ms: number): string {
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${Math.max(mins, 1)}m`;
}

/** Deadlines are advisory: the host still advances phases by hand. */
export function Countdown({ deadline, label }: { deadline: string | null; label: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - now;
  return (
    <span className="muted small">
      {ms > 0 ? `${label} in ${formatRemaining(ms)}` : `${label} deadline passed`}
    </span>
  );
}

/** Error box; for expired Spotify tokens it offers a one-click reconnect. */
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const needsReconnect = error instanceof SpotifyError && error.status === 401;
  return (
    <div className="error">
      {message}{' '}
      {needsReconnect && (
        <button className="small" onClick={() => signInWithSpotify()}>
          Reconnect Spotify
        </button>
      )}
    </div>
  );
}

export function SpotifyEmbed({ trackId }: { trackId: string }) {
  return (
    <iframe
      className="embed"
      src={`https://open.spotify.com/embed/track/${trackId}?utm_source=generator`}
      height="80"
      loading="lazy"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      title="Spotify player"
    />
  );
}

/** Compact track row: art, title, artists, and whatever actions are passed in. */
export function TrackRow(props: {
  title: string;
  artists: string;
  imageUrl: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="track-row">
      {props.imageUrl ? <img className="art" src={props.imageUrl} alt="" /> : <div className="art" />}
      <div className="track-text">
        <div className="track-title">{props.title}</div>
        <div className="muted small">{props.artists}</div>
      </div>
      <div className="track-actions">{props.children}</div>
    </div>
  );
}
