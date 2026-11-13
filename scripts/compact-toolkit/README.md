# Compact backup toolkit

Both scripts are self-contained (Python 3 stdlib only) and portable — no
hardcoded paths.

## minimize.py — build a compact backup of this repo

    python3 scripts/compact-toolkit/minimize.py . /path/to/nextapply-data-min

Accepts this single-plane layout (`public/data/`) and the old two-plane one
(`data/` + `public/data/`). Drops ONLY fields that are 100% derivable from
kept fields (rules verified file-by-file); every value that failed derivation
is preserved verbatim in the backup's `data/overrides.json` — that is the
zero-data-loss guarantee. Typical backup: ~12 MB zipped.

## hydrate.py — restore / verify from a compact backup

    python3 scripts/compact-toolkit/hydrate.py --min /path/to/nextapply-data-min --out /path/to/restored
    python3 scripts/compact-toolkit/hydrate.py --min /path/to/nextapply-data-min --out /path/to/restored --verify .

The restore reproduces the full original layout (`data/` + `public/data/`);
the live site only needs `public/data/`. `--verify .` compares the restored
data plane against THIS repo with semantic JSON equality (both repo layouts
supported).

The minimized backup ships its own copies of these scripts at
`scripts/minimize.py` / `scripts/hydrate.py` — running them from inside that
backup needs no `--min` flag.
