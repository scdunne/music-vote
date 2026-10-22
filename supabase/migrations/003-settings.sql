-- Site-wide settings, starting with the host's switch for releasing the
-- Stats page highlights. Run once in the Supabase SQL editor on a database
-- created from an older schema.sql. Fresh installs already include this.

create table if not exists settings (
  id boolean primary key default true check (id),  -- only one row can exist
  highlights_released boolean not null default false
);
insert into settings default values on conflict do nothing;

alter table settings enable row level security;

drop policy if exists "settings read" on settings;
create policy "settings read" on settings for select to authenticated
  using (is_member());
drop policy if exists "settings update" on settings;
create policy "settings update" on settings for update to authenticated
  using (is_member() and is_host())
  with check (is_member() and is_host());
