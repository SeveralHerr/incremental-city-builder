// Unit tests for the upgrades module. Run: node --test src/upgrades/
// Pins the data invariants (unique ids, desc length, hints everywhere, effects touch only the
// mods bag), the pure horizon-ladder rules (horizonCost, bondOpensAt, roman), the config
// override rules, the founding-memory rule and the registered-cost view (sortedUpgrades).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMods, sanitizeMods } from '../core/mods.js';
import { registry } from '../core/registry.js';
import { config } from '../balance/config.js';
import {
  UPGRADES,
  UPGRADE_CATEGORIES,
  MILESTONE_IDS,
  BOND_RUNGS,
  BOND_FLOOR,
  BOND_SECONDS,
  BOND_OPEN_2,
  BOND_OPEN_STEP,
  bondOpensAt,
  horizonCost,
  roman,
  keptUpgradeIds,
} from './data.js';
import { applyOverride, sortedUpgrades, init } from './index.js';

const CATEGORY_IDS = new Set(UPGRADE_CATEGORIES.map((c) => c.id));
const byId = (id) => UPGRADES.find((d) => d.id === id);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

// A rich, deep-frozen state: every effect and unlock must run without writing to it.
const FROZEN_STATE = deepFreeze({
  tick: 1200,
  time: 120,
  res: { money: 1e6, pop: 5000 },
  buildings: { house: 10, shop: 20, factory: 25, park: 5, windmill: 6, coal: 3, office: 5 },
  upgrades: { 'welcome-sign': true, 'civic-bonds-1': true, 'planetary-charter': true },
  unlocks: { 'm:pop-1k': true },
  stats: { totalEarned: 2e9, peakPop: 5000, buildingsBuilt: 80, prestiges: 3, playtime: 1000, clicks: 3 },
  prestige: { legacy: 12, spent: 0, lifetimeEarned: 1e10 },
  settings: {},
  log: [],
});
const FROZEN_DERIVED = deepFreeze({ income: 1234.5, powerCap: 100, powerDemand: 120, powerRatio: 0.83, upkeep: 5 });

test('definitions: unique ids, categories, tiers, short descs, hints everywhere', () => {
  const ids = new Set();
  for (const d of UPGRADES) {
    assert.ok(!ids.has(d.id), `duplicate id ${d.id}`);
    ids.add(d.id);
    assert.ok(/^[a-z0-9-]+$/.test(d.id), `${d.id}: id charset`);
    assert.ok(typeof d.name === 'string' && d.name.trim(), `${d.id}: name`);
    assert.ok(typeof d.icon === 'string' && d.icon, `${d.id}: icon`);
    assert.ok(typeof d.desc === 'string' && d.desc.length > 0 && d.desc.length <= 70, `${d.id}: desc length ${d.desc.length}`);
    assert.ok(Number.isFinite(d.cost) && d.cost > 0, `${d.id}: cost`);
    assert.ok(CATEGORY_IDS.has(d.category), `${d.id}: category ${d.category}`);
    assert.ok(Number.isInteger(d.tier) && d.tier >= 1 && d.tier <= 4, `${d.id}: tier`);
    assert.equal(typeof d.unlock, 'function', `${d.id}: unlock`);
    assert.equal(typeof d.effect, 'function', `${d.id}: effect`);
    assert.ok(typeof d.unlockHint === 'string' && d.unlockHint.length > 3 && d.unlockHint.length <= 90, `${d.id}: unlockHint "${d.unlockHint}"`);
    if (d.unlockAt !== undefined) {
      assert.ok(d.unlockAt && typeof d.unlockAt === 'object', `${d.id}: unlockAt shape`);
      assert.ok(Object.keys(d.unlockAt).length > 0, `${d.id}: unlockAt empty`);
    }
  }
  assert.ok(UPGRADES.length >= 80, `ladder has ${UPGRADES.length} rungs`);
  assert.equal(MILESTONE_IDS.length, new Set(MILESTONE_IDS).size);
});

