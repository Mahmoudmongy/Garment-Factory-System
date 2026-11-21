'use strict';

/* ============================================================================
   نظام المصنع — تطبيق الواجهة
   كل شاشة تقرأ من عرض (view) في قاعدة البيانات وتكتب عن طريق دوال rpc_*،
   فالواجهة ما بتقررش أي قاعدة عمل بنفسها.
   ========================================================================== */

const $ = (s) => document.querySelector(s);
const app = $('#app');

/* ---------------------------------------------------------------- تنسيق */
const money = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';
const num = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateAr = (d) => {
  if (!d) return '—';
  const x = new Date(String(d).length <= 10 ? d + 'T00:00:00' : d);
  if (isNaN(x)) return '—';
  return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
};

/* ---------------------------------------------------------------- API */
/* التنفيذ في db.js — بيضرب Supabase مباشرة بجلسة المستخدم. */
const view = (name, params) => OB.view(name, params);
const table = (name, params) => OB.table(name, params);
const rpc = (fn, args) => OB.rpc(fn, args);
const meta = () => OB.meta();

/* أكواد الأخطاء الثابتة اللي بترفعها قاعدة البيانات. */
const ERRORS = {
  E_PERM: 'مالكش صلاحية للعملية دي',
  E_NAME_REQUIRED: 'اكتب الاسم', E_LETTER_TAKEN: 'حرف التشغيل ده مستخدم قبل كده',
  E_LETTERS_EXHAUSTED: 'خلصت الحروف المتاحة', E_NOT_FOUND: 'مش موجود',
  E_QTY_POSITIVE: 'الكمية لازم تكون أكبر من صفر', E_AMOUNT_POSITIVE: 'المبلغ لازم يكون أكبر من صفر',
  E_WHOLE_PIECES: 'القطع لازم تكون أعداد صحيحة', E_COLOUR_REQUIRED: 'اكتب اللون',
  E_COLOUR_SIZE_REQUIRED: 'اللون والمقاس مطلوبين', E_NOTHING_TO_CUT: 'مفيش كميات للقص',
  E_OVER_CUT: 'الكمية أكبر من الباقي في الأمر', E_ORDER_NOT_OPEN: 'الأمر مش مفتوح',
  E_USERNAME_REQUIRED: 'اكتب اسم المستخدم', E_USERNAME_TAKEN: 'اسم المستخدم ده محجوز',
  E_USERNAME_INVALID: 'اسم المستخدم لازم ٣ حروف على الأقل، حروف إنجليزي صغيرة وأرقام و . _ - بس',
  E_EMPLOYEE_HAS_LOGIN: 'الصنايعي ده ليه حساب دخول بالفعل',
  E_EMPLOYEE_INACTIVE: 'الصنايعي موقوف، مش ممكن نعمل له حساب',
  E_ROLE_REQUIRED: 'لازم دور واحد على الأقل',
  E_CANNOT_DISABLE_SELF: 'مش ممكن توقف حسابك انت',
  E_CANNOT_EDIT_OWN_PERMS: 'مش ممكن تعدّل صلاحياتك انت — ده بيسمح بالترقية الذاتية',
  E_BUNDLE_NOT_FOUND: 'الشنطة مش موجودة', E_BUNDLE_CANCELLED: 'الشنطة ملغية',
  E_STAGE_UNKNOWN: 'المرحلة مش موجودة في الأمر', E_STAGE_NOT_READY: 'المراحل السابقة لسه ما خلصتش',
  E_ASSIGNMENT_OPEN_NOT_FOUND: 'مفيش تسليم مفتوح للشنطة دي',
  E_QTY_MISMATCH: 'المقبول والمرفوض والإعادة لازم يساووا الكمية',
  E_REJECT_REASON_REQUIRED: 'اكتب سبب الرفض', E_REASON_REQUIRED: 'اكتب السبب',
  E_DESCRIPTION_REQUIRED: 'اكتب الوصف', E_ALREADY_REVERSED: 'العملية دي اتعملها عكس قبل كده',
  E_ALREADY_REVERSAL: 'دي عملية عكس ومينفعش تتعكس', E_CUSTOMER_NOT_FOUND: 'العميل مش موجود',
  E_OVER_DELIVERY: 'الكمية أكبر من الجاهز للتسليم', E_ORDER_REQUIRED: 'اختار الأمر',
  E_OVER_ISSUE: 'الكمية أكبر من المتاح في المخزن',
};
const humanError = (e) => {
  /* fetch بيرمي TypeError من غير أي كود لما الشبكة تقطع. الرسالة الخام
     "Failed to fetch" مش مفهومة لمستخدم في المصنع. */
  if (e instanceof TypeError && !e.status) {
    return navigator.onLine === false
      ? 'مفيش نت على الجهاز. البيانات بتيجي من السرفر، فوصّل الواي فاي أو الداتا وحاول تاني'
      : 'السرفر مش راد. النت شغال بس مش بنوصل للسرفر — استنى شوية وحاول تاني';
  }
  const [code, detail] = String(e.message || '').split('|');
  return (ERRORS[code] || code) + (detail ? ' (' + detail + ')' : '');
};

/* ---------------------------------------------------------------- القائمة */
const NAV = [
  { group: 'الشغل اليومي', items: [
    { key: 'home', label: 'الرئيسية', icon: '🏠' },
    { key: 'foreman', label: 'رئيس العمال', icon: '📦', perm: 'production.assignment.create' },
    { key: 'orders', label: 'أوامر التشغيل', icon: '🧵', perm: 'production.order.view' },
    { key: 'warehouse', label: 'المخزن', icon: '🏬', perm: 'inventory.view' },
    { key: 'help', label: 'المساعدة', icon: '❓' },
  ]},
  { group: 'الحسابات', items: [
    { key: 'customers', label: 'العملاء', icon: '👥', perm: 'customer.view' },
    { key: 'workers', label: 'الصنايعية والحسابات', icon: '🧑‍🏭', perm: 'employee.view' },
    { key: 'accounts', label: 'الخزنة والبنوك', icon: '💰', perm: 'account.view' },
    { key: 'expenses', label: 'المصروفات', icon: '🧾', perm: 'expense.view' },
    { key: 'supplies', label: 'المستلزمات', icon: '🪡', perm: 'inventory.view' },
  ]},
  { group: 'الإدارة', items: [
    { key: 'machines', label: 'الماكينات', icon: '⚙️', perm: 'machine.view' },
    { key: 'analytics', label: 'لوحة المدير', icon: '📊', perm: 'reports.view' },
    { key: 'reports', label: 'التقارير', icon: '📄', perm: 'reports.view' },
    { key: 'users', label: 'المستخدمون والصلاحيات', icon: '🔐', perm: 'system.user.manage' },
    { key: 'import', label: 'استيراد البيانات', icon: '⬆️', perm: 'system.user.manage' },
    { key: 'audit', label: 'سجل التعديلات', icon: '🕘', perm: 'audit.view' },
  ]},
];
const TABS = [
  ['home', 'الرئيسية', '🏠'], ['foreman', 'التسليم', '📦'],
  ['orders', 'الأوامر', '🧵'], ['customers', 'العملاء', '👥'], ['more', 'المزيد', '☰'],
];

let PROFILE = null;
let META = { stages: [], accounts: [], permissions: [], roles: [] };

// The database is the authority; this only decides what the screen offers.
function can(code) {
  if (PROFILE?.is_superuser) return true;
  return (META.granted || []).includes(code);
}

function renderShell(activeKey) {
  const initial = (PROFILE?.display_name || 'م').trim().charAt(0);
  $('#sidebar').innerHTML = `
    <div class="sb-brand">
      <div class="sb-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle>
          <path d="M8.1 8.1 20 20M8.1 15.9 20 4"></path>
        </svg>
      </div>
      <div>
        <div class="sb-title">نظام المصنع</div>
        <div class="sb-sub">إدارة تشغيل المصنع</div>
      </div>
    </div>
    ${NAV.map((g) => {
      const items = g.items.filter((i) => !i.perm || can(i.perm));
      if (!items.length) return '';
      return `<div class="sb-group">${esc(g.group)}</div>
      ${items.map((i) => `
        <a class="sb-link${i.key === activeKey ? ' active' : ''}" href="#${i.key}">
          <span class="ico">${i.icon}</span>${esc(i.label)}
        </a>`).join('')}`;
    }).join('')}
    <div class="sb-foot">
      <div class="sb-avatar">${esc(initial)}</div>
      <div>
        <div class="sb-user">${esc(PROFILE?.display_name || 'المدير')}</div>
        <div class="sb-role">${esc(PROFILE?.is_superuser ? 'مدير النظام' : 'مستخدم')}</div>
      </div>
      <button class="sb-out" id="sbOut" title="خروج">خروج</button>
    </div>`;

  $('#tabbar').innerHTML = TABS.map(([k, label, icon]) =>
    `<button data-go="${k}" class="${k === activeKey ? 'active' : ''}">
       <span>${icon}</span>${label}</button>`).join('');

  const out = $('#sbOut');
  if (out) out.onclick = signOut;
}

async function signOut() {
  try { await OB.signOut(); } catch (e) { /* الخروج المحلي كفاية */ }
  try { sessionStorage.clear(); } catch (e) { /* التخزين ممكن يكون مقفول */ }
  location.reload();
}

