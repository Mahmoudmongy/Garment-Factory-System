-- 001_foundation.test.sql — pgTAP tests for the Foundation.
-- Run:  supabase test db        (local stack)   — requires the pgtap extension.
-- STATUS: WRITTEN BUT NEVER EXECUTED (no Postgres was available when authored). Expect to fix typos on first run.
--
-- Pattern: tests.val_as(uid, sql) runs `sql` as an authenticated user (JWT sub = uid) and returns the
-- single value as text, or 'ERR:<sqlstate>' if it raised. Assertions themselves run as the superuser.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create schema if not exists tests;
create table tests.ctx (k text primary key, v text);
create function tests.c(p_k text) returns text language sql stable as $$ select v from tests.ctx where k = p_k $$;

create function tests.val_as(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v text; v_orig text := current_user;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql into v;
  exception when others then
    perform set_config('role', v_orig, true);
    return 'ERR:' || sqlstate;
  end;
  perform set_config('role', v_orig, true);
  return v;
end $$;

create function tests.val_as_anon(p_sql text) returns text language plpgsql as $$
declare v text; v_orig text := current_user;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'anon', true);
  begin
    execute p_sql into v;
  exception when others then
    perform set_config('role', v_orig, true);
    return 'ERR:' || sqlstate;
  end;
  perform set_config('role', v_orig, true);
  return v;
end $$;

-- ------------------------------------------------------------------ fixtures
-- a1 admin | a2 clerk (no role) | a3 accountant | a4 viewer (deactivated later) | a5 second admin
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1', 'admin@factory.internal'),
 ('00000000-0000-0000-0000-0000000000a2', 'clerk@factory.internal'),
 ('00000000-0000-0000-0000-0000000000a3', 'acct@factory.internal'),
 ('00000000-0000-0000-0000-0000000000a4', 'viewer@factory.internal'),
 ('00000000-0000-0000-0000-0000000000a5', 'admin2@factory.internal');

select public.fn_bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1', 'admin', 'Admin');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1',
  $$select public.rpc_create_profile('00000000-0000-0000-0000-0000000000a2','clerk','Clerk',null,array[]::text[])::text$$),
  '00000000-0000-0000-0000-0000000000a2', 'admin creates a profile with no role');
select tests.val_as('00000000-0000-0000-0000-0000000000a1',
  $$select public.rpc_create_profile('00000000-0000-0000-0000-0000000000a3','acct','Acct',null,array['accountant'])::text$$);
select tests.val_as('00000000-0000-0000-0000-0000000000a1',
  $$select public.rpc_create_profile('00000000-0000-0000-0000-0000000000a4','viewer','Viewer',null,array['viewer'])::text$$);
select tests.val_as('00000000-0000-0000-0000-0000000000a1',
  $$select public.rpc_create_profile('00000000-0000-0000-0000-0000000000a5','admin2','Admin2',null,array['admin'])::text$$);

-- ------------------------------------------------------------------ IDs / codes
insert into tests.ctx values ('cust1', tests.val_as('00000000-0000-0000-0000-0000000000a1',
  $$select public.rpc_create_customer('{"name":"شركة النور","op_letter":"N","phone":"01012345678"}'::jsonb)->>'id'$$));
insert into tests.ctx values ('cust2', tests.val_as('00000000-0000-0000-0000-0000000000a1',
  $$select public.rpc_create_customer('{"name":"مصنع الأمل"}'::jsonb)->>'id'$$));
select matches((select code from public.customers where id = tests.c('cust1')::uuid), '^CUS[0-9]{4,}$', 'customer code format CUS0001');
select isnt((select code from public.customers where id = tests.c('cust1')::uuid),
            (select code from public.customers where id = tests.c('cust2')::uuid), 'customer codes are distinct');
select matches((select op_letter from public.customers where id = tests.c('cust2')::uuid), '^[A-Z]$', 'auto-assigned operational letter');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1',
  $$select public.rpc_create_customer('{"name":"x","op_letter":"N"}'::jsonb)->>'id'$$), 'ERR:23505', 'duplicate operational letter rejected');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1',
  $$select public.rpc_create_customer('{"name":"x","op_letter":"L"}'::jsonb)->>'id'$$), 'ERR:23514', 'confusing letter (L) rejected');

