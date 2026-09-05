// Unit tests for the resources module. Run: node --test src/resources/
// Pins the computeDerived contract (docs/DESIGN.md "Resources"): every derived field for
// two synthetic cities, the edge cases, and that DEFAULTS mirrors src/balance/config.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerBuilding, registry } from '../core/registry.js';
import { createMods, buildingMod, sanitizeMods } from '../core/mods.js';
import { config } from '../balance/config.js';
import { computeDerived, DEFAULTS, RESOURCES, resourceValue, formatResource } from './index.js';
import { civicBonus, pollutionPenalty, posOr1, finite, FINITE_MAX, OVERCROWD_MAX } from './math.js';

const EPS = 1e-9;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= EPS * Math.max(1, Math.abs(b)), `${msg}: ${a} != ${b}`);

// Explicit tuning so the expectations below never move when balance is retuned.
const CFG = {
  economy: { taxPerPop: 0.08, wage: 0.35 },
  pop: { growthRate: 0.08, shrinkRate: 0.2, baseInflow: 0.5 },
  power: { brownoutFloor: 0.4 },
  happiness: {
    civicCap: 1.25,
    civicScale: 1.5,
    pollutionScale: 0.2,
    pollutionCap: 1.0,
    pollutionCurve: 1.0,
    unemploymentPenalty: 0.3,
    overcrowdPenalty: 0.5,
    brownoutPenalty: 0.3,
    min: 0.25,
    max: 3,
  },
};

// Synthetic buildings (t- prefix keeps them clear of the real content ids).
const DEFS = [
  { id: 't-house', housing: 4, powerUse: 1 },
  { id: 't-shop', jobs: 5, income: 0.3, powerUse: 1 },
  { id: 't-windmill', powerGen: 6 },
  { id: 't-park', happiness: 0.05 },
  { id: 't-factory', jobs: 20, income: 2.5, powerUse: 10, happiness: -0.02 },
  { id: 't-coal', jobs: 10, powerGen: 80, happiness: -0.03, upkeep: 2 },
  { id: 't-refinery', jobs: 200, income: 60, powerUse: 120, happiness: -0.05 },
];
for (const d of DEFS) {
  if (!registry.buildings.has(d.id)) registerBuilding({ name: d.id, baseCost: 1, costGrowth: 1.1, ...d });
}

const run = (buildings, pop, mods = null, cfg = CFG) => computeDerived({ res: { pop }, buildings }, {}, mods, cfg);

function assertContract(d) {
  const b = d.extra.incomeBreakdown;
  near(b.tax + b.wages + b.buildings, d.grossIncome, 'breakdown sums to gross');
  near(d.grossIncome - b.upkeep, d.income, 'income = gross - upkeep');
  assert.ok(d.happiness >= 0.25 && d.happiness <= 3, 'happiness clamp');
  assert.ok(d.powerRatio >= 0 && d.powerRatio <= 1, 'powerRatio clamp');
  for (const k of ['housing', 'jobs', 'employed', 'powerCap', 'powerDemand', 'powerRatio', 'happiness', 'grossIncome', 'upkeep', 'income', 'popGrowth', 'costMult']) {
    assert.ok(Number.isFinite(d[k]), `${k} finite (${d[k]})`);
  }
  for (const k of Object.keys(d.extra)) {
    const v = d.extra[k];
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `extra.${k} finite`);
    else for (const kk of Object.keys(v)) assert.ok(Number.isFinite(v[kk]), `extra.${k}.${kk} finite`);
  }
}

