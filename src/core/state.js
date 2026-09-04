// Shared game state. Plain, serializable, mutated in place (never replace identity).
// DOM-free.

export const STATE_VERSION = 1;

export function createInitialState() {
  return {
    version: STATE_VERSION,
    tick: 0,
    time: 0,
    res: { money: 0, pop: 0 },
    buildings: {},
    upgrades: {},
    unlocks: {},
    stats: { totalEarned: 0, peakPop: 0, buildingsBuilt: 0, prestiges: 0, playtime: 0, clicks: 0 },
    prestige: { legacy: 0, spent: 0, lifetimeEarned: 0 },
    settings: { autosave: true, numFormat: 'short', sfx: true },
    log: [],
  };
}

export const state = createInitialState();

// Recomputed every tick by simulation. NOT saved.
export const derived = {
  housing: 0,
  jobs: 0,
  employed: 0,
  powerCap: 0,
  powerDemand: 0,
  powerRatio: 1,
  happiness: 1,
  income: 0,
  grossIncome: 0,
  upkeep: 0,
  popGrowth: 0,
  costMult: 1,
  mods: null,
  // free-form extras for UI (e.g. breakdowns). Modules may add keys; never remove.
  extra: {},
};

// Runtime error log (not saved). { t, module, msg, stack }
export const errors = [];

const MAX_LOG = 60;

export function addLog(msg, kind = 'info') {
  state.log.push({ t: state.time, msg: String(msg), kind });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// Deep-merge `src` into `dst` for plain objects; arrays and primitives replaced.
function mergeInto(dst, src) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (isObj(v) && isObj(dst[k])) mergeInto(dst[k], v);
    else dst[k] = Array.isArray(v) ? v.slice() : v;
  }
}

// Replace state contents with `obj` (missing fields get defaults). Keeps identity.
export function loadState(obj) {
  const fresh = createInitialState();
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, fresh);
  if (obj && typeof obj === 'object') mergeInto(state, obj);
  sanitize();
  return state;
}

// Fresh run. keep: { prestige, settings, stats } chooses what survives.
export function resetState({ keepPrestige = true, keepSettings = true, keepStats = true } = {}) {
  const prestige = keepPrestige ? { ...state.prestige } : undefined;
  const settings = keepSettings ? { ...state.settings } : undefined;
  const stats = keepStats
    ? { ...state.stats, buildingsBuilt: 0, peakPop: 0 }
    : undefined;
  loadState({});
  if (prestige) state.prestige = prestige;
  if (settings) state.settings = settings;
  if (stats) state.stats = stats;
  return state;
}

// Clamp NaN/Infinity/negatives that would poison the sim.
export function sanitize() {
  for (const k of Object.keys(state.res)) {
    const v = state.res[k];
    if (!Number.isFinite(v) || v < 0) state.res[k] = 0;
  }
  for (const k of Object.keys(state.buildings)) {
    const v = state.buildings[k];
    if (!Number.isInteger(v) || v < 0) state.buildings[k] = Math.max(0, Math.floor(v) || 0);
  }
  if (!Number.isFinite(state.time) || state.time < 0) state.time = 0;
  if (!Number.isInteger(state.tick) || state.tick < 0) state.tick = 0;
}
