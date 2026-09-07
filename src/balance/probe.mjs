// Balance placement probe. DOM-free, Node only:
//   node src/balance/probe.mjs [--ticks 432000] [--save 0|30|60|120] [--set path=value ...] [--json out.json]
// Plays the greedy bot (optionally the saver profile: `--save N` = core/bot saveSeconds) for
// a 12 h session on top of the shipped config, with any `--set` overrides applied to the
// config object *before* boot (e.g. `--set upgrades.galactic-charter.cost=4.5e14`,
// `--set buildings.arcology.unlockAt.pop=5500` also rewrites the pop gate), and prints the
// readings the balance pass is tuned against — the ones tools/economy-sim.mjs reports plus
// what it does not: every cycle's ratio to the one before it (strict, no slack, from the
// 4th founding on), which city and minute each money rung is bought in, under-power share
// per game-hour, and mid-city happiness dips (the lowest happiness after a city's first
// minute, i.e. not the dark first tick / jobless opening of a replay). It is the sweep tool
// behind the placement table in config.js; the contract itself is still measured by
// tools/economy-sim.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const TICKS = Number(opt('--ticks', 432000));
const SAVE = Number(opt('--save', 0));
const JSON_OUT = opt('--json', '');
const BOT_EVERY = 20;
const SAMPLE = 600;
const RATIO_FROM = 4; // cycles[i] / cycles[i-1] is checked from i = 4 (the 5th founding) on
const RATIO_MAX = 1.35; // docs/DESIGN.md: each cycle <= 1.35x the previous
const TRACE = Number(opt('--trace', -1)); // dump one city's cash/income every 10 s
const trace = [];
const sets = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--set' && args[i + 1]) sets.push(args[++i]);

const toUrl = (p) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:');
const { config } = await import(toUrl(path.join(ROOT, 'src/balance/config.js')));

// Apply `--set a.b.c=value` (numbers parsed; anything else kept as a string) before boot.
// A pop-gate override (`buildings.<id>.unlockAt.pop`) also rewrites the unlock rule and hint.
for (const s of sets) {
  const eq = s.indexOf('=');
  if (eq < 0) throw new Error(`--set expects path=value, got ${s}`);
  const keys = s.slice(0, eq).split('.');
  const raw = s.slice(eq + 1);
  const value = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  let node = config;
  for (let i = 0; i < keys.length - 1; i++) {
    if (node[keys[i]] === undefined || node[keys[i]] === null || typeof node[keys[i]] !== 'object') node[keys[i]] = {};
    node = node[keys[i]];
  }
  node[keys[keys.length - 1]] = value;
  if (keys[0] === 'buildings' && keys[2] === 'unlockAt' && keys[3] === 'pop' && typeof value === 'number') {
    const b = config.buildings[keys[1]];
    b.unlock = (state) => (state?.res?.pop ?? 0) >= value;
    b.unlockHint = `Reach ${value.toLocaleString('en-US')} citizens`;
  }
}

const { boot, game } = await import(toUrl(path.join(ROOT, 'src/boot.js')));
await boot();
const { state, derived, api, registry } = game;

const everBought = new Set();
const cycles = [];
const rungBuys = []; // { id, city, runMin } for every first-time money upgrade purchase after the first city
let cur = { n: 0, startMin: 0, newItems: [], minHappy: Infinity, minHappyMid: Infinity, ticks: 0, under: 0, spree: 0, spreeMin: 0, plateau: 0, plateauMin: 0 };
game.events.on('buy', (e) => {
  const k = 'b:' + e.id;
  if (!everBought.has(k)) {
    everBought.add(k);
    cur.newItems.push(e.id);
  }
});
game.events.on('upgrade', (e) => {
  const k = 'u:' + e.id;
  if (everBought.has(k)) return;
  everBought.add(k);
  cur.newItems.push(e.id);
  if (cur.n >= 1 && e.currency !== 'legacy') rungBuys.push({ id: e.id, city: cur.n, runMin: +(state.time / 60).toFixed(1) });
});
game.events.on('prestige', () => {
  const nowMin = state.stats.playtime / 60;
  cycles.push({
    n: cur.n,
    minutes: +(nowMin - cur.startMin).toFixed(2),
    legacy: state.prestige.legacy,
    minHappy: cur.minHappy === Infinity ? null : +cur.minHappy.toFixed(3),
    minHappyMid: cur.minHappyMid === Infinity ? null : +cur.minHappyMid.toFixed(3),
    under: cur.ticks ? +(cur.under / cur.ticks).toFixed(3) : 0,
    newItems: cur.newItems,
    earned: lastEarned,
    endIncome: lastIncome,
    spree: cur.spree, // peak cash in the first four minutes (the replay's seed spree)
    spreeMin: cur.spreeMin,
    plateau: cur.plateau, // peak cash after the fourth minute
    plateauMin: cur.plateauMin,
  });
  cur = { n: cur.n + 1, startMin: nowMin, newItems: [], minHappy: Infinity, minHappyMid: Infinity, ticks: 0, under: 0, spree: 0, spreeMin: 0, plateau: 0, plateauMin: 0 };
});

