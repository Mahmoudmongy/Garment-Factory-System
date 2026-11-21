-- Demo data for local verification. Mirrors the shape of the reference app so the
-- screens have something to show. Safe to re-run: every insert is guarded.

set client_min_messages = warning;
-- The demo data is built through the same permission-checked RPCs the app uses,
-- so the seed has to sign in as the admin first.
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ---------------------------------------------------------------- admin login
insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'admin@factory.internal')
on conflict (id) do nothing;

insert into public.profiles (id, username, display_name, is_superuser)
values ('11111111-1111-1111-1111-111111111111', 'admin', 'المدير', true)
on conflict (id) do update set is_superuser = true, is_active = true;

-- a foreman login for permission testing
insert into auth.users (id, email)
values ('22222222-2222-2222-2222-222222222222', 'foreman@factory.internal')
on conflict (id) do nothing;

insert into public.profiles (id, username, display_name)
values ('22222222-2222-2222-2222-222222222222', 'foreman', 'رئيس العمال')
on conflict (id) do nothing;

insert into public.user_roles (profile_id, role_key)
values ('22222222-2222-2222-2222-222222222222', 'foreman')
on conflict do nothing;

-- ---------------------------------------------------------------- stage templates
insert into public.stage_templates (id, name_ar, is_default) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'قميص', true)
on conflict (id) do nothing;

insert into public.stage_template_stages
  (template_id, seq, name_ar, code, piece_price, depends_on, is_final)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 1, 'اللياقات', 'collar',  2.50, '{}', false),
  ('aaaaaaaa-0000-0000-0000-000000000001', 2, 'الصدر',    'chest',   2.00, '{}', false),
  ('aaaaaaaa-0000-0000-0000-000000000001', 3, 'الضهر',    'back',    2.00, '{}', false),
  ('aaaaaaaa-0000-0000-0000-000000000001', 4, 'التجميع',  'assembly',3.00, '{collar,chest,back}', false),
  ('aaaaaaaa-0000-0000-0000-000000000001', 5, 'التشطيب',  'finish',  2.00, '{assembly}', false),
  ('aaaaaaaa-0000-0000-0000-000000000001', 6, 'الكي',     'ironing', 1.50, '{finish}', false),
  ('aaaaaaaa-0000-0000-0000-000000000001', 7, 'الجودة',   'quality', 1.00, '{ironing}', true)
on conflict (template_id, code) do nothing;

-- ---------------------------------------------------------------- accounts, warehouses, items
insert into public.financial_accounts (id, code, name, kind, opening_balance) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'CASH1', 'الخزنة الرئيسية', 'cash', 50000),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'BANK1', 'البنك الأهلي', 'bank', 100000)
on conflict (id) do nothing;

insert into public.items (id, code, name, category, base_unit) values
  ('cccccccc-0000-0000-0000-000000000001', 'ITM0001', 'قماش قطن', 'fabric', 'متر'),
  ('cccccccc-0000-0000-0000-000000000002', 'ITM0002', 'خيط أبيض', 'thread', 'بكرة'),
  ('cccccccc-0000-0000-0000-000000000003', 'ITM0003', 'سوستة', 'zipper', 'قطعة')
on conflict (id) do nothing;

insert into public.warehouses (id, code, name, kind) values
  ('dddddddd-0000-0000-0000-000000000001', 'WH01', 'مخزن قماش العملاء', 'customer_fabric'),
  ('dddddddd-0000-0000-0000-000000000002', 'WH02', 'مخزن المستلزمات', 'factory_consumables'),
  ('dddddddd-0000-0000-0000-000000000003', 'WH03', 'مخزن التام', 'finished_goods')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- codes counter warm-up
-- The counters must start past the codes seeded above, or the first document the
-- user creates collides with a demo row (ITM0004 vs a fresh ITM0001).
insert into public.code_counters (prefix, last_value) values
  ('CUS', 0), ('W', 0), ('EMP', 0), ('PO', 0), ('BND', 0), ('DLV', 0), ('RET', 0),
  ('ITM', 3), ('WH', 3), ('MCH', 0), ('ACC', 0)
on conflict (prefix) do nothing;
