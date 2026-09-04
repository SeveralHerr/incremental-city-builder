// Metropolis — balance configuration.
// The single source of tuning truth. Every number that shapes pacing lives here so the
// balance owner can retune the game without touching any other folder.
// DOM-free: this file must import cleanly in Node (economy-sim) and the browser.
//
// Pacing (greedy bot, tools/economy-sim.mjs, measured after this tuning pass):
//   first building 0 s · first upgrade ~66 s · 1k pop ~12 min · $1M earned (prestige
//   available) ~20 min · first prestige taken by the bot ~48 min · cycles then shorten
//   48 → 25 → 21 → 17 → 16 → 14 min · every building bought in the first cycle.
//
// How the numbers were chosen. The verify/sim bot never saves: it buys the best-scoring
// *affordable* item every two seconds, so every unlocked building's price gets pushed up to
// a common "frontier" and the bot's cash on hand hovers at that frontier. A building whose
// base cost sits far above the frontier at the moment it unlocks is simply not bought until
// the frontier climbs there. The ladder below is therefore spaced so each tier's base cost
// is close to the frontier at the population where it unlocks; the frontier itself grows
// roughly as (spend per building type) × (costGrowth − 1).
//
// Consumers: resources.computeDerived (economy/pop/power/happiness), buildings (cost +
// per-building overrides), upgrades (cost overrides), simulation (prestige, milestones,
// startMoney, tap), save (autosave/offline).

// Population-gated unlock helper for the tier-4 overrides below. `unlockAt`/`unlockHint`
// mirror the rule as data for the UI's progress bars and locked-card hints.
const popUnlock = (n, label) => ({
  unlock: (state) => (state?.res?.pop ?? 0) >= n,
  unlockAt: { pop: n },
  unlockHint: `Reach ${label} citizens`,
});

