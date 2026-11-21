# Project State

> Updated after every module. Prototype-era state stays in
> `docs/PROTOTYPE_STATE_v1.md` and `docs/PROTOTYPE_AUDIT_REPORT.md` (still the
> reference for protected features and known prototype bugs).

## 1. Current architecture

Running today: a no-build PWA (vanilla JS, Arabic RTL, English digits, `ج.م`)
served by `server.js` (Node, no dependencies), which injects `/config.js` from
environment variables. The browser talks to Supabase PostgREST directly through
`preview/db.js` — one `public.rpc_*` call per action, session JWT for identity.

`tools/preview_server.py` is a dev-only alternative: it serves the same `preview/`
folder and mimics the `/api/*` contract against a local Postgres, so the UI can be
driven without a Supabase project (`PREVIEW_AS=<profile-id>` to see a non-admin's
view). The shipped frontend does not use it.

The prototype in `prototype/factory-demo.html` (localStorage) is kept only as a UX
and business reference. It is not part of the product and is not migrated.

Layer rules, table list and relationships: `docs/ARCHITECTURE.md`.

## 2. Database schema

32 tables (30 business tables + 2 counter tables), 12 views, 14 migration files in `supabase/migrations/`
(0001 core → 0014 users and view security). 38 `rpc_*` functions.

Balances are never stored. `v_account_balances`, `v_stock_balances`,
`v_customer_fabric_balances`, `v_workers` and `v_order_costing` compute everything
from ledger rows.

## 3. Implemented modules

Core (gap-free codes, audit, append-only guards) · Identity (profiles, roles, 65
permissions, per-user grants/denies) · Master data (customers with operating letter,
accounts, warehouses, items, machines, employees, piece rates) · Production orders
with stage-template snapshots · Fabric receiving and cutting into bundles ·
Work assignment, claim, receive (accepted/rejected/rework) with wage snapshot ·
Supplies (purchase, customer-owned receipt, issue, transfer, stock) ·
Cash and bank ledger with reversal · Expenses · Deliveries and customer returns ·
Reports and analytics views · Audit log screen · CSV import · **User administration**
(create a login, assign role templates, per-permission grant/deny overrides, disable a
login; one login per employee, enforced by a unique index).

## 4. Not built yet

- Customer invoices and payments (customer balance is currently derived, not invoiced).
- Payroll run and salary allocation (piece rates are recorded; the monthly run is not).
- Barcode scanning and label printing.
- Offline/PWA install (the manifest is in place; the service worker is not).
- **A real Supabase deployment.** This is the one open blocker: see §7.

## 4b. Deployment status (verified 2026-11-20)

| Layer | State |
|---|---|
| Schema + RPCs | **verified** — 14 migrations and 176 assertions pass on a local Postgres with the Supabase shim |
| PostgREST behaviour | **verified** — 12 views, 35 whitelisted names, 39 RPC call sites, arg names all match signatures |
| RLS | **verified** — a worker JWT gets `[]` from `financial_transactions` and `v_account_balances` while an admin sees the rows |
| `server.js` | **verified** — serves the shell, `app.js`, `db.js`, `manifest.json`, `/config.js`, `/healthz` |
| Supabase project | **deployed** — 14 migrations applied, admin seeded, smoke test exits 0 |

Deployed on 2026-11-20. Project region is `aws-1-eu-west-1`; the direct
`db.<ref>.supabase.co` host has no IPv4 record, so connect through the pooler
as `postgres.<ref>` on `aws-1-<region>.pooler.supabase.com:5432`.
`tools/seed_essentials.sql` was run once to create the default stage template,
two accounts and three warehouses. The admin login is `admin`; its password is
not recorded in this repository (it is public) — it lives in the password
manager and in the Railway variables.

## 5. Permissions

65 codes in 9 groups, stored in `permissions` (data, not code). `has_permission(code)`
= active profile AND (superuser OR ((role grant OR user grant) AND NOT user deny)).
Enforced in the frontend, in RLS SELECT policies, and at the top of every `rpc_*` via
`fn_require_permission`. Default grants beyond the admin role are an OPEN BUSINESS
DECISION (`docs/OPEN_BUSINESS_DECISIONS.md`).

## 6. Business rules (encoded in the database)

Codes from atomic counters (CUS/EMP/PO/MCH/ITM/WH/ACC/BND/DLV/RET), gap-free ·
operational code = letter + size + serial, unique, never reused · balances computed
from transactions, never stored · negative stock blocked by a row lock, never by a
read-then-write check · idempotency key on every posting · corrections only by
reversal (once, with a reason) · ledgers and audit log append-only · customer-owned vs
factory-owned stock separated by CHECK · pay terms effective-dated ·
business date uses `Africa/Cairo`.

## 7. Protected features (behaviour to keep)

