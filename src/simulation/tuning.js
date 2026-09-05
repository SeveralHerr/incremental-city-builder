// Every balance knob the simulation reads, resolved in one place. DOM-free.
//
// `src/balance/config.js` is the source of truth; the DEFAULTS below mirror the shipped
// values so the sim, the prestige rules and the dashboard gates agree even when a config
// section is missing or malformed. Each resolver returns one shared, frozen object that is
// rebuilt only when the raw config values change (compared field by field on every call), so
// balance can retune at runtime and the Node sim can sweep parameters while the tick loop
// stays allocation-free. Callers never mutate the returned object.
//
// config.prestige knobs read here (all optional; each is bounded to a sane range):
//   threshold           lifetime earnings worth the first legacy point ($3M)
//   exponent            legacy total = floor((lifetimeEarned / threshold) ^ exponent); a
//                       founding banks the difference to what is already held. Bounded to
//                       [0.05, 1]: above 1 the earnings source outruns any income curve.
//   incomePerLegacy     k in the raw income bonus (1 + k·legacy) ^ legacyPower − 1
//   legacyPower         p in the raw bonus above; clamped to [0.25, LEGACY_POWER_MAX] (1.5)
//   legacyCap           soft ceiling M on the multiplier (before firstBonus): the curve keeps
//                       its slope near zero and bends to approach M asymptotically. 0 = none
//                       (the raw bonus applies as is — only sane with legacyPower ≤ 1).
//   legacyCapTail       growth past the cap, as a share of the cap: bonus = (M−1) ·
//                       (1 − e^(−x) + legacyCapTail · tail(x)) with x = raw bonus / (M−1)
//   legacyCapTailPower  q in tail(x) = ((1 + x)^q − 1) / q (q = 0 → ln(1 + x)). With q > 0
//                       the multiplier tends to a constant elasticity q past the cap, so a
//                       founding that grows the bank by 25% stays worth +2–5% income across
//                       a session's bank sizes (tens of thousands to millions of points) and
//                       approaches +25%·q (q 0.3: +7%) beyond; the log tail flattens to under
//                       +1% within hours. Clamped to [0, 0.5] so the tail never outruns the
//                       bank. legacyCapTail scales how soon the tail takes over.
//   firstBonus          one-off multiplier (1 + firstBonus) once any legacy is banked
//   legacyDiscount      0..1: lifetime earnings count as lifetime / mult ^ legacyDiscount toward
//                       the earnings-based legacy (1 = the bonus never speeds up the next points)
//   compoundPerMinute   share of banked legacy a founding adds per minute of maturity
//                       (maturity = totalEarned / peakIncome, seconds of best income banked)
//   ripenSeconds        maturity at which the earnings-based share is banked in full; below it
//                       that share scales by maturity / ripenSeconds (0 = banked in full at any
//                       maturity, the shipped value)
//   startMoneyPerLegacy seed cash = economy.startMoney · (1 + startMoneyPerLegacy · legacy)
//   minGain             founding is allowed only once at least this many points are on offer
// config.economy: startMoney, tapSeconds. config.milestones: popIncomeBonus.
import { config } from '../balance/config.js';

// Hard ceiling on the payoff power: (1 + k·L)^p with p above this outruns any gain curve.
export const LEGACY_POWER_MAX = 1.5;
// Hard ceiling on the tail elasticity past the soft cap (see legacyCapTailPower).
export const LEGACY_TAIL_POWER_MAX = 0.5;

// Mirror of config.prestige (balance owns the numbers; keep these in step). Exponent 0.35:
// against lifetime earnings the bot's "25% more legacy" reset needs each run to out-earn
// everything before it by 1.25^(1/exponent) — 1.9× here, enough to stay ahead of a
// legacy-boosted rebuild; 0.5 (1.56×) lets the mid game collapse into 80-second cycles.
export const DEFAULTS = Object.freeze({
  prestige: Object.freeze({
    threshold: 3e6,
    exponent: 0.35,
    incomePerLegacy: 0.04,
    legacyPower: 0.5,
    legacyCap: 0,
    legacyCapTail: 0.05,
    legacyCapTailPower: 0.3,
    firstBonus: 0.5,
    compoundPerMinute: 0.08,
    ripenSeconds: 0,
    legacyDiscount: 1,
    startMoneyPerLegacy: 0.1,
    minGain: 1,
  }),
  economy: Object.freeze({ startMoney: 280, tapSeconds: 1 }),
  milestones: Object.freeze({ popIncomeBonus: 0.02 }),
});