export const config = {
  /**
   * Core money flow.
   * - startMoney: seed cash on a fresh run. $210 is tuned to the first two seconds: a
   *   player (or the bot) puts up four cottages ($30 → $49) and still has the $40 windmill
   *   in hand when the porch lights flicker, so the opening brownout lasts one tick instead
   *   of a minute. It also covers cottage + shop + windmill for a player who buys one of
   *   each first.
   * - taxPerPop: money/s per citizen, employed or not. Makes residential alone trickle
   *   income so a player who over-builds housing is never fully stalled.
   * - wage: money/s per employed citizen. The dominant income term through the mid game;
   *   raising it makes the jobs/housing balance matter more, lowering it favors flat
   *   building income. 0.35 keeps "$1M earned" from arriving before the 1k-pop milestone
   *   has time to breathe.
   * - tapSeconds: manual click pays `max(1, income * tapSeconds)` — one second of income per
   *   tap. Keeps clicking meaningful at the start and irrelevant (but harmless) later.
   */
  economy: { startMoney: 210, taxPerPop: 0.08, wage: 0.35, tapSeconds: 1 },

  /**
   * Population dynamics (per second, before happiness/power scaling).
   * - growthRate: fraction of the housing gap (housing − pop) filled each second. 0.08 fills
   *   ~95% of new housing in ~40 s, so a new tower feels occupied within a minute without
   *   making housing the only lever.
   * - shrinkRate: fraction of the overflow (pop − housing) lost per second when housing is
   *   sold. Deliberately faster than growth so selling homes has a bite.
   * - baseInflow: flat citizens/s while any housing is vacant. Guarantees the first cottage
   *   fills even when the growth term is near zero (4 slots × 0.08 = 0.32/s).
   */
  pop: { growthRate: 0.08, shrinkRate: 0.2, baseInflow: 0.5 },

  /**
   * Power grid.
   * - brownoutFloor: minimum powerRatio when demand exceeds capacity. Income and growth are
   *   scaled by powerRatio, so 0.4 means a total blackout still yields 40% of normal output —
   *   punishing, never a hard stall, and survivable in the first minute when the only
   *   generator is still being saved for. Raise toward 1 to make power optional.
   */
  power: { brownoutFloor: 0.4 },

  /**
   * Happiness (multiplier, clamped min..max by resources). Feeds growth directly and income
   * via 0.5 + 0.5·h, so h = 2 is +50% income.
   * - civicCap: asymptotic happiness bonus from civic buildings (1.25 → h can reach 2.25
   *   from civic alone, +62% income at full saturation).
   * - civicScale: Σ(count·happiness) at which the civic bonus reaches 63% of civicCap.
   *   Lower = parks pay off sooner but saturate faster.
   * - pollutionScale: multiplier on negative building happiness (factories, coal,
   *   refineries). The penalty is linear and uncapped while the civic bonus saturates, so
   *   the scale is what keeps a fully industrialised city from pinning happiness at the
   *   floor: at 0.2 a 60-factory / 60-coal / 45-refinery city (about 90 minutes of greedy
   *   play) loses ~1.3, roughly what parks, schools and hospitals give back.
   * - unemploymentPenalty: happiness lost at 100% unemployment. 0.3 makes an all-housing
   *   city noticeably sluggish without stalling it.
   * - overcrowdPenalty: happiness lost per 100% overcrowding (pop/housing − 1). Only bites
   *   briefly after selling housing.
   * - brownoutPenalty: happiness lost at a full blackout (powerRatio 0). Stacks with the
   *   direct powerRatio scaling, so brownouts hurt growth twice — build power.
   * - min/max: clamp range for the final happiness value.
   */
  happiness: {
    civicCap: 1.25,
    civicScale: 1.5,
    pollutionScale: 0.2,
    unemploymentPenalty: 0.3,
    overcrowdPenalty: 0.5,
    brownoutPenalty: 0.3,
    min: 0.25,
    max: 3,
  },

  /**
   * Building costs: cost = baseCost · growth^count · mods.cost.
   * - tierGrowth: exponential base per tier. Cheap tier-1 buildings climb fastest (1.18 →
   *   ×5 after 10) so money is pushed up the ladder instead of into a 60th cottage;
   *   tier-4 grows slowest (1.12) so late-game spam stays viable. Civic buildings override
   *   with 1.18–1.2 to keep happiness from being a cheap stat dump, and the windmill with
   *   1.5 (see buildings.windmill).
   * - sellRefund: fraction of the *current* price returned on sell. 0.5 makes reshuffling
   *   possible but never free.
   */
  cost: { tierGrowth: { 1: 1.18, 2: 1.16, 3: 1.14, 4: 1.12 }, sellRefund: 0.5 },

  /**
   * Prestige — "Found a new city".
   * - threshold: totalEarned required to prestige. $1M lands around minute 20 and matches
   *   the Millionaire Mayor milestone text and the Prefab Construction unlock.
   * - exponent: legacy gained = floor((totalEarned / threshold)^exponent). 0.35 means the
   *   second point needs $7.2M, the fifth $99M, the tenth $720M: pushing far past the
   *   threshold has diminishing returns, so resetting on time is the right play, while a
   *   run that waits for five points (what the bot does) lasts long enough to buy every
   *   tier-4 building and the first rungs of the late upgrade ladder before the reset.
   * - incomePerLegacy: permanent income multiplier per legacy point (+4% each, additive
   *   inside one multiplier: ×(1 + 0.04·legacy)).
   * - startMoneyPerLegacy: post-reset seed cash = startMoney · (1 + 0.1·legacy). Five
   *   points (one bot cycle) buy the opening cottages, shop and windmill outright; kept
   *   small so replays are quicker, not skipped.
   */
  prestige: { threshold: 1e6, exponent: 0.35, incomePerLegacy: 0.04, startMoneyPerLegacy: 0.1 },

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
   * here (baseCost, costGrowth, income, housing, unlock, ...) and the buildings module
   * merges it over its own definition before registering. Fields not listed keep the
   * DESIGN.md table values.
   *
   * Ladder rationale (base cost → what it buys, at the frontier where it unlocks):
   *   residential  cottage $30/4 · apartment $300/24 · tower $3k/160 · arcology $120k/2,500
   *   commercial   shop $50/5 jobs · office $1.2k/40 · mall $25k/300 · financial $250k/4,000
   *   industrial   factory $500/20 jobs · refinery $20k/200 · tech campus $150k/2,500
   *   power        windmill $40/6 MW · coal $1.5k/80 · solar $25k/900 · nuclear $200k/25k
   *                fusion $400k/2M MW (post-prestige trophy)
   *   civic        park $200 · school $5k · hospital $60k · stadium $350k
   * Housing is deliberately the cheap column and jobs the expensive one: citizens arrive
   * first, then the city has to find them work, which is where the money is.
   */
  buildings: {
    // Cheaper, faster-scaling windmills: $40 keeps the first one in reach right after the
    // opening cottages, and growth 1.5 (the 5th costs $200, the 8th $680) means the good
    // hilltops run out fast — a coal plant is the real answer once demand passes 20 MW.
    windmill: { baseCost: 40, costGrowth: 1.5 },

    // The corner shop is the first paycheck: five jobs and $0.80/s of till receipts for
    // $50, so the second minute of play already has money moving.
    shop: { baseCost: 50, income: 0.8 },

    // Jobs are the expensive column. Offices and factories cost a little more than the
    // design table but pay more per unit, so the choice between them stays interesting.
    office: { baseCost: 1200, income: 4 },
    factory: { baseCost: 500, income: 3 },

    // Mid-tier housing priced so a greedy buyer adopts it near its unlock (apartments at
    // 20 citizens, towers at 250) — this is what gets a thousand citizens in by minute 12.
    apartment: { baseCost: 300 },
    tower: { baseCost: 3000 },

    // Tier-3 employers and the hospital sit at the 20–35 minute frontier.
    mall: { baseCost: 25000 },
    refinery: { baseCost: 20000 },
    hospital: { baseCost: 60000 },

    // Tier 4 unlocks a little earlier than the design table (the frontier reaches these
    // prices between minutes 38 and 50, when the city has 4–10k citizens) so every building
    // is bought inside the first prestige cycle and the late game ramps instead of stalling.
    arcology: { baseCost: 120000, ...popUnlock(4000, '4,000') },
    techpark: { baseCost: 150000, ...popUnlock(5000, '5,000') },
    nuclear: { baseCost: 200000, ...popUnlock(6000, '6,000') },
    financial: { baseCost: 250000, ...popUnlock(8000, '8,000') },
    stadium: { baseCost: 350000, ...popUnlock(10000, '10,000') },

    // Fusion is the prestige trophy (unlocks at legacy ≥ 1 or 100k citizens). Priced so it
    // is a real purchase in the second cycle; upkeep trimmed so a young post-prestige city
    // that buys one early is not bled dry.
    fusion: { baseCost: 400000, upkeep: 1500 },
  },

  /**
   * Per-upgrade overrides, keyed by upgrade id: `{ cost }`. Merged by the upgrades module
   * before registering.
   *
   * Early ladder ($50 → $1.5k): priced at the frontier of minutes 1–8 so the first upgrade
   * lands around a minute in and a new one appears every minute or two after that.
   * Mid ladder ($4k → $800k): the upgrades module's own values already sit at the
   * 12–55 minute frontier; only High-Density Zoning is pulled forward to help the 1k-pop
   * push.
   * Late ladder ($120k → $20M, ×1.6 per rung): the first rungs are bought at the end of the
   * first cycle; each later cycle's higher legacy income reaches one or two rungs deeper,
   * so a city with 20+ legacy still has new proposals to fund. AI Governance and the
   * Planetary Charter are the horizon: they unlock on $1B / $20B earned in a single run and
   * are priced for the player who goes that deep.
   * Legacy ladder: paid in money each run, priced for the first minutes of a replay.
   */
  upgrades: {
    // early
    'zoning-reform': { cost: 50 },
    'neon-signage': { cost: 80 },
    'grant-writing': { cost: 150 },
    'tax-software': { cost: 250 },
    'turbine-blades': { cost: 300 },
    'smart-grid': { cost: 400 },
    'community-events': { cost: 500 },
    'assembly-lines': { cost: 600 },
    franchising: { cost: 1200 },
    'green-belts': { cost: 1500 },
    // mid
    'high-density': { cost: 6000 },
    // late
    'prefab-construction': { cost: 120000 },
    'skyway-frames': { cost: 190000 },
    'digital-city-hall': { cost: 300000 },
    'preventive-care': { cost: 480000 },
    'robotic-assembly': { cost: 770000 },
    'breeder-reactors': { cost: 1.2e6 },
    megastructures: { cost: 2e6 },
    'algorithmic-trading': { cost: 3.1e6 },
    'orbital-solar': { cost: 5e6 },
    'championship-season': { cost: 8e6 },
    'superconductor-grid': { cost: 1.3e7 },
    'arcology-gardens': { cost: 2e7 },
    'ai-governance': { cost: 5e7 },
    'planetary-charter': { cost: 5e8 },
    // legacy
    'legacy-archive': { cost: 5000 },
    'founders-blueprints': { cost: 30000 },
    'veteran-planners': { cost: 80000 },
    'dynasty-ledger': { cost: 150000 },
  },

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
  return config.cost.tierGrowth[tier] ?? 1.18;
}
