// v13 Part E Phase 40 / 115 / 116 — Status metadata unification.
// One vocabulary + badge map per status domain (U-H2). Classic script, no
// imports — attaches to window. Loads after config.js (needs window.escHtml)
// and before departments.js (which is the first consumer).
//
// Scope note: this pass only wires up js/departments.js call sites. js/app.js
// and js/modules.js still have their own inline status handling (task status
// badge at app.js, gov-biddings at app.js, leave badges in modules.js, CA
// badges in modules.js) — those call-site migrations are a later pass. This
// module exports everything they'll need when that pass lands.
//
// Domain-table discoverability: some domains already have well-formed local
// tables in departments.js (PROD_STAGES, CRM_STAGES, AEC_STAGES, DRAWING_
// STATUSES, PURCH_STAT) or app.js (PARTNER_STAGE). We do NOT duplicate that
// data here — statusBadge2() reads window.PROD_STAGES / window.PURCH_STAT
// etc. directly when a caller asks for those domains, so there is exactly
// one source of truth per table. Those tables aren't currently exposed on
// window; do that (one-line `window.X = X`) at each table's definition site
// when wiring a domain through statusBadge2 for the first time.

(function () {
  'use strict';

  // ── Quote status (Phase 115: one quote-status truth) ──────────────────
  // Union vocabulary gathered from every inline implementation found in
  // js/departments.js: renderBSQuotationFiles (~9805), renderBSQuotationsSummary
  // (~9871), renderBSClientData (~10621), the local statusBadge() shadow in
  // openClientHub (~12370-12376), and the global statusBadge()/BS dashboard
  // consumers (~7768, ~7905). Includes salesOrderId-derived 'won' (synthetic,
  // not a stored status value) since several call sites display it.
  const QUOTE_STATUSES = [
    { id: 'draft',            label: 'Draft',             badge: 'badge-gray'   },
    { id: 'sent',              label: 'Sent',              badge: 'badge-blue'   },
    { id: 'pending_approval',  label: 'Pending Approval',  badge: 'badge-orange' },
    { id: 'pending_review',    label: 'Pending Review',    badge: 'badge-orange' },
    { id: 'needs_revision',    label: 'Needs Revision',    badge: 'badge-orange' },
    { id: 'returned',          label: 'Returned',          badge: 'badge-red'    },
    { id: 'rejected',          label: 'Rejected',          badge: 'badge-red'    },
    { id: 'approved',          label: 'Approved',          badge: 'badge-green'  },
    { id: 'filed',             label: 'Filed',             badge: 'badge-green'  },
    { id: 'accepted',          label: 'Accepted',          badge: 'badge-green'  },
    { id: 'won',               label: 'Won',               badge: 'badge-green'  },
    { id: 'lost',              label: 'Lost',              badge: 'badge-gray'   },
    { id: 'expired',           label: 'Expired',           badge: 'badge-red'    },
  ];

  // ── IT domains ──────────────────────────────────────────────────────
  // Ticket statuses from departments.js ~9182/9633; asset statuses from
  // ~9255/9340/9359; software license statuses from ~9393.
  const IT_TICKET_STATUSES = [
    { id: 'open',        label: 'Open',        badge: 'badge-orange' },
    { id: 'in-progress', label: 'In Progress', badge: 'badge-blue'   },
    { id: 'resolved',    label: 'Resolved',    badge: 'badge-green'  },
  ];
  const IT_ASSET_STATUSES = [
    { id: 'active',      label: 'Active',      badge: 'badge-green'  },
    { id: 'maintenance', label: 'Maintenance', badge: 'badge-orange' },
    { id: 'retired',     label: 'Retired',     badge: 'badge-gray'   },
  ];
  const IT_SOFTWARE_STATUSES = [
    { id: 'active',  label: 'Active',  badge: 'badge-green' },
    { id: 'expired', label: 'Expired', badge: 'badge-red'   },
  ];

  // ── Task status (Phase 116) ────────────────────────────────────────
  // departments.js's TASK_STATUSES (~565) is already a well-formed table
  // with the exact {value,label,badge} shape findMeta() expects (it matches
  // on x.id || x.value). We do NOT duplicate it here — we read it live via
  // window.TASK_STATUSES, which departments.js now exposes at its
  // definition site. Includes follow-up states inline in that table
  // (backlog/brainstorm/in-progress/submitted|review/returned/approved/
  // done/on-hold/archived).
  //
  // ── Gov-biddings status (Phase 116) ─────────────────────────────────
  // Union of the two inline vocabularies found: app.js ~7048's govBids
  // color ternary sc={won:'#30D158',lost:'#FF453A',pending:'#FF9F0A',
  // submitted:'#0A84FF'}[b.status]||'#636366' (bid-tracking records), and
  // departments.js ~13146 GOV_STATUSES = ['active','submitted','won','lost',
  // 'cancelled','archived'] (bidding-document buckets), whose non-admin
  // detail view (~13160) renders via the generic statusBadge(d.status) —
  // which has no entries for these ids, so every one of those currently
  // renders badge-gray. This table gives them real colors matching the hex
  // ternary's intent (won→green, lost/cancelled→red, submitted→blue,
  // pending/active→orange/gray) once a call site migrates.
  const GOV_STATUSES = [
    { id: 'active',     label: 'Active',     badge: 'badge-gray'   },
    { id: 'pending',    label: 'Pending',    badge: 'badge-orange' },
    { id: 'submitted',  label: 'Submitted',  badge: 'badge-blue'   },
    { id: 'won',        label: 'Won',        badge: 'badge-green'  },
    { id: 'lost',       label: 'Lost',       badge: 'badge-red'    },
    { id: 'cancelled',  label: 'Cancelled',  badge: 'badge-red'    },
    { id: 'archived',   label: 'Archived',   badge: 'badge-gray'   },
  ];

  // ── Leave status (Phase 116) ────────────────────────────────────────
  // From modules.js lvBadge (~2215): s==='approved'?'badge-green'
  // :s==='rejected'?'badge-red':'badge-orange' (default = pending).
  const LEAVE_STATUSES = [
    { id: 'pending',   label: 'Pending',   badge: 'badge-orange' },
    { id: 'approved',  label: 'Approved',  badge: 'badge-green'  },
    { id: 'rejected',  label: 'Rejected',  badge: 'badge-red'    },
  ];

  // ── Cash Advance status (Phase 116) ─────────────────────────────────
  // Derived from BOTH modules.js mechanisms so a single doc renders the
  // same color in both views:
  //  - renderCAList's class ternary (~1575, class-based): a.status===
  //    'approved'?'badge-green':a.status==='rejected'?'badge-red'
  //    :a.status==='paid'?'badge-blue':'badge-orange' (default = pending).
  //  - renderCAEmployeeCards' inline-style ternary (~1484): approved→
  //    var(--success) (green), paid→var(--primary-light) (blue), rejected→
  //    var(--danger) (red), default→var(--warning) (orange). Same four
  //    colors, just expressed as CSS vars instead of badge classes — the
  //    badge classes below resolve to the same hues (see styles.css
  //    .badge-green/.badge-blue/.badge-red/.badge-orange).
  // 'active' is a synthetic id (like quote's 'won') for the employee-card
  // view's computed "Active" label (approved && balance > 0) — not a
  // stored status value, but callers may look it up for its color.
  const CA_STATUSES = [
    { id: 'pending',   label: 'Pending Approval', badge: 'badge-orange' },
    { id: 'approved',  label: 'Approved',         badge: 'badge-green'  },
    { id: 'active',    label: 'Active',           badge: 'badge-green'  },
    { id: 'paid',      label: 'Paid Off',         badge: 'badge-blue'   },
    { id: 'rejected',  label: 'Rejected',         badge: 'badge-red'    },
  ];

  // ── Expense status (Phase 116) ──────────────────────────────────────
  // From departments.js expenseTable (~1701): generic statusBadge(e.status)
  // falls through to its default map {pending:'badge-orange',
  // approved:'badge-green', rejected:'badge-red', ...}.
  const EXPENSE_STATUSES = [
    { id: 'pending',   label: 'Pending',   badge: 'badge-orange' },
    { id: 'approved',  label: 'Approved',  badge: 'badge-green'  },
    { id: 'rejected',  label: 'Rejected',  badge: 'badge-red'    },
  ];

  // ── Registry ────────────────────────────────────────────────────────
  // Domains backed by a local table elsewhere on window are resolved lazily
  // (via a getter function) so we always read the live table, never a stale
  // copy taken at module-load time (departments.js loads AFTER this file).
  const REGISTRY = {
    quote:       QUOTE_STATUSES,
    it_ticket:   IT_TICKET_STATUSES,
    it_asset:    IT_ASSET_STATUSES,
    systemHealth: [
      { id:'ok', label:'Healthy', badge:'badge-green' },
      { id:'success', label:'Healthy', badge:'badge-green' },
      { id:'warning', label:'Warning', badge:'badge-warn' },
      { id:'warn', label:'Warning', badge:'badge-warn' },
      { id:'error', label:'Error', badge:'badge-red' },
      { id:'stale', label:'Stale', badge:'badge-orange' },
    ],
    it_software: IT_SOFTWARE_STATUSES,
    leave:       LEAVE_STATUSES,
    ca:          CA_STATUSES,
    expense:     EXPENSE_STATUSES,
    gov:         GOV_STATUSES,
    // Lazy passthrough — departments.js owns TASK_STATUSES; exposed on
    // window at its definition site (~565) for this pass (Phase 116).
    task:        () => window.TASK_STATUSES || [],
    // Lazy passthroughs to existing centralized tables (discoverability only
    // — data stays owned by its original file, see header comment).
    prod_stage:   () => window.PROD_STAGES || [],
    drawing:      () => window.DRAWING_STATUSES || [],
    crm_stage:    () => window.CRM_STAGES || [],
    aec_stage:    () => window.AEC_STAGES || [],
    partner_stage:() => window.PARTNER_STAGE || {},
    pr_stage:     () => window.PURCH_STAT || {},
  };

  function resolveTable(domain) {
    const t = REGISTRY[domain];
    if (typeof t === 'function') return t();
    return t || [];
  }

  // Normalizes both array-of-{id/value,label,badge} tables and plain
  // {key:{label,badge}} object tables (e.g. PURCH_STAT, PARTNER_STAGE) into
  // one lookup shape.
  function findMeta(domain, id) {
    const table = resolveTable(domain);
    if (Array.isArray(table)) {
      return table.find(e => e.id === id || e.value === id) || null;
    }
    if (table && typeof table === 'object' && table[id]) {
      return { id, label: table[id].label, badge: table[id].badge };
    }
    return null;
  }

  const esc = (s) => (window.escHtml ? window.escHtml(String(s)) : String(s));

  /**
   * Returns badge HTML for a given status domain + id. Unknown ids fall back
   * to neutral gray with the raw id shown (never silently blank).
   * @param {string} domain - one of the REGISTRY keys above
   * @param {string} id - the stored status value
   * @param {object} [opts] - { fontSize } optional inline size override
   */
  window.statusBadge2 = function (domain, id, opts) {
    const raw = id || 'draft';
    const meta = findMeta(domain, raw);
    const cls = meta ? meta.badge : 'badge-gray';
    const label = meta ? meta.label : raw;
    const sizeStyle = opts && opts.fontSize ? ` style="font-size:${opts.fontSize}"` : '';
    return `<span class="badge ${cls}"${sizeStyle}>${esc(label)}</span>`;
  };

  /** Returns just the badge CSS class (no markup) for a domain/id. */
  window.statusBadgeClass = function (domain, id) {
    const meta = findMeta(domain, id || 'draft');
    return meta ? meta.badge : 'badge-gray';
  };

  /** Returns just the human label for a domain/id. */
  window.statusLabel2 = function (domain, id) {
    const meta = findMeta(domain, id || 'draft');
    return meta ? meta.label : (id || 'draft');
  };

  window.STATUS_META = REGISTRY;
})();
