# CRM DEPARTMENT — spec (from Neil's CRM.xlsx, 2026-08-04)

Consolidate lead management into a dedicated **CRM** department. Move the existing AEC directory in from Sales, add a net-new ROC (restaurant) side, add a lead funnel dashboard + pipeline, and import Neil's real data (129 AEC firms, 202 restaurants) via a president-run migration. When a lead is WON it feeds the existing Sales pipeline (quote → SO → production).

## Source data (specs/crm-seed-data.json — already extracted)
- **AEC Leads** (129): Lead ID · Company/Firm · Contact Person · Role (Architect/Engineer/Contractor/Consultant) · Specialization · City/Province · Phone · Email · Status · Potential · Next Follow Up · Remarks
- **ROC Leads** (202, restaurants): Lead ID · Restaurant Name · Chain Type · Contact Person · Cuisine · Kitchen Size · City/Province · Phone · Email · Status · Next Follow Up · Remarks
- **Statuses**: New · Contacted · Meeting Set · Quotation · Won · Lost
- **Project stages**: Site Visit · Design · Quotation · Negotiation · Awarded · Production · Completed

## What exists in the app today (recon)
- **AEC directory** — `renderAECDirectory` + `AEC_TYPES/AEC_STAGES/AEC_TERMINAL/AEC_REGIONS` in js/screens/sales.js; a Sales sub-tab; its own `aec` collection. WORKS — reuse it, don't rebuild.
- **Client CRM pipeline** — `clients` collection + `crmStageOf`/`CRM_STAGES` + `renderClientProfiles`. This is the won-side pipeline.
- **No ROC** anywhere — net-new.

## The department
`DEPARTMENTS.CRM` (config.js) + `NAV_REGISTRY` entry + `renderDeptModule`/navigateTo route (app.js) + new `js/screens/crm.js` (loaded after sales.js in index.html + PRECACHE). Roles: admin + Sales/CRM dept members (canEditDept).

### Tabs (chipTabs)
1. **Dashboard** — funnel KPIs: Total AEC, Total ROC, by-status counts (New/Contacted/Meeting Set/Quotation/Won/Lost) across both, Won→pipeline handoff count, next-follow-ups due. Mirrors the xlsx Dashboard sheet.
2. **AEC Leads** — the existing `renderAECDirectory` (moved here; removed from Sales sub-tabs). Add the xlsx's `Potential` + `Specialization` fields if missing.
3. **ROC Leads** — NEW `renderROCDirectory` in crm.js: restaurant fields (name/chainType/cuisine/kitchenSize/…), same status funnel, add/edit/detail/print, card-reflow table, follow-up reminders — mirror AEC's structure.
4. **Pipeline** — leads in Quotation/Negotiation, and a "Convert to Quote" action on a Won lead that opens the quote builder pre-filled with the lead's client info (ties CRM → the sales pipeline the other agent is wiring).
5. (Settings reuse the shared status/role/stage vocabularies — no separate screen needed.)

## Data model
- `aec` (exists) — add `potential`, `specialization` if not present.
- `roc_leads` (NEW): `{leadId, restaurantName, chainType, contactPerson, cuisine, kitchenSize, cityProvince, phone, email, status, nextFollowUp, remarks, createdBy, createdAt}`.
- Won lead → creates/links a `clients` doc (existing pipeline) and offers Convert-to-Quote.

## Import (migrations.js, president-run, idempotent)
`importCrmSeed()` — reads specs/crm-seed-data.json (bundle it or fetch it), writes each AEC → `aec/{leadId}` (skip if exists) and each ROC → `roc_leads/{auto}` keyed by name+phone dedupe. Report counts. Safe to re-run.

## Rules (firestore.rules) — MAIN SESSION deploys
- `aec` — confirm existing rule covers CRM dept read/write (was Sales-scoped).
- `roc_leads/{id}` (NEW): read+write `isAuth() && !isPartner() && (canDept('CRM') || canDept('Sales') || isAdmin())`; delete President/finance-delete flow.
- Add `CRM` to the dept-membership helpers if dept-scoped.

## Backup + nav
- scripts/monthly-backup.js auto-discovers root collections — `roc_leads` captured automatically; add to check-backup-coverage baseline.
- NAV_REGISTRY: CRM as a department nav entry; move AEC out of Sales sub-tabs.

## Sequencing
BLOCKED on the running agents: app.js, sales.js, firestore.rules are owned by the sales-pipeline agent right now. Buildable now on FREE files: config.js (DEPARTMENTS/NAV/vocab), new js/screens/crm.js (ROC directory + CRM dashboard), migrations.js (import). Wire the route + move AEC + deploy rules once sales.js/app.js/rules free up — as one coordinated CRM commit.
