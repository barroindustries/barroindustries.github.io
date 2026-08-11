# DESIGN-FLOW-SPEC — Finance → Design → Production, 2026-08-11

**Status: spec, not yet implemented.** Written for a Sonnet implementer who has NOT seen the
conversation that produced it. Everything needed is in this file plus the referenced code.
Where a judgement call was made, it is marked **[DECISION]** with a one-line reason.
Anything that needs the owner is marked **[OWNER]** — do NOT guess those; implement the
specified default and leave the flag in place.

---

## 0. What the owner asked for (verbatim)

> "under sales orders in finance when receiving, this should be to design already, and a
> project is created in design so design and upload their drawings then once done, this
> will be sent to production where they can add notes for production. allow design team to
> make folders. two type: projects, sales order"

Confirmed follow-up: **EVERY recorded sales order routes through Design first.** Design can
mark an order as needing no drawings to pass it straight through — but the path is always
Finance → Design → Production. One path. Nothing skips silently.

## 1. The flow, before and after

**Today:** Finance "Record Sale" (or the later "To Production" button) →
`transferOrderToProduction(o)` (js/departments.js ~3910) → demands targetDate+priority+notes
from Finance via `ensureProdHandoffFields` (~3868) → sets `job_projects.stage` `won → in_production`,
`sales_orders.sentToProduction=true`, public tracker `status:'production'`, notifies Production.

**After this spec:**

```
Sales converts quote          Finance records the sale        Design finishes drawings
(openSalesOrderModal)         (openRecordSaleModal /          (Design → project detail)
        │                      "To Design" button)                     │
        ▼                             │                                ▼
 job_projects stage 'won'             ▼                     transferOrderToProduction(o)
 sales_orders 'pending'      transferOrderToDesign(o)       gate: targetDate+priority+notes
 tracker 'confirmed'         · auto-creates a Design         · job stage in_design→in_production
                               project in `projects`         · SO sentToProduction=true
                             · job stage won→in_design       · SO designDoneAt/designDoneBy
                             · SO sentToDesign=true          · tracker status 'production'
                             · tracker status 'design'       · notify Production dept
                             · notify Design dept
```

Design's "no drawings needed" is the same Design→Production transition with
`noDrawingsNeeded:true` stamped on the sales order — it goes through the SAME gate and
notifications, so nothing skips silently.

### Transition table (who / writes / notification / client tracker)

| Transition | Trigger + who may trigger | Writes | Notification | Client tracker |
|---|---|---|---|---|
| Quote → SO | Sales/partner, unchanged (`openSalesOrderModal`) | unchanged, EXCEPT: drop the premature Production notify (see §5.9) | Finance `🧾 New Sales Order` (unchanged), owner notify (unchanged). **No Production notify anymore.** | `confirmed` (unchanged) |
| Finance → Design | (a) "Approve & Record" with the (renamed) checkbox ticked, or (b) the row button **🎨 To Design** — both gated by `isFinancePriv()` exactly like today's Record/To-Production buttons | `projects` doc auto-created (§3.1); `job_projects.stage 'won'→'in_design'` + `designProjectId` + timeline entry; `sales_orders {sentToDesign:true, sentToDesignAt, designProjectId}` | `Notifs.sendToDept('Design', …)` (§6.1) | `design` (new stage, §7) |
| Design → Production | Design project detail buttons **Send to Production** / **No drawings — send to Production**, gated `canEditDept('Design') && window.currentRole!=='secretary'`; also reachable via the generic Advance button on the job project (§5.1.4) | `sales_orders {sentToProduction:true, sentToProductionAt, designDoneAt, designDoneBy[, noDrawingsNeeded:true]}` (+ `targetDate/priority/notes` if the gate panel filled them); `job_projects.stage 'in_design'→'in_production'` + timeline; design `projects` doc gets `{needsDrawings, productionHandoffAt}` | `Notifs.sendToDept('Production', …)` (§6.2) | `production` |
| Production onward | unchanged (production.js prod-advance / advanceProjectStage) | unchanged | unchanged | unchanged (`qc`/`ready`/`delivered`) |

---

## 2. New `JOB_STAGES` (js/screens/production.js ~403) — verbatim

Replace the existing array with exactly this (one new row, nothing else moved):

```js
const JOB_STAGES = [
  { id:'won',           label:'Won',           icon:'🤝', color:'#26a69a', dept:'Sales' },
  { id:'in_design',     label:'In Design',     icon:'🎨', color:'#ab47bc', dept:'Design' },
  { id:'in_production', label:'In Production', icon:'🏭', color:'#7e57c2', dept:'Production' },
  { id:'for_delivery',  label:'For Delivery',  icon:'📦', color:'#26c6da', dept:'Production' },
  { id:'delivered',     label:'Delivered',     icon:'🚚', color:'#42a5f5', dept:'Production' },
  { id:'completed',     label:'Completed',     icon:'✅', color:'#66bb6a', dept:'Sales' },
  { id:'paid',          label:'Paid / Closed', icon:'💰', color:'#43a047', dept:'Finance' },
  { id:'cancelled',     label:'Cancelled',     icon:'✖️', color:'#ef5350', dept:'Sales' },
];
```

Everything that derives from this array (the stepper, `byStage` grouping on the Projects
page, `next = JOB_STAGES[Math.min(idx+1, JOB_STAGES.length-2)]`, `ns.dept` notify) picks the
new stage up automatically — the math still lands on `paid` as the last advanceable stage
(`length-2` = index 6) and `cancelled` stays last. Verified against production.js ~603-609.

---

## 3. New / changed doc shapes

