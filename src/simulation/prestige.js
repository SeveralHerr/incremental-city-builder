// Prestige — "Found a new city". Pure rules over state + balance config; the simulation
// module wires these into actions and the per-tick mods fold. DOM-free.
//
// legacy worth of S     total(S)  = floor((S / threshold) ^ exponent),  S = lifetime earnings
// legacy this run       gain      = max(0, total(lifetimeEarned) − legacy)
// founding allowed      gain ≥ max(minGain, ceil(legacy · minGainShare))
// income multiplier     mult(L)   = (1 + incomePerLegacy·L) ^ legacyPower · (1 + firstBonus once L > 0)
// legacy as a currency  available = legacy − spent   (charter perks, core api.buyUpgrade)
// seed cash             max(startMoney · (1 + startMoneyPerLegacy·L), seed window · old city's peak income)
// tap per founding      mods.tap × (1 + tapPerFounding · min(prestiges, tapFoundingCap))
//
// One source of legacy, Cookie Clicker's: everything the mayor has ever earned is worth a
// legacy total, and founding banks the difference to what is already held. Nothing gates on
// wall-clock time and nothing compounds: a run has to out-earn the sum of every run before it
// to bank more, so the bank can only grow as fast as lifetime earnings ^ exponent (contract
// principle 2, docs/DESIGN.md). Legacy is also a currency (principle 3): charter perks are
// upgrades priced in legacy, core keeps the tally in state.prestige.spent, the income bonus
// always uses the FULL bank, and a founding keeps `spent` with the rest of state.prestige.
//
// The payoff is a root of the linear term (legacyPower ≤ 0.6, no soft cap, no tail), so a
// million-point bank is bounded by construction — ×251 at p = 0.6 with k = 0.01 — and
// twelve-hour money stays inside a double's comfortable range (principle 4: money ≤ 1e18,
// legacy ≤ 1e6). The one-off first bonus makes the first founding a jump a player can feel;
// the legacy tiers in milestones.js give every later founding a target in sight; and every
// founding pays something felt at once, whatever the bonus ratio reads (the shipped curve is
// ×1.01–1.05 per founding below ~40 points, ×1.20 late): each founding makes a tap worth
// tapPerFounding more seconds of income (tuning.js foundingTuning; bounded by the founding
// cap and, for sustained tapping, by the tap meter's refill — never by the bank), and the
// seed window, when balance turns it on, opens the new city with a treasury sized to the
// city just left (seedSeconds of its peak income, ramping in with the bank) so a replay
// starts partway up the ladder instead of re-buying cottages.
//
// What counts as earnings: the gross output of a solvent city (index.js integrate()). The
// old city's peak net income (stats.peakIncome, tracked there) sizes the seed and nothing
// else: it never feeds legacy.
//
// Shipped knobs (simulation.test.mjs asserts this line against src/balance/config.js, so
// it cannot drift): threshold 1.1e7, exponent 0.488, incomePerLegacy 0.01, legacyPower
// 0.548, firstBonus 0.18, startMoneyPerLegacy 1, minGain 1, minGainShare 0.4,
// prestigePanelShare 0.1.
//
// Shape, not bug: the bot resets for +40% legacy (minGainShare), which at exponent 0.488
// means every run must earn the whole past over again (lifetime ×1.4^(1/0.488) = ×1.99)
// while the bonus grows only ×1.4^0.548 = ×1.20 per founding, so a city with nothing new
// is ~×1.35 longer than the one before it. The late ladder (one rung or perk per city,
// placed by balance in config.upgrades) and the founding / legacy tiers in milestones.js
// keep that plateau flat; the prestige knobs set the cadence, the rung prices set the
// purchase tension. Measured pacing: docs/DESIGN.md "Late game contract" and the latest
// logs/sim-*.json (`node tools/economy-sim.mjs --ticks 432000`, `metrics` and `cycles`).
import { config } from '../balance/config.js';
import { resetState, addLog } from '../core/state.js';
import { emit } from '../core/events.js';
import { prestigeTuning, economyTuning, foundingTuning } from './tuning.js';
import { nextLegacyMilestone } from './milestones.js';

// How many log lines survive a founding (the run's story is worth keeping).
const KEEP_LOG_LINES = 20;

// Resolved prestige knobs plus the seed cash, as a fresh object (for tools and tests; the
// tick path reads the shared prestigeTuning/economyTuning objects and never allocates).
export function prestigeConfig(cfg = config) {
  return Object.assign({}, prestigeTuning(cfg), { startMoney: economyTuning(cfg).startMoney });
}

