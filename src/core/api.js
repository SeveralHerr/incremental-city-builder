// Public game API (used by UI, bot, tools). Pure logic; DOM-free.
import { state, derived, addLog } from './state.js';
import { registry, getBuilding, getUpgrade } from './registry.js';
import { emit } from './events.js';
import { step } from './loop.js';

const MAX_COUNT = 1e9;

export function buildingCost(def, count = state.buildings[def.id] || 0, n = 1) {
  const g = def.costGrowth;
  const mult = (derived.costMult || 1) * (derived.mods?.byBuilding?.[def.id]?.cost ?? 1);
  if (n === 1) return def.baseCost * Math.pow(g, count) * mult;
  // geometric series sum for n purchases starting at `count`
  const first = def.baseCost * Math.pow(g, count);
  const sum = g === 1 ? first * n : (first * (Math.pow(g, n) - 1)) / (g - 1);
  return sum * mult;
}

// Max affordable count for a building with current money.
export function maxAffordable(def, money = state.res.money) {
  const count = state.buildings[def.id] || 0;
  const g = def.costGrowth;
  const mult = (derived.costMult || 1) * (derived.mods?.byBuilding?.[def.id]?.cost ?? 1);
  const first = def.baseCost * Math.pow(g, count) * mult;
  if (first > money) return 0;
  if (g === 1) return Math.floor(money / first);
  let n = Math.floor(Math.log((money * (g - 1)) / first + 1) / Math.log(g));
  n = Math.max(0, Math.min(n, 10000));
  // The closed form can land one off in either direction when money sits within float error
  // of an exact n-purchase total (log/pow round differently from the series sum): walk back so
  // buy(id, 'max') never fails its own affordability check, and walk forward so an exact total
  // buys every unit it pays for.
  while (n > 0 && buildingCost(def, count, n) > money) n--;
  while (n < 10000 && buildingCost(def, count, n + 1) <= money) n++;
  return n;
}

export function isBuildingUnlocked(def) {
  const key = 'b:' + def.id;
  if (state.unlocks[key]) return true;
  if (!def.unlock) {
    state.unlocks[key] = true;
    return true;
  }
  const ok = def.unlock(state, derived) === true;
  if (ok) {
    state.unlocks[key] = true;
    emit('unlock', { kind: 'building', id: def.id });
  }
  return ok;
}

export function isUpgradeUnlocked(def) {
  const key = 'u:' + def.id;
  if (state.unlocks[key]) return true;
  if (!def.unlock) {
    state.unlocks[key] = true;
    return true;
  }
  const ok = def.unlock(state, derived) === true;
  if (ok) {
    state.unlocks[key] = true;
    emit('unlock', { kind: 'upgrade', id: def.id });
  }
  return ok;
}

export function buildings() {
  const out = [];
  for (const id of registry.buildingOrder) {
    const def = registry.buildings.get(id);
    const count = state.buildings[id] || 0;
    const cost = buildingCost(def, count, 1);
    out.push({
      ...def,
      count,
      cost,
      affordable: state.res.money >= cost,
      unlocked: isBuildingUnlocked(def),
    });
  }
  return out;
}

// Legacy points not yet spent on charter perks. The income bonus always uses the full bank
// (state.prestige.legacy); spending never lowers it.
export function legacyAvailable() {
  const p = state.prestige || {};
  const legacy = Number.isFinite(p.legacy) && p.legacy > 0 ? Math.floor(p.legacy) : 0;
  const spent = Number.isFinite(p.spent) && p.spent > 0 ? Math.floor(p.spent) : 0;
  return Math.max(0, legacy - spent);
}

// Upgrades are priced in money by default; `currency: 'legacy'` prices them in legacy points.
export function upgradeCurrency(def) {
  return def && def.currency === 'legacy' ? 'legacy' : 'money';
}

export function canAffordUpgrade(def) {
  if (!def) return false;
  return upgradeCurrency(def) === 'legacy' ? legacyAvailable() >= def.cost : state.res.money >= def.cost;
}

export function upgrades() {
  const out = [];
  for (const id of registry.upgradeOrder) {
    const def = registry.upgrades.get(id);
    const owned = !!state.upgrades[id];
    out.push({
      ...def,
      currency: upgradeCurrency(def),
      owned,
      affordable: canAffordUpgrade(def),
      unlocked: isUpgradeUnlocked(def),
    });
  }
  return out;
}

export function buy(id, n = 1) {
  const def = getBuilding(id);
  if (!def) return false;
  if (!isBuildingUnlocked(def)) return false;
  const count = state.buildings[id] || 0;
  if (n === 'max') n = maxAffordable(def);
  n = Math.floor(n);
  if (n <= 0 || count + n > MAX_COUNT) return false;
  const cost = buildingCost(def, count, n);
  if (!(state.res.money >= cost)) return false;
  state.res.money -= cost;
  state.buildings[id] = count + n;
  state.stats.buildingsBuilt += n;
  emit('buy', { id, n, cost, count: count + n });
  return true;
}

export function sell(id, n = 1) {
  const def = getBuilding(id);
  if (!def) return false;
  const count = state.buildings[id] || 0;
  n = Math.min(Math.floor(n), count);
  if (n <= 0) return false;
  const refund = buildingCost(def, count - n, n) * (def.sellRefund ?? 0.5);
  state.buildings[id] = count - n;
  state.res.money += refund;
  emit('sell', { id, n, refund, count: count - n });
  return true;
}

export function buyUpgrade(id) {
  const def = getUpgrade(id);
  if (!def || state.upgrades[id]) return false;
  if (!isUpgradeUnlocked(def)) return false;
  if (!canAffordUpgrade(def)) return false;
  const currency = upgradeCurrency(def);
  if (currency === 'legacy') {
    if (!state.prestige || typeof state.prestige !== 'object') state.prestige = { legacy: 0, spent: 0, lifetimeEarned: 0 };
    state.prestige.spent = (Number.isFinite(state.prestige.spent) ? Math.floor(state.prestige.spent) : 0) + def.cost;
    addLog(`Charter: ${def.name}`, 'prestige');
  } else {
    state.res.money -= def.cost;
    addLog(`Upgrade: ${def.name}`, 'upgrade');
  }
  state.upgrades[id] = true;
  emit('upgrade', { id, cost: def.cost, currency });
  return true;
}

export function action(name, ...args) {
  const fn = registry.actions.get(name);
  if (!fn) return undefined;
  return fn(...args);
}

export function canPrestige() {
  return action('canPrestige') === true;
}
export function prestigeGain() {
  const v = action('prestigeGain');
  return Number.isFinite(v) ? v : 0;
}
export function prestige() {
  return action('prestige') === true;
}

export const api = {
  buildings,
  upgrades,
  buy,
  sell,
  buyUpgrade,
  legacyAvailable,
  upgradeCurrency,
  canAffordUpgrade,
  buildingCost,
  maxAffordable,
  action,
  canPrestige,
  prestigeGain,
  prestige,
  step,
};
