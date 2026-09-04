// Simulation — the heartbeat of Metropolis. DOM-free (runs in Node for the economy sim).
//
// Every tick (`simulate`, priority 0):
//   1. build a fresh mods bag and fold owned upgrades, latched milestones and prestige,
//   2. computeDerived (resources) with the balance config,
//   3. integrate money and population over dt, keep the stats honest,
//   4. latch milestones and dashboard gates, keep the city log lively.
// Actions: canPrestige, prestigeGain, prestige, tap, setSetting.
import { registry, registerTickHandler, registerAction } from '../core/registry.js';
import { addLog } from '../core/state.js';
import { createMods, sanitizeMods } from '../core/mods.js';
import { on, emit } from '../core/events.js';
import { reportError } from '../core/safe.js';
import { computeDerived } from '../resources/index.js';
import { config } from '../balance/config.js';
import { MILESTONES, REWARDED_MILESTONES, applyMilestoneMods, pendingMilestones, getMilestone, isMilestoneReached } from './milestones.js';
import {
  canPrestige as canPrestigeRule,
  prestigeGain as prestigeGainRule,
  performPrestige,
  applyPrestigeMods,
  startMoneyFor,
  legacyOf,
  nextLegacyAt,
} from './prestige.js';

export { MILESTONES, REWARDED_MILESTONES, getMilestone, isMilestoneReached, nextLegacyAt };

export const TICK_HANDLER = 'simulate';

// Dashboard gates the UI reads from state.unlocks. Each latches once per run.
const GATES = [
  {
    key: 'panel:power',
    log: 'The grid deserves its own report. Power panel added to the dashboard.',
    check: (state, derived) => derived.powerDemand > 0 || anyPowerBuildingUnlocked(state),
  },
  {
    key: 'panel:civic',
    log: 'Citizens have opinions now. Happiness is being tracked.',
    check: (state) => state.res.pop >= 15,
  },
  {
    key: 'panel:upgrades',
    log: 'City hall is taking proposals. Upgrades are available.',
    check: (state) => anyUpgradeUnlocked(state),
  },
  {
    key: 'panel:stats',
    log: 'The statistics office opens its doors. City stats added.',
    check: (state) => state.res.pop >= 100,
  },
  {
    key: 'panel:prestige',
    log: 'The council whispers about founding a new city. Legacy panel added.',
    check: (state) => state.stats.totalEarned >= prestigeThreshold() / 10,
  },
];

// Brownout log hysteresis: enter below this ratio, clear at full power, at most one line per window.
const BROWNOUT_ENTER = 0.95;
const BROWNOUT_LOG_COOLDOWN = 20; // game seconds
const PENDING_REFRESH_TICKS = 300; // safety net: resync milestone bookkeeping every 30 s

// Precomputed unlock keys (registry is populated before simulation init).
let powerBuildingKeys = [];
let upgradeKeys = [];

// Bookkeeping that is not part of the saved state.
let pending = []; // milestones not yet latched (list order)
let pendingDirty = true;
let inBrownout = false;
let lastBrownoutLogAt = -Infinity;
let installed = false;
let gameRef = null;

// --- helpers -----------------------------------------------------------------

function prestigeThreshold() {
  const t = config && config.prestige ? config.prestige.threshold : undefined;
  return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : 1e6;
}

function tapSeconds() {
  const t = config && config.economy ? config.economy.tapSeconds : undefined;
  return typeof t === 'number' && Number.isFinite(t) && t >= 0 ? t : 1;
}

function anyPowerBuildingUnlocked(state) {
  const u = state.unlocks;
  for (let i = 0; i < powerBuildingKeys.length; i++) if (u[powerBuildingKeys[i]]) return true;
  return false;
}

function anyUpgradeUnlocked(state) {
  const u = state.unlocks;
  for (let i = 0; i < upgradeKeys.length; i++) if (u[upgradeKeys[i]]) return true;
  for (const k in state.upgrades) if (state.upgrades[k]) return true;
  return false;
}

function isFreshState(state) {
  if (state.tick !== 0 || state.res.money !== 0 || state.res.pop !== 0) return false;
  for (const k in state.buildings) if (state.buildings[k] > 0) return false;
  return true;
}

