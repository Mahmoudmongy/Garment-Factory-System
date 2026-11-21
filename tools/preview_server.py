"""Local development server for the garment factory app.

Serves static files from preview/ and exposes /api/* endpoints that call the same
Postgres functions Supabase would. **The shipped frontend no longer uses this**:
`preview/db.js` talks to PostgREST directly, in production and locally alike.

Keep it for what it is still good at: driving the UI against a local Postgres
without a Supabase project, and checking what a non-admin sees by setting
PREVIEW_AS to a profile id. The /api contract it mimics is defined by db.js.

Run: PREVIEW_AS=<profile-uuid> python tools/preview_server.py
"""
import json
import os
import re
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg
from psycopg.rows import dict_row

DB_DSN = os.environ.get(
    "PREVIEW_DSN", "postgresql://postgres:postgres@127.0.0.1:55432/postgres"
)
PREVIEW_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "preview")

# The preview acts as one fixed identity; the real app uses the JWT subject.
# PREVIEW_AS lets you check what a non-admin sees without a real Supabase login.
ADMIN_ID = "11111111-1111-1111-1111-111111111111"
PREVIEW_AS = os.environ.get("PREVIEW_AS", ADMIN_ID)

# Read-only views the UI may query by name.
VIEWS = {
    "orders": "v_production_orders",
    "order_stages": "v_order_stages",
    "bundles": "v_bundles",
    "bundle_queue": "v_bundle_queue",
    "workers": "v_workers",
    "customers": "v_customers",
    "fabric": "v_customer_fabric_balances",
    "accounts": "v_account_balances",
    "costing": "v_order_costing",
    "timeline": "v_order_timeline",
    "assignments": "work_assignments",
    "expenses": "expenses",
    "cash": "financial_transactions",
    "stock": "v_stock_balances",
    "users": "v_users",
}

# Plain tables the UI may read (whitelisted, never free-form SQL).
TABLES = {
    "operational_codes", "work_assignments", "deliveries", "delivery_lines",
    "customer_returns", "customer_fabric_movements", "cut_lines", "stage_templates",
    "stage_template_stages", "items", "warehouses", "inventory_transactions",
    "machines", "machine_maintenance", "audit_log", "expenses",
    "financial_transactions", "employees", "employee_pay_terms", "profiles",
    "roles", "permissions", "role_permissions", "user_roles",
}

# Columns that may be used to filter a table read.
FILTER_COLS = {"order_id", "customer_id", "bundle_id", "employee_id", "template_id",
               "delivery_id", "machine_id", "item_id", "warehouse_id", "code",
               "bundle_id", "assignment_id"}


