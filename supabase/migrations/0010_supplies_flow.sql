-- ============================================================================
-- 0010 — stock balances and the supplies issue/return flows.
-- Supplies are read from the movement ledger, never from a stored counter, so a
-- mistaken receipt is corrected by posting the opposite movement.
-- ============================================================================

create or replace view public.v_stock_balances as
  select i.id as item_id, i.code as item_code, i.name as item_name, i.category,
         i.base_unit, w.id as warehouse_id, w.code as warehouse_code, w.name as warehouse_name,
         t.ownership,
         t.customer_id, c.name as customer_name,
         sum(t.quantity) as quantity,
         sum(case when t.quantity > 0 then t.quantity else 0 end) as received_quantity,
         sum(case when t.quantity < 0 then -t.quantity else 0 end) as issued_quantity,
         max(t.txn_date) as last_movement_on
    from public.inventory_transactions t
    join public.items i on i.id = t.item_id
    join public.warehouses w on w.id = t.warehouse_id
    left join public.customers c on c.id = t.customer_id
   group by i.id, i.code, i.name, i.category, i.base_unit,
            w.id, w.code, w.name, t.ownership, t.customer_id, c.name;

grant select on public.v_stock_balances to authenticated;

-- ---------------------------------------------------------------- stock movements
-- Redefined here so a retried submit replays instead of posting the stock twice,
-- and so a missing unit cost falls back to zero rather than violating the domain.
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

  if p_key is not null then
    select id into v_id from public.inventory_transactions where idempotency_key = p_key;
    if v_id is not null then return jsonb_build_object('id', v_id, 'replayed', true); end if;
  end if;

  insert into public.inventory_transactions (
    item_id, warehouse_id, quantity, ownership, customer_id,
    production_order_id, movement, unit_cost, notes, idempotency_key, created_by
  ) values (
    p_item, p_warehouse, p_quantity, p_ownership, p_customer,
    p_order, p_movement, coalesce(p_unit_cost, 0), p_notes, p_key, auth.uid()
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'replayed', false);
end $$;

-- ---------------------------------------------------------------- supplies flows
-- Buying supplies is an expense and a stock receipt in one step, so the two can
-- never disagree about how much was bought.
create or replace function public.rpc_purchase_supplies(
  p_item uuid, p_warehouse uuid, p_quantity numeric, p_unit_cost numeric,
  p_account uuid, p_date date default null, p_notes text default null,
  p_key text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_amount numeric; v_expense jsonb; v_move jsonb;
begin
  perform public.fn_require_permission('inventory.receive');
  perform public.fn_require_permission('expense.create');
  if p_quantity is null or p_quantity <= 0 then perform public.fn_raise('E_QTY_POSITIVE'); end if;
  if p_unit_cost is null or p_unit_cost < 0 then perform public.fn_raise('E_AMOUNT_POSITIVE'); end if;

  v_amount := round(p_quantity * p_unit_cost, 2);

  v_expense := public.rpc_create_expense(
    p_account, 'supplies',
    coalesce(nullif(trim(p_notes), ''), 'شراء مستلزمات'), v_amount, p_date, null,
    case when p_key is null then null else p_key || ':expense' end);

  v_move := public.rpc_move_stock(
    p_item, p_warehouse, p_quantity, 'purchase', 'factory', null, null,
    p_unit_cost, p_notes,
    case when p_key is null then null else p_key || ':stock' end);

  return jsonb_build_object('expense', v_expense, 'movement', v_move, 'amount', v_amount);
end $$;

-- Customer-owned supplies carry no cost: the customer bought them, the factory
-- only holds and issues them against that customer's orders.
create or replace function public.rpc_receive_customer_supplies(
  p_item uuid, p_warehouse uuid, p_customer uuid, p_quantity numeric,
  p_date date default null, p_notes text default null, p_key text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_require_permission('inventory.receive');
  if p_customer is null then perform public.fn_raise('E_CUSTOMER_REQUIRED'); end if;
  if p_quantity is null or p_quantity <= 0 then perform public.fn_raise('E_QTY_POSITIVE'); end if;

  return public.rpc_move_stock(
    p_item, p_warehouse, p_quantity, 'customer_receipt', 'customer', p_customer, null, 0,
    p_notes, p_key);
end $$;

create or replace function public.rpc_issue_supplies(
  p_item uuid, p_warehouse uuid, p_quantity numeric, p_ownership text default 'factory',
  p_customer uuid default null, p_order uuid default null,
  p_date date default null, p_notes text default null, p_key text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_have numeric;
begin
  perform public.fn_require_permission('inventory.issue');
  if p_quantity is null or p_quantity <= 0 then perform public.fn_raise('E_QTY_POSITIVE'); end if;
  if p_ownership = 'customer' and p_customer is null then
    perform public.fn_raise('E_CUSTOMER_REQUIRED');
  end if;

  -- Issuing what is not in stock is a data-entry error, not a negative balance.
  select coalesce(sum(quantity), 0) into v_have
    from public.inventory_transactions
   where item_id = p_item and warehouse_id = p_warehouse
     and ownership = p_ownership
     and coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_customer, '00000000-0000-0000-0000-000000000000'::uuid);
  if p_quantity > v_have then
    perform public.fn_raise('E_OVER_ISSUE', v_have::text);
  end if;

  return public.rpc_move_stock(
    p_item, p_warehouse, -p_quantity, 'issue', p_ownership, p_customer, p_order, 0,
    p_notes, p_key);
end $$;
