// Unit tests for the simulation module. Run: node src/simulation/simulation.test.mjs
// Pins the prestige rules (earnings-only legacy, the share-of-bank founding gate, legacy as a
// currency, what a founding keeps), the tuning fallbacks, the legacy tier ladder, the
// brownout predicate and the tick's bookkeeping. Explicit configs throughout so the
// expectations never move when balance retunes; the shipped config is only imported, never
// hand-mirrored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, derived, loadState, createInitialState, resetState } from '../core/state.js';
import { on, off } from '../core/events.js';
import { registerBuilding, registry } from '../core/registry.js';
import { config } from '../balance/config.js';
import { DEFAULTS, LEGACY_POWER_MAX, prestigeTuning, economyTuning, milestoneTuning } from './tuning.js';
import {
  legacyIncomeMult,
  foundingLine,
  legacyFor,
  legacyWorth,
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
  requiredGain,
  legacyOf,
  spentOf,
  availableOf,
  lifetimeEarnedOf,
  prestigeConfig,
} from './prestige.js';
import { MILESTONES, REWARDED_MILESTONES, LEGACY_MILESTONES, nextLegacyMilestone, isBrownout, getMilestone, pendingMilestones, applyMilestoneMods } from './milestones.js';
import { simulate, recompute, foldMods, seedStartMoney, markFounding, tap, tapSecondsFor, prestigeSnapshot } from './index.js';
import { createMods } from '../core/mods.js';

