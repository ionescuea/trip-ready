-- Trip Ready — organiser access by email (no magic link).
-- Run in Supabase SQL editor (after traveller-email-access.sql is fine).

drop function if exists public.create_trip_by_organiser_email(text, text, jsonb);
drop function if exists public.open_organiser_by_email(text);
drop function if exists public.adopt_organiser_by_code(text, text);
drop function if exists public.push_organiser_trip(text, jsonb);

-- Create a new trip locked to this organiser email.
create or replace function public.create_trip_by_organiser_email(
  p_email text,
  p_name text,
  p_data jsonb
)
returns table (trip_id uuid, invite_code text, data jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid;
  code text;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
  email_norm text := lower(trim(coalesce(p_email, '')));
  next_data jsonb;
begin
  if email_norm = '' or position('@' in email_norm) = 0 then
    raise exception 'Valid organiser email required';
  end if;

  code := '';
  for i in 1..6 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;

  next_data := coalesce(p_data, '{}'::jsonb);
  next_data := jsonb_set(next_data, '{organiserEmail}', to_jsonb(email_norm), true);
  next_data := jsonb_set(
    next_data,
    '{updatedAt}',
    to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    true
  );

  insert into public.trips (invite_code, name, data, updated_at)
  values (
    code,
    coalesce(nullif(trim(p_name), ''), 'My trip'),
    next_data,
    now()
  )
  returning trips.id into tid;

  trip_id := tid;
  invite_code := code;
  data := next_data;
  return next;
end;
$$;

grant execute on function public.create_trip_by_organiser_email(text, text, jsonb)
  to anon, authenticated;

-- Open existing trip for this organiser email (latest match).
create or replace function public.open_organiser_by_email(p_email text)
returns table (trip_id uuid, invite_code text, data jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.trips%rowtype;
  email_norm text := lower(trim(coalesce(p_email, '')));
begin
  if email_norm = '' then
    raise exception 'Email required';
  end if;

  select tr.* into t
  from public.trips tr
  where lower(trim(coalesce(tr.data->>'organiserEmail', ''))) = email_norm
  order by tr.created_at desc
  limit 1;

  if not found then
    raise exception 'No trip for that organiser email';
  end if;

  trip_id := t.id;
  invite_code := t.invite_code;
  data := t.data;
  updated_at := t.updated_at;
  return next;
end;
$$;

grant execute on function public.open_organiser_by_email(text) to anon, authenticated;

-- Link an existing invite-code trip to an organiser email (first claim wins).
create or replace function public.adopt_organiser_by_code(p_code text, p_email text)
returns table (trip_id uuid, invite_code text, data jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.trips%rowtype;
  email_norm text := lower(trim(coalesce(p_email, '')));
  code_norm text := upper(trim(coalesce(p_code, '')));
  existing text;
  next_data jsonb;
begin
  if email_norm = '' or position('@' in email_norm) = 0 then
    raise exception 'Valid organiser email required';
  end if;

  select tr.* into t
  from public.trips tr
  where upper(tr.invite_code) = code_norm
  limit 1;

  if not found then
    raise exception 'Invite code not found';
  end if;

  existing := lower(trim(coalesce(t.data->>'organiserEmail', '')));
  if existing <> '' and existing <> email_norm then
    raise exception 'This trip already has a different organiser email';
  end if;

  next_data := coalesce(t.data, '{}'::jsonb);
  if existing = '' then
    next_data := jsonb_set(next_data, '{organiserEmail}', to_jsonb(email_norm), true);
    update public.trips
    set data = next_data, updated_at = now()
    where id = t.id;
  end if;

  trip_id := t.id;
  invite_code := t.invite_code;
  data := next_data;
  updated_at := now();
  return next;
end;
$$;

grant execute on function public.adopt_organiser_by_code(text, text) to anon, authenticated;

-- Organiser full trip save (must match organiserEmail on the trip).
create or replace function public.push_organiser_trip(p_email text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.trips%rowtype;
  email_norm text := lower(trim(coalesce(p_email, '')));
  next_data jsonb;
begin
  if email_norm = '' then
    raise exception 'Email required';
  end if;
  if p_data is null then
    raise exception 'Trip data required';
  end if;

  select tr.* into t
  from public.trips tr
  where lower(trim(coalesce(tr.data->>'organiserEmail', ''))) = email_norm
  order by tr.created_at desc
  limit 1;

  if not found then
    raise exception 'No trip for that organiser email';
  end if;

  next_data := p_data;
  next_data := jsonb_set(next_data, '{organiserEmail}', to_jsonb(email_norm), true);
  next_data := jsonb_set(
    next_data,
    '{updatedAt}',
    to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    true
  );

  update public.trips
  set
    name = coalesce(nullif(trim(next_data->>'name'), ''), t.name),
    data = next_data,
    updated_at = now()
  where id = t.id;

  return next_data;
end;
$$;

grant execute on function public.push_organiser_trip(text, jsonb) to anon, authenticated;
