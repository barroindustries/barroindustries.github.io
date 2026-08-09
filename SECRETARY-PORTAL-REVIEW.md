# Corporate Secretary portal — full review

**Date:** 2026-08-10 · **App version at audit:** v14.0.117

Commissioned by the President ahead of onboarding the Corporate Secretary, whose first
three tasks are: organize the CRM, write a CRM strategy proposal, review Ventures.

Method: seven independent audits (rules boundary, CRM, Ventures, nav reachability,
collaboration/oversight, dead controls, Finance-IT wall), each followed by an adversarial
verifier instructed to REFUTE its findings. 73 defects survived verification;
4 claims were refuted and dropped. Four of the highest-severity findings (L1, L3, L4,
B1) plus the Storage layer were additionally re-checked by hand against the deployed
rules before this document was written.

The role is written as "they" throughout — the role outlives whoever holds it.

> WARNING. This document enumerates working bypasses of the Finance/IT boundary in the
> live system. Keep it in the repo. Do not publish it.

---
# CORPORATE SECRETARY PORTAL — FULL REVIEW

Prepared for the President. Seven independent audits, adversarially verified. The role is described as "they" throughout because the role outlives whoever holds it.

**Headline:** the portal is broadly correct and the person can start work Monday. Finance and IT are genuinely closed on the screens — the department grid, the department router, and the chat channels all block them. But the wall has **seven holes that bypass the screens**, and two of the three assigned tasks are partly blocked by controls the rules already permit but the interface hides.

---

## 1. THE PORTAL — everything the Corporate Secretary can do

Legend: **R** = read-only · **RW** = read and write · **A** = can approve/decide · **✗** = no access

### Sign-in and shell
| | |
|---|---|
| Signs in through the **Admin** portal card | `js/app.js:38-44`, `index.html:113` |
| Gets the **full admin chrome** — identical sidebar and bottom bar to a Manager | `js/app.js:1623-1637`, `js/config.js:544-563` |
| Desktop sidebar, 17 entries in order: Dashboard, Chat, Analytics, Tasks, Posts, Company, All Departments, Approvals, Progress Reports, Team Directory, HR, Attendance, Calendar, Files, Inventory, Projects, Sales Orders | `js/config.js:537-559` |
| Mobile bottom bar: Home, Tasks, Posts, Chat, More → (Team, Approve) | `js/config.js:622-630`, `js/app.js:1748-1751` |
| Product Database, Audit Log, System Health are hidden and router-blocked (President only) | `js/config.js:560-562`, `js/app.js:2721-2723` |

### Dashboard
- **R** Dedicated Corporate Secretary dashboard: oversight banner, pending-approval rollup across 16 queues, People / Pending / Open Tasks / Overdue tiles, a "Not counted here" banner naming any queue the rules refused, 7 governance quick actions — `js/screens/dashboards.js:1615-1738`
- **RW** Their **own** Time In / Time Out / extension request card (this is the fix for "secretary time in cant be found") — `js/screens/dashboards.js:1660-1733`, `firestore.rules:631-633`
- **R** Paid as **Office Team**, `payClass` regular, exactly as directed; role string plays no part in the pay maths — `js/money-core.js:159`, `js/screens/hr.js:1867-1868`

### CRM (this week's work)
- **RW** AEC Leads: list, filter by type/stage/region, create, edit every field including pipeline stage, mint item numbers — `js/screens/sales.js:1397,1474,1551`; `firestore.rules:1794`
- **RW** ROC (restaurant) Leads: same — list, create, edit, change status — `js/screens/crm.js:251,306,372`; `firestore.rules:1806`
- **R** Dashboard funnel (AEC+ROC combined), KPI tiles, follow-ups-due list — `js/screens/crm.js:145-206`
- **R** CSV export and letterheaded print sheets, both directories — `js/screens/crm.js:278-279,449-450`
- **RW** Pipeline → **Convert to Quote**: pushes a Won lead into the BK quote builder and can file a real quote — `js/screens/crm.js:524-537`; `firestore.rules:1401-1421`
- **✗ Delete a lead** — permitted by the rules, hidden by the screen. See defect B1.
- **RW** `# CRM` chat channel — `js/chat.js:364-386`

### Ventures (this week's work)
- **RW** Read the whole portfolio, create a venture, edit name/status/summary/sections/bullets/notes/links/sort order — `js/screens/ventures.js:349,443,773-796`; `firestore.rules:1915-1924`
- **RW** **Delete a venture and its entire brief**, immediately, no approval, no undo — `js/screens/ventures.js:419,486-501`; `firestore.rules:1928`
- **R** Print a letterheaded Venture Brief PDF — `js/screens/ventures.js:442,826-891`
- **RW** Attach a **link** to a venture (works); **✗ upload a file** unless assigned the Ventures department — `storage.rules:284-288`. See defect B3.
- **RW** `# Ventures` chat channel — `js/chat.js:360-386`
- Ventures carries **no money fields at all** — verified field by field, so reading a brief is not a Finance back door — `js/screens/ventures.js:789-796`

### Approvals
| Queue | Level | Evidence |
|---|---|---|
| Sign-ups (mints the user, employee ID, leave accrual) | **A** | `js/svc-approvals.js:24-67`; `firestore.rules:1480` |
| Leave requests (approval debits the balance and writes the days) | **A** | `js/screens/approvals.js:106,497-499`; `firestore.rules:2586` |
| Attendance / time-in extensions | **A** | `js/screens/approvals.js:103`; `firestore.rules:741` |
| Work submissions (+ comment threads) | **A** | `js/screens/approvals.js:104`; `firestore.rules:1341-1365` |
| Tasks awaiting review | **A** | `js/screens/approvals.js:105`; `firestore.rules:815-817` |
| Cash advances | **R** + escalate | `firestore.rules:755` (explicit carve-out) |
| Raise requests | **R** + escalate | `firestore.rules:1182` |
| Payroll delete requests | **R** + escalate | `firestore.rules:1216` |
| Quote / ROA / PO approvals | **R** | `js/screens/approvals.js:110-115` |
| **Finance delete requests** | **✗ denied** | `firestore.rules:2326` — the only money queue with no carve-out |
| "Request President approval" escalation button | **RW** | `js/screens/approvals.js:123-132` |
| 30-day resolved history | **R** | `js/screens/approvals.js:869-945` |

