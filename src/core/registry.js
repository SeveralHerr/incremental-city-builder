// Registry: content modules register definitions here; core/simulation/ui read from it.
// Every callback is guarded (see safe.js).
import { guard, reportError } from './safe.js';

export const registry = {
  buildings: new Map(), // id -> def
  upgrades: new Map(), // id -> def
  tickHandlers: [], // { name, fn, priority }
  actions: new Map(), // name -> fn
  buildingOrder: [],
  upgradeOrder: [],
};

const REQUIRED_BUILDING = ['id', 'name', 'baseCost', 'costGrowth'];
const REQUIRED_UPGRADE = ['id', 'name', 'cost', 'effect'];

function validate(def, required, kind) {
  if (!def || typeof def !== 'object') throw new Error(`${kind}: def must be object`);
  for (const k of required) {
    if (def[k] === undefined || def[k] === null) throw new Error(`${kind} ${def.id ?? '?'}: missing ${k}`);
  }
  if (typeof def.id !== 'string' || !/^[a-z0-9_-]+$/i.test(def.id)) {
    throw new Error(`${kind}: bad id ${def.id}`);
  }
}

export function registerBuilding(def) {
  try {
    validate(def, REQUIRED_BUILDING, 'building');
    if (registry.buildings.has(def.id)) throw new Error(`building ${def.id} already registered`);
    const d = {
      icon: '🏢',
      desc: '',
      category: 'residential',
      tier: 1,
      housing: 0,
      jobs: 0,
      powerUse: 0,
      powerGen: 0,
      income: 0,
      upkeep: 0,
      happiness: 0,
      sellRefund: 0.5,
      ...def,
    };
    d.unlock = def.unlock ? guard(`building:${def.id}:unlock`, def.unlock) : null;
    registry.buildings.set(d.id, d);
    registry.buildingOrder.push(d.id);
    return d;
  } catch (e) {
    reportError('registry', e);
    return null;
  }
}

export function registerUpgrade(def) {
  try {
    validate(def, REQUIRED_UPGRADE, 'upgrade');
    if (registry.upgrades.has(def.id)) throw new Error(`upgrade ${def.id} already registered`);
    const d = { icon: '⚡', desc: '', category: 'general', tier: 1, ...def };
    d.effect = guard(`upgrade:${def.id}:effect`, def.effect);
    d.unlock = def.unlock ? guard(`upgrade:${def.id}:unlock`, def.unlock) : null;
    registry.upgrades.set(d.id, d);
    registry.upgradeOrder.push(d.id);
    return d;
  } catch (e) {
    reportError('registry', e);
    return null;
  }
}

export function registerTickHandler(name, fn, priority = 100) {
  if (typeof fn !== 'function') {
    reportError('registry', new Error(`tick handler ${name} not a function`));
    return;
  }
  registry.tickHandlers = registry.tickHandlers.filter((h) => h.name !== name);
  registry.tickHandlers.push({ name, fn: guard(`tick:${name}`, fn), priority });
  registry.tickHandlers.sort((a, b) => a.priority - b.priority);
}

export function registerAction(name, fn) {
  if (typeof fn !== 'function') {
    reportError('registry', new Error(`action ${name} not a function`));
    return;
  }
  registry.actions.set(name, guard(`action:${name}`, fn));
}

export function getBuilding(id) {
  return registry.buildings.get(id) || null;
}
export function getUpgrade(id) {
  return registry.upgrades.get(id) || null;
}
