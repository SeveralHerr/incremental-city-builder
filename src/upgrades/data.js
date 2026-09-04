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

const hasBuilt = (id, n) => (state) => count(state, id) >= n;
const hasPop = (n, ms) => (state) => pop(state) >= n || (ms ? milestone(state, ms) : false);
const hasEarned = (n, ms) => (state) => earned(state) >= n || (ms ? milestone(state, ms) : false);
const hasLegacy = (n) => (state) => legacy(state) >= n || (n <= 1 && milestone(state, 'prestige-1'));
const any = (...fns) => (state, derived) => fns.some((f) => f(state, derived) === true);

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
const happinessOf = (id, add) => (mods) => {
  buildingMod(mods, id).happiness += add;
};
const global = (key, mult) => (mods) => {
  mods[key] *= mult;
};
const compose = (...fns) => (mods, state) => {
  for (const f of fns) f(mods, state);
};

// ---------- definitions (ordered by cost; ladder $150 → $1e10) ----------

export const UPGRADES = [
  // ===== Early game ($150 – $3k): first ten minutes =====
  {
    id: 'zoning-reform',
    name: 'Zoning Reform',
    icon: '📐',
    desc: 'Houses hold +25% residents',
    cost: 150,
    category: 'residential',
    tier: 1,
    unlock: hasBuilt('house', 5),
    effect: housingOf('house', 1.25),
  },
  {
    id: 'neon-signage',
    name: 'Neon Signage',
    icon: '🪧',
    desc: 'Shops earn +50% income',
    cost: 200,
    category: 'commercial',
    tier: 1,
    unlock: hasBuilt('shop', 3),
    effect: incomeOf('shop', 1.5),
  },
  {
    id: 'grant-writing',
    name: 'Grant Writing',
    icon: '✍️',
    desc: 'All income +10%',
    cost: 350,
    category: 'global',
    tier: 1,
    unlock: (state) => milestone(state, 'first-upgrade') || ownedUpgrades(state) >= 1,
    effect: global('income', 1.1),
  },
  {
    id: 'tax-software',
    name: 'Tax Software',
    icon: '🧾',
    desc: 'All income +15%',
    cost: 500,
    category: 'global',
    tier: 1,
    unlock: any(hasEarned(1000, 'money-1k'), hasPop(50)),
    effect: global('income', 1.15),
  },
  {
    id: 'turbine-blades',
    name: 'Carbon Turbine Blades',
    icon: '🌬️',
    desc: 'Windmills generate ×2 power',
    cost: 600,
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
    cost: 800,
    category: 'power',
    tier: 1,
    unlock: (state, derived) => milestone(state, 'brownout') || (derived && derived.powerRatio < 1),
    effect: global('demand', 0.85),
  },
  {
    id: 'community-events',
    name: 'Community Events',
    icon: '🎪',
    desc: 'Happiness +0.1',
    cost: 1000,
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
    cost: 1200,
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
    cost: 2500,
    category: 'commercial',
    tier: 2,
    unlock: any(hasPop(100, 'pop-100'), hasBuilt('office', 1)),
    effect: compose(jobsOf('shop', 1.3), jobsOf('office', 1.3)),
  },
  {
    id: 'green-belts',
    name: 'Green Belts',
    icon: '🌳',
    desc: 'Parks give ×2 happiness',
    cost: 3000,
    category: 'civic',
    tier: 2,
    unlock: hasBuilt('park', 4),
    effect: happinessOf('park', 0.05),
  },

  // ===== Mid game ($8k – $800k): minutes 10 – 40 =====
  {
    id: 'express-transit',
    name: 'Express Transit',
    icon: '🚇',
    desc: 'Population grows +50% faster',
    cost: 8000,
    category: 'global',
    tier: 2,
    unlock: hasPop(200),
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
    id: 'high-density',
    name: 'High-Density Zoning',
    icon: '🏢',
    desc: 'Apartments hold +50% residents',
    cost: 15000,
    category: 'residential',
    tier: 2,
    unlock: hasBuilt('apartment', 5),
    effect: housingOf('apartment', 1.5),
  },
  {
    id: 'night-shift',
    name: 'Night Shift',
    icon: '🌙',
    desc: 'Factories provide +50% jobs',
    cost: 20000,
    category: 'industrial',
    tier: 2,
    unlock: hasBuilt('factory', 10),
    effect: jobsOf('factory', 1.5),
  },
  {
    id: 'bulk-permits',
    name: 'Bulk Permits',
    icon: '📋',
    desc: 'All buildings cost −5%',
    cost: 25000,
    category: 'global',
    tier: 2,
    unlock: (state) => milestone(state, 'buildings-100') || built(state) >= 60,
    effect: global('cost', 0.95),
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
    id: 'modern-curriculum',
    name: 'Modern Curriculum',
    icon: '🎓',
    desc: 'Schools give +50% happiness',
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

  // ===== Late game ($1M – $1e10): around and after the first prestige =====
  {
    id: 'prefab-construction',
    name: 'Prefab Construction',
    icon: '🏗️',
    desc: 'All buildings cost −10%',
    cost: 1e6,
    category: 'global',
    tier: 3,
    unlock: hasEarned(1e6, 'money-1m'),
    effect: global('cost', 0.9),
  },
  {
    id: 'skyway-frames',
    name: 'Skyway Steel Frames',
    icon: '🌉',
    desc: 'Towers hold +50% residents',
    cost: 2e6,
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
    cost: 5e6,
    category: 'global',
    tier: 3,
    unlock: hasPop(10000, 'pop-10k'),
    effect: global('income', 1.5),
  },
  {
    id: 'preventive-care',
    name: 'Preventive Care',
    icon: '🩺',
    desc: 'Hospitals give +50% happiness',
    cost: 8e6,
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
    cost: 2e7,
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
    cost: 3e7,
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
    cost: 5e7,
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
    cost: 1e8,
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
    cost: 2e8,
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
    cost: 3e8,
    category: 'civic',
    tier: 4,
    unlock: hasBuilt('stadium', 1),
    effect: compose(incomeOf('stadium', 2), happinessOf('stadium', 0.15)),
  },
  {
    id: 'ai-governance',
    name: 'AI Governance',
    icon: '🧠',
    desc: 'All income +100%',
    cost: 1e9,
    category: 'global',
    tier: 4,
    unlock: any(hasEarned(1e9, 'money-1b'), hasPop(250000)),
    effect: global('income', 2),
  },
  {
    id: 'superconductor-grid',
    name: 'Superconductor Grid',
    icon: '🧲',
    desc: 'All buildings use −30% power',
    cost: 5e9,
    category: 'power',
    tier: 4,
    unlock: any(hasPop(100000, 'pop-100k'), hasBuilt('fusion', 2)),
    effect: global('demand', 0.7),
  },
  {
    id: 'arcology-gardens',
    name: 'Arcology Gardens',
    icon: '🌺',
    desc: 'Arcologies hold +100% residents and give +0.05 happiness',
    cost: 1e10,
    category: 'residential',
    tier: 4,
    unlock: hasBuilt('arcology', 10),
    effect: compose(housingOf('arcology', 2), happinessOf('arcology', 0.05)),
  },
  {
    id: 'planetary-charter',
    name: 'Planetary Charter',
    icon: '🌍',
    desc: 'All income +150% and population grows +100% faster',
    cost: 1e10,
    category: 'global',
    tier: 4,
    unlock: any(hasEarned(2e10), hasPop(1e6)),
    effect: compose(global('income', 2.5), global('growth', 2)),
  },

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
    cost: 50000,
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
    cost: 500000,
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
    desc: 'All income +10% per legacy point (max +200%)',
    cost: 5e6,
    category: 'prestige',
    tier: 4,
    unlock: hasLegacy(5),
    effect: (mods, state) => {
      const pts = Math.min(20, Math.max(0, Math.floor(legacy(state))));
      mods.income *= 1 + 0.1 * pts;
    },
  },
];
