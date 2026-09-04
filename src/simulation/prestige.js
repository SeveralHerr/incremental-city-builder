// Prestige — "Found a new city". Pure rules over state + balance config; the simulation
// module wires these into actions and the per-tick mods fold. DOM-free.
//
// legacy gained this run = floor((totalEarned / threshold) ^ exponent)
// each legacy point: +incomePerLegacy income forever, +startMoneyPerLegacy seed cash per run.
import { config } from '../balance/config.js';
import { resetState, addLog } from '../core/state.js';
import { emit } from '../core/events.js';

// DESIGN.md defaults, used only when a config knob is missing or malformed.
const DEFAULTS = Object.freeze({
  threshold: 1e6,
  exponent: 0.5,
  incomePerLegacy: 0.05,
  startMoneyPerLegacy: 0.5,
  startMoney: 50,
});

function finite(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// Resolved prestige knobs (reads config each call so balance can retune at runtime).
export function prestigeConfig(cfg = config) {
  const p = (cfg && cfg.prestige) || {};
  const e = (cfg && cfg.economy) || {};
  const threshold = finite(p.threshold, DEFAULTS.threshold);
  return {
    threshold: threshold > 0 ? threshold : DEFAULTS.threshold,
    exponent: Math.max(0.05, finite(p.exponent, DEFAULTS.exponent)),
    incomePerLegacy: Math.max(0, finite(p.incomePerLegacy, DEFAULTS.incomePerLegacy)),
    startMoneyPerLegacy: Math.max(0, finite(p.startMoneyPerLegacy, DEFAULTS.startMoneyPerLegacy)),
    startMoney: Math.max(0, finite(e.startMoney, DEFAULTS.startMoney)),
  };
}

export function legacyOf(state) {
  const v = state && state.prestige ? state.prestige.legacy : 0;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function totalEarnedOf(state) {
  const v = state && state.stats ? state.stats.totalEarned : 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// Legacy points a run of `totalEarned` would grant.
export function legacyFor(totalEarned, cfg = config) {
  const p = prestigeConfig(cfg);
  if (!(totalEarned >= p.threshold)) return 0;
  const gain = Math.floor(Math.pow(totalEarned / p.threshold, p.exponent));
  return Number.isFinite(gain) && gain > 0 ? gain : 0;
}

export function canPrestige(state, cfg = config) {
  return totalEarnedOf(state) >= prestigeConfig(cfg).threshold;
}

export function prestigeGain(state, cfg = config) {
  return legacyFor(totalEarnedOf(state), cfg);
}

// Seed cash for a run started with `legacy` points banked.
export function startMoneyFor(legacy, cfg = config) {
  const p = prestigeConfig(cfg);
  const n = Number.isFinite(legacy) && legacy > 0 ? legacy : 0;
  return p.startMoney * (1 + n * p.startMoneyPerLegacy);
}

// Permanent income multiplier from banked legacy (×(1 + legacy·incomePerLegacy)).
export function legacyIncomeMult(legacy, cfg = config) {
  const n = Number.isFinite(legacy) && legacy > 0 ? legacy : 0;
  return 1 + n * prestigeConfig(cfg).incomePerLegacy;
}

// Fold prestige into the per-tick mods bag.
export function applyPrestigeMods(mods, state, cfg = config) {
  const legacy = legacyOf(state);
  if (legacy > 0) mods.income *= legacyIncomeMult(legacy, cfg);
  return mods;
}

// Total earned needed before the next legacy point would be granted (UI hint material).
export function nextLegacyAt(state, cfg = config) {
  const p = prestigeConfig(cfg);
  const gain = prestigeGain(state, cfg);
  return p.threshold * Math.pow(gain + 1, 1 / p.exponent);
}

/**
 * Perform the prestige reset. Returns true when a new city was founded.
 * Keeps prestige (legacy), settings and lifetime stats; resets the run (buildings,
 * upgrades, unlocks, log, totalEarned, money, population).
 * `onReset` runs after the state is rebuilt, before the event fires (simulation uses it
 * to recompute derived values and refresh its milestone bookkeeping).
 */
export function performPrestige(state, cfg = config, onReset) {
  if (!canPrestige(state, cfg)) return false;
  const gain = prestigeGain(state, cfg);
  if (gain <= 0) return false;

  const p = prestigeConfig(cfg);
  const legacy = legacyOf(state) + gain;
  state.prestige.legacy = legacy;
  state.stats.prestiges = (Number.isFinite(state.stats.prestiges) ? state.stats.prestiges : 0) + 1;

  resetState({ keepPrestige: true, keepSettings: true, keepStats: true });
  // totalEarned is per run: it drives prestige gain and the money milestones. Lifetime
  // earnings live in state.prestige.lifetimeEarned.
  state.stats.totalEarned = 0;
  state.res.money = startMoneyFor(legacy, cfg);
  state.res.pop = 0;

  if (typeof onReset === 'function') onReset(state);

  const bonusPct = Math.round(legacy * p.incomePerLegacy * 1000) / 10;
  addLog(
    `A new city is founded. +${gain} legacy (${legacy} total): income +${bonusPct}% forever, and a bigger treasury to start with.`,
    'prestige',
  );
  emit('prestige', { gain, legacy });
  return true;
}
