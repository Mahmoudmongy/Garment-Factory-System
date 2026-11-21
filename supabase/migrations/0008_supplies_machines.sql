-- ============================================================================
-- 0008 — supplies (items / warehouses / inventory) and machines.
-- The UI writes only through these, so stock can never be edited by hand.
-- ============================================================================

-- ---------------------------------------------------------------- items
create or replace function public.rpc_create_item(
  p_name text, p_category text default null, p_unit text default 'قطعة'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.fn_require_permission('inventory.item.manage');
  if coalesce(trim(p_name), '') = '' then perform public.fn_raise('E_NAME_REQUIRED'); end if;

  insert into public.items (code, name, category, base_unit)
  values (public.fn_next_code('ITM'), trim(p_name), p_category, coalesce(p_unit, 'قطعة'))
  returning id into v_id;

  return jsonb_build_object('id', v_id,
    'code', (select code from public.items where id = v_id));
end $$;

-- ---------------------------------------------------------------- warehouses
create or replace function public.rpc_create_warehouse(
  p_name text, p_kind text default 'factory_consumables'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.fn_require_permission('inventory.warehouse.manage');
  if coalesce(trim(p_name), '') = '' then perform public.fn_raise('E_NAME_REQUIRED'); end if;
  if coalesce(p_kind, 'factory_consumables') not in
      ('customer_fabric', 'factory_consumables', 'customer_supplies', 'finished_goods', 'returns')
  then perform public.fn_raise('E_BAD_KIND', p_kind); end if;

  insert into public.warehouses (code, name, kind)
  values (public.fn_next_code('WH'), trim(p_name), coalesce(p_kind, 'factory_consumables'))
  returning id into v_id;

  return jsonb_build_object('id', v_id,
    'code', (select code from public.warehouses where id = v_id));
end $$;

-- ---------------------------------------------------------------- stock movement
-- One choke point for every stock change. Ownership decides who carries the cost:
-- factory stock is paid for, customer-owned supplies are not.
create or replace function public.rpc_move_stock(
  p_item uuid, p_warehouse uuid, p_quantity numeric, p_movement text,
  p_ownership text default 'factory', p_customer uuid default null,
  p_order uuid default null, p_unit_cost numeric default null,
  p_notes text default null, p_key text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.fn_require_permission('inventory.receive');
  if p_quantity is null or p_quantity = 0 then perform public.fn_raise('E_QTY_POSITIVE'); end if;
  if not exists (select 1 from public.items where id = p_item) then perform public.fn_raise('E_NOT_FOUND', 'item'); end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse) then perform public.fn_raise('E_NOT_FOUND', 'warehouse'); end if;
  if p_ownership not in ('factory', 'customer') then perform public.fn_raise('E_BAD_OWNERSHIP', p_ownership); end if;
  if p_ownership = 'customer' and p_customer is null then
    perform public.fn_raise('E_CUSTOMER_REQUIRED');
  end if;

  insert into public.inventory_transactions (
    item_id, warehouse_id, quantity, ownership, customer_id,
    production_order_id, movement, unit_cost, notes, idempotency_key, created_by
  ) values (
    p_item, p_warehouse, p_quantity, p_ownership, p_customer,
    p_order, p_movement, p_unit_cost, p_notes, p_key, auth.uid()
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end $$;

-- ---------------------------------------------------------------- machines
create or replace function public.rpc_create_machine(
  p_name text, p_model text default null, p_purchased_on date default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.fn_require_permission('machine.create');
  if coalesce(trim(p_name), '') = '' then perform public.fn_raise('E_NAME_REQUIRED'); end if;

  insert into public.machines (code, name, model, purchased_on)
  values (public.fn_next_code('MCH'), trim(p_name), p_model, p_purchased_on)
  returning id into v_id;

  return jsonb_build_object('id', v_id,
    'code', (select code from public.machines where id = v_id));
end $$;

create or replace function public.rpc_log_maintenance(
  p_machine uuid, p_description text, p_cost numeric default 0, p_date date default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.fn_require_permission('machine.maintenance');
  if coalesce(trim(p_description), '') = '' then perform public.fn_raise('E_DESCRIPTION_REQUIRED'); end if;
  if not exists (select 1 from public.machines where id = p_machine) then perform public.fn_raise('E_NOT_FOUND', 'machine'); end if;

  insert into public.machine_maintenance (machine_id, done_on, cost, description)
  values (p_machine, coalesce(p_date, public.fn_today()), coalesce(p_cost, 0), trim(p_description))
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end $$;