The queue tells the truth about what it could not read — counts show "—" not 0, chips get a 🔒, and a banner names the withheld category — `js/screens/approvals.js:150-156,244-250`. (Two panes inside it still don't; see defect S3.)

### HR
- **RW** Employee Profiles — identity, job title, employment status, start date, edit HR fields — `js/screens/employee-profile.js:256-262`
- **R** People & Roles — can view the directory; **✗ cannot** assign roles, departments, pay class, invite, or offboard — `firestore.rules:466`, `js/screens/people.js:508,1029-1031`
- **RW** Work Sites (geofence admin) — `js/screens/hr.js:396`; `firestore.rules:716`
- **RW** Leave Management — approve/reject, export CSV; **✗** Adjust Balance / Run Accrual / Manage Holidays on that screen — `js/screens/people.js:2225-2227`
- **RW** Company-wide Attendance — pick any employee, correct any day — `js/screens/people.js:1291`; `firestore.rules:620`
- **RW** PH Holidays admin — `js/screens/people.js:1606`; `firestore.rules:1074-1077`
- **✗ Payroll card and Accounts & Logins** — correctly hidden and correctly denied by the rules — `js/screens/hr.js:378,385`
- **R** Their **own** payroll doc and own salary history (this is what makes their payslip work) — `firestore.rules:1126,1133`
- **✗** Everyone else's pay: payroll, salary_history, salary_raises, pay_runs, payslips, worker_profiles, bank_accounts, job_costs — all denied

### Company records (the core of the role)
- **RW** Memos & Board Resolutions — create, publish, tag conforme recipients, delete — `js/screens/dashboards.js:4373`; `firestore.rules:1570-1595`
- **RW** SOPs, Policies, Handbook, Resources, Downloads — `firestore.rules:1108-1111,1558-1569`
- **RW** Products, product metadata, KPI targets, departments config, suggestions
- **RW** Calendar / Meetings — sees the **whole company's** calendar; creates, invites up to 200, RSVPs, exports .ics; edits/cancels meetings they organise — `js/meetings.js:41-43,110-165`
- **RW** Posts — can write a post (always lands *pending*, President publishes); **✗** cannot publish, reject or pin — `firestore.rules:530-552`
- **RW** Files Hub — upload, folder, share, version — `js/screens/people.js:2570-2605`
- **R** Full staff Team Directory, calling cards, presence

### Tasks
- **RW** Create a task in any department, assign anyone, set priority/status/due date, attach a file — `js/screens/tasks.js:304`; `firestore.rules:796-798`
- **RW** Comment on any task
- **✗ in practice**: "All Tasks", editing/reassigning/closing/deleting a task they aren't assigned to — the rules permit all of it, the screen hides it. See defect D1.

### Operations
- **RW** Inventory — items, stock movements, movement history — `firestore.rules:2448-2455`
- **R** Projects lifecycle and Sales Orders — sees contract, collected and outstanding amounts; the Record Sale / To Production buttons are correctly hidden — `js/screens/production.js:485-544`
- **RW** Purchase requisitions — can read and edit; **✗** the approve/reject verdict is senior-admin only — `firestore.rules:2292-2313`
- **RW** Design drawings — create and edit; **✗** cannot approve or release a drawing — `firestore.rules:1653-1682`
- **RW** Production orders — can create and delete but **cannot update** one (rules inconsistency; the screen fences them out anyway) — `js/screens/production.js:659,1149`
- **RW** Sales, Marketing, Government Biddings screens in full

### Chat
- **RW** DMs with anyone internal; groups; announcement channels; group management; message moderation — `js/chat.js:388-396,5369-5381`
- **RW** Every department channel **except `# Finance` and `# IT`**, blocked on both the screen and the rules — `js/chat.js:380-385`; `firestore.rules:34-35,857-887`

### Analytics
- **R** Overview, Sales, Marketing, Production, Gov Biddings, Strategy — plus a "some figures are not shown to you" banner — `js/screens/dashboards.js:4640-4661`
- Money inputs (ledger, payroll, payslips, job costs) are genuinely denied

### Fully closed
Finance books (ledger, journals, expenses, tax records, finance config/periods/rollup, product costs, bank accounts, payslips) · IT credentials (`it_access`) and network config (`it_network`) · every delete-approval (President only) · force-logout and settings writes · user role/salary/department edits.

---

## 2. THE THREE TASKS — can they be done today?

### 1. Organize the CRM — **Partly. The pruning half is blocked.**
They can add, edit, re-stage, filter, export and print leads in both directories. They **cannot delete a single lead**, and there is no "request deletion" fallback either — the rules explicitly give these two collections no delete-request flow. `js/screens/crm.js:252` and `js/screens/sales.js:1398` both hardcode `['president','owner','manager']`, while `firestore.rules:1794/1806` allow delete to `isAdmin()`, which includes them. **One word in each of two files fixes it.**

Secondary friction (affects everyone, not just this role): no merge, no multi-select, no bulk edit, and neither lead collection is in global search — so duplicates cannot even be found by name (`js/screens/people.js:2504-2518`).

### 2. Write a CRM strategy proposal — **They can produce the document, but there is no CRM home for it.**
The only strategy-notes surface in the app has no CRM entry at all (`js/screens/dashboards.js:5293-5296`), and on that same screen the composer is hidden from them (`:5327`) even though the rule permits the write (`firestore.rules:1085-1087`). The CRM department screen has no notes or proposal tab.

Workable today: write it as an **SOP**, a **Memo**, or upload it to the **Files Hub**. Posting it to the feed half-works — it lands pending your approval, and they then have no tab in which to see it back.

### 3. Review Ventures — **Yes for the reading and writing. No for attaching a document, and no place to leave a review comment.**
They can read every brief, create, edit, reorder sections, add links, print, and delete. Two gaps:
- **File upload is denied** unless their profile carries the Ventures department. Firestore says they're an admin; Storage's definition of admin is president/manager only (`storage.rules:98-100,284-288`). Worse, the failure is near-silent: a red bar for 3 seconds, then Save succeeds and reports "Venture saved" with the attachment missing (`js/screens/ventures.js:793,811`). **You can fix this in 30 seconds without code — see Action 1.**
- **There is no review-comment surface.** The only "note" field is inside the author's own editor, so recording an observation means overwriting the brief and re-stamping it with the reviewer's name (`js/screens/ventures.js:795`). For now, tell them venture review discussion goes in the `# Ventures` chat channel.

---

## 3. WHAT IS WRONG — worst first

### THE FINANCE / IT WALL HAS SEVEN HOLES

**L1 — The Files tab hands them the entire Finance document archive, with download buttons.** *(worst one)*
Sidebar → Files opens on a scope picker with two chips labelled "SSS & Gov Docs" and "Accounting", both tagged Finance, with no role filter. Those are exactly where Finance uploads its filings. Each row carries a working download link.
*Mechanism:* `js/screens/people.js:2586-2597` builds the chips unfiltered; `firestore.rules:2863` grants `hub_files` read to `isAdmin()` outright; the stored `url` is a token-bearing Storage link, so the metadata **is** the file (`js/drive.js:30`).
*Fix:* filter the scope list by the blocked-departments list the way the Departments grid already does (`js/screens/dashboards.js:4573-4577`), and narrow `firestore.rules:2863` from `isAdmin()` to `isSeniorAdmin()`.

**L2 — Cloud Storage lets them download and upload into `Finance/` (everything but payslips), and into `IT/`.**
`storage.rules:219-222` admits any signed-in non-partner. The `IT/` folder isn't even a reserved path, so the generic department block covers it (`storage.rules:128-140,290-297`). Note this is company-wide by that file's design — every internal staffer has it — but the 2026-08-09 ruling closed Finance and IT to *this role* in Firestore and storage.rules was never brought in line.
*Fix:* add the role exclusion to the Finance block, add `IT` to the reserved list and give it a member-scoped block like Ventures has.

**L3 — The audit log rebuilds the payroll you removed from them.**
`firestore.rules:2513` grants read to `isAdmin()`, and the log's `details` field carries the numbers: each raise with old and new salary (`js/departments.js:1786`), each month's total net payroll (`:2624`), ledger amounts with client names (`:3512`), cash-advance totals (`js/config.js:2625`). The screen is President-only, but the rules are the boundary and a browser console is one line.
*Fix:* one word — `isAdmin()` → `isSeniorAdmin()` at `firestore.rules:2513`. Their own trail keeps working.

**L4 — The Finance and IT chat block can be bypassed in a single write.**
The dept-channel guard is correct, but membership is checked against the `participants` list *first*, with no department test — and the update rule lets any admin rewrite that list with no membership requirement (`firestore.rules:951-953,857-870`). So `conversations/dept_Finance.update({participants:[myUid]})` succeeds, and the channel and its whole history become readable and postable. Same for `dept_IT`. (The channel must already exist; they can't create it.)
*Fix:* forbid that branch from touching `participants` on a `dept`-type conversation, and require membership.

**L5 — Analytics → Strategy shows a "Finance" chip with real content in it.**
`js/screens/dashboards.js:5295` includes Finance in the chip list, the collection is read unfiltered, and `firestore.rules:1085` grants read to a tier that includes them. Unlike the ledger numbers on that screen, this isn't denied — it renders actual Finance market-research prose.
*Fix:* drop the Finance chip for this role and make the rule department-aware.

**L6 — They can silently close, reassign or delete any IT helpdesk ticket.**
The IT lockdown converted four collections but missed `it_tickets` (`firestore.rules:1690-1693`). Reading tickets is company-wide by design; **write and delete over IT's queue is not.**
*Fix:* use `canIt()` on update and delete.

**L7 — They can read and permanently delete the company error log.**
`firestore.rules:2559,2561` — both `isAdmin()`. Its sibling, the audit log, correctly reserves delete for the President. This lets a non-President erase a diagnostic trail with no approval and no record.
*Fix:* narrow read to senior admin, delete to President.

**Three more, conditional or borderline:**
- **The department override isn't fully sealed.** You ruled that assigning a department must never beat the role decision. Finance and IT enforce that; **Production does not** (`firestore.rules:113-116` has no role test). A secretary given Production regains the ability to create ledger entries and to *write* the monthly published income/VAT figures — while still being unable to read them. Same blind spot in notifications: `Notifs.sendToDept('Finance')` fans out by department with no role filter, so peso amounts would land in their inbox (`js/notifications.js:594-596`).
- **They can approve `ca_deduct`** — a cash-advance-against-pay decision the interface itself classifies as President/Manager only — by direct write (`firestore.rules:1466` vs `js/screens/approvals.js:108`).
- **The whole-company calendar** shows them every Finance and IT meeting's title, agenda and minutes, and lets them **edit or delete** meetings they were never invited to (`firestore.rules:1881,1896-1911`). The read is a deliberate oversight design that predates your Finance ruling; the *write* is not defensible either way.

### THE INTERFACE LIES ABOUT NUMBERS IN FIVE PLACES

**S1 — Progress Reports shows every employee's salary as ₱0 and Net Pay ₱0.** One tap from their dashboard. The payroll read is denied, the denial flag exists and is deliberately returned for exactly this reason (`js/config.js:738`), and this screen throws it away (`js/screens/dashboards.js:3547`), then renders a full "Salary Computation: Base ₱0, Net Pay ₱0" panel. This is the same failure you already reported once as "Payroll ₱0/mo" — still live on a second screen.

**S2 — Analytics shows Revenue ₱0 and Net Cash ₱0** with flat charts and no banner. The ledger denial is swallowed inside a helper before the banner machinery can see it (`js/config.js:893-898`, `js/screens/dashboards.js:4696`).

**S3 — Analytics → Finance says "Payslips — This Month (0) / No payslips this month."** The honesty banner is written before the lazily-loaded Finance figures run, so those denials are never named (`js/screens/dashboards.js:4861,5181-5183`).

**S4 — Approvals "Finance Requests" can say "No finance requests"** while the banner above it says that queue is withheld. The counts were fixed; the two list panes weren't (`js/screens/approvals.js:950,983`). The 30-day History is silently short too.

**S5 — CRM Dashboard and Pipeline cannot report a failure at all.** Both reads are wrapped so the error branch can never fire; a failed load renders a complete, confident, all-zero funnel and a green "✅ No follow-ups due" (`js/screens/crm.js:131-140,201`). The two sibling tabs in the same screen do the opposite and show a Retry button. Not a permission problem today — a network blip produces this — but it's this week's primary work surface.

### CONTROLS THAT ARE THERE BUT DEAD, OR MISSING BUT ALLOWED

**D1 — The Tasks screen treats them as an ordinary employee.** Five hardcoded role lists in `js/screens/tasks.js` omit the role. Result: no "All Tasks" option, and they see only tasks assigned to them personally — while their own dashboard, on the same session, shows them company-wide Open Tasks and Overdue counts. The rules grant full task authority, and the comment in the file points at a helper that was deleted (`js/screens/tasks.js:643-646`).

**D2 — Memos work from one door and not the other.** From the Memos page they get "+ New Memo"; from Company → Memos the button vanishes (`js/screens/dashboards.js:3756` vs `:4373`). And the door that works has **no nav entry at all** — it's reachable only from one dashboard tile. Memos are this role's signature artefact.

**D3 — CRM and Ventures have no nav entry on either surface.** Both are three interactions deep behind "All Departments" on desktop, and drawer-only on mobile (`js/config.js:544-563`).

**D4 — The dashboard's "Admin — Policies & HR Docs" button opens "Module coming soon."** (`js/app.js:3179,3208-3213`)

**D5 — HR's "People & Roles — Assign roles, departments & employee class" card** names the three things they cannot do, then lands on a directory with no such controls (`js/screens/hr.js:392`).

**D6 — Files Hub calls their view "All Scopes" but silently omits every private and unshared file** — the screen treats them as an admin, the data layer doesn't (`js/screens/people.js:2576` vs `js/drive.js:493`).

**D7 — The Approvals "Quote / ROA" tab gives them no buttons and no explanation**, while the same request on the "All Requests" tab shows the escalate button (`js/screens/approvals.js:1331` vs `:503-505`).

**D8 — Post pin and moderator-delete are hidden** though the rules permit both; only post *approval* was meant to be withheld (`js/screens/people.js:157-158`).

**D9 — Audit Log and System Health are permitted by the rules and have no route in for anyone but you.**

**D10 — CRM follow-up alerts never reach them,** and the alert anyone else gets deep-links to `dept:Sales` — where the AEC directory no longer lives, since it moved to CRM. There is no follow-up notifier for ROC leads at all (`js/notifications.js:1239-1254`).

### TWO NOTES, NOT DEFECTS
- **Ventures delete is unilateral and permanent.** One confirm dialog destroys an executive summary and every section, with no archive and no restore (`js/screens/ventures.js:486-501`). The rule justifies it as "low stakes, nothing here is a financial record" — true about money, but this is the artefact you wrote by hand and hired them to review. Your call.
- **A comment in `js/chat.js:372-379` claims the Finance/IT chat hole is still open in the rules.** It isn't — that fix shipped. The comment will send the next person to fix a closed door while the real one (L4) sits two lines above it.

---

## 4. ACTION ITEMS FOR THE OWNER

**1. Assign the Corporate Secretary to the Ventures department in People & Roles.** *(2 minutes, no code)*
This is the only thing that unblocks venture file attachments, and the claim refreshes live so no re-login is needed (`functions/index.js:625-670`). Everything else on that screen already works. **Do not assign Finance or IT** — and **do not assign Production** until the role exclusion is added to `isProductionDept()`, because Production currently reopens ledger-create and the monthly finance figures.

**2. Six decisions only you can make:**

| Question | What's at stake |
|---|---|
| Should they see **finance delete requests**? | It's the only money queue without a carve-out. Their dashboard permanently tells them it's out of reach, sitting next to the payroll queue they *can* see. Either widen the rule to match the other three, or drop the query. |
| Should they see the **audit log**? | Right now the rules say yes and every screen says no. Pick one: open the screen, or narrow the rule (narrowing also closes leak L3). |
| Is the **whole-company calendar** inside the Finance/IT wall? | They currently read every Finance and IT meeting's agenda and minutes. The *edit and delete* half should be narrowed regardless. |
| Are **receivables** Finance? | They can see contract value, amount collected, outstanding balance and top clients per project, on Analytics and Sales Orders. No rule covers it because those are the operational project records, not the ledger. If AR is Finance, it needs hiding at the render layer. |
| Should **Ventures delete** need approval? | Currently one tap, permanent, no undo. |
| Should the **Accountant** be able to use the Admin login card? | The card advertises "Accountant" and the code signs them out. Not a secretary issue, but it's on the shared login screen (`index.html:113`). |

**3. Know that anything typed into a venture brief is readable by them.** The Ventures schema has no money fields by design and I verified that field by field — but `summary` and section bodies are free text with no validation. If a brief contains revenue projections or capital figures, the Finance carve-out does not and cannot cover it. Worth saying once during onboarding.

**4. Two deploys are needed, and they are separate.** `git push` ships the app code but **not** the rules. The Firestore fixes need `firebase deploy --only firestore:rules`; the Storage fixes (L2, Ventures upload) need `firebase deploy --only storage`. Re-diff immediately before deploying — other sessions edit this tree live.

**5. Suggested order of work.** L1 and L3 first — both are one-line rule changes that close the two widest leaks. Then B1 (the CRM delete gate: one word in two files) so they can actually do task 1. Then L4 and L2. The dead controls (D1, D2) are cosmetic to security but they are what will make the role feel broken to the person using it this week.
---

## Appendix — confirmed defects, machine-readable

Every entry below survived an adversarial verification pass. `severity` is the
verifier's rating from the owner's standpoint.

```json
[
 {
  "klass": "LEAK",
  "title": "The #Finance and #IT chat carve-out is bypassable in one write: isAdmin() may rewrite a dept channel's `participants` array, and participant membership is checked unconditionally",
  "detail": "deptChannelOpen() (firestore.rules:34-35) is applied only to the SECOND disjunct of memberOfDoc() (:859-861) and convMember() (:867-869). The FIRST disjunct — `request.auth.uid in participants` — carries no type check and no deptChannelOpen() check at all. The conversation update rule at :951-953 permits `(createdBy==uid || isAdmin()) && affectedKeys().hasOnly([...'participants'...])` with NO membership precondition, no type check, and no size constraint; isAdmin() (:21) includes secretary. Firestore evaluates a write rule independently of read access, so the secretary does not need to read the doc first. The doc id is deterministic — the create rule at :886 pins it to 'dept_' + department. So: `conversations/dept_Finance.update({participants:[myUid]})` is ALLOWED, after which memberOfDoc() and convMember() both return true via the first disjunct, granting read of the conversation doc, read of every message under /messages (:962), and CREATE of new messages (:963-969, type is 'dept' not 'announcement'), plus readers/typing. Identical for dept_IT. The comment at :28-33 states this is 'the layer that counts' and that the client stopped listing the two channels — but the rules-side control it added is routed around. The create rule's participants.size()==0 guard (:887) is a create-time constraint only; nothing re-asserts it on update.",
  "evidence": "firestore.rules:857-870 (memberOfDoc/convMember first disjunct), :951-953 (isAdmin participants update), :886-887 (deterministic id, create-only size guard), :21 (isAdmin includes secretary), :28-35 (the control being bypassed), :962-969 (message read/create via convMember); stale client note js/chat.js:373-379",
  "impact": "The Corporate Secretary can read and post to the Finance and IT department chat threads — payroll discussions, bank/transfer chatter, credential handoffs — which is precisely the boundary owner rulings 1-3 were written to establish. Every other Finance/IT closure in the file is undermined by whatever staff discuss in those two channels.",
  "fix": "Move the deptChannelOpen()/type guard out of the disjunct and into the conjunction, or fence the participants edit: in the :951-953 branch add `&& resource.data.get('type','') != 'dept'` (dept channels derive membership, they never carry participants), and in memberOfDoc()/convMember() require `resource.data.get('type','') != 'dept'` on the participants disjunct so a planted entry cannot confer dept membership.",
  "dimension": "RULES layer — firestore.rules + storage.rules, resolved end to end for role === \"secretary\" (Corporate Secretary)",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "LEAK",
  "title": "storage.rules lets the Corporate Secretary read and write every Finance/* object except payslips — Accounting Documents, SSS/government docs, receipts, taxes, ledger scans",
  "detail": "storage.rules:219 grants read on /Finance/{subfolder}/{fileName} to any signed-in non-partner: `allow read: if isSignedIn() && subfolder != 'payslips' && !isPartnerClaim()`. The secretary's claim role is 'secretary' (functions/index.js:658 mints {role, departments}), so !isPartnerClaim() is true and the read is granted. Line 220-222 additionally grants CREATE of new objects there (the `resource == null || isFinanceClaim()` conjunct only restricts overwrite/delete). These are not hypothetical folders: js/screens/finance.js:412 uploads 'SSS & Government Documents' to Finance/SSS and :2078 uploads 'Accounting Documents' to Finance/Accounting, via js/drive.js:21 which builds the path `${department}/${subfolder}/...`. isFinanceClaim() (storage.rules:110-113) was correctly given the role!='secretary' exclusion on its dept leg on 2026-08-09, but this rule never calls isFinanceClaim() on the read path at all — the 2026-08-09 pass hardened the helper and left the one rule that most needed it untouched. Owner ruling 2 explicitly names expenses, the ledger and taxes as things they lose.",
  "evidence": "storage.rules:219-222; storage.rules:110-113 (the helper that excludes them, unused here); js/screens/finance.js:411-412 and :2076-2078 (real uploads into these folders); js/drive.js:21 (path construction); functions/index.js:658 (claims minted)",
  "impact": "Every scanned receipt, tax filing, BIR document and accounting record Finance has ever uploaded is directly readable by the secretary via a path listing, and they can drop new files into the Finance folders. This is a full-content leak, not metadata.",
  "fix": "Change storage.rules:219-220 to `!isPartnerClaim() && claimRole() != 'secretary'`, or better, introduce a `isFinanceReadable()` helper mirroring firestore.rules' ruling-3 shape so the exclusion lives with the other Finance predicates rather than being restated.",
  "dimension": "RULES layer — firestore.rules + storage.rules, resolved end to end for role === \"secretary\" (Corporate Secretary)",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "LEAK",
  "title": "hub_files grants isAdmin() an unconditional read of every file — including Finance-scope uploads and private files — and lets them rewrite the sharing ACL",
  "detail": "firestore.rules:2862-2867 reads `allow read: if isAuth() && ( isAdmin() || uploadedBy==uid || uid in sharedUserIds || (!isPartner() && visibility=='company') )`. The isAdmin() disjunct is first and unconditional, so it also covers docs with visibility:'private' that were never shared. Because it is a role-only predicate, an unfiltered list query over hub_files is provable and succeeds. The Files Hub is the single collection every Files tab now writes to (js/departments.js:4213-4217 — files_<scope> was retired into hub_files namespaced by a `scope` field), and Finance is one of those scopes: js/screens/finance.js:412 and :2078 call bindFileCollection with dept 'Finance'. Each hub_files doc carries `url`, a token-bearing getDownloadURL string (js/drive.js:30) that resolves without any auth at all, so reading the metadata IS reading the file. firestore.rules:2874-2875 additionally lets isAdmin() perform ANY update, explicitly including the ACL/ownership fields the editor branch below it is fenced away from — so they can also re-share a Finance document to anyone.",
  "evidence": "firestore.rules:2862-2867 (read), :2874-2883 (update, isAdmin unfenced vs the fenced editor branch); js/departments.js:4213-4217 (all scopes live here now); js/screens/finance.js:411-412, :2076-2078 (Finance scope writers); js/drive.js:30 (token URL stored in `url`)",
  "impact": "A second, independent full-content route into Finance documents, plus visibility into every private file any employee has uploaded, plus the ability to silently re-share them. Survives even if the storage.rules Finance leak above is fixed, because the token URL bypasses Storage rules entirely.",
  "fix": "Replace isAdmin() with isSeniorAdmin() on both the read (:2863) and the update (:2875) branch, matching the fix already applied to product_costs at :1552; or scope the admin read by `resource.data.get('scope','') != 'finance'`.",
  "dimension": "RULES layer — firestore.rules + storage.rules, resolved end to end for role === \"secretary\" (Corporate Secretary)",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "LEAK",
  "title": "audit_log is fully readable by isAdmin() and its `details` map carries live pay figures — the exact data owner ruling 2 removed",
  "detail": "firestore.rules:2512-2513 grants `allow read: if isAuth() && (isAdmin() || actorUid==uid)`. isAdmin() (:21) includes secretary and is query-independent, so an unfiltered list of the whole collection is provable and succeeds. The create rule (:2520-2530) permits an arbitrary `details` map of up to 50 keys, and the real call sites put money in it: js/departments.js:1786 logs `('raise-apply', subjectType, subjectId, { from: liveOld, to: r.newAmount })` — a named person's old and new SALARY; js/departments.js:2624 logs `('disburse-payrun','pay_run', month, { totalNet, employeeCount })` — the company's total monthly payroll; js/departments.js:3512 logs `('create','ledger', ledgerId, { source, amount, client })` — ledger amounts and client names; js/config.js:2625 logs cash-advance approval totals; js/config.js:2934 logs worker CA deduction amounts. firestore.rules:1179-1180 states the intent verbatim: 'the APPLIED-raise audit log (/salary_raises) is now money-tier read, so they see the REQUEST, never the resulting pay.' The audit log defeats that sentence directly. The president-only gate on the audit-log VIEWER (js/screens/dashboards.js:238 `if (!isPresident()) return;`) is UI only — the boundary is open.",
  "evidence": "firestore.rules:2512-2513 (read), :2520-2530 (unconstrained details map); js/departments.js:1786, :2624, :3512; js/config.js:2625, :2934; the stated intent at firestore.rules:1179-1180; UI-only gate js/screens/dashboards.js:238",
  "impact": "Every salary change (with before/after amounts), the total net payroll of every disbursed month, and ledger posting amounts are readable by the Corporate Secretary from the browser console, despite payroll, salary_history, salary_raises, pay_runs and ledger all having been correctly closed to them.",
  "fix": "Narrow firestore.rules:2513 to `isSeniorAdmin() || resource.data.get('actorUid','')==request.auth.uid` — nothing the secretary does needs the company-wide audit trail, and their own trail (js/screens/people.js:2934 queries where actorUid==uid) keeps working.",
  "dimension": "RULES layer — firestore.rules + storage.rules, resolved end to end for role === \"secretary\" (Corporate Secretary)",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "LEAK",
  "title": "storage.rules' generic {department} block covers IT/ because 'IT' was never added to isReservedTop()",
  "detail": "storage.rules:128-140 lists the reserved top-level segments the broad block must skip: Finance, Ventures, tasks, posts, general, General, profile-photos, task-comments, chat-files, quote-photos, attendance-selfies. 'IT' is absent. The generic block at :290-297 therefore applies: `allow read: if isSignedIn() && !isReservedTop(department) && (!isPartnerClaim() || isMemberOf(department))` — for a non-partner the second conjunct short-circuits true, so ANY internal staffer including the secretary reads and creates under IT/*. Real objects land there: js/app.js:3235-3236 renders a '<dept> Files' tab and calls bindFileCollection(..., dept, 'Shared'), and js/drive.js:21 builds `IT/Shared/<file>`. The 2026-08-09 pass closed IT in firestore.rules with a purpose-built canIt() (firestore.rules:136) and even froze the IT department against self-minting (:299-308), but never touched storage.rules for IT — only for Finance (:110-113) and Ventures (:134).",
  "evidence": "storage.rules:128-140 (isReservedTop, no 'IT'), :290-301 (generic block); js/app.js:3235-3236 (dept Files tab); js/drive.js:21 (path); the Firestore-side IT closure at firestore.rules:136, :1707-1719, :299-308",
  "impact": "Whatever the IT department files — network diagrams, licence keys, vendor contracts, configuration exports — is readable by the Corporate Secretary by object path, and they can also upload into IT's folders. Same class as the Finance/* leak, second department.",
  "fix": "Add `|| seg == 'IT'` to isReservedTop() (storage.rules:134-139) and give IT its own match block scoped `!isPartnerClaim() && claimRole() != 'secretary' && isMemberOf('IT')`, mirroring the Ventures block at :284-288.",
  "dimension": "RULES layer — firestore.rules + storage.rules, resolved end to end for role === \"secretary\" (Corporate Secretary)",
  "severity": "high",
  "corrected": "Correct. As with the Finance/* finding, note this is company-wide by the file's documented model (storage.rules:270-274 states internal staff get full cross-department access to non-reserved folders) — the secretary is one beneficiary among all internal staff. What makes it a defect for this audit is that the 2026-08-09 ruling closed IT to this role in Firestore and storage.rules was never brought in line.",
  "verified": true
 },
 {
  "klass": "LEAK",
  "title": "Two of the three SECRETARY LEAK fixes are only half closed: isProductionDept() has no role exclusion, so a secretary given the Production department regains ledger-create and finance_rollup-write",
  "detail": "The comments at firestore.rules:2031-2042 and :2153-2157 both prescribe `canProduction() -> isProductionDept()` on the grounds that canProduction() = isAdmin() || isProductionDept() (:117) and isAdmin() contains secretary. The code below each does exactly that (:2043, :2158). But isProductionDept() (:113-116) reads department/departments off the user doc with NO role test — unlike isFinanceDept() (:84-88), which carries `u.get('role',null) != 'secretary'` precisely so that 'one dropdown in People & Roles' cannot restore money access (owner ruling 3, quoted at :75-83). Production is a department the secretary is ALLOWED to hold (the ruling excludes only Finance and IT), so this is a permitted configuration, not an abuse. In that configuration they can (a) create/update finance_rollup/{yyyymm} — month, income, expense, vatOutput, vatInput, byCategory — which ARE the Finance Overview and dashboard KPI tiles, while still being unable to READ them (:2022), and (b) post fenced Production COS debit and Inventory contra credit rows into /ledger (:2158-2177), referencing any existing production_orders doc — including one they created themselves, since production_orders create is still canProduction() (:2474). The same dept-keyed blind spot exists in notification routing: js/notifications.js:604-606 fans Finance alerts out by `department == 'Finance'` / `departments array-contains 'Finance'` with no role test, so a Finance-dept-assigned secretary would receive Finance notifications carrying amounts (js/departments.js:2586, :3268, :4173).",
  "evidence": "firestore.rules:113-116 (isProductionDept, no role test) vs :84-88 (isFinanceDept, has one), :2031-2043, :2153-2158, :2474 (production_orders create still canProduction), :2022 (rollup read denied — write-without-read), ruling 3 at :75-83; js/notifications.js:604-606",
  "impact": "The exclusion is asserted as role-based but is enforced department-by-department, so it is one People & Roles edit away from evaporating for the ledger and the published monthly finance figures — the identical failure mode ruling 3 was written after. Write-without-read is the worse half: they can restate a month's reported income/VAT without being able to see what they changed it from.",
  "fix": "Add the same exclusion isFinanceDept() carries: `u.get('role', null) != 'secretary'` inside isProductionDept() (firestore.rules:114-115), or write the two money legs as `(isProductionDept() && !isSecretary())`. Mirror it in js/notifications.js sendToDept by filtering out role=='secretary' for the Finance department.",
  "dimension": "RULES layer — firestore.rules + storage.rules, resolved end to end for role === \"secretary\" (Corporate Secretary)",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "BLOCKED_WORK",
  "title": "The Corporate Secretary cannot attach a document to a venture — storage.rules' Ventures block admits only president/manager or an explicit Ventures dept claim",
  "detail": "Firestore lets them do all the Ventures work: read, create, update and delete ventures docs, because canDept('Ventures') resolves through isAdmin() (firestore.rules:1915-1928). But the brief attachment lives in Storage at Ventures/Briefs/*, and storage.rules:284-288 gates it on `isMemberOf('Ventures')` = `isAdminClaim() || hasClaimDept('Ventures')`, where isAdminClaim() (:98-100) is `president || manager` only. A secretary whose profile does not carry the Ventures department fails both legs, so the `ref.put()` in js/drive.js:26 and the following getDownloadURL() at :30 are both denied — the upload area (js/screens/ventures.js:649-651, opts {dept:'Ventures', subfolder:'Briefs'}) fails with storage/unauthorized. The generic {department} block is not a fallback: 'Ventures' is in isReservedTop() (storage.rules:134). Reading an ALREADY-attached file still works, because the stored fileUrl is a token-bearing URL that bypasses rules. The comment at js/screens/ventures.js:644-647 asserts the opposite — 'already covered by storage.rules' generic /{department}/{subfolder}/{fileName} block ('Ventures' is not a reserved top-level segment), so no storage.rules change was needed' — and firestore.rules:1839-1842 repeats it. Both are stale; storage.rules:130-134 documents making Ventures reserved on the same date.",
  "evidence": "storage.rules:284-288 and :98-100 and :134; js/drive.js:26-30 (put + getDownloadURL); js/screens/ventures.js:644-651 (upload wiring and the stale comment); firestore.rules:1915-1928 (Firestore permits the work) and :1839-1842 (the second stale comment)",
  "impact": "Task 3 as assigned — 'Review Ventures' — half fails: they can read and edit every venture record but cannot file a single supporting document against one, and the failure surfaces as a raw storage/unauthorized rather than an explanation. Two in-repo comments actively mislead the next reader about why.",
  "fix": "Add the secretary to the Ventures storage gate — `allow read/write: if isSignedIn() && !isPartnerClaim() && (isMemberOf('Ventures') || claimRole() == 'secretary')` at storage.rules:285-286 — or, cleaner, give storage.rules an isAdminClaim() that matches firestore.rules' isAdmin() and handle the Finance/IT exclusions explicitly as the Finance helper already does. Then correct the two stale comments.",
  "dimension": "RULES layer — firestore.rules + storage.rules, resolved end to end for role === \"secretary\" (Corporate Secretary)",
  "severity": "high",
  "corrected": "Accurate, with one scope note: the failure is conditional on the secretary's profile not carrying the Ventures department. If they are assigned Ventures (which the owner's instruction to 'make sure secretary has access to ... ventures' implies), hasClaimDept('Ventures') is true and uploads work. The defect is that Ventures access is granted by ROLE in Firestore and by DEPARTMENT CLAIM in Storage, so the two files disagree about who can do the same job.",
  "verified": true
 },
 {
  "klass": "LEAK",
  "title": "approval_requests lets the secretary approve type 'ca_deduct', which the client's own authority table classifies as money and reserves to president/manager",
  "detail": "firestore.rules:1463-1467 reads `allow update: if isAuth() && ( isSeniorAdmin() || (isAdmin() && resource.data.get('type','') in ['signup','attendance','submission','review-task','leave','ca_deduct']) )`. The comment two lines above (:1458-1462) states the intent as 'secretary ... may only act on the MINOR request types; money/quote/finance approvals need president or manager'. But ca_deduct is not minor: APPROVAL_CAPS in js/screens/approvals.js:108 lists it as `['president','manager']` with the note 'v12 WS22 — employee's CA-deduction-for-this-run request', i.e. it decides how much cash-advance is deducted from a person's pay in a given run. Owner ruling 1 is that money requests stay VISIBLE and READ-ONLY. Every sibling money verb was correctly narrowed — cash_advances update is isMoneyAdmin (:775-781), pending_raises approval is isPresident (:1196-1197), payroll_delete_requests approval is isPresident (:1218) — this one entry was left in the secretary's allowlist.",
  "evidence": "firestore.rules:1463-1467 (the allowlist), :1458-1462 (the stated intent it contradicts); js/screens/approvals.js:108 (APPROVAL_CAPS['ca_deduct'] = president/manager), :117-118 (canActOn/canEscalate); the correctly-narrowed siblings at firestore.rules:775-781, :1196-1197, :1218",
  "impact": "A money decision the UI deliberately hides from them is approvable by direct write. It also means the rules and APPROVAL_CAPS disagree about the same request type, so a future UI change that trusts the rules would silently hand them the button.",
  "fix": "Remove 'ca_deduct' from the isAdmin() branch at firestore.rules:1466, leaving it to isSeniorAdmin() — this makes the rule an exact mirror of APPROVAL_CAPS.",
  "dimension": "RULES layer — firestore.rules + storage.rules, resolved end to end for role === \"secretary\" (Corporate Secretary)",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "SILENT_EMPTY",
  "title": "Analytics still renders 'Revenue ₱0 / Net Cash ₱0' to the secretary with no explanation — the ledger denial can never reach the _denied banner because ledgerSince() swallows it",
  "detail": "js/screens/dashboards.js:4640 admits the secretary to Analytics by name. The block at :4643-4653 documents the silent-zero problem and builds a `_denied` list surfaced as a banner, with 'Income & expenses (ledger)' registered in _DENY_NAMES at :4657. The mechanism only fires through `_noteDenied`, which is called from `safeGet` (:4663) and `cg` (:4669). But the ledger fetch at :4696 uses neither: `(window._AN_LED_START ? ledgerSince(window._AN_LED_START) : dbCachedGet('ledger', ()=>db.collection('ledger').get().catch(()=>({docs:[]})), 60000))`. Both branches swallow internally — js/config.js:893-898 shows ledgerSince wrapping its query in `.catch(() => ({docs:[]}))` INSIDE the dbCachedGet fetcher, so the promise RESOLVES with an empty snapshot and never rejects. _noteDenied is never invoked for the ledger, so 'Income & expenses (ledger)' cannot be added to _denied on any path. /ledger read is canFinance() (firestore.rules:2052), which the secretary fails. The payroll half of the same screen WAS fixed properly (fetchUsersWithPayroll returns a payrollDenied flag at js/config.js:738, consumed at js/screens/dashboards.js:4706) — so this is one uncaught channel in an otherwise-completed fix, not an unaddressed area.",
  "evidence": "js/screens/dashboards.js:4640 (secretary admitted), :4643-4657 (the banner mechanism and _DENY_NAMES), :4663/:4669 (_noteDenied call sites), :4696 (the ledger fetch that uses neither); js/config.js:893-898 (ledgerSince swallows the rejection internally); firestore.rules:2052 (canFinance read); the correctly-fixed comparison at js/config.js:728/:738 and js/screens/dashboards.js:4706",
  "impact": "On the company Analytics page the Corporate Secretary sees a confident Revenue ₱0 and Net Cash ₱0 with charts flat at zero and no 'not shown to you' marker — indistinguishable from a business with no income. The comment at :4643-4653 asserts this was fixed, so a reader will not look again.",
  "fix": "Make ledgerSince()/gjForPeriod() propagate rather than swallow (drop the inner `.catch(() => ({docs:[]}))` at js/config.js:895 and :897) and route the Analytics ledger fetch at js/screens/dashboards.js:4696 through `cg`, or have ledgerSince stamp a `_denied` flag on its resolved value the way fetchUsersWithPayroll stamps payrollDenied.",
  "dimension": "RULES layer — firestore.rules + storage.rules, resolved end to end for role === \"secretary\" (Corporate Secretary)",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "LEAK",
  "title": "it_tickets was missed by the canIt() pass: the secretary can read, update and delete every IT helpdesk ticket",
  "detail": "The 2026-08-09 IT closure introduced canIt() (firestore.rules:136) and applied it to it_assets write (:1707), it_software write (:1711), and both read and write on it_access (:1714-1715) and it_network (:1718-1719). The comment at :1696-1704 walks through the reasoning collection by collection and never mentions it_tickets, which sits immediately above at :1687-1693 and still reads `allow read: if isAuth() && !isPartner()` (:1688), `allow update: if isAuth() && (resource.data.createdBy == request.auth.uid || isAdmin())` (:1690-1692) and `allow delete: if isAuth() && isAdmin()` (:1693). isAdmin() includes secretary (:21). So they hold full moderator rights over the IT department's ticket queue. This is materially different from the it_assets/it_software read, which :1699-1703 defends as a deliberate decision about a company-wide inventory every employee can already see — nobody argued for giving the secretary write and delete over IT's work queue.",
  "evidence": "firestore.rules:1687-1693 (it_tickets, untouched), :1696-1704 (the pass's own reasoning, which omits it), :1707/:1711/:1714-1719 (the four collections that were converted), :136 (canIt), :21 (isAdmin includes secretary); client-side the IT screen is blocked at js/app.js:3140-3142, so this is reachable only by direct write",
  "impact": "Ticket bodies routinely carry system details, account names and access problems; the secretary can read all of them and can also silently alter or destroy IT's queue. The department is supposed to be closed to them.",
  "fix": "Change it_tickets update's admin disjunct and its delete rule from isAdmin() to canIt() (firestore.rules:1691, :1693), and decide the read explicitly — either leave it at !isPartner() with a comment matching the it_assets rationale, or narrow it to canIt() || createdBy == uid so a non-IT reporter still sees their own ticket.",
  "dimension": "RULES layer — firestore.rules + storage.rules, resolved end to end for role === \"secretary\" (Corporate Secretary)",
  "severity": "medium",
  "corrected": "The update and delete claims are correct and secretary-specific. The READ claim is not: `!isPartner()` admits every internal employee, so ticket bodies are already company-readable by design — the same rationale the pass defends for it_assets/it_software at :1699-1703. The secretary-specific delta is moderator write and delete over IT's queue, not read access.",
  "verified": true
 },
 {
  "klass": "SILENT_EMPTY",
  "title": "finance_delete_requests is the one money-request queue with no isSecretary() carve-out, so the Approvals 'Finance Requests' tab shows them only half its contents",
  "detail": "Owner ruling 1 is implemented as an explicit `|| isSecretary()` on three read rules: cash_advances (firestore.rules:755), pending_raises (:1182) and payroll_delete_requests (:1216), each with a comment citing the ruling and the silent-zero hazard. finance_delete_requests is the fourth queue on the same Approvals screen and its read is plain canFinance() (:2326), which the secretary fails. The Approvals screen queries BOTH halves into the SAME chip: js/screens/approvals.js:163 ('Payroll delete requests' → chip 'finance-requests') and :164 ('Finance delete requests' → chip 'finance-requests'). The count path is well-behaved — _apq (:151-157) stamps the denial and :193 appends a 🔒 to the label — but the list path is not: the 'all'-tab refetch at :386 uses a bare `.catch(e => {console.error(...); return {docs:[]};})`, so on any revisit after the first-load cache is consumed the finance-delete rows simply are not in the list, with nothing in the UI saying so. js/screens/dashboards.js:1235 and :1650 query the same collection for the dashboard pending counts.",
  "evidence": "firestore.rules:2326 (no carve-out) vs the three siblings at :755, :1182, :1216; js/screens/approvals.js:163-164 (both feed chip 'finance-requests'), :151-157 and :193 (count path handled), :386 (list path swallows); js/screens/dashboards.js:1235, :1650",
  "impact": "Either the owner intended the secretary to see this queue — in which case they are blind to half the Finance Requests tab and cannot escalate what they cannot see — or they did not, in which case the tab is misleadingly labelled as one queue. Both readings are defects; the inconsistency with three identically-shaped siblings makes an oversight the more likely explanation.",
  "fix": "Confirm the intent with the owner. If it matches ruling 1 as the three siblings do, change firestore.rules:2326 to `if isAuth() && (canFinance() || isSecretary())` with the same comment block. Either way, give the list path at js/screens/approvals.js:386 the same denial stamping the count path already has.",
  "dimension": "RULES layer — firestore.rules + storage.rules, resolved end to end for role === \"secretary\" (Corporate Secretary)",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "production_orders: the secretary may create an order and delete an order, but may never update one",
  "detail": "firestore.rules:2490 correctly applies the explicit role exclusion — `allow update: if isAuth() && !isPartner() && canProduction() && !isSecretary()` — with a detailed rationale (:2477-2489) about consumeProductionMaterials committing inventory decrements and the one-shot materialsConsumed flag before its ledger legs. But the neighbouring verbs were not given the same treatment: create at :2474 is `(canProduction() || inDept('Sales'))`, and canProduction() (:117) = isAdmin() || isProductionDept(), so the secretary passes; delete at :2499 is isAdmin(), so they pass there too. The result is a principal who can bring an order into existence and can destroy one, but cannot advance its stage, edit its contents, or correct a mistake they made on creation.",
  "evidence": "firestore.rules:2474 (create, canProduction), :2490 (update, !isSecretary), :2499 (delete, isAdmin), :117 (canProduction includes isAdmin)",
  "impact": "If the secretary creates a production order — which the boundary permits and no rule discourages — it is immediately frozen: their only remaining action on it is deletion. Any UI that offers them a Job Order or stage control will fail on save. It also means the ledger-leg protection at :2477-2489 is reasoned from an assumption (that they cannot start the half-write) that the create rule does not actually enforce.",
  "fix": "Make the three verbs agree. Either add `&& !isSecretary()` to create (:2474) and delete (:2499), matching the update rule's stated reasoning, or drop it from update — but the create-and-delete-but-not-edit shape should not survive either way.",
  "dimension": "RULES layer — firestore.rules + storage.rules, resolved end to end for role === \"secretary\" (Corporate Secretary)",
  "severity": "low",
  "corrected": "The rules inconsistency is real; the DEAD_CONTROL impact is not. The claim 'Any UI that offers them a Job Order or stage control will fail on save' is refuted — the Production screen already fences this role by name: js/screens/production.js:659 renders the Job Order button only when `window.currentRole !== 'secretary'`, and :1149 sets `const canEdit = canEditDept('Production') && (window.currentRole !== 'secretary');` with a comment at :1136 explaining why. So no UI path offers create or stage edits to them. What survives is a rules-consistency defect reachable only by direct write, and the observation that the :2477-2489 rationale ('excluding the secretary here means they cannot start the half-write') is contradicted by the create rule at :2474.",
  "verified": true
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "strategy_notes: the rules give the secretary read AND write on every deptKey including 'finance', while the client deliberately makes them view-only",
  "detail": "firestore.rules:1084-1088 gates strategy_notes on isOpsAdmin() for both read and write, and the comment at :1082-1083 states the divergence openly: 'Secretary is view-only CLIENT-side (WS25 decision-9 pattern) — rules keep the tier uniform.' isOpsAdmin() (:69) includes secretary. The docId set includes 'finance' (js/screens/dashboards.js:5293-5296 STRAT_DEPTS), and the screen loads the whole collection unfiltered (:5318 `cg('strategy_notes', db.collection('strategy_notes'))`), so the Finance chip and its market-research notes render for them. The client write gate at :5327 is `['president','manager','finance'].includes(currentRole)` — secretary excluded. This decision predates owner rulings 2 and 3 (2026-08-08/09) and was not revisited when the Finance boundary was drawn; strategy_notes/finance is a Finance-labelled surface.",
  "evidence": "firestore.rules:1084-1088 with the divergence admitted at :1082-1083, :69 (isOpsAdmin includes secretary); js/screens/dashboards.js:5293-5296 (Finance is a chip), :5318 (unfiltered collection read), :5327 (canWrite excludes secretary), :4640 (secretary admitted to Analytics)",
  "impact": "Two things at once: the secretary reads Finance strategy/market-research notes, which the department exclusion arguably should cover; and the boundary permits a write the UI refuses, so the rules cannot be relied on as a statement of intent for this collection.",
  "fix": "Decide it once. If Finance notes are out of scope for them, split the read/write by deptKey — `deptKey != 'finance'` for the secretary — or narrow write to isSeniorAdmin()||canFinance() and leave read uniform. Then update the :1082-1083 comment to match rather than describing a known divergence.",
  "dimension": "RULES layer — firestore.rules + storage.rules, resolved end to end for role === \"secretary\" (Corporate Secretary)",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "CRM deletes: the rules grant the secretary delete on aec_contacts, roc_leads and clients, but every CRM screen hides the button from them",
  "detail": "All three CRM collections put delete on isAdmin() (firestore.rules:1795 aec_contacts, :1807 roc_leads, :2788 clients), which includes secretary (:21). Every client-side gate uses a hardcoded list that omits them: js/screens/crm.js:252 `canDeleteDirect = ['president','owner','manager'].includes(currentRole)`, js/screens/sales.js:1398 the same for AEC, js/screens/sales.js:1756 the same again in the client list. Their edit gates, by contrast, correctly resolve through canEditDept (js/screens/crm.js:251, js/screens/sales.js:1397) and do admit the secretary.",
  "evidence": "firestore.rules:1795, :1807, :2788, :21; js/screens/crm.js:251-252, js/screens/sales.js:1397-1398, :1756",
  "impact": "Task 1 as assigned is 'Organize the CRM', and removing duplicate or dead leads is a core part of organizing a lead directory. The boundary permits it; the screen does not offer it. They will have to ask a manager to delete rows they are otherwise fully authorised to delete.",
  "fix": "Add 'secretary' to the three canDeleteDirect lists (js/screens/crm.js:252, js/screens/sales.js:1398 and :1756) so the UI matches the boundary — or, if deletion is meant to be withheld, narrow the three rules to isSeniorAdmin() so the boundary matches the UI. Do not leave them disagreeing on the role's headline task.",
  "dimension": "RULES layer — firestore.rules + storage.rules, resolved end to end for role === \"secretary\" (Corporate Secretary)",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "LEAK",
  "title": "The files_* and budgets_* wildcard blocks admit any non-partner, so files_finance / files_it / budgets_finance are readable by the secretary",
  "detail": "firestore.rules:2817-2828 grants read/create/update/delete on any collection matching `files_.*` to any signed-in non-partner, and :2830-2850 grants read on any `budgets_.*` to any signed-in non-partner. Neither carries a role or department test on the read. The file at :2807-2816 warns explicitly about this union-permit trap. The comment at :2818-2823 notes that a files_* doc's `url` field is a token-bearing Storage download link — full file content, not metadata. Exposure is currently latent rather than live: files_<scope> was retired into hub_files (js/departments.js:4213-4217), so no new files_finance rows are being written, and renderBudgeting is only wired for Marketing today (js/departments.js:1110-1111), with the collection name computed as `budgets_${dept.toLowerCase()}` at :3969 — so budgets_finance would come into existence the moment a Finance budgeting screen ships. Legacy files_* documents from before the WS38 migration may still exist and are still readable.",
  "evidence": "firestore.rules:2817-2828 (files_* read), :2838 (budgets_* read), :2807-2816 (the union-permit warning), :2818-2823 (url is a token-bearing link); js/departments.js:4213-4217 (files_* retired), :3969 (budgets_<dept> naming), :1110-1111 (only Marketing wired today)",
  "impact": "Any surviving legacy Finance or IT file metadata is readable today with a directly-usable download link, and the first Finance budgeting screen anyone ships will be silently company-readable — including by the secretary — because the wildcard has no opt-out.",
  "fix": "Add a scope guard to both blocks. For files_*: `&& !(coll in ['files_finance','files_it'])` on the read, or better, migrate/delete the legacy docs and remove the block. For budgets_*: gate the read on `isMoneyAdmin() || inDept(resource.data.get('dept',''))` so a department's budget is visible to that department, mirroring what the write rules at :2845-2850 already do.",
  "dimension": "RULES layer — firestore.rules + storage.rules, resolved end to end for role === \"secretary\" (Corporate Secretary)",
  "severity": "low",
  "corrected": "Accurate but not secretary-specific and currently latent: the read is open to every non-partner employee, not to the secretary in particular, and the two named collections (files_finance, budgets_finance) either hold only pre-WS38 legacy rows or do not exist yet. It is a future-exposure / hygiene item rather than a live boundary breach for this role.",
  "verified": true
 },
 {
  "klass": "BLOCKED_WORK",
  "title": "The secretary cannot delete a junk lead in EITHER CRM directory — the rules allow it, both screens hide the button",
  "detail": "firestore.rules grants delete on both lead collections to isAdmin(), and isAdmin() is defined as ['president','manager','secretary'] (firestore.rules:20). Both directory screens, however, compute their own delete gate as a hardcoded role list that omits 'secretary': `const canDeleteDirect = ['president','owner','manager'].includes(currentRole)`. So the trash icon is never rendered for them on either AEC or ROC rows, and there is no other delete path in the app for these collections (no financeDelete route, no delete-request flow — the rules comments at firestore.rules:1791 and 1802-1803 say so explicitly). 'Organize the CRM' is precisely the job of pruning junk and merging duplicates; the deleting half of it is unreachable through the UI. Note the mirror-image asymmetry: the same two screens DO show them Add and Edit, because those gates go through canEditDept() (js/departments.js:35), which is secretary-aware. Only the delete gate was left as a literal role array.",
  "evidence": "UI gates: js/screens/crm.js:252 and its consumer js/screens/crm.js:307; js/screens/sales.js:1398 and its consumer js/screens/sales.js:1475 (handler js/screens/sales.js:1571, js/screens/crm.js:394). Rules: firestore.rules:1795 (aec_contacts delete = isAuth() && isAdmin()), firestore.rules:1807 (roc_leads delete, identical), firestore.rules:20 (isAdmin includes secretary). DISAGREE.",
  "impact": "The person the owner assigned to organize the CRM this week can add and edit leads but cannot remove a single one. Duplicate and dead rows accumulate and inflate every funnel count on the Dashboard (js/screens/crm.js:149-153) and every CSV they export. They must ask the President or a Manager to delete each row.",
  "fix": "Change both literals to include the role, matching the rule they mirror: use `window.isAdminPriv()` (js/departments.js:66-70 — already exactly president/owner/manager/secretary, and already the documented client mirror of firestore.rules' isAdmin()) at js/screens/crm.js:252 and js/screens/sales.js:1398. No rules change is needed; the boundary already permits it.",
  "dimension": "CRM — can the Corporate Secretary actually perform tasks 1 (\"organize the CRM\") and 2 (\"write a proposal for CRM strategy\")?",
  "severity": "high",
  "corrected": "",
  "verified": true
 },
 {
  "klass": "LEAK",
  "title": "Files Hub offers the secretary the two Finance file scopes, and the hub_files read rule admits them via isAdmin()",
  "detail": "renderFilesHub builds its scope chips from SEED_SCOPES, which includes { key:'sss', label:'SSS & Gov Docs', dept:'Finance' } and { key:'accounting', label:'Accounting', dept:'Finance' }, and applies NO SECRETARY_BLOCKED_DEPTS filter — unlike the two other places that render department-derived lists, renderDepartments (js/screens/dashboards.js:4573-4577) and Chat's myDeptChannels (js/chat.js:379-385), which both filter. Worse, it explicitly names the role in `isAdminRole = ['president','manager','owner','secretary']` at people.js:2576, which unlocks the extra '🌐 All Scopes' chip for them. On the rules side, hub_files read leads with a bare isAdmin() disjunct, so the boundary itself grants the Corporate Secretary read on EVERY hub_files doc regardless of scope, uploader or visibility — including private, unshared Finance documents. hub_files update carries the same isAdmin() disjunct. The client only issues the three narrow provable queries for them (js/drive.js:493-501 lists isAdminRole as president/manager/owner, without secretary), so today's UI surfaces only company-visibility Finance files — but that is client-side restraint, not a boundary, and a console read by doc id succeeds.",
  "evidence": "UI: js/screens/people.js:2576 (isAdminRole includes 'secretary'), 2587-2588 (the two Finance scopes), 2594-2598 (chips built with no blocked-dept filter), 2635-2636 (bindFileCollection called with dept 'Finance'). Rules: firestore.rules:2862-2867 (hub_files read, isAdmin() first disjunct), 2874-2875 (update, same), 20 (isAdmin includes secretary). Contrast the filtered lists: js/screens/dashboards.js:4573-4577 and js/chat.js:379-385.",
  "impact": "Direct contradiction of the owner ruling 'corporate secretary can access all departments except finance, and IT'. The UI actively advertises Finance document scopes to them, and the rule lets them read any Finance-scoped hub_files doc — including its `url`, which is a token-bearing Storage download link (the same exfiltration path firestore.rules:2824-2827 calls out for the files_* family). Storage compounds it: storage.rules:218-223 lets any non-partner read Finance/* except payslips.",
  "fix": "Two parts. UI: filter SEED_SCOPES in js/screens/people.js by SECRETARY_BLOCKED_DEPTS the same way js/screens/dashboards.js:4573-4577 does (`.filter(s => !_blocked.includes(s.dept))`). Rules: replace the bare `isAdmin()` disjunct at firestore.rules:2863 and :2875 with a scope-aware guard — e.g. `(isAdmin() && !(isSecretary() && resource.data.get('scope','') in ['sss','accounting']))`, or better, add a `dept` field to hub_files and gate on deptOpenToSecretary() (firestore.rules:33), which is the helper already written for exactly this.",
  "dimension": "CRM — can the Corporate Secretary actually perform tasks 1 (\"organize the CRM\") and 2 (\"write a proposal for CRM strategy\")?",
  "severity": "blocker",
  "corrected": "",
  "verified": true
 },
 {
  "klass": "OTHER",
  "title": "Convert-to-Quote lands the secretary in a quote builder that silently reports ₱0 cost and 100% margin",
  "detail": "The CRM Pipeline's 'Convert to Quote' navigates to the BK quote builder. On boot the builder tries to read product_costs to populate each product's capitalMaterials/capitalLabor; that read is wrapped in a try/catch whose only action is a console.warn. firestore.rules:1552 restricts product_costs to isSeniorAdmin() || canFinance() — the 2026-08-09 'SECRETARY LEAK' fix, which is CORRECTLY APPLIED (as are the other two, firestore.rules:2043 and 2158 — all three of those comments describe fixes that are in force, none is still open). So for a secretary the read is denied, costMap stays {}, and the per-product fallback `?? p.capitalMaterials ?? 0` yields 0 for every migrated product. The builder's 🔒 Internal button is visible to any non-partner session, and computeMarginSummary then prints Materials ₱0, COGS = labour-estimate only, and a margin of (near) 100% in green.",
  "evidence": "Denial swallowed: quote-builder-v2.html:1711-1717. Zero fallback: quote-builder-v2.html:1735-1736. Margin math and its render: quote-builder-v2.html:3899-3921. Panel is shown to every non-partner: quote-builder-v2.html:751 (btnInternal), 2034 (setView). Rule: firestore.rules:1544-1552. Entry point: js/screens/crm.js:524-537, 574-577; router js/app.js:2700.",
  "impact": "A confident, wrong number on a money screen the secretary reaches directly from their assigned CRM work. '100% margin' on a converted Won lead is indistinguishable from a genuinely zero-cost product, and could drive a pricing decision. This is exactly the 'silent zeros' failure the Analytics page was already fixed for (js/screens/dashboards.js:4643-4661).",
  "fix": "In quote-builder-v2.html, record the denial (e.g. `costsDenied = true` in the catch at :1715) and, when set, hide or banner the Internal Cost & Margin block instead of rendering zeros — the same treatment as the `_denied` banner pattern at js/screens/dashboards.js:4655-4661. Do not widen firestore.rules:1552.",
  "dimension": "CRM — can the Corporate Secretary actually perform tasks 1 (\"organize the CRM\") and 2 (\"write a proposal for CRM strategy\")?",
  "severity": "medium",
  "corrected": "Accurate, but not secretary-specific: product_costs is denied to EVERY internal principal outside isSeniorAdmin()/canFinance() — a Sales or Marketing employee opening 🔒 Internal sees the identical ₱0 / 100% panel. Fix it as a general 'costs denied' banner in quote-builder-v2.html, not as a secretary carve-out.",
  "verified": true
 },
 {
  "klass": "OTHER",
  "title": "No CRM follow-up notification reaches the secretary; the AEC notifier still points at the old Sales location and there is no ROC notifier at all",
  "detail": "checkAECFollowups returns early unless the role is president/manager or the user is in the Sales department — 'secretary' is in neither set, and the CRM department is not consulted. So the person who owns the CRM this week gets no overdue-lead alert. Two further staleness bugs in the same function: the notification body says 'Open Sales → AEC' and the deep link is 'dept:Sales', but the AEC directory MOVED into the CRM department on 2026-08-04 (js/screens/crm.js:5-8, js/config.js:228-229) — the link now lands on a screen that no longer has an AEC tab. And the ROC directory, which has its own nextFollowUp field, its own overdue predicate and its own in-screen due banner, has no notifier of any kind.",
  "evidence": "notifications.js:1239-1241 (role/dept gate), 1253-1254 (stale body text and stale link 'dept:Sales'). Move evidence: js/screens/crm.js:5-8, js/config.js:228-229 ('AEC moved out to the CRM department'). ROC due logic with no notifier: js/screens/crm.js:255-256, 273; ROC nextFollowUp write at js/screens/crm.js:366. Grep confirms notifications.js:1243 is the only reference to aec_contacts outside crm.js/sales.js/migrations.js, and roc_leads has none.",
  "impact": "Follow-ups silently lapse. The secretary only learns a lead is overdue by manually opening CRM › Dashboard; nothing pushes it. Anyone who does get the AEC alert is deep-linked to a department that no longer contains the directory.",
  "fix": "In js/notifications.js:1240-1241, widen the gate to include the CRM department and the oversight tier — e.g. `const isCrm = (window.currentDepts||[]).includes('CRM') || (window.currentDepts||[]).includes('Sales'); if (!window.isAdminPriv?.() && !isCrm) return;`. Change the link at :1254 to 'dept:CRM' and the body to 'Open CRM → AEC Leads'. Add a sibling ROC check over roc_leads.nextFollowUp using window.ROC_TERMINAL.",
  "dimension": "CRM — can the Corporate Secretary actually perform tasks 1 (\"organize the CRM\") and 2 (\"write a proposal for CRM strategy\")?",
  "severity": "medium",
  "corrected": "",
  "verified": true
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "Tasks page hides 'All Tasks' and the department 'New Task' button from the secretary, though the rules permit both",
  "detail": "js/screens/tasks.js computes `isAdmin` as a hardcoded literal `currentRole==='president'||'owner'||'manager'||'finance'` in five places — 'secretary' is absent from every one. Consequences: the 'All Tasks' filter option is not rendered (tasks.js:300), and the department-embedded task list's '+ New Task' button is hidden (tasks.js:225, 229, 250). Meanwhile firestore.rules:793 permits any non-partner to read every task, firestore.rules:796-798 permits create to isAdmin() (which includes secretary), and firestore.rules:815-817 permits update to isOpsAdmin() (which also includes secretary — the rule comment at 803-807 explicitly calls this clause load-bearing FOR this role). This is the same class of bug js/departments.js:60-69 was written to prevent, and the top-level '+ New Task' button at tasks.js:304 already (correctly) works for them, so the surface is internally inconsistent.",
  "evidence": "UI: js/screens/tasks.js:225, 265, 300, 414, 647, 1022 (the isAdmin/canAdd/isPriv literals). Rules: firestore.rules:793 (read), 796-798 (create = isAdmin()), 815-817 (update = isOpsAdmin()), 803-807 (the comment naming the secretary as the reason this clause exists). DISAGREE.",
  "impact": "An oversight role cannot see the company-wide task list, and cannot create a task from inside a department screen — including the CRM-adjacent Sales and Marketing task tabs — even though the boundary would accept both. Cross-department task oversight is the stated point of the role.",
  "fix": "Replace the literals in js/screens/tasks.js with the existing mirrors: `window.isOpsPriv()` (js/departments.js:56-58) for the view/edit gates at :265, :414, :647, :1022, and `window.isAdminPriv()` (js/departments.js:66-70) for the create gate at :225. Both helpers already exist precisely so these literals do not have to be maintained by hand.",
  "dimension": "CRM — can the Corporate Secretary actually perform tasks 1 (\"organize the CRM\") and 2 (\"write a proposal for CRM strategy\")?",
  "severity": "medium",
  "corrected": "The defect is: (1) the 'All Tasks' company-wide filter is hidden (js/screens/tasks.js:265, :300, :414), and (2) task edit/status/reassign controls are hidden in openTaskDetail (:647) and openEditTaskModal (:1022) despite firestore.rules:816-817 permitting the update via isOpsAdmin(). The department-embedded '+ New Task' button is NOT affected — it routes through canEditDept() and already works. Fix (2) with window.isOpsPriv() (js/departments.js:56-58); the mirror comment at js/screens/tasks.js:643-646 still names the pre-2026-08-09 helper and has drifted from the live rule.",
  "verified": true
 },
 {
  "klass": "SILENT_EMPTY",
  "title": "CRM Dashboard and Pipeline turn any denied or failed read into a confident all-zero funnel",
  "detail": "crmFetchAll wraps both collection reads in `.catch(() => ({ docs: [] }))`, then hands the result to withLoadingAndError as a SUCCESS. Because the catch converts the rejection into a resolved value, withLoadingAndError's error branch (js/ui-states.js:94-108) can never fire on this path, and there is no emptyCheck configured. The Dashboard therefore renders '0' in every KPI tile, a funnel table of all zeros, and the green '✅ No follow-ups due' empty state; the Pipeline renders 'Nothing in Quotation right now' and 'No Won leads yet'. A denial, an offline failure and a genuinely empty CRM are pixel-identical. The in-file comment at crm.js:128-130 states this was a deliberate hard rule of that pass — but the two sibling directory renderers do the opposite and surface the error with a Retry (js/screens/crm.js:242-247, js/screens/sales.js:1383-1389), so the same screen disagrees with itself tab to tab.",
  "evidence": "js/screens/crm.js:131-140 (the two swallowing catches), 146 and 540 (both callers pass crmFetchAll as the fetcher), 168-171 (KPI tiles), 201 ('No follow-ups due'), 549 (Pipeline empty states). Contrast: js/screens/crm.js:242-247 and js/screens/sales.js:1383-1389. withLoadingAndError: js/ui-states.js:79, 94-108.",
  "impact": "On today's rules the secretary's read IS permitted (firestore.rules:1793, 1805), so this does not fire for them right now — it is latent, not live. But it fires for anyone whose read is ever narrowed, and it fires today on any transient network failure, and it does so on the exact screen the owner is onboarding the secretary onto: a CRM that has silently failed to load is indistinguishable from a CRM with no leads in it.",
  "fix": "Drop the two `.catch(() => ({docs:[]}))` in js/screens/crm.js:133-134 and let withLoadingAndError's error+Retry branch do its job — that wrapper exists for this, and it is what the AEC/ROC directory tabs in the same feature already do. If partial degradation is genuinely wanted, record which read failed and render an explicit banner naming it, as js/screens/dashboards.js:4655-4661 does for Analytics.",
  "dimension": "CRM — can the Corporate Secretary actually perform tasks 1 (\"organize the CRM\") and 2 (\"write a proposal for CRM strategy\")?",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "BLOCKED_WORK",
  "title": "'Organize the CRM' has no bulk, merge, re-categorise or import path — only one-row-at-a-time editing",
  "detail": "Restructuring operations the task implies are simply not built, for any role: there is no merge-duplicates action, no multi-select, no bulk edit, no bulk status change, no owner/assignee field on either lead schema, and no tagging. Import exists but is President-only and console/seed-file driven: window.importCrmSeed opens with `if (!isPresident()) { Notifs.showToast('President only','error'); return; }` and reads a fixed file from /specs. Re-categorising is also impossible without a deploy: the AEC type vocabulary is a hardcoded three-entry array (architect/engineer/contractor) — the importer's own comment flags that 'Consultant' firms have nowhere to go and are silently filed as 'contractor' — and the ROC status ladder is likewise a hardcoded array. Finally, global search does not index either collection, so the secretary cannot even FIND cross-directory duplicates by name: its six sources are tasks, quotes, clients, inventory, products and hub_files.",
  "evidence": "Import gate: js/migrations.js:512-514. Hardcoded vocabularies: js/screens/sales.js:1311-1316 (AEC_TYPES), 1318-1325 (AEC_STAGES); js/screens/crm.js:213-221 (ROC_STATUSES). Consultant fallback flagged: js/migrations.js:493-496, 508. Global search sources: js/screens/people.js:2504-2518 (no aec_contacts, no roc_leads). No merge/bulk code exists anywhere in js/screens/crm.js (579 lines, read in full) or in renderAECDirectory (js/screens/sales.js:1376-1650).",
  "impact": "Organizing a ~330-row imported directory becomes ~330 individual modal edits, with no way to find duplicates except eyeballing the table, no way to delete the ones found (see the first defect), and no way to introduce a category the data actually needs. The task as assigned cannot be completed at a reasonable cost.",
  "fix": "Smallest useful increment, in priority order: (1) unblock delete (first defect); (2) add aec_contacts and roc_leads to the global-search sources at js/screens/people.js:2504-2518 so duplicates are findable — both reads are already permitted by firestore.rules:1793/1805 and need no rules change; (3) move AEC_TYPES / ROC_STATUSES into a Firestore-backed config so re-categorising is a write rather than a deploy. A merge action is a larger piece of work and should be specced separately.",
  "dimension": "CRM — can the Corporate Secretary actually perform tasks 1 (\"organize the CRM\") and 2 (\"write a proposal for CRM strategy\")?",
  "severity": "low",
  "corrected": "Real as a capability gap, but it is role-NEUTRAL missing functionality, not a secretary gate — a president or Sales manager faces exactly the same one-row-at-a-time workflow. The only secretary-specific blocker inside this cluster is the delete gate (finding 1). Severity is low on its own; the useful piece is adding aec_contacts/roc_leads to the search sources at js/screens/people.js:2504-2513, which firestore.rules:1793/1805 already permit.",
  "verified": true
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "The secretary can post to the CRM department but cannot read that tab back",
  "detail": "openNewPostModal's department dropdown is built from Object.keys(DEPARTMENTS), so 'CRM' is selectable by anyone. The Posts feed's own tab list, however, is General + currentDepts (the signed-in user's assigned departments) + a Pending tab for approvers only. The secretary's company-wide reach comes from their ROLE, not from currentDepts, so unless their profile happens to list CRM they can file a post into the CRM feed and then have no tab in which to see it.",
  "evidence": "Dropdown: js/screens/people.js:461-466 (Object.keys(window.DEPARTMENTS)). Tab list: js/screens/people.js:93-96 (`...currentDepts.map(...)`, Pending only when canApprove). Role-vs-dept asymmetry: js/departments.js:29-35 (canEditDept returns true for secretary irrespective of currentDepts) and firestore.rules:122 (canDept(d) = isAdmin() || inDept(d)). Rule permits the read: firestore.rules:517-518.",
  "impact": "Write-only department feeds. The secretary's CRM-strategy post disappears from their own view the moment it is filed, and the same applies to every department they oversee but are not enrolled in.",
  "fix": "For the oversight roles, build the tab list from the departments they can actually reach rather than from currentDepts — e.g. at js/screens/people.js:93-96, when `window.isAdminPriv()` is true use `Object.keys(DEPARTMENTS).filter(d => !(currentRole==='secretary' && SECRETARY_BLOCKED_DEPTS.includes(d)))`. The read rule already allows it.",
  "dimension": "CRM — can the Corporate Secretary actually perform tasks 1 (\"organize the CRM\") and 2 (\"write a proposal for CRM strategy\")?",
  "severity": "low",
  "corrected": "Real but not secretary-specific and lower-impact than stated: ANY user can file a post into a department they are not enrolled in and then have no tab for it. Also, the post is created with status 'pending' (js/screens/people.js:476) and needs the president to publish it regardless, so 'disappears the moment it is filed' overstates it — the tracking gap is the missing Pending tab, which is the same gap as in finding 2.",
  "verified": true
 },
 {
  "klass": "BLOCKED_WORK",
  "title": "The secretary cannot upload a file to a venture brief — storage.rules' isAdminClaim() excludes them, and the failure is near-silent plus the venture then saves with the attachment missing",
  "detail": "Two rule files disagree about who is an admin. firestore.rules:20 isAdmin() = president|manager|secretary, so canDept('Ventures') is true for the secretary with no department assignment. storage.rules:98-100 isAdminClaim() = president|manager ONLY — 'secretary' is absent. The Ventures attachment block (storage.rules:284-288) gates read AND write on isMemberOf('Ventures') = isAdminClaim() || hasClaimDept('Ventures') (storage.rules:120-122). So a secretary who is not assigned the Ventures department fails BOTH legs and ref.put() is refused with storage/unauthorized. This is uniquely the secretary: president and manager pass isAdminClaim(), and genuine Ventures-dept staff pass hasClaimDept. The editor renders the upload dropzone unconditionally — js/screens/ventures.js:647-652 calls Drive.renderUploadArea with no capability check at all, not even the canEditDept test used on the Edit and Add buttons. Three compounding problems on failure: (a) js/drive.js:362-371 catches the error and writes the RAW Firebase message into a progress bar that auto-hides after 3 seconds — it does not call uploadErrorMessage() (js/drive.js:194-220, which exists precisely to translate storage/unauthorized) and raises no toast; (b) because onUpload never fires, the draft's fileUrl stays null (js/screens/ventures.js:648-651); (c) the subsequent Save then succeeds and writes fileUrl:null (js/screens/ventures.js:793) with a green 'Venture saved' toast (js/screens/ventures.js:811). The secretary is told the venture saved. It did — without their document. Two stale comments are why this was missed: firestore.rules:1839-1842 and js/screens/ventures.js:644-646 both still assert \"'Ventures' is not one of its isReservedTop() segments, so storage.rules needed no change\" — but storage.rules:134 DOES reserve 'Ventures' and storage.rules:284 is the dedicated block that replaced the generic one. Anyone reasoning from those comments concludes, wrongly, that the generic internal-staff rule covers this.",
  "evidence": "UI gate: js/screens/ventures.js:647-652 (unconditional Drive.renderUploadArea, dept:'Ventures', subfolder:'Briefs'); js/drive.js:21 (path = `${department}/${subfolder}/…` = Ventures/Briefs/…); js/drive.js:362-371 (raw err.message, 3s auto-hide, no toast, uploadErrorMessage not called); js/screens/ventures.js:793 + :811 (saves fileUrl:null, reports success). Rule: storage.rules:284-288 (isMemberOf('Ventures')); storage.rules:120-122 (isMemberOf); storage.rules:98-100 (isAdminClaim EXCLUDES secretary). Contrasting rule: firestore.rules:20 (isAdmin INCLUDES secretary); firestore.rules:1915-1924. Stale comments: firestore.rules:1839-1842; js/screens/ventures.js:644-646; contradicted by storage.rules:129-134.",
  "impact": "Task 3 ('Review Ventures') and task 2 ('Write a proposal for CRM strategy', if it is ever attached to a brief) are partly blocked: the secretary can write prose but cannot attach the supporting document a review normally produces. Worse than a hard block, they get a 3-second raw error and then a success message, so they will believe the file is attached and only discover otherwise later — or never.",
  "fix": "Two independent fixes, both wanted. (1) ONBOARDING, immediate and zero-code: the President assigns the secretary the Ventures department in People & Roles. syncUserClaims (functions/index.js:625-670) stamps {role, departments} into the Auth claim and bumps claimsUpdatedAt to force a live token refresh, so hasClaimDept('Ventures') becomes true without re-login. The users UPDATE rule permits a President to make this edit (firestore.rules:457-458), and the noPrivilegedDeptOnCreate freeze (firestore.rules:295-309) is create-only so it does not obstruct this. Note this is the ONLY thing on this screen that assignment changes — read/create/edit/delete already come free from isAdmin(). (2) CODE: either add 'secretary' to storage.rules' isAdminClaim() — but ONLY if every other isAdminClaim() site is re-audited first, since it is also the gate on attendance-selfie overwrite (storage.rules:167) and generic dept update/delete via isOwnerOrAdmin — or, safer and narrower, change storage.rules:285-286 to `isMemberOf('Ventures') || claimRole() == 'secretary'`. Separately, and regardless: gate the upload dropzone at js/screens/ventures.js:647 so a control that cannot work is not shown, and route js/drive.js:365 through uploadErrorMessage() with a persistent toast instead of a 3-second bar.",
  "dimension": "Ventures — can the Corporate Secretary complete task 3, \"review Ventures\"?",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "OTHER",
  "title": "The secretary can permanently delete a whole venture brief with no approval and no recovery, while the owner's stated governance is that deletes route to the President",
  "detail": "firestore.rules:1928 grants delete on `isAdmin()`, which includes 'secretary' (firestore.rules:20), and the client's canDelete list at js/screens/ventures.js:419 names 'secretary' explicitly — so UI and rules agree, this is deliberate, not a drift. The rule's own comment (firestore.rules:1925-1927) justifies it as 'low-stakes, no delete-request flow, because nothing here is a financial record'. That reasoning is sound about MONEY and wrong about VALUE: a venture doc is the sole store of a long-form executive summary plus every user-authored section, the one artefact the owner wrote by hand and the exact thing the secretary was hired to review. Deletion is a single confirmDialog away (js/screens/ventures.js:486-492), is a hard Firestore delete (js/screens/ventures.js:494), and there is no soft-delete flag, no archive (the 'archived' STATUS is unrelated — it is a display badge, js/screens/ventures.js:119), and no restore path. The only trace left is the audit_log entry (js/screens/ventures.js:495) — which the secretary can create but, per defect 4, cannot read. Compare finance, where deletes are funnelled through finance_delete_requests for President approval. I am flagging this as a decision for the owner rather than asserting a rule bug: the ruling supplied to me is 'delete-approvals are President-only', which governs who APPROVES, not whether ventures need approval at all.",
  "evidence": "firestore.rules:1925-1928 (allow delete: isAdmin(); rationale comment); firestore.rules:20 (isAdmin includes secretary); js/screens/ventures.js:419 (canDelete includes 'secretary'); js/screens/ventures.js:486-501 (confirm → hard delete → reload); js/screens/ventures.js:495 (audit entry is the only residue); js/screens/ventures.js:119 ('archived' is a status badge, not a soft-delete).",
  "impact": "One mis-tap by the person newly onboarded to this screen destroys an executive summary and every section of a venture brief permanently. There is no undo and no restore, and the deleter cannot even read the audit entry proving it happened.",
  "fix": "If the owner wants Ventures on the same footing as finance: narrow firestore.rules:1928 to isSeniorAdmin() (president/manager) or isPresident(), and drop 'secretary' from js/screens/ventures.js:419 so the trash button disappears rather than failing. If direct delete is intended, the cheap mitigation is a soft delete — an `archivedAt` field filtered out of fetchVentures (js/screens/ventures.js:277) — leaving the record recoverable.",
  "dimension": "Ventures — can the Corporate Secretary complete task 3, \"review Ventures\"?",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "BLOCKED_WORK",
  "title": "There is no way to leave a review comment on a venture — the reviewer's only options are to overwrite the author's prose or to talk about it in chat",
  "detail": "'Review Ventures' is the task, but the Ventures data model has no reviewer surface. A venture is a single flat document; there is no comments subcollection, no notes collection, no reviewer/reviewedAt field. The only thing called a 'note' is `sections[].note`, an inline side-note INPUT inside the author's own editor (js/screens/ventures.js:577-578, rendered at :513) — it is a field of the prose, not a separate annotation layer, and writing one means opening the editor and re-saving the whole doc, which stamps updatedBy with the reviewer's email (js/screens/ventures.js:795) and makes them look like the author of the brief. Adding a subcollection would not silently work either: firestore.rules:1834-1837 states plainly that rules do not cascade and ventures/{id} covers that path only, so any comments subcollection needs its own match block before it would be readable at all. Two secondary gaps compound this: (a) global search does not index ventures — renderGlobalSearch loads exactly six sources (tasks, quotes, clients, inventory, products, hub_files) and `ventures` is not among them (js/screens/people.js:2504-2520), so a brief cannot be found by keyword, only by scrolling the Portfolio grid or knowing its chip; (b) there is no change history in the UI — a brief shows only 'Updated <date> · <email>' (js/screens/ventures.js:427-429), a single last-writer stamp, so a reviewer cannot see what changed between visits.",
  "evidence": "js/screens/ventures.js:66-82 (full doc shape — no comment/review field); js/screens/ventures.js:577-578 + :513 (sections[].note is an author field inside the editor); js/screens/ventures.js:789-796 (save payload; :795 stamps updatedBy with the editor's email); firestore.rules:1834-1837 (rules do not cascade; no subcollection block exists); js/screens/people.js:2504-2520 (global search sources — `ventures` absent); js/screens/ventures.js:427-429 (single last-updated stamp, no history).",
  "impact": "The secretary can read a venture and can rewrite it, but cannot annotate it as a reviewer. Every observation they record either overwrites the owner's words and re-attributes the brief to themselves, or leaves the system entirely (chat, or a document elsewhere). The review has no home in the record it reviews.",
  "fix": "Smallest workable change: add a top-level `venture_notes` collection keyed by {ventureId, authorUid, body, createdAt} with its own firestore.rules match block reading canDept('Ventures') — NOT a subcollection, so no cascade surprise — and a simple notes list appended below the sections in drawVentureBrief (js/screens/ventures.js:476). Cheaper interim, requiring no code: tell the secretary during onboarding that venture review discussion belongs in the # Ventures chat channel, which they already have (js/chat.js:360-386). Add `ventures` to the global-search source list at js/screens/people.js:2504-2520 either way — matching on name/tagline/summary is a two-line change.",
  "dimension": "Ventures — can the Corporate Secretary complete task 3, \"review Ventures\"?",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "The rules let the secretary read audit_log, but all three UI paths to it are president-only — so venture change history is permitted and unreachable",
  "detail": "This is the mirror-image dead control: capability granted at the boundary, hidden by the UI. firestore.rules:2512-2513 allows audit_log read on `isAdmin() || own actorUid`, and isAdmin() includes 'secretary' (firestore.rules:20) — so the secretary is authorised to read the entire company audit trail, including the create/update/delete entries the Ventures screen writes (js/screens/ventures.js:495, :801, :807). But the nav entry is gated `when:'isPresident'` (js/config.js:561), the router case denies non-presidents inline (js/app.js:2722), and the renderer bails on its first line (js/screens/dashboards.js:231-232). Three independent president-only gates over a rule that says isAdmin(). I flag this as a defect to REPORT rather than an obvious fix, because the two readings point opposite ways: either the rule is too wide for a role the owner scoped down, or the UI is too narrow for an oversight role whose job is precisely to see who changed what. The owner has to pick. It bears directly on this dimension: the audit log is the only record of who edited or deleted a venture (defect 2), so under the current setup the secretary can destroy a brief and cannot look up the evidence.",
  "evidence": "Rule: firestore.rules:2512-2513 (allow read: isAdmin() || own actorUid); firestore.rules:20 (isAdmin includes secretary). UI gates: js/config.js:561 (sidebar entry when:'isPresident'); js/app.js:2722 (router: isPresident() ? renderAuditLog() : Access Denied); js/screens/dashboards.js:231-232 (renderAuditLog returns immediately if !isPresident()). Writers: js/screens/ventures.js:495, :801, :807.",
  "impact": "Either an oversight role cannot see the change history it exists to oversee (if the UI is wrong), or the rules grant a scoped-down role a company-wide audit read the owner never decided on (if the rules are wrong). Concretely for Ventures: no one but the President can answer 'who deleted that brief'.",
  "fix": "Owner decision, then make the two layers agree. If the secretary should see it: change js/config.js:561 to a new 'isAdminRole' predicate and relax js/app.js:2722 + js/screens/dashboards.js:232 to isAdminPriv() (js/departments.js:68-70, the existing client mirror of isAdmin()). If not: narrow firestore.rules:2513 from isAdmin() to isSeniorAdmin(), matching the pattern already used at firestore.rules:1552 to close the product_costs leak.",
  "dimension": "Ventures — can the Corporate Secretary complete task 3, \"review Ventures\"?",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "OTHER",
  "title": "Ventures is an ungoverned prose channel — nothing stops finance figures being typed into a section body, and nothing would flag it",
  "detail": "Not a rule bug; an operational note the owner should hear before onboarding. The venture schema is money-free by explicit design and I verified that (see the last capability entry: the entire save payload at js/screens/ventures.js:789-796 is enumerable and contains no numeric business field; the only numbers are `order`, a sort index, and a colour string). But `summary` and `sections[].body` are unbounded free text with no validation in the rules (firestore.rules:1921-1924 checks only that name is non-empty and status is in the enum) and no length cap. If anyone writes revenue projections, capital requirements or margin figures into a venture's 'Goals & milestones' section — a natural thing to do in a venture brief, and the seeded outline at js/screens/ventures.js:135-139 invites exactly that — the Corporate Secretary reads them, because the Ventures read rule is role-based and cannot see what the prose says. The dev fixture already gestures at this: its sample summary reads 'before capital is committed' (dev/_ventures_preview.html:48). The Finance carve-out is enforced on collections, not on content, so it cannot cover this and no code change would.",
  "evidence": "js/screens/ventures.js:789-796 (complete payload — no money field, confirmed by enumeration); firestore.rules:1921-1924 (update rule validates name + status only; no field allowlist, no size bound — contrast firestore.rules:2514-2520, where audit_log DID get size bounds); js/screens/ventures.js:135-139 (seeded 'Goals & milestones' outline); js/screens/ventures.js:9-11 (the design intent this depends on); dev/_ventures_preview.html:48.",
  "impact": "The Finance/IT carve-out is a collection boundary. Ventures is a legitimate collection on the secretary's side of it whose content is entirely at the author's discretion, so it is the one place where finance-shaped information can reach them without any rule being violated. Nothing detects it and nothing warns the author.",
  "fix": "No code fix is appropriate — a content filter on prose would be both unreliable and wrong. Handle it as policy: tell the owner that anything written into a venture brief is visible to the Corporate Secretary, and keep figures in Finance as the file header already instructs (js/screens/ventures.js:9-11). Optionally add a one-line hint to the editor banner at js/screens/ventures.js:589-593, next to the existing 'Documentation only' text, naming who can read a brief.",
  "dimension": "Ventures — can the Corporate Secretary complete task 3, \"review Ventures\"?",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "LEAK",
  "title": "Analytics → Strategy → Market Research Notes exposes a Finance chip, and the rule grants the read",
  "detail": "The Analytics screen admits the secretary by name. Its Strategy subtab renders a chip row built from a hardcoded STRAT_DEPTS list that includes {id:'finance',label:'Finance'}, then reads the whole strategy_notes collection and renders whichever dept's entries are selected. The rule is `allow read: if isAuth() && isOpsAdmin()`, and isOpsAdmin() is the four-role helper that DOES list 'secretary'. Nothing on this path consults SECRETARY_BLOCKED_DEPTS or deptOpenToSecretary — those live only in renderDeptModule, renderDepartments and chat. So Finance's market-research and conclusions notes are two clicks from a first-class sidebar entry, and the boundary permits it rather than merely failing to hide it.",
  "evidence": "js/screens/dashboards.js:5293-5296 (STRAT_DEPTS incl. finance at :5295), :5318 (unfiltered strategy_notes read), :5338-5343 (renderNotesFor), :4856 (Strategy subtab), :4640 (screen gate names secretary); firestore.rules:1084-1089 (read isOpsAdmin()); firestore.rules:69 (isOpsAdmin includes secretary)",
  "impact": "A role the owner twice ruled out of Finance can read Finance's strategy notes — free-text commentary that is exactly the kind of thing a Finance chip would hold. Unlike the ledger/payroll reads on the same screen, this one is not denied, so there is no banner and no zero: it renders real content.",
  "fix": "Filter STRAT_DEPTS at render time the way renderDepartments already does (`const blocked = currentRole==='secretary' ? SECRETARY_BLOCKED_DEPTS : []`), AND add the rule-side half so a hand-set window._AN_STRAT_DEPT cannot get round it: a dedicated strategyDeptOpen(deptKey) predicate, since these ids are lowercase ('finance', not 'Finance').",
  "dimension": "Navigation and reachability — the Corporate Secretary's portal surface: which sidebar/bottom-nav variant they resolve to, every entry they see, every page the router admits them to, and the two-way mismatches between what nav offers and what the rules actually permit.",
  "severity": "blocker",
  "corrected": "",
  "verified": true
 },
 {
  "klass": "LEAK",
  "title": "Sidebar \"Files\" lands on a scope picker that offers two Finance scopes by name",
  "detail": "NAV_REGISTRY.sidebar.admin entry #14 routes to 'files-hub' → renderFilesHub. Its SEED_SCOPES array hardcodes {key:'sss',label:'SSS & Gov Docs',dept:'Finance'} and {key:'accounting',label:'Accounting',dept:'Finance'} and renders one chip per scope with no role filter at all. Selecting either calls bindFileCollection, which queries hub_files where scope=='accounting'. The rule's first disjunct is a bare `isAdmin()` — which lists 'secretary' — so the read is granted outright, and the third disjunct (`!isPartner() && visibility=='company'`) would grant it anyway. SECRETARY_BLOCKED_DEPTS never reaches this file.",
  "evidence": "js/config.js:556 (Files → files-hub); js/screens/people.js:2570-2607 (renderFilesHub; SEED_SCOPES at :2581-2593, Finance scopes at :2587-2588; chips at :2595-2598), :2632-2634 (bindFileCollection); js/departments.js:4208-4218 (collection = 'hub_files', scoped by key); firestore.rules:2861-2867 (read: isAdmin() || … || visibility=='company')",
  "impact": "Accounting documents and SSS/government filings — Finance-department material by the app's own labelling — are one sidebar click plus one chip click away, with the file bodies openable via openFilePreview and downloadable via the token-bearing Storage url. This is the widest Finance path still open to the role.",
  "fix": "Filter SEED_SCOPES in renderFilesHub by SECRETARY_BLOCKED_DEPTS using each entry's existing `dept` field, and close the rules half by narrowing hub_files' isAdmin() disjunct to isSeniorAdmin() — mirroring how product_costs was already narrowed from isAdmin() to isSeniorAdmin() (firestore.rules:1545-1553).",
  "dimension": "Navigation and reachability — the Corporate Secretary's portal surface: which sidebar/bottom-nav variant they resolve to, every entry they see, every page the router admits them to, and the two-way mismatches between what nav offers and what the rules actually permit.",
  "severity": "blocker",
  "corrected": "Real, but two details are overstated. (1) In practice the secretary does NOT get the broad admin query: js/drive.js:493's own isAdminRole is ['president','manager','owner'], so their scope load takes the 3-query fan-out and returns only company-visibility + own + shared-with-me files. Private/unshared Accounting files are permitted by firestore.rules:2863 but never actually requested by the shipped client. (2) The company-visibility half is not secretary-specific — renderFilesHub shows the same Finance-labelled chips to every non-partner account (js/screens/people.js:2595-2598 has no role filter at all). The secretary-specific defect is the rules-side isAdmin() disjunct at firestore.rules:2863; the UI-side defect is the unfiltered Finance chips for everyone.",
  "verified": true
 },
 {
  "klass": "LEAK",
  "title": "Analytics presents a subtab literally labelled \"Finance\" to a role barred from Finance",
  "detail": "SUBTABS is unconditional — no role filter — so the secretary's Analytics chip row shows Overview | Sales | Marketing | Finance | Production | Gov. Biddings | Strategy. renderFinanceAnalytics then renders Total Payroll, Net Income, Payroll % of Revenue, expense breakdowns, cash-advance totals and inventory turns. Some of those inputs (ledger, payslips, payroll) are genuinely denied and the _denied banner covers them; but cash_advances IS readable by the secretary by explicit rule, and inventory_items is readable by everyone internal, so the tab is a MIX of honest zeros and real figures under Finance headings.",
  "evidence": "js/screens/dashboards.js:4849-4857 (SUBTABS, Finance at :4853), :5104-5154 (renderFinanceAnalytics), :5105 (loadFinanceExtras reads cash_advances + payslips), :5144-5148 (inventory turns); firestore.rules:753-757 (cash_advances read includes isSecretary())",
  "impact": "The nav itself contradicts the owner ruling: the role is told \"no Finance\" everywhere else (grid filtered, dept: blocked, # Finance channel gone) and then handed a Finance tab. Worse, the mixture means a reader cannot tell which numbers on that tab are real and which are artefacts of denial, even with the banner.",
  "fix": "Drop the 'finance' entry from SUBTABS when currentRole==='secretary' (same one-line pattern as renderDepartments:4573), and leave the read-only cash-advance oversight where the owner ruling already implements it — the Approvals screen.",
  "dimension": "Navigation and reachability — the Corporate Secretary's portal surface: which sidebar/bottom-nav variant they resolve to, every entry they see, every page the router admits them to, and the two-way mismatches between what nav offers and what the rules actually permit.",
  "severity": "medium",
  "corrected": "Not a leak — a nav/presentation contradiction. Every genuinely-Finance input is denied and named in the banner: cg() at js/screens/dashboards.js:4669 catches permission-denied and pushes into _denied (js/screens/dashboards.js:4654-4661), rendered as the '🔒 Some figures are not shown to you' banner at js/screens/dashboards.js:4861. The two figures that do render for real — CA Outstanding/Pending and Inventory Turns — are ones the owner explicitly preserved (firestore.rules:745-755) or that are internal-wide. So the defect is (a) a tab labelled 'Finance' is offered to a role told 'no Finance' everywhere else, and (b) permitted real figures sit beside denial-zeros under Finance headings, which the banner does not disambiguate per-tile.",
  "verified": true
 },
 {
  "klass": "BLOCKED_WORK",
  "title": "Task 1 \"Organize the CRM\": the secretary cannot delete a lead in either directory, and there is no request flow",
  "detail": "Both CRM directories hardcode canDeleteDirect = ['president','owner','manager'] — 'secretary' is absent, so no delete button is ever rendered on an AEC or ROC row. The rules are the opposite: aec_contacts and roc_leads both `allow delete: if isAuth() && isAdmin()`, and isAdmin() lists 'secretary'. Both rule blocks also state in their own comments that there is deliberately NO delete-request flow for these collections (unlike finance/payroll, which route through financeDelete → President). So the capability exists at the boundary, is hidden by the UI, and has no escalation substitute.",
  "evidence": "js/screens/crm.js:252 (canDeleteDirect, ROC), js/screens/sales.js:1398 (canDeleteDirect, AEC); js/screens/crm.js:307 (delete button gated on it); firestore.rules:1795 (aec_contacts delete isAdmin()), :1807 (roc_leads delete isAdmin()), :1790-1791 and :1802-1803 (\"no delete-request flow\"); firestore.rules:21 (isAdmin includes secretary); js/departments.js:709-745 (financeDelete — the request flow that does NOT cover these collections)",
  "impact": "\"Organize the CRM\" means dedupe, prune and merge. The secretary can add and edit leads but cannot remove a duplicate or a dead record, and has no \"request President approval\" button to fall back on — the work stalls with no visible reason, because the control simply is not on screen.",
  "fix": "Add 'secretary' to both canDeleteDirect lists — the rules already permit it and these are explicitly low-stakes, non-financial lists. One-word change in each of two files.",
  "dimension": "Navigation and reachability — the Corporate Secretary's portal surface: which sidebar/bottom-nav variant they resolve to, every entry they see, every page the router admits them to, and the two-way mismatches between what nav offers and what the rules actually permit.",
  "severity": "high",
  "corrected": "Substance correct; two rule citations are off by one. aec_contacts delete is firestore.rules:1794 (match at 1791), roc_leads delete is firestore.rules:1806 (match at 1803). Severity is high rather than blocker: the secretary can still add, edit and re-status leads, so 'Organize the CRM' is degraded (no prune/dedupe removal, no escalation path) rather than fully blocked.",
  "verified": true
 },
 {
  "klass": "BLOCKED_WORK",
  "title": "Task 2 \"Write a proposal for CRM strategy\": no CRM strategy surface exists, and the one strategy-notes writer excludes the secretary",
  "detail": "Two independent blocks. (a) STRAT_DEPTS — the only strategy-notes surface in the app — lists general/sales/marketing/production/finance/gov. There is no 'crm' entry and no 'ventures' entry, so CRM strategy has nowhere to live even for the President. (b) On that same screen canWrite = ['president','manager','finance'], which excludes 'secretary', so the note composer is not rendered for them — while the rule is `allow write: if isAuth() && isOpsAdmin() && entries is list`, and isOpsAdmin() DOES list 'secretary'. The CRM department's own screen has no notes/strategy/proposal tab at all (its four tabs are Dashboard, AEC Leads, ROC Leads, Pipeline; the sopPanel is static hardcoded copy).",
  "evidence": "js/screens/dashboards.js:5293-5296 (STRAT_DEPTS — no crm, no ventures), :5322 (canWrite excludes secretary), :5345-5349 (composer gated on canWrite), :5366-5386 (the write); firestore.rules:1085-1087 (write isOpsAdmin()); js/screens/crm.js:41 (crmTabs), :50-55 (static sopPanel)",
  "impact": "The secretary is assigned to write a CRM strategy proposal and the system offers them no writable strategy surface for CRM at all — and denies them the general one, which they are permitted to write. Their only workarounds are Marketing → Proposals (a different department's collection, marketing_proposals) or dropping a file in the Files Hub.",
  "fix": "Add 'secretary' to canWrite (it matches isOpsAdmin(), the actual boundary), and add {id:'crm',label:'CRM'} and {id:'ventures',label:'Ventures'} to STRAT_DEPTS — strategy_notes is keyed by free-form deptKey, so no rules or index change is needed.",
  "dimension": "Navigation and reachability — the Corporate Secretary's portal surface: which sidebar/bottom-nav variant they resolve to, every entry they see, every page the router admits them to, and the two-way mismatches between what nav offers and what the rules actually permit.",
  "severity": "high",
  "corrected": "",
  "verified": true
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "Memos: two entry points, two different capability answers, and no nav entry at all",
  "detail": "memos create/delete are `isAdmin()`, which includes the secretary. renderMemosPage passes canAdd = isPresident() || manager || secretary — correct. But the Company screen's Memos tab passes canAdd = isPresident() || currentRole==='manager' — the secretary is dropped, with a trailing comment claiming managers-are-admins parity that is out of date. Company IS a sidebar entry (#6); 'memos' is NOT in NAV_REGISTRY at all, reachable only from the Secretary dashboard's \"Memos & Resolutions\" quick action and from notification deep-links.",
  "evidence": "js/screens/dashboards.js:3757 (Company→Memos canAdd, secretary omitted) vs :4373 (renderMemosPage canAdd, secretary present); js/config.js:544-563 (no 'memos' entry in sidebar.admin) and :622-630 (none in bottom.admin); js/screens/dashboards.js:1722 (the only nav to it); firestore.rules:1570-1573 (create/delete isAdmin())",
  "impact": "Corporate memos and board resolutions are the Corporate Secretary's defining artefact. Whether they can create one depends on which of two doors they walked through — and the door that WORKS has no nav entry, so it is reachable only from one button on one dashboard. Anyone navigating via the sidebar concludes the capability does not exist.",
  "fix": "Make Company→Memos pass the same predicate as renderMemosPage (add `|| currentRole==='secretary'`), and add a 'memos' entry to NAV_REGISTRY.sidebar.admin so the surface is reachable from the nav rather than from a single dashboard tile.",
  "dimension": "Navigation and reachability — the Corporate Secretary's portal surface: which sidebar/bottom-nav variant they resolve to, every entry they see, every page the router admits them to, and the two-way mismatches between what nav offers and what the rules actually permit.",
  "severity": "medium",
  "corrected": "Same finding, one citation off by one: the Company→Memos canAdd is js/screens/dashboards.js:3756 (3757 is the policies tab).",
  "verified": true
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "Files Hub treats the secretary as an admin in the UI and as a non-admin in the data layer",
  "detail": "renderFilesHub's isAdminRole includes 'secretary', so they get the \"All Scopes\" chip AND it is their DEFAULT landing view. But FilesHub.loadFiles' own isAdminRole is ['president','manager','owner'] — no secretary — so their query takes the 3-query non-admin fan-out (company-visibility + own + shared-with-me) instead of the single broad query. hub_files' read rule would grant the broad read via isAdmin(). Separately FilesHub.canEdit uses the same 3-role list, so rename/move/version/archive controls are hidden on files whose update the rule grants them via isAdmin().",
  "evidence": "js/screens/people.js:2576 (isAdminRole incl. secretary), :2596 + :2599 (All Scopes chip + default), :2625 (FilesHub.loadFiles(null)); js/drive.js:486-503 (loadFiles; isAdminRole at :493 excludes secretary), :513-517 (canEdit excludes secretary); firestore.rules:2862-2867 (read isAdmin()), :2874-2883 (update isAdmin())",
  "impact": "A view labelled \"All Scopes\" silently omits every private and unshared file — the secretary believes they are looking at everything the company has. And every file-management control the rules grant them is invisible, so an oversight role cannot organise the very archive it is nominally administering.",
  "fix": "Make the two admin lists agree. Given the Finance-scope leak above, the correct direction is to NARROW: drop 'secretary' from renderFilesHub's isAdminRole (so \"All Scopes\" is honest for them) and narrow hub_files' isAdmin() disjunct to isSeniorAdmin(), rather than widening drive.js.",
  "dimension": "Navigation and reachability — the Corporate Secretary's portal surface: which sidebar/bottom-nav variant they resolve to, every entry they see, every page the router admits them to, and the two-way mismatches between what nav offers and what the rules actually permit.",
  "severity": "medium",
  "corrected": "",
  "verified": true
 },
 {
  "klass": "SILENT_EMPTY",
  "title": "CRM Dashboard and Pipeline swallow a denied read into an empty funnel — while the sibling tabs in the same screen surface it",
  "detail": "crmFetchAll wraps both aec_contacts and roc_leads in `.catch(() => ({docs:[]}))` and returns empty arrays. The Dashboard then renders a funnel of zeros with \"No follow-ups due\", and Pipeline renders \"Nothing in Quotation right now\" / \"No Won leads yet\". The header comment states the swallow is a deliberate hard rule for this pass. The AEC Leads and ROC Leads tabs of the SAME screen do the opposite — a failed read renders an error panel with a Retry button — so the department contradicts itself tab to tab.",
  "evidence": "js/screens/crm.js:128-140 (crmFetchAll, both .catch swallows), :145-205 (renderCRMDashboard consumes it), :539-579 (renderCRMPipeline), :201 (\"No follow-ups due\" empty state); contrast js/screens/crm.js:241-247 (ROC error+Retry) and js/screens/sales.js:1384-1390 (AEC error+Retry)",
  "impact": "On the screen the owner has assigned as this week's primary work, a permission failure or an offline blip presents as a healthy, empty pipeline with no follow-ups due. The secretary would act on \"all clear\" and never learn the read was refused.",
  "fix": "Give crmFetchAll the same treatment the Approvals queue and the Secretary dashboard already ship: record `_denied` per collection and render a \"Not counted here: AEC / ROC\" banner, or promote it to withLoadingAndError's error branch so the existing Retry appears.",
  "dimension": "Navigation and reachability — the Corporate Secretary's portal surface: which sidebar/bottom-nav variant they resolve to, every entry they see, every page the router admits them to, and the two-way mismatches between what nav offers and what the rules actually permit.",
  "severity": "medium",
  "corrected": "Real, but the trigger is misstated for this role. aec_contacts and roc_leads both allow read to any non-partner (firestore.rules:1792 and 1804), so the secretary will not hit a permission denial on these two collections — the realistic cause of the silent-empty is an offline/network failure or a transient error, not a refused read. The defect (a failure rendering as a healthy empty pipeline on this week's primary work surface, contradicting the sibling tabs) stands.",
  "verified": true
 },
 {
  "klass": "OTHER",
  "title": "CRM and Ventures — this week's assigned work — have no nav entry on either surface",
  "detail": "NAV_REGISTRY.sidebar.admin is a flat 17-entry list with NO {deptLoop:true} placeholder (only the 'staff' variant has one), so no department ever appears in an admin's sidebar. CRM and Ventures are reachable only via the \"All Departments\" grid (sidebar #7) or the Secretary dashboard's \"Departments\" quick action. On mobile the picture is worse: the admin bottom bar is Home/Tasks/Posts/Chat + a More sheet holding only Team and Approve — there is no route to Departments, CRM or Ventures in the bottom nav at all, only through the hamburger drawer.",
  "evidence": "js/config.js:544-563 (sidebar.admin — no deptLoop) vs js/config.js:599 ({deptLoop:true} in 'staff'); js/app.js:1651-1661 (_pushDeptNavItems, only fired by the deptLoop marker); js/config.js:622-630 + js/app.js:1748-1751 (bottom nav: 4 visible + More{Team, Approve}); js/screens/dashboards.js:1725 (the dashboard's Departments tile)",
  "impact": "The owner said \"make sure secretary has access to crm and ventures as he will be working on that this week\". Access exists, but both are three interactions deep on desktop and drawer-only on mobile — neither is discoverable from the chrome the role actually looks at.",
  "fix": "Add two entries to NAV_REGISTRY.sidebar.admin — {key:'crm', page:'dept:CRM'} and {key:'ventures', page:'dept:Ventures'} — or restore the {deptLoop:true} placeholder to the admin variant so an admin's assigned departments surface the same way a staff member's do. No rules change; renderDeptModule already routes both.",
  "dimension": "Navigation and reachability — the Corporate Secretary's portal surface: which sidebar/bottom-nav variant they resolve to, every entry they see, every page the router admits them to, and the two-way mismatches between what nav offers and what the rules actually permit.",
  "severity": "medium",
  "corrected": "",
  "verified": true
 },
 {
  "klass": "OTHER",
  "title": "Stale comment in chat.js claims a Finance/IT chat hole that the rules have since closed",
  "detail": "js/chat.js:372-379 states in bold that the client-side dept-channel filter \"IS THE UI HALF ONLY\" and that \"firestore.rules' convMember()/memberOfDoc() still grant dept-channel membership through isAdmin() … so the boundary itself does NOT yet refuse a direct read or post to conversations/dept_Finance\". That is no longer true: deptChannelOpen() is defined and is wired into memberOfDoc(), convMember() AND the dept-channel create rule.",
  "evidence": "js/chat.js:366-386 (the stale comment at :372-379); firestore.rules:34-35 (deptOpenToSecretary/deptChannelOpen), :857-870 (memberOfDoc/convMember both call it), :883-885 (create calls it)",
  "impact": "No runtime effect — the boundary is correct. The risk is to the next reader: the comment names a specific open hole and prescribes a fix that is already applied, inviting a duplicate change or a wasted audit cycle. For the record, the three '⚠ SECRETARY LEAK' comments at firestore.rules:1545, 2031 and 2153 are the opposite case — each documents a fix that IS applied (product_costs = isSeniorAdmin()||canFinance(); finance_rollup and the ledger Production leg = isProductionDept()). All three are CLOSED.",
  "fix": "Replace the two-paragraph warning with a one-line pointer to firestore.rules:34-35, noting that the boundary now enforces the same carve-out.",
  "dimension": "Navigation and reachability — the Corporate Secretary's portal surface: which sidebar/bottom-nav variant they resolve to, every entry they see, every page the router admits them to, and the two-way mismatches between what nav offers and what the rules actually permit.",
  "severity": "low",
  "corrected": "",
  "verified": true
 },
 {
  "klass": "OTHER",
  "title": "Login screen's Admin portal card advertises \"Accountant\", which the portal gate then rejects",
  "detail": "The Admin card's title attribute reads \"President · Manager · Secretary · Accountant\". ROLE_TYPE_MAP maps president/owner/manager/secretary to 'admin' but finance (Accountant) to 'employee', with an explicit comment saying so. An Accountant who follows the tooltip and picks Admin is signed out mid-boot and shown \"Wrong login portal. This account is an Employee account\". The secretary's own mapping is correct — this is the one thing on the login path I checked that is wrong.",
  "evidence": "index.html:113 (card title); js/app.js:38-44 (ROLE_TYPE_MAP; secretary→'admin' at :39, finance→'employee' at :42 with the rationale comment at :40-41); js/app.js:172-198 (the gate that signs them out)",
  "impact": "Not a secretary defect — the secretary signs in cleanly through Admin. It is a genuine dead control on the shared login screen: the label promises a portal the code refuses, and the failure mode is a forced sign-out with a cleared password field.",
  "fix": "Drop \"· Accountant\" from index.html:113 and add it to the Employee card's title (currently \"Staff · Agent\").",
  "dimension": "Navigation and reachability — the Corporate Secretary's portal surface: which sidebar/bottom-nav variant they resolve to, every entry they see, every page the router admits them to, and the two-way mismatches between what nav offers and what the rules actually permit.",
  "severity": "low",
  "corrected": "Real but out of scope for this audit: it affects the finance (Accountant) role only; nothing on the secretary's login path is wrong.",
  "verified": true
 },
 {
  "klass": "LEAK",
  "title": "The secretary can self-add to conversations/dept_Finance (or dept_IT, or any private DM/group) and then read it — the participants disjunct is not dept-checked and the admin update branch may rewrite participants with no membership test",
  "detail": "memberOfDoc() and convMember() are each two disjuncts. The SECOND — the dept-channel branch — correctly calls deptChannelOpen(), so a secretary is refused # Finance / # IT today. The FIRST — `request.auth.uid in resource.data.get('participants', [])` — has no type test, no department test and no deptChannelOpen() call at all. Separately, the conversations update rule's creator-or-admin disjunct permits any edit whose affectedKeys fall inside ['name','photoUrl','participants','participantNames','wallpaper','pinnedMsgIds'] with NO memberOfDoc() requirement, NO conversation-type test and NO deptChannelOpen(); isAdmin() includes 'secretary'. A Firestore update does not require read permission — request.resource.data is the server-side merge — so the caller never needs to read the doc first. Therefore `db.collection('conversations').doc('dept_Finance').update({participants: FieldValue.arrayUnion(myUid)})` is ALLOWED, and the instant it lands the first disjunct is true, so the conversation doc, its entire messages subcollection, readers and typing beacons all become readable and postable. The same one-liner joins any private DM or group in the company. The client-side hiding at js/chat.js:380-385 is irrelevant: once they are a participant the channel simply appears, and messages are reachable by id regardless.",
  "evidence": "firestore.rules:857-862 (memberOfDoc, first disjunct unguarded), 864-870 (convMember, same shape), 874 (read: memberOfDoc), 951-953 (update: `(createdBy==uid || isAdmin()) && affectedKeys().hasOnly([… 'participants' …])` — no membership, no type, no deptChannelOpen), 34-35 (deptOpenToSecretary/deptChannelOpen), 21 (isAdmin includes 'secretary'), 961-963 (messages read/create gated on convMember), 1016-1023 (readers/typing). Client: js/chat.js:364-386, 153",
  "impact": "Complete defeat of the owner's \"no Finance, no IT\" ruling on the chat surface, from the browser console, with no UI trace and no audit entry. The Finance channel carries payroll timing, disbursement chatter, client payment status and delete-request discussion; the IT channel carries credential-adjacent talk. It also lets any admin silently join a private DM between two other employees.",
  "fix": "On the creator/admin update disjunct, exclude dept docs and require membership: `|| ( resource.data.get('type','') != 'dept' && memberOfDoc() && (resource.data.get('createdBy','') == request.auth.uid || isAdmin()) && affectedKeys().hasOnly([...]) )`. Dept membership is derived, never stored — the create rule already forces participants to be [] (firestore.rules:887), so nothing legitimate writes participants on a dept doc. Belt and braces: gate the first disjunct of memberOfDoc()/convMember() so a dept-type doc is only ever reachable through the dept branch — `(resource.data.get('type','') != 'dept' && uid in participants) || (dept branch …)`. Neither change moves any other principal.",
  "dimension": "Collaboration & oversight surface — chat, meetings/calendar, notifications, tasks, posts/memos, approvals, HR, attendance, people/team directory (role: secretary / \"Corporate Secretary\")",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "The Tasks screen treats the Corporate Secretary as an ordinary employee, withholding the one authority the rules deliberately preserved for the role",
  "detail": "Every privilege predicate in js/screens/tasks.js is the literal list president|owner|manager|finance — 'secretary' appears nowhere in the file. Consequences: (1) loadTasksList's `isPriv` is false, so the all-tasks branch never runs and lines 439-444 narrow the list to `userDepts.includes(t.department) || assignedTo.includes(me) || createdBy == me` — a secretary with no `departments` on their profile sees ONLY tasks assigned to them personally; (2) renderTasks's `isAdmin` is false, so the \"All Tasks\" option is not even rendered into the filter dropdown; (3) paintTaskDetail's `isAdmin` is false, so Edit, Delete, the full status set and the admin follow-up controls are withheld on any task they neither own nor were assigned. The rules say the opposite: tasks read is open to all internal staff, create is isAdmin(), update is isOpsAdmin(), delete is isAdmin() — and firestore.rules:803-807 argues the point explicitly (\"this is the ONLY non-assignee update clause on /tasks … one of the two sites that made 'just drop secretary' a role-deleting change rather than a scoping one. It stays on the FULL old set.\"). The client comment at js/screens/tasks.js:643-646 asserts the predicate \"MUST match the Firestore tasks update rule\" and names it isFinanceOrAdmin() — a helper that no longer exists; it was split into isOpsAdmin()/isMoneyAdmin() on 2026-08-09 and this copy was never updated.",
  "evidence": "js/screens/tasks.js:265 (isAdmin), 267 (president-branch test), 300-301 (All Tasks / Dept Tasks options), 414 (isPriv), 421 (all-tasks branch), 439-444 (narrowing filter), 643-647 (stale comment + isAdmin), 654 (allowedStatuses), 666-669 (Submit/Edit/Delete header buttons). Rules: firestore.rules:793, 796-798, 803-807, 815-817, 820. Correct client mirrors that already exist: js/departments.js:57 (isOpsPriv), 69 (isAdminPriv)",
  "impact": "Directly blocks two of the three jobs the owner assigned for this week. \"Organize the CRM\" and \"Review Ventures\" run through tasks, but the secretary cannot list the company's CRM or Ventures tasks, cannot re-assign or re-prioritise them, cannot close one and cannot delete a stale one. They can only CREATE a task — that button is ungated — and then lose sight of it the moment it leaves their own assignment list. Nothing errors and nothing is logged; Tasks simply looks like a thin personal to-do list, which reads as \"there is no work here\" rather than \"you are not being shown it\".",
  "fix": "Replace the four hardcoded role lists with the existing mirrors: js/screens/tasks.js:414 and :647 -> window.isOpsPriv() (mirrors isOpsAdmin, the actual update rule); :265 -> window.isOpsPriv(); and add 'secretary' to the branch test at :267 so they get the Departmental / Overdue / Near Due / My Tasks oversight view instead of the employee list. Then correct the comment at 643-646 to name isOpsAdmin().",
  "dimension": "Collaboration & oversight surface — chat, meetings/calendar, notifications, tasks, posts/memos, approvals, HR, attendance, people/team directory (role: secretary / \"Corporate Secretary\")",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "LEAK",
  "title": "The whole-company calendar hands the secretary every Finance and IT meeting's title, agenda and minutes",
  "detail": "meetings/{id} carries no department field, and the read rule admits isAdmin() unconditionally, which includes 'secretary'. loadMonth() drops the `invitees array-contains` leg entirely for this tier, so the month query returns every meeting in the company, and the meeting view renders the agenda (up to 4000 characters) and post-meeting notes (another 4000) in full. This is a deliberate oversight design — the SOP panel and the not-invited empty state both name the Corporate Secretary as one of three roles who see everything — but it was decided BEFORE the 2026-08-08/09 Finance-and-IT carve-out and was never reconciled with it. A meeting titled \"August payroll — net pay review\" whose agenda lists per-employee figures, or an IT meeting whose notes contain an incident write-up, is exactly the content of the two departments the owner closed, arriving through a door the carve-out never looked at.",
  "evidence": "firestore.rules:1857 (match /meetings), 1881 (`allow read: if isAuth() && !isPartner() && (isInvitee() || isOrganizer() || isAdmin())`), 21 (isAdmin includes 'secretary'). Client: js/meetings.js:41-43 (isAdminTier, whose comment states it mirrors isAdmin()), 85-99 (loadMonth; line 89 adds the invitee filter only for non-admin-tier), 437 (agenda rendered), 453-458 (notes + follow-up rendered), 282, 419",
  "impact": "Finance and IT meeting subject matter — titles, agendas, locations and decisions-taken notes — is fully readable by the one role the owner explicitly fenced off from both departments. Unlike the ledger or payroll docs this needs no devtools: it is the default view of the Calendar tab.",
  "fix": "Owner decision, not an unambiguous code bug — put it to Neil. If the calendar is inside the carve-out, add an optional `dept` field to meetings (from the organiser's department or a picker) and extend the read rule with `… || (isAdmin() && deptOpenToSecretary(resource.data.get('dept','')))`, mirroring deptChannelOpen()'s shape. If it is outside, record that in SECRETARY-SCOPE-SPEC.md so the next audit does not re-open it.",
  "dimension": "Collaboration & oversight surface — chat, meetings/calendar, notifications, tasks, posts/memos, approvals, HR, attendance, people/team directory (role: secretary / \"Corporate Secretary\")",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "SILENT_EMPTY",
  "title": "Approvals' Finance Requests and History panes swallow the finance_delete_requests denial into \"No finance requests\" and a silently shortened history",
  "detail": "finance_delete_requests read is canFinance(), which excludes the secretary twice over (isMoneyAdmin does not list them, and isFinanceDept() explicitly rejects role=='secretary'). The page-level count phase handles this correctly — _apq stamps the denial, the chip is labelled with a lock, counts render \"—\" instead of 0 and a banner names the withheld queue. But neither pane that actually lists the records uses that machinery. The Finance Requests pane fetches both collections with a bare `.catch(e => {console.error(...); return {docs:[]};})` and then, when the payroll half is also empty, renders \"No finance requests\" — flatly contradicting the banner a few inches above it. The History pane is worse: all ten queries are `.catch(()=>({docs:[]}))` with no console.error, no stamping and no banner of its own (the page banner is computed once from the count phase and never re-derived per pane), so the secretary's 30-day history drops every finance-delete item with nothing on screen to say so.",
  "evidence": "js/screens/approvals.js:947-951 (the two bare catches), 983 (\"No finance requests\" empty state), 877-888 (History: ten unstamped catches), 916-920 (\"Nothing resolved yet\"). Contrast the correct pattern at 150-156 (_apq), 175-195 (_cnt/_lbl), 244-250 (_deniedBanner). Rule: firestore.rules:2328 (finance_delete_requests read = canFinance), 93 (canFinance = isMoneyAdmin || isFinanceDept), 84-88 (isFinanceDept rejects 'secretary'), 38 (isMoneyAdmin excludes them)",
  "impact": "On the one screen whose entire job is to say something needs attention, the oversight role is shown a clean or shortened list for a category they were never allowed to check. The comment block at approvals.js:140-149 (\"THE QUEUE USED TO LIE WHEN DENIED\") was written to stop exactly this — the fix landed on the count phase and never reached the two list panes.",
  "fix": "Hoist _apq out of renderApprovals so renderApprovalsPane can call it, route both panes' queries through it, and render _deniedBanner inside the pane above the empty state — so a pane can never say \"none\" for a query it did not get to run.",
  "dimension": "Collaboration & oversight surface — chat, meetings/calendar, notifications, tasks, posts/memos, approvals, HR, attendance, people/team directory (role: secretary / \"Corporate Secretary\")",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "LEAK",
  "title": "Nothing stops anyone adding the secretary to a Finance-related DM or group thread — participant membership is dept-blind on both layers",
  "detail": "The Finance/IT carve-out covers exactly one conversation shape: type=='dept'. A thread of type 'group' (or 'announcement', or a DM) named \"Payroll\", \"Finance close\" or \"IT handover\" is governed only by the participants array, which no rule and no client gate ever tests against SECRETARY_BLOCKED_DEPTS or deptChannelOpen(). A Finance manager adding the secretary to such a group — or a Finance employee opening a DM with them — grants full, permanent read of that thread's whole history, and dmCandidates actively offers every internal user to them. This may be intended (person-to-person threads are not departments), but it is unruled, so the carve-out's real coverage is much narrower than \"no access to Finance and IT\" implies.",
  "evidence": "firestore.rules:857-862 (memberOfDoc participants disjunct is unconditional), 878-881 (dm/group create requires only that the creator include themself), 951-953 (creator/admin may rewrite participants), 962-963 (messages read = convMember). Client: js/chat.js:388-396 (dmCandidates), 5369-5381 (_canManageConv gives any admin group member management)",
  "impact": "The Finance carve-out is one channel deep. Same content, same product, a different conversation `type` — and the boundary does not apply.",
  "fix": "Decide and record the policy. If DMs/groups are intentionally outside the carve-out, state that in SECRETARY-SCOPE-SPEC.md so it stops reading as an oversight. If not, the enforceable step short of a schema change is a client-side warning when a blocked-dept member adds a secretary to a thread, plus the participants fix above.",
  "dimension": "Collaboration & oversight surface — chat, meetings/calendar, notifications, tasks, posts/memos, approvals, HR, attendance, people/team directory (role: secretary / \"Corporate Secretary\")",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "OTHER",
  "title": "js/chat.js carries a prominent, now-false warning that the rules do NOT enforce the chat carve-out — masking the hole that IS still open",
  "detail": "A ten-line boxed comment above myDeptChannels states: \"THIS IS THE UI HALF ONLY. firestore.rules' convMember()/memberOfDoc() still grant dept-channel membership through isAdmin() … so the boundary itself does NOT yet refuse a direct read or post to conversations/dept_Finance. Closing that needs a !isSecretary() guard on the dept-membership disjunct in firestore.rules (mirroring canIt()), an emulator differential and a separate deploy. Reported, deliberately not changed in this pass.\" That guard SHIPPED: deptOpenToSecretary()/deptChannelOpen() exist and are called by memberOfDoc(), convMember() AND the dept create rule. The described hole is closed; the comment says it is open. A maintainer reading this file will believe the dept-membership disjunct is the outstanding work and will never look at the participants disjunct, which is where the live leak actually is.",
  "evidence": "js/chat.js:372-379 (the stale warning). Contradicted by firestore.rules:34-35 (deptOpenToSecretary/deptChannelOpen defined), 860 (memberOfDoc calls it), 868 (convMember calls it), 884 (create calls it), and the rules file's own note at 31-33 recording the 2026-08-09 client change",
  "impact": "Documentation pointing at a closed door while the open one sits two disjuncts above it — high misdirection cost on precisely the boundary this audit exists to check.",
  "fix": "Replace the warning with what is true now (the dept branch IS enforced in rules) plus a pointer to the participants-disjunct gap until that is closed.",
  "dimension": "Collaboration & oversight surface — chat, meetings/calendar, notifications, tasks, posts/memos, approvals, HR, attendance, people/team directory (role: secretary / \"Corporate Secretary\")",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "Meetings: the rules grant the oversight tier edit/cancel/delete on every meeting, and the UI offers none of it (and never calls delete at all)",
  "detail": "meetings update admits `isOrganizer() || isAdmin()` and delete admits `isOrganizer() || isAdmin()`, so a secretary may rewrite any meeting's title, agenda, location, invitee list and status, or delete it outright. The client renders Edit, \"Notes & follow-up\" and \"Cancel meeting\" only when `mine` (organizerUid === me), and no code path in the repository calls a meetings delete at all — the only meetings access outside js/meetings.js is one onSnapshot in chat.js. So the rule grants a company-wide write power that has no surface, while the screen gives the oversight tier a strictly read-only calendar. Both directions of the mismatch are live: an unexercised permission on one side, an unreachable capability on the other.",
  "evidence": "firestore.rules:1896-1909 (update: isOrganizer || isAdmin), 1911 (delete: isOrganizer || isAdmin). Client: js/meetings.js:424 (`const mine = m.organizerUid === me`), 462-464 (Edit / Notes / Cancel all gated on `mine`), 474-485 (handlers). Repo-wide grep for the collection: only js/meetings.js and js/chat.js:2737, neither deletes",
  "impact": "An unexercised write grant on the owner's meeting record, and a secretary cannot cancel a meeting on the President's behalf even though the boundary allows it. If the calendar carve-out above is ever applied, this same rule also lets them EDIT the Finance meetings they can currently only read.",
  "fix": "Pick one direction. Either narrow update/delete to `isOrganizer() || isSeniorAdmin()` so the rule matches who has controls, or render Edit/Cancel for isAdminPriv() behind a \"you are editing someone else's meeting\" confirm. Do not leave the two layers disagreeing on a records collection.",
  "dimension": "Collaboration & oversight surface — chat, meetings/calendar, notifications, tasks, posts/memos, approvals, HR, attendance, people/team directory (role: secretary / \"Corporate Secretary\")",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "HR's \"People & Roles — Assign roles, departments & employee class\" card is shown to the secretary, who can do none of those three things",
  "detail": "renderHR's role allowlist admits 'secretary' and the People & Roles card renders unconditionally with the description \"Assign roles, departments & employee class\". It routes to team-directory, where \"+ Invite Member\" is hidden (`pres` = president|manager|finance), the offboard/reinstate actions are hidden (canManageAccounts = president|manager|HR-dept), and the actual role/department/pay-class editor lives behind the president/manager-only 'team' page. The rules agree with the gates — the secretary's users-update branch requires userPrivilegedFieldsUnchanged(), which freezes role, department, departments, salary, allowance, deductions, employeeId and username — so this is not a security hole. It is a promise the UI makes and cannot keep, naming the exact three capabilities the role does not have.",
  "evidence": "js/screens/hr.js:373 (allowlist includes 'secretary'), 392 (the card and its description), 378 (canAccounts = president/manager). js/screens/people.js:508 (`pres` — no secretary, so no Invite), 1029-1031 (canManageAccounts). Rule firestore.rules:457-470 (their branch is isAdmin() && userPrivilegedFieldsUnchanged() && fcmTokenUnchangedForOthers()), 187-223 (frozen field list), 349-364",
  "impact": "During onboarding week the secretary taps a card promising role assignment and lands on a directory with no such control and no explanation — on the surface the owner asked to be \"clear\".",
  "fix": "Make the description role-aware — for a non-senior admin render \"People & Roles — view the company directory\" — or drop the card for them, since Team Directory is already in their sidebar.",
  "dimension": "Collaboration & oversight surface — chat, meetings/calendar, notifications, tasks, posts/memos, approvals, HR, attendance, people/team directory (role: secretary / \"Corporate Secretary\")",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "Two same-screen memo gates disagree: creatable from the Memos page, read-only from the Company screen's Memos tab",
  "detail": "renderMemosPage passes canAdd = `isPresident() || currentRole==='manager' || currentRole==='secretary'`, so from the Memos nav entry the secretary gets \"+ New Memo\" and the per-memo delete button. The Company screen's Memos tab calls the SAME renderCompanyMemos with `isPresident() || currentRole==='manager'` — secretary omitted — under a comment claiming it mirrors firestore.rules. It does not: memos create and delete are both isAdmin(), which includes them. One component, one collection, two answers depending on which door was used.",
  "evidence": "js/screens/dashboards.js:4373 (Memos page: secretary included), 3756 (Company tab: secretary omitted, with the mismatched justification), 4038-4041 (canAdd -> \"+ New Memo\"), 4087 (canAdd -> delete). Rule firestore.rules:1570-1573 (memos create/delete = isAdmin)",
  "impact": "Memos and board resolutions are the Corporate Secretary's signature artefact. Reaching them via Company -> Memos silently strips the compose button, which reads as \"I am not allowed to write memos\" — the opposite of the role's purpose — until they happen to find the other route.",
  "fix": "js/screens/dashboards.js:3756 — pass the same predicate as line 4373; better, extract one canManageMemos() helper (isAdminPriv()) and call it from both call sites.",
  "dimension": "Collaboration & oversight surface — chat, meetings/calendar, notifications, tasks, posts/memos, approvals, HR, attendance, people/team directory (role: secretary / \"Corporate Secretary\")",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "Post moderation: the rules let the secretary delete any post, the UI never offers it",
  "detail": "posts delete admits `resource.data.authorId == request.auth.uid || isAdmin()`, and isAdmin() includes 'secretary'. The Delete button on a post card renders only when `canApprove || isOwn`, and canApprove is `isRealPresident() || currentRole === 'manager'`. So the oversight role can moderate chat messages but not the company feed, despite identical rule shapes. Post APPROVAL is correctly withheld on both layers — firestore.rules:547 requires isSeniorAdmin() whenever `status` is in the diff and the client's canApprove matches — so only the delete verb is mismatched.",
  "evidence": "firestore.rules:553 (delete: author or isAdmin), 545-552 (update; 547 = the isSeniorAdmin status gate). Client: js/screens/people.js:79 and 347 (canApprove = president|manager), 157 and 193 (Delete gated on canApprove || isOwn)",
  "impact": "A capability the boundary grants the oversight role is unreachable. Minor alone; listed because it is the same class as the Tasks defect and would be closed by the same sweep.",
  "fix": "Gate the post Delete button on window.isAdminPriv() (the existing mirror of isAdmin) while keeping Approve / Reject / Pin on canApprove.",
  "dimension": "Collaboration & oversight surface — chat, meetings/calendar, notifications, tasks, posts/memos, approvals, HR, attendance, people/team directory (role: secretary / \"Corporate Secretary\")",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "Audit Log and System Health are granted to the secretary in the rules but have no nav entry for anyone but the President",
  "detail": "audit_log read is `isAdmin() || own actorUid`, error_log read is isAdmin(), and system_health read is isOpsAdmin() — all three include the secretary. All three sidebar entries carry `when:'isPresident'`, and the admin sidebar is the only variant that lists them, so there is no route in; there is no deep link either, since the nav registry is the sole producer of those pages. For a role whose remit is corporate records and oversight, the who-changed-what trail is permitted and invisible.",
  "evidence": "firestore.rules:2512-2513 (audit_log read = isAdmin || own actorUid), 2559 (error_log read = isAdmin), 1094-1096 (system_health read = isOpsAdmin). js/config.js:561 ({ key:'audit-log', … when:'isPresident' }), 562 ({ key:'sys-health', … when:'isPresident' }); js/app.js:331 shows the health BANNER tier already includes them",
  "impact": "The oversight role cannot open the audit trail. Not a leak and not blocking this week's three tasks, but it is the single most role-appropriate screen in the app and it is unreachable for them.",
  "fix": "Owner call. If the audit log is meant to be President-only, leave the nav and narrow the rule to isPresident() so the two layers agree. If oversight includes it, change the `when` on js/config.js:561 to a new isAuditTier predicate (president || secretary).",
  "dimension": "Collaboration & oversight surface — chat, meetings/calendar, notifications, tasks, posts/memos, approvals, HR, attendance, people/team directory (role: secretary / \"Corporate Secretary\")",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "BLOCKED_WORK",
  "title": "The Tasks screen demotes the Corporate Secretary to a plain employee, though the rules grant them full task authority — and their own dashboard contradicts it on the same session",
  "detail": "js/screens/tasks.js has FOUR independent role lists and 'secretary' is missing from every one: renderTasks isAdmin (tasks.js:265), renderTasks' president-view branch (tasks.js:267), loadTasksList isPriv (tasks.js:414), paintTaskDetail isAdmin (tasks.js:647), and openEditTaskModal isAdmin (tasks.js:1022). Consequences, in order of severity: (1) tasks.js:439-444 filters the list down to `userDepts.includes(t.department) || assignedTo.includes(uid) || createdBy===uid`, so a secretary with no department assignment sees ONLY tasks assigned to them; (2) tasks.js:300-301 removes the \"All Tasks\" and \"Dept Tasks\" options from the filter select entirely, so there is no control to get the company view back; (3) tasks.js:650 canEdit and :654 allowedStatuses cut them to the employee status set, so the ✎ Edit button, reassignment, the president-score block and the follow-up-request admin flags are all withheld on any task they are not assigned to; (4) tasks.js:668 withholds Delete. Every one of those is PERMITTED by the deployed rules: firestore.rules:796-798 tasks allow create isAdmin(); firestore.rules:815-817 allow update (assignee || isOpsAdmin()) — and firestore.rules:69 isOpsAdmin() explicitly lists 'secretary'; firestore.rules:820 allow delete isAdmin(). The comment sitting directly above the broken gate, js/screens/tasks.js:643-646, asserts the list 'MUST match the Firestore tasks update rule (assignee-or-finance-or-admin → isFinanceOrAdmin())' — but isFinanceOrAdmin() was DELETED in the 2026-08-09 split (firestore.rules:40-68 documents the deletion; grep count in firestore.rules is 0), and its successor on this verb is isOpsAdmin(), which added the secretary back. So the gate was correct against a helper that no longer exists. The lie is sharpest because the SAME session shows them company-wide task counts: js/screens/dashboards.js:1643 reads the unfiltered tasks collection and :1703-1704 paint 'Open Tasks' and 'Overdue' KPIs over every task in the company — then the Tasks tab those tiles sit next to shows a handful.",
  "evidence": "UI gates: js/screens/tasks.js:265, js/screens/tasks.js:267, js/screens/tasks.js:414, js/screens/tasks.js:439-444, js/screens/tasks.js:647, js/screens/tasks.js:650, js/screens/tasks.js:654, js/screens/tasks.js:668, js/screens/tasks.js:1022; stale comment js/screens/tasks.js:643-646. Rules: firestore.rules:796-798 (create isAdmin), firestore.rules:815-817 (update isOpsAdmin), firestore.rules:820 (delete isAdmin), firestore.rules:69 (isOpsAdmin includes secretary), firestore.rules:40-68 (helper deletion). Contradicting dashboard: js/screens/dashboards.js:1643, js/screens/dashboards.js:1703-1704.",
  "impact": "The oversight role cannot do task oversight. They can approve a task from the Approvals queue (approvals.js:105/471-473 — which works, because that handler writes the tasks doc directly and bypasses tasks.js's gate) but cannot open the Tasks page and see, edit, reassign, reprioritise or chase a single task they are not personally assigned to. Their dashboard tells them there are N open and M overdue tasks and then gives them no screen that contains them.",
  "fix": "Add 'secretary' to the four role lists in js/screens/tasks.js — lines 265, 414, 647 and 1022 — and add it to the president-view branch condition at line 267 so they get the Departmental/Overdue/Near Due/My Tasks chip layout the other oversight roles get. Then correct the stale comment at tasks.js:643-646 to name isOpsAdmin() (firestore.rules:69) instead of the deleted helper, so the next reader can re-derive the list.",
  "dimension": "Dead controls and lies — signed in AS the Corporate Secretary (role === \"secretary\"), where the interface tells them something untrue: controls visible but denied, capabilities permitted but hidden, and denied reads rendered as \"nothing here\".",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "SILENT_EMPTY",
  "title": "Progress Reports shows every employee's salary as ₱0 and their Net Pay as ₱0 — a confident number produced entirely by a permission denial",
  "detail": "renderProgressReports (js/screens/dashboards.js:3537) admits the secretary by name at line 3538, then at line 3547 calls `fetchUsersWithPayroll().catch(()=>({docs:[],size:0}))`. fetchUsersWithPayroll (js/config.js:704-739) reads the payroll collection at js/config.js:728; firestore.rules:1120+ moved payroll READS to isMoneyAdmin() (firestore.rules:38 — president/manager/finance only), so for the secretary that LIST is denied. js/config.js:728 catches the denial into `{docs:[], _denied:true}` and js/config.js:738 returns `payrollDenied:true` specifically so callers can say 'not shown to you' instead of '₱0' — the comment at js/config.js:719-727 spells out that this exact line is why Analytics once showed the Secretary 'Payroll ₱0/mo'. renderProgressReports never reads payrollDenied. Every row's merged doc therefore has no salary/allowance/deductions, and js/screens/dashboards.js:3616 stamps `data-salary=\"${u.salary||0}\" data-allowance=\"${u.allowance||0}\" data-deductions=\"${u.deductions||0}\"` — three zeroes — onto every View button. Clicking one calls openEmpStandingsModal (js/screens/dashboards.js:3715-3720 → :3184), which at :3280 computes `net = preloaded.salary + preloaded.allowance - preloaded.deductions` = 0 and renders a full 'Salary Computation' panel: Base Salary ₱0, + Allowances ₱0, − Deductions ₱0, Net Pay ₱0 (js/screens/dashboards.js:3263-3267). Nothing anywhere on the page says the figures were refused. Analytics (js/screens/dashboards.js:4643-4662) and the Secretary dashboard (js/screens/dashboards.js:1636-1639, 1696) both got the named-denial banner in the same 2026-08-09 pass; Progress Reports was missed — and it is linked from the Secretary's own dashboard quick-action card and their sidebar.",
  "evidence": "js/screens/dashboards.js:3538 (secretary admitted), js/screens/dashboards.js:3547 (payrollDenied discarded), js/screens/dashboards.js:3616 (zeroed data-* attrs), js/screens/dashboards.js:3715-3720, js/screens/dashboards.js:3280, js/screens/dashboards.js:3263-3267 (₱0 Salary Computation / Net Pay). Source of the flag: js/config.js:728, js/config.js:738, js/config.js:719-727. Rule: firestore.rules:1120+ payroll read isMoneyAdmin(); firestore.rules:38. Entry points for this role: js/screens/dashboards.js:1727 (dashboard quick action), js/config.js:551 (sidebar item).",
  "impact": "An oversight role reads a company-wide compensation table that says every single person is paid nothing, with no indication it is a denial rather than data. It is the same class of failure the owner already had reported to them once ('Payroll ₱0/mo' on Analytics), still live on a second screen — and this one is one tap from the Secretary's home page.",
  "fix": "In renderProgressReports, keep the returned object instead of discarding it — `const usersSnap = await fetchUsersWithPayroll().catch(()=>({docs:[],size:0,payrollDenied:false}))` — and when `usersSnap.payrollDenied` is true, (a) render the same 🔒 'Not shown to you: Payroll' banner already used at js/screens/dashboards.js:1696 / :4643-4662, and (b) suppress the Salary Computation block in openEmpStandingsModal by passing a `payHidden:true` flag through the data-* attrs at :3616, so :3263-3267 prints 'Not shown to you' rather than ₱0.",
  "dimension": "Dead controls and lies — signed in AS the Corporate Secretary (role === \"secretary\"), where the interface tells them something untrue: controls visible but denied, capabilities permitted but hidden, and denied reads rendered as \"nothing here\".",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "The Secretary dashboard's \"Admin — Policies & HR Docs\" quick action lands on a \"Module coming soon\" placeholder",
  "detail": "The Corporate Secretary dashboard renders a 'Corporate Records & Governance' card whose second entry is `<button class=\"quick-action-btn\" onclick=\"navigateTo('dept:Admin')\">Admin — Policies & HR Docs</button>` (js/screens/dashboards.js:1723). navigateTo's dept: prefix routes to renderDeptModule (js/app.js:2666-2671). renderDeptModule's switch (js/app.js:3160-3180) has NO 'Admin' case, so it falls through to `default: renderGenericDept(dept)` at js/app.js:3179, which paints an empty-state card reading '<h4>Admin</h4><p>Module coming soon.</p>' (js/app.js:3208-3213). This is not incidental — the comment at js/app.js:3166-3170 names 'Admin' as the department that is still exactly that placeholder, and js/config.js:205-209 confirms DEPARTMENTS['Admin'] carries `subtabs: []`. The same dead destination is reachable a second way: renderDepartments (js/screens/dashboards.js:4576-4598) builds a grid card for every DEPARTMENTS key except Brilliant Steel and the two secretary-blocked ones, so the Admin card renders with a 'Tap to open →' hint and goes to the same placeholder.",
  "evidence": "UI: js/screens/dashboards.js:1723 (quick action, on the secretary's own dashboard), js/screens/dashboards.js:4576-4598 + :4604-4606 (Departments grid card). Routing: js/app.js:2666-2671, js/app.js:3160-3180 (no 'Admin' case), js/app.js:3179 default, js/app.js:3208-3213 (renderGenericDept placeholder). Confirmation: js/app.js:3166-3170 comment, js/config.js:205-209.",
  "impact": "The role whose stated job is corporate records is offered a labelled shortcut to 'Policies & HR Docs' on their home screen; it opens a blank 'Module coming soon' page. The label promises a destination that does not exist. Policies actually live behind Company → Policies (renderCompanyPolicies) and firestore.rules:2043 /policies, which the secretary can read and write — so the capability is real, the pointer is just aimed at nothing.",
  "fix": "Either repoint the quick action at the screens that hold the content — `navigateTo('company')` for policies/handbook and `navigateTo('dept:HR')` for HR docs (both already open to this role: js/screens/hr.js:373, firestore.rules:2043) — or remove the button until an 'Admin' department screen exists. Same choice applies to the Admin card in the Departments grid; filtering 'Admin' out of js/screens/dashboards.js:4576 until it has a case in renderDeptModule removes both dead entries at once.",
  "dimension": "Dead controls and lies — signed in AS the Corporate Secretary (role === \"secretary\"), where the interface tells them something untrue: controls visible but denied, capabilities permitted but hidden, and denied reads rendered as \"nothing here\".",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "CRM lead deletion is hidden from the Secretary although the rules permit it, and there is no delete-request fallback — so \"organize the CRM\" cannot include removing a lead",
  "detail": "Both CRM directories compute their delete gate as a hardcoded three-role list that omits 'secretary': js/screens/crm.js:252 `const canDeleteDirect = ['president','owner','manager'].includes(currentRole)` (ROC), and js/screens/sales.js:1398, the identical line in renderAECDirectory (AEC, reused verbatim by the CRM tab via js/screens/crm.js:73). Those gates suppress the row delete buttons at js/screens/crm.js:307 and js/screens/sales.js:1475. The deployed rules allow it: firestore.rules:1795 `match /aec_contacts … allow delete: if isAuth() && isAdmin()` and firestore.rules:1807 `match /roc_leads … allow delete: if isAuth() && isAdmin()`, with isAdmin() defined at firestore.rules:21 as ['president','manager','secretary']. There is no escalation path either — the rules comments at firestore.rules:1790-1791 and :1802-1803 state explicitly that these two collections have 'no delete-request flow' because they are low-stakes lists, so unlike finance records there is no President queue to route through. The inconsistency is internal to this pass's own work: ventures.js, a screen written days later against the byte-identical rule shape (`allow delete: if isAuth() && isAdmin()`, firestore.rules:1928), DOES include the role — js/screens/ventures.js:419 `['president','owner','manager','secretary']`. Same rule, same author-era, two different client lists.",
  "evidence": "UI gates: js/screens/crm.js:252 and js/screens/crm.js:307 (ROC), js/screens/sales.js:1398 and js/screens/sales.js:1475 (AEC, reached through js/screens/crm.js:73). Rules: firestore.rules:1795, firestore.rules:1807, firestore.rules:21. No fallback: firestore.rules:1790-1791, firestore.rules:1802-1803. Contradicting sibling: js/screens/ventures.js:419 vs firestore.rules:1928.",
  "impact": "Task 1 of the three the owner assigned this week is \"Organize the CRM\". Organizing a prospecting directory means merging duplicates and dropping dead leads; the secretary can add and edit but cannot remove a single row, and the UI offers them no way to ask anyone to. They will either leave junk in the directory or have to interrupt the President for each deletion — for a collection the rules already say they may delete.",
  "fix": "Add 'secretary' to the two canDeleteDirect lists — js/screens/crm.js:252 and js/screens/sales.js:1398 — matching js/screens/ventures.js:419 and the isAdmin() rule these three collections share. No rules change is needed. If the owner would rather keep deletion narrow, the alternative is the opposite edit: narrow firestore.rules:1795 and :1807 to isSeniorAdmin() so the boundary and the UI agree, and add the 'Request President approval' escalation these two screens currently lack.",
  "dimension": "Dead controls and lies — signed in AS the Corporate Secretary (role === \"secretary\"), where the interface tells them something untrue: controls visible but denied, capabilities permitted but hidden, and denied reads rendered as \"nothing here\".",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "SILENT_EMPTY",
  "title": "The Approvals \"Finance Requests\" pane can render \"No finance requests\" when half its data was refused",
  "detail": "The finance-requests pane fires two queries: payroll_delete_requests (js/screens/approvals.js:949) — which the secretary MAY read, firestore.rules:1218 read includes isSecretary() — and finance_delete_requests (js/screens/approvals.js:950), which they may NOT: firestore.rules:2326 `allow read: if isAuth() && canFinance()`, and canFinance() (firestore.rules:93) is isMoneyAdmin()||isFinanceDept(), with firestore.rules:84-88 deliberately excluding the secretary from isFinanceDept(). The second query's `.catch(e=>{console.error(...);return {docs:[]};})` turns that denial into an empty list with no flag, so at js/screens/approvals.js:952-957 the merged array simply contains no finance deletes, and at js/screens/approvals.js:983 a pane with zero pending payroll deletes prints the empty state `<h4>No finance requests</h4>`. That sentence is false: there may be any number of pending finance delete requests. The same swallow-without-flag appears in the History tab (js/screens/approvals.js:883) and the History-tab list at js/screens/approvals.js:905, so resolved finance deletes silently vanish from the audit view too. Partial mitigation exists and is worth crediting: the page-level count fetch stamps the denial (js/screens/approvals.js:151-156), the chip gets a 🔒 (js/screens/approvals.js:195), and a banner naming 'Finance delete requests' is painted above the chip row and persists across tab switches (js/screens/approvals.js:244-250, :260). But the banner and the pane disagree — one says a category is withheld, the other says the category is empty.",
  "evidence": "Denied read: js/screens/approvals.js:950 and js/screens/approvals.js:883 vs rule firestore.rules:2326 (canFinance) with firestore.rules:93 and firestore.rules:84-88. False empty state: js/screens/approvals.js:983. Merge that drops them: js/screens/approvals.js:952-957, js/screens/approvals.js:905. Existing partial mitigation: js/screens/approvals.js:151-156, :195, :244-250, :260.",
  "impact": "On the one screen whose entire job is to surface what needs attention, an oversight role can be shown the words \"No finance requests\" over a queue they were refused. The banner above softens it but does not correct it — and in the History tab there is no in-pane signal at all, so the 30-day audit trail is silently short.",
  "fix": "Reuse the _apq() pattern already in this file (js/screens/approvals.js:151-156) for the two per-pane queries: stamp `_denied` on the caught result at js/screens/approvals.js:950 and :883, and at js/screens/approvals.js:983 replace the flat 'No finance requests' with the shape the Secretary dashboard already uses (js/screens/dashboards.js:1713) — 'Nothing pending in the queues you can see. Finance delete requests not included.' Do the same for the History tab's empty state at js/screens/approvals.js:917.",
  "dimension": "Dead controls and lies — signed in AS the Corporate Secretary (role === \"secretary\"), where the interface tells them something untrue: controls visible but denied, capabilities permitted but hidden, and denied reads rendered as \"nothing here\".",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "SILENT_EMPTY",
  "title": "The CRM Dashboard and Pipeline tabs are structurally incapable of showing an error — a failed read renders as a confident all-zero funnel",
  "detail": "crmFetchAll (js/screens/crm.js:131-140) wraps BOTH reads in `.catch(() => ({ docs: [] }))` — js/screens/crm.js:133 for aec_contacts and :134 for roc_leads — so the returned promise can never reject. Both renderCRMDashboard (js/screens/crm.js:146) and renderCRMPipeline (js/screens/crm.js:540) pass that function to window.withLoadingAndError, whose error branch is therefore unreachable by construction. A failed read paints a complete, confident page: 'Total AEC Leads 0', 'Total ROC Leads 0', 'Won → Pipeline 0', every funnel row 0/0/0 (js/screens/crm.js:168-190), and the green all-clear empty state '✅ No follow-ups due — Every lead with a follow-up date is on track' (js/screens/crm.js:201). The header comment at js/screens/crm.js:128-130 justifies the catches as protection against 'a partner account somehow reaching this screen' — but firestore.rules:1793 and :1805 already deny partners at the boundary (`read: if isAuth() && !isPartner()`), so the catches buy nothing there and cost the error state for every real reader. The same file gets it right one tab over: renderROCDirectory does a bare try/catch with a visible message and a Retry button (js/screens/crm.js:241-247), and ventures.js does the same and documents why (js/screens/ventures.js:62-64, :291-303 — 'never a swallowing .catch(()=>({docs:[]})), which would render \"no ventures yet\" over a permission error'). NOTE: this is not currently a live denial for the secretary — firestore.rules:1793/1805 grant them both reads — so the failure mode here is an index/network/rules-regression fault, not a permission one today. It is filed because the CRM is where this role will spend the week and because two of the four tabs in the file cannot report a fault at all.",
  "evidence": "js/screens/crm.js:133-134 (the two swallowing catches), js/screens/crm.js:131-140 (never rejects), js/screens/crm.js:146 and js/screens/crm.js:540 (both consumers), js/screens/crm.js:168-190 and js/screens/crm.js:201 (the all-zero / all-clear output). Reads are actually permitted: firestore.rules:1793, firestore.rules:1805. Correct pattern in the same file and its sibling: js/screens/crm.js:241-247, js/screens/ventures.js:62-64, js/screens/ventures.js:291-303.",
  "impact": "If either lead collection ever fails to read, the person tasked with organizing the CRM and writing the CRM strategy proposal is shown an empty funnel and told every follow-up is on track. There is no visible difference between 'the CRM is empty' and 'the CRM did not load', and no Retry.",
  "fix": "Drop the two `.catch(() => ({ docs: [] }))` at js/screens/crm.js:133-134 and let crmFetchAll reject, so withLoadingAndError's error branch actually fires on the Dashboard and Pipeline tabs — matching renderROCDirectory (js/screens/crm.js:241-247) and ventures.js (js/screens/ventures.js:291-303). Partner protection is already at the boundary (firestore.rules:1793/1805) and needs no client catch.",
  "dimension": "Dead controls and lies — signed in AS the Corporate Secretary (role === \"secretary\"), where the interface tells them something untrue: controls visible but denied, capabilities permitted but hidden, and denied reads rendered as \"nothing here\".",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "The Approvals \"Quote / ROA\" tab withholds the escalate button the All Requests tab gives them, so the same request is actionable on one chip and inert on another",
  "detail": "For type 'quote-approval', APPROVAL_CAPS is ['president','manager'] (js/screens/approvals.js:110), so canActOn is false and canEscalate is true for the secretary (js/screens/approvals.js:117-118). In the All Requests pane that resolves correctly: js/screens/approvals.js:503-504 renders the `esc-btn` 'Request President approval' button, wired at js/screens/approvals.js:767-770. The dedicated Quote/ROA pane does not consult canEscalate at all — js/screens/approvals.js:1331 gates the whole action block on `item.status==='pending' && canActOn('quote-approval')` and emits an empty string otherwise, so the secretary gets a card with no buttons and no explanation, not even the 🔒 'President / Manager approves' badge the All Requests pane shows (js/screens/approvals.js:505). Same request, same role, two different affordances depending on which chip is tapped.",
  "evidence": "Capability map js/screens/approvals.js:110, js/screens/approvals.js:117-118. Correct rendering: js/screens/approvals.js:503-505, handler js/screens/approvals.js:767-770. Missing on the ROA pane: js/screens/approvals.js:1331 (canActOn only, no canEscalate branch, no lock badge). Rule confirming the secretary may not act: firestore.rules:1465-1470 approval_requests allow update — isSeniorAdmin(), or isAdmin() only for types in ['signup','attendance','submission','review-task','leave','ca_deduct'], which excludes the quote types.",
  "impact": "On the Quote/ROA chip the secretary sees pending quote approvals with no action and no reason given — it reads as a broken or half-loaded screen. The escalation workflow the owner's ruling depends on ('keep them visible so she can flag them') is present on one tab and absent on the other.",
  "fix": "Mirror the All Requests branch in the ROA pane: at js/screens/approvals.js:1331, when `!canActOn('quote-approval')`, emit the `esc-btn` when `canEscalate('quote-approval')` and the 🔒 badge otherwise — the exact markup at js/screens/approvals.js:503-505 — and bind it with the handler already defined at js/screens/approvals.js:767-770.",
  "dimension": "Dead controls and lies — signed in AS the Corporate Secretary (role === \"secretary\"), where the interface tells them something untrue: controls visible but denied, capabilities permitted but hidden, and denied reads rendered as \"nothing here\".",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "OTHER",
  "title": "js/chat.js carries a prominent comment asserting a rules gap that is now CLOSED — it will send the next fixer to re-open a boundary or waste a deploy",
  "detail": "js/chat.js:366-379 states, in a block flagged '⚠ THIS IS THE UI HALF ONLY', that \"firestore.rules' convMember()/memberOfDoc() still grant dept-channel membership through isAdmin(), which still contains 'secretary' — so the boundary itself does NOT yet refuse a direct read or post to conversations/dept_Finance\", and describes the fix as future work needing 'a !isSecretary() guard … an emulator differential and a separate deploy'. That work has since landed. firestore.rules:35 defines `deptChannelOpen(d) { return !isSecretary() || deptOpenToSecretary(d); }` (with deptOpenToSecretary at firestore.rules:34 excluding Finance and IT), and it is applied on all three verbs: memberOfDoc at firestore.rules:860, convMember at firestore.rules:868, and create at firestore.rules:884. The file header at firestore.rules:28-33 names the chat channels as the exact reason the predicate exists. The boundary now refuses a direct read or post to conversations/dept_Finance and dept_IT; the comment says it does not. I verified the three call sites by reading them; I did not run an emulator differential, so this is a source-level verification, not an executed test.",
  "evidence": "Stale claim: js/chat.js:366-379 (esp. :372-377). Actual deployed rule: firestore.rules:34-35 (deptOpenToSecretary/deptChannelOpen), applied at firestore.rules:860 (memberOfDoc), firestore.rules:868 (convMember), firestore.rules:884 (create); rationale at firestore.rules:28-33. UI half still correct at js/chat.js:380-385.",
  "impact": "No user-visible defect today — the UI hides the two channels and the rules now refuse them, so the layers agree. The risk is to the next change: a maintainer reading chat.js will believe an open leak exists and either ship a duplicate/conflicting guard, or (worse) conclude the carve-out was never enforced and relax something. Three of the audit's other 'SECRETARY LEAK' markers (firestore.rules:1545 product_costs, :2031 finance_rollup, :2153 ledger) are likewise now-FIXED annotations — verified fixed at firestore.rules:1552 (isSeniorAdmin()||canFinance()), firestore.rules:2043 (canFinance()||isProductionDept()) and firestore.rules:2159 (isProductionDept()) — so the file's convention is that these markers describe closed work, which makes the chat.js one the odd, still-future-tense outlier.",
  "fix": "Rewrite js/chat.js:372-379 to state that the rules half shipped, and cite firestore.rules:35 / :860 / :868 / :884 so the two layers point at each other. Keep the UI filter at js/chat.js:380-385 as defence in depth.",
  "dimension": "Dead controls and lies — signed in AS the Corporate Secretary (role === \"secretary\"), where the interface tells them something untrue: controls visible but denied, capabilities permitted but hidden, and denied reads rendered as \"nothing here\".",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "Posts: pin/unpin and moderator delete are hidden from the Secretary though the rules permit both",
  "detail": "The Posts feed computes `canApprove = isRealPresident() || currentRole === 'manager'` (js/screens/people.js:79, and again at js/screens/people.js:347), and uses that ONE flag for three different things: the publish/reject verdict (js/screens/people.js:186), the Pin/Unpin control (js/screens/people.js:158 and :194), and moderator delete (js/screens/people.js:157 and :193, as `canApprove || isOwn`). The rules split those three apart deliberately: firestore.rules:546 restricts a status-changing update to isSeniorAdmin() — correctly excluding the secretary, and the comment at firestore.rules:540-542 says so by name — but firestore.rules:547 permits any isAdmin() update that does NOT touch `status`, which is exactly what pinning is (`pinned` field), and firestore.rules:553 permits delete to `authorId == uid || isAdmin()`. isAdmin() includes 'secretary' (firestore.rules:21). So the publish gate is right and the other two ride on it by accident.",
  "evidence": "UI: js/screens/people.js:79 and js/screens/people.js:347 (one flag), js/screens/people.js:158 + :194 (pin), js/screens/people.js:157 + :193 (delete). Rules: firestore.rules:546 (status → isSeniorAdmin, correctly excludes them), firestore.rules:547 (non-status update → isAdmin, includes them), firestore.rules:553 (delete → isAdmin, includes them), firestore.rules:21 (isAdmin definition), firestore.rules:540-542 (the comment scoping the exclusion to approval only).",
  "impact": "Minor but real for a corporate-records role: the secretary cannot pin a company announcement or remove an inappropriate post from the internal feed, even though the boundary allows both and the owner's ruling only ever took post APPROVAL away from them. It is the mirror image of a dead control — a granted capability with no button.",
  "fix": "Split the single flag in js/screens/people.js into two: keep `canApprove` (president/manager) driving only the publish/reject block at js/screens/people.js:186, and introduce `canModerate = isAdminPriv()` (js/departments.js:68-70, the existing client mirror of firestore.rules:21) to drive the pin control at js/screens/people.js:158/:194 and the moderator delete at js/screens/people.js:157/:193.",
  "dimension": "Dead controls and lies — signed in AS the Corporate Secretary (role === \"secretary\"), where the interface tells them something untrue: controls visible but denied, capabilities permitted but hidden, and denied reads rendered as \"nothing here\".",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "LEAK",
  "title": "Files Hub hands the Corporate Secretary both Finance file scopes, with download links, and defaults them into the all-scopes view",
  "detail": "renderFilesHub puts 'secretary' into isAdminRole (people.js:2576), which does two things: it adds the '__all__' chip AND makes it the default landing scope (defaultKey, people.js:2597). SEED_SCOPES then renders two chips whose dept is literally 'Finance' — 'SSS & Gov Docs' (scope 'sss') and 'Accounting' (scope 'accounting') — with no role filter at all (people.js:2586-2587). Those are the exact scopes js/screens/finance.js:412 and :2078 write into. Since WS38 the legacy files_<scope> collections are retired and everything lives in hub_files (js/departments.js:4214-4218), so this is the whole Finance document archive. The rules back it twice over: hub_files read admits isAdmin() outright (firestore.rules:2863 — which reaches even visibility:'private' docs) and, failing that, the visibility=='company' disjunct at :2866, and bindFileCollection stamps visibility:'company' on every upload (js/departments.js:4521). The all-scopes table renders a direct download anchor on f.url (people.js:2660), and f.url is a getDownloadURL() token URL, i.e. the file contents, not just metadata. _deptBlockedForRole (js/app.js:3140) does not help — it only intercepts 'dept:' routes, and Files is page:'files-hub' (js/config.js:552).",
  "evidence": "js/screens/people.js:2576, 2586-2587, 2597, 2660; js/config.js:552; firestore.rules:2861-2867; js/departments.js:4214-4218, 4521; js/screens/finance.js:412, 2078; js/drive.js:494",
  "impact": "The one role the owner closed Finance to opens the sidebar 'Files' tab and lands, by default, on a searchable table of every Finance document in the company — SSS/government filings and the accounting archive — each with a working download button. Private-visibility files anywhere in the company are reachable too, since the isAdmin() disjunct precedes the visibility test.",
  "fix": "Two edits, both needed. (1) firestore.rules:2863 — replace the bare isAdmin() disjunct on hub_files read with isSeniorAdmin(), matching what was already done to product_costs at :1552; the secretary keeps company-visibility files through the :2866 disjunct. (2) js/screens/people.js — filter SEED_SCOPES by window.SECRETARY_BLOCKED_DEPTS when currentRole==='secretary' (the scopes carry a `dept` field already, so it is a one-line .filter), and have FilesHub.loadFiles exclude those scopes for the all-scopes view. Longer term hub_files needs a `dept`-aware read rule; scope alone is not a security boundary today.",
  "dimension": "Finance/IT wall — indirect paths (denormalized fields, embedded widgets, exports, notifications, storage, chat, audit trail)",
  "severity": "blocker",
  "corrected": "Correct in substance, with two fixes. (1) The Files nav entry is js/config.js:556, not :552 (:552 is 'team'). (2) The claim that private-visibility files company-wide are reachable is true ONLY at the rules layer, not through this screen: FilesHub.loadFiles' broad-query branch tests ['president','manager','owner'] (js/drive.js:493) and excludes 'secretary', so the all-scopes view fans out into the three provable queries at drive.js:497-499 (visibility=='company', uploadedBy==uid, sharedUserIds array-contains uid). What the UI actually delivers by default is every company-visibility file in the company, including the entire Finance SSS/government and accounting archive, each with a working download anchor; private docs need a hand-written console query, which firestore.rules:2863 would indeed permit.",
  "verified": true
 },
 {
  "klass": "LEAK",
  "title": "audit_log is readable by isAdmin(), and its details map reconstructs the payroll the secretary was stripped of",
  "detail": "firestore.rules:2512-2513 reads `allow read: if isAuth() && (isAdmin() || resource.data.get('actorUid','') == request.auth.uid)`. isAdmin() includes 'secretary' (firestore.rules:21). Because the first disjunct is role-only, an UNFILTERED list query is provable from the query alone, so `db.collection('audit_log').orderBy('ts','desc').get()` succeeds. The details map is not a summary — it carries the numbers: js/departments.js:1786 logs raise-apply with {from: <old salary>, to: <new salary>} per person; js/departments.js:2624 logs disburse-payrun with {totalNet, employeeCount} — the month's entire net payroll; js/departments.js:2434 logs {uid, plannedCa, actualCa, caShortfall}; js/config.js:2625 logs cash-advance approvals with {total}; js/config.js:2934 logs worker CA deductions with {amount, ...result}; js/departments.js:3512 logs ledger creates with {source, amount, client}; js/departments.js:3267 logs sales orders with {client, contract, paid}. The UI hides the screen (renderAuditLog returns early unless isPresident(), js/screens/dashboards.js:236; the nav entry is when:'isPresident', js/config.js:558) — so this is a rules-only path, but the rules are the boundary in this repo and the console is one line away.",
  "evidence": "firestore.rules:2512-2513, 21; js/config.js:1174-1188 (logAudit), 2625, 2934; js/departments.js:1786, 2434, 2624, 3267, 3512; js/screens/dashboards.js:236; js/config.js:558",
  "impact": "Every figure ruling 2 took away — individual salaries before and after each raise, the monthly total net payroll, cash-advance amounts, ledger postings — is recoverable in full from a single unfiltered query the rules permit. This defeats the payroll/salary_history/salary_raises/pay_runs narrowing wholesale.",
  "fix": "firestore.rules:2513 — narrow the admin disjunct to isSeniorAdmin() (president/manager), keeping the own-trail branch: `allow read: if isAuth() && (isSeniorAdmin() || resource.data.get('actorUid','') == request.auth.uid);`. The only reader is renderAuditLog, already president-only, plus renderRecentActivity's own-actorUid query (js/screens/people.js:2934) which is unaffected. Nothing regresses.",
  "dimension": "Finance/IT wall — indirect paths (denormalized fields, embedded widgets, exports, notifications, storage, chat, audit trail)",
  "severity": "high",
  "corrected": "Accurate; only the nav citation is off - the Audit Log nav entry is js/config.js:561, not :558. Rules-only path (no UI surface), but the rules are the boundary here.",
  "verified": true
 },
 {
  "klass": "LEAK",
  "title": "The Finance/IT chat-channel guard is bypassable in one write: isAdmin() may rewrite `participants` on any conversation, and both membership checks test participants first",
  "detail": "deptChannelOpen() correctly fences dept channels (firestore.rules:34-35) and is applied inside memberOfDoc() (:858-861) and convMember() (:866-869). But in both functions the participants-array test is the FIRST disjunct and is completely unconditional — no type check, no deptChannelOpen. Separately, the conversations update rule has a group-management branch at :951-953 gated on `(createdBy == uid || isAdmin())` with only an affectedKeys() shape guard and NO membership requirement and NO deptChannelOpen. isAdmin() includes 'secretary'. So: `conversations/dept_Finance.update({participants:['<secretary uid>']})` passes :951 (isAdmin true, affectedKeys is exactly ['participants'] which hasOnly permits), after which memberOfDoc()/convMember() return true via their first disjunct, and the secretary can read the doc (:874), read every message (:962) and post messages (:963). The create rule's `participants.size() == 0` invariant for dept docs (:887) is never re-checked on update. Same path for dept_IT. Note js/chat.js:366-378 carries a comment claiming the rules gap is still open — that comment is stale for the dept-membership disjunct (which was fixed) but accidentally true via this different route.",
  "evidence": "firestore.rules:951-953, 858-861, 866-869, 874, 883-887, 962-963, 21, 34-35; js/chat.js:366-384",
  "impact": "The Finance and IT department chat threads — where pay questions, bank/receipt screenshots (chat-files, whose Storage get is open to any signed-in user, storage.rules:195) and infrastructure credentials get discussed — are readable and postable by the Corporate Secretary after one devtools write. The carve-out reads as enforced but is not.",
  "fix": "firestore.rules:951 — add `&& memberOfDoc()` to the createdBy/isAdmin branch, and additionally forbid it touching `participants` on a dept doc: `|| ( (resource.data.get('createdBy','') == request.auth.uid || isAdmin()) && memberOfDoc() && affectedKeys().hasOnly([...]) && (resource.data.get('type','') != 'dept' || !affectedKeys().hasAny(['participants'])) )`. Belt-and-braces: reorder memberOfDoc()/convMember() so the dept branch's deptChannelOpen() cannot be short-circuited, e.g. wrap the whole return in `deptChannelOpen(resource.data.get('department',''))` when type=='dept'.",
  "dimension": "Finance/IT wall — indirect paths (denormalized fields, embedded widgets, exports, notifications, storage, chat, audit trail)",
  "severity": "high",
  "corrected": "Correct as stated. One prerequisite worth naming: the conversations/dept_Finance doc must already exist (update evaluates `resource`), which it does once anyone has used that channel - the secretary cannot lazily create it themselves, since create at :883-887 does enforce deptChannelOpen().",
  "verified": true
 },
 {
  "klass": "BLOCKED_WORK",
  "title": "Ventures attachments: the secretary can write the brief but Storage refuses the file — storage.rules' \"admin\" is a different set from firestore.rules' \"admin\"",
  "detail": "firestore.rules gates /ventures on canDept('Ventures') = isAdmin() || inDept('Ventures') (firestore.rules:126, 1914-1928), so the secretary reads, creates, edits and deletes venture briefs. The brief editor offers 'Attach a document' unconditionally when canEdit is true (js/screens/ventures.js:643-652, dept:'Ventures', subfolder:'Briefs'). But Ventures is a RESERVED top-level Storage segment (storage.rules:134) with its own block at :284-288 gated on isMemberOf('Ventures') = isAdminClaim() || hasClaimDept('Ventures') — and isAdminClaim() is president|manager ONLY (storage.rules:98-100). The secretary is neither, and unless their profile carries the Ventures department they have no claim either. So the Storage put is denied. The comment at js/screens/ventures.js:644-646 (\"'Ventures' is not a reserved top-level segment, so no storage.rules change was needed\") is stale — the Ventures block was added on 2026-08-08, the secretary carve-out on 2026-08-09, and the two admin definitions were never reconciled. Reading an ALREADY-attached file still works, because ventures.fileUrl is a getDownloadURL() token URL that bypasses Storage rules; it is the upload that fails.",
  "evidence": "storage.rules:98-100, 128-140, 284-288; firestore.rules:126, 1914-1928; js/screens/ventures.js:349, 418, 643-652; js/drive.js:353-370 (handleFile error path)",
  "impact": "\"Review Ventures\" is one of the three tasks the owner assigned for this week. The secretary can write and edit briefs but cannot attach a single supporting document: the upload bar turns red with a raw `❌ Upload failed: User does not have permission...` for three seconds and then disappears, with no explanation and nothing saved. Drive.uploadErrorMessage would map storage/unauthorized to \"That photo was rejected — it must be an image under 15MB\" (js/drive.js:216), which for a PDF brief is actively misleading, though renderUploadArea uses err.message rather than that mapper.",
  "fix": "storage.rules:285-286 — make the Ventures block agree with firestore.rules' canDept('Ventures'): add the secretary to the admitted set, e.g. `function isVenturesMember() { return claimRole() == 'president' || claimRole() == 'manager' || claimRole() == 'secretary' || hasClaimDept('Ventures'); }` and use it for read and write. Also correct the stale comment at js/screens/ventures.js:644-646. Requires `firebase deploy --only storage` and a syncUserClaims/backfill so the role claim is present on the token.",
  "dimension": "Finance/IT wall — indirect paths (denormalized fields, embedded widgets, exports, notifications, storage, chat, audit trail)",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "DEAD_CONTROL",
  "title": "CRM delete is permitted by the rules and hidden by both directories' UI, with no request-delete fallback — the secretary cannot organize the CRM",
  "detail": "Mirror-image dead control. firestore.rules:1795 (`aec_contacts` delete) and :1807 (`roc_leads` delete) are both `if isAuth() && isAdmin()`, which includes 'secretary'. Both directory screens hard-code a narrower list: js/screens/crm.js:252 and js/screens/sales.js:1398 both set `canDeleteDirect = ['president','owner','manager'].includes(currentRole)`, so the trash button never renders (crm.js:307, sales.js:1475). Unlike quotes and clients — which offer a `deleteRequested` escalation to the President when direct delete is unavailable (js/screens/sales.js:1785-1787, 1909-1910) — these two collections have no request-delete path at all, in the UI or in the data model. So there is no way for the secretary to remove anything from either directory.",
  "evidence": "firestore.rules:1792-1796, 1804-1808, 21; js/screens/crm.js:252, 307; js/screens/sales.js:1398, 1475, 1785-1787",
  "impact": "\"Organize the CRM\" is assigned task 1. The secretary can add and edit leads but cannot delete a duplicate, a bad import row or a dead lead, and is given no escalation path either — the capability the boundary already grants them is simply unreachable. Deduplication is most of what organizing a lead directory means.",
  "fix": "js/screens/crm.js:252 and js/screens/sales.js:1398 — use the existing client mirror of the rule instead of a hand-rolled list: `const canDeleteDirect = window.isAdminPriv();` (js/departments.js:69-72, president/owner/manager/secretary — exactly isAdmin()). One-line change in each file, no rules change, and it makes the UI match a boundary that already permits it.",
  "dimension": "Finance/IT wall — indirect paths (denormalized fields, embedded widgets, exports, notifications, storage, chat, audit trail)",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "LEAK",
  "title": "Cloud Storage exposes the whole Finance/ tree (all but payslips) to the secretary for read, enumeration AND new-object creation",
  "detail": "storage.rules:219 is `allow read: if isSignedIn() && subfolder != 'payslips' && !isPartnerClaim();` — the only exclusion is the external partner. In Storage rules `read` covers `list`, so the secretary can enumerate and download everything under Finance/Receipts/, Finance/Taxes/, Finance/Ledger/, Finance/Collections/ and any other Finance subfolder. storage.rules:220-222 additionally lets them CREATE new objects there (`resource == null` branch); only overwrite/delete is finance-tier. The authors clearly considered the secretary on this file — isFinanceClaim() at :113 carries an explicit `claimRole() != 'secretary'` so a Finance department assignment cannot restore Finance storage — but only the DEPT back door was closed; the broad `!isPartnerClaim()` read on Finance/* was left as-is. Contrast Ventures, which got a dedicated member-scoped block for exactly this reason (storage.rules:276-288).",
  "evidence": "storage.rules:218-223, 101-114, 128-140, 276-288",
  "impact": "Every expense receipt, tax filing and ledger document the company has ever uploaded is listable and downloadable by the Corporate Secretary, and they can also file new objects into the Finance namespace. Only the payslip transfer proofs are actually protected.",
  "fix": "storage.rules:219-220 — add the role exclusion the sibling predicate already uses: `allow read: if isSignedIn() && subfolder != 'payslips' && !isPartnerClaim() && claimRole() != 'secretary';` and the same conjunct on write. Employees filing expense receipts are unaffected (they are not secretaries), and the finance tier keeps overwrite/delete via isFinanceClaim(). Deploy with `firebase deploy --only storage`.",
  "dimension": "Finance/IT wall — indirect paths (denormalized fields, embedded widgets, exports, notifications, storage, chat, audit trail)",
  "severity": "high",
  "corrected": "Directionally correct; one sub-claim overstated. The 'enumeration' claim is doubtful: Storage list() is evaluated against the path of the prefix being listed, and a two-segment prefix like Finance/Receipts does not match the three-segment /Finance/{subfolder}/{fileName} rule, so list is more likely denied than granted. What is certain and sufficient: the secretary can GET/download any Finance object whose path they know (and hub_files hands them those URLs directly - see finding 1), and can create new objects in the Finance namespace.",
  "verified": true
 },
 {
  "klass": "LEAK",
  "title": "it_tickets was missed by the canIt() sweep — the secretary reads every IT ticket and can update or delete any of them",
  "detail": "The 2026-08-09 IT carve-out converted canDept('IT') to canIt() on it_assets/it_software writes and on both it_access and it_network reads+writes (firestore.rules:1696-1720), and the block comment at :1699-1704 justifies leaving it_assets/it_software READ at !isPartner() as company-wide inventory. it_tickets is never mentioned and was never touched: read stays `!isPartner()` (:1688), update is `createdBy == uid || isAdmin()` (:1690-1692) and delete is `isAdmin()` (:1693). isAdmin() includes 'secretary'. So the secretary reads the entire IT helpdesk queue and holds write and destroy rights over it. The UI path is closed — renderIT is only reachable through dept:IT, which _deptBlockedForRole intercepts (js/app.js:3146) — so this is rules-only, but it is a write and a delete, not just a read.",
  "evidence": "firestore.rules:1687-1693, 1696-1720, 21, 136; js/app.js:3140-3157; js/screens/govit.js:173-183",
  "impact": "An IT ticket body routinely carries the thing the ticket is about — account names, device identifiers, what broke and where. The secretary can read all of them, silently close or reassign any of them, and permanently delete them, on a department the owner closed to the role twice.",
  "fix": "firestore.rules — bring it_tickets in line with the rest of the block: read `if isAuth() && !isPartner() && (!isSecretary() || resource.data.get('createdBy','') == request.auth.uid)` (so they can still see a ticket they filed themselves), update `if isAuth() && (resource.data.createdBy == request.auth.uid || (isAdmin() && !isSecretary()))`, delete `if isAuth() && isAdmin() && !isSecretary()`. Or, simpler and consistent with the file's own idiom, use canIt() on update/delete.",
  "dimension": "Finance/IT wall — indirect paths (denormalized fields, embedded widgets, exports, notifications, storage, chat, audit trail)",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "LEAK",
  "title": "error_log: the secretary can read the company's client-error stream and PERMANENTLY DELETE entries",
  "detail": "firestore.rules:2559 `allow read: if isAuth() && isAdmin();` and :2561 `allow delete: if isAuth() && isAdmin();` — both include 'secretary'. error_log is an IT/observability surface (js/errlog.js writes window.onerror/onunhandledrejection payloads: message, stack, page, version, uid, ua). Its sibling append-only collection audit_log correctly reserves delete for isPresident() (:2532); error_log did not get the same treatment. The UI hides it — renderSystemHealth returns early unless isPresident() || finance (js/screens/dashboards.js:121) and the nav entry is when:'isPresident' (js/config.js:559) — so this is rules-only.",
  "evidence": "firestore.rules:2544-2561, 2532, 21; js/screens/dashboards.js:121, 130-140; js/config.js:559; js/errlog.js",
  "impact": "Two problems, and the delete is the worse one. Reading gives them stack traces and per-user error trails from a department they are locked out of; deleting gives a non-president role the ability to erase the evidence trail on an append-only diagnostic collection, with no approval and no audit row of its own.",
  "fix": "firestore.rules:2559 and 2561 — narrow both to isSeniorAdmin(), and consider making delete isPresident() to match audit_log at :2532. The only reader is renderSystemHealth (already president/finance) so nothing regresses; the finance role reaches it through the screen's own gate, which reads error_log directly and would need canFinance() added if that path must keep working.",
  "dimension": "Finance/IT wall — indirect paths (denormalized fields, embedded widgets, exports, notifications, storage, chat, audit trail)",
  "severity": "medium",
  "corrected": "Accurate; the nav citation is off by three - the System Health entry is js/config.js:562, not :559. The fix note is also right that narrowing to isSeniorAdmin() would break the finance role's access via renderSystemHealth's own gate, so canFinance() must be added if that path is to keep working.",
  "verified": true
 },
 {
  "klass": "LEAK",
  "title": "Analytics shows the secretary the company's accounts receivable — contract, collected and outstanding per client — through job_projects, which no money rule covers",
  "detail": "Analytics admits the Corporate Secretary by name (js/screens/dashboards.js:4640) and then fetches job_projects and projects (:4704-4705). Neither is money-gated: firestore.rules:2612 is `!isPartner()` and :1604 the same. window.Projects.normalize (js/departments.js:117-133) derives contractAmount, collected, arBalance from those docs' amountCollected/arBalance/payments[]/invoices[] fields, and the Overview then renders Receivables (`sum(openProjects, arOf)`) and Top Clients by signed contract, while the Finance subtab renders the full AR aging table off M.aging. This is a denormalized-money path, not a direct one: /ledger, /expenses, /job_costs are all correctly refused and correctly NAMED in the _denied banner — but the AR figures come back successfully, so nothing flags them and they read as legitimate company financials. The same class applies to the Sales Orders page on their sidebar (js/config.js:557), which prints Contract ₱ / Recorded ₱ company totals off sales_orders (firestore.rules:2599, read = !isPartner()).",
  "evidence": "firestore.rules:2612, 2617-2620, 1604, 2599-2601; js/departments.js:117-133; js/screens/dashboards.js:4640, 4704-4705, 4869-4871 (banner is static), 5104, 5164-5180; js/config.js:557",
  "impact": "The role the owner removed from the ledger, payroll and expenses still sees who owes the company how much, how much has been collected, per-payment history and the top clients by contract value. If the intent of ruling 2 is that the secretary sees no company money figures, this is the largest surviving one, and it is invisible because it does not trip the withheld-data banner.",
  "fix": "This is a policy call for the owner, not a mechanical fix — job_projects and projects are the operational project spine, used by Production and Sales, and money-gating the collections would break them. The targeted fix is field-level at the render layer: in js/screens/dashboards.js gate the Receivables KPI, the AR-aging table and the Top-Clients-by-contract card on window.isMoneyPriv() (js/departments.js:87), rendering the existing 'not shown to you' treatment instead of a number — the same pattern js/screens/employee-profile.js:80-85 already uses. Same for the Contract ₱ / Recorded ₱ KPI cards in js/departments.js:3327-3330. Confirm with the owner first whether AR counts as Finance.",
  "dimension": "Finance/IT wall — indirect paths (denormalized fields, embedded widgets, exports, notifications, storage, chat, audit trail)",
  "severity": "unrated",
  "corrected": "",
  "verified": false
 },
 {
  "klass": "SILENT_EMPTY",
  "title": "Analytics' withheld-data banner is written before the lazy Finance-subtab reads run, so the denied Payslips and Expenses reads are never named",
  "detail": "renderAnalytics builds _denied during its upfront Promise.all and serializes the banner into c.innerHTML at js/screens/dashboards.js:4861. But payslips, cash_advances and expenses are deliberately deferred (Phase 86 item 2): loadFinanceExtras() and loadExpenses() run only when the Finance subtab is first opened, via TAB_RENDERERS at :5411/:5422, long after the banner HTML is fixed. Nothing re-renders it. So when renderFinanceAnalytics (:5104) hits the payslips denial (payslips read = isMoneyAdmin, firestore.rules:2377), _noteDenied pushes 'Payslips' into an array nobody reads again, and the screen renders a card headed 'Payslips — This Month (0)' with the body 'No payslips this month' (:5181-5183). Same mechanism for expenses.",
  "evidence": "js/screens/dashboards.js:4650-4665 (_noteDenied), 4861 (banner, written once), 5083-5099 (loadExpenses/loadFinanceExtras), 5104, 5181-5183, 5411, 5422; firestore.rules:2377",
  "impact": "On the one screen this codebase went to real trouble to make honest about withheld money, the Finance subtab tells the Corporate Secretary that zero payslips were issued this month. That is a fabricated factual claim about payroll, and the banner that exists to prevent exactly this is silent because it was rendered too early.",
  "fix": "js/screens/dashboards.js — give the banner a live host: replace the static `${_denied.length?...}` at :4861 with `<div id=\"an-denied-banner\"></div>`, extract the banner HTML into a `renderDeniedBanner()` that writes into it, and call it at the end of loadExpenses() and loadFinanceExtras() as well as after the upfront fetch. Alternatively have renderFinanceAnalytics replace the Payslips/Expenses cards with the _epWithheldCard treatment (js/screens/employee-profile.js:80-85) when the read was refused, rather than a zero-row table.",
  "dimension": "Finance/IT wall — indirect paths (denormalized fields, embedded widgets, exports, notifications, storage, chat, audit trail)",
  "severity": "medium",
  "corrected": "Correct; two refinements. (a) cash_advances is NOT denied to the secretary - firestore.rules:755 carves them in explicitly - so within loadFinanceExtras only the payslips read is affected. (b) The expenses case is the same bug on a different tab: loadExpenses (:4731-4737) is called from renderMarketing (:5062), and expenses read is `createdBy == uid || isMoneyAdmin()` (firestore.rules:1315-1317), so that denial surfaces as the Marketing subtab's 'Budget Used P0', not on the Finance subtab.",
  "verified": true
 },
 {
  "klass": "LEAK",
  "title": "Notifs.sendToDept('Finance') fans out by department membership with no role exclusion, so a secretary assigned to Finance receives money figures in their inbox",
  "detail": "Owner ruling 3 says the department assignment must never beat the role decision, and both rule files honour it — firestore.rules:84-88 (isFinanceDept carries role != 'secretary') and storage.rules:113 (same conjunct). The notification fan-out is the one place it was not applied: sendToDept queries `users where department == 'Finance'` and `users where departments array-contains 'Finance'` with no role filter at all (js/notifications.js:594-596), then batch-writes into every match's inbox. The payloads carry live figures: js/departments.js:4173-4177 sends `${uName}: ${desc} — ₱${amount}` on every department expense/income entry; js/departments.js:2586-2591 sends the CA-reconciliation alert naming employees and a peso shortfall total; js/departments.js:3268 sends new Sales Order amounts. The rules cannot stop it — notifications create is open to any authenticated sender by design (firestore.rules:568) and read is isOwner(uid) (:561), so the secretary is legitimately reading their own inbox. The delivered links also point at 'dept:Finance', which _deptBlockedForRole then refuses (js/app.js:3146), producing a dead notification.",
  "evidence": "js/notifications.js:588-641; js/departments.js:2586-2591, 3268, 4173-4177; firestore.rules:84-88, 561, 568; storage.rules:110-113; js/app.js:3140-3147",
  "impact": "Conditional but exactly the scenario ruling 3 was written for: one dropdown change in People & Roles starts streaming peso amounts into the Corporate Secretary's notification inbox and push notifications, with every rules-layer defence intact and bypassed. Also affects sendToDept('Finance') recipients generally — the exclusion belongs at the fan-out, not per-call-site.",
  "fix": "js/notifications.js:597 — after merging snap1/snap2, filter the recipient set the same way the rules do: `.filter(d => !(department === 'Finance' && (d.data().role === 'secretary')))`, or more generally drop any recipient for whom `(window.SECRETARY_BLOCKED_DEPTS||[]).includes(department) && d.data().role === 'secretary'`. Put it in sendToDept itself so no call site can forget it. Separately, a link of 'dept:Finance'/'dept:IT' should not be delivered to a secretary at all.",
  "dimension": "Finance/IT wall — indirect paths (denormalized fields, embedded widgets, exports, notifications, storage, chat, audit trail)",
  "severity": "medium",
  "corrected": "Correct, and correctly labelled conditional: it fires only if the secretary's profile is given the Finance department. That is precisely the scenario ruling 3 exists for, so it is a genuine hole in the defence rather than a hypothetical.",
  "verified": true
 },
 {
  "klass": "LEAK",
  "title": "system_health is readable by isOpsAdmin() and the infra-failure banner is deliberately rendered for the secretary",
  "detail": "firestore.rules:1095 gates system_health read on isOpsAdmin(), which is president|manager|secretary|finance (firestore.rules:69). checkBackupHealth (js/app.js:331) admits the same four roles by name and, on a stale or errored heartbeat, paints a fixed full-width red 'Records durability alert' banner naming the job and its error count (js/app.js:377-388). The drill-down page is correctly president/finance-only (js/screens/dashboards.js:121) and its nav entry is when:'isPresident' (js/config.js:559) — so the banner is the only surface, but it is a deliberate one.",
  "evidence": "firestore.rules:1094-1097, 69; js/app.js:331, 336-352, 377-388; js/screens/dashboards.js:121; js/config.js:559",
  "impact": "Infrastructure/backup job status is IT territory. The effect is limited (heartbeat status and an error count, no data), so this is the mildest of the IT findings — but it is a decision to make explicitly rather than one that fell out of a shared helper, especially since the secretary cannot open the page the banner is telling them to look at.",
  "fix": "If the owner wants the secretary to keep the durability alert (there is a governance argument for it — records retention is a corporate-secretary concern), leave it and say so in a comment at firestore.rules:1095. If not: narrow the read to isSeniorAdmin() || canFinance() and drop 'secretary' from js/app.js:331. Decide, do not leave it as a side effect of isOpsAdmin().",
  "dimension": "Finance/IT wall — indirect paths (denormalized fields, embedded widgets, exports, notifications, storage, chat, audit trail)",
  "severity": "low",
  "corrected": "Correct, including the observation that the banner links to a page the secretary cannot open (its notification link is 'system-health', js/app.js:371, and the nav entry is js/config.js:562 rather than :559). Effect is limited to heartbeat status and an error count - no data - so this is a decision to record explicitly rather than a leak to rush.",
  "verified": true
 },
 {
  "klass": "LEAK",
  "title": "Two smaller Finance-labelled surfaces reachable through non-Finance rules: strategy_notes/finance and every meeting's agenda/notes",
  "detail": "(a) strategy_notes read is isOpsAdmin() (firestore.rules:1085), which includes 'secretary'. The Analytics Strategy tab reads the collection unfiltered (js/screens/dashboards.js:5318) and renders a chip row that includes a literal 'Finance' bucket (:5284), so the secretary reads the Finance department's market-research notes. Write is correctly withheld client-side (canWrite excludes secretary, :5322) though the rule at :1086 would permit it — a second, smaller dead-control-in-reverse. (b) meetings read is `!isPartner() && (isInvitee() || isOrganizer() || isAdmin())` (firestore.rules:1881); isAdmin() includes 'secretary', so they read EVERY meeting doc company-wide, including a payroll- or audit-review meeting's title, agenda (up to 4000 chars) and notes (:1901-1903) — and may edit or delete any of them (:1896-1911).",
  "evidence": "firestore.rules:1084-1088, 1881, 1896-1911, 21, 69; js/screens/dashboards.js:5283-5285, 5318, 5322; js/meetings.js:43",
  "impact": "Neither is a figure-level leak, but both are prose channels into closed departments: Finance strategy notes are read directly, and any Finance meeting's agenda and minutes are readable and mutable. The meetings one also carries a write risk — the secretary can silently cancel or rewrite a meeting they were never invited to.",
  "fix": "(a) firestore.rules:1085 — either keep the tier and drop the 'finance' chip for the secretary at js/screens/dashboards.js:5284, or (cleaner) make the read deptKey-aware: `allow read: if isAuth() && isOpsAdmin() && (deptKey != 'finance' || !isSecretary());`. Also align the write rule at :1086 with the client's canWrite so the reverse dead control goes away. (b) firestore.rules:1881 — the oversight read is defensible; the WRITE is not. Narrow the update/delete admin branch at :1897 and :1911 to isSeniorAdmin(), leaving read as-is.",
  "dimension": "Finance/IT wall — indirect paths (denormalized fields, embedded widgets, exports, notifications, storage, chat, audit trail)",
  "severity": "medium",
  "corrected": "Both halves confirmed; the Finance chip is defined at js/screens/dashboards.js:5295, not :5284 (:5284 is govStatuses). The write half of (b) - silently editing or deleting an uninvited meeting's agenda and minutes - is the more serious of the two and deserves the isSeniorAdmin() narrowing the fix proposes.",
  "verified": true
 },
 {
  "klass": "BLOCKED_WORK",
  "title": "finance_delete_requests is the one money-request queue that did NOT get the isSecretary() carve-out, so the Approvals bucket it feeds is permanently short",
  "detail": "Owner ruling 1 keeps money REQUESTS visible to the secretary for escalation, and three collections were carved out individually with an explicit `|| isSecretary()`: cash_advances (firestore.rules:755), pending_raises (:1182) and payroll_delete_requests (:1216). finance_delete_requests was not — its read is plain canFinance() (:2326), which excludes the secretary by construction. Both the Approvals page (js/screens/approvals.js:164) and the Secretary dashboard (js/screens/dashboards.js:1648) query it, and both fold it into the same 'Deletion Requests' total as payroll deletes (dashboards.js:1683). The denial IS surfaced honestly — approvals.js:150-154/244-247 and dashboards.js:1622-1626 name it in a banner rather than showing 0 — so this is not a silent empty; it is a capability gap.",
  "evidence": "firestore.rules:2325-2329, 755, 1182, 1216; js/screens/approvals.js:150-154, 164, 244-247; js/screens/dashboards.js:1637-1648, 1683, 1696",
  "impact": "The Corporate Secretary's own dashboard tells them, every time they load it, that finance delete requests are outside their access — while the sibling payroll delete requests queue sits right beside it, visible. The 'Deletion Requests' KPI they are supposed to escalate from is structurally incomplete, and the Approvals page carries a permanent 'Not shown to you' banner. Either the carve-out was meant to include this collection and was missed, or the dashboard should stop querying it.",
  "fix": "One line, if the owner confirms the intent matches payroll_delete_requests: firestore.rules:2326 → `allow read: if isAuth() && (canFinance() || isSecretary());`. Create stays canFinance() and update/delete stay isPresident(), exactly mirroring the payroll_delete_requests shape at :1215-1218. If the owner instead wants it closed, remove the query from js/screens/approvals.js:164 and js/screens/dashboards.js:1648 so the permanent banner goes away.",
  "dimension": "Finance/IT wall — indirect paths (denormalized fields, embedded widgets, exports, notifications, storage, chat, audit trail)",
  "severity": "medium",
  "corrected": "Correct; the dashboard query is at js/screens/dashboards.js:1650, not :1648 (:1648 is signup_requests). Whether to widen the rule or drop the query is an owner decision - but as-is, the secretary's own dashboard permanently tells them a queue they are asked to escalate from is outside their access.",
  "verified": true
 }
]
```
