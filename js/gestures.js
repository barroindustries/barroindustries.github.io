// ═══════════════════════════════════════════════════════
//  Barro Industries Operating System — Gestures (v12 WS42 Phase 12)
//  Clean two-edge swipe model (owner decision 2026-08-04):
//    • LEFT edge, dragged RIGHT  → open the nav drawer (window.openSidebar).
//    • RIGHT edge, dragged LEFT → back (Overlay.dismissTop() / history.back()).
//  Each edge owns exactly one action — a left-edge drag never triggers back,
//  a right-edge drag never opens the drawer. The old single-edge "swipe-back
//  OR open-drawer depending on context" behavior, and the full-surface
//  page-swipe-back (drag anywhere on a pushed page), are both retired: the
//  owner found the full-surface drag error-prone/"bad" — the two narrow edge
//  zones below cover the same need without hijacking ordinary scrolling or
//  in-page gestures (chat's own swipe-to-reply, inbox swipe-to-reveal, etc).
//
//  Ground rules honored:
//   • Drives window.Overlay (config.js) — NEVER a parallel stack. Every "back"
//     action here ends in Overlay.dismissTop() or history.back(), exactly like
//     a tap on a back button / X / Escape already does.
//   • Disabled entirely on pointer:fine devices (mouse/trackpad primary).
//   • Disabled inside horizontally-scrollable widgets ([data-hscroll], .table-scroll,
//     .table-wrap) and inside inputs/textarea/select/contenteditable.
//   • touchmove is non-passive ONLY while an active drag is in progress, and only
//     for the specific gesture being tracked (24px edge strip, or a sheet handle).
//   • transform/opacity only — no layout-thrashing properties are animated.
//   • No new libraries; vanilla DOM APIs only.
// ═══════════════════════════════════════════════════════
(function () {
  'use strict';

  const EDGE_ZONE   = 24;   // px from either screen edge that arms its edge gesture
  const EDGE_DX_ARM = 24;  // v14 accidental-touch retune: 16→24   // px of horizontal travel before we decide this is a swipe, not a scroll
  const EDGE_SLOPE  = 2.2; // v14 accidental-touch retune: 1.8→2.2  // |dx| must exceed this multiple of |dy| to arm
  const DX_THRESH   = 70;   // px horizontal drag to commit to "back" / "open drawer"
  const DY_ABORT    = 40;   // px vertical drift, measured at release, that still cancels a commit
  const PILL_W      = 34;   // matches the pill's fixed width/height below
  const SHEET_DX_MQ = '(max-width: 639px)'; // matches the WS42 Phase 10 bottom-sheet breakpoint
  const SHEET_DY_THRESH = 120; // px downward drag to commit to dismiss
  const SHEET_VELOCITY_THRESH = 0.6; // px/ms flick velocity that also commits

  let enabled = true;

  function pointerIsFine() {
    return !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches);
  }
  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function viewportWidth() {
    return window.innerWidth || document.documentElement.clientWidth || 0;
  }
  function insideHScroll(el) {
    // .table-wrap is the class the app's scrollable tables ACTUALLY use —
    // .table-scroll matched nothing, so edge-swipe hijacked table scrolling.
    return !!(el && el.closest && el.closest('[data-hscroll], .table-scroll, .table-wrap'));
  }
  // Shared exclusion for both edges — never arm inside a horizontally
  // scrollable widget or a text-entry field (a touch starting there is
  // input, not navigation).
  function edgeExcluded(el) {
    if (insideHScroll(el)) return true;
    if (el && el.closest && el.closest('input, textarea, select, [contenteditable]')) return true;
    return false;
  }

  // v13 Phase 105 / gestures.js — the mobile off-canvas drawer only exists
  // (has a working CSS .open transform) at the <=768px tier; the 769-819px
  // and 820-1023px tablet tiers keep #sidebar permanently off-canvas or as a
  // persistent icon rail with no matching .open rule. Gating left-edge-open
  // on this avoids a real bug: calling openSidebar() at those wider tiers
  // still shows the #sidebar-overlay scrim (it toggles unconditionally) with
  // no sidebar visibly sliding in behind it, i.e. a "phantom darken" with no
  // visible cause.
  function isMobileSidebarViewport() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
  }
  function sidebarIsOpen() {
    const sidebar = document.getElementById('sidebar');
    return !!(sidebar && sidebar.classList.contains('open'));
  }

  // ── Shared chevron-pill affordance (single reused DOM node, transform-only) ──
  // Glyph flips per edge so the affordance reads correctly: a right-pointing
  // chevron for "this opens something" (left edge), a left-pointing chevron
  // for "this goes back" (right edge, the traditional back-swipe glyph).
  const GLYPH_OPEN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
  const GLYPH_BACK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
  let pillEl = null;
  function getPill() {
    if (pillEl) return pillEl;
    pillEl = document.createElement('div');
    pillEl.id = 'gesture-back-pill';
    pillEl.setAttribute('aria-hidden', 'true');
    pillEl.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'z-index:var(--z-toast, 9990)',
      'width:34px', 'height:34px', 'border-radius:50%',
      'background:var(--surface,#1a1d21)', 'border:1px solid var(--border,rgba(255,255,255,.12))',
      'box-shadow:var(--sh-lg,0 8px 24px rgba(0,0,0,.35))',
      'display:flex', 'align-items:center', 'justify-content:center',
      'color:var(--text,#fff)', 'opacity:0', 'pointer-events:none',
      'will-change:transform,opacity',
      'transform:translate3d(-40px,0,0) scale(0.8)'
    ].join(';');
    pillEl.innerHTML = GLYPH_BACK;
    document.body.appendChild(pillEl);
    return pillEl;
  }
  function setPillGlyph(side) {
    const p = getPill();
    if (p.dataset.side === side) return;
    p.dataset.side = side;
    p.innerHTML = side === 'left' ? GLYPH_OPEN : GLYPH_BACK;
  }
  function movePill(x, y, opacity) {
    const p = getPill();
    p.style.transition = 'none';
    p.style.transform = 'translate3d(' + Math.round(x) + 'px,' + Math.round(y - 17) + 'px,0) scale(1)';
    p.style.opacity = String(opacity);
  }
  function retractPill(commit, side) {
    const p = getPill();
    const vw = viewportWidth();
    const lastY = parseFloat(p.style.transform.split(',')[1]) || 0;
    p.style.transition = reducedMotion() ? 'none' : 'transform 180ms ease, opacity 180ms ease';
    p.style.opacity = '0';
    if (side === 'right') {
      p.style.transform = commit
        ? 'translate3d(' + Math.max(0, vw - 60 - PILL_W) + 'px,' + lastY + 'px,0) scale(1)'
        : 'translate3d(' + (vw + 40) + 'px,0,0) scale(0.8)';
    } else {
      p.style.transform = commit
        ? 'translate3d(60px,' + lastY + 'px,0) scale(1)'
        : 'translate3d(-40px,0,0) scale(0.8)';
    }
  }

  // v13 Phase 64 / v15 two-edge rework — sole owner of the edge-swipe
  // gestures (the old app.js initSidebarSwipe open-tracker was removed
  // earlier to stop two listeners racing on the same gesture; this file
  // remains the only place that arms either edge). Each edge commits to
  // exactly one action:
  //   LEFT edge, dragged RIGHT  → window.openSidebar() (mobile off-canvas
  //     drawer tier only — see isMobileSidebarViewport() above). Never
  //     touches Overlay/back.
  //   RIGHT edge, dragged LEFT  → doBack(): dismissTop() if the Overlay
  //     stack has anything on it (a pushed page, modal, drawer, or the
  //     sidebar itself if it's open — openSidebar() pushes a 'sidebar'
  //     entry, so right-edge-back also closes an open drawer), else
  //     history.back().
  function doOpenDrawer() {
    if (typeof window.openSidebar === 'function') window.openSidebar();
  }
  function doBack() {
    if (window.Overlay && window.Overlay.isOpen()) {
      window.Overlay.dismissTop();
    } else {
      history.back();
    }
  }

  let edge = null; // { side: 'left'|'right', startX, startY, startTime, tracking, armed, lastX, lastY }

  function edgeTouchStart(e) {
    if (!enabled || pointerIsFine()) return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const vw = viewportWidth();
    let side = null;
    if (t.clientX <= EDGE_ZONE) side = 'left';
    else if (vw && t.clientX >= vw - EDGE_ZONE) side = 'right';
    if (!side) return;
    if (edgeExcluded(e.target)) return;
    if (side === 'left') {
      // Nothing off-canvas to open at this viewport tier, or already open —
      // don't arm at all (no pill, no-op), rather than fire a gesture that
      // silently does nothing at release.
      if (!isMobileSidebarViewport() || sidebarIsOpen()) return;
      // gesture-conflict fix — chat's own swipe-RIGHT-to-reply is bound to
      // .ms-row[data-mid] via delegation on .messenger-body, and that panel's
      // padding (16px 12px, see css/styles.css) is thinner than our 24px edge
      // zone: a "theirs" row's hit-box starts at ~12px, well inside our left
      // strip. Both gestures arm on the SAME rightward drag there, so leave
      // this zone to chat's reply-swipe entirely — it never competes with the
      // RIGHT edge (back arms on leftward drags only, which chat's swipe
      // always aborts), so only the left/open side needs this carve-out.
      if (e.target && e.target.closest && e.target.closest('.messenger-body')) return;
    } else {
      // gesture-conflict fix — the chat inbox's own swipe-LEFT-to-reveal
      // (Pin/Mute/Archive, chat.js _onInboxSwipeStart/Move) is bound to
      // .chat-inbox-row, which spans the full width of its container; the
      // row's right edge can sit inside our 24px right-edge strip. Both
      // gestures arm on the SAME leftward drag there. Carve out only the row
      // itself, not the surrounding page — back-swipe from the rest of the
      // inbox screen (headers, empty gutters, the outer few px of this same
      // zone past the row's own edge) still works.
      if (e.target && e.target.closest && e.target.closest('.chat-inbox-row, .ms-inbox-row-wrap')) return;
    }
    edge = { side, startX: t.clientX, startY: t.clientY, startTime: Date.now(), tracking: true, armed: false, lastX: t.clientX, lastY: t.clientY };
    document.addEventListener('touchmove', edgeTouchMove, { passive: false });
    document.addEventListener('touchend', edgeTouchEnd, { passive: true });
    document.addEventListener('touchcancel', edgeTouchCancel, { passive: true });
  }
  // v14 mobile-shell batch — armed the same way pageTouchMove used to be:
  // wait for EDGE_DX_ARM px of travel before deciding, then require the drag
  // to clear EDGE_SLOPE×|dy| to call it horizontal AND moving in the one
  // direction this edge cares about (rightward for left, leftward for
  // right). Anything else (wrong direction, or vertical drift wins) is a
  // scroll, and this listener steps out of its way for the rest of the touch.
  function edgeTouchMove(e) {
    if (!edge || !edge.tracking) return;
    const t = e.touches[0];
    const dx = t.clientX - edge.startX;
    const dy = t.clientY - edge.startY;
    edge.lastX = t.clientX; edge.lastY = t.clientY;
    if (!edge.armed) {
      if (Math.abs(dx) < EDGE_DX_ARM) return;                            // not enough travel to decide yet
      const wantsDir = edge.side === 'left' ? dx > 0 : dx < 0;
      if (!wantsDir || Math.abs(dx) < EDGE_SLOPE * Math.abs(dy)) {       // wrong direction, or vertical drift wins — it's a scroll
        edge.tracking = false;
        retractPill(false, edge.side);
        return;
      }
      edge.armed = true;
      setPillGlyph(edge.side);
    }
    e.preventDefault(); // scoped to this active edge-drag only, and only once armed
    const vw = viewportWidth();
    if (edge.side === 'left') {
      const followX = Math.min(dx * 0.6, 90);
      movePill(followX, t.clientY, Math.min(dx / DX_THRESH, 1));
    } else {
      const adx = Math.abs(dx);
      const followX = vw - PILL_W - Math.min(adx * 0.6, 90);
      movePill(followX, t.clientY, Math.min(adx / DX_THRESH, 1));
    }
  }
  function edgeTouchEnd() {
    cleanupEdgeListeners();
    if (!edge) return;
    const side = edge.side;
    const dx = edge.lastX - edge.startX;
    const dy = edge.lastY - edge.startY;
    const committed = edge.armed && Math.abs(dy) < DY_ABORT &&
      (side === 'left' ? dx > DX_THRESH : dx < -DX_THRESH);
    retractPill(committed, side);
    if (committed) {
      if (side === 'left') doOpenDrawer(); else doBack();
    }
    edge = null;
  }
  function edgeTouchCancel() {
    cleanupEdgeListeners();
    retractPill(false, edge ? edge.side : 'left');
    edge = null;
  }
  function cleanupEdgeListeners() {
    document.removeEventListener('touchmove', edgeTouchMove, { passive: false });
    document.removeEventListener('touchend', edgeTouchEnd, { passive: true });
    document.removeEventListener('touchcancel', edgeTouchCancel, { passive: true });
  }

  // ── Sheet swipe-dismiss (mobile bottom sheets — .drawer ONLY) ────────────
  // v14 one-window pass (owner decision 2026-08-05): `.modal-box` was REMOVED
  // from this gesture. Rationale — at the phone tier `.modal-box` is styled as
  // a FULL-COVER opaque window (see the ≤640px block in css/styles.css), which
  // makes it visually indistinguishable from a pushed `.page-panel`. But the
  // two obeyed different physics: you could grab a modal's header, drag it
  // down 120px and watch the "window" slide off the bottom like a sheet, while
  // doing the exact same thing on a pushed page did nothing at all. Same
  // visual object, two different ways to leave it — the "redundancies" the
  // owner called out. Every full-cover window now leaves the SAME single way:
  // Back (#nav-back-btn / .page-panel-back / a close button / Escape /
  // right-edge-swipe → Overlay.dismissTop()). No drag-dismiss on windows.
  //
  // `.drawer` (#profile-drawer) intentionally KEEPS its drag: the owner chose
  // to keep drawers as slide-over surfaces, explicitly outside the window
  // model, so the handle lookup below is narrowed rather than deleted.
  //
  // Removing `.modal-box` cannot strand a half-applied transform on a modal:
  // the transform this gesture writes is an INLINE style set only after
  // sheetTouchStart() has already accepted an element, and sheetTouchStart()
  // can no longer accept a `.modal-box` at all — so no modal ever enters the
  // tracked state, and there is no code path left that writes to one. (Inline
  // styles from a previous page load don't survive: modals are re-rendered
  // into fresh DOM, and the old transform died with the old node.)
  let sheet = null; // { el, startY, lastDy, startTime } — el is always a `.drawer`

  function sheetHandleEl(target) {
    const header = target && target.closest && target.closest('.drawer-header');
    if (!header) return null;
    if (!(window.matchMedia && window.matchMedia(SHEET_DX_MQ).matches)) return null;
    const box = header.closest('.drawer');
    return box || null;
  }

  function sheetTouchStart(e) {
    if (!enabled || pointerIsFine()) return;
    if (e.touches.length !== 1) return;
    if (insideHScroll(e.target)) return;
    const box = sheetHandleEl(e.target);
    if (!box) return;
    const t = e.touches[0];
    sheet = { el: box, startY: t.clientY, lastDy: 0, startTime: Date.now() };
    document.addEventListener('touchmove', sheetTouchMove, { passive: false });
    document.addEventListener('touchend', sheetTouchEnd, { passive: true });
    document.addEventListener('touchcancel', sheetTouchCancel, { passive: true });
  }
  function sheetTouchMove(e) {
    if (!sheet) return;
    const t = e.touches[0];
    const dy = t.clientY - sheet.startY;
    if (dy <= 0) return; // only a downward drag dismisses; ignore upward
    e.preventDefault();
    sheet.lastDy = dy;
    sheet.el.style.transition = 'none';
    sheet.el.style.transform = 'translate3d(0,' + dy + 'px,0)';
  }
  function sheetTouchEnd() {
    cleanupSheetListeners();
    if (!sheet) return;
    const el = sheet.el;
    const dt = Math.max(1, Date.now() - sheet.startTime);
    const velocity = sheet.lastDy / dt;
    const commit = sheet.lastDy > SHEET_DY_THRESH || velocity > SHEET_VELOCITY_THRESH;
    const fastTransition = reducedMotion() ? 'none' : 'transform 160ms ease-in';
    const springTransition = reducedMotion() ? 'none' : 'transform 220ms cubic-bezier(.34,1.56,.64,1)';
    if (commit) {
      el.style.transition = fastTransition;
      el.style.transform = 'translate3d(0,100%,0)';
      setTimeout(() => {
        el.style.transition = ''; el.style.transform = '';
        doBack();
      }, reducedMotion() ? 0 : 160);
    } else {
      el.style.transition = springTransition;
      el.style.transform = 'translate3d(0,0,0)';
      setTimeout(() => { el.style.transition = ''; el.style.transform = ''; }, reducedMotion() ? 0 : 220);
    }
    sheet = null;
  }
  function sheetTouchCancel() {
    cleanupSheetListeners();
    if (sheet) {
      sheet.el.style.transition = reducedMotion() ? 'none' : 'transform 220ms ease';
      sheet.el.style.transform = '';
      setTimeout(() => { sheet.el.style.transition = ''; }, reducedMotion() ? 0 : 220);
    }
    sheet = null;
  }
  function cleanupSheetListeners() {
    document.removeEventListener('touchmove', sheetTouchMove, { passive: false });
    document.removeEventListener('touchend', sheetTouchEnd, { passive: true });
    document.removeEventListener('touchcancel', sheetTouchCancel, { passive: true });
  }

  // Full-surface page-swipe-back (v14 Batch1 1d) — REMOVED (owner decision
  // 2026-08-04). It armed a horizontal pan starting ANYWHERE on a pushed
  // page's panel, which the owner found error-prone ("bad") in practice —
  // easy to trigger by accident while just interacting with page content,
  // and it needed a growing pile of per-widget exclusions (messenger-body,
  // messenger-input-row, any horizontally-scrollable element) to stay out of
  // other gestures' way. The clean two-edge model below covers the same
  // need: RIGHT-edge-drag-left already reaches Overlay.dismissTop() for a
  // pushed page from anywhere on the panel's own right edge, same as it does
  // for every other overlay/modal/drawer.

  // ── Root listeners (always attached; each gesture gates itself internally
  //    on `enabled` + pointer:fine so enable()/disable() need no re-wiring) ──
  // Owner decision (2026-08-04): ALL swipe navigation removed. The edge
  // swipe-back / swipe-open-drawer fought iOS's own edge gestures (iOS 16.4+
  // installed PWAs own the screen edges for back/forward), and the sheet
  // swipe-dismiss is redundant with every sheet's close button. Navigation is
  // now BUTTON-ONLY: the top-left back button (#nav-back-btn), each pushed
  // page's own back arrow (.page-panel-back), and modal/sheet close buttons.
  // Listeners intentionally NOT attached (window.Gestures.enable/disable kept
  // for API stability). Was: edgeTouchStart + sheetTouchStart on touchstart.
  // document.addEventListener('touchstart', edgeTouchStart, { passive: true });
  // document.addEventListener('touchstart', sheetTouchStart, { passive: true });

  window.Gestures = {
    enable() { enabled = true; },
    disable() { enabled = false; }
  };
})();