const near = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} != ${b}`);

// A plain prestige config: linear +4%/point (power 1 is clamped to LEGACY_POWER_MAX, so
// PLAIN uses 0.5 and the linear checks below use k·L values that are exact squares), no
// first bonus, no share-of-bank gate.
const PLAIN = {
  prestige: {
    threshold: 1e6,
    exponent: 0.5,
    incomePerLegacy: 0.04,
    legacyPower: 0.5,
    firstBonus: 0,
    startMoneyPerLegacy: 0.1,
    minGain: 3,
    minGainShare: 0,
    prestigePanelShare: 0.1,
  },
  economy: { startMoney: 260, tapSeconds: 1 },
};
const withPrestige = (over) => ({ ...PLAIN, prestige: { ...PLAIN.prestige, ...over } });

function fakeState({ legacy = 0, spent = 0, totalEarned = 0, lifetimeEarned = totalEarned } = {}) {
  const s = createInitialState();
  s.prestige.legacy = legacy;
  s.prestige.spent = spent;
  s.prestige.lifetimeEarned = lifetimeEarned;
  s.stats.totalEarned = totalEarned;
  return s;
}

// --- tuning -------------------------------------------------------------------

test('the shipped config resolves knob for knob (no hand-mirrored numbers in this file)', () => {
  const p = prestigeTuning(config);
  const raw = config.prestige || {};
  for (const k of Object.keys(DEFAULTS.prestige)) {
    assert.equal(typeof p[k], 'number', `prestige.${k} resolved`);
    assert.ok(Number.isFinite(p[k]), `prestige.${k} finite`);
    if (typeof raw[k] !== 'number' || !Number.isFinite(raw[k])) continue; // balance may leave a knob on its fallback
    if (k === 'legacyPower') assert.ok(p[k] <= LEGACY_POWER_MAX && p[k] <= Math.max(raw[k], 0.25), 'legacyPower clamped to the contract ceiling');
    else if (k === 'minGain') assert.equal(p[k], Math.max(1, Math.floor(raw[k])));
    else if (k === 'exponent') assert.equal(p[k], Math.min(1, Math.max(0.05, raw[k])));
    else assert.equal(p[k], Math.max(0, raw[k]), `prestige.${k} tracks config`);
  }
  assert.ok(p.threshold > 0 && p.exponent <= 1, 'the bank grows no faster than earnings');
  assert.ok(LEGACY_POWER_MAX <= 0.6, 'contract principle 4: legacyPower ≤ 0.6');
  assert.equal(economyTuning(config).startMoney, config.economy.startMoney);
  assert.equal(milestoneTuning(config).popIncomeBonus, config.milestones.popIncomeBonus);
  // The removed knobs are gone from the resolver, however the config spells them.
  for (const k of ['compoundPerMinute', 'peakCarry', 'compoundCap', 'ripenSeconds', 'legacyDiscount', 'legacyCap', 'legacyCapTail', 'legacyCapTailPower']) {
    assert.equal(k in p, false, `${k} removed`);
    assert.equal(k in DEFAULTS.prestige, false, `${k} removed from DEFAULTS`);
  }
  const cfg = prestigeConfig(config);
  assert.equal(cfg.startMoney, config.economy.startMoney);
  assert.equal(cfg.threshold, p.threshold);
});

test('DEFAULTS mirrors src/balance/config.js knob for knob (a missing section runs the shipped economy)', () => {
  assert.deepEqual(DEFAULTS.prestige, config.prestige, 'DEFAULTS.prestige drifted from config.prestige');
  for (const section of ['economy', 'milestones']) {
    for (const key of Object.keys(DEFAULTS[section])) {
      assert.equal(DEFAULTS[section][key], config[section][key], `DEFAULTS.${section}.${key} drifted from config`);
    }
  }
  // …and the resolver returns those very numbers when the config is absent.
  const p = prestigeTuning(null);
  for (const k of Object.keys(config.prestige)) assert.equal(p[k], config.prestige[k], `fallback ${k}`);
});

test('tuning falls back to DEFAULTS for a missing or malformed config and clamps every knob', () => {
  // `undefined` would select the default parameter (the shipped config); null is the
  // "no config at all" case the resolver treats as an empty section.
  for (const cfg of [null, {}, { prestige: 'nope', economy: 7 }, { prestige: { threshold: -1, exponent: 'x', minGain: NaN } }]) {
    const p = prestigeTuning(cfg);
    assert.equal(p.threshold, DEFAULTS.prestige.threshold);
    assert.equal(p.exponent, DEFAULTS.prestige.exponent);
    assert.equal(p.minGain, DEFAULTS.prestige.minGain);
    assert.equal(p.prestigePanelShare, DEFAULTS.prestige.prestigePanelShare);
    assert.equal(economyTuning(cfg).startMoney, DEFAULTS.economy.startMoney);
    assert.equal(milestoneTuning(cfg).popIncomeBonus, DEFAULTS.milestones.popIncomeBonus);
  }
  const p = prestigeTuning({ prestige: { legacyPower: 9, minGain: 0.2, exponent: 0, incomePerLegacy: -1, minGainShare: 2, prestigePanelShare: -3, compoundPerMinute: 0.5 } });
  assert.equal(p.legacyPower, LEGACY_POWER_MAX);
  assert.equal(p.minGain, 1);
  assert.equal(p.exponent, 0.05);
  assert.equal(p.incomePerLegacy, 0);
  assert.equal(p.minGainShare, 1);
  assert.equal(p.prestigePanelShare, 0);
  assert.equal('compoundPerMinute' in p, false, 'a stale knob in the config is ignored');
  assert.equal(prestigeTuning({ prestige: { exponent: 2 } }).exponent, 1, 'exponent capped at 1');
  assert.equal(prestigeTuning({ prestige: { legacyPower: 0.1 } }).legacyPower, 0.25, 'legacyPower floor');
});

test('tuning is memoized on the raw values: same object back until a knob changes, no per-call allocation', () => {
  const cfg = { prestige: { threshold: 5e5, exponent: 0.4 }, economy: { startMoney: 100 }, milestones: {} };
  const a = prestigeTuning(cfg);
  assert.equal(prestigeTuning(cfg), a, 'same resolved object');
  assert.ok(Object.isFrozen(a));
  assert.equal(a.threshold, 5e5);
  cfg.prestige.exponent = 0.5; // a runtime retune is picked up on the next call
  const b = prestigeTuning(cfg);
  assert.notEqual(b, a);
  assert.equal(b.exponent, 0.5);
  assert.equal(prestigeTuning(cfg), b);
  cfg.prestige.minGain = NaN; // a NaN knob falls back and still memoizes (Object.is)
  const c = prestigeTuning(cfg);
  assert.equal(c.minGain, DEFAULTS.prestige.minGain);
  assert.equal(prestigeTuning(cfg), c);
  assert.equal(economyTuning(cfg), economyTuning(cfg));
  assert.equal(milestoneTuning(cfg), milestoneTuning(cfg));
  // The shipped config resolves to one shared object across the whole tick path.
  assert.equal(prestigeTuning(config), prestigeTuning(config));
});

// --- payoff ---------------------------------------------------------------------

test('legacyIncomeMult: 1 without legacy, a root of the linear term, first bonus applied once', () => {
  assert.equal(legacyIncomeMult(0, PLAIN), 1);
  assert.equal(legacyIncomeMult(NaN, PLAIN), 1);
  assert.equal(legacyIncomeMult(-3, PLAIN), 1);
  near(legacyIncomeMult(25, PLAIN), Math.SQRT2, 'sqrt(1 + 0.04·25)');
  near(legacyIncomeMult(75, PLAIN), 2, 'sqrt(4)');
  near(legacyIncomeMult(75, withPrestige({ firstBonus: 0.5 })), 3, 'first bonus');
  near(legacyIncomeMult(1, withPrestige({ firstBonus: 0.5 })), Math.sqrt(1.04) * 1.5, 'first bonus from the first point');
  near(legacyIncomeMult(75, withPrestige({ legacyPower: 0.25 })), Math.SQRT2, 'power 0.25');
  near(legacyIncomeMult(75, withPrestige({ legacyPower: 1 })), Math.pow(4, LEGACY_POWER_MAX), 'power clamped to the ceiling');
  near(legacyIncomeMult(75.9, PLAIN), 2, 'fractional legacy floors');
});

test('legacyIncomeMult is monotone, finite and bounded: a million points stay under ×800 at p ≤ 0.6', () => {
  const cfg = withPrestige({ legacyPower: 0.6, firstBonus: 0.3 });
  let prev = 1;
  for (const L of [1, 10, 100, 1000, 1e4, 1e5, 1e6, 1e9, 1e300]) {
    const m = legacyIncomeMult(L, cfg);
    assert.ok(Number.isFinite(m) && m >= prev, `monotone and finite at ${L}`);
    prev = m;
  }
  // (1 + 0.04·1e6)^0.6 = ×577, ×750 with the 30% first bonus; ×200 at p 0.5 without it.
  assert.ok(legacyIncomeMult(1e6, cfg) < 800, `1e6 points: ${legacyIncomeMult(1e6, cfg)}`);
  assert.ok(legacyIncomeMult(1e6, PLAIN) < 210, `1e6 points at p 0.5: ${legacyIncomeMult(1e6, PLAIN)}`);
  // A founding that grows the bank by a quarter is always worth the same ratio: 1.25^p.
  for (const L of [1e4, 1e5, 1e6]) near(legacyIncomeMult(L * 1.25, cfg) / legacyIncomeMult(L, cfg), Math.pow(1.25, 0.6), `elasticity at ${L}`, 1e-3);
});

test('applyPrestigeMods folds the FULL bank into mods.income whatever has been spent', () => {
  const m0 = applyPrestigeMods(createMods(), fakeState(), PLAIN);
  assert.equal(m0.income, 1);
  const m1 = applyPrestigeMods(createMods(), fakeState({ legacy: 75 }), PLAIN);
  near(m1.income, 2, 'x2 at 75 points');
  const m2 = applyPrestigeMods(createMods(), fakeState({ legacy: 75, spent: 70 }), PLAIN);
  near(m2.income, 2, 'spending never lowers the bonus');
  const m3 = applyPrestigeMods(createMods(), fakeState({ legacy: 75, spent: 500 }), PLAIN);
  near(m3.income, 2, 'even an over-spent bank (hand-edited save) keeps its bonus');
});

// --- legacy: one source, lifetime earnings --------------------------------------

test('legacyFor / earningsForLegacy are inverses and floor to whole points', () => {
  assert.equal(legacyFor(0, PLAIN), 0);
  assert.equal(legacyFor(999999, PLAIN), 0);
  assert.equal(legacyFor(1e6, PLAIN), 1);
  assert.equal(legacyFor(9e6 - 1, PLAIN), 2);
  assert.equal(legacyFor(9e6, PLAIN), 3);
  near(legacyWorth(9e6, PLAIN), 3, 'unfloored worth');
  assert.equal(legacyWorth(5e5, PLAIN), 0);
  for (const n of [1, 3, 10, 250, 1e6]) assert.equal(legacyFor(earningsForLegacy(n, PLAIN), PLAIN), n, `inverse at ${n}`);
  assert.equal(earningsForLegacy(0, PLAIN), 0);
  assert.equal(legacyFor(NaN, PLAIN), 0);
  assert.equal(legacyFor(Infinity, PLAIN), 0);
  // Contract magnitudes: 1e18 lifetime at the shipped exponent is still a bounded bank.
  const life = legacyFor(1e18, config);
  assert.ok(Number.isFinite(life) && life > 0 && life <= 1e6, `1e18 lifetime → ${life} legacy (contract ≤ 1e6)`);
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
  // Earlier runs count: 3 banked from $9M, this run adds $16M → lifetime $25M is worth 5.
  const veteran = fakeState({ legacy: 3, totalEarned: 16e6, lifetimeEarned: 25e6 });
  assert.equal(prestigeGain(veteran, PLAIN), 2);
  // A hand-edited lifetime below this run's total never yields negative gain.
  const broken = fakeState({ legacy: 5, totalEarned: 9e6, lifetimeEarned: 1 });
  assert.equal(prestigeGain(broken, PLAIN), 0);
  assert.equal(canPrestige(broken, PLAIN), false);
  assert.equal(lifetimeEarnedOf(broken), 9e6, 'lifetime is never below this run');
  // No compounding, no time: the same earnings are worth the same points whatever the run's
  // age or income, and an idle city with a huge bank banks nothing.
  const idle = fakeState({ legacy: 1000, totalEarned: 60000, lifetimeEarned: 1e12 + 60000 });
  idle.time = 36000;
  idle.stats.playtime = 1e6;
  assert.equal(prestigeGain(idle, PLAIN), 0);
  assert.equal(canPrestige(idle, PLAIN), false);
});

test('the income bonus never speeds the next points: the bank grows only as lifetime ^ exponent', () => {
  // Whatever the multiplier, lifetime earnings L are worth floor((L/T)^e) — no discount, no
  // shortcut. Doubling the bank (25 → 50 at k 0.04, p 0.5: mult ×1.22) needs lifetime ×4.
  const at25 = earningsForLegacy(25, PLAIN);
  const at50 = earningsForLegacy(50, PLAIN);
  near(at50 / at25, 4, 'exponent 0.5: ×4 earnings for ×2 legacy');
  const s = fakeState({ legacy: 25, totalEarned: at50 - at25 - 1, lifetimeEarned: at50 - 1 });
  assert.equal(prestigeGain(s, PLAIN), 24);
  s.stats.totalEarned += 1;
  s.prestige.lifetimeEarned += 1;
  assert.equal(prestigeGain(s, PLAIN), 25);
});

test('runEarningsForGain is the closed-form target, monotone in n, exact at the boundary', () => {
  const cfg = withPrestige({ firstBonus: 0.5 });
  // 40 banked from $1.6B of earlier runs; this run has earned $2M so far.
  const earlier = earningsForLegacy(40, cfg);
  const s = fakeState({ legacy: 40, totalEarned: 2e6, lifetimeEarned: earlier + 2e6 });
  let prev = 0;
  for (const n of [1, 3, 10, 50]) {
    const at = runEarningsForGain(s, n, cfg);
    assert.ok(at >= prev, `monotone at ${n}`);
    prev = at;
    near(at, earningsForLegacy(40 + n, cfg) - earlier, `closed form at ${n}`);
    const probe = (E) => prestigeGain(fakeState({ legacy: 40, totalEarned: E, lifetimeEarned: earlier + E }), cfg);
    assert.ok(probe(at * (1 + 1e-9)) >= n, `reaches ${n} just above the target`);
    assert.ok(probe(at * (1 - 1e-6)) < n, `not yet ${n} just below the target`);
  }
  assert.equal(runEarningsForGain(s, 0, cfg), 0);
  assert.equal(runEarningsForGain(s, NaN, cfg), 0);
  // Already past the target: the answer is at or below the current total (a full bar).
  const rich = fakeState({ legacy: 40, totalEarned: 5e9, lifetimeEarned: 8e9 });
  assert.ok(runEarningsForGain(rich, 1, cfg) <= 5e9);
  assert.ok(nextLegacyAt(rich, cfg) > 5e9);
  assert.equal(prestigeUnlockAt(fakeState(), cfg), earningsForLegacy(3, cfg));
  // Earlier runs already past the figure (hand-edited lifetime): never a negative target.
  assert.equal(runEarningsForGain(fakeState({ legacy: 0, totalEarned: 0, lifetimeEarned: 1e12 }), 1, cfg), 0);
  // A million points at exponent 0.05: the next point is 1e120× the threshold away. Finite.
  const far = withPrestige({ exponent: 0.05 });
  assert.ok(nextLegacyAt(fakeState({ legacy: 1e6, totalEarned: 1e9, lifetimeEarned: 1e9 }), far) > 1e125);
  // Ten quadrillion points: the figure overflows a double — out of reach, reported as such.
  const huge = fakeState({ legacy: 1e16, totalEarned: 1e9, lifetimeEarned: 1e9 });
  assert.equal(nextLegacyAt(huge, far), Infinity);
  const out = prestigeStatus(huge, {}, far);
  assert.equal(out.unlockAt, Infinity);
  assert.equal(out.nextAt, Infinity);
  assert.equal(out.can, false);
  // The milestone reads Infinity as no progress rather than NaN.
  assert.equal(getMilestone('founding-charter').progress(huge, { extra: { prestige: out } }), 0);
});

test('minGainShare: the founding gate is a share of the bank as well as an absolute floor', () => {
  const cfg = withPrestige({ minGain: 3, minGainShare: 0.05 });
  assert.equal(requiredGain(fakeState(), cfg), 3);
  assert.equal(requiredGain(fakeState({ legacy: 40 }), cfg), 3, 'ceil(2) < floor');
  assert.equal(requiredGain(fakeState({ legacy: 1000 }), cfg), 50);
  assert.equal(requiredGain(fakeState({ legacy: 1001 }), cfg), 51, 'ceil');
  // 1,000 banked ($1e12 lifetime), this run worth +40 points — a 4% reset the gate refuses.
  const life = earningsForLegacy(1040, cfg) + 1;
  const s = fakeState({ legacy: 1000, totalEarned: life - 1e12, lifetimeEarned: life });
  assert.equal(prestigeGain(s, cfg), 40);
  assert.equal(canPrestige(s, cfg), false);
  assert.equal(performPrestige(s, cfg), false);
  const out = prestigeStatus(s, {}, cfg);
  assert.equal(out.minGain, 50, 'the snapshot carries the resolved gate');
  assert.equal(out.can, false);
  near(out.unlockAt, earningsForLegacy(1050, cfg) - 1e12, 'unlockAt tracks the real gate');
  s.stats.totalEarned = out.unlockAt;
  s.prestige.lifetimeEarned = 1e12 + out.unlockAt;
  assert.equal(canPrestige(s, cfg), true);
  assert.ok(prestigeUnlockAt(s, cfg) <= s.stats.totalEarned);
  // A fresh mayor is never gated by the share; share 0 is the plain floor.
  assert.equal(canPrestige(fakeState({ totalEarned: 9e6 }), cfg), true);
  assert.equal(requiredGain(fakeState({ legacy: 1e6 }), withPrestige({ minGainShare: 0 })), 3);
});

// --- legacy as a currency -----------------------------------------------------------

test('spent / available: the charter tally never touches the bank or the bonus', () => {
  assert.equal(spentOf(fakeState()), 0);
  assert.equal(availableOf(fakeState({ legacy: 40, spent: 15 })), 25);
  assert.equal(availableOf(fakeState({ legacy: 40, spent: 45 })), 0, 'never negative');
  assert.equal(spentOf({ prestige: { spent: NaN } }), 0);
  assert.equal(spentOf({ prestige: { spent: 7.9 } }), 7, 'whole points');
  assert.equal(legacyOf({}), 0);
  const cfg = withPrestige({ firstBonus: 0.5 });
  const s = fakeState({ legacy: 75, spent: 60, totalEarned: 1e6, lifetimeEarned: earningsForLegacy(75, cfg) + 1e6 });
  const out = prestigeStatus(s, {}, cfg);
  assert.equal(out.legacy, 75);
  assert.equal(out.spent, 60);
  assert.equal(out.available, 15);
  near(out.mult, 3, 'the full bank pays');
  assert.equal(out.gain, 0);
});

test('prestigeStatus fills the whole UI snapshot every call', () => {
  const cfg = withPrestige({ firstBonus: 0.5 });
  const s = fakeState({ legacy: 3, spent: 1, totalEarned: 55e6, lifetimeEarned: 64e6 });
  const out = prestigeStatus(s, {}, cfg);
  assert.deepEqual(Object.keys(out).sort(), ['available', 'can', 'gain', 'legacy', 'lifetimeEarned', 'minGain', 'mult', 'multAfter', 'nextAt', 'nextTierAt', 'nextTierName', 'spent', 'startMoneyAfter', 'unlockAt']);
  assert.equal(out.legacy, 3);
  assert.equal(out.spent, 1);
  assert.equal(out.available, 2);
  assert.equal(out.gain, 5);
  assert.equal(out.can, true);
  assert.equal(out.minGain, 3);
  near(out.mult, Math.sqrt(1.12) * 1.5, 'mult now');
  near(out.multAfter, Math.sqrt(1.32) * 1.5, 'mult after founding');
  assert.equal(out.lifetimeEarned, 64e6);
  assert.ok(out.unlockAt > 0 && out.unlockAt <= 55e6);
  assert.ok(out.nextAt > 55e6);
  near(out.startMoneyAfter, startMoneyFor(8, cfg), 'seed cash after founding');
  assert.equal(out.nextTierName, 'Old Hands');
  assert.equal(out.nextTierAt, 5);
  // Stale values are overwritten (no "keep the previous targets" mode any more).
  const keep = { nextAt: 123, unlockAt: 45 };
  prestigeStatus(s, keep, cfg);
  assert.notEqual(keep.nextAt, 123);
  assert.notEqual(keep.unlockAt, 45);
});

test('startMoneyFor grows linearly with the bank', () => {
  assert.equal(startMoneyFor(0, PLAIN), 260);
  near(startMoneyFor(10, PLAIN), 520, 'ten points');
  assert.equal(startMoneyFor(NaN, PLAIN), 260);
});

// --- founding -------------------------------------------------------------------

test('performPrestige banks the gain, resets the run, keeps the bank, spent, lifetime, settings and the log tail', () => {
  loadState({
    res: { money: 5e6, pop: 12000 },
    buildings: { house: 40, factory: 12 },
    upgrades: { 'zoning-reform': true },
    unlocks: { 'm:pop-1k': true, 'panel:prestige': true },
    stats: { totalEarned: 9e6, peakPop: 12000, buildingsBuilt: 52, prestiges: 0, playtime: 1800, clicks: 7 },
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
  assert.equal(state.prestige.spent, 0);
  assert.equal(state.prestige.lifetimeEarned, 9e6);
  assert.equal(state.stats.prestiges, 1);
  assert.equal(state.stats.totalEarned, 0);
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
  assert.match(state.log[21].msg, /^\+3 legacy \(3 total\): income ×1\.59 on top of the old bonus, \+58\.7% over a fresh start, forever\./);
  assert.deepEqual(events, [{ gain: 3, legacy: 3, spent: 0, available: 3, mult: legacyIncomeMult(3, cfg) }]);
  // A second founding straight away has nothing to bank.
  assert.equal(performPrestige(state, cfg), false);
  assert.equal(state.stats.prestiges, 1);
  loadState({});
});

test('a founding keeps prestige.spent (through resetState) and the event reports what is left to spend', () => {
  loadState({
    res: { money: 1, pop: 0 },
    stats: { totalEarned: 16e6, prestiges: 1 },
    prestige: { legacy: 3, spent: 2, lifetimeEarned: 25e6 },
  });
  const events = [];
  const onPrestige = (e) => events.push(e);
  on('prestige', onPrestige);
  assert.equal(performPrestige(state, withPrestige({ minGain: 1 })), true);
  off('prestige', onPrestige);
  assert.equal(state.prestige.legacy, 5);
  assert.equal(state.prestige.spent, 2, 'spent survives the founding');
  assert.equal(state.prestige.lifetimeEarned, 25e6);
  assert.equal(state.stats.prestiges, 2);
  assert.deepEqual(events.map((e) => [e.gain, e.legacy, e.spent, e.available]), [[2, 5, 2, 3]]);
  // core's resetState on its own keeps every prestige field too.
  state.prestige.spent = 4;
  resetState({ keepPrestige: true, keepSettings: true, keepStats: true });
  assert.equal(state.prestige.spent, 4);
  assert.equal(state.prestige.legacy, 5);
  loadState({});
});

test('foundingLine leads with the ratio while it is notable, otherwise with what changed', () => {
  assert.match(foundingLine(3, 3, 1, 1.68, 338), /^\+3 legacy \(3 total\): income ×1\.68 on top of the old bonus, \+68% over a fresh start, forever\.$/);
  const flat = foundingLine(4000, 21448, 170, 171.5, 557908);
  assert.doesNotMatch(flat, /×1\.0/);
  assert.match(flat, /^\+4,000 legacy \(21,448 total\): the bank keeps every point, the new city opens with \$557,908, and the income bonus holds at \+17,050%\. Next tier: Living Archive at 50,000 legacy\.$/);
  assert.doesNotMatch(foundingLine(1, 2e6, 100, 100, 1), /Next tier/, 'past the last tier the line simply ends');
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

test('legacy tiers: 5 → 1,000,000 points, ×1.5–4 apart (×2.5+ except around the Century Bank), each with a reward', () => {
  assert.equal(LEGACY_MILESTONES[0].target, 5);
  assert.equal(LEGACY_MILESTONES[LEGACY_MILESTONES.length - 1].target, 1e6);
  assert.ok(LEGACY_MILESTONES.length >= 10);
  let prev = 0;
  for (const m of LEGACY_MILESTONES) {
    if (prev > 0) {
      const ratio = m.target / prev;
      assert.ok(ratio >= 1.5 && ratio <= 4, `${m.id}: ×${ratio.toFixed(2)} after ${prev}`);
      if (m.id !== 'legacy-100' && m.id !== 'legacy-150') assert.ok(ratio >= 2.5, `${m.id}: ×${ratio.toFixed(2)} after ${prev}`);
    }
    assert.equal(typeof m.reward, 'function', `${m.id} rewards`);
    assert.ok(m.rewardText, `${m.id} names its reward`);
    prev = m.target;
  }
  assert.equal(nextLegacyMilestone(0).id, 'legacy-5');
  assert.equal(nextLegacyMilestone(5).id, 'legacy-15');
  assert.equal(nextLegacyMilestone(83).id, 'legacy-100', 'the 9th founding of the shipped bot sequence (83 → 117) crosses the Century Bank');
  assert.equal(nextLegacyMilestone(100).id, 'legacy-150');
  assert.equal(nextLegacyMilestone(499).id, 'legacy-500');
  assert.equal(nextLegacyMilestone(500).id, 'legacy-1500');
  assert.equal(nextLegacyMilestone(42000).id, 'legacy-50k');
  assert.equal(nextLegacyMilestone(1e6), null);
  assert.equal(nextLegacyMilestone(NaN).id, 'legacy-5');
});

test('founding ladder: 1 · 5 · 7 · 10 · 25 · 50 cities, every rung past the first rewarded, and the income budget balance placed the late ladder against', () => {
  const ladder = MILESTONES.filter((m) => m.metric === 'prestiges');
  assert.deepEqual(ladder.map((m) => m.target), [1, 5, 7, 10, 25, 50]);
  for (const m of ladder) {
    assert.equal(m.check({ stats: { prestiges: m.target } }), true);
    assert.equal(m.check({ stats: { prestiges: m.target - 1 } }), false);
    if (m.target > 1) assert.equal(typeof m.reward, 'function', `${m.id} rewards`);
  }
  // Seven Skylines and the Century Bank pay income; Founding Dynasty pays growth, so the
  // permanent income multiplier a 10-city, 164-point mayor folds from the founding ladder
  // and the legacy tiers stays ×1.27 — the figure the late rung/perk placement in
  // src/balance/config.js is measured against (see the ladder comment in milestones.js).
  const s = createInitialState();
  s.stats.prestiges = 10;
  s.prestige.legacy = 164;
  for (const m of MILESTONES) if ((m.metric === 'prestiges' || m.metric === 'legacy') && m.check(s)) s.unlocks[m.key] = true;
  const mods = applyMilestoneMods(createMods(), s);
  near(mods.income, 1.1 * 1.1 * 1.05, 'founding + legacy income budget by the 10th city');
  near(mods.growth, 1.25, 'Founding Dynasty pays in growth');
  assert.equal(mods.happiness, 0.15, 'only Civic Memory touches happiness by then (the dip contract)');
  assert.equal(s.unlocks['m:prestige-7'], true);
  assert.equal(s.unlocks['m:legacy-100'], true);
  assert.equal(s.unlocks['m:legacy-150'], true, 'Scrubber Mandate (no income) is crossed too');
  assert.equal(s.unlocks['m:legacy-500'], undefined);
});

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
  // The milestone that promises founding is the one that tracks the real gate, not $1M.
  assert.doesNotMatch(getMilestone('money-1m').rewardText, /found/i);
  const charter = getMilestone('founding-charter');
  assert.match(charter.rewardText, /founding a new city/i);
  const fresh = createInitialState();
  assert.equal(charter.check(fresh, { extra: {} }), false);
  assert.equal(charter.check(fresh, { extra: { prestige: { can: true } } }), true);
  const unlockAt = earningsForLegacy(prestigeTuning(config).minGain, config);
  fresh.stats.totalEarned = unlockAt / 2;
  near(charter.progress(fresh, {}), 0.5, 'progress toward the earnings gate before the first tick');
  near(charter.progress(fresh, { extra: { prestige: { can: false, unlockAt: unlockAt / 4 } } }), 1, 'live unlockAt wins');
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

function ensureTestBuildings() {
  if (registry.buildings.has('t-hut')) return;
  registerBuilding({ id: 't-hut', name: 'Hut', icon: 'h', desc: 'test', category: 'residential', tier: 1, baseCost: 10, costGrowth: 1.1, housing: 4, powerUse: 1 });
  registerBuilding({ id: 't-mill', name: 'Mill', icon: 'm', desc: 'test', category: 'power', tier: 1, baseCost: 10, costGrowth: 1.1, powerGen: 6 });
  registerBuilding({ id: 't-shop', name: 'Shop', icon: 's', desc: 'test', category: 'commercial', tier: 1, baseCost: 10, costGrowth: 1.1, jobs: 5, income: 1 });
}

test('simulate integrates money and population, keeps the snapshot current, and never logs a brownout without a grid', () => {
  ensureTestBuildings();
  loadState({ res: { money: 100, pop: 0 }, buildings: { 't-hut': 1 } });
  recompute(state, derived);
  assert.equal(derived.powerDemand > 0 && derived.powerCap === 0, true);
  for (let i = 0; i < 50; i++) simulate(state, derived, 0.1);
  assert.equal(state.log.filter((l) => l.kind === 'brownout').length, 0, 'no brownout line without a generator');
  assert.equal(state.unlocks['panel:power'], true, 'the power panel gate still opens on first demand');
  assert.ok(state.res.pop > 0 && state.res.pop <= derived.housing, 'citizens move in, never overshoot housing');
  // Money follows income; lifetime follows this run.
  state.buildings['t-mill'] = 1;
  state.buildings['t-shop'] = 1;
  const money0 = state.res.money;
  for (let i = 0; i < 100; i++) simulate(state, derived, 0.1);
  assert.ok(state.res.money > money0, 'money grows');
  assert.ok(state.stats.totalEarned > 0 && state.prestige.lifetimeEarned >= state.stats.totalEarned);
  assert.equal('peakIncome' in state.stats, false, 'no maturity bookkeeping');
  const snap = prestigeSnapshot(derived);
  assert.equal(snap, derived.extra.prestige);
  assert.equal(snap.legacy, 0);
  assert.equal(snap.spent, 0);
  assert.equal(snap.available, 0);
  assert.equal(snap.can, false);
  assert.equal(snap.mult, 1);
  assert.equal(snap.unlockAt, earningsForLegacy(prestigeTuning(config).minGain, config));
  // A real brownout (demand above an existing capacity) is logged exactly once.
  state.buildings['t-hut'] = 20;
  for (let i = 0; i < 5; i++) simulate(state, derived, 0.1);
  assert.equal(state.log.filter((l) => l.kind === 'brownout').length, 1, 'one brownout line');
  assert.equal(state.unlocks['m:brownout'], true);
  loadState({});
});

test('the prestige panel gate opens at threshold × prestigePanelShare, and stays open for a mayor with a bank', () => {
  const p = prestigeTuning(config);
  loadState({ res: { money: 0, pop: 0 }, stats: { totalEarned: p.threshold * p.prestigePanelShare * 0.99 } });
  recompute(state, derived);
  simulate(state, derived, 0.1);
  assert.equal(state.unlocks['panel:prestige'], undefined);
  state.stats.totalEarned = p.threshold * p.prestigePanelShare;
  simulate(state, derived, 0.1);
  assert.equal(state.unlocks['panel:prestige'], true);
  loadState({ res: { money: 0, pop: 0 }, prestige: { legacy: 1, lifetimeEarned: 1e9 }, stats: { prestiges: 1 } });
  markFounding(1);
  recompute(state, derived);
  simulate(state, derived, 0.1);
  assert.equal(state.unlocks['panel:prestige'], true, 'a bank keeps the panel');
  loadState({});
  markFounding(0);
});

test('a replay re-latches old tiers silently but announces the ones this founding crossed', () => {
  // Bank went 40 -> 55 on the 5th founding: legacy-50 is news, legacy-5/15 are carried over,
  // prestige-5 just happened, prestige-1 is old.
  loadState({ stats: { prestiges: 5 }, prestige: { legacy: 55, lifetimeEarned: 1e9 }, res: { money: 500, pop: 0 }, time: 0, tick: 0 });
  markFounding(40);
  const seen = [];
  const onMs = (m) => seen.push(m.id);
  on('milestone', onMs);
  recompute(state, derived);
  simulate(state, derived, 0.1);
  off('milestone', onMs);
  for (const id of ['prestige-1', 'prestige-5', 'legacy-5', 'legacy-15', 'legacy-50']) assert.equal(state.unlocks['m:' + id], true, `${id} latched`);
  assert.deepEqual(seen, ['prestige-5', 'legacy-50']);
  const logged = state.log.filter((l) => l.kind === 'milestone').map((l) => l.msg);
  assert.deepEqual(logged, ['Milestone: Serial Founder (+10% income)', 'Milestone: Civic Memory (+0.15 happiness)']);
  // The very first founding announces New Foundations.
  loadState({ stats: { prestiges: 1 }, prestige: { legacy: 5, lifetimeEarned: 1e8 }, res: { money: 500, pop: 0 } });
  markFounding(0);
  seen.length = 0;
  on('milestone', onMs);
  recompute(state, derived);
  simulate(state, derived, 0.1);
  off('milestone', onMs);
  assert.deepEqual(seen, ['prestige-1', 'legacy-5']);
  // Past the first second nothing is suppressed (a tier reached mid-run is always news).
  loadState({ stats: { prestiges: 3 }, prestige: { legacy: 4, lifetimeEarned: 1e8 }, res: { money: 500, pop: 0 }, time: 30, tick: 300 });
  markFounding(4);
  recompute(state, derived);
  simulate(state, derived, 0.1);
  state.prestige.legacy = 5;
  seen.length = 0;
  on('milestone', onMs);
  simulate(state, derived, 0.1);
  off('milestone', onMs);
  assert.deepEqual(seen, ['legacy-5']);
  loadState({});
  markFounding(0);
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

test('an idle two-cottage city at legacy 1,000 banks nothing in ten minutes and never arms the button', () => {
  ensureTestBuildings();
  loadState({ prestige: { legacy: 1000, lifetimeEarned: earningsForLegacy(1000, config) }, stats: { prestiges: 4 }, res: { money: 500, pop: 0 }, buildings: { 't-hut': 2, 't-mill': 1 } });
  markFounding(1000);
  recompute(state, derived);
  for (let i = 0; i < 6000; i++) simulate(state, derived, 0.1);
  assert.ok(state.stats.totalEarned > 0, 'the cottages did pay tax');
  assert.equal(prestigeGain(state, config), 0, 'nothing compounds with time');
  assert.equal(canPrestige(state, config), false);
  const snap = prestigeSnapshot(derived);
  assert.equal(snap.can, false);
  assert.equal(snap.legacy, 1000);
  assert.equal(snap.minGain, requiredGain(state, config));
  assert.equal(state.unlocks['m:founding-charter'], undefined, 'the charter does not latch for a worthless reset');
  loadState({});
  markFounding(0);
});

test('tap pays gross output (floor $1), counts toward totalEarned and lifetime, and emits', () => {
  ensureTestBuildings();
  loadState({ res: { money: 0, pop: 0 }, buildings: { 't-shop': 3 } });
  recompute(state, derived);
  // Fake an upkeep deficit: $3/s gross, net negative. A tap still pays for the output.
  derived.grossIncome = 3;
  derived.income = -2;
  const taps = [];
  const onTap = (e) => taps.push(e);
  on('tap', onTap);
  const gain = tap(state, derived);
  off('tap', onTap);
  assert.equal(gain, 3 * economyTuning(config).tapSeconds);
  assert.equal(state.res.money, gain);
  assert.equal(state.stats.totalEarned, gain);
  assert.equal(state.prestige.lifetimeEarned, gain);
  assert.equal(state.stats.clicks, 1);
  assert.deepEqual(taps, [{ gain, clicks: 1 }]);
  assert.equal('tapEarned' in state.stats, false, 'no separate tap tally');
  derived.grossIncome = 0;
  assert.equal(tap(state, derived), 1, 'floor $1');
  assert.equal(state.stats.clicks, 2);
  loadState({});
});

test('the tap ladder: lifetime taps scale mods.tap from 1 s of income to 5 s, and carry over silently', () => {
  ensureTestBuildings();
  const tapMs = MILESTONES.filter((m) => m.metric === 'clicks');
  assert.deepEqual(tapMs.map((m) => [m.id, m.target]), [['taps-25', 25], ['taps-250', 250], ['taps-1000', 1000]]);
  const s = createInitialState();
  near(foldMods(s).tap, 1, 'no ladder: one second per tap');
  for (const m of tapMs) s.unlocks[m.key] = true;
  near(applyMilestoneMods(createMods(), s).tap * 1, 5, 'all three rungs: five seconds per tap');
  assert.ok(foldMods({ ...s, upgrades: {}, prestige: s.prestige }).tap === 5);
  // Live: 24 taps pay 1 s, the 25th latches Hands-On Mayor and the 26th pays 2 s.
  loadState({ res: { money: 0, pop: 0 }, buildings: { 't-shop': 3, 't-mill': 1 } });
  recompute(state, derived);
  simulate(state, derived, 0.1);
  const gross = derived.grossIncome;
  assert.ok(gross > 1, 'the shops pay');
  state.stats.clicks = 24;
  const g1 = tap(state, derived);
  near(g1, gross * economyTuning(config).tapSeconds, 'one second of output at 24 taps');
  simulate(state, derived, 0.1);
  assert.equal(state.unlocks['m:taps-25'], true, 'latched on the tick after the 25th tap');
  assert.match(state.log[state.log.length - 1].msg, /Hands-On Mayor \(Taps pay 2 s of income\)/);
  near(tapSecondsFor(derived), 2 * economyTuning(config).tapSeconds, 'two seconds per tap');
  near(tap(state, derived), derived.grossIncome * 2 * economyTuning(config).tapSeconds, 'the 26th tap pays double');
  assert.ok(derived.grossIncome > 0);
  // A replay re-latches the ladder without announcing it (taps are a lifetime count).
  loadState({ res: { money: 500, pop: 0 }, stats: { prestiges: 3, clicks: 300 }, prestige: { legacy: 30, lifetimeEarned: 1e9 } });
  markFounding(30);
  const seen = [];
  const onMs = (m) => seen.push(m.id);
  on('milestone', onMs);
  recompute(state, derived);
  simulate(state, derived, 0.1);
  off('milestone', onMs);
  assert.equal(state.unlocks['m:taps-25'], true);
  assert.equal(state.unlocks['m:taps-250'], true);
  assert.equal(seen.includes('taps-25') || seen.includes('taps-250'), false, 'old tap rungs are not news');
  near(derived.mods.tap, 3, 'two rungs: three seconds per tap');
  // A malformed multiplier never poisons the tap.
  derived.mods.tap = NaN;
  near(tapSecondsFor(derived), economyTuning(config).tapSeconds, 'NaN falls back to ×1');
  loadState({});
  markFounding(0);
});

test('the prestige snapshot is refreshed before the goals are checked, so Founding Charter latches on the tick it arms', () => {
  const p = prestigeTuning(config);
  const at = earningsForLegacy(p.minGain, config);
  loadState({ res: { money: 0, pop: 0 }, stats: { totalEarned: at * 0.999 }, prestige: { lifetimeEarned: at * 0.999 } });
  recompute(state, derived);
  simulate(state, derived, 0.1);
  assert.equal(state.unlocks['m:founding-charter'], undefined, 'not yet');
  // Earn the last dollar outside the tick (a tap, an import): the very next tick latches it,
  // instead of one tick later off a stale snapshot.
  state.stats.totalEarned = at;
  state.prestige.lifetimeEarned = at;
  simulate(state, derived, 0.1);
  assert.equal(prestigeSnapshot(derived).can, true);
  assert.equal(state.unlocks['m:founding-charter'], true, 'latched on the same tick');
  loadState({});
});

test('a founding resyncs the pending milestone list on recompute', () => {
  loadState({
    res: { money: 5e6, pop: 12000 },
    stats: { totalEarned: 9e6, prestiges: 0 },
    prestige: { legacy: 0, lifetimeEarned: 9e6 },
    unlocks: { 'm:pop-1k': true },
  });
  recompute(state, derived);
  simulate(state, derived, 0.1); // latches the pop tiers up to 10k on the way
  assert.equal(state.unlocks['m:pop-10k'], true);
  assert.equal(performPrestige(state, PLAIN, (s) => recompute(s, derived)), true);
  assert.deepEqual(state.unlocks, {});
  // The reset emptied the unlocks: the next tick starts from a fresh pending list and
  // re-latches what the new city qualifies for (first founding) without a periodic resync.
  simulate(state, derived, 0.1);
  assert.equal(state.unlocks['m:prestige-1'], true);
  assert.equal(state.unlocks['m:pop-10k'], undefined);
  loadState({});
  markFounding(0);
});

test('the tick is allocation-light: a thousand ticks of a mid-size city average well under 0.05 ms', () => {
  ensureTestBuildings();
  loadState({ res: { money: 1e6, pop: 500 }, buildings: { 't-hut': 200, 't-mill': 60, 't-shop': 100 }, prestige: { legacy: 120, spent: 30, lifetimeEarned: 1e10 }, stats: { prestiges: 6 } });
  markFounding(120);
  recompute(state, derived);
  for (let i = 0; i < 200; i++) simulate(state, derived, 0.1); // warm up
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 2000; i++) simulate(state, derived, 0.1);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 2000;
  assert.ok(ms < 0.05, `avg ${ms.toFixed(4)} ms per tick`);
  assert.equal(derived.extra.prestige.spent, 30);
  assert.equal(derived.extra.prestige.available, 90);
  loadState({});
  markFounding(0);
});
