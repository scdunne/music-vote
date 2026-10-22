import type { Round, Submission, Vote } from './types';

/** Everything the stats page needs, already limited to closed rounds. */
export interface StatsInput {
  rounds: Round[];
  submissions: Submission[];
  votes: Vote[];
}

export interface LeaderRow {
  userId: string;
  roundsPlayed: number;
  wins: number;
  votesReceived: number;
  /** Average share of each round's votes that went to this member's songs (0..1). */
  avgShare: number;
}

export interface TopSong {
  submission: Submission;
  round: Round;
  votes: number;
}

export interface VoterStyle {
  userId: string;
  /** Average fraction of a round's budget put on a single song (1 = everything on one song). */
  allIn: number;
  /** Average number of different songs voted for per round. */
  songsPerRound: number;
}

export interface Pair {
  a: string;
  b: string;
  aToB: number;
  bToA: number;
}

export interface Stats {
  members: string[];
  leaderboard: LeaderRow[];
  /** votesGiven.get(voter).get(submitter) = total votes, across all closed rounds. */
  votesGiven: Map<string, Map<string, number>>;
  votesCast: Map<string, number>;
  topSongs: TopSong[];
  styles: VoterStyle[];
  mutualPair: Pair | null;
}

function bump<K>(map: Map<K, number>, key: K, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

export function computeStats({ rounds, submissions, votes }: StatsInput): Stats {
  const subById = new Map(submissions.map((s) => [s.id, s]));
  const votesPerSub = new Map<string, number>();
  for (const v of votes) bump(votesPerSub, v.submission_id);

  const members = new Set<string>();
  submissions.forEach((s) => members.add(s.user_id));
  votes.forEach((v) => members.add(v.voter_id));

  // Leaderboard.
  const received = new Map<string, number>();
  const wins = new Map<string, number>();
  const played = new Map<string, number>();
  const shareSum = new Map<string, number>();
  const subsByRound = groupBy(submissions, (s) => s.round_id);
  const votesByRound = groupBy(votes, (v) => v.round_id);

  for (const round of rounds) {
    const subs = subsByRound.get(round.id) ?? [];
    if (subs.length === 0) continue;
    const roundTotal = (votesByRound.get(round.id) ?? []).length;
    const perUser = new Map<string, number>();
    for (const s of subs) {
      perUser.set(s.user_id, (perUser.get(s.user_id) ?? 0) + (votesPerSub.get(s.id) ?? 0));
    }
    for (const [userId, n] of perUser) {
      bump(received, userId, n);
      bump(played, userId);
      if (roundTotal > 0) bump(shareSum, userId, n / roundTotal);
    }
    // Same rule as the round results: most votes, ties go to the earlier submission.
    if (roundTotal > 0) {
      const winner = [...subs].sort(
        (a, b) => (votesPerSub.get(b.id) ?? 0) - (votesPerSub.get(a.id) ?? 0) || a.created_at.localeCompare(b.created_at),
      )[0];
      bump(wins, winner.user_id);
    }
  }

  const leaderboard: LeaderRow[] = [...members]
    .map((userId) => ({
      userId,
      roundsPlayed: played.get(userId) ?? 0,
      wins: wins.get(userId) ?? 0,
      votesReceived: received.get(userId) ?? 0,
      avgShare: (shareSum.get(userId) ?? 0) / Math.max(played.get(userId) ?? 0, 1),
    }))
    .sort((a, b) => b.votesReceived - a.votesReceived || b.wins - a.wins || b.avgShare - a.avgShare);

  // Who votes for whom.
  const votesGiven = new Map<string, Map<string, number>>();
  const votesCast = new Map<string, number>();
  for (const v of votes) {
    const sub = subById.get(v.submission_id);
    if (!sub) continue;
    let row = votesGiven.get(v.voter_id);
    if (!row) votesGiven.set(v.voter_id, (row = new Map()));
    bump(row, sub.user_id);
    bump(votesCast, v.voter_id);
  }

  // Best songs of all time, by votes in their round.
  const roundById = new Map(rounds.map((r) => [r.id, r]));
  const topSongs: TopSong[] = submissions
    .map((s) => ({ submission: s, round: roundById.get(s.round_id)!, votes: votesPerSub.get(s.id) ?? 0 }))
    .filter((t) => t.round && t.votes > 0)
    .sort((a, b) => b.votes - a.votes || a.submission.created_at.localeCompare(b.submission.created_at))
    .slice(0, 5);

  // Voting style: how concentrated each voter's ballot is, per round.
  const styles: VoterStyle[] = [];
  for (const [voter, theirVotes] of groupBy(votes, (v) => v.voter_id)) {
    const ballots = [...groupBy(theirVotes, (v) => v.round_id)];
    let allInSum = 0;
    let songsSum = 0;
    for (const [roundId, ballot] of ballots) {
      const perSong = new Map<string, number>();
      ballot.forEach((v) => bump(perSong, v.submission_id));
      const budget = Math.max(roundById.get(roundId)?.votes_per_member ?? ballot.length, ballot.length);
      allInSum += Math.max(...perSong.values()) / budget;
      songsSum += perSong.size;
    }
    styles.push({ userId: voter, allIn: allInSum / ballots.length, songsPerRound: songsSum / ballots.length });
  }

  // The two members who gave each other the most votes: ranked by the smaller
  // direction (so it's mutual), then by the total.
  let mutualPair: Pair | null = null;
  const beats = (p: Pair, q: Pair) =>
    Math.min(p.aToB, p.bToA) - Math.min(q.aToB, q.bToA) || p.aToB + p.bToA - (q.aToB + q.bToA);
  const list = [...members];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const pair = {
        a: list[i],
        b: list[j],
        aToB: votesGiven.get(list[i])?.get(list[j]) ?? 0,
        bToA: votesGiven.get(list[j])?.get(list[i]) ?? 0,
      };
      if (Math.min(pair.aToB, pair.bToA) > 0 && (!mutualPair || beats(pair, mutualPair) > 0)) mutualPair = pair;
    }
  }

  return {
    members: leaderboard.map((r) => r.userId),
    leaderboard,
    votesGiven,
    votesCast,
    topSongs,
    styles,
    mutualPair,
  };
}

/** For each member, who gave them the biggest share of their own votes. */
export function biggestFans(stats: Stats): Map<string, { fan: string; votes: number; share: number }> {
  const out = new Map<string, { fan: string; votes: number; share: number }>();
  for (const [voter, row] of stats.votesGiven) {
    const cast = stats.votesCast.get(voter) ?? 0;
    for (const [target, votes] of row) {
      const share = votes / cast;
      const best = out.get(target);
      if (!best || share > best.share || (share === best.share && votes > best.votes)) {
        out.set(target, { fan: voter, votes, share });
      }
    }
  }
  return out;
}
