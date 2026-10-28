/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Inventory › Family Pricing
   js/screens/family-pricing.js

   NEW 2026-10-21 (owner ruling: the public catalogue has CONFIGURABLE products — at first six: preparation table, sink, stove, cabinet, wall
   shelving, rack; since 2026-10-28 eleven, with the dish table, wok range, griddle / griller / fryer, gas deck oven and range hood). The public estimate prices a configured line as the family's primary catalogue SKU (priced by its own size rules)
   PLUS the signed amounts of that family's PRIVATE option sheet, stored in Firestore product_pricing/{family}. This screen is where
   Finance and the President read and edit those amounts, see how each starting value was derived, and APPROVE each family.

   A family whose sheet is not approved is "priced after review" in the public estimate (its lines are left out of the figure), and so is any
   option whose amount is blank: a blank is NEVER read as zero. Saving an edit therefore clears the approval — a changed figure always needs
   a fresh Approve (firestore.rules enforces it too: a write that keeps `approved` true must not change the figures, and must name its
   writer in approvedBy). Sheets start unapproved: the one-time "Import derived starting values" (President only) reads the PRIVATE seed
   file the owner picks from his own computer (private/family-pricing.seed.json, written by scripts/derive-family-pricing.js and never
   committed) and writes UNAPPROVED sheets.

   A STAFF-ONLY option (QUOTE-BUILDER-CONFIGURATOR-SPEC §14, owner ruling 2026-10-28: the 1.2 mm top plate of tables, sinks and stoves) is priced here like any
   other option, with a caption saying it is offered in the Quote Builder only; the amount is the SIGNED amount added for the non-standard choice (a
   negative number, or 0). "Try a configuration" validates in staff mode so Finance can price it.

   A CONDITIONAL option (CONFIGURATOR-FAMILIES-2-SPEC §4.1: fry baskets apply only to a fryer, a pre-rinse sink only on the soiled side of a dish table) still has one cell
   per value, priced once; its group header says "Only when Type is Fryer" in the same muted style. A family switched off for the website (productMeta/config
   families.disabled, spec §9) carries a "Disabled on the website" chip on its card — informational, set outside this screen.

   Gating mirrors firestore.rules `product_pricing` exactly: president / manager / finance role, or a non-secretary member of the Finance
   department. The secretary never sees it. Import is President-only (UI rule; the Firestore rule is the finance tier).

   Everything shown is staff-side. Every interpolation into innerHTML goes through escHtml(); handlers are delegated (data-act), no
   inline onclick. Load order: lazy, via js/config.js PAGE_SCRIPTS 'dept:Inventory' / 'inventory' (after js/qr-families.js,
   js/product-families.js and js/pricing-core.js, so window.QR_FAMILIES / ProductFamilies / PricingCore exist by the time it runs).
   ═══════════════════════════════════════════════════ */
