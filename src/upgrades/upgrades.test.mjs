// Unit tests for the upgrades module. Run: node --test src/upgrades/
// Pins the data invariants (unique ids, desc length, hints everywhere, effects touch only the
// mods bag), the pure horizon-ladder rules (horizonCost, bondOpensAt, roman), the config
// override rules, the founding-memory rule, the grantUpgrade seam and the registered-cost
// view (sortedUpgrades).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMods, sanitizeMods } from '../core/mods.js';
import { registry } from '../core/registry.js';
import { on, emit } from '../core/events.js';
import { config } from '../balance/config.js';
import {
  UPGRADES,
  UPGRADE_CATEGORIES,
  MILESTONE_IDS,
  BOND_RUNGS,
  BOND_FLOOR,
  BOND_SECONDS,
  BOND_OPEN_2,
  BOND_GAP,
  BOND_GAP_RAMP,
  SKYLINE_EVERY,
  bondOpensAt,
  horizonCost,
  roman,
  keptUpgradeIds,
} from './data.js';
import { applyOverride, sortedUpgrades, init } from './index.js';

const CATEGORY_IDS = new Set(UPGRADE_CATEGORIES.map((c) => c.id));
const byId = (id) => UPGRADES.find((d) => d.id === id);

// Median late-cycle length (cycles after the 5th founding) of the greedy bot in the 12-hour
// run against the committed simulation module, logs/sim-fix-upgrades-12h-headsim.json:
// 11.8 min, steady from city 27 to city 69. The whole bond ladder has to open inside it, or
// the top rungs are never issued (the 3-min / 9%-per-rung schedule shipped before this pass
// opened rung XVII at 656 s against a 10.8-min cycle and never issued XVII–XXX).
const LATE_CYCLE_MEDIAN_S = 710;
// Longest wait a late city should ever face for its next bond once the ladder is running.
const MAX_BOND_GAP_S = 90;

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

// A rich, deep-frozen state: every effect and unlock must run without writing to it.
const FROZEN_STATE = deepFreeze({
  tick: 1200,
  time: 120,
  res: { money: 1e6, pop: 5000 },
  buildings: { house: 10, shop: 20, factory: 25, park: 5, windmill: 6, coal: 3, office: 5 },
  upgrades: { 'welcome-sign': true, 'civic-bonds-1': true, 'planetary-charter': true },
  unlocks: { 'm:pop-1k': true },
  stats: { totalEarned: 2e9, peakPop: 5000, buildingsBuilt: 80, prestiges: 3, playtime: 1000, clicks: 3 },
  prestige: { legacy: 12, spent: 0, lifetimeEarned: 1e10 },
  settings: {},
  log: [],
});
const FROZEN_DERIVED = deepFreeze({ income: 1234.5, powerCap: 100, powerDemand: 120, powerRatio: 0.83, upkeep: 5 });

test('definitions: unique ids, categories, tiers, short descs, hints everywhere', () => {
  const ids = new Set();
  for (const d of UPGRADES) {
    assert.ok(!ids.has(d.id), `duplicate id ${d.id}`);
    ids.add(d.id);
    assert.ok(/^[a-z0-9-]+$/.test(d.id), `${d.id}: id charset`);
    assert.ok(typeof d.name === 'string' && d.name.trim(), `${d.id}: name`);
    assert.ok(typeof d.icon === 'string' && d.icon, `${d.id}: icon`);
    assert.ok(typeof d.desc === 'string' && d.desc.length > 0 && d.desc.length <= 70, `${d.id}: desc length ${d.desc.length}`);
    assert.ok(Number.isFinite(d.cost) && d.cost > 0, `${d.id}: cost`);
    assert.ok(CATEGORY_IDS.has(d.category), `${d.id}: category ${d.category}`);
    assert.ok(Number.isInteger(d.tier) && d.tier >= 1 && d.tier <= 4, `${d.id}: tier`);
    assert.equal(typeof d.unlock, 'function', `${d.id}: unlock`);
    assert.equal(typeof d.effect, 'function', `${d.id}: effect`);
    assert.ok(typeof d.unlockHint === 'string' && d.unlockHint.length > 3 && d.unlockHint.length <= 90, `${d.id}: unlockHint "${d.unlockHint}"`);
    if (d.unlockAt !== undefined) {
      assert.ok(d.unlockAt && typeof d.unlockAt === 'object', `${d.id}: unlockAt shape`);
      assert.ok(Object.keys(d.unlockAt).length > 0, `${d.id}: unlockAt empty`);
    }
  }
  assert.ok(UPGRADES.length >= 80, `ladder has ${UPGRADES.length} rungs`);
  assert.equal(MILESTONE_IDS.length, new Set(MILESTONE_IDS).size);
});