/* ---------------------------------------------------------------- الدخول */
/* أول حاجة بتظهر. مفيش بيانات بتيجي من القاعدة قبل نجاح الدخول. */
function renderLogin() {
  const root = $('#app');
  $('#sidebar').innerHTML = '';
  const tabbar = $('#tabbar');
  if (tabbar) tabbar.innerHTML = '';
  document.body.classList.add('auth-locked');

  root.innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="loginForm" autocomplete="on">
        <div class="login-brand">
          <div class="login-logo">🧵</div>
          <h1>نظام المصنع</h1>
          <p>إدارة تشغيل المصنع — دخول الموظفين</p>
        </div>
        <label for="lgUser">اسم المستخدم</label>
        <input id="lgUser" name="username" autocapitalize="none" autocorrect="off"
               spellcheck="false" dir="ltr" required>
        <label for="lgPass">كلمة السر</label>
        <input id="lgPass" name="password" type="password" dir="ltr" required>
        <div class="login-err" id="lgErr" role="alert"></div>
        <button class="login-btn" id="lgBtn" type="submit">دخول</button>
        <p class="login-foot">لو مش عندك حساب، كلّم مدير النظام.</p>
      </form>
    </div>`;

  const form = $('#loginForm');
  const err = $('#lgErr');
  const btn = $('#lgBtn');

  form.onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = '';
    const username = $('#lgUser').value.trim();
    const password = $('#lgPass').value;
    if (!username || !password) { err.textContent = 'اكتب اسم المستخدم وكلمة السر'; return; }
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'جاري الدخول...';
    try {
      await OB.signIn(username, password);
      location.reload();
    } catch (ex) {
      const m = String(ex.message || '');
      err.textContent = /invalid|credentials|400/i.test(m)
        ? 'اسم المستخدم أو كلمة السر غلط'
        : 'تعذر الدخول: ' + m;
      btn.disabled = false;
      btn.textContent = label;
    }
  };

  $('#lgUser').focus();
}

/* ---------------------------------------------------------------- عناصر */
function tbl(cols, rows, emptyText) {
  if (!rows || !rows.length) return `<div class="empty">${esc(emptyText || 'مفيش بيانات')}</div>`;
  return `<div class="tbl-wrap"><table>
    <thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${cols.map((c) => {
      const v = c.render ? c.render(r) : esc(r[c.key] == null ? '—' : r[c.key]);
      return `<td class="${c.num ? 'num' : ''}${c.wrap ? ' wrap' : ''}">${v}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/* Stage codes live in the DB; the UI always speaks Arabic. */
let STAGE_NAMES = {};
const stageAr = (code) => (code ? (STAGE_NAMES[code] || code) : '—');
const depList = (deps) => {
  const list = Array.isArray(deps) ? deps : [];
  return list.length ? list.map(stageAr).join('، ') : 'من البداية';
};

/* One bundle as one line of text: code, size, colour (only when there is one), pieces. */
const bundleLabel = (q) => `${q.bundle_code} — ${q.size}`
  + (q.colour ? ' · ' + colourAr(q.colour_label || q.colour) : '')
  + ` (${num(q.quantity)})`;

/* An order cut by size alone has no colour; never show an empty cell. */
const colourAr = (v) => (v == null || String(v).trim() === '' ? '—' : String(v));

/* XS → S → M → L → XL … so bundles read in a familiar order. */
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL', '6XL'];
const sizeRank = (s) => {
  const i = SIZE_ORDER.indexOf(String(s || '').trim().toUpperCase());
  if (i >= 0) return i;
  return /^\d+$/.test(String(s || '').trim()) ? 100 + Number(s) : 90;
};
const sizeCmp = (a, b) => sizeRank(a) - sizeRank(b) || String(a).localeCompare(String(b));

/* Bundle order: colours first (when the order has any), then sizes within each. */
function sortBundles(rows) {
  return rows.slice().sort((a, b) => {
    const ca = a.colour || '', cb = b.colour || '';
    if (ca !== cb) return ca.localeCompare(cb, 'ar');
    return sizeCmp(a.size, b.size) || String(a.code).localeCompare(String(b.code));
  });
}

/* Group bundles for display: by colour then size when colours exist, else by size. */
function groupBundles(rows) {
  const hasColour = rows.some((b) => b.colour);
  const groups = new Map();
  rows.forEach((b) => {
    const key = hasColour ? `${b.colour}||${b.size}` : b.size;
    if (!groups.has(key)) {
      groups.set(key, {
        colour: hasColour ? (b.colour || null) : null, size: b.size,
        colour_label: hasColour ? (b.colour_label || b.colour || null) : null,
        bundles: [], quantity: 0, first_code: b.first_code, last_code: b.last_code,
      });
    }
    const g = groups.get(key);
    g.bundles.push(b);
    g.quantity += Number(b.quantity);
    if (b.first_code && (!g.first_code || b.first_code < g.first_code)) g.first_code = b.first_code;
    if (b.last_code && (!g.last_code || b.last_code > g.last_code)) g.last_code = b.last_code;
  });
  const list = [...groups.values()];
  list.sort((a, b) => (a.colour || '').localeCompare(b.colour || '', 'ar') || sizeCmp(a.size, b.size));
  return { hasColour, groups: list };
}

const STATUS = {
  open: ['chip-open', 'مفتوح'], completed: ['chip-done', 'مكتمل'], cancelled: ['chip-bad', 'ملغي'],
  pending: ['chip-idle', 'لسه'], in_progress: ['chip-warn', 'شغال'], done: ['chip-done', 'خلص'],
  finished: ['chip-done', 'جاهز'], delivered: ['chip-done', 'اتسلّم'],
};

/* Movement / warehouse kinds are stored as English codes. */
const MOVES = {
  receive: 'استلام', cut: 'قص', issue: 'صرف', return: 'مرتجع',
  in: 'دخول', out: 'خروج', adjust: 'تسوية', transfer: 'تحويل',
  purchase: 'شراء', customer_receipt: 'استلام من عميل',
  transfer_in: 'تحويل وارد', transfer_out: 'تحويل صادر', adjustment: 'تسوية جرد',
};
const moveAr = (m) => (m ? (MOVES[m] || m) : '—');
const WAREHOUSE_KINDS = {
  main: 'رئيسي', customer: 'عميل', factory: 'مصنع', scrap: 'هالك',
  customer_fabric: 'قماش العملاء', factory_consumables: 'مستلزمات المصنع',
  finished_goods: 'التام', raw_materials: 'خامات',
  customer_supplies: 'مستلزمات العملاء', returns: 'مرتجعات',
};
const warehouseKindAr = (k) => (k ? (WAREHOUSE_KINDS[k] || k) : '—');

const RETURN_DISP = { rework: 'يتعاد تشغيله', scrap: 'يتعدم', stock: 'يرجع للمخزن' };
const returnDispAr = (d) => (d ? (RETURN_DISP[d] || d) : '—');

const ITEM_CATEGORIES = {
  fabric: 'قماش', thread: 'خيوط', zipper: 'سحابات', button: 'أزرار',
  packaging: 'تغليف', accessory: 'إكسسوار', other: 'أخرى',
};
const itemCategoryAr = (c) => (c ? (ITEM_CATEGORIES[c] || c) : '—');

/* Must match financial_transactions_category_check exactly — anything outside
   this set is rejected by the database with 23514. */
const TXN_CATEGORIES = {
  customer_payment: 'تحصيل من عميل',
  worker_payment: 'صرف أجر صنايعي',
  expense: 'مصروف',
  supply_purchase: 'شراء مستلزمات',
  capital: 'رأس مال',
  transfer: 'تحويل',
  other: 'أخرى',
};
const txnCategoryAr = (c) => (c ? (TXN_CATEGORIES[c] || c) : '—');
const categoryOptions = (selected) => Object.entries(TXN_CATEGORIES).map(([k, v]) =>
  `<option value="${k}"${k === selected ? ' selected' : ''}>${v}</option>`).join('');
const chip = (s) => {
  const [cls, label] = STATUS[s] || ['chip-idle', s || '—'];
  return `<span class="chip ${cls}">${esc(label)}</span>`;
};

function loading() { app.innerHTML = '<div class="empty">بيحمّل…</div>'; }
function fail(e) {
  app.innerHTML = `<div class="err">${esc(humanError(e))}</div>
    <button class="btn btn-ghost" onclick="location.reload()">إعادة تحميل</button>`;
}
const go = (h) => { location.hash = h; };

/* نموذج تعديل بسيط: بيرجّع قيم الحقول أو null لو المستخدم قفل.
   الحقول: {key, label, value, type?} */
function formDialog(title, fields) {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'mask';
    mask.innerHTML = `<form class="modal">
      <h3>${esc(title)}</h3>
      ${fields.map((f) => `<div class="field">
        <label class="label" for="fd-${esc(f.key)}">${esc(f.label)}</label>
        <input class="input" id="fd-${esc(f.key)}" name="${esc(f.key)}"
          type="${esc(f.type || 'text')}" value="${esc(f.value ?? '')}">
      </div>`).join('')}
      <div class="acts">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-ghost" data-cancel>إلغاء</button>
      </div>
    </form>`;
    document.body.appendChild(mask);

    const form = mask.querySelector('form');
    const close = (val) => { mask.remove(); resolve(val); };

    form.onsubmit = (e) => {
      e.preventDefault();
      const out = {};
      fields.forEach((f) => { out[f.key] = form.elements[f.key].value.trim(); });
      close(out);
    };
    mask.querySelector('[data-cancel]').onclick = () => close(null);
    mask.onclick = (e) => { if (e.target === mask) close(null); };
    mask.onkeydown = (e) => { if (e.key === 'Escape') close(null); };
    form.elements[fields[0].key].focus();
  });
}

/* ============================================================================
   الباركود — Code128B بحساب التحقق، مرسوم SVG
   ========================================================================== */
const C128 = ('212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,' +
  '221312,231212,112232,122132,122231,113222,123122,123221,223211,221132,' +
  '221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,' +
  '212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,' +
  '231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,' +
  '231131,213113,213311,213131,311123,311321,331121,312113,312311,332111,' +
  '314111,221411,431111,111224,111422,121124,121421,141122,141221,112214,' +
  '112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,' +
  '111242,121142,121241,114212,124112,124211,411212,421112,421211,212141,' +
  '214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,' +
  '114131,311141,411131,211412,211214,211232,2331112').split(',');

/* يرجّع مصفوفة أطوال: بار، فراغ، بار، فراغ… */
function code128B(text) {
  const codes = [104];
  for (const ch of String(text)) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) continue;
    codes.push(c - 32);
  }
  let sum = 104;
  codes.forEach((c, i) => { if (i > 0) sum += c * i; });
  codes.push(sum % 103);
  codes.push(106);

  const widths = [];
  codes.forEach((c) => {
    for (const d of C128[c]) widths.push(Number(d));
  });
  return widths;
}

/* باركود SVG. العرض بيتحسب من عدد الوحدات عشان يفضل مقروء. */
function barcodeSVG(text, opts) {
  const o = Object.assign({ height: 46, unit: 1.7, quiet: 10 }, opts || {});
  const widths = code128B(text);
  const totalUnits = widths.reduce((a, b) => a + b, 0);
  const w = totalUnits * o.unit + o.quiet * 2;
  let x = o.quiet;
  let bars = '';
  widths.forEach((wid, i) => {
    const px = wid * o.unit;
    if (i % 2 === 0) bars += `<rect x="${x.toFixed(2)}" y="0" width="${px.toFixed(2)}" height="${o.height}" fill="#000"/>`;
    x += px;
  });
  return `<svg class="barcode" width="${w.toFixed(0)}" height="${o.height}" viewBox="0 0 ${w.toFixed(0)} ${o.height}"
    xmlns="http://www.w3.org/2000/svg" role="img" aria-label="باركود ${esc(text)}">
    <rect width="100%" height="100%" fill="#fff"/>${bars}</svg>`;
}

/* ============================================================================
   PDF — بنطبع مستند في نافذة مستقلة، والمتصفح بيحوّله PDF بحفظ الصفحة
   ========================================================================== */
function printDoc(title, bodyHtml, opts) {
  const o = Object.assign({ back: '#f8f8f6' }, opts || {});
  const w = window.open('', '_blank');
  if (!w) { alert('المتصفح منع فتح النافذة — اسمح بالنوافذ المنبثقة عشان تطبع'); return; }
  w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
  <title>${esc(title)}</title>
  <style>
    @page{size:A4;margin:14mm}
    *{box-sizing:border-box}
    body{margin:0;font-family:"Times New Roman",Times,serif;color:#1c2430;background:#fff;
      font-size:13px;line-height:1.55}
    .sheet{max-width:190mm;margin:0 auto;padding:6mm 0}
    header.doc{display:flex;justify-content:space-between;align-items:flex-start;
      border-bottom:2px solid #0f5c50;padding-bottom:10px;margin-bottom:14px}
    .doc-brand{display:flex;gap:10px;align-items:center}
    .doc-logo{width:40px;height:40px;border-radius:8px;background:#0f5c50;color:#fff;
      display:grid;place-items:center;font-weight:700;font-size:18px}
    .doc-name{font-size:18px;font-weight:700}
    .doc-meta{font-size:11px;color:#4a5566}
    h1.doc-title{font-size:19px;margin:0 0 2px}
    .doc-code{font-size:12px;color:#4a5566}
    .party{display:flex;gap:24px;flex-wrap:wrap;margin:14px 0}
    .party div{font-size:12px}
    .party b{display:block;font-size:11px;color:#636c7d;font-weight:700;margin-bottom:2px}
    table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
    th,td{border:1px solid #d8d3c8;padding:6px 8px;text-align:start}
    th{background:${o.back};font-size:11px}
    td.num,th.num{text-align:end}
    tfoot td{font-weight:700;background:${o.back}}
    .totals{margin-top:10px;margin-inline-start:auto;width:62%}
    .totals tr td{border:none;padding:3px 8px}
    .totals tr td:last-child{text-align:end;font-variant-numeric:tabular-nums}
    .totals tr.grand td{border-top:1.5px solid #1c2430;font-size:14px;font-weight:700;padding-top:6px}
    .sign{display:flex;justify-content:space-between;margin-top:34px;font-size:12px}
    .sign div{width:42%;border-top:1px dashed #999;padding-top:6px;text-align:center;color:#4a5566}
    .foot{margin-top:22px;font-size:10px;color:#636c7d;text-align:center;border-top:1px solid #e3ded3;padding-top:8px}
    .bar-area{text-align:center;margin-top:14px}
    .bar-area svg{max-width:100%}
    @media print{ .noprint{display:none!important} }
    .toolbar{position:fixed;top:10px;inset-inline-start:10px;display:flex;gap:8px;z-index:9}
    .toolbar button{font-family:inherit;font-size:13px;font-weight:700;padding:8px 14px;
      border-radius:8px;border:1px solid #0f5c50;background:#0f5c50;color:#fff;cursor:pointer}
    .toolbar button.alt{background:#fff;color:#0f5c50}
  </style></head><body>
  <div class="toolbar noprint">
    <button onclick="window.print()">طباعة / حفظ PDF</button>
    <button class="alt" onclick="window.close()">إغلاق</button>
  </div>
  <div class="sheet">${bodyHtml}</div>
  </body></html>`);
  w.document.close();
  w.focus();
}

const docHeader = (title, code) => `
  <header class="doc">
    <div class="doc-brand">
      <div class="doc-logo">م</div>
      <div>
        <div class="doc-name">مصنع الملابس</div>
        <div class="doc-meta">نظام المصنع · تشغيل وإنتاج</div>
      </div>
    </div>
    <div style="text-align:end">
      <h1 class="doc-title">${esc(title)}</h1>
      ${code ? `<div class="doc-code">${esc(code)}</div>` : ''}
      <div class="doc-meta">${dateAr(new Date().toISOString())}</div>
    </div>
  </header>`;

/* ============================================================================
   الرئيسية
   ========================================================================== */
async function pageHome() {
  loading();
  const [orders, workers, accounts, fabric] = await Promise.all([
    view('orders'), view('workers'), view('accounts'), view('fabric'),
  ]);
  const open = orders.filter((o) => o.status === 'open');
  const totalQty = orders.reduce((s, o) => s + Number(o.quantity), 0);
  const cutQty = orders.reduce((s, o) => s + Number(o.cut_quantity), 0);
  const ready = orders.reduce((s, o) => s + Number(o.ready_quantity), 0);
  const due = workers.reduce((s, w) => s + Number(w.remaining_due), 0);
  const cash = accounts.reduce((s, a) => s + Number(a.balance), 0);

  app.innerHTML = `
    <h1>أهلاً ${esc(PROFILE?.display_name || '')}</h1>
    <p class="sub">نظرة سريعة على المصنع النهارده</p>

    <div class="grid g3" style="margin-bottom:18px">
      ${can('production.receive') ? `<a class="card" href="#foreman" style="display:flex;gap:12px;align-items:center;margin:0">
        <span style="font-size:24px">📦</span>
        <div><b>تسليم واستلام</b><div class="hint">امسح كود الشنطة</div></div>
      </a>` : ''}
      ${can('production.order.create') ? `<a class="card" href="#order-new" style="display:flex;gap:12px;align-items:center;margin:0">
        <span style="font-size:24px">🧵</span>
        <div><b>أمر جديد</b><div class="hint">افتح أمر تشغيل</div></div>
      </a>` : ''}
      ${can('production.fabric.receive') ? `<a class="card" href="#warehouse" style="display:flex;gap:12px;align-items:center;margin:0">
        <span style="font-size:24px">🏬</span>
        <div><b>استلام قماش</b><div class="hint">سجّل أمتار العميل</div></div>
      </a>` : ''}
    </div>

    <div class="grid g4">
      <div class="kpi"><div class="lbl">أوامر مفتوحة</div>
        <div class="val">${num(open.length)} <small>من ${num(orders.length)}</small></div></div>
      <div class="kpi"><div class="lbl">قطع متقصّة</div>
        <div class="val">${num(cutQty)} <small>من ${num(totalQty)}</small></div>
        <div class="bar" style="margin-top:8px"><i style="width:${totalQty ? Math.round(cutQty / totalQty * 100) : 0}%"></i></div></div>
      <div class="kpi"><div class="lbl">جاهز للتسليم</div><div class="val">${num(ready)}</div></div>
      ${can('worker.financial.view') ? `<div class="kpi"><div class="lbl">مستحق للصنايعية</div><div class="val">${money(due)}</div></div>` : ''}
      ${can('account.view') ? `<div class="kpi"><div class="lbl">الخزنة والبنوك</div><div class="val">${money(cash)}</div></div>` : ''}
      <div class="kpi"><div class="lbl">قماش بالمخزن</div>
        <div class="val">${num(fabric.reduce((s, f) => s + Number(f.balance), 0))} <small>متر</small></div></div>
    </div>

    <h2>أوامر شغالة</h2>
    ${tbl([
      { label: 'الكود', render: (r) => `<a class="link" href="#order/${r.id}">${esc(r.code)}</a>` },
      { label: 'العميل', key: 'customer_name' },
      { label: 'الموديل', key: 'model_name' },
      { label: 'الكمية', num: true, render: (r) => num(r.quantity) },
      { label: 'اتقص', num: true, render: (r) => `${num(r.cut_quantity)}` },
      { label: 'ميعاد التسليم', render: (r) => dateAr(r.due_date) },
      { label: 'التقدم', render: (r) => `<div class="bar" style="width:80px"><i style="width:${r.cut_percent}%"></i></div>` },
      { label: 'الحالة', render: (r) => chip(r.status) },
    ], open.slice(0, 8), 'مفيش أوامر مفتوحة')}
    <div style="margin-top:10px"><a class="link" href="#orders">كل الأوامر ←</a></div>

    <h2>الصنايعية</h2>
    ${tbl([
      { label: 'الكود', key: 'code' },
      { label: 'الصنايعي', render: (r) => `<a class="link" href="#worker/${r.id}">${esc(r.name)}</a>` },
      { label: 'مقبول', num: true, render: (r) => num(r.accepted_total) },
      { label: 'مرفوض', num: true, render: (r) => num(r.rejected_total) },
      { label: 'اتكسب', num: true, render: (r) => money(r.earned_total) },
      { label: 'المتبقي له', num: true, render: (r) => `<b>${money(r.remaining_due)}</b>` },
    ], workers.filter((w) => w.kind === 'worker'), 'مفيش صنايعية')}`;
}

/* ============================================================================
   رئيس العمال — مسح الباركود بالكاميرا + تسليم/استلام
   ========================================================================== */
let scanStream = null;
let scanTimer = null;

async function pageForeman() {
  loading();
  const workers = await view('workers');
  window.__workers = workers.filter((w) => w.kind === 'worker' && w.is_active);

  app.innerHTML = `
    <h1>رئيس العمال</h1>
    <p class="sub">امسح كود الشنطة أو اكتبه، وبعدين سلّم أو استلم</p>

    <div class="card">
      <label class="label">كود الشنطة</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input id="fCode" class="input mono" placeholder="BND0001" autocomplete="off"
               style="flex:1;min-width:180px;font-size:18px;letter-spacing:.08em">
        <button class="btn btn-primary" id="fFind">بحث</button>
        <button class="btn btn-ghost" id="fCam">📷 مسح بالكاميرا</button>
      </div>
      <p class="hint" style="margin:8px 0 0">بيقرأ كود الشنطة (BND…) أو باركود القطعة (MM0001).</p>
      <div id="camBox" style="margin-top:12px"></div>
    </div>

    <div id="fResult"></div>`;

  $('#fFind').onclick = () => lookupBundle($('#fCode').value.trim());
  $('#fCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') lookupBundle(e.target.value.trim()); });
  $('#fCam').onclick = () => startScan();
  $('#fCode').focus();
}

async function startScan() {
  const box = $('#camBox');
  if (!('BarcodeDetector' in window)) {
    box.innerHTML = `<div class="note">المتصفح ده مش بيدعم قراءة الباركود بالكاميرا.
      استخدم كروم على أندرويد، أو اكتب الكود في الخانة فوق.</div>`;
    return;
  }
  if (scanStream) { stopScan(); return; }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) {
    box.innerHTML = `<div class="note">مش قادر أفتح الكاميرا (${esc(e.name)}). لازم تسمح بالكاميرا أو تستخدم HTTPS.</div>`;
    return;
  }
  box.innerHTML = `
    <div style="position:relative;border-radius:12px;overflow:hidden;background:#000;max-width:420px">
      <video id="camVideo" autoplay playsinline muted style="width:100%;display:block"></video>
      <div style="position:absolute;inset:14% 8%;border:2px solid #2dd4bf;border-radius:10px;pointer-events:none"></div>
    </div>
    <div style="margin-top:8px"><button class="btn btn-ghost btn-sm" id="camStop">إيقاف الكاميرا</button></div>`;
  const video = $('#camVideo');
  video.srcObject = scanStream;
  $('#camStop').onclick = stopScan;

  const detector = new BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'qr_code'] });
  scanTimer = setInterval(async () => {
    if (!scanStream || video.readyState < 2) return;
    try {
      const found = await detector.detect(video);
      if (found.length) {
        const value = found[0].rawValue;
        stopScan();
        $('#fCode').value = value;
        lookupBundle(value);
      }
    } catch (e) { /* إطار مش مقروء — نكمل */ }
  }, 250);
}

function stopScan() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (scanStream) {
    scanStream.getTracks().forEach((t) => t.stop());
    scanStream = null;
  }
  const box = $('#camBox');
  if (box) box.innerHTML = '';
}

async function lookupBundle(code) {
  const box = $('#fResult');
  if (!code) { box.innerHTML = '<div class="err">اكتب كود الشنطة</div>'; return; }
  box.innerHTML = '<div class="empty">بيدوّر…</div>';
  const up = code.toUpperCase();

  const bundles = await view('bundles');
  let b = bundles.find((r) => String(r.code).toUpperCase() === up || String(r.barcode || '').toUpperCase() === up);

  // ممكن المستخدم يمسح باركود قطعة (كود تشغيل) — نطلّع الشنطة بتاعتها
  if (!b) {
    const codes = await table('operational_codes', { code: up });
    if (codes.length && codes[0].bundle_id) {
      b = bundles.find((r) => r.id === codes[0].bundle_id);
    }
  }
  if (!b) { box.innerHTML = `<div class="err">مفيش شنطة أو قطعة بالكود ${esc(up)}</div>`; return; }

  const stages = (await view('order_stages', { order_id: b.order_id })).filter((s) => s.order_id === b.order_id);
  // Gating is per bundle: a stage opens only when its own predecessors were
  // received for this bundle, not just somewhere in the order.
  const queue = await view('bundle_queue', { order_id: b.order_id });
  const mine = queue.filter((q) => q.bundle_id === b.id);
  const openStage = mine.find((q) => q.open_assignment);
  const available = mine.filter((q) => q.deps_done && !q.stage_done && !q.open_assignment);
  const stageName = (c) => (stages.find((s) => s.code === c) || {}).name_ar || c;

  box.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:1.3rem;font-weight:700" class="mono">${esc(b.code)}</div>
          <div class="hint">${esc(b.order_code)} · ${esc(b.model_name)} · ${esc(b.customer_name)}</div>
        </div>
        ${chip(b.status)}
      </div>
      <div class="grid g4" style="margin-top:14px">
        <div class="kpi"><div class="lbl">المقاس</div><div class="val">${esc(b.size)}</div></div>
        <div class="kpi"><div class="lbl">اللون</div><div class="val" style="font-size:1rem">${esc(colourAr(b.colour_label))}</div></div>
        <div class="kpi"><div class="lbl">عدد القطع</div><div class="val">${num(b.quantity)}</div></div>
        <div class="kpi"><div class="lbl">المرحلة الحالية</div>
          <div class="val" style="font-size:1rem">${esc(b.current_stage ? stageName(b.current_stage) : '—')}</div></div>
      </div>
      <div style="margin-top:14px;text-align:center">
        ${barcodeSVG(b.barcode || b.code, { height: 52, unit: 1.9 })}
        <div class="hint mono" style="margin-top:4px">${esc(b.barcode || b.code)}</div>
      </div>
      <p class="hint" style="margin:10px 0 0">أكواد التشغيل: <b class="mono">${esc(b.first_code || '—')}</b> →
         <b class="mono">${esc(b.last_code || '—')}</b> (${num(b.code_count)} قطعة)</p>
    </div>

    ${b.current_stage ? `<div class="card" style="border-color:#f3d9a8;background:#fffaf0">
        <b>الشنطة مع ${esc(b.current_holder || '—')}</b>
        <p class="hint" style="margin:6px 0 0">المرحلة: ${esc(stageName(b.current_stage))} — العدد ${num(b.quantity)}</p>
      </div>` : ''}

    <div id="fAction"></div>`;

  if (openStage) renderReceive(b);
  else renderAssign(b, available);
}

function renderAssign(b, available) {
  const box = $('#fAction');
  const workers = window.__workers || [];
  if (!available.length) {
    box.innerHTML = '<div class="card"><div class="empty">كل المراحل المتاحة للشنطة دي خلصت</div></div>';
    return;
  }
  box.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">تسليم شنطة لصنايعي</h2>
      <div class="grid g2">
        <div><label class="label">المرحلة</label>
          <select id="aStage">${available.map((s) =>
            `<option value="${esc(s.stage_code)}">${esc(s.stage_name)} — ${money(s.piece_price)}/قطعة</option>`).join('')}</select></div>
        <div><label class="label">الصنايعي</label>
          <select id="aEmp">${workers.map((w) =>
            `<option value="${esc(w.id)}">${esc(w.name)}${w.job_title ? ' — ' + esc(w.job_title) : ''}</option>`).join('')}</select></div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="aGo">سلّم الشنطة</button>
        ${PROFILE?.employee_id ? '<button class="btn btn-ghost" id="aSelf">استلمها لنفسي</button>' : ''}
      </div>
    </div>`;

  $('#aGo').onclick = async () => {
    try {
      await rpc('rpc_assign_bundle', {
        p_bundle: b.id, p_stage: $('#aStage').value, p_employee: $('#aEmp').value,
      });
      lookupBundle(b.code);
    } catch (e) { alert(humanError(e)); }
  };

  const selfBtn = $('#aSelf');
  if (selfBtn) selfBtn.onclick = async () => {
    try {
      await rpc('rpc_claim_bundle', { p_bundle: b.id, p_stage: $('#aStage').value });
      lookupBundle(b.code);
    } catch (e) { alert(humanError(e)); }
  };
}

