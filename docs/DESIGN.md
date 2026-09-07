# Metropolis — Game Design & Module Contracts

Read ARCHITECTURE.md first. This file is the shared contract every builder codes against.
Numbers here are **starting points**; `src/balance/config.js` is the single source of tuning
truth and the balance builder may change any number without touching other folders.

> **Where the numbers live.** The "Pacing target" paragraph below is the original sketch; the
> measured pacing is in the "Late game contract" at the end of this file and at the top of
> `config.js`. Since the 2026-09-07 polish pass `src/buildings/data.js` and `src/upgrades/data.js`
> carry the *shipped* numbers (tests fail on any drift from `config.js`, which re-pins 15
> buildings and 55 upgrade prices with identical values); the Buildings table below is the
> output of `node src/buildings/catalogue.mjs`.

## Fantasy & loop

You are the mayor of a tiny plot that becomes a megacity. Core loop:
1. Build **residential** → population moves in (needs power + happiness).
2. Build **commercial/industrial** → jobs; employed citizens + businesses pay money.
3. Build **power** → avoid brownouts (power ratio scales income & growth).
4. Build **civic** → happiness → growth & income multipliers.
5. Buy **upgrades** → multipliers, unlocks. Hit **milestones** → dashboard expands.
6. **Found a new city** (prestige) → legacy points → permanent multipliers → faster replay.

Pacing target (greedy bot, no prestige): first building < 5 s, first upgrade ~1 min, 1k pop
~8 min, first brownout ~3 min, $1M total earned (prestige available) ~35–50 min,
each subsequent prestige cycle shorter. Income should roughly 10× per game-hour early.

## Resources (`src/resources/index.js`)

```js
export const RESOURCES = [
  { id: 'money', name: 'Money', icon: '💵', color: '#4ade80', kind: 'stock', format: 'money', fallback: 0 },
  { id: 'pop',   name: 'Population', icon: '👥', color: '#60a5fa', kind: 'stock', format: 'int', fallback: 0 },
  { id: 'power', name: 'Power', icon: '⚡', color: '#facc15', kind: 'derived', source: 'powerCap', format: 'power', unit: 'MW', fallback: 0 },
  { id: 'happiness', name: 'Happiness', icon: '😊', color: '#f472b6', kind: 'derived', source: 'happiness', format: 'pct', fallback: 1 },
];
// fallback: the value shown when state/derived carries nothing usable (happiness → 1: a missing
// multiplier is neutral, not a 0 % crisis); source: the derived field a derived resource reads;
// unit: appended by formatResource ('12 MW'). Every field has a `desc` for tooltips.
// Pure. Reads registry buildings + state + mods, writes ALL derived fields. Called each tick by simulation.
export function computeDerived(state, derived, mods, config) {}
```

Math (per second; `dt` applied by simulation; `src/resources/index.js` header is the reference):
- `housing = Σ count·housing·byBuilding.housing · mods.housing`; same pattern for `jobs` (`mods.jobs`), `powerCap` (powerGen · `mods.power`), `powerDemand` (powerUse · `mods.demand` — never `mods.power`).
- `powerRatio = demand > 0 ? clamp(cap/demand, config.power.brownoutFloor, 1) : 1`
- `employed = min(pop, jobs)`; `unemployment = pop>0 ? (pop-employed)/pop : 0`
- `happiness = clamp(1 + civic − pollution − penalties + mods.happiness, config.happiness.min, config.happiness.max)` where
  `civic = civicCap · (1 − exp(−Σ count·(+happiness) / civicScale))`,
  `pollutionRaw = Σ count·|−happiness| · pollutionScale` and
  `pollution = pollutionCap · (1 − exp(−pollutionRaw / pollutionCurve))` (saturating; cap 1.1 < civicCap 1.12 so a fully civic city always nets positive; `pollutionCap: 0` restores the linear form);
  penalties: `unemployment · unemploymentPenalty`, `overcrowd · overcrowdPenalty` with `overcrowd = clamp(pop/housing − 1, 0, OVERCROWD_MAX = 10)` (pop > 0 with zero housing → 10), brownout `(1 − powerRatio) · brownoutPenalty`.
