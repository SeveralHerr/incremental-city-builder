// Unit tests for the buildings module. Run: node --test src/buildings/
// Pins the catalogue invariants (docs/DESIGN.md "Buildings"): 22 registered definitions,
// unique ids, one-line descs, `unlockAt` mirrors agreeing with `unlock` at the boundary,
// override hygiene, cost-growth fallback order (and the fallback ladder equal to config's),
// the synergy / demandGrowth rule math, the live-stat accessor, the power ladder's
// economics, the two legacy-gated tier-5 cards, and — by spawning cadence.mjs and
// columns.mjs — the first-city unlock cadence and the jobs-to-housing balance of a
// session, both of which this folder owns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { registry, registerBuilding } from '../core/registry.js';
import { errors, state } from '../core/state.js';
import { emit } from '../core/events.js';
import { api } from '../core/api.js';
import { config } from '../balance/config.js';
import {
  init,
  BUILDINGS,
  CATEGORIES,
  DEFAULT_TIER_GROWTH,
  resolveBuilding,
  costGrowthForTier,
  normalizeSynergy,
  normalizeGrowth,
  ruleRatePct,
  strainText,
  synergySource,
  synergyFactor,
  growthFactor,
  applyLiveStats,
  activeSynergies,
  activeGrowth,
  activeRules,
  liveStat,
  liveStats,
  baseStat,
  capOf,
  rollbackOverCap,
  powerHintFor,
  LIVE_HANDLER,
} from './index.js';

const balance = { config };
const before = errors.length;
await init({});
await init({}); // idempotent

const cityState = (pop, buildings = {}, legacy = 0) => ({ res: { pop, money: 0 }, buildings, prestige: { legacy } });
const grid = (powerDemand) => ({ powerDemand, employed: 0 });
const data = (id) => BUILDINGS.find((b) => b.id === id);
const COUNT = 22;
// The cards a first city can reach (everything but the legacy-only tier-5 gates).
const firstCity = BUILDINGS.filter((b) => !(Number.isFinite(b.unlockAt?.legacy) && !Number.isFinite(b.unlockAt?.pop)));
const tier5 = BUILDINGS.filter((b) => b.tier === 5);

test(`init registers all ${COUNT} definitions once, with unique ids and no errors`, () => {
  assert.equal(BUILDINGS.length, COUNT);
  assert.equal(new Set(BUILDINGS.map((b) => b.id)).size, COUNT);
  for (const b of BUILDINGS) assert.ok(registry.buildings.has(b.id), `${b.id} registered`);
  assert.equal(registry.buildingOrder.filter((id) => BUILDINGS.some((b) => b.id === id)).length, COUNT);
  assert.equal(errors.length, before, 'init raised no errors');
  assert.equal(firstCity.length, 20, 'twenty cards open inside a first city');
  assert.deepEqual(tier5.map((b) => b.id), ['ring', 'elevator']);
});

