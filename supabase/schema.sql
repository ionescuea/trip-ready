-- Trip Ready — run this in the Supabase SQL editor (Dashboard → SQL).
-- Enables shared trips + organiser accounts (email/password) + trip_members.

create extension if not exists "pgcrypto";

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  name text not null default 'My trip',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  person_id text,
  role text not null check (role in ('owner', 'traveller')),
  display_name text,
  created_at timestamptz not null default now(),
  unique (trip_id, user_id)
);

create index if not exists trip_members_user_idx on public.trip_members (user_id);
create index if not exists trip_members_trip_idx on public.trip_members (trip_id);
create index if not exists trips_invite_code_idx on public.trips (invite_code);

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;

-- Helpers
create or replace function public.is_trip_member(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trip_members m
    where m.trip_id = tid and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_trip_owner(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trip_members m
    where m.trip_id = tid and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- Trips: members can read/update; insert allowed for authenticated (then add self as owner in app)
drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips
  for select to authenticated
  using (public.is_trip_member(id));

drop policy if exists trips_insert on public.trips;
create policy trips_insert on public.trips
  for insert to authenticated
  with check (true);

drop policy if exists trips_update on public.trips;
create policy trips_update on public.trips
  for update to authenticated
  using (public.is_trip_member(id))
  with check (public.is_trip_member(id));

drop policy if exists trips_delete on public.trips;
create policy trips_delete on public.trips
  for delete to authenticated
  using (public.is_trip_owner(id));

-- Members
drop policy if exists members_select on public.trip_members;
create policy members_select on public.trip_members
  for select to authenticated
  using (public.is_trip_member(trip_id) or user_id = auth.uid());

drop policy if exists members_insert on public.trip_members;
create policy members_insert on public.trip_members
  for insert to authenticated
  with check (
    user_id = auth.uid()
    or public.is_trip_owner(trip_id)
  );

drop policy if exists members_update on public.trip_members;
create policy members_update on public.trip_members
  for update to authenticated
  using (user_id = auth.uid() or public.is_trip_owner(trip_id))
  with check (user_id = auth.uid() or public.is_trip_owner(trip_id));

drop policy if exists members_delete on public.trip_members;
create policy members_delete on public.trip_members
  for delete to authenticated
  using (user_id = auth.uid() or public.is_trip_owner(trip_id));

-- Allow looking up a trip by invite code before joining (authenticated only)
create or replace function public.find_trip_by_invite(code text)
returns table (id uuid, name text, invite_code text, data jsonb, updated_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select t.id, t.name, t.invite_code, t.data, t.updated_at
  from public.trips t
  where upper(t.invite_code) = upper(trim(code))
  limit 1;
$$;

grant execute on function public.find_trip_by_invite(text) to authenticated;

-- Join trip: add caller as traveller if not already a member
create or replace function public.join_trip(code text, p_person_id text default null, p_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  select t.id into tid
  from public.trips t
  where upper(t.invite_code) = upper(trim(code))
  limit 1;

  if tid is null then
    raise exception 'Invite code not found';
  end if;

  insert into public.trip_members (trip_id, user_id, person_id, role, display_name)
  values (tid, uid, p_person_id, 'traveller', p_display_name)
  on conflict (trip_id, user_id) do update
    set person_id = coalesce(excluded.person_id, trip_members.person_id),
        display_name = coalesce(excluded.display_name, trip_members.display_name);

  return tid;
end;
$$;

grant execute on function public.join_trip(text, text, text) to authenticated;

-- Create trip + owner membership in one step (avoids RLS blocking SELECT right after INSERT)
create or replace function public.create_trip_as_owner(
  p_name text,
  p_data jsonb,
  p_display_name text default null
)
returns table (id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  tid uuid;
  code text;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  code := '';
  for i in 1..6 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;

  insert into public.trips (invite_code, name, data, updated_at)
  values (code, coalesce(nullif(trim(p_name), ''), 'My trip'), coalesce(p_data, '{}'::jsonb), now())
  returning trips.id into tid;

  insert into public.trip_members (trip_id, user_id, role, display_name, person_id)
  values (
    tid,
    uid,
    'owner',
    p_display_name,
    nullif(p_data->>'leadPersonId', '')
  );

  return query select tid, code;
end;
$$;

grant execute on function public.create_trip_as_owner(text, jsonb, text) to authenticated;
