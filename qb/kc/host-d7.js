/* qb/kc/host-d7.js: the kc PANEL HOST inside the LIVE quote builder (specs/BK-LIVE-INTEGRATION-SPEC-2026-11-19.md sections 1.2, 2.2, 3.2, 5 packet C; the D7 prototype spec 3.1, 3.8, 4.1).   Ported from the D7 prototype's kc/host-d7.js.
   KC:C marks what is different in the live builder: Q64 (the below-markup threshold is KCRules.belowMarkupThreshold, list price first), Q67 (the list price of a material row of the custom item is shown to every role; line totals stay
   President only), the money arithmetic through KCRules, the Chef Mode grilling / bakery placeholder cards gone (Q68: they are catalogue items now), the price state of the cards ("Loading prices…" / "Prices could not be loaded…")
   and "Add to Quote" switched off until the prices have loaded (spec 2.2), the reviewer's real name.
   Derived from ../kc/screens-quote.js (the standalone prototype's host). KEPT: the configure panel (form, aside, footer, "Edit the wording", "Build detail & materials",
   the cost summary, the Custom part group, the press-and-focus handling, the event conventions, product.on() first), Use / Purpose helpers, the seven tabs and their cards, "Add custom
   item" (owner Q31 / D4), the markup override (D3), the below-markup warning, priceOf / check / descBlock, openKind / openCustom / openVentFor / closePanel.
   DROPPED: the items table, the print mock, the line store (S.lines as the store, insertLine, addLine, clearLines, ids, links), #roleSel and the shell's button rewiring. The quote builder's
   own table is the table; the line store is the builder's items[] (d7/d7-adapter.js is the bridge: KC.addLine, KC.clearLines, KC.lineById, KC.lineNo, KC.ensureIds live THERE).

   ROUND 4 (owner answers of 2026-11-19, synced from ../kc/screens-quote.js by the integration pass): Q52 (a material row's list price and line total: President only; ported by B), Q23 (a list-priced Chef Mode line,
   KC.price's result.list: the chip and the panel say "list price", the cost summary has a "List price adjustment" row, and the markup override keeps that adjustment: unit = round10(project cost x override + adjustment);
   the project cost, and so the discount floor and the lead time, stay the formula's), KC.costSumHtml(pr) and KC.shownWarnings(v) exported for the Checks.

   ELEMENTS (all written by chunk A into quote-builder.html): #catTabs (the tab row: All + seven tabs), #d7Cards (the cards of the active tab), #kcPanel with #kcPanelTitle, #kcPanelScroll,
   #kcPanelFoot and #kcBackdrop (the panel; [data-kc-close] closes it; body.kc-sheet-open locks the page behind the phone sheet). The panel's own ids (#kcMsgs, #kcName, #kcAside ...) keep their
   names: product-sink.js writes into #kcMsgs.  #d7Catalogue (the catalogue items of the tab) is drawn by d7-adapter.js, not here.

   THE RULE OF DIRECTION (spec 4.2): the panel never reads the builder's items[]; it calls D7.adapter.* (commit, edit, itemOf, setTab). The builder never reads KC.S; it calls D7.h(...).
   Everything below is guarded so a missing hook degrades (the panel still opens and prices; "Add" then says the bridge is missing).

   Event order: for click / input / change the host first handles its own elements (tabs, cards, wording, Build detail, Custom part), then offers the event to KC.products[S.kind].on(type, el, el.dataset)
   while the panel is open; a product that returns true has handled it (and re-rendered). Only then does the host apply the generic conventions: data-set + data-val, data-toggle, data-k (+ data-num),
   data-start, data-qty, data-add, data-review, data-txt, data-bracket. Every one of those is scoped to #kcPanel: the quote builder has its own buttons and inputs and none of them may reach this code.

   WHAT THE OTHER CHUNKS MAY CALL (all on KC):
     renderChips(force)          the tab row and the cards of the active tab (does nothing until D7.ready, and while D7 is off: Brilliance Steel / "as issued")
     setTab(id, focus)           all | prep | wash | cook | vent | cold | multi | mech   (delegates to D7.adapter.setTab, which also sets the builder's currentCatFilter)
     renderPanel() renderLive(o) renderItems() (= the builder's renderItems) renderPaper() (a no-op: "Preview document" is the builder's own)
     openKind(kind [, startId | {start, cfg, qty, note}])   opens a product's configurator; `cfg` is merged onto the start's cfg
     openLine({kind, cfg, start, qty, unit, note, reviewed, edit, ref})   opens the panel on an existing line (D7.adapter.edit calls it); edit = the items[] index, ref = the item itself
     openCustom([tabId])         the "Add custom item" panel (spec 3.8, M5)       closePanel()
     openVentFor(hoodLineOrId)   opens Ventilation linked to a hood line (spec 11.4 mechanics 1); false when product 'vent' is absent
     leadTime() leadTimeM()      leadWorkingDays(computeTrueCost().materials) / the materials total (the builder's engine: rule 3.7)
     descBlock(kind,c,note,{print})  linePrice(ln)  itemsTotal()  isEdited(c)  priceOf(kind,cfg,opts) (KC.price that also knows 'custom' and applies the markup override)
     check(kind,cfg)             the host's validation of a line: { errors, warnings, review } = the product's plus the custom-part rules
     markupOvr() effMarkup()     the override in force (a number, or null) / the markup used now (override, else KC.SET.markup)
     belowMarkup(ln)             the below-markup warning text of a line ({kind, cfg, priceOvr}; '' when none); costOf(ln) the project cost it compares with (null when unknown)
     cardFrom(kind)              the number a product's card shows after "from" (null = "price after review")
     customDef                   the "Add custom item" definition (form, validate, lineParts...), for the Checks screen
     relink(ventCfg, hoodCfg)    re-link a ventilation cfg to its hood (KC.ventRelink, or the documented rule)
   A quote line (the mirror KC.S.lines the adapter builds) is { id:kcId, kind, cfg, start, qty, unit, note, reviewed, priceOvr, flag }. A ventilation line is linked to its hood by cfg.hoodRef (the hood's kcId). */
