# Metropolis

A SimCity-flavoured incremental game. You are the mayor of a plot of land: build homes, put
citizens to work, keep the lights on, keep them happy, then found a new city and carry your
legacy forward. Plain HTML, CSS and ES modules — no build step, no framework, no dependencies at
runtime. The whole economy runs in Node as well as in the browser, which is how it is tuned.

## Run it

```sh
npm install                # puppeteer-core only (headless verification)
npm run serve              # static server on http://localhost:5173 — keep it running
```

Open http://localhost:5173. The city autosaves to `localStorage` every 30 s and catches up on
offline time when you return. `?headless=1` mounts the game without loading or writing a save.

## Check it

| Command | What it does |
|---|---|
| `npm test` | Runs every `src/*/*.test.mjs` and `tools/save-test.mjs`, each in its own process. |
| `npm run verify -- --ticks 10000 --tag gauntlet` | Headless Chrome (needs `npm run serve`): loads the app, plays 10,000 ticks with the greedy bot, samples tick cost and fps, writes `logs/gauntlet.json` and `logs/screenshot-gauntlet-*.png`. Fails on any console or page error. |
| `npm run sim -- --ticks 432000 --out logs/sim-gauntlet.json` | Node-only 12 game-hour economy sim with prestige loops. Prints `PASS/FAIL (contract PASS/FAIL)` and the per-city cycle times; the JSON carries the late-game contract metrics. |
| `npm run sim -- --ticks 432000 --saver --out logs/sim-saver.json` | The same session with a bot that saves toward a rung within 30 s of income (held to the hard gates only). |

Balance tooling lives beside the numbers: `node src/balance/probe.mjs` (cycle ratios, rung placement,
under-power by hour, `--first`, `--set`, `--boost`, `--unlock`, `--save N`), `node src/balance/place.mjs`
(re-prices the late ladder one rung per city), `node src/buildings/catalogue.mjs` (the shipped building
ladder) and `node src/buildings/cadence.mjs` (first-city unlock/first-buy timing).

## Layout

```
index.html            entry; loads src/main.js
src/
  main.js, boot.js    browser bootstrap / defensive loader shared with the Node tools
  core/               state, events, registry, tick loop, public api, formatting, safety, the bot
  balance/            every tuning number (config.js) + probe/place tooling + plan.json
  resources/          resource metadata and the derived-rate math (income, growth, power, happiness)
  buildings/          the 20-building catalogue, live synergy rules, unlock cadence
  upgrades/           69 upgrades: the core ladder, pace and frontier rungs, 12 legacy-priced charter perks
  simulation/         the tick: fold mods, integrate, milestones, prestige, dashboard gates
  ui/                 the DOM: topbar, skyline, build panel, upgrades, Legacy panel, log, toasts, settings
  save/               localStorage autosave, export/import, offline catch-up, migrations, recovery
tools/
  serve.mjs           dev server        verify.mjs   headless-Chrome gauntlet
  economy-sim.mjs     12 h economy sim  test.mjs     `npm test` runner     save-test.mjs  save scenarios
docs/
  DESIGN.md           game design, module contracts, the late-game contract and its measured numbers
  STATUS.json         critic scores and open issues per module
logs/                 tool output (git-ignored): gauntlet.json, sim-gauntlet.json, sim-saver.json, screenshots
```

`ARCHITECTURE.md` documents the shared state, the modifier bag, the registry and the public api.

## Module isolation

One folder per subsystem, one owner each. A builder edits only its own folder; `src/core/` and
every cross-folder seam go through the integrator. `core`, `balance`, `resources`, `buildings`,
`upgrades` and `simulation` are DOM-free and must import cleanly in Node — the economy sim runs
them directly. Only `ui` and `save` touch `window`, `document` or `localStorage`. Content modules
never write state; they register definitions, fold into a fresh modifier bag each tick, and every
registered callback is guarded so a broken definition is disabled after repeated failures while
the game keeps ticking.

## The critic gate

Every module is scored 0–10 against top-tier idle games by an independent critic; the record is
`docs/STATUS.json` (score, verdict and open issues per module, plus the economy and verify
results). A module passes at ≥ 8.5 with zero errors; builders get up to four revision rounds, then
the integrator resolves the cross-folder requests, re-runs the gauntlet and commits. Current
scores: core 9.0, resources 8.8, save 8.8, simulation 8.6, ui 8.6, balance 8.5, buildings 8.5,
upgrades 8.5 — all passing.

## Measured pacing

From `logs/sim-gauntlet.json` (`npm run sim -- --ticks 432000`, greedy bot, 2026-09-07):

- **PASS, contract PASS**, 0 issues, 0 errors, ~18.7k ticks/s.
- First founding at **41.8 min**; 32 foundings in 12 h. Cycles fall to a 5.6–7 min floor, then
  plateau at 22–50 min; every cycle from the 5th on is ≤ ×1.346 the previous (contract ≤ ×1.35);
  last cycle 23.3 min.
- Every building and all 69 upgrades bought; no city after the 5th passes without something new.
- The cheapest open upgrade sits 30 s – 15 min of income away in **53 %** of samples (contract ≥ 30 %).
- Under-power **3.1 %** of the session, floor 0.60 (contract 3–20 %); happiness dips below 100 %
  in 21 of 32 cities (contract ≥ 50 %).
- Legacy 270,633 (127,476 spent on all twelve charter perks); money peak 2.8e16, income 8.5e14/s.
- Saver profile (`logs/sim-saver.json`): PASS, contract PASS on the hard gates; 33 foundings,
  first at 34.4 min, reach 69 %, legacy 379,439, 11 late cities with nothing new (documented in
  `src/balance/config.js`).

Verify (`logs/gauntlet.json`, 10,000 ticks in Chrome): 0 errors, 0 warnings, 60.4 fps, tick
0.012 ms average / 0.10 ms p99, no horizontal overflow.
