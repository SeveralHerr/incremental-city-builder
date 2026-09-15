// Unit tests for src/core. Run: node --test src/core/core.test.mjs
// Pins the edge-case code that regresses silently: maxAffordable's closed form + float walk-back,
// buildingCost vs a manual loop, the sell refund ratio, the floor-everywhere number formatting,
// loadState/sanitize against hostile input, guard disable semantics (consecutive AND intermittent
// throwers), error-ring dedupe, event-listener isolation, registry validation and the loop's
// Node fallback / skippedMs handling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, derived, errors, loadState, resetState, sanitize, createInitialState, MAX_COUNT } from './state.js';
import { registry, registerBuilding, registerUpgrade, registerTickHandler, registerAction, resetGuards } from './registry.js';
import { api, buildingCost, buildingCap, sellRefund, maxAffordable, buy, sell, buildings, upgrades } from './api.js';
import { fmt, fmtMoney, fmtRate, fmtInt, fmtPct } from './format.js';
import { guard, reportError, DISABLE_AFTER, DISABLE_AFTER_TOTAL, WINDOW } from './safe.js';
import { on, off, emit, isListenerDisabled, listenerCount } from './events.js';
import { loop, step, start, stop, TICK_MS } from './loop.js';
import { botStep, humanShouldFound } from './bot.js';
import { createMods } from './mods.js';

function clearErrors() {
  errors.length = 0;
}

const silence = () => {
  const orig = console.error;
  let n = 0;
  console.error = () => n++;
  return { restore: () => (console.error = orig), count: () => n };
};

// ---------------------------------------------------------------- cost math
const TB = registerBuilding({ id: 'tb', name: 'Test block', baseCost: 30, costGrowth: 1.15, tier: 1 });
const TFLAT = registerBuilding({ id: 'tflat', name: 'Flat block', baseCost: 10, costGrowth: 1, tier: 1 });

test('buildingCost closed form matches a manual loop', () => {
  for (const [count, n] of [[0, 1], [0, 5], [3, 7], [10, 100], [250, 40]]) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += TB.baseCost * Math.pow(TB.costGrowth, count + i);
    const closed = buildingCost(TB, count, n);
    assert.ok(Math.abs(closed - sum) / sum < 1e-12, `count=${count} n=${n}: ${closed} vs ${sum}`);
  }
  assert.equal(buildingCost(TFLAT, 0, 5), 50);
});

test('maxAffordable is exact at, just below and just above every n-purchase total (n=1..60)', () => {
  state.buildings.tb = 0;
  for (let n = 1; n <= 60; n++) {
    const total = buildingCost(TB, 0, n);
    assert.equal(maxAffordable(TB, total), n, `exact n=${n}`);
    assert.equal(maxAffordable(TB, total * (1 + 1e-12)), n, `+eps n=${n}`);
    assert.equal(maxAffordable(TB, total * (1 - 1e-12)), n - 1, `-eps n=${n}`);
  }
  assert.equal(maxAffordable(TB, 29.999), 0);
  assert.equal(maxAffordable(TFLAT, 55), 5);
  assert.equal(maxAffordable(TFLAT, 9.99), 0);
});

// The two-segment curve (docs/FEEDBACK.md F8): the tier's own exponent up to `knee` units,
// then `lateGrowth`. Unit i (i owned) costs baseCost · g^min(i, knee) · lateGrowth^max(0, i − knee).
const TK = registerBuilding({ id: 'tk', name: 'Knee block', baseCost: 30, costGrowth: 1.18, knee: 10, lateGrowth: 1.112, tier: 1 });
const unitOf = (def, i) => def.baseCost * Math.pow(def.costGrowth, Math.min(i, def.knee)) * Math.pow(def.lateGrowth, Math.max(0, i - def.knee));

test('F8: two-segment buildingCost matches a manual loop on both sides of the knee', () => {
  assert.ok(TK);
  for (const [count, n] of [[0, 1], [0, 10], [0, 11], [0, 60], [5, 20], [9, 2], [10, 1], [10, 3], [12, 40], [200, 5]]) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += unitOf(TK, count + i);
    const closed = buildingCost(TK, count, n);
    assert.ok(Math.abs(closed - sum) / sum < 1e-12, `count=${count} n=${n}: ${closed} vs ${sum}`);
  }
  // The knee unit itself is still on the early curve; the one after it is the first late unit.
  assert.ok(Math.abs(buildingCost(TK, 10, 1) - 30 * Math.pow(1.18, 10)) < 1e-9);
  assert.ok(Math.abs(buildingCost(TK, 11, 1) - 30 * Math.pow(1.18, 10) * 1.112) < 1e-9);
  // Unit 200 on the knee curve is far under the single-segment price (the F8 inversion).
  assert.ok(buildingCost(TK, 200, 1) < buildingCost({ ...TK, knee: undefined }, 200, 1) / 1e4, `late exponent softens the tail: ${buildingCost(TK, 200, 1)} vs ${buildingCost({ ...TK, knee: undefined }, 200, 1)}`);
  // A def without a knee, with a knee but no lateGrowth, or with a lateGrowth < 1, is the old
  // single geometric segment.
  const single = (extra) => ({ id: 'x', baseCost: 30, costGrowth: 1.18, ...extra });
  for (const extra of [{}, { lateGrowth: 1.112 }, { knee: 10, lateGrowth: 0.5 }, { knee: 10.5, lateGrowth: 1.112 }, { knee: -1, lateGrowth: 1.112 }]) {
    const def = single(extra);
    assert.ok(Math.abs(buildingCost(def, 30, 5) - buildingCost({ ...def, knee: undefined, lateGrowth: undefined }, 30, 5)) < 1e-9, JSON.stringify(extra));
    assert.ok(Math.abs(buildingCost(def, 30, 1) - 30 * Math.pow(1.18, 30)) < 1e-9, JSON.stringify(extra));
  }
});

test('F8: maxAffordable is exact around every n-purchase total that straddles the knee; sell mirrors buy', () => {
  for (const start of [0, 8, 10, 11, 40]) {
    state.buildings.tk = start;
    for (let n = 1; n <= 40; n++) {
      const total = buildingCost(TK, start, n);
      assert.equal(maxAffordable(TK, total), n, `start=${start} exact n=${n}`);
      assert.equal(maxAffordable(TK, total * (1 + 1e-12)), n, `start=${start} +eps n=${n}`);
      assert.equal(maxAffordable(TK, total * (1 - 1e-12)), n - 1, `start=${start} -eps n=${n}`);
    }
    assert.equal(maxAffordable(TK, unitOf(TK, start) * 0.999), 0);
    // buy('max') never fails its own check across the knee.
    for (const money of [unitOf(TK, start), buildingCost(TK, start, 15), 1e9]) {
      state.buildings.tk = start;
      state.res.money = money;
      const k = maxAffordable(TK);
      assert.ok(k > 0);
      assert.equal(buy('tk', 'max'), true, `start=${start} money=${money}`);
      assert.equal(state.buildings.tk, start + k);
      assert.ok(state.res.money >= -1e-9);
    }
  }
  // Selling n units refunds sellRefund × the replacement price of exactly those units, on the
  // same two-segment curve (a sale across the knee prices its late units at lateGrowth).
  for (const [count, n] of [[5, 3], [12, 5], [30, 30], [200, 1]]) {
    assert.ok(Math.abs(sellRefund(TK, count, n) - 0.5 * buildingCost(TK, count - n, n)) < 1e-9 * buildingCost(TK, count - n, n), `count=${count} n=${n}`);
  }
  state.buildings.tk = 0;
  state.res.money = 0;
});

