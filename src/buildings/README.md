# Buildings — design rationale

`data.js` is the catalogue: 22 buildings — five categories × four tiers, plus two legacy-gated
tier-5 megastructures — pure data. This file is *why* the numbers in it have the shape they
have. `data.js` carries the **shipped numbers**: `src/balance/config.js` re-pins fifteen
buildings in `config.buildings`, with values identical to the defaults (the test `data.js
matches config` holds every numeric pin and every `unlockAt` together), so a config import
failure ships the ladder the balance sim was run on rather than a stale sketch. The one
deliberate delta is the tier-4 strain rule: config re-pins `demandGrowth` to +12.5 % per unit
up to ×40, the fallback in `data.js` stays the +2.5 % / ×1.5 tax argued under *Power*. To quote
what the game ships, or to see a delta, run

```
node src/buildings/catalogue.mjs            # resolved catalogue, default in brackets where config differs (stickers and the synergy / strain rules)
node src/buildings/cadence.mjs [--curve 30] # first-city open / first-buy probe (exit 1 on a fault); --curve prints the pop/demand/cash curve gates are placed on
node src/buildings/columns.mjs [--ticks N]  # 12 h session probe: jobs vs housing per city (both readings judged), upgrade-mod swing, tier-5 open/buy cities (exit 1 on a fault)
node src/buildings/buildings.test.mjs       # unit tests + both probes (cadence at the first founding, columns at 6 h and at 12 h)
```

## Columns and tiers

- **Residential is the cheap column, jobs the expensive one.** Citizens arrive first, then
  the city has to find them work, which is where the money is. A tier-4 card is a decision
  rather than a bigger copy of tier 3 (see *Signature mechanics*), and a tier-5 card is a
  megastructure that opens only from a legacy bank (see *Tier 5*).
- **Cost growth** comes from `config.cost.tierGrowth[tier]` (shipped 1.18 / 1.16 / 1.13 /
  1.112; `index.js` keeps the same four numbers as its fallback and the test holds the two
  equal) unless the card pins its own: the park (1.2), school and hospital (1.18) grow faster
  because a civic card's happiness saturates (`config.happiness.civicCap`) and a flat curve
  would let a player buy forty of them for nothing. The stadium deliberately does *not* carry
  that exception — by the time it opens the civic curve is full, so it is bought as a
  franchise and priced like the other tier-4 cards so a fleet is buildable. The two tier-5
  cards pin ×3: config has no tier-5 rate (balance's `costGrowthFor(5)` would answer with the
  tier-1 curve), and ×3 is what makes a megastructure a rolling target instead of a fleet.
- **The curve has a knee (F8, 2026-09-14 round 2).** Unit *n* (0-based) costs
  `baseCost · g^min(n, knee) · gLate^max(0, n − knee)` with `g` the card's growth above,
  `knee` 75 and `gLate` 1.112 (the tier-4 rate) from `config.cost.knee` /
  `config.cost.lateGrowth`, mirrored by `DEFAULT_KNEE` / `DEFAULT_LATE_GROWTH` in
  `index.js` the way the tier ladder is (the drift test holds the pair equal; core reads
  only the two resolved fields, `def.knee` / `def.lateGrowth`, and prices the two geometric
  series). Why: on one segment the cheap column overtook the dear one — at count 200 a
  cottage cost $7.1e15 against an arcology's $2.0e14 (36×), a park $1.4e18 against a
  stadium's $5.0e15 (275×), and $1e18 bought 219 cottages to 259 arcologies, the player's
  "237 vs 202" (round-1 skeptic). The knee sits above the first city's largest fleet (71
  cottages), so the first city is untouched; after it every column reads in tier order —
  count 200: cottage $4.3e12 ≤ apartment $1.0e13 ≤ tower $1.6e13 ≤ arcology $2.0e14, shop
  $7.1e12 ≤ … ≤ district $1.2e15, factory $7.1e13 ≤ refinery $7.9e14 ≤ campus $1.7e15, coal
  $9.9e13 ≤ solar $1.4e14 ≤ nuclear $6.7e14 ≤ fusion $6.7e15, park $1.0e14 ≤ school $7.1e14
  ≤ hospital $3.5e15 ≤ stadium $5.0e15 — and a budget buys a non-increasing count up the
  tiers ($1e18 from zero: 295 / 287 / 283 / 259 cottages … arcologies, 266 / 247 / 232 /
  229 parks … stadiums). Two cards pin their own: the **hospital knee 60** (its 1.18 curve
  from $60k must soften earlier than the park's and school's to stay under the stadium — at
  the shared knee the 200th reads $8.6e15; the first city buys 23), and the **ring and
  elevator lateGrowth 3** (= their costGrowth: the ×3 curve is the fleet cap and never
  softens). The windmill's cap of 8 sits under every knee. `unitCost(def, i)` in `index.js`
  is the reference the F8 test holds core's `buildingCost` / `maxAffordable` / `sellRefund`
  to, and `catalogue.mjs` prints the resolved knee and late rate per card.
