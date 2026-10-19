-- 20261019000001_core.sql
-- Sequences, code generator, generic trigger helpers, audit log.
-- STATUS: written but NOT EXECUTED against Postgres/Supabase (no database was available when authored).

create sequence if not exists public.seq_customer;
create sequence if not exists public.seq_employee;
create sequence if not exists public.seq_production_order;
create sequence if not exists public.seq_machine;
create sequence if not exists public.seq_item;
create sequence if not exists public.seq_warehouse;
create sequence if not exists public.seq_account;
create sequence if not exists public.seq_bundle;

-- Business date in Egypt (fixes the prototype's UTC date bug).
create or replace function public.fn_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Cairo')::date $$;

-- CUS0001 / EMP0001 / PO0001 / MCH0001 / ITM0001 / WH0001 / ACC0001 / BND0001
create or replace function public.fn_next_code(p_prefix text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v bigint;
begin
  v := case p_prefix
    when 'CUS' then nextval('public.seq_customer')
    when 'EMP' then nextval('public.seq_employee')
    when 'PO'  then nextval('public.seq_production_order')
    when 'MCH' then nextval('public.seq_machine')
    when 'ITM' then nextval('public.seq_item')
    when 'WH'  then nextval('public.seq_warehouse')
    when 'ACC' then nextval('public.seq_account')
    when 'BND' then nextval('public.seq_bundle')
    else null end;
  if v is null then
    raise exception 'unknown code prefix %', p_prefix using errcode = '22023';
  end if;
  return p_prefix || lpad(v::text, 4, '0');
end $$;

create or replace function public.trg_set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Append-only guard (financial / inventory / production / audit tables).
create or replace function public.trg_forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only: % is not allowed (use a reversal / corrective transaction)', tg_table_name, tg_op
    using errcode = 'F0006';
end $$;

-- Reason for the current operation, read by the audit trigger.
create or replace function public.fn_set_reason(p_reason text, p_required boolean default true) returns void
language plpgsql as $$
begin
  if p_required and (p_reason is null or length(btrim(p_reason)) < 3) then
    raise exception 'a reason (min 3 chars) is required' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', coalesce(btrim(p_reason), ''), true);
end $$;

-- ---------------------------------------------------------------- audit log
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  user_id     uuid,
  employee_id uuid,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  old_values  jsonb,
  new_values  jsonb,
  reason      text,
  metadata    jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index if not exists audit_log_time_idx   on public.audit_log (occurred_at desc);
create index if not exists audit_log_user_idx   on public.audit_log (user_id);

create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function public.trg_forbid_mutation();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.trg_forbid_mutation();

create or replace function public.fn_audit_write(
  p_action text, p_entity_type text, p_entity_id text, p_old jsonb, p_new jsonb,
  p_reason text default null, p_metadata jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  insert into public.audit_log (user_id, employee_id, action, entity_type, entity_id, old_values, new_values, reason, metadata)
  values (auth.uid(),
          (select employee_id from public.profiles where id = auth.uid()),
          p_action, p_entity_type, p_entity_id, p_old, p_new,
          coalesce(p_reason, nullif(current_setting('app.audit_reason', true), '')),
          coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

-- Generic row trigger. Trigger args = primary-key column names (default: id).
create or replace function public.trg_audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old jsonb; v_new jsonb; v_row jsonb; v_id text;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new); v_row := v_new;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old); v_new := to_jsonb(new); v_row := v_new;
    if v_old = v_new then return new; end if;
  else
    v_old := to_jsonb(old); v_row := v_old;
  end if;
  select string_agg(v_row ->> c, ':') into v_id
    from unnest(case when tg_nargs = 0 then array['id'] else tg_argv end) as c;
  perform public.fn_audit_write(lower(tg_op), tg_table_name, v_id, v_old, v_new);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.fn_attach_audit(p_table regclass, p_pk text[] default array['id'],
  p_events text default 'insert or update or delete') returns void
language plpgsql as $$
begin
  execute format('drop trigger if exists audit_row on %s', p_table);
  execute format('create trigger audit_row after %s on %s for each row execute function public.trg_audit_row(%s)',
    p_events, p_table, (select string_agg(quote_literal(x), ',') from unnest(p_pk) x));
end $$;
