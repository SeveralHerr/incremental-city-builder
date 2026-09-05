// Upgrade definitions for Metropolis. DOM-free, pure data + tiny pure functions.
//
// Every entry: { id, name, icon, desc (≤70 chars, states the exact effect), cost, category,
//   tier, currency? ('money' by default, 'legacy' for charter perks), unlock(state, derived)
//   -> boolean, unlockHint (string), unlockAt? (data mirror of the rule for progress bars),
//   effect(mods, state) -> void }
//
// Effects only mutate the mods bag (see src/core/mods.js). Unlock rules read state counts,
// population, earnings this run, prestige legacy and latched milestone flags — never the
// clock. Each milestone check has a direct-state fallback so the ladder works even if the
// simulation module names a milestone differently; the flags below are the ids we expect
// simulation to latch as `state.unlocks['m:' + id]`.
//
// Unlock hints: every helper factory below (hasBuilt, hasPop, hasEarned, hasLegacy, owns, …)
// tags the rule it returns with `.hint` (plain English) and, where the rule is a single
// measurable threshold, `.at` (the same shape src/buildings/data.js uses for `unlockAt`:
// {pop} | {powerDemand} | {legacy} | {earned} | {building, count} | {upgrade} | …). The
// `withHints` pass at the bottom copies them onto each definition as `unlockHint` /
// `unlockAt`, so the UI can show the next locked ideas with a progress bar like the building
// cards, without every definition spelling the hint out twice. Hand-written rules carry an
// explicit `unlockHint`.
//
// The ladder has four parts:
//   • the core ladder, $25 → $3e12 (config.upgrades in src/balance/config.js wins when both
//     exist; the literals here match it so the file is self-consistent on its own);
//   • the frontier ladder, six fixed-dollar rungs ×10 apart from $1e13 to $1e18 (Dyson
//     Swarm … Galactic Charter). Each opens once this run has earned a quarter of its price
//     (`earnedGate: 0.25`, see `frontierUnlock`), so a founding closes the whole ladder
//     again and the next city has to earn its way back — and the rule follows the price,
//     so a config override moves the gate with it;
//   • the Legacy rungs (category 'prestige'): unlocked by legacy points, paid in money each
//     run;
//   • the Charter perks (category 'charter', currency 'legacy'): twelve permanent perks
//     bought with legacy points (core's api.buyUpgrade debits state.prestige.spent; the
//     income bonus keeps using the whole bank). Costs run ×2.5–4 apart from 3 to 200,000
//     points, each opening once the bank holds half its price, and every one is a real
//     jump: +50–200% income, +50–100% housing, ×2–3 power, −15% cost. A founding wipes
//     state.upgrades, so index.js grants every owned perk back the moment a city is
//     founded (`keptUpgradeIds` is the pure rule).
//
// Nothing here reads the run clock: content gates on the economy, never on elapsed time.
//
// Happiness: `mods.happiness` is added to the final happiness value *after* the civic
// curve (resources: 1 + civic − penalties + mods.happiness), so "Happiness +10%" is exactly
// what the chip shows. Per-building happiness adds (byBuilding.happiness) are not used
// here on purpose: they feed the saturating civic sum, civic = 1.25·(1 − e^(−Σ/1.5)), and
// past three parks and a school that sum is already near the cap, so a "+6% per hospital"
// rung measured +0.01–0.05 happiness in the sim — a desc that reads as a promise the
// curve never keeps. The civic rungs below therefore add flat happiness — kept small
// (+5–10%, 0.55 in total across the whole ladder) — and, since +0.1 happiness is only ~+3%
// income at h≈2, each pairs it with a real multiplier (growth or jobs).
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
  { id: 'charter', name: 'Charter', icon: '⚜️', color: '#f59e0b' },
];

