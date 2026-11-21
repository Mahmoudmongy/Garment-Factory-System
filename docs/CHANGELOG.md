# سجل التغييرات — Changelog

> **اقرأ أولاً / Read first.** الأقسام «Phase 0–3» أدناه هي سجل بناء **أُلغي**
> (البناء الطبقي القديم، محفوظ في `cd0ba35`). لا تصف الكود الحالي: الجداول التي
> تذكرها (`supply_purchases`, `order_extra_costs`, `item_cost_history`) وملف
> الاختبار `012_phase3.test.sql` غير موجودة في المستودع. سجل البناء الحالي في
> قسم **Rebuild** في نهاية الملف.
>
> Sections Phase 0–3 below record a **superseded** layered build (preserved at
> `cd0ba35`). They do not describe the current code: the tables they name
> (`supply_purchases`, `order_extra_costs`, `item_cost_history`) and the test file
> `012_phase3.test.sql` do not exist in the repository. The current build is
> recorded under **Rebuild** at the end of this file.

المرحلة تُغلق فقط بعد نجاح الاختبارات. كل بند مؤجَّل مذكور صراحةً، وكل افتراض مكتوب عليه `ASSUMPTION`.

A phase is only closed after its tests pass. Every deferred item is stated, every guess is marked `ASSUMPTION`.

---

## Phase 0 — التحقق من الأساس (Baseline verification)

**تم / Done**
- أول تنفيذ حقيقي للـ 8 migrations على Postgres 15 (`tools/run_db_tests_local.sh`).
- `001_foundation.test.sql`: **78/78** تأكيد ينجح.
- اختبار تزامن جديد متعدد الجلسات: **14/14** (`tools/run_concurrency_local.sh`).
- `docs/ANALYSIS.md`, `docs/LOCAL_VERIFICATION.md`.

**مؤجَّل / Deferred** — لا شيء.

**ملاحظات / Notes**
- `tools/local_supabase_shim.sql` و `tools/pgtap_shim.sql` أدوات تطوير فقط، لا تُنشر.
- تم إصلاح خطأين في أدوات الاختبار نفسها (رؤية `pg_temp`، ومنح `execute` عام كان يمنح `anon` نداء `rpc_*`).
- لم يُعدَّل أي ملف من ملفات المشروع في هذه المرحلة.

---

## Phase 1 — المستخدمون والصلاحيات والأكواد

**تم / Done**
- **أكواد تسلسلية**: `W-0001` للصنايعي، `E-0001` لعامل التشغيل، `C-0001` للعميل، `M-0001` للماكينة.
  تظهر بجانب الكود الداخلي القديم (`CUS0001`, `EMP0001`) ولا تلغيه.
- `employees.employee_kind` (`worker` / `operations`) وهو الذي يحدد بادئة الكود.
- **قائمة تحقق لكل مستخدم**: `rpc_permission_catalog`, `rpc_user_permission_matrix`,
  `rpc_set_effective_permissions` — تُخزَّن الفروق فقط (grant/deny) فوق صلاحيات الدور.
- `rpc_create_user` ينشئ الهوية + الدور + قائمة التحقق في نداء واحد، و`rpc_list_users` يعرضهم.
- **إعدادات الأدوار**: `foreman` = استلام/تسليم/اعتماد فقط بلا حسابات أو أرصدة؛
  `worker` = استلام/تسليم + إنتاجي فقط بلا أي صلاحية مالية.
- RLS: `prod_tx_own_select` تجعل الصنايعي يرى صفوف إنتاجه هو فقط.
- 9 مفاتيح صلاحية جديدة، و`docs/PERMISSIONS.md` بالكتالوج الكامل.
- الاختبارات: `supabase/tests/010_phase1.test.sql` — **29/29** تنجح.

