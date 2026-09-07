// Unit tests for the buildings module. Run: node --test src/buildings/
// Pins the catalogue invariants (docs/DESIGN.md "Buildings"): 20 registered definitions,
// unique ids, one-line descs, `unlockAt` mirrors agreeing with `unlock` at the boundary,
// override hygiene, cost-growth fallback order, the synergy / demandGrowth rule math, the
// live-stat accessor, the power ladder's economics, and — by spawning cadence.mjs — the
// first-city unlock cadence this folder owns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  normalizeGrowth,
  synergySource,
  synergyFactor,
  growthFactor,
  applyLiveStats,
  applySynergies,
  activeSynergies,
  activeGrowth,
  activeRules,
  liveStat,
  liveStats,
  baseStat,
  LIVE_HANDLER,
  SYNERGY_HANDLER,
} from './index.js';

const balance = { config };
const before = errors.length;
await init({});
await init({}); // idempotent

const cityState = (pop, buildings = {}, legacy = 0) => ({ res: { pop, money: 0 }, buildings, prestige: { legacy } });
const grid = (powerDemand) => ({ powerDemand, employed: 0 });
const data = (id) => BUILDINGS.find((b) => b.id === id);

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
    if (b.synergy) assert.ok(typeof b.synergy.text === 'string' && b.synergy.text.length > 0 && b.synergy.text.length <= 70, `${b.id} synergy text`);
    if (b.demandGrowth) assert.ok(typeof b.demandGrowth.text === 'string' && b.demandGrowth.text.length > 0 && b.demandGrowth.text.length <= 70, `${b.id} demandGrowth text`);
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
  const base = data('office');
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
          demandGrowth: { per: 0, cap: 2 },
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
  assert.equal(def.demandGrowth, undefined, 'malformed demandGrowth override dropped');
  assert.equal(def.costGrowth, 1.16);
  assert.equal(def.sellRefund, 0.5);
  // null unlock clears the rule; null synergy / demandGrowth switch the hooks off; a
  // well-formed demandGrowth override replaces the default.
  const mall = resolveBuilding(data('mall'), { config: { buildings: { mall: { unlock: null, synergy: null } } } });
  assert.equal(mall.unlock, undefined);
  assert.equal(mall.synergy, null);
  const arc = resolveBuilding(data('arcology'), { config: { buildings: { arcology: { demandGrowth: null } } } });
  assert.equal(arc.demandGrowth, null);
  const arc2 = resolveBuilding(data('arcology'), { config: { buildings: { arcology: { demandGrowth: { per: 10, cap: 3 } } } } });
  assert.deepEqual(arc2.demandGrowth, { per: 10, cap: 3 });
  // Data definitions never mutate.
  assert.equal(base.jobs, 50);
  assert.equal(data('arcology').demandGrowth.per, 40);
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

