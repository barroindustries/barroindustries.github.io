'use strict';
/**
 * catalogue-cards.js — the WORDS on the public catalogue cards (owner rulings 2026-11-19): every card is plain text — its name, ONE line of
 * description and three to five short feature bullets. No complete specification, no notes block, no image. This file holds those words and
 * nothing else: scripts/build-catalogue.js reads it (CARD_COPY, PROJECT_CARDS) and the build REFUSES a card that has no entry here, so a new
 * product forces a deliberate wording.
 *
 * What may go in a line: only what the owner already says publicly or what the private master/family definition states about the product
 * (an option the configurator really offers, a capacity the master carries). No amount of money, and none of the words the money guard knows
 * (price, pricing, cost, markup): the build scans every string here with the same guards as the rest of the page. The starting amounts live in
 * scripts/public-from-prices.json, never here.
 *
 * Keys: a configurable family id (scripts/public-families.json), or a fixed product id (the master's, e.g. "CE-030").
 */

// A short line is a clause, not a sentence: no trailing full stop.
const CARD_COPY = Object.freeze({
  // ── configurable families ────────────────────────────────────────────────────────────────────────────────────────────────────
  prep_table: {
    desc: 'Stainless steel work table made to your size.',
    features: ['One, two or three layers', 'Up to two upper shelves', 'Made to your length, width and height', 'Food-grade SS304, SS316 on request'],
  },
  sink: {
    desc: 'Stainless steel sink table with one to four sinks.',
    features: ['One to four sinks, placed left, centre or right', 'Optional undershelf and upper shelf', 'Gooseneck or pre-rinse spray faucet', 'Made to your length, width and height'],
  },
  dish_table: {
    desc: 'Stainless steel dish table for the dishwasher.',
    features: ['Clean or soiled side', 'Dishwasher on the left or the right', 'Optional pre-rinse sink with spray faucet', 'Optional undershelf'],
  },
  stove: {
    desc: 'Gas range built to your layout.',
    features: ['Choose each burner position one by one', 'Wok, high-pressure, low-pressure or soup burners', 'Add a griller, griddle, oven or fryer', 'Made to your size'],
  },
  wok_range: {
    desc: 'Gas wok range with high-pressure burners.',
    features: ['One to three wok holes', 'Optional rear stock burner', 'Optional swan-neck water faucet', 'Made to your size'],
  },
  cooking_line: {
    desc: 'Griddle, lava-rock griller or fryer on its own stand.',
    features: ['Griddle, lava-rock griller, fryer or griller-and-griddle', 'One to three burners', 'One to three fry baskets on a fryer', 'Open stand or stand with bottom shelf'],
  },
  deck_oven: {
    desc: 'Gas-fired deck oven for bakeries.',
    features: ['One to three decks', 'Three or six trays per deck', 'Optional heavy-duty stand'],
  },
  hood: {
    desc: 'Stainless steel kitchen exhaust hood.',
    features: ['Wall, island or slim low-profile canopy', 'Baffle grease filters', 'Optional lamp and switch', 'Made to your length and depth'],
  },
  cabinet: {
    desc: 'Stainless steel storage cabinet, floor-standing or wall-hung.',
    features: ['Floor-standing or wall-hung', 'Swing or sliding doors', 'One to three shelves inside', 'Made to your size'],
  },
  wall_shelf: {
    desc: 'Stainless steel shelving fixed to the wall.',
    features: ['One to three tiers', 'Solid or slotted surface', 'Made to your length and depth'],
  },
  rack: {
    desc: 'Stainless steel dish and storage rack.',
    features: ['Three to six tiers', 'With or without wheels', 'Made to your size'],
  },

  // ── fixed products (ready-made items; "Add to quote") ──────────────────────────────────────────────────────────────────────
  'CE-030': { desc: 'Salamander broiler for finishing dishes.', features: ['Broiler heat from above', 'For browning, finishing and melting toppings', 'Sits at the end of your cooking line'] },
  'CE-011': { desc: 'Gas rice steamer for volume cooking.', features: ['Gas-fired', 'Six-tray capacity', 'Stainless steel body'] },
  'CE-024': { desc: 'Display warmer that keeps cooked food hot.', features: ['Three shelves', 'Stainless steel', 'Horizontal layout available'] },
  'CE-031': { desc: 'Electric heater for the spoon and fork holder.', features: ['Electric', 'Four-hole holder and heater', 'Stainless steel'] },
  'MS-015': { desc: 'Industrial meat grinder in stainless steel.', features: ['Stainless steel worm and blade', 'Handles 220 kg per hour', '900 W motor, 110 to 240 V'] },
  'MS-016': { desc: 'Industrial meat slicer in stainless steel.', features: ['Stainless steel', 'Handles 150 kg per hour', '3 mm slicing thickness', '850 W motor'] },
  'BA-006': { desc: 'Insulated dough proofing cabinet for bakeries.', features: ['Sixteen trays', 'Insulated SS304, double-wall body', 'Magnetic gasket door', 'Thermostat and humidity tray', 'Electric heating element'] },
  'BA-011': { desc: 'Twin-door proofer-retarder cabinet.', features: ['Retard, then proof, from digital controls', 'Insulated SS304, double-wall body', 'Twin doors, two sixteen-tray sections'] },
  'RF-001': { desc: 'Water-jacket pasteuriser in food-grade stainless steel.', features: ['Food-grade SS304', 'Double-layer water jacket', '10 litre capacity', 'Heats from 60 to 95 °C'] },
  'RF-002': { desc: 'Single-door display chiller.', features: ['Full glass display', 'Double-layer glass door', '420 litre capacity', 'Fan-assisted cooling'] },
  'RF-003': { desc: 'Undercounter freezer in a stainless steel body.', features: ['Holds −12 to −18 °C', 'Stainless steel body', 'Digital LED controller', 'Fan cooling, copper condenser and evaporator'] },
  'RF-004': { desc: 'Undercounter chiller, specified for your counter.', features: ['Fits under the counter', 'Chilled storage', 'Specification confirmed with you per project'] },
  'RF-005': { desc: 'Cake chiller for bakeries and cafés.', features: ['Keeps cakes chilled', 'For bakeries and cafés', 'Specification confirmed with you per project'] },
  'RF-006': { desc: 'Underbar chiller for drinks.', features: ['Fits under the bar counter', 'Chilled storage for drinks', 'Specification confirmed with you per project'] },
});