Operational code format · user-typed sizes and colours per order · fabric movements by
colour and customer including returns · cutting by colour × size with bulk apply, bag
size and a partial last bundle · workflow snapshot with dependencies and stage
deadlines · handover blocking rules · wage snapshot per transaction · worker ledger
with date filter · advances with "deduct from" · cash/bank ledgers that never go
negative · materials and shipping with an expense description · expense categories ·
machines and maintenance · individual permission checklist · Egyptian-Arabic labels,
English digits, `ج.م`, Times New Roman. Full list: `docs/PROTOTYPE_AUDIT_REPORT.md` §20.

## 8. Known issues

- `tests/integration/` is stale: it was written against an abandoned API
  (`rpc_create_financial_account`, `rpc_my_permissions`, `fn_bootstrap_first_admin`)
  that no longer exists. It must be rewritten or deleted before it can be trusted.
- Operational letters are A–Z minus I/L/O, so 23 customers is the cap by design.
- RLS has no write policies at all, which is intentional; the broad table-level GRANTs
  in 0007 are vestigial and harmless but could be revoked for tidiness.
- Prototype bugs stay documented and unfixed in `prototype/` on purpose; the new
  architecture fixes them rather than patching them.

## 9. Migration status

Foundation migrations apply cleanly to a fresh PostgreSQL 15 (verified). Nothing has
been deployed to a hosted Supabase project yet, so Supabase Auth, Storage, Edge
Functions and PostgREST are unverified.

## 10. Test status

| Area | Executed | Result |
|---|---|---|
| Static SQL sanity (`tools/static_sql_check.py`) | yes | clean — 19 files, 47 functions, 31 error codes |
| pgTAP: 001_core (63), 002_bundle_queue (30), 003_supplies (22), 004_master_writes (18), 005_users (43) | yes | **176/176 assertions pass** |
| All 14 migrations apply on a fresh Postgres 15 | yes | OK, and 0013 is re-runnable |
| Concurrency (`tools/run_concurrency_local.sh`) | yes | stock race 10/10, idempotency 1 insert + 9 replays |
| Browser sweep of all 20 SPA routes | yes | every route renders |
| End-to-end UI flows (order → cut → assign → receive → deliver → return) | yes | verified in the browser |
| User admin in the browser (create login from worker screen, permission matrix, deny override, nav gating) | yes | verified; override enforced by `has_permission` |
| Worker pay isolation with real ledger rows | yes | worker sees own 1,200 only; colleague's 500 invisible |
| `tests/integration/` (Supabase) | **no** | stale, needs rewrite |
| Real Supabase project / Edge Functions | **no** | not deployed |

UI coverage: all 38 RPCs and all 12 views are reachable from `preview/app.js`.

## 11. Next recommended step

1. Rewrite or delete `tests/integration/` so the suite stops referencing a dead API.
2. Deploy to a real Supabase project and re-run the pgTAP suite there, plus the
   `admin-create-user` edge function (written but never deployed).
3. Then settle `docs/OPEN_BUSINESS_DECISIONS.md`.

## 12. Fixed defects (verified)

- `rpc_create_warehouse` defaulted `p_kind` to `'factory'`, violating
  `warehouses_kind_check` — every "add warehouse" call failed. Default is now
  `'factory_consumables'`; an unknown kind raises `E_BAD_KIND`.
- `pageTemplates` read `t.name` instead of `name_ar`, so template names rendered blank.
- Bundle statuses `finished`/`delivered` had no Arabic label and leaked English.
- Accounts could only be created by seed SQL: `account.create` existed as a permission
  but had no RPC. Added `rpc_create_account` / `rpc_update_account`.
- Items, warehouses, machines and employees were create-only. Added
  `rpc_update_item`, `rpc_update_warehouse`, `rpc_update_machine`,
  `rpc_update_employee`, each wired to an edit control in the UI.
- Items, warehouses, machines and accounts had no audit trail. Migration 0013 attaches
  the existing `fn_audit_row` trigger to all four.
- `docs/ARCHITECTURE.md` described a schema that was never built
  (`production_transactions`, `employees.full_name`, `item_cost_history`,
  `permissions.key`). Rewritten from the live database.
- A failed `rpc_create_profile` left an orphan `auth.users` row behind, burning the
  username and leaving an account that could never log in. The preview endpoint now
  deletes the login on failure, mirroring the edge function, and reports a leftover
  duplicate as `E_USERNAME_TAKEN` instead of a raw `E_DB`.
- `tools/run_db_tests_local.sh` assumed Docker bridge networking. In sandboxes where
  the published port never opens it now retries with `--network host` (the preview
  server reaches that database on 5432 via `PREVIEW_DSN`).
- The one-login-per-employee rule was only tested through `rpc_create_profile`. A new
  assertion proves the `profiles_employee_id_key` unique index rejects a direct insert,
  so the rule survives code that bypasses the RPC.
