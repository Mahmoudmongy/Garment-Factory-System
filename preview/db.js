'use strict';

/* ============================================================================
   طبقة الاتصال بـ Supabase — تحل محل tools/preview_server.py

   نفس الدوال اللي الواجهة بتناديها (api / view / table / rpc) بنفس التوقيع،
   عشان app.js يفضل زي ما هو. الفرق إن النداءات بتروح لـ PostgREST بجلسة
   المستخدم الحقيقي (JWT)، فـ RLS بيتقيّم على اللي داخل مش على مالك الجدول.
   ========================================================================== */

/* ملف واحد بيصدّر window.OB بس — عشان app.js ما يتعارضش معاه في الأسماء. */
(() => {
  const SUPABASE_URL = window.OB_SUPABASE_URL || '';
  const SUPABASE_KEY = window.OB_SUPABASE_KEY || '';

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    document.body.innerHTML =
      '<div style="padding:24px;font-family:Tahoma">إعدادات الاتصال ناقصة (OB_SUPABASE_URL / OB_SUPABASE_KEY).</div>';
    throw new Error('E_NO_CONFIG');
  }

  /* الجلسة: بنحفظ التوكن في localStorage عشان الدخول يفضل بعد إعادة التحميل. */
  const SESSION_KEY = 'ob.session';
  let SESSION = null;
  try { SESSION = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { SESSION = null; }

  const saveSession = (s) => {
    SESSION = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* التخزين ممكن يكون مقفول — الجلسة تفضل في الذاكرة */ }
  };

  const accessToken = () => (SESSION && SESSION.access_token) || SUPABASE_KEY;

  /* ---------------------------------------------------------------- REST */
  const rest = (path, opts) => {
    const o = opts || {};
    return fetch(SUPABASE_URL + '/rest/v1/' + path, {
      method: o.method || 'GET',
      headers: Object.assign({
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + accessToken(),
        'Content-Type': 'application/json',
      }, o.headers || {}),
      body: o.body,
    });
  };

  /* PostgREST بيرجّع الخطأ في جسم الرد مش في كود الحالة بس. */
  const unwrap = async (res) => {
    const text = await res.text();
    let body = null;
    if (text) { try { body = JSON.parse(text); } catch (e) { body = text; } }
    if (!res.ok) {
      const msg = (body && (body.message || body.error_description || body.hint)) || ('HTTP ' + res.status);
      const err = new Error(body && body.code ? body.code + '|' + msg : msg);
      err.status = res.status;
      err.code = body && body.code;
      throw err;
    }
    return body;
  };

  /* ---------------------------------------------------------------- قراءة */
  /* اسم العرض اللي الواجهة بتطلبه -> اسمه الحقيقي في القاعدة. */
  const VIEWS = {
    orders: 'v_production_orders',
    order_stages: 'v_order_stages',
    bundles: 'v_bundles',
    bundle_queue: 'v_bundle_queue',
    workers: 'v_workers',
    customers: 'v_customers',
    fabric: 'v_customer_fabric_balances',
    accounts: 'v_account_balances',
    costing: 'v_order_costing',
    timeline: 'v_order_timeline',
    assignments: 'work_assignments',
    expenses: 'expenses',
    cash: 'financial_transactions',
    stock: 'v_stock_balances',
    users: 'v_users',
  };

  /* الجداول المسموح بقراءتها مباشرة (نفس القائمة البيضاء بتاعة السيرفر المحلي). */
  const TABLES = new Set([
    'operational_codes', 'work_assignments', 'deliveries', 'delivery_lines',
    'customer_returns', 'customer_fabric_movements', 'cut_lines', 'stage_templates',
    'stage_template_stages', 'items', 'warehouses', 'inventory_transactions',
    'machines', 'machine_maintenance', 'audit_log', 'expenses',
    'financial_transactions', 'employees', 'employee_pay_terms', 'profiles',
    'roles', 'permissions', 'role_permissions', 'user_roles',
  ]);

  const FILTER_COLS = new Set([
    'order_id', 'customer_id', 'bundle_id', 'employee_id', 'template_id',
    'delivery_id', 'machine_id', 'item_id', 'warehouse_id', 'code',
    'assignment_id', 'stage_code', 'production_order_id',
  ]);

  /* الفلاتر المسموحة بس، وبصيغة PostgREST (eq.). */
  const buildFilters = (params, allow) => {
    const out = [];
    Object.entries(params || {}).forEach(([k, v]) => {
      if (!allow.has(k) || v === undefined || v === null || v === '') return;
      out.push(encodeURIComponent(k) + '=eq.' + encodeURIComponent(v));
    });
    return out;
  };

  const view = async (name, params) => {
    const tableName = VIEWS[name];
    if (!tableName) throw new Error('E_UNKNOWN_VIEW|' + name);
    /* نفس منطق السيرفر: الفلاتر بتتطبق على كل حاجة ما عدا v_production_orders. */
    const allow = tableName === 'v_production_orders'
      ? new Set()
      : new Set(['order_id', 'customer_id', 'bundle_id', 'code', 'stage_code']);
    const parts = buildFilters(params, allow);
    parts.push('limit=500');
    const res = await rest(tableName + '?' + parts.join('&'));
    return (await unwrap(res)) || [];
  };

  const table = async (name, params) => {
    if (!TABLES.has(name)) throw new Error('E_UNKNOWN_TABLE|' + name);
    const parts = buildFilters(params, FILTER_COLS);
    parts.push('limit=1000');
    const res = await rest(name + '?' + parts.join('&'));
    return (await unwrap(res)) || [];
  };

  /* ---------------------------------------------------------------- كتابة */
  const rpc = async (fn, args) => {
    const res = await rest('rpc/' + fn, {
      method: 'POST',
      body: JSON.stringify(args || {}),
    });
    return unwrap(res);
  };

  /* إنشاء حساب دخول: لازم service key، فبيمر عبر Edge Function في Supabase.
     الدالة بتتحقق من صلاحية الطالب بنفس الـ JWT بتاعه، فالصلاحية بتتقيّم في القاعدة. */
  const adminCreateUser = async (payload) => {
    await refreshIfNeeded();
    let res;
    try {
      res = await fetch(SUPABASE_URL + '/functions/v1/admin-create-user', {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: 'Bearer ' + accessToken(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload || {}),
      });
    } catch (e) {
      /* الـ preflight بيرجع 404 لو الدالة مش منشورة، والمتصفح بيبلّغ عنها
         كأنها شبكة مقطوعة. الرسالة دي بتوجّه لسببها الحقيقي بدل ما تضلّل. */
      const err = new Error('E_FUNCTION_UNREACHABLE');
      err.status = 0;
      throw err;
    }
    const body = await unwrap(res);
    if (body && body.error) throw new Error(body.error);
    return body;
  };

  /* ---------------------------------------------------------------- الهوية */
  const emailFor = (username) => String(username || '').trim().toLowerCase() + '@factory.internal';

  const signIn = async (username, password) => {
    const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailFor(username), password }),
    });
    const body = await unwrap(res);
    saveSession({ access_token: body.access_token, refresh_token: body.refresh_token,
                  user: body.user, expires_at: Date.now() + (body.expires_in || 3600) * 1000 });
    return body.user;
  };

  /* التوكن بيعيش ساعة؛ بنجدده قبل ما ينتهي بدل ما كل نداء يفشل. */
  const refreshIfNeeded = async () => {
    if (!SESSION || !SESSION.refresh_token) return;
    if (SESSION.expires_at && Date.now() < SESSION.expires_at - 60000) return;
    try {
      const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: SESSION.refresh_token }),
      });
      const body = await unwrap(res);
      saveSession({ access_token: body.access_token, refresh_token: body.refresh_token,
                    user: body.user, expires_at: Date.now() + (body.expires_in || 3600) * 1000 });
    } catch (e) {
      saveSession(null);
    }
  };

  const signOut = async () => {
    try {
      if (SESSION && SESSION.access_token) {
        await fetch(SUPABASE_URL + '/auth/v1/logout', {
          method: 'POST',
          headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SESSION.access_token },
        });
      }
    } catch (e) { /* الخروج محليًا كفاية */ }
    saveSession(null);
  };

  const currentUser = () => (SESSION && SESSION.user) || null;

  /* ---------------------------------------------------------------- الميتا */
  /* نفس شكل /api/meta بالظبط، عشان التشغيل في app.js يفضل زي ما هو. */
  const meta = async () => {
    const me = currentUser();
    const meId = me && me.id;
    if (!meId) throw new Error('E_NO_SESSION');

    const [perms, profiles, templates, stages, accounts, roles] = await Promise.all([
      rest('permissions?select=code,group_ar,name_ar&order=sort_order'),
      rest('profiles?select=id,username,display_name,is_superuser,employee_id&id=eq.' + encodeURIComponent(meId)),
      rest('stage_templates?select=id&is_default=eq.true&limit=1'),
      rest('stage_template_stages?select=name_ar,code,piece_price,depends_on,is_final,seq,template_id&order=seq'),
      rest('financial_accounts?select=id,code,name&is_active=eq.true&order=code'),
      rest('roles?select=key,name_ar&order=name_ar'),
    ]);
    const [permissions, profileRows, tmpl, stageRows, accts, roleRows] = await Promise.all(
      [perms, profiles, templates, stages, accounts, roles].map(unwrap));

    const defaultId = (tmpl && tmpl[0] && tmpl[0].id) || null;
    const myStages = (stageRows || [])
      .filter((s) => s.template_id === defaultId)
      .sort((a, b) => (a.seq || 0) - (b.seq || 0));

    const rp = await unwrap(await rest('role_permissions?select=role_key,perm_code'));
    const byRole = {};
    (rp || []).forEach((r) => { (byRole[r.role_key] = byRole[r.role_key] || []).push(r.perm_code); });

    return {
      permissions: permissions || [],
      profile: (profileRows && profileRows[0]) || null,
      stages: myStages,
      accounts: accts || [],
      roles: (roleRows || []).map((r) => ({
        key: r.key, name_ar: r.name_ar,
        perms: (byRole[r.key] || []).sort(),
      })),
    };
  };

  window.OB = {
    view, table, rpc, meta, adminCreateUser,
    signIn, signOut, currentUser, refreshIfNeeded,
  };
})();