- **Late identity for the cheap column.** Three tier-1 cards are the *source* of a higher
  tier's signature rule (factory → refinery, park → solar farm, school → tech campus), and
  the two that were pure sink fodder scale *with* the tier above them instead: the cottage's
  housing grows with apartment blocks (+4 % each, ×3), the corner shop's income with office
  blocks (same curve). A late city keeps buying them for a reason it can read on the card.
- **The windmill retires at eight.** It has no late role on purpose: a ×2 cost curve ($40,
  $80, … $5,120 for the 8th, $10,200 for all eight = 32 MW) and a hard `maxCount: 8`. The
  8th is priced like the generator that replaces it — two coal plants ($2,500 for 80 MW) —
  where a cap of 12 let the bot, and a Buy Max on the Power tab, pay $164k for 48 MW (the
  last four at $10k–$82k each for 4 MW). Core owns the cap (`api.buy` and `maxAffordable`
  refuse past it, `api.buildings()` rows carry `maxed` and `maxCount` so the card can print
  "8/8 built"); `index.js` also rolls back any purchase that still lands above the cap,
  refunding the excess units' exact share of the price, so an older core can never let Buy
  Max pay $1e16 for 4 MW — which is what the 49th windmill cost in the 12 h sim before any
  cap. The coal plant's demand gate (34 MW) sits half a windmill above what the eight can
  supply, so the plant opens the moment the grid falls short.

## Jobs and housing

`employed = min(pop, jobs)`, so a jobs column far above the population is a sticker nobody
fills and a column under it is a city that cannot employ its citizens. Measured on the
2026-09-07 catalogue (`columns.mjs`), the greedy bot ran jobs at **3–7× the population** from
the 6th city on (44 % of the column was the 4,000-job financial district, 25 % the 2,500-job
campus, 15 % the stadium at ×3): 65–80 % of a tier-4 employer's job sticker was decoration and
the wage term was capped by a residential column that was 84 % arcologies at a flat 1,000.

Why a flat sticker cannot fix it: the upgrade rungs multiply the two columns at very
different rates — housing ×1.9 by city 4, ×3.75 by city 14, ×18.75 by city 25, ×37.5 by
city 31, against jobs ×1.25 / ×1.25 / ×9.9 / ×17.3 (the global `(hous/jobs)` mods of the
probe on the 2026-09-14 round-1 upgrade stack; before that wave jobs ended at ×12, and the
round-3 re-pairing — Civic Charter's jobs ×1.25 removed, Ringworld and Skyline jobs ×1.5 →
×2.0, Shipyard ×1.75 → ×1.25, Exchange Ring's commerce-only ×2 → all jobs ×1.5 — lands the
session at **housing ×37.5 vs global jobs ×21.1**, measured 37.5 / 21.09 on the probe's last
sample). A sticker ratio that reads 1.5 mid-session reads 0.4 by the end; the old 4,000-job
district was the number that made the *end* read 1.5, at the price of 3–7× for eight
cities. So the catalogue carries three things instead of one number:

1. **Stickers sized for the mid game:** the district 2,000 jobs (was 4,000), the campus
   1,800 (was 2,500), the stadium's game-day hiring capped at ×2 (was ×3). With every
   tier-3/4 card owned in equal numbers the set reads ~1.9 jobs per housing before the rungs
   move it (pinned by a test).
2. **The commuter belt:** arcology housing +2.5 % per financial district, ×3 at 80. The
   housing column follows the district fleet, which is what the bot actually buys; the base
   stays 1,000 because a 2,500 arcology tripped every later first-city gate within a minute,
   and the rule only reaches ×1.15 in the first city's last five minutes.
3. **A late jobs engine that grows with the population:** the Orbital Ring hires +1 % per
   1,000 citizens (×2 at 100,000) up to ×4 (200,000 jobs in a city of 300,000). It opens in
   the 14th city — one city after the Megastructures rung doubles housing — and from then on
   it is 45–75 % of the jobs column, the one term that scales with the thing the housing
   rungs inflate. The cap was ×12 while the session's jobs rungs ended at ×12; the
   2026-09-14 upgrade wave lifted them to ×17.3 (and to ×4.39 against housing ×3.75 in
   cities 20–23), and at ×12 the ring alone — 72–86 % of the column — held jobs/pop at
   2.0–4.3 for the back half of 12 h (median 2.02, 41 % of mature samples inside 0.8–2.0).
   Round 1 set ×5, which read 1.32 median on the greedy but pinned unemployment at exactly
   0 from hour 2 in every profile (human city 9 jobs/pop 2.34, greedy cities 20–23 2.2–3.8,
   the ring 50–86 % of the column — the flattest metric on the tree, per both round-1
   skeptics). Round 2 planned ×3 beside the upgrades' jobs-stack trim (Arcology Gardens jobs
   ×1.1, Civic Charter ×1.25, the Archives' dead growth term → ring housing ×1.5) with a
   hold-×4 clause if ×3 pushed a mature city under 0.8; measured on the round-2 tree (12 h,
   the three caps side by side): human jobs/pop cities 7–10 **0.78 / 0.93 / 1.14 / 0.80 at
   ×3** (cities 7 and 10 at 22 % / 20 % unemployment, the per-city gate red), **0.85 / 1.02 /
   1.26 / 0.95 at ×4** (15 / 0 / 0 / 5 %, every per-city and jobs/pop gate green), **0.91 /
   1.11 / 1.39 / 1.06 at ×5** (city 9 over the ≤ 1.3 line); the greedy's cities 25–28 read
   0.70 at ×3 on the probe. So ×4 — and **frozen** (round 3): the test's line moved every
   round ("≥ 4×" → "≥ 3×" → "≥ 2×" as the cap went ×12 → ×5 → ×4, a skeptic named the
   drift), so it now pins `cap === 4` and `jobs × cap === 200,000` exactly, 2.5× the ring's
   housing, with the three-cap measurement above inside the test's own text; any further
   move of that line is a refutation, not a tune.

