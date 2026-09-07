// buildings module — registers the 20 Metropolis structures with core.
// DOM-free (runs in Node for the economy sim). Never throws from init.
//
// Balance integration: `src/balance/config.js` owns every tuning number. It is loaded
// via a guarded dynamic import inside init() rather than a static import so that a
// missing or broken config file degrades to the DESIGN.md defaults instead of taking
// the whole buildings module down with it. Overrides in `config.buildings[id]` are
// spread over each definition before `registerBuilding`.
//
// Signature mechanics: a definition may carry `synergy: { stat, source, per, cap }` (see
// data.js). The `buildings:synergy` tick handler runs at priority −10, before the
// simulation's fold, and writes `base × factor` into the registered definition's stat,
// so computeDerived, the bot's scoring and the build card all read one live number. The
// base is the value resolved at registration (data + config override), so a balance
// override of the stat still scales the way the rule says.
//
// One-tick lag, by design: the handler reads `derived` as the previous tick left it (the
// simulation recomputes it after us), so a rule sourced from `employed` is one tick behind
// pop/jobs. On the very first tick after a load `derived.employed` is not set yet; the
// source then falls back to min(pop, jobs) from the same bag (or 0), so the financial
// district never flashes its base income for a frame after a reload.
import { registerBuilding, registerTickHandler, registry } from '../core/registry.js';
import { reportError } from '../core/safe.js';
import { BUILDINGS, CATEGORIES } from './data.js';

export { BUILDINGS, CATEGORIES };