function refreshKeys() {
  powerBuildingKeys = [];
  for (const id of registry.buildingOrder) {
    const def = registry.buildings.get(id);
    if (def && def.category === 'power') powerBuildingKeys.push('b:' + id);
  }
  upgradeKeys = registry.upgradeOrder.map((id) => 'u:' + id);
}

function refreshPending(state) {
  pending = pendingMilestones(state);
  pendingDirty = false;
}

// Seed a brand-new run with its starting treasury. Returns true when money was granted.
export function seedStartMoney(state) {
  if (!isFreshState(state)) return false;
  state.res.money = startMoneyFor(legacyOf(state));
  return true;
}

// --- mods fold -----------------------------------------------------------------

// Build this tick's modifier bag: upgrades, then milestones, then prestige.
export function foldMods(state) {
  const mods = createMods();
  mods.demand = 1;
  mods.inflow = 1; // read by resources (baseInflow scaling); not part of core's bag yet
  const order = registry.upgradeOrder;
  const owned = state.upgrades;
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    if (!owned[id]) continue;
    const def = registry.upgrades.get(id);
    if (def && def.effect) def.effect(mods, state); // guarded by registry
  }
  applyMilestoneMods(mods, state);
  applyPrestigeMods(mods, state);
  sanitizeMods(mods);
  if (!Number.isFinite(mods.inflow) || mods.inflow < 0) mods.inflow = 1;
  return mods;
}

// Recompute derived values without advancing time (after load, prestige, init).
export function recompute(state, derived) {
  const mods = foldMods(state);
  derived.mods = mods;
  computeDerived(state, derived, mods, config);
  return derived;
}

// --- integration -------------------------------------------------------------

function integrate(state, derived, dt) {
  const res = state.res;
  const stats = state.stats;

  const income = Number.isFinite(derived.income) ? derived.income : 0;
  const gross = Number.isFinite(derived.grossIncome) ? derived.grossIncome : 0;
  let money = res.money + income * dt;
  if (!(money > 0)) money = 0;
  res.money = money;

  const earned = gross > 0 ? gross * dt : 0;
  if (earned > 0) {
    stats.totalEarned += earned;
    state.prestige.lifetimeEarned = (Number.isFinite(state.prestige.lifetimeEarned) ? state.prestige.lifetimeEarned : 0) + earned;
  }

  const growth = Number.isFinite(derived.popGrowth) ? derived.popGrowth : 0;
  let pop = res.pop + growth * dt;
  // Growth is aimed at the housing gap; never overshoot into overcrowding within one step.
  if (growth > 0 && pop > derived.housing) pop = Math.max(res.pop, derived.housing);
  if (!(pop > 0)) pop = 0;
  res.pop = pop;
  if (pop > stats.peakPop) stats.peakPop = pop;
}

// --- milestones & gates --------------------------------------------------------

function checkMilestones(state, derived) {
  if (pendingDirty || (state.tick % PENDING_REFRESH_TICKS === 0)) refreshPending(state);
  const unlocks = state.unlocks;
  for (let i = 0; i < pending.length; i++) {
    const ms = pending[i];
    if (unlocks[ms.key]) {
      pending.splice(i, 1);
      i--;
      continue;
    }
    let reached = false;
    try {
      reached = ms.check(state, derived) === true;
    } catch (e) {
      reportError('milestone:' + ms.id, e);
      pending.splice(i, 1); // a broken check never blocks the loop
      i--;
      continue;
    }
    if (!reached) continue;
    unlocks[ms.key] = true;
    pending.splice(i, 1);
    i--;
    addLog(ms.rewardText ? `Milestone: ${ms.name} (${ms.rewardText})` : `Milestone: ${ms.name}`, 'milestone');
    emit('milestone', ms);
  }
}

function checkGates(state, derived) {
  const unlocks = state.unlocks;
  for (let i = 0; i < GATES.length; i++) {
    const g = GATES[i];
    if (unlocks[g.key]) continue;
    if (g.check(state, derived) !== true) continue;
    unlocks[g.key] = true;
    addLog(g.log, 'info');
    emit('unlock', { kind: 'panel', id: g.key });
  }
}

