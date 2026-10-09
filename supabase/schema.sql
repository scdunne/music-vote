-- Music Vote schema. Paste into the Supabase SQL editor and run once.
-- Based on section 4 of the design doc, with two additions:
--   * allowed_emails: anyone with a Spotify account can sign in to Supabase,
--     so every policy also requires the user's email to be on this list.
--   * votes are only readable by their owner until the round closes, so
--     nobody can peek at standings during voting.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Member allowlist (use the same emails you add in the Spotify dashboard).
-- No policies, so clients can never read or write it; edit in the dashboard.
create table allowed_emails (
  email text primary key
);

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
  songs_per_member int not null default 2 check (songs_per_member > 0),
  votes_per_member int not null default 3 check (votes_per_member > 0),
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
  note text,
  created_at timestamptz not null default now(),
  unique (round_id, spotify_track_id)
);

create table votes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  submission_id uuid not null references submissions(id) on delete cascade,
  voter_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (submission_id, voter_id)
);

create index on submissions (round_id);
create index on votes (round_id);

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

create function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from allowed_emails
    where lower(email) = lower(auth.jwt() ->> 'email')
  )
$$;

create function is_host() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_host from profiles where id = auth.uid()), false)
$$;

create function round_status_of(r uuid) returns round_status
language sql stable security definer set search_path = public as $$
  select status from rounds where id = r
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Only the SQL editor / service role may change is_host. API users
-- (role "authenticated") get their change silently undone.
create function protect_is_host() returns trigger
language plpgsql as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.is_host := false;
    else
      new.is_host := old.is_host;
    end if;
  end if;
  return new;
end $$;

create trigger profiles_protect_is_host
  before insert or update on profiles
  for each row execute function protect_is_host();

create function check_submission_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lim int;
  n int;
begin
  select songs_per_member into lim from rounds where id = new.round_id;
  select count(*) into n from submissions
    where round_id = new.round_id and user_id = new.user_id;
  if n >= lim then
    raise exception 'You can submit at most % song(s) this round.', lim;
  end if;
  return new;
end $$;

create trigger submissions_limit
  before insert on submissions
  for each row execute function check_submission_limit();

create function check_vote_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sub_round uuid;
  lim int;
  n int;
begin
  select round_id into sub_round from submissions where id = new.submission_id;
  if sub_round is distinct from new.round_id then
    raise exception 'Vote round does not match the submission''s round.';
  end if;
  select votes_per_member into lim from rounds where id = new.round_id;
  select count(*) into n from votes
    where round_id = new.round_id and voter_id = new.voter_id;
  if n >= lim then
    raise exception 'You can cast at most % vote(s) this round.', lim;
  end if;
  return new;
end $$;

create trigger votes_limit
  before insert on votes
  for each row execute function check_vote_limit();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table allowed_emails enable row level security;
alter table profiles       enable row level security;
alter table rounds         enable row level security;
alter table submissions    enable row level security;
alter table votes          enable row level security;

-- profiles
create policy "profiles read" on profiles for select to authenticated
  using (is_member());
create policy "profiles insert" on profiles for insert to authenticated
  with check (is_member() and id = auth.uid() and is_host = false);
create policy "profiles update" on profiles for update to authenticated
  using (is_member() and id = auth.uid())
  with check (id = auth.uid());

-- rounds: members read (drafts are host-only); only the host writes
create policy "rounds read" on rounds for select to authenticated
  using (is_member() and (status <> 'draft' or is_host()));
create policy "rounds write" on rounds for all to authenticated
  using (is_member() and is_host())
  with check (is_member() and is_host());

-- submissions
create policy "subs read" on submissions for select to authenticated
  using (is_member());
create policy "subs insert" on submissions for insert to authenticated
  with check (
    is_member()
    and user_id = auth.uid()
    and round_status_of(round_id) = 'submitting'
  );
create policy "subs delete" on submissions for delete to authenticated
  using (user_id = auth.uid() and round_status_of(round_id) = 'submitting');

-- votes: you see your own votes; everyone's become visible once closed
create policy "votes read" on votes for select to authenticated
  using (
    is_member()
    and (voter_id = auth.uid() or round_status_of(round_id) = 'closed')
  );
create policy "votes insert" on votes for insert to authenticated
  with check (
    is_member()
    and voter_id = auth.uid()
    and round_status_of(round_id) = 'voting'
    and not exists (
      select 1 from submissions s
      where s.id = submission_id and s.user_id = auth.uid()
    )
  );
create policy "votes delete" on votes for delete to authenticated
  using (voter_id = auth.uid() and round_status_of(round_id) = 'voting');

-- ---------------------------------------------------------------------------
-- Results view (security_invoker so it respects the policies above)
-- ---------------------------------------------------------------------------

create view round_results with (security_invoker = true) as
select s.round_id, s.id as submission_id, s.user_id, s.spotify_track_id,
       s.title, s.artists, s.album, s.track_uri, s.image_url, s.note,
       s.created_at, count(v.id)::int as vote_count
from submissions s
left join votes v on v.submission_id = s.id
group by s.id;

-- ---------------------------------------------------------------------------
-- After running: add members, then (after the host's first login) the host.
-- ---------------------------------------------------------------------------
-- insert into allowed_emails (email) values
--   ('you@example.com'), ('friend1@example.com'), ('friend2@example.com'),
--   ('friend3@example.com'), ('friend4@example.com');
--
-- update profiles set is_host = true
--   where id = (select id from auth.users where email = 'you@example.com');