### 3.1 Auto-created Design project (`projects` collection — the existing Design board, NOT `job_projects`)

Created by `transferOrderToDesign` (§5.5). No new collection.

```js
{
  name: `${clientName} — ${jobProjectNo || quoteNumber || 'Order'}`,  // e.g. "ABC Corp — JP-2608-014"
  client: o.clientName || '',
  clientId: o.clientId || null,
  source: 'sales_order',            // distinguishes auto-created from hand-made board projects
  salesOrderId: o.id,               // FK → sales_orders
  jobProjectId: o.projectId || null,// FK → job_projects (same field openProjectEditModal already links)
  jobProjectNo: jobProjectNo || null,
  startDate: window.bizDate(),
  dueDate: o.targetDate || '',      // Sales' target date, if set
  contractAmount: 0,                // [DECISION] money stays in Finance/job_projects — Design board shows none
  notes: '',
  status: 'active',
  needsDrawings: null,              // null=undecided, true=sent with drawings, false=passed through
  productionHandoffAt: null,        // ISO string stamped at Design→Production
  createdBy: currentUser.uid,       // the Finance user recording the sale
  createdByName: who,
  createdAt: firebase.firestore.FieldValue.serverTimestamp()
}
```

Because `contractAmount` is 0, `renderProjects`' money row and `renderProjFinancials`'
"Fully Paid" logic are naturally inert — no code change needed for money hiding on the card.

### 3.2 `sales_orders` — new fields (all optional; existing docs never have them)

```
sentToDesign: true            sentToDesignAt: serverTimestamp
designProjectId: '<projects doc id>'
designDoneAt: serverTimestamp designDoneBy: '<display name>'   (stamped at Design→Production)
noDrawingsNeeded: true                                          (only on pass-through)
```

### 3.3 `job_projects` — new field + new stage value

```
designProjectId: '<projects doc id>'    stage: 'in_design'   (between 'won' and 'in_production')
```

### 3.4 `hub_folders` — new field, NO new collection **[DECISION]**

`window.DesignFolders` (js/departments.js ~183) already implements Design folders on
`hub_folders` with deterministic ids (`proj__{projectId}`, `client__{clientId}`), and the
Files hub + project Files tab already resolve `folderId`. A new `design_folders` collection
would be a second file system competing with it — exactly what the task forbids. So the two
owner-requested folder types become a field:

```
folderType: 'project' | 'sales_order'     // absent on legacy docs → read as 'project'
salesOrderId: '<sales_orders id>' | null  // only on sales_order-type folders
```

- The **auto-created SO folder IS the design project's folder**: deterministic id
  `proj__{designProjectId}` with `folderType:'sales_order'` + `salesOrderId`. The existing
  Files tab (`renderProjectFiles`, design.js ~884: `folderId = 'proj__'+p.id`) then works
  with zero changes, and the Folders tab shows it under "Sales Orders".
- Hand-made folders (new Folders tab, §5.13) get a Firestore auto-id and the user's chosen
  type. `parentId:null, scope:'projects', department:'Design'` in every case (matches the
  existing `_ensure` payload).
- **Composition rule:** folders contain `hub_files` (via `folderId`) only. `design_drawings`
  stay project-scoped and are NOT foldered. A folder never stores file bytes or duplicates
  hub logic — create/rename/delete only touches the `hub_folders` doc.

---

## 4. Handoff fields — who supplies what, and when (nothing dropped)

Today `ensureProdHandoffFields` (departments.js ~3868) makes FINANCE supply
targetDate + priority + notes at "To Production". New homes:

| Field | Optional capture | Mandatory gate (unchanged trio, new moment) |
|---|---|---|
| `targetDate` | Sales at SO creation (`openSalesOrderModal` `#so-target-date`, unchanged) | Design→Production, via the same `ensureProdHandoffFields` panel |
| `priority` | Sales at SO creation (`#so-priority`, unchanged) | Design→Production, same panel |
| `notes` ("Notes for Production") | Sales at SO creation (`#so-notes`, unchanged) | Design→Production, same panel — Design authors/confirms them, per the owner's "add notes for production" |

- Finance→Design demands NOTHING extra — Finance's job is the money, and blocking the
  record on production details defeats the redesign. **[DECISION]**
- The gate panel prefills whatever Sales already entered and saving overwrites both the SO
  and the job project (current `ensureProdHandoffFields` behavior, kept). **[DECISION]** —
  Design is closest to the finished drawings, so their version of the notes wins.
- The three fields remain hard-required before anything reaches Production, exactly as
  today — the gate moved, it did not weaken.

---

## 5. File-by-file change list

> Anchors are `~line` in the current working tree (2026-08-11). Re-locate by the quoted
> code, not the number — other sessions edit this tree live.
> **No new files** → index.html and the sw.js `PRECACHE` list are untouched. `CACHE_VER`
> is derived from `APP_VERSION` and auto-bumped by the pre-commit hook — do NOT hand-edit,
> just commit normally. Note `t/index.html` IS in `PRECACHE` (sw.js ~32-33), so the tracker
> edit ships on the same version bump.
> New top-level bindings in any file: use `var` (or plain `function` declarations), never
> top-level `const`/`let` — a second evaluation of the script must not throw.
> All new DOM lookups: `panel.querySelector(...)` scoped to the `openPage` return value —
> NEVER `document.getElementById` (dying panels linger ~300ms and win the global race).

### 5.1 `js/screens/production.js`

