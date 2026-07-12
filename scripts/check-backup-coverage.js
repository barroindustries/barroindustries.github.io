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
 * This script has no dependencies and targets plain Node 20.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(REPO_ROOT, 'js');
const BACKUP_FILE = path.join(REPO_ROOT, 'scripts', 'monthly-backup.js');

// Subcollection names that legitimately show up in `.collection('name')`
// calls but are never root collections (they're always reached via a
// parent doc ref, e.g. taskRef.collection('comments')). Subtract these
// from the root-collection scan.
const KNOWN_SUBCOLLECTIONS = ['comments', 'messages', 'readers', 'typing', 'records', 'items'];

// Baseline snapshot of root collections seen in js/ at authoring time
// (v13 Phase 7). Anything in the current scan but NOT in this baseline is
// reported as "new" (warn-only, exit 0) so a human notices drift without
// blocking CI.
const BASELINE = [
  '_counters', 'aec_contacts', 'approval_requests', 'attendance',
  'attendance_extensions', 'attendance_worker', 'audit_log', 'bank_accounts',
  'bk_quotes', 'bs_clients', 'bs_quotes', 'budgets_marketing', 'campaigns',
  'cash_advances', 'cash_disbursement_journal', 'cash_receipt_journal',
  'clients', 'conversations', 'departments', 'design_clients',
  'design_drawings', 'expenses', 'finance_delete_requests', 'finance_periods',
  'finance_records', 'general_journal', 'gov_biddings', 'handbook',
  'hub_files', 'hub_folders', 'id_verify', 'inventory_items', 'it_access',
  'it_assets', 'it_network', 'it_software', 'it_tickets', 'job_costs',
  'job_projects', 'kpi_evals', 'kpi_targets', 'leave_accruals',
  'leave_balances', 'leave_requests', 'ledger', 'memos', 'notifications',
  'order_tracking', 'partner_deals', 'pay_runs', 'payroll',
  'payroll_ca_overrides', 'payroll_delete_requests', 'payslips',
  'pending_raises', 'policies', 'posts', 'president_message',
  'production_orders', 'products', 'projects', 'promotions',
  'purchase_requisitions', 'quotes', 'resources', 'salary_history',
  'salary_raises', 'sales_clients', 'sales_orders', 'settings',
  'settings_holidays', 'signup_requests', 'sops', 'stock_movements',
  'strategy_notes', 'submissions', 'suggestions', 'system_health', 'tasks',
  'tax_records', 'usernames', 'users', 'worker_directory', 'worker_profiles',
];

function scanRootCollections(jsDir) {
  const names = new Set();
  const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
  const pattern = /\.collection\(\s*['"]([a-z_0-9]+)['"]/gi;
  for (const file of files) {
    const src = fs.readFileSync(path.join(jsDir, file), 'utf-8');
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
