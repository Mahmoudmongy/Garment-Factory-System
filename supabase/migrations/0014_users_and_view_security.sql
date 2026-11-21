-- ============================================================================
-- 0014 — user administration, worker logins, and row security on pay data
--
-- Three things are fixed here.
--
-- 1. Views bypassed RLS. A Postgres view runs with its owner's privileges unless
--    it is marked security_invoker, so every view was readable by any signed-in
--    user no matter what the policies on the base tables said.
--
-- 2. The policies on the money tables were blanket "any active user". Even with
--    security_invoker, p_read_financial_transactions and p_read_work_assignments
--    were ORed with the scoped policies, so a worker could read another worker's
--    pay. Verified before the fix: a plain worker saw 500.00 in v_workers for a
--    colleague. The blanket policies are replaced with scoped ones; the money is
--    now visible to the earner and to whoever holds the matching permission.
--
-- 3. User administration had no RPC surface. Creating a login, assigning a role
--    or overriding one permission all needed hand-written SQL. The rpc_*
--    functions below are the whole surface, and they are what the users screen
--    and the "give this worker a login" button call.
--
-- Auth users are still created by Supabase Auth (or the admin-create-user edge
-- function); these functions own the profile and its grants.
-- ============================================================================

-- ---------------------------------------------------------------- view security
-- security_invoker is available from Postgres 15. Supabase is on 15+.
do $$
declare v record;
begin
  for v in
    select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('alter view public.%I set (security_invoker = true)', v.relname);
  end loop;
end $$;

-- ---------------------------------------------------------------- self-view permission
-- A worker has to see their own work and their own pay. They must not see anyone
-- else's. production.order.view cannot serve as that switch: workers hold it to
-- read the bundle queue they claim from. This permission marks the "own data
-- only" case, and the policies below treat it as the narrow branch.
insert into public.permissions (code, group_ar, name_ar, sort_order) values
  ('worker.self.view', 'الصنايعية', 'عرض شغله وقبضه هو بس', 51)
on conflict (code) do nothing;

insert into public.role_permissions (role_key, perm_code) values
  ('worker', 'worker.self.view')
on conflict do nothing;

-- ---------------------------------------------------------------- scoped policies
-- A worker's pay is theirs. Reading someone else's requires worker.financial.view
-- (accountant, manager) or one of the foreman's assignment permissions. The
-- employee link comes from the caller's own profile, so an unlinked login sees no
-- worker rows at all.
drop policy if exists p_read_work_assignments on public.work_assignments;
drop policy if exists p_wa_worker_scope on public.work_assignments;
create policy p_wa_scope on public.work_assignments for select to authenticated
  using (
    public.has_permission('worker.financial.view')
    or public.has_permission('production.assignment.create')
    or public.has_permission('production.receive')
    or (public.has_permission('worker.self.view')
        and employee_id = (select employee_id from public.profiles where id = auth.uid()))
  );

drop policy if exists p_read_financial_transactions on public.financial_transactions;
create policy p_ft_scope on public.financial_transactions for select to authenticated
  using (
    public.has_permission('account.view')
    or public.has_permission('worker.financial.view')
    or (public.has_permission('worker.self.view')
        and employee_id is not null
        and employee_id = (select employee_id from public.profiles where id = auth.uid()))
  );

drop policy if exists p_read_financial_accounts on public.financial_accounts;
create policy p_fa_scope on public.financial_accounts for select to authenticated
  using (public.has_permission('account.view'));

-- Staff directory: everyone on the payroll is not everyone's business. A worker
-- sees their own record; a foreman, accountant or manager sees the list.
drop policy if exists p_read_employees on public.employees;
create policy p_emp_scope on public.employees for select to authenticated
  using (
    public.has_permission('employee.view')
    or public.has_permission('worker.financial.view')
    or id = (select employee_id from public.profiles where id = auth.uid())
  );

-- ---------------------------------------------------------------- my permissions
-- The UI asks once at startup which permissions the signed-in user holds, so it
-- can hide what it must not offer. The database still refuses the write; this is
-- for the interface, not for security.
create or replace function public.rpc_my_permissions()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.code order by p.sort_order), '{}')
    from public.permissions p
   where public.has_permission(p.code)
$$;

-- ---------------------------------------------------------------- role templates
-- A job's usual permission set, so assigning "صنايعي" does not mean ticking
-- thirty checkboxes by hand. The role grants are the template; a per-user
-- override row is what makes an individual differ from the template.
create or replace function public.rpc_role_templates()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t order by t->>'name_ar'), '[]'::jsonb) from (
    select jsonb_build_object(
             'key', r.key, 'name_ar', r.name_ar,
             'perms', coalesce((select jsonb_agg(rp.perm_code order by rp.perm_code)
                                  from public.role_permissions rp
                                 where rp.role_key = r.key), '[]'::jsonb)
           ) as t
      from public.roles r
  ) s
