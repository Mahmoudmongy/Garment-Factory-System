# Architecture (Foundation) — Factory Management System

> Status: **designed and written, not executed.** No Postgres / Supabase project was available when this was authored, so nothing below has run against a real database. See `PROJECT_STATE.md` → Test status.

## 1. Layers

```
Frontend (PWA, Arabic RTL)          — presentation only; holds NO financial/stock/permission rules
   ↓  supabase-js, user JWT (anon key only)
RLS (SELECT only) + RPC functions   — every write is an RPC: permission check → validation → ledger insert
   ↓
PostgreSQL (constraints, sequences, triggers)
   ↓
Transaction layer   financial_transactions · inventory_transactions · production_transactions
                    (append-only, idempotent, reversal-only corrections, balances = views)
   ↓
Audit layer         audit_log (append-only, filled by triggers + RPC reason)
```

Rules that follow from this:
1. The database is the single source of truth. No `localStorage` state, no stored balances.
2. Authenticated clients have **no INSERT/UPDATE/DELETE privilege on any table**. Writes only through `rpc_*`.
3. Internal posters (`fn_post_financial_transaction`, `fn_post_inventory_transaction`, `fn_generate_operational_code`) are **not** granted to API roles. Module RPCs call them inside the same DB transaction as the source document.
4. Service-role key lives only in Edge Function env / CI env. Never in HTML/JS.

## 2. Tables (all in `public`)

| Table | PK | Key columns | Notes |
|---|---|---|---|
| `employees` | `id uuid` | `code EMPxxxx`, `full_name`, `phone` (required), `phone2`, `status`, `id_document_path` | HR master. No auth data. |
| `employee_pay_terms` | `id` | `employee_id`, `pay_basis`, `salary_amount`, `salary_frequency`, `allocation_frequency`, `effective_from/to` | Effective-dated; no overlap; history immutable (only closing an open term). |
| `profiles` | `id = auth.users.id` | `employee_id` (unique, nullable), `username` (unique), `is_active` | Login identity. Employee may exist without a profile. |
| `roles` | `id` | `code`, `is_superuser`, `is_system`, `is_active` | `admin` is superuser. |
| `permissions` | `key` | dotted key, `module` | Catalog; extensible by INSERT. |
| `role_permissions` | `(role_id, permission_key)` | | |
| `user_roles` | `(profile_id, role_id)` | | Guarded: last-admin / self-demotion triggers. |
| `user_permissions` | `(profile_id, permission_key)` | `effect grant|deny` | Per-user override. Deny wins. |
| `audit_log` | `id bigint` | `user_id`, `employee_id`, `action`, `entity_type/id`, `old_values`, `new_values`, `reason`, `metadata` | Append-only. |
| `customers` | `id` | `code CUSxxxx`, `op_letter` (unique, A–Z minus I/L/O), `phone` optional | |
| `financial_accounts` | `id` | `code ACCxxxx`, `account_type cash|bank|other`, `opening_balance`, `allow_negative` | Balance is computed. Opening balance locks after first transaction. |
| `warehouses` | `id` | `code WHxxxx`, `kind` | |
| `items` | `id` | `code ITMxxxx`, `category`, `base_unit` | Generic item master (fabric, thread, buttons, zippers, lining, packaging, spare parts, other). |
| `item_cost_history` | `id` | `item_id`, `unit_cost`, `effective_date` | Append-only. Written by receipts with a unit cost. |
| `operational_code_counters` | `(customer_id, size)` | `last_serial` | Internal; upsert gives race-free serials. |
| `operational_codes` | `code` | `customer_id`, `letter`, `size`, `serial`, `status`, `bundle_id` (FK later) | `code = letter+size+4-digit serial`, unique system-wide, never reused. |
| `financial_transactions` | `id` | `account_id`, `direction in/out`, `amount>0`, `source_type`, `source_id`, `reverses_id` (unique), `idempotency_key` (unique), `request_hash` | Append-only. |
| `inventory_transactions` | `id` | `item_id`, `warehouse_id`, `txn_type`, `direction`, `quantity>0`, `ownership factory|customer`, `customer_id`, `production_order_id` (FK later), `reverses_id`, `idempotency_key` | Append-only. Customer-owned ⇔ `customer_id` set (CHECK). |
| `production_transactions` | `id` | `txn_type`, `production_order_id`, `bundle_id`, `stage_key`, `employee_id`, `quantity`, `reverses_id`, `idempotency_key` | **Structure only**; posting RPC belongs to the Work Assignment module. |

Views (`security_invoker`): `v_account_balances`, `v_stock_balances`.

## 3. Relationships
`profiles.id → auth.users.id` · `profiles.employee_id → employees.id` · `user_roles → profiles, roles` · `role_permissions → roles, permissions` · `user_permissions → profiles, permissions` · `employee_pay_terms.employee_id → employees` · `operational_codes.customer_id → customers` · `financial_transactions.account_id → financial_accounts` · `financial_transactions.created_by → profiles` · `inventory_transactions → items, warehouses, customers` · `production_transactions.employee_id → employees` · self-references `reverses_id` on the three ledgers. Polymorphic `source_id` columns have no FK by design (source documents arrive with their modules; each module must create the document and the ledger row in the same transaction).

