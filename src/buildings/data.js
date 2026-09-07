// Building catalogue — the 20 structures of Metropolis, five categories, four tiers.
// Pure data, DOM-free. The values below are the module's *defaults* (docs/DESIGN.md's
// table); `src/balance/config.js` → `config.buildings[id]` overrides any field per building
// and index.js merges it before `registerBuilding`. Fifteen buildings are overridden there
// (base costs, tier-4 power draw and population gates, windmill output and growth), so do
// not quote a number from this file as the shipped value — print the resolved catalogue
// instead:
//   node -e "import('./src/boot.js').then(async m=>{await m.boot();for(const [id,d] of m.game.registry.buildings)console.log(id,d.baseCost,d.unlockAt)})"
// (buildings.test.mjs checks the resolved defs, never this comment.)
//
// Per-unit fields: housing (citizens), jobs, income ($/s), powerGen / powerUse (MW),
// happiness (additive, civic curve), upkeep ($/s). `unlock(state, derived)` latches in core.
// `unlockAt` mirrors the unlock rule as data so the UI can show progress toward it, and
// `unlockHint` quotes the same number; keep the three in step (the test checks the
// boundary and the hint).
//
// Shape of the ladder (see config.js for the numbers):
// - Residential is the cheap column, jobs the expensive one: citizens arrive first, then
//   the city has to find them work, which is where the money is.
// - Power. Each generator is sized to cover a handful of same-tier consumers and the steps
//   between tiers are ~5-15x, so no plant makes the one below it pointless the moment it
//   unlocks. Tier-4 consumers are power-hungry on purpose (config triples the catalogue's
//   draw): one nuclear plant carries one or two of them, so the Power tab keeps asking for
//   money through the late game instead of going dark after one reactor.
// - Air quality. Polluters are mild per unit (factory, coal, refinery) and clean tech pushes
//   the other way (solar, nuclear, tech campus, fusion), so a late city can scrub its own
//   smog by choosing its power mix; config caps the total penalty (happiness.pollutionCap)
//   the same way civic saturates.
// - Unlock spacing. Population gates are placed just below the population the greedy bot
//   has when the price frontier reaches each building, so a freshly unlocked card is
//   affordable within a few minutes rather than glowing unaffordably for a quarter hour,
//   and after the opening minutes no two cards open within a minute of each other.
//   `node src/buildings/cadence.mjs` measures this (first-city open / first-buy per
//   building, exit 1 on a collision or a > 5 min glow). Measured on the 2026-09-07 tree:
//   tower 8.7 min · school 10.7 · refinery 14.9 · mall 16.4 · solar 17.7 · arcology 19.5 ·
//   hospital 21.5 · tech campus + nuclear 27.1 · financial 29.0 · stadium 34.0 (bought
//   38.5, founding 39.9), lag 2–4 min except the arcology (7.5) and financial (5.4).
//   The three remaining faults are config-owned: config.buildings pins techpark and
//   nuclear to the same 8,000 gate (this file's default puts nuclear at 10,000) and sets
//   the arcology/financial base costs; moving nuclear to ~6,000 and trimming those two
//   costs (or raising their gates) in config closes them — nothing in this folder can.
//   The windmill gates on live power demand, so the first cottage is always followed by
//   one dark tick. Measured (12 h sim): opening the windmill from the start drops the
//   "happiness dips below 1.0" count from 19 to 8 of 32 cities, under the ≥ 50% contract
//   in docs/DESIGN.md — replay cities bottom out at 0.96 and only the tick-0 brownout puts
//   them under — so the gate stays until the simulation's civic pressure comes from
//   elsewhere (the fresh-state hook is where a free windmill would be seeded).
//
// Signature mechanics (`synergy`). Six buildings carry a per-unit stat that scales with the
// city instead of being a bigger copy of the tier below. The rule is data:
// `{ stat, source, per, cap, text }` means `stat = base × min(cap, 1 + source / per)`, where
// source is 'pop', 'employed' or 'building:<id>' (an owned count). index.js evaluates it in
// a tick handler that runs just before the simulation, writing the live value into the
// registered definition, so the sim, the bot and the build card all see the same number.
//   mall       income grows with population (retail follows the crowd; up to ×3 at 10k)
//   refinery   income grows with the factories it supplies (up to ×2 at 50 factories)
//   techpark   income grows with schools (a hiring line; up to ×1.75 at 15 schools)
//   financial  income grows with employment (trades on the payroll; up to ×2.5 at 30k)
//   solar      output grows with city parks (open land to tilt panels on; ×1.5 at 25)
//   fusion     output grows with nuclear plants (research spillover; ×2 at 10)
// The two power hooks give the Power tab a second axis: a green city's solar farms out-
// produce their sticker, and a reactor fleet makes fusion match nuclear's $/MW instead of
// being a trophy — so the late grid is a choice, not a $/MW sort. The strengths are
// pinned by the power contract: ×2 solar (at 40 or 25 parks) puts the 12 h under-power
// share at 2.8% against the ≥ 3% floor; ×1.5 at 25 parks reads 3.1% (3.9% with no hook).
// Static two-axis identities: the arcology also employs 500 (a sealed, self-contained
// block), the stadium pays and cheers, the tech campus hires and cleans the air.

