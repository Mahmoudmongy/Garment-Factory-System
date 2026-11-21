-- Core behaviour: codes, permissions, production flow, wages, costing.
begin;
select plan(49);

-- Act as the superuser admin for the whole run.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ---------------------------------------------------------------- reference data
select ok((select count(*) from public.permissions) >= 60, 'permission catalog has 60+ codes');
select ok(public.has_permission('production.order.create'), 'admin has every permission');
select is(public.has_permission('nonexistent.code'), true,
  'superuser holds even unknown codes (checked against foreman below)');

-- the foreman must NOT be able to create orders
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(public.has_permission('production.order.create'), false, 'foreman cannot create orders');
select is(public.has_permission('production.receive'), true, 'foreman can receive work');
select is(public.has_permission('nonexistent.code'), false, 'unknown permission is false for a normal user');
select throws_ok(
  $$ select public.rpc_create_production_order(
       '00000000-0000-0000-0000-000000000000'::uuid, 'x', 10, 100) $$,
  'P0001', 'E_PERM — production.order.create',
  'foreman is blocked at the RPC boundary, not just the UI');
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ---------------------------------------------------------------- customers
select is(
  (public.rpc_create_customer('محمود الجندي', '01011550189', 'M') ->> 'operating_letter'),
  'M', 'customer keeps the requested operating letter');
select is(
  (select code from public.customers where name = 'محمود الجندي'),
  'CUS0001', 'first customer code is CUS0001');
select throws_ok(
  $$ select public.rpc_create_customer('تاني', null, 'M') $$,
  'P0001', 'E_LETTER_TAKEN — M', 'operating letter must be unique');
select is(
  (public.rpc_create_customer('عبد الرحمن الجمل', '01000000000', 'AG') ->> 'operating_letter'),
  'AG', 'multi-letter operating code is allowed');

-- ---------------------------------------------------------------- employees
select is(
  (public.rpc_create_employee('محمد محمود', 'worker', 'تعريش', '01011550189') ->> 'code'),
  'W0001', 'workers get a W- series code');
select is(
  (public.rpc_create_employee('أحمد التشغيل', 'operations', 'مشرف') ->> 'code'),
  'EMP0001', 'operations staff get the EMP series');

select is(
  (public.rpc_set_piece_rate(
     (select id from public.employees where name = 'محمد محمود'), 'collar', 3.00) ->> 'ok')::boolean,
  true, 'piece rate can be set per stage');
select is(
  public.fn_piece_rate((select id from public.employees where name = 'محمد محمود'), 'collar'),
  3.00::numeric, 'piece rate resolves for the stage');
select is(
  public.fn_piece_rate((select id from public.employees where name = 'محمد محمود'), 'chest'),
  0::numeric, 'unset stage falls back to zero');

-- ---------------------------------------------------------------- order + template snapshot
create temp table _ctx as
  select (public.rpc_create_production_order(
            (select id from public.customers where operating_letter = 'M'),
            'جاكيت تومي', 240, 130,
            'aaaaaaaa-0000-0000-0000-000000000001',
            current_date + 10, 'شريط على الكم')) as r;

select is((select r->>'code' from _ctx), 'PO0001', 'first order is PO0001');
select is((select (r->>'stages')::int from _ctx), 7, 'order snapshotted all 7 template stages');
select is(
  (select quantity from public.production_orders where code = 'PO0001'),
  240::numeric, 'order quantity stored');
select is(
  (select depends_on from public.production_order_stages
    where order_id = (select id from public.production_orders where code = 'PO0001')
      and code = 'assembly'),
  array['collar','chest','back'], 'stage dependencies carried onto the order');

-- ---------------------------------------------------------------- fabric by colour
select is(
  (public.rpc_receive_fabric(
     (select id from public.customers where operating_letter = 'M'),
     'إسود', 1000, null, current_date, null, 'fab-1') ->> 'replayed')::boolean,
  false, 'fabric receipt recorded');
select is(
  (public.rpc_receive_fabric(
     (select id from public.customers where operating_letter = 'M'),
     'إسود', 1000, null, current_date, null, 'fab-1') ->> 'replayed')::boolean,
  true, 'replayed fabric receipt is idempotent');
select is(
  (select balance from public.v_customer_fabric_balances
    where colour = 'إسود' and customer_id = (select id from public.customers where operating_letter = 'M')),
  1000.000::numeric, 'fabric balance is per colour');

