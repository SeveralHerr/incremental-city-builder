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
import { registry } from '../core/registry.js';
import { buildingMod } from '../core/mods.js';
import { milestoneTuning, prestigeTuning } from './tuning.js';

export const MILESTONE_PREFIX = 'm:';

export function milestoneKey(id) {
  return MILESTONE_PREFIX + id;
}

export function isMilestoneReached(state, id) {
  return !!(state && state.unlocks && state.unlocks[MILESTONE_PREFIX + id]);
}

// --- tuning ------------------------------------------------------------------

function popIncomeBonus() {
  return milestoneTuning().popIncomeBonus;
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
const legacyOf = (s) => (s && s.prestige && Number.isFinite(s.prestige.legacy) ? s.prestige.legacy : 0);

// Allocation-free "owns at least one upgrade".
function ownsAnyUpgrade(s) {
  const u = s && s.upgrades;
  if (!u) return false;
  for (const k in u) if (u[k]) return true;
  return false;
}

// "Demand outruns the grid": a grid must exist. The windmill only unlocks once something draws
// power, so the very first cottage always sits on a capacity of zero for a tick or two; that
// is not a brownout worth a milestone (and would fire Lights Out at t=0 for every player).
export function isBrownout(derived) {
  return !!derived && derived.powerDemand > 0 && derived.powerCap > 0 && derived.powerRatio < 1;
}

// How close the grid is to a brownout (demand / capacity). 1 once the lights actually dim.
function brownoutProgress(state, derived) {
  if (!derived) return 0;
  if (isBrownout(derived)) return 1;
  const demand = derived.powerDemand;
  const cap = derived.powerCap;
  if (!(demand > 0) || !(cap > 0)) return 0;
  return Math.min(1, demand / cap);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// The prestige snapshot the simulation keeps in derived.extra.prestige (null until the
// first tick has run).
const prestigeExtra = (d) => (d && d.extra && d.extra.prestige && typeof d.extra.prestige === 'object' ? d.extra.prestige : null);

// This run's earnings at which founding arms. The live figure comes from the snapshot
// (it accounts for the bank, the share-of-bank gate and the earlier runs' earnings;
// Infinity when founding is out of reach this run, which reads as no progress); before the
// first tick the figure for a fresh mayor — threshold · minGain^(1/exponent) — stands in.
function foundingUnlockAt(derived) {
  const x = prestigeExtra(derived);
  if (x && x.unlockAt > 0) return x.unlockAt;
  const p = prestigeTuning();
  return p.threshold * Math.pow(p.minGain, 1 / p.exponent);
}

function canFound(derived) {
  const x = prestigeExtra(derived);
  return !!x && x.can === true;
}

// --- reward helpers -----------------------------------------------------------

const incomeReward = (mult) => (mods) => {
  mods.income *= mult;
};

const costReward = (mult) => (mods) => {
  mods.cost *= mult;
};

const happinessReward = (add) => (mods) => {
  mods.happiness += add;
};

// Every polluting building (negative per-unit happiness) emits `frac` less. Allocates one
// byBuilding entry per polluter per tick, the same sanctioned exception upgrades use.
function cleanAirReward(frac) {
  return (mods) => {
    const order = registry.buildingOrder;
    for (let i = 0; i < order.length; i++) {
      const def = registry.buildings.get(order[i]);
      if (!def || !(def.happiness < 0)) continue;
      buildingMod(mods, def.id).happiness += -def.happiness * frac;
    }
  };
}

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

function moneyMilestone(id, target, name, icon, desc, rewardText, reward) {
  return {
    id,
    name,
    icon,
    desc,
    metric: 'totalEarned',
    target,
    check: (state) => earnedOf(state) >= target,
    progress: (state) => clamp01(earnedOf(state) / target),
    reward,
    rewardText,
  };
}

function buildMilestone(id, target, name, icon, desc, rewardText, reward) {
  return {
    id,
    name,
    icon,
    desc,
    metric: 'buildings',
    target,
    check: (state) => builtOf(state) >= target,
    progress: (state) => clamp01(builtOf(state) / target),
    reward,
    rewardText,
  };
}

function prestigeMilestone(id, target, name, icon, desc, rewardText, reward) {
  return {
    id,
    name,
    icon,
    desc,
    metric: 'prestiges',
    target,
    check: (state) => prestigesOf(state) >= target,
    progress: (state) => clamp01(prestigesOf(state) / target),
    reward,
    rewardText,
  };
}

// Banked legacy tiers. Latched per run like every milestone, so a veteran mayor collects
// them in the first second of a replay and they show as reached in the list.
function legacyMilestone(id, target, name, icon, desc, rewardText, reward) {
  return {
    id,
    name,
    icon,
    desc,
    metric: 'legacy',
    target,
    check: (state) => legacyOf(state) >= target,
    progress: (state) => clamp01(legacyOf(state) / target),
    reward,
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
    check: (state, derived) => isBrownout(derived),
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
  moneyMilestone('money-1m', 1e6, 'Millionaire Mayor', '🏦', 'Earn $1,000,000 in total.', 'Unlocks Prefab Construction'),
  popMilestone('pop-10k', 10000, 'Ten Thousand Stories', '🏙️', 'Ten thousand citizens, each with somewhere to be.'),
  {
    // Founding arms once a reset would bank the required points (minGain for a fresh mayor:
    // $3M at the shipped numbers, past the $1M milestone; a share of the bank for a veteran),
    // so the goal that promises founding is the one that tracks the real gate. Per run, like
    // every milestone: a veteran collects it again once a replay has earned its way there.
    id: 'founding-charter',
    name: 'Founding Charter',
    icon: '📯',
    desc: 'Earn enough this run to found a new city.',
    metric: 'founding',
    target: 1,
    check: (state, derived) => canFound(derived),
    progress: (state, derived) => (canFound(derived) ? 1 : clamp01(earnedOf(state) / foundingUnlockAt(derived))),
    rewardText: 'Unlocks founding a new city',
  },
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
  moneyMilestone('money-1t', 1e12, 'Trillion Club', '🪐', 'Earn $1,000,000,000,000 in total.', '+10% income', incomeReward(1.1)),
  // Beyond the first ladder: the horizon for a mayor with a legacy bank. Interleaved with
  // the founding tiers in roughly the order a veteran's runs reach them. The legacy tiers
  // run 5 → 1,000,000 points ×2.5–3.3 apart: legacy comes from lifetime earnings only
  // (floor((lifetime / threshold) ^ exponent)), so a bank that grows by a quarter per
  // founding reaches a new tier every four or five foundings, and every late reset has a
  // target in sight that pays out something a player can read on the dashboard.
  legacyMilestone('legacy-5', 5, 'Old Hands', '🧭', 'Bank five legacy points.', 'All buildings cost −5%', costReward(0.95)),
  buildMilestone('buildings-1k', 1000, 'Thousand Rooftops', '🏘️', 'Raise a thousand structures.', '+5% income', incomeReward(1.05)),
  prestigeMilestone('prestige-5', 5, 'Serial Founder', '🏁', 'Found five cities.', '+10% income', incomeReward(1.1)),
  legacyMilestone('legacy-15', 15, 'Clean Air Act', '🍃', 'Bank fifteen legacy points.', 'Polluting buildings emit 25% less smog', cleanAirReward(0.25)),
  popMilestone('pop-10m', 1e7, 'Ten Million Voices', '🎆', 'Ten million citizens. The city has its own time zone.'),
  legacyMilestone('legacy-50', 50, 'Civic Memory', '🏺', 'Bank fifty legacy points.', '+0.15 happiness', happinessReward(0.15)),
  prestigeMilestone('prestige-10', 10, 'Founding Dynasty', '🏰', 'Found ten cities.', '+15% income', incomeReward(1.15)),
  moneyMilestone('money-10t', 1e13, 'Ten Trillion', '💫', 'Earn $10,000,000,000,000 in total.', '+10% income', incomeReward(1.1)),
  legacyMilestone('legacy-150', 150, 'Scrubber Mandate', '🌬️', 'Bank 150 legacy points.', 'Polluting buildings emit another 25% less smog', cleanAirReward(0.25)),
  buildMilestone('buildings-10k', 10000, 'Endless Skyline', '🌉', 'Raise ten thousand structures.', '+10% income', incomeReward(1.1)),
  legacyMilestone('legacy-500', 500, 'Storied Skyline', '📚', 'Bank 500 legacy points.', 'All buildings cost another −10%', costReward(0.9)),
  popMilestone('pop-100m', 1e8, 'Continental City', '🗺️', 'A hundred million citizens. Borders are a rumour.'),
  moneyMilestone('money-100t', 1e14, 'Hundred Trillion', '✨', 'Earn $100,000,000,000,000 in total.', '+15% income', incomeReward(1.15)),
  prestigeMilestone('prestige-25', 25, 'Eternal Mayor', '♾️', 'Found twenty-five cities.', '+25% income', incomeReward(1.25)),
  legacyMilestone('legacy-1500', 1500, 'Carbon Capture', '🌱', 'Bank 1,500 legacy points.', 'Polluting buildings emit another 25% less smog', cleanAirReward(0.25)),
  moneyMilestone('money-1qa', 1e15, 'Quadrillionaire', '🌠', 'Earn $1,000,000,000,000,000 in total.', '+20% income', incomeReward(1.2)),
  legacyMilestone('legacy-5000', 5000, 'Thousand-Year City', '🕰️', 'Bank 5,000 legacy points.', 'Polluting buildings emit 90% less smog in all', cleanAirReward(0.15)),
  prestigeMilestone('prestige-50', 50, 'Fifty Skylines', '🌁', 'Found fifty cities.', '+25% income', incomeReward(1.25)),
  legacyMilestone('legacy-15k', 15000, "Founders' Row", '🏗️', 'Bank 15,000 legacy points.', 'All buildings cost another −10%', costReward(0.9)),
  moneyMilestone('money-10qa', 1e16, 'Ten Quadrillion', '💠', 'Earn $10,000,000,000,000,000 in total.', '+20% income', incomeReward(1.2)),
  legacyMilestone('legacy-50k', 50000, 'Living Archive', '📖', 'Bank 50,000 legacy points.', '+25% income', incomeReward(1.25)),
  moneyMilestone('money-100qa', 1e17, 'Hundred Quadrillion', '🔭', 'Earn $100,000,000,000,000,000 in total.', '+25% income', incomeReward(1.25)),
  legacyMilestone('legacy-150k', 150000, 'Founder of Legend', '🌟', 'Bank 150,000 legacy points.', '+0.25 happiness', happinessReward(0.25)),
  legacyMilestone('legacy-400k', 400000, 'City of Cities', '🪐', 'Bank 400,000 legacy points.', 'Population grows +50% faster', (mods) => {
    mods.growth *= 1.5;
  }),
  legacyMilestone('legacy-1m', 1e6, 'Millionfold Legacy', '👑', 'Bank a million legacy points.', '+100% income', incomeReward(2)),
];

// Legacy tiers in ascending order of target (the ladder above is interleaved by pacing).
export const LEGACY_MILESTONES = MILESTONES.filter((m) => m.metric === 'legacy').sort((a, b) => a.target - b.target);

// The first legacy tier a bank of `legacy` points has not reached, or null past the last.
export function nextLegacyMilestone(legacy) {
  const n = Number.isFinite(legacy) && legacy > 0 ? legacy : 0;
  for (let i = 0; i < LEGACY_MILESTONES.length; i++) {
    if (LEGACY_MILESTONES[i].target > n) return LEGACY_MILESTONES[i];
  }
  return null;
}

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
