# الصلاحيات والأدوار — Permissions and roles

كل صلاحية مفتاح منقط `module.action`، تُخزَّن في `public.permissions` وتُطبَّق **في قاعدة البيانات**
(`has_permission()` داخل كل `rpc_*`) — إخفاء زر في الواجهة ليس حماية.

Every permission is a dotted `module.action` key stored in `public.permissions` and enforced
**server-side** by `has_permission()` inside each `rpc_*`. Hiding a button is not security.

## قاعدة الحساب — Resolution rule

```
effective = user is active
        AND key exists and is active
        AND ( superuser
              OR ( (role grants it OR a user grant exists) AND no user deny ) )
```

- `deny` beats any `grant`.
- A superuser (the `admin` role) implicitly has every key; their checklist is read-only.
- A non-admin cannot grant a permission they do not hold themselves (`42501`).

## الكتالوج الكامل — Full catalog

### لوحة وتحكم — dashboard / system
| key | description_ar |
|---|---|
| `dashboard.view` | عرض الرئيسية |
| `system.user.view` | عرض المستخدمين |
| `system.user.manage` | إدارة المستخدمين |
| `system.role.manage` | إدارة الأدوار |
| `system.permission.manage` | إدارة الصلاحيات |
| `system.settings.manage` | إدارة الإعدادات |
| `audit.view` | عرض سجل التدقيق |
| `reports.view` | عرض التقارير |

### عملاء — customers
`customer.view` · `customer.create` · `customer.edit` · `customer.delete` · `customer.financial.view`

### أوامر تشغيل — production orders
| key | description_ar |
|---|---|
| `production.order.view` | عرض أوامر التشغيل |
| `production.order.create` | إنشاء أمر تشغيل |
| `production.order.edit` | تعديل أمر تشغيل |
| `production.order.cancel` | إلغاء أمر تشغيل |
| `production.fabric.receive` | استلام قماش |
| `production.cutting.execute` | تنفيذ القص |
| `production.bundle.create` | إنشاء الشنط |
| `production.assignment.create` | توزيع الشغل |
| `production.receive` | استلام شغل |
| `production.work.receive` | استلام شغل من التوزيع |
| `production.work.deliver` | تسليم شغل بعد التنفيذ |
| `production.approval.approve` | اعتماد استلام/تسليم الشغل |
| `production.own.view` | عرض إنتاجي أنا فقط |
| `production.quality.approve` | اعتماد الجودة |
| `production.delivery.create` | تسليم للعميل |

### صنايعية وأجور — workers & payroll
| key | description_ar |
|---|---|
| `worker.profile.view` | عرض ملف الصنايعي |
| `worker.financial.view` | عرض حساب الصنايعي |
| `worker.payroll.view` | عرض الأجور |
| `worker.payroll.pay` | صرف أجر صنايعي |
| `worker.payment.create` | صرف أجر/سلفة |
| `worker.advance.create` | تسجيل سلفة لصنايعي |
| `worker.target.manage` | إدارة التارجت والحوافز |

### موظفين — employees
`employee.view` · `employee.create` · `employee.edit` · `employee.deactivate` ·
`employee.document.view` · `employee.document.upload` · `employee.payterms.manage`

### مخزون — inventory
`inventory.view` · `inventory.receive` · `inventory.issue` · `inventory.return` ·
`inventory.adjust` · `inventory.transfer` · `inventory.reverse` ·
`inventory.item.manage` · `inventory.warehouse.manage`

### مصروفات — expenses
`expense.view` · `expense.create` · `expense.edit` · `expense.reverse` · `expense.item.manage`

### ماكينات — machines
`machine.view` · `machine.create` · `machine.maintenance` · `machine.spare_part.manage`

### حسابات — accounts
`account.view` · `account.create` · `account.transaction.create` · `account.transaction.reverse`

## الإعدادات الافتراضية — Default role presets

`admin` is a superuser and therefore needs no rows in `role_permissions`.

### رئيس العمال — Foreman (`foreman`)
Delivers/receives work and approves receipts. **No worker accounts, no balances.**
```
dashboard.view · production.order.view · production.assignment.create · production.receive
production.work.receive · production.work.deliver · production.approval.approve · worker.profile.view
```
Deliberately **absent**: `worker.financial.view`, `worker.payroll.view`, `account.view`,
`customer.financial.view`, `reports.view`. Migration 09 deletes them if an earlier seed added them.

### صنايعي — Worker (`worker`)
Receives and delivers work, sees only his own production. **Nothing about money.**
```
production.order.view · production.receive · production.work.receive
production.work.deliver · production.own.view
```

### عامل تشطيب — Finishing worker (`finishing_worker`)
Same as worker, without `production.receive`.

### بقية الأدوار — Other roles
`factory_manager`, `production_manager`, `accountant`, `storekeeper`, `quality`, `viewer` keep the
conservative defaults from migration 07 and are marked `OPEN BUSINESS DECISION` for the owner to review.

## قائمة التحقق لكل مستخدم — Per-user checklist

`rpc_user_permission_matrix(profile)` returns, for every active key:
`{key, module, description_ar, from_role, override, effective}` — enough to render a checklist that
shows which ticks are inherited and which are manual.

`rpc_set_effective_permissions(profile, keys[], reason)` takes the **exact set ticked** and stores only
the differences:

| role grants | ticked | stored |
|---|---|---|
| yes | yes | nothing (inherited) |
| yes | no | `deny` |
| no | yes | `grant` |
| no | no | nothing |

Every change is written to `audit_log` with the reason and the acting user.

## RLS
Tables are `SELECT`-only for `authenticated`; there is no `INSERT/UPDATE/DELETE` policy anywhere.
Writes happen exclusively through `SECURITY DEFINER` `rpc_*` functions, each of which calls
`fn_require_permission(...)` first. `anon` has no table privileges and no `rpc_*` execute.

A worker additionally sees only their own rows through `prod_tx_own_select`
(`production_transactions.employee_id = profiles.employee_id`).
