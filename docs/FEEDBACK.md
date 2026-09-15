# Playtest feedback — 2026-09-14

Source: a full human playtest by the project owner (`Metropolis Feedback.md`, ingested 2026-09-14).
Session: ~1.5 h active plus an overnight idle; 5+ foundings; every charter signed; 1.66M legacy.
Screenshot of the moment the game "went idle": `docs/feedback/2026-09-14-idle-stats.png`
(city 6, 1h32m, $130B, 1.53M pop, power 127M / 36.1M MW, happiness 169 %, unemployment 43 %).
Note: the screenshot shows the pre-rework three-column layout; the dock/sheet UI in the working
tree was not what was played.

Each item has an id (F1…), the owning module, a severity, and the player's words condensed.
`STATUS.json.open` points here; close an item by ticking it and noting the commit.

## State at 2026-09-15 wave-3 close (committed as `a570de0`; **gate REFUTED, nothing ticked**)

Wave 3 shipped and was committed honestly as NOT green. Three independent skeptics re-ran every
profile on the shipped tree, diffed the four gate files against `1c3ebfa` first, and all three
returned `refuted: true`. **No box below is ticked, and F1 is explicitly not recorded as closed.**

**Gate-tampering check (all three skeptics, independently, before anything else): clean.**
`git diff 1c3ebfa a570de0` — `tools/economy-sim.mjs` is comment-only (the 30 s DECISION threshold,
every window, band and ceiling byte-identical); `src/buildings/buildings.test.mjs` has **no diff at
all** (red line 4 was closed by moving data, not the test); `src/balance/balance.test.mjs` changes
only test 12's hand-written `cityOrder` mirror to the shipped ladder order, with the monotonicity
assertion over all 22 rungs byte-identical; `src/upgrades/upgrades.test.mjs` **tightens** the
all-owned demand invariant from a one-sided 0.95–1.05 band to the exact product ×1.105 ±0.002
inside a two-sided 1.09–1.12. One documented tolerance widening, minor: the Blueprints per-city fold
went from an exact `near(fold, 1.12^4)` to a 0.5 % relative band (1.078^6 = 1.5693 vs 1.5735).

### Measured on the shipped tree (integrator run, reproduced by all three skeptics)

- `npm test` **10/10 files**, exit 0 (balance 20, buildings 29, core 32, cost-curve 4, resources 18,
  save 6, simulation 48, ui 36, upgrades 21, tools/save-test 9). Was 8/10 at HEAD.
- `node tools/verify.mjs --ticks 10000 --tag wave3`: PASS, 0 errors, tick avg 0.011–0.015 ms,
  p99 0.10 ms, **60.2–60.4 fps**, no overflow.
- **Greedy 12 h** (`logs/sim-gauntlet.txt`): PASS, **contract PASS**, issues 0, errors 0, 34 foundings,
  legacy 530,998, money tick-peak 4.21e17, reach 53 %.
- **Saver 12 h** (`logs/sim-saver.txt`): PASS, contract PASS, issues 0, 35 foundings, legacy 743,544,
  money tick-peak 6.28e17.
- **Human 12 h** (`logs/sim-human.txt`): 8 of 10 gates PASS; F1(b) and the unemployment band FAIL.
- **Human 24 h** (`logs/sim-human-24h.txt`): **FAIL, 3 issues** — `magnitude`, `unemployment`, `cadence`.
- `node src/buildings/cadence.mjs`: **0 problems**, first city founds 35.0 min, 0 errors.

### Three of the four red lines are genuinely closed

- **CLOSED — greedy variety.** 2 of 29 late cycles empty (first cycle 21) → **0 of 29**,
  `emptyLateCycles = []`, `neverPurchased` empty. A skeptic listed every late cycle's `newItems`
  and confirmed no late city is filled by a fleet rung alone: c21 reactor-refits-4 + standing-orders,
  c24 ringworld-district, c26 galactic-charter, c27 superconductor-grid, c29 orbital-shipyard,
  c31 exchange-ring, c33 elevator. The Superconductor Grid moved above the Galactic Charter
  ($1.5Qa vs $853T) — the only order that fills city 29 — and `plan.json` plus the `cityOrder`
  mirror in `balance.test.mjs` were corrected to match.
  **Caveat, unclosed:** `GATED = PROFILE === 'default'` (`economy-sim.mjs:89`), so this is a
  greedy-12h sentence only. The saver carries `emptyLateCycles [18, 30, 31, 34]` and the human 24 h
  carries `[18, 19]`, both read by no contract.
- **CLOSED — greedy under-power.** Session 0.8 % → **3.6 %** (contract 3–20 %); by hour ≥ 1 % in
  **5 of hours 3–12** (h6 16.82, h7 4.06, h8 1.61, h9 8.72, h10 11.00); median cap/demand
  1.16 · 1.68 · 1.57 · 1.56 · 1.13 · 1.05 · 1.00 · 1.00 · 1.00 · 1.06 · 1.28 · 1.35, floor 0.60.
  Bought **not** with `FLEET_DRAW` 1.12 (which overshot to ×1.16 of stickers) but by spreading the
  same bite over six ×1.07 draw rungs; the invariant was re-stated tighter, not relaxed, and the
  card text reads `draw +7 %` on exactly the rungs that carry it.
