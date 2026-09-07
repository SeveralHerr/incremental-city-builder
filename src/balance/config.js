// Metropolis — balance configuration.
// The single source of tuning truth. Every number that shapes pacing lives here so the
// balance owner can retune the game without touching any other folder.
// DOM-free: this file must import cleanly in Node (economy-sim) and the browser.
//
// Pacing (greedy bot, `node tools/economy-sim.mjs --ticks 432000 --out logs/sim-balance.json`,
// 12 game-hours; measured on the 2026-09-07 tree — re-measure before quoting, the other
// modules were mid-retune while this pass was placed and a few percent of income either
// way slides a late rung by a city).
//   Opening: cottage 0 s · two windmills, three more cottages and the Welcome Sign by 4 s ·
//   first corner shop 50 s (the shop gets the first $50; Zoning Reform follows at ~105 s) ·
//   first brownout ~2.3 min · 1k citizens 12 min · Legacy panel at $1.1M earned (~12 min) ·
//   Found button arms at $11M (~20 min) · first founding ~43 min with 5 legacy.
//   Power: the first city runs under full power for 38% of its 43 minutes (tier-4 draw is
//   3.5–4.2× the catalogue's, see buildings below), cities 2–6 for 19 · 18 · 16 · 10 · 9%,
//   and the session as a whole 3.4% of the time, never below the 0.6 floor. Nothing after
//   city 7 sits under power: see the buildings block for why that is out of this file's
//   reach.
//   Cycles (minutes): 43 · 12 · 11 · 4.5 · 6.2 · 8.2 · 11 · 15 · 16 · 18 · 20 · 16 · 20 · 5.3 ·
//   7.1 · 9.6 · 13 · 16 · 21 · 28 · 24 · 31 · 21 · 26 · 32 · 32 · 42 · 25 · 34 · 43 · 20 · 26 ·
//   30 — 33 foundings, the 34th city open at 12 h. Shape: the first founding at 43 min,
//   two 11–12 minute replays (a 5–10 point mayor now opens with $1,800–3,300 of seed cash
//   and buys the four Legacy rungs inside the first two minutes — they were 16 minutes,
//   a full replay of the first city), a 4.5–8 minute floor at cities 4–6, a ramp to ~20
//   min by city 11, a second dip to 5 min at the Quantum Exchange (city 13), then a 20–43
//   minute plateau. No cycle is more than ×1.35 (+30 s) longer than the one before it; the
//   last completed cycle is 30 min. Legacy 3.8e+05 (127,476 spent on all twelve charter
//   perks), money peak 3.0e+16, income 1.3e+15/s at the end.
//   Purchase tension: the cheapest unlocked, unowned money upgrade is 30 s – 15 min of
//   income away in ~57% of samples (contract ≥ 30%).
//   Happiness dips under 1.0 in 22 of 33 cities (the opening minute of a replay: an
//   all-housing spree with jobless citizens and a dark first tick; from city 21 on the
//   Founder of Legend tier's flat +0.25 hides the dip).
//   Coverage: every building and every one of the 69 registered upgrades.
//   Saver profile (`--saver`, a bot that saves toward a rung within 30 s of income): 34
//   foundings, legacy 5.3e+05, money peak 1.0e+16 — inside both ceilings (1e6 / 1e18);
//   it is not held to the cadence numbers. A 36th founding would cross 1e6 legacy, so
//   the saver has one founding of margin; the tail brake (legacyPower) is what holds it.
//
// How the late game is placed. The verify/sim bot never saves: it buys the best-scoring
// *affordable* item every two seconds, so the cash it holds tracks a "frontier" — 2–10
// seconds of income in a mature city, spiking during the first three minutes of a replay
// when income has jumped (a founding, a perk) and building prices have not caught up.
// A money rung is bought in the first city whose cash reaches its price, so the late
// ladder is placed by *city*: each price sits between two consecutive cities' reach (the
// placement table is in the upgrades block). The bot's legacy sequence is deterministic
// (5 points, then +40% per founding: 5, 10, 15, 21, 30, 42, 59, 83, 117, 164, 230, 322,
// 451, 632, 885, 1239, 1735, 2429, 3401, 4762, 6667, 9335, 13070, 18300, 25629, 35888,
// 50265, 70375, 98568, 138005, 193207, 270490, 378686 after founding 33), so a charter
// perk lands in a fixed city set by its price alone: the ×2.5 ladder below signs one every
// 2–3 cities (2, 4, 7, 9, 12, 15, 18, 20, 23, 26, 29, 31). Five structural facts drive
// every number:
//   • a replay's income is set inside its first three minutes (seed cash × legacy bonus
//     buys the whole core ladder back at once); after that a mature city's income grows
//     only logarithmically with spend, so a cycle's length is essentially "earnings
//     required / income after the spree";
//   • each founding must out-earn the whole past by 1.4^(1/exponent) − 1, while the legacy
//     bonus grows 1.4^legacyPower per founding; a city with nothing new is ~×1.3 longer
//     than the one before it, and a city whose predecessor's income rung landed in the
//     *spree* (or whose predecessor signed an income perk) reads ×1.4+, because the boost
//     was already in that predecessor's average. So an income rung is placed to land
//     *late* (mid-city) wherever the bot's plateau cash still exceeds its spree cash —
//     cities 4–10, 13 and 20 — which shortens its own city a little and lifts the next
//     one a lot, and the pure power / memory rungs (Dyson Swarm, Orbital Solar,
//     Superconductor Grid, Stellar Engine, Standing Orders) follow a late-landing or a
//     non-income city, never a spree-income one;
//   • from city ~17 on the spree cash exceeds anything the plateau reaches (cost perks and
//     income multipliers pile up faster than building prices), so a late rung can only
//     land in a spree there, and the city after a founding perk (Settlers', Masons',
//     Skyline, Energy) has *less* reach than the perk city — a rung priced above the perk
//     city's spree waits for the city after next. The placement below respects that;
//   • the frontier rungs are bought in price order (a cheaper frontier rung is always
//     affordable first), so their order across cities is fixed and only their spacing is
//     free; the pace rungs and the two money-priced Legacy rungs (City Archives, Standing
//     Orders) are the movable pieces;
//   • the ladder has exactly 19 money rungs for the 19 non-perk cities from the 4th to the
//     32nd, so the session must end inside the 33rd city: the tail brake (legacyPower) and
//     the replay bonus (firstBonus) are tuned so the 12 h mark lands 34 minutes into it.
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
   * - incomePerLegacy / legacyPower: income × (1 + 0.01·legacy)^0.548 (the contract
   *   allows up to 0.6), uncapped: ×1.45 at 100 points, ×12.5 at 10k, ×47 at the 3.8e5 a
   *   12 h session banks. The knee of the curve (k·legacy ≈ 1, at 100 points ≈ city 8) is
   *   the lever that shapes the early replays: below it the bonus barely grows per
   *   founding and the 4–8 minute floor cities lengthen into the plateau by themselves;
   *   above it the bonus grows ×1.4^p per founding. legacyPower is the tail brake: each
   *   −0.001 costs ~0.7% of income at 1e5 points and ~0.1% at 100, i.e. it slows the last
   *   ten cities ~5× more than the first ten. 0.548 is what puts the 12 h mark 34 minutes
   *   into the 33rd city with the 19-rung ladder fully bought (0.545: the 33rd city, empty,
   *   completes 5 min before 12 h; 0.55 and 0.555: the 28th city reads ×1.37–1.40 over the
   *   27th and the session runs to a 34th city with nothing new). The saver profile's
   *   1e6 legacy ceiling is one founding away at this value (34 foundings, 5.3e5).
   * - firstBonus: 0.18 — the first founding is a jump a player can feel (×1.18 on top of
   *   the points' ×1.03). This is the one knob that scales every replay's income and
   *   nothing in the first city, so it moves the whole clock after the first founding
   *   without re-ordering which city buys which rung (a −1% step is ~+6 min on the 12 h
   *   mark, and the placement margins are ±10–20%). 0.30 → 0.18 is what paid for the
   *   faster cities 2–3 and the mid-city rungs: at 0.30 the session finished a 34th,
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
   *   crosses 1e6 — so the tail brake above is what keeps the saver at 33.
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
   * city and the first six replays. Measured: under-power share 3.4% of the 12 h session
   * (38% of the first city's 43 minutes, then 19 · 18 · 16 · 10 · 9 · 2 · 3% of cities 2–8),
   * never below the 0.6 floor; about 45% of the under-power minutes are outside the first
   * city. The draw is at the ceiling the first founding allows (×1.3 puts it at 46 min,
   * over the 45 the contract asks for; ×1.1 is +1.3 min).
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
    arcology: { baseCost: 120000, housing: 1000, powerUse: 10500, ...popUnlock(4000, '4,000') },
    techpark: { baseCost: 300000, powerUse: 18700, ...popUnlock(8000, '8,000') },
    nuclear: { baseCost: 400000, ...popUnlock(8000, '8,000') },
    // Financial district: opens at 12k citizens, ~33 min, two and a half minutes after the
    // campus, at $700k and $2,600/s (×2.5 with a full payroll): 7.2/$k at base against the
    // campus's 8.75 (the buildings test's band), about 1.4× the campus's frontier value
    // when it lands, so the two ladders climb together.
    financial: { baseCost: 7e5, income: 2600, powerUse: 16500, ...popUnlock(12000, '12,000') },
    stadium: { baseCost: 3.5e6, powerUse: 6200, ...popUnlock(22000, '22,000') },

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
   * pace rungs ($77M → $1.6Qa, hidden until the city has earned 100× the price or holds
   * it), 8 frontier ($2.2B → $25Qa, earnings gated at a quarter of the price), 7 Legacy
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
   * the first replay; charter cities in brackets; "mid" = the rung lands 4–18 minutes
   * into its city, off plateau cash, so the city has a second purchase after its spree
   * and the rung's boost lifts the next city — see the header):
   *   [3 Mint] · 4 City Archives (mid, 3.7 min) · 5 Championship Season (mid, 6.2) · [6
   *   Grid] · 7 Robotic Assembly (mid, 8.6) · [8 Guild] · 9 AI Governance (mid, 12.5) · 10
   *   Dyson Swarm (mid, 18) · [11 Merchant] · 12 Planetary Charter · 13 Quantum Exchange ·
   *   [14 Settlers] · 15 Megastructures · 16 Orbital Solar · [17 Masons] · 18 Arcology
   *   Gardens · [19 Civic] · 20 Algorithmic Trading (mid, ~10) · 21 Standing Orders · [22
   *   Treasury] · 23 Mass-Driver Port · 24 Ringworld District · [25 Skyline] · 26 Stellar
   *   Engine · [27 Galactic Charter, spree] · [28 Energy] · 29 Superconductor Grid · [30
   *   Imperial] · 31 Orbital Shipyard · 32 Exchange Ring · 33 open at 12 h.
   * Every city from the 4th on gets exactly one never-before-bought item — 19 money rungs
   * for the 19 non-perk cities, no doubles and no spare — which is why the session has
   * to end inside the 33rd city (header). The sequence is chosen so that no pure power or
   * memory rung (Dyson, Orbital Solar, Superconductor, Stellar, Standing Orders) follows a
   * city whose income rung landed in its spree or whose perk is an income perk: those
   * predecessors already carried the boost in their average, and the follower reads
   * ×1.4+. The three income cities that had to be spree landings (Planetary 12, Quantum
   * 13, Mass-Driver 23) are each followed by a jobs/housing item (Quantum → Settlers'
   * growth, Megastructures; Mass-Driver → Ringworld), which reads ×1.2–1.35.
   * Each price is the geometric mean of the reach of the city before it (its spree or
   * plateau cash, whichever is higher) and the reach of its own city, so it has ±10–20%
   * of margin either way — enough for a small retune elsewhere, not for a large one:
   * re-place with the sim after any change to income, cost or the perk effects.
   * The second city takes the rest of the tier-4 core (Breeder Reactors at $20M, the
   * fusion reactor and the stadium); Institutional Memory lands in the third city — its
   * founding re-grant of the tier-1/2 ladder is what turns city 4 into a four-minute
   * replay.
   * Legacy rungs: the four replay accelerators ($1k · $5k · $12k · $25k) are priced for
   * the first two minutes of a 5–10 point replay (see prestige.startMoneyPerLegacy);
   * City Archives ($50M) is the 4th city's mid-city rung and Standing Orders ($6.8T) the
   * 21st city's novelty — its founding memory (tier-3 and Legacy rungs granted at every
   * founding) is a convenience whose pacing value is nil by then, but the slot after the
   * late-landing Algorithmic Trading is one of the few a no-income rung can take.
   * Measured strengths (how much shorter the city after the rung is, over the ~×1.3 a
   * city with nothing new grows): Quantum Exchange ×2.5, Galactic Charter ×2.3, Planetary
   * Charter ×1.6, AI Governance ×1.4, Exchange Ring ×2.2, Algorithmic Trading ×1.2,
   * Robotic Assembly ×1.15; the power rungs and the housing rungs are ×1.0–1.1 in a
   * replay, whose grid and housing are never the constraint — they are variety, not pace.
   * The frontier keeps its canonical order (Dyson < Quantum < Mass-Driver < Ringworld <
   * Stellar < Galactic < Shipyard < Exchange Ring) and its earnings gate (a quarter of the
   * price) but not the module's ×10 spacing or its 1e13 floor: ×10 apart the eight rungs
   * would land three to a city and leave a dozen cities empty. A frontier rung is visible
   * from the city that earns a quarter of its price — four to eight cities before the one
   * that buys it — so the Upgrades panel shows two or more targets in most cities from
   * the 8th on (Quantum from city 9, Mass-Driver from 16, Ringworld/Stellar/Galactic from
   * 18–20, Shipyard/Exchange Ring from 24); the thin stretch is cities 13–16, where only
   * the Mass-Driver Port is on the card. The Exchange Ring at $25Qa is the priciest thing
   * in the game and stays two orders under the $1e18 money ceiling.
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
    'championship-season': { cost: 7.7e7 }, // city 5, mid-city
    'robotic-assembly': { cost: 3e8 }, // city 7, mid-city
    'ai-governance': { cost: 1.1e9 }, // city 9, mid-city
    'planetary-charter': { cost: 9.5e9 }, // city 12
    megastructures: { cost: 4.3e11 }, // city 15
    'orbital-solar': { cost: 5.4e11 }, // city 16
    'arcology-gardens': { cost: 1.4e12 }, // city 18
    'algorithmic-trading': { cost: 2.1e12 }, // city 20, mid-city
    'superconductor-grid': { cost: 1.6e15 }, // city 29
    // frontier ladder (earnings gated at a quarter of the price), canonical order
    'dyson-swarm': { cost: 2.2e9 }, // city 10, mid-city
    'quantum-exchange': { cost: 2.6e10 }, // city 13
    'mass-driver-port': { cost: 5.6e13 }, // city 23
    'ringworld-district': { cost: 6.7e13 }, // city 24
    'stellar-engine': { cost: 3.3e14 }, // city 26
    'galactic-charter': { cost: 3.65e14 }, // city 27
    'orbital-shipyard': { cost: 2.4e16 }, // city 31
    'exchange-ring': { cost: 2.5e16 }, // city 32
    // legacy (money-priced, unlocked by points): the four replay accelerators are priced at
    // the first minutes of a 5–10 point replay (see the Legacy rungs note above)
    'legacy-archive': { cost: 1000 },
    'founders-blueprints': { cost: 5000 },
    'veteran-planners': { cost: 12000 },
    'dynasty-ledger': { cost: 25000 },
    'institutional-memory': { cost: 1e6 },
    'city-archives': { cost: 5e7 }, // city 4, mid-city
    'standing-orders': { cost: 6.8e12 }, // city 21
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
