// Node-only accelerated economy simulation (no DOM). Plays the greedy bot for a long
// game (default 6 game-hours = 216,000 ticks) with prestige, detects stalls/bottlenecks/overflow,
// and reports the late-game contract metrics from docs/DESIGN.md "Late game contract".
// node tools/economy-sim.mjs [--ticks 216000] [--out logs/sim.json] [--sample 600] [--profile default|saver|human]
//                            [--grant megastructures,arcology-gardens[@6]]
//
// Profiles: `default` (greedy bot; the only one held to the cadence/tension/power/happiness
// gates), `saver` (`--saver` is an alias: saves toward a rung within 30 s of income) and
// `human` (src/core/bot.js humanStep — the 2026-09-14 playtest's purchase policy, docs/FEEDBACK.md
// F16: every lit card, homes → jobs → power to demand, then comparable amounts of everything,
// never saves, founds as soon as allowed). Every profile reports the F2/F3 probes — by hour
// (powerRatioByHour, unemploymentByHour, nextLegacyMinutesByHour, lightsOutByHour,
// lightsOutReachable) and by city (median cap/demand, median unemployment, share of samples at
// ≥ 3× surplus / ≥ 40 % unemployment, taken ≥ 2 min into each city so the replay-start burst
// does not dominate), the F3 block (the run-minute Megastructures / Arcology Gardens landed in
// each city, and the unemployment split over the cities where they landed mid-city — the
// player's case — separately from the replay cities that re-buy them into an empty plot), the
// F2 attribution (human profile only: generator units bought to cover demand vs by the
// rotation, and the cap/demand the city would have had without the rotation's generators) and
// the player checkpoint (the screenshot's numbers against the sample at the same playtime, the
// end of the same city, and the first sample at the same income). None of those gate.
//
// Scale gap, stated plainly: the screenshot (city 6, clock 1h32m, $130B, $7.89B/s, 1.53M pop,
// legacy 415, 1,727 buildings, Megastructures owned) is not the economy any found-as-soon-as-
// allowed bot has at 92 min of playtime (all three profiles: city 6, ~$3.4e7/s, ~355k pop,
// legacy 30, ~1,300 buildings). The greedy bot first matches the player's income in city 14 at
// 214 min. Two reasons, neither a policy: (1) stats.playtime is time at the keyboard — offline
// and background-tab catch-up (src/save/index.js stepScaled / finishCatchUp) advances the
// economy and lifetimeEarned without moving the clock, so the player's 92 min held more
// game-time than the sim's 92 min; (2) a player away from the keyboard does not found the
// moment the gate opens, so each of their cities ran far past the ceil(0.4 × bank) gate (415
// legacy after 5 foundings vs 30 for a bot that founds at the gate). No bot policy can
// reproduce that timeline, so the F3 probe at the player's point is the `--grant` what-if
// (own Megastructures / Arcology Gardens from city 6 on, no money spent, kind 'g' in the
// purchase log, report.grant) rather than a claim that the profile reaches it on its own.
// Note for F16: the F2 surplus is structural (Grid Charter +100 % generation in city ~7,
// Orbital Solar later) and the DEFAULT profile already shows it (median cap/demand 4× in
// hour 1, 6.8× in hour 2, 16× in hour 3 of logs/sim-gauntlet.json), so an F2 contract gate
// belongs on the default profile; what the human profile adds is the attribution above.
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
const PROFILE_ARG = String(opt('--profile', args.includes('--saver') ? 'saver' : 'default')).toLowerCase();
const PROFILE = PROFILE_ARG === 'greedy' ? 'default' : PROFILE_ARG;
if (!['default', 'saver', 'human'].includes(PROFILE)) {
  console.error(`[sim] unknown profile "${PROFILE_ARG}" (default | saver | human)`);
  process.exit(2);
}
const SAVER = PROFILE === 'saver'; // player profile that saves toward a rung within 30 s of income
const GATED = PROFILE === 'default'; // only the greedy profile is held to the late-game contract
// --grant id[,id...][@city]: a what-if that owns the listed upgrades from that city on (default
// 6, the screenshot's city) without paying for them — the direct F3 probe (see the header).
const GRANT = (() => {
  const raw = opt('--grant', '');
  if (!raw) return null;
  const [ids, at] = raw.split('@');
  const list = ids.split(',').map((s) => s.trim()).filter(Boolean);
  const fromCity = Math.max(1, Math.floor(Number(at || 6)) || 6);
  return list.length ? { ids: list, fromCity } : null;
})();

