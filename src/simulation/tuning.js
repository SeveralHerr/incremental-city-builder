// Every balance knob the simulation reads, resolved in one place. DOM-free.
//
// `src/balance/config.js` is the source of truth; the DEFAULTS below are the fallbacks the
// simulation runs on when a config section is missing or a knob is malformed. Each resolver
// returns one shared, frozen object that is rebuilt only when the raw config values change
// (compared field by field on every call), so balance can retune at runtime and the Node sim
// can sweep parameters while the tick loop stays allocation-free. Callers never mutate the
// returned object.
//
// config.prestige knobs read here (all optional; each is bounded to a sane range). The balance
// module owns the numbers; this is the complete list of what the simulation reads:
//   threshold            lifetime earnings worth the first legacy point
//   exponent             legacy total = floor((lifetimeEarned / threshold) ^ exponent); a
//                        founding banks the difference to what is already held. Bounded to
//                        [0.05, 1]: above 1 the bank would outgrow earnings.
//   incomePerLegacy      k in the income bonus (1 + k·legacy) ^ legacyPower
//   legacyPower          p in the bonus above; clamped to [0.25, LEGACY_POWER_MAX] (0.6). The
//                        bonus is always a root of the linear term: no soft cap, no tail, and
//                        p ≤ 0.6 keeps a million-point bank at ×251 for the shipped k = 0.01
//                        (×326 with a 30% first bonus; the shipped p = 0.548, firstBonus 0.18 is ×156 / ×184).
//   firstBonus           one-off multiplier (1 + firstBonus) once any legacy is banked
//   startMoneyPerLegacy  seed cash = economy.startMoney · (1 + startMoneyPerLegacy · legacy)
//   minGain              founding is allowed only once at least this many points are on offer
//   minGainShare         …and, once a bank exists, at least this share of it (0.4: a
//                        1,000-point mayor needs 400 more), so the Found button never arms for
//                        a worthless reset. The resolved requirement is
//                        max(minGain, ceil(legacy · minGainShare)) — derived.extra.prestige.minGain.
//   prestigePanelShare   the Legacy panel opens once this run has earned threshold × share
//                        (0.1: $1.1M at the $11M threshold); a mayor with a bank keeps it open.
// config.economy: startMoney, tapSeconds (a tap pays max($1, grossIncome · tapSeconds · mods.tap)
// out of a meter that refills at tapRefill seconds of output per second — the ceiling on
// sustained tap income; balance may set config.economy.tapRefill, else TAP_REFILL applies).
// config.milestones: popIncomeBonus.
//
// Legacy comes from lifetime earnings only (docs/DESIGN.md, "Late game contract", principle
// 2). The compounding/maturity source and its knobs (compoundPerMinute, peakCarry,
// compoundCap, ripenSeconds, legacyDiscount) and the soft-cap knobs (legacyCap,
// legacyCapTail, legacyCapTailPower) are gone; a config that still carries them is read
// without them. Measured pacing with the shipped config: see the header of prestige.js and
// logs/sim-fix-simulation-12h.json (node tools/economy-sim.mjs --ticks 432000).
import { config } from '../balance/config.js';

// Hard ceiling on the payoff power (contract principle 4: p ≤ 0.6, no soft-cap machinery).
export const LEGACY_POWER_MAX = 0.6;

// Fallbacks: a copy of the shipped numbers in src/balance/config.js, so a missing or
// malformed config section runs the shipped economy rather than a different one.
// simulation.test.mjs asserts every key here equals its config counterpart; when balance
// retunes, this block moves with it.
export const DEFAULTS = Object.freeze({
  prestige: Object.freeze({
    threshold: 1.1e7,
    exponent: 0.488,
    incomePerLegacy: 0.01,
    legacyPower: 0.548,
    firstBonus: 0.18,
    startMoneyPerLegacy: 1,
    minGain: 1,
    minGainShare: 0.4,
    prestigePanelShare: 0.1,
  }),
  economy: Object.freeze({ startMoney: 300, tapSeconds: 1 }),
  milestones: Object.freeze({ popIncomeBonus: 0.02 }),
});

// Sustained tap ceiling: the tap meter refills this many seconds of gross output per game
// second, so a hand (or an autoclicker) at any speed adds at most ×TAP_REFILL the passive
// income, whatever the tap ladder says one tap is worth. Not mirrored in config (balance
// has not adopted the knob); config.economy.tapRefill overrides it when present.
export const TAP_REFILL = 2;

const PRESTIGE_KEYS = Object.keys(DEFAULTS.prestige);
const ECONOMY_KEYS = Object.keys(DEFAULTS.economy).concat('tapRefill');
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
    firstBonus: Math.max(0, finite(p.firstBonus, D.firstBonus)),
    startMoneyPerLegacy: Math.max(0, finite(p.startMoneyPerLegacy, D.startMoneyPerLegacy)),
    minGain: Math.max(1, Math.floor(finite(p.minGain, D.minGain))),
    minGainShare: clamp(finite(p.minGainShare, D.minGainShare), 0, 1),
    prestigePanelShare: clamp(finite(p.prestigePanelShare, D.prestigePanelShare), 0, 1),
  });
}

export function economyTuning(cfg = config) {
  const e = section(cfg, 'economy');
  if (!fresh(economyMemo, e)) return economyMemo.out;
  const D = DEFAULTS.economy;
  return remember(economyMemo, e, {
    startMoney: Math.max(0, finite(e.startMoney, D.startMoney)),
    tapSeconds: Math.max(0, finite(e.tapSeconds, D.tapSeconds)),
    tapRefill: Math.max(0, finite(e.tapRefill, TAP_REFILL)),
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
