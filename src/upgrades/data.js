// Upgrade definitions for Metropolis. DOM-free, pure data + tiny pure functions.
//
// Every entry: { id, name, icon, desc (≤70 chars, states the exact effect), cost, category,
//   tier, unlock(state, derived) -> boolean, effect(mods, state) -> void }
//
// Effects only mutate the mods bag (see src/core/mods.js). Unlock rules read state counts,
// population, lifetime earnings, prestige legacy and latched milestone flags. Each milestone
// check has a direct-state fallback so the ladder works even if the simulation module names
// a milestone differently; the flags below are the ids we expect simulation to latch as
// `state.unlocks['m:' + id]`.
//
// Costs: the defaults here match the tuned ladder in src/balance/config.js (config wins when
// both exist), so the file is self-consistent on its own: $25 → $5e8 for the 45-rung core
// ladder, then a "horizon" ladder (Civic Bonds I–XXX and Skyline Expansion I–V, see the
// generators below) priced in seconds of the run's current income and issued on a schedule
// after founding — so every city, however deep into the game, has something new to fund
// every few minutes until the next reset.
import { buildingMod } from '../core/mods.js';

export const MILESTONE_IDS = [
  'pop-100',
  'pop-1k',
  'pop-10k',
  'pop-100k',
  'money-1k',
  'money-100k',
  'money-1m',
  'money-1b',
  'brownout',
  'first-upgrade',
  'buildings-100',
  'prestige-1',
];

export const UPGRADE_CATEGORIES = [
  { id: 'residential', name: 'Residential', icon: '🏠', color: '#60a5fa' },
  { id: 'commercial', name: 'Commercial', icon: '🏪', color: '#4ade80' },
  { id: 'industrial', name: 'Industrial', icon: '🏭', color: '#fb923c' },
  { id: 'power', name: 'Power', icon: '⚡', color: '#facc15' },
  { id: 'civic', name: 'Civic', icon: '🏛️', color: '#c084fc' },
  { id: 'global', name: 'City Hall', icon: '🏙️', color: '#e2e8f0' },
  { id: 'prestige', name: 'Legacy', icon: '🌟', color: '#fbbf24' },
];

// ---------- unlock helpers (all tolerate partially-built state/derived) ----------

const count = (state, id) => (state && state.buildings && state.buildings[id]) || 0;
const pop = (state) => (state && state.res && state.res.pop) || 0;
const earned = (state) => (state && state.stats && state.stats.totalEarned) || 0;
const built = (state) => (state && state.stats && state.stats.buildingsBuilt) || 0;
const legacy = (state) => (state && state.prestige && state.prestige.legacy) || 0;
const milestone = (state, id) => !!(state && state.unlocks && state.unlocks['m:' + id]);
const ownedUpgrades = (state) => (state && state.upgrades ? Object.keys(state.upgrades).length : 0);
const owns = (id) => (state) => !!(state && state.upgrades && state.upgrades[id]);

const hasBuilt = (id, n) => (state) => count(state, id) >= n;
const hasPop = (n, ms) => (state) => pop(state) >= n || (ms ? milestone(state, ms) : false);
const hasEarned = (n, ms) => (state) => earned(state) >= n || (ms ? milestone(state, ms) : false);
const hasLegacy = (n) => (state) => legacy(state) >= n || (n <= 1 && milestone(state, 'prestige-1'));
const hasDemand = (mw) => (state, derived) => !!derived && Number.isFinite(derived.powerDemand) && derived.powerDemand >= mw;
const any = (...fns) => (state, derived) => fns.some((f) => f(state, derived) === true);
const all = (...fns) => (state, derived) => fns.every((f) => f(state, derived) === true);
// Seconds since this city was founded (state.time is per run; a founding resets it).
const runAge = (seconds) => (state) => ((state && Number.isFinite(state.time) ? state.time : 0) >= seconds);

// ---------- effect helpers ----------

