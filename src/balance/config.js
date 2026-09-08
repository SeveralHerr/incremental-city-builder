// Metropolis — balance configuration.
// The single source of tuning truth. Every number that shapes pacing lives here so the
// balance owner can retune the game without touching any other folder.
// DOM-free: this file must import cleanly in Node (economy-sim) and the browser.
//
// Pacing (greedy bot, `node tools/economy-sim.mjs --ticks 432000 --out logs/sim-fix-balance.json`,
// 12 game-hours; measured on the 2026-09-07 saver-gate tree — the sibling folders were
// being edited in parallel during this pass, so re-measure before quoting: a 1% change
// of income moves the 12 h mark ~7 min, and the default profile's last novelty city
// (33) opens at 697 min, 3.3% before the mark). The tools that produced every number
// below live in this folder: `node src/balance/probe.mjs [--save N] [--set path=value]
// [--cities] [--first]` prints the readings the pass is tuned against (strict cycle
// ratios, which city and minute each rung lands in, per-city spree/plateau reach,
// under-power by hour, mid-city happiness dips, the first city's clock and its cheapest
// open rung by minute, and a margins line against src/balance/plan.json `targets`) and
// `node src/balance/place.mjs --plan src/balance/plan.json [--save N]` re-prices the late
// ladder from that plan, one rung per city (run it after every sibling retune).
//   Opening: cottage 0 s · two windmills, three more cottages and the Welcome Sign by 4 s ·
//   first corner shop 50 s · first brownout ~2.3 min · 1k citizens ~11 min · Legacy panel
//   at $1.1M earned (18.6 min) · Found button arms at $11M (27.4 min; a 1-point founding
//   is possible from there, the bot holds out for 5 points) · first founding 41.1 min with
//   5 legacy (the saver's, which hoards for the core rungs it can see, 38.1).
//   Purchase tension in the first city: the cheapest open money upgrade is 30 s – 15 min
//   of income away in ~51% of its minute samples (the upgrades module's funded door — a
//   core rung opens only when the treasury holds its price — measured here, not priced).
//   Power: the first city runs under full power for ~31% of its minutes, hour 2 of the
//   session ~8%, hours 3–5 0.3–0.6%, hours 6–12 ≤ 0.2%; the session 3.4% (contract 3–20%;
//   plan target ≥ 3.2%), never below the 0.6 floor. See the buildings block for why hours
//   3–12 are out of this file's reach.
//   Cycles (minutes): 41 · 13 · 12 · 7.7 · 7.1 · 9.2 · 12 · 14 · 17 · 21 · 22 · 25 · 11 ·
//   6.5 · 8.7 · 11 · 15 · 18 · 16 · 21 · 28 · 35 · 43 · 30 · 30 · 24 · 32 · 36 · 25 · 31 ·
//   33 · 29 · 14 · 18 — 34 foundings, the 35th city open at 12 h (it opens at 715 min; a
//   city with nothing new needs ≥ 22 min there, so it cannot complete before ~737). Shape:
//   the first founding at 41 min, two 12–13 minute replays, a 7–9 minute floor at cities
//   3–5, a ramp to ~25 min by city 11, the Merchant Charter (12) and the Quantum Exchange
//   (13) cutting that to 6.5, a second ramp to a 28–36 minute plateau, then the Imperial
//   Charter's ×3 (city 32, 14 min) and the Space Elevator's city (33, 18 min). Strictly,
//   no cycle from the 5th founding on is more than ×1.343 the one before it (contract
//   ≤ 1.35; the step is the Settlers' city after the Quantum spree, the same step the
//   previous pass read at ×1.345 — pop.growthRate 0.11 is what holds it there); the
//   longest cycle after the first city is 43 min (contract: last ≤ 40; plan target: every
//   cycle ≤ 50, last ≤ 38). Legacy 530,718 (213,186 spent on all twelve charter perks),
//   money peak 3.1e+17, income 4.4e+15/s at 12 h.
//   Purchase tension over the session: 41% of samples (contract ≥ 30%, target ≥ 35%).
//   Happiness dips under 1.0 in 21 of 34 cities (the opening minute of a replay; 3 cities
//   dip mid-city). Coverage: every building and every one of the 70 registered upgrades.
//   Saver profile (`node src/balance/probe.mjs --save 30`, the sim's `--saver`,
//   logs/sim-fix-balance-saver.json): PASS, contract PASS on the hard gates. 35 foundings,
//   first founding 38.1 min, reach 62%, under-power 2.8%, legacy 746,168, money peak
//   4.8e+17, 9 late cities with nothing new (13, 15, 19, 21, 22, 24, 30, 31, 34). The
//   36th founding — the one that banks 1.04e6 and crosses the legacy ceiling — lands at
//   ~730 min, 1.3–1.6% past the session (its 35th city opens at 694 min and is 27.8 min
//   long; the open 36th cannot be shorter than ~35). That margin, and the default's 3.3%
//   on its Elevator city, are what this content allows: see "What the saver brake is" and
//   the final-gate section for why the two profiles cannot both sit 5% inside.
//
// What the saver brake is (this pass). The previous tree's saver read 37 foundings,
// legacy 1.46e6 and money 2.1e18, over both ceilings, and every uniform lever (threshold,
// exponent, legacyPower, firstBonus, the tier-4 growth, the late employers' incomes,
// civicCap) was measured to move both profiles by the same share: the saver reaches a
// rung with 30 s of income where the greedy bot needs its spree pile (~10 s of income), so
// every frontier rung lands ~2 cities earlier for the saver whatever it costs, and the
// gap between the profiles is ~3 foundings by 12 h. Two mechanisms are profile-specific:
//   • the "holds the price" door on the pace rungs: while the saver hoards toward a
//     frontier rung it holds every cheaper pace rung's price and opens it. On the old
//     ladder the Dyson Swarm ($2.27e9, city 10) was hoarded from city 7 and pulled
//     Robotic Assembly and AI Governance (×2 income) into city 7, two cities early. The
//     Dyson Swarm is now the city-4 rung ($47.9M, under everything) and the pace rungs
//     carry cities 5–11 alone; the saver's AI Governance opens on its earnings gate in
//     city 9, the same city as the bot's (+20 min on the saver's session, nothing on the
//     bot's — the swap is drop-in for the greedy profile);
//   • the Merchant Charter's city: the saver's 30 s reach jumps when the perk is signed,
//     and with the Merchant in city 11 any Quantum Exchange price the bot can meet
//     before city 15 was hoarded in city 11's spree (3 min in). The Merchant is ◆154
//     (city 12; 149 spendable in 11), the ladder above it re-spaced at ×2.5 so the Settlers
//     stay in city 14 and the Imperial in 32 (Civic and Treasury move to 20 and 23, which
//     turns 11, 19 and 22 into money cities). The saver now buys the Quantum Exchange at
//     the end of city 11 (20 min in, off a hoard) instead of at 3 min: +17 min.
//   Together they take the saver from 37 to 35 foundings; prestige.firstBonus 0.18 →
//   0.15 (the one uniform lever that scales every replay and nothing in the first city)
//   then puts the 36th founding past the mark for the saver while the bot's Elevator city
//   still opens 3.3% early. City Archives ($2.0e12, city 19) is priced above the saver's
//   city-17 reach so its hoard no longer opens Algorithmic Trading a city early, and the
//   Mass-Driver Port ($9e12, city 22) and Ringworld District ($7e13, city 24) follow the
//   moved Treasury. What was measured and not shipped: quantum priced for a mid-city
//   purchase (no plateau window exists in city 13 once the Merchant sits in 12); the
//   Dyson Swarm anywhere in cities 5–12 (any price the bot's plateau reaches there is a
//   saver hoard from two cities earlier); the perk ladder with Settlers in city 15 (the
//   Ring + Megastructures city then reads ×1.39 into it); a compressed tail placed for
//   the bot (the saver reaches every cheaper tail rung two cities early, so a faster bot
//   is a faster saver); and prices that hold the greedy bot at 32 foundings (the
//   Imperial and the Elevator need foundings 32 and 33 within 12 h).
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
// in a fixed city set by its price alone: the ladder below signs one every 2–3 cities
// (3, 6, 8, 12, 14, 17, 20, 23, 25, 28, 32, counting the first replay as city 1). Five
// structural facts drive every number:
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
//     plateau cash still exceeds its spree cash — cities 4–11 — which shortens its own city
//     a little and lifts the next one a lot; from city ~12 on the spree exceeds anything
//     the plateau reaches, every rung lands in a spree, and the only remaining tool is
//     the order of the items;
//   • an income rung (×2 or more) landed in a spree makes its own city short and the next
//     city read ×1.35–1.40 unless that next city has an income rung of its own; a nil
//     perk city (Grid at 6, Energy at 28) cannot move, so the income rung before it has
//     to land mid-city (Championship Season before the Grid Charter) or share the perk's
//     city (the Galactic Charter is bought in the Energy Charter's spree — the one double
//     in the ladder);
//   • the frontier rungs are bought in price order (a cheaper frontier rung is always
//     affordable first), so their order across cities is fixed and only their spacing is
//     free; the pace rungs and the two money-priced Legacy rungs (City Archives, Standing
//     Orders) are the movable pieces — and a Legacy rung can only be a novelty before
//     Standing Orders (city 21), which re-grants every Legacy rung at each founding after it;
//   • the ladder has exactly 20 money rungs for the 19 non-perk cities from the 4th to
//     the 31st plus the Galactic double, so no other double is possible without leaving a
//     city empty, and the session must end inside the 35th city: firstBonus and the
//     growth rate are the uniform levers that put the 12 h mark there.
//
// Why the saver profile has empty cities (and why the default one does not). A charter
// perk lands in a city fixed by the legacy sequence and a pace rung opens once the city
// has earned 100× its price (or holds it) — both profile-independent. A frontier rung
// opens at a quarter of its price and is bought when the cash is there: the never-saving
// bot needs a spree that reaches the price, a saver only needs 30 s of income, so every
// frontier rung lands 1–3 cities earlier for a saver (the Exchange Ring: city 31 for the
// bot, 29 for the saver), and while it hoards toward one it opens and buys every pace
// rung priced below it. With 20 rungs for 20 slots there is no spare content to fill the
// cities those moves vacate. The variety line is held for the greedy profile only
// (docs/DESIGN.md); making it hold for a saver needs the frontier gate (upgrades) or the
// bot (core) to change, or six to eight more late rungs — not a price.
//
// Final gate (2026-09-07, the saver-gate pass). Cross-module requests, with the
// balance-side measurement each rests on (every price in this file is mirrored by a
// data.js literal that the owning module's test pins — the mirrors are listed in the
// pass report):
//   simulation — mirror `prestige.firstBonus: 0.15` in tuning.js DEFAULTS.prestige (the
//   mirror test pins the block knob for knob, so balance cannot move it alone); the tail
//   brake the saver gate needs is uniform and re-order-free only on this knob.
//   upgrades — (1) copy the placed prices into data.js (the "literals match config" test)
//   and the frontier literal list; CHARTER_MAX_COST is now 150,500; (2) the frontier gate
//   at earned ≥ cost/2 instead of cost/4, or a "no hoard" rule for the pace door, would
//   let both profiles land the tail rungs in the same city — the 3-founding gap between
//   them is the whole reason the saver sits 1.5% inside its ceiling; (3) six to eight
//   more late money rungs (×3–5 apart from 1e16 to 1e17) so the saver's placement
//   (`place.mjs --save 30`) and the default plan can both be satisfied and the greedy
//   bot's 35th city has something to buy; (4) a felt clause on the power content
//   (`--boost charter-energy=income:1.25` in the probe) so a power-perk city stops
//   reading ×1.33 after a felt rung; (5) the grid perk stack compressed from ×30 supply /
//   ×0.2 demand to ≤ ×8 / ×0.5, without which no draw this file can set puts hour 3 or
//   later under power (buildings block).
//   core — stop the bot scoring generators past 2× surplus (bot.js), and consider a
//   saver that hoards only for rungs it has *earned* a share of: the "30 s of income"
//   reach is what pulls every frontier rung two cities early.
//   buildings — the Elevator gate is pinned to {500, 15000, 300000}; a 250,000 gate
//   (city 32, beside the Imperial) would widen the greedy bot's 12 h window from 3.3% to
//   ~5% on the slow side.
//
// Consumers: resources.computeDerived (economy/pop/power/happiness), buildings (cost +
// per-building overrides), upgrades (cost overrides), simulation (prestige, milestones,
// startMoney, tap), save (autosave/offline).
//
// Cross-module seam: src/simulation/tuning.js keeps a DEFAULTS copy of the prestige,
// economy and milestones sections as its fallback, and simulation.test.mjs asserts the copy
// equals this file knob for knob. A prestige change here (firstBonus 0.18 → 0.15 in this
// pass) must be mirrored there by the simulation owner.