// Building names for hint text (singular, plural), matching src/buildings/data.js.
const BUILDING_NAMES = {
  house: ['Cottage', 'cottages'],
  apartment: ['Apartment Block', 'apartment blocks'],
  tower: ['Residential Tower', 'residential towers'],
  arcology: ['Arcology', 'arcologies'],
  shop: ['Corner Shop', 'corner shops'],
  office: ['Office Block', 'office blocks'],
  mall: ['Shopping Mall', 'shopping malls'],
  financial: ['Financial District', 'financial districts'],
  factory: ['Factory', 'factories'],
  refinery: ['Refinery', 'refineries'],
  techpark: ['Tech Campus', 'tech campuses'],
  windmill: ['Windmill', 'windmills'],
  coal: ['Coal Plant', 'coal plants'],
  solar: ['Solar Farm', 'solar farms'],
  nuclear: ['Nuclear Plant', 'nuclear plants'],
  fusion: ['Fusion Reactor', 'fusion reactors'],
  park: ['City Park', 'city parks'],
  school: ['School', 'schools'],
  hospital: ['Hospital', 'hospitals'],
  stadium: ['Stadium', 'stadiums'],
};
const buildingName = (id, n) => {
  const names = BUILDING_NAMES[id] || [id, id + 's'];
  if (n !== 1) return `${fmtInt(n)} ${names[1]}`;
  return `${/^[aeiou]/i.test(names[0]) ? 'an' : 'a'} ${names[0]}`;
};
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
// Short money for hints: $1,000 · $1M · $1B · $20B · $1T · $2.5Qa (same suffixes as core/format).
const MONEY_UNITS = [[1e18, 'Qi'], [1e15, 'Qa'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M']];
export const fmtMoney = (n) => {
  for (const [v, u] of MONEY_UNITS) {
    if (n >= v) {
      const x = n / v;
      return '$' + (Number.isInteger(x) ? x : +x.toFixed(1)) + u;
    }
  }
  return '$' + fmtInt(n);
};

// ---------- unlock helpers (all tolerate partially-built state/derived) ----------

const count = (state, id) => (state && state.buildings && state.buildings[id]) || 0;
const pop = (state) => (state && state.res && state.res.pop) || 0;
const earned = (state) => (state && state.stats && state.stats.totalEarned) || 0;
const built = (state) => (state && state.stats && state.stats.buildingsBuilt) || 0;
const legacy = (state) => (state && state.prestige && state.prestige.legacy) || 0;
const milestone = (state, id) => !!(state && state.unlocks && state.unlocks['m:' + id]);
const ownedUpgrades = (state) => (state && state.upgrades ? Object.keys(state.upgrades).length : 0);

// Tag a rule with its hint (and optional data mirror) so definitions can inherit them.
const rule = (fn, hint, at) => {
  fn.hint = hint;
  if (at) fn.at = at;
  return fn;
};
// Names for the hint sentence: "Own Orbital Solar" needs the upgrade's name, which is
// declared later in this file, so `owns` resolves it lazily through this table.
const NAME_OF = {};
const upgradeName = (id) => NAME_OF[id] || id;

const owns = (id) => {
  const fn = (state) => !!(state && state.upgrades && state.upgrades[id]);
  Object.defineProperty(fn, 'hint', { get: () => `Own ${upgradeName(id)}`, enumerable: true });
  fn.at = { upgrade: id };
  return fn;
};
const hasBuilt = (id, n) => rule((state) => count(state, id) >= n, `Build ${buildingName(id, n)}`, { building: id, count: n });
const hasPop = (n, ms) => rule((state) => pop(state) >= n || (ms ? milestone(state, ms) : false), `Reach ${fmtInt(n)} citizens`, { pop: n });
const hasEarned = (n, ms) =>
  rule((state) => earned(state) >= n || (ms ? milestone(state, ms) : false), `Earn ${fmtMoney(n)} in this city`, { earned: n });
const hasLegacy = (n) =>
  rule(
    (state) => legacy(state) >= n || (n <= 1 && milestone(state, 'prestige-1')),
    n <= 1 ? 'Found a new city' : `Bank ${fmtInt(Math.ceil(n))} legacy points`,
    { legacy: n }
  );
const hasDemand = (mw) =>
  rule((state, derived) => !!derived && Number.isFinite(derived.powerDemand) && derived.powerDemand >= mw, `Draw ${fmtInt(mw)} MW of power`, {
    powerDemand: mw,
  });
const hasBuiltTotal = (n) => rule((state) => milestone(state, 'buildings-100') || built(state) >= n, `Build ${fmtInt(n)} buildings in total`, { built: n });
const hasAnyUpgrade = () => rule((state) => milestone(state, 'first-upgrade') || ownedUpgrades(state) >= 1, 'Fund any upgrade', { upgrades: 1 });
// Combinators join the hints ("A or B", "A and B"). `any` carries the first rule's data
// mirror (the easiest door in is the one worth a progress bar). `all` carries the first
// *measurable* one — a mirror that counts toward a threshold ({pop}, {legacy}, …) rather
// than an ownership flag ({upgrade}), since every gate must open and a bar that reads 100%
// against a card that stays locked on the other condition is worse than no bar.
const lower = (s) => (typeof s === 'string' ? s.charAt(0).toLowerCase() + s.slice(1) : '');
const joinHints = (fns, word) => {
  const parts = fns.map((f) => f.hint).filter(Boolean);
  return parts.map((p, i) => (i === 0 ? p : lower(p))).join(` ${word} `);
};
const measurable = (at) => !!at && typeof at === 'object' && !('upgrade' in at);
const any = (...fns) => {
  const fn = (state, derived) => fns.some((f) => f(state, derived) === true);
  Object.defineProperty(fn, 'hint', { get: () => joinHints(fns, 'or'), enumerable: true });
  if (fns[0] && fns[0].at) fn.at = fns[0].at;
  return fn;
};
const all = (...fns) => {
  const fn = (state, derived) => fns.every((f) => f(state, derived) === true);
  Object.defineProperty(fn, 'hint', { get: () => joinHints(fns, 'and'), enumerable: true });
  const pick = fns.find((f) => measurable(f.at)) || fns.find((f) => f.at);
  if (pick) fn.at = pick.at;
  return fn;
};

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
// Flat city-wide happiness (see the header): happiness is a multiplier around 1.0 that the
// UI shows as a percentage, so +0.1 is written "Happiness +10%" and lands exactly so.
const happier = (add) => (mods) => {
  mods.happiness += add;
};
const global = (key, mult) => (mods) => {
  mods[key] *= mult;
};
const compose = (...fns) => (mods, state) => {
  for (const f of fns) f(mods, state);
};
// Upgrades whose whole effect is structural (kept upgrades, see FOUNDING MEMORY) change no
// modifier; the mods bag is left exactly as it came.
const noEffect = () => {};

// Building groups for the per-sector rungs (ids match src/buildings/data.js).
const INDUSTRY = ['factory', 'refinery', 'techpark'];
const COMMERCE = ['shop', 'office', 'mall', 'financial'];
const incomeOfEach = (ids, mult) => compose(...ids.map((id) => incomeOf(id, mult)));

// ---------- frontier ladder (earnings-gated, fixed dollars) ----------
//
// Six rungs ×10 apart from $1e13 to $1e18, each a different lever, each opening once this
// run has earned a quarter of its price. The gate is a share of the *registered* price
// (`earnedGate`), so index.js rebuilds the rule after a config override: `frontierUnlock`
// is the one place the rule lives. A founding zeroes totalEarned and the whole ladder
// locks again — the late game is "earn your way back", never "wait".

export const FRONTIER_GATE = 0.25;

// Unlock rule + hint + progress mirror for a def whose gate is `earnedGate × cost`.
export function frontierUnlock(def) {
  const share = def && Number.isFinite(def.earnedGate) && def.earnedGate > 0 ? def.earnedGate : FRONTIER_GATE;
  const cost = def && Number.isFinite(def.cost) && def.cost > 0 ? def.cost : 0;
  const at = cost * share;
  const fn = hasEarned(at);
  return { unlock: fn, unlockHint: fn.hint.charAt(0).toUpperCase() + fn.hint.slice(1), unlockAt: { earned: at } };
}

const frontier = (def) => ({ ...def, category: def.category || 'global', tier: 4, earnedGate: FRONTIER_GATE, ...frontierUnlock({ ...def, earnedGate: FRONTIER_GATE }) });

const FRONTIER = [
  frontier({
    id: 'dyson-swarm',
    name: 'Dyson Swarm',
    icon: '🌞',
    desc: 'All power generation ×4',
    cost: 1e13,
    category: 'power',
    effect: global('power', 4),
  }),
  frontier({
    id: 'quantum-exchange',
    name: 'Quantum Exchange',
    icon: '💹',
    desc: 'All income +100% · financial districts earn +100%',
    cost: 1e14,
    category: 'commercial',
    effect: compose(global('income', 2), incomeOf('financial', 2)),
  }),
  frontier({
    id: 'mass-driver-port',
    name: 'Mass-Driver Port',
    icon: '🚀',
    desc: 'All buildings cost −25% · industry earns +100% income',
    cost: 1e15,
    category: 'industrial',
    effect: compose(global('cost', 0.75), incomeOfEach(INDUSTRY, 2)),
  }),
  frontier({
    id: 'ringworld-district',
    name: 'Ringworld District',
    icon: '🪐',
    desc: 'All housing +150% and all jobs +50%',
    cost: 1e16,
    category: 'residential',
    effect: compose(global('housing', 2.5), global('jobs', 1.5)),
  }),
  frontier({
    id: 'stellar-engine',
    name: 'Stellar Engine',
    icon: '🌟',
    desc: 'Population grows +200% faster · buildings use −40% power',
    cost: 1e17,
    category: 'global',
    effect: compose(global('growth', 3), global('demand', 0.6)),
  }),
  frontier({
    id: 'galactic-charter',
    name: 'Galactic Charter',
    icon: '🌌',
    desc: 'All income +200% and all buildings cost −20%',
    cost: 1e18,
    category: 'global',
    effect: compose(global('income', 3), global('cost', 0.8)),
  }),
];

// ---------- charter perks (legacy-priced, permanent) ----------

export const CHARTER_MIN_COST = 3;
export const CHARTER_MAX_COST = 2e5;
// A perk opens once the bank holds half its price (the whole bank, spent or not).
export const CHARTER_GATE = 0.5;

const charterTier = (cost) => (cost <= 25 ? 1 : cost <= 600 ? 2 : cost <= 12000 ? 3 : 4);
const charterUnlock = (cost) => hasLegacy(cost * CHARTER_GATE);

const charter = (def) => ({
  ...def,
  category: 'charter',
  currency: 'legacy',
  tier: charterTier(def.cost),
  unlock: charterUnlock(def.cost),
});

const CHARTER = [
  charter({ id: 'charter-homestead', name: 'Homestead Charter', icon: '🏡', desc: 'All housing +50%', cost: 3, effect: global('housing', 1.5) }),
  charter({ id: 'charter-mint', name: 'Mint Charter', icon: '🪙', desc: 'All income +50% and building upkeep −25%', cost: 8, effect: compose(global('income', 1.5), global('upkeep', 0.75)) }),
  charter({ id: 'charter-grid', name: 'Grid Charter', icon: '⚡', desc: 'All power generation ×2', cost: 25, effect: global('power', 2) }),
  charter({
    id: 'charter-guild',
    name: 'Guild Charter',
    icon: '⚒️',
    desc: 'Factories, refineries and tech campuses earn +100% income',
    cost: 70,
    effect: incomeOfEach(INDUSTRY, 2),
  }),
  charter({
    id: 'charter-merchant',
    name: 'Merchant Charter',
    icon: '🏪',
    desc: 'Shops, offices, malls and financial districts earn +100%',
    cost: 200,
    effect: incomeOfEach(COMMERCE, 2),
  }),
  charter({
    id: 'charter-settlers',
    name: "Settlers' Charter",
    icon: '🚂',
    desc: 'Population grows +100% faster · new arrivals ×3',
    cost: 600,
    effect: compose(global('growth', 2), global('inflow', 3)),
  }),
  charter({ id: 'charter-masons', name: "Masons' Charter", icon: '🧱', desc: 'All buildings cost −15%', cost: 1600, effect: global('cost', 0.85) }),
  charter({ id: 'charter-civic', name: 'Civic Charter', icon: '🎭', desc: 'Happiness +10% and all jobs +50%', cost: 4500, effect: compose(happier(0.1), global('jobs', 1.5)) }),
  charter({ id: 'charter-treasury', name: 'Treasury Charter', icon: '💎', desc: 'All income +100% and building upkeep −50%', cost: 12000, effect: compose(global('income', 2), global('upkeep', 0.5)) }),
  charter({ id: 'charter-skyline', name: 'Skyline Charter', icon: '🌇', desc: 'All housing +100% and all jobs +50%', cost: 30000, effect: compose(global('housing', 2), global('jobs', 1.5)) }),
  charter({
    id: 'charter-energy',
    name: 'Energy Charter',
    icon: '🔋',
    desc: 'All power generation ×3 · buildings use −25% power',
    cost: 80000,
    effect: compose(global('power', 3), global('demand', 0.75)),
  }),
  charter({
    id: 'charter-imperial',
    name: 'Imperial Charter',
    icon: '👑',
    desc: 'All income +200% and all buildings cost −15%',
    cost: 200000,
    effect: compose(global('income', 3), global('cost', 0.85)),
  }),
];

// ---------- founding memory ----------
//
// A founding wipes every upgrade. Two things come back on their own:
//   • every charter perk the mayor owns — they are paid in legacy points, a currency a
//     founding never refunds, so they are permanent by construction;
//   • with legacy-scaled seed money the whole core ladder is affordable again within the
//     first minute: dozens of clicks that decide nothing. The two Legacy rungs below carry
//     `keeps(def)`: while one is owned, every upgrade it keeps (and the rung itself) is
//     granted again the moment a new city is founded.
// index.js listens for the prestige event and re-owns all of them, at no cost, so the
// mayor starts the replay at the decisions that matter (tier 4 and the frontier).
// `keptUpgradeIds` is the pure rule so it can be tested without a game.
const isCore = (def) => !def.earnedGate && def.category !== 'prestige' && def.currency !== 'legacy';
export const isPermanent = (def) => !!def && def.currency === 'legacy';

export function keptUpgradeIds(ownedIds, defs = UPGRADES) {
  const owned = new Set(ownedIds || []);
  const out = new Set();
  for (const def of defs) if (owned.has(def.id) && isPermanent(def)) out.add(def.id);
  for (const keeper of defs) {
    if (typeof keeper.keeps !== 'function' || !owned.has(keeper.id)) continue;
    out.add(keeper.id);
    for (const def of defs) if (def.id !== keeper.id && keeper.keeps(def) === true) out.add(def.id);
  }
  return [...out];
}

// ---------- definitions (grouped by phase: $25 → $3e12 core ladder, the frontier, Legacy, then the Charter) ----------

export const UPGRADES = [
  // ===== Early game ($25 – $3.5k): first ten minutes =====
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
    icon: '💡',
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
    desc: 'All income +25%',
    cost: 150,
    category: 'global',
    tier: 1,
    unlock: hasAnyUpgrade(),
    effect: global('income', 1.25),
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
    desc: 'All buildings use −20% power',
    cost: 250,
    category: 'power',
    tier: 1,
    // Three doors in: the Lights Out milestone (or a live brownout on an existing grid —
    // powerCap > 0 so the first cottage on an empty plot does not unlock it at t=0), a
    // sizeable windmill fleet, or 40 MW of demand — a mayor who keeps the lights on still
    // gets to buy it.
    unlock: any(
      rule((state, derived) => milestone(state, 'brownout') || (!!derived && derived.powerCap > 0 && derived.powerRatio < 1), 'Suffer a brownout'),
      hasBuilt('windmill', 6),
      hasDemand(40)
    ),
    unlockAt: { powerDemand: 40 },
    effect: global('demand', 0.8),
  },
  {
    id: 'community-events',
    name: 'Community Events',
    icon: '🎪',
    desc: 'Happiness +10% and population grows +25% faster',
    cost: 500,
    category: 'civic',
    tier: 1,
    unlock: hasBuilt('park', 1),
    // Paired like the other civic rungs: at the h≈0.85 it unlocks at, +0.1 happiness alone
    // is ~+6% income — the growth term is what makes the first park a decision.
    effect: compose(happier(0.1), global('growth', 1.25)),
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
    desc: 'Happiness +5% and population grows +25% faster',
    cost: 1500,
    category: 'civic',
    tier: 2,
    unlock: hasBuilt('park', 4),
    effect: compose(happier(0.05), global('growth', 1.25)),
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
  {
    id: 'grid-substations',
    name: 'Grid Substations',
    icon: '🗼',
    desc: 'All power generation +25%',
    cost: 3500,
    category: 'power',
    tier: 2,
    // Fills the minute-9 gap between the $1.5k and $6k rungs: opens as the coal plants
    // take over the grid, right when the second brownout is brewing.
    unlock: hasDemand(20),
    effect: global('power', 1.25),
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
    cost: 15000,
    category: 'industrial',
    tier: 2,
    unlock: hasBuilt('factory', 6),
    effect: jobsOf('factory', 1.5),
  },
  {
    id: 'bulk-permits',
    name: 'Bulk Permits',
    icon: '📋',
    desc: 'All buildings cost −20%',
    cost: 25000,
    category: 'global',
    tier: 2,
    unlock: hasBuiltTotal(60),
    effect: global('cost', 0.8),
  },
  {
    id: 'container-port',
    name: 'Container Port',
    icon: '🚢',
    desc: 'Factories and refineries earn +50% income',
    cost: 45000,
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
    desc: 'Happiness +10% and all jobs +25%',
    cost: 150000,
    category: 'civic',
    tier: 3,
    unlock: hasBuilt('school', 3),
    // An educated workforce fills more desks: jobs pay wages directly, and at the 3-school
    // mark (~minute 20) unemployment is the penalty a growing city feels most.
    effect: compose(happier(0.1), global('jobs', 1.25)),
  },
  {
    id: 'maintenance-contracts',
    name: 'Maintenance Contracts',
    icon: '🔧',
    desc: 'Building upkeep −25%',
    cost: 200000,
    category: 'global',
    tier: 3,
    unlock: any(
      rule((state, derived) => !!derived && derived.upkeep > 0, 'Run a building that charges upkeep'),
      hasBuilt('coal', 5),
      hasBuilt('solar', 1)
    ),
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

  // ===== Late game ($120k – $3e12, ×3.3 per rung): around and after the first founding =====
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
    cost: 400000,
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
    cost: 1.3e6,
    category: 'global',
    tier: 3,
    unlock: hasPop(10000, 'pop-10k'),
    effect: global('income', 1.5),
  },
  {
    id: 'preventive-care',
    name: 'Preventive Care',
    icon: '🩺',
    desc: 'Happiness +10% and population grows +50% faster',
    cost: 4e6,
    category: 'civic',
    tier: 3,
    unlock: hasBuilt('hospital', 2),
    effect: compose(happier(0.1), global('growth', 1.5)),
  },
  {
    id: 'robotic-assembly',
    name: 'Robotic Assembly',
    icon: '🤖',
    desc: 'Factories, refineries and tech parks earn +100% income',
    cost: 1.3e7,
    category: 'industrial',
    tier: 4,
    unlock: hasBuilt('techpark', 1),
    effect: incomeOfEach(INDUSTRY, 2),
  },
  {
    id: 'breeder-reactors',
    name: 'Breeder Reactors',
    icon: '☢️',
    desc: 'Nuclear plants generate ×2 power',
    cost: 4e7,
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
    cost: 1.3e8,
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
    cost: 4e8,
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
    cost: 1.3e9,
    category: 'power',
    tier: 4,
    unlock: any(hasPop(100000, 'pop-100k'), hasBuilt('fusion', 1)),
    effect: global('power', 3),
  },
  {
    id: 'championship-season',
    name: 'Championship Season',
    icon: '🏆',
    desc: 'Stadiums earn ×2 income and provide ×2 jobs',
    cost: 4e9,
    category: 'civic',
    tier: 4,
    unlock: hasBuilt('stadium', 1),
    effect: compose(incomeOf('stadium', 2), jobsOf('stadium', 2)),
  },
  {
    id: 'superconductor-grid',
    name: 'Superconductor Grid',
    icon: '🧲',
    desc: 'All buildings use −30% power',
    cost: 1.3e10,
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
    desc: 'Arcologies hold +100% residents and provide +50% jobs',
    cost: 4e10,
    category: 'residential',
    tier: 4,
    unlock: hasBuilt('arcology', 10),
    effect: compose(housingOf('arcology', 2), jobsOf('arcology', 1.5)),
  },
  {
    id: 'ai-governance',
    name: 'AI Governance',
    icon: '🧠',
    desc: 'All income +100%',
    cost: 1e11,
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
    cost: 3e12,
    category: 'global',
    tier: 4,
    unlock: any(hasEarned(2e10), hasPop(1e6)),
    effect: compose(global('income', 2.5), global('growth', 2)),
  },

  // ===== Frontier ($1e13 – $1e18, ×10 per rung, each opens at a quarter of its price earned this run) =====
  ...FRONTIER,

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
    desc: 'All buildings cost −20%',
    cost: 30000,
    category: 'prestige',
    tier: 2,
    unlock: hasLegacy(2),
    effect: global('cost', 0.8),
  },
  {
    id: 'veteran-planners',
    name: 'Veteran Planners',
    icon: '🎖️',
    desc: 'Population grows +100% faster and happiness +10%',
    cost: 80000,
    category: 'prestige',
    tier: 3,
    unlock: hasLegacy(3),
    effect: compose(global('growth', 2), happier(0.1)),
  },
  {
    id: 'dynasty-ledger',
    name: 'Dynasty Ledger',
    icon: '👑',
    desc: 'All income +50% × ∛legacy (+100% at 8 points, ×6 at 1,000)',
    cost: 150000,
    category: 'prestige',
    tier: 4,
    unlock: hasLegacy(5),
    // A cube-root curve instead of a capped line: it never goes flat, yet it stays inside
    // the late-game magnitudes (money ≤ 1e18, legacy ≤ 1e6 at 12 h) — ×1.85 when it opens
    // at 5 points, ×6 at a thousand, ×51 at the million-point ceiling — on top of the
    // simulation's own root of the bank and the charter perks' flat multipliers.
    effect: (mods, state) => {
      const pts = Math.max(0, Math.floor(legacy(state)));
      mods.income *= 1 + 0.5 * Math.cbrt(pts);
    },
  },
  {
    id: 'institutional-memory',
    name: 'Institutional Memory',
    icon: '🗃️',
    desc: 'Every tier 1–2 upgrade is yours from the day a new city is founded',
    cost: 1e6,
    category: 'prestige',
    tier: 4,
    unlock: hasLegacy(10),
    keeps: (def) => isCore(def) && def.tier <= 2,
    effect: noEffect,
  },
  {
    id: 'standing-orders',
    name: 'Standing Orders',
    icon: '📑',
    desc: 'Tier 3 and Legacy upgrades are yours from the day a city is founded',
    cost: 5e7,
    category: 'prestige',
    tier: 4,
    unlock: all(hasLegacy(50), owns('institutional-memory')),
    keeps: (def) => (isCore(def) && def.tier === 3) || def.category === 'prestige',
    effect: noEffect,
  },

  // ===== Charter — permanent perks bought with legacy points (◆ 3 … ◆ 200,000) =====
  ...CHARTER,
];

// ---------- hints: copy each rule's tag onto its definition ----------
for (const def of UPGRADES) NAME_OF[def.id] = def.name;
for (const def of UPGRADES) {
  const u = def.unlock;
  if (!def.unlockHint && u && typeof u.hint === 'string' && u.hint) def.unlockHint = u.hint.charAt(0).toUpperCase() + u.hint.slice(1);
  if (!def.unlockAt && u && u.at && typeof u.at === 'object') def.unlockAt = { ...u.at };
  if (!def.unlockHint) def.unlockHint = 'Grow the city';
}
