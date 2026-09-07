// Node-only exercise of src/save (no DOM, stubbed localStorage). Run: node tools/save-test.mjs
// Each scenario runs in its own child process because the save module installs once per
// process (registry actions, event listeners) and the load path only runs inside init().
//
// Scenarios: parse (parseSave / runMigrations / coerceShape fixtures incl. a v99 save,
// tick=1e300, buildings=1e300), content (unknown ids dropped once the registry is populated),
// corrupt (unreadable save parked, recoverSave action), offline (2 h return: 50 % credit,
// playtime untouched, welcome line), background (throttled tab: full credit, no notice
// below 5 min), newer (v99 save loads and re-saves as v1 without a repeat warning),
// welcome (a reload 3 s after the autosave logs no greeting).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SELF = fileURLToPath(import.meta.url);
const SCENARIOS = ['parse', 'content', 'corrupt', 'offline', 'background', 'newer', 'welcome'];
const which = process.argv.includes('--scenario') ? process.argv[process.argv.indexOf('--scenario') + 1] : null;

if (!which) {
  let failed = 0;
  for (const name of SCENARIOS) {
    try {
      const out = execFileSync(process.execPath, [SELF, '--scenario', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      process.stdout.write(out);
    } catch (e) {
      failed++;
      process.stdout.write(e.stdout || '');
      process.stderr.write(e.stderr || '');
      console.error(`FAIL ${name} (exit ${e.status})`);
    }
  }
  if (failed) {
    console.error(`save-test: ${failed}/${SCENARIOS.length} scenario(s) failed`);
    process.exit(1);
  }
  console.log(`save-test: PASS (${SCENARIOS.length} scenarios)`);
  process.exit(0);
}

// ---------------------------------------------------------------- shared harness

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
  get length() {
    return store.size;
  },
};

const warnings = [];
const realWarn = console.warn;
console.warn = (...a) => warnings.push(a.map(String).join(' '));

const { state, derived, errors } = await import('../src/core/state.js');
const events = await import('../src/core/events.js');
const { registry, registerTickHandler } = await import('../src/core/registry.js');
const { step, loop, TICK_MS } = await import('../src/core/loop.js');
const { config } = await import('../src/balance/config.js');
const save = await import('../src/save/index.js');
const { SAVE_KEY, CORRUPT_KEY, parseSave, runMigrations, coerceShape, MIGRATIONS, encodePayload, decodePayload } = save;

const HOUR = 3600;
const INCOME = 10; // $/s from the synthetic tick handler
const seconds = (n) => n;

function envelope(st, { savedAgoSec = 0, version = 1, app = 'metropolis' } = {}) {
  return JSON.stringify({ app, version, savedAt: Date.now() - savedAgoSec * 1000, state: st });
}

function cityState(over = {}) {
  return {
    version: 1,
    tick: 6000,
    time: 600,
    res: { money: 1234, pop: 40 },
    buildings: { house: 12, shop: 3 },
    upgrades: { paving: true },
    unlocks: { 'b:house': true, 'm:first': true },
    stats: { totalEarned: 5000, peakPop: 40, buildingsBuilt: 15, prestiges: 0, playtime: 600, clicks: 7 },
    prestige: { legacy: 0, spent: 0, lifetimeEarned: 5000 },
    settings: { autosave: true, numFormat: 'short', sfx: true },
    log: [{ t: 1, msg: 'hello', kind: 'info' }],
    ...over,
  };
}

function makeGame() {
  registerTickHandler('save-test-income', (s, d, dt) => {
    s.res.money += INCOME * dt;
    s.stats.totalEarned += INCOME * dt;
  }, 10);
  derived.income = INCOME;
  const game = { state, derived, errors, registry, loop, step, events, headless: false, ready: true, balance: { config } };
  game.action = (name, ...a) => registry.actions.get(name)?.(...a);
  return game;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function untilIdle(info, limitMs = 20000) {
  const t0 = Date.now();
  while (info.catchingUp || !info.lastOffline) {
    if (Date.now() - t0 > limitMs) throw new Error('catch-up did not finish');
    await wait(5);
  }
}
const logHas = (re) => state.log.some((e) => re.test(e.msg));
const near = (a, b, rel = 1e-6) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * rel);

let checks = 0;
const ok = (cond, msg) => {
  checks++;
  assert.ok(cond, msg);
};

// ---------------------------------------------------------------- scenarios

const scenarios = {
  parse() {
    // codec round-trip (UTF-8 safe)
    const code = encodePayload({ app: 'metropolis', version: 1, savedAt: 5, state: cityState({ log: [{ t: 0, msg: 'Zoë ☃ 🏙', kind: 'info' }] }) });
    ok(!/[^A-Za-z0-9+/=]/.test(code), 'export code is base64');
    ok(JSON.parse(decodePayload(code)).state.log[0].msg === 'Zoë ☃ 🏙', 'codec round-trips unicode');

    // v1 envelope
    let r = parseSave(envelope(cityState(), { savedAgoSec: 60 }));
    ok(r.ok && r.state.version === 1 && r.state.res.money === 1234, 'v1 envelope parses');
    ok(r.savedAt > 0 && r.savedAt <= Date.now(), 'savedAt is honoured');
    ok(r.moneyMissing === false, 'money present');

    // bare (unversioned) state
    r = parseSave(JSON.stringify({ res: { money: 7 }, buildings: { house: 2 } }));
    ok(r.ok && r.state.version === 1 && r.savedAt === 0, 'bare state parses as v1 with savedAt 0');

    // newer version (v99) is stamped down to STATE_VERSION
    warnings.length = 0;
    r = parseSave(envelope(cityState({ version: 99 }), { version: 99 }));
    ok(r.ok && r.state.version === 1, 'v99 save is stamped with the current version');
    ok(warnings.some((w) => /newer version/.test(w)), 'v99 load warns once');
    // ...and re-parsing what this build would write does not warn again
    warnings.length = 0;
    parseSave(JSON.stringify({ app: 'metropolis', version: 1, savedAt: Date.now(), state: r.state }));
    ok(!warnings.some((w) => /newer version/.test(w)), 'the re-saved v99 city loads silently');

    // stalled migration (v0 with no MIGRATIONS[0]) keeps its number
    warnings.length = 0;
    r = parseSave(envelope(cityState({ version: 0 })));
    ok(r.ok && r.state.version === 0, 'stalled migration keeps the old version');
    ok(warnings.some((w) => /no migration/.test(w)), 'stalled migration warns');

    // a migration step runs in order and stamps the reached version
    MIGRATIONS[0] = (st) => {
      st.res.money = (st.res.money || 0) + 1;
      st.migrated0 = true;
    };
    const mig = runMigrations({ version: 0, res: { money: 1 } });
    ok(mig.version === 1 && mig.migrated0 === true && mig.res.money === 2, 'migration step applied and version stamped');
    delete MIGRATIONS[0];
    ok(runMigrations({ res: {} }).version === 1, 'missing version is treated as v1');

    // huge numbers are clamped so the loop still counts and buy() limits hold
    r = parseSave(envelope(cityState({ tick: 1e300, time: 1e300, buildings: { house: 1e300 }, stats: { playtime: 1e300 } })));
    ok(r.ok && r.state.tick === Number.MAX_SAFE_INTEGER, 'tick=1e300 clamps to MAX_SAFE_INTEGER');
    ok(r.state.tick + 1 > r.state.tick, 'clamped tick still advances');
    ok(r.state.time === Number.MAX_SAFE_INTEGER, 'time=1e300 clamps');
    ok(r.state.buildings.house === 1e9, 'buildings=1e300 clamps to MAX_COUNT (1e9)');
    ok(r.state.stats.playtime === Number.MAX_SAFE_INTEGER, 'stats clamp');

    // hostile shapes
    ok(parseSave('not json').ok === false, 'garbage rejected');
    ok(parseSave('[1,2]').ok === false, 'array rejected');
    ok(parseSave('{"state":{"tick":1}}').ok === false, 'state without res rejected');
    ok(/not a Metropolis/.test(parseSave(envelope(cityState(), { app: 'other' })).reason), 'foreign app tag rejected');
    r = parseSave('{"state":{"res":{"money":"lots","pop":-5,"__proto__":{"x":1}},"buildings":{"house":"9","shop":-1,"__proto__":{"polluted":1}},"upgrades":{"paving":0,"road":"yes"},"tick":-4,"time":"x","log":[1,{"msg":"a","t":"b"},{"msg":"' + 'x'.repeat(500) + '"}]}}');
    ok(r.ok, 'hostile payload still loads');
    ok(r.state.res.money === undefined && r.moneyMissing === true, 'string money dropped and flagged');
    ok(r.state.res.pop === -5 || r.state.res.pop === undefined, 'pop passes type check (sanitize clamps at load)');
    ok(!Object.prototype.polluted && !Object.keys(r.state.buildings).includes('__proto__') && !Object.keys(r.state.res).includes('__proto__'), 'no prototype pollution');
    ok(r.state.buildings.house === 9 && r.state.buildings.shop === undefined, 'buildings coerced');
    ok(r.state.upgrades.paving === undefined && r.state.upgrades.road === true, 'upgrades coerced to true/absent');
    ok(r.state.tick === undefined && r.state.time === undefined, 'negative tick / string time dropped');
    ok(r.state.log.length === 2 && r.state.log[0].t === 0 && r.state.log[1].msg.length === 240, 'log entries coerced and clipped');
    const deep = {};
    let cur = deep;
    for (let i = 0; i < 40; i++) cur = cur.n = {};
    r = parseSave(JSON.stringify({ res: { money: 1 }, deep }));
    ok(r.ok, 'deep nesting is cut, not fatal');
    // coerceShape is idempotent
    const once = coerceShape(cityState());
    const twice = coerceShape(JSON.parse(JSON.stringify(once)));
    ok(JSON.stringify(once) === JSON.stringify(twice), 'coerceShape is idempotent');
  },

  async content() {
    const { boot } = await import('../src/boot.js');
    await boot();
    ok(registry.buildings.size > 0 && registry.upgrades.size > 0, 'content registered');
    const realB = registry.buildingOrder[0];
    const realU = registry.upgradeOrder[0];
    const r = parseSave(
      envelope(
        cityState({
          buildings: { [realB]: 3, ghost: 5 },
          upgrades: { [realU]: true, ghost: true },
          unlocks: { ['b:' + realB]: true, 'b:ghost': true, 'u:ghost': true, 'm:first': true, 'panel:power': true },
        })
      )
    );
    ok(r.state.buildings[realB] === 3 && r.state.buildings.ghost === undefined, 'unknown building ids dropped');
    const capped = registry.buildingOrder.find((id) => Number.isInteger(registry.buildings.get(id).maxCount));
    if (capped) {
      const cap = registry.buildings.get(capped).maxCount;
      const c = parseSave(envelope(cityState({ buildings: { [capped]: cap + 500 } })));
      ok(c.state.buildings[capped] === cap, `${capped} count pinned to its maxCount ${cap}`);
    }
    ok(r.state.upgrades[realU] === true && r.state.upgrades.ghost === undefined, 'unknown upgrade ids dropped');
    ok(r.state.unlocks['b:' + realB] && !r.state.unlocks['b:ghost'] && !r.state.unlocks['u:ghost'], 'unknown latched unlocks dropped');
    ok(r.state.unlocks['m:first'] && r.state.unlocks['panel:power'], 'simulation unlocks pass through');
  },

  async corrupt() {
    const raw = '{"app":"metropolis","state":{"res":{"money":1' ; // truncated JSON
    store.set(SAVE_KEY, raw);
    const game = makeGame();
    await save.init(game);
    ok(store.get(CORRUPT_KEY) === raw, 'unreadable save parked under CORRUPT_KEY');
    ok(logHas(/unreadable/), 'player is told the records were unreadable');
    ok(state.res.money === 0 && Object.keys(state.buildings).length === 0, 'fresh state after corrupt load');
    const status = game.action('saveStatus');
    ok(status.hasCorrupt === true && status.storage === true, 'saveStatus reports the parked copy');
    ok(game.action('exportCorrupt') === raw, 'exportCorrupt returns the parked bytes');
    ok(game.action('recoverSave') === false, 'recoverSave refuses while the copy is still unreadable');
    ok(store.get(CORRUPT_KEY) === raw, 'refused recovery keeps the copy');

    // A later build can read it (here: the copy is replaced by something this parser accepts).
    let loads = [];
    events.on('load', (p) => loads.push(p));
    store.set(CORRUPT_KEY, envelope(cityState({ res: { money: 4321, pop: 9 } }), { savedAgoSec: 10 }));
    ok(game.action('recoverSave') === true, 'recoverSave restores a readable copy');
    ok(state.res.money === 4321 && state.buildings.house === 12, 'recovered city is live');
    ok(loads.length === 1 && loads[0].source === 'recover', "'load' event with source recover");
    ok(logHas(/restored from the archive/), 'recovery is logged');
    ok(!store.has(CORRUPT_KEY), 'parked copy cleared after recovery');
    const written = parseSave(store.get(SAVE_KEY));
    ok(written.ok && written.state.res.money === 4321, 'recovered city was saved at once');
    ok(game.action('saveStatus').hasCorrupt === false && game.action('exportCorrupt') === '', 'nothing left to recover');
    // hardReset clears both keys
    game.action('hardReset');
    ok(parseSave(store.get(SAVE_KEY)).state.res.money === config.economy.startMoney, 'hard reset writes a fresh city');
  },

  async offline() {
    const away = 2 * HOUR;
    store.set(SAVE_KEY, envelope(cityState({ res: { money: 100, pop: 0 }, stats: { playtime: 600, totalEarned: 0 } }), { savedAgoSec: away }));
    const game = makeGame();
    const offline = [];
    events.on('offline', (p) => offline.push(p));
    const phases = [];
    events.on('catchup', (p) => phases.push(p.phase));
    await save.init(game);
    ok(state.res.money === 100 && state.stats.playtime === 600, 'save loaded');
    ok(logHas(/Welcome back/), 'a real absence is greeted');
    await untilIdle(game.saveInfo);
    const r = game.saveInfo.lastOffline;
    ok(r.source === 'offline' && near(r.seconds, seconds(away), 1e-3), `catch-up covered ${r.seconds}s`);
    ok(r.efficiency === 0.5, 'offline efficiency 0.5');
    ok(near(r.simulatedSec + r.analyticSec, away, 1e-3), 'simulated + analytic == away');
    const expected = INCOME * away * 0.5;
    ok(near(state.res.money - 100, expected, 1e-3), `earned ${state.res.money - 100} ≈ ${expected} (50 %)`);
    ok(near(state.stats.totalEarned, expected, 1e-3), 'totalEarned scaled the same way');
    ok(state.stats.playtime === 600, `playtime untouched by catch-up (${state.stats.playtime})`);
    ok(near(state.stats.offlineTime, away, 1e-3), `offlineTime books the absence (${state.stats.offlineTime})`);
    ok(offline.length === 1 && near(offline[0].earned, expected, 1e-3), "'offline' event carries the earnings");
    ok(phases[0] === 'start' && phases[phases.length - 1] === 'end', 'catchup start/end emitted');
    ok(logHas(/While you were away for 2h 0m/), 'away line logged');
    const written = parseSave(store.get(SAVE_KEY));
    ok(written.ok && near(written.state.res.money, state.res.money) && written.state.stats.playtime === 600, 'post-catch-up autosave written');
    ok(JSON.parse(store.get(SAVE_KEY)).version === 1 && written.state.version === 1, 'envelope and inner version agree');
    // export/import round trip keeps the city
    const code = game.action('exportSave');
    state.res.money = 1;
    ok(game.action('importSave', code) === true && near(state.res.money, written.state.res.money), 'export/import round-trips');
    ok(game.action('importSave', 'zzz not a code') === false, 'bad import rejected');
  },

  async background() {
    const game = makeGame();
    const offline = [];
    events.on('offline', (p) => offline.push(p));
    await save.init(game);
    state.stats.playtime = 50;
    const money0 = state.res.money;
    game.loop.skippedMs = 60 * 1000; // a one-minute throttled tab
    events.emit('frame', 0);
    ok(game.loop.skippedMs === 0, 'skippedMs claimed');
    await untilIdle(game.saveInfo);
    let r = game.saveInfo.lastOffline;
    ok(r.source === 'background' && r.efficiency === 1, 'background catch-up runs at full efficiency');
    ok(near(state.res.money - money0, INCOME * 60, 1e-3), `full credit for 60 s (${state.res.money - money0})`);
    ok(offline.length === 0, 'no "while you were away" notice for a 60 s alt-tab');
    ok(state.stats.playtime === 50, 'playtime untouched by background catch-up');
    ok(near(state.stats.offlineTime, 60, 1e-3), 'offlineTime books the throttled minute');

    game.saveInfo.lastOffline = null;
    game.loop.skippedMs = 400 * 1000;
    events.emit('frame', 1);
    await untilIdle(game.saveInfo);
    r = game.saveInfo.lastOffline;
    ok(offline.length === 1 && offline[0].source === 'background' && offline[0].efficiency === 1, 'a 400 s throttle is announced, still at full credit');
    ok(near(r.seconds, 400, 1e-3), 'seconds reported');
    ok(logHas(/While you were away for 6m 40s/), 'away line logged for the long throttle');
  },

  async newer() {
    store.set(SAVE_KEY, envelope(cityState({ version: 99, res: { money: 555, pop: 1 } }), { version: 99, savedAgoSec: 5 }));
    warnings.length = 0;
    const game = makeGame();
    await save.init(game);
    ok(state.res.money === 555 && state.version === 1, 'v99 save loads best-effort as v1');
    ok(warnings.filter((w) => /newer version/.test(w)).length === 1, 'warned once on load');
    ok(game.action('save') === true, 'manual save ok');
    const json = store.get(SAVE_KEY);
    const env = JSON.parse(json);
    ok(env.version === 1 && env.state.version === 1, 'autosave writes v1 inside and out');
    warnings.length = 0;
    ok(parseSave(json).ok && !warnings.some((w) => /newer/.test(w)), 'the next load is silent');
  },

  async welcome() {
    store.set(SAVE_KEY, envelope(cityState(), { savedAgoSec: 3 }));
    const game = makeGame();
    await save.init(game);
    ok(state.res.money === 1234, 'loaded');
    ok(!logHas(/Welcome back/), 'a 3 s reload is not greeted');
    await wait(50);
    ok(!logHas(/While you were away/), 'no away line for 3 s');
    ok(game.saveInfo.catchingUp === false, 'no catch-up left running');
    // blocked storage: setItem throws -> save reports false, never throws
    globalThis.localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    ok(game.action('save') === false, 'quota error surfaces as false');
    ok(/could not write/.test(warnings[warnings.length - 1] || ''), 'quota warning logged');
    ok(game.action('saveStatus').lastSaveError !== null, 'lastSaveError set');
  },
};

try {
  await scenarios[which]();
  if (errors.length) throw new Error('core errors: ' + errors.map((e) => e.msg).join('; '));
  console.warn = realWarn;
  console.log(`  ${which}: ${checks} checks ok`);
  process.exit(0);
} catch (e) {
  console.warn = realWarn;
  console.error(`  ${which}: ${e && e.stack ? e.stack : e}`);
  if (warnings.length) console.error('  warnings:', warnings.slice(-5));
  process.exit(1);
}