select is(public.fn_generate_operational_code(tests.c('cust1')::uuid, 'L'), 'NL0001', 'operational code NL0001');
select is(public.fn_generate_operational_code(tests.c('cust1')::uuid, 'l'), 'NL0002', 'serial increments; size normalised');
select is(public.fn_generate_operational_code(tests.c('cust1')::uuid, 'M'), 'NM0001', 'serial is per customer+size');
select throws_ok($$select public.fn_generate_operational_code(null::uuid, 'X L')$$, '22023', null, 'size with a space is rejected');
select throws_ok($$insert into public.operational_codes(code,customer_id,letter,size,serial)
  values ('NL0001','$$ || tests.c('cust1') || $$','N','L',1)$$, '23505', null, 'duplicate operational code blocked by DB');
select is(public.fn_next_code('PO'), 'PO' || lpad(currval('public.seq_production_order')::text, 4, '0'), 'PO code format');
select throws_ok($$select public.fn_next_code('ZZZ')$$, '22023', null, 'unknown code prefix rejected');

-- ------------------------------------------------------------------ permissions
select is(tests.val_as('00000000-0000-0000-0000-0000000000a2', $$select public.rpc_create_customer('{"name":"y"}'::jsonb)::text$$),
  'ERR:42501', 'user without permission cannot call RPC directly');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a2', $$select count(*)::text from public.customers$$), '0', 'RLS hides customers from user without customer.view');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a2',
  $$insert into public.customers(name,op_letter) values ('z','Z')$$), 'ERR:42501', 'direct INSERT into table is denied');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a2', $$update public.customers set name='hack'$$), 'ERR:42501', 'direct UPDATE is denied');
select is(tests.val_as_anon($$select public.rpc_my_permissions()::text$$), 'ERR:42501', 'anon cannot call RPC');
select is(tests.val_as_anon($$select count(*)::text from public.customers$$), 'ERR:42501', 'anon cannot read tables');

select tests.val_as('00000000-0000-0000-0000-0000000000a1',
  $$select public.rpc_set_user_permission('00000000-0000-0000-0000-0000000000a2','customer.view','grant','test grant')::text$$);
select is(tests.val_as('00000000-0000-0000-0000-0000000000a2', $$select count(*)::text from public.customers$$), '2', 'user-specific grant gives read access');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a2', $$select public.rpc_create_customer('{"name":"y"}'::jsonb)::text$$),
  'ERR:42501', 'view permission does not allow create');

select is(tests.val_as('00000000-0000-0000-0000-0000000000a3', $$select public.has_permission('inventory.view')::text$$), 'false', 'accountant lacks inventory.view by default');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a3', $$select public.has_permission('worker.payment.create')::text$$), 'true', 'role grants apply');
select tests.val_as('00000000-0000-0000-0000-0000000000a1',
  $$select public.rpc_set_user_permission('00000000-0000-0000-0000-0000000000a3','worker.payment.create','deny','test deny')::text$$);
select is(tests.val_as('00000000-0000-0000-0000-0000000000a3', $$select public.has_permission('worker.payment.create')::text$$), 'false', 'user deny overrides role grant');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1', $$select ('customer.create' = any(public.rpc_my_permissions()))::text$$), 'true', 'admin has all permissions');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1', $$select public.has_permission('no.such_key')::text$$), 'false', 'unknown permission key is false even for admin');

-- escalation: non-admin with system.user.manage cannot hand out the admin role
select tests.val_as('00000000-0000-0000-0000-0000000000a1',
  $$select public.rpc_set_user_permission('00000000-0000-0000-0000-0000000000a2','system.user.manage','grant','test')::text$$);
select is(tests.val_as('00000000-0000-0000-0000-0000000000a2',
  $$select public.rpc_assign_role('00000000-0000-0000-0000-0000000000a4','admin','x escalation')::text$$), 'ERR:42501', 'non-admin cannot grant admin role');

-- inactive user
select tests.val_as('00000000-0000-0000-0000-0000000000a1',
  $$select public.rpc_set_profile_active('00000000-0000-0000-0000-0000000000a4', false, 'test deactivate')::text$$);
