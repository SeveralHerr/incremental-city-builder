// Resources: resource metadata + the derived-rate math every tick runs on.
// DOM-free. Pure: reads registry buildings, state and the mods bag; writes derived.
//
// Math (per second; simulation applies dt). Tuning keys live in src/balance/config.js and are
// mirrored in DEFAULTS below. This block is the reference the DESIGN.md "Resources" section
// should match; where the two disagree, this file (and resources.test.mjs) is the truth.
//
//   housing     = Σ count·housing·byBuilding.housing · mods.housing        (jobs alike, mods.jobs)
//   powerCap    = Σ count·powerGen·byBuilding.power  · mods.power
//   powerDemand = Σ count·powerUse                   · mods.demand
//   powerRatio  = demand > 0 ? clamp(cap / demand, power.brownoutFloor, 1) : 1
//   employed    = min(pop, jobs);  unemployment = pop > 0 ? (pop − employed) / pop : 0
//   overcrowd   = clamp(pop / housing − 1, 0, OVERCROWD_MAX = 10); pop > 0 with no housing → 10
//   civic       = civicCap · (1 − exp(−Σ count·(+happiness) / civicScale))
//   pollutionRaw = Σ count·|−happiness| · pollutionScale                      (unsaturated smog)
//   pollution   = pollutionCap · (1 − exp(−pollutionRaw / pollutionCurve))   (saturating; see below)
//   happiness   = clamp(1 + civic − pollution − unemployment·unemploymentPenalty
//                         − overcrowd·overcrowdPenalty − (1 − powerRatio)·brownoutPenalty
//                         + mods.happiness, happiness.min, happiness.max)
//   multiplier  = mods.income · powerRatio · (0.5 + 0.5·happiness)
//   grossIncome = (pop·taxPerPop + employed·wage + Σ count·income·byBuilding.income) · multiplier
//   upkeep      = Σ count·upkeep · mods.upkeep;   income = grossIncome − upkeep (may be negative)
//   popGrowth   = pop < housing ? (housing − pop)·growthRate·happiness·powerRatio·mods.growth
//                                 + baseInflow·mods.inflow
//               : pop > housing ? −(pop − housing)·shrinkRate : 0
//   costMult    = mods.cost (must be > 0; anything else reads as 1, like core/mods.sanitizeMods)
//
// Pollution saturation: with pollutionCap 1.1 and pollutionCurve 1.0 the penalty has unit slope
// at zero (a lightly industrial city loses exactly pollutionRaw) and bends toward 1.1, which sits
// below civicCap 1.12 so a fully civic city always nets positive. Without it the gauntlet's final
// city (129 coal + 123 factory + 112 refinery, raw smog 2.39 at scale 0.2; 4.18 at the shipped
// 0.35) pinned happiness at the 0.25 floor for hours. pollutionCap 0 restores the linear form.
//
// derived.extra (all numbers finite, objects allocated once and reused every tick):
//   unemployment, overcrowd, civic, pollution, pollutionRaw, happinessMult,
//   vacancy = max(0, housing − pop), openJobs = max(0, jobs − employed), powerSurplus = cap − demand,
//   penalties: { unemployment, overcrowd, brownout, pollution }             (all ≥ 0, subtracted)
//   incomeBreakdown: { tax, wages, buildings, upkeep, multiplier }         (tax+wages+buildings == gross)
//   happinessBreakdown: { base: 1, civic, mods, unemployment, overcrowd, brownout, pollution, raw, clamped }
//     — signed terms that sum to `raw`; `clamped` is derived.happiness. `civic` and `pollution`
//     at the top level of extra are aliases of happinessBreakdown.civic / penalties.pollution kept
//     for one release so ui keeps reading; new consumers should use the breakdown.
//
// Measured (logs/gauntlet.json, 10,000 bot ticks, 2026-09-07): final city 3,917 pop, happiness
// 1.556 (civic +0.762, pollution −0.216 on raw 0.219, unemployment −0.140), $3.2k/s at ×2.20;
// 0.009 ms avg tick across all handlers. logs/sim-final.json (12 h, 432,000 ticks): PASS with
// contract PASS, 32 foundings, 22 cities dip below 1.0 happiness, under-power 3.5 % at floor 0.6.
import { registry } from '../core/registry.js';
import { fmt, fmtMoney, fmtInt, fmtPct } from '../core/format.js';
import {
  num,
  nonNeg,
  posOr1,
  finite,
  FINITE_MAX,
  clamp,
  happinessIncomeCurve,
  civicBonus,
  pollutionPenalty,
  powerRatioOf,
  unemploymentOf,
  overcrowdOf,
} from './math.js';