test('hints read as the rule they mirror', () => {
  assert.equal(byId('neon-signage').unlockHint, 'Build 3 corner shops');
  assert.deepEqual(byId('neon-signage').unlockAt, { building: 'shop', count: 3 });
  assert.equal(byId('farmers-market').unlockHint, 'Build 15 corner shops');
  assert.equal(byId('container-port').unlockHint, 'Build 20 factories');
  assert.equal(byId('community-events').unlockHint, 'Build a City Park');
  assert.equal(byId('franchising').unlockHint, 'Reach 100 citizens or build an Office Block');
  assert.deepEqual(byId('tourism-board').unlockAt, { pop: 2000 });
  assert.equal(byId('civic-bonds-1').unlockHint, 'Own Planetary Charter or earn $1B in this city');
  assert.equal(byId('civic-bonds-2').unlockHint, 'Own Civic Bonds I and wait until 3 min after founding');
  assert.deepEqual(byId('civic-bonds-2').unlockAt, { upgrade: 'civic-bonds-1' });
  assert.equal(byId('legacy-archive').unlockHint, 'Found a new city');
  assert.deepEqual(byId('institutional-memory').unlockAt, { legacy: 10 });
  assert.match(byId('smart-grid').unlockHint, /brownout/i);
});

test('happiness descs are written in percent, like the rest of the UI', () => {
  assert.equal(byId('community-events').desc, 'Happiness +10%');
  assert.equal(byId('green-belts').desc, 'Parks give +5% happiness each');
  assert.equal(byId('modern-curriculum').desc, 'Schools give +4% happiness each');
  assert.equal(byId('preventive-care').desc, 'Hospitals give +6% happiness each');
  assert.equal(byId('championship-season').desc, 'Stadiums earn ×2 income and give +15% happiness each');
  assert.equal(byId('veteran-planners').desc, 'Population grows +100% faster and happiness +10%');
  for (const d of UPGRADES) assert.ok(!/\+0\.\d+/.test(d.desc), `${d.id}: raw decimal in desc "${d.desc}"`);
});

test('every effect leaves a deep-frozen state untouched and only writes the mods bag', () => {
  for (const d of UPGRADES) {
    const mods = createMods();
    assert.doesNotThrow(() => d.effect(mods, FROZEN_STATE), `${d.id}: effect threw on frozen state`);
    sanitizeMods(mods);
    for (const k of ['income', 'housing', 'jobs', 'power', 'demand', 'growth', 'inflow', 'cost', 'upkeep']) {
      assert.ok(Number.isFinite(mods[k]) && mods[k] > 0, `${d.id}: mods.${k} = ${mods[k]}`);
    }
    assert.ok(Number.isFinite(mods.happiness), `${d.id}: mods.happiness`);
    // Effects tolerate a missing state entirely.
    assert.doesNotThrow(() => d.effect(createMods(), undefined), `${d.id}: effect threw on undefined state`);
  }
});

test('every unlock tolerates {} / undefined / frozen inputs and returns a boolean', () => {
  for (const d of UPGRADES) {
    for (const [s, dv] of [
      [undefined, undefined],
      [{}, {}],
      [{ res: {}, buildings: {}, upgrades: {}, stats: {}, prestige: {}, unlocks: {} }, {}],
      [FROZEN_STATE, FROZEN_DERIVED],
    ]) {
      let r;
      assert.doesNotThrow(() => (r = d.unlock(s, dv)), `${d.id}: unlock threw`);
      assert.equal(typeof r, 'boolean', `${d.id}: unlock returned ${r}`);
    }
  }
  // A few rules against the frozen city: 20 shops, 25 factories, legacy 12, bond I owned at 120 s.
  assert.equal(byId('farmers-market').unlock(FROZEN_STATE), true);
  assert.equal(byId('container-port').unlock(FROZEN_STATE), true);
  assert.equal(byId('institutional-memory').unlock(FROZEN_STATE), true);
  assert.equal(byId('standing-orders').unlock(FROZEN_STATE), false);
  assert.equal(byId('smart-grid').unlock(FROZEN_STATE, FROZEN_DERIVED), true);
  assert.equal(byId('civic-bonds-2').unlock(FROZEN_STATE), false, 'bond II waits for 180 s');
  assert.equal(byId('civic-bonds-2').unlock({ ...FROZEN_STATE, time: 181 }), true);
  assert.equal(byId('civic-bonds-3').unlock({ ...FROZEN_STATE, time: 1e6 }), false, 'bond III needs bond II');
});

