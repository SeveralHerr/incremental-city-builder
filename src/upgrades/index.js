// upgrades module — registers every upgrade definition with the core registry.
// DOM-free (runs in Node for the economy sim). Never throws from init.
import { registerUpgrade, registerTickHandler, registerAction, registry } from '../core/registry.js';
import { reportError } from '../core/safe.js';
import { on } from '../core/events.js';
import { addLog } from '../core/state.js';
import { UPGRADES, UPGRADE_CATEGORIES, MILESTONE_IDS, BOND_RUNGS, horizonCost, keptUpgradeIds } from './data.js';

export { UPGRADES, UPGRADE_CATEGORIES, MILESTONE_IDS, BOND_RUNGS, horizonCost, keptUpgradeIds };

const CATEGORY_IDS = new Set(UPGRADE_CATEGORIES.map((c) => c.id));
const DESC_MAX = 70;

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

export function applyOverride(def, override) {
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

// Sorted view of the *registered* definitions (config overrides applied, income-priced rungs
// at this tick's price): by cost ascending, then registration order. Handy for UI/bots.
// Before init (or in a test with an empty registry) it falls back to the raw data.
export function sortedUpgrades(defs) {
  const list = defs || (registry.upgradeOrder.length ? registry.upgradeOrder.map((id) => registry.upgrades.get(id)) : UPGRADES);
  return list
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

// ---------- founding memory ----------
//
// Rungs carrying `keeps(def)` (Institutional Memory, Standing Orders in data.js) re-own
// the upgrades they keep the moment a new city is founded. Ownership is read from the
// state every tick (so a loaded save is honoured), and on the 'prestige' event — which the
// simulation fires *after* the reset has wiped state.upgrades — the remembered set is
// written back. No money changes hands and no modifier is touched: the kept upgrades fold
// into the mods bag on the next tick exactly as if they had been bought.

export async function init(game) {
  let cfg = {};
  try {
    cfg = await loadBalanceConfig();
  } catch (e) {
    reportError('upgrades:config', e);
  }
  const overrides = cfg.upgrades && typeof cfg.upgrades === 'object' ? cfg.upgrades : {};
  const priced = []; // registered definitions whose cost tracks the run's income
  const registered = []; // every registered definition, in ladder order
  for (const raw of UPGRADES) {
    try {
      const def = applyOverride(raw, overrides[raw.id]);
      if (def.desc.length > DESC_MAX) reportError('upgrades:lint', new Error(`${def.id}: desc longer than ${DESC_MAX} chars`));
      if (!CATEGORY_IDS.has(def.category)) reportError('upgrades:lint', new Error(`${def.id}: unknown category ${def.category}`));
      if (typeof def.unlockHint !== 'string' || !def.unlockHint) reportError('upgrades:lint', new Error(`${def.id}: missing unlockHint`));
      const reg = registerUpgrade(def);
      if (reg) {
        registered.push(reg);
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

  // Founding memory: which keeper rungs the current city owns, refreshed every tick and on
  // every purchase (a mayor may buy the rung and found a city inside the same frame).
  const keepers = registered.filter((d) => typeof d.keeps === 'function');
  if (keepers.length) {
    const ownedKeepers = new Set();
    const refresh = (state) => {
      ownedKeepers.clear();
      if (!state || !state.upgrades) return;
      for (const k of keepers) if (state.upgrades[k.id]) ownedKeepers.add(k.id);
    };
    registerTickHandler('upgrades:memory', (state) => refresh(state), -11);
    on('upgrade', (e) => {
      if (e && keepers.some((k) => k.id === e.id)) ownedKeepers.add(e.id);
    });
    on('load', () => refresh(game && game.state));
    on('prestige', () => {
      const state = game && game.state;
      if (!state || !state.upgrades || ownedKeepers.size === 0) return;
      const kept = keptUpgradeIds([...ownedKeepers], registered);
      let granted = 0;
      for (const id of kept) {
        if (!state.upgrades[id]) {
          state.upgrades[id] = true;
          granted++;
        }
      }
      if (granted > 0) addLog(`The archives reopen: ${granted} upgrades carried over from the last city.`, 'upgrade');
    });
  }

  // "Fund all affordable": buys every unlocked, affordable, unowned upgrade cheapest-first
  // (so the money goes as far as it can) and returns how many were funded. Exposed as
  // api.action('fundUpgrades') for the UI's one-click catch-up after a founding.
  registerAction('fundUpgrades', () => {
    const api = game && game.api;
    if (!api || typeof api.upgrades !== 'function') return 0;
    let bought = 0;
    for (let pass = 0; pass < 4; pass++) {
      // A purchase can unlock the next rung (Civic Bonds follow one another), so sweep again
      // until a pass buys nothing.
      const affordable = api
        .upgrades()
        .filter((u) => u.unlocked && !u.owned && u.affordable)
        .sort((a, b) => a.cost - b.cost);
      let n = 0;
      for (const u of affordable) if (api.buyUpgrade(u.id)) n++;
      bought += n;
      if (n === 0) break;
    }
    return bought;
  });

  if (game && typeof game === 'object') {
    game.upgradeCategories = UPGRADE_CATEGORIES;
    game.upgradeMilestoneIds = MILESTONE_IDS;
  }
  return registered.length;
}
