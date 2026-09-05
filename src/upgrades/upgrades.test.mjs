// Unit tests for the upgrades module. Run: node src/upgrades/upgrades.test.mjs
// Pins the data invariants (unique ids, desc length, hints everywhere, effects touch only the
// mods bag), the charter perks (legacy currency, ×2.5–4 cost spacing, legacy ≥ cost/2 gate),
// the frontier ladder (fixed dollars ×10 apart, earned ≥ cost/4 gate that follows a config
// override), the absence of any wall-clock rule, the config override rules, the founding-
// memory rule (charter perks and keeper rungs survive a founding), the grantUpgrade seam and
// the registered-cost view (sortedUpgrades).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMods, sanitizeMods } from '../core/mods.js';
import { registry } from '../core/registry.js';
import { on, emit } from '../core/events.js';
import { config } from '../balance/config.js';
import {
  UPGRADES,
  UPGRADE_CATEGORIES,
  MILESTONE_IDS,
  FRONTIER_GATE,
  CHARTER_GATE,
  CHARTER_MIN_COST,
  CHARTER_MAX_COST,
  frontierUnlock,
  keptUpgradeIds,
  isPermanent,
  fmtMoney,
} from './data.js';
import { applyOverride, sortedUpgrades, init } from './index.js';

const CATEGORY_IDS = new Set(UPGRADE_CATEGORIES.map((c) => c.id));
const byId = (id) => UPGRADES.find((d) => d.id === id);
const PERKS = UPGRADES.filter((d) => d.category === 'charter');
const FRONTIER = UPGRADES.filter((d) => d.earnedGate);
const FRONTIER_IDS = ['dyson-swarm', 'quantum-exchange', 'mass-driver-port', 'ringworld-district', 'stellar-engine', 'galactic-charter'];

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
  upgrades: { 'welcome-sign': true, 'charter-mint': true, 'planetary-charter': true },
  unlocks: { 'm:pop-1k': true },
  stats: { totalEarned: 2e9, peakPop: 5000, buildingsBuilt: 80, prestiges: 3, playtime: 1000, clicks: 3 },
  prestige: { legacy: 12, spent: 8, lifetimeEarned: 1e10 },
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
    if (d.currency !== undefined) assert.ok(d.currency === 'money' || d.currency === 'legacy', `${d.id}: currency ${d.currency}`);
  }
  assert.ok(UPGRADES.length >= 66, `ladder has ${UPGRADES.length} rungs`);
  assert.equal(MILESTONE_IDS.length, new Set(MILESTONE_IDS).size);
  // Card variety: the thirty identical Civic Bonds are gone for good. The repeats below
  // are money rungs whose ids and effects predate this pass (the "+25% income" trio, the
  // two "+50% growth" rungs, the three "−20% cost" rungs, Digital City Hall and the Legacy
  // Archive); nothing else — no perk, no frontier rung — reads the same as another card.
  const ALLOWED_REPEATS = { 'All income +25%': 3, 'Population grows +50% faster': 2, 'All buildings cost −20%': 3, 'All income +50%': 2 };
  const cards = new Map();
  for (const d of UPGRADES) cards.set(d.desc, (cards.get(d.desc) || 0) + 1);
  for (const [desc, n] of cards) assert.ok(n <= (ALLOWED_REPEATS[desc] || 1), `${n} cards read "${desc}"`);
  for (const [desc, n] of Object.entries(ALLOWED_REPEATS)) assert.equal(cards.get(desc), n, desc);
  // Every existing early/mid/late id is still here (ids are save keys).
  for (const id of [
    'welcome-sign', 'zoning-reform', 'neon-signage', 'grant-writing', 'tax-software', 'turbine-blades', 'smart-grid', 'community-events',
    'assembly-lines', 'franchising', 'green-belts', 'farmers-market', 'high-density', 'express-transit', 'coal-scrubbers', 'night-shift',
    'bulk-permits', 'container-port', 'tourism-board', 'open-plan-offices', 'regional-airport', 'modern-curriculum', 'maintenance-contracts',
    'welcome-center', 'solar-tracking', 'catalytic-crackers', 'anchor-tenants', 'prefab-construction', 'skyway-frames', 'digital-city-hall',
    'preventive-care', 'robotic-assembly', 'breeder-reactors', 'megastructures', 'algorithmic-trading', 'orbital-solar', 'championship-season',
    'superconductor-grid', 'arcology-gardens', 'ai-governance', 'planetary-charter', 'legacy-archive', 'founders-blueprints', 'veteran-planners',
    'dynasty-ledger', 'institutional-memory', 'standing-orders',
  ]) assert.ok(byId(id), `missing legacy id ${id}`);
});