- **CLOSED — first-city building cadence.** All four named pairs clear the 90 s rule:
  office→tower **90–92 s** (was 28), nuclear→techpark **122–126 s** (was 88), financial→fusion
  **114 s** (was 70), fusion→stadium **108–112 s** (was 30). Verified not to have damaged the
  first city: `src/balance/probe.mjs --trace 0` prints a **byte-identical** city-0 trace through
  minute 12 on both trees (pop 999 at 10.3 min, 2,291 at 12.0 min); tower and school *buy* times are
  unchanged (9.9 / 11.6 min) — only their open times moved, so the fix removed dead card-sitting.
  First founding 34.8 → 35.0 min, peak pop 82,604 → 80,319 (−2.8 %), tension 41 % → 43 %.

### F1 is NOT closed — including the half wave 3 claimed

**(b) fails outright and is admitted:** longest stretch with no DECISION purchase reads
**26.3 · 46.8 · 43.2 · 40.0 · 27.2 min** in cities 5–9 against a 20 min rule (HEAD:
61.3 · 76.1 · 48.1 · 104.8 · 51.0). Better in every city, still red; cities 10–14, which the window
does not read, are 51 · 53 · 74 · 42 · 96 min.

**(a) "PASS" is a window artifact, refuted by all three skeptics with two matched experiments:**

- Shipped tree at the **old** founding rule (`--found triple`): cycles 45.5 · 16.4 · 21.0 · 62.9 ·
  76.8 · 71.8 · 104.9 · 166.0 → `FAIL`, c7 ×1.46, c8 ×1.58. Every content change wave 3 shipped for
  F1 contributes **zero** to F1(a).
- HEAD's untouched tree at the **new** rule (`--found double`): `PASS`. The delta is 100 %
  attributable to `HUMAN_FOUND_SHARE 2.0 → 1.0` (`src/core/bot.js:293`).

The F1(a) window is a **city-index** window (`complete cities 4–9`, `lastRatioCity = hours >= 24 ? 12 : 9`)
measuring a **wall-clock** contract. At 8 foundings it covered run-minutes 83–565; at 14 foundings it
covers 75–207. The long cities did not go away, they slid past index 9 where the gate prints
`° = outside the window, unread`:

- 12 h, same passing run: cities 10–14 = **50.8 · 62.3 · 85.9 · 75.4 · 125.0 min** (×1.20 ×1.23 ×1.38
  ×0.88 ×1.66) — city 14 fails **both** branches of the rule F1(a) just "passed".
- 24 h, same passing run: cities 13–20 = 75.4 · **125.0 · 130.8 · 109.5 · 123.9** · 58.2 · **113.2 ·
  120.4** min, c14 ×1.66 and c19 ×1.95, six cities over the 90-min branch, all unread.

Also, with every windowed city at 13.7–47.1 min the `≤ 90 min` branch carries the gate alone and
c5 ×2.05 / c6 ×1.68 pass unremarked — the ratio clause cannot currently fail.

**And the plateau is no denser.** Decision-gap **minutes** fall whenever cities shorten and say
nothing about density. The gap as a fraction of the city is **1.00 in cities 7, 8 and 10** on this
tree (the whole city is one gap, all 36–37 purchases at minute 0) and was 0.97–1.00 in cities 4, 5
and 7 at HEAD. Any future claim that a ladder "spaces purchases" must move that fraction.

### Regressions and costs this wave shipped

- **Unemployment band regressed, green → red.** `median unemployment inside [2 %, 15 %] in ≥ 3 of
  hours 3–12` read **3 of 10** at HEAD (h7 14 %, h11 4 %, h12 3 % — exactly the minimum) and reads
  **1 of 10** here (h7 13 %), on both 12 h and 24 h. It is content: the same tree at share 2.0 reads
  0 of 10 and also trips the > 15 % line, so the founding rule improves this line and the drop came
  with the fleet ladder's two employer columns (six ×1.078 jobs rungs per column compound to ×1.57,
  lifting jobs/pop in cities 4–10 to 1.17–1.29 against a 0.85–1.30 band; c4 = 1.29 sits on the rail,
  held by techpark 18,500 + stadium 73,000 — the same numbers the cadence probe chose).
  **Disclosure is not closure:** this must be back to PASS before any wave is called green.
- **`reachShare` over complete cities 4–9 fell 48 % → 39 %**, under its own printed ≥ 40 % target,
  on samples that halved (480 → 212); session 54 % → 48 % on 12 h and 29 % on 24 h; **c4 reads 0 %**.
  The wave's argument for keeping the `funded` hold door is denominated in exactly this number and
  the regression was not reported.
- **Human 24 h no longer finishes.** It exits 1 on `magnitude`: legacy **2,622,972** against a
  ceiling written "≤ 1e6 **at 12 h**" that `tools/economy-sim.mjs:754` applies at any `--ticks`, and
  money tick-max **9.99e17 against 1e18 — 0.1 % of headroom**, which no builder mentioned. HEAD read
  886,015 and passed by luck of the founding count. The check was **not** made hours-aware here; it
  stays a contract question in DESIGN.md "Open", but the profile F1, F2 and F3 are measured with
  currently cannot complete a 24 h run.
- **Lights Out moved later.** "Earned by content in cities 7–8" is now **city 12 alone** on 12 h
  (258 s, with cities 1–11 at exactly 2 s under power) and cities 12/15/16/17 on 24 h. Still earned,
  not granted — but the green line as written no longer describes the tree.
- **Instrument cost, recorded, not free.** Share 1.0 drops city-6 legacy from ×0.98 of the player's
  screenshot to ×0.19 and moves unassisted Megastructures from city 7 to **city 10 at ~326 min**.
