// Node-only accelerated economy simulation (no DOM). Plays the greedy bot for a long
// game (default 6 game-hours = 216,000 ticks) with prestige, detects stalls/bottlenecks/overflow.
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
const { state, derived, api } = game;

const samples = [];
const issues = [];
const purchases = []; // {tick, kind, id}
game.events.on('buy', (e) => purchases.push({ tick: state.tick, kind: 'b', id: e.id }));
game.events.on('upgrade', (e) => purchases.push({ tick: state.tick, kind: 'u', id: e.id }));
// resetState() has already zeroed state.tick when 'prestige' fires; playtime survives the reset.
game.events.on('prestige', (e) => purchases.push({ tick: Math.round(state.stats.playtime * 10), kind: 'p', legacy: state.prestige.legacy }));

let lastBuyTick = 0;
let stallStart = -1;
let brownoutTicks = 0;
let bestIncome = 0;
const t0 = Date.now();

for (let t = 0; t < TICKS; t += BOT_EVERY) {
  const before = purchases.length;
  game.botStep();
  if (purchases.length > before) lastBuyTick = state.tick;
  game.step(Math.min(BOT_EVERY, TICKS - t));

  if (derived.powerRatio < 0.9) brownoutTicks += BOT_EVERY;
  if (derived.income > bestIncome) bestIncome = derived.income;

  if (state.tick % SAMPLE < BOT_EVERY) {
    const bcount = Object.values(state.buildings).reduce((a, b) => a + b, 0);
    samples.push({
      tick: state.tick,
      min: +(state.time / 60).toFixed(1),
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
      prestiges: state.stats.prestiges,
    });
    for (const [k, v] of Object.entries(state.res)) {
      if (!Number.isFinite(v)) issues.push({ tick: state.tick, kind: 'overflow', msg: `${k} is ${v}` });
    }
    if (!Number.isFinite(derived.income)) issues.push({ tick: state.tick, kind: 'overflow', msg: 'income non-finite' });
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
if (brownoutTicks > TICKS * 0.25) issues.push({ tick: state.tick, kind: 'bottleneck', msg: `brownout for ${((brownoutTicks / TICKS) * 100).toFixed(0)}% of run` });
if (state.stats.prestiges === 0 && TICKS >= 100000) issues.push({ tick: state.tick, kind: 'pacing', msg: 'no prestige reached in run' });
// Income should grow roughly 10x per game-hour early on; flag flat stretches.
for (let i = 10; i < samples.length; i++) {
  const a = samples[i - 10], b = samples[i];
  if (b.prestiges === a.prestiges && b.income > 0 && b.income / Math.max(a.income, 1e-9) < 1.05 && b.min - a.min >= 10) {
    issues.push({ tick: b.tick, kind: 'flat', msg: `income grew <5% over 10 min (${a.income.toFixed(2)} -> ${b.income.toFixed(2)})` });
    i += 10;
  }
}

const report = {
  ticks: TICKS,
  gameHours: +(TICKS / 36000).toFixed(2),
  wallMs,
  ticksPerSec: Math.round(TICKS / (wallMs / 1000)),
  modules: game.modules,
  errors: game.errors.slice(),
  final: {
    money: state.res.money,
    pop: state.res.pop,
    income: derived.income,
    bestIncome,
    buildings: state.buildings,
    upgrades: Object.keys(state.upgrades),
    legacy: state.prestige.legacy,
    prestiges: state.stats.prestiges,
    totalEarned: state.stats.totalEarned,
  },
  issues,
  purchases: purchases.length,
  firstPurchases: purchases.slice(0, 40),
  prestigeTicks: purchases.filter((p) => p.kind === 'p').map((p) => p.tick),
  samples,
};
report.pass = issues.filter((i) => i.kind === 'overflow' || i.kind === 'stall').length === 0 && report.errors.length === 0;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(
  `[sim] ${report.pass ? 'PASS' : 'FAIL'} ${report.gameHours}h game in ${wallMs}ms (${report.ticksPerSec} t/s) money=${Math.round(
    last.money ?? 0
  )} income=${(last.income ?? 0).toFixed(1)}/s pop=${Math.round(last.pop ?? 0)} prestiges=${state.stats.prestiges} legacy=${state.prestige.legacy} issues=${issues.length} errors=${report.errors.length}`
);
for (const i of issues.slice(0, 12)) console.log(`  - [${i.kind}] t=${i.tick} ${i.msg}`);
console.log(`[sim] wrote ${OUT}`);
process.exit(report.pass ? 0 : 1);