test('hints read as the rule they mirror', () => {
  assert.equal(byId('neon-signage').unlockHint, 'Build 3 corner shops');
  assert.deepEqual(byId('neon-signage').unlockAt, { building: 'shop', count: 3 });
  assert.equal(byId('farmers-market').unlockHint, 'Build 15 corner shops');
  assert.equal(byId('container-port').unlockHint, 'Build 20 factories');
  assert.equal(byId('community-events').unlockHint, 'Build a City Park');
  assert.equal(byId('franchising').unlockHint, 'Reach 100 citizens or build an Office Block');
  assert.equal(byId('grid-substations').unlockHint, 'Draw 20 MW of power');
  assert.deepEqual(byId('tourism-board').unlockAt, { pop: 2000 });
  assert.equal(byId('legacy-archive').unlockHint, 'Found a new city');
  assert.deepEqual(byId('institutional-memory').unlockAt, { legacy: 10 });
  assert.match(byId('smart-grid').unlockHint, /brownout/i);
  assert.deepEqual(byId('standing-orders').unlockAt, { legacy: 50 });
  // Frontier rungs quote the earnings gate in the hint and mirror it for the bar.
  assert.equal(byId('dyson-swarm').unlockHint, 'Earn $2.5T in this city');
  assert.deepEqual(byId('dyson-swarm').unlockAt, { earned: 2.5e12 });
  assert.equal(byId('mass-driver-port').unlockHint, 'Earn $250T in this city');
  assert.equal(byId('ringworld-district').unlockHint, 'Earn $2.5Qa in this city');
  assert.equal(byId('galactic-charter').unlockHint, 'Earn $250Qa in this city');
  assert.equal(fmtMoney(1e18), '$1Qi');
  // Charter perks quote the bank they wait for.
  assert.equal(byId('charter-homestead').unlockHint, 'Bank 2 legacy points');
  assert.equal(byId('charter-mint').unlockHint, 'Bank 4 legacy points');
  assert.equal(byId('charter-imperial').unlockHint, 'Bank 100,000 legacy points');
  assert.deepEqual(byId('charter-imperial').unlockAt, { legacy: 100000 });
});

test('happiness: flat city-wide adds only, descs quote the exact add in percent', () => {
  assert.equal(byId('community-events').desc, 'Happiness +10% and population grows +25% faster');
  assert.equal(byId('green-belts').desc, 'Happiness +5% and population grows +25% faster');
  assert.equal(byId('modern-curriculum').desc, 'Happiness +10% and all jobs +25%');
  assert.equal(byId('preventive-care').desc, 'Happiness +10% and population grows +50% faster');
  assert.equal(byId('championship-season').desc, 'Stadiums earn ×2 income and provide ×2 jobs');
  assert.equal(byId('veteran-planners').desc, 'Population grows +100% faster and happiness +10%');
  assert.equal(byId('charter-civic').desc, 'Happiness +10% and all jobs +50%');
  let flatTotal = 0;
  for (const d of UPGRADES) {
    assert.ok(!/\+0\.\d+/.test(d.desc), `${d.id}: raw decimal in desc "${d.desc}"`);
    assert.ok(!/happiness each/i.test(d.desc), `${d.id}: per-building happiness promise "${d.desc}"`);
    const mods = createMods();
    d.effect(mods, FROZEN_STATE);
    // Per-building happiness feeds the saturating civic curve, where the desc's number is
    // never what the city gets: no rung may use it.
    for (const [id, m] of Object.entries(mods.byBuilding)) assert.equal(m.happiness, 0, `${d.id}: byBuilding.${id}.happiness`);
    const said = /happiness \+(\d+)%/i.exec(d.desc);
    if (said) assert.ok(Math.abs(mods.happiness - Number(said[1]) / 100) < 1e-9, `${d.id}: desc says +${said[1]}%, effect adds ${mods.happiness}`);
    else assert.equal(mods.happiness, 0, `${d.id}: silent happiness add`);
    flatTotal += mods.happiness;
  }
  // The whole ladder's flat adds stay small against the 3.0 cap (0.45 for the money rungs
  // plus 0.1 for the Civic Charter), so civic buildings — not upgrades — decide happiness.
  assert.ok(Math.abs(flatTotal - 0.55) < 1e-9, `ladder adds ${flatTotal} happiness in total`);
});

