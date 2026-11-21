#!/usr/bin/env bash
# Runs the repo's SQL against a throwaway local Postgres to verify the migrations actually execute.
# Usage: tools/run_db_tests_local.sh [--keep]
# Requires Docker. Nothing here is used in production; Supabase is still the real target.
set -uo pipefail
cd "$(dirname "$0")/.."

CONTAINER=gfspg
IMAGE=postgres:15-alpine
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  docker rm -f "$CONTAINER" >/dev/null 2>&1
  docker run -d --name "$CONTAINER" -p 127.0.0.1:55432:5432 \
    -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres "$IMAGE" >/dev/null
  # initdb starts a temporary socket-only server, so a socket probe succeeds far too early.
  # Probe over TCP instead: that listener only exists once the real server is up.
  ready=0
  for _ in $(seq 1 60); do
    if docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
  done
  # Some sandboxes have no working bridge networking, so the published port never
  # opens. Fall back to host networking, which the preview server reaches on 5432.
  if ! docker port "$CONTAINER" >/dev/null 2>&1; then
    echo "== no bridge networking; retrying with --network host =="
    docker rm -f "$CONTAINER" >/dev/null 2>&1
    docker run -d --name "$CONTAINER" --network host \
      -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres "$IMAGE" >/dev/null
    ready=0
    for _ in $(seq 1 60); do
      if docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=1; break; fi
      sleep 1
    done
  fi
  [ "$ready" = 1 ] || { echo "postgres did not become ready"; exit 1; }
else
  # A kept container from an earlier run already holds the schema. The migrations use plain
  # CREATE TABLE, so re-applying them would fail on "already exists" and look like a regression.
  # Reset the schemas instead of the container: this keeps the port mapping and is much faster.
  echo "== resetting kept container =="
  docker exec -i "$CONTAINER" psql -U postgres -q -c \
    "drop schema if exists public cascade; create schema public;
     drop schema if exists auth cascade;
     drop schema if exists tests cascade;" >/dev/null || exit 1
fi

psql_() { docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

echo "== shim (roles, auth.uid, pgcrypto) =="
psql_ -f - < tools/local_supabase_shim.sql || exit 1

echo "== migrations =="
fail=0
for f in supabase/migrations/*.sql; do
  if out=$(psql_ -f - < "$f" 2>&1); then
    echo "   OK   $(basename "$f")"
  else
    echo "   FAIL $(basename "$f")"; echo "$out" | sed 's/^/        /'; fail=1
  fi
done
[ $fail -ne 0 ] && exit 1

echo "== pgTAP shim =="
psql_ -f - < tools/pgtap_shim.sql || exit 1

# The suites sign in as the seeded admin, so the admin login and reference data
# have to exist first. Business demo data is loaded separately (tools/seed_demo.sql)
# because it would collide with the codes the suites assert on.
echo "== seed =="
psql_ -f - < tools/seed_base.sql || exit 1

echo "== SQL test suites =="
# Each suite opens with `create extension pgtap`, unavailable on stock Postgres; the shim replaces it.
fails=0
for t in supabase/tests/*.test.sql; do
  case "$t" in *002_concurrency*) continue ;; esac   # multi-session, needs its own runner
  out=$(sed '/create extension if not exists pgtap/d' "$t" \
        | docker exec -i "$CONTAINER" psql -U postgres -q -f - 2>&1)
  summary=$(grep -E '^ *# [0-9]+ of [0-9]+ assertions' <<<"$out" | tail -1)
  if grep -q 'not ok' <<<"$out"; then
    echo "   FAIL $(basename "$t")"; grep -E 'not ok|ERROR' <<<"$out" | sed 's/^/        /'; fails=1
  else
    echo "   OK   $(basename "$t") ${summary:-(no summary)}"
  fi
done
[ $fails -ne 0 ] && exit 1

[ $KEEP -eq 1 ] || { docker rm -f "$CONTAINER" >/dev/null 2>&1; }
