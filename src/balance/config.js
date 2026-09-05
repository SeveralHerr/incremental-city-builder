// Metropolis — balance configuration.
// The single source of tuning truth. Every number that shapes pacing lives here so the
// balance owner can retune the game without touching any other folder.
// DOM-free: this file must import cleanly in Node (economy-sim) and the browser.
//
// Pacing (greedy bot, tools/economy-sim.mjs, 12 game-hour run). Measured on commit f5790cb
// plus the uncommitted 2026-09-04 working tree of the buildings (synergies, arcology jobs),
// upgrades (founding memory, 2-second Civic Bonds opening 9% later per rung) and simulation
// (legacy tail, ripenSeconds) modules; re-measure with `node tools/economy-sim.mjs` before
// quoting, those modules were still moving when this was written.
//   Opening: cottage 0 s · two windmills, two more cottages and the Welcome Sign at 4 s ·
//   cottage 22 s · Zoning Reform 66 s · first shop 102 s (income $1.1/s at 1 min, $3.9/s at
//   2 min, $6.9/s at 3 min) · first brownout 2.3 min · 1k pop 12.9 min · $1M earned 18.8 min ·
//   Found panel 14.7 min ($300k) · Found button arms 23.4 min (first legacy point, $3M) ·
//   10k pop 28 min.
//   Tier 4 in the first city: arcology 27 min, tech campus 30, nuclear 34, financial 42,
//   stadium 43 — one new top-tier decision every 3–7 minutes instead of all six inside one
//   minute; income never grows more than ×3 in any minute after minute 3 of the first city
//   (49k citizens and $740k/s at its founding). Replays compress, as a legacy-boosted
//   rebuild should: the second city sweeps tier 4 between its 11th and 12th minute (×35
//   income in that minute), the sixth in its 3rd, the eleventh in its first.
//   Late ladder in the first city: Prefab 28 min, Skyway 34, Digital City Hall 42; each
//   later city reaches one or two rungs deeper — Preventive Care through Megastructures in
//   city 2, Algorithmic Trading in city 3, Orbital Solar in city 6, Championship Season 8,
//   Superconductor Grid 10, Arcology Gardens 12 (~2.3 h), AI Governance 14 (~2.6 h),
//   Planetary Charter 23 (~4.5 h).
//   First founding 46 min with 5 legacy; cycles 46 → 14 → 13 → 6 → 5 → 5 → 6 → 6 → 7 → 7 →
//   8 → 9 → 10 → 11 → 12 min by city 15, a hump to 15 min around city 23 (the Planetary
//   Charter and Civic Bonds XX land there), then 10–11 min for the rest of the session;
//   62 foundings in 12 h. Every founding is worth at least +25% income (×1.118 from the
//   bank, ×1.118 from the Dynasty Ledger). Legacy bank ~9e6 and income in the 1e16/s
//   range at 12 h (money is formatted past 1e15 by core/format).
//   Coverage: all 20 buildings in the first city except the Fusion Reactor (legacy-gated by
//   design; bought in city 2); every fixed-price upgrade bought (the last, the Planetary
//   Charter, in city 23); Civic Bonds I–XX bought, XXI–XXX are the upgrades module's
//   horizon headroom (they open 16–34 min after founding, longer than any late cycle).
//   Brownout share 6% of the first city, 1% of the session; happiness 1.95 at 20 min and
//   1.65 at the founding of the first city as industry outgrows its parks, 1.8–2.5 at later
//   cycle ends (the simulation's clean-air milestones scrub smog late).
//
// How the numbers were chosen. The verify/sim bot never saves: it buys the best-scoring
// *affordable* item every two seconds, so every unlocked building's price gets pushed up to
// a common "frontier" and the bot's cash on hand hovers at that frontier. A building whose
// base cost sits far above the frontier at the moment it unlocks is simply not bought until
// the frontier climbs there. The ladder below is therefore spaced so each tier's base cost
// is close to the frontier at the population where it unlocks; the frontier itself grows
// roughly as (spend per building type) × (costGrowth − 1). The one thing the frontier
// cannot do is *space* purchases whose prices sit within ×1.5 of each other — once the
// frontier arrives they all go in the same minute — so the tier-4 base costs and the late
// upgrade ladder are spaced ×2.5–3.3 per rung, which the frontier crosses in minutes.
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
   * - startMoney: seed cash on a fresh run. $280 is tuned to the first five seconds as the
   *   greedy bot actually plays them: a cottage at 0 s, then (the grid reads as dark until
   *   the next tick) two windmills at $40 + $80, two more cottages and the $25 Welcome Sign,
   *   leaving ~$30 — the first corner shop lands off tax income about a minute and a half
   *   in, and Zoning Reform just before it. The windmill's cost growth of 2 is what stops
   *   the opening spree at two windmills (the third would be $160, more than the whole
   *   treasury); at 1.5 the bot bought three and starved the shop for three minutes.
   * - taxPerPop: money/s per citizen, employed or not. Makes residential alone trickle
   *   income so a player who over-builds housing is never fully stalled.
   * - wage: money/s per employed citizen. The dominant income term through the mid game;
   *   raising it makes the jobs/housing balance matter more, lowering it favors flat
   *   building income. 0.35 keeps "$1M earned" from arriving before the 1k-pop milestone
   *   has time to breathe.
   * - tapSeconds: manual click pays `max(1, income * tapSeconds)` — one second of income per
   *   tap. Keeps clicking meaningful at the start and irrelevant (but harmless) later.
   */
  economy: { startMoney: 280, taxPerPop: 0.08, wage: 0.35, tapSeconds: 1 },

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
   *   scaled by powerRatio, so 0.3 means a total blackout still yields 30% of normal output —
   *   punishing, never a hard stall, and survivable in the first minute when the only
   *   generator is still being saved for. Raise toward 1 to make power optional. (0.4 before
   *   this pass; lowered together with the 3 MW windmill so the first brownout at ~2.3 min
   *   is felt, not just logged.)
   */
  power: { brownoutFloor: 0.3 },

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
   *   mirrors the civic bonus instead of racing it. With scale 0.35 and cap 1.1 a
   *   60-factory / 60-coal / 45-refinery city (x ≈ 2.3) loses ~1.0 — most of what its parks,
   *   schools and hospitals give back — so happiness in the first city drifts from ~1.95 at
   *   20 minutes down toward 1.65 at the founding unless civic buildings keep coming, and a
   *   city that stops buying them dips under 1.5. The cap stays under civicCap so a fully
   *   civic city always nets positive; the simulation's clean-air milestones (legacy 10/50/
   *   250/1000) are what let a veteran's megacity run at 2.3+. Before this pass (scale 0.2,
   *   cap 1.0) smog never cost more than ~0.4 and happiness sat at 2.0–2.45 for 11 hours.
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
    pollutionScale: 0.35,
    pollutionCap: 1.1,
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
   *   2 (see buildings.windmill).
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
   * - threshold: lifetime earnings worth the first point — $3M, which the first city earns
   *   about 23 minutes in. With minGain 1 that is also the moment the Found button arms,
   *   so the counter the panel shows is the real bar (before this pass the first point was
   *   $1M at 19 min but the button needed 3 points = $23M at 32 min, and a player watched
   *   "0/3" for a quarter hour). The panel itself opens at threshold/10 = $300k (~15 min).
   *   The bot, which holds out for 5 points, founds at $3M·5^(1/0.35) ≈ $300M, ~46 min.
   * - exponent: 0.35 (not the 0.5 sketched in DESIGN.md). Against lifetime earnings the
   *   bot's "reset for 25% more legacy" habit needs each run to out-earn everything before
   *   it by ×1.25^(1/exponent): ×1.56 at 0.5, ×1.9 at 0.35. At 0.5 the mid game (legacy
   *   100–500) collapses into 80-second cycles because a legacy-boosted rebuild out-earns
   *   the small lifetime total in seconds; at 0.35 the requirement stays ahead of the
   *   rebuild and the compounding term takes over smoothly.
   * - incomePerLegacy / legacyPower / legacyCap: income × (1 + 0.04·legacy)^0.5, uncapped
   *   (legacyCap 0 switches the simulation's soft cap and its tail off). The square root
   *   keeps the first points readable (+2% each on top of the ×1.5 `firstBonus`) and, unlike
   *   the ×100 cap used before this pass, never goes flat: a founding that grows the bank by
   *   a quarter is always worth ×1.118 here, and the upgrades module's Dynasty Ledger
   *   (×√legacy) adds the same again, so every late founding still pays ≥ +25% income.
   *   The price is that 12-hour money runs past 1e15 (≈1e17/s income at 60 foundings) —
   *   core/format handles it, and a number that keeps growing is the point of the loop.
   *   Power 0.75 doubled the 12-hour income again for no felt difference per founding.
   * - firstBonus: the first founding is a jump a player can feel (×1.5 on top of the points).
   * - compoundPerMinute: 0.08 → a mature city banks +8% of its legacy per minute of peak
   *   income earned, so the bot's 25%-more rule is met ~3 minutes of *peak-income time* into
   *   full stride. Because the Civic Bonds treadmill keeps raising the peak inside a run,
   *   maturity accrues slower than wall time: measured cycles plateau at ~10 min with 0.08,
   *   ~12 with 0.07, ~14 with 0.06, ~16 with 0.05 and ~21 with 0.04 (the 0.025 shipped
   *   before this pass gave the 27-minute treadmill). The plateau is set by the bonds'
   *   issue schedule (upgrades module), so re-measure if that changes.
   * - ripenSeconds: 0 — the earnings-based share is banked in full at any maturity. Values
   *   around 300–450 s were tried to flatten the early cadence and produced instant
   *   re-foundings (a fresh city's first tap counts as hundreds of seconds of maturity);
   *   leave at 0 unless the simulation's maturity rule changes.
   * - legacyDiscount: 1 — lifetime earnings count as earned-without-the-bonus toward the
   *   earnings source, so the bonus never buys the next points faster.
   * - startMoneyPerLegacy: post-reset seed cash = startMoney · (1 + 0.1·legacy). Five
   *   points (one bot cycle) buy the opening cottages, shop and windmills outright; kept
   *   small so replays are quicker, not skipped.
   * - minGain: 1 — the Found button arms at the first point (see threshold).
   */
  prestige: {
    threshold: 3e6,
    exponent: 0.35,
    incomePerLegacy: 0.04,
    legacyPower: 0.5,
    legacyCap: 0,
    firstBonus: 0.5,
    compoundPerMinute: 0.08,
    ripenSeconds: 0,
    legacyDiscount: 1,
    startMoneyPerLegacy: 0.1,
    minGain: 1,
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
   * buildings module's values.
   *
   * Ladder rationale (base cost → what it buys, at the frontier where it unlocks):
   *   residential  cottage $30/4 · apartment $300/24 · tower $3k/160 · arcology $120k/1,000
   *   commercial   shop $50/5 jobs · office $1.2k/50 · mall $25k/300 · financial $2M/4,000
   *   industrial   factory $500/20 jobs · refinery $20k/200 · tech campus $300k/2,500
   *   power        windmill $40/3 MW · coal $1.5k/80 · solar $25k/900 · nuclear $750k/12k
   *                fusion $4M/60k MW (post-prestige trophy)
   *   civic        park $200 · school $5k · hospital $60k · stadium $3.5M
   * Housing is deliberately the cheap column and jobs the expensive one: citizens arrive
   * first, then the city has to find them work, which is where the money is.
   */
  buildings: {
    // Windmills: $40 keeps the first one in reach right after the opening cottage, 3 MW
    // covers three cottages (six before this pass covered the whole first four minutes,
    // and the first brownout came at 9 min instead of the design's ~3), and growth 2 (the
    // 3rd costs $160, the 5th $640) means the good hilltops run out fast — a coal plant is
    // the real answer once demand passes 20 MW.
    windmill: { baseCost: 40, costGrowth: 2, powerGen: 3 },

    // The corner shop is the first paycheck: five jobs and $0.80/s of till receipts for
    // $50, so the second minute of play already has money moving.
    shop: { baseCost: 50, income: 0.8 },

    // Jobs are the expensive column. Offices and factories cost a little more than the
    // design table but pay more per unit, so the choice between them stays interesting.
    office: { baseCost: 1200, income: 4 },
    factory: { baseCost: 500, income: 3 },

    // Mid-tier housing priced so a greedy buyer adopts it near its unlock (apartments at
    // 20 citizens, towers at 250) — this is what gets a thousand citizens in by minute 13.
    apartment: { baseCost: 300 },
    tower: { baseCost: 3000 },

    // Tier-3 employers and the hospital sit at the 20–35 minute frontier.
    mall: { baseCost: 25000 },
    refinery: { baseCost: 20000 },
    hospital: { baseCost: 60000 },

    // Tier 4. Base costs are spaced ×2.5 and the population gates ×1.5–2 so the frontier
    // (and the city's growth) delivers one top-tier building every 3–7 minutes of the
    // first city — arcology 27 min, tech campus 30, nuclear 34, financial 42, stadium 44 —
    // instead of all of them inside one minute as the old ×1.3 spacing ($120k…$350k, gates
    // 4k…10k) did. The arcology's housing is trimmed from 2,500 to 1,000: at 2,500 one
    // arcology was fifteen towers' worth of citizens for the price of one, and a dozen of
    // them tripped every later gate within a minute. At 1,000 it is still 2–3× the tower
    // frontier per dollar, with 500 jobs and +0.02 happiness of its own.
    arcology: { baseCost: 120000, housing: 1000, ...popUnlock(4000, '4,000') },
    techpark: { baseCost: 300000, ...popUnlock(8000, '8,000') },
    nuclear: { baseCost: 750000, ...popUnlock(12000, '12,000') },
    // Financial's base income is owned here alongside its price: the catalogue's $2,000/s
    // was tuned for the old $250k tag, and at $2M it fell to ~2/$k against the tech
    // campus's ~9/$k. $9,000/s (x2.5 with a full payroll) keeps the tier-3/4 ladder within
    // the 0.8x dominance band the buildings tests pin without touching the 42-minute gate.
    financial: { baseCost: 2e6, income: 9000, ...popUnlock(20000, '20,000') },
    stadium: { baseCost: 3.5e6, ...popUnlock(22000, '22,000') },

    // Fusion is the prestige trophy (unlocks at legacy ≥ 1 or 100k citizens). Priced above
    // the nuclear plant it replaces so it is a real purchase in the second cycle; upkeep
    // trimmed so a young post-prestige city that buys one early is not bled dry.
    fusion: { baseCost: 4e6, upkeep: 1500 },
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
   * Late ladder ($120k → $4e10, ×3.3 per rung — DESIGN.md's ×4–6 shape, not the ×1.6 used
   * before this pass, which put twelve rungs inside 48 seconds of the second city): the
   * first three rungs are bought at the end of the first city (28, 34 and 42 min); each
   * later city's higher legacy income reaches one or two rungs deeper, so a city with 20+
   * legacy still has new proposals to fund, and the last of the twelve (Arcology Gardens)
   * is first funded in the 12th city. AI Governance ($1e11) and the Planetary Charter
   * ($3e12) are the last fixed-price rungs: they unlock on $1B / $20B earned in a single
   * run and land in cities 14 and 23 (~2.6 h and ~4.5 h).
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
    // late (×3.3 per rung)
    'prefab-construction': { cost: 120000 },
    'skyway-frames': { cost: 400000 },
    'digital-city-hall': { cost: 1.3e6 },
    'preventive-care': { cost: 4e6 },
    'robotic-assembly': { cost: 1.3e7 },
    'breeder-reactors': { cost: 4e7 },
    megastructures: { cost: 1.3e8 },
    'algorithmic-trading': { cost: 4e8 },
    'orbital-solar': { cost: 1.3e9 },
    'championship-season': { cost: 4e9 },
    'superconductor-grid': { cost: 1.3e10 },
    'arcology-gardens': { cost: 4e10 },
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
