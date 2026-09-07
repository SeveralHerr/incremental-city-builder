# Metropolis — Architecture

SimCity-inspired incremental/idle game. Plain HTML/CSS + ES modules. No build step, no framework.

## Folder layout (one folder per subsystem, one owner each)

```
index.html                 app entry (loads src/main.js)
README.md                  what it is, how to run, folder map, measured pacing
src/
  main.js                  browser bootstrap: boot() + save + ui, starts loop
  boot.js                  loads the DOM-free content modules defensively (shared by main.js and the Node tools)
  core/        [integrator] shared state, event bus, registry, tick loop, formatting, safety, bot
  balance/     [balance]    ALL tuning numbers (costs, growth rates, rates, prestige curve)
  resources/   [resources]  resource definitions + derived-rate math (money, population, power)
  buildings/   [buildings]  building definitions, cost curves, buy/sell, unlock rules
  upgrades/    [upgrades]   upgrade definitions, modifier effects, unlock rules
  simulation/  [simulation] tick handler: applies rates, growth, brownouts, milestones, prestige
  ui/          [ui]         DOM shell, panels, dashboard, skyline, styles (ONLY module touching DOM)
  save/        [save]       localStorage autosave, export/import, offline progress, migrations
tools/
  serve.mjs                 static dev server (port 5173) — keep running at all times
  verify.mjs                headless Chrome: load app, run 10,000 ticks w/ bot player, write logs/<tag>.json + screenshots
  economy-sim.mjs           Node-only accelerated end-game sim (imports src/ directly, no DOM); --saver profile
  test.mjs                  `npm test`: runs every src/*/*.test.mjs and tools/save-test.mjs in child processes
  save-test.mjs             save-module scenarios (stubbed localStorage, no DOM)
docs/
  DESIGN.md                 game design + module contracts + the late-game contract with measured numbers
  STATUS.json               per-module critic scores + open issues (resume point for /loop)
logs/                       tool output (git-ignored *.json / *.png): gauntlet.json, sim-gauntlet.json, sim-saver.json, screenshot-*.png
```

**Rule:** a builder edits only its own folder. Anything in `src/core/` or cross-module seams goes
through the integrator.

**Rule:** `core`, `balance`, `resources`, `buildings`, `upgrades`, `simulation` are **DOM-free**.
They must run in Node (the economy sim imports them). No `window`, `document`, `localStorage`.

## Shared game state (`src/core/state.js`)

Plain serializable object. Never replace the object identity; mutate in place. `save` does
`loadState(obj)` which copies into the same object.

```js
state = {
  version: 1,
  tick: 0,                 // total ticks this run
  time: 0,                 // game seconds this run
  res:   { money: 0, pop: 0 },          // stored resources (power is derived, not stored)
  buildings: { [id]: count },
  upgrades:  { [id]: true },
  unlocks:   { [id]: true },            // milestone flags (drive dashboard expansion)
  stats: { totalEarned: 0, peakPop: 0, buildingsBuilt: 0, prestiges: 0, playtime: 0, clicks: 0 },
                                        // totalEarned/peakPop/buildingsBuilt are per run (reset on prestige);
                                        // playtime = seconds at the keyboard; save adds offlineTime (caught-up seconds)
  prestige: { legacy: 0, spent: 0, lifetimeEarned: 0 },  // legacy points, points spent on charter perks, cumulative earnings across resets
  settings: { autosave: true, numFormat: 'short', sfx: true },
  log: []                               // last 60 {t, msg, kind} events for UI feed
}
```

`MAX_COUNT` (1e9) is exported from `state.js`: `sanitize()` clamps every building count to it and
`api.buy` never crosses it, so `baseCost · growth^count` can never read Infinity.

`derived` (`src/core/state.js`, NOT saved) is recomputed each tick by `simulation`:

```js
derived = {
  housing, jobs, employed, powerCap, powerDemand, powerRatio,   // powerRatio ∈ [brownoutFloor, 1]
  happiness,                                                   // multiplier, clamped to config.happiness.min..max
  income,          // money/sec (net = grossIncome − upkeep)
  grossIncome, upkeep,
  popGrowth,       // pop/sec
  mods,            // resolved modifier bag (see below)
  costMult,
  extra: {},       // free-form, allocated once and reused: breakdowns (resources), prestige snapshot (simulation)
}
```

## Modifier bag