Measured (12 h, `columns.mjs`): round 1 (ring ×5, 2026-09-14) read median jobs/pop in mature
cities (from the 5th, past run-minute 2) **1.32**, 77 % of 57 samples inside 0.8–2.0 (65 %
inside 1.0–1.6; min 0.97, max 2.38 — the cities above 2.0 were 20–23 and 29–30, where the
global jobs mod ran ahead of housing). On the round-2 tree with the upgrades' jobs trims in
flight the probe read, with the opening-minute filter / without it: ring ×3 median 0.88 /
0.80 and 52 % / 51 % in span; ×4 median 0.90 / 0.90, 64 % / 63 %; ×5 median 1.04 / 0.99,
69 % / 67 %; and once round 2 landed, **×4 median 1.20 / 1.16, 78 % / 72 % in span** (min
0.71, max 1.67) — the 12 unfiltered misses beyond the 6 opening-minute samples are cities
25–28 and 32 at 0.71–0.76 (the ring 55–64 % of the jobs column, global mods housing ×18.75 /
jobs ×7.91): the housing rungs landing ahead of the jobs terms, an upgrades re-pairing, not
a cap this folder can buy back without re-pinning unemployment to 0. With the round-3
re-pairing as landed (before balance's tail re-placement; 36 foundings) the same probe reads
**median 0.99 / 0.99, 94.8 % / 92.2 % in span** (min 0.69, max 1.28): both in-span lines
clear the rule, the median sits one hundredth under the probe's 1.0 floor. The unfiltered
misses are cities 16–18 at 0.69–0.82 (global mods housing ×3.75 / jobs ×2.25, the
Megastructures step before the jobs terms catch up; the ring is 20–44 % of the column
there) and two opening minutes (cities 30, 36); cities 23–26 sit at 0.82–0.89. The median
floor is *not* moved to pass it: the contract's per-city band is now 0.85–1.3 with a
deliberate 2–8 % jobless stretch after each housing step, so a median a hair under 1.0 is
the state the plan asks for, and re-deriving `RATIO_MIN` from that band is an integrator
decision. (A scratch A/B of the plan's effects with the plan's 1× fleet prices read
1.04 / 1.02 and 96 % / 94 %, worst complete cities 24–26 at 0.83–0.87.) That decision did
not have to be made: **with balance's tail re-placement and Blueprints ×1.12 sweep landed
(wave 2 round 2) the same probe reads median 1.1 / 1.1, 98 % / 97 % in span** (67 % / 69 %
inside 1.0–1.6; min 0.75, max 1.27 filtered / 3.54 unfiltered — one opening-minute sample),
35 foundings, ring city 14, elevator city 33; 6 h median 1.11 / 1.12, 95 % / 93 %. The
1.0 floor stays as written, cleared with a tenth to spare.

**Both readings are judged, not just printed** (round 3 — a round-1 skeptic noted the probe
quoted the ≥ 75 % rule and applied it to the filtered set only): `columns.mjs` lists a miss
on either reading as a problem, and the test asserts the filtered *and* the unfiltered
in-span share against `RATIO_SHARE` at 6 h and at 12 h (`ratio` / `ratio.unfiltered` in
`--json`, the two summary lines in text). The filtered reading is still the one the
opening-minute reasoning belongs to — a replay's first two minutes are an all-housing spree
by design (a 13th city at run-minute 0.2 reads two factories and a house, 2.7 jobs per
citizen; a 5th at 0.1 reads cottages only, ratio 0) — and those samples are 9–14 % of the
mature set, so the unfiltered line passes only when nearly every mid-city sample is in span,
which is the stricter reading of the same rule. The probe's rule is that median inside
1.0–1.6 and ≥ 75 % of mature samples inside 0.8–2.0 — 20 % unemployment at worst, at most
half a sticker decorative — because the 1.0–1.6 band is 1.6× wide and the rung asymmetry
above swings the ratio ~2× over a session; holding the narrow band everywhere needs the
housing and jobs rungs (upgrades) to grow at the same rate, not a buildings number. The
test spawns the probe at 6 h (round-2 tree ×4: median 1.29 / 1.24, 100 % / 93 %; A/B
1.07 / 1.06, 91 % / 88 %) and at 12 h (the numbers above).

## Tier 5

Before this pass every card opened inside the first city (the stadium at 39 of its 42
minutes) and the remaining ~11 hours introduced no building. Two legacy-gated
megastructures fix that, each on a legacy tier the simulation already announces:

| card | column | gate | opens (12 h bot) | price | curve | identity |
|---|---|---|---|---|---|---|
| Orbital Ring 🛸 | residential | legacy ≥ 500 | city 14 (~3.6 h) | $2e11 | ×3 | 80,000 housing (eighty arcologies), 50,000 jobs ×(1 + pop/100k) up to ×4, +0.5 joy, draws 1.2 GW ("≈ 20 × Fusion Reactor") |
| Space Elevator 🚀 | power | legacy ≥ 300,000 | city 33 (~11.8 h) | $2e13 | ×3 | 600 MW (ten fusion reactors) +10 % per ring up to ×2, 40,000 jobs, +0.3 joy, upkeep $15k/s (nuclear's $0.025/MW/s, half of it at ×2) |

The elevator was 3 GW (fifty reactors) with the counterweights up to ×3 until round 2: at
that size it was 61 % of the human 24 h fleet's sticker capacity (11 units) and 65 % of the
greedy's at 12 h, and alone took the human's city 13 from 5.4× to 13× cap/demand and the
greedy's city 34 to 14.7× (round-1 skeptics). 600 MW at ×2 keeps it the biggest generator
in the game (the test holds 10–12 reactors) at ~20 % of the late fleet's capacity; the
price, the ×3 curve and the city-33 gate — the novelty that keeps that city open past 12 h
— are untouched, and the upkeep moves with the output so the cable still bills nuclear's
$0.025/MW/s at the sticker. Config mirrors the three numbers in `config.buildings.elevator`
(the `data.js matches config` test holds them equal).

Both are pace-inert by construction — housing, jobs, power and joy are "variety, not pace"
in a replay (config.js) — and priced at seconds of their opening city's income so they are
bought in the city they open (measured: both first bought 1.7–2.6 min after opening). The
×3 curve is what keeps them a target rather than a spree: a city buys a handful in its
opening minutes and the next one costs more than the spree reached, so the bot buys rings
in every one of the 20 cities from the 14th (132 in 12 h, `columns.mjs`, 2026-09-14) and
elevators in the 33rd (10, the city open at 12 h), without eating the cash that re-buys the
core ladder. (The
elevator's gate was re-pinned from 15,000 legacy / city 24 to 300,000 / city 33 by the
integrator so it follows the Imperial Charter's city and stays the never-bought item of
its own; config and `data.js` agree, the gate-table test below holds this row to both.) Their rules are the
module's normal vocabulary (`synergy`, a pinned `costGrowth`, a `{ legacy }` unlock mirror
that `cadence.mjs` and `catalogue.mjs` print as `legacy N`); the UI's locked card shows the
hint ("Bank 500 legacy") and no progress bar, since its mirror reader knows pop and demand.
The ring's bill is stated against the fusion reactor, not the elevator (a card the player has
not seen when the ring opens): `powerHintFor` sizes a draw against the largest generator no
more than twice it, and the ladder it is given is the first-city generators only — a
legacy-gated card is never the unit — so the elevator's 600 MW (within 2× of the ring's
1.2 GW) never becomes the unit the ring's bill, or a 10 GW tier-4 bill, is quoted in.

