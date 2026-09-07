// Balance config contract: node src/balance/balance.test.mjs
//
// Pins the *shape* of src/balance/config.js against what its consumers read — the
// simulation's prestige knobs and bounds, the buildings/upgrades override tables (every id
// must exist), the charter-perk and frontier ladders the late-game contract asks for, and
// the first-tick power floor. Pacing numbers themselves are measured by
// tools/economy-sim.mjs, not asserted here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { config, costGrowthFor } from './config.js';
import { init } from './index.js';
import { prestigeTuning, economyTuning, milestoneTuning, LEGACY_POWER_MAX } from '../simulation/tuning.js';
import { UPGRADES, CHARTER_GATE, FRONTIER_GATE } from '../upgrades/data.js';
import { BUILDINGS } from '../buildings/data.js';

const upgradeById = new Map(UPGRADES.map((d) => [d.id, d]));
const buildingById = new Map(BUILDINGS.map((d) => [d.id, d]));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

test('module surface: config object, costGrowthFor, no-op init', () => {
  assert.equal(typeof config, 'object');
  assert.doesNotThrow(() => init({}));
  assert.equal(init({}), undefined);
  for (const t of [1, 2, 3, 4]) assert.ok(costGrowthFor(t) > 1 && costGrowthFor(t) < 1.3, `tier ${t} growth`);
  assert.equal(costGrowthFor(99), 1.18, 'unknown tier falls back to the tier-1 rate');
});

test('every section a consumer reads is present with finite numbers', () => {
  for (const k of ['startMoney', 'taxPerPop', 'wage', 'tapSeconds']) assert.ok(isNum(config.economy[k]) && config.economy[k] >= 0, `economy.${k}`);
  for (const k of ['growthRate', 'shrinkRate', 'baseInflow']) assert.ok(isNum(config.pop[k]) && config.pop[k] >= 0, `pop.${k}`);
  for (const k of ['civicCap', 'civicScale', 'pollutionScale', 'pollutionCap', 'pollutionCurve', 'unemploymentPenalty', 'overcrowdPenalty', 'brownoutPenalty', 'min', 'max'])
    assert.ok(isNum(config.happiness[k]), `happiness.${k}`);
  assert.ok(config.happiness.min < 1 && config.happiness.max > 1);
  assert.ok(config.happiness.pollutionCap < config.happiness.civicCap, 'a fully civic city always nets positive happiness');
  for (const k of ['autosaveSec', 'offlineCapSec', 'offlineEfficiency']) assert.ok(isNum(config.save[k]) && config.save[k] > 0, `save.${k}`);
  assert.ok(isNum(config.milestones.popIncomeBonus) && config.milestones.popIncomeBonus > 0);
  assert.ok(config.cost.sellRefund > 0 && config.cost.sellRefund < 1);
  for (const t of [1, 2, 3, 4]) assert.ok(isNum(config.cost.tierGrowth[t]) && config.cost.tierGrowth[t] > 1, `tierGrowth.${t}`);
});

test('first-tick brownout: the floor is the contract floor (>= 0.6) so a dark first tick never reads below it', () => {
  assert.ok(config.power.brownoutFloor >= 0.6 && config.power.brownoutFloor <= 1);
});

test('prestige knobs: exactly the set the simulation reads, resolved without clamping', () => {
  const READ = ['threshold', 'exponent', 'incomePerLegacy', 'legacyPower', 'firstBonus', 'startMoneyPerLegacy', 'minGain', 'minGainShare', 'prestigePanelShare'];
  assert.deepEqual(Object.keys(config.prestige).sort(), READ.slice().sort(), 'no stale or missing prestige knobs');
  const STALE = ['legacyCap', 'legacyCapTail', 'legacyCapTailPower', 'compoundPerMinute', 'peakCarry', 'compoundCap', 'ripenSeconds', 'legacyDiscount'];
  for (const k of STALE) assert.equal(k in config.prestige, false, `${k} was removed by the late-game contract`);
  const p = prestigeTuning(config);
  for (const k of READ) assert.equal(p[k], config.prestige[k], `prestige.${k} resolves verbatim (inside tuning bounds)`);
  assert.ok(config.prestige.legacyPower <= LEGACY_POWER_MAX, 'contract principle 4: p <= 0.6');
  assert.ok(config.prestige.exponent > 0 && config.prestige.exponent <= 1);
  assert.ok(config.prestige.minGainShare >= 0.25, 'the Found button never arms for a smaller haul than the bot would take (core/bot prestigeScale)');
  assert.equal(economyTuning(config).startMoney, config.economy.startMoney);
  assert.equal(milestoneTuning(config).popIncomeBonus, config.milestones.popIncomeBonus);
});