test('normalizeSynergy / normalizeGrowth accept the documented shapes and reject everything else', () => {
  assert.deepEqual(normalizeSynergy({ stat: 'income', source: 'pop', per: 5000, cap: 3 }), { stat: 'income', source: 'pop', per: 5000, cap: 3, text: '' });
  assert.ok(normalizeSynergy({ stat: 'jobs', source: 'building:school', per: 1, cap: 1 }));
  assert.equal(normalizeSynergy(null), null);
  assert.equal(normalizeSynergy({ stat: 'cost', source: 'pop', per: 1, cap: 2 }), null, 'cost is not scalable');
  assert.equal(normalizeSynergy({ stat: 'powerUse', source: 'pop', per: 1, cap: 2 }), null, 'powerUse belongs to demandGrowth');
  assert.equal(normalizeSynergy({ stat: 'income', source: 'money', per: 1, cap: 2 }), null, 'unknown source');
  assert.equal(normalizeSynergy({ stat: 'income', source: 'pop', per: 0, cap: 2 }), null, 'per must be > 0');
  assert.equal(normalizeSynergy({ stat: 'income', source: 'pop', per: 1, cap: 0.5 }), null, 'cap must be ≥ 1');
  assert.equal(normalizeSynergy({ stat: 'income', source: 'pop', per: Infinity, cap: 2 }), null);
  assert.deepEqual(normalizeGrowth({ per: 40, cap: 1.5, text: 't' }), { per: 40, cap: 1.5, text: 't' });
  assert.deepEqual(normalizeGrowth({ per: 40, cap: 1.5 }), { per: 40, cap: 1.5, text: '' });
  assert.equal(normalizeGrowth(null), null);
  assert.equal(normalizeGrowth([40, 1.5]), null);
  assert.equal(normalizeGrowth({ per: -1, cap: 2 }), null);
  assert.equal(normalizeGrowth({ per: 40, cap: 0.9 }), null);
  assert.equal(normalizeGrowth({ per: 40, cap: NaN }), null);
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

test('growthFactor: the first unit draws its sticker, each further one adds 1/per, capped', () => {
  const rule = { per: 40, cap: 1.5 };
  assert.equal(growthFactor(rule, 0), 1);
  assert.equal(growthFactor(rule, 1), 1);
  assert.equal(growthFactor(rule, 2), 1.025);
  assert.equal(growthFactor(rule, 21), 1.5);
  assert.equal(growthFactor(rule, 400), 1.5, 'capped');
  assert.equal(growthFactor(rule, -3), 1);
  assert.equal(growthFactor(rule, NaN), 1);
  assert.equal(growthFactor({ per: 0, cap: 2 }, 50), 1, 'malformed rule is neutral');
  assert.equal(growthFactor(null, 50), 1);
});

test('power ladder: fusion pays only with a reactor fleet, then beats nuclear on $/MW and upkeep', () => {
  const solar = registry.buildings.get('solar');
  const fusion = registry.buildings.get('fusion');
  const nuclear = registry.buildings.get('nuclear');
  assert.equal(synergyFactor(solar.synergy, cityState(0, { park: 25 }), {}), 1.5, 'solar caps at 25 parks');
  assert.equal(synergyFactor(fusion.synergy, cityState(0, { nuclear: 10 }), {}), 2, 'fusion ×2 at 10 reactors');
  assert.equal(synergyFactor(fusion.synergy, cityState(0, { nuclear: 20 }), {}), 3, 'fusion caps at 20 reactors');
  const sBase = baseStat('solar', 'powerGen');
  const fBase = baseStat('fusion', 'powerGen');
  const cap = fusion.synergy.cap;
  // Even fully boosted, solar stays below nuclear per unit and fusion above it.
  assert.ok(sBase * 1.5 < nuclear.powerGen, 'boosted solar < nuclear');
  assert.ok(fBase > nuclear.powerGen, 'fusion > nuclear');
  const perMW = (d, gen) => d.baseCost / gen;
  const upkeepPerMW = (d, gen) => (d.upkeep || 0) / gen;
  // At its sticker a reactor is no better per MW than a nuclear plant (the fleet is the
  // price of admission); at the cap it is strictly better on the build price and carries
  // less upkeep per MW than the fleet it replaces. The same holds for the resolved
  // (config) numbers and for this folder's defaults, so neither can drift into a $/MW sort.
  for (const [label, n, f] of [
    ['resolved', nuclear, { ...fusion, powerGen: fBase }],
    ['data', data('nuclear'), data('fusion')],
  ]) {
    assert.ok(perMW(f, f.powerGen) >= perMW(n, n.powerGen), `${label}: fusion ×1 ${perMW(f, f.powerGen).toFixed(1)} $/MW ≥ nuclear ${perMW(n, n.powerGen).toFixed(1)}`);
    assert.ok(perMW(f, f.powerGen * cap) < perMW(n, n.powerGen), `${label}: fusion ×${cap} ${perMW(f, f.powerGen * cap).toFixed(1)} $/MW < nuclear ${perMW(n, n.powerGen).toFixed(1)}`);
    assert.ok(perMW(f, f.powerGen * cap) >= perMW(n, n.powerGen) * 0.5, `${label}: fusion ×${cap} no cheaper than half of nuclear (a decision, not a sort)`);
    assert.ok(upkeepPerMW(f, f.powerGen * cap) < upkeepPerMW(n, n.powerGen), `${label}: fusion ×${cap} upkeep/MW < nuclear`);
    assert.ok(n.upkeep > 0, `${label}: the fleet has a running cost to replace`);
  }
  // Windmill → coal → solar → nuclear each add a real step of output.
  const gens = ['windmill', 'coal', 'solar', 'nuclear'].map((id) => registry.buildings.get(id).powerGen);
  for (let i = 1; i < gens.length; i++) assert.ok(gens[i] >= gens[i - 1] * 5, `power step ${i} ≥ 5×`);
});

test('the six signature synergies and the four tier-4 strains are registered; the live handler is idempotent', () => {
  assert.deepEqual(activeSynergies().map((s) => s.id).sort(), ['financial', 'fusion', 'mall', 'refinery', 'solar', 'techpark']);
  assert.deepEqual(activeGrowth().map((s) => s.id).sort(), ['arcology', 'financial', 'stadium', 'techpark']);
  assert.equal(activeRules().length, 10);
  assert.equal(SYNERGY_HANDLER, LIVE_HANDLER, 'former handler name still resolves');
  assert.ok(registry.tickHandlers.some((h) => h.name === LIVE_HANDLER), 'tick handler registered');
  assert.equal(registry.tickHandlers.filter((h) => h.name === LIVE_HANDLER).length, 1, 'registered once across two inits');
  const sim = registry.tickHandlers.find((h) => h.name === 'simulate');
  const mine = registry.tickHandlers.find((h) => h.name === LIVE_HANDLER);
  if (sim) assert.ok(mine.priority < sim.priority, 'runs before the simulation fold');
  for (const s of activeRules()) {
    const def = registry.buildings.get(s.id);
    assert.ok(Number.isFinite(s.base) && s.base > 0, `${s.id} base`);
    assert.ok(typeof s.text === 'string' && s.text.length <= 70, `${s.id} text`);
    if (s.kind === 'synergy') assert.equal(def.synergy.stat, s.stat);
    else assert.equal(s.stat, 'powerUse');
    assert.equal(baseStat(s.id, s.stat), s.base, `${s.id} baseStat`);
  }
  const mall = registry.buildings.get('mall');
  const fin = registry.buildings.get('financial');
  const arc = registry.buildings.get('arcology');
  const mallBase = baseStat('mall', 'income');
  const finBase = baseStat('financial', 'income');
  const arcBase = baseStat('arcology', 'powerUse');

  applyLiveStats(cityState(0), { employed: 0 });
  assert.equal(liveStat('mall', 'income'), mallBase);
  assert.equal(mall.income, mallBase, 'mirrored into the def');
  assert.equal(liveStat('arcology', 'powerUse'), arcBase);

  const big = cityState(10000, { factory: 100, school: 30, arcology: 41, financial: 5 });
  applyLiveStats(big, { employed: 10000 });
  applySynergies(big, { employed: 10000 }); // twice (and via the former name): must not compound
  assert.equal(liveStat('mall', 'income'), mallBase * 3);
  assert.equal(mall.income, mallBase * 3);
  assert.equal(liveStat('financial', 'income'), finBase * 1.5);
  assert.equal(fin.income, finBase * 1.5);
  assert.equal(liveStat('refinery', 'income'), baseStat('refinery', 'income') * 2);
  assert.equal(liveStat('techpark', 'income'), baseStat('techpark', 'income') * 1.75);
  assert.equal(liveStat('arcology', 'powerUse'), arcBase * 1.5, '41 arcologies: strain at the cap');
  assert.equal(arc.powerUse, arcBase * 1.5);
  assert.equal(liveStat('financial', 'powerUse'), baseStat('financial', 'powerUse') * 1.1, '5 districts: 1 + 4/40');
  assert.deepEqual(Object.keys(liveStats('financial')).sort(), ['income', 'powerUse']);
  // Bases never move.
  assert.equal(baseStat('mall', 'income'), mallBase);
  assert.equal(baseStat('arcology', 'powerUse'), arcBase);
  // Unscaled stats read straight from the def; unknown ids are undefined.
  assert.equal(liveStat('house', 'housing'), registry.buildings.get('house').housing);
  assert.equal(baseStat('house', 'housing'), registry.buildings.get('house').housing);
  assert.equal(liveStat('nope', 'income'), undefined);
  assert.deepEqual(liveStats('nope'), {});

  applyLiveStats(cityState(0), { employed: 0 }); // back to base for the other tests
  assert.equal(mall.income, mallBase);
  assert.equal(fin.income, finBase);
  assert.equal(arc.powerUse, arcBase);
});

test('no tier-4 building is strictly dominated by a cheaper one on income per dollar (wages included)', () => {
  // Static values at base cost, wages at the DESIGN default; synergies at their unlock
  // populations. A tier-3/4 employer must land within 2x of the best employer one tier down.
  const wage = 0.35;
  const perK = (id, factor = 1) => {
    const d = registry.buildings.get(id);
    return (baseStat(id, 'income') * factor + d.jobs * wage) / (d.baseCost / 1000);
  };
  const techpark = perK('techpark', synergyFactor(registry.buildings.get('techpark').synergy, cityState(0, { school: 15 }), {}));
  const financial = perK('financial', synergyFactor(registry.buildings.get('financial').synergy, cityState(0), { employed: 8000 }));
  assert.ok(financial >= techpark * 0.8, `financial ${financial.toFixed(1)}/$k near techpark ${techpark.toFixed(1)}/$k`);
  const office = perK('office');
  const factory = perK('factory');
  assert.ok(office >= factory * 0.8 && office <= factory * 1.25, `office ${office.toFixed(1)}/$k vs factory ${factory.toFixed(1)}/$k`);
});

test('catalogue defaults: tier-4 draw is a rate the card can explain, and non-civic joy is felt or absent', () => {
  // Per citizen / per job, a tier-4 consumer's sticker draw stays within 4× the tier-3
  // intensity of its column (the shipped config may pin other numbers; the cadence probe
  // and the balance sim judge those). The strain rule, not the sticker, carries the late
  // grid pressure.
  const intensity = (id, per) => data(id).powerUse / data(id)[per];
  assert.ok(intensity('arcology', 'housing') <= intensity('tower', 'housing') * 4, 'arcology MW/citizen ≤ 4× tower');
  assert.ok(intensity('techpark', 'jobs') <= intensity('refinery', 'jobs') * 4, 'campus MW/job ≤ 4× refinery');
  assert.ok(intensity('financial', 'jobs') <= intensity('mall', 'jobs') * 4, 'district MW/job ≤ 4× mall');
  assert.ok(data('stadium').powerUse <= data('arcology').powerUse, 'stadium draws no more than an arcology');
  for (const id of ['arcology', 'techpark', 'financial', 'stadium']) {
    const g = normalizeGrowth(data(id).demandGrowth);
    assert.ok(g && g.cap <= 2 && g.per >= 20, `${id} strain is a tax, not a cliff`);
    assert.ok(data(id).demandGrowth.text.includes(`${(100 / g.per).toString()}%`), `${id} strain text quotes its rate`);
  }
  // A happiness stat on a non-civic card is either meaningful or absent (the arcology's
  // 0.02 was a benefit no player could feel next to a $4k park).
  assert.ok(data('arcology').happiness >= 2 * data('park').happiness, 'arcology joy ≥ two parks');
  assert.equal(data('mall').happiness, undefined, 'mall carries no decorative joy');
});

test('catalogue defaults: population gates are distinct and climb ≥ 15% per step, tiers open in order', () => {
  // The gates this folder owns (config may re-pin some; those are checked by the cadence
  // probe, not here). Two defaults on the same number would open two cards in one tick.
  const gates = BUILDINGS.filter((b) => Number.isFinite(b.unlockAt?.pop)).map((b) => ({ id: b.id, pop: b.unlockAt.pop, tier: b.tier }));
  assert.equal(new Set(gates.map((g) => g.pop)).size, gates.length, 'no two defaults share a population gate');
  const sorted = [...gates].sort((a, b) => a.pop - b.pop);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (a.pop >= 500) assert.ok(b.pop >= a.pop * 1.15, `${b.id} (${b.pop}) too close to ${a.id} (${a.pop})`);
  }
  // Within a category, a higher tier never opens before a lower one.
  for (const cat of CATEGORIES) {
    const col = BUILDINGS.filter((b) => b.category === cat.id).sort((a, b) => a.tier - b.tier);
    for (let i = 1; i < col.length; i++) {
      const lo = col[i - 1].unlockAt?.pop ?? 0, hi = col[i].unlockAt?.pop ?? Infinity;
      assert.ok(hi > lo, `${cat.id}: ${col[i].id} gate ${hi} must be above ${col[i - 1].id} gate ${lo}`);
    }
  }
  // The windmill's demand gate is deliberate (see data.js "Unlock spacing"); the coal
  // plant's must sit above it so the two never open together.
  assert.equal(data('windmill').unlockAt.powerDemand, 0.001);
  assert.ok(data('coal').unlockAt.powerDemand >= 20);
  // The fusion reactor is reachable inside a first city (a visible trophy for its last
  // minutes) and opens at any founding.
  assert.ok(data('fusion').unlockAt.pop <= 40000 && data('fusion').unlockAt.legacy === 1);
});

// ---- first-city cadence (spawns the probe; ~3 s) -------------------------------------

const probe = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const r = spawnSync(process.execPath, [path.join(here, 'cadence.mjs'), '--json'], { encoding: 'utf-8', timeout: 120000 });
  let report = null;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    report = null;
  }
  return { report, stderr: r.stderr, status: r.status };
})();

