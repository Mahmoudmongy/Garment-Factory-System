#!/usr/bin/env python3
"""Creates the first admin login on a real Supabase project.

The app requires an existing admin to grant permissions, so the first login is
created out of band. The Auth user is made through the Admin API with the
service-role key, which also creates the email identity GoTrue needs for a
password login. The profile row is written over a direct database connection,
because no RLS policy grants insert on public.profiles.

Usage:
    SUPABASE_URL='https://<ref>.supabase.co' \
    SUPABASE_SERVICE_ROLE_KEY='<service_role key>' \
    SUPABASE_DB_PASSWORD='<db password>' \
    ADMIN_PASSWORD='<password>' \
        python3 tools/create_admin.py --username admin --display 'المدير'

Running it twice is safe: an existing auth user is reused and its password is
reset to ADMIN_PASSWORD, and the profile row is upserted.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from urllib.parse import quote

try:
    import psycopg
except ImportError:
    sys.exit("psycopg 3 is required: pip install 'psycopg[binary]'")

PROJECT_REF = "xfttxitgwqvqztssbxra"
POOLER_REGIONS = [
    "eu-central-1", "us-east-1", "us-west-1", "eu-west-1", "eu-west-2",
    "ap-southeast-1", "ap-northeast-1", "sa-east-1", "ca-central-1",
]


def api(url, key, method, path, payload=None):
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


def sign_in(url, key, email, password):
    return api(url, key, "POST", "/auth/v1/token?grant_type=password",
               {"email": email, "password": password})


def rest(url, key, token, path):
    req = urllib.request.Request(
        url.rstrip("/") + "/rest/v1/" + path,
        headers={"apikey": key, "Authorization": "Bearer " + token},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read().decode() or "[]")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()[:300]


def candidate_urls():
    explicit = (os.environ.get("SUPABASE_DB_URL") or "").strip()
    if explicit.startswith(("postgres://", "postgresql://")):
        yield explicit
    password = (os.environ.get("SUPABASE_DB_PASSWORD") or "").strip()
    if not password:
        return
    pw = quote(password, safe="")
    ref = os.environ.get("SUPABASE_PROJECT_REF", PROJECT_REF)
    yield f"postgresql://postgres:{pw}@db.{ref}.supabase.co:5432/postgres"
    for region in POOLER_REGIONS:
        for prefix in ("aws-0", "aws-1"):
            yield (
                f"postgresql://postgres.{ref}:{pw}"
                f"@{prefix}-{region}.pooler.supabase.com:5432/postgres"
            )


def connect():
    errors = []
    for url in candidate_urls():
        host = url.rsplit("@", 1)[-1].split("/")[0]
        try:
            conn = psycopg.connect(url, connect_timeout=8, autocommit=False)
            print(f"connected via {host}")
            return conn
        except Exception as exc:
            errors.append(f"  {host}: {str(exc).strip().splitlines()[0][:110]}")
    sys.exit("could not reach the database:\n" + "\n".join(errors))


def ensure_auth_user(url, key, email, password):
    """Create the auth user, or reset the password when it already exists."""
    status, body = api(url, key, "POST", "/auth/v1/admin/users", {
        "email": email,
        "password": password,
        "email_confirm": True,
    })
    if status in (200, 201) and body and body.get("id"):
        print(f"created auth user {email}")
        return body["id"]

    if status in (409, 422):
        status2, body2 = api(url, key, "GET", f"/auth/v1/admin/users?filter={email}")
        users = (body2 or {}).get("users", [])
        found = next((u for u in users if u.get("email") == email), None)
        if not found:
            sys.exit(f"{email} exists but could not be looked up: {body2}")
        status3, body3 = api(url, key, "PUT", f"/auth/v1/admin/users/{found['id']}", {
            "password": password,
            "email_confirm": True,
        })
        if status3 not in (200, 201):
            sys.exit(f"could not reset the password [{status3}]: {body3}")
        print(f"reused auth user {email}; password reset to ADMIN_PASSWORD")
        return found["id"]

    sys.exit(f"auth admin call failed [{status}]: {body}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--username", default="admin")
    ap.add_argument("--display", default="المدير")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or service
    password = os.environ.get("ADMIN_PASSWORD")
    for name, val in (("SUPABASE_URL", url), ("SUPABASE_SERVICE_ROLE_KEY", service),
                      ("ADMIN_PASSWORD", password)):
        if not val:
            sys.exit(f"{name} is not set")
    if len(password) < 8:
        sys.exit("ADMIN_PASSWORD must be at least 8 characters")

    username = args.username.strip().lower()
    email = f"{username}@factory.internal"

    user_id = ensure_auth_user(url, service, email, password)

    conn = connect()
    with conn:
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
    print(f"profile ready: username={username} superuser=true")

    status, body = sign_in(url, key, email, password)
    if status != 200:
        sys.exit(f"login check failed [{status}]: {body}")
    print("login verified against the live auth endpoint")

    # A working password is not enough: confirm the session can actually read its
    # own profile as an active superuser, which is what every screen gates on.
    token = body["access_token"]
    status, rows = rest(
        url, key, token,
        "profiles?select=username,is_superuser,is_active&id=eq." + user_id,
    )
    if status != 200:
        sys.exit(f"the new session cannot read its own profile [{status}]: {rows}")
    if not rows:
        sys.exit("the new session reads no profile row — check the RLS policies")
    row = rows[0]
    if not (row.get("is_superuser") and row.get("is_active")):
        sys.exit(f"profile is not an active superuser: {row}")
    print(f"permissions verified: username={row['username']} superuser={row['is_superuser']}")

    print(f"\nlog in with username '{username}' and the password you set.")


if __name__ == "__main__":
    main()