test('city A: 10 houses / 5 shops / 2 windmills / 100 pop (brownout, overcrowded, jobless)', () => {
  const d = run({ 't-house': 10, 't-shop': 5, 't-windmill': 2 }, 100);
  near(d.housing, 40, 'housing');
  near(d.jobs, 25, 'jobs');
  near(d.employed, 25, 'employed');
  near(d.powerCap, 12, 'powerCap');
  near(d.powerDemand, 15, 'powerDemand');
  near(d.powerRatio, 0.8, 'powerRatio');
  near(d.extra.unemployment, 0.75, 'unemployment');
  near(d.extra.overcrowd, 1.5, 'overcrowd');
  near(d.extra.penalties.unemployment, 0.225, 'pen.unemployment');
  near(d.extra.penalties.overcrowd, 0.75, 'pen.overcrowd');
  near(d.extra.penalties.brownout, 0.06, 'pen.brownout');
  near(d.extra.penalties.pollution, 0, 'pen.pollution');
  near(d.extra.civic, 0, 'civic');
  near(d.happiness, 0.25, 'happiness clamped to floor'); // raw 1 - 0.225 - 0.75 - 0.06 = -0.035
  near(d.extra.happinessMult, 0.625, 'happinessMult');
  near(d.extra.incomeBreakdown.multiplier, 0.5, 'multiplier'); // 1 * 0.8 * 0.625
  near(d.extra.incomeBreakdown.tax, 4, 'tax'); // 100 * 0.08 * 0.5
  near(d.extra.incomeBreakdown.wages, 4.375, 'wages'); // 25 * 0.35 * 0.5
  near(d.extra.incomeBreakdown.buildings, 0.75, 'buildings'); // 5 * 0.3 * 0.5
  near(d.grossIncome, 9.125, 'grossIncome');
  near(d.upkeep, 0, 'upkeep');
  near(d.income, 9.125, 'income');
  near(d.popGrowth, -12, 'popGrowth'); // -(100 - 40) * 0.2
  near(d.extra.vacancy, 0, 'vacancy');
  near(d.extra.openJobs, 0, 'openJobs');
  near(d.extra.powerSurplus, -3, 'powerSurplus');
  near(d.costMult, 1, 'costMult');
  assertContract(d);
});

test('city B: parks + industry with global and per-building mods', () => {
  const mods = createMods();
  mods.income = 1.2;
  mods.housing = 1.5;
  mods.demand = 0.85;
  mods.happiness = 0.1;
  mods.cost = 0.9;
  const f = buildingMod(mods, 't-factory');
  f.income = 1.75;
  f.happiness = -0.01;
  sanitizeMods(mods);
  const d = run({ 't-park': 20, 't-factory': 10, 't-coal': 3, 't-house': 5 }, 15, mods);

  const civic = 1.25 * (1 - Math.exp(-1.0 / 1.5)); // Σ 20 * 0.05 = 1.0
  const pollution = 1 - Math.exp(-(10 * 0.03 + 3 * 0.03) * 0.2); // factory -0.02-0.01, coal -0.03
  const h = 1 + civic - pollution + 0.1;
  const mult = 1.2 * 1 * (0.5 + 0.5 * h);
  near(d.housing, 30, 'housing'); // 5 * 4 * 1.5
  near(d.jobs, 230, 'jobs');
  near(d.employed, 15, 'employed');
  near(d.powerCap, 240, 'powerCap');
  near(d.powerDemand, 89.25, 'powerDemand'); // (5 + 100) * 0.85
  near(d.powerRatio, 1, 'powerRatio');
  near(d.extra.civic, civic, 'civic');
  near(d.extra.pollution, pollution, 'pollution');
  near(d.happiness, h, 'happiness');
  near(d.extra.incomeBreakdown.multiplier, mult, 'multiplier');
  near(d.extra.incomeBreakdown.tax, 15 * 0.08 * mult, 'tax');
  near(d.extra.incomeBreakdown.wages, 15 * 0.35 * mult, 'wages');
  near(d.extra.incomeBreakdown.buildings, 10 * 2.5 * 1.75 * mult, 'buildings');
  near(d.upkeep, 6, 'upkeep');
  near(d.grossIncome, (1.2 + 5.25 + 43.75) * mult, 'grossIncome');
  near(d.income, (1.2 + 5.25 + 43.75) * mult - 6, 'income');
  near(d.popGrowth, (30 - 15) * 0.08 * h * 1 + 0.5, 'popGrowth');
  near(d.costMult, 0.9, 'costMult');
  assert.equal(d.mods, mods, 'derived.mods is the bag passed in');
  assertContract(d);
});

test('baseInflow is suppressed at pop == housing and applied below it', () => {
  const full = run({ 't-house': 10 }, 40);
  near(full.popGrowth, 0, 'no growth at capacity');
  const room = run({ 't-house': 10 }, 39);
  near(room.powerRatio, 0.4, 'unpowered city sits at brownoutFloor');
  near(room.popGrowth, 1 * 0.08 * room.happiness * 0.4 + 0.5, 'growth + inflow below capacity');
  const mods = createMods();
  mods.inflow = 2;
  mods.growth = 1.5;
  const boosted = run({ 't-house': 10, 't-windmill': 2 }, 39, mods);
  near(boosted.powerRatio, 1, 'powered');
  near(boosted.popGrowth, 1 * 0.08 * boosted.happiness * 1 * 1.5 + 1.0, 'mods.inflow / mods.growth honoured');
});

