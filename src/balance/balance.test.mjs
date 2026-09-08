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
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
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
    'dyson-swarm', // 4 (mid-city; the one frontier rung under the Quantum Exchange, priced where a saver reaches it in city 3)
    'championship-season', // 5
    'robotic-assembly', // 7
    'ai-governance', // 9
    'orbital-solar', // 10
    'planetary-charter', // 11
    'quantum-exchange', // 13
    'megastructures', // 15
    'arcology-gardens', // 16
    'algorithmic-trading', // 18
    'city-archives', // 19
    'standing-orders', // 21
    'mass-driver-port', // 22
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
  assert.ok(targets.underPowerMin >= 0.032 && targets.underPowerMax <= 0.19, 'under-power targets inside 3–20 %');
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
// tools/economy-sim.mjs is run from here, for both profiles, into a temp directory: the
// default profile (`--ticks 432000`) is held to every line of the late-game contract with no
// slack (docs/DESIGN.md: "each cycle from the 5th on <= 1.35x the previous") plus the safety
// margins in plan.json `targets`; the saver profile (`--saver`) is held to the hard gates
// (magnitudes, zero errors, no overflow/stall/magnitude issue), to the plan's magnitude
// margins and to a founding-count margin. Nothing here skips: a sim that cannot run, or a
// log that comes back short, is a failure, so the two-profile contract is enforced every
// time `npm test` runs (both runs are spawned at once and take ~30 s of wall time together).
// Committed logs (logs/sim-gauntlet.json, logs/sim-saver.json) are the integrator's record
// of the same two commands; they are not read here, so a stale or missing log can never
// pass or skip a gate.
const SIM = path.join(ROOT, 'tools/economy-sim.mjs');
const SIM_TICKS = 432000; // 12 game-hours, the contract's session
const PLAN_TARGETS = loadPlan(path.join(ROOT, 'src/balance/plan.json')).targets;
const RATIO_MAX = 1.35;
const RATIO_FROM = 4; // cycles[i] / cycles[i - 1] from the 5th founding (i = 4) on
const HARD = ['overflow', 'stall', 'magnitude'];

function runSim(profile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metropolis-balance-'));
  const out = path.join(dir, `sim-${profile}.json`);
  const args = [SIM, '--ticks', String(SIM_TICKS), '--out', out];
  if (profile === 'saver') args.push('--saver');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => resolve({ profile, error: String(err), stdout, stderr, log: null }));
    child.on('close', (code) => {
      let log = null;
      // The sim exits 1 on a FAIL line; that is a log to assert on, not a broken run.
      let error = code === 0 || code === 1 ? null : `exit ${code}`;
      try {
        log = JSON.parse(fs.readFileSync(out, 'utf-8'));
      } catch (e) {
        error = error || `no log written: ${e.message}`;
      }
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
      resolve({ profile, error, stdout, stderr, log });
    });
  });
}
// Both profiles at once (each sim is single-threaded), started when the file loads so the
// wall time is one sim, not two.
const SIM_RUNS = { default: runSim('default'), saver: runSim('saver') };

function usable(run) {
  assert.equal(run.error, null, `${run.profile} sim ran: ${run.error}\n${run.stderr.slice(0, 800)}`);
  const log = run.log;
  assert.ok(log && log.metrics && Array.isArray(log.metrics.cycles) && log.final, `${run.profile} log carries metrics and final`);
  assert.equal(log.profile, run.profile, 'the log is the requested profile');
  assert.ok(Number.isFinite(log.gameHours) && log.gameHours >= 12, `${run.profile} session is 12 h (${log.gameHours})`);
  return log;
}

function assertHardGates(log, label) {
  assert.deepEqual(log.errors, [], `${label}: zero errors`);
  assert.ok(log.final.maxMoney <= 1e18, `${label}: money peak ${log.final.maxMoney.toExponential(2)} <= 1e18`);
  assert.ok(log.final.legacy <= 1e6, `${label}: legacy ${log.final.legacy} <= 1e6`);
  assert.deepEqual(log.issues.filter((i) => HARD.includes(i.kind)), [], `${label}: no overflow/stall/magnitude issue`);
  assert.equal(log.pass, true, `${label}: the sim's own PASS line`);
}

