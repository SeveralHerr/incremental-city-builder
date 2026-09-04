// Milestones — the goals that mark a city's growth and expand the dashboard.
// DOM-free, pure data plus tiny pure functions.
//
// Each entry: { id, name, icon, desc, metric, target, check(state, derived) -> boolean,
//   progress(state, derived) -> 0..1, reward?(mods) -> void, rewardText? }
//
// Latched by simulation in `state.unlocks['m:' + id]`; on reach it logs, emits 'milestone'
// with the definition itself, and keeps folding `reward` into the mods bag every tick.
// The ids below are a contract: the upgrades module reads them in its unlock rules
// (pop-100, pop-1k, pop-10k, pop-100k, money-1k, money-100k, money-1m, money-1b, brownout,
// first-upgrade, buildings-100, prestige-1). `metric` + `target` (and `progress`) feed the
// UI's progress bars. Listed in roughly the order a growing city reaches them, because the
// UI shows the first few unreached entries as "next".
import { config } from '../balance/config.js';

export const MILESTONE_PREFIX = 'm:';

export function milestoneKey(id) {
  return MILESTONE_PREFIX + id;
}

export function isMilestoneReached(state, id) {
  return !!(state && state.unlocks && state.unlocks[MILESTONE_PREFIX + id]);
}

// --- tuning ------------------------------------------------------------------

function popIncomeBonus() {
  const v = config && config.milestones ? config.milestones.popIncomeBonus : undefined;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0.02;
}

function pctText(x) {
  const p = x * 100;
  return (Number.isInteger(p) ? p : +p.toFixed(1)) + '%';
}

// --- safe readers (tolerate a partially-built state/derived) -----------------

const popOf = (s) => (s && s.res && Number.isFinite(s.res.pop) ? s.res.pop : 0);
const earnedOf = (s) => (s && s.stats && Number.isFinite(s.stats.totalEarned) ? s.stats.totalEarned : 0);
const builtOf = (s) => (s && s.stats && Number.isFinite(s.stats.buildingsBuilt) ? s.stats.buildingsBuilt : 0);
const prestigesOf = (s) => (s && s.stats && Number.isFinite(s.stats.prestiges) ? s.stats.prestiges : 0);

// Allocation-free "owns at least one upgrade".
function ownsAnyUpgrade(s) {
  const u = s && s.upgrades;
  if (!u) return false;
  for (const k in u) if (u[k]) return true;
  return false;
}

