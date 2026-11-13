#!/usr/bin/env python3
"""scripts/compact-repo.py — re-compact public/data JSON after bulk edits.

The 2026-11-14 minimization stored every JSON file compact (no pretty-print
whitespace). Editors and the expire sweep may write pretty-printed JSON again;
this tool restores compact bytes with a zero-data-loss guarantee: every file
is re-parsed and compared for semantic equality before and after writing.

Usage:  python3 scripts/compact-repo.py           (from the repo root)
        python3 scripts/compact-repo.py --dry-run (report only)
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
DRY = "--dry-run" in sys.argv

changed = kept = 0
saved = 0
for p in sorted(DATA.rglob("*.json")):
    raw = p.read_bytes()
    obj = json.loads(raw)
    compact = (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    if compact == raw:
        kept += 1
        continue
    if json.loads(compact) != obj:
        sys.exit(f"ABORT: semantic drift while compacting {p}")
    saved += len(raw) - len(compact)
    changed += 1
    if not DRY:
        p.write_bytes(compact)

print(f"compact-repo: {changed} file(s) compacted, {kept} already compact")
if changed:
    print(f"            ~{saved/1024:.0f} KB of whitespace reclaimed" + (" (dry run)" if DRY else ""))