test('late-game industrial city no longer pins happiness at the floor', () => {
  // The gauntlet's final city: 129 coal + 123 factory + 112 refinery (Σ 11.93 → x 2.39)
  // against a saturated civic bonus. Linear penalty gave 0.25; saturated gives > 1.
  // Housed, powered and employed so pollution is the only penalty in play.
  const city = { 't-coal': 129, 't-factory': 123, 't-refinery': 112, 't-park': 200, 't-house': 5000, 't-windmill': 2000 };
  const d = run(city, 20000);
  near(d.powerRatio, 1, 'powered');
  near(d.extra.unemployment, 0, 'employed');
  near(d.extra.overcrowd, 0, 'housed');
  near(d.extra.pollution, 1 - Math.exp(-2.386), 'saturated pollution');
  assert.ok(d.extra.pollution < 1.0, 'pollution below cap');
  assert.ok(d.happiness > 1.0, `happiness ${d.happiness} > 1`);
  // pollutionCap 0 restores the DESIGN.md linear form.
  const lin = run(city, 20000, null, { ...CFG, happiness: { ...CFG.happiness, pollutionCap: 0 } });
  near(lin.extra.pollution, 2.386, 'linear pollution');
  near(lin.happiness, 0.25, 'linear form pins the floor');
  // Marginal smokestack: 1 more factory costs less than 0.02 * 0.2 happiness under saturation.
  const more = run({ ...city, 't-factory': 124 }, 20000);
  assert.ok(d.happiness - more.happiness < 0.004 && d.happiness - more.happiness > 0, 'diminishing marginal penalty');
});

test('pollution saturation has unit slope at zero (curve == cap) and never exceeds the cap', () => {
  near(pollutionPenalty(1e-6, 1, 1), 1e-6 - 5e-13, 'slope 1 near zero');
  assert.ok(pollutionPenalty(100, 1, 1) <= 1 && pollutionPenalty(100, 1, 1) > 0.999, 'approaches cap');
  assert.ok(pollutionPenalty(3, 1, 1) < 1, 'below cap at finite x');
  near(pollutionPenalty(2.5, 0, 0), 2.5, 'linear without cap');
  near(pollutionPenalty(2.5, 1, 0), 1, 'hard clamp without curve');
  near(pollutionPenalty(0, 1, 1), 0, 'zero');
  near(civicBonus(1.5, 1.25, 1.5), 1.25 * (1 - Math.exp(-1)), 'civic e-fold');
  assert.ok(civicBonus(1e9, 1.25, 1.5) <= 1.25, 'civic capped');
});

test('empty city', () => {
  const d = run({}, 0);
  near(d.income, 0, 'income');
  near(d.grossIncome, 0, 'gross');
  near(d.popGrowth, 0, 'growth');
  near(d.happiness, 1, 'happiness');
  near(d.powerRatio, 1, 'powerRatio');
  near(d.housing, 0, 'housing');
  near(d.extra.unemployment, 0, 'unemployment');
  assertContract(d);
});

test('garbage inputs degrade to zero without throwing', () => {
  const d = computeDerived(
    { res: { pop: NaN }, buildings: { 't-house': 'ten', 't-shop': -4, 't-windmill': Infinity, nope: 5 } },
    {},
    { income: 'x', byBuilding: { 't-house': { housing: NaN } } },
    { happiness: { civicCap: 'no' } },
  );
  near(d.housing, 0, 'housing');
  near(d.income, 0, 'income');
  near(d.happiness, 1, 'happiness');
  assertContract(d);
  assert.doesNotThrow(() => computeDerived(null, {}, null, null));
  assert.doesNotThrow(() => computeDerived({}, {}, undefined, 42));
  const empty = computeDerived(undefined, {}, undefined, undefined);
  near(empty.income, 0, 'null state income');
  assertContract(empty);
});

test('pop with zero housing: overcrowd capped, shrink finite', () => {
  const d = run({ 't-shop': 2 }, 100);
  near(d.extra.overcrowd, OVERCROWD_MAX, 'overcrowd cap');
  near(d.popGrowth, -20, 'shrink -(100-0)*0.2');
  near(d.happiness, 0.25, 'floor');
  assertContract(d);
});

