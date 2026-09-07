// First-city cadence probe for the building catalogue. DOM-free, Node only.
//   node src/buildings/cadence.mjs [--ticks 30000] [--json]
// Boots the game, plays the greedy bot through the first city (stops at the first
// founding or after --ticks), and prints, per building: the resolved gate, when the card
// opened, when the first unit was bought, and the lag between the two. Three rules, all
// measured from minute 5 on (the opening minutes deal tier-1 cards every few seconds on
// purpose — shop, park, apartment, factory — and that is the tutorial, not a cadence fault):
//   spacing   no two cards open within 90 s of each other;
//   lag       a card is bought within 5 min of opening (4 min for a tier-4 card);
//   dead air  no stretch of 7 min without a new card, including the tail before the founding.
// Exit code 1 when a rule is broken, so it gates a change to either the catalogue or
// `config.buildings`. Each fault names its owner: `buildings` when a field this folder
// owns (a gate in data.js, a base cost not overridden) can fix it, `config` when every
// field involved is pinned by `config.buildings[id]` — the buildings module cannot move
// those, and buildings.test.mjs holds this folder to the buildings-owned faults only.
// Every fault also ends in `fix: <field>` naming the exact field(s) that can move it
// (`config.buildings.nuclear.unlock`, `data.js solar.unlock`, …), so the owning folder
// can act on the line without re-deriving who pins what.
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
export const SPACING_S = 90;
export const LAG_S = 300;
export const LAG_T4_S = 240;
export const GAP_S = 420;
const RULES_FROM_S = 300; // the opening minutes are exempt (see header)

const toUrl = (p) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:');
const { boot, game } = await import(toUrl(path.join(ROOT, 'src/boot.js')));
await boot();
const { state, derived, registry, events } = game;

// Which folder owns a building's gate and base cost: `config` when config.buildings[id]
// overrides the field, `buildings` otherwise. Read straight from the config module so the
// attribution follows the shipped overrides, not this file's guess.
let overrides = {};
try {
  overrides = (await import(toUrl(path.join(ROOT, 'src/balance/config.js')))).config?.buildings ?? {};
} catch {
  overrides = {};
}
const ownerOf = (id, field) => {
  const o = overrides[id];
  if (!o || typeof o !== 'object') return 'buildings';
  if (field === 'gate') return o.unlock !== undefined || o.unlockAt !== undefined ? 'config' : 'buildings';
  return o[field] !== undefined ? 'config' : 'buildings';
};

const rows = new Map(); // id -> { id, tier, gate, gateOwner, costOwner, unlockS, buyS }
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
  rows.set(id, { id, tier: d.tier, gate, gateOwner: ownerOf(id, 'gate'), costOwner: ownerOf(id, 'baseCost'), unlockS: null, buyS: null });
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
let popAtEnd = 0;
let peakPop = 0;
events.on('prestige', () => {
  founded = true;
});

for (let t = 0; t < TICKS && !founded; t += BOT_EVERY) {
  popAtEnd = state.res.pop;
  if (popAtEnd > peakPop) peakPop = popAtEnd;
  game.botStep();
  if (founded) break;
  game.step(Math.min(BOT_EVERY, TICKS - t));
}
if (!founded) popAtEnd = state.res.pop;
const endS = founded ? state.stats.playtime : sec();

