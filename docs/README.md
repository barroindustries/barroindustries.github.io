# Docs index

All project notes, plans, reviews, and guides in one place. None of these files
affect the running app — they are documentation only, never precached or loaded
by index.html. Root keeps only [CLAUDE.md](../CLAUDE.md), [AGENTS.md](../AGENTS.md),
[ROADMAP.md](../ROADMAP.md) (the running source of truth), and
[ARCHITECTURE.md](../ARCHITECTURE.md).

## Where things live

- **[../specs/](../specs/)** — feature specs, one per feature, written before each build.
- **[plans/](plans/)** — version-level programs and handoffs (V12/V13/V14).
- **[reviews/](reviews/)** — audits and system reviews (point-in-time; the newest supersedes).
- **[guides/](guides/)** — operator/user guides and setup runbooks.
- **[../fable-workplan/](../fable-workplan/)** — the WS9–WS42 workstream plans (all shipped; historical).
- **[../archive/](../archive/)** — superseded June-2026 standalone tools, reference only.
- **[../dev/](../dev/)** — local-only scratch; `dev/_attic/` holds quarantined debris (gitignored).

## Plans ([plans/](plans/))

- [V12-PLAN.md](plans/V12-PLAN.md) — the 40-workstream v12 rebuild (all shipped 2026-07-11).
- [V13-PLAN.md](plans/V13-PLAN.md) — 200-phase program (system 1–100, UI/UX 101–200); referenced by code comments as "V13-PLAN Phase N".
- [V13-STATUS.md](plans/V13-STATUS.md) — v13 completion snapshot.
- [V14-OVERHAUL-PLAN.md](plans/V14-OVERHAUL-PLAN.md) — v14 overhaul waves; Wave 1 + 2A live.
- [HANDOFF-2026-08-10.md](plans/HANDOFF-2026-08-10.md) — session handoff notes, 2026-08-10.

## Reviews ([reviews/](reviews/))

- [BETA-REVIEW-2026-08.md](reviews/BETA-REVIEW-2026-08.md) — 30-agent beta sweep; money+security tier all shipped.
- [REAUDIT-RECOMMENDATIONS.md](reviews/REAUDIT-RECOMMENDATIONS.md) — post-beta re-audit recommendations.
- [SECRETARY-PORTAL-REVIEW.md](reviews/SECRETARY-PORTAL-REVIEW.md) — secretary role/portal review.
- [PAYROLL-AUDIT-2026-08.md](reviews/PAYROLL-AUDIT-2026-08.md) — payroll system audit (19 gaps, 6-phase plan).
- [V13-FUNCTION-REVIEW.md](reviews/V13-FUNCTION-REVIEW.md) — full function audit; HIGH/MEDIUM fixes shipped v12.0.140.
- [MOBILE-WINDOW-RECON.md](reviews/MOBILE-WINDOW-RECON.md) — mobile "pages feel like overlays" investigation.
- [WAVE8-VERIFICATION.md](reviews/WAVE8-VERIFICATION.md) — wave 8 verification notes.

## Guides ([guides/](guides/))

- [Employee_Guide.md](guides/Employee_Guide.md) — employee-facing app guide.
- [Partner_Guide.md](guides/Partner_Guide.md) — partner-facing app guide.
- [DRIVE_SYNC_SETUP.md](guides/DRIVE_SYNC_SETUP.md) — nightly Firebase→Drive mirror setup (service account, Shared Drive).
- [PUBLISHING_GUIDE.md](guides/PUBLISHING_GUIDE.md) — deploy/publishing steps (referenced from js/firebase-config.js).

## Specs ([../specs/](../specs/))

Feature specs, newest first by date in name where present. Code comments cite
these by filename — filenames are never renamed, only moved here.

- [LAYOFF-SPEC.md](../specs/LAYOFF-SPEC.md) — HR layoff + lockdown + statement of account (shipped v14.0.181).
- [PAYROLL-LIVE-SPEC-2026-08-11.md](../specs/PAYROLL-LIVE-SPEC-2026-08-11.md) — live per-team payroll (shipped v14.0.148).
- [PAYROLL-REDESIGN-BRIEF.md](../specs/PAYROLL-REDESIGN-BRIEF.md) — unified payroll engine brief.
- [OPS-PAYROLL-PARITY-SPEC.md](../specs/OPS-PAYROLL-PARITY-SPEC.md) — ops/payroll parity rules.
- [TASK-BASED-PAY-SPEC-2026-08-12.md](../specs/TASK-BASED-PAY-SPEC-2026-08-12.md) — task-based pay.
- [TYPE-B-WEEKLY-PAYROLL-SPEC.md](../specs/TYPE-B-WEEKLY-PAYROLL-SPEC.md) — weekly (Type B) payroll.
- [STATUTORY-BY-STATUS-SPEC-2026-08-12.md](../specs/STATUTORY-BY-STATUS-SPEC-2026-08-12.md) — statutory deductions by employment status.
- [STATUTORY-CONFIG-SPEC.md](../specs/STATUTORY-CONFIG-SPEC.md) — statutory rates configuration screen.
- [PAYSLIP-OVERHAUL-SPEC.md](../specs/PAYSLIP-OVERHAUL-SPEC.md) — payslip render/export overhaul (lazy html2canvas/pdf-lite).
- [COMPANY-AND-CALENDAR-SPEC-2026-08-12.md](../specs/COMPANY-AND-CALENDAR-SPEC-2026-08-12.md) — company overview + calendar.
- [MEETINGS-CALENDAR-SPEC.md](../specs/MEETINGS-CALENDAR-SPEC.md) — meetings + calendar feed.
- [NOTES-AND-DRAWER-SPEC-2026-08-12.md](../specs/NOTES-AND-DRAWER-SPEC-2026-08-12.md) — notes screen + nav drawer.
- [DEPT-BUDGETS-SPEC-2026-08-11.md](../specs/DEPT-BUDGETS-SPEC-2026-08-11.md) — department budget releases.
- [DESIGN-FLOW-SPEC-2026-08-11.md](../specs/DESIGN-FLOW-SPEC-2026-08-11.md) — every-sale-routes-through-Design flow.
- [SECRETARY-SCOPE-SPEC.md](../specs/SECRETARY-SCOPE-SPEC.md) — corporate secretary role scope.
- [OFFLINE-PUNCH-SPEC.md](../specs/OFFLINE-PUNCH-SPEC.md) — offline attendance punch + server reconciliation.
- [MOBILE-WINDOW-MODEL-SPEC.md](../specs/MOBILE-WINDOW-MODEL-SPEC.md) — one-window-at-a-time mobile model.
- [DOCUMENTS-PRINT-SPEC.md](../specs/DOCUMENTS-PRINT-SPEC.md) — printable documents/letterhead.
- [CLIENT-QUOTE-PAGE-SPEC.md](../specs/CLIENT-QUOTE-PAGE-SPEC.md) — client-facing quote page.
- [QUOTE-TEMPLATES-SPEC.md](../specs/QUOTE-TEMPLATES-SPEC.md) — quote templates.
- [PRICING-TIERS-SPEC.md](../specs/PRICING-TIERS-SPEC.md) — pricing tiers.
- [crm-department-spec.md](../specs/crm-department-spec.md), [quote-builder-photos-spec.md](../specs/quote-builder-photos-spec.md), [wave1–wave7 specs](../specs/) — earlier wave specs (pre-existing in this folder).
