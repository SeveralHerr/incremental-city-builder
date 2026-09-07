// Metropolis — balance configuration.
// The single source of tuning truth. Every number that shapes pacing lives here so the
// balance owner can retune the game without touching any other folder.
// DOM-free: this file must import cleanly in Node (economy-sim) and the browser.
//
// Pacing (greedy bot, `node tools/economy-sim.mjs --ticks 432000 --out logs/sim-fix-balance-12h.json`,
// 12 game-hours; measured on the 2026-09-07 final-gate tree — every sibling module was
// edited during this pass (the simulation's seed window and tap ladder, the buildings
// module's tier-5 megastructures and commuter belt, the upgrades module's funded door and
// ninth frontier rung), so re-measure before quoting. The tools that produced every number
// below live in this folder: `node src/balance/probe.mjs [--save N] [--set path=value]
// [--cities] [--first]` prints the readings the pass is tuned against (strict cycle
// ratios, which city and minute each rung lands in, per-city spree/plateau reach,
// under-power by hour, mid-city happiness dips, the first city's clock and its cheapest
// open rung by minute, and a margins line against src/balance/plan.json `targets`) and
// `node src/balance/place.mjs --plan src/balance/plan.json [--save N]` re-prices the late
// ladder from that plan, one rung per city, after any change elsewhere (run it after every
// sibling retune: a 1% change of income moves the 12 h mark ~7 min).
//   Opening: cottage 0 s · two windmills, three more cottages and the Welcome Sign by 4 s ·
//   first corner shop 50 s · first brownout ~2.3 min · 1k citizens ~12 min · Legacy panel
//   at $1.1M earned (18.7 min) · Found button arms at $11M (27.5 min; a 1-point founding
//   is possible from there, the bot holds out for 5 points) · first founding 41.2 min with
//   5 legacy (42.5 before the tier-1/2/3 nudges in the buildings block; 41.8 on the
//   critic's tree).
//   First city, tier-4 cards (node src/buildings/cadence.mjs): arcology opens 22.9 min ·
//   nuclear 25.5 · tech campus 27.7 · financial 30.5 · fusion 36.1 · stadium 37.5; every
//   card opens ≥ 90 s after the previous one and is bought within ~4 minutes (the gates are
//   placed on the pop curve the bot actually rides — see buildings below).
//   Purchase tension in the first city: the cheapest open money upgrade is 30 s – 15 min
//   of income away in 51–55% of its minute samples (0% on the critic's tree) — the
//   upgrades module's funded door (a core rung opens only when the treasury holds its
//   price, so the open card is the far goal card), measured here, not priced here.
//   Power: the first city runs under full power for 34% of its 41 minutes (minutes 3–16
//   on windmills and coal, minutes 27–40 under the tier-4 draw with grid strain —
//   `probe.mjs --first` prints the share by minute), hour 2 of the session 14%, hours 3–5
//   0.4–0.6%, hours 6–12 ≤ 0.3%; the session 4.2% (contract 3–20%; plan target ≥ 4%),
//   never below the 0.6 floor. See the buildings block for why hours 3–12 are out of
//   this file's reach.
//   Cycles (minutes): 41 · 13 · 12 · 7.8 · 7.1 · 9.0 · 12 · 14 · 17 · 21 · 23 · 19 · 23 ·
//   14 · 8.7 · 11 · 14 · 17 · 23 · 29 · 28 · 35 · 24 · 29 · 29 · 24 · 31 · 35 · 25 · 30 ·
//   32 · 27 · 13 · 18 — 34 foundings, the 35th city open at 12 h (it opens at ~714 min; a
//   city with nothing new needs ≥ 13 min, so it cannot complete). Shape: the first
//   founding at 41 min, two 12–13 minute replays, a 7–9 minute floor at cities 3–5, a ramp
//   to ~23 min by city 12, a second dip to 8.7 min after the Quantum Exchange (city 14),
//   a 23–35 minute plateau, then the Imperial Charter's ×3 (city 32, 13 min) and the
//   Space Elevator's city (33, 18 min). Strictly, no cycle from the 5th founding on is
//   more than ×1.341 the one before it (contract ≤ 1.35; the step is the Elevator city
//   after the Imperial's — a nil building after a ×3 perk); the longest cycle after the
//   first city is 35 min (contract: last ≤ 40; plan target: every cycle ≤ 50, last ≤ 38).
//   Legacy 5.3e+05 (all twelve charter perks signed), money peak 3.2e+17.
//   Purchase tension over the session: 37–39% of samples (contract ≥ 30%, target ≥ 35%).
//   Happiness dips under 1.0 in 21 of 34 cities (the opening minute of a replay; from
//   city 21 on the Founder of Legend tier's flat +0.25 hides it; 3 cities dip mid-city).
//   Coverage: every building (22, the two tier-5 megastructures included) and every one of
//   the 70 registered upgrades.
//   Saver profile (`node src/balance/probe.mjs --save 30`, the sim's `--saver`): 37
//   foundings, first founding 39 min, legacy 1.46e+06 and money peak 2.1e+18 — OVER both
//   magnitude ceilings, with 14 empty late cities. This is new on the final-gate tree and
//   this file cannot close it (see "Why the saver profiles have empty cities" and the
//   final-gate section below): the saver hoards toward the cheapest open frontier rung
//   and buys every pace rung it passes on the "holds the price" door (three rungs in city
//   7, two in 11, 19, 22 and 26), so it is ~50 min ahead of the default bot by city 13,
//   and the tail's new felt content (the Imperial Charter's ×3, the tier-5 megastructures,
//   the Helios Array) turns that lead into two extra foundings. Measured: a uniform
//   −5.5% income brake keeps the saver at 35 foundings (7.4e5) but costs the default
//   profile the Imperial Charter (its city opens after 12 h); an earned gate of ×0.5 or
//   ×1 on the frontier rungs does not move the saver (it still bunches); re-ordering the
//   pace rungs above the frontier rung the saver hoards for (AI Governance above the
//   Dyson Swarm) only moves the bunch from city 7 to city 5. One price table cannot serve
//   a 5 s-reach and a 30 s-reach bot on this content; the request is in the final-gate
//   section (the saver's own placement, `place.mjs --save 30`, needs 6–8 more late rungs).
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
// Polish pass (2026-09-07, `logs/probe-polish-*.log`). One placement changed: the
// sibling polish edits moved the Quantum Exchange city (13) from 5.6 to 5.5 minutes, which
// put the two steps after it (Settlers 14, Megastructures 15) at ×1.358 / ×1.352 — inside
// the sim's 30 s slack, over the strict line this file is tuned to. The Quantum Exchange
// is now $4.5e10 (was $2.88e10): it is bought at the peak of city 13's spree (1.8 min)
// instead of on the way up (1.3 min), which gives city 13 its 0.1 minute back (5.6) and
// reads ×1.345 / ×1.345 again. The later purchase lowers the sprees of cities 14–16 by
// 8–10%, so the two rungs in the narrowest window moved with it: Megastructures $3.4e11
// (was $4.21e11; window $2.74e11 – $4.2e11) and Orbital Solar $4.0e11 (was $4.75e11;
// window $3.57e11 – $4.53e11, ±12%, the post-Megastructures cash of city 15 to the
// no-purchase spree of city 16). Checked to hold under growthRate 0.092; at civicCap 1.10
// the Megastructures step reads ×1.351 — the ±1% sensitivity the upgrades block already
// documents. What was tried for the three open readings the critics listed, measured
// with the probe's what-if hooks, and why those numbers are unchanged:
//   • Galactic Charter in city 27 (its own city, instead of the Energy Charter's spree in
//     28) so the two 45–50 minute power-rung cities (26 Stellar Engine, 27 Superconductor
//     Grid) do not follow each other. Priced $2.95e14 it lands in 27's spree at 2.7 min and
//     city 27 falls 50 → 26 min; the Energy city (28) keeps its 36 minutes (it ends on the
//     same income either way) and so reads ×1.377 over 27 — over the 1.35 line by 2.3%, and
//     robustly so: the tail brake (legacyPower 0.545), tier-4 growth 1.108, growth rate
//     0.095 and civicCap 1.15 all read ×1.372–1.377 (the ratio is set by the content: a
//     felt rung in a spree followed by a city whose only novelty is a power perk). The
//     move also ends the session 24 minutes earlier, so an empty 33rd city completes
//     before 12 h. The fix is a felt clause on the power content, not a price:
//     `--boost charter-energy=income:1.25` is the request to the upgrades owner; with it,
//     city 27 = Galactic, 28 = Energy + Superconductor, and the tail is re-placed with
//     place.mjs (the −24 min on the session end is paid back with the uniform levers).
//   • The saver placement. `--frontier-gate 10` / `100` (frontier rungs hidden until the
//     city has earned 10× / 100× the price, the critic's "a saver cannot pull a rung
//     early") does not help the 30 s saver: it still bunches rungs (city 4 two, city 6
//     three) and leaves 6–8 late cities empty, and it costs the default profile the whole
//     placement (28 foundings, 4 cycles over ×1.35, 7 empty cities): a saver's reach is 30
//     s of income wherever the rung opens, so an earnings gate only moves the bunch. The
//     honest reading stands: the two profiles need different prices, and one price table
//     cannot serve both without a 20th rung. `place.mjs --save 30` now exists so a saver
//     table can be placed and checked in one command if the content ever allows it.
//   • First-city tension (the cheapest open rung 30 s – 15 min of income away): 0 of 41
//     minute-samples in the first city. The core ladder opens a card every 1–2 minutes at
//     2–17 s of income (the probe's `--first` list), so the *cheapest* open card is always
//     a reflex buy whatever the dearer ones cost: ×3 on the six tier-2/3 rungs the critic
//     named reads 0% and puts the first founding at 47.4 min (over 45); Digital City Hall
//     $1.2e7 + Preventive Care $3e7 reads 7% at +2.6 min; opening the tier-3/4 cards a pop
//     gate earlier (`--unlock digital-city-hall=pop:5000` …) reads 0% because cheaper
//     cards are still open beside them. Tension in the first city needs the core ladder's
//     gates re-spaced against its prices (upgrades), not a price change here; the 53% the
//     session reads is earned from city 4 on, where the frontier cards are the far target.
//
// Final gate (2026-09-07 evening, this pass). What moved and what was measured for the
// requests below (every reading from `node src/balance/probe.mjs`, 12 h):
//   • Safety margins. src/balance/plan.json now carries a `targets` block (first founding
//     31–43 min, strict ratio ≤ ×1.32, every cycle after the first ≤ 40 min, last ≤ 38,
//     under-power 4–18%, reach ≥ 35%, dips ≥ 55%, 20–34 foundings, money ≤ 5e17, legacy
//     ≤ 8e5) inside every contract gate; probe.mjs prints a margins line, place.mjs checks
//     its result and balance.test.mjs asserts the shipped default-profile log against them.
//   • Grid strain on the tier-4 consumers (buildings block) and the founding section
//     (seed window off) are the two balance-owned changes; the late ladder is re-placed
//     around the buildings module's two tier-5 megastructures (Orbital Ring at 1,500
//     legacy, city 17; Space Elevator at 15,000, city 24), which are the never-bought
//     items of their cities and free two rungs for the tail.
//   • Cross-module requests, with the balance-side measurement each rests on:
//     upgrades — (1) a felt clause on the power content: `--boost charter-energy=income:1.25`
//     lets the Galactic Charter take a city of its own (city 27 falls 50 → 26 min) and is
//     the only way a power-perk city stops reading ×1.37 after a felt rung; (2) six to
//     eight more late money rungs, so `place.mjs --save 30` and the default plan can both
//     be satisfied — the saver still sees 8–11 empty late cities on any single price table
//     (see "Why the saver profiles have empty cities"); (3) the frontier gate at earned ≥
//     cost/2 instead of cost/4 to narrow the saver/bot spread; (4) the grid perk stack
//     compressed from ×30 supply / ×0.2 demand to ≤ ×8 / ×0.5, without which no draw this
//     file can set puts hour 3 or later under power (buildings block). The first-city
//     tension is now the upgrades module's "funded" door (a core rung opens only when the
//     treasury holds its price, so the cheapest open card is the far goal card): it reads
//     48–57% of the first city's minute samples on the final tree, up from 0%.
//     core — stop the bot scoring generators past 2× surplus (bot.js: the base value
//     powerGen × 2 per dollar outranks an arcology at equal counts, so it holds ~200
//     nuclear and ~200 fusion plants by city 26).
//     simulation — mirror `prestige.minGain: 3` in tuning.js DEFAULTS.prestige so this
//     file can ship it (the mirror test pins the block knob for knob, so balance cannot
//     move it alone): the Found button then arms at threshold × 3^(1/0.488) = $1.04e8
//     lifetime (~36 min into the first city) instead of $11M (28.6 min), keeping the
//     earliest possible founding inside 30–45 min; the bot's cadence is unchanged (it
//     holds out for 5 points).
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
   *   clock the first city had before the trim. 1k citizens arrive at ~12 min in the first city (pop 1,218
   *   at minute 12, `probe.mjs --trace 0`).
   * - shrinkRate: fraction of the overflow (pop − housing) lost per second when housing is
   *   sold. Deliberately faster than growth so selling homes has a bite.
   * - baseInflow: flat citizens/s while any housing is vacant. Guarantees the first cottage
   *   fills even when the growth term is near zero (4 slots × 0.08 = 0.32/s).
   */
  pop: { growthRate: 0.1, shrinkRate: 0.2, baseInflow: 0.5 },

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
   *   threshold × 0.1 = $1.1M (17.8 min into the first city, ten minutes before the Found
   *   button arms); a mayor with a bank keeps it from the first second.
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
   * next city — see the header; minutes are where the rung is bought; buildings in braces
   * are the tier-5 megastructures, whose legacy gates set their cities):
   *   [3 Mint + Institutional Memory] · 4 City Archives (mid, 5.3) · 5 Championship
   *   Season (mid, 7.2) · [6 Grid] · 7 Robotic Assembly (mid, 12.6) · [8 Guild] · 9 AI
   *   Governance (mid, 18.6) · 10 Dyson Swarm (mid, 19.4) · [11 Merchant] · 12 Planetary
   *   Charter (mid, 19.6) · 13 Quantum Exchange (mid, 12.5) · [14 Settlers + {Orbital
   *   Ring}] · 15 Megastructures (1.6) · 16 Orbital Solar (1.9) · [17 Masons] · 18
   *   Arcology Gardens · [19 Civic] · 20 Algorithmic Trading · 21 Standing Orders · [22
   *   Treasury] · 23 Mass-Driver Port · 24 Ringworld District · [25 Skyline] · 26 Stellar
   *   Engine · 27 Superconductor Grid · [28 Energy + Galactic Charter] · 29 Orbital
   *   Shipyard · 30 Helios Array · 31 Exchange Ring · [32 Imperial] · 33 {Space Elevator}
   *   · 34 open at 12 h.
   * Every city from the 4th on gets at least one never-before-bought item — 20 money
   * rungs, two megastructures and twelve perks for 31 late cities, with one double (the
   * Galactic Charter in the Energy Charter's city, so the Energy city reads ×0.7 instead
   * of ×1.37) and no spare — which is why the session has to end inside the 35th city
   * (header). The tail is the delicate part: the Imperial Charter's ×3 is priced to land
   * in city 32 (×4 after the Energy Charter, the top of the ×2.5–4 band; at ×2.5 it lands
   * in city 30, the tail runs 36 foundings and legacy crosses 1e6), the Space Elevator's
   * legacy gate (buildings block) puts the one nil novelty after it, and the two late
   * employers' incomes (buildings block) are trimmed so the open 35th city cannot
   * complete: it opens at ~714 min and a city with nothing new needs ≥ 13.
   * Each spree price is the geometric mean of the reach of the city before it and the
   * reach of its own city (place.mjs prints both), ±10–25% of margin; the narrowest
   * windows are Orbital Solar (city 16, ±12%) and the Ringworld District (24, ±10%).
   * After any change to income, cost, gates or the perk effects run
   * `node src/balance/place.mjs --plan src/balance/plan.json` and copy the prices in;
   * its last line reports the placed session against plan.json's safety-margin targets.
   * The Quantum Exchange is priced at the top of its window ($2.0e10 against a $1.8e10
   * spree and a $3.3e10 plateau) so it is a mid-city purchase of city 13 (12.5 min) rather
   * than a spree buy: bought in the spree, city 13 reads 6 min and the Settlers step
   * after it ×1.35–1.37.
   * The second city takes the rest of the tier-4 core (Breeder Reactors at $20M, the
   * fusion reactor and the stadium); Institutional Memory ($30M) is priced above the
   * second city's plateau so it lands in the third city, beside the Mint Charter — its
   * founding re-grant of the tier-1/2 ladder then reaches city 4.
   * Legacy rungs: the four replay accelerators ($1k · $5k · $12k · $25k) are priced for
   * the first two minutes of a 5–10 point replay (see prestige.startMoneyPerLegacy);
   * City Archives ($52M) is the 4th city's mid-city rung and Standing Orders ($4.0T) the
   * 21st city's novelty.
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
    // pace ladder, one rung per city (placement table above; listed in city order)
    'championship-season': { cost: 8.84e7 }, // city 5, mid-city
    'robotic-assembly': { cost: 3.0e8 }, // city 7, mid-city
    'ai-governance': { cost: 1.1e9 }, // city 9, mid-city
    'planetary-charter': { cost: 8.4e9 }, // city 12, mid-city (the final tree has no spree window in city 12: the Merchant's spree already reaches it)
    megastructures: { cost: 2.78e11 }, // city 15
    'orbital-solar': { cost: 3.21e11 }, // city 16
    'arcology-gardens': { cost: 7.65e11 }, // city 18
    'algorithmic-trading': { cost: 2.17e12 }, // city 20
    'superconductor-grid': { cost: 4.35e14 }, // city 27
    // frontier ladder (earnings gated at a quarter of the price), canonical order
    'dyson-swarm': { cost: 2.27e9 }, // city 10, mid-city
    'quantum-exchange': { cost: 2.0e10 }, // city 13 (window $1.2e10–2.1e10; priced near the top so it is bought at the spree's peak, not before it — see the Quantum note above)
    'mass-driver-port': { cost: 4.3e13 }, // city 23
    'ringworld-district': { cost: 4.88e13 }, // city 24
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
    'city-archives': { cost: 5.24e7 }, // city 4, mid-city
    'standing-orders': { cost: 4.03e12 }, // city 21
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
    'charter-energy': { cost: 48952 }, // ×4 after the Skyline: still city 28 (78k spendable there)
    'charter-imperial': { cost: 195808 }, // ×4 after the Energy: city 32, not 30 — the tail brake (see the Charter note above)
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