const hours = Math.ceil(TICKS / 36000);
const underByHour = new Array(hours).fill(0);
const ticksByHour = new Array(hours).fill(0);
let maxMoney = 0;
let minRatio = 1;
let reachHits = 0;
let samples = 0;
let noReach = 0;
let firstFoundMin = null;
let lastEarned = 0;
let lastIncome = 0;
function reachSeconds(cash, income) {
  let cheapest = Infinity;
  for (const u of api.upgrades()) {
    if (!u.unlocked || u.owned || u.currency === 'legacy') continue;
    if (u.cost < cheapest) cheapest = u.cost;
  }
  if (!Number.isFinite(cheapest)) return Infinity;
  if (cheapest <= cash) return 0;
  return income > 0 ? (cheapest - cash) / income : Infinity;
}

for (let t = 0; t < TICKS; t += BOT_EVERY) {
  game.botStep(SAVE > 0 ? { saveSeconds: SAVE } : {});
  const n = Math.min(BOT_EVERY, TICKS - t);
  game.step(n);
  const h = Math.min(hours - 1, Math.floor((t + n) / 36000));
  ticksByHour[h] += n;
  cur.ticks += n;
  if (derived.powerRatio < 1) {
    underByHour[h] += n;
    cur.under += n;
  }
  if (derived.powerRatio < minRatio) minRatio = derived.powerRatio;
  if (derived.happiness < cur.minHappy) cur.minHappy = derived.happiness;
  if (state.time > 60 && derived.happiness < cur.minHappyMid) cur.minHappyMid = derived.happiness;
  if (state.res.money > maxMoney) maxMoney = state.res.money;
  if (cur.n === TRACE && state.tick % 100 < BOT_EVERY) trace.push(`${(state.time / 60).toFixed(1)}:${state.res.money.toExponential(2)}/${derived.income.toExponential(1)}`);
  lastEarned = state.stats.totalEarned;
  lastIncome = derived.income;
  if (state.time <= 240) {
    if (state.res.money > cur.spree) { cur.spree = state.res.money; cur.spreeMin = +(state.time / 60).toFixed(1); }
  } else if (state.res.money > cur.plateau) { cur.plateau = state.res.money; cur.plateauMin = +(state.time / 60).toFixed(1); }
  if (firstFoundMin === null && state.stats.prestiges > 0) firstFoundMin = +(state.stats.playtime / 60).toFixed(1);
  if (state.tick % SAMPLE < BOT_EVERY) {
    samples++;
    const r = reachSeconds(state.res.money, derived.income);
    if (r >= 30 && r <= 900) reachHits++;
    if (!Number.isFinite(r)) noReach++;
  }
}

