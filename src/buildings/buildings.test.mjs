// Unit tests for the buildings module. Run: node --test src/buildings/
// Pins the catalogue invariants (docs/DESIGN.md "Buildings"): 20 registered definitions,
// unique ids, one-line descs, `unlockAt` mirrors agreeing with `unlock` at the boundary,
// override hygiene, cost-growth fallback order, and the synergy rule math.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../core/registry.js';
import { errors } from '../core/state.js';
import { config } from '../balance/config.js';
import {
  init,
  BUILDINGS,
  CATEGORIES,
  resolveBuilding,
  costGrowthForTier,
  normalizeSynergy,
  synergySource,
  synergyFactor,
  applySynergies,
  activeSynergies,
  SYNERGY_HANDLER,
} from './index.js';

const balance = { config };
const before = errors.length;
await init({});
await init({}); // idempotent

const cityState = (pop, buildings = {}, legacy = 0) => ({ res: { pop, money: 0 }, buildings, prestige: { legacy } });
const grid = (powerDemand) => ({ powerDemand, employed: 0 });

test('init registers all 20 definitions once, with unique ids and no errors', () => {
  assert.equal(BUILDINGS.length, 20);
  assert.equal(new Set(BUILDINGS.map((b) => b.id)).size, 20);
  for (const b of BUILDINGS) assert.ok(registry.buildings.has(b.id), `${b.id} registered`);
  assert.equal(registry.buildingOrder.filter((id) => BUILDINGS.some((b) => b.id === id)).length, 20);
  assert.equal(errors.length, before, 'init raised no errors');
});

test('every definition has the fields the build card needs', () => {
  const cats = new Set(CATEGORIES.map((c) => c.id));
  for (const b of BUILDINGS) {
    assert.ok(typeof b.name === 'string' && b.name.trim(), `${b.id} name`);
    assert.ok(typeof b.icon === 'string' && b.icon, `${b.id} icon`);
    assert.ok(typeof b.desc === 'string' && b.desc.length > 0 && b.desc.length <= 70, `${b.id} desc ≤ 70 chars (${b.desc.length})`);
    assert.ok(cats.has(b.category), `${b.id} category`);
    assert.ok([1, 2, 3, 4].includes(b.tier), `${b.id} tier`);
    assert.ok(Number.isFinite(b.baseCost) && b.baseCost > 0, `${b.id} baseCost`);
    assert.ok(typeof b.unlockHint === 'string' && b.unlockHint.trim(), `${b.id} unlockHint`);
    if (b.unlock) assert.ok(b.unlockAt && typeof b.unlockAt === 'object', `${b.id} has an unlockAt mirror`);
  }
  assert.equal(CATEGORIES.length, 5);
  assert.deepEqual(
    CATEGORIES.map((c) => c.id),
    ['residential', 'commercial', 'industrial', 'power', 'civic'],
  );
});

test('unlockAt mirrors agree with the registered unlock rule at the boundary', () => {
  for (const id of registry.buildingOrder) {
    const def = registry.buildings.get(id);
    if (!BUILDINGS.some((b) => b.id === id)) continue;
    const at = def.unlockAt;
    if (!def.unlock) {
      assert.equal(at, undefined, `${id}: always available has no mirror`);
      continue;
    }
    assert.ok(at && typeof at === 'object', `${id} unlockAt`);
    if (Number.isFinite(at.pop)) {
      assert.equal(def.unlock(cityState(at.pop - 1), grid(0)), false, `${id}: pop ${at.pop - 1} locked`);
      assert.equal(def.unlock(cityState(at.pop), grid(0)), true, `${id}: pop ${at.pop} open`);
    }
    if (Number.isFinite(at.powerDemand)) {
      if (at.powerDemand < 1) {
        assert.equal(def.unlock(cityState(0), grid(0)), false, `${id}: no draw locked`);
        assert.equal(def.unlock(cityState(0), grid(0.5)), true, `${id}: any draw open`);
      } else {
        assert.equal(def.unlock(cityState(0), grid(at.powerDemand - 1)), false, `${id}: demand below locked`);
        assert.equal(def.unlock(cityState(0), grid(at.powerDemand)), true, `${id}: demand at open`);
      }
    }
    if (Number.isFinite(at.legacy)) {
      assert.equal(def.unlock(cityState(0, {}, at.legacy - 1), grid(0)), false, `${id}: legacy below locked`);
      assert.equal(def.unlock(cityState(0, {}, at.legacy), grid(0)), true, `${id}: legacy at open`);
    }
    assert.ok(Number.isFinite(at.pop) || Number.isFinite(at.powerDemand) || Number.isFinite(at.legacy), `${id}: mirror has a measurable key`);
    // The hint quotes the number the mirror carries.
    if (Number.isFinite(at.pop) && at.pop >= 1000) assert.ok(def.unlockHint.includes(at.pop.toLocaleString('en-US')), `${id}: hint quotes ${at.pop}`);
  }
});