// Cards that have no ready-made SKU or configurator in the quote flow (yet): the page shows them like any card, but their button is a plain
// link to the "Request a quote" section instead of "Add to quote" / "Configure & add", so nothing the server does not know can be added to a
// quote. `group` is the public category id the card sits in (scripts/build-catalogue.js PUBLIC_CATEGORIES); `learn` is an optional link.
const PROJECT_CARDS = Object.freeze([
  {
    id: 'station', group: 'station', name: 'Multi-purpose kitchen station', tag: 'Made to order',
    desc: 'A stainless steel station built around your layout and the work it has to do.',
    features: ['Stainless steel construction', 'Made to your size and layout', 'Configuration agreed with you per project'],
  },
  {
    id: 'exhaust', group: 'exhaust', photo: 'EX-004', name: 'Exhaust and fresh-air ventilation', tag: 'Per project',
    desc: 'Ducting, blowers and fresh air planned together with your range hood.',
    features: ['Exhaust ducting and fittings', 'Inline blowers', 'Fresh-air supply for the kitchen', 'Designed around your hood and your layout'],
    learn: { path: '/services/exhaust-and-fresh-air-systems/', about: 'exhaust and fresh-air systems' },
  },
  {
    id: 'trolley', group: 'storage', photo: 'PW-034', name: 'Trolleys', tag: 'Made to order',
    desc: 'Stainless steel trolleys for trays, pans and dishes.',
    features: ['Stainless steel construction', 'Caster wheels', 'Tray-slide trolleys and bakery pan-rack trolleys', 'Size and tray capacity agreed with you'],
  },
]);

module.exports = { CARD_COPY, PROJECT_CARDS };