test('buy("max") never fails its own affordability check; bad n rejected', () => {
  state.buildings.tb = 4;
  for (const money of [30, 100, 1234.5678, buildingCost(TB, 4, 17), 1e9]) {
    state.res.money = money;
    const n = maxAffordable(TB);
    const before = state.buildings.tb;
    if (n > 0) {
      assert.equal(buy('tb', 'max'), true, `money=${money}`);
      assert.equal(state.buildings.tb, before + n);
      assert.ok(state.res.money >= -1e-9);
    } else assert.equal(buy('tb', 'max'), false);
  }
  state.res.money = 1e6;
  for (const bad of [0, -1, NaN, 1e12, 'lots']) assert.equal(buy('tb', bad), false, `n=${bad}`);
});

test('non-finite money or cost never buys and never writes NaN into the wallet', () => {
  state.buildings.tb = 0;
  for (const money of [NaN, Infinity, -Infinity]) {
    assert.equal(maxAffordable(TB, money), 0, `maxAffordable(${money})`);
    state.res.money = money;
    assert.equal(buy('tb', 'max'), false, `buy max with money=${money}`);
    assert.equal(buy('tb', 1), false, `buy 1 with money=${money}`);
    assert.equal(state.buildings.tb, 0);
    assert.equal(state.res.money, money); // untouched, not NaN
  }
  // An Infinity cost (count so high that growth^count overflows) is refused even with cash.
  state.res.money = 1e300;
  state.buildings.tb = 8000; // 1.15^8000 = Infinity
  assert.equal(buildingCost(TB, 8000, 1), Infinity);
  assert.equal(buy('tb', 1), false);
  assert.equal(state.res.money, 1e300);
  state.buildings.tb = 0;
});

test('maxCount caps buy() / maxAffordable() / buildings() rows; MAX_COUNT is the global ceiling', () => {
  const TCAP = registerBuilding({ id: 'tcap', name: 'Capped', baseCost: 10, costGrowth: 1, tier: 1, maxCount: 3 });
  assert.equal(buildingCap(TCAP), 3);
  assert.equal(buildingCap(TB), MAX_COUNT);
  state.buildings.tcap = 0;
  state.res.money = 1e6;
  assert.equal(maxAffordable(TCAP), 3);
  assert.equal(buy('tcap', 5), false); // over the cap in one go: refused, nothing bought
  assert.equal(state.buildings.tcap, 0);
  assert.equal(buy('tcap', 2), true);
  assert.equal(maxAffordable(TCAP), 1);
  assert.equal(buy('tcap', 'max'), true);
  assert.equal(state.buildings.tcap, 3);
  assert.equal(maxAffordable(TCAP), 0);
  assert.equal(buy('tcap', 1), false);
  assert.equal(buy('tcap', 'max'), false);
  const row = buildings().find((b) => b.id === 'tcap');
  assert.equal(row.maxed, true);
  assert.equal(row.affordable, false); // rich, but capped out
  assert.equal(row.maxCount, 3);
  assert.equal(buildings().find((b) => b.id === 'tb').maxed, false);
  assert.equal(buildings().find((b) => b.id === 'tb').maxCount, undefined);
  // Selling frees a slot again.
  assert.equal(sell('tcap', 1), true);
  assert.equal(buildings().find((b) => b.id === 'tcap').maxed, false);
  assert.equal(maxAffordable(TCAP), 1);
  // Growth > 1 path honours the cap too.
  const TCAP2 = registerBuilding({ id: 'tcap2', name: 'Capped2', baseCost: 10, costGrowth: 1.5, tier: 1, maxCount: 4 });
  state.buildings.tcap2 = 0;
  assert.equal(maxAffordable(TCAP2), 4);
  assert.equal(buy('tcap2', 'max'), true);
  assert.equal(state.buildings.tcap2, 4);
  // Bad maxCount values are rejected at registration.
  const c = silence();
  try {
    for (const bad of [0, -1, 1.5, '3', NaN, Infinity]) {
      assert.equal(registerBuilding({ id: 'tcap-bad', name: 'x', baseCost: 1, costGrowth: 1.1, maxCount: bad }), null, `maxCount=${bad}`);
    }
  } finally {
    c.restore();
  }
  // Global ceiling: sanitize() clamps a hand-edited count, and buy() never crosses it.
  state.buildings.tb = MAX_COUNT;
  state.res.money = 1e300;
  assert.equal(buy('tb', 1), false);
  state.buildings.tb = 1e300;
  state.buildings.tflat = MAX_COUNT + 1;
  sanitize();
  assert.equal(state.buildings.tb, MAX_COUNT);
  assert.equal(state.buildings.tflat, MAX_COUNT);
  assert.ok(Number.isFinite(buildingCost(TFLAT)));
  state.buildings.tb = 0;
  state.buildings.tflat = 0;
});

test('sell refunds exactly sellRefund (0.5) of the price paid and clamps to owned', () => {
  state.buildings.tb = 0;
  state.res.money = 1e6;
  const paid = buildingCost(TB, 0, 5);
  assert.equal(buy('tb', 5), true);
  const afterBuy = state.res.money;
  assert.equal(sell('tb', 99), true);
  assert.equal(state.buildings.tb, 0);
  const refund = state.res.money - afterBuy;
  assert.ok(Math.abs(refund / paid - 0.5) < 1e-12, `${refund / paid}`);
  assert.equal(sell('tb', 1), false);
  assert.equal(sell('nope', 1), false);
});

test('sell rejects non-numeric / non-positive quantities without touching state', () => {
  state.buildings.tb = 3;
  state.res.money = 892.8;
  for (const bad of [NaN, 'lots', 'abc', -1, 0, null, {}, [], Infinity * 0]) {
    assert.equal(sell('tb', bad), false, `n=${String(bad)}`);
    assert.equal(state.buildings.tb, 3, `count after n=${String(bad)}`);
    assert.equal(state.res.money, 892.8, `money after n=${String(bad)}`);
  }
  assert.ok(Number.isFinite(state.res.money));
  // Numeric strings are accepted (Number('2') === 2), like buy().
  assert.equal(sell('tb', '2'), true);
  assert.equal(state.buildings.tb, 1);
  assert.equal(sell('tb', Infinity), true); // clamps to owned
  assert.equal(state.buildings.tb, 0);
  state.buildings.tb = 4;
  assert.equal(sell('tb', 'max'), true); // same keyword buy() takes
  assert.equal(state.buildings.tb, 0);
  assert.equal(sell('tb', 'max'), false);
  assert.ok(Number.isFinite(state.res.money));
});

test('sell refund is capped at sellRefund of the undiscounted price when the cost mult exceeds 1', () => {
  const savedMult = derived.costMult;
  const savedMods = derived.mods;
  try {
    state.buildings.tb = 5;
    derived.mods = null;
    for (const mult of [1, 1.5, 4]) {
      derived.costMult = mult;
      const r = sellRefund(TB, 5, 2);
      derived.costMult = 1;
      assert.ok(Math.abs(r - 0.5 * buildingCost(TB, 3, 2)) < 1e-9, `mult=${mult}: ${r}`);
    }
    // A discount lowers the refund with the current price (50% of the replacement cost).
    derived.costMult = 0.8;
    const discounted = sellRefund(TB, 5, 2);
    assert.ok(Math.abs(discounted - 0.5 * buildingCost(TB, 3, 2)) < 1e-9);
    derived.costMult = 1;
    assert.ok(discounted < 0.5 * buildingCost(TB, 3, 2));
    // Per-building mod above 1 is clamped the same way.
    derived.mods = { byBuilding: { tb: { cost: 3 } } };
    assert.ok(Math.abs(sellRefund(TB, 5, 1) - (0.5 * buildingCost(TB, 4, 1)) / 3) < 1e-9);
    derived.mods = null;
    // And the public path uses it.
    state.res.money = 0;
    derived.costMult = 2;
    assert.equal(sell('tb', 1), true);
    derived.costMult = 1;
    assert.ok(state.res.money <= 0.5 * buildingCost(TB, 4, 1) + 1e-9);
  } finally {
    derived.costMult = savedMult;
    derived.mods = savedMods;
  }
});