test('hints read as the rule they mirror', () => {
  assert.equal(byId('neon-signage').unlockHint, 'Build 3 corner shops');
  assert.deepEqual(byId('neon-signage').unlockAt, { building: 'shop', count: 3 });
  assert.equal(byId('farmers-market').unlockHint, 'Build 15 corner shops');
  assert.equal(byId('container-port').unlockHint, 'Build 20 factories');
  assert.equal(byId('community-events').unlockHint, 'Build a City Park');
  assert.equal(byId('franchising').unlockHint, 'Reach 100 citizens or build an Office Block');
  assert.deepEqual(byId('tourism-board').unlockAt, { pop: 2000 });
  assert.equal(byId('civic-bonds-1').unlockHint, 'Own Planetary Charter or earn $1B in this city');
  assert.equal(byId('civic-bonds-2').unlockHint, 'Own Civic Bonds I and wait until 45 s after founding');
  assert.equal(byId('civic-bonds-12').unlockHint, 'Own Civic Bonds XI and wait until 3 min after founding');
  assert.equal(byId('legacy-archive').unlockHint, 'Found a new city');
  assert.deepEqual(byId('institutional-memory').unlockAt, { legacy: 10 });
  assert.match(byId('smart-grid').unlockHint, /brownout/i);
  // `all` mirrors the measurable gate (the issue timer), never the ownership flag, so a
  // progress bar counts the real blocker down instead of sitting at 100% on a locked card.
  for (let n = 2; n <= BOND_RUNGS; n++) assert.deepEqual(byId(`civic-bonds-${n}`).unlockAt, { runAge: bondOpensAt(n) }, `bond ${n} mirror`);
  assert.deepEqual(byId('standing-orders').unlockAt, { legacy: 50 });
  assert.deepEqual(byId('skyline-expansion-1').unlockAt, { upgrade: `civic-bonds-${SKYLINE_EVERY}` });
});

test('happiness: flat city-wide adds only, descs quote the exact add in percent', () => {
  assert.equal(byId('community-events').desc, 'Happiness +10%');
  assert.equal(byId('green-belts').desc, 'Happiness +5% and population grows +25% faster');
  assert.equal(byId('modern-curriculum').desc, 'Happiness +10% and all jobs +25%');
  assert.equal(byId('preventive-care').desc, 'Happiness +10% and population grows +50% faster');
  assert.equal(byId('championship-season').desc, 'Stadiums earn ×2 income and provide ×2 jobs');
  assert.equal(byId('veteran-planners').desc, 'Population grows +100% faster and happiness +10%');
  let flatTotal = 0;
  for (const d of UPGRADES) {
    assert.ok(!/\+0\.\d+/.test(d.desc), `${d.id}: raw decimal in desc "${d.desc}"`);
    assert.ok(!/happiness each/i.test(d.desc), `${d.id}: per-building happiness promise "${d.desc}"`);
    const mods = createMods();
    d.effect(mods, FROZEN_STATE);
    // Per-building happiness feeds the saturating civic curve, where the desc's number is
    // never what the city gets: no rung may use it.
    for (const [id, m] of Object.entries(mods.byBuilding)) assert.equal(m.happiness, 0, `${d.id}: byBuilding.${id}.happiness`);
    const said = /happiness \+(\d+)%/i.exec(d.desc);
    if (said) assert.ok(Math.abs(mods.happiness - Number(said[1]) / 100) < 1e-9, `${d.id}: desc says +${said[1]}%, effect adds ${mods.happiness}`);
    else assert.equal(mods.happiness, 0, `${d.id}: silent happiness add`);
    flatTotal += mods.happiness;
  }
  // Late cities sit at 2.5–2.7 happiness against the 3.0 cap with every rung owned; the
  // whole ladder's flat adds stay inside that headroom (0.45 = the 0.2 shipped before plus
  // 0.25 for the three civic rungs; +0.25 measured ~6% of late samples at the cap).
  assert.ok(Math.abs(flatTotal - 0.45) < 1e-9, `ladder adds ${flatTotal} happiness in total`);
});

