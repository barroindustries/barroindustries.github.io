#!/usr/bin/env bash
# CI invariant guards — Wave 2 Batch C (I6).
# Dependency-free POSIX-ish shell (grep/sed/find only, no node/python packages).
# Run from the repo root: bash scripts/ci-invariants.sh
#
# Two checks, each fails the build (non-zero exit) when violated:
#   1. STACKING   — no new 4-digit z-index literal in js/*.js or js/screens/*.js
#   2. PRECACHE   — every local js/*.js, js/screens/*.js, css/*.css referenced by
#                    index.html must be listed in sw.js's PRECACHE array.
#
# js/screens/ may not exist yet (Wave 2 Batch B pilot extraction lands it later).
# Both checks tolerate a missing/empty js/screens/ directory.

set -u
overall_fail=0

# ── helper: collect the JS files in scope for the stacking check ──────────
collect_js_files() {
  find js -maxdepth 1 -name '*.js' 2>/dev/null
  if [ -d js/screens ]; then
    find js/screens -maxdepth 1 -name '*.js' 2>/dev/null
  fi
}

# ═══════════════════════════════════════════════════════════════════════
# CHECK 1 — STACKING: no new 4-digit z-index literal in js/
# ═══════════════════════════════════════════════════════════════════════
echo "=== [1/2] STACKING: checking for new 4-digit z-index literals in js/*.js and js/screens/*.js ==="

# Baseline whitelist — pre-existing raw z-index literals as of Wave 2 Batch C
# (2026-08-03). Each was audited and is a legitimate top-of-stack overlay
# (toast / banner / edge-gesture pill / full-screen photo-requirement modal),
# not a new stacking hack. Format: FILE:ALLOWED_COUNT.
# If you intentionally add a new 4-digit z-index, either route it through the
# existing z-index scale in css/tokens.css instead, or — if that's genuinely
# not possible — bump the ALLOWED_COUNT below with a comment explaining why.
STACKING_WHITELIST='
# (v14 wave6 D1: notifications/gestures/app z-chrome now tokenized — zero raw literals remain)


'

# grep -E interval pattern for a bare 4-digit z-index literal in either CSS-text
# form (z-index:1234) or JS property-assignment form (zIndex: '1234' / zIndex=1234)
STACK_PATTERN='z-index[[:space:]]*:[[:space:]]*[0-9]{4}|zIndex[[:space:]]*[=:][[:space:]]*['"'"'"]?[0-9]{4}'

js_files=$(collect_js_files)
stacking_fail=0
tmp_matches=$(mktemp)

if [ -n "$js_files" ]; then
  for f in $js_files; do
    grep -noE "$STACK_PATTERN" "$f" 2>/dev/null | while IFS=: read -r ln match; do
      echo "$f:$ln:$match"
    done
  done > "$tmp_matches"
fi

# Count actual matches per file
files_with_matches=$(cut -d: -f1 "$tmp_matches" | sort -u)

for f in $files_with_matches; do
  actual_count=$(grep -c "^$f:" "$tmp_matches")
  allowed_count=$(printf '%s\n' "$STACKING_WHITELIST" | grep -E "^${f//\//\\/}:" | sed -E 's/^[^:]+:([0-9]+).*/\1/')
  allowed_count=${allowed_count:-0}
  if [ "$actual_count" -gt "$allowed_count" ]; then
    echo "FAIL: $f has $actual_count raw 4-digit z-index literal(s), only $allowed_count whitelisted:"
    grep "^$f:" "$tmp_matches" | sed 's/^/    /'
    echo "  FIX: use the existing z-index scale in css/tokens.css instead of a raw literal,"
    echo "       or if this is a deliberate new top-of-stack overlay, add/adjust an entry in"
    echo "       STACKING_WHITELIST in scripts/ci-invariants.sh with a one-line justification."
    stacking_fail=1
  fi
done

rm -f "$tmp_matches"

if [ "$stacking_fail" -eq 0 ]; then
  echo "PASS: no un-whitelisted 4-digit z-index literals in js/*.js or js/screens/*.js"
else
  overall_fail=1
fi

echo

# ═══════════════════════════════════════════════════════════════════════
# CHECK 2 — PRECACHE COMPLETENESS
# ═══════════════════════════════════════════════════════════════════════
echo "=== [2/2] PRECACHE: checking every local js/css asset in index.html is in sw.js PRECACHE ==="

precache_fail=0

# Extract local (non-http) script src= / link href= paths under js/ or css/ from index.html.
referenced_paths=$(grep -oE '(src|href)="[^"]+"' index.html \
  | sed -E 's/^(src|href)="//; s/"$//' \
  | grep -E '^(js|css)/')

if [ -z "$referenced_paths" ]; then
  echo "FAIL: found no js/ or css/ references in index.html — parsing likely broken, check the grep pattern."
  precache_fail=1
else
  for p in $referenced_paths; do
    if ! grep -qF "'/$p'" sw.js; then
      echo "FAIL: index.html references '$p' but sw.js PRECACHE has no '/$p' entry."
      echo "  FIX: add   '/$p',   to the PRECACHE array near the top of sw.js."
      precache_fail=1
    fi
  done
fi

if [ "$precache_fail" -eq 0 ]; then
  echo "PASS: every local js/css asset referenced by index.html is in sw.js PRECACHE"
else
  overall_fail=1
fi

echo
if [ "$overall_fail" -ne 0 ]; then
  echo "=== invariants: FAILED ==="
  exit 1
fi
echo "=== invariants: all checks passed ==="
exit 0
