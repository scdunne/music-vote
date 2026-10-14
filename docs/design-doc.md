# Music Vote: Design Doc

A tiny private website where a small group of friends runs music "rounds". Each round has a theme, everyone submits songs found via Spotify search, the host's Spotify account gets an auto-generated playlist of the submissions to listen to, and everyone votes.

This document is a handoff spec for Claude Code. Build it in the milestone order at the bottom. Items marked **VERIFY** are things the author could not confirm and must be checked against current Spotify/Supabase docs before relying on them.

---

## 1. Goals and non-goals

**Goals**
- Free to host and run ($0).
- A handful of members (currently 6) logging in by email. Only the host connects a Spotify account.
- Search Spotify for tracks, submit them to a round, auto-create a playlist of the submissions when voting opens, and vote.
- Static frontend (GitHub Pages) plus a hosted database (Supabase). No custom server beyond one Supabase Edge Function for search.

**Non-goals**
- Large groups. Spotify's dev-mode request quota still applies (see section 2).
- Recommendations or audio-feature-based features (removed from Spotify's API for new apps).
- In-app full-track playback. Use Spotify embeds for listening.

---

## 2. Spotify constraints (design drivers)

- The app runs in Spotify **development mode**. The app owner (the host) must have an active **Spotify Premium** subscription or the app stops working.
- Development mode allows **up to 5 authenticated Spotify users**, each of whom must be added to the app's **allowlist** in the Spotify Developer Dashboard (needs each person's name and Spotify account email). Non-allowlisted users can log in but get 403s on API calls.
  - **Update (Oct 2026):** to fit more than 5 members, only the host authorizes with Spotify. Members sign in with an emailed link and search through the `spotify-search` edge function, which uses the app's Client Credentials token and doesn't count toward the cap.
- Extended quota mode is not realistic (organizations only, 250k MAU requirement).
- Endpoints/fields removed or changed in the Nov 2024 and Feb 2026 API changes. Do not use outdated tutorials. In particular:
  - No recommendations, audio features, or related-artists endpoints.
  - Track/album/artist objects no longer include `popularity`, `available_markets`, `external_ids`, and some other fields. Do not depend on them.
  - Playlist objects renamed `tracks` to `items` (and playlist item `track` to `item`).
  - Search `limit` is capped (reportedly 10). Paginate with `offset`.
  - Library endpoints now take Spotify URIs rather than IDs (not needed by this app).
  - **VERIFY all of this** against the Spotify "February 2026 migration guide" and the current API reference, including the exact endpoints and payloads for creating a playlist and adding items to it.
- Dev-mode apps also have a request quota (separate from rate limits). Keep calls minimal: debounce search, never poll Spotify.

---

## 3. Architecture

```
Browser (GitHub Pages, static SPA)
   |-- Supabase Auth (email link; Spotify OAuth for the host only)
   |-- Supabase JS client (anon key + RLS) -----> Postgres (members, rounds, submissions, votes)
   |-- Edge Function spotify-search (app token) -> Spotify search
   |-- Spotify Web API (host's access token) ----> create playlist
```

- **Almost no backend.** All logic is client-side plus Postgres RLS and a few SQL functions/views. The one exception is the `spotify-search` edge function, which holds the Spotify client secret.
- **Auth:** Supabase Auth with email magic links for members (custom SMTP), plus the Spotify provider linked to the host's account. This gives every user a Supabase `auth.uid()` that RLS policies can use, and Supabase holds the Spotify client secret (it never goes in the repo or browser).
- **Spotify token:** after login, the Supabase session exposes the Spotify access token as `session.provider_token`. It is only reliably available at sign-in time and is not refreshed by Supabase. Therefore:
  - On the `SIGNED_IN` auth event, copy `provider_token` into `localStorage`.
  - Spotify tokens last about 1 hour. If a Spotify call returns 401, re-run sign-in (it is a one-click redirect) and retry.
  - **VERIFY:** current Supabase behavior for `provider_token`/`provider_refresh_token`. If it is awkward, a fallback is to implement Spotify's Authorization Code with PKCE flow directly in the client for the Spotify token and use Supabase only for identity.
- **Secrets:** the Supabase URL and anon key are public by design (safe because RLS is enabled on every table). Never commit the Spotify client secret or the Supabase service-role key.

### Tech stack
- Vite + React + TypeScript
- `react-router-dom` using **HashRouter** (GitHub Pages has no SPA fallback routing)
- `@supabase/supabase-js`
- Plain CSS or Tailwind (no heavy UI library)
- Deploy: GitHub Actions to GitHub Pages in a new repo (for example `music-vote`), with Vite `base` set to `/music-vote/`.

---

## 4. Data model (Supabase / Postgres)

### Tables