def connect():
    conn = psycopg.connect(DB_DSN, row_factory=dict_row, autocommit=True)
    # SET does not accept bind parameters; set_config does.
    conn.execute("select set_config('request.jwt.claims', %s, false)",
                 (json.dumps({"sub": PREVIEW_AS, "role": "authenticated"}),))
    return conn


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=PREVIEW_DIR, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))

    def end_headers(self):
        # The preview is edited live; a cached app.js silently serves stale UI.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def _json(self, payload, status=200):
        body = json.dumps(payload, default=str, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/view":
            return self._view(parse_qs(parsed.query))
        if parsed.path == "/api/table":
            return self._table(parse_qs(parsed.query))
        if parsed.path == "/api/meta":
            return self._meta()
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return self._json({"error": "E_BAD_JSON"}, 400)

        if parsed.path == "/api/rpc":
            return self._rpc(payload)
        if parsed.path == "/api/admin-create-user":
            return self._admin_create_user(payload)
        return self._json({"error": "E_NOT_FOUND"}, 404)

    def _view(self, qs):
        name = (qs.get("name") or [""])[0]
        table = VIEWS.get(name)
        if not table:
            return self._json({"error": "E_UNKNOWN_VIEW", "name": name}, 400)
        sql = f"select * from public.{table}"
        where, params = [], []
        for key in ("order_id", "customer_id", "bundle_id", "code", "stage_code"):
            if key in qs and table != "v_production_orders":
                where.append(f"{key} = %s")
                params.append(qs[key][0])
        if where:
            sql += " where " + " and ".join(where)
        sql += " limit 500"
        try:
            with connect() as conn:
                rows = conn.execute(sql, params).fetchall()
            return self._json({"rows": rows})
        except Exception as exc:  # surfaced to the UI so failures are never silent
            return self._json({"error": "E_DB", "detail": str(exc)}, 500)

    def _table(self, qs):
        name = (qs.get("name") or [""])[0]
        if name not in TABLES:
            return self._json({"error": "E_UNKNOWN_TABLE", "name": name}, 400)
        where, params = [], []
        for key, values in qs.items():
            if key == "name" or key not in FILTER_COLS:
                continue
            where.append(f"{key} = %s")
            params.append(values[0])
        sql = f"select * from public.{name}"
        if where:
            sql += " where " + " and ".join(where)
        sql += " limit 1000"
        try:
            with connect() as conn:
                rows = conn.execute(sql, params).fetchall()
            return self._json({"rows": rows})
        except Exception as exc:
            return self._json({"error": "E_DB", "detail": str(exc)}, 500)

    def _meta(self):
        try:
            with connect() as conn:
                perms = conn.execute(
                    "select code, group_ar, name_ar from public.permissions order by sort_order"
                ).fetchall()
                profile = conn.execute(
                    "select id, username, display_name, is_superuser from public.profiles where id = %s",
                    (PREVIEW_AS,),
                ).fetchone()
                stages = conn.execute(
                    "select name_ar, code, piece_price, depends_on, is_final "
                    "from public.stage_template_stages where template_id = "
                    "(select id from public.stage_templates where is_default limit 1) order by seq"
                ).fetchall()
                accts = conn.execute(
                    "select id, code, name from public.financial_accounts where is_active order by code"
                ).fetchall()
                roles = conn.execute(
                    "select r.key, r.name_ar,"
                    "       coalesce((select jsonb_agg(rp.perm_code order by rp.perm_code)"
                    "                   from public.role_permissions rp"
                    "                  where rp.role_key = r.key), '[]'::jsonb) as perms"
                    "  from public.roles r order by r.name_ar"
                ).fetchall()
            return self._json({"permissions": perms, "profile": profile,
                               "stages": stages, "accounts": accts, "roles": roles})
        except Exception as exc:
            return self._json({"error": "E_DB", "detail": str(exc)}, 500)

    def _admin_create_user(self, payload):
        """Local stand-in for the admin-create-user edge function.

        Production creates the Supabase Auth user with the service-role key and
        then calls rpc_create_profile with the caller's JWT. There is no GoTrue
        here, so this writes the auth.users row directly and then takes the same
        RPC path, which keeps the permission check and the audit row in the DB.
        """
        username = (payload.get("username") or "").strip()
        password = payload.get("password") or ""
        display = (payload.get("display_name") or "").strip() or username
        roles = payload.get("roles") or []
        employee = payload.get("employee_id")

        if not re.fullmatch(r"[a-z0-9._-]{3,30}", username):
            return self._json({"error": "E_USERNAME_INVALID", "detail": username}, 400)
        if len(password) < 8:
            return self._json({"error": "E_PASSWORD_SHORT"}, 400)

        try:
            with connect() as conn:
                if conn.execute("select 1 from public.profiles where username = %s",
                                (username,)).fetchone():
                    return self._json({"error": "E_USERNAME_TAKEN", "detail": username}, 400)

                uid = conn.execute(
                    "insert into auth.users (email, encrypted_password) values (%s, %s)"
                    " returning id",
                    (f"{username}@factory.internal", password)).fetchone()["id"]
                try:
                    conn.execute(
                        "select public.rpc_create_profile(%s, %s, %s, %s, %s)",
                        (uid, username, display, employee, roles))
                except Exception:
                    # Mirrors the edge function: never leave a login behind with no
                    # profile, or the username is burned and the account is unusable.
                    conn.execute("delete from auth.users where id = %s", (uid,))
                    raise
            return self._json({"id": str(uid), "username": username})
        except psycopg.errors.RaiseException as exc:
            msg = str(exc).split("\n")[0]
            code, _, detail = msg.partition(" — ")
            return self._json({"error": code, "detail": detail or None}, 400)
        except psycopg.errors.UniqueViolation:
            # A leftover login with no profile would land here; treat it as taken.
            return self._json({"error": "E_USERNAME_TAKEN", "detail": username}, 400)
        except Exception as exc:
            return self._json({"error": "E_DB", "detail": str(exc)}, 500)

    def _rpc(self, payload):
        fn = payload.get("fn")
        args = payload.get("args") or {}
        if not fn or not fn.startswith("rpc_"):
            return self._json({"error": "E_UNKNOWN_RPC", "fn": fn}, 400)
        try:
            with connect() as conn:
                sig = conn.execute(
                    "select coalesce(p.proargnames, '{}') as names,"
                    "       coalesce(p.proargtypes::oid[], '{}') as types"
                    "  from pg_proc p join pg_namespace n on n.oid = p.pronamespace"
                    " where n.nspname = 'public' and p.proname = %s"
                    " order by p.oid desc limit 1", (fn,)).fetchone()
                if not sig:
                    return self._json({"error": "E_UNKNOWN_RPC", "fn": fn}, 400)

                # JSON numbers arrive as int/float, which Postgres types as
                # integer/double precision. Neither casts implicitly to numeric,
                # so every argument is cast to the type the function declares —
                # otherwise named-argument lookup fails with "no function matches".
                types = {}
                for name, oid in zip(sig["names"], sig["types"]):
                    types[name] = conn.execute(
                        "select format_type(%s::oid, null) as t", (oid,)).fetchone()["t"]

                parts, params = [], {}
                for k, v in args.items():
                    cast = types.get(k, "text")
                    if isinstance(v, (dict, list)):
                        parts.append(f"{k} => %({k})s::{cast}")
                        params[k] = json.dumps(v, ensure_ascii=False)
                    else:
                        parts.append(f"{k} => %({k})s::{cast}")
                        params[k] = v
                sql = f"select public.{fn}({', '.join(parts)}) as result"
                row = conn.execute(sql, params).fetchone()
            return self._json({"result": row["result"] if row else None})
        except psycopg.errors.RaiseException as exc:
            # fn_raise emits "CODE — detail"; split it so the UI can translate the code.
            msg = str(exc).split("\n")[0]
            code, _, detail = msg.partition(" — ")
            return self._json({"error": code, "detail": detail or None}, 400)
        except Exception as exc:
            return self._json({"error": "E_DB", "detail": str(exc)}, 500)


def main():
    port = int(os.environ.get("PREVIEW_PORT", "12001"))
    server = HTTPServer(("0.0.0.0", port), Handler)
    print(f"preview server on http://0.0.0.0:{port}  (db: {DB_DSN})")
    server.serve_forever()


if __name__ == "__main__":
    main()
