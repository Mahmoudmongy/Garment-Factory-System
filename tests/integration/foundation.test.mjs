// Integration tests against a REAL Supabase project (use a dedicated TEST project, never production).
// STATUS: WRITTEN BUT NEVER RUN (no Supabase project / network was available when authored).
//
//   cd tests/integration && npm i && \
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm test
//
// Keys come from the environment of the machine running the tests only. Never commit them.
import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE } = process.env;
const skip = !URL || !ANON || !SERVICE ? "set SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY" : false;

const run = Date.now().toString(36);
const email = (u) => `${u}@factory.internal`;
const PASSWORD = "Test-pass-12345";
const svc = () => createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = () => createClient(URL, ANON, { auth: { persistSession: false } });
const users = { admin: `adm${run}`, clerk: `clk${run}` };
const ids = {};

async function login(u) {
  const c = anon();
  const { data, error } = await c.auth.signInWithPassword({ email: email(u), password: PASSWORD });
  assert.equal(error, null, `login ${u}: ${error?.message}`);
  return { c, session: data.session };
}

test("setup: create admin + clerk", { skip }, async () => {
  const s = svc();
  for (const [k, u] of Object.entries(users)) {
    const { data, error } = await s.auth.admin.createUser({ email: email(u), password: PASSWORD, email_confirm: true });
    assert.equal(error, null); ids[k] = data.user.id;
  }
  let r = await s.rpc("fn_bootstrap_first_admin", { p_user: ids.admin, p_username: users.admin, p_display: "Test admin" });
  // an admin may already exist in a re-used test project; then make this one an admin via direct insert
  if (r.error) {
    await s.from("profiles").insert({ id: ids.admin, username: users.admin });
    const role = await s.from("roles").select("id").eq("code", "admin").single();
    await s.from("user_roles").insert({ profile_id: ids.admin, role_id: role.data.id });
  }
  const a = await login(users.admin);
  const { error } = await a.c.rpc("rpc_create_profile", { p_user: ids.clerk, p_username: users.clerk, p_display: "Clerk", p_employee: null, p_roles: [] });
  assert.equal(error, null);
});

test("auth: login / session / logout", { skip }, async () => {
  const { c, session } = await login(users.admin);
  assert.ok(session.access_token);
  const { data } = await c.auth.getSession();
  assert.equal(data.session.user.id, ids.admin);
  const bad = await anon().auth.signInWithPassword({ email: email(users.admin), password: "wrong-password" });
  assert.ok(bad.error, "wrong password must fail");
  await c.auth.signOut();
  const after = await c.rpc("rpc_my_permissions");
  assert.ok(after.error || (after.data ?? []).length === 0, "after logout the RPC must not work");
});

test("permissions: direct RPC without permission fails; anon fails", { skip }, async () => {
  const { c } = await login(users.clerk);
  const r = await c.rpc("rpc_create_customer", { p: { name: "x" } });
  assert.equal(r.error?.code, "42501");
  const direct = await c.from("customers").insert({ name: "x", op_letter: "Z" });
  assert.ok(direct.error, "direct insert must be denied");
  const a = await anon().rpc("rpc_my_permissions");
  assert.ok(a.error, "anon must not call RPC");
});

test("inactive user: no permissions and (with ban) cannot log in", { skip }, async () => {
  const { c: admin } = await login(users.admin);
  let r = await admin.rpc("rpc_set_profile_active", { p_profile: ids.clerk, p_active: false, p_reason: "integration test" });
  assert.equal(r.error, null);
  const { c } = await login(users.clerk);            // JWT still valid until expiry — DB must deny anyway
  const perms = await c.rpc("rpc_my_permissions");
  assert.deepEqual(perms.data, []);
  await svc().auth.admin.updateUserById(ids.clerk, { ban_duration: "876000h" });
  const banned = await anon().auth.signInWithPassword({ email: email(users.clerk), password: PASSWORD });
  assert.ok(banned.error, "banned user cannot sign in");
});

test("concurrency: 20 parallel customers get 20 distinct codes and letters", { skip }, async () => {
  const { c } = await login(users.admin);
  const res = await Promise.all(Array.from({ length: 20 }, (_, i) => c.rpc("rpc_create_customer", { p: { name: `conc-${run}-${i}` } })));
  const ok = res.filter((r) => !r.error).map((r) => r.data);
  const letterExhausted = res.filter((r) => r.error);   // only 23 letters exist; failures must be explicit, never duplicates
  assert.equal(new Set(ok.map((x) => x.code)).size, ok.length);
  assert.equal(new Set(ok.map((x) => x.op_letter)).size, ok.length);
  assert.ok(letterExhausted.every((r) => /no free operational letters|F0008/.test(r.error.message + r.error.code)));
});

test("concurrency: 30 parallel operational codes are unique and sequential", { skip }, async () => {
  const s = svc();
  const { c } = await login(users.admin);
  const cu = (await c.rpc("rpc_create_customer", { p: { name: `opc-${run}` } }));
  if (cu.error) return;                                // letters exhausted in a re-used project
  const res = await Promise.all(Array.from({ length: 30 }, () => s.rpc("fn_generate_operational_code", { p_customer: cu.data.id, p_size: "L" })));
  const codes = res.map((r) => r.data);
  assert.ok(res.every((r) => !r.error), JSON.stringify(res.find((r) => r.error)));
  assert.equal(new Set(codes).size, 30);
});

test("idempotency: 10 parallel identical postings create exactly one transaction", { skip }, async () => {
  const { c } = await login(users.admin);
  const acc = await c.rpc("rpc_create_financial_account", { p: { name: `acc-${run}`, account_type: "cash", opening_balance: 1000 } });
  assert.equal(acc.error, null);
  const key = `idem-${run}-0001`;
  const res = await Promise.all(Array.from({ length: 10 }, () =>
    c.rpc("rpc_post_manual_transaction", { p_account: acc.data.id, p_direction: "out", p_amount: 100, p_date: new Date().toISOString().slice(0, 10), p_description: "parallel", p_key: key })));
  assert.ok(res.every((r) => !r.error), JSON.stringify(res.find((r) => r.error)));
  assert.equal(new Set(res.map((r) => r.data.id)).size, 1);
  const bal = await c.from("v_account_balances").select("current_balance").eq("account_id", acc.data.id).single();
  assert.equal(Number(bal.data.current_balance), 900);
});

test("concurrency: parallel withdrawals never overdraw", { skip }, async () => {
  const { c } = await login(users.admin);
  const acc = await c.rpc("rpc_create_financial_account", { p: { name: `od-${run}`, account_type: "cash", opening_balance: 500 } });
  const res = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    c.rpc("rpc_post_manual_transaction", { p_account: acc.data.id, p_direction: "out", p_amount: 100, p_date: new Date().toISOString().slice(0, 10), p_description: "race", p_key: `race-${run}-${i}-00` })));
  assert.equal(res.filter((r) => !r.error).length, 5);
  const bal = await c.from("v_account_balances").select("current_balance").eq("account_id", acc.data.id).single();
  assert.equal(Number(bal.data.current_balance), 0);
});
