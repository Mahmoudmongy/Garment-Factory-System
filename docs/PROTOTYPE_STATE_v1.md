# Project State

> Update this file after EVERY module. Full evidence and test results: `AUDIT_REPORT.md`.
> Rule: read this file before touching anything. Never create a second customer / employee / auth / inventory / ledger system.

## Current Version
Prototype v1 (audited 2026-10-19). Single file `factory-demo.html`: 2 inline scripts (script 1 = original ~17 KB, mostly overridden; script 2 = upgrade ~40 KB). Published as a Claude artifact. State is one JSON object `S` in `localStorage` key `gf1` (flag `S.v2=1`). Level: **Functional prototype**. NOT backend-connected, NOT production-ready.

## Existing Modules
Dashboard (partial) · Customers (partial) · Production Orders (partial) · Warehouse "المخزن" = customer fabric (partial) · Cutting (partial) · Bundles + operational codes (partial) · Barcode (prototype only) · Label print preview (partial) · Head worker handover (partial) · Employees/workers + ledger (partial) · Payroll "صرف الأجور" (partial) · Incentives (prototype only) · Materials (partial) · Expenses (partial) · Machines + maintenance (partial) · Accounts cash/bank (partial) · Costing/profit (prototype only) · QC + delivery (prototype only) · Permissions (UI only) · Audit log (partial) · Worker self screen (partial).

## Completed
Nothing is "Complete" (no backend, no auth, no automated tests).

## Partial (works with real logic inside the prototype)
- Order creation with user-typed sizes/colors; per-order workflow snapshot `o.wf` with dependencies `dp[]` and stage deadlines.
- Fabric movements `S.fb` (receive many colors / issue at cutting / return to customer); balance computed per customer+color; overdraw blocked.
- Cutting by color×size, bulk-apply with confirm, bag size per size, partial last bundle; operational code `letter+size+0001` unique across all bundles.
- Handover: bundle assignment with dependency check, one holder per bundle, duplicate submit blocked.
- Wage per accepted piece snapshotted into `S.t[].amt`.
- Worker balance computed (`pay()`), advances/partials with "deduct from", period settlement with account + "تم القبض", same-period duplicate blocked, negative account balance blocked.
- Cash ledger `S.led`; balances computed.
- Materials/shipping with description; expense categories `CATnn`; machines `MCH000n` + maintenance linked.

## Missing
Auth/users/passwords · backend/DB/API · real permission enforcement · invoices · customer returns · delivery notes/cartons · finished-goods ledger · items master (ITM) · warehouses (WH) · material stock movements · garment model catalog · route template editor · quality/rework entities · incentive rule engine · per-worker/operation/model rates · employment start date/status · add-machine/add-account screens · reversal/void/adjust · reports with date filters · PDF/Excel export · real barcode (Code128/QR) + camera scan · PWA/offline/sync · automated tests · edit order with old/new log.

## Database Entities
No database. Collections in `S`: `c` customers · `w` employees (+workers/staff, `role` string) · `pm` perms {empId:[keys]} · `o` orders (`wf[]` snapshot) · `b` bundles · `t` work transactions · `l` worker ledger entries (adv/part/sal/bon) · `pp` settled-period keys · `ac` accounts · `led` cash ledger · `fb` fabric movements · `m` material purchase lines · `sh` order shipping/extra costs · `x` expenses · `cat` expense categories · `mc` machines · `mt` maintenance · `lg` audit log · `sn` code counters · config `tgt, salaries, units` · **UI state stored inside S:** `me, sel, mx, ax, ns, nc, gs, gc, df, dt, pf, pt, wq`.

## Relationships (by convention in code, no constraints)
`o.c→c.id` · `b.po→o.id` · `b.cur.w→w.id` · `t.w→w.id`, `t.b→b.code`, `t.po→o.id` · `l.w→w.id`, `l.acc→ac.id` · `led.a→ac.id` (no source id) · `fb.c→c.id` · `m.po/sh.po→o.id` · `x.acc→ac.id` · `mt.mc→mc.id` (0 = general) · `mc.wk→w.id` · `pm[empId]→w.id` · `c.p[].acc→ac.id`.

## Authentication
None. "دخول كـ" dropdown sets `S.me` (persisted). No passwords, no sessions. Usernames are plain fields on `w`. **Not suitable for final app → Supabase Auth + `profiles` linked to employees.**

## Permissions
Per-employee checklist `S.pm`. 14 coarse keys: `dash, cust, custfin, ord, fab, head, wfin, pay, exp, mach, acc, prof, perm, me`. Enforced only by hiding tabs (`TB`) and wrapping selected `window` functions (`GD`). Inner functions callable directly (tested). Unguarded: `qc`, `dlv`, `addCat`, `bulk`, inline `onchange` handlers for `tgt/salaries/units`. Head worker (`id 0`) has `dash` → sees receivables, wages due, expenses, account balances (violates spec). Admin can remove own `perm`. Target: dotted keys (`production.order.create`) enforced in RLS + RPC.