- `grossIncome = (pop·config.economy.taxPerPop + employed·config.economy.wage + Σ count·income·byBuilding.income) · mods.income · powerRatio · happinessIncomeCurve(happiness)`
  where `happinessIncomeCurve(h) = 0.5 + 0.5·h` (so h=1 → 1×, h=2 → 1.5×).
- `upkeep = Σ count·upkeep · mods.upkeep` (money/s; most buildings 0; big plants have upkeep).
- `income = grossIncome − upkeep` (may be negative; simulation clamps money ≥ 0).
- `popGrowth`: if `pop < housing`: `(housing − pop) · growthRate · happiness · powerRatio · mods.growth + baseInflow · mods.inflow` (inflow only while housing > pop); if `pop > housing`: `−(pop − housing) · shrinkRate`.
- `costMult = mods.cost` (must be > 0; 0/NaN/negative read as 1, same as `core/mods.sanitizeMods`).
- `derived.extra = { unemployment, overcrowd, civic, pollution, pollutionRaw, happinessMult, vacancy, openJobs, powerSurplus, penalties: { unemployment, overcrowd, brownout, pollution }, incomeBreakdown: { tax, wages, buildings, upkeep, multiplier }, happinessBreakdown: { base: 1, civic, mods, unemployment, overcrowd, brownout, pollution, raw, clamped } }` — happinessBreakdown terms are signed and sum to `raw`; `clamped == derived.happiness`; top-level `civic`/`pollution` are aliases of `happinessBreakdown.civic` / `penalties.pollution` kept for one release. Objects are allocated once and reused every tick.

## Buildings (`src/buildings/index.js`) — 20 buildings, 5 categories

`export const CATEGORIES = [{ id:'residential', name:'Residential', icon:'🏠', color:'#60a5fa' }, commercial 🏪 #4ade80, industrial 🏭 #fb923c, power ⚡ #facc15, civic 🏛️ #c084fc]`