test('the Legacy panel opens before the Found button arms', () => {
  assert.ok(config.prestige.prestigePanelShare > 0 && config.prestige.prestigePanelShare < 1);
});

test('building overrides name real buildings and keep the catalogue sane', () => {
  for (const [id, o] of Object.entries(config.buildings)) {
    assert.ok(buildingById.has(id), `config.buildings.${id} is not a building`);
    for (const [k, v] of Object.entries(o)) {
      if (k === 'unlock') assert.equal(typeof v, 'function');
      else if (k === 'unlockAt') assert.equal(typeof v, 'object');
      else if (k === 'unlockHint') assert.equal(typeof v, 'string');
      else assert.ok(isNum(v) && v >= 0, `${id}.${k} finite and non-negative`);
    }
    if (isNum(o.baseCost)) assert.ok(o.baseCost > 0, `${id}.baseCost`);
    if (isNum(o.costGrowth)) assert.ok(o.costGrowth >= 1, `${id}.costGrowth`);
  }
  // Contract: late demand outpaces supply — tier-4 consumers draw more than the catalogue,
  // and no generator is scaled past the fusion ceiling.
  assert.ok(config.buildings.financial.powerUse >= 2000 && config.buildings.arcology.powerUse >= 1200);
  const fusionGen = config.buildings.fusion?.powerGen ?? buildingById.get('fusion').powerGen;
  assert.ok(fusionGen <= 3e5, 'fusion powerGen <= 3e5 MW');
  // Every population-gated override carries the UI mirror.
  for (const [id, o] of Object.entries(config.buildings)) {
    if (typeof o.unlock === 'function') {
      assert.ok(o.unlockAt && isNum(o.unlockAt.pop), `${id}: unlockAt.pop mirrors the rule`);
      assert.ok(o.unlock({ res: { pop: o.unlockAt.pop } }) === true && o.unlock({ res: { pop: o.unlockAt.pop - 1 } }) === false, `${id}: gate is exactly unlockAt.pop`);
      assert.doesNotThrow(() => o.unlock(undefined));
    }
  }
});

test('upgrade overrides name real upgrades and every cost is a positive number', () => {
  for (const [id, o] of Object.entries(config.upgrades)) {
    assert.ok(upgradeById.has(id), `config.upgrades.${id} is not an upgrade`);
    assert.ok(isNum(o.cost) && o.cost > 0, `${id}.cost`);
  }
});

test('charter perks: all twelve priced here, whole points, x2.5-4 apart from 3, opening at half price', () => {
  const perks = UPGRADES.filter((d) => d.currency === 'legacy');
  assert.equal(perks.length, 12);
  const costs = perks.map((d) => config.upgrades[d.id]?.cost);
  for (let i = 0; i < perks.length; i++) {
    assert.ok(Number.isInteger(costs[i]) && costs[i] >= 3, `${perks[i].id}: whole points >= 3`);
    if (i) {
      const r = costs[i] / costs[i - 1];
      assert.ok(r >= 2.5 - 1e-9 && r <= 4 + 1e-9, `${perks[i].id}: x${r.toFixed(2)} after ${perks[i - 1].id}`);
    }
  }
  assert.equal(costs[0], 3);
  assert.equal(CHARTER_GATE, 0.5);
  // The bot's legacy sequence (5 points, then +40% per founding) reaches the last perk's
  // price minus the spend before it by the 30th founding, so the whole charter is buyable
  // in a 12 h session. (Sequence: gain = max(5, ceil(minGainShare * legacy)).)
  const share = config.prestige.minGainShare;
  let legacy = 5;
  const bank = [legacy];
  for (let n = 1; n < 30; n++) {
    legacy += Math.max(5, Math.ceil(legacy * share));
    bank.push(legacy);
  }
  const spentBeforeLast = costs.slice(0, -1).reduce((a, b) => a + b, 0);
  assert.ok(bank[29] - spentBeforeLast >= costs[costs.length - 1], `Imperial Charter affordable by founding 30 (bank ${bank[29]}, spent ${spentBeforeLast})`);
  assert.ok(bank[29] <= 1e6, 'legacy at founding 30 stays under the 1e6 ceiling');
});

