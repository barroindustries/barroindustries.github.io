#!/usr/bin/env bash
# CI invariant guards — Wave 2 Batch C (I6).
# Dependency-free POSIX-ish shell (grep/sed/find only, no node/python packages).
# Run from the repo root: bash scripts/ci-invariants.sh
#
# Three checks, each fails the build (non-zero exit) when violated:
#   1. STACKING   — no new 4-digit z-index literal in js/*.js, js/screens/*.js,
#                    or css/*.css
#   2. PRECACHE   — every local js/*.js, js/screens/*.js, css/*.css referenced by
#                    index.html must be listed in sw.js's PRECACHE array.
#   3. CACHE_VER  — sw.js's CACHE_VER suffix must equal js/config.js's
#                    APP_VERSION, so a stale hook / bad manual edit / merge
#                    conflict that lets the two drift apart fails loud instead
#                    of silently shipping stale-cached code under a mismatched
#                    version banner.
#
# js/screens/ may not exist yet (Wave 2 Batch B pilot extraction lands it later).
# All checks tolerate a missing/empty js/screens/ directory.

set -u
overall_fail=0

# ── helper: collect the JS files in scope for the stacking check ──────────
collect_js_files() {
  find js -maxdepth 1 -name '*.js' 2>/dev/null
  if [ -d js/screens ]; then
    find js/screens -maxdepth 1 -name '*.js' 2>/dev/null
  fi
}

# ── helper: collect the CSS files in scope for the stacking check ─────────
collect_css_files() {
  find css -maxdepth 1 -name '*.css' 2>/dev/null
}

# ═══════════════════════════════════════════════════════════════════════
# CHECK 1 — STACKING: no new 4-digit z-index literal in js/ or css/
# ═══════════════════════════════════════════════════════════════════════
echo "=== [1/3] STACKING: checking for new 4-digit z-index literals in js/*.js, js/screens/*.js, css/*.css ==="

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
css_files=$(collect_css_files)
stacking_fail=0
tmp_matches=$(mktemp)

if [ -n "$js_files" ]; then
  for f in $js_files; do
    grep -noE "$STACK_PATTERN" "$f" 2>/dev/null | while IFS=: read -r ln match; do
      echo "$f:$ln:$match"
    done
  done > "$tmp_matches"
fi

if [ -n "$css_files" ]; then
  for f in $css_files; do
    grep -noE "$STACK_PATTERN" "$f" 2>/dev/null | while IFS=: read -r ln match; do
      echo "$f:$ln:$match"
    done
  done >> "$tmp_matches"
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
echo "=== [2/3] PRECACHE: checking every local js/css asset in index.html is in sw.js PRECACHE ==="

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

