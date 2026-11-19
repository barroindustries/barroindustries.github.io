/* qb/d7/d7-adapter.js: D7.adapter, the BRIDGE between the kc panel (qb/kc/host-d7.js) and the quote builder's items[]  (specs/BK-LIVE-INTEGRATION-SPEC-2026-11-19.md sections 2.2, 3.4, 3.5, 5 packet C).
   Ported from the D7 prototype's d7/d7-adapter.js; what is different in the live builder is marked KC:C.

   THE RULE OF DIRECTION: the kc panel never reads `items`; it calls D7.adapter.*. The builder never reads KC.S; it calls D7.h('adapter.<hook>', ...).
   d7-pricing.js and d7-doc.js may call KC.priceOf, KC.check, KC.products[kind] and read item.cfg. After any change the adapter calls the builder's own saveToStorage() and renderItems().

   A KC LINE is an item of the builder's items[] with `kcKind`. id 'KC' (a configured product) or 'CUSTOM' (the kc custom item, kcKind 'custom'); kcId 'K1', 'K2' ... unique in the quote; cfg;
   category = the section (a tab id); name / dims / specEdit / notes filled from the kc text by refresh(); doc = the print snapshot; formulaType 'configurable' (product) / 'fixed' (custom);
   priceBasis 'configured' | 'manual'; basisUnitPrice (what "auto ₱x ↺" shows, or "now ₱x ↺" on a held line); needsPrice; needsReview + reviewReasons; reviewed (false, or the reviewer's name) + reviewedAt;
   priceHeld (KC:C, spec 3.5 rule 2: a line loaded from a FILED quote keeps its stored price when the price list now gives another one; saved with the line);
   _kc (RUNTIME ONLY, stripped like _cfg: { priced, missing[], unit, projectCost, M, groups[], lines[], markup, markupOvr, list, hoodNo, stale, asFiled, fromFiled, unknown }).

   THE HOOKS (D7.h('adapter.<name>') or direct calls; every one is on D7.adapter):
     renderTabs()  setTab(id, focus)  renderCatalogue()  kindForSku(sku)  configureInstead(sku)
     commit(line, {editIdx, ref})       the panel's "Add to Quote" / "Update line": line = {kind, cfg, start, qty, unit, note, reviewed}. Returns the MIRROR line or null.  KC:C: null while the prices have not loaded.
     edit(idx)  addCustom()  refresh(item)  price(item, sharePerUnit)  reprice(item)  repriceAll()  hydrate(item)  sync()  afterItemsChange(name, idx)  lineRow(item, idx)  markReviewed(idx, on, quiet)
     releaseHold(idx)                   KC:C: the "↺" of a held price: take the fresh price and clear the hold
     publicItem(x) / sidecarRow(it) / graft(item, row)    the typed costs leave the payload and ride the sidecar; graft puts them back
     reset()  itemOf(line|id)  indexOf(line|id)  lineOfItem(item)
   ON KC: KC.addLine(kind, cfg, o) KC.clearLines() KC.lineById(id) KC.lineNo(id) KC.ensureIds()   (o = {start, qty, unit, note, reviewed, priceOvr, after:kcId, render:false to skip saving / drawing})

   THE MIRROR KC.S.lines: { id:kcId, kind, cfg (the SAME object as the item's), start, qty, unit, note, reviewed, priceOvr, flag }, in document order, one per kc line. It is index-preserving (slot N-1 = the line the builder
   prints as number N) because product-duct.js prints "Item N" from the index + 1.

   PRICE: pr = KC.priceOf(kind, cfg) (it applies the markup override, custom items too). Not manual and priced: unitPrice = KCRules.sellUnit({ projectCost, markup in force, listAdj, share }) (the list adjustment is 0 except for a
   list-priced Chef Mode line; the distributed share of the additional costs is added BEFORE the rounding), amount = unitPrice x qty, priceBasis 'configured'. Not priced: needsPrice, unitPrice 0 (a stored price survives on a line
   loaded "as filed"). Manual: the typed price stays.
   KC:C READ-ONLY UNTIL THE PRICES ARE IN (spec 2.2): while KCLive.ready is false, price(), repriceAll() and settling a loaded line return at once, so no stored unitPrice / amount / needsPrice / reviewed can change. */
