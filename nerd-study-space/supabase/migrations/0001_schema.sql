-- =====================================================================
-- Nerd — Your Study Space
-- Migration 0001: schema, Row Level Security, permanent Nerd ID, sync guards
--
-- Run once in the Supabase SQL editor (or via `supabase db push`).
-- Identity model: auth.users.id (UUID) is the permanent identity. The
-- readable Nerd ID is generated server-side at sign-up and can never change.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Profiles + permanent Nerd ID
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  nerd_id           text not null unique,
  display_name      text not null default 'Student'
                      check (char_length(display_name) between 1 and 60),
  created_at        timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint nerd_id_format check (nerd_id ~ '^NERD-[0-9A-F]{4}-[0-9A-F]{4}$')
);

create or replace function public.generate_nerd_id()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  candidate text;
  tries int := 0;
begin
  loop
    candidate := 'NERD-'
      || upper(substr(md5(gen_random_uuid()::text), 1, 4)) || '-'
      || upper(substr(md5(gen_random_uuid()::text), 1, 4));
    exit when not exists (select 1 from public.profiles where nerd_id = candidate);
    tries := tries + 1;
    if tries > 25 then
      raise exception 'Could not allocate a unique Nerd ID';
    end if;
  end loop;
  return candidate;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. User-owned tables
-- ---------------------------------------------------------------------
-- Conventions used by every synced table:
--   id                 client-generated UUID => retries are idempotent (no duplicates)
--   user_id            defaults to auth.uid(); enforced by RLS, never trusted from client
--   client_updated_at  last-writer-wins clock set by the editing device
--   updated_at         server clock, set by trigger; used as the pull cursor
--   deleted_at         soft delete so deletions sync to other devices

