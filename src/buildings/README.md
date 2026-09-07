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
node src/buildings/columns.mjs [--ticks N]  # 12 h session probe: jobs vs housing per city, upgrade-mod swing, tier-5 open/buy cities (exit 1 on a fault)
node src/buildings/buildings.test.mjs       # unit tests + both probes (cadence at the first founding, columns at 6 h)
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
different rates — housing ×1.9 by city 4, ×3.9 by city 14, ×19 by city 25, ×38 by city 30,
against jobs ×1.6 / ×1.8 / ×5.3 / ×9.2 (the `×hous ×jobs` columns of the probe). A sticker
ratio that reads 1.5 mid-session reads 0.4 by the end; the old 4,000-job district was the
number that made the *end* read 1.5, at the price of 3–7× for eight cities. So the catalogue
carries three things instead of one number:

1. **Stickers sized for the mid game:** the district 2,000 jobs (was 4,000), the campus
   1,800 (was 2,500), the stadium's game-day hiring capped at ×2 (was ×3). With every
   tier-3/4 card owned in equal numbers the set reads ~1.9 jobs per housing before the rungs
   move it (pinned by a test).
2. **The commuter belt:** arcology housing +2.5 % per financial district, ×3 at 80. The
   housing column follows the district fleet, which is what the bot actually buys; the base
   stays 1,000 because a 2,500 arcology tripped every later first-city gate within a minute,
   and the rule only reaches ×1.15 in the first city's last five minutes.
3. **A late jobs engine that grows with the population:** the Orbital Ring hires +1 % per
   1,000 citizens (×2 at 100,000) up to ×12 (600,000 jobs in a city of 1.1 M). It opens in the 14th city —
   one city after the Megastructures rung doubles housing — and from then on it is 60–80 %
   of the jobs column, the one term that scales with the thing the housing rungs inflate.

Measured (12 h, `columns.mjs`): median jobs/pop in mature cities (from the 5th) **1.48**,
84 % of samples inside 0.8–2.0 (45 % inside 1.0–1.6; the readings outside are the opening
two minutes of a replay, an all-housing spree by design), employed share 1.0 wherever the
ratio is ≥ 1. The probe's rule is that median inside 1.0–1.6 and ≥ 75 % of mature samples
inside 0.8–2.0 — 20 % unemployment at worst, at most half a sticker decorative — because the
1.0–1.6 band is 1.6× wide and the rung asymmetry above swings the ratio ~3.5× over a
session; holding the narrow band everywhere needs the housing and jobs rungs (upgrades) to
grow at the same rate, not a buildings number.

## Tier 5

Before this pass every card opened inside the first city (the stadium at 39 of its 42
minutes) and the remaining ~11 hours introduced no building. Two legacy-gated
megastructures fix that, each on a legacy tier the simulation already announces:

| card | column | gate | opens (12 h bot) | price | curve | identity |
|---|---|---|---|---|---|---|
| Orbital Ring 🛸 | residential | legacy ≥ 500 | city 14 (~3.8 h) | $2e11 | ×3 | 80,000 housing (eighty arcologies), 50,000 jobs ×(1 + pop/100k) up to ×12, +0.5 joy, draws 1.2 GW ("≈ 20 × Fusion Reactor") |
| Space Elevator 🚀 | power | legacy ≥ 300,000 | city 33 (~11.4 h) | $2e13 | ×3 | 3 GW (fifty fusion reactors) +10 % per ring up to ×3, 40,000 jobs, +0.3 joy, upkeep $75k/s (nuclear's $0.025/MW/s, a third of it at ×3) |

Both are pace-inert by construction — housing, jobs, power and joy are "variety, not pace"
in a replay (config.js) — and priced at seconds of their opening city's income so they are
bought in the city they open (measured: both first bought 1.7–2.6 min after opening). The
×3 curve is what keeps them a target rather than a spree: a city buys a handful in its
opening minutes and the next one costs more than the spree reached, so the bot buys rings
in every one of the 21 cities from the 14th (148 in 12 h, `columns.mjs`) and elevators in
both cities from the 33rd (20), without eating the cash that re-buys the core ladder. (The
elevator's gate was re-pinned from 15,000 legacy / city 24 to 300,000 / city 33 by the
integrator so it follows the Imperial Charter's city and stays the never-bought item of
its own; config and `data.js` agree, the gate-table test below holds this row to both.) Their rules are the
module's normal vocabulary (`synergy`, a pinned `costGrowth`, a `{ legacy }` unlock mirror
that `cadence.mjs` and `catalogue.mjs` print as `legacy N`); the UI's locked card shows the
hint ("Bank 500 legacy") and no progress bar, since its mirror reader knows pop and demand.
The ring's bill is stated against the fusion reactor, not the elevator (a card the player has
not seen when the ring opens): `powerHintFor` sizes a draw against the largest generator no
more than twice it, and the elevator's 3 GW never becomes the unit a 10 GW bill is quoted in.

