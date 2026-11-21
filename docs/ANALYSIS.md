# تحليل المشروع — Garment Factory System

آخر تحديث: 2026-11-20 (مراجعة كاملة على الـ branch `rebuild-full-ui`)

كل الأرقام تحت مقروءة من قاعدة البيانات الشغالة والكود نفسه، مش من الوثائق.

---

## 1. المشروع بيعمل إيه

نظام إدارة مصنع ملابس (CMT) للسوق المصري: عربي RTL، جنيه مصري، PWA يتنصّب
على الموبايل. بيغطي أرض المصنع مش بس الحسابات:

| المجال | الشاشات |
|---|---|
| الشغل اليومي | الرئيسية، رئيس العمال (سكان/تسليم)، أوامر التشغيل، المخزن، المساعدة |
| الحسابات | العملاء، الصنايعية وأرصدتهم، الخزنة والبنوك، المصروفات، المستلزمات |
| الإدارة | الماكينات، لوحة المدير، 12 تقرير، المستخدمون والصلاحيات، استيراد، سجل التعديلات |

## 2. الـ Stack

| الطبقة | التقنية | ملاحظة |
|---|---|---|
| الواجهة | Vanilla JS + HTML في `preview/` | مفيش build step — `app.js` 3183 سطر |
| السيرفر | `tools/preview_server.py` (Python `http.server`) | 295 سطر، بيعمل بروكسي لـ `/api/rpc` و `/api/view` |
| قاعدة البيانات | PostgreSQL 15 | 14 migration، Supabase-style (RLS + `auth.uid()`) |
| التطبيق الأصلي | Next.js 14 في `app/` | **86 سطر بس** — صفحة login + iframe للـ demo |
| الاختبارات | pgTAP shim | 5 ملفات، 176 assertion |

**نقطة مهمة:** المشروع فيه **تطبيقين**. `app/` (Next.js) مجرد غلاف login بيفتح
`/factory-demo.html` في iframe. التطبيق الحقيقي هو `preview/`. الاتنين شغالين
على نفس قاعدة البيانات. ده مصدر لبس لازم يتحسم.

## 3. الشكل الفعلي لقاعدة البيانات

مقروء من `information_schema` على قاعدة شغالة بعد تطبيق الـ 14 migration:

- **32 جدول** (30 بيانات + 2 عدادات: `code_counters`, `operational_code_counters`)
- **11 view**
- **91 دالة** إجمالاً، منهم **38 `rpc_*`** (سطح الـ API)
- **65 صلاحية**، **26 trigger**
- **31 policy كلها SELECT** + GRANTs كتابة على 10 جداول

### الجداول

```
audit_log                    items                        production_orders
bundles                      machine_maintenance          profiles
code_counters                machines                     role_permissions
customer_fabric_movements    operational_code_counters    roles
customer_returns             operational_codes            stage_template_stages
customers                    permissions                  stage_templates
cut_lines                    production_order_stages      user_permissions
deliveries                   employee_pay_terms           user_roles
delivery_lines               employees                    warehouses
expenses                     financial_accounts           work_assignments
financial_transactions       inventory_transactions
```

### الـ Views

`v_account_balances`, `v_bundle_queue`, `v_bundles`, `v_customer_fabric_balances`,
`v_customers`, `v_order_costing`, `v_order_stages`, `v_order_timeline`,
`v_production_orders`, `v_stock_balances`, `v_workers`

## 4. المبادئ المعمارية (متحقَّقة من الكود)

1. **الأرصدة مش متخزنة أبداً.** كل الـ views بتجمّع من جداول الحركة. مفيش عمود
   `balance` في أي جدول.
2. **كل كتابة بتعدي من `rpc_*`.** الـ 31 policy كلها SELECT، فحتى لو فيه GRANT
   كتابة، أي `insert` مباشر بيرجع `new row violates row-level security policy`.
   **اختبرت ده فعلياً** على جدول `items`. الـ RPCs بتشتغل `security definer`
   وبتنادي `fn_require_permission`.
