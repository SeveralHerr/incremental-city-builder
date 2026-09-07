// Balance config contract: node src/balance/balance.test.mjs
//
// Pins the *shape* of src/balance/config.js against what its consumers read — the
// simulation's prestige knobs and bounds, the buildings/upgrades override tables (every id
// must exist), the charter-perk and frontier ladders the late-game contract asks for, and
// the first-tick power floor. Pacing numbers themselves are measured by
// tools/economy-sim.mjs, not asserted here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config, costGrowthFor } from './config.js';
import { init } from './index.js';
import { prestigeTuning, economyTuning, milestoneTuning, foundingTuning, LEGACY_POWER_MAX, SEED_SECONDS_MAX } from '../simulation/tuning.js';
import { normalizeGrowth, growthFactor } from '../buildings/index.js';
import { loadPlan, checkTargets, fromSimLog, formatChecks } from './targets.mjs';
import { UPGRADES, CHARTER_GATE, FRONTIER_GATE } from '../upgrades/data.js';
import { BUILDINGS } from '../buildings/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
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

test('founding: the replay seed window and the earnings ramp are config-owned and resolve verbatim', () => {
  // src/simulation/tuning.js foundingTuning reads config.founding when present (its own
  // DEFAULTS are the fallback for a config without the section); the shipped window is
  // what the placed ladder is measured against, so it must be here and inside the bounds.
  assert.ok(config.founding && typeof config.founding === 'object', 'config.founding present');
  assert.ok(isNum(config.founding.seedSeconds) && config.founding.seedSeconds >= 0 && config.founding.seedSeconds <= SEED_SECONDS_MAX, 'seedSeconds inside [0, SEED_SECONDS_MAX]');
  assert.ok(isNum(config.founding.marginRamp) && config.founding.marginRamp >= 0 && config.founding.marginRamp <= 1, 'marginRamp inside [0, 1]');
  const f = foundingTuning(config);
  assert.equal(f.seedSeconds, config.founding.seedSeconds);
  assert.equal(f.marginRamp, config.founding.marginRamp);
});

