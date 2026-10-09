-- RLS acceptance checks (design doc section 9). Run in the Supabase SQL editor
-- AFTER schema.sql. Everything happens inside a transaction that is rolled
-- back, so no test data is left behind. Look for "PASS" notices; any failure
-- aborts with "FAIL: ...".

begin;

-- Fixtures (as postgres) ----------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'host@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'alice@test.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'bob@test.local'),
  ('00000000-0000-0000-0000-0000000000d4', 'mallory@test.local');

insert into allowed_emails (email) values
  ('host@test.local'), ('alice@test.local'), ('bob@test.local');

insert into profiles (id, display_name, is_host) values
  ('00000000-0000-0000-0000-0000000000a1', 'Host', true),
  ('00000000-0000-0000-0000-0000000000b2', 'Alice', false),
  ('00000000-0000-0000-0000-0000000000c3', 'Bob', false);

insert into rounds (id, theme, status, songs_per_member, votes_per_member) values
  ('00000000-0000-0000-0000-000000000001', 'Test round', 'submitting', 1, 1);

-- Helpers ---------------------------------------------------------------------
create function pg_temp.act_as(who text) returns void language plpgsql as $$
declare
  uid uuid := case who
    when 'host'    then '00000000-0000-0000-0000-0000000000a1'
    when 'alice'   then '00000000-0000-0000-0000-0000000000b2'
    when 'bob'     then '00000000-0000-0000-0000-0000000000c3'
    when 'mallory' then '00000000-0000-0000-0000-0000000000d4' end;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'email', who || '@test.local', 'role', 'authenticated')::text,
    true);
  set local role authenticated;
end $$;

-- Passes if the statement raises OR touches zero rows (RLS filtering).
create function pg_temp.expect_blocked(label text, stmt text) returns void language plpgsql as $$
declare rc int;
begin
  begin
    execute stmt;
    get diagnostics rc = row_count;
  exception when others then
    raise notice 'PASS (blocked: %): %', sqlerrm, label;
    return;
  end;
  if rc = 0 then
    raise notice 'PASS (0 rows): %', label;
  else
    raise exception 'FAIL: % was allowed', label;
  end if;
end $$;

create function pg_temp.expect_ok(label text, stmt text) returns void language plpgsql as $$
declare rc int;
begin
  execute stmt;
  get diagnostics rc = row_count;
  if rc = 0 then raise exception 'FAIL: % affected no rows', label; end if;
  raise notice 'PASS (allowed): %', label;
end $$;

create function pg_temp.submit(who text, track text) returns text language sql as $$
  select format(
    'insert into submissions (round_id, user_id, spotify_track_id, track_uri, title, artists)
     values (%L, %L, %L, %L, %L, %L)',
    '00000000-0000-0000-0000-000000000001',
    case who when 'host' then '00000000-0000-0000-0000-0000000000a1'
             when 'alice' then '00000000-0000-0000-0000-0000000000b2'
             when 'bob' then '00000000-0000-0000-0000-0000000000c3' end,
    track, 'spotify:track:' || track, 'Song ' || track, 'Artist')
$$;

create function pg_temp.vote(who text, track text) returns text language sql as $$
  select format(
    'insert into votes (round_id, submission_id, voter_id)
     select round_id, id, %L from submissions where spotify_track_id = %L',
    case who when 'host' then '00000000-0000-0000-0000-0000000000a1'
             when 'alice' then '00000000-0000-0000-0000-0000000000b2'
             when 'bob' then '00000000-0000-0000-0000-0000000000c3' end,
    track)
$$;

-- Rounds ----------------------------------------------------------------------
select pg_temp.act_as('alice');
select pg_temp.expect_blocked('non-host updates a round',
  $q$update rounds set theme = 'hacked'$q$);
select pg_temp.expect_blocked('non-host creates a round',
  $q$insert into rounds (theme) values ('mine')$q$);

-- is_host protection ----------------------------------------------------------
update profiles set is_host = true where id = auth.uid();
reset role;
do $$ begin
  if (select is_host from profiles where display_name = 'Alice') then
    raise exception 'FAIL: user set is_host on own profile';
  end if;
  raise notice 'PASS: user cannot set is_host on own profile';
end $$;

-- Non-members -----------------------------------------------------------------
select pg_temp.act_as('mallory');
do $$ begin
  if (select count(*) from rounds) > 0 then
    raise exception 'FAIL: non-member can read rounds';
  end if;
  raise notice 'PASS: non-member sees no rounds';
end $$;
select pg_temp.expect_blocked('non-member creates a profile',
  $q$insert into profiles (id, display_name) values (auth.uid(), 'Mallory')$q$);
reset role;

-- Submissions -----------------------------------------------------------------
select pg_temp.act_as('alice');
select pg_temp.expect_blocked('submit as another user', pg_temp.submit('bob', 'x1'));
select pg_temp.expect_ok('alice submits', pg_temp.submit('alice', 'a1'));
select pg_temp.expect_blocked('alice exceeds songs_per_member', pg_temp.submit('alice', 'a2'));
reset role;
select pg_temp.act_as('bob');
select pg_temp.expect_blocked('duplicate song in a round', pg_temp.submit('bob', 'a1'));
select pg_temp.expect_ok('bob submits', pg_temp.submit('bob', 'b1'));
reset role;
select pg_temp.act_as('host');
select pg_temp.expect_ok('host submits', pg_temp.submit('host', 'h1'));
select pg_temp.expect_blocked('vote while submitting', pg_temp.vote('host', 'a1'));
select pg_temp.expect_ok('host opens voting',
  $q$update rounds set status = 'voting'$q$);
reset role;

-- Votes -----------------------------------------------------------------------
select pg_temp.act_as('alice');
select pg_temp.expect_blocked('submit while voting', pg_temp.submit('alice', 'a3'));
select pg_temp.expect_blocked('vote on own submission', pg_temp.vote('alice', 'a1'));
select pg_temp.expect_ok('alice votes for bob', pg_temp.vote('alice', 'b1'));
select pg_temp.expect_blocked('vote twice for one song', pg_temp.vote('alice', 'b1'));
select pg_temp.expect_blocked('alice exceeds votes_per_member', pg_temp.vote('alice', 'h1'));
reset role;
select pg_temp.act_as('bob');
do $$ begin
  if (select count(*) from votes) > 0 then
    raise exception 'FAIL: bob can see other people''s votes during voting';
  end if;
  raise notice 'PASS: votes hidden from others during voting';
end $$;
reset role;

select pg_temp.act_as('host');
select pg_temp.expect_ok('host closes round', $q$update rounds set status = 'closed'$q$);
reset role;
select pg_temp.act_as('bob');
select pg_temp.expect_blocked('vote after close', pg_temp.vote('bob', 'a1'));
do $$ begin
  if (select count(*) from votes) <> 1 then
    raise exception 'FAIL: votes not visible after close';
  end if;
  raise notice 'PASS: votes visible after close';
end $$;
reset role;

rollback;
