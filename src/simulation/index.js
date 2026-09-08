// Simulation — the heartbeat of Metropolis. DOM-free (runs in Node for the economy sim).
//
// Every tick (`simulate`, priority 0):
//   1. build a fresh mods bag and fold owned upgrades, latched milestones and prestige,
//   2. computeDerived (resources) with the balance config,
//   3. integrate money and population over dt, keep the stats honest (earnings are the
//      gross output of a solvent city; an upkeep deficit earns nothing, see integrate()),
//   4. refresh derived.extra.prestige (legacy, spent, available, gain, can, targets) for the
//      dashboard and for the goals that read it,
//   5. latch milestones and dashboard gates, keep the city log lively; a milestone that
//      carries a reward is folded into derived on the tick it latches (one extra fold and
//      one extra snapshot refresh, only then), so the dashboard, a tap, the next goal and
//      the "next point in" countdown read the reward at once.
// Actions: canPrestige, prestigeGain, prestige, tap, setSetting. Events: milestone, unlock,
// prestige, tap, setting, brownout ({ active, ratio } on both grid transitions). The
// prestige rules live in prestige.js, the goals in milestones.js, every config knob read
// here in tuning.js (resolved once and shared). Per-tick allocation is the mods bag and
// what folds into it: the byBuilding entries upgrades and the clean-air tiers create
// (one per polluter per tick once legacy ≥ 15) and the two key arrays plus Object.keys
// that core's sanitizeMods builds — nothing else on the tick path allocates (the
// allocation test in simulation.test.mjs holds the tick under 0.05 ms; the measured
// browser figures are logs/<tag>.json tickStats, the Node ones logs/sim-*.json ticksPerSec).
//
// Bookkeeping that is not part of the saved state (the pending milestone list, the brownout
// hysteresis, the tap meter, the bank a founding started from, the milestone carry-over
// window) lives in one object per game
// (game._sim, created by init and reused by a second init of the same game — init is
// idempotent per game object). The exported simulate/tap/recompute/markFounding read the
// active book, which init points at the game it was last called with, so a second game
// object gets its own meter and brownout state instead of silently sharing them. Core's
// state/derived/registry are process singletons regardless, so two games in one process
// still share the economy; the per-game book only makes that limitation explicit.
//
// The mods bag carries two fields core's createMods does not: `inflow` (resources scales
// baseInflow by it) and `tap` (seconds of output a tap pays, ×1 by default; the tap ladder
// in milestones.js raises it and any upgrade may too). Both are re-sanitized after the fold.
// Taps draw from a meter (see tap() below) that refills at tapRefill seconds of output per
// second, so active play tops out at ×(1 + tapRefill) passive income however fast the hand.
//
// UI contract for the prestige card: read `prestigeSnapshot(derived)` (exported below; the
// same object as derived.extra.prestige) — legacy, spent, available (legacy − spent, the
// charter-perk currency), gain, can, minGain (the resolved gate), unlockAt (bar denominator;
// Infinity when founding is out of reach this run), nextAt, mult and multAfter (the real
// income multiplier now / after founding), startMoneyAfter, nextTierName / nextTierAt,
// lifetimeEarned, and nextIn / unlockIn (seconds at the current earning rate — the gross
// output a solvent city scores, earningRate() — until the next point / until founding
// arms; 0 once there, Infinity when out of reach or in deficit — a waiting target for a
// plateau city with no rung in sight). Do not rebuild the bar from
// config.prestige.threshold or the bonus from legacy × incomePerLegacy: neither is the
// formula the simulation runs.
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
  requiredGain,
  availableOf,
  foundingLine,
  peakIncomeOf,
} from './prestige.js';
import { economyTuning, prestigeTuning, foundingTuning } from './tuning.js';

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
  requiredGain,
  availableOf,
  foundingLine,
};

// The prestige situation for the dashboard (see the header). Null before the first
// recompute/tick has run, so callers can fall back to "no bank yet".
export function prestigeSnapshot(derived) {
  const x = derived && derived.extra;
  const p = x && x.prestige;
  return p && typeof p === 'object' ? p : null;
}

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
    // Opens at threshold × prestigePanelShare earned this run ($1.1M shipped); a mayor with a bank keeps the
    // panel from the first second of every replay.
    check: (state) => {
      const p = prestigeTuning(config);
      return state.stats.totalEarned >= p.threshold * p.prestigePanelShare || legacyOf(state) > 0;
    },
  },
];