(function(){
'use strict';
const D7 = window.D7, KC = window.KC, S = KC.S, A = D7.adapter, esc = KC.esc, clone = KC.clone;
const ALL = ['all','prep','wash','cook','vent','cold','multi','mech'];
const isKc = it => !!(it && it.kcKind);
const defOf = k => KC.defOf ? KC.defOf(k) : (k==='custom' ? KC.customDef : KC.products[k]);
const on = () => { try{ return typeof d7On==='function' && d7On(); }catch(e){ return false; } };
const nowIso = () => new Date().toISOString();
const round2 = n => Math.round((Number(n)||0)*100)/100;
const $ = id => document.getElementById(id);
const safe = (fn, dflt) => { try{ return fn(); }catch(err){ console.error('D7 adapter:', err); return dflt; } };
const isManual = it => !!(it && (it.priceBasis==='manual' || it.priceManual));
/* KC:C the one copy of the money maths is qb/kc-rules.js (window.KCRules): this file only calls it */
const R = () => window.KCRules;
/* KC:C read-only until the prices have loaded (spec 2.2): KCLive.ready is false while qb/kc-live.js is still reading them, and for good when the read failed */
const ready = () => !!(window.KCLive && window.KCLive.ready);
/* KC:C who reviewed: the signed-in user's own name (KCLive.userName), else the cast name of the role */
const roleName = () => (window.KCLive && window.KCLive.userName) || (KC.ROLES[S.role]||KC.ROLES.sales||KC.ROLES.president).name;
/* KC:C the page's reopen lineage: true while the quote open now was loaded from a FILED quote (reopen or new revision), i.e. the app stamped a sourceDocId on it */
const fromFiledLoad = () => { try{ return typeof reopenSourceDocId!=='undefined' && !!reopenSourceDocId; }catch(e){ return false; } };
const toast = (t, k) => D7.toast(t, k);
const REVIEW_REASON_FALLBACK = 'custom part';
/* Ducting is priced per job, so every ventilation line needs review (Addendum 1 A1; packet B puts that sentence in the check of every ventilation line).  A blower is a COST like any other material (Addendum 2 B1):
   it prices by the normal formula and is no review reason; the older "Blower price to be confirmed by Neil." reason and the President-only lock on a blower line are gone. */
const DUCTING_REASON = 'Ducting is priced per job; check before sending.';

/* ═════════ ids ═════════ */
let seq = 0;                                                       // the highest kcId number ever handed out in this session, so a deleted hood's id is not reused
function nextId(){
  let max = seq;
  items.forEach(it => { const m = isKc(it) && /^K(\d+)$/.exec(String(it.kcId||'')); if(m) max = Math.max(max, +m[1]); });
  seq = max + 1; return 'K' + seq;
}
/* every kc line has a kcId and no two share one (an imported file, a duplicated line): the first keeps it, a later one gets a new one */
function ensureIds(){
  const seen = new Set();
  items.forEach(it => { if(!isKc(it)) return; if(!it.kcId || seen.has(it.kcId)) it.kcId = nextId(); seen.add(it.kcId); });
}
const hoodOf = kcId => kcId ? (items.find(x => isKc(x) && x.kcId===kcId && x.kcKind==='hood') || null) : null;
const ventsOf = hood => items.filter(v => isKc(v) && v!==hood && v.cfg && v.cfg.hoodRef===hood.kcId);

/* the number the builder prints in the # column for items[idx] (null in an options quote: every section restarts at 1) */
function numberOf(idx){ return safe(() => (typeof lineNoOf==='function' ? lineNoOf(idx) : null), null); }
const refOf = idx => { const n = numberOf(idx); return n ? 'item '+n : '"'+String((items[idx]||{}).name||'line').slice(0,40)+'"'; };

/* ═════════ sections (spec 3.1: a line's category is its section = a tab id) ═════════ */
function sectionOf(kind, cfg){
  if(kind==='custom') return D7.sectionFor({ id:'CUSTOM', category:cfg && cfg.cat });
  const D = defOf(kind);
  return D7.sectionFor({ id:'kc:'+kind, category:D ? KC.tabOf(D) : '' });
}

/* ═════════ the mirror: KC.S.lines ═════════ */
const mirrors = new WeakMap();
function mirrorOf(item){
  let m = mirrors.get(item);
  if(!m){ m = {}; Object.defineProperty(m, '_item', { value:item, enumerable:false, writable:true }); mirrors.set(item, m); }
  m._item = item;
  m.id = item.kcId; m.kind = item.kcKind; m.cfg = item.cfg; m.start = item.kcStart; m.qty = item.qty; m.unit = item.unit; m.note = item.notes || '';
  m.reviewed = item.reviewed || false; m.priceOvr = isManual(item) ? (Number(item.unitPrice)||0) : null; m.flag = item.flag;
  return m;
}
function rebuildMirror(){
  const L = S.lines; L.length = 0;
  const kcIdx = []; items.forEach((it, i) => { if(isKc(it)) kcIdx.push(i); });
  if(!kcIdx.length) return;
  const nums = kcIdx.map(i => numberOf(i));
  if(nums.every(n => n && n>=1)) kcIdx.forEach((i, k) => { L[nums[k]-1] = mirrorOf(items[i]); });      // slot N-1 = the line the builder prints as number N
  else kcIdx.forEach(i => { L.push(mirrorOf(items[i])); });                                            // an options quote (no single numbering): items order
}
A.itemOf = function(ln){
  if(!ln) return null;
  if(typeof ln==='object' && isKc(ln) && items.indexOf(ln)>=0) return ln;
  const id = typeof ln==='string' ? ln : ln.id;
  return items.find(x => isKc(x) && x.kcId===id) || (typeof ln==='object' && isKc(ln) ? ln : null);
};
A.indexOf = ln => { const it = A.itemOf(ln); return it ? items.indexOf(it) : -1; };
A.lineOfItem = it => isKc(it) ? mirrorOf(it) : null;

/* ═════════ text: name, dims, specs, the print snapshot (spec 3.2 / 3.4) ═════════ */
/* needsReview / reviewReasons from the host's check (custom part, custom item, ventilation sizing ...) */
function review(item){
  const D = defOf(item.kcKind); if(!D) return;
  const v = safe(() => KC.check(item.kcKind, item.cfg), null);
  item.needsReview = !!(v && v.review.length);
  item.reviewReasons = v ? v.review.slice() : [];
  if(item.kcKind==='custom'){ item.needsReview = true; if(!item.reviewReasons.length) item.reviewReasons = ['custom item']; }       // Q31 / D4: a custom item always needs review
  if(item.kcKind==='vent' && item.reviewReasons.indexOf(DUCTING_REASON) < 0){ item.needsReview = true; item.reviewReasons.push(DUCTING_REASON); }   // A1: ducting is priced per job (the check says it already; this is the second lock)
}
/* the reasons of a line as one text: the short ones first ("custom part, ventilation sizing."), then the whole sentences ("Ducting is priced per job; check before sending.") */
function reasonText(reasons){
  const all = (Array.isArray(reasons) ? reasons : []).map(r => String(r)).filter(Boolean), whole = r => /[.!?]$/.test(r);
  const shorts = all.filter(r => !whole(r)), sents = all.filter(whole);
  return (shorts.length ? shorts.join(', ') + '.' : '') + (sents.length ? (shorts.length ? ' ' : '') + sents.join(' ') : '') || REVIEW_REASON_FALLBACK + '.';
}
/* the item code a line prints (Addendum 2 B2): the price-list code of the model the line is built from (KC.baseModel: PS-PT-1200, CK-HP-4 ...), '' for a line that has no code (the custom item, the kitchen station,
   ventilation, a Chef Mode model that is not on the list).  It is a pure function of the configuration, so it needs no prices; the print block draws it as small grey text at the start of the description. */
function codeOf(item){
  if(!isKc(item) || item.kcKind==='custom') return '';
  const m = safe(() => KC.baseModel(item.kcKind, item.cfg), null);
  return m && typeof m.code==='string' ? m.code : '';
}
A.codeOf = codeOf;
/* name, dims, specEdit (plain text) and the print snapshot `doc` from the cfg. The hood number a ventilation line names is the builder's (the mirror is index-preserving). */
function describe(item){
  const D = defOf(item.kcKind); if(!D) return item;
  const c = item.cfg, custom = !!D.custom;
  if(custom){ item.use = item.use || 'commercial'; }
  else { item.use = String(c.use || 'commercial').toLowerCase(); item.purpose = c.purpose || ''; }
  const cc = custom ? Object.assign({}, c, { use:item.use }) : c;                       // a custom item's use is the line's (the Details pills set item.use)
  const L = KC.printParts(D, cc), ix = D.incl(cc), forced = D.notes ? D.notes(cc) : [];
  const specs = c.txt && c.txt.specs ? String(c.txt.specs) : KC.htmlToText(KC.autoSpecs(item.kcKind, cc));
  item.name = L.title; item.dims = L.dims; item.specEdit = specs;
  item.doc = { code:codeOf(item), material:L.material, use:L.use, title:L.title, sub:L.sub, dims:L.dims, specs,
               notes:(item.notes ? [String(item.notes)] : []).concat(forced), includes:(ix.i||[]).slice(), excludes:(ix.x||[]).slice() };
  if(item.kcKind==='vent' && c.hoodRef){ const h = hoodOf(c.hoodRef); if(h){ const k = item._kc || (item._kc = {}); k.hoodNo = numberOf(items.indexOf(h)); } }
  return item;
}
function refresh(item){
  if(!isKc(item)) return item;
  describe(item); review(item);
  return item;
}

/* ═════════ price (spec 3.2 "Reprice"; spec 2.2 read-only until the prices are in; spec 3.5 rule 2 the price hold) ═════════ */
function price(item, share, opts){
  opts = opts || {};
  if(!ready()) return item;                                                                       // KC:C read-only guard: no stored unitPrice / amount / needsPrice changes before the prices have loaded (spec 2.2)
  if(!isKc(item)) return item;
  const D = defOf(item.kcKind);
  const k = item._kc || (item._kc = {});
  if(!D){ k.unknown = true; return item; }
  delete k.unknown;
  let pr = null;
  try{ pr = KC.priceOf(item.kcKind, item.cfg); }catch(err){ console.error('D7 adapter: pricing failed for', item.kcKind, err); }
  const sh = Number(share) || 0, priced = !!(pr && pr.priced), manual = isManual(item);
  const adj = priced && pr.list ? (Number(pr.list.adj) || 0) : 0;                                 // owner R4 Q23: a list-priced line (Chef Mode) sells at the list price + what its options add by formula
  const auto = priced ? R().sellUnit({ projectCost:pr.projectCost, markup:KC.effMarkup(), listAdj:adj, share:sh }) : null;   // the share is added BEFORE the round (spec 6.2)
  const fromFiled = !!k.fromFiled;                                                                 // KC:C set by settle(): this line was loaded from a FILED quote and has not been priced since
  Object.assign(k, { priced, missing:(pr && pr.missing) ? pr.missing.slice() : [], unit:priced ? pr.unit : 0, projectCost:pr ? pr.projectCost : 0, M:pr ? pr.M : 0,
                     groups:pr ? pr.groups : [], lines:pr ? pr.lines : [], markup:KC.effMarkup(), markupOvr:(pr && pr.markupOvr) || null, list:priced && pr.list ? pr.list : null, asFiled:false });
  if(priced) item.basisUnitPrice = auto; else delete item.basisUnitPrice;
  /* spec 3.5 rule 2: a kc line loaded from a filed quote keeps its stored unitPrice when the fresh price differs. The decision is made ONCE, at the first priced pass after the load; the flag is saved with
     the line (priceHeld), so a draft, a refile and a later reopen keep it until the person presses "↺ now ₱x" or edits the line's configuration. Drafts and templates that never came from a filed quote are not held. */
  let held = false;
  if(!manual && priced){
    if(fromFiled){ delete k.fromFiled; if(R().shouldHold({ fromFiled:true, basis:item.priceBasis || 'configured', stored:Number(item.unitPrice) || 0, fresh:auto })) item.priceHeld = true; }
    held = !!item.priceHeld && Number(item.unitPrice) > 0 && Number(item.unitPrice) !== auto;
    if(!held) delete item.priceHeld;                                                              // the fresh price is the stored one again: nothing to hold
  }
  const keepStored = !!(opts.asFiled || item.priceHeld) && Number(item.unitPrice) > 0;
  if(manual){
    delete item.priceHeld; delete k.fromFiled;
    if(Number(item.unitPrice) > 0) delete item.needsPrice; else item.needsPrice = true;                        // a typed price stays; with none typed the line still needs one
  } else if(priced){
    if(held){ item.priceBasis = 'configured'; delete item.needsPrice; }                            // the stored price stays; the fresh one is in basisUnitPrice ("now ₱x ↺")
    else { item.unitPrice = auto; item.priceBasis = 'configured'; delete item.needsPrice; }
  } else if(keepStored){
    k.asFiled = true; item.priceBasis = item.priceBasis || 'configured'; delete item.needsPrice;                // a filed price whose typed costs are not readable in this session: it stays
  } else {
    item.unitPrice = 0; item.priceBasis = 'configured'; item.needsPrice = true;
  }
  item.amount = (Number(item.unitPrice)||0) * (Number(item.qty)||1);
  return item;
}
A.price = price;
/* a line was added or edited: with d7-pricing.js loaded D7.pricing.reprice(item) prices it (it passes the distributed share of the additional costs to price()), otherwise price(item, 0) (spec 3.2) */
function priceNow(item, opts){
  if(!ready()) return item;
  if(!(opts && opts.asFiled) && D7.pricing && typeof D7.pricing.reprice==='function'){ try{ D7.pricing.reprice(item); if(item._kc && item._kc.priced!==undefined) return item; }catch(err){ console.error('D7 adapter: pricing.reprice failed', err); } }
  return price(item, 0, opts);
}
A.reprice = item => priceNow(item);
A.refresh = refresh;
A.DUCTING_REASON = DUCTING_REASON; A.reasonText = reasonText;

/* every kc line again: ventilation re-linked to its hood first, then priced (a filed line whose costs are unreadable keeps its price). Renders nothing: the caller does. */
A.repriceAll = function(){
  if(!on()) return;
  if(!ready()) return;                                                                            // KC:C read-only guard (spec 2.2)
  items.forEach(it => { if(isKc(it) && it.cfg && it.cfg.hoodRef) commitLinks(it); });
  items.forEach(it => { if(isKc(it) && defOf(it.kcKind)){ review(it); price(it, 0, { asFiled:!!(it._kc && it._kc.asFiled) }); } });
  sync();
};
/* KC:C the "↺ now ₱x" of a held price: take the fresh price and let go of the hold */
A.releaseHold = function(idx){
  const it = items[idx];
  if(!isKc(it) || !it.priceHeld) return false;
  if(!ready()){ toast('Prices are not loaded, so the price cannot be refreshed yet.', 'error'); return false; }
  delete it.priceHeld;
  priceNow(it);
  saveToStorage(); renderItems();
  if(typeof flashItemSaved==='function') flashItemSaved();
  return true;
};

/* ═════════ hood <-> ventilation links (spec 11.4) ═════════ */
function commitLinks(item){
  const c = item.cfg; if(!c || !c.hoodRef) return;
  const h = hoodOf(c.hoodRef);
  if(h) KC.relink(c, h.cfg); else c.hoodRef = null;
}
const priceKey = v => { const pr = safe(() => KC.priceOf(v.kcKind, v.cfg), null); return pr && pr.priced ? pr.unit : 'unpriced'; };
/* a hood was saved: every ventilation line linked to it is re-linked and repriced; a changed price shows "updated from the hood" */
function relinkVentsOf(hood){
  ventsOf(hood).forEach(v => {
    const before = priceKey(v), cfgBefore = JSON.stringify(v.cfg);
    KC.relink(v.cfg, hood.cfg);
    const changed = JSON.stringify(v.cfg) !== cfgBefore;
    if(changed) delete v.priceHeld;                                                                                 // KC:C the configuration changed: the held price is let go (spec 3.5 rule 2)
    sync(); refresh(v); priceNow(v, { asFiled:!!(v._kc && v._kc.asFiled) });
    if(priceKey(v) !== before) v.flag = 'updatedFromHood';
    if(changed && v.reviewed){ v.reviewed = false; delete v.reviewedAt; }                                           // the configuration changed: the review is reset
  });
}
/* a ventilation line whose hood is gone is unlinked, with a chip (spec: "hood removed: check the sizes") */
function unlinkOrphans(){
  items.forEach(v => { if(isKc(v) && v.cfg && v.cfg.hoodRef && !hoodOf(v.cfg.hoodRef)){ v.cfg.hoodRef = null; v.flag = 'hoodRemoved'; } });
}

/* ═════════ building and inserting a line ═════════ */
function newItem(line){
  const kind = line.kind, D = defOf(kind), custom = kind==='custom', cfg = clone(line.cfg || {});
  const it = {
    id: custom ? 'CUSTOM' : 'KC', kcKind:kind, kcId:nextId(), kcStart:line.start!=null ? line.start : null, kcVer:1, cfg,
    category: sectionOf(kind, cfg), name:'', dims:'', specEdit:'', notes:line.note || '', doc:null,
    use: custom ? 'commercial' : String(cfg.use || 'commercial').toLowerCase(), purpose: custom ? '' : (cfg.purpose || ''),
    formulaType: custom ? 'fixed' : 'configurable',
    specs:[], specStr:'', finish:'', includes:[], excludes:[], specLines:[], leadTime:'', laborHours:null,
    qty:Math.max(1, parseInt(line.qty, 10) || 1), unit:line.unit || 'pc', unitPrice:0, amount:0, priceBasis:'configured',
    needsReview:false, reviewReasons:[], reviewed:false
  };
  if(line.reviewed){ it.reviewed = line.reviewed; it.reviewedAt = nowIso(); }
  void D;
  return it;
}
/* a ventilation line goes right under its hood (and the hood's other ventilation lines); anything else goes at the end of the quote (the table groups by section) */
function insertItem(it, afterId){
  let idx = items.length;
  const after = afterId ? items.find(x => isKc(x) && x.kcId===afterId) : null, hood = it.cfg && it.cfg.hoodRef ? hoodOf(it.cfg.hoodRef) : null;
  if(after) idx = items.indexOf(after) + 1;
  else if(hood){ idx = items.indexOf(hood) + 1; while(idx < items.length && isKc(items[idx]) && items[idx].cfg && items[idx].cfg.hoodRef===hood.kcId) idx++; }
  if(idx >= items.length) items.push(it);
  else if(typeof withPhotoIndexRemap==='function') withPhotoIndexRemap(() => items.splice(idx, 0, it));      // quote photos link to a line by index: keep them on their lines
  else items.splice(idx, 0, it);
}
function setReviewed(it, wanted){
  if(wanted){ if(it.reviewed !== wanted || !it.reviewedAt) it.reviewedAt = nowIso(); it.reviewed = wanted; }
  else { it.reviewed = false; delete it.reviewedAt; }
}
function afterWrite(it, msg){
  saveToStorage(); renderItems();
  if(typeof flashItemSaved==='function') flashItemSaved();
  if(msg) toast(msg);
}

/* "Add to Quote" / "Update line" of the panel. Returns the mirror line of the line that was added or updated; null when it could not be (the reason is toasted). */
A.commit = function(line, o){
  o = o || {};
  if(!ready()){ toast('Prices are not loaded yet, so nothing can be added or changed. Reload the builder.', 'error'); return null; }      // KC:C "Add to Quote" is off until the prices have loaded (spec 2.2)
  const kind = line && line.kind, D = defOf(kind);
  if(!D){ toast('That configurator is not loaded.', 'error'); return null; }
  const v = KC.check(kind, line.cfg);
  if(v.errors.length){ toast(v.errors[0], 'error'); return null; }
  let idx = -1;
  if(o.ref && items.indexOf(o.ref) >= 0) idx = items.indexOf(o.ref);
  else if(o.editIdx!=null && isKc(items[o.editIdx]) && items[o.editIdx].kcKind===kind) idx = o.editIdx;
  const isEdit = idx >= 0;
  let it;
  if(isEdit){
    it = items[idx];
    if(JSON.stringify(it.cfg) !== JSON.stringify(line.cfg)) delete it.priceHeld;                      // KC:C editing the line's configuration clears the price hold (spec 3.5 rule 2); a change of quantity or note does not
    it.cfg = clone(line.cfg); it.kcStart = line.start!=null ? line.start : it.kcStart;
    it.qty = Math.max(1, parseInt(line.qty, 10) || 1); it.unit = line.unit || 'pc'; it.notes = line.note || '';
    if(kind==='custom') it.category = sectionOf(kind, it.cfg);                              // a custom item follows the category the preparer picked; a product keeps its place and section
    setReviewed(it, line.reviewed);
    delete it.flag;
  } else {
    it = newItem(line);
    insertItem(it);
    setReviewed(it, line.reviewed);
  }
  commitLinks(it);
  ensureIds(); sync(); refresh(it);
  priceNow(it);
  if(kind==='hood') relinkVentsOf(it);
  const mirror = mirrorOf(it);
  afterWrite(it, (isEdit ? '✔ Updated: ' : '➕ Added: ') + (it.name || D.title));
  return mirror;
};

A.edit = function(idx){
  const it = items[idx];
  if(!isKc(it)) return false;
  if(!defOf(it.kcKind)){ toast('This configurator is not loaded, so the line cannot be edited.', 'error'); return false; }
  const hadFlag = it.flag==='updatedFromHood';
  if(hadFlag) delete it.flag;                                                               // "until it is next opened"
  const ok = KC.openLine({ kind:it.kcKind, cfg:it.cfg, start:it.kcStart, qty:it.qty, unit:it.unit, note:it.notes, reviewed:it.reviewed, edit:idx, ref:it });
  if(hadFlag) renderItems();
  return ok;
};
A.addCustom = function(){ KC.openCustom(ALL.includes(S.tab) ? S.tab : 'prep'); };

A.markReviewed = function(idx, on, quiet){
  const it = items[idx];
  if(!isKc(it) || !KC.can('review')) return false;
  if(on){ it.reviewed = roleName(); it.reviewedAt = nowIso(); } else { it.reviewed = false; delete it.reviewedAt; }
  if(!quiet){ saveToStorage(); renderItems(); if(typeof flashItemSaved==='function') flashItemSaved(); }
  return true;
};

/* ═════════ hooks the builder calls (spec 3.0 E12, E16, E17) ═════════ */
A.hydrate = function(it){
  if(!isKc(it)) return;
  if(!it.cfg || typeof it.cfg!=='object') it.cfg = {};
  it.kcVer = it.kcVer || 1;
  if(it.priceBasis==='manual') it.priceManual = true; else delete it.priceManual;
  if(!defOf(it.kcKind)){ it._kc = { unknown:true }; return; }                                // the product file is missing: the line keeps its stored text and price ("configurator not loaded")
  it._kc = { stale:true };                                                                   // priced and checked at the next sync(): the quote's markup override is applied AFTER the items are
  if(!it.doc) it._kc.needsDoc = true;                                                        // no print snapshot (hand-made JSON): made at the next sync(), when the quote's items and the mirror are in place
};
/* a loaded line: priced (a stored price survives when the typed costs are not readable: "as filed") and checked */
function settle(it){
  const k = it._kc || {}; if(!k.stale) return;
  if(!ready()) return;                                                                       // KC:C the line stays as loaded (stale) until the prices are in; nothing about it changes meanwhile (spec 2.2)
  const hoodNo = k.hoodNo; delete k.stale;
  k.fromFiled = fromFiledLoad();                                                             // KC:C spec 3.5 rule 2: a line of a FILED quote is held at its stored price when the fresh price differs
  review(it); price(it, 0, { asFiled:true });
  if(hoodNo!==undefined) it._kc.hoodNo = hoodNo;
}
function sync(){
  if(typeof items==='undefined') return;
  if(!on()){ S.lines.length = 0; if(S.open) KC.closePanel(); return; }                      // Brilliance Steel / "as issued": no kc lines, no kc panel
  if(!items.some(isKc)) seq = 0;                                                             // no kc line on the quote (a new quote, a sample about to load): the numbering starts again at K1
  ensureIds();
  items.forEach(it => { if(isKc(it) && it._kc && it._kc.stale) settle(it); });
  rebuildMirror();
  items.forEach(it => { if(isKc(it) && it._kc && it._kc.needsDoc){ delete it._kc.needsDoc; describe(it); } });
  /* a ventilation line names its hood by the builder's number: when the number moved (a section moved, a line was added above it), the text follows */
  items.forEach(it => {
    if(!isKc(it) || it.kcKind!=='vent' || !it.cfg || !it.cfg.hoodRef) return;
    const h = hoodOf(it.cfg.hoodRef); if(!h) return;
    const n = numberOf(items.indexOf(h)), k = it._kc || (it._kc = {});
    if(k.hoodNo===undefined) k.hoodNo = n;                                                   // the first look after a load: the stored text is as filed
    else if(k.hoodNo!==n) describe(it);
  });
  if(S.open && S.editRef){ const i = items.indexOf(S.editRef); if(i < 0) KC.closePanel(); else S.edit = i; }     // the line being edited moved (or was removed)
  queueLead();
}
/* The ruled lead time of the document (owner 2026-11-05 #4): "Lead time: N working days minimum, from downpayment and approved drawings" under the table and "Lead time from N working days" in the summary strip.
   Both are read by QBSpecSheet.docNotes from the lines' `leadTime`, ONLY in the form "N working days", and a kc line has none of its own: the quote's lead time (rule 3.7: max(25, 12 + 3 x floor(materials / 20k)))
   is stamped on every kc line, so a quote of configured lines prints the sentence (chunk D's gap 1). A quote with a line "as filed" keeps the figures it was filed with (the costs behind a new figure are unreadable). */
function syncLeadTimes(){
  const kcs = items.filter(it => isKc(it) && defOf(it.kcKind));
  if(!kcs.length || kcs.some(it => it._kc && it._kc.asFiled)) return;
  const n = safe(() => KC.leadTime(), 0); if(!(n > 0)) return;
  const txt = n + ' working days';
  kcs.forEach(it => { if(it.leadTime !== txt) it.leadTime = txt; });
}
A.sync = function(){ sync(); syncLeadTimes(); };                                             // the hook (renderItems calls it first); the internal sync() calls skip the lead figure

A.afterItemsChange = function(name, idx){
  if(!on()) return;
  ensureIds();                                                                               // duplicateItem: the copy at idx+1 shares the original's kcId, the later one gets a new one
  if(name==='updatePrice' && ready()){                                                         // KC:C nothing is recomputed or un-reviewed while the prices have not loaded (spec 2.2)
    const it = items[idx];
    if(isKc(it)){
      if(Number(it.unitPrice) > 0){ it.priceBasis = 'manual'; it.priceManual = true; delete it.needsPrice; }
      else { it.priceBasis = 'configured'; delete it.priceManual; delete it.needsPrice; }       // the price box was cleared: back to the computed price
      price(it, 0);
      if(it.needsReview && it.reviewed){ it.reviewed = false; delete it.reviewedAt; }       // spec 3.2: a typed price changed after the review: the review is reset
    }
  }
  if(name==='deleteItem') unlinkOrphans();
  sync();
};

/* ═════════ the "Config" row under a line (spec 3.3) ═════════ */
const FLAG = { updatedFromHood:'updated from the hood', hoodRemoved:'hood removed: check the sizes' };
function lineRow(item, idx){
  if(!isKc(item)) return '';
  const k = item._kc || {}, D = defOf(item.kcKind), c = item.cfg || {}, costs = KC.can('costs');
  const chip = (cls, t, tip) => `<span class="ms-chip ${cls}"${tip ? ` title="${esc(tip)}"` : ''}>${esc(t)}</span>`;
  const warn = (t, extra) => chip('warn', t) + (extra || '');
  const lc = t => `<span class="kc-link-chip">${esc(t)}</span>`;
  const out = [];
  if(!D){
    out.push(chip('warn', 'configurator not loaded', 'This configurator file is not loaded, so the line cannot be edited. Its stored text and price are kept.'));
  } else {
    if(isManual(item)) out.push('<span class="ms-chip" style="background:#eee;color:var(--gray-dark)" title="A hand-typed price. The ↺ under the price box goes back to the computed one.">manual price</span>');
    else if(!ready() && Number(item.unitPrice) > 0) out.push(chip('ok', 'stored price', 'The prices are not loaded in this session, so this is the price that was saved with the line.'));
    else if(item.priceHeld) out.push(chip('warn', 'price as filed', 'This quote was filed with this price. The price list now gives another one, so the line keeps the filed price until you take the new one or change the line.')
      + (item.basisUnitPrice > 0 ? ` <span class="kc-held-now">now ${esc(safe(() => formatPeso(item.basisUnitPrice), String(item.basisUnitPrice)))} <button type="button" class="cfg-link kc-held-btn" onclick="D7.adapter.releaseHold(${idx})" title="Take the new price" aria-label="Take the new price">↺</button></span>` : ''));
    else if(k.asFiled) out.push(chip('ok', 'as filed', 'This is the price that was filed. The typed costs it was built from are not readable in this session, so it cannot be recomputed here.'));
    else if(k.priced && k.list) out.push(chip('ok', 'list price', 'The model’s price on the Standard Product Price List (effective Nov 19, 2026), plus what the length and the options add (project cost × the markup), to the nearest 10 pesos.' + (k.list.status ? ' Price status: ' + String(k.list.status) + ' (staff only, never printed).' : '')));
    else if(k.priced) out.push(chip('ok', 'cost-based', 'Priced from the materials price list: materials + labor + misc, times the markup, to the nearest 10 pesos.'));
    else out.push(chip('warn', 'priced after review', k.missing && k.missing.length ? 'Not entered yet: ' + k.missing.join(', ') : 'No price yet'));
    if(!isManual(item) && k.priced && k.markupOvr) out.push(chip('warn', 'markup override', costs ? 'Priced with the quote’s markup override ×' + k.markupOvr + ' instead of the standard ×' + KC.SET.markup : 'Priced with the quote’s markup override'));
    if(item.needsReview){
      if(item.reviewed) out.push(chip('ok', 'reviewed by ' + (typeof item.reviewed==='string' ? item.reviewed : KC.ROLES.president.name), item.reviewedAt ? 'Reviewed ' + item.reviewedAt : ''));
      else out.push(chip('warn', 'needs review', reasonText(item.reviewReasons) + ' The President or Operations reviews it; the quote cannot be filed until then.'));
    }
    if(KC.isEdited(c)) out.push(chip('warn', 'edited by hand', 'Wording, build detail or costs were changed by hand'));
  }
  /* the hood <-> ventilation links, by the builder's numbers */
  if(item.kcKind==='hood'){
    const vents = ventsOf(item);
    if(vents.length) out.push(lc('ventilation: ' + vents.map(v => refOf(items.indexOf(v))).join(', ')));
    else if((c.blower || c.ducting) && KC.products.vent && defOf('hood')) out.push(warn('ventilation not added', `<button type="button" class="cfg-link" onclick="KC.openVentFor('${esc(item.kcId)}')">add ventilation</button>`));
  }
  if(c.hoodRef){ const h = hoodOf(c.hoodRef); if(h) out.push(lc('for ' + refOf(items.indexOf(h)))); }
  if(item.flag && FLAG[item.flag]) out.push(warn(FLAG[item.flag]));
  const btn = [];
  if(D) btn.push(`<button type="button" class="cfg-link" onclick="D7.adapter.edit(${idx})">⚙ edit configuration</button>`);
  if(D && KC.can('review') && item.needsReview){
    btn.push(item.reviewed ? `<button type="button" class="cfg-link" onclick="D7.adapter.markReviewed(${idx},false)" title="Take the review back">Undo review</button>`
                           : `<button type="button" class="cfg-link" onclick="D7.adapter.markReviewed(${idx},true)">Mark reviewed</button>`);
  }
  return `<div class="spec-line cfg-row no-print d7-cfgrow"><span class="spec-tag no-print">Config</span>${out.join('')}${btn.join('')}</div>`;
}
A.lineRow = lineRow;

/* ═════════ the typed costs leave the payload and ride the sidecar (spec 3.4) ═════════ */
/* Every key that names a cost, at ANY depth, never leaves in a payload, a draft, a template or a stored quote (spec 3.4: "the key check"; tests/kc-live.test.mjs pins it, and pins that no product's own
   configuration uses one of these names, so this never takes a real setting out). The typed costs of the kc custom item and the custom parts (`m` and `lab` inside cfg.custom[] and on a custom item's cfg) are
   taken out on top of that: `m` alone is not a cost name anywhere else. */
const COST_KEYS = ['M', 'projectCost', 'labor', 'misc', 'lab', 'costMat', 'bom', 'capitalMaterials', 'capitalLabor', '_kc', 'markup', 'p'];
const COST_SET = new Set(COST_KEYS);
function scrub(v){
  if(Array.isArray(v)) return v.map(scrub);
  if(v && typeof v==='object'){ const o = {}; Object.keys(v).forEach(k => { if(!COST_SET.has(k)) o[k] = scrub(v[k]); }); return o; }
  return v;
}
A.COST_KEYS = COST_KEYS;
A.publicItem = function(x){
  if(!x || !x.kcKind) return '';
  const o = Object.assign({}, x);
  o.cfg = clone(x.cfg || {});                                                                // the builder's payload copy shares the live cfg object: clean a COPY
  if(Array.isArray(o.cfg.custom)) o.cfg.custom.forEach(c => { if(c){ delete c.m; delete c.lab; } });
  if(o.kcKind==='custom'){ delete o.cfg.m; delete o.cfg.lab; }
  return scrub(o);
};
A.sidecarRow = function(it){
  if(!it || !it.kcKind || !defOf(it.kcKind)) return '';
  const pr = safe(() => KC.priceOf(it.kcKind, it.cfg), null); if(!pr) return '';
  const c = it.cfg || {};
  const typed = { custom:(Array.isArray(c.custom) ? c.custom : []).map(x => ({ m:x && x.m!=null ? x.m : null, lab:x && x.lab!=null ? x.lab : null })) };
  if(it.kcKind==='custom'){ typed.m = c.m!=null ? c.m : null; typed.lab = c.lab!=null ? c.lab : null; }
  const row = { kcId:String(it.kcId || ''), kind:it.kcKind, markup:KC.effMarkup(), M:round2(pr.M), projectCost:round2(pr.projectCost),
    groups:(pr.groups || []).map(g => ({ label:g.label, bracket:g.bracket || null, M:round2(g.M), labor:round2(g.labor), misc:round2(g.misc) })),
    lines:(pr.lines || []).map(l => ({ part:l.part, k:l.k, l:l.l, u:l.u, q:l.q, p:l.p==null ? null : l.p, t:round2(l.t) })), typed };
  if(pr.priced && pr.list) row.list = { code:pr.list.code, base:round2(pr.list.base), baseSelling:round2(pr.list.baseSelling), adj:round2(pr.list.adj), lengthAdj:round2(pr.list.lengthAdj), status:String(pr.list.status || '') };      // A1: the list price basis of a line (the project cost above stays the formula's); the price status is staff only, in this sidecar and never in the quote
  return row;
};
/* KC:C the typed costs go back into the line's cfg, in memory only, for every internal role (spec 3.4 / X4): the sidecar row has the costs, the stored quote never does */
A.graft = function(item, row){
  if(!item || !row || !row.typed) return item;
  const t = row.typed, c = item.cfg = item.cfg || {};
  if(Array.isArray(t.custom) && Array.isArray(c.custom)) t.custom.forEach((x, i) => { if(c.custom[i] && x){ if(x.m!=null) c.custom[i].m = x.m; if(x.lab!=null) c.custom[i].lab = x.lab; } });
  if(item.kcKind==='custom'){ if(t.m!=null) c.m = t.m; if(t.lab!=null) c.lab = t.lab; }
  return item;
};

/* ═════════ clearForm, KC.addLine and friends (the prototype's sample quote is not ported: spec X5) ═════════ */
A.reset = function(){
  S.markupOvr = null;
  S.edit = null; S.editRef = null;
  if(S.open) KC.closePanel();
  S.lines.length = 0;
};
function addLine(kind, cfg, o){
  o = o || {};
  const D = defOf(kind); if(!D) throw new Error('KC.addLine: unknown product "' + kind + '"');
  const it = newItem({ kind, cfg, start:o.start!=null ? o.start : null, qty:o.qty, unit:o.unit, note:o.note, reviewed:o.reviewed });
  if(o.priceOvr!=null){ it.priceBasis = 'manual'; it.priceManual = true; it.unitPrice = Math.max(0, Number(o.priceOvr)||0); }
  insertItem(it, o.after);
  commitLinks(it);
  ensureIds(); sync(); refresh(it); priceNow(it);
  if(kind==='hood') relinkVentsOf(it);
  if(o.render!==false){ saveToStorage(); renderItems(); }
  return mirrorOf(it);
}
function clearLines(){
  if(S.open) KC.closePanel();
  items.length = 0;                                                                          // in place: the draft snapshot and editableState hold this array
  S.lines.length = 0;
  try{ quotePhotos.forEach(p => { if(p) p.itemIndex = null; }); }catch(e){ /* no photos */ }
  saveToStorage(); renderItems();
}
KC.addLine = addLine;
KC.clearLines = clearLines;
KC.lineById = id => { const it = id!=null ? items.find(x => isKc(x) && x.kcId===String(id)) : null; return it ? mirrorOf(it) : null; };
/* the number printed in the # column (0 when the line is not on the quote) */
KC.lineNo = id => { const idx = A.indexOf(id); if(idx < 0) return 0; const n = numberOf(idx); return n || (items.slice(0, idx).filter(isKc).length + 1); };
KC.ensureIds = ensureIds;

/* ═════════ the lead-time chip in the Quote Items title bar (spec 3.7) ═════════ */
let leadQueued = false;
function queueLead(){ if(leadQueued) return; leadQueued = true; Promise.resolve().then(() => { leadQueued = false; drawLead(); }); }
function drawLead(){
  const host = $('d7LeadChip'); if(!host) return;
  if(!on()){ host.innerHTML = ''; return; }
  const o = KC.markupOvr();
  host.innerHTML = `<span class="kc-q-lead" id="kcLead" title="Working days from the down payment and approved drawings: the longer of 25 days and 12 + 3 for every 20k pesos of materials">Lead time: ${KC.leadTime()} working days</span>`
    + (o!=null ? `<span class="kc-q-ovr" id="kcOvrBanner" title="${KC.can('costs') ? 'The President set one markup for this quote: ×' + o + ' instead of the standard ×' + KC.SET.markup + '.' : 'The President set one markup for this quote.'}">Markup override${KC.can('costs') ? ' ×' + o : ''}</span>` : '');
}
A.drawLead = drawLead;

/* ═════════ the tabs, the cards and the catalogue list (spec 3.1) ═════════ */
function setTab(id, focus){
  if(!ALL.includes(id)) return;
  S.tab = id;
  try{ currentCatFilter = id; }catch(e){ /* the builder's filter */ }                      // KC.S.tab and currentCatFilter hold the same id (the search box filters by it)
  A.renderTabs();
  if(focus){ const b = $('kcTab-' + id); if(b) b.focus({ preventScroll:true }); }
}
A.setTab = setTab;
A.renderTabs = function(){
  safe(() => { const f = currentCatFilter; if(ALL.includes(f)) S.tab = f; else { S.tab = 'all'; currentCatFilter = 'all'; } });   // the builder resets the filter when the mode flips: it is the source
  if(KC.renderChips) KC.renderChips(true);
  A.renderCatalogue();
};

/* which kc configurator covers a catalogue SKU: through the website family that absorbs it (spec 3.8, M2). The gas deck oven has no kc product: it keeps the calculator. */
const FAMILY_KIND = { prep_table:'prep', sink:'sink', dish_table:'sink', stove:'chef_hp', wok_range:'chef_wok', cooking_line:'chef_griddle', hood:'hood', cabinet:'cabinet', wall_shelf:'rack', rack:'rack' };
A.kindForSku = function(sku){
  const a = safe(() => (typeof absorbedFamilyOf==='function' ? absorbedFamilyOf(String(sku)) : null), null);
  const kind = a && FAMILY_KIND[a.familyId];
  return kind && KC.products[kind] ? kind : '';
};
A.configureInstead = function(sku){
  const kind = A.kindForSku(sku); if(!kind) return;
  safe(() => closeDropdown()); safe(() => closePricelist()); safe(() => dismissCalc());
  KC.openKind(kind);
};

let catOpen = true;                                                                          // the "Catalogue items" list is open by default; the preparer's choice is kept across redraws
A.renderCatalogue = function(){
  const host = $('d7Catalogue'); if(!host) return;
  if(!on() || !D7.ready || S.tab==='all'){ host.innerHTML = ''; return; }
  const prods = safe(() => (DB.products || []).filter(p => D7.tabOfProduct(p)===S.tab), []);
  if(!prods.length){ host.innerHTML = ''; return; }
  const rows = prods.map(p => {
    const kind = A.kindForSku(p.id), fixed = p.formulaType==='fixed', pr = safe(() => formatPeso(p.basePrice), '');
    return `<div class="d7-cat-row" data-sku="${esc(p.id)}"><div class="d7-cat-info"><div class="d7-cat-name">${esc(p.name)}</div><div class="d7-cat-meta">${esc(p.id)} · ${fixed ? '' : 'from '}${esc(pr)}${kind ? ' · <span class="cfg-hint no-print">Has a configurator</span>' : ''}</div></div>`
      + `<div class="d7-cat-act">${kind ? `<button type="button" class="cfg-mini" data-d7-cfg="${esc(p.id)}" title="Open the configurator instead of the catalogue item">Configure instead</button><button type="button" class="cfg-link" data-d7-add="${esc(p.id)}" title="Add the catalogue item as it is">add as is</button>`
                                    : `<button type="button" class="cfg-mini" data-d7-add="${esc(p.id)}">Add</button>`}</div></div>`;
  }).join('');
  host.innerHTML = `<details class="d7-cat" data-d7-cat${catOpen ? ' open' : ''}><summary><span>Catalogue items</span><span class="d7-cat-n">${prods.length}</span><span class="d7-cat-hint">Pick one to set its size and options.</span></summary><div class="d7-cat-list">${rows}</div></details>`;
};
document.addEventListener('toggle', e => { const el = e.target; if(el && el.matches && el.matches('details[data-d7-cat]')) catOpen = el.open; }, true);
document.addEventListener('click', e => {
  const b = e.target.closest ? e.target.closest('[data-d7-add],[data-d7-cfg]') : null;
  if(!b || !b.closest('#d7Catalogue')) return;
  if(b.dataset.d7Add!=null && b.dataset.d7Add!==''){
    selectProduct(b.dataset.d7Add);
    setTimeout(() => { const cp = $('calcPanel'); if(cp && cp.classList.contains('open')) cp.scrollIntoView({ block:'nearest' }); }, 0);      // the calculator opens below the search row: bring it into view
  } else if(b.dataset.d7Cfg) A.configureInstead(b.dataset.d7Cfg);
});

})();
