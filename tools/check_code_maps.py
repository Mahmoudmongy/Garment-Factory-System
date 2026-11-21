#!/usr/bin/env python3
"""Guard against the UI offering a code the database will reject.

The UI keeps a JS map for every coded column (items.category, warehouses.kind,
financial_transactions.category …) so it can show Arabic instead of the raw
code. If a map drifts from the matching CHECK constraint the form silently
sends a value the database refuses with 23514, and the user sees a generic
error. This checks each map's key set against the constraint in the
migrations, both ways: no key the DB would reject, no DB value left unmapped
(unmapped values render as raw English codes in the UI).

    python3 tools/check_code_maps.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = sorted((ROOT / "supabase/migrations").glob("*.sql"))
APP = ROOT / "preview/app.js"


def strip_sql_comments(sql):
    return re.sub(r"--[^\n]*", "", sql)


def constraint_values(sql, table, column):
    """Values of `check (<column> in (...))` for the given table, in file order."""
    body = strip_sql_comments(sql)
    for m in re.finditer(r"create table (?:public\.)?(\w+)\s*\((.*?)\n\);", body, re.S | re.I):
        if m.group(1).lower() != table:
            continue
        cols = m.group(2)
        cm = re.search(
            rf"\b{column}\s+text[^,]*?check\s*\(\s*{column}\s+in\s*\((.*?)\)\s*\)",
            cols, re.S | re.I)
        if cm:
            return set(re.findall(r"'([^']*)'", cm.group(1)))
    return None


def js_map(source, name):
    """Keys of a `const NAME = { key: 'value', ... }` literal in app.js."""
    m = re.search(rf"const {name} = \{{(.*?)\n\}};", source, re.S)
    if not m:
        return None
    return set(re.findall(r"([a-z_][a-z0-9_]*)\s*:", m.group(1)))


# `form` maps build a <select>, so they must equal the constraint exactly.
# `display` maps only translate for reading, so extra legacy keys are fine but
# every value the database can return must have an Arabic name.
CHECKS = [
    ("ITEM_CATEGORIES", "items", "category", "تصنيف الصنف", "form"),
    ("WAREHOUSE_KINDS", "warehouses", "kind", "نوع المخزن", "display"),
    ("TXN_CATEGORIES", "financial_transactions", "category", "تصنيف الحركة المالية", "form"),
    ("MOVES", "inventory_transactions", "movement", "حركة المخزن", "display"),
    ("STATUS", "production_orders", "status", "حالة الأمر", "display"),
    ("STATUS", "bundles", "status", "حالة الشنطة", "display"),
]


def main():
    source = APP.read_text(encoding="utf-8")
    sql = "\n".join(f.read_text(encoding="utf-8") for f in MIGRATIONS)
    problems = []

    for js_name, table, column, label, mode in CHECKS:
        keys = js_map(source, js_name)
        allowed = constraint_values(sql, table, column)
        if keys is None:
            problems.append(f"{js_name}: map not found in preview/app.js")
            continue
        if allowed is None:
            problems.append(f"{table}.{column}: CHECK constraint not found in migrations")
            continue
        if mode == "form":
            for extra in sorted(keys - allowed):
                problems.append(
                    f"{label}: {js_name} offers '{extra}' but {table}.{column} "
                    f"rejects it — the form will fail with 23514")
        for missing in sorted(allowed - keys):
            problems.append(
                f"{label}: {table}.{column} allows '{missing}' but {js_name} "
                f"has no Arabic name — it will render as a raw code")

    if problems:
        print("CODE MAP CHECK: problems found")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(f"CODE MAP CHECK: {len(CHECKS)} maps match the schema")
    return 0


if __name__ == "__main__":
    sys.exit(main())
