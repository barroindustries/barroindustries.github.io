'use strict';
/**
 * catalogue-cards.js — the WORDS on the public catalogue cards. Owner rulings 2026-11-19, as set out in "Barro Kitchens – Website Notes (Nov 19, 2026)" (they supersede the
 * earlier "name, one line and feature bullets only" ruling): a card is plain text — its name, an optional product CODE on its own small line, ONE sentence on what the product
 * is for (`desc`), an optional "Standard size" line (`size`), three or four short key specs (`specs`: material, size and the main feature), an optional "Options" line
 * (`options`) — then the price line and the button. No panel gauges, no part lists, no costs, no hype words. Short plain
 * sentences, millimetres, SS304. A number never carries a thousands comma (1200, not 1,200: the money scan would refuse it). This file holds those words and nothing else:
 * scripts/build-catalogue.js reads it (CARD_COPY, PROJECT_CARDS) and the build REFUSES a card that has no entry here, so a new product forces a deliberate wording.
 *
 * What may go in a line: only what the owner already says publicly or what the private master/family definition states about the product. No amount of money, and none of
 * the words the money guard knows (price, pricing, cost, markup): the build scans every string here (code, size and options included) with the same guards as the rest of
 * the page. The starting amounts live in scripts/public-from-prices.json, never here.
 *
 * Keys of an entry: desc (required), specs (3 to 4, each at most 70 characters), code (optional: only where the price list has one), size (optional), options (optional),
 * featured (a configurable family only: adds the "Featured" tag beside "Configurable"). Keys of CARD_COPY: a configurable family id (scripts/public-families.json), or a
 * fixed product id (the master's, e.g. "CE-030"). A PROJECT card carries the same keys inline, plus id, group, name, tag, an optional `first` (placed before the
 * configurable cards of its group), `learn`, `image`.
 */