// ---------------------------------------------------------------- formatting
test('fmt floors to the displayed precision on both sides of the 1000 boundary', () => {
  const table = [
    [0, '0'],
    [0.5, '0.50'],
    [0.999, '0.99'],
    [1.15 * 100 / 100, '1.15'],
    [0.1 + 0.2, '0.30'],
    [9.995, '9.99'],
    [10.96, '10'],
    [99.95, '99'],
    [999.99, '999'],
    [999.996, '999'],
    [1000, '1.00K'],
    [1049.6, '1.04K'],
    [12345, '12.3K'],
    [123456, '123K'],
    [999999, '999K'],
    [1e6, '1.00M'],
    [1e15, '1.00Qa'],
    [1e18, '1.00Qi'],
    [1e40, '1.00e40'],
    [123.456e40, '1.23e42'],
    [-1234.5, '-1.23K'],
    [-0.5, '-0.50'],
    [-1e-9, '0.00'],
    [5e-324, '0.00'],
    [1e308, '1.00e308'],
    [NaN, '—'],
    [Infinity, '∞'],
    [-Infinity, '-∞'],
  ];
  for (const [n, want] of table) assert.equal(fmt(n), want, `fmt(${n})`);
  assert.equal(fmt(1.23456, 'x'), '1.23'); // invalid digits falls back to 2
  assert.equal(fmt(1.23456, 3), '1.234');
  assert.equal(fmtMoney(-0.5), '-$0.50');
  assert.equal(fmtMoney(999999), '$999K');
  assert.equal(fmtMoney(Infinity), '$∞');
  assert.equal(fmtMoney(-Infinity), '-$∞');
  assert.equal(fmtMoney(NaN), '$—');
  assert.equal(fmtRate(2.5), '+2.50/s');
  assert.equal(fmtRate(-3), '-3/s');
  assert.equal(fmtRate(0), '+0/s');
  assert.equal(fmtRate(-0.001), '+0.00/s'); // sign follows the displayed value: never an unsigned rate
  assert.equal(fmtRate(1500, '$'), '+1.50K$/s');
  assert.equal(fmtRate(NaN), '—'); // like fmtMoney(NaN) === '$—', never '—/s'
  assert.equal(fmtRate(Infinity), '—');
  assert.equal(fmtRate('12'), '—');
  assert.equal(fmtInt(1234567.9), '1.23M');
  assert.equal(fmtInt(-12.7), '-12');
});

test('fmtPct floors like fmt and never prints -0%', () => {
  const table = [
    [0, '0%'],
    [0.999, '99%'],
    [0.9999, '99%'],
    [1, '100%'],
    [0.05, '5%'],
    [0.29, '29%'],
    [0.07, '7%'],
    [-0.001, '0%'],
    [-0.256, '-25%'],
    [2.5, '250%'],
    [NaN, '—'],
    [Infinity, '—'],
  ];
  for (const [x, want] of table) assert.equal(fmtPct(x), want, `fmtPct(${x})`);
  assert.equal(fmtPct(0.12345, 1), '12.3%');
  assert.equal(fmtPct(0.999, 2), '99.90%');
  assert.equal(fmtPct(-0.00001, 2), '0.00%');
  assert.equal(fmtPct(0.5, 'x'), '50%');
  // From 1000% up the value reads like every other big number (fmt tiers / scientific), never
  // "1000000000000000%" or "1e+38%".
  assert.equal(fmtPct(9.99), '999%');
  assert.equal(fmtPct(10), '1.00K%');
  assert.equal(fmtPct(-12.5, 1), '-1.25K%');
  assert.equal(fmtPct(1e13), '1.00Qa%');
  assert.equal(fmtPct(1e38), '1.00e40%'); // 1e38 x 100, past the suffix table
});

test('displayed money never exceeds real money and displayed cost never undercuts real cost', () => {
  // For random pairs money < cost, the two strings are never (equal-and-affordable-looking)
  // with money display > cost display.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 2000; i++) {
    const cost = Math.pow(10, rnd() * 12);
    const money = cost * (1 - rnd() * 0.01);
    const m = fmt(money);
    const c = fmt(cost);
    const val = (s) => {
      const suffix = s.replace(/[-0-9.e]/g, '');
      const idx = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'].indexOf(suffix);
      return parseFloat(s) * Math.pow(1000, idx);
    };
    assert.ok(val(m) <= val(c) + 1e-9, `${money} -> ${m} vs ${cost} -> ${c}`);
  }
});

// ---------------------------------------------------------------- state
test('loadState survives hostile input', () => {
  const deep = {};
  let cur = deep;
  for (let i = 0; i < 1000; i++) cur = cur.n = {};
  const hostile = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"res":{"money":"abc","pop":-5,"power":1e309},"buildings":{"house":2.7,"shop":-3,"tb":"3"},"upgrades":{"a":1,"b":0,"c":"yes"},"unlocks":["x"],"stats":"nope","prestige":{"legacy":"7","spent":-1,"lifetimeEarned":1e400},"settings":null,"log":[{"msg":1},{"msg":"ok","t":"z"},null,"str"],"tick":-4,"time":"x","version":"9"}');
  hostile.deep = deep;
  loadState(hostile);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.x, undefined);
  assert.equal(state.res.money, 0);
  assert.equal(state.res.pop, 0);
  assert.equal(state.res.power, 0);
  assert.deepEqual(state.buildings, { house: 2, shop: 0, tb: 3 });
  assert.deepEqual(state.upgrades, { a: true, c: true });
  assert.deepEqual(state.unlocks, {});
  assert.equal(state.stats.totalEarned, 0);
  assert.equal(state.stats.prestiges, 0);
  assert.equal(state.prestige.legacy, 0);
  assert.equal(state.prestige.spent, 0);
  assert.equal(state.prestige.lifetimeEarned, 0);
  assert.equal(state.settings.autosave, true);
  assert.equal(state.log.length, 1);
  assert.equal(state.log[0].t, 0);
  assert.equal(state.log[0].kind, 'info');
  assert.equal(state.tick, 0);
  assert.equal(state.time, 0);
  assert.equal(state.version, 1);
  // unknown top-level key `deep` is dropped (closed schema); nothing thrown on the 1000-deep object
  assert.equal(state.deep, undefined);
  // bounded recursion inside a known section: nested depth clipped, nothing thrown
  loadState({ buildings: { deep: (() => { const o = {}; let c = o; for (let i = 0; i < 1000; i++) c = c.n = {}; return o; })() } });
  assert.equal(state.buildings.deep, 0); // an object is not a count: sanitized to 0

  loadState(null);
  loadState([1, 2, 3]);
  assert.equal(state.res.money, 0);
});

