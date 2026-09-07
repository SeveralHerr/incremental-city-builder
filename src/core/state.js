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

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 16;

// Deep-merge `src` into `dst` for plain objects; arrays and primitives replaced.
// Prototype-polluting keys are skipped and recursion only follows keys `dst` itself owns, so
// loadState(JSON.parse(untrusted)) can never reach Object.prototype.
function mergeInto(dst, src, depth = 0) {
  if (depth > MAX_DEPTH) return dst;
  for (const k of Object.keys(src)) {
    if (BAD_KEYS.has(k)) continue;
    const v = src[k];
    if (isObj(v)) {
      const own = Object.prototype.hasOwnProperty.call(dst, k) && isObj(dst[k]);
      mergeInto(own ? dst[k] : (dst[k] = {}), v, depth + 1);
    } else {
      dst[k] = Array.isArray(v) ? v.slice() : v;
    }
  }
  return dst;
}

// Replace state contents with `obj` (missing fields get defaults). Keeps identity.
// The schema is closed: only the top-level keys createInitialState() defines are taken from
// `obj`, so a removed section or a foreign key in an old/hand-edited save is dropped instead of
// riding along in every autosave forever.
export function loadState(obj) {
  const fresh = createInitialState();
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, fresh);
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const known = {};
    for (const k of Object.keys(fresh)) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) known[k] = obj[k];
    }
    mergeInto(state, known);
  }
  sanitize();
  return state;
}

// Fresh run. keep: { prestige, settings, stats } chooses what survives.
// Per-run counters (totalEarned, buildingsBuilt, peakPop) restart at 0 even when stats are
// kept; lifetime counters (prestiges, playtime, clicks) carry over. Cumulative earnings across
// runs live in state.prestige.lifetimeEarned.
export function resetState({ keepPrestige = true, keepSettings = true, keepStats = true } = {}) {
  const prestige = keepPrestige ? { ...state.prestige } : undefined;
  const settings = keepSettings ? { ...state.settings } : undefined;
  const stats = keepStats
    ? { ...state.stats, totalEarned: 0, buildingsBuilt: 0, peakPop: 0 }
    : undefined;
  loadState({});
  if (prestige) state.prestige = prestige;
  if (settings) state.settings = settings;
  if (stats) state.stats = stats;
  return state;
}

// Clamp NaN/Infinity/negatives that would poison the sim, and enforce the shape promised by
// createInitialState(): every section is the right container type and every known field has
// the right primitive type (wrong-typed values fall back to defaults). Safe on its own — does
// not rely on the save module's scrub/coerce.
export function sanitize() {
  const fresh = createInitialState();
  for (const sec of ['res', 'buildings', 'upgrades', 'unlocks', 'stats', 'prestige', 'settings']) {
    if (!isObj(state[sec])) state[sec] = fresh[sec];
  }
  if (!Array.isArray(state.log)) state.log = [];
  for (const k of Object.keys(state.res)) {
    const v = state.res[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) state.res[k] = 0;
  }
  for (const k of Object.keys(state.buildings)) {
    const v = state.buildings[k];
    if (!Number.isInteger(v) || v < 0) state.buildings[k] = Math.max(0, Math.floor(Number(v)) || 0);
  }
  for (const sec of ['upgrades', 'unlocks']) {
    for (const k of Object.keys(state[sec])) {
      if (state[sec][k]) state[sec][k] = true;
      else delete state[sec][k];
    }
  }
  // stats/prestige/settings: known keys must match the default's type; numbers finite & >= 0.
  for (const sec of ['stats', 'prestige', 'settings']) {
    const want = fresh[sec];
    const cur = state[sec];
    for (const k of Object.keys(want)) {
      const type = typeof want[k];
      const v = cur[k];
      if (typeof v !== type || (type === 'number' && !(Number.isFinite(v) && v >= 0))) cur[k] = want[k];
    }
  }
  for (let i = state.log.length - 1; i >= 0; i--) {
    const e = state.log[i];
    if (!isObj(e) || typeof e.msg !== 'string') state.log.splice(i, 1);
    else {
      if (!Number.isFinite(e.t)) e.t = 0;
      if (typeof e.kind !== 'string') e.kind = 'info';
    }
  }
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
  if (typeof state.version !== 'number' || !Number.isFinite(state.version)) state.version = STATE_VERSION;
  if (!Number.isFinite(state.time) || state.time < 0) state.time = 0;
  if (!Number.isInteger(state.tick) || state.tick < 0) state.tick = 0;
}
