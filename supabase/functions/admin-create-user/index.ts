// admin-create-user — creates a Supabase Auth user AND its profile in one flow.
// STATUS: NOT DEPLOYED, NOT TESTED.
// The service-role key exists only in the Edge Function environment (injected by Supabase). Never in the browser.
// Login identity: username -> "<username>@factory.internal" (no real mailbox needed; signups must be disabled).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization" }, 401);

  // 1) caller identity + permission, evaluated by the DATABASE with the caller's JWT
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: perms, error: pe } = await asCaller.rpc("rpc_my_permissions");
  if (pe || !Array.isArray(perms) || !perms.includes("system.user.manage")) return json({ error: "forbidden" }, 403);

  const { username, password, display_name, employee_id, roles } = await req.json();
  if (typeof username !== "string" || !/^[a-z0-9._-]{3,30}$/.test(username)) return json({ error: "invalid username" }, 400);
  if (typeof password !== "string" || password.length < 8) return json({ error: "password must be at least 8 characters" }, 400);

  // 2) create the auth user with the service role
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: created, error: ce } = await admin.auth.admin.createUser({
    email: `${username}@factory.internal`, password, email_confirm: true,
  });
  if (ce || !created.user) return json({ error: ce?.message ?? "could not create user" }, 400);

  // 3) create the profile with the CALLER's JWT (permission + audit happen in the DB)
  const { error: re } = await asCaller.rpc("rpc_create_profile", {
    p_user: created.user.id, p_username: username, p_display: display_name ?? username,
    p_employee: employee_id ?? null, p_roles: roles ?? [],
  });
  if (re) {                                   // compensate: do not leave an orphan auth user
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: re.message }, 400);
  }
  return json({ id: created.user.id, username });
});
