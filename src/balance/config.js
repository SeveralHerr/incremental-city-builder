// Metropolis — balance configuration.
// The single source of tuning truth. Every number that shapes pacing lives here so the
// balance owner can retune the game without touching any other folder.
// DOM-free: this file must import cleanly in Node (economy-sim) and the browser.
//
// Pacing (greedy bot, `node tools/economy-sim.mjs --ticks 432000 --out logs/sim-fix-balance-12h.json`,
// 12 game-hours; measured on the 2026-09-07 tree after the buildings module's synergy pass —
// re-measure before quoting; the tools that produced every number below live in this
// folder: `node src/balance/probe.mjs [--save N] [--set path=value] [--cities]` prints the
// readings the pass is tuned against (strict cycle ratios, which city and minute each rung
// lands in, per-city spree/plateau reach, under-power by hour, mid-city happiness dips) and
// `node src/balance/place.mjs --plan src/balance/plan.json` re-prices the late ladder from
// that table, one rung per city, after any change elsewhere).
//   Opening: cottage 0 s · two windmills, three more cottages and the Welcome Sign by 4 s ·
//   first corner shop 50 s (the shop gets the first $50; Zoning Reform follows at ~105 s) ·
//   first brownout ~2.3 min · 1k citizens ~10 min · Legacy panel at $1.1M earned (~12 min) ·
//   Found button arms at $11M (~20 min) · first founding 43.4 min with 5 legacy.
//   First city, tier-4 cards (node src/buildings/cadence.mjs, no faults): arcology opens
//   23.9 min and is bought 25.4 · nuclear 27.3 → 29.6 · tech campus 30.2 → 30.9 · financial
//   32.4 → 34.7 · fusion 37.3 → 40.9 · stadium 40.7 → 41.5. Every card opens ≥ 90 s after
//   the previous one and is bought within 4 minutes (the gates are placed on the pop curve
//   the bot actually rides — see buildings below).
//   Power: the first city runs under full power for 35% of its 43 minutes, hour 2 of the
//   session 5%, hours 3–5 under 1%, hours 6–12 0.0–0.2%; the session as a whole 3.5%,
//   never below the 0.6 floor. Nothing after city 8 sits under power: see the buildings
//   block for the measurements that show why that is out of this file's reach.
//   Cycles (minutes): 43 · 12 · 11 · 6.9 · 6.3 · 8.2 · 11 · 14 · 16 · 20 · 21 · 17 · 10 · 5.6 ·
//   7.5 · 10 · 13 · 17 · 22 · 30 · 26 · 33 · 23 · 28 · 34 · 34 · 45 · 50 · 36 · 46 · 22 · 23 —
//   32 foundings, the 33rd city open at 12 h (it opens at 704 min; empty, it would need
//   ~32 more minutes to complete, so the session ends 16 minutes before an empty cycle
//   could be counted and 13 minutes after the last rung is bought). Shape: the first
//   founding at 43 min, two 11–12 minute replays, a 6–8 minute floor at cities 4–6, a
//   ramp to ~21 min by city 11, a second dip to 5.6 min at the Quantum Exchange (city 13),
//   then a 22–50 minute plateau. Strictly, with no slack, no cycle from the 5th founding
//   on is more than ×1.347 the one before it (contract ≤ 1.35; the 1.35 ± 0.01 steps are
//   cities 14–15 and 18: a weak perk or housing rung after a spree-landed income rung, see
//   the upgrades block for why that is the floor the content allows). Legacy 2.7e+05
//   (127,476 spent on all twelve charter perks), money peak 2.8e+16, income 8.4e+14/s.
//   Purchase tension: the cheapest unlocked, unowned money upgrade is 30 s – 15 min of
//   income away in 53% of samples (contract ≥ 30%).
//   Happiness dips under 1.0 in 22 of 32 cities (the opening minute of a replay: an
//   all-housing spree with jobless citizens and a dark first tick; from city 21 on the
//   Founder of Legend tier's flat +0.25 hides the dip). Only 4 cities dip after their first
//   minute — see the happiness block for why no mid-city dip is reachable from here.
//   Coverage: every building and every one of the 69 registered upgrades.
//   Saver profiles (`node src/balance/probe.mjs --save N`, a bot that saves toward a rung
//   within N seconds of income; the sim's `--saver` is N = 30): 30 s → 33 foundings, legacy
//   3.8e+05, money peak 7.3e+16, 11 empty late cities; 60 s → 33 foundings, 12 empty;
//   120 s → 32 foundings, first founding 51 min, 13 empty. All three stay inside both
//   ceilings (1e6 / 1e18) with at least two foundings of margin; none is held to the
//   cadence numbers and none can be made to meet the variety line from this file — see
//   "Why the saver profiles have empty cities" below.
//
// How the late game is placed. The verify/sim bot never saves: it buys the best-scoring
// *affordable* item every two seconds, so the cash it holds tracks a "frontier" — 2–10
// seconds of income in a mature city, spiking to 10–100 seconds during the first three
// minutes of a replay (the seed spree: income has jumped with a founding or a perk and
// building prices have not caught up). A money rung is bought in the first city whose cash
// reaches its price, so the late ladder is placed by *city*: each price sits between two
// consecutive cities' reach (the placement table is in the upgrades block; the reach
// table is what `probe.mjs --cities` prints). The bot's legacy sequence is deterministic
// (5 points, then +40% per founding: 5, 10, 15, 21, 30, 42, 59, 83, 117, 164, 230, 322,
// 451, 632, 885, 1239, 1735, 2430, 3402, 4763, 6671, 9342, 13082, 18315, 25641, 35901,
// 50272, 70384, 98559, 137997, 193243, 270626 after founding 32), so a charter perk lands
// in a fixed city set by its price alone: the ×2.5 ladder below signs one every 2–3 cities
// (2, 4, 7, 9, 12, 15, 18, 20, 23, 26, 29, 31). Five structural facts drive every number:
//   • a replay's income is set inside its first three minutes (seed cash × legacy bonus
//     buys the whole core ladder back at once); after that a mature city's income grows
//     only logarithmically with spend, so a cycle's length is essentially "earnings
//     required / income after the spree";
//   • each founding must out-earn the whole past by 1.4^(1/exponent) − 1, while the legacy
//     bonus grows 1.4^legacyPower per founding; a city with nothing new — or whose only
//     new item is a power, housing, jobs or memory rung, which a replay's grid, housing
//     and payroll never constrain — reads ×1.28–1.40 over the one before it, and the
//     spread is noise from the legacy tiers and the building mix, not something a price
//     moves. So an income rung is placed to land *late* (mid-city) wherever the bot's
//     plateau cash still exceeds its spree cash — cities 4–10 — which shortens its own city
//     a little and lifts the next one a lot; from city ~11 on the spree exceeds anything
//     the plateau reaches, every rung lands in a spree, and the only remaining tool is
//     the order of the items;
//   • an income rung (×2 or more) landed in a spree makes its own city short and the next
//     city read ×1.35–1.40 unless that next city has an income rung of its own; a nil
//     perk city (Grid at 6, Energy at 28) cannot move, so the income rung before it has
//     to land mid-city (Championship Season before the Grid Charter) or share the perk's
//     city (the Galactic Charter is bought in the Energy Charter's spree — the one double
//     in the ladder, and the reason the session has 32 foundings and 18 single-rung
//     cities instead of 33 and 19);
//   • the frontier rungs are bought in price order (a cheaper frontier rung is always
//     affordable first), so their order across cities is fixed and only their spacing is
//     free; the pace rungs and the two money-priced Legacy rungs (City Archives, Standing
//     Orders) are the movable pieces;
//   • the ladder has exactly 19 money rungs for the 18 non-perk cities from the 4th to the
//     31st plus the Galactic double, so the session must end inside the 32nd city (it
//     opens at 704 min): the tier-4 cost growth, the district and campus incomes and the
//     growth rate are the uniform levers that put the 12 h mark there (each ±1% of income
//     is ∓7 min on the end of the session).
//
// Why the saver profiles have empty cities (and why the default one does not). A charter
// perk lands in a city fixed by the legacy sequence and a pace rung opens once the city
// has earned 100× its price (or holds it) — both profile-independent. A frontier rung
// opens at a quarter of its price and is bought when the cash is there: the never-saving
// bot needs a spree that reaches the price, a saver only needs N seconds of income, so
// every frontier rung lands 1–4 cities earlier for a saver (Dyson Swarm: city 10 for the
// bot, 7 for a 30 s saver, 4 for a 120 s saver), and while it hoards toward one it opens
// and buys every pace rung priced below it (the "holds the price" door). With 19 rungs for
// 18 slots there is no spare content to fill the cities those moves vacate. Making the
// variety line hold for a saver needs the frontier gate (upgrades) or the bot (core) to
// change, not a price: no price lands in the same city for a player whose reach is 10 s
// of income and one whose reach is 120 s.
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
   * - growthRate: fraction of the housing gap (housing − pop) filled each second. 0.09 fills
   *   ~95% of new housing in ~35 s, so a new tower feels occupied within a minute without
   *   making housing the only lever. 0.08 → 0.09 in the 2026-09-07 pass: it is the one
   *   knob that trims a replay's jobless opening minute (housing fills faster, wages start
   *   sooner) without moving any rung, and it is what takes the settlers-after-quantum
   *   step (cities 13 → 14) from ×1.352 to ×1.345. 1k citizens arrive at ~10 min in the
   *   first city.
   * - shrinkRate: fraction of the overflow (pop − housing) lost per second when housing is
   *   sold. Deliberately faster than growth so selling homes has a bite.
   * - baseInflow: flat citizens/s while any housing is vacant. Guarantees the first cottage
   *   fills even when the growth term is near zero (4 slots × 0.08 = 0.32/s).
   */
  pop: { growthRate: 0.09, shrinkRate: 0.2, baseInflow: 0.5 },

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
   * - civicCap: asymptotic happiness bonus from civic buildings (1.12 → h can reach 2.12
   *   from civic alone, +56% income at full saturation). Trimmed from 1.25 in the
   *   2026-09-07 pass: it is a uniform income lever (a mature replay sits at the cap) that
   *   slows every city ~2% and lengthens the first city by ~1 min, and unlike a building
   *   income it is not held by the buildings module's value-per-dollar bands. It has to
   *   stay above pollutionCap (1.1) so a fully civic city always nets positive.
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
   * - unemploymentPenalty: happiness lost at 100% unemployment. 0.35: a veteran city opens
   *   with a spree of cottages before its first shop, and for that minute two in five
   *   citizens are jobless. Together with the brownout penalty below this is what makes a
   *   replay dip under 1.0 happiness (22 of 32 cities); at 0.3 the flat happiness a veteran
   *   carries hides it and only a quarter of the cities ever dip. The first city's opening
   *   minute reads 0.36 (the dark first tick) instead of 0.7.
   *   Why no mid-city dip is reachable from here (measured, 2026-09-07): a mature replay
   *   carries +0.55 of flat happiness from rungs and perks and +0.4 from the legacy tiers,
   *   the clean-air tiers cut smog 90% by 5,000 points, the bot never sells housing
   *   (overcrowding never bites) and the grid is never short after city 8 (power below).
   *   Only the opening minute — jobless citizens under a dark first tick — dips, in 22 of
   *   32 cities; 4 cities dip after their first minute. The dip the contract asks for is
   *   met to the letter; making it a mid-city event needs a pressure the simulation
   *   applies to a mature city, not a bigger penalty here (a bigger penalty only deepens
   *   the same opening minute).
   * - overcrowdPenalty: happiness lost per 100% overcrowding (pop/housing − 1). Only bites
   *   briefly after selling housing.
   * - brownoutPenalty: happiness lost at a full blackout (powerRatio 0). 0.6: stacks with
   *   the direct powerRatio scaling, so brownouts hurt growth twice — build power. At the
   *   0.6 floor a blackout costs 0.24 happiness, which is what a replay's first dark step
   *   and the first city's tier-4 brownouts need to be felt.
   * - min/max: clamp range for the final happiness value.
   */
  happiness: {
    civicCap: 1.12,
    civicScale: 1.5,
    pollutionScale: 0.35,
    pollutionCap: 1.1,
    pollutionCurve: 1.0,
    unemploymentPenalty: 0.35,
    overcrowdPenalty: 0.5,
    brownoutPenalty: 0.6,
    min: 0.25,
    max: 3,
  },

  /**
   * Building costs: cost = baseCost · growth^count · mods.cost.
   * - tierGrowth: exponential base per tier. Cheap tier-1 buildings climb fastest (1.18 →
   *   ×5 after 10) so money is pushed up the ladder instead of into a 60th cottage;
   *   tier-4 grows slowest (1.112) so late-game spam stays viable. Civic buildings
   *   override with 1.18–1.2 to keep happiness from being a cheap stat dump, and the
   *   windmill with 2 (see buildings.windmill). Tiers 3 and 4 were trimmed from 1.14 /
   *   1.12 to 1.13 / 1.11 in the first 2026-09-07 pass: a replay's spree pile is the cash
   *   the bot cannot spend before building prices catch up with its income, and one point
   *   of growth off the top tiers lets that pile reach the next frontier rung a city
   *   sooner for the never-saving bot — the saver profile, which reaches rungs by waiting,
   *   gains almost nothing, so the gap between the two profiles (the saver's
   *   legacy-ceiling risk) closes. Tier 4 sits at 1.112 after the second pass: it is the
   *   finest uniform lever on the end of the session (+0.002 ≈ +7 min on the 12 h mark),
   *   but not a free one — a mature city's income grows with what it can spend, so a
   *   steeper tier-4 curve makes every city with nothing new read a little longer over
   *   its predecessor (at 1.12 the housing and power rungs' cities read ×1.36, over the
   *   contract's 1.35; at 1.11–1.112 they read ×1.345). Measured on the first city: the
   *   tier trim moves the first founding by −0.3 min.
   * - sellRefund: fraction of the *current* price returned on sell. 0.5 makes reshuffling
   *   possible but never free.
   */
  cost: { tierGrowth: { 1: 1.18, 2: 1.16, 3: 1.13, 4: 1.112 }, sellRefund: 0.5 },

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
   *   ~43 min. Because every later founding needs lifetime earnings of threshold ×
   *   L^(1/exponent), the threshold is the one knob that stretches the whole session
   *   uniformly (+5% threshold ≈ +5% on every cycle, no city re-ordered). It is mirrored
   *   in src/simulation/tuning.js, so the second 2026-09-07 pass left it alone and placed
   *   the 12 h mark with the balance-owned levers instead (tier-4 cost growth, the
   *   district and campus incomes, the growth rate and civicCap): the mark now falls 13
   *   minutes after the Exchange Ring is bought in the 32nd city and 16 minutes before
   *   that city, empty, could complete. Both profiles keep the first founding inside
   *   30–45 min at $11M (43 min default, 36 min for the 30 s saver).
   * - exponent: 0.488. The bot resets for +40% legacy (minGainShare), which at exponent e
   *   means each run out-earns everything before it by 1.4^(1/e) − 1: ×0.99 at 0.488.
   *   Extremely sensitive and non-monotone on this tree (0.47 → 22 foundings with eight
   *   items never bought; 0.48 → 25; 0.488 → 28 before the other knobs below), because a
   *   founding a minute earlier or later re-orders which city buys which rung. It stays
   *   where the ladder was placed; the tail is steered with threshold and legacyPower.
   * - incomePerLegacy / legacyPower: income × (1 + 0.01·legacy)^0.548 (the contract
   *   allows up to 0.6), uncapped: ×1.45 at 100 points, ×12.5 at 10k, ×47 at the 3.8e5 a
   *   12 h session banks. The knee of the curve (k·legacy ≈ 1, at 100 points ≈ city 8) is
   *   the lever that shapes the early replays: below it the bonus barely grows per
   *   founding and the 4–8 minute floor cities lengthen into the plateau by themselves;
   *   above it the bonus grows ×1.4^p per founding. legacyPower is the tail brake: each
   *   −0.001 costs ~0.7% of income at 1e5 points and ~0.1% at 100, i.e. it slows the last
   *   ten cities ~5× more than the first ten. 0.548 is mirrored in the simulation's
   *   DEFAULTS and was not touched in the second pass; with the ladder re-placed around
   *   it the 12 h mark sits 16 minutes before the 32nd city could complete empty, and the
   *   saver profiles' 1e6 legacy ceiling is two foundings away (33 foundings, 3.8e5).
   * - firstBonus: 0.18 — the first founding is a jump a player can feel (×1.18 on top of
   *   the points' ×1.03). This is the one knob that scales every replay's income and
   *   nothing in the first city, so it moves the whole clock after the first founding
   *   without re-ordering which city buys which rung (a −1% step is ~+6 min on the 12 h
   *   mark, and the placement margins are ±10–25%). 0.30 → 0.18 is what paid for the
   *   faster cities 2–3 and the mid-city rungs: at 0.30 the session finished an extra,
   *   empty city.
   * - startMoneyPerLegacy: post-reset seed cash = startMoney · (1 + 1·legacy): $1,800 with
   *   5 points, $3,300 with 10, $6,600 with 21. This is what turns cities 2–3 from a
   *   16-minute replay of the first city into 11–12 minutes: with the four Legacy rungs
   *   priced at $1k–25k the seed buys shops, a factory and Legacy Archive in the first
   *   seconds instead of nursing a $375 treasury through eight minutes of cottages
   *   (measured: 0.05 → 1 alone took cities 2–3 from 15.7/16.2 to 14.5/13.9; with the rung
   *   prices, 10.5/9.4). Late it is noise: 3.8e5 points seed $1.1e8 against sprees of
   *   1e16.
   * - minGain: 1 — the Found button arms at the first point (see threshold).
   * - minGainShare: 0.4 — once a bank exists the button also waits for 40% of it, so a
   *   1,000-point mayor is offered a reset at +400, never at +3. This is the knob that sets
   *   the session's legacy sequence (×1.4 per founding: 1.38e5 points after 30 foundings,
   *   the ceiling of 1e6 at the 36th) and therefore where every charter perk lands; the
   *   ×2.5 perk ladder needs 30 foundings to reach the Imperial Charter, which the 12 h
   *   session delivers in its last hour. It also pins the legacy ceiling to a founding
   *   count: any profile that completes 35 foundings in 12 h banks ~7.4e5, and a 36th
   *   crosses 1e6 — the default profile founds 32 times and the savers 32–33.
   * - prestigePanelShare: 0.1 — the Legacy panel opens once this run has earned
   *   threshold × 0.1 = $1.1M (~12 min); a mayor with a bank keeps it from the first second.
   */
  prestige: {
    threshold: 1.1e7,
    exponent: 0.488,
    incomePerLegacy: 0.01,
    legacyPower: 0.548,
    firstBonus: 0.18,
    startMoneyPerLegacy: 1,
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
   * Late demand outpaces supply (contract): the four tier-4 consumers draw 3.5–4.2× the
   * catalogue figure — arcology 10,500 MW, financial district 16,500, tech campus 18,700,
   * stadium 6,200 — so a nuclear plant (12,000 MW, $400k) carries one of them rather than
   * three to five, and the Power tab keeps asking for money through the end of the first
   * city and the first six replays. Measured: under-power share 3.5% of the 12 h session
   * (35% of the first city's 43 minutes, 5% of hour 2, under 1% of hours 3–5, 0.0–0.2% of
   * hours 6–12), never below the 0.6 floor. The draw is at the ceiling the first founding
   * allows (×1.3 puts it at 46 min, over the 45 the contract asks for; ×1.1 is +1.3 min).
   * Measured in the 2026-09-07 pass with this file's own levers (probe.mjs, per-hour
   * share): grid strain on all four consumers at +5%/unit up to ×3 (demandGrowth per 20,
   * cap 3, twice the shipped rate and cap) lifts the first city to 41% and leaves hours
   * 3–12 at 0.0–0.4%; nuclear upkeep ×10 and fusion upkeep ×13 ($3,000 / $20,000 per
   * second) change no hour after the first by more than 0.3 points; neither is shipped.
   * Why nothing after city 8 sits under power, and why this file cannot change that: a
   * mature replay's capacity is 10–1,500× its demand. The grid perks (Grid and Energy
   * Charters, Orbital Solar, Breeder Reactors, the Dyson Swarm, Superconductor Grid,
   * Stellar Engine, the Shipyard — ×30 supply and ×0.2 demand together, upgrades module)
   * multiply whatever the generators produce, and the greedy bot scores a generator by its
   * MW regardless of surplus, so it holds ~200 nuclear and ~200 fusion plants by city 26.
   * Measured: nuclear/fusion cost growth 1.15–1.2 (instead of the tier's 1.11), nuclear at
   * 10,000 MW, or a $500k plant all leave the late share at 0.0–0.5% and only move the
   * first founding; a ×5 draw that would bite late crushes the first city (three plants
   * per campus). Making late power a decision needs the perk stack compressed to ~×15
   * (upgrades) and/or the bot's generator scoring to stop past 2× surplus (core).
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
    // 20 citizens, towers at 250) — this is what gets a thousand citizens in by minute 10.
    // $280 (not $300) is a first-city cadence knob: it moves the tower and school cards
    // (gates 250 and 500, buildings-owned) from 88 s apart to 100 s.
    apartment: { baseCost: 280 },
    tower: { baseCost: 3000 },

    // Tier-3 employers and the hospital sit at the 20–35 minute frontier.
    mall: { baseCost: 25000 },
    refinery: { baseCost: 20000 },
    hospital: { baseCost: 60000 },

    // Tier 4. Population gates are placed on the population curve the greedy bot actually
    // rides through the first city, just under the moment the price frontier reaches each
    // card, so a top-tier card never glows unaffordable for more than 4 minutes and no two
    // cards open within 90 s (node src/buildings/cadence.mjs: arcology opens 23.9 min and
    // is bought 25.4 · nuclear 27.3 → 29.6 · campus 30.2 → 30.9 · financial 32.4 → 34.7 ·
    // stadium 40.7 → 41.5, with the catalogue's fusion gate at 37.3 in between). The curve
    // is steep and jumpy where the arcologies land (pop 6,300 at 23.9 min, 11,000 at
    // 27.3, 22,000 at 32.4), which is why the gates read oddly spaced as numbers: 9,000
    // opened the plant 60 s after the arcology and 4.1 min before the bot could pay for
    // it, 21,000 opened the district 80 s after the campus. The arcology's housing is
    // trimmed from 2,500 to 1,000: at 2,500 one arcology was fifteen towers' worth of
    // citizens for the price of one, and a dozen of them tripped every later gate within
    // a minute. Power draws are 3.2–3.8× the catalogue (see above).
    arcology: { baseCost: 120000, housing: 1000, powerUse: 10500, ...popUnlock(6300, '6,300') },
    // Campus income $900/s (catalogue $1,000) and district income $2,500/s (catalogue
    // $2,000, first pass $2,600): together a −4% / −10% trim on the two late employers, the
    // uniform income lever that sets where the 12 h mark falls (see the header). The
    // buildings test holds the district to ≥ 0.8× the campus's value per dollar with the
    // synergies at their unlock populations — 7.0/$k against 8.2/$k here, 7% of margin;
    // $2,250 (6.5/$k) was under the band and is not shippable however well it paced.
    techpark: { baseCost: 300000, income: 900, powerUse: 18700, ...popUnlock(14500, '14,500') },
    nuclear: { baseCost: 400000, ...popUnlock(11000, '11,000') },
    financial: { baseCost: 7e5, income: 2500, powerUse: 16500, ...popUnlock(22000, '22,000') },
    stadium: { baseCost: 3.5e6, powerUse: 6200, ...popUnlock(43000, '43,000') },

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
   * The registry holds 69 upgrades: 33 core ($25 → $20M, the first city's decisions), 9
   * pace rungs ($76M → $360T, hidden until the city has earned 100× the price or holds
   * it), 8 frontier ($2.3B → $26Qa, earnings gated at a quarter of the price), 7 Legacy
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
   * Charter perks: a ×2.5 ladder from 3 to 76,488 points, each price rounded up to a
   * whole point (3 · 8 · 20 · 50 · 125 · 313 · 783 · 1,958 · 4,895 · 12,238 · 30,595 ·
   * 76,488 — the module's own ladder ends at 200,000, which the bot's sequence only
   * reaches at the 35th founding, a city the 12 h session does not have). With the
   * sequence in the header they are signed in cities 2 (Homestead), 4 (Mint), 7 (Grid), 9
   * (Guild), 12 (Merchant), 15 (Settlers), 18 (Masons), 20 (Civic), 23 (Treasury), 26
   * (Skyline), 29 (Energy) and 31 (Imperial), and a perk always opens at half its price,
   * so the next clause is on the card a city or two before it can be afforded. The Mint
   * cannot sign in city 3 (the 7 points available there are one short of ◆ 8, and ◆ 7
   * would break the ×2.5 rule against the Homestead's ◆ 3); cities 2–3 are paced by the
   * seed cash and the Legacy rung prices instead.
   *
   * Late ladder, placed by *city* (cities counted from the first founding — city 1 is
   * the first replay; charter cities in brackets; "mid" = the rung lands off plateau cash
   * after the spree, so the city has a second purchase and the rung's boost lifts the
   * next city — see the header; minutes are where the rung is bought):
   *   [3 Mint + Institutional Memory, 4.9] · 4 City Archives (mid, 4.7) · 5 Championship
   *   Season (mid, 7.5) · [6 Grid] · 7 Robotic Assembly (mid, 12.4) · [8 Guild] · 9 AI
   *   Governance (mid, 17.2) · 10 Dyson Swarm (mid, 17.3) · [11 Merchant] · 12 Planetary
   *   Charter (1.3) · 13 Quantum Exchange (1.4) · [14 Settlers] · 15 Megastructures · 16
   *   Orbital Solar · [17 Masons] · 18 Arcology Gardens · [19 Civic] · 20 Algorithmic
   *   Trading · 21 Standing Orders · [22 Treasury] · 23 Mass-Driver Port · 24 Ringworld
   *   District · [25 Skyline] · 26 Stellar Engine · 27 Superconductor Grid · [28 Energy +
   *   Galactic Charter, 3.1] · 29 Orbital Shipyard · [30 Imperial] · 31 Exchange Ring (3.4)
   *   · 32 open at 12 h.
   * Every city from the 4th on gets at least one never-before-bought item — 19 money
   * rungs for 18 non-perk cities plus the Galactic Charter in the Energy Charter's city,
   * no spare — which is why the session has to end inside the 32nd city (header). The
   * order is chosen so that the follower of every spree-landed income rung is either
   * another income item or a city that reads ≤ ×1.35 anyway: Planetary (12) → Quantum
   * (13) → Settlers (14, ×1.345) → Megastructures (15, ×1.345); Mass-Driver (23) →
   * Ringworld (24, ×1.22); Galactic shares city 28 with the Energy Charter so the Energy
   * city reads ×0.72 instead of the ×1.37 it read when the Galactic Charter was city 27's
   * own rung; Superconductor (27, nil) follows Stellar (26, nil) and reads ×1.10. The two
   * mid-city income rungs (AI Governance at 17 of 20 min in city 9, Dyson Swarm at 17 of
   * 21 in city 10) are what carry the Grid Charter's and Merchant's cities.
   * Each price is the geometric mean of the reach of the city before it (its spree or
   * plateau cash, whichever is higher) and the reach of its own city (place.mjs prints
   * both), so it has ±10–25% of margin either way — enough for a small retune elsewhere,
   * not for a large one: after any change to income, cost or the perk effects run
   * `node src/balance/place.mjs --plan src/balance/plan.json` and copy the prices in. The
   * narrowest windows are Megastructures / Orbital Solar (cities 15–16, ±11%: two weak
   * rungs in consecutive cities whose reach differs by only 13%) and the Exchange Ring
   * (±25%).
   * The second city takes the rest of the tier-4 core (Breeder Reactors at $20M, the
   * fusion reactor and the stadium); Institutional Memory ($30M) is priced above the
   * second city's plateau so it lands in the third city, beside the Mint Charter — its
   * founding re-grant of the tier-1/2 ladder then reaches city 4, which is what keeps
   * city 4 (6.3 min) from reading ×1.4 over city 3 (6.9): at $1M it landed in city 2 and
   * city 3 was a 4.3-minute replay that city 4 could not follow.
   * Legacy rungs: the four replay accelerators ($1k · $5k · $12k · $25k) are priced for
   * the first two minutes of a 5–10 point replay (see prestige.startMoneyPerLegacy);
   * City Archives ($53M) is the 4th city's mid-city rung and Standing Orders ($4.8T) the
   * 21st city's novelty — its founding memory (tier-3 and Legacy rungs granted at every
   * founding) is a convenience whose pacing value is nil by then, but the slot after
   * Algorithmic Trading is one of the few a no-income rung can take.
   * Measured strengths (how much shorter the city after the rung is, over the ~×1.3 a
   * city with nothing new grows): Quantum Exchange ×2.5, Galactic Charter ×2.3, Planetary
   * Charter ×1.6, AI Governance ×1.4, Exchange Ring ×2.2, Algorithmic Trading ×1.2,
   * Robotic Assembly ×1.15; the power rungs, the housing rungs and the jobs rungs
   * (Shipyard, Ringworld) are ×1.0–1.1 in a replay, whose grid, housing and payroll are
   * never the constraint — they are variety, not pace. That is the floor on the cadence
   * contract: a nil rung's city reads ×1.28–1.40 over its predecessor with a spread this
   * file cannot narrow (it is the legacy tiers and the building mix), so the letter of
   * ≤ 1.35 is met with 0.3% to spare at the tightest step and a retune elsewhere of more
   * than ~1% needs a re-placement.
   * The frontier keeps its canonical order (Dyson < Quantum < Mass-Driver < Ringworld <
   * Stellar < Galactic < Shipyard < Exchange Ring) and its earnings gate (a quarter of the
   * price) but not the module's ×10 spacing or its 1e13 floor: ×10 apart the eight rungs
   * would land three to a city and leave a dozen cities empty. A frontier rung is visible
   * from the city that earns a quarter of its price — four to eight cities before the one
   * that buys it — so the Upgrades panel shows two or more targets in most cities from
   * the 8th on. The Exchange Ring at $26Qa is the priciest thing in the game and stays
   * two orders under the $1e18 money ceiling; there is no rung above it, so a session
   * that runs past 12 h keeps founding cities with nothing new to buy (the upgrades
   * module owns the content; this file can only price it).
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
    // pace ladder, one rung per city (placement table above; listed in city order)
    'championship-season': { cost: 9.04e7 }, // city 5, mid-city
    'robotic-assembly': { cost: 3.05e8 }, // city 7, mid-city
    'ai-governance': { cost: 1.12e9 }, // city 9, mid-city
    'planetary-charter': { cost: 7.36e9 }, // city 12
    megastructures: { cost: 4.21e11 }, // city 15
    'orbital-solar': { cost: 4.75e11 }, // city 16
    'arcology-gardens': { cost: 1.05e12 }, // city 18
    'algorithmic-trading': { cost: 2.3e12 }, // city 20
    'superconductor-grid': { cost: 3.44e14 }, // city 27
    // frontier ladder (earnings gated at a quarter of the price), canonical order
    'dyson-swarm': { cost: 2.23e9 }, // city 10, mid-city
    'quantum-exchange': { cost: 2.88e10 }, // city 13
    'mass-driver-port': { cost: 5.55e13 }, // city 23
    'ringworld-district': { cost: 6.32e13 }, // city 24
    'stellar-engine': { cost: 2.43e14 }, // city 26
    'galactic-charter': { cost: 4.31e14 }, // city 28, with the Energy Charter
    'orbital-shipyard': { cost: 1.12e15 }, // city 29
    'exchange-ring': { cost: 2.59e16 }, // city 31
    // legacy (money-priced, unlocked by points): the four replay accelerators are priced at
    // the first minutes of a 5–10 point replay (see the Legacy rungs note above)
    'legacy-archive': { cost: 1000 },
    'founders-blueprints': { cost: 5000 },
    'veteran-planners': { cost: 12000 },
    'dynasty-ledger': { cost: 25000 },
    'institutional-memory': { cost: 3e7 }, // city 3, with the Mint Charter
    'city-archives': { cost: 5.18e7 }, // city 4, mid-city
    'standing-orders': { cost: 4.84e12 }, // city 21
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
