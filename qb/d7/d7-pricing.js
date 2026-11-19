/* ==============================================================================================================
   qb/d7/d7-pricing.js: window.D7.pricing.   The R1 engine behind computeTrueCost(), the calculator, the markup for this quote, the discount floor, the typed price, the standard total the approval rules read
   (specs/BK-LIVE-INTEGRATION-SPEC-2026-11-19.md sections 1.2 M4, 2.2, 3.4, 3.5, 6.2, 5 packet C).   Ported from the D7 prototype's d7/d7-pricing.js; what is different in the live builder is marked KC:C.
   Loaded after the kc files and window.KCRules, before d7-doc.js and d7-adapter.js.

   WHAT THIS FILE DOES.  Under d7On() the builder's cost engine is the R1 formula and nothing else:
        M            = materials (kc price list x quantities; a catalogue line: capitalMaterials)
        Labor        = M x bracket %     (Simple 30 / Medium 50 / Complex 70: KC.SET.br)
        Misc         = KC.SET.misc % x (M + Labor)
        ProjectCost  = M + Labor + Misc
        SellingPrice = ProjectCost x D7.markup(), rounded to the nearest 10 pesos
        A LIST-PRICED kc line (Chef Mode, KC.price's result.list) sells at round10(ProjectCost x markup + list.adj [+ its share of the distributed costs]): the list price of its model plus what the
        options add by formula. The list adjustment is selling price only: ProjectCost (so the floor, the discount cap, the margin) and M (so the lead time) stay the formula's.
   KC:C EVERY BIT OF THAT ARITHMETIC IS qb/kc-rules.js (window.KCRules): round10, r1, sellUnit, bracketOfSection, standardUnit, belowMarkupThreshold. This file only feeds them.
   KC:C A CATALOGUE or website line keeps its catalogue / website price for every role (spec 3.5 rule 1): the auto-pricer skips it unless the office flag catalogueCostPricing is on. Its cost on file, when the session
        can read it, still feeds the calculator, the floor and the lead time.
   KC:C READ-ONLY UNTIL THE PRICES ARE IN (spec 2.2): while KCLive.ready is false, apply(), autoPrice(), repriceAll(), reprice(), resetPrices() and resetLine() return at once, so no stored price changes.
   Brilliance Steel and a quote "as issued" / legacy never reach it: every entry the builder calls directly sits behind `d7On()`, and the hooks that run for every quote (fields, applyFields, repriceAll) check it themselves.

   DIRECT CALLS FROM THE PAGE   all return exactly what the old function returned, and never throw (a failure is logged once and a safe value comes back)
        trueCost()            computeTrueCost()            same keys as the old body, plus: d7, markup, markupOvr, rows[{idx,item,qty,lc,auto}]
        apply(cost)           applyComputedPricing(cost)   the auto-pricer; true when a price changed
        panelHtml(cost)       renderTrueCostPanelHtml(cost) the calculator (President) / the line table without costs (everyone else)
        resetPrices()         resetPricesToComputed()
        customHasBasis(item)  customLineHasMaterialsBasis(item)
        uncostedReason()      uncostedCustomLinesReason()      needsPriceReason()     miscMult(m)
   HOOKS (D7.h)             fields() applyFields(o) priceNote(item, idx) repriceAll() reprice(item) autoPrice()
   OTHER API                lineCost(item) autoUnit(item) markupOvr / setMarkupOvr(v) / clearMarkup() / onMarkupChange(v) resetLine(idx) miscQuoted(m)
                            standardInfo()  the numbers of spec 3.4 the approval rules and the cost sidecar read: { net, grand, projectCost, floorTotal, costTimesMarkup, standardTotal, costKnown, markup, floorMode }

   RULES THAT ARE NOT OBVIOUS:
     - a catalogue line is costed from capitalMaterials ONLY (capitalLabor and laborHours are not read); no cost on file = no basis = it keeps its catalogue price and adds 0 to the floor.
     - the labor bracket of a catalogue or website line is by SECTION (KCRules.bracketOfSection): Cooking and Baking = Complex, every other section = Medium (owner Q42).
     - the floor (the discount cap, "Below project cost") is the R1 project cost at cost: it does not move with the markup.
     - lead time reads trueCost().materials = sum of M x qty over every costed line, a kc line included.
     - the price of a distributed ("not on quote") additional cost is added BEFORE the round to 10 pesos.
   ============================================================================================================== */