3. **التصحيح بالعكس مش بالحذف.** الحركات المالية والمخزنية بتتعكس بقيد مقابل
   بسبب إجباري. `audit_log` والـ ledgers append-only.
4. **المراحل snapshot.** إنشاء أمر بياخد نسخة من الـ template، فتعديل الـ template
   بعد كده مابيغيّرش أمر شغال.
5. **الأجر على المقبول بس.** المرفوض بيتسجل للتقارير ومابيدفعش.
6. **قماش العميل مش مخزون المصنع.** ليه ledger لوحده
   (`customer_fabric_movements`) باللون والمتر، والرصيد السالب مسموح ومبيتعرضش
   كخطأ لأن القص بيسبق إذن الاستلام.

## 5. تغطية الشاشات — الحالة الحقيقية

كل الـ 19 route موجودة ومربوطة. تحققت من كل واحد:

```
home  foreman  orders  order-new  order/:id  templates  warehouse
customers  customer/:id  workers  worker/:id  accounts  expenses
supplies  machines  analytics  reports  users  import  audit  help
```

**الـ 12 تقرير كلهم متوصّلين** — 11 بـ `if` صريح وواحد (`audit`) بـ `else` أخير.
كلهم بيرجعوا بيانات حقيقية.

الـ RPCs: **مفيش ولا نداء مكسور** من الـ UI. فيه RPC واحد بس مش مستخدم من
الواجهة: `rpc_update_account`.

## 6. الفجوات الحقيقية

مرتبة بالأثر:

### أ. إدارة المستخدمين مش موجودة (الأخطر)
- `pageUsers` **بتعرض كتالوج الصلاحيات بس**. مفيش قائمة مستخدمين، مفيش إنشاء
  مستخدم، مفيش إسناد دور، مفيش منح/سحب صلاحية.
- مفيش ولا RPC للغرض ده. تغيير صلاحية مستخدم محتاج SQL مباشر.
- ده بيمنع تسليم النظام لمستخدم تاني غير الأدمن.

### ب. زرار «خروج» ميت
`preview/app.js:129` بيرسم `<button class="sb-out">خروج</button>` ومفيش عليه
أي handler. المستخدم بيضغط ومفيش حاجة بتحصل.

### ج. مفيش مصادقة في نسخة الـ preview
`tools/preview_server.py:67` بيثبّت الـ JWT claims على `ADMIN_ID` لكل اتصال:

```python
conn.execute("select set_config('request.jwt.claims', %s, false)",
             (json.dumps({"sub": ADMIN_ID, "role": "authenticated"}),))
```

يعني أي حد يوصل للـ preview بيدخل كأدمن. مقبول **للمعاينة المحلية** بس، ومرفوض
تماماً لو ده هيتنشر. لازم يتوضّح قبل النشر.

### د. صلاحيات Supabase مكتوبة في الكود
`app/page.js:6-7` فيها `supabase.co` URL و `sb_publishable_...` hardcoded.
الـ publishable key مصمم يبقى عام، فمش تسريب خطير، بس الأفضل env var — ولازم
التأكد إن RLS شغال على المشروع الحقيقي بتاع Supabase.

### هـ. `tests/integration/` ميت
بينادي 5 RPCs مش موجودين أصلاً:

```
rpc_create_financial_account   rpc_create_profile   rpc_my_permissions
rpc_post_manual_transaction    rpc_set_profile_active
```

الملف ده عمره ما اشتغل. لازم يتكتب من جديد على الـ API الحالي أو يتشال.

### و. وثائق قديمة لسه بتوصف بناء اتشال
`docs/ARCHITECTURE.md` و `PROJECT_STATE.md` و `CHANGELOG.md` اتصلّحوا في الجلسة
اللي فاتت، بس `docs/PROTOTYPE_AUDIT_REPORT.md` (39KB) و `PROTOTYPE_STATE_v1.md`
لسه بيوصفوا الـ prototype القديم. مش خطر، بس بيلخبط أي حد جديد.
## 7. الاختبارات

