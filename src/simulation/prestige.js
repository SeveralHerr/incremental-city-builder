// Prestige — "Found a new city". Pure rules over state + balance config; the simulation
// module wires these into actions and the per-tick mods fold. DOM-free.
//
// income multiplier     mult(L)   = softcap((1 + incomePerLegacy·L) ^ legacyPower, legacyCap) · (1 + firstBonus once L > 0)
// legacy worth of S     total(S)  = floor((S / threshold) ^ exponent),  S = lifetime earnings / mult(L) ^ legacyDiscount
// maturity of a run     M         = totalEarned / peakIncome   (seconds of best income banked)
// legacy this run       gain      = floor( max(0, total(S) − L) · ripe(M)  +  L · M · compoundPerMinute / 60 )
//                       ripe(M)   = min(1, M / ripenSeconds), or 1 when ripenSeconds is 0
//
// Two sources of legacy, and why. The first is Cookie Clicker's: everything the mayor has
// ever earned is worth a legacy total, and founding banks the difference to what is held.
// It drives the first hour (first founding at three points, the next few about ten minutes
// apart) and cannot cascade: a run has to out-earn the sum of every run before it, and the
// earnings are discounted by the income bonus, so the bonus never buys the next points
// faster than a city on its own merits would. The second is compounding: a *mature* city grows the bank by a fixed share per minute
// of its best income it has banked, so once the legacy bonus (and the upgrade ladder it
// funds) lets a fresh city hit full stride in a minute, the reward for staying put is what
// sets the cycle length — about ten minutes for the greedy bot — instead of the requirement
// running away from income (two-hour cycles) or income running away from the requirement
// (a founding every forty seconds and legacy in the hundreds of millions). Maturity counts
// earnings against the run's *peak* income, so selling the city down does not ripen it.
//
// The payoff is a power of the linear term (the marginal point keeps its relative worth)
// bent toward a soft cap: past the cap the base economy — and with it the upgrade ladder,
// which doubles income per rung and climbs at a rate proportional to the multiplier — can
// no longer explode inside a single cycle, which is what keeps twelve-hour money in the
// 1e15 range. Past the cap the curve keeps a slow power-law tail (elasticity tending to
// legacyCapTailPower, 0.3 shipped) rather than going flat: a founding that grows the bank by
// a quarter stays worth +2–5% income at the bank sizes a session reaches (approaching +7%
// beyond), so the loop the game is built around still pays in hour ten, while the whole
// tail adds only ×2 across a session. The legacy tiers in milestones.js (2.5k … 1M points)
// give those late foundings a target every three or four resets on top. The one-off first
// bonus makes the very first founding a jump a player can feel.
import { config } from '../balance/config.js';
import { resetState, addLog } from '../core/state.js';
import { emit } from '../core/events.js';
import { prestigeTuning, economyTuning } from './tuning.js';
import { nextLegacyMilestone } from './milestones.js';

// How many log lines survive a founding (the run's story is worth keeping).
const KEEP_LOG_LINES = 20;

// Resolved prestige knobs plus the seed cash, as a fresh object (for tools and tests; the
// tick path reads the shared prestigeTuning/economyTuning objects and never allocates).
export function prestigeConfig(cfg = config) {
  return Object.assign({}, prestigeTuning(cfg), { startMoney: economyTuning(cfg).startMoney });
}