**ASSUMPTION**
- الكود التسلسلي **حقل إضافي** (`serial_code`) وليس بديلاً عن `code`، حتى لا تتغير معاني أي مستند أو تقرير قائم.
- بادئة الصنايعي `W-` وعامل التشغيل `E-` (Employee/Operations) حسب ترتيب الطلب `W-0001, C-0001, M-0001, E-0001`.
- المستخدم المرتبط بموظف واحد فقط (`profiles.employee_id` فريد) — أي أن رئيس العمال له صف موظف خاص به.
- صلاحيات `admin` ضمنية وغير قابلة للتعديل من الشاشة (`F0004`).

**مؤجَّل / Deferred**
- شاشات الواجهة (إنشاء مستخدم، قائمة التحقق) — تأتي مع قشرة التطبيق.
- نقل بيانات مستخدمي Auth يتم عبر Edge Function قائمة (`admin-create-user`) — لم تُنشر.
- الأدوار `factory_manager` / `production_manager` / `accountant` / `storekeeper` / `quality` /
  `viewer` ما زالت على الإعدادات المحافظة القديمة وتنتظر مراجعة المالك.

---

## Phase 2 — الصنايعية والأجور (Workers & payroll)

**تم / Done**
- `bonus_rules` + `worker_targets`: تارجت يومي لكل صنايعي مع تاريخ سريان، و«حوافز حسب الإنتاج»
  قابلة للضبط من الشاشة (نسبة رفع سعر القطعة، أو مبلغ يومي، أو شهري) — لا رقم مثبت في الكود.
- `worker_advances`: السلفة بتاريخ قابل للتعديل، ووضع خصم `this_month` / `next_month` (تُخصم أو تُرحَّل)،
  و`idempotency_key` يمنع التكرار عند إعادة المحاولة. لا تُعدَّل ولا تُحذف سلفة بعد خصمها (`F0006`).
- `worker_payments` + `rpc_pay_worker`: الأجر = شغل + حافز − سلف، والخصم من خزنة/بنك محدد
  بحركة مالية واحدة، مع منع صرف أكبر من المستحق (`F0002`).
- `salary_allocations`: راتب موظف التشغيل يُوزَّع على أوامر التشغيل بنسبة القطع المنتجة، فيظهر كتكلفة تشغيل.
- `v_worker_earnings`, `fn_worker_work_amount`, `fn_worker_day_bonus`, `fn_worker_bonus`.
- `rpc_workers_summary`, `rpc_worker_statement` (كشف حساب الصنايعي: شغل + سلف + مدفوعات).
- RLS: الصنايعي لا يرى أي جدول أجور؛ من يملك `worker.payroll.view` فقط يرى المدفوعات.
- الاختبارات: `supabase/tests/011_phase2.test.sql` — **39/39** تنجح.

**ASSUMPTION**
- الحافز يُحسب **يوميًا** ثم يُجمَع على الفترة، لأن التارجت يومي.
- «الشهر = 30 يوم» عند تحويل حافز شهري إلى يومي.
- أجر عامل التشغيل **شهري** من `employee_pay_terms`، ولا يُحسب بالقطعة حتى لو سجّل إنتاجًا.
- السلفة اليدوية **لا تُصرف نقدًا وقت تسجيلها**؛ تُخصم فقط يوم الصرف. (طلب العميل حرفيًا: تُسجَّل وتُخصم.)
- سلفة `next_month` تبقى مفتوحة حتى تُخصم في صرف لاحق.

**مؤجَّل / Deferred**
- شاشات السلف والتارجت وكشف الحساب في الواجهة — المرحلة 3.
- `salary_allocations.production_order_id` بلا FK حتى تُنشأ جداول أوامر التشغيل (المرحلة 4)؛
  عندها تُضاف القيود في migration جديد.
- صرف السلفة نقدًا (لو طلبها المالك لاحقًا) يحتاج حركة مالية منفصلة — لم يُنفَّذ لعدم طلبه.

---

## Phase 3 — المخازن والمستلزمات (Warehouses, supplies & extra costs)

