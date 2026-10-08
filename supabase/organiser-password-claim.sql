-- Trip Ready — claim an email-only organiser trip after password sign-in.
-- Run in Supabase SQL editor after schema.sql (and organiser-email-access.sql if used).
-- Requires Auth → email/password enabled. Prefer Confirm email OFF until custom SMTP is set.

create or replace function public.claim_organiser_by_email()
returns table (trip_id uuid, invite_code text, data jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  user_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  t public.trips%rowtype;
  existing_owner uuid;
  next_data jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if user_email = '' or position('@' in user_email) = 0 then
    raise exception 'Account email required';
  end if;

  select tr.* into t
  from public.trips tr
  where lower(trim(coalesce(tr.data->>'organiserEmail', ''))) = user_email
  order by tr.created_at desc
  limit 1;

  if not found then
    return;
  end if;

  select m.user_id into existing_owner
  from public.trip_members m
  where m.trip_id = t.id and m.role = 'owner'
  limit 1;

  if existing_owner is not null and existing_owner <> uid then
    raise exception 'This trip already has a different organiser account';
  end if;

  next_data := coalesce(t.data, '{}'::jsonb);
  next_data := jsonb_set(next_data, '{organiserEmail}', to_jsonb(user_email), true);

  update public.trips
  set data = next_data, updated_at = now()
  where id = t.id;

  insert into public.trip_members (trip_id, user_id, role, display_name)
  values (t.id, uid, 'owner', user_email)
  on conflict (trip_id, user_id) do update
    set role = 'owner',
        display_name = coalesce(excluded.display_name, trip_members.display_name);

  trip_id := t.id;
  invite_code := t.invite_code;
  data := next_data;
  return next;
end;
$$;

grant execute on function public.claim_organiser_by_email() to authenticated;

create or replace function public.claim_organiser_by_code(p_code text)
returns table (trip_id uuid, invite_code text, data jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  user_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  code_norm text := upper(trim(coalesce(p_code, '')));
  t public.trips%rowtype;
  existing_owner uuid;
  trip_email text;
  next_data jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if user_email = '' or position('@' in user_email) = 0 then
    raise exception 'Account email required';
  end if;
  if length(code_norm) < 4 then
    raise exception 'Invite code required';
  end if;

  select tr.* into t
  from public.trips tr
  where upper(tr.invite_code) = code_norm
  limit 1;

  if not found then
    raise exception 'Invite code not found';
  end if;

  trip_email := lower(trim(coalesce(t.data->>'organiserEmail', '')));
  if trip_email <> '' and trip_email <> user_email then
    raise exception 'This trip belongs to a different organiser email';
  end if;

  select m.user_id into existing_owner
  from public.trip_members m
  where m.trip_id = t.id and m.role = 'owner'
  limit 1;

  if existing_owner is not null and existing_owner <> uid then
    raise exception 'This trip already has a different organiser account';
  end if;

  next_data := coalesce(t.data, '{}'::jsonb);
  next_data := jsonb_set(next_data, '{organiserEmail}', to_jsonb(user_email), true);

  update public.trips
  set data = next_data, updated_at = now()
  where id = t.id;

  insert into public.trip_members (trip_id, user_id, role, display_name)
  values (t.id, uid, 'owner', user_email)
  on conflict (trip_id, user_id) do update
    set role = 'owner',
        display_name = coalesce(excluded.display_name, trip_members.display_name);

  trip_id := t.id;
  invite_code := t.invite_code;
  data := next_data;
  return next;
end;
$$;

grant execute on function public.claim_organiser_by_code(text) to authenticated;