// DESIGN.md defaults; config.cost.tierGrowth wins when present.
const DEFAULT_TIER_GROWTH = { 1: 1.15, 2: 1.14, 3: 1.13, 4: 1.12 };
const NUMERIC_FIELDS = ['baseCost', 'costGrowth', 'housing', 'jobs', 'powerUse', 'powerGen', 'income', 'upkeep', 'happiness', 'sellRefund', 'tier'];
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
// Stats a synergy may scale. Cost is deliberately excluded (cost mods belong to the mods bag).
const SYNERGY_STATS = new Set(['income', 'housing', 'jobs', 'powerGen', 'happiness']);
export const SYNERGY_HANDLER = 'buildings:synergy';
const SYNERGY_PRIORITY = -10; // before simulation's 'simulate' (0)

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function getCategory(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

// Cost growth for a tier: balance's costGrowthFor(tier) → config.cost.tierGrowth → defaults.
export function costGrowthForTier(tier, balance) {
  const t = Number.isInteger(tier) ? tier : 1;
  if (typeof balance?.costGrowthFor === 'function') {
    try {
      const g = balance.costGrowthFor(t);
      if (isFiniteNum(g) && g >= 1) return g;
    } catch (e) {
      reportError('buildings:costGrowthFor', e);
    }
  }
  const g = balance?.config?.cost?.tierGrowth?.[t];
  if (isFiniteNum(g) && g >= 1) return g;
  return DEFAULT_TIER_GROWTH[t] ?? DEFAULT_TIER_GROWTH[4];
}

// Merge a config.buildings[id] partial override, dropping anything that would poison the sim.
function applyOverride(def, override) {
  if (!isObj(override)) return { ...def };
  const out = { ...def };
  for (const [k, v] of Object.entries(override)) {
    if (k === 'id') continue;
    if (k === 'unlock') {
      if (typeof v === 'function' || v === null) out.unlock = v;
      continue;
    }
    if (NUMERIC_FIELDS.includes(k)) {
      if (isFiniteNum(v)) out[k] = v;
      continue;
    }
    if (k === 'category') {
      if (CATEGORY_IDS.has(v)) out.category = v;
      continue;
    }
    if (k === 'synergy') {
      // null switches the hook off; anything else must be a well-formed rule.
      if (v === null || normalizeSynergy(v)) out.synergy = v;
      continue;
    }
    out[k] = v;
  }
  return out;
}

// Fully resolved definition for `id` (data + config override + cost growth). Pure.
export function resolveBuilding(base, balance) {
  const override = balance?.config?.buildings?.[base.id];
  const def = applyOverride(base, override);
  if (!isFiniteNum(def.costGrowth) || def.costGrowth < 1) def.costGrowth = costGrowthForTier(def.tier, balance);
  const refund = balance?.config?.cost?.sellRefund;
  if (def.sellRefund === undefined && isFiniteNum(refund) && refund >= 0 && refund <= 1) def.sellRefund = refund;
  if (!isFiniteNum(def.baseCost) || def.baseCost <= 0) def.baseCost = base.baseCost;
  if (typeof def.unlock !== 'function') def.unlock = undefined;
  return def;
}

// ---- synergies ---------------------------------------------------------------------

// Validated copy of a synergy rule, or null when it is malformed. Pure.
export function normalizeSynergy(s) {
  if (!isObj(s)) return null;
  if (!SYNERGY_STATS.has(s.stat)) return null;
  if (!(isFiniteNum(s.per) && s.per > 0)) return null;
  if (!(isFiniteNum(s.cap) && s.cap >= 1)) return null;
  if (typeof s.source !== 'string') return null;
  if (s.source !== 'pop' && s.source !== 'employed' && !/^building:[a-z0-9_-]+$/i.test(s.source)) return null;
  return { stat: s.stat, source: s.source, per: s.per, cap: s.cap, text: typeof s.text === 'string' ? s.text : '' };
}

// The number a synergy source currently reads: population, employed citizens, or an owned
// building count. Garbage inputs read as 0. Pure.
export function synergySource(source, state, derived) {
  let v = 0;
  if (source === 'pop') v = state?.res?.pop;
  else if (source === 'employed') {
    v = derived?.employed;
    // Before the first simulate() of a session `employed` is unset; derive it from what
    // the bag does carry rather than reading the district at base for one frame.
    if (!isFiniteNum(v)) {
      const jobs = derived?.jobs;
      const p = state?.res?.pop;
      v = isFiniteNum(jobs) && isFiniteNum(p) ? Math.min(p, jobs) : 0;
    }
  }
  else if (typeof source === 'string' && source.startsWith('building:')) v = state?.buildings?.[source.slice(9)];
  return isFiniteNum(v) && v > 0 ? v : 0;
}

// Multiplier for a rule: min(cap, 1 + source / per), never below 1. Pure.
export function synergyFactor(rule, state, derived) {
  const s = normalizeSynergy(rule);
  if (!s) return 1;
  const f = 1 + synergySource(s.source, state, derived) / s.per;
  return f > s.cap ? s.cap : f >= 1 ? f : 1;
}

// Active rules: { id, stat, base, rule } for every registered building with a valid synergy.
const synergies = [];
// Base value per id, pinned the first time a rule is collected so a repeated init (or a
// collect after a tick has already scaled the def) never compounds the factor.
const synergyBases = new Map();

function collectSynergies() {
  synergies.length = 0;
  for (const id of registry.buildingOrder) {
    const def = registry.buildings.get(id);
    if (!def || def.synergy === undefined || def.synergy === null) continue;
    const rule = normalizeSynergy(def.synergy);
    if (!rule) {
      reportError('buildings:' + id, new Error('malformed synergy rule ignored'));
      continue;
    }
    const key = id + ':' + rule.stat;
    const base = synergyBases.has(key) ? synergyBases.get(key) : def[rule.stat];
    if (!isFiniteNum(base)) continue;
    synergyBases.set(key, base);
    synergies.push({ id, stat: rule.stat, base, rule });
  }
}

// Write each synergy's live value into its registered definition. Idempotent: the value is
// always base × factor, so repeated calls never compound.
export function applySynergies(state, derived) {
  for (let i = 0; i < synergies.length; i++) {
    const s = synergies[i];
    const def = registry.buildings.get(s.id);
    if (!def) continue;
    def[s.stat] = s.base * synergyFactor(s.rule, state, derived);
  }
}

// Registered rules (read-only view for tools and tests).
export function activeSynergies() {
  return synergies.map((s) => ({ id: s.id, stat: s.stat, base: s.base, ...s.rule }));
}

// ---- init ---------------------------------------------------------------------------

async function loadBalance(game) {
  // Integrator may attach the resolved balance module directly; prefer that.
  if (isObj(game?.balance?.config)) return game.balance;
  if (isObj(game?.config)) return { config: game.config };
  try {
    const mod = await import('../balance/config.js');
    if (isObj(mod?.config)) return mod;
    return { config: {} };
  } catch (e) {
    // Balance not built yet (or failed) — fall back to DESIGN.md numbers, no error raised:
    // the integrator's boot already reports balance failures under its own module name.
    return { config: {} };
  }
}

export async function init(game) {
  try {
    const balance = await loadBalance(game);
    for (const base of BUILDINGS) {
      if (registry.buildings.has(base.id)) continue; // idempotent across repeated init
      try {
        registerBuilding(resolveBuilding(base, balance));
      } catch (e) {
        reportError('buildings:' + base.id, e);
      }
    }
    collectSynergies();
    if (synergies.length) registerTickHandler(SYNERGY_HANDLER, applySynergies, SYNERGY_PRIORITY);
    if (game && typeof game === 'object') {
      const count = BUILDINGS.filter((b) => registry.buildings.has(b.id)).length;
      game.buildings = { count, categories: CATEGORIES, synergies: activeSynergies() };
    }
  } catch (e) {
    reportError('buildings:init', e);
  }
}