1. **~403 `JOB_STAGES`** — replace with the §2 array verbatim.
2. **~187 `trackerKeyFor`** — add the design key:
   ```js
   return ({ won:'confirmed', in_design:'design', in_production:'production',
             qc:'qc', out_for_delivery:'ready', for_delivery:'ready',
             delivered:'delivered', paid:'delivered' })[id] || null;
   ```
3. **~676 Job Order button gate** `['won','in_production'].includes(p.stage)` and
   **~1214 prod-order eligibility** `.filter(p=>['won','in_production'].includes(p.stage)…)`
   — **leave both unchanged**, and add a one-line comment at each: `'in_design' is
   deliberately excluded — a job in Design cannot get a production order; 'won' is kept
   only for legacy pre-design-flow projects.` **[OWNER]** flag: once all legacy `won`
   projects have flowed through, `'won'` can be removed from both gates.
4. **~690 `#proj-advance-btn` handler + ~779 `advanceProjectStage`** — the generic Advance
   button must not bypass the new flow. Change `advanceProjectStage(p, nextId)` to
   special-case the two design boundaries before its generic write:
   ```js
   async function advanceProjectStage(p, nextId){
     // Design-flow boundaries route through the canonical handoff helpers so the
     // generic Advance button can never skip the design queue or the handoff gate.
     if (nextId === 'in_design' || (p.stage === 'in_design' && nextId === 'in_production')) {
       let so = null;
       try {
         if (p.salesOrderId) { const s = await db.collection('sales_orders').doc(p.salesOrderId).get(); if (s.exists) so = { id:s.id, ...s.data() }; }
         if (!so) { const q = await db.collection('sales_orders').where('projectId','==',p.id).limit(1).get(); if (q.docs.length) so = { id:q.docs[0].id, ...q.docs[0].data() }; }
       } catch(_){}
       if (nextId === 'in_design') {
         if (!so) { Notifs.showToast('No sales order is linked to this project — record the sale in Finance first.','error'); return; }
         const ok = await window.transferOrderToDesign(so);
         if (ok) { Notifs.success('Moved to In Design'); closeModal(); window.renderProjectLifecycle(); }
         return;
       }
       // in_design → in_production
       if (so) {
         const ok = await window.transferOrderToProduction(so);
         if (ok) { Notifs.success('Moved to In Production'); closeModal(); window.renderProjectLifecycle(); }
         return;
       }
       // No SO (legacy/manual project): fall through to the generic write below,
       // but still demand the handoff trio on the job doc via the shared panel.
       const ok = await window.ensureProdHandoffFields({ id:null, projectId:p.id,
         targetDate:p.targetDate, priority:p.priority, notes:p.notes });
       if (!ok) return;
     }
     …existing body unchanged…
   }
   ```
   The existing generic body already notifies `ns.dept` (now 'Design' for in_design) and
   syncs the tracker via `trackerKeyFor` — no further edits there.

### 5.2 `js/departments.js` — `renderSalesOrders` (~3625-3695)

- **~3642 header subtitle:** `Record the sale &amp; payment, then hand off to Design` .
- **~3661 status cell** — add an in-design badge after the existing in-production one:
  ```
  ${o.sentToDesign&&!o.sentToProduction?`<span class="badge badge-purple" style="font-size:9px;margin-left:4px">${emojiIcon('🎨',9)} in design</span>`:''}
  ${o.sentToProduction?`<span class="badge badge-blue" …>${emojiIcon('🏭',9)} in production</span>`:''}
  ```
  (`badge-purple` already exists — used at production.js ~578.)
- **~3662 actions cell** — replace the `so-prod-btn` branch:
  - `status!=='recorded'` → `Record Sale` button (unchanged).
  - `recorded && !o.sentToDesign && !o.sentToProduction` →
    `<button class="btn-secondary btn-sm so-design-btn" data-id="${o.id}">${emojiIcon('🎨',16)} To Design</button>`
    (this is also what legacy recorded-but-never-transferred orders now get — see §8).
  - `sentToDesign && !sentToProduction` → no Finance action; render `${emojiIcon('🎨',16)}`
    with `title="With the Design team"` — Design owns the next step.
  - `sentToProduction` → `${emojiIcon('✓',16)}` (unchanged).
- **~3690 handler block** — replace the `.so-prod-btn` wiring with:
  ```js
  c.querySelectorAll('.so-design-btn').forEach(b=>b.addEventListener('click', async ()=>{
    const o = orders.find(x=>x.id===b.dataset.id); if(!o) return;
    await window.transferOrderToDesign(o); window.renderSalesOrders(container);
  }));
  ```

### 5.3 `js/departments.js` — `openRecordSaleModal` (~3705-3859)

- **~3758-3761** rename the checkbox + helper (keep the `check-row` markup/comment intact):
  - label: `Send to Design now (start drawings)` — id stays `rs-prod` (fewer touch points)
    but rename the const at ~3789 to `toDesign` for readability.
  - helper line: `Posts income to the ledger (with VAT split), updates the project's
    collected balance, and hands the job to the Design team for drawings.`
- **~3852** replace the handoff call:
  ```js
  const sentToDesign = toDesign ? await window.transferOrderToDesign({ ...o, status:'recorded' }) : false;
  closeModal();
  Notifs.success(sentToDesign ? 'Sale recorded + sent to Design'
    : (toDesign ? 'Sale recorded to ledger — the Design hand-off did not complete; use "To Design" on the order to finish it.' : 'Sale recorded to ledger'));
  ```

### 5.4 `js/departments.js` — `ensureProdHandoffFields` (~3868-3905)

Two small edits, no behavior change for the normal path:

