// Metropolis — balance configuration.
// The single source of tuning truth. Every number that shapes pacing lives here so the
// balance owner can retune the game without touching any other folder.
// DOM-free: this file must import cleanly in Node (economy-sim) and the browser.
//
// Pacing (greedy bot, tools/economy-sim.mjs, 12 game-hour run, measured after this pass):
//   first building 0 s · first upgrade 24 s (Welcome Sign, $25) · 1k pop 12.2 min ·
//   $1M earned 18.7 min · first founding 34 min · cycles then shorten
//   34 → 12.4 → 11.7 → 9.6 → 8.1 → 6.6 → 6.1 min (floor at the 7th city, ~1.4 h in), then
//   lengthen gently — 7, 8, 9, 10, 11, 13, 16, 18, 20, 23, 26 — to ~27 min by the 24th city
//   (~5.3 h) and hold there for the rest of the session; the prestige module's compounding
//   term sets that cadence (see `prestige` below). 38 foundings and ~42k legacy in 12 h.
//   Every building is bought in the first cycle (all 20, Fusion included, in every cycle
//   after the first). AI Governance lands in cycle 13 (~2.4 h), the Planetary Charter in
//   cycle 17 (~3.4 h). Income reaches the 1e15/s range at 12 h — the legacy bonus itself
//   tops out at ×171 (legacyCap); the rest is the upgrades module's income-priced Civic
//   Bonds treadmill compounding inside each 27-minute run. Happiness never drops below
//   1.94 at a cycle's end; brownout share of any cycle ≤ 7% (0.1% late); never a gap over
//   44 s between purchases. (Snapshot of the simulation/upgrades modules at the time of
//   this pass; both were still being retuned, so re-measure before quoting.)
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
   * - startMoney: seed cash on a fresh run. $260 is tuned to the first five seconds: a
   *   player (or the bot) puts up four cottages ($30 → $49), the $40 windmill that keeps
   *   the porch lights on, and still has the $50 corner shop in hand — so the first
   *   paycheck starts in the opening spree instead of after a 40-second wait, and the
   *   $25 Welcome Sign lands at 24 s. It also covers cottage + shop + windmill for a player
   *   who buys one of each first.
   * - taxPerPop: money/s per citizen, employed or not. Makes residential alone trickle
   *   income so a player who over-builds housing is never fully stalled.
   * - wage: money/s per employed citizen. The dominant income term through the mid game;
   *   raising it makes the jobs/housing balance matter more, lowering it favors flat
   *   building income. 0.35 keeps "$1M earned" from arriving before the 1k-pop milestone
   *   has time to breathe.
   * - tapSeconds: manual click pays `max(1, income * tapSeconds)` — one second of income per
   *   tap. Keeps clicking meaningful at the start and irrelevant (but harmless) later.
   */
  economy: { startMoney: 260, taxPerPop: 0.08, wage: 0.35, tapSeconds: 1 },

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
   * - pollutionScale / pollutionCap / pollutionCurve: smog. Σ(count·|negative happiness|)
   *   × pollutionScale is the raw smog x; the penalty applied is the saturating curve
   *   pollutionCap · (1 − exp(−x / pollutionCurve)) (resources.pollutionPenalty), so it
   *   mirrors the civic bonus instead of racing it: a 60-factory / 60-coal / 45-refinery
   *   city (x ≈ 1.3) loses ~0.73, and even the 120-factory / 130-coal / 110-refinery city
   *   of a 12-hour session (x ≈ 2.4) loses at most ~0.9 — below the civic cap, so parks,
   *   schools and hospitals always win the tug of war and happiness stays ≥ 1.9 at the end
   *   of every cycle instead of pinning at the 0.25 floor. Raise pollutionCap toward
   *   civicCap to make industry a real happiness problem again.
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
    pollutionCap: 1.0,
    pollutionCurve: 1.0,
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
   * Prestige — "Found a new city". The rules live in src/simulation/prestige.js; every
   * knob it reads is set here explicitly (simulation/tuning.js carries matching fallbacks).
   *
   * Legacy has two sources: lifetime earnings are worth floor((lifetimeEarned /
   * threshold)^exponent) points in total and a founding banks the difference to what is
   * already held; on top of that a *mature* city (one that has banked `maturity` seconds
   * of its own peak income) grows the bank by legacy · maturity · compoundPerMinute / 60.
   * The first source paces the first hour, the second sets the steady-state cadence.
   *
   * - threshold: lifetime earnings worth the first point. $1M lands around minute 19 and
   *   matches the Millionaire Mayor milestone text and the Prefab Construction unlock.
   * - exponent: 0.35 (not the 0.5 sketched in DESIGN.md). Against lifetime earnings the
   *   bot's "reset for 25% more legacy" habit needs each run to out-earn everything before
   *   it by ×1.25^(1/exponent): ×1.56 at 0.5, ×1.9 at 0.35. At 0.5 the mid game (legacy
   *   100–500, hours 1.5–2.5) collapses into 80-second cycles because a legacy-boosted
   *   rebuild out-earns the small lifetime total in seconds, then the cadence has to climb
   *   back to the compounding floor; at 0.35 the requirement stays ahead of the rebuild,
   *   so cycles walk down 34 → 12 → 12 → 9.6 → 8.1 → 6.6 → 6.1 min and climb back gently
   *   (never under 6) as the compounding term takes over. 0.3 flattens the descent too
   *   (17 → 13 min from the second city on).
   * - incomePerLegacy / legacyPower / legacyCap: income × (1 + 0.04·legacy)^1, bent toward
   *   a soft ceiling of ×100. Linear (power 1) keeps the first points readable (+4% each,
   *   +50% one-off `firstBonus` on the first founding); the cap is what keeps the legacy
   *   bonus from compounding with the in-run Civic Bonds treadmill (the bonus tops out at
   *   ×171 and 12-hour money stays near 1e15; without the cap both run away) while the
   *   legacy bank itself keeps growing (~42k after 12 h — the number that keeps going up
   *   is the bank, the bonus flattens).
   * - firstBonus: the first founding is a jump a player can feel (×1.5 on top of the points).
   * - compoundPerMinute: 0.025 → a mature city banks +2.5% of its legacy per minute of peak
   *   income earned, so the bot's 25%-more rule is met ~10 minutes of *peak-income time*
   *   into full stride. Because the Civic Bonds treadmill keeps raising the peak inside a
   *   run, maturity accrues slower than wall time and the steady-state cycle measures
   *   ~27–29 min; 0.02 stretches it to ~34 min, 0.03 would pull it under 25.
   * - ripenSeconds: 0 — the earnings-based share is banked in full at any maturity.
   * - startMoneyPerLegacy: post-reset seed cash = startMoney · (1 + 0.1·legacy). Five
   *   points (one bot cycle) buy the opening cottages, shop and windmill outright; kept
   *   small so replays are quicker, not skipped.
   * - minGain: the Found button arms only once at least 3 points are on offer, so it never
   *   invites a worthless reset.
   */
  prestige: {
    threshold: 1e6,
    exponent: 0.35,
    incomePerLegacy: 0.04,
    legacyPower: 1,
    legacyCap: 100,
    firstBonus: 0.5,
    compoundPerMinute: 0.025,
    ripenSeconds: 0,
    startMoneyPerLegacy: 0.1,
    minGain: 3,
  },

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
   * so a city with 20+ legacy still has new proposals to fund. AI Governance ($1e11) and
   * the Planetary Charter ($3e12) are the last fixed-price rungs: they unlock on $1B / $20B
   * earned in a single run and are priced so the bot funds them in cycle 13 (~2.4 h,
   * legacy ~150) and cycle 17 (~3.4 h, legacy ~380) — at the old $5e7 / $5e8 both landed
   * around cycle 9 and the fixed ladder was exhausted at three hours. Pricing them here
   * also lifts the mid-session cadence floor by about a minute (see the header).
   * Beyond them the upgrades module's horizon ladder (Civic Bonds I–XXX, Skyline Expansion
   * I–V) is priced in seconds of the run's live income, not dollars, so it has no entry
   * here; it is the per-cycle treadmill once every fixed rung is owned.
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
    'ai-governance': { cost: 1e11 },
    'planetary-charter': { cost: 3e12 },
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
