#!/usr/bin/env node
/* يجهّز نسخة النشر الثابتة: preview/ → dist/.

   Cloudflare Pages بيشغّل `npm run build` تلقائياً لما يلاقي package.json،
   وبيتوقع مجلد ناتج اسمه dist. المشروع ملهوش خطوة بناء حقيقية، فالسكربت ده
   مجرد نسخ — وجوده بيخلّي الإعدادات الافتراضية تنشر من غير أي ضبط يدوي. */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'preview');
const out = path.join(root, 'dist');

/* ملفات مساعدة للتطوير المحلي، مالها لازمة في النشر. */
const SKIP = new Set(['serve.js', '.DS_Store', 'Thumbs.db']);

if (!fs.existsSync(src)) {
  console.error('preview/ مش موجود — مفيش حاجة تتنسخ');
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

let count = 0;
for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
  if (SKIP.has(entry.name)) continue;
  fs.cpSync(path.join(src, entry.name), path.join(out, entry.name), {
    recursive: true,
    filter: (from) => !SKIP.has(path.basename(from)),
  });
  count += 1;
}

/* لو الملفات دي ضاعت، النشر بيبان أخضر وهو مكسور. */
for (const required of ['index.html', 'app.js', 'db.js', 'config.js', 'sw.js']) {
  if (!fs.existsSync(path.join(out, required))) {
    console.error(`ملف ناقص في النسخة الناتجة: ${required}`);
    process.exit(1);
  }
}

console.log(`dist/ جاهز — ${count} مدخل`);
