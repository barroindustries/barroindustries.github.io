/* qb/kc/admin-d7.js: the Materials price list and the Pricing settings screens of the live quote builder (BK configurators, packet D).
   Ported from the D7 copy (private/prototypes/qb-d7/kc/admin-d7.js). What changed for the live tool:
     - Every write goes through window.KCLive (qb/kc-live.js): saveMaterial(key, patch), saveSettings(patch), saveSwitch(patch), importSeed(json).
       Nothing here talks to Firestore for a write. The one read is the switch document, to show its current value.
     - A screen changes the in-memory price list (KC.P) / settings (KC.SET) only AFTER the write succeeded. A failed write leaves everything as it was and says so.
     - Read-only until KCLive.ready: the price and settings inputs stay disabled while the prices are not loaded. The import and the switch work regardless
       (the first import is what makes the prices exist; the switch is the emergency stop).
     - Who sees what (spec 3.2): the Materials price list is visible to every role; Purchasing and the President edit it (KC.can('editPrices')). The Pricing settings
       screen shows its money groups (labor brackets, misc, markup, corner charge, the worked example, the markup for this quote, floor mode, the Q64 report, import,
       the switch) to the President only (KC.can('editSettings') / KC.can('costs')). Everyone else sees the engineering factors read-only, and Operations
       the "Pending Rene's review" list.
     - New: a Source column (Sample, Kingsway PO + 10%, Set by Neil, Manual), no blank price can be saved, the floor mode, the Q64 report, "Import prices from a file",
       the three-way switch (who starts new quotes with the configurators), and (addendum A1) the Standard Price List with each code's price, per-metre rate and price status
       (staff only, never printed), read from kc_config/list_prices.
     - Addendum A9 keeps build rules out of readable tracked files: the "Pending Rene's review" list is NOT written here. It comes from the engine (KC.pendingReview()); without it
       the screen says so. The Q64 report asks the engine for the models of the price list (KC.listModels()) and falls back to the Chef Mode models.
     - KC.setScreen() is NOT defined here: the screen host is qb/d7/d7-flow.js (packet C). It shows #scrPrices / #scrSettings and calls KC.renderPrices() /
       KC.renderSettings(), which this file exports.
   CONTRACT WITH KCLive (what this file calls, and what it needs back; qb/kc-live.js implements it)
     saveMaterial(key, patch)  -> Promise. patch is { p, source: 'Manual' } (a price edit; p is a number >= 0, never blank), { hp, cfm, sp, ratingNote } (a blower rating; numbers or null, ratingNote
                                  is the rating text for the history line), or { l, u, cat, grade, size, p, source: 'Manual' [, fam, hp, cfm, sp, ratingNote] } (a row added here). NO hist in the
                                  patch: KCLive appends { d, p, by } when p changed (newest last, at most 20) and stamps key, updatedAt, updatedBy, updatedByName. KCLive also updates KC.P / KC.PL_INFO
                                  when the write succeeds; this file sets the same values again (harmless) and, when the resolved value carries { hist }, shows that history.
     saveSettings(patch)       -> Promise. patch holds ONLY what changed, shaped like KC.SET: { markup: 2.5 }, { hood: { overhang: 20 } }, { corner: n }, { floorMode: 'formula' }. No v, no whole snapshot.
     saveSwitch(patch)         -> Promise. patch is { kcMode: 'off' | 'president' | 'on' }.
     importSeed(json)          -> Promise. json is the parsed seed file, unchanged. A resolved { historyAdded, written } is shown; KCLive re-reads the lists itself (this file calls load() only when it did not).
     state ('idle' | 'loading' | 'live' | 'denied' | 'offline'), detail (a sentence for the banner), ready (boolean), flags (the switch document as loaded), userName (a string).
   kc_config/list_prices.rows is a MAP code -> { code, price, perMetre | null, status, label, std } (the rules require a map). This file reads the document itself, once, for the
   price list table (KC.LISTP is used when the read is not possible); it accepts a bare number as a row too. */