## Power

Each generator is sized to cover a handful of same-tier consumers and the steps between
tiers are ~11–50× (windmill 4 MW → coal 80 → solar 900 → nuclear 12,000 → fusion 60,000 →
elevator 3,000,000), so no plant makes the one below it pointless the moment it unlocks.

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
at its sticker, a third of it with thirty rings anchored to the cable.

**Where the under-power time is, and what moves it.** The contract asks for 3–20 % of a 12 h
bot session under full power. Every one of those minutes is in the first city and the first
replays; from hour 2 on the grid is never short, because a replay's income buys a plant the
tick it is needed. What moves the share is the price of the *fix* the bot reaches for in a
brownout: with the windmill retired at eight the coal plant is that fix from minute 5.4 (34
MW of draw; the eight windmills give 32), so its price is the lever ($2,500 shipped). The
first plant is bought 4.0 minutes after it opens.

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
| ring | jobs | population (100,000 → +100 %) | ×12 |
| solar | powerGen | city parks (50 → +100 %) | ×1.5 |
| fusion | powerGen | nuclear plants (10 → +100 %) | ×3 |
| elevator | powerGen | orbital rings (10 → +100 %) | ×3 |

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
  what the fusion reactor's first-city gate (36,000 citizens, a trophy the city reaches at
  36.1 min and buys 2.3 minutes later; `legacy >= 1` stays the normal route) is for.

The early gates are placed on the curve `cadence.mjs --curve` prints. The population crawls
from 20 to 60 citizens on cottages between minutes 1 and 5 and then jumps with the apartment
spree, so the factory opens at 45 (4.1 min; at 30 it opened at 1.9 and glowed for seven
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
are reported as a todo so they cannot hide either. Measured on this tree: factory 4.1 →
bought 7.7 · coal 5.4 → 9.4 · office 7.7 → 10.4 · tower 9.6 → 11.5 · school 11.4 → 13.0 ·
refinery 13.7 → 17.8 · mall 15.2 → 18.9 · solar 17.5 → 19.7 · hospital 20.4 → 24.5 · arcology
22.9 → 26.5 · nuclear 27.1 → 29.3 · campus 29.8 → 32.1 · district 32.3 → 34.9 · fusion 36.1 →
38.4 · stadium 37.9 → 41.7; every card opens ≥ 90 s after the last and is bought within 4.1
min; the first city founds at 42.5 min. Cadence is sensitive to every sibling module's
numbers — re-run the probe before quoting these.

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

## Live-stat seam

`resources.computeDerived`, the bot scorer and the build card read the registered
definition's field (`registry.buildings.get(id).income`) directly. The scaled field of a
registered definition is therefore an *accessor* over the live store: reading it returns
`liveStat(id, stat)`, assigning to it re-pins the base. Anything new should call
`game.buildings.liveStat` / `baseStat` instead of reading the field. `game.buildings` also
carries `capOf(def)` and `powerHintFor(def, generators)` for tools, and `index.js` exports
`DEFAULT_TIER_GROWTH` (the config ladder's fallback copy) for the test that holds it to config.

The card strings a definition carries are `synergy.text` (✦), `demandGrowth.text` (⚡, the
strain line — a config re-pin of per/cap without a text gets one from `strainText`) and the
derived `powerHint`; the UI renders all three under the stats. `ruleRatePct(rule)` is the
percentage a line must quote (per 1,000 citizens for a population or employed source, per
unit otherwise) and the test derives every line from it, so a card can never again quote
a rule's raw `per` as its rate (the ring's line once read 100× too small).
