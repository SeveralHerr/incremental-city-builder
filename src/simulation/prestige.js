// Prestige — "Found a new city". Pure rules over state + balance config; the simulation
// module wires these into actions and the per-tick mods fold. DOM-free.
//
// legacy gained this run = floor((totalEarned / threshold) ^ exponent)
// income multiplier     = (1 + incomePerLegacy·legacy) ^ legacyPower · (1 + firstBonus once legacy > 0)
//
// Why a power and not a straight line: legacy *gain* is a root of earnings (exponent 0.35),
// so the earnings needed for the next N points grow like N^2.86. A linear payoff falls
// behind that inside a couple of hours and every late cycle ends in a plateau; raising the
// linear term to the third power keeps the marginal point worth about the same relative
// amount however many are banked, so cycle length stays roughly flat instead of ballooning.
// The one-off first bonus makes the very first founding (1 point) a jump a player can feel.
import { config } from '../balance/config.js';
import { resetState, addLog } from '../core/state.js';
import { emit } from '../core/events.js';
import { prestigeTuning, economyTuning } from './tuning.js';

// How many log lines survive a founding (the run's story is worth keeping).
const KEEP_LOG_LINES = 20;

// Resolved prestige knobs (reads config each call so balance can retune at runtime).
export function prestigeConfig(cfg = config) {
  const p = prestigeTuning(cfg);
  p.startMoney = economyTuning(cfg).startMoney;
  return p;
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
  const p = prestigeTuning(cfg);
  if (!(totalEarned >= p.threshold)) return 0;
  const gain = Math.floor(Math.pow(totalEarned / p.threshold, p.exponent));
  return Number.isFinite(gain) && gain > 0 ? gain : 0;
}

// Total earned at which a run grants `points` legacy (inverse of legacyFor).
export function earningsForLegacy(points, cfg = config) {
  const p = prestigeTuning(cfg);
  const n = Number.isFinite(points) && points > 0 ? points : 0;
  return p.threshold * Math.pow(n, 1 / p.exponent);
}

export function prestigeGain(state, cfg = config) {
  return legacyFor(totalEarnedOf(state), cfg);
}

// A city can be founded once the run has earned the threshold *and* the reset would bank
// at least `minGain` points, so the button never arms for a worthless reset.
export function canPrestige(state, cfg = config) {
  const p = prestigeTuning(cfg);
  return totalEarnedOf(state) >= p.threshold && prestigeGain(state, cfg) >= p.minGain;
}

// Seed cash for a run started with `legacy` points banked.
export function startMoneyFor(legacy, cfg = config) {
  const p = prestigeConfig(cfg);
  const n = Number.isFinite(legacy) && legacy > 0 ? legacy : 0;
  return p.startMoney * (1 + n * p.startMoneyPerLegacy);
}

// Permanent income multiplier from banked legacy (see the header for the shape).
export function legacyIncomeMult(legacy, cfg = config) {
  const n = Number.isFinite(legacy) && legacy > 0 ? Math.floor(legacy) : 0;
  if (n === 0) return 1;
  const p = prestigeTuning(cfg);
  const mult = Math.pow(1 + n * p.incomePerLegacy, p.legacyPower) * (1 + p.firstBonus);
  return Number.isFinite(mult) && mult >= 1 ? mult : 1;
}

// Fold prestige into the per-tick mods bag.
export function applyPrestigeMods(mods, state, cfg = config) {
  const legacy = legacyOf(state);
  if (legacy > 0) mods.income *= legacyIncomeMult(legacy, cfg);
  return mods;
}

// Total earned needed before the next legacy point would be granted (UI hint material).
export function nextLegacyAt(state, cfg = config) {
  return earningsForLegacy(prestigeGain(state, cfg) + 1, cfg);
}

// Total earned needed before founding is allowed (threshold or the minGain point, whichever
// is later). The dashboard's prestige bar should fill toward this, not the bare threshold.
export function prestigeUnlockAt(cfg = config) {
  const p = prestigeTuning(cfg);
  return Math.max(p.threshold, earningsForLegacy(p.minGain, cfg));
}

// Snapshot of the prestige situation for the UI (written into derived.extra.prestige each
// tick by the simulation so panels can read it without calling actions).
export function prestigeStatus(state, out, cfg = config) {
  const legacy = legacyOf(state);
  const gain = prestigeGain(state, cfg);
  const mult = legacyIncomeMult(legacy, cfg);
  out.legacy = legacy;
  out.gain = gain;
  out.can = canPrestige(state, cfg);
  out.unlockAt = prestigeUnlockAt(cfg);
  out.nextAt = earningsForLegacy(gain + 1, cfg);
  out.mult = mult;
  out.multAfter = legacyIncomeMult(legacy + gain, cfg);
  return out;
}

function fmtPct(mult) {
  const pct = (mult - 1) * 100;
  if (pct >= 1000) return Math.round(pct).toLocaleString('en-US') + '%';
  return (Math.round(pct * 10) / 10).toLocaleString('en-US') + '%';
}

/**
 * Perform the prestige reset. Returns true when a new city was founded.
 * Keeps prestige (legacy), settings, lifetime stats and the tail of the city log; resets
 * the run (buildings, upgrades, unlocks, totalEarned, money, population).
 * `onReset` runs after the state is rebuilt, before the event fires (simulation uses it
 * to recompute derived values and refresh its milestone bookkeeping).
 */
export function performPrestige(state, cfg = config, onReset) {
  if (!canPrestige(state, cfg)) return false;
  const gain = prestigeGain(state, cfg);
  if (gain <= 0) return false;

  const before = legacyOf(state);
  const legacy = before + gain;
  const cityNo = (Number.isFinite(state.stats.prestiges) ? state.stats.prestiges : 0) + 2;
  const earnedText = '$' + Math.round(totalEarnedOf(state)).toLocaleString('en-US');
  const peakPop = Number.isFinite(state.stats.peakPop) ? Math.floor(state.stats.peakPop) : 0;
  const keptLog = Array.isArray(state.log) ? state.log.slice(-KEEP_LOG_LINES) : [];

  state.prestige.legacy = legacy;
  state.stats.prestiges = cityNo - 1;

  resetState({ keepPrestige: true, keepSettings: true, keepStats: true });
  // totalEarned is per run: it drives prestige gain and the money milestones. Lifetime
  // earnings live in state.prestige.lifetimeEarned.
  state.stats.totalEarned = 0;
  state.res.money = startMoneyFor(legacy, cfg);
  state.res.pop = 0;

  // The old city's story survives the move (timestamps restart with the new run).
  for (let i = 0; i < keptLog.length; i++) state.log.push(keptLog[i]);
  addLog(
    `City #${cityNo} founded. The last one peaked at ${peakPop.toLocaleString('en-US')} citizens and earned ${earnedText}.`,
    'prestige',
  );

  if (typeof onReset === 'function') onReset(state);

  const multBefore = legacyIncomeMult(before, cfg);
  const multAfter = legacyIncomeMult(legacy, cfg);
  addLog(
    `+${gain} legacy (${legacy} total): income ×${(multAfter / multBefore).toFixed(2)} on top of the old bonus, +${fmtPct(multAfter)} over a fresh start, forever.`,
    'prestige',
  );
  emit('prestige', { gain, legacy, mult: multAfter });
  return true;
}