(function(){
'use strict';
const KC = window.KC, S = KC.S, esc = KC.esc, peso = KC.peso, $ = KC.$, isPhone = KC.isPhone, toMM = KC.toMM, clone = KC.clone;
const plural = KC.plural;
const defOf = k => k==='custom' ? CUSTOM : KC.products[k];
const def = () => defOf(S.kind);
/* v17's pill, as the panel helper, with the missing-tip warning switched off (the purpose suggestions have no tips) */
const pill = (path,val,cur,label,o={}) => KC.pill(path,val,cur,label,Object.assign({notip:true},o));
const num = x => x===''||x==null ? null : Number(x);
const d7Ready = () => !!(window.D7 && D7.ready);
/* KC:C the one copy of the money maths is qb/kc-rules.js (window.KCRules); the prices are in only when KCLive.ready (spec 2.2) */
const R = () => window.KCRules;
const pricesReady = () => !!(window.KCLive && window.KCLive.ready);
/* KC:C who marks a line reviewed: the signed-in user's own name, else the cast name of the role */
const reviewerName = () => (window.KCLive && window.KCLive.userName) || (KC.ROLES[S.role] || KC.ROLES.sales || KC.ROLES.president).name;
/* KC:C the one line the cards show while the prices are not in (spec 2.2) */
const priceStateLine = () => {
  const L = window.KCLive, st = L && L.state;
  if(pricesReady()) return '';
  if(st==='loading') return '<div class="kc-pricestate" id="kcPriceState" role="status">Loading prices…</div>';
  return '<div class="kc-pricestate bad" id="kcPriceState" role="status">Prices could not be loaded. Configured lines keep their stored price.</div>';
};
const d7Live = () => !!(window.D7 && D7.ready && D7.on());          // D7 plumbing loaded, catalogue in, and this quote follows the new rules (not Brilliance Steel, not "as issued")
const adapter = () => (window.D7 && D7.adapter) || {};
/* a detached, inert copy of the text of an HTML string (no scripts, no image loads: DOMParser documents are inert) */
const htmlToText = h => { try{ return new DOMParser().parseFromString('<div>'+String(h||'').replace(/<br\s*\/?>/gi,'\n')+'</div>','text/html').body.textContent||''; }catch(err){ return String(h||'').replace(/<[^>]*>/g,''); } };
KC.htmlToText = htmlToText;

KC.css(`
.kc-tipline{text-transform:none;letter-spacing:0;font-weight:400;}   /* the tip under a KC.sel dropdown sits inside a <label>: it must not inherit the label's capitals */
.kc-tab:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;}
.kc-card-hd{display:flex;flex-direction:column;gap:2px;min-width:0;order:1;flex:0 0 auto;}
.kc-card > .cfg-mini{order:3;margin-top:auto;}
.kc-card > .kc-card-models,.kc-card > .kc-card-det{order:2;}
.kc-card-model:hover{border-color:var(--mid-blue);background:var(--light-blue);}
.kc-card-na{cursor:default;}
.kc-card-na .kc-card-from{font-style:italic;}
.kc-q-empty{grid-column:1/-1;text-align:center;color:var(--gray-dark);padding:18px 8px;font-size:13px;}
.kc-card-det{min-width:0;}
.kc-card-det > summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:flex-start;gap:6px;min-height:44px;padding:0 4px;font-size:12px;font-weight:700;color:var(--mid-blue);}
.kc-card-det > summary::-webkit-details-marker{display:none;}
.kc-card-det .kc-card-models{margin-top:4px;}
.kc-q-caret{display:inline-block;transition:transform .15s;}
.kc-card-det[open] > summary .kc-q-caret{transform:rotate(180deg);}
.kc-q-lead{font-size:10.5px;font-weight:800;color:var(--dark-blue);background:var(--light-blue);border-radius:10px;padding:2px 9px;margin-left:10px;text-transform:none;letter-spacing:0;white-space:nowrap;}
.kc-q-cust{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) 36px;gap:8px;align-items:end;margin-bottom:8px;padding-bottom:8px;border-bottom:1px dashed var(--gray-mid);}
.kc-q-cust.kc-q-nomoney{grid-template-columns:minmax(0,2fr) minmax(0,1fr) 36px;}
.kc-q-cust .kc-x{height:34px;}
.kc-q-rmtxt{display:none;}
.kc-card-note{grid-column:1/-1;}
.kc-card-note .kc-card-t{font-weight:700;font-size:12.5px;color:var(--gray-dark);}
.kc-group-h{grid-column:1/-1;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:var(--mid-blue);margin:6px 0 -2px;padding-bottom:3px;border-bottom:1px solid var(--light-blue);}
.kc-group-h:first-child{margin-top:0;}
/* Add custom item: one row per material from the price list (material, quantity, [price list and line total: President only], remove) */
.kc-q-mrow{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,1fr) 36px;gap:8px;align-items:end;margin-bottom:8px;padding-bottom:8px;border-bottom:1px dashed var(--gray-mid);}
.kc-q-mrow.kc-q-mcost{grid-template-columns:minmax(0,3fr) minmax(0,1fr) minmax(0,1.3fr) 36px;}
.kc-q-mrow .kc-x{height:34px;}
.kc-q-mrow select{min-width:0;}
.kc-q-unit{text-transform:none;font-weight:400;letter-spacing:0;}
.kc-q-mp{font-size:12px;line-height:1.35;font-variant-numeric:tabular-nums;align-self:center;}
.kc-q-mp small{display:block;color:var(--gray-dark);font-size:10.5px;}
/* the below-markup warning and the markup override chip under / beside a typed unit price (the builder's price cell uses them too: chunk C's priceNote) */
.kc-below{margin-top:3px;text-align:right;}
.kc-below .kc-below-chip{white-space:normal;display:inline-block;text-align:left;font-size:10.5px;padding:3px 9px;}
.kc-q-ovr{font-size:10.5px;font-weight:800;color:#8a5a00;background:#fff3d6;border:1px solid #f0cf95;border-radius:20px;padding:2px 9px;margin-left:10px;text-transform:none;letter-spacing:0;white-space:nowrap;}
.kc-q-nodraw{display:grid;place-items:center;min-height:64px;color:var(--gray-dark);font-size:11px;font-weight:700;background:var(--gray-light);border:1px dashed var(--gray-mid);border-radius:6px;text-align:center;padding:8px;}
.kc-addcustom textarea{min-height:84px;resize:vertical;}
@media(max-width:768px){
  .kc-card-hd{flex:1 1 0;}
  .kc-card > .cfg-mini{order:2;margin-top:0;}
  .kc-card > .kc-card-models,.kc-card > .kc-card-det{order:3;flex:1 1 100%;}
  .kc-q-cust,.kc-q-cust.kc-q-nomoney{grid-template-columns:1fr 1fr;}
  .kc-q-cust > .kc-opt:first-child{grid-column:1/-1;}
  .kc-q-cust .kc-x{height:44px;grid-column:1/-1;font-size:12px;font-weight:700;color:var(--red);}
  .kc-q-mrow,.kc-q-mrow.kc-q-mcost{grid-template-columns:1fr 1fr;}
  .kc-q-mrow > .kc-opt:first-child{grid-column:1/-1;}
  .kc-q-mrow .kc-x{height:44px;grid-column:1/-1;font-size:12px;font-weight:700;color:var(--red);}
  .kc-q-mrow select,#kcPanel [data-crow-add]{min-height:44px;}
  .kc-below{text-align:left;}
  .kc-q-ovr{margin-left:0;}
  .kc-q-rmtxt{display:inline;}
  .kc-q-cats .cfg-pill{flex:1 1 calc(50% - 6px);}
  body.d7-on #itemsSection .sec-title{flex-wrap:wrap;gap:6px 10px;}
  body.d7-on #addItemsSection .search-input{min-height:44px;}
  .kc-tabs{scrollbar-width:none;} .kc-tabs::-webkit-scrollbar{display:none;}
  /* the two host <summary> rows of the aside ("Edit the wording", "Build detail & materials") are 44px thumb targets (the wording row keeps its triangle, so it gets padding, not display:flex);
     the bay and bowl cards keep their 180px */
  #kcPanel details.kc-sub > summary{display:list-item;padding:15px 0;}
  #kcPanel details > summary.kc-group-sum{min-height:44px;}
  #kcPanel .cfg-slot.kc-slot,#kcPanel .cfg-slot.kc-sink-bowl{width:180px;}
}
`);

/* ═════════ Use and Purpose, rendered here for every product (spec section 11.2) ═════════
   A product calls these where its question order says (the station has Placement between them).
   KC.useGroup(c [, hint])  KC.purposeGroup(c, suggestions [, hint])  KC.usePurpose(c, suggestions) = both, one after the other. */
KC.useGroup = (c, hint) => { const T=KC.TIP||{};
  return KC.group('Use', `<div class="cfg-pills">${pill('use','commercial',c.use,'Commercial',{tip:T.commercial})}${pill('use','institutional',c.use,'Institutional',{tip:T.institutional})}${pill('use','residential',c.use,'Residential',{tip:T.residential})}</div>`, {hint: hint!=null ? hint : T[c.use]}); };
KC.purposeGroup = (c, list, hint) =>
  KC.group('Purpose', `<input type="text" data-k="purpose" list="kcPurposeList" value="${esc(c.purpose||'')}" placeholder="e.g. ${esc(list[0])}" aria-label="Purpose">
      <datalist id="kcPurposeList">${list.map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
      <div class="cfg-pills" style="margin-top:6px">${list.map(x=>pill('purpose',x,c.purpose,esc(x))).join('')}</div>`, {wide:true, hint: hint!=null ? hint : 'Prints in the title, e.g. "Multi-Purpose Kitchen Station - Milk Tea". Type anything.'});
KC.usePurpose = (c, list) => KC.useGroup(c) + KC.purposeGroup(c, list);

/* ═════════ the seven tabs and their cards (spec 3.1; the seventh is owner D1, 2026-11-19). The row in #catTabs adds "All" in front. ═════════ */
const TABS = [ {id:'prep',label:'Prep and storage'}, {id:'wash',label:'Washing'}, {id:'cook',label:'Cooking'},
               {id:'vent',label:'Ventilation'}, {id:'cold',label:'Refrigeration'}, {id:'multi',label:'Multi-purpose'},
               {id:'mech',label:'Mechanical Systems'} ];
const TAB_IDS = TABS.map(t=>t.id);
const ALL_TABS = [{id:'all',label:'All'}].concat(TABS), ALL_IDS = ALL_TABS.map(t=>t.id);
KC.TABS = TABS;
KC.TAB_PLACEHOLDERS = { cold:['Chiller','Ice container','Ice bin'] };                  // KC:C owner Q68: the grilling and bakery items are catalogue products now, so their "Not specified yet" cards are gone
/* a tab with no configurator yet can show one explanatory card (owner D1): Mechanical Systems holds the gas line and fire suppression catalogue items of the quote builder;
   anything else goes through "Add custom item" */
KC.TAB_NOTES = { mech:{ title:'Gas line and fire suppression: pick from the catalogue below', line:'For anything else, use ➕ Add custom item.' } };
const catLabel = id => (TABS.find(t=>t.id===id)||TABS[0]).label;
if(!ALL_IDS.includes(S.tab)) S.tab='all';                      // the page opens on All, like the builder's own filter (currentCatFilter)

/* A product's `category` is its tab id. Until every product file says so, also accept the tab's label and the old C0 string 'Tables & stations' (the station goes to Multi-purpose, the prep
   table to Prep and storage); anything else is shown under Prep and storage with a console warning, so no product can become unreachable. */
const warnedCat = {};
function tabOf(D){
  const c=String(D.category||'').trim(), low=c.toLowerCase();
  if(TAB_IDS.includes(c)) return c;
  const byLabel=TABS.find(t=>t.label.toLowerCase()===low); if(byLabel) return byLabel.id;
  const legacy={ 'tables & stations': D.id==='station'?'multi':'prep', washing:'wash', ventilation:'vent', cooking:'cook', refrigeration:'cold' }[low];
  if(legacy) return legacy;
  if(!warnedCat[D.id]){ warnedCat[D.id]=1; console.warn('KC host: product "'+D.id+'" has category "'+c+'", which is not a tab id (prep, wash, cook, vent, cold, multi, mech). Showing it under Prep and storage.'); }
  return 'prep';
}
KC.tabOf = tabOf;

/* "from PHP x": what a product's card says it starts at.  Addendum 1 A1 rule 5 (D4): the LIST price of the smallest standard model of the product (KC.startsAt: the cheapest of its standard models that the Standard Price List prices),
   so a card never shows a price that already includes default options.  A product with no standard model on the list (the kitchen station, ventilation, a list that is not loaded) falls back to the lowest unit price among
   its starts (a start that is not fully priced is left out; the Sink's card used to read its default package, see cardStart).  Start prices are cached per price list + settings. */
const listSig = () => { const m=KC.LISTP; return m && typeof m==='object' ? Object.keys(m).map(k => { const r=KC.listRow(k); return k+':'+(r ? r.price+'/'+(r.perMetre||'') : ''); }).join(',') : ''; };
const sigOf = () => JSON.stringify(KC.SET) + '|' + Object.keys(KC.P).map(k=>KC.P[k].p).join(',') + '|' + listSig();
let pcache = {sig:'', v:{}};
function startPrice(D, id){
  const sig=sigOf(); if(pcache.sig!==sig) pcache={sig, v:{}};
  const key=D.id+'|'+id; if(key in pcache.v) return pcache.v[key];
  let p=null; try{ const pr=KC.price(D.id, D.startCfg(id), {skipHood:true}); p = pr.priced ? pr.unit : null; }
  catch(err){ console.error('KC host: could not price the start', D.id, id, err); }
  return pcache.v[key]=p;
}
function fromOf(D){
  const sa = KC.startsAt ? KC.startsAt(D.id) : null; if(sa && typeof sa.price==='number' && sa.price>0) return sa.price;      // the list price of the smallest standard model (A1 rule 5)
  if(D.cardStart){ const p=startPrice(D, D.cardStart); if(p!=null) return p; }       // no list price for this product: owner Q37 (the Sink): the card shows ONE named start's price (its default package), not the cheapest
  const ids = (D.starts && D.starts.length) ? D.starts.map(s=>s.id) : [undefined];
  const ps = ids.map(id=>startPrice(D,id)).filter(p=>p!=null);
  return ps.length ? Math.min(...ps) : null;
}

function cardHtml(D){
  const on = S.open && S.kind===D.id, from = fromOf(D);
  let models='';
  if(D.showModels && D.starts && D.starts.length){
    const rows = D.starts.map(st=>{ const p=startPrice(D,st.id);
      return `<button type="button" class="kc-card-model" data-kind="${esc(D.id)}" data-model="${esc(st.id)}" title="${esc(st.line||st.label)}"><span>${esc(st.label)}</span><b>${p!=null?peso(p):'after review'}</b></button>`; }).join('');
    models = isPhone()
      ? `<details class="kc-card-det" data-id="${esc(D.id)}"${S.ui['models:'+D.id]?' open':''}><summary>${D.starts.length} ${plural(D.starts.length,'model')} <span class="kc-q-caret">▾</span></summary><div class="kc-card-models">${rows}</div></details>`
      : `<div class="kc-card-models">${rows}</div>`;
  }
  return `<div class="kc-card${on?' kc-on':''}" title="${esc(D.title)}" data-card="${esc(D.id)}"><div class="kc-card-hd"><div class="kc-card-t">${esc(D.chip)}</div><div class="kc-card-from">${from!=null?'from '+peso(from):'price after review'}</div></div>`
    + `<button type="button" class="cfg-mini" data-kind="${esc(D.id)}" title="Configure ${esc(D.title)}">⚙ Configure</button>${models}</div>`;
}
function cardSafe(D){ try{ return cardHtml(D); }catch(err){ console.error('KC host: the card of', D.id, 'failed', err); return `<div class="kc-card kc-card-na"><div class="kc-card-hd"><div class="kc-card-t">${esc(D.chip||D.id)}</div><div class="kc-card-from">Card failed: see the console</div></div></div>`; } }

/* how many catalogue items the builder has in a tab (the tab's count shows cards + items) */
function catalogueOf(tabId){
  let list=[]; try{ list = (typeof DB!=='undefined' && DB && DB.products) ? DB.products : []; }catch(err){ list=[]; }
  return list.filter(p => D7.tabOfProduct(p)===tabId);
}
const cardsOfTab = (by, id) => by[id].map(cardSafe).join('')
    + (KC.TAB_PLACEHOLDERS[id]||[]).map(n=>`<div class="kc-card kc-card-na" aria-disabled="true"><div class="kc-card-hd"><div class="kc-card-t">${esc(n)}</div><div class="kc-card-from">Not specified yet</div></div></div>`).join('')
    + ((KC.TAB_NOTES||{})[id] ? (n=>`<div class="kc-card kc-card-na kc-card-note" aria-disabled="true"><div class="kc-card-hd"><div class="kc-card-t">${esc(n.title)}</div><div class="kc-card-from">${esc(n.line)}</div></div></div>`)(KC.TAB_NOTES[id]) : '');

let chipsKey='', lastTab=null;
function centerTab(row){
  const b=row && row.querySelector('[aria-selected="true"]'); if(!b) return;
  row.scrollLeft += (b.getBoundingClientRect().left-row.getBoundingClientRect().left) - (row.clientWidth-b.offsetWidth)/2;
}
/* The tab row (into #catTabs) and the cards of the active tab (into #d7Cards). Skips the DOM work when nothing the cards show has changed (so a pill click in the panel does not
   reset the tab row's scroll). `force` always re-renders. Nothing is drawn until the builder's catalogue is in (D7.ready) and while D7 is off. */
function renderChips(force){
  if(!d7Live()) return;
  const row=$('catTabs'), host=$('d7Cards'); if(!row || !host) return;
  const list=KC.productList();
  if(!ALL_IDS.includes(S.tab)) S.tab='all';
  let dbn=0; try{ dbn=(typeof DB!=='undefined' && DB && DB.products) ? DB.products.length : 0; }catch(err){ dbn=0; }
  const key=[S.tab, S.open?S.kind:'', isPhone()?'p':'d', dbn, list.map(D=>D.id+':'+tabOf(D)).join(','), sigOf(), pricesReady() ? 'r' : String(window.KCLive && window.KCLive.state)].join('|');
  if(!force && key===chipsKey && host.firstChild && row.firstChild) return;
  chipsKey=key;
  const by={}; TAB_IDS.forEach(t=>by[t]=[]); list.forEach(D=>by[tabOf(D)].push(D));
  const prev=row.querySelector('.kc-tabs'), prevLeft=prev?prev.scrollLeft:0;
  const tabs=ALL_TABS.map(t=>{
    const nCards = t.id==='all' ? 0 : by[t.id].length, nItems = t.id==='all' ? 0 : catalogueOf(t.id).length, n = nCards + nItems;
    const badge = t.id==='all' ? '' : `<span class="kc-count" title="${nCards} ${nCards===1?'configurator':'configurators'}, ${nItems} catalogue ${nItems===1?'item':'items'}">${n}</span>`;
    return `<button type="button" class="kc-tab" role="tab" id="kcTab-${t.id}" data-kctab="${t.id}" aria-selected="${S.tab===t.id}" aria-controls="d7Cards" tabindex="${S.tab===t.id?0:-1}">${esc(t.label)}${badge}</button>`; }).join('');
  row.innerHTML=`<div class="kc-tabs" role="tablist" aria-label="Product categories">${tabs}</div>`;
  let cards;
  if(S.tab==='all') cards = TABS.map(t=>{ const c=cardsOfTab(by,t.id); return c ? `<div class="kc-group-h">${esc(t.label)}</div>${c}` : ''; }).join('');
  else cards = cardsOfTab(by,S.tab);
  if(!cards) cards='<div class="kc-q-empty">Nothing here yet.</div>';
  host.setAttribute('role','tabpanel'); host.setAttribute('aria-labelledby','kcTab-'+S.tab);
  host.innerHTML=`<div class="kc-cards" id="kcCards">${priceStateLine()}${cards}</div>`;
  const tabsEl=row.querySelector('.kc-tabs');
  if(lastTab!==S.tab){ centerTab(tabsEl); lastTab=S.tab; } else tabsEl.scrollLeft=prevLeft;
}
function setTab(id, focus){
  if(!ALL_IDS.includes(id)) return;
  if(adapter().setTab) adapter().setTab(id, focus);        // the bridge sets KC.S.tab AND the builder's currentCatFilter, then redraws the row, the cards and the catalogue list
  else { S.tab=id; renderChips(true); if(focus){ const b=$('kcTab-'+id); if(b) b.focus({preventScroll:true}); } }
}

/* ───────── ventilation re-link (spec 10.3, 11.4): KC.ventRelink(ventCfg, hoodCfg) from product-duct.js; the documented formula if it is absent ───────── */
function relink(vcfg, hcfg){
  try{
    if(KC.ventRelink){ const r=KC.ventRelink(vcfg,hcfg); if(r && typeof r==='object' && r!==vcfg && 'hoodLen' in r) Object.assign(vcfg,r); return; }
    if(KC.hoodSize){ const s=KC.hoodSize(hcfg); vcfg.hoodLen=s.len; vcfg.air=hcfg.air; vcfg.filters=hcfg.filters; }
  }catch(err){ console.error('KC host: re-linking the ventilation to its hood failed', err); }
}
const ventScope = h => h.blower&&h.ducting ? 'full' : h.blower ? 'blower' : h.ducting ? 'duct' : 'full';

/* ═════════ the markup override (owner D3, 2026-11-19): one per quote, President only; the Pricing settings screen and the calculator write KC.S.markupOvr ═════════ */
if(S.markupOvr===undefined) S.markupOvr=null;
const markupOvr = () => { const v=S.markupOvr; return typeof v==='number' && isFinite(v) && v>=1 ? v : null; };      // a factor of 1 or more, or null = the standard
const effMarkup = () => { const o=markupOvr(); return o!=null ? o : KC.SET.markup; };
/* a priced result (made at the standard markup) priced again with the override: the project cost does not change, only the factor and the 10-peso rounding.
   KC.price and KC.sell stay as they were, so the cards, the start pills and every product's own Checks keep the standard markup.
   A list-priced line (owner R4 Q23, result.list: Chef Mode) keeps its list price adjustment: unit = round10(project cost x override + adjustment), so the override moves the formula part
   of the price and the list's own offset stays. (D7 round 4: ported from ../kc/screens-quote.js.) */
function withOvr(r){
  const o=markupOvr(); if(o==null || !r || !r.priced) return r;
  const selling=r.projectCost*o, adj=r.list ? r.list.adj : 0;
  return Object.assign({}, r, { selling, unit:R().sellUnit({ projectCost:r.projectCost, markup:o, listAdj:adj }), markupOvr:o });      // KC:C one copy of the rounding: KCRules.sellUnit
}

/* the "markup override" chip of the configurator footer: on a cost-based price made with the override (a role that may see costs also reads the factor) */
const ovrChip = pr => pr && pr.markupOvr ? `<span class="kc-q-ovr" title="Priced with the quote\u2019s markup override instead of the standard markup">markup override${KC.can("costs")?" ×"+pr.markupOvr:""}</span>` : "";

/* ═════════ "Add custom item": host code, not a registered product (spec 3.8 M5; owner Q31 and D4) ═════════
   cfg = { cat, name, desc, dims, rows:[{k,q}], m, lab }.  rows = materials picked from the price list (any role that can build; the price is the list's and cannot be
   changed here); m and lab = the typed costs, President only (KC.can('customCosts')).  Materials M = the rows + m.  Priced when M > 0 and labor is typed (R1);
   until then "Priced after review". Always in review. */
function customParts(c){
  const lines=[], miss=[]; let M=0;
  (Array.isArray(c.rows) ? c.rows : []).forEach((r,i)=>{ const pl=r && KC.P[r.k]; if(!pl) return; const q=Math.max(0,+r.q||0);
    if(pl.p==null){ if(q>0) miss.push(`the price of "${pl.l}" (missing from the materials price list)`); return; }       // no price is never 0 pesos
    const t=q*pl.p; M+=t; lines.push({ key:'cr'+i, part:'Materials', k:r.k, l:pl.l, u:pl.u, q, p:pl.p, t }); });
  const typed = +c.m>0 ? +c.m : 0, lab = c.lab!=null && c.lab!=='' && +c.lab>=0 ? +c.lab : null;
  return { M:M+typed, rowsM:M, typed, lab, lines, miss:[...new Set(miss)] };
}
function customPrice(c){
  const p=customParts(c), none={ priced:false, lines:p.lines, groups:[], projectCost:0, selling:0, unit:0, M:p.M };
  if(p.miss.length) return Object.assign(none, { missing:p.miss });
  if(!(p.M>0)) return Object.assign(none, { missing:['the custom item’s cost'] });
  if(p.lab==null) return Object.assign(none, { missing:['the custom item’s labor'] });
  const r=KC.sell([{id:'custom',label:'Custom item',M:p.M,labor:p.lab}]);
  return { priced:true, missing:[], lines:p.lines, groups:r.groups, projectCost:r.projectCost, selling:r.selling, unit:r.unit, M:p.M };
}
/* the project cost a custom item's typed unit price is held against (owner Q31). With no labor typed yet (a list built by Sales) the Complex bracket stands in for
   the labor, so the warning still works; null while the cost is unknown (no materials, or a material with no price). */
function customCostEst(c){
  const p=customParts(c); if(p.miss.length || !(p.M>0)) return null;
  return KC.sell([{ id:'custom', M:p.M, labor: p.lab!=null ? p.lab : p.M*KC.SET.br.complex/100 }]).projectCost;
}
/* spec 3.4: a custom item prints as "STAINLESS STEEL 304 | COMMERCIAL" unless its description names another material. A small, honest detector: a stainless grade ("stainless steel 316", "SS316"),
   or one of a few other materials a custom item is likely to name. Anything else is the standard material. */
const CUSTOM_MATERIALS = [
  [/\bstainless\s*steel\s*(\d{3})\b/i, m => 'STAINLESS STEEL '+m[1]], [/\bSS\s*-?\s*(\d{3})\b/, m => 'STAINLESS STEEL '+m[1]],
  [/\bgalvani[sz]ed\s+iron\b/i, () => 'GALVANIZED IRON'], [/\bGI\s*\d*(?:\.\d+)?\s*mm\b/i, m => m[0].toUpperCase().replace(/\s+/g,' ')],
  [/\bmild\s+steel\b/i, () => 'MILD STEEL'], [/\bblack\s+iron\b/i, () => 'BLACK IRON'], [/\bcarbon\s+steel\b/i, () => 'CARBON STEEL'],
  [/\balumin(?:i)?um\b/i, () => 'ALUMINUM'], [/\bbrass\b/i, () => 'BRASS'], [/\bcopper\b/i, () => 'COPPER'],
  [/\bplywood\b/i, () => 'PLYWOOD'], [/\bacrylic\b/i, () => 'ACRYLIC'], [/\btempered\s+glass\b/i, () => 'TEMPERED GLASS']
];
function customMaterial(c){
  const T=c.txt||{}; if(T.material) return T.material;
  const text=String(c.desc||'')+' '+String(c.name||'');
  for(const [re,fn] of CUSTOM_MATERIALS){ const m=re.exec(text); if(m) return fn(m); }
  return 'STAINLESS STEEL 304';
}
/* a material dropdown over the whole price list, grouped by category */
function matOptions(cur){
  const by={}; Object.keys(KC.P).forEach(k=>{ const cat=(KC.PL_INFO[k]||[])[0], g=KC.PL_CATS.includes(cat) ? cat : 'Other'; (by[g]=by[g]||[]).push(k); });
  return `<option value=""${cur?'':' selected'}>Pick a material…</option>`
    + KC.PL_CATS.concat('Other').filter(g=>by[g]).map(g=>`<optgroup label="${esc(g)}">${by[g].map(k=>`<option value="${esc(k)}"${k===cur?' selected':''}>${esc(KC.P[k].l)}</option>`).join('')}</optgroup>`).join('');
}
/* one material row. OWNER Q67 (Round 5, reverses Q52): the LIST PRICE of a material is shown to every role that builds the item: it is the materials price list, which Sales and Operations can read anyway. The ROW'S LINE
   TOTAL (and the list total below) are costs, shown ONLY to a role that may see costs (the President, KC.can('costs')). The price cannot be typed over by anyone. A picked material that has no price on the list says
   "no price" to every role (words, no peso): that is why the line stays "Priced after review". */
function crowHtml(r,i,tot){
  const pl=KC.P[r.k], q=r.q==null ? '' : r.q;
  const price = pl && pl.p==null ? '<b style="color:var(--red)">no price</b>'
    : pl ? `<span class="kc-sm">Price list</span> <b>${peso(pl.p)}</b> / ${esc(pl.u)}${tot?`<small>Line <span data-crow-t="${i}">${peso((+r.q||0)*pl.p)}</span></small>`:''}`
    : (tot ? '<span class="kc-sm">Pick a material</span>' : '');
  const cell = price ? `\n      <div class="kc-q-mp">${price}</div>` : '';
  return `<div class="kc-q-mrow${cell?' kc-q-mcost':''}">
      <label class="kc-opt">Material<select data-k="rows.${i}.k" aria-label="Material ${i+1}">${matOptions(r.k)}</select></label>
      <label class="kc-opt">Quantity${pl?` <span class="kc-q-unit">(${esc(pl.u)})</span>`:''}<input type="number" min="0" step="any" data-k="rows.${i}.q" data-num value="${q}" aria-label="Quantity of material ${i+1}"></label>${cell}
      <button type="button" class="kc-x" data-crow-rm="${i}" aria-label="Remove this material" title="Remove">✕<span class="kc-q-rmtxt"> Remove this material</span></button></div>`;
}
const CUSTOM = {
  id:'custom', chip:'Custom item', title:'Custom item', code:'', custom:true,
  startCfg:() => ({ cat:TAB_IDS.includes(S.tab) ? S.tab : 'prep', name:'', desc:'', dims:'', rows:[], m:null, lab:null }),
  bracket:() => 'medium',
  form(c){
    const money=KC.can('customCosts'), tot=KC.can('costs'), rows=Array.isArray(c.rows) ? c.rows : [];
    return KC.group('Category', `<div class="cfg-pills kc-q-cats">${TABS.map(t=>KC.pill('cat',t.id,c.cat,esc(t.label),{tip:'Files this item under '+t.label+'.'})).join('')}</div>`,
        {wide:true, hint:'Where the item belongs on the quote: it goes in the '+esc(catLabel(c.cat))+' section.'})
      + KC.group('Item', `<div class="kc-addcustom">
          <label class="kc-opt" style="grid-column:1/-1">Name<input type="text" data-k="name" value="${esc(c.name||'')}" placeholder="e.g. Hot-plate cart"></label>
          <label class="kc-opt" style="grid-column:1/-1">Description (prints as the Specs)<textarea rows="4" data-k="desc" placeholder="What is it made of, and what does it do?">${esc(c.desc||'')}</textarea></label>
          <label class="kc-opt" style="grid-column:1/-1">Dimensions (printed as typed)<input type="text" data-k="dims" value="${esc(c.dims||'')}" placeholder="e.g. 1200mmL x 600mmW x 850mmH"></label>
        </div>`, {wide:true})
      + KC.group('Materials from the price list', `${rows.map((r,i)=>crowHtml(r||{k:'',q:1},i,tot)).join('')}
          <div class="cfg-slot-ctl"><button type="button" class="cfg-mini" data-crow-add>+ Add a material</button>${tot&&rows.length?`<span class="kc-sm" style="margin-left:10px">Materials from the list: <b id="kcCrowTot">${peso(customParts(c).rowsM)}</b></span>`:''}</div>`,
        {wide:true, hint:'Pick each material from the materials price list and type how many. The price of each material comes from the list and cannot be changed here.'+(tot?'':' Only Neil sees the line totals and the costs.')})
      + KC.group('Typed costs', money
          ? `<div class="kc-addcustom"><label class="kc-opt">Other materials ₱ <span style="text-transform:none;font-weight:400">(not on the price list)</span><input type="number" min="0" step="0.01" data-k="m" data-num value="${c.m==null?'':c.m}"></label><label class="kc-opt">Labor ₱<input type="number" min="0" step="0.01" data-k="lab" data-num value="${c.lab==null?'':c.lab}"></label></div>`
          : '<div class="kc-sm">Neil types the labor and any cost that is not on the price list.</div>',
        {wide:true, hint: money ? 'Price = (materials + labor) × (1 + misc %) × markup, rounded to 10 pesos. Materials are the rows above plus any typed amount. The line always needs review.'
                                : 'The line always needs review. You can also type its unit price in the items table: it warns when it is below cost × the standard markup.'});
  },
  /* the host calls this at the end of every refresh (also while typing a quantity): the line totals and the list total follow */
  live(c){
    (Array.isArray(c.rows) ? c.rows : []).forEach((r,i)=>{ const el=document.querySelector(`[data-crow-t="${i}"]`), pl=r && KC.P[r.k]; if(el) el.textContent = pl && pl.p!=null ? peso((+r.q||0)*pl.p) : '—'; });
    const t=$('kcCrowTot'); if(t) t.textContent=peso(customParts(c).rowsM);
  },
  validate(c){
    const errors=[], rows=Array.isArray(c.rows) ? c.rows : [];
    if(!String(c.name||'').trim()) errors.push('Give the custom item a name.');
    if(rows.some(r=>!r || !KC.P[r.k])) errors.push('Pick a material for each row, or remove the empty row.');
    if(rows.some(r=>r && KC.P[r.k] && !(+r.q>0))) errors.push('Give each material a quantity above 0.');
    return { errors, warnings:[], review:['custom item'] }; },       // the size is a Verify & File block (sizeBlockReason), not a block on Add
  quantities:() => [], describe:() => [],
  /* the standalone prototype's wording ("CUSTOM ITEM | COOKING"); the Checks of the standalone prototype read it */
  lineParts(c){ const T=c.txt||{}; return { material:T.material||'CUSTOM ITEM', use:catLabel(c.cat).toUpperCase(), title:T.title||String(c.name||'').trim(), sub:T.sub||'', dims:T.dims||String(c.dims||'').trim(), specs:[] }; },
  /* what a custom item PRINTS in the quote builder (spec 3.4): STAINLESS STEEL 304 (or the material the description names) | COMMERCIAL (or the item's use), the name, the dimensions, the description
     as the Specs. The panel's preview, item.doc and the print block all read this one, so what Sales sees is what prints. */
  printParts(c){ const T=c.txt||{}; return { material:T.material||customMaterial(c), use:String(c.use||'commercial').toUpperCase(), title:T.title||String(c.name||'').trim(), sub:T.sub||'', dims:T.dims||String(c.dims||'').trim(), specs:[] }; },
  shortSpecs:c => esc(String(c.desc||'').trim()).replace(/\n/g,'<br>'),
  incl:() => ({i:[],x:[]}), svg:() => ''
};
/* the parts a line PRINTS: the product's lineParts, or (the custom item) the D7 print rule of spec 3.4 */
const printParts = (D,c) => D.printParts ? D.printParts(c) : D.lineParts(c);
const priceOf = (kind,c,opts) => withOvr(kind==='custom' ? customPrice(c) : KC.price(kind,c,opts));
function safePrice(ln){ try{ return priceOf(ln.kind,ln.cfg); }catch(err){ return null; } }

/* ═════════ below cost × markup (owner Q31): a typed unit price under the cheapest price the formula would give warns ═════════
   costOf(ln) = the line's project cost (null when unknown); the floor = cost × the markup in force (the override, else the standard), rounded to 10 pesos like a price.
   Only a role that may see costs sees the figure; Sales and the others read the sentence without it. */
function costOf(ln){
  if(ln.kind==='custom') return customCostEst(ln.cfg);
  const pr=safePrice(ln); return pr && pr.priced ? pr.projectCost : null;
}
/* KC:C Q64: while the office setting KC.FLOOR_MODE is 'list' (the default) the threshold of a LIST-PRICED line (Chef Mode) is its list-based price (KCRules.sellUnit at the standard markup + the list adjustment); every other
   line is held against cost x the markup in force (KCRules.belowMarkupThreshold / belowMarkup).  The list price is the catalogue's own number, so every role reads it; the cost-based amount only the President. */
function belowMarkup(ln){
  if(!ln || ln.priceOvr==null) return '';
  const cost=costOf(ln); if(cost==null) return '';
  const pr=safePrice(ln), listed=!!(pr && pr.priced && pr.list && KC.FLOOR_MODE!=='formula');
  const listPrice = listed ? R().sellUnit({ projectCost:pr.projectCost, markup:KC.SET.markup, listAdj:pr.list.adj }) : null;
  const floor=R().belowMarkupThreshold({ floorMode: listed ? 'list' : 'formula', listPrice, projectCost:cost, stdMarkup:effMarkup() });
  if(!R().belowMarkup(ln.priceOvr, floor)) return '';
  if(listed) return 'Below the list price ('+peso(floor)+').';
  return 'Below cost × '+(markupOvr()!=null?'markup override':'standard markup')+(KC.can('costs')?' ('+peso(floor)+')':'')+'.';
}

/* KC:C Addendum 1 A1 item 7 (the formula price more than 10 % under the list-based price) is the engine's own check: its warning says "Staff only", so shownWarnings() below shows it to the President only, and only
   while KC.FLOOR_MODE is 'formula'.  The line-level note under a unit price is D7.pricing.formulaLow (qb/d7/d7-pricing.js). */

/* ═════════ Custom part (spec 11.6): a group at the end of every form ═════════ */
function customPartGroup(c){
  const money=KC.can('customCosts');
  const rows=(c.custom||[]).map((x,i)=>`<div class="kc-q-cust${money?'':' kc-q-nomoney'}">
      <label class="kc-opt">What is it?<input type="text" data-cust="${i}" data-cf="text" value="${esc((x&&x.text)||'')}" placeholder="e.g. extra shelf, special bracket"></label>
      ${money ? `<label class="kc-opt">Materials ₱<input type="number" min="0" step="0.01" data-cust="${i}" data-cf="m" value="${x.m==null?'':x.m}"></label><label class="kc-opt">Labor ₱<input type="number" min="0" step="0.01" data-cust="${i}" data-cf="lab" value="${x.lab==null?'':x.lab}"></label>` : '<span class="kc-sm">Neil prices it.</span>'}
      <button type="button" class="kc-x" data-rmcust="${i}" aria-label="Remove this custom part" title="Remove">✕<span class="kc-q-rmtxt"> Remove this part</span></button></div>`).join('');
  return KC.group('Custom part', rows + `<div class="cfg-slot-ctl"><button type="button" class="cfg-mini" data-addcust>+ Add a custom part</button></div>`,
    {wide:true, hint:'Something the options above cannot build. It is priced on its own and the line needs review.'});
}
/* the host's own checks, added to the product's: every custom part needs a text, and any custom part puts the line in review */
function check(kind,c){
  const D=defOf(kind), v=D.validate(c), errors=v.errors.slice(), warnings=v.warnings.slice(), review=v.review.slice();
  if(!D.custom && Array.isArray(c.custom) && c.custom.length){
    if(c.custom.some(x=>!String((x&&x.text)||'').trim())) errors.push('Describe the custom part so the reviewer knows what to price.');
    if(!review.includes('custom part')) review.push('custom part'); }
  return { errors:[...new Set(errors)], warnings, review:[...new Set(review)] };
}
const customText = c => (c.custom||[]).map(x=>String((x&&x.text)||'').trim().replace(/[.\s]+$/,'')).filter(Boolean).map(t=>'Custom: '+t+'.').join(' ');
/* the automatic Specs paragraph (HTML): the product's, then "Custom: <text>." for each custom part */
function autoSpecs(kind,c){ const D=defOf(kind); let s=D.shortSpecs(c); const cu=D.custom?'':customText(c); if(cu) s+=(s?' ':'')+esc(cu); return s; }

/* ═════════ the panel ═════════ */
function startGroup(D){
  if(!D.starts || !D.starts.length) return '';
  return KC.group('Start from', `<div class="cfg-pills">${D.starts.map(st=>{
      let from=''; if(st.id!=='blank'){ const cc=D.startCfg(st.id), pr=KC.price(S.kind,cc,{skipHood:true});
        from = pr.priced ? ` · from ${peso(pr.unit)}${typeof st.fromNote==='function'?st.fromNote(cc):(st.fromNote||'')}` : ' · priced after review'; }
      return `<button type="button" class="cfg-pill kc-start" data-start="${esc(st.id)}" aria-pressed="${S.start===st.id}"${st.tip?` title="${esc(st.tip)}"`:''}>${esc(st.label)}<small>${esc(st.line)}${from}</small></button>`; }).join('')}</div>`,
    {wide:true, hint:'Pick the closest one, then change only what the client asks for. Picking another start resets the options below.'});
}
const addLabel = () => S.edit!=null ? '✓ Update line'
  : (S.kind==='hood' && S.cfg && (S.cfg.blower||S.cfg.ducting) && KC.products.vent) ? '➕ Add, then ventilation' : '➕ Add to Quote';

/* the phone sheet locks the page's scroll only while it is open AND the quote builder is the screen being shown (the price list, settings and Checks screens never lock) */
const sheetLocked = () => S.open && isPhone() && (!S.screen2 || S.screen2==='builder') && !document.body.dataset.d7Screen;

let panelSession=0, lastSession=-1;      // a new session (another product, another line) starts the sheet at the top; a re-render keeps the scroll
/* A press in progress (C9). Leaving a text or number box fires its `change` between the press (mousedown) and the click, and that change
   re-renders the form. The pill under the pointer is then a new element, the browser drops the click, and the first tap after typing was lost
   (every product). So while a mouse button / finger is down a re-render is only REQUESTED; it runs once the press is over (the click
   itself usually re-renders, which also settles the request). Touch taps arrive as mousedown / mouseup / click too, so this covers phones.
   The price list and settings screens (kc/admin-d7.js) re-render the same way on `change`, so they ask through KC.holdWhilePressed(fn). */
let pressing=false, pressAt=0, pendingPanel=false;          // a press older than 1.5 s (a lost mouseup, a long press) no longer defers anything
const isPressed = () => pressing && Date.now()-pressAt<1500;
const heldRenders = new Set();                              // other screens' renders, waiting for the press to end
/* A re-render replaces the form, so the box being typed in (or tapped next) would lose the keyboard focus. captureFocus(root) notes which input,
   select or textarea has it and where the caret is; restoreFocus(root, cap) puts the focus back on the same box in the new DOM (found by its
   data-* identity). Used by renderPanel here and by the price list and settings screens. */
const FOCUS_KEYS=['data-k','data-txt','data-cust','data-cf','data-mk','data-mq','data-xk','data-xq','data-hs','data-gaps','data-bracket','data-plp','data-plk','data-plr','data-set2','id'];
function captureFocus(root){
  const el=document.activeElement;
  if(!el || !root || !root.contains(el) || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return null;
  const q=v=>window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g,'\\$&');
  const sel=el.tagName.toLowerCase()+FOCUS_KEYS.filter(k=>el.hasAttribute(k)).map(k=>`[${k}="${q(el.getAttribute(k))}"]`).join('');
  let a=null,z=null; try{ a=el.selectionStart; z=el.selectionEnd; }catch(err){ /* a number box has no caret */ }
  return { sel, i:[...root.querySelectorAll(sel)].indexOf(el), a, z };
}
function restoreFocus(root, cap){
  if(!cap || !root) return;
  const list=root.querySelectorAll(cap.sel), el=list[Math.max(0,Math.min(cap.i,list.length-1))];
  if(!el || el===document.activeElement) return;
  el.focus({preventScroll:true}); try{ if(cap.a!=null) el.setSelectionRange(cap.a,cap.z); }catch(err){ /* a number box has no caret */ }
}
function renderPanel(){
  if(isPressed()){ pendingPanel=true; return; }
  pendingPanel=false;
  const P=$('kcPanel'), D=def();
  if(!P) return;
  P.classList.toggle('open', S.open);
  document.body.classList.toggle('kc-sheet-open', sheetLocked());
  renderChips();
  if(!S.open || !D) return;
  $('kcPanelTitle').innerHTML = D.custom ? `${S.edit!=null?'⚙ Edit':'➕ Add'} custom item` : `⚙ Configure: ${esc(D.title)}`;      // no internal id chip (KC-PREP, KC-SINK ...): owner A10, no prototype labels (D14)
  const c=S.cfg;
  let g; try{ g = startGroup(D) + D.form(c) + (D.custom?'':customPartGroup(c)); }
  catch(err){ console.error('KC host: the form of "'+S.kind+'" failed', err); g=`<div class="cfg-group cfg-wide"><div class="cfg-errbox">The form for “${esc(D.title)}” could not be built: ${esc(err.message)}. See the console.</div></div>`; }
  const sc=$('kcPanelScroll'), same = panelSession===lastSession, keep = same ? sc.scrollTop : 0, hadFocus = same ? captureFocus(sc) : null; lastSession=panelSession;
  sc.innerHTML=`<div class="cfg-preview" id="kcName"></div><div class="kc-msgs" id="kcMsgs"></div>
    <div class="kc-layout"><div class="cfg-grid">${g}</div><aside class="kc-aside" id="kcAside"></aside></div>
    <div class="cfg-extras">
      <div class="fg"><label for="kcQty">Qty</label><div class="cfg-stepper"><button type="button" data-qty="-1" aria-label="One less">−</button><input type="number" id="kcQty" min="1" value="${S.qty}"><button type="button" data-qty="1" aria-label="One more">+</button></div>${S.kind==='vent'?'<div class="kc-sm" style="margin-top:3px">One system per hood line. Change it if each hood gets its own.</div>':''}</div>
      <div class="fg"><label for="kcUnit">Unit</label><input type="text" id="kcUnit" value="${esc(S.unit)}"></div>
      <div class="fg cfg-note"><label for="kcNote">Note <span style="font-weight:400;text-transform:none;letter-spacing:0;">(optional, prints under the line)</span></label><input type="text" id="kcNote" value="${esc(S.note)}" placeholder="e.g. install height, delivery floor…"></div>
    </div>`;
  sc.scrollTop=keep;
  renderLive();
  restoreFocus(sc, hadFocus);                                  // the box being typed in keeps the focus (the same form, re-drawn)
}

/* the warnings a role sees: one that says "Staff only" (a note for the President, never printed) is hidden from every role that may not see costs (ported from ../kc/screens-quote.js) */
const shownWarnings = v => v.warnings.filter(w=>KC.can('costs') || !w.includes('Staff only'));
/* a signed peso amount for the cost summary (a plus or minus sign, then the amount) */
const signedPeso = n => (n<0 ? '−' : '+')+peso(Math.abs(n));
/* the Cost summary table (President only): each group's materials, labor and misc, the project cost x the markup in force, then (a list-priced line, owner R4 Q23) the
   List price adjustment = the list price less the formula price of the unchanged base model, so the rounded unit price reconciles; the last row is the unit price. */
function costSumHtml(pr){
  if(!pr.groups.length) return '<div class="kc-sm">Type the materials and labor to see the cost.</div>';
  const l=pr.list;
  return `<table class="kc-cost">${pr.groups.map(gp=>`<tr><td><b>${esc(gp.label)}</b><br><span class="kc-sm">materials ${peso(gp.M)} + labor ${gp.bracket?KC.SET.br[gp.bracket]+'%':'typed'} ${peso(gp.labor)} + misc ${KC.SET.misc}% ${peso(gp.misc)}</span></td><td>${peso(gp.cost)}</td></tr>`).join('')}<tr class="tot"><td>Project cost × ${effMarkup()}${pr.markupOvr?" (markup override)":""}</td><td>${peso(pr.selling)}</td></tr>${l?`<tr class="tot"><td>List price adjustment<br><span class="kc-sm">list price ${esc(l.code)} ${peso(l.base)} less ${peso(l.baseSelling)}, the formula price of the unchanged base model</span></td><td>${signedPeso(l.adj)}</td></tr>`:''}<tr class="tot"><td>Rounded to 10 pesos</td><td>${peso(pr.unit)}</td></tr></table>`;
}

function renderLive(o={}){
  const D=def(); if(!S.open || !D) return;
  const c=S.cfg;
  if(S.reviewed && S.reviewSig!==JSON.stringify(c)) S.reviewed=false;                   // spec 3.2: a review is reset when the configuration changes afterwards
  const v=check(S.kind,c), pr=priceOf(S.kind,c), costs=KC.can('costs');
  { const L=printParts(D,c); $('kcName').innerHTML=`<span style="font-weight:400">Prints as:</span> ${esc(L.title)}${L.sub?` <span style="font-weight:400">${esc(L.sub)}</span>`:''}`; }
  let m='';
  if(v.errors.length) m+=`<div class="cfg-errbox">${v.errors.map(e=>'✕ '+esc(e)).join('<br>')}</div>`;
  const warns=shownWarnings(v);
  if(warns.length) m+=`<div class="cfg-notice">${warns.map(w=>'⚠ '+esc(w)).join('<br>')}</div>`;
  if(v.review.length) m+= S.reviewed ? `<div class="kc-review done">✓ Reviewed by ${esc(typeof S.reviewed==='string'?S.reviewed:KC.ROLES.president.name)}.</div>` :
    `<div class="kc-review"><span>🔎 This line needs review (${esc(v.review.join(', '))}). Neil or Rene reviews it; until then the quote goes to the President for approval.</span>${KC.can('review')?'<button type="button" class="cfg-mini" data-review>Mark reviewed</button>':''}</div>`;
  $('kcMsgs').innerHTML=m;
  if(D.live) D.live(c);
  if(!o.keepAside){
    const auto=printParts(D,Object.assign({},c,{txt:null})), T=c.txt||{};
    const fld=(k,lbl,ph,area)=> area
      ? `<label class="kc-opt">${lbl}<textarea rows="4" data-txt="${k}" placeholder="${esc(ph)}">${esc(T[k]||'')}</textarea></label>`
      : `<label class="kc-opt">${lbl}<input type="text" data-txt="${k}" value="${esc(T[k]||'')}" placeholder="${esc(ph)}"></label>`;
    const autoSpecsText=htmlToText(autoSpecs(S.kind,c));
    const word=`<details class="kc-sub" data-ui="word" ${S.ui.word?'open':''}><summary>✎ Edit the wording${c.txt&&Object.keys(c.txt).length?' <span class="ms-chip warn">edited</span>':''}</summary>
        <div class="kc-edit">${fld('material','Material',auto.material)}${fld('title','Title',auto.title)}${fld('sub','Subtitle',auto.sub)}${fld('dims','Dimensions',auto.dims)}${fld('specs','Specs',autoSpecsText,true)}
        <div class="kc-sm">Empty boxes use the automatic wording shown in grey.</div><button type="button" class="cfg-mini" data-txtreset>↺ Use automatic wording</button></div></details>`;
    const matOpts=cur=>Object.entries(KC.P).map(([k,vv])=>`<option value="${k}" ${cur===k?'selected':''}>${esc(vv.l)}</option>`).join('');
    const rowsFor=part=>pr.lines.filter(l=>l.part===part).map(l=>{
      const kAttr=l.extra!=null?`data-xk="${l.extra}"`:`data-mk="${esc(l.key)}"`, qAttr=l.extra!=null?`data-xq="${l.extra}"`:`data-mq="${esc(l.key)}"`;
      return `<tr class="${l.extra!=null?'kc-added':''}"><td><select ${kAttr} class="${l.ek?'kc-ed':''}" aria-label="Material">${matOpts(l.k)}</select></td>
        <td><input type="number" step="any" min="0" ${qAttr} class="${l.eq?'kc-ed':''}" value="${+(+l.q).toFixed(3)}" style="width:66px"> <span class="kc-sm">${esc(l.u)}</span></td>
        ${costs?`<td class="kc-sm kc-lp" title="From the materials price list">${l.p==null?'<b style="color:var(--red)">no price</b>':peso(l.p)}</td><td id="kct-${esc(l.key)}">${peso(l.t)}</td>`:''}
        <td>${l.extra!=null?`<button type="button" class="kc-x" data-rmmat="${l.extra}" aria-label="Remove">✕</button>`:''}</td></tr>`; }).join('');
    const descRows=D.describe(c), labels=descRows.map(r=>r[0]);
    pr.lines.forEach(l=>{ if(!labels.includes(l.part)) labels.push(l.part); });
    const descMap=Object.fromEntries(descRows);
    const parts=labels.map(k=>{ const sw=pr.lines.filter(l=>l.part===k && (l.ek || l.extra!=null)).map(l=>l.l);
      const auto=(descMap[k]||'') + (sw.length?(descMap[k]?'; ':'')+'uses '+sw.join(', '):''), rows=rowsFor(k);
      return `<div class="kc-part"><div class="kc-part-l">${esc(toMM(k))}</div><div class="kc-part-t">${esc(toMM(auto)||'—')}</div>
        ${rows?`<table class="kc-cost kc-costed">${rows}</table>`:''}
        ${rows && !['Material','Size','Placement'].includes(k)?`<button type="button" class="cfg-link kc-addm" data-addmat="${esc(k)}">+ material</button>`:''}</div>`; }).join('');   // "+ material" only on a part that has materials (not on text-only parts such as "Mounting")
    const edited=(c.ovr&&Object.keys(c.ovr).length)||(c.extra&&c.extra.length);
    const g0=pr.groups[0], hasBracket=!!(g0 && g0.bracket);
    const sum = costs ? `<div class="cfg-group"><div class="cfg-lbl">Cost summary <span class="cfg-staff-chip">staff</span>${c.bracketOvr?' <span class="ms-chip warn">edited</span>':''}</div>
        ${hasBracket?`<div class="cfg-slot-ctl" style="margin:0 0 6px"><label class="kc-opt" style="flex-direction:row;align-items:center;gap:6px">Labor <select data-bracket>${['simple','medium','complex'].map(b=>`<option value="${b}" ${g0.bracket===b?'selected':''}>${b[0].toUpperCase()+b.slice(1)} ${KC.SET.br[b]}%</option>`).join('')}</select></label></div>`:''}
        <div id="kcCostSum"></div></div>` : '';
    if(D.custom) $('kcAside').innerHTML=`<div class="cfg-group"><div class="cfg-lbl">Drawing <span class="cfg-unit">none</span></div><div class="kc-q-nodraw">No drawing</div></div>
      <div class="cfg-group"><div class="cfg-lbl">Prints on the quote</div><div id="kcPrintPrev"></div></div>${sum}`;
    else $('kcAside').innerHTML=`<div class="cfg-group"><div class="cfg-lbl">Drawing <span class="cfg-unit">prints on the quote</span></div><div class="kc-draw">${safeSvg(D,c)}</div></div>
      <div class="cfg-group"><div class="cfg-lbl">Prints on the quote</div><div id="kcPrintPrev"></div>${word}</div>
      <details class="cfg-group" data-ui="det" ${S.ui.det?'open':''}><summary class="cfg-lbl kc-group-sum">Build detail &amp; materials ${costs?'<span class="cfg-staff-chip">costs: staff</span>':''}${edited?' <span class="ms-chip warn">edited</span>':''}</summary>
        <div class="kc-sm" style="margin:4px 0 8px">Each part of the build with the materials it uses. The text follows the options above; only the materials and quantities can be changed here. Prices come only from the materials price list. Orange = changed.</div>
        <div class="kc-edit">${parts}</div>
        <div class="cfg-slot-ctl"><button type="button" class="cfg-mini" data-detreset>↺ Back to automatic materials</button></div></details>${sum}`;
  }
  $('kcPrintPrev').innerHTML=descBlock(S.kind, c, S.note);
  if(costs && $('kcCostSum')){
    pr.lines.forEach(l=>{ const td=$('kct-'+l.key); if(td) td.textContent=peso(l.t); });
    $('kcCostSum').innerHTML = costSumHtml(pr);
  }
  const canAdd=v.errors.length===0 && pricesReady();                                   // KC:C "Add to Quote" is off until the prices have loaded (spec 2.2)
  const price = !pricesReady()
    ? `<span class="cfg-badge">Prices not loaded</span><div class="cfg-pcap">${window.KCLive && window.KCLive.state==='loading' ? 'Loading prices…' : 'Prices could not be loaded. Configured lines keep their stored price.'} Nothing can be added until they are.</div>`
    : pr.priced
    ? `<div class="cfg-pfig">${peso(pr.unit)} <small>per unit, VAT not included</small> <span class="cfg-basis-chip">${pr.list?'list price':'cost-based'}</span>${ovrChip(pr)}</div>
       <div class="cfg-pcap">${pr.list ? (costs?`Standard price list ${esc(pr.list.code)} ${peso(pr.list.base)}, plus the options by formula (project cost × ${effMarkup()}${pr.markupOvr?" (markup override)":""}), nearest 10 pesos`:'From the Nov 19 Standard Price List · the options follow the build automatically')
         : costs?`Materials ${peso(pr.groups[0].M)} + labor ${pr.groups[0].bracket?KC.SET.br[pr.groups[0].bracket]+'%':'typed'} + misc ${KC.SET.misc}%${pr.groups.length>1?" · plus "+pr.groups.slice(1).map(g=>g.label.toLowerCase()).join(", "):""}, × ${effMarkup()}${pr.markupOvr?" (markup override)":""}, nearest 10 pesos`:'From the price list · follows the build automatically'}${S.qty>1?` · ${S.qty} × = ${peso(pr.unit*S.qty)}`:''}</div>`
    : `<span class="cfg-badge">Priced after review</span><div class="cfg-pcap">${esc(pr.missing.join(', '))} ${pr.missing.length>1?'are':'is'} not entered yet. The line can be added; it cannot be filed until it is priced.</div>`;
  $('kcPanelFoot').innerHTML=`<div class="cfg-price">${price}${v.errors.length===0?'':`<div class="cfg-pwarn">Fix the red ${v.errors.length>1?v.errors.length+' items':'item'} above before adding.</div>`}</div>
    <div class="cfg-actions"><button type="button" class="btn btn-green" data-add ${canAdd?'':'disabled'}>${addLabel()}</button>
    <button type="button" class="btn btn-outline" style="background:var(--dark-blue);" data-kc-close>Cancel</button></div>`;
}
function safeSvg(D,c,o){ try{ return D.svg(c,o)||''; }catch(err){ console.error('KC host: the drawing of', D.id, 'failed', err); return ''; } }

/* ── the line description: material / bold title / (with …) / Dimensions / Specs / Notes. Product text comes from def.lineParts,
   def.shortSpecs, def.incl and the optional def.notes; the layout is the host's. This is the REFERENCE output of the print block (spec 3.4): D7.doc must match it word for word. ── */
function descBlock(kind, c, note, o={}){
  const D=defOf(kind);
  if(!D) return `<div class="kc-d"><div class="kc-d-title">${esc(kind)}</div><div class="kc-d-row">This product file is not loaded.</div></div>`;
  const L=printParts(D,c), ix=D.incl(c);
  const notes=[]; if(note) notes.push(esc(note));
  if(D.notes) D.notes(c).forEach(n=>notes.push(esc(n)));        // the product's forced sentences: they cannot be edited away
  if(o.print){ if(ix.i.length) notes.push('<b>Includes:</b> '+esc(ix.i.join(', '))); if(ix.x.length) notes.push('<b>Not included:</b> '+esc(ix.x.join(', '))); }
  const specs = c.txt&&c.txt.specs ? esc(c.txt.specs) : autoSpecs(kind,c);
  return `<div class="kc-d"><div class="kc-d-mat">${esc(L.material)} | ${esc(L.use)}</div><div class="kc-d-title">${esc(L.title)}</div>${L.sub?`<div class="kc-d-sub">${esc(L.sub)}</div>`:''}
    ${L.dims?`<div class="kc-d-row"><b>Dimensions:</b> ${esc(L.dims)}</div>`:''}
    ${specs?`<div class="kc-d-row kc-d-para"><b>Specs:</b> ${specs}</div>`:''}
    ${notes.length?`<div class="kc-d-row"><b>Notes:</b> ${notes.join(' · ')}</div>`:''}</div>`;
}

/* ═════════ readers over the quote builder (the builder owns the lines, the prices and the lead time: spec 4.1) ═════════ */
const itemOf = ln => adapter().itemOf ? adapter().itemOf(ln) : null;
/* the unit price of a line (a mirror line from KC.S.lines / KC.addLine, or the item itself); null while it still needs a price */
function linePrice(ln){ const it=itemOf(ln); if(!it) return null; const up=Number(it.unitPrice)||0; return it.needsPrice && !(up>0) ? null : up; }
function itemsTotal(){ try{ return computeTotals().subtotal; }catch(err){ return 0; } }
function isEdited(c){ return !!((c.txt&&Object.keys(c.txt).length)||(c.detail&&Object.keys(c.detail).length)||(c.detailExtra&&c.detailExtra.length)||(c.ovr&&Object.keys(c.ovr).length)||(c.extra&&c.extra.length)||c.bracketOvr); }
/* R3 (spec 3.7): N = max(25, 12 + 3 × floor(M / 20k)); M = the builder's own total of materials (computeTrueCost().materials: every costed line × its quantity) */
function leadTimeM(){ try{ return computeTrueCost().materials||0; }catch(err){ return 0; } }
function leadTime(){ try{ return leadWorkingDays(leadTimeM()); }catch(err){ return Math.max(25, 12 + 3*Math.floor(leadTimeM()/20000)); } }

/* ═════════ opening and closing the panel ═════════ */
/* focus goes back to whatever opened the panel; a card button is drawn again by the re-render, so it is found again by its data-kind / data-model */
let opener=null, openerSel='';
const noteOpener = () => {
  const a=document.activeElement; if(!a || a===document.body || (a.closest && a.closest('#kcPanel'))) return;
  const q = v => window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g,'\\$&');
  opener=a; openerSel = (a.matches && a.matches('#d7Cards [data-kind]')) ? '#d7Cards [data-kind="'+q(a.dataset.kind)+'"]'+(a.dataset.model!=null ? '[data-model="'+q(a.dataset.model)+'"]' : '') : '';
};
/* one panel at a time, in the Estimator (the panel lives there, like the website panel): bring the Estimator up, put away an open calculator, website panel and search list, then note what to give the focus back to */
function beforeOpen(){
  try{ if(typeof currentView!=='undefined' && currentView!=='internal' && document.getElementById('btnInternal') && typeof setView==='function') setView('internal'); }catch(err){ /* no view switch */ }
  try{ if(typeof dismissCalc==='function') dismissCalc(); }catch(err){ /* no calculator */ }
  try{ if(typeof cfgState!=='undefined' && cfgState && typeof closeConfigurator==='function') closeConfigurator({ silent:true }); }catch(err){ /* no website panel */ }
  try{ if(typeof closeDropdown==='function') closeDropdown(); }catch(err){ /* no list */ }
  noteOpener();
}
function scrollToPanel(){ if(!isPhone()){ const p=$('kcPanel'); if(p){ p.scrollIntoView({block:'start'}); try{ p.focus({preventScroll:true}); }catch(err){ /* no focus */ } } } }
/* openKind(kind)  openKind(kind, startId)  openKind(kind, {start, cfg, qty, note}) */
function openKind(k, arg){
  const D=defOf(k); if(!D || D.custom) return;
  const o = arg && typeof arg==='object' ? arg : { start:arg };
  const starts=D.starts||[];
  let sid = o.start!=null ? o.start : (D.defaultStart || (starts[0]&&starts[0].id) || null);
  const hit=starts.find(s=>String(s.id)===String(sid)); if(hit) sid=hit.id;
  let cfg; try{ cfg=D.startCfg(sid); }catch(err){ console.error('KC host: startCfg failed for', k, sid, err); return; }
  if(o.cfg) Object.assign(cfg, clone(o.cfg));
  beforeOpen();
  S.open=true; S.edit=null; S.editRef=null; S.kind=k; S.start=sid; S.cfg=cfg; S.qty=o.qty||1; S.unit=o.unit||'pc'; S.note=o.note||''; S.reviewed=false; S.reviewSig=null; panelSession++;
  renderPanel(); scrollToPanel();
}
function openCustom(cat){
  beforeOpen();
  S.open=true; S.edit=null; S.editRef=null; S.kind='custom'; S.start=null; S.cfg=CUSTOM.startCfg(); if(cat && TAB_IDS.includes(cat)) S.cfg.cat=cat;
  S.qty=1; S.unit='pc'; S.note=''; S.reviewed=false; S.reviewSig=null; panelSession++;
  renderPanel(); scrollToPanel();
}
/* the panel on a line that is already on the quote (D7.adapter.edit): o = { kind, cfg, start, qty, unit, note, reviewed, edit (the items[] index), ref (the item) } */
function openLine(o){
  const D=defOf(o && o.kind); if(!D) return false;
  beforeOpen();
  S.cfg=clone(o.cfg); S.kind=o.kind; S.qty=o.qty||1; S.unit=o.unit||'pc'; S.note=o.note||''; S.reviewed=o.reviewed||false; S.reviewSig=S.reviewed ? JSON.stringify(S.cfg) : null;
  S.start=o.start!=null ? o.start : null; S.edit=o.edit!=null ? o.edit : null; S.editRef=o.ref||null; S.open=true; panelSession++;
  renderPanel(); scrollToPanel(); return true;
}
/* Ventilation opened for a hood line (spec 11.4 mechanics 1, 10.3): linked by hoodRef, scope from the hood's add-ons, sizes copied from the hood */
function openVentFor(hood){
  if(typeof hood==='string') hood=KC.lineById ? KC.lineById(hood) : null;
  const V=KC.products.vent; if(!V || !hood) return false;
  const starts=V.starts||[], sid = starts.some(s=>s.id==='blank') ? 'blank' : (V.defaultStart || (starts[0]&&starts[0].id) || null);
  const h=hood.cfg;
  let cfg=null;
  if(typeof KC.ventFromHood==='function'){ try{ cfg=KC.ventFromHood(h, hood.id); }catch(err){ console.error('KC host: ventFromHood failed', err); } }   // product-duct.js builds it (spec 10.3)
  if(!cfg){                                                                                   // the documented rule, when that helper is absent
    try{ cfg=V.startCfg(sid); }catch(err){ console.error('KC host: startCfg failed for vent', err); return false; }
    const scope=ventScope(h); cfg.hoodRef=hood.id; cfg.scope=scope;
    if(scope==='blower'){ cfg.exFam='box'; cfg.exPlace='hood'; }
    if(h.use) cfg.use=h.use; if(h.purpose) cfg.purpose=h.purpose;
    relink(cfg,h); }
  beforeOpen();
  S.open=true; S.edit=null; S.editRef=null; S.kind='vent'; S.start=sid; S.cfg=cfg; S.qty=1; S.unit='pc'; S.note=''; S.reviewed=false; S.reviewSig=null; panelSession++;      // ventilation quantity stays 1 (owner, Q3)
  renderPanel(); scrollToPanel(); return true;
}
function closePanel(){
  S.open=false; S.edit=null; S.editRef=null; renderPanel();
  const el = opener && document.contains(opener) ? opener : (openerSel ? document.querySelector(openerSel) : null);
  if(el){ try{ el.focus({preventScroll:true}); }catch(err){ /* gone */ } }
  opener=null; openerSel='';
}

/* "Add to Quote" / "Update line": the host builds the line, the bridge puts it on the quote (add, or update in place) and prices it */
function onAdd(){
  const D=def(), kind=S.kind; if(!D) return;
  const ad=adapter();
  if(!pricesReady()){ if(window.D7) D7.toast('Prices are not loaded yet, so nothing can be added.','error'); return; }
  if(typeof ad.commit!=='function'){ if(window.D7) D7.toast('The quote builder bridge (d7/d7-adapter.js) is not loaded.','error'); return; }
  const isEdit=S.edit!=null;
  const line={ cfg:clone(S.cfg), kind, start:S.start, qty:S.qty, unit:S.unit, note:S.note, reviewed:S.reviewed };
  const wantsVent = !isEdit && kind==='hood' && (line.cfg.blower||line.cfg.ducting) && !!KC.products.vent;
  const saved=ad.commit(line, { editIdx:S.edit, ref:S.editRef });          // the mirror line ({id:kcId, kind, cfg, ...}) of the line that was added or updated
  if(!saved) return;                                                        // the bridge refused (it said why): the panel stays open
  S.open=false; S.edit=null; S.editRef=null;
  if(D.afterAdd){ try{ D.afterAdd(saved); }catch(err){ console.error('KC host: afterAdd failed for', kind, err); } }     // may re-open the panel (hood -> ventilation)
  if(!S.open && wantsVent) openVentFor(saved);
  if(!S.open) renderPanel();
  if(!S.open){ const sec=$('itemsSection'); if(sec) sec.scrollIntoView({block:'start'}); }
}

/* ═════════ events ═════════ */
/* A pill's value (data-val) arrives as text. It keeps the type of the value already in the cfg: a field that holds a number gets a number
   (top.thk 1.2, splashH 15), a field that holds text keeps text (the backsplash keys 'none' / '150' / 'full': KC.LIB.top reads a NUMBER there
   as a height in cm, so '150' must never become 150), a boolean field gets a boolean. A pill may also opt in to a number with data-num, as
   data-k inputs do. With no value to follow, the text stays: a wrong guess here is silent, a text value that should be a number shows at once
   (the pill never reads as pressed). */
function pillValue(path, raw, forceNum){
  if(forceNum) return raw==='' ? null : Number(raw);
  let cur; try{ cur=KC.getP(path); }catch(err){ cur=undefined; }
  if(typeof cur==='number') return /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  if(typeof cur==='boolean') return raw==='true' ? true : raw==='false' ? false : raw;
  return raw;
}
{ const down=()=>{ pressing=true; pressAt=Date.now(); },
        up=()=>{ if(!pressing) return; pressing=false;
          if(pendingPanel || heldRenders.size) setTimeout(()=>{ if(pressing) return; if(pendingPanel) renderPanel(); const fns=[...heldRenders]; heldRenders.clear(); fns.forEach(f=>f()); },0); };   // after the click has been handled
  document.addEventListener('mousedown',down,true);
  ['mouseup','pointercancel','touchcancel','dragend','contextmenu'].forEach(t=>document.addEventListener(t,up,true));
  addEventListener('blur',up); document.addEventListener('visibilitychange',up); }
const inPanel = el => !!(el && el.closest && el.closest('#kcPanel'));
document.addEventListener('click',e=>{
  const t=e.target.closest('button,[data-kc-close]'); if(!t) return;
  const d=t.dataset;
  if(d.kctab && t.closest('#catTabs')) return setTab(d.kctab, true);
  if(d.kind && t.closest('#d7Cards')) return openKind(d.kind, d.model!=null ? {start:d.model} : undefined);
  if('kcClose' in d) return closePanel();
  if(!inPanel(t) || !S.open) return;                                       // everything below is the panel's own (the quote builder has buttons of its own)
  const D=def(); if(D && D.on && D.on('click', t, d)) return;            // the product first (spec section 2.5)
  if('addcust' in d){ (S.cfg.custom=S.cfg.custom||[]).push({text:'',m:null,lab:null}); S.reviewed=false; return renderPanel(); }
  if(d.rmcust!=null){ S.cfg.custom.splice(+d.rmcust,1); S.reviewed=false; return renderPanel(); }
  if('crowAdd' in d){ (S.cfg.rows=S.cfg.rows||[]).push({k:'',q:1}); S.reviewed=false; return renderPanel(); }              // Add custom item: a material row from the price list
  if(d.crowRm!=null){ if(S.cfg.rows) S.cfg.rows.splice(+d.crowRm,1); S.reviewed=false; return renderPanel(); }
  if(d.addmat){ (S.cfg.extra=S.cfg.extra||[]).push({k:'sh12',q:1,part:d.addmat}); S.ui.det=true; return renderLive(); }
  if(d.rmmat){ S.cfg.extra.splice(+d.rmmat,1); return renderLive(); }
  if('txtreset' in d){ delete S.cfg.txt; return renderLive(); }
  if('detreset' in d){ delete S.cfg.detail; delete S.cfg.detailExtra; delete S.cfg.ovr; delete S.cfg.extra; return renderLive(); }
  if(d.toggle){ KC.setP(d.toggle, !KC.getP(d.toggle)); return renderPanel(); }
  if(d.start){ const hit=(D.starts||[]).find(s=>String(s.id)===d.start); S.start=hit?hit.id:d.start; S.cfg=D.startCfg(S.start); S.reviewed=false; return renderPanel(); }
  if(d.qty){ S.qty=Math.max(1,S.qty+(+d.qty)); $('kcQty').value=S.qty; return renderLive(); }
  if('review' in d){ S.reviewed=reviewerName(); S.reviewSig=JSON.stringify(S.cfg); return renderLive(); }
  if('add' in d) return onAdd();
  if(d.set){ KC.setP(d.set, pillValue(d.set, d.val, 'num' in d)); if(S.kind==='custom') S.reviewed=false; return renderPanel(); }
});
document.addEventListener('toggle',e=>{
  const el=e.target; if(!el || !el.dataset) return;
  if(el.dataset.ui && inPanel(el)) S.ui[el.dataset.ui]=el.open;
  else if(el.classList && el.classList.contains('kc-card-det') && isPhone()) S.ui['models:'+el.dataset.id]=el.open;
},true);
document.addEventListener('input',e=>{
  const el=e.target, d=el.dataset||{}, c=S.cfg;
  if(!inPanel(el) || !S.open) return;
  if(d.cust!=null){ const x=c.custom && c.custom[+d.cust]; if(x){ x[d.cf] = d.cf==='text' ? el.value : num(el.value); S.reviewed=false; renderLive({keepAside:true}); } return; }
  { const D=def(); if(D && D.on && D.on('input', el, d)) return; }             // the product first (spec section 2.5)
  if(d.mq){ c.ovr=c.ovr||{}; const o=c.ovr[d.mq]=c.ovr[d.mq]||{}; o.q= el.value===''?null:Number(el.value); if(o.q==null) delete o.q; if(!Object.keys(o).length) delete c.ovr[d.mq]; el.classList.toggle('kc-ed', o.q!=null); return renderLive({keepAside:true}); }
  if(d.xq!=null){ c.extra[+d.xq].q=Number(el.value||0); return renderLive({keepAside:true}); }
  if(d.mk||d.xk!=null) return;
  if(d.txt){ c.txt=c.txt||{}; if(el.value) c.txt[d.txt]=el.value; else delete c.txt[d.txt]; return renderLive({keepAside:true}); }
  if(el.id==='kcQty'){ S.qty=Math.max(1,+el.value||1); return renderLive(); }
  if(el.id==='kcUnit'){ S.unit=el.value; return; }
  if(el.id==='kcNote'){ S.note=el.value; return renderLive({keepAside:true}); }
  const k=el.dataset.k; if(!k || el.tagName==='SELECT' || el.type==='checkbox') return;
  let v=el.value; if('num' in el.dataset) v= v===''?null:Number(v);
  KC.setP(k,v);
  if(/\.(m|lab|text)$/.test(k) || S.kind==='custom') S.reviewed=false;
  renderLive();
});
document.addEventListener('change',e=>{
  const el=e.target, d=el.dataset||{}, D=def();
  if(!inPanel(el)) return;
  { const c=S.cfg;
    if(d.mk){ const v=el.value;
      if(D && D.syncSwap && D.syncSwap(c, d.mk, v)){ if(c.ovr) delete c.ovr[d.mk]; return renderPanel(); }      // maps back to an option: no override
      c.ovr=c.ovr||{}; const o=c.ovr[d.mk]=c.ovr[d.mk]||{}; const auto=d.mk.split('|')[0]; if(v===auto) delete o.k; else o.k=v; if(!Object.keys(o).length) delete c.ovr[d.mk]; return renderLive(); }
    if(d.xk!=null){ c.extra[+d.xk].k=el.value; return renderLive(); } }
  if('bracket' in d){ S.cfg.bracketOvr = el.value===D.bracket(S.cfg)?null:el.value; return renderLive(); }
  if(S.open && D && D.on && D.on('change', el, d)) return;                                  // the product first (spec section 2.5)
  const k=d.k; if(!k) return;
  if(k==='purpose') return renderPanel();
  if(el.tagName==='SELECT'){ let v=el.value; if('num' in d) v=Number(v); KC.setP(k,v); if(S.kind==='custom') S.reviewed=false; return renderPanel(); }
  if(el.type==='checkbox'){ KC.setP(k,el.checked); S.reviewed=false; return renderPanel(); }
  if(el.type==='number' && D && D.rerender && D.rerender.test(k)) renderPanel();           // "change on width / count inputs" (def.rerender)
});
/* Esc closes the panel; a modal or the phone menu on top of it takes the Escape first (the website panel's rule) */
const MODAL_IDS=['helpModal','plModal','bomModal','verifyModal','importModal','miscDistModal'];
document.addEventListener('keydown',e=>{
  const tb=e.target.closest && e.target.closest('.kc-tab');
  if(tb && ['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){                      // the tab bar, as a tablist
    const i=ALL_IDS.indexOf(tb.dataset.kctab), n=ALL_IDS.length;
    const j = e.key==='ArrowRight' ? (i+1)%n : e.key==='ArrowLeft' ? (i-1+n)%n : e.key==='Home' ? 0 : n-1;
    e.preventDefault(); return setTab(ALL_IDS[j], true); }
  if(e.key==='Escape' && S.open){
    if(MODAL_IDS.some(id=>{ const m=document.getElementById(id); return m && m.style.display==='flex'; })) return;
    if(document.getElementById('mtbOverlay') && document.getElementById('mtbOverlay').classList.contains('show')) return;
    if(typeof tourActive!=='undefined' && tourActive) return;
    e.preventDefault(); closePanel(); } });
addEventListener('resize',()=>{ document.body.classList.toggle('kc-sheet-open', sheetLocked()); renderChips(); });

/* the website panel and the calculator are the other two panels of the Estimator: when one of them opens, this one is put away (each of them replaces the others) */
if(window.MutationObserver){
  ['configPanel','calcPanel'].forEach(id=>{ const el=document.getElementById(id); if(!el) return;
    new MutationObserver(()=>{ if(S.open && el.classList.contains('open')){ S.open=false; S.edit=null; S.editRef=null; opener=null; openerSel=''; renderPanel(); } }).observe(el,{attributes:true,attributeFilter:['class']}); });
}
/* a product registered after the page has booted (a test from the console) shows up at once */
{ const register=KC.registerProduct; KC.registerProduct = def => { const r=register(def); if(KC.booted) renderChips(true); return r; }; }
/* the page opens on the tabs and cards, with the configurator closed (core's boot opens one product, as v17 did; at 375px that sheet would hide the tabs) */
S.open=false; S.edit=null; S.editRef=null;
{ const boot=KC.boot; let first=true;
  KC.boot = function(){ boot.apply(this, arguments); if(first){ first=false; S.open=false; S.edit=null; S.editRef=null; renderPanel(); } }; }

/* what the other files may call */
/* KC.holdWhilePressed(fn): true when a press is in progress (the caller returns; fn runs once the press is over). False otherwise, and fn is no longer waiting. */
KC.holdWhilePressed = fn => { if(isPressed()){ heldRenders.add(fn); return true; } heldRenders.delete(fn); return false; };
KC.captureFocus = captureFocus; KC.restoreFocus = restoreFocus;
Object.assign(KC, { renderChips, renderPanel, renderLive, openKind, openCustom, openVentFor, openLine, closePanel, setTab,
  renderItems: () => { if(d7Ready() && typeof renderItems==='function') renderItems(); },      // the builder's table is the table; nothing is drawn before its catalogue is in
  renderPaper: () => {},                                                                        // "Preview document" is the builder's own
  descBlock, linePrice, itemsTotal, isEdited, priceOf, check, leadTime, leadTimeM, markupOvr, effMarkup, belowMarkup, costOf, relink, autoSpecs,
  costSumHtml, shownWarnings,                                                                   // the cost summary table and the warnings a role sees: exported for the Checks (as the standalone host does)
  defOf, printParts, customDef:CUSTOM, customMaterial, cardFrom:id => { const D=KC.products[id]; return D ? fromOf(D) : null; } });
})();
