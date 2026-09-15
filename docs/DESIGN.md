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

## Upgrades (`src/upgrades/index.js`) — 70 upgrades (58 money + 12 charter perks)

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
  pop: { growthRate: 0.11, shrinkRate: 0.2, baseInflow: 0.5 },
  power: { brownoutFloor: 0.6 },
  happiness: { civicCap: 1.12, civicScale: 1.5, pollutionScale: 0.35, pollutionCap: 1.1, pollutionCurve: 1,
               unemploymentPenalty: 0.35, overcrowdPenalty: 0.5, brownoutPenalty: 0.6, min: 0.25, max: 3 },
  cost: { tierGrowth: { 1: 1.18, 2: 1.16, 3: 1.13, 4: 1.112 }, sellRefund: 0.5 },
  prestige: { threshold: 1.1e7, exponent: 0.488, incomePerLegacy: 0.01, legacyPower: 0.548, firstBonus: 0.15,
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
  charter prices live in `config.upgrades` (shipped: frontier $4.79e7 → $4.87e15 in canonical order,
  nine pace rungs $8.84e7 → $4.35e14, perks ◆ 3 → ◆ 150,500 at ×2.5–4, placed one rung per city so every
  city from the 4th to the 33rd buys something new; the bot signs the Imperial Charter in city 32).
- *ui*: charter perks rendered in the Legacy panel (cost chip `◆ N`, available `◆ have / total`),
  `synergy.text` on building cards, unlock-toast dedupe across foundings, toasts never over Buy buttons.
- *tools/economy-sim.mjs* (integrator): reports `metrics.cycles, reachShare, underPowerShare,
  minPowerRatio, happinessDipCities, emptyLateCycles, neverPurchased` (plus `tensionShare` /
  `tensionNextShare` for reference) and `final.prestige { legacy, spent, lifetimeEarned }`;
  `contractPass` = every gate above with zero issues and zero errors. The in-run "flat income"
  check applies to the first city only (a replay re-buys its ladder in three minutes and then earns
  toward the next founding on a near-flat income — that is the plateau the cadence target asks for,
  not a stall).

**Measured (balance wave 3, shipped `a570de0`, 2026-09-15 — integrator run and reproduced independently
by three skeptics; `logs/sim-gauntlet.*`, `logs/sim-saver.*`, `logs/sim-human.*`, `logs/sim-human-24h.*`,
`node src/buildings/cadence.mjs`, `node tools/verify.mjs --ticks 10000 --tag wave3`. The greedy bot is the
honest grid-ahead player, `src/core/bot.js`; the human bot founds at share 1.0 — see "Human-profile
calibration". The wave's skeptic gate returned REFUTED; nothing in docs/FEEDBACK.md is ticked.):**

*Greedy 12 h (`--ticks 432000`):* PASS, **contract PASS, 0 issues, 0 errors**. 34 foundings; cycles (min)
35.0 · 11.0 · 9.7 · 6.8 · 6.5 · 8.4 · 11.1 · 13.7 · 17.1 · 22.2 · 23.5 · 25.9 · 11.6 · 6.7 · 8.9 · 11.6 · 14.7 · 17.9 · 17.4 · 22.4 · 29.7 · 37.6 · 49.3 · 31.8 · 38.3 · 25.8 · 27.1 · 24.0 · 23.8 · 30.4 · 32.9 · 27.2 · 13.8 · 18.2
(none over ×1.35 from the 5th; longest non-last 49.3 against a `plan.json cycleMax` of 50 — 1.5 % of margin
left, decide before the next income change). **0 empty late cycles** (was 2/29, first cycle 21) and
`neverPurchased` empty: the tail re-placement moves the Superconductor Grid above the Galactic Charter
($1.5Qa vs $853T) so cities 27–33 get seven novelties for seven cities, and no late city is filled by a
fleet rung alone. reach 53 %; under-power **3.6 %** of the session (by hour 0.22 · 0.44 · 0.11 · 0.28 · 0.17 ·
16.82 · 4.06 · 1.61 · 8.72 · 11.00 · 0.00 · 0.00 %; ≥ 1 % in 5 of hours 3–12), floor 0.60; median cap/demand by hour
1.16 · 1.68 · 1.57 · 1.56 · 1.13 · 1.05 · 1.00 · 1.00 · 1.00 · 1.06 · 1.28 · 1.35 (none > 2.5 from hour 3, none < 1.0
from hour 2); happiness dips in 21/34 cities (last half 4/17); legacy 530,998 (213,186 spent on all twelve
perks), money tick-peak 4.21e17.

*Saver 12 h (`--saver`):* PASS, contract PASS, 0 issues. 35 foundings, first 32.6 min, reach 63 %, under-power
3.1 %, legacy 743,544, money tick-peak 6.28e17, longest non-last cycle 49.6. **Not gated and not green:**
`GATED = PROFILE === 'default'` (`tools/economy-sim.mjs:89`), and the saver carries
`emptyLateCycles [18, 30, 31, 34]` — the same metric whose greedy reading is the line this wave closed.

*Human 12 h (`--profile human`; ten gates):* **8 of 10 PASS.** Cycles 45.5 · 13.1 · 16.4 · 13.7 · 28.0 · 47.1 ·
43.2 · 40.0 · 42.2 · 50.8 · 62.3 · 85.9 · 75.4 · 125.0 (14 foundings). F1(a) prints PASS over complete cities 4–9
— **but see "Open": that is a window artifact, not a closed line**; the same run's cities 10–14 read
50.8 · 62.3 · 85.9 · 75.4 · 125.0 min (c12 ×1.38, c14 ×1.66) outside the window and unread. F1(b) **FAILS**:
longest stretch with no DECISION purchase 26.3 · 46.8 · 43.2 · 40.0 · 27.2 min in cities 5–9 against a 20 min
rule (HEAD 61.3 · 76.1 · 48.1 · 104.8 · 51.0; all-purchases gap over the same run 10 · 20 · 11 · 11 · 14; as a
*fraction of the city* the gap is 1.00 in cities 7, 8 and 10). Median cap/demand by hour 1.07 · 1.50 · 1.52 ·
1.64 · 1.32 · 1.17 · 1.08 · 1.00 · 1.00 · 1.00 · 1.00 · 1.00 (none > 4.0 from hour 3, none < 1.0, no city with a ≥ 3×
median); session under-power 2.7 % (below the contract's 3 % floor, not gated on this profile); median
unemployment by hour 19 · 0 · 0 · 0 · 0 · 0 · 13 · 0 · 0 · 0 · 0 · 1 % — **inside 2–15 % in 1 of hours 3–12 against a
≥ 3 rule: FAIL, and a regression from 3 of 10** (see "Open"); by city none > 20 % from the 4th; jobs/pop
1.03 · 0.53 · 0.97 · **1.29 · 1.28** · 1.26 · 1.17 · 1.20 · 1.17 · 1.21 · 0.87 · 1.10 · 1.12 · 1.12 (0.85–1.30 in every
complete city ≥ 4, c4 on the rail); Lights Out (≥ 30 s at ≤ 0.95, strain-aware) in **city 12 alone** (258 s)
against a ≥ 1 rule, with cities 1–11 at exactly 2 s under power; `reachShare` over complete cities 4–9
**39 % of 212 samples against a reported ≥ 40 % target** (HEAD 48 % of 480; session 48 %; c4 reads 0 %);
F12 hour 2 0.67 min, hour 3 0.62; legacy 40,965, money tick-peak 2.84e14.

*Human 24 h (`--ticks 864000`):* **FAIL, contract FAIL, 3 issues, 0 errors.** `magnitude` (legacy 2,622,972 and
money tick-max **9.99e17 against 1e18 — 0.1 % of headroom** — against a ceiling the contract states at 12 h),
`unemployment` (1 of 10, same as 12 h) and `cadence` (F1(b), cities 5–12 at 26 · 47 · 43 · 40 · 27 · 51 · 53 · 74 min).
Every *other* gated line passes: power over hours 2–24 (none > 4.0 from h3, none < 1.0 from h2, no ≥ 3× city
in 20 cities), per-city and per-hour unemployment, jobs/pop 0.85–1.30 in all 17 complete cities ≥ 4, Lights
Out in 4 cities (12, 15, 16, 17) against a ≥ 2 rule, F12. Cycles 13–20 read 75.4 · 125.0 · 130.8 · 109.5 · 123.9 ·
58.2 · 113.2 · 120.4 min (c14 ×1.66, c19 ×1.95, six cities over the 90-min branch), all outside the cities-4–12
window and unread; session reach 29 %, `emptyLateCycles [18, 19]`.

*First-city building cadence (`node src/buildings/cadence.mjs`, `buildings.test.mjs` 19 and 20):* **0 problems.**
office→tower **90–92 s** (was 28), nuclear→techpark **122–126 s** (was 88), financial→fusion **114 s** (was 70),
fusion→stadium **108–112 s** (was 30); first city founds 35.0 min, peak pop 80,319 (−2.8 %), first shop 0.8 min,
0 errors. Not bought at the first city's expense: `probe.mjs --trace 0` prints a byte-identical city-0 trace
through minute 12 on both trees (pop 999 at 10.3 min, 2,291 at 12.0), tower and school *buy* times are unchanged
at 9.9 / 11.6 min (only their open times moved), and first-city purchase tension reads 41 % → 43 %.

*Headless verify (`--ticks 10000 --tag wave3`, `logs/wave3.json`):* PASS, 0 errors, tick avg 0.011–0.015 ms,
p99 0.10 ms, **60.2–60.4 fps**, no overflow. *Suite:* `npm test` **10/10 files**, exit 0 (was 8/10).

*Gate-tampering check, run first and independently by all three skeptics on `git diff 1c3ebfa a570de0`:*
clean. `tools/economy-sim.mjs` comment-only; `buildings.test.mjs` no diff at all; `balance.test.mjs` only its
hand-written `cityOrder` mirror re-ordered to the shipped ladder with the 22-rung monotonicity assertion
byte-identical; `upgrades.test.mjs` **tightened** (all-owned demand pinned to the exact product ×1.105 ±0.002
inside a two-sided 1.09–1.12, replacing a one-sided 0.95–1.05). One minor documented widening: the Blueprints
per-city fold moved from exact `near(fold, 1.12^4)` to a 0.5 % relative band (1.078^6 = 1.5693 vs 1.5735).

**Human-profile calibration (wave 3, 2026-09-15 — what the instrument is fitted to, and what that
costs).** F1 is a wall-clock cadence contract, and the human profile is the instrument it is read
with, so the profile's founding rule (`HUMAN_FOUND_SHARE`, `src/core/bot.js`) is calibrated to the
playtest screenshot's **clock** — the player is in city 6 at 92 min of playtime. The same screenshot
carries a second observable that disagrees with the first: 415 legacy at the end of city 6, which on
exponent 0.488 implies ~90-minute cities where the clock implies ~15-minute ones. No founding rule
satisfies both on this economy, and the 2026-09-14 sweep fitted share 2.0 to the legacy column alone
with the clock column in the same frame left unread — an instrument running ×3 slow against the clock
it claims to reproduce. The rule is now share 1.0, "found once the haul would double the bank": the
deepest push that still lands within one city of the player's clock and keeps F1's cadence line on its
≤ 90-min branch (share 1.5, the next rung up, fails it outright). **What that costs, stated so it is
not re-read as free:** the legacy observable drops from ×0.98 of the player to ×0.19 (city-6 legacy
405 → 80) and Megastructures unassisted moves from city 7 to city 10. F16's finding still stands and
still rules out founding at the gate (legacy ×0.07, Megastructures city 19). The full five-row sweep,
both columns and the F1 verdict per row, is tabulated above `HUMAN_FOUND_SHARE`; the sim prints both
columns on every human run ("vs the player's screenshot") so the legacy cost stays visible. The
shipped value is pinned two-sided in `src/core/core.test.mjs` — it is a measuring-instrument setting,
not a tuning knob, and moving it re-times every F1 number in this file.
**What the wave-3 skeptics established about this change, to be read with it:** the whole of F1(a)'s
"PASS" is this one line. The shipped tree at the old rule (`--found triple`) still FAILS F1(a) at
c7 ×1.46 / c8 ×1.58, and HEAD's untouched tree at the new rule (`--found double`) PASSES it — so the
wave's content moved F1(a) by noise, and because the gate's window is indexed by city number rather
than by the clock, the long cities moved out from under it rather than away (see "Open", Lens A).

**Open — standing refutations from the wave-3 skeptic gate (2026-09-15, verdict REFUTED by all three
lenses on the shipped tree `a570de0`). Listed by lens; every number is from the logs named in "Measured".
These are demands on the next wave, not documentation of a passing state.**

*Lens A — "F1 and the shape of a city: did wave 3 give the player something to DO, or move the wait
where the gate does not look?" (refuted, confidence 0.93)*
- **F1(a) was closed by the instrument, not by the game, and must not be recorded as closed.** Matched
  experiments: the shipped tree at the old founding rule (`--found triple`) FAILS at c7 ×1.46 / c8 ×1.58;
  HEAD's untouched 16-rung tree at the new rule (`--found double`) PASSES. The delta is 100 %
  `HUMAN_FOUND_SHARE 2.0 → 1.0` (`src/core/bot.js:293`) and 0 % content.
- **Fix the window before any further F1 work.** `complete cities 4–9` (`lastRatioCity = hours >= 24 ? 12 : 9`)
  is a city-INDEX window measuring a wall-CLOCK contract: at 8 foundings it covered run-minutes 83–565, at
  14 it covers 75–207. Re-express it in game hours (every complete city that ENDS after hour N), or read
  every complete city; then re-read F1(a) on HEAD and on the shipped tree under the new window and publish
  both. Until then the gate prints its own counter-evidence as unread: 12 h cities 10–14 =
  50.8 · 62.3 · 85.9 · 75.4 · 125.0 min; 24 h cities 14–20 = 125.0 · 130.8 · 109.5 · 123.9 · 58.2 · 113.2 · 120.4
  with c19 ×1.95.
- **Make the ratio clause able to fail.** With every windowed city at 13.7–47.1 min the `≤ 90 min` branch
  carries the gate alone and c5 ×2.05 / c6 ×1.68 pass unremarked. Either drop the OR-branch past some index
  or rename F1(a) here as what it actually is — a "no city over 90 min" check.
- **Restore the unemployment band gate to PASS** (`≥ 3 of hours 3–12 inside [2 %, 15 %]`) before any wave is
  called green: 3 of 10 at HEAD → **1 of 10** now (h7 13 %), on both 12 h and 24 h. A green line the wave
  regressed and disclosed; disclosure is not closure.
- **Fix the human 24 h magnitude failure rather than leaving it undecided.** The run exits 1 on legacy
  2,622,972 vs a 1e6 ceiling *and* money tick-max 9.99e17 vs 1e18. Not by loosening: either the ceiling is a
  per-12h-equivalent and the check must say so, or 20 foundings in 24 h is itself the defect. As it stands
  the profile F1, F2 and F3 are all measured with cannot finish a 24 h run.
- **Justify or revert the 8 extra fleet rungs per column.** At matched profile they move all-purchase gaps by
  noise (10/20/11/11/14 vs HEAD 10/20/12/15/14), take `reachShare` over cities 4–9 from 44–48 % to 39 %
  (target ≥ 40 %), and make city 8's decision gap 51 → 82.3 min at the old profile. `src/upgrades/data.js`
  already states in the tree that this ladder cannot close F1(b).
- **Gate the saver's variety line or state why it is exempt** (`emptyLateCycles [18, 30, 31, 34]`, read by no
  contract, while the greedy's identical metric is the line this wave closed).

*Lens B — "power, variety and the greedy contract" (refuted, confidence 0.79; three of four red lines
independently confirmed closed)*
- **Say `GATED = PROFILE === 'default'` out loud beside every "contract PASS".** "Variety: 0 empty late
  cycles" is a greedy-12h sentence; the saver reads `[18, 30, 31, 34]` and the human 24 h `[18, 19]` with the
  contract silent.
- **Replace the per-city decision-gap MINUTES line with the gap as a fraction of the city, or print both.**
  Minutes fall whenever cities shorten and say nothing about plateau density; the fraction is **1.00 in
  cities 7, 8 and 10** on this tree (the whole city is one gap, all 36–37 purchases at minute 0) and was
  0.97–1.00 in cities 4, 5 and 7 at HEAD. Any claim that a ladder "spaces purchases" must move the fraction.
- **State the Lights Out line at the scope the record uses.** "Earned by content in cities 7–8" is now one
  complete city (12) on the 12 h human with cities 1–11 at exactly 2 s under power. Either record that as a
  regression alongside the unemployment one, or re-state the green line as the gate's actual contract
  (≥ 1 city on 12 h, ≥ 2 on 24 h) and say so — the gate counts cities with index ≥ 4 and cannot see the move.
- **F2 is not ticked.** Its own contract line (under-power 3–20 %) is met for the first time on the gated
  profile, but its first stated consequence went the wrong way and the human 12 h session reads 2.7 %, under
  the 3 % floor. If a later wave ticks it, the restated invariant goes in the box: all-owned demand is
  **×1.105** of sticker, pinned two-sided at 1.09–1.12 — the old "net ≈ ×1.0 of sticker" claim must not survive.
- **Run the F3 `--grant` what-if on this tree before F3 is judged again.** The founding rule moved unassisted
  Megastructures from city 7 to **city 10 at ~326 min**, and every run printed `granted no city`, so F3's
  evidence at the player's own point is missing from the record.
- **One prose-over-check line in `src/upgrades/upgrades.test.mjs`:** the frontier comment claims "never wider
  than ×6 / the widest step is the Ringworld District at ×6.5" while the loop beneath it starts after
  `stellar-engine` and never reads that ×6.45 step. Widen the loop (correct) or stop quoting a bound the
  assertion does not enforce.
- **`plan.json cycleMax` is nearly spent:** greedy longest non-last cycle 49.27, saver 49.6, ceiling 50 (HEAD
  46.4 / 46.5). Decide before the next income change rather than discovering it as a HARD exit mid-wave.

*Lens C — "the first city, jobs, and everything that was green on 1c3ebfa" (refuted, confidence 0.86)*
- **The first city is verified undamaged** (byte-identical city-0 trace to minute 12; tower/school buy times
  unchanged; the cadence fix removed dead card-sitting rather than adding waiting), and F8 is verified
  untouched — but **F1, F3 and F7 must not be ticked**, and F2 only with the ×1.105 restatement above.
- **Publish `reachShare` over complete cities 4–9 (39 %, target ≥ 40 %, was 48 %) and the c4 = 0 % reading
  next to every F1(b) decision-gap claim.** The two moved in opposite directions and only one was reported.
- **Record the jobs/pop coupling in every hand-over:** c4 = 1.29 against a 1.30 limit, held by techpark 18,500
  + stadium 73,000 — numbers chosen for the buildings cadence probe. Any future move of either re-opens the
  unemployment gate, and the next wave must be told so.
- **F7 is unchanged and not clean:** the sim's own probe still reads `green-belts 1.00` and `city-archives 1.00`
  against its caption "a rung bought at 1.00 cannot deliver growth", and no skeptic has confirmed a player
  feels the rungs.

**Open (standing design items, carried; the numbers are the logs named in "Measured"):**
- *The magnitude ceiling is a 12 h contract read on 24 h runs.* Principle 4 says money ≤ 1e18 and legacy ≤ 1e6
  **at 12 h**; `tools/economy-sim.mjs:754` applies the same two numbers at any `--ticks`. On 12 h nothing is
  near them. On 24 h the legacy half is decided by how many cities the founding rule fits into the second
  twelve hours: share 2.0 read 886,015 (12 foundings), share 1.0 reads 2,622,972 (20 foundings) — and money
  tick-max is 9.99e17 against 1e18, 0.1 % of headroom, which is a tail-income number in its own right.
  Not loosened and not made hours-aware here; see Lens A's demand.
- *F1, both halves.* (a) is a window artifact (Lens A) and (b) is content's: a fleet rung has a **static dollar
  price** and is re-bought every city while income triples per city, so the same rung is worth 4.4 s of income
  in city 4 and 0.2 s in city 9 — under the 30 s DECISION threshold everywhere, with or without the `funded`
  money door (dropping that door was built and refuted in round 4: gaps moved inside noise, `reachShare` fell
  48 % → 16 %). Closing it needs a price that scales with the city (the gating building's *current* cost), i.e.
  a core API change, not content. docs/FEEDBACK.md F1.
- *The greedy's under-power floor — closed, and how.* Round 3's honest greedy read 0.8 % against 3–20 %. The
  knob that bought the line outright (a ×1.12 city-wide draw) overshot to ×1.16 of stickers; wave 3 spread the
  same bite over six ×1.07 rungs instead (Trading Floors and Campus Expansion II/IV/VI), reading 3.6 % with
  ≥ 1 % in 5 of hours 3–12 and 328 · 278 · 146 · 302 · 334 s under power in greedy cities 21–28. The invariant
  was re-stated tighter (×1.105 ±0.002, two-sided 1.09–1.12) with card text `draw +7 %` matching.
- *The human unemployment band regressed, and it is content.* 3 of 10 → 1 of 10 (h7 13 %). Attributed by A/B:
  the same tree at share 2.0 reads 0 of 10 and trips > 15 %, so the founding rule improves the line. The cause
  is the fleet ladder's two employer columns (six ×1.078 jobs rungs each, ×1.57 compounded), lifting jobs/pop
  in cities 4–10 to 1.17–1.29. The lever is the ladder's jobs-to-housing ratio (two employer columns against
  one housing column) — upgrades content, and it re-times F1 and the greedy contract if it moves.
- *Happiness is decorative late.* Greedy dips sit in the first 21 cities (last half 4/17); human 24 h cities
  9–12 read minHappiness 1.06–1.4. The ≥ 50 % line holds on the first half and is kept.
- *F12b tempo.* The point bar is decorative past hour 4 on exponent 0.488; gated only where readable (hour 2
  0.5–30 min, hour 3 ≥ 0.5 human / ≥ 0.25 greedy). A ~0.35 exponent is a full re-placement wave.
- *The post-stack surplus.* With the fold bounded at ×5.49 supply / ×0.736 demand the human's mature grid
  settles at 1.0–1.45× on 24 h and the greedy's at 1.28–1.35× in hours 11–12; a 1.2–2.0× plateau is the
  accepted late surplus and the ≤ 4.0 / no-≥ 3×-city lines hold over every hour played.
- *Saver placement.* One price table cannot put both profiles 5 % inside: a saver's 30 s reach lands every
  frontier rung ~2 cities before the greedy's spree pile, and its empty late cities follow from the same gap.
  The first city's purchase tension reads 0 % of its minute-samples (the core ladder opens a reflex buy every
  1–2 min; re-spaced gates, not prices — docs/FEEDBACK.md F17).
