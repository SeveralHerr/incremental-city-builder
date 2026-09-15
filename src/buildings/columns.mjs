// Session probe for the two columns the catalogue balances against each other — jobs and
// housing — and for the legacy-gated tier-5 cards. DOM-free, Node only.
//   node src/buildings/columns.mjs [--ticks 432000] [--every 10] [--json]
// Boots the game and plays the greedy bot for --ticks (default 12 game-hours), sampling
// every --every game-minutes: which city, population, jobs, the jobs-to-population ratio,
// and the biggest sources of each column. Two rules, both measured on mature cities only
// (from the 5th founding on — the first city and the early replays are still assembling
// their ladder — and past a replay's first MATURE_RUN_MIN minutes: its opening minute is
// an all-housing spree by design, a sample there reads the fleet mid-assembly, e.g. a
// 13th city at run-minute 0.2 with two factories and a house at 2.7 jobs per citizen):
//   columns   the median jobs/pop ratio sits inside RATIO_MIN..RATIO_MAX and at least
//             RATIO_SHARE of the samples sit inside the wider SPAN_MIN..SPAN_MAX —
//             employed = min(pop, jobs), so a ratio far above the band is a jobs column
//             nobody fills (a tier-4 employer's sticker that is decoration) and a ratio
//             under 1 is a city that cannot employ its citizens. The wider span is the
//             swing the upgrade rungs impose (their housing multipliers outrun the jobs
//             multipliers ×37.5 to ×21.1 across a session after the 2026-09-14 round-3
//             re-pairing — ×17.3 before it — the global `(hous/jobs)` mods); the
//             catalogue's stickers and the ring's population-scaled hiring hold the ratio
//             inside it, they cannot hold a 1.6× band across a ~2× swing;
//   tier 5    every legacy-gated card opens during the session, is bought within
//             T5_BUY_CITIES cities of opening, and keeps being bought afterwards (a
//             megastructure is a rolling target, not a one-off trophy).
// Both column readings are reported AND judged — with the opening-minute filter (`ratio`
// in --json, the first summary line in text) and without it (`ratio.unfiltered`, the
// second line): the ≥ RATIO_SHARE rule is a problem on either reading (round 3; until then
// the rule was quoted for both and applied to the filtered set only, which a round-1
// skeptic named). Measured 12 h on the greedy: round-2 tree 78 % / 72 % (the unfiltered
// misses beyond the opening minutes were cities 25–28 and 32 at 0.71–0.76, the housing
// rungs ahead of the jobs rungs); with the round-3 upgrades re-pairing as landed (before
// balance's tail re-placement) 94.8 % / 92.2 % — both in-span lines clear the rule — with
// the median at 0.99 / 0.99, one hundredth under RATIO_MIN: the mature ratios sort
// 0.69 0.71 0.78 0.80 … 0.99 ×5 | 1.00 … 1.28, the dips are cities 16–18 (0.69–0.82,
// global mods housing ×3.75 / jobs ×2.25 right after Megastructures) and 23–26
// (0.82–0.89). That floor is NOT moved here: the contract's per-city band is now
// 0.85–1.3 with a deliberate 2–8 % jobless stretch after each housing step, so a median
// a hair under 1.0 is the state the plan asks for, and whether RATIO_MIN is re-derived
// from that band is the integrator's call, not a tune to pass this file. (A scratch A/B
// of the plan's effects with 1× fleet prices read 96 % / 94 %, medians 1.04 / 1.02.)
// Resolved by the re-placement, not by the floor (wave 2 round 2): with balance's tail
// re-placement and Blueprints ×1.12 sweep landed the same 12 h probe reads median 1.1 / 1.1,
// 98 % / 97 % in span, 67 % / 69 % inside the band (min 0.75, max 1.27 filtered / 3.54
// unfiltered — one opening-minute sample), 35 foundings, ring city 14, elevator city 33;
// 6 h median 1.11 / 1.12, 95 % / 93 %. RATIO_MIN stays 1.0 — the greedy median clears it
// with a tenth to spare, so the band was never the thing holding it under.
// Exit code 1 when a rule is broken or the game raised an error. buildings.test.mjs spawns
// it at 6 and at 12 game-hours (the ring opens inside 6 h, the elevator inside 12 h).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const TICKS = Number(opt('--ticks', 432000));
const EVERY_S = Number(opt('--every', 10)) * 60;
const JSON_OUT = args.includes('--json');
const BOT_EVERY = 20;
export const RATIO_MIN = 1.0;
export const RATIO_MAX = 1.6;
export const SPAN_MIN = 0.8; // 20% unemployment at worst …
export const SPAN_MAX = 2.0; // … and at most half a job sticker decorative
export const RATIO_SHARE = 0.75; // of mature samples inside the span
export const MATURE_FROM_CITY = 5;
export const MATURE_RUN_MIN = 2; // game-minutes into a city before its samples count
export const T5_BUY_CITIES = 2; // a legacy-gated card is bought within this many cities of opening

