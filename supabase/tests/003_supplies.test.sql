-- Supplies: buying, customer-owned receipts, issuing, and the stock balance view.
begin;
select plan(20);

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

create temp table _f as
  select (select id from public.financial_accounts where code = 'CASH1') as account,
         (select id from public.warehouses where code = 'WH02') as warehouse;

create temp table _c as
  select (public.rpc_create_customer('عميل مستلزمات', '01000000000', 'QZ') ->> 'id')::uuid as customer;

-- ---------------------------------------------------------------- items
select is(
  (public.rpc_create_item('خيط أسود', 'thread', 'بكرة') ->> 'code'),
  'ITM0004', 'a new item continues the ITM series');

create temp table _i as
  select id from public.items where name = 'خيط أسود';

-- ---------------------------------------------------------------- purchase
select is(
  (public.rpc_purchase_supplies(
     (select id from _i), (select warehouse from _f), 100, 2.5,
     (select account from _f), current_date, 'شراء خيط', 'buy-1') ->> 'amount')::numeric,
  250.00, 'buying 100 at 2.50 costs 250');

select is(
  (select balance from public.v_account_balances where code = 'CASH1'),
  49750.00::numeric, 'the purchase left the cash drawer');

select is(
  (select quantity from public.v_stock_balances
    where item_id = (select id from _i) and ownership = 'factory'),
  100.000::numeric, 'the purchase also landed in stock');

select is(
  (public.rpc_purchase_supplies(
     (select id from _i), (select warehouse from _f), 100, 2.5,
     (select account from _f), current_date, 'شراء خيط', 'buy-1') ->> 'amount')::numeric,
  250.00, 'replaying the same purchase key is accepted');

select is(
  (select balance from public.v_account_balances where code = 'CASH1'),
  49750.00::numeric, 'a replayed purchase does not spend twice');

select is(
  (select quantity from public.v_stock_balances
    where item_id = (select id from _i) and ownership = 'factory'),
  100.000::numeric, 'a replayed purchase does not double the stock');

-- ---------------------------------------------------------------- customer supplies
select is(
  (public.rpc_receive_customer_supplies(
     (select id from _i), (select warehouse from _f),
     (select customer from _c), 40, current_date, 'خيط العميل') ->> 'id') is not null,
  true, 'customer-owned supplies can be received');

select is(
  (select balance from public.v_account_balances where code = 'CASH1'),
  49750.00::numeric, 'customer supplies carry no cost');

select is(
  (select quantity from public.v_stock_balances
    where item_id = (select id from _i) and ownership = 'customer'
      and customer_id = (select customer from _c)),
  40.000::numeric, 'customer stock is tracked separately from factory stock');

select throws_ok(
  format($$ select public.rpc_receive_customer_supplies(%L::uuid, %L::uuid, null, 10) $$,
    (select id from _i), (select warehouse from _f)),
  'P0001', 'E_CUSTOMER_REQUIRED', 'customer supplies must name the customer');

-- ---------------------------------------------------------------- issuing
select is(
  (public.rpc_issue_supplies(
     (select id from _i), (select warehouse from _f), 30) ->> 'id') is not null,
  true, 'factory supplies can be issued');

select is(
  (select quantity from public.v_stock_balances
    where item_id = (select id from _i) and ownership = 'factory'),
  70.000::numeric, 'issuing 30 leaves 70 in stock');

select throws_ok(
  format($$ select public.rpc_issue_supplies(%L::uuid, %L::uuid, 500) $$,
    (select id from _i), (select warehouse from _f)),
  'P0001', 'E_OVER_ISSUE — 70.000', 'issuing more than is in stock is refused');

select is(
  (public.rpc_issue_supplies(
     (select id from _i), (select warehouse from _f), 40, 'customer',
     (select customer from _c)) ->> 'id') is not null,
  true, 'customer supplies are issued against that customer');

select is(
  (select quantity from public.v_stock_balances
    where item_id = (select id from _i) and ownership = 'customer'),
  0.000::numeric, 'customer stock reaches zero after issuing it all');

select throws_ok(
  format($$ select public.rpc_issue_supplies(%L::uuid, %L::uuid, 1, 'customer') $$,
    (select id from _i), (select warehouse from _f)),
  'P0001', 'E_CUSTOMER_REQUIRED', 'issuing customer stock without a customer is refused');

-- ---------------------------------------------------------------- ledger shape
select is(
  (select count(*) from public.inventory_transactions
    where item_id = (select id from _i) and movement = 'purchase')::int,
  1, 'the replayed purchase wrote one ledger row');

select is(
  (select received_quantity from public.v_stock_balances
    where item_id = (select id from _i) and ownership = 'factory'),
  100.000::numeric, 'the balance view reports what came in');

select is(
  (select issued_quantity from public.v_stock_balances
    where item_id = (select id from _i) and ownership = 'factory'),
  30.000::numeric, 'the balance view reports what went out');

-- ---------------------------------------------------------------- warehouses
-- The default kind must satisfy warehouses_kind_check; 'factory' is not a legal
-- kind and made the plain "add warehouse" call fail on the constraint.
do $$
begin
  perform public.rpc_create_warehouse('مخزن اختبار');
exception when others then
  raise exception 'default warehouse kind was rejected: %', sqlerrm;
end $$;

select is(
  (select kind from public.warehouses where name = 'مخزن اختبار'),
  'factory_consumables', 'the default warehouse kind is a legal one');

select throws_ok(
  $$ select public.rpc_create_warehouse('مخزن غلط', 'factory') $$,
  'P0001', 'E_BAD_KIND — factory', 'an unknown warehouse kind is refused with a clear code');

select * from finish();
rollback;
