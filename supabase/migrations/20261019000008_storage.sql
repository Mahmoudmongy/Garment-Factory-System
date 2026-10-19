-- 20261019000008_storage.sql
-- Private buckets. Path convention: employee-documents/{employee_id}/{file}
-- Guarded so it is a no-op on a plain Postgres without the Supabase `storage` schema.
-- STATUS: NOT EXECUTED (no database available when authored).

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not found: skipping bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('employee-documents', 'employee-documents', false, 5242880,
          array['image/jpeg','image/png','image/webp','application/pdf'])
  on conflict (id) do update set public = false;

  execute 'drop policy if exists emp_docs_select on storage.objects';
  execute 'drop policy if exists emp_docs_insert on storage.objects';
  execute $p$create policy emp_docs_select on storage.objects for select to authenticated
             using (bucket_id = 'employee-documents' and (select public.has_permission('employee.document.view')))$p$;
  execute $p$create policy emp_docs_insert on storage.objects for insert to authenticated
             with check (bucket_id = 'employee-documents' and (select public.has_permission('employee.document.upload')))$p$;
  -- No update/delete policy: documents are replaced by uploading a new path and recording it via rpc_update_employee.
end $$;