test('roman numerals', () => {
  assert.equal(roman(1), 'I');
  assert.equal(roman(4), 'IV');
  assert.equal(roman(9), 'IX');
  assert.equal(roman(14), 'XIV');
  assert.equal(roman(19), 'XIX');
  assert.equal(roman(30), 'XXX');
  assert.equal(roman(0), 'I', 'floors at I');
  assert.equal(roman(1994), 'MCMXCIV');
});

test('bondOpensAt: rung I is immediate, II at 180 s, later rungs geometric and inside a long cycle', () => {
  assert.equal(bondOpensAt(1), 0);
  assert.equal(bondOpensAt(2), 180);
  assert.equal(bondOpensAt(2), BOND_OPEN_2);
  for (let n = 3; n <= BOND_RUNGS; n++) {
    assert.ok(bondOpensAt(n) > bondOpensAt(n - 1), `rung ${n} opens after rung ${n - 1}`);
    const ratio = bondOpensAt(n) / bondOpensAt(n - 1);
    assert.ok(Math.abs(ratio - BOND_OPEN_STEP) < 0.02, `rung ${n} step ${ratio}`);
  }
  assert.ok(bondOpensAt(BOND_RUNGS) <= 35 * 60, `rung ${BOND_RUNGS} opens at ${bondOpensAt(BOND_RUNGS)} s (≤ 35 min)`);
  assert.equal(UPGRADES.filter((d) => d.id.startsWith('civic-bonds-')).length, BOND_RUNGS);
  assert.equal(UPGRADES.filter((d) => d.id.startsWith('skyline-expansion-')).length, 5);
});

test('horizonCost: seconds of income, floored, sane on negative/NaN/missing income', () => {
  const bond = byId('civic-bonds-3');
  assert.equal(BOND_SECONDS, 2);
  assert.equal(horizonCost(bond, { income: 1e9 }), 2e9);
  assert.equal(horizonCost(bond, { income: 1 }), BOND_FLOOR, 'floor wins when income is tiny');
  assert.equal(horizonCost(bond, { income: -5 }), BOND_FLOOR);
  assert.equal(horizonCost(bond, { income: NaN }), BOND_FLOOR);
  assert.equal(horizonCost(bond, { income: Infinity }), BOND_FLOOR);
  assert.equal(horizonCost(bond, undefined), BOND_FLOOR);
  assert.equal(horizonCost(bond, {}), BOND_FLOOR);
  assert.equal(BOND_FLOOR, 1e7);
  // Non-priced rungs report their own cost; garbage reports NaN.
  assert.equal(horizonCost(byId('welcome-sign'), { income: 1e9 }), 25);
  assert.ok(Number.isNaN(horizonCost(undefined, { income: 1 })));
  for (const d of UPGRADES) {
    if (!d.priced) continue;
    assert.equal(d.priced.seconds, BOND_SECONDS, `${d.id}: seconds`);
    assert.equal(d.priced.floor, BOND_FLOOR, `${d.id}: floor`);
    assert.equal(d.cost, BOND_FLOOR, `${d.id}: default cost is the floor`);
  }
});

test('applyOverride: bare number, object, junk', () => {
  const def = byId('welcome-sign');
  assert.equal(applyOverride(def, undefined), def, 'no override returns the same def');
  assert.equal(applyOverride(def, null), def);
  assert.equal(applyOverride(def, 99).cost, 99);
  assert.equal(applyOverride(def, { cost: 77 }).cost, 77);
  assert.equal(applyOverride(def, { cost: 77 }).unlockHint, def.unlockHint, 'hint survives the override');
  const o = applyOverride(def, { cost: 10, tier: 3, category: 'civic' });
  assert.equal(o.tier, 3);
  assert.equal(o.category, 'civic');
  assert.equal(applyOverride(def, { cost: -1, tier: 0, category: 'nope' }).cost, def.cost, 'bad values ignored');
  assert.equal(applyOverride(def, { category: 'nope' }).category, def.category);
  assert.equal(applyOverride(def, NaN).cost, def.cost);
  assert.equal(def.cost, 25, 'override never mutates the source def');
});