test('every effect leaves a deep-frozen state untouched and only writes the mods bag', () => {
  for (const d of UPGRADES) {
    const mods = createMods();
    assert.doesNotThrow(() => d.effect(mods, FROZEN_STATE), `${d.id}: effect threw on frozen state`);
    sanitizeMods(mods);
    for (const k of ['income', 'housing', 'jobs', 'power', 'demand', 'growth', 'inflow', 'cost', 'upkeep']) {
      assert.ok(Number.isFinite(mods[k]) && mods[k] > 0, `${d.id}: mods.${k} = ${mods[k]}`);
    }
    assert.ok(Number.isFinite(mods.happiness), `${d.id}: mods.happiness`);
    // Effects tolerate a missing state entirely.
    assert.doesNotThrow(() => d.effect(createMods(), undefined), `${d.id}: effect threw on undefined state`);
  }
});

test('every unlock tolerates {} / undefined / frozen inputs and returns a boolean', () => {
  for (const d of UPGRADES) {
    for (const [s, dv] of [
      [undefined, undefined],
      [{}, {}],
      [{ res: {}, buildings: {}, upgrades: {}, stats: {}, prestige: {}, unlocks: {} }, {}],
      [FROZEN_STATE, FROZEN_DERIVED],
    ]) {
      let r;
      assert.doesNotThrow(() => (r = d.unlock(s, dv)), `${d.id}: unlock threw`);
      assert.equal(typeof r, 'boolean', `${d.id}: unlock returned ${r}`);
    }
  }
  // A few rules against the frozen city: 20 shops, 25 factories, legacy 12, bond I owned at 120 s.
  assert.equal(byId('farmers-market').unlock(FROZEN_STATE), true);
  assert.equal(byId('container-port').unlock(FROZEN_STATE), true);
  assert.equal(byId('institutional-memory').unlock(FROZEN_STATE), true);
  assert.equal(byId('standing-orders').unlock(FROZEN_STATE), false);
  assert.equal(byId('smart-grid').unlock(FROZEN_STATE, FROZEN_DERIVED), true);
  assert.equal(byId('civic-bonds-2').unlock({ ...FROZEN_STATE, time: 30 }), false, 'bond II waits for 45 s');
  assert.equal(byId('civic-bonds-2').unlock({ ...FROZEN_STATE, time: 45 }), true);
  assert.equal(byId('civic-bonds-2').unlock(FROZEN_STATE), true);
  assert.equal(byId('civic-bonds-3').unlock({ ...FROZEN_STATE, time: 1e6 }), false, 'bond III needs bond II');
  assert.equal(byId('civic-bonds-3').unlock({ ...FROZEN_STATE, time: 1e6, upgrades: { 'civic-bonds-2': true } }), true);
});

test('roman numerals', () => {
  assert.equal(roman(1), 'I');
  assert.equal(roman(4), 'IV');
  assert.equal(roman(9), 'IX');
  assert.equal(roman(14), 'XIV');
  assert.equal(roman(19), 'XIX');
  assert.equal(roman(30), 'XXX');
  assert.equal(roman(0), 'I', 'floors at I');
  assert.equal(roman(1994), 'MCMXCIV');
});

