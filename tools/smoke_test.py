#!/usr/bin/env python3
"""Smoke test for a DEPLOYED instance: checks the server and the Supabase project behind it.

    python3 tools/smoke_test.py https://your-app.up.railway.app

Verifies, in order:
  1. /healthz answers ok
  2. /config.js serves a URL and a publishable key (never a service_role key)
  3. the app shell and db.js are served
  4. Supabase Auth is reachable and rejects a bad login
  5. the schema is present (permissions table readable with the publishable key)

Exit code 0 means every check passed. No credentials beyond the publishable key
are needed — the key is read from the deployed /config.js, which is public by design.
"""

import json
import re
import sys
import urllib.error
import urllib.request

TIMEOUT = 20


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            return res.status, res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except urllib.error.URLError as exc:
        return 0, str(exc.reason)


def post(url, payload, headers=None):
    data = json.dumps(payload).encode()
    hdrs = {"Content-Type": "application/json"}
    hdrs.update(headers or {})
    req = urllib.request.Request(url, data=data, method="POST", headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            return res.status, res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except urllib.error.URLError as exc:
        return 0, str(exc.reason)


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: smoke_test.py <base-url>")
    base = sys.argv[1].rstrip("/")

    failures = []

    def check(name, ok, detail=""):
        print(("  PASS  " if ok else "  FAIL  ") + name + (("  — " + detail) if detail and not ok else ""))
        if not ok:
            failures.append(name)

    print(f"smoke test: {base}\n")

    status, body = get(base + "/healthz")
    check("/healthz returns ok", status == 200 and body.strip() == "ok", f"status={status}")

    # The service worker is what makes the app open offline. If it 404s the
    # browser silently degrades to online-only, so check it explicitly.
    status, sw = get(base + "/sw.js")
    check("/sw.js is served", status == 200, f"status={status}")
    if status == 200:
        check("/sw.js never caches cross-origin API calls",
              "url.origin !== self.location.origin" in sw,
              "missing the same-origin guard")
        check("/sw.js ignores query strings when caching",
              "pathname" in sw and "keyOf" in sw,
              "cache key must drop ?v= or offline lookups miss")

    status, config = get(base + "/config.js")
    ok = status == 200
    check("/config.js is served", ok, f"status={status}")
    if ok:
        url_m = re.search(r'OB_SUPABASE_URL\s*=\s*"([^"]+)"', config)
        key_m = re.search(r'OB_SUPABASE_KEY\s*=\s*"([^"]+)"', config)
        check("/config.js has a Supabase URL", bool(url_m))
        check("/config.js has a key", bool(key_m))
        check("/config.js never ships a service_role key", "service_role" not in config)
        if key_m and key_m.group(1).startswith("eyJ"):
            try:
                import base64
                payload = key_m.group(1).split(".")[1]
                payload += "=" * (-len(payload) % 4)
                role = json.loads(base64.urlsafe_b64decode(payload)).get("role")
                check("shipped key is not service_role", role != "service_role", f"role={role}")
            except Exception:
                pass
        sb_url = url_m.group(1) if url_m else ""
        sb_key = key_m.group(1) if key_m else ""
    else:
        sb_url = sb_key = ""

    for asset in ("/", "/app.js", "/db.js"):
        status, _ = get(base + asset)
        check(f"{asset} is served", status == 200, f"status={status}")

    if sb_url and sb_key:
        status, body = post(
            sb_url + "/auth/v1/token?grant_type=password",
            {"email": "smoke-test-does-not-exist@factory.internal", "password": "wrong-password-xyz"},
            {"apikey": sb_key},
        )
        check("Supabase Auth rejects a bad login", status in (400, 401, 422), f"status={status}")

        status, body = get(
            sb_url + "/rest/v1/permissions?select=code&limit=1",
            {"apikey": sb_key, "Authorization": "Bearer " + sb_key},
        )
        schema_ok = status in (200, 206) or (status in (401, 403) and "does not exist" not in body)
        check("schema is deployed (permissions table exists)", schema_ok,
              f"status={status} {body[:120]}")
        if status in (401, 403):
            print("        note: anon read denied by RLS — expected if policies require a session")

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s) — {', '.join(failures)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
