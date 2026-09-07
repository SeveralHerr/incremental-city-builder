// Building catalogue — the 20 structures of Metropolis, five categories, four tiers.
// Pure data, DOM-free. These are the module's *defaults*: `config.buildings[id]` in
// src/balance/config.js may override any field per building and index.js merges it before
// `registerBuilding`. Since the 2026-09-07 polish pass the defaults below are the shipped
// numbers (config re-pins fifteen buildings with values identical to these, so a config
// import failure ships the same ladder the balance sim was run on); a genuine delta shows
// in brackets in `node src/buildings/catalogue.mjs`, which prints the resolved catalogue.
// Why the ladder has this shape (columns, power steps, air quality, unlock spacing, the
// signature mechanics) is in README.md.
//
// Per-unit fields: housing (citizens), jobs, income ($/s), powerGen / powerUse (MW),
// happiness (additive, civic curve), upkeep ($/s). costGrowth defaults to the tier's
// config.cost.tierGrowth value when absent. maxCount (optional, positive integer) is a
// hard cap on owned units: core's api.buy / maxAffordable refuse past it and api.buildings
// rows carry `maxed` (index.js also rolls an over-cap purchase back should a core without
// the cap ever be loaded).
// unlock(state, derived) latches in core; `unlockAt` mirrors it as data for the UI's
// progress bar and `unlockHint` quotes the same number — the test holds all three in step.
// synergy { stat, source, per, cap, text }: stat = base × min(cap, 1 + source / per),
//   source is 'pop', 'employed' or 'building:<id>'.
// demandGrowth { per, cap, text }: powerUse = base × min(cap, 1 + (count − 1) / per).
// `text` is what the build card prints (≤ 70 chars, quotes the rule's own numbers).

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
    // Late role: the suburbs fill in around the blocks. Keeps the cheap column a choice
    // once apartments are the frontier instead of a card nobody has a reason to open.
    synergy: { stat: 'housing', source: 'building:apartment', per: 25, cap: 3, text: 'Suburbs: +4% housing per Apartment Block (up to ×3)' },
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
    baseCost: 280,
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
    baseCost: 3000,
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
    baseCost: 120000,
    housing: 1000,
    jobs: 500, // self-contained: the block staffs its own shops, clinics and corridors
    // 10.5 MW per citizen, 42× the tower's 0.25: the sticker is deliberately a power bill
    // (~0.9 nuclear plants per block) so the Power tab keeps asking for money late; the
    // strain below is the second, quadratic axis. README "Power" quotes these rates.
    powerUse: 10500,
    demandGrowth: { per: 40, cap: 1.5, text: 'Grid strain: draw +2.5% per Arcology owned (up to ×1.5)' },
    happiness: 0.1, // gardens, clinics and corridors of its own: two parks' worth, felt on the card
    // 6,300: a clear step (≥ 15%) above the hospital (5,400) and ~3.4 min behind it in the
    // first city; nuclear (11,000) follows ~3.4 min later.
    unlock: pop(6300),
    unlockAt: { pop: 6300 },
    unlockHint: 'Reach 6,300 citizens',
  },

  // ----------------------------------------------------------------- commercial
  {
    id: 'shop',
    name: 'Corner Shop',
    icon: '🏪',
    desc: 'Coffee, newspapers, and gossip, open from dawn to whenever.',
    category: 'commercial',
    tier: 1,
    baseCost: 50,
    jobs: 5,
    income: 0.8,
    // Late role: the lunch crowd. Offices are the tier above; every block of desks feeds
    // the tills, so a mid-game city still has a reason to keep opening shops.
    synergy: { stat: 'income', source: 'building:office', per: 25, cap: 3, text: 'Lunch trade: +4% income per Office Block (up to ×3)' },
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
    baseCost: 1200,
    // 50 clean jobs against the factory's 20 smoggy ones: the office out-pays a factory
    // per dollar only once the city has citizens to fill the desks (empty desks pay
    // nothing) while the factory's flat income is guaranteed. Neither dominates.
    jobs: 50,
    income: 4,
    powerUse: 8,
    // 80 citizens lands at 4.8 min in the first city; the coal plant's demand gate is
    // placed so the two never open in the same minute (see coal).
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
    baseCost: 25000,
    jobs: 300,
    income: 40,
    synergy: { stat: 'income', source: 'pop', per: 5000, cap: 3, text: 'Income +20% per 1,000 citizens (up to ×3)' },
    powerUse: 60,
    // 2,800: between the refinery (2,200) and the solar farm (3,600), ~2 min apart each.
    unlock: pop(2800),
    unlockAt: { pop: 2800 },
    unlockHint: 'Reach 2,800 citizens',
  },
  {
    id: 'financial',
    name: 'Financial District',
    icon: '🏦',
    desc: 'Trades on every paycheck in town; the bigger the payroll, the better.',
    category: 'commercial',
    tier: 4,
    baseCost: 700000,
    jobs: 4000,
    income: 2500,
    synergy: { stat: 'income', source: 'employed', per: 20000, cap: 2.5, text: 'Income +5% per 1,000 employed citizens (up to ×2.5)' },
    powerUse: 16500, // 4.1 MW per job, ~21× the mall's 0.2 — ~1.4 nuclear plants per district
    demandGrowth: { per: 40, cap: 1.5, text: 'Grid strain: draw +2.5% per District owned (up to ×1.5)' },
    // 22,000: ~2 min after the tech campus (14,500) in the first city, ~5 min before fusion.
    unlock: pop(22000),
    unlockAt: { pop: 22000 },
    unlockHint: 'Reach 22,000 citizens',
  },

  // ----------------------------------------------------------------- industrial
  {
    id: 'factory',
    name: 'Factory',
    icon: '🏭',
    desc: 'Smokestacks and shift whistles. The town’s first real paycheck.',
    category: 'industrial',
    tier: 1,
    baseCost: 500,
    jobs: 20,
    income: 3,
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
    baseCost: 20000,
    jobs: 200,
    income: 60,
    synergy: { stat: 'income', source: 'building:factory', per: 50, cap: 2, text: 'Income +2% per Factory (up to ×2)' },
    powerUse: 120,
    happiness: -0.03,
    // 2,200: 90 s+ ahead of the mall (2,800) in the first city; at 2,500 they opened a minute apart.
    unlock: pop(2200),
    unlockAt: { pop: 2200 },
    unlockHint: 'Reach 2,200 citizens',
  },
  {
    id: 'techpark',
    name: 'Tech Campus',
    icon: '💻',
    desc: 'Free lunch, ping-pong, and a hiring line that starts at the schools.',
    category: 'industrial',
    tier: 3,
    baseCost: 300000,
    jobs: 2500,
    income: 900,
    synergy: { stat: 'income', source: 'building:school', per: 20, cap: 1.75, text: 'Income +5% per School (up to ×1.75)' },
    powerUse: 18700, // 7.5 MW per job, ~12× the refinery's 0.6 — ~1.6 nuclear plants per campus
    demandGrowth: { per: 40, cap: 1.5, text: 'Grid strain: draw +2.5% per Campus owned (up to ×1.5)' },
    happiness: 0.05,
    // 14,500: ~3 min after nuclear (11,000) in the first city, so the campus's bill has a
    // plant to land on; ~2 min before the financial district.
    unlock: pop(14500),
    unlockAt: { pop: 14500 },
    unlockHint: 'Reach 14,500 citizens',
  },

  // ---------------------------------------------------------------------- power
  {
    id: 'windmill',
    name: 'Windmill',
    icon: '🌬️',
    desc: 'Creaks in the breeze and keeps the porch lights burning.',
    category: 'power',
    tier: 1,
    baseCost: 40,
    // ×2 per unit: the 12th costs $81,920 for 4 MW. That is the tutorial generator's
    // retirement, made explicit by the cap below — without it a Buy Max on the Power tab
    // late in a session paid ~$1e16 for the 49th (40% of a 12 h city's cash) for 4 MW.
    costGrowth: 2,
    powerGen: 4,
    maxCount: 12,
    // Gates on live draw, so the first cottage is followed by one dark tick (README: why
    // that stays).
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
    // $2,500 (was $1,500): with the windmill retired at 12 the coal plant is the fix the bot
    // reaches for from minute 6, and at $1,500 it fixed the first city's brownouts so fast
    // the 12 h under-power share read 2.6% against the ≥ 3% contract; $2,500 reads 3.1%
    // and the first plant is still bought 2.6 min after it opens (README "Power").
    baseCost: 2500,
    jobs: 10,
    powerGen: 80,
    happiness: -0.015,
    // 40 MW: ten windmills' worth. At 20 MW the plant opened in the same second as the
    // office block (4.8 min) and 24 MW still landed in that second (the apartment spree
    // jumps the draw 18 → 34 MW); 40 MW opens it at 6.2 min, 84 s after the office.
    unlock: demand(40),
    unlockAt: { powerDemand: 40 },
    unlockHint: 'Power demand reaches 40 MW',
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
    // 3,600: ~2 min after the mall (2,800) and ~4.5 min before the hospital (5,400); the
    // population jumps in tower sprees around 3,000, so 3,200–3,300 lands on the mall.
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
    baseCost: 400000,
    jobs: 100,
    powerGen: 12000,
    happiness: 0.02,
    // A real running cost: the bill the fusion reactor is there to replace.
    upkeep: 300,
    // 11,000: ~3.4 min after the arcology (6,300), whose 10.5 GW draw is what the plant
    // is sized for, and ~3 min before the tech campus (14,500).
    unlock: pop(11000),
    unlockAt: { pop: 11000 },
    unlockHint: 'Reach 11,000 citizens',
  },
  {
    id: 'fusion',
    name: 'Fusion Reactor',
    icon: '🌟',
    desc: 'A star in a bottle. The grid will never want for power again.',
    category: 'power',
    tier: 4,
    // $67/MW at the sticker against nuclear's $33, $22 at ×3 — the fleet is the price of
    // admission (the test pins the ordering for these defaults and the resolved defs).
    baseCost: 4e6,
    jobs: 200,
    powerGen: 60000,
    // Research spillover: a reactor fleet's engineers make the star burn hotter.
    synergy: { stat: 'powerGen', source: 'building:nuclear', per: 10, cap: 3, text: 'Output +10% per Nuclear Plant (up to ×3)' },
    happiness: 0.05,
    // The same bill per MW as nuclear at the sticker ($0.025/MW/s), a third of it at ×3.
    upkeep: 1500,
    unlock: (state) => (state?.res?.pop ?? 0) >= 28000 || (state?.prestige?.legacy ?? 0) >= 1,
    unlockAt: { pop: 28000, legacy: 1 },
    unlockHint: 'Found a new city (or reach 28,000 citizens)',
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
    baseCost: 60000,
    costGrowth: 1.18,
    jobs: 200,
    powerUse: 50,
    happiness: 0.12,
    // 5,400: bracketed by the solar farm (3,600) below and the arcology (6,300) above,
    // ~4.5 and ~3 min apart in the first city; at 4,800 it landed 54 s behind the arcology.
    unlock: pop(5400),
    unlockAt: { pop: 5400 },
    unlockHint: 'Reach 5,400 citizens',
  },
  {
    id: 'stadium',
    name: 'Stadium',
    icon: '🏟️',
    desc: 'Eighty thousand voices under the floodlights on game night.',
    category: 'civic',
    tier: 4,
    baseCost: 3.5e6,
    // Tier-4 cost growth (no 1.2 exception): by the time it opens the civic curve is
    // saturated, so a stadium is bought as a franchise, and a franchise needs a league.
    jobs: 500,
    income: 2000,
    // Scales with the city through its payroll, not its tills: game-day hiring grows with
    // the crowd (wages plus an unemployment fix), so the card is a decision late without
    // moving city income enough to re-place the balance ladder — an income rule at ×3 did
    // (README, "Signature mechanics").
    synergy: { stat: 'jobs', source: 'pop', per: 20000, cap: 3, text: 'Game-day hires: +5% jobs per 1,000 citizens (up to ×3)' },
    powerUse: 6200, // floodlights and screens: about half an arcology's draw
    demandGrowth: { per: 40, cap: 1.5, text: 'Grid strain: draw +2.5% per Stadium owned (up to ×1.5)' },
    happiness: 0.25,
    // 43,000: the first city's last card, ~3.4 min after fusion's 35,000 trophy gate.
    unlock: pop(43000),
    unlockAt: { pop: 43000 },
    unlockHint: 'Reach 43,000 citizens',
  },
];