test('bondOpensAt: I immediate, II at 45 s, gaps widen 0.8 s per rung, whole ladder inside a late cycle', () => {
  assert.equal(bondOpensAt(1), 0);
  assert.equal(bondOpensAt(0), 0);
  assert.equal(bondOpensAt(undefined), 0);
  assert.equal(bondOpensAt(2), BOND_OPEN_2);
  assert.equal(bondOpensAt(2), 45);
  assert.equal(bondOpensAt(3), BOND_OPEN_2 + BOND_GAP);
  let prevGap = 0;
  for (let n = 3; n <= BOND_RUNGS; n++) {
    const gap = bondOpensAt(n) - bondOpensAt(n - 1);
    assert.ok(gap >= BOND_GAP, `rung ${n} follows ${n - 1} after ${gap} s`);
    // Gaps are rounded to whole seconds, so the ramp shows up as +0…+2 s per rung.
    if (n > 3) assert.ok(gap >= prevGap && gap - prevGap <= Math.ceil(BOND_GAP_RAMP) + 1, `rung ${n}: gap ${gap} after ${prevGap} (ramp ${BOND_GAP_RAMP})`);
    assert.ok(gap <= MAX_BOND_GAP_S, `rung ${n}: ${gap} s wait`);
    prevGap = gap;
  }
  // Rounded milestones a mayor can read off the cards.
  assert.equal(bondOpensAt(10), 147);
  assert.equal(bondOpensAt(20), 347);
  assert.equal(bondOpensAt(30), 627);
  assert.ok(bondOpensAt(BOND_RUNGS) <= LATE_CYCLE_MEDIAN_S, `rung ${BOND_RUNGS} opens at ${bondOpensAt(BOND_RUNGS)} s, late cycles run ${LATE_CYCLE_MEDIAN_S} s`);
  assert.equal(UPGRADES.filter((d) => d.id.startsWith('civic-bonds-')).length, BOND_RUNGS);
  const skylines = UPGRADES.filter((d) => d.id.startsWith('skyline-expansion-'));
  assert.equal(skylines.length, 5);
  for (let n = 1; n <= 5; n++) {
    const s = byId(`skyline-expansion-${n}`);
    assert.equal(s.unlock({ upgrades: { [`civic-bonds-${SKYLINE_EVERY * n}`]: true } }), true, `skyline ${n} follows bond ${SKYLINE_EVERY * n}`);
    assert.equal(s.unlock({ upgrades: { [`civic-bonds-${SKYLINE_EVERY * n - 1}`]: true } }), false);
  }
  // The card text quotes the same schedule the rule enforces.
  for (let n = 2; n <= BOND_RUNGS; n++) {
    const sec = bondOpensAt(n);
    const label = sec >= 120 ? `${Math.round(sec / 60)} min` : `${sec} s`;
    assert.ok(byId(`civic-bonds-${n}`).desc.endsWith(`opens ${label} after founding`), `bond ${n} desc: ${byId(`civic-bonds-${n}`).desc}`);
  }
});

test('horizonCost: seconds of income, floored, sane on negative/NaN/missing income', () => {
  const bond = byId('civic-bonds-3');
  assert.equal(BOND_SECONDS, 2);
  assert.equal(horizonCost(bond, { income: 1e9 }), 2e9);
  assert.equal(horizonCost(bond, { income: 1 }), BOND_FLOOR, 'floor wins when income is tiny');
  assert.equal(horizonCost(bond, { income: -5 }), BOND_FLOOR);
  assert.equal(horizonCost(bond, { income: NaN }), BOND_FLOOR);
  assert.equal(horizonCost(bond, { income: Infinity }), BOND_FLOOR);
  assert.equal(horizonCost(bond, undefined), BOND_FLOOR);
  assert.equal(horizonCost(bond, {}), BOND_FLOOR);
  assert.equal(BOND_FLOOR, 1e7);
  // Non-priced rungs report their own cost; garbage reports NaN.
  assert.equal(horizonCost(byId('welcome-sign'), { income: 1e9 }), 25);
  assert.ok(Number.isNaN(horizonCost(undefined, { income: 1 })));
  for (const d of UPGRADES) {
    if (!d.priced) continue;
    assert.equal(d.priced.seconds, BOND_SECONDS, `${d.id}: seconds`);
    assert.equal(d.priced.floor, BOND_FLOOR, `${d.id}: floor`);
    assert.equal(d.cost, BOND_FLOOR, `${d.id}: default cost is the floor`);
  }
});

test('applyOverride: bare number, object, junk', () => {
  const def = byId('welcome-sign');
  assert.equal(applyOverride(def, undefined), def, 'no override returns the same def');
  assert.equal(applyOverride(def, null), def);
  assert.equal(applyOverride(def, 99).cost, 99);
  assert.equal(applyOverride(def, { cost: 77 }).cost, 77);
  assert.equal(applyOverride(def, { cost: 77 }).unlockHint, def.unlockHint, 'hint survives the override');
  const o = applyOverride(def, { cost: 10, tier: 3, category: 'civic' });
  assert.equal(o.tier, 3);
  assert.equal(o.category, 'civic');
  assert.equal(applyOverride(def, { cost: -1, tier: 0, category: 'nope' }).cost, def.cost, 'bad values ignored');
  assert.equal(applyOverride(def, { category: 'nope' }).category, def.category);
  assert.equal(applyOverride(def, NaN).cost, def.cost);
  assert.equal(def.cost, 25, 'override never mutates the source def');
});

