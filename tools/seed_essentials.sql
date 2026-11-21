-- Minimum data the app needs to be usable: a cash account, a bank account, the
-- default stage template, and the warehouses. Unlike seed_base.sql this creates
-- no users and no demo documents, so it is safe to run against a real project.
-- Idempotent: every insert is guarded by a natural key.

set client_min_messages = warning;

insert into public.stage_templates (name_ar, is_default) values ('قميص', true)
on conflict (name_ar) do nothing;

insert into public.stage_template_stages
  (template_id, seq, name_ar, code, piece_price, depends_on, is_final)
select t.id, v.seq, v.name_ar, v.code, v.piece_price, v.depends_on::text[], v.is_final
from public.stage_templates t
cross join (values
  (1, 'اللياقات', 'collar',   2.50, '{}',                  false),
  (2, 'الصدر',    'chest',    2.00, '{}',                  false),
  (3, 'الضهر',    'back',     2.00, '{}',                  false),
  (4, 'التجميع',  'assembly', 3.00, '{collar,chest,back}', false),
  (5, 'التشطيب',  'finish',   2.00, '{assembly}',          false),
  (6, 'الكي',     'ironing',  1.50, '{finish}',            false),
  (7, 'الجودة',   'quality',  1.00, '{ironing}',           true)
) as v(seq, name_ar, code, piece_price, depends_on, is_final)
where t.name_ar = 'قميص'
on conflict (template_id, code) do nothing;

insert into public.financial_accounts (code, name, kind, opening_balance) values
  ('CASH1', 'الخزنة الرئيسية', 'cash', 0),
  ('BANK1', 'البنك الأهلي',    'bank', 0)
on conflict (code) do nothing;

insert into public.warehouses (code, name, kind) values
  ('WH01', 'مخزن قماش العملاء',  'customer_fabric'),
  ('WH02', 'مخزن المستلزمات',    'factory_consumables'),
  ('WH03', 'مخزن التام',         'finished_goods')
on conflict (code) do nothing;
