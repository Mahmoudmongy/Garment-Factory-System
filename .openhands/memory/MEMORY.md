# Project Memory Index

## Garment Factory (CMT, Egypt) — `/workspace/project`
Arabic RTL PWA cloning a deployed reference app. No build step: vanilla JS in
`preview/`, served by `tools/preview_server.py` (`/api/rpc` → one `public.rpc_*`).
DB: PostgreSQL 15 via `supabase/migrations/` (0001 → 0018).

**Run/verify**
- DB tests: `./tools/run_db_tests_local.sh` — add `--keep` or the `gfspg`
  container is destroyed and follow-up psql fails.
- Concurrency: `./tools/run_concurrency_local.sh`
- Static: `python3 tools/static_sql_check.py`
- Syntax: `node --check preview/app.js`

**Shape (verify, don't assume)**: 32 tables, 5 `v_*` views in migrations,
41 `rpc_*`, 18 migrations. All 18 are applied on the live DB as of 2026-11-21;
0015–0018 landed via the `apply-migrations.yml` workflow.

**CI/CD**: DB password secret is `DATABASE_PASSWORD` (not `SUPABASE_DB_URL`,
which holds an https URL, not a connection string). The password needs
percent-encoding; `db.<ref>.supabase.co` is IPv6-only, so use the IPv4 pooler as
`postgres.<ref>` (`aws-1-eu-west-1` works). Migrations apply from the
`apply-migrations.yml` workflow. The Cloudflare token verifies but reaches zero
accounts, so Pages is unreachable until it gets `Account → Cloudflare Pages →
Edit`; `garment-factory.pages.dev` is live but stale (v1 vs repo v6).

**Deploy gap**: the secrets are not in the sandbox and `db.<ref>.supabase.co`
does not resolve from it, so migrations must be applied from CI.
`tools/apply_migrations.py` (`--status`, `--dry-run`) needs `psycopg`.

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

**User admin**: `0014_users_and_view_security.sql` supplies `rpc_create_profile`,
`rpc_update_profile`, `rpc_set_user_roles`, `rpc_set_user_permissions` and
`rpc_my_permissions`; the Auth user itself comes from the `admin-create-user`
edge function (`supabase/functions/`), since only the service key can create one.
So the users screen is NOT read-only anymore — earlier notes saying so are stale.

See `2026-11-20.md` for detail and the traps that cost time.

## Hard-won facts
- Cloudflare deploy workflow must gate on the credential check, or every PR
  fails: `wrangler` exits 1 when `CLOUDFLARE_API_TOKEN` is unset.
- Dialog masks need `tabIndex = -1` + `focus()` for an Escape `keydown` listener
  to fire; attaching the listener alone does nothing.
- Platform reserves ports 12000/12001; test harnesses should use 12009+.
- `gh` needs `GH_TOKEN=$GITHUB_TOKEN`; that token can push but has no Secrets scope.
- Admin login is `admin` → `admin@factory.internal` (the app appends the domain
  in `db.js:emailFor`). Created by `.github/workflows/create-admin.yml`.
- Supabase `/auth/v1/signup` REJECTS `@factory.internal` (`email_address_invalid`),
  so the first user must be made through the Admin API with the service-role key.
- No RLS policy grants insert/update on `public.profiles`; the profile row must be
  written over a direct DB connection, not from the client.
- Run locally: `printf 'SUPABASE_URL=...\nSUPABASE_PUBLISHABLE_KEY=...\nPORT=12000\n' > .env.runtime`
  then `set -a && . ./.env.runtime && set +a && node server.js`. `.env.runtime` is gitignored.
