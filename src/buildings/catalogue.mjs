// Prints the *shipped* building catalogue: every definition as the game registers it
// (data.js defaults + config.buildings overrides + tier cost growth), one row per building,
// with the data.js default shown next to any field config re-pins. DOM-free, Node only.
//   node src/buildings/catalogue.mjs [--json]
// Use this, not the numbers in data.js, when quoting what the game ships.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const JSON_OUT = process.argv.includes('--json');
const toUrl = (p) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:');

const { boot, game } = await import(toUrl(path.join(ROOT, 'src/boot.js')));
await boot();
const { BUILDINGS } = await import('./data.js');
const { registry } = game;

const FIELDS = ['baseCost', 'costGrowth', 'housing', 'jobs', 'income', 'powerGen', 'powerUse', 'upkeep', 'happiness'];
const gateOf = (d) => {
  const at = d?.unlockAt || {};
  if (!d?.unlock) return 'start';
  if (Number.isFinite(at.pop)) return `pop ${at.pop}${Number.isFinite(at.legacy) ? ` | legacy ${at.legacy}` : ''}`;
  if (Number.isFinite(at.powerDemand)) return at.powerDemand >= 1 ? `demand ${at.powerDemand} MW` : 'demand > 0';
  if (Number.isFinite(at.legacy)) return `legacy ${at.legacy}`;
  return '?';
};
const num = (v) => (v === undefined || v === 0 ? '' : Math.abs(v) >= 1e5 ? v.toExponential(2).replace('e+', 'e') : String(+v.toFixed(3)));

const rows = [];
for (const id of registry.buildingOrder) {
  const shipped = registry.buildings.get(id);
  const def = BUILDINGS.find((b) => b.id === id);
  if (!shipped || !def) continue;
  const row = { id, tier: shipped.tier, category: shipped.category, gate: gateOf(shipped), defaultGate: gateOf(def), overridden: [] };
  for (const f of FIELDS) {
    const base = game.buildings?.baseStat ? game.buildings.baseStat(id, f) : shipped[f];
    row[f] = base;
    const d = def[f];
    if (d !== undefined && base !== undefined && d !== base) {
      row.overridden.push(f);
      row['default_' + f] = d;
    }
  }
  if (row.gate !== row.defaultGate) row.overridden.push('unlock');
  if (shipped.synergy) row.synergy = shipped.synergy.text;
  if (shipped.demandGrowth) row.demandGrowth = shipped.demandGrowth.text;
  rows.push(row);
}

if (JSON_OUT) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  const cell = (v, w) => String(v ?? '').padStart(w);
  console.log('shipped catalogue (data.js default in brackets where config.buildings re-pins a field)');
  console.log('building     t  gate                     baseCost growth   housing     jobs   income powerGen powerUse upkeep    joy');
  for (const r of rows) {
    const f = (k, w) => cell(num(r[k]) + (r.overridden.includes(k) ? ` [${num(r['default_' + k])}]` : ''), w);
    const gate = r.gate + (r.overridden.includes('unlock') ? ` [${r.defaultGate}]` : '');
    console.log(`${r.id.padEnd(12)} ${r.tier}  ${gate.padEnd(24)} ${f('baseCost', 14)} ${f('costGrowth', 6)} ${f('housing', 11)} ${f('jobs', 8)} ${f('income', 8)} ${f('powerGen', 8)} ${f('powerUse', 14)} ${f('upkeep', 12)} ${f('happiness', 6)}`);
    if (r.synergy) console.log(`             ${r.synergy}`);
    if (r.demandGrowth) console.log(`             ${r.demandGrowth}`);
  }
  const n = rows.filter((r) => r.overridden.length).length;
  console.log(`${rows.length} buildings, ${n} with a config override; errors ${game.errors.length}`);
}
process.exit(game.errors.length ? 1 : 0);