// Brownout hysteresis: enter when the grid is in brownout (milestones.js isBrownout — the
// one definition the Lights Out milestone, the 'brownout' event and the log share: a grid
// exists and demand outruns it), clear at full power. The entry line is rate-limited (a
// grid flickering around capacity would otherwise spam the log); the recovery line is
// logged whenever the entry was, so a logged brownout always resolves in the log. Both
// transitions emit 'brownout' regardless of the log cooldown. The event is emitted for the
// UI (currently only a render-refresh trigger in ui/index.js REFRESH_EVENTS; nothing
// renders a grid warning off it — the topbar polls derived.powerRatio).
const BROWNOUT_LOG_COOLDOWN = 20; // game seconds between logged entries

// Precomputed unlock keys (registry is populated before simulation init).
let powerBuildingKeys = [];
let upgradeKeys = [];

// Milestones re-latch every run. The ones a veteran re-collects in the first second of a
// replay (legacy tiers, founding counts, tap rungs) carry over rather than happen: they latch
// (the rewards fold, the panel shows them reached) without a log line or a 'milestone' event,
// so a founding does not announce twelve old trophies again. A tier crossed by *this* founding
// (the bank just passed it, or the founding count just reached it) is news and still fires.
// The window opens whenever the state is rebuilt under the sim (recompute: load, import,
// hard reset, founding, init) and runs CARRY_OVER_WINDOW game seconds from state.time at
// that moment — not from t = 0, so a save loaded mid-run after a content update that added
// tiers the mayor already exceeds latches them all as old news instead of toasting each.
const CARRY_OVER_WINDOW = 1; // game seconds

// Per-game bookkeeping that is not part of the saved state (see the header). The pending
// list is a fixed array of MILESTONES indices plus a count (list order, compacted in place
// on latch), rebuilt only when something outside the tick can change state.unlocks — load,
// import, hard reset, founding — all of which go through resetRunBookkeeping and set
// pendingDirty. The tap meter fields are documented at tap() below; legacyBefore at
// markFounding(); carryOverUntil at CARRY_OVER_WINDOW above (set by recompute()).
export function createBookkeeping() {
  return {
    pending: new Int32Array(MILESTONES.length),
    pendingCount: 0,
    pendingDirty: true,
    inBrownout: false,
    brownoutLogged: false, // the current brownout got its log line
    lastBrownoutLogAt: -Infinity,
    legacyBefore: 0, // the bank before the latest founding (or at load: the whole bank)
    carryOverUntil: CARRY_OVER_WINDOW, // state.time until which re-latched tiers are old news
    tapCredit: Infinity, // seconds of output banked; clamped to the cap on the next tap
    tapCreditAt: 0, // state.time the meter was last settled
  };
}

// The active book: the game init was last called with, or a standalone one for direct
// callers (tests, tools that drive simulate/tap without a game object).
let book = createBookkeeping();
let installed = false;
let gameRef = null;

// The bookkeeping object in use (for tests and tools; never needed on the tick path).
export function bookkeeping() {
  return book;
}

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

function refreshPending(b, state) {
  const unlocks = state.unlocks;
  const pending = b.pending;
  let n = 0;
  for (let i = 0; i < MILESTONES.length; i++) if (!unlocks[MILESTONES[i].key]) pending[n++] = i;
  b.pendingCount = n;
  b.pendingDirty = false;
}

// Drop pending slot `i`, keeping list order (a handful of moves, no allocation).
function dropPending(b, i) {
  const pending = b.pending;
  const n = --b.pendingCount;
  for (let j = i; j < n; j++) pending[j] = pending[j + 1];
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
  mods.tap = 1; // seconds of output per tap, ×; read by tap() (milestone tap ladder, upgrades)
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
  if (!Number.isFinite(mods.tap) || mods.tap < 0) mods.tap = 1;
  return mods;
}

