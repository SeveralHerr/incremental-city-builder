// Save module: localStorage autosave/load, offline catch-up, export/import codes, hard reset.
// One of the two modules allowed to touch the browser (window, document, localStorage).
// Everything here is defensive: a corrupt or hostile save must never take the game down.
import { loadState, addLog, STATE_VERSION, createInitialState } from '../core/state.js';
import { registerAction, registry } from '../core/registry.js';
import { reportError } from '../core/safe.js';
import { TICK_MS } from '../core/loop.js';
import { fmtMoney, fmtTime } from '../core/format.js';

export const SAVE_KEY = 'metropolis.save.v1';
// An unreadable save is parked here instead of being silently overwritten by the next autosave.
export const CORRUPT_KEY = 'metropolis.save.v1.corrupt';
const APP_TAG = 'metropolis';
const CHUNK_TICKS = 200; // max ticks simulated per catch-up chunk
const CHUNK_SLICE_MS = 24; // yield to the browser after this much work in one task
const MIN_AUTO_GAP_MS = 500; // collapse hidden + pagehide + beforeunload into one write
const UNLOAD_REASONS = new Set(['hidden', 'pagehide', 'beforeunload']);
const TICKS_PER_SEC = 1000 / TICK_MS;
const MAX_LOG = 60;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// Events that change the city in a way a 30 s autosave gap could lose. 'prestige' writes at
// once; the others are debounced so a shopping burst is one write.
const IMMEDIATE_SAVE_EVENTS = ['prestige'];
const DEBOUNCED_SAVE_EVENTS = ['upgrade', 'milestone'];
const DEBOUNCE_SAVE_MS = 1500;

// Offline rule (one rule, both paths): the city grows at full rate while away, but cash earned
// offline is credited at config.save.offlineEfficiency (0.5) whether the ticks were simulated
// with game.step() or approximated analytically after the wall budget ran out. This makes the
// payout independent of how fast the returning device can simulate.
const DEFAULTS = {
  autosaveSec: 30,
  offlineCapSec: 8 * 3600,
  offlineEfficiency: 0.5,
  offlineBudgetMs: 1500, // wall-clock budget for simulated catch-up; the rest is analytic
  offlineMinSec: 30, // shorter absences are simulated quietly, no toast or log line
  startMoney: 50,
};

