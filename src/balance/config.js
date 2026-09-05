// Metropolis — balance configuration.
// The single source of tuning truth. Every number that shapes pacing lives here so the
// balance owner can retune the game without touching any other folder.
// DOM-free: this file must import cleanly in Node (economy-sim) and the browser.
//
// Pacing (greedy bot, tools/economy-sim.mjs, 12 game-hour run; logs/sim-fix-balance-12h.json).
// Measured on commit 0287076 plus the 2026-09-04 working tree of the simulation module
// (peakCarry, compoundCap, minGainShare, taps excluded from maturity) and the upgrades
// module (Civic Bonds II at 45 s after founding, gaps 10 s + 0.8 s per rung, XXX at
// 10.5 min); re-measure with `node tools/economy-sim.mjs --ticks 432000` before quoting.
//   Opening: cottage 0 s · two windmills, three more cottages and the Welcome Sign by 4 s ·
//   Zoning Reform 48 s · first shop 86 s · a purchase every 6–16 s from there (income
//   $1.4/s at 1 min, $6.6/s at 2 min, $13/s at 3 min; longest no-purchase gap of the first
//   three hours is the 44 s before Zoning Reform) · first brownout 2.3 min · 1k pop 13 min
//   · $1M earned ~18 min · Found panel ~14 min ($300k) · Found button arms ~23 min (first
//   legacy point, $3M) · 10k pop 28 min.
//   Tier 4 in the first city: arcology 27 min, tech campus 30.5, nuclear 31, financial 33,
//   stadium 37 — one new top-tier decision every 2–5 minutes. Income never grows more
//   than ×3 in any minute after minute 3 of the first city (worst ×2.98 at minute 5, when
//   Smart Grid and the Carbon Turbine Blades end the first brownout; ×2.5 at minute 37
//   when the stadiums land) and never sits flat: the only minute under ×1.06 is the last
//   one before the founding (×1.05 at 39). Before this pass the financial district ($2M,
//   $9,000/s) arrived at 42 min as a ×5 minute after three ×1.01–1.05 minutes.
//   First founding at 39.9 min with 5 legacy (48k citizens, $1.2M/s peak).
//   Late ladder in the first city: Prefab 27 min, Skyway 33, Digital City Hall 37; each
//   later city reaches one or two rungs deeper (Preventive Care through Megastructures in
//   city 2, the Planetary Charter by city ~20).
//   Cycles: 40 → 16 → 16 → 6 → 5.3 → 5.1 → 4.4 → 4.9 → 4.3 → 4.5 (city 10, ~2 h) → then
//   lengthening ~0.4 min per city (5.3, 5.7, 6, 6.4, 6.8, 7.8 … 10.3) to 11.3 min at city
//   24 (~3.7 h) and exactly 11.3 min for every later city; 68 foundings in 12 h, legacy
//   3.8e7, income ~1e19/s (core/format prints past 1e15). See the prestige block below
//   for what sets each phase; the 4.3 → 11.3 lengthening between cities 10 and 24 is the
//   one pacing flaw left, and it cannot be tuned away from here (details there).
//   Coverage: all 20 buildings in the first city except the Fusion Reactor (legacy-gated
//   by design; bought in city 2); all 82 upgrades bought — every fixed rung by city ~20
//   and Civic Bonds I–XXX plus Skyline Expansion I–V in every city from the 24th on.
//   Brownouts: 26% of the first 16.7 minutes' 10-second samples sit under full power (4%
//   under 0.9; the verify run's 100-tick samples: 26 of 60 under 1, 4 under 0.9, floor
//   0.89), 14% of the first city, 2% of the session. Happiness 0.70 in the first minute
//   (every citizen jobless until the first shop at 86 s), 1.8 at the first founding, 2.1
//   to 2.7 at later cycle ends, never under 1.8 at a founding.
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
   * - startMoney: seed cash on a fresh run. $300 is tuned to the first five seconds as the
   *   greedy bot actually plays them: a cottage at 0 s, then (the grid reads as dark until
   *   the next tick) two windmills at $40 + $80, three more cottages and the $25 Welcome
   *   Sign, leaving ~$0 — so the four cottages Zoning Reform asks for are up at once and
   *   the reform lands at 48 s off tax income, the first corner shop at 86 s. ($280 left
   *   the fourth cottage for a 40-second wait and put the reform at 66 s and the shop at
   *   102 s.) The windmill's cost growth of 2 is what stops the opening spree at two
   *   windmills (the third would be $160, more than the whole treasury); at 1.5–1.8, or
   *   with a $35 windmill, the bot bought three and starved the shop until 3+ minutes.
   * - taxPerPop: money/s per citizen, employed or not. Makes residential alone trickle
   *   income so a player who over-builds housing is never fully stalled.
   * - wage: money/s per employed citizen. The dominant income term through the mid game;
   *   raising it makes the jobs/housing balance matter more, lowering it favors flat
   *   building income. 0.35 keeps "$1M earned" from arriving before the 1k-pop milestone
   *   has time to breathe.
   * - tapSeconds: manual click pays `max(1, income * tapSeconds)` — one second of income per
   *   tap. Keeps clicking meaningful at the start and irrelevant (but harmless) later.
   */
  economy: { startMoney: 300, taxPerPop: 0.08, wage: 0.35, tapSeconds: 1 },

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
   * knob it reads is set here explicitly (simulation/tuning.js carries matching fallbacks —
   * keep its DEFAULTS in step with this block).
   *
   * Legacy has two sources: lifetime earnings are worth floor((lifetimeEarned /
   * threshold)^exponent) points in total and a founding banks the difference to what is
   * already held; on top of that a *mature* city grows the bank by legacy · maturity ·
   * compoundPerMinute / 60, where maturity is the seconds of the run's peak income it has
   * banked (measured against peakCarry × the previous city's peak until it rebuilds to it,
   * taps excluded). The first source paces the first three cities, the second sets the
   * steady-state cadence.
   *
   * - threshold: lifetime earnings worth the first point — $3M, which the first city earns
   *   about 23 minutes in. With minGain 1 that is also the moment the Found button arms,
   *   so the counter the panel shows is the real bar. The panel itself opens at
   *   threshold/10 = $300k (~14 min). The bot, which holds out for 5 points, founds at
   *   $3M·5^(1/0.35) ≈ $300M, ~40 min.
   * - exponent: 0.35 (not the 0.5 sketched in DESIGN.md). Against lifetime earnings the
   *   bot's "reset for 25% more legacy" habit needs each run to out-earn everything before
   *   it by ×1.25^(1/exponent): ×1.56 at 0.5, ×1.9 at 0.35. At 0.5 the mid game collapses
   *   into 80-second cycles because a legacy-boosted rebuild out-earns the small lifetime
   *   total in seconds. Lower values (0.3 → 0.15, with the threshold lowered to keep the
   *   first founding at ~40 min) were swept this pass: they do not change the shape below,
   *   only where the Found button first arms ($1.4M … $10k), so 0.35 stays.
   * - incomePerLegacy / legacyPower / legacyCap: income × (1 + 0.04·legacy)^0.5, uncapped
   *   (legacyCap 0 switches the simulation's soft cap and its tail off). The square root
   *   keeps the first points readable and never goes flat: a founding that grows the bank
   *   by a quarter is always worth ×1.118 here, and the upgrades module's Dynasty Ledger
   *   (×√legacy) adds the same again, so every late founding still pays ≥ +25% income.
   *   The price is that 12-hour money runs past 1e15 (~1e19/s income at 68 foundings) —
   *   core/format handles it, and a number that keeps growing is the point of the loop.
   *   Bounding it (a soft cap, or the bank held to earnings^exponent via compoundCap 1)
   *   makes every late cycle longer than the one before — measured 11.9 → 140 min over
   *   hours 6–12 with the cap at 1 — because the bot's bank grows by a quarter per
   *   founding whatever the rule, and 68 foundings are 22 doublings.
   * - firstBonus: 0.3 — the first founding is still a jump a player can feel (×1.3 on top
   *   of the points' ×1.1), trimmed from 0.5 so cities 2–3 do not out-earn the first city
   *   in 13 minutes (they take 16 now) and the sprint below starts at 6 min, not 4.
   * - compoundPerMinute: 0.1 → a mature city banks +10% of its legacy per minute of peak
   *   income earned, so the bot's 25%-more rule is met after 150 s of *peak-income time*.
   *   Because every Civic Bond raises the peak ×1.25, a city cannot bank more than ~4.5
   *   bond-gaps of maturity while bonds keep landing; the gaps end at 32 s (rung XXX,
   *   10.5 min after founding), so a bonded city ripens ~50 s after the ladder ends: the
   *   11.3-minute cycle every city from the 24th on runs, funding all thirty rungs. 0.11
   *   ends cities just before rung XXX opens (never bought), 0.08 gave 11.9 min; the
   *   plateau is the bonds' issue schedule (upgrades module), so re-measure if it changes.
   *   Cities 4–10 (legacy 15–80) are the "sprint": Civic Bonds I only opens on $1B earned
   *   in the run, which those cities reach 5 → 1 minutes after founding, and every rung
   *   whose issue time has passed is bought at once — a ×3–20 jump in the peak that lets
   *   a 4–6 minute city out-earn its whole lifetime (the earnings source pays, not the
   *   compound one). From city 10 the first bond lands inside the first minute, the sprint
   *   fades and cycles lengthen toward the bonded plateau. No knob here changes that
   *   ordering (exponent, threshold, firstBonus, incomePerLegacy 0 → 0.04, peakCarry,
   *   ripenSeconds and compoundPerMinute 0.08 → 0.2 were all swept: higher compounding
   *   shortens sprint and plateau alike and stops funding the late bonds). The seam is
   *   the bonds' schedule: anchoring rungs II–XXX on the purchase of rung I instead of the
   *   founding would pin cities 4–9 the same way it pins city 24, giving 16 → 15 → 14 → …
   *   → 11.3 min; alternatively a compounding share that grows with the bank (simulation).
   * - peakCarry: 0.5 — a new city's maturity is measured against half the previous city's
   *   peak until it rebuilds past it, so founding and idling on two cottages banks nothing.
   * - compoundCap: 1000 — the compounding share can never exceed 1000× what the run's own
   *   discounted earnings are worth as legacy. A guard, not a pacing lever: a run that
   *   earned less than the threshold is worth 0, so a stale save (no previous-peak figure)
   *   left idle still banks nothing, while a bot city's ratio is ~1 at legacy 1e4 and ~500
   *   at 3e6 (the 12-hour bank), so the cap never touches a played session. At 1 (the
   *   simulation's fallback) it binds from legacy ~1.4e4 (hour 6) and cycles balloon.
   * - ripenSeconds: 0 — the earnings-based share is banked in full at any maturity. Values
   *   of 150–240 s were tried to hold the sprint: the unbanked remainder carries over to
   *   the next city as a pool, and the pool ripens at maturity 20–35 s, so nothing changes.
   * - legacyDiscount: 1 — lifetime earnings count as earned-without-the-bonus toward the
   *   earnings source, so the bonus never buys the next points faster.
   * - startMoneyPerLegacy: post-reset seed cash = startMoney · (1 + 0.05·legacy). Five
   *   points (one bot cycle) buy the opening cottages and windmills outright; kept small
   *   so replays are quicker, not skipped.
   * - minGain: 1 — the Found button arms at the first point (see threshold).
   * - minGainShare: 0.05 — once a bank exists the button also waits for 5% of it, so a
   *   1,000-point mayor is never offered a reset for +3 (the bot holds out for 25%).
   */
  prestige: {
    threshold: 3e6,
    exponent: 0.35,
    incomePerLegacy: 0.04,
    legacyPower: 0.5,
    legacyCap: 0,
    firstBonus: 0.3,
    compoundPerMinute: 0.1,
    peakCarry: 0.5,
    compoundCap: 1000,
    ripenSeconds: 0,
    legacyDiscount: 1,
    startMoneyPerLegacy: 0.05,
    minGain: 1,
    minGainShare: 0.05,
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
   *   commercial   shop $50/5 jobs · office $1.2k/50 · mall $25k/300 · financial $700k/4,000
   *   industrial   factory $500/20 jobs · refinery $20k/200 · tech campus $300k/2,500
   *   power        windmill $40/4 MW · coal $1.5k/80 · solar $25k/900 · nuclear $400k/12k
   *                fusion $4M/60k MW (post-prestige trophy)
   *   civic        park $200 · school $5k · hospital $60k · stadium $3.5M
   * Housing is deliberately the cheap column and jobs the expensive one: citizens arrive
   * first, then the city has to find them work, which is where the money is.
   */
  buildings: {
    // Windmills: $40 keeps the first one in reach right after the opening cottage, 4 MW
    // covers four cottages (6 MW covered the whole first four minutes and put the first
    // brownout at 9 min instead of the design's ~3; 3 MW had the grid under full power
    // for a third of the first 17 minutes and under 0.9 for 12% of them — 4 MW keeps the
    // first brownout at 2.3 min but cuts the deep ones to 4%), and growth 2 (the 3rd costs
    // $160, the 5th $640) means the good hilltops run out fast — a coal plant is the real
    // answer once demand passes 20 MW.
    windmill: { baseCost: 40, costGrowth: 2, powerGen: 4 },

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

    // Tier 4. Base costs and population gates are spaced so the frontier (and the city's
    // growth) delivers one top-tier building every 2–5 minutes of the first city —
    // arcology 27 min, tech campus 30.5, nuclear 31, financial 33, stadium 37 — instead
    // of all of them inside one minute as the old ×1.3 spacing ($120k…$350k, gates
    // 4k…10k) did. The nuclear plant sits at the 8k gate with the tech campus ($400k, a
    // minute behind it) so the solar-farm ladder does not brown the city out for two
    // minutes while the bot saves for a $750k plant at 34 min, as it did before. The arcology's housing is trimmed from 2,500 to 1,000: at 2,500 one
    // arcology was fifteen towers' worth of citizens for the price of one, and a dozen of
    // them tripped every later gate within a minute. At 1,000 it is still 2–3× the tower
    // frontier per dollar, with 500 jobs and +0.02 happiness of its own.
    arcology: { baseCost: 120000, housing: 1000, ...popUnlock(4000, '4,000') },
    techpark: { baseCost: 300000, ...popUnlock(8000, '8,000') },
    nuclear: { baseCost: 400000, ...popUnlock(8000, '8,000') },
    // Financial district: a fresh price ladder that opens late is always a spike, because
    // the buildings test pins its income per dollar at *base* cost to ≥ 0.8× the tech
    // campus's, while the campus the bot is actually comparing it with has climbed ×3–6
    // up its own ladder by then. At $2M / $9,000/s (unlock 20k citizens, 42 min) that was
    // fourteen districts in one minute and a ×5 income minute after three flat ones. So it
    // now opens at 12k citizens, ~33 min, two and a half minutes after the campus, at
    // $700k and $2,600/s (×2.5 with a full payroll): 7.2/$k at base against the campus's
    // 8.75 (the test's band), about 1.4× the campus's frontier value when it lands, so
    // the two ladders climb together and the worst minute of the first city is ×3.
    financial: { baseCost: 7e5, income: 2600, ...popUnlock(12000, '12,000') },
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
   * first three rungs are bought at the end of the first city (27, 33 and 37 min); each
   * later city's higher legacy income reaches one or two rungs deeper, so a city with 20+
   * legacy still has new proposals to fund. AI Governance ($1e11) and the Planetary
   * Charter ($3e12) are the last fixed-price rungs: they unlock on $1B / $20B earned in a
   * single run and are first funded around cities 14 and 20.
   * Smart Grid is the one early rung priced off its natural frontier: $250 (not $400) so
   * the −20% demand lands at ~4 min, right as the two starter windmills run out, instead
   * of at 6.3 min after the fourth brownout; it took the first city's under-power share
   * from 34% to 29% of the first 17 minutes and lifted the grid's floor from 0.70 to 0.84.
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
    'smart-grid': { cost: 250 },
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
