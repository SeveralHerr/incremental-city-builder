// buildings module — registers the 20 Metropolis structures with core.
// DOM-free (runs in Node for the economy sim). Never throws from init.
//
// Balance integration: `src/balance/config.js` owns every tuning number. It is loaded
// via a guarded dynamic import inside init() rather than a static import so that a
// missing or broken config file degrades to the DESIGN.md defaults instead of taking
// the whole buildings module down with it. Overrides in `config.buildings[id]` are
// spread over each definition before `registerBuilding`.
import { registerBuilding, registry } from '../core/registry.js';
import { reportError } from '../core/safe.js';
import { BUILDINGS, CATEGORIES } from './data.js';

export { BUILDINGS, CATEGORIES };

// DESIGN.md defaults; config.cost.tierGrowth wins when present.
const DEFAULT_TIER_GROWTH = { 1: 1.15, 2: 1.14, 3: 1.13, 4: 1.12 };
const NUMERIC_FIELDS = ['baseCost', 'costGrowth', 'housing', 'jobs', 'powerUse', 'powerGen', 'income', 'upkeep', 'happiness', 'sellRefund', 'tier'];
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

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
    if (game && typeof game === 'object') {
      const count = BUILDINGS.filter((b) => registry.buildings.has(b.id)).length;
      game.buildings = { count, categories: CATEGORIES };
    }
  } catch (e) {
    reportError('buildings:init', e);
  }
}
