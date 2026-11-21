-- 002_concurrency.setup.sql — fixtures for the multi-session race checks.
-- Driven by tools/run_concurrency_local.sh. Assertions live in the runner; this file only
-- builds the rows the parallel sessions fight over. Deliberately NOT one transaction:
-- the parallel sessions must see committed rows.
\set ON_ERROR_STOP on

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

create schema if not exists tests;
create table if not exists tests.cc (k text primary key, v text);
truncate tests.cc;

-- Keys must be unique per run: an idempotency key that already exists would replay instead of insert.
insert into tests.cc values ('run', replace(gen_random_uuid()::text, '-', ''))
on conflict (k) do update set v = excluded.v;

-- 100 on hand, so 20 parallel issues of 10 must yield exactly 10 successes.
insert into tests.cc values ('item', (select id::text from public.items where code = 'ITM0001'));
insert into tests.cc values ('wh', (select id::text from public.warehouses where code = 'WH01'));

-- The race needs the line to hold exactly 100, so 20 parallel issues of 10 must yield
-- exactly 10 successes. The demo seed already puts stock on this line, so a balancing
-- movement is posted instead of assuming a clean slate. Earlier runs are removed first
-- so a re-run cannot inflate the line.
delete from public.inventory_transactions
 where item_id = (select v::uuid from tests.cc where k = 'item')
   and warehouse_id = (select v::uuid from tests.cc where k = 'wh')
   and idempotency_key like 'cc-%';

insert into public.inventory_transactions
  (item_id, warehouse_id, quantity, ownership, movement, idempotency_key)
select
  (select v::uuid from tests.cc where k = 'item'),
  (select v::uuid from tests.cc where k = 'wh'),
  100 - coalesce(sum(quantity), 0), 'factory', 'adjustment',
  'cc-seed-' || (select v from tests.cc where k = 'run')
  from public.inventory_transactions
 where item_id = (select v::uuid from tests.cc where k = 'item')
   and warehouse_id = (select v::uuid from tests.cc where k = 'wh')
   and ownership = 'factory'
having 100 - coalesce(sum(quantity), 0) <> 0;

-- ---------------------------------------------------------------- session driver
-- Each parallel session calls this and prints one line. The exception handler is what makes
-- the race observable: a losing session returns its error code instead of aborting the script.
-- The block runs in its own subtransaction, so a caught error rolls back only that attempt.
create or replace function tests.cc_run(p_kind text, p_n text)
returns text language plpgsql as $$
declare v_item uuid; v_wh uuid; v_run text; v_out text;
begin
  select v::uuid into v_item from tests.cc where k = 'item';
  select v::uuid into v_wh   from tests.cc where k = 'wh';
  select v      into v_run  from tests.cc where k = 'run';

  if p_kind = 'stock' then
    perform public.rpc_issue_supplies(v_item, v_wh, 10, 'factory', null, null, null, null,
                                      'cc-stock-' || v_run || '-' || p_n);
    return 'OK';

  elsif p_kind = 'idempotent' then
    -- Same key and same payload from every session: exactly one must insert.
    if (public.rpc_move_stock(v_item, v_wh, 1, 'purchase', 'factory', null, null, 0, null,
                              'cc-idem-' || v_run) ->> 'replayed')::boolean
    then return 'REPLAY'; else return 'OK'; end if;
  end if;

  return 'UNKNOWN_KIND';
exception when others then
  -- fn_raise puts the code at the head of the message: "E_OVER_ISSUE — 100.000".
  v_out := split_part(sqlerrm, ' — ', 1);
  if v_out like 'E\_%' then return v_out; end if;
  return 'ERROR: ' || sqlerrm;
end $$;
