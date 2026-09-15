# Playtest feedback — 2026-09-14

Source: a full human playtest by the project owner (`Metropolis Feedback.md`, ingested 2026-09-14).
Session: ~1.5 h active plus an overnight idle; 5+ foundings; every charter signed; 1.66M legacy.
Screenshot of the moment the game "went idle": `docs/feedback/2026-09-14-idle-stats.png`
(city 6, 1h32m, $130B, 1.53M pop, power 127M / 36.1M MW, happiness 169 %, unemployment 43 %).
Note: the screenshot shows the pre-rework three-column layout; the dock/sheet UI in the working
tree was not what was played.

Each item has an id (F1…), the owning module, a severity, and the player's words condensed.
`STATUS.json.open` points here; close an item by ticking it and noting the commit.

## State at 2026-09-15 session close (measured, not claimed)

The tree is NOT fully green. `npm test` is 8/10 files; `node tools/verify.mjs --ticks 10000`
PASSES (0 errors, tick avg 0.012 ms, 60.3 fps) so the game itself is healthy, and the saver
12 h contract PASSES. What is red, exactly:

- `src/balance/balance.test.mjs` 18/20. Test 19: the greedy 12 h contract line — `[variety]`
  2 of 29 cycles after the 5th introduce nothing never-before-bought (first: cycle 21) and
  `[power]` the by-hour under-power line (needs >= 1 % of ticks in 3 of hours 3-12; reads
  0.2 0.4 0.1 0.3 2.5 4.9 1.4 0.1 0.1 0 0 0 %). Test 20: plan.json margin `underPowerMin`.
- `src/buildings/buildings.test.mjs` 27/28. The first-city cadence probe: four building pairs
  open closer than the 90 s rule (office/tower 28 s, nuclear/techpark 88 s, financial/fusion
  70 s, fusion/stadium 30 s). The test names the exact field to move for each.
- Human profile 8 of 10 gates PASS. The two red ones are both F1 cadence: complete cities
  4-9 are 63.0 76.1 73.1 105.6 164.1 min (city 7 is 1.44x city 6, city 8 is 1.55x city 7,
  rule: each <= 1.35x the previous or <= 90 min), and the longest stretch with no decision
  purchase is 61/76/48/105/51 min in cities 4-8 (rule <= 20 min).

Closed and holding on the human profile this session: 24 h power stays 1.0-2.5x cap/demand
with no city >= 3x (was 13x by city 13), per-city and by-hour unemployment inside their
bands with jobs/pop 0.89-1.27, Lights Out earned by content in cities 7 and 8 under a
strain-aware guard, and the F12 legacy segment gated in hours 2-3.

Integrator measurement left for the next wave (`src/upgrades/data.js`, above `FLEET_DRAW`):
the greedy by-hour power line is bought by FLEET_DRAW 1.12 (h5 13.9 %, h6 25.0 %, h7 14.6 %,
median cap/demand never below 1.0; human Lights Out grows to 1,630 s / 908 s), but 1.12 takes
a fully-upgraded city's draw from ~x1.0 of its stickers to x1.16, breaking the invariant the
upgrades module pins, and its card text reads "draw +8%". That is an upgrades content
decision, not an integrator flip, so it was measured and left. Variety does not move with it.

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
  Masons / Archives slot with its own brake wave.- [ ] **F2 balance/buildings — power runaway (P1).** By the 3rd founding the carried bonuses give
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
  floor was carried by bot artefacts before, never by content (docs/DESIGN.md "Open").- [ ] **F3 balance/upgrades — Megastructures unemployment cliff (P1).** After Megastructures,
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
  12 · 10 · 3 · 2 · 2 · 0 · 5 · 5 · 4 · 0 · 0 · 0 %. All four unemployment gates PASS on 12 h and 24 h.- [x] **F4 resources/ui — happiness is opaque (P2).** The max-happiness formula cannot be worked
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
  growth, and their descriptions no longer do.- [ ] **F8 buildings/balance — late cost curves invert (P3).** At the same money the player can
  afford 237 Financial Districts but only 202 Corner Shops, 215 Tech Campuses but 190
  Factories; same across Residential (not Orbital Ring), Power, Civic. Lower tiers should
  scale less steeply since their effect is negligible late. Cosmetic to overall balance but
  reads as wrong.
  → Round 2 (2026-09-14): landed in core (`api.buildingCost`, two-segment curve, knee 75 / late
  growth 1.112, `src/core/cost-curve.test.mjs`): at 200 units house ≤ arcology, shop ≤ financial,
  factory ≤ techpark, coal ≤ nuclear, park ≤ stadium, and units-affordable-from-zero is
  non-decreasing in tier for every category.- [x] **F9 simulation — "max banked legacy" looks unreachable (P3).** Player believes the top of
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

## UI

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
  A ~0.35 exponent is a full re-placement wave.- [x] **F13 ui — itch.io embed needs lots of scrolling to find controls (P2).** Fullscreen was
  much better once discovered. Check the embed viewport size on the itch page and make the
  layout fit it, or surface a fullscreen prompt on first load inside an iframe.
  → Done: measured inside a real `<iframe scrolling="no">` at 960×640 and 1280×720 — HUD, dock and sheet all fit, the framed document never scrolls (the sheet body is the only scroller). Inside a frame (`self !== top`, or `?embed=1` for tooling) a "Fullscreen ↗ ×" chip sits in the free corner by the dock on first load: one tap calls `requestFullscreen`, × dismisses; either is remembered in localStorage (`metropolis.ui.fullscreenPrompt`, guarded — the key is not in the simulation's `SETTINGS` whitelist). Settings › Display also has a Fullscreen button. `src/ui/embed.js`, decision helper tested.
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