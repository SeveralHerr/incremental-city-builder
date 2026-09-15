// Node-only accelerated economy simulation (no DOM). Plays the greedy bot for a long
// game (default 6 game-hours = 216,000 ticks) with prestige, detects stalls/bottlenecks/overflow,
// and reports the late-game contract metrics from docs/DESIGN.md "Late game contract".
// node tools/economy-sim.mjs [--ticks 216000] [--out logs/sim.json] [--sample 600] [--profile default|saver|human]
//                            [--grant megastructures,arcology-gardens[@6]] [--guard strain|sticker]
//
// --guard (human profile only): the grid guard the human bot sizes a draw batch with.
// `strain` (default) foresees the fleet strain the tick will add (src/core/bot.js humanStep);
// `sticker` is the round-1/2 booking (per-unit sticker × count) kept as the CONTROL line — a
// round report prints the Lights Out seconds by city under both so a pass can be attributed
// to content, not to the guard.
//
// In-process before/after probes (a script that imports src/boot.js once and loadState()s two
// trees into the same game): set game._sim.pendingDirty = true (or call the simulation's
// recompute) after EVERY loadState, or the control branch keeps the money milestones the
// bookkeeping latched for the previous tree and the treatment cannot — round-1 skeptic 2's
// −5 % to −21 % artefact. This tool boots once per process and never loadStates, so it is
// not exposed; a fork that does is.
//
// Gate lines print the window they read AND the unread part (hours 13–24 on a 12 h gate, the
// gaps of cities past the window, the cycles > 40 min that are not the last) so a windowed
// pass can never read as a session pass.
//
// Profiles: `default` (greedy bot; the only one held to the cadence/tension/power/happiness
// gates), `saver` (`--saver` is an alias: saves toward a rung within 30 s of income) and
// `human` (src/core/bot.js humanStep — the 2026-09-14 playtest's purchase policy, docs/FEEDBACK.md
// F16: every lit card, homes → jobs → power to demand, then comparable amounts of everything,
// never saves, founds as soon as allowed). Every profile reports the F2/F3 probes — by hour
// (powerRatioByHour, unemploymentByHour, nextLegacyMinutesByHour = the F12 legacy segment,
// underPowerByHour, lightsOutByHour, lightsOutReachable) and by city (median cap/demand, median
// unemployment, jobs/pop, brownout seconds, upgrade purchase run-minutes and the longest gap,
// share of samples at ≥ 3× surplus / ≥ 40 % unemployment, taken ≥ 2 min into each city so the
// replay-start burst does not dominate), the F3 block (the run-minute Megastructures / Arcology Gardens landed in
// each city, and the unemployment split over the cities where they landed mid-city — the
// player's case — separately from the replay cities that re-buy them into an empty plot), the
// F2 attribution (human profile only: generator units bought to cover demand vs by the
// rotation, and the cap/demand the city would have had without the rotation's generators) and
// the player checkpoint (the screenshot's numbers against the sample at the same playtime, the
// end of the same city, and the first sample at the same income). Of those, the human profile
// is gated on the F1/F2/F3/F12 lines listed at "human-profile contract gates" below, the greedy
// on the F12 legacy-tempo line and the two by-hour power lines (under-power ≥ 1 % of ticks in
// ≥ 3 of hours 3–12; median cap/demand ≤ 2.5 in hours 3–12 and ≥ 1.0 in hours 2–12) in
// addition to the DESIGN.md contract; the rest report.
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
// The screenshot carries two observables that disagree — the CLOCK (city 6 at 92 min, ~15-min
// cities) and the LEGACY bank (415 at the end of city 6, ~90-min cities on exponent 0.488) — and
// no founding rule satisfies both (the sweep is tabulated above HUMAN_FOUND_SHARE in
// src/core/bot.js). The shipped rule is fitted to the clock, because F1 is a wall-clock cadence
// contract; the "vs the player's screenshot" line below prints both columns every run so the
// cost on the legacy side stays visible rather than being quietly dropped.
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
// --found <rule> (human profile only): the founding rule under test, see src/core/bot.js
// humanShouldFound. Omitted → the profile's own default (the measured pick). The named rules are
// the 2026-09-14 candidates; `share:S,reach:M` sets the two knobs directly.
const FOUND_RULES = {
  gate: { foundShare: 0.1, foundReachMinutes: 0 }, // found at the game's gate (F16 first cut)
  double: { foundShare: 1.0, foundReachMinutes: 0 }, // haul ≥ 1.0 × bank — the shipped default
  triple: { foundShare: 2.0, foundReachMinutes: 0 }, // haul ≥ 2.0 × bank (the 2026-09-14 pick)
  targets: { foundShare: 0.1, foundReachMinutes: 20 }, // gate + no upgrade within 20 min of income
  deep: { foundShare: 1.0, foundReachMinutes: 20 }, // double + out of targets
};
const FOUND_ARG = opt('--found', '');
const FOUND = (() => {
  if (!FOUND_ARG) return null;
  if (FOUND_RULES[FOUND_ARG]) return { name: FOUND_ARG, ...FOUND_RULES[FOUND_ARG] };
  const m = /^share:([\d.]+),reach:([\d.]+)$/.exec(FOUND_ARG);
  if (m) return { name: FOUND_ARG, foundShare: Number(m[1]), foundReachMinutes: Number(m[2]) };
  console.error(`[sim] unknown --found "${FOUND_ARG}" (${Object.keys(FOUND_RULES).join(' | ')} | share:S,reach:M)`);
  process.exit(2);
})();
if (FOUND && PROFILE !== 'human') {
  console.error('[sim] --found applies to --profile human only');
  process.exit(2);
}
// --guard strain|sticker (human profile): the grid guard, see the header. Default 'strain'.
const GUARD = String(opt('--guard', 'strain')).toLowerCase();
if (!['strain', 'sticker'].includes(GUARD)) {
  console.error(`[sim] unknown --guard "${GUARD}" (strain | sticker)`);
  process.exit(2);
}
if (GUARD !== 'strain' && PROFILE !== 'human') {
  console.error('[sim] --guard applies to --profile human only');
  process.exit(2);
}
const BOT_OPTS = SAVER ? { saveSeconds: 30 } : PROFILE === 'human' ? { profile: 'human', trace, guard: GUARD, ...(FOUND ? { foundShare: FOUND.foundShare, foundReachMinutes: FOUND.foundReachMinutes } : {}) } : {};

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
// F7 (docs/FEEDBACK.md): the growth-titled rungs — pop/housing at the moment each is bought is
// recorded on the 'upgrade' event and reported as a median across cities (a rung bought at
// pop/housing 1.00 cannot deliver growth; its clause must bind elsewhere).
const F7_UPGRADES = ['welcome-sign', 'green-belts', 'veteran-planners', 'planetary-charter', 'city-archives', 'community-events', 'charter-settlers'];
const popHousingAt = {}; // id → [pop/housing at each purchase]
const freshCycle = (n, startMin) => ({ n, startMin, peakIncome: 0, minHappiness: Infinity, newItems: [], brownoutTicks: 0, brownoutDeepTicks: 0, ticks: 0, maxPowerSurplus: 0, maxUnemployment: 0, landed: {}, granted: false });
let cur = freshCycle(0, 0);
const runMin = () => +(state.time / 60).toFixed(2);