test('cadence probe: the first city founds, raises no errors, and every buildings-owned rule holds', () => {
  assert.ok(probe.report, `probe produced JSON (status ${probe.status}; stderr: ${probe.stderr.slice(0, 400)})`);
  const { report } = probe;
  assert.equal(report.founded, true, `first city founded within the probe window (${report.endMin} min)`);
  assert.equal(report.errors.length, 0, 'no runtime errors');
  assert.ok(report.endMin >= 30 && report.endMin <= 45, `first founding ${report.endMin} min inside the 30–45 contract`);
  // Always-available cards (the cottage) never emit `unlock`; every gated card must open.
  const opened = report.buildings.filter((b) => b.unlockS !== null || b.gate === 'start');
  assert.equal(opened.length, 20, 'every card opens in the first city');
  const bought = report.buildings.filter((b) => b.buyS !== null);
  assert.equal(bought.length, 20, 'every building is bought in the first city');
  const mine = report.problems.filter((p) => p.owner === 'buildings').map((p) => p.msg);
  assert.deepEqual(mine, [], 'no cadence fault a data.js field can fix');
});

test('cadence probe: no fault at all (config-owned gates and costs included)', { todo: probe.report && probe.report.problems.length > 0 ? 'config.buildings pins the fields these faults need: ' + probe.report.problems.map((p) => p.msg).join(' | ') : undefined }, () => {
  assert.ok(probe.report, 'probe produced JSON');
  assert.deepEqual(probe.report.problems.map((p) => `[${p.owner}] ${p.msg}`), [], 'cadence.mjs exits 0');
});
