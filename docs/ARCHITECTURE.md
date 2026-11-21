# Architecture — Garment Factory (CMT) System

> Status: **implemented and verified against PostgreSQL 15.** Every table, view,
> function and column named below exists in `supabase/migrations/` and is exercised
> by the pgTAP suites in `supabase/tests/`. See `PROJECT_STATE.md` for current test
> counts and `docs/LOCAL_VERIFICATION.md` for how to reproduce them.

## 1. Layers

```
Frontend (PWA, Arabic RTL)      — presentation only; holds no financial/stock/permission rules
   ↓  JSON over HTTP
API layer (preview/db.js)       — PostgREST over HTTPS; one public.rpc_* per action
   ↓  Supabase Auth JWT → role `authenticated` + `sub` claim
RLS (SELECT-only policies)      — every write goes through an rpc_* function
   ↓
PostgreSQL 15                   — constraints, CHECKs, code_counters, triggers
   ↓
Ledgers (append-only)           financial_transactions · inventory_transactions
                                work_assignments · customer_fabric_movements
                                (corrections are reversal rows; balances are views)
   ↓
Audit layer                     audit_log (append-only, filled by row triggers)
```

Rules that follow from this:

1. The database is the single source of truth. No balances are stored; every balance
   is computed by a view over ledger rows.
2. The `authenticated` role has **SELECT-only policies**. There are no INSERT/UPDATE/
   DELETE policies on any table, so a direct write fails with
   `new row violates row-level security policy` even though a table-level GRANT exists.
   All writes go through `rpc_*`.
3. `rpc_*` functions are `security definer`, so they write with owner rights and are
   the only write path.
4. Each `rpc_*` starts with `fn_require_permission(...)`, which raises `E_PERM`.

## 2. Tables (all in `public`)

Master data:

| Table | PK | Key columns |
|---|---|---|
| `customers` | `id` | `code CUSxxxx`, `operating_letter` (unique A–Z), `name`, `phone`, `notes`, `is_active` |
| `employees` | `id` | `code EMPxxxx`, `name`, `kind worker\|operations`, `job_title`, `phone`, `hired_on`, `is_active` |
| `employee_pay_terms` | `id` | `employee_id`, `stage_key` (null = default), `piece_rate`, `monthly_salary`, `effective_from` |
| `items` | `id` | `code ITMxxxx`, `name`, `category`, `base_unit`, `is_active` |
| `warehouses` | `id` | `code WHxxxx`, `name`, `kind`, `is_active` |
| `financial_accounts` | `id` | `code ACCxxxx`, `name`, `kind cash\|bank`, `opening_balance`, `is_active` |
| `machines` | `id` | `code MCHxxxx`, `name`, `model`, `purchased_on`, `is_active` |
| `machine_maintenance` | `id` | `machine_id`, `done_on`, `cost`, `description` |

Production:

| Table | PK | Key columns |
|---|---|---|
| `stage_templates` | `id` | `name_ar`, `is_default` |
| `stage_template_stages` | `id` | `template_id`, `seq`, `name_ar`, `code`, `piece_price`, `depends_on[]`, `is_operations`, `is_final` |
| `production_orders` | `id` | `code POxxxx`, `customer_id`, `model_name`, `quantity`, `piece_price`, `order_date`, `due_date`, `status`, `closed_at`, `cancel_reason` |
| `production_order_stages` | `id` | `order_id`, `seq`, `name_ar`, `code`, `piece_price`, `depends_on[]`, `is_operations`, `is_final`, `due_date` |
| `cut_lines` | `id` | `order_id`, `colour`, `size`, `quantity`, `fabric_metres`, `cut_date`, `idempotency_key` |
| `bundles` | `id` | `code BNDxxxx`, `barcode`, `order_id`, `cut_line_id`, `size`, `colour`, `quantity`, `status`, `cut_date` |
| `work_assignments` | `id` | `bundle_id`, `order_id`, `stage_code`, `employee_id`, `quantity`, `assigned_at`, `received_at`, `accepted_qty`, `rejected_qty`, `rework_qty`, `reject_reason`, `piece_rate`, `wage_amount`, `idempotency_key` |
| `deliveries` / `delivery_lines` | `id` | `code DLVxxxx`, `order_id`, `delivered_on`, `notes` / `delivery_id`, `colour`, `size`, `quantity` |
| `customer_returns` | `id` | `code RETxxxx`, `order_id`, `colour`, `size`, `quantity`, `reason`, `disposition rework\|scrap`, `returned_on` |

Ledgers (append-only):

| Table | PK | Key columns |
|---|---|---|
| `financial_transactions` | `id` | `seq`, `account_id`, `amount` (±), `category`, `description`, `txn_date`, `customer_id`, `employee_id`, `production_order_id`, `idempotency_key` (unique), `reverses_id` (unique) |
| `inventory_transactions` | `id` | `seq`, `item_id`, `warehouse_id`, `quantity`, `ownership factory\|customer`, `customer_id`, `production_order_id`, `movement`, `unit_cost`, `txn_date`, `notes`, `idempotency_key`, `reverses_id` |
| `customer_fabric_movements` | `id` | `customer_id`, `colour`, `quantity`, `movement`, `production_order_id`, `txn_date`, `notes`, `idempotency_key` |
| `expenses` | `id` | `account_id`, `category`, `description`, `amount`, `expense_date`, `production_order_id`, `idempotency_key`, `reverses_id` |

Identity and access:

