-- Serialises issue against a stock line so the balance check cannot be raced.
--
-- Without this, rpc_issue_supplies reads the balance and then inserts in a separate statement.
-- Two sessions both see 100 available, both pass the check, and both insert — driving the
-- balance to -20 from 20 concurrent issues of 10. The invariant "stock never goes negative"
-- (docs/OPEN_BUSINESS_DECISIONS.md §7) is therefore only true for a single writer.
--
-- A per-line advisory lock is used rather than SELECT ... FOR UPDATE because the balance is an
-- aggregate over many rows: there is no single row to lock. The lock key is derived from the
-- four columns that define a stock line, so unrelated items still issue in parallel.

create or replace function public.fn_stock_lock(
  p_item uuid, p_warehouse uuid, p_ownership text, p_customer uuid
) returns void language sql as $$
  select pg_advisory_xact_lock(hashtextextended(
    p_item::text || '|' || p_warehouse::text || '|' || p_ownership || '|'
      || coalesce(p_customer::text, ''), 0));
$$;

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

  -- Taken before the balance read: the lock is released when this transaction commits,
  -- which is after rpc_move_stock has inserted its row.
  perform public.fn_stock_lock(p_item, p_warehouse, p_ownership, p_customer);

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