test('loadState schema is closed: unknown top-level keys from a foreign save are dropped', () => {
  loadState({ res: { money: 5, gems: 3 }, pwn: { evil: true }, oldSection: [1, 2], deep: { n: {} }, buildings: { tb: 1 } });
  assert.equal(state.pwn, undefined);
  assert.equal(state.oldSection, undefined);
  assert.equal(state.deep, undefined);
  assert.equal(state.res.money, 5);
  assert.equal(state.res.gems, 3); // nested resource keys stay open (content adds resources)
  assert.equal(state.buildings.tb, 1);
  assert.deepEqual(Object.keys(state).sort(), Object.keys(createInitialState()).sort());
  assert.equal('pwn' in JSON.parse(JSON.stringify(state)), false);
});

test('resetState keeps lifetime counters and zeroes per-run ones', () => {
  loadState({ res: { money: 500 }, buildings: { tb: 3 }, stats: { totalEarned: 9, peakPop: 5, buildingsBuilt: 3, prestiges: 2, playtime: 100, clicks: 4 }, prestige: { legacy: 8, spent: 3, lifetimeEarned: 1e6 }, settings: { sfx: false } });
  resetState();
  assert.equal(state.res.money, 0);
  assert.deepEqual(state.buildings, {});
  assert.equal(state.stats.totalEarned, 0);
  assert.equal(state.stats.peakPop, 0);
  assert.equal(state.stats.buildingsBuilt, 0);
  assert.equal(state.stats.prestiges, 2);
  assert.equal(state.stats.playtime, 100);
  assert.equal(state.stats.clicks, 4);
  assert.deepEqual(state.prestige, { legacy: 8, spent: 3, lifetimeEarned: 1e6 });
  assert.equal(state.settings.sfx, false);
  state.res.money = NaN;
  state.buildings.tb = -2;
  sanitize();
  assert.equal(state.res.money, 0);
  assert.equal(state.buildings.tb, 0);
});

// ---------------------------------------------------------------- safety
test('guard disables a consistent thrower after 3 consecutive failures (2 ring entries)', () => {
  clearErrors();
  const c = silence();
  try {
    let calls = 0;
    const g = guard('test:always', () => {
      calls++;
      throw new Error('boom');
    });
    for (let i = 0; i < 20; i++) g();
    assert.equal(calls, DISABLE_AFTER);
    assert.equal(g.isDisabled(), true);
    const mine = errors.filter((e) => e.module === 'test:always');
    assert.equal(mine.length, 2);
    assert.equal(mine[0].msg, 'boom');
    assert.equal(mine[0].count, 3);
    assert.match(mine[1].msg, /disabled after 3 consecutive/);
    g.reset();
    assert.equal(g.isDisabled(), false);
    g();
    assert.equal(calls, DISABLE_AFTER + 1);
  } finally {
    c.restore();
  }
});

test('registry.resetGuards() re-enables every guard the registry handed out', () => {
  clearErrors();
  const c = silence();
  try {
    let effectCalls = 0;
    let actionCalls = 0;
    const up = registerUpgrade({
      id: 'rg-boom',
      name: 'Boom',
      cost: 1,
      effect: () => {
        effectCalls++;
        throw new Error('boom');
      },
    });
    registerAction('rg-boom', () => {
      actionCalls++;
      throw new Error('boom');
    });
    const act = registry.actions.get('rg-boom');
    for (let i = 0; i < 10; i++) {
      up.effect({}, state);
      act();
    }
    assert.equal(effectCalls, DISABLE_AFTER);
    assert.equal(actionCalls, DISABLE_AFTER);
    assert.equal(up.effect.isDisabled(), true);
    assert.equal(act.isDisabled(), true);
    assert.ok(registry.guards.includes(up.effect) && registry.guards.includes(act));
    // The registry object and the named export are the same function.
    assert.equal(registry.resetGuards, resetGuards);
    assert.ok(resetGuards() >= 2, 'reports how many guards had tripped');
    assert.equal(up.effect.isDisabled(), false);
    assert.equal(act.isDisabled(), false);
    up.effect({}, state);
    act();
    assert.equal(effectCalls, DISABLE_AFTER + 1);
    assert.equal(actionCalls, DISABLE_AFTER + 1);
    assert.equal(resetGuards(), 0);
  } finally {
    registry.upgrades.delete('rg-boom');
    registry.upgradeOrder.splice(registry.upgradeOrder.indexOf('rg-boom'), 1);
    registry.actions.delete('rg-boom');
    c.restore();
  }
});

test('guard disables an intermittent thrower (every other call) instead of spamming forever', () => {
  clearErrors();
  const c = silence();
  try {
    let calls = 0;
    const g = guard('test:flaky', () => {
      calls++;
      if (calls % 2 === 0) throw new Error('flaky');
      return calls;
    });
    for (let i = 0; i < 500; i++) g();
    assert.equal(g.isDisabled(), true);
    assert.equal(calls, DISABLE_AFTER_TOTAL * 2);
    const mine = errors.filter((e) => e.module === 'test:flaky');
    assert.equal(mine.length, 2);
    assert.equal(mine[0].count, DISABLE_AFTER_TOTAL);
    assert.match(mine[1].msg, new RegExp(`disabled after ${DISABLE_AFTER_TOTAL} failures within ${WINDOW}`));
    // A rare failure (< 10 per 500 calls, never 3 in a row) is tolerated.
    let n = 0;
    const rare = guard('test:rare', () => {
      n++;
      if (n % 100 === 0) throw new Error('rare');
    });
    for (let i = 0; i < 5000; i++) rare();
    assert.equal(rare.isDisabled(), false);
    assert.equal(n, 5000);
  } finally {
    c.restore();
  }
});

test('reportError dedupes repeats so a noisy source cannot evict other diagnostics', () => {
  clearErrors();
  const c = silence();
  try {
    reportError('real:a', new Error('first real failure'));
    reportError('real:b', new Error('second real failure'));
    for (let i = 0; i < 5000; i++) reportError('noisy', new Error('same thing'));
    assert.equal(errors.length, 3);
    assert.equal(errors[2].count, 5000);
    assert.ok(errors.some((e) => e.module === 'real:a'));
    assert.ok(errors.some((e) => e.module === 'real:b'));
    assert.equal(c.count(), 2 + 1 + 50); // first of each + every 100th repeat (100..5000)
    // Distinct messages still fill the ring but it stays capped.
    for (let i = 0; i < 400; i++) reportError('spread', new Error('msg ' + i));
    assert.equal(errors.length, 200);
    // Non-Error values are stringified.
    reportError('str', 'plain string');
    assert.equal(errors[errors.length - 1].msg, 'plain string');
  } finally {
    c.restore();
  }
});

test('a throwing listener is isolated and disabled; other listeners keep running; off() works', () => {
  clearErrors();
  const c = silence();
  try {
    let good = 0;
    let bad = 0;
    const thrower = () => {
      bad++;
      throw new Error('listener boom');
    };
    const fine = () => good++;
    on('core-test', thrower);
    const offFine = on('core-test', fine);
    on('core-test', fine); // duplicate registration is a no-op
    assert.equal(listenerCount('core-test'), 2);
    for (let i = 0; i < 500; i++) emit('core-test', i);
    assert.equal(good, 500);
    assert.equal(bad, DISABLE_AFTER);
    assert.equal(isListenerDisabled('core-test', thrower), true);
    assert.equal(isListenerDisabled('core-test', fine), false);
    assert.equal(errors.filter((e) => e.module === 'events:core-test').length, 2);
    offFine();
    emit('core-test');
    assert.equal(good, 500);
    off('core-test', thrower);
    assert.equal(listenerCount('core-test'), 0);
    assert.equal(typeof on('core-test', 'not a function'), 'function');
    assert.equal(listenerCount('core-test'), 0);
    emit('never-registered');
  } finally {
    c.restore();
  }
});

