// Metropolis — balance configuration.
// The single source of tuning truth. Every number that shapes pacing lives here so the
// balance owner can retune the game without touching any other folder.
// DOM-free: this file must import cleanly in Node (economy-sim) and the browser.
//
// Pacing targets (greedy bot, no prestige):
//   first building < 5 s · first upgrade ~1 min · first brownout ~3 min · 1k pop ~8 min
//   $1M total earned (prestige available) ~35–50 min · income ≈ 10× per game-hour early.
//
// Consumers: resources.computeDerived (economy/pop/power/happiness), buildings (cost +
// per-building overrides), upgrades (cost overrides), simulation (prestige, milestones,
// startMoney, tap), save (autosave/offline).

export const config = {
  /**
   * Core money flow.
   * - startMoney: seed cash on a fresh run. 50 buys one house ($30) immediately, which
   *   satisfies "first building < 5 s" and leaves a little toward a shop.
   * - taxPerPop: money/s per citizen, employed or not. Makes residential alone trickle
   *   income so a player who over-builds housing is never fully stalled.
   * - wage: money/s per employed citizen. The dominant early income term; raising it makes
   *   the jobs/housing balance matter more, lowering it favors flat building income.
   * - tapSeconds: manual click pays `max(1, income * tapSeconds)` — one second of income per
   *   tap. Keeps clicking meaningful at the start and irrelevant (but harmless) later.
   */
  economy: { startMoney: 50, taxPerPop: 0.08, wage: 0.35, tapSeconds: 1 },

  /**
   * Population dynamics (per second, before happiness/power scaling).
   * - growthRate: fraction of the housing gap (housing − pop) filled each second. 0.06 fills
   *   ~95% of new housing in ~50 s; higher feels snappier but makes housing the only lever.
   * - shrinkRate: fraction of the overflow (pop − housing) lost per second when housing is
   *   sold. Deliberately faster than growth so selling homes has a bite.
   * - baseInflow: flat citizens/s while any housing is vacant. Guarantees the first house
   *   fills even when the growth term is near zero (4 slots × 0.06 = 0.24/s).
   */
  pop: { growthRate: 0.06, shrinkRate: 0.2, baseInflow: 0.5 },

  /**
   * Power grid.
   * - brownoutFloor: minimum powerRatio when demand exceeds capacity. Income and growth are
   *   scaled by powerRatio, so 0.25 means a total blackout still yields a quarter of normal
   *   output — punishing, never a hard stall. Raise toward 1 to make power optional.
   */
  power: { brownoutFloor: 0.25 },

  /**
   * Happiness (multiplier, clamped 0.25..3 by resources). Feeds growth directly and income
   * via 0.5 + 0.5·h, so h=2 is +50% income.
   * - civicCap: asymptotic happiness bonus from civic buildings (1.0 → h can reach 2 from
   *   civic alone).
   * - civicScale: Σ(count·happiness) at which civic bonus reaches 63% of civicCap. Lower =
   *   parks pay off sooner but saturate faster.
   * - pollutionScale: multiplier on negative building happiness (factories, coal). Linear,
   *   uncapped — heavy industry needs civic offsets.
   * - unemploymentPenalty: happiness lost at 100% unemployment. 0.4 makes an all-housing city
   *   noticeably sluggish without stalling it.
   * - overcrowdPenalty: happiness lost per 100% overcrowding (pop/housing − 1). Only bites
   *   briefly after selling housing.
   * - brownoutPenalty: happiness lost at a full blackout (powerRatio 0). Stacks with the
   *   direct powerRatio scaling, so brownouts hurt growth twice — build power.
   */
  happiness: {
    civicCap: 1.0,
    civicScale: 1.5,
    pollutionScale: 1,
    unemploymentPenalty: 0.4,
    overcrowdPenalty: 0.5,
    brownoutPenalty: 0.3,
  },

  /**
   * Building costs: cost = baseCost · growth^count · mods.cost.
   * - tierGrowth: exponential base per tier. Cheap tier-1 buildings climb fastest (1.15 →
   *   ×4 after 10) so the player is pushed up the ladder; tier-4 grows slowest (1.12) so
   *   late-game spam stays viable. Civic buildings override with 1.18–1.2 to keep happiness
   *   from being a cheap stat dump.
   * - sellRefund: fraction of the *current* price returned on sell. 0.5 makes reshuffling
   *   possible but never free.
   */
  cost: { tierGrowth: { 1: 1.15, 2: 1.14, 3: 1.13, 4: 1.12 }, sellRefund: 0.5 },

  /**
   * Prestige — "Found a new city".
   * - threshold: totalEarned required to prestige. $1M lands at the ~35–50 min target.
   * - exponent: legacy gained = floor((totalEarned / threshold)^exponent). 0.5 (square root)
   *   means 4× the money for 2× the legacy — pushing far past the threshold has diminishing
   *   returns, so resetting on time is the right play.
   * - incomePerLegacy: permanent income multiplier per legacy point (+5% each, additive
   *   inside one multiplier: ×(1 + 0.05·legacy)).
   * - startMoneyPerLegacy: post-reset seed cash = startMoney · (1 + 0.5·legacy). Skips the
   *   first minute of every replay and shortens each cycle.
   */
  prestige: { threshold: 1e6, exponent: 0.5, incomePerLegacy: 0.05, startMoneyPerLegacy: 0.5 },

  /**
   * Persistence and offline progress.
   * - autosaveSec: seconds between autosaves (also saved on tab hide / unload).
   * - offlineCapSec: max simulated absence, 8 h. Beyond this the city simply waits.
   * - offlineEfficiency: fraction of income credited for offline time that is approximated
   *   (not fully simulated). Rewards returning without making idling strictly better than
   *   playing.
   */
  save: { autosaveSec: 30, offlineCapSec: 8 * 3600, offlineEfficiency: 0.5 },

  /**
   * Per-building overrides, keyed by building id. Any registerBuilding field may be set
   * here (baseCost, costGrowth, income, housing, ...) and the buildings module merges it
   * over its own definition before registering. Empty by default: the DESIGN.md table is
   * the baseline. Example: `house: { baseCost: 25 }`.
   */
  buildings: {},

  /**
   * Per-upgrade overrides, keyed by upgrade id: `{ cost }`. Merged by the upgrades module
   * before registering. Empty by default.
   */
  upgrades: {},

  /**
   * Milestone rewards.
   * - popIncomeBonus: income multiplier granted by each population milestone (10 of them, so
   *   a fully milestoned run gets +20%). Small enough to be flavor, large enough to feel.
   */
  milestones: { popIncomeBonus: 0.02 },
};

/**
 * Default cost growth for a building tier (1–4). Unknown tiers fall back to the tier-1
 * rate so a mistyped tier still produces a sane, steep curve.
 * @param {number} tier
 * @returns {number}
 */
export function costGrowthFor(tier) {
  return config.cost.tierGrowth[tier] ?? 1.15;
}