test('unlock rules tolerate garbage state', () => {
  for (const id of registry.buildingOrder) {
    const def = registry.buildings.get(id);
    if (!def.unlock) continue;
    assert.equal(def.unlock(undefined, undefined), false, `${id} on undefined`);
    assert.equal(def.unlock({}, {}), false, `${id} on empty`);
  }
});

test('resolveBuilding applies config overrides and drops poisonous values', () => {
  const base = BUILDINGS.find((b) => b.id === 'office');
  const def = resolveBuilding(base, {
    config: {
      cost: { tierGrowth: { 2: 1.16 }, sellRefund: 0.5 },
      buildings: {
        office: {
          id: 'hijacked',
          baseCost: NaN,
          income: -Infinity,
          jobs: 55,
          tier: 'two',
          category: 'casino',
          unlock: 'not a function',
          unlockHint: 'Reach 90 citizens',
          synergy: { stat: 'cost', source: 'pop', per: 1, cap: 2 },
        },
      },
    },
  });
  assert.equal(def.id, 'office');
  assert.equal(def.baseCost, base.baseCost, 'NaN baseCost falls back to data');
  assert.equal(def.income, base.income, 'non-finite income dropped');
  assert.equal(def.jobs, 55, 'finite override applied');
  assert.equal(def.tier, 2, 'non-numeric tier dropped');
  assert.equal(def.category, 'commercial', 'unknown category dropped');
  assert.equal(def.unlock, base.unlock, 'non-function unlock keeps the data rule');
  assert.equal(def.unlockHint, 'Reach 90 citizens', 'free-form string fields pass through');
  assert.equal(def.synergy, undefined, 'malformed synergy override dropped');
  assert.equal(def.costGrowth, 1.16);
  assert.equal(def.sellRefund, 0.5);
  // null unlock clears the rule; null synergy switches the hook off.
  const mall = resolveBuilding(BUILDINGS.find((b) => b.id === 'mall'), { config: { buildings: { mall: { unlock: null, synergy: null } } } });
  assert.equal(mall.unlock, undefined);
  assert.equal(mall.synergy, null);
  // Data definitions never mutate.
  assert.equal(base.jobs, 50);
});

test('costGrowthForTier fallback order: costGrowthFor → config.cost.tierGrowth → defaults', () => {
  assert.equal(costGrowthForTier(2, { costGrowthFor: () => 1.3, config: { cost: { tierGrowth: { 2: 1.2 } } } }), 1.3);
  assert.equal(costGrowthForTier(2, { costGrowthFor: () => NaN, config: { cost: { tierGrowth: { 2: 1.2 } } } }), 1.2);
  assert.equal(costGrowthForTier(2, { costGrowthFor: () => 0.5, config: { cost: { tierGrowth: { 2: 1.2 } } } }), 1.2);
  assert.equal(costGrowthForTier(2, { config: { cost: { tierGrowth: { 2: 'x' } } } }), 1.14);
  assert.equal(costGrowthForTier(3, null), 1.13);
  assert.equal(costGrowthForTier(9, null), 1.12, 'unknown tier → tier-4 default');
  assert.equal(costGrowthForTier('1', null), 1.15, 'non-integer tier → tier 1');
  const n = errors.length;
  assert.equal(
    costGrowthForTier(1, {
      costGrowthFor: () => {
        throw new Error('boom');
      },
      config: { cost: { tierGrowth: { 1: 1.18 } } },
    }),
    1.18,
  );
  assert.equal(errors.length, n + 1, 'a throwing costGrowthFor is reported, not fatal');
  errors.length = n;
});