- Intro copy (~3873): `Target date, priority and notes weren't all set yet — Production
  needs them before the job can start.` (drop "on this order": the panel now also serves
  SO-less legacy job projects).
- Save handler (~3898): guard the SO write so a pseudo-order `{id:null, projectId}` (from
  §5.1.4) only writes the job doc:
  ```js
  if (o.id) await db.collection('sales_orders').doc(o.id).update({ targetDate, priority, notes });
  if (o.projectId) await db.collection('job_projects').doc(o.projectId).update({ targetDate, priority, notes });
  ```
Also attach it to window (design.js and production.js call it at runtime; a top-level
`function` declaration in this classic script is already a global — verify, and if the
declaration is ever converted, add `window.ensureProdHandoffFields = ensureProdHandoffFields`).

### 5.5 `js/departments.js` — NEW `window.transferOrderToDesign(o)` (insert directly above `transferOrderToProduction`, ~3907)

```js
// Finance→Design handoff (owner's flow, 2026-08-11): every recorded sale goes to
// Design first. Auto-creates the Design-board project (collection `projects`, NOT
// job_projects), advances the job spine won→in_design, stamps the SO, syncs the
// public tracker to 'design', notifies Design. Idempotent: re-running finds the
// existing design project by salesOrderId instead of creating a twin.
// Returns Promise<boolean> like transferOrderToProduction.
window.transferOrderToDesign = async function(o){
  const who = userProfile?.displayName || currentUser.email;
  try{
    // 1) idempotence — an existing design project for this SO wins
    let designProjectId = o.designProjectId || null;
    if (!designProjectId){
      const ex = await db.collection('projects').where('salesOrderId','==',o.id).limit(1).get().catch(()=>({docs:[]}));
      if (ex.docs.length) designProjectId = ex.docs[0].id;
    }
    // 2) resolve the job project number for the display name
    let jobProjectNo = '';
    if (o.projectId){ try{ const ps = await db.collection('job_projects').doc(o.projectId).get(); if (ps.exists) jobProjectNo = ps.data().projectNo || ''; }catch(_){} }
    // 3) create the design project if missing (§3.1 shape)
    if (!designProjectId){
      const name = ((o.clientName||'Client')+' — '+(jobProjectNo||o.quoteNumber||'Order')).trim();
      const ref = await db.collection('projects').add({
        name, client:o.clientName||'', clientId:o.clientId||null,
        source:'sales_order', salesOrderId:o.id,
        jobProjectId:o.projectId||null, jobProjectNo:jobProjectNo||null,
        startDate:(window.bizDate?window.bizDate():new Date().toISOString().slice(0,10)),
        dueDate:o.targetDate||'', contractAmount:0, notes:'', status:'active',
        needsDrawings:null, productionHandoffAt:null,
        createdBy:currentUser.uid, createdByName:who,
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      designProjectId = ref.id;
      // typed folder — the SO folder IS the project folder (deterministic proj__ id)
      try { await window.DesignFolders.ensureProjectFolder(
        { id:designProjectId, name, client:o.clientName||'', clientId:o.clientId||null },
        { folderType:'sales_order', salesOrderId:o.id }); } catch(_){}
    }
    // 4) advance the job spine won → in_design (never drag a later stage backwards)
    if (o.projectId){
      const ps = await db.collection('job_projects').doc(o.projectId).get();
      if (ps.exists){
        const upd = { designProjectId, updatedAt:firebase.firestore.FieldValue.serverTimestamp() };
        if (ps.data().stage === 'won'){
          upd.stage = 'in_design';
          upd.timeline = firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:'Moved to In Design (sale recorded)', by:who });
        }
        await db.collection('job_projects').doc(o.projectId).update(upd);
      }
    }
    // 5) stamp the sales order
    await db.collection('sales_orders').doc(o.id).update({ sentToDesign:true,
      sentToDesignAt:firebase.firestore.FieldValue.serverTimestamp(), designProjectId });
    // 6) public client tracker
    if (o.trackingToken) window.syncOrderTracking(o.trackingToken, { status:'design' });
    // 7) notify the Design department (§6.1)
    try{ await Notifs.sendToDept('Design',{ title:'🎨 New order for design',
      body:`${o.clientName||'Client'}${jobProjectNo?' ('+jobProjectNo+')':''} — sale recorded by Finance. Prepare the drawings, then send to Production.`,
      icon:'🎨', type:'project_stage', link:'dept:Design' }, { fallbackToOwner:true }); }catch(_){}
    window.logAudit && window.logAudit('update','sales_order',o.id,{ sentToDesign:true, designProjectId });
    if (typeof dbCacheInvalidate==='function'){ dbCacheInvalidate('projects-unified'); dbCacheInvalidate('sales_orders'); }
    o.sentToDesign = true; o.designProjectId = designProjectId;
    return true;
  }catch(ex){ Notifs.showToast('Transfer to Design failed: '+(ex.message||ex.code),'error'); return false; }
};
```

### 5.6 `js/departments.js` — `transferOrderToProduction` (~3910-3929)

- **~3918** widen the stage guard: `['won','in_design'].includes(stage)` (`'won'` kept for
  legacy projects that never entered Design — §8).
- **~3923** extend the SO stamp:
  ```js
  await db.collection('sales_orders').doc(o.id).update({ sentToProduction:true,
    sentToProductionAt:firebase.firestore.FieldValue.serverTimestamp(),
    designDoneAt:firebase.firestore.FieldValue.serverTimestamp(), designDoneBy:who });
  ```