```sql
-- Members: one row per Spotify user, created on first login
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  spotify_id text unique,
  display_name text not null,
  avatar_url text,
  is_host boolean not null default false,
  created_at timestamptz not null default now()
);

create type round_status as enum ('draft', 'submitting', 'voting', 'closed');

create table rounds (
  id uuid primary key default gen_random_uuid(),
  number int generated always as identity,
  theme text not null,
  description text,
  status round_status not null default 'draft',
  songs_per_member int not null default 2,
  votes_per_member int not null default 3,
  submit_deadline timestamptz,
  vote_deadline timestamptz,
  playlist_url text,
  created_at timestamptz not null default now()
);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  spotify_track_id text not null,
  track_uri text not null,
  title text not null,
  artists text not null,
  album text,
  image_url text,
  note text,                                  -- optional "why I picked this"
  created_at timestamptz not null default now(),
  unique (round_id, spotify_track_id)         -- no duplicate songs in a round
);

create table votes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  submission_id uuid not null references submissions(id) on delete cascade,
  voter_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- no unique (submission_id, voter_id): one row per vote, and votes can stack on a song
);
```

### Helper functions

```sql
create function is_host() returns boolean
language sql stable security definer as $$
  select coalesce((select is_host from profiles where id = auth.uid()), false)
$$;

create function round_status_of(r uuid) returns round_status
language sql stable security definer as $$
  select status from rounds where id = r
$$;
```

### Row-level security (enable on all four tables)

```sql
alter table profiles    enable row level security;
alter table rounds      enable row level security;
alter table submissions enable row level security;
alter table votes       enable row level security;

-- profiles: everyone signed in can read; users can insert/update only their own row
create policy "profiles read"   on profiles for select to authenticated using (true);
create policy "profiles insert" on profiles for insert to authenticated with check (id = auth.uid() and is_host = false);
create policy "profiles update" on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- NOTE: prevent users from setting is_host on themselves. Add a trigger or
-- column-level privilege so only the SQL editor/service role can flip is_host.
-- Set the host manually once in the Supabase dashboard.

-- rounds: everyone reads; only host writes
create policy "rounds read"  on rounds for select to authenticated using (true);
create policy "rounds write" on rounds for all    to authenticated using (is_host()) with check (is_host());

-- submissions: everyone reads; insert own only while round is 'submitting'; delete own only while submitting
create policy "subs read"   on submissions for select to authenticated using (true);
create policy "subs insert" on submissions for insert to authenticated
  with check (user_id = auth.uid() and round_status_of(round_id) = 'submitting');
create policy "subs delete" on submissions for delete to authenticated
  using (user_id = auth.uid() and round_status_of(round_id) = 'submitting');

-- votes: everyone reads (or restrict; see anonymity note); insert own only while 'voting',
-- never on your own submission; delete own only while voting
create policy "votes read"   on votes for select to authenticated using (true);
create policy "votes insert" on votes for insert to authenticated
  with check (
    voter_id = auth.uid()
    and round_status_of(round_id) = 'voting'
    and not exists (select 1 from submissions s where s.id = submission_id and s.user_id = auth.uid())
  );
create policy "votes delete" on votes for delete to authenticated
  using (voter_id = auth.uid() and round_status_of(round_id) = 'voting');
```

### Limits that RLS alone does not enforce
Enforce these with a `BEFORE INSERT` trigger (raise an exception when violated), in addition to UI checks:
- A user may submit at most `rounds.songs_per_member` songs per round.
- A user may cast at most `rounds.votes_per_member` votes per round.
- `votes.round_id` must match the `round_id` of the referenced submission.

### Results view

```sql
create view round_results as
select s.round_id, s.id as submission_id, s.user_id, s.title, s.artists,
       s.track_uri, s.image_url, s.created_at,
       count(v.id) as vote_count
from submissions s
left join votes v on v.submission_id = s.id
group by s.id
order by s.round_id, vote_count desc, s.created_at asc;   -- ties: earlier submission first
```

### Anonymity (optional hardening)
During the `submitting` and `voting` phases the UI should hide who submitted what (reveal on `closed`). For 5 friends, hiding in the UI is enough. If stricter hiding is wanted, remove direct `select` on `submissions` and expose a view that nulls `user_id` and `note` authorship until the round is closed, and apply the same idea to `votes`.

---

## 5. Round lifecycle

`draft` to `submitting` to `voting` to `closed`. Only the host can change status (RLS on `rounds`).

1. **draft:** host creates a round (theme, description, limits, optional deadlines). Hidden or greyed out in the UI.
2. **submitting:** members search Spotify and submit up to `songs_per_member` tracks. Submitters hidden.
3. **voting:** host clicks "Start voting and create playlist". The app creates a Spotify playlist of every submission in the host's account and stores `playlist_url` on the round, so everyone can listen before voting. Members see all submissions (embedded Spotify players) and spend `votes_per_member` votes with +/− controls. They can stack several (even all) on one song, but none on their own. Submitters still hidden.
4. **closed:** host clicks "Close round". The app computes results (via `round_results`), and reveals submitters and vote counts.

Deadlines are advisory (shown as countdowns). The host advances phases manually. There is no cron or server to enforce them.

---

## 6. Spotify integration details

All calls go directly from the browser with `Authorization: Bearer <provider_token>`.