select is(tests.val_as('00000000-0000-0000-0000-0000000000a4', $$select count(*)::text from public.customers$$), '0', 'inactive user sees nothing');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a4', $$select public.has_permission('customer.view')::text$$), 'false', 'inactive user has no permissions');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a4', $$select cardinality(public.rpc_my_permissions())::text$$), '0', 'inactive user: empty permission list');

-- ------------------------------------------------------------------ financial
insert into tests.ctx values ('acc1', tests.val_as('00000000-0000-0000-0000-0000000000a1',
  $$select public.rpc_create_financial_account('{"name":"خزنة المصنع","account_type":"cash","opening_balance":1000}'::jsonb)->>'id'$$));
select matches((select code from public.financial_accounts where id = tests.c('acc1')::uuid), '^ACC[0-9]{4,}$', 'account code format');
select is((select current_balance from public.v_account_balances where account_id = tests.c('acc1')::uuid), 1000.00::numeric, 'balance = opening balance');
insert into tests.ctx values ('tx1', tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_post_manual_transaction(%L::uuid,'out',300,current_date,'test spend','key-out-0001')->>'id'$$, tests.c('acc1'))));
select is((select current_balance from public.v_account_balances where account_id = tests.c('acc1')::uuid), 700.00::numeric, 'balance computed from transactions');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_post_manual_transaction(%L::uuid,'out',300,current_date,'test spend','key-out-0001')->>'replayed'$$, tests.c('acc1'))),
  'true', 'same idempotency key + same payload = replay');
select is((select count(*)::int from public.financial_transactions where account_id = tests.c('acc1')::uuid), 1, 'replay did not duplicate');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_post_manual_transaction(%L::uuid,'out',999,current_date,'test spend','key-out-0001')::text$$, tests.c('acc1'))),
  'ERR:F0001', 'same key + different payload rejected');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_post_manual_transaction(%L::uuid,'out',800,current_date,'too much','key-out-0002')::text$$, tests.c('acc1'))),
  'ERR:F0002', 'overdraw blocked');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a2',
  format($$select public.rpc_post_manual_transaction(%L::uuid,'in',5,current_date,'nope nope','key-in-0001')::text$$, tests.c('acc1'))),
  'ERR:42501', 'transaction RPC needs permission');
select throws_ok(format($$select public.fn_post_financial_transaction(%L::uuid,'in',50,current_date,'customer_payment',null,'x','key-cp-0001')$$, tests.c('acc1')),
  '23514', null, 'typed transaction requires a source_id (DB constraint)');
select throws_ok(format($$update public.financial_transactions set amount = 1 where id = %L$$, tests.c('tx1')), 'F0006', null, 'ledger row cannot be updated');
select throws_ok(format($$delete from public.financial_transactions where id = %L$$, tests.c('tx1')), 'F0006', null, 'ledger row cannot be deleted');
select throws_ok(format($$update public.financial_accounts set opening_balance = 5 where id = %L$$, tests.c('acc1')), 'F0006', null, 'opening balance locked after first transaction');

insert into tests.ctx values ('rev1', tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_reverse_financial_transaction(%L::uuid,'entered by mistake','key-rev-0001')->>'id'$$, tests.c('tx1'))));
select is((select current_balance from public.v_account_balances where account_id = tests.c('acc1')::uuid), 1000.00::numeric, 'reversal restores balance');
select is((select count(*)::int from public.financial_transactions where account_id = tests.c('acc1')::uuid), 2, 'original + reversal both kept (history preserved)');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_reverse_financial_transaction(%L::uuid,'again again','key-rev-0002')::text$$, tests.c('tx1'))),
  'ERR:F0005', 'a transaction can only be reversed once');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_reverse_financial_transaction(%L::uuid,'rev of rev','key-rev-0003')::text$$, tests.c('rev1'))),
  'ERR:F0005', 'a reversal cannot be reversed');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_reverse_financial_transaction(%L::uuid,'','key-rev-0004')::text$$, tests.c('tx1'))), 'ERR:22023', 'reversal requires a reason');

