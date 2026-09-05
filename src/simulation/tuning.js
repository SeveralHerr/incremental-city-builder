// Every balance knob the simulation reads, resolved in one place. DOM-free.
//
// `src/balance/config.js` is the source of truth; the DEFAULTS below mirror the shipped
// values so the sim, the prestige rules and the dashboard gates agree even when a config
// section is missing or malformed. Readers call these each time (no caching) so balance can
// retune at runtime and the Node sim can sweep parameters.
//
// config.prestige knobs read here (all optional; each is bounded to a sane range):
//   threshold           lifetime earnings worth the first legacy point
//   exponent            legacy total = floor((lifetimeEarned / threshold) ^ exponent); a
//                       founding banks the difference to what is already held
//   incomePerLegacy     k in the income multiplier (1 + k·legacy) ^ legacyPower
//   legacyPower         p in the multiplier above; clamped to [0.25, LEGACY_POWER_MAX]
//   legacyCap           soft ceiling M on that multiplier (before firstBonus): the curve keeps
//                       its slope near zero and bends to approach M asymptotically. 0 = none.
//   legacyCapTail       slope past the cap, as a share of the cap per e-fold of raw bonus
//                       (0.05: a raw bonus of 10,000× the cap is worth ×1.46 the cap)
//   firstBonus          one-off multiplier (1 + firstBonus) once any legacy is banked
//   legacyDiscount      0..1: lifetime earnings count as lifetime / mult ^ legacyDiscount toward
//                       the earnings-based legacy (1 = the bonus never speeds up the next points)
//   compoundPerMinute   share of banked legacy a founding adds per minute of maturity
//                       (maturity = totalEarned / peakIncome, seconds of best income banked)
//   startMoneyPerLegacy seed cash = economy.startMoney · (1 + startMoneyPerLegacy · legacy)
//   minGain             founding is allowed only once at least this many points are on offer
// config.economy: startMoney, tapSeconds. config.milestones: popIncomeBonus.
import { config } from '../balance/config.js';

// Hard ceiling on the payoff power: (1 + k·L)^p with p above this outruns any gain curve.
export const LEGACY_POWER_MAX = 2;

// Mirror of config.prestige (balance owns the numbers; keep these in step). Exponent 0.35:
// against lifetime earnings the bot's "25% more legacy" reset needs each run to out-earn
// everything before it by 1.25^(1/exponent) — 1.9× here, enough to stay ahead of a
// legacy-boosted rebuild; 0.5 (1.56×) lets the mid game collapse into 80-second cycles.
export const DEFAULTS = Object.freeze({
  prestige: Object.freeze({
    threshold: 1e6,
    exponent: 0.35,
    incomePerLegacy: 0.04,
    legacyPower: 1,
    legacyCap: 100,
    legacyCapTail: 0.05,
    firstBonus: 0.5,
    compoundPerMinute: 0.025,
    legacyDiscount: 1,
    startMoneyPerLegacy: 0.1,
    minGain: 3,
  }),
  economy: Object.freeze({ startMoney: 260, tapSeconds: 1 }),
  milestones: Object.freeze({ popIncomeBonus: 0.02 }),
});

function finite(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function section(cfg, name) {
  const s = cfg && typeof cfg === 'object' ? cfg[name] : undefined;
  return s && typeof s === 'object' ? s : {};
}

// Resolved prestige knobs, each bounded to a sane range.
export function prestigeTuning(cfg = config) {
  const p = section(cfg, 'prestige');
  const D = DEFAULTS.prestige;
  const threshold = finite(p.threshold, D.threshold);
  return {
    threshold: threshold > 0 ? threshold : D.threshold,
    exponent: Math.max(0.05, finite(p.exponent, D.exponent)),
    incomePerLegacy: Math.max(0, finite(p.incomePerLegacy, D.incomePerLegacy)),
    legacyPower: clamp(finite(p.legacyPower, D.legacyPower), 0.25, LEGACY_POWER_MAX),
    legacyCap: Math.max(0, finite(p.legacyCap, D.legacyCap)),
    legacyCapTail: Math.max(0, finite(p.legacyCapTail, D.legacyCapTail)),
    firstBonus: Math.max(0, finite(p.firstBonus, D.firstBonus)),
    compoundPerMinute: Math.max(0, finite(p.compoundPerMinute, D.compoundPerMinute)),
    legacyDiscount: clamp(finite(p.legacyDiscount, D.legacyDiscount), 0, 1),
    startMoneyPerLegacy: Math.max(0, finite(p.startMoneyPerLegacy, D.startMoneyPerLegacy)),
    minGain: Math.max(1, Math.floor(finite(p.minGain, D.minGain))),
  };
}

export function economyTuning(cfg = config) {
  const e = section(cfg, 'economy');
  const D = DEFAULTS.economy;
  return {
    startMoney: Math.max(0, finite(e.startMoney, D.startMoney)),
    tapSeconds: Math.max(0, finite(e.tapSeconds, D.tapSeconds)),
  };
}

export function milestoneTuning(cfg = config) {
  const m = section(cfg, 'milestones');
  const D = DEFAULTS.milestones;
  return {
    popIncomeBonus: Math.max(0, finite(m.popIncomeBonus, D.popIncomeBonus)),
  };
}
