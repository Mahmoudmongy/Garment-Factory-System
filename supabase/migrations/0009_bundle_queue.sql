-- ============================================================================
-- 0009 — bundle queue, stage gating, self-claim, size-only cutting.
--
-- After cutting, every user must see the bundles in a predictable order: by size
-- when the order has no colours, and by colour then size when it does. A stage
-- only becomes visible once the stages it depends on are finished. Each visible
-- stage carries a receive action: a worker claims the work for themselves, or a
-- foreman hands it to a named worker.
-- ============================================================================

-- ---------------------------------------------------------------- size ordering
-- Sizes are free text (M, XL, 2XL, 38 …). This maps them to a sort key so the
-- queue reads XS → S → M → L → XL instead of alphabetically (L before M).
create or replace function public.fn_size_rank(p_size text)
returns int language sql immutable as $$
  select case upper(trim(coalesce(p_size, '')))
           when 'XXS' then 10  when 'XS' then 20   when 'S'  then 30
           when 'M'   then 40  when 'L'  then 50   when 'XL' then 60
           when 'XXL' then 70  when '2XL' then 70  when '3XL' then 80
           when '4XL' then 90  when '5XL' then 100 when '6XL' then 110
           when ''    then 999
           else case when trim(coalesce(p_size, '')) ~ '^[0-9]+$'
                     then 200 + least(trim(p_size)::int, 99) else 150 end
         end
$$;

-- ---------------------------------------------------------------- cutting modes
-- An order is cut either by size alone (colour is left empty) or by colour × size.
-- p_has_colour keeps the old behaviour as the default so existing callers are
-- unaffected.
-- An extra defaulted parameter makes a new overload, not a replacement.
drop function if exists public.rpc_execute_cutting(uuid, jsonb, numeric, date, text);