function watchGrid(state, derived) {
  const ratio = derived.powerRatio;
  if (!inBrownout) {
    if (derived.powerDemand > 0 && ratio < BROWNOUT_ENTER) {
      inBrownout = true;
      if (state.time - lastBrownoutLogAt >= BROWNOUT_LOG_COOLDOWN) {
        lastBrownoutLogAt = state.time;
        addLog(`Brownout. The grid is running at ${Math.round(ratio * 100)}%: income and growth are dimmed.`, 'brownout');
      }
    }
  } else if (ratio >= 1 || !(derived.powerDemand > 0)) {
    inBrownout = false;
    if (state.time - lastBrownoutLogAt >= BROWNOUT_LOG_COOLDOWN) {
      lastBrownoutLogAt = state.time;
      addLog('Power restored. Every window in the city lights up at once.', 'info');
    }
  }
}

// --- the tick ------------------------------------------------------------------

export function simulate(state, derived, dt) {
  const mods = foldMods(state);
  derived.mods = mods;
  computeDerived(state, derived, mods, config);
  integrate(state, derived, dt);
  checkMilestones(state, derived);
  checkGates(state, derived);
  watchGrid(state, derived);
}

// --- actions -------------------------------------------------------------------

function tap(state, derived) {
  const income = Number.isFinite(derived.income) ? derived.income : 0;
  const gain = Math.max(1, income * tapSeconds());
  state.res.money += gain;
  state.stats.totalEarned += gain;
  state.prestige.lifetimeEarned = (Number.isFinite(state.prestige.lifetimeEarned) ? state.prestige.lifetimeEarned : 0) + gain;
  state.stats.clicks = (Number.isFinite(state.stats.clicks) ? state.stats.clicks : 0) + 1;
  return gain;
}

const SETTINGS = {
  autosave: (v) => (typeof v === 'boolean' ? v : null),
  sfx: (v) => (typeof v === 'boolean' ? v : null),
  numFormat: (v) => (v === 'short' || v === 'full' ? v : null),
};

function setSetting(state, key, value) {
  const parse = SETTINGS[key];
  if (!parse) return false;
  const v = parse(value);
  if (v === null) return false;
  state.settings[key] = v;
  emit('setting', { key, value: v });
  return true;
}

function resetRunBookkeeping(state, derived) {
  inBrownout = false;
  lastBrownoutLogAt = -Infinity;
  pendingDirty = true;
  refreshKeys();
  recompute(state, derived);
}

// --- init ----------------------------------------------------------------------

export function init(game) {
  try {
    if (!game || !game.state || !game.derived) return;
    gameRef = game;
    const { state, derived } = game;
    refreshKeys();

    registerTickHandler(TICK_HANDLER, simulate, 0);

    registerAction('canPrestige', () => canPrestigeRule(state, config));
    registerAction('prestigeGain', () => prestigeGainRule(state, config));
    registerAction('prestige', () =>
      performPrestige(state, config, (s) => {
        resetRunBookkeeping(s, derived);
        addLog('Fresh ground, familiar hands. The first cottage goes up faster this time.', 'info');
      }),
    );
    registerAction('tap', () => tap(state, derived));
    registerAction('setSetting', (key, value) => setSetting(state, key, value));

    if (!installed) {
      installed = true;
      // Save/import/hard-reset rebuild the state in place; resync our bookkeeping and
      // make derived values current before the next frame renders.
      on('load', () => {
        try {
          const g = gameRef;
          if (!g) return;
          if (seedStartMoney(g.state)) {
            addLog('Welcome, Mayor. A plot of land, a small treasury, and big plans.', 'info');
          }
          resetRunBookkeeping(g.state, g.derived);
        } catch (e) {
          reportError('simulation:load', e);
        }
      });
    }

    if (seedStartMoney(state)) {
      addLog('Welcome, Mayor. A plot of land, a small treasury, and big plans.', 'info');
    }
    resetRunBookkeeping(state, derived);

    game.milestones = MILESTONES;
  } catch (e) {
    reportError('simulation:init', e);
  }
}