test('normalizeSynergy accepts the documented shape and rejects everything else', () => {
  assert.deepEqual(normalizeSynergy({ stat: 'income', source: 'pop', per: 5000, cap: 3 }), { stat: 'income', source: 'pop', per: 5000, cap: 3, text: '' });
  assert.ok(normalizeSynergy({ stat: 'jobs', source: 'building:school', per: 1, cap: 1 }));
  assert.equal(normalizeSynergy(null), null);
  assert.equal(normalizeSynergy({ stat: 'cost', source: 'pop', per: 1, cap: 2 }), null, 'cost is not scalable');
  assert.equal(normalizeSynergy({ stat: 'income', source: 'money', per: 1, cap: 2 }), null, 'unknown source');
  assert.equal(normalizeSynergy({ stat: 'income', source: 'pop', per: 0, cap: 2 }), null, 'per must be > 0');
  assert.equal(normalizeSynergy({ stat: 'income', source: 'pop', per: 1, cap: 0.5 }), null, 'cap must be ≥ 1');
  assert.equal(normalizeSynergy({ stat: 'income', source: 'pop', per: Infinity, cap: 2 }), null);
});

test('synergyFactor: 1 + source/per, capped, never below 1, garbage-safe', () => {
  const rule = { stat: 'income', source: 'employed', per: 20000, cap: 2.5 };
  assert.equal(synergyFactor(rule, cityState(0), { employed: 0 }), 1);
  assert.equal(synergyFactor(rule, cityState(0), { employed: 10000 }), 1.5);
  assert.equal(synergyFactor(rule, cityState(0), { employed: 1e9 }), 2.5, 'capped');
  assert.equal(synergyFactor(rule, cityState(0), { employed: -5 }), 1, 'negative source reads as 0');
  assert.equal(synergyFactor(rule, cityState(0), { employed: NaN }), 1);
  assert.equal(synergyFactor(rule, undefined, undefined), 1);
  assert.equal(synergyFactor({ stat: 'income', source: 'pop', per: 5000, cap: 3 }, cityState(2500), {}), 1.5);
  assert.equal(synergyFactor({ stat: 'income', source: 'building:factory', per: 50, cap: 2 }, cityState(0, { factory: 25 }), {}), 1.5);
  assert.equal(synergyFactor({ stat: 'income', source: 'building:factory', per: 50, cap: 2 }, cityState(0, { factory: 500 }), {}), 2);
  assert.equal(synergyFactor({ stat: 'income', source: 'nope', per: 1, cap: 2 }, cityState(9), {}), 1, 'malformed rule is neutral');
  assert.equal(synergySource('building:school', cityState(0, { school: 7 }), {}), 7);
  assert.equal(synergySource('pop', null, null), 0);
  // `employed` falls back to min(pop, jobs) before the first simulate() has filled it in.
  assert.equal(synergySource('employed', cityState(500), { jobs: 300 }), 300, 'unset employed → min(pop, jobs)');
  assert.equal(synergySource('employed', cityState(100), { jobs: 300 }), 100);
  assert.equal(synergySource('employed', cityState(500), {}), 0, 'no jobs either → 0');
  assert.equal(synergySource('employed', cityState(500), { employed: 42, jobs: 300 }), 42, 'live value wins');
});