test('registered callbacks are guarded and the game keeps ticking around them', () => {
  clearErrors();
  const c = silence();
  try {
    const up = registerUpgrade({ id: 'bad-up', name: 'Bad', cost: 1, effect: () => { throw new Error('effect'); } });
    const b = registerBuilding({ id: 'bad-b', name: 'Bad', baseCost: 1, costGrowth: 1.1, unlock: () => { throw new Error('unlock'); } });
    let ticks = 0;
    registerTickHandler('core-test-ok', () => ticks++, 50);
    registerTickHandler('core-test-bad', () => { throw new Error('tick'); }, 60);
    const t0 = state.tick;
    for (let i = 0; i < 10; i++) {
      up.effect({}, state);
      b.unlock(state, derived);
    }
    step(10);
    assert.equal(state.tick, t0 + 10);
    assert.equal(ticks, 10);
    assert.equal(up.effect.isDisabled(), true);
    assert.equal(b.unlock.isDisabled(), true);
    const badTick = registry.tickHandlers.find((h) => h.name === 'core-test-bad');
    assert.equal(badTick.fn.isDisabled(), true);
    for (const m of ['upgrade:bad-up:effect', 'building:bad-b:unlock', 'tick:core-test-bad']) {
      assert.equal(errors.filter((e) => e.module === m).length, 2, m);
    }
    // api exposes the disabled guard as `broken` so a paid-for-but-inert upgrade is visible.
    state.upgrades['bad-up'] = true;
    const upRow = upgrades().find((u) => u.id === 'bad-up');
    assert.equal(upRow.owned, true);
    assert.equal(upRow.broken, true);
    assert.equal(upgrades().filter((u) => u.broken).length, 1);
    const bRow = buildings().find((b) => b.id === 'bad-b');
    assert.equal(bRow.unlocked, false);
    assert.equal(bRow.broken, true);
    assert.equal(buildings().find((b) => b.id === 'tb').broken, false);
    delete state.upgrades['bad-up'];
    // An upgrade whose UNLOCK rule dies is badged too (mirrors buildings()), not silently locked.
    const up2 = registerUpgrade({ id: 'bad-up2', name: 'Bad unlock', cost: 1, effect: () => {}, unlock: () => { throw new Error('unlock'); } });
    for (let i = 0; i < 3; i++) upgrades();
    assert.equal(up2.unlock.isDisabled(), true);
    const row2 = upgrades().find((u) => u.id === 'bad-up2');
    assert.equal(row2.unlocked, false);
    assert.equal(row2.broken, true);
    assert.equal(row2.owned, false);
    assert.equal(upgrades().filter((u) => u.broken).length, 2);
  } finally {
    registry.tickHandlers = registry.tickHandlers.filter((h) => !h.name.startsWith('core-test'));
    c.restore();
  }
});

test('registry validate rejects bad currency / tier / category / numerics', () => {
  clearErrors();
  const c = silence();
  try {
    const base = { name: 'X', cost: 1, effect: () => {} };
    assert.equal(registerUpgrade({ ...base, id: 'v-cur', currency: 'Legacy' }), null);
    assert.equal(registerUpgrade({ ...base, id: 'v-tier', tier: '2' }), null);
    assert.equal(registerUpgrade({ ...base, id: 'v-tier2', tier: 1.5 }), null);
    assert.equal(registerUpgrade({ ...base, id: 'v-cat', category: 7 }), null);
    assert.equal(registerUpgrade({ ...base, id: 'v-cost', cost: -1 }), null);
    assert.equal(registerUpgrade({ ...base, id: 'bad id!' }), null);
    assert.notEqual(registerUpgrade({ ...base, id: 'v-ok', currency: 'legacy', tier: 3, category: 'charter' }), null);
    assert.equal(registerUpgrade({ ...base, id: 'v-ok' }), null); // duplicate
    const bb = { name: 'B', baseCost: 10, costGrowth: 1.1 };
    assert.equal(registerBuilding({ ...bb, id: 'vb-cat', category: 'houses' }), null);
    assert.equal(registerBuilding({ ...bb, id: 'vb-growth', costGrowth: 0.9 }), null);
    assert.equal(registerBuilding({ ...bb, id: 'vb-cost', baseCost: 0 }), null);
    assert.equal(registerBuilding({ ...bb, id: 'vb-refund', sellRefund: 2 }), null);
    assert.equal(registerBuilding({ ...bb, id: 'vb-nan', housing: NaN }), null);
    assert.notEqual(registerBuilding({ ...bb, id: 'vb-ok', category: 'civic', tier: 4 }), null);
    assert.equal(errors.filter((e) => e.module === 'registry').length, 12);
  } finally {
    c.restore();
  }
});

// ---------------------------------------------------------------- loop
test('step() advances exactly n ticks; Node fallback start/stop clears its interval', async () => {
  const t0 = state.tick;
  step(7);
  assert.equal(state.tick, t0 + 7);
  step(-3);
  step(NaN);
  assert.equal(state.tick, t0 + 7);
  assert.equal(typeof requestAnimationFrame, 'undefined');
  start();
  assert.equal(loop.running, true);
  await new Promise((r) => setTimeout(r, TICK_MS * 3));
  stop();
  assert.equal(loop.running, false);
  const after = state.tick;
  await new Promise((r) => setTimeout(r, TICK_MS * 3));
  assert.equal(state.tick, after); // interval really cleared: nothing ticks after stop()
  // (a leaked interval would also keep this test process alive)
});


test('browser frame accumulator: drift-free, catch-up capped, skippedMs parked/capped/drained', () => {
  let cb = null;
  let cancelled = 0;
  const g = globalThis;
  g.requestAnimationFrame = (fn) => {
    cb = fn;
    return 1;
  };
  g.cancelAnimationFrame = () => cancelled++;
  try {
    loop.skippedMs = 0;
    loop.skippedAt = 0;
    start();
    assert.equal(loop.running, true);
    let t = 5000;
    const frameAt = (ts) => {
      const before = state.tick;
      cb(ts);
      return state.tick - before;
    };
    assert.equal(frameAt(t), 0); // first frame only anchors lastFrame
    // 60 frames at 60 fps = exactly one second = exactly 10 ticks, accumulator back at ~0.
    let ticks = 0;
    for (let i = 0; i < 60; i++) ticks += frameAt((t += 1000 / 60));
    assert.equal(ticks, 10);
    assert.ok(Math.abs(loop.accumulator) < 1e-6, `accumulator ${loop.accumulator}`);
    // A 250 ms hitch is 2 ticks with 50 ms carried.
    assert.equal(frameAt((t += 250)), 2);
    assert.ok(Math.abs(loop.accumulator - 50) < 1e-6);
    assert.equal(frameAt((t += 50)), 1);
    assert.ok(Math.abs(loop.accumulator) < 1e-6);
    // Exactly the cap: 5 s = 50 ticks, nothing parked.
    assert.equal(frameAt((t += 5000)), 50);
    assert.equal(loop.skippedMs, 0);
    // 10 minutes in the background: 50 ticks now, 595 000 ms parked for save/offline.
    assert.equal(frameAt((t += 600000)), 50);
    assert.equal(loop.skippedMs, 595000);
    assert.equal(loop.skippedAt, t);
    assert.equal(loop.accumulator, 0);
    // Inside the 3 s grace nothing drains (save is expected to claim it).
    assert.equal(frameAt((t += 16)), 0);
    assert.equal(loop.skippedMs, 595000);
    assert.equal(frameAt((t += 2900)), 29);
    assert.equal(loop.skippedMs, 595000);
    // Past the grace it drains in MAX_CATCHUP-sized batches: 50 per frame including live ticks.
    assert.equal(frameAt((t += 100)), 50); // 1 live + 49 drained
    assert.equal(loop.skippedMs, 595000 - 49 * TICK_MS);
    assert.equal(frameAt((t += 16)), 50); // 0 live + 50 drained
    assert.equal(loop.skippedMs, 595000 - 99 * TICK_MS);
    // A consumer claiming it stops the drain.
    loop.skippedMs = 0;
    assert.equal(frameAt((t += 16)), 0);
    assert.equal(frameAt((t += 84)), 1);
    // A two-day absence parks at most one day.
    assert.equal(frameAt((t += 2 * 86400e3)), 50);
    assert.equal(loop.skippedMs, 86400e3);
    loop.skippedMs = 0;
    // Backwards clock: no ticks and no negative accumulator; the next real frame is normal.
    assert.equal(frameAt((t -= 5000)), 0);
    assert.ok(loop.accumulator >= 0);
    assert.equal(frameAt((t += 100)), 1);
    // speed scales elapsed time.
    loop.speed = 2;
    assert.equal(frameAt((t += 100)), 2);
    loop.speed = 1;
    stop();
    assert.equal(loop.running, false);
    assert.equal(cancelled, 1);
    const after = state.tick;
    cb(t + 1000); // a stray callback after stop() must do nothing
    assert.equal(state.tick, after);
  } finally {
    loop.speed = 1;
    loop.skippedMs = 0;
    delete g.requestAnimationFrame;
    delete g.cancelAnimationFrame;
  }
});

