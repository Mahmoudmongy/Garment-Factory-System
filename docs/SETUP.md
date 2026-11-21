# Setup — من الصفر لمشروع شغّال

الدليل ده مكتوب على أساس اللي موجود في الريبو فعلاً. كل أمر هنا اتجرّب، ما عدا الخطوات
اللي محتاجة مفاتيح المشروع بتاعك (المعلَّمة بـ **مفتاح مطلوب**).

## 1. المشروع على Supabase

1. اعمل مشروع على supabase.com واحفظ **DB password**.
2. Authentication → Sign In / Providers → اقفل **Allow new users to sign up**.
   (المستخدمين بيتعملوا من جوه التطبيق بواسطة الأدمن، أو بـ `tools/bootstrap_admin.py`.)
3. خلي minimum password length ≥ 8.

## 2. اعمل الجداول والدوال

الملفات في `supabase/migrations/` بالترتيب `0001..0014`. عندك طريقتين:

**أ) بالسكربت المرفق (مفضّل — بيتابع اللي اتطبّق):**

```bash
export SUPABASE_DB_URL='postgresql://postgres:<DB-PASSWORD>@db.xfttxitgwqvqztssbxra.supabase.co:5432/postgres'
python3 tools/apply_migrations.py --status     # يشوف المطلوب قبل التنفيذ
python3 tools/apply_migrations.py              # يطبّق
```

كل ملف بيتنفّذ في transaction لوحده، واللي ينجح بيتسجل في `public.schema_migrations`،
فإعادة التشغيل آمنة. **ما تعدّلش ملف اتطبّق قبل كده** — السكربت بيرفض ويطلب migration جديد.

**ب) بـ Supabase CLI:** `supabase login` → `supabase link --project-ref xfttxitgwqvqztssbxra`
→ `supabase db push`.

## 3. اعمل أول أدمن — **مفتاح مطلوب**

التطبيق مش بيسمح بإنشاء أول مستخدم (لازم أدمن موجود يمنح الصلاحية)، فده بيتم مرة واحدة
من بره:

```bash
export SUPABASE_URL='https://xfttxitgwqvqztssbxra.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='<service_role key>'
export SUPABASE_DB_URL='postgresql://postgres:<DB-PASSWORD>@db.xfttxitgwqvqztssbxra.supabase.co:5432/postgres'

python3 tools/bootstrap_admin.py --username admin --display 'المدير' --generate-password
```

السكربت بيطبع الباسورد مرة واحدة — خدها قبل ما تقفل الشاشة. تشغيله تاني آمن (بيعيد
استخدام المستخدم الموجود ومش بيغيّر الباسورد).

> الباسورد اللي في المرجع مش هيتعمل تلقائيًا. لو عايز تحدد باسورد بنفسك استخدم
> `--password '...'` بدل `--generate-password`. **متكتبش الباسورد الحقيقي في الريبو**
> — الريبو عام، فأي باسورد مكتوب هنا بيبقى مكشوف. خزّنه في مدير باسوردات وفي
> متغيرات Railway بس.

## 4. Edge Function (اختياري)

```bash
supabase functions deploy admin-create-user
```

دي بس للسماح للأدمن بإنشاء مستخدمين من داخل التطبيق. من غيرها كل حاجة تانية شغالة.

## 5. التشغيل

```bash
export SUPABASE_URL='https://xfttxitgwqvqztssbxra.supabase.co'
export SUPABASE_PUBLISHABLE_KEY='sb_publishable_UyRdSKmkm8JQmYAy1MBJgg_uFg3_-CU'
npm start                       # http://localhost:3000
```

السيرفر بيولّد `/config.js` من متغيرات البيئة، فالمفاتيح مش مكتوبة في الكود.

## 6. النشر على Railway

اربط الريبو، وحدّد متغيرين في Settings → Variables:

| المتغير | القيمة |
|---|---|
| `SUPABASE_URL` | `https://xfttxitgwqvqztssbxra.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` |

`railway.json` فيه أمر التشغيل و`healthcheckPath: /healthz`، فالنشر مش محتاج أي إعداد
إضافي. Railway بيدي `PORT` لوحده والسيرفر بيقراه.

## 7. اختبارات

```bash
bash tools/run_db_tests_local.sh    # محتاج Docker: 176 assertion على Postgres محلي
python3 tools/static_sql_check.py   # فحص SQL بدون قاعدة بيانات
```

الاختبارات بتشتغل على قاعدة محلية فيها shim لـ Supabase (`tools/local_supabase_shim.sql`)،
فمش بتلمس مشروعك الحقيقي.

## سياسة الأسرار

`.env` مش بيتعمل commit. المتصفح بيشوف **URL + publishable key بس**. مفتاح
`service_role` و`SUPABASE_DB_URL` للتنصيب المحلي فقط، وعمرهم ما يدخلوا الريبو.