(function () {
  'use strict';
  const D7 = window.D7 = window.D7 || {};
  D7.pricing = D7.pricing || {};

  /* ---------- small helpers ---------- */
  const R = () => window.KCRules;                               // KC:C the one copy of the money maths (qb/kc-rules.js)
  const r10 = x => R().round10(x);
  const r100 = x => Math.round(x / 100) * 100;                  // the additional costs of the builder round to 10 pesos0 (not a kc rule)
  /* KC:C read-only until the prices are in (spec 2.2): KCLive.ready is false while qb/kc-live.js reads them and for good when the read failed */
  const ready = () => !!(window.KCLive && window.KCLive.ready);
  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const qtyOf = it => { const q = Number(it && it.qty); return q > 0 ? q : 1; };
  const isKc = it => !!(it && it.kcKind);
  const isKcCustom = it => !!(it && it.kcKind === 'custom');
  const isManual = it => !!(it && (it.priceBasis === 'manual' || it.priceManual));
  const d7on = () => typeof d7On === 'function' && d7On();
  const can = what => { try { return !!(window.KC && KC.can && KC.can(what)); } catch (e) { return false; } };
  const money = n => typeof formatPeso === 'function' ? formatPeso(n) : '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tEsc = s => typeof txtEsc === 'function' ? txtEsc(s == null ? '' : s) : String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const aEsc = s => typeof attrEsc === 'function' ? attrEsc(s == null ? '' : s) : tEsc(s);
  const fmtMk = m => String(+(+m).toFixed(4));
  const warned = Object.create(null);
  const warn = (name, err) => { if (!warned[name]) { warned[name] = 1; try { console.error('D7 pricing: ' + name + ' failed', err); } catch (e) { /* no console */ } } };
  /* a function the copy calls DIRECTLY must never throw: a failure is logged once and `fallback` (a value, or a function of the arguments) is returned */
  const guard = (name, fallback, fn) => function () {
    try { return fn.apply(this, arguments); }
    catch (err) { warn(name, err); return typeof fallback === 'function' ? fallback.apply(this, arguments) : fallback; }
  };

  /* the builder's page-level `let` / `const` are global bindings but not window properties: read them by bare name, guarded */
  const G = {
    items() { return (typeof items !== 'undefined' && Array.isArray(items)) ? items : []; },
    miscs() { return (typeof miscCosts !== 'undefined' && Array.isArray(miscCosts)) ? miscCosts : []; },
    products() { return (typeof DB !== 'undefined' && DB && Array.isArray(DB.products)) ? DB.products : []; },
    cs() { return (typeof COSTING_SETTINGS !== 'undefined' && COSTING_SETTINGS) || (typeof COSTING_DEFAULTS !== 'undefined' ? COSTING_DEFAULTS : {}); },
    inTotals() { return typeof _inComputeTotals !== 'undefined' && !!_inComputeTotals; }
  };
  const liveMap = () => new Map(G.products().map(p => [p.id, p]));

  /* ---------- the settings the formula reads (never hard-coded: KC.SET is the President's Pricing settings) ---------- */
  const BR_DEFAULT = { simple: 30, medium: 50, complex: 70 };
  const BR_LABEL = { simple: 'Simple', medium: 'Medium', complex: 'Complex' };
  const SET = () => (window.KC && KC.SET) || { br: BR_DEFAULT, misc: 10, markup: 2 };
  const brPct = b => { const v = (SET().br || {})[b]; return typeof v === 'number' ? v : (BR_DEFAULT[b] != null ? BR_DEFAULT[b] : 50); };
  const miscPct = () => num(SET().misc);
  const markup = () => (D7.markup ? D7.markup() : (num(SET().markup) || 2));
  const markupOvr = () => (D7.markupOvr ? D7.markupOvr() : null);

  /* R1 on one materials figure: KCRules.r1 (the same operations, in the same order, as KC.sell for one group, so a catalogue line and a kc line agree to the last digit) */
  function r1(M, bracket, typedLabor) {
    const g = R().r1(M, brPct(bracket), miscPct(), typedLabor);
    return { M: M, labor: g.labor, misc: g.misc, projectCost: g.projectCost, bracket: bracket };
  }
  /* the bracket of a catalogue / website line is that of its SECTION: Cooking (and Baking, which lives in the Cooking tab) = Complex, every other section = Medium (owner Q42): KCRules.bracketOfSection */
  function bracketOfSection(cat) {
    let tab = '';
    try { tab = (D7.tabOfProduct && D7.tabOfProduct({ category: cat })) || ''; } catch (e) { /* no tab */ }
    return R().bracketOfSection(tab || cat);
  }

  /* ---------- a kc custom item ("Add custom item", spec 3.8): rows picked from the price list + typed materials / labor ---------- */
  function customParts(c) {
    const rows = Array.isArray(c && c.rows) ? c.rows : [], P = (window.KC && KC.P) || {}, miss = [];
    let rowsM = 0;
    rows.forEach(r => {
      const pl = r && P[r.k]; if (!pl) return;
      const q = Math.max(0, +r.q || 0);
      if (pl.p == null) { if (q > 0) miss.push(pl.l); return; }
      rowsM += q * pl.p;
    });
    const typed = +c.m > 0 ? +c.m : 0, lab = (c.lab != null && c.lab !== '' && +c.lab >= 0) ? +c.lab : null;
    return { M: rowsM + typed, rowsM: rowsM, typed: typed, lab: lab, miss: miss };
  }
  /* the project cost a typed unit price is held against when the labor is not typed yet (Sales builds the list): Complex stands in for the labor, so the warning still works */
  function customEst(c) {
    const p = customParts(c || {});
    if (p.miss.length || !(p.M > 0)) return null;
    return r1(p.M, 'complex', p.lab).projectCost;
  }
  /* what a kc line is priced at, at the STANDARD markup for every figure but unit / selling. KC.priceOf is chunk B's (it knows 'custom' and applies the override); without it
     (chunk B not loaded) KC.price serves the products and the custom item is priced here exactly as the kc host prices it */
  function kcPriceResult(kind, cfg) {
    if (typeof KC.priceOf === 'function') return KC.priceOf(kind, cfg);
    if (kind === 'custom') {
      const p = customParts(cfg), none = { priced: false, lines: [], groups: [], projectCost: 0, selling: 0, unit: 0, M: p.M };
      if (p.miss.length) return Object.assign(none, { missing: p.miss });
      if (!(p.M > 0)) return Object.assign(none, { missing: ['the custom item’s cost'] });
      if (p.lab == null) return Object.assign(none, { missing: ['the custom item’s labor'] });
      const g = r1(p.M, 'complex', p.lab);
      return { priced: true, missing: [], lines: [], groups: [{ id: 'custom', label: 'Custom item', M: g.M, labor: g.labor, misc: g.misc, cost: g.projectCost }], projectCost: g.projectCost, selling: g.projectCost * markup(), unit: R().sellUnit({ projectCost: g.projectCost, markup: markup() }), M: p.M };
    }
    return KC.price(kind, cfg);
  }

  /* ==============================================================================================================
     lineCost(item) -> { hasBasis, M, labor, misc, projectCost, bracket, source, estCost }   PER UNIT, at the standard markup (spec 3.6 table)
       source: 'kc' | 'kc-unavailable' | 'catalogue' | 'website' | 'custom-bom' | 'pass-through' | 'fee' | 'none'
     ============================================================================================================== */
  const blank = source => ({ hasBasis: false, M: 0, labor: 0, misc: 0, projectCost: 0, bracket: null, source: source || 'none', estCost: null });

  function kcCost(item) {
    const out = blank('kc');
    if (!window.KC || !item.cfg || typeof item.cfg !== 'object') { out.source = 'kc-unavailable'; return out; }
    let pr;
    try { pr = kcPriceResult(item.kcKind, item.cfg); } catch (err) { out.source = 'kc-unavailable'; return out; }
    if (!pr || !pr.priced) {                                   // "Priced after review": it adds nothing to the floor, as in the kc prototype
      out.estCost = item.kcKind === 'custom' ? customEst(item.cfg) : null;
      out.missing = (pr && pr.missing) || [];
      return out;
    }
    const gs = Array.isArray(pr.groups) ? pr.groups : [];
    let M = 0, labor = 0, misc = 0;
    gs.forEach(g => { M += num(g.M); labor += num(g.labor); misc += num(g.misc); });
    out.hasBasis = true; out.M = M; out.labor = labor; out.misc = misc; out.projectCost = num(pr.projectCost); out.estCost = out.projectCost;
    out.bracket = gs[0] ? (gs[0].bracket || null) : null; out.groups = gs.length; out.priced = true;
    out.listAdj = pr.list ? num(pr.list.adj) : 0;               // owner R4 Q23: a list-priced Chef Mode line: list price - the formula price of its unchanged base model (selling price only)
    out.listed = !!pr.list;                                     // KC:C Q64: the line is list-priced (its adjustment may be 0 and it is still list-priced)
    return out;
  }

  function lineCostOf(item, liveById) {
    if (!item || item.id === 'MISCFEE') return blank('fee');
    if (item.passThrough) {                                    // pass-through: unchanged, the supplier cost (ptUnitCostOf); it joins the floor, never the materials
      let pu = 0;
      try { pu = ptUnitCostOf(item, itemCostBasis(item, liveById || liveMap()), G.cs()); } catch (e) { pu = num(item.unitPrice); }
      return { hasBasis: pu > 0, M: 0, labor: 0, misc: 0, projectCost: pu, bracket: null, source: 'pass-through', estCost: null };
    }
    if (isKc(item)) return kcCost(item);
    let M = 0, bracket = 'medium', source = 'catalogue', typedLabor = null, basis = null;
    if (item.familyId) {                                       // a website family line: M from the nearest standard model's cost (QBConfigured.costBasisFor); counts for the floor only
      source = 'website'; bracket = bracketOfSection(item.category);
      basis = itemCostBasis(item, liveById || liveMap());
      M = basis && basis.hasBasis ? num(basis.mat) : 0;
    } else if (item.id === 'CUSTOM') {                         // an old custom line (the BOM popup): the BOM, else the typed materials; labor = crew-days x the day rate when > 0, else Complex
      source = 'custom-bom'; bracket = 'complex';
      const cs = G.cs(), d = typeof COSTING_DEFAULTS !== 'undefined' ? COSTING_DEFAULTS : {};
      const dayRate = (cs.crewWeekRate || d.crewWeekRate || 40000) / (cs.crewWeekDays || d.crewWeekDays || 6);
      const bom = Array.isArray(item.bom) ? item.bom : [];
      M = bom.length > 0 ? bom.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unitPrice) || 0), 0) : num(item.costMat);
      const days = item.costLaborDays !== undefined ? num(item.costLaborDays) : 0;
      if (days > 0) typedLabor = days * dayRate;
    } else {                                                   // a catalogue line: capitalMaterials only; the live catalogue wins over the snapshot on the line
      const live = (liveById || liveMap()).get(item.id);
      M = num((live ? live.capitalMaterials : undefined) ?? item.capitalMaterials ?? 0);
      bracket = bracketOfSection(item.category);
    }
    if (!(M > 0)) { const b = blank(source); b.basis = basis; return b; }
    const g = r1(M, bracket, typedLabor);
    return { hasBasis: true, M: g.M, labor: g.labor, misc: g.misc, projectCost: g.projectCost, bracket: typedLabor != null ? null : bracket, source: source, estCost: g.projectCost, basis: basis };
  }
  const lineCost = guard('lineCost', () => blank('none'), lineCostOf);
  const adjOf = lc => (lc && lc.listAdj) ? lc.listAdj : 0;      // the list price adjustment of a line (0 for everything but a list-priced Chef Mode line)
  /* KC:C the office flags (settings/quote_builder, read by KCLive.load): catalogueCostPricing is OFF unless the President turned it on (spec 3.5 rule 1) */
  const flags = () => (window.KCLive && window.KCLive.flags) || {};
  const catalogueCostPricing = () => flags().catalogueCostPricing === true;

  /* the price the formula gives a line at the markup in force (project cost x markup + its share of the distributed additional costs), to the nearest 10 pesos */
  function autoUnit(item, lc) {
    lc = lc || lineCost(item);
    if (!lc.hasBasis || lc.source === 'pass-through') return null;
    return R().sellUnit({ projectCost: lc.projectCost, markup: markup(), listAdj: adjOf(lc), share: distribution().add[item._uid] || 0 });
  }

  /* ---------- additional costs (miscCosts): delivery / installation / other = cost x 1.25, no markup; additional labor = cost x the markup in force; each rounded to 100 pesos ---------- */
  const miscOhPct = () => { const cs = G.cs(); return typeof cs.miscOhPct === 'number' ? cs.miscOhPct : 0.25; };
  function miscMult(m) { return ((m && m.type) || 'other') === 'labor' ? markup() : 1 + miscOhPct(); }
  function miscQuoted(m) { return r100(((+(m && m.cost)) || 0) * miscMult(m)); }

  /* ---------- the auto-pricer's cast: the lines the formula may price, and the share of each distributed ("not on quote") additional cost ---------- */
  const autoPriceable = item => window.QBConfigured ? QBConfigured.isAutoPriceable(item) : (item.id !== 'MISCFEE' && !item.priceManual && item.priceBasis === undefined);
  function collectAutos(liveById) {
    const mk = markup(), autos = [], pts = [];
    G.items().forEach(item => {
      if (!item || item.id === 'MISCFEE') return;
      if (isKc(item)) {                                        // a kc line the preparer did not type over; only a PRICED one is handed to the adapter (an unpriced one keeps its flags)
        if (item.passThrough || isManual(item)) return;
        const lc = lineCost(item, liveById);
        if (lc.hasBasis) autos.push({ item: item, qty: qtyOf(item), lc: lc, perUnit: lc.projectCost * mk + adjOf(lc), kc: true });
        return;
      }
      if (!autoPriceable(item)) return;                        // R1 of the configurator: manual, website and unknown bases are protected
      const lc = lineCost(item, liveById);
      if (item.passThrough) { if (lc.hasBasis) { const pu = Math.round(lc.projectCost); if (pu > 0) pts.push({ item: item, qty: qtyOf(item), perUnit: pu }); } return; }     // a pass-through line is the supplier cost, by the person's own choice
      if (!catalogueCostPricing()) return;                     // KC:C spec 3.5 rule 1: a catalogue line keeps its catalogue price for every role; its cost only feeds the calculator, the floor and the lead time
      if (!lc.hasBasis) return;
      autos.push({ item: item, qty: qtyOf(item), lc: lc, perUnit: lc.projectCost * mk, kc: false });
    });
    return { autos: autos, pts: pts };
  }
  function shares(autos) {
    const add = {};
    G.miscs().forEach(m => {
      if (m.reflect) return;                                   // on the quote as its own line: nothing to distribute
      const Q = miscQuoted(m);
      if (Q <= 0 || !autos.length) return;
      let targets = (Array.isArray(m.distTo) && m.distTo.length) ? autos.filter(a => m.distTo.includes(a.item._uid)) : autos;
      if (!targets.length) targets = autos;
      const total = targets.reduce((t, a) => t + a.perUnit * a.qty, 0);
      if (total <= 0) return;
      targets.forEach(a => { add[a.item._uid] = (add[a.item._uid] || 0) + Q * (a.perUnit * a.qty / total) / a.qty; });
    });
    return add;
  }
  const hasDistributed = () => G.miscs().some(m => m && !m.reflect && (+m.cost || 0) > 0);
  const uidsOn = () => { if (typeof ensureItemUids === 'function') ensureItemUids(); };
  function distribution(liveById) {
    if (!hasDistributed()) return { add: {}, autos: null };
    uidsOn();
    const c = collectAutos(liveById);
    return { add: shares(c.autos), autos: c.autos };
  }

  /* ==============================================================================================================
     trueCost(): the old computeTrueCost() keys, on R1 (spec 3.6).  materials / labor / consumables(=misc) / direct are sums over qty; direct = trueCost = the project cost.
     ============================================================================================================== */
  function trueCostOf() {
    const cs = G.cs(), mk = markup(), ovr = markupOvr(), liveById = liveMap();
    let materials = 0, labor = 0, misc = 0, direct = 0, ptCost = 0, target = 0, anyMissing = false;
    const rows = [];
    G.items().forEach((item, idx) => {
      if (!item || item.id === 'MISCFEE') return;              // additional costs carry their own cost below
      const qty = qtyOf(item), lc = lineCost(item, liveById);
      const auto = (lc.hasBasis && lc.source !== 'pass-through') ? R().sellUnit({ projectCost: lc.projectCost, markup: mk, listAdj: adjOf(lc) }) : null;
      rows.push({ idx: idx, item: item, qty: qty, lc: lc, auto: auto });
      if (lc.source === 'pass-through') { ptCost += lc.projectCost * qty; return; }
      if (!lc.hasBasis) { if (!isKc(item) && item.id !== 'CUSTOM') anyMissing = true; return; }
      materials += lc.M * qty; labor += lc.labor * qty; misc += lc.misc * qty; direct += lc.projectCost * qty; target += auto * qty;
    });
    const ohv = miscOhPct();
    let miscCost = 0, miscQuotedSum = 0, miscTrueAdd = 0;
    G.miscs().forEach(m => {
      const c = +m.cost || 0, isLabor = (m.type || 'other') === 'labor';
      miscCost += c;
      miscQuotedSum += m.foc ? 0 : miscQuoted(m);              // FOC: shown FREE, charged nothing
      miscTrueAdd += isLabor ? c : c * (1 + ohv);              // delivery / installation / other cost + 25 %; additional labor at cost
    });
    const floorTotal = direct + miscCost + ptCost;             // the absolute floor: the project cost, the additional costs at cost, pass-through at face value
    const trueCostTotal = direct + miscTrueAdd + ptCost;       // D3: the floor of the discount cap = the R1 project cost
    target = target + miscQuotedSum + ptCost;                  // the computed selling: every costed line at its formula price + the typed additional costs + pass-through at cost
    const tot = (!G.inTotals() && typeof computeTotals === 'function') ? computeTotals() : null;   // 0 while the totals engine is asking for the floor
    const sell = tot ? ((tot.net || 0) - (tot.focFees || 0)) : 0;
    const rushFee = tot ? (tot.rushCharged != null ? tot.rushCharged : (tot.rushFee || 0)) : 0;
    const marginPct = sell > 0 ? (sell - trueCostTotal) / sell : 0;
    return {
      materials: materials, matWaste: 0, laborHrsTotal: 0, laborPesosFallback: 0, laborAssumedPesos: 0, labor: labor, consumables: misc,
      miscCost: miscCost, miscQuoted: miscQuotedSum, miscOhPctv: ohv, ptCost: ptCost, floorTotal: floorTotal, trueCostTotal: trueCostTotal,
      direct: direct, sizeF: 1, pace: 1, paceLive: false, paceComputedAt: undefined,
      ohPct: 0, suggestedOhPct: 0, ohOverridden: false, ohAmt: 0, trueCost: direct, mkPct: mk - 1, mkAmt: direct * (mk - 1), totalLoad: mk - 1,
      target: target, sell: sell, rushFee: rushFee, marginPct: marginPct,
      anyMissingCatalogCost: anyMissing, liveById: liveById, cs: cs,
      d7: true, markup: mk, markupOvr: ovr, rows: rows
    };
  }
  const emptyCost = () => ({
    materials: 0, matWaste: 0, laborHrsTotal: 0, laborPesosFallback: 0, laborAssumedPesos: 0, labor: 0, consumables: 0, miscCost: 0, miscQuoted: 0, miscOhPctv: 0.25, ptCost: 0,
    floorTotal: 0, trueCostTotal: 0, direct: 0, sizeF: 1, pace: 1, paceLive: false, ohPct: 0, suggestedOhPct: 0, ohOverridden: false, ohAmt: 0, trueCost: 0, mkPct: 1, mkAmt: 0,
    totalLoad: 1, target: 0, sell: 0, rushFee: 0, marginPct: 0, anyMissingCatalogCost: false, liveById: new Map(), cs: G.cs(), d7: true, markup: 2, markupOvr: null, rows: []
  });
  const trueCost = guard('trueCost', emptyCost, trueCostOf);

  /* ==============================================================================================================
     the auto-pricer (spec 3.6 `apply`): every costed line that the preparer did not type over is priced at round10(project cost x markup + its share of the distributed costs)
     ============================================================================================================== */
  /* a kc line is priced by the adapter (it owns _kc, needsPrice, priceHeld, the chips); the NUMBER is KCRules.sellUnit({ projectCost, markup, listAdj, share }): the share is added before the one round to 10 pesos */
  function priceKc(item, share) {
    const before = item.unitPrice;
    D7.adapter.price(item, share || 0);                        // KC:C the adapter's own read-only guard applies too (spec 2.2); no second round here: the adapter rounds once
    return item.unitPrice !== before;
  }
  function applyAuto(liveById) {
    if (!ready()) return false;                                // KC:C read-only until the prices are in (spec 2.2)
    uidsOn();
    const c = collectAutos(liveById), add = shares(c.autos);
    let changed = false;
    c.autos.forEach(a => {
      const share = add[a.item._uid] || 0;
      if (a.kc) { if (priceKc(a.item, share)) changed = true; return; }
      const want = R().sellUnit({ projectCost: a.lc.projectCost, markup: markup(), share: share });
      if (want > 0 && a.item.unitPrice !== want) { a.item.unitPrice = want; a.item.amount = want * a.qty; changed = true; }
    });
    c.pts.forEach(p => { if (p.item.unitPrice !== p.perUnit) { p.item.unitPrice = p.perUnit; p.item.amount = p.perUnit * p.qty; changed = true; } });   // pass-through: the supplier cost, verbatim
    return changed;
  }
  const apply = guard('apply', false, cost => (ready() && cost) ? applyAuto(cost.liveById) : false);
  /* repriceAll(): the same pass, for every whole-quote event (a role switch, "Reload DB", a price-list or settings edit, a markup change). Never renders, never saves: the caller does. */
  const sig = () => G.items().map(i => i && i.unitPrice).join('|');
  const repriceAll = guard('repriceAll', false, () => { if (!ready() || !d7on()) return false; const before = sig(); applyAuto(); return sig() !== before; });
  /* autoPrice(): the same pass, for the top of renderItems(). Cheap; idempotent. */
  const autoPrice = guard('autoPrice', false, () => { if (!ready() || !d7on()) return false; const before = sig(); applyAuto(); return sig() !== before; });
  /* reprice(item): the adapter calls this after it adds or edits a kc line; it gets the distributed share and goes through adapter.price */
  const reprice = guard('reprice', false, item => {
    if (!ready() || !d7on()) return false;
    if (!isKc(item)) return applyAuto();
    return priceKc(item, distribution().add[item._uid] || 0);
  });

  /* ---------- "↺ re-apply" (the calculator) and the ↺ beside a typed price ---------- */
  function resetLineData(i) {                                  // the data half (no render): a typed price goes back to the formula; false when the line has no basis to go back to
    if (!i || i.id === 'MISCFEE') return false;
    const lc = lineCost(i);
    if (isKc(i)) {
      if (!lc.hasBasis) return false;                          // "priced after review" / as filed: nothing to go back to, the typed price stays
      delete i.priceManual; i.priceBasis = 'configured'; delete i.needsPrice;
      return true;
    }
    delete i.priceManual;
    if ((i.priceBasis === 'manual' || i.priceBasis === 'website') && lc.hasBasis) i.priceBasis = 'cost';   // R4: the line goes back to the cost rule; one without a basis keeps its price
    return true;
  }
  const resetPrices = guard('resetPrices', null, () => {
    if (!ready()) return;                                      // KC:C read-only until the prices are in (spec 2.2)
    G.items().forEach(resetLineData);
    if (typeof computeMarginSummary === 'function') computeMarginSummary();
  });
  function resetLine(idx) {
    const it = G.items()[idx]; if (!it) return;
    if (!ready()) { showNote('Prices are not loaded, so the price cannot be recomputed yet.'); return; }     // KC:C read-only until the prices are in (spec 2.2)
    if (isKc(it) && !lineCost(it).hasBasis) { showNote('This line has no cost basis yet, so there is no formula price to go back to.'); return; }
    resetLineData(it);
    applyAuto();
    if (typeof saveToStorage === 'function') saveToStorage();
    if (typeof renderItems === 'function') renderItems();
    if (typeof flashItemSaved === 'function') flashItemSaved();
  }
  const showNote = t => { try { if (D7.toast) D7.toast(t); } catch (e) { /* a note must never break a flow */ } };

  /* ---------- the markup for this quote (D3): one number per quote, President only, >= 1; KC.S.markupOvr is where the kc code reads it ---------- */
  function setMarkupOvr(v) {
    if (!can('editSettings')) return markupOvr();
    const n = (v == null || v === '') ? null : Math.round(Number(v) * 1000) / 1000;       // the Pricing settings box rounds the same way: one value, two boxes
    KC.S.markupOvr = (n != null && isFinite(n) && n >= 1) ? n : null;
    if (d7on()) applyAuto();
    if (typeof saveToStorage === 'function') saveToStorage();
    if (typeof renderItems === 'function') renderItems();
    return markupOvr();
  }
  const clearMarkup = () => setMarkupOvr(null);
  function onMarkupChange(val) {                               // the #d7MarkupOvr box: blank clears, a number below 1 is refused and the box snaps back
    const s = String(val == null ? '' : val).trim();
    if (s === '') return clearMarkup();
    const n = parseFloat(s);
    if (!isFinite(n) || n < 1) { showNote('The markup for this quote must be 1 or more.'); if (typeof renderItems === 'function') renderItems(); return markupOvr(); }
    return setMarkupOvr(n);
  }
  /* the pricing fields (E17): the override rides every draft, payload, template and revision. A template starts a NEW quote: it never carries it. */
  const fields = () => (d7on() && markupOvr() != null) ? { markupOvr: markupOvr() } : {};
  function stateWillBeD7(o) {                                  // d7On() is not settled yet while a state loads (#warrantyPlan is written after this hook): ask the state, as applyDocOptions() does
    if (typeof currentCo !== 'undefined' && currentCo === 'BS') return false;
    if (!(o && o.engine === 'kc1')) return false;              // KC:C the engine stamp of the state decides first (spec 2.2): a state without one is a legacy quote
    const given = o ? o.warrantyPlan : undefined;
    if (given === 'service6' || given === 'kitchenshield12') return true;
    const reopen = typeof _loadIsReopen !== 'undefined' && _loadIsReopen, tmpl = typeof _loadIsTemplate !== 'undefined' && _loadIsTemplate;
    return !(!tmpl && (given === '' || (given === undefined && reopen)));
  }
  const applyFields = guard('applyFields', null, o => {
    if (!window.KC || !KC.S) return;
    const tmpl = typeof _loadIsTemplate !== 'undefined' && _loadIsTemplate;
    if (tmpl) G.items().forEach(it => { if (isKc(it)) delete it.priceHeld; });   // KC:C a template starts a NEW quote: its lines follow the price list, never a held price (spec 3.5 rule 2)
    const v = o ? Number(o.markupOvr) : NaN;
    const next = (!tmpl && o && o.markupOvr != null && o.markupOvr !== '' && isFinite(v) && v >= 1) ? v : null;
    const prev = KC.S.markupOvr == null ? null : KC.S.markupOvr;
    KC.S.markupOvr = next;
    /* every loader puts the quote's lines in `items` BEFORE it applies the pricing fields, and the kc lines were hydrated under the PREVIOUS override: price them again under this one */
    if (next !== prev && stateWillBeD7(o)) applyAuto();
  });

  /* ---------- a custom item's cost basis, and the filing blocks that read it (spec 3.8, 3.10) ---------- */
  const customHasBasis = guard('customHasBasis', false, item => {
    if (item && item.kcKind === 'custom') return customParts(item.cfg || {}).M > 0;      // a priced material row, or typed materials above 0
    return (Array.isArray(item && item.bom) && item.bom.length > 0) || (item && item.costMat !== undefined);   // an old custom line: the old rule
  });
  const uncostedReason = guard('uncostedReason', '', () => {
    const bad = G.items().filter(i => i && i.id === 'CUSTOM' && !customHasBasis(i) && !i.noCosting && !i.passThrough);
    if (!bad.length) return '';
    const kcN = bad.filter(isKcCustom).length, oldN = bad.length - kcN, out = [];
    if (kcN) out.push(kcN + ' custom item(s) have no materials yet — open ⚙ edit configuration and pick at least one material from the price list.');
    if (oldN) out.push(oldN + ' custom line(s) have no cost basis — cost them in Internal view before filing.');
    return out.join(' ');
  });
  /* E19 names the text of the "no price" block; the copy's needsPriceReason() still has the old wording (no hook): this is the D7 sentence, ready to wire */
  const needsPriceReason = guard('needsPriceReason', '', () => {
    const n = G.items().filter(i => typeof lineNeedsPrice === 'function' && lineNeedsPrice(i)).length;
    return n ? n + ' line(s) have no price yet: a material has no price, or a custom cost is not typed. Type a unit price, or ask the President to cost the line.' : '';
  });

  /* ==============================================================================================================
     THE STANDARD PRICE OF A LINE (spec 3.4, Q64): what the line sells at with nothing typed over it.  The below-markup warning and the approval rule read it.
       a list-priced kc line (Chef Mode)        its list-based auto price: KCRules.sellUnit at the STANDARD markup + the list adjustment (floorMode 'list'); the formula price when floorMode is 'formula'
       any other kc line with a cost            round10(project cost x the standard markup)
       a catalogue / website line               its catalogue / website price (spec 3.5); with the office flag catalogueCostPricing on and a cost on file, round10(project cost x the standard markup)
       a line with no basis at all              its quoted price (neutral), and the cost is NOT known
     KCRules.standardUnit takes the kinds 'kc' (a configured line: a listAuto above 0 makes it list-priced) and 'catalogue'; the 'kind' this file returns ('list' | 'kc' | 'catalogue' | 'none') is only its own label.
     ============================================================================================================== */
  const stdMarkup = () => num(SET().markup) || 2;
  /* Addendum 1 A1 item 7: once the materials are priced, a formula price (project cost x the standard markup) more than 10 % under the list-based unit is worth a look.  President only (the cost is his), and only while
     the floor mode is 'formula'; it is a warning, never a price change.  -> { formula, list } or null */
  function formulaLow(item, lc) {
    try {
      if (!can('costs') || floorMode() !== 'formula' || !isKc(item) || !lc || !lc.hasBasis || !lc.listed) return null;
      const mk = stdMarkup(), formula = R().sellUnit({ projectCost: lc.projectCost, markup: mk }), list = R().sellUnit({ projectCost: lc.projectCost, markup: mk, listAdj: adjOf(lc) });
      return R().formulaBelowList({ floorMode: floorMode(), formulaSell: formula, listUnit: list }) ? { formula: formula, list: list } : null;
    } catch (e) { return null; }
  }
  const formulaLowText = f => 'The formula price (' + money(f.formula) + ') is more than 10% below the list-based price (' + money(f.list) + '). Check the material prices. The price on the line is not changed.';
  const floorMode = () => (window.KC && window.KC.FLOOR_MODE === 'formula') ? 'formula' : 'list';
  /* the catalogue price of a catalogue / website line: the line's own price while it is the one the calculator (or the website) gave; once a price is typed over it, a FIXED product's base price can be read back from
     the catalogue.  A formula (size-priced) product's price needs the calculator's dimensions, so the page keeps the calculator's price on the line when the line is added (basisUnitPrice, KC mode only: Fable review
     F5) and that is the standard a typed price is held against; a line made before that (no stored price) has none and stays neutral.  null when unknown */
  function catalogueListPrice(item, liveById) {
    if (!item) return null;
    if (!isManual(item)) { const u = num(item.unitPrice); if (u > 0) return u; }
    if (item.familyId) { const w = num(item.basisUnitPrice); return w > 0 ? w : null; }
    const live = (liveById || liveMap()).get(item.id);
    if (live && live.formulaType === 'fixed' && num(live.basePrice) > 0) return num(live.basePrice);       // a fixed product: today's rule, unchanged
    const calc = num(item.basisUnitPrice);                                                                    // F5: the price the calculator gave when the line was added
    return calc > 0 ? calc : null;
  }
  /* -> { unit, known, kind }  per unit; `share` = the line's share of the distributed additional costs (kc lines and cost-priced catalogue lines only) */
  function standardOf(item, lc, liveById) {
    const quoted = num(item.unitPrice), fm = floorMode(), mk = stdMarkup();
    let kind = 'none', args;
    if (isKc(item)) {
      if (lc.hasBasis) {
        kind = lc.listed ? 'list' : 'kc';
        args = { kind: 'kc', floorMode: fm, projectCost: lc.projectCost, stdMarkup: mk, listAuto: lc.listed ? R().sellUnit({ projectCost: lc.projectCost, markup: mk, listAdj: adjOf(lc) }) : null, cataloguePrice: null, quoted: quoted };
      }
    } else if (catalogueCostPricing() && lc.hasBasis && autoPriceable(item)) {
      kind = 'kc';                                             // the office flag is on and a cost is on file: D7's rule, project cost x the standard markup
      args = { kind: 'kc', floorMode: fm, projectCost: lc.projectCost, stdMarkup: mk, listAuto: null, cataloguePrice: null, quoted: quoted };
    } else {
      const cp = catalogueListPrice(item, liveById);
      if (cp != null) { kind = 'catalogue'; args = { kind: 'catalogue', floorMode: fm, projectCost: lc.hasBasis ? lc.projectCost : null, stdMarkup: mk, listAuto: null, cataloguePrice: cp, quoted: quoted }; }
    }
    if (!args) args = { kind: 'none', floorMode: fm, projectCost: null, stdMarkup: mk, listAuto: null, cataloguePrice: null, quoted: quoted };
    const r = R().standardUnit(args) || {};
    return { unit: num(r.unit), known: r.known !== false && kind !== 'none', kind: kind };
  }

  /* the numbers of spec 3.4 for the quote open now (or the nominated option of an options quote): what the cost sidecar stores and what the approval rules compare */
  function standardInfoOf() {
    const liveById = liveMap(), mk = stdMarkup();
    const optOn = typeof optionsOn === 'function' && optionsOn();
    let list = G.items(), tot = null;
    if (optOn && typeof basisOption === 'function' && typeof sectionItems === 'function') {
      const b = basisOption();
      if (b) { list = sectionItems(b.key); tot = b.totals; }
    }
    if (!tot && typeof computeTotals === 'function') tot = computeTotals();
    tot = tot || {};
    const tc = trueCostOf(), dist = distribution(liveById).add;
    let sum = 0, known = true, embedded = 0;
    list.forEach(item => {
      if (!item || item.id === 'MISCFEE') return;
      const lc = lineCost(item, liveById);
      if (item.passThrough || lc.source === 'pass-through') return;            // pass-throughs are added at their quoted amount below
      const q = qtyOf(item), st = standardOf(item, lc, liveById);
      sum += st.unit * q;
      if (!st.known) known = false;
      embedded += (dist[item._uid] || 0) * q;                                  // a distributed additional cost is part of the line price it was spread over
    });
    const standardTotal = sum + embedded + num(tot.ptQuoted) + num(tot.miscFeeTotal) + num(tot.diAdded);
    return {
      net: num(tot.net), grand: num(tot.grand), projectCost: tc.direct, floorTotal: tc.floorTotal,
      costTimesMarkup: tc.floorTotal + tc.direct * (mk - 1), standardTotal: standardTotal, costKnown: known, markup: mk, floorMode: floorMode()
    };
  }
  const standardInfo = guard('standardInfo', () => ({ net: 0, grand: 0, projectCost: 0, floorTotal: 0, costTimesMarkup: 0, standardTotal: 0, costKnown: false, markup: stdMarkup(), floorMode: floorMode() }), standardInfoOf);

  /* ==============================================================================================================
     priceNote(item, idx): under the unit-price box, screen only (spec M11).   "auto ₱x ↺" on a typed price; the below-markup warning (Q64).
       KC:C Q64: the warning threshold of a list-priced line is its list price while the office setting KC.FLOOR_MODE is 'list' (the default); every other line is held against cost x markup (KCRules.belowMarkupThreshold).
       A role without KC.can('costs') reads the cost-based warning without the amount (owner Q31); a list price is the catalogue's own number, so every role reads it.
       A catalogue line has no "auto" price (it sells at its catalogue price: spec 3.5), so it gets the warning only.
     ============================================================================================================== */
  const priceNote = guard('priceNote', '', (item, idx) => {
    if (!item || item.id === 'MISCFEE' || item.passThrough) return '';
    const lc = lineCost(item), ovr = markupOvr(), bits = [];
    const manual = isManual(item);
    if (manual && (isKc(item) || catalogueCostPricing()) && lc.hasBasis && lc.source !== 'pass-through') {
      bits.push('<div class="d7p-auto">auto ' + money(autoUnit(item, lc)) + ' <button type="button" class="cfg-link" onclick="D7.pricing.resetLine(' + (+idx) + ')" title="Go back to the computed price" aria-label="Go back to the computed price">↺</button></div>');
    }
    const est = lc.hasBasis ? lc.projectCost : lc.estCost, typed = num(item.unitPrice);
    if (manual && typed > 0) {
      let th = null, basis = '';
      if (isKc(item) && lc.hasBasis && lc.listed && floorMode() === 'list') {
        th = R().belowMarkupThreshold({ floorMode: 'list', listPrice: R().sellUnit({ projectCost: lc.projectCost, markup: stdMarkup(), listAdj: adjOf(lc) }), projectCost: lc.projectCost, stdMarkup: markup() });
        basis = 'list';
      } else if (!isKc(item) && !catalogueCostPricing() && floorMode() === 'list' && catalogueListPrice(item) != null) {
        th = R().belowMarkupThreshold({ floorMode: 'list', listPrice: catalogueListPrice(item), projectCost: est, stdMarkup: markup() });
        basis = 'list';
      } else if (est != null) {
        th = R().belowMarkupThreshold({ floorMode: 'formula', listPrice: null, projectCost: est, stdMarkup: markup() });
        basis = 'cost';
      }
      if (th != null && R().belowMarkup(typed, th)) {
        const label = basis === 'list' ? '⚠ Below the list price (' + money(th) + ').'
          : '⚠ Below cost × ' + (ovr != null ? 'markup override' : 'standard markup') + (can('costs') ? ' (' + money(th) + ')' : '') + '.';
        bits.push('<div class="d7p-warn kc-below"><span class="ms-chip warn kc-below-chip" role="status">' + label + '</span></div>');
      }
    }
    const low = formulaLow(item, lc);
    if (low) bits.push('<div class="d7p-warn kc-formula-low"><span class="ms-chip warn kc-below-chip" role="status">⚠ ' + tEsc(formulaLowText(low)) + '</span></div>');
    return bits.length ? '<div class="d7p-note no-print">' + bits.join('') + '</div>' : '';
  });

  /* ==============================================================================================================
     panelHtml(cost): the calculator in #marginTbl (spec 3.6).  No dial, no pace, no month-pace hint.
     President: the build, the line table, "Markup for this quote".  Everyone else: no cost figure anywhere: the statement, the markup chip, the line table (line, quantity, price, chips).
     ============================================================================================================== */
  const bracketText = lc => {
    if (lc.source === 'custom-bom' && lc.bracket == null) return 'typed';
    if (!lc.bracket) return '—';
    return BR_LABEL[lc.bracket] + ' ' + brPct(lc.bracket) + '%' + (lc.groups > 1 ? ' +' + (lc.groups - 1) : '');
  };
  function chipsOf(item, lc, costs) {
    const bits = [], ovr = markupOvr();
    if (typeof priceBasisChipHtml === 'function' && !(isKc(item) && !lc.hasBasis && item.priceBasis === 'configured')) bits.push(priceBasisChipHtml(item));   // an unpriced kc line is not "cost-based": its chip is "needs a price"
    if (typeof lineNeedsPrice === 'function' && lineNeedsPrice(item)) bits.push('<span class="ms-chip bad" style="font-size:9px;" title="No price yet: type one in the Unit price box, or ask the President to cost the line. Verify &amp; File is blocked until every such line has a price.">needs a price</span>');
    if (ovr != null && lc.hasBasis && lc.source !== 'pass-through' && !isManual(item) && (isKc(item) || autoPriceable(item))) {
      bits.push('<span class="ms-chip warn" style="font-size:9px;" title="' + aEsc(costs ? 'Priced with the markup for this quote (×' + fmtMk(ovr) + ') instead of the standard markup.' : 'Priced with the markup the President set for this quote.') + '">markup override' + (costs ? ' ×' + fmtMk(ovr) : '') + '</span>');
    }
    if (item.needsReview && !item.reviewed) bits.push('<span class="ms-chip warn" style="font-size:9px;">needs review</span>');
    { const low = costs ? formulaLow(item, lc) : null; if (low) bits.push('<span class="ms-chip warn" style="font-size:9px;" title="' + aEsc(formulaLowText(low)) + '">formula low</span>'); }
    return bits.join(' ');
  }
  const ptToggleHtml = (item, idx) => ((item.familyId || isKc(item)) && !item.passThrough) ? '' :
    '<button type="button" class="ms-chip" style="font-size:9px;border:none;cursor:pointer;background:' + (item.passThrough ? '#dcecfb' : '#f0f0f0') + ';color:' + (item.passThrough ? '#1E5A8A' : 'var(--gray-dark)') + ';" onclick="togglePassThrough(' + (+idx) + ')" title="' +
    (item.passThrough ? 'Pass-through: the supplier price is the client price, no markup. Click to return to cost-based pricing.' : 'Click to make this a pass-through line: the supplier price is the client price, no markup, counted at cost (never as a negative).') +
    '">⇄ ' + (item.passThrough ? 'pass-through' : 'PT') + '</button>';
  /* the website / hand-off lines carry a price basis: the two-figure line and the switch between the website price and the cost-based one (R4, kept by D2) */
  function basisRowHtml(item, idx, lc) {
    if (isKc(item) || item.priceBasis === undefined || !lc.hasBasis) return '';
    const wp = num(item.basisUnitPrice), cp = autoUnit(item, lc), act = item.priceBasis, bits = [];
    if (wp > 0) bits.push('<span class="' + (act === 'website' ? 'on' : '') + '">website ' + money(wp) + '</span>');
    bits.push('<span class="' + (act === 'cost' ? 'on' : '') + '">cost-based ' + money(cp) + '</span>');
    if (act !== 'cost') bits.push('<button type="button" class="cfg-link" onclick="setLinePriceBasis(' + (+idx) + ',\'cost\')">Use cost-based</button>');
    if (act !== 'website' && (wp > 0 || (item.familyId && item._cfg && item._cfg.priced))) bits.push('<button type="button" class="cfg-link" onclick="setLinePriceBasis(' + (+idx) + ',\'website\')">Use website</button>');
    return '<div class="cfg-basis-row">' + bits.join(' · ') + '</div>';
  }

  function presidentPanel(cost) {
    const S = SET(), br = S.br || BR_DEFAULT, mk = cost.markup, ovr = cost.markupOvr;
    const row = (label, val, cls, tip) => '<div class="calc-row ' + (cls || '') + '"' + (tip ? ' title="' + aEsc(tip) + '"' : '') + '><span>' + label + '</span><span class="peso">' + money(val) + '</span></div>';
    const hasMisc = cost.miscCost > 0, hasPt = cost.ptCost > 0, both = hasMisc || hasPt;
    const itemsSelling = cost.target - cost.miscQuoted - cost.ptCost;
    const belowFloor = cost.sell < cost.floorTotal, belowTrue = !belowFloor && cost.sell < cost.trueCostTotal, belowTarget = !belowFloor && !belowTrue && cost.sell < cost.target;
    const color = belowFloor ? 'var(--red)' : belowTrue ? 'var(--orange)' : belowTarget ? 'var(--accent)' : 'var(--green)';
    const noBasis = cost.direct <= 0 && cost.ptCost <= 0 && G.items().length > 0;
    const wd = typeof leadWorkingDays === 'function' ? leadWorkingDays(cost.materials) : 0;
    const deltaP = cost.sell - cost.target;
    const deltaChip = Math.abs(deltaP) < 1 ? '<span class="ms-chip ok" style="font-size:9.5px;">= computed</span>'
      : '<span class="ms-chip" style="font-size:9.5px;background:' + (deltaP < 0 ? '#fdecea' : '#e8f2e8') + ';color:' + (deltaP < 0 ? '#b03024' : '#2e7d32') + ';">' + (deltaP < 0 ? '−' : '+') + money(Math.abs(deltaP)) + ' vs computed</span>';
    const ref = cost.sell > 0 ? cost.sell : cost.target, off = Math.max(0, ref - cost.trueCostTotal);

    const build = '<div class="calc-card" id="d7BuildCard">'
      + '<div class="calc-card-title">The build</div>'
      + row('Materials', cost.materials)
      + row('+ Labor (' + br.simple + ' / ' + br.medium + ' / ' + br.complex + ' % by bracket)', cost.labor, 'sub', 'Labor is the materials of each line times its bracket: Simple ' + br.simple + '%, Medium ' + br.medium + '%, Complex ' + br.complex + '% (Pricing settings). Cooking lines from the catalogue are Complex, every other catalogue line Medium.')
      + row('+ Misc ' + miscPct() + ' %', cost.consumables, 'sub', 'Misc is ' + miscPct() + '% of the materials plus the labor.')
      + row(both ? 'PROJECT COST (items)' : 'PROJECT COST (floor)', cost.direct, 'total')
      + '<div class="calc-row sub"><span>× markup ' + fmtMk(mk) + ' <em class="calc-note">' + (ovr != null ? 'markup for this quote' : 'standard') + ' · <a href="javascript:void(0)" onclick="resetPricesToComputed()" title="Clear hand-typed prices: every costed line returns to its computed price">↺ re-apply</a></em></span><span class="peso"></span></div>'
      + row('COMPUTED SELLING (items)', itemsSelling, 'total', 'Every costed line at project cost × markup, to the nearest 10 pesos.')
      + (hasPt ? row('+ Pass-through items (supplier price)', cost.ptCost, 'sub', 'No markup: the supplier price is the client price (owner ruling 2026-09-21). Counted at cost in the floors: zero margin, never a negative.') : '')
      + (hasMisc ? row('+ Additional costs (typed)', cost.miscQuoted, 'sub', 'Delivery, installation and other at cost + 25 %, no markup; additional labor at cost × the markup in force. See the Additional costs table above.') : '')
      + row('SELLING (total)', cost.target, 'grand')
      + '<div class="calc-row grand quoted"><span>QUOTED (net) ' + deltaChip + '</span><span class="peso">' + money(cost.sell) + '</span></div>'
      + '<div class="calc-row total" style="color:var(--red);" title="The deepest total you may offer a client: the project cost, with all of the markup given away. A discount stops here automatically: it can never take the quote below the project cost."><span>🛑 Lowest offer: the project cost</span><span class="peso">' + money(cost.trueCostTotal) + '</span></div>'
      + '<div class="calc-row sub" style="border-bottom:none;"><span>' + (off > 0 ? '= room to give up to −' + money(off) + ' (' + (off / ref * 100).toFixed(1) + '% off the ' + (cost.sell > 0 ? 'quoted' : 'computed') + ' ' + money(ref) + ')' : 'no discount room: already at or below the project cost') + '</span><span></span></div>'
      + (Math.abs(cost.trueCostTotal - cost.floorTotal) >= 0.005 ? '<div class="calc-row sub" style="border-bottom:none;"><span title="Never quote below the project cost without President approval; below the absolute floor is a cash loss.">Floors: project cost ' + money(cost.trueCostTotal) + ' · absolute ' + money(cost.floorTotal) + '</span><span></span></div>' : '')
      + '<div class="calc-row sub" style="border-bottom:none;"><span title="25 working days minimum, or 12 working days + 3 working days per 20k pesos of materials if that is longer; Sundays never counted.">Timeline: ' + wd + ' working days (no Sundays) ≈ ' + (wd / 6).toFixed(1) + ' weeks</span><span></span></div>'
      + (noBasis
        ? '<div style="font-size:12px;color:var(--gray-dark);font-style:italic;margin-top:6px;">No cost basis on these lines yet: configured lines and catalogue items with a cost on file are costed here; give a custom item its materials from the price list.</div>'
        : '<div style="font-weight:700;color:' + color + ';margin-top:6px;font-size:12.5px;">Margin at quoted: ' + (cost.marginPct * 100).toFixed(1) + '% (' + money(cost.sell - cost.trueCostTotal) + ')' + (cost.rushFee > 0 ? ' · ⚡ priority charge +' + money(cost.rushFee) + ' on top' : '') + '</div>')
      + (belowFloor ? '<div style="margin-top:6px;background:#fdecea;border:1px solid #f3b8b1;color:#b03024;border-radius:6px;padding:7px 10px;font-size:12px;font-weight:600;">⚠️ Below project cost: the President’s approval is required</div>' : '')
      + '</div>';

    let sumM = 0, sumPC = 0, sumAuto = 0, sumPrice = 0;
    const body = cost.rows.map(r => {
      const item = r.item, idx = r.idx, lc = r.lc, qty = r.qty, up = num(item.unitPrice);
      const name = tEsc(item.name || ''), chips = chipsOf(item, lc, true), pt = ptToggleHtml(item, idx);
      if (lc.source === 'pass-through') {
        const diff = up - lc.projectCost;
        const mkCell = Math.abs(diff) < 1 ? '<span style="color:var(--gray-dark);font-weight:600;" title="Pass-through: sold at the supplier cost by design: zero margin, not a negative.">at cost</span>'
          : '<span style="color:' + (diff < 0 ? 'var(--red)' : 'var(--green)') + ';" title="This pass-through line is priced ' + (diff < 0 ? 'below' : 'above') + ' its supplier cost of ' + aEsc(money(lc.projectCost)) + '.">' + (diff < 0 ? '−' : '+') + money(Math.abs(diff)) + '</span>';
        sumPrice += up * qty;
        return '<tr><td class="n">' + name + ' ' + chips + ' ' + pt + '</td><td class="c">' + qty + '</td><td class="c">—</td><td class="r">—</td><td class="r">' + money(lc.projectCost) + '</td><td class="r">' + money(lc.projectCost) + '</td>'
          + '<td class="r"><input type="number" class="calc-price" min="0" step="1" value="' + up + '" onchange="updatePrice(' + idx + ',this)" title="Pass-through price: set to the supplier cost; type to override." aria-label="Price of ' + aEsc(item.name || 'line') + '"></td><td class="r" style="font-weight:700;">' + mkCell + '</td></tr>';
      }
      if (!lc.hasBasis) {
        const why = isKc(item) ? (lc.source === 'kc-unavailable' ? 'configurator not loaded' : (lineNeedsPrice(item) ? 'priced after review' : 'no cost basis')) : (item.familyId ? 'No cost basis on this item yet' : (item.id === 'CUSTOM' ? 'needs costing' : 'no cost on file'));
        sumPrice += up * qty;
        return '<tr><td class="n">' + name + ' ' + chips + ' ' + pt + '</td><td class="c">' + qty + '</td><td colspan="4" class="c"><span class="ms-chip" style="background:#eee;color:var(--gray-dark);" title="' + aEsc(lc.missing && lc.missing.length ? 'Missing: ' + lc.missing.join('; ') : 'This line adds nothing to the project cost; it keeps its price.') + '">' + why + '</span></td><td class="r">' + money(up) + '</td><td class="r"></td></tr>';
      }
      const auto = autoUnit(item, lc), pcU = lc.projectCost;
      sumM += lc.M * qty; sumPC += pcU * qty; sumAuto += auto * qty; sumPrice += up * qty;
      const eff = (up > 0 && pcU > 0) ? up / pcU : null, effColor = eff == null ? 'var(--gray-dark)' : (up < pcU ? 'var(--red)' : (up + 0.005 < auto ? 'var(--orange)' : 'var(--green)'));
      return '<tr><td class="n">' + name + ' ' + chips + ' ' + pt + basisRowHtml(item, idx, lc) + '</td><td class="c">' + qty + '</td><td class="c">' + bracketText(lc) + '</td><td class="r">' + money(lc.M) + '</td><td class="r">' + money(pcU) + '</td><td class="r">' + money(auto) + '</td>'
        + '<td class="r"><input type="number" class="calc-price" min="0" step="0.01" value="' + up + '" onchange="updatePrice(' + idx + ',this)" title="Type any price to experiment: it sticks as a manual price and the markup column shows what it really gives. ↺ re-apply clears it." aria-label="Price of ' + aEsc(item.name || 'line') + '"></td>'
        + '<td class="r" style="font-weight:700;color:' + effColor + ';" title="Markup at this price: price ÷ project cost">' + (eff == null ? '—' : '×' + eff.toFixed(2)) + '</td></tr>';
    }).join('');
    const table = '<div class="calc-card" id="d7LinesCard"><div class="calc-card-title">Lines: type any price, the markup column adjusts</div><div style="overflow-x:auto;"><table class="labor-tbl exp-tbl d7p-tbl" style="min-width:640px;">'
      + '<thead><tr><th>Line</th><th class="c">Qty</th><th class="c">Bracket</th><th class="r">Materials/u</th><th class="r">Project cost/u</th><th class="r">Auto/u</th><th class="r">Price/u</th><th class="r">Markup</th></tr></thead>'
      + '<tbody>' + (body || '<tr><td colspan="8" style="text-align:center;color:var(--gray-dark);padding:10px;">Add items: each line becomes a row you can experiment on.</td></tr>') + '</tbody>'
      + '<tfoot><tr style="font-weight:700;background:#fff5e0;"><td colspan="3">Totals (× quantity)</td><td class="r">' + money(sumM) + '</td><td class="r">' + money(sumPC) + '</td><td class="r">' + money(sumAuto) + '</td><td class="r">' + money(sumPrice) + '</td><td></td></tr></tfoot>'
      + '</table></div><div class="calc-note" style="margin-top:6px;">Computed prices round to the nearest 10 pesos. A typed price sticks as <em>manual</em> until ↺. Lines with no cost basis keep their price and add nothing to the project cost. Each total is the sum of its column.</div></div>';

    const mkCard = can('editSettings') ? '<div class="calc-card" id="d7MarkupCard"><div class="calc-card-title">Markup for this quote</div>'
      + '<div class="d7p-markup"><label for="d7MarkupOvr">×</label><input type="number" id="d7MarkupOvr" min="1" step="0.05" value="' + (ovr != null ? ovr : '') + '" placeholder="' + fmtMk(num(S.markup) || 2) + ' (standard)" onchange="D7.pricing.onMarkupChange(this.value)" aria-label="Markup for this quote, blank for the standard">'
      + '<a href="javascript:void(0)" class="cfg-link" onclick="D7.pricing.clearMarkup()" title="Go back to the standard markup">Clear</a></div>'
      + '<div class="calc-note">Every cost-based line on this quote is priced at project cost × this number. Blank = the standard ×' + fmtMk(num(S.markup) || 2) + '. One number for the whole quote; a discount still stops at the project cost.</div></div>' : '';
    return '<div class="calc-grid d7p-grid">' + build + table + mkCard + '</div>';
  }

  function rolePanel(cost) {
    const ovr = cost.markupOvr, wd = typeof leadWorkingDays === 'function' ? leadWorkingDays(cost.materials) : 0;
    const body = cost.rows.map(r => {
      const item = r.item, up = num(item.unitPrice);
      return '<tr><td class="n">' + tEsc(item.name || '') + ' ' + chipsOf(item, r.lc, false) + '</td><td class="c">' + r.qty + '</td><td class="r">' + money(up) + '</td><td class="r">' + money(up * r.qty) + '</td></tr>';
    }).join('');
    return '<div class="calc-grid"><div class="calc-card" id="d7BuildCard"><div class="calc-card-title">The build</div>'
      + '<div class="calc-row sub"><span>Costs are visible to the President only.</span></div>'
      + (ovr != null ? '<div class="calc-row"><span><span class="ms-chip warn" style="font-size:10px;" title="The President set one markup for this quote.">markup override</span></span><span></span></div>' : '')
      + '<div class="calc-row sub" style="border-bottom:none;"><span>Timeline: ' + wd + ' working days (no Sundays) ≈ ' + (wd / 6).toFixed(1) + ' weeks</span><span></span></div></div>'
      + '<div class="calc-card" id="d7LinesCard"><div class="calc-card-title">Lines</div><div style="overflow-x:auto;"><table class="labor-tbl exp-tbl d7p-tbl" style="min-width:420px;">'
      + '<thead><tr><th>Line</th><th class="c">Qty</th><th class="r">Price/u</th><th class="r">Amount</th></tr></thead>'
      + '<tbody>' + (body || '<tr><td colspan="4" style="text-align:center;color:var(--gray-dark);padding:10px;">No lines yet.</td></tr>') + '</tbody></table></div></div></div>';
  }
  const panelHtml = guard('panelHtml', () => '<div class="calc-card">The calculator could not be drawn.</div>', cost => {
    cost = cost || trueCost();
    return can('costs') ? presidentPanel(cost) : rolePanel(cost);
  });

  /* ---------- a little CSS of its own (this file ships no stylesheet) ---------- */
  (function css() {
    if (document.getElementById('d7-pricing-css')) return;
    const s = document.createElement('style'); s.id = 'd7-pricing-css';
    s.textContent = '.d7p-note{margin-top:2px;text-align:right;font-size:10.5px;line-height:1.35;color:var(--gray-dark);}'
      + '.d7p-note .cfg-link{display:inline-block;width:auto;font-size:12px;min-width:30px;min-height:30px;vertical-align:middle;}'
      + '.d7p-note .ms-chip{display:inline-block;white-space:normal;text-align:left;font-size:10px;padding:2px 8px;margin-top:2px;}'
      + '.d7p-tbl th.r,.d7p-tbl td.r{text-align:right;}.d7p-tbl th.c,.d7p-tbl td.c{text-align:center;}'
      + '.d7p-tbl td.n{white-space:normal;min-width:170px;font-size:12px;line-height:1.5;}.d7p-tbl td.n .ms-chip,.d7p-tbl td.n .ms-chip + button{display:inline-block;margin:2px 2px 2px 0;line-height:1.4;vertical-align:middle;}'
      + '.d7p-tbl .cfg-basis-row{white-space:normal;font-size:10.5px;color:var(--gray-dark);}.d7p-tbl .cfg-basis-row .on{font-weight:700;color:var(--dark-blue);}'
      + '.d7p-markup{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:2px 0 6px;}'
      + '.d7p-markup label{display:inline-block;margin:0;font-size:16px;font-weight:800;color:var(--dark-blue);}'
      + '#d7MarkupCard .d7p-markup input#d7MarkupOvr{display:inline-block;width:130px;max-width:100%;text-align:right;border:1.5px dashed var(--mid-blue);border-radius:4px;padding:4px 8px;font-size:14px;font-weight:700;background:#fff;}'
      /* the calculator grid: build + markup on top, the line table full width under them; on a wide screen the table sits beside them; one column on a phone (build, lines, markup) */
      + '.calc-grid.d7p-grid{grid-template-columns:minmax(330px,440px) minmax(0,1fr);grid-template-areas:"build markup" "lines lines";}'
      + '.d7p-grid>#d7BuildCard{grid-area:build;min-width:0;}.d7p-grid>#d7LinesCard{grid-area:lines;min-width:0;}.d7p-grid>#d7MarkupCard{grid-area:markup;min-width:0;}'
      + '@media(min-width:1400px){.calc-grid.d7p-grid{grid-template-areas:"build lines" "markup lines";}}'
      + '@media(max-width:900px){.calc-grid.d7p-grid{grid-template-columns:minmax(0,1fr);grid-template-areas:"build" "lines" "markup";}}'
      + '@media(max-width:768px){#d7MarkupCard .d7p-markup input#d7MarkupOvr{min-height:44px;font-size:16px;}.d7p-markup .cfg-link{min-height:44px;min-width:44px;display:inline-flex;align-items:center;padding:0 12px;}'
      + '.d7p-note .cfg-link{min-height:44px;min-width:44px;}.d7p-tbl .calc-price{min-height:36px;font-size:14px;}}';
    document.head.appendChild(s);
  })();

  /* ---------- exports ---------- */
  Object.assign(D7.pricing, {
    lineCost: lineCost, autoUnit: autoUnit, trueCost: trueCost, apply: apply, panelHtml: panelHtml, resetPrices: resetPrices, customHasBasis: customHasBasis, uncostedReason: uncostedReason,
    needsPriceReason: needsPriceReason, priceNote: priceNote, fields: fields, applyFields: applyFields, repriceAll: repriceAll, reprice: reprice, autoPrice: autoPrice,
    resetLine: resetLine, markupOvr: markupOvr, setMarkupOvr: setMarkupOvr, clearMarkup: clearMarkup, onMarkupChange: onMarkupChange, miscMult: miscMult, miscQuoted: miscQuoted,
    standardInfo: standardInfo, standardOf: standardOf, floorMode: floorMode, stdMarkup: stdMarkup, formulaLow: formulaLow,
    _r1: r1, _customParts: customParts, _resetLineData: resetLineData, ready: true
  });
})();