## Power

Each generator is sized to cover a handful of same-tier consumers and the steps between
tiers are ~5–20× (windmill 4 MW → coal 80 → solar 900 → nuclear 12,000 → fusion 60,000 →
elevator 600,000), so no plant makes the one below it pointless the moment it unlocks.

**Tier-4 stickers are power bills, not rates.** Per citizen or job a tier-4 consumer draws
11–26× the tier-3 intensity of its column: the arcology 6.5 MW per citizen against the
tower's 0.25 (26×), the tech campus 6.4 MW per job against the refinery's 0.6 (11×), the
financial district 5.1 against the mall's 0.2 (26×). That is deliberate — the late Power tab
has to keep asking for money, and a $120k arcology that quietly needs half a nuclear plant
is the late game's first real bill — but it must be *stated*, so every consumer whose draw
is at least one windmill carries a derived `powerHint` ("Draws 6,500 MW ≈ 0.5 × Nuclear
Plant", sized against the largest generator whose output is no more than twice the draw;
the stadium's 3,850 MW reads "≈ 4.3 × Solar Farm"). The test pins the band as ≤ 50× (and ≥ 4×
for the arcology) on both the resolved defs and this folder's defaults, so the doc and the
number cannot drift apart; the four tier-4 bills each stay within two nuclear plants so the
hint reads as a count, not a fleet. (Balance trimmed the four draws from 10,500 / 18,700 /
16,500 / 6,200 in this pass when it re-pinned the strain rule; `data.js` mirrors the trim.)

