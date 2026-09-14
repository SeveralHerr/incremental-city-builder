# Playtest feedback — 2026-09-14

Source: a full human playtest by the project owner (`Metropolis Feedback.md`, ingested 2026-09-14).
Session: ~1.5 h active plus an overnight idle; 5+ foundings; every charter signed; 1.66M legacy.
Screenshot of the moment the game "went idle": `docs/feedback/2026-09-14-idle-stats.png`
(city 6, 1h32m, $130B, 1.53M pop, power 127M / 36.1M MW, happiness 169 %, unemployment 43 %).
Note: the screenshot shows the pre-rework three-column layout; the dock/sheet UI in the working
tree was not what was played.

Each item has an id (F1…), the owning module, a severity, and the player's words condensed.
`STATUS.json.open` points here; close an item by ticking it and noting the commit.

## Verdict from the player

- [x] F0 (praise, keep) Early to mid game is well balanced: costs and unlock pacing have a great cadence.

## Balance / economy

- [ ] **F1 balance — late slowdown (P1).** After 2–3 foundings the game slows and certain upgrades and
  buildings feel disproportionately expensive. Player could not name which; needs a probe of
  cities 3–6 for the most expensive-per-effect rungs. Cross-check with the existing STATUS note
  that the late cadence is jagged.
- [ ] **F2 balance/buildings — power runaway (P1).** By the 3rd founding the carried bonuses give
  ~10× the power that can be used when buying comparable amounts of everything. Screenshot:
  127M MW cap vs 36.1M demand. Consequences:
  - Lights Out milestone is nearly unreachable once available unless the player deliberately
    avoids generators.
  - Superconductor Grid lands when power is already a non-issue; every later power upgrade
    widens the gap. Power stops mattering mid-game, which contradicts the design contract
    (under-power 3–20 % of the session).
- [ ] **F3 balance/upgrades — Megastructures unemployment cliff (P1).** After Megastructures,
  unemployment cannot drop below ~40 % (screenshot: 43 %). No comparable Commercial or
  Industrial jobs upgrade at that point. Arcology Gardens pushes it to ~70 %. Later upgrades
  fix it, but the middle stretch is off.
- [ ] **F4 resources/ui — happiness is opaque (P2).** The max-happiness formula cannot be worked
  out in play: civic buildings stop raising it past some count, something (pollution?) lowers
  it, and more civics do not raise it again. The tooltip does not say what happiness does
  (it is a `0.5 + 0.5·happiness` income multiplier, `src/resources/index.js`). Player found
  they earned more late by *not* buying joy-reducing buildings: their income bonus did not
  cover the happiness loss. Needs a legible breakdown in the UI and a look at whether that
  trade-off is intended.
- [ ] **F5 simulation/balance — legacy has no choice (P2).** Charter purchases are always "the
  next one or two you can afford"; there is no real decision. Consider parallel tracks or
  branching perks.
- [ ] **F6 simulation/balance — founding gate semantics (P2).** Is the founding threshold based on
  city count or on how far the previous city was pushed? If the latter, pushing deeper is
  penalised. Either way the player cannot reset early to farm legacy, which is a hallmark
  of incrementals (short resets vs a long push). Document the rule in-game and consider
  allowing an early founding at a reduced gain.
- [ ] **F7 upgrades/balance — "population grows faster" rungs are dead (P2).** Every time one
  unlocked the player was already at full population (housing-capped). Either re-time them
  or change their effect.
- [ ] **F8 buildings/balance — late cost curves invert (P3).** At the same money the player can
  afford 237 Financial Districts but only 202 Corner Shops, 215 Tech Campuses but 190
  Factories; same across Residential (not Orbital Ring), Power, Civic. Lower tiers should
  scale less steeply since their effect is negligible late. Cosmetic to overall balance but
  reads as wrong.
- [ ] **F9 simulation — "max banked legacy" looks unreachable (P3).** Player believes the top of
  the legacy bank cannot be hit and suggests removing the cap (most incrementals do not cap
  meta currency, they scale costs). Needs a code check: the player had 1.66M legacy, above
  the 1M `Bank a million` milestone, so find what they read as a cap (charter tally, a
  milestone, or the config "legacy ceiling" used only by the sim gate) and clarify or remove.
- [ ] **F10 simulation — Endless Skyline milestone unreachable (P3).** 10,000 buildings. With every
  charter, 1.66M legacy (~25,000 % income) and buying everything affordable, the player was
  under halfway and every building was going exponential. Lower the target or make it a
  lifetime count.
- [ ] **F11 simulation — offline legacy (info).** Overnight idle earned ~5k legacy; feels
  logarithmic and acceptable. No action, but keep it that way.

## UI

- [ ] **F12 ui — legacy progress bar fills from 0, not from the last point (P1).** "Next legacy
  point" bar reads as % of the whole target instead of last-point → next-point, so late
  game it looks permanently full. Fix in the Legacy / City Hall panel using
  `derived.extra.prestige.nextAt` and the previous point's threshold.
- [ ] **F13 ui — itch.io embed needs lots of scrolling to find controls (P2).** Fullscreen was
  much better once discovered. Check the embed viewport size on the itch page and make the
  layout fit it, or surface a fullscreen prompt on first load inside an iframe.
- [ ] **F14 ui — no bulk sell (P2).** Sell is one at a time. Add a modifier key (shift/ctrl/alt,
  the genre standard) and/or let the ×10 / Max segment apply to Sell.
- [ ] **F15 ui — planes fly backwards (P3).** The skyline plane sprite faces opposite its travel
  direction (`sk-plane` keyframes in `src/ui/styles.css`, sprite in `src/ui/skyline.js`).
  Player: "game unplayable, ragequit".

## Cross-cutting

- [ ] **F16 docs — DESIGN.md late-game contract vs the play.** F2, F3 and F7 all say the
  mid/late game lost its tension even though the sim contract passes. The greedy bot does
  not play like a human (it buys everything, so it never over-builds one category). Add a
  sim profile or probe that reproduces the human's power surplus and unemployment cliff, and
  add those as contract metrics before re-tuning.
