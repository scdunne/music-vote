-- Lets the host see how many votes each member has cast during voting, so
-- they know when everyone is done. Returns counts only, never which songs,
-- and returns nothing for anyone but the host.
-- Run once in the Supabase SQL editor on a database created from an older
-- schema.sql. Fresh installs already include this.

create or replace function vote_progress(r uuid) returns table (voter_id uuid, votes_cast int)
language sql stable security definer set search_path = public as $$
  select v.voter_id, count(*)::int from votes v
  where v.round_id = r and is_member() and is_host()
  group by v.voter_id
$$;