`costGrowth` = `config.cost.tierGrowth[tier]` (shipped: t1 1.18, t2 1.16, t3 1.13, t4 1.112) unless overridden.
Apply `config.buildings[id]` partial overrides before `registerBuilding`. `unlock` rules latch (core handles).
Optional per-def fields core honours: `maxCount` (hard cap; `api.buy`/`maxAffordable` refuse past it,
rows carry `maxed`), `upkeep` ($/s), `sellRefund`. The buildings module adds `synergy` / `demandGrowth`
(live per-unit stats: `stat = base × min(cap, 1 + source/per)`), `unlockAt` + `unlockHint` (data mirror of
the unlock rule for the UI's progress bar) and stamps `powerHint` on every consumer ≥ 4 MW
("Draws 10,500 MW ≈ 0.9 × Nuclear Plant"). Rationale for the ladder: `src/buildings/README.md`.

Shipped ladder (`node src/buildings/catalogue.mjs`, 2026-09-07; per unit; joy = happiness):

| id | cat | tier | gate | baseCost | growth | housing | jobs | income/s | powerGen | powerUse | upkeep | joy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| house | res | 1 | start | 30 | 1.18 | 4 | | | | 1 | | |
| apartment | res | 2 | pop 20 | 280 | 1.16 | 24 | | | | 6 | | |
| tower | res | 3 | pop 250 | 3,000 | 1.13 | 160 | | | | 40 | | |
| arcology | res | 4 | pop 6,300 | 1.2e5 | 1.112 | 1,000 | 500 | | | 10,500 | | 0.1 |
| shop | com | 1 | pop 4 | 50 | 1.18 | | 5 | 0.8 | | 1 | | |
| office | com | 2 | pop 80 | 1,200 | 1.16 | | 50 | 4 | | 8 | | |
| mall | com | 3 | pop 2,800 | 25,000 | 1.13 | | 300 | 40 | | 60 | | |
| financial | com | 4 | pop 22,000 | 7e5 | 1.112 | | 4,000 | 2,500 | | 16,500 | | |
| factory | ind | 1 | pop 30 | 500 | 1.18 | | 20 | 3 | | 10 | | −0.02 |
| refinery | ind | 2 | pop 2,200 | 20,000 | 1.16 | | 200 | 60 | | 120 | | −0.03 |
| techpark | ind | 3 | pop 14,500 | 3e5 | 1.13 | | 2,500 | 900 | | 18,700 | | 0.05 |
| windmill | pow | 1 | demand > 0 | 40 | 2 (max 12) | | | | 4 | | | |
| coal | pow | 2 | demand 40 MW | 2,500 | 1.16 | | 10 | | 80 | | | −0.015 |
| solar | pow | 3 | pop 3,600 | 25,000 | 1.13 | | | | 900 | | | 0.03 |
| nuclear | pow | 4 | pop 11,000 | 4e5 | 1.112 | | 100 | | 12,000 | | 300 | 0.02 |
| fusion | pow | 4 | pop 28,000 or legacy ≥ 1 | 4e6 | 1.112 | | 200 | | 60,000 | | 1,500 | 0.05 |
| park | civ | 1 | pop 15 | 200 | 1.2 | | | | | | | 0.05 |
| school | civ | 2 | pop 500 | 5,000 | 1.18 | | 30 | | | 5 | | 0.08 |
| hospital | civ | 3 | pop 5,400 | 60,000 | 1.18 | | 200 | | | 50 | | 0.12 |
| stadium | civ | 4 | pop 43,000 | 3.5e6 | 1.112 | | 500 | 2,000 | | 6,200 | | 0.25 |

Signature rules (synergy / demandGrowth): cottage housing +4 % per apartment (×3); shop income +4 % per
office (×3); mall income +20 % per 1,000 citizens (×3); financial income +5 % per 1,000 employed (×2.5);
refinery income +2 % per factory (×2); tech campus income +5 % per school (×1.75); solar output +2 % per
park (×1.5); fusion output +10 % per nuclear plant (×3); stadium jobs +5 % per 1,000 citizens (×3); the four
tier-4 consumers draw +2.5 % per unit owned (×1.5).

Each building needs `name`, `icon` (emoji), `desc` (one flavorful line ≤ 70 chars), `tier`, `category`.
Unlock functions take `(state, derived)`.

## Upgrades (`src/upgrades/index.js`) — 69 upgrades (57 money + 12 charter perks)

`effect(mods, state)` mutates the mods bag only. `unlock(state, derived)`. Fields: `id, name, icon, desc, cost, category` (`residential|commercial|industrial|power|civic|global|prestige|charter`), `tier`, optional `currency: 'legacy'` (charter perks), `unlockAt` + `unlockHint` (data mirror of the gate), `keeps(def)` (a keeper rung re-grants the rungs it keeps at every founding: Institutional Memory tiers 1–2, the Grid Charter tier 3, Standing Orders tier 3 + Heritage).
Apply `config.upgrades[id]` overrides (cost) before registering; a self-priced gate (frontier `earned ≥ cost/4`, pace `earned ≥ 100 × cost`, charter `spendable legacy ≥ cost/2`) follows the config price. Original effect ideas (use `import { buildingMod } from '../core/mods.js'`):

- Zoning Reform: +25% housing (unlock: 5 houses, $250) · High-Density Zoning: +50% housing ($15k, 5 apartments)
- Neon Signage: shops +50% income ($200, 3 shops) · Franchising: +30% commercial jobs ($2,500)
- Assembly Lines: factories +75% income ($1,200, 3 factories) · Automation: −40% industrial jobs? NO — never reduce; instead +100% income
- Smart Grid: −15% power demand (`mods.demand`, $800, first brownout milestone) · Turbine Blades: windmills ×2 ($600)
- Community Events: +0.1 happiness ($1,000) · Green Belts: parks ×2 happiness ($3,000)
- Tax Software: +15% income ($500, pop ≥ 50) · Tourism Board: +25% income ($50k, pop ≥ 2,000)
- Express Transit: +50% growth rate ($8k) · Immigration Office: +100% baseInflow…
- Bulk Permits: −5% building costs ($25k), Prefab Construction: −10% costs ($1e6)
- Late game ($1e7–$1e10): Megastructures +100% housing, Orbital Solar ×3 power, AI Governance +100% income …
- prestige category (unlock legacy ≥ 1, cost in money): Legacy Archive +50% income, etc.

## Simulation (`src/simulation/index.js`)

- `init(game)`: register tick handler `'simulate'` priority 0; register actions `canPrestige`, `prestigeGain`, `prestige`, `tap`, `setSetting`; if fresh state (`tick===0 && money===0 && no buildings`) set `state.res.money = config.economy.startMoney`. Per-game bookkeeping that is not saved (pending milestones, brownout hysteresis, tap meter, the bank a founding started from) lives on `game._sim`; `init` is idempotent per game object.
- Tick: `mods = createMods(); mods.tap = 1;` fold every owned upgrade's `effect(mods, state)`, then milestone rewards, then prestige (`mods.income *= legacyIncomeMult(legacy)`), `sanitizeMods`, `derived.mods = mods`; `computeDerived(...)`; integrate: `money = max(0, money + income·dt)`, `pop = max(0, pop + popGrowth·dt)` (pop is a float; UI floors it), `peakPop`; refresh `derived.extra.prestige`; check milestones (a rewarded milestone is re-folded on the tick it latches); latch dashboard gates; brownout log hysteresis (`'brownout'` event with `{ active, ratio }`).
- **Earnings rule:** `stats.totalEarned` and `prestige.lifetimeEarned` count the *gross* output of a *solvent* city: `+= grossIncome·dt` only while `income > 0`. A city in upkeep deficit (net income ≤ 0, money pinned at $0) earns nothing toward milestones, frontier gates or legacy; taps count in full because their money reaches the treasury.
- `tap`: pays `max(1, grossIncome · tapSeconds)` from a meter of banked seconds (`mods.tap` scales it; refills at `tapRefill` s/s), so an autoclicker adds at most a bounded share on top of passive income; `stats.clicks++`; `emit('tap')`.
- Milestones: `export const MILESTONES = [{ id, key: 'm:'+id, name, desc, icon, metric, target, check:(state,derived)=>bool, reward?: (mods)=>void, rewardText? }]`. Latched in `state.unlocks[key]`; on reach → `addLog`, `emit('milestone', ms)`. 54 goals: pop 10 … 1M, totalEarned 1k … 1e15, buildings, upgrades, taps, foundings (1/5/10/20), legacy tiers (`legacy-5/15/50/150/500/1500/5000/15k/50k/150k/400k/1m`), first brownout. Pop milestones give +2 % income each (`config.milestones.popIncomeBonus`); founding/legacy tiers carry the placed +5 % income rungs and cost/growth rewards described in `milestones.js`.
- Prestige (`prestige.js`; every knob in `config.prestige`, mirrored in `tuning.js` and asserted by the tests): `legacyTotal = floor((lifetimeEarned/threshold)^exponent)`, `gain = legacyTotal − legacy` (founding banks the difference), allowed when `gain ≥ max(minGain, ceil(legacy · minGainShare))`; income multiplier `(1 + incomePerLegacy·L)^legacyPower · (1 + firstBonus once L > 0)` on the full bank (spending never lowers it); `prestige()`: `legacy += gain; stats.prestiges++; resetState({ keepPrestige, keepSettings, keepStats })`, startMoney `· (1 + legacy · startMoneyPerLegacy)`, `addLog`, `emit('prestige', { gain, legacy, spent, available, mult })`. `derived.extra.prestige = { legacy, spent, available, gain, can, minGain, unlockAt, nextAt, mult, multAfter, lifetimeEarned, startMoneyAfter, nextTierName, nextTierAt }` refreshed every tick.
- Dashboard gates (`state.unlocks` keys UI reads; each emits `'unlock'` `{ kind: 'panel', id }`): `'panel:power'` when any power building unlocked or demand > 0; `'panel:civic'` pop ≥ 15; `'panel:upgrades'` when the first upgrade unlocks; `'panel:stats'` pop ≥ 100; `'panel:prestige'` totalEarned ≥ threshold · prestigePanelShare ($1.1M) or any legacy banked.

## Save (`src/save/index.js`)

- Key `metropolis.save.v1`. JSON `{ savedAt, state }`. Base64 for export/import.
- `init(game)`: unless `game.headless`: load, then offline progress: `elapsed = min(now − savedAt, config.save.offlineCapSec)`; simulate by calling `game.step(n)` in ≤ 200-tick chunks with a per-chunk time budget (stop if > 1.5 s wall), remaining time approximated as `money += income·remaining·config.save.offlineEfficiency`; emit `'offline'` `{ seconds, earned, simulatedSec, analyticSec, source, efficiency }`. Caught-up time never counts as `stats.playtime` (the topbar clock is time at the keyboard); it is booked in `stats.offlineTime`. A throttled background tab (`source: 'background'`) is credited at efficiency 1 and only announced after ≥ 300 s. Autosave every 30 s (`config.save.autosaveSec`) + `visibilitychange` (hidden) + `beforeunload`, plus an immediate write on `prestige` and a debounced one on `upgrade`/`milestone`. Register actions `save`, `exportSave` (→ string), `importSave(str)` (→ boolean, validates, then `loadState`, emits `'load'`), `hardReset` (clears storage, `loadState({})`, startMoney, emits `'load'`), `saveStatus` (→ `{ …, autosave, autosaveSec, pendingOfflineSec, hasCorrupt }`), `exportCorrupt` (raw bytes of a parked unreadable save, `''` if none) and `recoverSave` (re-parses the parked copy under `metropolis.save.v1.corrupt`; restores it and emits `'load'` `{ source: 'recover' }`, or returns false and keeps it). Never throw out of init; corrupt saves → console.warn, parked, fresh state (not console.error). `coerceShape` clamps counts to core `MAX_COUNT` / the def's `maxCount` and tick/time/stats to `Number.MAX_SAFE_INTEGER`; `runMigrations` stamps `min(version, STATE_VERSION)`. Node-clean: `node src/save/save.test.mjs` runs the pure layer and `tools/save-test.mjs` (7 child-process scenarios with a stubbed localStorage).

## UI (`src/ui/`) — the premium bar

Files: `index.js` (init/mount/render loop), `styles.css`, plus components as you like (`skyline.js`, `panels.js`, `toast.js`…). ONLY module that touches DOM. Reads `game.state`, `game.derived`, `game.api`, `game.events`, `fmt*` from `core/format.js`, `RESOURCES` from resources, `CATEGORIES` from buildings, `MILESTONES` from simulation. Never mutate state directly; use `api.*` and `api.action(...)`.

Layout (desktop ≥ 1200; graceful down to 900):
- **Top bar**: city name (editable? no — "Metropolis" + tier title that changes with pop: Hamlet → Village → Town → City → Metropolis → Megalopolis), resource chips: 💵 money + income/s, 👥 pop / housing, ⚡ cap/demand with ratio bar (turns amber <1, red <0.6), 😊 happiness. Settings gear.
- **Hero / city view** (left, ~38% width): SVG/canvas **skyline** that grows with buildings — silhouettes per category, count-scaled, subtle parallax clouds, day/night gradient cycling slowly, tiny window lights at night. Clickable (`api.action('tap')`) with a floating "+$" particle. Under it: milestone progress ("Next: 500 citizens — 62%") and prestige card when unlocked.
- **Build panel** (center): category tabs (only unlocked categories shown, new ones pulse), building cards: icon, name, count, cost, per-unit stats, tiny "what it does" line; buy ×1 / ×10 / ×max toggle; disabled state at not-affordable with cost ratio bar filling; locked buildings show "?" silhouette with unlock hint. Newly unlocked → glow animation.
- **Right column**: Upgrades (available first, then owned collapsed; money-priced `prestige` rungs are labelled *Heritage*, ◆-priced `charter` perks live in the Legacy panel), Milestones list (reached + next 3), Event log feed (last 8, fade in; at ≥ 1240 px the log re-homes to the foot of the build column).
- **Toasts**: milestone reached, offline earnings, prestige, batched unlocks — overlaid on the city panel so they never cover a Buy / Found / Sign button.
- **Settings modal**: save now, export (textarea copy), import, hard reset (confirm inline, NOT window.confirm), number format.

Feel: dark slate/graphite glass panels (gradient + border; `backdrop-filter` blur only on toasts and
the modal — blur on a dozen panels cost ~20 fps in headless software rendering), one accent per category, Inter for text, JetBrains Mono for numbers (tabular-nums), 8px radius grid, subtle borders (rgba white 6–10%), soft glows on affordable buy buttons, numbers tween smoothly (lerp on frame), no layout shift as digits change (fixed min-widths). Reduced-motion respected. No emoji-only icons in big places (emoji fine inside chips/cards).

Rendering: on `'frame'` event; cache DOM refs; only write `textContent` when the formatted string changes; rebuild lists only on `buy/upgrade/unlock/milestone/load/prestige` events or every 30 frames as a safety net. Target < 4 ms per frame.

Must work in headless verify: `?headless=1` still mounts the UI (no save load) — screenshots must show a real, populated dashboard after the bot plays.

## Balance (`src/balance/config.js`)

Shipped values (2026-09-07; the file's header carries the measured pacing behind each one):

```js
export const config = {
  economy: { startMoney: 300, taxPerPop: 0.08, wage: 0.35, tapSeconds: 1 },
  pop: { growthRate: 0.09, shrinkRate: 0.2, baseInflow: 0.5 },
  power: { brownoutFloor: 0.6 },
  happiness: { civicCap: 1.12, civicScale: 1.5, pollutionScale: 0.35, pollutionCap: 1.1, pollutionCurve: 1,
               unemploymentPenalty: 0.35, overcrowdPenalty: 0.5, brownoutPenalty: 0.6, min: 0.25, max: 3 },
  cost: { tierGrowth: { 1: 1.18, 2: 1.16, 3: 1.13, 4: 1.112 }, sellRefund: 0.5 },
  prestige: { threshold: 1.1e7, exponent: 0.488, incomePerLegacy: 0.01, legacyPower: 0.548, firstBonus: 0.18,
              startMoneyPerLegacy: 1, minGain: 1, minGainShare: 0.4, prestigePanelShare: 0.1 },
  save: { autosaveSec: 30, offlineCapSec: 8*3600, offlineEfficiency: 0.5 },
  buildings: { /* 15 ids */ },   // id -> partial override of any registerBuilding field (currently identical to data.js)
  upgrades: { /* 55 ids */ },    // id -> { cost } — the placed late ladder; see the file for the city each rung lands in
  milestones: { popIncomeBonus: 0.02 },
};
```
`src/balance/index.js` re-exports config; `init()` is a no-op. Tooling in the folder: `probe.mjs`
(strict cycle ratios, rung-by-city placement, under-power by hour, `--first` first-city clock, `--set`,
`--boost`, `--unlock`, `--frontier-gate`, `--save N` what-ifs) and `place.mjs --plan plan.json [--save N]`
(re-prices the late ladder one rung per city). `balance.test.mjs` pins the shipped log to the contract.

## Late game contract (integrator, 2026-09-05 — supersedes any conflicting line above)

**Diagnosis after gauntlet iteration 3.** Hours 4–12 of a 12 h bot session were 43 identical
11.3-minute foundings: legacy compounded on a wall-clock "maturity" timer, Civic Bonds opened on a
wall-clock issue schedule, income reached 1e19/s with nothing priced above 3e12, and power /
happiness stopped mattering after city 1. The fix is structural, not a knob:

**Principles**
1. **Nothing gates on wall-clock time.** Content gates on the economy: earned this run, pop,
   building counts, legacy. Delete every time-based unlock/issue schedule.
2. **Legacy comes from lifetime earnings only.** `legacyTotal = floor((lifetimeEarned/threshold)^exponent)`;
   founding banks the difference. Remove the compounding/maturity source and its knobs
   (`compoundPerMinute, peakCarry, compoundCap, ripenSeconds, legacyDiscount`) from tuning + config.
   Earnings are the gross output of a *solvent* city: a city in upkeep deficit (net income ≤ 0)
   earns nothing toward milestones or legacy; taps count in full (`src/simulation/index.js` `integrate()`).
3. **Legacy is also a currency.** `available = prestige.legacy − prestige.spent`. Charter perks are
   upgrades with `currency: 'legacy'` (core `api.buyUpgrade` handles it; `api.legacyAvailable()`).
   The income bonus always uses the full `legacy` bank — spending never lowers it.
4. **Magnitudes:** money ≤ 1e18 and legacy ≤ 1e6 at 12 h under the bot. Income multiplier from
   legacy stays a root: `(1 + incomePerLegacy·L)^p`, p ≤ 0.6, no soft-cap machinery.

**Cadence target (12 h greedy bot, `npm run sim -- --ticks 432000`, read `metrics` in the JSON):**
- first founding 30–45 min; cycles fall to a floor of 4–8 min by founding 6–10, then rise gently:
  each cycle from the 5th on ≤ 1.35× the previous (strict — no minute slack; the sim gate,
  `balance.test.mjs` and `probe.mjs` all read the same ratio), last cycle ≤ 40 min; ~18–35 foundings in 12 h.
- every founding after the 5th introduces ≥ 1 never-before-bought item (perk, rung, building, tier).
- **purchase tension (contract metric = `reachShare`):** in ≥ 30 % of samples the cheapest
  unlocked-unowned money *upgrade* is 30 s – 15 min of current income away (`(cost − cash) / income`):
  a visible target worth waiting for, neither instant nor hopeless. Measured independently of how
  the bot hoards. The sim also reports the priciest-item ratio (`tensionShare`, "priciest unlocked
  item at 3–50× cash") and `tensionNextShare` for reference only; neither gates. The sim's `--saver`
  flag runs a bot that saves for a rung within 30 s of income; both profiles must stay free of
  overflow/stall/magnitude issues, only the default profile is held to the cadence numbers.
- **power matters:** under-power (ratio < 1) share 3–20 % of the session, floor ≥ 0.6.
- **civic matters:** happiness dips below 1.0 in ≥ 50 % of cities.
- every building and upgrade bought at least once in 12 h; zero `overflow/stall/magnitude` issues.

**Module contracts**
- *upgrades*: ≥ 12 charter perks, `category: 'charter'`, `currency: 'legacy'`, costs ×2.5–4 apart
  from 3 to ~2e5 legacy, strong effects (+50–100 % income/housing/power, −15 % cost, +growth, etc.),
  `unlock: spendable legacy (legacy − spent) ≥ cost/2` (the gate matches core's `canAffordUpgrade`, so an
  open perk is never "ready" with a dead Sign button; `unlockAt` mirror `{ legacyAvailable: cost/2 }`).
  Replace the wall-clock Civic Bond ladder with an **earnings-gated dollar
  ladder**: fixed costs ×10 per rung from 1e13 to 1e18, `unlock: state.stats.totalEarned ≥ cost/4`,
  with real names/effects (not "Bond XXIII"). Keep every knob in `config.upgrades`. The ×10 / 1e13–1e18
  spacing and the 3–200,000 perk ladder are the module's *defaults* (data.js); the shipped prices are
  config-owned and both self-priced gates (frontier cost/4, charter cost/2) and the perk's tier
  bracket follow the config price (`applyOverride` → `frontierUnlock` / `charterUnlockFor`).
- *simulation*: earnings-only legacy (principle 2); `prestigePanelShare` knob; legacy tiers up to 1e6
  (ids `legacy-5/15/50/150/500/1500/5000/15k/50k/150k/400k/1m`); `derived.extra.prestige` =
  `{ legacy, spent, available, gain, can, minGain, unlockAt, nextAt, mult, multAfter, lifetimeEarned,
  startMoneyAfter, nextTierName, nextTierAt }` refreshed every tick; the `prestige` action keeps
  `prestige.spent` through the reset and the `'prestige'` event carries
  `{ gain, legacy, spent, available, mult }`; refreshed header docs with measured numbers; tests updated.
- *balance*: retune to the cadence target; late demand outpaces supply (financial powerUse 2000,
  arcology 1200, fusion ≤ 3e5 MW); first shop < 60 s; keep every building worth buying. Frontier and
  charter prices live in `config.upgrades` (shipped: frontier $2.23e9 → $2.59e16 in canonical order,
  nine pace rungs $9.04e7 → $3.44e14, perks ◆ 3 → ◆ 76,488 at ×2.5, placed one rung per city so every
  city from the 5th to the 32nd buys something new; the bot signs the Imperial Charter in city 31).
- *ui*: charter perks rendered in the Legacy panel (cost chip `◆ N`, available `◆ have / total`),
  `synergy.text` on building cards, unlock-toast dedupe across foundings, toasts never over Buy buttons.
- *tools/economy-sim.mjs* (integrator): reports `metrics.cycles, reachShare, underPowerShare,
  minPowerRatio, happinessDipCities, emptyLateCycles, neverPurchased` (plus `tensionShare` /
  `tensionNextShare` for reference) and `final.prestige { legacy, spent, lifetimeEarned }`;
  `contractPass` = every gate above with zero issues and zero errors. The in-run "flat income"
  check applies to the first city only (a replay re-buys its ladder in three minutes and then earns
  toward the next founding on a near-flat income — that is the plateau the cadence target asks for,
  not a stall).

**Measured (2026-09-07 polish integration, `logs/sim-gauntlet.json`, `npm run sim -- --ticks 432000`):**
PASS, contract PASS, 0 issues, 0 errors. 32 foundings; cycles (min) 41.8 · 12.6 · 11.4 · 7.1 · 6.3 ·
8.2 · 11.0 · 13.6 · 15.5 · 19.2 · 20.7 · 16.4 · 10.1 · 5.6 · 7.5 · 10.1 · 13.2 · 16.7 · 22.5 · 30.0 ·
25.9 · 32.9 · 22.8 · 27.7 · 34.3 · 34.3 · 45.4 · 50.1 · 36.2 · 46.3 · 21.7 · 23.3 (strict max ratio
×1.346 at cycle 19, last 23.3 min); 0 empty late cycles; every building and all 69 upgrades bought;
reach 53.3 % (priciest-item 20.6 %); under-power 3.14 %, floor 0.60; happiness dips in 21/32 cities;
legacy 270,633 (127,476 spent on all twelve charter perks), money peak 2.77e16, income 8.5e14/s at
12 h; ~18.7k ticks/s. Saver profile (`--saver`, `logs/sim-saver.json`): PASS, contract PASS (hard
gates only): 33 foundings, first 34.4 min, reach 68.7 %, under-power 1.5 %, legacy 379,439, money
peak 7.1e16, 11 empty late cities (9, 10, 12, 13, 15, 20, 21, 24, 29, 31, 32).
**Open (documented, not gated):** the saver profile's empty late cities — one price table cannot
serve a 5 s-reach and a 30 s-reach bot without a 20th late rung (`config.js`, "Why the saver
profiles have empty cities"); first-city purchase tension reads 0 % of its 41 minute-samples (the
core ladder opens a reflex buy every 1–2 min; needs re-spaced gates, not prices); three mid-session
cycles run 45–50 min (26–28: Stellar Engine / Superconductor Grid / Energy Charter — a felt clause
on the power content would let balance move the Galactic Charter to city 27).