$$;

-- ---------------------------------------------------------------- create profile
-- p_user is the auth.users id created by Supabase Auth. Called by the
-- admin-create-user edge function with the caller's JWT, so the permission check
-- and the audit row happen in the database, not in the function.
create or replace function public.rpc_create_profile(
  p_user uuid, p_username text, p_display text default null,
  p_employee uuid default null, p_roles text[] default '{}'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.fn_require_permission('system.user.manage');
  if coalesce(trim(p_username), '') = '' then perform public.fn_raise('E_USERNAME_REQUIRED'); end if;
  if p_username !~ '^[a-z0-9._-]{3,30}$' then perform public.fn_raise('E_USERNAME_INVALID', p_username); end if;

  if exists (select 1 from public.profiles where username = p_username) then
    perform public.fn_raise('E_USERNAME_TAKEN', p_username);
  end if;
  if p_employee is not null
     and exists (select 1 from public.profiles where employee_id = p_employee) then
    perform public.fn_raise('E_EMPLOYEE_HAS_LOGIN');
  end if;

  insert into public.profiles (id, username, display_name, employee_id)
  values (p_user, p_username, coalesce(nullif(trim(p_display), ''), p_username), p_employee)
  returning id into v_id;

  insert into public.user_roles (profile_id, role_key)
  select v_id, r from unnest(coalesce(p_roles, '{}')) r
   where exists (select 1 from public.roles where key = r)
  on conflict do nothing;

  return jsonb_build_object('id', v_id, 'username', p_username);
end $$;

-- ---------------------------------------------------------------- update profile
create or replace function public.rpc_update_profile(
  p_id uuid, p_display text default null, p_is_active boolean default null,
  p_employee uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_require_permission('system.user.manage');

  -- Deactivating yourself would lock the last administrator out.
  if p_id = auth.uid() and p_is_active is false then
    perform public.fn_raise('E_CANNOT_DISABLE_SELF');
  end if;
  if p_employee is not null and p_employee is distinct from
     (select employee_id from public.profiles where id = p_id)
     and exists (select 1 from public.profiles where employee_id = p_employee and id <> p_id) then
    perform public.fn_raise('E_EMPLOYEE_HAS_LOGIN');
  end if;

  update public.profiles set
    display_name = coalesce(nullif(trim(p_display), ''), display_name),
    is_active    = coalesce(p_is_active, is_active),
    employee_id  = coalesce(p_employee, employee_id)
   where id = p_id;
  if not found then perform public.fn_raise('E_NOT_FOUND', 'profile'); end if;

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- roles
create or replace function public.rpc_set_user_roles(p_id uuid, p_roles text[])
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_require_permission('system.user.manage');
  if not exists (select 1 from public.profiles where id = p_id) then
    perform public.fn_raise('E_NOT_FOUND', 'profile');
  end if;

  -- A user must keep at least one role; an unroled login is a dead login.
  if coalesce(array_length(p_roles, 1), 0) = 0 then
    perform public.fn_raise('E_ROLE_REQUIRED');
  end if;

  delete from public.user_roles where profile_id = p_id;
  insert into public.user_roles (profile_id, role_key)
  select p_id, r from unnest(p_roles) r
   where exists (select 1 from public.roles where key = r);

  return jsonb_build_object('ok', true,
    'roles', (select jsonb_agg(role_key) from public.user_roles where profile_id = p_id));
end $$;

-- ---------------------------------------------------------------- per-user overrides
-- p_overrides is {"customer.view": false, "reports.view": true}. A row here beats
-- the role, in either direction. Sending an empty object clears every override and
-- the user falls back to the plain role template.
create or replace function public.rpc_set_user_permissions(p_id uuid, p_overrides jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text; v boolean;
begin
  perform public.fn_require_permission('system.user.manage');
  if not exists (select 1 from public.profiles where id = p_id) then
    perform public.fn_raise('E_NOT_FOUND', 'profile');
  end if;
  -- Editing your own grants is how a user escalates past their own role.
  if p_id = auth.uid() then perform public.fn_raise('E_CANNOT_EDIT_OWN_PERMS'); end if;

  delete from public.user_permissions where profile_id = p_id;
  for k, v in select key, (value #>> '{}')::boolean from jsonb_each(coalesce(p_overrides, '{}'::jsonb)) loop
    if exists (select 1 from public.permissions where code = k) then
      insert into public.user_permissions (profile_id, perm_code, granted)
      values (p_id, k, v) on conflict (profile_id, perm_code) do update set granted = excluded.granted;
    end if;
  end loop;

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- worker login
-- One call from the worker screen: create the employee's login, link the profile
-- to the employee, and hand it the worker template.
create or replace function public.rpc_worker_account(
  p_user uuid, p_employee uuid, p_username text, p_display text default null,
  p_roles text[] default array['worker']
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp public.employees; v_res jsonb;
begin
  perform public.fn_require_permission('system.user.manage');

  select * into v_emp from public.employees where id = p_employee;
  if not found then perform public.fn_raise('E_NOT_FOUND', 'employee'); end if;
  if not v_emp.is_active then perform public.fn_raise('E_EMPLOYEE_INACTIVE', v_emp.name); end if;

  v_res := public.rpc_create_profile(
    p_user, p_username, coalesce(nullif(trim(p_display), ''), v_emp.name),
    p_employee, p_roles);

  return v_res;
end $$;

-- ---------------------------------------------------------------- read side
-- v_workers gains the login state, so the worker screen can offer "create a
-- login" or link to the existing one without a second round trip.
create or replace view public.v_workers as
  select e.id, e.code, e.name, e.kind, e.job_title, e.phone, e.is_active,
         coalesce(w.earned, 0) as earned_total,
         coalesce(p.paid, 0) as paid_total,
         coalesce(w.earned, 0) - coalesce(p.paid, 0) as remaining_due,
         coalesce(w.accepted, 0) as accepted_total,
         coalesce(w.rejected, 0) as rejected_total,
         pr.id is not null as has_login,
         pr.username as login_username
    from public.employees e
    left join public.profiles pr on pr.employee_id = e.id
    left join lateral (
      select sum(wa.wage_amount) as earned, sum(wa.accepted_qty) as accepted,
             sum(wa.rejected_qty) as rejected
        from public.work_assignments wa
       where wa.employee_id = e.id and wa.received_at is not null) w on true
    left join lateral (
      -- Payments leave the drawer, so they are stored negative; flip them back for
      -- the balance comparison. Reversals are excluded because the mirror row already
      -- cancels the original.
      select -sum(t.amount) as paid from public.financial_transactions t
       where t.employee_id = e.id and t.category = 'worker_payment'
         and t.reverses_id is null
         and not exists (select 1 from public.financial_transactions r where r.reverses_id = t.id)
    ) p on true;

alter view public.v_workers set (security_invoker = true);

-- ---------------------------------------------------------------- read side
-- One row per login with what it currently holds, so the users screen is a single
-- query. effective_perms answers "what can this person actually do", with role
-- grants and overrides already resolved.
create or replace view public.v_users as
  select p.id, p.username, p.display_name, p.is_active, p.is_superuser,
         p.employee_id, e.code as employee_code, e.name as employee_name,
         p.last_login_at, p.created_at,
         coalesce((select jsonb_agg(ur.role_key order by ur.role_key)
                     from public.user_roles ur where ur.profile_id = p.id), '[]'::jsonb) as roles,
         coalesce((select jsonb_object_agg(up.perm_code, up.granted)
                     from public.user_permissions up where up.profile_id = p.id), '{}'::jsonb) as overrides,
         coalesce((select array_agg(pm.code order by pm.sort_order)
                     from public.permissions pm
                    where public.has_permission(pm.code, p.id)), '{}') as effective_perms
    from public.profiles p
    left join public.employees e on e.id = p.employee_id;

alter view public.v_users set (security_invoker = true);
grant select on public.v_users to authenticated;

-- ---------------------------------------------------------------- audit
-- fn_audit_row reads new.id, but user_roles and user_permissions have composite
-- primary keys, so it would raise on those tables. This variant falls back to a
-- hash of the whole row when there is no id column.
create or replace function public.fn_audit_row_kv() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_row jsonb; v_pk text;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_pk  := coalesce(v_row->>'id', md5(v_row::text));
  insert into public.audit_log (actor_id, table_name, row_pk, action, diff)
  values (auth.uid(), tg_table_name, v_pk, lower(tg_op),
    case tg_op
      when 'INSERT' then jsonb_build_object('new', v_row)
      when 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', v_row)
      else jsonb_build_object('old', v_row)
    end);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger trg_profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function public.fn_audit_row_kv();

create trigger trg_user_roles_audit
  after insert or delete on public.user_roles
  for each row execute function public.fn_audit_row_kv();

create trigger trg_user_perms_audit
  after insert or update or delete on public.user_permissions
  for each row execute function public.fn_audit_row_kv();
