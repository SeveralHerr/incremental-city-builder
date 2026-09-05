// Unit tests for the simulation module. Run: node --test src/simulation/
// Pins the prestige rules (both legacy sources, the soft-capped payoff, the founding gate and
// what a founding keeps), the tuning fallbacks, the brownout predicate and the tick's
// bookkeeping. Explicit configs throughout so the expectations never move when balance
// retunes; one test checks that DEFAULTS still mirror src/balance/config.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, derived, loadState, createInitialState } from '../core/state.js';
import { on, off } from '../core/events.js';
import { registerBuilding, registry } from '../core/registry.js';
import { config } from '../balance/config.js';
import { DEFAULTS, LEGACY_POWER_MAX, prestigeTuning, economyTuning, milestoneTuning } from './tuning.js';
import {
  legacyIncomeMult,
  legacyEarningsScale,
  legacyFor,
  earningsForLegacy,
  prestigeGain,
  canPrestige,
  startMoneyFor,
  applyPrestigeMods,
  nextLegacyAt,
  prestigeUnlockAt,
  runEarningsForGain,
  prestigeStatus,
  performPrestige,
  maturityOf,
} from './prestige.js';
import { MILESTONES, REWARDED_MILESTONES, isBrownout, getMilestone, pendingMilestones, applyMilestoneMods } from './milestones.js';
import { simulate, recompute, foldMods, seedStartMoney } from './index.js';
import { createMods } from '../core/mods.js';