-- ------------------------------------------------------------------ inventory
insert into tests.ctx values ('wh1', tests.val_as('00000000-0000-0000-0000-0000000000a1', $$select public.rpc_create_warehouse('{"name":"مخزن 1","kind":"factory_consumables"}'::jsonb)->>'id'$$));
insert into tests.ctx values ('wh2', tests.val_as('00000000-0000-0000-0000-0000000000a1', $$select public.rpc_create_warehouse('{"name":"مخزن 2","kind":"other"}'::jsonb)->>'id'$$));
insert into tests.ctx values ('wh3', tests.val_as('00000000-0000-0000-0000-0000000000a1', $$select public.rpc_create_warehouse('{"name":"مخزن 3","kind":"other"}'::jsonb)->>'id'$$));
insert into tests.ctx values ('item1', tests.val_as('00000000-0000-0000-0000-0000000000a1', $$select public.rpc_create_item('{"name":"خيط أبيض","category":"thread","base_unit":"cone"}'::jsonb)->>'id'$$));
select matches((select code from public.items where id = tests.c('item1')::uuid), '^ITM[0-9]{4,}$', 'item code format');
select matches((select code from public.warehouses where id = tests.c('wh1')::uuid), '^WH[0-9]{4,}$', 'warehouse code format');

insert into tests.ctx values ('rc1', tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_post_inventory_transaction('receipt',%L::uuid,%L::uuid,100,current_date,'factory',null,110,'buy','inv-rc-0001')->>'id'$$, tests.c('item1'), tests.c('wh1'))));
select is((select quantity from public.v_stock_balances where item_id = tests.c('item1')::uuid and warehouse_id = tests.c('wh1')::uuid), 100.000::numeric, 'stock = receipts');
select is((select count(*)::int from public.item_cost_history where item_id = tests.c('item1')::uuid), 1, 'cost history row written on receipt');
select tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_post_inventory_transaction('issue',%L::uuid,%L::uuid,30,current_date,'factory',null,null,'use','inv-is-0001')::text$$, tests.c('item1'), tests.c('wh1')));
select is((select quantity from public.v_stock_balances where item_id = tests.c('item1')::uuid and warehouse_id = tests.c('wh1')::uuid), 70.000::numeric, 'stock after issue');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_post_inventory_transaction('issue',%L::uuid,%L::uuid,80,current_date,'factory',null,null,'use','inv-is-0002')::text$$, tests.c('item1'), tests.c('wh1'))),
  'ERR:F0003', 'negative stock prevented');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_post_inventory_transaction('issue',%L::uuid,%L::uuid,30,current_date,'factory',null,null,'use','inv-is-0001')->>'replayed'$$, tests.c('item1'), tests.c('wh1'))),
  'true', 'inventory idempotent replay');
select is((select quantity from public.v_stock_balances where item_id = tests.c('item1')::uuid and warehouse_id = tests.c('wh1')::uuid), 70.000::numeric, 'replay did not change stock');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_post_inventory_transaction('receipt',%L::uuid,%L::uuid,5,current_date,'customer',null,null,'x','inv-rc-0002')::text$$, tests.c('item1'), tests.c('wh1'))),
  'ERR:23514', 'customer-owned stock requires a customer');
select tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_post_inventory_transaction('receipt',%L::uuid,%L::uuid,50,current_date,'customer',%L::uuid,null,'cust fabric','inv-rc-0003')::text$$, tests.c('item1'), tests.c('wh1'), tests.c('cust1')));
select is((select quantity from public.v_stock_balances where item_id = tests.c('item1')::uuid and warehouse_id = tests.c('wh1')::uuid and ownership = 'factory'), 70.000::numeric, 'customer-owned stock is kept separate from factory stock');
select is((select quantity from public.v_stock_balances where item_id = tests.c('item1')::uuid and ownership = 'customer' and customer_id = tests.c('cust1')::uuid), 50.000::numeric, 'customer-owned balance per customer');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_reverse_inventory_transaction(%L::uuid,'wrong receipt','inv-rv-0001')::text$$, tests.c('rc1'))),
  'ERR:F0003', 'reversing a receipt that was already partly consumed would go negative => blocked');
select throws_ok(format($$update public.inventory_transactions set quantity = 1 where id = %L$$, tests.c('rc1')), 'F0006', null, 'inventory ledger is append-only');