Late-game power tension comes from **grid strain** (`demandGrowth`) on top of the bill:
every further tier-4 unit adds to the draw of all of them. This folder's rule is +2.5 % per
unit up to ×1.5 (a felt tax: a +5 %/×2 strain put the first city at the brownout floor from
minute 28 to its founding, +2.5 %/×1.5 costs it about a minute); config currently re-pins
it to +12.5 % per unit up to ×40 (balance's lever on late power) and the card prints whichever
rule is resolved. Nuclear carries a real running cost (upkeep) — that is the bill fusion is
there to replace.

The fusion reactor is priced so that **the fleet is the price of admission**: at its sticker
($67/MW) a reactor is dearer per MW than a nuclear plant ($33), at ×2 (10 plants) it matches,
at ×3 it is the cheapest MW in the game ($22) and carries a third of the fleet's upkeep per
MW. The test pins that ordering for both the defaults and the resolved defs so neither can
drift into a $/MW sort. The elevator repeats the shape one tier up: nuclear's upkeep per MW
at its sticker, half of it with ten rings anchored to the cable.

**Where the under-power time is, and what moves it.** The contract asks for 3–20 % of a 12 h
bot session under full power. Through round 2 every one of those minutes was in the first
city and the first replays; from hour 2 on the grid was never short, because a replay's
income buys a plant the tick it is needed and the strain rule is on the card (the build
card prints the rule and "×N now", so a grid-ahead player — and the human bot's strain-aware
guard, restored in round 3 — foresees a batch's strain and never browns out on it). What
moves the early share is the price of the *fix* the bot reaches for in a brownout: with the
windmill retired at eight the coal plant is that fix from minute 5.4 (34 MW of draw; the
eight windmills give 32), so its price is the lever ($2,500 shipped). The first plant is
bought 4.0 minutes after it opens.

**Round 3: power binds by content, sized per city (upgrades, not this folder).** The
whole-session power stack folds to supply ×5.49 against demand ×0.64 × 1.15 = ×0.736, net
**×7.5** (round 1 left it at ×8.6; the pre-wave ×29 → ~×2.8 sentence is gone everywhere),
and the 1.6–2.0× post-stack plateau is the accepted late surplus written into
`docs/DESIGN.md`. The step a player did not choose to power — the only kind the card cannot
foresee — is an upgrade's draw clause: the four mid-fleet employer rungs (Trading Floors
II/III, Campus Expansion II/III, gates 90 / 130 of their fleet) each carry a +8 % city-wide
draw, **×1.08⁴ = ×1.36 per city**, not kept across a founding so it never compounds, and
the Energy Charter's +50 % supply is paired with +15 % draw (net ×1.30). This folder's
numbers stay where round 2 left them — the elevator 600 MW / ×2 / $15k upkeep mirror, the
tier-4 bills and the strain rule — and the measurement (Lights Out ≥ 30 s at ratio ≤ 0.95
in a human city ≥ 4, under-power ≥ 1 % of ticks in hours 3–12 on the greedy) is the
integrator's sim on the final tree, not a reading this folder can make on its own.

## Air quality and joy

Polluters are mild per unit (factory, coal, refinery) and clean tech pushes the other way
(solar, nuclear, tech campus, fusion, the elevator), so a late city can scrub its own smog by
choosing its power mix; config caps the total penalty (`happiness.pollutionCap`) the same way
civic saturates. Happiness on a non-civic card is either felt or absent: the arcology carries
0.10 (two parks' worth — a sealed block with its own gardens and clinics) because at its
price a 0.02 would show on the card as a benefit no player could ever measure; the ring 0.5
and the elevator 0.3 for the same reason; the mall carries none.

## Signature mechanics

Twelve buildings carry a per-unit stat that scales with the city. The rule is data —
`synergy: { stat, source, per, cap, text }` means `stat = base × min(cap, 1 + source / per)`,
where source is `pop`, `employed` or `building:<id>` — and `index.js` evaluates it in a tick
handler that runs just before the simulation, exposing the result through `liveStat(id, stat)`.
A rule on a stat the building does not carry (the registry defaults every stat to 0, so a 0
base counts) is reported through `reportError` and registers nothing, like a malformed rule.

| building | stat | source | cap |
|---|---|---|---|
| house | housing | apartment blocks (25 → +100 %) | ×3 |
| arcology | housing | financial districts (40 → +100 %) | ×3 |
| shop | income | office blocks (25 → +100 %) | ×3 |
| mall | income | population (5,000 → +100 %) | ×3 |
| refinery | income | factories (50 → +100 %) | ×2 |
| techpark | income | schools (20 → +100 %) | ×1.75 |
| financial | income | employed citizens (20,000 → +100 %) | ×2.5 |
| stadium | jobs | population (20,000 → +100 %) | ×2 |
| ring | jobs | population (100,000 → +100 %) | ×4 |
| solar | powerGen | city parks (50 → +100 %) | ×1.5 |
| fusion | powerGen | nuclear plants (10 → +100 %) | ×3 |
| elevator | powerGen | orbital rings (10 → +100 %) | ×2 |

The stadium scales through its payroll rather than its tills on purpose. Measured
(`tools/economy-sim.mjs`, 6 h and 12 h, 2026-09-07 config): a ticket-sales rule (income ×3
at 40k citizens) lifted late-city income enough to re-place the balance module's
one-new-rung-per-city ladder — 5 of 21 cities after the 5th introduced nothing new at 6 h,
9 of 30 at 12 h, against 0 and 1 for the catalogue without it — and a ×2 cap still cost two
cities. A jobs rule reads identically to the catalogue without it on every contract metric
while giving the card a stat that grows with the city; its cap is ×2 now that the district
carries 2,000 jobs (see *Jobs and housing*).

The three power hooks give the Power tab a second axis: a green city's solar farms
out-produce their sticker, a reactor fleet is what makes fusion pay, and a ring fleet is what
makes the elevator pay. Static two-axis identities: the arcology also employs 500 (a
self-contained block), the stadium pays and cheers, the tech campus hires and cleans the air,
the ring houses, hires and cheers, the elevator powers, hires and cheers.

## Unlock spacing

Population gates are placed just below the population the greedy bot has when the price
frontier reaches each building, so a freshly unlocked card is affordable within a few minutes
rather than glowing unaffordably for a quarter hour. The contract, measured from minute 5
(the opening minutes deal tier-1 cards every few seconds on purpose):

- no two cards open within 90 s of each other;
- a card is bought within 5 min of opening (4 min for a tier-4 card);
- no 7 min pass with nothing new — including the tail before the first founding, which is
  what the fusion reactor's first-city gate (39,000 citizens, a trophy the city reaches at
  30.6 min and buys in the same bot window; `legacy >= 1` stays the normal route) is for.

The early gates are placed on the curve `cadence.mjs --curve` prints. The population crawls
from 20 to 60 citizens on cottages between minutes 1 and 5 and then jumps with the apartment
spree, so the factory opens at 65 (4.8 min; it was 45 / 4.1 min before the curve moved, and at 30 it opened at 1.9 and glowed for seven
minutes while income was $3–6/s) and the office block at 200 (7.7 min, bought at 10.4; at 80
it opened at 5.3, 70 s before the coal plant, and glowed for five minutes). The coal plant
gates on 34 MW of draw (5.4 min): the apartment spree lifts the draw 25 → 34 MW between 5.5
and 6.0 and the next purchase jumps it straight to 40, so any gate from 35 to 40 opened in
the same second, 78 s before the office. The hospital sits at 5,000 (20.4 min), 2.8 min after
the solar farm and 2.6 before the arcology (5,400 landed 90 s before it once the tier-4 gates
moved).

`cadence.mjs` prints open / first-buy per building, names the owner of each fault
(`buildings` when a field in data.js can fix it, `config` when `config.buildings[id]` pins
every field involved, with the field named) and exits 1 on any fault; a legacy-only card is
listed with a dash (it cannot open in a first city; `columns.mjs` covers the session it opens
in). `buildings.test.mjs` spawns it and fails on a buildings-owned fault; config-owned faults
are reported as a todo so they cannot hide either. Measured on the round-3 tree (the
upgrades' F7 Green Belts clause — cottages and apartment blocks hold +10 %, a $1,500
first-city rung — lifted the curve from minute 7.5, so the **tower gate moved 250 → 300**
(at 250 it opened 32 s after the office) and the **mall gate 3,000 → 3,100** (at 3,000, 82 s
after the refinery); config pins neither gate): factory 4.8 → bought 9.4 · coal 5.4 → 9.3 ·
office 7.6 → 10.1 · tower 9.5 → 11.5 · school 11.0 → 12.9 · refinery 13.3 → 18.0 · mall 15.0
→ 18.8 · solar 16.6 → 19.8 · hospital 19.5 → 22.9 · arcology 21.9 → 24.5 · nuclear 25.9 →
27.6 · campus 27.7 → 29.6 · district 31.2 → 34.1 · fusion 33.9 → 35.9 · stadium 36.1 → 38.2;
every card opens ≥ 90 s after the last and is bought within 4.7 min; the first city founds
at 40.2 min. (Round 2 read factory 4.1 → 7.7 · office 7.7 → 10.4 · tower 9.6 → 11.5 · mall
15.2 → 18.9 · stadium 37.9 → 41.7, first city 42.5.) Cadence is sensitive to every sibling
module's numbers — re-run the probe before quoting these.

**Wave 3 (2026-09-15).** On the wave-2 tree the probe read four faults, three of them with a
data.js field in them: office and tower 28 s apart (200 / 300 citizens, 7.0 and 7.4 min),
financial and fusion 70 s, fusion and stadium 30 s. The office cannot move down —
`buildings.test.mjs` pins `office.unlockS - coal.unlockS >= 60 s` and the coal plant opens at
5.4 min against the office's 7.0 — so the office → refinery band (7.0 → 12.0 min, four gates,
three gaps, 4.5 min of rule in 5.0 min of band) only fits if the two middle gates spread
evenly across it: **tower 300 → 420** and **school 500 → 820**, which land them at 8.5 and
10.2 min (90 / 102 / 108 s gaps). **Fusion 36,000 → 39,000** puts the reactor 114 s behind the
financial district (28.7 → 30.6). 39,000 and not 40,000 because the catalogue's own ordering
rule wants ≥ 15 % between neighbouring defaults.

