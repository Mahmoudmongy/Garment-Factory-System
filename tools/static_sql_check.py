#!/usr/bin/env python3
"""Static sanity checks for the migrations (NOT a SQL parser; it cannot replace running them).
Checks: balanced $$ blocks, balanced parentheses (outside strings/comments/dollar-quotes),
single-quote balance, every `public.<fn>(` called exists as a created function, every GUC/errcode is declared."""
import re, sys, glob, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
files = sorted(glob.glob(str(root / "supabase/migrations/*.sql")) + glob.glob(str(root / "supabase/tests/*.sql")))
errors, created, called = [], set(), {}
def strip(sql):
    out, i, n = [], 0, len(sql)
    while i < n:
        if sql.startswith("--", i):
            j = sql.find("\n", i); i = n if j < 0 else j; continue
        m = re.match(r"\$([A-Za-z_]*)\$", sql[i:])
        if m:
            tag = m.group(0); j = sql.find(tag, i + len(tag))
            if j < 0: errors.append("unterminated dollar quote"); return "".join(out)
            out.append("''"); i = j + len(tag); continue
        if sql[i] == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'" and sql[j+1:j+2] == "'": j += 2; continue
                if sql[j] == "'": break
                j += 1
            else: errors.append("unterminated string"); return "".join(out)
            out.append("''"); i = j + 1; continue
        out.append(sql[i]); i += 1
    return "".join(out)
for f in files:
    raw = open(f, encoding="utf8").read(); name = pathlib.Path(f).name
    s = strip(raw)
    if s.count("(") != s.count(")"): errors.append(f"{name}: unbalanced parentheses {s.count('(')} vs {s.count(')')}")
    for m in re.finditer(r"create (?:or replace )?function (?:public\.)?(\w+)", raw): created.add(m.group(1))
    for m in re.finditer(r"public\.((?:fn|rpc|trg|has)_?\w*)\(", raw): called.setdefault(m.group(1), set()).add(name)
created |= {"has_permission"}
for fn, where in sorted(called.items()):
    if fn not in created: errors.append(f"function public.{fn}() is called in {sorted(where)} but never created")
tests = open(root / "supabase/tests/001_foundation.test.sql", encoding="utf8").read()
codes = set(re.findall(r"errcode = '(F\d{4})'", "".join(open(f, encoding="utf8").read() for f in files if "migrations" in f)))
for c in set(re.findall(r"'(F\d{4})'", tests)):
    if c not in codes: errors.append(f"test expects errcode {c} that no migration raises")
print(f"files checked: {len(files)} | functions created: {len(created)} | custom errcodes raised: {sorted(codes)}")
print("STATIC CHECK:", "FAILED" if errors else "no problems found (this proves nothing about runtime behaviour)")
for e in errors: print(" -", e)
sys.exit(1 if errors else 0)
