// ═══════════════════════════════════════════════════════
//  Barro Industries Operating System — Gestures (v12 WS42 Phase 12)
//  Edge swipe-back (Android/iPhone parity) + mobile-sheet swipe-dismiss.
//
//  Ground rules honored:
//   • Drives window.Overlay (config.js) — NEVER a parallel stack. Every "back"
//     action here ends in Overlay.dismissTop() or history.back(), exactly like
//     a tap on a back button / X / Escape already does.
//   • Disabled entirely on pointer:fine devices (mouse/trackpad primary).
//   • Disabled inside horizontally-scrollable widgets ([data-hscroll], .table-scroll).
//   • touchmove is non-passive ONLY while an active drag is in progress, and only
//     for the specific gesture being tracked (24px edge strip, or a sheet handle).
//   • transform/opacity only — no layout-thrashing properties are animated.
//   • No new libraries; vanilla DOM APIs only.
// ═══════════════════════════════════════════════════════
(function () {
  'use strict';

  const EDGE_ZONE   = 24;   // px from the left edge that arms edge swipe-back
  const EDGE_DX_ARM = 16;   // px of horizontal travel before we decide this is a swipe, not a scroll (v14 mobile-shell batch — was un-gated, see edgeTouchMove)
  const EDGE_SLOPE  = 1.8;  // |dx| must exceed this multiple of |dy| to arm (v14 mobile-shell batch — raised from an implicit ~1.75 floor)
  const DX_THRESH   = 70;   // px horizontal drag to commit to "back" / "open drawer"
  const DY_ABORT    = 40;   // px vertical drift, measured at release, that still cancels a commit
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
  function insideHScroll(el) {
    // .table-wrap is the class the app's scrollable tables ACTUALLY use —
    // .table-scroll matched nothing, so edge-swipe hijacked table scrolling.
    return !!(el && el.closest && el.closest('[data-hscroll], .table-scroll, .table-wrap'));
  }

  // ── Shared chevron-pill affordance (single reused DOM node, transform-only) ──
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
    pillEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
    document.body.appendChild(pillEl);
    return pillEl;
  }
  function movePill(x, y, opacity) {
    const p = getPill();
    p.style.transition = 'none';
    p.style.transform = 'translate3d(' + Math.round(x) + 'px,' + Math.round(y - 17) + 'px,0) scale(1)';
    p.style.opacity = String(opacity);
  }
  function retractPill(commit) {
    const p = getPill();
    p.style.transition = reducedMotion() ? 'none' : 'transform 180ms ease, opacity 180ms ease';
    p.style.opacity = '0';
    p.style.transform = commit
      ? 'translate3d(60px,' + (parseFloat(p.style.transform.split(',')[1]) || 0) + 'px,0) scale(1)'
      : 'translate3d(-40px,0,0) scale(0.8)';
  }

  // v13 Phase 64 — sole owner of the left-edge swipe gesture (the old
  // app.js initSidebarSwipe open-tracker was removed to stop two listeners
  // racing on the same gesture). Decision order at commit time:
  //   (a) an overlay/sheet/sidebar/pushed page is on top of the Overlay stack
  //       → dismiss it (this also covers closing an already-open mobile
  //       sidebar, since openSidebar() pushes a 'sidebar' entry onto the stack)
  //   (b) otherwise we're on the BASE page (Overlay stack empty) — on a
  //       mobile-sidebar viewport with the drawer closed, OPEN it (FB-style;
  //       owner decision 2026-08-03). Previously gated to
  //       window.currentPage==='dashboard' only, so the gesture fell through
  //       to history.back() on every other base page — removed, this now
  //       applies uniformly regardless of which page is showing.
  //   (c) otherwise (no off-canvas drawer at this viewport, e.g. the tablet
  //       rail tier) → history.back()
  function isMobileSidebarViewport() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
  }
  function sidebarIsOpen() {
    const sidebar = document.getElementById('sidebar');
    return !!(sidebar && sidebar.classList.contains('open'));
  }
  function doBack() {
    if (window.Overlay && window.Overlay.isOpen()) {
      window.Overlay.dismissTop();
    } else if (isMobileSidebarViewport() && !sidebarIsOpen()) {
      if (typeof window.openSidebar === 'function') window.openSidebar();
    } else {
      history.back();
    }
  }

  // ── Edge swipe-back / swipe-open-drawer ─────────────────────────────────
  let edge = null; // { startX, startY, startTime, tracking, armed, lastX, lastY }

  function edgeTouchStart(e) {
    if (!enabled || pointerIsFine()) return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX > EDGE_ZONE) return;
    if (insideHScroll(e.target)) return;
    edge = { startX: t.clientX, startY: t.clientY, startTime: Date.now(), tracking: true, armed: false, lastX: t.clientX, lastY: t.clientY };
    document.addEventListener('touchmove', edgeTouchMove, { passive: false });
    document.addEventListener('touchend', edgeTouchEnd, { passive: true });
    document.addEventListener('touchcancel', edgeTouchCancel, { passive: true });
  }
  // v14 mobile-shell batch — armed the same way pageTouchMove is below: wait
  // for EDGE_DX_ARM px of travel before deciding, then require the drag to
  // clear EDGE_SLOPE×|dy| to call it horizontal. Previously this called
  // e.preventDefault() on the very first rightward pixel with no minimum
  // travel or slope check, which could clip the start of a vertical scroll
  // that happened to begin inside the 24px edge strip.
  function edgeTouchMove(e) {
    if (!edge || !edge.tracking) return;
    const t = e.touches[0];
    const dx = t.clientX - edge.startX;
    const dy = t.clientY - edge.startY;
    edge.lastX = t.clientX; edge.lastY = t.clientY;
    if (!edge.armed) {
      if (Math.abs(dx) < EDGE_DX_ARM) return;                        // not enough travel to decide yet
      if (dx <= 0 || Math.abs(dx) < EDGE_SLOPE * Math.abs(dy)) {      // leftward, or vertical drift wins — it's a scroll
        edge.tracking = false;
        retractPill(false);
        return;
      }
      edge.armed = true;
    }
    e.preventDefault(); // scoped to this active edge-drag only, and only once armed
    const followX = Math.min(dx * 0.6, 90);
    movePill(followX, t.clientY, Math.min(dx / DX_THRESH, 1));
  }
  function edgeTouchEnd() {
    cleanupEdgeListeners();
    if (!edge) return;
    const dx = edge.lastX - edge.startX;
    const dy = edge.lastY - edge.startY;
    const committed = edge.armed && dx > DX_THRESH && Math.abs(dy) < DY_ABORT;
    retractPill(committed);
    if (committed) doBack();
    edge = null;
  }
  function edgeTouchCancel() {
    cleanupEdgeListeners();
    retractPill(false);
    edge = null;
  }
  function cleanupEdgeListeners() {
    document.removeEventListener('touchmove', edgeTouchMove, { passive: false });
    document.removeEventListener('touchend', edgeTouchEnd, { passive: true });
    document.removeEventListener('touchcancel', edgeTouchCancel, { passive: true });
  }

  // ── Sheet swipe-dismiss (mobile bottom sheets — modal-box / drawer) ──────
  let sheet = null; // { el, startY, lastDy, startTime }

  function sheetHandleEl(target) {
    const header = target && target.closest && target.closest('.modal-header, .drawer-header');
    if (!header) return null;
    if (!(window.matchMedia && window.matchMedia(SHEET_DX_MQ).matches)) return null;
    const box = header.closest('.modal-box, .drawer');
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

  // ── Full-surface swipe-back on pushed pages (v14 Batch1 1d) ───────────────
  // The 24px edge strip above only shows a decorative pill and defers to
  // history.back()/doBack() generically. A page opened via openPage (Overlay
  // kind 'page') additionally arms a horizontal pan starting ANYWHERE on its
  // panel — not modals, which stay dismissed via backdrop/Esc/Back only.
  // Starts inside the edge zone are left to edgeTouchStart above (untouched)
  // so the two gestures never race the same touch into two dismissals.
  const PAGE_DX_ARM          = 16;   // px before we commit to "this is horizontal" (v14 mobile-shell batch — raised from 12 so vertical scrolls never feel hijacked)
  const PAGE_SLOPE           = 1.8;  // |dx| must exceed this multiple of |dy| to arm (v14 mobile-shell batch — raised from 1.6)
  const PAGE_VELOCITY_THRESH = 0.5;  // px/ms flick velocity that also commits

  let pageSwipe = null; // { el, startX, startY, lastX, lastY, armed, startTime }

  function hasHOverflow(el) {
    let node = el;
    while (node && node !== document.body && node.nodeType === 1) {
      if (node.scrollWidth > node.clientWidth) {
        const cs = getComputedStyle(node);
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return true;
      }
      node = node.parentElement;
    }
    return false;
  }
  function pageSwipeExcluded(target) {
    if (insideHScroll(target)) return true;
    if (target && target.closest && target.closest('input, textarea, select, [contenteditable]')) return true;
    return hasHOverflow(target);
  }

  function pageTouchStart(e) {
    if (!enabled || pointerIsFine()) return;
    if (e.touches.length !== 1) return;
    if (!window.Overlay || window.Overlay.topKind() !== 'page') return;
    const el = window.Overlay.topEl && window.Overlay.topEl();
    if (!el) return;
    const t = e.touches[0];
    if (t.clientX <= EDGE_ZONE) return; // edge-zone starts stay edgeTouchStart's job
    if (!el.contains(e.target)) return;
    if (pageSwipeExcluded(e.target)) return;
    pageSwipe = { el, startX: t.clientX, startY: t.clientY, lastX: t.clientX, lastY: t.clientY, armed: false, startTime: Date.now() };
    document.addEventListener('touchmove', pageTouchMove, { passive: false });
    document.addEventListener('touchend', pageTouchEnd, { passive: true });
    document.addEventListener('touchcancel', pageTouchCancel, { passive: true });
  }
  function pageTouchMove(e) {
    if (!pageSwipe) return;
    const t = e.touches[0];
    const dx = t.clientX - pageSwipe.startX;
    const dy = t.clientY - pageSwipe.startY;
    pageSwipe.lastX = t.clientX; pageSwipe.lastY = t.clientY;
    if (!pageSwipe.armed) {
      if (Math.abs(dx) < PAGE_DX_ARM) return;                    // not enough travel to decide yet
      if (dx <= 0 || Math.abs(dx) < PAGE_SLOPE * Math.abs(dy)) {  // leftward, or vertical drift wins — it's a scroll
        pageTouchCancel();
        return;
      }
      pageSwipe.armed = true;
    }
    e.preventDefault(); // scoped to this active page-drag only
    if (!reducedMotion()) {
      pageSwipe.el.style.transition = 'none';
      pageSwipe.el.style.transform = 'translate3d(' + Math.max(0, dx) + 'px,0,0)';
    }
  }
  function pageTouchEnd() {
    cleanupPageListeners();
    if (!pageSwipe) return;
    const { el, armed } = pageSwipe;
    const dx = pageSwipe.lastX - pageSwipe.startX;
    const dt = Math.max(1, Date.now() - pageSwipe.startTime);
    const velocity = dx / dt;
    const vw = window.innerWidth || document.documentElement.clientWidth || 1;
    const commit = armed && dx > 0 && (dx > vw * 0.35 || velocity > PAGE_VELOCITY_THRESH);
    if (commit) {
      // Hand off to the normal close path — its own teardown animation takes
      // over, so just drop our live-drag inline styles rather than layering
      // a second exit animation on top.
      el.style.transition = '';
      el.style.transform = '';
      if (window.Overlay) window.Overlay.dismissTop();
    } else if (armed) {
      el.style.transition = reducedMotion() ? 'none' : 'transform 200ms cubic-bezier(.34,1.56,.64,1)';
      el.style.transform = 'translate3d(0,0,0)';
      setTimeout(() => { el.style.transition = ''; el.style.transform = ''; }, reducedMotion() ? 0 : 200);
    }
    pageSwipe = null;
  }
  function pageTouchCancel() {
    cleanupPageListeners();
    if (pageSwipe && pageSwipe.armed) {
      const el = pageSwipe.el;
      el.style.transition = reducedMotion() ? 'none' : 'transform 200ms ease';
      el.style.transform = 'translate3d(0,0,0)';
      setTimeout(() => { el.style.transition = ''; el.style.transform = ''; }, reducedMotion() ? 0 : 200);
    }
    pageSwipe = null;
  }
  function cleanupPageListeners() {
    document.removeEventListener('touchmove', pageTouchMove, { passive: false });
    document.removeEventListener('touchend', pageTouchEnd, { passive: true });
    document.removeEventListener('touchcancel', pageTouchCancel, { passive: true });
  }

  // ── Root listeners (always attached; each gesture gates itself internally
  //    on `enabled` + pointer:fine so enable()/disable() need no re-wiring) ──
  document.addEventListener('touchstart', edgeTouchStart, { passive: true });
  document.addEventListener('touchstart', sheetTouchStart, { passive: true });
  document.addEventListener('touchstart', pageTouchStart, { passive: true });

  window.Gestures = {
    enable() { enabled = true; },
    disable() { enabled = false; }
  };
})();