The other two faults had no data.js field in them — nuclear → campus (88 s) and fusion →
stadium (14 s) were `config.buildings` gates at both ends. Balance landed both moves in the
mirror pass: **campus 16,500 → 18,500** and **stadium 45,000 → 73,000**, and `data.js` mirrors
them. Reading as shipped: office 7.0 → bought 8.8 · tower 8.5 → 9.9 ·
school 10.2 → 11.6 · refinery 12.0 → 16.3 · mall 13.7 → 17.3 · solar 15.2 → 18.3 · hospital
18.1 → 21.4 · arcology 20.4 → 23.1 · nuclear 23.8 → 24.8 · campus 25.9 → 27.2 · district 28.7
→ 28.8 · fusion 30.6 → 30.6 · stadium 32.4 → 32.4; first city 35.0 min, 0 errors, and
`node src/buildings/cadence.mjs` prints "no spacing, affordability or dead-air problems".

Why those two config gates and not others: the fusion → stadium window was bounded at both
ends by config (district 28.7, stadium 30.8, 126 s apart, and two 90 s gaps need 180 s), so no
fusion gate inside it could work — the stadium's own gate had to move. The pop curve is very
steep there (38,817 at 30.5 min, 62,873 at 31.5, 71,109 at 32.3), which is why 66,000 and
70,000 only bought 82 s and 88 s and 73,000 is the shipped value. Also measured and rejected:
dropping fusion to 23,000 so it opens *below* the district
(27.2 → bought 28.6) clears every buildings-owned fault on the shipped config, but it demotes
the reactor from the first city's trophy card and simply moves the fault onto config as a
58 s district → stadium gap.