// derived.extra.prestige: { legacy, spent, available, gain, can, minGain, unlockAt, nextAt,
// mult, multAfter, lifetimeEarned, startMoneyAfter, nextTierName, nextTierAt, nextIn,
// unlockIn } — the prestige situation for the dashboard ("found a new city at $unlockAt",
// a bar that fills toward it, "next legacy point in 4 min", "◆ 12 / 40 legacy", "next
// tier: Living Archive at 5,000 legacy") without calling actions. Every field is
// closed-form, so the whole snapshot refreshes every tick.
function ensurePrestigeExtra(derived) {
  let x = derived.extra;
  if (!x || typeof x !== 'object') x = derived.extra = {};
  let p = x.prestige;
  if (!p || typeof p !== 'object') {
    p = x.prestige = {
      legacy: 0,
      spent: 0,
      available: 0,
      gain: 0,
      can: false,
      minGain: 1,
      unlockAt: 0,
      nextAt: 0,
      mult: 1,
      multAfter: 1,
      lifetimeEarned: 0,
      startMoneyAfter: 0,
      nextTierName: '',
      nextTierAt: 0,
      nextIn: Infinity,
      unlockIn: Infinity,
    };
  }
  return p;
}

// Recompute derived values without advancing time (after load, prestige, init). The state
// was rebuilt under us, so the milestone bookkeeping resyncs on the next tick too (with the
// carry-over window open from now: whatever the rebuilt state already exceeds is old news,
// see CARRY_OVER_WINDOW) and the tap meter starts full.
export function recompute(state, derived) {
  book.pendingDirty = true;
  book.carryOverUntil = (Number.isFinite(state.time) ? state.time : 0) + CARRY_OVER_WINDOW;
  resetTapMeter(book, state);
  return refreshDerived(state, derived);
}

// Fold, compute and snapshot without touching any bookkeeping.
function refreshDerived(state, derived) {
  const mods = foldMods(state);
  derived.mods = mods;
  computeDerived(state, derived, mods, config);
  prestigeStatus(state, ensurePrestigeExtra(derived), config, earningRate(derived));
  return derived;
}

// --- integration -------------------------------------------------------------

// Earnings — stats.totalEarned (the money milestones, the frontier-rung gates, the
// prestige bar) and prestige.lifetimeEarned (legacy) — are the city's gross output, and
// only while the city is net-positive. Upkeep is an operating cost like a building
// purchase, paid out of the treasury and not out of the score, so a solvent city's
// earnings are what it produces; but a city running an upkeep deficit (income ≤ 0, money
// pinned at $0) earns nothing at all, so a deficit costs the mayor something and legacy
// cannot be farmed by a city that is not paying its own way (docs/DESIGN.md principle 2:
// "legacy comes from lifetime earnings"). A tap counts in full for the same reason: its
// money reaches the treasury. Between the two the score ramps rather than steps: the
// gross counts in full once the net margin is marginRamp (0.1) of the gross and fades
// linearly to nothing at break-even, so a city hovering at zero margin on an upkeep-heavy
// grid accrues a steady trickle instead of flipping its legacy countdown between a number
// and Infinity tick by tick. The pure-net variant (max(0, income) · dt) is not the rule
// because the frontier rungs in config.upgrades are placed by the city whose earnings
// open them (unlock at cost/4 earned): shaving upkeep off the score slides a rung a city
// and leaves one with nothing new (contract: every city after the 5th introduces
// something). The greedy bot runs well inside the full-credit band, so the ramp reads
// the same as the step for it.
// stats.peakIncome (per run, like peakPop) is the best net income the city has reached;
// prestige.js sizes the next city's seed cash from it and nothing else reads it.
// Dollars per second the city scores right now (see above): the gross output, faded over
// the margin band. Also the rate the snapshot's nextIn / unlockIn countdowns are priced at,
// so "next legacy point in 4 min" is what the score actually does.
export function earningRate(derived) {
  const income = Number.isFinite(derived.income) ? derived.income : 0;
  const gross = Number.isFinite(derived.grossIncome) ? derived.grossIncome : 0;
  if (!(income > 0) || !(gross > 0)) return 0;
  const band = foundingTuning(config).marginRamp * gross;
  return income < band ? gross * (income / band) : gross;
}