- **Scopes requested at login:** `playlist-modify-public` and `playlist-modify-private` (needed only for the host, but requesting for all is simplest). Search needs no scope. Consider also `user-read-email` since the Supabase Spotify provider typically needs email. **VERIFY** the minimum scopes the Supabase provider needs.
- **Search:** `GET /v1/search?q=<query>&type=track&limit=10&offset=<n>`. Debounce input about 400ms. Show title, artists, album art. On submit, store only: track id, URI, title, artists (joined string), album, image URL.
- **Create playlist (host only, when voting starts):** create a playlist in the host's account named like `Music Vote #<number>: <theme>`, then add the ordered track URIs. **VERIFY** the exact current endpoints and body shapes (the Feb 2026 changes touched playlist item naming). Save the returned playlist `external_urls.spotify` into `rounds.playlist_url`.
  - Include every submission, in the same stable shuffled order as the voting page (so the order doesn't reveal who submitted when).
  - Add at most 100 URIs per request.
- **Playback/listening:** use Spotify embed iframes (`https://open.spotify.com/embed/track/<id>`) for track preview in submit/vote lists. No SDK needed.
- **Error handling:** 401 re-login and retry; 403 show "Ask the host to add your Spotify email to the allowlist"; 429 back off and show a friendly message.

---

## 7. Frontend structure

Routes (HashRouter):

| Route | Purpose |
|---|---|
| `/` | Current round card with phase-aware primary action; list of past rounds |
| `/round/:id` | Round detail. Content depends on status (submit UI, vote UI, or results) |
| `/history` | Past rounds, playlists, winners |
| `/host` | Host-only: create round, change phase, start voting (creates the playlist), close |
| `/login` | "Log in with Spotify" button |

Key components: `TrackSearch`, `TrackCard` (with embed), `SubmissionList`, `VotePanel` (shows remaining votes), `ResultsTable`, `PhaseBadge`, `HostControls`.

State: use Supabase client queries plus a small data-fetching layer (React Query/TanStack Query is fine). Optionally subscribe to Supabase Realtime on `submissions` and `votes` for live updates (nice-to-have).

On first login, upsert the user's `profiles` row from the Spotify identity (display name, avatar). The host's `is_host` flag is set manually once in the Supabase dashboard.

---

## 8. Setup and deployment

**One-time setup (human steps)**
1. Spotify Developer Dashboard: create an app (Web API). Add redirect URI: the Supabase callback `https://<project-ref>.supabase.co/auth/v1/callback`. Add all 5 users' Spotify emails under User Management. Note the Client ID and Secret.
2. Supabase: create a free project. Enable the Spotify auth provider and paste the Client ID and Secret. Under Auth URL configuration, set the Site URL and redirect allow-list to the GitHub Pages URL (including `/music-vote/` and the hash route if needed). Run the SQL from section 4. Set the host's `is_host = true` after their first login.
3. GitHub: create a new repo, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Actions variables or secrets, enable Pages with the "GitHub Actions" source.
4. Local dev: Spotify requires HTTPS redirect URIs except loopback IPs (use `127.0.0.1`, not `localhost`). **VERIFY** current rules and add the local URL to the Supabase redirect allow-list.

**Deploy:** GitHub Actions workflow that runs `npm ci && npm run build` and publishes `dist/` to Pages on push to `main`.

**Cost notes:** GitHub Pages and the Supabase free tier are free. Free Supabase projects have historically paused after a period of inactivity (restore from the dashboard). **VERIFY** current free-tier limits.

---

## 9. Milestones (suggested build order for Claude Code)

1. Scaffold Vite + React + TS, HashRouter, and the GitHub Pages deploy workflow. Ship a "hello" page.
2. Supabase project wiring: run the SQL, then implement Spotify login via Supabase Auth, profile upsert, and capture of `provider_token`. Show "logged in as ..." with avatar.
3. Spotify search UI (`TrackSearch`) with debounce, pagination, and error handling (401/403/429).
4. Host page: create and advance rounds. Round list on the home page.
5. Submission flow with per-member limits (UI and DB trigger) and duplicate detection.
6. Voting flow with remaining-votes counter, no-self-votes, and limit trigger.
7. Start voting creates the Spotify playlist and stores `playlist_url`. Close round: results view, reveal submitters.
8. History page, polish, optional Realtime updates, countdown deadlines.
9. Tests: at minimum, SQL-level checks (or manual scripts) that RLS blocks the cases below.

**RLS acceptance checks**
- A non-host cannot update `rounds` or create rounds.
- A user cannot insert a submission when the round is not `submitting`, or as another user.
- A user cannot vote outside `voting`, on their own submission, or beyond `votes_per_member` (stacking several votes on one song is allowed).
- A user cannot set `is_host` on their own profile.

---

## 10. Open questions for the owner
- Songs per member and votes per member per round (defaults: 2 and 3).
- Is hiding submitters in the UI enough, or should the database enforce it?
- Does the owner count toward the 5-user limit? Check in the dashboard before inviting everyone.