test('config overrides resolve to the documented costs', () => {
  const overrides = config.upgrades || {};
  const resolved = (id) => applyOverride(byId(id), overrides[id]).cost;
  assert.equal(resolved('zoning-reform'), 50);
  assert.equal(resolved('grant-writing'), 150);
  assert.equal(resolved('high-density'), 6000);
  assert.equal(resolved('prefab-construction'), 120000);
  assert.equal(resolved('ai-governance'), 1e11);
  assert.equal(resolved('planetary-charter'), 3e12);
  assert.equal(resolved('dynasty-ledger'), 150000);
  for (const id of Object.keys(overrides)) assert.ok(byId(id), `config overrides unknown upgrade ${id}`);
});

test('meaningfulness: no core rung weaker than +25% (or −20% cost / power)', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const mods = createMods();
  byId('grant-writing').effect(mods, {});
  assert.ok(near(mods.income, 1.25));
  const m2 = createMods();
  byId('bulk-permits').effect(m2, {});
  assert.ok(near(m2.cost, 0.8));
  const m3 = createMods();
  byId('founders-blueprints').effect(m3, {});
  assert.ok(near(m3.cost, 0.8));
  const m4 = createMods();
  byId('smart-grid').effect(m4, {});
  assert.ok(near(m4.demand, 0.8));
  const m5 = createMods();
  byId('superconductor-grid').effect(m5, {});
  assert.ok(near(m5.demand, 0.7));
  assert.notEqual(byId('welcome-sign').icon, byId('neon-signage').icon, 'distinct icons in the owned chip row');
});

test('keptUpgradeIds: memory rungs re-own tiers 1–2, standing orders tier 3 + Legacy; nothing without a keeper', () => {
  assert.deepEqual(keptUpgradeIds([]), []);
  assert.deepEqual(keptUpgradeIds(['welcome-sign', 'civic-bonds-3']), [], 'plain upgrades keep nothing');
  const mem = keptUpgradeIds(['institutional-memory']);
  assert.ok(mem.includes('institutional-memory'));
  for (const d of UPGRADES) {
    const core = !d.priced && d.category !== 'prestige';
    assert.equal(mem.includes(d.id), d.id === 'institutional-memory' || (core && d.tier <= 2), `memory keeps ${d.id}?`);
  }
  const both = keptUpgradeIds(['institutional-memory', 'standing-orders']);
  for (const d of UPGRADES) {
    const core = !d.priced && d.category !== 'prestige';
    const want = (core && d.tier <= 3) || (d.category === 'prestige' && !d.priced);
    assert.equal(both.includes(d.id), want, `both keep ${d.id}?`);
  }
  assert.ok(!both.includes('civic-bonds-1') && !both.includes('planetary-charter'), 'tier 4 and the horizon are decisions again');
  const memoryDefs = UPGRADES.filter((d) => typeof d.keeps === 'function');
  for (const d of memoryDefs) {
    const mods = createMods();
    d.effect(mods, FROZEN_STATE);
    assert.deepEqual(mods, createMods(), `${d.id}: structural rung changes no modifier`);
  }
});

test('init registers the ladder, and sortedUpgrades reads the live registry', async () => {
  const n = await init({ derived: { income: 0 }, state: { upgrades: {} } });
  assert.equal(n, UPGRADES.length);
  assert.equal(registry.upgrades.size, UPGRADES.length);
  const sorted = sortedUpgrades();
  assert.equal(sorted.length, UPGRADES.length);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].cost >= sorted[i - 1].cost, 'ascending');
  assert.equal(sorted[0].id, 'welcome-sign');
  // Config overrides are visible through the sorted view (raw data says $5e7 / $5e8).
  assert.equal(sorted.find((d) => d.id === 'ai-governance').cost, 1e11);
  // The income-price tick handler rewrites bond costs; the sorted view follows.
  const h = registry.tickHandlers.find((t) => t.name === 'upgrades:income-prices');
  assert.ok(h, 'income-price handler registered');
  h.fn({}, { income: 1e9 });
  assert.equal(registry.upgrades.get('civic-bonds-1').cost, 2e9);
  assert.equal(sortedUpgrades().find((d) => d.id === 'civic-bonds-1').cost, 2e9);
  assert.equal(sortedUpgrades(UPGRADES).find((d) => d.id === 'civic-bonds-1').cost, BOND_FLOOR, 'explicit defs are sorted as given');
  assert.ok(registry.actions.has('fundUpgrades'), 'fundUpgrades action registered');
  assert.ok(registry.tickHandlers.some((t) => t.name === 'upgrades:memory'), 'memory handler registered');
});
