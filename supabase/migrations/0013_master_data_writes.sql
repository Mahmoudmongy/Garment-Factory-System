-- ============================================================================
-- 0013 — master-data write paths that had no RPC:
--        financial accounts (create/update), items, warehouses, machines,
--        employees. Balances are never stored; opening_balance is a seed-only
--        field and cannot be changed once the account has any transaction.
-- ============================================================================

-- ---------------------------------------------------------------- accounts
create or replace function public.rpc_create_account(
  p_name text, p_kind text default 'cash', p_opening numeric default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.fn_require_permission('account.create');
  if coalesce(trim(p_name), '') = '' then perform public.fn_raise('E_NAME_REQUIRED'); end if;
  if coalesce(p_kind, 'cash') not in ('cash', 'bank') then
    perform public.fn_raise('E_BAD_KIND', p_kind);
  end if;

  insert into public.financial_accounts (code, name, kind, opening_balance)
  values (public.fn_next_code('ACC'), trim(p_name), coalesce(p_kind, 'cash'),
          coalesce(p_opening, 0))
  returning id into v_id;

  return jsonb_build_object('id', v_id,
    'code', (select code from public.financial_accounts where id = v_id));
end $$;

create or replace function public.rpc_update_account(
  p_id uuid, p_name text default null, p_is_active boolean default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_require_permission('account.create');

  update public.financial_accounts set
    name      = coalesce(nullif(trim(p_name), ''), name),
    is_active = coalesce(p_is_active, is_active)
   where id = p_id;
  if not found then perform public.fn_raise('E_NOT_FOUND', 'account'); end if;

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- items
create or replace function public.rpc_update_item(
  p_id uuid, p_name text default null, p_category text default null,
  p_unit text default null, p_is_active boolean default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_require_permission('inventory.item.manage');

  update public.items set
    name      = coalesce(nullif(trim(p_name), ''), name),
    category  = coalesce(nullif(trim(p_category), ''), category),
    base_unit = coalesce(nullif(trim(p_unit), ''), base_unit),
    is_active = coalesce(p_is_active, is_active)
   where id = p_id;
  if not found then perform public.fn_raise('E_NOT_FOUND', 'item'); end if;

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- warehouses
create or replace function public.rpc_update_warehouse(
  p_id uuid, p_name text default null, p_kind text default null,
  p_is_active boolean default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_require_permission('inventory.warehouse.manage');
  if p_kind is not null and p_kind not in
      ('customer_fabric', 'factory_consumables', 'customer_supplies', 'finished_goods', 'returns')
  then perform public.fn_raise('E_BAD_KIND', p_kind); end if;

  update public.warehouses set
    name      = coalesce(nullif(trim(p_name), ''), name),
    kind      = coalesce(p_kind, kind),
    is_active = coalesce(p_is_active, is_active)
   where id = p_id;
  if not found then perform public.fn_raise('E_NOT_FOUND', 'warehouse'); end if;

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- machines
create or replace function public.rpc_update_machine(
  p_id uuid, p_name text default null, p_model text default null,
  p_is_active boolean default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_require_permission('machine.create');

  update public.machines set
    name      = coalesce(nullif(trim(p_name), ''), name),
    model     = coalesce(p_model, model),
    is_active = coalesce(p_is_active, is_active)
   where id = p_id;
  if not found then perform public.fn_raise('E_NOT_FOUND', 'machine'); end if;

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- employees
create or replace function public.rpc_update_employee(
  p_id uuid, p_name text default null, p_job_title text default null,
  p_phone text default null, p_is_active boolean default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_require_permission('employee.edit');

  update public.employees set
    name      = coalesce(nullif(trim(p_name), ''), name),
    job_title = coalesce(p_job_title, job_title),
    phone     = coalesce(p_phone, phone),
    is_active = coalesce(p_is_active, is_active)
   where id = p_id;
  if not found then perform public.fn_raise('E_NOT_FOUND', 'employee'); end if;

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- audit trail
-- Master data was previously only audited for customers and employees. Now that
-- these tables have edit paths, their changes must be traceable too.
do $$
declare t text;
begin
  foreach t in array array['items', 'warehouses', 'machines', 'financial_accounts'] loop
    if not exists (
      select 1 from pg_trigger
       where tgname = 'trg_audit_' || t and tgrelid = format('public.%s', t)::regclass
    ) then
      perform public.fn_attach_audit(format('public.%s', t)::regclass);
    end if;
  end loop;
end $$;