test('frontier ladder: eight rungs, config-owned, ascending in canonical order, earnings gate follows the price', () => {
  const order = ['dyson-swarm', 'quantum-exchange', 'mass-driver-port', 'ringworld-district', 'stellar-engine', 'galactic-charter', 'orbital-shipyard', 'exchange-ring'];
  assert.deepEqual(
    UPGRADES.filter((d) => d.frontier).map((d) => d.id),
    order,
    'the frontier ladder in upgrades/data.js is the eight rungs this config places'
  );
  const costs = order.map((id) => config.upgrades[id]?.cost);
  for (let i = 0; i < order.length; i++) {
    assert.ok(isNum(costs[i]) && costs[i] > 0, `${order[i]} priced in config`);
    if (i) assert.ok(costs[i] > costs[i - 1], `${order[i]} costs more than ${order[i - 1]}`);
  }
  assert.ok(costs[costs.length - 1] <= 1e16 * 10, 'the top rung stays two orders under the 1e18 money ceiling');
  assert.equal(FRONTIER_GATE, 0.25);
});

test('pace ladder and money-priced Legacy rungs are placed here, one price per rung, in city order', () => {
  // Pace rungs open once the city has earned 100× the price (or holds it): every one is
  // config-priced so the placement table in config.js is the shipped one.
  const pace = UPGRADES.filter((d) => d.pace).map((d) => d.id);
  assert.ok(pace.length >= 9, 'nine pace rungs');
  for (const id of pace) assert.ok(isNum(config.upgrades[id]?.cost), `${id} priced in config`);
  const price = (id) => config.upgrades[id].cost;
  // The placement table (config.js, upgrades block) in city order: every money rung is
  // dearer than the one placed in the city before it, so the bot meets them in this order.
  const cityOrder = [
    'breeder-reactors', // city 2
    'city-archives', // 4
    'championship-season', // 5
    'robotic-assembly', // 7
    'ai-governance', // 9
    'dyson-swarm', // 10
    'planetary-charter', // 12
    'quantum-exchange', // 13
    'megastructures', // 15
    'orbital-solar', // 16
    'arcology-gardens', // 18
    'algorithmic-trading', // 20
    'standing-orders', // 21
    'mass-driver-port', // 23
    'ringworld-district', // 24
    'stellar-engine', // 26
    'galactic-charter', // 27
    'superconductor-grid', // 29
    'orbital-shipyard', // 31
    'exchange-ring', // 32
  ];
  for (let i = 1; i < cityOrder.length; i++) assert.ok(price(cityOrder[i]) > price(cityOrder[i - 1]), `${cityOrder[i]} is placed after ${cityOrder[i - 1]}`);
  // The four replay accelerators are priced for the first two minutes of a 5–10 point
  // replay ($1,800–3,300 of seed cash, see prestige.startMoneyPerLegacy), in ladder order.
  assert.ok(price('legacy-archive') < price('founders-blueprints') && price('founders-blueprints') < price('veteran-planners') && price('veteran-planners') < price('dynasty-ledger'));
  assert.ok(price('dynasty-ledger') <= 50000, 'the Dynasty Ledger lands inside the first minutes of the second city');
  assert.ok(price('institutional-memory') > price('dynasty-ledger') && price('institutional-memory') < price('breeder-reactors'));
  // Seed cash scales with legacy so a 5-point replay can buy its way past the cottage
  // minute (5 points → $1,800), but stays irrelevant late (1e5 points → $3e7 against a
  // spree of 1e14+).
  assert.equal(config.prestige.startMoneyPerLegacy, 1);
});

test('tier-4 draw keeps late demand ahead of supply (under-power share >= 3% needs more than the x3 catalogue draw)', () => {
  assert.ok(config.buildings.arcology.powerUse >= 9000 && config.buildings.techpark.powerUse >= 16000);
  assert.ok(config.buildings.financial.powerUse >= 14000 && config.buildings.stadium.powerUse >= 5000);
  const fusionGen = config.buildings.fusion?.powerGen ?? buildingById.get('fusion').powerGen;
  assert.ok(fusionGen <= 3e5);
});

test('the core money ladder stays monotone from the first shop-priced rung to the top core rung', () => {
  // Overrides keep the early ladder cheap enough for the first minute and never invert a
  // tier: the cheapest tier-4 core rung is dearer than the dearest tier-1 rung.
  const priceOf = (d) => config.upgrades[d.id]?.cost ?? d.cost;
  const core = UPGRADES.filter((d) => !d.earnedGate && d.category !== 'prestige' && d.currency !== 'legacy');
  const t1 = core.filter((d) => d.tier === 1).map(priceOf);
  const t4 = core.filter((d) => d.tier === 4).map(priceOf);
  assert.ok(Math.max(...t1) < Math.min(...t4));
  assert.ok(config.upgrades['zoning-reform'].cost > config.buildings.shop.baseCost, 'the first $50 goes to the corner shop, not the reform');
  assert.ok(config.economy.startMoney >= config.buildings.shop.baseCost, 'seed cash covers the first shop');
});
