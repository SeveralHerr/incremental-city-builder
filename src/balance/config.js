// Metropolis — balance configuration.
// The single source of tuning truth. Every number that shapes pacing lives here so the
// balance owner can retune the game without touching any other folder.
// DOM-free: this file must import cleanly in Node (economy-sim) and the browser.
//
// Pacing (greedy bot, `node tools/economy-sim.mjs --ticks 432000 --out logs/sim-balance.json`,
// 12 game-hours; measured on the 2026-09-07 tree — pace ladder hidden until fundable,
// eight-rung frontier, City Archives, building synergies — re-measure before quoting).
//   Opening: cottage 0 s · two windmills, three more cottages and the Welcome Sign by 4 s ·
//   first corner shop 50 s (the shop gets the first $50; Zoning Reform follows at ~105 s) ·
//   first brownout ~2.3 min · 1k citizens 12 min · Legacy panel at $1.1M earned (~12 min) ·
//   Found button arms at $11M (~20 min) · first founding ~41 min with 5 legacy.
//   Power: the first city runs under full power for a third of its 41 minutes (tier-4 draw
//   is 3.2–3.8× the catalogue's, see buildings below); the session as a whole sits under
//   power 3.6% of the time, never below the 0.6 floor.
//   Cycles (minutes): 41 · 16 · 16 · 4.8 · 6.4 · 7.6 · 11 · 14 · 17 · 22 · 28 · 27 · 29 · 23 ·
//   28 · 23 · 31 · 40 · 19 · 26 · 21 · 26 · 18 · 21 · 28 · 30 · 35 · 38 · 28 · 35 — 30 foundings,
//   the 31st city open at 12 h with the Imperial Charter signed and the Exchange Ring bought
//   in its first four minutes. Legacy 1.38e+05 (127,476 spent on all twelve charter perks),
//   money peak 2.2e+16, income 5.8e+14/s at the end (1.2e+14/s before the Imperial
//   Charter). A charter perk lands every 2–3 cities
//   and a money rung in each city between (placement table in the upgrades block); the
//   shape is a 5–8 minute floor at cities 4–6, a ramp to ~28 min by city 11, then a 20–40
//   minute plateau with no cycle more than ×1.35 (+30 s) longer than the one before it.
//   Purchase tension: the cheapest unlocked, unowned money upgrade is 30 s – 15 min of
//   income away in ~49% of samples (contract ≥ 30%): from the 6th city on the Upgrades
//   panel always shows the next frontier rung as a target a few minutes out, because the
//   pace rungs stay hidden until the city can fund them (upgrades module) and the frontier
//   prices below sit at 40–300 s of the plateau income of the cities that see them.
//   Happiness dips under 1.0 in 29 of 30 cities (the first minute of every replay: an
//   all-housing spree with 40% of the citizens jobless and the grid dark for a step).
//   Coverage: every building and every one of the 78 upgrades.
//   Saver profile (`--saver`, a bot that saves toward a rung within 30 s of income): 33
//   foundings, legacy 3.8e+05, money peak 1.3e+17 — inside both ceilings (1e6 / 1e18) with
//   two foundings of margin; it is not held to the cadence numbers.
//
// How the late game is placed. The verify/sim bot never saves: it buys the best-scoring
// *affordable* item every two seconds, so the cash it holds tracks a "frontier" — 2–10
// seconds of income in a mature city, spiking during the first three minutes of a replay
// when income has jumped (a founding, a perk) and building prices have not caught up; that
// spike grows from ~4 s of the previous city's income at city 4 to 30–60 s by city 20 and
// ~200 s in the Imperial city, as cost perks and income multipliers pile up. A money rung
// is bought in the first city whose cash reaches its price, so the late ladder is placed
// by *city*: each price sits between two consecutive cities' reach (see the placement
// table in the upgrades block). The bot's legacy sequence is deterministic (5 points, then
// +40% per founding: 5, 10, 15, 21, 30, 42, 59, 83, 117, 164, 230, 322, 451, 632, 885,
// 1239, 1735, 2429, 3401, 4762, 6667, 9335, 13070, 18300, 25629, 35888, 50265, 70375,
// 98568, 138005 after founding 30), so a charter perk lands in a fixed city set by its
// price alone: the ×2.5 ladder below signs one every 2–3 cities (2, 4, 7, 9, 12, 15, 18,
// 20, 23, 26, 29, 31). Four structural facts drive every number:
//   • a replay's income is set inside its first three minutes (seed cash × legacy bonus
//     buys the whole core ladder back at once); after that a mature city's income grows
//     only logarithmically with spend, so a cycle's length is essentially "earnings
//     required / income after the spree";
//   • each founding must out-earn the whole past by 1.4^(1/exponent) − 1, while the legacy
//     bonus grows 1.4^legacyPower per founding; with no new income a cycle is ~×1.4
//     longer than the one before it, so a city whose only novelty is a power, growth or
//     housing item (Dyson Swarm, Stellar Engine, the Settlers' and Energy Charters) must
//     follow a city whose income rung landed *late* — the rung then lifts the weak city
//     instead of the one that bought it — or the ×1.35 cadence line breaks;
//   • a pace rung (upgrades: opens once the city has earned 100× its price, or holds it)
//     is re-bought every replay; if the replay's spree cannot cover it, it waits for the
//     plateau cash and lands 15–25 minutes in, which is what makes cities 13 and 15 the
//     "late-landing" cities the two weak cities after them need;
//   • the frontier rungs are bought in price order (a cheaper frontier rung is always
//     affordable first), so their order across cities is fixed and only their spacing is
//     free; the pace rungs and the two money-priced Legacy rungs (City Archives, Standing
//     Orders) are the movable pieces.
//
// Consumers: resources.computeDerived (economy/pop/power/happiness), buildings (cost +
// per-building overrides), upgrades (cost overrides), simulation (prestige, milestones,
// startMoney, tap), save (autosave/offline).
//
// Cross-module seam: src/simulation/tuning.js keeps a DEFAULTS copy of the prestige,
// economy and milestones sections as its fallback, and simulation.test.mjs asserts the copy
// equals this file knob for knob. A prestige change here (threshold, legacyPower,
// firstBonus in this pass) must be mirrored there by the simulation owner.

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
   *   has time to breathe. Measured: wage and tax only shape the first city — a replay's
   *   income is building income (a 10% trim moved the first founding by 2 min and no
   *   later cycle by more than 0.3), so they are not a late-game lever.
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
   *   Measured (2026-09-07): raising the scale to 0.45 changes nothing after city 1 — a
   *   mature replay carries +0.55 of flat happiness from rungs and perks and +0.4 from the
   *   legacy tiers, and the clean-air tiers cut smog 90% by 5,000 points, so no mid-city
   *   dip is reachable from this block while the cap must stay under civicCap. It only
   *   adds a minute to the first city, so the scale stays at 0.35.
   * - unemploymentPenalty: happiness lost at 100% unemployment. 0.4: a veteran city opens
   *   with a spree of cottages before its first shop, and for that minute two in five
   *   citizens are jobless. Together with the brownout penalty below this is what makes a
   *   replay dip under 1.0 happiness (29 of 30 cities); at 0.3 the flat happiness a veteran
   *   carries hides it and only a quarter of the cities ever dip. The first city's opening
   *   minute reads 0.36 (the dark first tick) instead of 0.7.
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
   *   tier-4 grows slowest (1.11) so late-game spam stays viable. Civic buildings override
   *   with 1.18–1.2 to keep happiness from being a cheap stat dump, and the windmill with
   *   2 (see buildings.windmill). Tiers 3 and 4 were trimmed from 1.14 / 1.12 to 1.13 /
   *   1.11 in the 2026-09-07 pass: a replay's spree pile is the cash the bot cannot spend
   *   before building prices catch up with its income, and one point of growth off the
   *   top tiers lets that pile reach the next frontier rung a city sooner for the
   *   never-saving bot — the saver profile, which reaches rungs by waiting, gains almost
   *   nothing, so the gap between the two profiles (the saver's legacy-ceiling risk)
   *   closes from six foundings to three. 1.12 / 1.10 opened the pile enough to put the
   *   default profile past 36 foundings and the saver over the 1e6 legacy ceiling.
   *   Measured on the first city: the tier trim moves the first founding by −0.3 min.
   * - sellRefund: fraction of the *current* price returned on sell. 0.5 makes reshuffling
   *   possible but never free.
   */
  cost: { tierGrowth: { 1: 1.18, 2: 1.16, 3: 1.13, 4: 1.11 }, sellRefund: 0.5 },

  /**
   * Prestige — "Found a new city". The rules live in src/simulation/prestige.js and
   * tuning.js; this block is the complete list of what they read.
   *
   * Legacy comes from lifetime earnings only: the bank is worth floor((lifetimeEarned /
   * threshold) ^ exponent) points in total and a founding banks the difference to what is
   * already held. Legacy is also a currency (charter perks, upgrades module): spending
   * never lowers the income bonus, which always uses the full bank.
   *
   * - threshold: lifetime earnings worth the first point, $11M (~20 min into the first
   *   city). With minGain 1 that is the moment the Found button arms, so the counter the
   *   panel shows is the real bar. The bot holds out for 5 points, $297M, and founds at
   *   ~41 min. Because every later founding needs lifetime earnings of threshold ×
   *   L^(1/exponent), the threshold is the one knob that stretches the whole session
   *   uniformly (+5% threshold ≈ +5% on every cycle, no city re-ordered) — it is what
   *   places the 12 h mark inside the 31st city, after the Imperial Charter and the
   *   Exchange Ring are bought and before an empty replay could complete. Measured:
   *   $10.5M ends the session with a 32nd, empty city completed; $11.5M leaves the
   *   Imperial Charter unsigned (29 foundings). Both profiles keep the first founding
   *   inside 30–45 min at $11M (41 min).
   * - exponent: 0.488. The bot resets for +40% legacy (minGainShare), which at exponent e
   *   means each run out-earns everything before it by 1.4^(1/e) − 1: ×0.99 at 0.488.
   *   Extremely sensitive and non-monotone on this tree (0.47 → 22 foundings with eight
   *   items never bought; 0.48 → 25; 0.488 → 28 before the other knobs below), because a
   *   founding a minute earlier or later re-orders which city buys which rung. It stays
   *   where the ladder was placed; the tail is steered with threshold and legacyPower.
   * - incomePerLegacy / legacyPower: income × (1 + 0.01·legacy)^0.57 (the contract allows
   *   up to 0.6), uncapped: ×1.5 at 100 points, ×13 at 10k, ×55 at the 1.4e5 a 12 h
   *   session banks. The knee of the curve (k·legacy ≈ 1, at 100 points ≈ city 8) is
   *   the lever that shapes the early replays: below it the bonus barely grows per
   *   founding and the 4–8 minute floor cities lengthen into the plateau by themselves;
   *   above it the bonus grows ×1.4^p per founding. legacyPower 0.57 (was 0.6) is the
   *   tail brake: it costs 1% of income at 100 points, 13% at 1e5 and 33% at 1e6, so it
   *   slows the content-exhausted replays after the 30th founding — where the saver
   *   profile was compounding to 37 foundings, 1.46M legacy and a $2e18 money peak — far
   *   more than the mid game. 0.55 and below drag the mid game too (27–29 foundings, the
   *   top rungs never bought).
   * - firstBonus: 0.30 — the first founding is still a jump a player can feel (×1.30 on
   *   top of the points' ×1.03), and cities 2–3 take ~16 minutes to out-earn the first.
   *   This is the one knob that scales every replay's income and nothing in the first
   *   city; it buys back the mid-game speed legacyPower 0.57 removes (0.23 with 0.57
   *   leaves the session at 29 foundings and the Imperial Charter unsigned).
   * - startMoneyPerLegacy: post-reset seed cash = startMoney · (1 + 0.05·legacy). Five
   *   points (one bot cycle) buy the opening cottages and windmills outright; kept small
   *   so replays are quicker, not skipped.
   * - minGain: 1 — the Found button arms at the first point (see threshold).
   * - minGainShare: 0.4 — once a bank exists the button also waits for 40% of it, so a
   *   1,000-point mayor is offered a reset at +400, never at +3. This is the knob that sets
   *   the session's legacy sequence (×1.4 per founding: 1.38e5 points after 30 foundings,
   *   the ceiling of 1e6 at the 36th) and therefore where every charter perk lands; the
   *   ×2.5 perk ladder needs 30 foundings to reach the Imperial Charter, which the 12 h
   *   session delivers in its last hour. It also pins the legacy ceiling to a founding
   *   count: any profile that completes 35 foundings in 12 h banks ~7.4e5, and a 36th
   *   crosses 1e6 — so the tail brake above is what keeps the saver at 33.
   * - prestigePanelShare: 0.1 — the Legacy panel opens once this run has earned
   *   threshold × 0.1 = $1.1M (~12 min); a mayor with a bank keeps it from the first second.
   */
  prestige: {
    threshold: 1.1e7,
    exponent: 0.488,
    incomePerLegacy: 0.01,
    legacyPower: 0.57,
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
   * Late demand outpaces supply (contract): the four tier-4 consumers draw 3.2–3.8× the
   * catalogue figure — arcology 9,500 MW, financial district 15,000, tech campus 17,000,
   * stadium 5,600 — so a nuclear plant (12,000 MW, $400k) carries one of them rather than
   * three to five, and the Power tab keeps asking for money through the end of the first
   * city and the first replays. Measured: under-power share 3.6% of the 12 h session
   * (2.9% at the previous ×3 draw once the buildings module's solar and fusion synergies
   * landed, under the contract's 3% floor; 4.6% at ×4), a third of the first city's 41
   * minutes, never below the 0.6 floor. From city ~6 on the grid multipliers (Grid and
   * Energy Charters, Orbital Solar, Breeder Reactors, the Dyson Swarm, Superconductor Grid
   * — ×70 together) retire the constraint: the draw changes nothing after city 3 and only
   * moves the first founding (+2 min at this draw, still inside 30–45).
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
    // 3.2–3.8× the catalogue (see above).
    arcology: { baseCost: 120000, housing: 1000, powerUse: 9500, ...popUnlock(4000, '4,000') },
    techpark: { baseCost: 300000, powerUse: 17000, ...popUnlock(8000, '8,000') },
    nuclear: { baseCost: 400000, ...popUnlock(8000, '8,000') },
    // Financial district: opens at 12k citizens, ~33 min, two and a half minutes after the
    // campus, at $700k and $2,600/s (×2.5 with a full payroll): 7.2/$k at base against the
    // campus's 8.75 (the buildings test's band), about 1.4× the campus's frontier value
    // when it lands, so the two ladders climb together.
    financial: { baseCost: 7e5, income: 2600, powerUse: 15000, ...popUnlock(12000, '12,000') },
    stadium: { baseCost: 3.5e6, powerUse: 5600, ...popUnlock(22000, '22,000') },

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
   * The ladder is 78 rungs: 39 core ($25 → $20M, the first city's decisions), 9 pace
   * rungs ($300M → $91T, hidden until the city has earned 100× the price or holds it),
   * 8 frontier ($18B → $22Qa, earnings gated at a quarter of the price), 7 Legacy
   * (unlocked by legacy points, paid in money) and 12 Charter perks (paid in legacy
   * points, permanent). Every self-priced gate follows the price set here.
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
   * cities 2 (Homestead), 4 (Mint), 7 (Grid), 9 (Guild), 12 (Merchant), 15 (Settlers),
   * 18 (Masons), 20 (Civic), 23 (Treasury), 26 (Skyline), 29 (Energy) and 31 (Imperial),
   * and a perk always opens at half its price, so the next clause is on the card a city
   * or two before it can be afforded.
   *
   * Late ladder, placed by *city* (cities counted from the first founding; charter cities
   * in brackets; "late" = the rung lands in the last third of its city, so it lifts the
   * next one — see the header for why the weak cities need that):
   *   [4 Mint] · 5 — (before the 6th founding, exempt from the variety rule) · 6 City
   *   Archives (late) · [7 Grid] · 8 Championship Season · [9 Guild] · 10 Robotic
   *   Assembly · 11 Megastructures · [12 Merchant] · 13 Planetary Charter (late) · 14
   *   Dyson Swarm · [15 Settlers] + AI Governance (late) · 16 Standing Orders · 17 Orbital
   *   Solar · [18 Masons] · 19 Quantum Exchange · [20 Civic] · 21 Algorithmic Trading ·
   *   22 Arcology Gardens · [23 Treasury] · 24 Mass-Driver Port · 25 Superconductor Grid ·
   *   [26 Skyline] · 27 Ringworld District · 28 Stellar Engine · [29 Energy] + Galactic
   *   Charter (its spree) · 30 Orbital Shipyard · [31 Imperial] + Exchange Ring (its spree).
   * Every city from the 6th on gets at least one never-before-bought item; three cities
   * carry two on purpose: the AI Governance lands in the last minutes of the Settlers'
   * city so the Standing Orders city after it (a memory rung, no income) is not the ×1.4
   * step; the Galactic Charter is priced at the Energy city's spree because the Stellar
   * Engine before it moves no income and two income-free cities in a row is a ×1.4 step;
   * the Exchange Ring shares the Imperial city because that city's spree (~200 s of
   * income: the Imperial Charter triples income at the founding and prices lag) is as big
   * as the whole next city's reach, so nothing cash-priced can be placed between them.
   * The second city takes the rest of the tier-4 core (Breeder Reactors at $20M, the
   * Legacy rungs, the fusion reactor and the stadium); Institutional Memory stays in the
   * third city on purpose — its founding re-grant of the tier-1/2 ladder is what turns
   * cities 3–5 into four-minute replays (without it they take seven).
   * Legacy rungs: paid in money each run, priced for the first minutes of a replay, except
   * the two used as late content. City Archives ($80M) lands at the end of the 6th city,
   * so its growth and jobs lift the Grid Charter city (a power perk) instead of the city
   * that bought it. Standing Orders ($80B) waits for the 16th city: its founding memory
   * (tier-3 and Legacy rungs granted at every founding) is a convenience whose pacing
   * value is nil after the 8th city — the rungs it remembers cost seconds of a replay's
   * income — but as the 16th city's novelty it fills the slot the AI Governance vacated.
   * One measured side effect: without it, cities 9–15 re-buy the tier-3 and Legacy rungs
   * in their opening spree, which trims that spree by ~30%; the Planetary Charter is
   * priced at $6.5B (not $7.8B) so the 14th city's $7.7B spree still re-buys it at once
   * instead of waiting 20 minutes for the plateau cash.
   * Measured strengths (how much shorter the city after the rung is, over the ~×1.4 a
   * city with nothing new grows): Quantum Exchange ×2.8, Galactic Charter ×2.4, Planetary
   * Charter ×1.7, AI Governance ×1.45, Exchange Ring ×2.5, Algorithmic Trading ×1.2,
   * Robotic Assembly and Breeder Reactors ×1.15; the power rungs (Orbital Solar, Dyson
   * Swarm, Superconductor Grid, Stellar Engine) and the housing rungs (Megastructures,
   * Arcology Gardens, Ringworld District) are ×1.0–1.1 in a replay, whose grid and
   * housing are never the constraint — they are variety, not pace, and are placed in the
   * cities that can afford a weak rung.
   * The frontier keeps its canonical order (Dyson < Quantum < Mass-Driver < Ringworld <
   * Stellar < Galactic < Shipyard < Exchange Ring) and its earnings gate (a quarter of the
   * price) but not the module's ×10 spacing or its 1e13 floor: ×10 apart the eight rungs
   * would land three to a city and leave a dozen cities empty. The spacing is also the
   * purchase-tension reading: the cheapest unowned frontier rung is what the Upgrades
   * panel shows as the next target, and each is priced at 40–300 s of the plateau income
   * of the cities before the one that buys it — the Dyson Swarm is the target of cities
   * 6–13, the Quantum Exchange of 15–18, the Mass-Driver Port of 19–23, the Ringworld
   * District of 24–26, the Galactic Charter of 27–28, the Shipyard of 29, the Exchange
   * Ring of 30. The Exchange Ring at $22Qa is the priciest thing in the game and stays
   * two orders under the $1e18 money ceiling.
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
    // pace ladder, one rung per city (placement table above)
    'championship-season': { cost: 3e8 },
    'robotic-assembly': { cost: 1e9 },
    megastructures: { cost: 2.1e9 },
    'planetary-charter': { cost: 6.5e9 },
    'ai-governance': { cost: 3.6e10 },
    'orbital-solar': { cost: 1.3e11 },
    'algorithmic-trading': { cost: 3.6e12 },
    'arcology-gardens': { cost: 7.6e12 },
    'superconductor-grid': { cost: 9.1e13 },
    // frontier ladder (earnings gated at a quarter of the price), canonical order
    'dyson-swarm': { cost: 1.8e10 },
    'quantum-exchange': { cost: 4.2e11 },
    'mass-driver-port': { cost: 6.5e13 },
    'ringworld-district': { cost: 3.6e14 },
    'stellar-engine': { cost: 5.6e14 },
    'galactic-charter': { cost: 5.7e14 },
    'orbital-shipyard': { cost: 2e15 },
    'exchange-ring': { cost: 2.2e16 },
    // legacy (money-priced, unlocked by points)
    'legacy-archive': { cost: 5000 },
    'founders-blueprints': { cost: 30000 },
    'veteran-planners': { cost: 80000 },
    'dynasty-ledger': { cost: 150000 },
    'institutional-memory': { cost: 1e6 },
    'city-archives': { cost: 8e7 },
    'standing-orders': { cost: 8e10 },
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
