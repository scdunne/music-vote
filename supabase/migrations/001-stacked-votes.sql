-- Lets a member put several of their votes on one song.
-- Run once in the Supabase SQL editor on a database created from an older
-- schema.sql. Fresh installs already include this.

alter table votes drop constraint if exists votes_submission_id_voter_id_key;

create or replace function check_vote_limit() returns trigger
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
  -- Serialize this voter's inserts so rapid "+" clicks can't race past the limit.
  perform pg_advisory_xact_lock(hashtext(new.voter_id::text || new.round_id::text));
  select votes_per_member into lim from rounds where id = new.round_id;
  select count(*) into n from votes
    where round_id = new.round_id and voter_id = new.voter_id;
  if n >= lim then
    raise exception 'You can cast at most % vote(s) this round.', lim;
  end if;
  return new;
end $$;