create or replace function public.rpc_execute_cutting(
  p_order uuid, p_lines jsonb, p_bundle_size numeric default 40,
  p_cut_date date default null, p_key text default null,
  p_has_colour boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_customer uuid; v_remaining numeric; v_total numeric := 0;
  v_line jsonb; v_qty numeric; v_colour text; v_size text;
  v_cut_line uuid; v_bundles int := 0; v_codes int := 0;
  v_batch numeric; v_made numeric; v_bundle uuid;
  v_code text; v_letter text; i int;
begin
  perform public.fn_require_permission('production.cutting.execute');

  select customer_id into v_customer from public.production_orders
   where id = p_order and status = 'open';
  if v_customer is null then perform public.fn_raise('E_ORDER_NOT_OPEN'); end if;

  select c.operating_letter into v_letter from public.customers c where c.id = v_customer;

  select p.quantity - coalesce((select sum(quantity) from public.cut_lines where order_id = p_order), 0)
    into v_remaining from public.production_orders p where p.id = p_order;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty    := coalesce((v_line->>'quantity')::numeric, 0);
    v_colour := coalesce(trim(v_line->>'colour'), '');
    v_size   := trim(v_line->>'size');
    if v_qty <= 0 then continue; end if;
    if p_has_colour and v_colour = '' then perform public.fn_raise('E_COLOUR_REQUIRED'); end if;
    -- A colour-only cut has no size dimension, and a size-only cut has no colour.
    if v_size = '' and v_colour = '' then perform public.fn_raise('E_COLOUR_SIZE_REQUIRED'); end if;
    if v_qty <> floor(v_qty) then perform public.fn_raise('E_WHOLE_PIECES'); end if;
    v_total := v_total + v_qty;
  end loop;

  if v_total = 0 then perform public.fn_raise('E_NOTHING_TO_CUT'); end if;
  if v_total > v_remaining then perform public.fn_raise('E_OVER_CUT', v_remaining::text); end if;

  if p_key is not null then
    select id into v_cut_line from public.cut_lines where idempotency_key = p_key limit 1;
    if v_cut_line is not null then return jsonb_build_object('replayed', true); end if;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty    := (v_line->>'quantity')::numeric;
    v_colour := coalesce(trim(v_line->>'colour'), '');
    v_size   := trim(v_line->>'size');
    if v_qty <= 0 then continue; end if;

    insert into public.cut_lines (order_id, colour, size, quantity, cut_date, idempotency_key)
    values (p_order, v_colour, v_size, v_qty, coalesce(p_cut_date, public.fn_today()), p_key)
    returning id into v_cut_line;

    -- Fabric is drawn per colour. A size-only cut has no colour to draw from, and
    -- a negative balance is allowed on purpose: the factory may cut before the
    -- customer's delivery is logged, and the warehouse screen shows the shortfall.
    if v_colour <> '' then
      insert into public.customer_fabric_movements
        (customer_id, colour, quantity, movement, production_order_id, txn_date, notes)
      values (v_customer, v_colour, -v_qty, 'cut', p_order,
              coalesce(p_cut_date, public.fn_today()),
              'قص ' || (select code from public.production_orders where id = p_order));
    end if;

    -- Split into bundles; the final bundle keeps the remainder.
    v_made := 0;
    while v_made < v_qty loop
      v_batch := least(p_bundle_size, v_qty - v_made);
      v_code  := public.fn_next_code('BND');
      insert into public.bundles (code, barcode, order_id, cut_line_id, size, colour, quantity,
                                  cut_date)
      values (v_code, 'GF' || v_code, p_order, v_cut_line, v_size, v_colour, v_batch,
              coalesce(p_cut_date, public.fn_today()))
      returning id into v_bundle;

      -- One operational code per piece in this bundle.
      for i in 1..v_batch::int loop
        v_code := public.fn_next_operational_code(v_customer, v_size);
        insert into public.operational_codes (code, customer_id, bundle_id, size, letter, serial)
        values (v_code, v_customer, v_bundle, v_size, v_letter,
                public.fn_operational_serial(v_code, v_letter || v_size));
        v_codes := v_codes + 1;
      end loop;

      v_bundles := v_bundles + 1;
      v_made := v_made + v_batch;
    end loop;
  end loop;

  return jsonb_build_object('bundles', v_bundles, 'operational_codes', v_codes,
                            'pieces', v_total, 'replayed', false);
end $$;

-- ---------------------------------------------------------------- self claim
-- A worker with an employee record may take a bundle for themselves; anybody else
-- needs the assignment permission. Both paths land in rpc_assign_bundle so the
-- dependency, duplicate and piece-rate rules stay in one place.
create or replace function public.rpc_assign_bundle(
  p_bundle uuid, p_stage text, p_employee uuid,
  p_quantity numeric default null, p_key text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order uuid; v_qty numeric; v_status text; v_rate numeric; v_id uuid;
  v_deps text[]; v_missing text[]; v_self uuid;
begin
  select employee_id into v_self from public.profiles where id = auth.uid();
  if p_employee is not null and p_employee = v_self then
    perform public.fn_require_permission('production.self_assign');
  else
    perform public.fn_require_permission('production.assignment.create');
  end if;

  select b.order_id, b.quantity, b.status into v_order, v_qty, v_status
    from public.bundles b where b.id = p_bundle;
  if v_order is null then perform public.fn_raise('E_BUNDLE_NOT_FOUND'); end if;
  if v_status = 'cancelled' then perform public.fn_raise('E_BUNDLE_CANCELLED'); end if;

  if not exists (select 1 from public.production_order_stages
                  where order_id = v_order and code = p_stage) then
    perform public.fn_raise('E_STAGE_UNKNOWN', p_stage);
  end if;

  -- Dependencies must be finished for this bundle before this stage may start.
  select s.depends_on into v_deps from public.production_order_stages s
   where s.order_id = v_order and s.code = p_stage;
  if coalesce(array_length(v_deps, 1), 0) > 0 then
    select array_agg(d) into v_missing
      from unnest(v_deps) d
     where not exists (
       select 1 from public.work_assignments wa
        where wa.bundle_id = p_bundle and wa.stage_code = d
          and wa.received_at is not null and wa.accepted_qty > 0);
    if v_missing is not null then
      perform public.fn_raise('E_STAGE_NOT_READY', array_to_string(v_missing, ','));
    end if;
  end if;

  v_rate := public.fn_piece_rate(p_employee, p_stage);

  insert into public.work_assignments
    (bundle_id, order_id, stage_code, employee_id, quantity, piece_rate, idempotency_key)
  values (p_bundle, v_order, p_stage, p_employee, coalesce(p_quantity, v_qty), v_rate, p_key)
  returning id into v_id;

  update public.bundles set status = 'in_progress' where id = p_bundle;
  return jsonb_build_object('id', v_id, 'piece_rate', v_rate);
end $$;

-- The worker takes the bundle themselves.
create or replace function public.rpc_claim_bundle(p_bundle uuid, p_stage text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  select employee_id into v_emp from public.profiles where id = auth.uid();
  if v_emp is null then perform public.fn_raise('E_NO_EMPLOYEE_LINKED'); end if;
  return public.rpc_assign_bundle(p_bundle, p_stage, v_emp);
end $$;

-- ---------------------------------------------------------------- delivery
-- A permit must only ship what is actually finished, and shipping it must mark
-- the bundles delivered — otherwise the same pieces could be shipped twice.
create or replace function public.rpc_create_delivery(
  p_order uuid, p_lines jsonb, p_date date default null, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_code text; v_line jsonb;
  v_colour text; v_size text; v_qty numeric; v_ready numeric; v_take numeric;
  v_bundle record; v_left numeric;
begin
  perform public.fn_require_permission('production.delivery.create');

  if not exists (select 1 from public.production_orders
                  where id = p_order and status <> 'cancelled') then
    perform public.fn_raise('E_ORDER_NOT_OPEN');
  end if;

  v_code := public.fn_next_code('DLV');
  insert into public.deliveries (code, order_id, delivered_on, notes)
  values (v_code, p_order, coalesce(p_date, public.fn_today()), p_notes)
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_colour := coalesce(trim(v_line->>'colour'), '');
    v_size   := trim(v_line->>'size');
    v_qty    := coalesce((v_line->>'quantity')::numeric, 0);
    if v_qty <= 0 then perform public.fn_raise('E_QTY_POSITIVE'); end if;

    select coalesce(sum(b.quantity), 0) into v_ready
      from public.bundles b
     where b.order_id = p_order and b.status = 'finished'
       and coalesce(b.colour, '') = v_colour and b.size = v_size;
    if v_qty > v_ready then
      perform public.fn_raise('E_OVER_DELIVERY', v_ready::text);
    end if;

    insert into public.delivery_lines (delivery_id, colour, size, quantity)
    values (v_id, v_colour, v_size, v_qty);

    -- Ship the earliest finished bundles of this colour/size first.
    v_left := v_qty;
    for v_bundle in select b.id, b.quantity from public.bundles b
                    where b.order_id = p_order and b.status = 'finished'
                      and coalesce(b.colour, '') = v_colour and b.size = v_size
                    order by b.code loop
      exit when v_left <= 0;
      v_take := least(v_left, v_bundle.quantity);
      v_left := v_left - v_take;
      update public.bundles set status = 'delivered' where id = v_bundle.id;
    end loop;
  end loop;

  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

-- ---------------------------------------------------------------- ready quantity
-- "جاهز للتسليم" means finished and not yet shipped. Counting delivered bundles
-- as ready made the ship button stay on after everything had gone out.
create or replace view public.v_production_orders as
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
       where b.order_id = o.id and b.status = 'finished') dl on true
    left join lateral (
      select sum(l.quantity) as delivered_qty from public.delivery_lines l
        join public.deliveries d on d.id = l.delivery_id where d.order_id = o.id) dv on true;

grant select on public.v_production_orders to authenticated;

-- ---------------------------------------------------------------- timeline text
-- A size-only cut has no colour, so the old 'colour / size' wording left a gap.
-- Rebuilding the view keeps one definition for both cutting modes.
create or replace view public.v_order_timeline as
  select o.id as order_id, o.created_at as at, 'created' as kind,
         'اتعمل الأمر' as description, null::text as actor
    from public.production_orders o
  union all
  select cl.order_id, cl.created_at, 'cut',
         'اتقص ' || cl.quantity::text || ' قطعة'
           || case when coalesce(trim(cl.colour), '') = '' then ''
                   else ' ' || cl.colour end
           || ' / ' || cl.size,
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

grant select on public.v_order_timeline to authenticated;

-- ---------------------------------------------------------------- read models
drop view if exists public.v_bundle_queue;
drop view if exists public.v_order_stages;
drop view if exists public.v_bundles;

create view public.v_bundles as
  select b.id, b.code, b.barcode, b.order_id, o.code as order_code, o.model_name,
         c.name as customer_name, b.size, b.colour,
         nullif(coalesce(b.colour_label, b.colour), '') as colour_label,
         (b.colour <> '') as has_colour,
         b.quantity, b.status, b.cut_date,
         public.fn_size_rank(b.size) as size_rank,
         b.created_at,
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

-- deps_done is order-level (are the predecessors finished for the order at all),
-- which is what decides whether a stage is worth showing. The per-bundle check
-- stays in rpc_assign_bundle.
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
         end as status,
         not exists (
           select 1 from unnest(s.depends_on) d
            where not exists (
              select 1 from public.work_assignments wa
               where wa.order_id = s.order_id and wa.stage_code = d
                 and wa.received_at is not null and wa.accepted_qty > 0)
         ) as deps_done
    from public.production_order_stages s
    left join lateral (
      select sum(wa.accepted_qty) as accepted, sum(wa.rejected_qty) as rejected,
             sum(case when wa.received_at is null then wa.quantity else 0 end) as in_flight
        from public.work_assignments wa
       where wa.order_id = s.order_id and wa.stage_code = s.code) w on true;

-- One row per (bundle, stage) that still has work left, with the flags the queue
-- needs: may this stage start for this bundle, and is the bundle already out.
create view public.v_bundle_queue as
  select b.id as bundle_id, b.code as bundle_code, b.order_id, o.code as order_code,
         o.model_name, c.name as customer_name,
         b.size, b.colour, nullif(coalesce(b.colour_label, b.colour), '') as colour_label,
         (b.colour <> '') as has_colour, b.quantity, b.status as bundle_status,
         public.fn_size_rank(b.size) as size_rank,
         s.code as stage_code, s.name_ar as stage_name, s.seq as stage_seq,
         s.piece_price, s.depends_on,
         not exists (
           select 1 from unnest(s.depends_on) d
            where not exists (
              select 1 from public.work_assignments wa
               where wa.bundle_id = b.id and wa.stage_code = d
                 and wa.received_at is not null and wa.accepted_qty > 0)
         ) as deps_done,
         exists (select 1 from public.work_assignments wa
                  where wa.bundle_id = b.id and wa.stage_code = s.code
                    and wa.received_at is not null) as stage_done,
         (select e.name from public.work_assignments wa
            join public.employees e on e.id = wa.employee_id
           where wa.bundle_id = b.id and wa.stage_code = s.code
             and wa.received_at is null limit 1) as current_holder,
         (select wa.id from public.work_assignments wa
           where wa.bundle_id = b.id and wa.stage_code = s.code
             and wa.received_at is null limit 1) as open_assignment
    from public.bundles b
    join public.production_orders o on o.id = b.order_id
    join public.customers c on c.id = o.customer_id
    join public.production_order_stages s on s.order_id = b.order_id
   where b.status <> 'cancelled' and o.status <> 'cancelled';

-- Recreating a view drops the grants it inherited from 0007.
grant select on public.v_bundles, public.v_order_stages, public.v_bundle_queue
  to authenticated;