test('every effect leaves a deep-frozen state untouched, only writes the mods bag, and folds without NaN', () => {
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
  // Everything owned at once — the 12-hour end state — still folds to finite, positive
  // multipliers before and after sanitizing (sanitize must have nothing to fix).
  const all = createMods();
  all.demand = 1;
  for (const d of UPGRADES) d.effect(all, { ...FROZEN_STATE, prestige: { legacy: 1e6, spent: 0 } });
  const snapshot = JSON.stringify(all);
  sanitizeMods(all);
  assert.equal(JSON.stringify(all), snapshot, 'sanitizeMods changed a fully-owned bag');
  for (const k of ['income', 'housing', 'jobs', 'power', 'demand', 'growth', 'inflow', 'cost', 'upkeep']) {
    assert.ok(Number.isFinite(all[k]) && all[k] > 0, `all owned: mods.${k} = ${all[k]}`);
  }
  assert.ok(all.cost < 1 && all.cost > 0.05, `all owned: cost ${all.cost}`);
  assert.ok(all.demand < 1 && all.demand > 0.05, `all owned: demand ${all.demand}`);
  for (const [id, m] of Object.entries(all.byBuilding)) {
    for (const k of ['income', 'housing', 'jobs', 'power', 'cost']) assert.ok(Number.isFinite(m[k]) && m[k] > 0, `all owned: ${id}.${k}`);
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
  // A few rules against the frozen city: 20 shops, 25 factories, legacy 12, $2B earned.
  assert.equal(byId('farmers-market').unlock(FROZEN_STATE), true);
  assert.equal(byId('container-port').unlock(FROZEN_STATE), true);
  assert.equal(byId('institutional-memory').unlock(FROZEN_STATE), true);
  assert.equal(byId('standing-orders').unlock(FROZEN_STATE), false);
  assert.equal(byId('smart-grid').unlock(FROZEN_STATE, FROZEN_DERIVED), true);
  assert.equal(byId('grid-substations').unlock(FROZEN_STATE, FROZEN_DERIVED), true);
  assert.equal(byId('grid-substations').unlock(FROZEN_STATE, { powerDemand: 5 }), false);
  assert.equal(byId('ai-governance').unlock(FROZEN_STATE), true);
  assert.equal(byId('dyson-swarm').unlock(FROZEN_STATE), false, '$2B earned is short of the $2.5T gate');
});

test('nothing gates on the clock: unlocks ignore state.time / tick, and the source has no wall-clock rule', () => {
  const base = { ...FROZEN_STATE };
  for (const d of UPGRADES) {
    for (const s of [base, { res: {}, buildings: {}, upgrades: {}, stats: {}, prestige: {}, unlocks: {} }]) {
      const early = d.unlock({ ...s, time: 0, tick: 0 }, FROZEN_DERIVED);
      const late = d.unlock({ ...s, time: 1e9, tick: 1e10 }, FROZEN_DERIVED);
      assert.equal(early, late, `${d.id}: unlock changes with the clock`);
    }
    assert.ok(!d.priced, `${d.id}: income-priced rung`);
    assert.ok(!d.unlockAt || !('runAge' in d.unlockAt), `${d.id}: runAge mirror`);
    assert.ok(!/after founding|wait until|opens \d/i.test(d.unlockHint), `${d.id}: time hint "${d.unlockHint}"`);
    assert.ok(!/after founding|s of income/i.test(d.desc), `${d.id}: time/price jargon in desc "${d.desc}"`);
  }
  const src = fs.readFileSync(fileURLToPath(new URL('./data.js', import.meta.url)), 'utf8') + fs.readFileSync(fileURLToPath(new URL('./index.js', import.meta.url)), 'utf8');
  for (const needle of ['runAge', 'state.time', 'bondOpensAt', 'horizonCost', 'civic-bonds', 'skyline-expansion', 'priced:', 'Date.now', 'performance.now']) {
    assert.ok(!src.includes(needle), `source still carries "${needle}"`);
  }
});

test('charter perks: ≥12, legacy currency, ×2.5–4 apart from 3 to ~2e5, open at half their price, tiered by cost', () => {
  assert.ok(PERKS.length >= 12, `${PERKS.length} perks`);
  const costs = PERKS.map((d) => d.cost);
  assert.equal(costs[0], CHARTER_MIN_COST);
  assert.equal(costs[costs.length - 1], CHARTER_MAX_COST);
  assert.equal(CHARTER_MIN_COST, 3);
  assert.equal(CHARTER_MAX_COST, 2e5);
  for (let i = 1; i < costs.length; i++) {
    const r = costs[i] / costs[i - 1];
    assert.ok(r >= 2.5 - 1e-9 && r <= 4 + 1e-9, `${PERKS[i].id}: ×${r.toFixed(2)} after ${PERKS[i - 1].id}`);
  }
  const perkIds = new Set(PERKS.map((d) => d.id));
  for (const d of UPGRADES) assert.equal(d.currency === 'legacy', perkIds.has(d.id), `${d.id}: currency vs category`);
  for (const d of PERKS) {
    assert.equal(d.currency, 'legacy', `${d.id}: currency`);
    assert.equal(d.category, 'charter');
    assert.ok(Number.isInteger(d.cost), `${d.id}: whole points`);
    assert.ok(isPermanent(d));
    // legacy ≥ cost/2 opens it, whatever has been spent; one point short keeps it shut.
    const gate = d.cost * CHARTER_GATE;
    assert.equal(CHARTER_GATE, 0.5);
    assert.equal(d.unlock({ prestige: { legacy: gate, spent: gate } }), true, `${d.id}: opens at ${gate}`);
    assert.equal(d.unlock({ prestige: { legacy: Math.ceil(gate), spent: 0 } }), true);
    assert.equal(d.unlock({ prestige: { legacy: Math.ceil(gate) - 1, spent: 0 } }), false, `${d.id}: shut below ${gate}`);
    assert.equal(d.unlock({ prestige: { legacy: 0 }, unlocks: { 'm:prestige-1': true } }), d.cost <= 2, `${d.id}: milestone shortcut only for a 1-point gate`);
    assert.deepEqual(d.unlockAt, { legacy: gate });
    // Tier follows the price.
    const want = d.cost <= 25 ? 1 : d.cost <= 600 ? 2 : d.cost <= 12000 ? 3 : 4;
    assert.equal(d.tier, want, `${d.id}: tier ${d.tier} at ◆ ${d.cost}`);
  }
  // Tiers 1–4 are all represented and never go backwards up the ladder.
  assert.deepEqual([...new Set(PERKS.map((d) => d.tier))], [1, 2, 3, 4]);
  // The ids and prices the design contract names.
  assert.deepEqual(
    PERKS.map((d) => [d.id, d.cost]),
    [
      ['charter-homestead', 3], ['charter-mint', 8], ['charter-grid', 25], ['charter-guild', 70], ['charter-merchant', 200],
      ['charter-settlers', 600], ['charter-masons', 1600], ['charter-civic', 4500], ['charter-treasury', 12000],
      ['charter-skyline', 30000], ['charter-energy', 80000], ['charter-imperial', 200000],
    ]
  );
});

test('charter perks are strong and varied: each moves a multiplier by ≥50% (cost −15%), several levers, exact pins', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const levers = new Set();
  for (const d of PERKS) {
    const mods = createMods();
    d.effect(mods, FROZEN_STATE);
    let best = 0;
    for (const k of ['income', 'housing', 'jobs', 'power', 'growth', 'inflow']) if (mods[k] > 1) { best = Math.max(best, mods[k] - 1); levers.add(k); }
    for (const m of Object.values(mods.byBuilding)) for (const k of ['income', 'housing', 'jobs', 'power']) if (m[k] > 1) { best = Math.max(best, m[k] - 1); levers.add('by:' + k); }
    for (const k of ['cost', 'demand', 'upkeep']) if (mods[k] < 1) levers.add(k);
    const down = Math.max(1 - mods.cost, 1 - mods.demand, 1 - mods.upkeep);
    assert.ok(best >= 0.5 - 1e-9 || down >= 0.15 - 1e-9, `${d.id}: strongest +${(best * 100).toFixed(0)}% / −${(down * 100).toFixed(0)}% — too weak for a perk`);
  }
  for (const k of ['income', 'housing', 'power', 'growth', 'jobs', 'cost', 'demand', 'upkeep', 'by:income']) assert.ok(levers.has(k), `no perk pulls ${k}`);
  const m1 = createMods();
  byId('charter-mint').effect(m1, {});
  assert.ok(near(m1.income, 1.5) && near(m1.upkeep, 0.75));
  const m8 = createMods();
  byId('charter-treasury').effect(m8, {});
  assert.ok(near(m8.income, 2) && near(m8.upkeep, 0.5));
  const m2 = createMods();
  byId('charter-masons').effect(m2, {});
  assert.ok(near(m2.cost, 0.85));
  const m3 = createMods();
  byId('charter-guild').effect(m3, {});
  assert.ok(near(m3.byBuilding.factory.income, 2) && near(m3.byBuilding.refinery.income, 2) && near(m3.byBuilding.techpark.income, 2));
  const m4 = createMods();
  byId('charter-merchant').effect(m4, {});
  for (const id of ['shop', 'office', 'mall', 'financial']) assert.ok(near(m4.byBuilding[id].income, 2), `merchant: ${id}`);
  const m5 = createMods();
  byId('charter-energy').effect(m5, {});
  assert.ok(near(m5.power, 3) && near(m5.demand, 0.75));
  const m6 = createMods();
  byId('charter-imperial').effect(m6, {});
  assert.ok(near(m6.income, 3) && near(m6.cost, 0.85));
  const m7 = createMods();
  byId('charter-settlers').effect(m7, {});
  assert.ok(near(m7.growth, 2) && near(m7.inflow, 3));
});

