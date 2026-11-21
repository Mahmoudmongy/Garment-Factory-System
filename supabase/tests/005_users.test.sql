-- User administration and the row security that goes with it.
--
-- Two classes of assertion here: the RPC surface (create a login, assign roles,
-- override one permission, refuse the unsafe cases) and the isolation itself —
-- that a worker can read their own pay and nothing else, which is the rule the
-- whole feature exists to satisfy.
begin;
select plan(43);

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ---------------------------------------------------------------- fixtures
create temp table _w as
  select (public.rpc_create_employee('صنايعي اختبار أ', 'worker', 'خياط') ->> 'id')::uuid as id;
create temp table _w2 as
  select (public.rpc_create_employee('صنايعي اختبار ب', 'worker', 'أوفر') ->> 'id')::uuid as id;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ua@factory.internal'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'ub@factory.internal');

-- ---------------------------------------------------------------- create profile
create temp table _pa as
  select public.rpc_create_profile(
    'aaaaaaaa-0000-0000-0000-000000000001', 'usera', 'مستخدم أ',
    (select id from _w), array['worker']) as r;

select ok((select r ->> 'id' from _pa) is not null, 'a profile can be created for an auth user');

select is(
  (select display_name from public.profiles where username = 'usera'),
  'مستخدم أ', 'the display name is stored as given');

select is(
  (select employee_id from public.profiles where username = 'usera'),
  (select id from _w), 'the profile is linked to the employee');

select is(
  (select jsonb_array_length(roles) from public.v_users where username = 'usera'),
  1, 'the assigned role is recorded');

-- An employee may only carry one login; a second would make the pay ledger ambiguous.
select throws_ok(
  $$select public.rpc_create_profile(
      'aaaaaaaa-0000-0000-0000-000000000002', 'userb', 'مستخدم ب',
      (select id from _w), array['worker'])$$,
  'P0001', 'E_EMPLOYEE_HAS_LOGIN',
  'a second login cannot be attached to the same employee');

select throws_ok(
  $$select public.rpc_create_profile(
      'aaaaaaaa-0000-0000-0000-000000000002', 'usera', 'مكرر', null, array['worker'])$$,
  'P0001', 'E_USERNAME_TAKEN — %',
  'a duplicate username is refused');

select throws_ok(
  $$select public.rpc_create_profile(
      'aaaaaaaa-0000-0000-0000-000000000002', 'Bad Name!', 'سيء', null, array['worker'])$$,
  'P0001', 'E_USERNAME_INVALID — %',
  'a username with spaces or symbols is refused');

select throws_ok(
  $$select public.rpc_create_profile(
      'aaaaaaaa-0000-0000-0000-000000000002', 'ab', 'قصير', null, array['worker'])$$,
  'P0001', 'E_USERNAME_INVALID — %',
  'a username shorter than three characters is refused');

-- ---------------------------------------------------------------- roles
select ok(
  (public.rpc_set_user_roles(
     (select id from public.profiles where username = 'usera'), array['worker','foreman'])
   ->> 'ok')::boolean,
  'roles can be replaced in one call');

select is(
  (select jsonb_array_length(roles) from public.v_users where username = 'usera'),
  2, 'both roles are present after the replace');

select throws_ok(
  $$select public.rpc_set_user_roles(
      (select id from public.profiles where username = 'usera'), array[]::text[])$$,
  'P0001', 'E_ROLE_REQUIRED',
  'stripping every role is refused, so a login never ends up inert');

-- ---------------------------------------------------------------- overrides
select ok(
  (public.rpc_set_user_permissions(
     (select id from public.profiles where username = 'usera'),
     '{"inventory.view": false}'::jsonb) ->> 'ok')::boolean,
  'a permission override can be written');

select is(
  public.has_permission('inventory.view',
    (select id from public.profiles where username = 'usera')),
  false, 'a deny override beats the role grant');

select ok(
  (public.rpc_set_user_permissions(
     (select id from public.profiles where username = 'usera'),
     '{"reports.view": true}'::jsonb) ->> 'ok')::boolean,
  'a grant override can be written');

select is(
  public.has_permission('reports.view',
    (select id from public.profiles where username = 'usera')),
  true, 'a grant override adds a permission the role does not carry');

-- The RPC replaces the whole set rather than merging, so the earlier deny is gone.
-- This is deliberate: the screen always sends the complete matrix it shows.
select is(
  (select overrides from public.v_users where username = 'usera'),
  '{"reports.view": true}'::jsonb,
  'a second write replaces the override set instead of merging into it');

select ok(
  (public.rpc_set_user_permissions(
     (select id from public.profiles where username = 'usera'), '{}'::jsonb) ->> 'ok')::boolean,
  'sending an empty object clears the overrides');

select is(
  public.has_permission('inventory.view',
    (select id from public.profiles where username = 'usera')),
  true, 'after clearing, the role template applies again');

-- Self-escalation and self-lockout are the two ways an operator breaks their own access.
select throws_ok(
  $$select public.rpc_set_user_permissions(auth.uid(), '{"system.user.manage": true}'::jsonb)$$,
  'P0001', 'E_CANNOT_EDIT_OWN_PERMS',
  'a user cannot edit their own permission overrides');