The windmill gates on live power demand, so the first cottage is always followed by one dark
tick. Measured (12 h sim): opening the windmill from the start drops the "happiness dips below
1.0" count from 19 to 8 of 32 cities, under the ≥ 50 % contract in docs/DESIGN.md — replay
cities bottom out at 0.96 and only the tick-0 brownout puts them under — so the gate stays
until the simulation's civic pressure comes from elsewhere.

## Measured (12 h greedy bot, `logs/sim-fix-buildings.json`, 2026-09-07 fix tree)

The tree moved under this pass — balance re-pinned the tier-4 draws, gates and the strain
rule and simulation added (then switched off) a founding seed window while the catalogue was
being edited — so the reading that matters is a same-tree A/B: the previous catalogue
(`scratchpad/sim-A-orig.json`) against this one, minutes apart.

| | previous catalogue | this catalogue |
|---|---|---|
| foundings / first city | 28 / 44.6 min | 35 / 42.5 min |
| every building and upgrade bought | no (5 late rungs never reached) | yes |
| new building after the first city | none | ring in city 14, elevator in city 24 (now 33 after the gate re-pin) |
| under-power share / floor | 4.3 % / 0.60 | 4.2 % / 0.60 |
| happiness dips below 1.0 | 21 of 28 cities | 21 of 35 |
| purchase tension (reach) | 55 % | 42 % |
| legacy / money peak | 70k / 1.8e14 | 745k / 6.9e16 |
| errors | 0 | 0 |
| contract | FAIL (cycle 23 ×1.35+, last cycle 55.7 min, 3 empty late cities) | FAIL (5 knees at ×1.37, 9 empty late cities, 4 of them past the last rung) |

The catalogue makes the bot 5–15 % faster from the 4th city on: with the jobs column
binding, its spend shifts from housing toward employers, which carry income, and the
session runs four cities past the ladder's last rung (city 30). The late ladder in
`config.upgrades` is placed by city on the old pace (`src/balance/place.mjs` re-prices it;
config.js says a retune elsewhere of more than ~1 % needs that), so the knees and the empty
cities are a re-placement, not a knob in this folder. Final city: 15 rings, 10 elevators,
8 windmills, 160–250 of every other type.

## Measured (round 2, 2026-09-14, `logs/sim-build-buildings.txt` and the plan's scratch A/B)

