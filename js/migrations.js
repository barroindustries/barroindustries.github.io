/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — One-time / rare maintenance tools
   migrations.js (v13 Phase 37)

   Moved verbatim out of js/departments.js — zero logic changes.
   These are president-run, dry-run-first, idempotent, re-runnable
   tools that don't belong on the hot navigation path. Buttons that
   trigger them stay in departments.js; only the handler bodies moved
   here. Loaded as a normal deferred classic script AFTER
   departments.js (see index.html) — NOT lazy-loaded via dynamic
   import as V13-PLAN.md's Phase 37 originally specified. Deviation:
   lazy-loading via a Maintenance page is deferred to a later pass;
   this pass only wins the hot-file line-count reduction and the
   file separation. All functions remain window-attached under their
   existing names so every existing call site keeps working unchanged.

   migrateStrandedBKQuotes (app.js) is NOT moved in this pass — app.js
   is owned by another agent this pass; it stays put.
═══════════════════════════════════════════════════ */

'use strict';

// One-time (re-runnable) tag of existing docs with a `kind` field so the two
// collections are queryable/identifiable. Idempotent — skips docs already tagged.
window.backfillProjectKind = async function() {
  const [jp, pr] = await Promise.all([
    db.collection('job_projects').get().catch(() => ({ docs: [] })),
    db.collection('projects').get().catch(() => ({ docs: [] }))
  ]);
  const tagMissing = async (docs, kind) => {
    let n = 0, pending = [];
    for (const d of docs) {
      if (d.data().kind) continue;
      pending.push(d.ref); n++;
      if (pending.length === 400) { const b = db.batch(); pending.forEach(r => b.update(r, { kind })); await b.commit(); pending = []; }
    }
    if (pending.length) { const b = db.batch(); pending.forEach(r => b.update(r, { kind })); await b.commit(); }
    return n;
  };
  const jobs = await tagMissing(jp.docs, 'job');
  const designs = await tagMissing(pr.docs, 'design');
  return { jobs, designs, tagged: jobs + designs };
};

window.runProjectKindBackfill = async function() {
  if (!(await confirmDialog({message:'Tag existing projects with their kind (job / design)?\n\nSafe to run repeatedly — already-tagged projects are skipped.'}))) return;
  try {
    const r = await window.backfillProjectKind();
    Notifs.success(`Tagged ✓ ${r.jobs} job + ${r.designs} design projects.`);
  } catch (e) { Notifs.showToast('Tagging failed: ' + (e.message || e), 'error'); }
};

