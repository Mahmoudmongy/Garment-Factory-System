-- 20261019000004_ledgers.sql
-- Transaction layer. Append-only ledgers; balances are COMPUTED (never stored).
-- STATUS: NOT EXECUTED (no database available when authored).
-- Custom SQLSTATEs: F0001 idempotency conflict | F0002 insufficient balance | F0003 insufficient stock
--                   F0004 admin safety | F0005 reversal rule | F0006 append-only | F0007 overlap
--                   F0008 no free letters | F0009 inactive master record

-- =================================================== financial_transactions
create table public.financial_transactions (
  id               uuid primary key default gen_random_uuid(),
  seq              bigint generated always as identity unique,
  transaction_date date not null,
  account_id       uuid not null references public.financial_accounts(id),
  direction        text not null check (direction in ('in','out')),
  amount           numeric(14,2) not null check (amount > 0),
  source_type      text not null check (source_type in
                     ('customer_payment','worker_payment','worker_advance','expense','purchase',
                      'maintenance','manual_adjustment','other','reversal')),
  -- Polymorphic reference to the source document (module tables do not exist yet => no FK).
  source_id        uuid,
  description      text,
  reverses_id      uuid unique references public.financial_transactions(id),
  idempotency_key  text not null unique check (length(idempotency_key) >= 8),
  request_hash     text not null,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  check (source_id is not null or source_type in ('manual_adjustment','other')),
  check ((source_type = 'reversal') = (reverses_id is not null))
);
create index on public.financial_transactions (account_id, transaction_date);
create index on public.financial_transactions (source_type, source_id);

create trigger fin_tx_immutable before update or delete on public.financial_transactions
  for each row execute function public.trg_forbid_mutation();
create trigger fin_tx_no_truncate before truncate on public.financial_transactions
  for each statement execute function public.trg_forbid_mutation();

create or replace function public.trg_fin_reversal_check() returns trigger
language plpgsql as $$
declare o public.financial_transactions%rowtype;
begin
  if new.reverses_id is null then return new; end if;
  select * into o from public.financial_transactions where id = new.reverses_id;
  if not found then raise exception 'original transaction not found' using errcode = 'P0002'; end if;
  if o.reverses_id is not null then raise exception 'a reversal cannot be reversed' using errcode = 'F0005'; end if;
  if o.account_id <> new.account_id or o.amount <> new.amount or o.direction = new.direction then
    raise exception 'a reversal must mirror the original transaction' using errcode = 'F0005';
  end if;
  return new;
end $$;
create trigger fin_tx_reversal_check before insert on public.financial_transactions
  for each row execute function public.trg_fin_reversal_check();

-- opening balance may not change once the account has transactions (use an adjustment).
create or replace function public.trg_account_opening_lock() returns trigger
language plpgsql as $$
begin
  if new.opening_balance is distinct from old.opening_balance
     and exists (select 1 from public.financial_transactions where account_id = old.id) then
    raise exception 'opening balance is locked once transactions exist' using errcode = 'F0006';
  end if;
  return new;
end $$;
create trigger account_opening_lock before update on public.financial_accounts
  for each row execute function public.trg_account_opening_lock();

