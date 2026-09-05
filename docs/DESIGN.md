# Metropolis — Game Design & Module Contracts

Read ARCHITECTURE.md first. This file is the shared contract every builder codes against.
Numbers here are **starting points**; `src/balance/config.js` is the single source of tuning
truth and the balance builder may change any number without touching other folders.

> **Stale numbers warning.** The building and upgrade tables and the "Pacing target" paragraph
> below are the original design sketch. After the first balance pass `config.js` overrides
> 15 buildings (tier-4 base costs are 10–1000× lower than the table, e.g. arcology $120k,
> fusion $400k) and 29 upgrade costs, and the measured pacing is documented at the top of
> `config.js`. Treat the tables as the *shape* of the ladder; read `config.js` for the numbers.

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
  { id: 'money', name: 'Money', icon: '💵', color: '#4ade80', kind: 'stock', format: 'money' },
  { id: 'pop',   name: 'Population', icon: '👥', color: '#60a5fa', kind: 'stock', format: 'int' },
  { id: 'power', name: 'Power', icon: '⚡', color: '#facc15', kind: 'derived', format: 'power' }, // MW
  { id: 'happiness', name: 'Happiness', icon: '😊', color: '#f472b6', kind: 'derived', format: 'pct' },
];
// Pure. Reads registry buildings + state + mods, writes ALL derived fields. Called each tick by simulation.
export function computeDerived(state, derived, mods, config) {}
```

Math (per second; `dt` applied by simulation):
- `housing = Σ count·housing·mods.housing·byBuilding.housing`; same pattern for `jobs`, `powerCap` (powerGen·mods.power), `powerDemand` (powerUse — NOT scaled by mods.power; upgrades that cut demand use `byBuilding.power`? No: use `mods.demand` — add it: default 1).
- `powerRatio = demand > 0 ? clamp(cap/demand, config.power.brownoutFloor, 1) : 1`
- `employed = min(pop, jobs)`; `unemployment = pop>0 ? (pop-employed)/pop : 0`
- `happiness = clamp(1 + civic − penalties + mods.happiness, 0.25, 3)` where
  `civic = config.happiness.civicCap · (1 − exp(−Σ count·happiness / config.happiness.civicScale))`
  (negative building happiness, e.g. factories, subtracts linearly, scaled by `config.happiness.pollutionScale`),
  penalties: `unemployment·config.happiness.unemploymentPenalty`, `overcrowd = max(0, pop/housing − 1)·config.happiness.overcrowdPenalty`, brownout `(1−powerRatio)·config.happiness.brownoutPenalty`.
- `grossIncome = (pop·config.economy.taxPerPop + employed·config.economy.wage + Σ count·income·byBuilding.income) · mods.income · powerRatio · happinessIncomeCurve(happiness)`
  where `happinessIncomeCurve(h) = 0.5 + 0.5·h` (so h=1 → 1×, h=2 → 1.5×).
- `upkeep = Σ count·upkeep · mods.upkeep` (money/s; most buildings 0; big plants have upkeep).
- `income = grossIncome − upkeep` (may be negative; simulation clamps money ≥ 0).
- `popGrowth`: `target = housing`; if `pop < target`: `(target−pop)·config.pop.growthRate·happiness·powerRatio + config.pop.baseInflow` (baseInflow only if housing>pop) ; if `pop > target`: `−(pop−target)·config.pop.shrinkRate`.
- `costMult = mods.cost`.
- `derived.extra = { unemployment, overcrowd, civic, penalties: {...}, incomeBreakdown: { tax, wages, buildings, upkeep } }`.

## Buildings (`src/buildings/index.js`) — 20 buildings, 5 categories

`export const CATEGORIES = [{ id:'residential', name:'Residential', icon:'🏠', color:'#60a5fa' }, commercial 🏪 #4ade80, industrial 🏭 #fb923c, power ⚡ #facc15, civic 🏛️ #c084fc]`

`costGrowth` = `config.cost.tierGrowth[tier]` (defaults: t1 1.15, t2 1.14, t3 1.13, t4 1.12) unless overridden.
Apply `config.buildings[id]` partial overrides before `registerBuilding`. `unlock` rules latch (core handles).

| id | cat | tier | baseCost | housing | jobs | income/s | powerGen | powerUse | happiness | unlock |
|---|---|---|---|---|---|---|---|---|---|---|
| house | res | 1 | 30 | 4 | | | | 1 | | always |
| apartment | res | 2 | 400 | 24 | | | | 6 | | pop ≥ 20 |
| tower | res | 3 | 9,000 | 160 | | | | 40 | | pop ≥ 250 |
| arcology | res | 4 | 1.2e6 | 2,500 | | | | 500 | 0.02 | pop ≥ 5,000 |
| shop | com | 1 | 60 | | 5 | 0.3 | | 1 | | pop ≥ 4 |
| office | com | 2 | 900 | | 40 | 3 | | 8 | | pop ≥ 60 |
| mall | com | 3 | 20,000 | | 300 | 40 | | 60 | 0.01 | pop ≥ 600 |
| financial | com | 4 | 3e6 | | 4,000 | 900 | | 800 | | pop ≥ 12,000 |
| factory | ind | 1 | 350 | | 20 | 2.5 | | 10 | −0.02 | pop ≥ 30 |
| refinery | ind | 2 | 15,000 | | 200 | 60 | | 120 | −0.05 | pop ≥ 800 |
| techpark | ind | 3 | 1.5e6 | | 2,500 | 1,500 | | 900 | 0.02 | pop ≥ 8,000 |
| windmill | pow | 1 | 120 | | | | 6 | | | powerDemand > 0 |
| coal | pow | 2 | 1,500 | | 10 | | 80 | | −0.03 | powerDemand ≥ 20 |
| solar | pow | 3 | 25,000 | | | | 900 | | 0.01 | pop ≥ 1,000 |
| nuclear | pow | 4 | 2e6 | | 100 | | 25,000 | | | pop ≥ 10,000 |
| fusion | pow | 4 | 5e8 | | 200 | | 2e6 | | 0.05 | pop ≥ 100,000 or legacy ≥ 1 |
| park | civ | 1 | 200 (growth 1.2) | | | | | | 0.05 | pop ≥ 15 |
| school | civ | 2 | 5,000 (1.18) | | 30 | | | 5 | 0.08 | pop ≥ 300 |
| hospital | civ | 3 | 80,000 (1.18) | | 200 | | | 50 | 0.12 | pop ≥ 2,500 |
| stadium | civ | 4 | 5e6 (1.2) | | 500 | 2,000 | | 300 | 0.25 | pop ≥ 20,000 |

Each building needs `name`, `icon` (emoji), `desc` (one flavorful line ≤ 70 chars), `tier`, `category`.
Unlock functions take `(state, derived)`.

## Upgrades (`src/upgrades/index.js`) — ≥ 24 upgrades

`effect(mods, state)` mutates the mods bag only. `unlock(state, derived)`. Fields: `id, name, icon, desc, cost, category` (`residential|commercial|industrial|power|civic|global|prestige`), `tier`.
Apply `config.upgrades[id]` overrides (cost) before registering. Cost ladder roughly ×4–6 per step
from $150 up to $1e10. Effect ideas (use `import { buildingMod } from '../core/mods.js'`):

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

- `init(game)`: register tick handler `'simulate'` priority 0; register actions `canPrestige`, `prestigeGain`, `prestige`, `tap`; if fresh state (`tick===0 && money===0 && no buildings`) set `state.res.money = config.economy.startMoney`.
- Tick: `mods = createMods(); mods.demand = 1;` fold every owned upgrade's `effect(mods, state)`, then milestone mods, then prestige (`mods.income *= 1 + legacy·config.prestige.incomePerLegacy`), `sanitizeMods`, `derived.mods = mods`; `computeDerived(...)`; integrate: `money = max(0, money + income·dt)`, `totalEarned += max(0, grossIncome·dt)`, `lifetimeEarned` same, `pop = max(0, pop + popGrowth·dt)` (pop is a float; UI floors it), `peakPop`; check milestones.
- `tap`: `money += max(1, derived.income · config.economy.tapSeconds)`; `stats.clicks++`.
- Milestones: `export const MILESTONES = [{ id, name, desc, icon, check:(state,derived)=>bool, reward?: (mods)=>void, rewardText? }]`. Latched in `state.unlocks['m:'+id]`; on reach → `addLog`, `emit('milestone', ms)`. Include: pop 10/50/100/500/1k/5k/10k/50k/100k/1M, totalEarned 1k/10k/100k/1M/1B/1T, first brownout (`powerRatio<1`), 10 buildings, 100 buildings, first upgrade, first prestige. Pop milestones give +2% income each (rewardText shown in UI).
- Prestige: `canPrestige = totalEarned ≥ config.prestige.threshold`; `prestigeGain = floor((totalEarned/threshold)^config.prestige.exponent) − 0` (gain this run; legacy accumulates); `prestige()`: `legacy += gain; stats.prestiges++; resetState({keepPrestige:true,keepSettings:true,keepStats:true})`, set startMoney·(1+legacy·config.prestige.startMoneyPerLegacy), `addLog`, `emit('prestige', {gain, legacy})`. Return true.
- Dashboard gates (`state.unlocks` keys UI reads): `'panel:power'` when any power building unlocked or demand>0; `'panel:upgrades'` when first upgrade unlocked; `'panel:stats'` pop ≥ 100; `'panel:prestige'` totalEarned ≥ threshold/10; `'panel:civic'` pop ≥ 15.

## Save (`src/save/index.js`)

- Key `metropolis.save.v1`. JSON `{ savedAt, state }`. Base64 for export/import.
- `init(game)`: unless `game.headless`: load, then offline progress: `elapsed = min(now − savedAt, config.save.offlineCapSec)`; simulate by calling `game.step(n)` in ≤ 200-tick chunks with a per-chunk time budget (stop if > 1.5 s wall), remaining time approximated as `money += income·remaining·config.save.offlineEfficiency`; emit `'offline'` `{ seconds, earned }`. Autosave every 30 s (`config.save.autosaveSec`) + `visibilitychange` (hidden) + `beforeunload`. Register actions `save`, `exportSave` (→ string), `importSave(str)` (→ boolean, validates, then `loadState`, emits `'load'`), `hardReset` (clears storage, `loadState({})`, startMoney, emits `'load'`). Never throw out of init; corrupt saves → console.warn + fresh state (not console.error).

## UI (`src/ui/`) — the premium bar

Files: `index.js` (init/mount/render loop), `styles.css`, plus components as you like (`skyline.js`, `panels.js`, `toast.js`…). ONLY module that touches DOM. Reads `game.state`, `game.derived`, `game.api`, `game.events`, `fmt*` from `core/format.js`, `RESOURCES` from resources, `CATEGORIES` from buildings, `MILESTONES` from simulation. Never mutate state directly; use `api.*` and `api.action(...)`.

Layout (desktop ≥ 1200; graceful down to 900):
- **Top bar**: city name (editable? no — "Metropolis" + tier title that changes with pop: Hamlet → Village → Town → City → Metropolis → Megalopolis), resource chips: 💵 money + income/s, 👥 pop / housing, ⚡ cap/demand with ratio bar (turns amber <1, red <0.6), 😊 happiness. Settings gear.
- **Hero / city view** (left, ~38% width): SVG/canvas **skyline** that grows with buildings — silhouettes per category, count-scaled, subtle parallax clouds, day/night gradient cycling slowly, tiny window lights at night. Clickable (`api.action('tap')`) with a floating "+$" particle. Under it: milestone progress ("Next: 500 citizens — 62%") and prestige card when unlocked.
- **Build panel** (center): category tabs (only unlocked categories shown, new ones pulse), building cards: icon, name, count, cost, per-unit stats, tiny "what it does" line; buy ×1 / ×10 / ×max toggle; disabled state at not-affordable with cost ratio bar filling; locked buildings show "?" silhouette with unlock hint. Newly unlocked → glow animation.
- **Right column**: Upgrades (available first, then owned collapsed), Milestones list (reached + next 3), Event log feed (last 8, fade in).
- **Toasts**: milestone reached, offline earnings, prestige.
- **Settings modal**: save now, export (textarea copy), import, hard reset (confirm inline, NOT window.confirm), number format.

Feel: dark slate/graphite glass panels (gradient + border; `backdrop-filter` blur only on toasts and
the modal — blur on a dozen panels cost ~20 fps in headless software rendering), one accent per category, Inter for text, JetBrains Mono for numbers (tabular-nums), 8px radius grid, subtle borders (rgba white 6–10%), soft glows on affordable buy buttons, numbers tween smoothly (lerp on frame), no layout shift as digits change (fixed min-widths). Reduced-motion respected. No emoji-only icons in big places (emoji fine inside chips/cards).

Rendering: on `'frame'` event; cache DOM refs; only write `textContent` when the formatted string changes; rebuild lists only on `buy/upgrade/unlock/milestone/load/prestige` events or every 30 frames as a safety net. Target < 4 ms per frame.

Must work in headless verify: `?headless=1` still mounts the UI (no save load) — screenshots must show a real, populated dashboard after the bot plays.

## Balance (`src/balance/config.js`)

```js
export const config = {
  economy: { startMoney: 50, taxPerPop: 0.08, wage: 0.35, tapSeconds: 1 },
  pop: { growthRate: 0.06, shrinkRate: 0.2, baseInflow: 0.5 },
  power: { brownoutFloor: 0.25 },
  happiness: { civicCap: 1.0, civicScale: 1.5, pollutionScale: 1, unemploymentPenalty: 0.4, overcrowdPenalty: 0.5, brownoutPenalty: 0.3 },
  cost: { tierGrowth: { 1: 1.15, 2: 1.14, 3: 1.13, 4: 1.12 }, sellRefund: 0.5 },
  prestige: { threshold: 1e6, exponent: 0.5, incomePerLegacy: 0.05, startMoneyPerLegacy: 0.5 },
  save: { autosaveSec: 30, offlineCapSec: 8*3600, offlineEfficiency: 0.5 },
  buildings: {},   // id -> partial override of any registerBuilding field
  upgrades: {},    // id -> { cost }
  milestones: { popIncomeBonus: 0.02 },
};
```
`src/balance/index.js` re-exports config; `init()` is a no-op.

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
3. **Legacy is also a currency.** `available = prestige.legacy − prestige.spent`. Charter perks are
   upgrades with `currency: 'legacy'` (core `api.buyUpgrade` handles it; `api.legacyAvailable()`).
   The income bonus always uses the full `legacy` bank — spending never lowers it.
4. **Magnitudes:** money ≤ 1e18 and legacy ≤ 1e6 at 12 h under the bot. Income multiplier from
   legacy stays a root: `(1 + incomePerLegacy·L)^p`, p ≤ 0.6, no soft-cap machinery.

**Cadence target (12 h greedy bot, `npm run sim -- --ticks 432000`, read `metrics` in the JSON):**
- first founding 30–45 min; cycles fall to a floor of 4–8 min by founding 6–10, then rise gently:
  each cycle ≤ 1.35× the previous, last cycle ≤ 40 min; ~18–35 foundings in 12 h.
- every founding after the 5th introduces ≥ 1 never-before-bought item (perk, rung, building, tier).
- **purchase tension:** the priciest unlocked-unowned money item sits at 3–50× cash in ≥ 30 % of samples.
- **power matters:** under-power (ratio < 1) share 3–20 % of the session, floor ≥ 0.6.
- **civic matters:** happiness dips below 1.0 in ≥ 50 % of cities.
- every building and upgrade bought at least once in 12 h; zero `overflow/stall/magnitude` issues.

**Module contracts**
- *upgrades*: ≥ 12 charter perks, `category: 'charter'`, `currency: 'legacy'`, costs ×2.5–4 apart
  from 3 to ~2e5 legacy, strong effects (+50–100 % income/housing/power, −15 % cost, +growth, etc.),
  `unlock: legacy ≥ cost/2`. Replace the wall-clock Civic Bond ladder with an **earnings-gated dollar
  ladder**: fixed costs ×10 per rung from 1e13 to 1e18, `unlock: state.stats.totalEarned ≥ cost/4`,
  with real names/effects (not "Bond XXIII"). Keep every knob in `config.upgrades`.
- *simulation*: earnings-only legacy (principle 2); `prestigePanelShare` knob; legacy tiers up to 1e6;
  `derived.extra.prestige.available`; refreshed header docs with measured numbers; tests updated.
- *balance*: retune to the cadence target; late demand outpaces supply (financial powerUse 2000,
  arcology 1200, fusion ≤ 3e5 MW); first shop < 60 s; keep every building worth buying.
- *ui*: charter perks rendered in the Legacy panel (cost chip `◆ N`, available `◆ have / total`),
  `synergy.text` on building cards, unlock-toast dedupe across foundings, toasts never over Buy buttons.
- *tools/economy-sim.mjs* (integrator): reports `metrics.cycles, tensionShare, underPowerShare,
  happinessDipCities, emptyLateCycles, neverPurchased`; `contractPass` = all of the above.
