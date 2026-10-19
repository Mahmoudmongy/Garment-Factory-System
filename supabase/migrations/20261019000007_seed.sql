-- 20261019000007_seed.sql
-- Permission catalog (extensible), system roles, DEFAULT role permissions.
-- Role defaults other than 'admin' follow the owner's earlier profile description (head worker / worker /
-- accountant). Everything else is a conservative starting point and is an OPEN BUSINESS DECISION.
-- STATUS: NOT EXECUTED (no database available when authored).

insert into public.permissions (key, module, description_ar)
select k, split_part(k, '.', 1), d from (values
 ('dashboard.view','عرض الرئيسية'),
 ('customer.view','عرض العملاء'),('customer.create','إضافة عميل'),('customer.edit','تعديل عميل'),
 ('customer.delete','إيقاف عميل'),('customer.financial.view','عرض حساب العميل'),
 ('production.order.view','عرض أوامر التشغيل'),('production.order.create','إنشاء أمر تشغيل'),
 ('production.order.edit','تعديل أمر تشغيل'),('production.order.cancel','إلغاء أمر تشغيل'),
 ('production.fabric.receive','استلام قماش'),('production.cutting.execute','تنفيذ القص'),
 ('production.bundle.create','إنشاء الشنط'),('production.assignment.create','توزيع الشغل'),
 ('production.receive','استلام شغل'),('production.quality.approve','اعتماد الجودة'),
 ('production.delivery.create','تسليم للعميل'),
 ('worker.profile.view','عرض ملف الصنايعي'),('worker.financial.view','عرض حساب الصنايعي'),
 ('worker.payroll.view','عرض الأجور'),('worker.payment.create','صرف أجر/سلفة'),
 ('employee.view','عرض الموظفين'),('employee.create','إضافة موظف'),('employee.edit','تعديل موظف'),
 ('employee.deactivate','إيقاف موظف'),('employee.document.view','عرض صورة البطاقة'),
 ('employee.document.upload','رفع صورة البطاقة'),('employee.payterms.manage','تعديل نظام أجر الموظف'),
 ('inventory.view','عرض المخزون'),('inventory.receive','استلام مخزون'),('inventory.issue','صرف مخزون'),
 ('inventory.return','مرتجع مخزون'),('inventory.adjust','تسوية مخزون'),('inventory.transfer','نقل مخزون'),
 ('inventory.reverse','عكس حركة مخزون'),('inventory.item.manage','إدارة الأصناف'),
 ('inventory.warehouse.manage','إدارة المخازن'),
 ('expense.view','عرض المصروفات'),('expense.create','تسجيل مصروف'),('expense.edit','تعديل مصروف'),
 ('expense.reverse','عكس مصروف'),
 ('machine.view','عرض الماكينات'),('machine.create','إضافة ماكينة'),('machine.maintenance','تسجيل صيانة'),
 ('account.view','عرض الحسابات'),('account.create','إضافة حساب'),
 ('account.transaction.create','تسجيل حركة مالية'),('account.transaction.reverse','عكس حركة مالية'),
 ('reports.view','عرض التقارير'),
 ('system.user.view','عرض المستخدمين'),('system.user.manage','إدارة المستخدمين'),
 ('system.role.manage','إدارة الأدوار'),('system.permission.manage','إدارة الصلاحيات'),
 ('system.settings.manage','إدارة الإعدادات'),('audit.view','عرض سجل التدقيق')
) as v(k, d)
on conflict (key) do nothing;

insert into public.roles (code, name_ar, is_superuser, is_system) values
 ('admin','مدير النظام', true, true),
 ('factory_manager','صاحب المصنع', false, true),
 ('production_manager','مدير الإنتاج', false, true),
 ('foreman','رئيس العمال', false, true),
 ('worker','صنايعي', false, true),
 ('finishing_worker','عامل تشطيب', false, true),
 ('accountant','محاسب', false, true),
 ('storekeeper','أمين مخزن', false, true),
 ('quality','جودة', false, true),
 ('viewer','مشاهدة فقط', false, true)
on conflict (code) do nothing;

-- Defaults (OPEN BUSINESS DECISION: review with the owner). 'admin' needs none: superuser.
insert into public.role_permissions (role_id, permission_key)
select r.id, x.k from (values
 ('foreman','production.order.view'),('foreman','production.assignment.create'),
 ('foreman','production.receive'),('foreman','worker.profile.view'),
 ('worker','production.receive'),
 ('finishing_worker','production.receive'),
 ('accountant','customer.view'),('accountant','customer.financial.view'),('accountant','account.view'),
 ('accountant','account.transaction.create'),('accountant','worker.financial.view'),
 ('accountant','worker.payroll.view'),('accountant','worker.payment.create'),('accountant','expense.view'),
 ('accountant','expense.create'),('accountant','reports.view'),
 ('storekeeper','inventory.view'),('storekeeper','inventory.receive'),('storekeeper','inventory.issue'),
 ('storekeeper','inventory.return'),('storekeeper','inventory.transfer'),('storekeeper','production.fabric.receive'),
 ('quality','production.quality.approve'),('quality','production.order.view'),
 ('factory_manager','dashboard.view'),('factory_manager','customer.view'),('factory_manager','production.order.view'),
 ('factory_manager','inventory.view'),('factory_manager','reports.view'),
 ('production_manager','dashboard.view'),('production_manager','production.order.view'),('production_manager','inventory.view'),
 ('viewer','customer.view'),('viewer','production.order.view'),('viewer','inventory.view')
) as x(role_code, k)
join public.roles r on r.code = x.role_code
on conflict do nothing;
