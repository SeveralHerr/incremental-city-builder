// Public game API (used by UI, bot, tools). Pure logic; DOM-free.
import { state, derived, addLog, MAX_COUNT } from './state.js';
import { registry, getBuilding, getUpgrade } from './registry.js';
import { emit } from './events.js';
import { step } from './loop.js';

// Most units of `def` a player may own: the def's optional `maxCount` (e.g. a windmill whose
// ×2 cost curve turns it into a trap past a dozen), else the global MAX_COUNT ceiling.
export function buildingCap(def) {
  const m = def.maxCount;
  return Number.isInteger(m) && m >= 1 ? Math.min(m, MAX_COUNT) : MAX_COUNT;
}

export function buildingCost(def, count = state.buildings[def.id] || 0, n = 1) {
  const g = def.costGrowth;
  const mult = (derived.costMult || 1) * (derived.mods?.byBuilding?.[def.id]?.cost ?? 1);
  if (n === 1) return def.baseCost * Math.pow(g, count) * mult;
  // geometric series sum for n purchases starting at `count`
  const first = def.baseCost * Math.pow(g, count);
  const sum = g === 1 ? first * n : (first * (Math.pow(g, n) - 1)) / (g - 1);
  return sum * mult;
}

// Max affordable count for a building with current money, never past the def's cap
// (maxCount / MAX_COUNT) and never more than 10,000 per call. Non-finite money (NaN, or an
// Infinity that sanitize() has not clamped yet) buys nothing: the closed form would return
// 10,000 units whose Infinity cost passes `Infinity >= Infinity` and leaves NaN in the wallet.
export function maxAffordable(def, money = state.res.money) {
  if (!Number.isFinite(money)) return 0;
  const count = state.buildings[def.id] || 0;
  const limit = Math.min(10000, buildingCap(def) - count);
  if (limit <= 0) return 0;
  const g = def.costGrowth;
  const mult = (derived.costMult || 1) * (derived.mods?.byBuilding?.[def.id]?.cost ?? 1);
  const first = def.baseCost * Math.pow(g, count) * mult;
  if (first > money) return 0;
  if (g === 1) return Math.min(limit, Math.floor(money / first));
  let n = Math.floor(Math.log((money * (g - 1)) / first + 1) / Math.log(g));
  n = Math.max(0, Math.min(n, limit));
  // The closed form can land one off in either direction when money sits within float error
  // of an exact n-purchase total (log/pow round differently from the series sum): walk back so
  // buy(id, 'max') never fails its own affordability check, and walk forward so an exact total
  // buys every unit it pays for.
  while (n > 0 && buildingCost(def, count, n) > money) n--;
  while (n < limit && buildingCost(def, count, n + 1) <= money) n++;
  return n;
}

// Refund for selling `n` units when `count` are owned: sellRefund (default 0.5) of the
// replacement cost of those units, priced with the cost multiplier clamped to <= 1. A
// discount upgrade bought later lowers the refund (the player gets 50% of the *current* price,
// like every idle game's sell button), but a cost multiplier above 1 can never turn sell into a
// money printer: the refund is at most sellRefund of the undiscounted price.
export function sellRefund(def, count = state.buildings[def.id] || 0, n = 1) {
  const g = def.costGrowth;
  const mult = Math.min(1, (derived.costMult || 1) * (derived.mods?.byBuilding?.[def.id]?.cost ?? 1));
  const start = count - n;
  const first = def.baseCost * Math.pow(g, start);
  const sum = g === 1 ? first * n : (first * (Math.pow(g, n) - 1)) / (g - 1);
  return sum * mult * (def.sellRefund ?? 0.5);
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
    const cap = buildingCap(def);
    const maxed = count >= cap;
    out.push({
      ...def,
      count,
      cost,
      // A capped-out building is never affordable: the Buy button greys out like an owned
      // upgrade. `maxCount` rides along from the def so the UI can print "12/12 built".
      affordable: !maxed && state.res.money >= cost,
      maxed,
      unlocked: isBuildingUnlocked(def),
      // The unlock rule threw repeatedly and was disabled by safe.js: the building stays
      // locked forever unless it already latched. UI can badge it; tools can flag it.
      broken: !!def.unlock?.isDisabled?.(),
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
      // The effect or unlock rule threw repeatedly and was disabled by safe.js. An owned
      // upgrade with a dead effect is paid for but inert (it no longer folds into mods); one
      // with a dead unlock rule stays locked forever unless it already latched — same rule
      // as buildings(), so a silently-locked card is badged instead of looking merely far off.
      broken: !!(def.effect?.isDisabled?.() || def.unlock?.isDisabled?.()),
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
  if (n <= 0 || count + n > buildingCap(def)) return false;
  const cost = buildingCost(def, count, n);
  // Both sides must be finite: an Infinity cost (growth^count overflow) or an Infinity wallet
  // (possible between sanitize() passes) would otherwise pass `Infinity >= Infinity` and leave
  // NaN in state.res.money. `!(money >= cost)` also rejects a NaN wallet.
  if (!Number.isFinite(cost) || !Number.isFinite(state.res.money) || !(state.res.money >= cost)) return false;
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
  if (n === 'max') n = count;
  n = Math.min(Math.floor(Number(n)), count);
  if (!(n > 0)) return false; // `!(n > 0)` also rejects NaN ('abc', {}, NaN): never write NaN into state
  const refund = sellRefund(def, count, n);
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
  buildingCap,
  sellRefund,
  maxAffordable,
  action,
  canPrestige,
  prestigeGain,
  prestige,
  step,
};
