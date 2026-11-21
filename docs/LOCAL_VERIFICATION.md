# Local verification (no Supabase project needed)

The repo previously had **zero** runtime proof: the SQL was written but never executed. Two scripts
close that gap using Docker + stock Postgres 15. Neither script touches a real Supabase project.

## Run it

```bash
tools/run_db_tests_local.sh --keep     # shim + 11 migrations + 194 SQL assertions
tools/run_concurrency_local.sh         # 14 multi-session race checks
```

Expected tail of the first script:

```
   OK   001_foundation.test.sql  # 0 of 78 assertions failed
   OK   010_phase1.test.sql      # 0 of 29 assertions failed
   OK   011_phase2.test.sql      # 0 of 39 assertions failed
   OK   012_phase3.test.sql      # 0 of 48 assertions failed
```

Expected tail of the second:

```
CONCURRENCY: all checks passed
```

## What the shims are

| File | Purpose |
|---|---|
| `tools/local_supabase_shim.sql` | Creates roles `anon`/`authenticated`/`service_role`, the `auth` schema, `auth.users`, `auth.uid()`, `auth.role()`, `auth.jwt()` and `pgcrypto`. Mirrors what Supabase provides so the migrations can run unchanged. |
| `tools/pgtap_shim.sql` | Implements the 8 pgTAP assertions this repo uses (`plan`, `no_plan`, `ok`, `is`, `isnt`, `matches`, `cmp_ok`, `throws_ok`, `finish`) because `pgtap` is not in the stock Postgres image. Grants execute **only** to those helpers — a blanket grant would hand `anon` execute on `rpc_*` and silently break the "anon cannot call RPC" assertion. |

Both shims are development-only. They are not part of the product and are never deployed.

## Concurrency checks (docs/ARCHITECTURE.md §9)

Each check runs N independent `psql` sessions at the same time against the same rows:

| Race | Sessions | Expected |
|---|---|---|
| stock | 20 × issue 10 from 100 on hand | exactly 10 succeed, 10 × `E_OVER_ISSUE`, stock never negative |
| idempotency | 10 × same key + same payload | 1 insert, 9 `replayed:true`, exactly one ledger row |

Both checks live in `tools/run_concurrency_local.sh`; run it with `--keep` style tooling if you
want the container to survive the run (`tools/run_db_tests_local.sh --keep`).

## What this does NOT prove

- Supabase Auth, Storage, Edge Functions and PostgREST behaviour (no Supabase project here).
- RLS as seen through PostgREST (the shim calls `set_config('role', …)` instead of a real JWT).
- Anything about production data.
