// tests/geo.test.mjs — geofencing math tests (Type-B self-service attendance)
//
// Guards js/geo-core.js: haversineMeters + siteMatch. Zero deps: node:test +
// node:assert only, same convention as tests/money.test.mjs. Run with:
//   node --test tests/

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const { haversineMeters, siteMatch } = require('../js/geo-core.js');

describe('haversineMeters', () => {
  it('matches the known equatorial one-degree-of-longitude distance (±0.5%)', () => {
    // Along the equator, 1° of longitude is a mathematically well-known
    // distance: (π/180) × R ≈ 111,194.9 m for R = 6,371,000 m mean Earth
    // radius — independent of this file's own implementation.
    const expected = (Math.PI / 180) * 6371000; // ≈ 111194.93 m
    const got = haversineMeters(0, 0, 0, 1);
    const pctErr = Math.abs(got - expected) / expected;
    assert.ok(pctErr <= 0.005, `expected ~${expected.toFixed(1)}m, got ${got.toFixed(1)}m (${(pctErr * 100).toFixed(3)}% off)`);
  });

  it('returns 0 for identical points', () => {
    assert.equal(haversineMeters(14.5995, 120.9842, 14.5995, 120.9842), 0);
  });

  it('is symmetric (distance A→B === distance B→A)', () => {
    const ab = haversineMeters(14.5995, 120.9842, 16.4023, 120.5960);
    const ba = haversineMeters(16.4023, 120.5960, 14.5995, 120.9842);
    assert.equal(ab, ba);
  });

  it('handles the antimeridian without a longitude-wrap blowup', () => {
    // Two points 0.2° of longitude apart straddling 180°/-180° — naive
    // (lng2-lng1) math would see a ~359.8° gap and report ~half the globe;
    // the true short-way-around distance is ~22km (same scale as the
    // one-degree reference above, since 0.2° ≈ 22.2km at the equator).
    const d = haversineMeters(0, 179.9, 0, -179.9);
    assert.ok(d > 20000 && d < 25000, `expected ~22km, got ${(d / 1000).toFixed(2)}km`);
  });

  // geo-core.js:44's defensive NaN-guard — exercised directly, since
  // siteMatch relies on this returning non-finite for malformed inputs
  // (exactly the failure mode an HR-entered geo_sites doc with a blank or
  // typo'd lat/lng would trigger).
  it('returns NaN when a coordinate is missing or a non-numeric typo', () => {
    assert.ok(Number.isNaN(haversineMeters(undefined, 120.9842, 14.5995, 120.9842)));
    assert.ok(Number.isNaN(haversineMeters(14.5995, 'not-a-number', 14.5995, 120.9842)));
    assert.ok(Number.isNaN(haversineMeters(NaN, 120.9842, 14.5995, 120.9842)));
    assert.ok(Number.isNaN(haversineMeters(14.5995, 120.9842, {}, 120.9842)));
  });

  it('accepts numeric strings (Number() coercion), unlike raw NaN inputs', () => {
    // parseFloat-free form fields sometimes hand this numeric strings —
    // Number(lat1)/Number(lng1) etc. should coerce these, not reject them.
    const got = haversineMeters('0', '0', '0', '1');
    assert.ok(Number.isFinite(got) && got > 0);
  });

  it('documents (not asserts as a bug) that blank-string/null coerce to 0, not NaN', () => {
    // Number('') === 0 and Number(null) === 0 are JS coercion quirks, not a
    // gap in this function — a blank lat/lng silently becomes a real (if
    // wildly wrong) coordinate rather than NaN. In practice this can't reach
    // geo_sites via the Work Sites admin form, which already requires
    // Number.isFinite(lat) && Number.isFinite(lng) before saving
    // (js/screens/hr.js openWorkSiteForm) — this test just pins the
    // underlying behavior so a future change here doesn't silently flip it.
    assert.equal(haversineMeters('', 120.9842, 14.5995, 120.9842), haversineMeters(0, 120.9842, 14.5995, 120.9842));
    assert.ok(Number.isFinite(haversineMeters(null, null, 14.5995, 120.9842)));
  });
});