# PERF-WAVE1 WP1 — most js/screens/*.js files are no longer <script> tags in
# index.html (js/app.js's navigateTo() lazy-loads them per page via
# js/config.js's PAGE_SCRIPTS + window.ensurePage()), so the loop above no
# longer sees them at all. They still MUST stay in sw.js's PRECACHE — the
# whole point of lazy-loading is an instant/offline-safe fetch the first
# time a page needs one, and that only works if the service worker already
# has it cached. Extract every path PAGE_SCRIPTS references (a superset scan
# from the _PERF1_PAYROLL_ENGINE helper array, spread into several entries,
# through the window.ensurePage definition right after PAGE_SCRIPTS's closing
# brace — no entry is missed) and require the same '/js/…' PRECACHE
# membership index.html's own script tags already have to satisfy above.
page_scripts_paths=$(node -e "
const fs = require('fs');
const cfg = fs.readFileSync('js/config.js', 'utf8');
const startIdx = cfg.indexOf('_PERF1_PAYROLL_ENGINE');
const endIdx = cfg.indexOf('window.ensurePage', startIdx);
if (startIdx === -1 || endIdx === -1) { process.exit(1); }
const region = cfg.slice(startIdx, endIdx);
const paths = [...new Set([...region.matchAll(/'(js\/[^']+\.js)'/g)].map(m => m[1]))];
paths.forEach(p => console.log(p));
" 2>/dev/null)

if [ -z "$page_scripts_paths" ]; then
  echo "FAIL: could not find/parse js/config.js's PAGE_SCRIPTS manifest (looked for the region between"
  echo "  '_PERF1_PAYROLL_ENGINE' and 'window.ensurePage' in js/config.js — if either identifier was"
  echo "  renamed, update the same markers in scripts/ci-invariants.sh)."
  precache_fail=1
else
  for p in $page_scripts_paths; do
    if ! grep -qF "'/$p'" sw.js; then
      echo "FAIL: js/config.js PAGE_SCRIPTS references '$p' but sw.js PRECACHE has no '/$p' entry."
      echo "  FIX: add   '/$p',   to the PRECACHE array near the top of sw.js."
      precache_fail=1
    fi
  done
fi

if [ "$precache_fail" -eq 0 ]; then
  echo "PASS: every local js/css asset referenced by index.html or js/config.js's PAGE_SCRIPTS is in sw.js PRECACHE"
else
  overall_fail=1
fi

echo

# ═══════════════════════════════════════════════════════════════════════
# CHECK — PAGE_SCRIPTS FILES EXIST (PERF-WAVE1 WP1)
# ═══════════════════════════════════════════════════════════════════════
echo "=== PAGE_SCRIPTS: checking every js/config.js PAGE_SCRIPTS path exists on disk ==="
pagescripts_files_fail=0
if [ -z "$page_scripts_paths" ]; then
  echo "FAIL: could not find/parse js/config.js's PAGE_SCRIPTS manifest (see the PRECACHE check above)."
  pagescripts_files_fail=1
else
  for p in $page_scripts_paths; do
    if [ ! -f "$p" ]; then
      echo "FAIL: js/config.js PAGE_SCRIPTS references '$p' but no such file exists on disk."
      pagescripts_files_fail=1
    fi
  done
fi
if [ "$pagescripts_files_fail" -eq 0 ]; then
  echo "PASS: every js/config.js PAGE_SCRIPTS path exists on disk"
else
  overall_fail=1
fi

echo

# ═══════════════════════════════════════════════════════════════════════
# CHECK 3 — CACHE_VER: sw.js's cache tag must match js/config.js's APP_VERSION
# ═══════════════════════════════════════════════════════════════════════
echo "=== [3/3] CACHE_VER: checking sw.js CACHE_VER matches js/config.js APP_VERSION ==="

cachever_fail=0

app_version=$(grep -oE "APP_VERSION[[:space:]]*=[[:space:]]*'[0-9]+\.[0-9]+\.[0-9]+'" js/config.js \
  | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")
cache_version=$(grep -oE "CACHE_VER[[:space:]]*=[[:space:]]*'bi-ops-v[0-9]+\.[0-9]+\.[0-9]+'" sw.js \
  | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")

if [ -z "$app_version" ]; then
  echo "FAIL: could not find APP_VERSION = 'X.Y.Z' in js/config.js"
  cachever_fail=1
elif [ -z "$cache_version" ]; then
  echo "FAIL: could not find CACHE_VER = 'bi-ops-vX.Y.Z' in sw.js"
  cachever_fail=1
elif [ "$app_version" != "$cache_version" ]; then
  echo "FAIL: CACHE_VER (bi-ops-v$cache_version) in sw.js does not match APP_VERSION ($app_version) in js/config.js."
  echo "  FIX: the pre-commit hook (.githooks/pre-commit) derives CACHE_VER from APP_VERSION on every"
  echo "       commit — this drift means the hook wasn't active (run 'git config core.hooksPath"
  echo "       .githooks' once per clone), or one of the two files was hand-edited. Re-sync sw.js's"
  echo "       CACHE_VER to 'bi-ops-v${app_version}' to fix."
else
  echo "PASS: CACHE_VER (bi-ops-v$cache_version) matches APP_VERSION ($app_version)"
fi

if [ "$cachever_fail" -ne 0 ]; then
  overall_fail=1
fi

# ═══════════════════════════════════════════════════════════════════════
# CHECK 4 — LEDGER POSTERS defined (guards the de4f5bd 'dead-code' regression:
# a sweep deleted postCRJ/CDJ/Expense/resync while 6+ live afterSave/onSaved
# call sites still invoked them, silently severing cash-in/out/expenses/
# purchases from the ledger — the single source of truth).
# ═══════════════════════════════════════════════════════════════════════
echo "=== [4/5] LEDGER POSTERS: postCRJ/CDJ/Expense/resync are defined ==="
posters_fail=0
for fn in postExpenseToLedger postCRJToLedger postCDJToLedger resyncLedgerForSource; do
  if ! grep -rqE "^(async )?function $fn|window\\.$fn[[:space:]]*=" js/*.js js/screens/*.js 2>/dev/null; then
    echo "FAIL: ledger poster '$fn' is CALLED live but not DEFINED in any loaded js file (the de4f5bd regression)"
    posters_fail=1
  fi
done
if [ "$posters_fail" -eq 0 ]; then
  echo "PASS: all four ledger posters are defined"
else
  overall_fail=1
fi

# ═══════════════════════════════════════════════════════════════════════
# CHECK 5 — emojiIcon() must never reach a PLAIN-TEXT sink.
# emojiIcon() returns `<i data-lucide=…>` MARKUP. A notification's title/body/
# icon is PERSISTED and then rendered as TEXT — the in-app inbox escHtml's it and
# the OS lock-screen banner shows the raw string — so markup appears literally as
# code on the owner's phone. This exact bug has shipped FOUR times: twice writing
# it into stored task descriptions, once into the task-comment notification
# preview, and once into the self-assessment reminder's title and icon. The
# generators were each fixed after a screenshot; this check is so there is no
# fifth. Scoped deliberately narrow — only Notifs.send's three text fields — so
# it cannot fire on the many legitimate emojiIcon() calls that build innerHTML.
# ═══════════════════════════════════════════════════════════════════════
echo
echo "=== [5/5] TEXT SINKS: emojiIcon() must not reach a notification title/body/icon ==="
sink_hits=$(python3 - <<'PYEOF'
import re, glob, os
bad = []
NL = chr(10)
for f in sorted(set(glob.glob('js/**/*.js', recursive=True) + ['functions/index.js'])):
    if not os.path.exists(f):
        continue
    src = open(f, encoding='utf-8', errors='ignore').read()
    for m in re.finditer(r'Notifs\.send\s*\(', src):
        i = m.end() - 1
        depth = 0
        call = ''
        for k in range(i, min(len(src), i + 3000)):
            if src[k] == '(':
                depth += 1
            elif src[k] == ')':
                depth -= 1
                if depth == 0:
                    call = src[i:k+1]
                    break
        if not call:
            continue
        line = src[:m.start()].count(NL) + 1
        for field in ('title', 'body', 'icon'):
            fm = re.search(field + r'\s*:\s*([^,\n]{0,240})', call)
            if not fm:
                continue
            expr = fm.group(1)
            # (a) emojiIcon written INLINE in the field
            if 'emojiIcon' in expr:
                bad.append('%s:%d  %s  (inline emojiIcon)' % (f, line, field))
                continue
            # (b) the field INTERPOLATES a variable that was built from emojiIcon
            #     earlier in the same scope. This is the shape that actually
            #     shipped: `const preview = ...emojiIcon...` then `body: `${x}: ${preview}``
            for ident in set(re.findall(r'\$\{\s*([A-Za-z_$][\w$]*)', expr)):
                assign = re.search(
                    r'(?:const|let|var)\s+' + re.escape(ident) + r'\s*=([^;]{0,600});',
                    src[max(0, m.start() - 4000): m.start()])
                if assign and 'emojiIcon' in assign.group(1):
                    bad.append('%s:%d  %s  (via `%s`, built with emojiIcon)' % (f, line, field, ident))
for b in bad:
    print(b)
PYEOF
)
if [ -n "$sink_hits" ]; then
  echo "FAIL: emojiIcon() reaches a persisted notification text field — use a PLAIN emoji there:"
  echo "$sink_hits" | sed 's/^/  /'
  overall_fail=1
else
  echo "PASS: no emojiIcon() in a notification title/body/icon"
fi

echo
echo "=== [6/6] DRAWER ICONS: every NAV_REGISTRY page has a colour rule ==="
# Owner reported grey drawer icons TWICE (2026-08-10, 2026-08-12). The cause is
# structural: the nav entry lives in js/config.js and its colour in
# css/styles.css, nothing links them, and a missing rule does not break — it
# just renders a flat grey tile that looks unfinished. A comment did not stop
# it recurring, so this is the check that does.
# dept:* pages are exempt: they colour from window.DEPARTMENTS[dept].gradient.
icon_hits=$(node -e "
const fs=require('fs');
const cfg=fs.readFileSync('js/config.js','utf8');
const css=fs.readFileSync('css/styles.css','utf8');
const pages=[...new Set([...cfg.matchAll(/page:\s*'([^']+)'/g)].map(m=>m[1]))]
  .filter(p=>!p.startsWith('dept:'));
const styled=new Set([...css.matchAll(/\.nav-item\[data-page=\"([^\"]+)\"\]/g)].map(m=>m[1]));
pages.filter(p=>!styled.has(p)).forEach(p=>console.log(p));
")
if [ -n "$icon_hits" ]; then
  echo "FAIL: these NAV_REGISTRY pages render a grey tile — add a .nav-item[data-page=\"…\"] .nav-icon gradient in css/styles.css:"
  echo "$icon_hits" | sed 's/^/  /'
  overall_fail=1
else
  echo "PASS: every drawer entry has an icon colour"
fi

echo
echo "=== PRECACHE MANIFEST: precache-manifest.json must match HEAD (PERF-WAVE1 WP2) ==="
# The deploy-diff SW trusts this manifest's hashes to decide copy-forward vs
# refetch. A stale manifest (e.g. committed with --no-verify so the pre-commit
# hook never regenerated it) makes clients keep OLD code for changed files —
# the exact failure CACHE_VER bumping exists to prevent. In CI, HEAD is the
# pushed commit, so hashing HEAD blobs catches any bypassed-hook commit.
manifest_fail=$(node -e "
const fs=require('fs'),{execSync}=require('child_process');
try{
  const man=JSON.parse(fs.readFileSync('precache-manifest.json','utf8'));
  if(!man.files||typeof man.files!=='object')throw new Error('missing .files');
  const sw=fs.readFileSync('sw.js','utf8');
  const m=sw.match(/const PRECACHE = \[([\s\S]*?)^\];/m);
  if(!m)throw new Error('cannot parse PRECACHE from sw.js');
  const paths=[...m[1].matchAll(/'(\/[^']*)'/g)].map(x=>x[1]);
  const ver=(fs.readFileSync('js/config.js','utf8').match(/APP_VERSION\s*=\s*'([^']+)'/)||[])[1];
  if(man.version!==ver)console.log('version mismatch: manifest '+man.version+' vs config.js '+ver);
  for(const p of paths){
    if(!man.files[p]){console.log('missing manifest entry: '+p);continue;}
    let t=p.replace(/^\//,''); if(p==='/')t='index.html'; if(p==='/t/')t='t/index.html'; if(p==='/v/')t='v/index.html';
    let blob; try{blob=execSync('git show HEAD:'+JSON.stringify(t),{maxBuffer:64*1024*1024});}catch(e){console.log('not in HEAD: '+t);continue;}
    const h=require('crypto').createHash('sha1').update(blob).digest('hex');
    if(h!==man.files[p])console.log('hash mismatch vs HEAD: '+p);
  }
}catch(e){console.log('manifest check error: '+e.message);}
")
if [ -n "$manifest_fail" ]; then
  echo "FAIL: precache-manifest.json is stale or malformed — never commit it by hand or with --no-verify; the pre-commit hook regenerates it:"
  echo "$manifest_fail" | sed 's/^/  /'
  overall_fail=1
else
  echo "PASS: precache-manifest.json matches HEAD for every PRECACHE entry"
fi

echo
if [ "$overall_fail" -ne 0 ]; then
  echo "=== invariants: FAILED ==="
  exit 1
fi
echo "=== invariants: all checks passed ==="
exit 0
