-- Trip Ready — boarding-pass / ticket files (run in Supabase SQL editor after schema.sql)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trip-tickets',
  'trip-tickets',
  false,
  10485760, -- 10 MB
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path layout: {trip_id}/{ticket_id}/{filename}

drop policy if exists trip_tickets_select on storage.objects;
create policy trip_tickets_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'trip-tickets'
    and public.is_trip_member((string_to_array(name, '/'))[1]::uuid)
  );

drop policy if exists trip_tickets_insert on storage.objects;
create policy trip_tickets_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'trip-tickets'
    and public.is_trip_owner((string_to_array(name, '/'))[1]::uuid)
  );

drop policy if exists trip_tickets_update on storage.objects;
create policy trip_tickets_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'trip-tickets'
    and public.is_trip_owner((string_to_array(name, '/'))[1]::uuid)
  )
  with check (
    bucket_id = 'trip-tickets'
    and public.is_trip_owner((string_to_array(name, '/'))[1]::uuid)
  );

drop policy if exists trip_tickets_delete on storage.objects;
create policy trip_tickets_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'trip-tickets'
    and public.is_trip_owner((string_to_array(name, '/'))[1]::uuid)
  );