- **`plan.json cycleMax` is nearly spent:** greedy longest non-last cycle 49.27 and saver 49.6
  against 50 (HEAD 46.4 / 46.5). Decide before the next income change, not mid-wave.
- **Two prose-over-check lines to fix:** the frontier comment in `upgrades.test.mjs` claims "never
  wider than ×6 / the widest step is the Ringworld District at ×6.5" while the loop beneath it starts
  after `stellar-engine` and never reads that ×6.45 step; and the "71 cottages" in the F8 knee test
  is a hand-typed comment, not a derived measurement.

### Where the skeptics disagreed, so the next wave does not read one and stop

F2 was called **closable** by two lenses and **not** by the third. Both closing lenses require the
restated invariant to be written into the box (all-owned demand is **×1.105** of sticker, not ≈ ×1.0)
and one notes the before/after were taken on different instruments (share 2.0 vs 1.0). The refusing
lens holds F2's *first stated consequence* against it: "Lights Out is nearly unreachable" is
measurably worse on the human than at HEAD (one city instead of two, hour 8 instead of hour 4), and
the human 12 h session under-power reads **2.7 %**, under the contract's own 3 % floor. F2 is
therefore left **open** here. F8 was called closable by all three and is left open only because no
wave-3 work touched it and this record ticks nothing.

Nothing to tick. Standing demands carried into wave 4 are listed under DESIGN.md "Open".

## Verdict from the player

- [x] F0 (praise, keep) Early to mid game is well balanced: costs and unlock pacing have a great cadence.

## Balance / economy

- [ ] **F1 balance — late slowdown (P1).** After 2–3 foundings the game slows and certain upgrades and
  buildings feel disproportionately expensive. Player could not name which; needs a probe of
  cities 3–6 for the most expensive-per-effect rungs. Cross-check with the existing STATUS note
  that the late cadence is jagged.
  → Round 3 (2026-09-15, no ticks): the sixteen fleet rungs re-priced from 0.25× to 1× the unit
  price at their gate so they are decisions, not reflexes; a decision-gap metric (a rung already
  affordable when its gate opened does not count). Human 12 h: cycles 45.5 · 16.2 · 21.0 · 63.0 · 76.1 · 73.1 · 105.6 · 164.1 min (8 foundings at
  the 0.528 brake), city 7 ×1.44 and city 8 ×1.55 over the previous (gate ≤ 1.35), longest
  decision gap 61 · 76 · 48 · 105 · 51 min in cities 4–8 (gate ≤ 20; 24 h adds 98 · 94 · 48 · 132). Both
  F1 lines stay FAIL by arithmetic, not by a price: a profile that founds only once the haul is
  ≥ 2× its bank must out-earn everything before it ~8.5× per city, and its plateau fleet grows
  2–4 units a minute, so no fixed-threshold rung can fall inside a 20-minute window every city.
  Open with the lever named: a leveled / repeatable upgrade type (core) or an income term in the
  Masons / Archives slot with its own brake wave.
  → Wave 3, core half (2026-09-15, `src/core/bot.js`). The round-3 note above is right that F1(a)
  is arithmetic and wrong about where the arithmetic lives: the ≥ 2× founding rule is not a fact
  about the economy, it is a setting on the *instrument*, and it was fitted on 2026-09-14 to one
  of the two observables in the playtest screenshot (415 legacy at the end of city 6) while the
  other one in the same frame — the player is in **city 6 at 92 min** — went unread. F1 is a
  wall-clock line, and at share 2.0 the profile reaches city 6 only at 182–295 min and first
  matches the player's income at 270.8 min: ×3.0 on the clock it claims to reproduce. Re-swept on
  HEAD 1c3ebfa (12 h, `--found <rule>`), both columns and the F1(a) verdict recorded per row:
  gate 27 foundings / city 6 @ 92 min / legacy 30 / PASS · share 1.0 14 / city 5 / 80 / **PASS** ·
  share 1.5 10 / city 4 / 208 / FAIL (c9 110.1 > 1.35× c8 75.6) · share 2.0 8 / city 4 / 405 /
  FAIL (c7 105.6, c8 164.1) · share 3.0 6 / city 3 / 1280 / FAIL. Monotone: every rung that buys
  legacy spends clock. Shipped: **share 1.0** — the deepest push that stays within one city of the
  player's clock and keeps F1(a) on its ≤ 90-min branch. Cost, recorded not hidden: city-6 legacy
  405 → 80 (×0.98 → ×0.19 of the player) and Megastructures unassisted city 7 → city 10.
  Isolated reading of the bot change alone, HEAD content, 12 h (`logs/sim-human-share1.txt`):
  cycles 45.5 · 13.0 · 16.4 · 13.5 · 27.9 · 46.9 · 43.5 · 39.5 · 41.8 · 50.4 · 62.9 · 86.0 · 74.5 · 115.7,
  complete cities 4–9 all < 90 min → **F1(a) PASS**; every other human gate still PASS (power
  cap/demand none > 4.0 and none < 1.0, no ≥ 3× city; unemployment per-city / by-hour / jobs/pop
  1.10–1.28 on complete cities ≥ 4 / 3-of-hours all in band; Lights Out cities 11 62 s and 12 44 s;
  F12 hour 2 0.67 min, hour 3 0.62). 24 h (`logs/sim-human-24h-share1.txt`): the same five gates
  PASS over 20 cities — but the flat `legacy ≤ 1e6` magnitude check, which the contract states as a
  *12 h* ceiling, now trips at 2,623,606 on 20 foundings (it read 886,015 on 12) and the 24 h run
  exits non-zero. Not touched here; see DESIGN.md "Open" for why that is a contract decision.
  **F1(b) is content's and is not bought by this change**: the same share-1.0 run still reads
  decision gaps 24 · 47 · 44 · 40 · 27 min in cities 5–9 against all-purchase gaps of 10 · 20 · 12 ·
  15 · 14 over the identical purchases — the difference is the `funded` hold door on the fleet
  ladder making reach-at-unlock 0 by construction, which is an upgrades-module fix.
  → **Wave 3 skeptic verdict (2026-09-15, `a570de0`): F1(a) is NOT closed.** Three independent
  lenses refuted the claim with matched experiments: the shipped tree at the old rule
  (`--found triple`) FAILS at c7 ×1.46 / c8 ×1.58, and HEAD's untouched tree at the new rule
  (`--found double`) PASSES — so the move is 100 % `HUMAN_FOUND_SHARE 2.0 → 1.0` and 0 % content.
  The `complete cities 4–9` window is a city-index window over a wall-clock contract: at 8 foundings
  it spanned run-minutes 83–565, at 14 it spans 75–207, and the same passing 12 h run contains
  cities 10–14 at 50.8 · 62.3 · 85.9 · 75.4 · **125.0** min (c14 ×1.66, failing both branches) and
  the 24 h run six cities over 90 min including c19 ×1.95 — all printed `° = outside the window,
  unread`. Decision-gap **minutes** also fall whenever cities shorten: as a fraction of the city the
  gap is 1.00 in cities 7, 8 and 10 (every purchase at minute 0). Next wave: make the window
  time-based (every complete city ending after hour N) and re-read F1(a) on both trees under it;
  the 8 extra fleet rungs per column need justifying or reverting (matched-profile all-purchase gaps
  10/20/11/11/14 vs HEAD 10/20/12/15/14, `reachShare` over cities 4–9 48 % → 39 %).

