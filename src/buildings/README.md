# Buildings — design rationale

`data.js` is the catalogue: 20 buildings, five categories × four tiers, pure data. This
file is *why* the numbers in it have the shape they have. Since the 2026-09-07 polish pass
the numbers in `data.js` **are the shipped numbers**: `src/balance/config.js` still re-pins
fifteen buildings in `config.buildings`, but with values identical to the defaults (the test
`data.js matches config` holds them together), so a config import failure ships the ladder
the balance sim was run on rather than a stale sketch. To see a genuine delta, or to quote
what the game ships after a balance change, run

```
node src/buildings/catalogue.mjs          # resolved catalogue, default in brackets where config differs
node src/buildings/cadence.mjs            # first-city open / first-buy probe (exit 1 on a fault)
node src/buildings/buildings.test.mjs     # unit tests + the probe
```

## Columns and tiers

- **Residential is the cheap column, jobs the expensive one.** Citizens arrive first, then
  the city has to find them work, which is where the money is. A tier-4 card is a decision
  rather than a bigger copy of tier 3 (see *Signature mechanics*).
- **Cost growth** comes from `config.cost.tierGrowth[tier]` (shipped 1.18 / 1.16 / 1.13 /
  1.112) unless the card pins its own: the park (1.2), school and hospital (1.18) grow faster
  because a civic card's happiness saturates (`config.happiness.civicCap`) and a flat curve
  would let a player buy forty of them for nothing. The stadium deliberately does *not* carry
  that exception — by the time it opens the civic curve is full, so it is bought as a
  franchise and priced like the other tier-4 cards so a fleet is buildable.
- **Late identity for the cheap column.** Three tier-1 cards are the *source* of a higher
  tier's signature rule (factory → refinery, park → solar farm, school → tech campus), and
  the two that were pure sink fodder scale *with* the tier above them instead: the cottage's
  housing grows with apartment blocks (+4 % each, ×3), the corner shop's income with office
  blocks (same curve). A late city keeps buying them for a reason it can read on the card.
