# Buildings — design rationale

`data.js` is the catalogue: 20 buildings, five categories × four tiers, pure data. This
file is *why* the numbers in it have the shape they have. It quotes the module's defaults;
`src/balance/config.js` overrides fifteen of the twenty buildings (base costs, tier-4 power
draw and population gates, windmill output and growth), so **for the shipped numbers run**

```
node src/buildings/catalogue.mjs          # resolved catalogue, default vs shipped per field
node src/buildings/cadence.mjs            # first-city open / first-buy probe (exit 1 on a fault)
node --test src/buildings/                # unit tests + the probe
```

## Columns and tiers

- **Residential is the cheap column, jobs the expensive one.** Citizens arrive first, then
  the city has to find them work, which is where the money is. A tier-4 card is a decision
  rather than a bigger copy of tier 3 (see *Signature mechanics*).
- **Cost growth** comes from `config.cost.tierGrowth[tier]` unless the card pins its own:
  the park (1.2), school and hospital (1.18) grow faster because a civic card's happiness
  saturates (`config.happiness.civicCap`) and a flat curve would let a player buy forty of
  them for nothing. The stadium deliberately does *not* carry that exception — by the time
  it opens the civic curve is full, so it is bought as a franchise and priced like the
  other tier-4 cards so a fleet is buildable.
- **Late identity for the cheap column.** Three tier-1 cards are the *source* of a higher
  tier's signature rule (factory → refinery, park → solar farm, school → tech campus), and
  the two that were pure sink fodder scale *with* the tier above them instead: the cottage's
  housing grows with apartment blocks (+4 % each, ×3), the corner shop's income with office
  blocks (same curve). A late city keeps buying them for a reason it can read on the card.
  The windmill has no late role on purpose: config's cost growth of 2 retires it after a
  dozen (the 13th costs $160k for 4 MW); a hard `maxCount` would need core's `api.buy`.

## Power

Each generator is sized to cover a handful of same-tier consumers and the steps between
tiers are ~5–15×, so no plant makes the one below it pointless the moment it unlocks.
Per-unit draw is a *rate the card can explain*: a tier-4 consumer draws no more than ~4× the
tier-3 intensity of its column per citizen or job (arcology 0.8 MW/citizen against the
tower's 0.25; tech campus 1.2 MW/job against the refinery's 0.6; financial district 0.75
against the mall's 0.2).

Late-game power tension comes from **grid strain** (`demandGrowth`) instead of a per-unit
cliff: every further tier-4 unit adds 2.5 % to the draw of all of them (×1.5 at 21 units),
mirroring cost growth, so a tier-4 fleet asks for half again the reactors its stickers add
up to and the Power tab keeps asking for money without any single card contradicting the
tier below it. The strain is a felt tax rather than the headline: with the shipped draws
(3–4× these stickers) a +5 %/×2 strain put the first city at the brownout floor from minute
28 to its founding; +2.5 %/×1.5 costs it about a minute. Nuclear carries a real running cost
(upkeep) — that is the bill fusion is there to replace.

The fusion reactor is priced so that **the fleet is the price of admission**: at its sticker
a reactor is no better per MW than a nuclear plant, at ×2 (10 plants) it matches, at ×3 it is
the cheapest MW in the game and carries a fraction of the fleet's upkeep. The test pins that
ordering for both the defaults and the shipped costs so neither can drift into a $/MW sort.
The solar strength is pinned by the power contract: ×2 (at 40 or 25 parks) puts the 12 h
under-power share at 2.8 % against the ≥ 3 % floor; ×1.5 at 25 parks reads 3.1 %.

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
  what the fusion reactor's first-city gate (35,000 citizens, a trophy the city can reach
  and even buy in its last minutes; `legacy >= 1` stays the normal route) is for.

`cadence.mjs` prints open / first-buy per building, names the owner of each fault
(`buildings` when a field in data.js can fix it, `config` when `config.buildings[id]` pins
every field involved, with the field named) and exits 1 on any fault. `buildings.test.mjs`
spawns it and fails on a buildings-owned fault; config-owned faults are reported as a todo so
they cannot hide either.

The windmill gates on live power demand, so the first cottage is always followed by one dark
tick. Measured (12 h sim): opening the windmill from the start drops the "happiness dips below
1.0" count from 19 to 8 of 32 cities, under the ≥ 50 % contract in docs/DESIGN.md — replay
cities bottom out at 0.96 and only the tick-0 brownout puts them under — so the gate stays
until the simulation's civic pressure comes from elsewhere.

## Live-stat seam

`resources.computeDerived`, the bot scorer and the build card read the registered
definition's field (`registry.buildings.get(id).income`) directly. The scaled field of a
registered definition is therefore an *accessor* over the live store: reading it returns
`liveStat(id, stat)`, assigning to it re-pins the base. Anything new should call
`game.buildings.liveStat` / `baseStat` instead of reading the field.
