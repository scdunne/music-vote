export type RoundStatus = 'draft' | 'submitting' | 'voting' | 'closed';

export interface Profile {
  id: string;
  spotify_id: string | null;
  display_name: string;
  avatar_url: string | null;
  is_host: boolean;
}

export interface Round {
  id: string;
  number: number;
  theme: string;
  description: string | null;
  status: RoundStatus;
  songs_per_member: number;
  votes_per_member: number;
  submit_deadline: string | null;
  vote_deadline: string | null;
  playlist_url: string | null;
  created_at: string;
}

export interface Submission {
  id: string;
  round_id: string;
  user_id: string;
  spotify_track_id: string;
  track_uri: string;
  title: string;
  artists: string;
  album: string | null;
  image_url: string | null;
  note: string | null;
  created_at: string;
}

export interface Vote {
  id: string;
  round_id: string;
  submission_id: string;
  voter_id: string;
}

export interface ResultRow {
  round_id: string;
  submission_id: string;
  user_id: string;
  spotify_track_id: string;
  title: string;
  artists: string;
  album: string | null;
  track_uri: string;
  image_url: string | null;
  note: string | null;
  created_at: string;
  vote_count: number;
}