- [ ] **F2 balance/buildings — power runaway (P1).** By the 3rd founding the carried bonuses give
  ~10× the power that can be used when buying comparable amounts of everything. Screenshot:
  127M MW cap vs 36.1M demand. Consequences:
  - Lights Out milestone is nearly unreachable once available unless the player deliberately
    avoids generators.
  - Superconductor Grid lands when power is already a non-issue; every later power upgrade
    widens the gap. Power stops mattering mid-game, which contradicts the design contract
    (under-power 3–20 % of the session).
  → Round 1 (2026-09-14): global power stack compressed ×270 → ×9.5 supply, ×0.176 → ×0.33 demand
  (`src/upgrades/data.js`; Dyson / Grid Charter / Orbital Solar / Energy / Helios ×1.5 each,
  Superconductor 0.8, Shipyard 0.85, Stellar 0.8). Human profile: median cap/demand by hour 1.13 ·
  1.84 · 1.80 · 2.30 · 2.04 · 1.73 · 1.63 · 1.48 · 1.44 · 1.35 · 1.29 · 1.30 (was 1.14 · 6.06 · 6.41 ·
  16.55 … 9.11), no city with a ≥ 3× median (was city 3), Lights Out latched in 3/9 cities (was 0/9;
  the human bot's grid guard now reads the card's sticker draw, `src/core/bot.js`). Greedy under-power
  3.52 %, contract PASS. Still open: the power rungs are felt buys but ×1.0–1.1 as pace.
  → Round 2–3 (2026-09-14/15): the last five power rungs are demand-neutral and the stack is
  bounded at ×5.49 supply / ×0.736 demand (net ×7.5 over a whole session, with a +8 % city-wide
  draw on Trading Floors II/III and Campus Expansion II/III and +15 % on the Energy Charter). The
  human bot's grid guard is strain-aware again (the sticker guard survives only as the sim's
  `--guard sticker` control), and the greedy bot reads the grid the same way (best MW/$ plant,
  saves for it, never trips the grid by a unit). Human 12 h: cap/demand by hour 1.07 · 1.55 · 1.50 · 1.71 · 1.32 · 1.21 · 1.09 · 1.00 · 1.00 · 1.00 · 1.00 · 1.00; 24 h hours 13–24 1.00 · 1.00 · 1.00 · 1.00 · 1.14 · 1.36 · 1.34 · 1.27 · 1.24 · 1.45 · 1.42 · 1.40, no city with a ≥ 3× median in 13 cities; Lights Out (≥ 30 s
  at ≤ 0.95) in city 7 (266 s) and city 8 (80 s) — both content: the +8 % steps landing on a full
  grid. Still open: the honest greedy reads under-power 0.9 % of 12 h against the contract's
  3–20 % (the steps bind 86 · 80 · 98 · 50 s in cities 20–23 and ≤ 6 s elsewhere) — the 3 %
  floor was carried by bot artefacts before, never by content (docs/DESIGN.md "Open").
  → **Wave 3 (2026-09-15, `a570de0`): the greedy line closed, F2 left open on a split verdict.**
  Session under-power 0.8 % → **3.6 %** (greedy), 3.1 % (saver), 4.6 % (human 24 h), all inside
  3–20 %; median cap/demand never < 1.0 from h2 and never > 2.5 from h3; no city with a ≥ 3× median
  in 20 cities of a 24 h run. Bought with six ×1.07 draw rungs, not ×1.12 on two, and the all-owned
  demand invariant is **re-stated, not relaxed**: `upgrades.test.mjs` pins the exact product
  **×1.105** ±0.002 inside a two-sided 1.09–1.12 band, with card text `draw +7 %` on exactly the
  rungs that carry it. Two of three skeptics call F2 closable **only** with that ×1.105 figure
  written into this box (the old "net ≈ ×1.0 of sticker" claim must not survive); the third refuses,
  because F2's first stated consequence went the wrong way — Lights Out is one complete city (12) on
  the 12 h human instead of two (7–8), arriving hour 8 instead of hour 4, and the human 12 h session
  reads **2.7 %**, under the contract's own 3 % floor. Not ticked. Also unreconciled until now:
  STATUS.json called F2 closed while this box was still `- [ ]` — this box is the record.