function integrate(state, derived, dt) {
  const res = state.res;
  const stats = state.stats;

  const income = Number.isFinite(derived.income) ? derived.income : 0;
  const gross = Number.isFinite(derived.grossIncome) ? derived.grossIncome : 0;
  let money = res.money + income * dt;
  if (!(money > 0)) money = 0;
  res.money = money;
  if (income > 0 && !(income <= stats.peakIncome)) stats.peakIncome = income;

  const earned = earningRate(derived) * dt;
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

// Record the bank a founding started from (book.legacyBefore), so the tiers it crosses
// are announced.
export function markFounding(before) {
  book.legacyBefore = Number.isFinite(before) && before > 0 ? before : 0;
}

function justHappened(b, ms, state) {
  if (ms.metric === 'prestiges') return state.stats.prestiges === ms.target;
  if (ms.metric === 'legacy') return b.legacyBefore < ms.target;
  if (ms.metric === 'clicks') return false; // taps are a lifetime count: a replay re-collects them
  return true;
}

// Returns true when a milestone with a mods reward latched this call (the caller re-folds).
function checkMilestones(b, state, derived) {
  if (b.pendingDirty) refreshPending(b, state);
  const unlocks = state.unlocks;
  const pending = b.pending;
  const replayStart = state.stats.prestiges > 0 && state.time < b.carryOverUntil;
  let rewarded = false;
  for (let i = 0; i < b.pendingCount; i++) {
    const ms = MILESTONES[pending[i]];
    if (unlocks[ms.key]) {
      // Latched from outside the tick (a hand-edited save): nothing to announce.
      dropPending(b, i);
      i--;
      continue;
    }
    let reached = false;
    try {
      reached = ms.check(state, derived) === true;
    } catch (e) {
      reportError('milestone:' + ms.id, e);
      dropPending(b, i); // a broken check never blocks the loop
      i--;
      continue;
    }
    if (!reached) continue;
    unlocks[ms.key] = true;
    dropPending(b, i);
    i--;
    if (ms.reward) rewarded = true;
    if (replayStart && !justHappened(b, ms, state)) continue;
    addLog(ms.rewardText ? `Milestone: ${ms.name} (${ms.rewardText})` : `Milestone: ${ms.name}`, 'milestone');
    emit('milestone', ms);
  }
  return rewarded;
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

// The same predicate as the Lights Out milestone (a grid must exist: the first cottage
// draws power before any generator can be bought, and that is not a brownout worth a log
// line), so the milestone toast, the log line and the 'brownout' event always describe the
// same tick. The event is emitted for the UI (currently only a render-refresh trigger in
// ui/index.js REFRESH_EVENTS; nothing renders a grid warning off it — the topbar polls
// derived.powerRatio).
function watchGrid(b, state, derived) {
  const ratio = derived.powerRatio;
  if (!b.inBrownout) {
    if (isBrownout(derived)) {
      b.inBrownout = true;
      b.brownoutLogged = state.time - b.lastBrownoutLogAt >= BROWNOUT_LOG_COOLDOWN;
      if (b.brownoutLogged) {
        b.lastBrownoutLogAt = state.time;
        addLog(`Brownout. The grid is running at ${Math.round(ratio * 100)}%: income and growth are dimmed.`, 'brownout');
      }
      emit('brownout', { active: true, ratio });
    }
  } else if (ratio >= 1 || !(derived.powerDemand > 0)) {
    b.inBrownout = false;
    if (b.brownoutLogged) {
      b.brownoutLogged = false;
      addLog('Power restored. Every window in the city lights up at once.', 'info');
    }
    emit('brownout', { active: false, ratio });
  }
}

// --- the tick ------------------------------------------------------------------

export function simulate(state, derived, dt) {
  const b = book;
  const mods = foldMods(state);
  derived.mods = mods;
  computeDerived(state, derived, mods, config);
  integrate(state, derived, dt);
  // The snapshot is refreshed before the goals are checked, so the Founding Charter
  // milestone (and every gate) reads this tick's figures, not the previous tick's.
  const snap = ensurePrestigeExtra(derived);
  prestigeStatus(state, snap, config, earningRate(derived));
  if (checkMilestones(b, state, derived)) {
    // A reward latched: fold it now rather than a tick later, so what the frame renders
    // (and what a tap pays) already includes it, and refresh the snapshot's "next point
    // in" / "founding arms in" countdowns off the rewarded income rather than the
    // pre-reward figure. Rare — once per milestone per run; closed-form, no allocation.
    derived.mods = foldMods(state);
    computeDerived(state, derived, derived.mods, config);
    prestigeStatus(state, snap, config, earningRate(derived));
  }
  checkGates(state, derived);
  watchGrid(b, state, derived);
}

// --- actions -------------------------------------------------------------------

// Seconds of gross output one tap is worth: tapSeconds × mods.tap (the tap ladder in
// milestones.js and any upgrade that scales mods.tap). Exported for the UI's hint text.
export function tapSecondsFor(derived) {
  const mods = derived && derived.mods;
  const mult = mods && Number.isFinite(mods.tap) && mods.tap > 0 ? mods.tap : 1;
  return economyTuning(config).tapSeconds * mult;
}

// The tap meter. A tap draws its seconds of output from a meter that holds one full tap
// (tapSecondsFor) and refills at economyTuning.tapRefill seconds of output per game
// second (2 shipped, tuning.js TAP_REFILL). A single tap after a pause pays the ladder's
// full value — five seconds of income feels like something — while a hand or an
// autoclicker at any speed adds at most ×tapRefill the passive income on top of it: the
// late game stays idle-shaped and legacy is not clicked into existence. Not saved: a
// load or a founding starts with a full meter. Timed on state.time (game seconds), so
// the meter is deterministic in the Node sim and in verify. Lives in the book as
// tapCredit (seconds of output banked; clamped to the cap on the next tap) and
// tapCreditAt (state.time the meter was last settled).
function resetTapMeter(b, state) {
  b.tapCredit = Infinity;
  b.tapCreditAt = Number.isFinite(state.time) ? state.time : 0;
}

// The meter as the UI may show it: { credit, cap, refill } in seconds of output, settled
// to now. Allocates; call from a render, not a tick.
export function tapMeter(state, derived) {
  const cap = tapSecondsFor(derived);
  return { credit: settleTapMeter(book, state, cap), cap, refill: economyTuning(config).tapRefill };
}

function settleTapMeter(b, state, cap) {
  const now = Number.isFinite(state.time) ? state.time : 0;
  const dt = now - b.tapCreditAt;
  b.tapCreditAt = now;
  let credit = b.tapCredit + (dt > 0 ? dt * economyTuning(config).tapRefill : 0);
  if (!(credit < cap)) credit = cap; // also lands the Infinity of a fresh meter on the cap
  if (!(credit > 0)) credit = 0;
  b.tapCredit = credit;
  return credit;
}

// A tap pays up to tapSecondsFor(derived) seconds of *gross* output — as much as the
// meter holds — with a floor of $1: a city running an upkeep deficit still taps for what
// it produces, and a drained meter (or a city with no output yet) still gives the dollar
// that bootstraps a fresh plot. Tap money is earnings like any other: it counts toward
// totalEarned (the money milestones) and lifetimeEarned (legacy) — in full, deficit or
// not, because every tapped dollar reaches the treasury (integrate() counts the passive
// output only while the city is net-positive); upkeep is charged by the tick, not by the
// tap.
export function tap(state, derived) {
  const b = book;
  const gross = Number.isFinite(derived.grossIncome) ? derived.grossIncome : 0;
  const value = tapSecondsFor(derived);
  const credit = settleTapMeter(b, state, value);
  const paid = credit < value ? credit : value;
  b.tapCredit = credit - paid;
  const gain = Math.max(1, gross * paid);
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
  tutorial: (v) => (typeof v === 'boolean' ? v : null),
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
  const b = book;
  b.inBrownout = false;
  b.brownoutLogged = false;
  b.lastBrownoutLogAt = -Infinity;
  b.pendingDirty = true;
  refreshKeys();
  recompute(state, derived);
}

// --- init ----------------------------------------------------------------------

// Idempotent per game object: a second init(game) with the same game re-points the actions
// at it and re-registers the handler (registry replaces by name) but keeps its book, so a
// tap meter half-drained or a brownout in progress is not reset by a re-init. A different
// game object gets its own book (see the header for what that does and does not isolate).
export function init(game) {
  try {
    if (!game || !game.state || !game.derived) return;
    const again = gameRef === game && game._sim === book;
    gameRef = game;
    if (!game._sim || typeof game._sim !== 'object') game._sim = createBookkeeping();
    book = game._sim;
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

    if (again) {
      refreshDerived(state, derived); // derived may be stale; the book's run state stands
      game.milestones = MILESTONES;
      return;
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
