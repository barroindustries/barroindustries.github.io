#!/usr/bin/env node
'use strict';
/**
 * scripts/check-backup-coverage.js
 *
 * CI drift check (v13 Phase 7). scripts/monthly-backup.js backs up every
 * Firestore ROOT collection automatically via db.listCollections() — so
 * coverage itself can't silently regress. What CAN drift silently:
 *
 *   1. A "phantom" EXCLUDE entry in monthly-backup.js — a collection name
 *      that's deliberately skipped but that no longer (or never did) exist
 *      as a real root collection referenced anywhere in js/. That's a sign
 *      the exclusion is stale/wrong and should be re-examined.
 *   2. A brand-new root collection appearing in js/ that nobody has looked
 *      at yet re: backup/exclude decisions. Not a failure — just a nudge.
 *
 * This script has no dependencies and targets any current Node LTS.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(REPO_ROOT, 'js');
const FUNCTIONS_ENTRY = path.join(REPO_ROOT, 'functions', 'index.js');
const BACKUP_FILE = path.join(REPO_ROOT, 'scripts', 'monthly-backup.js');

// Subcollection names that legitimately show up in `.collection('name')`
// calls but are never root collections (they're always reached via a
// parent doc ref, e.g. taskRef.collection('comments')). Subtract these
// from the root-collection scan.
const KNOWN_SUBCOLLECTIONS = ['comments', 'messages', 'readers', 'typing', 'records', 'items'];

// Baseline snapshot of root collections seen in js/ + functions/index.js at
// authoring time (v14 Wave 7 re-audit, 2026-08-03 — refreshed after the
// Wave 7 department-screen split moved ~10 renderers into js/screens/ and
// this scanner was found to be blind to that directory; also removed two
// stale entries, 'finance_records' and 'president_message', that no longer
// correspond to any real `.collection(...)` call anywhere in js/). Anything
// in the current scan but NOT in this baseline is reported as "new"
// (warn-only, exit 0) so a human notices drift without blocking CI.
const BASELINE = [
  '_counters', 'aec_contacts', 'approval_requests', 'attendance',
  'attendance_extensions', 'attendance_worker', 'audit_log', 'bank_accounts',
  'bk_quotes', 'bs_clients', 'bs_quotes', 'budgets_marketing', 'campaigns',
  'cash_advances', 'cash_disbursement_journal', 'cash_receipt_journal',
  'clients', 'conversations', 'departments', 'design_clients',
  'design_drawings', 'error_log', 'expenses', 'finance_config',
  'finance_delete_requests', 'finance_periods', 'finance_rollup',
  'general_journal', 'geo_sites', 'gov_biddings', 'handbook',
  'hub_files', 'hub_folders', 'id_verify', 'inventory_items', 'it_access',
  'it_assets', 'it_network', 'it_software', 'it_tickets', 'job_costs',
  'job_projects', 'kpi_evals', 'kpi_targets', 'leave_accruals',
  'leave_balances', 'leave_requests', 'ledger', 'memos', 'notif_push_quota',
  'notif_quota', 'notifications',
  'order_tracking', 'partner_deals', 'pay_runs', 'payroll',
  'payroll_ca_overrides', 'payroll_delete_requests', 'payslips',
  'pending_raises', 'policies', 'posts', 'productMeta',
  'production_orders', 'products', 'projects', 'promotions',
  'purchase_requisitions', 'quotes', 'resources', 'roc_leads', 'salary_history',
  'salary_raises', 'sales_clients', 'sales_orders', 'settings',
  'settings_holidays', 'signup_requests', 'sops', 'stock_movements',
  'strategy_notes', 'submissions', 'suggestions', 'system_health', 'tasks',
  'tax_records', 'usernames', 'users', 'worker_directory', 'worker_profiles',
];

// Recursively collect every .js file under `dir` (js/screens/, js/*, any
// future subdirectory) — a flat readdirSync used to silently miss anything
// nested (this is what let geo_sites/finance_config/etc. go undetected the
// same day js/screens/*.js was introduced).
function collectJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function scanRootCollections(jsDir) {
  const names = new Set();
  const files = collectJsFiles(jsDir);
  // Also scan the Cloud Functions entry point — some root collections
  // (notif_push_quota, notif_quota) are only ever written from there, never
  // from client-side js/, and would otherwise never show up in `scanned`.
  if (fs.existsSync(FUNCTIONS_ENTRY)) files.push(FUNCTIONS_ENTRY);
  const pattern = /\.collection\(\s*['"]([a-z_0-9]+)['"]/gi;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf-8');
    let m;
    while ((m = pattern.exec(src)) !== null) {
      names.add(m[1]);
    }
  }
  for (const sub of KNOWN_SUBCOLLECTIONS) names.delete(sub);
  return names;
}

function extractExclude(backupSrc) {
  // const EXCLUDE = new Set(['notifications']);
  const m = backupSrc.match(/EXCLUDE\s*=\s*new Set\(\s*\[([^\]]*)\]\s*\)/);
  if (!m) return [];
  return [...m[1].matchAll(/['"]([a-z_0-9]+)['"]/g)].map(x => x[1]);
}

function extractOverrideKeys(backupSrc) {
  // const OVERRIDES = { key: {...}, key2: {...} };
  const start = backupSrc.indexOf('const OVERRIDES');
  if (start === -1) return [];
  const braceStart = backupSrc.indexOf('{', start);
  if (braceStart === -1) return [];
  // Walk to matching close brace
  let depth = 0, i = braceStart, end = -1;
  for (; i < backupSrc.length; i++) {
    if (backupSrc[i] === '{') depth++;
    else if (backupSrc[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = backupSrc.slice(braceStart + 1, end === -1 ? undefined : end);
  // Top-level keys: identifier or 'quoted' followed by ':' then '{'
  const keys = [];
  const keyPattern = /(?:^|,)\s*['"]?([a-zA-Z_0-9]+)['"]?\s*:\s*\{/g;
  let m;
  while ((m = keyPattern.exec(body)) !== null) keys.push(m[1]);
  return keys;
}

function main() {
  if (!fs.existsSync(JS_DIR)) {
    console.error(`ERROR: js/ directory not found at ${JS_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(BACKUP_FILE)) {
    console.error(`ERROR: ${BACKUP_FILE} not found`);
    process.exit(1);
  }

  const scanned = scanRootCollections(JS_DIR);
  const backupSrc = fs.readFileSync(BACKUP_FILE, 'utf-8');
  const excludeList = extractExclude(backupSrc);
  const overrideKeys = extractOverrideKeys(backupSrc);

  console.log('── Backup coverage report ──────────────────────────────────');
  console.log(`Root collections found in js/ (${scanned.size}):`);
  console.log('  ' + [...scanned].sort().join(', '));
  console.log('');
  console.log(`EXCLUDE entries in monthly-backup.js (${excludeList.length}): ${excludeList.join(', ') || '(none)'}`);
  console.log(`OVERRIDES keys in monthly-backup.js (${overrideKeys.length}): ${overrideKeys.join(', ') || '(none)'}`);
  console.log('');

  // 1. Phantom EXCLUDE entries — fail
  const phantoms = excludeList.filter(name => !scanned.has(name));
  if (phantoms.length > 0) {
    console.error('FAIL: phantom EXCLUDE entries (not a real root collection referenced in js/):');
    for (const p of phantoms) console.error(`  - ${p}`);
    console.error('');
    console.error('These either never existed as root collections or have been renamed/removed.');
    console.error('Remove them from EXCLUDE in scripts/monthly-backup.js, or fix the collection name.');
    process.exit(1);
  }
  console.log('OK: every EXCLUDE entry corresponds to a real root collection referenced in js/.');

  // 1b. Phantom OVERRIDES keys — fail. An OVERRIDES entry keyed on a
  // collection name that no longer exists (a rename that missed a call
  // site, a typo) would silently stop producing that collection's CSV +
  // month-activity report with zero signal (the JSON snapshot path is
  // independent via db.listCollections(), so it wouldn't even error).
  const phantomOverrides = overrideKeys.filter(name => !scanned.has(name));
  if (phantomOverrides.length > 0) {
    console.error('FAIL: phantom OVERRIDES keys (not a real root collection referenced in js/):');
    for (const p of phantomOverrides) console.error(`  - ${p}`);
    console.error('');
    console.error('This OVERRIDES entry in scripts/monthly-backup.js is silently producing no');
    console.error('CSV/month-activity output for a collection that no longer has this name.');
    console.error('Fix the key to match the real collection name, or remove the stale entry.');
    process.exit(1);
  }
  console.log('OK: every OVERRIDES key corresponds to a real root collection referenced in js/.');

  // 2. New collections relative to the baseline — warn only
  const baselineSet = new Set(BASELINE);
  const newCollections = [...scanned].filter(name => !baselineSet.has(name));
  if (newCollections.length > 0) {
    console.log('');
    console.log('NOTE (non-blocking): collections not in the authoring-time baseline —');
    console.log('review whether they need an EXCLUDE or OVERRIDES entry (they ARE backed up');
    console.log('automatically via db.listCollections(); this is just a heads-up):');
    for (const n of newCollections) console.log(`  - ${n} (new)`);
  } else {
    console.log('OK: no new root collections relative to the baseline.');
  }

  console.log('──────────────────────────────────────────────────────────');
  console.log('Backup coverage check passed.');
  process.exit(0);
}

main();