test('config overrides resolve to the documented costs', () => {
  const overrides = config.upgrades || {};
  const resolved = (id) => applyOverride(byId(id), overrides[id]).cost;
  assert.equal(resolved('zoning-reform'), 50);
  assert.equal(resolved('grant-writing'), 150);
  assert.equal(resolved('high-density'), 6000);
  assert.equal(resolved('prefab-construction'), 120000);
  assert.equal(resolved('ai-governance'), 1e11);
  assert.equal(resolved('planetary-charter'), 3e12);
  assert.equal(resolved('dynasty-ledger'), 150000);
  for (const id of Object.keys(overrides)) assert.ok(byId(id), `config overrides unknown upgrade ${id}`);
});

test('meaningfulness: every rung moves a multiplier by ≥25% (cost/demand/upkeep −20%) or adds ≥0.1 happiness', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const UP = ['income', 'housing', 'jobs', 'power', 'growth', 'inflow'];
  const DOWN = ['cost', 'demand', 'upkeep'];
  const B_UP = ['income', 'housing', 'jobs', 'power'];
  // What each rung does to a fresh bag, folded in the frozen 12-legacy city.
  const strongestUp = (mods) => {
    let best = 0;
    for (const k of UP) best = Math.max(best, mods[k] - 1);
    for (const m of Object.values(mods.byBuilding)) for (const k of B_UP) best = Math.max(best, m[k] - 1);
    return best;
  };
  const strongestDown = (mods) => Math.max(...DOWN.map((k) => 1 - mods[k]));
  for (const d of UPGRADES) {
    if (typeof d.keeps === 'function') continue; // structural rungs: their whole effect is the memory
    const mods = createMods();
    d.effect(mods, FROZEN_STATE);
    const up = strongestUp(mods);
    const down = strongestDown(mods);
    const ok = up >= 0.25 - 1e-9 || down >= 0.2 - 1e-9 || mods.happiness >= 0.1 - 1e-9;
    assert.ok(ok, `${d.id}: strongest +${(up * 100).toFixed(0)}% / −${(down * 100).toFixed(0)}%, happiness +${mods.happiness} — a dud`);
  }
  // A few exact pins.
  const mods = createMods();
  byId('grant-writing').effect(mods, {});
  assert.ok(near(mods.income, 1.25));
  const m2 = createMods();
  byId('bulk-permits').effect(m2, {});
  assert.ok(near(m2.cost, 0.8));
  const m3 = createMods();
  byId('founders-blueprints').effect(m3, {});
  assert.ok(near(m3.cost, 0.8));
  const m4 = createMods();
  byId('smart-grid').effect(m4, {});
  assert.ok(near(m4.demand, 0.8));
  const m5 = createMods();
  byId('superconductor-grid').effect(m5, {});
  assert.ok(near(m5.demand, 0.7));
  const m6 = createMods();
  byId('modern-curriculum').effect(m6, {});
  assert.ok(near(m6.jobs, 1.25) && near(m6.happiness, 0.1));
  const m7 = createMods();
  byId('green-belts').effect(m7, {});
  assert.ok(near(m7.growth, 1.25) && near(m7.happiness, 0.05));
  const m8 = createMods();
  byId('preventive-care').effect(m8, {});
  assert.ok(near(m8.growth, 1.5) && near(m8.happiness, 0.1));
  const m9 = createMods();
  byId('championship-season').effect(m9, {});
  assert.ok(near(m9.byBuilding.stadium.income, 2) && near(m9.byBuilding.stadium.jobs, 2));
  assert.notEqual(byId('welcome-sign').icon, byId('neon-signage').icon, 'distinct icons in the owned chip row');
});

