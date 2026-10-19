-- 20261019000006_rls_and_grants.sql
-- RLS: SELECT only, gated by permissions. No INSERT/UPDATE/DELETE policies => direct writes are denied;
-- all writes go through SECURITY DEFINER RPCs (owner bypasses RLS).
-- STATUS: NOT EXECUTED (no database available when authored).

create policy profiles_select on public.profiles for select to authenticated
  using (public.fn_is_active_user() and (id = auth.uid() or (select public.has_permission('system.user.view'))));

create policy employees_select on public.employees for select to authenticated
  using ((select public.has_permission('employee.view'))
         or id = (select employee_id from public.profiles where id = auth.uid()));

create policy pay_terms_select on public.employee_pay_terms for select to authenticated
  using ((select public.has_permission('worker.payroll.view')));

create policy roles_select on public.roles for select to authenticated using (public.fn_is_active_user());
create policy permissions_select on public.permissions for select to authenticated using (public.fn_is_active_user());
create policy role_permissions_select on public.role_permissions for select to authenticated using (public.fn_is_active_user());

create policy user_roles_select on public.user_roles for select to authenticated
  using (public.fn_is_active_user() and (profile_id = auth.uid() or (select public.has_permission('system.user.view'))));
create policy user_permissions_select on public.user_permissions for select to authenticated
  using (public.fn_is_active_user() and (profile_id = auth.uid() or (select public.has_permission('system.user.view'))));

create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.has_permission('audit.view')));

create policy customers_select on public.customers for select to authenticated
  using ((select public.has_permission('customer.view')));

create policy accounts_select on public.financial_accounts for select to authenticated
  using ((select public.has_permission('account.view')));
create policy fin_tx_select on public.financial_transactions for select to authenticated
  using ((select public.has_permission('account.view')));

create policy items_select on public.items for select to authenticated
  using ((select public.has_permission('inventory.view')));
create policy item_cost_select on public.item_cost_history for select to authenticated
  using ((select public.has_permission('inventory.view')));
create policy warehouses_select on public.warehouses for select to authenticated
  using ((select public.has_permission('inventory.view')));
create policy inv_tx_select on public.inventory_transactions for select to authenticated
  using ((select public.has_permission('inventory.view')));

create policy prod_tx_select on public.production_transactions for select to authenticated
  using ((select public.has_permission('production.order.view')));
create policy op_codes_select on public.operational_codes for select to authenticated
  using ((select public.has_permission('production.order.view')));
-- operational_code_counters: RLS on, no policy, no grant => internal only.

-- Re-runnable: EVERY future migration must end with `select public.fn_apply_grants();`
-- (enables RLS on any new table, strips anon/authenticated privileges, re-grants SELECT to authenticated,
--  and only exposes rpc_* functions + has_permission/fn_is_active_user to authenticated).
create or replace function public.fn_apply_grants() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' loop
    execute format('alter table public.%I enable row level security', r.relname);
    execute format('revoke all on table public.%I from anon, authenticated', r.relname);
    if r.relname <> 'operational_code_counters' then
      execute format('grant select on table public.%I to authenticated', r.relname);
    end if;
  end loop;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'v' loop
    execute format('revoke all on table public.%I from anon, authenticated', r.relname);
    execute format('grant select on table public.%I to authenticated', r.relname);
  end loop;
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname like 'rpc\_%' or r.proname in ('has_permission', 'fn_is_active_user') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;

select public.fn_apply_grants();