function renderReceive(b) {
  const box = $('#fAction');
  const qty = Number(b.quantity);
  box.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">استلام الشغل</h2>
      <p class="hint">الكمية المسلّمة: <b>${num(qty)}</b> قطعة</p>
      <div class="grid g3" style="margin-top:10px">
        <div><label class="label">المقبول</label><input id="rAcc" class="input" type="number" min="0" value="${qty}"></div>
        <div><label class="label">المرفوض</label><input id="rRej" class="input" type="number" min="0" value="0"></div>
        <div><label class="label">الإعادة</label><input id="rRew" class="input" type="number" min="0" value="0"></div>
      </div>
      <div style="margin-top:10px"><label class="label">سبب الرفض</label>
        <input id="rWhy" class="input" placeholder="خياطة، قص، بقعة…"></div>
      <p class="hint" id="rSum" style="margin:10px 0 0"></p>
      <div style="margin-top:12px"><button class="btn btn-primary" id="rGo">استلام الشغل</button></div>
    </div>`;

  const sum = () => {
    const a = Number($('#rAcc').value || 0), r = Number($('#rRej').value || 0), w = Number($('#rRew').value || 0);
    const t = a + r + w;
    const el = $('#rSum');
    el.textContent = `المجموع ${num(t)} من ${num(qty)}` + (t === qty ? ' ✓' : ' — لازم يساوي الكمية');
    el.style.color = t === qty ? 'var(--good)' : 'var(--bad)';
  };
  ['#rAcc', '#rRej', '#rRew'].forEach((s) => { $(s).oninput = sum; });
  sum();

  $('#rGo').onclick = async () => {
    try {
      const rows = await view('assignments', { bundle_id: b.id });
      const open = rows.find((r) => !r.received_at);
      if (!open) throw new Error('E_ASSIGNMENT_OPEN_NOT_FOUND');
      await rpc('rpc_receive_work', {
        p_assignment: open.id,
        p_accepted: Number($('#rAcc').value || 0),
        p_rejected: Number($('#rRej').value || 0),
        p_rework: Number($('#rRew').value || 0),
        p_reason: $('#rWhy').value.trim() || null,
      });
      lookupBundle(b.code);
    } catch (e) { alert(humanError(e)); }
  };
}

/* ============================================================================
   أوامر التشغيل
   ========================================================================== */
async function pageOrders() {
  loading();
  const orders = await view('orders');
  const filter = window.__orderFilter || 'open';
  const rows = filter === 'all' ? orders : orders.filter((o) => o.status === filter);

  const tab = (k, label) => `<button class="btn btn-sm ${filter === k ? 'btn-primary' : 'btn-ghost'}"
    data-filter="${k}">${label}</button>`;

  app.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div><h1 style="margin:0">الأوامر</h1><p class="sub" style="margin:4px 0 0">${num(rows.length)} أمر</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn btn-ghost" href="#templates">قوالب المراحل</a>
        <a class="btn btn-primary" href="#order-new">أمر جديد</a>
      </div>
    </div>

    <div style="display:flex;gap:6px;margin:14px 0">
      ${tab('open', 'مفتوح')}${tab('completed', 'مكتمل')}${tab('cancelled', 'ملغي')}${tab('all', 'الكل')}
    </div>

    ${tbl([
      { label: 'الكود', render: (r) => `<a class="link" href="#order/${r.id}">${esc(r.code)}</a>` },
      { label: 'العميل', key: 'customer_name' },
      { label: 'الموديل', key: 'model_name' },
      { label: 'الكمية', num: true, render: (r) => num(r.quantity) },
      { label: 'اتقص', num: true, render: (r) => num(r.cut_quantity) },
      { label: 'الشنط', num: true, render: (r) => num(r.bundle_count) },
      { label: 'الحالة', render: (r) => chip(r.status) },
      { label: 'ميعاد التسليم', render: (r) => dateAr(r.due_date) },
      { label: 'التقدم', render: (r) => `<div style="display:flex;align-items:center;gap:8px">
          <div class="bar" style="width:70px"><i style="width:${r.cut_percent}%"></i></div>
          <span class="hint">${r.cut_percent}%</span></div>` },
    ], rows, 'مفيش أوامر في التصنيف ده')}`;

  app.querySelectorAll('[data-filter]').forEach((b) => {
    b.onclick = () => { window.__orderFilter = b.dataset.filter; pageOrders(); };
  });
}

async function pageOrderNew() {
  loading();
  const [customers, templates] = await Promise.all([
    view('customers'), table('stage_templates'),
  ]);
  const active = customers.filter((c) => c.is_active);

  app.innerHTML = `
    <h1>أمر تشغيل جديد</h1>
    <p class="sub">الألوان والمقاسات بتتحدد وقت القص</p>

    <div class="card">
      <div class="grid g2">
        <div><label class="label">العميل</label>
          <select id="oCustomer">${active.map((c) =>
            `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.operating_letter)})</option>`).join('')}</select></div>
        <div><label class="label">قالب المراحل</label>
          <select id="oTemplate"><option value="">— الافتراضي —</option>
            ${templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></div>
      </div>
      <div style="margin-top:12px"><label class="label">الموديل</label>
        <input id="oModel" class="input" placeholder="جاكيت تومي"></div>
      <div class="grid g3" style="margin-top:12px">
        <div><label class="label">سعر التصنيع للقطعة</label>
          <input id="oPrice" class="input" type="number" min="0" step="0.01" value="0"></div>
        <div><label class="label">عدد القطع</label>
          <input id="oQty" class="input" type="number" min="1" value="0"></div>
        <div><label class="label">ميعاد التسليم</label>
          <input id="oDue" class="input" type="date"></div>
      </div>
      <div style="margin-top:12px"><label class="label">ملاحظات</label>
        <input id="oNotes" class="input"></div>
      <div style="margin-top:16px;display:flex;gap:8px">
        <button class="btn btn-primary" id="oSave">إنشاء الأمر</button>
        <a class="btn btn-ghost" href="#orders">إلغاء</a>
      </div>
    </div>

    <h2>مراحل القالب</h2>
    <div id="tplStages"></div>`;

  const loadStages = async () => {
    const tpl = $('#oTemplate').value;
    const rows = tpl
      ? await table('stage_template_stages', { template_id: tpl })
      : (await meta()).stages || [];
    $('#tplStages').innerHTML = tbl([
      { label: '#', render: (r) => num(r.seq) },
      { label: 'المرحلة', key: 'name_ar' },
      { label: 'بتبدأ بعد', render: (r) => esc(depList(r.depends_on)) },
      { label: 'سعر القطعة', num: true, render: (r) => money(r.piece_price) },
    ], rows, 'مفيش مراحل');
  };
  $('#oTemplate').onchange = loadStages;
  loadStages();

  $('#oSave').onclick = async () => {
    try {
      const r = await rpc('rpc_create_production_order', {
        p_customer: $('#oCustomer').value,
        p_model: $('#oModel').value.trim(),
        p_quantity: Number($('#oQty').value || 0),
        p_piece_price: Number($('#oPrice').value || 0),
        p_template: $('#oTemplate').value || null,
        p_due_date: $('#oDue').value || null,
        p_notes: $('#oNotes').value.trim() || null,
      });
      go('#order/' + r.id);
    } catch (e) { alert(humanError(e)); }
  };
}

async function pageTemplates() {
  loading();
  const templates = await table('stage_templates');
  const list = await Promise.all(templates.map(async (t) => ({
    t, stages: await table('stage_template_stages', { template_id: t.id }),
  })));
  app.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div><h1 style="margin:0">قوالب المراحل</h1>
        <p class="sub" style="margin:4px 0 0">كل موديل ليه مراحله واعتمادياتها وأسعارها</p></div>
      <button class="btn btn-primary" id="newTpl">+ قالب جديد</button>
    </div>
    ${list.map(({ t, stages }) => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <b>${esc(t.name_ar)}</b>
          <div style="display:flex;gap:8px;align-items:center">
            ${t.is_default ? '<span class="chip chip-open">افتراضي</span>' : ''}
            <button class="btn btn-ghost btn-sm" data-edit="${esc(t.id)}">تعديل</button>
          </div>
        </div>
        ${tbl([
          { label: '#', render: (r) => num(r.seq) },
          { label: 'المرحلة', key: 'name_ar' },
          { label: 'الكود', render: (r) => `<span class="mono hint">${esc(r.code)}</span>` },
          { label: 'بتبدأ بعد', render: (r) => esc(depList(r.depends_on)) },
          { label: 'سعر القطعة', num: true, render: (r) => money(r.piece_price) },
        ], stages, 'مفيش مراحل')}
      </div>`).join('')}
    <a class="btn btn-ghost" href="#orders">رجوع للأوامر</a>
    <div id="tplBox" style="margin-top:14px"></div>`;

  $('#newTpl').onclick = () => renderTemplateForm(null, []);
  app.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => {
      const entry = list.find((x) => x.t.id === b.dataset.edit);
      renderTemplateForm(entry.t, entry.stages);
    };
  });
}

/* The template editor is one row per stage; `depends_on` is entered as a comma
   separated list of stage codes, which is what the RPC stores. */
function renderTemplateForm(tpl, stages) {
  const rows = stages.length ? stages.map((s) => ({
    name_ar: s.name_ar, code: s.code, piece_price: s.piece_price,
    depends_on: (Array.isArray(s.depends_on) ? s.depends_on : []).join(', '),
  })) : [{ name_ar: '', code: '', piece_price: 0, depends_on: '' }];

  $('#tplBox').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">${tpl ? 'تعديل قالب' : 'قالب جديد'}</h2>
      <label class="label">اسم القالب</label>
      <input id="tplName" class="input" value="${esc(tpl?.name_ar || '')}" placeholder="قميص">
      <h2>المراحل</h2>
      <div id="tplRows">${rows.map((r, i) => templateRow(r, i)).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="addRow">+ مرحلة</button>
        <button class="btn btn-primary" id="saveTpl">حفظ</button>
        <button class="btn btn-ghost" id="cancelTpl">إلغاء</button>
      </div>
      <p class="hint" style="margin-top:10px">«بتبدأ بعد» بتتكتب بأكواد المراحل مفصولة بفاصلة،
        مثال: <span class="mono">collar, chest</span>. سيبها فاضية لو المرحلة من البداية.</p>
    </div>`;

  const reindex = () => {
    $('#tplRows').querySelectorAll('.tpl-row').forEach((el, i) => {
      el.querySelectorAll('[data-f]').forEach((inp) => { inp.dataset.i = i; });
    });
  };

  $('#addRow').onclick = () => {
    const i = $('#tplRows').querySelectorAll('.tpl-row').length;
    $('#tplRows').insertAdjacentHTML('beforeend',
      templateRow({ name_ar: '', code: '', piece_price: 0, depends_on: '' }, i));
    reindex();
  };
  $('#cancelTpl').onclick = () => { $('#tplBox').innerHTML = ''; };

  $('#saveTpl').onclick = async () => {
    const name = $('#tplName').value.trim();
    if (!name) { alert('اكتب اسم القالب'); return; }
    const payload = [];
    $('#tplRows').querySelectorAll('.tpl-row').forEach((el, i) => {
      const val = (f) => el.querySelector(`[data-f="${f}"]`).value;
      const nm = val('name_ar').trim();
      const code = val('code').trim();
      if (!nm || !code) return;
      payload.push({
        seq: payload.length + 1, name_ar: nm, code,
        piece_price: Number(val('piece_price') || 0),
        depends_on: val('depends_on').split(',').map((x) => x.trim()).filter(Boolean),
      });
    });
    if (!payload.length) { alert('ضيف مرحلة واحدة على الأقل بكود'); return; }
    try {
      await rpc('rpc_save_stage_template', {
        p_template: tpl?.id || null, p_name: name, p_stages: payload,
      });
      pageTemplates();
    } catch (e) { alert(humanError(e)); }
  };
}

function templateRow(r, i) {
  return `<div class="tpl-row grid g4" style="margin-bottom:8px;align-items:end">
    <div><label class="label">الاسم</label>
      <input class="input" data-f="name_ar" data-i="${i}" value="${esc(r.name_ar || '')}" placeholder="اللياقات"></div>
    <div><label class="label">الكود</label>
      <input class="input mono" data-f="code" data-i="${i}" value="${esc(r.code || '')}" placeholder="collar"></div>
    <div><label class="label">سعر القطعة</label>
      <input class="input" type="number" min="0" step="0.01" data-f="piece_price" data-i="${i}"
        value="${esc(r.piece_price ?? 0)}"></div>
    <div><label class="label">بتبدأ بعد</label>
      <input class="input mono" data-f="depends_on" data-i="${i}"
        value="${esc(r.depends_on || '')}" placeholder="collar, chest"></div>
  </div>`;
}

/* ------------------------------------------------------------------ الشنط */
/* Bundles read colour → size when the order has colours, size only otherwise. */
function bundlesTable(bundles, order) {
  const live = (bundles || []).filter((b) => b.status !== 'cancelled');
  if (!live.length) return '<div class="empty">لسه ما اتعملش قص</div>';

  const { hasColour, groups } = groupBundles(sortBundles(live));
  const head = `<thead><tr>
      <th>الكود</th><th>${hasColour ? 'المقاس' : 'المقاس'}</th>
      ${hasColour ? '<th>اللون</th>' : ''}
      <th class="num">العدد</th><th>أكواد التشغيل</th><th>الحالة</th><th></th>
    </tr></thead>`;

  const body = groups.map((g) => {
    // A bundle cut by size alone has no colour, so the title is just its size.
    const title = g.colour
      ? `${esc(g.colour_label)} — مقاس ${esc(g.size)}`
      : `مقاس ${esc(g.size)}`;
    const rows = g.bundles.map((b) => `<tr>
        <td><span class="mono">${esc(b.code)}</span></td>
        <td>${esc(b.size)}</td>
        ${hasColour ? `<td>${esc(colourAr(b.colour_label))}</td>` : ''}
        <td class="num">${num(b.quantity)}</td>
        <td><span class="mono hint">${esc(b.first_code || '—')} → ${esc(b.last_code || '—')}</span></td>
        <td>${chip(b.status)}</td>
        <td><button class="btn btn-ghost btn-sm" data-label="${esc(b.code)}">🏷 ليبل</button></td>
      </tr>`).join('');

    return `<tr class="grp"><td colspan="${hasColour ? 7 : 6}"
        style="background:var(--bg-soft,#f6f7f9);font-weight:700">
        ${title} · <span class="hint">${num(g.bundles.length)} شنطة · ${num(g.quantity)} قطعة</span>
      </td></tr>${rows}`;
  }).join('');

  return `<div class="tbl-wrap"><table>${head}<tbody>${body}</tbody></table></div>`;
}

/* Which buttons a stage row offers: hand over, or receive what came back. */
function stageAction(s) {
  const inFlight = Number(s.in_flight_qty) > 0;
  const done = s.status === 'done';
  const btns = [];
  if (inFlight) {
    btns.push(`<button class="btn btn-primary btn-sm" data-act="receive"
      data-stage="${esc(s.code)}">استلم</button>`);
  }
  if (s.deps_done && !done) {
    btns.push(`<button class="btn btn-ghost btn-sm" data-act="assign"
      data-stage="${esc(s.code)}">سلّم</button>`);
  }
  return btns.length ? `<div style="display:flex;gap:6px">${btns.join('')}</div>` : '—';
}

async function pageOrder(id) {
  loading();
  const [orders, stages, bundles, costing, timeline, deliveries, returns] = await Promise.all([
    view('orders'), view('order_stages', { order_id: id }), view('bundles', { order_id: id }),
    view('costing'), view('timeline', { order_id: id }), table('deliveries', { order_id: id }),
    table('customer_returns', { order_id: id }),
  ]);
  const o = orders.find((x) => x.id === id);
  if (!o) { app.innerHTML = '<div class="err">الأمر مش موجود</div>'; return; }
  const st = stages.filter((s) => s.order_id === id);
  const tl = timeline.filter((t) => t.order_id === id);
  const cost = costing.find((c) => c.id === id || c.order_id === id) || {};
  const remaining = Number(o.quantity) - Number(o.cut_quantity);

  app.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div>
        <h1 style="margin:0">${esc(o.code)} · ${esc(o.model_name)}</h1>
        <p class="sub" style="margin:4px 0 0">${esc(o.customer_name)} · ${num(o.quantity)} قطعة ·
           ${money(o.piece_price)}/قطعة · ميعاد ${dateAr(o.due_date)}</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="printOrder">🖨 طباعة الأمر</button>
        ${o.status === 'open' ? '<button class="btn btn-danger" id="cancelBtn">إلغاء الأمر</button>' : ''}
      </div>
    </div>

    <div class="grid g4" style="margin:16px 0">
      <div class="kpi"><div class="lbl">اتقص</div><div class="val">${num(o.cut_quantity)} <small>من ${num(o.quantity)}</small></div>
        <div class="bar" style="margin-top:8px"><i style="width:${o.cut_percent}%"></i></div></div>
      <div class="kpi"><div class="lbl">شنط</div><div class="val">${num(o.bundle_count)}</div></div>
      <div class="kpi"><div class="lbl">جاهز للتسليم</div><div class="val">${num(o.ready_quantity)}</div></div>
      <div class="kpi"><div class="lbl">الحالة</div><div class="val" style="font-size:1rem">${chip(o.status)}</div></div>
      <div class="kpi"><div class="lbl">الإيراد المتوقع</div><div class="val" style="font-size:1.1rem">${money(cost.expected_revenue)}</div></div>
      <div class="kpi"><div class="lbl">التكلفة</div><div class="val" style="font-size:1.1rem">${money(cost.total_cost)}</div></div>
    </div>

    <h2>المراحل</h2>
    <p class="hint" style="margin:-6px 0 10px">المرحلة بتظهر لما اللي قبلها يخلص. اضغط «سلّم» عشان تسلّم الشغل
      لصنايعي، أو «استلم» عشان تقبض الشغل اللي رجع.</p>
    ${tbl([
      { label: 'المرحلة', render: (r) => `<b>${esc(r.name_ar)}</b>
          ${r.deps_done ? '' : '<div class="hint">مستنية ' + esc(depList(r.depends_on)) + '</div>'}` },
      { label: 'بتبدأ بعد', render: (r) => esc(depList(r.depends_on)) },
      { label: 'مقبول', num: true, render: (r) => num(r.accepted_qty) },
      { label: 'شغال', num: true, render: (r) => num(r.in_flight_qty) },
      { label: 'مرفوض', num: true, render: (r) => num(r.rejected_qty) },
      { label: 'الحالة', render: (r) => chip(r.status) },
      { label: '', render: (r) => stageAction(r) },
    ], st.filter((s) => s.deps_done || Number(s.accepted_qty) > 0 || Number(s.in_flight_qty) > 0),
      'مفيش مراحل')}

    <h2>الشنط</h2>
    ${bundlesTable(bundles, o)}

    <h2>أذون التسليم</h2>
    ${tbl([
      { label: 'الكود', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
      { label: 'التاريخ', render: (r) => dateAr(r.delivered_on) },
      { label: 'ملاحظات', render: (r) => esc(r.notes || '—') },
      { label: '', render: (r) => `<button class="btn btn-ghost btn-sm" data-doc="${esc(r.id)}">🖨 إذن</button>` },
    ], deliveries, 'مفيش أذون تسليم')}

    <h2>مرتجعات العميل</h2>
    ${tbl([
      { label: 'الكود', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
      { label: 'التاريخ', render: (r) => dateAr(r.returned_on) },
      { label: 'اللون', render: (r) => esc(colourAr(r.colour)) },
      { label: 'المقاس', render: (r) => esc(r.size || '—') },
      { label: 'الكمية', num: true, render: (r) => num(r.quantity) },
      { label: 'السبب', render: (r) => esc(r.reason || '—') },
      { label: 'التصرف', render: (r) => esc(returnDispAr(r.disposition)) },
    ], returns, 'مفيش مرتجعات')}

    <h2>التايم لاين</h2>
    ${tbl([
      { label: 'الوقت', render: (r) => esc(String(r.at).replace('T', ' ').slice(0, 16)) },
      { label: 'الحدث', key: 'description', wrap: true },
      { label: 'بواسطة', render: (r) => esc(r.actor || '—') },
    ], tl, 'مفيش أحداث')}

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:18px">
      ${remaining > 0 && o.status === 'open' ? '<button class="btn btn-primary" id="cutBtn">قص وعمل شنط</button>' : ''}
      ${Number(o.ready_quantity) > 0 ? '<button class="btn btn-primary" id="deliverBtn">إنشاء إذن تسليم</button>' : ''}
      ${Number(o.delivered_quantity) > 0 ? '<button class="btn btn-ghost" id="returnBtn">↩ مرتجع من العميل</button>' : ''}
    </div>
    <div id="actionBox" style="margin-top:14px"></div>`;

  const printBtn = $('#printOrder');
  if (printBtn) printBtn.onclick = () => printOrderDoc(o, st, bundles);

  app.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = () => {
      const stage = b.dataset.stage;
      if (b.dataset.act === 'assign') renderStageAssign(o, stage, bundles);
      else renderStageReceive(o, stage, st, bundles);
    };
  });

  app.querySelectorAll('[data-label]').forEach((b) => {
    b.onclick = () => printLabels(o, bundles.find((x) => x.code === b.dataset.label));
  });
  app.querySelectorAll('[data-doc]').forEach((b) => {
    b.onclick = async () => {
      const d = deliveries.find((x) => x.id === b.dataset.doc);
      const lines = await table('delivery_lines', { delivery_id: d.id });
      printDeliveryDoc(o, d, lines);
    };
  });

  const cb = $('#cancelBtn');
  if (cb) cb.onclick = async () => {
    const why = prompt('سبب الإلغاء');
    if (!why) return;
    try { await rpc('rpc_cancel_production_order', { p_id: o.id, p_reason: why }); pageOrder(id); }
    catch (e) { alert(humanError(e)); }
  };

  const cutBtn = $('#cutBtn');
  if (cutBtn) cutBtn.onclick = () => renderCutForm(o, remaining);

  const delBtn = $('#deliverBtn');
  if (delBtn) delBtn.onclick = () => renderDeliveryForm(o, bundles);

  const retBtn = $('#returnBtn');
  if (retBtn) retBtn.onclick = () => renderReturnForm(o, bundles);
}

