'use strict';

/* سيرفر الإنتاج — بيخدم preview/ كملفات ثابتة ويولّد /config.js من متغيرات البيئة.
   عشان مفاتيح المشروع تتبدّل على Railway من غير أي rebuild أو تعديل في الكود. */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, 'preview');
const PORT = Number(process.env.PORT || 3000);

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set.');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const configJs = () =>
  `window.OB_SUPABASE_URL=${JSON.stringify(SUPABASE_URL)};`
  + `window.OB_SUPABASE_KEY=${JSON.stringify(SUPABASE_KEY)};`;

const send = (res, status, body, type, extra) => {
  res.writeHead(status, Object.assign({
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  }, extra || {}));
  res.end(body);
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === '/config.js') {
    return send(res, 200, configJs(), TYPES['.js'], { 'Cache-Control': 'no-store' });
  }

  if (pathname === '/healthz') {
    return send(res, 200, 'ok', 'text/plain; charset=utf-8');
  }

  if (pathname === '/') pathname = '/index.html';

  /* منع الخروج من مجلد preview */
  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'forbidden', 'text/plain; charset=utf-8');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return send(res, 404, 'not found', 'text/plain; charset=utf-8');
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = TYPES[ext] || 'application/octet-stream';
    /* app.js/db.js/index.html لازم يتحدّثوا فورًا بعد أي نشر. */
    const cache = ext === '.html' || ext === '.js'
      ? 'no-cache'
      : 'public, max-age=3600';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`listening on :${PORT} — supabase ${SUPABASE_URL}`);
});
