-- ============================================================================
-- 0001 — core: extensions, utilities, audit, error codes
-- ============================================================================
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- utilities
create or replace function public.fn_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Cairo')::date $$;

create or replace function public.fn_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Raises a stable, greppable error code that the UI translates to Arabic.
create or replace function public.fn_raise(code text, detail text default null)
returns void language plpgsql as $$
begin
  raise exception using
    errcode = 'P0001',
    message = code || case when detail is null then '' else ' — ' || detail end;
end $$;

-- ---------------------------------------------------------------- audit log
create table public.audit_log (
  id          bigserial primary key,
  actor_id    uuid,
  table_name  text not null,
  row_pk      text,
  action      text not null check (action in ('insert','update','delete')),
  diff        jsonb,
  created_at  timestamptz not null default now()
);
create index on public.audit_log (table_name, created_at desc);

create or replace function public.fn_audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pk text;
begin
  v_pk := coalesce((case when tg_op = 'DELETE' then old.id else new.id end)::text, '?');
  insert into public.audit_log (actor_id, table_name, row_pk, action, diff)
  values (
    auth.uid(), tg_table_name, v_pk, lower(tg_op),
    case tg_op
      when 'INSERT' then jsonb_build_object('new', to_jsonb(new))
      when 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
      else jsonb_build_object('old', to_jsonb(old))
    end);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.fn_attach_audit(tbl regclass) returns void
language plpgsql as $$
begin
  execute format(
    'create trigger trg_audit_%s after insert or update or delete on %s
       for each row execute function public.fn_audit_row()',
    replace(tbl::text, '.', '_'), tbl);
end $$;

-- ---------------------------------------------------------------- money + qty
-- Money is numeric(14,2); quantities are numeric(14,3) so metres can be fractional.
create domain public.money_amt as numeric(14,2) not null default 0;
create domain public.qty_amt   as numeric(14,3) not null default 0;

create or replace function public.fn_money_nonneg(v numeric) returns numeric
language sql immutable as $$ select case when v is null then 0 else v end $$;
