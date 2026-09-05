// Metropolis — balance configuration.
// The single source of tuning truth. Every number that shapes pacing lives here so the
// balance owner can retune the game without touching any other folder.
// DOM-free: this file must import cleanly in Node (economy-sim) and the browser.
//
// Pacing (greedy bot, `node tools/economy-sim.mjs --ticks 432000 --out logs/sim-balance.json`,
// 12 game-hours; measured on the 2026-09-05 tree with the earnings-only legacy rule, the
// twelve charter perks and the earnings-gated frontier ladder — re-measure before quoting).
//   Opening: cottage 0 s · two windmills, three more cottages and the Welcome Sign by 4 s ·
//   first corner shop 50 s (the shop gets the first $50; Zoning Reform follows at ~105 s) ·
//   first brownout ~2.3 min · 1k citizens 12 min · Legacy panel at $924k earned (~12 min) ·
//   Found button arms at $9.24M (~19 min) · first founding 41.5 min with 5 legacy.
//   Power: the first city runs under full power for a third of its 41 minutes (tier-4 draw
//   is 3× the catalogue's, see buildings below); the session as a whole sits under power
//   3.9% of the time, never below the 0.6 floor.
//   Cycles (minutes): 42 · 16 · 18 · 5.4 · 6.6 · 7.3 · 9.7 · 14 · 17 · 22 · 24 · 25 · 31 · 33 · 29 · 32 · 28 · 36 · 45 · 22 · 18 · 22 · 15 · 18 · 24 · 25 · 29 · 31 · 42 · 20 · 9.4
//   — 31 foundings, the last completed cycle 9.4 min. Legacy 1.93e+05 (127,476 spent on all
//   twelve charter perks), money peak 8.4e+16, income 1.2e+15/s at the end. A charter
//   perk lands every 2–3 cities and a money rung in each city between (see the placement
//   table in the upgrades block); the shape is a 5–7 minute floor at cities 3–5, a ramp to
//   ~20 min by city 11, then a 15–45 minute plateau.
//   Happiness dips under 1.0 in 19 of 31 cities (the first minute of every replay: an
//   all-housing spree with 40% of the citizens jobless and the grid dark for a step).
//   Coverage: every building and every one of the 66 upgrades.
//
// How the late game is placed. The verify/sim bot never saves: it buys the best-scoring
// *affordable* item every two seconds, so the cash it holds tracks a "frontier" — a few
// seconds of income in a mature city, spiking during the first three minutes of a replay
// when every re-bought rung lands before building prices have caught up. A money rung is
// bought in the first city whose cash reaches its price, so the late ladder is placed by
// *city*: each price sits between two consecutive cities' spree cash (see the placement
// table in the upgrades block). The bot's legacy sequence is deterministic (5 points, then
// +40% per founding: 5, 10, 15, 21, 30, 42, 59, 83, 117, 164, 230, 322, 451, 632, 885,
// 1239, 1735, 2429, 3401, 4762, 6667, 9335, 13070, 18300, 25629, 35888, 50265, 70375,
// 98568, 138005 after founding 30), so a charter perk lands in a fixed city set by its
// price alone: the ×2.5 ladder below signs one every 2–3 cities (1, 3, 6, 8, 11, 14, 17,
// 19, 22, 25, 28, 30). Three structural facts drive every number:
//   • a replay's income is set inside its first three minutes (seed cash × legacy bonus
//     buys the whole core ladder back at once); after that a mature city's income grows
//     only logarithmically with spend, so a cycle's length is essentially "earnings
//     required / income after the spree";
//   • each founding must out-earn the whole past by 1.4^(1/exponent) − 1, while the legacy
//     bonus grows 1.4^legacyPower per founding; with no new content a cycle is ~×1.4
//     longer than the one before it, so every city needs a never-before-bought item that
//     is worth ≥ ×1.05 income to keep the rise under the contract's ×1.35;
//   • a rung priced above the previous city's late-cycle cash lands mid-city and mostly
//     lifts the *next* city, so the money city right after a perk city is the unboosted
//     one and carries the strongest rung of its block.
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
   *   that third windmill at 2 s and puts the first shop at 150 s instead of 50.
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
   * - unemploymentPenalty: happiness lost at 100% unemployment. 0.4: a veteran city opens
   *   with a spree of cottages before its first shop, and for that minute two in five
   *   citizens are jobless. Together with the brownout penalty below this is what makes a
   *   replay dip under 1.0 happiness (19 of the first 33 cities); at 0.3 the +0.55 of flat
   *   happiness a veteran carries (kept civic rungs, the Civic Charter, the legacy tiers)
   *   hides it and only a quarter of the cities ever dip. The first city's opening minute
   *   reads 0.36 (the dark first tick) instead of 0.7.
   * - overcrowdPenalty: happiness lost per 100% overcrowding (pop/housing − 1). Only bites
   *   briefly after selling housing.
   * - brownoutPenalty: happiness lost at a full blackout (powerRatio 0). 0.6: stacks with
   *   the direct powerRatio scaling, so brownouts hurt growth twice — build power. At the
   *   0.6 floor a blackout costs 0.24 happiness, which is what a replay's first dark step
   *   and the first city's tier-4 brownouts need to be felt.
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
   *   2 (see buildings.windmill). Measured: the relative income a mature city gains from
   *   its remaining cash is ln(spend ratio) / ln(cash / base cost) whatever the growth
   *   base, so tier growth shapes the first city's ladder, not the late-cycle plateau
   *   (1.08 for tier 4 doubled the founding count and broke the legacy ceiling without
   *   changing a replay's income curve).
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
   * - threshold: lifetime earnings worth the first point, $9.24M (~19 min into the first
   *   city). With minGain 1 that is the moment the Found button arms, so the counter the
   *   panel shows is the real bar. The bot holds out for 5 points, $250M, and founds at
   *   41.5 min. threshold and exponent are tied: 5 points must cost $250M
   *   (threshold = 2.5e8 / 5^(1/exponent)) or the first founding leaves the 30–45 minute
   *   window.
   * - exponent: 0.488. The bot resets for +40% legacy (minGainShare), which at exponent e
   *   means each run out-earns everything before it by 1.4^(1/e) − 1: ×0.99 at 0.488.
   *   Against the ×1.22 the legacy bonus grows per founding and the ~×1.15 a bigger
   *   frontier adds, a city with nothing new is ~×1.37 longer than the one before it —
   *   just under the contract's ×1.35 + 30 s, which is what lets the Energy Charter city
   *   (a perk that does nothing for a replay's income) follow the Stellar Engine city
   *   without a violation. The 0.012 below 0.5 is also the gentle tilt that turns a flat
   *   12–25 minute plateau (30 foundings by hour eight, then five empty replays) into one
   *   that reaches the 30th founding in the last hour; 0.485 leaves that step at ×1.37 +
   *   9 s over the line, 0.49 and above speed the tail into 32–35 foundings with empty
   *   cities at the end. 0.46 and below made the mid game 40–60 minute cities; 0.55
   *   collapsed everything into 3–6 minute replays and blew through the legacy ceiling
   *   (52 foundings).
   * - incomePerLegacy / legacyPower: income × (1 + 0.01·legacy)^0.6 (the contract's
   *   maximum root), uncapped: ×1.6 at 100 points, ×16 at 10k, ×75 at the 1.4e5 a 12 h
   *   session banks. The knee of the curve (k·legacy ≈ 1, at 100 points ≈ city 8) is
   *   the lever that shapes the early replays: below it the bonus barely grows per
   *   founding and the 4–7 minute floor cities lengthen into the plateau by themselves;
   *   above it the bonus grows ×1.4^0.6 per founding. At the old 0.04 the knee sat at 25
   *   points (city 4) and the session ran to 43 foundings; at 0.005 the ramp is steeper
   *   than the ×1.35 the contract allows. The first founding's jump is firstBonus, not
   *   the points: (1 + 0.05)^0.6 is ×1.03.
   * - firstBonus: 0.23 — the first founding is still a jump a player can feel (×1.23 on
   *   top of the points' ×1.03), and cities 2–3 take 16–18 minutes to out-earn the first.
   *   This is the one knob that scales every replay's income and nothing in the first
   *   city, so it sets *when* the session's 30th founding lands without moving a single
   *   cycle ratio: 0.3 puts it at hour 11 with two empty replays after it, 0.2 leaves the
   *   Imperial Charter unsigned at 12 h; 0.22–0.23 land it at 704–710 min with the 31st
   *   founding in the last ten minutes. A ±1.5% change in late income by another module
   *   moves that edge — re-measure after retuning perks or the frontier.
   * - startMoneyPerLegacy: post-reset seed cash = startMoney · (1 + 0.05·legacy). Five
   *   points (one bot cycle) buy the opening cottages and windmills outright; kept small
   *   so replays are quicker, not skipped.
   * - minGain: 1 — the Found button arms at the first point (see threshold).
   * - minGainShare: 0.4 — once a bank exists the button also waits for 40% of it, so a
   *   1,000-point mayor is offered a reset at +400, never at +3. This is the knob that sets
   *   the session's legacy sequence (×1.4 per founding: 1.38e5 points after 30 foundings,
   *   the ceiling of 1e6 at the 37th) and therefore where every charter perk lands; the
   *   ×2.5 perk ladder needs 30 foundings to reach the Imperial Charter, which the 12 h
   *   session delivers in its last hour. 0.45–0.5 reach the top perk in fewer foundings
   *   but leave the 16 late money rungs short of the cities they must fill.
   * - prestigePanelShare: 0.1 — the Legacy panel opens once this run has earned
   *   threshold × 0.1 = $924k (~12 min); a mayor with a bank keeps it from the first second.
   */
  prestige: {
    threshold: 9.24e6,
    exponent: 0.488,
    incomePerLegacy: 0.01,
    legacyPower: 0.6,
    firstBonus: 0.23,
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
   * first city and the first replays. Measured: under-power share 3.9% of the 12 h session
   * (1.6% with the catalogue draw), a third of the first city's 41 minutes, never below the
   * 0.6 floor. From city ~6 on the grid multipliers (Grid and Energy Charters, Orbital
   * Solar, Breeder Reactors, the Dyson Swarm, Superconductor Grid — ×70 together) retire
   * the constraint: halving nuclear and fusion output or doubling the tier-4 draw changes
   * nothing after city 3 and only pushes the first founding past 45 minutes. ×4 draw lifts
   * the share to 3.8% but costs the same; the tier-3 draw was left alone because doubling
   * it put the first city under power for 40% of its length.
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
    // trimmed so a young post-prestige city that buys one early is not bled dry. The bot
    // keeps buying nuclear plants for the grid ($33/MW against fusion's $67), so the
    // reactor is a trophy rather than the late-game generator.
    fusion: { baseCost: 4e6, upkeep: 1500 },
  },

  /**
   * Per-upgrade overrides, keyed by upgrade id: `{ cost }` (legacy points for charter
   * perks, money otherwise). Merged by the upgrades module before registering.
   *
   * The ladder is 66 rungs: 48 core ($25 → $7.6T), 6 frontier ($18B → $1.2Qa, earnings
   * gated at a quarter of the price), 6 Legacy (unlocked by legacy points, paid in money)
   * and 12 Charter perks (paid in legacy points, permanent).
   *
   * Early ladder ($50 → $1.5k): priced at the frontier of minutes 1–8 so the first upgrade
   * lands around a minute in and a new one appears every minute or two after that. Zoning
   * Reform is $75 (not $50) so the first $50 the opening spree leaves goes to the corner
   * shop at 50 s — at $50 the reform took it and the shop waited until 86 s.
   * Mid ladder ($3.5k → $800k): the upgrades module's own values already sit at the
   * 9–35 minute frontier; only High-Density Zoning is pulled forward to help the 1k-pop
   * push, and the three rungs the module re-spaced (Grid Substations, Night Shift, the
   * Container Port) are pinned here so the ladder is config-owned.
   * Smart Grid is the one early rung priced off its natural frontier: $250 (not $400) so
   * the −20% demand lands at ~4 min, right as the two starter windmills run out.
   *
   * Charter perks: a pure ×2.5 ladder from 3 to 76,488 points (the module's own ladder
   * ends at 200,000, which the bot's sequence only reaches at the 33rd founding, a city
   * the 12 h session does not have). With the sequence in the header they are signed in
   * cities 1 (Homestead), 3 (Mint), 6 (Grid), 8 (Guild), 11 (Merchant), 14 (Settlers),
   * 17 (Masons), 19 (Civic), 22 (Treasury), 25 (Skyline), 28 (Energy) and 30 (Imperial),
   * and a perk always opens at half its price, so the next clause is on the card a city
   * or two before it can be afforded.
   *
   * Late ladder, placed by *city*. Every city from the 5th on gets exactly one
   * never-before-bought money rung (the perk cities get their perk instead), and the
   * strongest rungs sit in the money city right after a perk city (see the header for
   * why): a rung landing mid-city mostly lifts the city after it, so the city after a
   * perk is the one with no boost of its own. Charter cities in brackets:
   *   5 Championship Season · [6 Grid] · 7 Standing Orders · [8 Guild] · 9 Robotic
   *   Assembly · 10 Megastructures · [11 Merchant] · 12 Planetary Charter · 13 Dyson
   *   Swarm · [14 Settlers] · 15 AI Governance · 16 Orbital Solar · [17 Masons] · 18
   *   Quantum Exchange · [19 Civic] · 20 Algorithmic Trading · 21 Arcology Gardens ·
   *   [22 Treasury] · 23 Mass-Driver Port · 24 Superconductor Grid · [25 Skyline] · 26
   *   Ringworld District · 27 Stellar Engine · [28 Energy] · 29 Galactic Charter ·
   *   [30 Imperial].
   * The second city takes the rest of the tier-4 core (Breeder Reactors at $20M, the
   * Legacy rungs, the fusion reactor and the stadium); Institutional Memory stays in the
   * third city on purpose — its founding re-grant of the tier-1/2 ladder is what turns
   * cities 3–5 into four-minute replays (without it they take seven).
   * Measured strengths (how much shorter the city after the rung is, over the ~×1.4 a
   * city with nothing new grows): Quantum Exchange ×2.8, Galactic Charter ×2.4, Planetary
   * Charter ×1.7, AI Governance ×1.45, Algorithmic Trading ×1.2, Robotic Assembly and
   * Breeder Reactors ×1.15; the power rungs (Orbital Solar, Dyson Swarm, Superconductor
   * Grid, Stellar Engine) and the housing rungs (Megastructures, Arcology Gardens,
   * Ringworld District) are ×1.0–1.1 in a replay, whose grid and housing are never the
   * constraint — they are variety, not pace, and are placed in the cities that can
   * afford a weak rung.
   * The frontier keeps its canonical order (Dyson < Quantum < Mass-Driver < Ringworld <
   * Stellar < Galactic) and its earnings gate (a quarter of the price) but not the
   * module's ×10 spacing or its 1e13 floor: ×10 apart the six rungs would land three to a
   * city and leave a dozen cities empty, and the Galactic Charter at $1e18 (the money
   * ceiling) is a rung the bot's cash never reaches. At $1.2Qa it is the 29th city's
   * purchase, one city before the Imperial Charter.
   * Legacy ladder: paid in money each run, priced for the first minutes of a replay;
   * Standing Orders ($220M) waits for the seventh city so the founding memory arrives as
   * a step, not a freebie.
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
    // tier-4 core, first city
    'prefab-construction': { cost: 120000 },
    'skyway-frames': { cost: 400000 },
    'digital-city-hall': { cost: 1.3e6 },
    'preventive-care': { cost: 4e6 },
    // second city
    'breeder-reactors': { cost: 2e7 },
    // late ladder, one rung per city (placement table above)
    'championship-season': { cost: 6.8e7 },
    'robotic-assembly': { cost: 7.4e8 },
    megastructures: { cost: 2.1e9 },
    'planetary-charter': { cost: 7.8e9 },
    'dyson-swarm': { cost: 1.8e10 },
    'ai-governance': { cost: 4.5e10 },
    'orbital-solar': { cost: 1.3e11 },
    'quantum-exchange': { cost: 5.2e11 },
    'algorithmic-trading': { cost: 3.6e12 },
    'arcology-gardens': { cost: 7.6e12 },
    'mass-driver-port': { cost: 6.5e13 },
    'superconductor-grid': { cost: 9.1e13 },
    'ringworld-district': { cost: 3.6e14 },
    'stellar-engine': { cost: 5.6e14 },
    'galactic-charter': { cost: 1.2e15 },
    // legacy (money-priced, unlocked by points)
    'legacy-archive': { cost: 5000 },
    'founders-blueprints': { cost: 30000 },
    'veteran-planners': { cost: 80000 },
    'dynasty-ledger': { cost: 150000 },
    'institutional-memory': { cost: 1e6 },
    'standing-orders': { cost: 2.2e8 },
    // charter perks (legacy points): ×2.5 apart (whole points, never under), 3 → 76,488
    'charter-homestead': { cost: 3 },
    'charter-mint': { cost: 8 },
    'charter-grid': { cost: 20 },
    'charter-guild': { cost: 50 },
    'charter-merchant': { cost: 125 },
    'charter-settlers': { cost: 313 },
    'charter-masons': { cost: 783 },
    'charter-civic': { cost: 1958 },
    'charter-treasury': { cost: 4895 },
    'charter-skyline': { cost: 12238 },
    'charter-energy': { cost: 30595 },
    'charter-imperial': { cost: 76488 },
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