- **~3925** notification body: `` `${o.clientName} — design complete${o.noDrawingsNeeded?' (no drawings needed)':''}. Create the production order.` `` (title/icon/type/link unchanged).
- It is already a global (top-level `function` in a classic script) — design.js calls it at
  runtime only, which the load-order contract permits (design.js loads after departments.js).

### 5.7 `js/departments.js` — `ensureOrderTracking` (~3217)

Status ternary gains the design leg:
```js
status:(o.sentToProduction?'production':(o.sentToDesign?'design':'confirmed')),
```

### 5.8 `js/departments.js` — `window.DesignFolders` (~183-208)

- `_ensure(id, data)` — unchanged mechanics; every caller now includes `folderType` in `data`.
- `ensureClientFolder` — add `folderType:'project'` to its payload.
- `ensureProjectFolder(p, opts)` — accept an optional second arg:
  ```js
  async ensureProjectFolder(p, opts){
    opts = opts || {};
    const parentId = p.clientId ? await this.ensureClientFolder(p.clientId, p.client || 'Client') : null;
    return this._ensure(`proj__${p.id}`,
      { name: p.name || 'Project', parentId, scope:'projects', department:'Design',
        projectId: p.id, clientId: p.clientId || null,
        folderType: opts.folderType || 'project', salesOrderId: opts.salesOrderId || null });
  }
  ```
  The existing call site (design.js ~910) passes no `opts` and keeps today's behavior.

### 5.9 `js/departments.js` — `openSalesOrderModal` (~3249-3460)

- **~3301 hint copy:** `Target date, priority and notes must be filled in before the job
  leaves Design for Production — set them now if you already know them, or Design will be
  asked for them at hand-off.`
- **~3440** DELETE the premature Production notify
  (`Notifs.sendToDept('Production',{ title:'🏭 New job to produce', body:'… won — create the
  production order when ready.' …})`). Production now hears about a job exactly once, at the
  Design→Production handoff. Do not replace it with a Design notify — Design's cue is the
  RECORDED sale ("when receiving"), not the order's creation. **[DECISION]**

### 5.10 `js/departments.js` — `deleteSalesOrder` (~3520-3623)

After step 4 (job project delete, ~3604), add a best-effort step 4b:
```js
// 4b) the auto-created Design project + its folder (files in hub_files are left
// in place — they remain visible in the Files hub, just unfoldered).
if (o.designProjectId) {
  await db.collection('projects').doc(o.designProjectId).delete().catch(()=>{});
  await db.collection('hub_folders').doc('proj__'+o.designProjectId).delete().catch(()=>{});
}
```
(President is admin → passes both delete rules.) Add `designDeleted: !!o.designProjectId`
to the `logAudit` payload.

### 5.11 `js/screens/design.js` — `renderDesign` + `loadDesignContent` (~51-86)

- Tab list becomes `['Projects','Drawings','Folders','Clients','Product Designs','References','Tasks']`.
- `loadDesignContent` gains `case 'Folders': await renderDesignFolders(content, currentUser, currentRole); break;`.
- `sopPanel` first bullet becomes:
  `'Projects tracks each design job — sales orders land here automatically when Finance records a sale; finish the drawings, then Send to Production.'`
  and add a bullet: `'Folders organizes design files — two types: Projects and Sales Orders.'`

### 5.12 `js/screens/design.js` — `renderProjects` (~124-216) and the SO handoff card

**renderProjects:**
- Card badge row: for `p.salesOrderId`, append
  `<span class="badge badge-purple" style="font-size:9px">${emojiIcon('🧾',9)} SALES ORDER</span>`
  next to the status badge, and if `!p.productionHandoffAt` also
  `<span class="badge badge-orange" style="font-size:9px">awaiting design</span>`.
- Above the list, a queue line (not a KPI row — keep the page light):
  `` const soQueue = projects.filter(p=>p.salesOrderId && !p.productionHandoffAt).length; ``
  rendered as `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${emojiIcon('🎨',12)} ${soQueue} sales order${soQueue===1?'':'s'} waiting on design</div>` when > 0.
- Sort: SO projects awaiting design first, then the existing createdAt order. **[DECISION]**
  — the queue is the reason Design opens this tab now.

**`renderProjOverview` (~334-360) — the handoff card.** For `p.salesOrderId` only, insert a
card ABOVE the existing info card. Content and gating:

- Fetch (inside the tab render, soft-fail): the SO doc `db.collection('sales_orders').doc(p.salesOrderId).get()`
  and, for the items, the job doc `db.collection('job_projects').doc(p.jobProjectId).get()` when linked.
- Card body:
  - Title row: `${emojiIcon('🧾',16)} Sales Order — for production` plus, when
    `so.sentToProduction`, a `badge-green` `Sent to Production` chip (and hide both buttons).
  - Items table from `job.items`: **columns Item / Qty ONLY — never `unitPrice`, `amount`,
    contract, AR, or payment fields.** Render `it.name` (+ `it.dims`/`it.specStr` small) and
    `Number(it.qty)||0` + `it.unit`, all through `escHtml`. Wrap in `.table-wrap` (375px rule).
  - Meta line: `Target ${so.targetDate||'—'} · Priority ${so.priority||'—'}` (escHtml both).
- Footer buttons (only when `!so.sentToProduction`, gated
  `canEditDept('Design') && window.currentRole !== 'secretary'`):
  - `<button class="btn-success btn-sm" id="dsn-to-prod">${emojiIcon('🏭',16)} Send to Production</button>`
  - `<button class="btn-secondary btn-sm" id="dsn-no-dwg">No drawings needed — send to Production</button>`
