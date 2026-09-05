// upgrades module — registers every upgrade definition with the core registry.
// DOM-free (runs in Node for the economy sim). Never throws from init.
import { registerUpgrade, registerTickHandler } from '../core/registry.js';
import { reportError } from '../core/safe.js';
import { UPGRADES, UPGRADE_CATEGORIES, MILESTONE_IDS, BOND_RUNGS, horizonCost } from './data.js';

export { UPGRADES, UPGRADE_CATEGORIES, MILESTONE_IDS, BOND_RUNGS, horizonCost };

const CATEGORY_IDS = new Set(UPGRADE_CATEGORIES.map((c) => c.id));

// Balance overrides live in src/balance/config.js as `config.upgrades[id]`, either a bare
// number (cost) or `{ cost, tier?, category? }`. The balance module may not exist yet, so
// load it lazily and tolerate its absence.
async function loadBalanceConfig() {
  const candidates = ['../balance/config.js', '../balance/index.js'];
  for (const path of candidates) {
    try {
      const mod = await import(path);
      const cfg = mod?.config ?? mod?.default;
      if (cfg && typeof cfg === 'object') return cfg;
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

// ---------- earnings-priced rungs ----------
//
// Rungs carrying `priced: { seconds, floor }` (the horizon ladder in data.js) cost
// `max(floor, seconds × current income)` — see data.js for why they are not priced in
// dollars. The registry stores a plain `cost` number that api/ui/bot read, so a tick
// handler (priority −10, i.e. before simulate, reading last tick's derived.income) rewrites
// it every tick; the pure rule is `horizonCost` in data.js. At 35 rungs that is a handful
// of multiplies per tick.

export async function init(game) {
  let cfg = {};
  try {
    cfg = await loadBalanceConfig();
  } catch (e) {
    reportError('upgrades:config', e);
  }
  const overrides = cfg.upgrades && typeof cfg.upgrades === 'object' ? cfg.upgrades : {};
  const priced = []; // registered definitions whose cost tracks the run's income
  let registered = 0;
  for (const raw of UPGRADES) {
    try {
      const def = applyOverride(raw, overrides[raw.id]);
      if (def.desc.length > 70) reportError('upgrades:lint', new Error(`${def.id}: desc longer than 70 chars`));
      if (!CATEGORY_IDS.has(def.category)) reportError('upgrades:lint', new Error(`${def.id}: unknown category ${def.category}`));
      const reg = registerUpgrade(def);
      if (reg) {
        registered++;
        if (reg.priced && typeof reg.priced === 'object') priced.push(reg);
      }
    } catch (e) {
      reportError('upgrades:' + raw.id, e);
    }
  }

  const syncPricedCosts = (derived) => {
    for (const def of priced) def.cost = horizonCost(def, derived);
  };
  if (priced.length) {
    registerTickHandler('upgrades:income-prices', (state, derived) => syncPricedCosts(derived), -10);
    if (game && game.derived) syncPricedCosts(game.derived);
  }

  if (game && typeof game === 'object') {
    game.upgradeCategories = UPGRADE_CATEGORIES;
    game.upgradeMilestoneIds = MILESTONE_IDS;
  }
  return registered;
}
