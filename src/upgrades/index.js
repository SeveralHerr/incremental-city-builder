// upgrades module — registers every upgrade definition with the core registry.
// DOM-free (runs in Node for the economy sim). Never throws from init.
import { registerUpgrade } from '../core/registry.js';
import { reportError } from '../core/safe.js';
import { UPGRADES, UPGRADE_CATEGORIES, MILESTONE_IDS } from './data.js';

export { UPGRADES, UPGRADE_CATEGORIES, MILESTONE_IDS };

const CATEGORY_IDS = new Set(UPGRADE_CATEGORIES.map((c) => c.id));

// Balance overrides live in src/balance/config.js as `config.upgrades[id]`, either a bare
// number (cost) or `{ cost }`. The balance module may not exist yet, so load it lazily
// and tolerate its absence.
async function loadUpgradeOverrides() {
  const candidates = ['../balance/config.js', '../balance/index.js'];
  for (const path of candidates) {
    try {
      const mod = await import(path);
      const cfg = mod?.config ?? mod?.default;
      const overrides = cfg?.upgrades;
      if (overrides && typeof overrides === 'object') return overrides;
    } catch {
      // module missing or broken: fall through to the next candidate / defaults
    }
  }
  return {};
}

function applyOverride(def, override) {
  if (override === undefined || override === null) return def;
  const out = { ...def };
  const cost = typeof override === 'number' ? override : override.cost;
  if (Number.isFinite(cost) && cost > 0) out.cost = cost;
  if (typeof override === 'object') {
    if (Number.isInteger(override.tier) && override.tier > 0) out.tier = override.tier;
    if (typeof override.category === 'string' && CATEGORY_IDS.has(override.category)) out.category = override.category;
  }
  return out;
}

// Sorted view of definitions: by cost ascending, then declaration order. Handy for UI/bots.
export function sortedUpgrades(defs = UPGRADES) {
  return defs
    .map((d, i) => [d, i])
    .sort((a, b) => a[0].cost - b[0].cost || a[1] - b[1])
    .map(([d]) => d);
}

export async function init(game) {
  let overrides = {};
  try {
    overrides = await loadUpgradeOverrides();
  } catch (e) {
    reportError('upgrades:config', e);
  }
  let registered = 0;
  for (const raw of UPGRADES) {
    try {
      const def = applyOverride(raw, overrides[raw.id]);
      if (def.desc.length > 70) reportError('upgrades:lint', new Error(`${def.id}: desc longer than 70 chars`));
      if (!CATEGORY_IDS.has(def.category)) reportError('upgrades:lint', new Error(`${def.id}: unknown category ${def.category}`));
      if (registerUpgrade(def)) registered++;
    } catch (e) {
      reportError('upgrades:' + raw.id, e);
    }
  }
  if (game && typeof game === 'object') {
    game.upgradeCategories = UPGRADE_CATEGORIES;
    game.upgradeMilestoneIds = MILESTONE_IDS;
  }
  return registered;
}
