-- ============================================================================
-- 0006 — read models. The UI reads views, never joins tables itself.
-- ============================================================================

-- ---------------------------------------------------------------- order list
create view public.v_production_orders as
  select o.id, o.code, o.customer_id, c.name as customer_name, c.operating_letter,
         o.model_name, o.quantity, o.piece_price, o.order_date, o.due_date, o.notes,
         o.status, o.cancel_reason,
         coalesce(cl.cut_qty, 0) as cut_quantity,
         coalesce(cl.bundle_count, 0) as bundle_count,
         case when o.quantity > 0
              then round(coalesce(cl.cut_qty, 0) / o.quantity * 100) else 0 end as cut_percent,
         coalesce(dl.ready_qty, 0) as ready_quantity,
         coalesce(dv.delivered_qty, 0) as delivered_quantity
    from public.production_orders o
    join public.customers c on c.id = o.customer_id
    left join lateral (
      select sum(l.quantity) as cut_qty,
             (select count(*) from public.bundles b
               where b.order_id = o.id and b.status <> 'cancelled') as bundle_count
        from public.cut_lines l where l.order_id = o.id) cl on true
    left join lateral (
      select sum(b.quantity) as ready_qty from public.bundles b
       where b.order_id = o.id and b.status in ('finished','delivered')) dl on true
    left join lateral (
      select sum(l.quantity) as delivered_qty from public.delivery_lines l
        join public.deliveries d on d.id = l.delivery_id where d.order_id = o.id) dv on true;

-- ---------------------------------------------------------------- one order's stages
create view public.v_order_stages as
  select s.order_id, s.code, s.name_ar, s.seq, s.piece_price, s.depends_on,
         s.is_operations, s.is_final, s.due_date,
         coalesce(w.accepted, 0) as accepted_qty,
         coalesce(w.rejected, 0) as rejected_qty,
         coalesce(w.in_flight, 0) as in_flight_qty,
         (select sum(l.quantity) from public.cut_lines l where l.order_id = s.order_id)
           as cut_quantity,
         case
           when coalesce(w.accepted,0) = 0 and coalesce(w.in_flight,0) = 0 then 'pending'
           when coalesce(w.in_flight,0) > 0 then 'in_progress'
           else 'done'
         end as status
    from public.production_order_stages s
    left join lateral (
      select sum(wa.accepted_qty) as accepted, sum(wa.rejected_qty) as rejected,
             sum(case when wa.received_at is null then wa.quantity else 0 end) as in_flight
        from public.work_assignments wa
       where wa.order_id = s.order_id and wa.stage_code = s.code) w on true;

-- ---------------------------------------------------------------- bundles
create view public.v_bundles as
  select b.id, b.code, b.barcode, b.order_id, o.code as order_code, o.model_name,
         c.name as customer_name, b.size, b.colour, coalesce(b.colour_label, b.colour) as colour_label,
         b.quantity, b.status, b.cut_date,
         (select count(*) from public.operational_codes oc where oc.bundle_id = b.id) as code_count,
         (select min(oc.code) from public.operational_codes oc where oc.bundle_id = b.id) as first_code,
         (select max(oc.code) from public.operational_codes oc where oc.bundle_id = b.id) as last_code,
         (select wa.stage_code from public.work_assignments wa
           where wa.bundle_id = b.id and wa.received_at is null limit 1) as current_stage,
         (select e.name from public.work_assignments wa
            join public.employees e on e.id = wa.employee_id
           where wa.bundle_id = b.id and wa.received_at is null limit 1) as current_holder
    from public.bundles b
    join public.production_orders o on o.id = b.order_id
    join public.customers c on c.id = o.customer_id;

-- ---------------------------------------------------------------- workers
create view public.v_workers as
  select e.id, e.code, e.name, e.kind, e.job_title, e.phone, e.is_active,
         coalesce(w.earned, 0) as earned_total,
         coalesce(p.paid, 0) as paid_total,
         coalesce(w.earned, 0) - coalesce(p.paid, 0) as remaining_due,
         coalesce(w.accepted, 0) as accepted_total,
         coalesce(w.rejected, 0) as rejected_total
    from public.employees e
    left join lateral (
      select sum(wa.wage_amount) as earned, sum(wa.accepted_qty) as accepted,
             sum(wa.rejected_qty) as rejected
        from public.work_assignments wa
       where wa.employee_id = e.id and wa.received_at is not null) w on true
    left join lateral (
      -- Payments leave the drawer, so they are stored negative; flip them back for
      -- the balance comparison. Reversals are excluded because the mirror row already
      -- cancels the original.
      select -sum(t.amount) as paid from public.financial_transactions t
       where t.employee_id = e.id and t.category = 'worker_payment'
         and t.reverses_id is null
         and not exists (select 1 from public.financial_transactions r where r.reverses_id = t.id)
    ) p on true;

-- ---------------------------------------------------------------- customers with balances
create view public.v_customers as
  select c.id, c.code, c.operating_letter, c.name, c.phone, c.notes, c.is_active,
         coalesce(o.order_count, 0) as order_count,
         coalesce(o.open_count, 0) as open_order_count
    from public.customers c
    left join lateral (
      select count(*) as order_count,
             count(*) filter (where status = 'open') as open_count
        from public.production_orders where customer_id = c.id) o on true;

-- ---------------------------------------------------------------- order costing
-- Expected revenue is the whole order; actual revenue counts delivered less returns.
create view public.v_order_costing as
  select o.id as order_id, o.code, o.quantity, o.piece_price,
         o.quantity * o.piece_price as expected_revenue,
         coalesce(dv.qty, 0) as delivered_qty,
         coalesce(rt.qty, 0) as returned_qty,
         (coalesce(dv.qty, 0) - coalesce(rt.qty, 0)) * o.piece_price as actual_revenue,
         coalesce(wg.amount, 0) as wages,
         coalesce(ex.amount, 0) as direct_expenses,
         coalesce(wg.amount, 0) + coalesce(ex.amount, 0) as total_cost
    from public.production_orders o
    left join lateral (
      select sum(l.quantity) as qty from public.delivery_lines l
        join public.deliveries d on d.id = l.delivery_id where d.order_id = o.id) dv on true
    left join lateral (
      select sum(r.quantity) as qty from public.customer_returns r where r.order_id = o.id) rt on true
    left join lateral (
      select sum(wa.wage_amount) as amount from public.work_assignments wa
       where wa.order_id = o.id and wa.received_at is not null) wg on true
    left join lateral (
      select sum(e.amount) as amount from public.expenses e
       where e.production_order_id = o.id and e.reverses_id is null) ex on true;

-- ---------------------------------------------------------------- timeline
create view public.v_order_timeline as
  select o.id as order_id, o.created_at as at, 'created' as kind,
         'اتعمل الأمر' as description, null::text as actor
    from public.production_orders o
  union all
  select cl.order_id, cl.created_at, 'cut',
         'اتقص ' || cl.quantity::text || ' قطعة ' || cl.colour || ' / ' || cl.size,
         null
    from public.cut_lines cl
  union all
  select wa.order_id, wa.received_at, 'stage',
         'مرحلة ' || coalesce(s.name_ar, wa.stage_code) || ': مقبول '
           || coalesce(wa.accepted_qty,0)::text
           || '، مرفوض ' || coalesce(wa.rejected_qty,0)::text,
         e.name
    from public.work_assignments wa
    join public.employees e on e.id = wa.employee_id
    left join public.production_order_stages s
      on s.order_id = wa.order_id and s.code = wa.stage_code
   where wa.received_at is not null;
