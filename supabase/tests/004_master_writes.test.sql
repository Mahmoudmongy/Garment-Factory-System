-- Master-data write paths: accounts, items, warehouses, machines, employees.
-- These all had a create-or-nothing surface; the update RPCs and account
-- creation are covered here.
begin;
select plan(18);

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ---------------------------------------------------------------- accounts
create temp table _a as
  select (public.rpc_create_account('خزنة اختبار', 'cash', 750) ->> 'id')::uuid as id;

select ok((select id from _a) is not null, 'a cash account can be created');

select is(
  (select code from public.financial_accounts where id = (select id from _a)),
  'ACC0001', 'the account continues the ACC series');

select is(
  (select opening_balance from public.financial_accounts where id = (select id from _a)),
  750.00::numeric, 'the opening balance is stored as given');

select is(
  (select balance from public.v_account_balances where id = (select id from _a)),
  750.00::numeric, 'the balance view reflects the opening balance');

select is(
  (select kind from public.financial_accounts where id = (select id from _a)),
  'cash', 'the kind defaults to cash');

select throws_ok(
  $$ select public.rpc_create_account('بنك غلط', 'crypto') $$,
  'P0001', 'E_BAD_KIND — crypto', 'an unknown account kind is refused');

select throws_ok(
  $$ select public.rpc_create_account('   ') $$,
  'P0001', 'E_NAME_REQUIRED', 'a blank account name is refused');

-- renaming keeps the untouched columns intact
select is(
  (public.rpc_update_account((select id from _a), 'خزنة بعد التعديل') ->> 'ok')::boolean,
  true, 'an account can be renamed');

select is(
  (select name from public.financial_accounts where id = (select id from _a)),
  'خزنة بعد التعديل', 'the new name is stored');

select is(
  (select kind from public.financial_accounts where id = (select id from _a)),
  'cash', 'renaming does not disturb the kind');

select throws_ok(
  $$ select public.rpc_update_account('00000000-0000-0000-0000-000000000000', 'x') $$,
  'P0001', 'E_NOT_FOUND — account', 'updating a missing account says so');

-- ---------------------------------------------------------------- items
create temp table _i as
  select (public.rpc_create_item('قماش تجريبي', 'fabric', 'متر') ->> 'id')::uuid as id;

select is(
  (public.rpc_update_item((select id from _i), 'قماش قطن', null, 'كيلو') ->> 'ok')::boolean,
  true, 'an item can be edited');

select is(
  (select name || ' / ' || base_unit from public.items where id = (select id from _i)),
  'قماش قطن / كيلو', 'name and unit both changed');

select is(
  (select category from public.items where id = (select id from _i)),
  'fabric', 'omitting a field leaves it alone');

-- ---------------------------------------------------------------- warehouses
create temp table _w as
  select (public.rpc_create_warehouse('مخزن تعديل', 'finished_goods') ->> 'id')::uuid as id;

select is(
  (public.rpc_update_warehouse((select id from _w), 'مخزن التام') ->> 'ok')::boolean,
  true, 'a warehouse can be renamed');

select throws_ok(
  $$ select public.rpc_update_warehouse(
       (select id from public.warehouses where code = 'WH02'), null, 'factory') $$,
  'P0001', 'E_BAD_KIND — factory', 'an illegal warehouse kind is refused on update too');

-- ---------------------------------------------------------------- audit trail
select is(
  (select count(*)::int from public.audit_log
    where table_name = 'financial_accounts' and row_pk = (select id from _a)::text
      and action = 'insert'),
  1, 'creating an account is written to the audit log');

select is(
  (select count(*)::int from public.audit_log
    where table_name = 'items' and row_pk = (select id from _i)::text and action = 'update'),
  1, 'editing an item is written to the audit log');

select * from finish();
rollback;