## 4. Codes
DB sequences → `CUS0001 EMP0001 PO0001 MCH0001 ITM0001 WH0001 ACC0001 BND0001` via `fn_next_code(prefix)`. Sequences can have gaps (rollbacks) — by design.
Operational code `NL0001` = customer `op_letter` + size + serial. Generated by `fn_generate_operational_code` (row-locked counter upsert) and registered in `operational_codes` (PK = code ⇒ unique system-wide; also `unique(customer_id,size,serial)`). **Operational Code ≠ Bundle ID (BND) ≠ Barcode**: the barcode will only encode a lookup key, and is never the source of truth.

## 5. Authentication
Supabase Auth, email/password. Username → `<username>@factory.internal` (synthetic mailbox). Self sign-up **must be disabled**; users are created by the `admin-create-user` Edge Function (service key server-side; permission checked by the DB with the caller's JWT; orphan auth user is deleted if profile creation fails). `profiles.is_active=false` ⇒ `has_permission()` is false everywhere (RLS + RPC) even while the JWT is still valid; the function also bans the auth user. "Login as" is **not** implemented.

## 6. Permissions
`has_permission(key)` = active profile AND key exists/active AND (superuser OR ((role grant OR user grant) AND NOT user deny)). Enforced in: frontend (hide), **RLS** (`select` policies), **RPC** (`fn_require_permission` first line). Escalation guards: only an admin can grant/revoke the admin role; you cannot grant a permission you do not hold. Catalog: 55 keys, see `20261019000007_seed.sql`.
Admin safety (triggers): cannot remove your own admin role; cannot remove/deactivate the last active admin; system roles cannot be deleted/changed; profiles cannot be deleted.

## 7. RLS policies (all `FOR SELECT TO authenticated`; no write policies)
profiles (own or `system.user.view`) · employees (`employee.view` or own record) · employee_pay_terms (`worker.payroll.view`) · roles/permissions/role_permissions (any active user) · user_roles/user_permissions (own or `system.user.view`) · audit_log (`audit.view`) · customers (`customer.view`) · financial_accounts + financial_transactions (`account.view`) · items/item_cost_history/warehouses/inventory_transactions (`inventory.view`) · production_transactions + operational_codes (`production.order.view`) · operational_code_counters (none). `fn_apply_grants()` enables RLS on every public table, revokes anon/authenticated privileges, re-grants SELECT, and exposes only `rpc_*` + `has_permission` + `fn_is_active_user`. **Every future migration must end with `select public.fn_apply_grants();`.**

## 8. RPC surface
Identity: `rpc_my_permissions`, `rpc_create_profile`, `rpc_set_profile_active`, `rpc_assign_role`, `rpc_revoke_role`, `rpc_set_user_permission`, `rpc_role_grant_permission`, `rpc_role_revoke_permission`.
Master data: `rpc_create_customer`, `rpc_update_customer`, `rpc_create_employee`, `rpc_update_employee`, `rpc_set_employee_pay_terms`, `rpc_create_financial_account`, `rpc_create_warehouse`, `rpc_create_item`.
Ledgers: `rpc_post_manual_transaction`, `rpc_reverse_financial_transaction`, `rpc_post_inventory_transaction`, `rpc_transfer_inventory`, `rpc_reverse_inventory_transaction`.
Internal (not exposed): `fn_post_financial_transaction`, `fn_post_inventory_transaction`, `fn_generate_operational_code`, `fn_next_code`, `fn_bootstrap_first_admin`, `fn_apply_grants`.

## 9. Idempotency, reversal, concurrency
- Every posting takes a client `idempotency_key` (≥ 8 chars, unique) + server `request_hash`. Same key + same payload ⇒ returns the original row (`replayed:true`). Same key + different payload ⇒ `F0001`.
- Financial: account row `FOR UPDATE` serialises postings per account; the key is re-checked after the lock. Inventory: `pg_advisory_xact_lock` per (item, warehouse, ownership, customer).
- Negative balance/stock blocked (`F0002`/`F0003`) inside the locked section.
- Corrections = reversal rows (`reverses_id`, mirrored direction/amount/account|item/warehouse, once only, a reversal cannot be reversed, reason mandatory). Original rows are never changed (`F0006` triggers on UPDATE/DELETE/TRUNCATE).
- Transfers write two legs under a deterministic group id inside one function call (atomic; retry-safe).

## 10. Audit
Row triggers on every master/identity table (insert/update/delete with old/new JSON) and on ledger inserts; RPCs call `fn_set_reason` so the reason is stored with the same row; `user_id`/`employee_id` come from the JWT. `audit_log` has update/delete/truncate triggers that raise, and no privileges for API roles. (A DB superuser can still disable triggers — out of scope; mitigated by Supabase access control.)

## 11. Storage
Private bucket `employee-documents` (5 MB, jpeg/png/webp/pdf). Path `{employee_id}/{file}`. Policies: select needs `employee.document.view`, insert needs `employee.document.upload`; no update/delete policy. The path is recorded through `rpc_update_employee`. Future buckets (expense receipts, delivery receipts) follow the same pattern.

## 12. Costing / payroll readiness (nothing built)
`employee_pay_terms` (basis, amount, frequency, allocation frequency, effective dates), ledgers with `source_type`/`production_order_id`, `item_cost_history`, and a financial ledger fed by `worker_payment/worker_advance/expense/purchase/maintenance` source types are the hooks. No cost constants live in code: allocation inputs must come from data (production counts, pay terms, expenses by period).
