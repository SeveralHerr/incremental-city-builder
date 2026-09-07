// Ladder placement helper. DOM-free, Node only:
//   node src/balance/place.mjs --plan plan.json [--base "--set a=b --set c=d"] [--save N] [--out prices.json]
// Reads a plan — an ordered list of `{ id, city, mode }` where `city` is the founding
// count the rung should be bought in (city 1 is the first replay) and `mode` is `spree`
// (bought in the city's opening spree, the first four minutes) or `mid` (bought off
// plateau cash after the spree) — and prices the rungs one at a time in city order:
// each round runs src/balance/probe.mjs with every price placed so far, reads the reach of
// the target city and the city before it (peak cash in the spree / on the plateau), sets
// the price at the geometric mean of the window it must fall in, and re-runs to confirm
// the rung landed where the plan says. A rung that lands a city early or late is nudged
// toward the other edge of its window (up to four tries); a rung whose window is empty
// (the city before already reaches everything this city does) is reported as unplaceable.
// The result is a `--set` list for the probe plus a JSON file of `{ id: price }` so the
// numbers can be copied into config.upgrades. Earlier cities do not depend on later
// prices (the greedy bot never saves toward a rung it cannot afford), so one pass suffices.
// `--save N` places against the saver profile instead (the probe's `--save N`: a bot that
// saves toward a rung within N seconds of income; the sim's `--saver` is N = 30). Its reach
// table is not the default bot's — see config.js, "Why the saver profiles have empty
// cities" — so a ladder placed for one profile has to be checked against the other with
// `probe.mjs` before it ships; `--base` is passed to the probe verbatim (any probe flag,
// e.g. `--boost` / `--frontier-gate` what-ifs, may ride along).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const PLAN = JSON.parse(fs.readFileSync(path.resolve(ROOT, opt('--plan', 'src/balance/plan.json')), 'utf-8'));
const BASE = (opt('--base', '') || '').split(/\s+/).filter(Boolean);
const OUT = opt('--out', '');
const TICKS = Number(opt('--ticks', 432000));
const SAVE = Number(opt('--save', 0));

// Every planned rung starts parked out of reach (a frontier rung this dear never opens, a
// pace rung never unlocks, a Legacy rung is never affordable), so the reach tables the
// first placements read are not shaped by a rung's shipped price landing somewhere else.
const PARK = 1e30;
const prices = Object.fromEntries(PLAN.map((s) => [s.id, PARK]));
const round1 = (v) => Number(v.toPrecision(3));

function run(extra = []) {
  const sets = [...BASE];
  if (SAVE > 0) sets.push('--save', String(SAVE));
  for (const [id, p] of Object.entries(prices)) sets.push('--set', `upgrades.${id}.cost=${p}`);
  const tmp = path.join(HERE, '.place-run.json');
  const r = spawnSync(process.execPath, [path.join(HERE, 'probe.mjs'), '--ticks', String(TICKS), '--json', path.relative(ROOT, tmp), ...sets, ...extra], { cwd: ROOT, encoding: 'utf-8', timeout: 600000 });
  if (!fs.existsSync(tmp)) throw new Error(`probe produced no JSON: ${r.stderr.slice(0, 500)}`);
  const report = JSON.parse(fs.readFileSync(tmp, 'utf-8'));
  fs.unlinkSync(tmp);
  return report;
}

const reach = (c) => (c ? Math.max(c.spree || 0, c.plateau || 0) : 0);
const cityOf = (report, id) => report.rungBuys.find((r) => r.id === id)?.city ?? null;
const minuteOf = (report, id) => report.rungBuys.find((r) => r.id === id)?.runMin ?? null;

let report = run();
console.log(`[place] base: ${report.foundings} foundings, cycles ${report.cycles.map((m) => m.toFixed(1)).join(' ')}`);
for (const step of PLAN) {
  const { id, city, mode = 'spree' } = step;
  let lo = 0;
  let hi = 0;
  let placed = false;
  for (let attempt = 0; attempt < 4 && !placed; attempt++) {
    const prev = report.perCycle[city - 1];
    const cur = report.perCycle[city];
    if (!cur) {
      console.log(`[place] ${id}: city ${city} not reached in this session (${report.foundings} foundings) — skipped`);
      break;
    }
    if (attempt === 0) {
      const before = reach(prev);
      const windows = mode === 'mid'
        ? [['mid', Math.max(before, cur.spree), cur.plateau], ['spree', before, cur.spree]]
        : [['spree', before, cur.spree], ['mid', Math.max(before, cur.spree), cur.plateau]];
      const w = windows.find(([, a, b]) => b > a * 1.02);
      if (!w) {
        console.log(`[place] ${id}: unplaceable in city ${city} (reach before ${before.toExponential(2)}, spree ${cur.spree.toExponential(2)}, plateau ${cur.plateau.toExponential(2)})`);
        break;
      }
      if (w[0] !== mode) console.log(`[place] ${id}: no ${mode} window in city ${city}, using the ${w[0]} window`);
      lo = w[1];
      hi = w[2];
    }
    prices[id] = round1(Math.sqrt(lo * hi));
    report = run();
    const landed = cityOf(report, id);
    const min = minuteOf(report, id);
    console.log(`[place] ${id} @ ${prices[id].toExponential(2)} (window ${lo.toExponential(2)}–${hi.toExponential(2)}) → city ${landed} at ${min} min; cycles ${report.cycles.map((m) => m.toFixed(1)).join(' ')}`);
    if (landed === city) placed = true;
    else if (landed === null || landed > city) hi = prices[id]; // too dear: come down
    else lo = prices[id]; // too cheap (bought early, or in the spree when mid was asked)
  }
}
for (const [id, p] of Object.entries(prices)) if (p === PARK) console.log(`[place] ${id} left parked (unplaced)`);
console.log(`[place] result: ${Object.entries(prices).map(([id, p]) => `${id}=${p.toExponential(2)}`).join(' ')}`);
console.log(`[place] sets: ${Object.entries(prices).map(([id, p]) => `--set upgrades.${id}.cost=${p}`).join(' ')}`);
console.log(`[place] final: foundings=${report.foundings} maxRatio=${report.maxRatio.ratio}@${report.maxRatio.i} fails=${report.ratioFails.map((r) => `${r.i}:x${r.ratio}`).join(' ') || 'none'} emptyLate=[${report.emptyLate.join(',')}] legacy=${report.legacy} money=${report.maxMoney.toExponential(2)}`);
if (OUT) fs.writeFileSync(path.resolve(ROOT, OUT), JSON.stringify(prices, null, 2));
