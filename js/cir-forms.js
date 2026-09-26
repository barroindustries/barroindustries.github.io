// js/cir-forms.js — CLIENT-INFO-REQUEST-SPEC.md §1.4–1.7 (WS-0).
//
// Canonical, versioned form definition for the "Client Information Request"
// feature (public intake form → Sales › Briefs). Byte-identical mirror lives
// at functions/cir-forms.js (ci-invariants check 7 enforces this — edit THIS
// file, then `cp js/cir-forms.js functions/cir-forms.js`, never the reverse).
//
// UMD-ish shim so all three consumers load the same bytes with zero deps:
//   - browser <script> (classic, non-module): defines window.CIR_FORMS /
//     window.CIR_PRIVACY_NOTICE / window.CIR_LIMITS
//   - Node CommonJS require() (functions/index.js, functions/cir-core.js,
//     tests/client-info-request.test.mjs): exports { FORMS, PRIVACY_NOTICE, LIMITS }
//
// Zero dependencies. Must not reference any browser global at load time
// other than a guarded `typeof window`.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;   // functions/ + tests
  if (root) { root.CIR_FORMS = api.FORMS; root.CIR_PRIVACY_NOTICE = api.PRIVACY_NOTICE; root.CIR_LIMITS = api.LIMITS; }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // ── 1.5 LIMITS — single source for page + server ──────────────────────
  var LIMITS = {
    maxPhotos: 20,             // per submission
    maxPhotoBytes: 900000,     // per photo AFTER client downscale (server rejects above)
    minPhotoBytes: 2000,
    maxTotalPhotoBytes: 12000000,
    photoLongEdge: 1600,       // client canvas target
    photoQuality: 0.8,         // client JPEG quality (retry ladder: 0.8 → 0.6 → long edge 1200 @ 0.6)
    maxCaption: 120,
    maxEquipmentRows: 40,
    maxCellChars: 120,
    maxPayloadBytes: 200000,   // JSON.stringify(payload).length cap, checked client AND server
    minFillMs: 15000,          // submit must be ≥ 15 s after the draft was created (server clock)
    draftTtlMs: 7 * 24 * 3600e3,
    dupWindow: 'day'           // duplicate guard = same email+phone fingerprint on the same Manila date
  };

  // ── 1.6 PRIVACY_NOTICE — canonical text; version bump on any wording change ──
  var PRIVACY_NOTICE = {
    version: '2026-09-26.1',
    consentLine: 'I agree to Barro Industries using this information and these photos to prepare my kitchen design and proposal, in line with the Data Privacy Act of 2012 (RA 10173).',
    sections: [
      { heading: 'Who is responsible for your data',
        body: 'Personal Information Controller: Barro Industries OPC (SEC-registered, Metro Manila), trading as Barro Kitchens. Contact for privacy matters: the President, 0927 683 6300, barroindustries@gmail.com.' },
      { heading: 'What we collect on this page',
        body: 'Your name, position, company, mobile number, e-mail, addresses; your answers about your business, kitchen, site, utilities, storage, permits, scope, timeline and budget; the photos you choose to attach and their captions; the date and time you send the form; and your device\'s IP address and browser identifier.' },
      { heading: 'Why',
        body: 'To plan your kitchen layout, equipment, exhaust and utilities; to prepare a design and a proposal; and to contact you to schedule a site visit and follow up on this request.' },
      { heading: 'Lawful basis',
        body: 'Republic Act 10173 section 12(b) — steps taken at your request before entering into a contract — and your consent for the photos and for the communications about this request.' },
      { heading: 'Who we share it with',
        body: 'Barro Industries staff who work on your request; Google LLC, whose Firebase/Google Cloud services host this system (servers may be outside the Philippines); and government authorities only when the law requires it. We do not sell or rent personal data.' },
      { heading: 'How long we keep it',
        body: 'If no project follows, up to twenty-four (24) months from our last contact with you, then deleted. If a project follows, for the life of the project and ten (10) years after turnover, in line with Philippine record-keeping requirements. You may ask us to delete this request and its photos at any time.' },
      { heading: 'Your rights',
        body: 'To be informed; to access; to object; to rectification; to erasure or blocking; to damages; to data portability; and to lodge a complaint with the National Privacy Commission (privacy.gov.ph). Write to the contact above; we respond within fifteen (15) working days.' },
      { heading: 'Security',
        body: 'Data is encrypted in transit; photos and answers are readable only by authorised staff. This page stores a draft of your answers and an upload key only in your own browser — no advertising cookies.' }
    ]
  };

  // ── 1.7 FORMS.commissary_brief — the complete v1 definition ───────────
  // Content baseline = Neil's original /Users/neilbarro/Downloads/commissary-intake.html.
  // Transcribed exactly: option strings are the original value= attributes;
  // {v,l} pairs are used where Neil's chip label differed from its value.
  // Wording, order and placeholders are his, except the two deliberate
  // additions noted in the spec's "Notes for WS-0": the `label`s on the
  // `pain`/`compliance`/`scope`... chips fields (rendered as `.sub` headings
  // — same wording Neil already used as `.sub` text) and the new Photos part.
  var FORMS = {
    commissary_brief: {
      formId: 'commissary_brief',
      formVersion: 1,
      brand: 'BARRO INDUSTRIES · Commercial Kitchen Fabrication',
      title: 'Commissary kitchen project brief',
      intro: "Tell us how your kitchen runs today and where you want it to go. We use this to plan your layout, equipment, exhaust and utilities before our site visit. Anything you're unsure of, leave blank — we'll go through it together.",
      specs: [ { b: '10 parts', t: 'in this form' }, { b: '15–25 min', t: 'to complete' }, { b: 'Auto-saved', t: 'on this device' } ],
      footer: 'Barro Industries · Valenzuela City, Metro Manila',
      submitLabel: 'Send project brief',
      doneTitle: 'Project brief sent',
      doneBody: 'Thank you. Our team will review your answers and contact you to schedule a site visit.',
      sections: [
        { key: 'client', title: 'Client details', hint: "Who we'll be working with on this project.", fields: [
          { key: 'name',         label: 'Full name',                 type: 'text',  required: true, autocomplete: 'name', max: 120 },
          { key: 'position',     label: 'Position / role',           type: 'text',  placeholder: 'e.g. Owner, Operations Manager', max: 80 },
          { key: 'company',      label: 'Company name',              type: 'text',  required: true, w: 'full', autocomplete: 'organization', max: 120 },
          { key: 'phone',        label: 'Mobile number',             type: 'tel',   required: true, placeholder: '09XX XXX XXXX', autocomplete: 'tel' },
          { key: 'email',        label: 'Email',                     type: 'email', required: true, autocomplete: 'email' },
          { key: 'address',      label: 'Office / business address', type: 'textarea', required: true, w: 'full', rows: 2, max: 500 },
          { key: 'site_address', label: 'Commissary site address',   type: 'textarea', required: true, w: 'full', rows: 2, max: 500, placeholder: 'Where the commissary will be built — include landmarks if helpful' },
          { key: 'contact_pref', label: 'Best way to reach you',     type: 'select', w: 'full', options: ['Phone call','Viber','WhatsApp','Email','Messenger'] }
        ]},
        { key: 'business', title: 'Your business', hint: 'What the commissary will produce and who it serves.', fields: [
          { key: 'biz_type', label: 'Type of business', type: 'select', w: 'full', options: ['Restaurant group / multi-branch','Fast food / QSR franchise','Cloud kitchen','Catering / events','Hotel or resort','Hospital','School / university canteen','Corporate / BPO canteen','Bakery / pastry','Food manufacturing / packaged food','Other'] },
          { key: 'branches_now',    label: 'Branches supplied today',        type: 'number', min: 0, max: 10000 },
          { key: 'branches_target', label: 'Branches in 3 years (target)',   type: 'number', min: 0, max: 10000 },
          { key: 'menu',            label: 'Cuisine and main products',      type: 'textarea', w: 'full', placeholder: 'e.g. Filipino rice meals, sauces and marinades, bread and pastries, frozen dumplings' },
          { key: 'process', label: 'What the commissary will do', type: 'chips', options: ['Raw prep / butchery','Marinating','Sauces and soups','Cook-chill','Frying','Rice cooking','Baking','Portioning and packing','Freezing','Ready-to-eat meals'] },
          { key: 'volume_now',    label: 'Current output per day',  type: 'text', placeholder: 'e.g. 800 meals or 300 kg' },
          { key: 'volume_target', label: 'Target output per day',   type: 'text', placeholder: 'e.g. 2,000 meals' },
          { key: 'hours',         label: 'Operating hours',         type: 'text', placeholder: 'e.g. 4 AM – 8 PM' },
          { key: 'shifts',        label: 'Shifts per day',          type: 'select', options: ['1','2','3 (24 hours)'] },
          { key: 'days',          label: 'Days per week',           type: 'number', min: 1, max: 7 },
          { key: 'staff',         label: 'Kitchen staff per shift', type: 'number', min: 0, max: 10000 }
        ]},
        { key: 'operations', title: 'How you operate today', hint: 'Your current setup tells us what to keep, fix, or rethink.', fields: [
          { key: 'current_setup', label: 'Current setup', type: 'select', w: 'full', options: ['Each branch cooks its own food','We have a commissary, need to expand or relocate','We have a commissary, need to renovate it','Renting kitchen space','New business, no kitchen yet'] },
          { key: 'pain', label: "Problems you're running into", type: 'chips', options: ['Not enough space',"Can't keep up with volume",'Too hot / poor exhaust','Smoke or smell complaints',{ v: 'Inconsistent product quality', l: 'Inconsistent quality' },{ v: 'Workflow crossing / bottlenecks', l: 'Workflow bottlenecks' },'Not enough cold storage','High gas or power bills','Equipment breaking down',{ v: 'Failed inspection / permit issues', l: 'Permit / inspection issues' },{ v: 'Drainage or grease problems', l: 'Drainage / grease problems' }] },
          { key: 'works_well',    label: 'What works well that we should keep?', type: 'textarea', w: 'full' },
          { key: 'biggest_issue', label: 'The one thing you most want fixed',    type: 'textarea', w: 'full' }
        ]},
        { key: 'equipment', title: 'Equipment you use now', hint: 'List the main equipment you currently have, and whether you want to reuse it in the new kitchen. Brand and model are helpful but optional.', fields: [
          { key: 'current_equipment', label: 'Current equipment', type: 'table', minRows: 3, maxRows: 40, addLabel: '+ Add equipment', columns: [
            { key: 'item',  label: 'Equipment',     type: 'text',   placeholder: 'e.g. 3-burner range', width: '28%' },
            { key: 'qty',   label: 'Qty',           type: 'number', min: 0, max: 999, width: '9%' },
            { key: 'brand', label: 'Brand / model', type: 'text',   width: '20%' },
            { key: 'power', label: 'Power',         type: 'select', options: ['LPG','Electric','Steam','None'], width: '14%' },
            { key: 'cond',  label: 'Condition',     type: 'select', options: ['Good','Fair','Poor'], width: '13%' },
            { key: 'plan',  label: 'Plan',          type: 'select', options: ['Reuse','Replace','Unsure'], width: '14%' }
          ]},
          { key: 'needed_equipment', label: 'Equipment you plan to add or need', type: 'chips', options: ['Gas ranges / burners',{ v: 'High-pressure burners / wok ranges', l: 'High-pressure / wok ranges' },'Tilting braising pan','Steam kettles / stock pots','Deep fryers','Combi ovens','Deck / convection ovens',{ v: 'Industrial rice cookers / steamers', l: 'Rice cookers / steamers' },'Blast chiller / freezer','Walk-in chiller','Walk-in freezer','Prep tables and sinks',{ v: 'Meat grinder / slicer / mixer', l: 'Grinder / slicer / mixer' },{ v: 'Vacuum sealer / packaging', l: 'Vacuum sealer / packing' },'Dishwasher / pot wash','Shelving and racks'] }
        ]},
        { key: 'site', title: 'The site', hint: 'The space shapes everything — layout, exhaust routing and utility runs.', fields: [
          { key: 'site_status', label: 'Site condition', type: 'select', w: 'full', options: ['Bare shell / empty space','Existing kitchen, to be renovated','Building under construction','Still looking for a site'] },
          { key: 'ownership',   label: 'Owned or leased?',          type: 'select', options: ['Owned','Leased','Not decided'] },
          { key: 'floor',       label: 'Floor level',               type: 'text', placeholder: 'e.g. Ground floor' },
          { key: 'area',        label: 'Kitchen floor area (sqm)',  type: 'number', min: 0, max: 100000 },
          { key: 'ceiling',     label: 'Ceiling height (m)',        type: 'number', min: 0, max: 50, step: 0.1 },
          { key: 'plans_link',  label: 'Link to floor plan, photos or videos of the site', type: 'url', w: 'full', placeholder: 'Google Drive, Dropbox or similar link' },
          { key: 'site_features', label: 'What the site already has', type: 'chips', options: ['Truck / delivery access','Loading bay','Roof access for exhaust','Can exhaust through side wall','Floor drains','Grease trap','Existing exhaust hood','Epoxy / tiled floor','Staff changing area','Neighbors close by'] },
          { key: 'building_rules', label: 'Building or landlord restrictions', type: 'textarea', w: 'full', placeholder: 'e.g. no roof penetration, work hours only 8–5, no LPG tanks inside' }
        ]},
        { key: 'photos', title: 'Photos', hint: "Photos save us a visit's worth of questions. Take them with your phone — we shrink them before they upload. Up to 20 photos.", fields: [
          { key: 'photos', type: 'photos', groups: [
            { key: 'site',      label: 'Site / space',            hint: 'The room as it is today — walls, floor, ceiling, doors, windows' },
            { key: 'kitchen',   label: 'Existing kitchen',        hint: 'Your current cooking line, hoods, sinks, storage' },
            { key: 'equipment', label: 'Equipment',               hint: 'Overall shots and nameplates of equipment you want to reuse' },
            { key: 'docs',      label: 'Floor plan or documents', hint: 'A photo or screenshot of the plan, lease rules, permits or audit findings' }
          ]}
        ]},
        { key: 'utilities', title: 'Utilities', hint: 'Gas, power and water decide what equipment can run where. "Not sure" is fine.', fields: [
          { key: 'gas',         label: 'Gas supply',                 type: 'select', options: ['LPG cylinders (50 kg)','LPG bulk tank / manifold','Existing gas pipeline','None yet','Not sure'] },
          { key: 'gas_monthly', label: 'Current LPG use per month',  type: 'text', placeholder: 'e.g. 12 × 50 kg tanks' },
          { key: 'power',       label: 'Electrical supply',          type: 'select', options: ['Single-phase 220V','Three-phase','Not sure'] },
          { key: 'power_cap',   label: 'Available load (kVA / amps)',type: 'text', placeholder: 'If known' },
          { key: 'genset',      label: 'Backup generator',           type: 'select', options: ['Yes, covers whole kitchen','Yes, partial','No','Planning to add'] },
          { key: 'water',       label: 'Water supply',               type: 'select', options: ['Maynilad / Manila Water','Local water district','Deep well','Mixed / with storage tank','Not sure'] },
          { key: 'hot_water',   label: 'Hot water',                  type: 'select', w: 'full', options: ['Have a heater system','Need hot water','Not needed'] }
        ]},
        { key: 'logistics', title: 'Storage, receiving and dispatch', hint: "How food comes in, where it's kept, and how it leaves for your branches.", fields: [
          { key: 'deliveries',  label: 'Supplier deliveries',   type: 'select', options: ['Daily','2–3 times a week','Weekly','We buy from market ourselves'] },
          { key: 'dispatch',    label: 'Dispatch to branches',  type: 'select', options: ['Once a day','Twice a day','Every other day','Weekly'] },
          { key: 'chiller_cap', label: 'Chilled storage needed',type: 'text', placeholder: 'e.g. 2 tons or 20 racks' },
          { key: 'freezer_cap', label: 'Frozen storage needed', type: 'text', placeholder: 'e.g. 3 tons' },
          { key: 'dry_storage', label: 'Dry storage and packaging materials', type: 'text', w: 'full', placeholder: 'e.g. 50 sacks of rice, boxes, containers' },
          { key: 'transport',   label: 'How food is transported', type: 'text', w: 'full', placeholder: 'e.g. 2 reefer vans, insulated boxes on L300' }
        ]},
        { key: 'compliance', title: 'Permits and standards', hint: 'So the layout meets what inspectors and certifiers will check.', fields: [
          { key: 'compliance', label: 'Permits and standards you need to meet', type: 'chips', options: ['Sanitary permit',{ v: 'FDA LTO (food manufacturer)', l: 'FDA LTO' },{ v: 'BFP fire safety (FSIC)', l: 'BFP fire safety' },'HACCP','ISO 22000 / FSSC','Halal','DENR / LLDA wastewater',{ v: 'Mall / building admin standards', l: 'Mall / building standards' },'Not sure yet'] },
          { key: 'compliance_notes', label: 'Any audit findings or requirements we should know about?', type: 'textarea', w: 'full' }
        ]},
        { key: 'scope', title: 'Scope, timeline and budget', hint: "What you'd like Barro Industries to handle.", fields: [
          { key: 'scope', label: 'Scope of work', type: 'chips', options: [{ v: 'Kitchen layout and design', l: 'Layout and design' },{ v: 'Stainless steel fabrication', l: 'Stainless fabrication' },{ v: 'Cooking equipment supply', l: 'Cooking equipment' },'Exhaust hood and ducting',{ v: 'Fresh air / make-up air', l: 'Fresh air system' },{ v: 'LPG pipeline and manifold', l: 'LPG pipeline' },{ v: 'Cold room / walk-in', l: 'Cold rooms' },{ v: 'Installation and commissioning', l: 'Installation' },{ v: 'Preventive maintenance', l: 'Maintenance' }] },
          { key: 'target_date', label: 'Target opening date',     type: 'date' },
          { key: 'budget',      label: 'Budget range',            type: 'select', options: ['Below ₱1M','₱1M – ₱3M','₱3M – ₱5M','₱5M – ₱10M','Above ₱10M','Need guidance'] },
          { key: 'decision',    label: 'Who approves the project?', type: 'text', placeholder: 'Name and role' },
          { key: 'site_visit',  label: 'Preferred site visit schedule', type: 'text', placeholder: 'e.g. weekday mornings' },
          { key: 'notes',       label: 'Anything else we should know?', type: 'textarea', w: 'full' }
        ]}
      ],
      // keys the server copies into `summary` (must all be real field keys of this form)
      summaryKeys: { name: 'name', company: 'company', phone: 'phone', email: 'email', siteAddress: 'site_address', bizType: 'biz_type', budget: 'budget', targetDate: 'target_date' }
    }
  };

  return { FORMS: FORMS, PRIVACY_NOTICE: PRIVACY_NOTICE, LIMITS: LIMITS };
});
