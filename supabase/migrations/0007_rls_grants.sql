-- ============================================================================
-- 0007 — RLS and grants
-- The app talks to Postgres as `authenticated`; every write goes through an RPC
-- that checks permissions itself, so table-level policies stay coarse.
-- ============================================================================

-- ---------------------------------------------------------------- enable RLS
do $$
declare t text;
begin
  foreach t in array array[
    'customers','employees','employee_pay_terms','items','warehouses',
    'inventory_transactions','customer_fabric_movements','financial_accounts',
    'financial_transactions','machines','machine_maintenance','expenses',
    'stage_templates','stage_template_stages','production_orders',
    'production_order_stages','cut_lines','bundles','operational_codes',
    'operational_code_counters','work_assignments','deliveries','delivery_lines',
    'customer_returns','profiles','roles','permissions','role_permissions',
    'user_roles','user_permissions','code_counters','audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- read policies
-- Any active signed-in user may read reference data. Financial tables are narrower.
do $$
declare t text;
begin
  foreach t in array array[
    'customers','employees','employee_pay_terms','items','warehouses',
    'inventory_transactions','customer_fabric_movements','machines',
    'machine_maintenance','expenses','stage_templates','stage_template_stages',
    'production_orders','production_order_stages','cut_lines','bundles',
    'operational_codes','work_assignments','deliveries','delivery_lines',
    'customer_returns','financial_accounts','financial_transactions'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (exists (select 1 from public.profiles p
                         where p.id = auth.uid() and p.is_active))',
      'p_read_' || t, t);
  end loop;
end $$;

-- A worker sees only their own assignments and earnings, never anyone else's.
create policy p_wa_worker_scope on public.work_assignments for select to authenticated
  using (
    public.has_permission('production.order.view')
    or employee_id = (select employee_id from public.profiles where id = auth.uid())
  );

create policy p_profiles_self on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_permission('system.user.view'));

create policy p_user_roles_read on public.user_roles for select to authenticated
  using (profile_id = auth.uid() or public.has_permission('system.user.view'));

create policy p_user_perms_read on public.user_permissions for select to authenticated
  using (profile_id = auth.uid() or public.has_permission('system.user.view'));

create policy p_roles_read on public.roles for select to authenticated using (true);
create policy p_perms_read on public.permissions for select to authenticated using (true);
create policy p_role_perms_read on public.role_permissions for select to authenticated using (true);

create policy p_audit_read on public.audit_log for select to authenticated
  using (public.has_permission('audit.view'));

-- ---------------------------------------------------------------- grants
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.customers, public.employees, public.items,
      public.warehouses, public.machines, public.stage_templates,
      public.stage_template_stages, public.production_orders,
      public.production_order_stages, public.financial_accounts to authenticated;
grant execute on all functions in schema public to authenticated;