const list = [...rows.values()].sort((a, b) => (a.unlockS ?? Infinity) - (b.unlockS ?? Infinity));
const min = (s) => (s / 60).toFixed(1);
const m = (s) => (s === null ? '   —  ' : min(s).padStart(6));
// { owner, msg, fields }: owner is 'buildings' when a field this folder owns can fix the
// fault; `fields` names where the fix lives (`config.buildings.<id>.<field>` for a pinned
// field, `data.js <id>.<field>` otherwise) so the owning folder can act on the line as is.
const problems = [];
const where = (r, field) => {
  const owner = field === 'gate' ? r.gateOwner : r.costOwner;
  const name = field === 'gate' ? 'unlock' : field;
  return owner === 'config' ? `config.buildings.${r.id}.${name}` : `data.js ${r.id}.${name}`;
};
const push = (owner, msg, fields) => problems.push({ owner, msg: `${msg} — fix: ${fields.join(' / ')}`, fields });
const opened = list.filter((r) => r.unlockS !== null);
for (let i = 1; i < opened.length; i++) {
  const a = opened[i - 1], b = opened[i];
  if (a.unlockS >= RULES_FROM_S && b.unlockS - a.unlockS < SPACING_S) {
    const owner = a.gateOwner === 'buildings' || b.gateOwner === 'buildings' ? 'buildings' : 'config';
    push(owner, `${a.id} and ${b.id} open ${(b.unlockS - a.unlockS).toFixed(0)} s apart (${min(a.unlockS)} min, limit ${SPACING_S} s)`, [where(a, 'gate'), where(b, 'gate')]);
  }
  if (a.unlockS >= RULES_FROM_S && b.unlockS - a.unlockS > GAP_S) {
    push(b.gateOwner, `nothing new for ${min(b.unlockS - a.unlockS)} min between ${a.id} (${min(a.unlockS)}) and ${b.id} (${min(b.unlockS)}), limit ${GAP_S / 60}`, [where(b, 'gate')]);
  }
}
for (const r of list) {
  const lagMax = r.tier >= 4 ? LAG_T4_S : LAG_S;
  if (r.unlockS !== null && r.unlockS >= RULES_FROM_S && r.buyS !== null && r.buyS - r.unlockS > lagMax) {
    const owner = r.gateOwner === 'buildings' || r.costOwner === 'buildings' ? 'buildings' : 'config';
    push(owner, `${r.id} glows unaffordable for ${min(r.buyS - r.unlockS)} min (open ${min(r.unlockS)} → bought ${min(r.buyS)}, limit ${lagMax / 60})`, [where(r, 'gate'), where(r, 'baseCost')]);
  }
  if (r.unlockS !== null && r.buyS === null) {
    push(r.costOwner, `${r.id} opens at ${min(r.unlockS)} min but is never bought in the first city`, [where(r, 'baseCost')]);
  }
}
if (founded && opened.length) {
  const last = opened[opened.length - 1];
  const tail = endS - last.unlockS;
  if (tail > GAP_S) {
    // The next locked card (lowest population gate still closed) is the one that would fill the tail.
    const next = list.filter((r) => r.unlockS === null && Number.isFinite(registry.buildings.get(r.id)?.unlockAt?.pop)).sort((a, b) => registry.buildings.get(a.id).unlockAt.pop - registry.buildings.get(b.id).unlockAt.pop)[0];
    push(next ? next.gateOwner : 'buildings', `nothing new for the last ${min(tail)} min of the first city (${last.id} at ${min(last.unlockS)}, founding at ${min(endS)}, peak pop ${Math.round(peakPop).toLocaleString('en-US')}${next ? `; next locked card ${next.id} at ${next.gate}` : ''})`, next ? [where(next, 'gate')] : ['data.js fusion.unlock']);
  }
}

const report = {
  endMin: +(endS / 60).toFixed(2),
  founded,
  popAtEnd: Math.round(popAtEnd),
  peakPop: Math.round(peakPop),
  rules: { spacingS: SPACING_S, lagS: LAG_S, lagTier4S: LAG_T4_S, gapS: GAP_S, fromS: RULES_FROM_S },
  buildings: list,
  problems,
  errors: game.errors,
};
if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 1));
} else {
  console.log(`first city: ${min(endS)} min${founded ? ' (founded)' : ' (cut off)'}, peak pop ${Math.round(peakPop).toLocaleString('en-US')}, errors ${game.errors.length}`);
  console.log('building     tier  gate                    owner       open   bought   lag (min)');
  for (const r of list) {
    const lag = r.unlockS !== null && r.buyS !== null ? min(r.buyS - r.unlockS).padStart(6) : '   —  ';
    const owner = r.gateOwner === r.costOwner ? r.gateOwner : `${r.gateOwner[0]}/${r.costOwner[0]}`;
    console.log(`${r.id.padEnd(12)} ${String(r.tier).padStart(3)}   ${r.gate.padEnd(23)} ${owner.padEnd(9)}${m(r.unlockS)}  ${m(r.buyS)}  ${lag}`);
  }
  console.log(problems.length ? 'problems:\n  ' + problems.map((p) => `[${p.owner}] ${p.msg}`).join('\n  ') : 'no spacing, affordability or dead-air problems');
}
process.exit(problems.length || game.errors.length ? 1 : 0);
