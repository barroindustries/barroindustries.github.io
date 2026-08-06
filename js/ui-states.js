/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — UI STATES KIT (v13 WS-H, Phases 121-122)
   ui-states.js — one empty-state component + one loading/error/
   empty wrapper so no screen gets stuck on a spinner or fails
   silently (U-M5). Classic script — attaches to window only,
   no imports. Loaded after config.js (needs window.emojiIcon /
   window.escHtml at CALL time, not at parse time, so load order
   relative to config.js only matters for those two helpers).
═══════════════════════════════════════════════════ */
'use strict';

// ── renderEmptyState({icon, title, hint, action}) → html string ──
// Standard empty-state block, matches the pre-existing hand-rolled
// `.empty-state` markup exactly: icon div + h4 + optional p hint.
// action = optional {id, label} — renders a .btn-secondary button with
// that id. CONTRACT: the caller is responsible for binding a click
// listener to that id AFTER injecting the returned html into the DOM
// (this function only returns a string; it cannot bind anything itself).
window.renderEmptyState = function (opts) {
  opts = opts || {};
  var icon = opts.icon || '📄';
  var title = opts.title || 'Nothing here yet';
  var hint = opts.hint;
  var action = opts.action;
  var esc = window.escHtml || function (s) { return String(s == null ? '' : s); };
  var iconHtml = window.emojiIcon ? window.emojiIcon(icon, 44) : '';
  return (
    '<div class="empty-state">' +
      '<div class="empty-icon">' + iconHtml + '</div>' +
      '<h4>' + esc(title) + '</h4>' +
      (hint ? '<p>' + esc(hint) + '</p>' : '') +
      (action && action.id && action.label
        ? '<button type="button" class="btn-secondary btn-sm" id="' + esc(action.id) + '" style="margin-top:14px">' + esc(action.label) + '</button>'
        : '') +
    '</div>'
  );
};

// ── skeletonHtml(kind, n) → html string ──
// Single source of truth for skeleton loading markup (v14 B6). Wraps the
// CSS primitives in css/styles.css (.skl-text/.skl-row/.skl-card, Phase 128)
// into ready-to-inject blocks so no call site hand-rolls skeleton HTML.
// kind: 'rows' (default, list-item anatomy: leading avatar + 2 text lines,
//   matches task feed / notif items / approval rows / file rows) |
//   'cards' (KPI/dept/item card placeholders, wrapped in an auto-fill grid) |
//   'table' (tabular async screens: a .skl-row reused as 4 equal-flex
//   columns instead of avatar+lines — see .skl-row-cols in styles.css).
// n: how many rows/cards to render (default 4 for rows/table, 3 for cards).
// Pure string builder — safe to use in innerHTML sinks or via ${} inside
// template literals; contains no user data so it never needs escHtml().
window.skeletonHtml = function (kind, n) {
  if (kind === 'cards') {
    n = n || 3;
    var card = '<div class="skl-card"><div class="skl-text"></div><div class="skl-text" style="width:80%"></div><div class="skl-text" style="width:60%"></div></div>';
    return '<div class="skl-wrap skl-wrap-cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">' + card.repeat(n) + '</div>';
  }
  if (kind === 'table') {
    n = n || 4;
    var trow = '<div class="skl-row skl-row-cols"><div class="skl-text"></div><div class="skl-text"></div><div class="skl-text"></div><div class="skl-text"></div></div>';
    return '<div class="skl-wrap skl-wrap-table" style="display:flex;flex-direction:column;gap:8px">' + trow.repeat(n) + '</div>';
  }
  // default: 'rows'
  n = n || 4;
  var row = '<div class="skl-row"><div class="skl-row-avatar"></div><div class="skl-row-lines"><div class="skl-text" style="width:55%"></div><div class="skl-text skl-text-sm" style="width:30%"></div></div></div>';
  return '<div class="skl-wrap skl-wrap-rows" style="display:flex;flex-direction:column;gap:8px">' + row.repeat(n) + '</div>';
};

