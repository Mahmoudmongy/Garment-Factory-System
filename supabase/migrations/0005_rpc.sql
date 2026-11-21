-- ============================================================================
-- 0005 — business rules (RPC). The UI never writes tables directly.
-- ============================================================================

-- ---------------------------------------------------------------- customers
create or replace function public.rpc_create_customer(
  p_name text, p_phone text default null, p_letter text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_letter text;
begin
  perform public.fn_require_permission('customer.create');
  if coalesce(trim(p_name), '') = '' then perform public.fn_raise('E_NAME_REQUIRED'); end if;

  if p_letter is null then
    -- Derive a short unique letter from the name so the operator need not think about it.
    v_letter := upper(left(regexp_replace(coalesce(p_name,''), '[^A-Za-z\u0600-\u06FF]', '', 'g'), 1));
    if v_letter !~ '^[A-Z]$' then v_letter := 'C'; end if;
    while exists (select 1 from public.customers where operating_letter = v_letter) loop
      v_letter := chr(ascii(v_letter) + 1);
      if v_letter > 'Z' then perform public.fn_raise('E_LETTERS_EXHAUSTED'); end if;
    end loop;
  else
    v_letter := upper(trim(p_letter));
    if exists (select 1 from public.customers where operating_letter = v_letter) then
      perform public.fn_raise('E_LETTER_TAKEN', v_letter);
    end if;
  end if;

  insert into public.customers (code, operating_letter, name, phone)
  values (public.fn_next_code('CUS'), v_letter, trim(p_name), p_phone)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'operating_letter', v_letter,
    'code', (select code from public.customers where id = v_id));
end $$;

