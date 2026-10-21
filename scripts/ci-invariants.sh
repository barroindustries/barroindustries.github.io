#!/usr/bin/env bash
# CI invariant guards — Wave 2 Batch C (I6).
# Dependency-free POSIX-ish shell (grep/sed/find only, no node/python packages).
# Run from the repo root: bash scripts/ci-invariants.sh
#
# Ten checks (the first three below, then ledger / text-sink / drawer-icon / precache-manifest / cir-forms mirror /
# rules size / public site / QR mirrors), each fails the build (non-zero exit) when violated:
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
    // Strip any ?v= cache-bust: the PRECACHE entry is a URL, the thing we hash is a file.
    let t=p.replace(/^\//,'').replace(/\?.*$/,''); if(p==='/')t='index.html'; if(p==='/t/')t='t/index.html'; if(p==='/v/')t='v/index.html';
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
echo "=== [7/7] CIR FORMS MIRROR: functions/cir-forms.js must be byte-identical to js/cir-forms.js ==="
# CLIENT-INFO-REQUEST-SPEC.md §1.4/§6 WS-0 — the client-info-request public
# page, the internal Sales › Briefs renderer and the Cloud Functions callables
# all validate against the SAME form definition. functions/ only ships its own
# directory (firebase.json), so js/cir-forms.js is mirrored by a plain `cp`
# rather than shared via require — nothing enforces the two stay in sync
# except this check. A drift here means a field/option/limit change was made
# on one side only, silently letting the client and server validate different
# shapes.
cir_mirror_fail=0
if [ ! -f js/cir-forms.js ]; then
  echo "FAIL: js/cir-forms.js is missing."
  cir_mirror_fail=1
fi
if [ ! -f functions/cir-forms.js ]; then
  echo "FAIL: functions/cir-forms.js is missing."
  cir_mirror_fail=1
fi
if [ "$cir_mirror_fail" -eq 0 ]; then
  if ! cmp -s js/cir-forms.js functions/cir-forms.js; then
    echo "FAIL: functions/cir-forms.js must be byte-identical to js/cir-forms.js — edit js/cir-forms.js then: cp js/cir-forms.js functions/cir-forms.js"
    cir_mirror_fail=1
  fi
fi
if [ "$cir_mirror_fail" -eq 0 ]; then
  echo "PASS: functions/cir-forms.js is byte-identical to js/cir-forms.js"
else
  overall_fail=1
fi

echo
# ═══════════════════════════════════════════════════════════════════════
# CHECK 8 — RULES SIZE: firestore.rules must stay clear of Firebase's cap
# ═══════════════════════════════════════════════════════════════════════
# A rules SOURCE file has a hard 262,144-byte limit. Exceeding it does NOT
# produce a helpful message: `firebase deploy` fails with a bare
# INVALID_ARGUMENT and no mention of size, which cost real debugging time
# before this check existed (STATUS backlog 9b). On 2026-09-27 the file sat
# at 261,042 bytes — 1,102 from the cap — and 160 long narrative comment
# blocks were relocated verbatim to docs/firestore-rules-notes.md, taking it
# to ~131KB. This guard keeps that headroom from silently eroding again.
#
# WARN at 80% of the cap, FAIL at 95%. If you legitimately need more room,
# relocate commentary to docs/firestore-rules-notes.md rather than raising
# these numbers — the cap itself is Firebase's and cannot be raised.
echo "=== [8/8] RULES SIZE: firestore.rules must stay under Firebase's 262,144-byte cap ==="
RULES_CAP=262144
RULES_WARN=$(( RULES_CAP * 80 / 100 ))
RULES_FAIL=$(( RULES_CAP * 95 / 100 ))
if [ ! -f firestore.rules ]; then
  echo "FAIL: firestore.rules not found."
  overall_fail=1
else
  rules_bytes=$(wc -c < firestore.rules | tr -d ' ')
  rules_free=$(( RULES_CAP - rules_bytes ))
  if [ "$rules_bytes" -ge "$RULES_FAIL" ]; then
    echo "FAIL: firestore.rules is ${rules_bytes} bytes — only ${rules_free} under the ${RULES_CAP}-byte cap."
    echo "      A deploy near this limit fails as a bare INVALID_ARGUMENT that never mentions size."
    echo "      Move narrative comments to docs/firestore-rules-notes.md (comment-only lines; keep a"
    echo "      one-line [RN-n] pointer) and re-run. Never delete a rule to make room."
    overall_fail=1
  elif [ "$rules_bytes" -ge "$RULES_WARN" ]; then
    echo "WARN: firestore.rules is ${rules_bytes} bytes — ${rules_free} under the ${RULES_CAP}-byte cap."
    echo "      Still passing, but plan a commentary-relocation pass before the next big rules change."
  else
    echo "PASS: firestore.rules is ${rules_bytes} bytes, ${rules_free} under the ${RULES_CAP}-byte cap"
  fi
fi

echo
# ═══════════════════════════════════════════════════════════════════════
# CHECK 9 — PUBLIC SITE (PUBLIC-WEBSITE-SPEC.md §5.6; catalogue split into /catalogue/, 2026-10-21)
# ═══════════════════════════════════════════════════════════════════════
# barroindustries.com is a PUBLIC website and this repo is public, so two owner rulings are
# enforced here as well as in scripts/build-catalogue.js:
#   R1  NO PRICES anywhere on the site. The product catalogue is baked into catalogue/index.html
#       between the CATALOGUE markers by build-catalogue.js, which strips every price field. This
#       re-checks the committed page, so a hand edit or a build-script regression that lets a
#       price (or a pricing-formula field name) through fails the build instead of shipping. The
#       HOMEPAGE lists no products at all (owner ruling): no markers, no cards, no groups.
#   R5  the partner company (see BRAND_RE below) is NEVER named on the public site — not in copy,
#       product text, alt text, meta/OG tags, JSON-LD, robots or sitemap.
#   Also: photos live under /site/img/ and must NOT be precached (an app install would otherwise
#   download marketing images it never shows), and neither does the standalone /catalogue/ page:
#   the worker's navigation handling is URL-exact and would be fine, but the hook-generated
#   precache manifest only understands '/', '/t/' and '/v/' as directory entries.
# FAIL output carries line numbers only, never the matched text — a price must not reach a CI log.
echo "=== [9/9] PUBLIC SITE: no pricing tokens, no partner branding, photos and the catalogue page not precached ==="
cat_fail=0
CAT_PAGE='catalogue/index.html'
CAT_START='<!-- CATALOGUE:START generated by scripts/build-catalogue.js — DO NOT HAND-EDIT -->'
CAT_END='<!-- CATALOGUE:END -->'
CAT_TOKENS='basePrice|priceAdder|pricePer|rateW100|rateD100|rateH100|laborHours|ratePerDay|markup|₱|PHP ?[0-9]|\b[0-9]{1,3}(,[0-9]{3})+\b'
# The <head> of a page carries the Google Fonts URL (opsz,wght@9..144,500..600), which is NOT a thousands-separated
# number but would match that last pattern, so the head is scanned with the list minus it.
CAT_TOKENS_HEAD='basePrice|priceAdder|pricePer|rateW100|rateD100|rateH100|laborHours|ratePerDay|markup|₱|PHP ?[0-9]'
BRAND_RE='brilliant[[:space:]]*steel'
# Newlines folded to spaces first, so a name broken across two lines is still caught.
# Separators ( - _ . / ) are folded to spaces too, so a hyphenated slug (brilliant-steel-range.webp) is caught.
brand_hit() { tr '\n\r_./-' '     ' | grep -qiE "$BRAND_RE"; }

if [ ! -f "$CAT_PAGE" ]; then
  echo "FAIL: $CAT_PAGE is missing — the public catalogue page does not exist."
  cat_fail=1
else
  # -o | wc -l counts OCCURRENCES, not lines — a marker pasted twice on one line is still a duplicate.
  cat_start_n=$(grep -oF -- "$CAT_START" "$CAT_PAGE" | wc -l | tr -d ' ')
  cat_end_n=$(grep -oF -- "$CAT_END" "$CAT_PAGE" | wc -l | tr -d ' ')
  if [ "$cat_start_n" -ne 1 ] || [ "$cat_end_n" -ne 1 ]; then
    echo "FAIL: $CAT_PAGE must contain the CATALOGUE:START and CATALOGUE:END marker comments exactly once each (found $cat_start_n / $cat_end_n)."
    echo "  FIX: run  node scripts/build-catalogue.js"
    cat_fail=1
  else
    cat_s=$(grep -nF -- "$CAT_START" "$CAT_PAGE" | head -1 | cut -d: -f1)
    cat_e=$(grep -nF -- "$CAT_END" "$CAT_PAGE" | head -1 | cut -d: -f1)
    if [ "$cat_e" -le "$cat_s" ]; then
      echo "FAIL: CATALOGUE:END appears before CATALOGUE:START in $CAT_PAGE."
      cat_fail=1
    else
      cat_block=$(sed -n "$((cat_s + 1)),$((cat_e - 1))p" "$CAT_PAGE")
      if [ -z "$(printf '%s' "$cat_block" | tr -d '[:space:]')" ]; then
        echo "FAIL: the CATALOGUE block in $CAT_PAGE is empty — run  node scripts/build-catalogue.js"
        cat_fail=1
      else
        # CAT_TOKENS are the pricing FIELD names and amounts; the plain words price / pricing / cost are checked too.
      cat_price_lines=$(printf '%s\n' "$cat_block" | grep -niE "$CAT_TOKENS|pric(e|ing)|[^a-z]costs?[^a-z]" | cut -d: -f1 | sort -un | head -10 | tr '\n' ' ')
        if [ -n "$cat_price_lines" ]; then
          echo "FAIL: the public catalogue block matches the pricing-token list (block-relative line(s): $cat_price_lines)."
          echo "  Offending text withheld on purpose. NEVER hand-edit the block; fix the source note/override and re-run  node scripts/build-catalogue.js"
          cat_fail=1
        fi
      fi
    fi
  fi
  # The hand-written parts of the page (header, call to action, footer) are public too.
  page_head_e=$(grep -nF -- '</head>' "$CAT_PAGE" | head -1 | cut -d: -f1)
  page_price_lines=$( { sed -n "1,${page_head_e:-0}p" "$CAT_PAGE" | grep -niE "$CAT_TOKENS_HEAD" | cut -d: -f1
                        sed -n "$((${page_head_e:-0} + 1)),\$p" "$CAT_PAGE" | grep -niE "$CAT_TOKENS" | cut -d: -f1 | awk -v off="${page_head_e:-0}" '{print $1 + off}'; } | sort -un | head -10 | tr '\n' ' ')
  if [ -n "$page_price_lines" ]; then
    echo "FAIL: $CAT_PAGE matches the pricing-token list outside or inside the block (line(s): $page_price_lines). Offending text withheld on purpose."
    cat_fail=1
  fi
  # Owner ruling 2026-10-21 ("just the equipment"): the public catalogue has EXACTLY five categories, in this
  # order, and nothing from the excluded exhaust / fresh-air / gas-line / fire-suppression categories.
  cat_groups=$(grep -oE '<section class="cat-group" id="cat-[a-z_]+"' "$CAT_PAGE" | sed -E 's/.*id="cat-//; s/"$//' | tr '\n' ' ')
  if [ "$cat_groups" != "preparation washing cooking storage refrigeration " ]; then
    echo "FAIL: $CAT_PAGE must have exactly the five public categories (preparation washing cooking storage refrigeration), in that order — found: ${cat_groups:-none}"
    echo "  FIX: scripts/build-catalogue.js (PUBLIC_CATEGORIES) + scripts/public-categories.json, then re-run  node scripts/build-catalogue.js"
    cat_fail=1
  fi
  if grep -qE '<p class="cat-code">(EX|FA|GL|FS)-' "$CAT_PAGE"; then
    echo "FAIL: $CAT_PAGE publishes a product from an excluded category (exhaust / fresh air / gas line / fire suppression: codes EX- FA- GL- FS-). Add the category to EXCLUDED_CATEGORIES in scripts/build-catalogue.js and re-run it."
    cat_fail=1
  fi
  # Every product photo the page references must exist (a missing file is a broken image in production).
  for ph in $(grep -oE '/site/img/products/[A-Za-z0-9._-]+\.webp' "$CAT_PAGE" | sort -u); do
    if [ ! -f ".$ph" ]; then
      echo "FAIL: $CAT_PAGE references $ph but that file does not exist — fix scripts/product-photos.json, then re-run  node scripts/build-catalogue.js"
      cat_fail=1
    fi
  done
  # The configurator preview photos (the owner's shot list): every file the manifest or the data island names must exist, as the image AND its
  # -thumb, under site/img/configurator/<family>/<key>.webp — and the island must carry exactly the manifest, so a hand edit of either cannot drift.
  # (The /site/img/ PRECACHE guard below already forbids precaching any of them.)
  cfg_img_problems=$(node - <<'NODEEOF'
const fs = require('fs');
const out = [];
try {
  const man = fs.existsSync('scripts/configurator-previews.json') ? JSON.parse(fs.readFileSync('scripts/configurator-previews.json', 'utf8')) : { images: {} };
  const page = fs.readFileSync('catalogue/index.html', 'utf8');
  const m = page.match(/<script type="application\/json" id="qr-catalogue">([\s\S]*?)<\/script>/);
  const island = m ? JSON.parse(m[1]) : null;
  const want = {};
  Object.keys(man.images || {}).forEach(f => Object.keys(man.images[f]).forEach(k => { want[f + '/' + k] = man.images[f][k]; }));
  Object.keys(want).forEach(key => {
    const p = want[key];
    if (!/^site\/img\/configurator\/[a-z0-9_]+\/[a-z0-9_-]+\.webp$/.test(p)) out.push('configurator-previews.json: ' + key + ' has a path outside site/img/configurator/');
    if (!fs.existsSync(p)) out.push('missing preview image for ' + key);
    if (!fs.existsSync(p.replace(/\.webp$/, '-thumb.webp'))) out.push('missing preview thumb for ' + key);
  });
  const have = {};
  const pv = island && island.previews ? island.previews : {};
  Object.keys(pv).forEach(f => Object.keys(pv[f]).forEach(k => { have[f + '/' + k] = pv[f][k].s; }));
  if (JSON.stringify(Object.keys(have).sort()) !== JSON.stringify(Object.keys(want).sort())) out.push('the data island previews differ from scripts/configurator-previews.json — run: node scripts/build-catalogue.js');
} catch (e) { out.push('configurator preview check error: ' + e.message); }
out.forEach(x => console.log(x));
NODEEOF
)
  if [ -n "$cfg_img_problems" ]; then
    echo "$cfg_img_problems" | sed 's/^/FAIL: /'
    cat_fail=1
  fi
fi

# The homepage lists NO products: no catalogue markers, cards or groups survive in index.html.
if grep -qF -- 'CATALOGUE:START' index.html || grep -qF -- 'CATALOGUE:END' index.html; then
  echo "FAIL: index.html still carries CATALOGUE markers — the homepage lists no products; the catalogue is generated into $CAT_PAGE only."
  cat_fail=1
fi
if grep -qE 'class="cat-(card|group|chips|chip)[ "]' index.html; then
  echo "FAIL: index.html contains catalogue markup (cat-card / cat-group / cat-chip) — the homepage lists no products."
  cat_fail=1
fi

# No price token anywhere in the homepage's public section either.
site_s=$(grep -nF -- '<div id="site"' index.html | head -1 | cut -d: -f1)
site_e=$(grep -nF -- '<!-- /#site -->' index.html | head -1 | cut -d: -f1)
head_e=$(grep -nF -- '</head>' index.html | head -1 | cut -d: -f1)
if [ -n "$site_s" ] && [ -n "$site_e" ] && [ "$site_e" -gt "$site_s" ]; then
  site_price_lines=$(sed -n "${site_s},${site_e}p" index.html | grep -niE "$CAT_TOKENS" | cut -d: -f1 | sort -un | head -10 | tr '\n' ' ')
  if [ -n "$site_price_lines" ]; then
    echo "FAIL: the #site section of index.html matches the pricing-token list (section-relative line(s): $site_price_lines). Offending text withheld on purpose."
    cat_fail=1
  fi
fi

# Photos, the catalogue page and its assets stay out of the service worker's PRECACHE.
if grep -nF -- "'/site/img/products/" sw.js >/dev/null 2>&1; then
  echo "FAIL: sw.js PRECACHE lists a '/site/img/products/…' entry. Product photos are deliberately NOT precached — an app install would download images it never shows:"
  grep -nF -- "'/site/img/products/" sw.js | sed 's/^/    /'
  cat_fail=1
fi
if grep -nF -- "'/site/img/" sw.js >/dev/null 2>&1; then
  echo "FAIL: sw.js PRECACHE lists a '/site/img/…' entry. Project and product photos are deliberately NOT precached (spec §8.4):"
  grep -nF -- "'/site/img/" sw.js | sed 's/^/    /'
  cat_fail=1
fi
# The hero's logo-reveal animation (site/img/brand/: two mp4 files and a poster, 2026-10-21) is NOT precached either: an app install would download
# ~2 MB of marketing video it never shows (the app never shows the website). The generic '/site/img/ guard above already catches the folder; this one
# names the rule for the brand folder and for ANY video file, wherever it lives. (sw.js leaves media requests to the browser's own range handling.)
if grep -nE -- "'/site/img/brand/|\.(mp4|webm|mov|m4v)'" sw.js >/dev/null 2>&1; then
  echo "FAIL: sw.js PRECACHE lists the hero logo animation ('/site/img/brand/…') or a video file. They are deliberately NOT precached — an app install would download megabytes of marketing video it never shows:"
  grep -nE -- "'/site/img/brand/|\.(mp4|webm|mov|m4v)'" sw.js | sed 's/^/    /'
  cat_fail=1
fi
if grep -nE -- "'/catalogue/|'/js/catalogue\.js'|'/css/catalogue\.css'|'/js/quote-request\.js'|'/css/quote-request\.css'" sw.js >/dev/null 2>&1; then
  echo "FAIL: sw.js PRECACHE lists the standalone /catalogue/ page or its assets (incl. the quote-request UI). They are deliberately NOT precached (not part of the app shell, and the pre-commit manifest generator only maps '/', '/t/' and '/v/' to an index.html):"
  grep -nE -- "'/catalogue/|'/js/catalogue\.js'|'/css/catalogue\.css'|'/js/quote-request\.js'|'/css/quote-request\.css'" sw.js | sed 's/^/    /'
  cat_fail=1
fi

# PUBLIC-QUOTE-REQUEST-SPEC.md — the quote UI ships to the public, so its scripts carry NO pricing vocabulary: no price field
# name, no formula field name, no peso amount (a peso sign followed by a digit; the page prints the server's figures with a
# local formatter that never writes one literally). The page never loads, or even names, the pricing engine: the browser
# only ever receives the server's rounded {low, high} range. FAIL output carries line numbers only.
# The pattern also catches the loose spellings a price takes in a script: a peso sign / "PHP" then a digit (spaces tolerated), a
# thousands-separated number (84,120), and the figure names the server keeps on the staff-only block. The four files are every
# PUBLIC script the catalogue page can load (the quote UI, its shared definition, the catalogue filter, the site chrome, and — since the
# configurable product families — the family helpers, the generated family definitions and the preview widget).
QR_VOCAB='basePrice|priceAdder|pricePer|rateW100|rateD100|rateH100|formulaType|unitPrice|lineTotal|exactTotal|listPrice|₱[[:space:]]*[0-9]|PHP ?[0-9]|\b[0-9]{1,3}(,[0-9]{3})+\b|pricing-core'
for qrf in js/quote-request.js js/qr-def.js js/catalogue.js js/site.js js/product-families.js js/qr-families.js js/qr-preview.js; do
  if [ ! -f "$qrf" ]; then
    echo "FAIL: public quote-request file $qrf is missing."
    cat_fail=1
  else
    qr_vocab_lines=$(grep -nE "$QR_VOCAB" "$qrf" | cut -d: -f1 | head -10 | tr '\n' ' ')
    if [ -n "$qr_vocab_lines" ]; then
      echo "FAIL: $qrf carries pricing vocabulary (line(s): $qr_vocab_lines). The public quote UI must hold no price field name, no formula field name, no peso amount and no reference to the pricing engine. Offending text withheld on purpose."
      cat_fail=1
    fi
  fi
done
if [ -f "$CAT_PAGE" ] && grep -qiE 'pricing-core' "$CAT_PAGE"; then
  echo "FAIL: $CAT_PAGE references the pricing engine. The public catalogue page must never load or name it — it receives only the server's rounded estimate range."
  cat_fail=1
fi

if [ "$cat_fail" -eq 0 ]; then
  echo "PASS: public pages carry no pricing tokens; the homepage lists no products; photos and the catalogue page are not precached"
fi

# The public CONTENT pages (2026-10-21): /services/ + its six service pages, /work/ + its two project pages, /areas-we-serve/ and /faq/. Static,
# standalone HTML like /catalogue/ (their own shared stylesheet, css/pages.css, and the shared js/site.js — never an app script). The same
# rulings apply: R1 NO PRICES (the whole file, head and body, plus the plain words price / pricing / cost), R5 no partner company (checked below
# with the other public surfaces), ONE phone / ONE email / the Quezon City address (no Gmail, no 0960, no San Fernando address), and none of
# them in the service worker's PRECACHE. FAIL output carries line numbers only. tests/seo-pages.test.mjs pins the rest of their content.
SEO_PAGES='services/index.html services/commercial-kitchen-fit-out/index.html services/stainless-steel-fabrication/index.html services/exhaust-and-fresh-air-systems/index.html services/lpg-gas-line-installation/index.html services/kitchen-fire-suppression/index.html services/institutional-and-government-supply/index.html work/index.html work/ispsc-2026/index.html work/dmmmsu-2022-2023/index.html areas-we-serve/index.html faq/index.html'
seo_fail=0
for sp in $SEO_PAGES; do
  if [ ! -f "$sp" ]; then
    echo "FAIL: public content page $sp is missing."
    seo_fail=1
    continue
  fi
  sp_head_e=$(grep -nF -- '</head>' "$sp" | head -1 | cut -d: -f1)
  # the head is scanned with the FULL token list too (JSON-LD sits in it); only the Google Fonts URL (opsz,wght@9..144,500..600) is exempt
  sp_price_lines=$( { sed -n "1,${sp_head_e:-0}p" "$sp" | grep -niE "$CAT_TOKENS" | grep -v 'fonts\.googleapis\.com' | cut -d: -f1
                      sed -n "$((${sp_head_e:-0} + 1)),\$p" "$sp" | grep -niE "$CAT_TOKENS|pric(e|ing)|[^a-z]costs?[^a-z]" | cut -d: -f1 | awk -v off="${sp_head_e:-0}" '{print $1 + off}'; } | sort -un | head -10 | tr '\n' ' ')
  if [ -n "$sp_price_lines" ]; then
    echo "FAIL: $sp matches the pricing-token list (line(s): $sp_price_lines). Offending text withheld on purpose."
    seo_fail=1
  fi
  if grep -qiE 'gmail|0960|san[[:space:]]*fernando|purok|carlatan' "$sp"; then
    echo "FAIL: $sp carries a contact detail that is not allowed on the public site (a Gmail address, the 0960 number or an old La Union / San Fernando address). Offending text withheld on purpose."
    seo_fail=1
  fi
  if grep -qE '<script[^>]*src="[^"]*(app|config|firebase|departments|modules|drive|notifications|quote-request|catalogue)[^"]*"' "$sp"; then
    echo "FAIL: $sp loads an app, Firebase or catalogue script. The content pages load only the shared /js/site.js."
    seo_fail=1
  fi
done
if [ ! -f css/pages.css ]; then
  echo "FAIL: css/pages.css (the content pages' stylesheet) is missing."
  seo_fail=1
fi
if grep -nE -- "'/services|'/work|'/areas-we-serve|'/faq|'/css/pages\.css'" sw.js >/dev/null 2>&1; then
  echo "FAIL: sw.js PRECACHE lists a public content page or its stylesheet. Like /catalogue/, they are deliberately NOT precached (not part of the app shell):"
  grep -nE -- "'/services|'/work|'/areas-we-serve|'/faq|'/css/pages\.css'" sw.js | sed 's/^/    /'
  seo_fail=1
fi
if [ "$seo_fail" -eq 0 ]; then
  echo "PASS: the 12 public content pages (/services/, /work/, /areas-we-serve/, /faq/) carry no pricing tokens, no disallowed contact detail and no app script, and are not precached"
else
  cat_fail=1
fi


# Partner-brand guard over every PUBLIC surface: the <head> (title / meta / OG / Twitter /
# JSON-LD), the #site section (copy, project photo alt text), the whole catalogue page (copy,
# generated products, alt text) and the files that exist only for the public site.
brand_fail=0
if [ -z "$site_s" ] || [ -z "$site_e" ] || [ -z "$head_e" ] || [ "$site_e" -le "$site_s" ]; then
  echo "FAIL: cannot locate the public site section in index.html (expected  <div id=\"site\"  …  <!-- /#site -->  and a </head>)."
  brand_fail=1
else
  if sed -n "1,${head_e}p" index.html | brand_hit; then
    echo "FAIL: index.html <head> (title/meta/OG/Twitter/JSON-LD) names the partner company — it must never appear on the public site."
    brand_fail=1
  fi
  if sed -n "${site_s},${site_e}p" index.html | brand_hit; then
    echo "FAIL: the #site section of index.html names the partner company — it must never appear on the public site."
    brand_fail=1
  fi
fi
PUBLIC_FILES="$CAT_PAGE robots.txt sitemap.xml css/site.css js/site.js css/catalogue.css js/catalogue.js css/quote-request.css js/quote-request.js js/qr-def.js js/product-families.js js/qr-families.js js/qr-preview.js"
PUBLIC_FILES="$PUBLIC_FILES css/pages.css $SEO_PAGES"
[ -f scripts/product-photos.json ] && PUBLIC_FILES="$PUBLIC_FILES scripts/product-photos.json"
[ -f scripts/public-categories.json ] && PUBLIC_FILES="$PUBLIC_FILES scripts/public-categories.json"
[ -f scripts/public-families.json ] && PUBLIC_FILES="$PUBLIC_FILES scripts/public-families.json"
[ -f scripts/configurator-previews.json ] && PUBLIC_FILES="$PUBLIC_FILES scripts/configurator-previews.json"
for pub in $PUBLIC_FILES; do
  if [ ! -f "$pub" ]; then
    echo "FAIL: public-site file $pub is missing."
    brand_fail=1
  elif brand_hit < "$pub"; then
    echo "FAIL: $pub names the partner company — it must never appear on the public site."
    brand_fail=1
  fi
done
if [ "$brand_fail" -eq 0 ]; then
  echo "PASS: no partner-brand reference in the public site surfaces (index.html <head> + #site section, catalogue/index.html, robots.txt, sitemap.xml, css/site.css, js/site.js, css/catalogue.css, js/catalogue.js, css/quote-request.css, js/quote-request.js, js/qr-def.js, js/product-families.js, js/qr-families.js, js/qr-preview.js, scripts/product-photos.json, scripts/public-categories.json, scripts/public-families.json, scripts/configurator-previews.json)"
fi
if [ "$cat_fail" -ne 0 ] || [ "$brand_fail" -ne 0 ]; then
  overall_fail=1
fi

echo
# ═══════════════════════════════════════════════════════════════════════
# CHECK 10 — QR MIRRORS (PUBLIC-QUOTE-REQUEST-SPEC.md §7.1; the configurable families added 2026-10-21)
# ═══════════════════════════════════════════════════════════════════════
# The public "Get a quote" flow shares FOUR files between the browser side and the Cloud Functions, and functions/ only
# ships its own directory (firebase.json), so each is mirrored by a plain `cp` and nothing but this check keeps the two
# copies equal:
#   js/qr-def.js            <-> functions/qr-def.js            the intake / limits / estimate-range / notice definition
#   js/pricing-core.js      <-> functions/pricing-core.js      the catalogue-item pricing math the Quote Builder AND the server share
#   js/product-families.js  <-> functions/product-families.js  the family helpers (validate a configuration, preview keys, …) — price-free
#   js/qr-families.js       <-> functions/qr-families.js       the six family definitions, GENERATED from scripts/public-families.json by
#                                                              scripts/build-catalogue.js (which writes both copies)
# A drift means the page and the server validated, or priced, different things. pricing-core is under the money-core
# contract (pinned + mutation-tested tests/pricing-core.test.mjs). Also: the server's published-product allowlist
# (functions/qr-published.json, GENERATED by scripts/build-catalogue.js) must list exactly the products on the committed
# catalogue's "Add to quote" data island — so nothing can be quotable without being on the page, or on the page without
# being quotable, and no list is ever kept by hand.
echo "=== [10/10] QR MIRRORS: functions/ copies of qr-def, pricing-core, product-families, qr-families byte-identical to js/; published-id allowlist == catalogue island; every published SKU absorbed or fixed exactly once ==="
qr_fail=0
for qrm in qr-def.js pricing-core.js product-families.js qr-families.js; do
  if [ ! -f "js/$qrm" ]; then
    echo "FAIL: js/$qrm is missing."
    qr_fail=1
  fi
  if [ ! -f "functions/$qrm" ]; then
    echo "FAIL: functions/$qrm is missing."
    qr_fail=1
  fi
  if [ -f "js/$qrm" ] && [ -f "functions/$qrm" ] && ! cmp -s "js/$qrm" "functions/$qrm"; then
    echo "FAIL: functions/$qrm must be byte-identical to js/$qrm — edit js/$qrm then: cp js/$qrm functions/$qrm"
    qr_fail=1
  fi
done
qr_pub_problems=$(node - <<'NODEEOF'
const fs = require('fs');
const out = [];
try {
  const allow = JSON.parse(fs.readFileSync('functions/qr-published.json', 'utf8'));
  const page = fs.readFileSync('catalogue/index.html', 'utf8');
  const m = page.match(/<script type="application\/json" id="qr-catalogue">([\s\S]*?)<\/script>/);
  if (!m) {
    out.push('catalogue/index.html has no #qr-catalogue data island — run: node scripts/build-catalogue.js');
  } else {
    const island = JSON.parse(m[1]);
    const a = (allow.ids || []).slice().sort().join(',');
    const b = island.products.map(p => p.id).sort().join(',');
    if (!Array.isArray(allow.ids) || allow.ids.length === 0) out.push('functions/qr-published.json has no ids');
    if (a !== b) out.push('functions/qr-published.json does not list exactly the products in the catalogue data island — run: node scripts/build-catalogue.js');
    // Every PUBLISHED SKU (scripts/public-categories.json "products") is either FIXED (a card of its own: the island) or ABSORBED by exactly one
    // family (js/qr-families.js) — never both, never neither, and no family names a SKU that is not published.
    const pub = Object.keys(JSON.parse(fs.readFileSync('scripts/public-categories.json', 'utf8')).products).sort();
    const fams = require(process.cwd() + '/js/qr-families.js');
    const absorbed = [];
    Object.keys(fams.families).forEach(f => Object.keys(fams.families[f].absorbed).forEach(id => absorbed.push(id)));
    const fixed = island.products.map(p => p.id);
    if (new Set(absorbed).size !== absorbed.length) out.push('a SKU is absorbed by two families');
    const both = absorbed.filter(id => fixed.includes(id));
    if (both.length) out.push('a SKU is both absorbed by a family and a card of its own: ' + both.join(' '));
    const union = absorbed.concat(fixed).sort();
    if (JSON.stringify(union) !== JSON.stringify(pub)) out.push('the absorbed + fixed SKUs are not exactly the published SKUs of scripts/public-categories.json — run: node scripts/build-catalogue.js (it refuses an unclassified SKU)');
  }
} catch (e) { out.push('published-id check error: ' + e.message); }
out.forEach(x => console.log(x));
NODEEOF
)
if [ -n "$qr_pub_problems" ]; then
  echo "$qr_pub_problems" | sed 's/^/FAIL: /'
  qr_fail=1
fi
if [ "$qr_fail" -eq 0 ]; then
  echo "PASS: functions/qr-def.js, pricing-core.js, product-families.js and qr-families.js are byte-identical to their js/ originals; functions/qr-published.json matches the catalogue data island; every published SKU is absorbed by one family or a fixed card, exactly once"
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
