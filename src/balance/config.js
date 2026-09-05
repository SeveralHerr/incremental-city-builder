// Metropolis — balance configuration.
// The single source of tuning truth. Every number that shapes pacing lives here so the
// balance owner can retune the game without touching any other folder.
// DOM-free: this file must import cleanly in Node (economy-sim) and the browser.
//
// Pacing (greedy bot, `node tools/economy-sim.mjs --ticks 432000 --out logs/sim-balance.json`,
// 12 game-hours; measured on the 2026-09-05 tree with the earnings-only legacy rule, the
// charter perks and the earnings-gated frontier ladder — re-measure before quoting).
//   Opening: cottage 0 s · two windmills, three more cottages and the Welcome Sign by 4 s ·
//   first corner shop 48 s (the shop now gets the first $50; Zoning Reform follows at
//   ~105 s) · first brownout ~2.3 min · 1k citizens 11.3 min · Legacy panel at $1M earned
//   (~12 min) · Found button arms at $10M (~19 min) · first founding 41.2 min with 5 legacy.
//   Power: the first city runs under full power for a third of its 41 minutes (tier-4
//   draw is 3× the catalogue's, see buildings below); the session as a whole sits under
//   power 3.3% of the time and under 0.9 for 1.6%, never below the 0.6 floor.
//   Cycles (minutes): 41 → 14 → 13 → floor 3.6–5 at cities 4–7 → 6.5 · 8.9 · 9.1 · 10 ·
//   14 · 15 · 13.5 · 18 · 24 · 32 · 40 · 49 (city 19) · 38 · 44 · 25 · 33 · 14 · 18 ·
//   10 · 12 · 12 · 14.5 · 19 · 24 · 29 · 39 · 19 · 26 — 35 foundings, every rise ≤ ×1.35,
//   last completed cycle 26 min. Legacy 7.4e5 (3.3e5 spent on all twelve charter perks),
//   money peak 2.4e17, income 2.7e15/s at the end. The sawtooth is the content: a charter
//   perk lands every 2–3 cities (legacy grows ×1.4 per founding, perks sit ×2.5–4 apart) and
//   a money rung in most of the cities between (see upgrades), each dropping the next cycle
//   by a third to a half; without content a cycle is ×1.43 longer than the one before it.
//   Happiness dips under 1.0 in 22 of 35 cities (the first minute of every replay: an
//   all-housing spree with 40% of the citizens jobless and the grid dark for a step).
//   Coverage: every building; 65 of 66 upgrades — the Galactic Charter ($1e18) is the one
//   rung the 12 h bot never funds (see upgrades below).
//   Late cycles 11, 14, 24, 29, 32 and 34 introduce nothing new: the ladder has 25 late
//   items for 30 late cities and four of those cities are "dead" for placement — their peak
//   cash barely exceeds the previous city's, so no price lands in them (see upgrades).
//
// How the numbers were chosen. The verify/sim bot never saves: it buys the best-scoring
// *affordable* item every two seconds, so every unlocked building's price gets pushed up to
// a common "frontier" and the bot's cash on hand hovers at that frontier (about two seconds
// of income plus whatever twenty-five buys per step could not spend). A rung is bought in
// the first city whose peak cash exceeds its price, so the late ladder below is placed by
// *cycle*: each price sits between two consecutive cities' peak cash, geometric middle where
// the window allows. The whole schedule is a fixed budget: legacy grows ×1.4 per founding
// (minGainShare) and must stay ≤ 1e6 at 12 h, which caps the session at 35 foundings; any
// content that lands earlier shortens the cycles and spends foundings, content that lands
// later lengthens them. legacyPower is the fine lever for where the last perk falls.
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
   *   Sign, leaving ~$0. The windmill's cost growth of 2 is what stops the opening spree
   *   at two windmills (the third would be $160, more than the whole treasury); $350 buys
   *   that third windmill at 2 s and puts the first shop at 150 s instead of 48.
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
   *   scaled by powerRatio, so 0.6 means a total blackout still yields 60% of normal output.
   *   The floor is also what the very first tick of every city reads: the first cottage
   *   draws power before any windmill can be bought (the windmill only unlocks once demand
   *   exists), so the grid ratio starts each run at the floor — the late-game contract asks
   *   for a session floor of ≥ 0.6, which is exactly this knob. What makes power bite is
   *   the brownout *penalty* on happiness (below) and the tier-4 draw (buildings), not the
   *   depth of the floor.
   */
  power: { brownoutFloor: 0.6 },

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
   *   20 minutes down toward 1.65 at the founding unless civic buildings keep coming. The
   *   cap stays under civicCap so a fully civic city always nets positive; the simulation's
   *   clean-air legacy tiers are what let a veteran's megacity run at 2.3+.
   * - unemploymentPenalty: happiness lost at 100% unemployment. 0.4 (was 0.3): a veteran
   *   city opens with a spree of cottages before its first shop, and for that minute two in
   *   five citizens are jobless. Together with the brownout penalty below this is what makes
   *   a replay dip under 1.0 happiness (22 of 35 cities); with either knob at its old value
   *   the +0.55 of flat happiness a veteran carries (kept civic rungs, the Civic Charter,
   *   the legacy tiers) hides it and only 9 of 35 cities ever dip. The first city's opening
   *   minute reads 0.6 instead of 0.7.
   * - overcrowdPenalty: happiness lost per 100% overcrowding (pop/housing − 1). Only bites
   *   briefly after selling housing.
   * - brownoutPenalty: happiness lost at a full blackout (powerRatio 0). 0.6 (was 0.3):
   *   stacks with the direct powerRatio scaling, so brownouts hurt growth twice — build
   *   power. At the 0.6 floor a blackout costs 0.24 happiness, which is what a replay's
   *   first dark step and the first city's tier-4 brownouts need to be felt.
   * - min/max: clamp range for the final happiness value.
   */
  happiness: {
    civicCap: 1.25,
    civicScale: 1.5,
    pollutionScale: 0.35,
    pollutionCap: 1.1,
    pollutionCurve: 1.0,
    unemploymentPenalty: 0.4,
    overcrowdPenalty: 0.5,
    brownoutPenalty: 0.6,
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
   * Prestige — "Found a new city". The rules live in src/simulation/prestige.js and
   * tuning.js; this block is the complete list of what they read.
   *
   * Legacy comes from lifetime earnings only: the bank is worth floor((lifetimeEarned /
   * threshold) ^ exponent) points in total and a founding banks the difference to what is
   * already held. Legacy is also a currency (charter perks, upgrades module): spending
   * never lowers the income bonus, which always uses the full bank.
   *
   * - threshold: lifetime earnings worth the first point, $10M (~19 min into the first
   *   city). With minGain 1 that is the moment the Found button arms, so the counter the
   *   panel shows is the real bar. The bot holds out for 5 points, $250M, and founds at
   *   ~41 min. The threshold sets the scale of the whole cadence, not just the first
   *   founding: every later run must out-earn the whole past by a fixed factor (below), so
   *   a lower threshold makes every cycle shorter in the same proportion.
   * - exponent: 0.5. The bot resets for +40% legacy (minGainShare), which at exponent e
   *   means each run out-earns everything before it by 1.4^(1/e) − 1: ×0.96 at 0.5. The
   *   income bonus meanwhile grows ×1.4^legacyPower per founding, so with no new content a
   *   cycle is ×1.43 longer than the one before it; a charter perk or a money rung landing
   *   in a city drops its cycle by a third to a half. Higher exponents (0.55–0.6 with the
   *   threshold rescaled to keep the first founding at ~40 min) make the mid game collapse
   *   into 2–3 minute replays and 40–70 foundings, which breaks the legacy ceiling; 0.45
   *   gives 30-minute cycles by the tenth city. The exponent also maps the legacy ceiling
   *   onto money: legacy 1e6 ↔ $1e19 lifetime earnings at 0.5.
   * - incomePerLegacy / legacyPower: income × (1 + 0.04·legacy)^0.575, uncapped, always a
   *   root of the linear term (the simulation clamps legacyPower to ≤ 0.6). ×2.6 at 100
   *   points, ×36 at 10k, ×290 at the 7.4e5 a 12 h session banks. legacyPower is the fine
   *   lever for the end of the session: the contract needs every charter perk bought (the
   *   Imperial Charter wants 3.3e5 legacy, the 33rd founding) and legacy ≤ 1e6 (breached by
   *   the 36th), a three-founding window. At 0.575 the 33rd founding lands at 660 min and
   *   the 35th at 704; at 0.57 the session ends one founding short of the last perk with a
   *   41-minute final cycle, at 0.6 the last two perks arrive with 7 foundings to spare and
   *   legacy overshoots. Any ~10% change in late income by another module moves the end of
   *   the session by about one founding — re-measure after retuning perks or the frontier.
   * - firstBonus: 0.3 — the first founding is a jump a player can feel (×1.3 on top of the
   *   points' ×1.1), while cities 2–3 still take 13–14 minutes to out-earn the first.
   * - startMoneyPerLegacy: post-reset seed cash = startMoney · (1 + 0.05·legacy). Five
   *   points (one bot cycle) buy the opening cottages and windmills outright; kept small
   *   so replays are quicker, not skipped.
   * - minGain: 1 — the Found button arms at the first point (see threshold).
   * - minGainShare: 0.4 — once a bank exists the button also waits for 40% of it, so a
   *   1,000-point mayor is offered a reset at +400, never at +3. This is the knob that sets
   *   the whole session's shape: legacy grows ×1.4 per founding, so 35 foundings take a
   *   5-point mayor to 7.4e5 and the 36th would pass the 1e6 ceiling; the charter ladder
   *   (3 … 2e5, ×2.5–4 apart) therefore lands a perk every 2–3 cities. 0.25 (the bot's own
   *   floor) needs 55 foundings to reach the top perk and lets replays fall to the
   *   one-minute pop-growth floor; 0.5–0.6 reaches it in 25–29 but every cycle then carries
   *   too much content and collapses the same way.
   * - prestigePanelShare: 0.1 — the Legacy panel opens once this run has earned
   *   threshold × 0.1 = $1M (~12 min); a mayor with a bank keeps it from the first second.
   */
  prestige: {
    threshold: 1e7,
    exponent: 0.5,
    incomePerLegacy: 0.04,
    legacyPower: 0.575,
    firstBonus: 0.3,
    startMoneyPerLegacy: 0.05,
    minGain: 1,
    minGainShare: 0.4,
    prestigePanelShare: 0.1,
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
   * here (baseCost, costGrowth, income, housing, powerUse, unlock, ...) and the buildings
   * module merges it over its own definition before registering. Fields not listed keep
   * the buildings module's values.
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
   *
   * Late demand outpaces supply (contract): the four tier-4 consumers draw three times the
   * catalogue figure — arcology 7,500 MW, financial district 12,000, tech campus 13,500,
   * stadium 4,500 — so a nuclear plant (12,000 MW, $400k) carries one or two of them rather
   * than three to five, and the Power tab keeps asking for money through the end of the
   * first city and the first replays. Measured: under-power share 3.3% of the 12 h session
   * (1.6% with the catalogue draw, all of it in the first three cities), a third of the
   * first city's 41 minutes, never below the 0.6 floor; the bot's grid multipliers (Grid
   * and Energy Charters, Orbital Solar, the Dyson Swarm) retire the constraint from city
   * ~8 on. ×4 lifts the share to 3.8% but pushes the first founding past 45 minutes; the
   * tier-3 draw was left alone because doubling it put the first city under power for 40%
   * of its length and moved the first founding to 47 minutes.
   */
  buildings: {
    // Windmills: $40 keeps the first one in reach right after the opening cottage, 4 MW
    // covers four cottages, and growth 2 (the 3rd costs $160, the 5th $640) means the good
    // hilltops run out fast — a coal plant is the real answer once demand passes 20 MW.
    windmill: { baseCost: 40, costGrowth: 2, powerGen: 4 },

    // The corner shop is the first paycheck: five jobs and $0.80/s of till receipts for
    // $50, so the first minute of play already has money moving.
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

    // Tier 4. Base costs and population gates are spaced so the frontier (and the city's
    // growth) delivers one top-tier building every 2–5 minutes of the first city —
    // arcology ~27 min, tech campus and nuclear ~31, financial ~33, stadium ~38 — instead
    // of all of them inside one minute. The arcology's housing is trimmed from 2,500 to
    // 1,000: at 2,500 one arcology was fifteen towers' worth of citizens for the price of
    // one, and a dozen of them tripped every later gate within a minute. Power draws are
    // 3× the catalogue (see above).
    arcology: { baseCost: 120000, housing: 1000, powerUse: 7500, ...popUnlock(4000, '4,000') },
    techpark: { baseCost: 300000, powerUse: 13500, ...popUnlock(8000, '8,000') },
    nuclear: { baseCost: 400000, ...popUnlock(8000, '8,000') },
    // Financial district: opens at 12k citizens, ~33 min, two and a half minutes after the
    // campus, at $700k and $2,600/s (×2.5 with a full payroll): 7.2/$k at base against the
    // campus's 8.75 (the buildings test's band), about 1.4× the campus's frontier value
    // when it lands, so the two ladders climb together.
    financial: { baseCost: 7e5, income: 2600, powerUse: 12000, ...popUnlock(12000, '12,000') },
    stadium: { baseCost: 3.5e6, powerUse: 4500, ...popUnlock(22000, '22,000') },

    // Fusion is the prestige trophy (unlocks at legacy ≥ 1 or 100k citizens). Priced above
    // the nuclear plant it replaces so it is a real purchase in the second city; upkeep
    // trimmed so a young post-prestige city that buys one early is not bled dry.
    fusion: { baseCost: 4e6, upkeep: 1500 },
  },

  /**
   * Per-upgrade overrides, keyed by upgrade id: `{ cost }`. Merged by the upgrades module
   * before registering (charter perks would take legacy points here; none are overridden —
   * the module's 3 … 200,000 ladder is what the cadence above is tuned to).
   *
   * The ladder is 66 rungs: 48 core ($25 → $1.4T), 6 frontier ($2.5T → $1e18, earnings
   * gated at a quarter of the price), 6 Legacy (unlocked by legacy points, paid in money)
   * and 12 Charter perks (paid in legacy points, permanent).
   *
   * Early ladder ($50 → $1.5k): priced at the frontier of minutes 1–8 so the first upgrade
   * lands around a minute in and a new one appears every minute or two after that. Zoning
   * Reform is $75 (not $50) so the first $50 the opening spree leaves goes to the corner
   * shop at 48 s — at $50 the reform took it and the shop waited until 86 s.
   * Mid ladder ($3.5k → $800k): the upgrades module's own values already sit at the
   * 9–35 minute frontier; only High-Density Zoning is pulled forward to help the 1k-pop
   * push, and the three rungs the module re-spaced (Grid Substations, Night Shift, the
   * Container Port) are pinned here so the ladder is config-owned.
   * Smart Grid is the one early rung priced off its natural frontier: $250 (not $400) so
   * the −20% demand lands at ~4 min, right as the two starter windmills run out.
   *
   * Late ladder ($120k → $1.4T) and frontier ($2.5T → $1e18): placed by *city*, not by a
   * fixed ratio. The first four rungs land at the end of the first city and in the second;
   * from Megastructures on, each price sits between the peak cash of two consecutive
   * replays so that one never-before-bought rung lands in each city that has no charter
   * perk landing in it (perks land in cities 4, 7, 10, 13, 17, 20, 23, 26, 28, 31 and 34):
   *   Megastructures 5 · Breeder Reactors 8 · Standing Orders 9 · Orbital Solar 10 ·
   *   Championship Season 11 · Algorithmic Trading 14 · Arcology Gardens 16 · Superconductor
   *   Grid 18 · AI Governance 19 · Planetary Charter 21 · Dyson Swarm 22 · Quantum Exchange
   *   24 · Mass-Driver Port 27 · Ringworld District 29 · Stellar Engine 32.
   * Four cities cannot be targeted at all — 12, 15, 25 and 30 (their peak cash is within
   * 10% of the previous city's, because they follow a perk and are short) — and with 15
   * money rungs for 20 open cities, cities 12, 15, 25, 30, 33 and 35 introduce nothing new.
   * The frontier keeps its earnings gate (a quarter of the price) but not the module's ×10
   * spacing: ×10 apart the six rungs would land in cities 24, 27, 29, 33 and beyond the
   * session, three of them on top of a perk. The Galactic Charter is left at $1e18: with
   * money capped at 1e18 it cannot be bought before the twelve hours end (the last city
   * peaks at $2.4e17), and a reachable price (≤ $1.5e17) lands its ×3 income in the last
   * two cities, where a 12-minute replay follows and the 36th founding passes the legacy
   * ceiling.
   * Placement is what sets the cadence: a strong rung (AI Governance, Planetary Charter,
   * Quantum Exchange) moved one city earlier shortens every later cycle and adds a founding
   * to the session; the mid-game rungs were left where the module's ×3.3 ladder put them
   * and only the second item of each doubled city was moved later.
   * Legacy ladder: paid in money each run, priced for the first minutes of a replay;
   * Standing Orders ($500M) waits for the ninth city so the founding memory arrives as a
   * step, not a freebie.
   */
  upgrades: {
    // early
    'zoning-reform': { cost: 75 },
    'neon-signage': { cost: 80 },
    'grant-writing': { cost: 150 },
    'tax-software': { cost: 250 },
    'turbine-blades': { cost: 300 },
    'smart-grid': { cost: 250 },
    'community-events': { cost: 500 },
    'assembly-lines': { cost: 600 },
    franchising: { cost: 1200 },
    'green-belts': { cost: 1500 },
    'grid-substations': { cost: 3500 },
    // mid
    'high-density': { cost: 6000 },
    'night-shift': { cost: 15000 },
    'container-port': { cost: 45000 },
    // late (placed by city — see above)
    'prefab-construction': { cost: 120000 },
    'skyway-frames': { cost: 400000 },
    'digital-city-hall': { cost: 1.3e6 },
    'preventive-care': { cost: 4e6 },
    'robotic-assembly': { cost: 1.3e7 },
    megastructures: { cost: 1.15e8 },
    'breeder-reactors': { cost: 2.5e8 },
    'orbital-solar': { cost: 1.3e9 },
    'championship-season': { cost: 2.5e9 },
    'algorithmic-trading': { cost: 2.4e10 },
    'arcology-gardens': { cost: 5.5e10 },
    'superconductor-grid': { cost: 1.7e11 },
    'ai-governance': { cost: 3.3e11 },
    'planetary-charter': { cost: 1.4e12 },
    // frontier (earnings gate follows the price: a quarter of it)
    'dyson-swarm': { cost: 2.5e12 },
    'quantum-exchange': { cost: 1.5e13 },
    'mass-driver-port': { cost: 7e14 },
    'ringworld-district': { cost: 2.5e15 },
    'stellar-engine': { cost: 9e15 },
    'galactic-charter': { cost: 1e18 },
    // legacy
    'legacy-archive': { cost: 5000 },
    'founders-blueprints': { cost: 30000 },
    'veteran-planners': { cost: 80000 },
    'dynasty-ledger': { cost: 150000 },
    'institutional-memory': { cost: 1e6 },
    'standing-orders': { cost: 5e8 },
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