- [ ] **F3 balance/upgrades — Megastructures unemployment cliff (P1).** After Megastructures,
  unemployment cannot drop below ~40 % (screenshot: 43 %). No comparable Commercial or
  Industrial jobs upgrade at that point. Arcology Gardens pushes it to ~70 %. Later upgrades
  fix it, but the middle stretch is off.
  → Round 1 (2026-09-14): the housing rungs pair their own jobs (Megastructures housing ×2 · jobs
  ×1.5; Arcology Gardens arcology housing ×1.5 · all jobs ×1.25; `src/upgrades/data.js`). Human
  profile: Megastructures bought unassisted in city 7 at 313 min with median unemployment 0 % before
  and 0 % with it; unemployment by hour 20 % (hour 1) then 0 % (was 21 / 0 / 0 / 0 / 0 / 34 / 24 …);
  0 % median in every city from the 3rd. Both sim unemployment gates PASS.
  → Round 3 (2026-09-15): the late stack re-paired so jobs track housing — Civic Charter is
  civic cost −50 % · income +3 % (its jobs ×1.25 gone), Ringworld and Skyline jobs ×2.0, Shipyard
  ×1.25, Exchange Ring all jobs ×1.5; Arcology Blueprints stay +12 % residents per rung (the
  ×1.15 the plan named read city 7 at jobs/pop 0.83 and hour 7 at 18 % in the upgrades sweep). Human 12 h jobs/pop
  by city 1.03 · 0.91 · 1.27 · 1.25 · 1.12 · 1.21 · 0.89 · 1.13 · 0.97 (gate 0.85–1.3 for cities
  ≥ 4), 24 h cities 10–12 0.97 · 0.99 · 0.96; unemployment by hour 17 · 0 · 0 · 0 · 0 · 0 · 14 · 0 · 0 · 0 · 4 · 3 %,
  inside 2–15 % in 3 of hours 3–12 (h7 14 %, h11 4 %, h12 3 %); 24 h hours 13–24
  12 · 10 · 3 · 2 · 2 · 0 · 5 · 5 · 4 · 0 · 0 · 0 %. All four unemployment gates PASS on 12 h and 24 h.
  → **Wave 3 (2026-09-15, `a570de0`): REGRESSED, F3 cannot be ticked.** One of its four gates went
  green → red: `median unemployment inside [2 %, 15 %] in ≥ 3 of hours 3–12` read 3 of 10 at HEAD
  (h7 14 %, h11 4 %, h12 3 % — exactly the minimum) and reads **1 of 10** (h7 13 %) on both the 12 h
  and 24 h human runs. Cause is content, by A/B: the same tree at share 2.0 reads 0 of 10 and also
  trips > 15 %, so the founding rule improves the line and the fleet ladder's two employer columns
  (six ×1.078 jobs rungs each, ×1.57 compounded) caused the drop; jobs/pop now sits on the rail at
  c4 1.29 / c5 1.28 against a 0.85–1.30 band, held by techpark 18,500 + stadium 73,000 — the same
  numbers the buildings cadence probe chose, so moving either re-opens this gate. Also: no cliff is
  visible on this tree (≥ 40 % unemployment in 0 % of samples on every profile), but unassisted
  Megastructures moved from city 7 to **city 10 at ~326 min**, three cities further from the
  screenshot F3 is written against, and every run printed `granted no city` — the `--grant` what-if
  must be run on this tree before F3 is judged again.
- [x] **F4 resources/ui — happiness is opaque (P2).** The max-happiness formula cannot be worked
  out in play: civic buildings stop raising it past some count, something (pollution?) lowers
  it, and more civics do not raise it again. The tooltip does not say what happiness does
  (it is a `0.5 + 0.5·happiness` income multiplier, `src/resources/index.js`). Player found
  they earned more late by *not* buying joy-reducing buildings: their income bonus did not
  cover the happiness loss. Needs a legible breakdown in the UI and a look at whether that
  trade-off is intended.
  → resources half done in `8797eab`: `derived.extra.happiness` carries every signed term, the caps, `civicSaturation`, `incomeMult` and `capReason` (what most limits happiness now). The joy-reducing trade-off is intended: the break-even is in the resources header (a marginal factory is a net loss above ≈ $4k/s gross until smog saturates).
  → UI half done: City Hall › Happiness lists every term with its sign (base, civic "N % of the +112 % cap", smog with its cap, unemployment "N % jobless", overcrowding, brownout, upgrades & perks, clamp when active), the total, "income ×M", and a one-line hint from `capReason`; the HUD mood gauge opens it. Joy-reducing build cards wear a "−Joy −2.0%" pill with the cost in the tooltip. `text.js happinessRows / happinessTotal / happinessHint`, tested against every `HAPPINESS_LIMITS` value.
