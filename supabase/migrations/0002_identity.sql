-- ============================================================================
-- 0002 — identity, roles, granular permissions
-- Permission codes mirror the reference app (~60 codes across 12 groups).
-- ============================================================================

create table public.roles (
  key         text primary key,
  name_ar     text not null,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.permissions (
  code        text primary key,
  group_ar    text not null,
  name_ar     text not null,
  sort_order  int not null default 0
);

create table public.role_permissions (
  role_key    text not null references public.roles(key) on delete cascade,
  perm_code   text not null references public.permissions(code) on delete cascade,
  primary key (role_key, perm_code)
);

create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  employee_id     uuid unique,           -- set when the login belongs to an employee
  username        text not null unique,
  display_name    text not null,
  is_active       boolean not null default true,
  is_superuser    boolean not null default false,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.user_roles (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  role_key    text not null references public.roles(key) on delete cascade,
  primary key (profile_id, role_key)
);

-- Per-user overrides on top of role grants; a user can lose a permission the role gives.
create table public.user_permissions (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  perm_code   text not null references public.permissions(code) on delete cascade,
  granted     boolean not null,
  primary key (profile_id, perm_code)
);

create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.fn_set_updated_at();

-- ---------------------------------------------------------------- permission check
create or replace function public.has_permission(p_code text, p_profile uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when pf.is_superuser then true
      when pf.is_active is not true then false
      else coalesce(
        (select up.granted from public.user_permissions up
          where up.profile_id = pf.id and up.perm_code = p_code),
        exists (select 1 from public.user_roles ur
                  join public.role_permissions rp on rp.role_key = ur.role_key
                 where ur.profile_id = pf.id and rp.perm_code = p_code)
      )
    end
    from public.profiles pf where pf.id = p_profile
  ), false) $$;