test('frontier ladder: six named rungs ×10 apart from $1e13 to $1e18, opening at a quarter of the price earned this run', () => {
  assert.deepEqual(FRONTIER.map((d) => d.id), FRONTIER_IDS);
  assert.deepEqual(FRONTIER.map((d) => d.cost), [1e13, 1e14, 1e15, 1e16, 1e17, 1e18]);
  assert.equal(FRONTIER_GATE, 0.25);
  const descs = new Set();
  for (const d of FRONTIER) {
    assert.equal(d.tier, 4);
    assert.ok(d.currency === undefined || d.currency === 'money', `${d.id}: money-priced`);
    assert.equal(d.earnedGate, FRONTIER_GATE);
    const gate = d.cost / 4;
    assert.equal(d.unlock({ stats: { totalEarned: gate } }), true, `${d.id}: opens at ${gate}`);
    assert.equal(d.unlock({ stats: { totalEarned: gate * 0.999 } }), false, `${d.id}: shut below ${gate}`);
    assert.equal(d.unlock({ stats: { totalEarned: 0 }, prestige: { legacy: 1e6 }, unlocks: { 'm:money-1b': true } }), false, `${d.id}: only earnings open it`);
    assert.deepEqual(d.unlockAt, { earned: gate });
    assert.ok(!descs.has(d.desc), `${d.id}: repeats a frontier desc`);
    descs.add(d.desc);
  }
  // Every rung is a different lever, and the ladder as a whole pulls income, housing,
  // power, growth, cost and demand.
  const fold = createMods();
  for (const d of FRONTIER) d.effect(fold, FROZEN_STATE);
  assert.ok(fold.income >= 6 && fold.housing >= 2.5 && fold.power >= 4 && fold.growth >= 3, 'frontier multipliers');
  assert.ok(fold.cost < 0.7 && fold.demand < 0.7, 'frontier discounts');
  assert.ok(fold.jobs >= 1.5 && fold.byBuilding.financial.income >= 2 && fold.byBuilding.techpark.income >= 2, 'frontier per-building');
  // frontierUnlock follows the price it is given (config overrides move the gate).
  const moved = frontierUnlock({ ...byId('dyson-swarm'), cost: 4e13 });
  assert.equal(moved.unlock({ stats: { totalEarned: 1e13 } }), true);
  assert.equal(moved.unlock({ stats: { totalEarned: 9e12 } }), false);
  assert.equal(moved.unlockHint, 'Earn $10T in this city');
  assert.deepEqual(moved.unlockAt, { earned: 1e13 });
  assert.deepEqual(frontierUnlock({ cost: 0 }).unlockAt, { earned: 0 });
  assert.equal(frontierUnlock(undefined).unlock({ stats: { totalEarned: 0 } }), true, 'garbage def: a zero gate, never a throw');
  // The core ladder tops out right under the frontier.
  const core = UPGRADES.filter((d) => !d.earnedGate && d.currency !== 'legacy');
  assert.equal(Math.max(...core.map((d) => d.cost)), 3e12);
  assert.equal(byId('planetary-charter').cost, 3e12);
});

