-- ============================================================================
-- 0004 — production: stage templates, orders, cutting, bundles, operations
-- ============================================================================

-- ---------------------------------------------------------------- stage templates
-- A template belongs to a model ("قميص", "جاكت"). Stages carry a dependency list,
-- which is what makes the foreman flow non-linear: several stages can start as soon
-- as the pieces are cut, others must wait for named predecessors.
create table public.stage_templates (
  id          uuid primary key default gen_random_uuid(),
  name_ar     text not null unique,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.stage_template_stages (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references public.stage_templates(id) on delete cascade,
  seq           int not null,
  name_ar       text not null,
  code          text not null,                 -- English slug: collar, chest, back …
  piece_price   public.money_amt not null default 0,   -- what the factory charges per piece
  -- Empty array = may start right after cutting. Otherwise every listed stage code
  -- must be complete for the same bundle first.
  depends_on    text[] not null default '{}',
  is_operations boolean not null default false,        -- salaried, not piece work
  is_final      boolean not null default false,        -- passing this makes goods "ready"
  unique (template_id, code),
  unique (template_id, seq)
);

-- ---------------------------------------------------------------- production orders
create table public.production_orders (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  customer_id   uuid not null references public.customers(id),
  model_name    text not null,
  quantity      numeric(14,0) not null check (quantity > 0),
  -- What the factory charges the customer per piece.
  piece_price   public.money_amt not null check (piece_price >= 0),
  order_date    date not null default public.fn_today(),
  due_date      date,
  notes         text,
  status        text not null default 'open' check (status in ('open','completed','cancelled')),
  closed_at     timestamptz,
  cancel_reason text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.production_orders (status, order_date desc);
create trigger trg_orders_updated before update on public.production_orders
  for each row execute function public.fn_set_updated_at();
create trigger trg_audit_orders after insert or update or delete on public.production_orders
  for each row execute function public.fn_audit_row();

-- The order's own copy of the stages. Copied at creation so template edits never
-- rewrite history; per-order prices and due dates live here.
create table public.production_order_stages (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.production_orders(id) on delete cascade,
  seq                int not null,
  name_ar            text not null,
  code               text not null,
  piece_price        public.money_amt not null default 0,
  depends_on         text[] not null default '{}',
  is_operations      boolean not null default false,
  is_final           boolean not null default false,
  due_date           date,
  unique (order_id, code),
  unique (order_id, seq)
);

-- ---------------------------------------------------------------- cutting
-- A cut line is one (colour, size) group. Cutting draws fabric of that colour from
-- the customer's balance and creates bundles.
create table public.cut_lines (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.production_orders(id) on delete cascade,
  colour        text not null,
  size          text not null,
  quantity      numeric(14,0) not null check (quantity > 0),
  fabric_metres numeric(14,3) not null default 0,
  cut_date      date not null default public.fn_today(),
  idempotency_key text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index on public.cut_lines (order_id);

create table public.bundles (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,          -- BND0124
  barcode       text not null unique,          -- scannable, prefixed
  order_id      uuid not null references public.production_orders(id) on delete cascade,
  cut_line_id   uuid references public.cut_lines(id) on delete set null,
  size          text not null,
  colour        text not null,
  quantity      numeric(14,0) not null check (quantity > 0),
  -- Set when the bundle mixes colours, e.g. "ألوان مختلطة إسود 20، كحلي 20".
  colour_label  text,
  status        text not null default 'open'
                check (status in ('open','in_progress','finished','delivered','cancelled')),
  cut_date      date not null default public.fn_today(),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.bundles (order_id, status);
create trigger trg_bundles_updated before update on public.bundles
  for each row execute function public.fn_set_updated_at();

-- ---------------------------------------------------------------- operational codes
-- One code per piece: <customer operating letter><size><serial>, e.g. MM0001.
create table public.operational_codes (
  code        text primary key,
  customer_id uuid not null references public.customers(id),
  bundle_id   uuid not null references public.bundles(id) on delete cascade,
  size        text not null,
  letter      text not null,
  serial      int not null,
  created_at  timestamptz not null default now()
);
create index on public.operational_codes (bundle_id);
-- Serial restarts per (customer letter, size) pair, matching MM0001 / ML0001.
create unique index on public.operational_codes (letter, size, serial);

create table public.operational_code_counters (
  letter text not null,
  size   text not null,
  last_value int not null default 0,
  primary key (letter, size)
);

create or replace function public.fn_next_operational_code(p_customer uuid, p_size text)
returns text language plpgsql security definer set search_path = public as $$
declare v_letter text; v_next int;
begin
  select operating_letter into v_letter from public.customers where id = p_customer;
  if v_letter is null then perform public.fn_raise('E_CUSTOMER_NOT_FOUND'); end if;

  insert into public.operational_code_counters (letter, size, last_value)
  values (v_letter, p_size, 1)
  on conflict (letter, size) do update
    set last_value = public.operational_code_counters.last_value + 1
  returning last_value into v_next;

  return v_letter || p_size || lpad(v_next::text, 4, '0');
end $$;

-- Serial for the counter row; kept separate so callers never re-parse the code string.
create or replace function public.fn_operational_serial(p_code text, p_prefix text)
returns int language sql immutable as $$
  select nullif(regexp_replace(p_code, '^' || p_prefix, ''), '')::int
$$;

-- ---------------------------------------------------------------- work movement
-- Every hand-off of a bundle to a worker, and every receipt back, is one row here.
-- This single table drives wages, stage progress, defects and the timeline.
create table public.work_assignments (
  id            uuid primary key default gen_random_uuid(),
  bundle_id     uuid not null references public.bundles(id) on delete cascade,
  order_id      uuid not null references public.production_orders(id) on delete cascade,
  stage_code    text not null,
  employee_id   uuid not null references public.employees(id),
  quantity      numeric(14,0) not null check (quantity > 0),
  assigned_at   timestamptz not null default now(),
  assigned_by   uuid default auth.uid(),
  -- Receipt side; null while the bundle is still out with the worker.
  received_at   timestamptz,
  received_by   uuid,
  accepted_qty  numeric(14,0),
  rejected_qty  numeric(14,0),
  rework_qty    numeric(14,0),
  reject_reason text,
  piece_rate    public.money_amt not null default 0,
  -- Wages are earned on accepted pieces only.
  wage_amount   public.money_amt not null default 0,
  idempotency_key text unique,
  created_at    timestamptz not null default now(),
  constraint wa_receipt_complete check (
    received_at is null
    or (accepted_qty is not null and rejected_qty is not null and rework_qty is not null
        and accepted_qty + rejected_qty + rework_qty = quantity)),
  constraint wa_reject_reason check (
    rejected_qty is null or rejected_qty = 0 or reject_reason is not null)
);
create index on public.work_assignments (employee_id, assigned_at desc);
create index on public.work_assignments (order_id);
create index on public.work_assignments (bundle_id, stage_code);
-- A bundle cannot be handed to two workers for the same stage at once.
create unique index uq_wa_open on public.work_assignments (bundle_id, stage_code)
  where received_at is null;

-- ---------------------------------------------------------------- deliveries & returns
create table public.deliveries (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  order_id    uuid not null references public.production_orders(id),
  delivered_on date not null default public.fn_today(),
  notes       text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create table public.delivery_lines (
  id          uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  colour      text not null,
  size        text not null,
  quantity    numeric(14,0) not null check (quantity > 0)
);

create table public.customer_returns (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  order_id    uuid not null references public.production_orders(id),
  colour      text not null,
  size        text not null,
  quantity    numeric(14,0) not null check (quantity > 0),
  reason      text,
  -- A returned piece either goes back into production or into the returns warehouse.
  disposition text not null default 'rework' check (disposition in ('rework','warehouse')),
  returned_on date not null default public.fn_today(),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