// ---------------------------------------------------------------- bot profiles
// The human profile is pinned on the ORDER of its purchases (api.buy is wrapped to record
// them, and the profile's `trace` option names the rule behind each batch) because every rule
// is about what it buys before what: homes ahead of jobs, the grid ahead of the draw, a civic
// ahead of the rotation — all judged on this step's own purchases, not on the stale derived
// snapshot — and on what it does NOT do: it never ends a step to save for a jobs building.
function recordBuys(fn) {
  const orig = api.buy;
  const log = [];
  api.buy = (id, n) => {
    const ok = orig(id, n);
    if (ok) log.push({ id, n });
    return ok;
  };
  try {
    fn();
  } finally {
    api.buy = orig;
  }
  return log;
}
function freshPlot(money = 1e6) {
  resetState();
  state.res.money = money;
  state.res.pop = 0;
  derived.housing = 0;
  derived.jobs = 0;
  derived.employed = 0;
  derived.powerCap = 0;
  derived.powerDemand = 0;
  derived.powerRatio = 1;
  derived.happiness = 1;
  derived.income = 5; // no tap
  derived.mods = null;
}
// Run one human step, returning the buy log and the rule behind each building batch.
function humanRun(opts = {}) {
  const reasons = [];
  const log = recordBuys(() => botStep({ profile: 'human', maxBuys: 25, trace: (why) => reasons.push(why), ...opts }));
  return { log, reasons };
}

test('botStep human profile: generators ahead of the draw, batches, pending bookkeeping; unknown profile is greedy', () => {
  clearErrors();
  const res = registerBuilding({ id: 'h-res', name: 'Human house', baseCost: 30, costGrowth: 1.15, tier: 1, category: 'residential', housing: 4, powerUse: 1 });
  const gen = registerBuilding({ id: 'h-gen', name: 'Human mill', baseCost: 40, costGrowth: 1.15, tier: 1, category: 'power', powerGen: 4 });
  assert.ok(res && gen);
  freshPlot();
  let n = 0;
  const reasons = [];
  const log = recordBuys(() => (n = botStep({ profile: 'human', maxBuys: 25, trace: (why) => reasons.push(why) })));
  assert.ok(n > 0 && n <= 25);
  // (the registry also holds a couple of test upgrades the profile buys first; they count as
  // buys but not as api.buy calls)
  assert.equal(log.length, n - Object.keys(state.upgrades).length, 'every building buy is one batch');
  assert.equal(reasons.length, log.length, 'trace names every batch');
  const houses = state.buildings['h-res'] || 0;
  const mills = state.buildings['h-gen'] || 0;
  assert.ok(houses > 0 && mills > 0, `houses=${houses} mills=${mills}`);
  assert.ok(log.some((b) => b.n > 1), 'the rotation buys ×Max batches, not single units');
  assert.ok(reasons.includes('power') && reasons.includes('rotation'), `reasons: ${reasons.join(' ')}`);
  assert.ok(log.some((b, i) => b.id === 'h-gen' && reasons[i] === 'rotation'), 'generators are also bought by the rotation (the F2 surplus)');
  // Replay: before any draw is added the grid (as this step has already changed it) is within
  // the 0.98 trigger of the demand, so the profile never walks into a brownout inside one step.
  let demand = 0;
  let cap = 0;
  for (const b of log) {
    if (b.id === 'h-res') {
      assert.ok(demand === 0 || cap * 0.98 >= demand - 1e-9, `house batch at demand=${demand} cap=${cap}`);
      demand += b.n;
    } else if (b.id === 'h-gen') cap += 4 * b.n;
  }
  assert.equal(errors.length, 0);
  // Broke: nothing to buy, no throw, zero buys.
  state.res.money = 0;
  assert.equal(botStep({ profile: 'human' }), 0);
  // An unknown profile falls back to the greedy policy and returns a count.
  assert.equal(typeof botStep({ profile: 'nope' }), 'number');
  resetState();
});

test('botStep human profile: homes before jobs on the stale population, a civic before the rotation, never saves for jobs', () => {
  clearErrors();
  const flat = registerBuilding({ id: 'h-flat', name: 'Human flat', baseCost: 30, costGrowth: 1.15, tier: 2, category: 'residential', housing: 10 });
  const job = registerBuilding({ id: 'h-job', name: 'Human shop', baseCost: 50, costGrowth: 1.15, tier: 1, category: 'commercial', jobs: 5 });
  const civ = registerBuilding({ id: 'h-civ', name: 'Human park', baseCost: 20, costGrowth: 1.15, tier: 1, category: 'civic', happiness: 0.1 });
  assert.ok(flat && job && civ);
  // The first test's house / mill are priced out of reach so the replay below reads one
  // residential and one jobs building.
  const bury = () => {
    state.buildings['h-res'] = 400;
    state.buildings['h-gen'] = 400;
  };
  // Fresh plot: one home to seed it, then the rotation — nobody lives here yet, so no jobs
  // rule fires (the people who will move in are not projected: housing leads).
  freshPlot();
  bury();
  let { log, reasons } = humanRun();
  assert.ok(log.length >= 3);
  assert.deepEqual(log[0], { id: 'h-flat', n: 1 }, 'an empty plot gets one home first');
  assert.equal(reasons[0], 'housing');
  assert.ok(!reasons.includes('jobs'), `no jobs rule on an empty plot: ${reasons.join(' ')}`);
  assert.ok(log.some((b) => b.id === 'h-job'), 'the rotation still buys the jobs building');
  // Stale derived: housing full (vacancy 0) and half the people jobless. Homes first — the
  // units that open 5 % vacancy — then the jobs for the people already here (pop − jobs, one
  // category's share of the wallet), on this step's own numbers.
  freshPlot();
  bury();
  state.res.pop = 1000;
  derived.housing = 1000;
  derived.jobs = 500;
  derived.employed = 500;
  ({ log, reasons } = humanRun());
  assert.equal(log[0].id, 'h-flat');
  assert.equal(reasons[0], 'housing');
  assert.equal(log[0].n, 6, 'vacancy need: ceil((1000 / 0.95 − 1000) / 10) homes');
  assert.equal(log[1].id, 'h-job');
  assert.equal(reasons[1], 'jobs');
  assert.ok(log[1].n >= 1 && log[1].n <= 100, `jobs batch covers up to the 500 jobless: ${log[1].n}`);
  // Jobs short by 90 % with the jobs building out of reach: the step does NOT save toward it —
  // the wallet goes to the rotation (the second cut's `if (jobsShort) break` is gone; this is
  // what lets unemployment float, the F3 signal).
  freshPlot(1e3);
  bury();
  state.res.pop = 1000;
  derived.housing = 2000; // vacancy 50 %: no housing need
  derived.jobs = 100;
  derived.employed = 100;
  state.buildings['h-job'] = 400; // 50 · 1.15^400: out of reach
  ({ log, reasons } = humanRun());
  assert.ok(log.length > 0, 'never saves for jobs: the rotation runs');
  assert.ok(!reasons.includes('jobs') && !log.some((b) => b.id === 'h-job'), reasons.join(' '));
  assert.ok(reasons.every((r) => r === 'rotation'), `rotation only: ${reasons.join(' ')}`);
  // Happiness below 1: enough civics to cover the gap come before anything else.
  freshPlot();
  bury();
  state.res.pop = 100;
  derived.housing = 200; // vacancy 50 %: no housing need
  derived.jobs = 100;
  derived.employed = 100;
  derived.happiness = 0.75;
  ({ log, reasons } = humanRun());
  assert.deepEqual(log[0], { id: 'h-civ', n: 3 }, 'ceil((1 − 0.75) / 0.1) parks first');
  assert.equal(reasons[0], 'civic');
  assert.equal(errors.length, 0);
  resetState();
});

