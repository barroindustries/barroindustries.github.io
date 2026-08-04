# CLIENT-QUOTE-PAGE-SPEC — Shareable Client-Facing Quote Page

**Status:** SPEC (no code written). Implement with Sonnet subagents per the model-routing pipeline.
**Author:** Fable, 2026-08-04.
**Goal:** A salesperson files a quote, taps "Share with client", gets a link. The client — no login, no account — opens it on their phone, sees a clean branded quote, and can **Accept** or **Request changes**. That response writes back to the quote and notifies Sales.

**Design north star:** the worst a bad actor holding the link can do is (a) read ONE quote's client-facing fields and (b) accept/decline it ONCE. Nothing else. Every decision below is made against that bar.

---

## 0. Decisions at a glance

| Question | Decision | Why (short) |
|---|---|---|
| Access model | **Mirror doc** `public_quotes/{token}`, sanitized projection | Quote docs carry `capitalMaterials`/`capitalLabor`/commission/`editableState` — a token-field-on-quote rule would expose ALL of it |
| Token | 12 chars, crypto-random, 54-char unambiguous alphabet (same alphabet as `makeTrackCode`) | ~6×10²⁰ space; longer than order-tracking's 8 because a quote leaks full pricing + client identity |
| Public page | New **`/q/index.html`**, standalone, modeled byte-for-byte on `/t/index.html` | Proven pattern: compat SDK, no auth, esc() everything, `noindex` |
| `list` on public collection | **`allow list: if false;`** always | Non-negotiable — same as `order_tracking` / `id_verify` / `usernames` |
| Accept / request-changes | **Callable Cloud Function `respondToQuote`** — NO public write rule anywhere | A rules-based public write can only touch the mirror; you'd still need a trigger function to update the internal quote + send notifications. The callable does all three with zero public write surface |
| Once-only | Firestore **transaction** in the function: `clientResponse.status` must be `'pending'` | Replay-proof at the database, not the UI |
| Status mapping in the app | accept → `status:'accepted'`; request changes → `status:'needs_revision'` | Both statuses already exist and render in js/screens/sales.js — zero new pipeline UI |
| Revocation | Delete the mirror doc; re-share mints a **new** token | Dead link is a 404-equivalent; old token never resurrects |
| Expiry | Accept blocked after the quote's `validUntil` (server-enforced); viewing + request-changes stay open | Commercial expiry already exists on the quote; no second expiry system |
| Client PII on the public doc | Client **name + company only**. NO address, phone, email | The client knows their own contact details; on a leaked link they're pure PII exposure |

---

## 1. Ground truth (what exists — verified 2026-08-04)