// Per-version migrations: MIGRATIONS[n] upgrades a state from version n to n+1.
// Add an entry whenever STATE_VERSION bumps; the runner applies them in order.
const MIGRATIONS = {};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const pos = (v, d) => (num(v, d) > 0 ? num(v, d) : d);
const nonneg = (v, d) => (num(v, d) >= 0 ? num(v, d) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// Codec: JSON <-> base64 (UTF-8 safe, chunked so huge logs never blow the call stack)
// ---------------------------------------------------------------------------

export function encodePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function decodePayload(text) {
  const clean = String(text).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!clean) throw new Error('empty code');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// Validation: turn untrusted JSON into a state object loadState() can merge safely.
// ---------------------------------------------------------------------------

// Deep copy that drops prototype-polluting keys and anything non-serializable.
function scrub(v, depth = 0) {
  if (depth > 16) return undefined;
  if (Array.isArray(v)) {
    const out = [];
    for (const x of v) {
      const s = scrub(x, depth + 1);
      if (s !== undefined) out.push(s);
    }
    return out;
  }
  if (isObj(v)) {
    const out = {};
    for (const k of Object.keys(v)) {
      if (BAD_KEYS.has(k)) continue;
      const s = scrub(v[k], depth + 1);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v) ? v : undefined;
  if (t === 'string' || t === 'boolean' || v === null) return v;
  return undefined;
}

// Coerce known sections to the shapes createInitialState() promises; unknown keys added by
// other modules are kept as-is, invalid known keys are dropped so defaults apply.
function coerceShape(st) {
  const fresh = createInitialState();
  for (const sec of ['res', 'stats', 'prestige', 'settings']) {
    if (!isObj(st[sec])) {
      delete st[sec];
      continue;
    }
    const want = fresh[sec];
    for (const k of Object.keys(st[sec])) {
      const type = typeof want[k];
      if (type === 'undefined') continue;
      const v = st[sec][k];
      if (typeof v !== type || (type === 'number' && !Number.isFinite(v))) delete st[sec][k];
    }
  }
  // Ids the registry does not know (renamed content, hand-edited saves) are dropped so they
  // never linger in state. The registry is only consulted once content has registered, so a
  // bare parseSave() in a test harness still keeps everything.
  const known = (map, k) => map.size === 0 || map.has(k);
  if (isObj(st.buildings)) {
    for (const k of Object.keys(st.buildings)) {
      const n = Math.floor(Number(st.buildings[k]));
      if (Number.isFinite(n) && n > 0 && known(registry.buildings, k)) st.buildings[k] = n;
      else delete st.buildings[k];
    }
  } else delete st.buildings;
  for (const sec of ['upgrades', 'unlocks']) {
    if (!isObj(st[sec])) {
      delete st[sec];
      continue;
    }
    for (const k of Object.keys(st[sec])) {
      const ok = sec === 'upgrades' ? known(registry.upgrades, k) : unlockKnown(k);
      if (st[sec][k] && ok) st[sec][k] = true;
      else delete st[sec][k];
    }
  }
  if (Array.isArray(st.log)) {
    st.log = st.log
      .filter((e) => isObj(e) && typeof e.msg === 'string')
      .slice(-MAX_LOG)
      .map((e) => ({ t: num(e.t, 0), msg: e.msg.slice(0, 240), kind: typeof e.kind === 'string' ? e.kind : 'info' }));
  } else delete st.log;
  if (!Number.isInteger(st.tick) || st.tick < 0) delete st.tick;
  if (!Number.isFinite(st.time) || st.time < 0) delete st.time;
  return st;
}

// Latched unlock flags are namespaced: b:<building>, u:<upgrade>; everything else (m:<milestone>,
// panel:<gate>) belongs to simulation and is passed through.
function unlockKnown(key) {
  if (key.startsWith('b:')) return registry.buildings.size === 0 || registry.buildings.has(key.slice(2));
  if (key.startsWith('u:')) return registry.upgrades.size === 0 || registry.upgrades.has(key.slice(2));
  return true;
}

function runMigrations(st) {
  let v = Number.isInteger(st.version) ? st.version : 1;
  if (v > STATE_VERSION) {
    console.warn(`[save] save is from a newer version (${v} > ${STATE_VERSION}); loading best-effort.`);
  }
  while (v < STATE_VERSION) {
    const step = MIGRATIONS[v];
    if (typeof step !== 'function') break;
    step(st);
    v++;
  }
  // Only stamp the version the state actually reached. A save that stalls on a missing
  // migration keeps its old number, so it is migrated properly once the step exists instead of
  // being treated as current forever.
  if (v < STATE_VERSION) console.warn(`[save] no migration from v${v} to v${STATE_VERSION}; loading best-effort.`);
  st.version = v;
  return st;
}

// Parse a JSON save (envelope `{ savedAt, state }` or a bare state) into { ok, state, savedAt }.
export function parseSave(json) {
  const fail = (reason) => ({ ok: false, reason });
  let obj;
  try {
    obj = JSON.parse(json);
  } catch {
    return fail('not valid JSON');
  }
  if (!isObj(obj)) return fail('not an object');
  const envelope = isObj(obj.state) ? obj : isObj(obj.res) ? { state: obj } : null;
  if (!envelope) return fail('missing state');
  if (typeof envelope.app === 'string' && envelope.app !== APP_TAG) return fail(`not a Metropolis save (${envelope.app})`);
  const st = scrub(envelope.state);
  if (!isObj(st) || !isObj(st.res)) return fail('missing resources');
  coerceShape(runMigrations(st));
  const savedAt = num(envelope.savedAt, 0);
  // moneyMissing: the money field was absent or unreadable, so the loader reseeds startMoney
  // instead of leaving the mayor with $0 and no way to buy the first house.
  return { ok: true, state: st, savedAt: clamp(savedAt, 0, Date.now()), moneyMissing: st.res.money === undefined };
}

// ---------------------------------------------------------------------------
// Module runtime
// ---------------------------------------------------------------------------

let installed = false;

async function loadConfig(game) {
  let c = game.balance?.config ?? game.config ?? null;
  if (!isObj(c)) {
    try {
      const m = await import('../balance/config.js');
      c = m.config ?? m.default ?? null;
    } catch {
      c = null;
    }
  }
  const s = isObj(c?.save) ? c.save : {};
  return {
    autosaveSec: pos(s.autosaveSec, DEFAULTS.autosaveSec),
    offlineCapSec: pos(s.offlineCapSec, DEFAULTS.offlineCapSec),
    offlineEfficiency: clamp(num(s.offlineEfficiency, DEFAULTS.offlineEfficiency), 0, 1),
    offlineBudgetMs: pos(s.offlineBudgetMs, DEFAULTS.offlineBudgetMs),
    offlineMinSec: nonneg(s.offlineMinSec, DEFAULTS.offlineMinSec),
    startMoney: nonneg(c?.economy?.startMoney, DEFAULTS.startMoney),
  };
}

function probeStorage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = '__metropolis_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export async function init(game) {
  const emit = (name, payload) => game.events?.emit?.(name, payload);
  const state = game.state;
  const derived = game.derived;

  const info = {
    key: SAVE_KEY,
    storage: false,
    headless: !!game.headless,
    lastSavedAt: 0,
    lastSaveError: null,
    loadedAt: 0,
    catchingUp: false,
    lastOffline: null,
  };
  game.saveInfo = info;

  let cfg = { ...DEFAULTS };
  let storage = null;
  const autosaveOn = () => state.settings?.autosave !== false;

  // ---- catch-up (offline progress + background-tab throttling) ----
  const catchUp = {
    running: false,
    pendingTicks: 0,
    totalSeconds: 0,
    simulatedTicks: 0,
    wallUsed: 0,
    moneyBefore: 0,
    source: 'offline',
  };

  function pendingSeconds() {
    return catchUp.pendingTicks / TICKS_PER_SEC;
  }

  function finishCatchUp() {
    const remainingSec = pendingSeconds();
    catchUp.pendingTicks = 0;
    const rate = Math.max(0, num(derived.income, 0));
    const bonus = rate * remainingSec * cfg.offlineEfficiency;
    if (bonus > 0) {
      state.res.money += bonus;
      state.stats.totalEarned = num(state.stats.totalEarned, 0) + bonus;
      if (isObj(state.prestige)) state.prestige.lifetimeEarned = num(state.prestige.lifetimeEarned, 0) + bonus;
    }
    const seconds = catchUp.totalSeconds;
    const simulatedSec = catchUp.simulatedTicks / TICKS_PER_SEC;
    const earned = Math.max(0, state.res.money - catchUp.moneyBefore);
    const result = { seconds, earned, simulatedSec, analyticSec: remainingSec, source: catchUp.source };
    catchUp.running = false;
    catchUp.totalSeconds = 0;
    catchUp.simulatedTicks = 0;
    catchUp.wallUsed = 0;
    info.catchingUp = false;
    info.lastOffline = result;
    emit('catchup', { phase: 'end', source: result.source, seconds });
    if (seconds >= cfg.offlineMinSec) {
      const away = fmtTime(seconds);
      addLog(
        earned > 0
          ? `While you were away for ${away}, the city earned ${fmtMoney(earned)}.`
          : `While you were away for ${away}, the city held steady.`,
        'info'
      );
      emit('offline', result);
      if (autosaveOn()) save('offline');
    }
  }

  // Simulate n ticks and credit only cfg.offlineEfficiency of the money they earned. Losses
  // (negative income from upkeep) are not softened; the analytic remainder ignores them
  // entirely (rate clamped at 0), so both paths favour the player the same way.
  function stepScaled(n) {
    const eff = cfg.offlineEfficiency;
    const st = state.stats;
    const pr = isObj(state.prestige) ? state.prestige : null;
    const money0 = state.res.money;
    const earned0 = num(st.totalEarned, 0);
    const life0 = pr ? num(pr.lifetimeEarned, 0) : 0;
    game.step(n);
    if (eff >= 1) return;
    const dMoney = state.res.money - money0;
    if (dMoney > 0) state.res.money = money0 + dMoney * eff;
    const dEarned = num(st.totalEarned, 0) - earned0;
    if (dEarned > 0) st.totalEarned = earned0 + dEarned * eff;
    if (pr) {
      const dLife = num(pr.lifetimeEarned, 0) - life0;
      if (dLife > 0) pr.lifetimeEarned = life0 + dLife * eff;
    }
  }

  function runChunk() {
    if (!catchUp.running) return;
    const sliceStart = now();
    while (catchUp.pendingTicks > 0 && catchUp.wallUsed < cfg.offlineBudgetMs) {
      const n = Math.min(CHUNK_TICKS, catchUp.pendingTicks);
      const t0 = now();
      stepScaled(n);
      const spent = now() - t0;
      catchUp.wallUsed += spent;
      catchUp.pendingTicks -= n;
      catchUp.simulatedTicks += n;
      if (now() - sliceStart > CHUNK_SLICE_MS) {
        setTimeout(runChunk, 0); // let the browser paint between slices
        return;
      }
    }
    finishCatchUp();
  }

  function queueCatchUp(seconds, source) {
    const ticks = Math.floor(clamp(num(seconds, 0), 0, cfg.offlineCapSec) * TICKS_PER_SEC);
    if (ticks < 1) return;
    catchUp.pendingTicks += ticks;
    catchUp.totalSeconds += ticks / TICKS_PER_SEC;
    if (catchUp.running) return;
    catchUp.running = true;
    catchUp.source = source;
    catchUp.moneyBefore = state.res.money;
    catchUp.simulatedTicks = 0;
    catchUp.wallUsed = 0;
    info.catchingUp = true;
    // UI hint: milestone/unlock toasts raised while this runs belong behind the offline notice.
    emit('catchup', { phase: 'start', source, seconds: catchUp.totalSeconds });
    setTimeout(runChunk, 0);
  }

  function cancelCatchUp() {
    catchUp.running = false;
    catchUp.pendingTicks = 0;
    catchUp.totalSeconds = 0;
    catchUp.simulatedTicks = 0;
    catchUp.wallUsed = 0;
    if (info.catchingUp) emit('catchup', { phase: 'end', source: catchUp.source, seconds: 0 });
    info.catchingUp = false;
  }

  // ---- persistence ----
  function buildPayload() {
    // While a catch-up is still pending, backdate savedAt by the un-simulated remainder so
    // closing the tab mid-catch-up never loses the time the player was owed.
    const savedAt = Date.now() - Math.round(pendingSeconds() * 1000);
    return { app: APP_TAG, version: STATE_VERSION, savedAt, state };
  }

  function save(reason = 'manual') {
    if (!storage) return false;
    // hidden + pagehide + beforeunload fire back to back on tab close; one write is enough.
    if (UNLOAD_REASONS.has(reason) && info.lastSavedAt && Date.now() - info.lastSavedAt < MIN_AUTO_GAP_MS) return true;
    try {
      const payload = buildPayload();
      const json = JSON.stringify(payload);
      storage.setItem(SAVE_KEY, json);
      info.lastSavedAt = Date.now();
      info.lastSaveError = null;
      emit('save', { at: info.lastSavedAt, savedAt: payload.savedAt, bytes: json.length, reason });
      return true;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (info.lastSaveError !== msg) console.warn(`[save] could not write the save (${msg}).`);
      info.lastSaveError = msg;
      return false;
    }
  }

  function applyState(st) {
    cancelCatchUp();
    loadState(st);
    info.loadedAt = Date.now();
  }

  function loadFromStorage() {
    let raw = null;
    try {
      raw = storage.getItem(SAVE_KEY);
    } catch (e) {
      console.warn('[save] could not read storage:', e && e.message ? e.message : e);
      return null;
    }
    if (!raw) return null;
    const r = parseSave(raw);
    if (!r.ok) {
      console.warn(`[save] the saved city could not be read (${r.reason}); starting fresh. A copy was kept under "${CORRUPT_KEY}".`);
      try {
        storage.setItem(CORRUPT_KEY, raw);
      } catch {
        /* storage full or blocked; nothing else to do */
      }
      addLog('The old city records were unreadable. A fresh plot has been surveyed.', 'warn');
      return null;
    }
    applyState(r.state);
    if (r.moneyMissing) state.res.money = cfg.startMoney;
    addLog('Welcome back, Mayor. The city kept your seat warm.', 'info');
    emit('load', { source: 'storage', savedAt: r.savedAt });
    return r;
  }

  function exportSave() {
    try {
      return encodePayload(buildPayload());
    } catch (e) {
      console.warn('[save] export failed:', e && e.message ? e.message : e);
      return '';
    }
  }

  function importSave(code) {
    if (typeof code !== 'string') return false;
    const text = code.trim();
    if (!text) return false;
    let json;
    try {
      json = text.startsWith('{') ? text : decodePayload(text);
    } catch (e) {
      console.warn('[save] import code is not valid base64.');
      return false;
    }
    const r = parseSave(json);
    if (!r.ok) {
      console.warn(`[save] import rejected: ${r.reason}.`);
      return false;
    }
    applyState(r.state);
    if (r.moneyMissing) state.res.money = cfg.startMoney;
    addLog('City plans imported. The archives remember everything.', 'info');
    emit('load', { source: 'import', savedAt: r.savedAt });
    if (storage) save('import');
    return true;
  }

  function hardReset() {
    if (storage) {
      try {
        storage.removeItem(SAVE_KEY);
        storage.removeItem(CORRUPT_KEY);
      } catch {
        /* clearing is best-effort */
      }
    }
    // Display preferences are not part of the city; keep them across the wipe.
    const settings = isObj(state.settings) ? { ...state.settings } : null;
    applyState({});
    if (settings) state.settings = settings;
    state.res.money = cfg.startMoney;
    addLog('The old city is gone. A fresh plot waits under an open sky.', 'info');
    emit('load', { source: 'reset', savedAt: 0 });
    if (storage) save('reset');
    return true;
  }

  function saveStatus() {
    return { ...info, autosave: autosaveOn(), autosaveSec: cfg.autosaveSec, pendingOfflineSec: pendingSeconds() };
  }

  try {
    if (installed) return; // a second init must not replace the live closure's actions
    installed = true;
    cfg = await loadConfig(game);

    registerAction('save', () => save('manual'));
    registerAction('exportSave', exportSave);
    registerAction('importSave', importSave);
    registerAction('hardReset', hardReset);
    registerAction('saveStatus', saveStatus);

    // Headless verify shares the real game's origin: never read or write its save.
    if (game.headless) return;

    storage = probeStorage();
    info.storage = !!storage;
    if (!storage) console.warn('[save] localStorage is unavailable; progress will not persist this session.');

    const loaded = storage ? loadFromStorage() : null;

    // Background-tab throttling: the loop refuses to catch up more than 50 ticks per frame
    // and parks the rest in loop.skippedMs; turn that into a quiet catch-up.
    game.events?.on?.('frame', () => {
      const loop = game.loop;
      if (!loop || !(loop.skippedMs >= TICK_MS)) return;
      const ms = loop.skippedMs;
      loop.skippedMs = 0;
      queueCatchUp(ms / 1000, 'background');
    });

    if (typeof setInterval === 'function') {
      setInterval(() => {
        if (autosaveOn()) save('auto');
      }, cfg.autosaveSec * 1000);
    }
    // Major state changes are written right away (prestige) or shortly after (upgrade,
    // milestone) so a tab crash inside the 30 s window cannot replay the old city.
    for (const name of IMMEDIATE_SAVE_EVENTS) {
      game.events?.on?.(name, () => {
        if (autosaveOn()) save(name);
      });
    }
    let debounced = 0;
    for (const name of DEBOUNCED_SAVE_EVENTS) {
      game.events?.on?.(name, () => {
        if (catchUp.running || !autosaveOn()) return; // catch-up ends with its own save
        clearTimeout(debounced);
        debounced = setTimeout(() => {
          if (autosaveOn()) save(name);
        }, DEBOUNCE_SAVE_MS);
      });
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && autosaveOn()) save('hidden');
      });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        if (autosaveOn()) save('pagehide');
      });
      window.addEventListener('beforeunload', () => {
        if (autosaveOn()) save('beforeunload');
      });
    }

    // Offline progress starts once the UI is mounted and has painted once, so the toast has
    // a listener and the returning player sees their city before the catch-up begins.
    if (loaded && loaded.savedAt > 0) {
      const elapsed = clamp((Date.now() - loaded.savedAt) / 1000, 0, cfg.offlineCapSec);
      let started = false;
      const begin = () => {
        if (started) return;
        started = true;
        const go = () => queueCatchUp(elapsed, 'offline');
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0));
        else setTimeout(go, 0);
      };
      if (game.ready) begin();
      else {
        const off = game.events?.on?.('ready', () => {
          if (typeof off === 'function') off();
          begin();
        });
        setTimeout(begin, 3000); // safety net if 'ready' never fires
      }
    }
  } catch (e) {
    reportError('save', e);
  }
}