const incomeOf = (id, mult) => (mods) => {
  buildingMod(mods, id).income *= mult;
};
const housingOf = (id, mult) => (mods) => {
  buildingMod(mods, id).housing *= mult;
};
const jobsOf = (id, mult) => (mods) => {
  buildingMod(mods, id).jobs *= mult;
};
const powerOf = (id, mult) => (mods) => {
  buildingMod(mods, id).power *= mult;
};
// Per-unit additive happiness on a building (resources applies byBuilding.happiness per unit).
// Descriptions quote the literal per-unit number, never a percentage, because the base
// value lives in src/buildings/data.js and config.buildings may override it.
const happinessOf = (id, add) => (mods) => {
  buildingMod(mods, id).happiness += add;
};
const global = (key, mult) => (mods) => {
  mods[key] *= mult;
};
const compose = (...fns) => (mods, state) => {
  for (const f of fns) f(mods, state);
};

// ---------- horizon ladder generators ----------
//
// The late-cycle horizon has to survive two things a dollar ladder cannot: prestige
// multiplies income by a legacy-scaled factor and seeds each city with legacy-scaled
// cash, so any fixed price is eventually a rounding error (a 300-legacy city funds a $5e8
// rung in a second, a 30,000-legacy city a $5e13 one); and a greedy player who never saves
// keeps their cash at the building-price frontier — a few seconds of income — so anything
// priced above that is never in hand. So the horizon rungs are:
//
//   • priced in income, not dollars: `priced: { seconds, floor }` means the registered cost
//     is `max(floor, seconds × current income)` (index.js keeps it in sync every tick);
//     a rung at 2 s of income is a visible spend at any legacy and still lands
//     inside the frontier of a player who builds every tick;
//   • paced by an issue schedule, not by money: rung n opens `bondOpensAt(n)` seconds
//     after founding (II at 3 min, rising 13% per rung: X at 8 min, XX at 27 min, XXX at
//     92 min), and only after the previous rung is owned, so however rich the city the
//     ladder arrives one proposal every one to ten minutes for the whole life of a run and
//     a founding resets it with the run.
//
// Civic Bonds I–XXX give +25% income each — the treadmill that keeps a plateaued city's
// income climbing between foundings. Skyline Expansion I–V (+50% housing and jobs)
// interleave every second bond so the ladder is not thirty identical cards.

const ROMAN_DIGITS = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];
export const roman = (n) => {
  let v = Math.max(1, Math.floor(n));
  let out = '';
  for (const [value, glyph] of ROMAN_DIGITS) while (v >= value) { out += glyph; v -= value; }
  return out;
};

export const BOND_RUNGS = 30;
export const BOND_FLOOR = 1e7; // never free: a city in the red or mid-brownout still pays this
export const BOND_SECONDS = 2; // every horizon rung costs two seconds of current income
const BOND_OPEN_2 = 180; // rung II opens three minutes after founding
const BOND_OPEN_STEP = 1.13; // each later rung opens 13% later than the one before
// Seconds after founding at which rung n may be issued (rung I has no schedule: it opens
// with the Planetary Charter or $1B earned).
export const bondOpensAt = (n) => (n <= 1 ? 0 : Math.round(BOND_OPEN_2 * Math.pow(BOND_OPEN_STEP, n - 2)));

// Price of an income-priced rung for the current run (pure; index.js applies it each tick).
// Uses net income (derived.income) and never goes below the floor, so a city in the red or
// mid-brownout still sees a finite, sane price.
export function horizonCost(def, derived) {
  const p = def && def.priced;
  if (!p) return def ? def.cost : NaN;
  const income = derived && Number.isFinite(derived.income) && derived.income > 0 ? derived.income : 0;
  const cost = Math.max(p.floor, p.seconds * income);
  return Number.isFinite(cost) && cost > 0 ? cost : p.floor;
}

const opensLabel = (sec) => (sec >= 120 ? `${Math.round(sec / 60)} min` : `${sec} s`);

// Rung I opens once the Planetary Charter is funded (or a run has earned $1B); every later
// rung follows the one before it on the issue schedule, so only one bond is ever on offer.
const civicBond = (n) => {
  const opens = bondOpensAt(n);
  return {
    id: `civic-bonds-${n}`,
    name: `Civic Bonds ${roman(n)}`,
    icon: '💰',
    desc: n === 1 ? 'All income +25%' : `All income +25% · issue opens ${opensLabel(opens)} after founding`,
    cost: BOND_FLOOR,
    category: 'global',
    tier: 4,
    priced: { seconds: BOND_SECONDS, floor: BOND_FLOOR },
    unlock: n === 1 ? any(owns('planetary-charter'), hasEarned(1e9, 'money-1b')) : all(owns(`civic-bonds-${n - 1}`), runAge(opens)),
    effect: global('income', 1.25),
  };
};

