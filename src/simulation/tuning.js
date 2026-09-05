// Every balance knob the simulation reads, resolved in one place. DOM-free.
//
// `src/balance/config.js` is the source of truth; the DEFAULTS below mirror the shipped
// values so the sim, the prestige rules and the dashboard gates agree even when a config
// section is missing or malformed. Readers call these each time (no caching) so balance can
// retune at runtime and the Node sim can sweep parameters.
import { config } from '../balance/config.js';

export const DEFAULTS = Object.freeze({
  prestige: Object.freeze({
    threshold: 1e6, // totalEarned needed before a city can be founded
    exponent: 0.35, // legacy gained = floor((totalEarned / threshold) ^ exponent)
    incomePerLegacy: 0.04, // linear part: ×(1 + incomePerLegacy·legacy)
    // The linear part is raised to this power. Left unset (null) it tracks the gain
    // exponent as max(1, 1/exponent − 1): 1 (plain linear) at exponent 0.5, 1.86 at 0.35,
    // so cycle length grows only slowly with banked legacy whatever the gain curve is
    // (see prestige.js for the reasoning).
    legacyPower: null,
    // One-off multiplier once any legacy exists, so the first founding is a real jump.
    firstBonus: 0.5,
    startMoneyPerLegacy: 0.1, // seed cash = startMoney·(1 + startMoneyPerLegacy·legacy)
    minGain: 1, // canPrestige also requires at least this many points on offer
  }),
  economy: Object.freeze({ startMoney: 210, tapSeconds: 1 }),
  milestones: Object.freeze({ popIncomeBonus: 0.02 }),
});

function finite(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
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
  const exponent = Math.max(0.05, finite(p.exponent, D.exponent));
  const autoPower = Math.max(1, 1 / exponent - 1);
  return {
    threshold: threshold > 0 ? threshold : D.threshold,
    exponent,
    incomePerLegacy: Math.max(0, finite(p.incomePerLegacy, D.incomePerLegacy)),
    legacyPower: Math.max(0.25, finite(p.legacyPower, autoPower)),
    firstBonus: Math.max(0, finite(p.firstBonus, D.firstBonus)),
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