// F2 attribution (human profile): units of each building bought by the rotation this city, and
// generator units by rule. The greedy/saver bots have no rotation, so both stay empty there.
const rotationCount = {}; // id → units bought by the rotation in the current city
const genUnits = { need: 0, rotation: 0 };
const trace = (reason, row, n) => {
  if (reason === 'rotation') rotationCount[row.id] = (rotationCount[row.id] || 0) + n;
  if (row.powerGen > 0) genUnits[reason === 'rotation' ? 'rotation' : 'need'] += n;
};
const BOT_OPTS = SAVER ? { saveSeconds: 30 } : PROFILE === 'human' ? { profile: 'human', trace } : {};

const { boot, game } = await import(path.join(ROOT, 'src/boot.js').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
await boot();
const { state, derived, api, registry } = game;

const samples = [];
const issues = [];
const purchases = []; // {tick, kind, id}
const everBought = new Set(); // 'b:id' / 'u:id' first-time purchases across the whole session
const cycles = []; // per founding: { n, startMin, endMin, minutes, legacyAfter, gain, peakIncome, minHappiness, newItems, brownoutShare, maxPowerSurplus, maxUnemployment, lightsOut, landed, granted, genUnits }
// landed: F3 upgrade id → run-minute it was bought (or granted) in this city, from the
// purchase log (not from the first sample that sees it owned).
const F3_UPGRADES = ['megastructures', 'arcology-gardens'];
const freshCycle = (n, startMin) => ({ n, startMin, peakIncome: 0, minHappiness: Infinity, newItems: [], brownoutTicks: 0, ticks: 0, maxPowerSurplus: 0, maxUnemployment: 0, landed: {}, granted: false });
let cur = freshCycle(0, 0);
const runMin = () => +(state.time / 60).toFixed(2);

// The Lights Out milestone's own predicate (src/simulation/milestones.js isBrownout: a grid
// exists and demand outruns it), read off the registered milestone so the probe cannot drift
// from the goal it measures; the inline form is the documented fallback.
const lightsOutDef = (game.milestones || []).find((m) => m.id === 'brownout');
const lightsOutNow = () => {
  if (lightsOutDef && typeof lightsOutDef.check === 'function') {
    try {
      return lightsOutDef.check(state, derived) === true;
    } catch {
      /* fall through to the inline predicate */
    }
  }
  return derived.powerDemand > 0 && derived.powerCap > 0 && derived.powerRatio < 1;
};
// A grid exists (the milestone is "available": it can only latch once cap > 0 and demand > 0).
const gridExists = () => derived.powerDemand > 0 && derived.powerCap > 0;

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
  if (F3_UPGRADES.includes(e.id) && cur.landed[e.id] === undefined) cur.landed[e.id] = runMin();
});
// The --grant what-if: own the listed upgrades from GRANT.fromCity on. Applied before every bot
// step (so a founding into that city grants them at run-minute 0); nothing is paid, the
// 'upgrade' event does not fire, the purchase log gets kind 'g'.
if (GRANT) {
  for (const id of GRANT.ids) {
    if (!registry.upgrades.has(id)) {
      console.error(`[sim] --grant: unknown upgrade "${id}"`);
      process.exit(2);
    }
  }
}
function applyGrant() {
  if (!GRANT || state.stats.prestiges + 1 < GRANT.fromCity) return;
  for (const id of GRANT.ids) {
    if (state.upgrades[id]) continue;
    state.upgrades[id] = true;
    state.unlocks['u:' + id] = true;
    purchases.push({ tick: state.tick, kind: 'g', id });
    if (F3_UPGRADES.includes(id) && cur.landed[id] === undefined) cur.landed[id] = runMin();
    cur.granted = true;
  }
}
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
    // Debug maxima only (both are dominated by the replay-start burst: the first windmill over
    // one cottage, the first cottage before the first shop): cap / demand at the city's most
    // over-built moment (demand > 0) and the worst jobless share it saw. The gate-able per-city
    // medians / shares are filled in after the run from the warmed-up samples (cityStats).
    // lightsOut: whether the city latched the Lights Out milestone (the flag is read before the
    // reset clears it — see the 'prestige' listener order note below).
    maxPowerSurplus: +cur.maxPowerSurplus.toFixed(2),
    maxUnemployment: +cur.maxUnemployment.toFixed(3),
    lightsOut: !!cur.lightsOut,
    landed: cur.landed,
    granted: cur.granted,
    genUnits: { ...genUnits },
  });
  cur = freshCycle(cur.n + 1, nowMin);
  for (const k of Object.keys(rotationCount)) delete rotationCount[k];
  genUnits.need = 0;
  genUnits.rotation = 0;
});