test('applyOverride: bare number, object, junk; a frontier override moves its gate', () => {
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
  const swarm = byId('dyson-swarm');
  const cheaper = applyOverride(swarm, { cost: 2e12 });
  assert.equal(cheaper.cost, 2e12);
  assert.equal(cheaper.unlock({ stats: { totalEarned: 5e11 } }), true, 'gate follows the new price');
  assert.equal(cheaper.unlock({ stats: { totalEarned: 4e11 } }), false);
  assert.equal(cheaper.unlockHint, 'Earn $500B in this city');
  assert.deepEqual(cheaper.unlockAt, { earned: 5e11 });
  assert.equal(swarm.unlock({ stats: { totalEarned: 5e11 } }), false, 'source def keeps its own gate');
  const same = applyOverride(swarm, { tier: 4 });
  assert.equal(same.unlock, swarm.unlock, 'unchanged price keeps the rule');
  const perk = byId('charter-mint');
  assert.equal(applyOverride(perk, { cost: 10 }).currency, 'legacy', 'currency survives an override');
});

test('config overrides resolve to the config costs, name only known rungs, and move the self-priced gates', () => {
  // src/balance/config.js owns the shipped ladder; the literals in data.js are the module's
  // own self-consistent defaults, so this pins the *resolution*, never the numbers.
  const overrides = config.upgrades || {};
  const resolved = (id) => applyOverride(byId(id), overrides[id]);
  for (const id of Object.keys(overrides)) assert.ok(byId(id), `config overrides unknown upgrade ${id}`);
  for (const [id, o] of Object.entries(overrides)) {
    const cost = typeof o === 'number' ? o : o && o.cost;
    if (!Number.isFinite(cost)) continue;
    const def = resolved(id);
    assert.equal(def.cost, cost, `${id}: resolves to the config price`);
    if (def.earnedGate) {
      assert.deepEqual(def.unlockAt, { earned: cost * FRONTIER_GATE }, `${id}: frontier gate follows the config price`);
      assert.equal(def.unlock({ stats: { totalEarned: cost * FRONTIER_GATE } }), true);
      assert.equal(def.unlock({ stats: { totalEarned: cost * FRONTIER_GATE - 1 } }), false);
    } else if (def.currency === 'legacy') {
      const gate = cost * CHARTER_GATE;
      assert.deepEqual(def.unlockAt, { legacy: gate }, `${id}: charter gate follows the config price`);
      assert.equal(def.unlock({ prestige: { legacy: Math.ceil(gate) } }), true);
      assert.equal(def.unlock({ prestige: { legacy: Math.ceil(gate) - 1 } }), false);
      assert.equal(def.tier, cost <= 25 ? 1 : cost <= 600 ? 2 : cost <= 12000 ? 3 : 4, `${id}: tier bracket follows the config price`);
      assert.match(def.unlockHint, /legacy|Found a new city/);
    }
  }
  // Untouched rungs keep the data.js literal.
  const untouched = UPGRADES.find((d) => !(d.id in overrides));
  assert.equal(resolved(untouched.id).cost, untouched.cost);
});