// Reach at unlock (F1 decision gap): seconds of income until the rung is affordable, read the
// moment its unlock latched in this city ((cost − cash) / income; 0 when already affordable;
// Infinity when nothing comes in). Carried onto the purchase log as `reachAtUnlock`, so the
// decision-gap metric can discount a rung that was already affordable when its gate opened
// (a reflex buy, not a decision). Money rungs only; a legacy perk reads 0 when affordable at
// unlock and Infinity otherwise. A rung without an unlock rule never fires 'unlock' (core
// latches it silently), so noteCityUnlocks() stamps those at the first bot step of each city.
const unlockReach = {}; // id → { city, reachSec }
const reachOf = (def) => {
  if (!def) return null;
  if (def.currency === 'legacy') return api.legacyAvailable() >= def.cost ? 0 : Infinity;
  const cash = Number.isFinite(state.res.money) ? state.res.money : 0;
  if (def.cost <= cash) return 0;
  const income = Number.isFinite(derived.income) ? derived.income : 0;
  return income > 0 ? (def.cost - cash) / income : Infinity;
};
game.events.on('unlock', (e) => {
  if (!e || e.kind !== 'upgrade') return;
  unlockReach[e.id] = { city: state.stats.prestiges + 1, reachSec: reachOf(registry.upgrades.get(e.id)) };
});
let unlocksStampedCity = 0;
function noteCityUnlocks() {
  const city = state.stats.prestiges + 1;
  if (unlocksStampedCity === city) return;
  unlocksStampedCity = city;
  for (const u of api.upgrades()) {
    if (!u.unlocked || u.owned) continue;
    const r = unlockReach[u.id];
    if (r && r.city === city) continue;
    unlockReach[u.id] = { city, reachSec: reachOf(u) };
  }
}

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
  purchases.push({ tick: state.tick, kind: 'b', id: e.id, city: state.stats.prestiges + 1 });
  noteFirst('b:' + e.id, e.id);
});
game.events.on('upgrade', (e) => {
  const city = state.stats.prestiges + 1;
  const r = unlockReach[e.id];
  purchases.push({ tick: state.tick, kind: 'u', id: e.id, currency: e.currency, city, reachAtUnlock: r && r.city === city ? r.reachSec : null });
  noteFirst('u:' + e.id, e.id);
  if (F3_UPGRADES.includes(e.id) && cur.landed[e.id] === undefined) cur.landed[e.id] = runMin();
  if (F7_UPGRADES.includes(e.id) && derived.housing > 0) (popHousingAt[e.id] = popHousingAt[e.id] || []).push(+(state.res.pop / derived.housing).toFixed(3));
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
    purchases.push({ tick: state.tick, kind: 'g', id, city: state.stats.prestiges + 1 });
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
    // Seconds this city spent under power (ticks with ratio < 1, exact: 10 ticks per second),
    // the round-2 Lights Out gate's unit — brownoutShare × minutes × 60 rounded to the tick.
    brownoutSeconds: +(cur.brownoutTicks / 10).toFixed(1),
    // Seconds at ratio ≤ 0.95 — the round-3 Lights Out gate's unit: a 0.999 boundary flicker
    // (the strain re-evaluation on the tick after a batch) is under power but not a brownout
    // a player sees; a 5 % shortfall is.
    brownoutDeepSeconds: +(cur.brownoutDeepTicks / 10).toFixed(1),
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
// Under-power ticks per playtime hour (index = hour − 1), counted in the tick loop rather than
// from the 60 s samples: the greedy contract's 3–20 % line is carried by hours 1–2 alone (round
// 1: 0.1–0.7 % in hours 3–12), and this is the line that says so per hour — gated ≥ 1 % in
// ≥ 3 of hours 3–12 for the greedy since round 3. `Deep` = ratio ≤ 0.95 (the Lights Out unit).
const underPowerTicksByHour = [];
const underPowerDeepTicksByHour = [];
const ticksByHour = [];
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
  noteCityUnlocks();
  game.botStep(BOT_OPTS);
  if (purchases.length > before) lastBuyTick = state.tick;
  const n = Math.min(BOT_EVERY, TICKS - t);
  game.step(n);

  cur.ticks += n;
  const hourNow = Math.floor(state.stats.playtime / 3600);
  ticksByHour[hourNow] = (ticksByHour[hourNow] || 0) + n;
  if (derived.powerRatio < 0.9) brownoutTicks += n;
  if (derived.powerRatio < 1) {
    underPowerTicks += n;
    cur.brownoutTicks += n;
    underPowerTicksByHour[hourNow] = (underPowerTicksByHour[hourNow] || 0) + n;
  }
  if (derived.powerRatio <= 0.95) {
    cur.brownoutDeepTicks += n;
    underPowerDeepTicksByHour[hourNow] = (underPowerDeepTicksByHour[hourNow] || 0) + n;
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
    // Report-only since round 2 (nextLegacyRemainingMin): a countdown read at a random moment
    // is uniformly short once points come fast, so it said 0.0 from hour 4 whatever the tempo.
    const nextLegacySec = px && Number.isFinite(px.nextIn) ? px.nextIn : Infinity;
    // The F12 segment (docs/FEEDBACK.md F12: the point N → N+1 bar): minutes the WHOLE current
    // segment (prevAt → nextAt) takes at the rate nextIn is priced at — the game's earningRate
    // (recovered as (nextAt − totalEarned) / nextIn when the countdown is finite, else
    // derived.income). This is the tempo of the bar the player watches, independent of where
    // in the segment the sample lands; gated by hour below (legacySegmentMin).
    const earnedNow = Number.isFinite(state.stats.totalEarned) ? state.stats.totalEarned : 0;
    const earningRate = px && Number.isFinite(px.nextIn) && px.nextIn > 0 && Number.isFinite(px.nextAt) ? (px.nextAt - earnedNow) / px.nextIn : Number.isFinite(derived.income) ? derived.income : 0;
    const segmentSec = px && Number.isFinite(px.nextAt) && Number.isFinite(px.prevAt) && earningRate > 0 ? (px.nextAt - px.prevAt) / earningRate : Infinity;
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
      nextLegacyRemainingMin: Number.isFinite(nextLegacySec) ? +(nextLegacySec / 60).toFixed(2) : null,
      legacySegmentMin: Number.isFinite(segmentSec) ? +(segmentSec / 60).toFixed(3) : null,
      // Seconds of income to the cheapest unlocked, unowned money upgrade (reachSeconds; null
      // when none exists or nothing comes in) — reachShare's per-sample reading, so the share
      // can be re-read over a window of cities (reachShareCities4to9).
      reach: Number.isFinite(reach) ? +reach.toFixed(1) : null,
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
//   nextLegacyMinutesByHour  median minutes the current legacy segment (point N → N+1, the
//                            F12 bar) takes at the earning rate the countdown is priced at
//                            (finite samples only) — gated in hours 2–3 for greedy + human
//   nextLegacyRemainingByHour  the pre-round-2 reading: median minutes LEFT until the next
//                            point at a random sample (report-only)
//   underPowerByHour         share of the hour's ticks with cap/demand < 1 (tick loop, every
//                            profile; gated for the greedy: ≥ 1 % in ≥ 3 of hours 3–12)
//   underPowerDeepByHour     share of the hour's ticks with cap/demand ≤ 0.95 (the Lights Out
//                            unit; reported for every profile)
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
const nextLegacyMinutesByHour = byHour((s) => (s.legacySegmentMin === null ? NaN : s.legacySegmentMin));
const nextLegacyRemainingByHour = byHour((s) => (s.nextLegacyRemainingMin === null ? NaN : s.nextLegacyRemainingMin));
const underPowerByHour = [];
const underPowerDeepByHour = [];
for (let h = 0; h < HOURS; h++) {
  underPowerByHour.push(ticksByHour[h] ? +((underPowerTicksByHour[h] || 0) / ticksByHour[h]).toFixed(4) : null);
  underPowerDeepByHour.push(ticksByHour[h] ? +((underPowerDeepTicksByHour[h] || 0) / ticksByHour[h]).toFixed(4) : null);
}
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
//   medianJobsPerPop   median jobs / pop (pop > 0): the F3 overshoot reading (round 1: 1.06–2.34,
//                      unemployment pinned at 0 %); gated ≤ 1.3 for complete cities ≥ 4 (human)
//   brownoutSeconds    seconds under power (cycles[].brownoutSeconds; the city in progress so far)
//   brownoutDeepSeconds  seconds at ratio ≤ 0.95 (the Lights Out gate's unit since round 3)
//   upgradeRunMinutes  run-minute of every upgrade bought in the city (purchase log, kind 'u')
//   maxUpgradeGapMin   longest stretch with nothing new bought: from the founding to the first,
//                      between consecutive, and from the last to the next founding (a complete
//                      city; the city in progress measures to its last sample) — F1's dead
//                      stretch over ALL upgrade purchases (the pre-round-3 reading, unread)
//   decisionRunMinutes / maxDecisionGapMin   the same over DECISION purchases only: a rung whose
//                      reach at the moment its unlock latched was ≥ 30 s of income (purchase
//                      log `reachAtUnlock`; a rung already affordable when its gate opened is
//                      a reflex buy and is discounted; unknown reach counts) — gated ≤ 20 min
//                      for complete cities 3–9 (3–12 on runs ≥ 24 h) (human)
//   reachHits / reachSamples   samples in the city with the cheapest unlocked, unowned money
//                      upgrade 30 s – 15 min of income away, over all its samples (reachShare
//                      by city; reachShareCities4to9 pools complete cities 4–9)
const CITY_WARMUP_MIN = 2;
const DECISION_REACH_SEC = 30;
const warm = (s) => s.runMin >= CITY_WARMUP_MIN && s.pop >= 100;
const r3 = (v) => (v === null ? null : +v.toFixed(3));
const cityStats = [];
for (let k = 0; k <= state.stats.prestiges; k++) {
  const xs = samples.filter((s) => s.prestiges === k && warm(s));
  const ratios = xs.filter((s) => s.powerDemand > 0).map((s) => s.powerCap / s.powerDemand);
  const ratiosNoRot = xs.filter((s) => s.powerDemand > 0).map((s) => Math.max(0, s.powerCap - (s.powerCapRotation || 0)) / s.powerDemand);
  const unemp = xs.filter((s) => s.pop > 0).map((s) => s.unemployment);
  const jobsPerPop = xs.filter((s) => s.pop > 0).map((s) => s.jobs / s.pop);
  const unempMega = xs.filter((s) => s.pop > 0 && s.megaOwned).map((s) => s.unemployment);
  const cyc = cycles[k];
  const cityUps = purchases.filter((p) => p.kind === 'u' && p.city === k + 1);
  const upMins = cityUps.map((p) => +(p.tick / 600).toFixed(1));
  const isDecision = (p) => p.reachAtUnlock === null || p.reachAtUnlock === undefined || !(p.reachAtUnlock < DECISION_REACH_SEC);
  const decisionMins = cityUps.filter(isDecision).map((p) => +(p.tick / 600).toFixed(1));
  const cityEndMin = cyc ? cyc.minutes : +(state.time / 60).toFixed(2);
  const gapOf = (mins) => {
    let maxGap = 0;
    let prevMin = 0;
    for (const m of mins) {
      maxGap = Math.max(maxGap, m - prevMin);
      prevMin = m;
    }
    return Math.max(maxGap, cityEndMin - prevMin);
  };
  const maxGap = gapOf(upMins);
  const maxDecisionGap = gapOf(decisionMins);
  const all = samples.filter((s) => s.prestiges === k);
  const cityReachHits = all.filter((s) => s.reach !== null && s.reach >= 30 && s.reach <= 900).length;
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
    medianJobsPerPop: r3(median(jobsPerPop)),
    brownoutSeconds: cyc ? cyc.brownoutSeconds : +(cur.brownoutTicks / 10).toFixed(1),
    brownoutDeepSeconds: cyc ? cyc.brownoutDeepSeconds : +(cur.brownoutDeepTicks / 10).toFixed(1),
    upgradeRunMinutes: upMins,
    maxUpgradeGapMin: +maxGap.toFixed(1),
    decisionRunMinutes: decisionMins,
    maxDecisionGapMin: +maxDecisionGap.toFixed(1),
    reachHits: cityReachHits,
    reachSamples: all.length,
  });
}
for (const c of cycles) {
  const cs = cityStats[c.n];
  if (!cs) continue;
  c.medianPowerRatio = cs.medianPowerRatio;
  c.shareSurplus3x = cs.shareSurplus3x;
  c.medianUnemployment = cs.medianUnemployment;
  c.shareUnemp40 = cs.shareUnemp40;
  c.medianJobsPerPop = cs.medianJobsPerPop;
  c.maxUpgradeGapMin = cs.maxUpgradeGapMin;
  c.maxDecisionGapMin = cs.maxDecisionGapMin;
}
// reachShare over the samples of complete cities 4–9 — the decision share the plateau offers
// (the session figure is dominated by the first city's reflex ladder and the replays' first
// minutes). Reported target ≥ 40 %; not gated this round.
const plateauCities = cityStats.filter((c) => c.complete && c.city >= 4 && c.city <= 9);
const plateauSamples = plateauCities.reduce((a, c) => a + c.reachSamples, 0);
const reachShareCities4to9 = plateauSamples ? plateauCities.reduce((a, c) => a + c.reachHits, 0) / plateauSamples : null;
// F7: median pop/housing at purchase per growth-titled rung (across the cities that bought it).
const popHousingAtPurchase = Object.fromEntries(F7_UPGRADES.map((id) => [id, { n: (popHousingAt[id] || []).length, median: r3(median(popHousingAt[id] || [])) }]));
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
// First city that BOUGHT the F3 rung itself (a --grant city does not count): the city, the
// run-minute inside it (purchase log) and the playtime minute (city start + run-minute).
const firstUnassisted = (key) => {
  const c = cityStats.find((c) => c[key] !== null && !c.granted);
  if (!c) return null;
  const cyc = cycles[c.city - 1];
  const startMin = cyc ? cyc.startMin : cur.startMin;
  return { city: c.city, runMin: c[key], min: +(startMin + c[key]).toFixed(1) };
};
const megastructuresFirst = firstUnassisted('megastructuresAt');
const arcologyGardensFirst = firstUnassisted('arcologyGardensAt');

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
const H12 = Math.min(HOURS, 12);
const hourly = (xs, f) => xs.map((v) => (v === null ? '-' : f(v))).join(' ');
const pct = (v) => (v * 100).toFixed(0) + '%';
const hourIdx0 = (h) => h - 1; // 1-based hour → array index
// The unread tail of a by-hour series past hour `to` (nothing on a run that ends there).
const unreadHours = (xs, to, f) => (HOURS > to ? `; hours ${to + 1}–${HOURS} unread: ${hourly(xs.slice(to), f)}` : '');
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
// Last cycle ≤ 40 min reads ONE cycle; the cycles > 40 min that are not last are the unread part.
const over40NotLast = cycles.slice(0, -1).filter((c) => c.minutes > 40);
const over40Note = `cycles > 40 min that are not last: ${over40NotLast.length ? over40NotLast.map((c) => `${c.n} (${c.minutes.toFixed(1)})`).join(', ') : 'none'}`;
if (GATED && cycles.length && cycles[cycles.length - 1].minutes > 40 && hours >= 12) issues.push({ tick: 0, kind: 'cadence', msg: `last cycle ${cycles[cycles.length - 1].minutes} min > 40 min; ${over40Note}` });
const tensionShare = samples.length ? tensionHits / samples.length : 0;
const reachShare = samples.length ? reachHits / samples.length : 0;
if (hours >= 6 && GATED && reachShare < 0.3) issues.push({ tick: 0, kind: 'tension', msg: `next upgrade is 30 s–15 min of income away in only ${(reachShare * 100).toFixed(0)}% of samples (contract ≥ 30%; big-ratio reading ${(tensionShare * 100).toFixed(0)}%)` });
const underPowerShare = underPowerTicks / TICKS;
if (GATED && hours >= 6 && (underPowerShare < 0.03 || underPowerShare > 0.2)) issues.push({ tick: 0, kind: 'power', msg: `under-power share ${(underPowerShare * 100).toFixed(1)}% of the whole session (contract 3–20%; by hour ${hourly(underPowerByHour, (v) => (v * 100).toFixed(2) + '%')})` });
// Sanity only, not a contract line (round 3): config.power.brownoutFloor clamps the ratio at
// 0.6, so this cannot fail; it stays as the check that the clamp is in place.
if (minRatio < 0.6) issues.push({ tick: 0, kind: 'power', msg: `power ratio floor ${minRatio.toFixed(2)} < 0.6 (sanity: config.power.brownoutFloor's clamp; not a contract line)` });
// Greedy by-hour power lines (round 3, replacing the un-failable floor line as the contract's
// "power matters" reading after hour 2): under-power ≥ 1 % of ticks in ≥ 3 of hours 3–12, and
// median cap/demand ≤ 2.5 in hours 3–12 and ≥ 1.0 in hours 2–12 (round 2 read 0.61 0.67 0.44
// 0.11 … and max 2.38 / min 1.05).
const underHours = [];
for (let h = 3; h <= H12; h++) {
  const v = underPowerByHour[hourIdx0(h)];
  if (v !== null && v >= 0.01) underHours.push(`h${h} ${(v * 100).toFixed(2)}%`);
}
const underHoursMsg = `under-power share of ticks ≥ 1 % in ${underHours.length} of hours 3–${H12} (contract ≥ 3)${underHours.length ? `: ${underHours.join(', ')}` : ''}; by hour ${hourly(underPowerByHour, (v) => (v * 100).toFixed(2) + '%')}${unreadHours(underPowerByHour, 12, (v) => (v * 100).toFixed(2) + '%')}`;
if (GATED && hours >= 6 && underHours.length < 3) issues.push({ tick: 0, kind: 'power', msg: underHoursMsg });
const capOver = [];
const capUnder = [];
for (let h = 2; h <= H12; h++) {
  const v = powerRatioByHour[hourIdx0(h)];
  if (v === null) continue;
  if (h >= 3 && v > 2.5) capOver.push(`h${h} ${v.toFixed(2)}`);
  if (v < 1.0) capUnder.push(`h${h} ${v.toFixed(2)}`);
}
const capHoursMsg = `median cap/demand by hour: ${capOver.length ? `> 2.5 in ${capOver.join(', ')}` : `none > 2.5 (hours 3–${H12})`}; ${capUnder.length ? `< 1.0 in ${capUnder.join(', ')}` : `none < 1.0 (hours 2–${H12})`}; by hour ${hourly(powerRatioByHour, (v) => v.toFixed(2))}${unreadHours(powerRatioByHour, 12, (v) => v.toFixed(2))}`;
if (GATED && hours >= 6 && (capOver.length || capUnder.length)) issues.push({ tick: 0, kind: 'power', msg: capHoursMsg });
const happyDips = cycles.filter((c) => c.minHappiness !== null && c.minHappiness < 1).length;
if (GATED && hours >= 6 && cycles.length >= 4 && happyDips < cycles.length * 0.5) issues.push({ tick: 0, kind: 'happiness', msg: `happiness dipped below 1.0 in only ${happyDips}/${cycles.length} cities (contract ≥ 50%)` });
// Reported, not gated (round 2): the dips among the LAST half of the cities (round 1: every
// dip sat in cities 1–21 of 33; cities 22–33 read minHappiness 1.10–1.36 — happiness is
// decorative past city 21, docs/DESIGN.md "Open").
const lastHalf = cycles.slice(Math.floor(cycles.length / 2));
const happinessDipsLastHalf = { dips: lastHalf.filter((c) => c.minHappiness !== null && c.minHappiness < 1).length, cities: lastHalf.length, from: lastHalf.length ? lastHalf[0].n + 1 : null };
// F12 tempo (greedy AND human, runs ≥ 6 h): the median legacy segment (point N → N+1 at the
// countdown's earning rate) in hour 2 within 0.5–30 min and in hour 3 above a profile floor:
// human ≥ 0.5 (round 2 measured 0.72), greedy ≥ 0.25 (its hour 3 is cities 5–9 with 7–12-minute
// cycles on a ×1.4-per-founding legacy sequence, so the segment there is a fraction of the
// human's; round 2 measured 0.45). Hours 4–12 are printed, not gated: the bar is decorative
// past hour 4 on exponent 0.488 (docs/DESIGN.md "Open", docs/FEEDBACK.md F12b).
const legacyTempoFor = (h3Floor, why) => {
  const h2 = nextLegacyMinutesByHour[1] ?? null;
  const h3 = nextLegacyMinutesByHour[2] ?? null;
  const okH2 = h2 !== null && h2 >= 0.5 && h2 <= 30;
  const okH3 = h3 !== null && h3 >= h3Floor;
  const late = nextLegacyMinutesByHour.slice(3, 12).map((v) => (v === null ? '-' : v.toFixed(2))).join(' ');
  return { ok: okH2 && okH3, h3Floor, msg: `median legacy segment (F12 point bar) hour 2 ${h2 === null ? '-' : h2.toFixed(2)} min (contract 0.5–30), hour 3 ${h3 === null ? '-' : h3.toFixed(2)} min (contract ≥ ${h3Floor}${why}); hours 4–12 ${late} — decorative past hour 4 on exponent 0.488 (docs/DESIGN.md Open, FEEDBACK F12b), hours 4–${HOURS} not gated` };
};
const legacyTempo = PROFILE === 'human' ? legacyTempoFor(0.5, '') : legacyTempoFor(0.25, ", the greedy's hour 3 is cities 5–9 with 7–12-minute cycles on a ×1.4-per-founding legacy sequence");
if (GATED && hours >= 6 && !legacyTempo.ok) issues.push({ tick: 0, kind: 'legacy-tempo', msg: legacyTempo.msg });
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

// ---- human-profile contract gates (docs/FEEDBACK.md F1/F2/F3/F12/F16; --profile human, no --grant) ----
// The reproduction of F2 (power runaway) and F3 (unemployment cliff) as gates, fed into `issues`
// so contractPass reflects them. They FAILED on the 2026-09-14 balance (numbers in the header).
// Round 1 (stack ×9.5 / ×0.33, paired housing rungs) passed the 12 h power and unemployment
// lines but its Lights Out line was the human bot's sticker-draw grid guard on UNCHANGED
// content (the pre-wave content latched 4/9 with that bot). Round 3 restores the strain-aware
// guard as the default (src/core/bot.js: the card shows the strain rule and "×N now"), keeps
// the sticker booking as `--guard sticker` for the control line, and re-metrics the gate to
// what content must earn under an honest grid-ahead player: ≥ 30 s at ratio ≤ 0.95 in ≥ 1
// complete city ≥ 4 on the 12 h run, ≥ 2 on a 24 h run. Hours are 1-based game-hours of
// playtime (hour 1 = array index 0); city medians are the warmed-up per-city samples
// (cityStats); every line prints the window it reads and the unread part.
//   power-surplus  median cap/demand ≤ 4.0 in hours 3–H and ≥ 1.0 in hours 2–H (H = hours run);
//                  firstCityWithSurplus3x ≥ 13 or none
//   unemployment   per-city median ≤ 0.20 for every city ≥ 4; by-hour median ≤ 0.15 in hours
//                  2–H (every hour played); 0.85 ≤ median jobs/pop ≤ 1.3 for every complete
//                  city ≥ 4 (round 2: 0.67–1.54); by-hour median inside [2 %, 15 %] in ≥ 3 of
//                  hours 3–12 (round 2: 1 of 10 — the jobs lever never bound after hour 2)
//   lights-out     ≥ 1 complete city ≥ 4 with ≥ 30 s at ratio ≤ 0.95 (≥ 2 on runs ≥ 24 h)
//   cadence (F1)   complete cities 4–9 (4–12 on runs ≥ 24 h): each ≤ 1.35× the previous OR
//                  ≤ 90 min (round 2: 22 → 64 → 79 → 70 → 94 → 148 → 149 min); no stretch
//                  > 20 run-minutes without a DECISION purchase (reach at unlock ≥ 30 s) inside
//                  any complete city 3–9 (3–12 on runs ≥ 24 h); the all-purchases gap and the
//                  plateau reach share (complete cities 4–9, target ≥ 40 %) are printed beside it
//   legacy-tempo   the F12 segment line (hour 2 0.5–30 min, hour 3 ≥ 0.5)
const HUMAN_GATED = PROFILE === 'human' && !GRANT;
const humanGates = [];
const humanReports = [];
const pc = (v) => (v * 100).toFixed(0) + '%';
const gateLine = (kind, ok, msg) => {
  humanGates.push({ kind, ok, msg });
  if (!ok) issues.push({ tick: 0, kind, msg });
};
const lightsOutCitiesLate = cycles.filter((c) => c.n >= 3 && c.brownoutDeepSeconds >= 30);
const cityLabel = (c) => `c${c.city}${c.complete ? '' : '*'}`;
const byCityNote = '(* = the city in progress, unread)';
if (HUMAN_GATED) {
  const over = [];
  const under = [];
  for (let h = 2; h <= HOURS; h++) {
    const v = powerRatioByHour[hourIdx0(h)];
    if (v === null) continue;
    if (h >= 3 && v > 4.0) over.push(`h${h} ${v.toFixed(2)}`);
    if (v < 1.0) under.push(`h${h} ${v.toFixed(2)}`);
  }
  gateLine('power-surplus', !over.length && !under.length, `median cap/demand by hour (hours 2–${HOURS} read, the whole run): ${over.length ? `> 4.0 in ${over.join(', ')}` : `none > 4.0 (hours 3–${HOURS})`}; ${under.length ? `< 1.0 in ${under.join(', ')}` : `none < 1.0 (hours 2–${HOURS})`}; by hour ${hourly(powerRatioByHour, (v) => v.toFixed(2))}`);
  const fs3 = firstSurplusCity ? firstSurplusCity.city : null;
  gateLine('power-surplus', fs3 === null || fs3 >= 13, `first city with median cap/demand ≥ 3× (every city read): ${fs3 ?? 'none'} (contract ≥ 13 or none); by city ${cityStats.map((c) => `${cityLabel(c)} ${c.medianPowerRatio === null ? '-' : c.medianPowerRatio.toFixed(2)}`).join(' ')} ${byCityNote}`);
  const badCities = cityStats.filter((c) => c.city >= 4 && c.medianUnemployment !== null && c.medianUnemployment > 0.2).map((c) => `city ${c.city}${c.complete ? '' : '*'} ${pc(c.medianUnemployment)}`);
  gateLine('unemployment', !badCities.length, `per-city median unemployment > 20 % (cities 4–${cityStats.length} read, the city in progress included): ${badCities.length ? badCities.join(', ') : 'none'}; by city ${cityStats.map((c) => `${cityLabel(c)} ${c.medianUnemployment === null ? '-' : pc(c.medianUnemployment)}`).join(' ')}`);
  const badHours = [];
  for (let h = 2; h <= HOURS; h++) {
    const v = unemploymentByHour[hourIdx0(h)];
    if (v !== null && v > 0.15) badHours.push(`h${h} ${pc(v)}`);
  }
  gateLine('unemployment', !badHours.length, `median unemployment by hour > 15 % (hours 2–${HOURS} read, every hour played, nothing unread): ${badHours.length ? badHours.join(', ') : 'none'}; by hour ${hourly(unemploymentByHour, pc)}`);
  const offJobs = cityStats.filter((c) => c.complete && c.city >= 4 && c.medianJobsPerPop !== null && (c.medianJobsPerPop > 1.3 || c.medianJobsPerPop < 0.85)).map((c) => `city ${c.city} ${c.medianJobsPerPop.toFixed(2)}`);
  gateLine('unemployment', !offJobs.length, `median jobs/pop outside [0.85, 1.3] (complete cities 4–${Math.max(4, cycles.length)} read): ${offJobs.length ? offJobs.join(', ') : 'none'}; by city ${cityStats.map((c) => `${cityLabel(c)} ${c.medianJobsPerPop === null ? '-' : c.medianJobsPerPop.toFixed(2)}`).join(' ')} ${byCityNote}`);
  const inBand = [];
  for (let h = 3; h <= H12; h++) {
    const v = unemploymentByHour[hourIdx0(h)];
    if (v !== null && v >= 0.02 && v <= 0.15) inBand.push(`h${h} ${pc(v)}`);
  }
  gateLine('unemployment', hours < 6 || inBand.length >= 3, `median unemployment inside [2 %, 15 %] in ${inBand.length} of hours 3–${H12} (contract ≥ 3)${inBand.length ? `: ${inBand.join(', ')}` : ''}; hours > 15 % in 2–${HOURS}: ${badHours.length ? badHours.join(', ') : 'none'}${unreadHours(unemploymentByHour, 12, pc)}`);
  const needLights = hours >= 24 ? 2 : 1;
  const secs = cycles.map((c) => c.brownoutSeconds.toFixed(0)).join(' ');
  const deep = cycles.map((c) => c.brownoutDeepSeconds.toFixed(0)).join(' ');
  const inProgress = `${(cur.brownoutTicks / 10).toFixed(0)}/${(cur.brownoutDeepTicks / 10).toFixed(0)}`;
  gateLine('lights-out', hours < 6 || lightsOutCitiesLate.length >= needLights, `Lights Out (≥ 30 s at ratio ≤ 0.95) in ${lightsOutCitiesLate.length} complete cities ≥ 4 (contract ≥ ${needLights}${hours >= 24 ? ' on a 24 h run' : ''}; guard ${GUARD === 'sticker' ? 'sticker (the control)' : 'strain-aware (default)'})${lightsOutCitiesLate.length ? `: ${lightsOutCitiesLate.map((c) => `city ${c.n + 1} ${c.brownoutDeepSeconds} s`).join(', ')}` : ''}; seconds under power (< 1) by complete city ${secs}; seconds at ≤ 0.95 by complete city ${deep}; city ${cycles.length + 1} in progress ${inProgress} (unread)`);
  const lastRatioCity = hours >= 24 ? 12 : 9;
  const badRatio = [];
  const ratios = [];
  for (let i = 1; i < cycles.length; i++) {
    const a = cycles[i - 1], b = cycles[i];
    const r = a.minutes > 0 ? b.minutes / a.minutes : Infinity;
    const read = i >= 3 && i <= lastRatioCity - 1;
    ratios.push(`c${b.n + 1} ×${Number.isFinite(r) ? r.toFixed(2) : '∞'}${read ? '' : '°'}`);
    if (read && b.minutes > a.minutes * 1.35 && b.minutes > 90) badRatio.push(`city ${b.n + 1} ${b.minutes} min > 1.35× city ${a.n + 1} ${a.minutes} min`);
  }
  gateLine('cadence', !badRatio.length, `F1 complete cities 4–${lastRatioCity} each ≤ 1.35× the previous or ≤ 90 min: ${badRatio.length ? badRatio.join('; ') : 'ok'}; cycles ${cycles.map((c) => c.minutes.toFixed(1)).join(' ')}; ratio of every complete city ${ratios.join(' ')} (° = outside the window, unread)`);
  const lastGapCity = hours >= 24 ? 12 : 9;
  const badGap = cityStats.filter((c) => c.complete && c.city >= 3 && c.city <= lastGapCity && c.maxDecisionGapMin > 20).map((c) => `city ${c.city} ${c.maxDecisionGapMin} min`);
  const gapList = (key) => cityStats.map((c) => `${cityLabel(c)}${c.complete && c.city >= 3 && c.city <= lastGapCity ? '' : '°'} ${c[key].toFixed(0)}`).join(' ');
  gateLine('cadence', !badGap.length, `F1 longest stretch without a DECISION upgrade purchase > 20 min (reach at unlock ≥ ${DECISION_REACH_SEC} s; complete cities 3–${lastGapCity}): ${badGap.length ? badGap.join(', ') : 'none'}; decision gap by city ${gapList('maxDecisionGapMin')}; all-purchases gap by city (the pre-round-3 reading, unread) ${gapList('maxUpgradeGapMin')} (° = outside the window / in progress, unread)`);
  humanReports.push(`reachShare over complete cities 4–9: ${reachShareCities4to9 === null ? '-' : pc(reachShareCities4to9)} of ${plateauSamples} samples (reported target ≥ 40 %, not gated; session ${pc(reachShare)}); by city ${cityStats.map((c) => `${cityLabel(c)} ${c.reachSamples ? pc(c.reachHits / c.reachSamples) : '-'}`).join(' ')}`);
  gateLine('legacy-tempo', hours < 6 || legacyTempo.ok, legacyTempo.msg);
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
    nextLegacyRemainingByHour,
    underPowerByHour,
    underPowerDeepByHour,
    underPowerHoursAtLeast1pct: underHours.length,
    over40NotLast: over40NotLast.map((c) => ({ n: c.n, minutes: c.minutes })),
    legacyTempo,
    happinessDipsLastHalf,
    lightsOutReachable: +lightsOutReachable.toFixed(3),
    lightsOutByHour,
    lightsOutCities: cycles.filter((c) => c.lightsOut).length,
    // Per city (1-based; the last entry is the city in progress), warmed-up samples only.
    powerRatioByCity: cityStats.map((c) => c.medianPowerRatio),
    surplus3xShareByCity: cityStats.map((c) => c.shareSurplus3x),
    unemploymentByCity: cityStats.map((c) => c.medianUnemployment),
    unemp40ShareByCity: cityStats.map((c) => c.shareUnemp40),
    jobsPerPopByCity: cityStats.map((c) => c.medianJobsPerPop),
    brownoutSecondsByCity: cityStats.map((c) => c.brownoutSeconds),
    brownoutDeepSecondsByCity: cityStats.map((c) => c.brownoutDeepSeconds),
    lightsOutCitiesLate: lightsOutCitiesLate.map((c) => c.n + 1),
    guard: PROFILE === 'human' ? GUARD : null,
    upgradeGapByCity: cityStats.map((c) => c.maxUpgradeGapMin),
    upgradeRunMinutesByCity: cityStats.map((c) => c.upgradeRunMinutes),
    decisionGapByCity: cityStats.map((c) => c.maxDecisionGapMin),
    decisionRunMinutesByCity: cityStats.map((c) => c.decisionRunMinutes),
    reachShareByCity: cityStats.map((c) => (c.reachSamples ? +(c.reachHits / c.reachSamples).toFixed(3) : null)),
    reachShareCities4to9: reachShareCities4to9 === null ? null : +reachShareCities4to9.toFixed(3),
    // F7: median pop/housing at the moment each growth-titled rung was bought ({ n, median }).
    popHousingAtPurchase,
    firstCityWithSurplus3x: firstSurplusCity ? firstSurplusCity.city : null,
    megastructuresCity: megaSample ? megaSample.prestiges + 1 : null,
    megastructuresMin: megaSample ? megaSample.min : null,
    // First city that bought the F3 rungs itself ({ city, runMin, min }; null when never).
    megastructuresFirst,
    arcologyGardensFirst,
    // Human-profile contract gates ({ kind, ok, msg }; empty for the other profiles / --grant).
    humanGates,
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
  found: FOUND ? FOUND.name : 'default',
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
  `[sim] ${report.pass ? 'PASS' : 'FAIL'} (contract ${report.contractPass ? 'PASS' : 'FAIL'}) ${report.gameHours}h game in ${wallMs}ms (${report.ticksPerSec} t/s) money=${(last.money ?? 0).toExponential(2)} (tick-level max ${maxMoney.toExponential(2)}) income=${(last.income ?? 0).toExponential(2)}/s pop=${Math.round(
    last.pop ?? 0
  )} prestiges=${state.stats.prestiges} legacy=${state.prestige.legacy} (spent ${state.prestige.spent || 0}) issues=${issues.length} errors=${report.errors.length}`
);
console.log(`[sim] cycles(min): ${report.metrics.cycles.map((m) => m.toFixed(1)).join(' ')}`);
console.log(`[sim] profile=${PROFILE} reach=${(reachShare * 100).toFixed(0)}% bigRatio=${(tensionShare * 100).toFixed(0)}% (next-step ${(report.metrics.tensionNextShare * 100).toFixed(0)}%) underPower=${(underPowerShare * 100).toFixed(1)}% minRatio=${minRatio.toFixed(2)} happyDips=${happyDips}/${cycles.length} emptyLate=${emptyCycles.length}`);
const m = report.metrics;
console.log(
  `[sim] ${PROFILE} by hour: power cap/demand ${hourly(powerRatioByHour, (v) => v.toFixed(2))} | unemployment ${hourly(unemploymentByHour, pct)} | legacy segment (min, F12 bar) ${hourly(nextLegacyMinutesByHour, (v) => v.toFixed(2))} (remaining-at-sample ${hourly(nextLegacyRemainingByHour, (v) => v.toFixed(1))}) | lightsOut ${hourly(lightsOutByHour, (v) => (v * 100).toFixed(1) + '%')} of grid samples (${(lightsOutReachable * 100).toFixed(1)}% overall, latched in ${m.lightsOutCities}/${cycles.length} cities)`
);
const powerHourStatus = (ok) => (hours >= 6 && GATED ? (ok ? 'PASS' : 'FAIL') : 'report');
console.log(
  `[sim] ${PROFILE} ${powerHourStatus(underHours.length >= 3)} [power] ${underHoursMsg} | under-power (≤ 0.95) share of ticks by hour ${hourly(underPowerDeepByHour, (v) => (v * 100).toFixed(2) + '%')} | seconds under power (< 1) by city ${m.brownoutSecondsByCity.map((v) => v.toFixed(0)).join(' ')} | seconds at ≤ 0.95 by city ${m.brownoutDeepSecondsByCity.map((v) => v.toFixed(0)).join(' ')}${PROFILE === 'human' ? ` | guard ${GUARD}` : ''}`
);
console.log(`[sim] ${PROFILE} ${powerHourStatus(!capOver.length && !capUnder.length)} [power] ${capHoursMsg}`);
console.log(
  `[sim] ${PROFILE} happiness dips < 1.0 in the last half of the cities: ${happinessDipsLastHalf.dips}/${happinessDipsLastHalf.cities}${happinessDipsLastHalf.from ? ` (from city ${happinessDipsLastHalf.from})` : ''} | ${over40Note} | ${legacyTempo.ok ? 'PASS' : hours >= 6 && (GATED || HUMAN_GATED) ? 'FAIL' : 'n/a'} [legacy-tempo] ${legacyTempo.msg}`
);
console.log(`[sim] ${PROFILE} F7 pop/housing at purchase by rung (median across the cities that bought it; a rung bought at 1.00 cannot deliver growth): ${F7_UPGRADES.map((id) => `${id} ${popHousingAtPurchase[id].median === null ? '-' : popHousingAtPurchase[id].median.toFixed(2)} (×${popHousingAtPurchase[id].n})`).join(' | ')}`);
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
if (HUMAN_GATED) {
  const c6 = playerCheckpoint.atCityEnd;
  const fmtFirst = (f) => (f ? `city ${f.city} @ run-min ${f.runMin} (${f.min} min)` : 'never');
  console.log(
    `[sim] human founding rule ${report.found}: ${cycles.length} foundings in ${report.gameHours}h, legacy at end of city 6 ${c6 ? c6.legacy : '-'} (player 415), Megastructures ${fmtFirst(megastructuresFirst)}, Arcology Gardens ${fmtFirst(arcologyGardensFirst)}, lightsOutReachable ${(lightsOutReachable * 100).toFixed(1)}%`
  );
  for (const g of humanGates) console.log(`[sim] human gate ${g.ok ? 'PASS' : 'FAIL'} [${g.kind}] ${g.msg}`);
  for (const r of humanReports) console.log(`[sim] human report ${r}`);
  console.log(`[sim] human DECISION upgrade purchases by city (run-minute; reach at unlock ≥ ${DECISION_REACH_SEC} s): ${cityStats.map((c) => `c${c.city}[${c.complete ? c.maxDecisionGapMin.toFixed(0) : '…'}]: ${c.decisionRunMinutes.length ? c.decisionRunMinutes.map((v) => v.toFixed(0)).join(' ') : '-'}`).join(' | ')}`);
  console.log(`[sim] human all upgrade purchases by city (run-minute): ${cityStats.map((c) => `c${c.city}[${c.complete ? c.maxUpgradeGapMin.toFixed(0) : '…'}]: ${c.upgradeRunMinutes.length ? c.upgradeRunMinutes.map((v) => v.toFixed(0)).join(' ') : '-'}`).join(' | ')}`);
}
const cp = playerCheckpoint;
const cpFmt = (s) => (s ? `city ${s.city} @ ${s.min} min: income ${s.income.toExponential(2)}/s (×${s.ratioToPlayer.income}), pop ${s.pop} (×${s.ratioToPlayer.pop}), legacy ${s.legacy} (×${s.ratioToPlayer.legacy}), ${s.buildings} bldg, unemployment ${pct(s.unemployment)}, cap/demand ${s.powerRatio ?? '-'}, Megastructures ${s.megastructures ? 'yes' : 'no'}` : 'not reached');
console.log(`[sim] ${PROFILE} vs the player's screenshot (city 6 @ 92 min: $7.89e9/s, 1.53M pop, legacy 415, 1,727 bldg, 43% unemployment, cap/demand 3.52, Megastructures yes): at 92 min → ${cpFmt(cp.atMinute)} | end of city 6 → ${cpFmt(cp.atCityEnd)} | first at the player's income → ${cpFmt(cp.firstAtIncome)}`);
for (const i of issues.slice(0, 14)) console.log(`  - [${i.kind}] t=${i.tick} ${i.msg}`);
console.log(`[sim] wrote ${OUT}`);
process.exit(report.pass ? 0 : 1);
