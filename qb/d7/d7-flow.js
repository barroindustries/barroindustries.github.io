/* ==============================================================================================================
   qb/d7/d7-flow.js: window.D7.flow.   Review, approval, the approval link, and the two screens of the configurators in the LIVE quote builder
   (specs/BK-LIVE-INTEGRATION-SPEC-2026-11-19.md sections 1.3, 3.4, 5 packet C).   REWRITTEN SMALL from the D7 prototype's d7/d7-flow.js: the prototype's "local parent" (the stub, the token approval page, Filed & drafts,
   the prototype bar, the role switcher, the sample quote) is gone. The live flow is kept: QUOTE_APPROVAL_REQUESTED -> the bridge in js/app.js writes the quote as pending_approval, an approval_requests doc and a push to the
   President -> he opens Approvals in the ops app -> Review / Approve / Return. This file only decides WHEN approval is required, and shows the link to send.

   HOOKS (D7.h('flow.<name>'), called by quote-builder-v2.html)
     approvalReason()            '' when the quote can be filed by this person, else why it must go to the President (spec 1.3 item 1: a line needs review / the quote sells below its standard total /
                                 the office setting approveAll).  The President is never forced.  While the approval he gave the quote still covers it (spec 1.3 item 3) nothing is asked again.
                                 The pure decision is KCRules.approvalRequired; this file only collects its inputs and words the answer.
     reviewReason()              '' or "N line(s) need review: #3 Title (reason)."   (the review part of the sentence above)
     markAllReviewed()           President / Operations (KC.can('review')): mark every line that needs review as reviewed
     approvalCovers()            true while the approval the quote carries still covers it: KCRules.approvalCovers({ carry, net, standardTotal, costKnown })
     showApprovalLink(payload?)  the panel with the link to Approvals, a Copy link button and a ready-to-paste message; also reachable from the "Pending Approval" badge (no payload: it is rebuilt from the page)
     renderScreen()              redraw the open screen (Materials price list / Pricing settings) after a price, a setting or a role change
     boot()  syncButtons()       D7.boot(): the two top-bar buttons "Materials price list" and "Pricing settings" (drawn only while D7.live, and only for the President and Purchasing or when the quote is a KC one)
   ON KC: KC.setScreen(id)      'builder' | 'prices' | 'settings'.  A screen sets body[data-d7-screen] (d7-flow.css then hides .main), closes the kc panel and the website panel, and calls KC.renderPrices() /
                                KC.renderSettings() (qb/kc/admin-d7.js).  The hosts #scrPrices / #scrSettings are in the page; they are made here when they are missing.
   ============================================================================================================== */