test('meaningfulness: every rung moves a multiplier by ≥25% (cost/demand/upkeep −15%) or adds ≥0.1 happiness', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const UP = ['income', 'housing', 'jobs', 'power', 'growth', 'inflow'];
  const DOWN = ['cost', 'demand', 'upkeep'];
  const B_UP = ['income', 'housing', 'jobs', 'power'];
  const strongestUp = (mods) => {
    let best = 0;
    for (const k of UP) best = Math.max(best, mods[k] - 1);
    for (const m of Object.values(mods.byBuilding)) for (const k of B_UP) best = Math.max(best, m[k] - 1);
    return best;
  };
  const strongestDown = (mods) => Math.max(...DOWN.map((k) => 1 - mods[k]));
  for (const d of UPGRADES) {
    if (typeof d.keeps === 'function') continue; // structural rungs: their whole effect is the memory
    const mods = createMods();
    d.effect(mods, FROZEN_STATE);
    const up = strongestUp(mods);
    const down = strongestDown(mods);
    const ok = up >= 0.25 - 1e-9 || down >= 0.15 - 1e-9 || mods.happiness >= 0.1 - 1e-9;
    assert.ok(ok, `${d.id}: strongest +${(up * 100).toFixed(0)}% / −${(down * 100).toFixed(0)}%, happiness +${mods.happiness} — a dud`);
  }
  // A few exact pins.
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
  const m6 = createMods();
  byId('modern-curriculum').effect(m6, {});
  assert.ok(near(m6.jobs, 1.25) && near(m6.happiness, 0.1));
  const m7 = createMods();
  byId('community-events').effect(m7, {});
  assert.ok(near(m7.growth, 1.25) && near(m7.happiness, 0.1));
  const m8 = createMods();
  byId('grid-substations').effect(m8, {});
  assert.ok(near(m8.power, 1.25));
  const m9 = createMods();
  byId('championship-season').effect(m9, {});
  assert.ok(near(m9.byBuilding.stadium.income, 2) && near(m9.byBuilding.stadium.jobs, 2));
  assert.notEqual(byId('welcome-sign').icon, byId('neon-signage').icon, 'distinct icons in the owned chip row');
  // Dynasty Ledger: a cube root of the bank, as the desc says — ×2 at 8 points, ×6 at
  // 1,000, ×51 at the million-point ceiling; 0 without a bank.
  const ledger = (pts) => {
    const m = createMods();
    byId('dynasty-ledger').effect(m, { prestige: { legacy: pts } });
    return m.income;
  };
  assert.ok(near(ledger(0), 1) && near(ledger(8), 2) && near(ledger(1000), 6) && near(ledger(1e6), 51));
  assert.ok(ledger(5) >= 1.85 && ledger(5) < 1.86, 'meaningful the moment it opens');
  // Mid ladder spacing: a rung every ×1.2–2 from $1.2k to $60k so no three-minute gap opens.
  const mid = UPGRADES.filter((d) => !d.earnedGate && d.currency !== 'legacy' && d.category !== 'prestige' && d.cost >= 1200 && d.cost <= 60000)
    .map((d) => d.cost)
    .sort((a, b) => a - b);
  for (let i = 1; i < mid.length; i++) assert.ok(mid[i] / mid[i - 1] <= 2.01, `mid ladder jumps ×${(mid[i] / mid[i - 1]).toFixed(2)} at $${mid[i]}`);
});

