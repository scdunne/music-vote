-- Lets a round size its vote budget from the number of submitters: when
-- auto_votes is on, starting voting sets votes_per_member to
-- 2 x (number of other submitters).
-- Run once in the Supabase SQL editor on a database created from an older
-- schema.sql. Fresh installs already include this. Existing rounds keep
-- their fixed vote count.

alter table rounds add column if not exists auto_votes boolean not null default false;
