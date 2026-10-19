-- 20261019000003_master_data.sql
-- Customers, financial accounts, item master, warehouses, operational-code registry.
-- STATUS: NOT EXECUTED (no database available when authored).

create table public.customers (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique default public.fn_next_code('CUS'),
  name       text not null check (length(btrim(name)) > 0),
  -- Latin letter used as the first character of operational codes.
  -- OPEN BUSINESS DECISION: rule for choosing it (prototype: next free letter, excluding I, L, O).
  op_letter  text not null unique check (op_letter ~ '^[A-Z]$' and op_letter not in ('I','L','O')),
  phone      text check (phone is null or phone ~ '^\+?[0-9]{8,15}$'),
  address    text,
  notes      text,
  is_active  boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.customers
  for each row execute function public.trg_set_updated_at();

create or replace function public.fn_next_op_letter() returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text;
begin
  perform pg_advisory_xact_lock(hashtextextended('customers.op_letter', 0));
  select c into v
    from unnest(string_to_array('A,B,C,D,E,F,G,H,J,K,M,N,P,Q,R,S,T,U,V,W,X,Y,Z', ',')) as c
   where not exists (select 1 from public.customers x where x.op_letter = c)
   order by c limit 1;
  if v is null then raise exception 'no free operational letters left' using errcode = 'F0008'; end if;
  return v;
end $$;

create table public.financial_accounts (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique default public.fn_next_code('ACC'),
  name            text not null check (length(btrim(name)) > 0),
  account_type    text not null check (account_type in ('cash','bank','other')),
  opening_balance numeric(14,2) not null default 0,
  allow_negative  boolean not null default false,
  is_active       boolean not null default true,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger set_updated_at before update on public.financial_accounts
  for each row execute function public.trg_set_updated_at();

create table public.warehouses (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique default public.fn_next_code('WH'),
  name       text not null check (length(btrim(name)) > 0),
  kind       text not null check (kind in ('customer_fabric','factory_consumables','order_materials','finished_goods','returns','other')),
  is_active  boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.warehouses
  for each row execute function public.trg_set_updated_at();

create table public.items (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique default public.fn_next_code('ITM'),
  name         text not null check (length(btrim(name)) > 0),
  category     text not null check (category in ('fabric','thread','button','zipper','lining','packaging','spare_part','other')),
  base_unit    text not null check (length(btrim(base_unit)) > 0),   -- OPEN: unit master / conversions
  default_cost numeric(14,4) check (default_cost is null or default_cost >= 0),
  is_active    boolean not null default true,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger set_updated_at before update on public.items
  for each row execute function public.trg_set_updated_at();

-- Cost history is append-only (valuation method is an OPEN BUSINESS DECISION).
create table public.item_cost_history (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.items(id),
  unit_cost      numeric(14,4) not null check (unit_cost >= 0),
  effective_date date not null,
  source_type    text,
  source_id      uuid,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index on public.item_cost_history (item_id, effective_date desc);
create trigger item_cost_history_immutable before update or delete on public.item_cost_history
  for each row execute function public.trg_forbid_mutation();

-- ------------------------------------------------------- operational codes
-- Code = customer letter + size + serial (NL0001). Never reused; voiding keeps the code reserved.
-- Operational Code, Bundle ID (BND0001) and Barcode are three different things.
create table public.operational_code_counters (
  customer_id uuid not null references public.customers(id),
  size        text not null,
  last_serial integer not null default 0,
  primary key (customer_id, size)
);

create table public.operational_codes (
  code        text primary key,
  customer_id uuid not null references public.customers(id),
  letter      text not null,
  size        text not null check (size ~ '^[A-Z0-9]{1,5}$'),
  serial      integer not null check (serial > 0),
  status      text not null default 'active' check (status in ('active','void')),
  bundle_id   uuid,                              -- FK added by the Bundles module
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (customer_id, size, serial),
  check (code ~ '^[A-Z][A-Z0-9]{1,5}[0-9]{4,}$'),
  check (code = letter || size || lpad(serial::text, 4, '0'))
);

create or replace function public.fn_generate_operational_code(p_customer uuid, p_size text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_size text := upper(btrim(p_size)); v_letter text; v_serial integer; v_code text;
begin
  if v_size is null or v_size !~ '^[A-Z0-9]{1,5}$' then
    raise exception 'invalid size "%" (1-5 letters/digits, no spaces)', p_size using errcode = '22023';
  end if;
  select op_letter into v_letter from public.customers where id = p_customer;
  if v_letter is null then raise exception 'customer not found' using errcode = 'P0002'; end if;
  insert into public.operational_code_counters (customer_id, size, last_serial) values (p_customer, v_size, 1)
  on conflict (customer_id, size) do update set last_serial = public.operational_code_counters.last_serial + 1
  returning last_serial into v_serial;
  v_code := v_letter || v_size || lpad(v_serial::text, 4, '0');
  insert into public.operational_codes (code, customer_id, letter, size, serial, created_by)
  values (v_code, p_customer, v_letter, v_size, v_serial, auth.uid());
  return v_code;
end $$;

select public.fn_attach_audit('public.customers');
select public.fn_attach_audit('public.financial_accounts');
select public.fn_attach_audit('public.warehouses');
select public.fn_attach_audit('public.items');