-- ---------------------------------------------------------------- cutting
select throws_ok(
  format($$ select public.rpc_execute_cutting(%L::uuid, %L::jsonb) $$,
    (select id from public.production_orders where code = 'PO0001'),
    '[{"colour":"إسود","size":"M","quantity":300}]'),
  'P0001', 'E_OVER_CUT — 240', 'cannot cut more than the order quantity');

select throws_ok(
  format($$ select public.rpc_execute_cutting(%L::uuid, %L::jsonb) $$,
    (select id from public.production_orders where code = 'PO0001'),
    '[{"colour":"إسود","size":"M","quantity":2.5}]'),
  'P0001', 'E_WHOLE_PIECES', 'cutting must be in whole pieces');

select is(
  (public.rpc_execute_cutting(
     (select id from public.production_orders where code = 'PO0001'),
     '[{"colour":"إسود","size":"M","quantity":80},
       {"colour":"كحلي","size":"L","quantity":80}]'::jsonb, 40) ->> 'bundles')::int,
  4, '80+80 pieces at 40/bundle makes 4 bundles');
select is(
  (select count(*) from public.operational_codes)::int, 160, 'one operational code per piece');
select is(
  (select count(distinct letter) from public.operational_codes), 1::bigint, 'all codes use the customer letter');
select is(
  (select code from public.operational_codes where size = 'M' order by code limit 1),
  'MM0001', 'first M-size operational code is MM0001');
select is(
  (select code from public.operational_codes where size = 'L' order by code limit 1),
  'ML0001', 'L-size serial restarts at 0001');
select is(
  (select balance from public.v_customer_fabric_balances
    where colour = 'إسود' and customer_id = (select id from public.customers where operating_letter = 'M')),
  920.000::numeric, 'cutting consumed 80m of black fabric');

-- partial cutting leaves a remainder
select is(
  (select cut_quantity from public.v_production_orders where code = 'PO0001'),
  160::numeric, 'order shows 160 of 240 cut');
select is(
  (select cut_percent from public.v_production_orders where code = 'PO0001'),
  67::numeric, 'cut percent is 67%');

-- ---------------------------------------------------------------- assignment rules
create temp table _b as
  select id, code from public.bundles
   where order_id = (select id from public.production_orders where code = 'PO0001')
     and size = 'M' order by code limit 1;

select throws_ok(
  format($$ select public.rpc_assign_bundle(%L::uuid, 'assembly', %L::uuid) $$,
    (select id from _b),
    (select id from public.employees where name = 'محمد محمود')),
  'P0001', 'E_STAGE_NOT_READY — collar,chest,back',
  'a dependent stage cannot start before its predecessors are received');

select is(
  (public.rpc_assign_bundle(
     (select id from _b), 'collar',
     (select id from public.employees where name = 'محمد محمود')) ->> 'piece_rate')::numeric,
  3.00, 'assignment snapshots the piece rate');

select throws_ok(
  format($$ select public.rpc_assign_bundle(%L::uuid, 'collar', %L::uuid) $$,
    (select id from _b),
    (select id from public.employees where name = 'محمد محمود')),
  '23505', null, 'the same bundle cannot be out twice for one stage');

-- ---------------------------------------------------------------- receipt rules
create temp table _a as
  select id, quantity from public.work_assignments
   where bundle_id = (select id from _b) and received_at is null;

select throws_ok(
  format($$ select public.rpc_receive_work(%L::uuid, 10, 0, 0) $$, (select id from _a)),
  'P0001', 'E_QTY_MISMATCH — 40', 'accepted+rejected+rework must equal the delivered quantity');

select throws_ok(
  format($$ select public.rpc_receive_work(%L::uuid, 30, 10, 0) $$, (select id from _a)),
  'P0001', 'E_REJECT_REASON_REQUIRED', 'a rejection needs a reason');

select is(
  (public.rpc_receive_work((select id from _a), 30, 10, 0, 'خياطة') ->> 'wage')::numeric,
  90.00, 'wages accrue on accepted pieces only (30 × 3.00)');

select is(
  (select wage_amount from public.work_assignments where id = (select id from _a)),
  90.00::numeric, 'wage persisted on the assignment');

-- ---------------------------------------------------------------- worker balance
select is(
  (select remaining_due from public.v_workers where name = 'محمد محمود'),
  90.00::numeric, 'worker shows 90 due');

select is(
  (public.rpc_post_cash(
     'bbbbbbbb-0000-0000-0000-000000000001',
     -90, 'worker_payment', 'أجر أسبوع',
     null, null,
     (select id from public.employees where name = 'محمد محمود'), null, 'pay-1') ->> 'replayed')::boolean,
  false, 'worker payment posted');

select is(
  (select remaining_due from public.v_workers where name = 'محمد محمود'),
  0.00::numeric, 'worker balance clears after payment');

select is(
  (select balance from public.v_account_balances where code = 'CASH1'),
  49910.00::numeric, 'cash drawer reflects the payment');

-- ---------------------------------------------------------------- reversal
select throws_ok(
  format($$ select public.rpc_reverse_cash(%L::uuid, '') $$,
    (select id from public.financial_transactions where idempotency_key = 'pay-1')),
  'P0001', 'E_REASON_REQUIRED', 'a reversal needs a reason');

select ok(
  (public.rpc_reverse_cash(
     (select id from public.financial_transactions where idempotency_key = 'pay-1'),
     'خطأ في المبلغ') ->> 'id') is not null, 'reversal creates a mirror entry');
select is(
  (select balance from public.v_account_balances where code = 'CASH1'),
  50000.00::numeric, 'reversal restores the cash balance');
select is(
  (select remaining_due from public.v_workers where name = 'محمد محمود'),
  90.00::numeric, 'reversal restores the worker balance');

-- ---------------------------------------------------------------- order costing
select is(
  (select expected_revenue from public.v_order_costing where code = 'PO0001'),
  31200.00::numeric, 'expected revenue = 240 × 130');
select is(
  (select wages from public.v_order_costing where code = 'PO0001'),
  90.00::numeric, 'costing picks up wages');
select is(
  (select total_cost from public.v_order_costing where code = 'PO0001'),
  90.00::numeric, 'total cost equals wages plus direct expenses');

-- ---------------------------------------------------------------- expenses hit both ledgers
select is(
  (public.rpc_create_expense(
     'bbbbbbbb-0000-0000-0000-000000000001', 'كهرباء', 'فاتورة كهرباء',
     1200, null, null, 'exp-1') ->> 'replayed')::boolean,
  false, 'expense recorded');
select is(
  (select balance from public.v_account_balances where code = 'CASH1'),
  48800.00::numeric, 'expense also left the cash drawer');
select is(
  (select count(*) from public.financial_transactions
    where category = 'expense' and reverses_id is null)::int,
  1, 'exactly one cash movement per expense');

-- ---------------------------------------------------------------- order states
select throws_ok(
  format($$ select public.rpc_cancel_production_order(%L::uuid, '') $$,
    (select id from public.production_orders where code = 'PO0001')),
  'P0001', 'E_REASON_REQUIRED', 'cancelling needs a reason');
select is(
  (public.rpc_cancel_production_order(
     (select id from public.production_orders where code = 'PO0001'), 'العميل ألغى') ->> 'ok')::boolean,
  true, 'order cancelled');
select throws_ok(
  format($$ select public.rpc_execute_cutting(%L::uuid, %L::jsonb) $$,
    (select id from public.production_orders where code = 'PO0001'),
    '[{"colour":"إسود","size":"M","quantity":1}]'),
  'P0001', 'E_ORDER_NOT_OPEN', 'a cancelled order cannot be cut further');

-- ---------------------------------------------------------------- views agree
select is(
  (select count(*) from public.v_bundles where order_code = 'PO0001')::int, 4,
  'bundle view lists all four bundles');
select is(
  (select code_count from public.v_bundles
    where order_code = 'PO0001' and size = 'M' order by code limit 1),
  40::bigint, 'bundle view counts its operational codes');
select is(
  (select status from public.v_order_stages
    where order_id = (select id from public.production_orders where code = 'PO0001')
      and code = 'collar'),
  'done', 'a fully received stage reads as done');
select is(
  (select status from public.v_order_stages
    where order_id = (select id from public.production_orders where code = 'PO0001')
      and code = 'chest'),
  'pending', 'an untouched stage reads as pending');
select ok(
  (select count(*) from public.v_order_timeline
    where order_id = (select id from public.production_orders where code = 'PO0001')) >= 4,
  'timeline has created + cut + stage events');

-- ---------------------------------------------------------------- audit
select ok(
  (select count(*) from public.audit_log where table_name = 'production_orders') > 0,
  'order writes are audited');

select * from finish();
rollback;