create table if not exists public.user_preferences (
  user_id               uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  theme                 text not null default 'warm'
                          check (theme in ('warm','light','midnight','star','dark','starry-evening')),
  daily_target_minutes  integer not null default 120 check (daily_target_minutes between 0 and 1440),
  timezone              text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  week_starts_on        smallint not null default 1 check (week_starts_on between 0 and 6),
  notifications_enabled boolean not null default false,
  sound_enabled         boolean not null default true,
  created_at            timestamptz not null default now(),
  client_updated_at     timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.timer_settings (
  user_id                   uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  focus_minutes             integer not null default 25 check (focus_minutes between 1 and 180),
  short_break_minutes       integer not null default 5  check (short_break_minutes between 1 and 60),
  long_break_minutes        integer not null default 15 check (long_break_minutes between 1 and 120),
  sessions_until_long_break integer not null default 4  check (sessions_until_long_break between 2 and 12),
  auto_start_breaks         boolean not null default false,
  auto_start_focus          boolean not null default false,
  created_at                timestamptz not null default now(),
  client_updated_at         timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create table if not exists public.subjects (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name              text not null check (char_length(btrim(name)) between 1 and 60),
  color             text not null default '#8a5a2b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (user_id, id)   -- lets child tables prove same-owner references
);

create table if not exists public.tasks (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title             text not null check (char_length(btrim(title)) between 1 and 200),
  description       text not null default '' check (char_length(description) <= 5000),
  subject_id        uuid,
  priority          text not null default 'normal' check (priority in ('low','normal','high')),
  due_date          date,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  -- A task may only point at a subject owned by the same user.
  foreign key (user_id, subject_id) references public.subjects (user_id, id)
    on delete set null (subject_id)
);

create table if not exists public.goals (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title             text not null check (char_length(btrim(title)) between 1 and 200),
  description       text not null default '' check (char_length(description) <= 2000),
  period            text not null check (period in ('daily','weekly','monthly')),
  metric            text not null default 'minutes' check (metric in ('minutes','sessions','tasks','manual')),
  target_value      numeric not null check (target_value > 0 and target_value <= 1000000),
  current_value     numeric not null default 0 check (current_value >= 0),
  subject_id        uuid,
  start_date        date not null,
  end_date          date not null,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  check (end_date >= start_date),
  foreign key (user_id, subject_id) references public.subjects (user_id, id)
    on delete set null (subject_id)
);

create table if not exists public.study_sessions (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id        uuid,
  session_type      text not null default 'focus'
                      check (session_type in ('focus','short_break','long_break','manual')),
  started_at        timestamptz not null,
  ended_at          timestamptz not null,
  duration_seconds  integer not null check (duration_seconds between 1 and 86400),
  planned_seconds   integer check (planned_seconds is null or planned_seconds between 1 and 86400),
  local_date        date not null,            -- calendar day in the user's timezone
  completed         boolean not null default true,
  note              text not null default '' check (char_length(note) <= 1000),
  created_at        timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  check (ended_at >= started_at),
  foreign key (user_id, subject_id) references public.subjects (user_id, id)
    on delete set null (subject_id)
);

create table if not exists public.reflections (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_date        date not null,
  kind              text not null default 'reflection' check (kind in ('reflection','note')),
  title             text not null default '' check (char_length(title) <= 200),
  body              text not null default '' check (char_length(body) <= 20000),
  created_at        timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

-- ---------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------
create index if not exists subjects_user_updated_idx  on public.subjects (user_id, updated_at);
create index if not exists tasks_user_updated_idx     on public.tasks (user_id, updated_at);
create index if not exists tasks_user_due_idx         on public.tasks (user_id, due_date)
  where deleted_at is null and completed_at is null;
create index if not exists tasks_subject_idx          on public.tasks (user_id, subject_id);
create index if not exists goals_user_updated_idx     on public.goals (user_id, updated_at);
create index if not exists goals_user_period_idx      on public.goals (user_id, period, end_date);
create index if not exists sessions_user_updated_idx  on public.study_sessions (user_id, updated_at);
create index if not exists sessions_user_date_idx     on public.study_sessions (user_id, local_date);
create index if not exists reflections_user_updated_idx on public.reflections (user_id, updated_at);
create index if not exists reflections_user_date_idx  on public.reflections (user_id, entry_date);
create index if not exists prefs_updated_idx          on public.user_preferences (updated_at);
create index if not exists timer_updated_idx          on public.timer_settings (updated_at);
create index if not exists profiles_updated_idx       on public.profiles (updated_at);

-- ---------------------------------------------------------------------
-- 4. Write guards: immutable owner, server clock, stale-write protection
-- ---------------------------------------------------------------------
-- If a device pushes an edit whose client_updated_at is OLDER than what is
-- already stored, the update is skipped (returns NULL). The row therefore
-- never goes backwards in time. The app detects that no row came back and
-- re-pulls the newer version, then tells the user (see src/sync/engine.ts).
create or replace function public.nerd_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'user_id is immutable';
    end if;
    if new.client_updated_at < old.client_updated_at then
      return null;  -- stale write: keep the newer stored row
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.nerd_guard_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'Profile id is immutable';
    end if;
    if new.nerd_id is distinct from old.nerd_id then
      raise exception 'Nerd ID is permanent and cannot be changed';
    end if;
    if new.client_updated_at < old.client_updated_at then
      return null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists nerd_guard_profiles on public.profiles;
create trigger nerd_guard_profiles
  before insert or update on public.profiles
  for each row execute function public.nerd_guard_profile();

do $$
declare t text;
begin
  foreach t in array array['user_preferences','timer_settings','subjects','tasks','goals','study_sessions','reflections']
  loop
    execute format('drop trigger if exists nerd_guard_%1$s on public.%1$I', t);
    execute format(
      'create trigger nerd_guard_%1$s before insert or update on public.%1$I
         for each row execute function public.nerd_guard_write()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Row Level Security: users can only touch their own rows
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- No insert/delete policy on profiles: rows are created by the sign-up trigger
-- and removed only by delete_my_account().

do $$
declare t text;
begin
  foreach t in array array['user_preferences','timer_settings','subjects','tasks','goals','study_sessions','reflections']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
                   t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
                   t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
                   t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))',
                   t || '_delete_own', t);
  end loop;
end $$;

-- Column-level privileges: anonymous visitors get nothing; signed-in users can
-- never rewrite their Nerd ID, even though they may edit their display name.
revoke all on public.profiles, public.user_preferences, public.timer_settings,
              public.subjects, public.tasks, public.goals, public.study_sessions,
              public.reflections from anon;
revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, client_updated_at) on public.profiles to authenticated;
grant select, insert, update, delete on
  public.user_preferences, public.timer_settings, public.subjects, public.tasks,
  public.goals, public.study_sessions, public.reflections
  to authenticated;

-- ---------------------------------------------------------------------
-- 6. New-user bootstrap: profile + Nerd ID + default settings
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dn text;
begin
  dn := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  if dn is null then
    dn := nullif(split_part(coalesce(new.email, ''), '@', 1), '');
  end if;
  dn := left(coalesce(dn, 'Student'), 60);

  insert into public.profiles (id, nerd_id, display_name)
  values (new.id, public.generate_nerd_id(), dn);
  insert into public.user_preferences (user_id) values (new.id);
  insert into public.timer_settings (user_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill for any users that already existed before this migration.
insert into public.profiles (id, nerd_id, display_name)
select u.id, public.generate_nerd_id(),
       left(coalesce(nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'Student'), 60)
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);
insert into public.user_preferences (user_id)
select id from auth.users u where not exists (select 1 from public.user_preferences p where p.user_id = u.id);
insert into public.timer_settings (user_id)
select id from auth.users u where not exists (select 1 from public.timer_settings p where p.user_id = u.id);

-- ---------------------------------------------------------------------
-- 7. Account deletion (no service-role key needed in the browser)
-- ---------------------------------------------------------------------
-- Deletes the caller's auth user; every user-owned table cascades from it.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------
-- 8. Realtime (instant cross-device updates; the app also polls as a fallback)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','user_preferences','timer_settings','subjects','tasks','goals','study_sessions','reflections']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end $$;
