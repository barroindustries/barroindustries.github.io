// js/finance-ledger.js — v13 Phase 12: the Ledger service.
// 'use strict';
//
// GOAL (V13-PLAN.md Phase 12, C5/H1): one transactional money API so a ledger
// dedupe check can never fail open, and a source-doc write + its project-sync
// write can never drift apart. This file implements the SERVICE ONLY — Phase
// 13 migrates the six existing posters onto it (see MIGRATION MAP below);
// Phase 14 adds Ledger.upsertByRef's payroll wiring + the legacy-id backfill
// tool (window.Ledger.migrateLegacyRows — see its header comment above the
// definition, near the bottom of this file). Nothing in departments.js/
// config.js is touched by this phase (departments.js wires a president-only
// button to call it separately).
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
// ── v14 Wave 4 Batch F2: finance_rollup aggregates ─────────────────────────
// `finance_rollup/{yyyymm}` (+ the special 'undated' doc) holds monthly
// {month, income, expense, vatOutput, vatInput, byCategory:{cat:{income,expense}},
// count, updatedAt} so Overview/all-time cards can sum ≤N month-docs instead of
// scanning the whole ledger collection. Month is derived from the ROW's own
// `date` field (already Manila-discipline ISO, per CLAUDE.md) via .slice(0,7);
// a missing/malformed date buckets into 'undated'.
//
// CONSTRAINT (deliberate, not an oversight): rollup writes are NEVER inside
// the ledger's own post/postMulti/upsertByRef transaction. A rules-denied
// rollup write must not abort the money posting it's attached to — so every
// _syncRollup() call below fires as a SEPARATE best-effort write AFTER the
// ledger transaction has already committed, wrapped in try/catch that only
// console.warns on failure. The resulting drift-until-reconciled window is
// accepted risk; window.Ledger.rebuildRollups() (a full ledger rescan that
// overwrites every rollup doc from scratch) is the reconciliation tool —
// wired to a president-only button in Finance Tools (departments.js).
//
// Per-row math (income/expense/vatOutput/vatInput/category) is NOT
// reimplemented here — window.ledgerKind(row) and window.computeVatSummary([row])
// (js/config.js + js/bir.js, both loaded before this file's callers ever run)
// are called on a single-row array so a rollup can never compute a different
// number than Reports/the 2550 worksheet for the same row. Zero-drift by
// construction, not by convention.
//
// Coverage — every mutation path that changes a ledger row's money fields:
//   post/postMulti (new rows)        -> _syncRollup(newRow, +1) after commit,
//                                        only for legs actually written (not
//                                        `existed` dedupe hits — no double-count).
//   upsertByRef (recompute+overwrite) -> _syncRollup(oldRow, -1) then
//                                        _syncRollup(newRow, +1), using the SAME
//                                        pre-overwrite read (legacySnap/snap)
//                                        the transaction already does for its
//                                        merge logic — see upsertByRef below.
//   remove (any ledger-row delete)    -> Ledger.remove() itself is currently
//                                        UNCALLED (deletes route through
//                                        window.financeDelete -> financeExecuteDelete,
//                                        departments.js) — that choke point is
//                                        hooked directly in departments.js instead,
//                                        covering every delete entry point at once.
//   rebuildRollups()                  -> full rescan, delete-and-rewrite every
//                                        rollup doc from the current ledger
//                                        state. Idempotent; the reconciliation
//                                        authority for any drift above.
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
//   legacy random-id rows (all refNumber prefixes, five years of production data) → Ledger.migrateLegacyRows({dryRun}) [Phase 14 — one-time, president-only, run per environment after Phase 13 lands; see its header comment near the bottom of this file]
//
// UMD-ish shim (v14 re-audit — matches js/money-core.js's exact pattern):
// makes `window` exist under plain Node so tests/money.test.mjs can
// `require()` this file directly (for the pure helpers exposed on
// window.Ledger below — _mapEntry/_sanitize/_rollupDelta) with zero build
// step. In the browser, window already exists, so this is a no-op.
if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

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

  // ── finance_rollup helpers (v14 Wave 4 Batch F2) ──────────────────────────
  // Pure: given a ledger row, which month bucket does it belong to? Accepts
  // 'YYYY-MM' or 'YYYY-MM-DD' (matches firestore.rules' ledgerDateOk() regex —
  // anything that wouldn't pass that regex is exactly what we want in 'undated').
  function _rollupMonth(dateStr) {
    var m = /^(\d{4}-\d{2})(-\d{2})?$/.exec(String(dateStr == null ? '' : dateStr));
    return m ? m[1] : 'undated';
  }

  // Pure: the {month, category, income, expense, vatOutput, vatInput}
  // contribution of ONE ledger row. Reuses window.ledgerKind (config.js) and
  // window.computeVatSummary (bir.js) — called with a single-row array — so
  // this can never disagree with Reports/the 2550 worksheet's math for the
  // same row. Both are guarded with typeof checks (defensive only; by the time
  // any caller below actually runs, script load order guarantees both exist).
  function _rollupDelta(row) {
    row = row || {};
    var kind = (typeof window.ledgerKind === 'function')
      ? window.ledgerKind(row)
      : (row.type === 'credit' ? 'income' : 'expense');
    var vat = (typeof window.computeVatSummary === 'function')
      ? window.computeVatSummary([row])
      : { outputVat: 0, inputVat: 0 };
    var amount = row.amount || 0;
    return {
      month: _rollupMonth(row.date),
      category: row.category || 'Other',
      income: kind === 'income' ? amount : 0,
      expense: kind === 'expense' ? amount : 0,
      vatOutput: vat.outputVat || 0,
      vatInput: vat.inputVat || 0
    };
  }

  // Best-effort, SEPARATE write (never inside the caller's ledger transaction —
  // see the CONSTRAINT note in the file header). sign=+1 adds a row's
  // contribution, sign=-1 removes it (delete, or the "old" half of an edit).
  // Transactional read-modify-write on the rollup doc itself (its own small
  // transaction, distinct from whatever ledger transaction just committed) so
  // concurrent posts in the same month never race each other. NEVER throws —
  // a failure (e.g. rules not yet deployed) is a console.warn pointing at
  // rebuildRollups() as the fix, and the caller's ledger write already
  // succeeded regardless.
  async function _syncRollup(row, sign) {
    try {
      var delta = _rollupDelta(row);
      var docRef = db.collection('finance_rollup').doc(delta.month);
      await db.runTransaction(async function (tx) {
        var snap = await tx.get(docRef);
        var data = snap.exists ? (snap.data() || {}) : {};
        var byCategory = Object.assign({}, data.byCategory || {});
        var bc = Object.assign({ income: 0, expense: 0 }, byCategory[delta.category] || {});
        bc.income = (bc.income || 0) + sign * delta.income;
        bc.expense = (bc.expense || 0) + sign * delta.expense;
        byCategory[delta.category] = bc;
        tx.set(docRef, {
          month: delta.month,
          income: (data.income || 0) + sign * delta.income,
          expense: (data.expense || 0) + sign * delta.expense,
          vatOutput: (data.vatOutput || 0) + sign * delta.vatOutput,
          vatInput: (data.vatInput || 0) + sign * delta.vatInput,
          byCategory: byCategory,
          count: (data.count || 0) + sign,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('finance_rollup');
    } catch (e) {
      console.warn('[Ledger] finance_rollup sync failed for month ' +
        _rollupMonth(row && row.date) + ' — totals will drift until ' +
        'Ledger.rebuildRollups() runs. (' + (e && e.message || e) + ')');
    }
  }

  // Sequential best-effort sync for a batch of newly-written rows (postMulti).
  async function _syncRollupMany(rows, sign) {
    for (var i = 0; i < rows.length; i++) await _syncRollup(rows[i], sign);
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
    // Rollup sync ONLY for a freshly-posted row — a dedupe hit (existed:true,
    // legacy or deterministic) wrote nothing, so syncing it would double-count.
    if (!result.existed) await _syncRollup(row, +1);
    return result;
  }

  async function upsertByRef(ref, buildEntry) {
    if (!ref) throw new Error('Ledger.upsertByRef: ref is required');
    var legacyRef = await _findLegacyRef(ref); // throws propagate

    // Retry-safe capture: db.runTransaction may re-invoke its callback on
    // contention, so these are reset at the top of every attempt and only the
    // FINAL (committed) attempt's values survive for the post-commit rollup
    // sync below. oldRow is exactly the pre-overwrite read the transaction
    // already does for its own merge logic (legacySnap/snap) — reused here,
    // not re-read, per the assignment's instruction.
    var oldRow = null, newRow = null;

    var result = await db.runTransaction(async function (tx) {
      oldRow = null; newRow = null;
      if (legacyRef) {
        var legacySnap = await tx.get(legacyRef);
        var existingData = legacySnap.exists ? legacySnap.data() : null;
        oldRow = existingData;
        var built = _mapEntry(buildEntry(existingData));
        newRow = built;
        tx.set(legacyRef, built, { merge: true });
        return { id: legacyRef.id, created: false };
      }
      var docId = sanitize(ref);
      var docRef = ledgerRef(docId);
      var snap = await tx.get(docRef);
      var existingData2 = snap.exists ? snap.data() : null;
      oldRow = existingData2;
      var built2 = _mapEntry(buildEntry(existingData2));
      newRow = built2;
      if (snap.exists) {
        tx.set(docRef, built2, { merge: true });
        return { id: docId, created: false };
      }
      built2.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      tx.set(docRef, built2);
      return { id: docId, created: true };
    });

    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
    // "remove/edit = subtract old + add new" (spec). oldRow is null on a true
    // first-post (nothing to subtract); newRow is always set — buildEntry's
    // documented contract is a FULL row shape, so newRow's income/expense/vat/
    // category reflect the row's post-write state even though the actual
    // Firestore write used {merge:true}.
    if (oldRow) await _syncRollup(oldRow, -1);
    if (newRow) await _syncRollup(newRow, +1);
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
    // Retry-safe capture (see upsertByRef's comment) — only the newly-written
    // rows from the FINAL committed attempt are synced to rollups below.
    var writtenRows = [];
    var result = await db.runTransaction(async function (tx) {
      writtenRows.length = 0;
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
        writtenRows.push(row);
      });
      if (projectSync && projectSync.collection && projectSync.docId) {
        tx.update(db.collection(projectSync.collection).doc(projectSync.docId), projectSync.fields || {});
      }
      return results;
    });

    var existedAll = result.every(function (r) { return r.existed; });
    if (!existedAll && typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
    // Only legs actually written this call — existing (deduped) legs are
    // skipped so a partial re-post of a multi-leg entry never double-counts
    // the leg(s) that were already there.
    if (writtenRows.length) await _syncRollupMany(writtenRows, +1);
    return { results: result, existedAll: existedAll };
  }

  // Never a direct delete — routes through the existing President-approval
  // finance-delete flow (see CLAUDE.md "Finance delete approval").
  async function remove(ref) {
    if (typeof window.financeDelete !== 'function') {
      throw new Error('Ledger.remove: window.financeDelete is not loaded (script order — finance-ledger.js loads before departments.js, which defines it; call this after app init, not at module scope)');
    }
    // financeDelete takes an OPTIONS OBJECT keyed by docId (not a positional
    // collection+ref), so resolve the refNumber to its doc id first — same as
    // departments.js _deleteLedgerByRef. (Was `financeDelete('ledger', ref)`,
    // which passed the string 'ledger' as opts → collection/docId undefined.)
    var r = sanitize(ref);
    var ls = await db.collection('ledger').where('refNumber', '==', r).limit(1).get().catch(function () { return { docs: [] }; });
    if (!ls.docs.length) return 'not_found';
    return window.financeDelete({ collection: 'ledger', docId: ls.docs[0].id, label: 'ledger entry "' + r + '"' });
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

  // ── Phase 14: legacy-row migration tool ──────────────────────────────────
  // window.Ledger.migrateLegacyRows({dryRun = true} = {}) -> Promise<report>
  //   One-time, president-only tool that copies random-id ledger docs (rows
  //   from before Phase 12's deterministic-id scheme — identified by a
  //   `refNumber` field whose sanitized value doesn't match the doc's own id)
  //   onto `ledger/{sanitize(refNumber)}`, then deletes the legacy doc. This
  //   retires the extra _findLegacyRef query that .post/.upsertByRef pay for
  //   on every call (see KEY DESIGN DECISIONS #2 above) once run across all
  //   refNumber prefixes.
  //
  //   Full collection scan — acceptable for a one-time migration tool, NOT a
  //   pattern to reuse for anything that runs repeatedly.
  //
  //   Per-row disposition:
  //     - doc.id already === sanitize(refNumber)         -> already deterministic, skip (counted in `deterministic`).
  //     - no refNumber field                              -> can't determine target id, skip (counted in `noRef`, reported for manual review).
  //     - a doc ALREADY exists at the deterministic id     -> collision: this is
  //       exactly the historical double-post the fail-open .where() guard was
  //       replaced to prevent (see design decision #1). Both rows are left
  //       untouched — do NOT silently merge/overwrite money data — and the
  //       pair is recorded in the `collisions` report array for manual
  //       resolution via financeDelete (see CLAUDE.md "Finance delete
  //       approval") or Phase 20's reconciliation report.
  //     - otherwise                                        -> migratable: copy
  //       verbatim (including createdAt — do NOT re-timestamp, that would
  //       corrupt reporting/aging that reads createdAt) to the deterministic
  //       id, then delete the legacy doc.
  //
  //   dryRun (default true): read-only, zero writes — report the counts only.
  //   dryRun:false: batched writes, 400 ops/batch (well under Firestore's
  //   500-write limit, leaving headroom since each migrated row is a
  //   set+delete pair = 2 ops), each batch committed as its own atomic unit.
  //   Collisions are always skipped from writes, in both modes.
  //
  //   Return shape is a superset of what the president-button caller in
  //   departments.js expects ({scanned, migratable, migrated, skipped, ...}):
  //     { scanned, deterministic, migratable, migrated, collisions, noRef, skipped }
  //   `migrated` is 0 in dry-run. `skipped` = deterministic + noRef + collisions.length.
  async function migrateLegacyRows(opts) {
    opts = opts || {};
    var dryRun = opts.dryRun !== false; // default true
    if (typeof isRealPresident !== 'function' || !isRealPresident()) {
      throw new Error('Ledger.migrateLegacyRows: president-only');
    }

    var snap = await db.collection('ledger').get();
    var scanned = snap.docs.length;
    var deterministic = 0;
    var noRef = 0;
    var collisions = [];
    var migratableDocs = []; // {id, ref (target docId), data}

    // Build the set of existing doc ids up front so collision checks don't
    // need a read per candidate.
    var existingIds = {};
    snap.docs.forEach(function (d) { existingIds[d.id] = true; });

    snap.docs.forEach(function (d) {
      var data = d.data();
      var refNumber = data.refNumber;
      if (!refNumber) { noRef++; return; }
      var targetId = sanitize(refNumber);
      if (d.id === targetId) { deterministic++; return; }
      if (existingIds[targetId]) {
        collisions.push({ ref: refNumber, legacyId: d.id, deterministicId: targetId, amount: data.amount, date: data.date, type: data.type });
        return;
      }
      migratableDocs.push({ legacyId: d.id, targetId: targetId, data: data });
    });

    var migratable = migratableDocs.length;
    var migrated = 0;

    if (!dryRun && migratable) {
      var BATCH_SIZE = 400;
      for (var i = 0; i < migratableDocs.length; i += BATCH_SIZE) {
        var chunk = migratableDocs.slice(i, i + BATCH_SIZE);
        var batch = db.batch();
        chunk.forEach(function (m) {
          batch.set(ledgerRef(m.targetId), m.data); // verbatim copy, createdAt untouched
          batch.delete(db.collection('ledger').doc(m.legacyId));
        });
        await batch.commit();
        migrated += chunk.length;
      }
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
    }

    if (collisions.length && typeof console.table === 'function') {
      console.table(collisions);
    }

    var skipped = deterministic + noRef + collisions.length;
    return {
      scanned: scanned,
      deterministic: deterministic,
      migratable: migratable,
      migrated: migrated,
      collisions: collisions,
      noRef: noRef,
      skipped: skipped
    };
  }

  // ── v14 Wave 4 Batch F2: window.Ledger.rebuildRollups() ───────────────────
  // President-only. Full ledger scan → recompute EVERY finance_rollup doc from
  // scratch (delete every existing rollup doc, then rewrite one doc per month
  // that has at least one ledger row, from that scan alone). Idempotent —
  // running it twice in a row produces the same totals both times — and it's
  // the ONLY reconciliation path for the drift risk _syncRollup's best-effort
  // separate writes accept (see file header CONSTRAINT note): a missed rollup
  // write (rules not deployed yet, a raw write that bypassed post/postMulti/
  // upsertByRef, a network blip on a best-effort call) is invisible until this
  // runs. Wired to a "🔁 Rebuild rollups" button in Finance Tools
  // (departments.js openFinanceToolsPage).
  //
  // Delete-then-rewrite (not a targeted patch) so a month whose LAST row was
  // deleted correctly loses its rollup doc too, instead of leaving a stale
  // nonzero total behind.
  async function rebuildRollups() {
    if (typeof isRealPresident !== 'function' || !isRealPresident()) {
      throw new Error('Ledger.rebuildRollups: president-only');
    }

    var snap = await db.collection('ledger').get();
    var buckets = {}; // month -> {income,expense,vatOutput,vatInput,byCategory,count}
    snap.docs.forEach(function (d) {
      var delta = _rollupDelta(d.data());
      var b = buckets[delta.month] || (buckets[delta.month] = {
        income: 0, expense: 0, vatOutput: 0, vatInput: 0, byCategory: {}, count: 0
      });
      b.income += delta.income;
      b.expense += delta.expense;
      b.vatOutput += delta.vatOutput;
      b.vatInput += delta.vatInput;
      b.count += 1;
      var bc = b.byCategory[delta.category] || (b.byCategory[delta.category] = { income: 0, expense: 0 });
      bc.income += delta.income;
      bc.expense += delta.expense;
    });

    var BATCH_SIZE = 400;
    var existingRollups = await db.collection('finance_rollup').get();
    for (var i = 0; i < existingRollups.docs.length; i += BATCH_SIZE) {
      var delChunk = existingRollups.docs.slice(i, i + BATCH_SIZE);
      var delBatch = db.batch();
      delChunk.forEach(function (d) { delBatch.delete(d.ref); });
      await delBatch.commit();
    }

    var months = Object.keys(buckets);
    for (var j = 0; j < months.length; j += BATCH_SIZE) {
      var wChunk = months.slice(j, j + BATCH_SIZE);
      var writeBatch = db.batch();
      wChunk.forEach(function (m) {
        var b = buckets[m];
        writeBatch.set(db.collection('finance_rollup').doc(m), {
          month: m, income: b.income, expense: b.expense,
          vatOutput: b.vatOutput, vatInput: b.vatInput,
          byCategory: b.byCategory, count: b.count,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      await writeBatch.commit();
    }

    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('finance_rollup');
    return { scanned: snap.docs.length, months: months.length, rollupDocsCleared: existingRollups.docs.length };
  }

  window.Ledger = {
    post: post, upsertByRef: upsertByRef, postMulti: postMulti, remove: remove,
    migrateLegacyRows: migrateLegacyRows, rebuildRollups: rebuildRollups,
    _selfTest: _selfTest, _mapEntry: _mapEntry, _sanitize: sanitize,
    _rollupDelta: _rollupDelta, _syncRollup: _syncRollup
  };
})();

// v14 re-audit — test-support export guard (matches js/money-core.js's exact
// pattern). Only the PURE pieces (_mapEntry/_sanitize/_rollupDelta — no
// Firestore, no DOM, per their own code) are meaningfully unit-testable
// outside a browser; post/upsertByRef/postMulti/remove/etc. all need `db`/
// `firebase` and stay Firestore-integration-tested (or exercised via
// window.Ledger._selfTest() from a real browser console) instead.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    _mapEntry: window.Ledger._mapEntry,
    _sanitize: window.Ledger._sanitize,
    _rollupDelta: window.Ledger._rollupDelta
  };
}
