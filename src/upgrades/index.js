// upgrades module — registers every upgrade definition with the core registry.
// DOM-free (runs in Node for the economy sim). Never throws from init.
import { registerUpgrade, registerTickHandler, registerAction, registry } from '../core/registry.js';
import { reportError } from '../core/safe.js';
import { on, emit } from '../core/events.js';
import { addLog } from '../core/state.js';
import { UPGRADES, UPGRADE_CATEGORIES, MILESTONE_IDS, FRONTIER_GATE, PACE_GATE, CHARTER_GATE, earnedUnlock, frontierUnlock, charterUnlockFor, keptUpgradeIds, isPermanent } from './data.js';

export { UPGRADES, UPGRADE_CATEGORIES, MILESTONE_IDS, FRONTIER_GATE, PACE_GATE, CHARTER_GATE, earnedUnlock, frontierUnlock, charterUnlockFor, keptUpgradeIds, isPermanent };

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
  // Rungs whose gate is a share of their own price (frontier: earned ≥ cost/4; pace rungs:
  // earned ≥ 100 × cost; charter perks: legacy ≥ cost/2) get a new gate, hint, progress
  // mirror — and, for a perk, the tier bracket — with the new price. The rules live in
  // data.js so this stays two lines.
  if (out.cost !== def.cost) {
    if (out.earnedGate) Object.assign(out, earnedUnlock(out));
    else if (out.currency === 'legacy') Object.assign(out, charterUnlockFor(out));
  }
  if (typeof override === 'object') {
    if (Number.isInteger(override.tier) && override.tier > 0) out.tier = override.tier;
    if (typeof override.category === 'string' && CATEGORY_IDS.has(override.category)) out.category = override.category;
  }
  return out;
}

// Sorted view of the *registered* definitions (config overrides applied): by cost
// ascending, then registration order. Handy for UI/bots. Before init (or in a test with
// an empty registry) it falls back to the raw data. Legacy-priced perks sort by their
// point price among the dollar rungs; callers that care split on `currency`.
export function sortedUpgrades(defs) {
  const list = defs || (registry.upgradeOrder.length ? registry.upgradeOrder.map((id) => registry.upgrades.get(id)) : UPGRADES);
  return list
    .map((d, i) => [d, i])
    .sort((a, b) => a[0].cost - b[0].cost || a[1] - b[1])
    .map(([d]) => d);
}

// ---------- founding memory ----------
//
// A founding wipes state.upgrades. Two kinds of rung come back on their own:
//   • charter perks (`currency: 'legacy'`, data.js): paid in legacy points, which a
//     founding never refunds, so they are permanent by construction;
//   • the upgrades a keeper rung (`keeps(def)`: Institutional Memory, Standing Orders)
//     remembers while it is owned.
// Ownership is read from the state every tick (so a loaded save is honoured), and on the
// 'prestige' event — which the simulation fires *after* the reset has wiped
// state.upgrades — the remembered set is granted back through `grantUpgrade` below. No
// money changes hands and no modifier is touched: the kept upgrades fold into the mods
// bag on the next tick exactly as if they had been bought.
//
// `grantUpgrade(id)` is the one seam through which ownership changes without a purchase
// (exposed as api.action('grantUpgrade', id) for tools and the UI): it writes the flag
// and emits the same 'upgrade' event api.buyUpgrade does, with `cost: 0` and
// `granted: true`, so list rebuilds, save debouncing and any first-upgrade counter see
// the grant the same way they see a purchase. Returns true when the flag was newly set.

export async function init(game) {
  let cfg = {};
  try {
    cfg = await loadBalanceConfig();
  } catch (e) {
    reportError('upgrades:config', e);
  }
  const overrides = cfg.upgrades && typeof cfg.upgrades === 'object' ? cfg.upgrades : {};
  const registered = []; // every registered definition, in ladder order
  for (const raw of UPGRADES) {
    try {
      const def = applyOverride(raw, overrides[raw.id]);
      if (def.desc.length > DESC_MAX) reportError('upgrades:lint', new Error(`${def.id}: desc longer than ${DESC_MAX} chars`));
      if (!CATEGORY_IDS.has(def.category)) reportError('upgrades:lint', new Error(`${def.id}: unknown category ${def.category}`));
      if (typeof def.unlockHint !== 'string' || !def.unlockHint) reportError('upgrades:lint', new Error(`${def.id}: missing unlockHint`));
      if (def.currency === 'legacy' && def.category !== 'charter') reportError('upgrades:lint', new Error(`${def.id}: legacy-priced rung outside the charter`));
      const reg = registerUpgrade(def);
      if (reg) registered.push(reg);
    } catch (e) {
      reportError('upgrades:' + raw.id, e);
    }
  }

  const grantUpgrade = (id) => {
    const state = game && game.state;
    if (!state || !state.upgrades || typeof id !== 'string' || !registry.upgrades.has(id)) return false;
    if (state.upgrades[id]) return false;
    state.upgrades[id] = true;
    emit('upgrade', { id, cost: 0, granted: true });
    return true;
  };
  registerAction('grantUpgrade', grantUpgrade);

  // Founding memory: which permanent rungs (charter perks, keeper rungs) the current city
  // owns, refreshed every tick and on every purchase (a mayor may buy a perk and found a
  // city inside the same frame).
  const persistent = registered.filter((d) => isPermanent(d) || typeof d.keeps === 'function');
  if (persistent.length) {
    const ownedPersistent = new Set();
    const refresh = (state) => {
      ownedPersistent.clear();
      if (!state || !state.upgrades) return;
      for (const d of persistent) if (state.upgrades[d.id]) ownedPersistent.add(d.id);
    };
    registerTickHandler('upgrades:memory', (state) => refresh(state), -11);
    on('upgrade', (e) => {
      if (e && persistent.some((d) => d.id === e.id)) ownedPersistent.add(e.id);
    });
    on('load', () => refresh(game && game.state));
    on('prestige', () => {
      if (ownedPersistent.size === 0) return;
      const kept = keptUpgradeIds([...ownedPersistent], registered);
      let perks = 0;
      let carried = 0;
      for (const id of kept) {
        if (!grantUpgrade(id)) continue;
        if (isPermanent(registry.upgrades.get(id))) perks++;
        else carried++;
      }
      if (perks > 0) addLog(`The charter stands: ${perks} ${perks === 1 ? 'perk carries' : 'perks carry'} into the new city.`, 'prestige');
      if (carried > 0) addLog(`The archives reopen: ${carried} upgrades carried over from the last city.`, 'upgrade');
    });
  }

  // "Fund all affordable": buys every unlocked, affordable, unowned upgrade cheapest-first
  // (so the money goes as far as it can) and returns how many were funded. Exposed as
  // api.action('fundUpgrades') for the UI's one-click catch-up after a founding. Charter
  // perks are left to the mayor: legacy points are a deliberate spend, never a sweep.
  registerAction('fundUpgrades', () => {
    const api = game && game.api;
    if (!api || typeof api.upgrades !== 'function') return 0;
    let bought = 0;
    for (let pass = 0; pass < 4; pass++) {
      // A purchase can unlock the next rung (Superconductor Grid follows Orbital Solar),
      // so sweep again until a pass buys nothing.
      const affordable = api
        .upgrades()
        .filter((u) => u.unlocked && !u.owned && u.affordable && u.currency !== 'legacy')
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