test('keptUpgradeIds: charter perks always survive; memory rungs re-own tiers 1–2, standing orders tier 3 + Legacy', () => {
  assert.deepEqual(keptUpgradeIds([]), []);
  assert.deepEqual(keptUpgradeIds(['welcome-sign', 'dyson-swarm']), [], 'plain upgrades keep nothing');
  assert.deepEqual(keptUpgradeIds(['charter-mint', 'welcome-sign']), ['charter-mint'], 'a perk keeps itself and nothing else');
  assert.deepEqual(keptUpgradeIds(PERKS.map((d) => d.id)).sort(), PERKS.map((d) => d.id).sort());
  const mem = keptUpgradeIds(['institutional-memory']);
  assert.ok(mem.includes('institutional-memory'));
  const core = (d) => !d.earnedGate && d.category !== 'prestige' && d.currency !== 'legacy';
  for (const d of UPGRADES) {
    assert.equal(mem.includes(d.id), d.id === 'institutional-memory' || (core(d) && d.tier <= 2), `memory keeps ${d.id}?`);
  }
  const both = keptUpgradeIds(['institutional-memory', 'standing-orders']);
  for (const d of UPGRADES) {
    const want = (core(d) && d.tier <= 3) || d.category === 'prestige';
    assert.equal(both.includes(d.id), want, `both keep ${d.id}?`);
  }
  assert.ok(!both.includes('planetary-charter') && !both.includes('galactic-charter'), 'tier 4 and the frontier are decisions again');
  assert.ok(!both.includes('charter-mint'), 'keepers never grant a perk that was not bought');
  const memoryDefs = UPGRADES.filter((d) => typeof d.keeps === 'function');
  for (const d of memoryDefs) {
    const mods = createMods();
    d.effect(mods, FROZEN_STATE);
    assert.deepEqual(mods, createMods(), `${d.id}: structural rung changes no modifier`);
  }
});

