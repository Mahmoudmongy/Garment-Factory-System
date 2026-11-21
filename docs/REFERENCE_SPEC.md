# Reference app spec (observed 2026-11-20)

Source: https://web-production-e1789.up.railway.app (the user's own deployed app).
Captured by walking every screen as `admin`. This is the target behaviour for the rebuild.

## Navigation (3 groups)

**الشغل اليومي** — الرئيسية · رئيس العمال · أوامر التشغيل · المخزن · المساعدة
**الحسابات** — العملاء · الصنايعية والحسابات · الخزنة والبنوك · المصروفات · المستلزمات
**الإدارة** — الماكينات · لوحة المدير · التقارير · المستخدمون والصلاحيات · استيراد البيانات · سجل التعديلات

## Core domain model (inferred from screens + payloads)

### Customer
`code` (CUS0007), **`operating_letter`** (حرف التشغيل: "M", "AG") — the prefix used to build
operational codes, `name`, `phone`, `total_invoiced`, `paid`, `remaining`, `is_active`.
Invoices/credit-notes/payments hang off the customer.

### Production order
`code` (PO0014), customer, `model_name`, `quantity` (total pieces), `piece_price` (سعر التصنيع
للقطعة = what the factory charges per piece), `order_date`, `due_date`, `notes`,
`status` ∈ {open, completed, cancelled}. Derived: `cut_quantity`, `bundle_count`, `progress%`.

**Order takes a snapshot of a stage template at creation** — later template edits do not
retro-change an existing order.

### Stage template (قوالب المراحل)
Per model ("قميص ★", "جاكت"). Ordered stages, each with:
- `name_ar` (اللياقات), `code` (English, e.g. `collar`), `piece_price` (سعر القطعة)
- **dependencies**: "بتبدأ بعد: اللياقات، الصدر، الضهر" — a stage starts only after its listed
  predecessors are done. Stages with no dependencies can be delivered any time after cutting.
- `due_date` per stage on the order copy.

### Cutting
Order → "قص وعمل شنط": enter sizes (M, L, XL) and colours (أبيض، كحلي), apply → a colour × size
matrix. Then enter quantities and a bundle size (pieces per bundle).
- **Cutting consumes customer fabric by colour** (warehouse movement "قص 100م").
- Each (colour, size) group becomes one or more **bundles**; a bundle carries a *mixed* colour
  label when it spans colours ("ألوان مختلطة إسود 20، كحلي 20").
- Cutting is partial-allowed: PO0014 shows 160 of 240 cut.

### Bundle (شنطة)
`code` (BND0124), `barcode`, size, colour, quantity, current stage, status (شغال), and the
**operational code** range (`MM0001` = operating letter + size + serial).

### Operational code
`<customer operating letter><size><4-digit serial>` — e.g. `MM0001` (M = letter+size prefix),
`ML0001`, `MXL0001`. One per piece; printed on labels.

### Foreman flow (رئيس العمال)
Scan/type bundle code → system says the next operation and piece count → pick stage + worker →
"سلّم الشنطة" (assign). Receiving the same bundle back: enter **accepted / rejected / rework**
(must sum to the delivered qty), a **reject reason** when rejected, then "استلام الشغل".
Wages accrue on **accepted only**. Has "استلام سريع" (quick receive) and offline queueing.

### Warehouse (المخزن)
Customer fabric only, tracked **by colour**: balances table (customer × colour × metres) and a
movement log with types استلام قماش / قص / مرتجع للعميل.

### Workers (الصنايعية والحسابات)
`code` (EMP0007), name, job/role (تعريش), phone, status, **`remaining_due`** (المتبقي له).
Monthly payroll registration; weekly cash-out (سبت→جمعة) with work + advances − deductions.

### Supplies (المستلزمات)
Factory supplies **and** customer-owned supplies (thread/buttons/zipper/packaging/spare parts).
Customer supplies are issued only to that customer's orders and carry no cost.
Actions: شراء مستلزمات · استلام من عميل · صرف مستلزمات.

### Machines (الماكينات)
Machine registry + maintenance records.

### Delivery & returns (inside order)
Ready = passed the final stage. Available = ready − delivered + returned. Delivery permits
(أذونات التسليم) and customer returns (مرتجع العميل) per colour/size.

### Order costing (تبويب التكلفة)
Expected revenue = qty × piece price. Actual revenue = delivered − returned × price.
Costs: wages + materials + shipping + direct expenses + **overhead allocation to finished pieces
per month**. Derived: total cost, cost/piece, expected profit, actual profit.
Drill-down on any cost line shows dated entries.

### Timeline (التايم لاين)
Chronological events per order: created, cut (pieces/bundles), each stage receipt
(accepted/rejected), with actor and timestamp.

### Analytics (لوحة المدير)
Date-range picker. KPI cards: accepted, reject %, finished, delivered, profit of closed orders.
Charts: daily production (accepted vs rejected), stages with most rejects, reject reasons,
weekly finished vs delivered, orders closed in the period.

### Reports (التقارير)
12 reports: worker production · production by stage · defects by stage · defects by worker ·
fabric consumption · production orders · cost & profitability · customer collections ·
customer balances · expenses · payroll · cash/bank movement. Excel export + print. Period presets:
today, yesterday, this/last week, this/last month, this year, custom.

### Permissions (المستخدمون والصلاحيات)
Granular, ~60 codes across: account.*, audit.view, customer.*, dashboard.view, employee.*,
expense.*, inventory.*, machine.*, production.*, reports.view, system.*, worker.*.
Notably `production.self_assign` / `production.self_submit` (worker self-service).

## Gap vs the current build

The current build has orders/stages/bundles/codes and fabric receipts, but lacks:
stage templates with dependencies + per-stage prices; colour-tracked customer fabric and
cutting that consumes it; worker assign/receive (accepted/rejected/rework + reasons) which is the
heart of the app; delivery permits + customer returns; order costing/profitability; machines;
expenses; the 12 reports; the analytics dashboard; audit log; import.