const mins = cycles.map((c) => c.minutes);
const ratios = [];
for (let i = RATIO_FROM; i < mins.length; i++) ratios.push({ i, ratio: +(mins[i] / mins[i - 1]).toFixed(3) });
const maxRatio = ratios.reduce((m, r) => (r.ratio > m.ratio ? r : m), { i: -1, ratio: 0 });
const ratioFails = ratios.filter((r) => r.ratio > RATIO_MAX);
const lateCycles = cycles.filter((c) => c.n >= 5);
const empty = lateCycles.filter((c) => c.newItems.length === 0).map((c) => c.n);
const dips = cycles.filter((c) => c.minHappy !== null && c.minHappy < 1).length;
const midDips = cycles.filter((c) => c.minHappyMid !== null && c.minHappyMid < 1).length;
const never = {
  buildings: registry.buildingOrder.filter((id) => !everBought.has('b:' + id)),
  upgrades: registry.upgradeOrder.filter((id) => !everBought.has('u:' + id)),
};
const underHours = underByHour.map((u, i) => (ticksByHour[i] ? +((u / ticksByHour[i]) * 100).toFixed(1) : 0));
const underShare = underByHour.reduce((a, b) => a + b, 0) / TICKS;
const legacy = state.prestige.legacy;
const report = {
  profile: SAVE > 0 ? `saver ${SAVE}s` : 'default',
  sets,
  foundings: cycles.length,
  firstFoundMin,
  cycles: mins,
  lastCycle: mins[mins.length - 1] ?? null,
  maxRatio,
  ratioFails,
  emptyLate: empty,
  reachShare: +(reachHits / Math.max(1, samples)).toFixed(3),
  noReachShare: +(noReach / Math.max(1, samples)).toFixed(3),
  underShare: +underShare.toFixed(4),
  underHours,
  minRatio: +minRatio.toFixed(3),
  dips,
  midDips,
  legacy,
  legacySpent: state.prestige.spent || 0,
  maxMoney,
  never,
  errors: game.errors.length,
  perCycle: cycles,
  rungBuys,
};
if (JSON_OUT) fs.writeFileSync(path.resolve(ROOT, JSON_OUT), JSON.stringify(report, null, 2));

const pass = ratioFails.length === 0 && empty.length === 0 && maxMoney <= 1e18 && legacy <= 1e6 && game.errors.length === 0 && !never.buildings.length && !never.upgrades.length;
console.log(`[probe] ${report.profile} ${sets.length ? sets.join(' ') : '(shipped config)'}`);
console.log(`[probe] foundings=${cycles.length} first=${firstFoundMin} min last=${report.lastCycle} legacy=${legacy} money=${maxMoney.toExponential(2)} errors=${game.errors.length} ${pass ? 'OK' : 'FAIL'}`);
console.log(`[probe] cycles: ${mins.map((m) => m.toFixed(1)).join(' ')}`);
console.log(`[probe] max ratio x${maxRatio.ratio} at cycle ${maxRatio.i} (${mins[maxRatio.i - 1]} -> ${mins[maxRatio.i]}); over ${RATIO_MAX}: ${ratioFails.map((r) => `${r.i}:x${r.ratio}`).join(' ') || 'none'}; over 1.30: ${ratios.filter((r) => r.ratio > 1.3).map((r) => `${r.i}:x${r.ratio}`).join(' ') || 'none'}`);
console.log(`[probe] emptyLate=[${empty.join(',')}] reach=${(report.reachShare * 100).toFixed(0)}% noReach=${(report.noReachShare * 100).toFixed(0)}% under=${(underShare * 100).toFixed(1)}% byHour=[${underHours.join(' ')}] floor=${minRatio.toFixed(2)} dips=${dips}/${cycles.length} midDips=${midDips}/${cycles.length}`);
if (never.buildings.length || never.upgrades.length) console.log(`[probe] never bought: ${[...never.buildings, ...never.upgrades].join(', ')}`);
console.log(`[probe] rungs: ${rungBuys.map((r) => `${r.id}@${r.city}(${r.runMin})`).join(' ')}`);
if (trace.length) console.log(`[probe] city ${TRACE} cash/income by 10 s: ${trace.join(' ')}`);
if (args.includes('--cities')) for (const c of cycles) console.log(`  city ${String(c.n).padStart(2)}  ${String(c.minutes.toFixed(1)).padStart(5)} min  legacy ${String(c.legacy).padStart(6)}  earned ${c.earned.toExponential(2)}  income ${c.endIncome.toExponential(2)}  spree ${c.spree.toExponential(2)}@${c.spreeMin}  plateau ${c.plateau.toExponential(2)}@${c.plateauMin}  ${c.newItems.filter(() => c.n > 2).join('+') || (c.n > 2 ? '-' : c.newItems.length)}`);
console.log(`[probe] items: ${cycles.map((c) => `${c.n}:${c.newItems.length ? c.newItems.filter((id) => c.n > 2).join('+') || c.newItems.length : '-'}`).join(' ')}`);
process.exit(pass ? 0 : 1);
