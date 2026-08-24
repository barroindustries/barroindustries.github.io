# OFFLINE-PUNCH-SPEC — server-side honoring of queued punch time

**Status:** SPEC (v14 P1.x follow-up — "offline-punch time" fix, server half).
**Scope:** `functions/index.js` (`recordAttendancePunch` + `resolveActiveRecordServer`), `js/screens/worker.js` (replay loop only).
**Out of scope / unchanged:** firestore.rules (callable uses Admin SDK; the client `attempts` write path is already allowed), storage.rules, HR screens, payroll math, firestore.indexes.json.

## 0. Problem + design principles

A punch captured offline is replayed by `_pqReplayAll` (worker.js) minutes/hours later, and `recordAttendancePunch` stamps `Timestamp.now()` at REPLAY time — so a 07:00 on-site Time In that syncs at 09:30 is paid as 09:30. The client already sends the true on-site instant as `queuedPunchAt` (worker.js ≈line 566, from the IndexedDB item's `queuedAt`); the server ignores it by design because a client-supplied time is a backdating vector.

Fix: the server accepts `queuedPunchAt` under a strict trust contract:

1. **Never backdate beyond what an honest offline punch could justify** — hard max-age window (48h), hard reject beyond it.
2. **Never record a future time** — clamp within a small skew grace (2 min); beyond grace, the claim is discarded (not the punch).
3. **Claimed time is always lower-trust** — every request carrying `queuedPunchAt` gets `needsReview: true` (both kinds, even a 30-second lag) plus a server-written audit entry naming claimed time vs server time. HR sees every claimed-time record before payroll; `lagMin` lets them bulk-clear trivial ones.
4. **Prefer degrading the claim over losing the punch.** A malformed/implausible claim records at server-now + flag (what the attacker would have gotten anyway; the honest worker keeps their punch). The ONLY hard reject specific to this feature is the >48h claim, because honoring it is backdating and recording it at server-now fabricates a shift on the wrong day — that case is HR manual entry.
5. **A queued replay may never rewrite an existing recorded time.** A queued `'in'` targeting a day-doc that already has `timeIn` is rejected — otherwise a crafted replay could move an already-recorded `timeIn` EARLIER (the clobber-backdate attack).

Deploy-order note: because the shipped client already sends `queuedPunchAt`, **deploying functions activates the fix immediately**. The worker.js changes in §3 are wording/robustness and ship second.

---

## 1. Server changes — `functions/index.js`

### 1.1 New constants (place next to `GEO_ACCURACY_FLOOR_M` / `MAX_SHIFT_HOURS`, ≈line 1261)

```js
// Oldest on-site instant a queued offline replay may claim. Matches the
// resolver depth (effective day + 1 prior day ≈ 48h): older punches can't
// land on a resolvable record anyway, and a >2-day self-served backdate is
// an HR manual-entry case, never a self-service one.
const QUEUED_PUNCH_MAX_AGE_MS = 48 * 60 * 60 * 1000;
// Device clocks (source of queuedAt = Date.now()) may skew slightly ahead
// of the server. Within this grace the claim is clamped to server-now;
// beyond it the claim is discarded as implausible (see classification).
const QUEUED_PUNCH_FUTURE_GRACE_MS = 2 * 60 * 1000;
```

### 1.2 `queuedPunchAt` parameter contract + classification

Parse immediately after the `kind` check (≈line 1370), BEFORE any Firestore reads, so a hard reject costs nothing:

```js
const rawQueuedAt = data && data.queuedPunchAt;          // epoch ms, optional
const nowMs = Date.now();                                 // one server "now" for classification
```

Classify into exactly one of four states (spec table — implement as written):

| State | Condition | `queuedReplay` | `effectiveMs` | Extra behavior |
|---|---|---|---|---|
| **absent** | `rawQueuedAt === undefined \|\| rawQueuedAt === null` | `false` | `nowMs` | Live punch. Byte-identical behavior to today — no new fields, no forced review. |
| **valid** | `typeof rawQueuedAt === 'number'` && `Number.isFinite` && `nowMs - QUEUED_PUNCH_MAX_AGE_MS <= rawQueuedAt <= nowMs + QUEUED_PUNCH_FUTURE_GRACE_MS` | `true` | `Math.min(rawQueuedAt, nowMs)` (future-skew clamp — never a future time) | `needsReview` forced; audit entry (§1.7). |
| **degraded** | present but malformed (`typeof !== 'number'`, `NaN`, `±Infinity`, `<= 0`) OR `rawQueuedAt > nowMs + QUEUED_PUNCH_FUTURE_GRACE_MS` | `true` | `nowMs` (claim DISCARDED, punch kept) | `claimDegraded = 'malformed'` or `'future'`; `needsReview` forced; audit entry records the raw claim. Why not reject: rejecting turns a client bug / bad device clock into a lost punch for an honest worker, while accepting-at-server-now gives an attacker exactly what they'd get with no parameter at all — nothing. Never backdates. |
| **too-old** | finite number && `rawQueuedAt < nowMs - QUEUED_PUNCH_MAX_AGE_MS` | — | — | **HARD REJECT** before any doc writes: `throw new functions.https.HttpsError('failed-precondition', 'This queued punch is more than 48 hours old and can no longer be self-submitted — ask HR/Finance to enter this shift manually.', { permanent: true, reason: 'queued-punch-too-old' })`. Why reject: honoring it is a 48h+ backdating hole; recording it at server-now would fabricate a shift on today's date the worker never punched. HR kiosk hand-entry is the designed correction path. |

Derived values used everywhere below:

```js
const effectiveTs  = queuedReplay ? admin.firestore.Timestamp.fromMillis(effectiveMs)
                                  : /* keep */ admin.firestore.Timestamp.now();
const lagMin       = queuedReplay ? Math.max(0, Math.round((nowMs - effectiveMs) / 60000)) : 0;
```

Implementation note: replace the current single `nowTs` (≈line 1468) with `effectiveTs` for **recorded values** (`timeStr`, `inAt`/`outAt`, `hoursWorked` math). Keep a separate `serverNowTs = admin.firestore.Timestamp.now()` (or reuse `nowMs`) for **provenance/audit** values. `recordedAt` stays `FieldValue.serverTimestamp()` — the actual write time — untouched.

### 1.3 Manila DATE re-derivation

`manilaDate(date)` (≈line 589) **already accepts an optional Date** — no signature change. Replace ≈line 1438:

```js
const serverTodayStr = manilaDate();                     // server's own Manila day (for guards/audit)
const todayStr       = manilaDate(effectiveTs.toDate()); // the punch's EFFECTIVE Manila day — drives all record targeting
```

For a live punch (`queuedReplay === false`) these are identical, so the live path is unchanged. For a queued replay, `todayStr` can be up to 2 calendar days before `serverTodayStr` (48h window) and **never after it** (future clamp).

### 1.4 `resolveActiveRecordServer` — prior day relative to the effective date

≈Line 1349 currently computes yesterday from the SERVER clock (`manilaDate(new Date(Date.now() - 24*3600*1000))`), which is wrong once `todayStr` is an effective (past) day. Replace with a pure calendar-string decrement, TZ-independent:

```js
const yestStr = new Date(Date.parse(todayStr + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
```

For live punches this yields the identical result as today (one code path, no branch). Signature stays `(base, todayStr)`.

### 1.5 `'in'` path (≈lines 1441–1452)

Order of guards, all evaluated against `todayStr` = effective day:

1. **Open-shift guard (existing, now effective-relative):** `resolveActiveRecordServer(base, todayStr)`; if it returns an open shift (`timeIn && !timeOut`) → reject `failed-precondition` (same message as today, plus `{ permanent: true, reason: 'shift-already-open' }` details). Covers the duplicate-replay case: if a replay's first attempt actually landed server-side but the client saw a network error and retries, the retry hits this guard and the client drops the dupe (§3.3).
2. **NEW — already-recorded guard:** fetch `base.doc(todayStr)` (this is the existing `freshSnap` read — reuse it, moved before field assembly); if `data.timeIn` exists (open **or** closed) → reject `failed-precondition`, message `` `A Time In is already recorded for ${todayStr}.` ``, details `{ permanent: true, reason: 'already-recorded' }`. This closes the clobber-backdate attack (§0 rule 5) and also fixes the latent live-path quirk where a second `'in'` on a completed day silently overwrote `timeIn`. Apply to live punches too — same guard, deliberate tightening.
3. **NEW — later-open-shift check (queued past-day `'in'` only):** if `queuedReplay && todayStr < serverTodayStr`, read each doc for the date strings in `(todayStr, serverTodayStr]` (at most 2 — reuse the §1.4 string-decrement helper logic to enumerate). If any has `timeIn && !timeOut`, **ALLOW** the past-day `'in'` anyway but set audit flag `laterShiftOpen: true` (§1.7). Rationale: the past `'in'` is real history (e.g. Monday's queued `'in'` never synced; worker legitimately punched in live Tuesday); rejecting would lose an honest worked day. `needsReview` is already forced, so HR sees the dangling open pair. Do NOT let the later open shift redirect the target — the record lands on `todayStr` (the effective day).
4. Target: `targetDateStr = todayStr`, `targetRef = base.doc(todayStr)`, `existingData` from the step-2 read.

### 1.6 `'out'` path (≈lines 1453–1461) + time/hours derivation (≈1463–1519)

- `resolveActiveRecordServer(base, todayStr)` with the effective `todayStr` — so a punch queued 23:50 that replays 00:10 next Manila day has effective day = the PRIOR day and resolves that day's open shift directly; a shift that crossed midnight before the punch still resolves via the resolver's own prior-day branch (now effective-relative, §1.4). Existing "No open shift found" reject stays, plus details `{ permanent: true, reason: 'no-open-shift' }`.
- `timeStr = manilaTimeHM(effectiveTs.toDate())` (helper already takes a Date — no change).
- `inAt`/`outAt` = `effectiveTs` (replacing `nowTs`).
- `hoursWorked` (out only): `Math.max(0, (effectiveTs.toMillis() - inMs) / 3600000)` — same structure as today, `nowTs.toMillis()` → `effectiveTs.toMillis()`. The legacy `timeIn`-string fallback (≈1502–1509) is unchanged. If `effectiveTs.toMillis() < inMs` (claimed out before recorded in), the existing `Math.max(0, …)` yields 0 hours — add audit flag `outBeforeIn: true`; review is already forced, and 0 hours can never overpay. The `> MAX_SHIFT_HOURS` flag stays as-is.
- A queued `'out'` closing a shift whose `'in'` was itself queued needs **no special handling**: that `inAt` is the in-punch's effective timestamp, so `outEffective − inAt` is the true worked span. Both records carry `needsReview` and audit entries.

### 1.7 Provenance fields, forced review, audit entry, response

**Per-kind provenance fields** (added to `fields` only when `queuedReplay === true`; naming follows the existing `inLat`/`outLat` convention — `X` = `in` or `out`):

```
XPunchSource : 'queued'        // absent on live punches — HR "was this a replay?" marker
XSyncLagMin  : <lagMin>        // integer minutes between claimed instant and server now
XClaimDegraded : 'malformed' | 'future'   // ONLY when the claim was discarded (§1.2 degraded)
```

**Forced review:** when `queuedReplay === true`, set `fields.needsReview = true` for BOTH kinds — note the current code only ever writes `needsReview` on `'out'`; the `'in'` branch must now write it too. Never set `needsReview: false` (don't clobber a prior flag).

**Server-written audit entry** — append to the same `attempts[]` array the client and geofence-failure paths already use, inside the one existing `targetRef.set(..., { merge: true })` (≈line 1521):

```js
attempts: admin.firestore.FieldValue.arrayUnion({
  kind, valid: true, queuedReplay: true,
  claimedPunchAt: new Date(effectiveMs).toISOString(),      // what got recorded
  rawQueuedPunchAt: Number.isFinite(rawQueuedAt) ? new Date(rawQueuedAt).toISOString() : String(rawQueuedAt),
  serverSyncAt: new Date(nowMs).toISOString(),
  syncLagMin: lagMin,
  ...(claimDegraded ? { claimDegraded } : {}),
  ...(laterShiftOpen ? { laterShiftOpen: true } : {}),
  ...(outBeforeIn ? { outBeforeIn: true } : {}),
  note: 'Offline queued replay — recorded at the claimed on-site time; flagged for HR review.',
  atServer: new Date(nowMs).toISOString()
})
```

Only include this key when `queuedReplay === true`. **Trap:** `FieldValue.serverTimestamp()` is illegal inside `arrayUnion` — use the ISO strings above, never a sentinel.

**Soft corroboration (no gating):** Firestore offline persistence usually syncs the client's advisory `pendingPunch` marker before the replay runs. If `existingData.pendingPunch && existingData.pendingPunch.queuedAt === rawQueuedAt`, add `corroborated: true` to the audit entry; otherwise `corroborated: false`. Purely an HR signal — acceptance must NEVER depend on it (the marker write is best-effort and can legitimately be absent).

**Response payload** — extend the existing return (≈line 1538) with:

```js
queuedReplay,                 // boolean
lagMin,                       // 0 for live
recordedDate: targetDateStr,  // so the client toast can name the day the record actually landed on
...(claimDegraded ? { claimDegraded } : {})
```

`message` for a queued replay: append `` ` (${targetDateStr}, synced ${lagMin} min late — flagged for HR review)` `` to the existing in/out message.

---

## 2. Edge-case matrix (exact behavior)

| # | Scenario | Server behavior | Client behavior (§3) |
|---|---|---|---|
| 1 | Queued `'in'`, a shift is already open on the effective day or its prior day | Reject `failed-precondition` `reason:'shift-already-open'` | Permanent → drop queue item, audit note, error toast |
| 2 | Queued `'in'`, effective day-doc already has `timeIn` (open or closed) | Reject `failed-precondition` `reason:'already-recorded'` (anti clobber-backdate) | Permanent → drop, audit, toast |
| 3 | Queued past-day `'in'`, a LATER shift (up to server-today) is open | **Accept** on the effective day; `laterShiftOpen:true` in audit; `needsReview` | Success toast |
| 4 | Punch queued 23:50, replays 00:10 next Manila day | Effective day = prior day; `'out'` closes that day's open shift at `23:50`; `'in'` creates the prior-day record | Success toast naming `recordedDate` |
| 5 | Multiple queued punches, one worker | Client replays FIFO (auto-increment id) and **breaks on transient failure** (§3.3) so a pair never inverts; server-side, an out-of-order `'out'` with no resolvable open shift rejects `reason:'no-open-shift'` (permanent), an out-of-order duplicate `'in'` hits #1/#2 | Break vs drop per §3.3 |
| 6 | `queuedPunchAt` older than 48h | **Hard reject** `reason:'queued-punch-too-old'`; nothing written | Permanent → drop, audit note, toast: see HR |
| 7 | `queuedPunchAt` malformed / >2 min future | Accept punch at **server-now**, claim discarded, `XClaimDegraded` + `needsReview` + audit | Success toast (server message notes the flag) |
| 8 | `queuedPunchAt` ≤2 min future | Clamp to server-now, normal queued handling | Success toast |
| 9 | Queued `'out'` whose matching `'in'` was also queued | Normal path — hours = effective-out − stored effective-in; both records flagged | Success toasts |
| 10 | Queued `'out'` earlier than the recorded `inAt` | Accept, `hoursWorked` clamps to 0, `outBeforeIn:true`, `needsReview` | Success toast |
| 11 | `queuedPunchAt` absent | Live punch — behavior byte-identical to current production, no new fields | Unchanged |

**Abuse attempts this design must specifically defeat** (the verification list in §5 re-tests each):
- **Devtools backdate:** on-site attacker calls the callable directly with `queuedPunchAt` = this morning. Cannot be prevented cryptographically (geofence/selfie are still validated but were capturable at any time) — so it is never SILENT: `needsReview:true` always, audit entry with exact lag, `XPunchSource:'queued'`. Claimed time is a review-tier record, period.
- **Deep backdate:** `queuedPunchAt` = 3 days ago → hard reject (#6).
- **Future stamp to inflate hours:** `'out'` with `queuedPunchAt` = +6h → degraded, recorded at server-now (#7). Never a future `outAt`.
- **Rewrite an existing record earlier:** queued `'in'` on a day with recorded `timeIn` → reject (#2).
- **Negative-duration / wrong-shift pairing:** #5, #10.

---

## 3. Client changes — `js/screens/worker.js`

The two callable call sites (per the file's own structure):

1. **Replay site — `_pqReplayAll`, ≈line 560:** already sends `queuedPunchAt: item.queuedAt`. **No functional change to the payload.** Update the stale comment at ≈563–566 ("the current callable does not read this field yet") to state the server now honors it under the OFFLINE-PUNCH-SPEC contract.
2. **Live site — `_finishClockSubmission`, ≈line 873:** already does NOT send `queuedPunchAt`. **Must stay that way** — add one comment line: `// NEVER send queuedPunchAt here — live punches are server-stamped; the field is exclusively for _pqReplayAll's queued replays (see OFFLINE-PUNCH-SPEC.md).`

### 3.1 Late-sync toast + audit note (≈lines 568–605) — now WRONG, must change

The current `delayMin >= WB_QUEUE_LATE_SYNC_MIN` branch tells the worker "the recorded time reflects the sync, not your real punch time" and writes a client-side `attempts` note saying the same — both false once the server honors `queuedPunchAt`. Replace the branch body with:

- Read `res.data` from the callable (capture `const res = await …` at the call site).
- Toast (info): `` `Time ${kindLabel} from ${res.data.recordedDate || item.recordDateStr}: synced ${res.data.lagMin ?? delayMin} min late — recorded at your real on-site time ${onSiteTimeStr} and flagged for HR review.` `` If `res.data.claimDegraded`, instead: `` `Time ${kindLabel} synced, but its original time could not be verified — recorded at ${syncedTimeStr} and flagged for HR review.` ``
- **Delete** the client `attempts` arrayUnion write in this branch entirely (≈585–602): the server's audit entry (§1.7) is now the authoritative note; the client copy would duplicate and contradict it.
- Keep `WB_QUEUE_LATE_SYNC_MIN` solely as the toast-verbosity threshold (below it, the existing plain "submitted" toast). Update its comment block (≈393–402) accordingly.

### 3.2 `pendingPunch` cleanup on date drift (small, belt-and-braces)

After a successful replay, if `res.data.recordedDate && res.data.recordedDate !== item.recordDateStr`, the advisory marker written by `_queuePunch` on `item.recordDateStr`'s doc will never be cleared by the server (it clears it on the TARGET doc). Best-effort: `db.collection('attendance_worker').doc(item.profileId).collection('records').doc(item.recordDateStr).set({ pendingPunch: firebase.firestore.FieldValue.delete() }, { merge: true }).catch(() => {})` — otherwise that day's clock card shows "Syncing…" forever.

### 3.3 Replay-loop failure semantics (fixes the pre-existing poison-pill)

The current `catch` (≈606–609) leaves EVERY failed item queued forever — a permanently-rejected item (e.g. `already-recorded`, `queued-punch-too-old`) retries on every `'online'` event for eternity. New rules inside the loop's `catch`:

- Add `function _pqIsPermanentRejection(err)`: `!_isNetworkish(err) && ['invalid-argument','failed-precondition','permission-denied','not-found','already-exists','out-of-range'].includes(String(err && err.code).replace(/^functions\//, ''))`. (`unauthenticated`, `internal`, `unavailable`, `deadline-exceeded`, `resource-exhausted` are transient.)
- **Permanent rejection:** `await _pqDelete(item.id)`; write a client `attempts` audit note on `item.recordDateStr`'s doc (`{ kind, valid: false, queuedReplay: true, rejectedCode, rejectedMessage: String(err.message).slice(0, 200), onSitePunchTime, atClient }`, merge-set, `.catch(() => {})`); error toast with `err.message`; **continue** to the next item (a dropped duplicate `'in'` must not block its paired `'out'` from closing the real shift).
- **Transient failure:** `break` the whole loop (not `continue`, as today) — connectivity is gone, and skipping ahead could replay an `'out'` before its still-queued `'in'`, which the server would then permanently reject (#5). FIFO pairing is only safe if the loop stops at the first transient failure.

### 3.4 Stale comment sweep

Update the long "THE FIX, split by what this file can and can't do" block (≈513–544): item 1's "this alone changes nothing server-side" is no longer true; item 2's "THIS FILE CANNOT correct the paid record" stands, but the attempts-note rationale moves to §3.3's rejection notes. Keep it short; point at `OFFLINE-PUNCH-SPEC.md`.

---

## 4. Deploy order

1. **Functions first:** `cd functions && npm run deploy`. The already-shipped client immediately gets correct queued times (it already sends the field). Nothing else consumes the callable.
2. **Then the client:** commit worker.js (pre-commit hook auto-bumps `APP_VERSION`/`CACHE_VER` — do not hand-edit), `git push origin master`.
3. No firestore.rules / indexes deploy needed.

---

## 5. Verification checklist (no test suite — manual, use a test worker account linked via `worker_profiles.linkedUid`, on-site or with a `geo_sites` radius that covers the tester)

Happy paths:
1. **Live punch regression:** online Time In → Firestore record has server-now `timeIn`/`inAt`, `serverVerified:true`, NO `needsReview`, NO `inPunchSource`/`inSyncLagMin`, no `attempts` queued-replay entry. Repeat for Time Out — `hoursWorked` sane. (Proves §1.2 "absent" is byte-identical.)
2. **Queued replay, same day:** DevTools → Network → Offline; Time In (selfie flow completes, "Saved — you're offline" toast, IndexedDB `bi-attendance-queue` has the item, doc shows `pendingPunch`); wait ≥3 min; go online → replay fires. Verify: `timeIn` = the OFFLINE instant (not sync time), `inAt` ms ≈ the queue item's `queuedAt`, `needsReview:true`, `inPunchSource:'queued'`, `inSyncLagMin` ≈ wait, `attempts[]` has the server entry with `claimedPunchAt`/`serverSyncAt`, `pendingPunch` cleared, toast says "recorded at your real on-site time".
3. **Midnight span:** queue an `'out'` at ~23:50 Manila, reconnect after 00:10 → record lands on the PRIOR day-doc, `timeOut:"23:50"`, `hoursWorked` measured to 23:50 not 00:10.
4. **Queued pair:** queue `'in'` then `'out'` offline; reconnect → both land FIFO on the right day, hours = out−in effective span, both audit entries present.
5. **HR surfacing:** the record from step 2 appears flagged in HR's kiosk-hours/needsReview view.

Abuse attempts — each MUST behave exactly as stated:
6. **Deep backdate (must REJECT):** from the signed-in console: `firebase.functions().httpsCallable('recordAttendancePunch')({kind:'in', lat, lng, accuracy: 20, selfieUrl: <own fresh selfie URL>, queuedPunchAt: Date.now() - 72*3600*1000})` → `failed-precondition` "more than 48 hours old", NO record written.
7. **Future inflate (must DISCARD claim):** same call with `queuedPunchAt: Date.now() + 6*3600*1000` → accepted at server-now, `inClaimDegraded:'future'`, `needsReview:true`. `timeIn` must equal the current Manila time, never a future one.
8. **Malformed (must DISCARD claim):** `queuedPunchAt: "07:00"` and `queuedPunchAt: NaN` → both accepted at server-now with `claimDegraded:'malformed'` + review; never a throw from the parse itself.
9. **Clobber-backdate (must REJECT):** after a live Time In exists for today, call with `kind:'in', queuedPunchAt: Date.now() - 4*3600*1000` → `already-recorded` rejection; today's `timeIn` unchanged.
10. **Silent-claim check:** any request WITH `queuedPunchAt` (even lag < 1 min) yields `needsReview:true` + audit entry — grep the written doc; there must be NO path where a claimed time lands unflagged.
11. **Poison-pill drain (client):** seed a queue item the server will permanently reject (e.g. duplicate `'in'`); reconnect → item is DELETED from IndexedDB after one attempt, audit note + error toast shown, and a later queued item for the same worker still replays.