- [ ] **F5 simulation/balance — legacy has no choice (P2).** Charter purchases are always "the
  next one or two you can afford"; there is no real decision. Consider parallel tracks or
  branching perks.
- [ ] **F6 simulation/balance — founding gate semantics (P2).** Is the founding threshold based on
  city count or on how far the previous city was pushed? If the latter, pushing deeper is
  penalised. Either way the player cannot reset early to farm legacy, which is a hallmark
  of incrementals (short resets vs a long push). Document the rule in-game and consider
  allowing an early founding at a reduced gain.
  → UI half done: the Legacy panel states the rule in plain words from `derived.extra.prestige` — "Founding needs +◆ N legacy (≥ 40 % of your bank of ◆ M)." and "That takes $U earned in this city — $D more. The gate is on this city's earnings, never on how many cities you have founded." (the "— $D more" clause is dropped while $D is still ≥ 98 % of $U, i.e. right after a founding) (past the gate: "This city has earned $E, past the $U gate…"). `text.js foundingRule`, tested. The early-founding-at-reduced-gain question is the simulation/balance half, still open.
- [ ] **F7 upgrades/balance — "population grows faster" rungs are dead (P2).** Every time one
  unlocked the player was already at full population (housing-capped). Either re-time them
  or change their effect.
  → Round 3 (2026-09-15): Green Belts = happiness +5 % · cottages hold +25 % residents, Veteran Planners =
  tier 1–2 buildings −25 %, Planetary Charter = income only, City Archives = jobs ×1.25 · districts
  and campuses −10 %; Welcome Sign kept (the one felt growth rung). Measured pop/housing at the
  moment of purchase (human 12 h, median over the cities that bought it): Welcome Sign 0.22,
  Green Belts 1.00, Veteran Planners 0.95, Planetary Charter 1.00, City Archives 1.00, Community
  Events 0.94 — every rung but the Sign is bought at a full city, so none of them may promise
  growth, and their descriptions no longer do.
  → **Wave 3 (2026-09-15): untouched, split verdict, left open.** One skeptic calls it closable
  (every rung but the Sign is bought at a full city and none of them promises growth any more); two
  refuse, because the sim's own F7 probe still prints two rungs that structurally cannot deliver —
  `green-belts 1.00 (×3) | city-archives 1.00 (×2)` against the probe's caption "a rung bought at
  1.00 cannot deliver growth" — and no skeptic has confirmed a player *feels* the rungs.
  planetary-charter improved 1.00 → 0.98–0.99; welcome-sign 0.22–0.48 and community-events 0.94–0.98
  are unchanged.
- [ ] **F8 buildings/balance — late cost curves invert (P3).** At the same money the player can
  afford 237 Financial Districts but only 202 Corner Shops, 215 Tech Campuses but 190
  Factories; same across Residential (not Orbital Ring), Power, Civic. Lower tiers should
  scale less steeply since their effect is negligible late. Cosmetic to overall balance but
  reads as wrong.
  → Round 2 (2026-09-14): landed in core (`api.buildingCost`, two-segment curve, knee 75 / late
  growth 1.112, `src/core/cost-curve.test.mjs`): at 200 units house ≤ arcology, shop ≤ financial,
  factory ≤ techpark, coal ≤ nuclear, park ≤ stadium, and units-affordable-from-zero is
  non-decreasing in tier for every category.
  → **Wave 3 (2026-09-15): untouched and re-verified by all three skeptics** — no diff to the
  cost-curve module or either test across `1c3ebfa..a570de0`; `src/core/cost-curve.test.mjs` 4/4
  (count-200 ordering swept at 150/200/300) and `buildings.test.mjs` 29/29; the first-city premise
  behind the knee re-measured rather than assumed (`probe.mjs --trace 0` city-0 trace byte-identical
  to HEAD through minute 12). All three call it closable; **not ticked here because this wave ticks
  nothing**. One standing weakness: the "71 cottages" in the knee test is a hand-typed comment, not a
  derived measurement, so it cannot notice a first city whose fleet grows past the knee.
- [x] **F9 simulation — "max banked legacy" looks unreachable (P3).** Player believes the top of
  the legacy bank cannot be hit and suggests removing the cap (most incrementals do not cap
  meta currency, they scale costs). Needs a code check: the player had 1.66M legacy, above
  the 1M `Bank a million` milestone, so find what they read as a cap (charter tally, a
  milestone, or the config "legacy ceiling" used only by the sim gate) and clarify or remove.
  → Wrong on inspection, closed in `725f292`: nothing caps the bank (legacyFor is an unbounded floor of (lifetime/threshold)^exponent; sanitize only requires finite ≥ 0; 1.66M points stay finite in every snapshot field). What reads as a cap is the tier ladder ending at Millionfold Legacy (1,000,000): after it the founding line stopped naming a next tier. The snapshot now says `nextTierName: null`, `capped: false` so the card reads "every tier reached", never "max legacy".
- [x] **F10 simulation — Endless Skyline milestone unreachable (P3).** 10,000 buildings. With every
  charter, 1.66M legacy (~25,000 % income) and buying everything affordable, the player was
  under halfway and every building was going exponential. Lower the target or make it a
  lifetime count.
  → Done in `005183f`: lifetime count across every city (`stats.buildingsBuiltPrior + buildingsBuilt`); every profile crosses it in city 9 at ~125 min. Reward is now "taps pay 2×" — a reachable +10 % income pushed both 12 h profiles past the 1e18 ceiling; balance may re-grant an income reward in the F1 retune.
