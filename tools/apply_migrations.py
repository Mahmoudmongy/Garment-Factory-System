#!/usr/bin/env python3
"""Applies supabase/migrations/*.sql to a real Supabase database, in order, one transaction each.

Usage:
    SUPABASE_DB_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' \
        python3 tools/apply_migrations.py            # apply everything pending
    ... tools/apply_migrations.py --dry-run          # show what would run
    ... tools/apply_migrations.py --status           # show applied / pending only

A bookkeeping table `public.schema_migrations` records which files landed, so re-running
is safe and never re-applies a file. Each file runs in its own transaction: a failure
rolls that file back and stops, leaving the database in the last good state.
"""

import argparse
import hashlib
import os
import sys
from pathlib import Path
from urllib.parse import quote

try:
    import psycopg
except ImportError:
    sys.exit("psycopg 3 is required: pip install 'psycopg[binary]'")

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "supabase" / "migrations"

PROJECT_REF = "xfttxitgwqvqztssbxra"

# Direct connections to db.<ref>.supabase.co are IPv6-only, which fails on hosts
# without IPv6 (GitHub runners, most sandboxes). The pooler is IPv4 and needs
# the user written as postgres.<ref>.
POOLER_REGIONS = [
    "eu-central-1", "us-east-1", "us-west-1", "eu-west-1", "eu-west-2",
    "ap-southeast-1", "ap-northeast-1", "sa-east-1", "ca-central-1",
]

BOOKKEEPING = """
create table if not exists public.schema_migrations (
    filename    text primary key,
    checksum    text not null,
    applied_at  timestamptz not null default now()
);
"""


def candidate_urls():
    """Every connection string worth trying, most likely first."""
    explicit = (os.environ.get("SUPABASE_DB_URL") or "").strip()
    if explicit.startswith(("postgres://", "postgresql://")):
        yield explicit
    elif explicit:
        print("ignoring SUPABASE_DB_URL: it is not a postgres:// connection string")

    password = (os.environ.get("SUPABASE_DB_PASSWORD") or "").strip()
    if not password:
        return

    # Passwords routinely contain @ : / ? # which break URL parsing unless
    # percent-encoded; a raw "@" silently moves the host boundary.
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
    if not (os.environ.get("SUPABASE_DB_URL") or os.environ.get("SUPABASE_DB_PASSWORD")):
        sys.exit(
            "set SUPABASE_DB_URL (postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres)\n"
            "or SUPABASE_DB_PASSWORD — the pooler fallback needs only the password."
        )

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


def checksum(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def load_files():
    files = sorted(MIGRATIONS.glob("*.sql"))
    if not files:
        sys.exit(f"no migrations found in {MIGRATIONS}")
    return files


def applied_map(cur):
    cur.execute("select to_regclass('public.schema_migrations')")
    if cur.fetchone()[0] is None:
        return {}
    cur.execute("select filename, checksum from public.schema_migrations")
    return dict(cur.fetchall())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--status", action="store_true")
    args = ap.parse_args()

    files = load_files()

    with connect() as conn:
        with conn.cursor() as cur:
            if not args.dry_run and not args.status:
                cur.execute(BOOKKEEPING)
                conn.commit()

            done = applied_map(cur)

            pending = []
            for path in files:
                sql = path.read_text(encoding="utf-8")
                ck = checksum(sql)
                if path.name in done:
                    if done[path.name] != ck:
                        print(f"   CHANGED {path.name} (applied as {done[path.name]}, now {ck})")
                        print("           already-applied files must never be edited; add a new migration instead.")
                        return 1
                    print(f"   skip  {path.name}")
                else:
                    pending.append((path, sql, ck))
                    print(f"   {'would apply' if (args.dry_run or args.status) else 'pending  '} {path.name}")

            if args.status or args.dry_run:
                print(f"\n{len(done)} applied, {len(pending)} pending")
                return 0

            if not pending:
                print("\nnothing to do — schema is current")
                return 0

            for path, sql, ck in pending:
                try:
                    cur.execute(sql)
                    cur.execute(
                        "insert into public.schema_migrations (filename, checksum) values (%s, %s)",
                        (path.name, ck),
                    )
                    conn.commit()
                    print(f"   OK    {path.name}")
                except Exception as exc:
                    conn.rollback()
                    print(f"   FAIL  {path.name}")
                    print(f"         {exc}")
                    return 1

    print(f"\napplied {len(pending)} migration(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
