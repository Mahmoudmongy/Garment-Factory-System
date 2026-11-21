-- Bundle queue: size ordering, size-only cutting, per-bundle stage gating, delivery.
begin;
select plan(30);

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ---------------------------------------------------------------- size ordering
select is(public.fn_size_rank('XS'), 20, 'XS sorts first among letter sizes');
select is(public.fn_size_rank('M'), 40, 'M sits between S and L');
select is(public.fn_size_rank('L'), 50, 'L after M');
select is(public.fn_size_rank('XL'), 60, 'XL after L');
select is(public.fn_size_rank('2XL'), 70, '2XL shares the XXL rank');
select is(public.fn_size_rank('38'), 238, 'numeric sizes sort after letter sizes, by value');
select is(public.fn_size_rank(''), 999, 'a missing size sorts last');
select ok(public.fn_size_rank('S') < public.fn_size_rank('M'), 'S before M');
select ok(public.fn_size_rank('M') < public.fn_size_rank('L'), 'M before L');

-- ---------------------------------------------------------------- fixtures
select public.rpc_create_customer('عميل الترتيب', null, 'Q');
select public.rpc_create_employee('صنايعي الترتيب', 'worker', 'خياط');

create temp table _po as
  select (public.rpc_create_production_order(
            (select id from public.customers where operating_letter = 'Q'),
            'تيشيرت', 120, 50,
            'aaaaaaaa-0000-0000-0000-000000000001',
            current_date + 5, null)) as r;

-- ---------------------------------------------------------------- size-only cutting
select is(
  (public.rpc_execute_cutting(
     (select id from public.production_orders where code = 'PO0001'),
     '[{"colour":"","size":"M","quantity":20},
       {"colour":"","size":"L","quantity":20},
       {"colour":"","size":"XL","quantity":20}]'::jsonb, 20, null, null, false) ->> 'bundles')::int,
  3, 'size-only cutting makes one bundle per size');

select is(
  (select count(*) from public.bundles
    where order_id = (select id from public.production_orders where code = 'PO0001')
      and coalesce(colour, '') = '')::int,
  3, 'size-only bundles carry no colour');

select is(
  (select has_colour from public.v_bundles
    where order_id = (select id from public.production_orders where code = 'PO0001') limit 1),
  false, 'bundle view flags a colourless bundle');

select is(
  (select colour_label from public.v_bundles
    where order_id = (select id from public.production_orders where code = 'PO0001') limit 1),
  null, 'colour label stays null instead of empty text');

select is(
  (select array_agg(size order by size_rank) from public.v_bundles
    where order_id = (select id from public.production_orders where code = 'PO0001')),
  array['M','L','XL'], 'bundles read in size order, not alphabetically');

-- ---------------------------------------------------------------- colour cutting
select is(
  (public.rpc_execute_cutting(
     (select id from public.production_orders where code = 'PO0001'),
     '[{"colour":"ابيض","size":"L","quantity":20},
       {"colour":"كحلي","size":"L","quantity":20}]'::jsonb, 20, null, null, true) ->> 'bundles')::int,
  2, 'colour cutting adds one bundle per colour');

select is(
  (select count(*) from public.bundles
    where order_id = (select id from public.production_orders where code = 'PO0001')
      and coalesce(colour, '') <> '')::int,
  2, 'coloured bundles keep their colour');

select is(
  (select has_colour from public.v_bundles
    where order_id = (select id from public.production_orders where code = 'PO0001')
      and colour = 'ابيض'),
  true, 'bundle view flags a coloured bundle');

-- ---------------------------------------------------------------- queue shape
select is(
  (select count(*) from public.v_bundle_queue
    where order_id = (select id from public.production_orders where code = 'PO0001'))::int,
  5 * (select count(*) from public.production_order_stages
        where order_id = (select id from public.production_orders where code = 'PO0001'))::int,
  'the queue has one row per bundle and stage');

select is(
  (select count(distinct bundle_id) from public.v_bundle_queue
    where order_id = (select id from public.production_orders where code = 'PO0001'))::int,
  5, 'the queue de-duplicates to five bundles');

select is(
  (select count(*) from public.v_bundle_queue
    where order_id = (select id from public.production_orders where code = 'PO0001')
      and stage_code = 'assembly' and deps_done)::int,
  0, 'a dependent stage is not ready before its predecessors');

-- ---------------------------------------------------------------- per-bundle gating
create temp table _b as
  select id, code from public.bundles
   where order_id = (select id from public.production_orders where code = 'PO0001')
     and size = 'M';

select public.rpc_assign_bundle(
  (select id from _b), 'collar',
  (select id from public.employees where name = 'صنايعي الترتيب'));

select is(
  (select count(*) from public.v_bundle_queue
    where bundle_id = (select id from _b) and stage_code = 'collar'
      and open_assignment is not null)::int,
  1, 'an assigned bundle shows an open assignment');

select public.rpc_receive_work(
  (select id from public.work_assignments
    where bundle_id = (select id from _b) and stage_code = 'collar'
      and received_at is null),
  20, 0, 0, null);

select is(
  (select stage_done from public.v_bundle_queue
    where bundle_id = (select id from _b) and stage_code = 'collar'),
  true, 'the received stage reads as done for that bundle');

select is(
  (select count(*) from public.v_bundle_queue
    where bundle_id = (select id from _b) and stage_code = 'assembly' and deps_done)::int,
  0, 'assembly still waits: chest and back are untouched for this bundle');

-- ---------------------------------------------------------------- delivery
update public.bundles set status = 'finished'
 where order_id = (select id from public.production_orders where code = 'PO0001')
   and size = 'L' and coalesce(colour, '') = '';

select is(
  (select ready_quantity from public.v_production_orders where code = 'PO0001'),
  20::numeric, 'only finished bundles count as ready');

select throws_ok(
  format($$ select public.rpc_create_delivery(%L::uuid, %L::jsonb) $$,
    (select id from public.production_orders where code = 'PO0001'),
    '[{"colour":"","size":"L","quantity":999}]'),
  'P0001', 'E_OVER_DELIVERY — 20', 'cannot ship more than is finished');

select is(
  (public.rpc_create_delivery(
     (select id from public.production_orders where code = 'PO0001'),
     '[{"colour":"","size":"L","quantity":20}]'::jsonb) ->> 'code'),
  'DLV0001', 'a valid permit is created');

select is(
  (select status from public.bundles
    where order_id = (select id from public.production_orders where code = 'PO0001')
      and size = 'L' and coalesce(colour, '') = ''),
  'delivered', 'shipping the bundle marks it delivered');

select is(
  (select ready_quantity from public.v_production_orders where code = 'PO0001'),
  0::numeric, 'a delivered bundle is no longer ready');

select throws_ok(
  format($$ select public.rpc_create_delivery(%L::uuid, %L::jsonb) $$,
    (select id from public.production_orders where code = 'PO0001'),
    '[{"colour":"","size":"L","quantity":20}]'),
  'P0001', 'E_OVER_DELIVERY — 0', 'the same pieces cannot be shipped twice');

-- ---------------------------------------------------------------- timeline wording
select ok(
  (select description from public.v_order_timeline
    where order_id = (select id from public.production_orders where code = 'PO0001')
      and kind = 'cut' and description like '%/ M' limit 1) not like '%  / %',
  'a size-only cut has no empty colour gap in the timeline');

select * from finish();
rollback;