- Handlers (scoped to `host`, wrapped in `window.busy(btn, async ()=>{ … })`):
  ```js
  async function sendSO(passThrough){
    // released-drawings guard — one path, but never a silent skip
    let released = 0, total = 0;
    try { const ds = await db.collection('design_drawings').where('projectId','==',p.id).get();
          total = ds.docs.length; released = ds.docs.filter(x=>x.data().status==='released').length; } catch(_){}
    if (!passThrough && released === 0) {
      const ok = await confirmDialog({ message: total===0
        ? 'No drawings exist on this project yet. Send to Production anyway? (Use "No drawings needed" if this order genuinely needs none.)'
        : `None of the ${total} drawing(s) on this project are Released yet. Send to Production anyway?` });
      if (!ok) return;
    }
    if (passThrough) {
      const ok = await confirmDialog({ message:'Mark this order as needing NO drawings and send it straight to Production?' });
      if (!ok) return;
      await db.collection('sales_orders').doc(so.id).update({ noDrawingsNeeded:true });
      so.noDrawingsNeeded = true;
    }
    const done = await window.transferOrderToProduction(so);   // enforces the targetDate/priority/notes gate
    if (!done) return;
    await db.collection('projects').doc(p.id).update({
      needsDrawings: !passThrough, productionHandoffAt: new Date().toISOString(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(()=>{});
    Object.assign(p, { needsDrawings:!passThrough, productionHandoffAt:new Date().toISOString() });
    if (typeof dbCacheInvalidate==='function') dbCacheInvalidate('projects-unified');
    Notifs.showToast('Sent to Production','success');
    window.Overlay.clearAll(); openProjectDetail(p, currentUser, currentRole, canBill, 'Overview');
  }
  ```
  Note `transferOrderToProduction` opens the `ensureProdHandoffFields` page on top when the
  trio is missing — that panel manages its own scoping; nothing extra needed here.
- Design money privacy statement (mirror of `isProductionOnlyViewer`): the new Design
  surfaces may show client name, project/scope, quote number, items (name/qty/dims/spec),
  target date, priority, notes, and stage. They must NOT render contractAmount,
  paymentReceived/recordedAmount, payment method, receipts, VAT, AR/collected, margin, or
  split. This is a UI-level rule, same stance as Production's. (Design-dept staff can still
  open the Finance-side lists they could already open — unchanged, out of scope.)

### 5.13 `js/screens/design.js` — NEW Folders tab (append at end of file)

`async function renderDesignFolders(container, currentUser, currentRole)`:

- Read: `db.collection('hub_folders').where('scope','==','projects').where('department','==','Design').get()`
  (equality-only — served by the existing `(scope, department)` composite index; no new
  index) with the standard hard-fail retry block (copy the `renderProjects` idiom), plus
  `FilesHub.loadFiles('projects').catch(()=>[])` for per-folder file counts.
- Normalize: `folderType = f.folderType || 'project'`.
- Render: `window.chipTabs([{key:'all',label:'All'},{key:'sales_order',label:'Sales Orders'},{key:'project',label:'Projects'}],'all')`
  + `bindChipTabs` filter (client-side), then an `.item-list` of folder cards: name
  (escHtml), type badge (`badge-purple` `🧾 Sales Order` / `badge-blue` `📁 Project`),
  file count, `createdByName`. Header button `+ New Folder` (gated `canEditDept('Design')`).
- **Create** (`openPage('New Folder', …)`, panel-scoped): Name input + Type select
  (`Projects` value `project` / `Sales order` value `sales_order`) →
  `db.collection('hub_folders').add({ name, parentId:null, scope:'projects', department:'Design',
  folderType, salesOrderId:null, createdBy:currentUser.uid, createdByName:who,
  createdAt:serverTimestamp })`. Empty name → toast `Enter a folder name` and stay.
- **Folder detail** (`openPage(folder name, …)`): table of `hub_files` where
  `f.folderId===folder.id && !f.deleted` (filtered from the loaded list) with the same
  columns as `renderProjectFiles` (~892), an Upload button reusing the exact
  `Drive.renderUploadArea` + `hub_files` add block from `renderProjectFiles` ~911-929 but
  with `folderId: folder.id`, `projectId: folder.projectId||null`, `clientId: folder.clientId||null`,
  and footer buttons **Rename** and **Delete** shown only to
  `folder.createdBy===currentUser.uid || ['president','manager','secretary'].includes(currentRole)`
  (mirror of the hub_folders update/delete rule: creator or `isAdmin()`).
  - Rename: prompt page with one input → `update({ name })`.
  - Delete: refuse when the folder still has files —
    toast `Move or delete the ${n} file(s) inside first — deleting a folder never deletes files.`;
    otherwise `confirmDialog` then `delete()`. Auto-created `proj__*` folders: block delete
    entirely with toast `This folder belongs to a project — it is managed automatically.`
    **[DECISION]** — deleting it would orphan the project's Files tab.
- Every user string through `escHtml`; `lucide.createIcons({nodes:[container]})` after each
  injection; all lookups scoped to the panel/container; works at 375px (item-cards, no table
  for the folder list).

### 5.14 `t/index.html` (~120, the `STAGES` array)

Insert between `confirmed` and `production`:
```js
{ key:'design',    name:'Design & Drawings',  desc:'Our design team is preparing your drawings for production.' },
```
Nothing else — `stageIndex` falls back to 0 for unknown statuses, and `stageStamps.design`
is stamped by `syncOrderTracking` automatically when the status is pushed.
**[OWNER — accepted cosmetic]:** legacy orders already at `production`+ will render the new
Design step as ✓-done even though it never ran; the alternative (hiding the step when
`stageStamps.design` is absent) special-cases the timeline and was judged not worth it.

