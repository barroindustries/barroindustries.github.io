# Workstream 41 — My Profile tab + Facebook-inspired shell redesign

*This is a post-hoc workstream, added 2026-07-11 after the full 40-workstream v12 plan
(Phases 1-5) shipped. Unlike WS28-40, there is no prior grounding brief for this — this file
is BOTH the grounding recon AND the architecture decision, written in one pass. Read the
owner mandate below, ground it in the real current code, resolve every open decision, and
write your spec as `## DECIDED` (exact enough for Sonnet to implement with no further
judgment calls: function signatures, before/after code, data shapes, migration steps, exact
`firestore.rules`/`storage.rules` diffs where relevant, and a rollout/test checklist).*

## Owner mandate, verbatim (Neil Barro, 2026-07-11)

> add this on the instructions for fable to architect
> create a my profile tab
> Id
> Personal FInance and performance, and personal analytics
> Tasks
> Recent Activities
>
> Thats where these will be
>
> web layout and mobile layout take inspiration from facebook layout
>
> Desktop and Ipad
> Top Nav
> Profile Icon
> Chats Icon
> Notifications Icon
> Menu Icon
> Departments Icon
> Search Bar/Icon
> Barro Industries Logo and TItle
>
> Left Navigation
> the other important parts
> Tasks
> Posts
> Company
> etc etc,

## How to read this mandate

- **A new "My Profile" tab/page**, containing (as sub-sections/sub-tabs within it):
  - **ID** — presumably surfaces the existing employee/worker ID card (WS27, shipped:
    QR-verified, printable at CR80 size) inside the profile instead of/in addition to wherever
    it lives today. Ground where WS27's ID card currently renders and who can reach it.
  - **Personal Finance and Performance** — the signed-in user's own pay/performance view:
    likely their own payslip history, YTD figures, EOM (Employee of the Month) standing if
    applicable, raises history, cash-advance balance — scoped to *their own* record only
    (never another employee's, except president/finance who already have that access
    elsewhere). Ground what personal-finance data already exists per-user and where it's
    currently surfaced (if anywhere) vs. buried in admin-only screens.
  - **Personal Analytics** — individual-level metrics: attendance rate, task completion,
    on-time delivery if relevant to their role, etc. Distinct from WS40's org-wide Analytics/
    Insights (Analytics dept tab) — this is "analytics about me," not "analytics about the
    company." Ground whether WS40's `window.Insights`/metric helpers can be reused per-user or
    need new per-user aggregation.
  - **Tasks** — the user's own task list. Ground whether this duplicates/should link to the
    existing Tasks department screen (scoped to "assigned to me") rather than reimplementing
    task rendering.
  - **Recent Activities** — an activity feed of the user's own recent actions across the app
    (posts, task updates, approvals, chat — whatever is realistically loggable without a new
    heavyweight audit-log system). Ground what activity/audit trails already exist (e.g.
    `contactLog`, `stageHistory`, notification history) that could source this without a new
    collection, vs. what would need one.

- **A Facebook-inspired shell redesign**, explicitly scoped by device tier:
  - **Desktop and iPad**: a persistent **top nav bar** — Barro Industries logo + title on one
    side, then icon-only buttons for: **Profile** (opens the new My Profile tab), **Chats**
    (opens WS37's Team Chat, shipped), **Notifications** (opens the existing `Notifs` bell/
    inbox), **Menu** (a catch-all, ground what this should contain — likely settings, sign
    out, theme toggle, keyboard-shortcuts cheat sheet, the things that don't fit elsewhere),
    **Departments** (a department switcher — ground how department navigation currently works
    for multi-department users), and a **Search bar/icon** (WS18's global search, shipped,
    Ctrl/⌘K-triggered). This is explicitly modeled on Facebook's own top bar (logo left,
    search center-left, icon cluster right: profile/messages/notifications/menu).
  - **Left navigation**: simplifies down to "the other important parts" — the owner names
    **Tasks, Posts, Company** as explicit examples and says "etc etc," meaning: whatever
    remains after Profile/Chats/Notifications/Departments move to the top bar. Ground the
    current full sidebar contents (`getSidebarItems()` in app.js, per role) and propose which
    items stay in the simplified left nav vs. move to the top bar vs. move into My Profile vs.
    move into a department's own space now that Departments has a dedicated top-bar entry.
  - **Mobile**: the owner says mobile layout should also "take inspiration from Facebook
    layout" but did NOT specify mobile's exact icon set the way they did for desktop/iPad —
    this is a genuine open decision. Facebook's own mobile app uses a bottom tab bar (5 icons:
    Home/Friends-or-Video/Marketplace-or-Groups/Notifications/Menu) plus a top bar with
    search+Messenger+notifications icons. The app already has a `*_BOTTOM_NAV` per-role array
    system (`window.BOTTOM_NAV_ITEMS`, `PRESIDENT_BOTTOM_NAV`, `PARTNER_BOTTOM_NAV`,
    `PARTNER_GENERIC_BOTTOM_NAV`, `BRILLIANT_BOTTOM_NAV` in config.js) — decide whether the
    redesign reshapes these existing arrays (adding Profile/Chats icons to the bottom nav,
    since mobile has no room for a full top-bar icon cluster) or introduces something new.
    Flag this specific point for Neil's confirmation since he didn't spell out the mobile icon
    set explicitly.

## Blast radius warning

This workstream touches the app's chrome on **every single page, every role** (president,
manager, employee, agent, finance, partner — 6 roles × their own nav variants) and **every
device tier** (desktop, iPad/tablet, mobile). Unlike a single department's screens, there is
no way to ship this incrementally per-department; it is inherently a cross-cutting shell
change. Because of that:

- Ground the **entire current navigation surface** before deciding anything: `getSidebarItems()`
  (app.js), the topbar markup (index.html + the CSS/JS that populates it), the `*_BOTTOM_NAV`
  arrays (config.js), `navigateTo()`'s router (app.js), how WS37's Chat nav entry and WS18's
  search were wired in (both landed today — they are the two most recent, most relevant
  precedents for "add a new global nav affordance" and should heavily inform this decision,
  not be reinvented).
- Decide a **migration/rollout path** that doesn't strand users mid-navigation on deploy (the
  same "legacy stage mapping" discipline WS28 used for production stages, and the "grandfather
  read-only" discipline several other workstreams used for legacy collections, is the right
  model here too — but for UI chrome, not data).
- This is exactly the kind of workstream that should get **high/xhigh effort** per the
  original INDEX.md's own guidance ("money/security first... use high/xhigh effort there") —
  extend that guidance to "foundational shell architecture that every other screen depends on,"
  which is what WS10-11 (routing+dialogs) and WS17 (design system) were in the original plan.

## Expected deliverable format

Same bar as every other `fable-workplan/NN-*.md`: a `## DECIDED` section with resolved
decisions for every open question above (including the mobile icon-set question, marked
‼️ FLAG FOR NEIL if you can't confidently infer it from the Facebook-analogy instruction),
exact function signatures / before-after code for the new My Profile page and the shell
redesign, any new Firestore fields/collections needed (e.g. if Recent Activities needs a new
lightweight per-user activity log), `firestore.rules` diffs if any new collection is added, a
migration/rollout checklist that accounts for the full-app blast radius, and a manual test
checklist covering all 6 roles across desktop/tablet/mobile.