- [ ] **F11 simulation — offline legacy (info).** Overnight idle earned ~5k legacy; feels
  logarithmic and acceptable. No action, but keep it that way.
- [ ] **F17 upgrades/balance — early-game upgrades fire too fast (P2).** Reported by the owner
  2026-09-15, playing the *current* deployed build (waves 1–2 live), not the original session:
  "many of the early game upgrades happen really fast". Independently confirmed by the sim and
  already on record as a known open item — `docs/DESIGN.md` "Open" says the first city's
  purchase tension reads **0 % of its minute-samples**, i.e. the cheapest unlocked-unowned money
  upgrade is essentially never the 30 s – 15 min of income away that the contract's `reachShare`
  metric calls tension; the core ladder "opens a reflex buy every 1–2 min". So the player is
  describing a measured property of the build, not an impression.
  Diagnosis on record: **re-spaced gates, not prices.** A price only decides *which* city or
  minute buys a rung; what makes the first city a stream of reflex buys is that the unlock
  conditions open faster than the treasury can make any of them feel like a target. Note the
  tension with F0, where the same player praised early cadence: F0 was about costs and building
  unlock pacing overall, this is specifically the *upgrade* rungs, and the early game has since
  been re-effected (wave 1 re-clause'd the dead growth rungs, wave 3 is moving first-city
  building unlock spacing) — so re-read F0 against the current build before assuming they agree.
  Care: `reachShare` over the whole session is a contract gate at ≥ 30 % and currently passes on
  the greedy profile (~42 %); the first city is the part that reads 0 %. Any fix must raise the
  first city without dropping the session line, and must not slow the opening beats config.js
  pins (first shop < 60 s, 1k pop ~11 min, Legacy panel ~18.6 min). Wants a first-city-only
  tension metric before tuning, the same way F16 demanded the human profile before F2/F3.

## UI