for (const profile of ['saver', 'default']) {
  test(`12 h ${profile} profile (run here): magnitudes under the ceilings, zero errors, no hard issue`, async () => {
    const log = usable(await SIM_RUNS[profile]);
    assertHardGates(log, profile);
    // The plan's magnitude margins hold for both profiles: a saver that banks 1e6 - 1 points
    // passes the contract and fails on the next sibling retune.
    assert.ok(log.final.maxMoney <= PLAN_TARGETS.moneyMax, `${profile}: money peak ${log.final.maxMoney.toExponential(2)} inside the plan margin ${PLAN_TARGETS.moneyMax.toExponential(0)}`);
    assert.ok(log.final.legacy <= PLAN_TARGETS.legacyMax, `${profile}: legacy ${log.final.legacy} inside the plan margin ${PLAN_TARGETS.legacyMax.toExponential(0)}`);
  });
}

test('12 h saver profile (run here): the 36th founding, which crosses the legacy ceiling, lands past 12 h with margin', async () => {
  // The bot's bank is a fixed sequence per founding (5 points, then +40 % each), so the
  // ceilings flip at a founding count, not at a number: the 36th founding banks 1.04e6.
  // Margin is measured as the share of the session the saver would have to gain to make
  // that founding; the open 36th city has nothing new to buy, and a city with nothing new
  // reads x1.28–1.40 over the one before it on this content (config.js), so x1.25 of the
  // last completed cycle is a floor on its length. Shipped: the 36th founding lands ~730
  // min (config.js header), 1.3–1.6 % past the session; the line here is 1 %.
  const log = usable(await SIM_RUNS.saver);
  const cycles = log.metrics.cycles;
  assert.ok(cycles.length <= 35, `${cycles.length} foundings <= 35 (the 36th banks 1.04e6)`);
  if (cycles.length === 35) {
    const t35 = cycles.reduce((a, b) => a + b, 0);
    const earliest36 = t35 + cycles[cycles.length - 1] * 1.25;
    assert.ok(earliest36 >= 720 * 1.01, `36th founding no earlier than ${earliest36.toFixed(0)} min (>= ${(720 * 1.01).toFixed(0)})`);
  }
});

test('12 h default profile (run here): cadence and variety to the letter of the contract', async () => {
  const log = usable(await SIM_RUNS.default);
  assert.equal(log.contractPass, true, `the sim's own contract line: ${log.issues.map((i) => `[${i.kind}] ${i.msg}`).join(' | ')}`);
  const cycles = log.metrics.cycles;
  assert.ok(cycles.length >= 18 && cycles.length <= 35, `${cycles.length} foundings in 18-35`);
  assert.ok(cycles[0] >= 30 && cycles[0] <= 45, `first founding ${cycles[0]} min in 30-45`);
  const floor = Math.min(...cycles.slice(3, 10));
  assert.ok(floor >= 4 && floor <= 8, `floor ${floor} min (foundings 4-10) in 4-8`);
  assert.ok(cycles[cycles.length - 1] <= 40, `last cycle ${cycles[cycles.length - 1]} min <= 40`);
  const over = [];
  for (let i = RATIO_FROM; i < cycles.length; i++) if (cycles[i] > cycles[i - 1] * RATIO_MAX) over.push(`${i}: ${cycles[i - 1]} -> ${cycles[i]} (x${(cycles[i] / cycles[i - 1]).toFixed(3)})`);
  assert.deepEqual(over, [], `every cycle from the 5th founding <= ${RATIO_MAX}x the previous, no slack`);
  assert.deepEqual(log.metrics.emptyLateCycles, [], 'every city after the 5th introduces something new');
  assert.deepEqual(log.metrics.neverPurchased, { buildings: [], upgrades: [] }, 'every building and upgrade bought');
  assert.ok(log.metrics.reachShare >= 0.3, `reach ${log.metrics.reachShare} >= 0.3`);
  assert.ok(log.metrics.underPowerShare >= 0.03 && log.metrics.underPowerShare <= 0.2, `under-power ${log.metrics.underPowerShare} in 3-20%`);
  assert.ok(log.metrics.minPowerRatio >= 0.6, 'power floor >= 0.6');
  assert.ok(log.metrics.happinessDipCities >= cycles.length * 0.5, `happiness dips ${log.metrics.happinessDipCities}/${cycles.length}`);
});

test('12 h default profile (run here): inside the plan.json safety margins', async () => {
  const log = usable(await SIM_RUNS.default);
  const checks = checkTargets(fromSimLog(log), PLAN_TARGETS);
  assert.ok(checks.length >= 8, 'the plan names the margins');
  assert.deepEqual(checks.filter((c) => !c.ok), [], formatChecks(checks));
});
