// buildings module — registers the 22 Metropolis structures with core.
// DOM-free (runs in Node for the economy sim). Never throws from init.
// Files: data.js (catalogue), README.md (the rationale behind the ladder, the signature
// mechanics and the unlock spacing), catalogue.mjs (prints the *shipped* catalogue,
// `node src/buildings/catalogue.mjs`), cadence.mjs (first-city unlock/first-buy probe,
// `node src/buildings/cadence.mjs`), buildings.test.mjs (`node src/buildings/buildings.test.mjs`).
//
// Balance integration: `src/balance/config.js` owns every tuning number. It is loaded
// via a guarded dynamic import inside init() rather than a static import so that a
// missing or broken config file degrades to the DESIGN.md defaults instead of taking
// the whole buildings module down with it. Overrides in `config.buildings[id]` are
// spread over each definition before `registerBuilding`. Since the 2026-09-07 polish pass
// data.js carries the shipped numbers, so the fallback ladder is the one the sim was run on.
//
// Hard caps. A def may carry `maxCount` (windmill: 8). Core owns the cap — `api.buy` and
// `maxAffordable` refuse past it and `api.buildings()` rows carry `maxed` — and this module
// only validates the field (a non-integer override is dropped rather than handed to the
// registry, which throws). As a belt to core's braces, a `buy` listener rolls back any
// purchase that still lands above the cap (an older core without the check): the units
// above the cap are removed and their exact share of the price refunded, so a Buy Max on
// the Power tab can never pay $1e16 for 4 MW.
//
// Power hints. After registration every consumer whose draw is at least one windmill gets a
// derived `powerHint` string — "Draws 10,500 MW ≈ 0.9 × Nuclear Plant" — sized against the
// largest generator whose output is no more than twice the draw, so a tier-4 card says up
// front which plant it needs (the shipped tier-4 stickers are 12–42× the tier-3 intensity of
// their column; README "Power"). UI renders it under the synergy line.
//
// Live stats. Two data-driven rules scale a per-unit stat with the city (see data.js):
//   synergy       { stat, source, per, cap, text }  stat = base × min(cap, 1 + source / per)
//   demandGrowth  { per, cap, text }                powerUse = base × min(cap, 1 + (count − 1) / per)
// The `buildings:live` tick handler runs at priority −10, before the simulation's fold,
// and evaluates every rule once per tick into the `live` store. The base is the value
// resolved at registration (data + config override), pinned in `bases` the first time a
// rule is collected, so a repeated init or a second call in one tick never compounds a
// factor. The contract is the accessor pair this module owns: `liveStat(id, stat)` /
// `liveStats(id)` is the per-unit value the simulation is using right now, `baseStat`
// the value that never moves (sell-refund maths, a tooltip that shows the sticker, a
// test pinning a base). Both are exported and attached to `game.buildings`.
//
// Compatibility seam: resources.computeDerived, the bot's scoring and the build card read
// `registry.buildings.get(id)[stat]` directly. Rather than writing a second copy of the
// value into the definition every tick, the scaled field of a registered definition is
// turned into an accessor property when its rule is collected: reading it returns
// `liveStat`, so those consumers see exactly what the simulation uses and the def can
// never drift from the store; assigning to it re-pins the base (what a tool tweaking a
// def live expects) instead of being silently overwritten on the next tick. Anything new
// should read the accessor functions, not the field.
//
// One-tick lag, by design: the handler reads `derived` as the previous tick left it (the
// simulation recomputes it after us), so a rule sourced from `employed` is one tick behind
// pop/jobs. On the very first tick after a load `derived.employed` is not set yet; the
// source then falls back to min(pop, jobs) from the same bag (or 0), so the financial
// district never flashes its base income for a frame after a reload.
import { registerBuilding, registerTickHandler, registry } from '../core/registry.js';
import { reportError } from '../core/safe.js';
import { on } from '../core/events.js';
import { state as coreState, addLog } from '../core/state.js';
import { BUILDINGS, CATEGORIES } from './data.js';

export { BUILDINGS, CATEGORIES };