const toUrl = (p) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:');
const { boot, game } = await import(toUrl(path.join(ROOT, 'src/boot.js')));
await boot();
const { state, derived, registry, events } = game;

const city = () => state.stats.prestiges;
const minute = () => state.stats.playtime / 60;
// Legacy-only gates: the cards the first-city probe (cadence.mjs) cannot reach.
const tier5 = registry.buildingOrder.filter((id) => {
  const at = registry.buildings.get(id)?.unlockAt;
  return at && Number.isFinite(at.legacy) && !Number.isFinite(at.pop);
});
const t5 = new Map(tier5.map((id) => [id, { id, gate: registry.buildings.get(id).unlockAt.legacy, openCity: null, openMin: null, buyCity: null, buyMin: null, buys: 0, citiesBought: new Set() }]));
events.on('unlock', (e) => {
  const r = e?.kind === 'building' ? t5.get(e.id) : null;
  if (r && r.openCity === null) {
    r.openCity = city();
    r.openMin = +minute().toFixed(1);
  }
});
events.on('buy', (e) => {
  const r = t5.get(e?.id);
  if (!r) return;
  if (r.buyCity === null) {
    r.buyCity = city();
    r.buyMin = +minute().toFixed(1);
  }
  r.buys += e.n || 1;
  r.citiesBought.add(city());
});

const samples = [];
function sample() {
  const jobs = [], housing = [];
  for (const id of registry.buildingOrder) {
    const d = registry.buildings.get(id);
    const c = state.buildings[id] || 0;
    if (!c) continue;
    if (d.jobs > 0) jobs.push([id, c * d.jobs]);
    if (d.housing > 0) housing.push([id, c * d.housing]);
  }
  const top = (a) => {
    const tot = a.reduce((s, x) => s + x[1], 0) || 1;
    return a
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([id, v]) => `${id} ${Math.round((100 * v) / tot)}%`)
      .join(' ');
  };
  const pop = state.res.pop;
  // Effective upgrade / perk / milestone multiplier on each column: derived total over the
  // sum of the live per-unit stats (synergies included, so this is the mods alone).
  const sum = (a) => a.reduce((s, x) => s + x[1], 0);
  const mult = (total, stickers) => (stickers > 0 ? +(total / stickers).toFixed(2) : null);
  samples.push({
    min: +minute().toFixed(1),
    city: city(),
    runMin: +(state.time / 60).toFixed(1),
    pop: Math.round(pop),
    jobs: Math.round(derived.jobs),
    ratio: pop > 0 ? +(derived.jobs / pop).toFixed(2) : null,
    employedShare: pop > 0 ? +(derived.employed / pop).toFixed(3) : null,
    happiness: +derived.happiness.toFixed(2),
    housingMult: mult(derived.housing, sum(housing)),
    jobsMult: mult(derived.jobs, sum(jobs)),
    globalHousingMod: +(derived.mods?.housing ?? 1).toFixed(2),
    globalJobsMod: +(derived.mods?.jobs ?? 1).toFixed(2),
    topJobs: top(jobs),
    topHousing: top(housing),
  });
}

