-- 20261019000005_rpc.sql
-- API surface. Every function: SECURITY DEFINER + fixed search_path + fn_require_permission() first.
-- Clients get NO direct INSERT/UPDATE/DELETE on tables; all writes go through these RPCs.
-- STATUS: NOT EXECUTED (no database available when authored).

-- ------------------------------------------------------------------ identity
create or replace function public.rpc_my_permissions() returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v text[];
begin
  if not public.fn_is_active_user() then return array[]::text[]; end if;
  select coalesce(array_agg(k order by k), array[]::text[]) into v from (
    select p.key as k from public.permissions p
     where p.is_active and ( public.fn_is_superuser()
        or ( ( exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.is_active
                        join public.role_permissions rp on rp.role_id = ur.role_id
                        where ur.profile_id = auth.uid() and rp.permission_key = p.key)
               or exists (select 1 from public.user_permissions up where up.profile_id = auth.uid()
                           and up.permission_key = p.key and up.effect = 'grant') )
             and not exists (select 1 from public.user_permissions up where up.profile_id = auth.uid()
                              and up.permission_key = p.key and up.effect = 'deny') ) )
  ) s;
  return v;
end $$;

create or replace function public.rpc_create_profile(p_user uuid, p_username text, p_display text,
  p_employee uuid, p_roles text[]) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int; v_super boolean;
begin
  perform public.fn_require_permission('system.user.manage');
  select count(*), coalesce(bool_or(r.is_superuser), false) into v_n, v_super
    from public.roles r where r.code = any(coalesce(p_roles, array[]::text[])) and r.is_active;
  if v_n <> coalesce(array_length(p_roles, 1), 0) then raise exception 'unknown or inactive role' using errcode = '22023'; end if;
  if v_super and not public.fn_is_superuser() then
    raise exception 'permission denied: only an admin can grant the admin role' using errcode = '42501';
  end if;
  insert into public.profiles (id, employee_id, username, display_name, created_by)
  values (p_user, p_employee, lower(btrim(p_username)), p_display, auth.uid());
  insert into public.user_roles (profile_id, role_id, granted_by)
  select p_user, r.id, auth.uid() from public.roles r where r.code = any(coalesce(p_roles, array[]::text[]));
  return p_user;
end $$;

