// ═══════════════════════════════════════════════════════════
//  js/geo-core.js — pure geofencing math (Type-B self-service attendance)
//  No DOM, no Firebase, no side effects. Same "window globals" convention as
//  js/money-core.js (see that file's header) — loaded as a plain <script> in
//  index.html, and require()-able from tests/geo.test.mjs via the UMD-ish
//  shim below.
//
//  window.haversineMeters(lat1,lng1,lat2,lng2) — great-circle distance in
//    meters between two lat/lng points (WGS-84 mean radius, good enough for
//    a factory-gate-scale geofence; not surveying-grade).
//
//  window.siteMatch(pos, sites) — given the worker's current position and
//    the list of admin-defined Work Sites, decide whether Time In is valid.
//
//    pos:   { lat, lng }
//    sites: [{ id, name, lat, lng, radiusM, active }, ...]
//    returns: { inRange: boolean, nearest: { siteId, name, distanceM } | null }
//
//  DESIGN DECISION (nearest-site semantics) — read before changing:
//  Only `active` sites are considered; inactive sites are invisible to the
//  matcher entirely (never chosen as "nearest", never gate a Time In).
//    1. Compute distance to every active site.
//    2. If the worker is inside the radius of ONE OR MORE sites, `inRange`
//       is true and `nearest` is the CLOSEST of those in-range sites (this
//       is the "multiple sites — nearest wins" rule: if two site geofences
//       overlap, the tighter/closer one is reported, not an arbitrary one).
//    3. If the worker is inside NO site's radius, `inRange` is false and
//       `nearest` is still populated with the globally closest active site
//       (by raw distance, ignoring its radius) — this is what powers the
//       blocking UI ("You are 412m from Carlatan Site — move within 150m").
//    4. Zero active sites → { inRange:false, nearest:null }.
// ═══════════════════════════════════════════════════════════

if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

// Mean Earth radius (meters) — same constant convention as most consumer geo
// libraries (WGS-84 authalic mean radius, ~6371km).
var GEO_EARTH_RADIUS_M = 6371000;

window.haversineMeters = function haversineMeters(lat1, lng1, lat2, lng2) {
  lat1 = Number(lat1); lng1 = Number(lng1); lat2 = Number(lat2); lng2 = Number(lng2);
  if ([lat1, lng1, lat2, lng2].some(function (n) { return !Number.isFinite(n); })) return NaN;
  var toRad = function (d) { return (d * Math.PI) / 180; };
  var dLat = toRad(lat2 - lat1);
  // Longitude difference wraps correctly through the antimeridian on its own:
  // e.g. 179.9° → -179.9° gives dLng = -359.8°, but sin(toRad(dLng/2)) is
  // periodic (sin(-179.9°) ≈ sin(0.1°)), so the haversine formula naturally
  // returns the short way around without any extra normalization here.
  var dLng = toRad(lng2 - lng1);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return GEO_EARTH_RADIUS_M * c;
};

window.siteMatch = function siteMatch(pos, sites) {
  var active = (Array.isArray(sites) ? sites : []).filter(function (s) { return s && s.active; });
  if (!pos || !active.length) return { inRange: false, nearest: null };

  var withDistance = active.map(function (s) {
    return {
      siteId: s.id,
      name: s.name || '',
      distanceM: window.haversineMeters(pos.lat, pos.lng, s.lat, s.lng),
      radiusM: Number(s.radiusM) || 0
    };
  }).filter(function (s) { return Number.isFinite(s.distanceM); });

  if (!withDistance.length) return { inRange: false, nearest: null };

  var inRangeSites = withDistance.filter(function (s) { return s.distanceM <= s.radiusM; });
  var pool = inRangeSites.length ? inRangeSites : withDistance;
  var nearest = pool.reduce(function (best, s) { return (!best || s.distanceM < best.distanceM) ? s : best; }, null);

  return {
    inRange: inRangeSites.length > 0,
    nearest: nearest ? { siteId: nearest.siteId, name: nearest.name, distanceM: nearest.distanceM } : null
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    haversineMeters: window.haversineMeters,
    siteMatch: window.siteMatch
  };
}
