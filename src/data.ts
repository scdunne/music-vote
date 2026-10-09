import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { createPlaylist, hasSpotifyToken, SpotifyError, type SpotifyTrack, albumImage } from './spotify';
import type { Profile, ResultRow, Round, Submission, Vote } from './types';

/** Turns Postgres/PostgREST errors into messages fit for the UI. */
function check<T>({ data, error }: { data: T | null; error: { code?: string; message: string } | null }): T {
  if (error) {
    if (error.code === '23505') throw new Error('That one is already taken. Someone already picked that song, or you already voted for it.');
    if (error.code === '42501') throw new Error("You can't do that right now. The round may have moved to the next phase.");
    throw new Error(error.message);
  }
  return data as T;
}

export async function listRounds(): Promise<Round[]> {
  return check(await supabase.from('rounds').select('*').order('number', { ascending: false }));
}

export async function getRound(id: string): Promise<Round | null> {
  return check(await supabase.from('rounds').select('*').eq('id', id).maybeSingle());
}

export async function listProfiles(): Promise<Profile[]> {
  return check(await supabase.from('profiles').select('*'));
}

export async function listSubmissions(roundId: string): Promise<Submission[]> {
  return check(await supabase.from('submissions').select('*').eq('round_id', roundId).order('created_at'));
}

/** Your own votes while voting; everyone's once the round is closed (RLS decides). */
export async function listVotes(roundId: string): Promise<Vote[]> {
  return check(await supabase.from('votes').select('*').eq('round_id', roundId));
}

export async function listResults(roundId: string): Promise<ResultRow[]> {
  return check(
    await supabase
      .from('round_results')
      .select('*')
      .eq('round_id', roundId)
      .order('vote_count', { ascending: false })
      .order('created_at', { ascending: true }),
  );
}

export type RoundInput = Pick<
  Round,
  'theme' | 'description' | 'songs_per_member' | 'votes_per_member' | 'submit_deadline' | 'vote_deadline'
>;

export async function createRound(input: RoundInput): Promise<Round> {
  return check(await supabase.from('rounds').insert(input).select().single());
}

export async function updateRound(id: string, patch: Partial<Round>): Promise<void> {
  check(await supabase.from('rounds').update(patch).eq('id', id));
}

export async function deleteRound(id: string): Promise<void> {
  check(await supabase.from('rounds').delete().eq('id', id));
}

export async function addSubmission(roundId: string, userId: string, track: SpotifyTrack, note: string) {
  check(
    await supabase.from('submissions').insert({
      round_id: roundId,
      user_id: userId,
      spotify_track_id: track.id,
      track_uri: track.uri,
      title: track.name,
      artists: track.artists.map((a) => a.name).join(', '),
      album: track.album.name,
      image_url: albumImage(track),
      note: note.trim() || null,
    }),
  );
}

export async function deleteSubmission(id: string) {
  check(await supabase.from('submissions').delete().eq('id', id));
}

export async function castVote(roundId: string, submissionId: string, voterId: string) {
  check(await supabase.from('votes').insert({ round_id: roundId, submission_id: submissionId, voter_id: voterId }));
}

export async function removeVote(id: string) {
  check(await supabase.from('votes').delete().eq('id', id));
}

/** Builds the results playlist in the host's Spotify account and saves its URL on the round. */
export async function createRoundPlaylist(round: Round, onlyVoted: boolean): Promise<string> {
  const results = await listResults(round.id);
  const uris = results.filter((r) => !onlyVoted || r.vote_count > 0).map((r) => r.track_uri);
  if (uris.length === 0) throw new Error('There are no songs to put in the playlist.');
  const description = (round.description?.replace(/\s+/g, ' ') || `Results of Music Vote round #${round.number}`).slice(0, 300);
  const url = await createPlaylist(`Music Vote #${round.number}: ${round.theme}`, description, uris);
  await updateRound(round.id, { playlist_url: url });
  return url;
}

/** Closes the round, then builds the playlist. If the playlist step fails, the host can retry from the round page. */
export async function closeRound(round: Round, onlyVoted: boolean): Promise<string> {
  // Check this first so the round doesn't close without a usable Spotify token.
  if (!hasSpotifyToken()) throw new SpotifyError(401, 'Reconnect Spotify before closing so the playlist can be created.');
  await updateRound(round.id, { status: 'closed' });
  return createRoundPlaylist({ ...round, status: 'closed' }, onlyVoted);
}

/** Minimal data-loading hook: { data, error, loading, reload }. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => !cancelled && setState({ data, loading: false }),
      (error: Error) => !cancelled && setState({ error, loading: false }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
