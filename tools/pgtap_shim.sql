-- Minimal pgTAP-compatible shim (dev only) so supabase/tests/*.sql can run on a plain Postgres
-- without the pgtap extension. Implements only the assertions this repo uses:
-- plan/no_plan/ok/is/isnt/matches/throws_ok/cmp_ok/finish.
-- Not a product artifact. Results are collected in pg_temp and printed by finish().

create schema if not exists extensions;

create schema if not exists tap;
create table if not exists tap.results (
  n serial primary key, ok boolean not null, label text, detail text);
truncate tap.results restart identity;

create or replace function public.no_plan() returns text language plpgsql as $$ begin truncate tap.results restart identity; return '1..'; end $$;
create or replace function public.plan(p int) returns text language plpgsql as $$ begin truncate tap.results restart identity; return '1..' || p; end $$;

create or replace function public.ok(p_ok boolean, p_label text default null) returns text
language plpgsql as $$
begin
  insert into tap.results (ok, label, detail) values (coalesce(p_ok, false), p_label, null);
  return case when p_ok then 'ok' else 'not ok' end;
end $$;

create or replace function public.is(p_have anycompatible, p_want anycompatible, p_label text default null)
returns text language plpgsql as $$
declare v_ok boolean := (p_have::text is not distinct from p_want::text);
begin
  insert into tap.results (ok, label, detail)
  values (v_ok, p_label, case when v_ok then null else 'have=' || coalesce(p_have::text,'<null>') || ' want=' || coalesce(p_want::text,'<null>') end);
  return case when v_ok then 'ok' else 'not ok' end;
end $$;

create or replace function public.isnt(p_have anycompatible, p_want anycompatible, p_label text default null)
returns text language plpgsql as $$
declare v_ok boolean := (p_have::text is distinct from p_want::text);
begin
  insert into tap.results (ok, label, detail)
  values (v_ok, p_label, case when v_ok then null else 'both=' || coalesce(p_have::text,'<null>') end);
  return case when v_ok then 'ok' else 'not ok' end;
end $$;

create or replace function public.matches(p_have text, p_re text, p_label text default null)
returns text language plpgsql as $$
declare v_ok boolean := (p_have ~ p_re);
begin
  insert into tap.results (ok, label, detail)
  values (v_ok, p_label, case when v_ok then null else 'have=' || coalesce(p_have,'<null>') || ' re=' || p_re end);
  return case when v_ok then 'ok' else 'not ok' end;
end $$;

create or replace function public.cmp_ok(p_have anycompatible, p_op text, p_want anycompatible, p_label text default null)
returns text language plpgsql as $$
declare v_ok boolean;
begin
  execute format('select $1 %s $2', p_op) into v_ok using p_have::numeric, p_want::numeric;
  insert into tap.results (ok, label, detail)
  values (v_ok, p_label, case when v_ok then null else 'have=' || p_have::text || ' want ' || p_op || ' ' || p_want::text end);
  return case when v_ok then 'ok' else 'not ok' end;
end $$;

create or replace function public.throws_ok(p_sql text, p_sqlstate text, p_message text default null, p_label text default null)
returns text language plpgsql as $$
declare v_state text; v_msg text; v_ok boolean;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  v_ok := (v_state is not null and (p_sqlstate is null or v_state = p_sqlstate)
           and (p_message is null or v_msg like p_message));
  insert into tap.results (ok, label, detail)
  values (v_ok, p_label, case when v_ok then null
          else 'expected ' || coalesce(p_sqlstate,'any') || ', got ' || coalesce(v_state || ' (' || v_msg || ')','no error') end);
  return case when v_ok then 'ok' else 'not ok' end;
end $$;

create or replace function public.finish() returns setof text language plpgsql as $$
declare r record; v_total int; v_failed int := 0;
begin
  select count(*) into v_total from tap.results;
  return next '1..' || v_total;
  for r in select * from tap.results order by n loop
    if r.ok then
      return next format('ok %s - %s', r.n, coalesce(r.label, ''));
    else
      v_failed := v_failed + 1;
      return next format('not ok %s - %s%s', r.n, coalesce(r.label, ''),
                         case when r.detail is null then '' else ' # ' || r.detail end);
    end if;
  end loop;
  return next format('# %s of %s assertions failed', v_failed, v_total);
  if v_failed > 0 then
    raise exception '% of %s assertions FAILED', v_failed, v_total using errcode = 'P0001';
  end if;
end $$;

-- Only the TAP helpers, never blanket-grant (that would hand anon execute on rpc_* functions).
grant execute on function public.no_plan(), public.plan(int), public.ok(boolean,text),
  public.is(anycompatible,anycompatible,text), public.isnt(anycompatible,anycompatible,text),
  public.matches(text,text,text), public.cmp_ok(anycompatible,text,anycompatible,text),
  public.throws_ok(text,text,text,text), public.finish()
  to anon, authenticated, service_role;

-- The helpers are not security definer, so a suite that switches identity with
-- `set local role authenticated` still inserts into tap.results as that role.
grant usage on schema tap to anon, authenticated, service_role;
grant select, insert, delete on tap.results to anon, authenticated, service_role;
grant usage on sequence tap.results_n_seq to anon, authenticated, service_role;