select throws_ok(
  $$select public.rpc_update_profile(auth.uid(), null, false)$$,
  'P0001', 'E_CANNOT_DISABLE_SELF',
  'a user cannot deactivate their own login');

-- ---------------------------------------------------------------- role templates
select is(
  jsonb_array_length(public.rpc_role_templates()), 5,
  'the five seeded roles are offered as templates');

select ok(
  (select p -> 'perms' from jsonb_array_elements(public.rpc_role_templates()) p
    where p ->> 'key' = 'worker') @> '["worker.self.view"]'::jsonb,
  'the worker template carries the self-view permission');

select ok(
  (select p -> 'perms' from jsonb_array_elements(public.rpc_role_templates()) p
    where p ->> 'key' = 'worker') @> '["production.self_assign"]'::jsonb,
  'the worker template can claim work');

select ok(
  not ((select p -> 'perms' from jsonb_array_elements(public.rpc_role_templates()) p
         where p ->> 'key' = 'worker') ? 'worker.financial.view'),
  'the worker template cannot read other workers money');

-- ---------------------------------------------------------------- worker account
select ok(
  (public.rpc_worker_account(
     'aaaaaaaa-0000-0000-0000-000000000002', (select id from _w2), 'userb') ->> 'id') is not null,
  'a worker login can be created in one call');

select is(
  (select display_name from public.profiles where username = 'userb'),
  'صنايعي اختبار ب', 'the worker login defaults its display name to the employee name');

select is(
  (select roles from public.v_users where username = 'userb'),
  '["worker"]'::jsonb, 'the worker login is given the worker role by default');

select is(
  (select employee_id from public.profiles where username = 'userb'),
  (select id from _w2), 'the worker login is linked to its employee');

-- The RPC guard above can be bypassed by a direct insert, so the database itself
-- enforces the rule with a unique index. Without it two logins could share one
-- employee and the pay ledger would no longer say whose money it is.
select throws_ok(
  $$insert into public.profiles (id, username, employee_id, display_name)
    values ('aaaaaaaa-0000-0000-0000-000000000009', 'userb2',
            (select id from _w2), 'تاني')$$,
  '23505', null,
  'a unique index blocks a second profile for the same employee at the table level');

-- ---------------------------------------------------------------- audit
select cmp_ok(
  (select count(*) from public.audit_log where table_name = 'profiles'), '>=', 2,
  'creating a profile writes an audit row');

select cmp_ok(
  (select count(*) from public.audit_log where table_name = 'user_roles'), '>=', 2,
  'assigning a role writes an audit row, even though the table has no id column');

select cmp_ok(
  (select count(*) from public.audit_log where table_name = 'user_permissions'), '>=', 1,
  'writing an override writes an audit row');

-- ---------------------------------------------------------------- isolation
-- This is the rule the feature exists for: a worker sees their own pay, never a
-- colleague's. The policy is evaluated against the caller's JWT, so the assertions
-- run inside a transaction that switches identity.
select ok(
  (select reloptions from pg_class where relname = 'v_workers') @> array['security_invoker=true'],
  'v_workers runs with the caller''s privileges, not the owner''s');

select ok(
  (select reloptions from pg_class where relname = 'v_users') @> array['security_invoker=true'],
  'v_users runs with the caller''s privileges');

-- ---------------------------------------------------------------- as a worker
-- The isolation assertions need a pure worker: earlier in this suite usera was
-- also given the foreman role, and a foreman legitimately sees every assignment.
select public.rpc_set_user_roles(
  (select id from public.profiles where username = 'usera'), array['worker']);
select public.rpc_set_user_permissions(
  (select id from public.profiles where username = 'usera'), '{}'::jsonb);

-- RLS is bypassed for the superuser the runner connects as, so the isolation
-- assertions have to switch the session role as well as the JWT. set local keeps
-- both inside this transaction, so the suite stays re-runnable.
create temp table _ids as
  select (select id from _w2) as w2,
         (select id from public.profiles where username = 'usera') as pa;
grant select on _ids to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.v_workers), 1,
  'a worker sees exactly one row in v_workers: their own');

select is(
  (select count(*)::int from public.v_workers
    where id = (select w2 from _ids)), 0,
  'a worker does not see a colleague by id');

select is(
  (select count(*)::int from public.financial_transactions), 0,
  'a worker sees no cash rows at all until one is posted to them');

select is(
  (select count(*)::int from public.v_account_balances), 0,
  'a worker cannot read the drawer balances');

select is(
  public.has_permission('system.user.manage'), false,
  'a worker does not hold user administration');

select throws_ok(
  $$select public.rpc_create_employee('منتحل', 'worker')$$,
  'P0001', 'E_PERM — employee.create',
  'a worker cannot create employees');

-- ---------------------------------------------------------------- as the admin
reset role;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select cmp_ok(
  (select count(*)::int from public.v_workers), '>=', 2,
  'an administrator still sees every worker');

select cmp_ok(
  (select count(*)::int from public.v_account_balances), '>=', 1,
  'an administrator still sees the drawer balances');

select ok(
  public.has_permission('system.user.manage'),
  'an administrator holds user administration');

select * from finish();
rollback;
