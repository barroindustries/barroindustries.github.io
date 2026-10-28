/* js/qr-preview.js — the live PREVIEW IMAGE of a configurator sheet on /catalogue/ (js/quote-request.js mounts one at the top of each sheet).

   What it shows, for the configuration being edited: a real photo when the owner has supplied one for that combination of the options that
   change the look, otherwise a generated placeholder that still reflects the current choice (a navy line drawing of the product, its name,
   the chosen options in small text and a muted "Preview image coming soon"). Changing any option updates it at once with a short cross-fade
   (none under prefers-reduced-motion). The size never changes the picture.

   Which photo: ProductFamilies.previewKeys() turns the configuration into an ORDERED list of keys, most specific first (for a sink: the exact
   combination, then without the alignment, then without the upper shelf, then 'sink-basins-N-under-yes'); the first key the catalogue's
   manifest (island.previews, validated by scripts/build-catalogue.js from scripts/configurator-previews.json) has wins; none -> placeholder.
   The files live under site/img/configurator/<family>/<key>.webp (+ -thumb), load lazily and are never precached. The names are the owner's
   shot list (docs/configurator-preview-photo-list.md). A stove's burner layout is always drawn live as a diagram (it is more exact than any photo).

   Eleven families have a drawing of their own; any other family id gets DRAW_DEFAULT (a plain box with the family name), so a family added to the data before its
   picture exists never throws.

   Safety: it builds every node with createElement(NS) + textContent — nothing here parses markup, and every SVG shape is a presentation
   attribute or a class (the page's CSP forbids inline styles). No price, no network request other than the optional photo file itself.
   NOTHING about money lives here; the look is entirely in css/quote-request.css. */
