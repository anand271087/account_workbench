-- M7 — Storage buckets for AK03.c documents (MOMs, VPDs, transcripts, emails).
--
-- All buckets are PRIVATE. The API server uses the service-role key to
-- create signed URLs for downloads; users never get direct bucket access.
-- We register one bucket per concern; granular kind isolation lets us swap
-- retention policies later (e.g., longer for contracts).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('meeting_records', 'meeting_records', false, 104857600,  -- 100 MB
   array['application/pdf',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'text/plain',
         'text/vtt',
         'application/octet-stream']),
  ('vpd', 'vpd', false, 104857600,
   array['application/pdf',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'text/plain',
         'application/octet-stream']),
  ('contracts', 'contracts', false, 104857600,
   array['application/pdf',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/octet-stream'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage RLS — only the service role (used by FastAPI) and admins can
-- touch objects directly. Regular users get signed URLs from the API.
do $$
begin
  -- Drop any open dev policies left over from prior demos.
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname = 'awb_admin_objects_all') then
    drop policy awb_admin_objects_all on storage.objects;
  end if;
end $$;

create policy awb_admin_objects_all
  on storage.objects
  for all
  to authenticated
  using (
    bucket_id in ('meeting_records', 'vpd', 'contracts')
    and (
      auth.jwt() ->> 'role' = 'service_role'
      or exists (
        select 1 from public.users
        where users.id = auth.uid() and users.role = 'admin'
      )
    )
  )
  with check (
    bucket_id in ('meeting_records', 'vpd', 'contracts')
    and (
      auth.jwt() ->> 'role' = 'service_role'
      or exists (
        select 1 from public.users
        where users.id = auth.uid() and users.role = 'admin'
      )
    )
  );