let nextAt = EVERY_S;
for (let t = 0; t < TICKS; t += BOT_EVERY) {
  game.botStep();
  game.step(Math.min(BOT_EVERY, TICKS - t));
  if (state.stats.playtime >= nextAt) {
    nextAt += EVERY_S;
    sample();
  }
}

const problems = [];
// The ratio statistics over a sample set: median, share inside the band and the span.
const stats = (set) => {
  const ratios = set.map((s) => s.ratio).sort((a, b) => a - b);
  const median = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
  const inBand = set.filter((s) => s.ratio >= RATIO_MIN && s.ratio <= RATIO_MAX).length;
  const inSpan = set.filter((s) => s.ratio >= SPAN_MIN && s.ratio <= SPAN_MAX).length;
  return { median, bandShare: set.length ? inBand / set.length : 0, share: set.length ? inSpan / set.length : 0, min: ratios[0] ?? null, max: ratios[ratios.length - 1] ?? null, n: set.length };
};
// Two readings, both reported (a round-1 skeptic asked for the share with and without the
// opening-minute filter so the >= 75 % rule can be read against both): `mature` sets a
// replay's first MATURE_RUN_MIN minutes aside (the rule is judged on it), `matureAll`
// keeps them.
const matureAll = samples.filter((s) => s.city >= MATURE_FROM_CITY && s.ratio !== null);
const mature = matureAll.filter((s) => s.runMin >= MATURE_RUN_MIN);
const opening = matureAll.length - mature.length;
const filtered = stats(mature);
const unfiltered = stats(matureAll);
const { median, bandShare, share } = filtered;
const FIX = 'fix: data.js financial.jobs / techpark.jobs / stadium.synergy.cap / arcology.synergy / ring.synergy';
if (median !== null && (median < RATIO_MIN || median > RATIO_MAX)) {
  problems.push(`median jobs/pop ${median} in mature cities is outside ${RATIO_MIN}–${RATIO_MAX} — ${FIX}`);
}
if (mature.length && share < RATIO_SHARE) {
  problems.push(`only ${Math.round(share * 100)}% of mature samples (past run-minute ${MATURE_RUN_MIN}) have jobs/pop inside ${SPAN_MIN}–${SPAN_MAX} (rule ≥ ${RATIO_SHARE * 100}%) — ${FIX}`);
}
// The same rule on the unfiltered reading: the opening-minute samples are kept, so a session
// whose replays open with long all-housing sprees, or whose late cities sit under the span,
// fails here even when the filtered set clears the line.
if (matureAll.length && unfiltered.share < RATIO_SHARE) {
  problems.push(`only ${Math.round(unfiltered.share * 100)}% of ALL mature samples (opening minutes kept; ${Math.round(share * 100)}% with them set aside) have jobs/pop inside ${SPAN_MIN}–${SPAN_MAX} (rule ≥ ${RATIO_SHARE * 100}% on both readings) — ${FIX}`);
}
const finalCity = city();
const bank = state.prestige?.legacy ?? 0;
for (const r of t5.values()) {
  if (r.openCity === null) {
    // A gate the session's bank never reached is a window too short for the card, not a
    // fault (the 6 h test window reaches the ring but not the elevator).
    if (bank >= r.gate) problems.push(`${r.id} (legacy ${r.gate.toLocaleString('en-US')}) never opened although the bank reached ${bank} — fix: data.js ${r.id}.unlock`);
    else r.note = `gate not reached in this window (bank ${bank})`;
    continue;
  }
  if (r.buyCity === null) {
    if (finalCity - r.openCity >= T5_BUY_CITIES) problems.push(`${r.id} opened in city ${r.openCity} (${r.openMin} min) and was never bought — fix: data.js ${r.id}.baseCost`);
    continue;
  }
  if (r.buyCity - r.openCity > T5_BUY_CITIES) problems.push(`${r.id} opened in city ${r.openCity} but was first bought in city ${r.buyCity}, more than ${T5_BUY_CITIES} cities later — fix: data.js ${r.id}.baseCost`);
  if (finalCity - r.buyCity >= 3 && r.citiesBought.size < 2) problems.push(`${r.id} was bought in one city only (${r.buyCity}) across ${finalCity - r.buyCity} later cities — fix: data.js ${r.id}.costGrowth`);
}

