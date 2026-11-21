-- ============================================================================
-- 0003 — master data: codes, customers, employees, items, warehouses,
--        accounts, machines, customer fabric (tracked by colour)
-- ============================================================================

-- ---------------------------------------------------------------- serial codes
-- Every business document has a human code like CUS0007 / PO0014 / BND0124.
-- A counter row per prefix makes them gap-free and concurrency-safe.
create table public.code_counters (
  prefix      text primary key,
  last_value  int not null default 0
);

create or replace function public.fn_next_code(p_prefix text, p_width int default 4)
returns text language plpgsql security definer set search_path = public as $$
declare v_next int;
begin
  insert into public.code_counters (prefix, last_value) values (p_prefix, 1)
  on conflict (prefix) do update set last_value = public.code_counters.last_value + 1
  returning last_value into v_next;
  return p_prefix || lpad(v_next::text, p_width, '0');
end $$;

-- ---------------------------------------------------------------- customers
create table public.customers (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  -- Prefix for operational codes (MM0001 = letter M + size M + serial). Unique per customer.
  operating_letter text not null unique check (operating_letter ~ '^[A-Z]{1,3}$'),
  name             text not null,
  phone            text,
  notes            text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_customers_updated before update on public.customers
  for each row execute function public.fn_set_updated_at();
create trigger trg_audit_customers after insert or update or delete on public.customers
  for each row execute function public.fn_audit_row();

-- ---------------------------------------------------------------- employees
create table public.employees (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  -- 'worker' takes piece work; 'operations' is salaried factory staff.
  kind          text not null default 'worker' check (kind in ('worker','operations')),
  job_title     text,             -- تعريش / خياط / قصاص
  phone         text,
  hired_on      date,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_employees_updated before update on public.employees
  for each row execute function public.fn_set_updated_at();
create trigger trg_audit_employees after insert or update or delete on public.employees
  for each row execute function public.fn_audit_row();

-- Per-worker pay terms: what a piece is worth in each stage.
create table public.employee_pay_terms (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  stage_key   text,                        -- null = default for any stage
  piece_rate  public.money_amt not null default 0,
  monthly_salary public.money_amt not null default 0,
  effective_from date not null default public.fn_today(),
  created_at  timestamptz not null default now(),
  unique (employee_id, stage_key, effective_from)
);

-- ---------------------------------------------------------------- items & warehouses
create table public.items (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  category    text not null check (category in
    ('fabric','thread','button','zipper','lining','packaging','spare_part','other')),
  base_unit   text not null default 'قطعة',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.warehouses (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  -- Which side owns what sits here; enforced on every movement.
  kind        text not null check (kind in
    ('customer_fabric','factory_consumables','customer_supplies','finished_goods','returns')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.inventory_transactions (
  id              uuid primary key default gen_random_uuid(),
  seq             bigserial,
  item_id         uuid not null references public.items(id),
  warehouse_id    uuid not null references public.warehouses(id),
  quantity        numeric(14,3) not null,          -- signed: + in, - out
  -- Customer-owned stock is never costed to the factory.
  ownership       text not null default 'factory' check (ownership in ('factory','customer')),
  customer_id     uuid references public.customers(id),
  production_order_id uuid,
  movement        text not null check (movement in
    ('purchase','customer_receipt','issue','transfer_in','transfer_out','adjustment','return')),
  unit_cost       public.money_amt default 0,
  txn_date        date not null default public.fn_today(),
  notes           text,
  idempotency_key text unique,
  reverses_id     uuid references public.inventory_transactions(id),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  constraint inv_ownership_customer check (
    (ownership = 'customer') = (customer_id is not null))
);
create index on public.inventory_transactions (item_id, warehouse_id);
create index on public.inventory_transactions (production_order_id);

-- ---------------------------------------------------------------- customer fabric
-- Fabric arrives per customer *and per colour*, measured in metres. Cutting draws it
-- down. This is deliberately separate from `inventory_transactions`: a customer's
-- fabric is never valued as factory stock, and every report in the app groups by colour.
create table public.customer_fabric_movements (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  colour      text not null,
  quantity    numeric(14,3) not null,              -- signed: + receipt, - consumption
  movement    text not null check (movement in ('receive','cut','return')),
  production_order_id uuid,
  txn_date    date not null default public.fn_today(),
  notes       text,
  idempotency_key text unique,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index on public.customer_fabric_movements (customer_id, colour);
create index on public.customer_fabric_movements (production_order_id);

create view public.v_customer_fabric_balances as
  select m.customer_id, c.name as customer_name, m.colour,
         sum(m.quantity) as balance
    from public.customer_fabric_movements m
    join public.customers c on c.id = m.customer_id
   group by m.customer_id, c.name, m.colour;

-- ---------------------------------------------------------------- cash accounts
create table public.financial_accounts (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  kind          text not null default 'cash' check (kind in ('cash','bank')),
  opening_balance public.money_amt not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.financial_transactions (
  id            uuid primary key default gen_random_uuid(),
  seq           bigserial,
  account_id    uuid not null references public.financial_accounts(id),
  amount        numeric(14,2) not null,            -- signed: + in, - out
  category      text not null check (category in
    ('customer_payment','worker_payment','expense','supply_purchase','capital','transfer','other')),
  description   text not null,
  txn_date      date not null default public.fn_today(),
  customer_id   uuid references public.customers(id),
  employee_id   uuid references public.employees(id),
  production_order_id uuid,
  idempotency_key text unique,
  reverses_id   uuid references public.financial_transactions(id),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index on public.financial_transactions (account_id, txn_date);

create view public.v_account_balances as
  select a.id, a.code, a.name, a.kind, a.is_active,
         a.opening_balance + coalesce(sum(t.amount), 0) as balance
    from public.financial_accounts a
    left join public.financial_transactions t on t.account_id = a.id
   group by a.id;

-- ---------------------------------------------------------------- machines
create table public.machines (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  name         text not null,
  model        text,
  purchased_on date,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.machine_maintenance (
  id          uuid primary key default gen_random_uuid(),
  machine_id  uuid not null references public.machines(id) on delete cascade,
  done_on     date not null default public.fn_today(),
  cost        public.money_amt not null default 0,
  description text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- expenses
create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.financial_accounts(id),
  category      text not null,                     -- إيجار / كهرباء / بوفيه …
  description   text not null,
  amount        public.money_amt not null check (amount >= 0),
  expense_date  date not null default public.fn_today(),
  -- When set the expense is charged to that order; otherwise it is overhead and
  -- gets allocated across finished pieces.
  production_order_id uuid,
  idempotency_key text unique,
  reverses_id   uuid,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index on public.expenses (expense_date);
