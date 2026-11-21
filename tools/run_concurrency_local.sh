#!/usr/bin/env bash
# Proves the concurrency claims in docs/ARCHITECTURE.md §9 against a real Postgres.
# Starts N parallel psql sessions that hammer the same row and checks the aggregate outcome.
# Requires the local container from tools/run_db_tests_local.sh --keep.
set -uo pipefail
cd "$(dirname "$0")/.."

CONTAINER=gfspg
fails=0

say() { printf '%s\n' "$*"; }
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then say "   ok   $1 ($3)"; else say "   FAIL $1 (expected $2, got $3)"; fails=$((fails+1)); fi
}

psql_() { docker exec -i "$CONTAINER" psql -U postgres -q "$@"; }

run_parallel() { # run_parallel <kind> <n>  -> prints one outcome per session
  local kind=$1 n=$2 i
  for i in $(seq 1 "$n"); do
    docker exec -i "$CONTAINER" psql -U postgres -q -A -t \
      -v kind="$kind" -v n="$i" -f - < supabase/tests/002_concurrency.sql 2>&1 \
      | grep '^RESULT ' | awk '{print $4}' &
  done
  wait
}

say "== fixtures =="
psql_ -f - < supabase/tests/002_concurrency.setup.sql >/dev/null || { say "setup failed"; exit 1; }

say "== stock race: 20 x issue 10 from 100 on hand =="
out=$(run_parallel stock 20)
check "exactly 10 succeed" 10 "$(grep -c '^OK$' <<<"$out")"
check "exactly 10 blocked with E_OVER_ISSUE" 10 "$(grep -c '^E_OVER_ISSUE$' <<<"$out")"
qty=$(psql_ -A -t -c "select coalesce(sum(quantity),0)::int from public.inventory_transactions
  where item_id=(select v::uuid from tests.cc where k='item')
    and warehouse_id=(select v::uuid from tests.cc where k='wh') and ownership='factory'")
check "stock never went negative (exactly the seed remains)" 0 "$qty"

say "== idempotency race: 10 sessions post the same key + same payload =="
out=$(run_parallel idempotent 10)
check "exactly 1 inserts" 1 "$(grep -c '^OK$' <<<"$out")"
check "exactly 9 replay" 9 "$(grep -c '^REPLAY$' <<<"$out")"
run=$(psql_ -A -t -c "select v from tests.cc where k='run'")
rows=$(psql_ -A -t -c "select count(*) from public.inventory_transactions where idempotency_key = 'cc-idem-' || '$run'")
check "exactly one ledger row for the key" 1 "$rows"

say ""
if [ $fails -eq 0 ]; then say "CONCURRENCY: all checks passed"; else say "CONCURRENCY: $fails check(s) FAILED"; exit 1; fi