Upgrades/prestige/milestones never touch state directly. They fold into a fresh `mods` object
each tick (`src/core/mods.js`): `{ income: 1, housing: 1, jobs: 1, power: 1, demand: 1, growth: 1,
inflow: 1, happiness: 0, cost: 1, upkeep: 1, byBuilding: { [id]: { income, housing, jobs, power, cost, happiness } } }`.
All multiplicative except `happiness` (additive, also per building). Order-independent → a broken effect can be skipped safely.
`sanitizeMods` replaces NaN/negative/infinite values with the neutral value and never lets `cost` reach 0.
Simulation adds `tap` (seconds of output a tap pays, ×1 by default) before folding.

## Registry (`src/core/registry.js`) — public API used by content modules

```js
registerBuilding({ id, name, icon, desc, category,          // category: residential|commercial|industrial|power|civic
  baseCost, costGrowth,                                     // cost = baseCost * costGrowth^count * mods.cost
  housing?, jobs?, powerUse?, powerGen?, income?, happiness?, upkeep?,  // per unit
  maxCount?,                                                // positive integer hard cap (windmill: 12)
  sellRefund?, unlock?: (state, derived) => boolean, tier })
registerUpgrade({ id, name, icon, desc, cost, category?, tier?,
  currency?: 'money' | 'legacy',                            // legacy-priced charter perks debit prestige.spent
  unlock?: (state, derived) => boolean,
  effect: (mods, state) => void })                          // mutate mods only
registerTickHandler(name, fn /* (state, derived, dt) */, priority /* lower first */)
registerAction(name, fn)                                    // exposed as api.<name>
```

Every registered callback (and every event listener) is wrapped by `safe.js`: try/catch, error
logged to `errors[]` (repeats of one message bump `count` instead of pushing, so a noisy source
never evicts other diagnostics from the 200-entry ring), the offending definition is disabled
after 3 consecutive failures or 10 failures within 500 calls, game continues.

## Public api (`src/core/api.js`, also `window.__game.api`)

```js
api.buildings()   → [{ id, name, count, cost, affordable, unlocked, broken, maxed, ...def }]
                    // maxed: count ≥ buildingCap(def) — affordable is false while maxed; the def's
                    // maxCount (if any) and the buildings module's powerHint ride along from ...def.
api.upgrades()    → [{ id, name, cost, owned, affordable, unlocked, broken, ...def }]
                    // broken: the def's effect OR unlock rule threw repeatedly and safe.js disabled
                    // it — an owned+broken upgrade is paid for but inert, a locked+broken one stays
                    // locked; UI badges both.
api.buy(id, n=1)  → boolean       api.sell(id, n=1) → boolean   // n: integer or 'max';
                    // NaN/non-numeric n → false, state untouched; refuses past buildingCap(def) and
                    // refuses a non-finite cost or wallet (never writes NaN). Sell refunds sellRefund
                    // (0.5) of the current replacement cost with the cost multiplier clamped to ≤ 1
                    // (a discount lowers the refund; a markup can never exceed the price paid).
api.buildingCost(def, count?, n?) → number      api.buildingCap(def) → def.maxCount || MAX_COUNT
api.maxAffordable(def, money?) → integer         // never past the cap, never > 10,000, 0 for non-finite money
api.sellRefund(def, count?, n?) → number
api.buyUpgrade(id) → boolean      // money or legacy per def.currency; legacy debits prestige.spent
api.legacyAvailable() → integer   // floor(legacy − spent)
api.upgradeCurrency(def) → 'money'|'legacy'      api.canAffordUpgrade(def) → boolean
api.canPrestige() → boolean       api.prestigeGain() → number   api.prestige() → boolean
api.action(name, ...args) → any   // registered actions: tap, setSetting, save, exportSave, importSave,
                                  // hardReset, saveStatus, exportCorrupt, recoverSave, …; undefined if unregistered
api.step(n)       → run n ticks synchronously (verify/bot)
```

`src/core/format.js`: `fmt`, `fmtMoney` (`$—` for non-finite), `fmtRate` (`+2.50/s`; `—` for
non-finite, sign follows the displayed value so −0.001 reads `+0.00/s`), `fmtInt`, `fmtPct`, `fmtTime`.