test('power synergies scale output and keep the ladder ordered', () => {
  const solar = registry.buildings.get('solar');
  const fusion = registry.buildings.get('fusion');
  const nuclear = registry.buildings.get('nuclear');
  assert.equal(synergyFactor(solar.synergy, cityState(0, { park: 25 }), {}), 1.5, 'solar caps at 25 parks');
  assert.equal(synergyFactor(fusion.synergy, cityState(0, { nuclear: 10 }), {}), 2, 'fusion caps at 10 reactors');
  const sBase = activeSynergies().find((s) => s.id === 'solar').base;
  const fBase = activeSynergies().find((s) => s.id === 'fusion').base;
  // Even fully boosted, solar stays below nuclear per unit and fusion above it.
  assert.ok(sBase * 1.5 < nuclear.powerGen, 'boosted solar < nuclear');
  assert.ok(fBase > nuclear.powerGen, 'fusion > nuclear');
  // Fully boosted fusion is no cheaper per MW than nuclear by more than 25%: a choice, not a sort.
  const perMW = (d, f = 1) => d.baseCost / (d.powerGen * f);
  assert.ok(perMW(fusion, 2) >= perMW(nuclear) * 0.75, `fusion ×2 ${perMW(fusion, 2).toFixed(1)} $/MW vs nuclear ${perMW(nuclear).toFixed(1)}`);
});

test('the six signature synergies are registered and applySynergies is idempotent', () => {
  const active = activeSynergies();
  assert.deepEqual(active.map((s) => s.id).sort(), ['financial', 'fusion', 'mall', 'refinery', 'solar', 'techpark']);
  assert.ok(registry.tickHandlers.some((h) => h.name === SYNERGY_HANDLER), 'tick handler registered');
  const sim = registry.tickHandlers.find((h) => h.name === 'simulate');
  const mine = registry.tickHandlers.find((h) => h.name === SYNERGY_HANDLER);
  if (sim) assert.ok(mine.priority < sim.priority, 'runs before the simulation fold');
  for (const s of active) {
    const def = registry.buildings.get(s.id);
    assert.ok(Number.isFinite(s.base) && s.base > 0, `${s.id} base`);
    assert.ok(typeof s.text === 'string' && s.text.length <= 70, `${s.id} text`);
    assert.equal(def.synergy.stat, s.stat);
  }
  const mall = registry.buildings.get('mall');
  const fin = registry.buildings.get('financial');
  const mallBase = active.find((s) => s.id === 'mall').base;
  const finBase = active.find((s) => s.id === 'financial').base;

  applySynergies(cityState(0), { employed: 0 });
  assert.equal(mall.income, mallBase);
  assert.equal(fin.income, finBase);

  const big = cityState(10000, { factory: 100, school: 30 });
  applySynergies(big, { employed: 10000 });
  applySynergies(big, { employed: 10000 }); // twice: must not compound
  assert.equal(mall.income, mallBase * 3);
  assert.equal(fin.income, finBase * 1.5);
  assert.equal(registry.buildings.get('refinery').income, active.find((s) => s.id === 'refinery').base * 2);
  assert.equal(registry.buildings.get('techpark').income, active.find((s) => s.id === 'techpark').base * 1.75);

  applySynergies(cityState(0), { employed: 0 }); // back to base for the other tests
  assert.equal(mall.income, mallBase);
  assert.equal(fin.income, finBase);
});

test('no tier-4 building is strictly dominated by a cheaper one on income per dollar (wages included)', () => {
  // Static values at base cost, wages at the DESIGN default; synergies at their unlock
  // populations. A tier-3/4 employer must land within 2x of the best employer one tier down.
  const wage = 0.35;
  const perK = (id, factor = 1) => {
    const d = registry.buildings.get(id);
    return (d.income * factor + d.jobs * wage) / (d.baseCost / 1000);
  };
  const techpark = perK('techpark', synergyFactor(registry.buildings.get('techpark').synergy, cityState(0, { school: 15 }), {}));
  const financial = perK('financial', synergyFactor(registry.buildings.get('financial').synergy, cityState(0), { employed: 8000 }));
  assert.ok(financial >= techpark * 0.8, `financial ${financial.toFixed(1)}/$k near techpark ${techpark.toFixed(1)}/$k`);
  const office = perK('office');
  const factory = perK('factory');
  assert.ok(office >= factory * 0.8 && office <= factory * 1.25, `office ${office.toFixed(1)}/$k vs factory ${factory.toFixed(1)}/$k`);
});