// A short line is a clause, not a sentence: no trailing full stop.
const CARD_COPY = Object.freeze({
  // ── configurable families ────────────────────────────────────────────────────────────────────────────────────────────────────
  prep_table: {
    code: 'PS-PT-900', desc: 'Stainless steel work table for food preparation.',
    size: '900 × 600 × 850 mm',
    specs: ['SS304 stainless steel', 'Top and undershelf', 'Square-tube legs with adjustable bullet feet'],
    options: 'Lengths up to 1800 mm, up to two upper shelves, backsplash, SS316 on request',
  },
  sink: {
    code: 'WS-SK1-600', desc: 'Sink table for washing, sized for your workflow and plumbing.',
    size: '600 × 600 × 850 mm',
    specs: ['SS304 stainless steel', '150 mm backsplash', 'Gooseneck faucet and strainer included'],
    options: 'One to four bowls, drainboard, undershelf and upper shelf, pre-rinse spray faucet',
  },
  dish_table: {
    desc: 'Dish table that feeds your dishwasher.',
    specs: ['SS304 stainless steel', 'Clean or soiled side', 'Dishwasher on the left or the right'],
    options: 'Pre-rinse sink with spray faucet, undershelf, your length',
  },
  hood: {
    code: 'VN-HD-1200', featured: true, desc: 'Rear-pitch range hood that pulls smoke and grease back, away from the cook.',
    size: '1200 × 900 × 500 mm',
    specs: ['SS304 stainless steel', 'Baffle filters', 'Lamp and oil cup'],
    options: 'Lengths 1.2 to 3.0 m, wall or island canopy',
  },
  stove: {
    code: 'CK-LP-2', desc: 'Chef Mode gas stove; every module shares one depth and height, so the line stays even.',
    size: '750 mm deep, 850 mm high',
    specs: ['SS304 top with 150 mm backsplash', 'Pilot and ball valves', 'Low- or high-pressure burners'],
    options: '2, 4 or 6 burners, oven below',
  },
  wok_range: {
    code: 'CK-WK-1', desc: 'Chef Mode wok stove for high-heat wok cooking.',
    size: '600 × 750 × 850 mm',
    specs: ['SS304 stainless steel', 'Ransome burner with pilot', 'Faucet and drain trough'],
    options: '1 to 3 holes, rear stock burner',
  },
  cooking_line: {
    code: 'CK-GD-600', desc: 'Chef Mode griddle, fryer or lava-rock griller on its own stand.',
    size: '600 × 750 × 850 mm',
    specs: ['12 mm griddle plate', 'Grease trough and drawer', 'Same depth and height as the cooking line'],
    options: 'Griddle 600 or 900 mm, fryer with 1 or 2 vats, lava-rock griller',
  },
  cabinet: {
    code: 'PS-CBW-900', desc: 'Stainless steel storage cabinet, floor-standing or wall-hung.',
    size: '900 × 350 × 600 mm',
    specs: ['SS304 stainless steel', 'Hinged doors', 'Shelf inside'],
    options: 'Floor or wall, 900 to 1500 mm, swing or sliding doors',
  },
  wall_shelf: {
    code: 'PS-RKW-1200', desc: 'Wall shelving for pans, plates and dry goods.',
    size: '1200 × 300 mm',
    specs: ['SS304 stainless steel', 'Two layers', 'Stainless brackets'],
    options: 'One to three tiers, solid or slotted',
  },
  rack: {
    code: 'PS-RK-900', desc: 'Storage rack for dry goods and dishes.',
    size: '900 × 500 × 1800 mm',
    specs: ['SS304 stainless steel', 'Four solid shelves', 'Square posts with adjustable feet'],
    options: 'Lengths up to 1500 mm, slotted shelves, wheels',
  },

  // ── fixed products (ready-made items; "Add to quote"): a code only where the price list has one, no size and no options line unless the notes give one ──
  'CE-030': { code: 'CK-SL', desc: 'Salamander broiler for finishing dishes.', size: '660 × 400 × 400 mm', specs: ['Infrared burner', 'Auto igniter', 'Catch tray and wall shelf'] },
  'CE-011': { code: 'CK-RS-6', desc: 'Gas rice steamer for volume cooking.', specs: ['Gas-fired', 'Six trays', 'SS304 stainless steel'], options: '12-tray model' },
  'CE-024': { desc: 'Display warmer that keeps cooked food hot.', specs: ['Three shelves', 'Stainless steel', 'Horizontal layout available'] },
  'CE-031': { desc: 'Electric heater for the spoon and fork holder.', specs: ['Electric', 'Four-hole holder and heater', 'Stainless steel'] },
  'MS-015': { desc: 'Industrial meat grinder in stainless steel.', specs: ['Stainless steel worm and blade', 'Handles 220 kg per hour', '900 W motor, 110 to 240 V'] },
  'MS-016': { desc: 'Industrial meat slicer in stainless steel.', specs: ['Stainless steel', 'Handles 150 kg per hour', '3 mm slicing thickness', '850 W motor'] },
  'BA-006': { desc: 'Insulated dough proofing cabinet for bakeries.', specs: ['Sixteen trays', 'Insulated SS304, double-wall body', 'Magnetic gasket door', 'Thermostat and humidity tray'] },
  'BA-011': { desc: 'Twin-door proofer-retarder cabinet.', specs: ['Retard, then proof, from digital controls', 'Insulated SS304, double-wall body', 'Twin doors, two sixteen-tray sections'] },
  'RF-001': { desc: 'Water-jacket pasteuriser in food-grade stainless steel.', specs: ['Food-grade SS304', 'Double-layer water jacket', '10 litre capacity', 'Heats from 60 to 95 °C'] },
  'RF-002': { desc: 'Single-door display chiller.', specs: ['Full glass display', 'Double-layer glass door', '420 litre capacity', 'Fan-assisted cooling'] },
  'RF-003': { desc: 'Undercounter freezer in a stainless steel body.', specs: ['Holds −12 to −18 °C', 'Stainless steel body', 'Digital LED controller', 'Fan cooling, copper condenser and evaporator'] },
  'RF-004': { desc: 'Undercounter chiller, specified for your counter.', specs: ['Fits under the counter', 'Chilled storage', 'Specification confirmed with you per project'] },
  'RF-005': { desc: 'Cake chiller for bakeries and cafés.', specs: ['Keeps cakes chilled', 'For bakeries and cafés', 'Specification confirmed with you per project'] },
  'RF-006': { desc: 'Underbar chiller for drinks.', specs: ['Fits under the bar counter', 'Chilled storage for drinks', 'Specification confirmed with you per project'] },
});

