// First-city cadence probe for the building catalogue. DOM-free, Node only.
//   node src/buildings/cadence.mjs [--ticks 30000] [--json]
// Boots the game, plays the greedy bot through the first city (stops at the first
// founding or after --ticks), and prints, per building: the resolved gate, when the card
// opened, when the first unit was bought, and the lag between the two — the numbers the
// "Unlock spacing" note in data.js is held to. Also flags any two cards that open within
// 60 s of each other and any card that glows unaffordable for more than 5 minutes. Both
// rules start at minute 5: the opening minutes deal tier-1 cards every few seconds on
// purpose (shop, park, apartment, factory), and that is the tutorial, not a cadence fault.
// Exit code 1 when either rule is broken, so it can gate a balance change.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const TICKS = Number(opt('--ticks', 30000));
const JSON_OUT = args.includes('--json');
const BOT_EVERY = 20;
const SPACING_S = 60;
const LAG_S = 300;
const RULES_FROM_S = 300; // the opening minutes are exempt (see header)

const { boot, game } = await import(path.join(ROOT, 'src/boot.js').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
await boot();
const { state, derived, registry, events } = game;

const rows = new Map(); // id -> { id, gate, unlockS, buyS }
for (const id of registry.buildingOrder) {
  const d = registry.buildings.get(id);
  const at = d.unlockAt || {};
  const gate = !d.unlock
    ? 'start'
    : Number.isFinite(at.pop)
      ? `pop ${at.pop.toLocaleString('en-US')}${Number.isFinite(at.legacy) ? ' | legacy ' + at.legacy : ''}`
      : Number.isFinite(at.powerDemand)
        ? `demand ${at.powerDemand >= 1 ? at.powerDemand + ' MW' : '> 0'}`
        : '?';
  rows.set(id, { id, tier: d.tier, gate, unlockS: null, buyS: null });
}
const sec = () => state.time;
events.on('unlock', (e) => {
  if (e?.kind !== 'building') return;
  const r = rows.get(e.id);
  if (r && r.unlockS === null) r.unlockS = sec();
});
events.on('buy', (e) => {
  const r = rows.get(e?.id);
  if (r && r.buyS === null) r.buyS = sec();
});
let founded = false;
events.on('prestige', () => {
  founded = true;
});

for (let t = 0; t < TICKS && !founded; t += BOT_EVERY) {
  game.botStep();
  if (founded) break;
  game.step(Math.min(BOT_EVERY, TICKS - t));
}
const endS = founded ? state.stats.playtime : sec();

const list = [...rows.values()].sort((a, b) => (a.unlockS ?? Infinity) - (b.unlockS ?? Infinity));
const m = (s) => (s === null ? '   —  ' : (s / 60).toFixed(1).padStart(6));
const problems = [];
for (let i = 1; i < list.length; i++) {
  const a = list[i - 1], b = list[i];
  if (a.unlockS !== null && b.unlockS !== null && a.unlockS >= RULES_FROM_S && b.unlockS - a.unlockS < SPACING_S) {
    problems.push(`${a.id} and ${b.id} open ${(b.unlockS - a.unlockS).toFixed(0)} s apart (${(a.unlockS / 60).toFixed(1)} min)`);
  }
}
for (const r of list) {
  if (r.unlockS !== null && r.unlockS >= RULES_FROM_S && r.buyS !== null && r.buyS - r.unlockS > LAG_S) {
    problems.push(`${r.id} glows unaffordable for ${((r.buyS - r.unlockS) / 60).toFixed(1)} min (open ${(r.unlockS / 60).toFixed(1)} → bought ${(r.buyS / 60).toFixed(1)})`);
  }
  if (r.unlockS !== null && r.buyS === null) problems.push(`${r.id} opens at ${(r.unlockS / 60).toFixed(1)} min but is never bought in the first city`);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ endMin: +(endS / 60).toFixed(2), founded, buildings: list, problems, errors: game.errors }, null, 1));
} else {
  console.log(`first city: ${(endS / 60).toFixed(1)} min${founded ? ' (founded)' : ' (cut off)'}, errors ${game.errors.length}`);
  console.log('building     tier  gate               open   bought   lag (min)');
  for (const r of list) {
    const lag = r.unlockS !== null && r.buyS !== null ? ((r.buyS - r.unlockS) / 60).toFixed(1).padStart(6) : '   —  ';
    console.log(`${r.id.padEnd(12)} ${String(r.tier).padStart(3)}   ${r.gate.padEnd(18)}${m(r.unlockS)}  ${m(r.buyS)}  ${lag}`);
  }
  console.log(problems.length ? 'problems:\n  ' + problems.join('\n  ') : 'no spacing or affordability problems');
}
process.exit(problems.length || game.errors.length ? 1 : 0);