// Grid capacity the rotation's generators contribute right now (same per-unit formula as
// src/resources computeDerived: powerGen × byBuilding.power × mods.power; the building rows
// carry the live per-unit powerGen). Zero for profiles without a rotation.
function rotationCap() {
  let sum = 0;
  const mods = derived.mods || null;
  const pos = (v) => (Number.isFinite(v) && v > 0 ? v : 1);
  const modPower = mods ? pos(mods.power) : 1;
  for (const b of api.buildings()) {
    const n = rotationCount[b.id];
    if (!n || !(b.powerGen > 0)) continue;
    const bb = mods?.byBuilding?.[b.id];
    sum += n * b.powerGen * (bb ? pos(bb.power) : 1) * modPower;
  }
  return sum;
}

let lastBuyTick = 0;
let stallStart = -1;
let brownoutTicks = 0; // ratio < 0.9
let underPowerTicks = 0; // ratio < 1
let minRatio = 1;
let bestIncome = 0;
let maxMoney = 0;
let tensionHits = 0; // samples where the priciest unlocked, unowned money item sits at 3–50× cash
let tensionNextHits = 0; // samples where the cheapest unlocked, unowned money item above cash sits at 3–50× cash
let reachHits = 0; // samples where the cheapest unlocked, unowned money UPGRADE is 30 s – 15 min of income away
let reachSamples = 0; // samples where at least one unlocked, unowned money upgrade exists
const t0 = Date.now();