// Cards that have no ready-made SKU or configurator in the quote flow (yet): the page shows them like any card, but their button is a plain
// link to the "Request a quote" section instead of "Add to quote" / "Configure & add", so nothing the server does not know can be added to a
// quote. `group` is the public category id the card sits in (scripts/build-catalogue.js PUBLIC_CATEGORIES); `learn` is an optional link; `first` puts the card
// before the configurable cards of its group (the three featured hero products). Their starting amounts are in scripts/public-from-prices.json.
const PROJECT_CARDS = Object.freeze([
  {
    id: 'station', group: 'station', image: 'site/img/products/render-20-commercial-station-244-four-cabinets.webp', name: 'Multi-purpose kitchen station', tag: 'Made to order',
    desc: 'Multi-purpose kitchen station built around your layout.',
    size: 'Built to your layout',
    specs: ['SS304 stainless steel', 'Cabinets, drawers, sink and open bays in one run', 'Worktop with backsplash'],
    options: 'Layout, length and modules agreed with you',
  },
  {
    id: 'exhaust', group: 'exhaust', image: 'site/img/products/render-74-exhaust-and-fresh-air-cutaway.webp', name: 'Exhaust and fresh-air ventilation', tag: 'Per project',
    desc: 'Exhaust and fresh-air system, designed and installed by our team.',
    size: 'Designed per kitchen',
    specs: ['Exhaust ducting and blowers', 'Fresh-air supply and ceiling diffusers', 'Designed around your hood'],
    options: 'Black-iron grease duct, insulated fresh-air duct',
    learn: { path: '/services/exhaust-and-fresh-air-systems/', about: 'exhaust and fresh-air systems' },
  },
  // the three featured hero products come FIRST in the Chef Mode group
  {
    id: 'pugon', group: 'cooking', first: true, code: 'BK-PG-1', name: 'Pugon pandesal oven', tag: 'Featured',
    desc: 'Steel deck oven built for pandesal and everyday bread.',
    size: '4 trays of 40 × 60 cm per deck',
    specs: ['SS304 interior, insulated body', 'H-type burner with needle valve and gauge', 'Counterweighted door that stays where you put it'],
    options: '1 deck (4 trays) or 2 decks (8 trays)',
    learn: { path: '/products/pugon-pandesal-oven/', about: 'the Pugon pandesal oven' },
  },
  {
    id: 'teppanyaki', group: 'cooking', first: true, code: 'CK-TP-900', name: 'Teppanyaki grill', tag: 'Featured',
    desc: 'Flat-plate grill with even heat across the whole surface.',
    size: '900 × 750 × 850 mm',
    specs: ['12 mm cooking plate', 'Grease trough and drawer', '150 mm backsplash'],
    options: '900 or 1200 mm wide',
    learn: { path: '/products/teppanyaki-grill/', about: 'the teppanyaki grill' },
  },
  {
    id: 'inasal', group: 'cooking', first: true, code: 'GR-CH-900', name: 'Inasal charcoal grill', tag: 'Featured',
    desc: 'Charcoal grill built for chicken inasal.',
    size: '900 mm long',
    specs: ['5/16 in stainless grill bars', 'Pull-out charcoal bin', 'Stainless frame with adjustable feet'],
    options: '900, 1200 or 1500 mm long',
    learn: { path: '/products/inasal-charcoal-grill/', about: 'the inasal charcoal grill' },
  },
  {
    id: 'noodle_boiler', group: 'cooking', code: 'CK-NB-6', name: 'Noodle boiler', tag: 'Chef Mode',
    desc: 'Chef Mode noodle boiler for volume noodle service.',
    specs: ['Six cooking baskets', 'Gas-fired', 'SS304 stainless steel'],
    options: 'With or without baskets',
  },
  {
    id: 'combi_stove', group: 'cooking', code: 'CK-CB-1800', name: 'Combi stove', tag: 'Chef Mode',
    desc: 'Chef Mode combi stove: two burners, a griddle and a fryer on one top.',
    size: '1800 mm wide',
    specs: ['Oven under the burners', 'One top, one gas line', 'SS304 stainless steel'],
  },
  {
    id: 'trolley', group: 'storage', code: 'PS-TR-UT', name: 'Trolleys', tag: 'Made to order',
    desc: 'Stainless steel trolley for trays, pans and dishes.',
    size: '900 × 500 × 900 mm',
    specs: ['SS304 stainless steel', 'Two shelves', '4-inch castors'],
    options: 'Food-service, dish-collection or tray-rack trolley',
  },
]);

module.exports = { CARD_COPY, PROJECT_CARDS };