| Table | PK | Key columns |
|---|---|---|
| `profiles` | `id` (= auth user id) | `employee_id`, `username` (unique), `display_name`, `is_active`, `is_superuser`, `last_login_at` |
| `roles` | `key` | `name_ar`, `is_system` |
| `permissions` | `code` | `group_ar`, `name_ar`, `sort_order` |
| `role_permissions` | `(role_key, perm_code)` | |
| `user_roles` | `(profile_id, role_key)` | |
| `user_permissions` | `(profile_id, perm_code)` | `granted bool` — a deny wins |
| `audit_log` | `id` | `actor_id`, `table_name`, `row_pk`, `action`, `diff jsonb`, `created_at` |

Counters: `code_counters(prefix, last_value)` and
`operational_code_counters(letter, size, last_value)`. Both are bumped with an atomic
upsert, so codes are gap-free and race-free.

`operational_codes` registers `code = letter + size + serial`, unique system-wide and
never reused. **Operational code ≠ bundle code (BND) ≠ barcode**; the barcode only
encodes a lookup key and is never the source of truth.

## 3. Views (all `security_invoker`)

`v_account_balances`, `v_stock_balances`, `v_bundles`, `v_bundle_queue`,
`v_customer_fabric_balances`, `v_customers`, `v_order_costing`, `v_order_stages`,
`v_order_timeline`, `v_production_orders`, `v_workers`.

Balances live only here. Nothing stores a running total.

## 4. Relationships

`profiles.id → auth.users.id` · `profiles.employee_id → employees.id` ·
`user_roles → profiles, roles` · `role_permissions → roles, permissions` ·
`user_permissions → profiles, permissions` · `employee_pay_terms.employee_id → employees` ·
`operational_codes.customer_id → customers` · `financial_transactions.account_id →
financial_accounts` · `inventory_transactions → items, warehouses, customers` ·
`work_assignments → bundles, production_orders, employees` · `bundles.order_id →
production_orders` · `cut_lines.order_id → production_orders` ·
`delivery_lines.delivery_id → deliveries` · `customer_returns.order_id → production_orders` ·
`machine_maintenance.machine_id → machines`.

Self-references: `reverses_id` on the three ledgers. Polymorphic columns have no FK by
design: each module must create its document and its ledger row in the same transaction.

## 5. Codes

`fn_next_code(prefix)` → `CUS0001 EMP0001 PO0001 MCH0001 ITM0001 WH0001 ACC0001
BND0001 DLV0001 RET0001`. Operational codes use a separate counter keyed by
`(letter, size)`. Gaps are impossible because the counter row is bumped inside the same
transaction that inserts the document.

## 6. Authentication

`profiles` holds the login identity; `username` is unique and `is_active` gates access.
The preview server issues a session for the seeded admin. `has_permission(code)`
returns false for an inactive profile, so a deactivated user loses access even while
their token is still valid.

## 7. Permissions

`has_permission(code)` = active profile AND (superuser OR ((role grant OR user grant)
AND NOT user deny)). Enforced in three places: the frontend hides controls, the RLS
SELECT policies filter rows, and every `rpc_*` calls `fn_require_permission` first.

The catalog lives in `permissions` (64 codes in 9 groups) — it is data, not code, so a
new permission is an INSERT plus a grant, never a schema change.

## 8. RPC surface (31 functions)

Master data: `rpc_create_customer`, `rpc_update_customer`, `rpc_create_employee`,
`rpc_update_employee`, `rpc_set_piece_rate`, `rpc_create_item`, `rpc_update_item`,
`rpc_create_warehouse`, `rpc_update_warehouse`, `rpc_create_machine`,
`rpc_update_machine`, `rpc_log_maintenance`, `rpc_create_account`, `rpc_update_account`.

Orders and production: `rpc_create_production_order`, `rpc_cancel_production_order`,
`rpc_save_stage_template`, `rpc_execute_cutting`, `rpc_assign_bundle`,
`rpc_claim_bundle`, `rpc_receive_work`.

Supplies and stock: `rpc_purchase_supplies`, `rpc_receive_customer_supplies`,
`rpc_issue_supplies`, `rpc_move_stock`, `rpc_receive_fabric`.

Money and delivery: `rpc_post_cash`, `rpc_reverse_cash`, `rpc_create_expense`,
`rpc_create_delivery`, `rpc_create_customer_return`.

Not yet built: there is no RPC to create a user, assign a role or change a grant.
`profiles`, `user_roles` and `user_permissions` are readable, and the users screen
lists the permission catalog, but changing them today requires SQL. That is the
largest remaining gap in the identity module.

## 9. Idempotency, reversal, concurrency

- Posting RPCs accept a client `idempotency_key`. The same key with the same payload
  returns the original row (`replayed: true`). The key is taken with
  `fn_idempotency_lock`, so concurrent duplicates serialise instead of double-posting.
- Stock issue takes a row lock per (item, warehouse, ownership, customer), so a race
  can never drive a balance negative; the loser gets `E_OVER_ISSUE`.
- Corrections are reversal rows (`reverses_id`, mirrored amount/direction, once only,
  reason mandatory). Originals are never updated or deleted.
- Transfers write two legs under one deterministic group id inside a single call.

`tools/run_concurrency_local.sh` exercises the stock race and the idempotency race and
asserts the exact expected split.

## 10. Audit

Row triggers on `customers`, `employees`, `items`, `warehouses`, `machines`,
`financial_accounts` and `production_orders` write old/new JSON to `audit_log`.
`fn_audit_row` is `security definer`, so the insert succeeds even though the caller has
no direct privilege on `audit_log`. Migration 0013 added the four master-data tables
that previously had no trail.

## 11. Costing and payroll

`employee_pay_terms` gives each worker a piece rate per stage (or a default), effective
from a date. `work_assignments` records the rate and computed `wage_amount` at the
moment work is received, so a later rate change cannot rewrite history.
`v_order_costing` and `v_workers` derive cost and outstanding pay from those rows.
No cost constant lives in code.