export const RESOURCES = [
  {
    id: 'money',
    name: 'Money',
    icon: '💵',
    color: '#4ade80',
    kind: 'stock',
    format: 'money',
    fallback: 0,
    desc: 'Tax receipts, wages and business profits. Spend it on more city.',
  },
  {
    id: 'pop',
    name: 'Population',
    icon: '👥',
    color: '#60a5fa',
    kind: 'stock',
    format: 'int',
    fallback: 0,
    desc: 'Citizens who call this place home. They move in for housing, stay for the jobs.',
  },
  {
    id: 'power',
    name: 'Power',
    icon: '⚡',
    color: '#facc15',
    kind: 'derived',
    source: 'powerCap', // derived field shown as the resource's value
    format: 'power',
    unit: 'MW',
    fallback: 0,
    desc: 'Grid capacity versus demand. Fall short and the lights dim - along with income.',
  },
  {
    id: 'happiness',
    name: 'Happiness',
    icon: '😊',
    color: '#f472b6',
    kind: 'derived',
    source: 'happiness',
    format: 'pct',
    fallback: 1, // a missing multiplier is neutral (1x), not a crisis (0%)
    desc: 'How the city feels. Parks lift it; smog, joblessness and blackouts drag it down.',
  },
];

const RESOURCE_MAP = new Map(RESOURCES.map((r) => [r.id, r]));

export function getResource(id) {
  return RESOURCE_MAP.get(id) || null;
}

// Current value of a resource for display: stocks from state.res[id], derived from
// derived[r.source]. Every resource declares its own `fallback` for a missing/garbage value,
// so the metadata is the single source of truth (happiness → 1, everything else → 0).
export function resourceValue(id, state, derived) {
  const r = RESOURCE_MAP.get(id);
  if (!r) return 0;
  const fb = num(r.fallback, 0);
  if (r.kind === 'stock') return nonNeg(state && state.res ? state.res[id] : undefined, fb);
  const v = derived ? derived[r.source || id] : undefined;
  return r.id === 'happiness' ? num(v, fb) : nonNeg(v, fb);
}

// Format a value the way its resource wants to be shown. The unit (if any) comes from the
// resource's `unit` field, never from a per-format string.
export function formatResource(id, value) {
  const r = RESOURCE_MAP.get(id);
  const f = r ? r.format : 'int';
  const unit = r && r.unit ? ' ' + r.unit : '';
  if (f === 'money') return fmtMoney(value) + unit;
  if (f === 'pct') return fmtPct(value) + unit;
  if (f === 'power' || f === 'float') return fmt(value) + unit;
  return fmtInt(value) + unit;
}

// Local mirror of the balance numbers this module reads. `src/balance/config.js` is the
// source of truth: every key it defines is read from there, and these values only cover a
// missing config or a missing key. Keep them equal to config.js — resources.test.mjs fails
// on drift (`node --test src/resources/`).
//
// pollutionCap / pollutionCurve make the pollution penalty saturate at 1.1 happiness (below
// civicCap 1.12, so a fully civic city always nets positive) with unit slope at zero
// (curve == cap). Without them the linear, uncapped penalty pins a late-game industrial city
// at the 0.25 floor for hours. They are defaulted here too, so the saturation stays on even
// if a balance pass drops the keys; set pollutionCap to 0 in config.js for the linear form.
export const DEFAULTS = Object.freeze({
  economy: Object.freeze({ taxPerPop: 0.08, wage: 0.35 }),
  pop: Object.freeze({ growthRate: 0.1, shrinkRate: 0.2, baseInflow: 0.5 }),
  power: Object.freeze({ brownoutFloor: 0.6 }),
  happiness: Object.freeze({
    civicCap: 1.12,
    civicScale: 1.5,
    pollutionScale: 0.35,
    pollutionCap: 1.1,
    pollutionCurve: 1.0,
    unemploymentPenalty: 0.35,
    overcrowdPenalty: 0.5,
    brownoutPenalty: 0.6,
    min: 0.25,
    max: 3,
  }),
});