This folder's three round-2 changes were measured one at a time against the round-1
upgrades (scratch copies of the tree with `git show HEAD:src/upgrades/data.js`, greedy 12 h):
the knee alone leaves the greedy at 32 foundings, under-power 3.5 %, unemployment 0 % in
every city ≥ 5 and cap/demand by hour 1.11 … 1.34 1.55 1.91 4.16 5.78 (the elevator city is
not reached: 270k legacy at 12 h — round 1's 33rd founding at 710 min becomes a 33rd city
open from 710.6 in every variant, with cycles 1–24 identical to round 1's log to the
tenth); the ring at ×3 on top costs the greedy's cities 26–28 1.5–3 min each (13–15 %
unemployment, jobs/pop ≈ 0.87), which is what the ×4 hold above answers; the elevator trim
is nil at 12 h (never bought) and is a 24 h human reading (integrator's run). On the live
round-2 tree (upgrades and balance in flight) the human 6 h profile passes every buildings
gate line the sim prints; the greedy's hours 8–11 brown out at 50–94 % of ticks from city 25
with cap/demand 0.71–0.76 — the Ringworld District's demand term landing in city 24 against
the cut supply stack before balance re-places the ladder, with no elevator owned — and its
late unemployment is 33–51 % at every ring cap (see *Jobs and housing*): both are upstream
of this folder and reported to the integrator.

## Measured (round 3, 2026-09-14, `columns.mjs` on the round-2 tree and a scratch A/B)

The folder's changes this round: the frozen ring line, the unfiltered columns rule (judged
at 6 h and 12 h), the tower 250 → 300 and mall 3,000 → 3,100 gate re-spacing on the Green
Belts curve (*Unlock spacing*), and this file; the elevator 600 MW / ×2 / $15k mirror and
the ring ×4 are untouched. Readings, filtered / unfiltered in-span share (rule ≥ 75 % on
both), greedy bot: **round-2 tree** 12 h median 1.20 / 1.16, 78 % / 72 %, 34 foundings,
ring city 14 bought in every city to 34, elevator city 33 (690 min); 6 h 1.29 / 1.24,
100 % / 93 %. **Round-3 tree as landed** (upgrades' re-pairing — Civic jobs term removed,
Ringworld / Skyline jobs ×2.0, Shipyard ×1.25, Exchange Ring all jobs ×1.5, Blueprints
×1.15, fleet rungs II/III draw ×1.08, Energy Charter draw ×1.15, fleet rungs at their 1×
prices; core's strain-aware human guard; balance's tail re-placement and Blueprints sweep
not yet applied) 12 h median 0.99 / 0.99, **94.8 % / 92.2 %**, 36 foundings, ring city 14
bought in every city to 36, elevator city 33 (643 min), global mods at the last sample
housing ×37.5 / jobs ×21.09; 6 h passes both readings. The human 6 h profile on the same
tree (`logs/sim-build-buildings.txt`): 0 errors, cycles 45.5 16.0 20.9 62.3 76.4 67.8,
jobs/pop by complete city 1.22 / 1.09 / 1.06 (cities 4–6, the 0.85–1.3 gate green),
cap/demand by hour 1.07 1.56 1.54 1.54 1.34 1.07, no city ≥ 3×; the red lines are
upstream — unemployment 21 % in hour 6 (city 7's Megastructures step), the 2–15 % band in
0 of hours 3–6, Lights Out in 0 complete cities ≥ 4 under the strain-aware guard (city 7 in
progress reads 138 s under power), decision gaps 60 / 76 / 43 min in cities 4–6.
What was red in this folder's own suite on that tree — the 12 h probe's **median 0.99
against its 1.0 floor** — went green with **balance's tail re-placement and Blueprints
×1.12 sweep** (wave 2 round 2): 12 h median 1.1 / 1.1, 98 % / 97 % in span, min 0.75
(cities 16–18 no longer dip under 0.85), 35 foundings, ring city 14 bought in every city to
35, elevator city 33 (668 min); 6 h 1.11 / 1.12, 95 % / 93 %. The floor was not touched;
the whole suite (29 tests, both probes) passes on the shipped tree.

## Live-stat seam

`resources.computeDerived`, the bot scorer and the build card read the registered
definition's field (`registry.buildings.get(id).income`) directly. The scaled field of a
registered definition is therefore an *accessor* over the live store: reading it returns
`liveStat(id, stat)`, assigning to it re-pins the base. Anything new should call
`game.buildings.liveStat` / `baseStat` instead of reading the field. `game.buildings` also
carries `capOf(def)`, `powerHintFor(def, generators)` and `unitCost(def, i)` (the
two-segment unit price before mods) for tools, and `index.js` exports `DEFAULT_TIER_GROWTH`,
`DEFAULT_KNEE` and `DEFAULT_LATE_GROWTH` (the config ladder's fallback copies) for the tests
that hold them to config.

The card strings a definition carries are `synergy.text` (✦), `demandGrowth.text` (⚡, the
strain line — a config re-pin of per/cap without a text gets one from `strainText`) and the
derived `powerHint`; the UI renders all three under the stats. `ruleRatePct(rule)` is the
percentage a line must quote (per 1,000 citizens for a population or employed source, per
unit otherwise) and the test derives every line from it, so a card can never again quote
a rule's raw `per` as its rate (the ring's line once read 100× too small).
