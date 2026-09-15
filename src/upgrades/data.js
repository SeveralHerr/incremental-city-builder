// Upgrade definitions for Metropolis. DOM-free, pure data + tiny pure functions.
//
// Every entry: { id, name, icon, desc (≤70 chars, states the exact effect), cost, category,
//   tier, currency? ('money' by default, 'legacy' for charter perks), unlock(state, derived)
//   -> boolean, unlockHint (string), unlockAt? (data mirror of the rule for progress bars),
//   effect(mods, state) -> void }
//
// Effects only mutate the mods bag (see src/core/mods.js). Unlock rules read state counts,
// population, earnings this run, prestige legacy and latched milestone flags — never the
// clock. Each milestone check has a direct-state fallback so the ladder works even if the
// simulation module names a milestone differently; the flags below are the ids we expect
// simulation to latch as `state.unlocks['m:' + id]`.
//
// Unlock hints: every helper factory below (hasBuilt, hasPop, hasEarned, hasLegacy, owns, …)
// tags the rule it returns with `.hint` (plain English) and, where the rule is a single
// measurable threshold, `.at` (the same shape src/buildings/data.js uses for `unlockAt`:
// {pop} | {powerDemand} | {legacy} | {legacyAvailable} | {earned} | {building, count} |
// {upgrade} | …). The `withHints` pass at the bottom copies them onto each definition as `unlockHint` /
// `unlockAt`, so the UI can show the next locked ideas with a progress bar like the building
// cards, without every definition spelling the hint out twice. Hand-written rules carry an
// explicit `unlockHint`.
//
// Prices: src/balance/config.js owns every shipped price (`config.upgrades[id]`, merged by
// index.js before registering) and the balance builder retunes it without touching this
// file. Every literal below that config overrides is a copy of the config price (checked
// by upgrades.test.mjs, "data.js literals match config": a drift fails the test), so the
// file reads true on its own and a missing config still gives the tuned game. After a
// balance pass, copy the new prices in — or the test says which ones moved. Measured
// numbers in the comments are from logs/sim-final.json (12 h greedy bot, 2026-09-07).
//
// The ladder has six parts:
//   • the core ladder, $25 → $2e7: the first city's rungs, unlocked by what the city has
//     built (shops, parks, plants …) *and* the treasury holding the price (`funded`, the
//     hold door — see "the funded door" below) — all but four GOAL cards (Welcome Sign,
//     Grid Substations, Regional Airport, Breeder Reactors), which open on their economy
//     gate alone and are the far target the Upgrades panel shows while the funded rungs
//     arrive as they can be paid for. Institutional Memory (tiers 1–2, city 3), the Grid
//     Charter (tier 3, city 6) and Standing Orders (the Legacy rungs, city 21) grant the
//     ladder back at every founding, so a replay starts at the decisions below;
//   • the fleet ladder (`fleet: true`, see "the fleet ladder" below): twenty-four tier-4
//     core rungs in four columns (arcologies, financial districts, tech campuses, fusion
//     reactors) that open once this city owns 60 / 90 / 115 / 140 / 160 / 180 of the
//     building and the treasury holds the price. Tier 4 is in no keeper's rule, so every city buys them
//     again: they are the content of a replay's plateau, where nothing else opens (F1);
//   • the pace ladder (`pace: true`), nine tier-4 rungs from $74M to $1.5Qa placed one per
//     city by the balance builder: each opens once this run has earned a hundred times its
//     price (`earnedGate: PACE_GATE`, see `earnedUnlock`). That is the point at which the
//     replay's cash — a few seconds of income in a mature city — is about to reach it, so a
//     pace rung arrives as a reward that can be funded on the spot, not a card that sits
//     "almost affordable" for twenty minutes (measured: the greedy bot buys each pace rung
//     for the first time when the city has earned 100–130× its price);
//   • the frontier ladder (`frontier: true`), nine fixed-dollar rungs from $49.9M to $5.09Qa
//     (Dyson Swarm … Helios Array … Exchange Ring), each opening once this run has earned a quarter of its
//     price (`earnedGate: FRONTIER_GATE`). Deliberately uneven (×1.1–1,900 apart — the
//     balance builder places them by city, see config.js): with the pace rungs hidden until
//     they are affordable, the cheapest frontier rung is the money target the Upgrades panel
//     shows, and its spacing is what keeps that target 30 s – 15 min of income away instead
//     of an "almost there" card, for most of a replay. The design sketch's ×10 from $1e13 to
//     $1e18 is what these rungs were before the first balance pass; the ×10 spacing never
//     shipped;
//   • the Legacy rungs (category 'prestige'): unlocked by legacy points (the whole bank,
//     spent or not), paid in money each run. The three dear ones — Institutional Memory
//     ($30M), City Archives ($2T) and Standing Orders ($4T) — also carry the frontier's
//     earnings door (`legacyGate`, see `legacyFrontier`): the points alone opened Standing
//     Orders in the 9th replay city and parked a $4T card as the only visible money target
//     for four hours (measured: 60–80% of the samples in cycles 20–24 had the next upgrade
//     over 15 min of income away), so each waits until this run has earned a quarter of
//     its price, the same rule as the frontier;
//   • the Charter perks (category 'charter', currency 'legacy'): twelve permanent perks
//     bought with legacy points (core's api.buyUpgrade debits state.prestige.spent; the
//     income bonus keeps using the whole bank). Costs run ×2.5–4 apart from 3 to 150,500
//     points (whole points, never under ×2.5), each opening once the *spendable* bank —
//     legacy − spent, the same number core's canAffordUpgrade checks — holds half its
//     price, and every one is a real jump: +50–200% income, +50–100% housing, +50% power,
//     −15% cost. The bot signs the Imperial Charter in its 32nd replay city (measured:
//     cycle 33 of 34 in 12 h); the unlock rule and tier bracket follow the config price
//     (`charterUnlockFor`). A founding wipes state.upgrades, so index.js grants every owned
//     perk back the moment a city is founded (`keptUpgradeIds` is the pure rule).
//
// All five self-priced gates (frontier cost/4, pace cost×100 or hold the price, funded core
// rungs' hold door, the dear Legacy rungs' earnings door at cost/4, charter cost/2) are
// rebuilt by index.js after a config override, so a retuned price moves its gate, hint and
// progress mirror with it.
//
// Nothing here reads the run clock: content gates on the economy, never on elapsed time.
//
// Power (docs/FEEDBACK.md F2, the 2026-09-14 lever map, round 3): the global power stack is
// bounded over a whole session, not only over the first twelve hours. With every money
// rung and every charter perk owned the global supply rungs multiply to ×5.49 — Grid
// Substations ×1.25 · Dyson Swarm ×1.25 · Orbital Solar ×1.25 · Grid Charter ×1.5 · Energy
// Charter ×1.5 · Helios Array ×1.25 — and the global demand terms to ×0.736: Smart Grid 0.8
// · Superconductor Grid 0.8 (the one late demand cut) · the Energy Charter's draw ×1.15;
// net ×7.5 (pinned by upgrades.test.mjs, "full-stack fold"; round 2 read ×8.6 with the
// Energy Charter demand-neutral, round 1 ×29). On top of that, per city and never across a
// founding, the fleet ladder's six draw rungs — Trading Floors II/IV/VI and Campus Expansion
// II/IV/VI/VI, ×1.07 each, ×1.50 per city (see "the fleet ladder") — so a late city that owns
// everything draws ×0.736 · 1.50 = ×1.105 of its stickers under ×5.49 the supply. That is
// the invariant as of wave 3: the late grid runs ~10 % OVER sticker, deliberately, so the
// last third of a plateau binds (at net ×1.000 the greedy read 0.8 % of a 12 h
// session under power against a 3–20 % contract — power had stopped mattering). The
// bare curve falls ×0.9 per city (below), which is why the post-stack plateau reads
// 1.6–2.0× and not 5×. That 1.6–2.0× is the accepted late surplus: docs/DESIGN.md names it,
// and the contract line is the ratio the player sees (≤ 4.0 and ≥ 1.0 in every hour of a
// 24 h human session, tools/economy-sim.mjs), with the fold above as its pinned mechanism.
// Every other late demand cut (round 1's Stellar Engine 0.8, Energy Charter 0.75, Shipyard
// 0.85) was ∞-payback on a grid holding 2–13× its draw and is gone; the Stellar Engine and
// the Energy Charter carry flat happiness instead (felt on every tick at +3–5 % income and
// growth in a city at h≈2), the Shipyard an industry discount.
//
// Why a draw on the Energy Charter and on the mid-fleet rungs, and nowhere else: both bots
// (and the grid-ahead player, whose build card prints the strain rule and "×N now") buy a
// plant the moment the grid is short, so power binds for as long as the cheapest generator
// is unaffordable and not a second longer — round 2 read under-power in 0.06–0.67 % of
// ticks from hour 3 in every profile. A demand step is therefore felt only where the
// reactors that cover it cost minutes of income, not seconds and not hours: at fleet
// 90–180 (the II/IV/VI gates) a +7 % step is 7–20 more reactors, 5–15 min of
// income on a
// plateau wallet that holds 4–10 s of it, and the need rule buys out of it. Measured
// (round 2, human, on the four-gate ladder): rung II crosses at run-min 54/62 in city 5 and
// 16/18 in city 6, the 130 rung
// at 39/49 in city 7 and 10/12 in city 8 — mid-plateau, unit price 100–300 s of income;
// the greedy crosses 130 mid-plateau in cities 13–19 (hours 4–6). Rung I lands in the
// founding spree (a draw there is inside the spree's own strain); rung VI at fleet 180+ was
// the doubtful one — 15 more reactors are hours of income there (count 180+ costs ×1.112 per extra
// reactor): the Ringworld District's ×1.5 draw was measured there in round 2 — 46 min of
// Lights Out in the human's city 9, cap/demand 0.71–0.76 for greedy cities 25–28 (26.6 %
// of the session under-powered; ×1.25 draws 18 %, ×1.15 14 %) — and rejected; a ×1.07 step
// there is a twentieth of that, and measured (wave 3) it costs the greedy's cities 27–28
// 344 / 312 s under power with the median grid still at 1.00, which is what the contract
// asks for. The Energy
// Charter is the one supply rung a 24 h session still buys late (human city 11, greedy 28)
// and round 2 read 1.83 / 1.96 / 2.23 in the human's cities 11–13 with it demand-neutral,
// so its ×1.5 (the perk floor the charter test holds) carries a ×1.15 draw and lands as net
// ×1.30. Effects read only the mods bag — they cannot see derived.powerRatio — so a
// surplus-conditional rung is not available here.
//
// Measured on the round-3 tree (strain-aware human guard, 12 h, scratch runs under a
// preload that put the 1× fleet prices into config); superseded by the sweep beside
// FLEET_DRAW, kept because it is the reasoning the ×1.3-per-city figure above comes from:
// with FLEET_DRAW 1.08 the human reads
// Lights Out ≥ 30 s at ≤ 0.95 in cities 7 (224 s) and 8 (72 s) — city 7 falls 1.11 → 1.03
// at Trading Floors III (run-min 73) → 0.93 at Campus Expansion III (86) and climbs back
// to 0.98 over 10 min, city 8 1.09 → 1.00 → 0.94 at III (25) → 1.00 in 5 min; cities 5–6
// take the rung-II draws inside a 1.3–1.8 float with no dip; and with the draws stripped
// (control, same bot) Lights Out is 0/9 with hours 5–12 floating 1.54 → 1.02 — so the pass
// is content, not the guard. The same draws fail the greedy: its district and campus fleets
// sit between the 90/130 gates and the 180 gate for the whole of cities 20–27, so II/III
// are spree buys there — a permanent ×1.36 on a float of 1.28 → 1.01 whose reactors the
// buildings' quadratic strain outruns — and those eight cities read cap/demand 0.99 → 0.77
// with 20–40 min under power each: 33.5 % of the session (contract 3–20 %; control 3.8 %).
// The whole curve, per-rung draw → greedy session under-power / human Lights Out cities:
// none 3.8 % / 0 · ×1.04 16.9 % (hours 8–9 median 0.99 / 0.94) / 0 · ×1.06 27.3 % / 0 (36 s
// under 1 in city 8) · ×1.08 33.5 % / 2; rung IV cancelling II+III (×0.86) 29.8 % — the
// greedy's cities 20–25 never reach IV; a draw fading at 180 reactors 28.2 % — those cities
// own fewer than 180; Reactor Refits II/III at ×1.15 as the supply twin 23.7 %. No value of
// a count-gated draw meets both profiles: the human needs ≥ ×1.3 per city to cross its
// city-7 float, the greedy tolerates ≤ ×1.17.
//
// That round-3 curve was read on the earlier lp-0.54 ladder and does NOT describe this
// tree; the integrator re-swept FLEET_DRAW on the shipped prices and found the greedy under
// the floor rather than over the ceiling (0.8 % of a 12 h session against 3–20 %). The
// current curve and the decision live beside FLEET_DRAW below. FLEET_DRAW ships at 1.07 on
// six rungs.
//
// Why the bare grid is not level: the human profile's rotation buys generators at a fixed
// fifth of the wallet, and its cap/demand falls about ×0.9 per city as the fleet climbs
// the plant price curve (measured 12 h: the by-city medians 1.54 1.66 1.53 1.33 1.17 1.07
// for cities 4–9 under a constant ×3.66 mid stack are a bare 0.42 → 0.29; extrapolated to
// city 13 ≈ 0.19), so a session needs a stack that keeps rising through cities 9–13 just
// to stay ≥ 1.0. The per-plant rungs (turbine blades ×2, scrubbers ×1.5, sun-tracking ×2,
// Breeders ×2) stay as they are: they are the first city's cadence; the six Reactor
// Refits (fleet ladder, fusion ×1.053 each, ×1.36 per city) are per-building and re-bought
// every city.
//
// Growth (F7, round 3): population fills its housing within seconds everywhere past the
// first ten minutes, so a "grows faster" clause is felt only where pop/housing is under
// 1.0 when the rung is bought. The rule: a growth clause ships only where the measured
// pop/housing at purchase is < 0.9. Measured (round 2, greedy and human): the Welcome Sign
// 0.30 (city 1, minute 0 — the one growth rung that binds, kept) and 1.00 (or 0.00, an
// empty replay plot at the founding tick) for every other growth-titled rung — Green
// Belts, Veteran Planners, the Planetary Charter, the City Archives — which now carry
// clauses felt where they are bought: Green Belts cottages +25 % residents (the first city
// is housing-bound at minute 8, so more housing is more taxpayers within a minute; sized
// against the first city's clock, see its note), Veteran Planners tier 1–2 buildings −25 % (a replay's first
// minute, ~nil after), the Planetary Charter income only, the City Archives an employer
// discount (per building, felt at the price cliff where jobs are bought, so the Standing
// Orders re-grant compounds nothing global). Community Events (minute 3, growth ×1.25) and
// the Settlers' Charter (growth ×2 · inflow ×3) keep their growth terms this round,
// unmeasured against the rule; they are the two rungs that keep 'growth' in the ladder's
// lever list. The three earlier ones (Express Transit, Welcome Center, Preventive Care)
// carry a discount on the employers of the moment, per-building jobs, a civic discount —
// near-nil in a replay (tier-1/2/3 employers are <0.1% of a replay's jobs), so nothing
// compounds through the Grid Charter / Institutional Memory re-grants.
//
// Housing (F3, round 3): a global housing rung with no jobs term is an instant unemployment
// cliff (pop fills the new housing in seconds; the jobs to match cost a marginal district
// each — measured pre-wave: 68 % jobless for an hour on the human profile), so the housing
// rungs carry jobs terms, sized so that every complete city ≥ 4 reads 0.85 ≤ jobs/pop ≤ 1.3
// in all three profiles and unemployment is a band the jobs rule buys back over minutes,
// not a stat pinned at 0. The whole-session fold: global housing ×37.5 (Tourism Board 1.25
// · Homestead 1.5 · Megastructures 2 · Ringworld 2.5 · Skyline 2 · Exchange Ring 2)
// against global jobs ×21.1 (Modern Curriculum 1.25 · Megastructures 1.5 · Gardens 1.2 ·
// Archives 1.25 · Ringworld 2.0 · Skyline 2.0 · Shipyard 1.25 · Exchange Ring 1.5), with
// the Orbital Ring's pop-synergy jobs and the per-building terms (Blueprints ×1.569 arcology
// housing, Trading Floors / Campus Expansion ×1.569 jobs, Gardens ×1.5 arcology housing) on
// top. Round 2 folded global jobs to ×13.8 (the Civic Charter's ×1.25 in, the late housing
// rungs at ×1.5 / ×1.5 / commerce-only ×2, the Shipyard ×1.75) and read, step by step on
// the greedy's own by-city line: 1.20 → Civic 1.56 → Ringworld (×0.6) 0.95 → Skyline
// (×0.75) 0.72 → Shipyard (×1.75) 1.33 → Exchange Ring (×0.61) 0.81 — cities 21–24 at 1.56
// and 26–29 at 0.72–0.76 (24–28 % jobless), the human's city 9 at 1.54 and its 24 h cities
// 10–13 at 0.75–0.87. Round 3 moves the jobs onto the housing rungs that need them: the
// Civic Charter loses its jobs term (it landed on a 1.24 city), the Ringworld District and
// the Skyline Charter go to jobs ×2.0 (steps ×0.8 and ×1.0), the Exchange Ring's
// commerce-only ×2 becomes all jobs ×1.5 (step ×0.75), and the Orbital Shipyard is trimmed
// to ×1.25 so its city stays under 1.3 — by arithmetic 1.25 → 1.0 → 1.0 → 1.25 → 0.94 on
// the greedy, and 1.23 (city 9) → ≈ 1.1–1.2 → ≈ 1.05–1.15 on the human. The pairs now:
// Megastructures housing ×2 · jobs ×1.5 (the city-15 cliff fix), Arcology Gardens arcology
// ×1.5 (~+45 % housing) · jobs ×1.2, the City Archives jobs ×1.25 with an employer
// discount. The unemployment band (2–15 % in ≥ 3 of hours 3–12) is made by the housing
// steps a never-saver buys mid-plateau: round 2 met it only in hour 7, where Megastructures
// and the Gardens landed mid-city 7 and the jobs rule bought the step back over 45 min
// (10 % → 7 % → 4 %); the Arcology Blueprints are the only mid-plateau housing steps in
// cities 4–9, and at ×1.08 per rung they never pushed a 1.2–1.3 jobs/pop city under 1.0.
// Swept on the human profile, 12 h, with the rest of round 3 in: ×1.15 (×1.75 per city)
// read city 7 — where Megastructures, the Gardens and Blueprints I–III all land — at
// jobs/pop 0.83 with hour 7 at 18 % jobless (both over the line) and band hours 6/11/12;
// ×1.12 (×1.57 per city) reads jobs/pop by city 1.24 1.12 1.21 0.87 1.14 0.97 for cities
// 4–9, unemployment 13 % in city 7 and 3 % in city 9, hours 7/11/12 at 14/4/3 % inside the
// band and no hour over 15 % — a +12 % housing step on a 1.05–1.25 city is the 2–8 %
// jobless stretch the jobs rule buys back over 20–40 min, so the ×1.57 PER-CITY fold ships.
// Wave 3 splits that same fold over six rungs instead of four (×1.078 each, ×1.569 per
// city): the per-city housing step the sweep measured is unchanged to 0.3 %, and each
// individual step is smaller, so the jobless spike a Blueprint opens is shallower and the
// jobs rule buys it back sooner. (The balance
// builder re-sweeps through probe.mjs --boost on the final tree.) What the re-pairing
// costs as pace, measured on the greedy with the draws stripped: the round-2 jobs stack
// under everything else in round 3 reads 34 foundings / 530,923 legacy / money peak
// 4.30e17 (round 2's own numbers) with cities 25–28 at 30–36 % jobless; the round-3 stack
// reads 36 / 1,040,900 / 2.35e18 — employing a late city's jobless quarter is +30 % income
// there, and it compounds through the foundings into ×2 legacy and ×5 money, over both
// ceilings (legacy ≤ 1e6, money ≤ 1e18); the saver reads 37 / 1,465,022 / 3.32e18. No
// smaller stack holds the 0.85 floor on the greedy's own by-city line (Ringworld 2.0 ·
// Skyline 2.0 · Shipyard 1.0 · Ring 1.75 is the least, ×19.7, and lands at 0.875), so the
// F3 band and the magnitude ceilings are in tension on the greedy: the lever is the late
// economy's pace (the tail placement, the late employer incomes, prestige.firstBonus —
// balance and the simulation mirror), not the jobs terms.
// The bots' jobs rule is binary — 0 % while an employer is
// affordable, stuck once the employers are at the price cliff — so every trim here is a
// knife edge; the smaller trims round 2 asked for (Gardens ×1.1, Shipyard ×1.5, Archives
// ring housing) were each measured and each put whole cities over 20 %.
//
// Happiness: `mods.happiness` is added to the final happiness value *after* the civic
// curve (resources: 1 + civic − penalties + mods.happiness), so "Happiness +10%" is exactly
// what the chip shows. Per-building happiness adds (byBuilding.happiness) are not used
// here on purpose: they feed the saturating civic sum, civic = 1.25·(1 − e^(−Σ/1.5)), and
// past three parks and a school that sum is already near the cap, so a "+6% per hospital"
// rung measured +0.01–0.05 happiness in the sim — a desc that reads as a promise the
// curve never keeps. Flat happiness is worth the most while happiness is low (+0.1 at
// h≈0.85 is ~+6% income and growth; at the h≈2–2.8 of a late city it is ~+3–5%), so the
// three rungs that open while a city is still unhappy carry it — Community Events and
// Green Belts in the first ten minutes, Veteran Planners in a replay's jobless opening
// minute — each paired with a clause felt where it is bought (growth, first-city housing,
// a tier-1–2 discount; header "Growth"), and two late rungs carry it as the
// felt replacement for a demand cut that paid nothing on a grid holding 2–13× its draw
// (header, "Power"): the Stellar Engine +10% and the Energy Charter +15%. 0.5 in total
// against the 3.0 cap, so civic buildings — not upgrades — still decide happiness.
// Everything else late (Modern Curriculum, Preventive Care, the Civic Charter) moves
// jobs, growth, cost or income.
import { buildingMod } from '../core/mods.js';