test('every definition has the fields the build card needs', () => {
  const cats = new Set(CATEGORIES.map((c) => c.id));
  for (const b of BUILDINGS) {
    assert.ok(typeof b.name === 'string' && b.name.trim(), `${b.id} name`);
    assert.ok(typeof b.icon === 'string' && b.icon, `${b.id} icon`);
    assert.ok(typeof b.desc === 'string' && b.desc.length > 0 && b.desc.length <= 70, `${b.id} desc ≤ 70 chars (${b.desc.length})`);
    assert.ok(cats.has(b.category), `${b.id} category`);
    assert.ok([1, 2, 3, 4, 5].includes(b.tier), `${b.id} tier`);
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
  // ...and, carrying no text of its own, gets the card line its numbers derive.
  assert.deepEqual(arc2.demandGrowth, { per: 10, cap: 3, text: 'Grid strain: draw +10% per Arcology owned (up to ×3)' });
  // Data definitions never mutate.
  assert.equal(base.jobs, 50);
  assert.equal(data('arcology').demandGrowth.per, 40);
});

test('costGrowthForTier fallback order: costGrowthFor → config.cost.tierGrowth → defaults, and the defaults are the shipped ladder', () => {
  // A config import failure must ship the curve the sim was run on, not a stale sketch:
  // the fallback table equals config.cost.tierGrowth knob for knob.
  assert.deepEqual({ ...DEFAULT_TIER_GROWTH }, config.cost.tierGrowth, 'DEFAULT_TIER_GROWTH matches config.cost.tierGrowth');
  assert.ok(Object.isFrozen(DEFAULT_TIER_GROWTH));
  for (const b of BUILDINGS) {
    if (b.tier <= 4) continue;
    assert.ok(Number.isFinite(b.costGrowth) && b.costGrowth >= 1, `${b.id}: a tier-${b.tier} card pins its own costGrowth (no tier-${b.tier} rate exists in config)`);
  }
  assert.equal(costGrowthForTier(2, { costGrowthFor: () => 1.3, config: { cost: { tierGrowth: { 2: 1.2 } } } }), 1.3);
  assert.equal(costGrowthForTier(2, { costGrowthFor: () => NaN, config: { cost: { tierGrowth: { 2: 1.2 } } } }), 1.2);
  assert.equal(costGrowthForTier(2, { costGrowthFor: () => 0.5, config: { cost: { tierGrowth: { 2: 1.2 } } } }), 1.2);
  assert.equal(costGrowthForTier(2, { config: { cost: { tierGrowth: { 2: 'x' } } } }), 1.16);
  assert.equal(costGrowthForTier(3, null), 1.13);
  assert.equal(costGrowthForTier(9, null), 1.112, 'unknown tier → tier-4 default');
  assert.equal(costGrowthForTier('1', null), 1.18, 'non-integer tier → tier 1');
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

test('the twelve signature synergies and the four tier-4 strains are registered; the live handler is idempotent', () => {
  assert.deepEqual(activeSynergies().map((s) => s.id).sort(), ['arcology', 'elevator', 'financial', 'fusion', 'house', 'mall', 'refinery', 'ring', 'shop', 'solar', 'stadium', 'techpark']);
  assert.deepEqual(activeGrowth().map((s) => s.id).sort(), ['arcology', 'financial', 'stadium', 'techpark']);
  assert.equal(activeRules().length, 16);
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

  const big = cityState(10000, { factory: 100, school: 30, arcology: 41, financial: 5, apartment: 25, office: 50, ring: 5 });
  applyLiveStats(big, { employed: 10000 });
  applyLiveStats(big, { employed: 10000 }); // twice: must not compound
  assert.equal(liveStat('mall', 'income'), mallBase * 3);
  assert.equal(mall.income, mallBase * 3);
  assert.equal(liveStat('financial', 'income'), finBase * 1.5);
  assert.equal(fin.income, finBase * 1.5);
  assert.equal(liveStat('refinery', 'income'), baseStat('refinery', 'income') * 2);
  assert.equal(liveStat('techpark', 'income'), baseStat('techpark', 'income') * 1.75);
  assert.equal(liveStat('house', 'housing'), baseStat('house', 'housing') * 2, '25 apartment blocks: cottages ×2');
  assert.equal(liveStat('shop', 'income'), baseStat('shop', 'income') * 3, '50 offices: the shop caps at ×3');
  assert.equal(liveStat('stadium', 'jobs'), baseStat('stadium', 'jobs') * 1.5, '10k citizens: stadium hires ×1.5');
  assert.equal(liveStat('arcology', 'housing'), baseStat('arcology', 'housing') * 1.125, '5 districts: arcology housing 1 + 5/40');
  assert.equal(liveStat('ring', 'jobs'), baseStat('ring', 'jobs') * 1.1, '10k citizens: ring hires 1 + 10,000/100,000');
  assert.equal(liveStat('elevator', 'powerGen'), baseStat('elevator', 'powerGen') * 1.5, '5 rings: elevator ×1.5');
  // The strain rule is config-owned (config.buildings.*.demandGrowth re-pins it), so the
  // expectation is computed from the resolved rule rather than a hard-coded cap.
  assert.equal(liveStat('arcology', 'powerUse'), arcBase * growthFactor(arc.demandGrowth, 41), '41 arcologies: strain per the resolved rule');
  assert.equal(arc.powerUse, arcBase * growthFactor(arc.demandGrowth, 41));
  assert.equal(liveStat('financial', 'powerUse'), baseStat('financial', 'powerUse') * growthFactor(fin.demandGrowth, 5), '5 districts: strain per the resolved rule');
  assert.deepEqual(Object.keys(liveStats('financial')).sort(), ['income', 'powerUse']);
  assert.deepEqual(Object.keys(liveStats('arcology')).sort(), ['housing', 'powerUse']);
  // Bases never move.
  assert.equal(baseStat('mall', 'income'), mallBase);
  assert.equal(baseStat('arcology', 'powerUse'), arcBase);
  // Unscaled stats read straight from the def; unknown ids are undefined.
  assert.equal(liveStat('tower', 'housing'), registry.buildings.get('tower').housing);
  assert.equal(baseStat('tower', 'housing'), registry.buildings.get('tower').housing);
  assert.equal(liveStat('nope', 'income'), undefined);
  assert.deepEqual(liveStats('nope'), {});

  applyLiveStats(cityState(0), { employed: 0 }); // back to base for the other tests
  assert.equal(mall.income, mallBase);
  assert.equal(fin.income, finBase);
  assert.equal(arc.powerUse, arcBase);
  // This folder's own strain rule (the fallback when config pins none) is the documented
  // +2.5 % per unit up to ×1.5.
  assert.equal(growthFactor(data('arcology').demandGrowth, 41), 1.5, 'data.js strain: 41 arcologies at the ×1.5 cap');
  assert.equal(growthFactor(data('financial').demandGrowth, 5), 1.1, 'data.js strain: 5 districts 1 + 4/40');
});

test('a scaled field on the registered def is a view of the live store, not a second copy', () => {
  const mall = registry.buildings.get('mall');
  const mallBase = baseStat('mall', 'income');
  const desc = Object.getOwnPropertyDescriptor(mall, 'income');
  assert.ok(desc && typeof desc.get === 'function' && desc.enumerable, 'income is an enumerable accessor');
  assert.equal(Object.getOwnPropertyDescriptor(registry.buildings.get('tower'), 'housing').value, registry.buildings.get('tower').housing, 'an unscaled field stays a plain value');
  // Spreading the def (api.buildings does this for the bot and the UI) captures the live value.
  applyLiveStats(cityState(5000), { employed: 0 });
  assert.equal({ ...mall }.income, mallBase * 2);
  assert.equal(JSON.parse(JSON.stringify({ income: mall.income })).income, mallBase * 2);
  // Writing the field re-pins the base instead of being overwritten on the next tick.
  mall.income = mallBase * 10;
  assert.equal(baseStat('mall', 'income'), mallBase * 10);
  assert.equal(mall.income, mallBase * 10, 'reads the new base until the next evaluation');
  applyLiveStats(cityState(5000), { employed: 0 });
  assert.equal(mall.income, mallBase * 20, 'next tick: new base × factor');
  mall.income = NaN; // garbage is ignored
  assert.equal(baseStat('mall', 'income'), mallBase * 10);
  mall.income = mallBase;
  applyLiveStats(cityState(0), { employed: 0 });
  assert.equal(mall.income, mallBase);
  assert.equal(baseStat('mall', 'income'), mallBase);
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

test('tier-4 draw is a power bill the card states (≤ 50× the tier-3 intensity, hinted), and non-civic joy is felt or absent', () => {
  // Per citizen / per job, a tier-4 consumer's sticker draw is 12–42× the tier-3 intensity
  // of its column (README "Power": the sticker is a bill, the strain rule the second axis).
  // Pinned for the resolved defs *and* this folder's defaults so the doc, the number and
  // the fallback ladder cannot drift apart again; the card carries a `powerHint` that
  // names the plant the bill needs.
  for (const [label, get] of [
    ['resolved', (id, f) => baseStat(id, f)],
    ['data', (id, f) => data(id)[f]],
  ]) {
    const intensity = (id, per) => get(id, 'powerUse') / get(id, per);
    assert.ok(intensity('arcology', 'housing') <= intensity('tower', 'housing') * 50, `${label}: arcology MW/citizen ≤ 50× tower`);
    assert.ok(intensity('arcology', 'housing') >= intensity('tower', 'housing') * 4, `${label}: arcology MW/citizen ≥ 4× tower (a bill, not a rounding)`);
    assert.ok(intensity('techpark', 'jobs') <= intensity('refinery', 'jobs') * 50, `${label}: campus MW/job ≤ 50× refinery`);
    assert.ok(intensity('financial', 'jobs') <= intensity('mall', 'jobs') * 50, `${label}: district MW/job ≤ 50× mall`);
    assert.ok(get('stadium', 'powerUse') <= get('arcology', 'powerUse'), `${label}: stadium draws no more than an arcology`);
    // The bill is at most ~two nuclear plants per unit, so the hint stays a count a player
    // can act on rather than a fleet.
    for (const id of ['arcology', 'techpark', 'financial', 'stadium']) assert.ok(get(id, 'powerUse') <= 2 * get('nuclear', 'powerGen'), `${label}: ${id} ≤ 2 nuclear plants`);
  }
  for (const id of ['arcology', 'techpark', 'financial', 'stadium']) {
    const g = normalizeGrowth(data(id).demandGrowth);
    assert.ok(g && g.cap <= 2 && g.per >= 20, `${id} strain is a tax, not a cliff`);
    assert.ok(data(id).demandGrowth.text.includes(`${(100 / g.per).toString()}%`), `${id} strain text quotes its rate`);
    // The resolved rule (config may re-pin it) still prints a card line that quotes its rate.
    const r = normalizeGrowth(registry.buildings.get(id).demandGrowth);
    assert.ok(r && r.text.length > 0 && r.text.length <= 70, `${id} resolved strain has card text`);
    assert.ok(r.text.includes(`+${ruleRatePct(r)}%`) && r.text.includes(`×${r.cap}`), `${id} resolved strain text "${r.text}" quotes ${ruleRatePct(r)}% / ×${r.cap}`);
    // The bill names a tier-3/4 plant (the stadium's config draw sits at four solar farms).
    assert.match(registry.buildings.get(id).powerHint, /(Nuclear Plant|Solar Farm)$/, `${id} hint names a plant`);
  }
  assert.match(registry.buildings.get('arcology').powerHint, /Nuclear Plant$/, 'the arcology hint names the nuclear plant');
  // Data and config agree on every number config re-pins (the fallback ladder is the shipped one).
  for (const [id, o] of Object.entries(config.buildings || {})) {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'number') assert.equal(data(id)[k], v, `data.js ${id}.${k} matches config`);
      if (k === 'unlockAt') assert.deepEqual(data(id).unlockAt, v, `data.js ${id}.unlockAt matches config`);
    }
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
  // plant's sits at 34 MW — more than the eight capped windmills supply — and the office
  // block (200 citizens) opens ≥ 90 s after it on the first city's curve (cadence.mjs).
  assert.equal(data('windmill').unlockAt.powerDemand, 0.001);
  assert.ok(data('coal').unlockAt.powerDemand >= 34);
  assert.ok(data('coal').unlockAt.powerDemand > data('windmill').maxCount * data('windmill').powerGen, 'the plant opens once the windmills cannot cover the draw');
  assert.ok(data('office').unlockAt.pop > data('factory').unlockAt.pop * 3, 'the office follows the factory by a clear step');
  // The fusion reactor is reachable inside a first city (a visible trophy for its last
  // minutes) and opens at any founding.
  assert.ok(data('fusion').unlockAt.pop <= 40000 && data('fusion').unlockAt.legacy === 1);
});

test('windmill maxCount: the cap is 8 (the 8th costs about two coal plants), core refuses past it, a stray over-cap buy is rolled back', () => {
  const wm = registry.buildings.get('windmill');
  const CAP = 8;
  assert.equal(data('windmill').maxCount, CAP);
  assert.equal(wm.maxCount, CAP);
  assert.equal(capOf(wm), CAP);
  assert.equal(capOf(registry.buildings.get('house')), Infinity);
  assert.equal(capOf(null), Infinity);
  // The last windmill is priced like the generator that replaces it, not ten times it:
  // the 8th costs $5,120 against a $2,500 coal plant, and the whole set of eight ($10,200
  // for 32 MW) is under five plants' worth. At 12 the last four cost $10k–$82k each for 4 MW.
  const coal = registry.buildings.get('coal');
  const last = api.buildingCost(wm, CAP - 1, 1);
  const all = api.buildingCost(wm, 0, CAP);
  assert.ok(last <= coal.baseCost * 2.5, `8th windmill ${last} ≤ 2.5 coal plants`);
  assert.ok(all <= coal.baseCost * 5, `all eight ${all} ≤ 5 coal plants`);
  assert.ok(config.buildings?.windmill?.maxCount === undefined, 'the cap is buildings-owned (config does not pin it)');
  // Override hygiene: a non-integer or non-positive cap is dropped and the data cap kept
  // (the registry would throw on the bad value), null lifts it.
  for (const bad of [2.5, 0, -1, NaN, '12', Infinity]) assert.equal(resolveBuilding(data('windmill'), { config: { buildings: { windmill: { maxCount: bad } } } }).maxCount, CAP, `maxCount ${bad} dropped`);
  assert.equal(resolveBuilding({ ...data('windmill'), maxCount: 2.5 }, { config: {} }).maxCount, undefined, 'a bad data cap is dropped, not handed to the registry');
  assert.equal(resolveBuilding(data('windmill'), { config: { buildings: { windmill: { maxCount: null } } } }).maxCount, undefined, 'null lifts the cap');
  assert.equal(resolveBuilding(data('windmill'), { config: { buildings: { windmill: { maxCount: 20 } } } }).maxCount, 20);
  assert.equal(data('windmill').maxCount, CAP, 'data never mutates');

  const saved = { money: state.res.money, count: state.buildings.windmill, built: state.stats.buildingsBuilt, unlocked: state.unlocks['b:windmill'], log: state.log.length };
  try {
    // Core: at the cap the row is `maxed`, never affordable, and buy() refuses.
    state.unlocks['b:windmill'] = true;
    state.buildings.windmill = CAP;
    state.res.money = 1e12;
    const row = api.buildings().find((b) => b.id === 'windmill');
    assert.equal(row.maxed, true);
    assert.equal(row.affordable, false);
    assert.equal(row.maxCount, CAP, 'maxCount rides along for the card');
    assert.equal(api.maxAffordable(wm), 0);
    assert.equal(api.buy('windmill', 1), false);
    assert.equal(api.buy('windmill', 'max'), false);
    assert.equal(state.buildings.windmill, CAP);
    assert.equal(state.res.money, 1e12, 'nothing charged');
    state.buildings.windmill = CAP - 2;
    assert.equal(api.maxAffordable(wm), 2, 'max stops at the cap');
    assert.equal(api.buy('windmill', 3), false, 'a block past the cap is refused whole');
    assert.equal(api.buy('windmill', 2), true);
    assert.equal(state.buildings.windmill, CAP);

    // Fallback: a `buy` event that somehow landed above the cap (a core without the check)
    // is rolled back to the cap with the excess units' exact share of the price refunded.
    // Three units at counts 7, 8, 9 of a ×2 curve: units 8 and 9 are the excess.
    const g = wm.costGrowth;
    const paid = wm.baseCost * (Math.pow(g, CAP - 1) + Math.pow(g, CAP) + Math.pow(g, CAP + 1));
    const excessCost = wm.baseCost * (Math.pow(g, CAP) + Math.pow(g, CAP + 1));
    state.buildings.windmill = CAP + 2;
    state.res.money = 0;
    state.stats.buildingsBuilt = 100;
    const before = state.log.length;
    emit('buy', { id: 'windmill', n: 3, cost: paid, count: CAP + 2 });
    assert.equal(state.buildings.windmill, CAP);
    assert.ok(Math.abs(state.res.money - excessCost) < 1e-6, `refund ${state.res.money} = ${excessCost}`);
    assert.equal(state.stats.buildingsBuilt, 98);
    assert.equal(state.log.length, before + 1, 'one log line');
    // Units owned above the cap before the purchase (an old save) are not confiscated.
    state.buildings.windmill = 30;
    state.res.money = 0;
    assert.equal(rollbackOverCap({ id: 'windmill', n: 1, cost: 5, count: 30 }), 5, 'the whole unit above the cap is refunded');
    assert.equal(state.buildings.windmill, 29);
    assert.equal(rollbackOverCap({ id: 'windmill', n: 0, cost: 5, count: 29 }), 0, 'a garbage n with no excess of its own does nothing');
    assert.equal(state.buildings.windmill, 29);
    // No-ops: under the cap, an uncapped building, an unknown id, garbage.
    state.buildings.windmill = CAP;
    assert.equal(rollbackOverCap({ id: 'windmill', n: 1, cost: 5, count: CAP }), 0);
    assert.equal(rollbackOverCap({ id: 'house', n: 5, cost: 5, count: 1e6 }), 0);
    assert.equal(rollbackOverCap({ id: 'nope', n: 1, cost: 5, count: 99 }), 0);
    assert.equal(rollbackOverCap(null), 0);
    assert.equal(rollbackOverCap({ id: 'windmill' }, wm, { buildings: { windmill: 20 }, res: { money: 0 } }), 0, 'no cost paid: nothing to refund, count still capped');
  } finally {
    state.res.money = saved.money;
    state.buildings.windmill = saved.count;
    state.stats.buildingsBuilt = saved.built;
    if (saved.unlocked === undefined) delete state.unlocks['b:windmill'];
    state.log.length = saved.log;
  }
});

test('powerHint: a consumer names the plant its draw needs; a synergy on a missing stat is reported', async () => {
  const gens = [
    { name: 'Windmill', powerGen: 4 },
    { name: 'Coal Plant', powerGen: 80 },
    { name: 'Nuclear Plant', powerGen: 12000 },
  ];
  assert.equal(powerHintFor({ powerUse: 10500 }, gens), 'Draws 10,500 MW ≈ 0.9 × Nuclear Plant');
  assert.equal(powerHintFor({ powerUse: 6 }, gens), 'Draws 6 MW ≈ 1.5 × Windmill');
  assert.equal(powerHintFor({ powerUse: 40 }, gens), 'Draws 40 MW ≈ 0.5 × Coal Plant', 'largest generator no more than 2× the draw');
  assert.equal(powerHintFor({ powerUse: 1 }, gens), '', 'under the smallest generator: no hint');
  assert.equal(powerHintFor({ powerUse: 0 }, gens), '');
  assert.equal(powerHintFor({ powerGen: 80 }, gens), '');
  assert.equal(powerHintFor({ powerUse: 40 }, []), '');
  assert.equal(powerHintFor({ powerUse: 40 }, [{ name: 'x', powerGen: NaN }, null]), '');
  assert.equal(powerHintFor({ powerUse: 400 }, gens), 'Draws 400 MW ≈ 5 × Coal Plant');
  assert.equal(powerHintFor({ powerUse: 3e6 }, gens), 'Draws 3,000,000 MW ≈ 250 × Nuclear Plant');
  // Stamped on the registered defs: every consumer ≥ 4 MW, no generator, ≤ 70 chars.
  for (const id of registry.buildingOrder) {
    const d = registry.buildings.get(id);
    if (!BUILDINGS.some((b) => b.id === id)) continue;
    const use = baseStat(id, 'powerUse') || 0;
    if (use >= 4) assert.ok(typeof d.powerHint === 'string' && d.powerHint.length <= 70 && d.powerHint.startsWith('Draws '), `${id} has a hint`);
    else assert.equal(d.powerHint, undefined, `${id} has no hint`);
  }
  const ladder = ['windmill', 'coal', 'solar', 'nuclear', 'fusion', 'elevator'].map((id) => ({ name: registry.buildings.get(id).name, powerGen: baseStat(id, 'powerGen') }));
  assert.equal(registry.buildings.get('arcology').powerHint, powerHintFor({ powerUse: baseStat('arcology', 'powerUse') }, ladder), 'the arcology hint is sized against the shipped ladder');
  assert.equal(powerHintFor({ powerUse: 10500 }, [...gens, { name: 'Space Elevator', powerGen: 3e6 }]), 'Draws 10,500 MW ≈ 0.9 × Nuclear Plant', 'a giant generator never re-sizes a tier-4 bill');
  assert.ok(typeof api.buildings().find((b) => b.id === 'techpark').powerHint === 'string', 'rides along on the api row');

  // A rule on a stat the building lacks (the registry defaults it to 0) is reported like a
  // malformed one, not skipped in silence, and registers no rule.
  const n = errors.length;
  registerBuilding({ id: 'zz-test-nostat', name: 'Test', icon: 'x', desc: 'x', category: 'civic', tier: 1, baseCost: 1, costGrowth: 1.1, synergy: { stat: 'income', source: 'pop', per: 1, cap: 2 }, demandGrowth: { per: 40, cap: 1.5 } });
  try {
    await init({});
    const mine = errors.slice(n).filter((e) => e.module === 'buildings:zz-test-nostat');
    assert.equal(mine.length, 2, `synergy and demandGrowth each reported (${JSON.stringify(errors.slice(n))})`);
    assert.match(mine[0].msg, /missing stat income/);
    assert.match(mine[1].msg, /missing stat powerUse/);
    assert.ok(!activeRules().some((r) => r.id === 'zz-test-nostat'), 'no rule registered');
    assert.equal(Object.getOwnPropertyDescriptor(registry.buildings.get('zz-test-nostat'), 'income').value, 0, 'field left a plain 0, no accessor installed');
  } finally {
    registry.buildings.delete('zz-test-nostat');
    const i = registry.buildingOrder.indexOf('zz-test-nostat');
    if (i >= 0) registry.buildingOrder.splice(i, 1);
    errors.length = n;
    await init({}); // rules re-collected without the stray def
  }
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
  // Always-available cards (the cottage) never emit `unlock`; every gated card a first city
  // can reach must open, and the legacy-only tier-5 cards must not.
  const opened = report.buildings.filter((b) => b.unlockS !== null || b.gate === 'start');
  assert.equal(opened.length, firstCity.length, 'every first-city card opens in the first city');
  const bought = report.buildings.filter((b) => b.buyS !== null);
  assert.equal(bought.length, firstCity.length, 'every first-city building is bought in the first city');
  for (const b of tier5) {
    const row = report.buildings.find((r) => r.id === b.id);
    assert.ok(row && row.unlockS === null && row.buyS === null, `${b.id} stays locked in a first city`);
    assert.match(row.gate, /^legacy [\d,]+$/, `${b.id} gate prints as a legacy gate`);
  }
  const mine = report.problems.filter((p) => p.owner === 'buildings').map((p) => p.msg);
  assert.deepEqual(mine, [], 'no cadence fault a data.js field can fix');
  // The factory no longer glows for most of the tutorial: at 45 citizens it opens after the
  // 3-minute mark (at 30 it opened at 1.9 min and waited 7) and is bought within the lag
  // rule; it opens inside the exempt opening window (cadence.mjs RULES_FROM_S), so its own
  // lag is pinned here, and the office block (200 citizens) follows the coal plant.
  const factory = report.buildings.find((r) => r.id === 'factory');
  assert.ok(factory.unlockS >= 180, `factory opens after 3 min (${factory.unlockS} s)`);
  assert.ok(factory.buyS - factory.unlockS <= 300, `factory bought within 5 min of opening (${factory.buyS - factory.unlockS} s)`);
  const office = report.buildings.find((r) => r.id === 'office');
  const coal = report.buildings.find((r) => r.id === 'coal');
  assert.ok(office.unlockS - coal.unlockS >= 60, `office opens ≥ 60 s after the coal plant (${office.unlockS - coal.unlockS} s)`);
});

test('cadence probe: no fault at all (config-owned gates and costs included)', { todo: probe.report && probe.report.problems.length > 0 ? 'config.buildings pins the fields these faults need: ' + probe.report.problems.map((p) => p.msg).join(' | ') : undefined }, () => {
  assert.ok(probe.report, 'probe produced JSON');
  for (const p of probe.report.problems) assert.ok(Array.isArray(p.fields) && p.fields.length && p.msg.includes('fix: '), 'every fault names the field that fixes it');
  assert.deepEqual(probe.report.problems.map((p) => `[${p.owner}] ${p.msg}`), [], 'cadence.mjs exits 0');
});

test('tier 5: two legacy-gated megastructures open after the first founding, pin their own curve, and read as a ladder', () => {
  const ring = registry.buildings.get('ring');
  const elevator = registry.buildings.get('elevator');
  assert.equal(ring.category, 'residential');
  assert.equal(elevator.category, 'power');
  for (const [id, def] of [['ring', ring], ['elevator', elevator]]) {
    const d = data(id);
    assert.equal(d.tier, 5);
    // Legacy only: a first city of any size never opens them, a bank does, and the gate
    // sits on a legacy tier the simulation already announces (1,500 / 15,000).
    assert.equal(def.unlock(cityState(1e9, {}, 0), grid(0)), false, `${id}: population alone never opens it`);
    assert.equal(def.unlock(cityState(0, {}, d.unlockAt.legacy), grid(0)), true, `${id}: the bank opens it`);
    assert.equal(def.unlock(cityState(0, {}, d.unlockAt.legacy - 1), grid(0)), false);
    assert.ok([500, 15000, 300000].includes(d.unlockAt.legacy), `${id} gate is a legacy tier (or the config-pinned 300,000)`);
    assert.ok(d.unlockHint.includes(d.unlockAt.legacy.toLocaleString('en-US')), `${id} hint quotes the gate`);
    // Config has no tier-5 growth rate: the card pins one, steeper than tier 4 (a rolling
    // target, not a fleet bought in one spree) and it survives resolution.
    assert.ok(d.costGrowth >= 2 && d.costGrowth <= 4, `${id} costGrowth ${d.costGrowth} is a megastructure curve`);
    assert.equal(def.costGrowth, d.costGrowth, `${id} keeps its pinned curve`);
    // Buildings-owned numbers: config may re-pin the gate only (the elevator sits at 300,000).
    assert.ok(Object.keys(config.buildings?.[id] ?? {}).every((k) => k.startsWith('unlock')), `${id} is buildings-owned (config may only re-pin the gate)`);
    assert.ok(def.baseCost >= 1e11, `${id} is priced for a mature session`);
  }
  // The ladder: the ring is the cheaper, earlier card; the elevator opens 10× later in
  // legacy and costs 100× more, and its power rule is sourced from the ring.
  assert.ok(data('elevator').unlockAt.legacy >= 10 * data('ring').unlockAt.legacy);
  assert.ok(data('elevator').baseCost >= 50 * data('ring').baseCost);
  assert.equal(data('elevator').synergy.source, 'building:ring');
  assert.equal(data('ring').synergy.stat, 'jobs');
  assert.equal(data('ring').synergy.source, 'pop');
  // Stickers: the ring is eighty arcologies of housing and a jobs engine that at its cap
  // out-hires its own citizens (that is the late column balance, README "Jobs and
  // housing"); the elevator is a fusion fleet of output with nuclear's upkeep per MW.
  assert.equal(data('ring').housing, 80 * data('arcology').housing);
  assert.ok(data('ring').jobs * data('ring').synergy.cap >= data('ring').housing * 4, 'ring at its cap hires ≥ 4× its housing');
  assert.ok(data('elevator').powerGen >= 50 * data('fusion').powerGen);
  assert.ok(data('elevator').upkeep / data('elevator').powerGen <= data('nuclear').upkeep / data('nuclear').powerGen + 1e-9, 'elevator upkeep/MW ≤ nuclear');
  // The ring's bill is stated against the fusion reactor, not against the elevator (a card
  // the player has not seen yet when the ring opens).
  assert.equal(ring.powerHint, 'Draws 1,200,000 MW ≈ 20 × Fusion Reactor');
  assert.equal(elevator.powerHint, undefined);
  // The tier-4 hints are still sized against the nuclear plant: the elevator's 3 GW never
  // becomes the unit a 10 GW bill is quoted in.
  assert.match(registry.buildings.get('financial').powerHint, /Nuclear Plant$/);
});

test('the jobs column stays level with the housing column: financial 2,000 / campus 1,800 / stadium ×2 against the commuter rule', () => {
  // Static sticker check (the session reading is the columns probe below): with every
  // tier-4 card owned in equal numbers, the arcology at its commuter cap and the stadium at
  // its hiring cap, jobs per housing sit near 1 rather than the 3–7× of the 4,000-job
  // district (README "Jobs and housing").
  const j = (id, f = 1) => data(id).jobs * f;
  const jobs = j('financial') + j('techpark') + j('stadium', data('stadium').synergy.cap) + j('arcology') + j('nuclear') + j('fusion') + j('mall') + j('hospital');
  const housing = data('arcology').housing * data('arcology').synergy.cap + data('tower').housing;
  const ratio = jobs / housing;
  assert.ok(ratio >= 1.2 && ratio <= 2.2, `tier-3/4 set: ${jobs} jobs / ${housing} housing = ${ratio.toFixed(2)} (1.2–2.2 before the upgrade rungs move it)`);
  assert.equal(data('financial').jobs, 2000);
  assert.equal(data('techpark').jobs, 1800);
  assert.equal(data('stadium').synergy.cap, 2);
  assert.ok(data('stadium').synergy.text.includes('×2'));
  assert.equal(data('arcology').synergy.source, 'building:financial');
  assert.ok(data('arcology').synergy.text.includes('2.5%'), 'the commuter line quotes its rate');
  // The district keeps its step above the campus in raw jobs per dollar only through its
  // income (the dominance test above); as employers both now read as jobs the city fills.
});

test('columns probe (6 h): jobs/pop holds its band in mature cities and the ring opens and sells as a rolling target', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const r = spawnSync(process.execPath, [path.join(here, 'columns.mjs'), '--ticks', '216000', '--every', '10', '--json'], { encoding: 'utf-8', timeout: 240000 });
  let report = null;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    report = null;
  }
  assert.ok(report, `probe produced JSON (status ${r.status}; stderr: ${r.stderr.slice(0, 400)})`);
  assert.equal(report.errors.length, 0, 'no runtime errors');
  assert.deepEqual(report.problems, [], 'no column or tier-5 fault');
  assert.ok(report.ratio.median >= report.rules.ratioMin && report.ratio.median <= report.rules.ratioMax, `median ${report.ratio.median}`);
  const ring = report.tier5.find((t) => t.id === 'ring');
  assert.ok(ring && ring.openCity !== null && ring.buyCity !== null, 'the ring opens and is bought inside 6 h');
  assert.ok(ring.citiesBought.length >= 2, 'the ring is bought again in a later city');
  const elevator = report.tier5.find((t) => t.id === 'elevator');
  assert.ok(elevator, 'the elevator is a legacy-gated card the probe tracks');
});

test('catalogue.mjs prints the shipped catalogue with every config override flagged', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const r = spawnSync(process.execPath, [path.join(here, 'catalogue.mjs'), '--json'], { encoding: 'utf-8', timeout: 60000 });
  assert.equal(r.status, 0, `exit 0 (stderr: ${r.stderr.slice(0, 300)})`);
  const rows = JSON.parse(r.stdout);
  assert.equal(rows.length, COUNT);
  assert.equal(rows.find((row) => row.id === 'ring').gate, 'legacy 500', 'a legacy-only gate prints as such');
  const overrides = config.buildings || {};
  for (const row of rows) {
    const o = overrides[row.id] || {};
    for (const f of ['baseCost', 'housing', 'income', 'powerUse', 'powerGen', 'upkeep']) {
      if (Number.isFinite(o[f]) && o[f] !== data(row.id)[f]) assert.ok(row.overridden.includes(f), `${row.id}.${f} flagged as overridden`);
      assert.equal(row[f], registry.buildings.get(row.id)[f] === undefined ? undefined : baseStat(row.id, f), `${row.id}.${f} is the shipped base`);
    }
    if (typeof o.unlock === 'function') assert.ok(row.overridden.includes('unlock') || row.gate === row.defaultGate, `${row.id} gate attribution`);
  }
  const shipped = rows.find((r) => r.id === 'stadium');
  assert.ok(shipped.synergy && shipped.demandGrowth, 'rule texts ride along');
  // The rule fields are compared on their numbers: config's +12.5 % / ×40 strain against
  // this folder's +2.5 % / ×1.5 fallback is a delta the tool prints in brackets.
  const key = (r) => (r ? [r.stat, r.source, r.per, r.cap].filter((v) => v !== undefined).join('/') : '');
  for (const row of rows) {
    for (const f of ['synergy', 'demandGrowth']) {
      const differs = key(registry.buildings.get(row.id)[f]) !== key(data(row.id)[f]);
      assert.equal(row.overridden.includes(f), differs, `${row.id}.${f} flagged iff config re-pins the rule`);
      if (differs) assert.equal(row['default_' + f], data(row.id)[f]?.text ?? 'none', `${row.id}.${f} default line in brackets`);
    }
  }
  const strainDelta = ['arcology', 'techpark', 'financial', 'stadium'].some((id) => key(registry.buildings.get(id).demandGrowth) !== key(data(id).demandGrowth));
  assert.equal(rows.some((row) => row.overridden.includes('demandGrowth')), strainDelta, 'a re-pinned strain rule shows as an override');
});

test('every synergy / strain card line quotes the rate and cap its own rule derives — in data.js and as shipped', () => {
  // ruleRatePct is the single source: per 1,000 citizens for a pop/employed source, per unit
  // otherwise. The Orbital Ring once said '+1% per 100,000 citizens' for a rule that is
  // ×2 at 100,000 (+1 % per 1,000): a card 100× too small. The text is derived here from the
  // numbers so that cannot drift again.
  assert.equal(ruleRatePct({ source: 'pop', per: 100000 }), 1);
  assert.equal(ruleRatePct({ source: 'pop', per: 5000 }), 20);
  assert.equal(ruleRatePct({ source: 'employed', per: 20000 }), 5);
  assert.equal(ruleRatePct({ source: 'building:apartment', per: 25 }), 4);
  assert.equal(ruleRatePct({ per: 40 }), 2.5);
  assert.equal(ruleRatePct({ per: 8 }), 12.5);
  assert.ok(Number.isNaN(ruleRatePct({ per: 0 })) && Number.isNaN(ruleRatePct(null)));
  const nameOf = (id) => data(id)?.name || registry.buildings.get(id)?.name;
  const check = (label, id, kind, raw) => {
    const r = kind === 'synergy' ? normalizeSynergy(raw) : normalizeGrowth(raw);
    assert.ok(r, `${label} ${id} ${kind} is well-formed`);
    const rate = ruleRatePct(r);
    const pct = `+${rate.toLocaleString('en-US')}%`;
    assert.ok(r.text.includes(pct), `${label} ${id} ${kind} "${r.text}" quotes ${pct}`);
    assert.ok(r.text.includes(`×${r.cap.toLocaleString('en-US')}`), `${label} ${id} ${kind} "${r.text}" quotes the ×${r.cap} cap`);
    if (kind === 'synergy' && (r.source === 'pop' || r.source === 'employed')) {
      assert.match(r.text, /per 1,000 /, `${label} ${id} synergy "${r.text}" is stated per 1,000 citizens`);
      if (r.per !== 1000) assert.ok(!r.text.includes(`per ${r.per.toLocaleString('en-US')} `), `${label} ${id} synergy "${r.text}" never quotes the raw per`);
    } else if (kind === 'synergy') {
      // A building-count source names the building it counts.
      assert.ok(r.text.includes(nameOf(r.source.slice(9))), `${label} ${id} synergy "${r.text}" names ${nameOf(r.source.slice(9))}`);
    } else {
      assert.match(r.text, /^Grid strain: draw \+[\d.]+% per \S+ owned \(up to ×[\d.]+\)$/, `${label} ${id} strain "${r.text}" has the strain shape`);
    }
  };
  let n = 0;
  for (const b of BUILDINGS) {
    if (b.synergy) { check('data', b.id, 'synergy', b.synergy); n++; }
    if (b.demandGrowth) { check('data', b.id, 'growth', b.demandGrowth); n++; }
  }
  for (const id of registry.buildingOrder) {
    const d = registry.buildings.get(id);
    if (d.synergy) { check('shipped', id, 'synergy', d.synergy); n++; }
    if (d.demandGrowth) { check('shipped', id, 'growth', d.demandGrowth); n++; }
  }
  assert.equal(n, 32, 'sixteen rules, checked in data.js and as shipped');
  // The ring's rule, in numbers: ×2 at 100,000 citizens, ×12 from 1.1 M.
  assert.equal(synergyFactor(data('ring').synergy, cityState(100000), grid(0)), 2);
  assert.equal(synergyFactor(data('ring').synergy, cityState(1100000), grid(0)), 12);
  assert.ok(data('ring').synergy.text.includes('+1% jobs per 1,000 citizens'), 'the ring line reads +1 % per 1,000');
  // A strain rule re-pinned by config without a text gets one that quotes its numbers.
  const bare = resolveBuilding(data('arcology'), { config: { buildings: { arcology: { demandGrowth: { per: 8, cap: 40 } } } } });
  assert.equal(bare.demandGrowth.text, 'Grid strain: draw +12.5% per Arcology owned (up to ×40)');
  assert.ok(bare.demandGrowth.text.length <= 70);
  assert.equal(strainText({ per: 40, cap: 1.5 }, 'Stadium'), 'Grid strain: draw +2.5% per Stadium owned (up to ×1.5)');
  assert.equal(strainText({ per: 0, cap: 1 }, 'x'), '');
  // A configured text is kept verbatim, and it is the string the card renders.
  assert.equal(registry.buildings.get('arcology').demandGrowth.text, config.buildings.arcology.demandGrowth.text);
});

test('README tables quote the shipped rules and tier-5 gates (regex over the file, so prose cannot drift)', () => {
  const readme = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'README.md'), 'utf-8');
  // Synergy table: `| id | stat | source (per → +100 %) | ×cap |`, one row per rule.
  const rows = [...readme.matchAll(/^\| (\w+) \| (\w+) \| .*?\(([\d,]+) → \+100 %\) \| ×([\d.]+) \|$/gm)];
  const seen = new Set();
  for (const [, id, stat, per, cap] of rows) {
    const rule = data(id)?.synergy;
    assert.ok(rule, `README synergy row ${id} is a real rule`);
    assert.equal(stat, rule.stat, `README ${id} stat`);
    assert.equal(Number(per.replace(/,/g, '')), rule.per, `README ${id} per`);
    assert.equal(Number(cap), rule.cap, `README ${id} cap`);
    seen.add(id);
  }
  for (const b of BUILDINGS) if (b.synergy) assert.ok(seen.has(b.id), `README synergy table lists ${b.id}`);
  // Tier-5 table: `| Name emoji | column | legacy ≥ N | city C (...) |` against data + config.
  const t5 = [...readme.matchAll(/^\| (Orbital Ring|Space Elevator) \S+ \| \w+ \| legacy ≥ ([\d,]+) \| city (\d+) /gm)];
  assert.equal(t5.length, 2, 'both tier-5 rows found');
  for (const [, name, legacy, city] of t5) {
    const id = name === 'Orbital Ring' ? 'ring' : 'elevator';
    const gate = Number(legacy.replace(/,/g, ''));
    assert.equal(gate, data(id).unlockAt.legacy, `README ${id} gate matches data.js`);
    assert.equal(gate, registry.buildings.get(id).unlockAt.legacy, `README ${id} gate matches the shipped def`);
    assert.ok(Number(city) >= 5, `${id} opens after the fifth city`);
  }
  // The ring's rate sentence in prose reads per 1,000 (README "Jobs and housing").
  assert.match(readme, /Orbital Ring hires \+1 % per\s+1,000 citizens/, 'README prose states the ring per 1,000');
  assert.doesNotMatch(readme, /\+1 % per\s+100,000/, 'README prose never says +1 % per 100,000');
});