test('negative multiplicative mods are treated as 1 (matches sanitizeMods)', () => {
  const base = run({ 't-house': 10, 't-shop': 5, 't-windmill': 3 }, 40);
  const bad = run({ 't-house': 10, 't-shop': 5, 't-windmill': 3 }, 40, {
    income: -3, housing: -1, jobs: NaN, power: Infinity, demand: -0.5, growth: -1, inflow: -1, upkeep: -1, cost: -2,
    byBuilding: { 't-shop': { income: -9, jobs: -1, housing: -1, power: -1 } },
  });
  near(bad.income, base.income, 'income');
  near(bad.housing, base.housing, 'housing');
  near(bad.jobs, base.jobs, 'jobs');
  near(bad.powerCap, base.powerCap, 'powerCap');
  near(bad.powerDemand, base.powerDemand, 'powerDemand');
  near(bad.popGrowth, base.popGrowth, 'popGrowth');
  near(bad.costMult, 1, 'costMult');
  assert.equal(posOr1(-3), 1);
  assert.equal(posOr1(0), 0);
  assert.equal(posOr1(2.5), 2.5);
  assert.equal(posOr1(NaN), 1);
  assert.equal(posOr1(undefined), 1);
});

test('huge inputs stay finite (1e300 counts and 1e308 counts + mods)', () => {
  const big = run({ 't-house': 1e300, 't-shop': 1e300 }, 1e300);
  assertContract(big);
  assert.ok(big.income > 1e299, 'income scales');
  const mods = createMods();
  mods.housing = 1e10;
  mods.income = 1e10;
  const huge = computeDerived({ res: { pop: 1e308 }, buildings: { 't-house': 1e308, 't-shop': 1e308, 't-factory': 1e308 } }, {}, mods, CFG);
  assertContract(huge);
  assert.ok(huge.housing <= FINITE_MAX && huge.income <= FINITE_MAX && huge.popGrowth >= -FINITE_MAX, 'clamped to FINITE_MAX');
  assert.equal(finite(Infinity), FINITE_MAX);
  assert.equal(finite(-Infinity), -FINITE_MAX);
  assert.equal(finite(NaN), 0);
  assert.equal(finite(NaN, 7), 7);
  assert.equal(finite(3.5), 3.5);
});

test('derived.extra objects are reused across calls (allocation-free steady state)', () => {
  const derived = {};
  run({ 't-house': 1 }, 1);
  computeDerived({ res: { pop: 1 }, buildings: { 't-house': 1 } }, derived, null, CFG);
  const pen = derived.extra.penalties;
  const br = derived.extra.incomeBreakdown;
  computeDerived({ res: { pop: 2 }, buildings: { 't-house': 2 } }, derived, null, CFG);
  assert.equal(derived.extra.penalties, pen);
  assert.equal(derived.extra.incomeBreakdown, br);
});

test('DEFAULTS mirrors src/balance/config.js for every key config defines', () => {
  for (const section of Object.keys(DEFAULTS)) {
    for (const key of Object.keys(DEFAULTS[section])) {
      const c = config[section] && config[section][key];
      if (c === undefined) continue; // e.g. pollutionCap/pollutionCurve live only here
      assert.equal(DEFAULTS[section][key], c, `DEFAULTS.${section}.${key} drifted from config (${DEFAULTS[section][key]} vs ${c})`);
    }
  }
  // Saturation must be live through the DEFAULTS fallback when config omits it.
  const withConfig = run({ 't-coal': 129, 't-factory': 123, 't-refinery': 112 }, 0, null, config);
  assert.ok(withConfig.extra.pollution < 1.0, 'saturation applied with the real config');
});

test('resource metadata + display helpers', () => {
  assert.deepEqual(RESOURCES.map((r) => r.id), ['money', 'pop', 'power', 'happiness']);
  assert.equal(resourceValue('money', { res: { money: -5 } }, {}), 0);
  assert.equal(resourceValue('happiness', {}, { happiness: 1.5 }), 1.5);
  assert.equal(resourceValue('happiness', {}, {}), 1);
  assert.equal(formatResource('power', 12), '12 MW');
  assert.equal(formatResource('pct', 1), '1');
  assert.equal(formatResource('happiness', 1.25), '125%');
});