create or replace function public.fn_account_balance(p_account uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select a.opening_balance + coalesce((select sum(case t.direction when 'in' then t.amount else -t.amount end)
                                         from public.financial_transactions t where t.account_id = a.id), 0)
    from public.financial_accounts a where a.id = p_account
$$;

create or replace view public.v_account_balances with (security_invoker = true) as
select a.id as account_id, a.code, a.name, a.account_type,
       a.opening_balance + coalesce(sum(case t.direction when 'in' then t.amount else -t.amount end), 0) as current_balance,
       count(t.id) as transaction_count
  from public.financial_accounts a
  left join public.financial_transactions t on t.account_id = a.id
 group by a.id;

-- INTERNAL poster. Not granted to API roles; module RPCs and tests call it.
create or replace function public.fn_post_financial_transaction(
  p_account uuid, p_direction text, p_amount numeric, p_date date, p_source_type text,
  p_source_id uuid, p_description text, p_key text, p_reverses uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_acc public.financial_accounts%rowtype; v_ex public.financial_transactions%rowtype;
        v_hash text; v_bal numeric; v_id uuid;
begin
  if p_direction not in ('in','out') then raise exception 'invalid direction' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  if p_date is null then raise exception 'transaction date is required' using errcode = '22023'; end if;
  if p_key is null or length(p_key) < 8 then raise exception 'idempotency key is required (min 8 chars)' using errcode = '22023'; end if;

  select * into v_acc from public.financial_accounts where id = p_account for update;   -- serialises per account
  if not found then raise exception 'account not found' using errcode = 'P0002'; end if;

  v_hash := encode(sha256(convert_to(concat_ws('|', p_account, p_direction, p_amount::text, p_date::text, p_source_type,
                     coalesce(p_source_id::text, ''), coalesce(p_reverses::text, '')), 'UTF8')), 'hex');
  select * into v_ex from public.financial_transactions where idempotency_key = p_key;
  if found then
    if v_ex.request_hash <> v_hash then
      raise exception 'idempotency key reused with a different request' using errcode = 'F0001';
    end if;
    return jsonb_build_object('id', v_ex.id, 'replayed', true);
  end if;

  if not v_acc.is_active then raise exception 'account is inactive' using errcode = 'F0009'; end if;
  if p_reverses is not null and exists (select 1 from public.financial_transactions where reverses_id = p_reverses) then
    raise exception 'transaction already reversed' using errcode = 'F0005';
  end if;
  v_bal := public.fn_account_balance(p_account);
  -- OPEN BUSINESS DECISION: the same no-negative rule is applied to reversals.
  if p_direction = 'out' and not v_acc.allow_negative and v_bal < p_amount then
    raise exception 'insufficient balance (% available)', v_bal using errcode = 'F0002';
  end if;

  insert into public.financial_transactions
    (transaction_date, account_id, direction, amount, source_type, source_id, description,
     reverses_id, idempotency_key, request_hash, created_by)
  values (p_date, p_account, p_direction, p_amount, p_source_type, p_source_id, p_description,
          p_reverses, p_key, v_hash, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'replayed', false,
           'balance', v_bal + case p_direction when 'in' then p_amount else -p_amount end);
end $$;

-- =================================================== inventory_transactions
create table public.inventory_transactions (
  id                  uuid primary key default gen_random_uuid(),
  seq                 bigint generated always as identity unique,
  transaction_date    date not null,
  txn_type            text not null check (txn_type in
                        ('receipt','issue','return_in','return_out','adjustment_in','adjustment_out',
                         'transfer_in','transfer_out','consumption','reversal_in','reversal_out')),
  direction           text not null check (direction in ('in','out')),
  item_id             uuid not null references public.items(id),
  warehouse_id        uuid not null references public.warehouses(id),
  quantity            numeric(14,3) not null check (quantity > 0),
  unit                text not null,
  ownership           text not null check (ownership in ('factory','customer')),
  customer_id         uuid references public.customers(id),
  production_order_id uuid,                       -- FK added by the Production Orders module
  unit_cost           numeric(14,4) check (unit_cost is null or unit_cost >= 0),
  source_type         text not null check (source_type in
                        ('manual','purchase','customer_receipt','production','adjustment','transfer','reversal')),
  source_id           uuid,
  transfer_group_id   uuid,
  notes               text,
  reverses_id         uuid unique references public.inventory_transactions(id),
  idempotency_key     text not null unique check (length(idempotency_key) >= 8),
  request_hash        text not null,
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  check ((ownership = 'customer') = (customer_id is not null)),
  check ((direction = 'in') = (txn_type in ('receipt','return_in','adjustment_in','transfer_in','reversal_in'))),
  check ((txn_type in ('reversal_in','reversal_out')) = (reverses_id is not null)),
  check (source_id is not null or source_type in ('manual','adjustment'))
);
create index on public.inventory_transactions (item_id, warehouse_id, ownership, customer_id);
create index on public.inventory_transactions (production_order_id);

create trigger inv_tx_immutable before update or delete on public.inventory_transactions
  for each row execute function public.trg_forbid_mutation();
create trigger inv_tx_no_truncate before truncate on public.inventory_transactions
  for each statement execute function public.trg_forbid_mutation();

create or replace function public.trg_inv_reversal_check() returns trigger
language plpgsql as $$
declare o public.inventory_transactions%rowtype;
begin
  if new.reverses_id is null then return new; end if;
  select * into o from public.inventory_transactions where id = new.reverses_id;
  if not found then raise exception 'original transaction not found' using errcode = 'P0002'; end if;
  if o.reverses_id is not null or o.txn_type in ('transfer_in','transfer_out') then
    raise exception 'this transaction cannot be reversed individually' using errcode = 'F0005';
  end if;
  if o.item_id <> new.item_id or o.warehouse_id <> new.warehouse_id or o.quantity <> new.quantity
     or o.ownership <> new.ownership or o.customer_id is distinct from new.customer_id
     or o.direction = new.direction then
    raise exception 'a reversal must mirror the original transaction' using errcode = 'F0005';
  end if;
  return new;
end $$;
create trigger inv_tx_reversal_check before insert on public.inventory_transactions
  for each row execute function public.trg_inv_reversal_check();

create or replace function public.fn_stock_balance(p_item uuid, p_wh uuid, p_ownership text, p_customer uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(case direction when 'in' then quantity else -quantity end), 0)
    from public.inventory_transactions
   where item_id = p_item and warehouse_id = p_wh and ownership = p_ownership
     and customer_id is not distinct from p_customer
$$;

create or replace view public.v_stock_balances with (security_invoker = true) as
select item_id, warehouse_id, ownership, customer_id,
       sum(case direction when 'in' then quantity else -quantity end) as quantity
  from public.inventory_transactions
 group by item_id, warehouse_id, ownership, customer_id;

-- INTERNAL poster (not granted to API roles).
create or replace function public.fn_post_inventory_transaction(
  p_type text, p_item uuid, p_warehouse uuid, p_qty numeric, p_date date, p_ownership text, p_customer uuid,
  p_po uuid, p_unit_cost numeric, p_source_type text, p_source_id uuid, p_notes text, p_key text,
  p_reverses uuid default null, p_group uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item public.items%rowtype; v_wh public.warehouses%rowtype; v_ex public.inventory_transactions%rowtype;
        v_hash text; v_dir text; v_bal numeric; v_id uuid;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'quantity must be positive' using errcode = '22023'; end if;
  if p_date is null then raise exception 'transaction date is required' using errcode = '22023'; end if;
  if p_key is null or length(p_key) < 8 then raise exception 'idempotency key is required (min 8 chars)' using errcode = '22023'; end if;
  v_dir := case when p_type in ('receipt','return_in','adjustment_in','transfer_in','reversal_in') then 'in' else 'out' end;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws('|', p_item, p_warehouse, p_ownership, coalesce(p_customer::text, '')), 0));

  v_hash := encode(sha256(convert_to(concat_ws('|', p_type, p_item, p_warehouse, p_qty::text, p_date::text, p_ownership,
                     coalesce(p_customer::text, ''), coalesce(p_po::text, ''), coalesce(p_unit_cost::text, ''),
                     p_source_type, coalesce(p_source_id::text, ''), coalesce(p_reverses::text, ''),
                     coalesce(p_group::text, '')), 'UTF8')), 'hex');
  select * into v_ex from public.inventory_transactions where idempotency_key = p_key;
  if found then
    if v_ex.request_hash <> v_hash then
      raise exception 'idempotency key reused with a different request' using errcode = 'F0001';
    end if;
    return jsonb_build_object('id', v_ex.id, 'replayed', true);
  end if;

  select * into v_item from public.items where id = p_item;
  if not found then raise exception 'item not found' using errcode = 'P0002'; end if;
  select * into v_wh from public.warehouses where id = p_warehouse;
  if not found then raise exception 'warehouse not found' using errcode = 'P0002'; end if;
  if not v_item.is_active or not v_wh.is_active then
    raise exception 'item or warehouse is inactive' using errcode = 'F0009';
  end if;
  if p_reverses is not null and exists (select 1 from public.inventory_transactions where reverses_id = p_reverses) then
    raise exception 'transaction already reversed' using errcode = 'F0005';
  end if;

  v_bal := public.fn_stock_balance(p_item, p_warehouse, p_ownership, p_customer);
  if v_dir = 'out' and v_bal < p_qty then
    raise exception 'insufficient stock (% available)', v_bal using errcode = 'F0003';
  end if;

  insert into public.inventory_transactions
    (transaction_date, txn_type, direction, item_id, warehouse_id, quantity, unit, ownership, customer_id,
     production_order_id, unit_cost, source_type, source_id, transfer_group_id, notes, reverses_id,
     idempotency_key, request_hash, created_by)
  values (p_date, p_type, v_dir, p_item, p_warehouse, p_qty, v_item.base_unit, p_ownership, p_customer,
          p_po, p_unit_cost, p_source_type, p_source_id, p_group, p_notes, p_reverses,
          p_key, v_hash, auth.uid())
  returning id into v_id;

  if p_type = 'receipt' and p_unit_cost is not null and p_ownership = 'factory' then
    insert into public.item_cost_history (item_id, unit_cost, effective_date, source_type, source_id, created_by)
    values (p_item, p_unit_cost, p_date, 'inventory_transaction', v_id, auth.uid());
  end if;
  return jsonb_build_object('id', v_id, 'replayed', false,
           'balance', v_bal + case v_dir when 'in' then p_qty else -p_qty end);
end $$;

-- =================================================== production_transactions
-- Structure only. Posting rules (accepted / rejected / rework / transfer / stage completion)
-- belong to the Work Assignment module; there is deliberately NO posting RPC yet.
create table public.production_transactions (
  id                  uuid primary key default gen_random_uuid(),
  seq                 bigint generated always as identity unique,
  txn_type            text not null check (txn_type in
                        ('assignment','receive','accepted','rejected','rework','transfer','stage_completion','reversal')),
  production_order_id uuid,                      -- FKs added by Production Orders / Bundles modules
  bundle_id           uuid,
  stage_key           text,
  employee_id         uuid references public.employees(id),
  quantity            numeric(14,3) not null check (quantity > 0),
  payload             jsonb not null default '{}'::jsonb,
  reverses_id         uuid unique references public.production_transactions(id),
  idempotency_key     text not null unique check (length(idempotency_key) >= 8),
  request_hash        text not null,
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  check ((txn_type = 'reversal') = (reverses_id is not null))
);
create index on public.production_transactions (production_order_id, bundle_id);
create index on public.production_transactions (employee_id, created_at);
create trigger prod_tx_immutable before update or delete on public.production_transactions
  for each row execute function public.trg_forbid_mutation();
create trigger prod_tx_no_truncate before truncate on public.production_transactions
  for each statement execute function public.trg_forbid_mutation();

-- audit every ledger insert (updates/deletes are blocked anyway)
select public.fn_attach_audit('public.financial_transactions', array['id'], 'insert');
select public.fn_attach_audit('public.inventory_transactions', array['id'], 'insert');
select public.fn_attach_audit('public.production_transactions', array['id'], 'insert');