// Seconds of current income until the cheapest unlocked, unowned money upgrade is affordable
// (0 if one is already affordable; Infinity if none exists or income is 0).
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
  applyGrant();
  game.botStep(BOT_OPTS);
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
  // Per-city maxima start once the city has 100 citizens (the stats-panel gate): the first
  // windmill over one cottage is a 4× "surplus" and the first cottage before the first shop
  // is 100 % unemployment, neither of which is the F2/F3 signal.
  if (state.res.pop >= 100) {
    if (derived.powerDemand > 0) {
      const surplus = derived.powerCap / derived.powerDemand;
      if (surplus > cur.maxPowerSurplus) cur.maxPowerSurplus = surplus;
    }
    const jobless = (state.res.pop - derived.employed) / state.res.pop;
    if (jobless > cur.maxUnemployment) cur.maxUnemployment = jobless;
  }
  // state.unlocks is reset by the founding before 'prestige' fires, so the milestone is
  // remembered here, tick by tick, and read from `cur` in the listener.
  if (!cur.lightsOut && state.unlocks['m:brownout']) cur.lightsOut = true;

  if (state.tick % SAMPLE < BOT_EVERY) {
    const bcount = Object.values(state.buildings).reduce((a, b) => a + b, 0);
    const px = derived.extra && derived.extra.prestige;
    // Minutes at the current earning rate until the next legacy point: the game's own
    // countdown (prestigeStatus nextIn: seconds until this run's totalEarned reaches nextAt
    // at the rate the score accrues); Infinity when nothing is coming in → null in JSON.
    const nextLegacySec = px && Number.isFinite(px.nextIn) ? px.nextIn : Infinity;
    const employed = Number.isFinite(derived.employed) ? derived.employed : 0;
    const unemployment = state.res.pop > 0 ? (state.res.pop - employed) / state.res.pop : 0;
    const { max: big, next } = frontierPrices(state.res.money);
    const ratio = state.res.money > 0 ? big / state.res.money : Infinity;
    const nextRatio = state.res.money > 0 && next > 0 ? next / state.res.money : Infinity;
    if (ratio >= 3 && ratio <= 50) tensionHits++;
    if (nextRatio >= 3 && nextRatio <= 50) tensionNextHits++;
    const reach = reachSeconds(state.res.money, derived.income);
    if (Number.isFinite(reach)) reachSamples++;
    if (reach >= 30 && reach <= 900) reachHits++;
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
      powerCap: derived.powerCap,
      powerDemand: derived.powerDemand,
      employed,
      unemployment: +unemployment.toFixed(4),
      nextLegacyMin: Number.isFinite(nextLegacySec) ? +(nextLegacySec / 60).toFixed(2) : null,
      grid: gridExists(),
      lightsOut: lightsOutNow(),
      // Money upgrades reset every founding, so this is "owned in the current city".
      megaOwned: !!state.upgrades.megastructures,
      arcoOwned: !!state.upgrades['arcology-gardens'],
      // Capacity the rotation's generators add (human profile; 0 elsewhere) — see rotationCap().
      powerCapRotation: rotationCap(),
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

// ---- by-hour probes (docs/FEEDBACK.md F2/F3/F16; every profile, nothing gates) ----
// One value per game-hour of playtime (samples are every SAMPLE ticks; `min` is playtime):
//   powerRatioByHour         median cap / demand over the hour's samples with demand > 0
//   unemploymentByHour       median (pop − employed) / pop over the hour's samples with pop > 0
//   nextLegacyMinutesByHour  median minutes at the current earning rate until the next legacy
//                            point (finite samples only)
// lightsOutReachable: share of samples after a grid exists (the milestone is available) where
// the Lights Out condition evaluates true; lightsOutCities: cities that latched it.
const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const HOURS = Math.max(1, Math.ceil(hours));
const byHour = (pick) => {
  const out = [];
  for (let h = 0; h < HOURS; h++) {
    const xs = [];
    for (const s of samples) {
      if (Math.floor(s.min / 60) !== h) continue;
      const v = pick(s);
      if (Number.isFinite(v)) xs.push(v);
    }
    const m = median(xs);
    out.push(m === null ? null : +m.toFixed(3));
  }
  return out;
};
const powerRatioByHour = byHour((s) => (s.powerDemand > 0 ? s.powerCap / s.powerDemand : NaN));
const unemploymentByHour = byHour((s) => (s.pop > 0 ? s.unemployment : NaN));
const nextLegacyMinutesByHour = byHour((s) => (s.nextLegacyMin === null ? NaN : s.nextLegacyMin));
const gridSamples = samples.filter((s) => s.grid);
const lightsOutReachable = gridSamples.length ? gridSamples.filter((s) => s.lightsOut).length / gridSamples.length : 0;
// A share (mean of the 0/1 indicator over the hour's grid samples), not a median: the median
// of an indicator that is true 3 % of the time reads 0 for every hour.
const share = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const lightsOutByHour = (() => {
  const out = [];
  for (let h = 0; h < HOURS; h++) {
    const xs = samples.filter((s) => s.grid && Math.floor(s.min / 60) === h).map((s) => (s.lightsOut ? 1 : 0));
    const v = share(xs);
    out.push(v === null ? null : +v.toFixed(3));
  }
  return out;
})();

// ---- by-city probes (the F2/F3 signal the by-hour medians blur across cities) ----
// City k (1-based, the number the dashboard shows) is the run with `prestiges === k − 1`; the
// last entry is the city still in progress. Samples count once the city is CITY_WARMUP_MIN
// minutes old and has 100 citizens: a replay re-buys its whole ladder in its first two or three
// minutes (one windmill over one cottage is a 4× "surplus", one cottage before the first shop is
// 100 % unemployment) and neither is the lived state F2/F3 describe.
//   medianPowerRatio   median cap / demand (demand > 0)     shareSurplus3x  share of those ≥ 3
//   medianUnemployment median (pop − employed) / pop        shareUnemp40    share of those ≥ 0.4
//   megaShare          share of the city's samples with Megastructures owned
//   megastructuresAt / arcologyGardensAt   run-minute the upgrade landed in this city (purchase
//                      log; null when it never did), granted: the --grant what-if put it there
//   unemploymentAfterMega / unemp40AfterMega   median / ≥ 40 % share over the city's warmed-up
//                      samples with Megastructures owned (null when it never was)
//   genUnits           generator units bought to cover demand vs by the rotation (human only)
//   medianPowerRatioWithoutRotation   median (cap − rotation generators' cap) / demand: the
//                      surplus the city would carry had the rotation bought no generators
//   rotationGenShare   rotation share of the city's generator units
const CITY_WARMUP_MIN = 2;
const warm = (s) => s.runMin >= CITY_WARMUP_MIN && s.pop >= 100;
const r3 = (v) => (v === null ? null : +v.toFixed(3));
const cityStats = [];
for (let k = 0; k <= state.stats.prestiges; k++) {
  const xs = samples.filter((s) => s.prestiges === k && warm(s));
  const ratios = xs.filter((s) => s.powerDemand > 0).map((s) => s.powerCap / s.powerDemand);
  const ratiosNoRot = xs.filter((s) => s.powerDemand > 0).map((s) => Math.max(0, s.powerCap - (s.powerCapRotation || 0)) / s.powerDemand);
  const unemp = xs.filter((s) => s.pop > 0).map((s) => s.unemployment);
  const unempMega = xs.filter((s) => s.pop > 0 && s.megaOwned).map((s) => s.unemployment);
  const cyc = cycles[k];
  const landed = cyc ? cyc.landed : cur.landed;
  const gu = cyc ? cyc.genUnits : { ...genUnits };
  const guTotal = gu.need + gu.rotation;
  cityStats.push({
    city: k + 1,
    complete: k < state.stats.prestiges,
    samples: xs.length,
    medianPowerRatio: r3(median(ratios)),
    shareSurplus3x: r3(share(ratios.map((v) => (v >= 3 ? 1 : 0)))),
    medianUnemployment: r3(median(unemp)),
    shareUnemp40: r3(share(unemp.map((v) => (v >= 0.4 ? 1 : 0)))),
    megaShare: r3(share(xs.map((s) => (s.megaOwned ? 1 : 0)))),
    megastructuresAt: landed.megastructures ?? null,
    arcologyGardensAt: landed['arcology-gardens'] ?? null,
    granted: cyc ? !!cyc.granted : !!cur.granted,
    unemploymentAfterMega: r3(median(unempMega)),
    unemp40AfterMega: r3(share(unempMega.map((v) => (v >= 0.4 ? 1 : 0)))),
    genUnits: gu,
    medianPowerRatioWithoutRotation: r3(median(ratiosNoRot)),
    rotationGenShare: guTotal ? r3(gu.rotation / guTotal) : null,
  });
}
for (const c of cycles) {
  const cs = cityStats[c.n];
  if (!cs) continue;
  c.medianPowerRatio = cs.medianPowerRatio;
  c.shareSurplus3x = cs.shareSurplus3x;
  c.medianUnemployment = cs.medianUnemployment;
  c.shareUnemp40 = cs.shareUnemp40;
}
const firstSurplusCity = cityStats.find((c) => c.medianPowerRatio !== null && c.medianPowerRatio >= 3);
// Megastructures (F3): the first city that owned it, the playtime minute it was first bought,
// and the median unemployment over warmed-up samples with it owned vs without.
// (purchase ticks are per run and reset on founding, so the minute is read off the first
// sample that sees it owned — playtime, at most one sample interval late)
const megaSample = samples.find((s) => s.megaOwned);
const warmSamples = samples.filter(warm);
const unempWithMega = median(warmSamples.filter((s) => s.megaOwned && s.pop > 0).map((s) => s.unemployment));
const unempBeforeMega = median(warmSamples.filter((s) => !s.megaOwned && s.pop > 0).map((s) => s.unemployment));
const unemp40WithMega = share(warmSamples.filter((s) => s.megaOwned && s.pop > 0).map((s) => (s.unemployment >= 0.4 ? 1 : 0)));
// The F3 split by how Megastructures got into the city (the player's case is "mid-city": bought
// into a populated city, so the housing doubles under people whose jobs are at the cost wall;
// a replay city re-buys it in its first minutes into an empty plot and grows into it; a granted
// city had it from the --grant what-if). Pooling the three hides the mid-city cliff.
const f3Group = (c) => (c.granted ? 'granted' : c.megastructuresAt === null ? null : c.megastructuresAt >= CITY_WARMUP_MIN ? 'midCity' : 'replay');
const f3Split = (group) => {
  const cities = cityStats.filter((c) => f3Group(c) === group);
  const ids = new Set(cities.map((c) => c.city - 1));
  const withMega = warmSamples.filter((s) => ids.has(s.prestiges) && s.megaOwned && s.pop > 0);
  const beforeMega = warmSamples.filter((s) => ids.has(s.prestiges) && !s.megaOwned && s.pop > 0);
  return {
    cities: cities.map((c) => c.city),
    samples: withMega.length,
    unemploymentBefore: r3(median(beforeMega.map((s) => s.unemployment))),
    unemploymentWith: r3(median(withMega.map((s) => s.unemployment))),
    unemp40ShareWith: r3(share(withMega.map((s) => (s.unemployment >= 0.4 ? 1 : 0)))),
    maxUnemploymentWith: withMega.length ? r3(Math.max(...withMega.map((s) => s.unemployment))) : null,
  };
};
const f3 = { midCity: f3Split('midCity'), replay: f3Split('replay'), granted: f3Split('granted') };

// ---- player checkpoint (docs/feedback/2026-09-14-idle-stats.png; see the header) ----
// Reported, not gated: the screenshot against (a) the sample nearest the same playtime, (b) the
// last sample of the same city, (c) the first sample at the same income, with the ratios
// bot / player so the gap reads as a number. No profile is claimed to match it.
const PLAYER = { min: 92, city: 6, money: 1.3e11, income: 7.89e9, pop: 1.53e6, housing: 1.53e6, jobs: 8.72e5, powerCap: 1.27e8, powerDemand: 3.61e7, happiness: 1.69, unemployment: 0.43, legacy: 415, buildings: 1727, megastructures: true };
const nearest = (pred, key) => {
  let best = null;
  for (const s of samples) if (pred(s) && (!best || Math.abs(key(s)) < Math.abs(key(best)))) best = s;
  return best;
};
const pick = (s) =>
  s
    ? {
        min: s.min,
        city: s.prestiges + 1,
        money: s.money,
        income: s.income,
        pop: Math.round(s.pop),
        jobs: Math.round(s.jobs),
        powerRatio: s.powerDemand > 0 ? +(s.powerCap / s.powerDemand).toFixed(2) : null,
        happiness: s.happiness,
        unemployment: s.unemployment,
        legacy: s.legacy,
        buildings: s.buildings,
        megastructures: s.megaOwned,
        ratioToPlayer: { income: +(s.income / PLAYER.income).toFixed(4), pop: +(s.pop / PLAYER.pop).toFixed(4), legacy: +(s.legacy / PLAYER.legacy).toFixed(4), buildings: +(s.buildings / PLAYER.buildings).toFixed(3) },
      }
    : null;
const city6 = samples.filter((s) => s.prestiges === PLAYER.city - 1);
const playerCheckpoint = {
  player: PLAYER,
  atMinute: pick(nearest(() => true, (s) => s.min - PLAYER.min)),
  atCityEnd: pick(city6.length ? city6[city6.length - 1] : null),
  firstAtIncome: pick(samples.find((s) => s.income >= PLAYER.income) || null),
  firstAtLegacy: pick(samples.find((s) => s.legacy >= PLAYER.legacy) || null),
};

// ---- contract checks (see docs/DESIGN.md "Late game contract") ----
if (brownoutTicks > TICKS * 0.25) issues.push({ tick: state.tick, kind: 'bottleneck', msg: `brownout (<0.9) for ${((brownoutTicks / TICKS) * 100).toFixed(0)}% of run` });
if (state.stats.prestiges === 0 && TICKS >= 100000) issues.push({ tick: state.tick, kind: 'pacing', msg: 'no prestige reached in run' });
if (maxMoney > 1e18 || state.prestige.legacy > 1e6) issues.push({ tick: state.tick, kind: 'magnitude', msg: `money peak ${maxMoney.toExponential(2)}, legacy ${state.prestige.legacy} (contract: ≤1e18 / ≤1e6 at 12h)` });
for (let i = 1; i < cycles.length; i++) {
  const a = cycles[i - 1], b = cycles[i];
  // Strict ×1.35, no minute slack: src/balance is tuned to the strict ratio and
  // balance.test.mjs asserts it, so the gate here enforces the same line.
  if (GATED && i >= 5 && b.minutes > a.minutes * 1.35) issues.push({ tick: 0, kind: 'cadence', msg: `cycle ${b.n} (${b.minutes} min) > 1.35× cycle ${a.n} (${a.minutes} min)` });
}
const lateCycles = cycles.filter((c) => c.n >= 5);
const emptyCycles = lateCycles.filter((c) => c.newItems.length === 0);
if (GATED && emptyCycles.length) issues.push({ tick: 0, kind: 'variety', msg: `${emptyCycles.length}/${lateCycles.length} cycles after the 5th introduced nothing new (first: cycle ${emptyCycles[0].n})` });
if (GATED && cycles.length && cycles[cycles.length - 1].minutes > 40 && hours >= 12) issues.push({ tick: 0, kind: 'cadence', msg: `last cycle ${cycles[cycles.length - 1].minutes} min > 40 min` });
const tensionShare = samples.length ? tensionHits / samples.length : 0;
const reachShare = samples.length ? reachHits / samples.length : 0;
if (hours >= 6 && GATED && reachShare < 0.3) issues.push({ tick: 0, kind: 'tension', msg: `next upgrade is 30 s–15 min of income away in only ${(reachShare * 100).toFixed(0)}% of samples (contract ≥ 30%; big-ratio reading ${(tensionShare * 100).toFixed(0)}%)` });
const underPowerShare = underPowerTicks / TICKS;
if (GATED && hours >= 6 && (underPowerShare < 0.03 || underPowerShare > 0.2)) issues.push({ tick: 0, kind: 'power', msg: `under-power share ${(underPowerShare * 100).toFixed(1)}% (contract 3–20%)` });
if (minRatio < 0.6) issues.push({ tick: 0, kind: 'power', msg: `power ratio floor ${minRatio.toFixed(2)} < 0.6` });
const happyDips = cycles.filter((c) => c.minHappiness !== null && c.minHappiness < 1).length;
if (GATED && hours >= 6 && cycles.length >= 4 && happyDips < cycles.length * 0.5) issues.push({ tick: 0, kind: 'happiness', msg: `happiness dipped below 1.0 in only ${happyDips}/${cycles.length} cities (contract ≥ 50%)` });
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

// (a granted upgrade is owned without ever being bought: the what-if is not a content gap)
const neverPurchased = {
  buildings: registry.buildingOrder.filter((id) => !everBought.has('b:' + id)),
  upgrades: registry.upgradeOrder.filter((id) => !everBought.has('u:' + id) && !(GRANT && GRANT.ids.includes(id))),
};
if (hours >= 12 && (neverPurchased.buildings.length || neverPurchased.upgrades.length)) {
  issues.push({ tick: 0, kind: 'content', msg: `never purchased in ${hours}h: ${[...neverPurchased.buildings, ...neverPurchased.upgrades].join(', ')}` });
}

const HARD = new Set(['overflow', 'stall', 'magnitude']);
const report = {
  profile: PROFILE,
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
    prestige: { legacy: state.prestige.legacy, spent: state.prestige.spent || 0, lifetimeEarned: state.prestige.lifetimeEarned || 0 },
    prestiges: state.stats.prestiges,
    totalEarned: state.stats.totalEarned,
  },
  metrics: {
    cycles: cycles.map((c) => c.minutes),
    reachShare: +reachShare.toFixed(3),
    reachSamples,
    tensionShare: +tensionShare.toFixed(3),
    tensionNextShare: +(samples.length ? tensionNextHits / samples.length : 0).toFixed(3),
    underPowerShare: +underPowerShare.toFixed(4),
    brownoutShare: +(brownoutTicks / TICKS).toFixed(4),
    minPowerRatio: +minRatio.toFixed(3),
    happinessDipCities: happyDips,
    emptyLateCycles: emptyCycles.map((c) => c.n),
    neverPurchased,
    // F2/F3 probes (see above); reported for every profile, gated by none yet.
    powerRatioByHour,
    unemploymentByHour,
    nextLegacyMinutesByHour,
    lightsOutReachable: +lightsOutReachable.toFixed(3),
    lightsOutByHour,
    lightsOutCities: cycles.filter((c) => c.lightsOut).length,
    // Per city (1-based; the last entry is the city in progress), warmed-up samples only.
    powerRatioByCity: cityStats.map((c) => c.medianPowerRatio),
    surplus3xShareByCity: cityStats.map((c) => c.shareSurplus3x),
    unemploymentByCity: cityStats.map((c) => c.medianUnemployment),
    unemp40ShareByCity: cityStats.map((c) => c.shareUnemp40),
    firstCityWithSurplus3x: firstSurplusCity ? firstSurplusCity.city : null,
    megastructuresCity: megaSample ? megaSample.prestiges + 1 : null,
    megastructuresMin: megaSample ? megaSample.min : null,
    unemploymentWithMegastructures: r3(unempWithMega),
    unemploymentBeforeMegastructures: r3(unempBeforeMega),
    unemp40ShareWithMegastructures: r3(unemp40WithMega),
    // F3 by how the upgrade got into the city (see f3Split): the mid-city group is the
    // player's case and the one to read; megastructuresRunMinByCity is the purchase-log minute.
    megastructuresRunMinByCity: cityStats.map((c) => c.megastructuresAt),
    arcologyGardensRunMinByCity: cityStats.map((c) => c.arcologyGardensAt),
    f3,
    // F2 attribution (human profile; null / zero for the others).
    generatorUnitsByCity: cityStats.map((c) => c.genUnits),
    rotationGenShareByCity: cityStats.map((c) => c.rotationGenShare),
    powerRatioWithoutRotationByCity: cityStats.map((c) => c.medianPowerRatioWithoutRotation),
  },
  grant: GRANT,
  playerCheckpoint,
  cityStats,
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
console.log(`[sim] profile=${PROFILE} reach=${(reachShare * 100).toFixed(0)}% bigRatio=${(tensionShare * 100).toFixed(0)}% (next-step ${(report.metrics.tensionNextShare * 100).toFixed(0)}%) underPower=${(underPowerShare * 100).toFixed(1)}% minRatio=${minRatio.toFixed(2)} happyDips=${happyDips}/${cycles.length} emptyLate=${emptyCycles.length}`);
const hourly = (xs, f) => xs.map((v) => (v === null ? '-' : f(v))).join(' ');
const pct = (v) => (v * 100).toFixed(0) + '%';
const m = report.metrics;
console.log(
  `[sim] ${PROFILE} by hour: power cap/demand ${hourly(powerRatioByHour, (v) => v.toFixed(2))} | unemployment ${hourly(unemploymentByHour, pct)} | next legacy (min) ${hourly(nextLegacyMinutesByHour, (v) => v.toFixed(1))} | lightsOut ${hourly(lightsOutByHour, (v) => (v * 100).toFixed(1) + '%')} of grid samples (${(lightsOutReachable * 100).toFixed(1)}% overall, latched in ${m.lightsOutCities}/${cycles.length} cities)`
);
console.log(
  `[sim] ${PROFILE} by city (≥ ${CITY_WARMUP_MIN} min in): median cap/demand ${hourly(m.powerRatioByCity, (v) => v.toFixed(2))} | median unemployment ${hourly(m.unemploymentByCity, pct)} | first city with median ≥ 3×: ${m.firstCityWithSurplus3x ?? 'none'} | Megastructures: ${
    m.megastructuresCity ? `first owned in city ${m.megastructuresCity} at ${m.megastructuresMin} min; median unemployment before ${pct(m.unemploymentBeforeMegastructures ?? 0)} / with ${pct(m.unemploymentWithMegastructures ?? 0)} (≥ 40% in ${pct(m.unemp40ShareWithMegastructures ?? 0)} of owned samples)` : 'never bought'
  }`
);
const f3Line = (name, g) => `${name} ${g.cities.length ? `cities ${g.cities.join(',')}: unemployment before ${pct(g.unemploymentBefore ?? 0)} / with ${pct(g.unemploymentWith ?? 0)} (≥ 40% in ${pct(g.unemp40ShareWith ?? 0)}, max ${pct(g.maxUnemploymentWith ?? 0)}, ${g.samples} samples)` : 'no city'}`;
console.log(`[sim] ${PROFILE} F3 by how Megastructures arrived${GRANT ? ` (--grant ${GRANT.ids.join(',')}@${GRANT.fromCity})` : ''}: ${f3Line('mid-city', f3.midCity)} | ${f3Line('replay', f3.replay)} | ${f3Line('granted', f3.granted)}`);
if (PROFILE === 'human') {
  const gu = m.generatorUnitsByCity;
  console.log(
    `[sim] human F2 attribution by city: generator units need/rotation ${gu.map((g) => `${g.need}/${g.rotation}`).join(' ')} | median cap/demand without the rotation's generators ${hourly(m.powerRatioWithoutRotationByCity, (v) => v.toFixed(2))}`
  );
}
const cp = playerCheckpoint;
const cpFmt = (s) => (s ? `city ${s.city} @ ${s.min} min: income ${s.income.toExponential(2)}/s (×${s.ratioToPlayer.income}), pop ${s.pop} (×${s.ratioToPlayer.pop}), legacy ${s.legacy} (×${s.ratioToPlayer.legacy}), ${s.buildings} bldg, unemployment ${pct(s.unemployment)}, cap/demand ${s.powerRatio ?? '-'}, Megastructures ${s.megastructures ? 'yes' : 'no'}` : 'not reached');
console.log(`[sim] ${PROFILE} vs the player's screenshot (city 6 @ 92 min: $7.89e9/s, 1.53M pop, legacy 415, 1,727 bldg, 43% unemployment, cap/demand 3.52, Megastructures yes): at 92 min → ${cpFmt(cp.atMinute)} | end of city 6 → ${cpFmt(cp.atCityEnd)} | first at the player's income → ${cpFmt(cp.firstAtIncome)}`);
for (const i of issues.slice(0, 14)) console.log(`  - [${i.kind}] t=${i.tick} ${i.msg}`);
console.log(`[sim] wrote ${OUT}`);
process.exit(report.pass ? 0 : 1);
