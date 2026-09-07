// Safety-margin targets for the placed ladder. DOM-free, Node only.
//
// docs/DESIGN.md's late-game contract is a set of hard gates (first founding 30–45 min,
// every cycle from the 5th founding ≤ ×1.35 the one before, last cycle ≤ 40 min, reach
// ≥ 30 %, under-power 3–20 %, dips in ≥ 50 % of cities, money ≤ 1e18, legacy ≤ 1e6). A
// ladder placed *at* those numbers breaks on the next 1 % retune elsewhere, so
// src/balance/plan.json carries a `targets` block that sits 3–10 % inside every gate, and
// the shipped numbers are held to it: `probe.mjs` prints a margins line, `place.mjs`
// checks its result against it, and balance.test.mjs asserts the shipped 12 h logs meet
// it. The keys (all optional):
//   firstFoundMin / firstFoundMax   minutes of the first founding
//   ratioMax                        strict max cycle ratio from the 5th founding on
//   cycleMax                        every cycle after the first city, minutes
//   lastCycleMax                    the last completed cycle, minutes
//   underPowerMin / underPowerMax   session share of ticks under full power (0–1)
//   reachMin                        share of minute samples with the cheapest open rung
//                                   30 s – 15 min of income away (0–1)
//   dipShareMin                     share of cities whose happiness dips under 1.0 (0–1)
//   foundingsMin / foundingsMax     foundings in 12 h
//   moneyMax / legacyMax            magnitude ceilings
// The reading the checks run on is a plain object:
//   { firstFoundMin, cycles[], maxRatio, reachShare, underShare, dips, foundings, maxMoney, legacy }
// (`probe.mjs` produces one directly; `fromSimLog` maps a tools/economy-sim.mjs log).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PLAN_PATH = path.join(HERE, 'plan.json');
export const RATIO_FROM = 4; // cycles[i] / cycles[i - 1] from the 5th founding (i = 4) on

// Reads a plan file: `{ targets, rungs }`, or the older bare array of rungs (no targets).
export function loadPlan(file = PLAN_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (Array.isArray(raw)) return { targets: {}, rungs: raw };
  return { targets: raw.targets && typeof raw.targets === 'object' ? raw.targets : {}, rungs: Array.isArray(raw.rungs) ? raw.rungs : [] };
}

// Strict max cycle ratio from the 5th founding on: { i, ratio } (ratio 0 when too short).
export function maxCycleRatio(cycles) {
  let best = { i: -1, ratio: 0 };
  for (let i = RATIO_FROM; i < cycles.length; i++) {
    const r = cycles[i] / cycles[i - 1];
    if (r > best.ratio) best = { i, ratio: +r.toFixed(3) };
  }
  return best;
}

// A reading from a tools/economy-sim.mjs log (`metrics`, `final`).
export function fromSimLog(log) {
  const m = log.metrics || {};
  const cycles = Array.isArray(m.cycles) ? m.cycles : [];
  return {
    firstFoundMin: cycles[0] ?? null,
    cycles,
    maxRatio: maxCycleRatio(cycles).ratio,
    reachShare: m.reachShare ?? null,
    underShare: m.underPowerShare ?? null,
    dips: m.happinessDipCities ?? null,
    foundings: cycles.length,
    maxMoney: log.final?.maxMoney ?? null,
    legacy: log.final?.legacy ?? null,
  };
}

// Every target the plan names, checked against the reading: [{ key, value, want, ok }].
// A reading that lacks the value (null) fails the check rather than passing silently.
export function checkTargets(reading, targets = {}) {
  const out = [];
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const add = (key, value, want, ok) => out.push({ key, value, want, ok: value !== null && ok });
  const t = targets;
  const cycles = Array.isArray(reading.cycles) ? reading.cycles : [];
  const later = cycles.slice(1);
  const first = num(reading.firstFoundMin);
  if (t.firstFoundMin !== undefined) add('firstFoundMin', first, `>= ${t.firstFoundMin} min`, first >= t.firstFoundMin);
  if (t.firstFoundMax !== undefined) add('firstFoundMax', first, `<= ${t.firstFoundMax} min`, first <= t.firstFoundMax);
  if (t.ratioMax !== undefined) {
    // probe.mjs reports { i, ratio }; fromSimLog a bare number.
    const r = num(reading.maxRatio && typeof reading.maxRatio === 'object' ? reading.maxRatio.ratio : reading.maxRatio);
    add('ratioMax', r, `<= x${t.ratioMax}`, r <= t.ratioMax);
  }
  if (t.cycleMax !== undefined) {
    const v = later.length ? Math.max(...later) : null;
    add('cycleMax', v, `every cycle after the first <= ${t.cycleMax} min`, v <= t.cycleMax);
  }
  if (t.lastCycleMax !== undefined) {
    const v = cycles.length ? cycles[cycles.length - 1] : null;
    add('lastCycleMax', v, `<= ${t.lastCycleMax} min`, v <= t.lastCycleMax);
  }
  const under = num(reading.underShare);
  if (t.underPowerMin !== undefined) add('underPowerMin', under, `>= ${t.underPowerMin}`, under >= t.underPowerMin);
  if (t.underPowerMax !== undefined) add('underPowerMax', under, `<= ${t.underPowerMax}`, under <= t.underPowerMax);
  if (t.reachMin !== undefined) {
    const v = num(reading.reachShare);
    add('reachMin', v, `>= ${t.reachMin}`, v >= t.reachMin);
  }
  if (t.dipShareMin !== undefined) {
    const d = num(reading.dips);
    const share = d === null || !cycles.length ? null : +(d / cycles.length).toFixed(3);
    add('dipShareMin', share, `>= ${t.dipShareMin}`, share >= t.dipShareMin);
  }
  const n = num(reading.foundings);
  if (t.foundingsMin !== undefined) add('foundingsMin', n, `>= ${t.foundingsMin}`, n >= t.foundingsMin);
  if (t.foundingsMax !== undefined) add('foundingsMax', n, `<= ${t.foundingsMax}`, n <= t.foundingsMax);
  if (t.moneyMax !== undefined) {
    const v = num(reading.maxMoney);
    add('moneyMax', v, `<= ${t.moneyMax.toExponential(0)}`, v <= t.moneyMax);
  }
  if (t.legacyMax !== undefined) {
    const v = num(reading.legacy);
    add('legacyMax', v, `<= ${t.legacyMax.toExponential(0)}`, v <= t.legacyMax);
  }
  return out;
}

// One console line: "margins: 11/12 inside · ratioMax x1.345 (<= x1.32) FAIL".
export function formatChecks(checks) {
  const fails = checks.filter((c) => !c.ok);
  const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) >= 1e6 ? v.toExponential(2) : String(v)) : 'n/a');
  const head = `${checks.length - fails.length}/${checks.length} inside`;
  return fails.length ? `${head} · ${fails.map((c) => `${c.key} ${fmt(c.value)} (${c.want}) FAIL`).join(' · ')}` : `${head}`;
}