test('keptUpgradeIds: memory rungs re-own tiers 1–2, standing orders tier 3 + Legacy; nothing without a keeper', () => {
  assert.deepEqual(keptUpgradeIds([]), []);
  assert.deepEqual(keptUpgradeIds(['welcome-sign', 'civic-bonds-3']), [], 'plain upgrades keep nothing');
  const mem = keptUpgradeIds(['institutional-memory']);
  assert.ok(mem.includes('institutional-memory'));
  for (const d of UPGRADES) {
    const core = !d.priced && d.category !== 'prestige';
    assert.equal(mem.includes(d.id), d.id === 'institutional-memory' || (core && d.tier <= 2), `memory keeps ${d.id}?`);
  }
  const both = keptUpgradeIds(['institutional-memory', 'standing-orders']);
  for (const d of UPGRADES) {
    const core = !d.priced && d.category !== 'prestige';
    const want = (core && d.tier <= 3) || (d.category === 'prestige' && !d.priced);
    assert.equal(both.includes(d.id), want, `both keep ${d.id}?`);
  }
  assert.ok(!both.includes('civic-bonds-1') && !both.includes('planetary-charter'), 'tier 4 and the horizon are decisions again');
  const memoryDefs = UPGRADES.filter((d) => typeof d.keeps === 'function');
  for (const d of memoryDefs) {
    const mods = createMods();
    d.effect(mods, FROZEN_STATE);
    assert.deepEqual(mods, createMods(), `${d.id}: structural rung changes no modifier`);
  }
});

test('init registers the ladder, sortedUpgrades reads the live registry, grants flow through one seam', async () => {
  const game = { derived: { income: 0 }, state: { upgrades: {} } };
  const n = await init(game);
  assert.equal(n, UPGRADES.length);
  assert.equal(registry.upgrades.size, UPGRADES.length);
  const sorted = sortedUpgrades();
  assert.equal(sorted.length, UPGRADES.length);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].cost >= sorted[i - 1].cost, 'ascending');
  assert.equal(sorted[0].id, 'welcome-sign');
  // Config overrides are visible through the sorted view (raw data says $5e7 / $5e8).
  assert.equal(sorted.find((d) => d.id === 'ai-governance').cost, 1e11);
  // The income-price tick handler rewrites bond costs; the sorted view follows.
  const h = registry.tickHandlers.find((t) => t.name === 'upgrades:income-prices');
  assert.ok(h, 'income-price handler registered');
  h.fn({}, { income: 1e9 });
  assert.equal(registry.upgrades.get('civic-bonds-1').cost, 2e9);
  assert.equal(sortedUpgrades().find((d) => d.id === 'civic-bonds-1').cost, 2e9);
  assert.equal(sortedUpgrades(UPGRADES).find((d) => d.id === 'civic-bonds-1').cost, BOND_FLOOR, 'explicit defs are sorted as given');
  assert.ok(registry.actions.has('fundUpgrades'), 'fundUpgrades action registered');
  assert.ok(registry.tickHandlers.some((t) => t.name === 'upgrades:memory'), 'memory handler registered');

  // grantUpgrade: sets the flag once, emits the same 'upgrade' event a purchase does.
  const grant = registry.actions.get('grantUpgrade');
  assert.equal(typeof grant, 'function', 'grantUpgrade action registered');
  const seen = [];
  const off = on('upgrade', (e) => seen.push(e));
  assert.equal(grant('welcome-sign'), true);
  assert.equal(game.state.upgrades['welcome-sign'], true);
  assert.deepEqual(seen, [{ id: 'welcome-sign', cost: 0, granted: true }]);
  assert.equal(grant('welcome-sign'), false, 'already owned');
  assert.equal(grant('no-such-upgrade'), false, 'unknown id');
  assert.equal(grant(42), false, 'junk id');
  assert.equal(seen.length, 1, 'no event without a change');

  // Founding memory rides that seam: own the keeper, let the memory handler see it, then a
  // founding wipes the upgrades and the prestige event grants every kept rung back.
  game.state.upgrades = { 'institutional-memory': true };
  registry.tickHandlers.find((t) => t.name === 'upgrades:memory').fn(game.state);
  game.state.upgrades = {};
  seen.length = 0;
  emit('prestige', { gain: 5, legacy: 15 });
  const kept = keptUpgradeIds(['institutional-memory']);
  assert.equal(seen.length, kept.length, 'one upgrade event per re-granted rung');
  assert.ok(seen.every((e) => e.granted === true && e.cost === 0));
  assert.deepEqual(Object.keys(game.state.upgrades).sort(), [...kept].sort());
  assert.ok(game.state.upgrades['welcome-sign'] && game.state.upgrades['institutional-memory']);
  assert.ok(!game.state.upgrades['prefab-construction'], 'tier 3 is not kept by memory alone');
  off();
});
