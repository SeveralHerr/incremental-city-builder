// Unit tests for the upgrades module. Run: node src/upgrades/upgrades.test.mjs
// Pins the data invariants (unique ids, desc length, hints everywhere, effects touch only the
// mods bag), the charter perks (legacy currency, ×2.5–4 cost spacing, spendable legacy ≥ cost/2
// gate),
// the frontier ladder (fixed dollars matching the shipped config, earned ≥ cost/4 gate that
// follows a config override), every config-priced literal in data.js (must equal config), the pace ladder (hidden until the city has earned 100× the
// price or holds it; the card surfaces the hold), the funded door on the core ladder (economy
// gate + the treasury holding the price; four goal cards open on the gate alone), the absence
// of any wall-clock rule, the config override rules, the founding-memory rule (charter perks
// and keeper rungs survive a founding), the grantUpgrade seam and the registered-cost view
// (sortedUpgrades: dollar rungs, then perks).
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
  PACE_GATE,
  CHARTER_GATE,
  CHARTER_MIN_COST,
  CHARTER_MAX_COST,
  frontierUnlock,
  earnedUnlock,
  holdUnlock,
  legacyFrontier,
  keptUpgradeIds,
  isPermanent,
  fmtMoney,
} from './data.js';
import { applyOverride, sortedUpgrades, init } from './index.js';

const CATEGORY_IDS = new Set(UPGRADE_CATEGORIES.map((c) => c.id));
const byId = (id) => UPGRADES.find((d) => d.id === id);
const PERKS = UPGRADES.filter((d) => d.category === 'charter');
const FRONTIER = UPGRADES.filter((d) => d.frontier);
const PACE = UPGRADES.filter((d) => d.pace);
const FRONTIER_IDS = ['dyson-swarm', 'quantum-exchange', 'mass-driver-port', 'ringworld-district', 'stellar-engine', 'galactic-charter', 'orbital-shipyard', 'helios-array', 'exchange-ring'];
const GOAL_IDS = ['welcome-sign', 'grid-substations', 'regional-airport', 'breeder-reactors'];
const isCore = (d) => !d.earnedGate && d.category !== 'prestige' && d.currency !== 'legacy';
const PACE_IDS = ['championship-season', 'robotic-assembly', 'ai-governance', 'orbital-solar', 'planetary-charter', 'megastructures', 'arcology-gardens', 'algorithmic-trading', 'superconductor-grid'];

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
  // 70 rungs: 33 core, 9 pace, 9 frontier, 7 Legacy, 12 charter perks. A count the header
  // comments, README.md and docs/DESIGN.md quote — pinned so a new rung updates them.
  assert.equal(UPGRADES.length, 70, `ladder has ${UPGRADES.length} rungs`);
  assert.equal(UPGRADES.filter((d) => d.currency === 'legacy').length, 12);
  assert.equal(UPGRADES.filter((d) => d.currency !== 'legacy').length, 58);
  assert.equal(MILESTONE_IDS.length, new Set(MILESTONE_IDS).size);
  // Card variety: the thirty identical Civic Bonds are gone for good. The repeats below
  // are money rungs whose ids and effects predate this pass (the two "+50% growth" rungs,
  // the three "−20% cost" rungs, Digital City Hall and the Legacy Archive); nothing else —
  // no perk, no frontier rung, no two adjacent income rungs — reads the same as another card.
  const ALLOWED_REPEATS = { 'Population grows +50% faster': 2, 'All buildings cost −20%': 3, 'All income +50%': 2 };
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
    'dynasty-ledger', 'institutional-memory', 'standing-orders', 'city-archives', 'orbital-shipyard', 'exchange-ring',
  ]) assert.ok(byId(id), `missing legacy id ${id}`);
});