/* Customer returns come back per colour/size, so the form lists the pairs that
   were actually delivered on this order. */
function renderReturnForm(order, bundles) {
  const box = $('#actionBox');
  const pairs = [];
  bundles.forEach((b) => {
    const key = (b.colour || '') + '|' + (b.size || '');
    if (!pairs.find((p) => p.key === key)) {
      pairs.push({ key, colour: b.colour || '', size: b.size || '' });
    }
  });

  box.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">مرتجع من العميل</h2>
      <div class="grid g4">
        <div><label class="label">اللون / المقاس</label>
          <select id="rtPair">${pairs.map((p, i) =>
            `<option value="${i}">${esc(colourAr(p.colour))} · مقاس ${esc(p.size || '—')}</option>`).join('')}</select></div>
        <div><label class="label">الكمية</label>
          <input id="rtQty" class="input" type="number" min="1" step="1" value="1"></div>
        <div><label class="label">السبب</label>
          <input id="rtReason" class="input" placeholder="مقاس غلط"></div>
        <div><label class="label">التصرف</label>
          <select id="rtDisp">
            <option value="rework">يتعاد تشغيله</option>
            <option value="scrap">يتعدم</option>
            <option value="stock">يرجع للمخزن</option>
          </select></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary" id="rtGo">تسجيل المرتجع</button>
        <button class="btn btn-ghost" id="rtCancel">إلغاء</button>
      </div>
    </div>`;

  $('#rtCancel').onclick = () => { box.innerHTML = ''; };
  $('#rtGo').onclick = async () => {
    const qty = Number($('#rtQty').value || 0);
    if (!qty || qty <= 0) { alert('اكتب كمية صحيحة'); return; }
    const p = pairs[Number($('#rtPair').value)];
    try {
      await rpc('rpc_create_customer_return', {
        p_order: order.id, p_colour: p.colour || null, p_size: p.size || null,
        p_quantity: qty, p_reason: $('#rtReason').value.trim() || null,
        p_disposition: $('#rtDisp').value,
      });
      pageOrder(order.id);
    } catch (e) { alert(humanError(e)); }
  };
}

/* ------------------------------------------------------------------ تسليم/استلام من شاشة الأمر */
/* A stage is handed over bundle by bundle; the dialog lists only the bundles that
   can actually start this stage right now. */
async function renderStageAssign(order, stage, bundles) {
  const box = $('#actionBox');
  const workers = (await view('workers')).filter((w) => w.kind === 'worker' && w.is_active);
  const queue = await view('bundle_queue', { order_id: order.id });
  // The queue has one row per (bundle, stage); keep one row per bundle here.
  const ready = queue.filter((q) => q.stage_code === stage && q.deps_done
    && !q.stage_done && !q.open_assignment)
    .filter((q, i, all) => all.findIndex((x) => x.bundle_id === q.bundle_id) === i);

  if (!ready.length) {
    box.innerHTML = `<div class="card"><div class="empty">مفيش شنط جاهزة للمرحلة دي دلوقتي</div></div>`;
    return;
  }

  box.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">تسليم ${esc(stageAr(stage))}</h2>
      <div class="grid g2">
        <div><label class="label">الشنطة</label>
          <select id="sBundle">${ready.map((q) => `<option value="${esc(q.bundle_id)}">${
            esc(bundleLabel(q))}</option>`).join('')}</select></div>
        <div><label class="label">الصنايعي</label>
          <select id="sEmp">${workers.map((w) => `<option value="${esc(w.id)}">${
            esc(w.name + (w.job_title ? ' — ' + w.job_title : ''))}</option>`).join('')}</select></div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary" id="sGo">سلّم</button>
        <button class="btn btn-ghost" id="sCancel">إلغاء</button>
      </div>
    </div>`;

  $('#sCancel').onclick = () => { box.innerHTML = ''; };
  $('#sGo').onclick = async () => {
    try {
      await rpc('rpc_assign_bundle', {
        p_bundle: $('#sBundle').value, p_stage: stage, p_employee: $('#sEmp').value,
      });
      pageOrder(order.id);
    } catch (e) { alert(humanError(e)); }
  };
}

/* Receiving what came back. Rejected pieces need a reason, so the form asks. */
async function renderStageReceive(order, stage, stages, bundles) {
  const box = $('#actionBox');
  const rows = await view('bundle_queue', { order_id: order.id });
  const out = rows.filter((q) => q.stage_code === stage && q.open_assignment);
  if (!out.length) {
    box.innerHTML = `<div class="card"><div class="empty">مفيش شغل خارج للمرحلة دي</div></div>`;
    return;
  }

  box.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">استلام ${esc(stageAr(stage))}</h2>
      <div class="grid g2">
        <div><label class="label">الشنطة</label>
          <select id="rPick">${out.map((q) => `<option value="${esc(q.open_assignment)}">${
            esc(bundleLabel(q) + ' مع ' + (q.current_holder || '—'))}</option>`).join('')}</select></div>
        <div><label class="label">الكمية المسلّمة</label>
          <input id="rQtyShow" class="input" disabled value="${num(out[0].quantity)}"></div>
      </div>
      <div class="grid g3" style="margin-top:12px">
        <div><label class="label">المقبول</label><input id="rAcc" class="input" type="number" min="0"></div>
        <div><label class="label">المرفوض</label><input id="rRej" class="input" type="number" min="0" value="0"></div>
        <div><label class="label">الإعادة</label><input id="rRew" class="input" type="number" min="0" value="0"></div>
      </div>
      <div style="margin-top:10px"><label class="label">سبب الرفض</label>
        <input id="rWhy" class="input" placeholder="خياطة، قص، بقعة…"></div>
      <p class="hint" id="rSum" style="margin:10px 0 0"></p>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary" id="rGo">استلام الشغل</button>
        <button class="btn btn-ghost" id="rCancel">إلغاء</button>
      </div>
    </div>`;

  const picked = () => out.find((q) => q.open_assignment === $('#rPick').value) || out[0];
  const qtyOf = () => Number(picked().quantity);

  const reset = () => {
    $('#rQtyShow').value = num(qtyOf());
    $('#rAcc').value = qtyOf();
    $('#rRej').value = 0; $('#rRew').value = 0; $('#rWhy').value = '';
    sum();
  };
  const sum = () => {
    const a = Number($('#rAcc').value || 0), r = Number($('#rRej').value || 0), w = Number($('#rRew').value || 0);
    const t = a + r + w;
    const el = $('#rSum');
    el.textContent = `المجموع ${num(t)} من ${num(qtyOf())}` + (t === qtyOf() ? ' ✓' : ' — لازم يساوي الكمية');
    el.style.color = t === qtyOf() ? 'var(--good)' : 'var(--bad)';
  };

  ['#rAcc', '#rRej', '#rRew'].forEach((s) => { $(s).oninput = sum; });
  $('#rPick').onchange = reset;
  $('#rCancel').onclick = () => { box.innerHTML = ''; };
  reset();

  $('#rGo').onclick = async () => {
    try {
      await rpc('rpc_receive_work', {
        p_assignment: $('#rPick').value,
        p_accepted: Number($('#rAcc').value || 0),
        p_rejected: Number($('#rRej').value || 0),
        p_rework: Number($('#rRew').value || 0),
        p_reason: $('#rWhy').value.trim() || null,
      });
      pageOrder(order.id);
    } catch (e) { alert(humanError(e)); }
  };
}

/* ------------------------------------------------------------------ القص */
/* Two ways to cut: by size alone, or by colour × size. The operator writes the
   count once per colour (عدد اللون) or once per size (عدد المقاس), and the grid
   shows exactly which bundles will come out before anything is saved. */
function renderCutForm(order, remaining) {
  const box = $('#actionBox');
  let mode = 'size';            // 'size' = بالمقاسات فقط، 'colour' = مقاسات وألوان
  let sizes = [];
  let colours = [];
  const qty = {};               // "colour||size" → number

  box.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">قص وعمل شنط</h2>
      <p class="hint">الباقي للقص: <b>${num(remaining)}</b> قطعة</p>

      <div style="display:flex;gap:6px;margin:12px 0">
        <button class="btn btn-sm" id="mSize">بالمقاسات فقط</button>
        <button class="btn btn-sm" id="mColour">بالمقاسات والألوان</button>
      </div>

      <div class="grid g2">
        <div>
          <label class="label">المقاسات</label>
          <div style="display:flex;gap:6px">
            <input id="cSizes" class="input" placeholder="M, L, XL">
            <button class="btn btn-ghost" id="cApplySizes">تطبيق</button>
          </div>
          <p class="hint" style="margin:4px 0 0">مثلاً: M, L, XL أو 38, 40, 42</p>
        </div>
        <div id="cColourWrap">
          <label class="label">الألوان</label>
          <div style="display:flex;gap:6px">
            <input id="cColours" class="input" placeholder="أبيض، كحلي">
            <button class="btn btn-ghost" id="cApplyColours">تطبيق</button>
          </div>
          <p class="hint" style="margin:4px 0 0">مثلاً: أبيض، أزرق فاتح، كحلي</p>
        </div>
      </div>

      <div class="grid g3" style="margin-top:12px">
        <div><label class="label">عدد اللون</label>
          <input id="cPerColour" class="input" type="number" min="0" value="0">
          <p class="hint" style="margin:4px 0 0">عدد القطع لكل لون</p></div>
        <div><label class="label">عدد المقاس</label>
          <input id="cPerSize" class="input" type="number" min="0" value="0">
          <p class="hint" style="margin:4px 0 0">عدد القطع لكل مقاس</p></div>
        <div><label class="label">قطع في الشنطة</label>
          <input id="cBundle" class="input" type="number" min="1" value="40"></div>
      </div>

      <div id="cGrid" style="margin-top:14px"></div>

      <div style="margin-top:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-primary" id="cGo">قص وعمل الشنط</button>
        <button class="btn btn-ghost" id="cCancel">إلغاء</button>
        <span class="hint" id="cSum"></span>
      </div>
    </div>`;

  const perColour = () => Number($('#cPerColour').value || 0);
  const perSize = () => Number($('#cPerSize').value || 0);

  const paintMode = () => {
    const byColour = mode === 'colour';
    $('#mSize').className = 'btn btn-sm ' + (byColour ? 'btn-ghost' : 'btn-primary');
    $('#mColour').className = 'btn btn-sm ' + (byColour ? 'btn-primary' : 'btn-ghost');
    $('#cColourWrap').style.display = byColour ? '' : 'none';
    $('#cPerColour').disabled = !byColour;
    $('#cPerSize').disabled = byColour;
    $('#cPerColour').style.opacity = byColour ? 1 : .45;
    $('#cPerSize').style.opacity = byColour ? .45 : 1;
    if (!byColour) colours = [''];
    draw();
  };

  /* Fill writes values into the existing inputs instead of re-rendering, so the
     box the operator is typing in keeps focus and the caret. */
  const fill = () => {
    const v = mode === 'colour' ? perColour() : perSize();
    if (v) {
      if (mode === 'colour') {
        colours.forEach((c) => sizes.forEach((s) => { qty[c + '||' + s] = v; }));
      } else {
        sizes.forEach((s) => { qty['||' + s] = v; });
      }
    }
    sync();
  };

  const sync = () => {
    box.querySelectorAll('.qCell').forEach((inp) => {
      const k = inp.dataset.c + '||' + inp.dataset.s;
      inp.value = qty[k] || 0;
    });
    if (mode === 'colour') {
      box.querySelectorAll('tr[data-row]').forEach((tr) => {
        const c = tr.dataset.row;
        const t = sizes.reduce((u, s) => u + Number(qty[c + '||' + s] || 0), 0);
        tr.querySelector('.rowTotal').textContent = num(t);
      });
    }
    updateSum();
  };

  function draw() {
    if (!sizes.length) {
      $('#cGrid').innerHTML = '<div class="empty">اكتب المقاسات واضغط تطبيق</div>';
      $('#cSum').textContent = '';
      return;
    }

    if (mode === 'size') {
      // One row per size: the operator reads a size and writes its count.
      const body = sizes.map((s) => `<tr>
          <td><b>${esc(s)}</b></td>
          <td class="num"><input class="input qCell" data-c="" data-s="${esc(s)}" type="number"
            min="0" value="${qty['||' + s] || 0}" style="width:96px;text-align:center"></td>
        </tr>`).join('');
      $('#cGrid').innerHTML = `<div class="tbl-wrap"><table>
        <thead><tr><th>المقاس</th><th class="num">عدد المقاس</th></tr></thead>
        <tbody>${body}</tbody></table></div>`;
    } else {
      const head = `<thead><tr><th>اللون</th>
          ${sizes.map((s) => `<th class="num">${esc(s)}</th>`).join('')}
          <th class="num">الإجمالي</th></tr></thead>`;
      const body = colours.map((c) => {
        const cells = sizes.map((s) => `<td class="num">
            <input class="input qCell" data-c="${esc(c)}" data-s="${esc(s)}" type="number"
              min="0" value="${qty[c + '||' + s] || 0}" style="width:82px;text-align:center">
          </td>`).join('');
        const total = sizes.reduce((t, s) => t + Number(qty[c + '||' + s] || 0), 0);
        return `<tr data-row="${esc(c)}"><td>${esc(c)}</td>${cells}
          <td class="num"><b class="rowTotal">${num(total)}</b></td></tr>`;
      }).join('');
      $('#cGrid').innerHTML = `<div class="tbl-wrap"><table>${head}<tbody>${body}</tbody></table></div>`;
    }

    box.querySelectorAll('.qCell').forEach((inp) => {
      inp.oninput = () => {
        qty[inp.dataset.c + '||' + inp.dataset.s] = Number(inp.value || 0);
        sync();
      };
    });
    sync();
  }

  function updateSum() {
    const rows = mode === 'colour' ? colours : [''];
    const total = rows.reduce((t, c) => t + sizes.reduce((u, s) => u + Number(qty[c + '||' + s] || 0), 0), 0);
    const per = Number($('#cBundle').value || 40);
    const bundles = total ? Math.ceil(total / per) : 0;
    const over = total > remaining;
    $('#cSum').innerHTML = total
      ? `الإجمالي <b>${num(total)}</b> قطعة · حوالي <b>${num(bundles)}</b> شنطة`
        + (over ? ` — <span style="color:var(--bad)">أكبر من الباقي (${num(remaining)})</span>` : '')
      : '';
  }

  const parseList = (v) => v.split(/[,،\n]/).map((x) => x.trim()).filter(Boolean);

  $('#mSize').onclick = () => { mode = 'size'; paintMode(); };
  $('#mColour').onclick = () => { mode = 'colour'; paintMode(); };
  $('#cApplySizes').onclick = () => {
    sizes = parseList($('#cSizes').value);
    if (!sizes.length) { alert('اكتب المقاسات'); return; }
    Object.keys(qty).forEach((k) => { if (!sizes.includes(k.split('||')[1])) delete qty[k]; });
    fill();
  };
  $('#cApplyColours').onclick = () => {
    colours = parseList($('#cColours').value);
    if (!colours.length) { alert('اكتب الألوان'); return; }
    fill();
  };
  /* Redraw on `change`, not on every keystroke: the redraw replaces the input
     the operator is typing in. */
  $('#cPerColour').onchange = () => { if (mode === 'colour') fill(); };
  $('#cPerSize').onchange = () => { if (mode === 'size') fill(); };
  $('#cBundle').oninput = updateSum;
  $('#cCancel').onclick = () => { box.innerHTML = ''; };

  $('#cGo').onclick = async () => {
    const rows = mode === 'colour' ? colours : [''];
    const lines = [];
    rows.forEach((c) => sizes.forEach((s) => {
      const q = Number(qty[c + '||' + s] || 0);
      if (q > 0) lines.push({ colour: c, size: s, quantity: q });
    }));
    if (!lines.length) { alert('اكتب الكميات في الجدول'); return; }
    try {
      const r = await rpc('rpc_execute_cutting', {
        p_order: order.id, p_lines: lines,
        p_bundle_size: Number($('#cBundle').value || 40),
        p_has_colour: mode === 'colour',
      });
      alert(`اتعمل ${r.bundles} شنطة و ${r.operational_codes} كود تشغيل`);
      pageOrder(order.id);
    } catch (e) { alert(humanError(e)); }
  };

  paintMode();
}