// Config resolved from the balance module at init, used when a caller passes none.
let balanceConfig = null;

// Neutral modifier bag for callers that pass none. Never mutated.
const NEUTRAL_MODS = Object.freeze({
  income: 1,
  housing: 1,
  jobs: 1,
  power: 1,
  demand: 1,
  growth: 1,
  inflow: 1,
  happiness: 0,
  cost: 1,
  upkeep: 1,
  byBuilding: Object.freeze({}),
});
const NO_BUILDINGS = Object.freeze({});

// Make sure derived.extra has its breakdown objects (allocated once, mutated after).
function ensureExtra(derived) {
  let x = derived.extra;
  if (!x || typeof x !== 'object') x = derived.extra = {};
  if (!x.penalties || typeof x.penalties !== 'object') {
    x.penalties = { unemployment: 0, overcrowd: 0, brownout: 0, pollution: 0 };
  }
  if (!x.incomeBreakdown || typeof x.incomeBreakdown !== 'object') {
    x.incomeBreakdown = { tax: 0, wages: 0, buildings: 0, upkeep: 0, multiplier: 1 };
  }
  if (!x.happinessBreakdown || typeof x.happinessBreakdown !== 'object') {
    x.happinessBreakdown = { base: 1, civic: 0, mods: 0, unemployment: 0, overcrowd: 0, brownout: 0, pollution: 0, raw: 1, clamped: 1 };
  }
  return x;
}

// Read one tuning number: config value if finite, else the DESIGN default.
function tune(section, key, fallbackSection) {
  return num(section ? section[key] : undefined, fallbackSection[key]);
}

/**
 * Recompute every derived field from state + registry + mods. Called each tick by simulation.
 * Pure apart from writing into `derived`. Safe on an empty city and on garbage inputs.
 *
 * @param {object} state    game state (reads res.pop, buildings)
 * @param {object} derived  output bag (mutated in place)
 * @param {object} mods     resolved modifier bag (core/mods.js); may be null
 * @param {object} [config] balance config; falls back to balance module, then DEFAULTS
 * @returns {object} derived
 */