// How close the grid is to a brownout (demand / capacity). 1 once the lights actually dim.
function brownoutProgress(state, derived) {
  if (!derived) return 0;
  if (derived.powerRatio < 1) return 1;
  const demand = derived.powerDemand;
  const cap = derived.powerCap;
  if (!(demand > 0)) return 0;
  if (!(cap > 0)) return 1;
  return Math.min(1, demand / cap);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// --- builders ----------------------------------------------------------------

function popMilestone(id, target, name, icon, desc) {
  const bonus = popIncomeBonus();
  return {
    id,
    name,
    icon,
    desc,
    metric: 'pop',
    target,
    check: (state) => popOf(state) >= target,
    progress: (state) => clamp01(popOf(state) / target),
    reward: (mods) => {
      mods.income *= 1 + popIncomeBonus();
    },
    rewardText: `+${pctText(bonus)} income`,
  };
}

function moneyMilestone(id, target, name, icon, desc, rewardText) {
  return {
    id,
    name,
    icon,
    desc,
    metric: 'totalEarned',
    target,
    check: (state) => earnedOf(state) >= target,
    progress: (state) => clamp01(earnedOf(state) / target),
    rewardText,
  };
}

function buildMilestone(id, target, name, icon, desc, rewardText) {
  return {
    id,
    name,
    icon,
    desc,
    metric: 'buildings',
    target,
    check: (state) => builtOf(state) >= target,
    progress: (state) => clamp01(builtOf(state) / target),
    rewardText,
  };
}

// --- the list ----------------------------------------------------------------

export const MILESTONES = [
  popMilestone('pop-10', 10, 'First Neighbors', '🏡', 'Ten citizens call the plot home.'),
  buildMilestone('buildings-10', 10, 'Breaking Ground', '🏗️', 'Raise ten structures.', 'The skyline starts to show'),
  {
    id: 'first-upgrade',
    name: 'Civic Improvement',
    icon: '📜',
    desc: 'Approve your first upgrade.',
    metric: 'upgrades',
    target: 1,
    check: (state) => ownsAnyUpgrade(state),
    progress: (state) => (ownsAnyUpgrade(state) ? 1 : 0),
    rewardText: 'Unlocks Grant Writing',
  },
  popMilestone('pop-50', 50, 'Village Green', '🌿', 'Fifty citizens and a proper main street.'),
  moneyMilestone('money-1k', 1e3, 'First Thousand', '💵', 'Earn $1,000 in total.', 'Unlocks Tax Software'),
  {
    id: 'brownout',
    name: 'Lights Out',
    icon: '🔌',
    desc: 'Demand outruns the grid for the first time.',
    metric: 'brownout',
    target: 1,
    check: (state, derived) => !!derived && derived.powerDemand > 0 && derived.powerRatio < 1,
    progress: brownoutProgress,
    rewardText: 'Unlocks Smart Grid',
  },
  popMilestone('pop-100', 100, 'A Hundred Strong', '👥', 'A hundred citizens. Someone starts a newsletter.'),
  moneyMilestone('money-10k', 1e4, 'Balanced Books', '📒', 'Earn $10,000 in total.', 'The treasury hires an accountant'),
  popMilestone('pop-500', 500, 'Town Charter', '📜', 'Five hundred citizens. The county sends a letter.'),
  buildMilestone('buildings-100', 100, 'Construction Boom', '🚧', 'Raise a hundred structures.', 'Unlocks Bulk Permits'),
  popMilestone('pop-1k', 1000, 'Thousand Lights', '🌃', 'A thousand windows glow after dark.'),
  moneyMilestone('money-100k', 1e5, 'Six Figures', '💰', 'Earn $100,000 in total.', 'The council starts talking legacy'),
  popMilestone('pop-5k', 5000, 'City Limits', '🛣️', 'Five thousand citizens and a ring road.'),
  moneyMilestone('money-1m', 1e6, 'Millionaire Mayor', '🏦', 'Earn $1,000,000 in total.', 'Unlocks Prefab Construction and founding a new city'),
  popMilestone('pop-10k', 10000, 'Ten Thousand Stories', '🏙️', 'Ten thousand citizens, each with somewhere to be.'),
  {
    id: 'prestige-1',
    name: 'New Foundations',
    icon: '🚩',
    desc: 'Found a new city for the first time.',
    metric: 'prestiges',
    target: 1,
    check: (state) => prestigesOf(state) >= 1,
    progress: (state) => clamp01(prestigesOf(state)),
    rewardText: 'Unlocks Legacy upgrades and the Fusion Reactor',
  },
  popMilestone('pop-50k', 50000, 'Skyline Rising', '🌆', 'Fifty thousand citizens. Cranes on every block.'),
  popMilestone('pop-100k', 100000, 'Grand Metropolis', '🌇', 'A hundred thousand citizens and a subway map.'),
  moneyMilestone('money-1b', 1e9, 'Billion-Dollar Budget', '🏛️', 'Earn $1,000,000,000 in total.', 'Unlocks AI Governance'),
  popMilestone('pop-1m', 1e6, 'One in a Million', '🌌', 'A million citizens. The lights never go out.'),
  moneyMilestone('money-1t', 1e12, 'Trillion Club', '🪐', 'Earn $1,000,000,000,000 in total.', 'The history books run out of pages'),
];

// Precomputed unlock keys so the per-tick loops never build strings.
for (const m of MILESTONES) m.key = MILESTONE_PREFIX + m.id;

export const MILESTONE_BY_ID = new Map(MILESTONES.map((m) => [m.id, m]));

export function getMilestone(id) {
  return MILESTONE_BY_ID.get(id) || null;
}

// Milestones that carry a mods reward (folded each tick while latched).
export const REWARDED_MILESTONES = MILESTONES.filter((m) => typeof m.reward === 'function');

// Unreached milestones for a given state, in list order. Allocates; call on load/reset only.
export function pendingMilestones(state) {
  const out = [];
  const unlocks = (state && state.unlocks) || {};
  for (const m of MILESTONES) if (!unlocks[m.key]) out.push(m);
  return out;
}

// Fold every latched milestone reward into the mods bag. Allocation-free.
export function applyMilestoneMods(mods, state) {
  const unlocks = state && state.unlocks;
  if (!unlocks) return mods;
  for (let i = 0; i < REWARDED_MILESTONES.length; i++) {
    const m = REWARDED_MILESTONES[i];
    if (unlocks[m.key]) m.reward(mods);
  }
  return mods;
}
