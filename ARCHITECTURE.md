# Metropolis — Architecture

SimCity-inspired incremental/idle game. Plain HTML/CSS + ES modules. No build step, no framework.

## Folder layout (one folder per subsystem, one owner each)

```
index.html                 app entry (loads src/main.js)
src/
  main.js                  bootstrap: loads modules defensively, starts loop, mounts UI
  core/        [integrator] shared state, event bus, registry, tick loop, formatting, safety
  balance/     [balance]    ALL tuning numbers (costs, growth rates, rates, prestige curve)
  resources/   [resources]  resource definitions + derived-rate math (money, population, power)
  buildings/   [buildings]  building definitions, cost curves, buy/sell, unlock rules
  upgrades/    [upgrades]   upgrade definitions, modifier effects, unlock rules
  simulation/  [simulation] tick handler: applies rates, growth, brownouts, milestones, prestige
  ui/          [ui]         DOM shell, panels, dashboard, skyline, styles (ONLY module touching DOM)
  save/        [save]       localStorage autosave, export/import, offline progress, migrations
tools/
  serve.mjs                 static dev server (port 5173) — keep running at all times
  verify.mjs                headless Chrome: load app, run 10,000 ticks w/ bot player, write logs
  economy-sim.mjs           Node-only accelerated end-game sim (imports src/ directly, no DOM)
docs/
  STATUS.json               per-module critic scores + open issues (resume point for /loop)
logs/                       verify output: verify.json, screenshot-*.png (git-ignored)
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
                                        // totalEarned/peakPop/buildingsBuilt are per run (reset on prestige)
  prestige: { legacy: 0, spent: 0, lifetimeEarned: 0 },  // legacy points + cumulative earnings across resets
  settings: { autosave: true, numFormat: 'short', sfx: true },
  log: []                               // last 50 {t, msg, kind} events for UI feed
}
```

`derived` (`src/core/state.js`, NOT saved) is recomputed each tick by `simulation`:

```js
derived = {
  housing, jobs, employed, powerCap, powerDemand, powerRatio,   // powerRatio ∈ [0,1]
  happiness,                                                   // multiplier ~0.5..2
  income,          // money/sec (net)
  popGrowth,       // pop/sec
  mods,            // resolved modifier bag (see below)
  costMult,
}
```

## Modifier bag

Upgrades/prestige/milestones never touch state directly. They fold into a fresh `mods` object
each tick (`src/core/mods.js`): `{ income: 1, housing: 1, jobs: 1, power: 1, demand: 1, growth: 1,
inflow: 1, happiness: 0, cost: 1, upkeep: 1, byBuilding: { [id]: { income, housing, jobs, power, cost, happiness } } }`.
All multiplicative except `happiness` (additive, also per building). Order-independent → a broken effect can be skipped safely.

## Registry (`src/core/registry.js`) — public API used by content modules

```js
registerBuilding({ id, name, icon, desc, category,          // category: residential|commercial|industrial|power|civic
  baseCost, costGrowth,                                     // cost = baseCost * costGrowth^count * mods.cost
  housing?, jobs?, powerUse?, powerGen?, income?, happiness?,  // per unit
  unlock?: (state, derived) => boolean, tier })
registerUpgrade({ id, name, icon, desc, cost, unlock?: (state, derived) => boolean,
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
api.buildings()   → [{ id, name, count, cost, affordable, unlocked, broken, ...def }]
api.upgrades()    → [{ id, name, cost, owned, affordable, unlocked, broken, ...def }]
                    // broken: the def's unlock/effect threw repeatedly and safe.js disabled it —
                    // an owned+broken upgrade is paid for but inert; UI should badge it.
api.buy(id, n=1)  → boolean       api.sell(id, n=1) → boolean   // n: integer or 'max';
                    // NaN/non-numeric n → false, state untouched. Sell refunds sellRefund (0.5)
                    // of the current replacement cost with the cost multiplier clamped to ≤ 1
                    // (a discount lowers the refund; a markup can never exceed the price paid).
api.sellRefund(def, count?, n?) → number
api.buyUpgrade(id) → boolean
api.canPrestige() → boolean       api.prestigeGain() → number   api.prestige() → boolean
api.step(n)       → run n ticks synchronously (verify/bot)
```

## Tick loop (`src/core/loop.js`)

Fixed step `TICK_MS = 100` (10 ticks/sec), accumulator driven by `requestAnimationFrame`.
Max 50 catch-up ticks per frame (beyond that → offline-progress path in `save`).
UI renders on its own rAF, reading `state`/`derived`; never inside tick handlers.
`loop.stats` = ring buffer of last 600 tick durations (ms) → exposed for verify.

## Events (`src/core/events.js`)

`on(name, fn)`, `off`, `emit(name, payload)`. Listeners are guarded like registry callbacks
(errors caught, repeat throwers disabled). Events:
`tick`, `buy`, `sell`, `upgrade`, `unlock`, `prestige`, `load`, `save`, `error`, `log`.

## Performance budget

| Item | Budget |
|---|---|
| Tick (all handlers) | < 0.5 ms avg, < 4 ms p99 |
| UI frame | < 6 ms; DOM writes only on changed values |
| 10,000-tick verify | zero console errors, income monotone non-decreasing under bot play |
| Steady 60 fps | rAF loop, no layout thrash, transforms/opacity only for animation |

## Economy model (summary; numbers live in `src/balance/config.js`)

- Population grows toward `housing` at `growthRate * happiness * powerRatio`; shrinks if over.
- `employed = min(pop, jobs)`; income = `employed * wage + Σ building.income`, × mods.income × powerRatio.
- Power: `powerRatio = demand>0 ? min(1, cap/demand) : 1`. Brownout scales income & growth.
- Happiness: base 1 + civic buildings − overcrowding/unemployment penalties.
- Costs: exponential `baseCost * growth^count` (growth 1.12–1.18 by tier).
- Prestige ("Found a new city"): legacy total = floor((lifetimeEarned/threshold)^exponent), a founding
  banks the difference; income × (1 + k·legacy)^p (p ≤ 0.6). Legacy is also a currency: charter
  perks (`currency: 'legacy'`) debit `prestige.spent`; the bonus always uses the full bank.
- Milestones (`unlocks`) expand the dashboard: power panel at first plant, upgrades at $500, etc.

## Verification loop

`npm run serve` (keep running) → `npm run verify` → `logs/verify.json` + `logs/screenshot-*.png`.
Verify loads `http://localhost:5173/?headless=1` (no save load, no autosave, deterministic),
runs 10,000 ticks with a greedy bot (buys best affordable item every 20 ticks, saves toward the
cheapest generator during a brownout, taps the city while income < $1/s), samples every
100 ticks: money, pop, income, powerRatio, tick ms; collects console errors/warnings.
`npm run sim` runs the Node end-game sim (millions of ticks, prestige loops) → `logs/sim.json`.

## Critic gate

Each module scored 0–10 in `docs/STATUS.json`. Pass ≥ 8.5 and zero errors. Builders revise ≤ 4×.
