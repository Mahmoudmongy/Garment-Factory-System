# Project State — Foundation phase

> Updated after every module. Prototype-era state is kept in `docs/PROTOTYPE_STATE_v1.md` and `docs/PROTOTYPE_AUDIT_REPORT.md` (still the reference for protected features and known prototype bugs).

## 1. Current architecture
Target (designed, **not executed**): PWA (Arabic RTL, Times New Roman, English digits, `ج.م` small) → supabase-js with user JWT → RLS (SELECT only) + RPC (all writes) → PostgreSQL → append-only ledgers → audit log. Auth = Supabase Auth; storage = private Supabase Storage; business rules in SQL functions. Details: `docs/ARCHITECTURE.md`.
Still running today: **Prototype v1** (`prototype/factory-demo.html`, localStorage). It is the UX/business reference only and is not migrated.

## 2. Database schema
19 tables + 2 views, 8 sequences, 8 migration files in `supabase/migrations/` (core → identity/access → master data → ledgers → RPC → RLS/grants → seed → storage). Table list and relationships: `docs/ARCHITECTURE.md` §2–3.

## 3. Implemented modules (Foundation only — written, NOT executed)
Core (codes, audit, append-only guards) · Identity (employees, profiles, roles, permissions, user overrides, admin safety) · Master data (customers + operational letter, financial accounts, warehouses, items + cost history) · Operational-code registry · Financial ledger (post/reverse, idempotent, no overdraw) · Inventory ledger (receive/issue/return/adjust/transfer/reverse, customer vs factory ownership, no negative stock) · Production ledger (table only) · RLS + grants · Storage bucket + policies · Edge Function `admin-create-user` · Tests (written).

## 4. Pending modules (in dependency order)
Customer financial (invoices/payments) → Production Orders + Workflow templates/snapshots → Fabric receiving / Cutting / Bundles / Barcode / Labels → Work assignment (production posting RPC, rework/reject rules) → Payroll + Incentives → Materials / Expenses / Machines → Finished goods / Delivery / Returns → Costing / Profitability → Reports / Dashboard → PWA / Offline / Scanning. Also: frontend app shell + login screen (not started).

## 5. Permissions
55 dotted keys (`docs/ARCHITECTURE.md` §6, seed in migration 7). Individual grants/denies per user on top of roles. Enforced in RLS + RPC; admin = superuser role. Role defaults beyond admin are an OPEN BUSINESS DECISION.

## 6. Business rules (encoded in the DB)
Codes by sequence (CUS/EMP/PO/MCH/ITM/WH/ACC/BND) · operational code = letter+size+serial, unique, never reused · balances computed from transactions · no negative account balance / stock · idempotency key on every posting · corrections only by reversal (once, with reason) · ledgers/audit append-only · customer-owned vs factory-owned stock separated by CHECK · opening balance locked after first transaction · pay terms effective-dated, no overlap · last admin cannot be removed/deactivated, no self-demotion, no admin escalation · business date uses `Africa/Cairo`.

## 7. Protected features (to be rebuilt on the new architecture, keep behaviour)
Operational code format · user-typed sizes/colors per order · fabric movements by color/customer incl. return · cutting by color×size + bulk apply + bag size + partial last bundle · workflow snapshot with dependencies and stage deadlines · handover blocking rules · wage snapshot per transaction · worker ledger with date filter · advances with "deduct from" + payroll screen + duplicate-period block · cash/bank ledgers with no negative balance · materials/shipping with expense description · expense categories with codes · machines + maintenance · individual permission checklist · Egyptian-Arabic labels, English digits, `ج.م`, Times New Roman. Full list: `docs/PROTOTYPE_AUDIT_REPORT.md` §20.

## 8. Known issues
Prototype (unchanged, documented in the audit): `S.accN` toast failure, rework double-pay, rejected-becomes-accepted, overlapping salary periods, no idempotency, manual QC/delivery counters, UI-only permissions. **Not fixed in the prototype on purpose** — they are fixed by the new architecture, not patched.
Foundation: nothing has been run, so unknown defects are likely (typos, errcode/permission mismatches, `EXECUTE … INTO` on DML in the test helper, PostgREST exposure details). Operational letters: max 23 customers (A–Z minus I/L/O). `production_transactions` has no posting RPC yet. No update RPC for accounts/items/warehouses. No frontend.

## 9. Migration status
Prototype → DB migration: **not started** (plan in `docs/MIGRATION_PLAN.md`). Foundation migrations: **not applied anywhere**.

## 10. Test status
| Area | Written | Executed | Result |
|---|---|---|---|
| Static SQL sanity (`tools/static_sql_check.py`: balanced quotes/parens/`$$`, called functions exist, expected SQLSTATEs raised) | yes | **yes** | passed (proves nothing about runtime) |
| pgTAP: IDs/codes, permissions, RLS, direct-write denial, anon denial, inactive user, financial (balance, idempotency, overdraw, reversal, immutability), inventory (negative stock, ownership, transfer atomicity, reversal), audit (old/new/user/time/reason, immutability), admin safety | yes (`supabase/tests/001_foundation.test.sql`) | **NOT TESTED** | no Postgres available |
| Integration (Supabase): login, session, logout, inactive user, concurrency (20 customers, 30 codes), idempotency under 10 parallel calls, no-overdraw race | yes (`tests/integration/`) | **NOT TESTED** | no project/network |
| Connection to a real Supabase project | `tools/connection-check.html` | **NOT TESTED** | |
| Edge Function | written | **NOT TESTED / NOT DEPLOYED** | |

## 11. Next recommended step
1) Owner creates a **test** Supabase project, follows `docs/SETUP.md`, applies migrations and sends back any error text. 2) Fix whatever fails, run pgTAP + integration tests until green, update section 10. 3) Only then decide on the OPEN BUSINESS DECISIONS (`docs/OPEN_BUSINESS_DECISIONS.md`) and start the next module (Customer financial, then Production Orders).

**FOUNDATION STATUS: NOT READY** — designed and statically checked only; zero runtime verification.
