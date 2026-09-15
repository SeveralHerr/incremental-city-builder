// The F8 ordering claims (docs/FEEDBACK.md F8, docs/feedback/2026-09-14-levers.md) against the
// SHIPPED content: core's two-segment buildingCost (api.js) read off the defs the buildings
// module resolves from data.js + config.cost (knee 75 / lateGrowth 1.112, hospital knee 60,
// ring / elevator lateGrowth 3). Boots the whole game (src/boot.js, DOM-free) in its own
// process so the shared registry never leaks into core.test.mjs's synthetic defs.
// Run: node src/core/cost-curve.test.mjs
//   • at count 200 the cheaper tier's next unit is never dearer than the top tier's in the same
//     column (house ≤ arcology, shop ≤ financial, factory ≤ techpark, coal ≤ nuclear, park ≤
//     stadium — the pairs the skeptic computed at 36× / 10× / 9.6× / 29× / 275× inverted on the
//     single segment);
//   • units affordable from zero at equal money are non-decreasing in tier inside every
//     category at the player's $1.3e11 and at the $1e18 ceiling (the playtest's "237 Financial
//     Districts but 202 Corner Shops" reading), the ×2 windmill (maxCount 8) and the ×3 tier-5
//     cards (ring, elevator: lateGrowth 3 by design, a fleet cap) excluded;
//   • the whole first city is untouched: below the knee every unit price equals the single
//     segment's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { boot, game } = await import(path.join(ROOT, 'src/boot.js').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
await boot();
const { api, registry, state, derived } = game;
const def = (id) => {
  const d = registry.buildings.get(id);
  assert.ok(d, `building ${id} registered`);
  return d;
};
// Undiscounted prices: no mods, no owned units.
derived.costMult = 1;
derived.mods = null;
for (const id of registry.buildingOrder) state.buildings[id] = 0;
const price = (id, count) => api.buildingCost(def(id), count, 1);
const fromZero = (id, money) => api.maxAffordable(def(id), money);
const EXCLUDED = new Set(['windmill', 'ring', 'elevator']);

test('F8: every shipped def carries the two-segment curve the plan names', () => {
  for (const id of registry.buildingOrder) {
    const d = def(id);
    assert.ok(Number.isInteger(d.knee) && d.knee >= 1, `${id} knee ${d.knee}`);
    assert.ok(Number.isFinite(d.lateGrowth) && d.lateGrowth >= 1, `${id} lateGrowth ${d.lateGrowth}`);
  }
  assert.equal(def('hospital').knee, 60);
  assert.equal(def('ring').lateGrowth, 3);
  assert.equal(def('elevator').lateGrowth, 3);
  for (const id of registry.buildingOrder) if (!EXCLUDED.has(id) && id !== 'hospital') assert.equal(def(id).knee, 75, `${id} knee`);
  for (const id of registry.buildingOrder) if (!EXCLUDED.has(id)) assert.equal(def(id).lateGrowth, 1.112, `${id} lateGrowth`);
});

test('F8: at count 200 the cheaper tier never overtakes the top tier in its column', () => {
  const pairs = [['house', 'arcology'], ['apartment', 'arcology'], ['tower', 'arcology'], ['shop', 'financial'], ['office', 'financial'], ['mall', 'financial'], ['factory', 'techpark'], ['refinery', 'techpark'], ['coal', 'nuclear'], ['solar', 'nuclear'], ['park', 'stadium'], ['school', 'stadium'], ['hospital', 'stadium']];
  for (const [lo, hi] of pairs) {
    for (const count of [150, 200, 300]) {
      const a = price(lo, count);
      const b = price(hi, count);
      assert.ok(a <= b, `${lo} #${count + 1} $${a.toExponential(3)} > ${hi} $${b.toExponential(3)}`);
    }
  }
});

test('F8: units affordable from zero are non-decreasing in tier inside every category', () => {
  const cats = new Map();
  for (const id of registry.buildingOrder) {
    if (EXCLUDED.has(id)) continue;
    const d = def(id);
    if (!cats.has(d.category)) cats.set(d.category, []);
    cats.get(d.category).push(d);
  }
  for (const money of [1.3e11, 1e14, 1e18]) {
    for (const [cat, defs] of cats) {
      defs.sort((a, b) => a.tier - b.tier || a.baseCost - b.baseCost);
      let prev = Infinity;
      let prevId = null;
      for (const d of defs) {
        const n = fromZero(d.id, money);
        assert.ok(n <= prev, `${cat} @ $${money.toExponential(1)}: ${d.id} buys ${n} > ${prevId} ${prev}`);
        prev = n;
        prevId = d.id;
      }
    }
  }
});

test('F8: below the knee every unit price is the single segment (the first city is untouched)', () => {
  for (const id of registry.buildingOrder) {
    const d = def(id);
    for (let i = 0; i <= d.knee; i++) {
      const single = d.baseCost * Math.pow(d.costGrowth, i);
      assert.ok(Math.abs(price(id, i) - single) <= 1e-9 * single, `${id} #${i + 1}`);
    }
    // ...and the first late unit is the knee price × lateGrowth.
    const first = d.baseCost * Math.pow(d.costGrowth, d.knee) * d.lateGrowth;
    assert.ok(Math.abs(price(id, d.knee + 1) - first) <= 1e-9 * first, `${id} #${d.knee + 2}`);
  }
});
