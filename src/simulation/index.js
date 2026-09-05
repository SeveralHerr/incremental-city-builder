// Simulation — the heartbeat of Metropolis. DOM-free (runs in Node for the economy sim).
//
// Every tick (`simulate`, priority 0):
//   1. build a fresh mods bag and fold owned upgrades, latched milestones and prestige,
//   2. computeDerived (resources) with the balance config,
//   3. integrate money and population over dt, keep the stats honest,
//   4. latch milestones and dashboard gates, keep the city log lively,
//   5. refresh derived.extra.prestige (legacy, gain, can, next targets) for the dashboard.
// Actions: canPrestige, prestigeGain, prestige, tap, setSetting. Events: milestone, unlock,
// prestige, tap, setting, brownout ({ active, ratio } on both grid transitions). The
// prestige rules live in prestige.js, the goals in milestones.js, every config knob read
// here in tuning.js (resolved once and shared, so the tick allocates nothing but the mods
// bag).
import { registry, registerTickHandler, registerAction } from '../core/registry.js';
import { addLog } from '../core/state.js';
import { createMods, sanitizeMods } from '../core/mods.js';
import { on, emit } from '../core/events.js';
import { reportError } from '../core/safe.js';
import { computeDerived } from '../resources/index.js';
import { config } from '../balance/config.js';
import {
  MILESTONES,
  REWARDED_MILESTONES,
  applyMilestoneMods,
  pendingMilestones,
  getMilestone,
  isMilestoneReached,
  isBrownout,
  LEGACY_MILESTONES,
  nextLegacyMilestone,
} from './milestones.js';
import {
  canPrestige as canPrestigeRule,
  prestigeGain as prestigeGainRule,
  performPrestige,
  applyPrestigeMods,
  startMoneyFor,
  legacyOf,
  nextLegacyAt,
  earningsForLegacy,
  prestigeUnlockAt,
  legacyIncomeMult,
  prestigeConfig,
  prestigeStatus,
  ripeness,
  foundingLine,
} from './prestige.js';
import { economyTuning, prestigeTuning } from './tuning.js';

export {
  MILESTONES,
  REWARDED_MILESTONES,
  LEGACY_MILESTONES,
  getMilestone,
  isMilestoneReached,
  isBrownout,
  nextLegacyMilestone,
  nextLegacyAt,
  earningsForLegacy,
  prestigeUnlockAt,
  legacyIncomeMult,
  prestigeConfig,
  prestigeStatus,
  ripeness,
  foundingLine,
};

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
    // A mayor with a bank keeps the panel from the first second of every replay.
    check: (state) => state.stats.totalEarned >= prestigeTuning(config).threshold / 10 || legacyOf(state) > 0,
  },
];

// Brownout log hysteresis: enter below this ratio, clear at full power. The entry line is
// rate-limited (a grid flickering around capacity would otherwise spam the log); the
// recovery line is logged whenever the entry was, so a logged brownout always resolves in
// the log. Both transitions emit 'brownout' regardless of the log cooldown.
const BROWNOUT_ENTER = 0.95;
const BROWNOUT_LOG_COOLDOWN = 20; // game seconds between logged entries
const PENDING_REFRESH_TICKS = 300; // safety net: resync milestone bookkeeping every 30 s
const PRESTIGE_TARGETS_EVERY = 5; // unlockAt/nextAt bisections: twice a second is plenty

// Precomputed unlock keys (registry is populated before simulation init).
let powerBuildingKeys = [];
let upgradeKeys = [];

// Bookkeeping that is not part of the saved state.
let pending = []; // milestones not yet latched (list order)
let pendingDirty = true;
let inBrownout = false;
let brownoutLogged = false; // the current brownout got its log line
let lastBrownoutLogAt = -Infinity;
let installed = false;
let gameRef = null;

// --- helpers -----------------------------------------------------------------

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

// derived.extra.prestige: { legacy, gain, can, minGain, unlockAt, nextAt, lifetimeEarned,
// maturity, mult, multAfter, startMoneyAfter, nextTierName, nextTierAt } — the prestige
// situation for the dashboard ("found a new city at $unlockAt", a bar that fills toward it,
// "next tier: Living Archive at 5,000 legacy") without calling actions. The two earnings
// targets are bisections, so they refresh every PRESTIGE_TARGETS_EVERY ticks; the rest
// every tick.
function ensurePrestigeExtra(derived) {
  let x = derived.extra;
  if (!x || typeof x !== 'object') x = derived.extra = {};
  let p = x.prestige;
  if (!p || typeof p !== 'object') {
    p = x.prestige = {
      legacy: 0,
      gain: 0,
      can: false,
      minGain: 1,
      unlockAt: 0,
      nextAt: 0,
      lifetimeEarned: 0,
      maturity: 0,
      mult: 1,
      multAfter: 1,
      startMoneyAfter: 0,
      nextTierName: '',
      nextTierAt: 0,
    };
  }
  return p;
}