export const CATEGORIES = [
  { id: 'residential', name: 'Residential', icon: '🏠', color: '#60a5fa', blurb: 'Homes. Citizens move in when there is room, power, and a reason to stay.' },
  { id: 'commercial', name: 'Commercial', icon: '🏪', color: '#4ade80', blurb: 'Shops and offices. Jobs for citizens, revenue for the treasury.' },
  { id: 'industrial', name: 'Industrial', icon: '🏭', color: '#fb923c', blurb: 'Heavy employers with heavy paychecks. The skyline gets a little hazier.' },
  { id: 'power', name: 'Power', icon: '⚡', color: '#facc15', blurb: 'Keep supply ahead of demand or the whole city dims.' },
  { id: 'civic', name: 'Civic', icon: '🏛️', color: '#c084fc', blurb: 'Parks, schools, and pride. Happy citizens grow faster and spend more.' },
];

const pop = (n) => (state) => (state?.res?.pop ?? 0) >= n;
const demand = (n) => (state, derived) => (derived?.powerDemand ?? 0) >= n;

export const BUILDINGS = [
  // ---------------------------------------------------------------- residential
  {
    id: 'house',
    name: 'Cottage',
    icon: '🏠',
    desc: 'A tidy starter home with a porch light and a lawn to mow.',
    category: 'residential',
    tier: 1,
    baseCost: 30,
    housing: 4,
    powerUse: 1,
    unlock: null,
    unlockHint: 'Available from the start',
  },
  {
    id: 'apartment',
    name: 'Apartment Block',
    icon: '🏢',
    desc: 'Six floors of neighbors who all know when you get home.',
    category: 'residential',
    tier: 2,
    baseCost: 400,
    housing: 24,
    powerUse: 6,
    unlock: pop(20),
    unlockAt: { pop: 20 },
    unlockHint: 'Reach 20 citizens',
  },
  {
    id: 'tower',
    name: 'Residential Tower',
    icon: '🏙️',
    desc: 'Glass and steel stacked skyward; the elevators hum all night.',
    category: 'residential',
    tier: 3,
    baseCost: 9000,
    housing: 160,
    powerUse: 40,
    unlock: pop(250),
    unlockAt: { pop: 250 },
    unlockHint: 'Reach 250 citizens',
  },
  {
    id: 'arcology',
    name: 'Arcology',
    icon: '🌆',
    desc: 'A city within the city, sealed against weather and small talk.',
    category: 'residential',
    tier: 4,
    baseCost: 1.2e6,
    housing: 2500,
    jobs: 500, // self-contained: the block staffs its own shops, clinics and corridors
    powerUse: 2500,
    happiness: 0.02,
    // Default 6,000 sits a clear step above the hospital (4,800); config ships 4,000 with
    // a lower base cost and housing. If that override is ever lifted, 5,000 would open the
    // arcology 4% (≈ 40 s) behind the hospital.
    unlock: pop(6000),
    unlockAt: { pop: 6000 },
    unlockHint: 'Reach 6,000 citizens',
  },

  // ----------------------------------------------------------------- commercial
  {
    id: 'shop',
    name: 'Corner Shop',
    icon: '🏪',
    desc: 'Coffee, newspapers, and gossip, open from dawn to whenever.',
    category: 'commercial',
    tier: 1,
    baseCost: 60,
    jobs: 5,
    income: 0.3,
    powerUse: 1,
    unlock: pop(4),
    unlockAt: { pop: 4 },
    unlockHint: 'Reach 4 citizens',
  },
  {
    id: 'office',
    name: 'Office Block',
    icon: '🏬',
    desc: 'Cubicles, fluorescent light, and very confident forecasts.',
    category: 'commercial',
    tier: 2,
    baseCost: 900,
    // 50 clean jobs against the factory's 20 smoggy ones: the office out-pays a factory
    // per dollar only once the city has citizens to fill the desks (jobs pay wages, empty
    // desks pay nothing), while the factory's flat $3/s is guaranteed and it draws 3x the
    // power per dollar. Neither strictly dominates; the choice depends on the vacancy.
    jobs: 50,
    income: 3,
    powerUse: 8,
    unlock: pop(80),
    unlockAt: { pop: 80 },
    unlockHint: 'Reach 80 citizens',
  },
  {
    id: 'mall',
    name: 'Shopping Mall',
    icon: '🛍️',
    desc: 'A food court, fountains, and tills that ring louder as the city grows.',
    category: 'commercial',
    tier: 3,
    baseCost: 20000,
    jobs: 300,
    income: 40,
    synergy: { stat: 'income', source: 'pop', per: 5000, cap: 3, text: 'Income +20% per 1,000 citizens (up to ×3)' },
    powerUse: 60,
    happiness: 0.01,
    unlock: pop(3000),
    unlockAt: { pop: 3000 },
    unlockHint: 'Reach 3,000 citizens',
  },
  {
    id: 'financial',
    name: 'Financial District',
    icon: '🏦',
    desc: 'Trades on every paycheck in town; the bigger the payroll, the better.',
    category: 'commercial',
    tier: 4,
    baseCost: 3e6,
    jobs: 4000,
    income: 2000,
    synergy: { stat: 'income', source: 'employed', per: 20000, cap: 2.5, text: 'Income +5% per 1,000 employed citizens (up to ×2.5)' },
    powerUse: 4000,
    unlock: pop(12000),
    unlockAt: { pop: 12000 },
    unlockHint: 'Reach 12,000 citizens',
  },

  // ----------------------------------------------------------------- industrial
  {
    id: 'factory',
    name: 'Factory',
    icon: '🏭',
    desc: 'Smokestacks and shift whistles. The town’s first real paycheck.',
    category: 'industrial',
    tier: 1,
    baseCost: 350,
    jobs: 20,
    income: 2.5,
    powerUse: 10,
    happiness: -0.02,
    unlock: pop(30),
    unlockAt: { pop: 30 },
    unlockHint: 'Reach 30 citizens',
  },
  {
    id: 'refinery',
    name: 'Refinery',
    icon: '⚗️',
    desc: 'Flare stacks, orange sunsets, and every factory in town as a customer.',
    category: 'industrial',
    tier: 2,
    baseCost: 15000,
    jobs: 200,
    income: 60,
    synergy: { stat: 'income', source: 'building:factory', per: 50, cap: 2, text: 'Income +2% per Factory (up to ×2)' },
    powerUse: 120,
    happiness: -0.03,
    unlock: pop(2500),
    unlockAt: { pop: 2500 },
    unlockHint: 'Reach 2,500 citizens',
  },
  {
    id: 'techpark',
    name: 'Tech Campus',
    icon: '💻',
    desc: 'Free lunch, ping-pong, and a hiring line that starts at the schools.',
    category: 'industrial',
    tier: 3,
    baseCost: 1.5e6,
    jobs: 2500,
    income: 1000,
    synergy: { stat: 'income', source: 'building:school', per: 20, cap: 1.75, text: 'Income +5% per School (up to ×1.75)' },
    powerUse: 4500,
    happiness: 0.05,
    unlock: pop(8000),
    unlockAt: { pop: 8000 },
    unlockHint: 'Reach 8,000 citizens',
  },

  // ---------------------------------------------------------------------- power
  {
    id: 'windmill',
    name: 'Windmill',
    icon: '🌬️',
    desc: 'Creaks in the breeze and keeps the porch lights burning.',
    category: 'power',
    tier: 1,
    baseCost: 120,
    powerGen: 6,
    unlock: (state, derived) => (derived?.powerDemand ?? 0) > 0,
    unlockAt: { powerDemand: 0.001 },
    unlockHint: 'Build something that draws power',
  },
  {
    id: 'coal',
    name: 'Coal Plant',
    icon: '🔥',
    desc: 'Cheap, reliable, and a little grimy. The lights stay on.',
    category: 'power',
    tier: 2,
    baseCost: 1500,
    jobs: 10,
    powerGen: 80,
    happiness: -0.015,
    unlock: demand(20),
    unlockAt: { powerDemand: 20 },
    unlockHint: 'Power demand reaches 20 MW',
  },
  {
    id: 'solar',
    name: 'Solar Farm',
    icon: '☀️',
    desc: 'Acres of panels tilting slowly to follow the sun.',
    category: 'power',
    tier: 3,
    baseCost: 25000,
    powerGen: 900,
    // Panels want open land: every city park lifts the farm's output.
    synergy: { stat: 'powerGen', source: 'building:park', per: 50, cap: 1.5, text: 'Output +2% per City Park (up to ×1.5)' },
    happiness: 0.03,
    // 3,600: between the mall (3,000) and the arcology (config: 4,000). The first city
    // passes 3,000 at ~16.4 min and 4,000 at ~19.5, so the farm opens ~17.7 min — 1.3 min
    // after the mall and 1.8 before the arcology — instead of 12 s behind the mall (3,200)
    // or 50 s (3,500); 3,800 landed 40 s before the arcology. Measured with
    // `node src/buildings/cadence.mjs`.
    unlock: pop(3600),
    unlockAt: { pop: 3600 },
    unlockHint: 'Reach 3,600 citizens',
  },
  {
    id: 'nuclear',
    name: 'Nuclear Plant',
    icon: '☢️',
    desc: 'Cooling towers on the skyline and a very thorough safety manual.',
    category: 'power',
    tier: 4,
    baseCost: 2e6,
    jobs: 100,
    powerGen: 12000,
    happiness: 0.02,
    upkeep: 120,
    unlock: pop(10000),
    unlockAt: { pop: 10000 },
    unlockHint: 'Reach 10,000 citizens',
  },
  {
    id: 'fusion',
    name: 'Fusion Reactor',
    icon: '🌟',
    desc: 'A star in a bottle. The grid will never want for power again.',
    category: 'power',
    tier: 4,
    baseCost: 5e8,
    jobs: 200,
    powerGen: 60000,
    // Research spillover: a reactor fleet's engineers make the star burn hotter.
    synergy: { stat: 'powerGen', source: 'building:nuclear', per: 10, cap: 2, text: 'Output +10% per Nuclear Plant (up to ×2)' },
    happiness: 0.05,
    upkeep: 6000,
    unlock: (state) => (state?.res?.pop ?? 0) >= 100000 || (state?.prestige?.legacy ?? 0) >= 1,
    // Either condition opens it; `pop` gives the locked card a progress bar in a first city,
    // `legacy` is the usual route (any founding).
    unlockAt: { pop: 100000, legacy: 1 },
    unlockHint: 'Found a new city (or reach 100,000 citizens)',
  },

  // ---------------------------------------------------------------------- civic
  {
    id: 'park',
    name: 'City Park',
    icon: '🌳',
    desc: 'Benches, ducks, and a fountain someone keeps adding soap to.',
    category: 'civic',
    tier: 1,
    baseCost: 200,
    costGrowth: 1.2,
    happiness: 0.05,
    unlock: pop(15),
    unlockAt: { pop: 15 },
    unlockHint: 'Reach 15 citizens',
  },
  {
    id: 'school',
    name: 'School',
    icon: '🏫',
    desc: 'Bells, chalk dust, and the future learning long division.',
    category: 'civic',
    tier: 2,
    baseCost: 5000,
    costGrowth: 1.18,
    jobs: 30,
    powerUse: 5,
    happiness: 0.08,
    unlock: pop(500),
    unlockAt: { pop: 500 },
    unlockHint: 'Reach 500 citizens',
  },
  {
    id: 'hospital',
    name: 'Hospital',
    icon: '🏥',
    desc: 'Clean corridors and a helipad. The whole city sleeps easier.',
    category: 'civic',
    tier: 3,
    baseCost: 80000,
    costGrowth: 1.18,
    jobs: 200,
    powerUse: 50,
    happiness: 0.12,
    unlock: pop(4800),
    unlockAt: { pop: 4800 },
    unlockHint: 'Reach 4,800 citizens',
  },
  {
    id: 'stadium',
    name: 'Stadium',
    icon: '🏟️',
    desc: 'Eighty thousand voices under the floodlights on game night.',
    category: 'civic',
    tier: 4,
    baseCost: 5e6,
    costGrowth: 1.2,
    jobs: 500,
    income: 2000,
    powerUse: 1500,
    happiness: 0.25,
    unlock: pop(20000),
    unlockAt: { pop: 20000 },
    unlockHint: 'Reach 20,000 citizens',
  },
];