**تم / Done**
- **فصل المخازن بنوعها**: `warehouses.kind` بقى بيحدد إيه المسموح يدخل. مخزن `factory_consumables` /
  `order_materials` / `other` يستقبل ملك المصنع فقط؛ `customer_fabric` / `order_materials` يستقبل أمانة
  العميل فقط؛ `finished_goods` ملك المصنع فقط. القاعدة في `fn_warehouse_accepts(kind, ownership)`
  وتُفرض في كل مسار إنشاء مستند — لا في التريجر — حتى لا تكسر البيانات القائمة.
- **فواتير المشتريات** `supply_purchases` + `supply_purchase_lines` عبر `rpc_purchase_supplies`:
  الاستلام في المخزن + الصرف من الخزنة في نفس اللحظة، بكود تسلسلي `PUR0001`، وبـ`idempotency_key`
  يمنع الازدواج عند إعادة المحاولة. سعر الوحدة يتحدّث في `item_cost_history` تلقائيًا.
- **خامة العميل (أمانة)** عبر `rpc_receive_customer_material` / `rpc_return_customer_material`:
  تتحفظ بملكية `customer` وباسم العميل، ولا تُنشئ أي حركة مالية — لأنها ليست تكلفة على المصنع.
  المرتجع للعميل يُنقص رصيده هو فقط ولا يلمس مخزون المصنع (`F0003` لو الكمية أكبر من المتاح).
- **مصاريف إضافية على الأوردر** `order_extra_costs` + `rpc_add_extra_cost`: كل مصروف له `category`
  و**بيان إلزامي** (٣ حروف على الأقل، `23514`)، ويُسجَّل معه حركة خزنة `out` بنفس البيان.
- **قفل النوع**: `rpc_update_warehouse` يسمح بتعديل الاسم، ويرفض تغيير `kind` بعد أن يصبح للمخزن
  رصيد (`F0006`) — لأن تغيير النوع يقلب معنى كل رصيد قائم.
- **عدم قابلية التعديل**: `supply_purchases` و`order_extra_costs` append-only (`F0006`) مثل بقية المستندات.
- **وحدات قراءة**: `v_supply_purchases` (بالكود، المورد، عدد البنود، الإجمالي، المخزن، الخزنة)
  و`v_order_extra_costs` (باسم العميل).
- الاختبارات: `supabase/tests/012_phase3.test.sql` — **48/48** تنجح.
- الواجهة: تبويب **«المخازن والمستلزمات»** — أرصدة المخازن، فاتورة مشتريات متعددة البنود،
  استلام/مرتجع خامة عميل، مصاريف إضافية، وإنشاء مخزن.

**ASSUMPTION**
- خامة العميل **لا تُكلَّف** على المصنع ماليًا وقت استلامها؛ تكلفتها الحقيقية تظهر فقط في أجر التشغيل.
- «فاتورة المشتريات» **مدفوعة بالكامل** من الخزنة لحظة التسجيل — لا يوجد نظام آجل/دائنين في هذه المرحلة.
- المخزن الافتراضي للمشتريات هو `factory_consumables`؛ الأصناف لا تُقيَّد بنوع مخزن معيّن (نفس الصنف
  ممكن يكون قماش مصنع وقماش عميل حسب الملكية لا حسب الصنف).
- سعر الوحدة في `item_cost_history` يُسجَّل **لكل سطر شراء**، وليس متوسطًا مرجّحًا (يُحسب عند التقارير).

**مؤجَّل / Deferred**
- مردودات المشتريات للمورد (مرتجع شراء) — لم تُطلب في هذه المرحلة.
- ربط `order_extra_costs.production_order_id` بجدول أوامر التشغيل بعد إنشائه في المرحلة 4.
- تقييم المخزون (FIFO/متوسط) وتقرير تكلفة المخزون — مرحلة التقارير.
- شاشة إدارة الأصناف (إنشاء/تعديل صنف) — الأصناف تُنشأ حاليًا من السيد أو من الـ RPC مباشرة.

