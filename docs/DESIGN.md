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

**Measured (2026-09-14 wave, round 4 — wave-3 integrator verification, 2026-09-15; `logs/sim-gauntlet.json`,
`logs/sim-saver.json`, `logs/sim-human.json`, `logs/sim-human-24h.json`, `node src/buildings/cadence.mjs`,
`node tools/verify.mjs --ticks 10000 --tag wave3`; the greedy bot is the round-3 honest grid-ahead player,
`src/core/bot.js`, and the human bot now founds at share 1.0 — see "Human-profile calibration"):**
Greedy PASS, **contract PASS, 0 issues, 0 errors** (round 3 read contract FAIL on two lines, both closed here:
[variety] 2/29 late cycles empty → **0/29**, and [power] session under-power 0.8 % → **3.6 %** inside the 3–20 % band).
34 foundings; cycles (min) 35.0 · 11.0 · 9.7 · 6.8 · 6.5 · 8.4 · 11.1 · 13.7 · 17.1 · 22.2 · 23.5 · 25.9 · 11.6 · 6.7 · 8.9 · 11.6 · 14.7 · 17.9 · 17.4 · 22.4 · 29.7 · 37.6 · 49.3 · 31.8 · 38.3 · 25.8 · 27.1 · 24.0 · 23.8 · 30.4 · 32.9 · 27.2 · 13.8 · 18.2
(none over ×1.35 from the 5th; longest 49.3 at cycle 23, last 18.2); **0 empty late cycles** (the wave-3 tail re-placement
moves the Superconductor Grid above the Galactic Charter so cities 27–33 get seven novelties for seven cities —
`src/balance/plan.json` and the `cityOrder` table in `balance.test.mjs` record the shipped order);
every building and all 94 upgrade rungs bought; reach 53 %;
under-power **3.6 %** of the session (by hour 0.2 % · 0.4 % · 0.1 % · 0.3 % · 0.2 % · 16.8 % · 4.1 % · 1.6 % · 8.7 % · 11.0 % · 0.0 % · 0.0 %; ≥ 1 % in 5 of hours 3–12), floor 0.60;
median cap/demand by hour 1.16 · 1.68 · 1.57 · 1.56 · 1.13 · 1.05 · 1.00 · 1.00 · 1.00 · 1.06 · 1.28 · 1.35 (none > 2.5 from hour 3, none < 1.0 from hour 2); happiness dips in
21/34 cities (last half 4/17); legacy 530,998 (213,186 spent on all twelve charter perks), money peak 4.21e+17 (tick level).
Saver (`--saver`, `logs/sim-saver.json`): PASS, contract PASS, 0 issues: 35 foundings, first 32.6 min, reach 63 %,
under-power 3.1 %, legacy 743,544, money peak 6.28e+17, 4 empty late cities; the 36th founding (the one
that crosses the 1e6 ceiling) still cannot land before ~728 min (`balance.test.mjs` holds ≥ 727).
Human profile (`--profile human`, `logs/sim-human.json`; ten gates in `tools/economy-sim.mjs`): 8 of 10 PASS.
Cycles 45.5 · 13.1 · 16.4 · 13.7 · 28.0 · 47.1 · 43.2 · 40.0 · 42.2 · 50.8 · 62.3 · 85.9 · 75.4 · 125.0 (14 foundings);
**F1(a) PASS** — every complete city 4–9 is under the 90-min branch (13.7 · 28.0 · 47.1 · 43.2 · 40.0 · 42.2, was 63.0 · 76.1 · 73.1 · 105.6 · 164.1);
**F1(b) still FAIL** — longest stretch with no DECISION purchase 26.3 · 46.8 · 43.2 · 40.0 · 27.2 min in cities 5–9 against a 20-min rule
(was 61.3 · 76.1 · 48.1 · 104.8 · 51.0 in cities 4–8: better in every city, still open; the all-purchases gap over the same run reads 10 · 20 · 11 · 11 · 14);
median cap/demand by hour 1.07 · 1.50 · 1.52 · 1.64 · 1.32 · 1.17 · 1.08 · 1.00 · 1.00 · 1.00 · 1.00 · 1.00
(none > 4.0 from hour 3, none < 1.0, no city with a ≥ 3× median); median unemployment by hour 19 % · 0 % · 0 % · 0 % · 0 % · 0 % · 13 % · 0 % · 0 % · 0 % · 0 % · 1 %
(**inside 2–15 % in 1 of hours 3–12 against a ≥ 3 rule — a regression from round 3's 3 (h7 14 %, h11 4 %, h12 3 %); it is content, not the profile:
the same wave-3 tree run with the old share-2.0 rule reads 0 of 10 and fails the > 15 % line as well, so the new founding rule improves this line
rather than causing the drop — see "Open" below**), by city none > 20 % from the 4th, jobs/pop 1.03 · 0.53 · 0.97 · 1.29 · 1.28 · 1.26 · 1.17 · 1.20 · 1.17 · 1.21 · 0.87 · 1.10 · 1.12 · 1.12 (0.85–1.3 in every complete city ≥ 4);
Lights Out (≥ 30 s at ratio ≤ 0.95, strain-aware guard) in city 12 (258 s) — earned by content, one complete city ≥ 4 against a ≥ 1 rule;
F12 segment hour 2 0.67 min, hour 3 0.62; legacy 40,965, money peak 2.84e+14.
Human 24 h (`--ticks 864000`, `logs/sim-human-24h.json`): every gated line passes — power over hours 2–24 (none > 4.0 from hour 3,
no ≥ 3× city in 20 cities), unemployment per-city and per-hour, jobs/pop 0.85–1.3 in all 17 complete cities ≥ 4,
Lights Out in 4 complete cities (12, 15, 16, 17) against a ≥ 2 rule, F12 — and the run exits non-zero on the flat
12 h magnitude ceiling alone (legacy 2,622,972 at 24 h; 20 foundings). See "Open" below: that ceiling is a contract
question, not a balance miss, and it has not been loosened here.
First-city building cadence (`node src/buildings/cadence.mjs`, `buildings.test.mjs` 19 and 20): **0 problems** — the four pairs
round 3 read under the 90 s rule are office→tower **92 s** (was 28), nuclear→techpark **122 s** (was 88),
financial→fusion **114 s** (was 70) and fusion→stadium **112 s** (was 30); first city founds at 35.0 min, 0 errors.
Headless verify (`--ticks 10000 --tag wave3`, `logs/wave3.json`): PASS, 0 errors, tick avg 0.013 ms, p99 0.10 ms, **60.3 fps**, no overflow.
Suite: `npm test` **10/10 files** (214 assertions).
Control runs (`logs/sim-human-control-prewave.txt`, `logs/sim-human-control-round2.txt`, `logs/sim-human-sticker.txt`): the pre-wave content with the
final bot fails every power line and Lights Out; the sticker guard latches 0 cities ≥ 4 on the round-3 content (hours of 0.95 < ratio < 1, never ≤ 0.95).

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