create or replace function public.rpc_update_customer(
  p_id uuid, p_name text default null, p_phone text default null,
  p_notes text default null, p_is_active boolean default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_require_permission('customer.edit');
  update public.customers set
    name = coalesce(nullif(trim(p_name), ''), name),
    phone = coalesce(p_phone, phone),
    notes = coalesce(p_notes, notes),
    is_active = coalesce(p_is_active, is_active)
   where id = p_id;
  if not found then perform public.fn_raise('E_NOT_FOUND'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- employees
create or replace function public.rpc_create_employee(
  p_name text, p_kind text default 'worker', p_job_title text default null,
  p_phone text default null, p_hired_on date default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_prefix text;
begin
  perform public.fn_require_permission('employee.create');
  if coalesce(trim(p_name), '') = '' then perform public.fn_raise('E_NAME_REQUIRED'); end if;
  v_prefix := case when p_kind = 'worker' then 'W' else 'EMP' end;
  insert into public.employees (code, name, kind, job_title, phone, hired_on)
  values (public.fn_next_code(v_prefix), trim(p_name), p_kind, p_job_title, p_phone, p_hired_on)
  returning id into v_id;
  return jsonb_build_object('id', v_id,
    'code', (select code from public.employees where id = v_id));
end $$;

create or replace function public.rpc_set_piece_rate(
  p_employee uuid, p_stage text, p_rate numeric, p_from date default public.fn_today()
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_require_permission('employee.payterms.manage');
  insert into public.employee_pay_terms (employee_id, stage_key, piece_rate, effective_from)
  values (p_employee, p_stage, p_rate, p_from)
  on conflict (employee_id, stage_key, effective_from)
    do update set piece_rate = excluded.piece_rate;
  return jsonb_build_object('ok', true);
end $$;

-- Resolves what a worker earns for one accepted piece of a given stage.
create or replace function public.fn_piece_rate(p_employee uuid, p_stage text, p_on date default public.fn_today())
returns numeric language sql stable as $$
  select coalesce(
    (select t.piece_rate from public.employee_pay_terms t
      where t.employee_id = p_employee and t.stage_key = p_stage and t.effective_from <= p_on
      order by t.effective_from desc limit 1),
    (select t.piece_rate from public.employee_pay_terms t
      where t.employee_id = p_employee and t.stage_key is null and t.effective_from <= p_on
      order by t.effective_from desc limit 1),
    0)
$$;

-- ---------------------------------------------------------------- stage templates
create or replace function public.rpc_save_stage_template(
  p_template uuid, p_name text, p_stages jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tpl uuid; v_row jsonb;
begin
  perform public.fn_require_permission('production.order.edit');
  if p_template is null then
    insert into public.stage_templates (name_ar) values (p_name) returning id into v_tpl;
  else
    update public.stage_templates set name_ar = p_name where id = p_template returning id into v_tpl;
    if v_tpl is null then perform public.fn_raise('E_NOT_FOUND'); end if;
    delete from public.stage_template_stages where template_id = v_tpl;
  end if;

  for v_row in select * from jsonb_array_elements(p_stages) loop
    insert into public.stage_template_stages
      (template_id, seq, name_ar, code, piece_price, depends_on, is_operations, is_final)
    values (v_tpl,
      (v_row->>'seq')::int, v_row->>'name_ar', v_row->>'code',
      coalesce((v_row->>'piece_price')::numeric, 0),
      coalesce((select array_agg(x) from jsonb_array_elements_text(v_row->'depends_on') x), '{}'),
      coalesce((v_row->>'is_operations')::boolean, false),
      coalesce((v_row->>'is_final')::boolean, false));
  end loop;
  return jsonb_build_object('id', v_tpl);
end $$;

-- ---------------------------------------------------------------- production orders
create or replace function public.rpc_create_production_order(
  p_customer uuid, p_model text, p_quantity numeric, p_piece_price numeric,
  p_template uuid default null, p_due_date date default null,
  p_notes text default null, p_order_date date default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text; v_tpl uuid;
begin
  perform public.fn_require_permission('production.order.create');
  if p_quantity is null or p_quantity <= 0 then perform public.fn_raise('E_QTY_POSITIVE'); end if;

  v_code := public.fn_next_code('PO');
  insert into public.production_orders
    (code, customer_id, model_name, quantity, piece_price, order_date, due_date, notes)
  values (v_code, p_customer, trim(p_model), p_quantity, p_piece_price,
          coalesce(p_order_date, public.fn_today()), p_due_date, p_notes)
  returning id into v_id;

  -- Snapshot the template. Falls back to the default template when none is named,
  -- so an order always has stages to move through.
  v_tpl := coalesce(p_template, (select id from public.stage_templates
                                  where is_default order by created_at limit 1));
  if v_tpl is not null then
    insert into public.production_order_stages
      (order_id, seq, name_ar, code, piece_price, depends_on, is_operations, is_final, due_date)
    select v_id, s.seq, s.name_ar, s.code, s.piece_price, s.depends_on,
           s.is_operations, s.is_final, p_due_date
      from public.stage_template_stages s where s.template_id = v_tpl
     order by s.seq;
  end if;

  return jsonb_build_object('id', v_id, 'code', v_code,
    'stages', (select count(*) from public.production_order_stages where order_id = v_id));
end $$;

create or replace function public.rpc_cancel_production_order(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_require_permission('production.order.cancel');
  if coalesce(trim(p_reason), '') = '' then perform public.fn_raise('E_REASON_REQUIRED'); end if;
  update public.production_orders
     set status = 'cancelled', cancel_reason = p_reason, closed_at = now()
   where id = p_id and status <> 'cancelled';
  if not found then perform public.fn_raise('E_NOT_FOUND'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- fabric
create or replace function public.rpc_receive_fabric(
  p_customer uuid, p_colour text, p_quantity numeric,
  p_order uuid default null, p_date date default null,
  p_notes text default null, p_key text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.fn_require_permission('production.fabric.receive');
  if p_quantity is null or p_quantity <= 0 then perform public.fn_raise('E_QTY_POSITIVE'); end if;
  if coalesce(trim(p_colour), '') = '' then perform public.fn_raise('E_COLOUR_REQUIRED'); end if;

  if p_key is not null then
    select id into v_id from public.customer_fabric_movements where idempotency_key = p_key;
    if v_id is not null then
      return jsonb_build_object('id', v_id, 'replayed', true);
    end if;
  end if;

  insert into public.customer_fabric_movements
    (customer_id, colour, quantity, movement, production_order_id, txn_date, notes, idempotency_key)
  values (p_customer, trim(p_colour), p_quantity, 'receive', p_order,
          coalesce(p_date, public.fn_today()), p_notes, p_key)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'replayed', false);
end $$;

-- ---------------------------------------------------------------- cutting
-- One call = one cutting session. Creates a cut line per (colour,size), consumes the
-- customer's fabric of that colour, then splits each line into bundles of p_bundle_size.
create or replace function public.rpc_execute_cutting(
  p_order uuid, p_lines jsonb, p_bundle_size numeric default 40,
  p_cut_date date default null, p_key text default null
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
    v_colour := trim(v_line->>'colour');
    v_size   := trim(v_line->>'size');
    if v_qty <= 0 then continue; end if;
    if v_colour = '' or v_size = '' then perform public.fn_raise('E_COLOUR_SIZE_REQUIRED'); end if;
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
    v_colour := trim(v_line->>'colour');
    v_size   := trim(v_line->>'size');
    if v_qty <= 0 then continue; end if;

    insert into public.cut_lines (order_id, colour, size, quantity, cut_date, idempotency_key)
    values (p_order, v_colour, v_size, v_qty, coalesce(p_cut_date, public.fn_today()), p_key)
    returning id into v_cut_line;

    -- Fabric is drawn per colour. A negative balance is allowed here on purpose: the
    -- factory may cut before the customer's delivery is logged, and the warehouse
    -- screen shows the shortfall so it can be reconciled.
    insert into public.customer_fabric_movements
      (customer_id, colour, quantity, movement, production_order_id, txn_date, notes)
    values (v_customer, v_colour, -v_qty, 'cut', p_order,
            coalesce(p_cut_date, public.fn_today()),
            'قص ' || (select code from public.production_orders where id = p_order));

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

-- ---------------------------------------------------------------- assignment / receipt
create or replace function public.rpc_assign_bundle(
  p_bundle uuid, p_stage text, p_employee uuid,
  p_quantity numeric default null, p_key text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order uuid; v_qty numeric; v_status text; v_rate numeric; v_id uuid;
  v_deps text[]; v_missing text[];
begin
  perform public.fn_require_permission('production.assignment.create');

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

create or replace function public.rpc_receive_work(
  p_assignment uuid, p_accepted numeric, p_rejected numeric default 0,
  p_rework numeric default 0, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_qty numeric; v_rate numeric; v_wage numeric; v_bundle uuid; v_stage text;
begin
  perform public.fn_require_permission('production.receive');

  select quantity, piece_rate, bundle_id, stage_code
    into v_qty, v_rate, v_bundle, v_stage
    from public.work_assignments where id = p_assignment and received_at is null;
  if v_qty is null then perform public.fn_raise('E_ASSIGNMENT_OPEN_NOT_FOUND'); end if;

  if coalesce(p_accepted,0) + coalesce(p_rejected,0) + coalesce(p_rework,0) <> v_qty then
    perform public.fn_raise('E_QTY_MISMATCH', v_qty::text);
  end if;
  if coalesce(p_rejected,0) > 0 and coalesce(trim(p_reason), '') = '' then
    perform public.fn_raise('E_REJECT_REASON_REQUIRED');
  end if;

  -- Wages accrue on accepted pieces only — the rejected ones were not good product.
  v_wage := round(coalesce(p_accepted,0) * v_rate, 2);

  update public.work_assignments set
    received_at = now(), received_by = auth.uid(),
    accepted_qty = coalesce(p_accepted,0), rejected_qty = coalesce(p_rejected,0),
    rework_qty = coalesce(p_rework,0), reject_reason = nullif(trim(p_reason),''),
    wage_amount = v_wage
  where id = p_assignment;

  -- A bundle is finished once it clears the order's final stage.
  if exists (select 1 from public.production_order_stages
              where order_id = (select order_id from public.work_assignments where id = p_assignment)
                and code = v_stage and is_final) then
    update public.bundles set status = 'finished' where id = v_bundle;
  end if;

  return jsonb_build_object('wage', v_wage, 'accepted', coalesce(p_accepted,0));
end $$;

-- ---------------------------------------------------------------- delivery
create or replace function public.rpc_create_delivery(
  p_order uuid, p_lines jsonb, p_date date default null, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text; v_line jsonb;
begin
  perform public.fn_require_permission('production.delivery.create');
  v_code := public.fn_next_code('DLV');
  insert into public.deliveries (code, order_id, delivered_on, notes)
  values (v_code, p_order, coalesce(p_date, public.fn_today()), p_notes)
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.delivery_lines (delivery_id, colour, size, quantity)
    values (v_id, trim(v_line->>'colour'), trim(v_line->>'size'),
            (v_line->>'quantity')::numeric);
  end loop;
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

create or replace function public.rpc_create_customer_return(
  p_order uuid, p_colour text, p_size text, p_quantity numeric,
  p_reason text default null, p_disposition text default 'rework', p_date date default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text;
begin
  perform public.fn_require_permission('production.delivery.create');
  if p_quantity <= 0 then perform public.fn_raise('E_QTY_POSITIVE'); end if;
  v_code := public.fn_next_code('RET');
  insert into public.customer_returns
    (code, order_id, colour, size, quantity, reason, disposition, returned_on)
  values (v_code, p_order, trim(p_colour), trim(p_size), p_quantity, p_reason,
          p_disposition, coalesce(p_date, public.fn_today()))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

-- ---------------------------------------------------------------- cash
create or replace function public.rpc_post_cash(
  p_account uuid, p_amount numeric, p_category text, p_description text,
  p_date date default null, p_customer uuid default null,
  p_employee uuid default null, p_order uuid default null, p_key text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.fn_require_permission('account.transaction.create');
  if coalesce(trim(p_description), '') = '' then perform public.fn_raise('E_DESCRIPTION_REQUIRED'); end if;

  if p_key is not null then
    select id into v_id from public.financial_transactions where idempotency_key = p_key;
    if v_id is not null then return jsonb_build_object('id', v_id, 'replayed', true); end if;
  end if;

  insert into public.financial_transactions
    (account_id, amount, category, description, txn_date, customer_id, employee_id,
     production_order_id, idempotency_key)
  values (p_account, p_amount, p_category, trim(p_description),
          coalesce(p_date, public.fn_today()), p_customer, p_employee, p_order, p_key)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'replayed', false);
end $$;

create or replace function public.rpc_reverse_cash(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.financial_transactions; v_new uuid;
begin
  perform public.fn_require_permission('account.transaction.reverse');
  if coalesce(trim(p_reason), '') = '' then perform public.fn_raise('E_REASON_REQUIRED'); end if;
  select * into v_row from public.financial_transactions where id = p_id;
  if v_row.id is null then perform public.fn_raise('E_NOT_FOUND'); end if;
  if v_row.reverses_id is not null then perform public.fn_raise('E_ALREADY_REVERSAL'); end if;
  if exists (select 1 from public.financial_transactions where reverses_id = p_id) then
    perform public.fn_raise('E_ALREADY_REVERSED');
  end if;
  insert into public.financial_transactions
    (account_id, amount, category, description, txn_date, customer_id, employee_id,
     production_order_id, reverses_id)
  values (v_row.account_id, -v_row.amount, v_row.category,
          'عكس: ' || v_row.description, public.fn_today(),
          v_row.customer_id, v_row.employee_id, v_row.production_order_id, p_id)
  returning id into v_new;
  return jsonb_build_object('id', v_new);
end $$;

-- ---------------------------------------------------------------- expenses
create or replace function public.rpc_create_expense(
  p_account uuid, p_category text, p_description text, p_amount numeric,
  p_date date default null, p_order uuid default null, p_key text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.fn_require_permission('expense.create');
  if p_amount is null or p_amount <= 0 then perform public.fn_raise('E_AMOUNT_POSITIVE'); end if;
  if coalesce(trim(p_description), '') = '' then perform public.fn_raise('E_DESCRIPTION_REQUIRED'); end if;

  if p_key is not null then
    select id into v_id from public.expenses where idempotency_key = p_key;
    if v_id is not null then return jsonb_build_object('id', v_id, 'replayed', true); end if;
  end if;

  insert into public.expenses
    (account_id, category, description, amount, expense_date, production_order_id, idempotency_key)
  values (p_account, p_category, trim(p_description), p_amount,
          coalesce(p_date, public.fn_today()), p_order, p_key)
  returning id into v_id;

  -- The cash leaves the drawer in the same breath; one document, two ledgers.
  insert into public.financial_transactions
    (account_id, amount, category, description, txn_date, production_order_id, idempotency_key)
  values (p_account, -p_amount, 'expense', trim(p_description),
          coalesce(p_date, public.fn_today()), p_order,
          case when p_key is null then null else p_key || ':cash' end);

  return jsonb_build_object('id', v_id, 'replayed', false);
end $$;
