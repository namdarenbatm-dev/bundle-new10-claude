'use strict';
/* Property/fuzz test: core.js is checked against an independent BigInt oracle written from the spec,
 * using a seeded PRNG so failures are reproducible. */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ri = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

function oracle(s, P, D) {
  const [base, floor, mk, cost, dp, fp] = [s.posBase, s.posFloor, s.marketing, s.driverCost, s.driverPrice, s.driverProfit].map(BigInt);
  const p = BigInt(P), d = BigInt(D);
  if (d < 1n || p <= d) return null;
  const contribution = dp - cost - fp;
  const bundleBase = base + mk;                // "bundle POS price" = approved price + marketing
  const budget = d * contribution;             // marketing is not deducted from the discount budget
  if (budget < 0n) return null;
  let disc = budget / p;                       // BigInt division floors for non-negative values
  if (disc > bundleBase - floor) disc = bundleBase - floor;
  const price = bundleBase - disc;
  return { contribution, bundleBase, budget, price, totalDiscount: disc * p, remaining: budget - disc * p, total: p * price + d * dp };
}

test('fuzz: 4000 random configurations agree with the BigInt oracle', () => {
  const r = rng(20261029);
  let checked = 0, valid = 0;
  for (let i = 0; i < 4000; i++) {
    const base = ri(r, 1, 60) * ri(r, 1, 1000000);
    const floor = ri(r, 1, base);
    const cost = ri(r, 0, 80000000);
    const profit = ri(r, 0, 20000000);
    const s = {
      driverType: 'cashless', posBase: base, posFloor: floor, marketing: ri(r, 0, 4000000),
      driverCost: cost, driverPrice: cost + profit + ri(r, -2000000, 40000000), driverProfit: profit,
      maxPos: ri(r, 2, 14), maxDriver: ri(r, 1, 8), maxUpgrade: ri(r, 0, 20000000)
    };
    if (s.driverPrice <= 0) continue;
    const settingsOk = C.validateSettings(s).length === 0;
    for (let P = 0; P <= 16; P++) {
      for (let D = 0; D <= 9; D++) {
        const got = C.evaluateBundle(s, P, D);
        const inLimits = P >= 2 && P <= s.maxPos && D >= 1 && D <= s.maxDriver;
        const exp = settingsOk && inLimits ? oracle(s, P, D) : null;
        checked++;
        if (!exp) { assert.equal(got.valid, false, JSON.stringify([s, P, D])); continue; }
        valid++;
        assert.equal(got.valid, true, JSON.stringify([s, P, D, got.errors]));
        for (const k of ['contribution', 'bundleBase', 'budget', 'totalDiscount', 'remaining', 'total']) assert.equal(BigInt(got[k]), exp[k], k + ' ' + JSON.stringify([s, P, D]));
        assert.equal(BigInt(got.posPrice), exp.price);
        // spec invariants
        assert.ok(got.posPrice >= s.posFloor && got.posPrice <= s.posBase + s.marketing);
        assert.ok(got.totalDiscount <= got.budget);
        assert.ok(got.budget === got.driverContributionTotal);
        assert.ok(got.posQty > got.driverQty && got.driverQty >= 1);
      }
    }
    const list = C.generateBundles(s);
    const expectedCount = settingsOk ? [...Array(s.maxPos + 1).keys()].reduce((n, P) => n + [...Array(Math.min(s.maxDriver, P - 1) + 1).keys()].filter((D) => D >= 1 && oracle(s, P, D)).length, 0) : 0;
    assert.equal(list.length, expectedCount, 'bundle count ' + JSON.stringify(s));
  }
  assert.ok(valid > 5000, 'fuzz exercised enough valid bundles: ' + valid + ' of ' + checked);
});

test('fuzz: broker recommendation never exceeds budget/cap and is optimal by the stated rule', () => {
  const r = rng(77);
  for (let i = 0; i < 300; i++) {
    const s = Object.assign({}, C.DEFAULT_SETTINGS, { maxUpgrade: ri(r, 0, 30000000), maxPos: ri(r, 3, 12), maxDriver: ri(r, 1, 6) });
    const all = C.generateBundles(s);
    const published = all.filter(() => r() < 0.6);
    const budget = ri(r, 0, 500000000);
    const res = C.recommend(published, budget, s.maxUpgrade, C.DEFAULT_PRIORITIES);
    const affordable = published.filter((b) => b.total <= budget);
    if (affordable.length) {
      assert.ok(res.main && res.main.total <= budget);
      const best = affordable.reduce((m, b) => (b.posQty > m.posQty || (b.posQty === m.posQty && b.posPrice < m.posPrice) ? b : m));
      assert.equal(res.main.posQty, best.posQty);
      assert.equal(res.main.posPrice, best.posPrice);
    } else assert.equal(res.main, null);
    if (res.upgrade) {
      assert.ok(res.upgrade.total > budget && res.upgrade.total - budget <= s.maxUpgrade);
      assert.ok(published.includes(res.upgrade), 'upgrade must be published');
      if (res.main) assert.ok(res.upgrade.posQty > res.main.posQty || (res.upgrade.posQty === res.main.posQty && res.upgrade.posPrice < res.main.posPrice && res.upgrade.driverQty <= res.main.driverQty));
    }
  }
});

test('boundary: amounts at the safe-integer edge are rejected, not silently mangled', () => {
  const s = Object.assign({}, C.DEFAULT_SETTINGS, { posBase: C.MAX_MONEY, posFloor: C.MAX_MONEY, driverPrice: C.MAX_MONEY, driverCost: 0, driverProfit: 0, maxPos: 100, maxDriver: 99 });
  assert.equal(C.validateSettings(s).length, 0);
  const b = C.evaluateBundle(s, 100, 99);
  assert.ok(Number.isSafeInteger(b.total), 'total stays a safe integer at the documented maximum');
  assert.ok(C.validateSettings(Object.assign({}, s, { posBase: C.MAX_MONEY + 1 })).length > 0);
  assert.ok(Number.isNaN(C.parseAmount('9007199254740993')));
});
