// Unit tests for src/save. Run: node src/save/save.test.mjs
// Pins the pure layer (codec, parseSave, runMigrations, coerceShape) and then runs
// tools/save-test.mjs, which drives init() end to end with a stubbed localStorage (corrupt
// parking + recoverSave, 2 h offline return at 50 %, background-tab catch-up at 100 %,
// playtime untouched by catch-up, v99 save re-stamped to v1, quota errors, multi-tab
// conflict pause, blocked storage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATE_VERSION } from '../core/state.js';
import { parseSave, runMigrations, coerceShape, MIGRATIONS, encodePayload, decodePayload, SAVE_KEY, CORRUPT_KEY } from './index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const quiet = () => {
  const orig = console.warn;
  const seen = [];
  console.warn = (...a) => seen.push(a.join(' '));
  return { seen, restore: () => (console.warn = orig) };
};

const city = (over = {}) => ({
  version: STATE_VERSION,
  tick: 100,
  time: 10,
  res: { money: 50, pop: 3 },
  buildings: { house: 2 },
  upgrades: {},
  unlocks: {},
  stats: { totalEarned: 60, peakPop: 3, buildingsBuilt: 2, prestiges: 0, playtime: 10, clicks: 0 },
  prestige: { legacy: 0, spent: 0, lifetimeEarned: 60 },
  settings: { autosave: true, numFormat: 'short', sfx: true },
  log: [],
  ...over,
});
const wrap = (st, extra = {}) => JSON.stringify({ app: 'metropolis', version: STATE_VERSION, savedAt: Date.now() - 1000, state: st, ...extra });

test('keys are stable', () => {
  assert.equal(SAVE_KEY, 'metropolis.save.v1');
  assert.equal(CORRUPT_KEY, 'metropolis.save.v1.corrupt');
});

test('codec round-trips, tolerates whitespace and url-safe base64', () => {
  const payload = { app: 'metropolis', version: 1, savedAt: 1, state: city({ log: [{ t: 0, msg: 'café ☃', kind: 'info' }] }) };
  const code = encodePayload(payload);
  assert.deepEqual(JSON.parse(decodePayload(code)), payload);
  const spaced = code.replace(/(.{20})/g, '$1\n ').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.deepEqual(JSON.parse(decodePayload(spaced)), payload);
  assert.throws(() => decodePayload('   '));
});

test('parseSave accepts envelope and bare state, rejects junk', () => {
  const q = quiet();
  try {
    assert.equal(parseSave(wrap(city())).ok, true);
    assert.equal(parseSave(wrap(city(), { sessionId: 'tab-a' })).ok, true, 'sessionId in the envelope is accepted');
    assert.equal(parseSave(JSON.stringify(city())).ok, true);
    for (const bad of ['', 'nope', '[]', '42', '{"state":5}', '{"state":{"tick":1}}', wrap(city(), { app: 'elsewhere' })]) {
      assert.equal(parseSave(bad).ok, false, bad);
    }
    const r = parseSave(wrap(city(), { savedAt: Date.now() + 1e9 }));
    assert.ok(r.savedAt <= Date.now(), 'future savedAt is clamped to now');
    assert.equal(parseSave(wrap({ res: {} })).moneyMissing, true);
  } finally {
    q.restore();
  }
});

test('runMigrations: newer versions are stamped down, stalled ones keep their number, steps run in order', () => {
  const q = quiet();
  try {
    assert.equal(runMigrations({ version: 99, res: {} }).version, STATE_VERSION);
    assert.equal(runMigrations({ version: STATE_VERSION - 1, res: {} }).version, STATE_VERSION - 1);
    assert.equal(runMigrations({ res: {} }).version, STATE_VERSION);
    const order = [];
    MIGRATIONS[STATE_VERSION - 2] = (st) => order.push('a');
    MIGRATIONS[STATE_VERSION - 1] = (st) => order.push('b');
    try {
      assert.equal(runMigrations({ version: STATE_VERSION - 2, res: {} }).version, STATE_VERSION);
      assert.deepEqual(order, ['a', 'b']);
    } finally {
      delete MIGRATIONS[STATE_VERSION - 2];
      delete MIGRATIONS[STATE_VERSION - 1];
    }
    assert.ok(q.seen.some((w) => /newer version/.test(w)));
    assert.ok(q.seen.some((w) => /no migration/.test(w)));
  } finally {
    q.restore();
  }
});

test('coerceShape clamps huge counters and drops wrong types', () => {
  const st = coerceShape(city({ tick: 1e300, time: 1e300, buildings: { house: 1e300, shop: 0, mall: 'x' }, res: { money: '9', pop: 2 }, stats: { playtime: 1e300, clicks: 'no' } }));
  assert.equal(st.tick, Number.MAX_SAFE_INTEGER);
  assert.equal(st.time, Number.MAX_SAFE_INTEGER);
  assert.equal(st.buildings.house, 1e9);
  assert.equal(st.buildings.shop, undefined);
  assert.equal(st.buildings.mall, undefined);
  assert.equal(st.res.money, undefined);
  assert.equal(st.res.pop, 2);
  assert.equal(st.stats.playtime, Number.MAX_SAFE_INTEGER);
  assert.equal(st.stats.clicks, undefined);
  assert.equal(coerceShape({ res: {}, buildings: [], log: 'x', tick: -1 }).buildings, undefined);
});

test('tools/save-test.mjs end-to-end scenarios pass', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'save-test.mjs')], { encoding: 'utf8', cwd: ROOT });
  assert.match(out, /save-test: PASS/);
});