test('building overrides name real buildings and keep the catalogue sane', () => {
  for (const [id, o] of Object.entries(config.buildings)) {
    assert.ok(buildingById.has(id), `config.buildings.${id} is not a building`);
    for (const [k, v] of Object.entries(o)) {
      if (k === 'unlock') assert.equal(typeof v, 'function');
      else if (k === 'unlockAt') assert.equal(typeof v, 'object');
      else if (k === 'unlockHint') assert.equal(typeof v, 'string');
      else if (k === 'demandGrowth') {
        // Grid strain: powerUse = base × min(cap, 1 + (count − 1) / per), validated by the
        // buildings module's own rule (a malformed rule would be reported and ignored there).
        const rule = normalizeGrowth(v);
        assert.ok(rule, `${id}.demandGrowth is a valid { per, cap, text } rule`);
        assert.ok(rule.cap > 1 && rule.per > 0, `${id}.demandGrowth grows`);
        assert.ok(typeof v.text === 'string' && v.text.length > 0 && v.text.length <= 70, `${id}.demandGrowth.text is the card line`);
      } else assert.ok(isNum(v) && v >= 0, `${id}.${k} finite and non-negative`);
    }
    if (isNum(o.baseCost)) assert.ok(o.baseCost > 0, `${id}.baseCost`);
    if (isNum(o.costGrowth)) assert.ok(o.costGrowth >= 1, `${id}.costGrowth`);
  }
  // Contract: late demand outpaces supply — tier-4 consumers draw more than the catalogue,
  // and no generator is scaled past the fusion ceiling.
  assert.ok(config.buildings.financial.powerUse >= 2000 && config.buildings.arcology.powerUse >= 1200);
  const fusionGen = config.buildings.fusion?.powerGen ?? buildingById.get('fusion').powerGen;
  assert.ok(fusionGen <= 3e5, 'fusion powerGen <= 3e5 MW');
  // Every gated override carries the UI mirror: a population gate (`unlockAt.pop`) or, for
  // the tier-5 megastructures, a legacy gate (`unlockAt.legacy`), and the rule is exactly it.
  for (const [id, o] of Object.entries(config.buildings)) {
    if (typeof o.unlock === 'function') {
      assert.ok(o.unlockAt && (isNum(o.unlockAt.pop) || isNum(o.unlockAt.legacy)), `${id}: unlockAt mirrors the rule`);
      if (isNum(o.unlockAt.pop)) assert.ok(o.unlock({ res: { pop: o.unlockAt.pop } }) === true && o.unlock({ res: { pop: o.unlockAt.pop - 1 } }) === false, `${id}: gate is exactly unlockAt.pop`);
      else assert.ok(o.unlock({ prestige: { legacy: o.unlockAt.legacy } }) === true && o.unlock({ prestige: { legacy: o.unlockAt.legacy - 1 } }) === false, `${id}: gate is exactly unlockAt.legacy`);
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
  // price minus the spend before it by the 31st founding — the Imperial Charter is city
  // 32's item, deliberately not city 30's (its ×3 is the tail brake: signed in city 30 the
  // session runs 36 foundings and crosses the legacy ceiling) — so the whole charter is
  // buyable in a 12 h session. (Sequence: gain = max(5, ceil(minGainShare * legacy)).)
  const share = config.prestige.minGainShare;
  let legacy = 5;
  const bank = [legacy];
  for (let n = 1; n < 32; n++) {
    legacy += Math.max(5, Math.ceil(legacy * share));
    bank.push(legacy);
  }
  const spentBeforeLast = costs.slice(0, -1).reduce((a, b) => a + b, 0);
  assert.ok(bank[30] - spentBeforeLast < costs[costs.length - 1], `Imperial Charter not yet affordable at founding 31 (bank ${bank[30]}, spent ${spentBeforeLast})`);
  assert.ok(bank[31] - spentBeforeLast >= costs[costs.length - 1], `Imperial Charter affordable by founding 32 (bank ${bank[31]}, spent ${spentBeforeLast})`);
  assert.ok(bank[31] <= 1e6, 'legacy at founding 32 stays under the 1e6 ceiling');
});

test('frontier ladder: nine rungs, config-owned, ascending in canonical order, earnings gate follows the price', () => {
  const order = ['dyson-swarm', 'quantum-exchange', 'mass-driver-port', 'ringworld-district', 'stellar-engine', 'galactic-charter', 'orbital-shipyard', 'helios-array', 'exchange-ring'];
  assert.deepEqual(
    UPGRADES.filter((d) => d.frontier).map((d) => d.id),
    order,
    'the frontier ladder in upgrades/data.js is the nine rungs this config places'
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
    'breeder-reactors', // city 1 (second city)
    'institutional-memory', // 3
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
    'superconductor-grid', // 27
    'galactic-charter', // 28 (with the Energy Charter)
    'orbital-shipyard', // 29
    'helios-array', // 30
    'exchange-ring', // 31, the last rung (the Imperial Charter is city 32's novelty, the Space Elevator city 33's; city 34 is open at 12 h)
  ];
  for (let i = 1; i < cityOrder.length; i++) assert.ok(price(cityOrder[i]) > price(cityOrder[i - 1]), `${cityOrder[i]} is placed after ${cityOrder[i - 1]}`);
  // The four replay accelerators are priced for the first two minutes of a 5–10 point
  // replay ($1,800–3,300 of seed cash, see prestige.startMoneyPerLegacy), in ladder order.
  assert.ok(price('legacy-archive') < price('founders-blueprints') && price('founders-blueprints') < price('veteran-planners') && price('veteran-planners') < price('dynasty-ledger'));
  assert.ok(price('dynasty-ledger') <= 50000, 'the Dynasty Ledger lands inside the first minutes of the second city');
  // Institutional Memory is priced above the second city's plateau so it lands in the third
  // city (with the Mint Charter) and its founding re-grant reaches the fourth: that is what
  // keeps the fourth city from reading ×1.4 over the third (see config.js, Legacy rungs).
  assert.ok(price('institutional-memory') > price('breeder-reactors') && price('institutional-memory') < price('city-archives'));
  // Seed cash scales with legacy so a 5-point replay can buy its way past the cottage
  // minute (5 points → $1,800), but stays irrelevant late (1e5 points → $3e7 against a
  // spree of 1e14+).
  assert.equal(config.prestige.startMoneyPerLegacy, 1);
});

test('tier-4 draw keeps late demand ahead of supply (under-power share >= 3% needs more than the x3 catalogue draw)', () => {
  // The draw is sticker × grid strain (buildings module growthFactor). A first-city fleet of
  // 15 units must draw at least the flat 3.2–3.8× catalogue figures the first pass shipped
  // (arcology 9,000 / campus 16,000 / district 14,000 / stadium 5,000 MW per unit), and a
  // late fleet of 250 must draw an order of magnitude more per unit than that.
  const draw = (id, n) => config.buildings[id].powerUse * growthFactor(config.buildings[id].demandGrowth, n);
  assert.ok(draw('arcology', 15) >= 9000 && draw('techpark', 15) >= 16000, 'first-city arcology / campus draw');
  assert.ok(draw('financial', 15) >= 14000 && draw('stadium', 15) >= 5000, 'first-city district / stadium draw');
  for (const id of ['arcology', 'techpark', 'financial', 'stadium']) assert.ok(draw(id, 250) >= 10 * draw(id, 15), `${id}: a 250-unit fleet draws 10× per unit what 15 do`);
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

test('placement tools: probe.mjs and place.mjs parse, and plan.json names priced rungs in the shipped city order', () => {
  for (const f of ['probe.mjs', 'place.mjs']) {
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, 'src/balance', f)], { encoding: 'utf-8' });
    assert.equal(r.status, 0, `${f} parses: ${r.stderr}`);
  }
  const { targets, rungs: plan } = loadPlan(path.join(ROOT, 'src/balance/plan.json'));
  assert.ok(Array.isArray(plan) && plan.length >= 15, 'a plan step per late rung');
  // The safety-margin targets sit strictly inside every hard gate of the contract, so a
  // ladder that meets them has room for a retune elsewhere before any gate is at risk.
  for (const [k, v] of Object.entries(targets)) assert.ok(isNum(v) && v > 0, `targets.${k} is a positive number`);
  assert.ok(targets.firstFoundMax <= 44 && targets.firstFoundMin >= 30, 'first founding targets inside 30–45');
  // ×1.345: the Space Elevator's city after the Imperial Charter's ×3 reads ×1.34 on the
  // shipped content (a nil building after a felt perk), 0.7% under the gate.
  assert.ok(targets.ratioMax <= 1.345, 'ratio target inside the 1.35 gate');
  // The contract caps the *last* cycle at 40 min; cycleMax is this file's own line on any
  // cycle after the first city (a nil-rung city after a nil-rung city reads ×1.3 of a 38 min
  // predecessor on the shipped content), so it sits above the gate on the last cycle.
  assert.ok(targets.lastCycleMax <= 39 && targets.cycleMax <= 50, 'cycle targets: the last cycle inside the 40 min gate, every cycle inside 50');
  assert.ok(targets.underPowerMin >= 0.035 && targets.underPowerMax <= 0.19, 'under-power targets inside 3–20 %');
  assert.ok(targets.reachMin >= 0.32 && targets.dipShareMin >= 0.52, 'reach and dip targets inside the gates');
  assert.ok(targets.moneyMax <= 1e18 && targets.legacyMax <= 1e6, 'magnitude targets inside the ceilings');
  assert.ok(targets.foundingsMin >= 18 && targets.foundingsMax <= 35, 'founding-count targets inside 18–35');
  let lastCity = 0;
  for (const step of plan) {
    assert.ok(upgradeById.has(step.id), `plan: ${step.id} is an upgrade`);
    assert.ok(isNum(config.upgrades[step.id]?.cost), `plan: ${step.id} is priced in config`);
    assert.ok(Number.isInteger(step.city) && step.city >= lastCity, `plan: ${step.id} in city order`);
    assert.ok(step.mode === undefined || step.mode === 'spree' || step.mode === 'mid', `plan: ${step.id} mode`);
    lastCity = step.city;
  }
  // The plan's city order and the config's price order agree for money rungs (the bot meets
  // rungs in price order, so a plan that lists a dearer rung in an earlier city is unplaceable).
  const money = plan.filter((s) => upgradeById.get(s.id).currency !== 'legacy');
  for (let i = 1; i < money.length; i++) {
    if (money[i].city > money[i - 1].city) assert.ok(config.upgrades[money[i].id].cost > config.upgrades[money[i - 1].id].cost, `${money[i].id} is dearer than ${money[i - 1].id}`);
  }
});

// ---- measured cadence: the sim's own numbers, held to the contract's letter (no slack) ----
//
// tools/economy-sim.mjs allows each cycle 1.35× the previous *plus 30 s* and only checks
// from the 6th founding; docs/DESIGN.md says "each cycle ≤ 1.35× the previous". This
// pins the shipped 12 h logs to the literal contract from the 5th founding on, so a retune
// that passes the sim by a second of slack still fails here. Logs are produced by
// `node tools/economy-sim.mjs --ticks 432000 [--saver] --out logs/<name>.json`; a log that
// is missing is skipped (the sim is not run from the test), a log from a shorter session
// is ignored, and both profiles are held to the magnitude ceilings.
// logs/sim-gauntlet.json and logs/sim-saver.json are the integrator's two committed
// profiles; logs/sim-fix-balance-12h*.json are this pass's own 12 h runs of the same two
// commands (`--ticks 432000 [--saver]`). A saver log is held to the magnitude ceilings
// and zero errors like any other; on the final-gate tree the 30 s saver crosses both
// ceilings (config.js header), so a committed saver log from that tree fails here on
// purpose until the late content grows.
const SIM_LOGS = ['logs/sim-gauntlet.json', 'logs/sim-saver.json', 'logs/sim-fix-balance-12h.json', 'logs/sim-fix-balance-12h-saver.json'];
const CONFIG_MTIME = fs.statSync(path.join(ROOT, 'src/balance/config.js')).mtimeMs;
const PLAN_TARGETS = loadPlan(path.join(ROOT, 'src/balance/plan.json')).targets;
const RATIO_MAX = 1.35;
const RATIO_FROM = 4; // cycles[i] / cycles[i - 1] from the 5th founding (i = 4) on
function readLog(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
  } catch {
    return null;
  }
}
function logIsCurrent(rel) {
  try {
    return fs.statSync(path.join(ROOT, rel)).mtimeMs >= CONFIG_MTIME;
  } catch {
    return false;
  }
}
for (const rel of SIM_LOGS) {
  const log = readLog(rel);
  const usable = log && Number.isFinite(log.gameHours) && log.gameHours >= 12 && log.metrics && Array.isArray(log.metrics.cycles);
  test(`measured 12 h session (${rel}): magnitudes under the ceilings, zero errors`, { skip: usable ? false : `${rel} not present or shorter than 12 h` }, () => {
    assert.equal(log.errors.length, 0, 'zero errors');
    assert.ok(log.final.maxMoney <= 1e18, `money peak ${log.final.maxMoney.toExponential(2)} <= 1e18`);
    assert.ok(log.final.legacy <= 1e6, `legacy ${log.final.legacy} <= 1e6`);
    assert.equal(log.issues.filter((i) => ['overflow', 'stall', 'magnitude'].includes(i.kind)).length, 0, 'no hard issues');
  });
  test(`measured 12 h session (${rel}): cadence and variety to the letter of the contract`, { skip: !usable ? `${rel} not present or shorter than 12 h` : log.profile !== 'default' ? 'only the default profile is held to the cadence numbers' : false }, () => {
    const cycles = log.metrics.cycles;
    assert.ok(cycles.length >= 18 && cycles.length <= 35, `${cycles.length} foundings in 18–35`);
    assert.ok(cycles[0] >= 30 && cycles[0] <= 45, `first founding ${cycles[0]} min in 30–45`);
    const floor = Math.min(...cycles.slice(3, 10));
    assert.ok(floor >= 4 && floor <= 8, `floor ${floor} min (foundings 4–10) in 4–8`);
    assert.ok(cycles[cycles.length - 1] <= 40, `last cycle ${cycles[cycles.length - 1]} min <= 40`);
    const over = [];
    for (let i = RATIO_FROM; i < cycles.length; i++) if (cycles[i] > cycles[i - 1] * RATIO_MAX) over.push(`${i}: ${cycles[i - 1]} -> ${cycles[i]} (x${(cycles[i] / cycles[i - 1]).toFixed(3)})`);
    assert.deepEqual(over, [], `every cycle from the 5th founding <= ${RATIO_MAX}x the previous, no slack`);
    assert.deepEqual(log.metrics.emptyLateCycles, [], 'every city after the 5th introduces something new');
    assert.deepEqual(log.metrics.neverPurchased, { buildings: [], upgrades: [] }, 'every building and upgrade bought');
    assert.ok(log.metrics.reachShare >= 0.3, `reach ${log.metrics.reachShare} >= 0.3`);
    assert.ok(log.metrics.underPowerShare >= 0.03 && log.metrics.underPowerShare <= 0.2, `under-power ${log.metrics.underPowerShare} in 3–20%`);
    assert.ok(log.metrics.minPowerRatio >= 0.6, 'power floor >= 0.6');
    assert.ok(log.metrics.happinessDipCities >= cycles.length * 0.5, `happiness dips ${log.metrics.happinessDipCities}/${cycles.length}`);
  });
  // The safety margins (plan.json targets) are asserted only on a log produced after the
  // last config edit: an older log measured a different ladder and is held to the contract
  // above, not to this pass's margins.
  const current = usable && log.profile === 'default' && logIsCurrent(rel);
  test(`measured 12 h session (${rel}): inside the plan.json safety margins`, { skip: !usable ? `${rel} not present or shorter than 12 h` : log.profile !== 'default' ? 'only the default profile is held to the margins' : !current ? `${rel} predates src/balance/config.js` : false }, () => {
    const checks = checkTargets(fromSimLog(log), PLAN_TARGETS);
    assert.ok(checks.length >= 8, 'the plan names the margins');
    assert.deepEqual(checks.filter((c) => !c.ok), [], formatChecks(checks));
  });
}