create or replace function public.fn_require_permission(p_code text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission(p_code) then
    perform public.fn_raise('E_PERM', p_code);
  end if;
end $$;

-- ---------------------------------------------------------------- catalogs
insert into public.roles (key, name_ar, is_system) values
  ('manager',        'مدير',              true),
  ('accountant',     'محاسب',             true),
  ('foreman',        'رئيس عمال',          true),
  ('worker',         'صنايعي',             true),
  ('warehouse',      'أمين مخزن',          true);

insert into public.permissions (code, group_ar, name_ar, sort_order) values
  -- dashboard
  ('dashboard.view',              'الرئيسية',        'عرض الرئيسية',                10),
  -- customers
  ('customer.view',               'العملاء',         'عرض العملاء',                 20),
  ('customer.create',             'العملاء',         'إضافة عميل',                  21),
  ('customer.edit',               'العملاء',         'تعديل عميل',                  22),
  ('customer.delete',             'العملاء',         'حذف عميل',                    23),
  ('customer.financial.view',     'العملاء',         'عرض حسابات العملاء',          24),
  ('customer.invoice.create',     'العملاء',         'إنشاء فاتورة',                25),
  ('customer.invoice.void',       'العملاء',         'إلغاء فاتورة',                26),
  ('customer.creditnote.create',  'العملاء',         'إنشاء إشعار دائن',            27),
  ('customer.creditnote.void',    'العملاء',         'إلغاء إشعار دائن',            28),
  ('customer.payment.create',     'العملاء',         'تسجيل تحصيل',                 29),
  ('customer.payment.allocate',   'العملاء',         'تخصيص تحصيل',                 30),
  ('customer.payment.void',       'العملاء',         'إلغاء تحصيل',                 31),
  -- employees / workers
  ('employee.view',               'الصنايعية',       'عرض الموظفين',                40),
  ('employee.create',             'الصنايعية',       'إضافة موظف',                  41),
  ('employee.edit',               'الصنايعية',       'تعديل موظف',                  42),
  ('employee.deactivate',         'الصنايعية',       'إيقاف موظف',                  43),
  ('employee.payterms.manage',    'الصنايعية',       'ضبط شروط الأجر',              44),
  ('employee.document.upload',    'الصنايعية',       'رفع مستندات',                 45),
  ('employee.document.view',      'الصنايعية',       'عرض مستندات',                 46),
  ('worker.profile.view',         'الصنايعية',       'عرض ملف الصنايعي',            47),
  ('worker.financial.view',       'الصنايعية',       'عرض حساب الصنايعي',           48),
  ('worker.payroll.view',         'الصنايعية',       'عرض المرتبات',                49),
  ('worker.payment.create',       'الصنايعية',       'صرف أجر',                     50),
  -- production
  ('production.order.view',       'أوامر التشغيل',   'عرض الأوامر',                 60),
  ('production.order.create',     'أوامر التشغيل',   'إنشاء أمر',                   61),
  ('production.order.edit',       'أوامر التشغيل',   'تعديل أمر',                   62),
  ('production.order.cancel',     'أوامر التشغيل',   'إلغاء أمر',                   63),
  ('production.fabric.receive',   'أوامر التشغيل',   'استلام قماش',                 64),
  ('production.cutting.execute',  'أوامر التشغيل',   'تنفيذ القص',                  65),
  ('production.bundle.create',    'أوامر التشغيل',   'إنشاء شنط',                   66),
  ('production.assignment.create','أوامر التشغيل',   'تسليم شغل لصنايعي',           67),
  ('production.receive',          'أوامر التشغيل',   'استلام شغل من صنايعي',        68),
  ('production.quality.approve',  'أوامر التشغيل',   'اعتماد الجودة',               69),
  ('production.delivery.create',  'أوامر التشغيل',   'إنشاء إذن تسليم',             70),
  ('production.self_assign',      'أوامر التشغيل',   'الصنايعي يستلم بنفسه',        71),
  ('production.self_submit',      'أوامر التشغيل',   'الصنايعي يسلّم بنفسه',        72),
  -- inventory
  ('inventory.view',              'المخزن',          'عرض المخزن',                  80),
  ('inventory.item.manage',       'المخزن',          'إدارة الأصناف',               81),
  ('inventory.warehouse.manage',  'المخزن',          'إدارة المخازن',               82),
  ('inventory.receive',           'المخزن',          'استلام',                      83),
  ('inventory.issue',             'المخزن',          'صرف',                         84),
  ('inventory.transfer',          'المخزن',          'تحويل بين مخازن',             85),
  ('inventory.adjust',            'المخزن',          'تسوية جرد',                   86),
  ('inventory.return',            'المخزن',          'مرتجع',                       87),
  ('inventory.reverse',           'المخزن',          'عكس حركة مخزن',               88),
  -- accounts / cash
  ('account.view',                'الخزنة',          'عرض الحسابات',                90),
  ('account.create',              'الخزنة',          'إضافة حساب',                  91),
  ('account.transaction.create',  'الخزنة',          'حركة خزنة',                   92),
  ('account.transaction.reverse', 'الخزنة',          'عكس حركة خزنة',               93),
  ('expense.view',                'المصروفات',       'عرض المصروفات',               100),
  ('expense.create',              'المصروفات',       'إضافة مصروف',                 101),
  ('expense.edit',                'المصروفات',       'تعديل مصروف',                 102),
  ('expense.reverse',             'المصروفات',       'عكس مصروف',                   103),
  -- machines
  ('machine.view',                'الماكينات',       'عرض الماكينات',               110),
  ('machine.create',              'الماكينات',       'إضافة ماكينة',                111),
  ('machine.maintenance',         'الماكينات',       'تسجيل صيانة',                 112),
  -- reports / admin
  ('reports.view',                'الإدارة',         'عرض التقارير',                120),
  ('audit.view',                  'الإدارة',         'عرض سجل التعديلات',           121),
  ('system.user.view',            'الإدارة',         'عرض المستخدمين',              122),
  ('system.user.manage',          'الإدارة',         'إدارة المستخدمين',            123),
  ('system.role.manage',          'الإدارة',         'إدارة الأدوار',               124),
  ('system.permission.manage',    'الإدارة',         'إدارة الصلاحيات',             125),
  ('system.settings.manage',      'الإدارة',         'إعدادات النظام',              126);

-- manager gets everything; the others get a deliberate subset.
insert into public.role_permissions (role_key, perm_code)
select 'manager', code from public.permissions;

insert into public.role_permissions (role_key, perm_code) values
  ('accountant','dashboard.view'), ('accountant','customer.view'),
  ('accountant','customer.create'), ('accountant','customer.edit'),
  ('accountant','customer.financial.view'), ('accountant','customer.invoice.create'),
  ('accountant','customer.payment.create'), ('accountant','customer.payment.allocate'),
  ('accountant','employee.view'), ('accountant','worker.financial.view'),
  ('accountant','worker.payroll.view'), ('accountant','worker.payment.create'),
  ('accountant','production.order.view'), ('accountant','inventory.view'),
  ('accountant','account.view'), ('accountant','account.transaction.create'),
  ('accountant','expense.view'), ('accountant','expense.create'),
  ('accountant','reports.view'), ('accountant','machine.view'),

  ('foreman','dashboard.view'), ('foreman','production.order.view'),
  ('foreman','production.fabric.receive'), ('foreman','production.cutting.execute'),
  ('foreman','production.bundle.create'), ('foreman','production.assignment.create'),
  ('foreman','production.receive'), ('foreman','production.quality.approve'),
  ('foreman','inventory.view'), ('foreman','employee.view'),

  ('worker','production.self_assign'), ('worker','production.self_submit'),
  ('worker','production.order.view'),

  ('warehouse','dashboard.view'), ('warehouse','inventory.view'),
  ('warehouse','inventory.item.manage'), ('warehouse','inventory.receive'),
  ('warehouse','inventory.issue'), ('warehouse','inventory.transfer'),
  ('warehouse','inventory.return'), ('warehouse','production.fabric.receive'),
  ('warehouse','production.order.view');
