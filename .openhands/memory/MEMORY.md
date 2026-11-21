# Project Memory Index

## Garment Factory (CMT, Egypt) — `/workspace/project`
Arabic RTL PWA cloning a deployed reference app. No build step: vanilla JS in
`preview/`, served by `tools/preview_server.py` (`/api/rpc` → one `public.rpc_*`).
DB: PostgreSQL 15 via `supabase/migrations/` (0001 → 0013).

**Run/verify**
- DB tests: `./tools/run_db_tests_local.sh` — add `--keep` or the `gfspg`
  container is destroyed and follow-up psql fails.
- Concurrency: `./tools/run_concurrency_local.sh`
- Static: `python3 tools/static_sql_check.py`
- Syntax: `node --check preview/app.js`

**Shape (verify, don't assume)**: 32 tables, 11 views, 31 `rpc_*`, 13 migrations,
133/133 pgTAP assertions.

**Invariants**
- Balances are never stored; views aggregate ledger rows.
- RLS has SELECT-only policies — direct writes fail even where GRANTs exist.
  Every write goes through `rpc_*` (`security definer` + `fn_require_permission`).
- Corrections are reversal rows; ledgers and `audit_log` are append-only.
- `fn_audit_row` is `security definer`, so attaching it needs no grants.
  Attached to customers, employees, production_orders, items, warehouses,
  machines, financial_accounts.

**Traps**
- `docs/ARCHITECTURE.md`, `PROJECT_STATE.md`, `docs/CHANGELOG.md` were largely
  fiction until 2026-11-20 (described tables that were never built). Trust the
  migrations and the live DB over any prose doc; re-check before citing.
- `tests/integration/` targets a dead API and has never run.

**Biggest gap**: no user-administration RPC (create profile, assign role, set
grant). The users screen is read-only.

See `2026-11-20.md` for detail and the traps that cost time.