export function computeDerived(state, derived, mods, config) {
  const cfg = config && typeof config === 'object' ? config : balanceConfig || DEFAULTS;
  const m = mods && typeof mods === 'object' ? mods : NEUTRAL_MODS;
  const byBuilding = m.byBuilding && typeof m.byBuilding === 'object' ? m.byBuilding : NO_BUILDINGS;
  const counts = state && state.buildings && typeof state.buildings === 'object' ? state.buildings : NO_BUILDINGS;
  const pop = nonNeg(state && state.res ? state.res.pop : 0);

  // --- tuning ---------------------------------------------------------------
  const D = DEFAULTS;
  const taxPerPop = tune(cfg.economy, 'taxPerPop', D.economy);
  const wage = tune(cfg.economy, 'wage', D.economy);
  const growthRate = tune(cfg.pop, 'growthRate', D.pop);
  const shrinkRate = tune(cfg.pop, 'shrinkRate', D.pop);
  const baseInflow = tune(cfg.pop, 'baseInflow', D.pop);
  const brownoutFloor = clamp(tune(cfg.power, 'brownoutFloor', D.power), 0, 1);
  const hc = cfg.happiness;
  const civicCap = tune(hc, 'civicCap', D.happiness);
  const civicScale = tune(hc, 'civicScale', D.happiness);
  const pollutionScale = tune(hc, 'pollutionScale', D.happiness);
  // Saturation (see DEFAULTS); config.happiness.pollutionCap = 0 restores the linear form.
  const pollutionCap = Math.max(0, tune(hc, 'pollutionCap', D.happiness));
  const pollutionCurve = Math.max(0, tune(hc, 'pollutionCurve', D.happiness));
  const unemploymentPenalty = tune(hc, 'unemploymentPenalty', D.happiness);
  const overcrowdPenalty = tune(hc, 'overcrowdPenalty', D.happiness);
  const brownoutPenalty = tune(hc, 'brownoutPenalty', D.happiness);
  const happyMin = tune(hc, 'min', D.happiness);
  const happyMax = Math.max(happyMin, tune(hc, 'max', D.happiness));

  // --- global modifiers -----------------------------------------------------
  // Multiplicative mods: missing, non-finite or negative → 1 (same as core/mods.sanitizeMods).
  const modIncome = posOr1(m.income);
  const modHousing = posOr1(m.housing);
  const modJobs = posOr1(m.jobs);
  const modPower = posOr1(m.power);
  const modDemand = posOr1(m.demand);
  const modGrowth = posOr1(m.growth);
  const modInflow = posOr1(m.inflow);
  const modUpkeep = posOr1(m.upkeep);
  const modHappiness = num(m.happiness, 0);
  // A zero cost multiplier means free buildings (and NaN in maxAffordable): treat it as 1,
  // exactly like core/mods.sanitizeMods, so an unsanitized bag cannot break the buy path.
  const modCost = typeof m.cost === 'number' && Number.isFinite(m.cost) && m.cost > 0 ? m.cost : 1;

  // --- sum over owned buildings --------------------------------------------
  let housing = 0;
  let jobs = 0;
  let powerCap = 0;
  let powerDemand = 0;
  let buildingIncome = 0;
  let upkeep = 0;
  let civicSum = 0; // positive per-unit happiness, diminishing
  let pollutionSum = 0; // negative per-unit happiness, linear

  const order = registry.buildingOrder;
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const count = nonNeg(counts[id]);
    if (count === 0) continue;
    const def = registry.buildings.get(id);
    if (!def) continue;
    const bm = byBuilding[id];
    const bHousing = bm ? posOr1(bm.housing) : 1;
    const bJobs = bm ? posOr1(bm.jobs) : 1;
    const bPower = bm ? posOr1(bm.power) : 1;
    const bIncome = bm ? posOr1(bm.income) : 1;
    const bHappy = bm ? num(bm.happiness, 0) : 0;

    housing += count * nonNeg(def.housing) * bHousing;
    jobs += count * nonNeg(def.jobs) * bJobs;
    powerCap += count * nonNeg(def.powerGen) * bPower;
    powerDemand += count * nonNeg(def.powerUse);
    buildingIncome += count * num(def.income) * bIncome;
    upkeep += count * nonNeg(def.upkeep);

    const perUnit = num(def.happiness) + bHappy;
    if (perUnit > 0) civicSum += count * perUnit;
    else if (perUnit < 0) pollutionSum -= count * perUnit;
  }

  // Every sum is clamped to ±FINITE_MAX so absurd inputs (1e308 counts) can never leak an
  // Infinity into derived; at real-game magnitudes this is a no-op.
  housing = finite(housing * modHousing);
  jobs = finite(jobs * modJobs);
  powerCap = finite(powerCap * modPower);
  powerDemand = finite(powerDemand * modDemand);
  upkeep = finite(upkeep * modUpkeep);
  buildingIncome = finite(buildingIncome);
  civicSum = finite(civicSum);
  pollutionSum = finite(pollutionSum);

  // --- power ----------------------------------------------------------------
  const powerRatio = powerRatioOf(powerCap, powerDemand, brownoutFloor);

  // --- labour ---------------------------------------------------------------
  const employed = Math.min(pop, jobs);
  const unemployment = unemploymentOf(pop, employed);
  const overcrowd = overcrowdOf(pop, housing);

  // --- happiness ------------------------------------------------------------
  const civic = civicBonus(civicSum, civicCap, civicScale);
  const pollutionRaw = finite(pollutionSum * pollutionScale); // unsaturated smog, for the UI
  const pollution = pollutionPenalty(pollutionRaw, pollutionCap, pollutionCurve);
  const penUnemployment = unemployment * unemploymentPenalty;
  const penOvercrowd = overcrowd * overcrowdPenalty;
  const penBrownout = (1 - powerRatio) * brownoutPenalty;
  const happinessRaw = finite(1 + civic - pollution - penUnemployment - penOvercrowd - penBrownout + modHappiness);
  const happiness = clamp(happinessRaw, happyMin, happyMax);
  const happinessMult = happinessIncomeCurve(happiness);

  // --- money ----------------------------------------------------------------
  const multiplier = finite(modIncome * powerRatio * happinessMult);
  let tax = finite(pop * taxPerPop * multiplier);
  let wages = finite(employed * wage * multiplier);
  let fromBuildings = finite(buildingIncome * multiplier);
  let grossIncome = tax + wages + fromBuildings;
  if (grossIncome > FINITE_MAX) {
    // Keep the invariant tax + wages + buildings == grossIncome through the clamp.
    const k = FINITE_MAX / grossIncome;
    tax *= k;
    wages *= k;
    fromBuildings *= k;
    grossIncome = FINITE_MAX;
  }
  const income = finite(grossIncome - upkeep);

  // --- population -----------------------------------------------------------
  let popGrowth = 0;
  if (pop < housing) {
    popGrowth = finite((housing - pop) * growthRate * happiness * powerRatio * modGrowth + baseInflow * modInflow);
  } else if (pop > housing) {
    popGrowth = finite(-(pop - housing) * shrinkRate);
  }

  // --- write ----------------------------------------------------------------
  derived.housing = housing;
  derived.jobs = jobs;
  derived.employed = employed;
  derived.powerCap = powerCap;
  derived.powerDemand = powerDemand;
  derived.powerRatio = powerRatio;
  derived.happiness = happiness;
  derived.grossIncome = grossIncome;
  derived.upkeep = upkeep;
  derived.income = income;
  derived.popGrowth = popGrowth;
  derived.costMult = modCost;
  // Always the bag the numbers above were computed from. NEUTRAL_MODS is frozen, so exposing
  // it is safe; leaving a previous tick's bag here would let derived.mods disagree with derived.
  derived.mods = m;

  const x = ensureExtra(derived);
  x.unemployment = unemployment;
  x.overcrowd = overcrowd;
  x.civic = civic; // alias of happinessBreakdown.civic (kept one release for ui)
  x.pollution = pollution; // alias of penalties.pollution (kept one release for ui)
  x.pollutionRaw = pollutionRaw;
  x.happinessMult = happinessMult;
  x.vacancy = finite(Math.max(0, housing - pop));
  x.openJobs = finite(Math.max(0, jobs - employed));
  x.powerSurplus = finite(powerCap - powerDemand);
  x.penalties.unemployment = penUnemployment;
  x.penalties.overcrowd = penOvercrowd;
  x.penalties.brownout = penBrownout;
  x.penalties.pollution = pollution;
  x.incomeBreakdown.tax = tax;
  x.incomeBreakdown.wages = wages;
  x.incomeBreakdown.buildings = fromBuildings;
  x.incomeBreakdown.upkeep = upkeep;
  x.incomeBreakdown.multiplier = multiplier;
  const hb = x.happinessBreakdown;
  hb.base = 1;
  hb.civic = civic;
  hb.mods = modHappiness;
  hb.unemployment = -penUnemployment;
  hb.overcrowd = -penOvercrowd;
  hb.brownout = -penBrownout;
  hb.pollution = -pollution;
  hb.raw = happinessRaw;
  hb.clamped = happiness;

  return derived;
}

// Loads the balance config as a fallback for callers that omit it, and seeds the
// breakdown objects so the UI can read derived.extra before the first tick.
export async function init(game) {
  try {
    if (game && game.derived) ensureExtra(game.derived);
  } catch {
    /* derived is optional here; nothing to seed */
  }
  try {
    const mod = await import('../balance/config.js');
    if (mod && mod.config && typeof mod.config === 'object') balanceConfig = mod.config;
  } catch {
    balanceConfig = null; // balance module absent or broken: DEFAULTS cover us
  }
}