- **Quote docs** live in `bs_quotes` (Brilliant Steel + generic partners) and `bk_quotes` (Barro Kitchens). Shape = `buildQuotePayload()` in `quote-builder-v2.html` (~line 4216), stamped by the app.js bridge (~line 3660) with `createdBy`, `createdByName`, `createdByRole`.
- **Internal-only fields on a quote doc** (the reason the mirror-doc model wins): `items[].capitalMaterials`, `items[].capitalLabor`, `items[].laborHours`, `items[].formulaType`, `commissionPct`, `commissionAmount`, `editableState` (full builder snapshot incl. `laborState`, `waiveFlags`), `waiveFlags`, `createdBy`/`createdByRole` (uids/roles), `clientId`, `leadSource`, `location`, `parentQuoteId`/`rootQuoteId`, `payment.interestRate`'s siblings are fine but the map rides next to internal data.
- **Public-page precedent:** `order_tracking/{token}` in `firestore.rules` (~line 1834): `get: true`, `list: false`, authenticated-only writes, partner may create only for a `sales_orders` doc they themselves created (verified via `get()` on the referenced doc). Rendered by `/t/index.html` (compat SDK 10.12.2, hardcoded public web config, `esc()` helper, `noindex`, og-tags). `track.html` is only a legacy forwarder — we do NOT need an equivalent shim for quotes (no legacy links exist); go straight to `/q/`.
- **Token minting precedent:** `window.makeTrackCode` + `uniqueTrackCode()` in `js/departments.js` (~line 2554): crypto-random, 54-char alphabet `23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ` (no 0/O/1/I/l), collision-checked with a `get`.
- **Share-modal precedent:** `window.showOrderTrackModal` (js/departments.js ~2570): copy button + preview link inside `openModal`.
- **Cloud Functions:** `functions/index.js`, Functions v1 API, region **`asia-east1`**, has both a Firestore trigger (`sendPushOnNotification`) and HTTPS callables (`adminResetPassword`, `setUserDisabled`). Notification docs are `notifications/{uid}/items/{id}` with `{title, body, icon, type, link, read:false, createdAt}`; the push trigger clamps/coerces everything defensively.
- **sw.js:** `/t/` and `track.html` are PRECACHEd; anything NOT precached falls through to `networkFirst(RUNTIME)` — a non-precached `/q/` is always fresh for any staff browser that has the SW.
- **Branding:** the `CO` map in quote-builder-v2.html (~line 1381) holds BK/BS letterhead data (name, sub, creds, thanks, BK logo + BK `pay` bank block). Generic partners (`CO.PT`) get name via URL params / company profile. This map is inside the builder iframe — the share action must snapshot brand data onto the mirror doc (see §3.2).
- **Rules helpers available:** `isAuth()`, `isPartner()`, `isAdmin()`, `isPresident()`, `inDept()`, and the `.get(field, default)` convention (absent-field reads DENY the rule — always use defaults; see memory note "Firestore rules missing-field throws").

---

## 2. Access model — mirror doc `public_quotes/{token}`

### 2.1 Why mirror-doc, not token-field-on-quote

