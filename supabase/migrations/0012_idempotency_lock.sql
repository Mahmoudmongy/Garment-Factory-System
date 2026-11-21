-- Makes every idempotency key race-safe.
--
-- The write RPCs all used "SELECT by key, then INSERT". Two sessions holding the same key
-- both find nothing, both insert, and the loser dies on the unique index with
-- "duplicate key value violates unique constraint" instead of reporting a replay. On a phone
-- that re-sends a request after a dropped response this is exactly the normal case, so the
-- caller sees an error and retries again — a retry storm on top of a successful write.
--
-- Verified before the fix: 10 parallel sessions posting one key produced 1 OK, 8 REPLAY and
-- 1 "duplicate key" error.
--
-- The fix takes a transaction-scoped advisory lock on the key before the SELECT, so the second
-- session blocks until the first commits and then finds the row it is looking for. The lock is
-- on the key alone: keys are unique per table, and the lock is released at commit.

create or replace function public.fn_idempotency_lock(p_table text, p_key text)
returns void language plpgsql as $$
begin
  if p_key is null then return; end if;
  -- Two-argument form keeps the table name and the key in separate lock spaces.
  perform pg_advisory_xact_lock(hashtext('idem:' || p_table), hashtext(p_key));
end $$;

-- ---------------------------------------------------------------- cash postings
create or replace function public.rpc_post_cash(
  p_account uuid, p_amount numeric, p_category text, p_description text,
  p_date date default null, p_customer uuid default null,
  p_employee uuid default null, p_order uuid default null, p_key text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.fn_require_permission('account.transaction.create');
  if coalesce(trim(p_description), '') = '' then perform public.fn_raise('E_DESCRIPTION_REQUIRED'); end if;

  if p_key is not null then
    perform public.fn_idempotency_lock('financial_transactions', p_key);
    select id into v_id from public.financial_transactions where idempotency_key = p_key;
    if v_id is not null then return jsonb_build_object('id', v_id, 'replayed', true); end if;
  end if;

  insert into public.financial_transactions
    (account_id, amount, category, description, txn_date, customer_id, employee_id,
     production_order_id, idempotency_key)
  values (p_account, p_amount, p_category, trim(p_description),
          coalesce(p_date, public.fn_today()), p_customer, p_employee, p_order, p_key)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'replayed', false);
end $$;

-- ---------------------------------------------------------------- expenses
create or replace function public.rpc_create_expense(
  p_account uuid, p_category text, p_description text, p_amount numeric,
  p_date date default null, p_order uuid default null, p_key text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.fn_require_permission('expense.create');
  if p_amount is null or p_amount <= 0 then perform public.fn_raise('E_AMOUNT_POSITIVE'); end if;
  if coalesce(trim(p_description), '') = '' then perform public.fn_raise('E_DESCRIPTION_REQUIRED'); end if;

  if p_key is not null then
    perform public.fn_idempotency_lock('expenses', p_key);
    select id into v_id from public.expenses where idempotency_key = p_key;
    if v_id is not null then return jsonb_build_object('id', v_id, 'replayed', true); end if;
  end if;

  insert into public.expenses
    (account_id, category, description, amount, expense_date, production_order_id, idempotency_key)
  values (p_account, p_category, trim(p_description), p_amount,
          coalesce(p_date, public.fn_today()), p_order, p_key)
  returning id into v_id;

  -- The cash leaves the drawer in the same breath; one document, two ledgers.
  insert into public.financial_transactions
    (account_id, amount, category, description, txn_date, production_order_id, idempotency_key)
  values (p_account, -p_amount, 'expense', trim(p_description),
          coalesce(p_date, public.fn_today()), p_order,
          case when p_key is null then null else p_key || ':cash' end);

  return jsonb_build_object('id', v_id, 'replayed', false);
end $$;

-- ---------------------------------------------------------------- customer fabric
create or replace function public.rpc_receive_fabric(
  p_customer uuid, p_colour text, p_quantity numeric,
  p_order uuid default null, p_date date default null,
  p_notes text default null, p_key text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.fn_require_permission('production.fabric.receive');
  if p_quantity is null or p_quantity <= 0 then perform public.fn_raise('E_QTY_POSITIVE'); end if;
  if coalesce(trim(p_colour), '') = '' then perform public.fn_raise('E_COLOUR_REQUIRED'); end if;

  if p_key is not null then
    perform public.fn_idempotency_lock('customer_fabric_movements', p_key);
    select id into v_id from public.customer_fabric_movements where idempotency_key = p_key;
    if v_id is not null then
      return jsonb_build_object('id', v_id, 'replayed', true);
    end if;
  end if;

  insert into public.customer_fabric_movements
    (customer_id, colour, quantity, movement, production_order_id, txn_date, notes, idempotency_key)
  values (p_customer, trim(p_colour), p_quantity, 'receive', p_order,
          coalesce(p_date, public.fn_today()), p_notes, p_key)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'replayed', false);
end $$;

-- ---------------------------------------------------------------- stock movements
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
    perform public.fn_idempotency_lock('inventory_transactions', p_key);
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