// The whole bank (what the income bonus is computed from), whole points.
export function legacyOf(state) {
  const v = state && state.prestige ? state.prestige.legacy : 0;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// Points spent on charter perks (core api.buyUpgrade keeps the tally).
export function spentOf(state) {
  const v = state && state.prestige ? state.prestige.spent : 0;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// Points still free to spend: legacy − spent, never negative.
export function availableOf(state) {
  const n = legacyOf(state) - spentOf(state);
  return n > 0 ? n : 0;
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

// Permanent income multiplier from the full bank (see the header for the shape).
export function legacyIncomeMult(legacy, cfg = config) {
  const n = Number.isFinite(legacy) && legacy > 0 ? Math.floor(legacy) : 0;
  if (n === 0) return 1;
  const p = prestigeTuning(cfg);
  const mult = Math.pow(1 + n * p.incomePerLegacy, p.legacyPower) * (1 + p.firstBonus);
  return Number.isFinite(mult) && mult >= 1 ? mult : 1;
}

// Legacy that `earned` dollars are worth, unfloored: 0 below the threshold.
export function legacyWorth(earned, cfg = config) {
  const p = prestigeTuning(cfg);
  if (!(earned >= p.threshold)) return 0;
  const w = Math.pow(earned / p.threshold, p.exponent);
  return Number.isFinite(w) && w > 0 ? w : 0;
}

// Legacy that `lifetimeEarned` dollars are worth in total.
export function legacyFor(lifetimeEarned, cfg = config) {
  return Math.floor(legacyWorth(lifetimeEarned, cfg));
}

// Lifetime earnings at which `points` legacy in total have been earned (inverse of legacyFor).
export function earningsForLegacy(points, cfg = config) {
  const p = prestigeTuning(cfg);
  const n = Number.isFinite(points) && points > 0 ? points : 0;
  const v = p.threshold * Math.pow(n, 1 / p.exponent);
  return Number.isFinite(v) ? v : Infinity;
}

// Points a founding would bank right now: the lifetime worth minus the bank.
export function prestigeGain(state, cfg = config) {
  const gain = legacyFor(lifetimeEarnedOf(state), cfg) - legacyOf(state);
  return gain > 0 ? gain : 0;
}

// Points a founding must bank before it is allowed: the absolute floor, or a share of the
// bank once one exists (a 1,000-point mayor is not offered a reset for +3).
export function requiredGain(state, cfg = config) {
  const p = prestigeTuning(cfg);
  const share = Math.ceil(legacyOf(state) * p.minGainShare);
  return share > p.minGain ? share : p.minGain;
}

// A city can be founded once the reset would bank at least requiredGain points, so the
// button never arms for a worthless reset.
export function canPrestige(state, cfg = config) {
  return prestigeGain(state, cfg) >= requiredGain(state, cfg);
}

// The old city's peak net income (index.js integrate() tracks it per run).
export function peakIncomeOf(state) {
  const v = state && state.stats ? state.stats.peakIncome : 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// Seconds of the old city's income a founding at `legacy` points seeds: the window opens
// with the bank (seedSeconds · min(1, legacy / seedLegacy)).
export function seedWindowFor(legacy, cfg = config) {
  const n = Number.isFinite(legacy) && legacy > 0 ? legacy : 0;
  const f = foundingTuning(cfg);
  if (!(f.seedLegacy > 0)) return f.seedSeconds;
  return n >= f.seedLegacy ? f.seedSeconds : (f.seedSeconds * n) / f.seedLegacy;
}

// Seed cash for a run started with `legacy` points banked, after a city that peaked at
// `peakIncome` per second: the legacy seed or the seed window of that income, whichever is more.
export function startMoneyFor(legacy, cfg = config, peakIncome = 0) {
  const n = Number.isFinite(legacy) && legacy > 0 ? legacy : 0;
  const base = economyTuning(cfg).startMoney * (1 + n * prestigeTuning(cfg).startMoneyPerLegacy);
  const rate = Number.isFinite(peakIncome) && peakIncome > 0 ? peakIncome : 0;
  const seed = rate * seedWindowFor(n, cfg);
  return seed > base ? seed : base;
}

// Foundings so far (stats.prestiges), whole and non-negative.
export function foundingsOf(state) {
  const v = state && state.stats ? state.stats.prestiges : 0;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// What a tap is worth after `foundings` foundings, relative to a first city: linear in the
// founding count up to tapFoundingCap. Sustained tap income is capped by the meter's
// refill regardless (index.js tap()), so this scales the tap after a pause, not the ceiling.
export function foundingTapMult(foundings, cfg = config) {
  const f = foundingTuning(cfg);
  const n = Number.isFinite(foundings) && foundings > 0 ? Math.min(Math.floor(foundings), f.tapFoundingCap) : 0;
  const mult = 1 + n * f.tapPerFounding;
  return Number.isFinite(mult) && mult >= 1 ? mult : 1;
}

// Fold prestige into the per-tick mods bag: the full bank, whatever has been spent, and the
// per-founding tap value (mods.tap is seeded by index.js foldMods; a bare core bag reads
// as 1 so an older caller never turns it into NaN).
export function applyPrestigeMods(mods, state, cfg = config) {
  const legacy = legacyOf(state);
  if (legacy > 0) mods.income *= legacyIncomeMult(legacy, cfg);
  const tapMult = foundingTapMult(foundingsOf(state), cfg);
  if (tapMult > 1) mods.tap = (Number.isFinite(mods.tap) && mods.tap > 0 ? mods.tap : 1) * tapMult;
  return mods;
}

// This run's totalEarned at which a founding would bank `points` (the smallest such value).
// Closed form: lifetime earnings worth legacy + points, minus what earlier runs contributed.
// 0 for no points; Infinity when the figure overflows a double (the UI can say "not this
// run"); never below 0 (a hand-edited lifetime cannot put the target in the past).
export function runEarningsForGain(state, points, cfg = config) {
  const n = Number.isFinite(points) ? Math.ceil(points) : 0;
  if (n <= 0) return 0;
  const now = totalEarnedOf(state);
  const earlier = lifetimeEarnedOf(state) - now;
  const at = earningsForLegacy(legacyOf(state) + n, cfg) - earlier;
  return at > 0 ? at : 0;
}

// This run's totalEarned needed before the next legacy point would be granted.
export function nextLegacyAt(state, cfg = config) {
  return runEarningsForGain(state, prestigeGain(state, cfg) + 1, cfg);
}

// This run's totalEarned needed before founding is allowed (the requiredGain-th point).
export function prestigeUnlockAt(state, cfg = config) {
  return runEarningsForGain(state, requiredGain(state, cfg), cfg);
}

// Snapshot of the prestige situation for the UI (written into derived.extra.prestige each
// tick by the simulation so panels can read it without calling actions):
//   legacy, spent, available   the bank, the charter tally, what is free to spend
//   gain, can, minGain         points a founding banks now, whether it is allowed, the gate
//   unlockAt, nextAt           this run's totalEarned at which founding arms / the next point
//   mult, multAfter            the real income multiplier now / after founding
//   lifetimeEarned, startMoneyAfter, nextTierName, nextTierAt
//   nextIn, unlockIn           seconds at the given earning rate (index.js earningRate: the
//                              gross output a solvent city scores) until nextAt / unlockAt
//                              (0 once reached, Infinity with no income or no target), so a
//                              plateau city with no rung in reach still shows a waiting
//                              target: "next legacy point in 4 min"
// Every field is closed-form and refreshed every tick; nothing here allocates.
export function prestigeStatus(state, out, cfg = config, incomePerSec = 0) {
  const legacy = legacyOf(state);
  const spent = spentOf(state);
  const gain = prestigeGain(state, cfg);
  const need = requiredGain(state, cfg);
  out.legacy = legacy;
  out.spent = spent;
  out.available = legacy > spent ? legacy - spent : 0;
  out.gain = gain;
  out.can = gain >= need;
  out.minGain = need; // the resolved gate: max(minGain, ceil(legacy · minGainShare))
  out.unlockAt = runEarningsForGain(state, need, cfg);
  out.nextAt = runEarningsForGain(state, gain + 1, cfg);
  out.lifetimeEarned = lifetimeEarnedOf(state);
  const earned = totalEarnedOf(state);
  out.nextIn = secondsUntil(out.nextAt, earned, incomePerSec);
  out.unlockIn = out.can ? 0 : secondsUntil(out.unlockAt, earned, incomePerSec);
  out.mult = legacyIncomeMult(legacy, cfg);
  out.multAfter = legacyIncomeMult(legacy + gain, cfg);
  out.startMoneyAfter = startMoneyFor(legacy + gain, cfg, peakIncomeOf(state));
  const tier = nextLegacyMilestone(legacy);
  out.nextTierName = tier ? tier.name : '';
  out.nextTierAt = tier ? tier.target : 0;
  return out;
}

// Seconds until this run's earnings reach `target` at `perSec`: 0 once there, Infinity when
// nothing is coming in or the target is out of reach.
function secondsUntil(target, earned, perSec) {
  if (!(target > earned)) return 0;
  if (!(perSec > 0) || !Number.isFinite(target)) return Infinity;
  const s = (target - earned) / perSec;
  return Number.isFinite(s) ? s : Infinity;
}

function fmtPct(mult) {
  const pct = (mult - 1) * 100;
  if (pct >= 1000) return Math.round(pct).toLocaleString('en-US') + '%';
  return (Math.round(pct * 10) / 10).toLocaleString('en-US') + '%';
}

/**
 * Perform the prestige reset. Returns true when a new city was founded.
 * Keeps prestige (legacy, spent, lifetimeEarned), settings, lifetime stats and the tail of
 * the city log; resets the run (buildings, upgrades, unlocks, totalEarned, money, population).
 * `onReset` runs after the state is rebuilt, before the event fires (simulation uses it
 * to recompute derived values and refresh its milestone bookkeeping).
 */
export function performPrestige(state, cfg = config, onReset) {
  if (!canPrestige(state, cfg)) return false;
  const gain = prestigeGain(state, cfg);
  if (gain <= 0) return false;

  const before = legacyOf(state);
  const legacy = before + gain;
  const spent = spentOf(state);
  const cityNo = (Number.isFinite(state.stats.prestiges) ? state.stats.prestiges : 0) + 2;
  const earnedText = '$' + Math.round(totalEarnedOf(state)).toLocaleString('en-US');
  const peakPop = Number.isFinite(state.stats.peakPop) ? Math.floor(state.stats.peakPop) : 0;
  const peakIncome = peakIncomeOf(state);
  const keptLog = Array.isArray(state.log) ? state.log.slice(-KEEP_LOG_LINES) : [];

  state.prestige.legacy = legacy;
  state.prestige.spent = spent;
  state.prestige.lifetimeEarned = lifetimeEarnedOf(state);
  state.stats.prestiges = cityNo - 1;

  resetState({ keepPrestige: true, keepSettings: true, keepStats: true });
  // totalEarned is per run: it drives the money milestones and the prestige bar. Lifetime
  // earnings (what legacy is computed from) live in state.prestige.lifetimeEarned.
  state.stats.totalEarned = 0;
  state.stats.peakIncome = 0; // per run, like peakPop: the new city sizes the next seed
  state.res.money = startMoneyFor(legacy, cfg, peakIncome);
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
  addLog(foundingLine(gain, legacy, multBefore, multAfter, state.res.money, peakIncome, foundingTapMult(cityNo - 1, cfg)), 'prestige');
  emit('prestige', { gain, legacy, spent, available: legacy > spent ? legacy - spent : 0, mult: multAfter });
  return true;
}

// The founding line. Every founding pays more than once — the bonus ratio (forever), the
// tap value (every founding), the seed (now, when the window is on) — and the line leads
// with the bigger news: the ratio while a founding still moves the bonus by NOTABLE_RATIO
// or more, else the treasury and the tap. A seed that is real is sized in seconds of the
// old city's income so it reads as time saved rather than as a figure. Neither branch
// advertises a ×1.00; the next legacy tier closes both.
const NOTABLE_RATIO = 1.05;

export function foundingLine(gain, legacy, multBefore, multAfter, seedMoney, peakIncome = 0, tapMult = 1) {
  const got = gain.toLocaleString('en-US');
  const total = legacy.toLocaleString('en-US');
  const ratio = multBefore > 0 && Number.isFinite(multAfter / multBefore) ? multAfter / multBefore : 1;
  const seed = '$' + Math.round(seedMoney).toLocaleString('en-US');
  const tier = nextLegacyMilestone(legacy);
  const next = tier ? ` Next tier: ${tier.name} at ${tier.target.toLocaleString('en-US')} legacy.` : '';
  const window = peakIncome > 0 && seedMoney > 0 ? seedMoney / peakIncome : 0;
  const opens = window >= 1 ? `opens with ${seed} — ${fmtSeconds(window)} of the old city's income` : `opens with ${seed}`;
  const taps = tapMult > 1.005 ? ` Taps pay ×${(Math.round(tapMult * 10) / 10).toLocaleString('en-US')} a first city's.` : '';
  if (ratio >= NOTABLE_RATIO) {
    return `+${got} legacy (${total} total): income ×${ratio.toFixed(2)} on top of the old bonus, +${fmtPct(multAfter)} over a fresh start, forever. The new city ${opens}.${taps}${next}`;
  }
  const bonus = ratio > 1.005 ? `the income bonus grows to +${fmtPct(multAfter)}` : `the income bonus stands at +${fmtPct(multAfter)}`;
  return `+${got} legacy (${total} total): the new city ${opens}, and ${bonus}.${taps}${next}`;
}

function fmtSeconds(s) {
  if (s >= 3600) return `${(Math.round(s / 360) / 10).toLocaleString('en-US')} h`;
  if (s >= 90) return `${Math.round(s / 60).toLocaleString('en-US')} min`;
  return `${Math.round(s).toLocaleString('en-US')} s`;
}