- **The windmill retires.** It has no late role on purpose: a ×2 cost curve ($40, $80, …
  $81,920 for the 12th) and a hard `maxCount: 12`. Core owns the cap (`api.buy` and
  `maxAffordable` refuse past it, `api.buildings()` rows carry `maxed` and `maxCount` so the
  card can print "12/12 built"); `index.js` also rolls back any purchase that still lands
  above the cap, refunding the excess units' exact share of the price, so an older core can
  never let Buy Max pay $1e16 for 4 MW — which is what the 49th windmill cost in the 12 h sim
  before the cap (40 % of that city's cash). The cap changes the bot's behaviour, see *Power*.

## Power

Each generator is sized to cover a handful of same-tier consumers and the steps between
tiers are ~11–20× (windmill 4 MW → coal 80 → solar 900 → nuclear 12,000 → fusion 60,000), so
no plant makes the one below it pointless the moment it unlocks.

**Tier-4 stickers are power bills, not rates.** Per citizen or job a tier-4 consumer draws
12–42× the tier-3 intensity of its column: the arcology 10.5 MW per citizen against the
tower's 0.25 (42×), the tech campus 7.5 MW per job against the refinery's 0.6 (12×), the
financial district 4.1 against the mall's 0.2 (21×). That is deliberate — the late Power tab
has to keep asking for money, and a $120k arcology that quietly needs ~$350k of nuclear plant
is the late game's first real bill — but it must be *stated*, so every consumer whose draw
is at least one windmill carries a derived `powerHint` ("Draws 10,500 MW ≈ 0.9 × Nuclear
Plant", sized against the largest generator whose output is no more than twice the draw).
The test pins the 12–42× band as ≤ 50× (and ≥ 4× for the arcology) on both the resolved defs
and this folder's defaults, so the doc and the number cannot drift apart again; the four
tier-4 bills each stay within two nuclear plants so the hint reads as a count, not a fleet.

Late-game power tension comes from **grid strain** (`demandGrowth`) on top of the bill: every
further tier-4 unit adds 2.5 % to the draw of all of them (×1.5 at 21 units), mirroring cost
growth, so a tier-4 fleet asks for half again the reactors its stickers add up to. The strain
is a felt tax rather than the headline: a +5 %/×2 strain put the first city at the brownout
floor from minute 28 to its founding; +2.5 %/×1.5 costs it about a minute. Nuclear carries a
real running cost (upkeep) — that is the bill fusion is there to replace.

The fusion reactor is priced so that **the fleet is the price of admission**: at its sticker
($67/MW) a reactor is dearer per MW than a nuclear plant ($33), at ×2 (10 plants) it matches,
at ×3 it is the cheapest MW in the game ($22) and carries a third of the fleet's upkeep per
MW. The test pins that ordering for both the defaults and the resolved defs so neither can
drift into a $/MW sort.

**Where the under-power time is, and what moves it.** The contract asks for 3–20 % of a 12 h
bot session under full power. Measured (`logs/sim-polish-buildings.json`), every one of those
minutes is in the first city (minutes 2–8 and 26–40) and the first three replays; from hour
2 on the grid is never short, because a replay's income buys a plant the tick it is needed.
Generator strength barely moves the share (nuclear at 10 GW, the solar cap at ×1.25, strain
at +4 %/unit or ×1.75, the fusion cap at ×2.5, solar opening at 4,500 citizens: 2.6–2.8 %).
What moves it is the price of the *fix* the bot reaches for: before the cap the "cheapest
generator" it saved toward during a brownout was often a 4 MW windmill, a decoy that kept the
city dark longer (3.5 % without the cap, 2.6 % with it). With the windmill retired the coal
plant is that fix from minute 6, so its price is the lever: $1,500 read 2.6 %, **$2,500 reads
3.1 %** (shipped), $3,000 3.3 %. The first plant is still bought 2.6 minutes after it opens.

## Air quality and joy

Polluters are mild per unit (factory, coal, refinery) and clean tech pushes the other way
(solar, nuclear, tech campus, fusion), so a late city can scrub its own smog by choosing its
power mix; config caps the total penalty (`happiness.pollutionCap`) the same way civic
saturates. Happiness on a non-civic card is either felt or absent: the arcology carries 0.10
(two parks' worth — a sealed block with its own gardens and clinics) because at its price a
0.02 would show on the card as a benefit no player could ever measure; the mall carries none
for the same reason.

## Signature mechanics

Nine buildings carry a per-unit stat that scales with the city. The rule is data —
`synergy: { stat, source, per, cap, text }` means `stat = base × min(cap, 1 + source / per)`,
where source is `pop`, `employed` or `building:<id>` — and `index.js` evaluates it in a tick
handler that runs just before the simulation, exposing the result through `liveStat(id, stat)`.
A rule on a stat the building does not carry (the registry defaults every stat to 0, so a 0
base counts) is reported through `reportError` and registers nothing, like a malformed rule.

| building | stat | source | cap |
|---|---|---|---|
| house | housing | apartment blocks (25 → +100 %) | ×3 |
| shop | income | office blocks (25 → +100 %) | ×3 |
| mall | income | population (5,000 → +100 %) | ×3 |
| refinery | income | factories (50 → +100 %) | ×2 |
| techpark | income | schools (20 → +100 %) | ×1.75 |
| financial | income | employed citizens (20,000 → +100 %) | ×2.5 |
| stadium | jobs | population (20,000 → +100 %) | ×3 |
| solar | powerGen | city parks (50 → +100 %) | ×1.5 |
| fusion | powerGen | nuclear plants (10 → +100 %) | ×3 |

The stadium scales through its payroll rather than its tills on purpose. Measured
(`tools/economy-sim.mjs`, 6 h and 12 h, 2026-09-07 config): a ticket-sales rule (income ×3
at 40k citizens) lifted late-city income enough to re-place the balance module's
one-new-rung-per-city ladder — 5 of 21 cities after the 5th introduced nothing new at 6 h,
9 of 30 at 12 h, against 0 and 1 for the catalogue without it — and a ×2 cap still cost two
cities. A jobs rule at ×3 reads identically to the catalogue without it on every contract
metric (cycles, tension, under-power, dips, novelty) while giving the card a stat that
grows with the city: 1,500 jobs at 40k citizens is $525/s of wages and an unemployment fix
in the replay cities where happiness dips.

The two power hooks give the Power tab a second axis: a green city's solar farms out-produce
their sticker, and a reactor fleet is what makes fusion pay. Static two-axis identities: the
arcology also employs 500 (a self-contained block), the stadium pays and cheers, the tech
campus hires and cleans the air.

## Unlock spacing

Population gates are placed just below the population the greedy bot has when the price
frontier reaches each building, so a freshly unlocked card is affordable within a few minutes
rather than glowing unaffordably for a quarter hour. The contract, measured from minute 5
(the opening minutes deal tier-1 cards every few seconds on purpose):

- no two cards open within 90 s of each other;
- a card is bought within 5 min of opening (4 min for a tier-4 card);
- no 7 min pass with nothing new — including the tail before the first founding, which is
  what the fusion reactor's first-city gate (28,000 citizens, a trophy the city reaches at
  35 min and buys 3.6 minutes later; `legacy >= 1` stays the normal route) is for. At 35,000
  it opened on the end of the 29,750-citizen plateau, 26 s before the stadium and 8 minutes
  after the financial district.

Inside the tutorial window two cards used to land in one second: the coal plant (demand
20 MW) and the office block (80 citizens) both at 4.8 min, and 24 MW still fell in that
second because the apartment spree jumps the draw from 18 to 34 MW. The gate is 40 MW —
ten windmills' worth — which opens the plant at 6.2 min, 84 s after the office, and shortens
its unaffordable glow from 3.3 to 2.6 min.

`cadence.mjs` prints open / first-buy per building, names the owner of each fault
(`buildings` when a field in data.js can fix it, `config` when `config.buildings[id]` pins
every field involved, with the field named) and exits 1 on any fault. `buildings.test.mjs`
spawns it and fails on a buildings-owned fault; config-owned faults are reported as a todo so
they cannot hide either. Measured on the polish tree: every card opens ≥ 90 s after the last
and is bought within 4.9 min (coal 2.6, arcology 1.9, nuclear 0.3, campus 1.0, financial 4.0,
fusion 3.6, stadium 1.0); the first city founds at 41.8 min. Cadence is sensitive to every
sibling module's numbers — re-run the probe before quoting these.

The windmill gates on live power demand, so the first cottage is always followed by one dark
tick. Measured (12 h sim): opening the windmill from the start drops the "happiness dips below
1.0" count from 19 to 8 of 32 cities, under the ≥ 50 % contract in docs/DESIGN.md — replay
cities bottom out at 0.96 and only the tick-0 brownout puts them under — so the gate stays
until the simulation's civic pressure comes from elsewhere.

## Measured (12 h greedy bot, `logs/sim-polish-buildings.json`, 2026-09-07 polish tree)

32 foundings (first at 41.8 min, cycles 12 · 11 · 6.9 · 6.3 · 8.2 … 50 max · last 23 min);
every building and upgrade bought; under-power 3.1 % of the session, floor 0.60; happiness
dips in 21 of 32 cities; 0 empty late cycles; legacy 270,557 (127,476 spent); money peak
2.7e16, 1.7e15 at the end; 0 errors; contract PASS. The final city holds 12 windmills (49
before the cap).

## Live-stat seam

`resources.computeDerived`, the bot scorer and the build card read the registered
definition's field (`registry.buildings.get(id).income`) directly. The scaled field of a
registered definition is therefore an *accessor* over the live store: reading it returns
`liveStat(id, stat)`, assigning to it re-pins the base. Anything new should call
`game.buildings.liveStat` / `baseStat` instead of reading the field. `game.buildings` also
carries `capOf(def)` and `powerHintFor(def, generators)` for tools.