test('hints read as the rule they mirror', () => {
  // Funded core rungs name their economy gate and the hold, and mirror the price (the door
  // that opens last); the goal cards name the gate alone and mirror it.
  assert.equal(byId('neon-signage').unlockHint, 'Build 3 corner shops, then hold $80');
  assert.deepEqual(byId('neon-signage').unlockAt, { money: 80 });
  assert.equal(byId('farmers-market').unlockHint, 'Build 15 corner shops, then hold $3,000');
  assert.equal(byId('container-port').unlockHint, 'Build 20 factories, then hold $45,000');
  assert.equal(byId('community-events').unlockHint, 'Build a City Park, then hold $500');
  assert.equal(byId('franchising').unlockHint, 'Reach 100 citizens or build an Office Block, then hold $1,200');
  assert.equal(byId('prefab-construction').unlockHint, 'Earn $1M in this city, then hold $120,000');
  assert.equal(byId('grid-substations').unlockHint, 'Draw 10 MW of power');
  assert.deepEqual(byId('grid-substations').unlockAt, { powerDemand: 10 });
  assert.equal(byId('regional-airport').unlockHint, 'Reach 1,000 citizens');
  assert.deepEqual(byId('regional-airport').unlockAt, { pop: 1000 });
  assert.equal(byId('breeder-reactors').unlockHint, 'Reach 10,000 citizens or build a Nuclear Plant');
  assert.deepEqual(byId('tourism-board').unlockAt, { money: 50000 });
  assert.equal(byId('legacy-archive').unlockHint, 'Found a new city');
  assert.deepEqual(byId('founders-blueprints').unlockAt, { legacy: 2 });
  assert.match(byId('smart-grid').unlockHint, /brownout/i);
  // The dear Legacy rungs name the points and the earnings door, and mirror the earnings
  // (the door that opens last), like a frontier card.
  assert.equal(byId('standing-orders').unlockHint, 'Bank 50 legacy points and own Institutional Memory, then earn $1T in this city');
  assert.deepEqual(byId('standing-orders').unlockAt, { earned: 4.03e12 / 4 });
  assert.equal(byId('institutional-memory').unlockHint, 'Bank 10 legacy points, then earn $7.5M in this city');
  assert.deepEqual(byId('institutional-memory').unlockAt, { earned: 7.5e6 });
  // Frontier rungs quote the earnings gate in the hint and mirror it for the bar.
  assert.equal(byId('dyson-swarm').unlockHint, 'Earn $12M in this city');
  assert.deepEqual(byId('dyson-swarm').unlockAt, { earned: 1.1975e7 });
  assert.equal(byId('mass-driver-port').unlockHint, 'Earn $2.3T in this city');
  assert.equal(byId('ringworld-district').unlockHint, 'Earn $17.5T in this city');
  assert.equal(byId('galactic-charter').unlockHint, 'Earn $130.5T in this city');
  assert.equal(byId('helios-array').unlockHint, 'Earn $562.5T in this city');
  assert.equal(byId('exchange-ring').unlockHint, 'Earn $1.2Qa in this city');
  assert.equal(fmtMoney(1e18), '$1Qi');
  // Pace rungs keep both doors in the rule but surface only the hold — the door that opens
  // them in practice — so the hint is the price and the bar counts the treasury toward it,
  // never "Earn $34.4Qa" for a $344T card.
  assert.equal(byId('robotic-assembly').unlockHint, 'Hold $262M');
  assert.deepEqual(byId('robotic-assembly').unlockAt, { money: 2.62e8 });
  assert.equal(byId('superconductor-grid').unlockHint, 'Hold $435T');
  assert.deepEqual(byId('superconductor-grid').unlockAt, { money: 4.35e14 });
  assert.equal(byId('city-archives').unlockHint, 'Bank 20 legacy points, then earn $500B in this city');
  // Charter perks quote the spendable points they wait for (bank − spent, what the Sign
  // button checks), never the whole bank.
  assert.equal(byId('charter-homestead').unlockHint, 'Have 2 spendable legacy points');
  assert.equal(byId('charter-mint').unlockHint, 'Have 4 spendable legacy points');
  assert.equal(byId('charter-imperial').unlockHint, 'Have 75,250 spendable legacy points');
  assert.deepEqual(byId('charter-imperial').unlockAt, { legacyAvailable: 75250 });
  for (const d of PERKS) assert.ok(!/^Bank /.test(d.unlockHint), `${d.id}: a perk hint must count spendable points, not the bank`);
});

test('happiness: flat city-wide adds only, descs quote the exact add in percent', () => {
  assert.equal(byId('community-events').desc, 'Happiness +10% and population grows +25% faster');
  assert.equal(byId('green-belts').desc, 'Happiness +5% and population grows +25% faster');
  // Rungs that open once a city is already happy (h ≈ 1.9+) carry no happiness clause: at
  // that point +10% happiness is a +3% income footnote, so they move jobs, growth or income.
  assert.equal(byId('modern-curriculum').desc, 'All jobs +25% and all income +8%');
  assert.equal(byId('preventive-care').desc, 'Population grows +75% faster');
  assert.equal(byId('championship-season').desc, 'Stadiums earn +100% income and provide +100% jobs');
  assert.equal(byId('veteran-planners').desc, 'Population grows +100% faster and happiness +10%');
  assert.equal(byId('charter-civic').desc, 'All jobs +50% · population grows +50% faster');
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
  // Only the three rungs that open while a city is still unhappy add flat happiness
  // (Community Events, Green Belts, Veteran Planners), 0.25 in total against the 3.0 cap, so
  // civic buildings — not upgrades — decide happiness.
  assert.ok(Math.abs(flatTotal - 0.25) < 1e-9, `ladder adds ${flatTotal} happiness in total`);
  for (const id of ['community-events', 'green-belts', 'veteran-planners']) assert.match(byId(id).desc, /happiness \+/i, id);
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
  assert.equal(byId('farmers-market').unlock({ ...FROZEN_STATE, res: { money: 2999 } }), false, 'a funded rung needs the cash as well as the shops');
  assert.equal(byId('farmers-market').unlock({ ...FROZEN_STATE, buildings: { shop: 14 } }), false, 'and the shops as well as the cash');
  assert.equal(byId('ai-governance').unlock(FROZEN_STATE), false, '$2B earned, $1M held: short of both doors ($107B / $1.07B)');
  assert.equal(byId('robotic-assembly').unlock({ ...FROZEN_STATE, res: { money: 3.05e8 } }), true, 'holding the price opens a pace rung');
  assert.equal(byId('dyson-swarm').unlock(FROZEN_STATE), true, '$2B earned clears the $12M gate');
  assert.equal(byId('quantum-exchange').unlock(FROZEN_STATE), false, '$2B earned is short of the $8B gate');
  assert.equal(byId('quantum-exchange').unlock({ ...FROZEN_STATE, res: { money: 1e12 } }), false, 'a frontier rung has no cash door');
  // Charter perks gate on spendable points: 12 banked − 8 spent = 4 opens the Mint (◆ 8) and
  // nothing dearer; the same 12 unspent would open the Grid Charter (◆ 20).
  assert.equal(byId('charter-mint').unlock(FROZEN_STATE), true);
  assert.equal(byId('charter-grid').unlock(FROZEN_STATE), false, '4 spendable of 12 banked is short of 10');
  assert.equal(byId('charter-grid').unlock({ prestige: { legacy: 12, spent: 0 } }), true);
  assert.equal(byId('city-archives').unlock(FROZEN_STATE), false, '12 points is short of 20');
  assert.equal(byId('city-archives').unlock({ prestige: { legacy: 20 }, stats: { totalEarned: 5e11 } }), true);
});

