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
- [ ] **F7 upgrades/balance — "population grows faster" rungs are dead (P2).** Every time one
  unlocked the player was already at full population (housing-capped). Either re-time them
  or change their effect.
- [ ] **F8 buildings/balance — late cost curves invert (P3).** At the same money the player can
  afford 237 Financial Districts but only 202 Corner Shops, 215 Tech Campuses but 190
  Factories; same across Residential (not Orbital Ring), Power, Civic. Lower tiers should
  scale less steeply since their effect is negligible late. Cosmetic to overall balance but
  reads as wrong.
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

## UI

- [x] **F12 ui — legacy progress bar fills from 0, not from the last point (P1).** "Next legacy
  point" bar reads as % of the whole target instead of last-point → next-point, so late
  game it looks permanently full. Fix in the Legacy / City Hall panel using
  `derived.extra.prestige.nextAt` and the previous point's threshold.
  → Done: simulation exposes `prevAt` / `pointProgress` (`aab56b0`), City Hall bar draws the point N → N+1 segment (`84dc64b`).
- [x] **F13 ui — itch.io embed needs lots of scrolling to find controls (P2).** Fullscreen was
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