describe('siteMatch', () => {
  const hq = { id: 'hq', name: 'HQ Site', lat: 14.5995, lng: 120.9842, radiusM: 150, active: true };

  it('reports inRange:false and nearest:null when there are no active sites', () => {
    const r = siteMatch({ lat: 14.5995, lng: 120.9842 }, []);
    assert.deepEqual(r, { inRange: false, nearest: null });
  });

  it('ignores inactive sites entirely', () => {
    const inactive = { ...hq, active: false };
    const r = siteMatch({ lat: 14.5995, lng: 120.9842 }, [inactive]);
    assert.equal(r.inRange, false);
    assert.equal(r.nearest, null);
  });

  it('radius edge — just inside is inRange:true', () => {
    // ~100m north of HQ (well under the 150m radius).
    const pos = { lat: 14.5995 + 100 / 111194.93, lng: 120.9842 };
    const r = siteMatch(pos, [hq]);
    assert.equal(r.inRange, true);
    assert.equal(r.nearest.siteId, 'hq');
    assert.ok(r.nearest.distanceM < 150);
  });

  it('radius edge — just outside is inRange:false but still reports nearest + distance', () => {
    // ~400m north of HQ (outside the 150m radius) — the exact scenario the
    // blocking UI needs ("You are 412m from HQ Site — move within 150m").
    const pos = { lat: 14.5995 + 400 / 111194.93, lng: 120.9842 };
    const r = siteMatch(pos, [hq]);
    assert.equal(r.inRange, false);
    assert.equal(r.nearest.siteId, 'hq');
    assert.ok(r.nearest.distanceM > 350 && r.nearest.distanceM < 450);
  });

  it('multiple in-range sites — nearest of the valid ones wins', () => {
    // Two overlapping geofences around the same spot; the worker sits ~30m
    // from siteA (radius 150, so in-range) and ~10m from siteB (radius 50,
    // also in-range). Nearest-wins must return siteB, the closer valid match.
    const siteA = { id: 'a', name: 'Wide Gate', lat: 14.5995, lng: 120.9842, radiusM: 150, active: true };
    const siteB = { id: 'b', name: 'Tight Gate', lat: 14.5995 + 10 / 111194.93, lng: 120.9842, radiusM: 50, active: true };
    const pos = { lat: 14.5995 + 12 / 111194.93, lng: 120.9842 }; // ~12m from A's center path, ~2m from B
    const r = siteMatch(pos, [siteA, siteB]);
    assert.equal(r.inRange, true);
    assert.equal(r.nearest.siteId, 'b');
  });

  it('out of range of all sites — nearest overall (by raw distance) is still reported', () => {
    // siteC is physically closest (500m) but its own radius (50m) excludes
    // it; siteD is farther (2000m) with a bigger radius (100m) that still
    // doesn't reach. Neither is in range, so nearest must be the globally
    // closest (siteC), not whichever has the bigger radius.
    const siteC = { id: 'c', name: 'Near but tight', lat: 14.5995 + 500 / 111194.93, lng: 120.9842, radiusM: 50, active: true };
    const siteD = { id: 'd', name: 'Far but wide', lat: 14.5995 + 2000 / 111194.93, lng: 120.9842, radiusM: 100, active: true };
    const pos = { lat: 14.5995, lng: 120.9842 };
    const r = siteMatch(pos, [siteC, siteD]);
    assert.equal(r.inRange, false);
    assert.equal(r.nearest.siteId, 'c');
    assert.ok(r.nearest.distanceM > 450 && r.nearest.distanceM < 550);
  });

  it('radius boundary — distanceM === radiusM EXACTLY is inRange:true (siteMatch uses inclusive <=)', () => {
    // Derive the site's radiusM from haversineMeters itself (rather than a
    // hardcoded round number) so distanceM and radiusM are the exact same
    // float — the only way to genuinely exercise the <= boundary instead of
    // landing just inside/outside it due to floating-point rounding.
    const pos = { lat: 14.6100, lng: 120.9900 };
    const exactDistance = haversineMeters(hq.lat, hq.lng, pos.lat, pos.lng);
    const boundarySite = { ...hq, id: 'boundary', radiusM: exactDistance };
    const r = siteMatch(pos, [boundarySite]);
    assert.equal(r.inRange, true, `distanceM (${exactDistance}) === radiusM should be inRange`);
    assert.equal(r.nearest.siteId, 'boundary');
  });

  it('a malformed site (missing/typo\'d lat or lng) is excluded, not crashed on', () => {
    // geo-core.js:70's isFinite filter — this is the realistic failure mode
    // an HR-entered geo_sites doc invites (a typo'd coordinate, or a doc
    // missing the field entirely — e.g. a manual Firestore console edit;
    // the Work Sites admin form itself already blocks blank lat/lng at save
    // time, see js/screens/hr.js openWorkSiteForm).
    const typoLat = { id: 'bad1', name: 'Typo Lat', lat: 'fourteen', lng: 120.9842, radiusM: 150, active: true };
    const typoLng = { id: 'bad2', name: 'Typo Lng', lat: 14.5995, lng: 'onetwenty', radiusM: 150, active: true };
    const missingBoth = { id: 'bad3', name: 'Missing Both', radiusM: 150, active: true };
    const pos = { lat: 14.5995, lng: 120.9842 };

    // All-malformed: no valid site to match against at all.
    const rAllBad = siteMatch(pos, [typoLat, typoLng, missingBoth]);
    assert.deepEqual(rAllBad, { inRange: false, nearest: null });

    // Mixed: the one well-formed site (hq) still matches normally even
    // though its malformed siblings are silently dropped, not thrown on.
    const rMixed = siteMatch(pos, [typoLat, hq, typoLng, missingBoth]);
    assert.equal(rMixed.inRange, true);
    assert.equal(rMixed.nearest.siteId, 'hq');
  });
});