(function () {
  'use strict';

  var doc = document;
  var PF = window.ProductFamilies;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var VB_W = 400, VB_H = 300;

  function reduced() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }

  // ── tiny SVG builder ──────────────────────────────────────────────────────
  function S(tag, attrs, kids) {
    var n = doc.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, String(attrs[k])); });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function T(cls, x, y, text, extra) {
    var t = S('text', Object.assign({ 'class': cls, x: x, y: y }, extra || {}));
    t.textContent = String(text);
    return t;
  }
  function line(x1, y1, x2, y2, cls) { return S('line', { x1: x1, y1: y1, x2: x2, y2: y2, 'class': cls || 'qr-pv-line' }); }
  function rect(x, y, w, h, cls, r) { return S('rect', { x: x, y: y, width: w, height: h, rx: r || 0, 'class': cls || 'qr-pv-line' }); }

  // ── pictograms (front / top views in a 400 x 300 box; the drawing area is y 62 .. 214) ──
  function drawPrepTable(g, c) {
    var layers = c.layers, upper = c.upper;
    var left = 96, right = 304, floor = 212, top = 136;
    g.appendChild(line(left, top + 4, left, floor)); g.appendChild(line(right, top + 4, right, floor));
    g.appendChild(rect(left - 12, top - 2, right - left + 24, 8, 'qr-pv-fill', 2));                // the worktop
    for (var i = 1; i < layers; i++) {                                                               // undershelves, evenly between top and floor
      var y = top + 6 + ((floor - top - 6) * i) / layers;
      g.appendChild(rect(left, y, right - left, 5, 'qr-pv-soft', 1.5));
    }
    var postTop = upper ? top - 30 * upper - 6 : null;
    if (upper) {
      g.appendChild(line(left + 10, top - 2, left + 10, postTop)); g.appendChild(line(right - 10, top - 2, right - 10, postTop));
      for (var u = 1; u <= upper; u++) g.appendChild(rect(left + 4, top - 30 * u - 4, right - left - 8, 5, 'qr-pv-soft', 1.5));
    }
    g.appendChild(line(left - 10, floor, left + 10, floor)); g.appendChild(line(right - 10, floor, right + 10, floor));
  }
  function drawSink(g, c) {
    var n = c.basins, left = 70, right = 330, floor = 212, top = 120;
    g.appendChild(rect(left, top - 6, right - left, 12, 'qr-pv-fill', 2));                           // the sink top
    g.appendChild(line(left + 10, top + 6, left + 10, floor)); g.appendChild(line(right - 10, top + 6, right - 10, floor));
    var bw = Math.min(60, Math.floor(196 / n)), gap = 8, gw = n * bw + (n - 1) * gap;
    var start = c.alignment === 'left' ? left + 16 : c.alignment === 'right' ? right - 16 - gw : left + (right - left - gw) / 2;
    var firstX = start, lastX = start + gw - bw;
    for (var i = 0; i < n; i++) g.appendChild(rect(start + i * (bw + gap), top - 4, bw, 30, 'qr-pv-basin', 6));
    // the faucet: a gooseneck arc, or a pre-rinse spray on a coiled hose
    var fx = c.alignment === 'left' ? firstX : c.alignment === 'right' ? lastX + bw : start + gw / 2;
    if (c.faucet === 'gooseneck') {
      g.appendChild(S('path', { d: 'M ' + fx + ' ' + (top - 6) + ' L ' + fx + ' ' + (top - 38) + ' Q ' + fx + ' ' + (top - 52) + ' ' + (fx + 16) + ' ' + (top - 52) + ' L ' + (fx + 22) + ' ' + (top - 52) + ' L ' + (fx + 22) + ' ' + (top - 44), 'class': 'qr-pv-line' }));
    } else {
      g.appendChild(line(fx, top - 6, fx, top - 56)); g.appendChild(line(fx - 10, top - 56, fx + 10, top - 56));
      g.appendChild(S('path', { d: 'M ' + fx + ' ' + (top - 56) + ' c 14 4 14 14 0 18 c -14 4 -14 14 0 18', 'class': 'qr-pv-line' }));
      g.appendChild(rect(fx - 4, top - 24, 8, 16, 'qr-pv-fill', 2));
    }
    if (c.undershelf) g.appendChild(rect(left + 10, floor - 40, right - left - 20, 5, 'qr-pv-soft', 1.5));
    if (c.upper) {
      var ux = c.alignment === 'left' ? left + 24 : right - 24;
      g.appendChild(line(left + 22, top - 6, left + 22, top - 56)); g.appendChild(line(right - 22, top - 6, right - 22, top - 56));
      g.appendChild(rect(left + 14, top - 62, right - left - 28, 5, 'qr-pv-soft', 1.5)); void ux;
    }
    g.appendChild(line(left, floor, left + 20, floor)); g.appendChild(line(right - 20, floor, right, floor));
  }
  var BURNER_CLASS = { wok: 'qr-pv-b qr-pv-b-wok', hp_small: 'qr-pv-b qr-pv-b-hp', hp_large: 'qr-pv-b qr-pv-b-hp', lp_small: 'qr-pv-b qr-pv-b-lp', lp_large: 'qr-pv-b qr-pv-b-lp', soup: 'qr-pv-b qr-pv-b-soup' };
  var SHORT = { wok: 'W', hp_small: 'HP', hp_large: 'HP', lp_small: 'LP', lp_large: 'LP', soup: 'S' };
  var LARGE = { wok: 1.12, hp_large: 1.0, lp_large: 1.0, soup: 1.06, hp_small: 0.78, lp_small: 0.78 };
  // An add-on's name sits inside its block. With many burners the block is narrow, so a name that would not fit is squeezed to the block's width
  // (SVG textLength: a presentation attribute, so no inline style) instead of spilling over its neighbour.
  function addLabel(g, text, cx, y, w) {
    var attrs = { 'text-anchor': 'middle' };
    if (text.length * 6.3 > w - 4) { attrs.textLength = Math.max(10, Math.round(w - 4)); attrs.lengthAdjust = 'spacingAndGlyphs'; }
    g.appendChild(T('qr-pv-add-text', cx, y, text, attrs));
  }
  function drawStove(g, c) {
    // a TOP view: the range body, the burners in order from the left, the add-ons after them, an oven shown as the door band at the front
    var pos = c.positions, add = (c.addons || []).filter(function (x) { return x !== 'oven'; }), oven = (c.addons || []).indexOf('oven') >= 0;
    var bx = 34, by = 66, bw = 332, bh = oven ? 112 : 132;
    g.appendChild(rect(bx, by, bw, bh, 'qr-pv-body', 6));
    var items = pos.length + add.length;
    var pitch = Math.min(66, (bw - 20) / items);
    var cx0 = bx + 10 + pitch / 2, cy = by + (bh - 24) / 2 + 8;
    pos.forEach(function (p, i) {
      var r = Math.min(26, pitch / 2 - 4) * LARGE[p];
      var cx = cx0 + i * pitch;
      g.appendChild(S('circle', { cx: cx, cy: cy, r: r, 'class': BURNER_CLASS[p] }));
      if (p === 'wok') g.appendChild(S('circle', { cx: cx, cy: cy, r: r * 0.58, 'class': 'qr-pv-b-ring' }));
      g.appendChild(T('qr-pv-b-text', cx, cy + 4, SHORT[p], { 'text-anchor': 'middle' }));
      g.appendChild(T('qr-pv-b-num', cx, by + bh - 6, String(i + 1), { 'text-anchor': 'middle' }));
    });
    add.forEach(function (a, j) {
      var x = cx0 + (pos.length + j) * pitch - pitch / 2 + 3, w = pitch - 6, y = by + 12, h = bh - 36;
      if (a === 'griller') {
        g.appendChild(rect(x, y, w, h, 'qr-pv-add', 4));
        for (var k = 1; k < 5; k++) g.appendChild(line(x + 4, y + (h * k) / 5, x + w - 4, y + (h * k) / 5, 'qr-pv-grate'));
      } else if (a === 'griddle') {
        g.appendChild(rect(x, y, w, h, 'qr-pv-add', 4)); g.appendChild(rect(x + 5, y + 5, w - 10, h - 10, 'qr-pv-plate', 2));
      } else {
        g.appendChild(rect(x, y, w, h, 'qr-pv-add', 4));
        var half = (w - 12) / 2;
        g.appendChild(rect(x + 4, y + 5, half, h - 10, 'qr-pv-plate', 2)); g.appendChild(rect(x + 8 + half, y + 5, half, h - 10, 'qr-pv-plate', 2));
      }
      addLabel(g, a === 'griller' ? 'Griller' : a === 'griddle' ? 'Griddle' : 'Fryer', x + w / 2, by + bh - 6, w);
    });
    if (oven) {
      g.appendChild(rect(bx, by + bh + 4, bw, 34, 'qr-pv-oven', 5));
      g.appendChild(line(bx + 40, by + bh + 21, bx + bw - 40, by + bh + 21, 'qr-pv-handle'));
      g.appendChild(T('qr-pv-add-text', bx + bw / 2, by + bh + 17, 'Oven', { 'text-anchor': 'middle' }));
    }
  }
  function drawCabinet(g, c) {
    var wall = c.type === 'wall';
    var x0 = wall ? 100 : 130, x1 = wall ? 300 : 270, y0 = wall ? 84 : 64, y1 = wall ? 164 : 212;
    if (wall) {
      g.appendChild(rect(70, 60, 8, 130, 'qr-pv-hatch'));                                              // the wall
      g.appendChild(line(78, 96, 100, 96)); g.appendChild(line(78, 150, 100, 150));
    }
    g.appendChild(rect(x0, y0, x1 - x0, y1 - y0, 'qr-pv-body', 4));
    var mid = (x0 + x1) / 2;
    if (c.doors === 'sliding') {
      g.appendChild(rect(x0 + 6, y0 + 6, mid - x0 + 8, y1 - y0 - 12, 'qr-pv-panel', 3));
      g.appendChild(rect(mid - 14, y0 + 6, x1 - mid + 8, y1 - y0 - 12, 'qr-pv-panel qr-pv-panel-2', 3));
      g.appendChild(line(x0 + 16, y0 + (y1 - y0) / 2, x0 + 40, y0 + (y1 - y0) / 2, 'qr-pv-handle'));
      g.appendChild(S('path', { d: 'M ' + (mid + 10) + ' ' + (y1 - 22) + ' l 24 0 m -6 -5 l 6 5 l -6 5', 'class': 'qr-pv-line qr-pv-thin' }));
    } else {
      g.appendChild(rect(x0 + 6, y0 + 6, mid - x0 - 9, y1 - y0 - 12, 'qr-pv-panel', 3));
      g.appendChild(rect(mid + 3, y0 + 6, x1 - mid - 9, y1 - y0 - 12, 'qr-pv-panel', 3));
      g.appendChild(S('circle', { cx: mid - 10, cy: y0 + (y1 - y0) / 2, r: 3, 'class': 'qr-pv-dot' }));
      g.appendChild(S('circle', { cx: mid + 10, cy: y0 + (y1 - y0) / 2, r: 3, 'class': 'qr-pv-dot' }));
    }
    var n = c.shelves;                                                                                 // the shelves inside, faint dashes behind the doors
    for (var i = 1; i <= n; i++) {
      var y = y0 + ((y1 - y0) * i) / (n + 1);
      g.appendChild(line(x0 + 10, y, x1 - 10, y, 'qr-pv-dash'));
    }
    if (!wall) { g.appendChild(line(x0 + 8, y1, x0 + 8, y1 + 6)); g.appendChild(line(x1 - 8, y1, x1 - 8, y1 + 6)); }
  }
  function drawWallShelf(g, c) {
    g.appendChild(rect(88, 62, 8, 152, 'qr-pv-hatch'));                                                 // the wall
    var n = c.tiers, left = 96, right = 312;
    for (var i = 0; i < n; i++) {
      var y = n === 1 ? 138 : 90 + (i * 96) / (n - 1);
      g.appendChild(rect(left, y, right - left, 7, 'qr-pv-soft', 2));
      if (c.surface === 'slotted') for (var k = 0; k < 7; k++) g.appendChild(rect(left + 18 + k * 28, y + 1.5, 14, 4, 'qr-pv-slot', 1));
      g.appendChild(line(left, y + 7, left + 36, y + 7 + 22, 'qr-pv-line qr-pv-thin'));                // a bracket
      g.appendChild(line(left + 36, y + 7 + 22, left, y + 7 + 22, 'qr-pv-line qr-pv-thin'));
    }
  }
  function drawRack(g, c) {
    var n = c.tiers, left = 120, right = 280, top = 64, floor = 196;
    g.appendChild(line(left, top, left, floor)); g.appendChild(line(right, top, right, floor));
    g.appendChild(line(left + 10, top, left + 10, floor, 'qr-pv-line qr-pv-thin')); g.appendChild(line(right - 10, top, right - 10, floor, 'qr-pv-line qr-pv-thin'));
    for (var i = 0; i < n; i++) {
      var y = top + 4 + ((floor - top - 12) * i) / (n - 1);
      g.appendChild(rect(left - 8, y, right - left + 16, 5, 'qr-pv-soft', 1.5));
    }
    if (c.wheels) {
      [left - 2, right + 2].forEach(function (x) { g.appendChild(S('circle', { cx: x, cy: floor + 11, r: 9, 'class': 'qr-pv-wheel' })); g.appendChild(S('circle', { cx: x, cy: floor + 11, r: 2.5, 'class': 'qr-pv-dot' })); });
    } else {
      [left - 6, right + 2].forEach(function (x) { g.appendChild(rect(x, floor + 1, 8, 8, 'qr-pv-fill', 1)); });
    }
  }
  // ── the five families added 2026-10-28 (CONFIGURATOR-FAMILIES-2-SPEC §6.1): the same navy line art, only classes the stylesheet already has ──
  function arrowAcross(g, x1, x2, y) {                                                                // a thin arrow along the picture, from x1 to x2
    var dir = x2 > x1 ? 1 : -1;
    g.appendChild(S('path', { d: 'M ' + x1 + ' ' + y + ' L ' + x2 + ' ' + y + ' M ' + (x2 - 7 * dir) + ' ' + (y - 5) + ' L ' + x2 + ' ' + y + ' L ' + (x2 - 7 * dir) + ' ' + (y + 5), 'class': 'qr-pv-line qr-pv-thin' }));
  }
  function drawDishTable(g, c) {
    // a front view: the table with its raised splash along the back, an optional undershelf and pre-rinse sink, the dishwasher as the box at the chosen end, and an arrow for the way the dishes travel
    var dwLeft = c.hand !== 'right', dwW = 66, top = 142, floor = 212;
    var x0 = dwLeft ? 112 : 36, x1 = dwLeft ? 364 : 288, dwX = dwLeft ? 36 : 298;
    g.appendChild(rect(dwX, top - 46, dwW, floor - top + 46, 'qr-pv-body', 4));                          // the dishwasher
    g.appendChild(rect(dwX + 10, top - 36, dwW - 20, 18, 'qr-pv-panel', 3));
    g.appendChild(line(dwX + 14, top - 8, dwX + dwW - 14, top - 8, 'qr-pv-handle'));
    g.appendChild(rect(x0, top - 18, x1 - x0, 18, 'qr-pv-soft', 2));                                      // the raised splash along the back
    if (c.side !== 'soiled') g.appendChild(rect(dwLeft ? x1 - 7 : x0, top - 18, 7, 26, 'qr-pv-fill', 1));  // the clean side has a side splash at the far end as well
    g.appendChild(rect(x0, top, x1 - x0, 8, 'qr-pv-fill', 2));                                            // the table top
    g.appendChild(line(x0 + 10, top + 8, x0 + 10, floor)); g.appendChild(line(x1 - 10, top + 8, x1 - 10, floor));
    g.appendChild(line(x0 + 2, floor, x0 + 18, floor)); g.appendChild(line(x1 - 18, floor, x1 - 2, floor));
    if (c.undershelf) g.appendChild(rect(x0 + 10, floor - 32, x1 - x0 - 20, 5, 'qr-pv-soft', 1.5));
    if (c.side === 'soiled' && c.sink === 'prerinse') {
      var bx = dwLeft ? x0 + 12 : x1 - 12 - 72, fx = bx + 36;
      g.appendChild(rect(bx, top - 6, 72, 26, 'qr-pv-basin', 6));                                         // the pre-rinse sink bowl, at the dishwasher end
      g.appendChild(line(fx, top - 18, fx, top - 56)); g.appendChild(line(fx - 10, top - 56, fx + 10, top - 56));
      g.appendChild(rect(fx - 4, top - 40, 8, 14, 'qr-pv-fill', 2));                                      // the spray head
    }
    var mid = (x0 + x1) / 2, toward = c.side === 'soiled';                                                // dirty dishes go TOWARD the dishwasher, clean ones come away from it
    arrowAcross(g, toward === dwLeft ? mid + 26 : mid - 26, toward === dwLeft ? mid - 26 : mid + 26, top - 34);
  }
  function drawWokRange(g, c) {
    // a TOP view: the body, one to three recessed wok rings across it, an optional low stock burner at the back and an optional swan-neck faucet at the back edge
    var n = c.holes || 1, bx = 34, by = 88, bw = 332, bh = 116, rear = !!c.rear;
    g.appendChild(rect(bx, by, bw, bh, 'qr-pv-body', 6));
    var pitch = (bw - 20) / n, r = Math.min(30, pitch / 2 - 6), cy = rear ? by + bh - 40 : by + bh / 2 + 2;
    for (var i = 0; i < n; i++) {
      var cx = bx + 10 + pitch * (i + 0.5);
      g.appendChild(S('circle', { cx: cx, cy: cy, r: r, 'class': 'qr-pv-b qr-pv-b-wok' }));
      g.appendChild(S('circle', { cx: cx, cy: cy, r: r * 0.58, 'class': 'qr-pv-b-ring' }));
    }
    if (rear) g.appendChild(S('circle', { cx: bx + bw / 2, cy: by + 22, r: 13, 'class': 'qr-pv-b qr-pv-b-soup' }));
    if (c.faucet === 'swan') {
      var fx = bx + bw - 34;
      g.appendChild(S('path', { d: 'M ' + fx + ' ' + by + ' L ' + fx + ' ' + (by - 14) + ' Q ' + fx + ' ' + (by - 26) + ' ' + (fx - 14) + ' ' + (by - 26) + ' L ' + (fx - 20) + ' ' + (by - 26) + ' L ' + (fx - 20) + ' ' + (by - 18), 'class': 'qr-pv-line' }));
    }
    for (var k = 0; k < n; k++) g.appendChild(S('circle', { cx: bx + 10 + pitch * (k + 0.5), cy: by + bh - 7, r: 3.2, 'class': 'qr-pv-dot' }));      // a control knob under each ring
  }
  function drawCookingLine(g, c) {
    // a front view of the unit on its stand: a flat plate, a grill, fry tanks or a grill beside a plate by type; the knobs, the stand and an optional bottom shelf
    var type = c.type || 'griddle', w = type === 'combi' ? 264 : 200, l = 200 - w / 2, r = 200 + w / 2, top = 118, bodyH = 44, floor = 212, i, x;
    g.appendChild(rect(l, top, w, bodyH, 'qr-pv-body', 4));                                               // the body
    var knobs = type === 'fryer' ? (c.baskets || 2) : type === 'combi' ? 2 : (c.burners || 1);
    for (i = 0; i < knobs; i++) g.appendChild(S('circle', { cx: l + (w * (i + 0.5)) / knobs, cy: top + 24, r: 4, 'class': 'qr-pv-dot' }));
    function grill(x0, x1) {
      g.appendChild(rect(x0, top - 14, x1 - x0, 16, 'qr-pv-add', 3));
      for (var k = 1; k < 7; k++) g.appendChild(line(x0 + ((x1 - x0) * k) / 7, top - 12, x0 + ((x1 - x0) * k) / 7, top - 2, 'qr-pv-grate'));
    }
    if (type === 'griller') grill(l + 8, r - 8);
    else if (type === 'fryer') {
      var n = c.baskets || 2, tw = (w - 16 - (n - 1) * 8) / n;
      for (i = 0; i < n; i++) {
        x = l + 8 + i * (tw + 8);
        g.appendChild(rect(x, top - 24, tw, 26, 'qr-pv-basin', 4));                                       // a fry tank ...
        g.appendChild(line(x + tw / 2 - 9, top - 34, x + tw / 2 + 9, top - 34, 'qr-pv-handle')); g.appendChild(line(x + tw / 2, top - 34, x + tw / 2, top - 22, 'qr-pv-handle'));   // ... and its basket handle
      }
    } else if (type === 'combi') {
      grill(l + 8, 200 - 4);
      g.appendChild(rect(204, top - 10, r - 8 - 204, 12, 'qr-pv-plate', 2));
    } else g.appendChild(rect(l + 8, top - 10, w - 16, 12, 'qr-pv-plate', 2));                            // a griddle: one flat plate
    g.appendChild(line(l + 10, top + bodyH, l + 10, floor)); g.appendChild(line(r - 10, top + bodyH, r - 10, floor));
    g.appendChild(line(l + 2, floor, l + 18, floor)); g.appendChild(line(r - 18, floor, r - 2, floor));
    if (c.base === 'shelf') g.appendChild(rect(l + 10, floor - 34, w - 20, 5, 'qr-pv-soft', 1.5));
  }
  function drawDeckOven(g, c) {
    // a front view: one to three stacked decks (a wider body for six trays per deck) on its own base or on a heavy-duty stand
    var decks = c.decks || 1, w = c.trays === 6 ? 252 : 172, x0 = 200 - w / 2, x1 = 200 + w / 2, floor = 212;
    var stand = c.stand === 'heavy', standH = stand ? 36 : 6;
    var deckH = decks === 1 ? 62 : (decks === 2 ? 46 : 34), gap = 4;
    var y0 = floor - standH - (decks * deckH + (decks - 1) * gap);
    if (stand) {
      g.appendChild(line(x0 + 8, floor - standH, x0 + 8, floor)); g.appendChild(line(x1 - 8, floor - standH, x1 - 8, floor));
      g.appendChild(line(x0 + 8, floor - standH, x1 - 8, floor - 6, 'qr-pv-line qr-pv-thin')); g.appendChild(line(x1 - 8, floor - standH, x0 + 8, floor - 6, 'qr-pv-line qr-pv-thin'));
      g.appendChild(line(x0 + 2, floor, x0 + 20, floor)); g.appendChild(line(x1 - 20, floor, x1 - 2, floor));
    } else {
      g.appendChild(line(x0 + 10, floor - 6, x0 + 10, floor)); g.appendChild(line(x1 - 10, floor - 6, x1 - 10, floor));
    }
    for (var i = 0; i < decks; i++) {
      var y = y0 + i * (deckH + gap);
      g.appendChild(rect(x0, y, w, deckH, 'qr-pv-oven', 4));
      g.appendChild(rect(x0 + 10, y + 6, w - 20, deckH - 12, 'qr-pv-panel', 3));                          // the door
      g.appendChild(line(x0 + 22, y + deckH / 2, x1 - 22, y + deckH / 2, 'qr-pv-handle'));
      g.appendChild(S('circle', { cx: x1 - 5, cy: y + deckH / 2, r: 2.2, 'class': 'qr-pv-dot' }));
    }
  }
  function drawHood(g, c) {
    // a front view of the canopy with its duct: against a wall, hung free over an island, or a slim low one; a row of baffle filters and the lamps under it when chosen
    var type = c.type || 'wall', slim = type === 'slim', y0 = slim ? 120 : 96, yb = slim ? 142 : 152, i;
    if (type === 'wall') g.appendChild(rect(64, 62, 272, 124, 'qr-pv-hatch'));                              // the wall behind it
    if (type === 'island') { g.appendChild(line(150, y0, 150, 66, 'qr-pv-line qr-pv-thin')); g.appendChild(line(250, y0, 250, 66, 'qr-pv-line qr-pv-thin')); }
    g.appendChild(rect(180, y0 - (slim ? 28 : 34), 40, slim ? 28 : 34, 'qr-pv-body', 2));                  // the duct
    g.appendChild(S('path', { d: 'M ' + (slim ? 118 : 128) + ' ' + y0 + ' L ' + (slim ? 282 : 272) + ' ' + y0 + ' L ' + (slim ? 318 : 312) + ' ' + yb + ' L ' + (slim ? 82 : 88) + ' ' + yb + ' Z', 'class': 'qr-pv-body' }));   // the canopy
    if (c.filters === 'baffle') for (i = 0; i < 7; i++) g.appendChild(line(110 + i * 30, yb - 11, 110 + i * 30, yb - 3, 'qr-pv-grate'));
    if (c.lighting) for (i = 0; i < 3; i++) {
      g.appendChild(S('circle', { cx: 140 + i * 60, cy: yb + 8, r: 3.5, 'class': 'qr-pv-dot' }));
      g.appendChild(line(140 + i * 60, yb + 14, 140 + i * 60, yb + 30, 'qr-pv-dash'));
    }
  }
  var DRAW = { prep_table: drawPrepTable, sink: drawSink, dish_table: drawDishTable, stove: drawStove, wok_range: drawWokRange, cooking_line: drawCookingLine, deck_oven: drawDeckOven, hood: drawHood, cabinet: drawCabinet, wall_shelf: drawWallShelf, rack: drawRack };
  // A family with no drawing of its own (one added to scripts/public-families.json before its picture is made) gets a plain box with its name, never an error.
  function drawDefault(g, c, family) {
    g.appendChild(rect(110, 90, 180, 112, 'qr-pv-body', 8));
    g.appendChild(T('qr-pv-add-text', 200, 150, family && family.label ? family.label : '', { 'text-anchor': 'middle' }));
  }
  var DRAW_DEFAULT = drawDefault;

  // The words under the drawing: the chosen options, wrapped to at most three short lines (46 characters each). A part stays whole where it fits;
  // a part longer than a line by itself (a stove with six burners) is broken between its words, and a word longer than a line is cut. Anything beyond
  // three lines ends in an ellipsis rather than running off the picture.
  var LINE_MAX = 46, LINES_MAX = 3, SEP = ' \u00B7 ';
  function wrapParts(parts) {
    var lines = [], cur = '';
    parts.forEach(function (p) {
      p = String(p);
      if (cur && (cur + SEP + p).length <= LINE_MAX) { cur += SEP + p; return; }
      if (cur) { lines.push(cur); cur = ''; }
      if (p.length <= LINE_MAX) { cur = p; return; }
      p.split(' ').forEach(function (w) {
        while (w.length > LINE_MAX) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, LINE_MAX)); w = w.slice(LINE_MAX); }
        if (!w) return;
        if (cur && (cur + ' ' + w).length > LINE_MAX) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
      });
    });
    if (cur) lines.push(cur);
    if (lines.length > LINES_MAX) {
      lines = lines.slice(0, LINES_MAX);
      var last = lines[LINES_MAX - 1];
      lines[LINES_MAX - 1] = (last.length >= LINE_MAX ? last.slice(0, LINE_MAX - 1) : last) + '\u2026';
    }
    return lines;
  }

  // placeholder(family, config) -> an <svg> element. Static text only; reflects the current choice; carries no figure of any kind.
  function placeholder(family, config) {
    var svg = S('svg', { viewBox: '0 0 ' + VB_W + ' ' + VB_H, 'class': 'qr-pv-svg', 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMidYMin slice' });   // slice, top-aligned: a phone's shorter stage crops only the empty bottom rows
    svg.appendChild(rect(0, 0, VB_W, VB_H, 'qr-pv-bg'));
    svg.appendChild(rect(10, 10, VB_W - 20, VB_H - 20, 'qr-pv-frame', 6));
    svg.appendChild(T('qr-pv-title', VB_W / 2, 44, family.label, { 'text-anchor': 'middle' }));
    var g = S('g', { 'class': 'qr-pv-art' });
    var draw = Object.prototype.hasOwnProperty.call(DRAW, family.id) ? DRAW[family.id] : DRAW_DEFAULT;
    try { draw(g, config, family); } catch (e) { /* a drawing must never break the sheet */ }
    svg.appendChild(g);
    var rows = wrapParts(PF.summaryParts(family, config));
    var y = family.id === 'stove' && (config.addons || []).indexOf('oven') >= 0 ? 238 : 232;
    rows.forEach(function (r, i) { svg.appendChild(T('qr-pv-opts', VB_W / 2, y + i * 16, r, { 'text-anchor': 'middle' })); });
    svg.appendChild(T('qr-pv-note', VB_W / 2, 286, 'Preview image coming soon', { 'text-anchor': 'middle' }));
    return svg;
  }

  // ── the widget ────────────────────────────────────────────────────────────
  // create({ family, manifest }) -> { el, update(config), keysFor(config) }
  //   manifest: { key: { s: image path, t: thumb path, w: thumb width, h: thumb height, m: image width } } — only the keys that have a photo
  function create(opts) {
    var family = opts.family;
    var manifest = opts.manifest || {};
    var el = doc.createElement('div');
    el.className = 'qr-preview';
    el.setAttribute('role', 'img');
    var stage = doc.createElement('div'); stage.className = 'qr-pv-stage';
    var cap = doc.createElement('p'); cap.className = 'qr-pv-cap';                  // ONE line of words under the picture (shown on phones; the drawing's own text rows are hidden there)
    var insets = doc.createElement('div'); insets.className = 'qr-pv-insets';
    el.appendChild(stage); el.appendChild(cap); el.appendChild(insets);
    var seq = 0;
    var currentSig = null;

    function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
    function photoNode(entry, alt, cls) {
      var img = doc.createElement('img');
      img.className = cls || 'qr-pv-photo';
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      img.width = entry.w; img.height = entry.h;
      img.setAttribute('src', '/' + entry.t);
      img.setAttribute('srcset', '/' + entry.t + ' ' + entry.w + 'w, /' + entry.s + ' ' + entry.m + 'w');
      img.setAttribute('sizes', '(min-width:720px) 380px, 90vw');
      void alt;
      return img;
    }
    function showLayer(node, mySeq) {
      var layer = doc.createElement('div');
      layer.className = 'qr-pv-layer';
      layer.appendChild(node);
      stage.appendChild(layer);
      var olds = [].slice.call(stage.children).filter(function (c) { return c !== layer; });
      if (reduced()) {
        olds.forEach(function (o) { stage.removeChild(o); });
        layer.classList.add('is-in');
        return;
      }
      // two frames: the new layer must be painted at opacity 0 before it is switched on, or the browser skips the transition
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          if (mySeq !== seq) { if (layer.parentNode) layer.parentNode.removeChild(layer); return; }
          layer.classList.add('is-in');
          olds.forEach(function (o) { o.classList.add('is-out'); });
          window.setTimeout(function () { olds.forEach(function (o) { if (o.parentNode) o.parentNode.removeChild(o); }); }, 260);
        });
      });
    }

    function keysFor(config) { return PF.previewKeys(family, config); }

    function update(config) {
      var k = keysFor(config);
      var chainHit = null;
      for (var i = 0; i < k.chain.length; i++) if (has(manifest, k.chain[i])) { chainHit = k.chain[i]; break; }
      var insetHits = k.insets.filter(function (x) { return has(manifest, x); }).slice(0, 2);
      var diagram = !!(family.preview && family.preview.liveDiagram);
      var summary = PF.summaryParts(family, config).join(', ');
      // The signature of what is drawn: when only the SIZE changed, nothing needs to move.
      var sig = JSON.stringify([chainHit, insetHits, diagram ? PF.canonicalConfig(family, config) : (chainHit ? '' : PF.canonicalConfig(family, config))]);
      el.setAttribute('aria-label', family.label + ' preview: ' + summary + (chainHit ? '. Representative photo.' : '. Preview image coming soon.'));
      cap.textContent = PF.summaryParts(family, config).join(' \u00B7 ');
      el.setAttribute('data-photo', chainHit ? chainHit : '');
      if (sig === currentSig) return;
      currentSig = sig;
      var mySeq = ++seq;
      var node;
      if (chainHit && !diagram) {
        node = photoNode(manifest[chainHit], summary);
      } else if (chainHit && diagram) {
        // a photo AND the live layout: the photo is the picture, the layout stays as an inset card
        var wrap = doc.createElement('div'); wrap.className = 'qr-pv-both';
        wrap.appendChild(photoNode(manifest[chainHit], summary));
        var card = doc.createElement('div'); card.className = 'qr-pv-diagram'; card.appendChild(placeholder(family, config)); wrap.appendChild(card);
        node = wrap;
      } else {
        node = placeholder(family, config);
      }
      showLayer(node, mySeq);
      // secondary close-ups (a faucet, a burner) as small thumbnails
      while (insets.firstChild) insets.removeChild(insets.firstChild);
      insetHits.forEach(function (key) { insets.appendChild(photoNode(manifest[key], key, 'qr-pv-inset')); });
      insets.hidden = !insetHits.length;
    }
    insets.hidden = true;
    return { el: el, update: update, keysFor: keysFor };
  }

  window.QR_PREVIEW = { create: create, placeholder: placeholder, wrapParts: wrapParts };
})();