test('legacy rungs: the three dear ones need their points and a quarter of the price earned this run; the door follows a config price', () => {
  const doored = UPGRADES.filter((d) => typeof d.legacyGate === 'function');
  assert.deepEqual(doored.map((d) => d.id), ['institutional-memory', 'city-archives', 'standing-orders']);
  for (const d of doored) {
    assert.equal(d.category, 'prestige');
    assert.ok(!d.hold && !d.earnedGate, `${d.id}: one door builder only`);
    const gate = d.cost * FRONTIER_GATE;
    assert.deepEqual(d.unlockAt, { earned: gate }, `${d.id}: mirrors the earnings door`);
    assert.match(d.unlockHint, /^Bank \d+ legacy points.*, then earn \$.* in this city$/, `${d.id}: names both doors`);
    // A bank of points with nothing earned stays shut (the four-hour card); the earnings
    // with no points stay shut; both together open it.
    const rich = { prestige: { legacy: 1e6 }, upgrades: { 'institutional-memory': true }, stats: { totalEarned: gate }, res: { money: d.cost * 10 } };
    assert.equal(d.unlock(rich), true, `${d.id}: opens at ${gate} earned with the points`);
    assert.equal(d.unlock({ ...rich, stats: { totalEarned: gate * 0.999 } }), false, `${d.id}: shut a hair short of the earnings door`);
    assert.equal(d.unlock({ ...rich, prestige: { legacy: 0 } }), false, `${d.id}: earnings alone do not open it`);
    assert.equal(d.unlock({ ...rich, stats: { totalEarned: 0 }, unlocks: { 'm:money-1b': true, 'm:prestige-1': true } }), false, `${d.id}: no milestone shortcut`);
  }
  // Standing Orders keeps its ownership door too.
  assert.equal(byId('standing-orders').unlock({ prestige: { legacy: 1e6 }, upgrades: {}, stats: { totalEarned: 1e15 } }), false, 'needs Institutional Memory');
  // The cheap Legacy rungs open on points alone (bought within seconds of a founding).
  for (const id of ['legacy-archive', 'founders-blueprints', 'veteran-planners', 'dynasty-ledger']) {
    assert.equal(byId(id).unlock({ prestige: { legacy: 5 }, stats: { totalEarned: 0 } }), true, `${id}: points alone`);
  }
  // A config price moves the door, and the legacy gate rides along.
  const moved = applyOverride(byId('standing-orders'), { cost: 8e12 });
  assert.deepEqual(moved.unlockAt, { earned: 2e12 });
  assert.equal(moved.unlockHint, 'Bank 50 legacy points and own Institutional Memory, then earn $2T in this city');
  assert.equal(moved.unlock({ prestige: { legacy: 50 }, upgrades: { 'institutional-memory': true }, stats: { totalEarned: 2e12 } }), true);
  assert.equal(moved.unlock({ prestige: { legacy: 50 }, upgrades: { 'institutional-memory': true }, stats: { totalEarned: 1.9e12 } }), false);
  assert.equal(moved.unlock({ prestige: { legacy: 49 }, upgrades: { 'institutional-memory': true }, stats: { totalEarned: 1e13 } }), false, 'the points still count');
  assert.equal(byId('standing-orders').unlock({ prestige: { legacy: 50 }, upgrades: { 'institutional-memory': true }, stats: { totalEarned: 1.01e12 } }), true, 'source def keeps its own door');
  assert.equal(legacyFrontier({ cost: 400 }).unlockHint, 'Earn $100 in this city');
  assert.equal(legacyFrontier(undefined).unlock({ stats: { totalEarned: 0 } }), true, 'garbage def: a zero door, never a throw');
  // Founding memory still re-grants a kept rung without consulting the door.
  assert.ok(keptUpgradeIds(['standing-orders', 'institutional-memory']).includes('city-archives'));
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

test('charter perks: ≥12, legacy currency, ×2.5–4 apart from 3 to 150,500, open at half their price in spendable points, tiered by cost', () => {
  assert.ok(PERKS.length >= 12, `${PERKS.length} perks`);
  const costs = PERKS.map((d) => d.cost);
  assert.equal(costs[0], CHARTER_MIN_COST);
  assert.equal(costs[costs.length - 1], CHARTER_MAX_COST);
  assert.equal(CHARTER_MIN_COST, 3);
  assert.equal(CHARTER_MAX_COST, 150500);
  assert.equal(CHARTER_MAX_COST, PERKS[PERKS.length - 1].cost, 'the constant is the last perk: a new top rung must move it');
  assert.equal(CHARTER_MIN_COST, PERKS[0].cost);
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
    // Spendable legacy (bank − spent) ≥ cost/2 opens it — the number core's canAffordUpgrade
    // checks, so an open card is half-way to signing, never "ready" with a dead button. One
    // point short keeps it shut, and points already spent do not count.
    const gate = d.cost * CHARTER_GATE;
    const need = Math.ceil(gate);
    assert.equal(CHARTER_GATE, 0.5);
    assert.equal(d.unlock({ prestige: { legacy: need, spent: 0 } }), true, `${d.id}: opens at ${gate}`);
    assert.equal(d.unlock({ prestige: { legacy: need + 1000, spent: 1000 } }), true, `${d.id}: spent points above the gate are irrelevant`);
    assert.equal(d.unlock({ prestige: { legacy: need, spent: 1 } }), false, `${d.id}: a spent point is not spendable`);
    assert.equal(d.unlock({ prestige: { legacy: need - 1, spent: 0 } }), false, `${d.id}: shut below ${gate}`);
    assert.equal(d.unlock({ prestige: { legacy: need + 0.9, spent: 0.9 } }), true, `${d.id}: floors the bank and the spend like core`);
    assert.equal(d.unlock({ prestige: { legacy: 0 }, unlocks: { 'm:prestige-1': true } }), false, `${d.id}: no milestone shortcut`);
    assert.deepEqual(d.unlockAt, { legacyAvailable: gate });
    assert.equal(d.unlockHint, `Have ${need.toLocaleString('en-US')} spendable legacy points`);
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
      ['charter-homestead', 3], ['charter-mint', 8], ['charter-grid', 20], ['charter-guild', 50], ['charter-merchant', 154],
      ['charter-settlers', 385], ['charter-masons', 963], ['charter-civic', 2408], ['charter-treasury', 6020],
      ['charter-skyline', 15050], ['charter-energy', 37625], ['charter-imperial', 150500],
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

test('frontier ladder: nine named rungs at the shipped prices, ascending, opening at a quarter of the price earned this run', () => {
  assert.deepEqual(FRONTIER.map((d) => d.id), FRONTIER_IDS);
  assert.deepEqual(FRONTIER.map((d) => d.cost), [4.79e7, 3.2e10, 9e12, 7.0e13, 3.18e14, 5.22e14, 1.35e15, 2.25e15, 4.87e15]);
  // Placed by city (config.js), so the spacing is uneven —   // Port and the Ringworld District, ×2,150 below it — but always ascending, and never
  // wider than ×6 above the Stellar Engine (the Helios Array splits the old ×23 step).
  for (let i = FRONTIER.findIndex((d) => d.id === 'stellar-engine') + 1; i < FRONTIER.length; i++) assert.ok(FRONTIER[i].cost / FRONTIER[i - 1].cost <= 6, `${FRONTIER[i].id}: ×${(FRONTIER[i].cost / FRONTIER[i - 1].cost).toFixed(1)} step`);
  for (let i = 1; i < FRONTIER.length; i++) assert.ok(FRONTIER[i].cost > FRONTIER[i - 1].cost, `${FRONTIER[i].id}: not dearer than ${FRONTIER[i - 1].id}`);
  assert.ok(FRONTIER[FRONTIER.length - 1].cost < 1e18, 'the priciest rung stays under the money ceiling');
  assert.equal(FRONTIER_GATE, 0.25);
  assert.equal(frontierUnlock, earnedUnlock, 'the documented seam is the earnings-gate builder');
  const descs = new Set();
  for (const d of FRONTIER) {
    assert.equal(d.tier, 4);
    assert.ok(d.currency === undefined || d.currency === 'money', `${d.id}: money-priced`);
    assert.equal(d.earnedGate, FRONTIER_GATE);
    assert.ok(!d.pace, `${d.id}: frontier, not pace`);
    const gate = d.cost / 4;
    assert.equal(d.unlock({ stats: { totalEarned: gate } }), true, `${d.id}: opens at ${gate}`);
    assert.equal(d.unlock({ stats: { totalEarned: gate * 0.999 } }), false, `${d.id}: shut below ${gate}`);
    assert.equal(d.unlock({ stats: { totalEarned: 0 }, res: { money: d.cost * 10 }, prestige: { legacy: 1e6 }, unlocks: { 'm:money-1b': true } }), false, `${d.id}: only earnings open it`);
    assert.deepEqual(d.unlockAt, { earned: gate });
    assert.ok(!descs.has(d.desc), `${d.id}: repeats a frontier desc`);
    descs.add(d.desc);
  }
  // Every rung is a different lever, and the ladder as a whole pulls income, housing,
  // power, growth, jobs, cost and demand.
  const fold = createMods();
  for (const d of FRONTIER) d.effect(fold, FROZEN_STATE);
  assert.ok(fold.income >= 5 && fold.housing >= 5 && fold.power >= 12 && fold.growth >= 3 && fold.jobs >= 2.5, 'frontier multipliers');
  assert.ok(fold.cost < 0.7 && fold.demand < 0.5, 'frontier discounts');
  assert.ok(fold.byBuilding.financial.income >= 2 && fold.byBuilding.techpark.income >= 2 && fold.byBuilding.mall.jobs >= 2, 'frontier per-building');
  // earnedUnlock follows the price it is given (config overrides move the gate).
  const moved = earnedUnlock({ ...byId('dyson-swarm'), cost: 4e13 });
  assert.equal(moved.unlock({ stats: { totalEarned: 1e13 } }), true);
  assert.equal(moved.unlock({ stats: { totalEarned: 9e12 } }), false);
  assert.equal(moved.unlockHint, 'Earn $10T in this city');
  assert.deepEqual(moved.unlockAt, { earned: 1e13 });
  assert.deepEqual(earnedUnlock({ cost: 0 }).unlockAt, { earned: 0 });
  assert.equal(earnedUnlock(undefined).unlock({ stats: { totalEarned: 0 } }), true, 'garbage def: a zero gate, never a throw');
  // The core ladder (what a first city buys) tops out at Breeder Reactors; everything
  // above is placed per replay city and split between the pace and frontier ladders.
  const core = UPGRADES.filter((d) => !d.frontier && !d.pace && d.category !== 'prestige' && d.currency !== 'legacy');
  assert.equal(Math.max(...core.map((d) => d.cost)), 2e7);
  for (const d of UPGRADES) if (d.currency !== 'legacy' && d.category !== 'prestige' && d.cost > 2e7) assert.ok(d.frontier || d.pace, `${d.id}: a late rung outside both ladders`);
});

test('pace ladder: nine tier-4 rungs hidden until the city has earned 100× the price or holds it', () => {
  assert.deepEqual(PACE.map((d) => d.id), PACE_IDS);
  assert.deepEqual(PACE.map((d) => d.cost), [8.84e7, 2.62e8, 1.07e9, 2.05e9, 4.3e9, 2.64e11, 3.2e11, 7.7e11, 4.35e14]);
  for (let i = 1; i < PACE.length; i++) assert.ok(PACE[i].cost > PACE[i - 1].cost, `${PACE[i].id}: listed out of price order`);
  assert.equal(PACE_GATE, 100);
  for (const d of PACE) {
    assert.equal(d.tier, 4);
    assert.equal(d.earnedGate, PACE_GATE);
    assert.ok(!d.frontier);
    const gate = d.cost * PACE_GATE;
    // The dead zone — cash short of the price, earnings short of the gate — keeps it shut;
    // either door opens it.
    assert.equal(d.unlock({ res: { money: d.cost * 0.999 }, stats: { totalEarned: gate * 0.999 } }), false, `${d.id}: shut in the dead zone`);
    assert.equal(d.unlock({ res: { money: 0 }, stats: { totalEarned: gate } }), true, `${d.id}: opens at ${gate} earned`);
    assert.equal(d.unlock({ res: { money: d.cost }, stats: { totalEarned: 0 } }), true, `${d.id}: opens while the treasury holds ${d.cost}`);
    assert.equal(
      d.unlock({ res: { money: 0, pop: 1e7 }, stats: { totalEarned: 0 }, buildings: { techpark: 50, arcology: 50, stadium: 9, financial: 9, nuclear: 9, fusion: 9 }, prestige: { legacy: 1e6 } }),
      false,
      `${d.id}: buildings, population and legacy do not open it`
    );
    assert.deepEqual(d.unlockAt, { money: d.cost }, `${d.id}: the mirror is the price`);
    assert.match(d.unlockHint, /^Hold \$/);
  }
  // A config price moves both doors (and the surfaced hold with them).
  const cheap = applyOverride(byId('planetary-charter'), { cost: 1e9 });
  assert.equal(cheap.unlock({ res: { money: 0 }, stats: { totalEarned: 1e11 } }), true);
  assert.equal(cheap.unlock({ res: { money: 0 }, stats: { totalEarned: 9e10 } }), false);
  assert.equal(cheap.unlock({ res: { money: 1e9 }, stats: { totalEarned: 0 } }), true);
  assert.equal(cheap.unlockHint, 'Hold $1B');
  assert.deepEqual(cheap.unlockAt, { money: 1e9 });
  // Founding memory never grants a pace rung: it is bought again every city.
  assert.deepEqual(keptUpgradeIds(['institutional-memory', 'standing-orders']).filter((id) => PACE_IDS.includes(id)), []);
});

test('funded door: every core rung but the four goal cards needs its gate and the cash; the door follows a config price', () => {
  const core = UPGRADES.filter(isCore);
  const goals = core.filter((d) => !d.hold);
  assert.deepEqual(goals.map((d) => d.id), GOAL_IDS, 'the goal cards open on their economy gate alone');
  for (const d of goals) assert.ok(!('money' in (d.unlockAt || {})), `${d.id}: a goal card mirrors its gate, not its price`);
  for (const d of core) {
    if (!d.hold) continue;
    assert.equal(typeof d.gate, 'function', `${d.id}: keeps its economy gate`);
    assert.deepEqual(d.unlockAt, { money: d.cost }, `${d.id}: mirrors the price`);
    assert.match(d.unlockHint, /, then hold \$/, `${d.id}: names both doors`);
    // A treasury holding the price with the gate unmet stays shut; the gate met with a
    // dollar short stays shut; both together open it.
    const rich = { ...FROZEN_STATE, res: { money: d.cost, pop: FROZEN_STATE.res.pop } };
    const poor = { ...FROZEN_STATE, res: { money: d.cost - 1, pop: FROZEN_STATE.res.pop } };
    if (d.gate(rich, FROZEN_DERIVED)) {
      assert.equal(d.unlock(rich, FROZEN_DERIVED), true, `${d.id}: opens with gate + cash`);
      assert.equal(d.unlock(poor, FROZEN_DERIVED), false, `${d.id}: a dollar short stays shut`);
    }
    assert.equal(d.unlock({ res: { money: d.cost * 10 }, buildings: {}, stats: {}, unlocks: {}, upgrades: {} }, { powerCap: 0, powerRatio: 1, powerDemand: 0, upkeep: 0 }), false, `${d.id}: cash alone does not open it`);
  }
  // The hold rebuilds on a config price, keeping the gate.
  const moved = applyOverride(byId('farmers-market'), { cost: 9000 });
  assert.equal(moved.unlock({ ...FROZEN_STATE, res: { money: 8999 } }), false);
  assert.equal(moved.unlock({ ...FROZEN_STATE, res: { money: 9000 } }), true);
  assert.equal(moved.unlock({ ...FROZEN_STATE, res: { money: 9000 }, buildings: { shop: 14 } }), false, 'the shops still count');
  assert.equal(moved.unlockHint, 'Build 15 corner shops, then hold $9,000');
  assert.deepEqual(moved.unlockAt, { money: 9000 });
  assert.equal(byId('farmers-market').unlock({ ...FROZEN_STATE, res: { money: 3000 } }), true, 'source def keeps its own price');
  const bare = holdUnlock({ cost: 500 });
  assert.equal(bare.unlockHint, 'Hold $500');
  assert.equal(bare.unlock({ res: { money: 500 } }), true);
  assert.equal(holdUnlock(undefined).unlock({ res: { money: 0 } }), true, 'garbage def: a zero hold, never a throw');
  // Nothing outside the core ladder carries the door: pace rungs surface their own hold,
  // frontier rungs, Legacy rungs and perks open on earnings, points or spendable points.
  for (const d of UPGRADES) if (!isCore(d)) assert.ok(!d.hold, `${d.id}: hold outside the core ladder`);
  // Founding memory still re-grants funded rungs (the door is an unlock rule, not a cost).
  assert.ok(keptUpgradeIds(['institutional-memory']).includes('farmers-market'));
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
  assert.equal(swarm.unlock({ stats: { totalEarned: 1e7 } }), false, 'source def keeps its own gate');
  assert.equal(swarm.unlock({ stats: { totalEarned: 1.1975e7 } }), true);
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
      const share = def.pace ? PACE_GATE : FRONTIER_GATE;
      assert.deepEqual(def.unlockAt, def.pace ? { money: cost } : { earned: cost * share }, `${id}: gate mirror follows the config price`);
      assert.equal(def.unlock({ res: { money: 0 }, stats: { totalEarned: cost * share } }), true);
      // × 0.999, not − 1: a pace gate is above 2^53 dollars, where a double cannot hold "one dollar short".
      assert.equal(def.unlock({ res: { money: 0 }, stats: { totalEarned: cost * share * 0.999 } }), false);
      if (def.pace) assert.equal(def.unlock({ res: { money: cost }, stats: { totalEarned: 0 } }), true, `${id}: cash door follows the config price`);
    } else if (def.currency === 'legacy') {
      const gate = cost * CHARTER_GATE;
      assert.deepEqual(def.unlockAt, { legacyAvailable: gate }, `${id}: charter gate follows the config price`);
      assert.equal(def.unlock({ prestige: { legacy: Math.ceil(gate), spent: 0 } }), true);
      assert.equal(def.unlock({ prestige: { legacy: Math.ceil(gate) - 1, spent: 0 } }), false);
      assert.equal(def.unlock({ prestige: { legacy: Math.ceil(gate), spent: 1 } }), false, `${id}: spent points do not open a perk`);
      assert.equal(def.tier, cost <= 25 ? 1 : cost <= 600 ? 2 : cost <= 12000 ? 3 : 4, `${id}: tier bracket follows the config price`);
      assert.match(def.unlockHint, /legacy|Found a new city/);
    } else if (def.hold) {
      assert.deepEqual(def.unlockAt, { money: cost }, `${id}: hold door follows the config price`);
      if (def.gate(FROZEN_STATE, FROZEN_DERIVED)) assert.equal(def.unlock({ ...FROZEN_STATE, res: { money: cost } }, FROZEN_DERIVED), true, `${id}: opens at the config price once the gate is met`);
      assert.equal(def.unlock({ ...FROZEN_STATE, res: { money: cost * 0.999 } }, FROZEN_DERIVED), false, `${id}: shut a dollar short of the config price`);
    }
  }
  // Untouched rungs keep the data.js literal.
  const untouched = UPGRADES.find((d) => !(d.id in overrides));
  assert.equal(resolved(untouched.id).cost, untouched.cost);
});

test('data.js literals match config: every config-priced rung carries the shipped price as its default', () => {
  // data.js claims its literals are the shipped prices (so the file reads true and a missing
  // config still gives the tuned game). This is what makes that claim hold: after a balance
  // pass, copy each price it names here into data.js.
  const overrides = config.upgrades || {};
  const drift = [];
  for (const [id, o] of Object.entries(overrides)) {
    const cost = typeof o === 'number' ? o : o && o.cost;
    if (!Number.isFinite(cost)) continue;
    const def = byId(id);
    if (def && def.cost !== cost) drift.push(`${id}: data.js ${def.cost} vs config ${cost}`);
  }
  assert.deepEqual(drift, [], `data.js literals drifted from config:\n${drift.join('\n')}`);
  // The charter ladder's own constants are the shipped ends of the ladder.
  assert.equal(overrides['charter-homestead']?.cost ?? CHARTER_MIN_COST, CHARTER_MIN_COST);
  assert.equal(overrides['charter-imperial']?.cost ?? CHARTER_MAX_COST, CHARTER_MAX_COST);
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
  const strongestDown = (mods) => Math.max(...DOWN.map((k) => 1 - mods[k]), ...Object.values(mods.byBuilding).map((m) => 1 - m.cost));
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
  // The two pairs that read alike are told apart by a lever: Grant Writing carries the
  // civic-grant discount beside its +25%, the Tourism Board is a housing card.
  const mg = createMods();
  byId('grant-writing').effect(mg, {});
  assert.ok(near(mg.income, 1.25) && near(mg.byBuilding.park.cost, 0.75) && near(mg.byBuilding.school.cost, 0.75));
  const mt = createMods();
  byId('tourism-board').effect(mt, {});
  assert.ok(near(mt.housing, 1.25) && near(mt.income, 1.15));
  assert.notEqual(byId('grant-writing').desc, byId('tax-software').desc);
  assert.notEqual(byId('tourism-board').desc, byId('regional-airport').desc);
  const mh = createMods();
  byId('helios-array').effect(mh, {});
  assert.ok(near(mh.power, 3) && near(mh.income, 1.25));
  const m3 = createMods();
  byId('founders-blueprints').effect(m3, {});
  assert.ok(near(m3.cost, 0.8));
  const m4 = createMods();
  byId('smart-grid').effect(m4, {});
  assert.ok(near(m4.demand, 0.8));
  // Maintenance Contracts: upkeep is 0.0–0.6% of the gross for the whole session, so no
  // upkeep clause (it read as a promise worth +0%); the plant discount (plants are 42% of
  // the spend that follows) and +30% on the two buildings that carry the first city's
  // income at minute 27 (+11% gross on the day) are the felt terms. Per-building, never a
  // global income clause, which compounds through every replay's tier-3 re-grant
  // (measured, see data.js; +50% here completed the 35th city before 12 h).
  const mm = createMods();
  byId('maintenance-contracts').effect(mm, {});
  assert.ok(near(mm.upkeep, 1) && near(mm.income, 1), 'no global clause');
  for (const id of ['coal', 'solar', 'nuclear', 'fusion']) assert.ok(near(mm.byBuilding[id].cost, 0.8), `maintenance: ${id}`);
  assert.ok(!mm.byBuilding.windmill || near(mm.byBuilding.windmill.cost, 1));
  assert.ok(near(mm.byBuilding.refinery.income, 1.2) && near(mm.byBuilding.mall.income, 1.2));
  assert.equal(byId('maintenance-contracts').desc, 'Power plants cost −20% · refineries and malls earn +20%');
  assert.ok(!/upkeep/i.test(byId('maintenance-contracts').desc), 'upkeep is inert (≤0.6% of gross): no rung may sell it as its felt term');
  const m5 = createMods();
  byId('superconductor-grid').effect(m5, {});
  assert.ok(near(m5.demand, 0.7));
  const m6 = createMods();
  byId('modern-curriculum').effect(m6, {});
  assert.ok(near(m6.jobs, 1.25) && near(m6.income, 1.08) && m6.happiness === 0);
  const m10 = createMods();
  byId('preventive-care').effect(m10, {});
  assert.ok(near(m10.growth, 1.75) && m10.happiness === 0);
  const m11 = createMods();
  byId('city-archives').effect(m11, {});
  assert.ok(near(m11.growth, 1.5) && near(m11.jobs, 1.25));
  const m12 = createMods();
  byId('galactic-charter').effect(m12, {});
  assert.ok(near(m12.income, 2) && near(m12.cost, 0.8));
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

test('keptUpgradeIds: charter perks always survive; memory re-owns tiers 1–2, the Grid Charter tier 3, standing orders tier 3 + Legacy', () => {
  assert.deepEqual(keptUpgradeIds([]), []);
  assert.deepEqual(keptUpgradeIds(['welcome-sign', 'dyson-swarm']), [], 'plain upgrades keep nothing');
  assert.deepEqual(keptUpgradeIds(['charter-mint', 'welcome-sign']), ['charter-mint'], 'a perk keeps itself and nothing else');
  // Every perk survives; the Grid Charter, a keeper, brings its tier-3 rungs along.
  const allPerks = keptUpgradeIds(PERKS.map((d) => d.id));
  for (const d of PERKS) assert.ok(allPerks.includes(d.id), `${d.id} survives`);
  assert.deepEqual(allPerks.filter((id) => !id.startsWith('charter-')).sort(), keptUpgradeIds(['charter-grid']).filter((id) => id !== 'charter-grid').sort());
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
  assert.ok(both.includes('city-archives'), 'Standing Orders keeps the Legacy rungs, City Archives included');
  assert.ok(!both.includes('charter-mint'), 'keepers never grant a perk that was not bought');
  // The Grid Charter is the early tier-3 keeper (city 6, ◆ 20): a perk, so it survives on
  // its own, and while signed every tier-3 core rung comes back with it — never tier 4,
  // the pace/frontier ladders or the Legacy rungs.
  const grid = keptUpgradeIds(['charter-grid']);
  assert.ok(grid.includes('charter-grid'));
  for (const d of UPGRADES) assert.equal(grid.includes(d.id), d.id === 'charter-grid' || (core(d) && d.tier === 3), `grid keeps ${d.id}?`);
  assert.ok(grid.includes('digital-city-hall') && grid.includes('preventive-care') && !grid.includes('breeder-reactors') && !grid.includes('city-archives'));
  assert.equal(grid.filter((id) => id !== 'charter-grid').length, 11, 'eleven tier-3 core rungs (the Regional Airport joined at $120k)');
  // Overlapping keepers grant a rung once.
  const three = keptUpgradeIds(['charter-grid', 'institutional-memory', 'standing-orders']);
  assert.equal(new Set(three).size, three.length);
  assert.deepEqual([...three].sort(), [...new Set([...both, 'charter-grid'])].sort());
  const memoryDefs = UPGRADES.filter((d) => typeof d.keeps === 'function' && d.category === 'prestige');
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
  // Two contiguous runs: every dollar rung by cost, then every perk by points.
  const firstPerk = sorted.findIndex((d) => d.currency === 'legacy');
  assert.ok(firstPerk > 0 && sorted.slice(firstPerk).every((d) => d.currency === 'legacy'), 'perks form one run at the end');
  for (let i = 1; i < firstPerk; i++) assert.ok(sorted[i].cost >= sorted[i - 1].cost, 'dollar rungs ascending');
  for (let i = firstPerk + 1; i < sorted.length; i++) assert.ok(sorted[i].cost >= sorted[i - 1].cost, 'perks ascending');
  assert.equal(sorted[0].id, 'welcome-sign', 'the $25 sign sorts first, not a ◆ 3 perk');
  assert.equal(sorted[firstPerk - 1].id, 'exchange-ring');
  assert.equal(sorted[firstPerk].id, 'charter-homestead');
  assert.equal(sorted[sorted.length - 1].id, 'charter-imperial');
  const cfgCost = (id) => config.upgrades?.[id]?.cost ?? byId(id).cost;
  assert.equal(sorted.find((d) => d.id === 'ai-governance').cost, cfgCost('ai-governance'), 'the registry carries the config price');
  assert.equal(registry.upgrades.get('charter-imperial').unlockAt.legacyAvailable, cfgCost('charter-imperial') * CHARTER_GATE, 'a config-priced perk opens at half its config price');
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
  emit('upgrade', { id: 'charter-grid', cost: 20, currency: 'legacy' });
  seen.length = 0;
  emit('prestige', { gain: 1, legacy: 16 });
  // The Grid Charter is a keeper: it comes back with the ten tier-3 core rungs it keeps.
  assert.deepEqual(Object.keys(game.state.upgrades).sort(), keptUpgradeIds(['charter-grid']).sort());
  assert.ok(game.state.upgrades['charter-grid'] && game.state.upgrades['prefab-construction'] && !game.state.upgrades['welcome-sign']);
  off();
});