(function(){
'use strict';
const KC = window.KC;
if(!KC || !KC.S || !KC.SET || !KC.esc){ return; }              // the engine did not load: there is nothing to draw
const S = KC.S, esc = KC.esc, peso = KC.peso, $ = KC.$, plural = KC.plural;
const SET = KC.SET;                                            // settings: mutated in place by this screen, never replaced

/* the few rules the shared stylesheets do not have (classes prefixed .kc-adm-); every one is scoped to the two screens or to a .kc-adm- class.
   The sheet goes at the END of <body>: the page writes its other stylesheets as <link>s inside the body, and a <style> in <head> would lose every tie of specificity to them. */
(function(css){ const st = document.createElement('style'); st.id = 'kcAdminCss'; st.textContent = css; (document.body || document.documentElement).appendChild(st); })(`
/* materials price list */
#scrPrices [hidden]{display:none!important;}
.kc-adm-search{max-width:320px;}
.kc-adm-tabs .cat-tab.active{background:var(--dark-blue);}
#scrPrices button.ms-chip{font-family:inherit;line-height:1.25;cursor:pointer;}
#scrPrices button.ms-chip.kc-adm-on{box-shadow:0 0 0 2px #f3b8b1;}
.kc-adm-count{font-size:11px;color:var(--gray-dark);white-space:nowrap;}
.kc-adm-no{display:block;color:var(--red);font-size:10.5px;font-weight:700;margin-top:2px;}
.kc-adm-rating{margin:6px 0 12px;}
.kc-adm-rate{display:grid;grid-template-columns:repeat(3,minmax(0,185px));gap:8px;margin:4px 0 6px;}
.kc-adm-rate-ro{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:12px;margin:4px 0 6px;}
.kc-adm-blow{margin-top:8px;}
.kc-adm-hist{max-width:460px;margin-top:4px;}
.kc-adm-src{white-space:nowrap;}
.kc-adm-src.kc-adm-sample{color:#a1610a;font-weight:700;}
.kc-adm-pc .kc-adm-srcchip{display:none;}
.kc-adm-srcchip.kc-adm-real{background:#e8f4ea;color:#1f6b36;}
.kc-adm-mix{font-size:11.5px;color:var(--gray-dark);margin:2px 0 6px;}
.kc-adm-msg{margin:8px 0;padding:7px 10px;border-radius:8px;font-size:12.5px;font-weight:600;}
.kc-adm-msg.err{background:#fdecea;border:1px solid #f1b5ae;color:#8a1c12;}
.kc-adm-msg.ok{background:#e8f4ea;border:1px solid #a9d4b3;color:#1f6b36;}
.kc-adm-busy{opacity:.6;pointer-events:none;}
#scrPrices .kc-pl td.kc-adm-ro input{background:#f3f5f8;}
/* pricing settings */
.kc-adm-grid{grid-template-columns:repeat(3,minmax(0,1fr));margin-top:8px;}
.kc-adm-ex{border:1px solid var(--gray-mid);border-radius:9px;padding:9px 10px 10px;background:#fbfcfe;min-width:0;}
#scrSettings label.kc-opt{font-size:12px;font-weight:600;color:var(--text);text-transform:none;letter-spacing:0;}
.kc-adm-lbl{font-size:12px;font-weight:600;color:var(--text);}
.kc-adm-tri{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;}
#scrSettings .kc-adm-tri label.kc-opt{font-size:11px;color:var(--gray-dark);}
.kc-adm-tri input{width:100%!important;text-align:center;font-weight:700;font-size:15px;}
.kc-adm-fld + .kc-adm-fld{margin-top:6px;}
.kc-adm-ovr .kc-levels{flex-wrap:wrap;}
.kc-adm-pgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;margin-top:8px;}
.kc-adm-pbox{border:1px solid var(--gray-mid);border-radius:9px;padding:8px 10px;background:#fbfcfe;min-width:0;}
.kc-adm-ptitle{font-size:11.5px;font-weight:800;color:var(--dark-blue);margin-bottom:2px;}
.kc-adm-pbox .kc-cost td{border-bottom:1px dashed var(--gray-mid);font-size:11.5px;}
.kc-adm-pbox .kc-cost td:first-child{width:62%;}
.kc-adm-pbox .kc-cost td:last-child{white-space:normal;text-align:right;}
.kc-adm-ptag{font-size:10px;font-weight:800;color:#8a5a00;background:#fff3d6;border:1px solid #f0cf95;border-radius:8px;padding:0 6px;white-space:nowrap;}
.kc-adm-radios{display:flex;flex-direction:column;gap:6px;margin-top:6px;}
.kc-adm-radios label{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;font-weight:600;color:var(--text);cursor:pointer;text-transform:none;letter-spacing:0;}
.kc-adm-radios input{width:auto!important;margin-top:2px;flex:0 0 auto;}
.kc-adm-radios .kc-sm{display:block;font-weight:400;}
.kc-adm-rep{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px;}
.kc-adm-rep th{font-size:10.5px;text-align:left;color:var(--gray-dark);padding:3px 6px;border-bottom:1px solid var(--gray-mid);}
.kc-adm-rep td{padding:4px 6px;border-bottom:1px dashed var(--gray-mid);vertical-align:top;}
.kc-adm-rep th.kc-num,.kc-adm-rep td.kc-num{text-align:right;}
.kc-adm-rep td:first-child{white-space:nowrap;}
.kc-adm-imp-sum{font-size:12.5px;font-weight:700;color:var(--dark-blue);margin:6px 0;}
/* standard price list and the price status chips (staff only) */
.kc-adm-lptbl{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px;}
.kc-adm-lptbl th{font-size:10.5px;text-align:left;color:var(--gray-dark);padding:4px 6px;border-bottom:1px solid var(--gray-mid);white-space:nowrap;}
.kc-adm-lptbl td{padding:5px 6px;border-bottom:1px dashed var(--gray-mid);vertical-align:top;}
.kc-adm-lptbl th.kc-num,.kc-adm-lptbl td.kc-num{text-align:right;white-space:nowrap;}
.kc-adm-lptbl td.kc-adm-lpc{white-space:nowrap;}
.kc-adm-lpg td{background:#eef3fa;color:var(--dark-blue);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;padding:5px 6px;}
.kc-adm-lpsub{display:none;}
.kc-adm-st{display:inline-block;font-size:10.5px;font-weight:800;border-radius:9px;padding:1px 8px;white-space:nowrap;border:1px solid transparent;line-height:1.5;}
.kc-adm-st-data{background:#e8f4ea;color:#1f6b36;border-color:#a9d4b3;}
.kc-adm-st-smooth{background:#e8f0fb;color:#1f4a8a;border-color:#a9c3ea;}
.kc-adm-st-est{background:#fff3d6;color:#8a5a00;border-color:#f0cf95;}
.kc-adm-st-review{background:#fdecea;color:#8a1c12;border-color:#f1b5ae;}
.kc-adm-st-supp{background:#f0ebf8;color:#4a2f7a;border-color:#cbbbe6;}
.kc-adm-st-appr{background:#e2f3f0;color:#0d5c52;border-color:#9ccfc7;}
.kc-adm-st-none{background:#f3f5f8;color:var(--gray-dark);border-color:var(--gray-mid);}
button.kc-adm-stbtn{font-family:inherit;cursor:pointer;min-height:26px;}
button.kc-adm-stbtn.kc-adm-on{box-shadow:0 0 0 2px var(--dark-blue);}
#scrSettings .cfg-lbl{flex-wrap:wrap;}
#scrSettings .cfg-lbl .kc-eng{text-transform:none;letter-spacing:0;}
@media(min-width:769px){ #scrPrices .kc-pl{min-width:980px;} #scrPrices .kc-pl td:nth-child(9),#scrPrices .kc-pl td:nth-child(10){white-space:nowrap;} }
@media(max-width:1000px){ .kc-adm-grid{grid-template-columns:repeat(2,minmax(0,1fr));} }
@media(max-width:768px){
  .kc-adm-grid{grid-template-columns:1fr;}
  #scrSettings input:not([type="checkbox"]):not([type="radio"]){min-height:44px;}
  #scrSettings .kc-adm-radios label{min-height:44px;align-items:center;}
  .kc-adm-ovr .cfg-link{min-height:44px;display:inline-flex;align-items:center;padding:0 8px;}
  .kc-adm-pgrid{grid-template-columns:1fr;}
  .kc-adm-search{max-width:none;flex:1 1 100%;}
  #scrPrices .kc-plbar .cat-tabs{flex:1 1 100%;min-width:0;flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px;}
  #scrPrices .cat-tab{flex:0 0 auto;min-height:44px;white-space:nowrap;}
  #scrPrices input:not([type="checkbox"]):not([type="radio"]),#scrPrices select{min-height:44px;}
  #scrPrices .btn-sm,#scrPrices button.ms-chip{min-height:44px;}
  #scrPrices .kc-pl .cfg-link{min-height:44px;display:inline-flex;align-items:center;padding:0 8px;}
  /* ten columns: Category 1, Material 2, Grade 3, Size 4, Unit 5, Price 6, Source 7, Last changed 8, Used in 9, History 10. A phone shows 2, 4, 6 and 10 (the source is a chip under the price). */
  #scrPrices .kc-pl th:nth-child(1),#scrPrices .kc-pl td:nth-child(1),#scrPrices .kc-pl th:nth-child(3),#scrPrices .kc-pl td:nth-child(3),
  #scrPrices .kc-pl th:nth-child(5),#scrPrices .kc-pl td:nth-child(5),#scrPrices .kc-pl th:nth-child(7),#scrPrices .kc-pl td:nth-child(7),
  #scrPrices .kc-pl th:nth-child(8),#scrPrices .kc-pl td:nth-child(8),#scrPrices .kc-pl th:nth-child(9),#scrPrices .kc-pl td:nth-child(9){display:none;}
  #scrPrices .kc-pl th:nth-child(2),#scrPrices .kc-pl td:nth-child(2),#scrPrices .kc-pl th:nth-child(4),#scrPrices .kc-pl td:nth-child(4),
  #scrPrices .kc-pl th:nth-child(6),#scrPrices .kc-pl td:nth-child(6),#scrPrices .kc-pl th:nth-child(10),#scrPrices .kc-pl td:nth-child(10){display:table-cell;}
  #scrPrices .kc-pl tr.kc-hist td,#scrPrices .kc-pl td.kc-empty{display:table-cell!important;}
  /* the four visible columns share the width exactly (no sideways scroll inside the table): Material 34%, Size 22%, Price 28%, History 16% */
  #scrPrices .kc-pl{table-layout:fixed;width:100%;}
  #scrPrices .kc-pl th:nth-child(2){width:34%;} #scrPrices .kc-pl th:nth-child(4){width:22%;} #scrPrices .kc-pl th:nth-child(6){width:28%;} #scrPrices .kc-pl th:nth-child(10){width:16%;}
  #scrPrices .kc-pl td,#scrPrices .kc-pl th{padding:6px 3px;overflow-wrap:anywhere;}
  #scrPrices .kc-pl th{overflow-wrap:normal;font-size:10px;letter-spacing:0;}
  #scrPrices .kc-pl td:nth-child(10){overflow-wrap:normal;text-align:center;}
  #scrPrices .kc-pl .edit-price{width:100%!important;max-width:100%;min-width:0;box-sizing:border-box;}
  #scrPrices .kc-pl td.kc-num{white-space:normal;}
  #scrPrices .kc-pl .cfg-link{padding:0;font-size:11px;justify-content:center;text-align:center;white-space:normal;}
  .kc-adm-hist{max-width:none;width:100%;}
  .kc-adm-pc .kc-adm-srcchip{display:block;width:fit-content;max-width:100%;margin:3px 0 0 auto;white-space:normal;text-align:right;line-height:1.15;}
  .kc-adm-rate{grid-template-columns:1fr;}
  .kc-adm-rep th:nth-child(2),.kc-adm-rep td:nth-child(2),.kc-adm-rep th:nth-child(3),.kc-adm-rep td:nth-child(3){display:none;}
  /* the price list: Code with its product under it, Price, Per metre, Status */
  .kc-adm-lptbl{table-layout:fixed;}
  .kc-adm-lptbl th:nth-child(2),.kc-adm-lptbl td:nth-child(2),.kc-adm-lptbl th:nth-child(3),.kc-adm-lptbl td:nth-child(3){display:none;}
  .kc-adm-lptbl th:nth-child(1){width:31%;} .kc-adm-lptbl th:nth-child(4){width:25%;} .kc-adm-lptbl th:nth-child(5){width:22%;} .kc-adm-lptbl th:nth-child(6){width:22%;}
  .kc-adm-lptbl td,.kc-adm-lptbl th{padding:5px 3px;overflow-wrap:anywhere;}
  .kc-adm-lptbl th{white-space:normal;overflow-wrap:normal;font-size:10px;letter-spacing:0;}
  .kc-adm-lptbl td.kc-adm-lpc{white-space:normal;}
  .kc-adm-lpsub{display:block;font-size:10.5px;color:var(--gray-dark);font-weight:400;line-height:1.25;}
  .kc-adm-lptbl .kc-adm-st{white-space:normal;overflow-wrap:normal;word-break:normal;padding:1px 3px;font-size:9.5px;text-align:center;}
  .kc-adm-lptbl td.kc-num{overflow-wrap:normal;font-size:11.5px;}
  button.kc-adm-stbtn{min-height:44px;}
}`);

/* ═════════ small helpers ═════════ */
const live = () => window.KCLive || null;
const ready = () => { const L = live(); return !!(L && L.ready); };
const stateOf = () => { const L = live(); return (L && L.state) || 'offline'; };
const numOrNull = raw => { raw = String(raw).trim(); return raw==='' ? null : Number(raw); };
const badNum = n => n!==null && !(n>=0);                       // NaN or negative
const catOf = k => (KC.PL_INFO[k]||['Other'])[0];
const BLOW = 'Blowers & fans';
const FAMILIES = [['fan','Industrial fan (Vector)'],['sir','Sirocco blower'],['box','Box-type blower'],['scr','Scroll centrifugal blower'],['axi','Axial inline fan']];
const isBlower = k => (KC.PL_INFO[k]||[])[0]===BLOW;
const ratingText = k => KC.LIB && KC.LIB.blowerText ? KC.LIB.blowerText(k) : '';
/* the name that goes on a history line shown before the page is reloaded (the stored line is stamped by KCLive with the signed-in name) */
function who(){
  const L = live();
  try{ if(L){ const n = typeof L.userName==='function' ? L.userName() : L.userName; if(n && typeof n==='string') return n; } }catch(err){ /* fall through */ }
  try{ if(typeof auth!=='undefined' && auth && auth.currentUser){ const u = auth.currentUser; if(u.displayName) return u.displayName; if(u.email) return u.email; } }catch(err){ /* fall through */ }
  return (KC.ROLES[S.role]||{}).name || 'You';
}
/* quotes being built pick the change up at once: reprice every cost-based kc line (a manual price and a held price stay), then redraw the builder */
function reprice(){
  const D7 = window.D7;
  try{ if(D7 && D7.has && D7.has('pricing.repriceAll')) D7.h('pricing.repriceAll'); else if(D7 && D7.has && D7.has('adapter.repriceAll')) D7.h('adapter.repriceAll'); }
  catch(err){ console.error('KC admin: the open quote could not be repriced', err); }
}
function redrawQuote(){ try{ if(typeof renderItems==='function') renderItems(); }catch(err){ console.error('KC admin: the builder could not redraw', err); } }
const items = () => { reprice(); redrawQuote(); };
/* a write through KCLive: a missing service is an error the screen shows, never a silent no-op */
function viaLive(fn, ...args){
  const L = live();
  if(!L || typeof L[fn] !== 'function') return Promise.reject(new Error('the live price service is not loaded'));
  try{ return Promise.resolve(L[fn](...args)); }catch(err){ return Promise.reject(err); }
}
const errText = err => String((err && (err.message || err.code)) || err || 'unknown error').replace(/^Error:\s*/,'').replace(/[.\s]+$/,'');
/* a message under the screen title; kept across the re-render that follows the action, replaced by the next action */
const MSG = { pl:null, st:null };
function say(scope, kind, text){ MSG[scope] = text ? { kind, text } : null; }
const msgHtml = scope => MSG[scope] ? `<div class="kc-adm-msg ${MSG[scope].kind}" role="${MSG[scope].kind==='err'?'alert':'status'}">${esc(MSG[scope].text)}</div>` : '';
let BUSY = false;                                              // one write at a time: a second change while one is in flight snaps back

/* the history line of a row after a successful write: what KCLive returned, else the entry this screen adds */
function applyHist(v, res, entry){
  if(res && Array.isArray(res.hist)){ v.hist = res.hist.slice(-20); return; }
  const h = (v.hist = v.hist || []), last = h[h.length-1];
  if(last && last.d===entry.d && last.p===entry.p && last.note===entry.note) return;   // KCLive already put the entry in KC.P
  h.push(entry); if(h.length>20) h.splice(0, h.length-20);
}

/* ═════════ Materials price list: the ONLY place material prices change ═════════ */
const plCanEdit = () => KC.can('editPrices') && ready();
/* "Used in": how many ready-made starts (packages) of ALL products use each material; a start named 'blank' is not a package. Built once per render. */
let USED = {}, USED_N = -1;
function usedMap(){
  const n = KC.productList().length;
  if(n===USED_N) return USED;                                  // a package's materials do not depend on prices: count once per set of products
  USED_N = n;
  const m = {};
  KC.productList().forEach(D => (D.starts||[]).forEach(st => {
    if(st.id==='blank') return;
    let q; try { q = D.quantities(D.startCfg(st.id)); } catch(err){ console.error('KC admin: could not count the "Used in" of', D.id, st.id, err); return; }
    new Set(q.map(x => x.k)).forEach(k => { m[k] = (m[k]||0) + 1; });
  }));
  return (USED = m);
}
const isSample = v => v.p!=null && v.source==='Sample';

/* the size cell of a blower row: the live rating text, and what is missing from it */
function ratingCell(k, v){
  const miss = []; if(!(v.hp>0)) miss.push('HP'); if(!(v.cfm>0)) miss.push('CFM'); if(!(v.sp>0)) miss.push('static pressure');
  const list = miss.length>1 ? miss.slice(0,-1).join(', ')+' and '+miss[miss.length-1] : miss[0];
  return esc(ratingText(k)||'—') + (miss.length ? `<span class="kc-adm-no">no ${list} entered</span>` : '');
}
/* the HP / CFM / Static pressure block of an expanded blower row; plain text (no inputs) for a role that cannot edit */
function ratingBlock(k, v, can){
  const fam = (FAMILIES.find(f => f[0]===v.fam)||[])[1];
  const val = (x, dec) => x==null ? '' : dec==null ? String(x) : Number(x).toFixed(dec);
  const fields = [['hp','HP',0.01,null],['cfm','CFM',1,null],['sp','Static pressure (in. w.g.)',0.01,2]];
  const body = can
    ? `<div class="kc-adm-rate">${fields.map(([f,l,st,dec]) => `<label class="kc-opt">${l}<input type="number" min="0" step="${st}" inputmode="decimal" data-plr="${f}" data-plk="${esc(k)}" value="${val(v[f],dec)}" aria-label="${l} of ${esc(v.l)}"></label>`).join('')}</div>`
    : `<div class="kc-adm-rate-ro"><span>HP <b>${v.hp>0?esc(val(v.hp)):'not entered'}</b></span><span>CFM <b>${v.cfm>0?Number(v.cfm).toLocaleString('en-US'):'not entered'}</b></span><span>Static pressure <b>${v.sp>0?Number(v.sp).toFixed(2)+' in. w.g.':'not entered'}</b></span></div>`;
  return `<div class="kc-adm-rating"><div><b>Rating</b> <span class="kc-sm">${esc(ratingText(k)||'no rating entered')}${fam?' · '+esc(fam):''}</span></div>${body}
    <div class="kc-sm">A blank HP or CFM makes the model unusable: the ventilation line says "has no CFM entered". ${can?'Each price change is kept in the history below.':'Your role can see the rating but not change it.'}</div></div>`;
}
/* the expanded row: ratings (blowers only) and the history of the row */
function histRow(k, v, can){
  const hist = v.hist || [];
  const entry = h => `<tr><td>${esc(h.d)}</td><td>${h.p!=null ? peso(h.p) : `<i>${esc(h.note||'—')}</i>${h.rating?`<br><span class="kc-sm">${esc(h.rating)}</span>`:''}`}</td><td>${esc(h.by)}</td></tr>`;
  return `<tr class="kc-hist"><td colspan="10">${isBlower(k)?ratingBlock(k,v,can):''}<b>Price history — ${esc(v.l)}</b>${hist.length
    ? `<table class="kc-cost kc-adm-hist"><tr><td><b>Date</b></td><td><b>Price</b></td><td><b>By</b></td></tr>${hist.slice().reverse().map(entry).join('')}</table>`
    : ' <span class="kc-sm">No price entered yet.</span>'}</td></tr>`;
}
function rowHTML(k, v, can){
  const inf = KC.PL_INFO[k] || ['Other','—','—'], hist = v.hist || [], last = hist[hist.length-1], used = USED[k]||0, open = S.plh===k;
  const rowCan = can;           // the corner charge row too: KCLive keeps it and kc_config/settings.corner in step
  const src = v.source ? esc(v.source) : '—';
  const chip = v.p==null || !v.source ? '' : `<span class="kc-sample kc-adm-srcchip${v.source==='Sample'?'':' kc-adm-real'}">${src}</span>`;
  const price = rowCan
    ? `<input type="number" min="0" step="0.01" class="edit-price${v.p==null?' needs-price':''}" data-plp="${esc(k)}" value="${v.p!=null?v.p.toFixed(2):''}" placeholder="No price" aria-label="Price of ${esc(v.l)}">${chip}`
    : (v.p==null ? '<b style="color:var(--red)">No price</b>' : peso(v.p)) + chip;
  return `<tr class="${v.p==null?'kc-noprice':''}"><td><span class="kc-cat">${esc(inf[0])}</span></td><td><b>${esc(v.l)}</b></td><td>${esc(inf[1])}</td><td>${isBlower(k)?ratingCell(k,v):esc(inf[2])}</td><td>${esc(v.u)}</td>
    <td class="kc-num kc-adm-pc${rowCan?'':' kc-adm-ro'}">${price}</td>
    <td class="kc-sm kc-adm-src${v.source==='Sample'?' kc-adm-sample':''}">${v.p==null?'—':src}</td>
    <td class="kc-sm">${last?`${esc(last.d)}<br>${esc(last.by)}`:'—'}</td><td class="kc-sm">${used?`${used} ${plural(used,'package')}`:'—'}</td>
    <td><button type="button" class="cfg-link" data-plh="${esc(k)}" aria-expanded="${open}">History (${hist.length})</button></td></tr>` + (open ? histRow(k,v,can) : '');
}
/* the rows that pass the tab, the search and the "without a price" filter */
function visibleRows(){
  const q = (S.plq||'').trim().toLowerCase(), cat = S.plcat||'all';
  return Object.entries(KC.P).filter(([k,v]) => {
    const inf = KC.PL_INFO[k] || ['Other'];
    if(S.plmiss && v.p!=null) return false;
    if(cat!=='all' && inf[0]!==cat) return false;
    return !q || (v.l+' '+(KC.PL_INFO[k]||[]).join(' ')+' '+(v.source||'')).toLowerCase().includes(q);
  });
}
/* refresh only the table body and the count (typing in the search box must not lose the caret) */
function refreshRows(){
  const body = $('plBody'); if(!body) return;
  const can = plCanEdit(), total = Object.keys(KC.P).length, rows = visibleRows();
  body.innerHTML = rows.map(([k,v]) => rowHTML(k,v,can)).join('') || '<tr><td colspan="10" class="kc-empty">No material matches.</td></tr>';
  const c = $('plCount'); if(c) c.textContent = rows.length===total ? `${total} materials` : `${rows.length} of ${total} materials`;
}
function addForm(){
  return `<div class="cfg-group kc-pladd"><div class="cfg-lbl">New material</div><div class="kc-plgrid">
      <label class="kc-opt">Category<select id="naCat">${KC.PL_CATS.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
      <label class="kc-opt">Material<input id="naName" placeholder="e.g. SS304 sheet 2.0 mm (4×8 ft)"></label>
      <label class="kc-opt">Grade<input id="naGrade" placeholder="SS304"></label>
      <label class="kc-opt" id="naSizeWrap">Thickness / size<input id="naSize" placeholder="2.0 mm · 4×8 ft"></label>
      <label class="kc-opt">Unit<input id="naUnit" placeholder="sheet"></label>
      <label class="kc-opt">Price (₱), required<input id="naPrice" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></label></div>
      <div class="kc-plgrid kc-adm-blow" id="naBlow" hidden>
        <label class="kc-opt">Family<select id="naFam">${FAMILIES.map(([v,l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
        <label class="kc-opt">HP<input id="naHp" type="number" min="0" step="0.01" inputmode="decimal" placeholder="e.g. 2"></label>
        <label class="kc-opt">CFM<input id="naCfm" type="number" min="0" step="1" inputmode="decimal" placeholder="airflow"></label>
        <label class="kc-opt">Static pressure (in. w.g.)<input id="naSp" type="number" min="0" step="0.01" inputmode="decimal" placeholder="e.g. 1.5"></label></div>
      <div class="cfg-slot-ctl"><button type="button" class="btn btn-green btn-sm" data-plsave>Save material</button><button type="button" class="cfg-link" data-pladd>Cancel</button></div></div>`;
}
/* the line under the title: what the person can do here, and why not when they cannot */
function plBanner(can){
  const st = stateOf(), role = KC.ROLES[S.role] || {};
  if(!ready()){
    const L = live(), detail = L && typeof L.detail==='string' ? L.detail : '';
    const why = st==='loading' || st==='idle' ? 'The prices are still loading.' : st==='denied' ? 'This login cannot read the price list.' : (detail || 'The price list could not be loaded (no connection, or it has not been imported yet).');
    return `<div class="cfg-errbox">Prices could not be loaded. Configured lines keep their stored price. ${esc(why)}${KC.can('editSettings') && st!=='loading' && st!=='idle' ? ' Import it from Pricing settings.' : ''}</div>`;
  }
  return `<div class="cfg-notice" style="background:#eef5fc;border-color:#9dc3e6;color:#1E3A5F">This list feeds every configurator material. Prices change <b>only here</b>; quotes being built pick up a new price at once, filed quotes keep the price they were filed with. ${can?`You can edit as <b>${esc(role.name||'this account')}</b>; every change is kept in the history.`:`${esc(role.dept||'Your role')} can see prices but not change them.`}</div>`;
}
function sourceMix(){
  const n = {}; Object.values(KC.P).forEach(v => { const s = v.p==null ? 'No price' : (v.source || 'Unknown'); n[s] = (n[s]||0)+1; });
  const order = ['Sample','Kingsway PO + 10%','Set by Neil','Manual','Unknown','No price'];
  const bits = order.filter(s => n[s]).map(s => `${esc(s)} ${n[s]}`);
  return bits.length ? `<div class="kc-adm-mix">By source: ${bits.join(' · ')}. "Sample" prices are made-up placeholders until the real one is entered.</div>` : '';
}
function renderPrices(){
  if(KC.holdWhilePressed && KC.holdWhilePressed(renderPrices)) return;       // not between a press and its click (the first tap after typing a price was lost)
  const el = $('scrPrices'); if(!el) return;
  const hadFocus = KC.captureFocus ? KC.captureFocus(el) : null;             // the price box being typed in keeps the focus
  const can = plCanEdit(); if(!can) S.pladd = false;
  USED = usedMap();
  const missing = Object.values(KC.P).filter(v => v.p==null).length; if(!missing) S.plmiss = false;
  const cat = S.plcat||'all';
  el.innerHTML = `<div class="section"><div class="sec-title"><span>Materials price list</span><span class="kc-sm" style="text-transform:none;letter-spacing:0">Quote builder › Materials price list</span></div>
    ${plBanner(can)}${msgHtml('pl')}${sourceMix()}
    <div class="kc-plbar"><input type="search" class="search-input kc-adm-search" id="kcPlSearch" placeholder="Search materials…" aria-label="Search materials" value="${esc(S.plq||'')}">
      <div class="cat-tabs kc-adm-tabs" role="tablist" aria-label="Material categories" style="margin:0">${['all',...KC.PL_CATS].map(c => `<button type="button" role="tab" aria-selected="${cat===c}" aria-controls="plPanel" class="cat-tab${cat===c?' active':''}" data-plcat="${esc(c)}">${c==='all'?'All':esc(c)}</button>`).join('')}</div>
      ${missing ? `<button type="button" class="ms-chip bad${S.plmiss?' kc-adm-on':''}" data-plmiss aria-pressed="${!!S.plmiss}" title="${S.plmiss?'Showing only these. Click to show every material.':'Show only the materials without a price.'}">${missing} without a price</button>` : '<span class="ms-chip ok">Every item priced</span>'}
      <span class="kc-adm-count" id="plCount"></span>
      ${can?`<button type="button" class="btn btn-green btn-sm" data-pladd>+ Add material</button>`:''}</div>
    ${S.pladd&&can ? addForm() : ''}
    <div class="kc-tblwrap" id="plPanel" role="tabpanel" aria-label="Materials"><table class="kc-pl"><thead><tr><th>Category</th><th>Material</th><th>Grade</th><th>Thickness / size</th><th>Unit</th><th class="kc-num">Price</th><th>Source</th><th>Last changed</th><th>Used in</th><th></th></tr></thead>
      <tbody id="plBody"></tbody></table></div>
    <div class="kc-sm" style="margin-top:8px">A material with no price never counts as zero: any line that uses it shows "Priced after review" until a price is entered here. A price cannot be saved blank.</div></div>`;
  refreshRows();
  /* on a phone the tab row scrolls sideways and a re-render resets it: bring the active tab back into the middle of the row */
  const bar = el.querySelector('.cat-tabs'), on = bar && bar.querySelector('.cat-tab.active');
  if(on && bar.scrollWidth > bar.clientWidth){ const b = bar.getBoundingClientRect(), t = on.getBoundingClientRect();
    bar.scrollLeft += (t.left - b.left) - (b.width - t.width) / 2; }
  if(hadFocus && KC.restoreFocus) KC.restoreFocus(el, hadFocus);
}
/* a new key for a row added here: u + base 36 time (a-z 0-9 only, which the rules require), unique in the list */
function newKey(){ let k, i = 0; do { k = 'u' + (Date.now() + i++).toString(36); } while(KC.P[k]); return k; }
/* "Save material": a new row. The price is required (never saved blank); a blower row also carries fam / hp / cfm / sp */
async function saveNewMaterial(){
  if(BUSY) return;
  const name = $('naName').value.trim(); if(!name){ say('pl','err','Type the material name.'); renderPrices(); return; }
  const cat = $('naCat').value, blow = cat===BLOW;
  const pr = numOrNull($('naPrice').value);
  if(pr===null || badNum(pr)){ say('pl','err','Type a price. A material cannot be saved without one.'); renderPrices(); return; }
  const price = Math.round(pr*100)/100, key = newKey();
  const patch = { l:name, u:$('naUnit').value.trim()||'pc', cat, grade:$('naGrade').value.trim()||'—', size: blow ? '' : ($('naSize').value.trim()||'—'), p:price, source:'Manual' };
  if(blow){
    patch.fam = $('naFam').value;
    for(const [f,id] of [['hp','naHp'],['cfm','naCfm'],['sp','naSp']]){ const n = numOrNull($(id).value); if(badNum(n)){ say('pl','err','Check the '+f.toUpperCase()+' entry.'); renderPrices(); return; } patch[f] = n; }
    patch.ratingNote = [patch.hp>0 ? patch.hp+' HP' : null, patch.cfm>0 ? Number(patch.cfm).toLocaleString('en-US')+' CFM' : null, patch.sp>0 ? '@ '+Number(patch.sp).toFixed(2)+' in' : null].filter(Boolean).join(' · ') || 'no rating entered';
  }
  BUSY = true; say('pl','ok','Saving…'); renderPrices();
  try{
    const res = await viaLive('saveMaterial', key, patch);
    const row = KC.P[key] || (KC.P[key] = { l:patch.l, u:patch.u, p:price, hist:[] });       // KCLive has usually put the row there already
    row.l = patch.l; row.u = patch.u; row.p = price; row.source = 'Manual';
    if(blow){ row.fam = patch.fam; row.hp = patch.hp; row.cfm = patch.cfm; row.sp = patch.sp; }
    if(!KC.PL_INFO[key]) KC.PL_INFO[key] = [cat, patch.grade, blow ? '' : patch.size];
    if(blow) KC.PL_INFO[key][2] = ratingText(key);
    applyHist(row, res, { d:KC.today(), p:price, by:who() });
    S.pladd = false; S.plq = ''; S.plmiss = false; if(S.plcat && S.plcat!=='all') S.plcat = cat;      // show the new row where the person is looking
    say('pl','ok','Saved "'+name+'".');
    items();
  }catch(err){ console.error('KC admin: the new material was not saved', err); say('pl','err','Not saved: '+errText(err)+'. Nothing changed.'); }
  BUSY = false; renderPrices();
}

/* ═════════ Pricing settings ═════════ */
let ovrMsg = '';                                   // the red line under the override box after a rejected entry (shown once)
/* "Pending Rene's review" (owner Q28): the fabrication placeholders, as [group, [[what, value], ...]]. The engine supplies the list (KC.pendingReview(), kept with the
   engine sources: addendum A9 keeps build rules out of this readable file); a row whose value is empty is left out. */
function pendingGroups(){
  let g = null;
  try{ g = typeof KC.pendingReview==='function' ? KC.pendingReview() : null; }catch(err){ console.error('KC admin: the pending list failed', err); }
  const ok = v => v != null && v !== '' && !(typeof v === 'number' && !isFinite(v));
  return Array.isArray(g) ? g.map(([name, rows]) => [name, (rows||[]).filter(r => r && ok(r[1]))]).filter(x => x[1].length) : [];
}
function pendingBlock(){
  const gs = pendingGroups();
  if(!gs.length) return typeof KC.pendingReview==='function' ? '' : `<div class="cfg-group cfg-wide kc-adm-pend"><div class="cfg-lbl">Pending Rene's review</div><div class="kc-sm">The list of fabrication sizes waiting for Rene comes with the engine and is not in this build.</div></div>`;
  return `<div class="cfg-group cfg-wide kc-adm-pend"><div class="cfg-lbl">Pending Rene's review <span class="kc-eng">Placeholders · Rene confirms this week</span></div>
    <div class="kc-sm">These fabrication sizes and rules are placeholders. They drive quantities and prices today, but Rene has not confirmed them. In a configurator's build detail the staff see the same sizes marked "pending Rene's review"; none of it prints on a quotation. Read-only.</div>
    <div class="kc-adm-pgrid">${gs.map(([g, rows]) => `<div class="kc-adm-pbox"><div class="kc-adm-ptitle">${esc(g)} <span class="kc-adm-ptag">${rows.length} placeholders</span></div>
      <table class="kc-cost"><tbody>${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</tbody></table></div>`).join('')}</div></div>`;
}

const getS = path => path.split('.').reduce((o,k) => o[k], SET);
const setIn = (obj, path, v) => { const ks = path.split('.'), last = ks.pop(); ks.reduce((o,k) => o[k], obj)[last] = v; };
const floorModeNow = () => (KC.FLOOR_MODE==='formula' || (KC.FLOOR_MODE==null && SET.floorMode==='formula')) ? 'formula' : 'list';
/* the patch for one changed setting: only that key, with its parent group for a nested one ({ hood: { overhang: 20 } }); KCLive merges it into the stored document */
function patchOf(path, v){
  const ks = path.split('.'), out = {}; let o = out;
  ks.forEach((k, i) => { if(i===ks.length-1) o[k] = v; else o = o[k] = {}; });
  return out;
}
/* the corner charge lives in two places (kc_config/settings.corner and the Corner charge row of the price list); KCLive writes both from either side, and this makes sure of the row if it did not */
async function commitCorner(n){
  await viaLive('saveSettings', { corner:n });
  SET.corner = n;
  const row = KC.P.cornerc;
  if(row && row.p!==n){
    try{
      const res = await viaLive('saveMaterial', 'cornerc', { p:n, source:'Manual' });
      row.p = n; row.source = 'Manual'; applyHist(row, res, { d:KC.today(), p:n, by:who() });
    }catch(err){ console.error('KC admin: the corner row of the price list was not updated', err); throw new Error('the corner charge was saved in the settings, but its price-list row could not be updated ('+errText(err)+')'); }
  }
}

/* ═════════ the Standard Price List (kc_config/list_prices): every code, its price, its per-metre rate and its price status. Read-only here; the status is staff only, never printed ═════════ */
const LINES = [['CK','Cooking'],['GR','Grilling'],['BK','Bakery'],['PS','Prep and storage'],['WS','Washing'],['VN','Ventilation']];
const lineOf = code => { const hit = LINES.find(l => l[0]===String(code).split('-')[0]); return hit ? hit[1] : 'Other'; };
const STATUS = [['Data','data','From our own past quotes.'],['Smoothed','smooth','Adjusted between neighbouring sizes so a longer item never costs less.'],['Estimate','est','A judgement: there is no quote history for it.'],
  ['After review','review','Not priced from data yet: confirm it before relying on it.'],['Supplier price','supp','A bought-in unit: supplier cost plus markup.'],
  ['Approved','appr','The owner has confirmed this price.']];
const statusClass = st => (STATUS.find(x => x[0]===st) || [,'none'])[1];
const naturalCmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric:true });
let LPDOC = { rows:null, effective:'', read:false, failed:false };            // the document as read; KC.LISTP is the engine's copy
const normRow = (code, v) => v && typeof v==='object'
  ? { code:String(v.code||code), price:typeof v.price==='number' ? v.price : null, perMetre:typeof v.perMetre==='number' ? v.perMetre : null, status:String(v.status||''), label:String(v.label||''), std:String(v.std||'') }
  : (typeof v==='number' ? { code, price:v, perMetre:null, status:'', label:'', std:'' } : null);
function listRowsNow(){
  if(LPDOC.rows && Object.keys(LPDOC.rows).length) return LPDOC.rows;
  const m = KC.LISTP;
  if(m && typeof m==='object'){ const rows = {}; Object.keys(m).forEach(k => { const r = normRow(k, m[k]); if(r && r.price!=null) rows[k] = r; }); if(Object.keys(rows).length) return rows; }
  return null;
}
const listRowFor = code => { const r = listRowsNow(); return r && r[code] || null; };
function readListDoc(force){
  if(typeof db==='undefined' || !db || (LPDOC.read && !force)) return;
  LPDOC.read = true;                                          // a failed read is not retried by itself (a re-render would loop); Import reads again
  try{
    db.collection('kc_config').doc('list_prices').get().then(snap => {
      const d = snap && snap.exists ? (snap.data()||{}) : {}, rows = {};
      Object.entries(d.rows && typeof d.rows==='object' ? d.rows : {}).forEach(([k, v]) => { const r = normRow(k, v); if(r && r.price!=null) rows[k] = r; });
      LPDOC.rows = rows; LPDOC.effective = typeof d.effective==='string' ? d.effective : ''; LPDOC.failed = false;
      if($('scrSettings') && KC.can('editSettings')) renderSettings();
    }, err => { console.warn('KC admin: the standard price list could not be read', err); LPDOC.failed = true; if($('scrSettings') && KC.can('editSettings')) renderSettings(); });
  }catch(err){ LPDOC.failed = true; }
}
function lpRowHtml(r){
  const st = r.status || '';
  return `<tr><td class="kc-adm-lpc"><b>${esc(r.code)}</b><span class="kc-adm-lpsub">${esc(r.label)}</span></td><td class="kc-adm-lpl">${esc(r.label)}</td><td class="kc-sm kc-adm-lps">${esc(r.std)}</td>
    <td class="kc-num">${r.price!=null ? peso(r.price) : '—'}</td><td class="kc-num">${r.perMetre!=null ? peso(r.perMetre) : '—'}</td><td><span class="kc-adm-st kc-adm-st-${statusClass(st)}" title="${esc((STATUS.find(x => x[0]===st)||[])[2]||'')}">${esc(st||'—')}</span></td></tr>`;
}
/* the rows that pass the search and the status filter, grouped by product line, in natural code order */
function lpVisible(){
  const rows = listRowsNow() || {}, q = (S.lpq||'').trim().toLowerCase(), want = S.lpst || null;
  const list = Object.values(rows).filter(r => (!want || r.status===want) && (!q || (r.code+' '+r.label+' '+r.std+' '+r.status).toLowerCase().includes(q)));
  const order = LINES.map(l => l[1]).concat(['Other']);
  list.sort((a, b) => order.indexOf(lineOf(a.code)) - order.indexOf(lineOf(b.code)) || naturalCmp(a.code, b.code));
  return list;
}
function lpBodyHtml(){
  const list = lpVisible(); let line = '', out = '';
  list.forEach(r => { const ln = lineOf(r.code); if(ln!==line){ line = ln; out += `<tr class="kc-adm-lpg"><td colspan="6">${esc(ln)}</td></tr>`; } out += lpRowHtml(r); });
  return out || '<tr><td colspan="6" class="kc-empty">No price matches.</td></tr>';
}
function refreshLp(){
  const body = $('lpBody'); if(!body) return;
  body.innerHTML = lpBodyHtml();
  const c = $('lpCount'), all = listRowsNow() || {}, n = lpVisible().length, t = Object.keys(all).length;
  if(c) c.textContent = n===t ? `${t} prices` : `${n} of ${t} prices`;
}
function listPricesBlock(){
  const head = `<div class="cfg-group cfg-wide kc-adm-lp"><div class="cfg-lbl">Standard price list <span class="cfg-staff-chip" title="Only the President can see it">President only</span><span class="kc-eng">Price status: staff only, never printed</span></div>`;
  const intro = `<div class="kc-sm">The standard code of each product and its price (ex-VAT). Products sold by length also have the rate for each metre more or less than the standard length. A configured line starts from the price of its code. <b>Price status</b> says how firm a price is.</div>`;
  const rows = listRowsNow();
  if(!rows) return head + intro + `<div class="kc-sm">${LPDOC.failed ? 'The standard price list could not be read.' : LPDOC.read ? 'The standard price list is not loaded yet. Import it from a file below.' : 'Loading the standard price list…'}</div></div>`;
  const n = {}; Object.values(rows).forEach(r => { n[r.status||''] = (n[r.status||'']||0)+1; });
  const chips = STATUS.filter(x => n[x[0]]).map(x => `<button type="button" class="kc-adm-st kc-adm-st-${x[1]} kc-adm-stbtn${S.lpst===x[0]?' kc-adm-on':''}" data-lpst="${esc(x[0])}" aria-pressed="${S.lpst===x[0]}" title="${esc(x[2])}">${esc(x[0])} ${n[x[0]]}</button>`).join('');
  return head + intro + `<div class="kc-plbar"><input type="search" class="search-input kc-adm-search" id="lpSearch" placeholder="Search code or product…" aria-label="Search the standard price list" value="${esc(S.lpq||'')}">${chips}<span class="kc-adm-count" id="lpCount"></span></div>
    ${LPDOC.effective ? `<div class="kc-sm">Effective ${esc(LPDOC.effective)}.</div>` : ''}
    <div class="kc-tblwrap"><table class="kc-adm-lptbl"><thead><tr><th>Code</th><th>Item</th><th>Standard size and spec</th><th class="kc-num">Price</th><th class="kc-num" title="For each metre more or less than the standard length">Per metre</th><th>Status</th></tr></thead><tbody id="lpBody">${lpBodyHtml()}</tbody></table></div></div>`;
}

/* the Chef Mode rows for the Q64 report. The engine lists the models of the whole price list when it can (KC.listModels() -> [{ code, productId, baseCfg }]); until then
   every Chef Mode code reachable from the products' start models (and the oven / no-baskets variants), costed at today's material prices */
function listRows(){
  const own = code => { const r = listRowFor(code); return r && r.label ? r.label : ''; };
  if(typeof KC.listModels==='function'){
    let models = null; try{ models = KC.listModels(); }catch(err){ console.error('KC admin: the model list failed', err); }
    if(Array.isArray(models)){
      const out = new Map(), missing = new Set();
      models.forEach(m => {
        if(!m || !m.code || out.has(m.code) || missing.has(m.code)) return;
        let pr; try{ pr = KC.price(m.productId, m.baseCfg, { noList:true }); }catch(err){ pr = null; }
        const lr = listRowFor(m.code), list = typeof m.price==='number' ? m.price : (lr && lr.price);
        if(!pr || !pr.priced || !(list>0)){ missing.add(m.code); return; }
        out.set(m.code, { code:m.code, list, projectCost:pr.projectCost, stdMarkup:SET.markup, label:own(m.code) || m.label || '' });
      });
      return { rows:[...out.values()], missing:[...missing] };
    }
  }
  const out = new Map(), missing = new Set(), lp = KC.chefListPrice;
  if(typeof lp!=='function') return null;
  KC.productList().forEach(D => {
    if(!D.listAdjust) return;
    (D.starts||[]).forEach(st => {
      if(st.id==='blank') return;
      let c0; try{ c0 = D.startCfg(st.id); }catch(err){ return; }
      [c0, Object.assign({}, c0, { base:'oven' }), Object.assign({}, c0, { baskets:false })].forEach(c => {
        let row; try{ row = lp(c); }catch(err){ row = null; }
        if(!row || out.has(row.code) || missing.has(row.code)) return;
        let pr; try{ pr = KC.price(D.id, row.base, { noList:true }); }catch(err){ pr = null; }
        if(!pr || !pr.priced){ missing.add(row.code); return; }
        out.set(row.code, { code:row.code, list:row.price, projectCost:pr.projectCost, stdMarkup:SET.markup, label:own(row.code) || (D.title||D.chip||D.id)+(st.label?' · '+st.label:'') });
      });
    });
  });
  return { rows:[...out.values()], missing:[...missing] };
}
function reportBlock(){
  const head = `<div class="cfg-group cfg-wide"><div class="cfg-lbl">Items where cost × ${esc(SET.markup)} is above the list price <span class="cfg-staff-chip" title="Only the President can see it">President only</span></div>`;
  const note = `<div class="kc-sm">Cost × the standard markup, from the project cost of each standard model, at today's material prices. While the floor mode is "list price" a price typed under the list price is what warns; when Delfin's real prices are in, switch the floor mode to "formula" and these are the items that need a look. Shown in both modes.</div>`;
  if(!ready()) return head + '<div class="kc-sm">Prices are not loaded, so there is nothing to report yet.</div></div>';
  const R = window.KCRules, data = listRows();
  if(!R || typeof R.aboveListReport!=='function' || !data) return head + '<div class="kc-sm">This report is not available in this build.</div></div>';
  const hits = (R.aboveListReport(data.rows) || []).map(h => {
    const src = data.rows.find(r => r.code===h.code) || {}, lr = listRowFor(h.code);
    const cx = typeof h.costTimesMarkup==='number' ? h.costTimesMarkup : (src.projectCost||0) * (src.stdMarkup||SET.markup);
    return { code:h.code, label:src.label||'', status:(lr && lr.status) || '', list:h.list, cx, diff: typeof h.diff==='number' ? h.diff : cx - h.list };
  }).sort((a,b) => b.diff - a.diff);
  const miss = data.missing.length ? `<div class="kc-sm">${data.missing.length} ${plural(data.missing.length,'model')} could not be costed (a material has no price): ${esc(data.missing.join(', '))}.</div>` : '';
  const body = hits.length
    ? `<table class="kc-adm-rep"><thead><tr><th>Code</th><th>Item</th><th>Price status</th><th class="kc-num">List price</th><th class="kc-num">Cost × ${esc(SET.markup)}</th><th class="kc-num">Difference</th></tr></thead><tbody>${hits.map(h => `<tr><td><b>${esc(h.code)}</b></td><td>${esc(h.label)}</td><td>${h.status ? `<span class="kc-adm-st kc-adm-st-${statusClass(h.status)}">${esc(h.status)}</span>` : '—'}</td><td class="kc-num">${peso(h.list)}</td><td class="kc-num">${peso(h.cx)}</td><td class="kc-num">${peso(h.diff)}</td></tr>`).join('')}</tbody></table>`
    : '<div class="kc-sm"><b>None.</b> Every list price is at or above cost × the markup.</div>';
  return head + note + body + miss + '</div>';
}

/* the switch document, read once per page load (KCLive.flags is the copy loaded with the builder); a change made here updates the copy at once */
let SWITCH = { kcMode:null, read:false };
function switchModeNow(){
  if(SWITCH.kcMode) return SWITCH.kcMode;
  const L = live(), f = L && L.flags;
  const m = f && (f.kcMode || (f.switch && f.switch.kcMode));
  return ['off','president','on'].includes(m) ? m : 'off';
}
function readSwitch(){
  if(typeof db==='undefined' || !db || SWITCH.read) return;
  SWITCH.read = true;
  try{
    db.collection('settings').doc('quote_builder').get().then(snap => {
      const m = snap && snap.exists ? (snap.data()||{}).kcMode : 'off';
      SWITCH.kcMode = ['off','president','on'].includes(m) ? m : 'off';
      if($('scrSettings')) renderSettings();
    }, err => { console.warn('KC admin: the switch could not be read', err); SWITCH.read = false; });
  }catch(err){ SWITCH.read = false; }
}
const SWITCH_OPTS = [
  ['off','Off','Everyone starts new quotes with the old quote builder. Quotes already made with the configurators keep opening.'],
  ['president','President only','Only you start new quotes with the configurators, for trying them out.'],
  ['on','Everyone','Every account starts new quotes with the configurators.']
];
function switchBlock(){
  const cur = switchModeNow(), L = live();
  return `<div class="cfg-group cfg-wide"><div class="cfg-lbl">Configurators for new quotes <span class="cfg-staff-chip" title="Only the President can set it">President only</span></div>
    <div class="kc-sm">Who starts a NEW quote with the configurators (the seven tabs and the new pricing). It takes effect the next time each person opens the quote builder. Quotes, drafts and templates made before it was switched on always open and price exactly as before, and Brilliance Steel never uses it.</div>
    <div class="kc-adm-radios" role="radiogroup" aria-label="Configurators for new quotes">${SWITCH_OPTS.map(([v,l,t]) => `<label><input type="radio" name="kcMode" value="${v}" data-kcmode ${cur===v?'checked':''}${BUSY||!(L&&L.saveSwitch)?' disabled':''}><span>${l}<span class="kc-sm">${t}</span></span></label>`).join('')}</div>
    <div class="kc-sm" style="margin-top:6px">One device can opt out from Help › Configurators on this device.</div>
    <label style="margin-top:12px;display:flex;gap:10px;align-items:flex-start;cursor:pointer;text-transform:none;letter-spacing:normal;font-weight:400;font-size:13px;color:inherit"><input type="checkbox" style="flex:0 0 auto;margin-top:3px" data-approveall ${approveAllNow()?'checked':''}${BUSY||!(L&&L.saveSwitch)?' disabled':''}><span><b>Every quote needs the President's approval</b><span class="kc-sm"> Sales can only send a configurator quote for approval; the President files it. Turn off when the price rules are trusted.</span></span></label></div>`;
}
/* owner 2026-11-20 (Finalize Step 1.4): day-one "every quote goes to Neil", the approveAll flag of settings/quote_builder, as a screen control (the write is KCLive.saveSwitch) */
function approveAllNow(){ const L = live(); return !!(L && L.flags && L.flags.approveAll === true); }
async function setApproveAll(on){
  if(BUSY || !KC.can('editSettings')) return renderSettings();
  BUSY = true; say('st','ok','Saving…'); renderSettings();
  try{
    await viaLive('saveSwitch', { approveAll: !!on });
    const L = live(); if(L && L.flags && typeof L.flags==='object') L.flags.approveAll = !!on;
    say('st','ok', on ? 'Saved: every configurator quote now needs your approval before it is filed.' : 'Saved: quotes need your approval only when the price rules say so.');
  }catch(err){ console.error('KC admin: approveAll was not saved', err); say('st','err','Not saved: '+errText(err)+'. Nothing changed.'); }
  BUSY = false; renderSettings();
}
/* "Import prices from a file": the seed made by scripts/kc-seed-build.js. The file is parsed and counted here; the write is KCLive.importSeed(json). */
let SEED = null;                                   // { name, json, counts } once a valid file has been chosen
function seedCounts(json){
  const m = json && json.materials, lp = json && json.listPrices && json.listPrices.rows, pr = json && json.products;
  if(!json || typeof json!=='object' || json.v!==1 || !m || typeof m!=='object' || Array.isArray(m) || !lp || typeof lp!=='object' || !Array.isArray(pr)) return null;
  return { materials:Object.keys(m).length, lists:Object.keys(lp).length, products:pr.length, settings:!!(json.settings && typeof json.settings==='object'), made:json.made||'', effective:json.listPrices.effective||'' };
}
const seedLine = c => `${c.materials} ${plural(c.materials,'material')}, ${c.lists} list ${plural(c.lists,'price')}, ${c.products} ${plural(c.products,'product')}${c.settings?', settings':''}`;
function importBlock(){
  const L = live(), can = !!(L && typeof L.importSeed==='function');
  const sum = SEED ? `<div class="kc-adm-imp-sum">${esc(SEED.name)}: ${esc(seedLine(SEED.counts))}${SEED.counts.effective?' · list prices effective '+esc(SEED.counts.effective):''}</div>` : '';
  return `<div class="cfg-group cfg-wide"><div class="cfg-lbl">Import prices from a file <span class="cfg-staff-chip" title="Only the President can import">President only</span></div>
    <div class="kc-sm">Loads the price file made for this tool: material prices, the Chef Mode list prices, the pricing settings and the Grilling and Bakery catalogue items. It is safe to import twice: the second time changes nothing. After an import, reload the quote builder to see the new catalogue items.</div>
    <div class="kc-edit"><input type="file" id="kcSeedFile" accept=".json,application/json" aria-label="Price file"${can&&!BUSY?'':' disabled'}>
      ${sum}${can?'':'<div class="kc-sm" style="color:var(--red)">The live price service is not loaded, so nothing can be imported.</div>'}
      <div class="cfg-slot-ctl"><button type="button" class="btn btn-green btn-sm" data-seedgo${SEED&&can&&!BUSY?'':' disabled'}>Import</button>${SEED?'<button type="button" class="cfg-link" data-seedclear>Clear</button>':''}</div></div></div>`;
}
const FLOOR_OPTS = [
  ['list','List price (current)','A price typed under a list price warns against the list price. Used until the real material prices are all in.'],
  ['formula','Formula (cost × markup)','The warning uses cost × the standard markup. Switch to it when Delfin\'s real prices are loaded; the report below shows what changes.']
];
function floorBlock(can){
  const cur = floorModeNow();
  return `<div class="cfg-group"><div class="cfg-lbl">Discount floor mode</div>
    <div class="kc-adm-radios" role="radiogroup" aria-label="Discount floor mode">${FLOOR_OPTS.map(([v,l,t]) => `<label><input type="radio" name="kcFloor" value="${v}" data-floor ${cur===v?'checked':''}${can?'':' disabled'}><span>${l}<span class="kc-sm">${t}</span></span></label>`).join('')}</div></div>`;
}

function renderSettings(){
  if(KC.holdWhilePressed && KC.holdWhilePressed(renderSettings)) return;     // same as renderPrices
  const el = $('scrSettings'); if(!el) return;
  const hadFocus = KC.captureFocus ? KC.captureFocus(el) : null;
  const pres = KC.can('editSettings');                                       // the President: money groups, import, switch, report
  const can = pres && ready(), dis = can ? '' : ' disabled';
  const ovrOn = typeof S.markupOvr === 'number' && isFinite(S.markupOvr) && S.markupOvr >= 1;
  const ex = 100, br = SET.br.medium, lab = ex*br/100, misc = SET.misc/100*(ex+lab), sell = Math.round((ex+lab+misc)*SET.markup/10)*10;
  /* the pressure losses read 0.02 / 0.20 (two decimals at least); a longer typed value such as 0.125 is shown whole */
  const val = id => { const v = getS(id), s = String(v); return /^duct\.loss\./.test(id) && (s.split('.')[1]||'').length < 2 ? Number(v).toFixed(2) : s; };
  const inp = (id, step, aria) => `<input type="number" step="${step||1}" min="0" data-set2="${id}" value="${val(id)}"${dis}${aria?` aria-label="${esc(aria)}"`:''}>`;
  /* one field: label, input, unit text after it */
  const f = (id, lbl, unit, step) => `<label class="kc-opt kc-adm-fld">${lbl}<span class="kc-levels">${inp(id,step)}${unit?`<span class="kc-sm">${unit}</span>`:''}</span></label>`;
  /* "40 to 50": two inputs under one label */
  const pair = (lbl, id1, id2, step) => `<div class="kc-opt kc-adm-fld"><span class="kc-adm-lbl">${lbl}</span><span class="kc-levels">${inp(id1,step,lbl+', from')}<span class="kc-sm">to</span>${inp(id2,step,lbl+', to')}</span></div>`;
  /* light / medium / heavy under one label */
  const tri = (lbl, base, step) => `<div class="kc-opt kc-adm-fld"><span class="kc-adm-lbl">${lbl}</span><div class="kc-adm-tri">${[['light','Light'],['medium','Medium'],['heavy','Heavy']].map(([k,l]) => `<label class="kc-opt">${l}${inp(base+'.'+k,step)}</label>`).join('')}</div></div>`;
  const eng = txt => ` <span class="kc-eng">${txt}</span>`;
  /* the money groups are the President's alone (the markup and the cost formula stay off every other screen, owner Q67) */
  const money = pres ? `
      <div class="cfg-group"><div class="cfg-lbl">Labor brackets (% of materials)</div><div class="kc-edit">${f('br.simple','Simple: prep tables, shelves, plain racks','%')}${f('br.medium','Medium: sinks, kitchen stations, carts','%')}${f('br.complex','Complex: range hoods, ducting, custom lines','%')}</div></div>
      <div class="cfg-group"><div class="cfg-lbl">Misc, markup, corners</div><div class="kc-edit">${f('misc','Misc (% of materials + labor)','%')}${f('markup','Markup factor (1 to 10)','×',0.05)}${f('corner','Corner charge (cost, per corner)','₱',10)}</div></div>
      <div class="kc-adm-ex"><div class="cfg-lbl">Example with these settings</div>
        <table class="kc-cost"><tr><td>Materials</td><td>${peso(ex)}</td></tr><tr><td>Labor, Medium ${br}%</td><td>${peso(lab)}</td></tr><tr><td>Misc ${SET.misc}%</td><td>${peso(misc)}</td></tr><tr class="tot"><td>Selling price (× ${SET.markup}, nearest 10 pesos)</td><td>${peso(sell)}</td></tr></table>
        <div class="kc-sm" style="margin-top:6px">Changes apply to quotes being built now. Filed quotes keep their price.</div></div>
      <div class="cfg-group kc-adm-ovr"><div class="cfg-lbl">Markup for this quote <span class="cfg-staff-chip" title="Only the President can set it">President only</span></div><div class="kc-edit">
        <label class="kc-opt kc-adm-fld" for="kcOvr">Markup factor for every line on this quote<span class="kc-levels"><input type="number" id="kcOvr" step="0.05" min="1" inputmode="decimal" data-ovr value="${ovrOn ? S.markupOvr : ''}" placeholder="${SET.markup}"${pres?'':' disabled'} aria-label="Markup for this quote"><span class="kc-sm">×</span>${ovrOn && pres ? '<button type="button" class="cfg-link" data-ovr-clear>Clear</button>' : ''}</span></label>
        ${ovrMsg ? `<div class="kc-sm" style="color:var(--red);font-weight:700" role="alert">${esc(ovrMsg)}</div>` : ''}
        <div class="kc-sm">${ovrOn ? `On: every cost-based line on the quote is priced at project cost × ${S.markupOvr} instead of × ${SET.markup} and shows a "markup override" chip.` : `Blank = the standard × ${SET.markup}.`} A unit price typed by hand warns when it is below the floor in force. Nothing goes below the project cost (× 1). Filed quotes keep their price.</div></div></div>
      ${floorBlock(can)}` : '';
  el.innerHTML = `<div class="section"><div class="sec-title"><span>Configurator pricing settings</span><span class="kc-sm" style="text-transform:none;letter-spacing:0">Quote builder › Pricing settings${pres?' · President only':''}</span></div>
    ${pres ? '' : '<div class="cfg-errbox">Only the President can change these. You are viewing the engineering factors read-only.</div>'}
    ${pres && !ready() ? '<div class="cfg-errbox">Prices could not be loaded, so the settings cannot be changed yet. The import and the switch below still work.</div>' : ''}
    ${msgHtml('st')}
    <div class="cfg-grid kc-adm-grid">${money}
      <div class="cfg-group"><div class="cfg-lbl">Range hood sizing${eng('Engineer to confirm')}</div><div class="kc-edit">
        ${f('hood.overhang','Overhang per open side (cm)')}${f('hood.depth','Default depth (cm)',null,5)}${f('hood.bodyH','Body height (cm)')}${pair('Body height allowed (cm)','hood.bodyMin','hood.bodyMax')}
        ${f('hood.mountH','Bottom edge above the floor (cm)',null,5)}<div class="kc-sm">Information only: printed in the hood's build detail, it does not change a price.</div>
        ${f('hood.lampEvery','One lamp per (cm)',null,10)}${f('hood.filter','Baffle filter size (cm)',null,5)}</div></div>
      <div class="cfg-group"><div class="cfg-lbl">Ducting factors${eng('Engineer to confirm')}</div><div class="kc-edit">
        ${tri('CFM per ft of hood','duct.cfmFt',10)}${f('duct.fpm','Duct velocity (fpm)',null,50)}${f('duct.aspect','Max aspect','&nbsp;: 1',0.5)}${f('duct.fresh','Fresh air (% of exhaust)',null,5)}
        ${f('duct.collarEvery','One collar per (cm of hood)',null,10)}${f('duct.hangerEvery','One hanger per (m)',null,0.1)}${f('duct.accessEvery','One access door per (m), standard',null,0.5)}${f('duct.accessCode','Access doors at most (m) apart, code tier',null,0.1)}</div></div>
      <div class="cfg-group"><div class="cfg-lbl">Pressure-loss table (in. w.g.)${eng('Engineer to confirm · placeholder values')}</div><div class="kc-edit">
        ${f('duct.loss.perM','Straight duct per m',null,0.01)}${f('duct.loss.elbow','Each elbow',null,0.01)}${f('duct.loss.goose','Gooseneck',null,0.01)}
        ${f('duct.loss.filters','Hood with baffle filters',null,0.01)}${f('duct.loss.nofilter','Hood without filters',null,0.01)}${f('duct.loss.intake','Fresh-air intake',null,0.01)}</div></div>
      ${pres ? reportBlock() : ''}
      ${pres ? listPricesBlock() : ''}
      ${pres ? importBlock() : ''}
      ${pres ? switchBlock() : ''}
      ${pendingBlock()}
    </div></div>`;
  ovrMsg = '';
  if(pres){ readSwitch(); readListDoc(); refreshLp(); }
  if(hadFocus && KC.restoreFocus) KC.restoreFocus(el, hadFocus);
}

/* ═════════ events (delegated at document level, so a dispatched bubbling event works) ═════════ */
document.addEventListener('click',e=>{
  const t = e.target.closest && e.target.closest('button'); if(!t) return; const d = t.dataset;
  if(d.plcat){ S.plcat = d.plcat; S.plmiss = false; return renderPrices(); }
  if(d.plh){ S.plh = S.plh===d.plh ? null : d.plh; return renderPrices(); }
  if('pladd' in d){ S.pladd = !S.pladd; say('pl', 'ok', ''); return renderPrices(); }
  if('plmiss' in d){ S.plmiss = !S.plmiss; if(S.plmiss){ S.plcat = 'all'; S.plq = ''; } return renderPrices(); }
  if('plsave' in d) return saveNewMaterial();
  if('ovrClear' in d){ if(!KC.can('editSettings')) return renderSettings(); setOverride(null); return; }
  if('seedclear' in d){ SEED = null; say('st','ok',''); return renderSettings(); }
  if(d.lpst){ S.lpst = S.lpst===d.lpst ? null : d.lpst; return renderSettings(); }
  if('seedgo' in d) return runImport();
});
document.addEventListener('change',e=>{
  const el = e.target, d = el.dataset || {};
  /* the category of the new material: Blowers & fans swaps Thickness / size for Family, HP, CFM, SP (typed values stay) */
  if(el.id==='naCat'){ const b = el.value===BLOW; if($('naBlow')) $('naBlow').hidden = !b; if($('naSizeWrap')) $('naSizeWrap').hidden = b; return; }
  if(el.id==='kcSeedFile') return chooseSeed(el);
  if('kcmode' in d) return setSwitch(el.value);
  if('approveall' in d) return setApproveAll(!!el.checked);
  if('floor' in d) return setFloor(el.value);
  /* a price: a blank entry is refused (never saved as no price, never as zero); an invalid entry snaps back; every real change goes through KCLive */
  if(d.plp) return editPrice(d.plp, el);
  /* a blower rating: blank = not entered */
  if(d.plr) return editRating(d.plk, d.plr, el);
  /* the markup for this quote (owner D3): blank = the standard markup; below x1 would sell below cost, so it is refused and the stored value stays */
  if('ovr' in d){
    if(!KC.can('editSettings')) return renderSettings();
    const raw = String(el.value).trim();
    if(raw === '') return setOverride(null);
    const n = Number(raw);
    if(!isFinite(n) || n < 1){ ovrMsg = 'The markup for this quote cannot be below × 1: that would sell below cost. Type 1 or more, or clear it.'; return renderSettings(); }
    return setOverride(Math.round(n * 1000) / 1000);
  }
  /* a pricing setting */
  if(d.set2) return editSetting(d.set2, el);
});
document.addEventListener('input',e=>{
  if(e.target.id==='kcPlSearch'){ S.plq = e.target.value; refreshRows(); }
  else if(e.target.id==='lpSearch'){ S.lpq = e.target.value; refreshLp(); }
});

async function editPrice(k, el){
  const v = KC.P[k];
  if(BUSY || !v || !plCanEdit()) return renderPrices();
  const n = numOrNull(el.value);
  if(n===null){ say('pl','err','A price cannot be left blank. Type the new price, or leave the old one.'); return renderPrices(); }
  if(badNum(n)){ say('pl','err','A price must be a number, zero or more.'); return renderPrices(); }
  const nv = Math.round(n*100)/100;
  if(nv===v.p){ say('pl','', ''); return renderPrices(); }
  BUSY = true; say('pl','ok','Saving…'); renderPrices();
  try{
    const res = await viaLive('saveMaterial', k, { p:nv, source:'Manual' });
    v.p = nv; v.source = 'Manual'; applyHist(v, res, { d:KC.today(), p:nv, by:who() });
    if(k==='cornerc' && KC.can('editSettings')) SET.corner = nv;                       // the President's save writes kc_config/settings.corner as well
    say('pl','ok','Saved the price of "'+v.l+'".');
    items();
  }catch(err){ console.error('KC admin: the price was not saved', err); say('pl','err','Not saved: '+errText(err)+'. The price is unchanged.'); }
  BUSY = false; renderPrices();
}
async function editRating(k, f, el){
  const v = KC.P[k];
  if(BUSY || !v || !plCanEdit() || !['hp','cfm','sp'].includes(f)) return renderPrices();
  const nv = numOrNull(el.value); if(badNum(nv)){ say('pl','err','A rating must be a number, zero or more.'); return renderPrices(); }
  if(nv===(v[f]==null ? null : v[f])) return renderPrices();
  const next = { hp:v.hp==null?null:v.hp, cfm:v.cfm==null?null:v.cfm, sp:v.sp==null?null:v.sp }; next[f] = nv;
  /* the history line says what the rating became: the same text the size cell shows, worked out with the new numbers in place for a moment */
  const old = { hp:v.hp, cfm:v.cfm, sp:v.sp }; v.hp = next.hp; v.cfm = next.cfm; v.sp = next.sp;
  const note = ratingText(k) || 'no rating entered'; v.hp = old.hp; v.cfm = old.cfm; v.sp = old.sp;
  BUSY = true; say('pl','ok','Saving…'); renderPrices();
  try{
    const res = await viaLive('saveMaterial', k, Object.assign({ ratingNote:note }, next));
    v.hp = next.hp; v.cfm = next.cfm; v.sp = next.sp; if(KC.PL_INFO[k]) KC.PL_INFO[k][2] = ratingText(k);
    if(res && Array.isArray(res.hist)) v.hist = res.hist.slice(-20);
    say('pl','ok','Saved the rating of "'+v.l+'".');
    items();
  }catch(err){ console.error('KC admin: the rating was not saved', err); say('pl','err','Not saved: '+errText(err)+'. The rating is unchanged.'); }
  BUSY = false; renderPrices();
}
async function editSetting(k, el){
  if(BUSY || !KC.can('editSettings') || !ready()) return renderSettings();
  const n = numOrNull(el.value);
  if(n===null || !isFinite(n) || n<0) return renderSettings();              // blank or invalid: back to the stored value
  if(k==='markup' && (n<1 || n>10)){ say('st','err','The markup must be from 1 to 10.'); return renderSettings(); }
  if(n===getS(k)) return renderSettings();
  BUSY = true; say('st','ok','Saving…'); renderSettings();
  try{
    if(k==='corner') await commitCorner(n);
    else{ await viaLive('saveSettings', patchOf(k, n)); setIn(SET, k, n); }
    say('st','ok','Saved.');
    items();
  }catch(err){ console.error('KC admin: the setting was not saved', err); say('st','err','Not saved: '+errText(err)+'. The setting is unchanged.'); }
  BUSY = false; renderSettings();
}
async function setFloor(mode){
  if(BUSY || !KC.can('editSettings') || !ready() || !['list','formula'].includes(mode) || mode===floorModeNow()) return renderSettings();
  BUSY = true; say('st','ok','Saving…'); renderSettings();
  try{
    await viaLive('saveSettings', { floorMode:mode });
    KC.FLOOR_MODE = mode; if('floorMode' in SET) SET.floorMode = mode;
    say('st','ok','Saved: the discount floor now uses '+(mode==='formula'?'cost × the markup':'the list price')+'.');
    items();
  }catch(err){ console.error('KC admin: the floor mode was not saved', err); say('st','err','Not saved: '+errText(err)+'. The floor mode is unchanged.'); }
  BUSY = false; renderSettings();
}
/* the markup for this quote: the pricing bridge's own setter when there is one (it reprices, stores and redraws), else the same value written here */
function setOverride(n){
  ovrMsg = '';
  const D7 = window.D7;
  try{
    if(D7 && D7.has && D7.has('pricing.setMarkupOvr')) D7.h('pricing.setMarkupOvr', n);
    else{ S.markupOvr = n; items(); }
  }catch(err){ console.error('KC admin: the markup for this quote was not applied', err); }
  renderSettings();
}
async function setSwitch(mode){
  if(BUSY || !KC.can('editSettings') || !['off','president','on'].includes(mode)) return renderSettings();
  BUSY = true; say('st','ok','Saving…'); renderSettings();
  try{
    await viaLive('saveSwitch', { kcMode:mode });
    SWITCH.kcMode = mode;
    const L = live(); if(L && L.flags && typeof L.flags==='object') L.flags.kcMode = mode;
    say('st','ok','Saved: new quotes start with the configurators for '+(mode==='off'?'nobody (the old quote builder)':mode==='president'?'the President only':'everyone')+'. Each person gets it the next time they open the quote builder.');
  }catch(err){ console.error('KC admin: the switch was not saved', err); say('st','err','Not saved: '+errText(err)+'. The switch is unchanged.'); }
  BUSY = false; renderSettings();
}
function chooseSeed(input){
  SEED = null; say('st','ok','');
  const file = input.files && input.files[0];
  if(!file){ return renderSettings(); }
  if(file.size > 4*1024*1024){ say('st','err','That file is too large to be a price file.'); return renderSettings(); }
  const rd = new FileReader();
  rd.onload = () => {
    let json = null; try{ json = JSON.parse(String(rd.result)); }catch(err){ json = null; }
    const counts = seedCounts(json);
    if(!counts){ say('st','err','That file is not a price file made for this tool (expected version 1 with materials, list prices and products).'); }
    else SEED = { name:file.name, json, counts };
    renderSettings();
  };
  rd.onerror = () => { say('st','err','The file could not be read.'); renderSettings(); };
  rd.readAsText(file);
}
async function runImport(){
  if(BUSY || !SEED || !KC.can('editSettings')) return renderSettings();
  const seed = SEED;
  BUSY = true; say('st','ok','Importing…'); renderSettings();
  try{
    const res = await viaLive('importSeed', seed.json);
    const L = live();
    if(L && !L.ready && typeof L.load==='function'){ try{ await L.load(); }catch(err){ console.warn('KC admin: the lists could not be re-read after the import', err); } }      // KCLive.importSeed re-reads them itself; this is for a build that does not
    const bits = [];
    if(res && typeof res==='object'){
      if(typeof res.historyAdded==='number') bits.push(`${res.historyAdded} price ${plural(res.historyAdded,'history entry','history entries')} added`);
      if(typeof res.written==='number') bits.push(`${res.written} ${plural(res.written,'document')} written`);
    }
    say('st','ok','Imported ' + seedLine(seed.counts) + (bits.length ? ' (' + bits.join(', ') + ')' : '') + '. Reload the quote builder to see the new catalogue items.');
    SEED = null; readListDoc(true);
    items();
  }catch(err){ console.error('KC admin: the import failed', err); say('st','err','Not imported: '+errText(err)+'. Nothing was changed that you can see; check that the rules for kc_config and kc_materials are deployed, then try again.'); }
  BUSY = false; renderSettings();
  if($('scrPrices') && !$('scrPrices').hidden) renderPrices();
}

Object.assign(KC, { renderPrices, renderSettings });
})();
