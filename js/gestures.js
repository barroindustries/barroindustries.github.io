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
  const DX_THRESH   = 70;   // px horizontal drag to commit to "back"
  const DY_ABORT    = 40;   // px vertical drift that aborts (treat as a scroll instead)
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
    return !!(el && el.closest && el.closest('[data-hscroll], .table-scroll'));
  }

  // ── Shared chevron-pill affordance (single reused DOM node, transform-only) ──
  let pillEl = null;
  function getPill() {
    if (pillEl) return pillEl;
    pillEl = document.createElement('div');
    pillEl.id = 'gesture-back-pill';
    pillEl.setAttribute('aria-hidden', 'true');
    pillEl.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'z-index:9998',
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

  function doBack() {
    if (window.Overlay && window.Overlay.isOpen()) window.Overlay.dismissTop();
    else history.back();
  }

  // ── Edge swipe-back ─────────────────────────────────────────────────────
  let edge = null; // { startX, startY, startTime, tracking }

  function edgeTouchStart(e) {
    if (!enabled || pointerIsFine()) return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX > EDGE_ZONE) return;
    if (insideHScroll(e.target)) return;
    edge = { startX: t.clientX, startY: t.clientY, startTime: Date.now(), tracking: true, lastX: t.clientX, lastY: t.clientY };
    document.addEventListener('touchmove', edgeTouchMove, { passive: false });
    document.addEventListener('touchend', edgeTouchEnd, { passive: true });
    document.addEventListener('touchcancel', edgeTouchCancel, { passive: true });
  }
  function edgeTouchMove(e) {
    if (!edge || !edge.tracking) return;
    const t = e.touches[0];
    const dx = t.clientX - edge.startX;
    const dy = t.clientY - edge.startY;
    if (Math.abs(dy) > DY_ABORT && dx < DX_THRESH) {
      // Vertical drift dominates — this is a scroll, not a back-swipe. Bail out
      // silently and let the page scroll normally from here on.
      edge.tracking = false;
      retractPill(false);
      return;
    }
    if (dx <= 0) return;
    e.preventDefault(); // scoped to this active edge-drag only
    edge.lastX = t.clientX; edge.lastY = t.clientY;
    const followX = Math.min(dx * 0.6, 90);
    movePill(followX, t.clientY, Math.min(dx / DX_THRESH, 1));
  }
  function edgeTouchEnd() {
    cleanupEdgeListeners();
    if (!edge) return;
    const dx = edge.lastX - edge.startX;
    const dy = edge.lastY - edge.startY;
    const committed = edge.tracking && dx > DX_THRESH && Math.abs(dy) < DY_ABORT;
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

  // ── Root listeners (always attached; each gesture gates itself internally
  //    on `enabled` + pointer:fine so enable()/disable() need no re-wiring) ──
  document.addEventListener('touchstart', edgeTouchStart, { passive: true });
  document.addEventListener('touchstart', sheetTouchStart, { passive: true });

  window.Gestures = {
    enable() { enabled = true; },
    disable() { enabled = false; }
  };
})();
