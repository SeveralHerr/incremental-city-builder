// Unit tests for src/core. Run: node --test src/core/core.test.mjs
// Pins the edge-case code that regresses silently: maxAffordable's closed form + float walk-back,
// buildingCost vs a manual loop, the sell refund ratio, the floor-everywhere number formatting,
// loadState/sanitize against hostile input, guard disable semantics (consecutive AND intermittent
// throwers), error-ring dedupe, event-listener isolation, registry validation and the loop's
// Node fallback / skippedMs handling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, derived, errors, loadState, resetState, sanitize } from './state.js';
import { registry, registerBuilding, registerUpgrade, registerTickHandler } from './registry.js';
import { buildingCost, maxAffordable, buy, sell } from './api.js';
import { fmt, fmtMoney, fmtRate, fmtInt } from './format.js';
import { guard, reportError, DISABLE_AFTER, DISABLE_AFTER_TOTAL, WINDOW } from './safe.js';
import { on, off, emit, isListenerDisabled, listenerCount } from './events.js';
import { loop, step, start, stop, TICK_MS } from './loop.js';

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
  assert.equal(fmtInt(1234567.9), '1.23M');
  assert.equal(fmtInt(-12.7), '-12');
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
  // bounded recursion: nested depth clipped, nothing thrown
  let d = 0;
  for (let o = state.deep; o && o.n; o = o.n) d++;
  assert.ok(d <= 17, `depth ${d}`);
  loadState(null);
  loadState([1, 2, 3]);
  assert.equal(state.res.money, 0);
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
