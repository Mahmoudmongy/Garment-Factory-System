# نظام إدارة مصنع ملابس (CMT)

تطبيق ويب عربي RTL لإدارة تشغيل مصنع ملابس: أوامر تشغيل، مراحل الإنتاج، البانلات،
العمال، الأجور بالقطعة، الخامات، المخازن، العملاء، والخزنة. شغّال كـ PWA على الموبايل.

## المكدّس

| الطبقة | التقنية |
|---|---|
| الواجهة | HTML/CSS/JS بدون build — `preview/` |
| البيانات | Supabase (PostgREST + Auth + PostgreSQL 15) |
| المنطق | 38 دالة `rpc_*` في القاعدة — كل كتابة بتعدي من دالة |
| الأمان | RLS: قراءة فقط للجداول، وكل كتابة عبر `rpc_*` |
| التشغيل | Cloudflare Pages (ملفات ثابتة) أو `server.js` على Railway |

**القاعدة هي مصدر الحقيقة الوحيد.** مفيش رصيد مخزّن: كل رصيد بيتحسب من صفوف الـ ledger
وقت القراءة.

## التشغيل السريع

```bash
export SUPABASE_URL='https://xfttxitgwqvqztssbxra.supabase.co'
export SUPABASE_PUBLISHABLE_KEY='sb_publishable_...'
npm start        # http://localhost:3000
```

الإعداد الكامل من الصفر (الجداول، أول أدمن، النشر): [`docs/SETUP.md`](docs/SETUP.md).

النشر على Cloudflare Pages: [`docs/DEPLOY_CLOUDFLARE.md`](docs/DEPLOY_CLOUDFLARE.md).

## الاختبارات

```bash
bash tools/run_db_tests_local.sh   # 176 assertion على Postgres محلي (محتاج Docker)
python3 tools/static_sql_check.py  # فحص SQL بدون قاعدة بيانات
```

## المستندات

- [`docs/ANALYSIS.md`](docs/ANALYSIS.md) — تحليل المشروع المرجعي ومقارنة الحالة
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — الطبقات والقواعد المعمارية
- [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md) — نظام الصلاحيات والأدوار
- [`docs/SETUP.md`](docs/SETUP.md) — التنصيب والنشر خطوة بخطوة

## الأسرار

المتصفح بيشوف **URL + publishable key بس**. مفتاح `service_role` وكلمة سر القاعدة
للتنصيب المحلي فقط وعمرهم ما يدخلوا الريبو.