create or replace function public.rpc_set_profile_active(p_profile uuid, p_active boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.fn_require_permission('system.user.manage');
  perform public.fn_set_reason(p_reason, true);
  update public.profiles set is_active = p_active where id = p_profile;
  if not found then raise exception 'profile not found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.rpc_assign_role(p_profile uuid, p_role_code text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role public.roles%rowtype;
begin
  perform public.fn_require_permission('system.user.manage');
  perform public.fn_set_reason(p_reason, true);
  select * into v_role from public.roles where code = p_role_code and is_active;
  if not found then raise exception 'unknown or inactive role' using errcode = '22023'; end if;
  if v_role.is_superuser and not public.fn_is_superuser() then
    raise exception 'permission denied: only an admin can grant the admin role' using errcode = '42501';
  end if;
  insert into public.user_roles (profile_id, role_id, granted_by) values (p_profile, v_role.id, auth.uid())
  on conflict do nothing;
end $$;

create or replace function public.rpc_revoke_role(p_profile uuid, p_role_code text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role public.roles%rowtype;
begin
  perform public.fn_require_permission('system.user.manage');
  perform public.fn_set_reason(p_reason, true);
  select * into v_role from public.roles where code = p_role_code;
  if not found then raise exception 'unknown role' using errcode = '22023'; end if;
  if v_role.is_superuser and not public.fn_is_superuser() then
    raise exception 'permission denied: only an admin can revoke the admin role' using errcode = '42501';
  end if;
  delete from public.user_roles where profile_id = p_profile and role_id = v_role.id;   -- guarded by trigger
end $$;

-- p_effect: 'grant' | 'deny' | null (= clear the override)
create or replace function public.rpc_set_user_permission(p_profile uuid, p_key text, p_effect text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.fn_require_permission('system.permission.manage');
  perform public.fn_set_reason(p_reason, true);
  if p_effect is not null and p_effect not in ('grant','deny') then raise exception 'invalid effect' using errcode = '22023'; end if;
  if p_effect = 'grant' and not public.has_permission(p_key) then
    raise exception 'permission denied: cannot grant a permission you do not hold (%)', p_key using errcode = '42501';
  end if;
  if p_effect is null then
    delete from public.user_permissions where profile_id = p_profile and permission_key = p_key;
  else
    insert into public.user_permissions (profile_id, permission_key, effect, granted_by)
    values (p_profile, p_key, p_effect, auth.uid())
    on conflict (profile_id, permission_key) do update set effect = excluded.effect, granted_by = excluded.granted_by, granted_at = now();
  end if;
end $$;

create or replace function public.rpc_role_grant_permission(p_role_code text, p_key text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role uuid;
begin
  perform public.fn_require_permission('system.role.manage');
  perform public.fn_set_reason(p_reason, true);
  if not public.has_permission(p_key) then
    raise exception 'permission denied: cannot grant a permission you do not hold (%)', p_key using errcode = '42501';
  end if;
  select id into v_role from public.roles where code = p_role_code;
  if v_role is null then raise exception 'unknown role' using errcode = '22023'; end if;
  insert into public.role_permissions (role_id, permission_key) values (v_role, p_key) on conflict do nothing;
end $$;

create or replace function public.rpc_role_revoke_permission(p_role_code text, p_key text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.fn_require_permission('system.role.manage');
  perform public.fn_set_reason(p_reason, true);
  delete from public.role_permissions where permission_key = p_key
    and role_id = (select id from public.roles where code = p_role_code);
end $$;

-- ------------------------------------------------------------------ customers
create or replace function public.rpc_create_customer(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.customers%rowtype; v_letter text;
begin
  perform public.fn_require_permission('customer.create');
  v_letter := upper(nullif(btrim(p ->> 'op_letter'), ''));
  if v_letter is null then v_letter := public.fn_next_op_letter(); end if;
  insert into public.customers (name, op_letter, phone, address, notes, created_by)
  values (btrim(p ->> 'name'), v_letter, nullif(btrim(p ->> 'phone'), ''), p ->> 'address', p ->> 'notes', auth.uid())
  returning * into v;
  return jsonb_build_object('id', v.id, 'code', v.code, 'op_letter', v.op_letter);
end $$;

create or replace function public.rpc_update_customer(p_id uuid, p_patch jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.fn_require_permission('customer.edit');
  perform public.fn_set_reason(p_reason, true);
  if p_patch ? 'op_letter' then
    raise exception 'op_letter cannot be changed (OPEN BUSINESS DECISION)' using errcode = '22023';
  end if;
  if (p_patch ? 'is_active') and not (p_patch ->> 'is_active')::boolean then
    perform public.fn_require_permission('customer.delete');
  end if;
  update public.customers set
    name      = coalesce(nullif(btrim(p_patch ->> 'name'), ''), name),
    phone     = case when p_patch ? 'phone' then nullif(btrim(p_patch ->> 'phone'), '') else phone end,
    address   = case when p_patch ? 'address' then p_patch ->> 'address' else address end,
    notes     = case when p_patch ? 'notes' then p_patch ->> 'notes' else notes end,
    is_active = case when p_patch ? 'is_active' then (p_patch ->> 'is_active')::boolean else is_active end,
    updated_by = auth.uid()
  where id = p_id;
  if not found then raise exception 'customer not found' using errcode = 'P0002'; end if;
end $$;

-- ------------------------------------------------------------------ employees
create or replace function public.rpc_create_employee(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.employees%rowtype;
begin
  perform public.fn_require_permission('employee.create');
  insert into public.employees (full_name, job_title, department, employment_type, phone, phone2, start_date, notes, created_by)
  values (btrim(p ->> 'full_name'), p ->> 'job_title', p ->> 'department', p ->> 'employment_type',
          regexp_replace(coalesce(p ->> 'phone', ''), '\s', '', 'g'),
          nullif(regexp_replace(coalesce(p ->> 'phone2', ''), '\s', '', 'g'), ''),
          nullif(p ->> 'start_date', '')::date, p ->> 'notes', auth.uid())
  returning * into v;
  return jsonb_build_object('id', v.id, 'code', v.code);
end $$;

create or replace function public.rpc_update_employee(p_id uuid, p_patch jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.fn_require_permission('employee.edit');
  perform public.fn_set_reason(p_reason, true);
  if (p_patch ? 'status') and (p_patch ->> 'status') <> 'active' then
    perform public.fn_require_permission('employee.deactivate');
  end if;
  if p_patch ? 'id_document_path' then
    perform public.fn_require_permission('employee.document.upload');
  end if;
  update public.employees set
    full_name       = coalesce(nullif(btrim(p_patch ->> 'full_name'), ''), full_name),
    job_title       = case when p_patch ? 'job_title' then p_patch ->> 'job_title' else job_title end,
    department      = case when p_patch ? 'department' then p_patch ->> 'department' else department end,
    employment_type = case when p_patch ? 'employment_type' then p_patch ->> 'employment_type' else employment_type end,
    phone           = coalesce(nullif(regexp_replace(coalesce(p_patch ->> 'phone', ''), '\s', '', 'g'), ''), phone),
    phone2          = case when p_patch ? 'phone2' then nullif(regexp_replace(coalesce(p_patch ->> 'phone2', ''), '\s', '', 'g'), '') else phone2 end,
    start_date      = case when p_patch ? 'start_date' then nullif(p_patch ->> 'start_date', '')::date else start_date end,
    status          = coalesce(p_patch ->> 'status', status),
    id_document_path = case when p_patch ? 'id_document_path' then p_patch ->> 'id_document_path' else id_document_path end,
    notes           = case when p_patch ? 'notes' then p_patch ->> 'notes' else notes end,
    updated_by      = auth.uid()
  where id = p_id;
  if not found then raise exception 'employee not found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.rpc_set_employee_pay_terms(p_employee uuid, p_basis text, p_amount numeric,
  p_salary_freq text, p_alloc_freq text, p_from date, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public.fn_require_permission('employee.payterms.manage');
  perform public.fn_set_reason(p_reason, true);
  update public.employee_pay_terms set effective_to = p_from - 1
   where employee_id = p_employee and effective_to is null and effective_from < p_from;
  insert into public.employee_pay_terms (employee_id, pay_basis, salary_amount, salary_frequency, allocation_frequency, effective_from, created_by)
  values (p_employee, p_basis, coalesce(p_amount, 0), p_salary_freq, p_alloc_freq, p_from, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ------------------------------------------------------------ master data
create or replace function public.rpc_create_financial_account(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.financial_accounts%rowtype;
begin
  perform public.fn_require_permission('account.create');
  insert into public.financial_accounts (name, account_type, opening_balance, allow_negative, created_by)
  values (btrim(p ->> 'name'), p ->> 'account_type', coalesce((p ->> 'opening_balance')::numeric, 0),
          coalesce((p ->> 'allow_negative')::boolean, false), auth.uid())
  returning * into v;
  return jsonb_build_object('id', v.id, 'code', v.code);
end $$;

create or replace function public.rpc_create_warehouse(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.warehouses%rowtype;
begin
  perform public.fn_require_permission('inventory.warehouse.manage');
  insert into public.warehouses (name, kind, created_by) values (btrim(p ->> 'name'), p ->> 'kind', auth.uid())
  returning * into v;
  return jsonb_build_object('id', v.id, 'code', v.code);
end $$;

create or replace function public.rpc_create_item(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.items%rowtype;
begin
  perform public.fn_require_permission('inventory.item.manage');
  insert into public.items (name, category, base_unit, default_cost, created_by)
  values (btrim(p ->> 'name'), p ->> 'category', btrim(p ->> 'base_unit'), nullif(p ->> 'default_cost', '')::numeric, auth.uid())
  returning * into v;
  return jsonb_build_object('id', v.id, 'code', v.code);
end $$;

-- ------------------------------------------------------------ financial
-- Manual postings only. Typed postings (customer_payment, worker_payment, ...) are made by the
-- owning module's RPC through fn_post_financial_transaction, in the same DB transaction as the source document.
create or replace function public.rpc_post_manual_transaction(p_account uuid, p_direction text, p_amount numeric,
  p_date date, p_description text, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.fn_require_permission('account.transaction.create');
  if p_description is null or length(btrim(p_description)) < 3 then
    raise exception 'a description is required' using errcode = '22023';
  end if;
  perform public.fn_set_reason(p_description, false);
  return public.fn_post_financial_transaction(p_account, p_direction, p_amount, p_date, 'manual_adjustment', null, p_description, p_key);
end $$;

create or replace function public.rpc_reverse_financial_transaction(p_id uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.financial_transactions%rowtype;
begin
  perform public.fn_require_permission('account.transaction.reverse');
  perform public.fn_set_reason(p_reason, true);
  select * into o from public.financial_transactions where id = p_id;
  if not found then raise exception 'transaction not found' using errcode = 'P0002'; end if;
  if o.reverses_id is not null then raise exception 'a reversal cannot be reversed' using errcode = 'F0005'; end if;
  return public.fn_post_financial_transaction(o.account_id, case o.direction when 'in' then 'out' else 'in' end, o.amount,
           public.fn_today(), 'reversal', o.id, 'Reversal: ' || btrim(p_reason), p_key, o.id);
end $$;

-- ------------------------------------------------------------ inventory
create or replace function public.rpc_post_inventory_transaction(p_type text, p_item uuid, p_warehouse uuid,
  p_qty numeric, p_date date, p_ownership text, p_customer uuid, p_unit_cost numeric, p_notes text, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.fn_require_permission(case p_type
    when 'receipt' then 'inventory.receive'
    when 'issue' then 'inventory.issue'
    when 'consumption' then 'inventory.issue'
    when 'return_in' then 'inventory.return'
    when 'return_out' then 'inventory.return'
    when 'adjustment_in' then 'inventory.adjust'
    when 'adjustment_out' then 'inventory.adjust'
    else 'inventory.invalid_type' end);          -- unknown type => key not in catalog => denied
  return public.fn_post_inventory_transaction(p_type, p_item, p_warehouse, p_qty, p_date, p_ownership, p_customer,
           null, p_unit_cost, case when p_type in ('adjustment_in','adjustment_out') then 'adjustment' else 'manual' end,
           null, p_notes, p_key);
end $$;

create or replace function public.rpc_transfer_inventory(p_item uuid, p_from uuid, p_to uuid, p_qty numeric,
  p_date date, p_ownership text, p_customer uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_group uuid; v1 jsonb; v2 jsonb;
begin
  perform public.fn_require_permission('inventory.transfer');
  if p_from = p_to then raise exception 'source and destination are the same' using errcode = '22023'; end if;
  v_group := md5(p_key)::uuid;                  -- deterministic => retry-safe
  v1 := public.fn_post_inventory_transaction('transfer_out', p_item, p_from, p_qty, p_date, p_ownership, p_customer,
          null, null, 'transfer', v_group, null, p_key || ':out', null, v_group);
  v2 := public.fn_post_inventory_transaction('transfer_in', p_item, p_to, p_qty, p_date, p_ownership, p_customer,
          null, null, 'transfer', v_group, null, p_key || ':in', null, v_group);
  return jsonb_build_object('group', v_group, 'out', v1 ->> 'id', 'in', v2 ->> 'id',
                            'replayed', (v1 ->> 'replayed')::boolean and (v2 ->> 'replayed')::boolean);
end $$;

create or replace function public.rpc_reverse_inventory_transaction(p_id uuid, p_reason text, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.inventory_transactions%rowtype;
begin
  perform public.fn_require_permission('inventory.reverse');
  perform public.fn_set_reason(p_reason, true);
  select * into o from public.inventory_transactions where id = p_id;
  if not found then raise exception 'transaction not found' using errcode = 'P0002'; end if;
  return public.fn_post_inventory_transaction(case o.direction when 'in' then 'reversal_out' else 'reversal_in' end,
           o.item_id, o.warehouse_id, o.quantity, public.fn_today(), o.ownership, o.customer_id,
           o.production_order_id, o.unit_cost, 'reversal', o.id, 'Reversal: ' || btrim(p_reason), p_key, o.id);
end $$;