const report = {
  ticks: TICKS,
  gameHours: +(TICKS / 36000).toFixed(2),
  foundings: finalCity,
  rules: { ratioMin: RATIO_MIN, ratioMax: RATIO_MAX, spanMin: SPAN_MIN, spanMax: SPAN_MAX, ratioShare: RATIO_SHARE, matureFromCity: MATURE_FROM_CITY, matureRunMin: MATURE_RUN_MIN, t5BuyCities: T5_BUY_CITIES },
  ratio: {
    median,
    inBandShare: +bandShare.toFixed(3),
    inSpanShare: +share.toFixed(3),
    matureSamples: mature.length,
    openingSamples: opening,
    min: filtered.min,
    max: filtered.max,
    // The same statistics with the opening-minute samples kept (no MATURE_RUN_MIN filter).
    unfiltered: { median: unfiltered.median, inBandShare: +unfiltered.bandShare.toFixed(3), inSpanShare: +unfiltered.share.toFixed(3), matureSamples: unfiltered.n, min: unfiltered.min, max: unfiltered.max },
  },
  tier5: [...t5.values()].map((r) => ({ ...r, citiesBought: [...r.citiesBought] })),
  samples,
  problems,
  errors: game.errors,
};
if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 1));
} else {
  console.log(`${report.gameHours} h, ${finalCity} foundings, errors ${game.errors.length}`);
  console.log('  min  city   run      pop       jobs  ratio  empl  joy  ×hous ×jobs (global)  top jobs / top housing');
  for (const s of samples) {
    console.log(`${String(s.min).padStart(5)}  ${String(s.city).padStart(4)}  ${String(s.runMin).padStart(4)}  ${s.pop.toExponential(2).padStart(8)}  ${s.jobs.toExponential(2).padStart(8)}  ${String(s.ratio ?? '—').padStart(5)}  ${String(s.employedShare ?? '—').padStart(5)}  ${String(s.happiness).padStart(4)}  ${String(s.housingMult ?? '—').padStart(5)} ${String(s.jobsMult ?? '—').padStart(5)} (${s.globalHousingMod}/${s.globalJobsMod})  ${s.topJobs} / ${s.topHousing}`);
  }
  console.log(`mature cities (≥ ${MATURE_FROM_CITY}, past run-minute ${MATURE_RUN_MIN}): median jobs/pop ${median}, ${Math.round(bandShare * 100)}% of ${mature.length} samples inside ${RATIO_MIN}–${RATIO_MAX}, ${Math.round(share * 100)}% inside ${SPAN_MIN}–${SPAN_MAX} (min ${report.ratio.min}, max ${report.ratio.max}; ${opening} opening-minute samples set aside)`);
  console.log(`  without the opening-minute filter (all ${unfiltered.n} samples from city ${MATURE_FROM_CITY}): median ${unfiltered.median}, ${Math.round(unfiltered.bandShare * 100)}% inside ${RATIO_MIN}–${RATIO_MAX}, ${Math.round(unfiltered.share * 100)}% inside ${SPAN_MIN}–${SPAN_MAX} (min ${unfiltered.min}, max ${unfiltered.max})`);
  for (const r of report.tier5) {
    if (r.note) console.log(`${r.id.padEnd(9)} legacy ${r.gate.toLocaleString('en-US').padStart(6)}: ${r.note}`);
    else console.log(`${r.id.padEnd(9)} legacy ${r.gate.toLocaleString('en-US').padStart(6)}: opened city ${r.openCity} (${r.openMin} min), first bought city ${r.buyCity ?? '—'} (${r.buyMin ?? '—'} min), ${r.buys} bought across ${r.citiesBought.length} cities [${r.citiesBought.join(' ')}]`);
  }
  console.log(problems.length ? 'problems:\n  ' + problems.join('\n  ') : 'no column or tier-5 problems');
}
process.exit(problems.length || game.errors.length ? 1 : 0);
