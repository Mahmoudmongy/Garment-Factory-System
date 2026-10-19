# OPEN BUSINESS DECISIONS (not decided by the author — defaults noted, nothing invented as final)

| # | Decision | Current default in code |
|---|---|---|
| 1 | How is a customer's operational letter chosen? (initial of the Latin name vs automatic) | Admin may pass a letter; otherwise next free letter A–Z excluding I, L, O (prototype behaviour). Cannot be changed later via RPC. |
| 2 | Are voided/expired operational codes ever reused? | Never reused (code stays reserved). |
| 3 | Allowed `employment_type` values | Free text. |
| 4 | Default permissions of roles other than admin (factory_manager, production_manager, foreman, worker, finishing_worker, accountant, storekeeper, quality, viewer) | Conservative seed in migration 7; foreman/worker/accountant follow the earlier spec; others are minimal. |
| 5 | Can a user hold a role while having the head-worker data scope limited to "their" orders / "own work only" for workers? | Not modelled (row-level scoping comes with the Production modules). |
| 6 | Should reversals be blocked when they would make an account negative? | Yes (same rule as normal postings). |
| 7 | Allow negative stock in any case (e.g. emergency adjustment)? | No. |
| 8 | Inventory valuation method (average / FIFO / last cost) | Not applied; only cost history is stored. |
| 9 | Unit master and unit conversions | `base_unit` is text, no conversions. |
| 10 | Stock reservation for production orders | Not modelled. |
| 11 | Transfers between financial accounts | Not modelled (not in the source-type list). |
| 12 | Customer name uniqueness | Not enforced. |
| 13 | Order-specific leftovers: stay reserved or return to general stock | Not modelled (Materials module). |
| 14 | Can an admin deactivate themselves while other admins exist | Allowed; removing own admin ROLE is blocked. |
| 15 | Opening balance changes after transactions | Blocked; use an adjustment transaction. |
| 16 | Supplier master | Not modelled. |