test('init registers the ladder, sortedUpgrades reads the live registry, grants and foundings flow through one seam', async () => {
  const game = { derived: { income: 0 }, state: { upgrades: {} } };
  const n = await init(game);
  assert.equal(n, UPGRADES.length);
  assert.equal(registry.upgrades.size, UPGRADES.length);
  const sorted = sortedUpgrades();
  assert.equal(sorted.length, UPGRADES.length);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].cost >= sorted[i - 1].cost, 'ascending');
  assert.equal(sorted[0].id, 'charter-homestead', 'three legacy points sort first');
  assert.equal(sorted[sorted.length - 1].id, 'galactic-charter');
  const cfgCost = (id) => config.upgrades?.[id]?.cost ?? byId(id).cost;
  assert.equal(sorted.find((d) => d.id === 'ai-governance').cost, cfgCost('ai-governance'), 'the registry carries the config price');
  assert.equal(registry.upgrades.get('charter-imperial').unlockAt.legacy, cfgCost('charter-imperial') * CHARTER_GATE, 'a config-priced perk opens at half its config price');
  assert.equal(registry.upgrades.get('charter-mint').currency, 'legacy');
  assert.ok(!registry.tickHandlers.some((t) => t.name === 'upgrades:income-prices'), 'no price-rewriting handler');
  assert.ok(registry.tickHandlers.some((t) => t.name === 'upgrades:memory'), 'memory handler registered');
  assert.ok(registry.actions.has('fundUpgrades'), 'fundUpgrades action registered');
  assert.equal(game.upgradeCategories, UPGRADE_CATEGORIES);
  assert.ok(UPGRADE_CATEGORIES.some((c) => c.id === 'charter'));

  // grantUpgrade: sets the flag once, emits the same 'upgrade' event a purchase does.
  const grant = registry.actions.get('grantUpgrade');
  assert.equal(typeof grant, 'function', 'grantUpgrade action registered');
  const seen = [];
  const off = on('upgrade', (e) => seen.push(e));
  assert.equal(grant('welcome-sign'), true);
  assert.equal(game.state.upgrades['welcome-sign'], true);
  assert.deepEqual(seen, [{ id: 'welcome-sign', cost: 0, granted: true }]);
  assert.equal(grant('welcome-sign'), false, 'already owned');
  assert.equal(grant('no-such-upgrade'), false, 'unknown id');
  assert.equal(grant(42), false, 'junk id');
  assert.equal(seen.length, 1, 'no event without a change');

  // Founding memory rides that seam: own a keeper and two perks, let the memory handler
  // see them, then a founding wipes the upgrades and the prestige event grants every kept
  // rung back — perks included, since legacy points are never refunded.
  game.state.upgrades = { 'institutional-memory': true, 'charter-homestead': true, 'charter-mint': true, 'dyson-swarm': true };
  registry.tickHandlers.find((t) => t.name === 'upgrades:memory').fn(game.state);
  game.state.upgrades = {};
  seen.length = 0;
  emit('prestige', { gain: 5, legacy: 15 });
  const kept = keptUpgradeIds(['institutional-memory', 'charter-homestead', 'charter-mint']);
  assert.equal(seen.length, kept.length, 'one upgrade event per re-granted rung');
  assert.ok(seen.every((e) => e.granted === true && e.cost === 0));
  assert.deepEqual(Object.keys(game.state.upgrades).sort(), [...kept].sort());
  assert.ok(game.state.upgrades['welcome-sign'] && game.state.upgrades['institutional-memory']);
  assert.ok(game.state.upgrades['charter-homestead'] && game.state.upgrades['charter-mint'], 'perks survive the founding');
  assert.ok(!game.state.upgrades['dyson-swarm'], 'the frontier does not');
  assert.ok(!game.state.upgrades['prefab-construction'], 'tier 3 is not kept by memory alone');

  // A perk bought mid-tick (the 'upgrade' event, before the next memory refresh) is
  // remembered too.
  game.state.upgrades = {};
  registry.tickHandlers.find((t) => t.name === 'upgrades:memory').fn(game.state);
  emit('upgrade', { id: 'charter-grid', cost: 25, currency: 'legacy' });
  seen.length = 0;
  emit('prestige', { gain: 1, legacy: 16 });
  assert.deepEqual(Object.keys(game.state.upgrades), ['charter-grid']);
  off();
});
