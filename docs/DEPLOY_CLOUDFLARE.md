# النشر على Cloudflare Pages

التطبيق كله ملفات ثابتة: `preview/` بيتقدّم زي ما هو، والمتصفح بيكلم Supabase
مباشرة. مفيش سيرفر Node في المسار ده، فمفيش cold start ومفيش سيرفر يقف.

## ليه ده آمن مع إن المفتاح في ملف ثابت

`preview/config.js` فيه `sb_publishable_...`. المفتاح ده مش سر — Supabase
بتبعت نفس النوع للمتصفح في أي تطبيق، والحماية بتيجي من الصلاحيات مش من
إخفاء المفتاح.

اتأكدنا من ده بالفعل على المشروع الفعلي: دور `anon` بياخد **401** على القراءة
والكتابة في كل جدول (`42501` = صلاحيات ناقصة)، و`/auth/v1/admin/users` كذلك.
يعني حتى لو حد لقي المفتاح، مش هيقدر يقرأ صف واحد من غير جلسة مستخدم حقيقية.

**متحطّ في الريبو أبدًا:** `service_role` key أو كلمة سر القاعدة. دول بيتخطّوا
RLS بالكامل.

## النشر — الطريقة الأولى: ربط GitHub

أسهل طريقة، ومناسبة لو عايز كل push ينشر لوحده.

1. ادخل [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create**.
2. اختار **Pages** → **Connect to Git**.
3. اختار ريبو `Garment-Factory-System` والفرع اللي عايز تنشر منه.
4. في إعدادات البناء:

| الحقل | القيمة |
|---|---|
| Framework preset | **None** |
| Build command | `npm run build` |
| Build output directory | `dist` |

5. **Save and Deploy**.

الـ build مجرد نسخ: `tools/build-static.js` بينقل `preview/` لـ `dist/`،
وبيفشل لو أي ملف أساسي ناقص. مفيش تحويل ولا تحزيم، فبيخلص في أقل من ثانية.

## لو ظهر خطأ `Failed: error occurred while running deploy command`

السبب الأشهر: Cloudflare بيلاقي `package.json` فيشغّل `npm run build` تلقائياً،
ولو الريبو مش فيه سكربت اسمه `build` بيفشل فوراً. السكربت موجود دلوقتي،
والـ `package-lock.json` اتولّد من جديد لأنه كان لسه شايل تبعيات Next.js من
نسخة قديمة من المشروع — تعارض بين `package.json` والـ lock بيوقّف `npm ci`.

لو الخطأ فضل، شوف اللوج في **Deployments → آخر نشر → View build log**.
أول سطر خطأ هو المهم، والباقي غالباً تبعات.

## النشر — الطريقة الثانية: أمر واحد من الطرفية

محتاج توكن واحد بس:

1. [dash.cloudflare.com](https://dash.cloudflare.com) → أيقونة الحساب → **My Profile**
   → **API Tokens** → **Create Token**.
2. اختار **Custom token** وحط الصلاحية:
   `Account` → `Cloudflare Pages` → **Edit**.
3. انسخ التوكن (بيظهر مرة واحدة) وحطه كـ secret اسمه `CLOUDFLARE_API_TOKEN`.

بعد كده:

```bash
bash tools/deploy-cloudflare.sh
```

السكربت بيتحقق من التوكن، بيبني `dist/`، بيعمل المشروع لو مش موجود،
بيرفع، وبعدها بيشغّل `smoke_test.py` على الرابط المنشور. لو أي خطوة فشلت
بيوقف ويقول السبب — مش بيقول "تم" وهو فاشل.

`Account ID` مش محتاج تحدده، السكربت بيجيبه من التوكن. لو عندك أكتر من حساب
حدده في `CLOUDFLARE_ACCOUNT_ID`.

**مهم:** التوكن ده بيدير حسابك عند Cloudflare. متحطّهوش في الريبو ولا في
أي ملف متعقّب في git — secret في البيئة بس.

## التحقق بعد النشر

الـ `/healthz` هنا ملف ثابت بيرجع `ok`، فهو **مش** بيفحص Supabase. النشر
الأخضر مش دليل إن الداتابيز متوصلة. الاختبار الحقيقي:

```bash
python3 tools/smoke_test.py https://<project>.pages.dev
```

بعدين افتح الموقع وسجّل دخول. لو الدخول نجح، يبقى الاتصال بـ Supabase سليم.

## إيه اللي بيتغيّر عن تشغيل Node

`server.js` فضل موجود وبيشتغل على Railway أو أي استضافة فيها Node. الفرق إنه
بيولّد `/config.js` من متغيرات البيئة وقت الطلب، بينما على Cloudflare الملف
ثابت. الاتنين بيصدّروا نفس المتغيرين (`window.OB_SUPABASE_URL` و
`window.OB_SUPABASE_KEY`)، فالواجهة مش بتفرّق.

| | Node (`server.js`) | Cloudflare Pages |
|---|---|---|
| `config.js` | بيتولّد وقت الطلب من env | ملف ثابت في الريبو |
| تغيير مشروع Supabase | غيّر env واعمل restart | عدّل الملف واعمل push |
| الرؤوس الأمنية | في الكود | `preview/_headers` |
| `/healthz` | بيرد `ok` من السيرفر | ملف ثابت فيه `ok` |

## حاجات لسه ناقصة

- **الـ service worker بيغطي الواجهة بس.** التطبيق بيفتح offline، بس
  البيانات لازم نت لأنها بتيجي من Supabase مباشرة. ده مقصود: عرض أرقام قديمة
  للمستخدم في المصنع أخطر من رسالة "مفيش نت".
- **`/healthz` مش بيفحص حاجة** على Cloudflare. لو عايز مراقبة حقيقية، استخدم
  Cloudflare Health Checks أو ping لـ Supabase REST مباشرة.