// One-time: re-point projects.clientId from legacy design_clients ids to the
// unified clients ids via the migratedTo stamp WS32's migrateClientBooks()
// writes. Idempotent: a clientId that no longer matches a design_clients doc
// (already remapped, or never was a legacy id) is skipped. Run once from a
// president/manager console session after migrateClientBooks() has run.
window.remapDesignProjectClients = async function(){
  const [pSnap, dcSnap] = await Promise.all([
    db.collection('projects').get(), db.collection('design_clients').get().catch(()=>({docs:[]}))]);
  const map = {};   // legacy design_clients id -> clients id
  dcSnap.docs.forEach(d => { const m = d.data().migratedTo; if (m && m.id) map[d.id] = m.id; });
  let batch = db.batch(), n = 0, done = 0;
  for (const doc of pSnap.docs) {
    const cid = doc.data().clientId;
    if (!cid || !map[cid]) continue;
    batch.update(doc.ref, { clientId: map[cid], updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    done++; if (++n === 400) { await batch.commit(); batch = db.batch(); n = 0; }
  }
  if (n) await batch.commit();
  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('projects-unified');
  console.log(`remapDesignProjectClients: ${done} project(s) re-pointed`);
  return { remapped: done, scanned: pSnap.size };
};

// One-click, RE-RUNNABLE unification: legacy books → `clients`, then clientId
// backfill onto sales_orders/job_projects. Idempotency: legacy docs stamped
// `migratedTo` are skipped; same-name records MERGE (brands arrayUnion +
// fill-only-empty fields) instead of duplicating; FK backfill skips rows that
// already carry clientId. Safe to re-run after a partial failure.
window.migrateClientBooks = async function () {
  const FV = firebase.firestore.FieldValue;
  const key = window.Clients.nameKey;
  const out = { created:0, merged:0, skipped:0, soTagged:0, jpTagged:0, unmatched:0 };
  const cur = await db.collection('clients').get().catch(() => ({ docs: [] }));
  const byKey = {};
  cur.docs.forEach(d => { const x = d.data(); byKey[x.nameKey || key(x.name)] = { id: d.id, ...x }; });
  const RANK = { lead:0, prospect:1, won:2, lost:0 };   // 'lost' never overwrites a live stage
  for (const [coll, brand] of [['sales_clients','sales'], ['design_clients','design'], ['bs_clients','bs']]) {
    const snap = await db.collection(coll).get().catch(() => ({ docs: [] }));
    for (const d of snap.docs) {
      const src = d.data();
      if (src.migratedTo) { out.skipped++; continue; }
      const k = key(src.name); if (!k) { out.skipped++; continue; }
      const target = byKey[k];
      if (target) {   // MERGE: add brand, fill only-empty fields, keep the further-along stage
        const patch = { brands: FV.arrayUnion(brand), legacyRefs: FV.arrayUnion({ coll, id: d.id }), updatedAt: FV.serverTimestamp() };
        ['company','email','phone','address','notes','followUpDate','lastContact','lastQuoteNumber'].forEach(f => { if (!target[f] && src[f]) patch[f] = src[f]; });
        if ((RANK[src.stage] || 0) > (RANK[target.stage] || 0)) patch.stage = src.stage;
        await db.collection('clients').doc(target.id).set(patch, { merge: true });
        out.merged++;
      } else {        // CREATE: full copy, createdAt preserved so ordering/history survive
        const base = { name:(src.name||'').trim(), nameKey:k, brands:[brand],
          company:src.company||'', email:src.email||'', phone:src.phone||'', address:src.address||'', notes:src.notes||'',
          stage: ['lead','prospect','won','lost'].includes(src.stage) ? src.stage : 'lead',
          followUpDate:src.followUpDate||'', lastContact:src.lastContact||'', contactLog:[],
          lastQuoteNumber:src.lastQuoteNumber||'', lastQuoteTotal:src.lastQuoteTotal||0,
          legacyRefs:[{ coll, id:d.id }], createdBy:src.addedBy||src.createdBy||null,
          createdAt: src.createdAt || FV.serverTimestamp(), updatedAt: FV.serverTimestamp() };
        const ref = await db.collection('clients').add(base);
        byKey[k] = { id: ref.id, ...base };
        out.created++;
      }
      await db.collection(coll).doc(d.id).set({ migratedTo: { coll:'clients', id: byKey[k].id } }, { merge: true });
    }
  }
  // clientId FK backfill — unique nameKey match; no match → stays null (the
  // nameKey fallback in Clients.quotesFor/timelineFor is the reconciliation).
  for (const coll of ['sales_orders', 'job_projects']) {
    const snap = await db.collection(coll).get().catch(() => ({ docs: [] }));
    for (const d of snap.docs) {
      const r = d.data(); if (r.clientId) continue;
      const hit = byKey[key(r.clientName)];
      if (hit) { await db.collection(coll).doc(d.id).update({ clientId: hit.id }); (coll === 'sales_orders') ? out.soTagged++ : out.jpTagged++; }
      else out.unmatched++;
    }
  }
  if (typeof dbCacheInvalidate === 'function') ['clients','sales_orders','projects-unified','job_projects'].forEach(dbCacheInvalidate);
  return out;
};

// One-time (re-runnable) backfill: post existing approved expenses + all cash
// receipt / disbursement journal entries into the ledger so the books are complete
// before reports switch to ledger-only. Idempotent — each post* helper skips rows
// already mirrored (keyed by EXP-/CRJ-/CDJ-<id>), so running twice is harmless.
window.backfillLedgerFromJournals = async function() {
  const [expSnap, crjSnap, cdjSnap] = await Promise.all([
    db.collection('expenses').where('status','==','approved').get().catch(()=>({docs:[]})),
    db.collection('cash_receipt_journal').get().catch(()=>({docs:[]})),
    db.collection('cash_disbursement_journal').get().catch(()=>({docs:[]}))
  ]);
  // Pre-check closed months so a bulk backfill over historical data never spams
  // the period-closed toast once per row — soft-skip and report a count instead
  // (same convention as backfillPayrollLedger's month-skip).
  let exp=0, crj=0, cdj=0, skipped=0;
  for (const d of expSnap.docs) {
    const e = d.data();
    if (await window.isPeriodClosed(e.date || today())) { skipped++; continue; }
    if (await postExpenseToLedger(d.id, e).catch(()=>false)) exp++;
  }
  for (const d of crjSnap.docs) {
    const e = d.data();
    if (await window.isPeriodClosed(e.date || today())) { skipped++; continue; }
    if (await postCRJToLedger(d.id, e).catch(()=>false)) crj++;
  }
  for (const d of cdjSnap.docs) {
    const e = d.data();
    if (await window.isPeriodClosed(e.date || today())) { skipped++; continue; }
    if (await postCDJToLedger(d.id, e).catch(()=>false)) cdj++;
  }
  if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('ledger'); dbCacheInvalidate('expenses'); }
  return { exp, crj, cdj, skipped };
};

// Recreate missing PAY-{month}-{uid} ledger rows from salary_history. Covers months
// computed while the Compute crash (v11, 'existing' ReferenceError) blocked ledger
// posting — salary_history committed before the crash, so it is the recovery source.
// Idempotent: skips any month+user whose PAY- ref already exists.
window.backfillPayrollLedger = async function() {
  const sh = await db.collection('salary_history').get().catch(()=>({docs:[]}));
  let posted = 0, skipped = 0;
  for (const d of sh.docs) {
    const h = d.data();
    const month = h.month, uid = h.userId || (d.id.includes('_') ? d.id.split('_')[0] : null);
    const net = (h.finalPay != null ? h.finalPay : h.netPay) || 0;
    if (!month || !uid || net <= 0) continue;
    // Soft-skip closed months (v12 WS12) — a bulk recovery tool must never spam
    // a per-row toast; report the count instead.
    if (await window.isPeriodClosed(month + '-01')) { skipped++; continue; }
    const ref = `PAY-${month}-${uid}`;
    const ex = await db.collection('ledger').where('refNumber','==',ref).limit(1).get().catch(()=>null);
    if (!ex || ex.docs.length) continue;   // exists, or read failed — never risk a duplicate
    await db.collection('ledger').add({
      date:        month + '-01',
      type:        'debit',
      accountType: 'expense', account: 'Payroll Expense',
      description: `Payslip — ${h.userName||'?'} (${window.fmtMonthLabel(month)})`,
      amount:      net,
      category:    'Payroll Expense',
      source:      'Finance',
      refNumber:   ref,
      addedBy:     currentUser.uid,
      addedByName: 'Payroll backfill',
      createdAt:   firebase.firestore.FieldValue.serverTimestamp()
    });
    posted++;
  }
  return { posted, skipped };
};

// ── One-time maintenance: Tag account types (v12 WS13, president, idempotent) ──
// Backfills accountType/account onto every ledger row that predates the chart
// of accounts, via ledgerKind()'s legacy-derivation rule. Re-runnable — skips
// rows that already have accountType.
window.runTagAccountTypes = async function() {
  if (!(await confirmDialog({message:'Backfill accountType on every legacy ledger row?\n\nSafe to run repeatedly.'}))) return;
  Notifs.showToast('Tagging account types…');
  try {
    const snap = await db.collection('ledger').get();
    const todo = snap.docs.filter(d => typeof d.data().accountType !== 'string');
    let batch = db.batch(), inBatch = 0, tagged = 0;
    for (const d of todo) {
      const row = d.data();
      batch.update(d.ref, { accountType: ledgerKind(row), account: row.category || null });
      inBatch++; tagged++;
      if (inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
    }
    if (inBatch) await batch.commit();
    dbCacheInvalidate('ledger');
    window.logAudit && window.logAudit('tag-account-types','ledger',null,{tagged});
    Notifs.success(`Tagged ${tagged} row${tagged===1?'':'s'} ✓`);
  } catch (e) { Notifs.showToast('Tagging failed: '+(e.message||e),'error'); }
};

// ── One-time maintenance: Restate material costs (v12 WS13, president) ───
// Fixes the double-material-expensing bug: (a) reclassifies historical
// purchase-side CDJ mirrors that came from Purchasing (purchaseRef set,
// debitMaterial>0) to asset/Inventory; (b) backfills the missing
// POCOS-<id>-INV contra leg for every existing consumption row. Idempotent
// (keyed by refNumber) — safe to re-run.
window.runRestateMaterialCosts = async function() {
  if (!(await confirmDialog({message:'Restate historical material costs?\n\nThis corrects the double-counted purchase+consumption expense bug. Expense totals for past periods WILL change — this is a deliberate one-time restatement. Safe to run repeatedly.'}))) return;
  Notifs.showToast('Restating material costs…');
  try {
    let reclassified = 0, invLegsAdded = 0;
    // (a) purchase-side CDJ mirrors that should have been asset/Inventory
    const cdjSnap = await db.collection('cash_disbursement_journal').get().catch(()=>({docs:[]}));
    for (const d of cdjSnap.docs) {
      const e = d.data();
      if (!e.purchaseRef || !(e.debitMaterial > 0)) continue;
      const ref = `CDJ-${d.id}`;
      const lSnap = await db.collection('ledger').where('refNumber','==',ref).limit(1).get().catch(()=>({docs:[]}));
      if (!lSnap.docs.length) continue;
      const lRow = lSnap.docs[0];
      if (lRow.data().accountType === 'asset') continue; // already restated
      await lRow.ref.update({ accountType:'asset', account:'Inventory', category:'Inventory – Materials' });
      reclassified++;
    }
    // (b) missing POCOS-<id>-INV contra legs
    const allLedger = await db.collection('ledger').get().catch(()=>({docs:[]}));
    const pocosRows = allLedger.docs.filter(d => {
      const ref = d.data().refNumber || '';
      return ref.startsWith('POCOS-') && !ref.endsWith('-INV');
    });
    const existingInv = new Set(allLedger.docs.filter(d=>(d.data().refNumber||'').endsWith('-INV')).map(d=>d.data().refNumber));
    for (const d of pocosRows) {
      const row = d.data();
      const refInv = row.refNumber + '-INV';
      if (existingInv.has(refInv)) continue;
      if (!(row.amount > 0)) continue;
      await db.collection('ledger').add({
        date: row.date || today(), type: 'credit',
        accountType: 'asset', account: 'Inventory', category: 'Inventory – Materials',
        description: `Inventory consumed — ${(row.description||'').replace(/^COS.*?—\s*/,'') || row.refNumber}`,
        amount: row.amount, refNumber: refInv, source: 'Production',
        projectId: row.projectId || null,
        addedBy: currentUser.uid, addedByName: 'Restatement',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      invLegsAdded++;
    }
    dbCacheInvalidate('ledger');
    window.logAudit && window.logAudit('restate-materials','ledger',null,{reclassified, invLegsAdded});
    Notifs.success(`Restated ${reclassified} purchase${reclassified===1?'':'s'}, added ${invLegsAdded} inventory leg${invLegsAdded===1?'':'s'} ✓`);
    const el = document.getElementById('fin-content');
    if (el) window.renderFinancialReports(el, window.currentUser, window.currentRole, 'all');
  } catch (e) { Notifs.showToast('Restatement failed: '+(e.message||e),'error'); }
};

// ── One-time maintenance: Fix undated rows (v12 WS12, president, idempotent) ──
// orderBy('date') silently DROPS any row with a missing/malformed date — this
// repairs historical rows so they reappear in every report. Re-runnable.
window.runFixUndatedRows = async function() {
  if (!(await confirmDialog({message:"Repair ledger + journal rows with a missing or malformed date?\n\nSafe to run repeatedly."}))) return;
  Notifs.showToast('Scanning for undated rows…');
  try {
    const dateRe = /^\d{4}-\d{2}(-\d{2})?$/;
    const manilaDateOf = (ts) => {
      try {
        const d = ts && ts.toDate ? ts.toDate() : (ts && ts.seconds ? new Date(ts.seconds*1000) : null);
        return d ? window.bizDate(d) : today();
      } catch(_) { return today(); }
    };
    let fixed = 0;
    for (const collName of ['ledger','general_journal']) {
      const snap = await db.collection(collName).get().catch(()=>({docs:[]}));
      const bad = snap.docs.filter(d => !dateRe.test(String(d.data().date||'')));
      let batch = db.batch(), inBatch = 0;
      for (const d of bad) {
        const newDate = manilaDateOf(d.data().createdAt);
        batch.update(d.ref, { date: newDate });
        inBatch++; fixed++;
        if (inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
      }
      if (inBatch) await batch.commit();
    }
    dbCacheInvalidate('ledger');
    window.logAudit && window.logAudit('fix-undated','ledger',null,{fixed});
    Notifs.success(`Fixed ${fixed} undated row${fixed===1?'':'s'} ✓`);
    const el = document.getElementById('fin-content');
    if (el) window.renderFinancialReports(el, window.currentUser, window.currentRole, 'all');
  } catch (e) { Notifs.showToast('Fix failed: '+(e.message||e),'error'); }
};

// ── One-time maintenance: Migrate ledger ids (v13 Phase 14, president) ────
// Copies legacy random-id ledger docs to deterministic `ledger/{ref}` ids
// (for refs matching the known prefixes) and deletes the originals. The
// actual migration logic lives in window.Ledger.migrateLegacyRows (js/finance-ledger.js),
// signature: Ledger.migrateLegacyRows({dryRun}) -> {scanned, migratable, migrated, skipped}.
// Always dry-runs first and reports counts before offering to apply.
window.runMigrateLedgerIds = async function(btn) {
  if (!window.Ledger || typeof window.Ledger.migrateLegacyRows !== 'function') {
    Notifs.error('Migration tool not loaded'); return;
  }
  if (!(await confirmDialog({message:'Run a dry-run scan for legacy random-id ledger rows?\n\nNo data will be changed yet.'}))) return;
  await window.busy(btn, async () => {
    let dry;
    try {
      dry = await window.Ledger.migrateLegacyRows({dryRun:true});
    } catch (e) { Notifs.error('Dry-run failed: '+(e.message||e)); return; }
    console.table([dry]);
    const summary = `Scanned ${dry.scanned}, migratable ${dry.migratable}, already migrated ${dry.migrated}, skipped ${dry.skipped}.`;
    Notifs.info(`Dry-run: ${summary}`);
    if (!dry.migratable) { Notifs.info('Nothing to migrate.'); return; }
    if (!(await confirmDialog({message:`${summary}\n\nApply the migration now? This copies rows to deterministic ids and deletes the originals.`, danger:true}))) return;
    try {
      const applied = await window.Ledger.migrateLegacyRows({dryRun:false});
      console.table([applied]);
      dbCacheInvalidate('ledger');
      window.logAudit && window.logAudit('migrate-ledger-ids','ledger',null,applied);
      Notifs.success(`Migrated ${applied.migrated} row${applied.migrated===1?'':'s'} ✓ (skipped ${applied.skipped})`);
    } catch (e) { Notifs.error('Migration failed: '+(e.message||e)); }
  });
};

// ── CA data repair (v12 WS22 migration) — dry-runnable, idempotent, president-
// gated one-time fix for live inconsistencies the pre-service code produced:
// (1) 'active' status (financeDeleteCascade's old bug — never a real status,
//     invisible to every status==='approved' filter incl. payroll's own),
// (2) interest silently dropped by paths B/C (approved with raw amount instead
//     of totalPayable) — restored ONLY for untouched loans (no payments yet);
//     mid-repayment matches are listed for Neil's own call, not auto-fixed,
// (3) legacy no-terms docs (the old app.js dead form) get an explicit
//     single-payment plan {terms:1, monthlyPayment:balance} — same behavior,
//     now explicit instead of undefined.
window.runCADataRepair = async function(dryRun = true) {
  const snap = await db.collection('cash_advances').get().catch(()=>({docs:[]}));
  const docs = snap.docs.map(d=>({ id:d.id, ref:d.ref, ...d.data() }));
  const report = { normalizedActive:[], interestRestored:[], midRepaymentFlagged:[], legacyTermsBackfilled:[] };
  const batch = db.batch();
  let writeCount = 0;

  for (const d of docs) {
    if (d.status === 'active') {
      report.normalizedActive.push({ id:d.id, userName:d.userName||'?' });
      if (!dryRun) { batch.update(d.ref, { status:'approved' }); writeCount++; }
    }
    const paidSoFar = (d.payments||[]).reduce((s,p)=>s+(p.amount||0),0);
    if (d.interestCharged && d.status==='approved' && d.totalPayable!=null && d.totalPayable!==d.amount) {
      if (!d.payments || !d.payments.length) {
        if (d.balance === d.amount) {
          report.interestRestored.push({ id:d.id, userName:d.userName||'?', from:d.balance, to:d.totalPayable });
          if (!dryRun) { batch.update(d.ref, { balance:d.totalPayable }); writeCount++; }
        }
      } else if (Math.abs((d.balance+paidSoFar)-d.amount) < 1 && Math.abs((d.balance+paidSoFar)-d.totalPayable) > 1) {
        // Mid-repayment with the same signature — retro-charging interest on a
        // partially repaid loan is a policy decision, not a data repair.
        report.midRepaymentFlagged.push({ id:d.id, userName:d.userName||'?', balance:d.balance, paidSoFar, totalPayable:d.totalPayable });
      }
    }
    if (d.status !== 'rejected' && d.status !== 'pending' && d.terms == null) {
      report.legacyTermsBackfilled.push({ id:d.id, userName:d.userName||'?' });
      if (!dryRun) { batch.update(d.ref, { terms:1, monthlyPayment: d.balance!=null ? d.balance : d.amount }); writeCount++; }
    }
  }

  if (!dryRun && writeCount) await batch.commit();
  window.logAudit && window.logAudit(dryRun?'ca-repair-dry-run':'ca-repair-apply','cash_advances','bulk',{ writeCount });
  return report;
};