(function () {
  'use strict';
  var D7 = window.D7;
  if (!D7 || !window.KC) return;
  var F = D7.flow = D7.flow || {};
  var KC = window.KC;

  /* ============================== small helpers ============================== */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function peso(n) { n = Number(n); if (!isFinite(n)) n = 0; return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function plural(n, one, many) { return n === 1 ? one : (many || one + 's'); }
  function builderOn() { try { return typeof d7On === 'function' && !!d7On(); } catch (e) { return false; } }
  function lineNo(idx) { try { return typeof lineNoOf === 'function' ? lineNoOf(idx) : null; } catch (e) { return null; } }
  function R() { return window.KCRules; }
  function live() { return window.KCLive || {}; }
  function who() { return live().userName || ((KC && KC.ROLES && KC.ROLES[D7.role()] && KC.ROLES[D7.role()].name) || ''); }
  function nowIso() { return new Date().toISOString(); }
  function val(id) { var e = $(id); return e && typeof e.value === 'string' ? e.value.trim() : ''; }

  /* ============================== review (spec 1.3 item 1, 3.2) ============================== */
  function reviewInfo(it) {                                        // {needs, reasons, reviewed} for one line
    var needs = it.needsReview, reasons = it.reviewReasons;
    if (needs === undefined && KC && KC.check && it.kcKind && it.cfg) {
      try { var v = KC.check(it.kcKind, it.cfg); reasons = v.review || []; needs = reasons.length > 0; } catch (e) { needs = false; }
    }
    if (it.kcKind === 'custom') { needs = true; if (!Array.isArray(reasons) || !reasons.length) reasons = ['custom item']; }
    return { needs: !!needs, reasons: Array.isArray(reasons) ? reasons : [], reviewed: it.reviewed || false };
  }
  /* the lines of the open quote that still need review, in table order */
  function reviewRows() {
    var rows = [];
    if (!builderOn() || typeof items === 'undefined') return rows;
    items.forEach(function (it, idx) {
      if (!it || !it.kcKind) return;
      var r = reviewInfo(it);
      if (!r.needs || r.reviewed) return;
      rows.push({ idx: idx, lineNo: lineNo(idx), title: String(it.name || ''), reasons: r.reasons.slice() });
    });
    rows.sort(function (a, b) { return (a.lineNo == null ? 1e6 : a.lineNo) - (b.lineNo == null ? 1e6 : b.lineNo) || a.idx - b.idx; });          // the order of the # column, not of the array
    return rows;
  }
  F.reviewRows = reviewRows;
  /* "N line(s) need review: #3 Title (reason), #5 Title." and then each reason that is a whole sentence, once ("Ducting is priced per job; check before sending.") */
  F.reviewReason = function () {
    var rows = reviewRows();
    if (!rows.length) return '';
    var sentences = [];
    var list = rows.map(function (r) {
      var shorts = r.reasons.filter(function (x) {
        x = String(x);
        if (/[.!?]$/.test(x)) { if (sentences.indexOf(x) < 0) sentences.push(x); return false; }
        return true;
      });
      return (r.lineNo ? '#' + r.lineNo + ' ' : '') + (r.title || 'line') + (shorts.length ? ' (' + shorts.join(', ') + ')' : '');
    });
    return rows.length + ' line(s) need review: ' + list.join(', ') + '.' + (sentences.length ? ' ' + sentences.join(' ') : '');
  };
  F.markAllReviewed = function () {                                // the "Mark all reviewed" button (shown to President / Operations only)
    if (!KC || !KC.can || !KC.can('review')) return;
    var rows = reviewRows();
    if (!rows.length) return;
    rows.forEach(function (r) {
      var it = items[r.idx];
      D7.h('adapter.markReviewed', r.idx, true, true);             // quiet: one save and one redraw for all of them
      if (it && !it.reviewed) { it.reviewed = who() || true; it.reviewedAt = nowIso(); }      // the adapter is optional: the flag is the contract
    });
    try { saveToStorage(); } catch (e) { /* ignore */ }
    try { renderItems(); } catch (e) { /* ignore */ }
  };

  /* ============================== approval (spec 1.3) ============================== */
  /* the inputs of KCRules.approvalRequired, read from the open quote */
  function standard() { return D7.pricing && D7.pricing.standardInfo ? D7.pricing.standardInfo() : { net: 0, standardTotal: 0, costKnown: false }; }
  function coversWith(info) {
    if (!R() || !live().carry) return false;
    var carry = live().carry();
    if (!carry) return false;
    return !!R().approvalCovers({ carry: carry, net: info.net, standardTotal: info.standardTotal, costKnown: info.costKnown });
  }
  function approvalInputs() {
    var info = standard(), fl = live().flags || {};
    return { role: D7.role(), reviewOpen: reviewRows().length > 0, net: info.net, standardTotal: info.standardTotal, costKnown: info.costKnown,
      approvalBelowStandard: fl.approvalBelowStandard === 'tick' ? 'tick' : 'force', approveAll: fl.approveAll === true, covered: coversWith(info) };
  }
  F.approvalCovers = function () { return builderOn() ? coversWith(standard()) : false; };
  /* KCRules.approvalRequired -> { required, locked, reason, reasons: ['review' | 'below-standard' | 'approve-all'], preTick }.  This file words the codes; it never re-decides them. */
  F.approvalRequired = function () {                               // for the page and the tests
    if (!builderOn() || !R()) return { required: false, locked: false, reason: '', reasons: [], preTick: false };
    var r = R().approvalRequired(approvalInputs()) || {};
    return { required: !!r.required, locked: !!r.locked, reason: String(r.reason || ''), reasons: Array.isArray(r.reasons) ? r.reasons.slice() : [], preTick: !!r.preTick };
  };
  /* the setting approvalBelowStandard 'tick' never forces, it only pre-ticks the "send for approval" box when the quote sells below its standard total (the live below-floor tick) */
  F.approvalPreTick = function () { return F.approvalRequired().preTick; };
  F.approvalReason = function () {                                 // '' = nothing forces approval; else the sentence the Verify & File row shows
    var r = F.approvalRequired();
    if (!r.required) return '';
    var parts = [];
    if (r.reasons.indexOf('review') >= 0) parts.push(F.reviewReason() || 'A line needs review.');
    if (r.reasons.indexOf('below-standard') >= 0) parts.push('The quote sells below its standard price (list prices, and cost × 2 for the rest), so the President has to approve it.');
    if (r.reasons.indexOf('approve-all') >= 0) parts.push('Every quote needs the President’s approval.');
    return parts.filter(Boolean).join(' ') || (r.reason ? r.reason.charAt(0).toUpperCase() + r.reason.slice(1) + '.' : 'The President has to approve this quote.');
  };

  /* ============================== the modal (the approval link) ============================== */
  var modal = { opener: null };
  function ensureModal() {
    var m = $('d7Modal'); if (m) return m;
    m = document.createElement('div'); m.id = 'd7Modal'; m.className = 'd7-modal no-print'; m.hidden = true;
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'd7ModalTitle');
    m.innerHTML = '<div class="d7-modal-card" id="d7ModalCard" tabindex="-1"><div class="d7-modal-head"><h2 id="d7ModalTitle"></h2>'
      + '<button type="button" class="d7-x" data-d7="close" aria-label="Close">✕</button></div><div class="d7-modal-body" id="d7ModalBody"></div><div class="d7-modal-foot" id="d7ModalFoot"></div></div>';
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
    return m;
  }
  function openModal(title, bodyHtml, foot) {
    var m = ensureModal();
    $('d7ModalTitle').textContent = title;
    $('d7ModalBody').innerHTML = bodyHtml;
    var f = $('d7ModalFoot'); f.innerHTML = foot || ''; f.style.display = foot ? '' : 'none';
    if (m.hidden) modal.opener = document.activeElement;
    m.hidden = false;
    try { $('d7ModalCard').focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  function closeModal() {
    var m = $('d7Modal'); if (!m || m.hidden) return;
    m.hidden = true;
    try { if (modal.opener && modal.opener.focus && document.contains(modal.opener)) modal.opener.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  F.closeModal = closeModal;

  function copyText(text, btn) {
    var done = function (ok) { if (!btn) return; var old = btn.getAttribute('data-label') || btn.textContent; btn.setAttribute('data-label', old); btn.textContent = ok ? 'Copied ✓' : 'Select it and copy'; setTimeout(function () { btn.textContent = old; }, 1800); };
    var legacy = function () {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } document.body.removeChild(ta); done(ok);
    };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(function () { done(true); }, legacy); return; } } catch (e) { /* fall through */ }
    legacy();
  }
  /* the link every approval goes through: the Approvals page of the ops app.  The hash router of js/app.js (parseHash) deep-links #/approvals; no token, no new page (spec 1.3 item 2) */
  function approvalsLink() {
    var origin = '';
    try { origin = location.origin; } catch (e) { origin = ''; }
    if (!origin || origin === 'null') { try { origin = location.protocol + '//' + location.host; } catch (e) { origin = ''; } }
    return origin + '/#/approvals';
  }
  F.approvalsLink = approvalsLink;
  var lastSent = null;                                               // what the panel shows when it is reopened from the badge: { no, client, total, why }
  function sentFrom(payload) {
    var p = payload || {};
    var no = p.quoteNumber || val('quoteNo'), client = p.clientCompany || p.clientName || val('clientCompany') || val('clientName');
    var total = p.grandTotal != null ? p.grandTotal : (p.total != null ? p.total : null);
    if (total == null) { try { total = (typeof basisTotals === 'function' ? basisTotals() : computeTotals()).grand; } catch (e) { total = 0; } }
    return { no: no, client: client, total: total };
  }
  F.showApprovalLink = function (payload) {
    var s = payload ? sentFrom(payload) : (lastSent || sentFrom(null));
    if (payload) { s.why = F.approvalReason(); lastSent = s; }
    var link = approvalsLink();
    var msg = 'Quote ' + s.no + ' for ' + (s.client || 'the client') + ', ' + peso(s.total) + '. It needs your approval: ' + link;
    var body = '<div class="d7-row" style="margin-bottom:10px;align-items:center;justify-content:space-between"><span class="d7-big">' + esc(peso(s.total)) + '</span><span class="d7-status pending">⏳ Waiting for the President</span></div>'
      + '<dl class="d7-kv"><dt>Quote</dt><dd>' + esc(s.no) + '</dd><dt>Client</dt><dd>' + esc(s.client || '—') + '</dd>' + (s.why ? '<dt>Why</dt><dd>' + esc(s.why) + '</dd>' : '') + '</dl>'
      + '<label class="d7-lbl" for="d7LinkIn">Approval link</label><div class="d7-row"><input id="d7LinkIn" class="d7-link-in" readonly value="' + esc(link) + '" onfocus="this.select()">'
      + '<button type="button" class="d7-btn primary" data-d7="copy" data-target="d7LinkIn" id="d7CopyLink">Copy link</button></div>'
      + '<div class="d7-note">Send this link to the President by Messenger or Viber.</div>'
      + '<label class="d7-lbl" for="d7MsgIn">Ready to paste</label><div class="d7-row"><textarea id="d7MsgIn" class="d7-msg-in" readonly>' + esc(msg) + '</textarea></div>'
      + '<div class="d7-row" style="margin-top:6px"><button type="button" class="d7-btn" data-d7="copy" data-target="d7MsgIn">Copy message</button></div>';
    openModal('Approval link', body, '<button type="button" class="d7-btn" data-d7="close">Close</button>');
  };

  /* ============================== the two screens (Materials price list, Pricing settings) ============================== */
  var SCREENS = { builder: null, prices: 'scrPrices', settings: 'scrSettings' };
  var LABELS = { prices: '🧱 Materials price list', settings: '⚙ Pricing settings' };
  function curScreen() { return (KC && KC.S && KC.S.screen2) || 'builder'; }
  function ensureHost(id) {
    var el = $(id); if (el) return el;
    el = document.createElement('div'); el.id = id; el.hidden = true; el.className = 'd7-scr';
    var main = document.querySelector('.main');
    if (main && main.parentNode) main.parentNode.insertBefore(el, main); else document.body.appendChild(el);
    return el;
  }
  KC.setScreen = function (scr) {
    var S = KC.S;
    if (!(scr in SCREENS)) scr = 'builder';
    S.screen2 = scr;
    if (scr !== 'builder') {                                         // a screen closes the kc panel and the old website panel
      try { if (S.open && KC.closePanel) KC.closePanel(); } catch (err) { console.error('D7 flow: the panel did not close', err); }
      try { if (typeof cfgState !== 'undefined' && cfgState && typeof closeConfigurator === 'function') closeConfigurator({ silent: true }); } catch (err) { /* the old panel is optional */ }
      document.body.classList.remove('kc-sheet-open'); document.body.classList.remove('cfg-sheet-open');
    }
    Object.keys(SCREENS).forEach(function (x) {
      var id = SCREENS[x]; if (!id) return;
      var n = x === scr ? ensureHost(id) : $(id);
      if (n) { n.hidden = x !== scr; n.classList.add('d7-scr'); n.classList.toggle('d7-screen-open', x === scr); }
    });
    if (scr === 'builder') document.body.removeAttribute('data-d7-screen'); else document.body.setAttribute('data-d7-screen', scr);
    try {
      if (scr === 'prices' && KC.renderPrices) KC.renderPrices();
      else if (scr === 'settings' && KC.renderSettings) KC.renderSettings();
      else if (scr === 'builder') { if (KC.renderPanel) KC.renderPanel(); if (typeof renderItems === 'function') renderItems(); }
    } catch (err) { console.error('D7 flow: the screen did not draw', err); }
    F.syncButtons();
    try { window.scrollTo(0, 0); } catch (e) { /* no scroll */ }
  };
  F.setScreen = function (id) { KC.setScreen(id); };
  F.renderScreen = function () {                                     // after a price, a setting or a role change
    var s = curScreen();
    try {
      if (s === 'prices' && KC.renderPrices) KC.renderPrices();
      else if (s === 'settings' && KC.renderSettings) KC.renderSettings();
    } catch (e) { console.error('D7 flow: the open screen failed to redraw', e); }
    F.syncButtons();
  };

  /* the buttons exist in the DOM only when they are wanted, so a legacy builder is byte for byte today's: the feature is live (D7.live) AND the quote is a KC one, or the person is the President or Purchasing
     (the President flips the switch and imports the prices from Pricing settings even while the switch is off; Purchasing keeps the price list) */
  function wanted() {
    if (!D7.live) return false;
    if (builderOn()) return true;
    var r = D7.role();
    return r === 'president' || r === 'purchasing';
  }
  function btn(cls, id, label, screen) {
    var b = document.createElement('button'); b.type = 'button'; b.id = id; b.className = cls; b.setAttribute('data-d7', 'screen'); b.setAttribute('data-screen', screen); b.textContent = label;
    return b;
  }
  F.wantsButtons = wanted;
  F.syncButtons = function () {
    var bar = document.querySelector('.topbar-right'), sheet = $('mtbSheet'), want = wanted(), cur = curScreen();
    function put(host, anchor, make, id, label, screen) {
      var have = $(id);
      if (!want) { if (have && have.parentNode) have.parentNode.removeChild(have); return; }
      if (!have && host) { have = make(); anchor ? host.insertBefore(have, anchor) : host.appendChild(have); }
      if (have) { have.setAttribute('aria-pressed', String(cur === screen)); if (have.textContent !== label) have.textContent = label; }
    }
    if (bar) {
      var help = $('btnHelp');
      put(bar, help, function () { return btn('btn btn-outline no-print d7-topbtn', 'd7BtnPrices', LABELS.prices, 'prices'); }, 'd7BtnPrices', LABELS.prices, 'prices');
      put(bar, help, function () { return btn('btn btn-outline no-print d7-topbtn', 'd7BtnSettings', LABELS.settings, 'settings'); }, 'd7BtnSettings', LABELS.settings, 'settings');
      var back = $('d7BtnBack'), showBack = want && cur !== 'builder';
      if (showBack && !back) { back = btn('btn btn-outline no-print d7-topbtn', 'd7BtnBack', '← Quote builder', 'builder'); bar.insertBefore(back, bar.firstChild); }
      if (!showBack && back && back.parentNode) back.parentNode.removeChild(back);
    }
    if (sheet) {
      var first = sheet.querySelector('.mtb-divider');
      put(sheet, first, function () { return btn('mtb-row d7-mtbrow', 'd7MtbPrices', LABELS.prices, 'prices'); }, 'd7MtbPrices', LABELS.prices, 'prices');
      put(sheet, first, function () { return btn('mtb-row d7-mtbrow', 'd7MtbSettings', LABELS.settings, 'settings'); }, 'd7MtbSettings', LABELS.settings, 'settings');
    }
  };

  /* ============================== events ============================== */
  function onClick(e) {
    var t = e.target.closest && e.target.closest('[data-d7]'); if (!t) return;
    var act = t.getAttribute('data-d7'), ds = t.dataset || {};
    switch (act) {
      case 'screen':
        if (ds.screen === curScreen() && ds.screen !== 'builder') KC.setScreen('builder'); else KC.setScreen(ds.screen);      // pressing the open screen's button goes back to the quote
        try { if (t.closest('#mtbSheet') && typeof closeMobileSheet === 'function') closeMobileSheet(); } catch (err) { /* no sheet */ }
        break;
      case 'close': closeModal(); break;
      case 'copy': { var src = $(ds.target); if (src) copyText(src.value, t); break; }
      default: return;
    }
    if (t.tagName === 'A') e.preventDefault();
  }
  var wired = false;
  function wire() {
    if (wired) return; wired = true;
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var m = $('d7Modal'); if (m && !m.hidden) { closeModal(); e.stopPropagation(); } } });
  }
  F.boot = function () { wire(); F.syncButtons(); };
})();