**Open (documented, not gated; 2026-09-14 wave, round 4 verification 2026-09-15 — the numbers are
the logs named in "Measured" above):**
- *The magnitude ceiling is a 12 h contract read on 24 h runs.* Principle 4 above says money ≤ 1e18
  and legacy ≤ 1e6 **at 12 h**; `tools/economy-sim.mjs` applies the same two numbers at any
  `--ticks`. On 12 h nothing is near them. On the 24 h human run the legacy half is decided by how
  many cities the founding rule fits into the second twelve hours, not by balance: share 2.0 read
  886,015 (12 foundings) and share 1.0 reads 2,622,972 (20 foundings, logs/sim-human-24h.json), so the 24 h run reports a
  `magnitude` issue and exits non-zero while every gated 24 h line — power, unemployment, Lights
  Out, F12 — passes. The check has not been loosened or made hours-aware here: whether the ceiling
  should scale with the run, be read only at the 12 h mark, or stay flat is a contract decision, not
  an integrator flip.
- *F1 human cadence.* Two lines, and wave 3 splits them. **(a) The ratio line** (each complete city
  4–9 ≤ 1.35× the previous or ≤ 90 min) read ×1.44 / ×1.55 on cities 7 and 8 of the share-2.0
  profile, and it was never closable by fixed-threshold content: at "found once the haul is ≥ 2× the
  bank" the bank triples every city, so lifetime earnings must grow 3^(1/0.488) = 8.5× per city —
  that arithmetic, not a price, produces cycles 63.0 · 76.1 · 73.1 · 105.6 · 164.1, and buying the
  ratio back needs a ~×1.25 plateau income term in cities 7–9 alone on a saver already at 35/35
  foundings and 6.31e17 of a 7e17 ceiling. It is closed by re-fitting the instrument instead (see
  "Human-profile calibration" above): at share 1.0 the complete cities 4–9 all sit under 90 min and
  the line passes on its own escape clause, at the legacy cost recorded there. **(b) The decision-gap
  line** (no stretch > 20 min without a purchase whose reach at unlock was ≥ 30 s) is content's, not
  the profile's: on the share-2.0 tree the gap read 61 · 76 · 48 · 105 · 51 min in cities 4–8 while
  the *all-purchases* gap over the same run read 28 · 18 · 23 · 28 · 45 — the whole difference being
  the treasury-holds-the-price (`funded`) door on the fleet ladder, which makes reach-at-unlock 0 by
  construction and hides every rung behind it from the metric. Shortening the cities does not by
  itself close it (share 1.0 on the same content still reads 26 · 47 · 43 · 40 · 27 in cities 5–9).
  **The named lever was built and refuted in round 4.** Dropping `funded` from the fleet columns
  moved the decision gap only inside noise (cities 4–6: 61.3 · 76.1 · 48.1 → 58.9 · 76.7 · 46.0) and
  cost `reachShare` two thirds (48 % → 16 %), because at the tick each count gate opens the rung is
  worth 0.2–26.6 s of income *everywhere* in cities 4–9 — always under the 30 s threshold, with or
  without the money door. The cause is arithmetic, not placement: a fleet rung is priced in fixed
  dollars and re-bought every city while income triples per city, so the same rung is 4.4 s of
  income in city 4 and 0.2 s in city 9. Closing it needs a price that scales with the city (the
  gating building's *current* cost), and `cost` is a static number on the definition — a core API
  change, not content. Round 4's 24-rung, six-gate ladder (60/90/115/140/160/180 per column) is what
  took every city's gap down from the round-3 reading; the line stays open on that seam
  (docs/FEEDBACK.md F1).
- *The greedy's under-power floor — closed in round 4, and how.* Round 3's honest grid-ahead greedy
  read 0.9 % of 12 h against the contract's 3–20 %, and the module header's sweep showed the only
  knob that bought the line outright (a ×1.12 city-wide draw) overshot the other way, taking a
  fully-upgraded city to ×1.16 of its stickers and breaking the invariant that all-owned demand sits
  near ×1.0. Round 4 took the third option the sweep left open: spread the same bite over *more,
  smaller* rungs — `FLEET_DRAW` 1.07 on six draw rungs (Trading Floors and Campus Expansion II/IV/VI)
  instead of ×1.12 on two — which reads 3.6 % of the session (by hour ≥ 1 % in 5 of hours 3–12, peak
  16.8 % in hour 6) and 328 · 278 · 146 · 302 · 334 s under power in greedy cities 21–28. The
  all-owned demand invariant was **re-stated, not relaxed**: `upgrades.test.mjs` now pins the exact
  product ×1.105 to ±0.002 with a two-sided 1.09–1.12 band and the card text says so, where before it
  pinned ≈ ×1.0 — a tighter assertion against a deliberately different number. The human profile earns
  its Lights Out from the same steps (city 12, 258 s on 12 h; cities 12/15/16/17 on 24 h).
- *The human unemployment band regressed in round 4, and it is content.* The gate "median
  unemployment inside 2–15 % in ≥ 3 of hours 3–12" read 3 of 10 on round 3 (h7 14 %, h11 4 %, h12 3 %
  — passing by exactly the minimum) and reads **1 of 10** here (h7 13 %). Attributed by A/B rather
  than by argument: the same round-4 tree run with the *old* share-2.0 founding rule reads **0 of 10**
  and also trips the "> 15 %" line (h7 17 %), so the new founding rule improves this line and the
  drop came with the content. The cause is the fleet ladder's two employer columns: six ×1.078 jobs
  rungs per column per city compound to ×1.57, which lifts jobs/pop in the human's cities 4–10 to
  1.17–1.29 (round 3: 0.89–1.27) and leaves structurally zero unemployment in the hours between.
  Every other unemployment line still passes on both 12 h and 24 h (per-city ≤ 20 %, per-hour ≤ 15 %,
  jobs/pop inside 0.85–1.3 in all 17 complete cities of the 24 h run). The lever is the ladder's
  jobs-to-housing ratio (two employer columns against one housing column), which is upgrades content
  and re-times F1 and the greedy contract if it moves — not an integrator patch.