// Recompute derived values without advancing time (after load, prestige, init).
export function recompute(state, derived) {
  const mods = foldMods(state);
  derived.mods = mods;
  computeDerived(state, derived, mods, config);
  prestigeStatus(state, ensurePrestigeExtra(derived), config);
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
  // Per-run best gross income: prestige measures a city's maturity against it.
  if (!(gross <= stats.peakIncome)) stats.peakIncome = gross > 0 ? gross : 0;

  const growth = Number.isFinite(derived.popGrowth) ? derived.popGrowth : 0;
  let pop = res.pop + growth * dt;
  // Growth is aimed at the housing gap; never overshoot into overcrowding within one step.
  if (growth > 0 && pop > derived.housing) pop = Math.max(res.pop, derived.housing);
  if (!(pop > 0)) pop = 0;
  res.pop = pop;
  if (pop > stats.peakPop) stats.peakPop = pop;
}

// --- milestones & gates --------------------------------------------------------

// Milestones re-latch every run. The ones a veteran re-collects in the first second of a
// replay (legacy tiers, founding counts) carry over rather than happen: they latch (the
// rewards fold, the panel shows them reached) without a log line or a 'milestone' event, so
// a founding does not announce twelve old trophies again. A tier crossed by *this* founding
// (the bank just passed it, or the founding count just reached it) is news and still fires.
const CARRY_OVER_WINDOW = 1; // game seconds
let legacyBefore = 0; // the bank before the latest founding (or at load: the whole bank)

// Record the bank a founding started from, so the tiers it crosses are announced.
export function markFounding(before) {
  legacyBefore = Number.isFinite(before) && before > 0 ? before : 0;
}

function justHappened(ms, state) {
  if (ms.metric === 'prestiges') return state.stats.prestiges === ms.target;
  if (ms.metric === 'legacy') return legacyBefore < ms.target;
  return true;
}

function checkMilestones(state, derived) {
  if (pendingDirty || (state.tick % PENDING_REFRESH_TICKS === 0)) refreshPending(state);
  const unlocks = state.unlocks;
  const replayStart = state.stats.prestiges > 0 && state.time < CARRY_OVER_WINDOW;
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
    if (replayStart && !justHappened(ms, state)) continue;
    addLog(ms.rewardText ? `Milestone: ${ms.name} (${ms.rewardText})` : `Milestone: ${ms.name}`, 'milestone');
    emit('milestone', ms);
  }
}

// Gates re-latch every run (unlocks reset on founding) so the UI can keep reading them, but
// the "panel added" story lines belong to the first city only: a veteran's dashboard
// reopening in the first seconds of a replay is not news.
function checkGates(state, derived) {
  const unlocks = state.unlocks;
  const firstCity = !(state.stats.prestiges > 0);
  for (let i = 0; i < GATES.length; i++) {
    const g = GATES[i];
    if (unlocks[g.key]) continue;
    if (g.check(state, derived) !== true) continue;
    unlocks[g.key] = true;
    if (firstCity) addLog(g.log, 'info');
    emit('unlock', { kind: 'panel', id: g.key });
  }
}

// Same "a grid must exist" predicate as the Lights Out milestone: the first cottage draws
// power before any generator can be bought, and that is not a brownout worth a log line.
function watchGrid(state, derived) {
  const ratio = derived.powerRatio;
  if (!inBrownout) {
    if (isBrownout(derived) && ratio < BROWNOUT_ENTER) {
      inBrownout = true;
      brownoutLogged = state.time - lastBrownoutLogAt >= BROWNOUT_LOG_COOLDOWN;
      if (brownoutLogged) {
        lastBrownoutLogAt = state.time;
        addLog(`Brownout. The grid is running at ${Math.round(ratio * 100)}%: income and growth are dimmed.`, 'brownout');
      }
      emit('brownout', { active: true, ratio });
    }
  } else if (ratio >= 1 || !(derived.powerDemand > 0)) {
    inBrownout = false;
    if (brownoutLogged) {
      brownoutLogged = false;
      addLog('Power restored. Every window in the city lights up at once.', 'info');
    }
    emit('brownout', { active: false, ratio });
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
  prestigeStatus(state, ensurePrestigeExtra(derived), config, state.tick % PRESTIGE_TARGETS_EVERY === 0);
}

// --- actions -------------------------------------------------------------------

function tap(state, derived) {
  const income = Number.isFinite(derived.income) ? derived.income : 0;
  const gain = Math.max(1, income * economyTuning(config).tapSeconds);
  state.res.money += gain;
  state.stats.totalEarned += gain;
  state.prestige.lifetimeEarned = (Number.isFinite(state.prestige.lifetimeEarned) ? state.prestige.lifetimeEarned : 0) + gain;
  state.stats.clicks = (Number.isFinite(state.stats.clicks) ? state.stats.clicks : 0) + 1;
  emit('tap', { gain, clicks: state.stats.clicks });
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
  brownoutLogged = false;
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
    registerAction('prestige', () => {
      const before = legacyOf(state);
      return performPrestige(state, config, (s) => {
        markFounding(before);
        resetRunBookkeeping(s, derived);
      });
    });
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
          markFounding(legacyOf(g.state)); // a loaded bank's tiers are all old news
          resetRunBookkeeping(g.state, g.derived);
        } catch (e) {
          reportError('simulation:load', e);
        }
      });
    }

    if (seedStartMoney(state)) {
      addLog('Welcome, Mayor. A plot of land, a small treasury, and big plans.', 'info');
    }
    markFounding(legacyOf(state));
    resetRunBookkeeping(state, derived);

    game.milestones = MILESTONES;
  } catch (e) {
    reportError('simulation:init', e);
  }
}