(function () {
  'use strict';

  var FP_ROLES = ['president', 'manager', 'finance'];
  var FP_MAX = 1e8;                                                  // a figure beyond +/-100 million is a typo, never a price
  var FP_CONF = { high: 'badge-green', medium: 'badge-blue', low: 'badge-orange', blank: 'badge-gray', entered: 'badge-purple' };

  // Mirror of firestore.rules: isSeniorAdmin() || canFinance() (canFinance = money-tier role, or a non-secretary Finance member).
  function fpCanEdit() {
    var role = window.currentRole || '';
    if (role === 'secretary') return false;
    if (FP_ROLES.indexOf(role) >= 0) return true;
    return (window.currentDepts || []).indexOf('Finance') >= 0;
  }
  function fpIsPresident() { return (window.currentRole || '') === 'president'; }

  // vals: what the user has TYPED into a figure box and not saved yet, per family: { fid: { 'group|value|key': 'text' } } — so opening or closing another card (which repaints
  // the screen) never loses it. notes: the same for the free-text note.
  var st = { el: null, docs: {}, primaries: {}, constants: {}, disabled: [], open: {}, dirty: {}, notes: {}, vals: {}, loaded: false };
  function fpForgetEdits(fid) { if (fid) { st.dirty[fid] = false; delete st.notes[fid]; delete st.vals[fid]; } else { st.dirty = {}; st.notes = {}; st.vals = {}; } }

  function fpFams() { return window.QR_FAMILIES; }
  function fpPeso(n) { var x = Number(n); return isFinite(x) ? '₱' + x.toLocaleString('en-PH') : ''; }
  function fpNum(v) {                                                // '' -> null (blank); a finite number within the cap -> itself; anything else -> NaN (invalid)
    var t = String(v == null ? '' : v).trim();
    if (t === '') return null;
    var n = Number(t);
    return isFinite(n) && Math.abs(n) <= FP_MAX ? n : NaN;
  }
  function fpActor() {
    return {
      uid: (window.currentUser && window.currentUser.uid) || null,
      name: (window.userProfile && window.userProfile.displayName) || (window.currentUser && window.currentUser.email) || ''
    };
  }
  function fpTrim(s, n) { return typeof s === 'string' ? s.replace(/[\x00-\x1F\x7F]/g, ' ').trim().slice(0, n) : ''; }
  // The figures of a sheet as one canonical text (key order never matters): what an approver SAW is compared with what is stored at the moment of approval.
  function fpStable(v) {
    if (Array.isArray(v)) return '[' + v.map(fpStable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + fpStable(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function fpFigures(doc) { return fpStable({ options: (doc && doc.options) || {}, size: (doc && doc.size) || {} }); }

  // The primary SKU of a family, mapped exactly as the server and the Quote Builder map a `products` doc.
  function fpNormaliseProduct(id, p) {
    var d = p || {};
    return { id: id, category: d.category, name: d.title || d.name || '', formulaType: d.formulaType || 'fixed', basePrice: d.basePrice != null ? d.basePrice : (d.baseRate != null ? d.baseRate : 0),
      defaultDimensions: d.measurement || d.defaultDimensions || {}, formula: d.formula || {}, specs: Array.isArray(d.specs) ? d.specs : [], unit: d.unit || 'pc' };
  }

  // ══════════════════════ ENTRY POINT ══════════════════════
  // The pure helpers other code (and the tests) may use: the role gate, the input parser and the import planner. No Firestore, no DOM.
  window.FamilyPricing = { canEdit: fpCanEdit, isPresident: fpIsPresident, num: fpNum, planImport: fpPlanImport };

  window.renderFamilyPricing = async function (el, currentUser, currentRole) {
    var c = el || (typeof deptContainer === 'function' ? deptContainer() : null);
    if (!c) return;
    st.el = c;
    if (!fpCanEdit()) {
      c.innerHTML = window.renderEmptyState({ icon: '🔒', title: 'Family pricing is for Finance and the President', hint: 'These option amounts are private.' });
      return;
    }
    var F = fpFams(), PF = window.ProductFamilies;
    if (!F || !PF || !window.PricingCore) {
      c.innerHTML = window.renderEmptyState({ icon: '⚠️', title: 'Family pricing did not load', hint: 'Reload the app and try again.' });
      return;
    }
    c.innerHTML = window.skeletonHtml('cards');
    try {
      await fpLoad();
    } catch (e) {
      c.innerHTML = '<div class="empty-state"><p>' + escHtml((e && e.message) || String(e)) + '</p><button type="button" class="btn-secondary btn-sm" data-act="reload">Retry</button></div>';
      fpBind();
      return;
    }
    fpPaint();
  };

  async function fpLoad() {
    var F = fpFams();
    // one read per family, BY ID: a stray document in the collection can never crowd a real sheet out of the screen
    st.docs = {};
    await Promise.all(F.order.map(function (fid) {
      return db.collection('product_pricing').doc(fid).get().then(function (d) { if (d.exists) st.docs[fid] = d.data(); });
    }));
    // the base items and the material multiplier, for the "try a configuration" check (a failed read only disables that check)
    st.primaries = {};
    await Promise.all(F.order.map(function (fid) {
      var pid = F.families[fid].primary;
      return db.collection('products').doc(pid).get().then(function (d) { if (d.exists) st.primaries[fid] = fpNormaliseProduct(pid, d.data()); }).catch(function () { /* the check says so */ });
    }));
    try {
      var m = await db.collection('productMeta').doc('config').get();
      var md = (m.exists && m.data()) || {};
      st.constants = md.constants || {};
      // the kill switch (spec §9): family ids switched off for the website, read here only to show a chip
      st.disabled = (md.families && Array.isArray(md.families.disabled)) ? md.families.disabled.filter(function (x) { return typeof x === 'string'; }) : [];
    } catch (_) { st.constants = {}; st.disabled = []; }
    st.loaded = true;
  }

  // ══════════════════════ PAINT ══════════════════════
  function fpStatus(fam, doc) {
    var v = fpFams().version;
    if (!doc) return { label: 'Not set up', cls: 'badge-gray', approved: false };
    if (doc.approved === true && doc.schemaVersion === v) return { label: 'Approved', cls: 'badge-green', approved: true };
    if (doc.approved === true) return { label: 'Out of date — approve again', cls: 'badge-red', approved: false };
    return { label: 'Draft — not approved', cls: 'badge-orange', approved: false };
  }
  // Every cell a family's sheet can hold, with its stored value: [{ group, value, label, kind, baseline, flat, perW100, confidence, derivation }].
  function fpCells(fam, doc) {
    var PF = window.ProductFamilies;
    var opts = (doc && doc.options && typeof doc.options === 'object') ? doc.options : {};
    return PF.cells(fam).map(function (c) {
      var g = opts[c.group] && typeof opts[c.group] === 'object' ? opts[c.group] : {};
      var v = g[c.value] && typeof g[c.value] === 'object' ? g[c.value] : {};
      return Object.assign({}, c, {
        flat: typeof v.flat === 'number' && isFinite(v.flat) ? v.flat : null,
        perW100: typeof v.perW100 === 'number' && isFinite(v.perW100) ? v.perW100 : null,
        confidence: typeof v.confidence === 'string' ? v.confidence : '',
        derivation: typeof v.derivation === 'string' ? v.derivation : ''
      });
    });
  }
  function fpSizeCell(fam, doc) {
    var s = doc && doc.size && typeof doc.size === 'object' ? doc.size : {};
    return { perW100: typeof s.perW100 === 'number' && isFinite(s.perW100) ? s.perW100 : null, confidence: typeof s.confidence === 'string' ? s.confidence : '', derivation: typeof s.derivation === 'string' ? s.derivation : '' };
  }
  function fpCounts(fam, doc) {
    var cells = fpCells(fam, doc).filter(function (c) { return !c.baseline; });
    var filled = cells.filter(function (c) { return c.flat !== null; }).length;
    var total = cells.length;
    if (fam.sizeBasis === 'linear') { total++; if (fpSizeCell(fam, doc).perW100 !== null) filled++; }
    return { filled: filled, total: total };
  }

  function fpPaint() {
    var F = fpFams();
    var isPres = fpIsPresident();
    var html = '' +
      '<div class="page-header"><div><h3 style="margin:0">' + emojiIcon('⚙️', 18) + ' Family pricing</h3>' +
      '<p style="font-size:12px;color:var(--text-muted);margin:2px 0 0">The private option amounts behind the configurable catalogue products</p></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      (isPres ? '<button type="button" class="btn-secondary btn-sm" data-act="import">' + emojiIcon('📥', 16) + ' Import derived starting values</button>' : '') +
      '<button type="button" class="btn-secondary btn-sm" data-act="reload">' + emojiIcon('↻', 16) + ' Refresh</button></div></div>' +
      '<input type="file" accept="application/json,.json" data-role="import-file" hidden>' +
      window.sopPanel('How family pricing works', [
        'A configured product is priced as its base catalogue item at the size asked for, plus the amounts below for each option that differs from the standard one. The standard option adds nothing.',
        'Leave an amount blank if you do not know it: that option is then "priced after review" and is left out of the public estimate. A blank is never counted as zero.',
        '"Per 100 mm" is optional: the extra amount for every 100 mm of length beyond the standard length of the base item (for shelving it scales the amount with length in both directions).',
        'Saving an edit clears the approval. A family is used by the public estimate only while it is Approved — and only for the figures that were approved.',
        'Starting values were derived from the product master where it supports them (see the confidence and the note on each line). Review every figure before you approve.'
      ]) +
      '<div id="fp-families">' + F.order.map(fpCardHtml).join('') + '</div>';
    st.el.innerHTML = html;
    if (window.lucide) lucide.createIcons({ nodes: [st.el] });
    fpBind();
  }

  function fpCardHtml(fid) {
    var F = fpFams();
    var fam = F.families[fid];
    var doc = st.docs[fid] || null;
    var status = fpStatus(fam, doc);
    var counts = fpCounts(fam, doc);
    var open = !!st.open[fid];
    var prim = st.primaries[fid];
    var meta = [];
    meta.push('Base item <span style="font-family:monospace">' + escHtml(fam.primary) + '</span>' + (prim && prim.name ? ' — ' + escHtml(prim.name) : ''));
    meta.push(counts.filled + ' of ' + counts.total + ' amounts entered');
    if (doc && doc.approved === true && doc.approvedByName) meta.push('approved by ' + escHtml(doc.approvedByName));
    var unsaved = st.dirty[fid] ? ' <span class="badge badge-amber">unsaved changes</span>' : '';
    var off = st.disabled.indexOf(fid) >= 0 ? ' <span class="badge badge-orange fp-off" title="Switched off in productMeta/config (families.disabled): the website refuses this product until it is taken off that list">Disabled on the website</span>' : '';
    return '<div class="card fp-card" data-fid="' + escHtml(fid) + '" style="margin-bottom:12px">' +
      '<div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">' +
      '<div style="flex:1;min-width:200px"><div style="font-weight:700;font-size:15px">' + escHtml(fam.label) + ' <span class="badge ' + status.cls + '">' + escHtml(status.label) + '</span>' + off + unsaved + '</div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-top:2px">' + meta.join(' · ') + '</div></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="btn-secondary btn-sm" data-act="toggle" data-fid="' + escHtml(fid) + '">' + (open ? 'Close' : 'Open') + '</button>' +
      (status.approved ? '<button type="button" class="btn-secondary btn-sm" data-act="unapprove" data-fid="' + escHtml(fid) + '">Unapprove</button>'
        : '<button type="button" class="btn-primary btn-sm" data-act="approve" data-fid="' + escHtml(fid) + '"' + (doc && !st.dirty[fid] ? '' : ' disabled') + '>Approve</button>') +
      '</div></div>' +
      (open ? fpBodyHtml(fid, fam, doc) : '') +
      '</div>';
  }

  function fpShown(fid, group, value, key, stored) {
    var typed = st.vals[fid] ? st.vals[fid][group + '|' + value + '|' + key] : undefined;
    return typed !== undefined ? typed : (stored === null || stored === undefined ? '' : stored);
  }
  function fpInput(fid, group, value, key, num) {
    return '<input type="number" step="any" inputmode="decimal" class="fp-in" data-fid="' + escHtml(fid) + '" data-g="' + escHtml(group) + '" data-v="' + escHtml(value) + '" data-k="' + key + '" value="' + escHtml(fpShown(fid, group, value, key, num)) + '" style="width:110px;padding:6px 8px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px">';
  }
  function fpBodyHtml(fid, fam, doc) {
    var cells = fpCells(fam, doc);
    var rows = '';
    var lastGroup = '';
    cells.forEach(function (c) {
      if (c.group !== lastGroup) {
        lastGroup = c.group;
        var g = window.ProductFamilies.groupOf(fam, c.group);
        var what = g.type === 'slots' ? 'Cost of ONE ' + ((g.unit && g.unit.one) || 'position') + ' of each type (the standard ' + escHtml((g.default || []).length) + '-position layout is the zero point)'
          : g.type === 'multi' ? 'Amount each add-on adds' : 'Amount added when this is chosen instead of the standard option';
        // a staff-only option (the 1.2 mm top plate, owner ruling 2026-10-28) is priced here like any other, but a visitor to the website can never choose it
        var staffNote = g.staffOnly === true ? ' <span class="fp-staffonly" style="font-size:11px;color:var(--text-muted)">· Staff-only option — offered in the Quote Builder, never on the website</span>' : '';
        // a conditional option (spec §4.1) says when it applies; its cells are still priced once, here
        var whenNote = c.when ? ' <span class="fp-when" style="font-size:11px;color:var(--text-muted)">· Only when ' + escHtml(c.when) + '</span>' : '';
        rows += '<tr class="fp-grp"><td colspan="5" style="background:var(--surface-2,#f4f5f7)"><strong>' + escHtml(c.groupLabel) + '</strong> <span style="font-size:11px;color:var(--text-muted)">' + what + '</span>' + staffNote + whenNote + '</td></tr>';
      }
      if (c.baseline) {
        rows += '<tr><td>' + escHtml(c.label) + (c.hint ? ' <span style="font-size:11px;color:var(--text-muted)">(' + escHtml(c.hint) + ')</span>' : '') + '</td><td colspan="4" style="color:var(--text-muted);font-size:12px">Standard option — adds nothing</td></tr>';
        return;
      }
      var conf = c.confidence ? '<span class="badge ' + (FP_CONF[c.confidence] || 'badge-gray') + '">' + escHtml(c.confidence) + '</span>' : '';
      rows += '<tr><td>' + escHtml(c.label) + (c.hint ? ' <span style="font-size:11px;color:var(--text-muted)">(' + escHtml(c.hint) + ')</span>' : '') + '</td>' +
        '<td>' + fpInput(fid, c.group, c.value, 'flat', c.flat) + '</td>' +
        '<td>' + fpInput(fid, c.group, c.value, 'perW100', c.perW100) + '</td>' +
        '<td>' + conf + '</td>' +
        '<td style="font-size:11.5px;color:var(--text-muted);max-width:420px;white-space:normal">' + escHtml(c.derivation) + '</td></tr>';
    });
    if (fam.sizeBasis === 'linear') {
      var sc = fpSizeCell(fam, doc);
      rows += '<tr class="fp-grp"><td colspan="5" style="background:var(--surface-2,#f4f5f7)"><strong>Length</strong> <span style="font-size:11px;color:var(--text-muted)">The base item has no length rule of its own, so length is priced here</span></td></tr>' +
        '<tr><td>Per 100 mm from the standard length (both directions)</td><td>' + '<input type="number" step="any" inputmode="decimal" class="fp-in" data-fid="' + escHtml(fid) + '" data-g="size" data-v="W" data-k="perW100" value="' + escHtml(fpShown(fid, 'size', 'W', 'perW100', sc.perW100)) + '" style="width:110px;padding:6px 8px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px">' + '</td><td></td>' +
        '<td>' + (sc.confidence ? '<span class="badge ' + (FP_CONF[sc.confidence] || 'badge-gray') + '">' + escHtml(sc.confidence) + '</span>' : '') + '</td><td style="font-size:11.5px;color:var(--text-muted);max-width:420px;white-space:normal">' + escHtml(sc.derivation) + '</td></tr>';
    }
    var notes = st.notes[fid] != null ? st.notes[fid] : (doc && typeof doc.notes === 'string' ? doc.notes : '');
    return '<div style="margin-top:12px">' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Option</th><th>Adds (₱)</th><th>Per 100 mm (₱, optional)</th><th>Confidence</th><th>How it was derived</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<label style="display:block;margin-top:10px;font-size:12px;color:var(--text-muted)">Notes for Finance</label>' +
      '<textarea class="fp-notes" data-fid="' + escHtml(fid) + '" rows="2" maxlength="1000" style="width:100%;box-sizing:border-box">' + escHtml(notes) + '</textarea>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
      '<button type="button" class="btn-primary btn-sm" data-act="save" data-fid="' + escHtml(fid) + '">Save (clears the approval)</button></div>' +
      fpTryHtml(fid, fam) + '</div>';
  }

  // ── "Try a configuration": prices a configuration with the figures CURRENTLY in the form (saved or not) so Finance can check a sheet against a real quotation ──
  function fpTryHtml(fid, fam) {
    var PF = window.ProductFamilies;
    var cfg = PF.defaultConfig(fam);
    var dims = PF.defaultDims(fam);
    var controls = fam.groups.map(function (g) {
      if (g.type === 'choice') {
        return '<label style="display:flex;flex-direction:column;font-size:12px;gap:2px">' + escHtml(g.label) +
          '<select class="fp-try-in" data-g="' + escHtml(g.key) + '" style="padding:6px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface);color:var(--text)">' +
          g.options.map(function (o, i) { return '<option value="' + i + '"' + (o.v === cfg[g.key] ? ' selected' : '') + '>' + escHtml(o.l + (o.hint ? ' — ' + o.hint : '')) + '</option>'; }).join('') + '</select></label>';
      }
      if (g.type === 'slots') {
        return '<label style="display:flex;flex-direction:column;font-size:12px;gap:2px">' + escHtml(g.label) + ' (one per position, in order)' +
          '<input class="fp-try-in" data-g="' + escHtml(g.key) + '" data-t="slots" value="' + escHtml(cfg[g.key].join(', ')) + '" placeholder="e.g. wok, hp_large, soup" style="padding:6px 8px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface);color:var(--text)">' +
          '<span style="font-size:11px;color:var(--text-muted)">Codes: ' + escHtml(g.options.map(function (o) { return o.v; }).join(', ')) + '</span></label>';
      }
      return '<label style="display:flex;flex-direction:column;font-size:12px;gap:2px">' + escHtml(g.label) + ' (codes, comma-separated)' +
        '<input class="fp-try-in" data-g="' + escHtml(g.key) + '" data-t="multi" value="" placeholder="' + escHtml(g.options.map(function (o) { return o.v; }).join(', ')) + '" style="padding:6px 8px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface);color:var(--text)"></label>';
    }).join('');
    var sizes = Object.keys(fam.dims).map(function (k) {
      return '<label style="display:flex;flex-direction:column;font-size:12px;gap:2px">' + escHtml(fam.dims[k].label) + ' (mm)<input type="number" class="fp-try-dim" data-k="' + k + '" value="' + dims[k] + '" style="width:100px;padding:6px 8px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface);color:var(--text)"></label>';
    }).join('');
    return '<div class="fp-try" data-fid="' + escHtml(fid) + '" style="margin-top:14px;padding:12px;border:1px dashed var(--border);border-radius:10px">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:8px">Try a configuration</div>' +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">' + controls + sizes +
      '<button type="button" class="btn-secondary btn-sm" data-act="try" data-fid="' + escHtml(fid) + '">Price it</button></div>' +
      '<div class="fp-try-out" style="margin-top:8px;font-size:13px"></div></div>';
  }

  // ══════════════════════ EVENTS ══════════════════════
  function fpBind() {
    var el = st.el;
    if (!el) return;
    if (el._fpHandler) { el.removeEventListener('click', el._fpHandler); el.removeEventListener('input', el._fpInput); el.removeEventListener('change', el._fpChange); }
    el._fpHandler = function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!t || !el.contains(t) || t.disabled) return;
      var act = t.getAttribute('data-act'), fid = t.getAttribute('data-fid');
      if (act === 'reload') { fpReload(); }
      else if (act === 'toggle') { st.open[fid] = !st.open[fid]; fpPaint(); }
      else if (act === 'save') { fpSave(fid); }
      else if (act === 'approve') { fpApprove(fid); }
      else if (act === 'unapprove') { fpUnapprove(fid); }
      else if (act === 'import') { var f = el.querySelector('[data-role="import-file"]'); if (f) f.click(); }
      else if (act === 'try') { fpTry(fid); }
    };
    el._fpInput = function (e) {
      var t = e.target;
      if (t && t.classList && (t.classList.contains('fp-in') || t.classList.contains('fp-notes'))) {
        var fid = t.getAttribute('data-fid');
        if (t.classList.contains('fp-notes')) st.notes[fid] = t.value;
        else { (st.vals[fid] = st.vals[fid] || {})[t.getAttribute('data-g') + '|' + t.getAttribute('data-v') + '|' + t.getAttribute('data-k')] = t.value; }
        if (!st.dirty[fid]) { st.dirty[fid] = true; var badge = el.querySelector('.fp-card[data-fid="' + fid + '"] [data-act="approve"]'); if (badge) badge.disabled = true; }
      }
    };
    el._fpChange = function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-role') === 'import-file') fpImportFile(t);
    };
    el.addEventListener('click', el._fpHandler);
    el.addEventListener('input', el._fpInput);
    el.addEventListener('change', el._fpChange);
  }

  async function fpReload() {
    if (!st.el) return;
    st.el.innerHTML = window.skeletonHtml('cards');
    try { await fpLoad(); fpForgetEdits(); fpPaint(); } catch (e) { st.el.innerHTML = '<div class="empty-state"><p>' + escHtml((e && e.message) || String(e)) + '</p><button type="button" class="btn-secondary btn-sm" data-act="reload">Retry</button></div>'; fpBind(); }
  }

  // Read one family's form -> { options, size, invalid:[labels] }. Existing derivation notes are kept; a figure the user changed is marked "entered".
  function fpCollect(fid) {
    var F = fpFams(), fam = F.families[fid];
    var doc = st.docs[fid] || null;
    var before = fpCells(fam, doc);
    var beforeBy = {};
    before.forEach(function (c) { beforeBy[c.group + '|' + c.value] = c; });
    var options = {}, invalid = [];
    var card = st.el.querySelector('.fp-card[data-fid="' + fid + '"]');
    var size = { perW100: null, confidence: '', derivation: '' };
    var inputs = card ? [].slice.call(card.querySelectorAll('.fp-in')) : [];
    var cellsIn = {};
    inputs.forEach(function (inp) {
      var g = inp.getAttribute('data-g'), v = inp.getAttribute('data-v'), k = inp.getAttribute('data-k');
      var n = (inp.validity && inp.validity.badInput) ? NaN : fpNum(inp.value);       // a number box holding unreadable text reports an empty value: that is not "blank"
      if (typeof n === 'number' && isNaN(n)) { invalid.push((g === 'size' ? 'Length' : g) + ' / ' + v); inp.setAttribute('aria-invalid', 'true'); return; }
      inp.removeAttribute('aria-invalid');
      var key = g + '|' + v;
      cellsIn[key] = cellsIn[key] || { g: g, v: v, flat: null, perW100: null };
      cellsIn[key][k] = n;
    });
    Object.keys(cellsIn).forEach(function (key) {
      var c = cellsIn[key];
      if (c.g === 'size') {
        var s0 = fpSizeCell(fam, doc);
        var changedS = c.perW100 !== s0.perW100;
        size = { perW100: c.perW100, confidence: c.perW100 === null ? 'blank' : (changedS ? 'entered' : (s0.confidence || 'entered')), derivation: fpTrim(s0.derivation, 600) };
        return;
      }
      var b = beforeBy[key] || {};
      var changed = c.flat !== b.flat || c.perW100 !== b.perW100;
      options[c.g] = options[c.g] || {};
      options[c.g][c.v] = { flat: c.flat, perW100: c.perW100, confidence: c.flat === null ? 'blank' : (changed ? 'entered' : (b.confidence || 'entered')), derivation: fpTrim(b.derivation || '', 600) };
    });
    return { options: options, size: size, invalid: invalid };
  }

  async function fpSave(fid) {
    if (!fpCanEdit()) return;
    var F = fpFams();
    var r = fpCollect(fid);
    if (r.invalid.length) { Notifs.showToast('Some amounts are not valid numbers: ' + r.invalid.slice(0, 3).join(', '), 'error'); return; }
    var a = fpActor();
    var FV = firebase.firestore.FieldValue;
    var notesEl = st.el.querySelector('.fp-notes[data-fid="' + fid + '"]');
    var body = {
      familyId: fid, schemaVersion: F.version, approved: false, approvedBy: null, approvedByName: null, approvedAt: null,
      options: r.options, size: r.size, notes: fpTrim(notesEl ? notesEl.value : (st.docs[fid] && st.docs[fid].notes) || '', 1000),
      updatedAt: FV.serverTimestamp(), updatedBy: a.uid, updatedByName: a.name
    };
    var ref = db.collection('product_pricing').doc(fid);
    var seen = st.docs[fid] ? fpFigures(st.docs[fid]) : null;
    try {
      // A save replaces the whole sheet, so it is only valid for the figures the editor STARTED from: inside one transaction the stored figures are compared with
      // those, and a sheet someone else saved (or created, or removed) in the meantime is NOT overwritten — the screen shows theirs and the editor re-enters.
      await db.runTransaction(async function (tx) {
        var cur = await tx.get(ref);
        var now = cur.exists ? fpFigures(cur.data()) : null;
        if (now !== seen) { var stale = new Error('stale'); stale.fpStale = true; stale.fresh = cur.exists ? cur.data() : null; throw stale; }
        tx.set(ref, body);
      });
      window.logAudit && window.logAudit('update', 'product_pricing', fid, { approved: false });
      var snap = await ref.get();
      st.docs[fid] = snap.exists ? snap.data() : null;
      fpForgetEdits(fid);
      Notifs.showToast('Saved — approve it again to use it in the public estimate', 'success');
      fpPaint();
    } catch (e) {
      if (e && e.fpStale) {
        if (e.fresh) st.docs[fid] = e.fresh; else delete st.docs[fid];
        fpForgetEdits(fid); st.open[fid] = true;
        fpPaint();
        Notifs.showToast('Someone saved this sheet while you were editing it. Nothing was saved — the figures on screen are now theirs; enter your changes again if they still apply.', 'error');
        return;
      }
      Notifs.showToast('Could not save: ' + ((e && e.message) || e), 'error');
    }
  }

  async function fpApprove(fid) {
    if (!fpCanEdit()) return;
    if (st.dirty[fid]) { Notifs.showToast('Save your changes first, then approve', 'error'); return; }
    var F = fpFams(), fam = F.families[fid];
    var counts = fpCounts(fam, st.docs[fid] || null);
    var blanks = counts.total - counts.filled;
    var ok = await window.confirmDialog({
      title: 'Approve ' + fam.label + ' pricing?',
      message: 'The public estimate will start using these amounts for ' + fam.label.toLowerCase() + ' lines.' + (blanks ? ' ' + blanks + ' option' + (blanks === 1 ? ' has' : 's have') + ' no amount yet: lines that use ' + (blanks === 1 ? 'it' : 'them') + ' stay "priced after review".' : ''),
      confirmLabel: 'Approve'
    });
    if (!ok) return;
    var a = fpActor();
    var FV = firebase.firestore.FieldValue;
    var ref = db.collection('product_pricing').doc(fid);
    var seen = fpFigures(st.docs[fid]);
    try {
      // The approval is only valid for the figures the approver was LOOKING AT: inside one transaction the stored figures are compared with those, and a
      // sheet someone else saved (or removed) in the meantime is NOT approved — the screen shows the new figures and asks again.
      await db.runTransaction(async function (tx) {
        var cur = await tx.get(ref);
        if (!cur.exists || fpFigures(cur.data()) !== seen) { var stale = new Error('stale'); stale.fpStale = true; stale.fresh = cur.exists ? cur.data() : null; throw stale; }
        tx.update(ref, { approved: true, approvedBy: a.uid, approvedByName: a.name, approvedAt: FV.serverTimestamp(), schemaVersion: F.version, updatedAt: FV.serverTimestamp(), updatedBy: a.uid, updatedByName: a.name });
      });
      window.logAudit && window.logAudit('update', 'product_pricing', fid, { approved: true });
      var snap = await ref.get();
      st.docs[fid] = snap.exists ? snap.data() : st.docs[fid];
      Notifs.showToast(fam.label + ' pricing approved', 'success');
      fpPaint();
    } catch (e) {
      if (e && e.fpStale) {
        if (e.fresh) st.docs[fid] = e.fresh; else delete st.docs[fid];
        fpForgetEdits(fid); st.open[fid] = true;
        fpPaint();
        Notifs.showToast('Someone changed this sheet while you were looking at it. Nothing was approved — the figures on screen are now the new ones; check them, then approve again.', 'error');
        return;
      }
      Notifs.showToast('Could not approve: ' + ((e && e.message) || e), 'error');
    }
  }

  async function fpUnapprove(fid) {
    if (!fpCanEdit()) return;
    var fam = fpFams().families[fid];
    var ok = await window.confirmDialog({ title: 'Unapprove ' + fam.label + ' pricing?', message: 'Every ' + fam.label.toLowerCase() + ' line in the public estimate becomes "priced after review" until you approve it again.', confirmLabel: 'Unapprove', danger: true });
    if (!ok) return;
    var a = fpActor();
    var FV = firebase.firestore.FieldValue;
    try {
      await db.collection('product_pricing').doc(fid).update({ approved: false, approvedBy: null, approvedByName: null, approvedAt: null, updatedAt: FV.serverTimestamp(), updatedBy: a.uid, updatedByName: a.name });
      window.logAudit && window.logAudit('update', 'product_pricing', fid, { approved: false });
      var snap = await db.collection('product_pricing').doc(fid).get();
      st.docs[fid] = snap.exists ? snap.data() : st.docs[fid];
      Notifs.showToast(fam.label + ' pricing unapproved', 'success');
      fpPaint();
    } catch (e) {
      Notifs.showToast('Could not unapprove: ' + ((e && e.message) || e), 'error');
    }
  }

  // ══════════════════════ TRY A CONFIGURATION ══════════════════════
  function fpTry(fid) {
    var F = fpFams(), fam = F.families[fid], PF = window.ProductFamilies;
    var box = st.el.querySelector('.fp-try[data-fid="' + fid + '"]');
    if (!box) return;
    var out = box.querySelector('.fp-try-out');
    var show = function (html) { out.innerHTML = html; };
    var prim = st.primaries[fid];
    if (!prim) { show('<span style="color:var(--danger,#b42318)">The base item ' + escHtml(fam.primary) + ' could not be read, so a price cannot be tried.</span>'); return; }
    var cfg = {};
    fam.groups.forEach(function (g) {
      var inp = box.querySelector('.fp-try-in[data-g="' + g.key + '"]');
      if (g.type === 'choice') cfg[g.key] = g.options[Number(inp.value)].v;
      else cfg[g.key] = String(inp.value || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    });
    var dims = {};
    [].slice.call(box.querySelectorAll('.fp-try-dim')).forEach(function (inp) { dims[inp.getAttribute('data-k')] = Number(inp.value); });
    var v = PF.validateLine(fam, cfg, dims, { staff: true });      // STAFF mode: Finance can price the staff-only 1.2 mm top plate too
    if (!v.ok) { show('<span style="color:var(--danger,#b42318)">' + v.errors.map(escHtml).join(' ') + '</span>'); return; }
    var r = fpCollect(fid);
    if (r.invalid.length) { show('<span style="color:var(--danger,#b42318)">Fix the amounts that are not numbers first.</span>'); return; }
    var sheet = { approved: true, schemaVersion: F.version, options: r.options, size: { perW100: r.size.perW100 } };
    var res = window.PricingCore.priceConfiguredItem(prim, fam, v.config, v.dims, sheet, st.constants || {}, { schemaVersion: F.version });
    if (res.priced) {
      var opts = res.deltas.reduce(function (n, d) { return n + d.amount; }, 0);
      show('<strong>' + escHtml(fpPeso(res.unitPrice)) + '</strong> each — base item ' + escHtml(fpPeso(res.base)) + ' at this size ' + (opts >= 0 ? '+' : '−') + ' options ' + escHtml(fpPeso(Math.abs(Math.round(opts)))) + '. <span style="color:var(--text-muted)">(' + escHtml(PF.summaryLine(fam, v.config, v.dims)) + ')</span>');
    } else if (res.reason === 'missing_input') {
      show('Priced after review — no amount entered yet for: ' + res.missing.map(escHtml).join('; ') + '.');
    } else if (res.reason === 'no_base_price') {
      show('The base item ' + escHtml(fam.primary) + ' has no list price, so nothing can be priced.');
    } else if (res.reason === 'size_basis') {
      show('Priced after review — this family\'s size basis no longer matches its base item ' + escHtml(fam.primary) + ' (a length rule was added to or removed from it).');
    } else if (res.reason === 'no_price') {
      show('The total is not above zero — check the amounts.');
    } else show('Priced after review.');
  }

  // ══════════════════════ IMPORT (President) ══════════════════════
  // Reads the PRIVATE seed the owner picks from his own computer. Validation is strict: a known family, a cell the family really has, numbers within the cap.
  // fpPlanImport(seed, existingDocs) -> { error } | { plan:[{ fid, fam, options, size, filled, total, replaces }], skipped }
  // PURE (no Firestore, no DOM): validates the seed file and turns it into the sheets to write. Strict: a known family, a cell the family really has,
  // finite numbers within the cap (anything else is blank), a known confidence label, a trimmed derivation note. Unknown cells are counted, never written.
  function fpPlanImport(seed, existing) {
    var F = fpFams(), PF = window.ProductFamilies;
    if (!seed || seed.kind !== 'barro-family-pricing-seed' || seed.version !== 1 || !seed.families || typeof seed.families !== 'object') return { error: 'That is not a family pricing seed file' };
    if (seed.schemaVersion !== F.version) return { error: 'This seed is for an older family definition (schema ' + seed.schemaVersion + ', the app is on ' + F.version + '). Generate it again.' };
    var plan = [], skipped = 0;
    F.order.forEach(function (fid) {
      var sf = Object.prototype.hasOwnProperty.call(seed.families, fid) ? seed.families[fid] : null;
      if (!sf || typeof sf !== 'object') return;
      var fam = F.families[fid];
      var valid = {};
      PF.cells(fam).forEach(function (c) { if (!c.baseline) valid[c.group + '|' + c.value] = true; });
      var options = {}, filled = 0, total = Object.keys(valid).length;
      var so = sf.options && typeof sf.options === 'object' ? sf.options : {};
      Object.keys(valid).forEach(function (key) {
        var parts = key.split('|'), g = parts[0], v = parts[1];
        var og = Object.prototype.hasOwnProperty.call(so, g) && so[g] && typeof so[g] === 'object' ? so[g] : null;
        var c = og && Object.prototype.hasOwnProperty.call(og, v) && og[v] && typeof og[v] === 'object' ? og[v] : null;
        var flat = c && typeof c.flat === 'number' && isFinite(c.flat) && Math.abs(c.flat) <= FP_MAX ? Math.round(c.flat) : null;
        var per = c && typeof c.perW100 === 'number' && isFinite(c.perW100) && Math.abs(c.perW100) <= FP_MAX ? Math.round(c.perW100) : null;
        var conf = c && typeof c.confidence === 'string' && Object.prototype.hasOwnProperty.call(FP_CONF, c.confidence) ? c.confidence : (flat === null ? 'blank' : 'low');
        options[g] = options[g] || {};
        options[g][v] = { flat: flat, perW100: flat === null ? null : per, confidence: flat === null ? 'blank' : conf, derivation: fpTrim(c && c.derivation, 600) };
        if (flat !== null) filled++;
      });
      Object.keys(so).forEach(function (g) { if (so[g] && typeof so[g] === 'object') Object.keys(so[g]).forEach(function (v) { if (!valid[g + '|' + v]) skipped++; }); });
      var size = { perW100: null, confidence: 'blank', derivation: '' };
      if (fam.sizeBasis === 'linear') {
        total++;
        var ss = sf.size && typeof sf.size === 'object' ? sf.size : {};
        if (typeof ss.perW100 === 'number' && isFinite(ss.perW100) && Math.abs(ss.perW100) <= FP_MAX) { size = { perW100: Math.round(ss.perW100), confidence: Object.prototype.hasOwnProperty.call(FP_CONF, ss.confidence) ? ss.confidence : 'low', derivation: fpTrim(ss.derivation, 600) }; filled++; }
        else size.derivation = fpTrim(ss.derivation, 600);
      }
      plan.push({ fid: fid, fam: fam, options: options, size: size, filled: filled, total: total, replaces: !!(existing && existing[fid]) });
    });
    return { plan: plan, skipped: skipped };
  }

  async function fpImportFile(input) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file || !fpIsPresident()) return;
    var F = fpFams();
    var seed;
    try { seed = JSON.parse(await file.text()); } catch (e) { Notifs.showToast('That file is not valid JSON', 'error'); return; }
    var planned = fpPlanImport(seed, st.docs);
    if (planned.error) { Notifs.showToast(planned.error, 'error'); return; }
    var plan = planned.plan, skipped = planned.skipped;
    if (!plan.length) { Notifs.showToast('The file has none of the product families', 'error'); return; }
    var lines = plan.map(function (p) { return p.fam.label + ': ' + p.filled + ' of ' + p.total + ' amounts' + (p.replaces ? ' (replaces the current sheet)' : ''); });
    var ok = await window.confirmDialog({
      title: 'Import derived starting values?',
      message: lines.join('\n') + '\n\nEvery imported sheet starts UNAPPROVED — nothing reaches the public estimate until you review it and approve it.' + (skipped ? '\n' + skipped + ' unknown value(s) in the file were ignored.' : ''),
      confirmLabel: 'Import'
    });
    if (!ok) return;
    var a = fpActor();
    var FV = firebase.firestore.FieldValue;
    try {
      for (var i = 0; i < plan.length; i++) {
        var p = plan[i];
        var prevNotes = st.docs[p.fid] && typeof st.docs[p.fid].notes === 'string' ? st.docs[p.fid].notes : '';
        await db.collection('product_pricing').doc(p.fid).set({
          familyId: p.fid, schemaVersion: F.version, approved: false, approvedBy: null, approvedByName: null, approvedAt: null,
          options: p.options, size: p.size, notes: prevNotes, importedFrom: fpTrim('derived seed ' + (seed.generatedAt || ''), 80),
          updatedAt: FV.serverTimestamp(), updatedBy: a.uid, updatedByName: a.name
        });
        window.logAudit && window.logAudit('update', 'product_pricing', p.fid, { imported: true, approved: false });
      }
      Notifs.showToast('Imported ' + plan.length + ' sheet' + (plan.length === 1 ? '' : 's') + ' — review each one, then approve', 'success');
      await fpLoad(); fpForgetEdits();
      plan.forEach(function (p) { st.open[p.fid] = true; });
      fpPaint();
    } catch (e) {
      Notifs.showToast('Import stopped: ' + ((e && e.message) || e), 'error');
    }
  }
})();