// The strain-rule content both guard tests read: draw grows with the fleet (buildings
// demandGrowth: per-unit × min(cap, 1 + (count − 1) / per)); with per = 1 a fleet of k units
// draws k × k stickers. The build card prints the rule and the current "×N now" factor
// (src/ui/build.js:261-271), so a grid-ahead player can foresee a batch's strain; the default
// guard does, the 'sticker' guard (the round-1/2 booking) is kept as the sim's control line.
const strainSnapshot = () => {
  // Stale snapshot: housing full (14 homes open the 5 % vacancy), grid 10 / 5 → room 5.
  freshPlot();
  state.res.pop = 1000;
  derived.housing = 1000;
  derived.jobs = 2000;
  derived.employed = 1000;
  derived.powerCap = 10;
  derived.powerDemand = 5;
};

test("botStep human profile, guard 'sticker' (the control): a draw batch is trimmed at the sticker draw, not the grid-strain draw the tick will add", () => {
  clearErrors();
  const strained = registerBuilding({ id: 'h-strain', name: 'Human tower', baseCost: 30, costGrowth: 1.15, tier: 3, category: 'residential', housing: 4, powerUse: 1, demandGrowth: { per: 1, cap: 40 } });
  assert.ok(strained);
  // Room for 5 stickers: the sticker guard lets 5 through (the strain-aware default lets 2:
  // 2 × 2 = 4 ≤ 5, 3 × 3 = 9 > 5 — the next test).
  strainSnapshot();
  let { log, reasons } = humanRun({ guard: 'sticker' });
  assert.deepEqual(log[0], { id: 'h-strain', n: 5 }, `5 stickers fit the room: ${JSON.stringify(log[0])}`);
  assert.equal(reasons[0], 'housing');
  // The draw turned away (14 − 5 = 9 stickers) is met in the same step by the power rule: the
  // grid 1.2× ahead of demand 10 + refused 9 → 22.8 at 4 MW per mill over the 10 there = 4 mills.
  assert.equal(log[1].id, 'h-gen', reasons.join(' '));
  assert.equal(reasons[1], 'power');
  assert.equal(log[1].n, 4);
  // No room at all (grid 10 / 10): nothing that draws is bought before a generator, under
  // either guard — the profile never KNOWINGLY browns out.
  for (const guard of ['sticker', 'strain']) {
    strainSnapshot();
    derived.powerDemand = 10;
    ({ log, reasons } = humanRun({ guard }));
    assert.equal(log[0].id, 'h-gen', `generator first at no room (${guard}): ${reasons.join(' ')}`);
    assert.equal(reasons[0], 'power');
  }
  assert.equal(errors.length, 0);
  resetState();
});

test('botStep human profile (default guard): a ×Max draw batch is trimmed to the units the capacity carries AFTER the fleet strain, from the count owned', () => {
  clearErrors();
  const strained = registry.buildings.get('h-strain');
  assert.ok(strained && strained.demandGrowth, 'the strain-rule test building from the control test above');
  strainSnapshot();
  const { log, reasons } = humanRun();
  // Need 14 homes; the fleet of k towers draws k × k over a room of 5 → 2 fit (4 ≤ 5 < 9).
  assert.deepEqual(log[0], { id: 'h-strain', n: 2 }, `2 towers fit the room after strain: ${JSON.stringify(log[0])} (${reasons.join(' ')})`);
  assert.equal(reasons[0], 'housing');
  // The refused draw is the strain draw of the batch turned away: 14 × 14 − 2 × 2 = 192. The
  // power rule then sizes the plant 1.2× ahead of demand (5 + 4) + 192 → 241.2 at 4 MW per
  // mill over the 10 there = 58 mills (the wallet covers them).
  assert.equal(log[1].id, 'h-gen', reasons.join(' '));
  assert.equal(reasons[1], 'power');
  const mills = Math.ceil(((5 + 4 + (14 * 14 - 2 * 2)) * 1.2 - 10) / 4);
  assert.equal(mills, 58);
  assert.equal(log[1].n, mills, `plant sized for the refused strain draw: ${JSON.stringify(log[1])}`);
  // The next housing batch in the same step folds the 2 towers already owned: room is now
  // 10 + 58 × 4 − 9 = 233 and (2 + k)² − 4 ≤ 233 → k ≤ 13, so the 12 homes the vacancy still
  // needs (ceil((1000 / 0.95 − 1008) / 4)) all fit.
  assert.deepEqual(log[2], { id: 'h-strain', n: 12 }, `second batch from the count owned: ${JSON.stringify(log[2])} (${reasons.join(' ')})`);
  assert.equal(reasons[2], 'housing');
  // Replay: under the strain draw no batch ever exceeded the room the step had booked.
  let owned = 0;
  let demand = 5;
  let cap = 10;
  for (const b of log) {
    if (b.id === 'h-strain') {
      const before = owned * owned;
      const after = (owned + b.n) * (owned + b.n);
      assert.ok(after - before <= cap - demand + 1e-9, `batch of ${b.n} at ${owned} owned: +${after - before} over room ${cap - demand}`);
      demand += after - before;
      owned += b.n;
    } else if (b.id === 'h-gen') cap += 4 * b.n;
  }
  assert.equal(errors.length, 0);
  state.buildings['h-strain'] = 400; // priced out for the tests below
  resetState();
});