function renderDeliveryForm(order, bundles) {
  const box = $('#actionBox');
  const byGroup = {};
  // Only bundles that cleared the order's final stage are ready to ship.
  bundles.forEach((b) => {
    if (b.status !== 'finished') return;
    const k = (b.colour || '') + '|' + b.size;
    byGroup[k] = byGroup[k] || { colour: b.colour || '', size: b.size, qty: 0,
      label: colourAr(b.colour_label) };
    byGroup[k].qty += Number(b.quantity);
  });
  const groups = Object.values(byGroup)
    .sort((a, b) => (a.colour || '').localeCompare(b.colour || '', 'ar') || sizeCmp(a.size, b.size));
  box.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">إذن تسليم جديد</h2>
      <p class="hint">الجاهز للتسليم: <b>${num(order.ready_quantity)}</b> قطعة</p>
      ${groups.length ? `<div class="tbl-wrap" style="margin-top:10px"><table>
        <thead><tr><th>اللون</th><th>المقاس</th><th class="num">المتاح</th><th class="num">الكمية</th></tr></thead>
        <tbody>${groups.map((g, i) => `<tr>
          <td>${esc(g.label)}</td><td>${esc(g.size)}</td><td class="num">${num(g.qty)}</td>
          <td class="num"><input class="input d-qty" data-i="${i}" type="number" min="0" value="0" style="max-width:110px"></td>
        </tr>`).join('')}</tbody></table></div>` : '<div class="empty">مفيش شنط جاهزة</div>'}
      <div style="margin-top:12px"><label class="label">ملاحظات</label><input id="dNotes" class="input"></div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary" id="dGo">إنشاء الإذن</button>
        <button class="btn btn-ghost" id="dCancel">إلغاء</button>
      </div>
    </div>`;

  $('#dCancel').onclick = () => { box.innerHTML = ''; };
  $('#dGo').onclick = async () => {
    const lines = [];
    box.querySelectorAll('.d-qty').forEach((inp) => {
      const q = Number(inp.value || 0);
      if (q > 0) {
        const g = groups[Number(inp.dataset.i)];
        lines.push({ colour: g.colour, size: g.size, quantity: q });
      }
    });
    if (!lines.length) { alert('اكتب كمية واحدة على الأقل'); return; }
    try {
      const r = await rpc('rpc_create_delivery', {
        p_order: order.id, p_lines: lines, p_notes: $('#dNotes').value.trim() || null,
      });
      const d = await table('deliveries', { order_id: order.id });
      const doc = d.find((x) => x.code === r.code) || d[0];
      const dlines = doc ? await table('delivery_lines', { delivery_id: doc.id }) : [];
      alert('اتعمل الإذن ' + (r.code || ''));
      if (doc) printDeliveryDoc({ ...order }, doc, dlines);
      pageOrder(order.id);
    } catch (e) { alert(humanError(e)); }
  };
}

/* ---------------------------------------------------------------- مستندات */
function printOrderDoc(o, stages, bundles) {
  printDoc(`أمر تشغيل ${o.code}`, `
    ${docHeader('أمر تشغيل', o.code)}
    <div class="party">
      <div><b>العميل</b>${esc(o.customer_name)}</div>
      <div><b>الموديل</b>${esc(o.model_name)}</div>
      <div><b>الكمية</b>${num(o.quantity)} قطعة</div>
      <div><b>سعر القطعة</b>${money(o.piece_price)}</div>
      <div><b>ميعاد التسليم</b>${dateAr(o.due_date)}</div>
      <div><b>الحالة</b>${esc(o.status)}</div>
    </div>
    <table>
      <thead><tr><th>المرحلة</th><th>بتبدأ بعد</th><th class="num">سعر القطعة</th><th class="num">مقبول</th><th class="num">مرفوض</th></tr></thead>
      <tbody>${stages.map((s) => `<tr>
        <td>${esc(s.name_ar)}</td>
        <td>${esc(depList(s.depends_on))}</td>
        <td class="num">${money(s.piece_price)}</td>
        <td class="num">${num(s.accepted_qty)}</td>
        <td class="num">${num(s.rejected_qty)}</td></tr>`).join('')}</tbody>
    </table>
    <h1 class="doc-title" style="margin-top:18px;font-size:14px">الشنط</h1>
    <table>
      <thead><tr><th>الكود</th><th>المقاس</th><th>اللون</th><th class="num">العدد</th><th>أكواد التشغيل</th></tr></thead>
      <tbody>${bundles.map((b) => `<tr>
        <td>${esc(b.code)}</td><td>${esc(b.size)}</td><td>${esc(colourAr(b.colour_label))}</td>
        <td class="num">${num(b.quantity)}</td>
        <td>${esc(b.first_code || '—')} → ${esc(b.last_code || '—')}</td></tr>`).join('')}</tbody>
    </table>
    <div class="sign"><div>توقيع رئيس العمال</div><div>توقيع الإدارة</div></div>
    <div class="foot">نظام المصنع — ${dateAr(new Date().toISOString())}</div>`);
}

function printLabels(order, bundle) {
  if (!bundle) return;
  const n = Math.min(Number(bundle.quantity), 60);
  const codes = [];
  const first = String(bundle.first_code || '');
  const m = first.match(/^([A-Za-z]+)(\d+)$/);
  if (m) {
    const prefix = m[1], start = Number(m[2]);
    for (let i = 0; i < n; i++) codes.push(prefix + String(start + i).padStart(m[2].length, '0'));
  } else {
    for (let i = 0; i < n; i++) codes.push(bundle.code + '-' + (i + 1));
  }

  const cells = codes.map((c) => `
    <div class="lbl-cell">
      <div class="lbl-top">${esc(order.model_name)} · ${esc(order.customer_name)}</div>
      <div class="lbl-mid">مقاس ${esc(bundle.size)} · ${esc(colourAr(bundle.colour_label))}</div>
      <div class="lbl-bar">${barcodeSVG(c, { height: 38, unit: 1.5, quiet: 6 })}</div>
      <div class="lbl-code mono">${esc(c)}</div>
      <div class="lbl-ord">${esc(order.code)} · ${esc(bundle.code)}</div>
    </div>`).join('');

  printDoc(`ليبلات ${bundle.code}`, `
    ${docHeader('ليبلات قطع', bundle.code)}
    <p class="hint">${num(codes.length)} ليبل من ${num(bundle.quantity)} قطعة</p>
    <div class="labels">${cells}</div>
    <style>
      .labels{display:grid;grid-template-columns:repeat(3,1fr);gap:5mm;margin-top:6mm}
      .lbl-cell{border:1px dashed #999;border-radius:4px;padding:3mm;text-align:center;
        page-break-inside:avoid;break-inside:avoid}
      .lbl-top{font-size:8px;color:#4a5566}
      .lbl-mid{font-size:10px;font-weight:700;margin:1mm 0}
      .lbl-bar svg{max-width:100%}
      .lbl-code{font-size:11px;font-weight:700;letter-spacing:.1em}
      .lbl-ord{font-size:7px;color:#636c7d}
      @media print{ .labels{grid-template-columns:repeat(3,1fr)} }
    </style>`);
}

function printDeliveryDoc(order, delivery, lines) {
  const total = lines.reduce((s, l) => s + Number(l.quantity), 0);
  printDoc(`إذن تسليم ${delivery.code}`, `
    ${docHeader('إذن تسليم', delivery.code)}
    <div class="party">
      <div><b>العميل</b>${esc(order.customer_name)}</div>
      <div><b>الأمر</b>${esc(order.code)} · ${esc(order.model_name)}</div>
      <div><b>التاريخ</b>${dateAr(delivery.delivered_on)}</div>
      <div><b>إجمالي القطع</b>${num(total)}</div>
    </div>
    <table>
      <thead><tr><th>اللون</th><th>المقاس</th><th class="num">الكمية</th></tr></thead>
      <tbody>${lines.map((l) => `<tr><td>${esc(l.colour)}</td><td>${esc(l.size)}</td>
        <td class="num">${num(l.quantity)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="2">الإجمالي</td><td class="num">${num(total)}</td></tr></tfoot>
    </table>
    ${delivery.notes ? `<p class="hint">ملاحظات: ${esc(delivery.notes)}</p>` : ''}
    <div class="bar-area">${barcodeSVG(delivery.code, { height: 48, unit: 1.8 })}</div>
    <div class="sign"><div>توقيع المستلم</div><div>توقيع المصنع</div></div>
    <div class="foot">نظام المصنع — ${dateAr(new Date().toISOString())}</div>`);
}

/* ============================================================================
   المخزن
   ========================================================================== */
async function pageWarehouse() {
  loading();
  const [fabric, customers] = await Promise.all([view('fabric'), view('customers')]);
  const moves = await table('customer_fabric_movements');
  app.innerHTML = `
    <h1>المخزن</h1>
    <p class="sub">قماش العملاء بيتتبع باللون بالمتر</p>

    <div class="card">
      <h2 style="margin-top:0">استلام قماش من عميل</h2>
      <div class="grid g4">
        <div><label class="label">العميل</label>
          <select id="wCust">${customers.map((c) =>
            `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>
        <div><label class="label">اللون</label><input id="wColour" class="input" placeholder="إسود"></div>
        <div><label class="label">عدد الأمتار</label><input id="wQty" class="input" type="number" min="0" step="0.01" value="0"></div>
        <div style="display:flex;align-items:flex-end"><button class="btn btn-primary" id="wGo" style="width:100%">استلام</button></div>
      </div>
    </div>

    <h2>أرصدة القماش</h2>
    ${tbl([
      { label: 'العميل', key: 'customer_name' },
      { label: 'اللون', key: 'colour' },
      { label: 'الرصيد', num: true, render: (r) =>
        `<b style="color:${Number(r.balance) < 0 ? 'var(--bad)' : 'inherit'}">${num(r.balance)} متر</b>` },
    ], fabric, 'مفيش قماش في المخزن')}

    <h2>حركة القماش</h2>
    ${tbl([
      { label: 'التاريخ', render: (r) => dateAr(r.txn_date || r.created_at) },
      { label: 'العميل', render: (r) =>
        esc(r.customer_name || customers.find((c) => c.id === r.customer_id)?.name || '—') },
      { label: 'اللون', key: 'colour' },
      { label: 'النوع', render: (r) => esc(moveAr(r.movement || r.kind)) },
      { label: 'الأمتار', num: true, render: (r) => num(r.quantity) },
      { label: 'ملاحظات', render: (r) => esc(r.notes || '—') },
    ], moves.slice(0, 40), 'مفيش حركات')}`;

  $('#wGo').onclick = async () => {
    try {
      await rpc('rpc_receive_fabric', {
        p_customer: $('#wCust').value,
        p_colour: $('#wColour').value.trim(),
        p_quantity: Number($('#wQty').value || 0),
      });
      pageWarehouse();
    } catch (e) { alert(humanError(e)); }
  };
}

/* ============================================================================
   العملاء + فاتورة PDF
   ========================================================================== */
async function pageCustomers() {
  loading();
  const [customers, fabric] = await Promise.all([view('customers'), view('fabric')]);
  app.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div><h1 style="margin:0">العملاء</h1><p class="sub" style="margin:4px 0 0">${num(customers.length)} عميل</p></div>
      <button class="btn btn-primary" id="newCust">+ عميل جديد</button>
    </div>
    <div style="margin-top:14px">
      ${tbl([
        { label: 'الكود', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { label: 'حرف التشغيل', render: (r) => `<span class="chip chip-open mono">${esc(r.operating_letter)}</span>` },
        { label: 'الاسم', render: (r) => `<a class="link" href="#customer/${r.id}">${esc(r.name)}</a>` },
        { label: 'التليفون', render: (r) => `<span dir="ltr">${esc(r.phone || '—')}</span>` },
        { label: 'أوامر', num: true, render: (r) => num(r.order_count) },
        { label: 'مفتوحة', num: true, render: (r) => num(r.open_order_count) },
        { label: 'الحالة', render: (r) => r.is_active
          ? '<span class="chip chip-done">نشط</span>' : '<span class="chip chip-bad">موقوف</span>' },
      ], customers, 'مفيش عملاء لسه')}
    </div>

    <h2>قماش العملاء</h2>
    ${tbl([
      { label: 'العميل', key: 'customer_name' },
      { label: 'اللون', key: 'colour' },
      { label: 'الرصيد', num: true, render: (r) => num(r.balance) + ' متر' },
    ], fabric, 'مفيش قماش')}`;

  $('#newCust').onclick = async () => {
    const v = await formDialog('عميل جديد', [
      { key: 'name', label: 'اسم العميل' },
      { key: 'phone', label: 'التليفون (اختياري)', type: 'tel' },
    ]);
    if (!v || !v.name) return;
    try { await rpc('rpc_create_customer', { p_name: v.name, p_phone: v.phone || null }); pageCustomers(); }
    catch (e) { alert(humanError(e)); }
  };
}

async function pageCustomer(id) {
  loading();
  const [customers, orders, fabric] = await Promise.all([view('customers'), view('orders'), view('fabric')]);
  const c = customers.find((x) => x.id === id);
  if (!c) { app.innerHTML = '<div class="err">العميل مش موجود</div>'; return; }
  const myOrders = orders.filter((o) => o.customer_id === id);
  const myFabric = fabric.filter((f) => f.customer_id === id);

  app.innerHTML = `
    <a class="link" href="#customers">← العملاء</a>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-top:8px">
      <div>
        <h1 style="margin:0">${esc(c.name)}</h1>
        <p class="sub" style="margin:4px 0 0">
          <span class="mono">${esc(c.code)}</span> · حرف التشغيل
          <span class="chip chip-open mono">${esc(c.operating_letter)}</span>
          ${c.phone ? ' · <span dir="ltr">' + esc(c.phone) + '</span>' : ''}
        </p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="editCust">✏️ تعديل</button>
        <button class="btn btn-primary" id="invBtn">🖨 فاتورة PDF</button>
      </div>
    </div>
    <div id="custEditBox"></div>

    <h2>أوامر العميل</h2>
    ${tbl([
      { label: 'الكود', render: (r) => `<a class="link" href="#order/${r.id}">${esc(r.code)}</a>` },
      { label: 'الموديل', key: 'model_name' },
      { label: 'الكمية', num: true, render: (r) => num(r.quantity) },
      { label: 'سعر القطعة', num: true, render: (r) => money(r.piece_price) },
      { label: 'الإجمالي', num: true, render: (r) => money(Number(r.quantity) * Number(r.piece_price)) },
      { label: 'الحالة', render: (r) => chip(r.status) },
    ], myOrders, 'مفيش أوامر')}

    <h2>قماش العميل</h2>
    ${tbl([
      { label: 'اللون', key: 'colour' },
      { label: 'الرصيد', num: true, render: (r) => num(r.balance) + ' متر' },
    ], myFabric, 'مفيش قماش')}`;

  $('#invBtn').onclick = () => printInvoice(c, myOrders, myFabric);

  $('#editCust').onclick = () => {
    $('#custEditBox').innerHTML = `
      <div class="card">
        <h2 style="margin-top:0">تعديل بيانات العميل</h2>
        <div class="grid g4">
          <div><label class="label">الاسم</label>
            <input id="ceName" class="input" value="${esc(c.name)}"></div>
          <div><label class="label">التليفون</label>
            <input id="cePhone" class="input" dir="ltr" value="${esc(c.phone || '')}"></div>
          <div><label class="label">ملاحظات</label>
            <input id="ceNotes" class="input" value="${esc(c.notes || '')}"></div>
          <div><label class="label">الحالة</label>
            <select id="ceActive">
              <option value="true"${c.is_active ? ' selected' : ''}>نشط</option>
              <option value="false"${c.is_active ? '' : ' selected'}>موقوف</option>
            </select></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-primary" id="ceSave">حفظ</button>
          <button class="btn btn-ghost" id="ceCancel">إلغاء</button>
        </div>
      </div>`;

    $('#ceCancel').onclick = () => { $('#custEditBox').innerHTML = ''; };
    $('#ceSave').onclick = async () => {
      const name = $('#ceName').value.trim();
      if (!name) { alert('اكتب اسم العميل'); return; }
      try {
        await rpc('rpc_update_customer', {
          p_id: c.id, p_name: name,
          p_phone: $('#cePhone').value.trim() || null,
          p_notes: $('#ceNotes').value.trim() || null,
          p_is_active: $('#ceActive').value === 'true',
        });
        pageCustomer(id);
      } catch (e) { alert(humanError(e)); }
    };
  };
}

function printInvoice(c, orders, fabric) {
  const rows = orders.map((o) => ({
    code: o.code, model: o.model_name, qty: Number(o.quantity),
    price: Number(o.piece_price), total: Number(o.quantity) * Number(o.piece_price),
  }));
  const grand = rows.reduce((s, r) => s + r.total, 0);

  printDoc(`فاتورة ${c.name}`, `
    ${docHeader('فاتورة', 'INV-' + c.code)}
    <div class="party">
      <div><b>العميل</b>${esc(c.name)}</div>
      <div><b>الكود</b>${esc(c.code)}</div>
      <div><b>التليفون</b><span dir="ltr">${esc(c.phone || '—')}</span></div>
      <div><b>حرف التشغيل</b>${esc(c.operating_letter)}</div>
    </div>
    <table>
      <thead><tr><th>الأمر</th><th>الموديل</th><th class="num">الكمية</th>
        <th class="num">سعر القطعة</th><th class="num">الإجمالي</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${esc(r.code)}</td><td>${esc(r.model)}</td>
        <td class="num">${num(r.qty)}</td>
        <td class="num">${money(r.price)}</td>
        <td class="num">${money(r.total)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4">الإجمالي</td><td class="num">${money(grand)}</td></tr></tfoot>
    </table>

    ${fabric.length ? `
      <h1 class="doc-title" style="margin-top:16px;font-size:13px">رصيد القماش</h1>
      <table>
        <thead><tr><th>اللون</th><th class="num">الرصيد (متر)</th></tr></thead>
        <tbody>${fabric.map((f) => `<tr><td>${esc(f.colour)}</td>
          <td class="num">${num(f.balance)}</td></tr>`).join('')}</tbody>
      </table>` : ''}

    <div class="sign"><div>توقيع العميل</div><div>توقيع المصنع</div></div>
    <div class="foot">نظام المصنع — ${dateAr(new Date().toISOString())}</div>`);
}

/* ============================================================================
   الصنايعية + كشف حساب PDF
   ========================================================================== */
async function pageWorkers() {
  loading();
  const workers = await view('workers');
  app.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div><h1 style="margin:0">الصنايعية والحسابات</h1>
        <p class="sub" style="margin:4px 0 0">${num(workers.length)} صنايعي</p></div>
      <button class="btn btn-primary" id="newEmp">+ صنايعي جديد</button>
    </div>
    <div style="margin-top:14px">
      ${tbl([
        { label: 'الكود', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { label: 'الاسم', render: (r) => `<a class="link" href="#worker/${r.id}">${esc(r.name)}</a>` },
        { label: 'التعريش', render: (r) => esc(r.job_title || '—') },
        { label: 'مقبول', num: true, render: (r) => num(r.accepted_total) },
        { label: 'مرفوض', num: true, render: (r) => num(r.rejected_total) },
        { label: 'اتكسب', num: true, render: (r) => money(r.earned_total) },
        { label: 'اتصرف', num: true, render: (r) => money(r.paid_total) },
        { label: 'المتبقي له', num: true, render: (r) => `<b>${money(r.remaining_due)}</b>` },
        { label: '', render: (r) => `<button class="btn btn-sm btn-ghost" data-pay="${esc(r.id)}"
            data-name="${esc(r.name)}" data-due="${esc(r.remaining_due)}">صرف</button>
          <button class="btn btn-sm btn-ghost" data-emp="${esc(r.id)}"
            data-job="${esc(r.job_title || '')}">تعديل</button>` },
      ], workers, 'مفيش صنايعية لسه')}
    </div>`;

  app.querySelectorAll('[data-emp]').forEach((b) => {
    b.onclick = async () => {
      const w = workers.find((x) => x.id === b.dataset.emp);
      const v = await formDialog('تعديل الصنايعي', [
        { key: 'name', label: 'اسم الصنايعي', value: w.name },
        { key: 'job', label: 'التعريش', value: w.job_title || '' },
        { key: 'phone', label: 'التليفون', value: w.phone || '' },
      ]);
      if (!v) return;
      try {
        await rpc('rpc_update_employee', {
          p_id: w.id,
          p_name: v.name,
          p_job_title: v.job || null,
          p_phone: v.phone || null,
        });
        pageWorkers();
      } catch (e) { alert(humanError(e)); }
    };
  });

  $('#newEmp').onclick = async () => {
    const v = await formDialog('صنايعي جديد', [
      { key: 'name', label: 'اسم الصنايعي', value: '' },
      { key: 'job', label: 'التعريش (خياط، قصاص…)', value: '' },
      { key: 'phone', label: 'التليفون', value: '' },
    ]);
    if (!v || !v.name) return;
    try {
      await rpc('rpc_create_employee', {
        p_name: v.name, p_kind: 'worker', p_job_title: v.job || null, p_phone: v.phone || null,
      });
      pageWorkers();
    } catch (e) { alert(humanError(e)); }
  };

  app.querySelectorAll('[data-pay]').forEach((btn) => {
    btn.onclick = async () => {
      const due = Number(btn.dataset.due);
      if (due <= 0) { alert('مفيش مستحقات'); return; }
      const amt = prompt(`مبلغ الصرف لـ ${btn.dataset.name}`, String(due));
      if (!amt) return;
      try {
        const cash = (META.accounts || [])[0];
        await rpc('rpc_post_cash', {
          p_account: cash.id, p_amount: -Math.abs(Number(amt)),
          p_category: 'worker_payment', p_description: 'صرف أجر ' + btn.dataset.name,
          p_employee: btn.dataset.pay,
        });
        pageWorkers();
      } catch (e) { alert(humanError(e)); }
    };
  });
}

async function pageWorker(id) {
  loading();
  const [workers, assignments, cash, rates] = await Promise.all([
    view('workers'), table('work_assignments'), table('financial_transactions', { employee_id: id }),
    table('employee_pay_terms', { employee_id: id }),
  ]);
  const w = workers.find((x) => x.id === id);
  if (!w) { app.innerHTML = '<div class="err">الصنايعي مش موجود</div>'; return; }
  const mine = assignments.filter((a) => a.employee_id === id);
  const myCash = cash.filter((t) => t.employee_id === id);

  app.innerHTML = `
    <a class="link" href="#workers">← الصنايعية</a>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-top:8px">
      <div>
        <h1 style="margin:0">${esc(w.name)}</h1>
        <p class="sub" style="margin:4px 0 0">
          <span class="mono">${esc(w.code)}</span>${w.job_title ? ' · ' + esc(w.job_title) : ''}
          ${w.phone ? ' · <span dir="ltr">' + esc(w.phone) + '</span>' : ''}
        </p>
      </div>
      <button class="btn btn-primary" id="pdfBtn">🖨 كشف حساب PDF</button>
    </div>

    <div class="card tight" style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div>
          <b>حساب الدخول</b>
          <p class="hint" style="margin:2px 0 0">
            ${w.has_login
              ? `عنده حساب باسم <code class="mono">${esc(w.login_username || '')}</code> — يشوف شغله وقبضه هو بس.`
              : 'مفيش حساب دخول للصنايعي ده. اعمل له حساب عشان يشوف شغله وقبضه من الموبايل.'}
          </p>
        </div>
        ${w.has_login
          ? `<a class="btn btn-ghost btn-sm" href="#users">إدارة الحسابات</a>`
          : `<button class="btn btn-primary btn-sm" id="mkLogin">+ إنشاء حساب دخول</button>`}
      </div>
    </div>

    <div class="grid g4" style="margin:16px 0">
      <div class="kpi"><div class="lbl">قطع مقبولة</div><div class="val">${num(w.accepted_total)}</div></div>
      <div class="kpi"><div class="lbl">قطع مرفوضة</div><div class="val">${num(w.rejected_total)}</div></div>
      <div class="kpi"><div class="lbl">إجمالي الأجر</div><div class="val" style="font-size:1.1rem">${money(w.earned_total)}</div></div>
      <div class="kpi"><div class="lbl">اتصرف</div><div class="val" style="font-size:1.1rem">${money(w.paid_total)}</div></div>
      <div class="kpi"><div class="lbl">المتبقي له</div><div class="val" style="font-size:1.1rem">${money(w.remaining_due)}</div></div>
    </div>

    <h2>الشغل المستلم</h2>
    ${tbl([
      { label: 'التاريخ', render: (r) => dateAr(r.received_at || r.assigned_at) },
      { label: 'المرحلة', render: (r) => esc(stageAr(r.stage_code)) },
      { label: 'مسلّم', num: true, render: (r) => num(r.quantity) },
      { label: 'مقبول', num: true, render: (r) => num(r.accepted_qty) },
      { label: 'مرفوض', num: true, render: (r) => num(r.rejected_qty) },
      { label: 'إعادة', num: true, render: (r) => num(r.rework_qty) },
      { label: 'الأجر', num: true, render: (r) => money(r.wage_amount) },
      { label: 'السبب', render: (r) => esc(r.reject_reason || '—') },
    ], mine, 'مفيش شغل مسجل')}

    <h2>أسعار القطع</h2>
    <div class="card tight">
      <div class="grid g3">
        <div><label class="label">المرحلة</label><select id="prStage"></select></div>
        <div><label class="label">سعر القطعة</label>
          <input id="prRate" class="input" type="number" min="0" step="0.01" value="0"></div>
        <div style="display:flex;align-items:flex-end">
          <button class="btn btn-primary" id="prGo" style="width:100%">تحديث السعر</button></div>
      </div>
      <p class="hint" style="margin:8px 0 0">السعر بيسري من تاريخ النهارده. الشغل القديم بيفضل بسعره.</p>
    </div>
    ${tbl([
      { label: 'المرحلة', render: (r) => esc(stageAr(r.stage_key)) },
      { label: 'السعر', num: true, render: (r) => money(r.piece_rate) },
      { label: 'من تاريخ', render: (r) => dateAr(r.effective_from) },
    ], rates, 'مفيش أسعار مسجلة')}

    <h2>الحركات المالية</h2>
    ${tbl([
      { label: 'التاريخ', render: (r) => dateAr(r.txn_date) },
      { label: 'البيان', key: 'description' },
      { label: 'المبلغ', num: true, render: (r) =>
        `<span style="color:${Number(r.amount) < 0 ? 'var(--bad)' : 'var(--good)'}">${money(r.amount)}</span>` },
    ], myCash, 'مفيش حركات')}`;

  $('#pdfBtn').onclick = () => printWorkerStatement(w, mine, myCash);

  const mk = $('#mkLogin');
  if (mk) {
    mk.onclick = async () => {
      const suggested = 'w' + String(w.code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const v = await formDialog('إنشاء حساب دخول لـ ' + w.name, [
        { key: 'username', label: 'اسم المستخدم (إنجليزي)', value: suggested },
        { key: 'password', label: 'كلمة السر (٨ حروف على الأقل)', value: '', type: 'password' },
      ]);
      if (!v || !v.username) return;
      if (!v.password || v.password.length < 8) {
        alert('كلمة السر لازم ٨ حروف على الأقل'); return;
      }
      try {
        await OB.adminCreateUser({
          username: v.username, password: v.password,
          display_name: w.name, employee_id: w.id, roles: ['worker'],
        });
        pageWorker(id);
      } catch (e) { alert(humanError(e)); }
    };
  }

  $('#prStage').innerHTML = (META.stages || []).map((s) =>
    `<option value="${esc(s.code)}">${esc(s.name_ar)}</option>`).join('');
  $('#prGo').onclick = async () => {
    const stage = $('#prStage').value;
    const rate = Number($('#prRate').value || 0);
    if (!stage) { alert('اختار المرحلة'); return; }
    if (rate < 0) { alert('السعر مش ممكن يكون سالب'); return; }
    try {
      await rpc('rpc_set_piece_rate', { p_employee: id, p_stage: stage, p_rate: rate });
      pageWorker(id);
    } catch (e) { alert(humanError(e)); }
  };
}

function printWorkerStatement(w, assignments, cash) {
  const received = assignments.filter((a) => a.received_at);
  const rows = received.map((a) => ({
    date: a.received_at, stage: a.stage_code, qty: Number(a.quantity),
    accepted: Number(a.accepted_qty || 0), rejected: Number(a.rejected_qty || 0),
    wage: Number(a.wage_amount || 0),
  }));
  const totalWage = rows.reduce((s, r) => s + r.wage, 0);
  const totalPaid = cash.filter((t) => Number(t.amount) < 0)
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

  printDoc(`كشف حساب ${w.name}`, `
    ${docHeader('كشف حساب صنايعي', w.code)}
    <div class="party">
      <div><b>الاسم</b>${esc(w.name)}</div>
      <div><b>التعريش</b>${esc(w.job_title || '—')}</div>
      <div><b>التليفون</b><span dir="ltr">${esc(w.phone || '—')}</span></div>
    </div>

    <h1 class="doc-title" style="font-size:13px">الشغل المستلم</h1>
    <table>
      <thead><tr><th>التاريخ</th><th>المرحلة</th><th class="num">مسلّم</th>
        <th class="num">مقبول</th><th class="num">مرفوض</th><th class="num">الأجر</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${dateAr(r.date)}</td><td>${esc(stageAr(r.stage))}</td>
        <td class="num">${num(r.qty)}</td><td class="num">${num(r.accepted)}</td>
        <td class="num">${num(r.rejected)}</td><td class="num">${money(r.wage)}</td></tr>`).join('')}</tbody>
    </table>

    <table class="totals">
      <tr><td>إجمالي الأجر المستحق</td><td>${money(totalWage)}</td></tr>
      <tr><td>إجمالي المصروف</td><td>${money(totalPaid)}</td></tr>
      <tr class="grand"><td>المتبقي له</td><td>${money(totalWage - totalPaid)}</td></tr>
    </table>

    <div class="sign"><div>توقيع الصنايعي</div><div>توقيع الإدارة</div></div>
    <div class="foot">نظام المصنع — ${dateAr(new Date().toISOString())}</div>`);
}

/* ============================================================================
   الخزنة والبنوك
   ========================================================================== */
async function pageAccounts() {
  loading();
  const [accounts, txns] = await Promise.all([view('accounts'), table('financial_transactions')]);
  app.innerHTML = `
    <h1>الخزنة والبنوك</h1>
    <p class="sub">الأرصدة والحركات</p>
    <div class="grid g2">
      ${accounts.map((a) => `<div class="kpi"><div class="lbl">${esc(a.name)}</div>
        <div class="val">${money(a.balance)}</div>
        <div class="hint mono">${esc(a.code)}</div></div>`).join('') || '<div class="empty">مفيش حسابات</div>'}
    </div>

    <h2>إضافة حساب</h2>
    <div class="card tight">
      <div class="grid g4">
        <div><label class="label">الاسم</label><input id="aName" class="input" placeholder="خزنة فرعية"></div>
        <div><label class="label">النوع</label>
          <select id="aKind">
            <option value="cash">خزنة</option>
            <option value="bank">بنك</option>
          </select></div>
        <div><label class="label">رصيد افتتاحي</label>
          <input id="aOpen" class="input" type="number" step="0.01" value="0"></div>
        <div style="display:flex;align-items:flex-end">
          <button class="btn btn-primary" id="aGo" style="width:100%">إضافة</button></div>
      </div>
    </div>

    <h2>حركة جديدة</h2>
    <div class="card">
      <div class="grid g4">
        <div><label class="label">الحساب</label>
          <select id="tAcct">${accounts.map((a) =>
            `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></div>
        <div><label class="label">المبلغ (±)</label>
          <input id="tAmt" class="input" type="number" step="0.01" value="0"></div>
        <div><label class="label">التصنيف</label>
          <select id="tCat">${categoryOptions('other')}</select></div>
        <div><label class="label">البيان</label><input id="tDesc" class="input"></div>
      </div>
      <div style="margin-top:12px"><button class="btn btn-primary" id="tGo">تسجيل الحركة</button></div>
    </div>

    <h2>آخر الحركات</h2>
    ${tbl([
      { label: 'التاريخ', render: (r) => dateAr(r.txn_date) },
      { label: 'البيان', key: 'description', wrap: true },
      { label: 'التصنيف', render: (r) => `<span class="hint">${esc(txnCategoryAr(r.category))}</span>` },
      { label: 'المبلغ', num: true, render: (r) =>
        `<span style="color:${Number(r.amount) < 0 ? 'var(--bad)' : 'var(--good)'}">${money(r.amount)}</span>` },
      { label: '', render: (r) => (r.reverses_id ? '<span class="chip chip-idle">عكس</span>'
        : `<button class="btn btn-sm btn-ghost" data-rev="${esc(r.id)}">عكس</button>`) },
    ], txns.slice(0, 60), 'مفيش حركات')}`;

  $('#tGo').onclick = async () => {
    try {
      await rpc('rpc_post_cash', {
        p_account: $('#tAcct').value,
        p_amount: Number($('#tAmt').value || 0),
        p_category: $('#tCat').value || 'other',
        p_description: $('#tDesc').value.trim(),
      });
      pageAccounts();
    } catch (e) { alert(humanError(e)); }
  };

  app.querySelectorAll('[data-rev]').forEach((b) => {
    b.onclick = async () => {
      const why = prompt('سبب العكس');
      if (!why) return;
      try { await rpc('rpc_reverse_cash', { p_id: b.dataset.rev, p_reason: why }); pageAccounts(); }
      catch (e) { alert(humanError(e)); }
    };
  });

  $('#aGo').onclick = async () => {
    const name = $('#aName').value.trim();
    if (!name) { alert('اكتب اسم الحساب'); return; }
    try {
      await rpc('rpc_create_account', {
        p_name: name, p_kind: $('#aKind').value,
        p_opening: Number($('#aOpen').value || 0),
      });
      pageAccounts();
    } catch (e) { alert(humanError(e)); }
  };
}

/* ============================================================================
   المصروفات
   ========================================================================== */
async function pageExpenses() {
  loading();
  const [expenses, orders] = await Promise.all([table('expenses'), view('orders')]);
  app.innerHTML = `
    <h1>المصروفات</h1>
    <div class="card">
      <h2 style="margin-top:0">مصروف جديد</h2>
      <div class="grid g3">
        <div><label class="label">التصنيف</label><input id="xCat" class="input" placeholder="كهرباء، إيجار…"></div>
        <div><label class="label">المبلغ</label><input id="xAmt" class="input" type="number" min="0" step="0.01" value="0"></div>
        <div><label class="label">من حساب</label>
          <select id="xAcct">${(META.accounts || []).map((a) =>
            `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></div>
      </div>
      <div style="margin-top:10px"><label class="label">الوصف</label><input id="xDesc" class="input"></div>
      <div style="margin-top:10px"><label class="label">على أمر (اختياري)</label>
        <select id="xOrder"><option value="">— بدون —</option>
          ${orders.map((o) => `<option value="${esc(o.id)}">${esc(o.code)} · ${esc(o.model_name)}</option>`).join('')}</select></div>
      <div style="margin-top:12px"><button class="btn btn-primary" id="xGo">حفظ المصروف</button></div>
    </div>

    <h2>المصروفات المسجلة</h2>
    ${tbl([
      { label: 'التاريخ', render: (r) => dateAr(r.expense_date) },
      { label: 'التصنيف', render: (r) => esc(txnCategoryAr(r.category)) },
      { label: 'الوصف', key: 'description', wrap: true },
      { label: 'المبلغ', num: true, render: (r) => money(r.amount) },
    ], expenses, 'مفيش مصروفات')}`;

  $('#xGo').onclick = async () => {
    try {
      await rpc('rpc_create_expense', {
        p_account: $('#xAcct').value,
        p_category: $('#xCat').value.trim() || 'عام',
        p_description: $('#xDesc').value.trim(),
        p_amount: Number($('#xAmt').value || 0),
        p_order: $('#xOrder').value || null,
      });
      pageExpenses();
    } catch (e) { alert(humanError(e)); }
  };
}

/* ============================================================================
   المستلزمات
   ========================================================================== */
async function pageSupplies() {
  loading();
  const [items, warehouses, moves, stock, customers] = await Promise.all([
    table('items'), table('warehouses'), table('inventory_transactions'),
    view('stock'), view('customers'),
  ]);
  const itemName = (id) => items.find((i) => i.id === id)?.name || '—';
  const whName = (id) => warehouses.find((w) => w.id === id)?.name || '—';
  const options = (rows, label, value = 'id') => rows.map((r) =>
    `<option value="${esc(r[value])}">${esc(label(r))}</option>`).join('');

  app.innerHTML = `
    <h1>المستلزمات</h1>
    <p class="sub">مستلزمات المصنع ومستلزمات العملاء (خيوط، أزرار، سحابات، تغليف)</p>

    <div class="card">
      <h2 style="margin-top:0">صنف جديد</h2>
      <div class="grid g4">
        <div><label class="label">الاسم</label><input id="iName" class="input" placeholder="خيط أبيض"></div>
        <div><label class="label">التصنيف</label>
          <select id="iCat">${Object.entries(ITEM_CATEGORIES).map(([k, v]) =>
            `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
        <div><label class="label">الوحدة</label><input id="iUnit" class="input" value="قطعة"></div>
        <div style="display:flex;align-items:flex-end">
          <button class="btn btn-primary" id="iGo" style="width:100%">إضافة</button></div>
      </div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">حركة مستلزمات</h2>
      <div class="grid g3">
        <div><label class="label">نوع الحركة</label>
          <select id="mKind">
            <option value="purchase">شراء مستلزمات</option>
            <option value="customer">استلام من عميل</option>
            <option value="issue">صرف مستلزمات</option>
          </select></div>
        <div><label class="label">الصنف</label><select id="mItem">${options(items, (i) => i.name)}</select></div>
        <div><label class="label">المخزن</label><select id="mWh">${options(warehouses, (w) => w.name)}</select></div>
        <div><label class="label">الكمية</label><input id="mQty" class="input" type="number" min="0" step="0.001"></div>
        <div id="mCostWrap"><label class="label">سعر الوحدة</label><input id="mCost" class="input" type="number" min="0" step="0.01" value="0"></div>
        <div id="mAccWrap"><label class="label">الخزنة</label><select id="mAcc"></select></div>
        <div id="mCustWrap" style="display:none"><label class="label">العميل</label>
          <select id="mCust"><option value="">— مستلزمات المصنع —</option>${options(customers, (c) => c.name)}</select></div>
        <div id="mOrderWrap" style="display:none"><label class="label">الأمر (اختياري)</label>
          <select id="mOrder"><option value="">—</option></select></div>
      </div>
      <div style="margin-top:12px"><label class="label">ملاحظات</label><input id="mNotes" class="input"></div>
      <div style="margin-top:12px"><button class="btn btn-primary" id="mGo">تسجيل الحركة</button></div>
    </div>

    <h2>الأرصدة</h2>
    ${tbl([
      { label: 'الصنف', render: (r) => esc(r.item_name) },
      { label: 'المخزن', render: (r) => esc(r.warehouse_name) },
      { label: 'الملكية', render: (r) => (r.ownership === 'customer'
        ? 'عميل · ' + esc(r.customer_name || '—') : 'مصنع') },
      { label: 'الرصيد', num: true, render: (r) => num(r.quantity) + ' ' + esc(r.base_unit || '') },
      { label: 'وارد', num: true, render: (r) => num(r.received_quantity) },
      { label: 'صرف', num: true, render: (r) => num(r.issued_quantity) },
    ], stock, 'مفيش أرصدة')}

    <h2>الأصناف</h2>
    ${tbl([
      { label: 'الكود', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
      { label: 'الاسم', key: 'name' },
      { label: 'التصنيف', render: (r) => esc(itemCategoryAr(r.category)) },
      { label: 'الوحدة', render: (r) => esc(r.base_unit || '—') },
      { label: 'الحالة', render: (r) => r.is_active
        ? '<span class="chip chip-done">نشط</span>' : '<span class="chip chip-idle">موقوف</span>' },
      { label: '', render: (r) => `<button class="btn btn-sm btn-ghost" data-item="${esc(r.id)}">تعديل</button>` },
    ], items, 'مفيش أصناف')}

    <h2>المخازن</h2>
    <div class="card tight">
      <div class="grid g3">
        <div><label class="label">اسم المخزن</label><input id="whName" class="input" placeholder="مخزن التغليف"></div>
        <div><label class="label">النوع</label>
          <select id="whKind">
            <option value="factory_consumables">مستلزمات المصنع</option>
            <option value="customer_fabric">قماش العملاء</option>
            <option value="customer_supplies">مستلزمات العملاء</option>
            <option value="finished_goods">مخزن التام</option>
            <option value="returns">مرتجعات</option>
          </select></div>
        <div style="display:flex;align-items:flex-end">
          <button class="btn btn-primary" id="whGo" style="width:100%">إضافة مخزن</button></div>
      </div>
    </div>
    ${tbl([
      { label: 'الكود', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
      { label: 'الاسم', key: 'name' },
      { label: 'النوع', render: (r) => esc(warehouseKindAr(r.kind)) },
      { label: '', render: (r) => `<button class="btn btn-sm btn-ghost" data-wh="${esc(r.id)}">تعديل</button>` },
    ], warehouses, 'مفيش مخازن')}

    <h2>تحويل بين المخازن</h2>
    <div class="card tight">
      <div class="grid g4">
        <div><label class="label">الصنف</label><select id="trItem"></select></div>
        <div><label class="label">من مخزن</label><select id="trFrom"></select></div>
        <div><label class="label">إلى مخزن</label><select id="trTo"></select></div>
        <div><label class="label">الكمية</label>
          <input id="trQty" class="input" type="number" min="0" step="0.001"></div>
      </div>
      <div style="margin-top:12px"><button class="btn btn-primary" id="trGo">تحويل</button></div>
    </div>

    <h2>حركة المستلزمات</h2>
    ${tbl([
      { label: 'التاريخ', render: (r) => dateAr(r.txn_date) },
      { label: 'الصنف', render: (r) => esc(itemName(r.item_id)) },
      { label: 'المخزن', render: (r) => esc(whName(r.warehouse_id)) },
      { label: 'الحركة', render: (r) => esc(moveAr(r.movement)) },
      { label: 'الكمية', num: true, render: (r) => num(r.quantity) },
      { label: 'الملكية', render: (r) => (r.ownership === 'customer' ? 'عميل' : 'مصنع') },
      { label: 'ملاحظات', render: (r) => esc(r.notes || '—') },
    ], moves.slice(0, 40), 'مفيش حركات')}`;

  $('#iGo').onclick = async () => {
    const name = $('#iName').value.trim();
    if (!name) { alert('اكتب اسم الصنف'); return; }
    try {
      await rpc('rpc_create_item', {
        p_name: name, p_category: $('#iCat').value,
        p_unit: $('#iUnit').value.trim() || 'قطعة',
      });
      pageSupplies();
    } catch (e) { alert(humanError(e)); }
  };

  const accounts = await view('accounts');
  $('#mAcc').innerHTML = options(accounts, (a) => a.name);
  const paintKind = () => {
    const k = $('#mKind').value;
    $('#mCostWrap').style.display = k === 'purchase' ? '' : 'none';
    $('#mAccWrap').style.display = k === 'purchase' ? '' : 'none';
    $('#mCustWrap').style.display = k === 'issue' ? '' : (k === 'customer' ? '' : 'none');
    $('#mOrderWrap').style.display = k === 'issue' ? '' : 'none';
  };
  paintKind();
  $('#mKind').onchange = paintKind;

  // The order picker narrows to the selected customer's orders when issuing
  // customer-owned supplies, since those may only go to that customer.
  $('#mCust').onchange = async () => {
    const cid = $('#mCust').value;
    const orders = (await view('orders')).filter((o) => o.customer_id === cid);
    $('#mOrder').innerHTML = '<option value="">—</option>' + options(orders,
      (o) => `${o.code} · ${o.model_name}`, 'id');
  };

  $('#whGo').onclick = async () => {
    const name = $('#whName').value.trim();
    if (!name) { alert('اكتب اسم المخزن'); return; }
    try {
      await rpc('rpc_create_warehouse', { p_name: name, p_kind: $('#whKind').value });
      pageSupplies();
    } catch (e) { alert(humanError(e)); }
  };

  app.querySelectorAll('[data-item]').forEach((b) => {
    b.onclick = async () => {
      const it = items.find((x) => x.id === b.dataset.item);
      const v = await formDialog('تعديل الصنف', [
        { key: 'name', label: 'اسم الصنف', value: it.name },
        { key: 'category', label: 'التصنيف', value: it.category || '' },
        { key: 'unit', label: 'الوحدة', value: it.base_unit || '' },
      ]);
      if (!v) return;
      try {
        await rpc('rpc_update_item', {
          p_id: it.id,
          p_name: v.name,
          p_category: v.category || null,
          p_unit: v.unit || null,
        });
        pageSupplies();
      } catch (e) { alert(humanError(e)); }
    };
  });

  app.querySelectorAll('[data-wh]').forEach((b) => {
    b.onclick = async () => {
      const w = warehouses.find((x) => x.id === b.dataset.wh);
      const v = await formDialog('تعديل المخزن', [
        { key: 'name', label: 'اسم المخزن', value: w.name },
      ]);
      if (!v) return;
      try {
        await rpc('rpc_update_warehouse', { p_id: w.id, p_name: v.name });
        pageSupplies();
      } catch (e) { alert(humanError(e)); }
    };
  });

  const optList = (rows, label) => rows.map((r) =>
    `<option value="${esc(r.id)}">${esc(label(r))}</option>`).join('');
  $('#trItem').innerHTML = optList(items, (i) => i.name);
  $('#trFrom').innerHTML = optList(warehouses, (w) => w.name);
  $('#trTo').innerHTML = optList(warehouses, (w) => w.name);
  if (warehouses.length > 1) $('#trTo').selectedIndex = 1;

  $('#trGo').onclick = async () => {
    const qty = Number($('#trQty').value || 0);
    const from = $('#trFrom').value;
    const to = $('#trTo').value;
    if (!qty || qty <= 0) { alert('اكتب كمية صحيحة'); return; }
    if (from === to) { alert('اختار مخزنين مختلفين'); return; }
    try {
      // A transfer is two postings so the ledger keeps a matching pair.
      await rpc('rpc_move_stock', {
        p_item: $('#trItem').value, p_warehouse: from,
        p_quantity: -Math.abs(qty), p_movement: 'transfer_out',
      });
      await rpc('rpc_move_stock', {
        p_item: $('#trItem').value, p_warehouse: to,
        p_quantity: Math.abs(qty), p_movement: 'transfer_in',
      });
      pageSupplies();
    } catch (e) { alert(humanError(e)); }
  };

  $('#mGo').onclick = async () => {
    const kind = $('#mKind').value;
    const qty = Number($('#mQty').value || 0);
    if (!qty || qty <= 0) { alert('اكتب كمية صحيحة'); return; }
    const args = {
      p_item: $('#mItem').value, p_warehouse: $('#mWh').value, p_quantity: qty,
      p_notes: $('#mNotes').value.trim() || null,
    };
    try {
      if (kind === 'purchase') {
        await rpc('rpc_purchase_supplies', {
          ...args, p_unit_cost: Number($('#mCost').value || 0), p_account: $('#mAcc').value,
        });
      } else if (kind === 'customer') {
        await rpc('rpc_receive_customer_supplies', { ...args, p_customer: $('#mCust').value });
      } else {
        await rpc('rpc_issue_supplies', {
          ...args, p_ownership: $('#mCust').value ? 'customer' : 'factory',
          p_customer: $('#mCust').value || null,
          p_order: $('#mOrder').value || null,
        });
      }
      pageSupplies();
    } catch (e) { alert(humanError(e)); }
  };
}

/* ============================================================================
   الماكينات
   ========================================================================== */
async function pageMachines() {
  loading();
  const [machines, maint] = await Promise.all([table('machines'), table('machine_maintenance')]);
  app.innerHTML = `
    <h1>الماكينات</h1>

    <div class="card">
      <h2 style="margin-top:0">ماكينة جديدة</h2>
      <div class="grid g4">
        <div><label class="label">الاسم</label><input id="mName" class="input" placeholder="أوفرلوك"></div>
        <div><label class="label">الموديل</label><input id="mModel" class="input"></div>
        <div><label class="label">تاريخ الشراء</label><input id="mDate" class="input" type="date"></div>
        <div style="display:flex;align-items:flex-end">
          <button class="btn btn-primary" id="mGo" style="width:100%">إضافة</button></div>
      </div>
    </div>

    <h2>الماكينات المسجلة</h2>
    ${tbl([
      { label: 'الكود', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
      { label: 'الاسم', key: 'name' },
      { label: 'الموديل', render: (r) => esc(r.model || '—') },
      { label: 'تاريخ الشراء', render: (r) => dateAr(r.purchased_on) },
      { label: 'الحالة', render: (r) => r.is_active
        ? '<span class="chip chip-done">شغالة</span>' : '<span class="chip chip-idle">موقوفة</span>' },
      { label: '', render: (r) => `<button class="btn btn-sm btn-ghost" data-mach="${esc(r.id)}">تعديل</button>` },
    ], machines, 'مفيش ماكينات')}

    <h2>الصيانة</h2>
    <div class="card">
      <h2 style="margin-top:0">تسجيل صيانة</h2>
      <div class="grid g4">
        <div><label class="label">الماكينة</label><select id="mtMachine"></select></div>
        <div><label class="label">الوصف</label><input id="mtDesc" class="input" placeholder="تغيير إبرة"></div>
        <div><label class="label">التكلفة</label>
          <input id="mtCost" class="input" type="number" min="0" step="0.01" value="0"></div>
        <div><label class="label">التاريخ</label><input id="mtDate" class="input" type="date"></div>
      </div>
      <div style="margin-top:12px"><button class="btn btn-primary" id="mtGo">تسجيل</button></div>
    </div>
    ${tbl([
      { label: 'التاريخ', render: (r) => dateAr(r.done_on) },
      { label: 'الماكينة', render: (r) => esc(machines.find((m) => m.id === r.machine_id)?.name || '—') },
      { label: 'الوصف', key: 'description', wrap: true },
      { label: 'التكلفة', num: true, render: (r) => money(r.cost) },
    ], maint, 'مفيش صيانة مسجلة')}`;

  $('#mtMachine').innerHTML = machines.map((m) =>
    `<option value="${esc(m.id)}">${esc(m.name)} · ${esc(m.code)}</option>`).join('');
  $('#mtGo').onclick = async () => {
    const desc = $('#mtDesc').value.trim();
    if (!desc) { alert('اكتب وصف الصيانة'); return; }
    if (!$('#mtMachine').value) { alert('ضيف ماكينة الأول'); return; }
    try {
      await rpc('rpc_log_maintenance', {
        p_machine: $('#mtMachine').value, p_description: desc,
        p_cost: Number($('#mtCost').value || 0), p_date: $('#mtDate').value || null,
      });
      pageMachines();
    } catch (e) { alert(humanError(e)); }
  };

  $('#mGo').onclick = async () => {
    const name = $('#mName').value.trim();
    if (!name) { alert('اكتب اسم الماكينة'); return; }
    try {
      await rpc('rpc_create_machine', {
        p_name: name, p_model: $('#mModel').value.trim() || null,
        p_purchased_on: $('#mDate').value || null });
      pageMachines();
    } catch (e) { alert(humanError(e)); }
  };

  app.querySelectorAll('[data-mach]').forEach((b) => {
    b.onclick = async () => {
      const m = machines.find((x) => x.id === b.dataset.mach);
      const v = await formDialog('تعديل الماكينة', [
        { key: 'name', label: 'اسم الماكينة', value: m.name },
        { key: 'model', label: 'الموديل', value: m.model || '' },
      ]);
      if (!v) return;
      try {
        await rpc('rpc_update_machine', {
          p_id: m.id, p_name: v.name, p_model: v.model || null,
        });
        pageMachines();
      } catch (e) { alert(humanError(e)); }
    };
  });
}

/* ============================================================================
   لوحة المدير
   ========================================================================== */
async function pageAnalytics() {
  loading();
  const [orders, workers, costing] = await Promise.all([view('orders'), view('workers'), view('costing')]);
  const expected = costing.reduce((s, c) => s + Number(c.expected_revenue), 0);
  const cost = costing.reduce((s, c) => s + Number(c.total_cost), 0);
  const acc = workers.reduce((s, w) => s + Number(w.accepted_total), 0);
  const rej = workers.reduce((s, w) => s + Number(w.rejected_total), 0);
  const rejPct = acc + rej > 0 ? Math.round(rej / (acc + rej) * 100) : 0;

  app.innerHTML = `
    <h1>لوحة المدير</h1>
    <p class="sub">مؤشرات الأداء</p>
    <div class="grid g3">
      <div class="kpi"><div class="lbl">قطع مقبولة</div><div class="val">${num(acc)}</div></div>
      <div class="kpi"><div class="lbl">نسبة الرفض</div><div class="val">${rejPct}%</div></div>
      <div class="kpi"><div class="lbl">الإيراد المتوقع</div><div class="val" style="font-size:1.2rem">${money(expected)}</div></div>
      <div class="kpi"><div class="lbl">إجمالي التكلفة</div><div class="val" style="font-size:1.2rem">${money(cost)}</div></div>
      <div class="kpi"><div class="lbl">الربح المتوقع</div><div class="val" style="font-size:1.2rem">${money(expected - cost)}</div></div>
      <div class="kpi"><div class="lbl">عدد الأوامر</div><div class="val">${num(orders.length)}</div></div>
    </div>

    <h2>ربحية الأوامر</h2>
    ${tbl([
      { label: 'الأمر', key: 'code' },
      { label: 'الإيراد المتوقع', num: true, render: (r) => money(r.expected_revenue) },
      { label: 'التكلفة', num: true, render: (r) => money(r.total_cost) },
      { label: 'الربح', num: true, render: (r) => {
        const p = Number(r.expected_revenue) - Number(r.total_cost);
        return `<b style="color:${p >= 0 ? 'var(--good)' : 'var(--bad)'}">${money(p)}</b>`;
      } },
    ], costing, 'مفيش بيانات')}`;
}

/* ============================================================================
   التقارير
   ========================================================================== */
const REPORTS = [
  ['worker', 'إنتاج الصنايعية'],
  ['stage', 'الإنتاج حسب المرحلة'],
  ['fabric', 'استهلاك القماش'],
  ['orders', 'أوامر التشغيل'],
  ['cost', 'التكلفة والربحية'],
  ['expenses', 'المصروفات'],
  ['cash', 'حركة الخزنة والبنوك'],
  ['customer', 'أرصدة العملاء'],
  ['bundle', 'الشنط المفتوحة'],
  ['reject', 'أسباب الرفض'],
  ['delivery', 'أذون التسليم'],
  ['audit', 'سجل التعديلات'],
];

async function pageReports() {
  const sel = window.__report || 'worker';
  app.innerHTML = `
    <h1>التقارير</h1>
    <div class="card">
      <label class="label">اختار التقرير</label>
      <select id="rSel">${REPORTS.map(([k, l]) =>
        `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
    </div>
    <div id="rBody"><div class="empty">بيحمّل…</div></div>`;
  $('#rSel').onchange = (e) => { window.__report = e.target.value; pageReports(); };
  renderReport(sel);
}

async function renderReport(key) {
  const body = $('#rBody');
  body.innerHTML = '<div class="empty">بيحمّل…</div>';
  try {
    if (key === 'worker') {
      body.innerHTML = tbl([
        { label: 'الكود', key: 'code' }, { label: 'الصنايعي', key: 'name' },
        { label: 'مقبول', num: true, render: (r) => num(r.accepted_total) },
        { label: 'مرفوض', num: true, render: (r) => num(r.rejected_total) },
        { label: 'الأجر', num: true, render: (r) => money(r.earned_total) },
        { label: 'المتبقي', num: true, render: (r) => money(r.remaining_due) },
      ], await view('workers'), 'مفيش بيانات');
    } else if (key === 'stage') {
      const rows = await view('order_stages');
      const agg = {};
      rows.forEach((r) => {
        agg[r.code] = agg[r.code] || { name_ar: r.name_ar, acc: 0, rej: 0, fly: 0 };
        agg[r.code].acc += Number(r.accepted_qty);
        agg[r.code].rej += Number(r.rejected_qty);
        agg[r.code].fly += Number(r.in_flight_qty);
      });
      body.innerHTML = tbl([
        { label: 'المرحلة', key: 'name_ar' },
        { label: 'مقبول', num: true, render: (r) => num(r.acc) },
        { label: 'شغال', num: true, render: (r) => num(r.fly) },
        { label: 'مرفوض', num: true, render: (r) => num(r.rej) },
      ], Object.values(agg), 'مفيش بيانات');
    } else if (key === 'fabric') {
      body.innerHTML = tbl([
        { label: 'العميل', key: 'customer_name' }, { label: 'اللون', key: 'colour' },
        { label: 'الرصيد', num: true, render: (r) => num(r.balance) + ' متر' },
      ], await view('fabric'), 'مفيش بيانات');
    } else if (key === 'orders') {
      body.innerHTML = tbl([
        { label: 'الأمر', key: 'code' }, { label: 'العميل', key: 'customer_name' },
        { label: 'الكمية', num: true, render: (r) => num(r.quantity) },
        { label: 'اتقص', num: true, render: (r) => num(r.cut_quantity) },
        { label: 'الحالة', render: (r) => chip(r.status) },
      ], await view('orders'), 'مفيش بيانات');
    } else if (key === 'cost') {
      body.innerHTML = tbl([
        { label: 'الأمر', key: 'code' },
        { label: 'الإيراد', num: true, render: (r) => money(r.expected_revenue) },
        { label: 'التكلفة', num: true, render: (r) => money(r.total_cost) },
        { label: 'الربح', num: true, render: (r) =>
          money(Number(r.expected_revenue) - Number(r.total_cost)) },
      ], await view('costing'), 'مفيش بيانات');
    } else if (key === 'expenses') {
      body.innerHTML = tbl([
        { label: 'التاريخ', render: (r) => dateAr(r.expense_date) },
        { label: 'التصنيف', render: (r) => esc(txnCategoryAr(r.category)) },
        { label: 'الوصف', key: 'description' },
        { label: 'المبلغ', num: true, render: (r) => money(r.amount) },
      ], await table('expenses'), 'مفيش بيانات');
    } else if (key === 'cash') {
      body.innerHTML = tbl([
        { label: 'التاريخ', render: (r) => dateAr(r.txn_date) },
        { label: 'البيان', key: 'description' },
        { label: 'المبلغ', num: true, render: (r) => money(r.amount) },
      ], await table('financial_transactions'), 'مفيش بيانات');
    } else if (key === 'customer') {
      body.innerHTML = tbl([
        { label: 'الكود', key: 'code' }, { label: 'العميل', key: 'name' },
        { label: 'أوامر', num: true, render: (r) => num(r.order_count) },
        { label: 'مفتوحة', num: true, render: (r) => num(r.open_order_count) },
      ], await view('customers'), 'مفيش بيانات');
    } else if (key === 'bundle') {
      const b = (await view('bundles')).filter((x) => x.status !== 'cancelled' && x.current_stage);
      body.innerHTML = tbl([
        { label: 'الشنطة', key: 'code' }, { label: 'الأمر', key: 'order_code' },
        { label: 'المقاس', key: 'size' }, { label: 'اللون', render: (r) => esc(colourAr(r.colour_label)) },
        { label: 'العدد', num: true, render: (r) => num(r.quantity) },
        { label: 'عند', render: (r) => esc(r.current_holder || '—') },
        { label: 'المرحلة', render: (r) => esc(r.current_stage || '—') },
      ], b, 'مفيش شنط شغالة');
    } else if (key === 'reject') {
      const a = (await table('work_assignments')).filter((x) => Number(x.rejected_qty) > 0);
      body.innerHTML = tbl([
        { label: 'التاريخ', render: (r) => dateAr(r.received_at) },
        { label: 'المرحلة', render: (r) => esc(stageAr(r.stage_code)) },
        { label: 'مرفوض', num: true, render: (r) => num(r.rejected_qty) },
        { label: 'السبب', render: (r) => esc(r.reject_reason || '—'), wrap: true },
      ], a, 'مفيش رفض مسجل');
    } else if (key === 'delivery') {
      body.innerHTML = tbl([
        { label: 'الإذن', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { label: 'التاريخ', render: (r) => dateAr(r.delivered_on) },
        { label: 'ملاحظات', render: (r) => esc(r.notes || '—') },
      ], await table('deliveries'), 'مفيش أذون');
    } else {
      body.innerHTML = tbl([
        { label: 'الوقت', render: (r) => esc(String(r.created_at).replace('T', ' ').slice(0, 19)) },
        { label: 'الجدول', render: (r) => `<span class="mono hint">${esc(r.table_name)}</span>` },
        { label: 'العملية', render: (r) => esc(r.action) },
      ], await table('audit_log'), 'مفيش سجل');
    }
  } catch (e) { body.innerHTML = `<div class="err">${esc(humanError(e))}</div>`; }
}

/* ============================================================================
   المستخدمون والصلاحيات
   ========================================================================== */
async function pageUsers() {
  loading();
  if (!can('system.user.manage')) {
    app.innerHTML = `<h1>المستخدمون والصلاحيات</h1>
      <div class="err">مالكش صلاحية إدارة المستخدمين.</div>`;
    return;
  }
  const users = await view('users');
  const roles = META.roles || [];
  const roleName = Object.fromEntries(roles.map((r) => [r.key, r.name_ar]));

  app.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div><h1 style="margin:0">المستخدمون والصلاحيات</h1>
        <p class="sub" style="margin:4px 0 0">${num(users.length)} حساب دخول</p></div>
      <button class="btn btn-primary" id="newUser">+ مستخدم جديد</button>
    </div>
    <p class="hint" style="margin-top:10px">
      الصلاحيات بتيجي من الدور (القالب)، وأي استثناء لشخص معيّن بيتحدد من زر «الصلاحيات».
      الصنايعي بيشوف شغله وقبضه هو بس — قاعدة enforced في قاعدة البيانات مش في الشاشة.
    </p>
    <div style="margin-top:14px">
      ${tbl([
        { label: 'المستخدم', render: (r) => `<b>${esc(r.username)}</b>
            <div class="hint" style="margin:0">${esc(r.display_name || '')}</div>` },
        { label: 'الدور', render: (r) => (r.roles || []).map((k) =>
            `<span class="chip">${esc(roleName[k] || k)}</span>`).join(' ') || '—' },
        { label: 'مرتبط بـ', render: (r) => r.employee_name
            ? `<span class="mono hint">${esc(r.employee_code || '')}</span> ${esc(r.employee_name)}` : '—' },
        { label: 'الصلاحيات', num: true, render: (r) => num((r.effective_perms || []).length) },
        { label: 'الحالة', render: (r) => r.is_active
            ? '<span style="color:var(--good)">شغّال</span>'
            : '<span style="color:var(--bad)">موقوف</span>' },
        { label: '', render: (r) => `<button class="btn btn-sm btn-ghost" data-perms="${esc(r.id)}">الصلاحيات</button>
          <button class="btn btn-sm btn-ghost" data-edit="${esc(r.id)}">تعديل</button>` },
      ], users, 'مفيش مستخدمين')}
    </div>`;

  app.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => editUser(users.find((u) => u.id === b.dataset.edit), roles);
  });
  app.querySelectorAll('[data-perms]').forEach((b) => {
    b.onclick = () => editPermissions(users.find((u) => u.id === b.dataset.perms), roles);
  });
  $('#newUser').onclick = () => newUser(roles);
}

// Roles are the template: ticking one fills the permission grid with what that job
// normally gets, and the operator adjusts from there.
async function newUser(roles) {
  const v = await formDialog('مستخدم جديد', [
    { key: 'username', label: 'اسم المستخدم (إنجليزي، بدون مسافات)', value: '' },
    { key: 'display', label: 'الاسم الظاهر', value: '' },
    { key: 'password', label: 'كلمة السر (٨ حروف على الأقل)', value: '', type: 'password' },
  ]);
  if (!v || !v.username) return;
  if (!v.password || v.password.length < 8) {
    alert('كلمة السر لازم ٨ حروف على الأقل'); return;
  }

  const picked = await pickRoles(roles, []);
  if (!picked) return;

  try {
    // The login itself is an auth user, which only the edge function can create
    // with the service key. It then calls rpc_create_profile with our JWT, so the
    // permission check still runs in the database.
    await OB.adminCreateUser({
      username: v.username, password: v.password,
      display_name: v.display || v.username, roles: picked,
    });
    pageUsers();
  } catch (e) { alert(humanError(e)); }
}

async function editUser(u, roles) {
  if (!u) return;
  const v = await formDialog('تعديل المستخدم — ' + u.username, [
    { key: 'display', label: 'الاسم الظاهر', value: u.display_name || '' },
  ]);
  if (!v) return;
  const picked = await pickRoles(roles, u.roles || []);
  if (!picked) return;

  try {
    await rpc('rpc_update_profile', { p_id: u.id, p_display: v.display || null });
    await rpc('rpc_set_user_roles', { p_id: u.id, p_roles: picked });

    const toggled = await formDialog('حالة الحساب', [
      { key: 'active', label: 'شغّال؟ (اكتب 1 للإيقاف، أو سيبها فاضية يفضل زي ما هو)', value: '' },
    ]);
    if (toggled && toggled.active === '1') {
      await rpc('rpc_update_profile', { p_id: u.id, p_is_active: false });
    } else if (toggled && toggled.active === '0') {
      await rpc('rpc_update_profile', { p_id: u.id, p_is_active: true });
    }
    pageUsers();
  } catch (e) { alert(humanError(e)); }
}

// A checkbox per role; the caller gets the chosen keys or null when cancelled.
function pickRoles(roles, current) {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'mask';
    mask.innerHTML = `<form class="modal">
      <h3>الدور الوظيفي</h3>
      <p class="hint" style="margin-top:0">الدور هو القالب اللي بيحدد الصلاحيات الافتراضية.</p>
      ${roles.map((r) => `<label style="display:flex;gap:8px;align-items:center;padding:7px 0">
        <input type="checkbox" value="${esc(r.key)}"
          ${current.includes(r.key) ? 'checked' : ''}>
        <span>${esc(r.name_ar)}</span>
        <code class="mono hint" style="margin-inline-start:auto">${num((r.perms || []).length)} صلاحية</code>
      </label>`).join('')}
      <div class="acts">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-ghost" data-cancel>إلغاء</button>
      </div>
    </form>`;
    document.body.appendChild(mask);
    const form = mask.querySelector('form');
    const close = (val) => { mask.remove(); resolve(val); };
    form.onsubmit = (e) => {
      e.preventDefault();
      const picked = [...form.querySelectorAll('input:checked')].map((i) => i.value);
      if (!picked.length) { alert(ERRORS.E_ROLE_REQUIRED); return; }
      close(picked);
    };
    mask.querySelector('[data-cancel]').onclick = () => close(null);
    mask.onclick = (e) => { if (e.target === mask) close(null); };
  });
}

// The permission matrix. A box starts ticked when the role grants it; unticking it
// writes an explicit deny, so the row differs from the template in either direction.
async function editPermissions(u, roles) {
  if (!u) return;
  if (u.id === PROFILE?.id) { alert(ERRORS.E_CANNOT_EDIT_OWN_PERMS); return; }

  const fromRole = new Set();
  (u.roles || []).forEach((k) => {
    const r = roles.find((x) => x.key === k);
    (r?.perms || []).forEach((p) => fromRole.add(p));
  });
  const overrides = u.overrides || {};
  const groups = {};
  (META.permissions || []).forEach((p) => {
    (groups[p.group_ar] = groups[p.group_ar] || []).push(p);
  });

  const mask = document.createElement('div');
  mask.className = 'mask';
  mask.innerHTML = `<form class="modal" style="max-width:720px">
    <h3>صلاحيات ${esc(u.username)}</h3>
    <p class="hint" style="margin-top:0">
      العلامة الفاتحة = جاية من الدور. لو شيلتها، بتبقى منع صريح لهذا المستخدم بس.
    </p>
    <div style="max-height:55vh;overflow:auto;padding-inline-end:4px">
      ${Object.entries(groups).map(([g, perms]) => `
        <h2 style="font-size:13px;margin:14px 0 6px">${esc(g)}</h2>
        ${perms.map((p) => {
          const inherited = fromRole.has(p.code);
          const on = p.code in overrides ? overrides[p.code] : inherited;
          return `<label style="display:flex;gap:8px;align-items:center;padding:5px 0;
              border-bottom:1px solid var(--paper-line)">
            <input type="checkbox" data-perm="${esc(p.code)}" ${on ? 'checked' : ''}>
            <span>${esc(p.name_ar)}</span>
            ${inherited ? '<span class="chip" style="margin-inline-start:auto">من الدور</span>' : ''}
            <code class="mono hint">${esc(p.code)}</code>
          </label>`;
        }).join('')}`).join('')}
    </div>
    <div class="acts">
      <button type="submit" class="btn btn-primary">حفظ الاستثناءات</button>
      <button type="button" class="btn btn-ghost" data-cancel>إلغاء</button>
    </div>
  </form>`;
  document.body.appendChild(mask);

  const form = mask.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    // Only what differs from the role is stored; everything else falls back to it.
    const diff = {};
    form.querySelectorAll('[data-perm]').forEach((i) => {
      const code = i.dataset.perm;
      const inherited = fromRole.has(code);
      if (i.checked !== inherited) diff[code] = i.checked;
    });
    try {
      await rpc('rpc_set_user_permissions', { p_id: u.id, p_overrides: diff });
      mask.remove();
      pageUsers();
    } catch (err) { alert(humanError(err)); }
  };
  mask.querySelector('[data-cancel]').onclick = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
}

/* ============================================================================
   استيراد البيانات
   ========================================================================== */
async function pageImport() {
  app.innerHTML = `
    <h1>استيراد البيانات</h1>
    <p class="sub">من ملف Excel أو CSV — عميل واحد أو صف واحد في المرة</p>
    <div class="card">
      <h2 style="margin-top:0">عملاء</h2>
      <p class="hint">الأعمدة: الاسم، التليفون، حرف التشغيل. أي صف ناقص بيترفض لوحده.</p>
      <textarea id="csvCust" class="input" rows="5" style="font-family:ui-monospace,monospace"
        placeholder="محمود الجندي,01011550189,M&#10;عبد الرحمن الجمل,01000000001,AG"></textarea>
      <div style="margin-top:10px"><button class="btn btn-primary" id="impCust">استيراد العملاء</button></div>
      <div id="impCustOut" style="margin-top:10px"></div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">صنايعية</h2>
      <p class="hint">الأعمدة: الاسم، التعريش، التليفون.</p>
      <textarea id="csvEmp" class="input" rows="5" style="font-family:ui-monospace,monospace"
        placeholder="محمد محمود,تعريش,01011550189"></textarea>
      <div style="margin-top:10px"><button class="btn btn-primary" id="impEmp">استيراد الصنايعية</button></div>
      <div id="impEmpOut" style="margin-top:10px"></div>
    </div>`;

  const runImport = async (raw, fn, mapper, outEl) => {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { outEl.innerHTML = '<div class="err">مفيش صفوف</div>'; return; }
    let ok = 0; const errs = [];
    for (const line of lines) {
      const cells = line.split(',').map((c) => c.trim());
      try { await rpc(fn, mapper(cells)); ok++; }
      catch (e) { errs.push(`${line} → ${humanError(e)}`); }
    }
    outEl.innerHTML = `<div class="ok">اتضاف ${num(ok)} من ${num(lines.length)}</div>
      ${errs.length ? `<div class="err" style="margin-top:8px">${errs.map(esc).join('<br>')}</div>` : ''}`;
  };

  $('#impCust').onclick = () => runImport($('#csvCust').value, 'rpc_create_customer',
    (c) => ({ p_name: c[0], p_phone: c[1] || null, p_letter: c[2] || null }), $('#impCustOut'));
  $('#impEmp').onclick = () => runImport($('#csvEmp').value, 'rpc_create_employee',
    (c) => ({ p_name: c[0], p_kind: 'worker', p_job_title: c[1] || null, p_phone: c[2] || null }),
    $('#impEmpOut'));
}

/* ============================================================================
   سجل التعديلات
   ========================================================================== */
async function pageAudit() {
  loading();
  const rows = await table('audit_log');
  app.innerHTML = `
    <h1>سجل التعديلات</h1>
    <p class="sub">كل تغيير على الجداول الأساسية بيتسجل تلقائي</p>
    ${tbl([
      { label: 'الوقت', render: (r) => esc(String(r.created_at).replace('T', ' ').slice(0, 19)) },
      { label: 'الجدول', render: (r) => `<span class="mono hint">${esc(r.table_name)}</span>` },
      { label: 'العملية', render: (r) => `<span class="chip chip-idle">${esc(r.action)}</span>` },
      { label: 'السجل', render: (r) => `<span class="mono hint">${esc(String(r.row_pk || '').slice(0, 8))}</span>` },
    ], rows, 'مفيش تعديلات مسجلة')}`;
}

/* ============================================================================
   المساعدة
   ========================================================================== */
function pageHelp() {
  app.innerHTML = `
    <h1>المساعدة</h1>
    <p class="sub">إزاي تشتغل على السيستم خطوة بخطوة</p>

    <h2>تثبيت التطبيق على الموبايل</h2>
    <div class="card">
      <b>أندرويد (كروم)</b>
      <p class="hint">افتح الموقع وسجّل دخولك، وبعدين من قايمة المتصفح ⋮ اضغط «تثبيت التطبيق».</p>
      <b>آيفون (سفاري)</b>
      <p class="hint">اضغط زرار المشاركة ⬆ واختار «إضافة إلى الشاشة الرئيسية».</p>
    </div>

    <h2>رئيس العمال — مسح الباركود</h2>
    <div class="card">
      <p class="hint">افتح «رئيس العمال» واضغط «📷 مسح بالكاميرا»، ووجّه الكاميرا على ليبل الشنطة.
        لو المتصفح ما بيدعمش القراءة، اكتب الكود في الخانة (مثال: <b class="mono">BND0001</b>).
        ينفع كمان تمسح باركود قطعة (<b class="mono">MM0001</b>) والسيستم بيطلّع الشنطة بتاعتها.</p>
    </div>

    <h2>تسليم واستلام</h2>
    <div class="card">
      <b>تسليم</b>
      <p class="hint">اختار المرحلة المتاحة والصنايعي، واضغط «سلّم الشنطة». المراحل المعتمدة على غيرها
        مش بتظهر غير لما اللي قبلها يخلص.</p>
      <b>استلام</b>
      <p class="hint">امسح نفس الشنطة. المقبول + المرفوض + الإعادة لازم يساووا الكمية المسلّمة.
        لو فيه مرفوض لازم سبب. الأجر بيتحسب على المقبول بس.</p>
    </div>

    <h2>الطباعة و PDF</h2>
    <div class="card">
      <p class="hint">من تفاصيل الأمر: «طباعة الأمر»، ومن الشنط: «🏷 ليبل» بيطبع ليبلات بالباركود.
        من صفحة العميل: «🖨 فاتورة PDF». من صفحة الصنايعي: «🖨 كشف حساب PDF».
        في نافذة الطباعة اختار «حفظ كـ PDF».</p>
    </div>

    <h2>لو حاجة مش شغالة</h2>
    <div class="card">
      <p class="hint">أي رسالة خطأ بتقول السبب بالعربي. كل عملية مالية أو مخزنية ليها «عكس» بسبب
        إجباري، فمفيش حذف بيضيّع التاريخ.</p>
    </div>`;
}

/* ============================================================================
   الراوتر
   ========================================================================== */
const ROUTES = {
  home: pageHome, foreman: pageForeman, orders: pageOrders, 'order-new': pageOrderNew,
  templates: pageTemplates, warehouse: pageWarehouse, customers: pageCustomers,
  workers: pageWorkers, accounts: pageAccounts, expenses: pageExpenses,
  supplies: pageSupplies, machines: pageMachines, analytics: pageAnalytics,
  reports: pageReports, users: pageUsers, import: pageImport, audit: pageAudit,
  help: pageHelp,
};

const NAV_KEYS = new Set(NAV.flatMap((g) => g.items.map((i) => i.key)));

function route() {
  stopScan();
  const hash = (location.hash || '#home').slice(1);
  const [key, param] = hash.split('/');

  let navKey = key;
  if (key === 'order' || key === 'order-new' || key === 'templates') navKey = 'orders';
  if (key === 'customer') navKey = 'customers';
  if (key === 'worker') navKey = 'workers';
  renderShell(NAV_KEYS.has(navKey) ? navKey : key);

  $('#sidebar').classList.remove('open');
  $('#scrim').classList.remove('on');

  let run = ROUTES[key];
  if (key === 'order' && param) run = () => pageOrder(param);
  if (key === 'customer' && param) run = () => pageCustomer(param);
  if (key === 'worker' && param) run = () => pageWorker(param);

  if (!run) { app.innerHTML = '<div class="err">الصفحة مش موجودة</div>'; return; }
  Promise.resolve().then(run).catch(fail);
}

window.addEventListener('hashchange', route);

$('#menuBtn').onclick = () => {
  $('#sidebar').classList.add('open');
  $('#scrim').classList.add('on');
};
$('#scrim').onclick = () => {
  $('#sidebar').classList.remove('open');
  $('#scrim').classList.remove('on');
};
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-go]');
  if (btn) go('#' + btn.dataset.go);
});

/* تشغيل — مفيش شاشة تظهر قبل الدخول. */
const boot = async () => {
  if (!OB.currentUser()) { renderLogin(); return; }
  try {
    await OB.refreshIfNeeded();
    const [m, p] = await Promise.all([
      meta(),
      rpc('rpc_my_permissions').catch(() => []),
    ]);
    PROFILE = m.profile || null;
    META = {
      stages: m.stages || [], accounts: m.accounts || [],
      permissions: m.permissions || [], roles: m.roles || [],
      granted: p || [],
    };
    STAGE_NAMES = Object.fromEntries(META.stages.map((x) => [x.code, x.name_ar]));
    document.body.classList.remove('auth-locked');
    route();
  } catch (e) {
    if (String(e.message || '').startsWith('E_NO_SESSION') || e.status === 401) {
      OB.signOut();
      renderLogin();
    } else {
      app.innerHTML = '<div class="err">تعذر تحميل البيانات: ' + esc(e.message) + '</div>';
    }
  }
};

boot();