const near = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} != ${b}`);

// A plain prestige config: linear +4%/point, no cap, no first bonus, no compounding.
const PLAIN = {
  prestige: {
    threshold: 1e6,
    exponent: 0.5,
    incomePerLegacy: 0.04,
    legacyPower: 1,
    legacyCap: 0,
    legacyCapTail: 0,
    firstBonus: 0,
    compoundPerMinute: 0,
    legacyDiscount: 0,
    startMoneyPerLegacy: 0.1,
    minGain: 3,
  },
  economy: { startMoney: 260, tapSeconds: 1 },
};
const withPrestige = (over) => ({ ...PLAIN, prestige: { ...PLAIN.prestige, ...over } });

function fakeState({ legacy = 0, totalEarned = 0, lifetimeEarned = totalEarned, peakIncome = 0 } = {}) {
  const s = createInitialState();
  s.prestige.legacy = legacy;
  s.prestige.lifetimeEarned = lifetimeEarned;
  s.stats.totalEarned = totalEarned;
  s.stats.peakIncome = peakIncome;
  return s;
}

// --- tuning -------------------------------------------------------------------

test('DEFAULTS mirror the shipped balance config', () => {
  for (const k of Object.keys(DEFAULTS.prestige)) {
    if (config.prestige[k] === undefined) continue; // balance may leave a knob on its fallback
    assert.equal(DEFAULTS.prestige[k], config.prestige[k], `prestige.${k}`);
  }
  assert.equal(DEFAULTS.economy.startMoney, config.economy.startMoney);
  assert.equal(DEFAULTS.economy.tapSeconds, config.economy.tapSeconds);
  assert.equal(DEFAULTS.milestones.popIncomeBonus, config.milestones.popIncomeBonus);
});

test('tuning falls back to DEFAULTS for a missing or malformed config and clamps every knob', () => {
  for (const cfg of [undefined, null, {}, { prestige: 'nope', economy: 7 }, { prestige: { threshold: -1, exponent: 'x', minGain: NaN } }]) {
    const p = prestigeTuning(cfg);
    assert.equal(p.threshold, DEFAULTS.prestige.threshold);
    assert.equal(p.exponent, DEFAULTS.prestige.exponent);
    assert.equal(p.minGain, DEFAULTS.prestige.minGain);
    assert.equal(economyTuning(cfg).startMoney, DEFAULTS.economy.startMoney);
    assert.equal(milestoneTuning(cfg).popIncomeBonus, DEFAULTS.milestones.popIncomeBonus);
  }
  const p = prestigeTuning({ prestige: { legacyPower: 9, legacyDiscount: 4, minGain: 0.2, exponent: 0, incomePerLegacy: -1, legacyCap: -5 } });
  assert.equal(p.legacyPower, LEGACY_POWER_MAX);
  assert.equal(p.legacyDiscount, 1);
  assert.equal(p.minGain, 1);
  assert.equal(p.exponent, 0.05);
  assert.equal(p.incomePerLegacy, 0);
  assert.equal(p.legacyCap, 0);
});

// --- payoff ---------------------------------------------------------------------

test('legacyIncomeMult: 1 without legacy, linear +k per point, power and first bonus applied', () => {
  assert.equal(legacyIncomeMult(0, PLAIN), 1);
  assert.equal(legacyIncomeMult(NaN, PLAIN), 1);
  assert.equal(legacyIncomeMult(-3, PLAIN), 1);
  near(legacyIncomeMult(3, PLAIN), 1.12, 'linear 3 points');
  near(legacyIncomeMult(25, PLAIN), 2, 'linear 25 points');
  near(legacyIncomeMult(3, withPrestige({ firstBonus: 0.5 })), 1.12 * 1.5, 'first bonus');
  near(legacyIncomeMult(25, withPrestige({ legacyPower: 2 })), 4, 'power 2');
  near(legacyIncomeMult(2.9, PLAIN), 1.08, 'fractional legacy floors');
});

test('legacyIncomeMult soft cap: slope preserved near zero, bounded by the cap, still monotone', () => {
  const capped = withPrestige({ legacyCap: 100 });
  near(legacyIncomeMult(1, capped), 1.04, 'first point unchanged by the cap', 1e-3);
  let prev = 1;
  for (const L of [10, 100, 1000, 1e4, 1e6, 1e9]) {
    const m = legacyIncomeMult(L, capped);
    assert.ok(m >= prev, `monotone at ${L}`);
    assert.ok(m <= 100, `bounded at ${L}: ${m}`);
    prev = m;
  }
  const tailed = withPrestige({ legacyCap: 100, legacyCapTail: 0.05 });
  const m9 = legacyIncomeMult(1e9, tailed);
  assert.ok(m9 > 100 && m9 < 100 * 2, `tail keeps growing slowly past the cap: ${m9}`);
  assert.ok(Number.isFinite(legacyIncomeMult(1e300, tailed)));
});

test('applyPrestigeMods folds the multiplier into mods.income only when legacy exists', () => {
  const m0 = applyPrestigeMods(createMods(), fakeState(), PLAIN);
  assert.equal(m0.income, 1);
  const m1 = applyPrestigeMods(createMods(), fakeState({ legacy: 25 }), PLAIN);
  near(m1.income, 2, 'x2 at 25 points');
});

// --- legacy sources ---------------------------------------------------------------

test('legacyFor / earningsForLegacy are inverses and floor to whole points', () => {
  assert.equal(legacyFor(0, PLAIN), 0);
  assert.equal(legacyFor(999999, PLAIN), 0);
  assert.equal(legacyFor(1e6, PLAIN), 1);
  assert.equal(legacyFor(9e6 - 1, PLAIN), 2);
  assert.equal(legacyFor(9e6, PLAIN), 3);
  for (const n of [1, 3, 10, 250]) assert.equal(legacyFor(earningsForLegacy(n, PLAIN), PLAIN), n, `inverse at ${n}`);
  assert.equal(earningsForLegacy(0, PLAIN), 0);
  assert.equal(legacyFor(NaN, PLAIN), 0);
  assert.equal(legacyFor(Infinity, PLAIN), 0);
});

test('prestigeGain is the lifetime worth minus the bank; the gate needs minGain points', () => {
  assert.equal(prestigeGain(fakeState(), PLAIN), 0);
  assert.equal(canPrestige(fakeState({ totalEarned: 4e6 }), PLAIN), false); // worth 2
  const first = fakeState({ totalEarned: 9e6 });
  assert.equal(prestigeGain(first, PLAIN), 3);
  assert.equal(canPrestige(first, PLAIN), true);
  // Banked points are subtracted: the same lifetime is worth nothing new.
  const banked = fakeState({ legacy: 3, totalEarned: 0, lifetimeEarned: 9e6 });
  assert.equal(prestigeGain(banked, PLAIN), 0);
  // A hand-edited lifetime below this run's total never yields negative gain.
  const broken = fakeState({ legacy: 5, totalEarned: 9e6, lifetimeEarned: 1 });
  assert.equal(prestigeGain(broken, PLAIN), 0);
  assert.equal(canPrestige(broken, PLAIN), false);
});

test('legacyDiscount: earnings count as lifetime / mult^discount, so a bonus never speeds the next points', () => {
  const cfg = withPrestige({ legacyDiscount: 1 });
  assert.equal(legacyEarningsScale(0, cfg), 1);
  near(legacyEarningsScale(25, cfg), 0.5, 'x2 bonus halves what counts');
  near(legacyEarningsScale(25, withPrestige({ legacyDiscount: 0.5 })), Math.SQRT1_2, 'half discount');
  // 25 banked, mult 2: the lifetime worth 26 points is 26^2 * 1e6 * 2.
  const s = fakeState({ legacy: 25, totalEarned: 676e6 * 2 - 1, lifetimeEarned: 676e6 * 2 - 1 });
  assert.equal(prestigeGain(s, cfg), 0);
  s.stats.totalEarned += 1;
  s.prestige.lifetimeEarned += 1;
  assert.equal(prestigeGain(s, cfg), 1);
});

test('compounding: a mature city adds legacy · minutes of peak income · rate', () => {
  const cfg = withPrestige({ compoundPerMinute: 0.025 });
  // 100 banked, peak $100/s, $60k earned this run = 600 s of peak income = 10 min -> +25.
  const s = fakeState({ legacy: 100, totalEarned: 60000, lifetimeEarned: 5e8, peakIncome: 100 });
  near(maturityOf(s), 600, 'maturity in seconds');
  assert.equal(prestigeGain(s, cfg), 25);
  assert.equal(canPrestige(s, cfg), true);
  // No peak income yet -> no maturity -> nothing compounds.
  assert.equal(prestigeGain(fakeState({ legacy: 100, totalEarned: 60000, lifetimeEarned: 5e8 }), cfg), 0);
  // Without legacy there is nothing to compound.
  assert.equal(prestigeGain(fakeState({ totalEarned: 60000, peakIncome: 100 }), cfg), 0);
});

test('runEarningsForGain brackets the exact earnings for n points and is monotone in n', () => {
  const cfg = withPrestige({ compoundPerMinute: 0.025, legacyDiscount: 1, firstBonus: 0.5, legacyCap: 100 });
  const s = fakeState({ legacy: 40, totalEarned: 2e6, lifetimeEarned: 3e9, peakIncome: 5000 });
  let prev = 0;
  for (const n of [1, 3, 10, 50]) {
    const at = runEarningsForGain(s, n, cfg);
    assert.ok(at >= prev, `monotone at ${n}`);
    prev = at;
    const probe = (E) => {
      const t = fakeState({ legacy: 40, totalEarned: E, lifetimeEarned: 3e9 - 2e6 + E, peakIncome: 5000 });
      return prestigeGain(t, cfg);
    };
    assert.ok(probe(at * (1 + 1e-5)) >= n, `reaches ${n} just above the target`);
    assert.ok(probe(at * (1 - 1e-4)) < n, `not yet ${n} just below the target`);
  }
  assert.equal(runEarningsForGain(s, 0, cfg), 0);
  // Already past the target: the answer is at or below the current total (a full bar).
  const rich = fakeState({ legacy: 40, totalEarned: 5e9, lifetimeEarned: 8e9, peakIncome: 5000 });
  assert.ok(runEarningsForGain(rich, 1, cfg) <= 5e9);
  assert.ok(nextLegacyAt(rich, cfg) > 5e9);
  assert.ok(prestigeUnlockAt(fakeState(), cfg) === earningsForLegacy(3, cfg));
});

test('prestigeStatus fills the UI snapshot and can keep the previous targets', () => {
  const cfg = withPrestige({ firstBonus: 0.5 });
  const s = fakeState({ legacy: 3, totalEarned: 55e6, lifetimeEarned: 64e6 });
  const out = prestigeStatus(s, {}, cfg);
  assert.equal(out.legacy, 3);
  assert.equal(out.gain, 5);
  assert.equal(out.can, true);
  assert.equal(out.minGain, 3);
  near(out.mult, 1.12 * 1.5, 'mult now');
  near(out.multAfter, 1.32 * 1.5, 'mult after founding');
  assert.equal(out.lifetimeEarned, 64e6);
  assert.ok(out.unlockAt > 0 && out.unlockAt <= 55e6);
  assert.ok(out.nextAt > 55e6);
  const keep = { nextAt: 123, unlockAt: 45 };
  prestigeStatus(s, keep, cfg, false);
  assert.equal(keep.nextAt, 123);
  assert.equal(keep.unlockAt, 45);
  assert.equal(keep.gain, 5);
});

test('startMoneyFor grows linearly with the bank', () => {
  assert.equal(startMoneyFor(0, PLAIN), 260);
  near(startMoneyFor(10, PLAIN), 520, 'ten points');
  assert.equal(startMoneyFor(NaN, PLAIN), 260);
});

// --- founding -------------------------------------------------------------------

test('performPrestige banks the gain, resets the run, keeps the bank, lifetime, settings and the log tail', () => {
  loadState({
    res: { money: 5e6, pop: 12000 },
    buildings: { house: 40, factory: 12 },
    upgrades: { 'zoning-reform': true },
    unlocks: { 'm:pop-1k': true, 'panel:prestige': true },
    stats: { totalEarned: 9e6, peakPop: 12000, buildingsBuilt: 52, prestiges: 0, playtime: 1800, clicks: 7, peakIncome: 9000 },
    prestige: { legacy: 0, spent: 0, lifetimeEarned: 9e6 },
    settings: { autosave: false, numFormat: 'full', sfx: false },
    log: Array.from({ length: 30 }, (_, i) => ({ t: i, msg: `line ${i}`, kind: 'info' })),
    time: 1800,
    tick: 18000,
  });
  const events = [];
  const onPrestige = (e) => events.push(e);
  on('prestige', onPrestige);
  let resetSeen = false;
  const cfg = withPrestige({ firstBonus: 0.5 });
  const ok = performPrestige(state, cfg, (s) => {
    resetSeen = s === state;
  });
  off('prestige', onPrestige);
  assert.equal(ok, true);
  assert.equal(resetSeen, true);
  assert.equal(state.prestige.legacy, 3);
  assert.equal(state.prestige.lifetimeEarned, 9e6);
  assert.equal(state.stats.prestiges, 1);
  assert.equal(state.stats.totalEarned, 0);
  assert.equal(state.stats.peakIncome, 0);
  assert.equal(state.stats.peakPop, 0);
  assert.equal(state.stats.buildingsBuilt, 0);
  assert.equal(state.stats.playtime, 1800);
  assert.equal(state.stats.clicks, 7);
  near(state.res.money, startMoneyFor(3, cfg), 'seed cash');
  assert.equal(state.res.pop, 0);
  assert.deepEqual(state.buildings, {});
  assert.deepEqual(state.upgrades, {});
  assert.deepEqual(state.unlocks, {});
  assert.deepEqual(state.settings, { autosave: false, numFormat: 'full', sfx: false });
  assert.equal(state.time, 0);
  assert.equal(state.tick, 0);
  // Log: the last 20 lines of the old city, then the founding lines.
  assert.equal(state.log.length, 22);
  assert.equal(state.log[0].msg, 'line 10');
  assert.equal(state.log[19].msg, 'line 29');
  assert.match(state.log[20].msg, /^City #2 founded\. The last one peaked at 12,000 citizens and earned \$9,000,000\./);
  assert.equal(state.log[20].kind, 'prestige');
  assert.match(state.log[21].msg, /^\+3 legacy \(3 total\): income ×1\.68 on top of the old bonus, \+68% over a fresh start, forever\./);
  assert.deepEqual(events, [{ gain: 3, legacy: 3, mult: legacyIncomeMult(3, cfg) }]);
  // A second founding straight away has nothing to bank.
  assert.equal(performPrestige(state, cfg), false);
  assert.equal(state.stats.prestiges, 1);
  loadState({});
});

test('performPrestige refuses below minGain and leaves the state untouched', () => {
  loadState({ stats: { totalEarned: 4e6 }, prestige: { lifetimeEarned: 4e6 }, res: { money: 123, pop: 5 }, buildings: { house: 2 } });
  assert.equal(performPrestige(state, PLAIN), false);
  assert.equal(state.res.money, 123);
  assert.deepEqual(state.buildings, { house: 2 });
  assert.equal(state.prestige.legacy, 0);
  loadState({});
});

// --- milestones -----------------------------------------------------------------

test('milestone list: unique ids, precomputed keys, the ids other modules depend on, rewards fold', () => {
  const ids = new Set();
  for (const m of MILESTONES) {
    assert.ok(!ids.has(m.id), `duplicate ${m.id}`);
    ids.add(m.id);
    assert.equal(m.key, 'm:' + m.id);
    assert.equal(typeof m.check, 'function');
    assert.equal(typeof m.progress, 'function');
    assert.ok(m.name && m.icon && m.desc && m.metric && m.target > 0, `shape of ${m.id}`);
  }
  for (const id of ['pop-100', 'pop-1k', 'pop-10k', 'pop-100k', 'money-1k', 'money-100k', 'money-1m', 'money-1b', 'brownout', 'first-upgrade', 'buildings-100', 'prestige-1']) {
    assert.ok(getMilestone(id), `contract id ${id}`);
  }
  assert.ok(REWARDED_MILESTONES.length >= 20);
  const s = createInitialState();
  s.unlocks['m:pop-10'] = true;
  s.unlocks['m:legacy-5'] = true;
  const mods = applyMilestoneMods(createMods(), s);
  assert.ok(mods.income > 1 && mods.income < 1.05, 'pop milestone +2%');
  near(mods.cost, 0.95, 'legacy-5 costs -5%');
  assert.equal(pendingMilestones(s).length, MILESTONES.length - 2);
  // A partially built state never throws.
  for (const m of MILESTONES) {
    assert.equal(m.check({}, undefined), false, `check ${m.id} on empty state`);
    assert.ok(m.progress({}, undefined) >= 0, `progress ${m.id} on empty state`);
  }
});

test('isBrownout needs an existing grid: the first cottage on zero capacity is not a brownout', () => {
  assert.equal(isBrownout({ powerDemand: 1, powerCap: 0, powerRatio: 0.4 }), false);
  assert.equal(isBrownout({ powerDemand: 0, powerCap: 6, powerRatio: 1 }), false);
  assert.equal(isBrownout({ powerDemand: 10, powerCap: 6, powerRatio: 0.6 }), true);
  assert.equal(isBrownout(undefined), false);
});

// --- the tick ---------------------------------------------------------------------

test('simulate integrates money and population, tracks peak income, and never logs a brownout without a grid', () => {
  if (!registry.buildings.has('t-hut')) {
    registerBuilding({ id: 't-hut', name: 'Hut', icon: 'h', desc: 'test', category: 'residential', tier: 1, baseCost: 10, costGrowth: 1.1, housing: 4, powerUse: 1 });
    registerBuilding({ id: 't-mill', name: 'Mill', icon: 'm', desc: 'test', category: 'power', tier: 1, baseCost: 10, costGrowth: 1.1, powerGen: 6 });
    registerBuilding({ id: 't-shop', name: 'Shop', icon: 's', desc: 'test', category: 'commercial', tier: 1, baseCost: 10, costGrowth: 1.1, jobs: 5, income: 1 });
  }
  loadState({ res: { money: 100, pop: 0 }, buildings: { 't-hut': 1 } });
  recompute(state, derived);
  assert.equal(derived.powerDemand > 0 && derived.powerCap === 0, true);
  for (let i = 0; i < 50; i++) simulate(state, derived, 0.1);
  assert.equal(state.log.filter((l) => l.kind === 'brownout').length, 0, 'no brownout line without a generator');
  assert.equal(state.unlocks['panel:power'], true, 'the power panel gate still opens on first demand');
  assert.ok(state.res.pop > 0 && state.res.pop <= derived.housing, 'citizens move in, never overshoot housing');
  // Money and the per-run peak follow gross income.
  state.buildings['t-mill'] = 1;
  state.buildings['t-shop'] = 1;
  const money0 = state.res.money;
  for (let i = 0; i < 100; i++) simulate(state, derived, 0.1);
  assert.ok(state.res.money > money0, 'money grows');
  assert.ok(state.stats.totalEarned > 0 && state.prestige.lifetimeEarned >= state.stats.totalEarned);
  assert.ok(state.stats.peakIncome > 0 && state.stats.peakIncome >= derived.grossIncome * 0.999, 'peak income tracked');
  assert.ok(derived.extra.prestige && derived.extra.prestige.legacy === 0 && derived.extra.prestige.can === false);
  // A real brownout (demand above an existing capacity) is logged exactly once.
  state.buildings['t-hut'] = 20;
  for (let i = 0; i < 5; i++) simulate(state, derived, 0.1);
  assert.equal(state.log.filter((l) => l.kind === 'brownout').length, 1, 'one brownout line');
  assert.equal(state.unlocks['m:brownout'], true);
  loadState({});
});

test('foldMods sanitizes and seedStartMoney only seeds a fresh state', () => {
  loadState({});
  const mods = foldMods(state);
  assert.equal(mods.income, 1);
  assert.equal(mods.inflow, 1);
  assert.equal(mods.demand, 1);
  assert.equal(seedStartMoney(state), true);
  assert.equal(state.res.money, economyTuning(config).startMoney);
  assert.equal(seedStartMoney(state), false);
  loadState({});
});