---

## Rebuild — البناء الحالي (current)

البناء أُعيد من الصفر على نموذج التطبيق المرجعي (`03745b2`)، ثم نُظّف وأُصلح
(`b5f2cc4`)، ثم رُبطت بقية الـ RPCs بالواجهة (`d1b863f`).

### الأساس
- 13 migration في `supabase/migrations/` (0001 core → 0013 master-data writes)،
  تُطبَّق على Postgres 15 نظيف.
- 32 جدول، 11 view، 31 دالة `rpc_*`.
- **لا رصيد مخزَّن**: كل رصيد يُحسب من صفوف الحركات.
- كل كتابة تمر عبر `rpc_*`؛ RLS بلا أي سياسة كتابة، فالكتابة المباشرة تفشل.

### الاختبارات
| الملف | التأكيدات |
|---|---|
| `001_core.test.sql` | 63 |
| `002_bundle_queue.test.sql` | 30 |
| `003_supplies.test.sql` | 22 |
| `004_master_writes.test.sql` | 18 |
| **الإجمالي** | **133/133** |

- `tools/run_concurrency_local.sh`: سباق المخزون (10 نجاح / 10 `E_OVER_ISSUE`)،
  وسباق التكرار (إدراج واحد + 9 `replayed`).
- `tools/static_sql_check.py`: 19 ملف، 47 دالة، 31 كود خطأ، بلا مشاكل.

### في هذه الجلسة
- **`0013_master_data_writes.sql`**: إضافة `rpc_create_account`, `rpc_update_account`,
  `rpc_update_item`, `rpc_update_warehouse`, `rpc_update_machine`, `rpc_update_employee`.
  قبلها كانت الخزائن تُنشأ من SQL السيد فقط، والأصناف/المخازن/الماكينات/الصنايعية
  بلا مسار تعديل.
- **سجل التعديلات**: ربط `fn_audit_row` بأربعة جداول كانت بلا أثر
  (`items`, `warehouses`, `machines`, `financial_accounts`). `fn_audit_row` بـ
  `security definer`، فالإدراج ينجح رغم أن المستدعي لا يملك صلاحية على `audit_log`.
  الهجرة قابلة لإعادة التطبيق (تتحقق من وجود الـ trigger أولاً).
- **الواجهة**: أزرار تعديل للأصناف والمخازن والماكينات والصنايعية، ونموذج إضافة خزنة.
- **تحقق في المتصفح**: إنشاء خزنة `ACC0001` برصيد 1,500.00 ج.م ظهر في الأرصدة
  وفي قائمة الخزائن؛ تعديل ماكينة وصناعي عبر الـ API؛ ظهور قيد الخزنة في شاشة
  «سجل التعديلات».
- **التوثيق**: `docs/ARCHITECTURE.md` أُعيد كتابته من قاعدة البيانات الحية — كان
  يصف مخططًا لم يُبنَ قط (`production_transactions`, `employees.full_name`,
  `item_cost_history`, `permissions.key`). `PROJECT_STATE.md` حُدِّث بأرقام
  الاختبار والفجوات الحقيقية. `docs/LOCAL_VERIFICATION.md` صُحِّحت فيه أكواد
  الخطأ (`F0002`/`F0003` → `E_OVER_ISSUE`) وحُذفت سباقات غير منفَّذة.

### فجوة معروفة
- **لا يوجد RPC لإدارة المستخدمين**: لا إنشاء مستخدم، ولا إسناد دور، ولا تعديل
  صلاحية. شاشة «المستخدمون والصلاحيات» تعرض كتالوج الصلاحيات فقط. هذه أكبر فجوة
  متبقية قبل تسليم النظام لأكثر من شخص.
- `tests/integration/` مكتوب ضد واجهة برمجية مهجورة، ولم يُشغَّل قط.