A `get`-if-token-matches rule on `bs_quotes`/`bk_quotes` would expose the **entire quote document** to anyone with the link. Firestore rules cannot hide fields within a readable doc, and rules cannot inspect array elements — so `items[].capitalMaterials` / `items[].capitalLabor` (Barro's actual costs), `commissionPct/commissionAmount`, and the full `editableState` snapshot would all ship to the client's browser. That is a competitive-and-margin leak with no mitigation available at the rules layer. **The mirror doc exposes exactly the fields we copy and nothing else.** This is also precisely the `order_tracking` precedent ("Only client-SAFE fields live here … never internal cost/margin"), so it's the established house pattern.

Consequence to accept: the mirror is a **snapshot** — if the quote is edited after sharing, the mirror is stale until re-synced (§6.3 handles this). That's a feature, not a bug: the client saw a specific offer; it shouldn't mutate under them silently.

### 2.2 Token

- Minted app-side by the sharer: `makeShareToken()` = same crypto alphabet as `makeTrackCode`, **length 12** (54¹² ≈ 6.4×10²⁰). Collision-checked with a `uniqueTrackCode()`-style loop against `public_quotes` (a `get` on a public collection needs no auth, so the check always works).
- The token **is the doc id** of the mirror. It is also stamped on the internal quote as `shareToken` (staff-visible only) so the app can find/revoke/re-sync the mirror.
- URL: `https://<origin>/q/?<TOKEN>` (same shape as `/t/?<code>`; origin is the CNAME domain `barroindustries-operatingsystem.ravenmails.com` via `location.origin`).

### 2.3 Mirror doc shape — the COMPLETE allowlist

Everything on this doc is public to the link-holder. **This list is exhaustive; copying any field not listed here is a spec violation.**

```js
public_quotes/{token} = {
  v: 1,                                  // schema version for the public page
  // ── branding (resolved at share time, §5.2) ─────────────
  co: 'BK' | 'BS' | 'PT',
  brand: { name, sub, creds, thanks },   // strings only; PT gets the partner company's name
  // ── quote header ────────────────────────────────────────
  quoteNumber, quoteDate, validUntil,    // strings (ISO dates)
  subject, purpose,                      // client-facing already (printed on the quote)
  clientName, clientCompany,             // NO clientAddress / clientPhone / clientEmail — see §7.2
  salesperson,                           // the printed "Prepared by" name (a name, not a uid)
  // ── line items — per-item allowlist projection ──────────
  items: [{ name, dims, specStr, qty, unit, unitPrice, amount, leadTime }],
         // NEVER: capitalMaterials, capitalLabor, laborHours, formulaType, id, category
  // ── money (all figures the printed quote already shows) ─
  subtotal, discountPct, discountAmount, netAmount,
  vatIncluded, vatAmount, total,
  deliveryInstall: { amount, includedInTotal, free, method, notes },
  payment: { downPaymentMode, downPayment, balance, balanceMode, interestRate },
  bankDetails,                           // string; already printed for the client to pay the DP
  timeline: { startDate, leadDays, completionDate },
  remarks,
  photos: [{ url, caption, itemIndex }], // tokened download URLs only; NEVER the storage `path`
  // ── share/response state ────────────────────────────────
  status: 'pending' | 'accepted' | 'changes_requested',
  clientResponse: { status: 'pending' }  // → { status, name, note, respondedAt } (function-written only)
  // ── provenance (for rules + revoke; see §2.4 note) ──────
  src: { coll: 'bs_quotes' | 'bk_quotes', id: '<quote doc id>' },
  sharedAt: <serverTimestamp>, sharedByName: '<display name>',   // NO uid
  updatedAt: <serverTimestamp>,
}
```

**Explicitly NEVER copied** (enumerated so review can grep): `capitalMaterials`, `capitalLabor`, `laborHours`, `formulaType`, `commissionPct`, `commissionAmount`, `editableState`, `laborState`, `waiveFlags`, `createdBy`, `createdByRole`, `clientId`, `leadSource`, `location`, `parentQuoteId`, `rootQuoteId`, `clientAddress`, `clientPhone`, `clientEmail`, any `photos[].path` or `dataUrl`.

**One projection function, one place.** `window.buildPublicQuoteDoc(quoteDoc, brand)` lives in js/screens/sales.js next to the share action. It builds the mirror by **allowlist** (construct a new object field-by-field; never spread/`...quoteDoc`). Firestore rules cannot validate array contents, so this function is the ONLY line of defense for `items[]` sanitization — every mirror write path (share, re-share, re-sync after QUOTE_UPDATE) MUST go through it. Code review gate: any `.set()` on `public_quotes` that doesn't call `buildPublicQuoteDoc` is a bug.

`src` exposure assessment: like `order_tracking.orderId`, the mirror publicly reveals an internal Firestore doc id + collection name. Under current rules this is inert — both quote collections deny all unauthenticated access and scope authenticated reads, so knowing an id grants nothing. We keep it because it buys (a) rules-verifiable partner ownership on create (same mechanism as `order_tracking`'s partner branch), (b) direct lookup in the callable (no query), (c) unambiguous revoke/re-sync. If rules on the quote collections ever weaken, revisit.

---

## 3. The public page — `/q/index.html`

New standalone file, **not** referenced from `index.html`, **not** in the sw.js PRECACHE (deliberate — §9). Clone the structure of `/t/index.html`: inline CSS, compat SDK `firebase-app-compat.js` + `firebase-firestore-compat.js` + (new) `firebase-functions-compat.js` (10.12.2, same pins), hardcoded public web config, `esc()` on every rendered string, `<meta name="robots" content="noindex"/>`, og-tags (generic — og markup is static HTML; never bake a client's name into it), `t/index.html`'s loading/error state pattern.

### 3.1 Flow

1. Token = `location.search.replace(/^\?/,'').split('&')[0]` (same parse as `/t/`). Missing/malformed (not `^[2-9a-zA-Z]{8,24}$`) → friendly "This link looks incomplete" state. (Accept 8–24 so a future length change doesn't strand links.)
2. `db.collection('public_quotes').doc(token).get()` — unauthenticated. Not-exists → "This quote link is no longer available — please contact your sales representative." (Covers both bad token and revoked; deliberately indistinguishable.)
3. Render (§3.2). If `new Date() > validUntil` → show an "expired" ribbon; hide the Accept button; keep Request-changes.
4. Accept / Request changes → §4. After success, re-render in the responded state (and on load, if `clientResponse.status !== 'pending'`, render that state — the page is idempotent on refresh).

### 3.2 What it shows

Mobile-first, max-width ~740px, A4-ish print stylesheet (`@media print`) so "Save as PDF" from the phone produces a presentable document.

- **Brand header** from `doc.brand` + `doc.co`: company name, sub-line, accent color by `co` (BK: the app blue `#0F6CBD` family; BS: steel gray/navy; PT: neutral slate). BK may show the logo `/icons/barro-kitchens.png` (same-origin asset); BS/PT render text-only (matching the builder's deliberate logo suppression for partners).
- **Header block:** quote number, date, valid-until (with a "valid for N more days" pill), subject, purpose, "Prepared by {salesperson}", "For: {clientName} — {clientCompany}".
- **Items table:** name, dims, specs, qty × unit, unit price, amount. Peso formatting per `/t/`'s `peso()` (en-PH).
- **Totals card:** subtotal → discount → net → VAT (only if `vatIncluded`) → **Total**. Delivery/installation line per `deliveryInstall`.
- **Payment terms:** downpayment amount/mode, balance/mode; `bankDetails` verbatim (pre-formatted text). Show the bank block ONLY when `bankDetails` is non-empty (mirrors the builder's `co.pay` gating so partner quotes never show Barro's account).
- **Timeline** (start / lead days / completion), **remarks**, **photos** (url+caption; `onerror` hides the `<img>` so a storage-rules 403 degrades silently).
- **Action bar** (sticky bottom on mobile): `✓ Accept this quotation` (primary) and `Request changes` (secondary). Request-changes opens a small form: name (prefilled `clientName`, editable) + message textarea. Accept opens a confirm step: "You're accepting {quoteNumber} for {total}" + name field + optional note.
- **Responded states:** accepted → green confirmation ("Thank you! {brand.name} has been notified — your sales representative will contact you for next steps") + payment details re-surfaced; changes_requested → amber "Your requested changes were sent."
- **Footer:** `brand.creds` line + "Questions? Contact your sales representative." No staff emails/phones beyond what `brand` carries.

### 3.3 What it must NEVER show

Everything in the §2.3 NEVER list — enforced structurally (the data simply isn't on the doc). The page must also never link to the app login, never embed the app's `js/*.js`, and never render any string without `esc()` (quote fields round-trip through staff input; treat all of it as hostile in this context too).

---

## 4. Accept / Request-changes writeback — callable function, NO public write rule

### 4.1 Why a Cloud Function instead of a public write rule

An unauthenticated rules-based write could ONLY touch the mirror doc. The feature also needs (a) the internal `bs_quotes`/`bk_quotes` doc's `status` updated so the Sales pipeline reflects the response, and (b) notification docs written under `notifications/{uid}/items` — both impossible for an anonymous client under any sane rules. So the rules-only design would STILL need an `onUpdate` trigger function to fan out — same function count, plus a public write surface to keep provably tight forever (map-diff validation, transition guards, field-type checks — all in rules language, all easy to regress). The callable gives: **zero** unauthenticated write rules anywhere in `firestore.rules`, one place (Node, testable) that validates input, and atomic once-only semantics via a transaction. Tradeoff accepted: the accept button depends on Cloud Functions availability (the page itself still renders read-only if Functions is down — acceptable), and a functions deploy joins the checklist.

### 4.2 `respondToQuote` — functions/index.js, v1 callable, region `asia-east1`

Input `{ token, action, name, note }`. Behavior:

1. **Validate & clamp** (mirror `sendPushOnNotification`'s defensive style): `token` matches `^[2-9a-zA-Z]{8,24}$`; `action` ∈ `{'accept','request_changes'}`; `name` → string, trim, slice(0,120); `note` → string, strip control chars, slice(0,2000). `request_changes` requires a non-empty note. Anything else → `HttpsError('invalid-argument')`.
2. **Transaction** on `public_quotes/{token}`:
   - Not exists → `HttpsError('not-found', 'This quote link is no longer available.')`.
   - `clientResponse.status !== 'pending'` → `HttpsError('failed-precondition', 'A response was already recorded for this quotation.')` — **this is the once-only + replay guard, enforced at the database**.
   - `action==='accept'` and today (Asia/Manila) > `validUntil` → `HttpsError('failed-precondition', 'This quotation has expired — please request an updated quote.')`. (`request_changes` is allowed after expiry: "please re-quote" is exactly the message an expired client sends.)
   - Update the mirror: `status`, `clientResponse: { status: action==='accept'?'accepted':'changes_requested', name, note, respondedAt: serverTimestamp }`, `updatedAt`.
3. **After commit** (best-effort, errors logged, never rolled into the client's response): read `src.coll`/`src.id`, validate `src.coll` ∈ `{'bs_quotes','bk_quotes'}` (never trust it as a raw path), then update the internal quote **only if** `quote.shareToken === token` (a stale mirror pointing at a re-shared or revised quote must not flip its status): accept → `{ status:'accepted', clientResponse: {…}, clientRespondedAt }`; changes → `{ status:'needs_revision', clientResponse: {…}, clientRespondedAt }`. Both statuses already render in js/screens/sales.js (`accepted` in the pipeline stats ~line 1031; `needs_revision` bucket ~line 1712) — no UI work.
4. **Notify:** write notification docs (exact `Notifs.send` shape: `{title, body, icon, type, link:null, read:false, createdAt}`) to `notifications/{createdBy}/items` and, if different, the president's uid (`users where role=='president' limit 1`). `type:'quote_response'`. Title: `Quote accepted 🎉` / `Changes requested`; body: `{clientName} · {quoteNumber} · ₱{total}` (+ first ~140 chars of the note). Admin SDK bypasses rules, so the notifications-create allowlist in firestore.rules is untouched; `sendPushOnNotification` then delivers the push exactly as it does for any in-app send. Note has already been length-clamped in step 1, satisfying the push trigger's clamps.
5. Return `{ ok:true, status }`.

Page-side call: `firebase.app().functions('asia-east1').httpsCallable('respondToQuote')({...})` — the **region argument is mandatory** or the SDK targets us-central1 and fails.

### 4.3 The client-supplied note is hostile input inside the authed app

`clientResponse.note`/`name` flow back onto internal quote docs and get rendered in sales.js and in notification toasts. **Every render site must `escHtml()` them** (house rule already, but this is the first field written by a fully anonymous stranger — call it out in the PR). The function's control-char strip + length clamp is defense-in-depth, not a substitute.

---

## 5. Sales-side "Share with client"

### 5.1 Where

A shared helper `window.shareQuoteWithClient(coll, docId)` in **js/screens/sales.js**, wired as a `🔗 Share` button on filed/approved quote cards in all three existing action rows:
- BS flat list — the `bindQuoteActions` button row (js/screens/sales.js ~lines 1755–1765, next to Reopen / New Revision / Sales Order);
- BK quotations summary card actions (~lines 996–998);
- Partner own-quotes table (js/screens/partners.js ~line 344) — partners share their OWN quotes only (rules-enforced, §6.1).

NOT inside the quote-builder iframe: sharing applies to a **filed** doc, and the builder pre-file has no doc id. One helper, three buttons.

Gating: button renders only for `status ∈ {filed, approved, accepted}` (you can re-surface the link after acceptance) — never for drafts/pending-approval/rejected.

### 5.2 What it does

1. Fetch the quote doc. If `quote.shareToken` exists AND `public_quotes/{shareToken}` exists → **re-sync**: `set(buildPublicQuoteDoc(quote, brand), {merge:false})` but preserving the existing `clientResponse`/`status`/`sharedAt` (read-then-write; full overwrite of everything else so removed fields don't linger), then show the modal.
2. Else mint: `token = await uniquePublicQuoteToken()` (12-char, §2.2); resolve `brand`:
   - `BK`/`BS`: a small static `QUOTE_BRANDS` map in sales.js holding ONLY the four public strings (name/sub/creds/thanks) — duplicated from the builder's `CO` map on purpose (data, not code; the builder's map isn't reachable from the app frame).
   - `PT`: name from the partner's company profile (the same source `isGenericPartner()`/partners.js uses for portal branding); creds/thanks generic.
3. `db.collection('public_quotes').doc(token).set(buildPublicQuoteDoc(quote, brand))` with `clientResponse:{status:'pending'}`, `status:'pending'`, `src:{coll, id:docId}`.
4. `db.collection(coll).doc(docId).update({ shareToken: token, sharedAt: serverTimestamp })`.
5. Modal (clone `showOrderTrackModal`): read-only URL input + **Copy** + **Share…** (`navigator.share({title:'Quotation '+quoteNumber, url})` when available — this is mobile PH, Viber/WhatsApp hand-off is the whole point) + "Preview the client view ↗" + a **Revoke link** button.
6. Card affordance: quotes with a `shareToken` show a small `🔗 shared` chip; if `clientResponse` exists, show the response state + note inline (escHtml'd).

### 5.3 Revoke / re-share

- **Revoke:** delete `public_quotes/{token}`; update quote `{ shareToken: FieldValue.delete(), shareRevokedAt }`. The link instantly renders the "no longer available" state.
- **Re-share after revoke:** mints a **new** token. Old tokens never come back.
- **New revision:** a revision is a NEW doc with no `shareToken` — share it separately; the old link keeps showing the old (possibly now-revoked) offer. Recommended practice for Sales: revoke the superseded quote's link when filing a revision (put this hint in the share modal).

---

## 6. The exact firestore.rules addition

Place next to `order_tracking` (~line 1834) with the same comment discipline. `.get(field, default)` everywhere (missing-field reads deny).

```
// ── Public client-facing quote mirror (share-with-client) ───────────
// Each doc id is a 12-char unguessable token; /q/?<token> resolves it.
// Holds ONLY the sanitized client-safe projection built by
// buildPublicQuoteDoc() (js/screens/sales.js) — NEVER capital/labor costs,
// commission, editableState, uids, or client contact details. `get` is
// PUBLIC (client opens the link with no account); `list` is DENIED (no
// enumeration). There is NO public write: the client's accept/request-
// changes goes through the respondToQuote callable (functions/index.js),
// which bypasses rules via the Admin SDK — so every write rule here is
// authenticated-staff-only. Partner branch mirrors order_tracking: a
// partner may mint/maintain a mirror ONLY for a quote THEY created.
match /public_quotes/{token} {
  allow get:  if true;
  allow list: if false;

  function srcQuote(rd) {
    return get(/databases/$(database)/documents/$(rd.get('src', {}).get('coll', 'bs_quotes'))/$(rd.get('src', {}).get('id', '_none_'))).data;
  }
  function srcIsMine(rd) {
    return rd.get('src', {}).get('coll', '') in ['bs_quotes', 'bk_quotes']
        && rd.get('src', {}).get('id', '') != ''
        && exists(/databases/$(database)/documents/$(rd.get('src', {}).get('coll', ''))/$(rd.get('src', {}).get('id', '')))
        && srcQuote(rd).get('createdBy', '') == request.auth.uid;
  }
  // A staff/partner write may never fabricate or alter a client response:
  // create must start it 'pending'; update must leave it untouched or
  // reset it to 'pending' (deliberate "re-open for response" after a fix).
  function responseUntouchedOrReset() {
    return request.resource.data.get('clientResponse', {}).get('status', 'pending') == 'pending'
        || request.resource.data.get('clientResponse', {}) == resource.data.get('clientResponse', {});
  }

  allow create: if isAuth()
    && request.resource.data.get('clientResponse', {}).get('status', '') == 'pending'
    && (!isPartner() || srcIsMine(request.resource.data));
  allow update: if isAuth()
    && responseUntouchedOrReset()
    && (!isPartner() || (srcIsMine(resource.data) && srcIsMine(request.resource.data)));
  allow delete: if isAuth()
    && (!isPartner() || srcIsMine(resource.data));
}
```

Notes for the implementer:
- **No public `create`/`update`/`delete` exists — verify by reading, not assuming.** The single most important property of this block.
- Rules can't validate `items[]` contents (no array iteration) — do NOT attempt field-blacklisting here; sanitization is `buildPublicQuoteDoc()`'s job (§2.3).
- The dynamic-path `get()` with a collection name read from data is unusual — if the rules compiler rejects interpolating `src.coll` into a path segment, fall back to two explicit branches (`coll=='bs_quotes' ? get(/…/bs_quotes/$(id)) : get(/…/bk_quotes/$(id))`). Keep the `in ['bs_quotes','bk_quotes']` allowlist either way so a forged `src.coll` can't point the ownership check at an attacker-controlled collection.
- Deploy is separate from `git push` (memory: firebase CLI at `~/.npm-global/bin/firebase`; `firebase deploy --only firestore:rules`). Re-`git diff` the rules file immediately before deploying (live-tree memory note).

---

## 7. Security & abuse analysis

### 7.1 What a malicious link-holder CAN do
- Read one quote's client-facing fields (§2.3 list) — prices, items, client name/company, bank deposit details, brand info. All of it is on the paper/PDF quote the client already received; the link adds reach, not new data classes.
- Accept or request changes **once**, with an arbitrary name (≤120 chars) and note (≤2000 chars). Consequence: one wrong status flip + notification. Sales sees the note, calls the client, and Reopen/New Revision recovers in one click — the quote's amounts are untouched and untouchable.
- Hammer `respondToQuote` with garbage tokens: 54¹² space makes discovery via brute force computationally absurd (at 1M req/s, expected hit time ≈ 10⁷ years); per-token replay is closed by the transaction; the endpoint does ~1 doc read per invalid call (bounded cost — see rate note below).

### 7.2 What they CANNOT do — and the design element that guarantees it
- Read any other quote → `list:false` + unguessable doc-id token.
- See costs/margins/commission/internal snapshot → those fields never exist on the mirror (allowlist projection).
- Harvest the client's phone/email/address → deliberately not copied (§2.3). This is the one place we expose LESS than the printed quote does — a leaked paper quote leaks contact PII; a leaked link must not.
- Alter amounts, items, or any quote field → no public write rule exists; the callable writes only `clientResponse`/`status` from validated enum+clamped-string input.
- Respond twice / un-accept / flip a response → transaction requires `pending`.
- Accept an expired quote → server-side `validUntil` check (client-side hiding is cosmetic only).
- Enumerate or write `order_tracking`, `id_verify`, or anything else → untouched collections, unchanged rules.
- Keep using a link Sales revoked → mirror doc deleted; re-share is a new token.

### 7.3 Residual risks, called out honestly
- **The link IS the credential.** Anyone the client forwards it to sees the quote. That's inherent to no-login sharing (same posture as `order_tracking` and every "view quote" link in the industry). Mitigations: revocation, expiry-gated accept, no PII beyond name/company, `noindex`.
- **`bankDetails` on a public-by-token doc** — genuine deposit account details (BK's UnionBank). Accepted because it's already printed on every BK quote and payment is the point of accepting; gated so partner quotes never show Barro's account. If Neil prefers, a v1.1 option is to move `bankDetails` behind the accepted state — but since rules can't hide fields on a readable doc, that requires the function to write `bankDetails` onto the mirror only upon accept. Flag: **safe-er choice available; not taken in v1 for simplicity** — Neil to confirm.
- **Anonymous string reaches internal renderers** (§4.3) — mitigated by clamp+strip at write and mandatory `escHtml` at render.
- **Rate limiting:** Functions v1 has no built-in per-IP throttle. Cost exposure is one Firestore read per garbage call. Optional hardening, deliberately deferred: App Check (needs app registration + SDK on the public page) and/or a coarse per-token attempt counter doc. Neither changes the security result (token space does the work); revisit only if invocation bills say otherwise.
- **Photos** use tokened Firebase Storage download URLs — each URL is itself an unguessable capability, consistent with the model. Never copy `path`.

---

## 8. Notifications recap

Written server-side by `respondToQuote` (§4.2, step 4) directly into `notifications/{uid}/items` — targets: quote `createdBy` + president. `sendPushOnNotification` (existing trigger, `asia-east1`) turns each into an FCM push exactly as it does today. No client-side `Notifs.send` involvement (the responder has no auth), no rules change to the notifications allowlist (Admin SDK). In-app, the standard inbox/toast pipeline picks it up with `type:'quote_response'`.

## 9. Deploy checklist

1. **New file `/q/index.html`** — standalone public page. NOT added to index.html's script chain (it's not an app screen). **Deliberately NOT added to sw.js PRECACHE**: non-precached same-origin requests fall to `networkFirst(RUNTIME)` (sw.js ~line 162), so staff browsers always fetch it fresh, and client browsers never have the SW at all. (This differs from `/t/` which IS precached; `/q/` carries a live accept flow whose logic must never be stale.)
2. **js/screens/sales.js** — `QUOTE_BRANDS`, `buildPublicQuoteDoc`, `shareQuoteWithClient`, `uniquePublicQuoteToken`, share buttons + shared-chip on the two card renderers. **js/screens/partners.js** — share button on the partner table. **js/app.js** — QUOTE_UPDATE bridge (~line 3606): after an in-place update, if the doc has `shareToken`, best-effort re-project the mirror preserving `clientResponse` (§6.3 staleness).
3. JS edits ⇒ `CACHE_VER` — handled automatically by the pre-commit hook (derived from APP_VERSION); do not hand-edit. One agent per shared file; `git diff --cached` before committing (hook re-stage footgun).
4. **firestore.rules** — add the §6 block. Deploy: `~/.npm-global/bin/firebase deploy --only firestore:rules` (git push does NOT deploy rules). Re-diff the whole file immediately before deploying (concurrent-session memory note).
5. **functions/index.js** — add `respondToQuote` callable (v1, `asia-east1`). Deploy: `cd functions && npm run deploy`.
6. **Composite indexes: none.** Every access is a direct doc `get` by id; the only query added is `users where role=='president' limit 1` (single-field, auto-indexed).
7. App deploy: `git push origin master` (GitHub Pages). Verify order: **rules first, then functions, then the app push** — the page 404s gracefully until rules land, but a public page shipped before its rules would hard-fail reads (fail-closed, still fine).
8. Smoke test: share a throwaway BK quote → open `/q/?<token>` in a private window (no auth) → verify NO internal fields in the network response payload (inspect the Firestore REST response body, not just the DOM) → accept → confirm once-only on second attempt, quote card shows `accepted`, notification + push received → revoke → link shows the gone state.

## 10. Out of scope (v1)

PDF generation, e-signatures, counter-offer amount editing, client accounts, multi-language, App Check, per-share expiry independent of `validUntil`, moving `bankDetails` behind acceptance (§7.3 — Neil to rule), auto-revoke on new revision (hint text only in v1).