// A demand step the player did not choose to power: an upgrade's draw clause (the +8 % on the
// mid-fleet employer rungs, +15 % on the Energy Charter — src/upgrades) folds into the tick's
// mods bag and lifts every unit's draw at once. Neither guard can trim it (no batch was
// chosen), so both profiles sit in the brownout for exactly as long as the cheapest generator
// is out of reach, and both buy that generator before anything else the moment it is not —
// the same content, the same reason, under the strain-aware default and the sticker control.
// This is what the Lights Out milestone is earned by under an honest grid-ahead player.
test('both profiles brown out on the same demand-step content for the same reason: nothing that draws until the cheapest generator is affordable, then the generator first', () => {
  clearErrors();
  const step = registerUpgrade({ id: 'h-demand-step', name: 'Trading Floors II (test)', cost: 10, effect: (mods) => { mods.demand *= 1.08; } });
  assert.ok(step);
  const mods = createMods();
  step.effect(mods, state);
  assert.equal(mods.demand, 1.08, 'the draw clause is a mods.demand step');
  const drawIds = new Set(registry.buildingOrder.filter((id) => registry.buildings.get(id).powerUse > 0));
  const genIds = new Set(registry.buildingOrder.filter((id) => registry.buildings.get(id).powerGen > 0));
  assert.ok(drawIds.size >= 2 && genIds.size >= 1, `test cards: draw ${[...drawIds]} gen ${[...genIds]}`);
  // The grid one tick after the step: cap 10, demand 9.5 × 1.08 = 10.26 (it was 0.95 ahead).
  const setup = (genAffordable) => {
    freshPlot();
    state.res.pop = 1000;
    derived.housing = 1000; // a housing need, so the human's first pick is a draw building
    derived.jobs = 2000;
    derived.employed = 1000;
    derived.powerCap = 10;
    derived.powerDemand = 9.5 * 1.08;
    derived.powerRatio = 10 / (9.5 * 1.08);
    for (const id of genIds) state.buildings[id] = genAffordable ? 0 : 400; // 40 · 1.15^400: out of reach
  };
  const drawUnits = (log) => log.filter((b) => drawIds.has(b.id)).reduce((a, b) => a + b.n, 0);
  const runs = [
    ['human strain', () => humanRun().log],
    ['human sticker', () => humanRun({ guard: 'sticker' }).log],
    ['greedy', () => recordBuys(() => botStep({ maxBuys: 25 }))],
  ];
  for (const [name, run] of runs) {
    // Generator out of reach: the step is bought (a lit card), the draw rows are affordable,
    // and not one unit of them goes in — the wallet goes to the rows that do not draw.
    setup(false);
    let log = run();
    assert.ok(state.upgrades['h-demand-step'], `${name}: buys the lit card`);
    assert.ok(log.length > 0, `${name}: the wallet still goes somewhere`);
    assert.equal(drawUnits(log), 0, `${name}: no draw unit while the grid is short and the generator is out of reach: ${JSON.stringify(log)}`);
    assert.ok(!log.some((b) => genIds.has(b.id)), `${name}: no generator was affordable: ${JSON.stringify(log)}`);
    // Generator in reach: it is the first building bought, before the housing the step wants.
    setup(true);
    log = run();
    assert.ok(log.length > 0, `${name}: buys`);
    assert.ok(genIds.has(log[0].id), `${name}: the generator comes first: ${JSON.stringify(log)}`);
  }
  assert.equal(errors.length, 0);
  resetState();
});

// The deep-push founding rule (docs/FEEDBACK.md F16): the game's gate is necessary, not
// sufficient. The prestige actions are the simulation module's, so they are stubbed here.
test('humanShouldFound: waits past an open gate until the haul is foundShare × the bank, then founds', () => {
  clearErrors();
  let can = true;
  let gain = 0;
  registerAction('canPrestige', () => can);
  registerAction('prestigeGain', () => gain);
  const owned = registerUpgrade({ id: 'hf-owned', name: 'Owned rung', cost: 100, effect: () => {} });
  const far = registerUpgrade({ id: 'hf-far', name: 'Far rung', cost: 1e6, effect: () => {} });
  assert.ok(owned && far);
  try {
    resetState();
    // Every registered money upgrade but the far rung is owned, so it is the cheapest target.
    for (const id of registry.upgradeOrder) state.upgrades[id] = true;
    delete state.upgrades['hf-far'];
    state.prestige.legacy = 100;
    state.res.money = 0;
    derived.income = 1;
    // Gate open, haul 41 (the game's own 0.4 × bank floor): the rule says wait at share 2.0.
    gain = 41;
    assert.equal(humanShouldFound({ foundShare: 2.0, foundReachMinutes: 0 }), false, 'haul below 2 × bank');
    assert.equal(humanShouldFound({ foundShare: 1.0, foundReachMinutes: 0 }), false, 'haul below 1 × bank');
    assert.equal(humanShouldFound({ foundShare: 0.1, foundReachMinutes: 0 }), true, 'the gate rule founds at the gate');
    // Haul 200 = 2 × bank: founds.
    gain = 200;
    assert.equal(humanShouldFound({ foundShare: 2.0, foundReachMinutes: 0 }), true);
    assert.equal(humanShouldFound({ foundShare: 2.0 + 1e-9, foundReachMinutes: 0 }), false, 'ceil(bank × share) is the floor');
    // The gate itself is never bypassed, whatever the haul.
    can = false;
    assert.equal(humanShouldFound({ foundShare: 0, foundReachMinutes: 0 }), false);
    can = true;
    // Out-of-targets check: the far rung is 1e6 s of income away → founds; with the rung
    // within 20 min of income → waits; owned or affordable → waits / founds accordingly.
    assert.equal(humanShouldFound({ foundShare: 2.0, foundReachMinutes: 20 }), true, 'no rung within 20 min: found');
    derived.income = 1e6 / 60; // one minute away
    assert.equal(humanShouldFound({ foundShare: 2.0, foundReachMinutes: 20 }), false, 'a rung one minute away: keep playing');
    state.res.money = 1e6;
    assert.equal(humanShouldFound({ foundShare: 2.0, foundReachMinutes: 20 }), false, 'an affordable rung is bought first, not founded past');
    state.upgrades['hf-far'] = true;
    assert.equal(humanShouldFound({ foundShare: 2.0, foundReachMinutes: 20 }), true, 'nothing left to buy: found');
    // The gate rule + reach: still a target in reach → waits even at the gate.
    delete state.upgrades['hf-far'];
    state.res.money = 0;
    assert.equal(humanShouldFound({ foundShare: 0.1, foundReachMinutes: 20 }), false);
    // Absurd prestigeMin floor still applies with a tiny bank.
    state.prestige.legacy = 0;
    gain = 4;
    assert.equal(humanShouldFound({ prestigeMin: 5, foundShare: 2.0, foundReachMinutes: 0 }), false);
    gain = 5;
    assert.equal(humanShouldFound({ prestigeMin: 5, foundShare: 2.0, foundReachMinutes: 0 }), true);
    // The profile's own step founds through api.prestige when the rule says so (the prestige
    // action is stubbed to count; nothing else is bought because the wallet is empty).
    let founded = 0;
    registerAction('prestige', () => (founded++, true));
    state.prestige.legacy = 100;
    gain = 41;
    botStep({ profile: 'human', maxBuys: 5, foundShare: 2.0, foundReachMinutes: 0 });
    assert.equal(founded, 0, 'step: gate open, rule says wait');
    gain = 200;
    botStep({ profile: 'human', maxBuys: 5, foundShare: 2.0, foundReachMinutes: 0 });
    assert.equal(founded, 1, 'step: rule says found');
    assert.equal(errors.length, 0);
  } finally {
    registerAction('canPrestige', () => false);
    registerAction('prestigeGain', () => 0);
    registerAction('prestige', () => false);
    resetState();
  }
});