update public.warehouses set is_active = false where id = tests.c('wh2')::uuid;
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_transfer_inventory(%L::uuid,%L::uuid,%L::uuid,10,current_date,'factory',null,'xfer-fail-0001')::text$$, tests.c('item1'), tests.c('wh1'), tests.c('wh2'))),
  'ERR:F0009', 'transfer to an inactive warehouse fails');
select is((select count(*)::int from public.inventory_transactions where idempotency_key like 'xfer-fail-0001%'), 0, 'failed transfer rolled back completely (atomicity)');
select tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_transfer_inventory(%L::uuid,%L::uuid,%L::uuid,10,current_date,'factory',null,'xfer-ok-00001')::text$$, tests.c('item1'), tests.c('wh1'), tests.c('wh3')));
select is((select quantity from public.v_stock_balances where item_id = tests.c('item1')::uuid and warehouse_id = tests.c('wh3')::uuid), 10.000::numeric, 'transfer: destination +10');
select is((select quantity from public.v_stock_balances where item_id = tests.c('item1')::uuid and warehouse_id = tests.c('wh1')::uuid and ownership = 'factory'), 60.000::numeric, 'transfer: source -10');

-- ------------------------------------------------------------------ audit
select tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_update_customer(%L::uuid,'{"name":"النور للتصنيع"}'::jsonb,'تصحيح الاسم')::text$$, tests.c('cust1')));
select is((select count(*)::int from public.audit_log
            where entity_type = 'customers' and entity_id = tests.c('cust1') and action = 'update'
              and old_values ->> 'name' = 'شركة النور' and new_values ->> 'name' = 'النور للتصنيع'
              and reason = 'تصحيح الاسم' and user_id = '00000000-0000-0000-0000-0000000000a1'
              and occurred_at > now() - interval '5 minutes'), 1, 'audit row has user, old, new, reason, timestamp');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1',
  format($$select public.rpc_update_customer(%L::uuid,'{"name":"w"}'::jsonb,'')::text$$, tests.c('cust1'))), 'ERR:22023', 'edit without reason rejected');
select is((select count(*)::int from public.audit_log where entity_type = 'financial_transactions'), 2, 'ledger inserts are audited');
select throws_ok($$update public.audit_log set action = 'x'$$, 'F0006', null, 'audit log cannot be updated (even by superuser)');
select throws_ok($$delete from public.audit_log$$, 'F0006', null, 'audit log cannot be deleted');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1', $$delete from public.audit_log$$), 'ERR:42501', 'authenticated has no DELETE privilege on audit_log');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a2', $$select count(*)::text from public.audit_log$$), '0', 'user without audit.view sees no audit rows');
select cmp_ok(tests.val_as('00000000-0000-0000-0000-0000000000a1', $$select count(*)::text from public.audit_log$$)::int, '>', 0, 'admin sees audit rows');

-- ------------------------------------------------------------------ admin safety (keep LAST)
select is(tests.val_as('00000000-0000-0000-0000-0000000000a1',
  $$select public.rpc_revoke_role('00000000-0000-0000-0000-0000000000a1','admin','self demote')::text$$), 'ERR:F0004', 'admin cannot remove own admin role');
select tests.val_as('00000000-0000-0000-0000-0000000000a5',
  $$select public.rpc_revoke_role('00000000-0000-0000-0000-0000000000a1','admin','second admin removes first')::text$$);
select is(public.fn_active_admin_count(), 1, 'exactly one admin remains');
select is(tests.val_as('00000000-0000-0000-0000-0000000000a5',
  $$select public.rpc_set_profile_active('00000000-0000-0000-0000-0000000000a5', false, 'deactivate last admin')::text$$), 'ERR:F0004', 'cannot deactivate the last admin');
select throws_ok($$delete from public.user_roles where profile_id = '00000000-0000-0000-0000-0000000000a5'$$, 'F0004', null, 'cannot delete the last admin role assignment');
select throws_ok($$update public.roles set is_superuser = false where code = 'admin'$$, 'F0004', null, 'admin role flag is protected');
select throws_ok($$delete from public.profiles where id = '00000000-0000-0000-0000-0000000000a5'$$, 'F0006', null, 'profiles cannot be deleted');

select * from finish();
rollback;