- *Happiness is decorative late.* Greedy dips below 1.0 sit in the first 21 cities (last half of
  the cities 4 of 17 on the round-3 log); human 24 h cities 9–12 read minHappiness 1.06–1.4. The
  ≥ 50 % line holds on the first half and is kept; civic content past greedy city 21 / human city 9
  is accepted as decorative (docs/FEEDBACK.md F4's trade-off is what remains of the lever).
- *F12b tempo.* The point bar is decorative past hour 4 on exponent 0.488 (a point every ≤ 5 s
  from hour 4 in every profile); gated where it is readable — hour 2 within 0.5–30 min, hour 3
  ≥ 0.5 (human) / ≥ 0.25 (greedy: hour 3 is cities 5–9 with 7–12-minute cycles on a ×1.4-per-
  founding sequence). A ~0.35 exponent is a full re-placement wave (docs/FEEDBACK.md F12b).
- *The post-stack surplus.* With the power fold bounded at ×5.49 supply / ×0.736 demand (net ×7.5
  over a session) the human's mature grid settles at 1.0–1.4× demand on 24 h (hours 17–24 1.14 · 1.36 · 1.34 · 1.27 · 1.24 · 1.45 · 1.42 · 1.40) and the greedy's at 1.4–1.55× in hours 11–12: a
  1.2–2.0× plateau is the accepted late surplus; the ≤ 4.0 / no-≥ 3×-city lines hold over every
  hour played.
- *Saver placement.* One price table cannot put both profiles 5 % inside: a saver's 30 s-of-income
  reach lands every frontier rung ~2 cities before the greedy's spree pile (`config.js`, "What
  the saver brake is"); the saver's empty late cities follow from the same gap. The first city's
  purchase tension reads 0 % of its minute-samples (the core ladder opens a reflex buy every 1–2
  min; needs re-spaced gates, not prices).
