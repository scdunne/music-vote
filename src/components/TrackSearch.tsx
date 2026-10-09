import { useEffect, useState } from 'react';
import { albumImage, searchTracks, SEARCH_PAGE_SIZE, type SpotifyTrack } from '../spotify';
import { ErrorNotice, SpotifyEmbed, TrackRow } from './bits';

interface Props {
  onPick: (track: SpotifyTrack) => void;
  /** Track ids already in the round; shown but not pickable. */
  takenIds: Set<string>;
}

export default function TrackSearch({ onPick, takenIds }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpotifyTrack[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Debounce so we stay well inside Spotify's dev-mode request quota.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setHasMore(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const page = await searchTracks(q, 0);
        if (cancelled) return;
        setResults(page.items);
        setHasMore(Boolean(page.next));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  async function loadMore() {
    setLoading(true);
    try {
      const page = await searchTracks(query.trim(), results.length);
      setResults((r) => [...r, ...page.items]);
      setHasMore(Boolean(page.next) && page.items.length === SEARCH_PAGE_SIZE);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="search">
      <input
        type="search"
        placeholder="Search Spotify for a song or artist…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <ErrorNotice error={error} />
      <div className="list">
        {results.map((t) => {
          const taken = takenIds.has(t.id);
          return (
            <div key={t.id}>
              <TrackRow title={t.name} artists={t.artists.map((a) => a.name).join(', ')} imageUrl={albumImage(t)}>
                <button className="secondary small" onClick={() => setPreviewId(previewId === t.id ? null : t.id)}>
                  {previewId === t.id ? 'Hide' : 'Preview'}
                </button>
                <button className="small" disabled={taken} onClick={() => onPick(t)}>
                  {taken ? 'Already in round' : 'Pick'}
                </button>
              </TrackRow>
              {previewId === t.id && <SpotifyEmbed trackId={t.id} />}
            </div>
          );
        })}
      </div>
      {loading && <p className="muted small">Searching…</p>}
      {hasMore && !loading && (
        <button className="secondary" onClick={loadMore}>
          More results
        </button>
      )}
    </div>
  );
}
