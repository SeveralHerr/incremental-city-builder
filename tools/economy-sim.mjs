// Node-only accelerated economy simulation (no DOM). Plays the greedy bot for a long
// game (default 6 game-hours = 216,000 ticks) with prestige, detects stalls/bottlenecks/overflow,
// and reports the late-game contract metrics from docs/DESIGN.md "Late game contract".
// node tools/economy-sim.mjs [--ticks 216000] [--out logs/sim.json] [--sample 600]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const TICKS = Number(opt('--ticks', 216000));
const SAMPLE = Number(opt('--sample', 600)); // every 60 game-seconds
const OUT = path.resolve(ROOT, opt('--out', 'logs/sim.json'));
const BOT_EVERY = 20;

const { boot, game } = await import(path.join(ROOT, 'src/boot.js').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
await boot();
const { state, derived, api, registry } = game;

const samples = [];
const issues = [];
const purchases = []; // {tick, kind, id}
const everBought = new Set(); // 'b:id' / 'u:id' first-time purchases across the whole session
const cycles = []; // per founding: { n, startMin, endMin, minutes, legacyAfter, gain, peakIncome, minHappiness, newItems, brownoutSamples }
let cur = { n: 0, startMin: 0, peakIncome: 0, minHappiness: Infinity, newItems: [], brownoutTicks: 0, ticks: 0 };

function noteFirst(key, id) {
  if (everBought.has(key)) return;
  everBought.add(key);
  cur.newItems.push(id);
}
game.events.on('buy', (e) => {
  purchases.push({ tick: state.tick, kind: 'b', id: e.id });
  noteFirst('b:' + e.id, e.id);
});
game.events.on('upgrade', (e) => {
  purchases.push({ tick: state.tick, kind: 'u', id: e.id, currency: e.currency });
  noteFirst('u:' + e.id, e.id);
});
// resetState() has already zeroed state.tick when 'prestige' fires; playtime survives the reset.
game.events.on('prestige', (e) => {
  const nowMin = state.stats.playtime / 60;
  purchases.push({ tick: Math.round(state.stats.playtime * 10), kind: 'p', legacy: state.prestige.legacy });
  cycles.push({
    n: cur.n,
    startMin: +cur.startMin.toFixed(2),
    endMin: +nowMin.toFixed(2),
    minutes: +(nowMin - cur.startMin).toFixed(2),
    legacyAfter: state.prestige.legacy,
    gain: e && Number.isFinite(e.gain) ? e.gain : null,
    peakIncome: cur.peakIncome,
    minHappiness: cur.minHappiness === Infinity ? null : +cur.minHappiness.toFixed(3),
    brownoutShare: cur.ticks ? +(cur.brownoutTicks / cur.ticks).toFixed(3) : 0,
    newItems: cur.newItems,
  });
  cur = { n: cur.n + 1, startMin: nowMin, peakIncome: 0, minHappiness: Infinity, newItems: [], brownoutTicks: 0, ticks: 0 };
});

let lastBuyTick = 0;
let stallStart = -1;
let brownoutTicks = 0; // ratio < 0.9
let underPowerTicks = 0; // ratio < 1
let minRatio = 1;
let bestIncome = 0;
let maxMoney = 0;
let tensionHits = 0; // samples where the priciest unlocked, unowned money item sits at 3–50× cash
let tensionNextHits = 0; // samples where the cheapest unlocked, unowned money item above cash sits at 3–50× cash
const t0 = Date.now();

// The money-priced frontier: the priciest unlocked, unowned item (upgrade or next building
// unit) and the cheapest one priced above the current cash.
function frontierPrices(cash) {
  let max = 0;
  let next = Infinity;
  for (const u of api.upgrades()) {
    if (!u.unlocked || u.owned || u.currency === 'legacy') continue;
    if (u.cost > max) max = u.cost;
    if (u.cost > cash && u.cost < next) next = u.cost;
  }
  for (const b of api.buildings()) {
    if (!b.unlocked) continue;
    if (b.cost > max) max = b.cost;
    if (b.cost > cash && b.cost < next) next = b.cost;
  }
  return { max, next: Number.isFinite(next) ? next : 0 };
}

for (let t = 0; t < TICKS; t += BOT_EVERY) {
  const before = purchases.length;
  game.botStep();
  if (purchases.length > before) lastBuyTick = state.tick;
  const n = Math.min(BOT_EVERY, TICKS - t);
  game.step(n);

  cur.ticks += n;
  if (derived.powerRatio < 0.9) brownoutTicks += n;
  if (derived.powerRatio < 1) {
    underPowerTicks += n;
    cur.brownoutTicks += n;
  }
  if (derived.powerRatio < minRatio) minRatio = derived.powerRatio;
  if (derived.income > bestIncome) bestIncome = derived.income;
  if (derived.income > cur.peakIncome) cur.peakIncome = derived.income;
  if (derived.happiness < cur.minHappiness) cur.minHappiness = derived.happiness;
  if (state.res.money > maxMoney) maxMoney = state.res.money;

  if (state.tick % SAMPLE < BOT_EVERY) {
    const bcount = Object.values(state.buildings).reduce((a, b) => a + b, 0);
    const { max: big, next } = frontierPrices(state.res.money);
    const ratio = state.res.money > 0 ? big / state.res.money : Infinity;
    const nextRatio = state.res.money > 0 && next > 0 ? next / state.res.money : Infinity;
    if (ratio >= 3 && ratio <= 50) tensionHits++;
    if (nextRatio >= 3 && nextRatio <= 50) tensionNextHits++;
    samples.push({
      tick: state.tick,
      min: +(state.stats.playtime / 60).toFixed(1),
      runMin: +(state.time / 60).toFixed(1),
      money: state.res.money,
      pop: state.res.pop,
      income: derived.income,
      housing: derived.housing,
      jobs: derived.jobs,
      powerRatio: +derived.powerRatio.toFixed(3),
      happiness: +derived.happiness.toFixed(3),
      buildings: bcount,
      upgrades: Object.keys(state.upgrades).length,
      legacy: state.prestige.legacy,
      legacySpent: state.prestige.spent || 0,
      prestiges: state.stats.prestiges,
      nextBig: big,
      nextStep: next,
      tension: Number.isFinite(ratio) ? +ratio.toFixed(2) : null,
      tensionNext: Number.isFinite(nextRatio) ? +nextRatio.toFixed(2) : null,
    });
    for (const [k, v] of Object.entries(state.res)) {
      if (!Number.isFinite(v)) issues.push({ tick: state.tick, kind: 'overflow', msg: `${k} is ${v}` });
    }
    if (!Number.isFinite(derived.income)) issues.push({ tick: state.tick, kind: 'overflow', msg: 'income non-finite' });
    if (!Number.isFinite(state.prestige.legacy)) issues.push({ tick: state.tick, kind: 'overflow', msg: 'legacy non-finite' });
  }

  // Stall: > 20 game-minutes without any purchase while nothing affordable.
  const sinceBuy = state.tick - lastBuyTick;
  if (sinceBuy > 12000 && stallStart < 0) {
    stallStart = state.tick;
    issues.push({ tick: state.tick, kind: 'stall', msg: `no purchase for ${(sinceBuy / 600).toFixed(0)} min; money=${state.res.money.toFixed(0)} income=${derived.income.toFixed(2)}/s` });
  }
  if (sinceBuy <= 12000) stallStart = -1;
}

const wallMs = Date.now() - t0;
const last = samples[samples.length - 1] || {};
const hours = TICKS / 36000;

// ---- contract checks (see docs/DESIGN.md "Late game contract") ----
if (brownoutTicks > TICKS * 0.25) issues.push({ tick: state.tick, kind: 'bottleneck', msg: `brownout (<0.9) for ${((brownoutTicks / TICKS) * 100).toFixed(0)}% of run` });
if (state.stats.prestiges === 0 && TICKS >= 100000) issues.push({ tick: state.tick, kind: 'pacing', msg: 'no prestige reached in run' });
if (maxMoney > 1e18 || state.prestige.legacy > 1e6) issues.push({ tick: state.tick, kind: 'magnitude', msg: `money peak ${maxMoney.toExponential(2)}, legacy ${state.prestige.legacy} (contract: ≤1e18 / ≤1e6 at 12h)` });
for (let i = 1; i < cycles.length; i++) {
  const a = cycles[i - 1], b = cycles[i];
  if (i >= 5 && b.minutes > a.minutes * 1.35 + 0.5) issues.push({ tick: 0, kind: 'cadence', msg: `cycle ${b.n} (${b.minutes} min) > 1.35× cycle ${a.n} (${a.minutes} min)` });
}
const lateCycles = cycles.filter((c) => c.n >= 5);
const emptyCycles = lateCycles.filter((c) => c.newItems.length === 0);
if (emptyCycles.length) issues.push({ tick: 0, kind: 'variety', msg: `${emptyCycles.length}/${lateCycles.length} cycles after the 5th introduced nothing new (first: cycle ${emptyCycles[0].n})` });
if (cycles.length && cycles[cycles.length - 1].minutes > 40 && hours >= 12) issues.push({ tick: 0, kind: 'cadence', msg: `last cycle ${cycles[cycles.length - 1].minutes} min > 40 min` });
const tensionShare = samples.length ? tensionHits / samples.length : 0;
if (hours >= 6 && tensionShare < 0.3) issues.push({ tick: 0, kind: 'tension', msg: `next big purchase sits at 3–50× cash in only ${(tensionShare * 100).toFixed(0)}% of samples (contract ≥ 30%)` });
const underPowerShare = underPowerTicks / TICKS;
if (hours >= 6 && (underPowerShare < 0.03 || underPowerShare > 0.2)) issues.push({ tick: 0, kind: 'power', msg: `under-power share ${(underPowerShare * 100).toFixed(1)}% (contract 3–20%)` });
if (minRatio < 0.6) issues.push({ tick: 0, kind: 'power', msg: `power ratio floor ${minRatio.toFixed(2)} < 0.6` });
const happyDips = cycles.filter((c) => c.minHappiness !== null && c.minHappiness < 1).length;
if (hours >= 6 && cycles.length >= 4 && happyDips < cycles.length * 0.5) issues.push({ tick: 0, kind: 'happiness', msg: `happiness dipped below 1.0 in only ${happyDips}/${cycles.length} cities (contract ≥ 50%)` });
// Income should grow roughly 10x per game-hour early on; flag flat stretches within the
// first city. Later cities are excluded on purpose: a replay re-buys its whole ladder in the
// first three minutes and then earns its way toward the next founding on a near-flat income,
// which is the cadence contract's 15–45 minute plateau, not a stall (stalls are caught above).
for (let i = 10; i < samples.length; i++) {
  const a = samples[i - 10], b = samples[i];
  if (b.prestiges !== 0) break;
  if (b.prestiges === a.prestiges && b.income > 0 && b.income / Math.max(a.income, 1e-9) < 1.05 && b.min - a.min >= 10) {
    issues.push({ tick: b.tick, kind: 'flat', msg: `income grew <5% over 10 min (${a.income.toExponential(2)} -> ${b.income.toExponential(2)})` });
    i += 10;
  }
}

const neverPurchased = {
  buildings: registry.buildingOrder.filter((id) => !everBought.has('b:' + id)),
  upgrades: registry.upgradeOrder.filter((id) => !everBought.has('u:' + id)),
};
if (hours >= 12 && (neverPurchased.buildings.length || neverPurchased.upgrades.length)) {
  issues.push({ tick: 0, kind: 'content', msg: `never purchased in ${hours}h: ${[...neverPurchased.buildings, ...neverPurchased.upgrades].join(', ')}` });
}

const HARD = new Set(['overflow', 'stall', 'magnitude']);
const report = {
  ticks: TICKS,
  gameHours: +hours.toFixed(2),
  wallMs,
  ticksPerSec: Math.round(TICKS / (wallMs / 1000)),
  modules: game.modules,
  errors: game.errors.slice(),
  final: {
    money: state.res.money,
    maxMoney,
    pop: state.res.pop,
    income: derived.income,
    bestIncome,
    buildings: state.buildings,
    upgrades: Object.keys(state.upgrades),
    legacy: state.prestige.legacy,
    legacySpent: state.prestige.spent || 0,
    prestiges: state.stats.prestiges,
    totalEarned: state.stats.totalEarned,
  },
  metrics: {
    cycles: cycles.map((c) => c.minutes),
    tensionShare: +tensionShare.toFixed(3),
    tensionNextShare: +(samples.length ? tensionNextHits / samples.length : 0).toFixed(3),
    underPowerShare: +underPowerShare.toFixed(4),
    brownoutShare: +(brownoutTicks / TICKS).toFixed(4),
    minPowerRatio: +minRatio.toFixed(3),
    happinessDipCities: happyDips,
    emptyLateCycles: emptyCycles.map((c) => c.n),
    neverPurchased,
  },
  cycles,
  issues,
  purchases: purchases.length,
  firstPurchases: purchases.slice(0, 40),
  prestigeTicks: purchases.filter((p) => p.kind === 'p').map((p) => p.tick),
  samples,
};
report.pass = issues.filter((i) => HARD.has(i.kind)).length === 0 && report.errors.length === 0;
report.contractPass = issues.length === 0 && report.errors.length === 0;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(
  `[sim] ${report.pass ? 'PASS' : 'FAIL'} (contract ${report.contractPass ? 'PASS' : 'FAIL'}) ${report.gameHours}h game in ${wallMs}ms (${report.ticksPerSec} t/s) money=${(last.money ?? 0).toExponential(2)} income=${(last.income ?? 0).toExponential(2)}/s pop=${Math.round(
    last.pop ?? 0
  )} prestiges=${state.stats.prestiges} legacy=${state.prestige.legacy} (spent ${state.prestige.spent || 0}) issues=${issues.length} errors=${report.errors.length}`
);
console.log(`[sim] cycles(min): ${report.metrics.cycles.map((m) => m.toFixed(1)).join(' ')}`);
console.log(`[sim] tension=${(tensionShare * 100).toFixed(0)}% (next-step ${(report.metrics.tensionNextShare * 100).toFixed(0)}%) underPower=${(underPowerShare * 100).toFixed(1)}% minRatio=${minRatio.toFixed(2)} happyDips=${happyDips}/${cycles.length} emptyLate=${emptyCycles.length}`);
for (const i of issues.slice(0, 14)) console.log(`  - [${i.kind}] t=${i.tick} ${i.msg}`);
console.log(`[sim] wrote ${OUT}`);
process.exit(report.pass ? 0 : 1);