export function legacyOf(state) {
  const v = state && state.prestige ? state.prestige.legacy : 0;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function totalEarnedOf(state) {
  const v = state && state.stats ? state.stats.totalEarned : 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// Everything earned across every run, this one included. Never less than this run's total
// (a hand-edited save cannot make the current city worth negative legacy).
export function lifetimeEarnedOf(state) {
  const v = state && state.prestige ? state.prestige.lifetimeEarned : 0;
  const life = Number.isFinite(v) && v > 0 ? v : 0;
  const run = totalEarnedOf(state);
  return life > run ? life : run;
}

// Best gross income this run has seen (kept in stats.peakIncome by the simulation).
export function peakIncomeOf(state) {
  const v = state && state.stats ? state.stats.peakIncome : 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// Seconds of the run's best income it has banked so far: 0 until income exists.
export function maturityOf(state) {
  const peak = peakIncomeOf(state);
  return peak > 0 ? totalEarnedOf(state) / peak : 0;
}

// Permanent income multiplier from banked legacy (see the header for the shape).
export function legacyIncomeMult(legacy, cfg = config) {
  const n = Number.isFinite(legacy) && legacy > 0 ? Math.floor(legacy) : 0;
  if (n === 0) return 1;
  const p = prestigeTuning(cfg);
  let bonus = Math.pow(1 + n * p.incomePerLegacy, p.legacyPower) - 1;
  // Soft cap: same slope near zero, bends toward legacyCap, then keeps a slow tail so a
  // bigger bank always means a bigger number — a power law ((1 + x)^q − 1) / q with the
  // elasticity q = legacyCapTailPower (a logarithm when q is 0), scaled by legacyCapTail.
  if (p.legacyCap > 1) {
    const room = p.legacyCap - 1;
    const x = bonus / room;
    const q = p.legacyCapTailPower;
    const tail = q > 0 ? (Math.pow(1 + x, q) - 1) / q : Math.log1p(x);
    bonus = room * (1 - Math.exp(-x) + p.legacyCapTail * tail);
  }
  const mult = (1 + bonus) * (1 + p.firstBonus);
  return Number.isFinite(mult) && mult >= 1 ? mult : 1;
}

// Share of lifetime earnings that counts toward the earnings-based legacy source for a
// mayor with `legacy` banked: 1 / mult(legacy) ^ legacyDiscount. Legacy is earned on what a
// city would have made without its bonus, so a big bonus cannot buy the next points faster.
export function legacyEarningsScale(legacy, cfg = config) {
  const p = prestigeTuning(cfg);
  if (!(p.legacyDiscount > 0)) return 1;
  const s = Math.pow(legacyIncomeMult(legacy, cfg), -p.legacyDiscount);
  return Number.isFinite(s) && s > 0 && s <= 1 ? s : 1;
}

// Legacy that `lifetimeEarned` (already scaled) dollars are worth in total.
export function legacyFor(lifetimeEarned, cfg = config) {
  const p = prestigeTuning(cfg);
  if (!(lifetimeEarned >= p.threshold)) return 0;
  const total = Math.floor(Math.pow(lifetimeEarned / p.threshold, p.exponent));
  return Number.isFinite(total) && total > 0 ? total : 0;
}

// Lifetime earnings at which `points` legacy in total have been earned (inverse of legacyFor).
export function earningsForLegacy(points, cfg = config) {
  const p = prestigeTuning(cfg);
  const n = Number.isFinite(points) && points > 0 ? points : 0;
  const v = p.threshold * Math.pow(n, 1 / p.exponent);
  return Number.isFinite(v) ? v : Infinity;
}

// Legacy the compounding source would add for `legacy` banked at maturity `m` seconds.
function compoundGainFor(legacy, m, cfg) {
  const p = prestigeTuning(cfg);
  const v = (legacy * m * p.compoundPerMinute) / 60;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// Share of the earnings-based legacy a run of maturity `m` seconds has ripened: 1 once it
// has banked ripenSeconds of its peak income (or always, when ripenSeconds is 0).
export function ripeness(m, cfg = config) {
  const r = prestigeTuning(cfg).ripenSeconds;
  if (!(r > 0)) return 1;
  const v = Number.isFinite(m) && m > 0 ? m / r : 0;
  return v > 1 ? 1 : v;
}

// Unfloored legacy a founding would bank with `totalEarned` this run (lifetime grows by the
// same amount); the other inputs are read from the state.
function rawGainAt(state, totalEarned, cfg) {
  const legacy = legacyOf(state);
  const earlier = lifetimeEarnedOf(state) - totalEarnedOf(state);
  const peak = peakIncomeOf(state);
  const maturity = peak > 0 ? totalEarned / peak : 0;
  let base = legacyFor((earlier + totalEarned) * legacyEarningsScale(legacy, cfg), cfg) - legacy;
  if (base > 0) base *= ripeness(maturity, cfg);
  else base = 0;
  return base + compoundGainFor(legacy, maturity, cfg);
}

// Points a founding would bank right now.
export function prestigeGain(state, cfg = config) {
  const gain = Math.floor(rawGainAt(state, totalEarnedOf(state), cfg));
  return gain > 0 ? gain : 0;
}

// A city can be founded once the reset would bank at least `minGain` points, so the button
// never arms for a worthless reset.
export function canPrestige(state, cfg = config) {
  return prestigeGain(state, cfg) >= prestigeTuning(cfg).minGain;
}

// Seed cash for a run started with `legacy` points banked.
export function startMoneyFor(legacy, cfg = config) {
  const n = Number.isFinite(legacy) && legacy > 0 ? legacy : 0;
  return economyTuning(cfg).startMoney * (1 + n * prestigeTuning(cfg).startMoneyPerLegacy);
}

// Fold prestige into the per-tick mods bag.
export function applyPrestigeMods(mods, state, cfg = config) {
  const legacy = legacyOf(state);
  if (legacy > 0) mods.income *= legacyIncomeMult(legacy, cfg);
  return mods;
}

// This run's totalEarned at which a founding would bank `points` (the smallest such value,
// given the run's peak income so far). Both legacy sources rise with earnings, so bisect.
export function runEarningsForGain(state, points, cfg = config) {
  const n = Number.isFinite(points) ? Math.ceil(points) : 0;
  if (n <= 0) return 0;
  const now = totalEarnedOf(state);
  let lo;
  let hi;
  if (rawGainAt(state, now, cfg) >= n) {
    // Already there: walk down to the exact point so the UI bar reads as full, not over.
    lo = 0;
    hi = now;
  } else {
    // The lifetime source alone reaches n at a finite figure; use it as the upper bracket.
    const earlier = lifetimeEarnedOf(state) - now;
    lo = now;
    hi = earningsForLegacy(legacyOf(state) + n, cfg) / legacyEarningsScale(legacyOf(state), cfg) - earlier;
    if (!(hi > now)) hi = now * 2 + 1;
  }
  for (let i = 0; i < 64 && hi - lo > hi * 1e-6; i++) {
    const mid = (lo + hi) / 2;
    if (rawGainAt(state, mid, cfg) >= n) hi = mid;
    else lo = mid;
  }
  return hi;
}

// This run's totalEarned needed before the next legacy point would be granted.
export function nextLegacyAt(state, cfg = config) {
  return runEarningsForGain(state, prestigeGain(state, cfg) + 1, cfg);
}

// This run's totalEarned needed before founding is allowed (the minGain-th point).
export function prestigeUnlockAt(state, cfg = config) {
  return runEarningsForGain(state, prestigeTuning(cfg).minGain, cfg);
}

// Snapshot of the prestige situation for the UI (written into derived.extra.prestige each
// tick by the simulation so panels can read it without calling actions). The two earnings
// targets are bisections; pass withTargets = false to keep the previous ones. Also names the
// next legacy tier (nextTierName / nextTierAt, from the milestone ladder) and the seed cash
// a founding would grant (startMoneyAfter), so a panel can say what a late founding buys
// once the income bonus has flattened.
export function prestigeStatus(state, out, cfg = config, withTargets = true) {
  const p = prestigeTuning(cfg);
  const legacy = legacyOf(state);
  const gain = prestigeGain(state, cfg);
  out.legacy = legacy;
  out.gain = gain;
  out.can = gain >= p.minGain;
  out.minGain = p.minGain;
  if (withTargets || !(out.nextAt > 0)) {
    out.unlockAt = runEarningsForGain(state, p.minGain, cfg);
    out.nextAt = runEarningsForGain(state, gain + 1, cfg);
  }
  out.lifetimeEarned = lifetimeEarnedOf(state);
  out.maturity = maturityOf(state);
  out.mult = legacyIncomeMult(legacy, cfg);
  out.multAfter = legacyIncomeMult(legacy + gain, cfg);
  out.startMoneyAfter = startMoneyFor(legacy + gain, cfg);
  const tier = nextLegacyMilestone(legacy);
  out.nextTierName = tier ? tier.name : '';
  out.nextTierAt = tier ? tier.target : 0;
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
  state.prestige.lifetimeEarned = lifetimeEarnedOf(state);
  state.stats.prestiges = cityNo - 1;

  resetState({ keepPrestige: true, keepSettings: true, keepStats: true });
  // totalEarned is per run: it drives the money milestones and the prestige bar. Lifetime
  // earnings (what legacy is computed from) live in state.prestige.lifetimeEarned.
  state.stats.totalEarned = 0;
  state.stats.peakIncome = 0;
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
  addLog(foundingLine(gain, legacy, multBefore, multAfter, state.res.money), 'prestige');
  emit('prestige', { gain, legacy, mult: multAfter });
  return true;
}

// The founding line: while a founding still moves the income bonus by a few percent it
// leads with the ratio; once the bonus has flattened it leads with what did change — the
// bank, the seed cash and the next legacy tier — instead of advertising a ×1.00.
const NOTABLE_RATIO = 1.05;

export function foundingLine(gain, legacy, multBefore, multAfter, seedMoney) {
  const got = gain.toLocaleString('en-US');
  const total = legacy.toLocaleString('en-US');
  const ratio = multAfter / multBefore;
  if (ratio >= NOTABLE_RATIO) {
    return `+${got} legacy (${total} total): income ×${ratio.toFixed(2)} on top of the old bonus, +${fmtPct(multAfter)} over a fresh start, forever.`;
  }
  const tier = nextLegacyMilestone(legacy);
  const next = tier ? ` Next tier: ${tier.name} at ${tier.target.toLocaleString('en-US')} legacy.` : '';
  const seed = '$' + Math.round(seedMoney).toLocaleString('en-US');
  return `+${got} legacy (${total} total): the bank keeps every point, the new city opens with ${seed}, and the income bonus holds at +${fmtPct(multAfter)}.${next}`;
}