`src/core/bot.js` `botStep(opts)`: the greedy player verify and the sim drive — buys the best-scoring
affordable item every 20 ticks, saves toward the cheapest un-maxed generator during a brownout, taps
while income < $1/s, founds at ≥ 5 legacy scaled by the bank; `saveSeconds: N` (the sim's `--saver`)
makes it hold cash for a rung within N seconds of income.

## Tick loop (`src/core/loop.js`)

Fixed step `TICK_MS = 100` (10 ticks/sec), accumulator driven by `requestAnimationFrame`.
Max 50 catch-up ticks per frame (beyond that → offline-progress path in `save`).
UI renders on its own rAF, reading `state`/`derived`; never inside tick handlers.
`loop.stats` = ring buffer of last 600 tick durations (ms) → exposed for verify.

## Events (`src/core/events.js`)

`on(name, fn)`, `off`, `emit(name, payload)`. Listeners are guarded like registry callbacks
(errors caught, repeat throwers disabled). Events:
`tick`, `frame`, `buy`, `sell`, `upgrade`, `unlock`, `milestone`, `brownout`, `tap`, `setting`,
`prestige`, `load`, `save`, `offline`, `catchup`, `error`, `log`, `ready`.

## Performance budget

| Item | Budget |
|---|---|
| Tick (all handlers) | < 0.5 ms avg, < 4 ms p99 |
| UI frame | < 6 ms; DOM writes only on changed values |
| 10,000-tick verify | zero console errors, income monotone non-decreasing under bot play |
| Steady 60 fps | rAF loop, no layout thrash, transforms/opacity only for animation |

## Economy model (summary; numbers live in `src/balance/config.js`)

- Population grows toward `housing` at `growthRate * happiness * powerRatio * mods.growth`; shrinks if over.
- `employed = min(pop, jobs)`; gross income = `(pop·tax + employed·wage + Σ building.income) × mods.income × powerRatio × (0.5 + 0.5·happiness)`; net = gross − upkeep.
- Power: `powerRatio = demand>0 ? clamp(cap/demand, 0.6, 1) : 1`. Brownout scales income, growth and happiness.
- Happiness: base 1 + saturating civic − saturating pollution − unemployment/overcrowd/brownout penalties (full math in DESIGN.md "Resources").
- Costs: exponential `baseCost * growth^count` (growth 1.112–1.18 by tier; windmill ×2 with a cap of 12).
- Earnings (`stats.totalEarned`, `prestige.lifetimeEarned`) = gross output while the city is net-positive; taps count in full.
- Prestige ("Found a new city"): legacy total = floor((lifetimeEarned/threshold)^exponent), a founding
  banks the difference; income × (1 + k·legacy)^p (p ≤ 0.6). Legacy is also a currency: charter
  perks (`currency: 'legacy'`) debit `prestige.spent`; the bonus always uses the full bank.
- Milestones (`unlocks`) expand the dashboard: power panel at first plant, civic at 15 citizens, etc.

## Verification loop

`npm test` → every `src/*/*.test.mjs` plus `tools/save-test.mjs`, each in its own process.
`npm run serve` (keep running) → `npm run verify -- --ticks 10000 --tag gauntlet` → `logs/gauntlet.json`
+ `logs/screenshot-gauntlet-{start,mid,end,full}.png` (default tag `verify`).
Verify loads `http://localhost:5173/?headless=1` (no save load, no autosave, deterministic),
runs 10,000 ticks with the greedy bot (`src/core/bot.js`), samples every 100 ticks: money, pop,
income, powerRatio, tick ms; collects console errors/warnings; fails on any error, a page error,
horizontal overflow or a missing module.
`npm run sim -- --ticks 432000 --out logs/sim-gauntlet.json` runs the Node 12 h end-game sim (prestige
loops, contract metrics from DESIGN.md "Late game contract"); `--saver` runs the saving-bot profile.
The console line prints `PASS/FAIL (contract PASS/FAIL)`; the JSON carries `metrics`, `cycles`,
`issues`, `purchases`, `final`.

## Critic gate

Each module scored 0–10 in `docs/STATUS.json` (`modules.<name>.{score, rounds, pass, errors, verdict,
issues[]}` plus `economy`, `verify` and `history`). Pass ≥ 8.5 and zero errors. Builders revise ≤ 4×.
The `critic-gauntlet` skill scores every module, has builders fix their own folders in parallel, and
the integrator resolves the cross-folder requests, re-runs verify + both sim profiles and commits.
