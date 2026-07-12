// js/finance-ledger.js — v13 Phase 12: the Ledger service.
// 'use strict';
//
// GOAL (V13-PLAN.md Phase 12, C5/H1): one transactional money API so a ledger
// dedupe check can never fail open, and a source-doc write + its project-sync
// write can never drift apart. This file implements the SERVICE ONLY — Phase
// 13 migrates the six existing posters onto it (see MIGRATION MAP below);
// Phase 14 adds Ledger.upsertByRef's payroll wiring + the legacy-id backfill
// tool. Nothing in departments.js/config.js is touched by this phase.
//
// ── API CONTRACT ───────────────────────────────────────────────────────────
// window.Ledger.post(entry) -> Promise<{existed, id, legacy?}>
//   entry = {
//     ref            (required) deterministic string, e.g. 'EXP-abc123',
//                    'CRJ-abc123-AR', 'PAY-2026-07-uid123'. Doc id = sanitize(ref).
//     date           (required) ISO 'YYYY-MM-DD' — fed straight to assertPeriodOpen
//                    and written as the row's `date` (matches firestore.rules'
//                    ledgerDateOk() regex).
//     description, amount, kind      kind is the existing `type` field
//                    ('debit'|'credit') — see NOTE below on naming.
//     vatTreatment   'inclusive' (default) | 'exclusive' | 'exempt' — fed to
//                    window.vatSplit(amount, vatTreatment); result's net/vat
//                    are NOT auto-attached to every row (posters disagree on
//                    which field name — inputVat vs nothing at all — so the
//                    computed split is exposed on the return value AND merged
//                    into `extra` only if the caller didn't already set inputVat
//                    itself). Callers that don't pass vatTreatment get the
//                    pre-existing raw-amount behavior (no VAT fields written).
//     dept, source, sourceId, bankAccountId, bankAccountName, accountType,
//     category, account, refNumber-shaped fields — all optional; mapped
//     straight through onto the row (see _mapEntry below for the exact set
//     the six legacy posters actually write).
//     projectSync    optional {collection, docId, fields} — fields (an object,
//                    caller pre-computes the values) is applied via tx.update
//                    on that doc IN THE SAME TRANSACTION as the ledger write.
//     extra          optional passthrough object merged onto the row as-is —
//                    this is how Phase 13 loses zero poster-specific fields
//                    (inputVat, bankFlow, caPlan-adjacent stuff, etc.) without
//                    this service knowing about every one of them by name.
//   }
//   Returns { existed:true,  id }              — legacy OR deterministic row already there, nothing written.
//   Returns { existed:true,  id, legacy:true }  — found via the legacy refNumber query, not the deterministic doc.
//   Returns { existed:false, id }               — freshly posted.
//
// window.Ledger.upsertByRef(ref, buildEntry) -> Promise<{id, created}>
//   buildEntry(existingDataOrNull) -> full row object (mapped, ready to write/patch).
//   For payroll re-runs and any other "recompute + overwrite" poster. Transactional
//   read-modify-write on the deterministic id; if a LEGACY row is found first (via
//   the same pre-transaction query guard as .post), the transaction updates that
//   DocumentReference instead of creating a new deterministic-id row — so a
//   re-run against pre-Phase-14 data still converges on one row, not two.
//
// window.Ledger.postMulti(entries, {projectSync} = {}) -> Promise<{results, existedAll}>
//   entries: array of the same shape as .post's entry (each needs its own ref).
//   ALL legs + the one optional projectSync commit in a single transaction —
//   all-or-nothing. This is the shape Production COS (expense leg + Inventory
//   contra leg) and the CRJ/CDJ two-leg (income/expense + AR/AP settlement)
//   posters need; Phase 13 is expected to route both through this instead of
//   the current two-separate-await pattern (which can leave one leg posted and
//   the other missing if the second write throws).
//
// window.Ledger._selfTest() -> void (dev-only, console.assert-based)
//   PURE — never touches Firestore. Exercises sanitize(), _mapEntry(), and the
//   vatSplit wiring against fixtures so it's safe to call from a console at any
//   time (prod or dev) without corrupting data. It does NOT prove the
//   transactional dedupe path (that needs the emulator — out of scope for a
//   pure client-side self-test); the header above documents that limitation.
//
// ── KEY DESIGN DECISIONS ────────────────────────────────────────────────────
// 1. Deterministic doc id (`ledger/{sanitize(ref)}`) replaces the six posters'
//    `.where('refNumber','==',ref).limit(1).get().catch(()=>({empty:true}))`
//    pattern. That pattern fails OPEN: a query rejected by a rules bug, a
//    network blip, or an offline-cache miss silently returns "empty" and the
//    caller posts a duplicate. A transactional `tx.get(docRef)` on a
//    deterministic id has no such failure mode — if the read fails, the
//    transaction fails, and the caller sees an error instead of a silent
//    double-post.
// 2. LEGACY COMPAT: five years of production data already has ledger rows at
//    random auto-ids with a matching `refNumber` field, not at `ledger/{ref}`.
//    A query-by-refNumber guard therefore still runs BEFORE the transaction to
//    catch those. Per the assignment's explicit instruction, this guard's
//    error handling is the opposite of the old pattern: if the query THROWS,
//    the error PROPAGATES (no catch-to-empty). A caller that can't verify
//    "does this legacy row exist" must not proceed to write — that is the
//    fail-open bug this whole phase exists to kill. Phase 14 migrates legacy
//    rows onto deterministic ids; until then, every .post()/.upsertByRef()
//    call pays for one extra query. Once Phase 14's backfill tool has run
//    against a given refNumber prefix, this guard becomes a no-op for it (empty
//    query, not-found) — no code changes required to keep working correctly.
// 3. `kind` vs `type`: the six existing posters and every downstream reader
//    (Finance Overview, reports, exports) key off a Firestore field literally
//    named `type` (values 'debit'|'credit'). This service accepts `entry.kind`
//    on the input (matches V13-PLAN.md's own entry shape) but WRITES it to the
//    `type` field on the row — renaming the wire field would silently break
//    every existing reader. Phase 13 migrations can pass `kind` without
//    touching a single downstream consumer.
// 4. Sanitize: Firestore doc ids can't contain '/'. Every existing refNumber
//    scheme (EXP-, CRJ-, CDJ-, PAY-, WPAY-, POCOS-) is already '/'-free, so
//    sanitize() is a defensive no-op for all current callers and only matters
//    if a future ref embeds something like a raw email or path segment.
// 5. Rules compatibility: firestore.rules' `/ledger/{docId}` block places no
//    constraint on docId — only on the row's fields (date shape, period-open,
//    bankFlow enum, canFinance()/Production-COS-shape create gate). Switching
//    from random ids to `sanitize(ref)` ids requires NO rules change. Verified
//    by reading firestore.rules ~line 1030-1073 (ledgerDateOk/ledgerPeriodOpen/
//    the Production COS special case) before writing this file — this service
//    is deliberately field-shape-compatible with what those rules expect from
//    every one of the six legacy posters (type/accountType/category/refNumber/
//    amount/source/bankFlow).
//
// ── MIGRATION MAP (Phase 13's checklist — do not remove) ───────────────────
//   postExpenseToLedger        (departments.js ~1706) → Ledger.post({ref:`EXP-${expId}`, kind:'debit', ...})
//   postCRJToLedger            (departments.js ~1739) → Ledger.postMulti([income leg, AR leg]) — refs `CRJ-${id}` + `CRJ-${id}-AR`
//   postCDJToLedger            (departments.js ~1786) → Ledger.postMulti([expense leg, AP leg]) — refs `CDJ-${id}` + `CDJ-${id}-AP`
//   resyncLedgerForSource      (departments.js ~1840) → Ledger.upsertByRef(ref, buildEntry) per leg (expense/CRJ/CDJ + AR/AP legs)
//   payroll inline upsertLedger (departments.js ~3596, inside disbursePayRun) → Ledger.upsertByRef(`PAY-${month}-${uid}`, buildEntry) [Phase 14 — needs the same-transaction batching payroll already does per-employee]
//   manual ledger save (save-led-btn handler, departments.js ~4951) → Ledger.post({ref: <user-entered led-ref>, ...}) — first caller to hand assertPeriodOpen's job fully to the service
//   payslip submit poster ("WPAY-" ref, departments.js ~6273-6296)  → Ledger.upsertByRef(`WPAY-${ps.id}`, buildEntry)
//   Production COS (V13-PLAN.md Phase 13 item, departments.js ~13913-13997, ref `POCOS-*` / `POCOS-*-INV`) → Ledger.postMulti([expense leg, Inventory contra leg]) — the rules' Production-shape special case (firestore.rules ~1050-1069) must keep matching this write shape unchanged.
//
;(function () {
  'use strict';

  function sanitize(ref) {
    return String(ref == null ? '' : ref).replace(/\//g, '_');
  }

  function ledgerRef(id) {
    return db.collection('ledger').doc(id);
  }

  function whoFields() {
    return {
      addedBy: (window.currentUser && window.currentUser.uid) || null,
      addedByName: (window.userProfile && window.userProfile.displayName) ||
        (window.currentUser && window.currentUser.email) || ''
    };
  }

  // Maps a Ledger.post()-shaped entry onto the row Firestore actually stores.
  // Pure function — no I/O — so _selfTest can exercise it directly.
  function _mapEntry(entry) {
    var vat = null;
    if (entry.vatTreatment && typeof window.vatSplit === 'function') {
      vat = window.vatSplit(entry.amount, entry.vatTreatment);
    }
    var row = {
      date: entry.date,
      type: entry.kind,
      accountType: entry.accountType,
      account: entry.account || entry.category,
      description: entry.description || '',
      amount: entry.amount || 0,
      category: entry.category || entry.account,
      refNumber: entry.ref,
      source: entry.source,
      dept: entry.dept,
      projectId: entry.projectId,
      bankAccountId: entry.bankAccountId,
      bankAccountName: entry.bankAccountName || null
    };
    // Strip undefined keys — Firestore rejects `undefined`, and every field
    // above is optional on the input.
    Object.keys(row).forEach(function (k) { if (row[k] === undefined) delete row[k]; });
    Object.assign(row, whoFields());
    if (vat && row.inputVat === undefined && (entry.extra || {}).inputVat === undefined) {
      // Only auto-attach when the caller didn't already decide the field name/value
      // itself — some posters store `vatAmount`, others `inputVat`, others nothing.
      row.inputVat = vat.vat;
    }
    if (entry.extra) Object.assign(row, entry.extra);
    return row;
  }

  // Pre-transaction legacy guard. THROWS propagate — never treated as empty.
  // Returns the existing legacy DocumentReference, or null if genuinely absent.
  async function _findLegacyRef(ref) {
    var snap = await db.collection('ledger').where('refNumber', '==', ref).limit(1).get();
    return snap.docs.length ? snap.docs[0].ref : null;
  }

  async function post(entry) {
    if (!entry || !entry.ref) throw new Error('Ledger.post: entry.ref is required');
    if (!entry.date) throw new Error('Ledger.post: entry.date is required');
    await window.assertPeriodOpen(entry.date);

    var legacyRef = await _findLegacyRef(entry.ref); // may throw — intentionally uncaught
    if (legacyRef) return { existed: true, id: legacyRef.id, legacy: true };

    var docId = sanitize(entry.ref);
    var ref = ledgerRef(docId);
    var row = _mapEntry(entry);
    var projectSync = entry.projectSync;

    var result = await db.runTransaction(async function (tx) {
      var snap = await tx.get(ref);
      if (snap.exists) return { existed: true, id: docId };
      row.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      tx.set(ref, row);
      if (projectSync && projectSync.collection && projectSync.docId) {
        tx.update(db.collection(projectSync.collection).doc(projectSync.docId), projectSync.fields || {});
      }
      return { existed: false, id: docId };
    });

    if (!result.existed && typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
    return result;
  }

  async function upsertByRef(ref, buildEntry) {
    if (!ref) throw new Error('Ledger.upsertByRef: ref is required');
    var legacyRef = await _findLegacyRef(ref); // throws propagate

    var result = await db.runTransaction(async function (tx) {
      if (legacyRef) {
        var legacySnap = await tx.get(legacyRef);
        var built = _mapEntry(buildEntry(legacySnap.exists ? legacySnap.data() : null));
        tx.set(legacyRef, built, { merge: true });
        return { id: legacyRef.id, created: false };
      }
      var docId = sanitize(ref);
      var docRef = ledgerRef(docId);
      var snap = await tx.get(docRef);
      var built2 = _mapEntry(buildEntry(snap.exists ? snap.data() : null));
      if (snap.exists) {
        tx.set(docRef, built2, { merge: true });
        return { id: docId, created: false };
      }
      built2.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      tx.set(docRef, built2);
      return { id: docId, created: true };
    });

    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
    return result;
  }

  async function postMulti(entries, opts) {
    if (!Array.isArray(entries) || !entries.length) throw new Error('Ledger.postMulti: entries[] required');
    opts = opts || {};
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].ref || !entries[i].date) throw new Error('Ledger.postMulti: every entry needs ref + date');
    }
    // All legs share one period check — use the earliest/only date set (callers
    // post same-date legs; if they differ, check every distinct date).
    var dates = {};
    entries.forEach(function (e) { dates[e.date] = true; });
    for (var d in dates) await window.assertPeriodOpen(d);

    var refInfo = [];
    for (var j = 0; j < entries.length; j++) {
      var legacyRef = await _findLegacyRef(entries[j].ref); // throws propagate
      refInfo.push({ entry: entries[j], legacyRef: legacyRef, docId: sanitize(entries[j].ref) });
    }

    var projectSync = opts.projectSync;
    var result = await db.runTransaction(async function (tx) {
      var results = [];
      var reads = [];
      for (var k = 0; k < refInfo.length; k++) {
        var info = refInfo[k];
        var ref = info.legacyRef || ledgerRef(info.docId);
        var snap = await tx.get(ref);
        reads.push({ info: info, ref: ref, snap: snap });
      }
      reads.forEach(function (r) {
        if (r.snap.exists) {
          results.push({ ref: r.info.entry.ref, existed: true, id: r.ref.id, legacy: !!r.info.legacyRef });
          return;
        }
        var row = _mapEntry(r.info.entry);
        row.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        tx.set(r.ref, row);
        results.push({ ref: r.info.entry.ref, existed: false, id: r.ref.id });
      });
      if (projectSync && projectSync.collection && projectSync.docId) {
        tx.update(db.collection(projectSync.collection).doc(projectSync.docId), projectSync.fields || {});
      }
      return results;
    });

    var existedAll = result.every(function (r) { return r.existed; });
    if (!existedAll && typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
    return { results: result, existedAll: existedAll };
  }

  // Never a direct delete — routes through the existing President-approval
  // finance-delete flow (see CLAUDE.md "Finance delete approval").
  async function remove(ref) {
    if (typeof window.financeDelete !== 'function') {
      throw new Error('Ledger.remove: window.financeDelete is not loaded (script order — finance-ledger.js loads before departments.js, which defines it; call this after app init, not at module scope)');
    }
    return window.financeDelete('ledger', sanitize(ref));
  }

  function _selfTest() {
    // PURE — no Firestore reads/writes. Exercises sanitize()/_mapEntry()/vatSplit
    // wiring against fixtures only. Does NOT prove the transactional dedupe path
    // (needs the emulator) — see header comment above.
    console.assert(sanitize('EXP-abc123') === 'EXP-abc123', 'sanitize: no-op on safe refs');
    console.assert(sanitize('A/B') === 'A_B', 'sanitize: replaces / with _');

    var row = _mapEntry({
      ref: 'EXP-test1', date: '2026-07-01', kind: 'debit', amount: 1120,
      vatTreatment: 'inclusive', description: 'Test expense', category: 'General Expense',
      accountType: 'expense', source: 'Expense'
    });
    console.assert(row.refNumber === 'EXP-test1', '_mapEntry: refNumber mapped from ref');
    console.assert(row.type === 'debit', '_mapEntry: kind -> type');
    console.assert(row.amount === 1120, '_mapEntry: amount passthrough');
    console.assert(typeof row.inputVat === 'number' && Math.abs(row.inputVat - 120) < 0.01,
      '_mapEntry: vatSplit(1120, inclusive) auto-attaches inputVat ~120');
    console.assert(row.account === 'General Expense', '_mapEntry: account falls back to category');

    var rowNoVat = _mapEntry({ ref: 'CRJ-test1', date: '2026-07-01', kind: 'credit', amount: 500, category: 'Sales Revenue' });
    console.assert(rowNoVat.inputVat === undefined, '_mapEntry: no vatTreatment -> no inputVat field');

    var rowExtra = _mapEntry({ ref: 'CDJ-test1', date: '2026-07-01', kind: 'debit', amount: 200, extra: { inputVat: 99, bankFlow: 'out' } });
    console.assert(rowExtra.inputVat === 99, '_mapEntry: extra.inputVat wins over auto-computed');
    console.assert(rowExtra.bankFlow === 'out', '_mapEntry: extra fields merge onto row');

    console.log('[Ledger._selfTest] pure checks passed (sanitize/_mapEntry/vatSplit wiring). Transactional dedupe path NOT covered — requires the emulator.');
  }

  window.Ledger = { post: post, upsertByRef: upsertByRef, postMulti: postMulti, remove: remove, _selfTest: _selfTest, _mapEntry: _mapEntry, _sanitize: sanitize };
})();
