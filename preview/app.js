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
/* نفس تنسيق المرجع: الرقم LTR ثابت العرض، والعملة أصغر منه (0.62em). */
const amount = (v) => `<span class="num">${Number(v || 0).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><span class="cur">ج.م</span>`;
const num = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateAr = (d) => {
  if (!d) return '—';
  const x = new Date(String(d).length <= 10 ? d + 'T00:00:00' : d);
  if (isNaN(x)) return '—';
  return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
};

/* وقت واسم جدول بالعربي — سجل التعديلات بيعرضهم للمستخدم مش للمطوّر. */
const tsAr = (d) => {
  if (!d) return '—';
  const x = new Date(String(d));
  if (isNaN(x)) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${dateAr(d)}, ${p(x.getHours())}:${p(x.getMinutes())}`;
};

const TABLE_AR = {
  production_orders: 'أمر تشغيل', order_stages: 'مرحلة أمر', stage_templates: 'قالب مراحل',
  stage_template_stages: 'مرحلة قالب', cut_lines: 'قص', bundles: 'شنطة', bundle_colors: 'bundle_colors',
  work_assignments: 'استلام شغل', deliveries: 'إذن تسليم', delivery_lines: 'تسليم شغل',
  customer_returns: 'مرتجع', customers: 'عميل', customer_fabric_movements: 'قماش',
  customer_supply_receipts: 'استلام مستلزمات', customer_supply_issues: 'صرف مستلزمات',
  items: 'صنف', warehouses: 'مخزن', inventory_transactions: 'حركة مخزن',
  machines: 'ماكينة', machine_maintenance: 'صيانة', expenses: 'مصروف',
  financial_transactions: 'حركة خزنة', employees: 'موظف', employee_pay_terms: 'حساب صنايعي',
  profiles: 'مستخدم', roles: 'دور', permissions: 'صلاحية', role_permissions: 'صلاحية دور',
  user_roles: 'دور مستخدم', user_permissions: 'صلاحية مستخدم', company_settings: 'إعدادات',
  rejection_reasons: 'سبب رفض', operational_codes: 'أكواد تشغيل',
};
const tableAr = (t) => TABLE_AR[t] || t;

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
  E_ORDER_NOT_FINISHED: 'لسه فيه قطع ما خلصتش — اقفل الأمر بعد ما كل الشنط تخلص',
  E_FABRIC_SHORT: 'الرصيد مش كفاية — راجع أمتار العميل للون ده',
  E_STAGE_LOCKED: 'المرحلة دي بدأت خلاص — سعرها مش بيتعدّل بعد ما الشغل اتسجّل عليها',
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
  E_CUSTOMER_EXISTS: 'العميل ده متسجّل قبل كده — نفس الاسم أو نفس التليفون',
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
    { key: 'home', label: 'الرئيسية', icon: 'home' },
    { key: 'foreman', label: 'رئيس العمال', icon: 'package', perm: 'production.assignment.create' },
    { key: 'orders', label: 'أوامر التشغيل', icon: 'scissors', perm: 'production.order.view' },
    { key: 'warehouse', label: 'المخزن', icon: 'store', perm: 'inventory.view' },
    { key: 'help', label: 'المساعدة', icon: 'help' },
  ]},
  { group: 'الحسابات', items: [
    { key: 'customers', label: 'العملاء', icon: 'users', perm: 'customer.view' },
    { key: 'workers', label: 'الصنايعية والحسابات', icon: 'worker', perm: 'employee.view' },
    { key: 'accounts', label: 'الخزنة والبنوك', icon: 'wallet', perm: 'account.view' },
    { key: 'expenses', label: 'المصروفات', icon: 'receipt', perm: 'expense.view' },
    { key: 'supplies', label: 'المستلزمات', icon: 'supplies', perm: 'inventory.view' },
  ]},
  { group: 'الإدارة', items: [
    { key: 'machines', label: 'الماكينات', icon: 'cog', perm: 'machine.view' },
    { key: 'analytics', label: 'لوحة المدير', icon: 'chart', perm: 'reports.view' },
    { key: 'reports', label: 'التقارير', icon: 'file', perm: 'reports.view' },
    { key: 'users', label: 'المستخدمون والصلاحيات', icon: 'lock', perm: 'system.user.manage' },
    { key: 'import', label: 'استيراد البيانات', icon: 'upload', perm: 'system.user.manage' },
    { key: 'audit', label: 'سجل التعديلات', icon: 'history', perm: 'audit.view' },
  ]},
];
const TABS = [
  ['home', 'الرئيسية', 'home'], ['foreman', 'التسليم', 'package'],
  ['orders', 'الأوامر', 'scissors'], ['customers', 'العملاء', 'users'], ['more', 'المزيد', 'menu'],
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
          ${icon(i.icon)}${esc(i.label)}
        </a>`).join('')}`;
    }).join('')}
    <div class="sb-foot">
      <div class="sb-avatar">${esc(initial)}</div>
      <div>
        <div class="sb-user">${esc(PROFILE?.display_name || 'المدير')}</div>
        <div class="sb-role">${esc(PROFILE?.is_superuser ? 'مدير النظام' : 'مستخدم')}</div>
      </div>
      <button class="sb-out" id="sbOut" title="خروج">${icon('logout', 15)}</button>
    </div>`;

  $('#tabbar').innerHTML = TABS.map(([k, label, ic]) =>
    `<button data-go="${k}" class="${k === activeKey ? 'active' : ''}">
       ${icon(ic, 20)}${label}</button>`).join('');

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
          <div class="login-logo">${icon('scissors', 28)}</div>
          <h1>نظام المصنع</h1>
          <p>سجّل دخولك عشان تكمّل</p>
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
function tbl(cols, rows, emptyText, emptyIcon, foot) {
  if (!rows || !rows.length) {
    return emptyIcon
      ? emptyState(emptyIcon, emptyText || 'مفيش بيانات')
      : `<div class="empty">${esc(emptyText || 'مفيش بيانات')}</div>`;
  }
  return `<div class="tbl-wrap"><table>
    <thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${cols.map((c) => {
      const v = c.render ? c.render(r) : esc(r[c.key] == null ? '—' : r[c.key]);
      return `<td class="${c.num ? 'num' : ''}${c.wrap ? ' wrap' : ''}">${v}</td>`;
    }).join('')}</tr>`).join('')}</tbody>
    ${foot && foot.length ? `<tfoot>${foot.map((cells) => `<tr>${cells.map((v, i) =>
      `<td class="${cols[i] && cols[i].num ? 'num' : ''}">${v}</td>`).join('')}</tr>`).join('')}</tfoot>` : ''}
  </table></div>`;
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
/* بنود مصروفات المصنع زي المرجع — بتتستخدم كاقتراحات في الفلتر والفورم. */
const EXPENSE_CATS = ['كهربا', 'مياه', 'إيجار', 'صيانة', 'نقل وشحن',
  'مرتبات إدارية', 'بوفيه ونظافة', 'أخرى'];
const categoryOptions = (selected) => Object.entries(TXN_CATEGORIES).map(([k, v]) =>
  `<option value="${k}"${k === selected ? ' selected' : ''}>${v}</option>`).join('');
/* ---------------------------------------------------------------- أيقونات */
/* مسارات بنفس نمط المرجع (خطوط 24×24، سماكة 1.75، أطراف مدوّرة).
   الإيموجي بتختلف من جهاز لجهاز وبتطلع ملوّنة وسط واجهة هادية — الخطوط
   بتاخد اللون من النص، فبتشتغل مع الحالات (نشط/موقوف) من غير كود زيادة. */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M9.5 20v-5.5h5V20"/>',
  package: '<path d="M12 2.8 20.5 7v10L12 21.2 3.5 17V7z"/><path d="M3.5 7 12 11.2 20.5 7"/><path d="M12 11.2v10"/>',
  scissors: '<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8.1 8.1 20 20M8.1 15.9 20 4"/>',
  store: '<path d="M3.5 9.5V20h17V9.5"/><path d="M2 9.5 4.5 4h15L22 9.5a3 3 0 0 1-5 1 3 3 0 0 1-5 0 3 3 0 0 1-5 0 3 3 0 0 1-5-1z"/><path d="M9.5 20v-6h5v6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 1 1 3.4 2.5c-.6.2-.9.8-.9 1.4v.4"/><path d="M12 17.2h.01"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.8 20c0-3.4 2.8-5.6 6.2-5.6s6.2 2.2 6.2 5.6"/><path d="M16.5 5.2a3.2 3.2 0 0 1 0 6.1"/><path d="M17.8 14.6c2.1.5 3.4 2.1 3.4 4.4"/>',
  worker: '<path d="M4 13a8 8 0 0 1 16 0"/><path d="M2.8 13h18.4"/><path d="M9.5 13v3.5a2.5 2.5 0 0 0 5 0V13"/><path d="M12 5V3.2"/>',
  wallet: '<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h11.5A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19H6a2.5 2.5 0 0 1-2.5-2.5z"/><path d="M3.5 9.5h17"/><circle cx="16.5" cy="14" r="1.1"/>',
  receipt: '<path d="M5.5 3h13v18l-2.2-1.6-2.2 1.6-2.1-1.6-2.2 1.6-2.1-1.6L5.5 21z"/><path d="M9 8h6M9 12h6M9 16h3.5"/>',
  supplies: '<path d="M8.5 3.5h7v3h-7z"/><path d="M6 6.5h12v14H6z"/><path d="M10 11.5h4M12 9.5v4"/>',
  cog: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M4.6 7.2l2 1.2M17.4 15.6l2 1.2M4.6 16.8l2-1.2M17.4 8.4l2-1.2"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8.5 20v-6.5M13 20V8.5M17.5 20v-9.5"/>',
  file: '<path d="M6 3h7.5L19 8.5V21H6z"/><path d="M13.5 3v5.5H19"/><path d="M9.5 13h7M9.5 16.5h4.5"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/><path d="M12 15v2.2"/>',
  upload: '<path d="M12 16.5V4.5"/><path d="M7.5 9 12 4.5 16.5 9"/><path d="M4.5 15v4.5h15V15"/>',
  history: '<path d="M3.8 12a8.2 8.2 0 1 0 2.5-5.9"/><path d="M3.5 4v4.2h4.2"/><path d="M12 8v4.4l3.2 1.9"/>',
  camera: '<path d="M3.5 8.5h3l1.6-2.4h7.8L17.5 8.5h3v11h-17z"/><circle cx="12" cy="14" r="3.4"/>',
  printer: '<path d="M7 8.5V3.5h10v5"/><rect x="3.5" y="8.5" width="17" height="7.5" rx="2"/><path d="M7 16h10v4.5H7z"/>',
  tag: '<path d="M12.6 3.2H21v8.4l-9.2 9.2-8.4-8.4z"/><circle cx="16.8" cy="7.2" r="1.3"/>',
  pencil: '<path d="M4 20h4L20 8l-4-4L4 16z"/><path d="M14.5 5.5 18.5 9.5"/>',
  return: '<path d="M9 5.5 4.5 10 9 14.5"/><path d="M4.5 10h9.5a5 5 0 0 1 0 10H11"/>',
  check: '<path d="M4.5 12.5 9.5 17.5 19.5 6.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.4 15.4 20.5 20.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 3.5 21.5 20.5h-19z"/><path d="M12 9.5v4.6"/><path d="M12 17.4h.01"/>',
  truck: '<path d="M2.5 6.5h10.5v10H2.5z"/><path d="M13 10h4l3 3v3.5h-7z"/><circle cx="6.5" cy="18.5" r="1.8"/><circle cx="16.5" cy="18.5" r="1.8"/>',
  chevron: '<path d="M14.5 6 8.5 12l6 6"/>',
  arrow: '<path d="M20 12H4.5"/><path d="M10 5.5 4 12l6 6.5"/>',
  logout: '<path d="M9.5 4.5H5v15h4.5"/><path d="M14 8l4 4-4 4"/><path d="M18 12H9.5"/>',
  barcode: '<path d="M3.5 5.5v13M6.5 5.5v13M10 5.5v13M13.5 5.5v13M16.5 5.5v13M20.5 5.5v13"/>',
  box: '<path d="M4 7.5 12 3.5l8 4v9l-8 4-8-4z"/><path d="M4 7.5 12 11.5l8-4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
};

/* أيقونة داخل النص: بترث الحجم من حجم الخط لو مفيش مقاس. */
const icon = (name, size) => {
  const d = ICONS[name] || ICONS.box;
  return `<svg class="ico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"
    ${size ? `style="width:${size}px;height:${size}px"` : ''} aria-hidden="true">${d}</svg>`;
};

/* زر بأيقونة في الأول. الأيقونة لوحدها مش مفهومة، والنص لوحده مش سريع —
   الاتنين مع بعض. */
const btnIcon = (name, label, cls) => `<span class="ico-svg-wrap">${icon(name, 18)}</span>${esc(label)}`;

/* رأس صفحة موحّد: العنوان والشروح على اليمين، الأزرار على الشمال. */
const pageHead = (title, sub, actions) => `
  <div class="phead">
    <div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div>
    ${actions ? `<div class="phead-acts">${actions}</div>` : ''}
  </div>`;

/* حالة الفراغ بتيقول للمستخدم يعمل إيه، مش بس إن مفيش بيانات. */
const emptyState = (iconName, title, hint) => `
  <div class="empty">
    <div class="empty-ico">${icon(iconName, 22)}</div>
    <div><b>${esc(title)}</b></div>
    ${hint ? `<div class="hint" style="margin-top:4px">${esc(hint)}</div>` : ''}
  </div>`;

/* فلتر مقسّم زي المرجع: خيار واحد ظاهر كنشط. */
const segFilter = (name, options, active) => `
  <div class="seg" role="group">
    ${options.map(([k, label]) => `<button data-seg="${esc(name)}" data-val="${esc(k)}"
      aria-pressed="${k === active}">${esc(label)}</button>`).join('')}
  </div>`;

/* بيربط كل أزرار الفلتر اللي في الصفحة الحالية بمستدعى واحد. */
const bindSeg = (name, onChange) => {
  app.querySelectorAll(`[data-seg="${name}"]`).forEach((b) => {
    b.onclick = () => onChange(b.dataset.val);
  });
};

/* هيكل عظمي بشكل الصفحة اللي جاية، عشان ما يحصلش قفزة في التخطيط. */
const skeleton = (kind) => {
  if (kind === 'cards') {
    return `<div class="grid g4">${'<div class="skel" style="height:78px;border-radius:.75rem"></div>'.repeat(4)}</div>`;
  }
  const rows = '<div class="skel skel-line"></div>'.repeat(6);
  return `<div class="card"><div class="skel skel-line" style="width:35%;height:16px"></div>
    <div style="margin-top:14px">${rows}</div></div>`;
};

/* ---------------------------------------------------------------- تنبيهات */
/* alert() بيقفل الواجهة كلها ويبان إنه بتاع المتصفح مش بتاع التطبيق.
   التنبيه الجانبي بيمشي مع باقي الواجهة، وبيختفي لوحده. */
function toast(message, kind) {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.className = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${kind || 'ok'}`;
  t.innerHTML = `<span class="toast-ico">${icon(kind === 'err' ? 'alert' : 'check', 16)}</span>
    <span>${esc(message)}</span>`;
  box.appendChild(t);

  const close = () => {
    t.classList.add('toast-out');
    setTimeout(() => t.remove(), 200);
  };
  t.onclick = close;
  setTimeout(close, kind === 'err' ? 6500 : 3800);
}

/* نفس توقيع alert عشان الاستبدال يبقى ميكانيكي وآمن. */
const notify = (msg) => toast(msg, 'ok');
const notifyErr = (msg) => toast(msg, 'err');

/* الزرار بيقفل نفسه وقت الإرسال عشان الضغط مرتين مايعملش عمليتين. */
async function withBusy(btn, label, fn) {
  if (!btn) return fn();
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  if (label) btn.innerHTML = `<span class="spin"></span>${esc(label)}`;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.innerHTML = original;
  }
}

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
/* الحقول اللي عليها required لازم تتكتب. التحقق في المتصفح بيرفض الإرسال
   ويوريك رسالة عربية بدل ما تبعت قيمة فاضية للسرفر وترجع بخطأ مش مفهوم. */