## Financial Transactions
Cash accounts: balance computed from `led` (in − out) ✔. Dual-write: `c.p`, `x`, `mt`, `m/sh`, `l` also write `led` with no shared id (risk of divergence). Worker balance computed from `t` + `l` + `open` ✔ (flags `t.s`, `l.used` mutate history). Customer: `inv` is a stored number, balance = inv − payments (no invoice entity). Negative account balance blocked on outflows. No reversal/void.

## Inventory Transactions
Only fabric (`S.fb`) is transaction-based. Materials = stored counters (`q`,`u`), consumption typed by hand, `u > q` accepted. Finished goods = counters `o.fin`, `o.dl` (not tied to production; `qc` works on an uncut order). No warehouses, no items, no rolls balance.

## Protected Features
(Do not break/rewrite without approval — full list in AUDIT_REPORT §20) operational code format & uniqueness · user-typed sizes/colors · fabric ledger · cutting + bundles · workflow snapshot + dependencies + stage deadlines · handover blocking rules · wage snapshot per transaction · worker ledger with date filter · advances "deduct from" + payroll screen + duplicate-period block · computed account balances + negative-balance blocks · materials/shipping/expenses/machines flows · individual permission checklist (concept) · Egyptian Arabic labels, English digits with tiny `ج.م`, Times New Roman, demo reset button.

## Technical Debt
Critical: (1) `S.accN` undefined after first load/reset → success toasts throw AFTER state is written; (2) rework + rejected quantities mis-handled (double pay, rejects re-accepted downstream); (3) no backend/auth. High: overlapping-period salary double pay; no idempotency (double-click = 2 payments); QC/delivery counters not tied to production; dual-write ledger; customer invoices as one number; no item master; confidential data on dashboard; unguarded functions. Medium: hard-coded constants (bonus 0.5, `TPL`, salary divisors 30/7/26, order numbering from 15, bag 25); manual cost allocation (`salaries/units`, electricity uses ALL expenses); audit lacks old/new/reason and logs failed attempts; array-index IDs; UI state in data; re-render clears forms on any error; duplicate legacy script; `today()` uses UTC; `save()` swallows quota errors; non-standard barcode. Low: self-lockout, truncated bundle lists, `print()` untested.

## Current Development Stage
Audit & architecture lock (no code changed). Waiting for owner approval of architecture and roadmap.

## Next Module
Phase 0 (after approval): fix Critical/High prototype bugs (items 1, 2, overlap salary, idempotency) — then Phase 1 Core (Supabase project, Auth, employees/profiles, permission catalog, audit_log, code sequences CUS/EMP/PO/MCH/ITM/WH/ACC/BND).

## Known Issues
1. After first load or "إعادة ضبط": `addPay`, `addL`, `doSettle`, `addM`, `addX`, `addMc` throw at the success message (`S.accN`) after writing data → no feedback; user may repeat. Works after a page reload (state loaded from storage gets the helper).
2. Rework: bundle returns to same stage and can be re-submitted with full qty (tested: 45 paid for a 25-piece bundle).
3. Rejected pieces are accepted again at the next stage (tested).
4. Overlapping settlement periods pay the salary twice (tested: 2571 + 2314).
5. Two quick clicks on "تسجيل دفعة" without a reference = two payments (tested).
6. Quality approval accepted on an order with no cutting (tested).
7. Material `used` can exceed `purchased` (tested).
8. Any validation error clears the form (including the chosen ID-card file).
9. Bundles list silently truncated (60 / 40 rows).
10. Unverified (not tested): Android layout, label printing, barcode readability, localStorage quota with many ID photos, UTC date offset after midnight.

## Architecture Decisions
(PROPOSED — pending owner approval; nothing implemented)
- Supabase Postgres + RLS; business operations as Postgres RPC functions (transactional, security definer); frontend holds no financial logic.
- Append-only ledgers: `financial_transactions`, `inventory_transactions`, `production_transactions`; balances are Views; corrections = reversal entries with reason.
- One audit table (`audit_log`: user, time, action, entity, old, new, reason) filled by triggers/RPC.
- Codes from DB sequences: `CUS/EMP/PO/MCH/ITM/WH/ACC/BND` + `NL0001`-style operational code; operational code unique scope: all bundles.
- Permission keys dotted strings, per-employee assignment, checked in RLS and RPC.
- ID-card images and receipts in private Storage buckets.
- Workflow templates in DB; orders keep immutable snapshots.
- Roadmap order: 0 Fixes → 1 Core → 2 Master data → 3 Ledgers → 4 Customer financial → 5 Orders+Workflow → 6 Fabric/Cutting/Bundles/Barcode → 7 Work assignment → 8 Payroll/Incentives → 9 Materials/Expenses/Machines → 10 Finished goods/Delivery/Returns → 11 Costing → 12 Reports/Dashboard → 13 PWA/Offline/Scanning.
