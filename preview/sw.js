/* Service worker — التطبيق يفتح من غير نت.
   غيّر VERSION عشان تمسح الكاش القديم عند أي نشر.

   قاعدة أساسية: طلبات Supabase (cross-origin) عمرها ما بتتلمس. البيانات
   لازم تيجي من الشبكة دايماً، والكاش هنا للواجهة بس (HTML/JS/CSS).
   لو كاشّينا ردود الـ API، المستخدم كان هيشوف أرقام قديمة ويحسب عليها. */

const VERSION = 'v2';
const SHELL = `factory-shell-${VERSION}`;
const KEEP = [SHELL];

/* الملفات اللي لازم تتخزن وقت التثبيت عشان التطبيق يفتح offline من أول مرة. */
const PRECACHE = ['/', '/index.html', '/app.js', '/db.js', '/config.js', '/manifest.json'];

const OFFLINE_HTML = `<!doctype html>
<html lang="ar" dir="rtl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>مفيش نت</title>
<body style="font-family:Tahoma,sans-serif;padding:2rem;text-align:center;background:#f6f4ef;color:#222">
<h1>مفيش نت</h1>
<p>الصفحة دي مفتوحة قبل كده، بس محتاجة نت عشان تجيب بيانات جديدة.</p>
<p style="color:#666;font-size:.95rem">بيانات المصنع بتتحدث لحظة بلحظة من السيرفر،
فالتطبيق مش بيحتفظ بنسخة قديمة منها.</p>
<button onclick="location.reload()" style="font-size:1.1rem;padding:.6rem 1.5rem;margin-top:1rem">حاول تاني</button>
</body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      /* addAll بيرفض كله لو ملف واحد فشل، فبنخزّن كل ملف لوحده. */
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('factory-') && !KEEP.includes(k)).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

const cacheable = (res) => res && res.ok && res.type === 'basic' && !res.redirected;

/* مفتاح الكاش من غير الـ query. index.html بيطلب /app.js?v=27، ولو خزّناه
   بالمفتاح الكامل الطلب ده مايلاقيش حاجة offline. كل الـ query strings هنا
   cache-busters، فالتجاهل آمن. */
const keyOf = (url) => url.origin + url.pathname;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* Supabase وواجهات الـ API: شبكة بس، وممنوع أي كاش. */
  if (url.origin !== self.location.origin) return;

  /* الفحص الصحي والـ service worker نفسه مايتكاشوش أبداً. */
  if (url.pathname === '/healthz' || url.pathname === '/sw.js') return;

  const key = keyOf(url);

  /* الشبكة الأول للكود: عشان أي تعديل يوصل، والكاش بس لو النت قطع. */
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (cacheable(res)) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(key);
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const shell = await caches.match(keyOf(new URL('/index.html', self.location.origin)));
          if (shell) return shell;
          return new Response(OFFLINE_HTML, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
        return new Response('', { status: 504 });
      }),
  );
});