| الملف | Assertions | الحالة |
|---|---|---|
| `001_core.test.sql` | 63 | ✅ |
| `002_bundle_queue.test.sql` | 30 | ✅ |
| `003_supplies.test.sql` | 22 | ✅ |
| `004_master_writes.test.sql` | 18 | ✅ |
| `005_users.test.sql` | 43 | ✅ |
| **الإجمالي** | **176** | **كلهم ناجحين** |

زيادة على ده: `tools/run_concurrency_local.sh` بيختبر سباقين حقيقيين
(سحب مخزون متزامن، وidempotency) وكلهم بينجحوا.

**الفجوة:** مفيش اختبار للواجهة خالص. كل الـ 176 assertion على مستوى الـ SQL.
أي غلط في `app.js` (زي زرار الخروج الميت) مش هيتلقط.

## 7.5 الفجوة الحقيقية: مفيش قاعدة بيانات شغالة ولا نشر

التحليل اللي فوق كله اتعمل على **قاعدة محلية** (Docker `postgres:15-alpine`)،
مش على Supabase. الوضع الفعلي:

| العنصر | الحالة الحقيقية |
|---|---|
| Supabase project | **مش موجود.** `app/page.js` فيها ref ثابت `zkpmoyavdozbboqxvgys` — الـ DNS مش بيتحل، يعني المشروع ده اتمسح أو ماكانش موجود |
| `app/` (Next.js) | صفحة login بتفتح `factory-demo.html` في iframe — **الـ demo مش التطبيق** |
| `factory-demo.html` | 244 سطر، كل البيانات في `localStorage`، صفر اتصال بـ Supabase |
| `preview/` (التطبيق الحقيقي) | بيحتاج `tools/preview_server.py` — سيرفر Python محلي. Next.js **مش بيخدمه** |
| النشر | مفيش `Dockerfile` ولا `railway.json` ولا `vercel.json` ولا `Procfile` |
| Edge function | `admin-create-user` مكتوبة (47 سطر) وعمرها ما اتنشرت |
| `tests/integration/` | مكتوبة على API قديم مش موجود |

**يعني:** لو حد فتح الريبو على GitHub دلوقتي وضغط "Deploy"، هيطلع صفحة login
بتفتح demo وهمي بـ localStorage. مفيش مسار واحد يوصل للتطبيق الحقيقي على
الإنترنت.

ده أهم فجوة في المشروع، وأهم من أي ميزة جديدة.

---

## 8. حالة الـ branch مقابل main

`rebuild-full-ui` متفرّع خطياً من `origin/main` (`8aa4d9c`)، وبيقدّم عليه بـ 11
commits. الفرق **مش تعديل**، ده **استبدال**:

- **51 ملف اتغير، +8583 / −1908**
- الـ 8 migrations القديمة (`20261019000001..0008`) بتتشال وتتحل محلها 14
  migration جديدة (`0001..0014`)
- `supabase/tests/001_foundation.test.sql` بتتشال وتتحل محلها 5 ملفات
- `prototype/factory-demo.html` بيتشال

ده PR كبير جداً. محتاج وصف واضح جداً عشان أي حد يراجعه يفهم إن ده إعادة بناء
مقصودة، مش حذف بالغلط.

---

## الخلاصة

الأساس سليم: قاعدة البيانات بتملك كل القواعد، الأرصدة محسوبة مش متخزنة،
والـ 176 اختبار ناجحين. إدارة المستخدمين اتعملت (migration 0014) مع عزل قبض
الصنايعي بـ RLS، وزرار الخروج شغال.

الفجوة اللي فاضلة مش في العمق، هي في **التشغيل**: مفيش قاعدة بيانات Supabase
حقيقية ومفيش نشر للتطبيق الحقيقي (`preview/`). اللي على GitHub دلوقتي هو
login + demo بـ localStorage. لحد ما ده يتحل، مفيش حد يقدر يستخدم النظام
فعلاً، مهما كانت الميزات مظبوطة.
