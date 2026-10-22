import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { getSettings, listProfiles, loadClosedRoundData, updateSettings, useAsync } from '../data';
import { biggestFans, computeStats, type Stats as StatsData } from '../stats';
import type { Profile } from '../types';
import { ErrorNotice, TrackRow } from '../components/bits';

async function loadStats() {
  const [data, profiles, settings] = await Promise.all([loadClosedRoundData(), listProfiles(), getSettings()]);
  return { roundCount: data.rounds.length, stats: computeStats(data), profiles, settings };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function Stats() {
  const { profile } = useAuth();
  const { data, error, loading, reload } = useAsync(loadStats, []);
  if (loading && !data) return <p className="muted">Loading…</p>;
  if (error) return <ErrorNotice error={error} />;

  const { roundCount, stats, profiles, settings } = data!;
  const released = settings.highlights_released;
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const name = (id: string) => byId.get(id)?.display_name ?? 'Former member';

  return (
    <>
      <h1>Stats</h1>
      {roundCount === 0 || stats.members.length === 0 ? (
        <p className="muted">Stats appear once the first round closes.</p>
      ) : (
        <>
          <p className="muted">
            All-time, across {plural(roundCount, 'closed round')}. Rounds still in progress don't count yet.
          </p>
          <Leaderboard stats={stats} byId={byId} name={name} />
          {profile?.is_host && <ReleaseControl released={released} reload={reload} />}
          {(released || profile?.is_host) && <Highlights stats={stats} name={name} preview={!released} />}
          <TopSongs stats={stats} name={name} />
          <VoteGrid stats={stats} name={name} />
        </>
      )}
    </>
  );
}

function Member({ profile, fallback }: { profile?: Profile; fallback: string }) {
  return (
    <span className="member">
      {profile?.avatar_url ? <img className="avatar" src={profile.avatar_url} alt="" /> : <span className="avatar" />}
      {profile?.display_name ?? fallback}
    </span>
  );
}

function Leaderboard(props: { stats: StatsData; byId: Map<string, Profile>; name: (id: string) => string }) {
  const { stats, byId, name } = props;
  return (
    <>
      <h2>Leaderboard</h2>
      <div className="table-wrap">
        <table className="results">
          <thead>
            <tr>
              <th>#</th>
              <th>Member</th>
              <th className="num">Votes</th>
              <th className="num">Wins</th>
              <th className="num" title="Average share of each round's votes that went to their songs">
                Avg share
              </th>
              <th className="num">Rounds</th>
            </tr>
          </thead>
          <tbody>
            {stats.leaderboard.map((r, i) => (
              <tr key={r.userId}>
                <td>{i + 1}</td>
                <td>
                  <Member profile={byId.get(r.userId)} fallback={name(r.userId)} />
                </td>
                <td className="num">{r.votesReceived}</td>
                <td className="num">{r.wins}</td>
                <td className="num">{r.roundsPlayed ? pct(r.avgShare) : '–'}</td>
                <td className="num">{r.roundsPlayed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Votes are everything their songs have received. Avg share evens out rounds with bigger or smaller vote budgets.
      </p>
    </>
  );
}

/** Host-only switch for showing the highlights to everyone. */
function ReleaseControl({ released, reload }: { released: boolean; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await updateSettings({ highlights_released: !released });
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card row wrap">
      <span className="grow small">
        {released
          ? 'Highlights are visible to everyone.'
          : 'Highlights are hidden from members. Only you can see the preview below.'}
      </span>
      <button className={released ? 'secondary small' : 'small'} disabled={busy} onClick={toggle}>
        {released ? 'Hide highlights' : 'Release highlights'}
      </button>
      <ErrorNotice error={error} />
    </div>
  );
}

function Highlights(props: { stats: StatsData; name: (id: string) => string; preview: boolean }) {
  const { stats, name, preview } = props;
  const allIn = [...stats.styles].sort((a, b) => b.allIn - a.allIn)[0];
  const spreader = [...stats.styles].sort((a, b) => b.songsPerRound - a.songsPerRound)[0];
  const pair = stats.mutualPair;

  return (
    <>
      <h2>
        Highlights{preview && <span className="muted small"> (preview: only you can see these)</span>}
      </h2>
      <div className="stat-grid">
        {pair && (
          <div className="card tight">
            <div className="muted small">Mutual admiration society</div>
            <strong>
              {name(pair.a)} & {name(pair.b)}
            </strong>
            <div className="small">
              {name(pair.a)} → {name(pair.b)}: {plural(pair.aToB, 'vote')}. {name(pair.b)} → {name(pair.a)}:{' '}
              {plural(pair.bToA, 'vote')}.
            </div>
          </div>
        )}
        {allIn && (
          <div className="card tight">
            <div className="muted small">Most all-in</div>
            <strong>{name(allIn.userId)}</strong>
            <div className="small">Puts {pct(allIn.allIn)} of their votes on one song, on average.</div>
          </div>
        )}
        {spreader && spreader.userId !== allIn?.userId && (
          <div className="card tight">
            <div className="muted small">Spreads the love</div>
            <strong>{name(spreader.userId)}</strong>
            <div className="small">Votes for {spreader.songsPerRound.toFixed(1)} different songs per round.</div>
          </div>
        )}
      </div>
    </>
  );
}

function TopSongs({ stats, name }: { stats: StatsData; name: (id: string) => string }) {
  if (stats.topSongs.length === 0) return null;
  return (
    <>
      <h2>Top songs of all time</h2>
      <div className="list">
        {stats.topSongs.map(({ submission: s, round, votes }) => (
          <TrackRow key={s.id} title={s.title} artists={s.artists} imageUrl={s.image_url}>
            <div className="top-song-meta small">
              <strong>{plural(votes, 'vote')}</strong>
              <span className="muted">
                {name(s.user_id)} · <Link to={`/round/${round.id}`}>#{round.number}</Link>
              </span>
            </div>
          </TrackRow>
        ))}
      </div>
    </>
  );
}

function VoteGrid({ stats, name }: { stats: StatsData; name: (id: string) => string }) {
  const fans = biggestFans(stats);
  const voters = stats.members.filter((m) => (stats.votesCast.get(m) ?? 0) > 0);
  if (voters.length === 0) return null;

  return (
    <>
      <h2>Who votes for whom</h2>
      <p className="muted small">
        Each row is a voter. Cells show how many votes they gave each person's songs, shaded by the share of all their
        votes.
      </p>
      <div className="table-wrap">
        <table className="results vote-grid">
          <thead>
            <tr>
              <th>Voter ↓ / For →</th>
              {stats.members.map((m) => (
                <th key={m} className="num">
                  {name(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {voters.map((voter) => {
              const cast = stats.votesCast.get(voter) ?? 0;
              return (
                <tr key={voter}>
                  <th scope="row">{name(voter)}</th>
                  {stats.members.map((target) => {
                    if (target === voter) {
                      return (
                        <td key={target} className="num muted">
                          –
                        </td>
                      );
                    }
                    const n = stats.votesGiven.get(voter)?.get(target) ?? 0;
                    const share = cast ? n / cast : 0;
                    return (
                      <td
                        key={target}
                        className="num"
                        style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(share * 55)}%, transparent)` }}
                        title={`${name(voter)} gave ${name(target)} ${plural(n, 'vote')} (${pct(share)} of their votes)`}
                      >
                        {n}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {fans.size > 0 && (
        <>
          <h2>Biggest fans</h2>
          <ul className="plain">
            {stats.members
              .filter((m) => fans.has(m))
              .map((m) => {
                const f = fans.get(m)!;
                return (
                  <li key={m}>
                    <strong>{name(m)}</strong>'s biggest fan is <strong>{name(f.fan)}</strong>
                    <span className="muted">
                      {' '}
                      ({plural(f.votes, 'vote')}, {pct(f.share)} of everything they've cast)
                    </span>
                  </li>
                );
              })}
          </ul>
        </>
      )}
    </>
  );
}