### 5.15 `firestore.rules` — `sales_orders` update (~3169)

Design members must be able to write the handoff fields (today `update` is `canFinance()`
only, which would deny Design's Send-to-Production). Replace the update line with:

```
      // Finance keeps full update rights. Design may write ONLY the design-flow
      // handoff fields (send-to-production stamps + the handoff trio) — never
      // money/status/recorded* fields. hasOnly on the affected-keys diff.
      allow update: if isAuth() && (
        canFinance()
        || ( canDesign()
             && request.resource.data.diff(resource.data).affectedKeys().hasOnly(
                  ['sentToProduction', 'sentToProductionAt',
                   'targetDate', 'priority', 'notes',
                   'designDoneAt', 'designDoneBy', 'noDrawingsNeeded', 'updatedAt']) )
      );
```

That is the ONLY rules change. Collection-by-collection confirmation (rules do NOT cascade
or prefix-match — every touched collection re-checked):
- `projects` — create `isAuth()` ✓ (Finance creates); update creator/admin/`canFinance()`/`canDesign()` ✓ (Design stamps `productionHandoffAt`); read `!isPartner()` ✓.
- `job_projects` — update: non-money keys open to internal staff ✓ (`stage`, `designProjectId`, `timeline` are not in the money-keys list).
- `hub_folders` / `hub_files` — new `folderType`/`salesOrderId` are plain fields; existing create/update/delete rules already fit the Folders tab ✓.
- `order_tracking` — update `!isPartner()` ✓ (Design syncs the tracker).
- `design_drawings`, `notifications` — untouched paths ✓.
- No new collections. All rule field reads in the new clause use `affectedKeys()` — no bare
  reads of possibly-absent fields (the missing-field-throws trap).
- **[OWNER]** `canDesign()` = `isAdmin() || isDesignDept()` and `isAdmin()` includes
  `secretary` — the UI hides the buttons from the secretary, but at the rules layer a
  secretary could write these fields via the console. Consistent with their existing
  job_projects powers; flagged, not changed.

Deploy note: `git push` does NOT deploy rules — run
`~/.npm-global/bin/firebase deploy --only firestore:rules` separately, and re-run
`git diff firestore.rules` immediately before deploying (concurrent sessions edit this tree).

### 5.16 `firestore.indexes.json`

**No changes.** New queries and why each needs no composite entry:
- `sales_orders.where('projectId','==',…).limit(1)` — single-field equality (auto-indexed).
- `projects.where('salesOrderId','==',…).limit(1)` — single-field equality.
- `hub_folders.where('scope','==','projects').where('department','==','Design')` —
  equality-only; already covered by the existing `(scope ASC, department ASC)` composite.
- `design_drawings.where('projectId','==',…)` — existing query, single-field.

---

## 6. Notification payloads (exact)

1. **Finance → Design** (from `transferOrderToDesign`):
   ```js
   Notifs.sendToDept('Design', { title:'🎨 New order for design',
     body:`${o.clientName||'Client'}${jobProjectNo?' ('+jobProjectNo+')':''} — sale recorded by Finance. Prepare the drawings, then send to Production.`,
     icon:'🎨', type:'project_stage', link:'dept:Design' }, { fallbackToOwner:true })
   ```
2. **Design → Production** (in `transferOrderToProduction`, body edited):
   ```js
   Notifs.sendToDept('Production', { title:'🏭 New job to produce',
     body:`${o.clientName} — design complete${o.noDrawingsNeeded?' (no drawings needed)':''}. Create the production order.`,
     icon:'🏭', type:'project_stage', link:'projects-lifecycle' }, { fallbackToOwner:true })
   ```
3. **Removed:** the `🏭 New job to produce … won — create the production order when ready`
   notify at SO creation (openSalesOrderModal ~3440).
4. Generic stage-advance notify in `advanceProjectStage` reaches Design automatically for
   `in_design` (via `ns.dept`) on the SO-less fallback path — unchanged code.

## 7. Client tracker (public) — status vocabulary after this change

`confirmed → design → production → qc → ready → delivered`. Producers of each:
`confirmed` at SO creation; `design` from `transferOrderToDesign` / `ensureOrderTracking`;
`production` from `transferOrderToProduction` and the prod-advance translator; `qc/ready/
delivered` unchanged (production.js `trackerKeyFor`). The client-facing copy for the new
stage is in §5.14.

## 8. Migration — existing data (NO backfill script, nothing moves backwards)

| Existing state | What happens |
|---|---|
| `sales_orders` with `sentToProduction:true` (and their `job_projects` at `in_production`/`for_delivery`/`delivered`/`completed`/`paid`) | Untouched. The row shows ✓ as today; no code path re-enters Design (`transferOrderToDesign` is only reachable from the record checkbox, the To-Design button — which such rows never render — and the Advance button, whose in_design leg only fires from stage `won`). |
| `sales_orders` recorded but never transferred (`status:'recorded'`, no flags) | Row now shows **To Design** instead of To Production — they flow through Design going forward. Their `job_projects` sit at `won`, which `transferOrderToDesign` advances normally. |
| `sales_orders` still `pending` | Unchanged; Record Sale now hands to Design. |
| `job_projects` at `won` with production orders already created (legacy skip) | The `'won'` legs kept in the Job-Order gates (§5.1.3) and in `transferOrderToProduction`'s stage guard mean nothing breaks; they can still be advanced. Flagged for eventual tightening. |
| Design-board `projects` (hand-made) | No `salesOrderId` → no badge, no handoff card, no behavior change. |
| `hub_folders` without `folderType` | Read as `'project'` everywhere (§3.4). |
| `order_tracking` docs | Unknown-status fallback in /t/ is index 0; existing statuses all still resolve. Cosmetic ✓ on the design step for legacy in-production orders — accepted, §5.14. |

No Firestore data is rewritten at deploy time. Zero-downtime: ship the rules FIRST (the new
clause is additive — old clients keep working), then the code.

## 9. Verification checklist (pass/fail)

Setup: local `npx serve -p 3838 .`, one Finance-role user, one Design-dept-only user, one
Production-dept-only user. Never `git stash`/`reset` — scratch-copy files to diff.

1. **Record → Design.** As Finance, Record Sale on a pending SO with "Send to Design now"
   ticked. PASS = toast `Sale recorded + sent to Design`; SO row badge `🎨 in design` and no
   Finance action button; `job_projects.stage === 'in_design'`; a `projects` doc exists with
   `source:'sales_order'`, `salesOrderId`, `contractAmount:0`; a `hub_folders` doc
   `proj__<designProjectId>` with `folderType:'sales_order'` exists; Design user received
   the `🎨 New order for design` notification.
2. **Idempotence.** Click "To Design" again on the same order (force via a second tab on a
   stale list). PASS = no second `projects` doc (query by `salesOrderId` returns exactly 1).
3. **Design queue.** As the Design user, open Design → Projects. PASS = the new project
   shows the `SALES ORDER` + `awaiting design` badges, sorts above older projects, and the
   "N sales orders waiting on design" line counts it. No peso figure anywhere on its card
   or Overview handoff card (items show name/qty only).
4. **Gate intact.** On that project's Overview, click Send to Production with the SO's
   targetDate/priority/notes incomplete. PASS = the "Before sending to Production" page
   appears; Cancel aborts (nothing written); filling all three then saving completes the
   transfer. FAIL if the job ever reaches `in_production` with any of the three blank.
5. **Design → Production effects.** After step 4: PASS = `job_projects.stage ===
   'in_production'`; SO has `sentToProduction:true`, `designDoneAt`, `designDoneBy`; design
   project has `needsDrawings:true`, `productionHandoffAt`; Production user got `🏭 New job
   to produce … design complete`; SO row in Finance shows ✓.
6. **Pass-through.** On a fresh in-design order, click "No drawings needed…". PASS = both
   confirm + gate still run; SO gets `noDrawingsNeeded:true`; design project
   `needsDrawings:false`; Production notification body contains `(no drawings needed)`.
7. **Released-drawings warning.** Send to Production (normal button) with 0 released
   drawings. PASS = the confirm dialog appears; declining aborts with no writes.
8. **Client tracker.** Open `/t/?<token>` after step 1 and after step 5. PASS = after step 1
   the current step is "Design & Drawings" (with today's date stamped); after step 5 it is
   "In Production" with the design step ✓.
9. **Generic Advance respects the flow.** On a job project at `won` (recorded SO), open the
   lifecycle detail and click `Advance → In Design`. PASS = identical effects to step 1.
   At `in_design`, `Advance → In Production` runs the step-4 gate. FAIL if either writes a
   bare stage without the side effects.
10. **Rules.** As the Design-only user (no Finance role/dept), complete step 4. PASS = no
    permission errors (the SO field write succeeds). Then, via console, attempt
    `db.collection('sales_orders').doc(id).update({recordedAmount:1})` as that user.
    PASS = permission denied.
11. **Production money privacy unchanged.** Production-only user opens the job detail.
    PASS = still no contract/AR/margin (regression check on `isProductionOnlyViewer`).
12. **Folders.** As Design: create one folder of each type, rename one, upload a file into
    one via its detail page, verify the file also appears in the Files hub, attempt to
    delete the non-empty folder (PASS = refused with the "move or delete the files" toast),
    delete an empty one (PASS = gone), attempt to delete a `proj__*` folder (PASS = refused
    as auto-managed). Folder list chip-filter by type works.
13. **Legacy untouched.** Pick a pre-existing SO with `sentToProduction:true` and a
    `job_projects` doc at `for_delivery`. PASS = row still shows ✓; opening every screen in
    this spec changes neither doc (verify `updatedAt` unchanged).
14. **Mobile 375px.** Sales Orders table (card mode), Design Projects list, the handoff
    card's items table, and the Folders tab: no horizontal page scroll; wide tables scroll
    inside `.table-wrap`; no truncated client names.
15. **Double-evaluation safety.** In the console, re-inject `js/screens/design.js` (or
    confirm no new top-level `const`/`let` was added in any edited file). PASS = no
    `Identifier has already been declared` throw from new code.
16. **Deploy hygiene.** Commit (hook bumps `APP_VERSION`/`CACHE_VER` — verify `sw.js` shows
    the new `bi-ops-vX.Y.Z`), `firebase deploy --only firestore:rules` after re-diffing the
    rules file, and after push verify the live device shows the new version before testing.

## 10. Open items for the owner (do not resolve in code)

1. Remove `'won'` from the Job-Order gates and `transferOrderToProduction`'s stage guard
   once no live `job_projects` remain at `won` (closes the legacy design-skip).
2. Secretary can technically write the Design handoff fields at the rules layer (§5.15).
3. Legacy orders show the tracker's Design step as ✓ retroactively (§5.14).
4. Should Design's Send-to-Production also require the drawing set to be RELEASED (hard
   block) instead of the current warn-and-confirm? Spec ships warn-and-confirm.