function formDialog(title, fields) {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'mask';
    mask.innerHTML = `<form class="modal">
      <h3>${esc(title)}</h3>
      ${fields.map((f) => `<div class="field">
        <label class="label" for="fd-${esc(f.key)}">${esc(f.label)}</label>
        ${f.options ? `<select class="input" id="fd-${esc(f.key)}" name="${esc(f.key)}">
          ${f.options.map((o) => `<option value="${esc(o.value)}"
            ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>` : `<input class="input" id="fd-${esc(f.key)}" name="${esc(f.key)}"
          type="${esc(f.type || 'text')}" value="${esc(f.value ?? '')}"
          ${f.min !== undefined ? `min="${esc(String(f.min))}"` : ''}
          ${f.step !== undefined ? `step="${esc(String(f.step))}"` : ''}
          ${f.required ? 'required' : ''}>`}
        ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}
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

/* رسالة المتصفح الافتراضية إنجليزي ("Please fill out this field").
   بقت عربية عشان الشاشة كلها عربي. */
document.addEventListener('invalid', (e) => {
  const el = e.target;
  if (!el || !el.validity) return;
  if (el.validity.valueMissing) el.setCustomValidity('اكتب القيمة هنا');
  else if (el.validity.rangeUnderflow) el.setCustomValidity(`أقل قيمة مسموحة ${el.min}`);
  else if (el.validity.badInput) el.setCustomValidity('اكتب رقم صحيح');
  else el.setCustomValidity('');
}, true);

document.addEventListener('input', (e) => {
  if (e.target && e.target.setCustomValidity) e.target.setCustomValidity('');
}, true);

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
  if (!w) { notify('المتصفح منع فتح النافذة — اسمح بالنوافذ المنبثقة عشان تطبع'); return; }
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
/* أول يوم في الشهر — أساس كل التقارير الدورية في المرجع. */
const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from, to) => {
  if (!from) return 0;
  const a = new Date(String(from).slice(0, 10) + 'T00:00:00');
  const b = new Date(String(to).slice(0, 10) + 'T00:00:00');
  return Math.floor((b - a) / 86400000);
};

async function pageHome() {
  loading();
  const since = monthStart();
  const [orders, workers, accounts, stages, cashTxns] = await Promise.all([
    view('orders'), view('workers'), view('accounts'),
    view('order_stages'), table('financial_transactions'),
  ]);

  const open = orders.filter((o) => o.status === 'open');
  const openPieces = open.reduce((s, o) => s + Number(o.quantity), 0);
  const due = workers.reduce((s, w) => s + Number(w.remaining_due), 0);
  const cash = accounts.reduce((s, a) => s + Number(a.balance), 0);
  /* مدفوعات العملاء مخزّنة بالسالب لأنها بتخرج من الخزنة. */
  const collectedFromCustomers = cashTxns
    .filter((t) => t.category === 'customer_payment' && !t.reverses_id)
    .reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0);

  /* مستحقات العملاء = قيمة المسلَّم ناقص التحصيلات. مفيش فواتير لسه،
     فالمسلَّم × سعر القطعة هو المستحق، ومدفوعات العملاء بتتخصم منه. */
  const deliveredValue = orders.reduce(
    (s, o) => s + Number(o.delivered_quantity || 0) * Number(o.piece_price || 0), 0);
  const receivables = Math.max(0, deliveredValue - collectedFromCustomers);

  /* المراحل المتأخرة: ميعادها فات والمقبول لسه أقل من المطلوب. */
  const late = stages
    .filter((s) => s.due_date && daysBetween(s.due_date, todayISO()) > 0)
    .filter((s) => Number(s.accepted_qty) < Number(s.cut_quantity || 0))
    .map((s) => ({ ...s, lateDays: daysBetween(s.due_date, todayISO()) }))
    .sort((a, b) => b.lateDays - a.lateDays);

  const byOrder = new Map(orders.map((o) => [o.id, o]));

  app.innerHTML = `
    <h1>أهلاً ${esc(PROFILE?.display_name || '')}</h1>
    <p class="sub">النهارده ${dateAr(todayISO())}</p>

    <div class="grid g3" style="margin-bottom:16px">
      ${can('production.receive') ? `<a class="card qa-card" href="#foreman">
        <span class="qa-ico">${icon('package', 20)}</span>
        <div><b>تسليم واستلام</b><div class="hint">امسح كود الشنطة</div></div>
      </a>` : ''}
      ${can('production.order.create') ? `<a class="card qa-card" href="#order-new">
        <span class="qa-ico">${icon('scissors', 20)}</span>
        <div><b>أمر جديد</b><div class="hint">افتح أمر تشغيل</div></div>
      </a>` : ''}
      ${can('production.fabric.receive') ? `<a class="card qa-card" href="#warehouse">
        <span class="qa-ico">${icon('store', 20)}</span>
        <div><b>استلام قماش</b><div class="hint">سجّل أمتار العميل</div></div>
      </a>` : ''}
    </div>

    <div class="grid g4">
      <div class="kpi"><div class="lbl">أوامر مفتوحة</div>
        <div class="val">${num(open.length)}</div></div>
      <div class="kpi"><div class="lbl">قطع في الأوامر المفتوحة</div>
        <div class="val">${num(openPieces)}</div></div>
      <div class="kpi"><div class="lbl">مستحقات على العملاء</div>
        <div class="val">${amount(receivables)}</div></div>
      ${can('account.view') ? `<div class="kpi"><div class="lbl">رصيد الخزنة والبنوك</div>
        <div class="val">${amount(cash)}</div></div>` : ''}
      ${can('worker.financial.view') ? `<div class="kpi"><div class="lbl">مستحق للصنايعية</div>
        <div class="val">${amount(due)}</div></div>` : ''}
    </div>

    ${late.length ? `<h2>تنبيهات</h2>
      <div class="card" style="border-color:var(--warn)">
        <div style="font-weight:700;margin-bottom:8px;color:var(--warn)">
          مراحل متأخرة (${num(late.length)})</div>
        <div style="display:grid;gap:8px">
          ${late.slice(0, 8).map((s) => {
          const o = byOrder.get(s.order_id);
          return `<a class="late-row" href="#order/${esc(s.order_id)}">
              <b>${esc(o?.code || '')}</b> — ${esc(s.name_ar)}:
              <span class="num">${num(s.accepted_qty)}</span> من
              <span class="num">${num(s.cut_quantity)}</span> —
              متأخرة <span class="num">${num(s.lateDays)}</span> يوم
            </a>`;
        }).join('')}
        </div>
      </div>` : ''}

    <h2>تقدّم الأوامر المفتوحة</h2>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <a class="link" href="#orders">كل الأوامر</a>
    </div>
    ${open.length ? `<div class="grid g2">
      ${open.slice(0, 6).map((o) => {
      const pct = Number(o.quantity) ? Math.round(Number(o.cut_quantity) / Number(o.quantity) * 100) : 0;
      return `<a class="card order-card" href="#order/${esc(o.id)}">
          <div class="order-card-top">
            <b>${esc(o.code)}</b>
            <span class="hint">${esc(o.model_name || '')}</span>
          </div>
          <div class="hint" style="margin:2px 0 10px">${esc(o.customer_name)}</div>
          <div class="order-card-nums">
            <span><span class="num">${num(o.cut_quantity)}</span> / <span class="num">${num(o.quantity)}</span> اتقص</span>
            <span class="num">${pct}%</span>
          </div>
          <div class="bar" style="margin-top:6px"><i style="width:${pct}%"></i></div>
          ${o.due_date ? `<div class="hint" style="margin-top:8px">التسليم ${dateAr(o.due_date)}</div>` : ''}
        </a>`;
    }).join('')}
    </div>` : emptyState('box', 'مفيش أوامر مفتوحة', 'ابدأ بأمر جديد من الزرار فوق')}

    <h2>إنتاج كل صنايعي (من ${dateAr(since)})</h2>
    ${(() => {
      const rows = workers.filter((w) => w.kind === 'worker' && Number(w.accepted_total) > 0);
      if (!rows.length) return emptyState('worker', 'مفيش شغل اتسلّم الشهر ده', 'الاستلام من شاشة رئيس العمال');
      return tbl([
        { label: 'الصنايعي', render: (r) => `<a class="link" href="#worker/${r.id}">${esc(r.name)}</a>` },
        { label: 'مقبول', num: true, render: (r) => num(r.accepted_total) },
        { label: 'مرفوض', num: true, render: (r) => num(r.rejected_total) },
        { label: 'الأجر', num: true, render: (r) => amount(r.earned_total) },
      ], rows, 'مفيش شغل');
    })()}`;
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
  const tab = window.__foremanTab || 'available';

  app.innerHTML = `
    ${pageHead('رئيس العمال', 'اكتب كود الشنطة وسلّم أو استلم الشغل')}

    <div class="card">
      <label class="label" for="fCode">كود الشنطة</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input id="fCode" class="input mono" placeholder="BND0001" autocomplete="off"
               style="flex:1;min-width:180px;font-size:18px;letter-spacing:.08em">
        <button class="btn btn-primary" id="fFind">بحث</button>
        <button class="btn btn-ghost" id="fCam">${btnIcon('camera', 'مسح بالكاميرا')}</button>
        <button class="btn btn-ghost" id="fQuick">${btnIcon('check', 'استلام سريع')}</button>
      </div>
      <p class="hint" style="margin:8px 0 0">بيقرأ كود الشنطة (BND…) أو باركود القطعة (MM0001).</p>
      <div id="camBox" style="margin-top:12px"></div>
    </div>

    <div id="fResult"></div>

    <h2 style="display:flex;align-items:center;gap:10px">الشغل مع الصنايعية
      <button class="btn btn-ghost btn-sm" id="fRefresh">تحديث</button></h2>
    <div style="margin-bottom:12px">
      ${segFilter('foreman', [['available', 'المتاح للتسليم'], ['received', 'تم استلامه']], tab)}
    </div>
    <div id="fQueue"><div class="empty">بيحمّل…</div></div>`;

  $('#fFind').onclick = () => lookupBundle($('#fCode').value.trim());
  $('#fCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') lookupBundle(e.target.value.trim()); });
  $('#fCam').onclick = () => startScan();
  $('#fQuick').onclick = () => quickReceive();
  $('#fRefresh').onclick = () => loadQueue(tab);
  $('#fCode').focus();
  bindSeg('foreman', (v) => { window.__foremanTab = v; pageForeman(); });
  loadQueue(tab);
}

/* الطابور: «المتاح» = شنطة عند صنايعي ومستنية الاستلام،
   «تم استلامه» = خلصت مرحلة وبقت جاهزة تروح للمرحلة اللي بعدها. */
async function loadQueue(tab) {
  const box = $('#fQueue');
  if (!box) return;
  try {
    const rows = await view('bundle_queue');
    const picked = tab === 'received'
      ? rows.filter((r) => r.stage_done && !r.open_assignment)
      : rows.filter((r) => r.open_assignment && r.current_holder);
    box.innerHTML = tbl([
      { label: 'الشنطة', render: (r) => `<span class="mono">${esc(r.bundle_code)}</span>` },
      { label: 'الأمر', render: (r) => `<span class="mono hint">${esc(r.order_code)}</span>` },
      { label: 'المقاس', key: 'size' },
      { label: 'اللون', render: (r) => esc(colourAr(r.colour_label)) },
      { label: 'العدد', num: true, render: (r) => num(r.quantity) },
      { label: 'المرحلة', render: (r) => esc(stageAr(r.stage_code)) },
      { label: 'عند', render: (r) => esc(r.current_holder || '—') },
      { label: '', render: (r) => (tab === 'available'
        ? `<button class="btn btn-ghost btn-sm" data-rec="${esc(r.open_assignment)}">استلام</button>`
        : `<a class="btn btn-ghost btn-sm" href="#bundle/${esc(r.bundle_id)}">فتح</a>`) },
    ], picked, tab === 'available' ? 'مفيش شغل مع الصنايعية دلوقتي' : 'مفيش شغل اتستلم لسه');

    box.querySelectorAll('[data-rec]').forEach((b) => {
      b.onclick = () => receiveAssignment(b.dataset.rec);
    });
  } catch (e) { box.innerHTML = `<div class="err">${esc(humanError(e))}</div>`; }
}

async function receiveAssignment(assignmentId) {
  try {
    const picked = await formDialog('استلام الشغل', [
      { key: 'accepted', label: 'العدد المقبول', type: 'number', min: 0, required: true },
      { key: 'rejected', label: 'المرفوض', type: 'number', min: 0, value: '0' },
      { key: 'reason', label: 'سبب الرفض', hint: 'لو فيه مرفوض' },
    ]);
    if (!picked) return;
    await rpc('rpc_receive_work', {
      p_assignment: assignmentId,
      p_accepted: Number(picked.accepted || 0),
      p_rejected: Number(picked.rejected || 0),
      p_rework: 0,
      p_reason: picked.reason || null,
    });
    notify('اتسجل الاستلام');
    loadQueue(window.__foremanTab || 'available');
  } catch (e) { notifyErr(humanError(e)); }
}

/* استلام سريع: بنستلم كل الشغل المتاح بالعدد المطلوب من غير ما نفتح شنطة شنطة. */
async function quickReceive() {
  const box = $('#fQueue');
  if (!box) return;
  const rows = await view('bundle_queue');
  const ready = rows.filter((r) => r.open_assignment && r.current_holder);
  if (!ready.length) { notify('مفيش شغل متاح للاستلام'); return; }

  const mask = document.createElement('div');
  mask.className = 'mask';
  mask.innerHTML = `<form class="modal modal-wide">
    <h3>استلام سريع</h3>
    <p class="hint">كل شنطة هتتسجل بالعدد الكامل مقبول. عدّل اللي تحبه.</p>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>الشنطة</th><th>المرحلة</th><th>عند</th><th>العدد</th><th>مقبول</th><th>مرفوض</th></tr></thead>
      <tbody>${ready.map((r) => `<tr>
        <td><span class="mono">${esc(r.bundle_code)}</span></td>
        <td>${esc(stageAr(r.stage_code))}</td>
        <td>${esc(r.current_holder || '—')}</td>
        <td class="num">${num(r.quantity)}</td>
        <td><input class="input input-sm" type="number" min="0" value="${Number(r.quantity)}"
          data-acc="${esc(r.open_assignment)}"></td>
        <td><input class="input input-sm" type="number" min="0" value="0"
          data-rej="${esc(r.open_assignment)}"></td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="acts">
      <button type="submit" class="btn btn-primary">استلام الكل</button>
      <button type="button" class="btn btn-ghost" data-cancel>إلغاء</button>
    </div>
  </form>`;
  document.body.appendChild(mask);
  const form = mask.querySelector('form');
  const close = () => mask.remove();

  form.onsubmit = async (e) => {
    e.preventDefault();
    close();
    let ok = 0, failed = 0;
    for (const r of ready) {
      const accEl = form.querySelector(`[data-acc="${r.open_assignment}"]`);
      const rejEl = form.querySelector(`[data-rej="${r.open_assignment}"]`);
      const acc = accEl ? Number(accEl.value || 0) : Number(r.quantity);
      const rej = rejEl ? Number(rejEl.value || 0) : 0;
      if (!acc && !rej) continue;
      try {
        await rpc('rpc_receive_work', {
          p_assignment: r.open_assignment, p_accepted: acc, p_rejected: rej, p_rework: 0,
        });
        ok += 1;
      } catch (err) { failed += 1; }
    }
    notify(failed ? `اتسجل ${ok} — فشل ${failed}` : `اتسجل استلام ${ok} شنطة`);
    loadQueue(window.__foremanTab || 'available');
  };
  mask.querySelector('[data-cancel]').onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
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
    } catch (e) { notifyErr(humanError(e)); }
  };

  const selfBtn = $('#aSelf');
  if (selfBtn) selfBtn.onclick = async () => {
    try {
      await rpc('rpc_claim_bundle', { p_bundle: b.id, p_stage: $('#aStage').value });
      lookupBundle(b.code);
    } catch (e) { notifyErr(humanError(e)); }
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
    } catch (e) { notifyErr(humanError(e)); }
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

  app.innerHTML = `
    ${pageHead('أوامر التشغيل', '',
      `<a class="btn btn-ghost" href="#templates">${btnIcon('file', 'قوالب المراحل')}</a>
       <a class="btn btn-primary" href="#order-new">${btnIcon('plus', 'أمر جديد')}</a>`)}

    <div style="margin-bottom:14px">
      ${segFilter('order', [['open', 'مفتوح'], ['completed', 'مكتمل'],
        ['cancelled', 'ملغي'], ['all', 'الكل']], filter)}
    </div>

    ${tbl([
      { label: 'الكود', render: (r) => `<a class="link mono" href="#order/${r.id}">${esc(r.code)}</a>` },
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

  bindSeg('order', (v) => { window.__orderFilter = v; pageOrders(); });
}

async function pageOrderNew() {
  loading();
  const [customers, templates, m] = await Promise.all([
    view('customers'), table('stage_templates').catch(() => []), meta(),
  ]);
  const active = customers.filter((c) => c.is_active);
  /* لو القوالب مش مقروءة تحت الصلاحيات الحالية، بنكمل بالمراحل الافتراضية
     اللي meta() بيرجّعها، عشان إنشاء الأمر مايتعطّلش. */
  const tplList = templates.length ? templates : [{ id: '', name_ar: 'القالب الافتراضي', is_default: true }];
  let stageRows = [];

  app.innerHTML = `
    ${pageHead('إنشاء الأمر', '')}

    <h2>بيانات الأمر</h2>
    <div class="card">
      <div class="grid g2">
        <div><label class="label" for="oCustomer">العميل</label>
          <select id="oCustomer" class="input"><option value="">— اختار —</option>
            ${active.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
          </select></div>
        <div><label class="label" for="oTemplate">قالب المراحل</label>
          <select id="oTemplate" class="input">
            ${tplList.map((t) => `<option value="${esc(t.id)}"
              ${t.is_default ? 'selected' : ''}>${esc(t.name_ar || t.name)}</option>`).join('')}
          </select>
          <div class="hint"><a class="link" href="#templates">تعديل القوالب</a></div></div>
      </div>
      <div class="grid g2" style="margin-top:12px">
        <div><label class="label" for="oModel">الموديل</label>
          <input id="oModel" class="input" placeholder="جاكيت تومي"></div>
        <div><label class="label" for="oPrice">سعر التصنيع للقطعة</label>
          <input id="oPrice" class="input" type="number" min="0" step="0.01" value="0"></div>
      </div>
      <div class="grid g2" style="margin-top:12px">
        <div><label class="label" for="oQty">عدد القطع</label>
          <input id="oQty" class="input" type="number" min="1" value="0"></div>
        <div><label class="label" for="oDue">ميعاد التسليم</label>
          <input id="oDue" class="input" type="date"></div>
      </div>
      <p class="hint">الألوان والمقاسات بتتحدد عند القص</p>
      <div style="margin-top:12px"><label class="label" for="oNotes">ملاحظات</label>
        <input id="oNotes" class="input"></div>
    </div>

    <h2>مراحل التشغيل</h2>
    <div id="tplStages"><div class="empty">بيحمّل…</div></div>

    <div style="margin-top:16px;display:flex;gap:8px">
      <button class="btn btn-primary" id="oSave">إنشاء الأمر</button>
      <a class="btn btn-ghost" href="#orders">إلغاء</a>
    </div>`;

  /* المراحل بتتعرض كصفوف قابلة للتعديل: سعر وميعاد لكل مرحلة،
     زي المرجع بالظبط. القالب بيحدد المراحل والاعتماديات. */
  const loadStages = async () => {
    const tpl = $('#oTemplate').value;
    stageRows = tpl
      ? await table('stage_template_stages', { template_id: tpl })
      : (m.stages || []);
    stageRows = [...stageRows].sort((a, b) => Number(a.seq) - Number(b.seq));

    $('#tplStages').innerHTML = stageRows.length ? `<div class="card">
      <div class="stage-list">
        ${stageRows.map((s, i) => `<div class="stage-row">
          <div class="stage-num">${num(s.seq)}</div>
          <div class="stage-name"><b>${esc(s.name_ar)}</b>
            <div class="hint">${Array.isArray(s.depends_on) && s.depends_on.length
              ? 'بعد: ' + esc(depList(s.depends_on)) : 'من البداية'}</div></div>
          <div><label class="label">سعر القطعة</label>
            <input class="input input-sm" type="number" min="0" step="0.01"
              data-price="${i}" value="${Number(s.piece_price || 0)}"></div>
          <div><label class="label">الميعاد</label>
            <input class="input input-sm" type="date" data-due="${i}"
              value="${esc(s.due_date || '')}"></div>
        </div>`).join('')}
      </div>
    </div>` : '<div class="empty">مفيش مراحل في القالب ده</div>';
  };
  $('#oTemplate').onchange = loadStages;
  loadStages();

  $('#oSave').onclick = async () => {
    try {
      const cust = $('#oCustomer').value;
      if (!cust) { notifyErr('اختار العميل الأول'); return; }

      const r = await rpc('rpc_create_production_order', {
        p_customer: cust,
        p_model: $('#oModel').value.trim(),
        p_quantity: Number($('#oQty').value || 0),
        p_piece_price: Number($('#oPrice').value || 0),
        p_template: $('#oTemplate').value || null,
        p_due_date: $('#oDue').value || null,
        p_notes: $('#oNotes').value.trim() || null,
      });

      /* الأسعار والميعاد اللي المستخدم عدّلها بتروح للأمر بعد الإنشاء،
         لأن الإنشاء بينسخ القالب زي ما هو. */
      const edits = stageRows.map((s, i) => ({
        seq: s.seq, code: s.code,
        piece_price: Number($(`[data-price="${i}"]`).value || 0),
        due_date: $(`[data-due="${i}"]`).value || null,
      })).filter((e, i) => {
        const orig = stageRows[i];
        return e.piece_price !== Number(orig.piece_price || 0)
          || e.due_date !== (orig.due_date || null);
      });

      if (edits.length) {
        try {
          await rpc('rpc_update_order_stages', { p_order: r.id, p_stages: edits });
        } catch (err) { notifyErr(humanError(err)); }
      }
      go('#order/' + r.id);
    } catch (e) { notifyErr(humanError(e)); }
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
    if (!name) { notify('اكتب اسم القالب'); return; }
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
    if (!payload.length) { notify('ضيف مرحلة واحدة على الأقل بكود'); return; }
    try {
      await rpc('rpc_save_stage_template', {
        p_template: tpl?.id || null, p_name: name, p_stages: payload,
      });
      pageTemplates();
    } catch (e) { notifyErr(humanError(e)); }
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
        <td><button class="btn btn-ghost btn-sm" data-label="${esc(b.code)}">${btnIcon('tag', 'ليبل')}</button></td>
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

/* ------------------------------------------------------------------ تفاصيل الأمر
   خمس تبويبات زي المرجع: الإنتاج · الشنط · التسليم والمرتجعات · التكلفة · السجل.
   التبويب بيتحفظ في الهاش (#order/<id>/<tab>) عشان تحديث الصفحة يرجّعك لنفس المكان. */
const ORDER_TABS = [
  ['production', 'الإنتاج'],
  ['bundles', 'الشنط'],
  ['delivery', 'التسليم والمرتجعات'],
  ['costing', 'التكلفة'],
  ['log', 'السجل'],
];

/* مصفوفة اللون × المقاس. المرجع بيعرضها كجدول المقاسات في الأعمدة
   والألوان في الصفوف، وخانة الفارغة معناها مفيش قص للون ده بالمقاس ده. */
function sizeMatrix(rows, hasColour) {
  const sizes = [...new Set(rows.map((r) => r.size))].sort(sizeCmp);
  if (!sizes.length) return '<div class="empty">لسه ما اتعملش قص</div>';

  const colours = hasColour
    ? [...new Set(rows.map((r) => r.colour || ''))].sort((a, b) => a.localeCompare(b, 'ar'))
    : [''];
  const cell = new Map(rows.map((r) => [(r.colour || '') + '||' + r.size, Number(r.cut_qty)]));
  const total = rows.reduce((s, r) => s + Number(r.cut_qty), 0);

  const head = `<thead><tr><th>${hasColour ? 'اللون' : 'المقاس'}</th>
    ${sizes.map((s) => `<th class="num">${esc(s)}</th>`).join('')}
    <th class="num">الإجمالي</th></tr></thead>`;

  const body = colours.map((c) => {
    const vals = sizes.map((s) => cell.get(c + '||' + s) || 0);
    const rowTotal = vals.reduce((a, b) => a + b, 0);
    return `<tr>
      <td><b>${esc(hasColour ? colourAr(c) : (c || 'الكل'))}</b></td>
      ${vals.map((v) => `<td class="num">${v ? num(v) : '<span class="muted">—</span>'}</td>`).join('')}
      <td class="num"><b>${num(rowTotal)}</b></td>
    </tr>`;
  }).join('');

  return `<div class="tbl-wrap"><table>${head}<tbody>${body}
    <tr class="grp"><td colspan="${sizes.length + 2}">
      الإجمالي <b>${num(total)}</b> قطعة</td></tr>
    </tbody></table></div>`;
}

/* تفصيل التكلفة: 12 بند زي المرجع، وكل بند بيتحسب من الحركات الحقيقية. */
function costingRows(o, cost, extra) {
  const expectedRevenue = Number(o.quantity) * Number(o.piece_price);
  const actualRevenue = Number(cost.actual_revenue || 0);
  const wages = Number(cost.wages || 0);
  const materials = Number(extra.materials || 0);
  const shipping = Number(extra.shipping || 0);
  const direct = Number(extra.direct != null ? extra.direct : cost.direct_expenses || 0);
  const overhead = Number(extra.overhead || 0);
  const totalCost = wages + materials + shipping + direct + overhead;
  const delivered = Number(cost.delivered_qty || 0);
  const perPiece = delivered > 0 ? totalCost / delivered : null;

  return [
    ['الإيراد المتوقع', expectedRevenue, ''],
    ['الإيراد الفعلي', actualRevenue, 'المسلَّم ناقص المرتجع × سعر القطعة'],
    ['المفوتر', 0, 'مفيش فواتير لسه'],
    ['الأجور', wages, 'مجموع أجور المراحل المسلَّمة'],
    ['الخامات والمستلزمات', materials, 'المستلزمات المصروفة على الأمر'],
    ['الشحن', shipping, 'مصروفات تصنيفها شحن'],
    ['مصروفات مباشرة', direct, 'مصروفات مسجّلة على الأمر'],
    ['نصيب المصروفات العامة والمرتبات', overhead, 'بيتوزّع على القطع الجاهزة'],
    ['إجمالي التكلفة', totalCost, ''],
    ['تكلفة القطعة', perPiece, 'إجمالي التكلفة ÷ المسلَّم'],
    ['الربح المتوقع', expectedRevenue - totalCost, ''],
    ['الربح الفعلي', actualRevenue - totalCost, ''],
  ];
}

async function pageOrder(id, tab) {
  loading();
  const [orders, stages, bundles, costing, timeline, deliveries, returns, exps] =
    await Promise.all([
      view('orders'), view('order_stages', { order_id: id }), view('bundles', { order_id: id }),
      view('costing'), view('timeline', { order_id: id }), table('deliveries', { order_id: id }),
      table('customer_returns', { order_id: id }), table('expenses'),
    ]);
  const o = orders.find((x) => x.id === id);
  if (!o) { app.innerHTML = '<div class="err">الأمر مش موجود</div>'; return; }

  const st = stages.filter((s) => s.order_id === id);
  const tl = timeline.filter((t) => t.order_id === id);
  const cost = costing.find((c) => c.id === id || c.order_id === id) || {};
  const remaining = Number(o.quantity) - Number(o.cut_quantity);
  const active = ORDER_TABS.some(([k]) => k === tab) ? tab : 'production';

  const liveBundles = bundles.filter((b) => b.status !== 'cancelled');
  const readyQty = Number(o.ready_quantity || 0);

  /* مصفوفة القص بتتبني من الشنط: كل شنطة بتعرف لونها ومقاسها وكميتها،
     ومجموعها هو اللي اتقص فعلًا. */
  const cutRows = liveBundles.map((b) => ({
    colour: b.colour || '', size: b.size || '', cut_qty: Number(b.quantity || 0),
  }));
  const hasColour = cutRows.some((r) => r.colour);

  /* المصروفات: اللي متسجل على الأمر نفسه مصروفات مباشرة، والشحن تصنيفه «شحن».
     اللي مش متسجل على أمر هو عمومي، وبيتوزّع بنسبة قطع الأمر من إجمالي الجاهز. */
  const ownExps = exps.filter((e) => e.production_order_id === id && !e.reverses_id);
  const directExps = ownExps.filter((e) => e.category !== 'شحن')
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  const shipping = ownExps.filter((e) => e.category === 'شحن')
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  const allOverhead = exps.filter((e) => !e.production_order_id && !e.reverses_id)
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalReady = orders.reduce((s, x) => s + Number(x.ready_quantity || 0), 0);
  const overhead = totalReady > 0 ? allOverhead * readyQty / totalReady : 0;

  app.innerHTML = `
    <div class="phead">
      <div>
        <h1>أمر ${esc(o.code)}</h1>
        <p class="sub" style="margin:4px 0 0">${esc(o.customer_name)} · ${esc(o.model_name)}</p>
      </div>
      <div class="phead-acts">
        <a class="btn btn-ghost" href="#orders">رجوع</a>
        ${o.status === 'open' && can('production.order.edit')
      ? `<button class="btn btn-ghost" id="editBtn">تعديل الأمر</button>` : ''}
        ${o.status === 'open' && can('production.order.close')
      ? `<button class="btn btn-ghost" id="closeBtn">إقفال الأمر</button>` : ''}
        ${o.status === 'open' ? `<button class="btn btn-danger" id="cancelBtn">إلغاء الأمر</button>` : ''}
        <button class="btn btn-ghost" id="printOrder">${btnIcon('printer', 'طباعة')}</button>
      </div>
    </div>

    <div class="grid g4" style="margin:14px 0">
      <div class="kpi"><div class="lbl">الحالة</div>
        <div class="val" style="font-size:1rem">${chip(o.status)}</div></div>
      <div class="kpi"><div class="lbl">سعر التصنيع للقطعة</div>
        <div class="val" style="font-size:1.1rem">${amount(o.piece_price)}</div></div>
      <div class="kpi"><div class="lbl">تاريخ الأمر</div>
        <div class="val" style="font-size:1rem">${dateAr(o.order_date)}</div></div>
      <div class="kpi"><div class="lbl">ميعاد التسليم</div>
        <div class="val" style="font-size:1rem">${dateAr(o.due_date)}</div></div>
    </div>
    ${o.notes ? `<div class="card tight"><span class="hint">ملاحظات: </span>${esc(o.notes)}</div>` : ''}

    <div class="tabs" role="tablist">
      ${ORDER_TABS.map(([k, label]) => `<a role="tab" class="tab${k === active ? ' on' : ''}"
        aria-selected="${k === active}" href="#order/${esc(id)}/${k}">${esc(label)}${
      k === 'bundles' && liveBundles.length ? ` (${num(liveBundles.length)})` : ''}</a>`).join('')}
    </div>

    <div id="tabBody">
      ${active === 'production' ? `
        <h2>الكميات</h2>
        <p class="hint" style="margin:-6px 0 10px">اتقص ${num(o.cut_quantity)} من ${num(o.quantity)}</p>
        ${sizeMatrix(cutRows, hasColour)}

        <h2>مسار التشغيل</h2>
        ${tbl([
      { label: 'المرحلة', render: (r) => `<b>${esc(r.name_ar)}</b>
            ${Number(r.accepted_qty) < Number(r.cut_quantity) && r.due_date
          && daysBetween(r.due_date, todayISO()) > 0
          ? `<div class="chip chip-bad" style="margin-top:4px">متأخر</div>` : ''}` },
      { label: 'المقبول / المقصوص', num: true,
        render: (r) => `<span class="num">${num(r.accepted_qty)}</span> / <span class="num">${num(r.cut_quantity)}</span>` },
      { label: 'المرفوض', num: true, render: (r) => num(r.rejected_qty) },
      { label: 'تحت التشغيل', num: true, render: (r) => num(r.in_flight_qty) },
      { label: 'التقدم', render: (r) => {
        const cut = Number(r.cut_quantity);
        const pct = cut ? Math.round(Number(r.accepted_qty) / cut * 100) : 0;
        return `<div style="display:flex;align-items:center;gap:8px">
              <div class="bar" style="width:64px"><i style="width:${pct}%"></i></div>
              <span class="num">${pct}%</span></div>`;
      } },
      { label: 'الميعاد', render: (r) => dateAr(r.due_date) },
      { label: '', render: (r) => stageAction(r) },
    ], st.filter((s) => s.deps_done || Number(s.accepted_qty) > 0
      || Number(s.in_flight_qty) > 0), 'مفيش مراحل')}

        ${remaining > 0 && o.status === 'open' ? `
          <h2>قص وعمل شنط</h2>
          <div class="card">
            <p class="hint" style="margin:0 0 10px">الباقي من الأمر <b>${num(remaining)}</b> قطعة</p>
            <button class="btn btn-primary" id="cutBtn">قص وعمل شنط</button>
          </div>` : ''}

        <h2>الشنط والأكواد</h2>
        ${bundlesTable(liveBundles, o)}
      ` : ''}

      ${active === 'bundles' ? `
        <h2>الشنط والأكواد</h2>
        ${bundlesTable(liveBundles, o)}
      ` : ''}

      ${active === 'delivery' ? `
        <h2>البضاعة التامة والتسليم</h2>
        <p class="hint" style="margin:-6px 0 10px">
          جاهز ${num(readyQty)} · اتسلّم ${num(o.delivered_quantity)} ·
          متاح ${num(Math.max(0, readyQty - Number(o.delivered_quantity)))}
        </p>
        ${sizeMatrix(cutRows, hasColour)}

        <h2>أذونات التسليم</h2>
        ${tbl([
        { label: 'الكود', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { label: 'التاريخ', render: (r) => dateAr(r.delivered_on) },
        { label: 'ملاحظات', render: (r) => esc(r.notes || '—') },
        { label: '', render: (r) => `<button class="btn btn-ghost btn-sm" data-doc="${esc(r.id)}">${btnIcon('printer', 'إذن')}</button>` },
      ], deliveries, 'لسه مفيش تسليم')}

        <h2>مرتجع العميل</h2>
        ${tbl([
        { label: 'الكود', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { label: 'التاريخ', render: (r) => dateAr(r.returned_on) },
        { label: 'اللون', render: (r) => esc(colourAr(r.colour)) },
        { label: 'المقاس', render: (r) => esc(r.size || '—') },
        { label: 'الكمية', num: true, render: (r) => num(r.quantity) },
        { label: 'السبب', render: (r) => esc(r.reason || '—') },
        { label: 'التصرف', render: (r) => esc(returnDispAr(r.disposition)) },
      ], returns, 'مفيش مرتجعات')}

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
          ${readyQty > 0 ? '<button class="btn btn-primary" id="deliverBtn">إنشاء إذن تسليم</button>' : ''}
          ${Number(o.delivered_quantity) > 0
        ? `<button class="btn btn-ghost" id="returnBtn">${btnIcon('return', 'مرتجع من العميل')}</button>` : ''}
        </div>
      ` : ''}

      ${active === 'costing' ? `
        <h2>التكلفة والربحية</h2>
        <p class="hint" style="margin:-6px 0 10px">
          ${o.status === 'open' ? 'مبدئي' : 'نهائي'} · المطلوب ${num(o.quantity)} ·
          جاهز ${num(readyQty)} · اتسلّم ${num(o.delivered_quantity)} · مرتجع ${num(cost.returned_qty)}
        </p>
        ${tbl([
        { label: '', render: (r) => `<b>${esc(r[0])}</b>` },
        { label: '', num: true, render: (r) => (r[1] == null ? '—' : amount(r[1])) },
        { label: '', render: (r) => `<span class="hint">${esc(r[2])}</span>` },
      ], costingRows(o, cost, { materials: 0, shipping, overhead, direct: directExps }), 'مفيش بيانات تكلفة')}
        <p class="hint" style="margin-top:10px">
          الأرقام مبدئية لحد ما الأمر يتقفل. نصيب المصروفات العامة بيتوزّع على القطع الجاهزة.
        </p>
      ` : ''}

      ${active === 'log' ? `
        <h2>التايم لاين</h2>
        ${tbl([
        { label: 'الوقت', render: (r) => esc(String(r.at).replace('T', ' ').slice(0, 16)) },
        { label: 'الحدث', key: 'description', wrap: true },
        { label: 'بواسطة', render: (r) => esc(r.actor || '—') },
      ], tl, 'مفيش أحداث')}
      ` : ''}
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
    const v = await formDialog('إلغاء أمر التشغيل', [
      { key: 'why', label: 'سبب الإلغاء', required: true,
        hint: 'السبب بيتسجل في سجل التعديلات — اكتب حاجة تفرّق بيها الأمر بعدين' },
    ]);
    if (!v || !v.why) return;
    try { await rpc('rpc_cancel_production_order', { p_id: o.id, p_reason: v.why }); pageOrder(id); }
    catch (e) { notifyErr(humanError(e)); }
  };

  const closeBtn = $('#closeBtn');
  if (closeBtn) closeBtn.onclick = () => withBusy(closeBtn, 'بيقفل…', async () => {
    try {
      await rpc('rpc_close_production_order', { p_id: o.id });
      notify('الأمر اتقفل');
      pageOrder(id, 'costing');
    } catch (e) { notifyErr(humanError(e)); }
  });

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
    if (!qty || qty <= 0) { notify('اكتب كمية صحيحة'); return; }
    const p = pairs[Number($('#rtPair').value)];
    try {
      await rpc('rpc_create_customer_return', {
        p_order: order.id, p_colour: p.colour || null, p_size: p.size || null,
        p_quantity: qty, p_reason: $('#rtReason').value.trim() || null,
        p_disposition: $('#rtDisp').value,
      });
      pageOrder(order.id);
    } catch (e) { notifyErr(humanError(e)); }
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
    } catch (e) { notifyErr(humanError(e)); }
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
    } catch (e) { notifyErr(humanError(e)); }
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
    if (!sizes.length) { notify('اكتب المقاسات'); return; }
    Object.keys(qty).forEach((k) => { if (!sizes.includes(k.split('||')[1])) delete qty[k]; });
    fill();
  };
  $('#cApplyColours').onclick = () => {
    colours = parseList($('#cColours').value);
    if (!colours.length) { notify('اكتب الألوان'); return; }
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
    if (!lines.length) { notify('اكتب الكميات في الجدول'); return; }
    try {
      const r = await rpc('rpc_execute_cutting', {
        p_order: order.id, p_lines: lines,
        p_bundle_size: Number($('#cBundle').value || 40),
        p_has_colour: mode === 'colour',
      });
      notify(`اتعمل ${r.bundles} شنطة و ${r.operational_codes} كود تشغيل`);
      pageOrder(order.id);
    } catch (e) { notifyErr(humanError(e)); }
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
    if (!lines.length) { notify('اكتب كمية واحدة على الأقل'); return; }
    try {
      const r = await rpc('rpc_create_delivery', {
        p_order: order.id, p_lines: lines, p_notes: $('#dNotes').value.trim() || null,
      });
      const d = await table('deliveries', { order_id: order.id });
      const doc = d.find((x) => x.code === r.code) || d[0];
      const dlines = doc ? await table('delivery_lines', { delivery_id: doc.id }) : [];
      notify('اتعمل الإذن ' + (r.code || ''));
      if (doc) printDeliveryDoc({ ...order }, doc, dlines);
      pageOrder(order.id);
    } catch (e) { notifyErr(humanError(e)); }
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
  const [fabric, customers, moves] = await Promise.all([
    view('fabric'), view('customers'), table('customer_fabric_movements'),
  ]);
  const custFilter = window.__whCust || '';
  const shown = custFilter ? fabric.filter((f) => f.customer_id === custFilter) : fabric;
  const sortedMoves = [...moves].sort((a, b) =>
    String(b.txn_date || b.created_at).localeCompare(String(a.txn_date || a.created_at)));
  const shownMoves = custFilter
    ? sortedMoves.filter((m) => m.customer_id === custFilter) : sortedMoves;

  app.innerHTML = `
    ${pageHead('المخزن', 'قماش العملاء',
      `<button class="btn btn-primary" id="whReceive">${btnIcon('plus', 'استلام قماش')}</button>
       <button class="btn btn-ghost" id="whReturn">${btnIcon('return', 'مرتجع للعميل')}</button>`)}

    <div class="card" style="padding:12px;margin-bottom:14px">
      <label class="label" for="whCustFilter">العميل</label>
      <select id="whCustFilter" class="input">
        <option value="">كل العملاء</option>
        ${customers.map((c) => `<option value="${esc(c.id)}"
          ${c.id === custFilter ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
    </div>

    <h2>الأرصدة</h2>
    ${tbl([
      { label: 'العميل', key: 'customer_name' },
      { label: 'اللون', key: 'colour' },
      { label: 'الرصيد', num: true, render: (r) =>
        `<b style="color:${Number(r.balance) < 0 ? 'var(--bad)' : 'inherit'}">${num(r.balance)}م</b>` },
    ], shown, 'مفيش قماش في المخزن')}

    <h2>آخر الحركات</h2>
    ${tbl([
      { label: 'التاريخ', render: (r) => dateAr(r.txn_date || r.created_at) },
      { label: 'الحركة', render: (r) => esc(moveAr(r.movement || r.kind)) },
      { label: 'العميل', render: (r) =>
        esc(r.customer_name || customers.find((c) => c.id === r.customer_id)?.name || '—') },
      { label: 'اللون', key: 'colour' },
      { label: 'الكمية', num: true, render: (r) => `${num(Math.abs(r.quantity))}م` },
      { label: 'ملاحظات', render: (r) => esc(r.notes || '—') },
    ], shownMoves.slice(0, 40), 'مفيش حركات')}`;

  $('#whCustFilter').onchange = (e) => {
    window.__whCust = e.target.value;
    pageWarehouse();
  };

  $('#whReceive').onclick = () => fabricDialog('receive', customers, fabric, () => {
    window.__whCust = '';
    pageWarehouse();
  });
  $('#whReturn').onclick = () => fabricDialog('return', customers, fabric, () => {
    window.__whCust = '';
    pageWarehouse();
  });
}

/* استلام ومرتجع القماش بيشاركوا نفس الحوار؛ الفرق في الدالة اللي بتتنادى. */
function fabricDialog(kind, customers, fabric, done) {
  const isReturn = kind === 'return';
  const mask = document.createElement('div');
  mask.className = 'mask';
  mask.innerHTML = `<form class="modal">
    <h3>${isReturn ? 'مرتجع قماش للعميل' : 'استلام قماش'}</h3>
    <div class="field">
      <label class="label" for="fbCust">العميل</label>
      <select class="input" id="fbCust">
        ${customers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label class="label" for="fbColour">اللون</label>
      <input class="input" id="fbColour" list="fbColours" autocomplete="off">
      <datalist id="fbColours">
        ${[...new Set(fabric.map((f) => f.colour))].map((c) =>
          `<option value="${esc(c)}"></option>`).join('')}
      </datalist>
    </div>
    <div class="field">
      <label class="label" for="fbQty">عدد الأمتار</label>
      <input class="input" id="fbQty" type="number" min="0.01" step="0.01" required>
    </div>
    <div class="field">
      <label class="label" for="fbNotes">ملاحظات</label>
      <input class="input" id="fbNotes">
    </div>
    <div class="acts">
      <button type="submit" class="btn btn-primary">${isReturn ? 'ترجيع' : 'استلام'}</button>
      <button type="button" class="btn btn-ghost" data-cancel>إلغاء</button>
    </div>
  </form>`;
  document.body.appendChild(mask);

  const form = mask.querySelector('form');
  const close = () => mask.remove();
  const colourInput = mask.querySelector('#fbColour');
  const custSelect = mask.querySelector('#fbCust');

  /* في المرتجع بنورّي رصيد العميل للون المختار عشان مايحاولش يرجّع أكتر منه. */
  const showBalance = () => {
    const hint = mask.querySelector('#fbBal');
    if (!isReturn) { if (hint) hint.remove(); return; }
    const row = fabric.find((f) => f.customer_id === custSelect.value
      && f.colour === colourInput.value.trim());
    let el = hint;
    if (!el) {
      el = document.createElement('div');
      el.id = 'fbBal';
      el.className = 'hint';
      colourInput.parentElement.appendChild(el);
    }
    el.textContent = row ? `الرصيد المتاح ${num(row.balance)} متر` : 'مفيش رصيد للون ده';
  };
  if (isReturn) { custSelect.onchange = showBalance; colourInput.oninput = showBalance; }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      p_customer: custSelect.value,
      p_colour: colourInput.value.trim(),
      p_quantity: Number(mask.querySelector('#fbQty').value || 0),
      p_notes: mask.querySelector('#fbNotes').value.trim() || null,
    };
    try {
      await rpc(isReturn ? 'rpc_return_fabric' : 'rpc_receive_fabric', payload);
      close();
      done();
    } catch (err) { notifyErr(humanError(err)); }
  };
  mask.querySelector('[data-cancel]').onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
  mask.onkeydown = (e) => { if (e.key === 'Escape') close(); };
  colourInput.focus();
}

/* ============================================================================
   العملاء + فاتورة PDF
   ========================================================================== */
async function pageCustomers() {
  loading();
  const [customers, fabric] = await Promise.all([view('customers'), view('fabric')]);
  const q = (window.__custQ || '').trim();
  const filtered = q
    ? customers.filter((c) => `${c.name} ${c.code} ${c.phone || ''}`.includes(q))
    : customers;

  app.innerHTML = `
    ${pageHead('العملاء', `${num(customers.length)} عميل`,
      `<button class="btn btn-primary" id="newCust">${btnIcon('plus', 'عميل جديد')}</button>`)}

    <div class="card" style="padding:12px;margin-bottom:14px">
      <label class="label" for="custSearch">بحث</label>
      <input class="input" id="custSearch" type="search" placeholder="بالاسم أو الكود أو التليفون"
             value="${esc(q)}" autocomplete="off">
    </div>

    ${tbl([
      { label: 'الكود', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
      { label: 'حرف التشغيل', render: (r) => `<span class="chip chip-open mono">${esc(r.operating_letter)}</span>` },
      { label: 'الاسم', render: (r) => `<a class="link" href="#customer/${r.id}">${esc(r.name)}</a>` },
      { label: 'التليفون', render: (r) => `<span dir="ltr">${esc(r.phone || '—')}</span>` },
      { label: 'أوامر', num: true, render: (r) => num(r.order_count) },
      { label: 'مفتوحة', num: true, render: (r) => num(r.open_order_count) },
      { label: 'الحالة', render: (r) => r.is_active
        ? '<span class="chip chip-done">نشط</span>' : '<span class="chip chip-bad">موقوف</span>' },
    ], filtered, q ? 'مفيش عميل بالاسم ده' : 'مفيش عملاء لسه')}

    <h2>قماش العملاء</h2>
    ${tbl([
      { label: 'العميل', key: 'customer_name' },
      { label: 'اللون', key: 'colour' },
      { label: 'الرصيد', num: true, render: (r) => num(r.balance) + ' متر' },
    ], fabric, 'مفيش قماش')}`;

  const search = $('#custSearch');
  search.oninput = () => {
    window.__custQ = search.value;
    const caret = search.value;
    pageCustomers().then(() => {
      const el = $('#custSearch');
      if (el) { el.focus(); el.setSelectionRange(caret.length, caret.length); }
    });
  };

  $('#newCust').onclick = async () => {
    const v = await formDialog('عميل جديد', [
      { key: 'name', label: 'اسم العميل' },
      { key: 'phone', label: 'التليفون (اختياري)', type: 'tel' },
    ]);
    if (!v || !v.name) return;
    try { await rpc('rpc_create_customer', { p_name: v.name, p_phone: v.phone || null }); pageCustomers(); }
    catch (e) { notifyErr(humanError(e)); }
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
    <a class="link" href="#customers">${icon('chevron', 14)} العملاء</a>
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
        <button class="btn btn-ghost" id="editCust">${btnIcon('pencil', 'تعديل')}</button>
        <button class="btn btn-primary" id="invBtn">${btnIcon('printer', 'فاتورة PDF')}</button>
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
      if (!name) { notify('اكتب اسم العميل'); return; }
      try {
        await rpc('rpc_update_customer', {
          p_id: c.id, p_name: name,
          p_phone: $('#cePhone').value.trim() || null,
          p_notes: $('#ceNotes').value.trim() || null,
          p_is_active: $('#ceActive').value === 'true',
        });
        pageCustomer(id);
      } catch (e) { notifyErr(humanError(e)); }
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
/* تسجيل مرتبات الشهر: كل الصنايعية اللي ليهم مستحقات في جدول واحد،
   والمبلغ الافتراضي هو المستحق. اللي يتصفّر ما بيتصرفش له. */
function openPayroll(workers) {
  const due = workers.filter((w) => Number(w.remaining_due) > 0);
  if (!due.length) { notify('مفيش مستحقات على حد الشهر ده'); return; }

  const total = due.reduce((s, w) => s + Number(w.remaining_due), 0);
  const mask = document.createElement('div');
  mask.className = 'mask';
  mask.innerHTML = `<form class="modal modal-wide">
    <h3>تسجيل مرتبات الشهر</h3>
    <p class="hint">المبلغ الافتراضي هو المستحق بالكامل. عدّل اللي تحبه، وسيبه صفر لو مش هتصرفه دلوقتي.</p>
    <div class="tbl-wrap">
      <table class="tbl">
        <thead><tr><th>الكود</th><th>الاسم</th><th>الوظيفة</th><th>المستحق</th><th>المبلغ</th></tr></thead>
        <tbody>
          ${due.map((w) => `<tr>
            <td><span class="mono">${esc(w.code)}</span></td>
            <td>${esc(w.name)}</td>
            <td>${esc(w.job_title || '—')}</td>
            <td class="num">${amount(w.remaining_due)}</td>
            <td><input class="input input-sm" type="number" min="0" step="0.01"
              name="pay-${esc(w.id)}" value="${Number(w.remaining_due)}" data-due="${Number(w.remaining_due)}"></td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td colspan="3"><b>الإجمالي</b></td>
          <td class="num"><b>${amount(total)}</b></td>
          <td class="num"><b id="paySum">${amount(total)}</b></td>
        </tr></tfoot>
      </table>
    </div>
    <div class="acts">
      <button type="submit" class="btn btn-primary">صرف المبالغ</button>
      <button type="button" class="btn btn-ghost" data-cancel>إلغاء</button>
    </div>
  </form>`;
  document.body.appendChild(mask);

  const form = mask.querySelector('form');
  const close = () => mask.remove();

  form.querySelectorAll('input[type=number]').forEach((inp) => {
    inp.oninput = () => {
      let sum = 0;
      form.querySelectorAll('input[type=number]').forEach((i) => {
        const v = Math.min(Number(i.value) || 0, Number(i.dataset.due));
        sum += Math.max(0, v);
      });
      mask.querySelector('#paySum').innerHTML = amount(sum);
    };
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const cash = (META.accounts || [])[0];
    if (!cash) { notifyErr('مفيش خزنة معرّفة'); return; }

    const rows = [];
    form.querySelectorAll('input[type=number]').forEach((inp) => {
      const w = due.find((x) => inp.name === `pay-${x.id}`);
      const amt = Math.min(Number(inp.value) || 0, Number(inp.dataset.due));
      if (w && amt > 0) rows.push({ w, amt });
    });
    if (!rows.length) { notify('مفيش مبالغ محددة'); return; }

    close();
    let ok = 0, failed = 0;
    for (const { w, amt } of rows) {
      try {
        await rpc('rpc_post_cash', {
          p_account: cash.id, p_amount: -Math.abs(amt),
          p_category: 'worker_payment', p_description: 'مرتب شهر — ' + w.name,
          p_employee: w.id,
        });
        ok += 1;
      } catch (err) { failed += 1; }
    }
    notify(failed ? `اتصرف ${ok} — فشل ${failed}` : `اتصرف مرتب ${ok} صنايعي`);
    pageWorkers();
  };

  mask.querySelector('[data-cancel]').onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
  mask.onkeydown = (e) => { if (e.key === 'Escape') close(); };
}

async function pageWorkers() {
  loading();
  const workers = await view('workers');
  app.innerHTML = `
    ${pageHead('الصنايعية والحسابات', '',
      `<button class="btn btn-ghost" id="payrollBtn">${btnIcon('wallet', 'تسجيل مرتبات الشهر')}</button>
       <button class="btn btn-primary" id="newEmp">${btnIcon('plus', 'إضافة موظف جديد')}</button>`)}
    <div>
      ${tbl([
        { label: 'الكود', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { label: 'الاسم', render: (r) => `<a class="link" href="#worker/${r.id}">${esc(r.name)}</a>` },
        { label: 'الوظيفة', render: (r) => esc(r.job_title || '—') },
        { label: 'التليفون', render: (r) => `<span class="mono">${esc(r.phone || '—')}</span>` },
        { label: 'الحالة', render: (r) => (r.is_active ? '<span class="chip chip-done">شغال</span>'
      : '<span class="chip">موقوف</span>') },
        { label: 'المتبقي له', num: true,
          render: (r) => `<b>${amount(r.remaining_due)}</b>` },
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
      } catch (e) { notifyErr(humanError(e)); }
    };
  });

  $('#newEmp').onclick = async () => {
    const v = await formDialog('إضافة موظف جديد', [
      { key: 'name', label: 'اسم الصنايعي', value: '' },
      { key: 'job', label: 'الوظيفة (خياط، قصاص…)', value: '' },
      { key: 'phone', label: 'التليفون', value: '' },
    ]);
    if (!v || !v.name) return;
    try {
      await rpc('rpc_create_employee', {
        p_name: v.name, p_kind: 'worker', p_job_title: v.job || null, p_phone: v.phone || null,
      });
      pageWorkers();
    } catch (e) { notifyErr(humanError(e)); }
  };

  const payrollBtn = $('#payrollBtn');
  if (payrollBtn) payrollBtn.onclick = () => openPayroll(workers);

  app.querySelectorAll('[data-pay]').forEach((btn) => {
    btn.onclick = async () => {
      const due = Number(btn.dataset.due);
      if (due <= 0) { notify('مفيش مستحقات'); return; }
      const v = await formDialog(`صرف أجر — ${btn.dataset.name}`, [
        { key: 'amt', label: 'المبلغ (ج.م)', type: 'number', value: String(due),
          min: '0.01', step: '0.01', required: true,
          hint: `المستحق ${money(due)} — تقدر تصرف أقل، والمتبقي بيفضل على الحساب` },
      ]);
      if (!v) return;
      const amt = Number(v.amt);
      if (!Number.isFinite(amt) || amt <= 0) { notify('اكتب مبلغ أكبر من صفر'); return; }
      try {
        const cash = (META.accounts || [])[0];
        await rpc('rpc_post_cash', {
          p_account: cash.id, p_amount: -Math.abs(amt),
          p_category: 'worker_payment', p_description: 'صرف أجر ' + btn.dataset.name,
          p_employee: btn.dataset.pay,
        });
        pageWorkers();
      } catch (e) { notifyErr(humanError(e)); }
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
    <a class="link" href="#workers">${icon('chevron', 14)} الصنايعية</a>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-top:8px">
      <div>
        <h1 style="margin:0">${esc(w.name)}</h1>
        <p class="sub" style="margin:4px 0 0">
          <span class="mono">${esc(w.code)}</span>${w.job_title ? ' · ' + esc(w.job_title) : ''}
          ${w.phone ? ' · <span dir="ltr">' + esc(w.phone) + '</span>' : ''}
        </p>
      </div>
      <button class="btn btn-primary" id="pdfBtn">${btnIcon('printer', 'كشف حساب PDF')}</button>
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
        notify('كلمة السر لازم ٨ حروف على الأقل'); return;
      }
      try {
        await OB.adminCreateUser({
          username: v.username, password: v.password,
          display_name: w.name, employee_id: w.id, roles: ['worker'],
        });
        pageWorker(id);
      } catch (e) { notifyErr(humanError(e)); }
    };
  }

  $('#prStage').innerHTML = (META.stages || []).map((s) =>
    `<option value="${esc(s.code)}">${esc(s.name_ar)}</option>`).join('');
  $('#prGo').onclick = async () => {
    const stage = $('#prStage').value;
    const rate = Number($('#prRate').value || 0);
    if (!stage) { notify('اختار المرحلة'); return; }
    if (rate < 0) { notify('السعر مش ممكن يكون سالب'); return; }
    try {
      await rpc('rpc_set_piece_rate', { p_employee: id, p_stage: stage, p_rate: rate });
      pageWorker(id);
    } catch (e) { notifyErr(humanError(e)); }
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
    ${pageHead('الخزنة والبنوك', 'الأرصدة والحركات')}
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
    } catch (e) { notifyErr(humanError(e)); }
  };

  app.querySelectorAll('[data-rev]').forEach((b) => {
    b.onclick = async () => {
      const v = await formDialog('عكس الحركة', [
        { key: 'why', label: 'سبب العكس', required: true,
          hint: 'العكس مش بيمسح الحركة الأصلية — بيسجل حركة معاكسة، والسبب بيفضل موثّق' },
      ]);
      if (!v || !v.why) return;
      try { await rpc('rpc_reverse_cash', { p_id: b.dataset.rev, p_reason: v.why }); pageAccounts(); }
      catch (e) { notifyErr(humanError(e)); }
    };
  });

  $('#aGo').onclick = async () => {
    const name = $('#aName').value.trim();
    if (!name) { notify('اكتب اسم الحساب'); return; }
    try {
      await rpc('rpc_create_account', {
        p_name: name, p_kind: $('#aKind').value,
        p_opening: Number($('#aOpen').value || 0),
      });
      pageAccounts();
    } catch (e) { notifyErr(humanError(e)); }
  };
}

/* ============================================================================
   المصروفات
   ========================================================================== */
async function pageExpenses() {
  loading();
  const [expenses, orders] = await Promise.all([table('expenses'), view('orders')]);
  const f = window.__expFilter || { from: '', to: '', cat: '', order: '' };

  /* بنود المصروفات بتتجمّع من البيانات نفسها بدل ما تكون قائمة ثابتة،
     عشان أي بند جديد يتسجل يظهر في الفلتر على طول. */
  const used = expenses.map((e) => e.category).filter(Boolean);
  const cats = [...new Set([...EXPENSE_CATS, ...used])];

  const inRange = (d) => {
    const day = String(d || '').slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    return true;
  };
  const rows = expenses.filter((e) => inRange(e.expense_date)
    && (!f.cat || e.category === f.cat)
    && (!f.order || e.order_id === f.order));
  const total = rows.reduce((s, e) => s + Number(e.amount || 0), 0);

  app.innerHTML = `
    ${pageHead('المصروفات', 'مصروفات المصنع التشغيلية')}

    <div class="toolbar">
      <button class="btn btn-primary" id="xNew">مصروف جديد</button>
      <div class="filters">
        <div><label class="label" for="xfFrom">من</label>
          <input id="xfFrom" class="input input-sm" type="date" value="${esc(f.from)}"></div>
        <div><label class="label" for="xfTo">لحد</label>
          <input id="xfTo" class="input input-sm" type="date" value="${esc(f.to)}"></div>
        <div><label class="label" for="xfCat">البند</label>
          <select id="xfCat" class="input input-sm">
            <option value="">كل البنود</option>
            ${cats.map((c) => `<option value="${esc(c)}" ${f.cat === c ? 'selected' : ''}>${esc(txnCategoryAr(c))}</option>`).join('')}
          </select></div>
        <div><label class="label" for="xfOrder">أمر الإنتاج</label>
          <select id="xfOrder" class="input input-sm">
            <option value="">كل الأوامر</option>
            ${orders.map((o) => `<option value="${esc(o.id)}" ${f.order === o.id ? 'selected' : ''}>${esc(o.code)} — ${esc(o.customer_name)}${o.model_name ? ' — ' + esc(o.model_name) : ''}</option>`).join('')}
          </select></div>
      </div>
    </div>

    <div class="kpi" style="max-width:280px">
      <div class="lbl">إجمالي المصروفات</div>
      <div class="val">${money(total)}</div>
    </div>

    <h2>المصروفات</h2>
    ${tbl([
      { label: 'التاريخ', render: (r) => dateAr(r.expense_date) },
      { label: 'البند', render: (r) => esc(txnCategoryAr(r.category)) },
      { label: 'الوصف', key: 'description', wrap: true },
      { label: 'الأمر', render: (r) => {
        const o = orders.find((x) => x.id === r.order_id);
        return o ? `<a class="link mono" href="#order/${esc(o.id)}">${esc(o.code)}</a>` : '<span class="hint">—</span>';
      } },
      { label: 'المبلغ', num: true, render: (r) => money(r.amount) },
    ], rows, 'مفيش مصروفات في الفترة دي')}

    <h2>بنود المصروفات</h2>
    <div class="chips">${cats.length
      ? cats.map((c) => {
        const n = expenses.filter((e) => e.category === c).length;
        return `<span class="chip">${esc(c)} ${num(n)}</span>`;
      }).join('')
      : '<span class="hint">مفيش بنود لسه</span>'}</div>`;

  const applyFilter = () => {
    window.__expFilter = {
      from: $('#xfFrom').value, to: $('#xfTo').value,
      cat: $('#xfCat').value, order: $('#xfOrder').value,
    };
    pageExpenses();
  };
  ['#xfFrom', '#xfTo', '#xfCat', '#xfOrder'].forEach((sel) => {
    $(sel).onchange = applyFilter;
  });

  $('#xNew').onclick = async () => {
    const picked = await formDialog('مصروف جديد', [
      { key: 'category', label: 'البند', required: true, value: f.cat || '',
        options: cats.map((c) => ({ value: c, label: c })) },
      { key: 'amount', label: 'المبلغ', type: 'number', min: 0, step: '0.01', required: true },
      { key: 'account', label: 'من حساب',
        options: (META.accounts || []).map((a) => ({ value: a.id, label: a.name })) },
      { key: 'description', label: 'الوصف' },
      { key: 'order', label: 'على أمر (اختياري)',
        options: [{ value: '', label: '— بدون —' },
          ...orders.map((o) => ({ value: o.id, label: `${o.code} · ${o.model_name || ''}` }))] },
    ]);
    if (!picked) return;
    try {
      await rpc('rpc_create_expense', {
        p_account: picked.account,
        p_category: picked.category.trim() || 'عام',
        p_description: picked.description || '',
        p_amount: Number(picked.amount || 0),
        p_order: picked.order || null,
      });
      notify('اتسجل المصروف');
      pageExpenses();
    } catch (e) { notifyErr(humanError(e)); }
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

  const factoryStock = stock.filter((r) => r.ownership !== 'customer' && Number(r.quantity) !== 0);
  const customerStock = stock.filter((r) => r.ownership === 'customer' && Number(r.quantity) !== 0);
  const purchases = moves.filter((m) => m.movement === 'purchase').slice(0, 20);
  const itemName = (id) => items.find((i) => i.id === id)?.name || '—';

  app.innerHTML = `
    ${pageHead('المستلزمات',
      'خيط وزراير وسوست وتغليف وقطع غيار — بتاعة المصنع واللي جاية من العملاء')}

    <div class="toolbar">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="sBuy">شراء مستلزمات</button>
        <button class="btn btn-ghost" id="sRecv">استلام من عميل</button>
        <button class="btn btn-ghost" id="sIssue">صرف مستلزمات</button>
      </div>
      <a class="btn btn-ghost btn-sm" href="#supplies-admin">إدارة الأصناف والمخازن</a>
    </div>

    <h2>الرصيد</h2>
    ${tbl([
      { label: 'الصنف', render: (r) => esc(r.item_name) },
      { label: 'المخزن', render: (r) => esc(r.warehouse_name) },
      { label: 'الرصيد', num: true, render: (r) => `${num(r.quantity)} ${esc(r.base_unit || '')}` },
    ], factoryStock, 'مفيش مستلزمات لسه')}

    <h2>مستلزمات العملاء</h2>
    <p class="hint">بتتصرف على أوامر العميل نفسه بس، ومن غير تكلفة</p>
    ${tbl([
      { label: 'العميل', render: (r) => esc(r.customer_name || '—') },
      { label: 'الصنف', render: (r) => `${esc(r.item_name)} <span class="hint mono">${esc(r.item_code || '')}</span>` },
      { label: 'الرصيد', num: true, render: (r) => `${num(r.quantity)}${esc(r.base_unit || '')}` },
    ], customerStock, 'مفيش مستلزمات عملاء')}

    <h2>آخر المشتريات</h2>
    ${tbl([
      { label: 'التاريخ', render: (r) => dateAr(r.txn_date) },
      { label: 'الصنف', render: (r) => esc(itemName(r.item_id)) },
      { label: 'الكمية', num: true, render: (r) => num(r.quantity) },
      { label: 'ملاحظات', render: (r) => esc(r.notes || '—') },
    ], purchases, 'مفيش مشتريات لسه')}`;

  const opts = (rows, label, blank) => (blank ? `<option value="">${esc(blank)}</option>` : '')
    + rows.map((r) => `<option value="${esc(r.id)}">${esc(label(r))}</option>`).join('');

  $('#sBuy').onclick = async () => {
    const accounts = await view('accounts');
    const v = await formDialog('شراء مستلزمات', [
      { key: 'item', label: 'الصنف', options: items.map((i) => ({ value: i.id, label: i.name })) },
      { key: 'warehouse', label: 'المخزن', options: warehouses.map((w) => ({ value: w.id, label: w.name })) },
      { key: 'quantity', label: 'الكمية', type: 'number', min: 0, step: '0.001', required: true },
      { key: 'unit_cost', label: 'سعر الوحدة', type: 'number', min: 0, step: '0.01', value: '0' },
      { key: 'account', label: 'الخزنة', options: accounts.map((a) => ({ value: a.id, label: a.name })) },
      { key: 'notes', label: 'ملاحظات' },
    ]);
    if (!v) return;
    try {
      await rpc('rpc_purchase_supplies', {
        p_item: v.item, p_warehouse: v.warehouse,
        p_quantity: Number(v.quantity || 0),
        p_unit_cost: Number(v.unit_cost || 0), p_account: v.account,
        p_notes: v.notes || null,
      });
      notify('اتسجلت المشترى');
      pageSupplies();
    } catch (e) { notifyErr(humanError(e)); }
  };

  $('#sRecv').onclick = async () => {
    const v = await formDialog('استلام مستلزمات من عميل', [
      { key: 'customer', label: 'العميل', required: true,
        options: customers.map((c) => ({ value: c.id, label: c.name })) },
      { key: 'item', label: 'الصنف', options: items.map((i) => ({ value: i.id, label: i.name })) },
      { key: 'warehouse', label: 'المخزن', options: warehouses.map((w) => ({ value: w.id, label: w.name })) },
      { key: 'quantity', label: 'الكمية', type: 'number', min: 0, step: '0.001', required: true },
      { key: 'notes', label: 'ملاحظات' },
    ]);
    if (!v) return;
    try {
      await rpc('rpc_receive_customer_supplies', {
        p_customer: v.customer, p_item: v.item, p_warehouse: v.warehouse,
        p_quantity: Number(v.quantity || 0), p_notes: v.notes || null,
      });
      notify('اتسجل الاستلام');
      pageSupplies();
    } catch (e) { notifyErr(humanError(e)); }
  };

  $('#sIssue').onclick = async () => {
    const orders = await view('orders');
    const v = await formDialog('صرف مستلزمات', [
      { key: 'item', label: 'الصنف', options: items.map((i) => ({ value: i.id, label: i.name })) },
      { key: 'warehouse', label: 'المخزن', options: warehouses.map((w) => ({ value: w.id, label: w.name })) },
      { key: 'quantity', label: 'الكمية', type: 'number', min: 0, step: '0.001', required: true },
      { key: 'ownership', label: 'الملكية', options: [
        { value: 'factory', label: 'مستلزمات المصنع' },
        { value: 'customer', label: 'مستلزمات عميل' },
      ] },
      { key: 'customer', label: 'العميل', options: [{ value: '', label: '—' },
        ...customers.map((c) => ({ value: c.id, label: c.name }))] },
      { key: 'order', label: 'الأمر (اختياري)', options: [{ value: '', label: '—' },
        ...orders.map((o) => ({ value: o.id, label: `${o.code} · ${o.model_name || ''}` }))] },
      { key: 'notes', label: 'ملاحظات' },
    ]);
    if (!v) return;
    try {
      await rpc('rpc_issue_supplies', {
        p_item: v.item, p_warehouse: v.warehouse,
        p_quantity: Number(v.quantity || 0),
        p_ownership: v.ownership,
        p_customer: v.customer || null,
        p_order: v.order || null,
        p_notes: v.notes || null,
      });
      notify('اتسجل الصرف');
      pageSupplies();
    } catch (e) { notifyErr(humanError(e)); }
  };
}

/* إدارة الأصناف والمخازن والتحويلات — منفصلة عن شاشة الحركة اليومية. */
async function pageSuppliesAdmin() {
  loading();
  const [items, warehouses, moves, accounts] = await Promise.all([
    table('items'), table('warehouses'), table('inventory_transactions'), view('accounts'),
  ]);
  const itemName = (id) => items.find((i) => i.id === id)?.name || '—';
  const whName = (id) => warehouses.find((w) => w.id === id)?.name || '—';

  app.innerHTML = `
    ${pageHead('إدارة المستلزمات', 'الأصناف والمخازن والتحويلات')}

    <h2>صنف جديد</h2>
    <div class="card tight">
      <div class="grid g4">
        <div><label class="label" for="iName">الاسم</label>
          <input id="iName" class="input" placeholder="خيط أبيض"></div>
        <div><label class="label" for="iCat">التصنيف</label>
          <select id="iCat" class="input">${Object.entries(ITEM_CATEGORIES).map(([k, v]) =>
            `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
        <div><label class="label" for="iUnit">الوحدة</label>
          <input id="iUnit" class="input" value="قطعة"></div>
        <div style="display:flex;align-items:flex-end">
          <button class="btn btn-primary" id="iGo" style="width:100%">إضافة</button></div>
      </div>
    </div>

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

    <h2>مخزن جديد</h2>
    <div class="card tight">
      <div class="grid g3">
        <div><label class="label" for="whName">اسم المخزن</label>
          <input id="whName" class="input" placeholder="مخزن التغليف"></div>
        <div><label class="label" for="whKind">النوع</label>
          <select id="whKind" class="input">
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

    <h2>المخازن</h2>
    ${tbl([
      { label: 'الكود', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
      { label: 'الاسم', key: 'name' },
      { label: 'النوع', render: (r) => esc(warehouseKindAr(r.kind)) },
      { label: '', render: (r) => `<button class="btn btn-sm btn-ghost" data-wh="${esc(r.id)}">تعديل</button>` },
    ], warehouses, 'مفيش مخازن')}

    <h2>تحويل بين المخازن</h2>
    <div class="card tight">
      <div class="grid g4">
        <div><label class="label" for="trItem">الصنف</label><select id="trItem" class="input"></select></div>
        <div><label class="label" for="trFrom">من مخزن</label><select id="trFrom" class="input"></select></div>
        <div><label class="label" for="trTo">إلى مخزن</label><select id="trTo" class="input"></select></div>
        <div><label class="label" for="trQty">الكمية</label>
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
    if (!name) { notify('اكتب اسم الصنف'); return; }
    try {
      await rpc('rpc_create_item', {
        p_name: name, p_category: $('#iCat').value,
        p_unit: $('#iUnit').value.trim() || 'قطعة',
      });
      pageSuppliesAdmin();
    } catch (e) { notifyErr(humanError(e)); }
  };

  $('#whGo').onclick = async () => {
    const name = $('#whName').value.trim();
    if (!name) { notify('اكتب اسم المخزن'); return; }
    try {
      await rpc('rpc_create_warehouse', { p_name: name, p_kind: $('#whKind').value });
      pageSuppliesAdmin();
    } catch (e) { notifyErr(humanError(e)); }
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
          p_id: it.id, p_name: v.name,
          p_category: v.category || null, p_unit: v.unit || null,
        });
        pageSuppliesAdmin();
      } catch (e) { notifyErr(humanError(e)); }
    };
  });

  app.querySelectorAll('[data-wh]').forEach((b) => {
    b.onclick = async () => {
      const w = warehouses.find((x) => x.id === b.dataset.wh);
      const v = await formDialog('تعديل المخزن', [{ key: 'name', label: 'اسم المخزن', value: w.name }]);
      if (!v) return;
      try {
        await rpc('rpc_update_warehouse', { p_id: w.id, p_name: v.name });
        pageSuppliesAdmin();
      } catch (e) { notifyErr(humanError(e)); }
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
    if (!qty || qty <= 0) { notify('اكتب كمية صحيحة'); return; }
    if (from === to) { notify('اختار مخزنين مختلفين'); return; }
    try {
      /* التحويل قيدين متقابلين عشان دفتر المخزن يفضل متوازن. */
      await rpc('rpc_move_stock', {
        p_item: $('#trItem').value, p_warehouse: from,
        p_quantity: -Math.abs(qty), p_movement: 'transfer_out',
      });
      await rpc('rpc_move_stock', {
        p_item: $('#trItem').value, p_warehouse: to,
        p_quantity: Math.abs(qty), p_movement: 'transfer_in',
      });
      pageSuppliesAdmin();
    } catch (e) { notifyErr(humanError(e)); }
  };
}

/* ============================================================================
   الماكينات
   ========================================================================== */
async function pageMachines() {
  loading();
  const [machines, maint] = await Promise.all([table('machines'), table('machine_maintenance')]);
  app.innerHTML = `
    ${pageHead('الماكينات', 'الماكينات والصيانة')}

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
    if (!desc) { notify('اكتب وصف الصيانة'); return; }
    if (!$('#mtMachine').value) { notify('ضيف ماكينة الأول'); return; }
    try {
      await rpc('rpc_log_maintenance', {
        p_machine: $('#mtMachine').value, p_description: desc,
        p_cost: Number($('#mtCost').value || 0), p_date: $('#mtDate').value || null,
      });
      pageMachines();
    } catch (e) { notifyErr(humanError(e)); }
  };

  $('#mGo').onclick = async () => {
    const name = $('#mName').value.trim();
    if (!name) { notify('اكتب اسم الماكينة'); return; }
    try {
      await rpc('rpc_create_machine', {
        p_name: name, p_model: $('#mModel').value.trim() || null,
        p_purchased_on: $('#mDate').value || null });
      pageMachines();
    } catch (e) { notifyErr(humanError(e)); }
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
      } catch (e) { notifyErr(humanError(e)); }
    };
  });
}

/* ============================================================================
   لوحة المدير
   ========================================================================== */
/* لوحة المدير: نفس بنية المرجع — فترات، 5 مؤشرات، رسم يومي، مراحل وأسباب
   الرفض، أسبوعي خلص/اتسلّم، والأوامر اللي اتقفلت في الفترة. */
const ANALYTICS_PERIODS = [
  ['this_month', 'الشهر ده'],
  ['last30', 'آخر 30 يوم'],
  ['last90', 'آخر 3 شهور'],
  ['custom', 'فترة مخصوصة'],
];

function analyticsRange(key, from, to) {
  if (key === 'custom' && from && to) return [from, to];
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const back = (n) => { const x = new Date(today); x.setDate(x.getDate() - n); return iso(x); };
  if (key === 'last30') return [back(29), iso(today)];
  if (key === 'last90') return [back(89), iso(today)];
  return [iso(new Date(today.getFullYear(), today.getMonth(), 1)), iso(today)];
}

/* شريط أفقي بسيط بدل مكتبة رسوم: المرجع بيرسم أعمدة يومية،
   وده نفس الشكل من غير أي اعتماد خارجي. */
function barChart(days, height) {
  const max = Math.max(1, ...days.map((d) => d.accepted + d.rejected));
  return `<div class="chart" style="height:${height || 130}px">
    ${days.map((d) => {
      const total = d.accepted + d.rejected;
      const h = Math.round(total / max * 100);
      return `<div class="chart-col" title="${esc(d.label)}: مقبول ${d.accepted}، مرفوض ${d.rejected}">
        <div class="chart-bar" style="height:${h}%">
          ${d.rejected ? `<i class="rej" style="height:${Math.round(d.rejected / Math.max(1, total) * 100)}%"></i>` : ''}
        </div>
        <span class="chart-lbl">${esc(d.tick || '')}</span>
      </div>`;
    }).join('')}
  </div>`;
}

async function pageAnalytics() {
  loading();
  const period = window.__anPeriod || 'this_month';
  const [defFrom, defTo] = analyticsRange(period);
  const from = window.__anFrom || defFrom;
  const to = window.__anTo || defTo;

  const [assigns, orders, costing, deliveries, deliveryLines, bundles] = await Promise.all([
    table('work_assignments'), view('orders'), view('costing'),
    table('deliveries'), table('delivery_lines'), view('bundles'),
  ]);

  const inPeriod = assigns.filter((a) => a.received_at && inRange(a.received_at, from, to));
  const acc = inPeriod.reduce((s, a) => s + Number(a.accepted_qty || 0), 0);
  const rej = inPeriod.reduce((s, a) => s + Number(a.rejected_qty || 0), 0);
  const reworkTotal = inPeriod.reduce((s, a) => s + Number(a.rework_qty || 0), 0);
  const rejPct = acc + rej > 0 ? (rej / (acc + rej) * 100) : 0;

  /* «خلص» = شنط اتسلّمت من الإنتاج في الفترة. «اتسلّم» = بنود أذون التسليم. */
  const ready = bundles
    .filter((b) => b.status === 'finished' || b.status === 'delivered')
    .filter((b) => inRange(b.updated_at || b.cut_date, from, to))
    .reduce((s, b) => s + Number(b.quantity || 0), 0);

  const deliveryByDay = {};
  deliveries.filter((d) => inRange(d.delivered_on, from, to)).forEach((d) => {
    const qty = deliveryLines.filter((l) => l.delivery_id === d.id)
      .reduce((s, l) => s + Number(l.quantity || 0), 0);
    const day = String(d.delivered_on).slice(0, 10);
    deliveryByDay[day] = (deliveryByDay[day] || 0) + qty;
  });
  const delivered = Object.values(deliveryByDay).reduce((s, q) => s + q, 0);

  const closed = orders.filter((o) => o.status === 'completed'
    && inRange(o.closed_at || o.order_date, from, to));
  const closedProfit = closed.reduce((s, o) => {
    const c = costing.find((x) => (x.order_id || x.id) === o.id);
    if (!c) return s;
    return s + (Number(c.actual_revenue || 0) - Number(c.total_cost || 0));
  }, 0);

  /* الرسم اليومي: بنملأ كل يوم في الفترة حتى الأيام اللي مافيهاش شغل تبان فاضية. */
  const byDay = {};
  inPeriod.forEach((a) => {
    const d = String(a.received_at).slice(0, 10);
    byDay[d] = byDay[d] || { accepted: 0, rejected: 0 };
    byDay[d].accepted += Number(a.accepted_qty || 0);
    byDay[d].rejected += Number(a.rejected_qty || 0);
  });
  const dayList = [];
  const cursor = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  let guard = 0;
  while (cursor <= end && guard < 400) {
    const key = cursor.toISOString().slice(0, 10);
    const row = byDay[key] || { accepted: 0, rejected: 0 };
    dayList.push({ label: dateAr(key), tick: key.slice(8, 10) + '/' + key.slice(5, 7), ...row });
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  const activeDays = dayList.filter((d) => d.accepted + d.rejected > 0);
  const best = dayList.reduce((b, d) => (d.accepted > (b ? b.accepted : -1) ? d : b), null);

  /* المراحل الأكتر رفضاً — نسبة الرفض من إجمالي اللي دخل المرحلة. */
  const stageAgg = {};
  inPeriod.filter((a) => Number(a.rejected_qty) > 0).forEach((a) => {
    stageAgg[a.stage_code] = stageAgg[a.stage_code] || { code: a.stage_code, rej: 0, tot: 0 };
    stageAgg[a.stage_code].rej += Number(a.rejected_qty || 0);
  });
  inPeriod.forEach((a) => {
    if (!stageAgg[a.stage_code]) return;
    stageAgg[a.stage_code].tot += Number(a.accepted_qty || 0) + Number(a.rejected_qty || 0);
  });
  const stageList = Object.values(stageAgg)
    .map((s) => ({ name: stageAr(s.code), rej: s.rej,
      pct: s.tot ? (s.rej / s.tot * 100) : 0 }))
    .sort((a, b) => b.rej - a.rej);

  const reasonAgg = {};
  inPeriod.filter((a) => Number(a.rejected_qty) > 0).forEach((a) => {
    const r = (a.reject_reason || '').trim() || 'من غير سبب مسجّل';
    reasonAgg[r] = (reasonAgg[r] || 0) + Number(a.rejected_qty);
  });
  const reasonList = Object.entries(reasonAgg)
    .map(([reason, qty]) => ({ reason, qty }))
    .sort((a, b) => b.qty - a.qty);

  /* أسابيع الفترة، كل أسبوع بيبدأ السبت. */
  const weeks = [];
  const wCursor = new Date(from + 'T00:00:00');
  const wEnd = new Date(to + 'T00:00:00');
  let wGuard = 0;
  while (wCursor <= wEnd && wGuard < 60) {
    const start = new Date(wCursor);
    const stop = new Date(wCursor);
    stop.setDate(stop.getDate() + (6 - ((start.getDay() + 1) % 7)));
    if (stop > wEnd) stop.setTime(wEnd.getTime());
    const s = start.toISOString().slice(0, 10);
    const e = stop.toISOString().slice(0, 10);
    const dayCount = Math.round((stop - start) / 86400000) + 1;
    const wReady = bundles
      .filter((b) => b.status === 'finished' || b.status === 'delivered')
      .filter((b) => inRange(b.updated_at || b.cut_date, s, e))
      .reduce((sum, b) => sum + Number(b.quantity || 0), 0);
    const wDelivered = Object.entries(deliveryByDay)
      .filter(([day]) => day >= s && day <= e)
      .reduce((sum, [, q]) => sum + q, 0);
    weeks.push({ s, e, ready: wReady, delivered: wDelivered, days: dayCount });
    wCursor.setDate(wCursor.getDate() + dayCount);
    wGuard += 1;
  }

  app.innerHTML = `
    ${pageHead('لوحة المدير', '')}
    <p class="hint" style="margin-top:-6px">من ${dateAr(from)} لحد ${dateAr(to)}</p>

    <div class="card" style="padding:12px;margin-bottom:14px">
      <div class="grid g3">
        <div><label class="label" for="anPeriod">الفترة</label>
          <select class="input" id="anPeriod">${ANALYTICS_PERIODS.map(([k, l]) =>
            `<option value="${k}"${k === period ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div><label class="label" for="anFrom">من</label>
          <input class="input" id="anFrom" type="date" value="${esc(from)}"></div>
        <div><label class="label" for="anTo">إلى</label>
          <input class="input" id="anTo" type="date" value="${esc(to)}"></div>
      </div>
    </div>

    <div class="grid g3">
      <div class="kpi"><div class="lbl">مقبول</div><div class="val">${num(acc)}</div></div>
      <div class="kpi"><div class="lbl">نسبة المرفوض</div><div class="val">${rejPct.toFixed(1)}%</div></div>
      <div class="kpi"><div class="lbl">خلص</div><div class="val">${num(ready)}</div></div>
      <div class="kpi"><div class="lbl">اتسلّم</div><div class="val">${num(delivered)}</div></div>
      <div class="kpi"><div class="lbl">ربح الأوامر المقفولة</div>
        <div class="val" style="font-size:1.2rem">${money(closedProfit)}</div></div>
    </div>

    <h2>الإنتاج اليومي</h2>
    <div class="card">
      <div class="legend"><span><i class="dot ok"></i>مقبول</span><span><i class="dot bad"></i>مرفوض</span></div>
      ${barChart(dayList)}
      <p class="hint" style="margin-bottom:0">${activeDays.length
        ? `${num(activeDays.length)} يوم فيهم استلام من ${num(dayList.length)}. مقبول ${num(acc)}، مرفوض ${num(rej)} (${rejPct.toFixed(1)}%)، إعادة ${num(reworkTotal)}. أعلى يوم ${esc(best.label)}: ${num(best.accepted)} مقبول.`
        : 'مفيش استلام في الفترة دي'}</p>
      ${dayList.length ? `<p class="hint">أعلى يوم = ${num(best ? best.accepted : 0)} قطعة</p>` : ''}
    </div>

    <h2>المراحل الأكتر رفضاً</h2>
    ${stageList.length ? tbl([
      { label: 'المرحلة', key: 'name' },
      { label: 'المرفوض', num: true, render: (r) => num(r.rej) },
      { label: 'النسبة', num: true, render: (r) => `${r.pct.toFixed(1)}%` },
    ], stageList) : '<div class="card"><b>مفيش مرحلة فيها مرفوض</b><p class="hint" style="margin-bottom:0">مفيش مرفوض في الفترة دي</p></div>'}

    <h2>أسباب الرفض</h2>
    ${reasonList.length ? tbl([
      { label: 'السبب', render: (r) => esc(r.reason), wrap: true },
      { label: 'العدد', num: true, render: (r) => num(r.qty) },
    ], reasonList) : '<div class="card"><b>مفيش مرفوض</b><p class="hint" style="margin-bottom:0">مفيش مرفوض في الفترة دي</p></div>'}

    <h2>خلص واتسلّم كل أسبوع</h2>
    <div class="card">
      <div class="legend"><span><i class="dot ok"></i>خلص</span><span><i class="dot brand"></i>اتسلّم</span></div>
      <p class="hint" style="margin-top:0">خلص ${num(ready)} قطعة واتسلّم ${num(delivered)} على ${num(weeks.length)} أسبوع.</p>
      <div class="wk-list">
        ${weeks.map((w) => `<div class="wk">
          <div class="wk-head"><b>${num(w.ready)}</b> / <b>${num(w.delivered)}</b></div>
          <div class="wk-lbl">${dateAr(w.s)}–${dateAr(w.e)}</div>
        </div>`).join('')}
      </div>
    </div>

    <h2>الأوامر اللي خلصت في الفترة</h2>
    <p class="hint" style="margin-top:-4px">الإيراد = المسلَّم ناقص المرتجع × سعر القطعة. التكلفة = الأجور + الخامات + الشحن + المصروفات المباشرة + نصيبه من المصروفات العامة.</p>
    ${tbl([
      { label: 'الأمر', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
      { label: 'العميل', key: 'customer_name' },
      { label: 'الكمية', num: true, render: (r) => num(r.quantity) },
      { label: 'الإيراد', num: true, render: (r) => {
        const c = costing.find((x) => (x.order_id || x.id) === r.id) || {};
        return money(c.actual_revenue);
      } },
      { label: 'التكلفة', num: true, render: (r) => {
        const c = costing.find((x) => (x.order_id || x.id) === r.id) || {};
        return money(c.total_cost);
      } },
      { label: 'الربح', num: true, render: (r) => {
        const c = costing.find((x) => (x.order_id || x.id) === r.id) || {};
        const p = Number(c.actual_revenue || 0) - Number(c.total_cost || 0);
        return `<b style="color:${p >= 0 ? 'var(--good)' : 'var(--bad)'}">${money(p)}</b>`;
      } },
    ], closed, 'مفيش أمر اتقفل في الفترة دي')}`;

  $('#anPeriod').onchange = (e) => {
    window.__anPeriod = e.target.value;
    window.__anFrom = null;
    window.__anTo = null;
    pageAnalytics();
  };
  $('#anFrom').onchange = (e) => { window.__anFrom = e.target.value; pageAnalytics(); };
  $('#anTo').onchange = (e) => { window.__anTo = e.target.value; pageAnalytics(); };
}

/* ============================================================================
   التقارير
   ========================================================================== */
const REPORTS = [
  ['worker', 'إنتاج الصنايعية'],
  ['stage', 'الإنتاج حسب المرحلة'],
  ['stage_reject', 'العيوب حسب المرحلة'],
  ['worker_reject', 'العيوب حسب الصنايعي'],
  ['fabric', 'استهلاك القماش'],
  ['orders', 'أوامر التشغيل'],
  ['cost', 'التكلفة والربحية'],
  ['customer_collect', 'تحصيلات العملاء'],
  ['customer', 'أرصدة العملاء'],
  ['expenses', 'المصروفات'],
  ['cash_in', 'القبض'],
  ['cash', 'حركة الخزنة والبنوك'],
];

/* الفترات الجاهزة. الأسبوع بيبدأ السبت، زي ما المصنع بيشتغل هنا. */
const PERIODS = [
  ['today', 'النهارده'],
  ['yesterday', 'مبارح'],
  ['this_week', 'الأسبوع ده'],
  ['last_week', 'الأسبوع اللي فات'],
  ['this_month', 'الشهر ده'],
  ['last_month', 'الشهر اللي فات'],
  ['this_year', 'السنة دي'],
];

function periodRange(key) {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const shift = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  if (key === 'today') return [iso(today), iso(today)];
  if (key === 'yesterday') { const y = shift(today, -1); return [iso(y), iso(y)]; }
  if (key === 'this_week') {
    const start = shift(today, -((today.getDay() + 1) % 7));
    return [iso(start), iso(today)];
  }
  if (key === 'last_week') {
    const start = shift(today, -((today.getDay() + 1) % 7) - 7);
    return [iso(start), iso(shift(start, 6))];
  }
  if (key === 'this_month') {
    return [iso(new Date(today.getFullYear(), today.getMonth(), 1)), iso(today)];
  }
  if (key === 'last_month') {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const last = new Date(today.getFullYear(), today.getMonth(), 0);
    return [iso(first), iso(last)];
  }
  return [iso(new Date(today.getFullYear(), 0, 1)), iso(today)];
}

const inRange = (d, from, to) => {
  if (!d) return false;
  const day = String(d).slice(0, 10);
  return day >= from && day <= to;
};

async function pageReports() {
  loading();
  const period = window.__repPeriod || 'this_month';
  const [defFrom, defTo] = periodRange(period);
  const from = window.__repFrom || defFrom;
  const to = window.__repTo || defTo;
  const sel = window.__report || 'worker';

  app.innerHTML = `
    ${pageHead('التقارير', '',
      `<button class="btn btn-ghost" id="repXls">${btnIcon('file', 'تصدير Excel')}</button>
       <button class="btn btn-ghost" id="repPrint">${btnIcon('printer', 'طباعة')}</button>`)}

    <div class="card" style="padding:12px;margin-bottom:14px">
      <div class="hint" style="margin-bottom:8px">اختار التقرير</div>
      <div class="chips" style="margin-bottom:12px">${REPORTS.map(([k, l]) =>
        `<button class="chip ${k === sel ? 'chip-done' : 'chip-open'}" data-rep="${k}">${esc(l)}</button>`).join('')}</div>
      <div class="grid g3">
        <div><label class="label" for="repSel">التقرير</label>
          <select class="input" id="repSel">${REPORTS.map(([k, l]) =>
            `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div><label class="label" for="repPeriod">الفترة</label>
          <div class="chips" style="margin-bottom:6px">${PERIODS.map(([k, l]) =>
            `<button class="chip ${k === period ? 'chip-done' : 'chip-open'}" data-per="${k}">${esc(l)}</button>`).join('')}</div>
          <select class="input" id="repPeriod">${PERIODS.map(([k, l]) =>
            `<option value="${k}"${k === period ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><label class="label" for="repFrom">من</label>
            <input class="input" id="repFrom" type="date" value="${esc(from)}"></div>
          <div><label class="label" for="repTo">إلى</label>
            <input class="input" id="repTo" type="date" value="${esc(to)}"></div>
        </div>
      </div>
    </div>

    <div id="rBody"><div class="empty">بيحمّل…</div></div>`;

  $('#repSel').onchange = (e) => { window.__report = e.target.value; pageReports(); };
  document.querySelectorAll('[data-rep]').forEach((b) => {
    b.onclick = () => { window.__report = b.dataset.rep; pageReports(); };
  });
  document.querySelectorAll('[data-per]').forEach((b) => {
    b.onclick = () => {
      window.__repPeriod = b.dataset.per;
      window.__repFrom = null;
      window.__repTo = null;
      pageReports();
    };
  });
  $('#repPeriod').onchange = (e) => {
    window.__repPeriod = e.target.value;
    window.__repFrom = null;
    window.__repTo = null;
    pageReports();
  };
  $('#repFrom').onchange = (e) => { window.__repFrom = e.target.value; pageReports(); };
  $('#repTo').onchange = (e) => { window.__repTo = e.target.value; pageReports(); };
  $('#repPrint').onclick = () => window.print();
  $('#repXls').onclick = () => exportTableCsv();

  renderReport(sel, from, to);
}

/* التصدير بياخد الجدول المعروض زي ما هو، فمهما كان التقرير المختار بيطلع صح. */
function exportTableCsv() {
  const table = document.querySelector('#rBody table');
  if (!table) { notify('مفيش جدول للتصدير'); return; }

  const lines = [...table.querySelectorAll('tr')].map((tr) =>
    [...tr.querySelectorAll('th,td')].map((cell) => {
      const t = cell.innerText.replace(/\s+/g, ' ').trim().replace(/"/g, '""');
      return `"${t}"`;
    }).join(','));
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `تقرير-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function renderReport(key, from, to) {
  const body = $('#rBody');
  if (!body) return;
  body.innerHTML = '<div class="empty">بيحمّل…</div>';
  const title = (REPORTS.find(([k]) => k === key) || [, key])[1];
  const head = `<h2>${esc(title)}</h2>
    <p class="hint">من ${dateAr(from)} لحد ${dateAr(to)}</p>`;

  try {
    if (key === 'worker') {
      const [workers, assigns] = await Promise.all([view('workers'), table('work_assignments')]);
      const agg = {};
      assigns.filter((a) => a.received_at && inRange(a.received_at, from, to)).forEach((a) => {
        const w = workers.find((x) => x.id === a.employee_id);
        if (!w) return;
        agg[w.id] = agg[w.id] || { code: w.code, name: w.name, acc: 0, rej: 0, redo: 0, wage: 0 };
        agg[w.id].acc += Number(a.accepted_qty || 0);
        agg[w.id].rej += Number(a.rejected_qty || 0);
        agg[w.id].wage += Number(a.wage_amount || 0);
      });
      const rows = Object.values(agg);
      const tot = rows.reduce((s, r) => ({
        acc: s.acc + r.acc, rej: s.rej + r.rej, redo: s.redo + r.redo, wage: s.wage + r.wage,
      }), { acc: 0, rej: 0, redo: 0, wage: 0 });
      body.innerHTML = head + tbl([
        { label: 'الكود', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { label: 'الصنايعي', key: 'name' },
        { label: 'مقبول', num: true, render: (r) => num(r.acc) },
        { label: 'مرفوض', num: true, render: (r) => num(r.rej) },
        { label: 'إعادة', num: true, render: (r) => num(r.redo) },
        { label: 'الأجر', num: true, render: (r) => money(r.wage) },
      ], rows, 'مفيش إنتاج في الفترة دي', null, [
        ['الإجمالي', '', num(tot.acc), num(tot.rej), num(tot.redo), money(tot.wage)],
      ]);
    } else if (key === 'stage') {
      const rows = (await view('order_stages'))
        .filter((r) => inRange(r.due_date || r.created_at, from, to));
      const agg = {};
      rows.forEach((r) => {
        agg[r.stage_code] = agg[r.stage_code] || { code: r.stage_code, acc: 0, rej: 0, fly: 0 };
        agg[r.stage_code].acc += Number(r.accepted_qty || 0);
        agg[r.stage_code].rej += Number(r.rejected_qty || 0);
        agg[r.stage_code].fly += Number(r.in_flight_qty || 0);
      });
      const list = Object.values(agg).map((r) => ({ ...r, name: stageAr(r.code) }));
      body.innerHTML = head + tbl([
        { label: 'المرحلة', key: 'name' },
        { label: 'مقبول', num: true, render: (r) => num(r.acc) },
        { label: 'شغال', num: true, render: (r) => num(r.fly) },
        { label: 'مرفوض', num: true, render: (r) => num(r.rej) },
      ], list, 'مفيش بيانات في الفترة دي');
    } else if (key === 'stage_reject') {
      const rows = (await table('work_assignments'))
        .filter((a) => Number(a.rejected_qty) > 0 && inRange(a.received_at, from, to));
      const agg = {};
      rows.forEach((a) => {
        agg[a.stage_code] = agg[a.stage_code] || { code: a.stage_code, rej: 0 };
        agg[a.stage_code].rej += Number(a.rejected_qty);
      });
      const list = Object.values(agg).map((r) => ({ ...r, name: stageAr(r.code) }));
      body.innerHTML = head + tbl([
        { label: 'المرحلة', key: 'name' },
        { label: 'المرفوض', num: true, render: (r) => num(r.rej) },
      ], list, 'مفيش عيوب في الفترة دي');
    } else if (key === 'worker_reject') {
      const [workers, assigns] = await Promise.all([view('workers'), table('work_assignments')]);
      const agg = {};
      assigns.filter((a) => Number(a.rejected_qty) > 0 && inRange(a.received_at, from, to))
        .forEach((a) => {
          const w = workers.find((x) => x.id === a.employee_id);
          if (!w) return;
          agg[w.id] = agg[w.id] || { code: w.code, name: w.name, rej: 0 };
          agg[w.id].rej += Number(a.rejected_qty);
        });
      body.innerHTML = head + tbl([
        { label: 'الكود', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { label: 'الصنايعي', key: 'name' },
        { label: 'المرفوض', num: true, render: (r) => num(r.rej) },
      ], Object.values(agg), 'مفيش عيوب في الفترة دي');
    } else if (key === 'fabric') {
      const [fabric, moves] = await Promise.all([
        view('fabric'), table('customer_fabric_movements'),
      ]);
      const used = {};
      moves.filter((m) => m.movement === 'cut' && inRange(m.txn_date, from, to)).forEach((m) => {
        const k = `${m.customer_id}|${m.colour}`;
        used[k] = (used[k] || 0) + Math.abs(Number(m.quantity || 0));
      });
      const list = fabric.map((f) => ({
        customer_name: f.customer_name, colour: f.colour, balance: f.balance,
        used: used[`${f.customer_id}|${f.colour}`] || 0,
      }));
      body.innerHTML = head + tbl([
        { label: 'العميل', key: 'customer_name' },
        { label: 'اللون', key: 'colour' },
        { label: 'المستهلك', num: true, render: (r) => num(r.used) + 'م' },
        { label: 'الرصيد', num: true, render: (r) => num(r.balance) + 'م' },
      ], list, 'مفيش بيانات');
    } else if (key === 'orders') {
      const rows = (await view('orders')).filter((o) => inRange(o.order_date, from, to));
      body.innerHTML = head + tbl([
        { label: 'الأمر', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { label: 'العميل', key: 'customer_name' },
        { label: 'الموديل', key: 'model_name' },
        { label: 'الكمية', num: true, render: (r) => num(r.quantity) },
        { label: 'اتقص', num: true, render: (r) => num(r.cut_quantity) },
        { label: 'الحالة', render: (r) => chip(r.status) },
      ], rows, 'مفيش أوامر في الفترة دي');
    } else if (key === 'cost') {
      const [costing, orders] = await Promise.all([view('costing'), view('orders')]);
      const rows = costing
        .map((c) => ({ ...c, order_date: orders.find((o) => o.id === (c.order_id || c.id))?.order_date }))
        .filter((c) => inRange(c.order_date, from, to));
      body.innerHTML = head + tbl([
        { label: 'الأمر', key: 'code' },
        { label: 'الإيراد المتوقع', num: true, render: (r) => money(r.expected_revenue) },
        { label: 'الإيراد الفعلي', num: true, render: (r) => money(r.actual_revenue) },
        { label: 'التكلفة', num: true, render: (r) => money(r.total_cost) },
        { label: 'الربح', num: true, render: (r) =>
          money(Number(r.actual_revenue || 0) - Number(r.total_cost || 0)) },
      ], rows, 'مفيش بيانات في الفترة دي');
    } else if (key === 'customer_collect') {
      const [txns, customers] = await Promise.all([
        table('financial_transactions'), view('customers'),
      ]);
      const rows = txns
        .filter((t) => t.category === 'customer_receipt' && inRange(t.txn_date, from, to))
        .map((t) => ({ ...t, customer_name: customers.find((c) => c.id === t.customer_id)?.name || '—' }));
      const tot = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
      body.innerHTML = head + tbl([
        { label: 'التاريخ', render: (r) => dateAr(r.txn_date) },
        { label: 'العميل', key: 'customer_name' },
        { label: 'البيان', render: (r) => esc(r.description || '—') },
        { label: 'المبلغ', num: true, render: (r) => money(r.amount) },
      ], rows, 'مفيش تحصيلات في الفترة دي', null, [['الإجمالي', '', '', money(tot)]]);
    } else if (key === 'customer') {
      /* الرصيد = قيمة المسلَّم (بعد المرتجعات) ناقص التحصيلات. بيُحسب من
         الحركات والأوامر نفسها، مفيش رصيد متخزّن. */
      const [customers, orders, costing, cash] = await Promise.all([
        view('customers'), view('orders'), view('costing'),
        table('financial_transactions'),
      ]);
      const costByOrder = Object.fromEntries(costing.map((c) => [c.order_id, c]));
      const rows = customers.map((c) => {
        const mine = orders.filter((o) => o.customer_id === c.id);
        const received = mine.reduce((s, o) => s + Number((costByOrder[o.id] || {}).actual_revenue || 0), 0);
        const paid = cash
          .filter((t) => t.customer_id === c.id && t.category === 'customer_payment'
            && inRange(t.txn_date, from, to))
          .reduce((s, t) => s + Number(t.amount || 0), 0);
        return { ...c, received, paid, balance: received - paid };
      }).filter((r) => r.received || r.paid);
      const tot = rows.reduce((s, r) => s + r.balance, 0);
      body.innerHTML = head + tbl([
        { label: 'الكود', render: (r) => `<span class="mono">${esc(r.code)}</span>` },
        { label: 'العميل', key: 'name' },
        { label: 'المستحق', num: true, render: (r) => money(r.received) },
        { label: 'المحصّل', num: true, render: (r) => money(r.paid) },
        { label: 'الرصيد', num: true, render: (r) => money(r.balance) },
      ], rows, 'مفيش أرصدة في الفترة دي', null, [['الإجمالي', '', '', '', money(tot)]]);
    } else if (key === 'expenses') {
      const rows = (await table('expenses')).filter((e) => inRange(e.expense_date, from, to));
      const tot = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
      body.innerHTML = head + tbl([
        { label: 'التاريخ', render: (r) => dateAr(r.expense_date) },
        { label: 'التصنيف', render: (r) => esc(r.category || '—') },
        { label: 'الوصف', render: (r) => esc(r.description || '—') },
        { label: 'المبلغ', num: true, render: (r) => money(r.amount) },
      ], rows, 'مفيش مصروفات في الفترة دي', null, [['الإجمالي', '', '', money(tot)]]);
    } else if (key === 'cash_in') {
      const rows = (await table('financial_transactions'))
        .filter((t) => Number(t.amount) > 0 && inRange(t.txn_date, from, to));
      const tot = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
      body.innerHTML = head + tbl([
        { label: 'التاريخ', render: (r) => dateAr(r.txn_date) },
        { label: 'التصنيف', render: (r) => esc(txnCategoryAr(r.category)) },
        { label: 'البيان', render: (r) => esc(r.description || '—') },
        { label: 'المبلغ', num: true, render: (r) => money(r.amount) },
      ], rows, 'مفيش قبض في الفترة دي', null, [['الإجمالي', '', '', money(tot)]]);
    } else if (key === 'cash') {
      const rows = (await table('financial_transactions'))
        .filter((t) => inRange(t.txn_date, from, to));
      const inn = rows.filter((r) => Number(r.amount) > 0)
        .reduce((s, r) => s + Number(r.amount), 0);
      const out = rows.filter((r) => Number(r.amount) < 0)
        .reduce((s, r) => s + Math.abs(Number(r.amount)), 0);
      body.innerHTML = head + tbl([
        { label: 'التاريخ', render: (r) => dateAr(r.txn_date) },
        { label: 'التصنيف', render: (r) => esc(txnCategoryAr(r.category)) },
        { label: 'البيان', render: (r) => esc(r.description || '—') },
        { label: 'داخل', num: true, render: (r) =>
          (Number(r.amount) > 0 ? money(r.amount) : '—') },
        { label: 'خارج', num: true, render: (r) =>
          (Number(r.amount) < 0 ? money(Math.abs(r.amount)) : '—') },
      ], rows, 'مفيش حركة في الفترة دي', null,
      [['الإجمالي', '', '', money(inn), money(out)]]);
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
      <div><h1 style="margin:0">المستخدمون والصلاحيات</h1></div>
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
        /* المدير الأعلى مش محتاج صف في user_roles — دوره هو is_superuser. */
        { label: 'الدور', render: (r) => {
          if (r.is_superuser) return '<span class="chip chip-done">مدير النظام</span>';
          return (r.roles || []).map((k) =>
            `<span class="chip">${esc(roleName[k] || k)}</span>`).join(' ') || '—';
        } },
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
    notify('كلمة السر لازم ٨ حروف على الأقل'); return;
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
  } catch (e) { notifyErr(humanError(e)); }
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

    const state = await formDialog('حالة الحساب', [
      { key: 'active', label: 'الحساب', value: u.is_active === false ? '0' : '1',
        options: [
          { value: '1', label: 'شغّال — يقدر يدخل النظام' },
          { value: '0', label: 'موقوف — ممنوع من الدخول' },
        ],
        hint: 'الإيقاف بيمنع الدخول فورًا، لكنه مش بيمسح بيانات المستخدم ولا حركاته' },
    ]);
    if (state) {
      await rpc('rpc_update_profile', { p_id: u.id, p_is_active: state.active === '1' });
    }
    pageUsers();
  } catch (e) { notifyErr(humanError(e)); }
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
    mask.tabIndex = -1;
    mask.focus();
    const form = mask.querySelector('form');
    const close = (val) => { mask.remove(); resolve(val); };
    form.onsubmit = (e) => {
      e.preventDefault();
      const picked = [...form.querySelectorAll('input:checked')].map((i) => i.value);
      if (!picked.length) { notifyErr(ERRORS.E_ROLE_REQUIRED); return; }
      close(picked);
    };
    mask.querySelector('[data-cancel]').onclick = () => close(null);
    mask.onclick = (e) => { if (e.target === mask) close(null); };
    mask.onkeydown = (e) => { if (e.key === 'Escape') close(null); };
  });
}

// The permission matrix. A box starts ticked when the role grants it; unticking it
// writes an explicit deny, so the row differs from the template in either direction.
async function editPermissions(u, roles) {
  if (!u) return;
  if (u.id === PROFILE?.id) { notifyErr(ERRORS.E_CANNOT_EDIT_OWN_PERMS); return; }

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
  mask.tabIndex = -1;
  mask.focus();

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
    } catch (err) { notifyErr(humanError(err)); }
  };
  mask.querySelector('[data-cancel]').onclick = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  mask.onkeydown = (e) => { if (e.key === 'Escape') mask.remove(); };
}

/* ============================================================================
   استيراد البيانات
   ========================================================================== */
/* أقسام الاستيراد: كل قسم ليه أعمدته ومفتاحه ووظيفة التحويل لمعاملات الـ RPC. */
const IMPORT_SECTIONS = [
  {
    key: 'customers',
    title: 'العملاء',
    hint: 'الاسم لازم. حرف التشغيل لو سبته فاضي بيتحدد تلقائي. العميل اللي اسمه أو تليفونه موجود بيتعدّى.',
    cols: ['الاسم', 'التليفون', 'العنوان', 'حرف التشغيل', 'ملاحظات'],
    required: [0],
    sample: 'محمود الجندي,01011550189,القاهرة,M,عميل قديم\nعبد الرحمن الجمل,01000000001,الجيزة,,',
    load: async () => {
      const rows = await view('customers');
      return {
        existing: rows,
        isDup: (c, all) => all.some((r) =>
          (r.name || '').trim() === c[0].trim()
          || (c[1] && (r.phone || '').trim() === c[1].trim())),
        rpc: 'rpc_create_customer',
        args: (c) => ({ p_name: c[0], p_phone: c[1] || null, p_letter: c[3] || null }),
      };
    },
  },
  {
    key: 'employees',
    title: 'الموظفين والصنايعية',
    hint: 'الاسم والتليفون لازم. الموظف اللي تليفونه موجود بيتعدّى. صورة البطاقة بتترفع بعدين من ملف كل موظف.',
    cols: ['الاسم', 'التليفون', 'تليفون تاني', 'الوظيفة', 'القسم', 'تاريخ التعيين', 'ملاحظات'],
    required: [0, 1],
    sample: 'محمد محمود,01011550189,,خياط,الإنتاج,2025-01-15,\nسيد الخياط,01000000002,,لياقات,الإنتاج,,',
    load: async () => {
      const rows = await view('workers');
      return {
        existing: rows,
        isDup: (c, all) => all.some((r) => (r.phone || '').trim() === c[1].trim()),
        rpc: 'rpc_create_employee',
        args: (c) => ({
          p_name: c[0], p_kind: 'worker', p_phone: c[1] || null,
          p_job_title: c[3] || null, p_hired_on: c[5] || null,
        }),
      };
    },
  },
  {
    key: 'fabric',
    title: 'أرصدة القماش الافتتاحية',
    hint: 'سطر لكل لون عند كل عميل. العميل بالكود (CUS0001) أو بالاسم زي ما هو متسجّل. سطور نفس العميل ونفس التاريخ بتتسجّل استلام واحد. العميل اللي اتسجّل له رصيد افتتاحي قبل كده بيتعدّى.',
    cols: ['العميل', 'اللون', 'الأمتار', 'التاريخ'],
    required: [0, 1, 2],
    sample: 'CUS0001,إسود,120,2026-01-01\nمحمود الجندي,كحلي,80,2026-01-01',
    load: async () => {
      const [customers, fabric] = await Promise.all([
        view('customers'), view('fabric'),
      ]);
      return {
        existing: fabric,
        isDup: (c, all, custId) => all.some((r) =>
          r.customer_id === custId && (r.colour || '').trim() === c[1].trim()),
        resolve: (c) => {
          const raw = c[0].trim();
          const byCode = customers.find((x) => (x.code || '').toUpperCase() === raw.toUpperCase());
          const byName = customers.find((x) => (x.name || '').trim() === raw);
          return (byCode || byName || {}).id || null;
        },
        rpc: 'rpc_receive_fabric',
        args: (c, ctx) => ({
          p_customer: ctx.custId, p_colour: c[1],
          p_quantity: Number(c[2]), p_date: c[3] || null,
          p_notes: 'رصيد افتتاحي',
        }),
      };
    },
  },
  {
    key: 'opening_cash',
    title: 'رصيد الخزنة والبنوك الافتتاحي',
    hint: 'سطر لكل حساب، بالاسم زي ما هو في صفحة الخزنة والحسابات. بيتسجّل حركة إيداع وصفها «رصيد افتتاحي». الحساب لازم يكون معمول الأول، والحساب اللي له رصيد افتتاحي قبل كده بيتعدّى.',
    cols: ['الحساب', 'المبلغ', 'التاريخ'],
    required: [0, 1],
    sample: 'الخزنة الرئيسية,50000,2026-01-01\nالبنك الأهلي,120000,2026-01-01',
    load: async () => {
      const [accounts, txns] = await Promise.all([
        view('accounts'), table('financial_transactions'),
      ]);
      return {
        existing: txns,
        isDup: (c, all, acctId) => all.some((r) =>
          r.account_id === acctId && (r.description || '').includes('رصيد افتتاحي')),
        resolve: (c) => {
          const raw = c[0].trim();
          return (accounts.find((a) => (a.name || '').trim() === raw)
            || accounts.find((a) => (a.code || '').toUpperCase() === raw.toUpperCase())
            || {}).id || null;
        },
        rpc: 'rpc_post_cash',
        args: (c, ctx) => ({
          p_account: ctx.custId, p_amount: Number(c[1]),
          p_category: 'capital', p_description: 'رصيد افتتاحي',
          p_date: c[2] || null,
        }),
      };
    },
  },
];

/* CSV بسيط: بيحترم علامات التنصيص والفواصل جوه النص. */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ''));
}

async function pageImport() {
  const state = window.__importState || {};
  const sections = await Promise.all(IMPORT_SECTIONS.map(async (s) => {
    try { return { ...s, ctx: await s.load() }; }
    catch (e) { return { ...s, ctx: { error: humanError(e) } }; }
  }));

  app.innerHTML = `
    ${pageHead('استيراد البيانات',
      'احفظ شيت Excel بصيغة CSV UTF-8 (ملف ← حفظ باسم) وارفعه. كل سطر بيتراجع قبل ما يتسجّل حاجة، واللي موجود قبل كده بيتعدّى.')}

    ${sections.map((s) => `<div class="card">
      <h2 style="margin-top:0">${esc(s.title)}</h2>
      <p class="hint">${esc(s.hint)}</p>
      <div class="toolbar" style="margin-bottom:8px">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" data-tpl="${s.key}">تحميل النموذج</button>
          <label class="btn btn-primary btn-sm" style="cursor:pointer">
            اختار ملف CSV
            <input type="file" accept=".csv,text/csv" data-file="${s.key}" hidden>
          </label>
        </div>
      </div>
      <p class="hint" style="margin:0">الأعمدة: ${s.cols.map((c, i) =>
        s.required.includes(i) ? `${esc(c)} (لازم)` : esc(c)).join('، ')}</p>
      <div id="imp-${s.key}" style="margin-top:10px"></div>
    </div>`).join('')}`;

  /* تحميل النموذج: بنكتب CSV بترميز BOM عشان Excel يقرأ العربي صح. */
  app.querySelectorAll('[data-tpl]').forEach((b) => {
    b.onclick = () => {
      const s = sections.find((x) => x.key === b.dataset.tpl);
      const csv = `${s.cols.join(',')}\n${s.sample}\n`;
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `نموذج-${s.title}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
  });

  app.querySelectorAll('[data-file]').forEach((input) => {
    input.onchange = async () => {
      const s = sections.find((x) => x.key === input.dataset.file);
      const file = input.files && input.files[0];
      if (!file) return;
      const text = await file.text();
      const rows = parseCsv(text.replace(/^\ufeff/, ''));
      /* أول صف عناوين لو مش أرقام — بنشيله عشان البيانات بس هي اللي تتسجل. */
      const body = rows.length && !/^\d/.test(rows[0][2] || '')
        && rows[0].some((c) => s.cols.some((col) => col.includes(c) || c.includes(col)))
        ? rows.slice(1) : rows;
      renderPreview(s, body, $(`#imp-${s.key}`));
    };
  });

  function renderPreview(s, rows, box) {
    if (s.ctx.error) { box.innerHTML = `<div class="err">${esc(s.ctx.error)}</div>`; return; }
    if (!rows.length) { box.innerHTML = '<div class="err">الملف فاضي</div>'; return; }

    const checked = rows.map((c) => {
      const missing = s.required.filter((i) => !(c[i] || '').trim());
      if (missing.length) return { c, ok: false, why: 'ناقص: ' + missing.map((i) => s.cols[i]).join('، ') };
      let custId = null;
      if (s.ctx.resolve) {
        custId = s.ctx.resolve(c);
        if (!custId) return { c, ok: false, why: 'مش موجود في النظام' };
      }
      if (s.ctx.isDup(c, s.ctx.existing, custId)) return { c, ok: false, why: 'موجود قبل كده — هيتعدّى' };
      return { c, ok: true, custId };
    });

    const good = checked.filter((r) => r.ok).length;
    box.innerHTML = `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>#</th>${s.cols.map((c) => `<th>${esc(c)}</th>`).join('')}<th>الحالة</th></tr></thead>
        <tbody>${checked.map((r, i) => `<tr>
          <td class="num">${num(i + 1)}</td>
          ${s.cols.map((_, j) => `<td>${esc(r.c[j] || '')}</td>`).join('')}
          <td>${r.ok ? '<span class="chip chip-done">هيتسجّل</span>'
            : `<span class="chip chip-idle">${esc(r.why)}</span>`}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-primary" id="impGo-${s.key}" ${good ? '' : 'disabled'}>
          استيراد ${num(good)} سطر</button>
        <span class="hint">${num(good)} جاهز · ${num(checked.length - good)} هيتعدّى</span>
      </div>`;

    const goBtn = $(`#impGo-${s.key}`);
    if (!goBtn) return;
    goBtn.onclick = async () => {
      goBtn.disabled = true;
      let ok = 0; const errs = [];
      for (const r of checked.filter((x) => x.ok)) {
        try {
          await rpc(s.ctx.rpc, s.ctx.args(r.c, { custId: r.custId }));
          ok += 1;
        } catch (e) { errs.push(`${r.c[0]} → ${humanError(e)}`); }
      }
      box.innerHTML = `<div class="ok">اتسجل ${num(ok)} سطر</div>
        ${errs.length ? `<div class="err" style="margin-top:8px">${errs.map(esc).join('<br>')}</div>` : ''}`;
      notify(`اتسجل ${ok} سطر`);
    };
  }
}

/* ============================================================================
   سجل التعديلات
   ========================================================================== */
async function pageAudit() {
  loading();
  const perPage = 50;
  const st = window.__audit || (window.__audit = {
    from: '', to: '', table: '', actor: '', q: '', shown: perPage,
  });
  const [logs, users] = await Promise.all([table('audit_log'), view('users')]);

  const userName = (id) => {
    const u = users.find((x) => x.id === id);
    return u ? (u.display_name || u.username) : 'النظام';
  };

  const ACTION_AR = { insert: 'إضافة', update: 'تعديل', delete: 'مسح' };
  const ACTION_CHIP = { insert: 'chip-done', update: 'chip-open', delete: 'chip-bad' };

  const tables = [...new Set(logs.map((l) => l.table_name))].sort();
  const filtered = logs
    .filter((l) => !st.table || l.table_name === st.table)
    .filter((l) => !st.actor || l.actor_id === st.actor)
    .filter((l) => {
      const d = String(l.created_at).slice(0, 10);
      return (!st.from || d >= st.from) && (!st.to || d <= st.to);
    })
    .filter((l) => !st.q || [l.table_name, tableAr(l.table_name), userName(l.actor_id),
      l.action, ACTION_AR[l.action]].join(' ').toLowerCase()
      .includes(st.q.toLowerCase()))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const page = filtered.slice(0, st.shown);

  /* الـ diff بيرجع {new: {...}} أو {old, new}. بنلخّصه في سطر واحد مقروء. */
  const diffLine = (l) => {
    const d = l.diff || {};
    if (l.action === 'update' && d.new && d.old) {
      const changed = Object.keys(d.new).filter((k) =>
        JSON.stringify(d.new[k]) !== JSON.stringify(d.old[k]));
      return changed.length ? 'تغيير: ' + changed.slice(0, 4).join('، ') : '';
    }
    return '';
  };

  app.innerHTML = `
    ${pageHead('سجل التعديلات', 'مين عمل إيه وإمتى — الأسعار والأجور بتبان بس للي معاه صلاحيتها')}

    <div class="card" style="padding:12px;margin-bottom:14px">
      <div class="hint" style="margin-bottom:8px">فلترة</div>
      <div class="grid g3">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><label class="label" for="aFrom">من</label>
            <input class="input" id="aFrom" type="date" value="${esc(st.from)}"></div>
          <div><label class="label" for="aTo">لحد</label>
            <input class="input" id="aTo" type="date" value="${esc(st.to)}"></div>
        </div>
        <div><label class="label" for="aTable">النوع</label>
          <select class="input" id="aTable">
            <option value="">الكل</option>
            ${tables.map((t) => `<option value="${esc(t)}"${t === st.table ? ' selected' : ''}>${esc(tableAr(t))}</option>`).join('')}
          </select></div>
        <div><label class="label" for="aActor">المستخدم</label>
          <select class="input" id="aActor">
            <option value="">الكل</option>
            ${users.map((u) => `<option value="${esc(u.id)}"${u.id === st.actor ? ' selected' : ''}>${esc(u.display_name || u.username)}</option>`).join('')}
          </select></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input class="input" id="aQ" placeholder="بحث" value="${esc(st.q)}" style="flex:1">
        <button class="btn btn-primary" id="aGo">بحث</button>
      </div>
    </div>

    <h2>الحركات</h2>
    ${page.length ? `<div class="card" style="padding:0">
      ${page.map((l) => `
        <div style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-bottom:1px solid var(--line)">
          <div style="min-width:130px" class="hint mono">${esc(tsAr(l.created_at))}</div>
          <div style="min-width:64px"><span class="chip ${ACTION_CHIP[l.action] || 'chip-idle'}">${esc(ACTION_AR[l.action] || l.action)}</span></div>
          <div style="flex:1">
            <div>${esc(tableAr(l.table_name))}</div>
            ${diffLine(l) ? `<div class="hint">— ${esc(diffLine(l))}</div>` : ''}
          </div>
          <div class="hint">${esc(userName(l.actor_id))}</div>
        </div>`).join('')}
    </div>` : `<div class="empty">مفيش حركات مطابقة</div>`}
    ${filtered.length > page.length
      ? `<div style="text-align:center;margin-top:12px">
           <button class="btn btn-ghost" id="aMore">اعرض أكتر (${filtered.length - page.length})</button>
         </div>` : ''}`;

  const apply = () => { pageAudit(); };
  $('#aFrom').onchange = (e) => { st.from = e.target.value; apply(); };
  $('#aTo').onchange = (e) => { st.to = e.target.value; apply(); };
  $('#aTable').onchange = (e) => { st.table = e.target.value; st.shown = perPage; apply(); };
  $('#aActor').onchange = (e) => { st.actor = e.target.value; st.shown = perPage; apply(); };
  $('#aGo').onclick = () => { st.q = $('#aQ').value.trim(); st.shown = perPage; apply(); };
  $('#aQ').onkeydown = (e) => { if (e.key === 'Enter') $('#aGo').click(); };
  if ($('#aMore')) $('#aMore').onclick = () => { st.shown += perPage; apply(); };
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
      <p class="hint">اضغط زرار المشاركة واختار «إضافة إلى الشاشة الرئيسية».</p>
    </div>

    <h2>رئيس العمال — مسح الباركود</h2>
    <div class="card">
      <p class="hint">افتح «رئيس العمال» واضغط «مسح بالكاميرا»، ووجّه الكاميرا على ليبل الشنطة.
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
      <p class="hint">من تفاصيل الأمر: «طباعة الأمر»، ومن الشنط: «ليبل» بيطبع ليبلات بالباركود.
        من صفحة العميل: «فاتورة PDF». من صفحة الصنايعي: «كشف حساب PDF».
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
  supplies: pageSupplies, 'supplies-admin': pageSuppliesAdmin,
  machines: pageMachines, analytics: pageAnalytics,
  reports: pageReports, users: pageUsers, import: pageImport, audit: pageAudit,
  help: pageHelp,
};

const NAV_KEYS = new Set(NAV.flatMap((g) => g.items.map((i) => i.key)));

function route() {
  stopScan();
  const hash = (location.hash || '#home').slice(1);
  const [key, param, sub] = hash.split('/');

  let navKey = key;
  if (key === 'order' || key === 'order-new' || key === 'templates') navKey = 'orders';
  if (key === 'customer') navKey = 'customers';
  if (key === 'worker') navKey = 'workers';
  renderShell(NAV_KEYS.has(navKey) ? navKey : key);

  $('#sidebar').classList.remove('open');
  $('#scrim').classList.remove('on');

  let run = ROUTES[key];
  if (key === 'order' && param) run = () => pageOrder(param, sub);
  if (key === 'customer' && param) run = () => pageCustomer(param);
  if (key === 'worker' && param) run = () => pageWorker(param);
  if (key === 'reports' && param) window.__report = param;

  if (!run) { app.innerHTML = '<div class="err">الصفحة مش موجودة</div>'; return; }
  Promise.resolve().then(run).catch(fail);
}

window.addEventListener('hashchange', route);

/* الأخطاء اللي بتحصل جوه مستمعي الأحداث (زي onclick) مش بتمر على الراوتر،
   فبتفضل صامتة والمستخدم بيشوف زرار مش بيعمل حاجة. هنا بنحوّلها لتنبيه. */
window.addEventListener('unhandledrejection', (ev) => {
  ev.preventDefault();
  notifyErr(humanError(ev.reason));
});
window.addEventListener('error', (ev) => {
  if (ev.target && ev.target !== window) return;   // أخطاء تحميل الصور مش بتاعتنا
  const e = ev.error;
  const known = e && e.message && ERRORS[String(e.message).split('|')[0]];
  notifyErr(known ? humanError(e) : 'حصل خطأ غير متوقع. حدّث الصفحة وحاول تاني');
});

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