// Population-gated unlock helper for the tier-4 overrides below. `unlockAt`/`unlockHint`
// mirror the rule as data for the UI's progress bars and locked-card hints.
const popUnlock = (n, label) => ({
  unlock: (state) => (state?.res?.pop ?? 0) >= n,
  unlockAt: { pop: n },
  unlockHint: `Reach ${label} citizens`,
});
// Legacy-gated unlock (the tier-5 megastructures): the same shape, on the bank.
const legacyUnlock = (n, label) => ({
  unlock: (state) => (state?.prestige?.legacy ?? 0) >= n,
  unlockAt: { legacy: n },
  unlockHint: `Bank ${label} legacy`,
});

// Grid strain for the tier-4 consumers: every unit past the first adds 1/per to every
// unit's draw (buildings module: powerUse = base × min(cap, 1 + (count − 1) / per)), so
// the draw of a column grows with the square of its count until the cap. The sticker is
// lowered to match (see the buildings block): the 5th unit draws what it drew before, the
// 15th about 25% more, the 250th ~19×.
const STRAIN = { per: 8, cap: 40 };
const strain = (label) => ({ ...STRAIN, text: `Grid strain: draw +12.5% per ${label} owned (up to ×${STRAIN.cap})` });

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
   *   step (cities 13 → 14) from ×1.352 to ×1.345. 0.09 → 0.1 at the final gate: the
   *   first-city compensator for the −15% trim on the two late employers (buildings block),
   *   which alone put the first founding past 43.5 min; together they read ~42.5, the
   *   clock the first city had before the trim. 0.1 → 0.11 in the saver-gate pass, for
   *   the same step: with the Quantum Exchange bought at the peak of city 13's spree the
   *   Settlers' city read ×1.349 at 0.1 and reads ×1.343 at 0.11 (first founding 41.1
   *   either way). Mirrored in src/resources (its DEFAULTS copy of this section).
   *   1k citizens arrive at ~11 min in the first city (pop 1,218
   *   at minute 12, `probe.mjs --trace 0`).
   * - shrinkRate: fraction of the overflow (pop − housing) lost per second when housing is
   *   sold. Deliberately faster than growth so selling homes has a bite.
   * - baseInflow: flat citizens/s while any housing is vacant. Guarantees the first cottage
   *   fills even when the growth term is near zero (4 slots × 0.08 = 0.32/s).
   */
  pop: { growthRate: 0.11, shrinkRate: 0.2, baseInflow: 0.5 },

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
   * - threshold: lifetime earnings worth the first point, $11M (27.5 min into the first
   *   city, measured by `probe.mjs --first`; the panel's $1.1M mark is at 18.7 min). With
   *   minGain 1 that is the moment the Found button arms, so the counter the panel shows
   *   is the real bar. The bot holds out for 5 points, $297M, and founds at 41.2 min (a
   *   player who presses at the first point resets a 28-minute city for ×1.19 and a
   *   $600 seed — the final-gate section asks the simulation owner to mirror minGain 3, so
   *   the button arms at $1.04e8 lifetime, ~36 min, instead). Because every later founding needs lifetime earnings of threshold ×
   *   L^(1/exponent), the threshold is the one knob that stretches the whole session
   *   uniformly (+5% threshold ≈ +5% on every cycle, no city re-ordered). It is mirrored
   *   in src/simulation/tuning.js, so the second 2026-09-07 pass left it alone and placed
   *   the 12 h mark with the balance-owned levers instead (tier-4 cost growth, the
   *   district and campus incomes, the growth rate and civicCap): the mark now falls 13
   *   minutes after the Exchange Ring is bought in the 32nd city and 16 minutes before
   *   that city, empty, could complete. Both profiles keep the first founding inside
   *   30–45 min at $11M (41 min default, 39 min for the 30 s saver).
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
   * - firstBonus: 0.15 — the first founding is a jump a player can feel (×1.15 on top of
   *   the points' ×1.03). This is the one knob that scales every replay's income and
   *   nothing in the first city, so it moves the whole clock after the first founding
   *   without re-ordering which city buys which rung (a −1% step is ~+6 min on the 12 h
   *   mark, and the placement margins are ±10–25%). 0.30 → 0.18 is what paid for the
   *   faster cities 2–3 and the mid-city rungs: at 0.30 the session finished an extra,
   *   empty city. 0.18 → 0.15 in the saver-gate pass (header, "What the saver brake is"):
   *   the uniform half of the saver brake, sized so the saver's 36th founding — the one
   *   that crosses the 1e6 legacy ceiling — lands past 12 h while the greedy bot's
   *   Elevator city (33) still opens at 697 min. Mirrored in src/simulation/tuning.js.
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
   *   crosses 1e6 — the default profile founds 34 times and the 30 s saver 35 (its 36th
   *   founding lands ~730 min; header).
   * - prestigePanelShare: 0.1 — the Legacy panel opens once this run has earned
   *   threshold × 0.1 = $1.1M (17.8 min into the first city, ten minutes before the Found
   *   button arms); a mayor with a bank keeps it from the first second.
   */
  prestige: {
    threshold: 1.1e7,
    exponent: 0.488,
    incomePerLegacy: 0.01,
    legacyPower: 0.548,
    firstBonus: 0.15,
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
   * Founding: the replay seed window and the earnings ramp (read by
   * src/simulation/tuning.js foundingTuning; the simulation's DEFAULTS.founding is only the
   * fallback for a config without this section — this block is what ships).
   * - seedSeconds: a founding seeds the new city with the larger of the legacy seed
   *   (startMoney · (1 + startMoneyPerLegacy · legacy), prestige above) and this many
   *   seconds of the old city's peak net income. The simulation's fallback is 60 s; measured
   *   on the 2026-09-07 evening tree that turns every replay into a 2–4 minute city (the
   *   seed buys the whole ladder and every open rung at once: 38 foundings, legacy 2.1e6 —
   *   over the 1e6 ceiling — and a ×1.43 cycle step), because the placed ladder is priced
   *   against a spree the seed would dwarf. The shipped value is what the late ladder is
   *   placed against (see the header); 0 is the legacy seed alone.
   * - marginRamp: earnings fade in over the first marginRamp share of the gross margin
   *   instead of stepping at break-even (simulation integrate()); 0 restores the step rule.
   */
  founding: { seedSeconds: 0, marginRamp: 0.1 },

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
   * Late demand outpaces supply (contract): the four tier-4 consumers draw a sticker of
   * 2.2–2.7× the catalogue figure — arcology 6,500 MW, financial district 10,200, tech
   * campus 11,600, stadium 3,850 — that grows with the fleet (grid strain, `STRAIN` at the
   * top of the file: +12.5% per unit owned, so the 5th unit draws the sticker, the 15th
   * ~1.7× it and the 250th ~19× until the ×40 cap; the buildings module's own rule is
   * +2.5%/unit up to ×1.5). A nuclear plant (12,000 MW, $400k) carries one of them rather
   * than three to five, and the Power tab keeps asking for money through the end of the
   * first city and the first six replays. Measured (final gate, `probe.mjs`): under-power
   * 34% of the first city, 9–14% of hour 2, 0.3–0.9% of hours 3–4, ≤ 0.2% after — the
   * session reads 3.7–4.1% (contract 3–20%, target ≥ 4% in plan.json), never below the
   * 0.6 floor. The flat draw of the previous pass (10,500 / 16,500 / 18,700 / 6,200) read
   * 30.7% / 5.3% / 0.4% / 0.8% and 3.1% overall — 0.14 points over the floor, the margin
   * the final-gate critic flagged; the strain buys the rest of the margin out of hour 2,
   * where the replays' first arcologies and districts now outrun their plants again. What
   * strain cannot do: bite after hour 3. Measured with caps of ×40 (per 10), ×80 (per 6,
   * sticker ×0.57) and ×200 (per 20): every variant leaves hours 3–12 at 0.0–0.9%, because
   * a mature replay's capacity is 10–1,500× its demand (below); nuclear upkeep ×10 and
   * fusion upkeep ×13 ($3,000 / $20,000 per second) change no hour after the first by
   * more than 0.3 points and are not shipped.
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
    // Final gate: office $4.4 (was $4), factory $3.3 (was $3), refinery $66 (was $60), mall
    // $46 (was $40), apartment $260 (was $280) and tower $2,800 (was $3,000) are the
    // first-city compensators for the −17% trim on the two late employers below: they pay
    // the first city's minutes 8–30 back (43.8 → 42.5 min on the final tree) and are noise
    // in a replay, whose income is the tier-4/5 columns.
    office: { baseCost: 1200, income: 4.4 },
    factory: { baseCost: 500, income: 3.3 },

    // Mid-tier housing priced so a greedy buyer adopts it near its unlock (apartments at
    // 20 citizens, towers at 250) — this is what gets a thousand citizens in by minute 10.
    // $280 (not $300) is a first-city cadence knob: it moves the tower and school cards
    // (gates 250 and 500, buildings-owned) from 88 s apart to 100 s.
    apartment: { baseCost: 260 },
    tower: { baseCost: 2800 },

    // Tier-3 employers and the hospital sit at the 20–35 minute frontier.
    mall: { baseCost: 25000, income: 46 },
    refinery: { baseCost: 20000, income: 66 },
    hospital: { baseCost: 60000 },

    // Tier 4. Population gates are placed on the population curve the greedy bot actually
    // rides through the first city, just under the moment the price frontier reaches each
    // card, so a top-tier card never glows unaffordable for more than 4 minutes and no two
    // cards open within 90 s (node src/buildings/cadence.mjs, evening tree: arcology opens
    // 24.1 min and is bought 26.0 · nuclear 28.5 → 28.8 · campus 30.2 → 31.2 · financial
    // 32.1 → 36.1 · stadium 39.3 → 40.3, with the catalogue's fusion gate at 35.0 in between). The curve
    // is steep and jumpy where the arcologies land (pop 6,300 at 23.9 min, 11,000 at
    // 27.3, 22,000 at 32.4), which is why the gates read oddly spaced as numbers: 9,000
    // opened the plant 60 s after the arcology and 4.1 min before the bot could pay for
    // it, 21,000 opened the district 80 s after the campus. The arcology's housing is
    // trimmed from 2,500 to 1,000: at 2,500 one arcology was fifteen towers' worth of
    // citizens for the price of one, and a dozen of them tripped every later gate within
    // a minute. Power draws are 3.2–3.8× the catalogue (see above).
    // 6,600 (was 6,300): on the final tree's faster population curve the arcology opened
    // exactly 90 s after the hospital (5,400), the cadence limit; 6,600 gives it ~20 s more.
    arcology: { baseCost: 120000, housing: 1000, powerUse: 6500, demandGrowth: strain('Arcology'), ...popUnlock(6600, '6,600') },
    // Campus income $740/s (catalogue $1,000; $900 before the final gate) and district
    // income $2,060/s (catalogue $2,000; $2,500 before): a further −18% on both, the
    // uniform income lever that sets where the 12 h mark falls (see the header). The
    // buildings module's two tier-5 megastructures and the Imperial Charter's ×3 make the
    // last five cities of the session 11–27 minutes; at the previous incomes the 12 h
    // session completed 35 foundings and banked 1.04e6 legacy, over the ceiling, and the
    // ninth frontier rung had no city to land in; at −10% the 34th city still completed,
    // empty, eight minutes before 12 h, and at −15% the last rung had no city. The trim
    // (with growthRate 0.1 and the tier-1/2/3 nudges above paying the first city back)
    // ends the session inside the 35th city with every rung bought. Both
    // move together so the district keeps ≥ 0.8× the campus's value per dollar, the band
    // the buildings test holds (the ratio is unchanged by a common factor).
    // Gates: the campus at 16,500 (was 14,500), the nuclear plant at 12,500 (was 11,000),
    // the district at 30,000 (was 22,000) and the stadium at 45,000 (was 43,000) follow
    // the faster population curve of the final tree (the arcology's commuter-belt synergy,
    // growthRate 0.1 and the cheaper mid housing): at the old gates the campus opened 50 s
    // after the plant and the plant, district and stadium glowed unaffordable for 4.1–4.9
    // min (cadence.mjs, limits 90 s and 4 min). Gates move when a card opens, not when it
    // is bought, so they leave the clock alone.
    techpark: { baseCost: 300000, income: 740, powerUse: 11600, demandGrowth: strain('Campus'), ...popUnlock(16500, '16,500') },
    nuclear: { baseCost: 400000, ...popUnlock(12500, '12,500') },
    financial: { baseCost: 7e5, income: 2070, powerUse: 10200, demandGrowth: strain('District'), ...popUnlock(30000, '30,000') },
    // Stadium $3.0M (was $3.5M) and district income $2,070 (was $2,060) are integration nudges:
    // at $3.5M the stadium opened at 36.9 min and was never bought before the 41.1 min
    // founding (the bot's cash peaks at ~$2.2M there; cadence.mjs), and at $2,060 the district
    // fell 0.3% under the 0.8× campus value-per-dollar band once wages are counted.
    stadium: { baseCost: 3e6, powerUse: 3850, demandGrowth: strain('Stadium'), ...popUnlock(45000, '45,000') },

    // Tier 5 (buildings module, final gate): the Orbital Ring opens at 500 legacy (a city
    // plays with the bank its founding left: 451 in city 13, 633 in city 14, so the ring is
    // city 14's item beside the Settlers' Charter — and a felt one: its 80k housing is a
    // fifth of the mid-game's income, a 500k gate ends the session at 28 foundings) and is
    // left there; the Space Elevator's gate is re-pinned from 15,000 to 300,000 legacy so it
    // is the never-bought item of city 33 (plays with 379,733; city 32 with 271,053) — the
    // one novelty that can follow the Imperial Charter's city without shortening its own
    // (a power building is nil in a replay), which is what keeps the open 34th city from
    // completing before 12 h. At 15,000 it landed in city 24 and pushed the Ringworld
    // District out of it, and the tail had two rungs for four slots. See the placement
    // table in the upgrades block.
    elevator: { ...legacyUnlock(300000, '300,000') },

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
   * The registry holds 70 upgrades: 33 core ($25 → $20M, the first city's decisions), 9
   * pace rungs ($88M → $435T, hidden until the city has earned 100× the price or holds
   * it), 9 frontier ($48M → $4.9Qa, earnings gated at a quarter of the price), 7 Legacy
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
   * Charter perks: a ×2.5–4 ladder from 3 to 150,500 points, whole points (3 · 8 · 20 ·
   * 50 · 154 · 385 · 963 · 2,408 · 6,020 · 15,050 · 37,625 · 150,500; the Merchant is ×3.08
   * after the Guild and the Imperial ×4 after the Energy, every other step ×2.5). With
   * the sequence in the header (city n plays with the bank its n-th founding left) they
   * are signed in cities 2 (Homestead), 3 (Mint), 6 (Grid), 8 (Guild), 12 (Merchant), 14
   * (Settlers), 17 (Masons), 20 (Civic), 23 (Treasury), 25 (Skyline), 28 (Energy) and 32
   * (Imperial), and a perk always opens at half its price, so the next clause is on the
   * card a city or two before it can be afforded. The Merchant at ◆154 is the saver
   * brake (header): 149 points are spendable in city 11, so the perk — and the income
   * jump that puts the Quantum Exchange inside a saver's 30 s reach — waits for city 12;
   * at the old ◆125 it signed in 11. The ×2.5 steps above it are what keep the Settlers
   * in city 14 (397 spendable, ◆385) and the Imperial in 32 (130,503 spendable in 31,
   * ◆150,500); the Civic and Treasury Charters move to cities 20 and 23 (1,819 and
   * 5,346 spendable a city earlier), which is what turns 11, 19 and 22 into money
   * cities. The Mint cannot sign in city 2 (the 7 points available there are one short of
   * ◆ 8, and ◆ 7 would break the ×2.5 rule against the Homestead's ◆ 3); cities 1–2 are
   * paced by the seed cash and the Legacy rung prices instead.
   *
   * Late ladder, placed by *city* (cities counted from the first founding — city 1 is
   * the first replay; charter cities in brackets; "mid" = the rung lands off plateau cash
   * after the spree, so the city has a second purchase and the rung's boost lifts the
   * next city — see the header; minutes are where the rung is bought; buildings in braces
   * are the tier-5 megastructures, whose legacy gates set their cities):
   *   [3 Mint + Institutional Memory] · 4 Dyson Swarm (mid, 5.1) · 5 Championship Season
   *   (mid, 8.2) · [6 Grid] · 7 Robotic Assembly (mid, 9) · [8 Guild] · 9 AI Governance
   *   (mid, 18.5) · 10 Orbital Solar (mid, 16.5) · 11 Planetary Charter (mid, 22.2) · [12
   *   Merchant] · 13 Quantum Exchange (1.4) · [14 Settlers + {Orbital Ring}] · 15
   *   Megastructures (1.5) · 16 Arcology Gardens (1.8) · [17 Masons] · 18 Algorithmic
   *   Trading (1.8) · 19 City Archives (2.3) · [20 Civic] · 21 Standing Orders (2) · 22
   *   Mass-Driver Port (2) · [23 Treasury] · 24 Ringworld District (2.4) · [25 Skyline] ·
   *   26 Stellar Engine (2.7) · 27 Superconductor Grid (2.9) · [28 Energy + Galactic
   *   Charter] · 29 Orbital Shipyard · 30 Helios Array · 31 Exchange Ring · [32 Imperial]
   *   · 33 {Space Elevator} · 34 open at 12 h.
   * Every city from the 4th on gets at least one never-before-bought item — 20 money
   * rungs, two megastructures and twelve perks for 31 late cities, with one double (the
   * Galactic Charter in the Energy Charter's city, so the Energy city reads ×0.7 instead
   * of ×1.37) and no spare — which is why the session has to end inside the 35th city
   * (header) and why no second double is possible (a double anywhere leaves one late
   * city with nothing new; only city 4, before the variety line starts, may be empty).
   * The tail is the delicate part: the Imperial Charter's ×3 is priced to land in city 32
   * (×4 after the Energy Charter, the top of the ×2.5–4 band; a city earlier it makes the
   * tail short enough for a 36th founding), the Space Elevator's legacy gate (buildings
   * block) puts the one nil novelty after it, and firstBonus 0.15 is what puts the 12 h
   * mark inside the 35th city: it opens at 715 min and a city with nothing new needs
   * ≥ 22 min there.
   * Each spree price is the geometric mean of the reach of the city before it and the
   * reach of its own city (place.mjs prints both), ±10–25% of margin; the narrowest
   * windows are Orbital Solar (city 16, ±12%) and the Ringworld District (24, ±10%).
   * After any change to income, cost, gates or the perk effects run
   * `node src/balance/place.mjs --plan src/balance/plan.json` and copy the prices in;
   * its last line reports the placed session against plan.json's safety-margin targets.
   * The Quantum Exchange is priced at the top of its spree window ($3.2e10 against a
   * $1.2e10–3.5e10 spree) so it is bought at the spree's peak of city 13 (1.4 min) and
   * the Settlers step after it reads ×1.343; there is no plateau window in city 13 on
   * this ladder (with the Merchant Charter in city 12 the spree outruns the plateau), so
   * a mid-city purchase, which read ×0.6 into city 14 on the previous ladder, is not
   * available — growthRate 0.11 holds the step instead.
   * The second city takes the rest of the tier-4 core (Breeder Reactors at $20M, the
   * fusion reactor and the stadium); Institutional Memory ($30M) is priced above the
   * second city's plateau so it lands in the third city, beside the Mint Charter — its
   * founding re-grant of the tier-1/2 ladder then reaches city 4.
   * Legacy rungs: the four replay accelerators ($1k · $5k · $12k · $25k) are priced for
   * the first two minutes of a 5–10 point replay (see prestige.startMoneyPerLegacy);
   * City Archives ($2.0T) is the 19th city's novelty and Standing Orders ($4.0T) the
   * 21st's — in that order of necessity: Standing Orders re-grants every Legacy rung at
   * each founding after it, so no Legacy rung can be a first purchase once it is owned.
   * Measured strengths (how much shorter the city after the rung is, over the ~×1.3 a
   * city with nothing new grows): Imperial Charter ×2.5, Quantum Exchange ×2.5, Galactic
   * Charter ×2.3, Exchange Ring ×2.2, Planetary Charter ×1.6, AI Governance ×1.4,
   * Algorithmic Trading ×1.2, Robotic Assembly ×1.15; the power rungs (Orbital Solar,
   * Superconductor Grid, Stellar Engine, Helios Array, the Dyson Swarm's grid half), the
   * housing rungs and the jobs rungs (Shipyard, Ringworld) are ×1.0–1.1 in a replay, whose
   * grid, housing and payroll are never the constraint — they are variety, not pace.
   * That is the floor on the cadence contract: a nil rung's city reads ×1.28–1.40 over
   * its predecessor with a spread this file cannot narrow.
   * The frontier keeps its canonical order (Dyson < Quantum < Mass-Driver < Ringworld <
   * Stellar < Galactic < Shipyard < Helios < Exchange Ring) and its earnings gate (a
   * quarter of the price) but not the module's ×10 spacing: ×10 apart the nine rungs
   * would land three to a city and leave a dozen cities empty. A frontier rung is visible
   * from the city that earns a quarter of its price — four to eight cities before the one
   * that buys it. The Exchange Ring at $4.9Qa stays two orders under the $1e18 money
   * ceiling; there is no rung above it, so a session that runs past 12 h keeps founding
   * cities with nothing new to buy (the upgrades module owns the content; this file can
   * only price it).
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
    // pace ladder, one rung per city (placement table above; listed in city order). A pace
    // rung is the one kind a saver cannot pull forward (it opens on earnings or on cash in
    // hand, never on a hoard), so the pace rungs carry cities 5–11 alone.
    'championship-season': { cost: 8.84e7 }, // city 5, mid-city
    'robotic-assembly': { cost: 2.62e8 }, // city 7, mid-city
    'ai-governance': { cost: 1.07e9 }, // city 9, mid-city
    'orbital-solar': { cost: 2.05e9 }, // city 10, mid-city (was city 16; the Dyson Swarm's old slot)
    'planetary-charter': { cost: 4.3e9 }, // city 11, mid-city (was city 12; the slot the Merchant Charter vacated)
    megastructures: { cost: 2.64e11 }, // city 15
    'arcology-gardens': { cost: 3.2e11 }, // city 16
    'algorithmic-trading': { cost: 7.7e11 }, // city 18
    'superconductor-grid': { cost: 4.35e14 }, // city 27
    // frontier ladder (earnings gated at a quarter of the price), canonical order. The Dyson
    // Swarm sits under everything a mid-game saver can hoard for (see the saver note above):
    // at $47.9M it is a mid-city purchase of city 4 and a first-minute one of every replay.
    'dyson-swarm': { cost: 4.79e7 }, // city 4, mid-city (was city 10)
    'quantum-exchange': { cost: 3.2e10 }, // city 13, the top of its spree window ($1.2e10–3.5e10) so it lands at the spree's peak and city 14 reads x1.343
    'mass-driver-port': { cost: 9e12 }, // city 22 (window $4.8e12–1.0e13)
    'ringworld-district': { cost: 7.0e13 }, // city 24 (the Treasury city's spree, 23, reaches $4.9e13)
    'stellar-engine': { cost: 3.18e14 }, // city 26
    'galactic-charter': { cost: 5.22e14 }, // city 28, with the Energy Charter
    'orbital-shipyard': { cost: 1.35e15 }, // city 29
    'helios-array': { cost: 2.25e15 }, // city 30 (window $1.5e15–3.4e15)
    'exchange-ring': { cost: 4.87e15 }, // city 31 (window $2.9e15–8.3e15), the last rung; the Imperial Charter is city 32's item, the Space Elevator city 33's, city 34 is open at 12 h
    // legacy (money-priced, unlocked by points): the four replay accelerators are priced at
    // the first minutes of a 5–10 point replay (see the Legacy rungs note above)
    'legacy-archive': { cost: 1000 },
    'founders-blueprints': { cost: 5000 },
    'veteran-planners': { cost: 12000 },
    'dynasty-ledger': { cost: 25000 },
    'institutional-memory': { cost: 3e7 }, // city 3, with the Mint Charter
    'city-archives': { cost: 2.0e12 }, // city 19 (was city 4): above a saver's 30 s reach in city 17, so its hoard no longer opens Algorithmic Trading a city early
    'standing-orders': { cost: 4.03e12 }, // city 21 (re-grants the Legacy rungs from city 22 on, so no Legacy rung can be a novelty after it)
    // charter perks (legacy points): ×2.5–4 apart (whole points, never under), 3 → 150,500
    'charter-homestead': { cost: 3 },
    'charter-mint': { cost: 8 },
    'charter-grid': { cost: 20 },
    'charter-guild': { cost: 50 },
    'charter-merchant': { cost: 154 }, // ×3.08 after the Guild: city 12, not 11 (149 spendable in city 11) — the saver brake, see the Charter note above
    'charter-settlers': { cost: 385 }, // ×2.5: still city 14 (397 spendable there, 235 in 13)
    'charter-masons': { cost: 963 }, // city 17
    'charter-civic': { cost: 2408 }, // city 20 (was 19: 1,819 spendable in 19)
    'charter-treasury': { cost: 6020 }, // city 23 (was 22: 5,346 spendable in 22)
    'charter-skyline': { cost: 15050 }, // city 25
    'charter-energy': { cost: 37625 }, // ×2.5 after the Skyline: city 28 (45,323 spendable there; 25,202 in city 27)
    'charter-imperial': { cost: 150500 }, // ×4 after the Energy: city 32, not 31 (130,503 spendable in 31) — the tail brake (see the Charter note above)
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