const PRESTIGE_KEYS = Object.keys(DEFAULTS.prestige);
const ECONOMY_KEYS = Object.keys(DEFAULTS.economy);
const MILESTONE_KEYS = Object.keys(DEFAULTS.milestones);

function finite(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

const EMPTY = Object.freeze({});

function section(cfg, name) {
  const s = cfg && typeof cfg === 'object' ? cfg[name] : undefined;
  return s && typeof s === 'object' ? s : EMPTY;
}

// One memo per resolver: the raw section values seen last time (Object.is-compared, so a NaN
// knob does not force a rebuild every call) and the frozen resolved object built from them.
function memo(keys) {
  return { src: null, raw: new Array(keys.length).fill(undefined), out: null, keys };
}

function fresh(m, src) {
  if (m.out === null || m.src !== src) return true;
  const keys = m.keys;
  for (let i = 0; i < keys.length; i++) if (!Object.is(m.raw[i], src[keys[i]])) return true;
  return false;
}

function remember(m, src, out) {
  m.src = src;
  const keys = m.keys;
  for (let i = 0; i < keys.length; i++) m.raw[i] = src[keys[i]];
  m.out = Object.freeze(out);
  return m.out;
}

const prestigeMemo = memo(PRESTIGE_KEYS);
const economyMemo = memo(ECONOMY_KEYS);
const milestoneMemo = memo(MILESTONE_KEYS);

// Resolved prestige knobs, each bounded to a sane range. Shared object; do not mutate.
export function prestigeTuning(cfg = config) {
  const p = section(cfg, 'prestige');
  if (!fresh(prestigeMemo, p)) return prestigeMemo.out;
  const D = DEFAULTS.prestige;
  const threshold = finite(p.threshold, D.threshold);
  return remember(prestigeMemo, p, {
    threshold: threshold > 0 ? threshold : D.threshold,
    exponent: clamp(finite(p.exponent, D.exponent), 0.05, 1),
    incomePerLegacy: Math.max(0, finite(p.incomePerLegacy, D.incomePerLegacy)),
    legacyPower: clamp(finite(p.legacyPower, D.legacyPower), 0.25, LEGACY_POWER_MAX),
    legacyCap: Math.max(0, finite(p.legacyCap, D.legacyCap)),
    legacyCapTail: Math.max(0, finite(p.legacyCapTail, D.legacyCapTail)),
    legacyCapTailPower: clamp(finite(p.legacyCapTailPower, D.legacyCapTailPower), 0, LEGACY_TAIL_POWER_MAX),
    firstBonus: Math.max(0, finite(p.firstBonus, D.firstBonus)),
    compoundPerMinute: Math.max(0, finite(p.compoundPerMinute, D.compoundPerMinute)),
    ripenSeconds: Math.max(0, finite(p.ripenSeconds, D.ripenSeconds)),
    legacyDiscount: clamp(finite(p.legacyDiscount, D.legacyDiscount), 0, 1),
    startMoneyPerLegacy: Math.max(0, finite(p.startMoneyPerLegacy, D.startMoneyPerLegacy)),
    minGain: Math.max(1, Math.floor(finite(p.minGain, D.minGain))),
  });
}

export function economyTuning(cfg = config) {
  const e = section(cfg, 'economy');
  if (!fresh(economyMemo, e)) return economyMemo.out;
  const D = DEFAULTS.economy;
  return remember(economyMemo, e, {
    startMoney: Math.max(0, finite(e.startMoney, D.startMoney)),
    tapSeconds: Math.max(0, finite(e.tapSeconds, D.tapSeconds)),
  });
}

export function milestoneTuning(cfg = config) {
  const m = section(cfg, 'milestones');
  if (!fresh(milestoneMemo, m)) return milestoneMemo.out;
  const D = DEFAULTS.milestones;
  return remember(milestoneMemo, m, {
    popIncomeBonus: Math.max(0, finite(m.popIncomeBonus, D.popIncomeBonus)),
  });
}