// ── withLoadingAndError(container, fetcher, renderer, opts) ──
// Standard fetch→render lifecycle: show a loading skeleton, await
// fetcher(), route to renderEmptyState() when emptyCheck(data) is true,
// otherwise call renderer(data); on any thrown/rejected error show an
// error block with a Retry button that is bound INTERNALLY (no id
// contract needed for retry — unlike renderEmptyState's action, this
// wrapper owns the whole container so it wires its own listener) and
// simply re-invokes withLoadingAndError with the exact same arguments.
// opts: { skeleton='rows'|'cards'|'table', skeletonCount, emptyCheck(data)->bool, emptyState }
// (opts.loadingText is still accepted for back-compat but no longer shown —
// the skeleton communicates "loading" without a text sink.)
window.withLoadingAndError = async function (container, fetcher, renderer, opts) {
  opts = opts || {};
  if (!container) return;
  var esc = window.escHtml || function (s) { return String(s == null ? '' : s); };

  container.innerHTML = window.skeletonHtml(opts.skeleton, opts.skeletonCount);
  // NO icon sweep on this line — deliberate (v14.0.68 smoothness pass).
  // skeletonHtml() is the pure builder 30 lines up in this same file, and all
  // three of its kinds emit nothing but .skl-wrap / .skl-row / .skl-card /
  // .skl-text divs: there is not one data-lucide node in any of them
  // (re-verified in-browser against all three kinds, 2026-08-05). The
  // lucide.createIcons() call that used to sit here therefore had no visual
  // effect at all, while paying the full document-wide cost documented at the
  // bottom of this function — and paying it on the exact frame the skeleton
  // paints, i.e. the frame the user is already waiting on.

  try {
    var data = await fetcher();
    if (opts.emptyCheck && opts.emptyCheck(data)) {
      container.innerHTML = window.renderEmptyState(opts.emptyState || { title: 'Nothing here yet' });
    } else {
      await renderer(data);
    }
  } catch (err) {
    var msg = (err && err.message) ? err.message : String(err);
    container.innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-icon">' + (window.emojiIcon ? window.emojiIcon('⚠️', 44) : '') + '</div>' +
        '<h4>Something went wrong</h4>' +
        '<p>' + esc(msg) + '</p>' +
        '<button type="button" class="btn-secondary btn-sm uistate-retry-btn" style="margin-top:14px">Retry</button>' +
      '</div>';
    var retryBtn = container.querySelector('.uistate-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        window.withLoadingAndError(container, fetcher, renderer, opts);
      });
    }
  }
  // ── ONE icon sweep, and only when it can actually do something ──────────
  // This is the sweep that matters: renderEmptyState() and the error block
  // above both build their glyph with emojiIcon(), which returns
  // `<i data-lucide="…">` (js/config.js:373), and renderer(data) output is
  // usually full of icons too — so hydration belongs here, after the
  // injection, never before it.
  //
  // WHY THE GUARD IS THE REAL SCOPING MECHANISM (v14.0.68):
  // lucide 0.468.0 — the UMD build pinned in index.html — does NOT support the
  // `nodes` option. Its createIcons() body is an unconditional
  // `document.querySelectorAll('[data-lucide]')`; the substring "nodes" does
  // not occur in the function at all. Passing { nodes: [container] } scopes
  // NOTHING — every call re-creates every icon in the whole document. Worse,
  // a hydrated icon keeps its data-lucide attribute on the replacement <svg>,
  // so already-drawn icons are re-matched and rebuilt on every later sweep:
  // the cost tracks total page icon count, not what we just injected.
  // Measured in-browser 2026-08-05: 0.66ms @13 icons, 1.41ms @73, 3.23ms @163,
  // 5.40ms @313 — on a Mac; the phone is several times slower again.
  // So asking "did WE just inject an un-hydrated icon?" is the only scoping
  // actually available: `[data-lucide]:not(svg)` matches the `<i>` form lucide
  // has yet to replace, and skips the document-wide rebuild entirely when
  // there is nothing to hydrate. { nodes: [container] } is kept only so this
  // call starts scoping for free if lucide ever implements it — inert today.
  //
  // CONTRACT this makes explicit: renderer(data) must inject its icons INSIDE
  // `container`. All four call sites already do (each assigns to the very
  // container it was handed), but it used to be incidental — a renderer that
  // painted icons elsewhere was silently rescued by the document-wide sweep,
  // and now would not be.
  if (window.lucide && container.querySelector('[data-lucide]:not(svg)')) {
    lucide.createIcons({ nodes: [container] });
  }
};