// Skyline Expansion n is issued alongside Civic Bonds 2n.
const skyline = (n) => ({
  id: `skyline-expansion-${n}`,
  name: `Skyline Expansion ${roman(n)}`,
  icon: '🌆',
  desc: `All housing and jobs +50% · issued with Civic Bonds ${roman(2 * n)}`,
  cost: BOND_FLOOR,
  category: 'residential',
  tier: 4,
  priced: { seconds: BOND_SECONDS, floor: BOND_FLOOR },
  unlock: owns(`civic-bonds-${2 * n}`),
  effect: compose(global('housing', 1.5), global('jobs', 1.5)),
});

const HORIZON = [];
for (let n = 1; n <= BOND_RUNGS; n++) {
  HORIZON.push(civicBond(n));
  if (n % 2 === 0 && n / 2 <= 5) HORIZON.push(skyline(n / 2));
}

// ---------- definitions (ordered by cost; ladder $25 → $5e8, then the income-priced horizon) ----------

export const UPGRADES = [
  // ===== Early game ($25 – $3k): first ten minutes =====
  {
    id: 'welcome-sign',
    name: 'Welcome Sign',
    icon: '🪧',
    desc: 'Population grows +50% faster',
    cost: 25,
    category: 'global',
    tier: 1,
    unlock: hasBuilt('house', 2),
    effect: global('growth', 1.5),
  },
  {
    id: 'zoning-reform',
    name: 'Zoning Reform',
    icon: '📐',
    desc: 'Houses hold +25% residents',
    cost: 50,
    category: 'residential',
    tier: 1,
    unlock: hasBuilt('house', 4),
    effect: housingOf('house', 1.25),
  },
  {
    id: 'neon-signage',
    name: 'Neon Signage',
    icon: '🪧',
    desc: 'Shops earn +50% income',
    cost: 80,
    category: 'commercial',
    tier: 1,
    unlock: hasBuilt('shop', 3),
    effect: incomeOf('shop', 1.5),
  },
  {
    id: 'grant-writing',
    name: 'Grant Writing',
    icon: '✍️',
    desc: 'All income +20%',
    cost: 150,
    category: 'global',
    tier: 1,
    unlock: (state) => milestone(state, 'first-upgrade') || ownedUpgrades(state) >= 1,
    effect: global('income', 1.2),
  },
  {
    id: 'tax-software',
    name: 'Tax Software',
    icon: '🧾',
    desc: 'All income +25%',
    cost: 250,
    category: 'global',
    tier: 1,
    unlock: any(hasEarned(1000, 'money-1k'), hasPop(50)),
    effect: global('income', 1.25),
  },
  {
    id: 'turbine-blades',
    name: 'Carbon Turbine Blades',
    icon: '🌬️',
    desc: 'Windmills generate ×2 power',
    cost: 300,
    category: 'power',
    tier: 1,
    unlock: hasBuilt('windmill', 2),
    effect: powerOf('windmill', 2),
  },
  {
    id: 'smart-grid',
    name: 'Smart Grid',
    icon: '🔌',
    desc: 'All buildings use −15% power',
    cost: 400,
    category: 'power',
    tier: 1,
    // Three doors in: the Lights Out milestone (or a live brownout on an existing grid —
    // powerCap > 0 so the first cottage on an empty plot does not unlock it at t=0), a
    // sizeable windmill fleet, or 40 MW of demand — a mayor who keeps the lights on still
    // gets to buy it.
    unlock: any(
      (state, derived) => milestone(state, 'brownout') || (!!derived && derived.powerCap > 0 && derived.powerRatio < 1),
      hasBuilt('windmill', 6),
      hasDemand(40)
    ),
    effect: global('demand', 0.85),
  },
  {
    id: 'community-events',
    name: 'Community Events',
    icon: '🎪',
    desc: 'Happiness +0.1',
    cost: 500,
    category: 'civic',
    tier: 1,
    unlock: hasBuilt('park', 1),
    effect: (mods) => {
      mods.happiness += 0.1;
    },
  },
  {
    id: 'assembly-lines',
    name: 'Assembly Lines',
    icon: '⚙️',
    desc: 'Factories earn +75% income',
    cost: 600,
    category: 'industrial',
    tier: 1,
    unlock: hasBuilt('factory', 3),
    effect: incomeOf('factory', 1.75),
  },
  {
    id: 'franchising',
    name: 'Franchising',
    icon: '🏪',
    desc: 'Shops and offices provide +30% jobs',
    cost: 1200,
    category: 'commercial',
    tier: 2,
    unlock: any(hasPop(100, 'pop-100'), hasBuilt('office', 1)),
    effect: compose(jobsOf('shop', 1.3), jobsOf('office', 1.3)),
  },
  {
    id: 'green-belts',
    name: 'Green Belts',
    icon: '🌳',
    desc: 'Parks give +0.05 happiness each',
    cost: 1500,
    category: 'civic',
    tier: 2,
    unlock: hasBuilt('park', 4),
    effect: happinessOf('park', 0.05),
  },
  {
    id: 'farmers-market',
    name: 'Farmers Market',
    icon: '🥕',
    desc: 'Shops earn +100% income',
    cost: 3000,
    category: 'commercial',
    tier: 2,
    unlock: hasBuilt('shop', 15),
    effect: incomeOf('shop', 2),
  },

  // ===== Mid game ($6k – $800k): minutes 10 – 35 =====
  {
    id: 'high-density',
    name: 'High-Density Zoning',
    icon: '🏢',
    desc: 'Apartments hold +50% residents',
    cost: 6000,
    category: 'residential',
    tier: 2,
    unlock: hasBuilt('apartment', 5),
    effect: housingOf('apartment', 1.5),
  },
  {
    id: 'express-transit',
    name: 'Express Transit',
    icon: '🚇',
    desc: 'Population grows +50% faster',
    cost: 8000,
    category: 'global',
    tier: 2,
    unlock: hasPop(120),
    effect: global('growth', 1.5),
  },
  {
    id: 'coal-scrubbers',
    name: 'Coal Scrubbers',
    icon: '🏭',
    desc: 'Coal plants generate +50% power',
    cost: 12000,
    category: 'power',
    tier: 2,
    unlock: hasBuilt('coal', 3),
    effect: powerOf('coal', 1.5),
  },
  {
    id: 'night-shift',
    name: 'Night Shift',
    icon: '🌙',
    desc: 'Factories provide +50% jobs',
    cost: 20000,
    category: 'industrial',
    tier: 2,
    unlock: hasBuilt('factory', 6),
    effect: jobsOf('factory', 1.5),
  },
  {
    id: 'bulk-permits',
    name: 'Bulk Permits',
    icon: '📋',
    desc: 'All buildings cost −15%',
    cost: 25000,
    category: 'global',
    tier: 2,
    unlock: (state) => milestone(state, 'buildings-100') || built(state) >= 60,
    effect: global('cost', 0.85),
  },
  {
    id: 'container-port',
    name: 'Container Port',
    icon: '🚢',
    desc: 'Factories and refineries earn +50% income',
    cost: 35000,
    category: 'industrial',
    tier: 2,
    unlock: hasBuilt('factory', 20),
    effect: compose(incomeOf('factory', 1.5), incomeOf('refinery', 1.5)),
  },
  {
    id: 'tourism-board',
    name: 'Tourism Board',
    icon: '🗺️',
    desc: 'All income +25%',
    cost: 50000,
    category: 'global',
    tier: 2,
    unlock: hasPop(2000, 'pop-1k'),
    effect: global('income', 1.25),
  },
  {
    id: 'open-plan-offices',
    name: 'Open-Plan Offices',
    icon: '💼',
    desc: 'Offices earn +75% income',
    cost: 60000,
    category: 'commercial',
    tier: 2,
    unlock: hasBuilt('office', 5),
    effect: incomeOf('office', 1.75),
  },
  {
    id: 'regional-airport',
    name: 'Regional Airport',
    icon: '✈️',
    desc: 'All income +30%',
    cost: 85000,
    category: 'global',
    tier: 2,
    unlock: hasPop(3000),
    effect: global('income', 1.3),
  },
  {
    id: 'modern-curriculum',
    name: 'Modern Curriculum',
    icon: '🎓',
    desc: 'Schools give +0.04 happiness each',
    cost: 150000,
    category: 'civic',
    tier: 3,
    unlock: hasBuilt('school', 3),
    effect: happinessOf('school', 0.04),
  },
  {
    id: 'maintenance-contracts',
    name: 'Maintenance Contracts',
    icon: '🔧',
    desc: 'Building upkeep −25%',
    cost: 200000,
    category: 'global',
    tier: 3,
    unlock: (state, derived) => (derived && derived.upkeep > 0) || count(state, 'coal') >= 5 || count(state, 'solar') >= 1,
    effect: global('upkeep', 0.75),
  },
  {
    id: 'welcome-center',
    name: 'Welcome Center',
    icon: '🛂',
    desc: 'Population grows +100% faster',
    cost: 250000,
    category: 'global',
    tier: 3,
    unlock: hasPop(1000, 'pop-1k'),
    effect: global('growth', 2),
  },
  {
    id: 'solar-tracking',
    name: 'Sun-Tracking Arrays',
    icon: '☀️',
    desc: 'Solar farms generate ×2 power',
    cost: 300000,
    category: 'power',
    tier: 3,
    unlock: hasBuilt('solar', 3),
    effect: powerOf('solar', 2),
  },
  {
    id: 'catalytic-crackers',
    name: 'Catalytic Crackers',
    icon: '🧪',
    desc: 'Refineries earn +100% income',
    cost: 500000,
    category: 'industrial',
    tier: 3,
    unlock: hasBuilt('refinery', 3),
    effect: incomeOf('refinery', 2),
  },
  {
    id: 'anchor-tenants',
    name: 'Anchor Tenants',
    icon: '🛍️',
    desc: 'Malls earn +100% income and provide +25% jobs',
    cost: 800000,
    category: 'commercial',
    tier: 3,
    unlock: hasBuilt('mall', 3),
    effect: compose(incomeOf('mall', 2), jobsOf('mall', 1.25)),
  },

  // ===== Late game ($120k – $5e8): around and after the first prestige =====
  {
    id: 'prefab-construction',
    name: 'Prefab Construction',
    icon: '🏗️',
    desc: 'All buildings cost −20%',
    cost: 120000,
    category: 'global',
    tier: 3,
    unlock: hasEarned(1e6, 'money-1m'),
    effect: global('cost', 0.8),
  },
  {
    id: 'skyway-frames',
    name: 'Skyway Steel Frames',
    icon: '🌉',
    desc: 'Towers hold +50% residents',
    cost: 190000,
    category: 'residential',
    tier: 3,
    unlock: hasBuilt('tower', 10),
    effect: housingOf('tower', 1.5),
  },
  {
    id: 'digital-city-hall',
    name: 'Digital City Hall',
    icon: '🖥️',
    desc: 'All income +50%',
    cost: 300000,
    category: 'global',
    tier: 3,
    unlock: hasPop(10000, 'pop-10k'),
    effect: global('income', 1.5),
  },
  {
    id: 'preventive-care',
    name: 'Preventive Care',
    icon: '🩺',
    desc: 'Hospitals give +0.06 happiness each',
    cost: 480000,
    category: 'civic',
    tier: 3,
    unlock: hasBuilt('hospital', 2),
    effect: happinessOf('hospital', 0.06),
  },
  {
    id: 'robotic-assembly',
    name: 'Robotic Assembly',
    icon: '🤖',
    desc: 'Factories, refineries and tech parks earn +100% income',
    cost: 770000,
    category: 'industrial',
    tier: 4,
    unlock: hasBuilt('techpark', 1),
    effect: compose(incomeOf('factory', 2), incomeOf('refinery', 2), incomeOf('techpark', 2)),
  },
  {
    id: 'breeder-reactors',
    name: 'Breeder Reactors',
    icon: '☢️',
    desc: 'Nuclear plants generate ×2 power',
    cost: 1.2e6,
    category: 'power',
    tier: 4,
    unlock: hasBuilt('nuclear', 2),
    effect: powerOf('nuclear', 2),
  },
  {
    id: 'megastructures',
    name: 'Megastructures',
    icon: '🏙️',
    desc: 'All housing +100%',
    cost: 2e6,
    category: 'residential',
    tier: 4,
    unlock: any(hasBuilt('arcology', 3), hasPop(50000)),
    effect: global('housing', 2),
  },
  {
    id: 'algorithmic-trading',
    name: 'Algorithmic Trading',
    icon: '📈',
    desc: 'Financial districts earn +100% income',
    cost: 3.1e6,
    category: 'commercial',
    tier: 4,
    unlock: hasBuilt('financial', 2),
    effect: incomeOf('financial', 2),
  },
  {
    id: 'orbital-solar',
    name: 'Orbital Solar',
    icon: '🛰️',
    desc: 'All power generation ×3',
    cost: 5e6,
    category: 'power',
    tier: 4,
    unlock: any(hasPop(100000, 'pop-100k'), hasBuilt('fusion', 1)),
    effect: global('power', 3),
  },
  {
    id: 'championship-season',
    name: 'Championship Season',
    icon: '🏆',
    desc: 'Stadiums earn ×2 income and give +0.15 happiness each',
    cost: 8e6,
    category: 'civic',
    tier: 4,
    unlock: hasBuilt('stadium', 1),
    effect: compose(incomeOf('stadium', 2), happinessOf('stadium', 0.15)),
  },
  {
    id: 'superconductor-grid',
    name: 'Superconductor Grid',
    icon: '🧲',
    desc: 'All buildings use −30% power',
    cost: 1.3e7,
    category: 'power',
    tier: 4,
    // Follows Orbital Solar (or a real reactor fleet) so the two power rungs read as a
    // sequence rather than appearing together.
    unlock: any(owns('orbital-solar'), hasBuilt('nuclear', 4)),
    effect: global('demand', 0.7),
  },
  {
    id: 'arcology-gardens',
    name: 'Arcology Gardens',
    icon: '🌺',
    desc: 'Arcologies hold +100% residents and give +0.05 happiness',
    cost: 2e7,
    category: 'residential',
    tier: 4,
    unlock: hasBuilt('arcology', 10),
    effect: compose(housingOf('arcology', 2), happinessOf('arcology', 0.05)),
  },
  {
    id: 'ai-governance',
    name: 'AI Governance',
    icon: '🧠',
    desc: 'All income +100%',
    cost: 5e7,
    category: 'global',
    tier: 4,
    unlock: any(hasEarned(1e9, 'money-1b'), hasPop(250000)),
    effect: global('income', 2),
  },
  {
    id: 'planetary-charter',
    name: 'Planetary Charter',
    icon: '🌍',
    desc: 'All income +150% and population grows +100% faster',
    cost: 5e8,
    category: 'global',
    tier: 4,
    unlock: any(hasEarned(2e10), hasPop(1e6)),
    effect: compose(global('income', 2.5), global('growth', 2)),
  },

  // ===== Horizon (income-priced, issued on a schedule): Civic Bonds I–XXX + Skyline Expansion I–V =====
  ...HORIZON,

  // ===== Legacy (prestige) — unlocked by legacy points, paid in money each run =====
  {
    id: 'legacy-archive',
    name: 'Legacy Archive',
    icon: '📜',
    desc: 'All income +50%',
    cost: 5000,
    category: 'prestige',
    tier: 1,
    unlock: hasLegacy(1),
    effect: global('income', 1.5),
  },
  {
    id: 'founders-blueprints',
    name: "Founders' Blueprints",
    icon: '📘',
    desc: 'All buildings cost −10%',
    cost: 30000,
    category: 'prestige',
    tier: 2,
    unlock: hasLegacy(2),
    effect: global('cost', 0.9),
  },
  {
    id: 'veteran-planners',
    name: 'Veteran Planners',
    icon: '🎖️',
    desc: 'Population grows +100% faster and happiness +0.1',
    cost: 80000,
    category: 'prestige',
    tier: 3,
    unlock: hasLegacy(3),
    effect: (mods) => {
      mods.growth *= 2;
      mods.happiness += 0.1;
    },
  },
  {
    id: 'dynasty-ledger',
    name: 'Dynasty Ledger',
    icon: '👑',
    desc: 'All income +50% × √legacy (+112% at 5 points, +500% at 100)',
    cost: 150000,
    category: 'prestige',
    tier: 4,
    unlock: hasLegacy(5),
    // A square-root curve instead of a capped line: it never goes flat (a cap is reached
    // within a couple of hours once legacy compounds, after which a "per point" description
    // lies), yet it grows slowly enough not to feed back into the prestige curve — the bot's
    // 25%-more-legacy cadence adds ~12% here per founding, and a million points is ×500.
    effect: (mods, state) => {
      const pts = Math.max(0, Math.floor(legacy(state)));
      mods.income *= 1 + 0.5 * Math.sqrt(pts);
    },
  },
];
