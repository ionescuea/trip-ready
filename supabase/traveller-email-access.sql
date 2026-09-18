-- Trip Ready — simple traveller access (invite code + email, no magic link).
-- Run in Supabase SQL editor after schema.sql.

-- Look up trip by invite code + traveller email (must match people[].email).
create or replace function public.claim_trip_by_email(p_code text, p_email text)
returns table (
  trip_id uuid,
  invite_code text,
  person_id text,
  person_name text,
  data jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.trips%rowtype;
  p jsonb;
  email_norm text := lower(trim(coalesce(p_email, '')));
  code_norm text := upper(trim(coalesce(p_code, '')));
begin
  if email_norm = '' then
    raise exception 'Email required';
  end if;

  select tr.* into t
  from public.trips tr
  where upper(tr.invite_code) = code_norm
  limit 1;

  if not found then
    raise exception 'Invite code not found';
  end if;

  select elem into p
  from jsonb_array_elements(coalesce(t.data->'people', '[]'::jsonb)) as elem
  where lower(trim(coalesce(elem->>'email', ''))) = email_norm
  limit 1;

  if p is null then
    raise exception 'No traveller with that email on this trip';
  end if;

  trip_id := t.id;
  invite_code := t.invite_code;
  person_id := p->>'id';
  person_name := p->>'name';
  data := t.data;
  updated_at := t.updated_at;
  return next;
end;
$$;

grant execute on function public.claim_trip_by_email(text, text) to anon, authenticated;

-- Traveller can update only their own checklist / luggage / address.
create or replace function public.push_traveller_self(
  p_code text,
  p_email text,
  p_person_id text,
  p_address text default null,
  p_checklist jsonb default null,
  p_luggage jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.trips%rowtype;
  p jsonb;
  email_norm text := lower(trim(coalesce(p_email, '')));
  pid text := trim(coalesce(p_person_id, ''));
  code_norm text := upper(trim(coalesce(p_code, '')));
  next_data jsonb;
  people jsonb;
begin
  if email_norm = '' or pid = '' then
    raise exception 'Email and person required';
  end if;

  select tr.* into t
  from public.trips tr
  where upper(tr.invite_code) = code_norm
  limit 1;

  if not found then
    raise exception 'Invite code not found';
  end if;

  select elem into p
  from jsonb_array_elements(coalesce(t.data->'people', '[]'::jsonb)) as elem
  where elem->>'id' = pid
    and lower(trim(coalesce(elem->>'email', ''))) = email_norm
  limit 1;

  if p is null then
    raise exception 'Not allowed';
  end if;

  next_data := coalesce(t.data, '{}'::jsonb);

  if p_checklist is not null then
    next_data := jsonb_set(
      next_data,
      array['checklist', pid],
      p_checklist,
      true
    );
  end if;

  if p_luggage is not null then
    next_data := jsonb_set(
      next_data,
      array['luggage', pid],
      p_luggage,
      true
    );
  end if;

  if p_address is not null then
    select coalesce(jsonb_agg(
      case
        when elem->>'id' = pid then jsonb_set(elem, '{address}', to_jsonb(p_address), true)
        else elem
      end
    ), '[]'::jsonb)
    into people
    from jsonb_array_elements(coalesce(next_data->'people', '[]'::jsonb)) as elem;

    next_data := jsonb_set(next_data, '{people}', people, true);
  end if;

  next_data := jsonb_set(
    next_data,
    '{updatedAt}',
    to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    true
  );

  update public.trips
  set data = next_data, updated_at = now()
  where id = t.id;

  return next_data;
end;
$$;

grant execute on function public.push_traveller_self(text, text, text, text, jsonb, jsonb)
  to anon, authenticated;
