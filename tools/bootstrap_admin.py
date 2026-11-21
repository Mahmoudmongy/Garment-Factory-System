#!/usr/bin/env python3
"""Creates the first admin login on a real Supabase project.

The first user cannot be created through the app (the app requires an existing
admin to grant `system.user.manage`), so it is created here, once, out of band.

Usage:
    SUPABASE_URL='https://<ref>.supabase.co' \
    SUPABASE_SERVICE_ROLE_KEY='<service_role key>' \
    SUPABASE_DB_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres' \
        python3 tools/bootstrap_admin.py --username admin --display 'المدير'

    # generate a strong password instead of typing one:
    ... --generate-password

The service-role key is used only for the Auth Admin API call. The profile row is
written over the direct DB connection, so nothing here needs the app to be running.
Running it twice is safe: an existing auth user is reused, not duplicated.
"""

import argparse
import json
import os
import secrets
import string
import sys
import urllib.error
import urllib.request

try:
    import psycopg
except ImportError:
    sys.exit("psycopg 3 is required: pip install 'psycopg[binary]'")


def admin_request(url, key, method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url.rstrip("/") + path,
        data=data,
        method=method,
        headers={
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            body = res.read().decode()
            return res.status, (json.loads(body) if body else None)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        try:
            return exc.code, json.loads(body)
        except json.JSONDecodeError:
            return exc.code, {"message": body}


def gen_password(length=20):
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(length))
        if (any(c.islower() for c in pw) and any(c.isupper() for c in pw)
                and any(c.isdigit() for c in pw) and any(not c.isalnum() for c in pw)):
            return pw


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--username", default="admin")
    ap.add_argument("--display", default="المدير")
    ap.add_argument("--password")
    ap.add_argument("--generate-password", action="store_true")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    db_url = os.environ.get("SUPABASE_DB_URL")
    for name, val in (("SUPABASE_URL", url), ("SUPABASE_SERVICE_ROLE_KEY", service),
                      ("SUPABASE_DB_URL", db_url)):
        if not val:
            sys.exit(f"{name} is not set")

    username = args.username.strip().lower()
    email = f"{username}@factory.internal"

    if args.generate_password:
        password = gen_password()
    elif args.password:
        password = args.password
    else:
        sys.exit("pass --password or --generate-password")

    if len(password) < 8:
        sys.exit("password must be at least 8 characters")

    # 1) create (or reuse) the confirmed Auth user
    status, body = admin_request(url, service, "POST", "/auth/v1/admin/users", {
        "email": email, "password": password, "email_confirm": True,
    })
    if status in (200, 201) and body and body.get("id"):
        user_id = body["id"]
        print(f"created auth user {email} ({user_id})")
    elif status == 422 and body and "already" in json.dumps(body).lower():
        status2, body2 = admin_request(
            url, service, "GET", f"/auth/v1/admin/users?filter={email}", None)
        found = next((u for u in (body2 or {}).get("users", []) if u.get("email") == email), None)
        if not found:
            sys.exit(f"user {email} exists but could not be looked up: {body2}")
        user_id = found["id"]
        print(f"reusing existing auth user {email} ({user_id}) — password NOT changed")
    else:
        sys.exit(f"auth admin call failed [{status}]: {body}")

    # 2) write the profile row over the DB connection
    with psycopg.connect(db_url, connect_timeout=20) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.profiles (id, username, display_name, is_superuser, is_active)
                values (%s, %s, %s, true, true)
                on conflict (id) do update
                   set username = excluded.username,
                       display_name = excluded.display_name,
                       is_superuser = true,
                       is_active = true
                """,
                (user_id, username, args.display),
            )
        conn.commit()

    print(f"profile ready: username={username} superuser=true")
    if args.generate_password:
        print(f"\nPASSWORD (shown once, store it now): {password}\n")
    print("log in with the username only — the app appends @factory.internal itself.")


if __name__ == "__main__":
    main()