export const MILESTONE_IDS = [
  'pop-100',
  'pop-1k',
  'pop-10k',
  'pop-100k',
  'money-1k',
  'money-100k',
  'money-1m',
  'money-1b',
  'brownout',
  'first-upgrade',
  'buildings-100',
  'prestige-1',
];

export const UPGRADE_CATEGORIES = [
  { id: 'residential', name: 'Residential', icon: '🏠', color: '#60a5fa' },
  { id: 'commercial', name: 'Commercial', icon: '🏪', color: '#4ade80' },
  { id: 'industrial', name: 'Industrial', icon: '🏭', color: '#fb923c' },
  { id: 'power', name: 'Power', icon: '⚡', color: '#facc15' },
  { id: 'civic', name: 'Civic', icon: '🏛️', color: '#c084fc' },
  { id: 'global', name: 'City Hall', icon: '🏙️', color: '#e2e8f0' },
  { id: 'prestige', name: 'Legacy', icon: '🌟', color: '#fbbf24' },
  { id: 'charter', name: 'Charter', icon: '⚜️', color: '#f59e0b' },
];

// Building names for hint text (singular, plural), matching src/buildings/data.js.
const BUILDING_NAMES = {
  house: ['Cottage', 'cottages'],
  apartment: ['Apartment Block', 'apartment blocks'],
  tower: ['Residential Tower', 'residential towers'],
  arcology: ['Arcology', 'arcologies'],
  shop: ['Corner Shop', 'corner shops'],
  office: ['Office Block', 'office blocks'],
  mall: ['Shopping Mall', 'shopping malls'],
  financial: ['Financial District', 'financial districts'],
  factory: ['Factory', 'factories'],
  refinery: ['Refinery', 'refineries'],
  techpark: ['Tech Campus', 'tech campuses'],
  windmill: ['Windmill', 'windmills'],
  coal: ['Coal Plant', 'coal plants'],
  solar: ['Solar Farm', 'solar farms'],
  nuclear: ['Nuclear Plant', 'nuclear plants'],
  fusion: ['Fusion Reactor', 'fusion reactors'],
  park: ['City Park', 'city parks'],
  school: ['School', 'schools'],
  hospital: ['Hospital', 'hospitals'],
  stadium: ['Stadium', 'stadiums'],
};
const buildingName = (id, n) => {
  const names = BUILDING_NAMES[id] || [id, id + 's'];
  if (n !== 1) return `${fmtInt(n)} ${names[1]}`;
  return `${/^[aeiou]/i.test(names[0]) ? 'an' : 'a'} ${names[0]}`;
};
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
// Short money for hints: $1,000 · $1M · $1B · $20B · $1T · $2.5Qa (same suffixes as core/format).
const MONEY_UNITS = [[1e18, 'Qi'], [1e15, 'Qa'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M']];
export const fmtMoney = (n) => {
  for (const [v, u] of MONEY_UNITS) {
    if (n >= v) {
      const x = n / v;
      return '$' + (Number.isInteger(x) ? x : +x.toFixed(1)) + u;
    }
  }
  return '$' + fmtInt(n);
};

// ---------- unlock helpers (all tolerate partially-built state/derived) ----------

const count = (state, id) => (state && state.buildings && state.buildings[id]) || 0;
const pop = (state) => (state && state.res && state.res.pop) || 0;
const earned = (state) => (state && state.stats && state.stats.totalEarned) || 0;
const built = (state) => (state && state.stats && state.stats.buildingsBuilt) || 0;
const legacy = (state) => (state && state.prestige && state.prestige.legacy) || 0;
// Spendable legacy: the bank less what charter perks have already cost, floored the way
// core's api.legacyAvailable floors it (so the gate and the Sign button agree to the point).
const legacyAvailable = (state) => {
  const p = state && state.prestige;
  const bank = p && Number.isFinite(p.legacy) && p.legacy > 0 ? Math.floor(p.legacy) : 0;
  const spent = p && Number.isFinite(p.spent) && p.spent > 0 ? Math.floor(p.spent) : 0;
  return Math.max(0, bank - spent);
};
const milestone = (state, id) => !!(state && state.unlocks && state.unlocks['m:' + id]);
const ownedUpgrades = (state) => (state && state.upgrades ? Object.keys(state.upgrades).length : 0);

// Tag a rule with its hint (and optional data mirror) so definitions can inherit them.
const rule = (fn, hint, at) => {
  fn.hint = hint;
  if (at) fn.at = at;
  return fn;
};
// Names for the hint sentence: "Own Orbital Solar" needs the upgrade's name, which is
// declared later in this file, so `owns` resolves it lazily through this table.
const NAME_OF = {};
const upgradeName = (id) => NAME_OF[id] || id;

const owns = (id) => {
  const fn = (state) => !!(state && state.upgrades && state.upgrades[id]);
  Object.defineProperty(fn, 'hint', { get: () => `Own ${upgradeName(id)}`, enumerable: true });
  fn.at = { upgrade: id };
  return fn;
};
const hasBuilt = (id, n) => rule((state) => count(state, id) >= n, `Build ${buildingName(id, n)}`, { building: id, count: n });
const cash = (state) => (state && state.res && state.res.money) || 0;
const holds = (n) => rule((state) => cash(state) >= n, `hold ${fmtMoney(n)}`, { money: n });
const hasPop = (n, ms) => rule((state) => pop(state) >= n || (ms ? milestone(state, ms) : false), `Reach ${fmtInt(n)} citizens`, { pop: n });
const hasEarned = (n, ms) =>
  rule((state) => earned(state) >= n || (ms ? milestone(state, ms) : false), `Earn ${fmtMoney(n)} in this city`, { earned: n });
const hasLegacy = (n) =>
  rule(
    (state) => legacy(state) >= n || (n <= 1 && milestone(state, 'prestige-1')),
    n <= 1 ? 'Found a new city' : `Bank ${fmtInt(Math.ceil(n))} legacy points`,
    { legacy: n }
  );
// Charter gate: spendable points, not the bank — a perk that reads "open" can be signed
// the moment its price is spendable, and the hint counts toward that same number.
const hasLegacyAvailable = (n) => rule((state) => legacyAvailable(state) >= n, `Have ${fmtInt(Math.ceil(n))} spendable legacy points`, { legacyAvailable: n });
const hasDemand = (mw) =>
  rule((state, derived) => !!derived && Number.isFinite(derived.powerDemand) && derived.powerDemand >= mw, `Draw ${fmtInt(mw)} MW of power`, {
    powerDemand: mw,
  });
const hasBuiltTotal = (n) => rule((state) => milestone(state, 'buildings-100') || built(state) >= n, `Build ${fmtInt(n)} buildings in total`, { built: n });
const hasAnyUpgrade = () => rule((state) => milestone(state, 'first-upgrade') || ownedUpgrades(state) >= 1, 'Fund any upgrade', { upgrades: 1 });
// Combinators join the hints ("A or B", "A and B"). `any` carries the first rule's data
// mirror (the easiest door in is the one worth a progress bar). `all` carries the first
// *measurable* one — a mirror that counts toward a threshold ({pop}, {legacy}, …) rather
// than an ownership flag ({upgrade}), since every gate must open and a bar that reads 100%
// against a card that stays locked on the other condition is worse than no bar.
const lower = (s) => (typeof s === 'string' ? s.charAt(0).toLowerCase() + s.slice(1) : '');
const joinHints = (fns, word) => {
  const parts = fns.map((f) => f.hint).filter(Boolean);
  return parts.map((p, i) => (i === 0 ? p : lower(p))).join(` ${word} `);
};
const measurable = (at) => !!at && typeof at === 'object' && !('upgrade' in at);
const any = (...fns) => {
  const fn = (state, derived) => fns.some((f) => f(state, derived) === true);
  Object.defineProperty(fn, 'hint', { get: () => joinHints(fns, 'or'), enumerable: true });
  if (fns[0] && fns[0].at) fn.at = fns[0].at;
  return fn;
};
const all = (...fns) => {
  const fn = (state, derived) => fns.every((f) => f(state, derived) === true);
  Object.defineProperty(fn, 'hint', { get: () => joinHints(fns, 'and'), enumerable: true });
  const pick = fns.find((f) => measurable(f.at)) || fns.find((f) => f.at);
  if (pick) fn.at = pick.at;
  return fn;
};

// ---------- the funded door: the core ladder's rungs open when they can be paid for ----------
//
// A core rung carries two doors and needs both: its economy gate (`gate`: "Build 15 corner
// shops", "Reach 120 citizens" …) and the treasury holding its price. The gate is the
// story and is met minutes before the cash is (measured: every count gate in the first
// city opens its card at 1–17 s of income, then the card sits "almost affordable" for
// 5–12 minutes while the bot's cash hovers at 4–6 s of income); the money door is the
// one that opens last, so the card arrives the moment it can be funded, and the mirror
// counts the treasury toward the price. What that buys is the first city's four GOAL
// cards — the Welcome Sign, Grid Substations (open at 10 MW, minute 2), the Regional
// Airport (1,000 citizens, minute 12) and Breeder Reactors (10,000 citizens, minute 28) —
// which open on their economy gate alone: with the rungs between them hidden until
// fundable, the cheapest open card is always a far target instead of the next reflex buy
// (measured with the greedy bot: the cheapest open card was 30 s – 15 min of income away
// in 0 of 41 first-city minutes before this door, 20 of 42 after it; the founding clock
// is unchanged — 42.5 min — because every funded rung is bought the moment its cash is
// there, exactly as before).
// `holdUnlock` is the one place the rule lives: index.js rebuilds it after a config
// override so the money door follows the registered price (a founded rung keeps `gate`).
export function holdUnlock(def) {
  const cost = def && Number.isFinite(def.cost) && def.cost > 0 ? def.cost : 0;
  const gate = def && typeof def.gate === 'function' ? def.gate : null;
  const hold = holds(cost);
  const fn = gate ? all(gate, hold) : hold;
  const hint = gate && gate.hint ? `${gate.hint}, then ${hold.hint}` : hold.hint;
  return { unlock: fn, unlockHint: hint.charAt(0).toUpperCase() + hint.slice(1), unlockAt: { money: cost } };
}
const funded = (def) => ({ ...def, hold: true, ...holdUnlock(def) });

// ---------- effect helpers ----------

const incomeOf = (id, mult) => (mods) => {
  buildingMod(mods, id).income *= mult;
};
const housingOf = (id, mult) => (mods) => {
  buildingMod(mods, id).housing *= mult;
};
const jobsOf = (id, mult) => (mods) => {
  buildingMod(mods, id).jobs *= mult;
};
const powerOf = (id, mult) => (mods) => {
  buildingMod(mods, id).power *= mult;
};
const costOf = (id, mult) => (mods) => {
  buildingMod(mods, id).cost *= mult;
};
// Flat city-wide happiness (see the header): happiness is a multiplier around 1.0 that the
// UI shows as a percentage, so +0.1 is written "Happiness +10%" and lands exactly so.
const happier = (add) => (mods) => {
  mods.happiness += add;
};
const global = (key, mult) => (mods) => {
  mods[key] *= mult;
};
const compose = (...fns) => (mods, state) => {
  for (const f of fns) f(mods, state);
};
// Upgrades whose whole effect is structural (kept upgrades, see FOUNDING MEMORY) change no
// modifier; the mods bag is left exactly as it came.
const noEffect = () => {};

// Building groups for the per-sector rungs (ids match src/buildings/data.js).
const INDUSTRY = ['factory', 'refinery', 'techpark'];
const COMMERCE = ['shop', 'office', 'mall', 'financial'];
const incomeOfEach = (ids, mult) => compose(...ids.map((id) => incomeOf(id, mult)));

// ---------- the fleet ladder: count-gated rungs, re-bought every city (docs/FEEDBACK.md F1) ----------
//
// A replay's purchases sit on the pace rungs' 100×-earned door and on cash spikes (the
// wallet holds 4–10 s of income; the cheapest open rung is a median 0.3–0.6 min away from
// city 5 on), which spaces them ×2–3 apart in time: measured on the human profile before
// this ladder, upgrade buys inside cities 4–9 came at run-minutes 1 2 4 8 15 50 · 1 7 20 27
// 44 · 6 7 13 35 · 2 11 31 33 66 · 7 19 34 58 110 · 17 108 — 27–91 min gaps and 23–45 min
// tails. Fleet size is the one quantity that keeps growing through a city for a player
// who never saves (the rotation buys the lowest-count building in each category, so the
// four columns grow together, ~20–25 units per column per city on the plateau), so a
// count gate puts a purchase on the plateau where nothing else opens. Twenty-four tier-4
// core rungs, four columns × FLEET_GATES: Arcology Blueprints (arcology housing ×1.078
// each), Trading Floors (district jobs ×1.078), Campus Expansion (campus jobs ×1.078),
// Reactor Refits (fusion output ×1.053); rungs II, IV and VI of the two employer columns also
// draw +7 % city-wide (FLEET_DRAW). Each is `funded` — it opens on the count *and* the
// treasury holding the price — and tier 4 is in no keeper's rule (Institutional Memory
// tiers 1–2, the Grid Charter and Standing Orders tier 3), so a founding takes all
// twenty-four and every city buys them again.
//
// WHY THE HOLD DOOR STAYS, and why this ladder can never close F1(b)'s decision-gap line
// (measured, wave 3, and the finding that decided this round). The gap metric
// (tools/economy-sim.mjs:594) counts a purchase as a DECISION only when the rung was ≥ 30 s
// of income out of reach at the moment its unlock latched, and a `funded` rung's reach at
// unlock is 0 by construction — so the plan for this round was to drop the door and let the
// count alone open the card. Built and measured (human profile, 6 h, against 1c3ebfa run
// the same way):
//   decision gap, cities 4–6   61.3 / 76.1 / 48.1 min  →  58.9 / 76.7 / 46.0   (noise)
//   all-purchase gap           28 / 18 / 23            →  27 / 21 / 20
//   reachShare, cities 4–9     48 %                    →  16 %   (target ≥ 40 %)
// The door was not what held the two lines apart. The instrumented run says why: at the
// tick each count gate opens, the rung's price is worth
//   0.9 / 3.4 / 3.8 s of income (city 7, gates 60) · 9.9 s (gate 90) · 0.2–4.6 s (city 9,
//   gates 60–90) · 9.4 s (gate 115, city 8) · 10.0–12.5 s (gate 115, city 9) · max 26.6 s
//   anywhere in cities 4–9
// — i.e. ALWAYS under the 30 s threshold, at every gate, with or without the money door. A
// fleet rung is priced in fixed dollars and re-bought every city while the human profile's
// income triples per city, so the same rung is worth 4.4 s of income in city 4 and 0.2 s in
// city 9: no static price and no arrangement of count gates can hold a constant reach. What
// would is a price that scales with the city (the gating building's CURRENT cost), and
// `cost` is a static number on the definition — a core API change, not content. F1(b) is
// therefore named as not-closable-here rather than papered over; F1(a), the city-length
// ratio, is the profile's founding rule (core) by the same kind of arithmetic.
//
// Dropping the door also costs the player the thing it was invented for: with it, an
// unlocked fleet card is affordable and is bought, so the cheapest open card is the far
// frontier target; without it, a 0.2–27 s card sits open on top of that target and
// reachShare — the share of the city spent with the cheapest open card 30 s – 15 min away —
// falls by two thirds. Measured above; that is why the funded wrapper is back.
//
// Gates: six per column, 60 / 90 / 115 / 140 / 160 / 180 (wave 3; four — 60/90/130/180 —
// through round 3). The spacing is the measured growth rate of the plateau fleet, not a
// round number: a column grows 0.79 units/min in city 4 (60 → 90 arcologies in 38 min) and
// 0.42 units/min in city 8 (130 → 180 in 118 min), so a 50-unit gap is one crossing per
// 119 min per column in city 8 — longer than the 20-min rule allows — while a 20–25-unit
// gap is one per 48–60 min, and with the four columns lagging each other by 20–30 units
// the crossings interleave. The top gate stays at 180 because the human profile never
// reaches 180 in any column inside 12 h (the four rung-VI ids are on its neverPurchased
// list) and the greedy contract asserts neverPurchased is empty, so a 190+ gate risks
// failing balance.test 19 outright; the bottom two stay at 60 and 90 because they are the
// two the FLEET_DRAW sweep was measured on.
//
// Measured on the four-gate ladder (human profile 12 h, run-minute at which each column
// crosses the count, cities 4–9 in order; "1" or "0" is the founding spree, "—" not
// reached): 60 → arcology 3/1/1/0/1/0, district 14/6/2/2/1/0, campus 16/6/3/1/1/0, fusion
// 50/21/6/4/1/0; 90 → arcology 41/17/3/1/1/0, district —/54/16/3/2/0, campus —/62/18/4/2/0,
// fusion —/—/34/10/3/0; 130 → arcology —/—/47/12/2/0, district —/—/—/39/10/2, campus
// —/—/—/49/12/2, fusion —/—/—/—/29/3; 180 → arcology —/—/—/—/120/16, district —/—/—/—/—/71,
// campus —/—/—/—/—/97 — i.e. the 130 → 180 stretch is exactly where cities 7–8 read their
// 105 and 51 min gaps, and 115/140/160 put three crossings per column inside it. Result on
// the four-gate ladder: upgrade
// purchases in cities 4–9 at run-minutes 1 2 3 4 8 14 16 17 41 49 58 · 1 6 6 7 17 20 24 31
// 52 54 61 · 1 2 2 3 6 7 8 16 16 18 34 44 47 · 1 2 3 4 4 10 12 12 37 39 40 49 78 · 1 2 2 2
// 9 9 9 12 20 28 41 69 119 135 · 2 2 3 16 20 72 97 125; the longest stretch without a
// purchase per city 23 21 22 28 50 51 min, against 41 27 29 38 70 107 on the same tree
// without this ladder — better in every city, still over the 20 min the plan asked for
// in all six: the fleet grows ~20–25 units per column per city on the plateau, so four
// gates per column cannot put a purchase in every 20-minute window of a 150-minute city.
// City lengths 64 78 70 94 148 153 min (65 80 71 96 153 160 without the ladder).
//
// Effects are small per rung and felt as a column, and the per-city fold is the SAME as it
// was on four gates — six rungs is more cadence, not more power: Blueprints ×1.078 each,
// arcology housing ×1.078^6 = ×1.569 per city (four gates: ×1.12^4 = ×1.574, −0.3 %) — the
// mid-plateau housing steps that make the unemployment band (header, "Housing": ×1.15 per
// rung was swept and put city 7 over both lines); Trading Floors and Campus Expansion
// ×1.078 jobs each (×1.569 per column), worth nothing at 0 % unemployment and what refills
// the jobs after a Blueprint raises the population, and rungs II, IV and VI of both carry a
// +7 % city-wide draw on rungs II, IV and VI (×1.07^6 = ×1.50 per city across the six;
// header, "Power": three fleet sizes — 90, 140 and 180 — so the bite is spread over four
// hours of a greedy session instead of concentrated in three cities) — rungs I, III and V
// draw nothing (I lands in the founding spree, where a step is inside the spree's own
// strain); Reactor Refits ×1.053 each (×1.053^6 = ×1.362 per city
// against ×1.08^4 = ×1.361, +0.1 %) save a plant on a grid that binds. Not nil as pace, measured
// on the round-2 tree: the ladder took the greedy's 12 h session from 32 foundings /
// 270,655 legacy / money peak 1.78e17 to 34 / 530,227 / 4.23e17 (a few percent per city
// compounds through thirty foundings), the saver from 35 / 745,592 to 35 / 743,643 — both
// under the 1e6 ceiling; the balance builder's placement pass owns the cadence.
//
// Prices (wave 3): the building's undiscounted unit price at the gate count on the tree's
// cost curve (knee 75, late growth 1.112; api.buildingCost(def, gate) with no mods, two
// figures — arcology 7.0e7 / 1.7e9 / 2.4e10 / 3.4e11 / 2.9e12 / 2.4e13, financial 4.1e8 /
// 9.9e9 / 1.4e11 / 2.0e12 / 1.7e13 / 1.4e14, techpark 4.6e8 / 1.4e10 / 2.0e11 / 2.8e12 /
// 2.4e13 / 2.0e14, fusion 2.3e9 / 5.6e10 / 8.0e11 / 1.1e13 / 9.5e13 / 8.0e14) — the price
// the player just paid for the unit that crossed the gate, before the cost stack of cities
// 4–9 (×0.5). Round 2 shipped a quarter of that and measured every rung within 30 s of its
// gate (p90 0.1 min): a card that lights when the cash is already there is a notification,
// not a decision. At the unit price (measured, round 2, human profile, whose wallet holds
// 2–10 s of income) 24 of 68 fleet rungs were bought more than 2 min after their gate, p50
// ~1–2 min, p90 15 min — the 30 s – 15 min-away target the contract's reachShare counts,
// on the plateau where nothing else opens (at twice the unit price 24 of 63, p90 30 min,
// max 94; at half 16 of 72, p90 5.4). Those delays are what the wallet does; the DECISION
// metric reads reach at UNLOCK, which the hold door pins at 0 — see above for why that is
// not the lever it looked like.
//
// What count gates still cannot buy on their own is the 20-min gap line in a 150-minute
// city: the plateau fleet grows 0.4–0.8 units per minute per column, so gates dense enough
// for a purchase every 20 min in city 8 would sit ~8 units apart — 40+ rungs per column —
// and a fixed-dollar pace rung lands once and is bought in the spree. Six gates is the
// density that fits without turning the card list into wallpaper; the structure that
// guarantees a decision every 20 minutes for a never-saver is a leveled (repeatable)
// upgrade, a core API change named for a later wave, not faked here.
// src/balance/config.js places them (config.upgrades[id]); the literals are copies, as
// everywhere in this file.
export const FLEET_GATES = [60, 90, 115, 140, 160, 180];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
// The city-wide draw the two employer columns' rungs II, IV and VI carry (gates 90, 140 and
// 180; header, "Power"): ×1.07 each, ×1.07^6 = ×1.50 per city across the six, never across
// a founding.
//
// THE DECISION (wave 3, docs/FEEDBACK.md F2 / the session under-power red line). Round 3
// shipped ×1.08 on four rungs (gates 90 and 130) and the integrator re-measured it: it
// leaves the greedy UNDER the contract's under-power floor, not over its ceiling — 0.8 % of
// a 12 h session against balance.test.mjs's 3–20 %. The integrator's note proposed ×1.12 on
// the same four rungs. Swept again here, on this round's tree, reading FOUR lines at once
// (12 h greedy: session under-power share · the median cap/demand ≥ 1.0 floor · the
// prestige-cycle ratio against plan.json's ≤ 1.345 margin · late cycles with nothing new):
//   4 rungs, gates 90 + 140
//     ×1.080  2.3 %  · floor ok · ratio ok    · 2 of 29 empty  — under the 3 % floor
//     ×1.086  2.9 %  · floor ok · ratio ok    · 1 empty        — under the floor
//     ×1.088  3.2 %  · floor ok · ratio 1.348 · —
//     ×1.090  3.1 %  · floor ok · ratio 1.348 · 0 empty        — 0 sim-contract issues
//     ×1.092  ok     · floor ok · ratio 1.355 · —
//     ×1.095  3.8 %  · floor ok · ratio >1.35 · 0 empty
//     ×1.100  4.6 %  · floor ok · ratio >1.35 · 2 empty
//     ×1.110  6.8 %  · floor ok · ratio >1.35 · 2 empty
//     ×1.120 11.2 %  · median 0.98 in h6 FAILS the floor · ratio >1.35 · 3 empty
//   4 rungs, other placements at ×1.09: gates 90 + 160 → h8 median 0.98, fails the floor;
//     gates 90 + 180 → the by-hour line clears in only 2 of hours 3–12 (needs 3);
//     gates 90 + 115 → session 0.4 %, far under the floor.
//   6 rungs, gates 90 + 140 + 180 (SHIPPED at ×1.07, ×1.50 per city)
//     ×1.060  3.0 %  · floor ok · ratio ok · 1 empty  — 0.0295, just under the floor
//     ×1.065  3.0 %  · floor ok · ratio ok · 0 empty  — 0.0298, just under
//     ×1.070  3.6 %  · floor ok · ratio ok · 2 empty  — every power line green
//     ×1.075  3.2 %  · floor ok · ratio ok · 3 empty
// Four rungs cannot hold both power and cadence on this tree: every value dense enough to
// clear the floor (≥ ×1.088) stretches the greedy's cycle 21 past plan.json's ratio margin,
// because the brownouts all land in cities 21–23 and shave that one city's income. Three
// rungs spread the same total bite over three fleet sizes — the greedy goes under power in
// hours 6–7 AND 9–10 instead of 6–8 only — so a smaller step per rung buys the same session
// share without deepening any single city. ×1.07 is the shipped point: session 3.6 %,
// by-hour ≥ 1 % in 4 of hours 3–12, median cap/demand never under 1.0, minPowerRatio 0.60,
// prestige-cycle ratio inside plan.json, variety 2 of 29 (exactly what 1c3ebfa reads).
// The band is narrow — re-read the greedy's [power] and [cadence] lines after any income
// change.
//
// The price is the module's demand invariant, re-stated rather than broken: a late city
// that owns everything draws 0.8 · 0.8 · 1.15 · 1.07^6 = ×1.105 of its stickers, not
// ×1.000. upgrades.test.mjs pins it two-sided at 1.09 ≤ demand ≤ 1.12 with the exact
// product asserted. The late grid runs ~10 % OVER sticker on purpose, so the last third of
// a plateau binds; at net ×1.0 it did not bind at all (0.8 % of a session).
//
// Why not pay for the draw with a deeper global cut and keep ×1.000: the only global demand
// cuts in the tree are Smart Grid ×0.8 and Superconductor Grid ×0.8, and both are owned in
// exactly the cities where the draw has to bite, so deepening either cancels the draw by
// construction. "Net ×1.0" IS the reason power stopped mattering. The other alternative
// the integrator named — move the demand onto a housing rung — was measured in round 2 on
// a different ladder (Ringworld ×1.5 read 26.6 % of the greedy session under power, ×1.25
// 18 %, ×1.15 14 %) and those numbers no longer describe this tree, so taking it would mean
// a second full sweep this round was told not to run.
//
// The card text moves with the effect: the II/IV/VI descs read "draw +7%". Variety (late
// cities with nothing never-before-bought) tracks this knob only through the brownouts it
// causes, and at the shipped point it reads 2 of 29 — the same as 1c3ebfa; the line itself
// is the late ladder's placement, balance's lever, not this constant.
export const FLEET_DRAW = 1.07;
const DRAW_RUNGS = [false, true, false, true, false, true];
// Per-rung multipliers are re-sized so six gates fold to the same per-city step four gates
// did: 1.078^6 = ×1.5694 against 1.12^4 = ×1.5735 (−0.3 %), 1.053^6 = ×1.3632 against
// 1.08^4 = ×1.3605 (+0.2 %). Six rungs is cadence, not power.
const FLEET_COLUMNS = [
  { id: 'arcology-blueprints', name: 'Arcology Blueprints', icon: '🏘️', building: 'arcology', category: 'residential', clause: 'Arcologies hold +7.8% residents', costs: [7.0e7, 1.7e9, 2.4e10, 3.4e11, 2.9e12, 2.4e13], effect: () => housingOf('arcology', 1.078) },
  { id: 'trading-floors', name: 'Trading Floors', icon: '🏦', building: 'financial', category: 'commercial', clause: 'Financial districts provide +7.8% jobs', costs: [4.1e8, 9.9e9, 1.4e11, 2.0e12, 1.7e13, 1.4e14], draw: true, effect: () => jobsOf('financial', 1.078) },
  { id: 'campus-expansion', name: 'Campus Expansion', icon: '🔬', building: 'techpark', category: 'industrial', clause: 'Tech campuses provide +7.8% jobs', costs: [4.6e8, 1.4e10, 2.0e11, 2.8e12, 2.4e13, 2.0e14], draw: true, effect: () => jobsOf('techpark', 1.078) },
  { id: 'reactor-refits', name: 'Reactor Refits', icon: '⚛️', building: 'fusion', category: 'power', clause: 'Fusion reactors generate +5.3% power', costs: [2.3e9, 5.6e10, 8.0e11, 1.1e13, 9.5e13, 8.0e14], effect: () => powerOf('fusion', 1.053) },
];
const FLEET = FLEET_COLUMNS.flatMap((col) =>
  FLEET_GATES.map((n, i) => {
    const draws = !!col.draw && DRAW_RUNGS[i];
    return funded({
      id: `${col.id}-${i + 1}`,
      name: `${col.name} ${ROMAN[i]}`,
      icon: col.icon,
      desc: `${col.clause}${draws ? ' · draw +7%' : ''} · with ${n} owned`,
      cost: col.costs[i],
      category: col.category,
      tier: 4,
      fleet: true,
      fleetColumn: col.id,
      gate: hasBuilt(col.building, n),
      effect: draws ? compose(col.effect(), global('demand', FLEET_DRAW)) : col.effect(),
    });
  })
);

// ---------- earnings gates: the frontier and pace ladders ----------
//
// A rung with `earnedGate` opens once this run has earned `earnedGate × cost`. The gate is
// a share of the *registered* price, so index.js rebuilds the rule after a config override:
// `earnedUnlock` is the one place the rule lives. A founding zeroes totalEarned and both
// ladders lock again — the late game is "earn your way back", never "wait".
//
//   • FRONTIER_GATE 0.25 — a frontier rung shows up while it is still far off (its price is
//     four times what the city has earned so far) and stays on the card as the goal the
//     next minutes of income are for.
//   • PACE_GATE 100 — a pace rung stays hidden until the city has earned a hundred times
//     its price *or the treasury holds the price*. In a replay the bot's cash sits at 2–10 s
//     of income and a rung placed for this city is reached by a cash spike when earnings
//     pass ~100–130× its price; opening it earlier only parks an "almost affordable" card
//     on top of the frontier target for the rest of the city. The second door is what keeps
//     the founding spree intact: a rung bought in an earlier city costs a replay a few
//     seconds of income, and it must come back the moment the cash is there (measured:
//     without that door every replay re-bought its ladder minutes later and the 12 h
//     session lost seven foundings). A player who saves therefore finds every pace rung
//     fundable the moment it appears. Re-measure with tools/economy-sim.mjs after a
//     balance pass.

export const FRONTIER_GATE = 0.25;
export const PACE_GATE = 100;

// Unlock rule + hint + progress mirror for a def whose gate is `earnedGate × cost`; a pace
// rung (`pace: true`) also opens while the treasury holds its price.
export function earnedUnlock(def) {
  const share = def && Number.isFinite(def.earnedGate) && def.earnedGate > 0 ? def.earnedGate : FRONTIER_GATE;
  const cost = def && Number.isFinite(def.cost) && def.cost > 0 ? def.cost : 0;
  const at = cost * share;
  if (def && def.pace) {
    // Both doors stay in the rule, but the card surfaces only the one that opens it in
    // practice: the treasury holding the price (measured: every pace rung's first purchase
    // came through the cash door). A hint that read "Earn $150Qa in this city or hold
    // $1.5Qa" and a bar drawn against the earnings door read ~1 % at the moment the card
    // became buyable, so the mirror is the price and the hint the hold.
    const hold = holds(cost);
    const fn = any(hasEarned(at), hold);
    return { unlock: fn, unlockHint: hold.hint.charAt(0).toUpperCase() + hold.hint.slice(1), unlockAt: { money: cost } };
  }
  const fn = hasEarned(at);
  return { unlock: fn, unlockHint: fn.hint.charAt(0).toUpperCase() + fn.hint.slice(1), unlockAt: { earned: at } };
}
// The seam docs/DESIGN.md names (`applyOverride` → `frontierUnlock`); same function.
export const frontierUnlock = earnedUnlock;

const frontier = (def) => ({ ...def, category: def.category || 'global', tier: 4, frontier: true, earnedGate: FRONTIER_GATE, ...earnedUnlock({ ...def, earnedGate: FRONTIER_GATE }) });
const pace = (def) => ({ ...def, category: def.category || 'global', tier: 4, pace: true, earnedGate: PACE_GATE, ...earnedUnlock({ ...def, pace: true, earnedGate: PACE_GATE }) });

// ---------- the Legacy rungs' earnings door ----------
//
// A dear Legacy rung carries two doors and needs both: its legacy gate (`legacyGate`:
// "Bank 50 legacy points and own Institutional Memory") and this run having earned a
// quarter of its price — the frontier's FRONTIER_GATE, so the card shows up while the
// rung is four times what the city has earned and is fundable minutes later, never hours.
// The points are banked cities before the earnings are (Standing Orders' 50 points landed
// in the 9th replay city, its $1T of earnings in the 21st), so the earnings door is the one
// that opens last: the hint names both and the mirror counts earnings toward cost/4, like a
// frontier card. Founding memory re-grants a kept rung without consulting the door, so a
// keeper still comes back the moment a city is founded.
// `legacyFrontier` is the one place the rule lives: index.js rebuilds it after a config
// override so the door follows the registered price (`legacyGate` survives the override).
export function legacyFrontier(def) {
  const cost = def && Number.isFinite(def.cost) && def.cost > 0 ? def.cost : 0;
  const gate = def && typeof def.legacyGate === 'function' ? def.legacyGate : null;
  const earn = hasEarned(cost * FRONTIER_GATE);
  const fn = gate ? all(gate, earn) : earn;
  const hint = gate && gate.hint ? `${gate.hint}, then ${earn.hint.charAt(0).toLowerCase() + earn.hint.slice(1)}` : earn.hint;
  return { unlock: fn, unlockHint: hint.charAt(0).toUpperCase() + hint.slice(1), unlockAt: { earned: cost * FRONTIER_GATE } };
}
// The hint is rendered here, before the ladder is complete, so each rung registers its own
// name first: Standing Orders' "own Institutional Memory" reads the rung built before it.
const legacyRung = (def) => {
  NAME_OF[def.id] = def.name;
  return { ...def, category: 'prestige', ...legacyFrontier(def) };
};

// ---------- frontier ladder (fixed dollars, each opens at a quarter of its price) ----------
//
// Nine rungs, each a different lever. Prices are config's placement-by-city (see the
// header; cities counted from the first founding): the Dyson Swarm lands mid-city 4, the
// Quantum Exchange in city 13, then the Mass-Driver Port (22), Ringworld District (24),
// Stellar Engine (26), Galactic Charter (28, beside the Energy Charter), Orbital Shipyard
// (29), the Helios Array (30; between the Shipyard and the Ring, where the ladder used to
// step ×23) and the Exchange Ring (31) carry the last four hours of a 12 h session. A rung
// is visible from the city that earns a quarter of its price, four to eight cities before
// the one that buys it. The Exchange Ring at $5.09Qa is the priciest thing in the game — a
// 12 h bot's cash peaks at $3.3e17 — and stays under the $1e18 money ceiling. Wave 2
// round 2 re-placed the whole ladder on the fleet-1× tree (place.mjs on plan.json at
// legacyPower 0.54; greedy max ratio ×1.332 at cycle 14, 34 foundings, no empty late
// city): the Port $9T → $13.2T (city 22, where the shipped $9T landed in 21 and left 22
// empty), the Shipyard $2.35Qa → $1.91Qa, the Helios Array $3.11Qa → $2.80Qa, the Ring
// $5.29Qa → $5.09Qa (config.js, cities 29 / 30 / 31). Wave 3 re-placed the tail again on
// the twenty-four-rung fleet tree: the Port $13.2T → $31T (22), the Ringworld District
// $77.7T → $200T (24), the Superconductor Grid $609T → $1.5Qa (27), the Shipyard
// $1.91Qa → $1.95Qa (29) and the Helios Array $2.80Qa → $2.25Qa (30, which was empty when
// the Array sat at $2.80Qa beside the Ring in 31).

const FRONTIER = [
  frontier({
    id: 'dyson-swarm',
    name: 'Dyson Swarm',
    icon: '🌞',
    desc: 'Sunlight harvested: all power generation +25%',
    cost: 4.99e7,
    category: 'power',
    // ×1.25, not ×1.5 or ×4 (see "Power" in the header): part of the ×5.49 supply stack
    // (net ×7.5 over the global demand terms at full ownership), so the grid still binds
    // in a replay and this is a felt purchase instead of a decorative one.
    effect: global('power', 1.25),
  }),
  frontier({
    id: 'quantum-exchange',
    name: 'Quantum Exchange',
    icon: '💹',
    desc: 'All income +100% · financial districts earn +100%',
    cost: 3.65e10,
    category: 'commercial',
    effect: compose(global('income', 2), incomeOf('financial', 2)),
  }),
  frontier({
    id: 'mass-driver-port',
    name: 'Mass-Driver Port',
    icon: '🚀',
    desc: 'All buildings cost −25% · industry earns +100% income',
    cost: 3.1e13,
    category: 'industrial',
    effect: compose(global('cost', 0.75), incomeOfEach(INDUSTRY, 2)),
  }),
  frontier({
    id: 'ringworld-district',
    name: 'Ringworld District',
    icon: '🪐',
    desc: 'All housing +150% and all jobs +100%',
    cost: 2.0e14,
    category: 'residential',
    // No draw clause (header, "Power"): a matching draw here (+50 %, then +25 %, then
    // +15 %) was measured in round 2 and rejected — it lands where the bare grid float is
    // lowest (city 24 greedy, 9–10 human), and neither bot can buy out of a demand step at
    // that fleet size (fusion reactors at count 150–230 cost ×1.112 each): the greedy sat
    // at cap/demand 0.71–0.76 for cities 25–28 (26.6 % of the session under-powered) and
    // the human at 0.73 in hour 12 with 46 min of Lights Out in city 9.
    // Jobs ×2.0, not ×1.5 (round 3, header "Housing"): housing ×2.5 over jobs ×1.5 was a
    // ×0.6 step on the jobs/pop of the city that buys it (greedy 1.56 → 0.95, then the
    // Skyline's ×0.75 to 0.72); ×2.0 makes it ×0.8, and the Civic Charter's ×1.25 that
    // used to sit in front of it is gone, so the pair reads 1.25 → 1.0.
    effect: compose(global('housing', 2.5), global('jobs', 2.0)),
  }),
  frontier({
    id: 'stellar-engine',
    name: 'Stellar Engine',
    icon: '🌟',
    desc: 'All buildings cost −20% · happiness +10%',
    cost: 4.45e14,
    category: 'global',
    // Cost, not growth: pop fills housing in under a second by city 26, so a growth clause
    // was nil at any price (F7); −20% cost is felt on every card the city buys next. The
    // demand cut it carried in round 1 is gone (header, "Power": it was one of the five late
    // rungs that took net supply/demand from ×5 to ×29); flat happiness is the felt term.
    effect: compose(global('cost', 0.8), happier(0.1)),
  }),
  frontier({
    id: 'galactic-charter',
    name: 'Galactic Charter',
    icon: '🌌',
    desc: 'All income +100% · all buildings cost −20%',
    cost: 8.53e14,
    category: 'global',
    // ×2, not ×3: it is bought from the 29th city on, so it is the one income lever that
    // shapes only the session's last hour. At ×3 the 31st city completes with nothing new
    // to buy before 12 h; at ×2 the session ends inside it, the way config places it.
    effect: compose(global('income', 2), global('cost', 0.8)),
  }),
  frontier({
    id: 'orbital-shipyard',
    name: 'Orbital Shipyard',
    icon: '🛸',
    desc: 'All jobs +25% · factories, refineries and campuses cost −25%',
    cost: 1.95e15,
    category: 'industrial',
    // Jobs ×1.25, not ×1.75 (round 3, header "Housing"): with the jobs moved onto the three
    // housing rungs that need them (Ringworld ×2.0, Skyline ×2.0, Exchange Ring ×1.5) the
    // Shipyard's ×1.75 would put its city at ~1.75 jobs/pop; ×1.25 keeps it under the 1.3
    // line (1.0 → 1.25 on the greedy's own by-city line). Round 2's ×1.5 trim was measured
    // with the old stack (human 24 h cities 11–13 at 0.54–0.59, 41–47 % jobless) and is
    // not that reading: those cities were short of jobs because the housing rungs before
    // them carried ×1.5 against ×2–2.5 housing. An industry discount replaces the demand
    // cut (header, "Power").
    effect: compose(global('jobs', 1.25), ...INDUSTRY.map((id) => costOf(id, 0.75))),
  }),
  frontier({
    id: 'helios-array',
    name: 'Helios Array',
    icon: '🔆',
    desc: 'All power generation +25% · all income +25%',
    // The 20th late rung, between the Shipyard ($1.95Qa) and the Exchange Ring ($5.09Qa):
    // that ×23 step was the ladder's widest and left the 30th–32nd cities with one new
    // card each over 45–50 minutes (DESIGN.md names the gap). A sun-tap whose surplus is
    // sold: the income clause is the "felt" term the balance notes ask of the late power
    // content, so the rung can carry a city of its own once config places it. Power ×1.25,
    // not ×1.5 or ×3: part of the ×5.5 stack (header, "Power").
    cost: 2.25e15,
    category: 'power',
    effect: compose(global('power', 1.25), global('income', 1.25)),
  }),
  frontier({
    id: 'exchange-ring',
    name: 'Exchange Ring',
    icon: '💱',
    desc: 'All housing +100% and all jobs +50%',
    cost: 5.09e15,
    category: 'commercial',
    // No draw clause either (see the Ringworld District and the header, "Power").
    // All jobs ×1.5, not commerce ×2 (round 3, header "Housing"): the commerce-only term
    // read as ×0.61 on the jobs/pop of the ring-heavy fleet that buys it (the Orbital Ring
    // and the campuses are most of the late jobs, and neither is commerce) — greedy 1.33 →
    // 0.81, cities 32–35 at 13–27 % jobless; a global ×1.5 under housing ×2 is ×0.75.
    effect: compose(global('housing', 2), global('jobs', 1.5)),
  }),
];

// ---------- charter perks (legacy-priced, permanent) ----------

export const CHARTER_MIN_COST = 3;
export const CHARTER_MAX_COST = 150500;
// A perk opens once the *spendable* bank (legacy − spent) holds half its price. Gating on
// the whole bank left late perks reading "open" for two or three cities while the Sign
// button stayed dead (measured: the Imperial Charter opened at bank 38,244 in city 27 and
// was signable at 76,488 spendable after founding 30); spendable points are what core's
// canAffordUpgrade checks, so open now means "half-way to signing", never "ready but not".
export const CHARTER_GATE = 0.5;

export const charterTier = (cost) => (cost <= 25 ? 1 : cost <= 600 ? 2 : cost <= 12000 ? 3 : 4);
const charterUnlock = (cost) => hasLegacyAvailable(cost * CHARTER_GATE);

// Unlock rule + hint + progress mirror + tier for a perk priced at `def.cost` legacy. Like
// `frontierUnlock`, this is the one place the rule lives: index.js rebuilds it after a
// config override so a config-priced perk still opens at half *its* price. The mirror is
// `{ legacyAvailable }` (spendable points), the same shape core's api.legacyAvailable
// measures, so a bar drawn against it reaches 100% exactly when the card opens.
export function charterUnlockFor(def) {
  const cost = def && Number.isFinite(def.cost) && def.cost > 0 ? def.cost : CHARTER_MIN_COST;
  const fn = charterUnlock(cost);
  return { unlock: fn, unlockHint: fn.hint.charAt(0).toUpperCase() + fn.hint.slice(1), unlockAt: { legacyAvailable: cost * CHARTER_GATE }, tier: charterTier(cost) };
}

const charter = (def) => ({
  ...def,
  category: 'charter',
  currency: 'legacy',
  tier: charterTier(def.cost),
  unlock: charterUnlock(def.cost),
});

const CHARTER = [
  charter({ id: 'charter-homestead', name: 'Homestead Charter', icon: '🏡', desc: 'All housing +50%', cost: 3, effect: global('housing', 1.5) }),
  charter({ id: 'charter-mint', name: 'Mint Charter', icon: '🪙', desc: 'All income +50% and building upkeep −25%', cost: 8, effect: compose(global('income', 1.5), global('upkeep', 0.75)) }),
  charter({
    id: 'charter-grid',
    name: 'Grid Charter',
    icon: '⚡',
    desc: 'All power generation +50% · tier 3 upgrades kept at every founding',
    cost: 20,
    // The second keeper (see FOUNDING MEMORY): signed in city 6, it carries the ten
    // tier-3 core rungs into every later city. Without it a replay re-bought all of them
    // from city 4 until Standing Orders landed in city 21 — seventeen cities (~4 h) of
    // clicks that decided nothing. Paid in legacy, it is permanent, so the `keeps` rule
    // holds from the founding after it is signed. Pacing is untouched (measured: the same
    // 32 foundings, every cycle within a minute): the bot re-bought those rungs inside the
    // first minute anyway, off seed cash that dwarfs their $8M. Power ×1.5, the perk
    // floor, so the supply stack stays small enough for the grid to bind (header, "Power").
    keeps: (def) => isCore(def) && def.tier === 3,
    effect: global('power', 1.5),
  }),
  charter({
    id: 'charter-guild',
    name: 'Guild Charter',
    icon: '⚒️',
    desc: 'Factories, refineries and tech campuses earn +100% income',
    cost: 50,
    effect: incomeOfEach(INDUSTRY, 2),
  }),
  charter({
    id: 'charter-merchant',
    name: 'Merchant Charter',
    icon: '🏪',
    desc: 'Shops, offices, malls and financial districts earn +100%',
    cost: 154,
    effect: incomeOfEach(COMMERCE, 2),
  }),
  charter({
    id: 'charter-settlers',
    name: "Settlers' Charter",
    icon: '🚂',
    desc: 'Population grows +100% faster · new arrivals +200%',
    cost: 385,
    effect: compose(global('growth', 2), global('inflow', 3)),
  }),
  charter({ id: 'charter-masons', name: "Masons' Charter", icon: '🧱', desc: 'All buildings cost −15%', cost: 963, effect: global('cost', 0.85) }),
  // No jobs term (round 3, header "Housing"): the jobs ×1.25 this carried through round 2
  // landed on a city already at 1.24 jobs/pop (greedy cities 21–24 read 1.56, the human's
  // city 9 1.54, both over the 1.3 line), so the jobs moved onto the housing rungs that
  // need them. What is left is a −50 % on the four civic buildings — ~5 % of a late city's
  // spend, near-nil as pace — and the income ×1.03, which is the cadence dial it is: it
  // replaced the growth ×1.5 that shipped through round 1 (the documented dead clause, F7:
  // pop fills housing in seconds by city 20), which left the greedy's City Archives → Civic
  // Charter step a nil-nil-nil stretch at ×1.349 against the 1.35 cadence line (config.js:
  // no price moves it; the round-1 critic asked for ≥ 0.02 of margin). Measured with the
  // probe's --boost on the placed tree, greedy 12 h: income ×1.03 reads ×1.311 at the step
  // (max ratio 1.325 at cycle 14; 34 foundings, legacy 531,013, money 4.24e17 — the Stellar
  // Engine's city 26 then empties, so balance re-places the tail); ×1.05 ×1.28 (city 26
  // empty too); ×1.10 35 foundings, ×1.374 at cycle 34, money 6.55e17 — too strong. Three
  // percent is the whole budget: this perk is permanent and the term compounds through
  // every later founding, so it must stay below the 'strong perk' bar the other eleven
  // clear (see the test's exemption).
  charter({
    id: 'charter-civic',
    name: 'Civic Charter',
    icon: '🎭',
    desc: 'Parks, schools, hospitals and stadiums cost −50% · all income +3%',
    cost: 2408,
    effect: compose(costOf('park', 0.5), costOf('school', 0.5), costOf('hospital', 0.5), costOf('stadium', 0.5), global('income', 1.03)),
  }),
  charter({ id: 'charter-treasury', name: 'Treasury Charter', icon: '💎', desc: 'All income +100% and building upkeep −50%', cost: 6020, effect: compose(global('income', 2), global('upkeep', 0.5)) }),
  // Jobs ×2.0 (round 3, header "Housing"): housing ×2 over jobs ×1.5 was a ×0.75 step on the
  // jobs/pop of the city that signs it (greedy 0.95 → 0.72 after the Ringworld); matched
  // ×2 / ×2 is ×1.0, so the Skyline city reads what the Ringworld city read.
  charter({ id: 'charter-skyline', name: 'Skyline Charter', icon: '🌇', desc: 'All housing +100% and all jobs +100%', cost: 15050, effect: compose(global('housing', 2), global('jobs', 2.0)) }),
  charter({
    id: 'charter-energy',
    name: 'Energy Charter',
    icon: '🔋',
    desc: 'Power +50% · happiness +15% · all buildings draw +15% power',
    cost: 37625,
    // Power ×1.5, the perk floor the charter test holds, paired with a ×1.15 draw so the
    // rung lands as net ×1.30 (header, "Power"): it is the one supply rung a 24 h session
    // still buys late (human city 11, greedy 28) and round 2 read cap/demand 1.83 / 1.96 /
    // 2.23 in the human's cities 11–13 with it demand-neutral. The demand cut it carried in
    // round 1 (×0.75) is gone; flat happiness is the felt term, as on the Stellar Engine.
    effect: compose(global('power', 1.5), happier(0.15), global('demand', 1.15)),
  }),
  charter({
    id: 'charter-imperial',
    name: 'Imperial Charter',
    icon: '👑',
    desc: 'All income +200% and all buildings cost −15%',
    cost: 150500,
    effect: compose(global('income', 3), global('cost', 0.85)),
  }),
];

// ---------- founding memory ----------
//
// A founding wipes every upgrade. Two things come back on their own:
//   • every charter perk the mayor owns — they are paid in legacy points, a currency a
//     founding never refunds, so they are permanent by construction;
//   • with legacy-scaled seed money the whole core ladder is affordable again within the
//     first minute: dozens of clicks that decide nothing. Three keeper rungs carry
//     `keeps(def)` — Institutional Memory (tiers 1–2) and Standing Orders (the Legacy
//     rungs) below, the Grid Charter (tier 3) above: while one is owned, every upgrade it
//     keeps (and the rung itself) is granted again the moment a new city is founded.
// index.js listens for the prestige event and re-owns all of them, at no cost, so the
// mayor starts the replay at the decisions that matter (tier 4 and the frontier).
// `keptUpgradeIds` is the pure rule so it can be tested without a game.
const isCore = (def) => !def.frontier && !def.pace && def.category !== 'prestige' && def.currency !== 'legacy';
export const isPermanent = (def) => !!def && def.currency === 'legacy';

export function keptUpgradeIds(ownedIds, defs = UPGRADES) {
  const owned = new Set(ownedIds || []);
  const out = new Set();
  for (const def of defs) if (owned.has(def.id) && isPermanent(def)) out.add(def.id);
  for (const keeper of defs) {
    if (typeof keeper.keeps !== 'function' || !owned.has(keeper.id)) continue;
    out.add(keeper.id);
    for (const def of defs) if (def.id !== keeper.id && keeper.keeps(def) === true) out.add(def.id);
  }
  return [...out];
}

// ---------- definitions (grouped by phase: $25 → $2e7 core ladder, the pace and frontier ladders, Legacy, then the Charter) ----------

export const UPGRADES = [
  // ===== Early game ($25 – $3.5k): first ten minutes =====
  {
    id: 'welcome-sign',
    name: 'Welcome Sign',
    icon: '🪧',
    desc: 'Population grows +50% faster',
    cost: 25,
    category: 'global',
    tier: 1,
    unlock: hasBuilt('house', 2),
    effect: global('growth', 1.5),
  },
  funded({
    id: 'zoning-reform',
    name: 'Zoning Reform',
    icon: '📐',
    desc: 'Houses hold +25% residents',
    // $75, not $50: the first $50 the opening spree leaves goes to the corner shop.
    cost: 75,
    category: 'residential',
    tier: 1,
    gate: hasBuilt('house', 4),
    effect: housingOf('house', 1.25),
  }),
  funded({
    id: 'neon-signage',
    name: 'Neon Signage',
    icon: '💡',
    desc: 'Shops earn +50% income',
    cost: 80,
    category: 'commercial',
    tier: 1,
    gate: hasBuilt('shop', 3),
    effect: incomeOf('shop', 1.5),
  }),
  funded({
    id: 'grant-writing',
    name: 'Grant Writing',
    icon: '✍️',
    desc: 'All income +25% · parks and schools cost −25%',
    cost: 150,
    category: 'global',
    tier: 1,
    gate: hasAnyUpgrade(),
    // The civic-grant clause is what tells it apart from Tax Software, its $250 twin: the
    // first park is the opening's happiness fix and the grant makes the next ones cheaper.
    effect: compose(global('income', 1.25), costOf('park', 0.75), costOf('school', 0.75)),
  }),
  funded({
    id: 'tax-software',
    name: 'Tax Software',
    icon: '🧾',
    desc: 'All income +25%',
    cost: 250,
    category: 'global',
    tier: 1,
    gate: any(hasEarned(1000, 'money-1k'), hasPop(50)),
    // Kept as the plain +25%: the first city's clock is set by this minute. A business
    // lever here (shops, offices and factories ×2 — the same +25–32 % of the gross on
    // paper) put the first founding at 47 min, a jobs lever (+30 % jobs, +10 % income) at
    // 45, both over the 30–45 the contract allows; Grant Writing carries the pair's
    // distinguishing clause instead.
    effect: global('income', 1.25),
  }),
  funded({
    id: 'turbine-blades',
    name: 'Carbon Turbine Blades',
    icon: '🌬️',
    desc: 'Windmills generate +100% power',
    cost: 300,
    category: 'power',
    tier: 1,
    gate: hasBuilt('windmill', 2),
    // Plant-specific on purpose (same for Coal Scrubbers): a city-wide floor here (+5% /
    // +10% power) eased the first city's tier-4 brownouts enough to drop the session's
    // under-power share from 3.3% to 2.5%, under the 3% the power contract asks for.
    effect: powerOf('windmill', 2),
  }),
  funded({
    id: 'smart-grid',
    name: 'Smart Grid',
    icon: '🔌',
    desc: 'All buildings use −20% power',
    cost: 250,
    category: 'power',
    tier: 1,
    // Three doors in: the Lights Out milestone (or a live brownout on an existing grid —
    // powerCap > 0 so the first cottage on an empty plot does not unlock it at t=0), a
    // sizeable windmill fleet, or 40 MW of demand — a mayor who keeps the lights on still
    // gets to buy it.
    gate: any(
      rule((state, derived) => milestone(state, 'brownout') || (!!derived && derived.powerCap > 0 && derived.powerRatio < 1), 'Suffer a brownout'),
      hasBuilt('windmill', 6),
      hasDemand(40)
    ),
    effect: global('demand', 0.8),
  }),
  funded({
    id: 'community-events',
    name: 'Community Events',
    icon: '🎪',
    desc: 'Happiness +10% and population grows +25% faster',
    cost: 500,
    category: 'civic',
    tier: 1,
    gate: hasBuilt('park', 1),
    // Paired like the other civic rungs: at the h≈0.85 it unlocks at, +0.1 happiness alone
    // is ~+6% income — the growth term is what makes the first park a decision.
    effect: compose(happier(0.1), global('growth', 1.25)),
  }),
  funded({
    id: 'assembly-lines',
    name: 'Assembly Lines',
    icon: '⚙️',
    desc: 'Factories earn +75% income',
    cost: 600,
    category: 'industrial',
    tier: 1,
    gate: hasBuilt('factory', 3),
    effect: incomeOf('factory', 1.75),
  }),
  funded({
    id: 'franchising',
    name: 'Franchising',
    icon: '🏪',
    desc: 'Shops and offices provide +30% jobs',
    cost: 1200,
    category: 'commercial',
    tier: 2,
    gate: any(hasPop(100, 'pop-100'), hasBuilt('office', 1)),
    effect: compose(jobsOf('shop', 1.3), jobsOf('office', 1.3)),
  }),
  funded({
    id: 'green-belts',
    name: 'Green Belts',
    icon: '🌳',
    desc: 'Happiness +5% · cottages hold +25% residents',
    cost: 1500,
    category: 'civic',
    tier: 2,
    gate: hasBuilt('park', 4),
    // Housing on the cottages, not growth (header, "Growth"): the first city is
    // housing-bound at the minute this is funded (pop/housing 1.00 at purchase, measured),
    // so more residents is more taxpayers within a minute, while "grows +25 % faster" moved
    // nothing. Cottages ×1.25, not cottages and apartments ×1.10 (the round-3 plan's first
    // wording): the first city's population curve sets every tier-3/4 pop gate
    // (src/buildings/cadence.mjs, 90 s card spacing), and measured against a no-housing
    // control in one probe batch (first founding 41.0 min) ×1.10 on both moved the founding
    // −0.8 min (40.2) and ×1.15 on both −1.0 min with a mall/solar 80 s spacing fault, while
    // cottages ×1.25 moved it −0.2 min (40.8) with no fault — inside the ≤ 0.3 min the plan
    // allows, and a +25 % term the ladder's meaningfulness rule accepts. Nil in a replay
    // (cottages are <0.1 % of a replay's housing), where Institutional Memory re-grants it.
    effect: compose(happier(0.05), housingOf('house', 1.25)),
  }),
  funded({
    id: 'farmers-market',
    name: 'Farmers Market',
    icon: '🥕',
    desc: 'Shops earn +100% income',
    cost: 3000,
    category: 'commercial',
    tier: 2,
    gate: hasBuilt('shop', 15),
    effect: incomeOf('shop', 2),
  }),
  {
    id: 'grid-substations',
    name: 'Grid Substations',
    icon: '🗼',
    desc: 'All power generation +25%',
    cost: 3500,
    category: 'power',
    tier: 2,
    // The first city's first goal card (see "the funded door"): open from the second minute, a dozen
    // minutes of income away, and the one card on the panel until the treasury reaches
    // it around minute 11 — the rungs in between arrive as they are funded.
    unlock: hasDemand(10),
    effect: global('power', 1.25),
  },

  // ===== Mid game ($6k – $800k): minutes 10 – 35 =====
  funded({
    id: 'high-density',
    name: 'High-Density Zoning',
    icon: '🏢',
    desc: 'Apartments hold +50% residents',
    cost: 6000,
    category: 'residential',
    tier: 2,
    gate: hasBuilt('apartment', 5),
    effect: housingOf('apartment', 1.5),
  }),
  funded({
    id: 'express-transit',
    name: 'Express Transit',
    icon: '🚇',
    desc: 'Commuter lines: offices and factories cost −25%',
    cost: 8000,
    category: 'global',
    tier: 2,
    gate: hasPop(120),
    // A discount on the two employers being bought at minute 8, not growth (header,
    // "Growth"): felt on the cards in play, and per-building so it is ~nil in a replay,
    // where Institutional Memory re-grants it. Not a jobs term: +50% (or +25%) jobs on
    // offices and factories here speeds the first city's population curve enough to open
    // the mall 76–86 s after the refinery and the solar farm 82 s after the mall, under
    // the buildings module's 90 s card-spacing rule (src/buildings/cadence.mjs); the
    // discount leaves those gates where they are (mall 908 s, solar 1,018 s; measured).
    effect: compose(costOf('office', 0.75), costOf('factory', 0.75)),
  }),
  funded({
    id: 'coal-scrubbers',
    name: 'Coal Scrubbers',
    icon: '🏭',
    desc: 'Coal plants generate +50% power',
    cost: 12000,
    category: 'power',
    tier: 2,
    gate: hasBuilt('coal', 3),
    effect: powerOf('coal', 1.5),
  }),
  funded({
    id: 'night-shift',
    name: 'Night Shift',
    icon: '🌙',
    desc: 'Factories provide +50% jobs',
    cost: 15000,
    category: 'industrial',
    tier: 2,
    gate: hasBuilt('factory', 6),
    effect: jobsOf('factory', 1.5),
  }),
  funded({
    id: 'bulk-permits',
    name: 'Bulk Permits',
    icon: '📋',
    desc: 'All buildings cost −20%',
    cost: 25000,
    category: 'global',
    tier: 2,
    gate: hasBuiltTotal(60),
    effect: global('cost', 0.8),
  }),
  funded({
    id: 'container-port',
    name: 'Container Port',
    icon: '🚢',
    desc: 'Factories and refineries earn +50% income',
    cost: 45000,
    category: 'industrial',
    tier: 2,
    gate: hasBuilt('factory', 20),
    effect: compose(incomeOf('factory', 1.5), incomeOf('refinery', 1.5)),
  }),
  funded({
    id: 'tourism-board',
    name: 'Tourism Board',
    icon: '🗺️',
    desc: 'Visitors settle: all housing +25% and all income +15%',
    cost: 50000,
    category: 'global',
    tier: 2,
    gate: hasPop(2000, 'pop-1k'),
    // A housing card with an income clause, so it does not read as the Regional Airport's
    // twin: at minute 24 the city is housing-bound (jobs exceed citizens), so +25 % housing
    // is +25 % taxpayers and payroll within a minute or two — the +25 % income it replaces.
    effect: compose(global('housing', 1.25), global('income', 1.15)),
  }),
  funded({
    id: 'open-plan-offices',
    name: 'Open-Plan Offices',
    icon: '💼',
    desc: 'Offices earn +75% income',
    cost: 60000,
    category: 'commercial',
    tier: 2,
    gate: hasBuilt('office', 5),
    effect: incomeOf('office', 1.75),
  }),
  {
    id: 'regional-airport',
    name: 'Regional Airport',
    icon: '✈️',
    desc: 'All income +30%',
    // The second goal card (see "the funded door"): $150k, not $85k, and open at the 1,000-citizen
    // milestone (minute 12) rather than at 3,000, so it is ~2 minutes of income away when
    // it appears and stays the far target until the treasury reaches it at ~27 min. Not
    // dearer: the bot funds the cheapest open card first, and behind the $120k–$250k
    // tier-3 cluster a $250k airport waited until minute 33 and cost the first city six
    // minutes (measured: founding 48.5 min, over the 45 the contract allows).
    cost: 120000,
    category: 'global',
    tier: 3,
    unlock: hasPop(1000, 'pop-1k'),
    effect: global('income', 1.3),
  },
  funded({
    id: 'modern-curriculum',
    name: 'Modern Curriculum',
    icon: '🎓',
    desc: 'All jobs +25% and all income +8%',
    cost: 150000,
    category: 'civic',
    tier: 3,
    gate: hasBuilt('school', 3),
    // An educated workforce fills more desks: jobs pay wages directly, and at the 3-school
    // mark (~minute 20) unemployment is the penalty a growing city feels most. The income
    // term replaces the +10% happiness this and Preventive Care used to add (≈ +6% income
    // between them in a replay, where Standing Orders re-grants both): +8% here keeps the
    // 12 h session on the balance builder's placement — +10% ends it a city early, +6% a
    // city late, and a replay's cash spikes then miss the rungs placed at their edge.
    effect: compose(global('jobs', 1.25), global('income', 1.08)),
  }),
  funded({
    id: 'maintenance-contracts',
    name: 'Maintenance Contracts',
    icon: '🔧',
    desc: 'Power plants cost −20% · refineries and malls earn +20%',
    cost: 200000,
    category: 'global',
    tier: 3,
    gate: any(
      rule((state, derived) => !!derived && derived.upkeep > 0, 'Pay upkeep on a building'),
      hasBuilt('coal', 5),
      hasBuilt('solar', 1)
    ),
    // No upkeep clause: upkeep is a sliver of the gross for the whole session (measured:
    // 0.56% at minute 27.6 of the first city, when this is bought, and 0.00–0.03% in every
    // replay — only nuclear plants, fusion reactors and the elevator carry any), so a
    // −25% or −40% upkeep cut was worth +0% net income, the one rung whose felt effect was
    // nil. Two felt terms instead:
    //   • the plant discount — from this purchase to the founding, power plants are 42% of
    //     what the city spends (nuclear 15%, solar 12%, coal 8%, fusion 7%), so −20% on
    //     their price is ~8% more city for the same income, on the cards being bought
    //     right then. Windmills are left out: capped at a dozen and bought by minute 27;
    //   • service crews for the two buildings that carry the first city's income at
    //     minute 27.6 (measured: refineries 45% and malls 40% of building income, which is
    //     43% of the gross → +7% gross on the day). Per-building, not global: the Grid
    //     Charter re-grants tier 3 in every replay, and +10% *all* income here compounded
    //     through thirty foundings (measured: 36 foundings, money peak 1.7e18 and legacy
    //     1.05e6 — both over the ceiling). Refineries and malls are 1–5% of a replay's
    //     income (financial districts carry 72–82% of it from city 9 on), so the clause is
    //     worth +1–2% there. +20% is the most the placed tail absorbs today: the session
    //     ends inside an open 35th city with ~16 min of slack (config.js, "the tail is the
    //     delicate part"), +20% spends ~9 of them (first founding 41.7 → 41.0 min, 34
    //     foundings, contract PASS) and +30% or +50% ~13 — the 35th city then completes
    //     (24 min) and the cadence and variety gates fail. A wider tail (the balance
    //     builder's late employer incomes or the Space Elevator gate) would let this
    //     clause read +30% (+11% on the day).
    effect: compose(costOf('coal', 0.8), costOf('solar', 0.8), costOf('nuclear', 0.8), costOf('fusion', 0.8), incomeOf('refinery', 1.2), incomeOf('mall', 1.2)),
  }),
  funded({
    id: 'welcome-center',
    name: 'Welcome Center',
    icon: '🛂',
    desc: 'Newcomers staff the malls and refineries: +50% jobs',
    cost: 250000,
    category: 'global',
    tier: 3,
    gate: hasPop(1000, 'pop-1k'),
    // Funded at ~minute 27, when refineries and malls carry 85% of building income and the
    // city is jobs-bound; growth was nil here (header, "Growth"). Per-building, so the Grid
    // Charter's re-grant is worth ~0 in a replay.
    effect: compose(jobsOf('mall', 1.5), jobsOf('refinery', 1.5)),
  }),
  funded({
    id: 'solar-tracking',
    name: 'Sun-Tracking Arrays',
    icon: '☀️',
    desc: 'Solar farms generate +100% power',
    cost: 300000,
    category: 'power',
    tier: 3,
    gate: hasBuilt('solar', 3),
    effect: powerOf('solar', 2),
  }),
  funded({
    id: 'catalytic-crackers',
    name: 'Catalytic Crackers',
    icon: '🧪',
    desc: 'Refineries earn +100% income',
    cost: 500000,
    category: 'industrial',
    tier: 3,
    gate: hasBuilt('refinery', 3),
    effect: incomeOf('refinery', 2),
  }),
  funded({
    id: 'anchor-tenants',
    name: 'Anchor Tenants',
    icon: '🛍️',
    desc: 'Malls earn +100% income and provide +25% jobs',
    cost: 800000,
    category: 'commercial',
    tier: 3,
    gate: hasBuilt('mall', 3),
    effect: compose(incomeOf('mall', 2), jobsOf('mall', 1.25)),
  }),

  // ===== Late game ($120k – $2e7): the first city's tier 4 and the second city =====
  funded({
    id: 'prefab-construction',
    name: 'Prefab Construction',
    icon: '🏗️',
    desc: 'All buildings cost −20%',
    cost: 120000,
    category: 'global',
    tier: 3,
    gate: hasEarned(1e6, 'money-1m'),
    effect: global('cost', 0.8),
  }),
  funded({
    id: 'skyway-frames',
    name: 'Skyway Steel Frames',
    icon: '🌉',
    desc: 'Towers hold +50% residents',
    cost: 400000,
    category: 'residential',
    tier: 3,
    gate: hasBuilt('tower', 10),
    effect: housingOf('tower', 1.5),
  }),
  funded({
    id: 'digital-city-hall',
    name: 'Digital City Hall',
    icon: '🖥️',
    desc: 'All income +50%',
    cost: 1.3e6,
    category: 'global',
    tier: 3,
    gate: hasPop(10000, 'pop-10k'),
    effect: global('income', 1.5),
  }),
  funded({
    id: 'preventive-care',
    name: 'Preventive Care',
    icon: '🩺',
    desc: 'Civic buildings cost −25%: parks, schools, hospitals, stadiums',
    cost: 4e6,
    category: 'civic',
    tier: 3,
    gate: hasBuilt('hospital', 2),
    // A civic discount, felt on the Civic tab at minutes 28–35 (the stadium ladder): the
    // growth term it replaced was nil (pop fills housing in seconds; header, "Growth"), and
    // a late +10% happiness was worth +3% income at the h≈1.9 this opens at.
    effect: compose(costOf('park', 0.75), costOf('school', 0.75), costOf('hospital', 0.75), costOf('stadium', 0.75)),
  }),
  {
    id: 'breeder-reactors',
    name: 'Breeder Reactors',
    icon: '☢️',
    desc: 'Nuclear plants generate +100% power',
    cost: 2e7,
    category: 'power',
    tier: 4,
    // The third goal card (see "the funded door"): visible from the 10,000-citizen mark (minute 28, just
    // before the plant itself unlocks at 11,000) as the far target of the first city's
    // last quarter hour; it is bought in the second city.
    unlock: any(hasPop(10000, 'pop-10k'), hasBuilt('nuclear', 1)),
    effect: powerOf('nuclear', 2),
  },

  // ===== Fleet ladder ($70M – $800T): twenty-four count-gated tier-4 core rungs, re-bought every city (see "the fleet ladder") =====
  ...FLEET,

  // ===== Pace ladder ($74M – $1.5Qa): one rung per replay city, each opens once the city has earned 100× its price =====
  // In price (= city) order. Config places them by city (5 Championship Season · 7 Robotic
  // Assembly · 9 AI Governance · 10 Orbital Solar · 11 Planetary Charter · 15 Megastructures
  // · 16 Arcology Gardens · 18 Algorithmic Trading · 27 Superconductor Grid; "mid-city"
  // rungs land off plateau cash after the spree); the frontier rungs sit between them (see
  // FRONTIER above).
  pace({
    id: 'championship-season',
    name: 'Championship Season',
    icon: '🏆',
    desc: 'Stadiums earn +100% income and provide +100% jobs',
    cost: 7.43e7,
    category: 'civic',
    effect: compose(incomeOf('stadium', 2), jobsOf('stadium', 2)),
  }),
  pace({
    id: 'robotic-assembly',
    name: 'Robotic Assembly',
    icon: '🤖',
    desc: 'All industry earns +100% income: factories, refineries, campuses',
    cost: 2.49e8,
    category: 'industrial',
    effect: incomeOfEach(INDUSTRY, 2),
  }),
  pace({
    id: 'ai-governance',
    name: 'AI Governance',
    icon: '🧠',
    desc: 'All income +100%',
    cost: 1.02e9,
    category: 'global',
    effect: global('income', 2),
  }),
  pace({
    id: 'orbital-solar',
    name: 'Orbital Solar',
    icon: '🛰️',
    desc: 'Every power plant generates +25%',
    cost: 2.01e9,
    category: 'power',
    // ×1.25, not ×1.5 or ×3: part of the ×5.5 global supply stack (header, "Power").
    effect: global('power', 1.25),
  }),
  pace({
    id: 'planetary-charter',
    name: 'Planetary Charter',
    icon: '🌍',
    desc: 'All income +150%',
    cost: 3.70e9,
    category: 'global',
    // Income only (round 3, header "Growth"): bought mid-city 11 at pop/housing 1.00, where
    // the growth ×2 it carried moved nothing; the desc no longer promises it.
    effect: global('income', 2.5),
  }),
  pace({
    id: 'megastructures',
    name: 'Megastructures',
    icon: '🏙️',
    desc: 'Housing +100% and jobs +50% city-wide',
    cost: 2.96e11,
    category: 'residential',
    // Paired (header, "Housing"): housing ×2 alone was an instant unemployment jump the
    // city could not buy back (measured: 24–34% for an hour on the human profile).
    effect: compose(global('housing', 2), global('jobs', 1.5)),
  }),
  pace({
    id: 'arcology-gardens',
    name: 'Arcology Gardens',
    icon: '🌺',
    desc: 'Arcologies hold +50% residents · all jobs +20%',
    cost: 3.48e11,
    category: 'residential',
    // Arcologies are most of a late city's housing, so ×1.5 on them is ~+45% housing; the
    // global jobs term is ×1.2, not ×1.25 (header, "Housing"): a mid-city Gardens purchase
    // is then a jobless step the jobs rule buys back over the next minutes — measured on
    // the human profile, city 7 (Megastructures and the Gardens at run-minutes 38–41):
    // median unemployment 4–5 % for the city and 5 % for the hour. ×1.1 was measured too
    // and rejected: 22 % for the city and 17–24 % for the hour, over the 15 % line.
    effect: compose(housingOf('arcology', 1.5), global('jobs', 1.2)),
  }),
  pace({
    id: 'algorithmic-trading',
    name: 'Algorithmic Trading',
    icon: '📈',
    desc: 'Financial districts earn +100% income',
    cost: 9.00e11,
    category: 'commercial',
    effect: incomeOf('financial', 2),
  }),
  pace({
    id: 'superconductor-grid',
    name: 'Superconductor Grid',
    icon: '🧲',
    desc: 'Every building draws −20% power',
    cost: 1.5e15,
    category: 'power',
    // ×0.8, not ×0.7: the one late demand cut — Smart Grid 0.8 · this 0.8 · the Energy
    // Charter's draw 1.15 fold to ×0.736 (header, "Power").
    effect: global('demand', 0.8),
  }),

  // ===== Frontier ($49.9M – $5.09Qa, each opens at a quarter of its price earned this run) =====
  ...FRONTIER,

  // ===== Legacy (prestige) — unlocked by legacy points, paid in money each run =====
  {
    id: 'legacy-archive',
    name: 'Legacy Archive',
    icon: '📜',
    desc: 'All income +50%',
    cost: 1000,
    category: 'prestige',
    tier: 1,
    unlock: hasLegacy(1),
    effect: global('income', 1.5),
  },
  {
    id: 'founders-blueprints',
    name: "Founders' Blueprints",
    icon: '📘',
    desc: 'All buildings cost −20%',
    cost: 5000,
    category: 'prestige',
    tier: 2,
    unlock: hasLegacy(2),
    effect: global('cost', 0.8),
  },
  {
    id: 'veteran-planners',
    name: 'Veteran Planners',
    icon: '🎖️',
    desc: 'Happiness +10% · tier 1–2 buildings cost −25%',
    cost: 12000,
    category: 'prestige',
    tier: 3,
    unlock: hasLegacy(3),
    // Bought in a replay's first minute (Standing Orders re-grants it at every founding
    // after city 21), where pop/housing reads 0.00 on an empty plot and 1.00 seconds later:
    // the growth ×2 it carried was nil (header, "Growth"). The +0.1 happiness is the felt
    // term in a replay's jobless opening minute; the discount on the ten tier-1–2 buildings
    // (cottages, apartment blocks, shops, offices, factories, refineries, windmills, coal
    // plants, parks, schools) is felt in that same minute and ~nil after — they are <0.1 %
    // of a replay's spend past the spree, so nothing compounds through the re-grant.
    effect: compose(happier(0.1), ...['house', 'apartment', 'shop', 'office', 'factory', 'refinery', 'windmill', 'coal', 'park', 'school'].map((id) => costOf(id, 0.75))),
  },
  {
    id: 'dynasty-ledger',
    name: 'Dynasty Ledger',
    icon: '👑',
    desc: 'All income +50% × ∛legacy (+100% at 8 points, +500% at 1,000)',
    cost: 25000,
    category: 'prestige',
    tier: 4,
    unlock: hasLegacy(5),
    // A cube-root curve instead of a capped line: it never goes flat, yet it stays inside
    // the late-game magnitudes (money ≤ 1e18, legacy ≤ 1e6 at 12 h) — ×1.85 when it opens
    // at 5 points, ×6 at a thousand, ×51 at the million-point ceiling — on top of the
    // simulation's own root of the bank and the charter perks' flat multipliers.
    effect: (mods, state) => {
      const pts = Math.max(0, Math.floor(legacy(state)));
      mods.income *= 1 + 0.5 * Math.cbrt(pts);
    },
  },
  // The three dear rungs below add the earnings door (see "the Legacy rungs' earnings door"):
  // the points open in a city that cannot yet fund them, so each also waits for this run
  // to earn a quarter of its price — $7.5M, $13.1M, $1T — seconds in the city that buys it.
  legacyRung({
    id: 'institutional-memory',
    name: 'Institutional Memory',
    icon: '🗃️',
    desc: 'Every tier 1–2 upgrade is yours from the day a new city is founded',
    cost: 3e7,
    tier: 4,
    legacyGate: hasLegacy(10),
    keeps: (def) => isCore(def) && def.tier <= 2,
    effect: noEffect,
  }),
  legacyRung({
    id: 'city-archives',
    name: 'City Archives',
    icon: '📚',
    desc: 'All jobs +25% · financial districts and tech campuses cost −10%',
    cost: 1.53e12,
    tier: 3,
    // Config prices it at $1.53T as the 19th city's novelty (the saver-gate pass moved it
    // up from $52M in city 4: at $52M a saver's mid-game hoard toward it opened Algorithmic
    // Trading a city early; $1.53T sits above the saver's 30 s-of-income reach in city 17).
    // It must stay cheaper than Standing Orders ($15T, city 21), which re-grants every
    // Legacy rung at each founding after it, so no Legacy rung can be a first purchase
    // once that is owned. Jobs and an employer discount, not income: it is re-granted in
    // every later city, and an income term here compounds through thirty foundings
    // (measured: +40% income turned the 12 h session into 43 foundings and 1e7 legacy).
    // The growth ×1.5 it carried through round 2 was the documented dead clause (F7: pop
    // fills housing in seconds by city 19; pop/housing 1.00 at purchase, measured) and is
    // gone. Round 2 measured a ring-housing replacement ("Orbital Rings hold +50%
    // residents": the ring is half of late housing, so it lowers jobs/pop where the ring
    // dominates) and rejected it: the greedy's cities 26–28 read 37–39 % jobless (the
    // Skyline city's housing ×2 lands on top of it) and the human's 24 h cities 10–13
    // 41–47 %; at ×1.25 still 25–33 %. What ships instead is −10 % on the two employers
    // the late fleet buys at the price cliff (districts and campuses at count 150–230 cost
    // ×1.112 each): per building, so the Standing Orders re-grant from greedy city 22
    // compounds nothing global; expected +3–6 % income in the human's city 8 (≈ 4 % more
    // districts and campuses) and ~1–2 % in greedy cities 19–33, inside the placement
    // margins and re-placed anyway.
    legacyGate: hasLegacy(20),
    effect: compose(global('jobs', 1.25), costOf('financial', 0.9), costOf('techpark', 0.9)),
  }),
  legacyRung({
    id: 'standing-orders',
    name: 'Standing Orders',
    icon: '📑',
    desc: 'Tier 3 and Legacy upgrades are yours from the day a city is founded',
    cost: 1.5e13,
    tier: 4,
    legacyGate: all(hasLegacy(50), owns('institutional-memory')),
    // Config prices it at $15T, the 21st city's novelty. Tier 3 has usually been kept by
    // the Grid Charter since city 6 by then (a `keeps` overlap is harmless: a rung is
    // granted once); what this adds is the six Legacy rungs.
    keeps: (def) => (isCore(def) && def.tier === 3) || def.category === 'prestige',
    effect: noEffect,
  }),

  // ===== Charter — permanent perks bought with legacy points (◆ 3 … ◆ 150,500) =====
  ...CHARTER,
];

// ---------- hints: copy each rule's tag onto its definition ----------
for (const def of UPGRADES) NAME_OF[def.id] = def.name;
for (const def of UPGRADES) {
  const u = def.unlock;
  if (!def.unlockHint && u && typeof u.hint === 'string' && u.hint) def.unlockHint = u.hint.charAt(0).toUpperCase() + u.hint.slice(1);
  if (!def.unlockAt && u && u.at && typeof u.at === 'object') def.unlockAt = { ...u.at };
  if (!def.unlockHint) def.unlockHint = 'Grow the city';
}