// The shipped ladder (config.cost.tierGrowth, which wins when present; the test holds the
// two equal so a config import failure ships the curve the sim was run on, not a stale
// sketch). Tier-5 cards pin their own costGrowth: neither this table nor config has a
// tier 5, and balance's costGrowthFor(5) would answer with the tier-1 rate.
export const DEFAULT_TIER_GROWTH = Object.freeze({ 1: 1.18, 2: 1.16, 3: 1.13, 4: 1.112 });
const NUMERIC_FIELDS = ['baseCost', 'costGrowth', 'housing', 'jobs', 'powerUse', 'powerGen', 'income', 'upkeep', 'happiness', 'sellRefund', 'tier'];
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
// Stats a synergy may scale. Cost is deliberately excluded (cost mods belong to the mods
// bag) and so is powerUse (that is demandGrowth's stat; one rule per stat keeps the live
// value a single product).
const SYNERGY_STATS = new Set(['income', 'housing', 'jobs', 'powerGen', 'happiness']);
const GROWTH_STAT = 'powerUse';
export const LIVE_HANDLER = 'buildings:live';
const LIVE_PRIORITY = -10; // before simulation's 'simulate' (0)

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
    if (k === 'maxCount') {
      // null lifts the cap; anything else must be a positive integer (the registry throws
      // on any other shape, which would take the whole building down).
      if (v === null) out.maxCount = undefined;
      else if (Number.isInteger(v) && v >= 1) out.maxCount = v;
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
    if (k === 'demandGrowth') {
      if (v === null || normalizeGrowth(v)) out.demandGrowth = v;
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
  if (def.maxCount !== undefined && !(Number.isInteger(def.maxCount) && def.maxCount >= 1)) def.maxCount = undefined;
  return def;
}

// The cap a definition carries, or Infinity when it has none. Pure.
export function capOf(def) {
  const m = def?.maxCount;
  return Number.isInteger(m) && m >= 1 ? m : Infinity;
}

// Roll back the part of a purchase that landed above `maxCount` (see the header, "Hard
// caps"). `e` is the core `buy` event { id, n, cost, count }. Units the player already owned
// above the cap (an old save) are left alone: only this purchase's excess is undone, and
// the refund is that excess's exact share of the price paid (the cost multiplier cancels
// out of the ratio, so no mods need re-deriving). Returns the refund, 0 when nothing to do.
export function rollbackOverCap(e, def = registry.buildings.get(e?.id), state = coreState) {
  if (!def || !e || typeof e !== 'object') return 0;
  const cap = capOf(def);
  if (cap === Infinity) return 0;
  const count = state?.buildings?.[e.id];
  if (!isFiniteNum(count) || count <= cap) return 0;
  // Without a usable unit count nothing can be attributed to this purchase: never
  // confiscate units on a guess.
  if (!(isFiniteNum(e.n) && e.n > 0)) return 0;
  const n = Math.min(Math.floor(e.n), count);
  const start = count - n;
  const keep = Math.max(cap, start);
  const excess = count - keep;
  if (excess <= 0) return 0;
  const g = isFiniteNum(def.costGrowth) && def.costGrowth >= 1 ? def.costGrowth : 1;
  const share = g === 1 ? excess / n : (Math.pow(g, count) - Math.pow(g, keep)) / (Math.pow(g, count) - Math.pow(g, start));
  const paid = isFiniteNum(e.cost) && e.cost > 0 ? e.cost : 0;
  const refund = isFiniteNum(share) ? paid * Math.min(1, Math.max(0, share)) : 0;
  state.buildings[e.id] = keep;
  if (state.res && isFiniteNum(state.res.money)) state.res.money += refund;
  if (state.stats && isFiniteNum(state.stats.buildingsBuilt)) state.stats.buildingsBuilt = Math.max(0, state.stats.buildingsBuilt - excess);
  addLog(`${def.name}: ${cap}/${cap} built — ${excess} refunded`, 'info');
  return refund;
}

// ---- power hints -----------------------------------------------------------------------

const fmtMW = (v) => (v >= 10 ? Math.round(v) : +v.toFixed(1)).toLocaleString('en-US');

// Card text sizing a consumer's base draw against the generator ladder: the largest
// generator whose output is no more than twice the draw (so the count reads ≥ 0.5), or
// nothing for a draw under the smallest generator. `gens` is [{ name, powerGen }]. Pure.
export function powerHintFor(def, gens) {
  const use = def?.powerUse;
  if (!isFiniteNum(use) || use <= 0 || !Array.isArray(gens)) return '';
  const ladder = gens.filter((g) => g && typeof g.name === 'string' && isFiniteNum(g.powerGen) && g.powerGen > 0).sort((a, b) => a.powerGen - b.powerGen);
  if (!ladder.length || use < ladder[0].powerGen) return '';
  let pick = ladder[0];
  for (const g of ladder) if (g.powerGen <= use * 2) pick = g;
  const n = use / pick.powerGen;
  const count = n >= 10 ? Math.round(n) : +n.toFixed(1);
  return `Draws ${fmtMW(use)} MW ≈ ${count.toLocaleString('en-US')} × ${pick.name}`;
}

// Stamp `powerHint` on every registered consumer from the registered generators' base
// output (a synergy such as the solar farm's park bonus is not counted: the hint is the
// sticker, like the rest of the card).
function stampPowerHints() {
  const gens = [];
  for (const id of registry.buildingOrder) {
    const d = registry.buildings.get(id);
    const gen = baseStat(id, 'powerGen');
    if (d && isFiniteNum(gen) && gen > 0) gens.push({ name: d.name, powerGen: gen });
  }
  for (const id of registry.buildingOrder) {
    const d = registry.buildings.get(id);
    if (!d) continue;
    const hint = powerHintFor({ powerUse: baseStat(id, 'powerUse') }, gens);
    try {
      if (hint) d.powerHint = hint;
    } catch {
      /* frozen def: the hint is cosmetic */
    }
  }
}

// ---- rules ---------------------------------------------------------------------------

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

// Validated copy of a demandGrowth rule, or null. Pure.
export function normalizeGrowth(g) {
  if (!isObj(g)) return null;
  if (!(isFiniteNum(g.per) && g.per > 0)) return null;
  if (!(isFiniteNum(g.cap) && g.cap >= 1)) return null;
  return { per: g.per, cap: g.cap, text: typeof g.text === 'string' ? g.text : '' };
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

// Multiplier for a synergy rule: min(cap, 1 + source / per), never below 1. Pure.
export function synergyFactor(rule, state, derived) {
  const s = normalizeSynergy(rule);
  if (!s) return 1;
  const f = 1 + synergySource(s.source, state, derived) / s.per;
  return f > s.cap ? s.cap : f >= 1 ? f : 1;
}

// Multiplier for a demandGrowth rule at `count` owned units: min(cap, 1 + (count − 1) / per).
// The first unit draws its sticker; every further unit adds 1/per to *every* unit's draw,
// so total draw grows quadratically until the cap. Never below 1. Pure.
export function growthFactor(rule, count) {
  const g = normalizeGrowth(rule);
  if (!g) return 1;
  const n = isFiniteNum(count) && count > 1 ? count - 1 : 0;
  const f = 1 + n / g.per;
  return f > g.cap ? g.cap : f;
}

// Active rules: { id, stat, base, kind, rule } for every registered building with a valid
// synergy or demandGrowth.
const rules = [];
// Base value per id:stat, pinned the first time a rule is collected so a repeated init (or a
// collect after a tick has already scaled the def) never compounds the factor.
const bases = new Map();
// Live value per id: { [stat]: value }. The accessor's backing store.
const live = new Map();

// Undefined when the building has no such stat: the registry defaults every stat to 0, so
// a 0 base counts as missing too (0 × any factor is 0 — the rule would be dead weight and
// its card text a lie), and collectRules reports it.
function pin(id, stat, def) {
  const key = id + ':' + stat;
  const base = bases.has(key) ? bases.get(key) : def[stat];
  if (!isFiniteNum(base) || base === 0) return undefined;
  bases.set(key, base);
  expose(id, stat, def);
  return base;
}

// Turn `def[stat]` into a view of the live store (see the header's "Compatibility seam").
// Idempotent: a field that is already an accessor is left alone. A definition that is
// frozen or otherwise refuses the property keeps its plain field and the handler falls
// back to writing the value into it, so a locked-down registry still sees live numbers.
const plainMirror = new Set(); // id:stat pairs where the accessor could not be installed
function expose(id, stat, def) {
  const key = id + ':' + stat;
  const desc = Object.getOwnPropertyDescriptor(def, stat);
  if (desc && typeof desc.get === 'function') return;
  try {
    Object.defineProperty(def, stat, {
      enumerable: true,
      configurable: true,
      get: () => liveStat(id, stat),
      set: (v) => {
        if (!isFiniteNum(v)) return;
        bases.set(key, v);
        for (const r of rules) if (r.id === id && r.stat === stat) r.base = v;
        const slot = live.get(id);
        if (slot) delete slot[stat]; // reads return the new base until the next tick
      },
    });
    plainMirror.delete(key);
  } catch {
    plainMirror.add(key);
  }
}

function collectRules() {
  rules.length = 0;
  for (const id of registry.buildingOrder) {
    const def = registry.buildings.get(id);
    if (!def) continue;
    if (def.synergy !== undefined && def.synergy !== null) {
      const rule = normalizeSynergy(def.synergy);
      if (!rule) reportError('buildings:' + id, new Error('malformed synergy rule ignored'));
      else {
        const base = pin(id, rule.stat, def);
        if (base !== undefined) rules.push({ id, stat: rule.stat, base, kind: 'synergy', rule });
        else reportError('buildings:' + id, new Error(`synergy on missing stat ${rule.stat} ignored`));
      }
    }
    if (def.demandGrowth !== undefined && def.demandGrowth !== null) {
      const rule = normalizeGrowth(def.demandGrowth);
      if (!rule) reportError('buildings:' + id, new Error('malformed demandGrowth rule ignored'));
      else {
        const base = pin(id, GROWTH_STAT, def);
        if (base !== undefined) rules.push({ id, stat: GROWTH_STAT, base, kind: 'growth', rule });
        else reportError('buildings:' + id, new Error(`demandGrowth on missing stat ${GROWTH_STAT} ignored`));
      }
    }
  }
}

function ruleFactor(r, state, derived) {
  if (r.kind === 'growth') {
    const count = state?.buildings?.[r.id];
    return growthFactor(r.rule, isFiniteNum(count) ? count : 0);
  }
  return synergyFactor(r.rule, state, derived);
}

// Evaluate every rule into the live store. The registered definition's field is an
// accessor over that store (see the header), so nothing is written to the def here.
// Idempotent: the value is always base × factor, so repeated calls never compound.
export function applyLiveStats(state, derived) {
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (!registry.buildings.has(r.id)) continue;
    const v = r.base * ruleFactor(r, state, derived);
    let slot = live.get(r.id);
    if (!slot) live.set(r.id, (slot = {}));
    slot[r.stat] = v;
    if (plainMirror.has(r.id + ':' + r.stat)) {
      try {
        registry.buildings.get(r.id)[r.stat] = v;
      } catch {
        /* frozen def: the accessor functions still carry the value */
      }
    }
  }
}

// The value a rule pinned for `stat` at registration (data + config), or the definition's
// field when nothing scales it. Undefined for an unknown building.
export function baseStat(id, stat) {
  const key = id + ':' + stat;
  if (bases.has(key)) return bases.get(key);
  const def = registry.buildings.get(id);
  return def ? def[stat] : undefined;
}

// The per-unit value the simulation is using right now: the last evaluated rule value,
// the pinned base before the first tick has evaluated a rule, or the definition's field
// when nothing scales it. Undefined for an unknown building. (The pinned-base step is
// what keeps the def's accessor from reading itself.)
export function liveStat(id, stat) {
  const slot = live.get(id);
  if (slot && stat in slot) return slot[stat];
  const key = id + ':' + stat;
  if (bases.has(key)) return bases.get(key);
  const def = registry.buildings.get(id);
  return def ? def[stat] : undefined;
}

// Every scaled stat of a building as { stat: value } (a fresh object), or {} when none.
export function liveStats(id) {
  return { ...(live.get(id) || {}) };
}

// Registered rules (read-only view for tools and tests).
export function activeRules() {
  return rules.map((r) => ({ id: r.id, stat: r.stat, base: r.base, kind: r.kind, ...r.rule }));
}
export function activeSynergies() {
  return activeRules().filter((r) => r.kind === 'synergy');
}
export function activeGrowth() {
  return activeRules().filter((r) => r.kind === 'growth');
}

// ---- init ---------------------------------------------------------------------------

function enforceCap(e) {
  rollbackOverCap(e);
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
    collectRules();
    if (rules.length) registerTickHandler(LIVE_HANDLER, applyLiveStats, LIVE_PRIORITY);
    stampPowerHints();
    on('buy', enforceCap); // the bus keys listeners by function, so a repeated init adds nothing
    if (game && typeof game === 'object') {
      const count = BUILDINGS.filter((b) => registry.buildings.has(b.id)).length;
      game.buildings = { count, categories: CATEGORIES, synergies: activeSynergies(), growth: activeGrowth(), rules: activeRules(), liveStat, baseStat, liveStats, capOf, powerHintFor };
    }
  } catch (e) {
    reportError('buildings:init', e);
  }
}
