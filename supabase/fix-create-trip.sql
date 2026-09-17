-- Fix: create trip + owner in one step (run this in Supabase SQL editor)
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

  insert into public.trip_members (trip_id, user_id, role, display_name)
  values (tid, uid, 'owner', p_display_name);

  return query select tid, code;
end;
$$;

grant execute on function public.create_trip_as_owner(text, jsonb, text) to authenticated;
