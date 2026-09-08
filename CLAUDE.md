# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Metropolis": a SimCity-flavoured incremental/idle game in plain HTML/CSS + ES modules. No build
step, no framework, no bundler. `index.html` loads `src/main.js` directly. Deployed to itch.io by
`.github/workflows/deploy-to-itchio.yml` on every push to `master` (copies `index.html` + `src/`
to `dist/`, uploads with butler). There is only one branch.

## Commands

```sh
npm run serve                 # static dev server on http://localhost:5173 — keep it running; tools need it
npm test                      # every src/*/*.test.mjs + tools/save-test.mjs, each in its own process
node src/upgrades/upgrades.test.mjs        # one module's tests (node:test files, run directly)
npm run verify -- --ticks 10000 --tag x    # headless Chrome: bot plays N ticks, writes logs/x.json + screenshots
npm run sim -- --ticks 432000              # 12 game-hour Node economy sim (~10-20 s), logs/sim.json
npm run sim -- --ticks 432000 --saver      # same with the "saves for the next upgrade" bot profile
npm run shots -- --ticks 4000 --tag x      # phone / landscape / tablet / desktop screenshots to logs/
```

`verify` and `shots` need the dev server and a local Chrome (path list in `tools/verify.mjs`).
`verify` exits non-zero on any console/page error, tick avg > 0.5 ms, fps < 50, or horizontal
overflow. `sim` exits non-zero on overflow/stall/magnitude; `contractPass` in its JSON is the
stricter late-game contract (cadence, tension, power, happiness, variety) from `docs/DESIGN.md`.

## Architecture in one paragraph

Everything under `src/` except `ui/` and `save/` is **DOM-free and must run in Node** (the
economy sim and tests import `src/boot.js` directly). `src/core/` owns the shared mutable
`state` object (never replace its identity; `loadState` copies into it), the `registry`
(buildings, upgrades, tick handlers, actions), the fixed 100 ms tick `loop`, the public `api`,
and `bot.js` (the greedy player used by verify/sim). Content modules register definitions in
their `init(game)`; `src/boot.js` imports them in order `balance → resources → buildings →
upgrades → simulation`, each inside try/catch so a broken module degrades instead of crashing.
Every registered callback is wrapped by `core/safe.js` (`guard`): it logs to `errors[]` and
disables the callback after repeated throws. `simulation` is the only tick handler that matters:
each tick it folds every owned upgrade's `effect(mods, state)` into a fresh mods bag
(`core/mods.js`), calls `resources.computeDerived`, integrates money/pop, then checks milestones
and prestige. `ui/` renders on the `frame` event from `game.state` / `game.derived` and mutates
nothing directly — all writes go through `game.api` or `api.action(name)`.

## Rules that are not obvious from the code

- **Module isolation**: a change stays inside its own `src/<module>/` folder. `src/core/`, cross-module seams, `tools/`, and the docs are integrator territory. The critic scores in `docs/STATUS.json` are per module for this reason.
- **`src/balance/config.js` is the single source of tuning numbers.** `buildings/data.js` and `upgrades/data.js` carry the same literals and have tests that fail on drift, so a price change means editing both (config wins at runtime via overrides).
- **`docs/DESIGN.md` is the contract**; its final section "Late game contract" supersedes anything above it. Legacy comes from lifetime earnings only, is also a spendable currency (`prestige.spent`, `api.legacyAvailable()`, upgrades with `currency: 'legacy'`), and nothing may gate on wall-clock time.
- Settings changes go through `api.action('setSetting', key, value)`; the whitelist is `SETTINGS` in `src/simulation/index.js`.
- Unlock rules latch into `state.unlocks` (`b:id`, `u:id`, `m:id`, `panel:*`) and never re-lock; the UI gates dashboard panels on the `panel:*` keys.
- `?headless=1` on the URL skips save load/autosave and exposes `window.__game` (state, derived, api, step, botStep) for tools.
- `docs/STATUS.json` records critic scores, remaining issues (`open`) and history; read it before deciding what to work on. `.claude/workflows/gauntlet.js` is the critic workflow (accepts `args.only` to score a subset).
- Balance is tuned on a knife edge (max prestige-cycle ratio ~1.34 vs a 1.35 gate). Re-run both sim profiles after touching anything that changes income.
