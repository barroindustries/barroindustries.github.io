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

// ── withLoadingAndError(container, fetcher, renderer, opts) ──
// Standard fetch→render lifecycle: show loading placeholder, await
// fetcher(), route to renderEmptyState() when emptyCheck(data) is true,
// otherwise call renderer(data); on any thrown/rejected error show an
// error block with a Retry button that is bound INTERNALLY (no id
// contract needed for retry — unlike renderEmptyState's action, this
// wrapper owns the whole container so it wires its own listener) and
// simply re-invokes withLoadingAndError with the exact same arguments.
// opts: { loadingText='Loading…', emptyCheck(data)->bool, emptyState }
window.withLoadingAndError = async function (container, fetcher, renderer, opts) {
  opts = opts || {};
  if (!container) return;
  var esc = window.escHtml || function (s) { return String(s == null ? '' : s); };
  var loadingText = opts.loadingText || 'Loading…';

  container.innerHTML = '<div class="loading-placeholder">' + esc(loadingText) + '</div>';
  if (window.lucide) lucide.createIcons({ nodes: [container] });

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
  // Always re-scope lucide to this container after any injection above
  // (loading placeholder has no icons, but empty/error/renderer output can).
  if (window.lucide) lucide.createIcons({ nodes: [container] });
};