- [x] **F18 ui — the stage layout hides the game; bring back the single screen (P1).** Owner,
  2026-09-15, on the deployed build: "the old UI single screen was better. Please use the old
  UI setup." Commit `01dd022` replaced a three-column dashboard (topbar + hero column with the
  city, next milestone, prestige and stats cards; build column; side column with upgrades,
  milestones and the log — all visible at once) with a full-bleed stage: fullscreen skyline,
  floating HUD, four-button dock, and a bottom sheet holding Build / Upgrades / Goals / City
  hall. The complaint is the information hiding: everything now costs a tap to see.
  Note the stage layout was **never playtested** — the 2026-09-14 session ran on the old
  three-column layout (see the note under this file's title), and that session's verdict F0
  praised its cadence. So the layout the owner is asking to restore is the one the praise
  was about.
  Restoration is under way (workflow, 2026-09-15): the four base files come back from
  `01dd022~1` (`index.js`, `hero.js`, `topbar.js`, `styles.css`), the five stage components
  are retired (`city.js`, `cityhall.js`, `dock.js`, `hud.js`, `sheet.js`), and the work built
  on top of the stage is carried across — F14 bulk sell and the −Joy pill live in `build.js`
  and survive untouched; F4's happiness rows, F6's founding rule, F12's legacy point bar and
  the phone population line are **pure helpers in `text.js`**, so the old panels call them
  directly; `embed.js` keeps the fullscreen chip but loses the dock it was anchored to.
  **Watch F13.** "The itch embed needs lots of scrolling to find controls" was a complaint
  made *about this old layout*, so restoring it may re-open F13. The restoration is required
  to measure the old layout inside a real 960×640 and 1280×720 iframe and report honestly
  rather than re-architecting around it. If F13 does re-open, it is a genuine tension between
  two pieces of owner feedback and needs an explicit decision, not a silent compromise.

  → **Done** `281b04f` (restore + retire), `f8c2411` (happiness card, phone population line),
  `aa4e6f8` (dead import), `c06b40a` (framed inner scroller, touch targets). The three-column
  dashboard is back: at 1440×900 and 1280×800 a player sees the city, next milestone, happiness
  ledger, build panel, upgrades, milestones and the log at once, nothing behind a button.
  `city.js`, `cityhall.js`, `dock.js`, `hud.js`, `sheet.js` are gone. Everything built on the
  stage survived: F14 bulk sell verified live (the shown refund equals `api.sellRefund` to the
  cent, and a real shift-click moved the treasury by exactly that), F4's ledger is a new
  `.panel-happy` card in the hero column, F6's founding rule and F12's segment bar sit on the
  Legacy card, and `popLine` moved out of the deleted `hud.js` into `text.js` (still pure, its
  test kept) to feed the topbar. Three independent reviewers drove the live page. Two tests that
  pinned deleted components were replaced with narrower ones plus a comment recording what they
  used to guard, rather than rewritten into passing lies.

- [x] **F12 ui — legacy progress bar fills from 0, not from the last point (P1).** "Next legacy
  point" bar reads as % of the whole target instead of last-point → next-point, so late
  game it looks permanently full. Fix in the Legacy / City Hall panel using
  `derived.extra.prestige.nextAt` and the previous point's threshold.
  → Done: simulation exposes `prevAt` / `pointProgress` (`aab56b0`), City Hall bar draws the point N → N+1 segment (`84dc64b`).
- [ ] **F12b balance — the point bar is decorative past hour 4 (P2).** Re-opened from F12 as its
  own item (round 3): with exponent 0.488 a point lands every ≤ 5 s from hour 4 in every profile
  (median legacy segment by hour, human 12 h: 28.3 · 0.66 · 0.58 · 0.20 · 0.10 · 0.04 · 0.04 · 0.02
  · 0.02 · 0.01 · 0.01 · 0.01 min). Gated only where it is a tempo a player can read — hour 2 within
  0.5–30 min and hour 3 ≥ 0.5 (human) / ≥ 0.25 (greedy: its hour 3 is cities 5–9 with 7–12-minute
  cycles on a ×1.4-per-founding sequence) — and written into DESIGN.md as decorative past hour 4.
  A ~0.35 exponent is a full re-placement wave.

- [x] **F13 ui — itch.io embed needs lots of scrolling to find controls (P2).** Fullscreen was
  much better once discovered. Check the embed viewport size on the itch page and make the
  layout fit it, or surface a fullscreen prompt on first load inside an iframe.
  → Done: measured inside a real `<iframe scrolling="no">` at 960×640 and 1280×720 — HUD, dock and sheet all fit, the framed document never scrolls (the sheet body is the only scroller). Inside a frame (`self !== top`, or `?embed=1` for tooling) a "Fullscreen ↗ ×" chip sits in the free corner by the dock on first load: one tap calls `requestFullscreen`, × dismisses; either is remembered in localStorage (`metropolis.ui.fullscreenPrompt`, guarded — the key is not in the simulation's `SETTINGS` whitelist). Settings › Display also has a Fullscreen button. `src/ui/embed.js`, decision helper tested.

  → **Re-opened by F18's restore, then closed** `c06b40a`. The old layout's `@media (max-height:
  640px)` and `@media (max-width: 900px)` rules hand scrolling to the *document*, which
  `<iframe scrolling="no">` freezes: inside a 960×640 itch frame the document stood 2,448 px tall
  and would not move under trusted wheel gestures, leaving Upgrades, Milestones and the City log
  512 px below the fold and **unreachable** — worse than the original complaint, which was only
  about scrolling. Caught by the restore's own measurement and confirmed independently by all
  three reviewers. The fix hands framed play an inner scroller instead of the document.
  Re-verified by the integrator at 960×640 in a real frozen iframe: the document no longer
  scrolls (scrollHeight 640 = clientHeight, scrollTop stays 0), an inner pane takes the wheel
  (scrollTop 1,600), and the Upgrades panel moves from 1,681 px below the fold to 81 px, visible.
  No horizontal overflow. 1280×720 was fine throughout.
- [x] **F14 ui — no bulk sell (P2).** Sell is one at a time. Add a modifier key (shift/ctrl/alt,
  the genre standard) and/or let the ×10 / Max segment apply to Sell.
  → Done: Sell is a toggle beside the ×1 / ×10 / Max switch and obeys it (×10 with 7 owned sells 7, Max sells all, never below 0); Shift-click = ×10, Ctrl/⌘-click = Max on any Buy or Sell button (rule on the tooltips and in Settings). The button shows core's own `api.sellRefund` for the exact amount, one `api.sell(id, n)` call per click (one debounced save). `text.js tradeCount`, tested.
- [x] **F15 ui — planes fly backwards (P3).** The skyline plane sprite faces opposite its travel
  direction (`sk-plane` keyframes in `src/ui/styles.css`, sprite in `src/ui/skyline.js`).
  Player: "game unplayable, ragequit".

  → Done in `b337f1e` (sprite nose is its +x extreme; test pins it against the keyframes).
## Cross-cutting

- [x] **F16 docs — DESIGN.md late-game contract vs the play.** F2, F3 and F7 all say the
  mid/late game lost its tension even though the sim contract passes. The greedy bot does
  not play like a human (it buys everything, so it never over-builds one category). Add a
  sim profile or probe that reproduces the human's power surplus and unemployment cliff, and
  add those as contract metrics before re-tuning.

  → Done: `--profile human` bot (`757a244`), deep-push founding rule + five human-only contract gates in the sim (`877437c`; power cap/demand ≤ 4 by hour, first ≥ 3× city ≥ 8, unemployment ≤ 20 % per city / ≤ 15 % by hour, Lights Out after city 1). Reproduces the playtest on the shipped balance: cap/demand 6.4–16.6× from hour 3, unemployment 24–34 % in hours 6–7, Lights Out 0/9 — the gates FAIL until F2/F3 are fixed. Lever map: `docs/feedback/2026-09-14-levers.md`.

  → Correction, wave 3 (2026-09-15): the deep-push founding rule this item shipped was calibrated
  on ONE of the screenshot's two observables. The frame says both "415 legacy at the end of city 6"
  and "city 6 at 92 min of playtime", and on this economy they imply ~90-minute and ~15-minute
  cities respectively — the sweep read the first and share 2.0 came out of it, which left the
  instrument ×3 slow on the clock. Since F1 is a wall-clock contract, the rule is re-fitted to the
  clock at share 1.0 and the legacy cost is written down rather than dropped (see F1 above and the
  table above `HUMAN_FOUND_SHARE` in `src/core/bot.js`). F16's own finding is unchanged and still
  binding: a bot that founds the moment the gate opens is not the player (legacy ×0.07, does not
  buy Megastructures on its own until city 19), so the gate rule is still ruled out. The lesson
  that generalises: when a probe is fitted to a screenshot, enumerate *every* observable the frame
  carries and say which one the fit is to — an unread column is how an instrument ends up
  measuring the wrong thing while reporting a pass.